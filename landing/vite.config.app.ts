import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Narrower build for the pip-packaged local app: only the workspace (app.html)
// and the first-run tour (get-started.html) — no marketing pages. Used by
// scripts/build-pypi-bundle.mjs. The regular `npm run build` (vite.config.ts)
// still builds the full marketing site + app for the hosted deployment.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist-app',
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
        'get-started': fileURLToPath(new URL('./get-started.html', import.meta.url)),
      },
    },
  },
})
