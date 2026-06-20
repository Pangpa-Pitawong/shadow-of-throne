// ─── Networking + redaction (broadcast game/room state to clients) ────────────
import { rooms, clients } from "./state.js";

export function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

// ─── REDACT ROOM: ปกปิดข้อมูลลับใน room_update ─────────────────────────────────
//   • บทบาทเป็นความลับ (เกมสืบบทบาท) — เห็นได้แค่ "ของตัวเอง" + "พระราชา"
//   • ตัด gameState ออกเสมอ — ส่งแยกผ่าน game_state (ที่ redact รายผู้เล่น)
export function redactRoomFor(room, viewerIdx) {
  if (!room) return room;
  const clone = { ...room };
  delete clone.gameState;
  if (room.roles) {
    clone.roles = room.roles.map((r, i) =>
      (i === viewerIdx || r === "king") ? r : "hidden"
    );
  }
  return clone;
}

// ─── REDACT: ปกปิดข้อมูลลับรายผู้เล่น ────────────────────────────────────────
//   • บทบาท: เห็นได้เฉพาะตัวเอง / พระราชา(เปิดเสมอ) / ผู้ที่ตายแล้ว(revealed)
//   • การ์ดในมือ: เห็นเฉพาะของตัวเอง (คนอื่นเห็นแค่จำนวน)
//   • เควสรอง: เห็นเฉพาะของตัวเอง
//   • ม่านหมอก (fogActive): ซ่อนตัวละครจากทุกคน ยกเว้นผู้ที่ยืนช่องเดียวกัน
export function redactGameStateFor(gs, viewerIdx) {
  // ── perf: shallow clone เท่าที่จำเป็น แทน JSON deep-clone ทั้งก้อน ──
  const clone = { ...gs };
  delete clone._questTargets;
  delete clone._code;
  delete clone._discard;
  delete clone._interruptTimer;
  delete clone._eventSeq;
  if (clone.gameOver) return clone; // จบเกม — เปิดทุกอย่าง

  const viewer = gs.players[viewerIdx];
  clone.players = gs.players.map((src, i) => {
    const p = { ...src };
    const isSelf = i === viewerIdx;
    p.handCount = p.hand ? p.hand.length : 0;
    if (!isSelf) {
      p.hand = [];
      p.questChoices = null;
      p.quest = p.quest ? { hidden: true, done: !!p.quest.done } : null;
      // เปิดเผยรายบุคคล (สกิลสอดแนม/ทำนาย) — เห็นเฉพาะผู้ที่ใช้สกิลเท่านั้น
      const privatelyKnown = Array.isArray(p._privateRevealTo) && p._privateRevealTo.includes(viewerIdx);
      const roleVisible = p.role === "king" || p.revealed || privatelyKnown;
      if (!roleVisible) p.role = "hidden";
      // ── ม่านหมอก — ซ่อนตัวละครจากทุกคน ยกเว้นผู้ที่อยู่ช่องเดียวกัน ──
      if (clone.fogActive) {
        const sameCell = viewer && p.col === viewer.col && p.row === viewer.row;
        if (!sameCell) {
          p.name = "ผู้เล่นปริศนา";
          p.classId = "hidden";
          p.equipment = [];
          p.statusEffects = [];
          p.fogged = true;
          p.hiddenByFog = true; // client: ไม่วาดโทเคนบนแมพ (มองไม่เห็นตำแหน่ง)
          p._moveTrail = null;  // ไม่รั่วเส้นทางเดินของคนที่ถูกม่านหมอกซ่อน
        }
      }
    }
    delete p._privateRevealTo; // ไม่ส่งรายชื่อผู้ที่รู้โรลออกไป
    return p;
  });

  // ม่านหมอก — ปกปิดบันทึกของเฟสปัจจุบัน (เปิดอ่านได้เมื่อจบเฟส)
  if (clone.fogActive) {
    clone.log = clone.log.map(e =>
      (e.fog && e.ph === clone.phase)
        ? { msg: "🌫️ เหตุการณ์ถูกปกปิดในม่านหมอก...", type: "fog", ts: e.ts }
        : e
    );
  }
  return clone;
}

export function broadcastGameState(code, extra = {}) {
  const room = rooms[code];
  if (!room || !room.gameState) return;
  for (const [ws, info] of clients) {
    if (info.code === code && ws.readyState === 1) {
      const snapshot = redactGameStateFor(room.gameState, info.playerIdx);
      ws.send(JSON.stringify({ type: "game_state", gameState: snapshot, ...extra }));
    }
  }
}

export function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  for (const [ws, info] of clients) {
    if (info.code === code && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "room_update", room: redactRoomFor(room, info.playerIdx) }));
    }
  }
}

export function broadcastRoomList() {
  const list = Object.values(rooms).filter(
    r => r.visibility === "public" && r.status !== "started" &&
      Date.now() - r.createdAt < 30 * 60 * 1000
  );
  const msg = JSON.stringify({ type: "room_list", rooms: list });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}
