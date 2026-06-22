// src/game/constants/cards.js
// ─────────────────────────────────────────────────────────────────────────────
// ชุดการ์ด "WTK: War of the Three Kingdoms / บัลลังก์เงา" — แหล่งความจริงเดียว
// (client แสดงผล / server ตรรกะจริง) ทุกใบใน pool นี้ "ทำงานได้จริง" ในเอนจิน
// (ดู utils/cardEngine.js + server/engine.js). ธีม: สามก๊ก — อาวุธ/กลศึก/อุบาย
//
//   type   : weapon | magic | trap            (event อยู่ใน constants/events.js แยกต่างหาก)
//   rarity : folk | forbidden | mythic | divine   (พื้นบ้าน/หวงห้าม/ลี้ลับ/สมบัติสวรรค์)
//
// ── ยุทธภัณฑ์ WEAPON/ARMOR (สวมใส่ → ค่าพลังถาวร + เอฟเฟกต์) ──────────────────
//   slot     : weapon | armor | shield | helm | boots | gloves | accessory
//   atk/def/range/magicAtk : ค่าพลังถาวรเมื่อสวม
//   atkElement : ธาตุของการโจมตีปกติเมื่อถืออาวุธนี้ (physical default)
//   resist   : { <element>: flatReduce }   ลดดาเมจธาตุนั้น N หน่วย
//   immune   : [<element>...]              ภูมิคุ้มกันดาเมจธาตุนั้น 100%
//   immuneStatus : [<status>...]           ภูมิคุ้มกันสถานะนั้น
//   effect   : คีย์เอฟเฟกต์พิเศษ (เอนจินประมวลผล — ดูตารางใน cardEngine/server)
//   val      : ค่าประกอบ effect
//   cooldown : ใช้แล้วพักกี่เทิร์น
//   twin     : true → ต้องสวม 2 ใบจึงทำงานเต็ม
//   tag      : ["set:dead_king"] ฯลฯ — ใช้กับเงื่อนไข/เซ็ต
//   cond     : { time:"day"|"night", near:"water", terrain:["forest"], requireArmor:true, hpBelowPct:50 }
//
// ── กลศึก MAGIC (ใช้มานา) — target: enemy | self | ally | team | aoe | tile | none ──
//   dmg/heal/effect/dur/val/range/cost/element เหมือนเดิม + โหมด AOE:
//   aoeMode : all | randomN | line | pointRadius   (ดู cardEngine)
//   kind    : "attack" → ถูก dodge/block ได้  |  "dodge" → การ์ดตอบโต้ (reactive)
//   blockable / dodgeable : ระบุว่าถูกตอบโต้ด้วยอะไรได้
//
// ── STATUS ที่เอนจินรองรับ ────────────────────────────────────────────────
//   ลบ : poison · burn · freeze · lock · blind · atk_down · armor_break · silence
//        · stun(มึน) · trip(สะดุด) · slow(ช้า) · curse(สาป)
//   บวก: regen · shield · def_up · atk_up · dodge_charge(บัฟหลบ 1 ครั้ง)
//
// ── อุบาย TRAP (วางบนช่อง → ทำงานเมื่อทริกเกอร์) ───────────────────────────
//   trigger : step(เหยียบ) | cardspam(เล่นการ์ด≥N) | draw(จั่ว) | equipswap | gold | always
//   fx แบบใหม่: discard · cardlock · gold_steal · gold_loss · gold_tax · mana_drain
//             · spell_lock · spell_reflect · move_lock · move_scramble · move_slow ฯลฯ
// ─────────────────────────────────────────────────────────────────────────────

// ─── ความหายาก + น้ำหนักการจั่ว (รวม = 100 → อ่านเป็น %) ─────────────────────
export const RARITY = {
  folk:      { key: "folk",      label: "พื้นบ้าน",     glyph: "·", color: "#9aa7b0", weight: 52, price: 2 },
  forbidden: { key: "forbidden", label: "หวงห้าม",      glyph: "◆", color: "#7fa6ff", weight: 30, price: 4 },
  mythic:    { key: "mythic",    label: "ลี้ลับ",       glyph: "★", color: "#c489ff", weight: 13, price: 6 },
  divine:    { key: "divine",    label: "สมบัติสวรรค์", glyph: "✦", color: "#ffd54a", weight: 5,  price: 9 },
};
export const RARITY_ORDER = ["folk", "forbidden", "mythic", "divine"];

// เผื่อ map ค่าเก่า / ชื่อไทย ให้เข้ากับระบบ
const RARITY_ALIAS = {
  common: "folk", rare: "forbidden", secret: "mythic", uncommon: "forbidden", legendary: "divine",
  "พื้นบ้าน": "folk", "หวงห้าม": "forbidden", "ลี้ลับ": "mythic", "สมบัติสวรรค์": "divine",
};
export function normRarity(r) { return RARITY[r] ? r : (RARITY_ALIAS[r] || "folk"); }
export function rarityMeta(r) { return RARITY[normRarity(r)]; }

// สถานะ "เชิงลบ" — ใช้โดย cleanse/dispel/วันอภัยโทษ เพื่อรู้ว่าอะไรล้างได้
export const NEGATIVE_STATUS = new Set([
  "poison", "burn", "freeze", "lock", "blind", "atk_down", "armor_break", "silence",
  "stun", "trip", "slow", "curse",
]);

// ธาตุที่เอนจินรองรับ (ใช้กับ resist/immune/atkElement/element)
export const ELEMENTS = ["physical", "fire", "ice", "lightning", "water", "magic", "dark"];

// ─── ยุทธภัณฑ์สามก๊ก — อาวุธ / เกราะ / ของวิเศษ (30 ใบ) ───────────────────────
export const WEAPON_CARDS = [
  // 1 — กวนอู: ง้าวมังกรเขียว (ทะลุเกราะ)
  { id: "storm_blade", type: "weapon", slot: "weapon", name: "ทวนเหล็กสะท้านฟ้า", ico: "⚡", rarity: "forbidden",
    atk: 3, atkElement: "lightning", effect: "vs_metal", val: 2,
    desc: "ATK+3 (สายฟ้า) · ศัตรูใส่เกราะโลหะ ดาเมจ +2" },
  // 2
  { id: "black_dragon_spear", type: "weapon", slot: "weapon", name: "ง้าวมังกรเขียว", ico: "🐲", rarity: "mythic",
    atk: 4, effect: "pierce_all", cooldown: 1,
    desc: "ATK+4 · ทะลุเกราะทั้งหมด · ใช้แล้วพัก 1 เทิร์น" },
  // 3
  { id: "king_blood_axe", type: "weapon", slot: "weapon", name: "ขวานพิโรธราชันย์", ico: "🪓", rarity: "folk",
    atk: 4, effect: "rage", val: 3,
    desc: "ATK+4 · +1 ดาเมจต่อ HP ที่เสียในรอบนี้ (สูงสุด +3)" },
  // 4 — ฮองตง: ธนูเพลิงสุริยัน
  { id: "sun_god_bow", type: "weapon", slot: "weapon", name: "ธนูเพลิงสุริยัน", ico: "🌞", rarity: "forbidden",
    atk: 3, range: 3, atkElement: "fire", effect: "burn", cond: { time: "day" },
    desc: "ATK+3 ระยะไกล (ไฟ) · ติดลุกไหม้ 2 เทิร์น · เฉพาะกลางวัน" },
  // 5
  { id: "wildcat_claw", type: "weapon", slot: "weapon", name: "มีดคู่พยัคฆ์ซ่อนเล็บ", ico: "🐾", rarity: "folk",
    atk: 2, effect: "double_hit",
    desc: "ATK+2 · โจมตีสองครั้งติด (ครั้งที่สอง -1)" },
  // 6 — ขงเบ้ง: คทากลศึก
  { id: "demon_staff", type: "weapon", slot: "weapon", name: "คทาเรียกลมไฟ", ico: "🔮", rarity: "mythic",
    magicAtk: 3, effect: "magic_lifesteal", val: 1,
    desc: "พลังเวทย์ +3 · ใช้เวทย์โจมตี ดูด HP +1" },
  // 7 — เกียงอุย: ดาบคู่ลมทราย
  { id: "twin_sandstorm", type: "weapon", slot: "weapon", name: "ดาบคู่ลมทราย", ico: "⚔️", rarity: "forbidden",
    atk: 2, twin: true, effect: "twin_blade",
    desc: "ATK+2 ต่อใบ · ต้องสวมทั้งสองใบจึงโจมตีพร้อมกัน" },
  // 8
  { id: "bat_boomerang", type: "weapon", slot: "weapon", name: "จักรพญาค้างคาวราตรี", ico: "🦇", rarity: "mythic",
    atk: 2, range: 3, effect: "night_uncapped", cond: { time: "night" },
    desc: "ATK+2 ระยะไกล · เฉพาะกลางคืน · ไม่มีเพดานการโจมตี" },
  // 9 — กำเหลง: ทวนสามง่ามชลธี
  { id: "sea_trident", type: "weapon", slot: "weapon", name: "ทวนสามง่ามชลธี", ico: "🔱", rarity: "divine",
    atk: 2, atkElement: "water", effect: "trident", cond: { near: "water" },
    desc: "ATK+2 · ใกล้น้ำ โจมตี 3 เป้าพร้อมกัน (เป้าละ +1)" },
  // 10
  { id: "emerald_shadow_blade", type: "weapon", slot: "weapon", name: "ดาบเงาพรายมรกต", ico: "🗡️", rarity: "mythic",
    atk: 3, effect: "block_down", val: 30,
    desc: "ATK+3 · ลดโอกาสบล็อกของศัตรู -30%" },
  // 11 — เกราะดำราชันย์ราตรี
  { id: "night_iron_armor", type: "weapon", slot: "armor", name: "เกราะดำราชันย์ราตรี", ico: "🛡️", rarity: "forbidden",
    def: 3, resist: { physical: 3 }, immuneStatus: ["stun", "trip"],
    desc: "ลดดาเมจกาย -3 · ภูมิคุ้มกัน 'มึน' และ 'สะดุด'" },
  // 12
  { id: "silver_dragon_hide", type: "weapon", slot: "armor", name: "เกราะเกล็ดมังกรเงิน", ico: "🐉", rarity: "folk",
    def: 2, resist: { physical: 2 }, effect: "swift", tag: ["no_shield"],
    desc: "ลดดาเมจ -2 · เดิน +1 · ใช้ร่วมกับโล่ไม่ได้" },
  // 13
  { id: "shadow_assassin_suit", type: "weapon", slot: "armor", name: "ชุดจู่โจมไร้เงา", ico: "🥷", rarity: "mythic",
    def: 1, resist: { physical: 1 }, effect: "enemy_miss", val: 25, cond: { terrain: ["forest", "dark", "swamp"] },
    desc: "ลดดาเมจ -1 · ศัตรูพลาด +25% · เฉพาะในป่า/ที่มืด" },
  // 14
  { id: "king_heart_shield", type: "weapon", slot: "shield", name: "โล่ใจเหล็กราชันย์", ico: "🛡️", rarity: "forbidden",
    def: 3, effect: "reflect", val: 1,
    desc: "ป้องกัน -3 · สะท้อน +1 ดาเมจให้ผู้โจมตีทุกครั้ง" },
  // 15
  { id: "ancient_rune_helm", type: "weapon", slot: "helm", name: "หมวกเกราะอักขระเทพ", ico: "⛑️", rarity: "folk",
    resist: { magic: 2 }, effect: "magic_resist", val: 2, cond: { requireArmor: true },
    desc: "ต้านเวทย์ +2 · ลดดาเมจเวทย์ -2 · ต้องสวมเกราะตัวอื่นด้วย" },
  // 16
  { id: "thunder_seal_armor", type: "weapon", slot: "armor", name: "เกราะผนึกอสุนีบาต", ico: "⚡", rarity: "divine",
    immune: ["lightning"], effect: "lightning_absorb", val: 3,
    desc: "กันสายฟ้า -100% · ทุก 2 ครั้งที่โดนสายฟ้า ปล่อยคืน +3 สายฟ้า" },
  // 17
  { id: "moon_mirror_shield", type: "weapon", slot: "shield", name: "โล่กระจกจันทรา", ico: "🌙", rarity: "mythic",
    effect: "spell_reflect", val: 50, cond: { time: "night" },
    desc: "สะท้อนเวทย์ 50% กลับผู้ใช้ · เฉพาะกลางคืน" },
  // 18 — เคาทู: หมัดเหล็กพยัคฆ์
  { id: "iron_boxer_gloves", type: "weapon", slot: "gloves", name: "หมัดเหล็กพยัคฆ์", ico: "🥊", rarity: "folk",
    atk: 3, effect: "fist_stun", val: 50, tag: ["no_heavy"],
    desc: "โจมตีมือเปล่า +3 · 50% หยุดศัตรู 1 เทิร์น · ใช้กับอาวุธหนักไม่ได้" },
  // 19
  { id: "golden_lotus_armor", type: "weapon", slot: "armor", name: "เกราะกลีบบัวสุวรรณ", ico: "🪷", rarity: "mythic",
    def: 2, resist: { physical: 2 }, effect: "regen_safe", val: 1,
    desc: "ลดดาเมจ -2 · ฟื้น HP +1 ทุกเทิร์นที่ไม่โดนโจมตี" },
  // 20
  { id: "stone_iron_boots", type: "weapon", slot: "boots", name: "รองเท้าเหล็กบดปฐพี", ico: "🥾", rarity: "folk",
    resist: { fire: 2 }, immuneStatus: ["trip"], atk: 2, effect: "kick",
    desc: "ต้านไฟ -2 · ภูมิคุ้มกัน 'สะดุด' · เพิ่มดาเมจเตะ +2" },
  // 21
  { id: "snow_warrior_suit", type: "weapon", slot: "armor", name: "ชุดศึกเสื้อขาวแดนเหนือ", ico: "❄️", rarity: "forbidden",
    immune: ["ice"], effect: "snow_hide", val: 50, cond: { terrain: ["snow", "plains"] },
    desc: "กันน้ำแข็ง -100% · ซ่อนตัวในพื้นที่หิมะ +50%" },
  // 22
  { id: "merchant_shadow_armor", type: "weapon", slot: "armor", name: "เสื้อคลุมพ่อค้าลับ", ico: "🧥", rarity: "mythic",
    def: 1, resist: { physical: 1 }, effect: "hide_cards", val: 2,
    desc: "ลดดาเมจ -1 · ซ่อนการ์ด 2 ใบจากสายตาผู้อื่น" },
  // 23
  { id: "sacred_tree_shield", type: "weapon", slot: "shield", name: "โล่ไม้เทพรุกขเทวา", ico: "🌳", rarity: "folk",
    def: 2, effect: "regen", val: 1, tag: ["fragile_fire"],
    desc: "ป้องกัน -2 · ฟื้น HP +1 ทุกเทิร์น · แตกเมื่อโดนไฟ" },
  // 24
  { id: "deep_whale_hide", type: "weapon", slot: "armor", name: "เกราะเกล็ดพญาชล", ico: "🐋", rarity: "forbidden",
    immune: ["water"], def: 1, effect: "whale_hide",
    desc: "กันน้ำ -100% · หายใจใต้น้ำ (เดินบนน้ำได้) · บนบกลดดาเมจ -1" },
  // 25
  { id: "dual_magic_gloves", type: "weapon", slot: "gloves", name: "ถุงมือหยินหยาง", ico: "🧤", rarity: "mythic",
    atk: 2, def: 0, effect: "dual_glove",
    desc: "ขวา: +2 โจมตี · ซ้าย: -1 ดาเมจ · ใส่คู่: +2 โจมตี -2 ดาเมจ" },
  // 26
  { id: "golden_lion_shield", type: "weapon", slot: "shield", name: "โล่พักตร์สิงห์สุวรรณ", ico: "🦁", rarity: "forbidden",
    def: 2, effect: "block_stun", val: 30,
    desc: "ป้องกัน -2 · บล็อกแล้วศัตรู 30% เสียเทิร์น (สะดุ้ง)" },
  // 27
  { id: "storm_eagle_helm", type: "weapon", slot: "helm", name: "หมวกขนอินทรีสอดแนม", ico: "🦅", rarity: "folk",
    effect: "vision", val: 2,
    desc: "ระยะมองเห็น +2 ช่อง · ลดโอกาสโดนลอบโจมตี -50%" },
  // 28
  { id: "reverse_spike_armor", type: "weapon", slot: "armor", name: "เกราะขนเม่นสะท้อนหอก", ico: "🦔", rarity: "mythic",
    def: 1, resist: { physical: 1 }, effect: "spike", val: 2,
    desc: "ลดดาเมจ -1 · สะท้อน +2 ต่อผู้โจมตี · พลังลดลงหลังโดนเกิน 3 ครั้ง" },
  // 29
  { id: "tri_dragon_necklace", type: "weapon", slot: "accessory", name: "สร้อยสามมังกรพิทักษ์", ico: "📿", rarity: "folk",
    resist: { fire: 1, ice: 1, lightning: 1 },
    desc: "ต้านไฟ/น้ำแข็ง/สายฟ้า -1 · ใส่ร่วมกับเกราะอื่นได้" },
  // 30 — ตำนาน: ชุดเกราะวิญญาณราชันย์
  { id: "dead_king_set", type: "weapon", slot: "armor", name: "ชุดเกราะวิญญาณราชันย์", ico: "👑", rarity: "divine",
    def: 3, atk: 2, resist: { physical: 3, fire: 3, ice: 3, lightning: 3, magic: 3 },
    effect: "dead_king", cond: { hpBelowPct: 50 },
    desc: "ลดดาเมจทุกชนิด -3 · โจมตี +2 · สวมได้เมื่อ HP < 50%" },
];

// ─── กลศึก MAGIC (สังหาร / หลบหลีก / โจมตีหมู่ 10 ใบ) ─────────────────────────
export const MAGIC_CARDS = [
  // — สังหาร (โจมตีพื้นฐาน พบบ่อย — โควตา "20 ใบเหมือนกัน") —
  { id: "mana_bolt", type: "magic", kind: "attack", name: "สังหาร", ico: "⚔️", rarity: "folk",
    cost: 1, dmg: 3, range: 4, target: "enemy", element: "magic", blockable: true, canBlockAoe: true,
    desc: "โจมตีเป้าเดี่ยว DMG 3 · ใช้บล็อกการโจมตีหมู่ได้" },
  // — หลบหลีก (reactive) —
  { id: "wind_dodge", type: "magic", kind: "dodge", name: "หลบหลีก", ico: "🌀", rarity: "folk",
    cost: 1, target: "self", reactive: true, effect: "dodge_charge", val: 1,
    desc: "หลบการโจมตี 1 ครั้ง + เคลื่อนที่ 1 ช่อง · ใช้ตอบโต้/บล็อกหมู่ได้" },

  // — กลศึกโจมตีหมู่ 10 ใบ (ไม่ซ้ำ) — kind:"attack" ถูกตอบโต้ได้ตามที่ระบุ —
  { id: "field_sweep", type: "magic", kind: "attack", name: "ม้วนธงกวาดสนาม", ico: "🌊", rarity: "forbidden",
    cost: 4, dmg: 4, target: "aoe", aoeMode: "all", element: "magic", dodgeable: true, blockable: true,
    desc: "โจมตีทุกคนในสนาม 4 · หลบ/บล็อกได้" },
  { id: "meteor_shower", type: "magic", kind: "attack", name: "ฝนหินถล่มทัพ", ico: "☄️", rarity: "forbidden",
    cost: 4, dmg: 3, target: "aoe", aoeMode: "randomN", val: 3, element: "magic", dodgeable: true,
    desc: "โจมตีสุ่ม 3 คน คนละ 3 · หลบได้" },
  { id: "thunder_storm_all", type: "magic", kind: "attack", name: "พายุอสุนีสะท้านทัพ", ico: "🌩️", rarity: "mythic",
    cost: 5, dmg: 2, target: "aoe", aoeMode: "all", element: "lightning", effect: "stun", dur: 1, val: 50,
    dodgeable: true, blockable: true,
    desc: "โจมตีทุกคน 2 สายฟ้า + 50% มึน 1 เทิร์น · หลบ/บล็อกได้" },
  { id: "ring_of_fire", type: "magic", kind: "attack", name: "เพลิงเผาผาแดง", ico: "🔥", rarity: "mythic",
    cost: 5, dmg: 5, target: "aoe", aoeMode: "pointRadius", range: 2, element: "fire", dodgeable: true,
    desc: "โจมตีทุกคนในระยะ 2 ช่องรอบผู้ใช้ 5 ไฟ · หลบได้" },
  { id: "ice_spear_trio", type: "magic", kind: "attack", name: "พายุหิมะสามทิศ", ico: "🧊", rarity: "forbidden",
    cost: 4, dmg: 3, target: "aoe", aoeMode: "randomN", val: 3, element: "ice", effect: "slow", dur: 1,
    blockable: true,
    desc: "โจมตีสุ่ม 3 คน คนละ 3 น้ำแข็ง + ช้า 1 เทิร์น · บล็อกได้" },
  { id: "dark_night_wave", type: "magic", kind: "attack", name: "ม่านมืดกลืนทัพ", ico: "🌑", rarity: "mythic",
    cost: 5, dmg: 3, target: "aoe", aoeMode: "all", element: "dark", effect: "mana_drain", val: 1,
    dodgeable: true, blockable: true,
    desc: "โจมตีทุกคน 3 มืด + ดูดมานาทุกคน 1 · หลบ/บล็อกได้" },
  { id: "mana_blast_center", type: "magic", kind: "attack", name: "กลระเบิดดินดำ", ico: "💥", rarity: "forbidden",
    cost: 4, dmg: 4, target: "aoe", aoeMode: "pointRadius", range: 2, byTile: true, element: "magic", dodgeable: true,
    desc: "เลือกจุด โจมตีทุกคนในรัศมี 2 ช่อง 4 · หลบได้" },
  { id: "sand_drain_storm", type: "magic", kind: "attack", name: "วาตะดูดปราณ", ico: "🌪️", rarity: "mythic",
    cost: 5, dmg: 2, target: "aoe", aoeMode: "all", element: "magic", lifedrain: true, dodgeable: true,
    desc: "โจมตีทุกคน 2 + ดูด HP มาฟื้นผู้ใช้ · หลบได้" },
  { id: "cosmos_breaker", type: "magic", kind: "attack", name: "กลฟ้าทลายป้อม", ico: "🌌", rarity: "divine",
    cost: 6, dmg: 3, target: "aoe", aoeMode: "all", element: "magic", pierce: true, dodgeable: true, blockable: true,
    desc: "โจมตีทุกคน 3 ทะลุเกราะทั้งหมด · หลบ/บล็อกได้" },
  { id: "shadow_dragon_line", type: "magic", kind: "attack", name: "มังกรเงาทะลวงทัพ", ico: "🐉", rarity: "divine",
    cost: 6, dmg: 5, target: "aoe", aoeMode: "line", range: 6, element: "dark", effect: "curse", dur: 2,
    dodgeable: true,
    desc: "กำหนดเส้นตรง โจมตีทุกคนในเส้น 5 + สาป 2 เทิร์น · หลบได้" },
];

// ─── อุบาย/กลซุ่ม TRAP (20 ใบ) ──────────────────────────────────────────────
export const TRAP_CARDS = [
  // [ส่งผลต่อการ์ดบนมือ]
  { id: "black_ink_trap", type: "trap", name: "อุบายหมึกดำลวงใจ", ico: "🖤", rarity: "folk",
    trigger: "cardspam", threshold: 3, fx: "discard", val: 2,
    desc: "ทริก: เป้าหมายเล่นการ์ด ≥3 ใบในรอบเดียว → ทิ้งการ์ดสุ่ม 2 ใบ" },
  { id: "cursed_cabinet", type: "trap", name: "อุบายหีบผนึกต้องสาป", ico: "🗄️", rarity: "folk",
    trigger: "step", fx: "cardlock", val: 1, dur: 2,
    desc: "วาง: ล็อคการ์ดสุ่ม 1 ใบในมือ เล่นไม่ได้ 2 เทิร์น" },
  { id: "mind_swap_trap", type: "trap", name: "กลสลับสาส์นลวงจิต", ico: "🔀", rarity: "forbidden",
    trigger: "draw", fx: "card_swap",
    desc: "ทริก: เมื่อศัตรูจั่ว → สลับการ์ด 1 ใบในมือศัตรูกับการ์ดบนสุดสำรับผู้วาง" },
  { id: "ink_poison_trap", type: "trap", name: "กลน้ำหมึกพิษ", ico: "🥃", rarity: "folk",
    trigger: "step", fx: "discard_dot", val: 1, dur: 3,
    desc: "วาง: ทิ้งการ์ด 1 ใบ/เทิร์น เป็นเวลา 3 เทิร์น" },
  { id: "card_burn_trap", type: "trap", name: "กลเพลิงเผาสาส์น", ico: "🔥", rarity: "forbidden",
    trigger: "step", fx: "burn_draw", val: 3,
    desc: "วาง: การ์ด 3 ใบแรกที่จะจั่วเทิร์นถัดไปถูกทำลาย" },

  // [ส่งผลต่ออุปกรณ์]
  { id: "armor_acid", type: "trap", name: "กลกรดกัดเกราะ", ico: "🧪", rarity: "forbidden",
    trigger: "step", fx: "armor_break", val: 2, dur: 3,
    desc: "วาง: ลดเกราะ -2/เทิร์น เป็นเวลา 3 เทิร์น (ถึง 0 เกราะแตก)" },
  { id: "magnet_rope", type: "trap", name: "กลเชือกชิงอาวุธ", ico: "🧲", rarity: "forbidden",
    trigger: "step", fx: "disarm", dur: 1,
    desc: "วาง: ศัตรูใส่อาวุธโลหะต้องทิ้งอาวุธสุ่ม 1 ใบ เก็บไม่ได้ 1 เทิร์น" },
  { id: "fast_rust_trap", type: "trap", name: "กลสนิมกินเหล็ก", ico: "🟫", rarity: "mythic",
    trigger: "step", fx: "gear_silence", dur: 3,
    desc: "วาง: เกราะศัตรูสูญเสียเอฟเฟกต์พิเศษชั่วคราว 3 เทิร์น" },
  { id: "binding_thread", type: "trap", name: "กลบ่วงรัดยุทธภัณฑ์", ico: "🧵", rarity: "mythic",
    trigger: "equipswap", fx: "slot_lock", dur: 2,
    desc: "ทริก: เมื่อศัตรูเปลี่ยนอุปกรณ์ → ล็อคสล็อต 1 ช่อง 2 เทิร์น" },
  { id: "reverse_wield_trap", type: "trap", name: "กลย้อนคมอาวุธ", ico: "↩️", rarity: "mythic",
    trigger: "step", fx: "weapon_backfire", dur: 1,
    desc: "วาง: อาวุธศัตรูทำดาเมจตัวเอง 1 เทิร์น (ครึ่งหนึ่งของดาเมจ)" },

  // [ส่งผลต่อเงิน]
  { id: "holey_purse", type: "trap", name: "กลถุงทองรั่ว", ico: "💸", rarity: "folk",
    trigger: "step", fx: "gold_loss", val: 3,
    desc: "วาง: ศัตรูเสีย 3 เหรียญ" },
  { id: "thief_trap", type: "trap", name: "กลโจรมือไวชิงทรัพย์", ico: "🫳", rarity: "forbidden",
    trigger: "gold", fx: "gold_steal_half",
    desc: "ทริก: เมื่อศัตรูได้เหรียญ/ค้าขาย → ขโมยครึ่งหนึ่งให้ผู้วาง" },
  { id: "shadow_tax", type: "trap", name: "กลด่านเก็บส่วยเงามืด", ico: "🏷️", rarity: "folk",
    trigger: "always", fx: "gold_tax", val: 2, dur: 3,
    desc: "วางประจำพื้นที่: ศัตรูจ่าย 2 เหรียญ/เทิร์นที่อยู่ในพื้นที่ (สูงสุด 3 เทิร์น)" },

  // [ส่งผลต่อพลังเวทย์]
  { id: "mana_cage", type: "trap", name: "อุบายกรงปิดปราณ", ico: "🔒", rarity: "forbidden",
    trigger: "step", fx: "spell_lock", dur: 2,
    desc: "วาง: ศัตรูใช้การ์ดเวทย์ไม่ได้ 2 เทิร์น" },
  { id: "mana_siphon_trap", type: "trap", name: "กลดูดปราณกลางสมร", ico: "🌀", rarity: "mythic",
    trigger: "step", fx: "mana_steal", val: 2,
    desc: "วาง: ขโมยมานา 2 ให้ผู้วาง · ถ้าไม่มีมานา เสีย HP 2" },
  { id: "spell_loop_snare", type: "trap", name: "กลบ่วงย้อนกลศึก", ico: "♻️", rarity: "mythic",
    trigger: "step", fx: "spell_backfire", dur: 1,
    desc: "วาง: เวทย์ถัดไปของศัตรูย้อนโจมตีตัวเอง 50%" },

  // [ส่งผลต่อการเดิน]
  { id: "invisible_chain", type: "trap", name: "กลโซ่ตรึงทัพ", ico: "⛓️", rarity: "forbidden",
    trigger: "step", fx: "move_lock", dur: 2, val: 2,
    desc: "วาง: ล็อคขาศัตรู เดินไม่ได้ 2 เทิร์น · ถ้าหนีเสีย HP 2" },
  { id: "dragon_resin_floor", type: "trap", name: "กลพื้นตมหนึบมังกร", ico: "🟧", rarity: "forbidden",
    trigger: "step", fx: "move_slow", dur: 3, val: 1,
    desc: "วาง: เคลื่อนที่เหลือ 1 ช่อง/เทิร์น เป็นเวลา 3 เทิร์น" },
  { id: "dead_end_trap", type: "trap", name: "ซุ่มปิดทางแคบฮัวหยง", ico: "🚧", rarity: "mythic",
    trigger: "step", fx: "no_escape", dur: 1,
    desc: "วาง: บล็อกเส้นทางหนีของศัตรู 1 เทิร์น" },
  { id: "mirror_maze", type: "trap", name: "ค่ายกลแปดทิศลวงทาง", ico: "🪞", rarity: "mythic",
    trigger: "step", fx: "move_scramble", dur: 2,
    desc: "วาง: ศัตรูเคลื่อนที่แบบสุ่มแทนทิศที่ต้องการ 2 เทิร์น" },
];

// pool รวม (ใช้ทั้ง client/server) — event แยกไป constants/events.js
export const ALL_CARDS = [...WEAPON_CARDS, ...MAGIC_CARDS, ...TRAP_CARDS];
export const CARD_BY_ID = Object.fromEntries(ALL_CARDS.map(c => [c.id, c]));

// ─── ตราทรยศ — ใส่ในเด็คเริ่มเกม 2 ใบ (ไม่อยู่ใน ALL_CARDS / pool ปกติ) ──
// ถือจนสิ้นเฟส → กลายเป็นผู้ทรยศ · ราชาถือแล้วไม่มีผล
export const BETRAYER_CARD = {
  id: "betrayer_mark",
  type: "betrayer",
  name: "ตราทรยศ",
  ico: "🗡️",
  rarity: "mythic",
  desc: "ถือไว้จนสิ้นเฟส → กลายเป็นผู้ทรยศ · ราชาถือแล้วไม่มีผล · ทิ้ง/ถูกขโมย = ไม่เกิดอะไร",
};

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
