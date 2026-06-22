// src/game/constants/cards.js
// ─────────────────────────────────────────────────────────────────────────────
// "WTK: War of the Three Kingdoms" — เด็คจริง 100 ใบ (เด็คจำกัด ไม่ใช่สุ่มไม่จำกัด)
//   โจมตี 30 (สังหาร) · ป้องกัน 20 (หลบหลีก) · การเมือง 20 (5×4) ·
//   อุปกรณ์ 10 · สนามรบ 10 · ตำนาน 10
//   ตราทรยศถูก "สับ" เข้าเด็คนี้ (ดู engine: buildDeck(betrayerCount))
//
//   type : attack | defense | political | equipment | battlefield | legendary | betrayer
//   count: จำนวนสำเนาในเด็ค (ไม่ระบุ = 1)
//
//   • attack/defense ใช้ id "mana_bolt"/"wind_dodge" (ผูกกับระบบ interrupt: บล็อก/หลบ)
//     และ type จริงในเอนจินยังเป็น "magic" (เพื่อ route ผ่านระบบเดิม) — ดู ENGINE_TYPE
//   • equipment ใช้ effect key เดิม (ทำงานกับ recomputeStats/applyAttackToTarget)
//   • political/legendary/battlefield → server resolve ผ่าน applyPlayableCard (effect: pol_*/leg_*/bf_*)
// ─────────────────────────────────────────────────────────────────────────────

export const RARITY = {
  folk:      { key: "folk",      label: "พื้นบ้าน",     glyph: "·", color: "#9aa7b0", weight: 52, price: 2 },
  forbidden: { key: "forbidden", label: "หวงห้าม",      glyph: "◆", color: "#7fa6ff", weight: 30, price: 4 },
  mythic:    { key: "mythic",    label: "ลี้ลับ",       glyph: "★", color: "#c489ff", weight: 13, price: 6 },
  divine:    { key: "divine",    label: "สมบัติสวรรค์", glyph: "✦", color: "#ffd54a", weight: 5,  price: 9 },
};
export const RARITY_ORDER = ["folk", "forbidden", "mythic", "divine"];

const RARITY_ALIAS = {
  common: "folk", rare: "forbidden", secret: "mythic", uncommon: "forbidden", legendary: "divine",
  "พื้นบ้าน": "folk", "หวงห้าม": "forbidden", "ลี้ลับ": "mythic", "สมบัติสวรรค์": "divine",
};
export function normRarity(r) { return RARITY[r] ? r : (RARITY_ALIAS[r] || "folk"); }
export function rarityMeta(r) { return RARITY[normRarity(r)]; }

export const NEGATIVE_STATUS = new Set([
  "poison", "burn", "freeze", "lock", "blind", "atk_down", "armor_break", "silence",
  "stun", "trip", "slow", "curse",
]);

export const ELEMENTS = ["physical", "fire", "ice", "lightning", "water", "magic", "dark"];

// แปลง type ของเด็ค → type ที่เอนจินเดิมเข้าใจ (attack/defense คือ magic)
export const ENGINE_TYPE = {
  attack: "magic", defense: "magic", equipment: "weapon",
  political: "political", battlefield: "battlefield", legendary: "legendary",
};

// ─── โจมตี (30 ใบ เหมือนกัน) — สังหาร ────────────────────────────────────────
export const ATTACK_CARDS = [
  { id: "mana_bolt", type: "magic", cat: "attack", kind: "attack", name: "สังหาร", ico: "⚔️", rarity: "folk", count: 30,
    cost: 1, dmg: 3, range: 4, target: "enemy", element: "physical", blockable: true, canBlockAoe: true,
    desc: "โจมตีเป้าเดี่ยว DMG 3 · ใช้บล็อกการโจมตีหมู่ได้ · ป้องกันด้วยหลบหลีก" },
];

// ─── ป้องกัน (20 ใบ เหมือนกัน) — หลบหลีก ──────────────────────────────────────
export const DEFENSE_CARDS = [
  { id: "wind_dodge", type: "magic", cat: "defense", kind: "dodge", name: "หลบหลีก", ico: "🌀", rarity: "folk", count: 20,
    cost: 1, target: "self", reactive: true, effect: "dodge_charge", val: 1,
    desc: "ยกเลิกการโจมตี 1 ครั้ง + เคลื่อนที่ 1 ช่อง · ใช้ตอบโต้/บล็อกหมู่ได้" },
];

// ─── การเมือง (20 ใบ — 5 ชนิด ชนิดละ 4) ──────────────────────────────────────
export const POLITICAL_CARDS = [
  { id: "pol_borrow_sword", type: "political", name: "ยืมดาบฆ่าคน", ico: "🗡️", rarity: "forbidden", count: 4,
    target: "enemy", effect: "pol_proxy_kill",
    desc: "บีบให้เป้าหมายโจมตีหรือเสีย HP 1 · บังคับมือผู้อื่นแทนคุณ" },
  { id: "pol_break_alliance", type: "political", name: "แตกพันธมิตร", ico: "💔", rarity: "forbidden", count: 4,
    target: "none", effect: "pol_break_alliance",
    desc: "ยกเลิกพันธมิตรทั้งหมด · ถ้าไม่มี ผู้นำคะแนนสูงสุดทิ้งการ์ดสุ่ม 1 ใบ" },
  { id: "pol_fake_letter", type: "political", name: "สาส์นปลอม", ico: "✉️", rarity: "forbidden", count: 4,
    target: "enemy", effect: "pol_fake_letter",
    desc: "หลอกเป้าหมายให้ทิ้งการ์ดสุ่ม 1 ใบ · เกมจิตวิทยา" },
  { id: "pol_bribe", type: "political", name: "ซื้อใจขุนนาง", ico: "🪙", rarity: "folk", count: 4,
    target: "ally", effect: "pol_bribe",
    desc: "มอบการ์ด 1 ใบให้ผู้เล่น → สร้างพันธมิตรชั่วคราว 1 รอบ" },
  { id: "pol_incite", type: "political", name: "ปลุกระดม", ico: "📢", rarity: "mythic", count: 4,
    target: "highest", effect: "pol_incite",
    desc: "ผู้นำเกม (HP/คะแนนสูงสุด) ทิ้งอุปกรณ์ 1 หรือเสีย HP 2 · ต้านผู้นำ" },
];

// ─── อุปกรณ์ (10 ใบ ไม่ซ้ำ · ติดได้สูงสุด 2) — ใช้ effect key เดิมของเอนจิน ────
export const EQUIPMENT_CARDS = [
  { id: "eq_green_dragon", type: "weapon", cat: "equipment", slot: "weapon", name: "ง้าวมังกรเขียว", ico: "🐲", rarity: "mythic",
    atk: 4, range: 1, effect: "pierce_all", cooldown: 1, desc: "ATK+4 · ระยะ+1 · ทะลุเกราะ · พัก 1 เทิร์น" },
  { id: "eq_silver_spear", type: "weapon", cat: "equipment", slot: "weapon", name: "ทวนงูเงิน", ico: "🐍", rarity: "forbidden",
    atk: 2, effect: "double_hit", desc: "ATK+2 · โจมตีสองครั้งติด (ครั้งสอง -1)" },
  { id: "eq_red_hare", type: "weapon", cat: "equipment", slot: "accessory", name: "ม้าเซ็กเธาว์", ico: "🐎", rarity: "divine",
    range: 1, effect: "swift", desc: "ม้าศึกแดง · ระยะ+1 · เดิน+1 ช่อง" },
  { id: "eq_black_gold_armor", type: "weapon", cat: "equipment", slot: "armor", name: "เกราะทองดำ", ico: "🛡️", rarity: "forbidden",
    def: 3, resist: { physical: 2 }, effect: "reflect", val: 1, desc: "ลดดาเมจกาย -2 · สะท้อน +1 ต่อผู้โจมตี" },
  { id: "eq_fire_bow", type: "weapon", cat: "equipment", slot: "weapon", name: "ธนูเพลิง", ico: "🏹", rarity: "forbidden",
    atk: 3, range: 3, atkElement: "fire", effect: "burn", desc: "ATK+3 ระยะไกล (ไฟ) · ติดลุกไหม้ 2 เทิร์น" },
  { id: "eq_seven_star", type: "weapon", cat: "equipment", slot: "weapon", name: "ดาบเจ็ดดาว", ico: "🗡️", rarity: "mythic",
    atk: 3, effect: "block_down", val: 30, desc: "ATK+3 · ลดโอกาสบล็อกของศัตรู -30%" },
  { id: "eq_jade_shield", type: "weapon", cat: "equipment", slot: "shield", name: "โล่หยก", ico: "🟢", rarity: "forbidden",
    def: 2, immuneStatus: ["curse"], effect: "regen", val: 1, desc: "ป้องกัน -2 · กันคำสาป · ฟื้น HP +1/เทิร์น" },
  { id: "eq_thunder_horse", type: "weapon", cat: "equipment", slot: "accessory", name: "ม้าสายฟ้า", ico: "⚡", rarity: "forbidden",
    range: 1, effect: "swift", desc: "ม้าป้องกัน · ระยะ+1 · เดิน+1 ช่อง (คล่องตัวหนี)" },
  { id: "eq_phoenix_spear", type: "weapon", cat: "equipment", slot: "weapon", name: "หอกมังกรเบญจพรรณ", ico: "🔱", rarity: "mythic",
    atk: 3, effect: "rage", val: 3, desc: "ATK+3 · +1 ดาเมจต่อ HP ที่เสียรอบนี้ (สูงสุด +3)" },
  { id: "eq_twin_planet_ring", type: "weapon", cat: "equipment", slot: "accessory", name: "แหวนคู่ดาวเคราะห์", ico: "💍", rarity: "divine",
    def: 1, effect: "regen_safe", val: 1, desc: "ลดดาเมจ -1 · ฟื้น HP +1 เทิร์นที่ไม่โดนโจมตี" },
];

// ─── สนามรบ (10 ใบ ไม่ซ้ำ · ส่งผลทุกคน) — bf_* → reuse event-fx เมื่อเล่น ──────
export const BATTLEFIELD_CARDS = [
  { id: "bf_red_cliff", type: "battlefield", name: "ศึกผาแดง", ico: "🔥", rarity: "mythic",
    effect: "bf", fx: "buff_all", p: { status: "atk_up", val: 1, dur: 2 },
    desc: "ทุกคนพลังโจมตี +1 ตลอด 1 รอบ — สมรภูมิเดือด" },
  { id: "bf_snow", type: "battlefield", name: "หิมะปกคลุม", ico: "❄️", rarity: "folk",
    effect: "bf", fx: "buff_all", p: { status: "slow", dur: 1 },
    desc: "ทุกคนเคลื่อนที่ช้าลงครึ่งหนึ่ง 1 รอบ" },
  { id: "bf_arrow_rain", type: "battlefield", name: "ฝนธนู", ico: "🏹", rarity: "forbidden",
    effect: "bf", fx: "dmg_all", p: { val: 1 },
    desc: "ทุกคนเสีย HP 1 พร้อมกัน (ห้ามป้องกัน)" },
  { id: "bf_huarong", type: "battlefield", name: "ทางแคบฮัวหยง", ico: "⛰️", rarity: "forbidden",
    effect: "bf", fx: "buff_all", p: { status: "atk_down", val: 1, dur: 1 },
    desc: "ช่องแคบ — ทุกคนพลังโจมตีลด 1 รอบ" },
  { id: "bf_eight_camp", type: "battlefield", name: "ค่ายแปดทิศ", ico: "🧭", rarity: "mythic",
    effect: "bf", fx: "buff_all", p: { status: "def_up", val: 2, dur: 2 },
    desc: "ค่ายกลขงเบ้ง — ทุกคนป้องกัน +2 ตลอด 1 รอบ" },
  { id: "bf_war_fog", type: "battlefield", name: "หมอกสงคราม", ico: "🌁", rarity: "forbidden",
    effect: "bf", fx: "expose_hand", p: { val: 2, dur: 1 },
    desc: "หมอกปกคลุม — ทุกคนหงายการ์ดสุ่ม 2 ใบ 1 เทิร์น" },
  { id: "bf_flood", type: "battlefield", name: "น้ำท่วมค่าย", ico: "🌊", rarity: "forbidden",
    effect: "bf", fx: "dmg_all", p: { val: 2, armorReduce: 1 },
    desc: "น้ำหลากท่วมค่าย — ทุกคนเสีย HP 2 (มีเกราะเสีย 1)" },
  { id: "bf_sandstorm", type: "battlefield", name: "พายุทราย", ico: "🌪️", rarity: "folk",
    effect: "bf", fx: "discard_all", p: { val: 1 },
    desc: "พายุทราย — ทุกคนทิ้งการ์ดสุ่ม 1 ใบ" },
  { id: "bf_dark_moon", type: "battlefield", name: "คืนเดือนมืด", ico: "🌑", rarity: "mythic",
    effect: "bf", fx: "heal_low_dmg_high", p: { heal: 3, dmg: 0 },
    desc: "คืนมืด — ผู้ HP น้อยสุดฟื้น +3 (พักหายใจ)" },
  { id: "bf_three_fire", type: "battlefield", name: "ไฟสามก๊ก", ico: "⚔️", rarity: "divine",
    effect: "bf", fx: "buff_all", p: { status: "atk_up", val: 2, dur: 2 },
    desc: "เพลิงสงครามลุกลาม — ทุกคนพลังโจมตี +2 ตลอด 1 รอบ" },
];

// ─── ตำนาน (10 ใบ ไม่ซ้ำ · มีเงื่อนไข/ต้นทุน · ไม่ชนะทันที) — leg_* server resolve ─
export const LEGENDARY_CARDS = [
  { id: "leg_borrow_arrows", type: "legendary", name: "ยืมเกาทัณฑ์จากเรือฟาง", ico: "🛶", rarity: "divine",
    target: "self", effect: "leg_borrow_arrows", cond: { hpBelowPct: 50 },
    desc: "จั่วการ์ดเท่า HP ที่เสียไป (สูงสุด 6) · ใช้เมื่อ HP < 50%" },
  { id: "leg_empty_fort", type: "legendary", name: "แผนเมืองว่าง", ico: "🏯", rarity: "mythic",
    target: "self", effect: "leg_empty_fort",
    desc: "ป้องกันการโจมตีทุกครั้ง 1 รอบ + จั่ว 2 ใบ · เสี่ยงถ้าถูกจับได้" },
  { id: "leg_burn_red_cliff", type: "legendary", name: "เพลิงเผาผาแดง", ico: "🔥", rarity: "divine",
    target: "enemy", effect: "leg_burn", cond: { handAtLeast: 2 },
    desc: "เป้าหมายเสีย HP ครึ่งหนึ่ง + ทิ้งการ์ด 2 ใบ · คุณทิ้ง 2 ใบ" },
  { id: "leg_seven_capture", type: "legendary", name: "เจ็ดจับเจ็ดปล่อย", ico: "⛓️", rarity: "mythic",
    target: "enemy", effect: "leg_seven_capture", cond: { handAtLeast: 5 },
    desc: "ยึดอุปกรณ์เป้าหมาย 1 ชิ้น · คุณทิ้งการ์ด 2 ใบ" },
  { id: "leg_kongming_life", type: "legendary", name: "ขงเบ้งยืดอายุ", ico: "🕯️", rarity: "divine",
    target: "self", effect: "leg_extend_life", cond: { hpAtMost: 3 },
    desc: "ฟื้น HP กลับครึ่งหนึ่งของ HP สูงสุด · ใช้เมื่อ HP ≤ 3" },
  { id: "leg_three_split", type: "legendary", name: "สามก๊กแตก", ico: "💥", rarity: "mythic",
    target: "none", effect: "leg_three_split",
    desc: "ยกเลิกพันธมิตรทั้งหมด · ทุกคนจั่ว 2 ใบ" },
  { id: "leg_siege", type: "legendary", name: "ล้อมเมืองสามชั้น", ico: "🏰", rarity: "mythic",
    target: "enemy", effect: "leg_siege",
    desc: "เป้าหมายใช้การเมือง/อุปกรณ์ไม่ได้ + ช้า 1 เทิร์น" },
  { id: "leg_beauty", type: "legendary", name: "อุบายสาวงาม", ico: "🌸", rarity: "mythic",
    target: "enemy", effect: "leg_beauty",
    desc: "เป้าหมายสับสน — ทิ้งการ์ดสุ่ม 2 ใบ + สาป 1 เทิร์น" },
  { id: "leg_heaven_swap", type: "legendary", name: "ฟ้าดินสลับขั้ว", ico: "☯️", rarity: "divine",
    target: "highest", effect: "leg_heaven_swap", cond: { hpBelowPct: 60 },
    desc: "สลับ HP กับผู้เล่น HP สูงสุด · ใช้เมื่อตามหลัง · กันด้วยหลบหลีกได้" },
  { id: "leg_six_strat", type: "legendary", name: "หกอุบายปิดฟ้า", ico: "🌌", rarity: "mythic",
    target: "enemy", effect: "leg_six_strat", cond: { handAtLeast: 4 },
    desc: "โจมตีเป้าหมาย 2 ครั้ง + ยึดการ์ดสุ่ม 1 ใบ · ทิ้ง 2 ใบเป็นต้นทุน" },
];

// ─── เด็คเต็ม (แหล่งความจริงเดียวของ "ใบที่มีในเกม") ───────────────────────────
export const DECK_DEFS = [
  ...ATTACK_CARDS, ...DEFENSE_CARDS, ...POLITICAL_CARDS,
  ...EQUIPMENT_CARDS, ...BATTLEFIELD_CARDS, ...LEGENDARY_CARDS,
];

// ขยายตาม count → รายการ 100 ใบจริง (template ยังไม่มี uid)
export function buildDeckTemplates() {
  const out = [];
  for (const c of DECK_DEFS) {
    const n = c.count || 1;
    for (let i = 0; i < n; i++) out.push(c);
  }
  return out;
}

// ─── compat exports (โค้ดเดิมอ้างถึง) ────────────────────────────────────────
//   WEAPON_CARDS = อุปกรณ์ (สำหรับร้านค้า) · MAGIC_CARDS = โจมตี+ป้องกัน
//   TRAP_CARDS เลิกใช้ (ไม่มีในเด็ค 100 ใบ) — คงไว้เป็น [] เพื่อ import เดิมไม่พัง
export const WEAPON_CARDS = EQUIPMENT_CARDS.map(c => ({ ...c, type: "weapon" }));
export const MAGIC_CARDS = [...ATTACK_CARDS, ...DEFENSE_CARDS].map(c => ({ ...c, type: "magic" }));
export const TRAP_CARDS = [];

export const ALL_CARDS = DECK_DEFS;
export const CARD_BY_ID = Object.fromEntries(DECK_DEFS.map(c => [c.id, c]));

// ─── ตราทรยศ — สับเข้าเด็คจริง (engine: buildDeck ใส่ตามจำนวน betrayerCount) ──
export const BETRAYER_CARD = {
  id: "betrayer_mark", type: "betrayer", name: "ตราทรยศ", ico: "🗡️", rarity: "mythic",
  desc: "ถือไว้จนสิ้นเฟส → กลายเป็นผู้ทรยศ · ราชาถือแล้วไม่มีผล · ทิ้ง/ถูกขโมย = ไม่เกิดอะไร",
};

// ─── การจั่วแบบถ่วงน้ำหนัก (ใช้กับ "ร้านค้า" เท่านั้น — เด็คผู้เล่นใช้ finite deck) ─
export function drawWeighted(pool = ALL_CARDS, rng = Math.random) {
  if (!pool.length) return null;
  const tiers = {};
  for (const c of pool) {
    const r = normRarity(c.rarity);
    (tiers[r] = tiers[r] || []).push(c);
  }
  let total = 0;
  const entries = RARITY_ORDER
    .filter(r => tiers[r]?.length)
    .map(r => { total += RARITY[r].weight; return [r, RARITY[r].weight]; });
  let roll = rng() * total;
  let chosen = entries[0][0];
  for (const [r, w] of entries) { if ((roll -= w) <= 0) { chosen = r; break; } }
  const bucket = tiers[chosen];
  return bucket[Math.floor(rng() * bucket.length)];
}
