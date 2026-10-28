import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // @edge-tts/universal's "./browser" barrel re-exports a type-only name
      // (BrowserCommunicateOptions) as a value, which breaks the Rollup
      // build. Alias straight to the real module that holds the EdgeTTS
      // class; its own relative imports are all genuine runtime modules.
      'edge-tts-browser-simple': path.join(root, 'node_modules/@edge-tts/universal/src/browser-simple.js'),
    },
  },
  // Static hosting (Vercel) serves dist/ directly; no server code in v1.
  build: {
    target: 'es2020',
    // kokoro-js pulls in @huggingface/transformers + onnxruntime-web, which
    // is a large bundle. The warning threshold is raised on purpose; the
    // voice engines are lazy-loaded with dynamic import() at runtime.
    chunkSizeWarningLimit: 3000,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
});
