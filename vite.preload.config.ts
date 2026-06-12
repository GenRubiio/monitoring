import { defineConfig } from 'vite';

// Preload bundle. Built as CJS, externalizing electron so the contextBridge
// and ipcRenderer come from the runtime.
// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
      output: {
        // Distinct from the main bundle (also named index.js) to avoid a
        // collision in .vite/build/.
        entryFileNames: 'preload.js',
      },
    },
  },
});
