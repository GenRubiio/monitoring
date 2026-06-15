import { defineConfig } from 'vite';

// Keep runtime dependencies external. Forge includes them in the packaged
// app through the custom packager ignore rule in forge.config.ts.
// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'ssh2', 'systeminformation', 'electron-store'],
    },
  },
});
