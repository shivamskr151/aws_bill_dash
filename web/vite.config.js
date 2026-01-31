import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Frontend calls `/api/*` → forwarded to backend server
      '/api': 'http://localhost:8787',
    },
  },
})
