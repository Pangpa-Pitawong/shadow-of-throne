// src/game/constants/events.js
// ─────────────────────────────────────────────────────────────────────────────
// การ์ดสนามรบ/เหตุการณ์ศึก (50 ใบ) — เปิด 1–3 ใบเมื่อ "จบเฟส"
// (ดู onPhaseAdvance + applyEventCard ใน server/engine.js)
//
//   id   : รหัสเฉพาะ
//   name : ชื่อการ์ด (ธีมสามก๊ก — สนามรบ / การเมือง / ภัยศึก)
//   ico  : ไอคอน (แสดงใน modal)
//   desc : คำอธิบายผล (โชว์ผู้เล่น — สั้น 1-2 บรรทัด)
//   fx   : คีย์เอฟเฟกต์ที่ server ประมวลผล (applyEventCard)
//   p    : พารามิเตอร์ประกอบ fx (val/dur/status ฯลฯ)
//
// หมายเหตุ: เอฟเฟกต์เชิงการเมือง/โหวตที่ต้องโต้ตอบ จะ "approximate" (สุ่มเป้า/auto-resolve)
// ให้เล่นได้จริง — ยกระดับเป็น interactive เต็มรูปแบบใน Phase 3 พร้อมระบบแจ้งเตือน
// ─────────────────────────────────────────────────────────────────────────────
export const EVENT_CARDS = [
  { id: "ev_planet_align", name: "คืนฤกษ์ดาวรวมพล", ico: "🪐",
    desc: "ทุกคนเพิ่มพลังเวทย์ +2 จนสิ้นเทิร์น", fx: "buff_all", p: { status: "magic_up", val: 2, dur: 1 } },
  { id: "ev_ancient_war", name: "เสียงโห่ทัพนักรบโบราณ", ico: "🌬️",
    desc: "ทุกคนโจมตี +1 แต่รับดาเมจ +1 รอบนี้", fx: "buff_all", p: { status: "atk_up", val: 1, dur: 2, also: "fragile", alsoVal: 1 } },
  { id: "ev_ice_cover", name: "หิมะปกคลุมสมรภูมิ", ico: "🧊",
    desc: "ทุกคนเคลื่อนที่ครึ่งหนึ่งเทิร์นนี้", fx: "buff_all", p: { status: "slow", dur: 1 } },
  { id: "ev_full_moon", name: "จันทร์เพ็ญหนุนกลศึก", ico: "🌕",
    desc: "ผู้ใช้เวทย์เทิร์นนี้ ดาเมจเวทย์ +2 ทุกใบ", fx: "buff_all", p: { status: "magic_up", val: 2, dur: 1 } },
  { id: "ev_falling_stars", name: "ฝนดาวตกถล่มค่าย", ico: "💫",
    desc: "ทุกคนเสีย HP 2 · มีเกราะเสียเพียง 1", fx: "dmg_all", p: { val: 2, armorReduce: 1 } },
  { id: "ev_assassin_day", name: "วันแห่งมือสังหาร", ico: "🗡️",
    desc: "เป้าหมายที่ถูกเลือกมากสุดเสีย HP 4 (สุ่มเป้า)", fx: "dmg_random", p: { val: 4 } },
  { id: "ev_black_market", name: "ตลาดอาวุธลับเปิดค่าย", ico: "🏴",
    desc: "ทุกคนได้การ์ดอาวุธสุ่ม 1 ใบ (ของแถมตลาดลับ)", fx: "give_weapon_all", p: {} },
  { id: "ev_prophet", name: "คำพยากรณ์โหรหลวง", ico: "📖",
    desc: "เปิดการ์ดบนสุดของทุกคนให้เห็น 1 ใบ", fx: "reveal_top_all", p: {} },
  { id: "ev_nightmare", name: "คืนฝันร้ายทั่วทัพ", ico: "😱",
    desc: "ทุกคนเริ่มเทิร์นถัดไปจั่วการ์ดไม่ได้", fx: "no_draw_all", p: { dur: 1 } },
  { id: "ev_acid_storm", name: "พายุลมกรดทะเลทราย", ico: "🌫️",
    desc: "ใส่เกราะโลหะ DEF -1 ชั่วคราว · ไม่มีเกราะเสีย HP 2", fx: "acid_storm", p: { val: 2, dur: 2 } },
  { id: "ev_war_horn", name: "เสียงแตรเรียกพลศึก", ico: "📯",
    desc: "ไม่มีอาวุธเสีย HP 3 · มีอาวุธ ATK +1 รอบนี้", fx: "war_horn", p: { dmg: 3, atk: 1, dur: 2 } },
  { id: "ev_wandering_priest", name: "นักพรตเร่ร่อนเยือนค่าย", ico: "🧎",
    desc: "HP น้อยสุดฟื้น +5 · HP มากสุดเสีย 1", fx: "heal_low_dmg_high", p: { heal: 5, dmg: 1 } },
  { id: "ev_fire_festival", name: "เทศกาลไฟแห่งราตรี", ico: "🔥",
    desc: "ทุกคนเสีย HP 1 แต่ฟื้นมานา +2", fx: "trade_hp_mana", p: { hp: 1, mana: 2 } },
  { id: "ev_wolf_kingdom", name: "ศึกแดนหมาป่า (ต่างคนต่างรบ)", ico: "🐺",
    desc: "ห้ามช่วยพันธมิตรรอบนี้ · โจมตีทุกคน +1", fx: "buff_all", p: { status: "atk_up", val: 1, dur: 2 } },
  { id: "ev_water_miracle", name: "ปาฏิหาริย์ธารน้ำผุด", ico: "⛲",
    desc: "ทุกคนฟื้น HP +2 · ลบพิษ/ไหม้ทั้งหมด", fx: "heal_all_cleanse", p: { val: 2, types: ["poison", "burn"] } },
  { id: "ev_dead_star_curse", name: "คำสาปแห่งดาวดับ", ico: "⭐",
    desc: "ทุกคนลดพลังโจมตีครึ่งหนึ่ง 2 เทิร์น", fx: "atk_halve_all", p: { dur: 2 } },
  { id: "ev_resource_crisis", name: "วิกฤตเสบียงขาดแคลน", ico: "📉",
    desc: "ราคาการ์ดทุกใบ +2 เหรียญรอบนี้", fx: "price_up", p: { val: 2, dur: 2 } },
  { id: "ev_fake_victory", name: "งานฉลองชัยชนะลวง", ico: "🎉",
    desc: "HP มากสุดจั่วน้อยลง 1 ใบ · คนอื่นจั่ว +1", fx: "draw_swing", p: { highest: -1, others: 1 } },
  { id: "ev_zombie_night", name: "คืนผีดิบสุสานเก่า", ico: "🧟",
    desc: "ทุกคนเสีย HP 1 · มีการ์ดเวทย์ในมือเสีย 2 แทน", fx: "zombie", p: { base: 1, magic: 2 } },
  { id: "ev_dragon_last_breath", name: "ลมหายใจสุดท้ายของมังกร", ico: "🐉",
    desc: "ทุกคนได้การ์ดอาวุธสุ่ม 1 ใบ แต่เสีย HP 2", fx: "give_weapon_dmg", p: { dmg: 2 } },
  { id: "ev_village_burn", name: "หมู่บ้านถูกเผาวอด", ico: "🏚️",
    desc: "ลบการ์ดในกองทิ้งทั้งหมดออกจากเกม", fx: "clear_discard", p: {} },
  { id: "ev_foreign_warrior", name: "ขุนศึกต่างแดนท้าประลอง", ico: "🛡️",
    desc: "ผู้มีอาวุธแรงสุดทอยเต๋า แพ้เสียอาวุธ ชนะ +3 ทอง", fx: "challenge_strongest", p: { gold: 3 } },
  { id: "ev_trade_day", name: "วันแลกเปลี่ยนสาส์น", ico: "🤝",
    desc: "ทุกคนส่งการ์ด 1 ใบให้ผู้เล่นทางซ้าย", fx: "pass_left", p: {} },
  { id: "ev_war_fog", name: "กลหมอกขงเบ้งปกคลุม", ico: "🌁",
    desc: "ทุกคนหงายการ์ดสุ่ม 2 ใบให้ทุกคนเห็น 1 เทิร์น", fx: "expose_hand", p: { val: 2, dur: 1 } },
  { id: "ev_power_wonder", name: "วันรวบรวมไพร่พล", ico: "✨",
    desc: "ทุกคนจั่ว 3 ใบ แล้วทิ้ง 2 ใบ", fx: "draw_then_discard", p: { draw: 3, discard: 2 } },
  { id: "ev_cursed_sword", name: "ดาบสาปกลางสมรภูมิ", ico: "🗡️",
    desc: "ทอยเต๋า 4+ ได้อาวุธพิเศษ · 1-3 เสีย HP 3", fx: "dice_each", p: { pass: 4, win: { weapon: 1 }, lose: { hp: 3 } } },
  { id: "ev_mana_crisis", name: "วิกฤตปราณแห้งเหือด", ico: "🚱",
    desc: "ทุกคนใช้การ์ดเวทย์ไม่ได้รอบนี้", fx: "buff_all", p: { status: "silence", dur: 2 } },
  { id: "ev_cosmic_cannon", name: "เครื่องยิงหินถล่มสนาม", ico: "🪨",
    desc: "ผู้ใกล้จุดสุ่มมากสุดเสีย HP 5", fx: "dmg_random", p: { val: 5 } },
  { id: "ev_fate_drum", name: "กลองโหมโรงโชคชะตา", ico: "🥁",
    desc: "ทุกคนทอยเต๋า ต่ำสุดข้ามเทิร์นถัดไป", fx: "dice_lowest_skip", p: {} },
  { id: "ev_snow_flood", name: "น้ำหลากจากเขาหิมะ", ico: "🌊",
    desc: "ทุกคนย้าย 2 ช่องทิศสุ่ม · ชนกำแพงเสีย HP 2", fx: "push_all", p: { dist: 2, wallDmg: 2 } },
  { id: "ev_ghost_king", name: "ราชาผีคืนชีพ", ico: "👑",
    desc: "ทอยเต๋า <3 เสีย HP 3 · =6 ได้เวทย์ฟรี 1 ใบ", fx: "dice_each", p: { lowThresh: 3, lose: { hp: 3 }, jackpot: 6, jackpotReward: { magic: 1 } } },
  { id: "ev_card_shuffle", name: "วันอาถรรพ์สับไพ่ศึก", ico: "🃏",
    desc: "ทุกคนคืนการ์ดในมือแล้วจั่วใหม่จำนวนเท่าเดิม", fx: "redraw_all", p: {} },
  { id: "ev_shadow_plague", name: "ห่าโรคระบาดเงา", ico: "🦠",
    desc: "HP เต็มเสีย 3 · HP ไม่เต็มได้ภูมิคุ้มกัน 1 เทิร์น", fx: "plague", p: { dmg: 3, shieldDur: 1 } },
  { id: "ev_sun_halo", name: "พระอาทิตย์ทรงกลด", ico: "🌅",
    desc: "ผู้ไม่ซ่อนตัวฟื้น HP +3 · ผู้ซ่อนตัวเสีย 1", fx: "heal_all", p: { val: 3 } },
  { id: "ev_shadow_army", name: "กองทัพเงาบุกจู่โจม", ico: "👥",
    desc: "ทุกคนเสีย HP เท่าครึ่งหนึ่งของพลังโจมตีตัวเอง", fx: "self_shadow", p: {} },
  { id: "ev_silver_miracle", name: "ปาฏิหาริย์เงินตราไหลมา", ico: "🪙",
    desc: "ทุกคนได้ +3 ทอง · คนรวยสุดได้ +1", fx: "gold_all", p: { val: 3, richest: 1 } },
  { id: "ev_lost_mage", name: "นักกลศึกหลงทางเยือนค่าย", ico: "🧙",
    desc: "ผู้มีการ์ดเวทย์น้อยสุดได้เวทย์สุ่ม 2 ใบ", fx: "give_magic_fewest", p: { val: 2 } },
  { id: "ev_metal_crisis", name: "วิกฤตโลหะขาดแคลน", ico: "⛏️",
    desc: "ผู้มีอาวุธโลหะขายได้ +3 เหรียญพิเศษเทิร์นนี้", fx: "metal_sell_bonus", p: { val: 3 } },
  { id: "ev_owl_omen", name: "นกฮูกส่งลางสังหรณ์", ico: "🦉",
    desc: "ทุกคนแอบดูการ์ดบนสุดของตัวเอง 1 ใบ", fx: "peek_top_self", p: {} },
  { id: "ev_time_butterfly", name: "ผีเสื้อแห่งกาลเวลา", ico: "🦋",
    desc: "ทุกคนนำการ์ด 1 ใบจากกองทิ้งกลับมาในมือ", fx: "recover_discard", p: { val: 1 } },
  { id: "ev_edge_cold", name: "ลมหนาวจากขอบฟ้า", ico: "🥶",
    desc: "ไม่มีเกราะเสีย HP 3 · ใส่เซ็ตครบไม่โดน", fx: "cold_wind", p: { val: 3 } },
  { id: "ev_comet", name: "คืนดาวหางพาดผ่านฟ้า", ico: "☄️",
    desc: "ผู้ใช้เวทย์เทิร์นนี้ใช้ได้โดยไม่เสียต้นทุน", fx: "free_magic_all", p: { dur: 1 } },
  { id: "ev_fate_flood", name: "อุทกภัยแห่งโชคชะตา", ico: "💧",
    desc: "ทุกคนทิ้งการ์ดสุ่ม 1 ใบลงกองทิ้ง", fx: "discard_all", p: { val: 1 } },
  { id: "ev_mini_apocalypse", name: "แผ่นดินไหวสะเทือนค่าย", ico: "🌋",
    desc: "ผู้ยืนติดกำแพง/มุมเสีย HP 2 · กลางสนามรอด", fx: "quake", p: { val: 2 } },
  { id: "ev_amnesty", name: "วันพระราชทานอภัยโทษ", ico: "🕊️",
    desc: "ลบสถานะลบทั้งหมดของทุกคน", fx: "cleanse_all", p: {} },
  { id: "ev_gold_dragon", name: "มังกรทองลงประลอง", ico: "🐲",
    desc: "HP มากสุดทอยเต๋า 4+ ได้ +5 ทอง · ต่ำกว่าเสีย HP 4", fx: "dice_highest", p: { pass: 4, win: { gold: 5 }, lose: { hp: 4 } } },
  { id: "ev_golden_stars", name: "คืนดาวทองหนุนทัพ", ico: "🌟",
    desc: "ทุกคนเลือกการ์ด 1 ใบ พลัง +2 รอบนี้ (สุ่มให้)", fx: "buff_all", p: { status: "atk_up", val: 2, dur: 2 } },
  { id: "ev_shadow_war", name: "สงครามเงากลางสนาม", ico: "⚔️",
    desc: "HP น้อยสุดเสีย 3 · HP มากสุดฟื้น 2", fx: "dmg_low_heal_high", p: { dmg: 3, heal: 2 } },
  { id: "ev_red_sky", name: "ฟากฟ้าสีเลือด", ico: "🟥",
    desc: "ทุกคนเสีย HP 1 · พลังโจมตี +2 รอบนี้", fx: "red_sky", p: { dmg: 1, atk: 2, dur: 2 } },
  { id: "ev_throne_judgment", name: "วันพิพากษาแห่งบัลลังก์เงา", ico: "⚖️",
    desc: "มือมากสุดทิ้งครึ่งหนึ่ง · น้อยสุดจั่ว +2 · เท่ากันทุกคนเสีย 1", fx: "throne_judgment", p: {} },
];

// alias เผื่อโค้ดเก่าอ้างชื่อ PHASE_EVENTS
export const PHASE_EVENTS = EVENT_CARDS;

// สุ่มเปิดการ์ดเหตุการณ์ count ใบ (ไม่ซ้ำกัน)
export function drawEventCards(count = 1, rng = Math.random) {
  const pool = [...EVENT_CARDS];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}
