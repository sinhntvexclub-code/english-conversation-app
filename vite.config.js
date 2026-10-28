import { defineConfig } from 'vite';

export default defineConfig({
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
