/**
 * Last checked: 2025-03-02
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    open: true,
  },
});
