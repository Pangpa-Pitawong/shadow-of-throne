// src/game/utils/cardEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// เอนจินเอฟเฟกต์การ์ด — แหล่งความจริงเดียว (single source of truth) ใช้บน server
// ทุกฟังก์ชันรับ `ctx` ที่ฉีด helper ของเกมเข้ามา (applyDamage/addStatus/ฯลฯ)
//
//   ctx = {
//     applyDamage(gs, p, amount, label, element, attacker) -> dealt   // เคารพ shield/ภูมิธาตุ
//     addStatus(p, type, dur, val, gs)             // ติดสถานะ + recompute (+ภูมิคุ้มกัน)
//     recomputeStats(p, gs)
//     hasStatus(p, type) -> bool
//     pushLog(gs, msg, type)
//     killPlayer(gs, p)
//     hexDistance(aCol, aRow, bCol, bRow) -> number
//     giveCard(p, card, gs)                        // เพิ่มการ์ด + enforce hand limit
//     drawRandomCard() -> card
//     cellAt(gs, col, row) -> cell | undefined
//   }
// ─────────────────────────────────────────────────────────────────────────────
import { NEGATIVE_STATUS } from "../constants/cards.js";

// สล็อตที่ถือว่าเป็น "เกราะโลหะ" (ใช้กับ vs_metal / requireArmor / disarm)
export const METAL_SLOTS = new Set(["armor", "shield", "helm", "boots", "gloves"]);

// ─── เงื่อนไขอุปกรณ์ (กลางวัน/คืน · terrain · near · hp · requireArmor) ─────────
function cellOf(p, gs) {
  if (!gs?.cells) return null;
  return gs.cells.find(c => c.col === p.col && c.row === p.row) || null;
}
function nearWater(p, gs) {
  if (!gs?.cells) return false;
  const here = cellOf(p, gs);
  if (here?.terrain === "water") return true;
  return gs.cells.some(c =>
    c.terrain === "water" &&
    Math.abs(c.col - p.col) <= 1 && Math.abs(c.row - p.row) <= 1
  );
}
// อุปกรณ์ชิ้นนี้ "ทำงานอยู่" ไหม (เงื่อนไขครบ) — ถ้าไม่รู้บริบท (gs) จะผ่อนปรนให้ทำงาน
export function isGearActive(p, gear, gs) {
  const cond = gear?.cond;
  if (!cond) return true;
  if (cond.hpBelowPct != null) {
    if (!((p.hp / Math.max(1, p.maxHp)) * 100 < cond.hpBelowPct)) return false;
  }
  if (cond.requireArmor) {
    const hasOther = (p.equipment || []).some(e => e !== gear && METAL_SLOTS.has(e.slot));
    if (!hasOther) return false;
  }
  if (cond.time) {
    if (gs?.timeOfDay && gs.timeOfDay !== cond.time) return false;
  }
  if (cond.terrain) {
    if (gs?.cells) {
      const t = cellOf(p, gs)?.terrain;
      if (!t || !cond.terrain.includes(t)) return false;
    }
  }
  if (cond.near === "water") {
    if (gs?.cells && !nearWater(p, gs)) return false;
  }
  return true;
}
// ความต้านทานธาตุรวมจากอุปกรณ์ที่ทำงานอยู่ → { flat, immune }
export function gearResistance(p, element, gs) {
  let flat = 0, immune = false;
  for (const e of (p.equipment || [])) {
    if (!isGearActive(p, e, gs)) continue;
    if ((e.immune || []).includes(element)) immune = true;
    if (e.resist && e.resist[element]) flat += e.resist[element];
  }
  return { flat, immune };
}
export function hasMetalArmor(p) {
  return (p.equipment || []).some(e => METAL_SLOTS.has(e.slot));
}

// ─── helper ───────────────────────────────────────────────────────────────────
function markOnce(p, card) {
  if (!card.once) return;
  (p._used = p._used || []).push(card.id);
}
function usedOnce(p, card) {
  return !!card.once && (p._used || []).includes(card.id);
}
function healPlayer(p, amount) {
  const before = p.hp;
  p.hp = amount >= 99 ? p.maxHp : Math.min(p.maxHp, p.hp + amount);
  return p.hp - before;
}
function cleansePlayer(p) {
  const removed = (p.statusEffects || []).filter(s => NEGATIVE_STATUS.has(s.type));
  p.statusEffects = (p.statusEffects || []).filter(s => !NEGATIVE_STATUS.has(s.type));
  return removed.map(s => s.type);
}
// ผู้เล่นอยู่ "บนเส้นตรง" caster→target หรือไม่ (โดยประมาณ ด้วย hex distance)
function onLine(ctx, caster, target, p) {
  const d1 = ctx.hexDistance(caster.col, caster.row, p.col, p.row);
  const d2 = ctx.hexDistance(p.col, p.row, target.col, target.row);
  const dT = ctx.hexDistance(caster.col, caster.row, target.col, target.row);
  return Math.abs(d1 + d2 - dT) <= 1; // ใกล้เส้นตรง
}

// ─── คำนวณรายชื่อเป้าหมายของเวทย์ (ใช้ทั้ง resolve ปกติ และระบบ interrupt) ────
export function computeMagicTargets(gs, caster, card, ctx, { targetPlayer = null, targetCell = null } = {}) {
  const target = card.target || "enemy";
  const range = card.range ?? 4;
  if (target === "enemy") return targetPlayer ? [targetPlayer] : [];
  if (target !== "aoe") return [];
  const alive = gs.players.filter(p => p.alive && p.id !== caster.id);
  switch (card.aoeMode) {
    case "all":
      return alive;
    case "randomN": {
      const pool = [...alive];
      const out = [];
      const n = card.val || 3;
      for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return out;
    }
    case "pointRadius": {
      const center = card.byTile && targetCell ? targetCell : caster;
      return alive.filter(p => ctx.hexDistance(center.col, center.row, p.col, p.row) <= range);
    }
    case "line": {
      if (!targetCell) return [];
      return alive.filter(p =>
        ctx.hexDistance(caster.col, caster.row, p.col, p.row) <= range &&
        onLine(ctx, caster, targetCell, p));
    }
    default:
      // โหมดเดิม: ทุกคนในระยะรอบผู้ร่าย
      return alive.filter(p => ctx.hexDistance(caster.col, caster.row, p.col, p.row) <= range);
  }
}

// ใช้ดาเมจ+สถานะของเวทย์โจมตี ให้เป้าหมายรายตัว (เรียกหลังผ่านระบบ interrupt)
export function applyAttackToTarget(gs, caster, card, ctx, t, { isAoe = false } = {}) {
  const name = card.name;
  const element = card.element || "magic";
  let dealt = 0;
  if (card.dmg) {
    let dmg = card.dmg + (caster.magicAtk || 0);
    // โล่กระจกเงาแห่งจันทรา (spell_reflect) — สะท้อนเวทย์ส่วนหนึ่งกลับผู้ใช้
    const mirror = (t.equipment || []).find(e => e.effect === "spell_reflect" && isGearActive(t, e, gs));
    if (mirror && caster.alive) {
      const pct = (mirror.val || 50) / 100;
      const back = Math.max(1, Math.round(dmg * pct));
      dmg = Math.max(0, dmg - back);
      const rd = ctx.applyDamage(gs, caster, back, `${name} (สะท้อน)`, element, t);
      if (rd > 0) ctx.pushLog(gs, `🌙 ${t.name} สะท้อนเวทย์ ${rd} กลับใส่ ${caster.name}!`, "dmg");
      if (caster.hp <= 0) ctx.killPlayer(gs, caster);
    }
    if (dmg > 0) dealt = ctx.applyDamage(gs, t, dmg, name, element, caster);
    if (card.lifedrain && dealt > 0) {
      const healed = healPlayer(caster, dealt);
      if (healed > 0) ctx.pushLog(gs, `🌪️ ${caster.name} ดูดพลัง HP+${healed}`, "heal");
    }
    // คทาอสูรผนึกพลัง (magic_lifesteal) — ดูด HP เมื่อใช้เวทย์โจมตี
    if (dealt > 0) { const ls = (caster.equipment || []).find(e => e.effect === "magic_lifesteal" && isGearActive(caster, e, gs)); if (ls) { const h = healPlayer(caster, ls.val || 1); if (h > 0) ctx.pushLog(gs, `🔮 ${caster.name} ดูดพลังชีวิต HP+${h}`, "heal"); } }
  }
  if (card.effect === "mana_drain") {
    const drained = Math.min(t.mana, card.val || 1);
    t.mana -= drained; caster.mana = Math.min(caster.maxMana, caster.mana + drained);
  } else if (card.effect && card.effect !== "dodge_charge") {
    // สถานะแบบมีโอกาส (val=เปอร์เซ็นต์) เช่น มึน 50%
    const chance = card.effect === "stun" && card.val ? card.val / 100 : 1;
    if (Math.random() < chance) ctx.addStatus(t, card.effect, card.dur || 1, 0, gs);
  }
  if (dealt > 0) ctx.pushLog(gs, `✨ "${name}" → ${t.name} DMG ${dealt}`, "magic");
  if (t.hp <= 0) ctx.killPlayer(gs, t);
  return dealt;
}

// ─── MAGIC ──────────────────────────────────────────────────────────────────
// ตรวจเงื่อนไข → จ่ายมานา → ทำเอฟเฟกต์ตาม target
// (การ์ดโจมตีที่ blockable/dodgeable จะถูก server ดักไปเข้าระบบ interrupt ก่อน)
export function useMagic(gs, caster, card, ctx, { targetPlayer = null, targetCell = null, skipInterrupt = false } = {}) {
  const cost = card.cost || 0;
  if (caster.mana < cost) return { error: "มานาไม่พอ" };
  if (ctx.hasStatus(caster, "silence")) return { error: "ถูกสะกดเงียบ — ใช้เวทย์ไม่ได้" };
  if (ctx.hasStatus(caster, "spell_lock")) return { error: "ถูกกรงเวทย์ — ใช้เวทย์ไม่ได้" };
  if (usedOnce(caster, card)) return { error: "เวทย์นี้ใช้ได้ครั้งเดียวต่อเกม" };

  const target = card.target || "enemy";
  const range = card.range ?? 4;

  // ── ตรวจเป้าหมายก่อนจ่ายมานา ──
  if (target === "enemy") {
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.id === caster.id)
      return { error: "ต้องเลือกศัตรูเป็นเป้าหมาย" };
    if (ctx.hexDistance(caster.col, caster.row, targetPlayer.col, targetPlayer.row) > range)
      return { error: `เป้าหมายไกลเกินระยะเวทย์ (${range})` };
  }
  if (target === "tile") {
    if (!targetCell) return { error: "เลือกช่องปลายทาง" };
    if (targetCell.terrain === "water") return { error: "เทเลพอร์ตลงน้ำไม่ได้" };
  }
  if (card.aoeMode === "line" && !targetCell) return { error: "เลือกทิศทาง (ช่องปลายเส้น)" };
  if (card.aoeMode === "pointRadius" && card.byTile && !targetCell) return { error: "เลือกจุดศูนย์กลาง" };

  // ── จ่ายมานา + บันทึก once ──
  caster.mana -= cost;
  markOnce(caster, card);
  const name = card.name;

  switch (target) {
    // — โจมตีเดี่ยว —
    case "enemy": {
      applyAttackToTarget(gs, caster, card, ctx, targetPlayer, { isAoe: false });
      return { ok: true };
    }

    // — โจมตีหมู่ (โหมดใหม่: all/randomN/line/pointRadius) —
    case "aoe": {
      const targets = computeMagicTargets(gs, caster, card, ctx, { targetPlayer, targetCell });
      for (const t of targets) applyAttackToTarget(gs, caster, card, ctx, t, { isAoe: true });
      ctx.pushLog(gs, `⚡ ${caster.name} ร่าย "${name}" โดน ${targets.length} เป้า`, "magic");
      return { ok: true };
    }

    // — ฟื้น/ล้าง/บัฟ ให้ตน หรือพันธมิตร 1 ตัว —
    case "ally": {
      const t = targetPlayer && targetPlayer.alive ? targetPlayer : caster;
      if (card.heal) { const h = healPlayer(t, card.heal); ctx.pushLog(gs, `✨ ${caster.name} รักษา ${t.name} HP+${h}`, "heal"); }
      if (card.cleanse) { const r = cleansePlayer(t); ctx.recomputeStats(t, gs); ctx.pushLog(gs, r.length ? `🧼 ล้างสถานะลบของ ${t.name}` : `🧼 ${t.name} ไม่มีสถานะลบ`, "heal"); }
      if (card.effect) { ctx.addStatus(t, card.effect, card.dur || 1, card.val || 0, gs); ctx.pushLog(gs, `🛡️ ${t.name} ได้รับ "${card.effect}"`, "event"); }
      return { ok: true };
    }

    // — ออร่ารอบตัว —
    case "team": {
      const auraRange = card.range ?? 2;
      const targets = gs.players.filter(p => p.alive && ctx.hexDistance(caster.col, caster.row, p.col, p.row) <= auraRange);
      for (const t of targets) {
        if (card.heal) healPlayer(t, card.heal);
        if (card.effect) ctx.addStatus(t, card.effect, card.dur || 1, card.val || 0, gs);
      }
      ctx.pushLog(gs, `🔔 ${caster.name} ร่าย "${name}" ส่งผลต่อ ${targets.length} คนรอบตัว`, "heal");
      return { ok: true };
    }

    // — เคลื่อนที่ —
    case "tile": {
      caster.col = targetCell.col; caster.row = targetCell.row;
      ctx.pushLog(gs, `🌀 ${caster.name} วาร์ปไป (${targetCell.col},${targetCell.row})`, "magic");
      return { ok: true, teleportedTo: targetCell };
    }

    // — ตน / ไม่มีเป้า (รวม การ์ดหลบ เมื่อเล่นในเทิร์นตัวเอง) —
    case "self":
    case "none":
    default: {
      if (card.selfHp) caster.hp = Math.max(1, caster.hp - card.selfHp);
      if (card.heal) { const h = healPlayer(caster, card.heal); ctx.pushLog(gs, `✨ ${caster.name} ใช้ "${name}" ฟื้น HP+${h}`, "heal"); }
      if (card.cleanse) { cleansePlayer(caster); ctx.recomputeStats(caster, gs); }
      if (card.effect) {
        ctx.addStatus(caster, card.effect, card.dur || 1, card.val || 0, gs);
        if (card.effect === "dodge_charge") ctx.pushLog(gs, `🌬️ ${caster.name} เตรียมหลบ — กันการโจมตีครั้งถัดไป`, "event");
        else ctx.pushLog(gs, `✨ ${caster.name} ใช้ "${name}" → ${card.effect}`, "event");
      }
      if (card.draw) { for (let i = 0; i < card.draw; i++) ctx.giveCard(caster, ctx.drawRandomCard(), gs); ctx.pushLog(gs, `🍃 ${caster.name} จั่วเพิ่ม ${card.draw} ใบ`, ""); }
      return { ok: true };
    }
  }
}

// ─── WEAPON / ARMOR (สวมใส่) ─────────────────────────────────────────────────
const HEAVY_SLOTS = new Set(["weapon"]);
export function equipWeapon(gs, player, card, ctx) {
  const equip = player.equipment || [];
  // เงื่อนไขสวม: ชุดรวมพลกษัตริย์ผู้ตาย — HP ต้อง < 50%
  if (card.cond?.hpBelowPct != null && !((player.hp / Math.max(1, player.maxHp)) * 100 < card.cond.hpBelowPct))
    return { error: `สวม "${card.name}" ได้เมื่อ HP ต่ำกว่า ${card.cond.hpBelowPct}% เท่านั้น` };
  // ข้อจำกัดสล็อต
  const wearingShield = equip.some(e => e.slot === "shield");
  const wearingNoShieldArmor = equip.some(e => (e.tag || []).includes("no_shield"));
  if (card.slot === "shield" && wearingNoShieldArmor) return { error: "เกราะที่สวมอยู่ใช้ร่วมกับโล่ไม่ได้" };
  if ((card.tag || []).includes("no_shield") && wearingShield) return { error: "ถอดโล่ก่อนจึงจะสวมเกราะนี้ได้" };
  const wearingHeavyWeapon = equip.some(e => e.slot === "weapon" && (e.atk || 0) >= 4);
  if ((card.tag || []).includes("no_heavy") && wearingHeavyWeapon) return { error: "ใช้ร่วมกับอาวุธหนักไม่ได้" };

  player.equipment = [...equip, {
    id: card.id, name: card.name, ico: card.ico, slot: card.slot || "weapon",
    atk: card.atk || 0, def: card.def || 0, range: card.range || 0, magicAtk: card.magicAtk || 0,
    atkElement: card.atkElement, resist: card.resist, immune: card.immune, immuneStatus: card.immuneStatus,
    effect: card.effect, val: card.val, cooldown: card.cooldown, twin: card.twin, tag: card.tag, cond: card.cond,
  }];
  ctx.pushLog(gs, `🗡️ ${player.name} สวมใส่ "${card.name}"`, "");
  ctx.recomputeStats(player, gs);
  return { ok: true };
}

// ─── TRAP (วางบนช่อง) ────────────────────────────────────────────────────────
export function placeTrap(gs, cell, card, ownerId, ctx) {
  cell.trap = {
    id: card.id, name: card.name, ico: card.ico, ownerId,
    trigger: card.trigger || "step", fx: card.fx, val: card.val || 0, dur: card.dur || 0,
    threshold: card.threshold || 0,
  };
  ctx.pushLog(gs, `🪤 ${gs.players[ownerId]?.name} วางกับดัก "${card.name}"`, "");
  return { ok: true };
}

// เมื่อผู้เล่นเดินเหยียบกับดัก (เรียกจาก server หลังย้ายตำแหน่ง)
export function triggerTrap(gs, player, cell, ctx) {
  const trap = cell.trap;
  if (!trap) return { ok: false };
  // กับดักทริกเกอร์แบบ "เหยียบ" และ "อยู่ในพื้นที่" จัดการที่นี่; ทริกเกอร์พิเศษ (cardspam/draw/...)
  // จัดการในจุดอื่นของ server แล้วเรียก fireTrapEffect โดยตรง
  if (trap.trigger !== "step" && trap.trigger !== "always") return { ok: false };
  const consumed = fireTrapEffect(gs, player, trap, ctx);
  if (consumed) cell.trap = null;
  if (player.hp <= 0) ctx.killPlayer(gs, player);
  return { ok: true };
}

// ประมวลผลเอฟเฟกต์กับดัก 1 ครั้ง — คืน true ถ้ากับดักถูกใช้ไป (ลบทิ้ง)
export function fireTrapEffect(gs, player, trap, ctx) {
  const owner = gs.players[trap.ownerId];
  const log = (m, t = "dmg") => ctx.pushLog(gs, m, t);
  switch (trap.fx) {
    case "discard": {
      let n = trap.val || 1;
      while (n-- > 0 && player.hand.length) player.hand.splice(Math.floor(Math.random() * player.hand.length), 1);
      log(`🖤 ${player.name} โดน "${trap.name}" — ทิ้งการ์ดสุ่ม ${trap.val} ใบ`); break;
    }
    case "cardlock": {
      const c = player.hand[Math.floor(Math.random() * player.hand.length)];
      if (c) { c._lockedTurns = trap.dur || 2; log(`🗄️ การ์ด "${c.name}" ของ ${player.name} ถูกล็อค ${trap.dur} เทิร์น`); }
      break;
    }
    case "discard_dot": ctx.addStatus(player, "card_rot", trap.dur || 3, trap.val || 1, gs); log(`🥃 ${player.name} โดนหมึกพิษ — ทิ้งการ์ด 1/เทิร์น (${trap.dur} เทิร์น)`); break;
    case "burn_draw": player._burnDraw = (player._burnDraw || 0) + (trap.val || 3); log(`🔥 ${player.name} การ์ดที่จะจั่ว ${trap.val} ใบถัดไปถูกเผา`); break;
    case "armor_break": ctx.addStatus(player, "armor_break", trap.dur || 3, trap.val || 2, gs); log(`🧪 ${player.name} เกราะถูกกัด DEF-${trap.val}`); break;
    case "disarm": {
      const wi = (player.equipment || []).findIndex(e => e.slot === "weapon");
      if (wi >= 0) { const w = player.equipment.splice(wi, 1)[0]; player._disarmTurns = 1; ctx.recomputeStats(player, gs); log(`🧲 ${player.name} ถูกดูดอาวุธ "${w.name}" หลุดมือ`); }
      break;
    }
    case "gear_silence": ctx.addStatus(player, "gear_silence", trap.dur || 3, 0, gs); log(`🟫 ${player.name} เกราะสูญเสียเอฟเฟกต์พิเศษ ${trap.dur} เทิร์น`); break;
    case "slot_lock": ctx.addStatus(player, "slot_lock", trap.dur || 2, 0, gs); log(`🧵 ${player.name} สล็อตอุปกรณ์ถูกล็อค ${trap.dur} เทิร์น`); break;
    case "weapon_backfire": ctx.addStatus(player, "weapon_backfire", trap.dur || 1, 0, gs); log(`↩️ ${player.name} อาวุธย้อนทำร้ายตัวเอง 1 เทิร์น`); break;
    case "gold_loss": { const g = Math.min(player.gold, trap.val || 3); player.gold -= g; log(`💸 ${player.name} เสีย ${g} เหรียญ`); break; }
    case "gold_steal_half": { const g = Math.floor(player.gold / 2); player.gold -= g; if (owner) owner.gold += g; log(`🫳 ${player.name} ถูกขโมย ${g} เหรียญ`); break; }
    case "gold_tax": ctx.addStatus(player, "gold_tax", trap.dur || 3, trap.val || 2, gs); log(`🏷️ ${player.name} ติดภาษีเงามืด ${trap.val}/เทิร์น`); return false; // คงกับดักไว้
    case "spell_lock": ctx.addStatus(player, "spell_lock", trap.dur || 2, 0, gs); log(`🔒 ${player.name} ใช้เวทย์ไม่ได้ ${trap.dur} เทิร์น`); break;
    case "mana_steal": { const m = Math.min(player.mana, trap.val || 2); if (m > 0) { player.mana -= m; if (owner) owner.mana = Math.min(owner.maxMana, owner.mana + m); } else { ctx.applyDamage(gs, player, 2, "กับดักดูดมนต์", "magic"); } log(`🌀 ${player.name} ถูกดูดมานา/HP`); break; }
    case "spell_backfire": ctx.addStatus(player, "spell_backfire", trap.dur || 1, 0, gs); log(`♻️ ${player.name} เวทย์ถัดไปจะย้อนโจมตีตัวเอง`); break;
    case "move_lock": ctx.addStatus(player, "lock", trap.dur || 2, 0, gs); player._escapeDmg = trap.val || 2; log(`⛓️ ${player.name} ถูกล็อคขา ${trap.dur} เทิร์น`); break;
    case "move_slow": ctx.addStatus(player, "slow", trap.dur || 3, 0, gs); log(`🟧 ${player.name} เคลื่อนที่ช้าลง ${trap.dur} เทิร์น`); break;
    case "no_escape": ctx.addStatus(player, "no_escape", trap.dur || 1, 0, gs); log(`🚧 ${player.name} ถูกปิดเส้นทางหนี 1 เทิร์น`); break;
    case "move_scramble": ctx.addStatus(player, "scramble", trap.dur || 2, 0, gs); log(`🪞 ${player.name} เดินมั่วทิศ ${trap.dur} เทิร์น`); break;
    default: log(`🪤 ${player.name} เหยียบกับดัก "${trap.name}"`); break;
  }
  return true;
}
