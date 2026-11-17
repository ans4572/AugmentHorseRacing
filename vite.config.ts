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
      },
      output: {
        // three.js 는 따로 묶는다. 게임 코드만 고쳐 다시 배포해도 이 덩어리(전체의 3/4)는 이름이 그대로라
        // 이미 받아 둔 사람은 다시 받지 않는다
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined)
      }
    }
  }
});
