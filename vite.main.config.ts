import { defineConfig } from 'vite';

// Main process bundle. Targets Node and externalizes native/CJS deps so they
// are required at runtime from node_modules rather than bundled.
// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'ssh2', 'systeminformation', 'electron-store'],
    },
  },
});
