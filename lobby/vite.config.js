import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // ใช้ base แบบ "relative" (./) ตอน build → ทำงานได้ทุกที่ไม่ว่าเสิร์ฟที่รากหรือ subpath:
  //   • Render Static (shadow-of-throne.onrender.com/)  → assets resolve เป็น /assets/...
  //   • GitHub Pages (.../shadow-of-throne/)             → assets resolve เป็น /shadow-of-throne/assets/...
  // (แอปนี้ไม่มี client-side routing แบบ nested path → relative base ปลอดภัย)
  // ตอน dev (vite --host) ใช้ '/' ปกติ
  base: command === 'build' ? './' : '/',
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