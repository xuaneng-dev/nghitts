import sys
import json
import wave
import io
import os
import traceback

try:
    import piper
except ImportError:
    # Try adding typical user site-packages path to sys.path if not found
    import site
    site_packages = site.getusersitepackages()
    if site_packages not in sys.path:
        sys.path.append(site_packages)
    import piper

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 piper-service.py <model_path>", file=sys.stderr)
        sys.exit(1)
        
    model_path = sys.argv[1]
    
    # Check if model path exists
    if not os.path.exists(model_path):
        print(f"Model path not found: {model_path}", file=sys.stderr)
        sys.exit(1)
        
    # Check if CUDA (GPU acceleration) is available in ONNX Runtime
    use_cuda = False
    try:
        import onnxruntime as ort
        if "CUDAExecutionProvider" in ort.get_available_providers():
            use_cuda = True
            print("CUDA Execution Provider detected. Enabling GPU acceleration!", file=sys.stderr)
    except Exception as e:
        print(f"Notice: Could not check for CUDA availability ({e}). Using default settings.", file=sys.stderr)

    # Load voice
    try:
        voice = piper.PiperVoice.load(model_path, use_cuda=use_cuda)
    except Exception as e:
        if use_cuda:
            print(f"Warning: Failed to load with CUDA ({e}). Falling back to CPU...", file=sys.stderr)
            try:
                voice = piper.PiperVoice.load(model_path, use_cuda=False)
            except Exception as e_cpu:
                print(f"Error loading voice model on CPU: {e_cpu}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Error loading voice model: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)
        
    # Read the JSON payload from stdin
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print("No input data received", file=sys.stderr)
            sys.exit(1)
        req = json.loads(input_data)
    except Exception as e:
        print(f"Error parsing input JSON: {e}", file=sys.stderr)
        sys.exit(1)
        
    chunks = req.get("chunks", [])
    speaker_id = req.get("speakerId")
    # speed is frontend param (e.g. 1.0, 1.25)
    speed = req.get("speed", 1.0)
    length_scale = 1.0 / speed if speed > 0 else 1.0
    
    noise_scale = req.get("noiseScale", 0.667)
    noise_w_scale = req.get("noiseWScale", 0.8)
    
    config = piper.SynthesisConfig(
        speaker_id=speaker_id,
        length_scale=length_scale,
        noise_scale=noise_scale,
        noise_w_scale=noise_w_scale,
    )
    
    for idx, text in enumerate(chunks):
        text_str = text.strip()
        if not text_str:
            # Send empty WAV for empty text
            wav_bytes = b''
        else:
            try:
                wav_io = io.BytesIO()
                with wave.open(wav_io, "wb") as wav_file:
                    voice.synthesize_wav(text_str, wav_file, syn_config=config)
                wav_bytes = wav_io.getvalue()
            except Exception as e:
                print(f"Error synthesizing chunk {idx} ('{text_str}'): {e}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                wav_bytes = b''
        
        # Write length prefix (4 bytes big-endian) + WAV bytes
        sys.stdout.buffer.write(len(wav_bytes).to_bytes(4, byteorder='big'))
        sys.stdout.buffer.write(wav_bytes)
        sys.stdout.buffer.flush()

if __name__ == "__main__":
    main()
