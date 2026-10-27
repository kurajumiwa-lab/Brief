import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// A standalone prototype: no API, no database, no build step shared with the
// Brief app. State lives in localStorage (see src/lib/storage.js) so the
// prototype behaves like a real product across reloads without pretending to
// have a server it does not have.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5180,
    host: "0.0.0.0",
    allowedHosts: true,
    // In live mode the prototype calls `/api/social/*` on the same origin. In
    // development that path is proxied to the FastAPI app, which means the
    // browser never needs CORS and the deployed rewrite in vercel.json does the
    // same job in production.
    proxy: {
      "/api": {
        target: process.env.CAESAR_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
  },
});
