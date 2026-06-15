import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages เสิร์ฟที่ https://<user>.github.io/sot-server/ → base ต้องเป็น /sot-server/
  // ตอน dev (vite --host) ใช้ '/' ปกติ
  base: command === 'build' ? '/sot-server/' : '/',
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