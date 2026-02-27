/**
 * Last checked: 2025-03-02
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Electron app — no CDN, so large bundles are acceptable
    chunkSizeWarningLimit: 2000,
  },
  css: {
    postcss: './postcss.config.js',
  },
  resolve: {
    alias: {
      '@': '/src',
      // Use the browser-safe SVGO bundle (no Node fs/os/path dependencies)
      'svgo': 'svgo/dist/svgo.browser.js',
    },
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    open: true,
    proxy: {
      // In dev, proxy /api requests to the Electron Express sidecar on port 3002
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
