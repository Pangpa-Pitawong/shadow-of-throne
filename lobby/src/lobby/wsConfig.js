// ─── CONFIG: Dynamic WebSocket URL ───────────────────────────────────────────
// Priority: 1) ?server= query param  2) localStorage  3) same-host /ws
function getWsUrl() {
  try {
    // ✅ FIX 1: รองรับ ?server=xxx.trycloudflare.com ใน URL
    // เพื่อนคลิกลิงก์จาก host แล้ว connect server ได้ทันที
    const params = new URLSearchParams(window.location.search);
    const serverParam = params.get("server");
    if (serverParam) {
      // ถ้า host ส่ง ?server=xxxx.trycloudflare.com → แปลงเป็น wss://
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = serverParam.startsWith("ws") ? serverParam
        : `${proto}//${serverParam}`;
      // บันทึกลง localStorage ด้วยเพื่อไม่ต้องส่ง query ซ้ำ
      try { localStorage.setItem("sot_ws_url", url); } catch { /* ignore */ }
      return url;
    }
  } catch { /* ignore */ }
  try {
    const saved = localStorage.getItem("sot_ws_url");
    if (saved && saved.startsWith("ws")) return saved;
  } catch { /* ignore */ }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;

  // ✅ FIX: รันบนเครื่อง/LAN → เชื่อมต่อ WS server ในเครื่องเดียวกัน (port 3001)
  //    host รัน server.js + vite, เพื่อนเปิด http://<ip>:5173 แล้ว WS ไป ws://<ip>:3001
  const isLocal =
    host === "localhost" || host === "127.0.0.1" ||
    /^192\.168\./.test(host) || /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host);
  if (isLocal) return `${protocol}//${host}:3001`;

  // production fallback (เซิร์ฟเวอร์บนคลาวด์)
  return "wss://sot-server-0te4.onrender.com";
}

export const WS_URL = getWsUrl();
