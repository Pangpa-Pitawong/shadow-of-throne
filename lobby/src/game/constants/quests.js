// src/game/constants/quests.js
// ─────────────────────────────────────────────────────────────────────────────
// เควสรอง (Side Quests) — ภารกิจลับเฉพาะบุคคล
//   • ผู้เล่นแต่ละคนจะได้รับ "3 ตัวเลือกสุ่ม" ตอนเริ่มเกม แล้วเลือก 1
//   • เควสจะเห็นได้เฉพาะเจ้าของเท่านั้น (คนอื่นมองไม่เห็น)
//   • ทำสำเร็จเมื่อ "เดินไปถึงสถานที่เป้าหมาย" (targetZone) ครบตามจำนวน visitCount
//   • ได้รางวัลทันทีที่สำเร็จ (reward)
//
// โครงสร้างเควส:
//   id         : รหัสเฉพาะ
//   name       : ชื่อเควส
//   ico        : ไอคอน
//   desc       : คำอธิบาย "เดินไปที่ไหน ทำอะไร"
//   targetZone : zone ที่ต้องไปให้ถึง (key ตรงกับ FIXED_ZONES)
//   visitCount : จำนวนครั้งที่ต้องไปถึง (ค่าเริ่ม 1)
//   reward     : เพิ่ม "เพดานสถานะ" (ถาวร) + เงิน — { gold, maxHp, maxMana, atk, def, spd }
//                • maxHp/maxMana = เพิ่มค่าสูงสุด (และเติมให้ทันที)
//                • atk/def/spd   = เพิ่มค่าฐานถาวร · gold = เงิน
//   hint       : คำใบ้สั้นๆ (โทนปริศนา)
// ─────────────────────────────────────────────────────────────────────────────

export const SIDE_QUESTS = [
  {
    id: "q_pilgrimage", name: "จาริกแสวงบุญ", ico: "⛩️",
    desc: "เดินทางไปยังศาลเจ้าศักดิ์สิทธิ์ เพื่อขอพรจากเทพเจ้า",
    targetZone: "shrine", visitCount: 1,
    reward: { maxHp: 3, gold: 3 }, hint: "แสงสว่างรออยู่ทางทิศใต้",
  },
  {
    id: "q_dragon_hunt", name: "ล่ามังกร", ico: "🐉",
    desc: "บุกเข้าถ้ำมังกรและรอดชีวิตกลับมา พิสูจน์ความกล้าหาญ",
    targetZone: "cave", visitCount: 1,
    reward: { atk: 1, gold: 5 }, hint: "ความกล้ามีราคาของมัน",
  },
  {
    id: "q_market_run", name: "พ่อค้าเร่ร่อน", ico: "🏪",
    desc: "ไปยังตลาดกลางเพื่อปิดดีลการค้าครั้งใหญ่",
    targetZone: "market", visitCount: 2,
    reward: { maxHp: 2, gold: 6 }, hint: "เงินทองหมุนเวียนใจกลางเมือง",
  },
  {
    id: "q_forge_master", name: "ศิษย์ช่างตีเหล็ก", ico: "⚒️",
    desc: "ฝึกวิชากับช่างตีเหล็ก เรียนรู้การหลอมอาวุธ",
    targetZone: "blacksmith", visitCount: 1,
    reward: { atk: 2, gold: 3 }, hint: "เปลวไฟหลอมเหล็กกล้า",
  },
  {
    id: "q_alchemy", name: "ตำราเล่นแร่", ico: "🧪",
    desc: "เยี่ยมร้านแม่มดเพื่อเรียนสูตรเวทย์ลับ",
    targetZone: "alchemist", visitCount: 1,
    reward: { maxMana: 3, gold: 3 }, hint: "กลิ่นยาพิษและเวทมนตร์",
  },
  {
    id: "q_tavern_tales", name: "ราตรีในโรงเตี๊ยม", ico: "🍺",
    desc: "ดื่มฉลองที่โรงเตี๊ยมและฟังข่าวลือจากนักเดินทาง",
    targetZone: "tavern", visitCount: 1,
    reward: { maxHp: 2, gold: 4 }, hint: "ความลับซ่อนในแก้วเหล้า",
  },
  {
    id: "q_arsenal", name: "เบิกคลังอาวุธ", ico: "🏯",
    desc: "เข้าถึงคลังอาวุธหลวงเพื่อจัดหายุทโธปกรณ์",
    targetZone: "armory", visitCount: 1,
    reward: { def: 2, gold: 3 }, hint: "เหล็กกล้าเรียงรายรอผู้กล้า",
  },
  {
    id: "q_dungeon_delve", name: "ผจญคุกใต้ดิน", ico: "🗝️",
    desc: "สำรวจคุกใต้ดินอันมืดมิดเพื่อค้นหาสมบัติต้องห้าม",
    targetZone: "dungeon", visitCount: 1,
    reward: { maxHp: 2, atk: 1, gold: 5 }, hint: "ยิ่งลึก ยิ่งเสี่ยง ยิ่งคุ้ม",
  },
  {
    id: "q_treasure_seeker", name: "นักล่าสมบัติ", ico: "💰",
    desc: "ไปถึงคลังสมบัติโบราณก่อนใคร",
    targetZone: "treasure", visitCount: 1,
    reward: { maxHp: 1, gold: 10 }, hint: "ทองคำส่องประกายในความมืด",
  },
  {
    id: "q_farmer", name: "ชาวไร่ขยัน", ico: "🌾",
    desc: "ดูแลไร่นาให้ออกผล เก็บเกี่ยวความมั่งคั่ง",
    targetZone: "farm", visitCount: 2,
    reward: { maxHp: 2, gold: 5 }, hint: "หว่านวันนี้ เก็บเกี่ยววันหน้า",
  },
  {
    id: "q_river_blessing", name: "พรแม่น้ำ", ico: "🌊",
    desc: "ทำพิธีชำระล้างที่แม่น้ำศักดิ์สิทธิ์",
    targetZone: "river", visitCount: 1,
    reward: { maxMana: 4, gold: 2 }, hint: "สายน้ำพัดพาพลังเวทย์",
  },
  {
    id: "q_ruins_scholar", name: "นักโบราณคดี", ico: "🏚️",
    desc: "ค้นหาความรู้ที่สาบสูญในซากปรักหักพัง",
    targetZone: "ruins", visitCount: 1,
    reward: { def: 1, gold: 5 }, hint: "อดีตซ่อนคำตอบของอนาคต",
  },
  {
    id: "q_spy_master", name: "สายลับเงา", ico: "🔭",
    desc: "ขึ้นหอสังเกตการณ์เพื่อล้วงความลับของศัตรู",
    targetZone: "watchtower", visitCount: 1,
    reward: { spd: 1, gold: 4 }, hint: "ผู้ที่มองเห็น คือผู้ที่ได้เปรียบ",
  },
  {
    id: "q_grave_keeper", name: "ผู้เฝ้าสุสาน", ico: "🪦",
    desc: "ทำพิธีให้กับวิญญาณในสุสานเก่า",
    targetZone: "graveyard", visitCount: 1,
    reward: { maxMana: 2, gold: 4 }, hint: "ความตายไม่ใช่จุดจบเสมอไป",
  },
  {
    id: "q_volcano_trial", name: "บททดสอบภูเขาไฟ", ico: "🌋",
    desc: "เผชิญหน้ากับเปลวเพลิงแห่งภูเขาไฟและรอดชีวิต",
    targetZone: "volcano", visitCount: 1,
    reward: { atk: 2, gold: 4 }, hint: "ผู้ที่ผ่านไฟ จะแกร่งดั่งเหล็กกล้า",
  },
  {
    id: "q_oasis_rest", name: "พักพิงโอเอซิส", ico: "🌴",
    desc: "เดินทางข้ามทะเลทรายไปถึงโอเอซิสที่ซ่อนเร้น",
    targetZone: "oasis", visitCount: 1,
    reward: { maxHp: 4, gold: 3 }, hint: "ความสงบกลางทะเลทราย",
  },
  {
    id: "q_tower_wizard", name: "ผู้สืบทอดหอเวทย์", ico: "🗼",
    desc: "ไต่ขึ้นหอเวทย์เพื่อรับมรดกของจอมเวท",
    targetZone: "tower", visitCount: 1,
    reward: { maxMana: 3, gold: 4 }, hint: "ยอดหอคอยใกล้ดวงดาว",
  },
  {
    id: "q_village_hero", name: "วีรบุรุษหมู่บ้าน", ico: "🏘️",
    desc: "ปกป้องหมู่บ้านจากภัยและกลายเป็นที่รัก",
    targetZone: "village", visitCount: 2,
    reward: { maxHp: 3, gold: 5 }, hint: "ชาวบ้านจดจำผู้กล้า",
  },
  {
    id: "q_portal_walker", name: "นักเดินมิติ", ico: "🌀",
    desc: "ก้าวผ่านประตูมิติเพื่อสัมผัสพลังลึกลับ",
    targetZone: "portal", visitCount: 1,
    reward: { maxMana: 2, spd: 1, gold: 3 }, hint: "อีกฟากของความจริง",
  },
  {
    id: "q_shadow_pact", name: "พันธสัญญาเงา", ico: "🌑",
    desc: "เข้าไปในป่าดำเพื่อทำสัญญาลับกับเงามืด",
    targetZone: "dark_forest", visitCount: 1,
    reward: { atk: 2, gold: 4 }, hint: "เงามืดให้พลัง แต่ขอราคา",
  },
];

// helper — สุ่ม 3 เควสไม่ซ้ำกัน สำหรับให้ผู้เล่นเลือก
//   allowedZones (optional): Set ของ zone ที่มีอยู่จริงบนแมพ — กรองเควสที่ไปไม่ถึง
export function pickQuestChoices(count = 3, allowedZones = null) {
  let pool = [...SIDE_QUESTS];
  if (allowedZones && allowedZones.size) {
    const filtered = pool.filter(q => allowedZones.has(q.targetZone));
    if (filtered.length >= count) pool = filtered; // ใช้เฉพาะที่ไปถึงได้ (ถ้ามีพอ)
  }
  const chosen = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen.map(q => JSON.parse(JSON.stringify(q)));
}

export function getQuestById(id) {
  return SIDE_QUESTS.find(q => q.id === id) || null;
}
