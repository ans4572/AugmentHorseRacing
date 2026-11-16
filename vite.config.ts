import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      // 게임 화면과 관리자 화면(/admin.html)을 함께 만든다
      input: {
        main: resolve(__dirname, 'client/index.html'),
        admin: resolve(__dirname, 'client/admin.html')
      }
    }
  }
});
