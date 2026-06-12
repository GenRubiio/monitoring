import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer bundle. React 18 via @vitejs/plugin-react.
// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
});
