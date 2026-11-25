import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      // 本地开发与生产保持同一套同源 /api 路径
      '/api': {
        target: 'http://127.0.0.1:3020',
        changeOrigin: true,
      },
      // 多人 WebSocket 与生产一致走 dataService 的 /ws
      '/ws': {
        target: 'ws://127.0.0.1:3020',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
})
