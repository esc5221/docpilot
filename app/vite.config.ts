import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed dev port and no clearing of the screen.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@docpilot/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
