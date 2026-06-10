import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Multi-page build: the marketing home (index.html), the dedicated features
// page (features.html), the download / coming-soon page (download.html), and
// the get-started / sign-in flow (get-started.html) are separate entry points
// that share the same React components and design tokens.
//
// In dev, /api is proxied to the Express auth server (server/index.ts) so the
// browser sees a single origin and cookies stay first-party.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        features: fileURLToPath(new URL('./features.html', import.meta.url)),
        download: fileURLToPath(new URL('./download.html', import.meta.url)),
        'get-started': fileURLToPath(new URL('./get-started.html', import.meta.url)),
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
      },
    },
  },
})
