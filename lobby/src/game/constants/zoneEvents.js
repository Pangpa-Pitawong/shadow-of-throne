// ─── เหตุการณ์สุ่มเมื่อเดินเข้า specialZone ────────────────────────────────────
// ถูก trigger โดย applyRandomZoneEvent() ใน server.js หลัง applyZoneEffectServer()
// โอกาสเกิด: 40% ต่อการเดินเข้า zone (ถ้าสุ่มโดน จะสุ่มเหตุการณ์จาก pool นี้)
export const ZONE_EVENT_POOL = [
  {
    id: "gold_stash",
    name: "พบกองทอง",
    ico: "💰",
    desc: "ค้นพบกองทองซ่อนอยู่",
    fx: "gold",
    value: 0, // random 2–4 in server
  },
  {
    id: "card_draw",
    name: "พบข้อความลับ",
    ico: "📜",
    desc: "ได้รับการ์ดความรู้",
    fx: "draw_card",
    value: 1,
  },
  {
    id: "double_card",
    name: "คลังการ์ดเก่า",
    ico: "🃏",
    desc: "ค้นพบการ์ดเก่า 2 ใบ",
    fx: "draw_card",
    value: 2,
  },
  {
    id: "herb_heal",
    name: "สมุนไพรรักษา",
    ico: "🌿",
    desc: "สมุนไพรฟื้น HP+2",
    fx: "heal",
    value: 2,
  },
  {
    id: "herb_regen",
    name: "สมุนไพรฟื้นฟู",
    ico: "🍃",
    desc: "สมุนไพรชั้นดีให้ regen 2 HP/เทิร์น เป็นเวลา 2 เทิร์น",
    fx: "regen",
    value: 2,
    duration: 2,
  },
  {
    id: "hidden_trap",
    name: "กับดักซ่อนเร้น",
    ico: "🪤",
    desc: "กับดักเก่าในดิน HP-2",
    fx: "trap_dmg",
    value: 2,
  },
  {
    id: "old_curse",
    name: "คำสาปโบราณ",
    ico: "💀",
    desc: "สัมผัสคำสาป ถูกล็อค 1 เทิร์น",
    fx: "lock",
    duration: 1,
  },
  {
    id: "ghost_encounter",
    name: "เจอผีสิง",
    ico: "👻",
    desc: "ผีสิง HP-1 แต่มอบความรู้ให้การ์ด 1 ใบ",
    fx: "ghost",
    value: 1,
  },
  {
    id: "ancient_map",
    name: "แผนที่โบราณ",
    ico: "🗺️",
    desc: "แผนที่เปิดเผยตำแหน่งผู้เล่นทุกคน 1 เทิร์น",
    fx: "reveal_all",
    value: 0,
  },
  {
    id: "mystery_potion_good",
    name: "ยาลึกลับ (ดี)",
    ico: "🧪",
    desc: "ยาลึกลับ! ฟื้น HP+3",
    fx: "heal",
    value: 3,
  },
  {
    id: "mystery_potion_bad",
    name: "ยาลึกลับ (เสีย)",
    ico: "☠️",
    desc: "ยาลึกลับ! ติดพิษ 1 ดาเมจ/เทิร์น 2 เทิร์น",
    fx: "poison",
    value: 1,
    duration: 2,
  },
  {
    id: "mana_spring",
    name: "พบน้ำพุมนา",
    ico: "💧",
    desc: "น้ำพุมนา ฟื้นมานา +2",
    fx: "mana",
    value: 2,
  },
];

// กลุ่ม zone ที่ไม่ควรมีเหตุการณ์สุ่ม (zone เหล่านี้มีผลพิเศษแรงอยู่แล้ว)
export const ZONE_EVENT_EXCLUDED = new Set([
  "portal", "volcano", "dungeon", "shrine",
]);
