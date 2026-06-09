import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    tailwindcss(), 
    vue(),
    {
      name: 'onnx-wasm-plugin',
      configureServer(server) {
        // Local development API middleware - only active in dev mode
        // This middleware intercepts /api requests and serves from local filesystem
        // In production, requests will pass through to Cloudflare Pages Functions
        server.middlewares.use('/api', async (req, res, next) => {
          const url = req.url || '';
          
          // Handle /api/tts-local/status endpoint to check if local backend is available
          if (url === '/tts-local/status' || url === '/tts-local/status/') {
            let isAvailable = false;
            try {
              const { execSync } = await import('child_process');
              const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
              execSync(`${pythonCmd} -c "import sys; sys.path = [p for p in sys.path if not p.endswith('bin')]; import piper; piper.PiperVoice"`, { stdio: 'ignore' });
              isAvailable = true;
            } catch (e) {
              isAvailable = false;
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ available: isAvailable, type: 'python-service' }));
            return;
          }

          // Handle /api/tts-local endpoint to run native Piper CLI
          if (url === '/tts-local' || url === '/tts-local/') {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            const bodyChunks = [];
            req.on('data', chunk => {
              bodyChunks.push(chunk);
            });

            req.on('end', async () => {
              let reqData;
              try {
                const body = Buffer.concat(bodyChunks).toString('utf-8');
                reqData = JSON.parse(body);
              } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
              }

              const { chunks = [], model, lang = 'vi', speakerId = 0, speed = 1.0, noiseScale = 0.667, noiseWScale = 0.8 } = reqData;

              if (!model) {
                res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Model name is required' }));
                return;
              }

              const modelsDir = path.join(__dirname, 'public', 'tts-model', lang);
              const modelPath = path.join(modelsDir, `${model}.onnx`);

              // Security check: ensure file is within models directory
              const resolvedPath = path.resolve(modelPath);
              const resolvedDir = path.resolve(modelsDir);
              if (!resolvedPath.startsWith(resolvedDir)) {
                res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Access denied' }));
                return;
              }

              if (!fs.existsSync(modelPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: `Model file not found: ${model}.onnx` }));
                return;
              }

              // Set headers for Event-Stream
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
              });

              // Spawn Piper python service
              const { spawn } = await import('child_process');
              const scriptPath = path.join(__dirname, 'bin', 'piper-service.py');
              
              const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
              const piperProcess = spawn(pythonCmd, [scriptPath, modelPath]);

              // Write JSON input to piper service
              piperProcess.stdin.write(JSON.stringify({
                chunks,
                speakerId,
                speed,
                noiseScale,
                noiseWScale
              }));
              piperProcess.stdin.end();

              let buffer = Buffer.alloc(0);
              let currentChunkIndex = 0;

              piperProcess.stdout.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);

                while (true) {
                  if (buffer.length < 4) {
                    break;
                  }

                  const length = buffer.readUInt32BE(0);
                  if (buffer.length < 4 + length) {
                    break;
                  }

                  const wavBytes = buffer.subarray(4, 4 + length);
                  buffer = buffer.subarray(4 + length);

                  const base64Audio = wavBytes.toString('base64');
                  const textVal = chunks[currentChunkIndex] || '';

                  res.write(`data: ${JSON.stringify({
                    status: 'stream',
                    index: currentChunkIndex,
                    text: textVal,
                    audio: base64Audio
                  })}\n\n`);

                  currentChunkIndex++;
                }
              });

              piperProcess.stderr.on('data', (data) => {
                console.error(`[Piper Service Stderr]: ${data.toString()}`);
              });

              piperProcess.on('close', (code) => {
                if (code !== 0) {
                  res.write(`data: ${JSON.stringify({
                    status: 'error',
                    data: `Piper process exited with code ${code}`
      })}\n\n`);
                } else {
                  res.write(`data: ${JSON.stringify({
                    status: 'complete'
                  })}\n\n`);
                }
                res.end();
              });

              req.on('close', () => {
                if (piperProcess.exitCode === null) {
                  console.log('Client closed request. Killing piper CLI process...');
                  piperProcess.kill();
                }
              });
            });
            return;
          }

          // Handle /api/models endpoint (Vietnamese models in tts-model/vi/)
          if (url === '/models' || url === '/models/') {
            try {
              const modelsDir = path.join(__dirname, 'public', 'tts-model', 'vi');

              if (!fs.existsSync(modelsDir)) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ models: [] }));
                return;
              }

              const files = fs.readdirSync(modelsDir);
              const models = files
                .filter(file => file.endsWith('.onnx.json'))
                .map(file => file.replace('.onnx.json', ''))
                .filter(name => name.length > 0)
                .sort();

              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ models }));
            } catch (error) {
              console.error('Error listing local models:', error);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Failed to list models', message: error.message }));
            }
            return;
          }

          // Handle /api/piper/[lang]/models - list models for a language (i18n pages)
          const piperModelsMatch = url.match(/^\/piper\/([^/]+)\/models\/?$/);
          if (piperModelsMatch) {
            try {
              const lang = piperModelsMatch[1];
              const modelsDir = path.join(__dirname, 'public', 'tts-model', lang);
              if (!fs.existsSync(modelsDir)) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ models: [] }));
                return;
              }
              const files = fs.readdirSync(modelsDir);
              const models = files
                .filter(file => file.endsWith('.onnx.json'))
                .map(file => file.replace('.onnx.json', ''))
                .filter(name => name.length > 0)
                .sort();
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ models }));
            } catch (err) {
              console.error('Error listing piper lang models:', err);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Failed to list models', message: err.message }));
            }
            return;
          }

          // Handle /api/model/[name] endpoint (Vietnamese models in tts-model/vi/)
          const modelMatch = url.match(/^\/model\/(.+)$/);
          if (modelMatch) {
            try {
              const fileName = decodeURIComponent(modelMatch[1]);
              const modelsDir = path.join(__dirname, 'public', 'tts-model', 'vi');
              const filePath = path.join(modelsDir, fileName);

              // Security check: ensure file is within models directory
              const resolvedPath = path.resolve(filePath);
              const resolvedDir = path.resolve(modelsDir);
              if (!resolvedPath.startsWith(resolvedDir)) {
                res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Access denied' }));
                return;
              }

              // Check if file exists
              if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Model file not found' }));
                return;
              }

              // Determine content type
              let contentType = 'application/octet-stream';
              if (fileName.endsWith('.json')) {
                contentType = 'application/json';
              } else if (fileName.endsWith('.onnx')) {
                contentType = 'application/octet-stream';
              }

              // Read and serve file
              const fileStats = fs.statSync(filePath);
              const fileContent = fs.readFileSync(filePath);

              res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': fileStats.size.toString(),
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000, immutable',
              });
              res.end(fileContent);
            } catch (error) {
              console.error('Error serving model file:', error);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Failed to serve model file', message: error.message }));
            }
            return;
          }

          // Handle /api/asr/models - list ASR model folders (public/asr-model/)
          if (url === '/asr/models' || url === '/asr/models/') {
            try {
              const asrModelDir = path.join(__dirname, 'public', 'asr-model');
              if (!fs.existsSync(asrModelDir)) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ models: [] }));
                return;
              }
              const entries = fs.readdirSync(asrModelDir, { withFileTypes: true });
              const models = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ models }));
            } catch (err) {
              console.error('Error listing ASR models:', err);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Failed to list ASR models', message: err.message }));
            }
            return;
          }

          // Handle /api/model/asr/[model]/[name] - serve ASR model file from public/asr-model/[model]/
          const asrModelMatch = url.match(/^\/model\/asr\/([^/]+)\/([^/]+)\/?$/);
          if (asrModelMatch) {
            try {
              const modelDir = path.join(__dirname, 'public', 'asr-model', asrModelMatch[1]);
              const fileName = decodeURIComponent(asrModelMatch[2]);
              const filePath = path.join(modelDir, fileName);
              const resolvedPath = path.resolve(filePath);
              const resolvedDir = path.resolve(modelDir);
              if (!resolvedPath.startsWith(resolvedDir)) {
                res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Access denied' }));
                return;
              }
              if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Model file not found' }));
                return;
              }
              let contentType = 'application/octet-stream';
              if (fileName.endsWith('.json')) contentType = 'application/json';
              if (fileName.endsWith('.js')) contentType = 'application/javascript';
              const fileStats = fs.statSync(filePath);
              const fileContent = fs.readFileSync(filePath);
              res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': fileStats.size.toString(),
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000, immutable',
              });
              res.end(fileContent);
            } catch (error) {
              console.error('Error serving ASR model file:', error);
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: 'Failed to serve model file', message: error.message }));
            }
            return;
          }

          // If no match, pass through (for production/Cloudflare Pages Functions)
          next();
        });

        server.middlewares.use('/onnx-runtime', (req, res, next) => {
          // Strip ?import parameter from ONNX requests
          if (req.url.includes('?import')) {
            req.url = req.url.replace('?import', '');
          }
          if (req.url.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Access-Control-Allow-Origin', '*');
          }
          next();
        });
        
        // Add caching for model files
        server.middlewares.use('/tts-model', (req, res, next) => {
          // Cache model files for 7 days (604800 seconds)
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          res.setHeader('ETag', `"model-v1"`);
          next();
        });
      }
    }
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: { format: "es" },
  build: {
    target: "esnext",
  },
  assetsInclude: ['**/*.wasm'],
  logLevel: "info",
});