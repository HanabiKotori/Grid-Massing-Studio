import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: 'index.html',
        multiplayer: 'multiplayer.html',
      },
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
})
