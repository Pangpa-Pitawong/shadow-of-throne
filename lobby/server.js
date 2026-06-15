import http from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";
import { MAGIC_CARDS, ALL_CARDS, drawWeighted, rarityMeta } from "./src/game/constants/cards.js";
import { useMagic, equipWeapon, placeTrap, triggerTrap } from "./src/game/utils/cardEngine.js";
import { pickQuestChoices } from "./src/game/constants/quests.js";
import { CLASSES } from "./src/game/constants/classes.js";

const PORT = process.env.PORT || 3001;

// ─── กติกา: ใช้การ์ดได้ไม่เกิน N ใบต่อเทิร์น ──────────────────────────────────
const MAX_CARDS_PER_TURN = 4;

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
  const clone = JSON.parse(JSON.stringify(gs));
  delete clone._questTargets;
  if (clone.gameOver) return clone; // จบเกม — เปิดทุกอย่าง

  const viewer = clone.players[viewerIdx];
  clone.players = clone.players.map((p, i) => {
    const isSelf = i === viewerIdx;
    p.handCount = p.hand ? p.hand.length : 0;
    if (!isSelf) {
      p.hand = [];
      p.questChoices = null;
      p.quest = p.quest ? { hidden: true, done: !!p.quest.done } : null;
      const roleVisible = p.role === "king" || p.revealed;
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
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// ─── CARDS POOL (จาก constants ที่แชร์กับ client) ───────────────────────────
const ALL_CARDS_POOL = ALL_CARDS;

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

// ─── STAT RECOMPUTE: atk/def/range/move = ฐาน + อุปกรณ์ + สถานะ ─────────────
function recomputeStats(p) {
  let atk = p.baseAtk, def = p.baseDef, range = 0, move = p.baseMove || 3;
  for (const e of (p.equipment || [])) {
    atk += e.atk || 0;
    def += e.def || 0;
    range = Math.max(range, e.range || 0);
    if (e.effect === "swift") move += 1;
    if (e.effect === "king_only" && p.role === "king") atk += 2; // ราชาถือดาบกษัตริย์
  }
  for (const s of (p.statusEffects || [])) {
    if (s.type === "atk_down") atk -= (s.value || 2);
    if (s.type === "atk_up") atk += (s.value || 1);
    if (s.type === "def_up") def += (s.value || 2);
    if (s.type === "armor_break") def -= (s.value || 2);
  }
  p.atk = Math.max(0, atk);
  p.def = Math.max(0, def);
  p.range = Math.max(0, range);
  p.move = Math.max(1, move);
}

// ─── DAMAGE: ลด HP โดยเคารพโล่ (shield) — กันดาเมจได้ N ครั้ง ─────────────────
function applyDamage(gs, p, amount, srcLabel = "") {
  if (amount <= 0) return 0;
  const shield = (p.statusEffects || []).find(s => s.type === "shield" && (s.value || 0) > 0);
  if (shield) {
    shield.value -= 1;
    if (shield.value <= 0) p.statusEffects = p.statusEffects.filter(s => s !== shield);
    pushLog(gs, `🟡 ${p.name} ใช้โล่กันเวทกันดาเมจ${srcLabel ? ` (${srcLabel})` : ""}!`, "event");
    return 0;
  }
  p.hp = Math.max(0, p.hp - amount);
  return amount;
}

function addStatus(p, type, duration, value = 0) {
  if (!p.statusEffects) p.statusEffects = [];
  const existing = p.statusEffects.find(s => s.type === type);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (value) existing.value = Math.max(existing.value || 0, value);
  } else {
    p.statusEffects.push({ type, duration, value });
  }
  recomputeStats(p);
}
function hasStatus(p, type) { return (p.statusEffects || []).some(s => s.type === type); }

function pushLog(gs, msg, type = "") {
  gs.log.unshift({ msg, type, ts: Date.now(), ph: gs.phase, fog: !!gs.fogActive });
  if (gs.log.length > 200) gs.log.length = 200;
}

function killPlayer(gs, p) {
  if (!p.alive) return;
  p.alive = false;
  p.revealed = true; // เปิดเผยบทบาทเมื่อแพ้
  pushLog(gs, `💀 ${p.name} (${p.role}) ถูกกำจัด! — บทบาทถูกเปิดเผย`, "death");
  checkWinServer(gs);
}

// ─── TERRAIN MOVEMENT ────────────────────────────────────────────────────────
const TERRAIN_MOVE_COST = { plains: 1, forest: 2, mountain: 3, water: 99, desert: 2, swamp: 3 };

function getNeighborKeys(col, row, cellMap, blockWater = true) {
  const isOdd = col % 2 === 1;
  const dirs = isOdd
    ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
    : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return dirs
    .map(([dc, dr]) => `${col + dc},${row + dr}`)
    .filter(k => cellMap[k] && (!blockWater || cellMap[k].terrain !== "water"));
}

function getReachableServer(startCol, startRow, steps, cells) {
  const cellMap = {};
  for (const c of cells) cellMap[c.key] = c;
  const visited = new Map();
  visited.set(`${startCol},${startRow}`, 0);
  const queue = [{ key: `${startCol},${startRow}`, cost: 0 }];
  const reachable = new Set();
  while (queue.length > 0) {
    const { key, cost } = queue.shift();
    const cell = cellMap[key];
    if (!cell) continue;
    for (const nk of getNeighborKeys(cell.col, cell.row, cellMap)) {
      const neighbor = cellMap[nk];
      if (!neighbor) continue;
      const moveCost = TERRAIN_MOVE_COST[neighbor.terrain] || 1;
      const newCost = cost + moveCost;
      if (newCost <= steps && (!visited.has(nk) || visited.get(nk) > newCost)) {
        visited.set(nk, newCost);
        reachable.add(nk);
        queue.push({ key: nk, cost: newCost });
      }
    }
  }
  reachable.delete(`${startCol},${startRow}`);
  return reachable;
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

// ─── CLASS DATA — derive จาก shared CLASSES (แหล่งความจริงเดียว) ─────────────
//   map: hp→hp/maxHp, mana→mana/maxMana, atk→baseAtk, def→baseDef, move
//   (ค่าตัวเลขเท่ากับเดิมทุกอาชีพ — แค่ไม่ hardcode ซ้ำกับฝั่ง client)
const CLASSES_DATA = Object.fromEntries(
  Object.entries(CLASSES)
    .filter(([id]) => id !== "hidden")
    .map(([id, c]) => [id, {
      hp: c.hp, maxHp: c.hp,
      mana: c.mana, maxMana: c.mana,
      baseAtk: c.atk, baseDef: c.def, move: c.move,
    }])
);

// ─── STARTING GEAR — อุปกรณ์เริ่มต้นต่ออาชีพ (ระยะโจมตีมาจากอุปกรณ์) ─────────
const STARTING_GEAR = {
  warrior: { id: "iron_sword", name: "ดาบเหล็ก", ico: "⚔️", type: "weapon", atk: 1, range: 0 },
  knight:  { id: "kite_shield", name: "โล่อัศวิน", ico: "🛡️", type: "weapon", def: 1, range: 0 },
  mage:    { id: "apprentice_staff", name: "ไม้เท้าฝึกหัด", ico: "🪄", type: "weapon", atk: 1, range: 2, effect: "ranged" },
  archer:  { id: "short_bow", name: "ธนูสั้น", ico: "🏹", type: "weapon", atk: 1, range: 3, effect: "ranged" },
  rogue:   { id: "twin_dagger", name: "กริชคู่", ico: "🗡️", type: "weapon", atk: 1, range: 0, effect: "backstab" },
  cleric:  { id: "holy_staff", name: "ไม้เท้าศักดิ์สิทธิ์", ico: "⚕️", type: "weapon", def: 1, range: 1 },
};

// ─── PHASE EVENTS ────────────────────────────────────────────────────────────
const PHASE_EVENTS = [
  { name: "วันเก็บเกี่ยว", ico: "🌾", fx: "gold_all", desc: "ทุกคน +2 ทอง" },
  { name: "วันศักดิ์สิทธิ์", ico: "🌟", fx: "heal_all", desc: "ทุกคน +3 HP" },
  { name: "ขบวนทัพผี", ico: "👻", fx: "dmg_all", desc: "ทุกคน -2 HP" },
  { name: "กลองศึก", ico: "🥁", fx: "atk_all", desc: "ทุกคน +1 ATK" },
  { name: "ฝนทองคำ", ico: "✨", fx: "gold5_random", desc: "ผู้เล่นสุ่ม +5 ทอง" },
  { name: "พรเวทมนตร์", ico: "🔮", fx: "mana_all", desc: "ทุกคนฟื้นมานาเต็ม" },
];

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
  const TERRAIN_PATTERN = ["plains", "plains", "plains", "forest", "forest", "mountain", "desert", "swamp", "forest", "plains"];
  function getTerrainForCell(col, row, specialZone) {
    if (specialZone && ZONE_TERRAIN[specialZone]) return ZONE_TERRAIN[specialZone];
    if ((col === 0 || col === 12) && (col + row) % 4 === 0) return "water";
    if ((row === 0 || row === 10) && (col + row) % 5 === 0) return "water";
    return TERRAIN_PATTERN[(col * 7 + row * 3) % TERRAIN_PATTERN.length];
  }

  const cells = [];
  const zoneToCell = {};
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 13; col++) {
      const key = `${col},${row}`;
      const specialZone = FIXED_ZONES[key] || null;
      const terrain = getTerrainForCell(col, row, specialZone);
      const SHOP_ZONES = ["market", "blacksmith", "alchemist", "tavern", "armory"];
      let shopItems = null;
      if (specialZone && SHOP_ZONES.includes(specialZone)) shopItems = generateShopItemsServer(specialZone);
      if (specialZone) zoneToCell[specialZone] = key;
      cells.push({ col, row, key, terrain, specialZone, trap: null, shopItems });
    }
  }

  const spawnPositions = [
    { col: 0, row: 0 }, { col: 12, row: 0 },
    { col: 0, row: 10 }, { col: 12, row: 10 },
    { col: 6, row: 0 }, { col: 6, row: 10 },
  ];

  const players = room.players.map((p, i) => {
    const cls = CLASSES_DATA[p.class] || CLASSES_DATA.warrior;
    const spawn = spawnPositions[i] || { col: i * 2, row: 0 };
    const gear = STARTING_GEAR[p.class] ? [{ ...STARTING_GEAR[p.class] }] : [];
    const role = room.roles[i];
    const player = {
      id: i,
      name: p.name,
      role,
      classId: p.class || "warrior",
      hp: cls.hp, maxHp: cls.maxHp,
      mana: cls.mana, maxMana: cls.maxMana,
      baseAtk: cls.baseAtk, baseDef: cls.baseDef, baseMove: cls.move,
      atk: cls.baseAtk, def: cls.baseDef, range: 0, move: cls.move,
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
      questChoices: pickQuestChoices(3), // เควสรอง 3 ตัวเลือก
    };
    recomputeStats(player);
    return player;
  });

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
    fogActive: false,           // เฟส 1 แสดงเสมอ
    bossMode: false,
    bossLevel: 0,
    actionsDone: { moved: false, attacked: false, cardsPlayed: 0 },
    log: [],
    gameOver: null,
    totalTurns: 0,
    _questTargets: zoneToCell,
  };
  pushLog(gs, "🏰 เกมเริ่มต้น! พระราชาเปิดตัวและเริ่มเล่นก่อน", "event");
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
      if (others.length > 0) { const t = others[Math.floor(Math.random() * others.length)]; t.revealed = true; log(`🔭 ${player.name} สอดแนม → ${t.name} เป็น ${t.role}!`, "event"); }
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
function grantQuestReward(player, reward, gs) {
  if (!reward) return;
  if (reward.gold) player.gold += reward.gold;
  if (reward.exp) player.exp = (player.exp || 0) + reward.exp;
  if (reward.hp) player.hp = Math.min(player.maxHp, player.hp + reward.hp);
  if (reward.mana) player.mana = Math.min(player.maxMana, player.mana + reward.mana);
  if (reward.atk) { player.baseAtk += reward.atk; }
  if (reward.def) { player.baseDef += reward.def; }
  if (reward.cards) for (let i = 0; i < reward.cards; i++) giveCard(player, drawRandomCard(), gs);
  recomputeStats(player);
}

// ─── COMBAT: โจมตี + กลไกหลบด้วยลูกเต๋า (ดวง) ────────────────────────────────
//   ผู้โจมตี: ทอย d6 + โบนัส ATK (+คริตถ้าทอย 6)
//   ฝ่ายตั้งรับ: ทอย d6 + โบนัสหลบ (จากความเร็ว + เลือดที่เหลือ)
//                ถ้าสถานะ "ห่างกัน" ฝ่ายอ่อนกว่าได้โบนัสหลบเพิ่ม (ดวงมวยรอง)
//   ถ้าแต้มตั้งรับ ≥ แต้มโจมตี = หลบสำเร็จ | ทอย 1 = พลาดเสมอ
function resolveAttack(attacker, defender) {
  const fx = new Set((attacker.equipment || []).map(e => e.effect));
  const dfx = new Set((defender.equipment || []).map(e => e.effect));
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
  const dodgeRoll = rnd(6) + dodgeBonus;

  const atkTotal = atkRoll + Math.floor(attacker.atk / 3) + (crit ? 3 : 0) - (blinded ? 2 : 0);

  const hit = atkRoll !== 1 && atkTotal >= dodgeRoll;
  // pierce: ลดผลของ DEF ฝ่ายรับครึ่งหนึ่ง
  const effDef = fx.has("pierce") ? Math.floor(defender.def / 2) : defender.def;
  let dmg = 0;
  if (hit) dmg = Math.max(1, attacker.atk + (crit ? 2 : 0) - effDef);

  const doubled = hit && fx.has("double") && atkRoll === 6;
  return { atkRoll, dodgeRoll, dodgeBonus, underdogBonus, crit, hit, dmg, gap, doubled };
}

// ─── TURN: เริ่มเทิร์นของผู้เล่นปัจจุบัน (ประมวลผลสถานะทั้งหมด) ───────────────
function beginTurn(gs, isFirst = false, guard = 0) {
  if (gs.gameOver || guard > gs.players.length * 2) return;
  const p = gs.players[gs.currentTurn];
  if (!p || !p.alive) { advancePointer(gs); return beginTurn(gs, isFirst, guard + 1); }

  // ฟื้นมานา
  p.mana = Math.min(p.maxMana, p.mana + 1);

  // ฟื้นฟูต่อเนื่อง (regen)
  let regen = 0;
  for (const s of (p.statusEffects || [])) if (s.type === "regen") regen += s.value || 1;
  if (regen > 0 && p.hp < p.maxHp) {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + regen);
    pushLog(gs, `🌿 ${p.name} ฟื้นฟู HP+${p.hp - before}`, "heal");
  }

  // พิษ/ไฟไหม้ (DOT)
  let dot = 0;
  for (const s of (p.statusEffects || [])) if (s.type === "poison" || s.type === "burn") dot += s.value || 1;
  if (dot > 0) {
    p.hp = Math.max(0, p.hp - dot);
    pushLog(gs, `🩸 ${p.name} เสีย HP-${dot} จากพิษ/ไฟไหม้`, "dmg");
    if (p.hp <= 0) { killPlayer(gs, p); advancePointer(gs); return beginTurn(gs, isFirst, guard + 1); }
  }

  const frozen = hasStatus(p, "freeze");
  const locked = hasStatus(p, "lock");
  gs.actionsDone = frozen
    ? { moved: true, attacked: true, cardsPlayed: MAX_CARDS_PER_TURN }
    : { moved: locked, attacked: false, cardsPlayed: 0 };
  if (frozen) pushLog(gs, `🧊 ${p.name} ถูกแช่แข็ง — ข้ามเทิร์น`, "event");
  else if (locked) pushLog(gs, `🕸️ ${p.name} ถูกล็อก — เดินไม่ได้เทิร์นนี้`, "event");

  // ลดอายุสถานะ + ลบที่หมด + คำนวณสเตตัสใหม่
  p.statusEffects = (p.statusEffects || []).map(s => ({ ...s, duration: s.duration - 1 })).filter(s => s.duration > 0);
  recomputeStats(p);

  // ─── จั่วเริ่มเทิร์น: หยิบจากกองจั่ว 2 ใบ (ความลุ้น) ───
  const drew = [drawRandomCard(), drawRandomCard()];
  p.justDrew = drew.map(c => c.uid);   // client ใช้สำหรับแอนิเมชันเปิดไพ่
  for (const c of drew) p.hand.push(c);
  pushLog(gs, `🎴 ${p.name} จั่วการ์ดเริ่มเทิร์น 2 ใบ`, "");
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
  gs.phase += 1;

  // เกินจำนวนเฟส → โหมดบอส
  if (gs.phase > gs.maxPhases) {
    gs.bossMode = true;
    gs.fogActive = false;
    if (gs.phase === gs.maxPhases + 1)
      pushLog(gs, `⚠️ ครบ ${gs.maxPhases} เฟสแล้ว! บอสปรากฏตัว — ทุกเทิร์นจะมีบอสโจมตีแรงขึ้นเรื่อยๆ`, "win");
    return;
  }

  // ม่านหมอกสลับเฟส (เฟสคู่ = หมอก, เฟส 1 และเฟสคี่ = แสดงปกติ)
  gs.fogActive = gs.phase % 2 === 0;

  // เหตุการณ์ประจำเฟส
  const ev = PHASE_EVENTS[Math.floor(Math.random() * PHASE_EVENTS.length)];
  for (const p of gs.players) {
    if (!p.alive) continue;
    if (ev.fx === "gold_all") p.gold += 2;
    if (ev.fx === "heal_all") p.hp = Math.min(p.maxHp, p.hp + 3);
    if (ev.fx === "dmg_all") { p.hp = Math.max(1, p.hp - 2); }
    if (ev.fx === "atk_all") { p.baseAtk += 1; recomputeStats(p); }
    if (ev.fx === "mana_all") p.mana = p.maxMana;
  }
  if (ev.fx === "gold5_random") {
    const alivePlayers = gs.players.filter(p => p.alive);
    if (alivePlayers.length > 0) { const lucky = alivePlayers[Math.floor(Math.random() * alivePlayers.length)]; lucky.gold += 5; pushLog(gs, `✨ ${lucky.name} โชคดี ได้ทอง +5!`, "event"); }
  }
  pushLog(gs, `📜 เฟส ${gs.phase}: ${ev.ico} ${ev.name} — ${ev.desc}${gs.fogActive ? " · 🌫️ ม่านหมอกปกคลุม!" : ""}`, "event");
  // หมายเหตุ: การจั่วการ์ดย้ายไปเป็น "จั่วเริ่มเทิร์น 2 ใบ" ใน beginTurn() แล้ว
}

// ─── BOSS ATTACK (ทุกเทิร์นในโหมดบอส) ───────────────────────────────────────
function bossTurn(gs) {
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
  const alive = gs.players.filter(p => p.alive);
  const king = gs.players.find(p => p.role === "king");
  const rebels = gs.players.filter(p => p.role === "rebel");

  if (king && !king.alive && rebels.some(r => r.alive)) {
    gs.gameOver = { winner: "rebel", reason: "กบฏโค่นบัลลังก์! 🏴", players: rebels.filter(r => r.alive) };
    pushLog(gs, `🏆 กบฏชนะ! โค่นบัลลังก์สำเร็จ!`, "win"); return;
  }
  if (rebels.length > 0 && rebels.every(r => !r.alive) && king?.alive) {
    gs.gameOver = { winner: "king", reason: "พระราชาปราบกบฏ! 👑", players: [king] };
    pushLog(gs, `🏆 พระราชาชนะ! ปราบกบฏสำเร็จ!`, "win"); return;
  }
  if (alive.length === 1) {
    gs.gameOver = { winner: alive[0].role, reason: `${alive[0].name} รอดคนสุดท้าย!`, players: [alive[0]] };
    pushLog(gs, `🏆 ${alive[0].name} ชนะ! รอดคนสุดท้าย!`, "win"); return;
  }
  if (alive.length === 0) {
    gs.gameOver = { winner: "draw", reason: "ทุกคนล้มลง — ไม่มีผู้ชนะ", players: [] };
    pushLog(gs, `⚰️ ทุกคนล้มลง — เสมอ`, "win");
  }
}

// ─── Game Action Handler ─────────────────────────────────────────────────────
function handleGameAction(ws, msg) {
  const info = clients.get(ws);
  if (!info?.code) return;
  const room = rooms[info.code];
  if (!room || !room.gameState) return;
  const gs = room.gameState;
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

  if (gs.currentTurn !== info.playerIdx) return send(ws, { type: "error", msg: "ไม่ใช่เทิร์นของคุณ" });
  const cp = gs.players[gs.currentTurn];
  if (!cp || !cp.alive) return;

  switch (action) {
    // ── เดิน ───────────────────────────────────────────────────
    case "move": {
      if (gs.actionsDone.moved) return send(ws, { type: "error", msg: "เดินไปแล้ว / ถูกล็อกในเทิร์นนี้" });
      const { col, row } = payload;
      const reachableKeys = getReachableServer(cp.col, cp.row, cp.move, gs.cells);
      if (!reachableKeys.has(`${col},${row}`)) return send(ws, { type: "error", msg: `เดินไป (${col},${row}) ไม่ได้ — ไกลหรือผ่านน้ำ` });
      const targetCell = gs.cells.find(c => c.col === col && c.row === row);
      if (!targetCell) return;

      cp.col = col; cp.row = row;
      gs.actionsDone.moved = true;
      pushLog(gs, `🚶 ${cp.name} → (${col},${row})`, "");

      applyZoneEffectServer(cp, targetCell, gs);
      checkQuestProgress(cp, targetCell, gs);

      // กับดัก — ทำงานผ่าน cardEngine (เคารพ shield + ติดสถานะครบ)
      if (targetCell.trap && targetCell.trap.ownerId !== info.playerIdx) {
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

      const res = resolveAttack(cp, defender);
      gs.actionsDone.attacked = true;

      if (!res.hit) {
        pushLog(gs, `🛡️ ${defender.name} หลบหลีก! (โจมตี🎲${res.atkRoll} vs หลบ${res.dodgeRoll})`, "event");
      } else {
        let dealt = applyDamage(gs, defender, res.dmg, "โจมตี");
        // ฟันสองครั้ง (อาวุธ effect: double, ทอย 6)
        if (res.doubled) { dealt += applyDamage(gs, defender, res.dmg, "ฟันซ้ำ"); pushLog(gs, `⚔️✕2 ${cp.name} ฟันซ้ำ!`, "dmg"); }
        pushLog(gs, `⚔️ ${cp.name} → ${defender.name}: ${dealt} ดาเมจ (🎲${res.atkRoll} vs หลบ${res.dodgeRoll})${res.crit ? " ✨คริต!" : ""}`, "dmg");

        // เอฟเฟกต์อาวุธที่สวมใส่ (ตอนตีโดน)
        const fx = new Set((cp.equipment || []).map(e => e.effect));
        if (fx.has("burn"))       { addStatus(defender, "burn", 2, 1); pushLog(gs, `🔥 ${defender.name} ติดไฟไหม้!`, "dmg"); }
        if (fx.has("freeze"))     { addStatus(defender, "freeze", 1, 0); pushLog(gs, `❄️ ${defender.name} ถูกแช่แข็ง!`, "event"); }
        if (fx.has("poison_hit")) { addStatus(defender, "poison", 2, 1); pushLog(gs, `☠️ ${defender.name} ติดพิษ!`, "dmg"); }
        if (fx.has("stun"))       { addStatus(defender, "lock", 2, 0); pushLog(gs, `💫 ${defender.name} ถูกทำให้มึน!`, "event"); }
        if (fx.has("lifesteal") && dealt > 0) {
          const ls = Math.max(1, Math.floor(dealt / 2));
          cp.hp = Math.min(cp.maxHp, cp.hp + ls);
          pushLog(gs, `🩸 ${cp.name} ดูดเลือด HP+${ls}`, "heal");
        }
        // โจมตีหมู่ (aoe): กระเด็นโดนศัตรูข้างเคียงเป้าหมายครึ่งดาเมจ
        if (fx.has("aoe")) {
          const splash = Math.max(1, Math.floor(res.dmg / 2));
          for (const o of gs.players) {
            if (!o.alive || o.id === cp.id || o.id === defender.id) continue;
            if (hexDistanceServer(defender.col, defender.row, o.col, o.row) === 1) {
              const sd = applyDamage(gs, o, splash, "สะเทือน");
              if (sd > 0) pushLog(gs, `💥 แรงสะเทือนโดน ${o.name} -${sd}`, "dmg");
              if (o.hp <= 0) killPlayer(gs, o);
            }
          }
        }
        // เกราะสะท้อน (ฝ่ายตั้งรับ)
        if ((defender.equipment || []).some(e => e.effect === "reflect")) {
          cp.hp = Math.max(0, cp.hp - 1);
          pushLog(gs, `🔰 เกราะหนามสะท้อน! ${cp.name} เสีย HP-1`, "dmg");
        }
        if (defender.hp <= 0) killPlayer(gs, defender);
        if (cp.hp <= 0) killPlayer(gs, cp);
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

      let result;
      if (card.type === "magic") {
        result = useMagic(gs, cp, card, CARD_CTX, { targetPlayer, targetCell });
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
      const { playerName, maxPlayers, mode, visibility = "public" } = msg;
      const code = genCode();
      rooms[code] = {
        code, createdAt: Date.now(), status: "waiting",
        mode: mode || "standard",
        maxPlayers: Math.max(3, Math.min(6, maxPlayers || 4)),
        visibility, hostName: playerName,
        players: [{ name: playerName, class: "", idx: 0, ready: false, host: true }],
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
      if (room.players[info.playerIdx]) { room.players[info.playerIdx].class = msg.classId; broadcast(info.code); }
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
      room.roles = assignRoles(room.players.length);
      room.status = "started";
      room.startedAt = Date.now();
      room.rolesReady = [];
      room.gameState = createInitialGameState(room);
      broadcast(info.code);
      broadcastRoomList();
      console.log(`[${info.code}] Game started — gameState initialized`);
    }

    if (msg.type === "role_confirmed") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.status !== "started") return;
      if (!room.rolesReady.includes(msg.playerName)) room.rolesReady.push(msg.playerName);
      broadcast(info.code);
      if (room.rolesReady.length >= room.players.length) {
        if (!room.gameState) room.gameState = createInitialGameState(room);
        for (const [cws, cinfo] of clients) {
          if (cinfo.code === info.code && cws.readyState === 1) {
            const snapshot = redactGameStateFor(room.gameState, cinfo.playerIdx);
            cws.send(JSON.stringify({ type: "all_roles_ready", gameState: snapshot }));
          }
        }
        console.log(`[${info.code}] All roles confirmed → sending initial gameState`);
      }
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
