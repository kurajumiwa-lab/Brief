import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development every /api call (HTTP and WebSocket) is proxied to the
// FastAPI server, so the browser never needs CORS or a hard-coded host.
// In production the API serves the built `dist/` itself (see backend/app/main.py).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
