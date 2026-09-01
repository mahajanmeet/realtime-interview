import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
  },

  renderer: {
    plugins: [react()],
    build: {
      // Keep AudioWorklet modules as same-origin files so the strict CSP does
      // not need to allow executable data URLs.
      assetsInlineLimit: 0,
    },
  },
});
