import http from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";

const PORT = process.env.PORT || 3001;

// ─── State ──────────────────────────────────────────────────────────────────
const rooms = {};
const clients = new Map();

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "SOT-" + Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms[code]);
  return code;
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  const msg = JSON.stringify({ type: "room_update", room });
  for (const [ws, info] of clients) {
    if (info.code === code && ws.readyState === 1) ws.send(msg);
  }
}

function broadcastRoomList() {
  const list = Object.values(rooms).filter(
    r => r.visibility === "public" && r.status !== "started" &&
      Date.now() - r.createdAt < 30 * 60 * 1000
  );
  const msg = JSON.stringify({ type: "room_list", rooms: list });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function assignRoles(count) {
  const pool = ["king"];
  const rebelCount = count >= 5 ? 2 : 1;
  for (let i = 0; i < rebelCount; i++) pool.push("rebel");
  if (count >= 4) pool.push("traitor");
  while (pool.length < count) pool.push("commoner");
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function handleLeave(ws) {
  const info = clients.get(ws);
  if (!info || !info.code) { clients.delete(ws); return; }
  const { code, playerIdx } = info;
  clients.delete(ws);
  const room = rooms[code];
  if (!room) return;

  if (playerIdx === 0) {
    console.log(`[${code}] Host left → closing room`);
    for (const [cws, cinfo] of clients) {
      if (cinfo.code === code) {
        send(cws, { type: "room_closed", reason: "host_left" });
        clients.set(cws, { code: null, playerIdx: -1 });
      }
    }
    delete rooms[code];
  } else {
    room.players = room.players
      .filter((_, i) => i !== playerIdx)
      .map((p, i) => ({ ...p, idx: i }));
    for (const [cws, cinfo] of clients) {
      if (cinfo.code === code && cinfo.playerIdx > playerIdx)
        cinfo.playerIdx -= 1;
    }
    broadcast(code);
  }
  broadcastRoomList();
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS สำคัญมากสำหรับ cross-origin WebSocket upgrade
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const { pathname } = parse(req.url || "/");

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok", rooms: Object.keys(rooms).length,
      clients: clients.size, uptime: Math.floor(process.uptime())
    }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>🏰 บัลลังก์เงา Server</title></head>
    <body style="font-family:monospace;background:#0d0b08;color:#c9a84c;padding:40px;text-align:center">
    <h1>🏰 บัลลังก์เงา — Game Server Online</h1>
    <p style="color:#e8d5b0">Rooms: ${Object.keys(rooms).length} | Clients: ${clients.size}</p>
    <p style="color:#4cc94c">✅ WebSocket รับที่ / และ /ws</p>
    </body></html>`);
});

// ─── WebSocket — รับทั้ง "/" (Cloudflare Tunnel) และ "/ws" (Vite proxy) ────
// นี่คือ BUG FIX หลัก: เดิม server.js ใช้ noServer:false กับ http server
// ทำให้ ws library bind เองและรับเฉพาะ path "/" โดย default
// แต่ Vite proxy ส่งมาที่ "/" หลังตัด prefix แล้ว ซึ่งควรทำงานได้
// ปัญหาจริงคือเมื่อ deploy ผ่าน Cloudflare WS path อาจไม่ตรง
// การ upgrade แบบ manual นี้แก้ได้ทั้งสองกรณี
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url || "/");
  // Accept: /ws (Vite dev proxy), / (Cloudflare Tunnel), /ws/ (trailing slash)
  if (pathname === "/ws" || pathname === "/" || pathname === "" || pathname === "/ws/") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    console.log(`Rejected WS upgrade for path: ${pathname}`);
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  clients.set(ws, { code: null, playerIdx: -1 });
  console.log(`[+] Client connected — total: ${wss.clients.size}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create_room") {
      const { playerName, maxPlayers, mode, visibility = "public" } = msg;
      const code = genCode();
      rooms[code] = {
        code, createdAt: Date.now(), status: "waiting",
        mode: mode || "standard",
        maxPlayers: Math.max(3, Math.min(6, maxPlayers || 4)),
        visibility, hostName: playerName,
        players: [{ name: playerName, class: "", idx: 0, ready: false, host: true }],
        rolesReady: [],
      };
      clients.set(ws, { code, playerIdx: 0 });
      send(ws, { type: "joined", playerIdx: 0, room: rooms[code] });
      console.log(`[${code}] Created by "${playerName}" (${visibility})`);
      broadcastRoomList();
    }

    if (msg.type === "join_room") {
      const { code, playerName } = msg;
      const room = rooms[code];
      if (!room) return send(ws, { type: "error", msg: "ไม่พบห้อง " + code });
      if (room.status === "started") return send(ws, { type: "error", msg: "เกมเริ่มไปแล้ว" });
      if (room.players.length >= room.maxPlayers) return send(ws, { type: "error", msg: "ห้องเต็มแล้ว" });
      const idx = room.players.length;
      room.players.push({ name: playerName, class: "", idx, ready: false, host: false });
      clients.set(ws, { code, playerIdx: idx });
      send(ws, { type: "joined", playerIdx: idx, room });
      broadcast(code);
      console.log(`[${code}] "${playerName}" joined (${idx})`);
      broadcastRoomList();
    }

    if (msg.type === "pick_class") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      if (room.players[info.playerIdx]) {
        room.players[info.playerIdx].class = msg.classId;
        broadcast(info.code);
      }
    }

    if (msg.type === "toggle_ready") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      const p = room.players[info.playerIdx];
      if (!p) return;
      if (!p.class) return send(ws, { type: "error", msg: "เลือกอาชีพก่อน" });
      p.ready = !p.ready;
      broadcast(info.code);
    }

    if (msg.type === "kick_player") {
      const info = clients.get(ws);
      if (!info?.code || info.playerIdx !== 0) return;
      const room = rooms[info.code];
      if (!room) return;
      const kickIdx = msg.playerIdx;
      for (const [cws, cinfo] of clients) {
        if (cinfo.code === info.code && cinfo.playerIdx === kickIdx) {
          send(cws, { type: "kicked" });
          clients.set(cws, { code: null, playerIdx: -1 });
          break;
        }
      }
      room.players = room.players.filter((_, i) => i !== kickIdx).map((p, i) => ({ ...p, idx: i }));
      for (const [cws, cinfo] of clients) {
        if (cinfo.code === info.code && cinfo.playerIdx > kickIdx) cinfo.playerIdx -= 1;
      }
      broadcast(info.code);
      broadcastRoomList();
    }

    if (msg.type === "start_game") {
      const info = clients.get(ws);
      if (!info?.code || info.playerIdx !== 0) return;
      const room = rooms[info.code];
      if (!room) return;
      if (room.players.length < 3) return send(ws, { type: "error", msg: "ต้องมีอย่างน้อย 3 คน" });
      const notReady = room.players.slice(1).filter(p => !p.ready);
      if (notReady.length > 0) return send(ws, { type: "error", msg: "รอทุกคนกดพร้อมก่อน" });
      room.roles = assignRoles(room.players.length);
      room.status = "started";
      room.startedAt = Date.now();
      room.rolesReady = [];
      broadcast(info.code);
      broadcastRoomList();
      console.log(`[${info.code}] Game started with ${room.players.length} players`);
    }

    if (msg.type === "role_confirmed") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.status !== "started") return;
      const playerName = room.players[info.playerIdx]?.name;
      if (playerName && !room.rolesReady.includes(playerName)) {
        room.rolesReady.push(playerName);
      }
      broadcast(info.code);
      if (room.rolesReady.length >= room.players.length) {
        const readyMsg = JSON.stringify({ type: "all_roles_ready" });
        for (const [cws, cinfo] of clients) {
          if (cinfo.code === info.code && cws.readyState === 1) cws.send(readyMsg);
        }
        console.log(`[${info.code}] All roles confirmed → game board opening`);
      }
    }

    if (msg.type === "list_rooms") {
      const list = Object.values(rooms).filter(
        r => r.visibility === "public" && r.status !== "started" &&
          Date.now() - r.createdAt < 30 * 60 * 1000
      );
      send(ws, { type: "room_list", rooms: list });
    }

    if (msg.type === "leave_room") {
      handleLeave(ws);
      clients.set(ws, { code: null, playerIdx: -1 });
    }
  });

  ws.on("close", () => {
    handleLeave(ws);
    console.log(`[-] Client disconnected — total: ${wss.clients.size}`);
  });

  ws.on("error", (err) => console.error("WS error:", err.message));
});

// ─── Cleanup stale rooms ───────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [code, room] of Object.entries(rooms)) {
    if (room.createdAt < cutoff) { delete rooms[code]; cleaned++; }
  }
  if (cleaned) console.log(`Cleaned ${cleaned} stale room(s)`);
}, 5 * 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🏰 Shadow of Throne Server v2`);
  console.log(`   Port:      ${PORT}`);
  console.log(`   WS paths:  / AND /ws (both accepted)`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`\n   📡 สำหรับเล่นข้ามอินเทอร์เน็ต:`);
  console.log(`   1. รัน: cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`   2. คัดลอก URL ที่ได้ (https://xxx.trycloudflare.com)`);
  console.log(`   3. ส่งลิงก์ให้เพื่อน: http://localhost:5173?server=xxx.trycloudflare.com\n`);
});
