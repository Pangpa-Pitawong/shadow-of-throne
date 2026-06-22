// ─── Game engine: cards · combat · status · turn flow · events · map gen ──────
//   The tightly-coupled core of the server (one strongly-connected module).
//   RECOMPUTE_GS is the "current gs" used as a default arg by
//   recomputeStats/addStatus/resolveAttack — safe because handlers run
//   synchronously, one websocket message at a time.
import { MAGIC_CARDS, drawWeighted, rarityMeta, BETRAYER_CARD } from "../constants/cards.js";
import {
  gearResistance, isGearActive, hasMetalArmor, METAL_SLOTS,
  computeMagicTargets, applyAttackToTarget,
} from "../utils/cardEngine.js";
import { drawEventCards } from "../constants/events.js";
import { pickQuestChoices } from "../constants/quests.js";
import { CHARACTERS } from "../constants/characters.js";
import { ZONE_EVENT_POOL, ZONE_EVENT_EXCLUDED } from "../constants/zoneEvents.js";
import { rooms, clients } from "./state.js";
import { rnd, shuffle, makeUid } from "./util.js";
import { DIRS8, hexDistanceServer } from "./hex.js";
import { MAP_SIZES, sanitizeMapConfig } from "./mapConfig.js";
import {
  MAX_CARDS_PER_TURN, BASE_MOVE_BUDGET,
  ALL_CARDS_POOL, WEAPON_POOL, MAGIC_POOL, NEG_STATUS,
  CHARACTERS_DATA, STARTING_GEAR, BOSS_TYPES,
} from "./constants.js";
import { send, broadcastGameState } from "./net.js";

// จั่วการ์ดแบบถ่วงน้ำหนักตามความหายาก (% การจั่วตรงตามที่กำหนดใน RARITY)
export function drawRandomCard(pool = ALL_CARDS_POOL) {
  const card = drawWeighted(pool, Math.random);
  return { ...card, uid: makeUid() };
}

// ─── HAND LIMIT: ถือไพ่ได้ไม่เกิน HP ปัจจุบัน (สูงสุด 10 ใบ) ────────────────
//   เกินลิมิต → ตั้ง pendingDiscard ให้ผู้เล่น "เลือกทิ้งเอง" (ไม่ทิ้งสุ่มอัตโนมัติ)
export function handLimit(p) { return Math.min(10, Math.max(1, p.hp)); }
export function enforceHandLimit(p) {
  const lim = handLimit(p);
  p.pendingDiscard = Math.max(0, p.hand.length - lim);
  return p.pendingDiscard;
}
export function giveCard(p, card) {
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
export function setActiveGS(gs) { RECOMPUTE_GS = gs; }

export function recomputeStats(p, gs = RECOMPUTE_GS) {
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
export function applyDamage(gs, p, amount, srcLabel = "", element = "physical", attacker = null) {
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
export function lightningAbsorbTick(gs, p, attacker) {
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
export function breakFragileFireGear(gs, p) {
  const before = (p.equipment || []).length;
  p.equipment = (p.equipment || []).filter(e => !(e.tag || []).includes("fragile_fire"));
  if (p.equipment.length < before) {
    pushLog(gs, `🔥 อุปกรณ์ไม้ของ ${p.name} แตกจากเปลวไฟ!`, "dmg");
    recomputeStats(p, gs);
  }
}

export function addStatus(p, type, duration, value = 0, gs = RECOMPUTE_GS) {
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
export function hasStatus(p, type) { return (p.statusEffects || []).some(s => s.type === type); }

// บัฟ "ลมเวทย์หลบภัย" — ถ้ามี dodge_charge อยู่ ใช้หลบ 1 ครั้ง (กิน 1 stack)
export function consumeDodge(gs, p) {
  const s = (p.statusEffects || []).find(s => s.type === "dodge_charge" && (s.value || 1) > 0);
  if (!s) return false;
  s.value = (s.value || 1) - 1;
  if (s.value <= 0) p.statusEffects = p.statusEffects.filter(x => x !== s);
  recomputeStats(p, gs);
  return true;
}

export function pushLog(gs, msg, type = "") {
  gs.log.unshift({ msg, type, ts: Date.now(), ph: gs.phase, fog: !!gs.fogActive });
  if (gs.log.length > 200) gs.log.length = 200;
}

export function killPlayer(gs, p) {
  if (!p.alive) return;
  p.alive = false;
  p.revealed = true;
  pushLog(gs, `💀 ${p.name} (${p.role}) ถูกกำจัด! — บทบาทถูกเปิดเผย`, "death");
  // เมื่อราชาตาย → ตรวจสอบผู้ทรยศที่ซ่อนอยู่ → เปิดเผยและเพิ่มพลัง ×2 เป็นเวลา 1 เฟส
  if (p.role === "king") {
    const betrayers = gs.players.filter(px => px.alive && px.role === "traitor");
    if (betrayers.length > 0) {
      gs.betrayerRevealEvent = { id: ++gs._eventSeq, phase: gs.phase, count: betrayers.length };
      pushLog(gs, `🗡️ ราชาล้มแล้ว! ผู้ทรยศปรากฏตัว (${betrayers.length} คน) — พลังสองเท่าตลอด 1 เฟส!`, "event");
      for (const b of betrayers) {
        b._betrayerBuffPhase = gs.phase;
        b.baseAtk  = Math.round(b.baseAtk  * 2);
        b.baseDef  = Math.round(b.baseDef  * 2);
        b.baseMove = Math.round(b.baseMove * 2);
        b.maxHp    = Math.min(b.maxHp  * 2, 999);
        b.hp       = Math.min(b.hp     * 2, b.maxHp);
        b.maxMana  = Math.min(b.maxMana * 2, 999);
        b.mana     = Math.min(b.mana   * 2, b.maxMana);
        b.revealed = true;
        recomputeStats(b, gs);
        pushLog(gs, `🗡️ ${b.name} — ผู้ทรยศ! ATK/DEF/SPD ×2 เป็นเวลา 1 เฟส!`, "event");
      }
    }
  }
  checkWinServer(gs);
}

// TERRAIN MOVEMENT + grid distance → server/hex.js

// ─── CARD ENGINE CONTEXT — ฉีด helper ของเกมให้ cardEngine.js ────────────────
export const CARD_CTX = {
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

// CHARACTERS_DATA, STARTING_GEAR, BOSS_TYPES → server/constants.js

// ─── Game State Initializer ──────────────────────────────────────────────────
export function createInitialGameState(room) {
  // ── ตั้งค่าแมพจากห้อง (host เลือกตอนสร้าง) ──────────────────────────────────
  const cfg = sanitizeMapConfig(room.mapConfig);
  if (cfg.random) {
    // สุ่มทั้งหมด — แต่ละภูมิประเทศได้ปริมาณสุ่ม + สถานที่/โซนสุ่ม
    for (const k of Object.keys(cfg.terrain)) cfg.terrain[k] = Math.floor(Math.random() * 3);
    cfg.zoneDensity = Math.floor(Math.random() * 3);
    cfg.dangerZones = Math.random() < 0.8;
    cfg.shops = Math.random() < 0.85;
  }
  // ── ขนาดแมพ (พรีเซ็ต) — medium = 13×11 (เท่าเดิมเป๊ะ) ──────────────────────
  const { cols: COLS, rows: ROWS } = MAP_SIZES[cfg.size] || MAP_SIZES.medium;
  // ─── โซนพิเศษ: หมวดหมู่ + เปิด/ปิดตาม config ──────────────────────────────────
  const CORE_ZONES = new Set(["palace", "throne", "village", "market", "rebel_camp", "quest_board"]);
  const DANGER_ZONES = new Set(["cave", "volcano", "dungeon", "ruins", "dark_forest", "graveyard"]);
  const SHOP_ZONE_TYPES = new Set(["blacksmith", "alchemist", "tavern", "armory"]);
  const densityP = cfg.zoneDensity === 0 ? 0.4 : cfg.zoneDensity === 2 ? 1 : 0.78;
  function zoneEnabled(zone) {
    if (CORE_ZONES.has(zone)) return true;
    if (DANGER_ZONES.has(zone)) return cfg.dangerZones && Math.random() < densityP;
    if (SHOP_ZONE_TYPES.has(zone)) return cfg.shops && Math.random() < Math.max(densityP, 0.6);
    return Math.random() < densityP;
  }

  // ─── เกาะแบบ prototype: 4 ไบโอม (NW หญ้า · NE หิมะ · SW ป่า · SE ทะเลทราย) ──
  //   + แกนกลาง "บัลลังก์เงา" บนที่ราบสูง + วงแหวนเงา + ชายหาดรอบเกาะ + ลาวา
  //   แต่ละช่องเก็บ biome + elev (ความสูงชั้นหิน สำหรับ render voxel) + terrain (ต้นทุนเดิน)
  const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
  const maxR = Math.max(cx, cy);
  const seed = Math.random() * 1000;
  const h2 = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return n - Math.floor(n); };
  const snoise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = h2(x0, y0), b = h2(x0 + 1, y0), c = h2(x0, y0 + 1), d = h2(x0 + 1, y0 + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  };
  const quadrant = (col, row) => {
    const left = (col - row) < (cx - cy);
    const top = (col + row) < (cx + cy);
    return top ? (left ? "grass" : "snow") : (left ? "forest" : "desert");
  };
  const throneR = Math.max(0.8, maxR * 0.18);
  const shadowR = Math.max(1.9, maxR * 0.42);
  const highR = maxR * 0.72;

  // ── สุ่ม "รูปทรงเกาะ" — แต่ละเกมหน้าตาเกาะต่างกัน (กลม/สี่แฉก/แหลม/เกาะคู่/หมู่เกาะ/พระจันทร์เสี้ยว) ──
  //   coastValue คืนค่าระยะชายฝั่งแบบ normalize: <0.84 = แผ่นดินใน · 0.84–1.0 = ชายหาด · >1.0 = ทะเล
  const ISLAND_SHAPES = ["round", "round", "clover", "peninsulas", "twin", "archipelago", "crescent"];
  const islandShape = ISLAND_SHAPES[Math.floor(Math.random() * ISLAND_SHAPES.length)];
  const shapePhase = Math.random() * Math.PI * 2;
  const coastValue = (dx, dy) => {
    const rad = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);
    switch (islandShape) {
      case "clover":      return rad / (1 + 0.18 * Math.cos(3 * theta + shapePhase));      // สี่แฉกมน
      case "peninsulas":  return rad / (1 + 0.26 * Math.cos(5 * theta + shapePhase));      // แหลมยื่น 5 ทิศ
      case "twin":        return Math.min(Math.hypot((dx - 0.42) / 0.82, dy / 0.92),       // เกาะคู่
                                          Math.hypot((dx + 0.42) / 0.82, dy / 0.92));
      case "archipelago": return rad * 0.78;                                               // แกนเล็ก + noise แรง → หมู่เกาะ
      case "crescent": {                                                                    // พระจันทร์เสี้ยว (เว้าด้านเดียว)
        const bx = Math.cos(shapePhase) * 0.95, by = Math.sin(shapePhase) * 0.95;
        return Math.max(rad, 1.18 - Math.hypot(dx - bx, dy - by));
      }
      default:            return rad;                                                       // กลม (ก้อนออร์แกนิก)
    }
  };
  const coastNoiseAmp = islandShape === "archipelago" ? 0.78 : 0.5;

  // ── ความสูง "พื้นฐานตามไบโอม" — ทะเลทราย=ราบต่ำเรียบ · หญ้า=ที่ราบ · ป่า=เนิน · หิมะ=เทือกเขาสูง ──
  //   base = ความสูงพื้น · hill = ความแรงของเนินสุ่ม (smoothing จะ cap ตามระยะถึงทะเล → ไบโอม base ต่ำจะเตี้ย/เรียบกว่า)
  const BIOME_BASE = { grass: 1.0, forest: 1.8, desert: 0.2, snow: 2.8 };
  const BIOME_HILL = { grass: 1.4, forest: 2.2, desert: 0.7, snow: 3.2 };

  // ── 1) ไบโอม + แนวชายฝั่งหยัก (organic) + "ความสูงดิบ" (raw height field) ──
  //   ใช้ central peak (บัลลังก์) + เนินสุ่ม แล้วค่อย smooth ทีหลังให้เป็นลาดธรรมชาติ
  const info = {};
  const PEAK = Math.min(7, Math.max(4, Math.round(maxR * 0.55)));
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const d = Math.hypot(col - cx, row - cy);
    const dx = (col - cx) / (cx + 0.5), dy = (row - cy) / (cy + 0.5);
    const coast = coastValue(dx, dy) + (snoise(col * 0.6 + 5, row * 0.6 + 9) - 0.5) * coastNoiseAmp;
    const bm = quadrant(col, row);
    let biome, terrain, rawH;
    if (coast > 1.0 && d > shadowR) { biome = "water"; terrain = "water"; rawH = 0; }
    else if (d < throneR) { biome = "throne"; terrain = "mountain"; rawH = PEAK; }
    else if (d < shadowR) { biome = "shadow"; terrain = "mountain"; rawH = PEAK - 2; }
    else {
      const beach = coast > 0.84;
      if (beach) { biome = bm === "snow" ? "snow" : "beach"; terrain = "plains"; rawH = 0; }
      else {
        biome = bm; terrain = bm === "forest" ? "forest" : bm === "desert" ? "desert" : "plains";
        // ความสูง = ฐานไบโอม + ยกเข้าหากลางแบบนุ่ม + เนินสุ่ม (สเกลตามไบโอม) → smoothing จะแกะเป็นลาดขั้นบันได
        const central = Math.max(0, 1 - d / (shadowR * 1.9)) * 1.5;
        const hills = snoise(col * 0.34 + 9, row * 0.34 + 3) * (BIOME_HILL[bm] || 1.4);
        rawH = (BIOME_BASE[bm] || 1.0) + central + hills;
      }
    }
    info[`${col},${row}`] = { biome, terrain, rawH, elev: 0 };
  }

  // ── 2) Smoothing: บังคับความต่างความสูงกับเพื่อนบ้าน ≤ 1 ชั้น ──
  //   กำจัด "บล็อกโดดสูง" + ได้ลาดขั้นบันไดธรรมชาติ + บัลลังก์กลายเป็นพีระมิดขั้นบันไดสวยงาม
  const keyList = Object.keys(info);
  for (let pass = 0; pass < 8; pass++) {
    for (const k of keyList) {
      const c = info[k]; if (c.biome === "water") continue;
      const [cc, rr] = k.split(",").map(Number);
      let minN = Infinity;
      for (const [dc, dr] of DIRS8) { const n = info[`${cc + dc},${rr + dr}`]; if (n && n.biome !== "water" && n.rawH < minN) minN = n.rawH; }
      if (minN !== Infinity && c.rawH > minN + 1) c.rawH = minN + 1;
    }
  }
  for (const k of keyList) { const c = info[k]; c.elev = c.biome === "water" ? 0 : Math.max(0, Math.round(c.rawH)); }
  void highR;

  // ลาวาในไบโอมทะเลทราย (SE) ใกล้แกนกลาง — เลี่ยงแกนบัลลังก์/วงเงา
  for (let s = 0; s <= 8; s++) {
    const t = s / 8;
    const c0 = Math.round(cx + (throneR + 0.6) + (shadowR - throneR) * t);
    const r0 = Math.round(cy + (throneR + 0.6) + (shadowR - throneR) * t);
    const cell = info[`${c0},${r0}`];
    if (cell && !["throne", "shadow", "water"].includes(cell.biome)) { cell.biome = "lava"; cell.terrain = "mountain"; } // คงความสูง smooth
  }

  // ─── จุดเกิดผู้เล่น: เลือกช่อง "บก" ที่ใกล้มุม/ขอบที่สุด (เกาะออร์แกนิก มุมอาจเป็นทะเล) ──
  const midC = Math.floor(COLS / 2), midR = Math.floor(ROWS / 2);
  const anchors = [[0, 0], [COLS - 1, 0], [0, ROWS - 1], [COLS - 1, ROWS - 1], [midC, 0], [midC, ROWS - 1], [0, midR], [COLS - 1, midR]];
  const takenSpawn = new Set([`${Math.round(cx)},${Math.round(cy)}`]);
  const nearestLand = (ac, ar) => {
    let best = null, bd = 1e9;
    for (const k in info) {
      if (takenSpawn.has(k) || info[k].biome === "water") continue;
      const [cc, rr] = k.split(",").map(Number);
      const dd = Math.hypot(cc - ac, rr - ar);
      if (dd < bd) { bd = dd; best = [cc, rr]; }
    }
    return best;
  };
  const spawnPositions = [];
  for (const [ac, ar] of anchors) {
    const l = nearestLand(ac, ar) || [ac, ar];
    takenSpawn.add(`${l[0]},${l[1]}`);
    spawnPositions.push({ col: l[0], row: l[1] });
  }
  const spawnKeys = new Set(spawnPositions.map(s => `${s.col},${s.row}`));
  for (const k of spawnKeys) {
    const c = info[k]; if (!c) continue;
    if (["throne", "shadow", "lava", "water"].includes(c.biome)) c.biome = "beach";
    c.terrain = "plains"; // คงความสูง smooth ของช่อง
  }

  // ─── วางโซนพิเศษบนเกาะตามไบโอม (บัลลังก์อยู่กลางเสมอ) ──
  const usedZone = {};
  const zoneToCell = {};
  const tcc = Math.round(cx), trr = Math.round(cy);
  const ctrKey = `${tcc},${trr}`;
  usedZone[ctrKey] = "throne"; zoneToCell["throne"] = ctrKey;
  // footprint บัลลังก์ 3×3: ปรับให้ "ราบเท่ากัน" โดยลงมาที่ระดับต่ำสุดของ footprint
  //   (ลงเท่านั้น → ไม่สร้างหน้าผา >1 ชั้นกับเพื่อนบ้าน) + จองช่องกันพร็อพ/ปราสาทคร่อม
  if (info[ctrKey]) {
    const foot = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const c = info[`${tcc + dc},${trr + dr}`]; if (c && c.biome !== "water") foot.push(c); }
    const te = foot.reduce((m, c) => Math.min(m, c.elev), Infinity);
    for (const c of foot) { c.elev = te; c.reserved = true; if (c !== info[ctrKey]) { c.biome = "shadow"; c.terrain = "mountain"; } }
    info[ctrKey].biome = "throne"; info[ctrKey].terrain = "mountain";
  }

  const ZONE_PRED = {
    palace: c => c.biome === "shadow",
    village: c => c.biome === "grass",
    market: c => c.elev >= 1 && c.biome !== "beach" && c.biome !== "lava",
    rebel_camp: c => c.biome === "forest",
    quest_board: () => true,
    dark_forest: c => c.biome === "forest",
    graveyard: c => c.biome === "forest",
    cave: c => c.terrain === "mountain",
    dungeon: c => c.terrain === "mountain",
    volcano: c => c.biome === "lava" || c.biome === "desert",
    ruins: c => c.terrain === "mountain" || c.biome === "desert",
    blacksmith: c => c.biome === "grass" || c.biome === "snow",
    alchemist: c => c.biome === "snow" || c.biome === "forest",
    tavern: c => c.biome === "grass",
    armory: c => c.terrain === "mountain" || c.biome === "snow",
    tower: c => c.biome === "snow" || c.biome === "grass",
    shrine: c => c.biome === "snow" || c.biome === "beach",
    treasure: c => c.biome === "desert" || c.terrain === "mountain",
    farm: c => c.biome === "grass",
    river: c => c.biome === "grass" || c.biome === "forest",
    watchtower: c => c.biome === "snow" || c.biome === "grass",
    portal: () => true,
    oasis: c => c.biome === "desert",
  };
  function placeZone(zone, mustPlace) {
    const pred = ZONE_PRED[zone] || (() => true);
    let cands = [];
    for (const k in info) {
      if (usedZone[k] || spawnKeys.has(k)) continue;
      const c = info[k]; if (c.biome === "throne" || c.biome === "water") continue;
      if (pred(c)) cands.push(k);
    }
    if (!cands.length && mustPlace) {
      for (const k in info) if (!usedZone[k] && !spawnKeys.has(k) && info[k].biome !== "throne" && info[k].biome !== "water") cands.push(k);
    }
    if (!cands.length) return;
    const k = cands[Math.floor(Math.random() * cands.length)];
    usedZone[k] = zone; zoneToCell[zone] = k;
  }
  const ZONE_ORDER = ["palace", "village", "market", "rebel_camp", "quest_board",
    "cave", "volcano", "dungeon", "ruins", "dark_forest", "graveyard",
    "blacksmith", "alchemist", "tavern", "armory",
    "tower", "shrine", "treasure", "farm", "river", "watchtower", "portal", "oasis"];
  for (const z of ZONE_ORDER) if (zoneEnabled(z)) placeZone(z, CORE_ZONES.has(z));

  // ─── สร้าง cells (แนบ biome + elev สำหรับ render voxel) ──
  const cells = [];
  const SHOP_ZONES = ["market", "blacksmith", "alchemist", "tavern", "armory"];
  const FLAT_ZONES = new Set(["palace", "village", "market", "quest_board", "blacksmith", "alchemist", "tavern", "farm", "shrine", "oasis", "portal", "tower", "treasure", "watchtower"]);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const key = `${col},${row}`; const c = info[key];
    const specialZone = usedZone[key] || null;
    let terrain = c.terrain;
    if (specialZone && FLAT_ZONES.has(specialZone) && terrain === "water") terrain = "plains";
    let shopItems = null;
    if (specialZone && SHOP_ZONES.includes(specialZone)) shopItems = generateShopItemsServer(specialZone);
    cells.push({ col, row, key, terrain, specialZone, trap: null, shopItems, biome: c.biome, elev: c.elev, reserved: !!c.reserved });
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
    mapCols: COLS,
    mapRows: ROWS,
    mapSize: cfg.size,
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
  // ─── แจกตราทรยศ 2 ใบให้ผู้เล่นสุ่ม (ไม่ใช่ราชา) ─────────────────────────────
  //   ผู้ที่ถือไว้จนสิ้นเฟส → กลายเป็นผู้ทรยศโดยไม่มีใครรู้
  const nonKings = players.filter(p => p.role !== "king");
  shuffle([...nonKings]).slice(0, Math.min(2, nonKings.length)).forEach(p => {
    p.hand.push({ ...BETRAYER_CARD, uid: makeUid() });
  });

  setActiveGS(gs);
  pushLog(gs, "🏰 เกมเริ่มต้น! พระราชาเปิดตัวและเริ่มเล่นก่อน", "event");
  pushLog(gs, "🗡️ ตราทรยศถูกแจกให้ผู้เล่นที่ซ่อนอยู่ในเงามืด... (เฉพาะผู้ถือเห็นในมือตัวเอง)", "event");
  if (kingBuffPct > 0) pushLog(gs, `👑 ผู้เล่น ${totalPlayers} คน — พระราชาได้รับพรราชวงศ์ ค่าสถานะ +${Math.round(kingBuffPct * 100)}%`, "event");
  pushLog(gs, `👑 ${players[turnOrder[0]]?.name} (พระราชา) เริ่มเทิร์นแรก`, "turn");
  beginTurn(gs, true);
  return gs;
}

// ─── Server-side shop items ──────────────────────────────────────────────────
export function generateShopItemsServer(zoneType) {
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
export function applyZoneEffectServer(player, cell, gs) {
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
export function applyRandomZoneEvent(player, cell, gs) {
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

export function startTraitorOffer(gs, code) {
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

export function resolveTraitorOffer(gs, code, accepted, responderIdx) {
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
export function checkQuestProgress(player, cell, gs) {
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
export function grantQuestReward(player, reward, gs) {
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
export function resolveAttack(attacker, defender, gs = RECOMPUTE_GS) {
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
export function beginTurn(gs, isFirst = false, guard = 0) {
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
  p._moveTrail = null;                     // ล้างเส้นทางเดินเก่า (อนิเมชันฝั่ง client)
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

export function advancePointer(gs) {
  const n = gs.turnOrder.length;
  for (let i = 0; i < n; i++) {
    gs.turnPointer = (gs.turnPointer + 1) % n;
    const idx = gs.turnOrder[gs.turnPointer];
    if (gs.players[idx]?.alive) { gs.currentTurn = idx; return; }
  }
}

// ─── PHASE ADVANCE ───────────────────────────────────────────────────────────
export function onPhaseAdvance(gs) {
  setActiveGS(gs);

  // ── หมดเวลาบัฟทรยศ (×2 พลัง เป็นเวลา 1 เฟส) ──────────────────────────────
  for (const p of gs.players) {
    if (p._betrayerBuffPhase != null && gs.phase > p._betrayerBuffPhase) {
      p.baseAtk  = Math.max(1, Math.round(p.baseAtk  / 2));
      p.baseDef  = Math.max(0, Math.round(p.baseDef  / 2));
      p.baseMove = Math.max(1, Math.round(p.baseMove / 2));
      p.maxHp    = Math.max(1, Math.round(p.maxHp  / 2));
      p.hp       = Math.min(p.hp, p.maxHp);
      p.maxMana  = Math.max(0, Math.round(p.maxMana / 2));
      p.mana     = Math.min(p.mana, p.maxMana);
      p._betrayerBuffPhase = null;
      recomputeStats(p, gs);
      pushLog(gs, `🗡️ ${p.name} — พลังทรยศหมดลง (กลับสู่ค่าปกติ)`, "event");
    }
  }

  // ── ตรวจสอบตราทรยศ: ผู้ถือจนสิ้นเฟส → กลายเป็นผู้ทรยศ ────────────────────
  for (const p of gs.players) {
    if (!p.alive) continue;
    const betIdx = (p.hand || []).findIndex(c => c.type === "betrayer");
    if (betIdx < 0) continue;
    // ราชาถือ → ไม่มีผล
    if (p.role === "king") continue;
    // กลายเป็นทรยศ + ลบตรา
    p.role = "traitor";
    p.revealed = false;
    p.hand.splice(betIdx, 1);
    pushLog(gs, `🗡️ ผู้ถือตราทรยศในเฟสนี้กลายเป็นผู้ทรยศในเงามืด... (ตัวตนยังคงลับ)`, "event");
  }

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
export function applyEventCard(gs, ev) {
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
export function bossTurn(gs) {
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
export function checkWinServer(gs) {
  if (gs.gameOver) return;

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
      // ไม่มีทรยศ — กบฏชนะเมื่อราชาตาย
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

export function startAttackCard(gs, code, ws, cp, card, cardIdx, { targetPlayer, targetCell }) {
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

export function resolveAttackCard(gs, code, caster, card, { targetCell }, entries) {
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

export function autoResolveInterrupt(code, iid) {
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
