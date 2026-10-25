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
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
  },
});
