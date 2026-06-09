<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import {
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  CopyIcon,
  CheckIcon,
  X as XIcon,
} from 'lucide-vue-next';
import TextStatistics from '../components/TextStatistics.vue';
import SpeedControl from '../components/SpeedControl.vue';
import AudioChunk from '../components/AudioChunk.vue';
import ModelSelector from '../components/ModelSelector.vue';
import VoiceSelector from '../components/VoiceSelector.vue';
import { getModelsListUrl, DEFAULT_LANG_MODELS, DEFAULT_MODEL } from '../config.js';
import { addEntry } from '../utils/history-store.js';
import { mergeWavBlobs } from '../utils/audio-helper.js';
import { processTextForTTS, chunkText } from '../utils/text-cleaner.js';

const props = defineProps({
  lang: {
    type: String,
    required: true,
  },
});

const defaultText = {
  en: "The quick brown fox jumps over the lazy dog.",
  id: "Halo, selamat datang di dunia kecerdasan buatan.",
};

const text = ref(defaultText[props.lang] || defaultText.en);
const lastGeneration = ref(null);
const isPlaying = ref(false);
const currentChunkIndex = ref(-1);
const speed = ref(0.8);
const copied = ref(false);
const status = ref("idle");
const error = ref(null);
const worker = ref(null);
const voices = ref(null);
const selectedVoice = ref(0);
const chunks = ref([]);
const result = ref(null);
const availableModels = ref([]);
const selectedModel = ref("None");
const modelsLoading = ref(false);
const loadingProgress = ref(0);

const isLocalCliAvailable = ref(false);
const selectedBackend = ref('wasm');
let activeAbortController = null;

const totalChunks = ref(0);
const completedChunksCount = ref(0);
const startTime = ref(0);
const elapsedTime = ref(0);
const remainingTime = ref(null);

const formatTime = (seconds) => {
  if (seconds === null || isNaN(seconds)) return 'Calculating...';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
};

const processed = computed(() => {
  return lastGeneration.value &&
      lastGeneration.value.text === text.value &&
      lastGeneration.value.speed === speed.value &&
      lastGeneration.value.voice === selectedVoice.value;
});

const checkLocalCliStatus = async () => {
  try {
    const response = await fetch('/api/tts-local/status');
    if (response.ok) {
      const data = await response.json();
      isLocalCliAvailable.value = data.available === true;
      if (isLocalCliAvailable.value) {
        selectedBackend.value = 'local';
      }
    }
  } catch (err) {
    console.log('Local CLI backend not available, falling back to WASM.');
    isLocalCliAvailable.value = false;
  }
};

const generateAudioWithLocalCli = async (textChunks) => {
  try {
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    
    status.value = "generating";
    totalChunks.value = textChunks.length;
    startTime.value = performance.now();
    elapsedTime.value = 0;
    remainingTime.value = null;
    completedChunksCount.value = 0;
    
    const response = await fetch('/api/tts-local', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chunks: textChunks,
        model: selectedModel.value,
        lang: props.lang || 'vi',
        speakerId: selectedVoice.value,
        speed: speed.value
      }),
      signal
    });
    
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = '';
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      
      // Save the last line if it's incomplete
      streamBuffer = lines.pop();
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr) {
            try {
              const eventData = JSON.parse(dataStr);
              
              if (eventData.status === 'stream') {
                // Decode base64 to Uint8Array/Blob
                const binaryStr = atob(eventData.audio);
                const len = binaryStr.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                const audioBlob = new Blob([bytes], { type: 'audio/wav' });
                
                // Add chunk to state
                chunks.value = [...chunks.value, {
                  audio: audioBlob,
                  text: eventData.text
                }];
                
                completedChunksCount.value++;
                
                if (completedChunksCount.value > 0 && totalChunks.value > 0) {
                  const elapsed = (performance.now() - startTime.value) / 1000;
                  elapsedTime.value = elapsed;
                  const avgTimePerChunk = elapsed / completedChunksCount.value;
                  const remainingChunks = totalChunks.value - completedChunksCount.value;
                  remainingTime.value = Math.max(0, Math.round(remainingChunks * avgTimePerChunk));
                }
              } else if (eventData.status === 'error') {
                throw new Error(eventData.data);
              }
            } catch (parseErr) {
              console.error('Failed to parse event stream data:', parseErr);
            }
          }
        }
      }
    }
    
    // Finished successfully
    status.value = "ready";
    remainingTime.value = 0;
    
    // Merge all chunks for downloading / history
    if (chunks.value.length > 0) {
      const audioBlob = await mergeWavBlobs(chunks.value.map(c => c.audio));
      result.value = audioBlob;
      
      if (audioBlob && lastGeneration.value && selectedModel.value) {
        addEntry({
          text: lastGeneration.value.text,
          voice: lastGeneration.value.voice,
          speed: lastGeneration.value.speed,
          model: selectedModel.value,
          lang: props.lang || 'vi',
          audio: audioBlob,
        }).catch((err) => console.error('History save failed:', err));
      }
    }
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('CLI generation cancelled by user.');
      status.value = "ready";
    } else {
      console.error('CLI generation error:', err);
      error.value = `CLI Generation failed: ${err.message}. Falling back to WASM...`;
      isLocalCliAvailable.value = false;
      chunks.value = [];
      currentChunkIndex.value = 0;
      status.value = "ready";
      isPlaying.value = false;
      
      // Fallback
      handlePlayPause();
    }
  } finally {
    activeAbortController = null;
  }
};

const setSpeed = (newSpeed) => {
  speed.value = newSpeed;
};

const setSelectedVoice = (voice) => {
  selectedVoice.value = voice;
};

const handleVoicePreview = (voiceId) => {
  if (!worker.value || status.value !== "ready") return;
  worker.value.postMessage({
    type: 'preview',
    text: props.lang === 'en' ? "Hello, this is a voice preview." : "Halo, ini adalah pratinjau suara.",
    voice: voiceId,
    speed: speed.value
  });
};

const restartWorker = (modelName = null) => {
  if (worker.value) {
    worker.value.terminate();
  }

  status.value = "loading";
  loadingProgress.value = 0;
  voices.value = null;
  chunks.value = [];
  result.value = null;
  lastGeneration.value = null;
  isPlaying.value = false;
  currentChunkIndex.value = -1;

  const progressInterval = setInterval(() => {
    if (loadingProgress.value < 90) {
      loadingProgress.value += Math.random() * 5;
      if (loadingProgress.value > 90) loadingProgress.value = 90;
    }
  }, 200);

  worker.value = new Worker(new URL("../workers/tts-worker-i18n.js", import.meta.url), {
    type: "module",
  });

  worker.value.addEventListener("message", onMessageReceived);
  worker.value.addEventListener("error", onErrorReceived);

  const modelToLoad = modelName || selectedModel.value;
  worker.value.postMessage({ type: 'init', lang: props.lang, model: modelToLoad });
  worker.value._progressInterval = progressInterval;
};

const setCurrentChunkIndex = (index) => {
  currentChunkIndex.value = index;
};

const setIsPlaying = (playing) => {
  isPlaying.value = playing;
};

const handleChunkEnd = () => {
  if (status.value !== "generating" && currentChunkIndex.value === chunks.value.length - 1) {
    isPlaying.value = false;
    currentChunkIndex.value = -1;
  } else {
    currentChunkIndex.value = currentChunkIndex.value + 1;
  }
};

const handlePlayPause = async () => {
  if (!isPlaying.value && status.value === "ready" && !processed.value) {
    chunks.value = [];
    currentChunkIndex.value = 0;
    
    totalChunks.value = 0;
    completedChunksCount.value = 0;
    startTime.value = 0;
    elapsedTime.value = 0;
    remainingTime.value = null;

    const params = {
      text: text.value,
      voice: selectedVoice.value,
      speed: speed.value
    };
    lastGeneration.value = params;

    if (selectedBackend.value === 'local' && isLocalCliAvailable.value) {
      try {
        const processedText = await processTextForTTS(text.value);
        const textChunks = await chunkText(processedText);
        if (textChunks.length > 0) {
          isPlaying.value = true;
          generateAudioWithLocalCli(textChunks);
          return;
        }
      } catch (err) {
        console.error("Local CLI prep failed, falling back to WASM:", err);
      }
    }

    status.value = "generating";
    worker.value?.postMessage({
      text: text.value,
      voice: selectedVoice.value,
      speed: speed.value
    });
  }
  if (currentChunkIndex.value === -1) {
    currentChunkIndex.value = 0;
  }
  isPlaying.value = !isPlaying.value;
};

const handleCancelGeneration = () => {
  if (selectedBackend.value === 'local' && activeAbortController) {
    activeAbortController.abort();
  } else {
    worker.value?.postMessage({ type: 'stop' });
  }
};

const downloadAudio = async () => {
  let audioBlob = result.value;
  if (!audioBlob && chunks.value.length > 0) {
    audioBlob = await mergeWavBlobs(chunks.value.map(c => c.audio));
  }
  
  if (!audioBlob) return;
  const url = URL.createObjectURL(audioBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "audio.wav";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
};

const handleCopy = async () => {
  await navigator.clipboard.writeText(text.value);
  copied.value = true;
  setTimeout(() => { copied.value = false }, 2000);
};

const fetchModels = async () => {
  modelsLoading.value = true;
  error.value = null;
  try {
    const url = getModelsListUrl(props.lang);
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const list = data.models || [];
      availableModels.value = list.length > 0 ? list : (DEFAULT_LANG_MODELS[props.lang] || []);
    } else {
      availableModels.value = DEFAULT_LANG_MODELS[props.lang] || [];
    }
    if (selectedModel.value && selectedModel.value !== "None" && !availableModels.value.includes(selectedModel.value)) {
      selectedModel.value = "None";
    }

    // Auto-load default model when entering page
    const models = availableModels.value;
    if (selectedModel.value === "None" && models.length > 0) {
      const defaultModel = (DEFAULT_MODEL[props.lang] && models.includes(DEFAULT_MODEL[props.lang]))
        ? DEFAULT_MODEL[props.lang]
        : models[0];
      selectedModel.value = defaultModel;
      restartWorker(defaultModel);
    }
  } catch (err) {
    console.error('Failed to fetch models:', err);
    availableModels.value = DEFAULT_LANG_MODELS[props.lang] || [];
  } finally {
    modelsLoading.value = false;
  }
};

const handleModelChange = (modelName) => {
  if (modelName !== selectedModel.value) {
    selectedModel.value = modelName;

    if (modelName === "None") {
      if (worker.value) {
        worker.value.terminate();
        worker.value = null;
      }
      status.value = "idle";
      voices.value = null;
      chunks.value = [];
      result.value = null;
      lastGeneration.value = null;
      isPlaying.value = false;
      currentChunkIndex.value = -1;
    } else {
      restartWorker(modelName);
    }
  }
};

const onMessageReceived = ({ data }) => {
  switch (data.status) {
    case "start":
      totalChunks.value = data.totalChunks;
      startTime.value = performance.now();
      elapsedTime.value = 0;
      remainingTime.value = null;
      completedChunksCount.value = 0;
      break;
    case "ready":
      if (worker.value?._progressInterval) {
        clearInterval(worker.value._progressInterval);
      }
      loadingProgress.value = 100;
      setTimeout(() => {
        status.value = "ready";
        loadingProgress.value = 0;
      }, 300);
      voices.value = data.voices;
      break;
    case "error":
      if (worker.value?._progressInterval) {
        clearInterval(worker.value._progressInterval);
      }
      loadingProgress.value = 0;
      status.value = "error";
      error.value = data.data;
      break;
    case "stream":
      chunks.value = [...chunks.value, data.chunk];
      completedChunksCount.value++;
      if (completedChunksCount.value > 0 && totalChunks.value > 0) {
        const elapsed = (performance.now() - startTime.value) / 1000;
        elapsedTime.value = elapsed;
        const avgTimePerChunk = elapsed / completedChunksCount.value;
        const remainingChunks = totalChunks.value - completedChunksCount.value;
        remainingTime.value = Math.max(0, Math.round(remainingChunks * avgTimePerChunk));
      }
      break;
    case "complete":
      status.value = "ready";
      result.value = data.audio;
      remainingTime.value = 0;
      if (data.audio && lastGeneration.value && selectedModel.value) {
        addEntry({
          text: lastGeneration.value.text,
          voice: lastGeneration.value.voice,
          speed: lastGeneration.value.speed,
          model: selectedModel.value,
          lang: props.lang,
          audio: data.audio,
        }).catch((err) => console.error('History save failed:', err));
      }
      break;
    case "preview":
      if (data.audio) {
        const audioUrl = URL.createObjectURL(data.audio);
        const audio = new Audio(audioUrl);
        audio.play().then(() => {
          setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
        }).catch(err => console.error('Error playing preview:', err));
      }
      break;
  }
};

const onErrorReceived = (e) => {
  console.error("Worker error:", e);
  error.value = e.message;
};

watch(() => props.lang, () => {
  text.value = defaultText[props.lang] || defaultText.en;
  selectedModel.value = "None";
  availableModels.value = [];
  if (worker.value) {
    worker.value.terminate();
    worker.value = null;
  }
  status.value = "idle";
  voices.value = null;
  chunks.value = [];
  result.value = null;
  lastGeneration.value = null;
  isPlaying.value = false;
  currentChunkIndex.value = -1;
  fetchModels();
}, { immediate: false });

onMounted(async () => {
  await checkLocalCliStatus();
  await fetchModels();
});

onUnmounted(() => {
  if (worker.value) {
    worker.value.terminate();
  }
});
</script>

<template>
  <div>
    <div class="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-gray-700/50 overflow-hidden">
      <div class="p-6 pb-0 space-y-6">
        <div class="space-y-4">
          <div class="relative">
            <textarea
              v-model="text"
              placeholder="Type or paste your text here..."
              class="w-full min-h-[180px] text-lg leading-relaxed resize-y p-4 pt-8 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-purple-500 dark:focus:border-purple-400 focus:ring-0 transition-colors"
              :class="voices ? '' : 'text-muted-foreground'"
            ></textarea>
            <button
              class="absolute top-1 right-3 h-10 w-10 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
              @click="handleCopy"
              :title="copied ? 'Copied!' : 'Copy text'"
            >
              <CheckIcon v-if="copied" class="h-4 w-4 text-green-500" />
              <CopyIcon v-else class="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div class="flex justify-end">
            <TextStatistics :text="text" />
          </div>
        </div>

        <div class="space-y-4">
          <div v-if="availableModels.length > 0" class="flex items-center flex-wrap gap-4">
            <div class="flex items-center">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">Model:</label>
              <ModelSelector
                :models="availableModels"
                :selected-model="selectedModel"
                @model-change="handleModelChange"
              />
            </div>
            
            <!-- Backend Selection Segmented Control -->
            <div class="flex items-center bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                class="px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer"
                :class="selectedBackend === 'local' 
                  ? 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'"
                :disabled="!isLocalCliAvailable"
                @click="selectedBackend = 'local'"
                :title="!isLocalCliAvailable ? 'Local CLI is not available' : 'Use local Python CLI engine'"
              >
                Local CLI (Fast)
              </button>
              <button
                type="button"
                class="px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer"
                :class="selectedBackend === 'wasm' 
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'"
                @click="selectedBackend = 'wasm'"
                title="Use browser WebAssembly engine"
              >
                WebAssembly (WASM)
              </button>
            </div>
          </div>

          <div v-if="modelsLoading" class="flex items-center gap-2 text-muted-foreground text-sm">
            <div class="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full"></div>
            <span>Loading available models...</span>
          </div>

          <div v-if="voices" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex items-center">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">Voice:</label>
              <VoiceSelector
                :voices="voices"
                :selected-voice="selectedVoice"
                @voice-change="setSelectedVoice"
                @voice-preview="handleVoicePreview"
              />
            </div>
            <div class="flex items-center">
              <SpeedControl
                :speed="speed"
                @speed-change="setSpeed"
              />
            </div>
          </div>

          <div v-else-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {{ error }}
          </div>
          <div v-else-if="selectedModel === 'None' && availableModels.length > 0" class="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm">
            Please select a model to start using TTS
          </div>
          <div v-else-if="availableModels.length === 0 && !modelsLoading" class="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-lg text-sm">
            No models available for this language. Add model files to <code class="text-xs">public/tts-model/{{ lang }}/</code> for local dev, or configure the API for production.
          </div>
          <div v-else-if="!voices && status === 'loading'" class="w-full flex items-center gap-3">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Loading model</span>
            <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300 ease-out flex items-center justify-end pr-2"
                :style="{ width: `${loadingProgress}%` }"
              >
                <span class="text-white text-xs font-semibold">{{ Math.round(loadingProgress) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Generation Progress and Time Estimation -->
        <div v-if="status === 'generating'" class="p-4 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-xl space-y-2 border border-purple-200/50 dark:border-purple-800/30">
          <div class="flex justify-between items-center text-sm font-medium">
            <span>Generating audio...</span>
            <span>{{ completedChunksCount }} / {{ totalChunks }} chunks</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              class="h-full bg-purple-500 transition-all duration-300 ease-out"
              :style="{ width: `${totalChunks > 0 ? (completedChunksCount / totalChunks) * 100 : 0}%` }"
            ></div>
          </div>
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Elapsed: {{ formatTime(elapsedTime) }}</span>
            <span>Estimated remaining: {{ formatTime(remainingTime) }}</span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3">
          <button
            class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="{
              'bg-gradient-to-r from-orange-500 to-orange-700 hover:from-orange-600 hover:to-orange-800 shadow-lg shadow-orange-500/25': isPlaying,
              'bg-blue-800 shadow-lg': !isPlaying
            }"
            @click="handlePlayPause"
            :disabled="(status === 'ready' && !isPlaying && !text) || (status !== 'ready' && chunks.length === 0)"
          >
            <PauseIcon v-if="isPlaying" class="w-5 h-5" />
            <PlayIcon v-else class="w-5 h-5" />
            <span v-if="isPlaying">Pause</span>
            <span v-else>{{ processed || status === 'generating' ? 'Play' : 'Generate' }}</span>
          </button>

          <button
            v-if="status === 'generating'"
            class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-500/25 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            @click="handleCancelGeneration"
          >
            <XIcon class="w-5 h-5" />
            <span>Cancel</span>
          </button>

          <button
            class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="downloadAudio"
            :disabled="status === 'generating' || status === 'loading' || chunks.length === 0"
          >
            <DownloadIcon class="w-4 h-4" />
            Download Audio
          </button>
        </div>

        <div class="w-0 h-0 hidden">
          <AudioChunk
            v-if="chunks.length > 0"
            v-for="(chunk, index) in chunks"
            :key="index"
            :audio="chunk.audio"
            :active="currentChunkIndex === index"
            :playing="isPlaying"
            class="hidden"
            @start="() => setCurrentChunkIndex(index)"
            @pause="() => { if (currentChunkIndex === index) setIsPlaying(false) }"
            @end="handleChunkEnd"
          />
        </div>
      </div>
    </div>
  </div>
</template>
