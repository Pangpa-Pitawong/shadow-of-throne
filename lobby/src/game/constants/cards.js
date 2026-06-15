// src/game/constants/cards.js
// ─────────────────────────────────────────────────────────────────────────────
// การ์ดทั้งหมด — แชร์ระหว่าง client (แสดงผล) และ server (ตรรกะจริง)
// ทุกใบใน pool นี้ "ทำงานได้จริง" ในเอนจิน (ดู utils/cardEngine.js)
//
//   type   : weapon | magic | trap
//   rarity : folk | forbidden | mythic | divine  (ความหายาก → % การจั่ว)
//   effect : คีย์เอฟเฟกต์ ที่เอนจินนำไปประมวลผล (ดูตารางด้านล่าง)
//
// ── WEAPON (สวมใส่ → ค่าพลังถาวร + เอฟเฟกต์ตอนโจมตี/ตอนสวม) ──────────────────
//    plain      : เพิ่ม atk/def/range เฉยๆ
//    ranged     : อาวุธระยะไกล (ใช้ค่า range)
//    backstab   : คริติคอลง่ายขึ้น (ทอย 5-6 = คริต)
//    pierce     : เจาะเกราะ (ลดผลของ DEF ฝ่ายรับครึ่งหนึ่ง)
//    double     : ทอย 6 → ฟันซ้ำอีกครั้ง
//    lifesteal  : ตีโดน → ดูดเลือดครึ่งดาเมจ
//    burn       : ตีโดน → ติดไฟ 2 เทิร์น (DOT)
//    freeze     : ตีโดน → แช่แข็งเป้า 1 เทิร์น (ข้ามเทิร์น)
//    poison_hit : ตีโดน → ติดพิษ 2 เทิร์น (DOT)
//    stun       : ตีโดน → ล็อกเป้า 1 เทิร์น (เดินไม่ได้)
//    aoe        : ตีโดน → กระเด็นโดนศัตรูข้างเคียง (ครึ่งดาเมจ)
//    reflect    : (เกราะ) ผู้โจมตีเสีย HP 1 ทุกครั้งที่ตีเรา
//    evade      : (เกราะ) เพิ่มโบนัสหลบ +2 (แก้ทางอาวุธแรง/ธนู)
//    anticrit   : (เกราะ) ลบโอกาสโดนคริติคอลของศัตรู
//    swift      : เพิ่มระยะเดิน +1
//    king_only  : ราชาถือ → ATK เพิ่มอีก +2
//    self_dmg   : ตอนสวมเสีย HP 1   |  blood : เสีย HP 2  |  def_heal : ฟื้น HP 1
//
// ── MAGIC (ใช้มานา) — target: enemy | self | ally | team | aoe | tile | none ──
//    dmg/heal   : ดาเมจ/ฟื้น HP
//    effect     : สถานะที่ติดให้เป้าหมาย (ดู STATUS ด้านล่าง) + dur/val
//    lifedrain  : ฟื้น HP ผู้ร่ายเท่าดาเมจที่ทำได้
//    draw       : จั่วการ์ดเพิ่ม n ใบ        |  cleanse : ล้างสถานะลบของเป้าหมาย
//    selfHp     : เสีย HP ตัวเองก่อนใช้      |  once : ใช้ได้ครั้งเดียวต่อเกม
//    range      : ระยะเล็งเป้า (enemy/aoe)   |  teleport : ย้ายตัวเอง (target tile)
//
// ── STATUS ที่เอนจินรองรับ ────────────────────────────────────────────────
//    ลบ : poison · burn · freeze · lock · blind · atk_down · armor_break · silence
//    บวก: regen · shield · def_up · atk_up
//
// ── TRAP (วางบนช่อง → ทำงานเมื่อศัตรูเดินเข้า) ─────────────────────────────
//    dmg · poison · lock · blind · burn · freeze · armor_break
// ─────────────────────────────────────────────────────────────────────────────

// ─── ความหายาก + น้ำหนักการจั่ว (รวม = 100 → อ่านเป็น %) ─────────────────────
export const RARITY = {
  folk:      { key: "folk",      label: "พื้นบ้าน",     glyph: "·", color: "#9aa7b0", weight: 52, price: 2 },
  forbidden: { key: "forbidden", label: "หวงห้าม",      glyph: "◆", color: "#7fa6ff", weight: 30, price: 4 },
  mythic:    { key: "mythic",    label: "ลี้ลับ",       glyph: "★", color: "#c489ff", weight: 13, price: 6 },
  divine:    { key: "divine",    label: "สมบัติสวรรค์", glyph: "✦", color: "#ffd54a", weight: 5,  price: 9 },
};
export const RARITY_ORDER = ["folk", "forbidden", "mythic", "divine"];

// เผื่อ map ค่าเก่า (common/rare/secret) ให้เข้ากับระบบใหม่
const RARITY_ALIAS = { common: "folk", rare: "forbidden", secret: "mythic", divine: "divine", uncommon: "forbidden", legendary: "divine" };
export function normRarity(r) { return RARITY[r] ? r : (RARITY_ALIAS[r] || "folk"); }
export function rarityMeta(r) { return RARITY[normRarity(r)]; }

// สถานะ "เชิงลบ" — ใช้โดย cleanse/dispel เพื่อรู้ว่าอะไรล้างได้
export const NEGATIVE_STATUS = new Set([
  "poison", "burn", "freeze", "lock", "blind", "atk_down", "armor_break", "silence",
]);

// ─── อาวุธ / เกราะ ────────────────────────────────────────────────────────────
export const WEAPON_CARDS = [
  // — พื้นบ้าน —
  { id: "throwing_knife", type: "weapon", name: "มีดขว้าง",          ico: "🔪", rarity: "folk", atk: 1, range: 2, effect: "ranged",     desc: "ATK+1 · ระยะ 2" },
  { id: "dagger",         type: "weapon", name: "มีดลอบสังหาร",       ico: "🗡️", rarity: "folk", atk: 2, range: 0, effect: "backstab",   desc: "ATK+2 · คริตง่าย (ลอบโจมตี)" },
  { id: "battle_axe",     type: "weapon", name: "ขวานสองคม",          ico: "🪓", rarity: "folk", atk: 3, range: 0, effect: "self_dmg",   desc: "ATK+3 · สวมเสีย HP1" },
  { id: "snake_sword",    type: "weapon", name: "ดาบพิษงูเขียว",      ico: "🐍", rarity: "folk", atk: 1, range: 0, effect: "poison_hit", desc: "ATK+1 · ตีโดนติดพิษ 2 เทิร์น" },
  { id: "tiger_sword",    type: "weapon", name: "ดาบพยัคฆ์คำราม",     ico: "🐅", rarity: "folk", atk: 2, range: 0, effect: "plain",      desc: "ATK+2 ดาบเสือโบราณ" },
  { id: "oak_shield",     type: "weapon", name: "โล่ไม้โอ๊คศักดิ์สิทธิ์", ico: "🛡️", rarity: "folk", def: 1, range: 0, effect: "def_heal", desc: "DEF+1 · สวมฟื้น HP+1" },
  { id: "thorn_armor",    type: "weapon", name: "เกราะหนามเหล็ก",     ico: "🔰", rarity: "folk", def: 1, range: 0, effect: "reflect",    desc: "DEF+1 · สะท้อนผู้โจมตี HP-1" },
  { id: "wind_armor",     type: "weapon", name: "เกราะวายุพัด",       ico: "💨", rarity: "folk", def: 2, range: 0, effect: "plain",      desc: "DEF+2 ลดความเสียหายธนู" },
  { id: "eagle_armor",    type: "weapon", name: "เกราะขนนกอินทรี",    ico: "🪶", rarity: "folk", def: 1, range: 0, effect: "swift",      desc: "DEF+1 · ระยะเดิน +1" },
  { id: "knight_helm",    type: "weapon", name: "หมวกเหล็กแห่งอัศวิน", ico: "⛑️", rarity: "folk", def: 1, range: 0, effect: "anticrit",   desc: "DEF+1 · กันคริติคอลจากศัตรู" },
  { id: "sea_armor",      type: "weapon", name: "เกราะคลื่นสมุทร",    ico: "🌊", rarity: "folk", def: 2, range: 0, effect: "plain",      desc: "DEF+2 เกราะชุบน้ำ" },
  // — หวงห้าม —
  { id: "long_bow",       type: "weapon", name: "ธนูยาว",            ico: "🏹", rarity: "forbidden", atk: 2, range: 3, effect: "ranged",   desc: "ATK+2 · ระยะ 3" },
  { id: "fire_spear",     type: "weapon", name: "หอกปลายเพลิง",       ico: "🔱", rarity: "forbidden", atk: 3, range: 1, effect: "burn",     desc: "ATK+3 ระยะ1 · ตีโดนเผา 2 เทิร์น" },
  { id: "ice_bow",        type: "weapon", name: "ธนูคริสตัลน้ำแข็ง",   ico: "🎯", rarity: "forbidden", atk: 2, range: 3, effect: "freeze",   desc: "ATK+2 ระยะ3 · ตีโดนแช่แข็ง 1 เทิร์น" },
  { id: "double_blade",   type: "weapon", name: "ดาบปีกนกฟ้า",        ico: "⚔️", rarity: "forbidden", atk: 2, range: 0, effect: "double",   desc: "ATK+2 · ทอย6 ฟันซ้ำอีกครั้ง" },
  { id: "fireheart_sword",type: "weapon", name: "ดาบหทัยอัคคี",       ico: "❤️‍🔥", rarity: "forbidden", atk: 4, range: 0, effect: "self_dmg", desc: "ATK+4 · สวมเสีย HP1" },
  { id: "camo_armor",     type: "weapon", name: "เกราะพรางเงา",       ico: "🥷", rarity: "forbidden", def: 1, range: 0, effect: "evade",    desc: "DEF+1 · โบนัสหลบ +2" },
  // — ลี้ลับ —
  { id: "blood_sword",    type: "weapon", name: "ดาบเลือดสาบาน",      ico: "💀", rarity: "mythic", atk: 6, range: 0, effect: "blood",      desc: "ATK+6 · สวมเสีย HP2" },
  { id: "void_sword",     type: "weapon", name: "ดาบสิ้นแสงศักดิ์",   ico: "🌘", rarity: "mythic", atk: 3, range: 0, effect: "pierce",     desc: "ATK+3 · เจาะเกราะครึ่งหนึ่ง" },
  { id: "phoenix_shield", type: "weapon", name: "โล่เพลิงมังกร",      ico: "🐉", rarity: "mythic", def: 3, range: 0, effect: "reflect",    desc: "DEF+3 · สะท้อนความร้อนผู้โจมตี" },
  { id: "vampire_axe",    type: "weapon", name: "ขวานโลหิตทมิฬ",      ico: "🩸", rarity: "mythic", atk: 4, range: 0, effect: "lifesteal",  desc: "ATK+4 · ดูดเลือดครึ่งดาเมจ" },
  { id: "moon_bow",       type: "weapon", name: "ธนูชะตาจันทรา",      ico: "🌙", rarity: "mythic", atk: 3, range: 4, effect: "ranged",    desc: "ATK+3 · ระยะ 4 (เล็งไกล)" },
  { id: "dragonbone_sword",type:"weapon", name: "ดาบกระดูกมังกร",     ico: "🦴", rarity: "mythic", atk: 4, range: 0, effect: "plain",      desc: "ATK+4 ดาบกระดูกโบราณ" },
  { id: "shadow_axe",     type: "weapon", name: "ขวานเงาเวหา",        ico: "🌑", rarity: "mythic", atk: 4, range: 0, effect: "backstab",   desc: "ATK+4 · คริตง่าย (ลอบฟันจากฟ้า)" },
  // — สมบัติสวรรค์ —
  { id: "sword_king",     type: "weapon", name: "ดาบแห่งกษัตริย์",    ico: "👑", rarity: "divine", atk: 2, range: 0, effect: "king_only",  desc: "ATK+2 (ราชา +4 รวม)" },
  { id: "dragon_armor",   type: "weapon", name: "เกราะเงินมังกร",     ico: "🐲", rarity: "divine", def: 3, range: 0, effect: "plain",      desc: "DEF+3 โลหะเงินเกล็ดมังกร" },
  { id: "war_hammer",     type: "weapon", name: "ค้อนราชันย์สังหาร",  ico: "🔨", rarity: "divine", atk: 5, range: 1, effect: "aoe",       desc: "ATK+5 ระยะ1 · สะเทือนโดนศัตรูข้างเคียง" },
  { id: "earth_sword",    type: "weapon", name: "ดาบพสุธาแตก",        ico: "🌎", rarity: "divine", atk: 4, range: 1, effect: "aoe",       desc: "ATK+4 ระยะ1 · ความเสียหายหมู่" },
  { id: "primordial_shield",type:"weapon",name: "โล่แห่งปฐมกาล",      ico: "🛡️", rarity: "divine", def: 5, range: 0, effect: "plain",      desc: "DEF+5 โล่ตำนานป้องกันทุกสิ่ง" },
];

// ─── เวทมนตร์ ─────────────────────────────────────────────────────────────────
export const MAGIC_CARDS = [
  // — โจมตีเดี่ยว —
  { id: "hellfire",     type: "magic", name: "ไฟนรกกรีดวิญญาณ",  ico: "🔥", rarity: "forbidden", cost: 3, dmg: 6, range: 4, target: "enemy", desc: "DMG 6 เป้าเดี่ยว" },
  { id: "ice_storm",    type: "magic", name: "หิมะนิรันดร์",     ico: "❄️", rarity: "forbidden", cost: 3, dmg: 3, range: 4, target: "enemy", effect: "freeze", dur: 1, desc: "DMG 3 + แช่แข็ง 1 เทิร์น" },
  { id: "thunder_smite",type: "magic", name: "สายฟ้าลงทัณฑ์",    ico: "🌩️", rarity: "forbidden", cost: 4, dmg: 6, range: 5, target: "enemy", desc: "DMG 6 สายฟ้า เป้าเดี่ยว" },
  { id: "soul_wind",    type: "magic", name: "ลมตัดวิญญาณ",      ico: "🌬️", rarity: "forbidden", cost: 2, dmg: 4, range: 4, target: "enemy", desc: "DMG 4 ลมเฉือน" },
  { id: "soul_drain",   type: "magic", name: "เวทย์ดูดวิญญาณ",   ico: "🫧", rarity: "mythic",    cost: 3, dmg: 3, range: 3, target: "enemy", lifedrain: true, desc: "DMG 3 + ดูด HP เท่าดาเมจ" },
  { id: "heaven_flame", type: "magic", name: "เปลวเพลิงสวรรค์",  ico: "💥", rarity: "divine",    cost: 5, dmg: 8, range: 5, target: "enemy", once: true, desc: "DMG 8 (1 ครั้ง/เกม)" },
  // — โจมตีหมู่ (AOE) —
  { id: "lightning",    type: "magic", name: "พายุสายฟ้าสวรรค์", ico: "⚡", rarity: "mythic",    cost: 5, dmg: 3, range: 4, target: "aoe", desc: "DMG 3 ศัตรูทุกตัวในระยะ 4" },
  { id: "meteor",       type: "magic", name: "ไฟกัลป์กลืนภพ",    ico: "☄️", rarity: "divine",    cost: 7, dmg: 5, range: 5, target: "aoe", desc: "DMG 5 ศัตรูทุกตัว (รุนแรง)" },
  // — ฟื้น/บัฟ —
  { id: "holy_heal",    type: "magic", name: "แสงศักดิ์สิทธิ์",   ico: "✨", rarity: "forbidden", cost: 3, heal: 5, range: 4, target: "ally", desc: "ฟื้น HP+5 (ตน/พันธมิตร)" },
  { id: "bell_heal",    type: "magic", name: "เสียงระฆังสวรรค์",  ico: "🔔", rarity: "folk",      cost: 2, heal: 2, range: 2, target: "team", desc: "ฟื้น HP+2 รอบตัว (ระยะ2)" },
  { id: "amrita",       type: "magic", name: "น้ำอมฤต",          ico: "💧", rarity: "divine",    cost: 0, heal: 99, target: "self", once: true, desc: "ฟื้น HP เต็ม (1 ครั้ง/เกม)" },
  { id: "regen",        type: "magic", name: "ฟื้นฟูอัตโนมัติ",   ico: "🌿", rarity: "folk",      cost: 2, target: "self", effect: "regen", dur: 4, val: 1, desc: "ฟื้น HP+1 ทุกเทิร์น (4 เทิร์น)" },
  { id: "light_barrier",type: "magic", name: "ปราการแสง",        ico: "🟡", rarity: "forbidden", cost: 2, target: "self", effect: "shield", val: 1, desc: "กันดาเมจครั้งถัดไป 1 ครั้ง" },
  { id: "team_barrier", type: "magic", name: "เวทย์บาเรียหมู่",   ico: "🔆", rarity: "mythic",    cost: 4, target: "team", range: 2, effect: "shield", val: 1, desc: "กันดาเมจ 1 ครั้ง รอบตัว (ระยะ2)" },
  { id: "saint_bless",  type: "magic", name: "พรแห่งนักบุญ",     ico: "🕊️", rarity: "mythic",    cost: 3, target: "team", range: 2, effect: "def_up", dur: 2, val: 2, desc: "DEF+2 รอบตัว (2 เทิร์น)" },
  { id: "blood_oath",   type: "magic", name: "คำสาบานแห่งเลือด", ico: "🔺", rarity: "folk",      cost: 1, target: "self", effect: "atk_up", dur: 2, val: 5, selfHp: 3, desc: "เสีย HP3 → ATK+5 (1 เทิร์น)" },
  { id: "lucky_wind",   type: "magic", name: "ลมพัดโชค",         ico: "🍃", rarity: "folk",      cost: 2, target: "self", draw: 2, desc: "จั่วการ์ดเพิ่ม 2 ใบ" },
  { id: "dispel",       type: "magic", name: "ล้างคำสาป",        ico: "🧼", rarity: "folk",      cost: 2, target: "ally", cleanse: true, desc: "ลบสถานะลบของพันธมิตร 1 ตัว" },
  // — ควบคุม/ดีบัฟ —
  { id: "dark_curse",   type: "magic", name: "คำสาปเงามืด",      ico: "🌑", rarity: "folk",      cost: 2, range: 4, target: "enemy", effect: "atk_down", dur: 2, val: 2, desc: "ลด ATK ศัตรู -2 (2 เทิร์น)" },
  { id: "vines",        type: "magic", name: "เวทย์เถาวัลย์",    ico: "🌱", rarity: "folk",      cost: 2, range: 4, target: "enemy", effect: "lock", dur: 2, desc: "ล็อกการเดินศัตรู 2 เทิร์น" },
  { id: "frost_bind",   type: "magic", name: "น้ำแข็งพันธนาการ", ico: "🧊", rarity: "forbidden", cost: 3, range: 4, target: "enemy", effect: "lock", dur: 2, desc: "ตรึงศัตรูไว้กับที่ 2 เทิร์น" },
  { id: "silence",      type: "magic", name: "คำสาปความเงียบ",   ico: "🤫", rarity: "forbidden", cost: 3, range: 4, target: "enemy", effect: "silence", dur: 2, desc: "ห้ามศัตรูใช้เวทย์ 2 เทิร์น" },
  { id: "time_stop",    type: "magic", name: "หยุดเวลา",         ico: "⏳", rarity: "mythic",    cost: 4, range: 4, target: "enemy", effect: "freeze", dur: 1, once: true, desc: "ศัตรูข้ามเทิร์นถัดไป" },
  { id: "armor_curse",  type: "magic", name: "คำสาปสลายเกราะ",   ico: "🪬", rarity: "mythic",    cost: 2, range: 4, target: "enemy", effect: "armor_break", dur: 3, val: 2, desc: "ทำลายเกราะศัตรู DEF-2 (3 เทิร์น)" },
  // — เคลื่อนที่ —
  { id: "warp",         type: "magic", name: "วาร์ปหลบ",         ico: "🌀", rarity: "forbidden", cost: 2, target: "tile", teleport: true, desc: "เทเลพอร์ตตัวเองไปช่องที่เลือก" },
];

// ─── กับดัก ───────────────────────────────────────────────────────────────────
export const TRAP_CARDS = [
  // — พื้นบ้าน —
  { id: "iron_pit",    type: "trap", name: "หลุมหนามเหล็ก",  ico: "🕳️", rarity: "folk",      dmg: 3, desc: "วาง: DMG 3 ทันทีเมื่อเหยียบ" },
  { id: "spikes",      type: "trap", name: "หนามเหล็กพุ่ง",   ico: "⚙️", rarity: "folk",      dmg: 2, armor_break: 2, desc: "วาง: DMG 2 + ทำลายเกราะ" },
  { id: "poison_pin",  type: "trap", name: "เข็มพิษซ่อนเร้น", ico: "☠️", rarity: "folk",      poison: 3, desc: "วาง: ติดพิษ -1HP/เทิร์น 3 เทิร์น" },
  { id: "net",         type: "trap", name: "ตาข่ายดักจับ",   ico: "🕸️", rarity: "folk",      lock: 1, desc: "วาง: ล็อกการเดิน 1 เทิร์น" },
  { id: "smoke_bomb",  type: "trap", name: "ระเบิดควัน",     ico: "💨", rarity: "folk",      blind: 2, desc: "วาง: ตาบอด (ATK ลด) 2 เทิร์น" },
  { id: "flash",       type: "trap", name: "ระเบิดแฟลช",     ico: "✨", rarity: "folk",      blind: 1, desc: "วาง: ตาบอด 1 เทิร์น" },
  { id: "tripwire",    type: "trap", name: "เส้นลวดสะดุด",   ico: "➰", rarity: "folk",      lock: 1, dmg: 1, desc: "วาง: DMG1 + ล้มล็อก 1 เทิร์น" },
  // — หวงห้าม —
  { id: "chains",      type: "trap", name: "กับดักโซ่ตรวน",  ico: "⛓️", rarity: "forbidden", lock: 2, desc: "วาง: ล็อกการเดิน 2 เทิร์น" },
  { id: "sleep_dust",  type: "trap", name: "ผงสะกดหลับ",     ico: "😴", rarity: "forbidden", freeze: 1, desc: "วาง: ศัตรูหลับข้ามเทิร์น" },
  { id: "frost_floor", type: "trap", name: "น้ำเยือกแข็ง",   ico: "🧊", rarity: "forbidden", lock: 1, dmg: 1, desc: "วาง: DMG1 + ล็อก 1 เทิร์น" },
  { id: "fire_floor",  type: "trap", name: "พื้นไฟลุก",      ico: "🔥", rarity: "forbidden", dmg: 3, burn: 2, desc: "วาง: DMG 3 + ติดไฟ 2 เทิร์น" },
  { id: "bear_trap",   type: "trap", name: "หลุมหนามแฝง",    ico: "🪤", rarity: "forbidden", dmg: 4, desc: "วาง: DMG 4 ทันที" },
  { id: "acid",        type: "trap", name: "น้ำกรดสาด",      ico: "🧪", rarity: "forbidden", armor_break: 3, desc: "วาง: ทำลายเกราะ DEF-3 (3 เทิร์น)" },
  { id: "poison_arrow",type: "trap", name: "ลูกศรพิษ",       ico: "🏹", rarity: "forbidden", dmg: 2, poison: 2, desc: "วาง: DMG 2 + พิษ 2 เทิร์น" },
  // — ลี้ลับ —
  { id: "bomb_box",    type: "trap", name: "กล่องระเบิด",    ico: "🧨", rarity: "mythic",    dmg: 6, desc: "วาง: DMG 6 (รุนแรง)" },
  { id: "rockslide",   type: "trap", name: "แผ่นหินถล่ม",    ico: "🪨", rarity: "mythic",    dmg: 5, lock: 1, desc: "วาง: DMG 5 + ปิดเส้นทาง 1 เทิร์น" },
];

// pool รวม (ใช้ทั้ง client/server)
export const ALL_CARDS = [...WEAPON_CARDS, ...MAGIC_CARDS, ...TRAP_CARDS];
export const CARD_BY_ID = Object.fromEntries(ALL_CARDS.map(c => [c.id, c]));

// ─── การจั่วแบบถ่วงน้ำหนักตามความหายาก ───────────────────────────────────────
//   1) สุ่มเลือก "ระดับความหายาก" ตามน้ำหนัก (เฉพาะระดับที่มีการ์ดอยู่ใน pool)
//   2) สุ่มการ์ด 1 ใบจากระดับนั้น → ทำให้ % การจั่วตรงตามที่กำหนดไว้
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
