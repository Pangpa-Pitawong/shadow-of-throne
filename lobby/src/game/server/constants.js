// ─── Server-side game constants (tuning + derived pools + character data) ─────
import { ALL_CARDS } from "../constants/cards.js";
import { CHARACTERS } from "../constants/characters.js";

// กติกา: ใช้การ์ดได้ไม่เกิน N ใบต่อเทิร์น
export const MAX_CARDS_PER_TURN = 4;

// กติกา: ค่าการเดินต่อเทิร์น (งบเดิน) — หักด้วยต้นทุนภูมิประเทศของเส้นทาง
export const BASE_MOVE_BUDGET = 5;

// ─── CARDS POOL (จาก constants ที่แชร์กับ client) ───────────────────────────
export const ALL_CARDS_POOL = ALL_CARDS;
export const WEAPON_POOL = ALL_CARDS.filter(c => c.type === "weapon");
export const MAGIC_POOL = ALL_CARDS.filter(c => c.type === "magic");

export const NEG_STATUS = new Set([
  "poison", "burn", "freeze", "lock", "blind", "atk_down", "armor_break", "silence",
  "stun", "trip", "slow", "curse",
]);

// ─── CHARACTER DATA — derive จาก shared CHARACTERS (แหล่งความจริงเดียว) ────
export const CHARACTERS_DATA = Object.fromEntries(
  Object.entries(CHARACTERS).map(([id, c]) => [id, {
    hp: c.hp, maxHp: c.hp,
    mana: c.mana, maxMana: c.mana,
    baseAtk: c.atk, baseDef: c.def, move: c.move,
  }])
);
// fallback ถ้าไม่เลือกตัวละคร
CHARACTERS_DATA["_default"] = { hp: 12, maxHp: 12, mana: 6, maxMana: 6, baseAtk: 3, baseDef: 2, move: 3 };

// ─── STARTING GEAR — อุปกรณ์เริ่มต้นตามตัวละคร ─────────────────────────────
export const STARTING_GEAR = {
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

// ─── BOSS TYPES (โผล่หลังครบเฟส) ────────────────────────────────────────────
export const BOSS_TYPES = [
  { name: "มังกรเงา", ico: "🐲" },
  { name: "อัศวินมรณะ", ico: "☠️" },
  { name: "ปีศาจไฟ", ico: "👹" },
  { name: "ราชันอสูร", ico: "😈" },
  { name: "ภูตพายุ", ico: "🌪️" },
];
