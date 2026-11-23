/**
 * Last checked: 2025-03-02
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.SVGX_PORT || 3001);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: {
    // Potrace is first loaded inside the module worker. Pre-bundling it keeps
    // Vite from forcing a full-page reload when the first conversion starts.
    include: ["@cadit-app/potrace-ts", "slugify", "svgo"],
  },
  build: {
    // Electron app — no CDN, so large bundles are acceptable
    chunkSizeWarningLimit: 2000,
  },
  css: {
    postcss: "./postcss.config.js",
  },
  resolve: {
    alias: {
      "@": "/src",
      // Use the browser-safe SVGO bundle (no Node fs/os/path dependencies)
      svgo: "svgo/browser",
    },
  },
  server: {
    port,
    host:
      process.env.SVGX_HOST ||
      (process.env.SVGX_LAN === "1" ? "::" : "127.0.0.1"),
    open: process.env.CI !== "1",
    proxy:
      process.env.VITE_SVGX_DESKTOP_DEV === "1"
        ? { "/api": { target: `http://127.0.0.1:${port + 1}` } }
        : undefined,
  },
});
