import http from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";
import { MAGIC_CARDS, ALL_CARDS, drawWeighted, rarityMeta } from "./src/game/constants/cards.js";
import {
  useMagic, equipWeapon, placeTrap, triggerTrap,
  gearResistance, isGearActive, hasMetalArmor, METAL_SLOTS,
  computeMagicTargets, applyAttackToTarget, fireTrapEffect,
} from "./src/game/utils/cardEngine.js";
import { EVENT_CARDS, drawEventCards } from "./src/game/constants/events.js";
import { pickQuestChoices } from "./src/game/constants/quests.js";
import { CHARACTERS } from "./src/game/constants/characters.js";
import { ZONE_EVENT_POOL, ZONE_EVENT_EXCLUDED } from "./src/game/constants/zoneEvents.js";

const PORT = process.env.PORT || 3001;

// ─── กติกา: ใช้การ์ดได้ไม่เกิน N ใบต่อเทิร์น ──────────────────────────────────
const MAX_CARDS_PER_TURN = 4;

// ─── กติกา: ค่าการเดินต่อเทิร์น (งบเดิน) ──────────────────────────────────────
//   ทุกตัวละครได้ "งบการเดิน" 5 หน่วยต่อเทิร์น หักด้วยต้นทุนภูมิประเทศของเส้นทาง
//   ถ้ายังเหลืองบ ก็เดินต่อได้เรื่อยๆ จนกว่างบจะหมด (เดินเป็นช่วงๆ ได้)
const BASE_MOVE_BUDGET = 5;

// ─── MAP CONFIG — ตั้งค่าภูมิประเทศ/สถานที่ตอนสร้างห้อง ───────────────────────
//   amount ต่อภูมิประเทศ: 0=น้อย · 1=ปกติ · 2=มาก   (ตัวคูณน้ำหนักการสุ่ม)
//   zoneDensity: 0=น้อย · 1=ปกติ · 2=มาก  (จำนวนสถานที่พิเศษบนแมพ)
const DEFAULT_MAP_CFG = {
  random: false,
  terrain: { forest: 1, mountain: 1, desert: 1, swamp: 1, water: 1 },
  zoneDensity: 1,
  dangerZones: true,
  shops: true,
};
function sanitizeMapConfig(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const clampAmt = (v) => (v === 0 || v === 1 || v === 2 ? v : 1);
  const t = c.terrain && typeof c.terrain === "object" ? c.terrain : {};
  return {
    random: !!c.random,
    terrain: {
      forest: clampAmt(t.forest), mountain: clampAmt(t.mountain),
      desert: clampAmt(t.desert), swamp: clampAmt(t.swamp), water: clampAmt(t.water),
    },
    zoneDensity: clampAmt(c.zoneDensity),
    dangerZones: c.dangerZones !== false,
    shops: c.shops !== false,
  };
}

// ─── State ──────────────────────────────────────────────────────────────────
const rooms = {};
const clients = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── REDACT ROOM: ปกปิดบทบาทลับใน room_update ─────────────────────────────────
//   บทบาทเป็นความลับ (เกมสืบบทบาท) — ผู้เล่นเห็นได้แค่ "ของตัวเอง" + "พระราชา"
//   (พระราชาเปิดเผยตั้งแต่ต้น) ที่เหลือถูกแทนด้วย "hidden" ก่อนส่งออก
function redactRoomFor(room, viewerIdx) {
  if (!room?.roles) return room;
  const roles = room.roles.map((r, i) =>
    (i === viewerIdx || r === "king") ? r : "hidden"
  );
  return { ...room, roles };
}

const rnd = (n) => Math.floor(Math.random() * n) + 1; // ลูกเต๋า d-n (1..n)
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ─── REDACT: ปกปิดข้อมูลลับรายผู้เล่น ────────────────────────────────────────
//   • บทบาท: เห็นได้เฉพาะตัวเอง / พระราชา(เปิดเสมอ) / ผู้ที่ตายแล้ว(revealed)
//   • การ์ดในมือ: เห็นเฉพาะของตัวเอง (คนอื่นเห็นแค่จำนวน)
//   • เควสรอง: เห็นเฉพาะของตัวเอง
//   • ม่านหมอก (fogActive): ซ่อนตัวละครจากทุกคน (ชื่อ/อาชีพ/ตำแหน่ง/บันทึก)
//        ยกเว้นผู้เล่นที่ยืน "ช่องเดียวกัน" กับผู้ชม — จะเห็นตามปกติ
//        เมื่อจบเฟสม่านหมอก ข้อมูลทั้งหมดกลับมาแสดง
function redactGameStateFor(gs, viewerIdx) {
  // ── perf: shallow clone เท่าที่จำเป็น แทน JSON deep-clone ทั้งก้อน ──
  //   redact แก้เฉพาะ field ระดับบนของ player (reassign) ไม่เคยแก้ nested object
  //   → shallow copy ของ top-level + ของแต่ละ player ก็พอ (cells/log อ้างอิงตรงได้)
  //   ลดต้นทุนต่อ broadcast จาก O(ทั้ง state × ผู้เล่น) เหลือ O(ผู้เล่น)
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

function broadcastGameState(code, extra = {}) {
  const room = rooms[code];
  if (!room || !room.gameState) return;
  for (const [ws, info] of clients) {
    if (info.code === code && ws.readyState === 1) {
      const snapshot = redactGameStateFor(room.gameState, info.playerIdx);
      ws.send(JSON.stringify({ type: "game_state", gameState: snapshot, ...extra }));
    }
  }
}

function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  for (const [ws, info] of clients) {
    if (info.code === code && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "room_update", room: redactRoomFor(room, info.playerIdx) }));
    }
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

// ─── CARDS POOL (จาก constants ที่แชร์กับ client) ───────────────────────────
const ALL_CARDS_POOL = ALL_CARDS;
const WEAPON_POOL = ALL_CARDS.filter(c => c.type === "weapon");
const MAGIC_POOL = ALL_CARDS.filter(c => c.type === "magic");
const NEG_STATUS = new Set([
  "poison", "burn", "freeze", "lock", "blind", "atk_down", "armor_break", "silence",
  "stun", "trip", "slow", "curse",
]);

function makeUid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
// จั่วการ์ดแบบถ่วงน้ำหนักตามความหายาก (% การจั่วตรงตามที่กำหนดใน RARITY)
function drawRandomCard(pool = ALL_CARDS_POOL) {
  const card = drawWeighted(pool, Math.random);
  return { ...card, uid: makeUid() };
}

// ─── HAND LIMIT: ถือไพ่ได้ไม่เกิน HP ปัจจุบัน (สูงสุด 10 ใบ) ────────────────
//   เกินลิมิต → ตั้ง pendingDiscard ให้ผู้เล่น "เลือกทิ้งเอง" (ไม่ทิ้งสุ่มอัตโนมัติ)
function handLimit(p) { return Math.min(10, Math.max(1, p.hp)); }
function enforceHandLimit(p) {
  const lim = handLimit(p);
  p.pendingDiscard = Math.max(0, p.hand.length - lim);
  return p.pendingDiscard;
}
function giveCard(p, card) {
  p.hand.push(card);
  enforceHandLimit(p);
}

// ─── STAT RECOMPUTE: atk/def/spd(move)/range = ฐาน + อุปกรณ์ + สถานะ ─────────
//   • SPD (p.move) = ฐาน + อุปกรณ์ + "ชาร์จความเร็ว" (_spdCharge) จากการตั้งรับนิ่งๆ
//   • ระยะโจมตี (range) = อุปกรณ์ + โบนัสจาก SPD อัตราส่วน 2:1 (SPD 2 = +1 ระยะ)
// gs ที่กำลังประมวลผล — ใช้เป็น default ให้ recomputeStats/addStatus เห็นเงื่อนไข
// (เวลา กลางวัน/คืน · terrain · near-water) โดยไม่ต้องแก้ทุก call site
// ปลอดภัยเพราะ handler ทำงานแบบ synchronous ทีละข้อความ
let RECOMPUTE_GS = null;
function setActiveGS(gs) { RECOMPUTE_GS = gs; }

function recomputeStats(p, gs = RECOMPUTE_GS) {
  let atk = p.baseAtk, def = p.baseDef, range = 0, move = p.baseMove || 3, magicAtk = 0;
  const equip = p.equipment || [];
  const dualGloves = equip.filter(e => e.effect === "dual_glove").length;
  for (const e of equip) {
    if (!isGearActive(p, e, gs)) continue;   // เงื่อนไข กลางวัน/คืน · terrain · near · hp · requireArmor
    atk += e.atk || 0;
    def += e.def || 0;
    magicAtk += e.magicAtk || 0;
    range = Math.max(range, e.range || 0);
    if (e.effect === "swift") move += 1;
    if (e.effect === "king_only" && p.role === "king") atk += 2;
  }
  // ถุงมือเวทย์ฝั่งขวาซ้าย — ใส่คู่ได้ -2 ดาเมจเพิ่ม (สะท้อนเป็น DEF)
  if (dualGloves >= 2) def += 2;
  for (const s of (p.statusEffects || [])) {
    if (s.type === "atk_down") atk -= (s.value || 2);
    if (s.type === "atk_up") atk += (s.value || 1);
    if (s.type === "def_up") def += (s.value || 2);
    if (s.type === "armor_break") def -= (s.value || 2);
    if (s.type === "magic_up") magicAtk += (s.value || 2);
    if (s.type === "curse") atk -= 1;          // สาป — อ่อนแรง
  }
  // ชาร์จความเร็ว — อยู่นิ่งโดยไม่เดิน/ไม่โดนโจมตี ได้ +SPD (สูงสุด +2)
  move += (p._spdCharge || 0);
  // ─── passive skills ─────────────────────────────────────────────────────────
  // เลือดนักรบ (sunwu): HP > 50% → ATK+1
  if (p.charId === "sunwu" && p.hp > p.maxHp / 2) atk += 1;

  p.atk = Math.max(0, atk);
  p.def = Math.max(0, def);
  p.magicAtk = Math.max(0, magicAtk);
  p.move = Math.max(1, move);
  // ระยะโจมตี = อุปกรณ์ + โบนัสจาก SPD (2:1) — SPD ที่ชาร์จไว้ก็เพิ่มระยะด้วย
  range += Math.floor(p.move / 2);
  // ตาเหยี่ยว (archer): ถ้าไม่เดินในเทิร์นนี้ range+1
  if (p.charId === "archer" && p._hawkEyeActive) range += 1;
  p.range = Math.max(0, range);
}

// ─── DAMAGE: ลด HP โดยเคารพ ภูมิธาตุ → โล่ (shield) ─────────────────────────────
//   element : physical | fire | ice | lightning | water | magic | dark
function applyDamage(gs, p, amount, srcLabel = "", element = "physical", attacker = null) {
  if (amount <= 0) return 0;
  // ภูมิคุ้มกัน/ต้านทานธาตุจากอุปกรณ์
  const res = gearResistance(p, element, gs);
  if (res.immune) {
    pushLog(gs, `🛡️ ${p.name} ภูมิคุ้มกันธาตุ ${element}${srcLabel ? ` (${srcLabel})` : ""} — ไม่รับดาเมจ`, "event");
    if (element === "lightning") lightningAbsorbTick(gs, p, attacker);
    return 0;
  }
  if (res.flat > 0) amount = Math.max(0, amount - res.flat);
  if (amount <= 0) return 0;
  // passive: เลือดเย็น (icemage) — ลดดาเมจ -1 เมื่อมานา > 5
  if (p.charId === "icemage" && p.mana > 5) amount = Math.max(0, amount - 1);
  if (amount <= 0) return 0;
  const shield = (p.statusEffects || []).find(s => s.type === "shield" && (s.value || 0) > 0);
  if (shield) {
    shield.value -= 1;
    if (shield.value <= 0) p.statusEffects = p.statusEffects.filter(s => s !== shield);
    pushLog(gs, `🟡 ${p.name} ใช้โล่กันดาเมจ${srcLabel ? ` (${srcLabel})` : ""}!`, "event");
    return 0;
  }
  p.hp = Math.max(0, p.hp - amount);
  // โดนความเสียหาย → ล้างการชาร์จความเร็ว + จดไว้ว่าเทิร์นนี้โดนตี (กันชาร์จ SPD/regen_safe รอบหน้า)
  if (amount > 0) {
    p._damagedSinceTurn = true;
    p._hpLostThisRound = (p._hpLostThisRound || 0) + amount;
    if (p._spdCharge) { p._spdCharge = 0; recomputeStats(p, gs); }
  }
  // โล่ต้นไม้ศักดิ์สิทธิ์ — แตกเมื่อโดนไฟ
  if (element === "fire") breakFragileFireGear(gs, p);
  return amount;
}

// เกราะสายฟ้าซีล — ทุก 2 ครั้งที่กันสายฟ้า ปล่อยคืนดาเมจสายฟ้าใส่ผู้โจมตี
function lightningAbsorbTick(gs, p, attacker) {
  const gear = (p.equipment || []).find(e => e.effect === "lightning_absorb");
  if (!gear) return;
  p._lightningHits = (p._lightningHits || 0) + 1;
  if (p._lightningHits >= 2 && attacker?.alive) {
    p._lightningHits = 0;
    const back = gear.val || 3;
    const dealt = applyDamage(gs, attacker, back, "เกราะสายฟ้าซีล", "lightning");
    if (dealt > 0) pushLog(gs, `⚡ เกราะสายฟ้าของ ${p.name} ปล่อยคืน ${dealt} ใส่ ${attacker.name}!`, "dmg");
    if (attacker.hp <= 0) killPlayer(gs, attacker);
  }
}

// โล่/เกราะ tag "fragile_fire" — โดนไฟแล้วแตก
function breakFragileFireGear(gs, p) {
  const before = (p.equipment || []).length;
  p.equipment = (p.equipment || []).filter(e => !(e.tag || []).includes("fragile_fire"));
  if (p.equipment.length < before) {
    pushLog(gs, `🔥 อุปกรณ์ไม้ของ ${p.name} แตกจากเปลวไฟ!`, "dmg");
    recomputeStats(p, gs);
  }
}

function addStatus(p, type, duration, value = 0, gs = RECOMPUTE_GS) {
  if (!p.statusEffects) p.statusEffects = [];
  // ภูมิคุ้มกันสถานะจากอุปกรณ์ (เช่น เกราะเหล็กทมิฬ กัน 'มึน'/'สะดุด')
  for (const e of (p.equipment || [])) {
    if (isGearActive(p, e, gs) && (e.immuneStatus || []).includes(type)) {
      if (gs) pushLog(gs, `🛡️ ${p.name} ภูมิคุ้มกันสถานะ "${type}"`, "event");
      return false;
    }
  }
  const existing = p.statusEffects.find(s => s.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (value) existing.value = Math.max(existing.value || 0, value);
  } else {
    p.statusEffects.push({ type, duration, value });
  }
  recomputeStats(p, gs);
  return true;
}
function hasStatus(p, type) { return (p.statusEffects || []).some(s => s.type === type); }

// บัฟ "ลมเวทย์หลบภัย" — ถ้ามี dodge_charge อยู่ ใช้หลบ 1 ครั้ง (กิน 1 stack)
function consumeDodge(gs, p) {
  const s = (p.statusEffects || []).find(s => s.type === "dodge_charge" && (s.value || 1) > 0);
  if (!s) return false;
  s.value = (s.value || 1) - 1;
  if (s.value <= 0) p.statusEffects = p.statusEffects.filter(x => x !== s);
  recomputeStats(p, gs);
  return true;
}

function pushLog(gs, msg, type = "") {
  gs.log.unshift({ msg, type, ts: Date.now(), ph: gs.phase, fog: !!gs.fogActive });
  if (gs.log.length > 200) gs.log.length = 200;
}

function killPlayer(gs, p) {
  if (!p.alive) return;
  p.alive = false;
  p.revealed = true;
  pushLog(gs, `💀 ${p.name} (${p.role}) ถูกกำจัด! — บทบาทถูกเปิดเผย`, "death");
  // เมื่อราชาตาย → เริ่ม traitor offer ก่อน checkWin (gs._code ถูกเซ็ตตอน start_game)
  if (p.role === "king" && gs._code) {
    startTraitorOffer(gs, gs._code);
  } else {
    checkWinServer(gs);
  }
}

// ─── TERRAIN MOVEMENT ────────────────────────────────────────────────────────
// ✅ เดินได้ทุกที่ — น้ำผ่านได้ (ต้นทุนสูง) ไม่ใช่ 99 (ผ่านไม่ได้) อีกต่อไป
const TERRAIN_MOVE_COST = { plains: 1, forest: 2, mountain: 3, water: 3, desert: 2, swamp: 3 };

function getNeighborKeys(col, row, cellMap, blockWater = true) {
  const isOdd = col % 2 === 1;
  const dirs = isOdd
    ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
    : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return dirs
    .map(([dc, dr]) => `${col + dc},${row + dr}`)
    .filter(k => cellMap[k] && (!blockWater || cellMap[k].terrain !== "water"));
}

// คืน Map ของ key → ต้นทุนการเดินที่ถูกที่สุด (ใช้ตรวจระยะ + หักงบเดิน)
function getReachableCostMap(startCol, startRow, steps, cells) {
  const cellMap = {};
  for (const c of cells) cellMap[c.key] = c;
  const visited = new Map();
  const startKey = `${startCol},${startRow}`;
  visited.set(startKey, 0);
  const queue = [{ key: startKey, cost: 0 }];
  while (queue.length > 0) {
    const { key, cost } = queue.shift();
    const cell = cellMap[key];
    if (!cell) continue;
    for (const nk of getNeighborKeys(cell.col, cell.row, cellMap, false)) {
      const neighbor = cellMap[nk];
      if (!neighbor) continue;
      const moveCost = TERRAIN_MOVE_COST[neighbor.terrain] || 1;
      const newCost = cost + moveCost;
      if (newCost <= steps && (!visited.has(nk) || visited.get(nk) > newCost)) {
        visited.set(nk, newCost);
        queue.push({ key: nk, cost: newCost });
      }
    }
  }
  visited.delete(startKey);
  return visited;
}

function getReachableServer(startCol, startRow, steps, cells) {
  return new Set(getReachableCostMap(startCol, startRow, steps, cells).keys());
}

function hexDistanceServer(aCol, aRow, bCol, bRow) {
  // cube-coordinate distance (odd-q offset) — ตรงกับ client hexMath
  const toCube = (col, row) => {
    const x = col;
    const z = row - (col - (col & 1)) / 2;
    return { x, y: -x - z, z };
  };
  const ac = toCube(aCol, aRow), bc = toCube(bCol, bRow);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}

// ─── CARD ENGINE CONTEXT — ฉีด helper ของเกมให้ cardEngine.js ────────────────
const CARD_CTX = {
  applyDamage,
  addStatus,
  recomputeStats,
  hasStatus,
  pushLog,
  killPlayer,
  hexDistance: hexDistanceServer,
  giveCard,
  drawRandomCard,
  cellAt: (gs, col, row) => gs.cells.find(c => c.col === col && c.row === row),
};

// ─── CHARACTER DATA — derive จาก shared CHARACTERS (แหล่งความจริงเดียว) ────
const CHARACTERS_DATA = Object.fromEntries(
  Object.entries(CHARACTERS).map(([id, c]) => [id, {
    hp: c.hp, maxHp: c.hp,
    mana: c.mana, maxMana: c.mana,
    baseAtk: c.atk, baseDef: c.def, move: c.move,
  }])
);
// fallback ถ้าไม่เลือกตัวละคร
CHARACTERS_DATA["_default"] = { hp: 12, maxHp: 12, mana: 6, maxMana: 6, baseAtk: 3, baseDef: 2, move: 3 };

// ─── STARTING GEAR — อุปกรณ์เริ่มต้นตามตัวละคร ─────────────────────────────
const STARTING_GEAR = {
  sunwu:       { id: "iron_sword",    name: "ดาบเหล็ก",          ico: "⚔️",  type: "weapon", atk: 1, range: 0 },
  zhenghe:     { id: "explorer_map",  name: "แผนที่นักสำรวจ",    ico: "🗺️",  type: "weapon", range: 2, effect: "ranged" },
  icemage:     { id: "frost_staff",   name: "ไม้เท้าน้ำแข็ง",   ico: "❄️",  type: "weapon", atk: 1, range: 3, effect: "ranged" },
  archer:      { id: "short_bow",     name: "ธนูสั้น",            ico: "🏹",  type: "weapon", atk: 1, range: 4, effect: "ranged" },
  cleric:      { id: "holy_staff",    name: "ไม้เท้าศักดิ์สิทธิ์",ico: "⚕️", type: "weapon", def: 1, range: 2 },
  assassin:    { id: "twin_dagger",   name: "กริชคู่",            ico: "🗡️",  type: "weapon", atk: 1, range: 0, effect: "backstab" },
  swordmaster: { id: "fine_sword",    name: "ดาบประณีต",          ico: "🔱",  type: "weapon", atk: 1, range: 0 },
  guardian:    { id: "tower_shield",  name: "โล่เหล็กใหญ่",      ico: "🛡️",  type: "weapon", def: 2, range: 0 },
  firemage:    { id: "fire_staff",    name: "ไม้เท้าไฟ",          ico: "🔥",  type: "weapon", atk: 1, range: 3, effect: "ranged" },
  herbalist:   { id: "herb_satchel",  name: "ถุงสมุนไพร",         ico: "🌿",  type: "weapon", range: 2 },
  general:     { id: "battle_axe",    name: "ขวานสงคราม",          ico: "🪖",  type: "weapon", atk: 1, def: 1, range: 0 },
  oracle:      { id: "crystal_orb",   name: "ลูกแก้วทำนาย",        ico: "🔮",  type: "weapon", range: 3, effect: "ranged" },
};

// ─── PHASE EVENTS ────────────────────────────────────────────────────────────
//   เหตุการณ์ท้ายเฟสย้ายไปใช้ EVENT_CARDS (constants/events.js) + applyEventCard()

// ─── BOSS TYPES (โผล่หลังครบเฟส) ────────────────────────────────────────────
const BOSS_TYPES = [
  { name: "มังกรเงา", ico: "🐲" },
  { name: "อัศวินมรณะ", ico: "☠️" },
  { name: "ปีศาจไฟ", ico: "👹" },
  { name: "ราชันอสูร", ico: "😈" },
  { name: "ภูตพายุ", ico: "🌪️" },
];

// ─── Game State Initializer ──────────────────────────────────────────────────
function createInitialGameState(room) {
  // ── ตั้งค่าแมพจากห้อง (host เลือกตอนสร้าง) ──────────────────────────────────
  const cfg = sanitizeMapConfig(room.mapConfig);
  if (cfg.random) {
    // สุ่มทั้งหมด — แต่ละภูมิประเทศได้ปริมาณสุ่ม + สถานที่/โซนสุ่ม
    for (const k of Object.keys(cfg.terrain)) cfg.terrain[k] = Math.floor(Math.random() * 3);
    cfg.zoneDensity = Math.floor(Math.random() * 3);
    cfg.dangerZones = Math.random() < 0.8;
    cfg.shops = Math.random() < 0.85;
  }
  // โซนหลักมีเสมอ · โซนอันตราย/ร้านค้าเปิด-ปิดได้ · โซนเสริมขึ้นกับความหนาแน่น
  const CORE_ZONES = new Set(["palace", "throne", "village", "market", "rebel_camp", "quest_board"]);
  const DANGER_ZONES = new Set(["cave", "volcano", "dungeon", "ruins", "dark_forest", "graveyard"]);
  const SHOP_ZONE_TYPES = new Set(["blacksmith", "alchemist", "tavern", "armory"]);
  const densityP = cfg.zoneDensity === 0 ? 0.4 : cfg.zoneDensity === 2 ? 1 : 0.78;
  function zoneEnabled(zone) {
    if (CORE_ZONES.has(zone)) return true;
    if (DANGER_ZONES.has(zone)) return cfg.dangerZones && Math.random() < densityP;
    if (SHOP_ZONE_TYPES.has(zone)) return cfg.shops && Math.random() < Math.max(densityP, 0.6);
    return Math.random() < densityP; // โซนเสริม (tower/shrine/treasure/farm/river/...)
  }

  const FIXED_ZONES = {
    "6,0": "palace", "6,1": "throne", "2,1": "village", "6,5": "market",
    "1,8": "rebel_camp", "4,5": "dark_forest", "9,2": "tower",
    "0,10": "shrine", "11,9": "cave",
    "3,3": "blacksmith", "9,7": "alchemist", "2,5": "tavern",
    "10,4": "armory", "5,9": "dungeon", "7,3": "quest_board",
    "4,1": "treasure", "8,9": "farm", "6,3": "river",
    "11,5": "ruins", "0,2": "watchtower", "3,7": "graveyard",
    "10,1": "volcano", "5,5": "portal", "12,8": "oasis",
  };
  const ZONE_TERRAIN = {
    palace: "plains", throne: "plains", village: "plains", market: "plains",
    quest_board: "plains", treasure: "plains", river: "plains",
    blacksmith: "plains", alchemist: "plains", tavern: "plains", farm: "plains",
    dark_forest: "forest", rebel_camp: "forest", graveyard: "forest",
    cave: "mountain", dungeon: "mountain", volcano: "mountain",
    ruins: "mountain", armory: "mountain", watchtower: "mountain",
    shrine: "plains", oasis: "plains", portal: "plains", tower: "plains",
  };
  const spawnPositions = [
    { col: 0, row: 0 }, { col: 12, row: 0 },
    { col: 0, row: 10 }, { col: 12, row: 10 },
    { col: 6, row: 0 }, { col: 6, row: 10 },
    { col: 0, row: 5 }, { col: 12, row: 5 }, // ผู้เล่นคนที่ 7–8
  ];
  const spawnKeys = new Set(spawnPositions.map(s => `${s.col},${s.row}`));

  // ─── สุ่มภูมิศาสตร์ใหม่ทุกเกม ──────────────────────────────────────────────
  //   ใช้ "เมล็ดสุ่ม" แบบก้อน (cluster) ให้พื้นผิวเกาะกลุ่มกันเป็นผืนสวยงาม
  //   ไม่ใช่สุ่มกระจายมั่ว — เลือกจุดศูนย์กลางหลายจุดแล้วแผ่ภูมิประเทศออกไป
  //   ปรับน้ำหนักตาม mapConfig: ตัวคูณ 0=น้อย(0.3x) · 1=ปกติ(1x) · 2=มาก(2.2x)
  const AMT_MULT = { 0: 0.3, 1: 1, 2: 2.2 };
  const TERRAIN_BASE = { forest: 0.22, mountain: 0.14, desert: 0.10, swamp: 0.08, water: 0.06 };
  const TERRAIN_WEIGHTS = [["plains", 0.40]];
  for (const [t, base] of Object.entries(TERRAIN_BASE)) {
    TERRAIN_WEIGHTS.push([t, base * (AMT_MULT[cfg.terrain[t]] ?? 1)]);
  }
  const TERRAIN_TOTAL = TERRAIN_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  function weightedTerrain() {
    let r = Math.random() * TERRAIN_TOTAL;
    for (const [t, w] of TERRAIN_WEIGHTS) { if ((r -= w) <= 0) return t; }
    return "plains";
  }
  // เริ่มจากที่ราบทั้งแมพ แล้วโปรย "ก้อนภูมิประเทศ" จำนวนหนึ่งแบบสุ่ม
  const terrainGrid = {};
  for (let row = 0; row < 11; row++)
    for (let col = 0; col < 13; col++) terrainGrid[`${col},${row}`] = "plains";
  const blobCount = 14 + Math.floor(Math.random() * 6); // 14–19 ก้อนต่อเกม
  for (let b = 0; b < blobCount; b++) {
    const t = weightedTerrain();
    if (t === "plains") continue;
    const ccol = Math.floor(Math.random() * 13), crow = Math.floor(Math.random() * 11);
    const size = 1 + Math.floor(Math.random() * 4); // รัศมีก้อน
    for (let dr = -size; dr <= size; dr++) {
      for (let dc = -size; dc <= size; dc++) {
        const col = ccol + dc, row = crow + dr;
        if (col < 0 || col > 12 || row < 0 || row > 10) continue;
        // ความน่าจะเป็นลดลงตามระยะจากศูนย์กลาง → ขอบก้อนขรุขระเป็นธรรมชาติ
        const dist = Math.abs(dc) + Math.abs(dr);
        if (Math.random() < 1 - dist / (size + 1.5)) terrainGrid[`${col},${row}`] = t;
      }
    }
  }

  const cells = [];
  const zoneToCell = {};
  const SHOP_ZONES = ["market", "blacksmith", "alchemist", "tavern", "armory"];
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 13; col++) {
      const key = `${col},${row}`;
      const zoneCandidate = FIXED_ZONES[key] || null;
      const specialZone = (zoneCandidate && zoneEnabled(zoneCandidate)) ? zoneCandidate : null;
      let terrain;
      if (specialZone && ZONE_TERRAIN[specialZone]) terrain = ZONE_TERRAIN[specialZone];
      else if (spawnKeys.has(key)) terrain = "plains"; // จุดเกิดผู้เล่นเป็นที่ราบเสมอ
      else terrain = terrainGrid[key];
      let shopItems = null;
      if (specialZone && SHOP_ZONES.includes(specialZone)) shopItems = generateShopItemsServer(specialZone);
      if (specialZone) zoneToCell[specialZone] = key;
      cells.push({ col, row, key, terrain, specialZone, trap: null, shopItems });
    }
  }

  const players = room.players.map((p, i) => {
    const charId = p.charId || p.class || "_default";
    const charData = CHARACTERS_DATA[charId] || CHARACTERS_DATA["_default"];
    const charDef = CHARACTERS[charId];
    const spawn = spawnPositions[i] || { col: i * 2, row: 0 };
    const gear = STARTING_GEAR[charId] ? [{ ...STARTING_GEAR[charId] }] : [];
    const role = room.roles[i];
    const player = {
      id: i,
      name: p.name,
      role,
      charId,
      classId: charId, // compat: client ยังอ่าน classId สำหรับ ico/color
      charName: charDef?.name || charId,
      hp: charData.hp, maxHp: charData.maxHp,
      mana: charData.mana, maxMana: charData.maxMana,
      baseAtk: charData.baseAtk, baseDef: charData.baseDef, baseMove: charData.move,
      atk: charData.baseAtk, def: charData.baseDef, range: 0, move: charData.move,
      gold: 4, level: 1, exp: 0,
      col: spawn.col, row: spawn.row,
      alive: true,
      hand: [drawRandomCard(), drawRandomCard(), drawRandomCard(), drawRandomCard()],
      pendingDiscard: 0,
      justDrew: [],
      equipment: gear,
      statusEffects: [],
      revealed: role === "king",       // พระราชาเปิดเผยตั้งแต่ต้น
      _shrineUsed: false,
      quest: null,
      questChoices: pickQuestChoices(3, new Set(Object.keys(zoneToCell))), // เควสรอง 3 ตัวเลือก (เฉพาะโซนที่มีบนแมพ)
    };
    recomputeStats(player);
    return player;
  });

  // ─── บัฟพระราชาตามสัดส่วนผู้เล่น ──────────────────────────────────────────
  //   ยิ่งผู้เล่นเยอะ สัดส่วน(%)ของราชายิ่งน้อย → ราชาถูกรุมหนักขึ้น
  //   จึงเพิ่มค่าสถานะทุกอย่างของราชาขึ้น 8% ต่อผู้เล่นที่เกินจาก 3 คน
  //   (3=+0% · 4=+8% · 5=+16% · 6=+24% · 7=+32% · 8=+40%)
  const totalPlayers = players.length;
  const kingBuffPct = Math.max(0, (totalPlayers - 3) * 0.08);
  if (kingBuffPct > 0) {
    const king = players.find(p => p.role === "king");
    if (king) {
      const scale = (base) => Math.round(base * (1 + kingBuffPct));
      king.maxHp   = scale(king.maxHp);
      king.hp      = king.maxHp;                 // เริ่มเกมเลือดเต็มตามค่าใหม่
      king.maxMana = scale(king.maxMana);
      king.mana    = king.maxMana;
      king.baseAtk = scale(king.baseAtk);
      king.baseDef = scale(king.baseDef);
      recomputeStats(king);                      // คำนวณ atk/def รวมอุปกรณ์ใหม่
      king.hp      = king.maxHp;                  // กันกรณี recompute แก้ maxHp
    }
  }

  // ─── ลำดับเทิร์น: พระราชาเริ่มก่อน แล้วสุ่มลำดับที่เหลือ ───
  const kingIdx = players.findIndex(p => p.role === "king");
  const others = players.map((_, i) => i).filter(i => i !== kingIdx);
  const turnOrder = [kingIdx, ...shuffle(others)].filter(i => i >= 0);

  const maxPhases = room.mode === "quick" ? 6 : room.mode === "epic" ? 10 : 8;

  const gs = {
    players,
    cells,
    turnOrder,
    turnPointer: 0,
    currentTurn: turnOrder[0] ?? 0,
    phase: 1,
    phaseStep: 0,
    maxPhases,
    fogActive: false,
    timeOfDay: "day",            // กลางวัน(คี่)/กลางคืน(คู่) — ผูกกับเฟส
    bossMode: false,
    bossLevel: 0,
    actionsDone: { moved: false, attacked: false, cardsPlayed: 0 },
    log: [],
    gameOver: null,
    totalTurns: 0,
    traitorOfferPending: false,  // true ระหว่างรอผู้เล่นตัดสินใจ
    traitorOfferTarget: -1,      // playerIdx ที่ได้รับ offer
    eventReveal: null,           // { id, phase, cards:[...] } — การ์ดเหตุการณ์ท้ายเฟส (client โชว์ modal)
    pendingInterrupt: null,      // ระบบหลบ/บล็อก reactive (ดู interrupt system)
    _eventSeq: 0,
    _discard: [],                // กองทิ้ง (ใช้กับเหตุการณ์ recover/clear discard)
    _questTargets: zoneToCell,
    _code: room.code,            // ใช้ใน killPlayer สำหรับ startTraitorOffer
  };
  setActiveGS(gs);
  pushLog(gs, "🏰 เกมเริ่มต้น! พระราชาเปิดตัวและเริ่มเล่นก่อน", "event");
  if (kingBuffPct > 0) pushLog(gs, `👑 ผู้เล่น ${totalPlayers} คน — พระราชาได้รับพรราชวงศ์ ค่าสถานะ +${Math.round(kingBuffPct * 100)}%`, "event");
  pushLog(gs, `👑 ${players[turnOrder[0]]?.name} (พระราชา) เริ่มเทิร์นแรก`, "turn");
  beginTurn(gs, true);
  return gs;
}

// ─── Server-side shop items ──────────────────────────────────────────────────
function generateShopItemsServer(zoneType) {
  const weaponPool = ALL_CARDS_POOL.filter(c => c.type === "weapon");
  const magicPool = ALL_CARDS_POOL.filter(c => c.type === "magic");
  const mixPool = ALL_CARDS_POOL;
  let pool, count;
  if (zoneType === "blacksmith" || zoneType === "armory") { pool = weaponPool; count = 4; }
  else if (zoneType === "alchemist") { pool = magicPool; count = 4; }
  else { pool = mixPool; count = 5; }
  const items = [];
  for (let i = 0; i < count; i++) {
    // จั่วตามน้ำหนักความหายาก → ราคาตามระดับความหายาก (rarityMeta.price)
    const card = drawWeighted(pool, Math.random);
    const price = rarityMeta(card.rarity).price;
    items.push({ ...card, uid: makeUid(), price });
  }
  return items;
}

// ─── ZONE EFFECT ─────────────────────────────────────────────────────────────
function applyZoneEffectServer(player, cell, gs) {
  const zone = cell.specialZone;
  if (!zone) return;
  const log = (msg, type = "event") => pushLog(gs, msg, type);

  switch (zone) {
    case "palace":
    case "throne":
      if (player.role === "king") { player.hp = Math.min(player.maxHp, player.hp + 3); log(`⚖️ ${player.name} ที่บัลลังก์ HP+3`, "heal"); }
      else if (player.role === "rebel") { player.hp = Math.max(0, player.hp - 2); log(`⚖️ ${player.name} บุกบัลลังก์ HP-2`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    case "village":
      player.hp = Math.min(player.maxHp, player.hp + 2); log(`🏘️ ${player.name} ฟื้น HP+2`, "heal"); break;
    case "rebel_camp":
      if (player.role === "rebel") { player.baseAtk += 1; recomputeStats(player); player.hp = Math.min(player.maxHp, player.hp + 2); log(`⛺ กบฏ ${player.name} ATK+1 HP+2`, "heal"); }
      break;
    case "shrine":
      if (!player._shrineUsed) { player.hp = player.maxHp; player._shrineUsed = true; log(`⛩️ ${player.name} ฟื้น HP เต็ม!`, "heal"); }
      else log(`⛩️ ${player.name} ใช้ศาลเจ้าไปแล้ว`, "");
      break;
    case "cave": {
      const r = rnd(6);
      if (r >= 4) { player.gold += 3; log(`🐉 ${player.name} 🎲${r} หนีมังกร! +3 ทอง`, "event"); }
      else { player.hp = Math.max(0, player.hp - 3); log(`🐉 ${player.name} 🎲${r} โดนมังกร! HP-3`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    }
    case "market": player.gold += 1; log(`🏪 ${player.name} ผ่านตลาด ทอง+1`, "event"); break;
    case "tower": {
      player.mana = Math.min(player.maxMana, player.mana + 2);
      giveCard(player, { ...MAGIC_CARDS[Math.floor(Math.random() * MAGIC_CARDS.length)], type: "magic", uid: makeUid() }, gs);
      log(`🗼 ${player.name} มานา+2 + ได้เวทย์`, "event"); break;
    }
    case "armory": {
      const weaponCards = ALL_CARDS_POOL.filter(c => c.type === "weapon");
      const w = { ...weaponCards[Math.floor(Math.random() * weaponCards.length)], uid: makeUid() };
      giveCard(player, w, gs); log(`⚒️ ${player.name} ได้อาวุธ "${w.name}"`, "event"); break;
    }
    case "river": player.mana = Math.min(player.maxMana, player.mana + 3); log(`🌊 ${player.name} ฟื้นมานา+3`, "heal"); break;
    case "farm": player.gold += 1; log(`🌾 ${player.name} ทำนา ทอง+1`, "event"); break;
    case "oasis": player.hp = Math.min(player.maxHp, player.hp + 3); player.mana = Math.min(player.maxMana, player.mana + 2); log(`🌴 ${player.name} โอเอซิส HP+3 มานา+2`, "heal"); break;
    case "dungeon": {
      const r = rnd(6);
      if (r >= 5) { giveCard(player, drawRandomCard(), gs); giveCard(player, drawRandomCard(), gs); player.gold += 3; log(`🗝️ ${player.name} 🎲${r} บุกดันเจี้ยน! ได้การ์ด 2 ใบ +3 ทอง`, "event"); }
      else if (r >= 3) { giveCard(player, drawRandomCard(), gs); log(`🗝️ ${player.name} 🎲${r} ดันเจี้ยน ได้การ์ด`, "event"); }
      else { player.hp = Math.max(0, player.hp - 4); log(`🗝️ ${player.name} 🎲${r} ดันเจี้ยนอันตราย! HP-4`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    }
    case "ruins": {
      const r = rnd(6);
      if (r >= 4) { giveCard(player, drawRandomCard(), gs); log(`🏚️ ${player.name} 🎲${r} ขุดพบการ์ด`, "event"); }
      else { player.hp = Math.max(0, player.hp - 2); log(`🏚️ ${player.name} 🎲${r} โดนกับดักเก่า! HP-2`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    }
    case "treasure": {
      const r = rnd(6);
      if (r >= 4) { giveCard(player, drawRandomCard(), gs); player.gold += 2; log(`💰 ${player.name} 🎲${r} พบสมบัติ! +การ์ด +2 ทอง`, "event"); }
      else { player.hp = Math.max(0, player.hp - 1); log(`💰 ${player.name} 🎲${r} ไม่พบอะไร HP-1`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    }
    case "volcano": {
      const r = rnd(6);
      if (r >= 5) { player.baseAtk += 2; recomputeStats(player); log(`🌋 ${player.name} 🎲${r} พลังภูเขาไฟ ATK+2!`, "event"); }
      else { player.hp = Math.max(0, player.hp - 4); log(`🌋 ${player.name} 🎲${r} ลาวา! HP-4`, "dmg"); if (player.hp <= 0) killPlayer(gs, player); }
      break;
    }
    case "graveyard": {
      player.hp = Math.max(0, player.hp - 1); giveCard(player, drawRandomCard(), gs);
      log(`🪦 ${player.name} สุสาน HP-1 ได้การ์ด`, "event"); if (player.hp <= 0) killPlayer(gs, player); break;
    }
    case "portal": {
      const nonWater = gs.cells.filter(c => c.terrain !== "water" && !c.specialZone);
      if (nonWater.length > 0) { const t = nonWater[Math.floor(Math.random() * nonWater.length)]; player.col = t.col; player.row = t.row; log(`🌀 ${player.name} เทเลพอร์ตไป (${t.col},${t.row})!`, "event"); }
      break;
    }
    case "watchtower": {
      const others = gs.players.filter(p => p.alive && p.id !== player.id && p.role !== "king");
      if (others.length > 0) {
        const t = others[Math.floor(Math.random() * others.length)];
        // เปิดเผยเฉพาะผู้สอดแนมเห็นเท่านั้น (ไม่ broadcast ทั้งห้อง)
        t._privateRevealTo = t._privateRevealTo || [];
        if (!t._privateRevealTo.includes(player.id)) t._privateRevealTo.push(player.id);
        log(`🔭 ${player.name} สอดแนม → ล่วงรู้บทบาทผู้เล่นคนหนึ่ง (เฉพาะตน)`, "event");
      }
      break;
    }
    case "quest_board":
      player.gold += 2; player.exp = (player.exp || 0) + 3; log(`📋 ${player.name} กระดานเควส +3 EXP +2 ทอง`, "event"); break;
    case "blacksmith":
    case "alchemist":
    case "tavern":
      if (zone === "tavern") player.hp = Math.min(player.maxHp, player.hp + 1);
      log(`🛒 ${player.name} เข้าร้านค้า`, "event"); break;
    case "dark_forest":
      log(`🌑 ${player.name} ซ่อนตัวในป่าดำ`, "event"); break;
    default: break;
  }
}

// ─── RANDOM ZONE EVENT (40% โอกาสเมื่อเดินเข้า specialZone) ─────────────────
function applyRandomZoneEvent(player, cell, gs) {
  if (!cell.specialZone) return;
  if (ZONE_EVENT_EXCLUDED.has(cell.specialZone)) return;
  if (Math.random() > 0.40) return; // 40% chance
  const ev = ZONE_EVENT_POOL[Math.floor(Math.random() * ZONE_EVENT_POOL.length)];
  const log = (msg, type = "event") => pushLog(gs, msg, type);
  const healBonus = (player.charId === "cleric" || player.charId === "herbalist") ? 1 : 0;

  switch (ev.fx) {
    case "gold": {
      const g = Math.floor(Math.random() * 3) + 2; // 2–4
      player.gold += g;
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} ทอง+${g}`, "event");
      break;
    }
    case "draw_card":
      for (let i = 0; i < ev.value; i++) giveCard(player, drawRandomCard(), gs);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} ได้การ์ด ${ev.value} ใบ`, "event");
      break;
    case "heal": {
      const h = ev.value + healBonus;
      player.hp = Math.min(player.maxHp, player.hp + h);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} HP+${h}`, "heal");
      break;
    }
    case "regen":
      addStatus(player, "regen", ev.duration, ev.value + healBonus);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} regen ${ev.value} HP/เทิร์น (${ev.duration} เทิร์น)`, "heal");
      break;
    case "trap_dmg": {
      const d = applyDamage(gs, player, ev.value, ev.name);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} HP-${d}`, "dmg");
      if (player.hp <= 0) killPlayer(gs, player);
      break;
    }
    case "lock":
      addStatus(player, "lock", ev.duration || 1, 0);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} ถูกล็อค 1 เทิร์น`, "event");
      break;
    case "ghost": {
      const d2 = applyDamage(gs, player, ev.value, ev.name);
      giveCard(player, drawRandomCard(), gs);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} HP-${d2} ได้การ์ด 1 ใบ`, "event");
      if (player.hp <= 0) killPlayer(gs, player);
      break;
    }
    case "reveal_all":
      gs.players.forEach(p => { if (p.alive) p._zoneRevealed = true; });
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} ตำแหน่งทุกคนถูกเปิดเผย!`, "event");
      break;
    case "mana":
      player.mana = Math.min(player.maxMana, player.mana + ev.value);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} มานา+${ev.value}`, "heal");
      break;
    case "poison":
      addStatus(player, "poison", ev.duration, ev.value);
      log(`${ev.ico} ${player.name} เหตุการณ์: ${ev.name} ติดพิษ!`, "dmg");
      break;
    default: break;
  }
}

// ─── TRAITOR OFFER — เสนอโรลทรยศให้ราษฎรเมื่อราชาตาย ───────────────────────
const _traitorTimers = {}; // code → timeoutId

function startTraitorOffer(gs, code) {
  const commons = gs.players.filter(p => p.alive && p.role === "commoner");
  if (commons.length === 0) {
    // ไม่มีราษฎร → ตรวจชนะทันที
    checkWinServer(gs);
    broadcastGameState(code);
    return;
  }
  // สุ่มราษฎรหนึ่งคนรับ offer
  const chosen = commons[Math.floor(Math.random() * commons.length)];
  gs.traitorOfferPending = true;
  gs.traitorOfferTarget = chosen.id;
  pushLog(gs, `🗡️ พระราชาล้มแล้ว! กำลังค้นหาผู้ทรยศ... (รอ 30 วิ)`, "event");

  // ส่ง offer เฉพาะผู้เล่นที่ถูกเลือก
  for (const [cws, cinfo] of clients) {
    if (cinfo.code === code && cinfo.playerIdx === chosen.id && cws.readyState === 1) {
      cws.send(JSON.stringify({ type: "traitor_offer", targetIdx: chosen.id, timeout: 30 }));
    }
  }
  broadcastGameState(code);

  // timeout 30 วิ → ปฏิเสธอัตโนมัติ
  if (_traitorTimers[code]) clearTimeout(_traitorTimers[code]);
  _traitorTimers[code] = setTimeout(() => {
    if (!rooms[code]?.gameState?.traitorOfferPending) return;
    resolveTraitorOffer(rooms[code].gameState, code, false, -1);
  }, 30000);
}

function resolveTraitorOffer(gs, code, accepted, responderIdx) {
  if (!gs.traitorOfferPending) return;
  gs.traitorOfferPending = false;
  if (_traitorTimers[code]) { clearTimeout(_traitorTimers[code]); delete _traitorTimers[code]; }

  if (accepted && responderIdx === gs.traitorOfferTarget) {
    const traitor = gs.players[responderIdx];
    if (traitor && traitor.alive) {
      traitor.role = "traitor";
      traitor.revealed = false; // ซ่อนโรลทรยศไว้ก่อน
      pushLog(gs, `🗡️ คนทรยศปรากฏตัว! (ตัวตนถูกซ่อน)`, "event");
      // ราษฎรคนอื่น → กลายเป็นกบฏ
      gs.players.forEach(p => {
        if (p.alive && p.role === "commoner") {
          p.role = "rebel";
          pushLog(gs, `⚔️ ${p.name} เข้าร่วมฝ่ายกบฏ!`, "event");
        }
      });
    }
  } else {
    // ปฏิเสธ / หมดเวลา → ราษฎรทั้งหมดแพ้
    gs.players.forEach(p => {
      if (p.alive && p.role === "commoner") {
        p.alive = false;
        p.revealed = true;
        pushLog(gs, `💀 ${p.name} แพ้ไปกับฝั่งพระราชา (ไม่มีผู้ทรยศ)`, "death");
      }
    });
    pushLog(gs, `🧑 ไม่มีผู้ทรยศ — ราษฎรแพ้ไปกับราชา`, "event");
  }
  checkWinServer(gs);
  broadcastGameState(code);
}

// ─── QUEST PROGRESS ──────────────────────────────────────────────────────────
function checkQuestProgress(player, cell, gs) {
  const q = player.quest;
  if (!q || q.done || !cell.specialZone) return;
  if (cell.specialZone !== q.targetZone) return;
  q.progress = (q.progress || 0) + 1;
  if (q.progress >= (q.visitCount || 1)) {
    q.done = true;
    grantQuestReward(player, q.reward, gs);
    pushLog(gs, `🎯 ${player.name} ทำเควสรอง "${q.name}" สำเร็จ!`, "win");
  } else {
    pushLog(gs, `🎯 ${player.name} คืบหน้าเควส (${q.progress}/${q.visitCount})`, "event");
  }
}
// รางวัลเควส = เพิ่มค่า "สูงสุด" ของสถานะต่างๆ (ถาวร) + เงิน
function grantQuestReward(player, reward, gs) {
  if (!reward) return;
  if (reward.gold) player.gold += reward.gold;
  // เพิ่มเพดานสถานะ (ถาวร) แล้วเติมส่วนที่เพิ่มขึ้นให้ทันที
  if (reward.maxHp)   { player.maxHp += reward.maxHp;     player.hp += reward.maxHp; }
  if (reward.maxMana) { player.maxMana += reward.maxMana; player.mana += reward.maxMana; }
  if (reward.atk)     player.baseAtk += reward.atk;   // เพดาน ATK
  if (reward.def)     player.baseDef += reward.def;   // เพดาน DEF
  if (reward.spd)     player.baseMove += reward.spd;  // เพดาน SPD
  // เผื่อความเข้ากันได้กับข้อมูลเก่า (hp/mana แบบฟื้นฟู)
  if (reward.hp)   { player.maxHp += reward.hp;   player.hp += reward.hp; }
  if (reward.mana) { player.maxMana += reward.mana; player.mana += reward.mana; }
  recomputeStats(player);
}

// ─── COMBAT: โจมตี + กลไกหลบด้วยลูกเต๋า (ดวง) ────────────────────────────────
//   ผู้โจมตี: ทอย d6 + โบนัส ATK (+คริตถ้าทอย 6)
//   ฝ่ายตั้งรับ: ทอย d6 + โบนัสหลบ (จากความเร็ว + เลือดที่เหลือ)
//                ถ้าสถานะ "ห่างกัน" ฝ่ายอ่อนกว่าได้โบนัสหลบเพิ่ม (ดวงมวยรอง)
//   ถ้าแต้มตั้งรับ ≥ แต้มโจมตี = หลบสำเร็จ | ทอย 1 = พลาดเสมอ
function resolveAttack(attacker, defender, gs = RECOMPUTE_GS) {
  const aGear = (attacker.equipment || []).filter(e => isGearActive(attacker, e, gs));
  const dGear = (defender.equipment || []).filter(e => isGearActive(defender, e, gs));
  const fx = new Set(aGear.map(e => e.effect));
  const dfx = new Set(dGear.map(e => e.effect));
  const atkRoll = rnd(6);
  // backstab: คริตง่ายขึ้น (5-6 = คริต) — anticrit (เกราะ) ลบคริตได้
  let crit = fx.has("backstab") ? atkRoll >= 5 : atkRoll === 6;
  if (dfx.has("anticrit")) crit = false;
  const blinded = hasStatus(attacker, "blind");

  const atkPower = attacker.atk + attacker.def + Math.floor(attacker.hp / 4);
  const defPower = defender.atk + defender.def + Math.floor(defender.hp / 4);
  const gap = atkPower - defPower; // >0 = ผู้โจมตีแข็งแรงกว่า → ฝ่ายรับได้โบนัสหลบ

  const underdogBonus = gap > 0 ? Math.min(3, Math.ceil(gap / 3)) : 0;
  const evadeBonus = dfx.has("evade") ? 2 : 0; // เกราะพรางเงา — โบนัสหลบ
  const dodgeBonus = Math.floor(defender.move / 2) + Math.floor(defender.hp / 6) + underdogBonus + evadeBonus;
  let dodgeRoll = rnd(6) + dodgeBonus;
  // ดาบเงาสีมรกต (block_down) — ลดการป้องกัน/หลบของศัตรู -30%
  if (fx.has("block_down")) dodgeRoll = Math.floor(dodgeRoll * 0.7);

  const atkTotal = atkRoll + Math.floor(attacker.atk / 3) + (crit ? 3 : 0) - (blinded ? 2 : 0);

  let hit = atkRoll !== 1 && atkTotal >= dodgeRoll;
  // ชุดเกราะนักฆ่าเงา (enemy_miss) — โอกาสศัตรูพลาดเพิ่ม
  const missGear = dGear.find(e => e.effect === "enemy_miss");
  if (hit && missGear && Math.random() < (missGear.val || 25) / 100) hit = false;

  // pierce_all (หอกมังกรดำ) — ข้ามเกราะทั้งหมด
  const pierce = fx.has("pierce_all") || fx.has("pierce");
  const effDef = pierce ? 0 : defender.def;
  // ธาตุของอาวุธที่ถืออยู่ (active)
  const element = aGear.find(e => e.slot === "weapon" && e.atkElement)?.atkElement || "physical";
  let dmg = 0;
  if (hit) {
    dmg = Math.max(1, attacker.atk + (crit ? 2 : 0) - effDef);
    if (fx.has("vs_metal") && hasMetalArmor(defender)) dmg += (aGear.find(e => e.effect === "vs_metal")?.val || 2);
    if (fx.has("rage")) dmg += Math.min(aGear.find(e => e.effect === "rage")?.val || 3, attacker._hpLostThisRound || 0);
  }
  const doubled = hit && fx.has("double") && atkRoll === 6;
  const doubleHit = hit && fx.has("double_hit");       // มีดกรงเล็บแมวป่า — ตีซ้ำครั้งที่สอง -1
  const twinStrike = hit && fx.has("twin_blade") && aGear.filter(e => e.effect === "twin_blade").length >= 2;
  return { atkRoll, dodgeRoll, dodgeBonus, underdogBonus, crit, hit, dmg, gap, doubled, doubleHit, twinStrike, element, fxList: [...fx] };
}

// ─── TURN: เริ่มเทิร์นของผู้เล่นปัจจุบัน (ประมวลผลสถานะทั้งหมด) ───────────────
function beginTurn(gs, isFirst = false, guard = 0) {
  if (gs.gameOver || guard > gs.players.length * 2) return;
  setActiveGS(gs);
  const p = gs.players[gs.currentTurn];
  if (!p || !p.alive) { advancePointer(gs); return beginTurn(gs, isFirst, guard + 1); }

  // ─── ชาร์จความเร็ว (SPD) ───────────────────────────────────────────────────
  //   ถ้าเทิร์นที่ผ่านมา "ไม่ได้เดิน และ ไม่โดนความเสียหาย" → ชาร์จ SPD +1 (สูงสุด +2)
  //   ถ้าเดิน/โจมตี/โดนตี → รีเซ็ตกลับค่าเริ่มต้น (จัดการในแอกชันที่เกี่ยวข้อง)
  if (!isFirst) {
    if (!p._movedSinceTurn && !p._damagedSinceTurn) {
      p._spdCharge = Math.min(2, (p._spdCharge || 0) + 1);
    } else {
      p._spdCharge = 0;
    }
  }
  const wasDamaged = p._damagedSinceTurn;
  p._movedSinceTurn = false;
  p._damagedSinceTurn = false;
  p._hpLostThisRound = 0;                 // รีเซ็ตตัวนับ "ขวานโลหิตราชัน" (rage)
  // ลดคูลดาวน์อาวุธ (เช่น หอกเขี้ยวมังกรดำ)
  if (p._cooldowns) for (const k of Object.keys(p._cooldowns)) { p._cooldowns[k] = Math.max(0, p._cooldowns[k] - 1); }
  if (p._disarmTurns) p._disarmTurns = Math.max(0, p._disarmTurns - 1);

  // ฟื้นมานา — ม่านหมอก: เติมเต็มหลอด; ปกติ: +1
  if (gs.fogActive) {
    p.mana = p.maxMana;
  } else {
    p.mana = Math.min(p.maxMana, p.mana + 1);
  }

  // ฟื้นฟูต่อเนื่อง (regen) + regen_safe (เกราะกลีบบัวทอง — ฟื้นถ้าไม่โดนตี)
  let regen = 0;
  for (const s of (p.statusEffects || [])) if (s.type === "regen") regen += s.value || 1;
  if (!wasDamaged) for (const e of (p.equipment || [])) if (e.effect === "regen_safe" && isGearActive(p, e, gs)) regen += e.val || 1;
  if (regen > 0 && p.hp < p.maxHp) {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + regen);
    pushLog(gs, `🌿 ${p.name} ฟื้นฟู HP+${p.hp - before}`, "heal");
  }

  // พิษ/ไฟไหม้/สาป (DOT)
  let dot = 0;
  for (const s of (p.statusEffects || [])) if (s.type === "poison" || s.type === "burn" || s.type === "curse") dot += s.value || 1;
  if (dot > 0) {
    p.hp = Math.max(0, p.hp - dot);
    pushLog(gs, `🩸 ${p.name} เสีย HP-${dot} จากพิษ/ไฟไหม้/คำสาป`, "dmg");
    if (p.hp <= 0) { killPlayer(gs, p); advancePointer(gs); return beginTurn(gs, isFirst, guard + 1); }
  }
  // ภาษีเงามืด (กับดัก) — จ่ายเหรียญต่อเทิร์น
  for (const s of (p.statusEffects || [])) if (s.type === "gold_tax") { const g = Math.min(p.gold, s.value || 2); p.gold -= g; if (g > 0) pushLog(gs, `🏷️ ${p.name} จ่ายภาษีเงามืด ${g} เหรียญ`, "dmg"); }
  // หมึกพิษกัดการ์ด (card_rot) — ทิ้งการ์ด 1 ใบ/เทิร์น
  for (const s of (p.statusEffects || [])) if (s.type === "card_rot" && p.hand.length) { const c = p.hand.splice(Math.floor(Math.random() * p.hand.length), 1)[0]; pushLog(gs, `🥃 การ์ด "${c.name}" ของ ${p.name} เน่าเสีย`, "dmg"); }

  const frozen = hasStatus(p, "freeze") || hasStatus(p, "stun");
  const locked = hasStatus(p, "lock") || hasStatus(p, "trip");
  const slowed = hasStatus(p, "slow");
  const moveBudget = (frozen || locked) ? 0 : (slowed ? Math.max(1, Math.floor(BASE_MOVE_BUDGET / 2)) : BASE_MOVE_BUDGET);
  gs.actionsDone = frozen
    ? { moved: true, moveLeft: 0, attacked: true, cardsPlayed: MAX_CARDS_PER_TURN, _firstAttacked: true }
    : { moved: locked, moveLeft: moveBudget, attacked: false, cardsPlayed: 0, _firstAttacked: false };

  // passive: ตาเหยี่ยว (archer) — เซ็ต hawkEye active ตอนเริ่มเทิร์น, ยกเลิกเมื่อเดิน
  p._hawkEyeActive = (p.charId === "archer");
  if (frozen) pushLog(gs, `🧊 ${p.name} ถูกแช่แข็ง/มึน — ข้ามเทิร์น`, "event");
  else if (locked) pushLog(gs, `🕸️ ${p.name} ถูกล็อก/สะดุด — เดินไม่ได้เทิร์นนี้`, "event");
  else if (slowed) pushLog(gs, `🐌 ${p.name} เคลื่อนที่ช้า — งบเดินลดครึ่ง`, "event");

  // ลดอายุสถานะ + ลบที่หมด + คำนวณสเตตัสใหม่
  p.statusEffects = (p.statusEffects || []).map(s => ({ ...s, duration: s.duration - 1 })).filter(s => s.duration > 0);
  recomputeStats(p, gs);

  // passive: ผู้บัญชาการ (general) — HP เต็ม ล้างสถานะลบทั้งหมด
  if (p.charId === "general" && p.hp === p.maxHp) {
    const negTypes = new Set(["poison","burn","blind","freeze","lock","stun","trip","slow","curse"]);
    const hadNeg = (p.statusEffects || []).some(s => negTypes.has(s.type));
    if (hadNeg) {
      p.statusEffects = (p.statusEffects || []).filter(s => !negTypes.has(s.type));
      recomputeStats(p, gs);
      pushLog(gs, `🪖 ${p.name} ผู้บัญชาการ: HP เต็ม — ล้างสถานะลบทั้งหมด!`, "event");
    }
  }

  // ─── จั่วเริ่มเทิร์น: หยิบจากกองจั่ว 2 ใบ (ความลุ้น) ───
  let drawN = 2 + (p._drawMod || 0);     // เหตุการณ์อาจปรับจำนวนจั่ว
  p._drawMod = 0;
  if (hasStatus(p, "no_draw")) { drawN = 0; pushLog(gs, `🚫 ${p.name} ฝันร้าย — จั่วการ์ดไม่ได้เทิร์นนี้`, "event"); }
  // กับดักไฟแผดการ์ด — เผาการ์ดที่จะจั่ว
  if (p._burnDraw > 0 && drawN > 0) { const burn = Math.min(p._burnDraw, drawN); drawN -= burn; p._burnDraw -= burn; if (burn > 0) pushLog(gs, `🔥 ${p.name} การ์ด ${burn} ใบถูกเผาก่อนจั่ว`, "dmg"); }
  const drew = [];
  for (let i = 0; i < Math.max(0, drawN); i++) drew.push(drawRandomCard());
  p.justDrew = drew.map(c => c.uid);   // client ใช้สำหรับแอนิเมชันเปิดไพ่
  for (const c of drew) p.hand.push(c);
  if (drew.length) pushLog(gs, `🎴 ${p.name} จั่วการ์ดเริ่มเทิร์น ${drew.length} ใบ`, "");
  enforceHandLimit(p);
  if (p.pendingDiscard > 0) pushLog(gs, `🗑️ ${p.name} ถือไพ่เกินลิมิต — ต้องเลือกทิ้ง ${p.pendingDiscard} ใบ`, "");
}

function advancePointer(gs) {
  const n = gs.turnOrder.length;
  for (let i = 0; i < n; i++) {
    gs.turnPointer = (gs.turnPointer + 1) % n;
    const idx = gs.turnOrder[gs.turnPointer];
    if (gs.players[idx]?.alive) { gs.currentTurn = idx; return; }
  }
}

// ─── PHASE ADVANCE ───────────────────────────────────────────────────────────
function onPhaseAdvance(gs) {
  setActiveGS(gs);
  gs.phase += 1;

  // เกินจำนวนเฟส → โหมดบอส
  if (gs.phase > gs.maxPhases) {
    gs.bossMode = true;
    gs.fogActive = false;
    if (gs.phase === gs.maxPhases + 1)
      pushLog(gs, `⚠️ ครบ ${gs.maxPhases} เฟสแล้ว! บอสปรากฏตัว — ทุกเทิร์นจะมีบอสโจมตีแรงขึ้นเรื่อยๆ`, "win");
    return;
  }

  // ม่านหมอก + เวลา สลับตามเฟส (เฟสคู่ = หมอก/กลางคืน, เฟสคี่ = ปกติ/กลางวัน)
  gs.fogActive = gs.phase % 2 === 0;
  gs.timeOfDay = gs.phase % 2 === 0 ? "night" : "day";

  // ─── การ์ดเหตุการณ์ท้ายเฟส: เปิด 1–3 ใบ (สุ่มจำนวนตามเฟส) ───
  //   เฟสยิ่งสูง ยิ่งมีโอกาสเปิดหลายใบ (1–2 ช่วงต้น · สูงสุด 3 ช่วงปลาย)
  const maxReveal = gs.phase <= 2 ? 2 : 3;
  const count = 1 + Math.floor(Math.random() * maxReveal);
  const cards = drawEventCards(count);
  pushLog(gs, `📜 จบเฟส ${gs.phase - 1} → เฟส ${gs.phase} (${gs.timeOfDay === "night" ? "🌙 กลางคืน" : "☀️ กลางวัน"}${gs.fogActive ? " · 🌫️ หมอก" : ""}) — เปิดการ์ดเหตุการณ์ ${cards.length} ใบ`, "event");
  for (const ev of cards) {
    pushLog(gs, `🎴 เหตุการณ์: ${ev.ico} ${ev.name} — ${ev.desc}`, "event");
    applyEventCard(gs, ev);
  }
  // ส่งให้ client โชว์ modal การ์ดเหตุการณ์
  gs.eventReveal = { id: ++gs._eventSeq, phase: gs.phase, cards: cards.map(c => ({ id: c.id, name: c.name, ico: c.ico, desc: c.desc })) };
  // หมายเหตุ: การจั่วการ์ดปกติย้ายไปเป็น "จั่วเริ่มเทิร์น 2 ใบ" ใน beginTurn() แล้ว
}

// ─── EVENT CARD EFFECTS — ประมวลผลการ์ดเหตุการณ์ 1 ใบ ───────────────────────
function applyEventCard(gs, ev) {
  setActiveGS(gs);
  const alive = () => gs.players.filter(p => p.alive);
  const p = ev.p || {};
  const dice = () => 1 + Math.floor(Math.random() * 6);
  const byHp = (most) => {
    const a = alive(); if (!a.length) return null;
    return a.reduce((x, y) => (most ? (y.hp > x.hp ? y : x) : (y.hp < x.hp ? y : x)));
  };
  const giveMagic = (pl) => giveCard(pl, drawRandomCard(MAGIC_POOL), gs);
  const giveWeapon = (pl) => giveCard(pl, drawRandomCard(WEAPON_POOL), gs);

  switch (ev.fx) {
    case "buff_all":
      for (const x of alive()) {
        addStatus(x, p.status, p.dur || 1, p.val || 0, gs);
        if (p.also) addStatus(x, p.also, p.dur || 1, p.alsoVal || 0, gs);
      }
      break;
    case "dmg_all":
      for (const x of alive()) {
        let dmg = p.val || 1;
        if (p.armorReduce && hasMetalArmor(x)) dmg = Math.max(0, dmg - p.armorReduce);
        applyDamage(gs, x, dmg, ev.name);
        if (x.hp <= 0) killPlayer(gs, x);
      }
      break;
    case "heal_all":
      for (const x of alive()) x.hp = Math.min(x.maxHp, x.hp + (p.val || 2));
      break;
    case "heal_all_cleanse":
      for (const x of alive()) {
        x.hp = Math.min(x.maxHp, x.hp + (p.val || 2));
        x.statusEffects = (x.statusEffects || []).filter(s => !(p.types || []).includes(s.type));
        recomputeStats(x, gs);
      }
      break;
    case "gold_all": {
      const rich = p.richest != null ? byHp(true) : null;
      for (const x of alive()) x.gold += (x === rich ? p.richest : (p.val || 0));
      break;
    }
    case "dmg_random": {
      const a = alive(); if (!a.length) break;
      const t = a[Math.floor(Math.random() * a.length)];
      applyDamage(gs, t, p.val || 3, ev.name); if (t.hp <= 0) killPlayer(gs, t);
      pushLog(gs, `🎯 ${t.name} ตกเป็นเป้า — เสีย HP ${p.val}`, "dmg");
      break;
    }
    case "give_weapon_all": for (const x of alive()) giveWeapon(x); break;
    case "give_weapon_dmg": for (const x of alive()) { giveWeapon(x); applyDamage(gs, x, p.dmg || 2, ev.name); if (x.hp <= 0) killPlayer(gs, x); } break;
    case "give_magic_fewest": {
      const a = alive(); if (!a.length) break;
      const cnt = (pl) => pl.hand.filter(c => c.type === "magic").length;
      const t = a.reduce((x, y) => (cnt(y) < cnt(x) ? y : x));
      for (let i = 0; i < (p.val || 2); i++) giveMagic(t);
      pushLog(gs, `🧙 ${t.name} ได้การ์ดเวทย์ ${p.val} ใบ`, "event");
      break;
    }
    case "reveal_top_all": for (const x of alive()) x._revealTop = true; break;
    case "peek_top_self": break; // ผลเชิงข้อมูล — ผู้เล่นดูเอง (client)
    case "no_draw_all": for (const x of alive()) addStatus(x, "no_draw", p.dur || 1, 0, gs); break;
    case "acid_storm":
      for (const x of alive()) {
        if (hasMetalArmor(x)) addStatus(x, "armor_break", p.dur || 2, 1, gs);
        else { applyDamage(gs, x, p.val || 2, ev.name); if (x.hp <= 0) killPlayer(gs, x); }
      }
      break;
    case "war_horn":
      for (const x of alive()) {
        const hasWeapon = (x.equipment || []).some(e => e.slot === "weapon");
        if (hasWeapon) addStatus(x, "atk_up", p.dur || 2, p.atk || 1, gs);
        else { applyDamage(gs, x, p.dmg || 3, ev.name); if (x.hp <= 0) killPlayer(gs, x); }
      }
      break;
    case "heal_low_dmg_high": {
      const lo = byHp(false), hi = byHp(true);
      if (lo) lo.hp = Math.min(lo.maxHp, lo.hp + (p.heal || 5));
      if (hi && hi !== lo) { applyDamage(gs, hi, p.dmg || 1, ev.name); if (hi.hp <= 0) killPlayer(gs, hi); }
      break;
    }
    case "trade_hp_mana":
      for (const x of alive()) { applyDamage(gs, x, p.hp || 1, ev.name); x.mana = Math.min(x.maxMana, x.mana + (p.mana || 2)); if (x.hp <= 0) killPlayer(gs, x); }
      break;
    case "atk_halve_all":
      for (const x of alive()) addStatus(x, "atk_down", p.dur || 2, Math.ceil(x.atk / 2), gs);
      break;
    case "price_up": gs._priceMod = { val: p.val || 2, until: gs.phase + (p.dur || 2) }; break;
    case "draw_swing": {
      const hi = byHp(true);
      for (const x of alive()) {
        if (x === hi) x._drawMod = (x._drawMod || 0) + (p.highest || -1);
        else x._drawMod = (x._drawMod || 0) + (p.others || 1);
      }
      break;
    }
    case "zombie":
      for (const x of alive()) {
        const d = x.hand.some(c => c.type === "magic") ? (p.magic || 2) : (p.base || 1);
        applyDamage(gs, x, d, ev.name); if (x.hp <= 0) killPlayer(gs, x);
      }
      break;
    case "clear_discard": gs._discard = []; break;
    case "challenge_strongest": {
      const a = alive(); if (!a.length) break;
      const strongest = a.reduce((x, y) => (y.atk > x.atk ? y : x));
      if (dice() >= 4) { strongest.gold += p.gold || 3; pushLog(gs, `🛡️ ${strongest.name} ชนะนักรบต่างแดน +${p.gold} ทอง`, "event"); }
      else { const wi = (strongest.equipment || []).findIndex(e => e.slot === "weapon"); if (wi >= 0) { const w = strongest.equipment.splice(wi, 1)[0]; recomputeStats(strongest, gs); pushLog(gs, `🛡️ ${strongest.name} แพ้ เสียอาวุธ "${w.name}"`, "dmg"); } }
      break;
    }
    case "pass_left": {
      const a = alive(); if (a.length < 2) break;
      const taken = a.map(x => x.hand.length ? x.hand.splice(Math.floor(Math.random() * x.hand.length), 1)[0] : null);
      for (let i = 0; i < a.length; i++) { const card = taken[i]; if (card) { const left = a[(i + 1) % a.length]; left.hand.push(card); enforceHandLimit(left); } }
      pushLog(gs, `🤝 ทุกคนส่งการ์ด 1 ใบให้ผู้เล่นทางซ้าย`, "event");
      break;
    }
    case "expose_hand": for (const x of alive()) addStatus(x, "exposed", p.dur || 1, p.val || 2, gs); break;
    case "draw_then_discard":
      for (const x of alive()) { for (let i = 0; i < (p.draw || 3); i++) giveCard(x, drawRandomCard(), gs); x.pendingDiscard = Math.max(x.pendingDiscard || 0, p.discard || 2); }
      break;
    case "dice_each":
      for (const x of alive()) {
        const r = dice();
        if (p.jackpot && r === p.jackpot) { if (p.jackpotReward?.magic) for (let i = 0; i < p.jackpotReward.magic; i++) giveMagic(x); pushLog(gs, `🎲${r} ${x.name} แจ็คพอต! ได้เวทย์ฟรี`, "event"); }
        else if (p.lowThresh && r < p.lowThresh) { applyDamage(gs, x, p.lose?.hp || 3, ev.name); if (x.hp <= 0) killPlayer(gs, x); }
        else if (p.pass && r >= p.pass) { if (p.win?.weapon) giveWeapon(x); if (p.win?.gold) x.gold += p.win.gold; }
        else if (p.pass && r < p.pass) { if (p.lose?.hp) { applyDamage(gs, x, p.lose.hp, ev.name); if (x.hp <= 0) killPlayer(gs, x); } }
      }
      break;
    case "dice_lowest_skip": {
      const a = alive(); if (!a.length) break;
      let lowest = null, low = 99;
      for (const x of a) { const r = dice(); if (r < low) { low = r; lowest = x; } }
      if (lowest) { addStatus(lowest, "freeze", 1, 0, gs); pushLog(gs, `🥁 ${lowest.name} ทอยต่ำสุด — ข้ามเทิร์นถัดไป`, "event"); }
      break;
    }
    case "dice_highest": {
      const hi = byHp(true); if (!hi) break;
      const r = dice();
      if (r >= (p.pass || 4)) { if (p.win?.gold) hi.gold += p.win.gold; pushLog(gs, `🐲 ${hi.name} 🎲${r} ชนะมังกรทอง +${p.win?.gold} ทอง`, "event"); }
      else { if (p.lose?.hp) { applyDamage(gs, hi, p.lose.hp, ev.name); if (hi.hp <= 0) killPlayer(gs, hi); } }
      break;
    }
    case "push_all":
      for (const x of alive()) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const [dc, dr] = dirs[Math.floor(Math.random() * dirs.length)];
        const nc = x.col + dc * (p.dist || 2), nr = x.row + dr * (p.dist || 2);
        const cell = gs.cells.find(c => c.col === nc && c.row === nr && c.terrain !== "water");
        if (cell) { x.col = nc; x.row = nr; }
        else { applyDamage(gs, x, p.wallDmg || 2, ev.name); if (x.hp <= 0) killPlayer(gs, x); }
      }
      break;
    case "redraw_all":
      for (const x of alive()) { const n = x.hand.length; x.hand = []; for (let i = 0; i < n; i++) x.hand.push(drawRandomCard()); enforceHandLimit(x); }
      break;
    case "plague":
      for (const x of alive()) {
        if (x.hp >= x.maxHp) { applyDamage(gs, x, p.dmg || 3, ev.name); if (x.hp <= 0) killPlayer(gs, x); }
        else addStatus(x, "shield", p.shieldDur || 1, 1, gs);
      }
      break;
    case "self_shadow":
      for (const x of alive()) { const d = Math.floor(x.atk / 2); if (d > 0) { applyDamage(gs, x, d, ev.name); if (x.hp <= 0) killPlayer(gs, x); } }
      break;
    case "metal_sell_bonus": for (const x of alive()) if (hasMetalArmor(x)) x._sellBonus = p.val || 3; break;
    case "recover_discard":
      for (const x of alive()) { const d = gs._discard || []; if (d.length) { const c = d.pop(); giveCard(x, { ...c, uid: makeUid() }, gs); } }
      break;
    case "cold_wind":
      for (const x of alive()) { const hasArmor = (x.equipment || []).some(e => METAL_SLOTS.has(e.slot)); if (!hasArmor) { applyDamage(gs, x, p.val || 3, ev.name); if (x.hp <= 0) killPlayer(gs, x); } }
      break;
    case "free_magic_all": for (const x of alive()) addStatus(x, "free_magic", p.dur || 1, 0, gs); break;
    case "discard_all":
      for (const x of alive()) { let n = p.val || 1; while (n-- > 0 && x.hand.length) x.hand.splice(Math.floor(Math.random() * x.hand.length), 1); }
      break;
    case "quake":
      for (const x of alive()) { const edge = x.col <= 0 || x.row <= 0 || x.col >= 12 || x.row >= 10; if (edge) { applyDamage(gs, x, p.val || 2, ev.name); if (x.hp <= 0) killPlayer(gs, x); } }
      break;
    case "cleanse_all":
      for (const x of alive()) { x.statusEffects = (x.statusEffects || []).filter(s => !NEG_STATUS.has(s.type)); recomputeStats(x, gs); }
      break;
    case "dmg_low_heal_high": {
      const lo = byHp(false), hi = byHp(true);
      if (lo) { applyDamage(gs, lo, p.dmg || 3, ev.name); if (lo.hp <= 0) killPlayer(gs, lo); }
      if (hi && hi !== lo) hi.hp = Math.min(hi.maxHp, hi.hp + (p.heal || 2));
      break;
    }
    case "red_sky":
      for (const x of alive()) { applyDamage(gs, x, p.dmg || 1, ev.name); addStatus(x, "atk_up", p.dur || 2, p.atk || 2, gs); if (x.hp <= 0) killPlayer(gs, x); }
      break;
    case "throne_judgment": {
      const a = alive(); if (!a.length) break;
      const max = Math.max(...a.map(x => x.hand.length)), min = Math.min(...a.map(x => x.hand.length));
      if (max === min) { for (const x of a) { applyDamage(gs, x, 1, ev.name); if (x.hp <= 0) killPlayer(gs, x); } }
      else for (const x of a) {
        if (x.hand.length === max) { let n = Math.floor(x.hand.length / 2); while (n-- > 0 && x.hand.length) x.hand.splice(Math.floor(Math.random() * x.hand.length), 1); }
        else if (x.hand.length === min) { for (let i = 0; i < 2; i++) giveCard(x, drawRandomCard(), gs); }
      }
      break;
    }
    default:
      pushLog(gs, `(เหตุการณ์ "${ev.name}" เป็นผลเชิงบรรยากาศ)`, "event");
      break;
  }
}

// ─── BOSS ATTACK (ทุกเทิร์นในโหมดบอส) ───────────────────────────────────────
function bossTurn(gs) {
  setActiveGS(gs);
  gs.bossLevel += 1;
  const boss = BOSS_TYPES[Math.floor(Math.random() * BOSS_TYPES.length)];
  const dmg = 2 + gs.bossLevel; // แรงขึ้นเรื่อยๆ
  pushLog(gs, `${boss.ico} ${boss.name} โจมตี! ทุกคนเสีย HP-${dmg} (บอสเลเวล ${gs.bossLevel})`, "dmg");

  const aliveBefore = gs.players.filter(p => p.alive);
  // กันเสมอ: ถ้าบอสจะกวาดล้างทุกคนพร้อมกัน → คนเลือดมากสุดรอดด้วย HP 1 (เป็นผู้ชนะ)
  const survivor = aliveBefore.every(p => p.hp - dmg <= 0) && aliveBefore.length > 0
    ? aliveBefore.reduce((a, b) => (b.hp > a.hp ? b : a))
    : null;

  for (const p of gs.players) {
    if (!p.alive) continue;
    if (p === survivor) { p.hp = 1; pushLog(gs, `🛡️ ${p.name} รอดจากบอสอย่างหวุดหวิด (HP เหลือ 1)!`, "heal"); continue; }
    p.hp = Math.max(0, p.hp - dmg);
    if (p.hp <= 0) killPlayer(gs, p);
  }
}

// ─── Win Check ──────────────────────────────────────────────────────────────
function checkWinServer(gs) {
  if (gs.gameOver) return;
  if (gs.traitorOfferPending) return; // รอผู้เล่นตัดสินใจก่อน

  const alive = gs.players.filter(p => p.alive);
  const king = gs.players.find(p => p.role === "king");
  const rebels = gs.players.filter(p => p.role === "rebel");
  const traitors = gs.players.filter(p => p.role === "traitor");
  const commons = gs.players.filter(p => p.role === "commoner");

  // ─── ราชายังมีชีวิต ──────────────────────────────────────────────────────
  if (king?.alive) {
    const allRebelsDead = rebels.every(r => !r.alive);
    const allTraitorsDead = traitors.every(t => !t.alive);
    if (allRebelsDead && allTraitorsDead) {
      const winners = [king, ...commons.filter(c => c.alive)];
      gs.gameOver = { winner: "king", reason: "พระราชาปราบกบฏทั้งหมด! 👑", players: winners };
      pushLog(gs, `🏆 พระราชาชนะ! ปราบกบฏและทรยศสำเร็จ!`, "win");
      return;
    }
  }

  // ─── ราชาตายแล้ว ─────────────────────────────────────────────────────────
  if (king && !king.alive) {
    if (traitors.length > 0) {
      // มีทรยศ — ทรยศ vs กบฏ
      if (traitors.every(t => !t.alive) && rebels.some(r => r.alive)) {
        gs.gameOver = { winner: "rebel", reason: "กบฏโค่นบัลลังก์และสังหารทรยศ! 🏴", players: rebels.filter(r => r.alive) };
        pushLog(gs, `🏆 กบฏชนะ! เอาชนะทุกฝ่ายสำเร็จ!`, "win");
        return;
      }
      if (rebels.every(r => !r.alive) && traitors.some(t => t.alive)) {
        const winner = traitors.find(t => t.alive);
        gs.gameOver = { winner: "traitor", reason: `${winner.name} — ทรยศรอดคนสุดท้าย! 🗡️`, players: [winner] };
        pushLog(gs, `🏆 ทรยศชนะ! กำจัดทุกฝ่ายสำเร็จ!`, "win");
        return;
      }
    } else {
      // ไม่มีทรยศ — กบฏชนะเมื่อราชาตาย (ราษฎรแพ้ไปแล้วตอน resolveTraitorOffer)
      if (rebels.some(r => r.alive)) {
        gs.gameOver = { winner: "rebel", reason: "กบฏโค่นบัลลังก์! 🏴", players: rebels.filter(r => r.alive) };
        pushLog(gs, `🏆 กบฏชนะ! โค่นบัลลังก์สำเร็จ!`, "win");
        return;
      }
    }
  }

  // ─── รอดคนสุดท้าย ────────────────────────────────────────────────────────
  if (alive.length === 1) {
    const last = alive[0];
    gs.gameOver = { winner: last.role, reason: `${last.name} รอดคนสุดท้าย!`, players: [last] };
    pushLog(gs, `🏆 ${last.name} ชนะ! รอดคนสุดท้าย!`, "win");
    return;
  }
  if (alive.length === 0) {
    gs.gameOver = { winner: "draw", reason: "ทุกคนล้มลง — ไม่มีผู้ชนะ", players: [] };
    pushLog(gs, `⚰️ ทุกคนล้มลง — เสมอ`, "win");
  }
}

// ─── REACTIVE INTERRUPT (หลบ/บล็อก การ์ดโจมตี) ──────────────────────────────
//   เมื่อมีผู้ใช้การ์ดโจมตีที่ dodgeable/blockable → หยุดรอให้เป้าหมายแต่ละคน
//   เลือก "หลบ (ลมเวทย์หลบภัย)" / "บล็อก (พลังเวทย์พื้นฐาน)" หรือ "รับการโจมตี"
const INTERRUPT_TIMEOUT_MS = 15000;

function startAttackCard(gs, code, ws, cp, card, cardIdx, { targetPlayer, targetCell }) {
  const cost = card.cost || 0;
  if (cp.mana < cost) return send(ws, { type: "error", msg: "มานาไม่พอ" });
  if (hasStatus(cp, "silence") || hasStatus(cp, "spell_lock")) return send(ws, { type: "error", msg: "ใช้เวทย์ไม่ได้ (ถูกสะกด/กรงเวทย์)" });
  if (card.target === "enemy") {
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.id === cp.id) return send(ws, { type: "error", msg: "ต้องเลือกศัตรูเป็นเป้าหมาย" });
    if (hexDistanceServer(cp.col, cp.row, targetPlayer.col, targetPlayer.row) > (card.range ?? 4)) return send(ws, { type: "error", msg: "เป้าหมายไกลเกินระยะเวทย์" });
  }
  if (card.aoeMode === "line" && !targetCell) return send(ws, { type: "error", msg: "เลือกทิศทาง (ช่องปลายเส้น)" });
  if (card.aoeMode === "pointRadius" && card.byTile && !targetCell) return send(ws, { type: "error", msg: "เลือกจุดศูนย์กลาง" });

  const targets = computeMagicTargets(gs, cp, card, CARD_CTX, { targetPlayer, targetCell });

  // commit: จ่ายมานา + เอาการ์ดออกมือ + กินแอกชัน (ก่อนเข้าระบบตอบโต้)
  cp.mana -= cost;
  const [played] = cp.hand.splice(cardIdx, 1);
  if (played) gs._discard.push(played);
  enforceHandLimit(cp);
  gs.actionsDone.cardsPlayed = (gs.actionsDone.cardsPlayed || 0) + 1;

  const entries = [];
  for (const t of targets) {
    if (!t.alive) continue;
    if (consumeDodge(gs, t)) { entries.push({ id: t.id, action: "auto_dodge", resolved: true }); pushLog(gs, `🌬️ ${t.name} หลบด้วยลมเวทย์ที่เตรียมไว้!`, "event"); continue; }
    const canDodge = t.hand.some(c => c.id === "wind_dodge");
    const canBlock = !!card.blockable && t.hand.some(c => c.id === "mana_bolt");
    if (canDodge || canBlock) entries.push({ id: t.id, action: null, resolved: false, canDodge, canBlock });
    else entries.push({ id: t.id, action: "hit", resolved: true });
  }

  const caster = cp;
  if (!entries.some(e => !e.resolved)) {
    resolveAttackCard(gs, code, caster, card, { targetCell }, entries);
    return;
  }

  gs.pendingInterrupt = {
    id: ++gs._eventSeq, casterId: cp.id, casterName: cp.name,
    card: { id: card.id, name: card.name, ico: card.ico, dmg: card.dmg, element: card.element, effect: card.effect, dur: card.dur, val: card.val, lifedrain: card.lifedrain, target: card.target, aoeMode: card.aoeMode, range: card.range, byTile: card.byTile, blockable: card.blockable, dodgeable: card.dodgeable },
    targetCell: targetCell ? { col: targetCell.col, row: targetCell.row } : null,
    entries,
  };
  pushLog(gs, `⏳ ${cp.name} ใช้ "${card.name}" — รอผู้เล่นเป้าหมายตอบโต้ (หลบ/บล็อก)...`, "event");
  broadcastGameState(code);
  const iid = gs.pendingInterrupt.id;
  if (gs._interruptTimer) clearTimeout(gs._interruptTimer);
  gs._interruptTimer = setTimeout(() => autoResolveInterrupt(code, iid), INTERRUPT_TIMEOUT_MS);
}

function resolveAttackCard(gs, code, caster, card, { targetCell }, entries) {
  setActiveGS(gs);
  for (const e of entries) {
    const t = gs.players[e.id];
    if (!t || !t.alive) continue;
    if (e.action === "hit") {
      applyAttackToTarget(gs, caster, card, CARD_CTX, t, { isAoe: card.target === "aoe" });
    } else {
      pushLog(gs, `🛡️ ${t.name} ${e.action === "block" ? "บล็อก" : "หลบ"} "${card.name}" สำเร็จ!`, "event");
    }
  }
  gs.pendingInterrupt = null;
  if (gs._interruptTimer) { clearTimeout(gs._interruptTimer); gs._interruptTimer = null; }
  checkWinServer(gs);
  broadcastGameState(code);
}

function autoResolveInterrupt(code, iid) {
  const room = rooms[code];
  if (!room?.gameState) return;
  const gs = room.gameState;
  const pi = gs.pendingInterrupt;
  if (!pi || pi.id !== iid) return;
  setActiveGS(gs);
  for (const e of pi.entries) if (!e.resolved) { e.action = "hit"; e.resolved = true; }
  pushLog(gs, `⏳ หมดเวลาตอบโต้ — การโจมตี "${pi.card.name}" ลงเป้าหมายที่เหลือ`, "event");
  const caster = gs.players[pi.casterId];
  const tc = pi.targetCell ? gs.cells.find(c => c.col === pi.targetCell.col && c.row === pi.targetCell.row) : null;
  resolveAttackCard(gs, code, caster, pi.card, { targetCell: tc }, pi.entries);
}

// ─── Game Action Handler ─────────────────────────────────────────────────────
function handleGameAction(ws, msg) {
  const info = clients.get(ws);
  if (!info?.code) return;
  const room = rooms[info.code];
  if (!room || !room.gameState) return;
  const gs = room.gameState;
  setActiveGS(gs);
  const { action, payload } = msg;

  // เลือกเควส — ทำได้ทุกเมื่อ (ไม่ต้องเป็นเทิร์นตัวเอง)
  if (action === "pick_quest") {
    const me = gs.players[info.playerIdx];
    if (!me || me.quest) return;
    const choice = (me.questChoices || []).find(q => q.id === payload?.questId);
    if (!choice) return send(ws, { type: "error", msg: "เควสไม่ถูกต้อง" });
    me.quest = { ...choice, progress: 0, done: false };
    me.questChoices = null;
    return broadcastGameState(info.code);
  }

  // ── ตอบโต้การโจมตี (หลบ/บล็อก) — ทำได้แม้ไม่ใช่เทิร์นตัวเอง ─────────────────
  if (action === "interrupt_respond") {
    const pi = gs.pendingInterrupt;
    if (!pi) return;
    const meIdx = info.playerIdx;
    const entry = pi.entries.find(e => e.id === meIdx && !e.resolved);
    if (!entry) return send(ws, { type: "error", msg: "คุณไม่มีการตอบโต้ที่ต้องทำ" });
    const meP = gs.players[meIdx];
    const respUid = payload?.cardUid;
    if (respUid) {
      const ci = meP.hand.findIndex(c => c.uid === respUid);
      const rc = meP.hand[ci];
      const isDodge = rc && rc.id === "wind_dodge" && entry.canDodge;
      const isBlock = rc && rc.id === "mana_bolt" && entry.canBlock;
      if (ci < 0 || (!isDodge && !isBlock)) return send(ws, { type: "error", msg: "การ์ดตอบโต้ไม่ถูกต้อง" });
      meP.hand.splice(ci, 1); gs._discard.push(rc); enforceHandLimit(meP);
      entry.action = isBlock ? "block" : "dodge"; entry.resolved = true;
      pushLog(gs, `🛡️ ${meP.name} ${isBlock ? "บล็อกด้วยพลังเวทย์" : "หลบด้วยลมเวทย์"}!`, "event");
    } else {
      entry.action = "hit"; entry.resolved = true;
      pushLog(gs, `💢 ${meP.name} เลือกรับการโจมตี`, "event");
    }
    if (pi.entries.every(e => e.resolved)) {
      if (gs._interruptTimer) { clearTimeout(gs._interruptTimer); gs._interruptTimer = null; }
      const caster = gs.players[pi.casterId];
      const tc = pi.targetCell ? gs.cells.find(c => c.col === pi.targetCell.col && c.row === pi.targetCell.row) : null;
      resolveAttackCard(gs, info.code, caster, pi.card, { targetCell: tc }, pi.entries);
    } else {
      broadcastGameState(info.code);
    }
    return;
  }

  // ระหว่างรอตอบโต้การโจมตี → บล็อกแอกชันอื่นทั้งหมด
  if (gs.pendingInterrupt) return send(ws, { type: "error", msg: "⏳ รอการตอบโต้การโจมตีให้เสร็จก่อน" });

  if (gs.currentTurn !== info.playerIdx) return send(ws, { type: "error", msg: "ไม่ใช่เทิร์นของคุณ" });
  const cp = gs.players[gs.currentTurn];
  if (!cp || !cp.alive) return;

  switch (action) {
    // ── เดิน ───────────────────────────────────────────────────
    case "move": {
      const moveLeft = gs.actionsDone.moveLeft ?? 0;
      if (moveLeft <= 0) return send(ws, { type: "error", msg: "ไม่มีระยะเดินเหลือ / ถูกล็อกในเทิร์นนี้" });
      const { col, row } = payload;
      // หักจาก "งบเดินที่เหลือ" — เดินเป็นช่วงๆ ได้ตราบใดที่งบยังเหลือ
      const costMap = getReachableCostMap(cp.col, cp.row, moveLeft, gs.cells);
      const stepCost = costMap.get(`${col},${row}`);
      if (stepCost === undefined) return send(ws, { type: "error", msg: `เดินไป (${col},${row}) ไม่ได้ — ไกลเกินงบเดินที่เหลือ` });
      const targetCell = gs.cells.find(c => c.col === col && c.row === row);
      if (!targetCell) return;

      cp.col = col; cp.row = row;
      gs.actionsDone.moveLeft = moveLeft - stepCost;
      gs.actionsDone.moved = true;
      // เดิน → ล้างการชาร์จความเร็ว (SPD กลับค่าเริ่มต้น) + จดว่าเทิร์นนี้ได้เดิน
      cp._movedSinceTurn = true;
      if (cp._spdCharge) cp._spdCharge = 0;
      // passive: ตาเหยี่ยว (archer) หมดเมื่อเดิน
      cp._hawkEyeActive = false;
      recomputeStats(cp);
      // passive: นักสำรวจ (zhenghe) ทอง +1 พิเศษทุกครั้งที่เดินเข้า zone
      if (cp.charId === "zhenghe" && targetCell.specialZone) {
        cp.gold += 1;
        pushLog(gs, `⛵ ${cp.name} นักสำรวจ: ทอง+1 พิเศษ`, "event");
      }
      pushLog(gs, `🚶 ${cp.name} → (${col},${row})`, "");

      // king skill: shadow_hunt / iron_fortress ข้ามผลกระทบ zone
      if (!cp._skipZoneEffect) {
        const hpBefore = cp.hp;
        applyZoneEffectServer(cp, targetCell, gs);
        // passive: พรแสงสว่าง (cleric) / รู้จักสมุนไพร (herbalist) — bonus +1 HP เมื่อ zone รักษา
        const healed = cp.hp - hpBefore;
        if (healed > 0 && (cp.charId === "cleric" || cp.charId === "herbalist")) {
          cp.hp = Math.min(cp.maxHp, cp.hp + 1);
          pushLog(gs, `✨ ${cp.name} passive: HP+1 พิเศษจากสมุนไพร`, "heal");
        }
        applyRandomZoneEvent(cp, targetCell, gs);
      } else {
        cp._skipZoneEffect = false;
        pushLog(gs, `🌑 ${cp.name} ข้ามผลกระทบ zone (สกิลราชา)`, "event");
      }
      checkQuestProgress(cp, targetCell, gs);

      // กับดัก — ใครก็ตามที่เดินเข้ามา (รวมเจ้าของ) โดนผลทั้งหมด แล้วกับดักหายไป
      if (targetCell.trap) {
        triggerTrap(gs, cp, targetCell, CARD_CTX);
      }
      broadcastGameState(info.code);
      break;
    }

    // ── โจมตี ──────────────────────────────────────────────────
    case "attack": {
      if (gs.actionsDone.attacked) return send(ws, { type: "error", msg: "โจมตีไปแล้วในเทิร์นนี้" });
      const { targetId } = payload;
      const defender = gs.players[targetId];
      if (!defender || !defender.alive) return send(ws, { type: "error", msg: "เป้าหมายไม่ถูกต้อง" });
      if (targetId === info.playerIdx) return;

      const dist = hexDistanceServer(cp.col, cp.row, defender.col, defender.row);
      if (dist > cp.range) {
        return send(ws, { type: "error", msg: cp.range === 0
          ? `ระยะปกติตีได้แค่ช่องเดียวกัน — ต้องสวมอุปกรณ์ระยะไกล (ห่าง ${dist})`
          : `ระยะไกลเกินไป (${dist} > ${cp.range})` });
      }

      // หอกเขี้ยวมังกรดำ (pierce_all) — คูลดาวน์ "ใช้แล้วพัก"
      const pierceGear = (cp.equipment || []).find(e => e.effect === "pierce_all" && isGearActive(cp, e, gs));
      if (pierceGear) {
        cp._cooldowns = cp._cooldowns || {};
        if ((cp._cooldowns[pierceGear.id] || 0) > 0)
          return send(ws, { type: "error", msg: `"${pierceGear.name}" กำลังพัก (อีก ${cp._cooldowns[pierceGear.id]} เทิร์น)` });
      }

      // passive: ซ่อนตัว (assassin) — โจมตีครั้งแรกข้ามเกราะ
      const stealthActive = cp.charId === "assassin" && !gs.actionsDone._firstAttacked;
      if (stealthActive) {
        const origDef = defender.def;
        defender.def = 0;
        var res = resolveAttack(cp, defender, gs);
        defender.def = origDef;
        recomputeStats(defender, gs);
      } else {
        var res = resolveAttack(cp, defender, gs);
      }
      gs.actionsDone.attacked = true;
      gs.actionsDone._firstAttacked = true;
      if (pierceGear) { cp._cooldowns[pierceGear.id] = pierceGear.cooldown || 1; }
      // โจมตี → ล้างการชาร์จความเร็ว (SPD กลับค่าเริ่มต้นหลังใช้ระยะที่ชาร์จไว้)
      if (cp._spdCharge) { cp._spdCharge = 0; recomputeStats(cp, gs); }

      // passive: ล่วงรู้ (oracle) — 25% หลบอัตโนมัติ
      if (res.hit && defender.charId === "oracle" && Math.random() < 0.25) {
        pushLog(gs, `🔮 ${defender.name} ล่วงรู้! หลบอัตโนมัติ!`, "event");
        res = { ...res, hit: false, dmg: 0 };
      }
      // ลมเวทย์หลบภัย (dodge_charge) — หลบการโจมตีอัตโนมัติ
      if (res.hit && consumeDodge(gs, defender)) {
        pushLog(gs, `🌬️ ${defender.name} ใช้ลมเวทย์หลบภัย หลบการโจมตี!`, "event");
        res = { ...res, hit: false, dmg: 0 };
      }

      if (!res.hit) {
        pushLog(gs, `🛡️ ${defender.name} หลบหลีก! (โจมตี🎲${res.atkRoll} vs หลบ${res.dodgeRoll})`, "event");
      } else {
        const el = res.element || "physical";
        let dealt = applyDamage(gs, defender, res.dmg, "โจมตี", el, cp);
        // ฟันสองครั้ง: double(ทอย6) · มีดกรงเล็บแมวป่า(double_hit -1) · ดาบคู่แฝด(twin)
        if (res.doubled) { dealt += applyDamage(gs, defender, res.dmg, "ฟันซ้ำ", el, cp); pushLog(gs, `⚔️✕2 ${cp.name} ฟันซ้ำ!`, "dmg"); }
        if (res.doubleHit) { dealt += applyDamage(gs, defender, Math.max(1, res.dmg - 1), "กรงเล็บคู่", el, cp); pushLog(gs, `🐾✕2 ${cp.name} ตะปบสองครั้ง!`, "dmg"); }
        if (res.twinStrike) { dealt += applyDamage(gs, defender, res.dmg, "ดาบคู่", el, cp); pushLog(gs, `⚔️⚔️ ${cp.name} ฟันดาบคู่พร้อมกัน!`, "dmg"); }
        pushLog(gs, `⚔️ ${cp.name} → ${defender.name}: ${dealt} ดาเมจ (🎲${res.atkRoll} vs หลบ${res.dodgeRoll})${res.crit ? " ✨คริต!" : ""}`, "dmg");

        // เอฟเฟกต์อาวุธที่สวมใส่ (ตอนตีโดน) — ใช้ชุด effect ที่ "ทำงานอยู่" เท่านั้น
        const fx = new Set(res.fxList || []);
        if (fx.has("burn"))       { addStatus(defender, "burn", 2, 1, gs); pushLog(gs, `🔥 ${defender.name} ติดไฟไหม้!`, "dmg"); }
        if (fx.has("freeze"))     { addStatus(defender, "freeze", 1, 0, gs); pushLog(gs, `❄️ ${defender.name} ถูกแช่แข็ง!`, "event"); }
        if (fx.has("poison_hit")) { addStatus(defender, "poison", 2, 1, gs); pushLog(gs, `☠️ ${defender.name} ติดพิษ!`, "dmg"); }
        if (fx.has("fist_stun") && Math.random() < 0.5) { addStatus(defender, "stun", 1, 0, gs); pushLog(gs, `🥊 ${defender.name} ถูกชกจนมึน!`, "event"); }
        if (fx.has("magic_lifesteal") && dealt > 0) { /* เฉพาะเวทย์ — จัดการใน cardEngine */ }
        // หอกสามแฉก (trident) ใกล้น้ำ — ฟาดเพิ่มอีก 2 เป้ารอบเป้าหมาย
        if (fx.has("trident")) {
          let extra = 0;
          for (const o of gs.players) {
            if (extra >= 2) break;
            if (!o.alive || o.id === cp.id || o.id === defender.id) continue;
            if (hexDistanceServer(defender.col, defender.row, o.col, o.row) <= 1) {
              const sd = applyDamage(gs, o, Math.max(1, res.dmg), "หอกสามแฉก", el, cp);
              if (sd > 0) pushLog(gs, `🔱 หอกสามแฉกแทง ${o.name} -${sd}`, "dmg");
              if (o.hp <= 0) killPlayer(gs, o);
              extra++;
            }
          }
        }
        // เกราะ/โล่สะท้อน (ฝ่ายตั้งรับ): reflect / spike
        for (const e of (defender.equipment || [])) {
          if (!isGearActive(defender, e, gs)) continue;
          if (e.effect === "reflect" || e.effect === "spike") {
            const back = e.val || 1;
            const rd = applyDamage(gs, cp, back, e.effect === "spike" ? "หนามสะท้อน" : "โล่สะท้อน", "physical", defender);
            if (rd > 0) pushLog(gs, `🔰 ${e.name} สะท้อน ${rd} ใส่ ${cp.name}!`, "dmg");
          }
          // โล่อกสิงห์ทอง (block_stun) — 30% ศัตรูเสียเทิร์น
          if (e.effect === "block_stun" && Math.random() < (e.val || 30) / 100) { addStatus(cp, "stun", 1, 0, gs); pushLog(gs, `🦁 ${e.name} ทำให้ ${cp.name} สะดุ้งเสียเทิร์น!`, "event"); }
        }
        if (defender.hp <= 0) killPlayer(gs, defender);
        if (cp.hp <= 0) killPlayer(gs, cp);

        // passive: สวนกลับ (swordmaster) — 30% ตีสวน melee หลังโดนโจมตี
        if (!gs.gameOver && defender.alive && defender.charId === "swordmaster" && cp.range <= 1 && Math.random() < 0.3) {
          const cRes = resolveAttack(defender, cp, gs);
          if (cRes.hit) {
            const cDmg = applyDamage(gs, cp, cRes.dmg, "สวนกลับ", cRes.element, defender);
            pushLog(gs, `🔱 ${defender.name} สวนกลับ! ${cp.name} -${cDmg} (🎲${cRes.atkRoll})`, "dmg");
            if (cp.hp <= 0) killPlayer(gs, cp);
          } else {
            pushLog(gs, `🔱 ${defender.name} พยายามสวนกลับแต่พลาด`, "event");
          }
        }
      }
      broadcastGameState(info.code, { diceRoll: res.atkRoll });
      break;
    }

    // ── ใช้การ์ด — route ผ่าน cardEngine (single source of truth) ───────────
    case "use_card": {
      if ((gs.actionsDone.cardsPlayed || 0) >= MAX_CARDS_PER_TURN)
        return send(ws, { type: "error", msg: `ใช้การ์ดครบ ${MAX_CARDS_PER_TURN} ใบในเทิร์นนี้แล้ว` });
      if (cp.pendingDiscard > 0) return send(ws, { type: "error", msg: "ต้องเลือกทิ้งการ์ดที่เกินมือก่อน" });
      const { cardUid, targetCol, targetRow } = payload;
      const cardIdx = cp.hand.findIndex(c => c.uid === cardUid);
      if (cardIdx < 0) return send(ws, { type: "error", msg: "ไม่พบการ์ดนี้" });
      const card = cp.hand[cardIdx];
      const hasTarget = targetCol !== undefined && targetRow !== undefined;
      const targetPlayer = hasTarget
        ? gs.players.find(p => p.alive && p.col === targetCol && p.row === targetRow) : null;
      const targetCell = hasTarget
        ? gs.cells.find(c => c.col === targetCol && c.row === targetRow) : null;

      // คืนดาวหางพุ่งผ่าน (free_magic) — เวทย์ใช้ฟรีไม่เสียมานา
      const effCard = (card.type === "magic" && hasStatus(cp, "free_magic")) ? { ...card, cost: 0 } : card;

      // เวทย์ "โจมตี" ที่หลบ/บล็อกได้ → เข้าระบบ interrupt (จัดการ commit เอง)
      if (card.type === "magic" && card.kind === "attack" && (card.dodgeable || card.blockable)) {
        return startAttackCard(gs, info.code, ws, cp, effCard, cardIdx, { targetPlayer, targetCell });
      }

      let result;
      if (card.type === "magic") {
        result = useMagic(gs, cp, effCard, CARD_CTX, { targetPlayer, targetCell });
        if (result?.teleportedTo) checkQuestProgress(cp, result.teleportedTo, gs);
      } else if (card.type === "weapon") {
        result = equipWeapon(gs, cp, card, CARD_CTX);
      } else if (card.type === "trap") {
        if (!targetCell) return send(ws, { type: "error", msg: "เลือกช่องวางกับดัก" });
        // วางได้เฉพาะช่องที่ยืน + รอบตัวระยะ 1 ช่อง
        if (hexDistanceServer(cp.col, cp.row, targetCell.col, targetCell.row) > 1)
          return send(ws, { type: "error", msg: "วางกับดักได้เฉพาะช่องที่ยืนหรือรอบตัว 1 ช่อง" });
        if (targetCell.terrain === "water")
          return send(ws, { type: "error", msg: "วางกับดักบนน้ำไม่ได้" });
        if (targetCell.trap)
          return send(ws, { type: "error", msg: "ช่องนี้มีกับดักอยู่แล้ว" });
        result = placeTrap(gs, targetCell, card, info.playerIdx, CARD_CTX);
      } else {
        return send(ws, { type: "error", msg: "ชนิดการ์ดไม่ถูกต้อง" });
      }

      // เอนจินปฏิเสธ (มานาไม่พอ / เป้าหมายผิด ฯลฯ) → ไม่ทิ้งการ์ด ไม่กินแอกชัน
      if (result?.error) return send(ws, { type: "error", msg: result.error });

      cp.hand.splice(cardIdx, 1);
      enforceHandLimit(cp);
      gs.actionsDone.cardsPlayed = (gs.actionsDone.cardsPlayed || 0) + 1;
      broadcastGameState(info.code);
      break;
    }

    // ── ทิ้งการ์ดที่เกินลิมิตมือ (ผู้เล่นเลือกเอง ไม่สุ่ม) ───────────────────
    case "discard_card": {
      if ((cp.pendingDiscard || 0) <= 0) return send(ws, { type: "error", msg: "ยังไม่ต้องทิ้งการ์ด" });
      const idx = cp.hand.findIndex(c => c.uid === payload?.cardUid);
      if (idx < 0) return send(ws, { type: "error", msg: "ไม่พบการ์ดนี้" });
      const [discarded] = cp.hand.splice(idx, 1);
      enforceHandLimit(cp);
      pushLog(gs, `🗑️ ${cp.name} ทิ้งการ์ด "${discarded.name}"${cp.pendingDiscard > 0 ? ` (เหลือต้องทิ้งอีก ${cp.pendingDiscard})` : ""}`, "");
      broadcastGameState(info.code);
      break;
    }

    // ── ซื้อของ ────────────────────────────────────────────────
    case "buy_item": {
      const { shopKey, itemUid } = payload;
      const shopCell = gs.cells.find(c => c.key === shopKey);
      if (!shopCell?.shopItems) return send(ws, { type: "error", msg: "ร้านค้าไม่พบ" });
      if (hexDistanceServer(cp.col, cp.row, shopCell.col, shopCell.row) > 0)
        return send(ws, { type: "error", msg: "ต้องยืนในร้านจึงจะซื้อได้" });
      const itemIdx = shopCell.shopItems.findIndex(i => i.uid === itemUid);
      if (itemIdx < 0) return send(ws, { type: "error", msg: "สินค้าหมดแล้ว" });
      const item = shopCell.shopItems[itemIdx];
      if (cp.gold < item.price) return send(ws, { type: "error", msg: `ทองไม่พอ (ต้องการ ${item.price})` });
      cp.gold -= item.price;
      const newCard = { ...item, uid: makeUid() };
      delete newCard.price;
      giveCard(cp, newCard, gs);
      shopCell.shopItems.splice(itemIdx, 1);
      pushLog(gs, `🛒 ${cp.name} ซื้อ "${item.name}" ราคา ${item.price} ทอง`, "event");
      broadcastGameState(info.code);
      break;
    }

    // ── จบเทิร์น ────────────────────────────────────────────────
    case "end_turn": {
      if (cp.pendingDiscard > 0) return send(ws, { type: "error", msg: `ต้องเลือกทิ้งการ์ดให้เหลือในลิมิตก่อน (อีก ${cp.pendingDiscard} ใบ)` });
      gs.phaseStep += 1;
      const aliveCount = gs.players.filter(p => p.alive).length;

      advancePointer(gs);

      if (gs.phaseStep >= aliveCount) {
        gs.phaseStep = 0;
        onPhaseAdvance(gs);
      }

      // โหมดบอส — บอสโจมตีทุกเทิร์น
      if (gs.bossMode && !gs.gameOver) bossTurn(gs);

      if (!gs.gameOver) {
        beginTurn(gs);
        const cur = gs.players[gs.currentTurn];
        pushLog(gs, `🔔 เทิร์นของ ${cur?.name} (เฟส ${gs.phase}${gs.bossMode ? " · โหมดบอส" : ""})`, "turn");
      }

      gs.totalTurns += 1;
      broadcastGameState(info.code);
      break;
    }

    // ── สกิล active ────────────────────────────────────────────────────────
    case "use_skill": {
      const charDef = CHARACTERS[cp.charId];
      if (!charDef) return send(ws, { type: "error", msg: "ไม่พบตัวละครของคุณ" });
      const skill = charDef.active;
      if (cp.mana < skill.cost) return send(ws, { type: "error", msg: `มานาไม่พอ (ต้องการ ${skill.cost}, มี ${cp.mana})` });

      cp.mana -= skill.cost;
      const { targetId, targetCol, targetRow } = payload || {};
      const skillTarget = targetId !== undefined ? gs.players[targetId] : null;
      let skillUsed = false;

      switch (skill.id) {
        // ─── ฟันสองครั้ง (sunwu) ───────────────────────────────────────────
        case "double_strike": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          for (let hit = 0; hit < 2; hit++) {
            const r = resolveAttack(cp, skillTarget);
            if (r.hit) {
              const d = applyDamage(gs, skillTarget, r.dmg, "ฟันสองครั้ง");
              pushLog(gs, `⚔️ ${cp.name} ฟันสองครั้ง ครั้งที่ ${hit+1}: ${d} ดาเมจ`, "dmg");
            } else pushLog(gs, `⚔️ ฟันสองครั้งครั้งที่ ${hit+1}: หลบ`, "event");
          }
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── เปิดเส้นทาง (zhenghe) ──────────────────────────────────────────
        case "open_route":
          gs.actionsDone.moveLeft = (gs.actionsDone.moveLeft || 0) + 3;
          pushLog(gs, `⛵ ${cp.name} เปิดเส้นทาง! งบเดิน +3 เทิร์นนี้`, "event");
          skillUsed = true; break;
        // ─── พายุน้ำแข็ง (icemage) ──────────────────────────────────────────
        case "blizzard": {
          let cnt = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 2) {
              const d = applyDamage(gs, p, 2, "พายุน้ำแข็ง");
              if (d > 0) { pushLog(gs, `❄️ ${p.name} โดนพายุน้ำแข็ง -${d}`, "dmg"); cnt++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `❄️ ${cp.name} ปล่อยพายุน้ำแข็ง โดน ${cnt} คน`, "event");
          skillUsed = true; break;
        }
        // ─── ฝนธนู (archer) ─────────────────────────────────────────────────
        case "arrow_rain": {
          let cnt2 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 3) {
              const d = applyDamage(gs, p, 1, "ฝนธนู");
              if (d > 0) { pushLog(gs, `🏹 ${p.name} โดนฝนธนู -${d}`, "dmg"); cnt2++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🏹 ${cp.name} ปล่อยฝนธนู โดน ${cnt2} คน`, "event");
          skillUsed = true; break;
        }
        // ─── รักษาตัวเอง (cleric) ────────────────────────────────────────────
        case "self_heal": {
          const before = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 4);
          pushLog(gs, `✨ ${cp.name} รักษาตัวเอง HP+${cp.hp - before}`, "heal");
          skillUsed = true; break;
        }
        // ─── แทงหลัง (assassin) ──────────────────────────────────────────────
        case "backstab": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist2 = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist2 > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const dmg = cp.atk + 3; // ข้ามเกราะ
          const dealt = applyDamage(gs, skillTarget, dmg, "แทงหลัง");
          pushLog(gs, `🗡️ ${cp.name} แทงหลัง ${skillTarget.name} -${dealt} (ข้ามเกราะ)`, "dmg");
          // passive: วิญญาณไฟ ถ้าใช้ skillId "backstab" ไม่ติด burn (เฉพาะ firemage)
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── ลมดาบ (swordmaster) ─────────────────────────────────────────────
        case "sword_wind": {
          let cnt3 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) === 1) {
              const d = applyDamage(gs, p, cp.atk, "ลมดาบ");
              if (d > 0) { pushLog(gs, `🔱 ${p.name} โดนลมดาบ -${d}`, "dmg"); cnt3++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🔱 ${cp.name} ปล่อยลมดาบ โดน ${cnt3} คน`, "event");
          skillUsed = true; break;
        }
        // ─── ฟาดหนัก (guardian) ──────────────────────────────────────────────
        case "heavy_blow": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist3 = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist3 > (cp.range || 1)) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const d3 = applyDamage(gs, skillTarget, 4, "ฟาดหนัก");
          addStatus(skillTarget, "lock", 1, 0);
          pushLog(gs, `🛡️ ${cp.name} ฟาดหนัก! ${skillTarget.name} -${d3} ถูกล็อค 1 เทิร์น`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── ลูกไฟ (firemage) ────────────────────────────────────────────────
        case "fireball": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const d4 = applyDamage(gs, skillTarget, 3, "ลูกไฟ");
          // passive: วิญญาณไฟ → ติด burn
          addStatus(skillTarget, "burn", 2, 1);
          pushLog(gs, `🔥 ${cp.name} ลูกไฟ! ${skillTarget.name} -${d4} + ไฟไหม้`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          // splash รอบเป้า 1 ช่อง
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id || p.id === skillTarget.id) return;
            if (hexDistanceServer(skillTarget.col, skillTarget.row, p.col, p.row) === 1) {
              const d5 = applyDamage(gs, p, 1, "ลูกไฟสะเทือน");
              if (d5 > 0) { addStatus(p, "burn", 1, 1); pushLog(gs, `🔥 ${p.name} โดนไฟสะเทือน -${d5}`, "dmg"); }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          skillUsed = true; break;
        }
        // ─── ยาอายุวัฒนะ (herbalist) ─────────────────────────────────────────
        case "elixir": {
          const hb4 = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 3);
          // ล้าง poison/burn/blind/freeze
          cp.statusEffects = (cp.statusEffects || []).filter(s => !["poison","burn","blind","freeze"].includes(s.type));
          recomputeStats(cp);
          pushLog(gs, `🌿 ${cp.name} ดื่มยาอายุวัฒนะ HP+${cp.hp - hb4} ล้างสถานะลบ`, "heal");
          skillUsed = true; break;
        }
        // ─── ตะโกนสั่งการ (general) — AOE 2 รอบตัว ───────────────────────────
        case "shout_command": {
          let cnt4 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 2) {
              const d = applyDamage(gs, p, 2, "ตะโกนสั่งการ");
              if (d > 0) { pushLog(gs, `🪖 ${p.name} โดนตะโกนสั่งการ -${d}`, "dmg"); cnt4++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🪖 ${cp.name} ตะโกนสั่งการ! โดน ${cnt4} คน`, "event");
          skillUsed = true; break;
        }
        // ─── สายฟ้าแล่บ (oracle) — เป้าหมาย dmg 3 + freeze ───────────────────
        case "lightning_bolt": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const distLB = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (distLB > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const dLB = applyDamage(gs, skillTarget, 3, "สายฟ้าแล่บ");
          addStatus(skillTarget, "freeze", 1, 0);
          pushLog(gs, `🔮 ${cp.name} สายฟ้าแล่บ! ${skillTarget.name} -${dLB} + แช่แข็ง 1 เทิร์น`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        default:
          cp.mana += skill.cost;
          return send(ws, { type: "error", msg: "สกิลยังไม่ได้ implement" });
      }

      if (skillUsed) broadcastGameState(info.code);
      break;
    }

    // ── สกิลราชา (use_king_skill) ─────────────────────────────────────────
    case "use_king_skill": {
      if (cp.role !== "king") return send(ws, { type: "error", msg: "เฉพาะราชาเท่านั้น" });
      const kChar = CHARACTERS[cp.charId];
      if (!kChar) return send(ws, { type: "error", msg: "ไม่พบสกิลราชา" });
      const ks = kChar.kingSkill;

      // ─── ทำนายชะตา (oracle) — เลือกดูบทบาท 1 คน · ใช้ได้ครั้งเดียวตลอดเกม ───
      if (ks.id === "fate_read") {
        if (cp._fateReadUsed) return send(ws, { type: "error", msg: "ทำนายชะตาใช้ได้ครั้งเดียวตลอดทั้งเกม" });
        const target = gs.players.find(p => p.id === payload?.targetId);
        if (!target || !target.alive) return send(ws, { type: "error", msg: "เลือกผู้เล่นที่จะทำนาย" });
        if (target.id === cp.id) return send(ws, { type: "error", msg: "ทำนายตัวเองไม่ได้" });
        cp._fateReadUsed = true;
        target._privateRevealTo = target._privateRevealTo || [];
        if (!target._privateRevealTo.includes(cp.id)) target._privateRevealTo.push(cp.id);
        pushLog(gs, `👑 ${cp.name} ทำนายชะตา! (ล่วงรู้บทบาทของผู้เล่นหนึ่งคน — เฉพาะตน)`, "event");
        broadcastGameState(info.code);
        break;
      }

      if (cp._kingSkillUsedPhase === gs.phase) return send(ws, { type: "error", msg: "ใช้สกิลราชาได้ครั้งเดียวต่อเฟส" });
      cp._kingSkillUsedPhase = gs.phase;

      switch (ks.id) {
        case "drill_troops":
          gs.players.forEach(p => { if (p.alive) addStatus(p, "atk_up", 1, 1); });
          pushLog(gs, `👑 ${cp.name} ฝึกทัพ! ทุกคน ATK+1 เทิร์นนี้`, "event"); break;
        case "royal_envoy":
          gs.players.forEach(p => { if (p.alive) p._revealedByEnvoy = true; });
          pushLog(gs, `👑 ${cp.name} ส่งคณะทูต! เปิดตำแหน่งทุกคน`, "event"); break;
        case "winter":
          gs.players.forEach(p => { if (p.alive) p.mana = Math.max(0, p.mana - 2); });
          pushLog(gs, `👑 ${cp.name} ปล่อยฤดูหนาว! ทุกคนมานา-2`, "event"); break;
        case "fort_arrow":
          addStatus(cp, "atk_up", 1, 1);
          cp.range += 2; // bonus range เทิร์นนี้ (reset ใน beginTurn เพราะ recomputeStats)
          pushLog(gs, `👑 ${cp.name} ป้อมยิง! ระยะ+2 ATK+1 เทิร์นนี้`, "event"); break;
        case "royal_blessing":
          gs.players.forEach(p => {
            if (!p.alive) return;
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + 2);
            if (p.hp > before) pushLog(gs, `✨ ${p.name} ได้พรแห่งราชัน HP+${p.hp-before}`, "heal");
          }); break;
        case "shadow_hunt":
          cp._skipZoneEffect = true;
          pushLog(gs, `👑 ${cp.name} ล่าเงา! ข้ามผลกระทบ zone เทิร์นนี้`, "event"); break;
        case "throne_sword":
          addStatus(cp, "atk_up", 1, 3);
          addStatus(cp, "def_up", 1, 1);
          pushLog(gs, `👑 ${cp.name} ดาบแห่งบัลลังก์! ATK+3 DEF+1 เทิร์นนี้`, "event"); break;
        case "iron_fortress":
          addStatus(cp, "def_up", 1, 4);
          cp._skipZoneEffect = true;
          pushLog(gs, `👑 ${cp.name} ป้อมเหล็ก! DEF+4 ข้ามผลกระทบ zone`, "event"); break;
        case "fire_rain":
          gs.players.forEach(p => {
            if (!p.alive) return;
            const d = applyDamage(gs, p, 2, "ฝนไฟ");
            if (d > 0) { pushLog(gs, `🔥 ${p.name} โดนฝนไฟ -${d}`, "dmg"); }
            if (p.hp <= 0) killPlayer(gs, p);
          }); break;
        case "immortal_potion": {
          const hb = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 5);
          pushLog(gs, `👑 ${cp.name} ดื่มยาอมตะ! HP+${cp.hp-hb}`, "heal"); break;
        }
        // ─── สัญญาเลือด (general) ─────────────────────────────────────────────
        case "battle_pact": {
          addStatus(cp, "atk_up", 1, 2);
          addStatus(cp, "def_up", 1, 1);
          const hbp = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 2);
          pushLog(gs, `👑 ${cp.name} สัญญาเลือด! ATK+2 DEF+1 HP+${cp.hp-hbp}`, "event"); break;
        }
        // ─── ทำนายชะตา (oracle) — เปิดบทบาททุกคน "เฉพาะผู้ทำนายเห็นเท่านั้น" ──
        case "fate_read":
          gs.players.forEach(p => {
            if (p.alive && p.id !== cp.id) {
              p._privateRevealTo = p._privateRevealTo || [];
              if (!p._privateRevealTo.includes(cp.id)) p._privateRevealTo.push(cp.id);
            }
          });
          pushLog(gs, `👑 ${cp.name} ทำนายชะตา! (มองเห็นบทบาทของทุกคน — เฉพาะตน)`, "event"); break;
        default:
          cp._kingSkillUsedPhase = -1;
          return send(ws, { type: "error", msg: "สกิลราชายังไม่ได้ implement" });
      }
      recomputeStats(cp);
      broadcastGameState(info.code);
      break;
    }

    default:
      send(ws, { type: "error", msg: `ไม่รู้จัก action: ${action}` });
  }
}

// ─── Handle Leave ─────────────────────────────────────────────────────────────
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
    if (!room.gameState) {
      room.players = room.players.filter((_, i) => i !== playerIdx).map((p, i) => ({ ...p, idx: i }));
      for (const [, cinfo] of clients) {
        if (cinfo.code === code && cinfo.playerIdx > playerIdx) cinfo.playerIdx -= 1;
      }
      broadcast(code);
    }
  }
  broadcastRoomList();
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🏰 Shadow of Throne Server v5`);
  console.log(`   Port:      ${PORT}`);
  console.log(`   Features:  move=3, hand=HP-limit, dodge-dice, equipment-range, 8-phase, boss-mode, hidden-roles, fog, side-quests`);
  console.log(`   Health:    http://localhost:${PORT}/health\n`);
});

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
