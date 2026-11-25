import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5179,
    host: '127.0.0.1',
    strictPort: false
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1200
  }
});
