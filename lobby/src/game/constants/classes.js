// src/game/constants/classes.js
// ─────────────────────────────────────────────────────────────────────────────
// CLASSES — แหล่งความจริงเดียว (single source of truth) สำหรับข้อมูลอาชีพ
// ใช้ร่วมกันทั้ง: หน้า lobby (เลือกอาชีพ), GameBoard (แสดงผล) และ server (createInitialGameState)
//
//   ค่าพลังจริงที่เกมใช้คำนวณ: hp, mana, move, atk, def  (server ดึงไปสร้าง CLASSES_DATA)
//     • move = 3 ทุกอาชีพ (กติกาใหม่)
//     • ระยะโจมตีพื้นฐาน = 0 (ตีได้แค่ช่องเดียวกัน) ระยะไกลมาจาก "อุปกรณ์สวมใส่"
//   ฟิลด์เชิงนำเสนอ (lobby เท่านั้น): s{STR,DEX,VIT,INT}, evo, ability, passive, startGear
// ─────────────────────────────────────────────────────────────────────────────
export const CLASSES = {
  warrior: {
    id: "warrior", ico: "⚔️", name: "นักรบ", color: "#e05050",
    hp: 12, mana: 4, move: 3, atk: 3, def: 1,
    s: { STR: 5, DEX: 2, VIT: 4, INT: 1 },
    evo: "→ คนเถื่อน → เบอร์เซิกเกอร์",
    ability: "โจมตีกว้าง 3 เป้าหมาย", passive: "ทนดาเมจสุดท้าย 1 ครั้ง",
    startGear: "ดาบเหล็ก (ระยะ0)",
  },
  knight: {
    id: "knight", ico: "🛡️", name: "อัศวิน", color: "#5080e0",
    hp: 14, mana: 5, move: 3, atk: 2, def: 3,
    s: { STR: 4, DEX: 2, VIT: 5, INT: 2 },
    evo: "→ พาราดิน → โรยัลไนท์",
    ability: "พระบัญชา: สั่งย้ายผู้เล่น", passive: "ลดดาเมจรับ 1 ตลอดเวลา",
    startGear: "โล่อัศวิน (ระยะ0)",
  },
  mage: {
    id: "mage", ico: "🔮", name: "นักเวทย์", color: "#9050e0",
    hp: 8, mana: 14, move: 3, atk: 4, def: 0,
    s: { STR: 1, DEX: 3, VIT: 2, INT: 7 },
    evo: "→ จอมเวทย์ → นักปราญ์",
    ability: "เวทย์พื้นที่ 3 ช่อง", passive: "จั่วเวทย์เพิ่ม 1 ใบ/เฟส",
    startGear: "ไม้เท้า (ระยะ2)",
  },
  archer: {
    id: "archer", ico: "🏹", name: "นักธนู", color: "#50c050",
    hp: 10, mana: 6, move: 3, atk: 3, def: 1,
    s: { STR: 2, DEX: 6, VIT: 3, INT: 2 },
    evo: "→ พลซุ่มยิง → นักล่า",
    ability: "ยิงข้ามกำแพง ระยะ 4", passive: "ตีคริต 15% เสมอ",
    startGear: "ธนูสั้น (ระยะ3)",
  },
  rogue: {
    id: "rogue", ico: "🗡️", name: "โจร", color: "#c0a030",
    hp: 9, mana: 7, move: 3, atk: 3, def: 1,
    s: { STR: 3, DEX: 6, VIT: 3, INT: 2 },
    evo: "→ นักฆ่า → จอมอุบาย",
    ability: "โจมตีด้านหลัง ATK×2", passive: "หลบ 20% เสมอ",
    startGear: "กริชคู่ (ระยะ0)",
  },
  cleric: {
    id: "cleric", ico: "✨", name: "นักบวช", color: "#e0c040",
    hp: 11, mana: 10, move: 3, atk: 1, def: 2,
    s: { STR: 1, DEX: 2, VIT: 4, INT: 6 },
    evo: "→ บาทหลวง → บิชอป",
    ability: "ฟื้น HP +4 ให้พันธมิตร", passive: "ฟื้น HP +1 ทุกต้นเทิร์น",
    startGear: "ไม้เท้าศักดิ์สิทธิ์ (ระยะ1)",
  },
  // ใช้แสดงผลเมื่อถูกปกปิดด้วยม่านหมอก
  hidden: { id: "hidden", ico: "❓", name: "ปริศนา", color: "#666", hp: 0, mana: 0, move: 0, atk: 0, def: 0 },
};
