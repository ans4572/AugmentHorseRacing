import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  }
});
