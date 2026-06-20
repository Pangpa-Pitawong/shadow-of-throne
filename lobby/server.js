import http from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";
import { rooms, clients } from "./src/game/server/state.js";
import { sanitizeMapConfig, MAP_SIZES } from "./src/game/server/mapConfig.js";
import {
  send, broadcast, broadcastRoomList, redactRoomFor, redactGameStateFor,
} from "./src/game/server/net.js";
import { createInitialGameState, resolveTraitorOffer } from "./src/game/server/engine.js";
import { handleGameAction, handleLeave } from "./src/game/server/handlers.js";

const PORT = process.env.PORT || 3001;

// This file is the server entry point: HTTP + WebSocket lifecycle + lobby
// message routing (create/join/rejoin/pick/ready/start/…). The game logic lives
// in src/game/server/: engine.js (combat/turn/events/mapgen), handlers.js
// (in-game actions), net.js, constants.js, hex.js, mapConfig.js, util.js, state.js.

// ─── Lobby helpers ────────────────────────────────────────────────────────────
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

// ─── ชื่อผู้เล่นต้องไม่ซ้ำกันในห้องเดียวกัน ───────────────────────────────────
//   ตัวตนของ client ทั้งฝั่ง server (rolesReady/charReady) และฝั่ง client
//   (หา "ตัวเอง" ด้วยชื่อ) อิงกับชื่อ — ถ้าซ้ำจะสับสนบทบาท/ตัวละคร
//   จึงเติม " (2)", " (3)" ให้ชื่อที่ซ้ำตอนเข้าห้อง
function uniqueName(room, desired) {
  const base = (desired ?? "").toString().trim().slice(0, 16) || "ผู้เล่น";
  const taken = new Set((room?.players || []).map(p => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

function assignRoles(count) {
  // ทรยศ (traitor) ไม่ถูกแจกตั้งแต่ต้น — เกิด dynamic เมื่อราชาตาย
  const pool = ["king"];
  const rebelCount = count >= 7 ? 3 : count >= 5 ? 2 : 1;
  for (let i = 0; i < rebelCount; i++) pool.push("rebel");
  while (pool.length < count) pool.push("commoner");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const { pathname } = parse(req.url || "/");
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: Object.keys(rooms).length, clients: clients.size, uptime: Math.floor(process.uptime()) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>🏰 บัลลังก์เงา Server</title></head>
    <body style="font-family:monospace;background:#0d0b08;color:#c9a84c;padding:40px;text-align:center">
    <h1>🏰 บัลลังก์เงา — Game Server Online</h1>
    <p style="color:#e8d5b0">Rooms: ${Object.keys(rooms).length} | Clients: ${clients.size}</p>
    <p style="color:#4cc94c">✅ WebSocket รับที่ / และ /ws</p></body></html>`);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => { wss.emit("connection", ws, req); });
});

const PING_INTERVAL = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false; ws.ping();
  });
}, 25000);
wss.on("close", () => clearInterval(PING_INTERVAL));

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  clients.set(ws, { code: null, playerIdx: -1 });
  console.log(`[+] Client connected — total: ${wss.clients.size}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create_room") {
      const { playerName, maxPlayers, mode, visibility = "public", mapConfig } = msg;
      const code = genCode();
      const hostName = uniqueName(null, playerName); // trim/clamp + fallback ชื่อว่าง
      rooms[code] = {
        code, createdAt: Date.now(), status: "waiting",
        mode: mode || "standard",
        maxPlayers: Math.max(3, Math.min(8, maxPlayers || 4)),
        visibility, hostName,
        mapConfig: sanitizeMapConfig(mapConfig),
        players: [{ name: hostName, class: "", idx: 0, ready: false, host: true }],
        rolesReady: [], gameState: null,
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
      const name = uniqueName(room, playerName); // กันชื่อซ้ำในห้อง → ตัวตนไม่สับสน
      room.players.push({ name, class: "", idx, ready: false, host: false });
      clients.set(ws, { code, playerIdx: idx });
      send(ws, { type: "joined", playerIdx: idx, room });
      broadcast(code);
      console.log(`[${code}] "${playerName}" joined (${idx})`);
      broadcastRoomList();
    }

    // ── REJOIN: กลับเข้าห้องเดิมหลังรีเฟรช/เน็ตหลุด (อิงชื่อ + รหัสห้องจาก localStorage) ──
    //   • ถ้ายังมีสล็อตชื่อนี้อยู่ → ผูก connection นี้กลับเข้าสล็อตเดิม (ได้ทั้งกลางเกม)
    //   • ถ้าหลุดไปแล้วและห้องยังอยู่ในล็อบบี้ → เพิ่มกลับเข้าห้อง
    //   • ถ้าห้องหาย/เกมเริ่มแล้วแต่ไม่มีสล็อต → rejoin_failed (client ล้าง session กลับหน้าแรก)
    if (msg.type === "rejoin_room") {
      const { code, playerName } = msg;
      const room = rooms[code];
      if (!room) return send(ws, { type: "rejoin_failed", reason: "no_room" });
      let idx = room.players.findIndex(p => p.name === playerName);
      if (idx < 0) {
        if (room.status === "started" || room.gameState)
          return send(ws, { type: "rejoin_failed", reason: "game_started" });
        if (room.players.length >= room.maxPlayers)
          return send(ws, { type: "rejoin_failed", reason: "full" });
        idx = room.players.length;
        room.players.push({ name: uniqueName(room, playerName), class: "", idx, ready: false, host: false });
      }
      clients.set(ws, { code, playerIdx: idx });
      send(ws, { type: "joined", playerIdx: idx, room: redactRoomFor(room, idx), rejoined: true });
      if (room.gameState) send(ws, { type: "game_state", gameState: redactGameStateFor(room.gameState, idx) });
      broadcast(code);
      broadcastRoomList();
      console.log(`[${code}] "${playerName}" rejoined (${idx})`);
    }

    if (msg.type === "pick_class" || msg.type === "pick_character") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      // เลือกตัวละครได้เฉพาะช่วง "เลือกตัวละคร" (หลังสุ่มบทบาทแล้ว)
      if (room.phase !== "charselect") return send(ws, { type: "error", msg: "ยังไม่ถึงขั้นเลือกตัวละคร" });
      const me = room.players[info.playerIdx];
      if (!me) return;
      const charId = msg.charId || msg.classId;
      const charReady = room.charReady || (room.charReady = []);
      // ── พระราชาต้อง "กดยืนยัน" ตัวละครก่อน คนอื่นจึงเลือกได้ ──
      const kingIdx = (room.roles || []).indexOf("king");
      const kingName = kingIdx >= 0 ? room.players[kingIdx]?.name : null;
      const kingConfirmed = kingName != null && charReady.includes(kingName);
      if (info.playerIdx !== kingIdx && !kingConfirmed)
        return send(ws, { type: "error", msg: "👑 รอพระราชายืนยันตัวละครก่อน" });
      // ล็อกเฉพาะตัวที่ "ถูกยืนยันแล้ว" — ใครยืนยันก่อนได้ตัวนั้นไป (ระหว่างยังไม่ยืนยัน เล็งซ้ำกันได้)
      const confirmedTaken = room.players.some(
        (p, i) => p && i !== info.playerIdx && (p.charId === charId) && charReady.includes(p.name)
      );
      if (confirmedTaken) return send(ws, { type: "error", msg: "ตัวละครนี้ถูกยืนยันไปแล้ว — เลือกตัวอื่น" });
      me.charId = charId;
      me.class = charId; // compat
      // เปลี่ยนตัวละคร → ยกเลิกการยืนยันเดิม
      room.charReady = charReady.filter(n => n !== me.name);
      broadcast(info.code);
    }

    // ── ยืนยันตัวละคร (ในขั้นเลือกตัวละคร) ──────────────────────────────────────
    if (msg.type === "confirm_character") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.phase !== "charselect") return;
      const me = room.players[info.playerIdx];
      if (!me || !me.charId) return send(ws, { type: "error", msg: "เลือกตัวละครก่อน" });
      room.charReady = room.charReady || [];
      // ── race: ถ้ามีคนยืนยันตัวละครเดียวกันไปก่อนแล้ว → ปฏิเสธ + ล้างตัวเลือกให้เลือกใหม่ ──
      const conflict = room.players.some(
        (p, i) => p && i !== info.playerIdx && p.charId === me.charId && room.charReady.includes(p.name)
      );
      if (conflict) {
        delete me.charId; me.class = "";
        room.charReady = room.charReady.filter(n => n !== me.name);
        broadcast(info.code);
        return send(ws, { type: "error", msg: "ช้าไป! ตัวละครนี้เพิ่งถูกยืนยัน — เลือกตัวใหม่" });
      }
      if (!room.charReady.includes(me.name)) room.charReady.push(me.name);
      broadcast(info.code);
      // ทุกคนเลือก + ยืนยันครบ → สร้าง gameState แล้วเข้าเกม
      const allPicked = room.players.every(p => !!p.charId);
      if (allPicked && room.charReady.length >= room.players.length) {
        room.phase = "playing";
        room.gameState = createInitialGameState(room);
        room.gameState._code = info.code; // ใช้ใน startTraitorOffer
        for (const [cws, cinfo] of clients) {
          if (cinfo.code === info.code && cws.readyState === 1) {
            const snapshot = redactGameStateFor(room.gameState, cinfo.playerIdx);
            cws.send(JSON.stringify({ type: "all_roles_ready", gameState: snapshot }));
          }
        }
        console.log(`[${info.code}] All characters confirmed → game starting`);
      }
    }

    if (msg.type === "toggle_ready") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      const p = room.players[info.playerIdx];
      if (!p) return;
      // ล็อบบี้: กดพร้อมได้เลย (เลือกตัวละครย้ายไปหลังสุ่มบทบาท)
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
      for (const [, cinfo] of clients) {
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
      // ── สุ่มบทบาทก่อน (ยังไม่สร้าง gameState — รอเลือกตัวละครหลังเปิดบทบาท) ──
      room.roles = assignRoles(room.players.length);
      room.status = "started";
      room.phase = "roles";
      room.startedAt = Date.now();
      room.rolesReady = [];
      room.charReady = [];
      // ล้างตัวละครที่อาจค้างจากรอบก่อน — เริ่มเลือกใหม่หลังเปิดบทบาท
      room.players.forEach(p => { delete p.charId; p.class = ""; });
      room.gameState = null;
      broadcast(info.code);
      broadcastRoomList();
      console.log(`[${info.code}] Roles assigned → role reveal phase`);
    }

    if (msg.type === "role_confirmed") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.status !== "started") return;
      if (!room.rolesReady.includes(msg.playerName)) room.rolesReady.push(msg.playerName);
      // ทุกคนยืนยันบทบาท → เข้าสู่ขั้น "เลือกตัวละคร" (พระราชาเลือกก่อน)
      if (room.phase === "roles" && room.rolesReady.length >= room.players.length) {
        room.phase = "charselect";
        room.charReady = [];
        console.log(`[${info.code}] All roles confirmed → character select phase`);
      }
      broadcast(info.code);
    }

    if (msg.type === "traitor_response") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room?.gameState?.traitorOfferPending) return;
      const gs = room.gameState;
      if (info.playerIdx !== gs.traitorOfferTarget) return; // ไม่ใช่คนที่ได้รับ offer
      resolveTraitorOffer(gs, info.code, msg.accepted === true, info.playerIdx);
    }

    if (msg.type === "list_rooms") {
      const list = Object.values(rooms).filter(
        r => r.visibility === "public" && r.status !== "started" && Date.now() - r.createdAt < 30 * 60 * 1000
      );
      send(ws, { type: "room_list", rooms: list });
    }

    if (msg.type === "leave_room") {
      handleLeave(ws);
      clients.set(ws, { code: null, playerIdx: -1 });
    }

    if (msg.type === "game_action") handleGameAction(ws, msg);

    if (msg.type === "request_game_state") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (room?.gameState) {
        const snapshot = redactGameStateFor(room.gameState, info.playerIdx);
        send(ws, { type: "game_state", gameState: snapshot });
      }
    }
  });

  ws.on("close", () => { handleLeave(ws); console.log(`[-] Client disconnected — total: ${wss.clients.size}`); });
  ws.on("error", (err) => console.error("WS error:", err.message));
});

// ─── Cleanup stale rooms ────────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [code, room] of Object.entries(rooms)) {
    if (room.createdAt < cutoff) { delete rooms[code]; cleaned++; }
  }
  if (cleaned) console.log(`Cleaned ${cleaned} stale room(s)`);
}, 5 * 60 * 1000);

// SOT_TEST=1 → import โมดูลเพื่อทดสอบฟังก์ชันโดยไม่เปิดพอร์ต/keep-alive
if (!process.env.SOT_TEST) {
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🏰 Shadow of Throne Server v5`);
  console.log(`   Port:      ${PORT}`);
  console.log(`   Features:  move=3, hand=HP-limit, dodge-dice, equipment-range, 8-phase, boss-mode, hidden-roles, fog, side-quests`);
  console.log(`   Health:    http://localhost:${PORT}/health\n`);
});
}

export { createInitialGameState, sanitizeMapConfig, MAP_SIZES };
// test seams (used by smoke.mjs; no effect on the running server)
export { handleGameAction, handleLeave, rooms, clients };

// ─── Keep-alive (กัน Render free tier หลับหลังไม่มีคนใช้ ~15 นาที) ───────────────
// Render ตั้ง RENDER_EXTERNAL_URL ให้อัตโนมัติ → self-ping /health ทุก 10 นาที
// ถือเป็น inbound traffic ทำให้ instance ไม่ spin down (เลี่ยง cold start ~12 วิ)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const pingUrl = `${SELF_URL.replace(/\/$/, "")}/health`;
  setInterval(() => {
    fetch(pingUrl)
      .then((r) => console.log(`[keep-alive] ${r.status} ${pingUrl}`))
      .catch((e) => console.warn(`[keep-alive] failed: ${e.message}`));
  }, 10 * 60 * 1000);
  console.log(`   Keep-alive: self-ping ${pingUrl} ทุก 10 นาที`);
}
