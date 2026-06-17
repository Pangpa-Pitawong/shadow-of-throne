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

// ─── HEALTH/WARM URL — ใช้ "ปลุก" เซิร์ฟเวอร์ก่อนต่อ WebSocket ─────────────────
//   Render free tier หลับหลังไม่มีคนใช้ ~15 นาที → ตื่นด้วย request ขาเข้า ใช้เวลา
//   ~15-30 วินาที (cold start). ระหว่างนั้น WebSocket จะต่อไม่ติด เกมดูเหมือนพัง
//   ทางแก้: ยิง HTTP GET /health ก่อน/ระหว่างพยายามต่อ WS เพื่อปลุก instance
//   แล้วค่อยต่อ WS เมื่อ server ตื่นแล้ว (โดยเฉพาะเพื่อนที่อยู่คนละเน็ต)
function deriveHealthUrl(wsUrl) {
  try {
    const httpProto = wsUrl.startsWith("wss:") ? "https:" : "http:";
    // wss://host[/path] → https://host  (ตัด path เช่น /ws ออก แล้วต่อ /health)
    const noProto = wsUrl.replace(/^wss?:\/\//, "");
    const host = noProto.replace(/\/.*$/, ""); // เก็บแค่ host[:port]
    return `${httpProto}//${host}/health`;
  } catch {
    return null;
  }
}
export const HEALTH_URL = deriveHealthUrl(WS_URL);

// ปลุกเซิร์ฟเวอร์ (no-op ถ้าเป็น local). คืน Promise ที่ resolve เมื่อ server ตอบ
//   ใช้ no-cors + cache:no-store เพื่อให้ request ออกแน่ๆ (ไม่สน CORS เพราะแค่ต้องการ "ปลุก")
export function warmServer() {
  if (!HEALTH_URL) return Promise.resolve(false);
  return fetch(HEALTH_URL, { mode: "no-cors", cache: "no-store" })
    .then(() => true)
    .catch(() => false);
}
