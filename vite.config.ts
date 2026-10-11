import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-прокси на rivetd: CORS не нужен (design build-web-console).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8181', changeOrigin: false },
    },
  },
})
