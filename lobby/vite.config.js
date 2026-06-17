import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages เสิร์ฟที่ https://<user>.github.io/shadow-of-throne/ → base ต้องเป็น /shadow-of-throne/
  // ตอน dev (vite --host) ใช้ '/' ปกติ
  base: command === 'build' ? '/shadow-of-throne/' : '/',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // ✅ Proxy /ws → WebSocket Server ที่รันอยู่บน port 3001
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
}))