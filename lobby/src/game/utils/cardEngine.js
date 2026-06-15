// src/game/utils/cardEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// เอนจินเอฟเฟกต์การ์ด — แหล่งความจริงเดียว (single source of truth)
// ใช้บน server (authoritative). ทุกฟังก์ชันรับ `ctx` ที่ฉีด helper ของเกมเข้ามา
// เพื่อแยกตรรกะการ์ดออกจากตัว server ให้เป็นระเบียบและทดสอบง่าย
//
//   ctx = {
//     applyDamage(gs, p, amount, label) -> dealt   // เคารพ shield
//     addStatus(p, type, dur, val)                 // ติดสถานะ + recompute
//     recomputeStats(p)
//     hasStatus(p, type) -> bool
//     pushLog(gs, msg, type)
//     killPlayer(gs, p)
//     hexDistance(aCol, aRow, bCol, bRow) -> number
//     giveCard(p, card, gs)                        // เพิ่มการ์ด + enforce hand limit
//     drawRandomCard() -> card
//     cellAt(gs, col, row) -> cell | undefined
//   }
//
// คืนค่า: { ok: true, ... } เมื่อสำเร็จ | { error: "ข้อความ" } เมื่อใช้ไม่ได้
// ─────────────────────────────────────────────────────────────────────────────
import { NEGATIVE_STATUS } from "../constants/cards.js";

// ─── helper ───────────────────────────────────────────────────────────────────
function markOnce(p, card) {
  if (!card.once) return;
  (p._used = p._used || []).push(card.id);
}
function usedOnce(p, card) {
  return !!card.once && (p._used || []).includes(card.id);
}
function alivePlayersInRange(gs, center, range, { excludeId = null } = {}, ctx) {
  return gs.players.filter(p =>
    p.alive &&
    p.id !== excludeId &&
    ctx.hexDistance(center.col, center.row, p.col, p.row) <= range
  );
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

// ─── MAGIC ──────────────────────────────────────────────────────────────────
// ตรวจเงื่อนไข → จ่ายมานา → ทำเอฟเฟกต์ตาม target
export function useMagic(gs, caster, card, ctx, { targetPlayer = null, targetCell = null } = {}) {
  const cost = card.cost || 0;
  if (caster.mana < cost) return { error: "มานาไม่พอ" };
  if (ctx.hasStatus(caster, "silence")) return { error: "ถูกสะกดเงียบ — ใช้เวทย์ไม่ได้" };
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

  // ── จ่ายมานา + บันทึก once ──
  caster.mana -= cost;
  markOnce(caster, card);
  const name = card.name;

  switch (target) {
    // — โจมตีเดี่ยว —
    case "enemy": {
      if (card.dmg) {
        const dealt = ctx.applyDamage(gs, targetPlayer, card.dmg, name);
        ctx.pushLog(gs, `✨ ${caster.name} ร่าย "${name}" → ${targetPlayer.name} DMG ${dealt}`, "magic");
        if (card.lifedrain && dealt > 0) {
          const healed = healPlayer(caster, dealt);
          ctx.pushLog(gs, `🫧 ${caster.name} ดูดวิญญาณ HP+${healed}`, "heal");
        }
      }
      if (card.effect) {
        ctx.addStatus(targetPlayer, card.effect, card.dur || 1, card.val || 0);
        ctx.pushLog(gs, `🌑 ${targetPlayer.name} ติดสถานะ "${card.effect}" (${card.dur || 1} เทิร์น)`, "event");
      }
      if (targetPlayer.hp <= 0) ctx.killPlayer(gs, targetPlayer);
      return { ok: true };
    }

    // — โจมตีหมู่ —
    case "aoe": {
      const targets = alivePlayersInRange(gs, caster, range, { excludeId: caster.id }, ctx);
      let count = 0;
      for (const t of targets) {
        if (card.dmg) ctx.applyDamage(gs, t, card.dmg, name);
        if (card.effect) ctx.addStatus(t, card.effect, card.dur || 1, card.val || 0);
        if (t.hp <= 0) ctx.killPlayer(gs, t);
        count++;
      }
      ctx.pushLog(gs, `⚡ ${caster.name} ร่าย "${name}" โดน ${count} เป้า${card.dmg ? ` DMG ${card.dmg}` : ""}`, "magic");
      return { ok: true };
    }

    // — ฟื้น/ล้าง/บัฟ ให้ตน หรือพันธมิตร 1 ตัว —
    case "ally": {
      const t = targetPlayer && targetPlayer.alive ? targetPlayer : caster;
      if (card.heal) {
        const healed = healPlayer(t, card.heal);
        ctx.pushLog(gs, `✨ ${caster.name} รักษา ${t.name} HP+${healed}`, "heal");
      }
      if (card.cleanse) {
        const removed = cleansePlayer(t);
        ctx.recomputeStats(t);
        ctx.pushLog(gs, removed.length
          ? `🧼 ${caster.name} ล้างสถานะลบของ ${t.name} (${removed.join(", ")})`
          : `🧼 ${caster.name} ใช้ "${name}" แต่ ${t.name} ไม่มีสถานะลบ`, "heal");
      }
      if (card.effect) {
        ctx.addStatus(t, card.effect, card.dur || 1, card.val || 0);
        ctx.pushLog(gs, `🛡️ ${t.name} ได้รับ "${card.effect}"`, "event");
      }
      return { ok: true };
    }

    // — ออร่ารอบตัว (ตน + ผู้เล่นในระยะ) —
    case "team": {
      const auraRange = card.range ?? 2;
      const targets = alivePlayersInRange(gs, caster, auraRange, {}, ctx);
      for (const t of targets) {
        if (card.heal) healPlayer(t, card.heal);
        if (card.effect) ctx.addStatus(t, card.effect, card.dur || 1, card.val || 0);
      }
      ctx.pushLog(gs, `🔔 ${caster.name} ร่าย "${name}" ส่งผลต่อ ${targets.length} คนรอบตัว`, "heal");
      return { ok: true };
    }

    // — เคลื่อนที่ —
    case "tile": {
      caster.col = targetCell.col;
      caster.row = targetCell.row;
      ctx.pushLog(gs, `🌀 ${caster.name} วาร์ปไป (${targetCell.col},${targetCell.row})`, "magic");
      return { ok: true, teleportedTo: targetCell };
    }

    // — ตน / ไม่มีเป้า —
    case "self":
    case "none":
    default: {
      if (card.selfHp) caster.hp = Math.max(1, caster.hp - card.selfHp);
      if (card.heal) {
        const healed = healPlayer(caster, card.heal);
        ctx.pushLog(gs, `✨ ${caster.name} ใช้ "${name}" ฟื้น HP+${healed}`, "heal");
      }
      if (card.cleanse) { cleansePlayer(caster); ctx.recomputeStats(caster); }
      if (card.effect) {
        ctx.addStatus(caster, card.effect, card.dur || 1, card.val || 0);
        ctx.pushLog(gs, `✨ ${caster.name} ใช้ "${name}" → ${card.effect}`, "event");
      }
      if (card.draw) {
        for (let i = 0; i < card.draw; i++) ctx.giveCard(caster, ctx.drawRandomCard(), gs);
        ctx.pushLog(gs, `🍃 ${caster.name} จั่วการ์ดเพิ่ม ${card.draw} ใบ`, "");
      }
      return { ok: true };
    }
  }
}

// ─── WEAPON (สวมใส่) ─────────────────────────────────────────────────────────
export function equipWeapon(gs, player, card, ctx) {
  player.equipment = [...(player.equipment || []), {
    id: card.id, name: card.name, ico: card.ico,
    atk: card.atk || 0, def: card.def || 0, range: card.range || 0, effect: card.effect,
  }];
  if (card.effect === "self_dmg")      { player.hp = Math.max(1, player.hp - 1); ctx.pushLog(gs, `🪓 ${player.name} สวม "${card.name}" (เสีย HP1)`, ""); }
  else if (card.effect === "blood")    { player.hp = Math.max(1, player.hp - 2); ctx.pushLog(gs, `💀 ${player.name} สวม "${card.name}" (เสีย HP2)`, ""); }
  else if (card.effect === "def_heal") { player.hp = Math.min(player.maxHp, player.hp + 1); ctx.pushLog(gs, `🛡️ ${player.name} สวม "${card.name}" (HP+1)`, ""); }
  else ctx.pushLog(gs, `🗡️ ${player.name} สวมใส่ "${card.name}"`, "");
  ctx.recomputeStats(player);
  return { ok: true };
}

// ─── TRAP (วางบนช่อง) ────────────────────────────────────────────────────────
export function placeTrap(gs, cell, card, ownerId, ctx) {
  cell.trap = {
    id: card.id, name: card.name, ico: card.ico, ownerId,
    dmg: card.dmg || 0, poison: card.poison || 0, lock: card.lock || 0,
    blind: card.blind || 0, burn: card.burn || 0, freeze: card.freeze || 0,
    armor_break: card.armor_break || 0,
  };
  ctx.pushLog(gs, `🪤 ${gs.players[ownerId]?.name} วางกับดัก "${card.name}"`, "");
  return { ok: true };
}

// เมื่อผู้เล่นเดินเหยียบกับดัก (เรียกจาก server หลังย้ายตำแหน่ง)
export function triggerTrap(gs, player, cell, ctx) {
  const trap = cell.trap;
  if (!trap) return { ok: false };
  let dealt = 0;
  if (trap.dmg)         dealt = ctx.applyDamage(gs, player, trap.dmg, `กับดัก "${trap.name}"`);
  if (trap.poison)      ctx.addStatus(player, "poison", trap.poison, 1);
  if (trap.burn)        ctx.addStatus(player, "burn", trap.burn, 1);
  if (trap.lock)        ctx.addStatus(player, "lock", trap.lock, 0);
  if (trap.freeze)      ctx.addStatus(player, "freeze", trap.freeze, 0);
  if (trap.blind)       ctx.addStatus(player, "blind", trap.blind, 0);
  if (trap.armor_break) ctx.addStatus(player, "armor_break", trap.armor_break, trap.armor_break);
  ctx.pushLog(gs, `🪤 ${player.name} เหยียบกับดัก "${trap.name}"! ${dealt ? `-${dealt} HP` : ""}`, "dmg");
  cell.trap = null;
  if (player.hp <= 0) ctx.killPlayer(gs, player);
  return { ok: true, dealt };
}
