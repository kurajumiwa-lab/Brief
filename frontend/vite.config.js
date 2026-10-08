/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The browser only ever talks to its own origin:
//   dev   → Vite proxies /api (HTTP + WebSocket) to the FastAPI server
//   prod  → FastAPI serves dist/ itself (backend/app/main.py), or nginx proxies /api
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target: env.VITE_API_URL || "http://localhost:8000",
          changeOrigin: true,
          ws: true, // /api/chat/{room}/ws rides the same proxy
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            motion: ["framer-motion"],
            // Leaflet is ~150 kB and only the map needs it: its own chunk keeps
            // it out of the first paint and cacheable across deploys.
            leaflet: ["leaflet"],
            vendor: ["axios", "zustand", "date-fns", "react-hot-toast", "react-dropzone", "clsx"],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.js"],
    },
  };
});
