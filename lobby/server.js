import http from "http";
import { WebSocketServer } from "ws";
import { parse } from "url";
import {
  useMagic, equipWeapon, placeTrap, triggerTrap, isGearActive,
} from "./src/game/utils/cardEngine.js";
import { CHARACTERS } from "./src/game/constants/characters.js";
import { rooms, clients } from "./src/game/server/state.js";
import { makeUid } from "./src/game/server/util.js";
import { getReachableCostMap, hexDistanceServer } from "./src/game/server/hex.js";
import { MAP_SIZES, sanitizeMapConfig } from "./src/game/server/mapConfig.js";
import { MAX_CARDS_PER_TURN } from "./src/game/server/constants.js";
import {
  send, redactRoomFor, redactGameStateFor,
  broadcastGameState, broadcast, broadcastRoomList,
} from "./src/game/server/net.js";
import {
  setActiveGS, recomputeStats, applyDamage, addStatus, hasStatus, consumeDodge,
  killPlayer, pushLog, giveCard, enforceHandLimit, resolveAttack,
  beginTurn, advancePointer, onPhaseAdvance, bossTurn,
  checkQuestProgress, applyZoneEffectServer, applyRandomZoneEvent,
  startAttackCard, resolveAttackCard, createInitialGameState, resolveTraitorOffer,
  CARD_CTX,
} from "./src/game/server/engine.js";

const PORT = process.env.PORT || 3001;

// Game engine (cards/combat/status/turnflow/events/mapgen) → server/engine.js
// Tuning/pools/char data → server/constants.js · Net → server/net.js
// MAP CONFIG → server/mapConfig.js · State (rooms, clients) → server/state.js

// ─── Helpers ─────────────────────────────────────────────────────────────────
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "SOT-" + Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms[code]);
  return code;
}

// send → server/net.js

// ─── ชื่อผู้เล่นต้องไม่ซ้ำกันในห้องเดียวกัน ───────────────────────────────────
//   ตัวตนของ client ทั้งฝั่ง server (rolesReady/charReady) และฝั่ง client
//   (หา "ตัวเอง" ด้วยชื่อ) อิงกับชื่อ — ถ้าซ้ำจะสับสนบทบาท/ตัวละคร
//   จึงเติม " (2)", " (3)" ให้ชื่อที่ซ้ำตอนเข้าห้อง
function uniqueName(room, desired) {
  const base = (desired ?? "").toString().trim().slice(0, 16) || "ผู้เล่น";
  const taken = new Set((room?.players || []).map(p => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

// rnd, shuffle, makeUid → server/util.js
// REDACT (redactRoomFor, redactGameStateFor) + broadcast* → server/net.js

function assignRoles(count) {
  // ทรยศ (traitor) ไม่ถูกแจกตั้งแต่ต้น — เกิด dynamic เมื่อราชาตาย
  const pool = ["king"];
  const rebelCount = count >= 7 ? 3 : count >= 5 ? 2 : 1;
  for (let i = 0; i < rebelCount; i++) pool.push("rebel");
  while (pool.length < count) pool.push("commoner");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// CARDS POOL + NEG_STATUS → server/constants.js

// Game engine (cards/combat/status/turnflow/events/mapgen) -> server/engine.js

// ─── Game Action Handler ─────────────────────────────────────────────────────
function handleGameAction(ws, msg) {
  const info = clients.get(ws);
  if (!info?.code) return;
  const room = rooms[info.code];
  if (!room || !room.gameState) return;
  const gs = room.gameState;
  setActiveGS(gs);
  const { action, payload } = msg;

  // เลือกเควส — ทำได้ทุกเมื่อ (ไม่ต้องเป็นเทิร์นตัวเอง)
  if (action === "pick_quest") {
    const me = gs.players[info.playerIdx];
    if (!me || me.quest) return;
    const choice = (me.questChoices || []).find(q => q.id === payload?.questId);
    if (!choice) return send(ws, { type: "error", msg: "เควสไม่ถูกต้อง" });
    me.quest = { ...choice, progress: 0, done: false };
    me.questChoices = null;
    return broadcastGameState(info.code);
  }

  // ── ตอบโต้การโจมตี (หลบ/บล็อก) — ทำได้แม้ไม่ใช่เทิร์นตัวเอง ─────────────────
  if (action === "interrupt_respond") {
    const pi = gs.pendingInterrupt;
    if (!pi) return;
    const meIdx = info.playerIdx;
    const entry = pi.entries.find(e => e.id === meIdx && !e.resolved);
    if (!entry) return send(ws, { type: "error", msg: "คุณไม่มีการตอบโต้ที่ต้องทำ" });
    const meP = gs.players[meIdx];
    const respUid = payload?.cardUid;
    if (respUid) {
      const ci = meP.hand.findIndex(c => c.uid === respUid);
      const rc = meP.hand[ci];
      const isDodge = rc && rc.id === "wind_dodge" && entry.canDodge;
      const isBlock = rc && rc.id === "mana_bolt" && entry.canBlock;
      if (ci < 0 || (!isDodge && !isBlock)) return send(ws, { type: "error", msg: "การ์ดตอบโต้ไม่ถูกต้อง" });
      meP.hand.splice(ci, 1); gs._discard.push(rc); enforceHandLimit(meP);
      entry.action = isBlock ? "block" : "dodge"; entry.resolved = true;
      pushLog(gs, `🛡️ ${meP.name} ${isBlock ? "บล็อกด้วยพลังเวทย์" : "หลบด้วยลมเวทย์"}!`, "event");
    } else {
      entry.action = "hit"; entry.resolved = true;
      pushLog(gs, `💢 ${meP.name} เลือกรับการโจมตี`, "event");
    }
    if (pi.entries.every(e => e.resolved)) {
      if (gs._interruptTimer) { clearTimeout(gs._interruptTimer); gs._interruptTimer = null; }
      const caster = gs.players[pi.casterId];
      const tc = pi.targetCell ? gs.cells.find(c => c.col === pi.targetCell.col && c.row === pi.targetCell.row) : null;
      resolveAttackCard(gs, info.code, caster, pi.card, { targetCell: tc }, pi.entries);
    } else {
      broadcastGameState(info.code);
    }
    return;
  }

  // ระหว่างรอตอบโต้การโจมตี → บล็อกแอกชันอื่นทั้งหมด
  if (gs.pendingInterrupt) return send(ws, { type: "error", msg: "⏳ รอการตอบโต้การโจมตีให้เสร็จก่อน" });

  if (gs.currentTurn !== info.playerIdx) return send(ws, { type: "error", msg: "ไม่ใช่เทิร์นของคุณ" });
  const cp = gs.players[gs.currentTurn];
  if (!cp || !cp.alive) return;

  switch (action) {
    // ── เดิน ───────────────────────────────────────────────────
    case "move": {
      const moveLeft = gs.actionsDone.moveLeft ?? 0;
      if (moveLeft <= 0) return send(ws, { type: "error", msg: "ไม่มีระยะเดินเหลือ / ถูกล็อกในเทิร์นนี้" });
      const { col, row } = payload;
      // หักจาก "งบเดินที่เหลือ" — เดินเป็นช่วงๆ ได้ตราบใดที่งบยังเหลือ
      const costMap = getReachableCostMap(cp.col, cp.row, moveLeft, gs.cells);
      const stepCost = costMap.get(`${col},${row}`);
      if (stepCost === undefined) return send(ws, { type: "error", msg: `เดินไป (${col},${row}) ไม่ได้ — ไกลเกินงบเดินที่เหลือ` });
      const targetCell = gs.cells.find(c => c.col === col && c.row === row);
      if (!targetCell) return;

      cp.col = col; cp.row = row;
      gs.actionsDone.moveLeft = moveLeft - stepCost;
      gs.actionsDone.moved = true;
      // เดิน → ล้างการชาร์จความเร็ว (SPD กลับค่าเริ่มต้น) + จดว่าเทิร์นนี้ได้เดิน
      cp._movedSinceTurn = true;
      if (cp._spdCharge) cp._spdCharge = 0;
      // passive: ตาเหยี่ยว (archer) หมดเมื่อเดิน
      cp._hawkEyeActive = false;
      recomputeStats(cp);
      // passive: นักสำรวจ (zhenghe) ทอง +1 พิเศษทุกครั้งที่เดินเข้า zone
      if (cp.charId === "zhenghe" && targetCell.specialZone) {
        cp.gold += 1;
        pushLog(gs, `⛵ ${cp.name} นักสำรวจ: ทอง+1 พิเศษ`, "event");
      }
      pushLog(gs, `🚶 ${cp.name} → (${col},${row})`, "");

      // king skill: shadow_hunt / iron_fortress ข้ามผลกระทบ zone
      if (!cp._skipZoneEffect) {
        const hpBefore = cp.hp;
        applyZoneEffectServer(cp, targetCell, gs);
        // passive: พรแสงสว่าง (cleric) / รู้จักสมุนไพร (herbalist) — bonus +1 HP เมื่อ zone รักษา
        const healed = cp.hp - hpBefore;
        if (healed > 0 && (cp.charId === "cleric" || cp.charId === "herbalist")) {
          cp.hp = Math.min(cp.maxHp, cp.hp + 1);
          pushLog(gs, `✨ ${cp.name} passive: HP+1 พิเศษจากสมุนไพร`, "heal");
        }
        applyRandomZoneEvent(cp, targetCell, gs);
      } else {
        cp._skipZoneEffect = false;
        pushLog(gs, `🌑 ${cp.name} ข้ามผลกระทบ zone (สกิลราชา)`, "event");
      }
      checkQuestProgress(cp, targetCell, gs);

      // กับดัก — ใครก็ตามที่เดินเข้ามา (รวมเจ้าของ) โดนผลทั้งหมด แล้วกับดักหายไป
      if (targetCell.trap) {
        triggerTrap(gs, cp, targetCell, CARD_CTX);
      }
      broadcastGameState(info.code);
      break;
    }

    // ── โจมตี ──────────────────────────────────────────────────
    case "attack": {
      if (gs.actionsDone.attacked) return send(ws, { type: "error", msg: "โจมตีไปแล้วในเทิร์นนี้" });
      const { targetId } = payload;
      const defender = gs.players[targetId];
      if (!defender || !defender.alive) return send(ws, { type: "error", msg: "เป้าหมายไม่ถูกต้อง" });
      if (targetId === info.playerIdx) return;

      const dist = hexDistanceServer(cp.col, cp.row, defender.col, defender.row);
      if (dist > cp.range) {
        return send(ws, { type: "error", msg: cp.range === 0
          ? `ระยะปกติตีได้แค่ช่องเดียวกัน — ต้องสวมอุปกรณ์ระยะไกล (ห่าง ${dist})`
          : `ระยะไกลเกินไป (${dist} > ${cp.range})` });
      }

      // หอกเขี้ยวมังกรดำ (pierce_all) — คูลดาวน์ "ใช้แล้วพัก"
      const pierceGear = (cp.equipment || []).find(e => e.effect === "pierce_all" && isGearActive(cp, e, gs));
      if (pierceGear) {
        cp._cooldowns = cp._cooldowns || {};
        if ((cp._cooldowns[pierceGear.id] || 0) > 0)
          return send(ws, { type: "error", msg: `"${pierceGear.name}" กำลังพัก (อีก ${cp._cooldowns[pierceGear.id]} เทิร์น)` });
      }

      // passive: ซ่อนตัว (assassin) — โจมตีครั้งแรกข้ามเกราะ
      const stealthActive = cp.charId === "assassin" && !gs.actionsDone._firstAttacked;
      if (stealthActive) {
        const origDef = defender.def;
        defender.def = 0;
        var res = resolveAttack(cp, defender, gs);
        defender.def = origDef;
        recomputeStats(defender, gs);
      } else {
        var res = resolveAttack(cp, defender, gs);
      }
      gs.actionsDone.attacked = true;
      gs.actionsDone._firstAttacked = true;
      if (pierceGear) { cp._cooldowns[pierceGear.id] = pierceGear.cooldown || 1; }
      // โจมตี → ล้างการชาร์จความเร็ว (SPD กลับค่าเริ่มต้นหลังใช้ระยะที่ชาร์จไว้)
      if (cp._spdCharge) { cp._spdCharge = 0; recomputeStats(cp, gs); }

      // passive: ล่วงรู้ (oracle) — 25% หลบอัตโนมัติ
      if (res.hit && defender.charId === "oracle" && Math.random() < 0.25) {
        pushLog(gs, `🔮 ${defender.name} ล่วงรู้! หลบอัตโนมัติ!`, "event");
        res = { ...res, hit: false, dmg: 0 };
      }
      // ลมเวทย์หลบภัย (dodge_charge) — หลบการโจมตีอัตโนมัติ
      if (res.hit && consumeDodge(gs, defender)) {
        pushLog(gs, `🌬️ ${defender.name} ใช้ลมเวทย์หลบภัย หลบการโจมตี!`, "event");
        res = { ...res, hit: false, dmg: 0 };
      }

      if (!res.hit) {
        pushLog(gs, `🛡️ ${defender.name} หลบหลีก! (โจมตี🎲${res.atkRoll} vs หลบ${res.dodgeRoll})`, "event");
      } else {
        const el = res.element || "physical";
        let dealt = applyDamage(gs, defender, res.dmg, "โจมตี", el, cp);
        // ฟันสองครั้ง: double(ทอย6) · มีดกรงเล็บแมวป่า(double_hit -1) · ดาบคู่แฝด(twin)
        if (res.doubled) { dealt += applyDamage(gs, defender, res.dmg, "ฟันซ้ำ", el, cp); pushLog(gs, `⚔️✕2 ${cp.name} ฟันซ้ำ!`, "dmg"); }
        if (res.doubleHit) { dealt += applyDamage(gs, defender, Math.max(1, res.dmg - 1), "กรงเล็บคู่", el, cp); pushLog(gs, `🐾✕2 ${cp.name} ตะปบสองครั้ง!`, "dmg"); }
        if (res.twinStrike) { dealt += applyDamage(gs, defender, res.dmg, "ดาบคู่", el, cp); pushLog(gs, `⚔️⚔️ ${cp.name} ฟันดาบคู่พร้อมกัน!`, "dmg"); }
        pushLog(gs, `⚔️ ${cp.name} → ${defender.name}: ${dealt} ดาเมจ (🎲${res.atkRoll} vs หลบ${res.dodgeRoll})${res.crit ? " ✨คริต!" : ""}`, "dmg");

        // เอฟเฟกต์อาวุธที่สวมใส่ (ตอนตีโดน) — ใช้ชุด effect ที่ "ทำงานอยู่" เท่านั้น
        const fx = new Set(res.fxList || []);
        if (fx.has("burn"))       { addStatus(defender, "burn", 2, 1, gs); pushLog(gs, `🔥 ${defender.name} ติดไฟไหม้!`, "dmg"); }
        if (fx.has("freeze"))     { addStatus(defender, "freeze", 1, 0, gs); pushLog(gs, `❄️ ${defender.name} ถูกแช่แข็ง!`, "event"); }
        if (fx.has("poison_hit")) { addStatus(defender, "poison", 2, 1, gs); pushLog(gs, `☠️ ${defender.name} ติดพิษ!`, "dmg"); }
        if (fx.has("fist_stun") && Math.random() < 0.5) { addStatus(defender, "stun", 1, 0, gs); pushLog(gs, `🥊 ${defender.name} ถูกชกจนมึน!`, "event"); }
        if (fx.has("magic_lifesteal") && dealt > 0) { /* เฉพาะเวทย์ — จัดการใน cardEngine */ }
        // หอกสามแฉก (trident) ใกล้น้ำ — ฟาดเพิ่มอีก 2 เป้ารอบเป้าหมาย
        if (fx.has("trident")) {
          let extra = 0;
          for (const o of gs.players) {
            if (extra >= 2) break;
            if (!o.alive || o.id === cp.id || o.id === defender.id) continue;
            if (hexDistanceServer(defender.col, defender.row, o.col, o.row) <= 1) {
              const sd = applyDamage(gs, o, Math.max(1, res.dmg), "หอกสามแฉก", el, cp);
              if (sd > 0) pushLog(gs, `🔱 หอกสามแฉกแทง ${o.name} -${sd}`, "dmg");
              if (o.hp <= 0) killPlayer(gs, o);
              extra++;
            }
          }
        }
        // เกราะ/โล่สะท้อน (ฝ่ายตั้งรับ): reflect / spike
        for (const e of (defender.equipment || [])) {
          if (!isGearActive(defender, e, gs)) continue;
          if (e.effect === "reflect" || e.effect === "spike") {
            const back = e.val || 1;
            const rd = applyDamage(gs, cp, back, e.effect === "spike" ? "หนามสะท้อน" : "โล่สะท้อน", "physical", defender);
            if (rd > 0) pushLog(gs, `🔰 ${e.name} สะท้อน ${rd} ใส่ ${cp.name}!`, "dmg");
          }
          // โล่อกสิงห์ทอง (block_stun) — 30% ศัตรูเสียเทิร์น
          if (e.effect === "block_stun" && Math.random() < (e.val || 30) / 100) { addStatus(cp, "stun", 1, 0, gs); pushLog(gs, `🦁 ${e.name} ทำให้ ${cp.name} สะดุ้งเสียเทิร์น!`, "event"); }
        }
        if (defender.hp <= 0) killPlayer(gs, defender);
        if (cp.hp <= 0) killPlayer(gs, cp);

        // passive: สวนกลับ (swordmaster) — 30% ตีสวน melee หลังโดนโจมตี
        if (!gs.gameOver && defender.alive && defender.charId === "swordmaster" && cp.range <= 1 && Math.random() < 0.3) {
          const cRes = resolveAttack(defender, cp, gs);
          if (cRes.hit) {
            const cDmg = applyDamage(gs, cp, cRes.dmg, "สวนกลับ", cRes.element, defender);
            pushLog(gs, `🔱 ${defender.name} สวนกลับ! ${cp.name} -${cDmg} (🎲${cRes.atkRoll})`, "dmg");
            if (cp.hp <= 0) killPlayer(gs, cp);
          } else {
            pushLog(gs, `🔱 ${defender.name} พยายามสวนกลับแต่พลาด`, "event");
          }
        }
      }
      broadcastGameState(info.code, { diceRoll: res.atkRoll });
      break;
    }

    // ── ใช้การ์ด — route ผ่าน cardEngine (single source of truth) ───────────
    case "use_card": {
      if ((gs.actionsDone.cardsPlayed || 0) >= MAX_CARDS_PER_TURN)
        return send(ws, { type: "error", msg: `ใช้การ์ดครบ ${MAX_CARDS_PER_TURN} ใบในเทิร์นนี้แล้ว` });
      if (cp.pendingDiscard > 0) return send(ws, { type: "error", msg: "ต้องเลือกทิ้งการ์ดที่เกินมือก่อน" });
      const { cardUid, targetCol, targetRow } = payload;
      const cardIdx = cp.hand.findIndex(c => c.uid === cardUid);
      if (cardIdx < 0) return send(ws, { type: "error", msg: "ไม่พบการ์ดนี้" });
      const card = cp.hand[cardIdx];
      const hasTarget = targetCol !== undefined && targetRow !== undefined;
      const targetPlayer = hasTarget
        ? gs.players.find(p => p.alive && p.col === targetCol && p.row === targetRow) : null;
      const targetCell = hasTarget
        ? gs.cells.find(c => c.col === targetCol && c.row === targetRow) : null;

      // คืนดาวหางพุ่งผ่าน (free_magic) — เวทย์ใช้ฟรีไม่เสียมานา
      const effCard = (card.type === "magic" && hasStatus(cp, "free_magic")) ? { ...card, cost: 0 } : card;

      // เวทย์ "โจมตี" ที่หลบ/บล็อกได้ → เข้าระบบ interrupt (จัดการ commit เอง)
      if (card.type === "magic" && card.kind === "attack" && (card.dodgeable || card.blockable)) {
        return startAttackCard(gs, info.code, ws, cp, effCard, cardIdx, { targetPlayer, targetCell });
      }

      let result;
      if (card.type === "magic") {
        result = useMagic(gs, cp, effCard, CARD_CTX, { targetPlayer, targetCell });
        if (result?.teleportedTo) checkQuestProgress(cp, result.teleportedTo, gs);
      } else if (card.type === "weapon") {
        result = equipWeapon(gs, cp, card, CARD_CTX);
      } else if (card.type === "trap") {
        if (!targetCell) return send(ws, { type: "error", msg: "เลือกช่องวางกับดัก" });
        // วางได้เฉพาะช่องที่ยืน + รอบตัวระยะ 1 ช่อง
        if (hexDistanceServer(cp.col, cp.row, targetCell.col, targetCell.row) > 1)
          return send(ws, { type: "error", msg: "วางกับดักได้เฉพาะช่องที่ยืนหรือรอบตัว 1 ช่อง" });
        if (targetCell.terrain === "water")
          return send(ws, { type: "error", msg: "วางกับดักบนน้ำไม่ได้" });
        if (targetCell.trap)
          return send(ws, { type: "error", msg: "ช่องนี้มีกับดักอยู่แล้ว" });
        result = placeTrap(gs, targetCell, card, info.playerIdx, CARD_CTX);
      } else {
        return send(ws, { type: "error", msg: "ชนิดการ์ดไม่ถูกต้อง" });
      }

      // เอนจินปฏิเสธ (มานาไม่พอ / เป้าหมายผิด ฯลฯ) → ไม่ทิ้งการ์ด ไม่กินแอกชัน
      if (result?.error) return send(ws, { type: "error", msg: result.error });

      cp.hand.splice(cardIdx, 1);
      enforceHandLimit(cp);
      gs.actionsDone.cardsPlayed = (gs.actionsDone.cardsPlayed || 0) + 1;
      broadcastGameState(info.code);
      break;
    }

    // ── ทิ้งการ์ดที่เกินลิมิตมือ (ผู้เล่นเลือกเอง ไม่สุ่ม) ───────────────────
    case "discard_card": {
      if ((cp.pendingDiscard || 0) <= 0) return send(ws, { type: "error", msg: "ยังไม่ต้องทิ้งการ์ด" });
      const idx = cp.hand.findIndex(c => c.uid === payload?.cardUid);
      if (idx < 0) return send(ws, { type: "error", msg: "ไม่พบการ์ดนี้" });
      const [discarded] = cp.hand.splice(idx, 1);
      enforceHandLimit(cp);
      pushLog(gs, `🗑️ ${cp.name} ทิ้งการ์ด "${discarded.name}"${cp.pendingDiscard > 0 ? ` (เหลือต้องทิ้งอีก ${cp.pendingDiscard})` : ""}`, "");
      broadcastGameState(info.code);
      break;
    }

    // ── ซื้อของ ────────────────────────────────────────────────
    case "buy_item": {
      const { shopKey, itemUid } = payload;
      const shopCell = gs.cells.find(c => c.key === shopKey);
      if (!shopCell?.shopItems) return send(ws, { type: "error", msg: "ร้านค้าไม่พบ" });
      if (hexDistanceServer(cp.col, cp.row, shopCell.col, shopCell.row) > 0)
        return send(ws, { type: "error", msg: "ต้องยืนในร้านจึงจะซื้อได้" });
      const itemIdx = shopCell.shopItems.findIndex(i => i.uid === itemUid);
      if (itemIdx < 0) return send(ws, { type: "error", msg: "สินค้าหมดแล้ว" });
      const item = shopCell.shopItems[itemIdx];
      if (cp.gold < item.price) return send(ws, { type: "error", msg: `ทองไม่พอ (ต้องการ ${item.price})` });
      cp.gold -= item.price;
      const newCard = { ...item, uid: makeUid() };
      delete newCard.price;
      giveCard(cp, newCard, gs);
      shopCell.shopItems.splice(itemIdx, 1);
      pushLog(gs, `🛒 ${cp.name} ซื้อ "${item.name}" ราคา ${item.price} ทอง`, "event");
      broadcastGameState(info.code);
      break;
    }

    // ── จบเทิร์น ────────────────────────────────────────────────
    case "end_turn": {
      if (cp.pendingDiscard > 0) return send(ws, { type: "error", msg: `ต้องเลือกทิ้งการ์ดให้เหลือในลิมิตก่อน (อีก ${cp.pendingDiscard} ใบ)` });
      gs.phaseStep += 1;
      const aliveCount = gs.players.filter(p => p.alive).length;

      advancePointer(gs);

      if (gs.phaseStep >= aliveCount) {
        gs.phaseStep = 0;
        onPhaseAdvance(gs);
      }

      // โหมดบอส — บอสโจมตีทุกเทิร์น
      if (gs.bossMode && !gs.gameOver) bossTurn(gs);

      if (!gs.gameOver) {
        beginTurn(gs);
        const cur = gs.players[gs.currentTurn];
        pushLog(gs, `🔔 เทิร์นของ ${cur?.name} (เฟส ${gs.phase}${gs.bossMode ? " · โหมดบอส" : ""})`, "turn");
      }

      gs.totalTurns += 1;
      broadcastGameState(info.code);
      break;
    }

    // ── สกิล active ────────────────────────────────────────────────────────
    case "use_skill": {
      const charDef = CHARACTERS[cp.charId];
      if (!charDef) return send(ws, { type: "error", msg: "ไม่พบตัวละครของคุณ" });
      const skill = charDef.active;
      if (cp.mana < skill.cost) return send(ws, { type: "error", msg: `มานาไม่พอ (ต้องการ ${skill.cost}, มี ${cp.mana})` });

      cp.mana -= skill.cost;
      const { targetId, targetCol, targetRow } = payload || {};
      const skillTarget = targetId !== undefined ? gs.players[targetId] : null;
      let skillUsed = false;

      switch (skill.id) {
        // ─── ฟันสองครั้ง (sunwu) ───────────────────────────────────────────
        case "double_strike": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          for (let hit = 0; hit < 2; hit++) {
            const r = resolveAttack(cp, skillTarget);
            if (r.hit) {
              const d = applyDamage(gs, skillTarget, r.dmg, "ฟันสองครั้ง");
              pushLog(gs, `⚔️ ${cp.name} ฟันสองครั้ง ครั้งที่ ${hit+1}: ${d} ดาเมจ`, "dmg");
            } else pushLog(gs, `⚔️ ฟันสองครั้งครั้งที่ ${hit+1}: หลบ`, "event");
          }
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── เปิดเส้นทาง (zhenghe) ──────────────────────────────────────────
        case "open_route":
          gs.actionsDone.moveLeft = (gs.actionsDone.moveLeft || 0) + 3;
          pushLog(gs, `⛵ ${cp.name} เปิดเส้นทาง! งบเดิน +3 เทิร์นนี้`, "event");
          skillUsed = true; break;
        // ─── พายุน้ำแข็ง (icemage) ──────────────────────────────────────────
        case "blizzard": {
          let cnt = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 2) {
              const d = applyDamage(gs, p, 2, "พายุน้ำแข็ง");
              if (d > 0) { pushLog(gs, `❄️ ${p.name} โดนพายุน้ำแข็ง -${d}`, "dmg"); cnt++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `❄️ ${cp.name} ปล่อยพายุน้ำแข็ง โดน ${cnt} คน`, "event");
          skillUsed = true; break;
        }
        // ─── ฝนธนู (archer) ─────────────────────────────────────────────────
        case "arrow_rain": {
          let cnt2 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 3) {
              const d = applyDamage(gs, p, 1, "ฝนธนู");
              if (d > 0) { pushLog(gs, `🏹 ${p.name} โดนฝนธนู -${d}`, "dmg"); cnt2++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🏹 ${cp.name} ปล่อยฝนธนู โดน ${cnt2} คน`, "event");
          skillUsed = true; break;
        }
        // ─── รักษาตัวเอง (cleric) ────────────────────────────────────────────
        case "self_heal": {
          const before = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 4);
          pushLog(gs, `✨ ${cp.name} รักษาตัวเอง HP+${cp.hp - before}`, "heal");
          skillUsed = true; break;
        }
        // ─── แทงหลัง (assassin) ──────────────────────────────────────────────
        case "backstab": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist2 = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist2 > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const dmg = cp.atk + 3; // ข้ามเกราะ
          const dealt = applyDamage(gs, skillTarget, dmg, "แทงหลัง");
          pushLog(gs, `🗡️ ${cp.name} แทงหลัง ${skillTarget.name} -${dealt} (ข้ามเกราะ)`, "dmg");
          // passive: วิญญาณไฟ ถ้าใช้ skillId "backstab" ไม่ติด burn (เฉพาะ firemage)
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── ลมดาบ (swordmaster) ─────────────────────────────────────────────
        case "sword_wind": {
          let cnt3 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) === 1) {
              const d = applyDamage(gs, p, cp.atk, "ลมดาบ");
              if (d > 0) { pushLog(gs, `🔱 ${p.name} โดนลมดาบ -${d}`, "dmg"); cnt3++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🔱 ${cp.name} ปล่อยลมดาบ โดน ${cnt3} คน`, "event");
          skillUsed = true; break;
        }
        // ─── ฟาดหนัก (guardian) ──────────────────────────────────────────────
        case "heavy_blow": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const dist3 = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (dist3 > (cp.range || 1)) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const d3 = applyDamage(gs, skillTarget, 4, "ฟาดหนัก");
          addStatus(skillTarget, "lock", 1, 0);
          pushLog(gs, `🛡️ ${cp.name} ฟาดหนัก! ${skillTarget.name} -${d3} ถูกล็อค 1 เทิร์น`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        // ─── ลูกไฟ (firemage) ────────────────────────────────────────────────
        case "fireball": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const d4 = applyDamage(gs, skillTarget, 3, "ลูกไฟ");
          // passive: วิญญาณไฟ → ติด burn
          addStatus(skillTarget, "burn", 2, 1);
          pushLog(gs, `🔥 ${cp.name} ลูกไฟ! ${skillTarget.name} -${d4} + ไฟไหม้`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          // splash รอบเป้า 1 ช่อง
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id || p.id === skillTarget.id) return;
            if (hexDistanceServer(skillTarget.col, skillTarget.row, p.col, p.row) === 1) {
              const d5 = applyDamage(gs, p, 1, "ลูกไฟสะเทือน");
              if (d5 > 0) { addStatus(p, "burn", 1, 1); pushLog(gs, `🔥 ${p.name} โดนไฟสะเทือน -${d5}`, "dmg"); }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          skillUsed = true; break;
        }
        // ─── ยาอายุวัฒนะ (herbalist) ─────────────────────────────────────────
        case "elixir": {
          const hb4 = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 3);
          // ล้าง poison/burn/blind/freeze
          cp.statusEffects = (cp.statusEffects || []).filter(s => !["poison","burn","blind","freeze"].includes(s.type));
          recomputeStats(cp);
          pushLog(gs, `🌿 ${cp.name} ดื่มยาอายุวัฒนะ HP+${cp.hp - hb4} ล้างสถานะลบ`, "heal");
          skillUsed = true; break;
        }
        // ─── ตะโกนสั่งการ (general) — AOE 2 รอบตัว ───────────────────────────
        case "shout_command": {
          let cnt4 = 0;
          gs.players.forEach(p => {
            if (!p.alive || p.id === cp.id) return;
            if (hexDistanceServer(cp.col, cp.row, p.col, p.row) <= 2) {
              const d = applyDamage(gs, p, 2, "ตะโกนสั่งการ");
              if (d > 0) { pushLog(gs, `🪖 ${p.name} โดนตะโกนสั่งการ -${d}`, "dmg"); cnt4++; }
              if (p.hp <= 0) killPlayer(gs, p);
            }
          });
          pushLog(gs, `🪖 ${cp.name} ตะโกนสั่งการ! โดน ${cnt4} คน`, "event");
          skillUsed = true; break;
        }
        // ─── สายฟ้าแล่บ (oracle) — เป้าหมาย dmg 3 + freeze ───────────────────
        case "lightning_bolt": {
          if (!skillTarget?.alive) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เลือกเป้าหมายที่มีชีวิต" }); }
          const distLB = hexDistanceServer(cp.col, cp.row, skillTarget.col, skillTarget.row);
          if (distLB > cp.range) { cp.mana += skill.cost; return send(ws, { type: "error", msg: "เป้าหมายอยู่ไกลเกินไป" }); }
          const dLB = applyDamage(gs, skillTarget, 3, "สายฟ้าแล่บ");
          addStatus(skillTarget, "freeze", 1, 0);
          pushLog(gs, `🔮 ${cp.name} สายฟ้าแล่บ! ${skillTarget.name} -${dLB} + แช่แข็ง 1 เทิร์น`, "dmg");
          if (skillTarget.hp <= 0) killPlayer(gs, skillTarget);
          skillUsed = true; break;
        }
        default:
          cp.mana += skill.cost;
          return send(ws, { type: "error", msg: "สกิลยังไม่ได้ implement" });
      }

      if (skillUsed) broadcastGameState(info.code);
      break;
    }

    // ── สกิลราชา (use_king_skill) ─────────────────────────────────────────
    case "use_king_skill": {
      if (cp.role !== "king") return send(ws, { type: "error", msg: "เฉพาะราชาเท่านั้น" });
      const kChar = CHARACTERS[cp.charId];
      if (!kChar) return send(ws, { type: "error", msg: "ไม่พบสกิลราชา" });
      const ks = kChar.kingSkill;

      // ─── ทำนายชะตา (oracle) — เลือกดูบทบาท 1 คน · ใช้ได้ครั้งเดียวตลอดเกม ───
      if (ks.id === "fate_read") {
        if (cp._fateReadUsed) return send(ws, { type: "error", msg: "ทำนายชะตาใช้ได้ครั้งเดียวตลอดทั้งเกม" });
        const target = gs.players.find(p => p.id === payload?.targetId);
        if (!target || !target.alive) return send(ws, { type: "error", msg: "เลือกผู้เล่นที่จะทำนาย" });
        if (target.id === cp.id) return send(ws, { type: "error", msg: "ทำนายตัวเองไม่ได้" });
        cp._fateReadUsed = true;
        target._privateRevealTo = target._privateRevealTo || [];
        if (!target._privateRevealTo.includes(cp.id)) target._privateRevealTo.push(cp.id);
        pushLog(gs, `👑 ${cp.name} ทำนายชะตา! (ล่วงรู้บทบาทของผู้เล่นหนึ่งคน — เฉพาะตน)`, "event");
        broadcastGameState(info.code);
        break;
      }

      if (cp._kingSkillUsedPhase === gs.phase) return send(ws, { type: "error", msg: "ใช้สกิลราชาได้ครั้งเดียวต่อเฟส" });
      cp._kingSkillUsedPhase = gs.phase;

      switch (ks.id) {
        case "drill_troops":
          gs.players.forEach(p => { if (p.alive) addStatus(p, "atk_up", 1, 1); });
          pushLog(gs, `👑 ${cp.name} ฝึกทัพ! ทุกคน ATK+1 เทิร์นนี้`, "event"); break;
        case "royal_envoy":
          gs.players.forEach(p => { if (p.alive) p._revealedByEnvoy = true; });
          pushLog(gs, `👑 ${cp.name} ส่งคณะทูต! เปิดตำแหน่งทุกคน`, "event"); break;
        case "winter":
          gs.players.forEach(p => { if (p.alive) p.mana = Math.max(0, p.mana - 2); });
          pushLog(gs, `👑 ${cp.name} ปล่อยฤดูหนาว! ทุกคนมานา-2`, "event"); break;
        case "fort_arrow":
          addStatus(cp, "atk_up", 1, 1);
          cp.range += 2; // bonus range เทิร์นนี้ (reset ใน beginTurn เพราะ recomputeStats)
          pushLog(gs, `👑 ${cp.name} ป้อมยิง! ระยะ+2 ATK+1 เทิร์นนี้`, "event"); break;
        case "royal_blessing":
          gs.players.forEach(p => {
            if (!p.alive) return;
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + 2);
            if (p.hp > before) pushLog(gs, `✨ ${p.name} ได้พรแห่งราชัน HP+${p.hp-before}`, "heal");
          }); break;
        case "shadow_hunt":
          cp._skipZoneEffect = true;
          pushLog(gs, `👑 ${cp.name} ล่าเงา! ข้ามผลกระทบ zone เทิร์นนี้`, "event"); break;
        case "throne_sword":
          addStatus(cp, "atk_up", 1, 3);
          addStatus(cp, "def_up", 1, 1);
          pushLog(gs, `👑 ${cp.name} ดาบแห่งบัลลังก์! ATK+3 DEF+1 เทิร์นนี้`, "event"); break;
        case "iron_fortress":
          addStatus(cp, "def_up", 1, 4);
          cp._skipZoneEffect = true;
          pushLog(gs, `👑 ${cp.name} ป้อมเหล็ก! DEF+4 ข้ามผลกระทบ zone`, "event"); break;
        case "fire_rain":
          gs.players.forEach(p => {
            if (!p.alive) return;
            const d = applyDamage(gs, p, 2, "ฝนไฟ");
            if (d > 0) { pushLog(gs, `🔥 ${p.name} โดนฝนไฟ -${d}`, "dmg"); }
            if (p.hp <= 0) killPlayer(gs, p);
          }); break;
        case "immortal_potion": {
          const hb = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 5);
          pushLog(gs, `👑 ${cp.name} ดื่มยาอมตะ! HP+${cp.hp-hb}`, "heal"); break;
        }
        // ─── สัญญาเลือด (general) ─────────────────────────────────────────────
        case "battle_pact": {
          addStatus(cp, "atk_up", 1, 2);
          addStatus(cp, "def_up", 1, 1);
          const hbp = cp.hp;
          cp.hp = Math.min(cp.maxHp, cp.hp + 2);
          pushLog(gs, `👑 ${cp.name} สัญญาเลือด! ATK+2 DEF+1 HP+${cp.hp-hbp}`, "event"); break;
        }
        // ─── ทำนายชะตา (oracle) — เปิดบทบาททุกคน "เฉพาะผู้ทำนายเห็นเท่านั้น" ──
        case "fate_read":
          gs.players.forEach(p => {
            if (p.alive && p.id !== cp.id) {
              p._privateRevealTo = p._privateRevealTo || [];
              if (!p._privateRevealTo.includes(cp.id)) p._privateRevealTo.push(cp.id);
            }
          });
          pushLog(gs, `👑 ${cp.name} ทำนายชะตา! (มองเห็นบทบาทของทุกคน — เฉพาะตน)`, "event"); break;
        default:
          cp._kingSkillUsedPhase = -1;
          return send(ws, { type: "error", msg: "สกิลราชายังไม่ได้ implement" });
      }
      recomputeStats(cp);
      broadcastGameState(info.code);
      break;
    }

    default:
      send(ws, { type: "error", msg: `ไม่รู้จัก action: ${action}` });
  }
}

// ─── Handle Leave ─────────────────────────────────────────────────────────────
function handleLeave(ws) {
  const info = clients.get(ws);
  if (!info || !info.code) { clients.delete(ws); return; }
  const { code, playerIdx } = info;
  clients.delete(ws);
  const room = rooms[code];
  if (!room) return;

  // ── เกมเริ่มแล้ว → คงสล็อตผู้เล่นไว้ (รวมถึง host) ──────────────────────────
  //   เพื่อให้ "กลับเข้าห้องเดิม" (rejoin) ตอนรีเฟรช/เน็ตหลุดได้ — ไม่ลบ ไม่ปิดห้อง
  //   (ถ้าไม่กลับมาเลย ห้องจะถูกเก็บกวาดเองตอน cleanup 30 นาที)
  if (room.gameState) { broadcastRoomList(); return; }

  if (playerIdx === 0) {
    console.log(`[${code}] Host left lobby → closing room`);
    for (const [cws, cinfo] of clients) {
      if (cinfo.code === code) {
        send(cws, { type: "room_closed", reason: "host_left" });
        clients.set(cws, { code: null, playerIdx: -1 });
      }
    }
    delete rooms[code];
  } else {
    room.players = room.players.filter((_, i) => i !== playerIdx).map((p, i) => ({ ...p, idx: i }));
    for (const [, cinfo] of clients) {
      if (cinfo.code === code && cinfo.playerIdx > playerIdx) cinfo.playerIdx -= 1;
    }
    broadcast(code);
  }
  broadcastRoomList();
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const { pathname } = parse(req.url || "/");
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: Object.keys(rooms).length, clients: clients.size, uptime: Math.floor(process.uptime()) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>🏰 บัลลังก์เงา Server</title></head>
    <body style="font-family:monospace;background:#0d0b08;color:#c9a84c;padding:40px;text-align:center">
    <h1>🏰 บัลลังก์เงา — Game Server Online</h1>
    <p style="color:#e8d5b0">Rooms: ${Object.keys(rooms).length} | Clients: ${clients.size}</p>
    <p style="color:#4cc94c">✅ WebSocket รับที่ / และ /ws</p></body></html>`);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => { wss.emit("connection", ws, req); });
});

const PING_INTERVAL = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false; ws.ping();
  });
}, 25000);
wss.on("close", () => clearInterval(PING_INTERVAL));

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  clients.set(ws, { code: null, playerIdx: -1 });
  console.log(`[+] Client connected — total: ${wss.clients.size}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create_room") {
      const { playerName, maxPlayers, mode, visibility = "public", mapConfig } = msg;
      const code = genCode();
      const hostName = uniqueName(null, playerName); // trim/clamp + fallback ชื่อว่าง
      rooms[code] = {
        code, createdAt: Date.now(), status: "waiting",
        mode: mode || "standard",
        maxPlayers: Math.max(3, Math.min(8, maxPlayers || 4)),
        visibility, hostName,
        mapConfig: sanitizeMapConfig(mapConfig),
        players: [{ name: hostName, class: "", idx: 0, ready: false, host: true }],
        rolesReady: [], gameState: null,
      };
      clients.set(ws, { code, playerIdx: 0 });
      send(ws, { type: "joined", playerIdx: 0, room: rooms[code] });
      console.log(`[${code}] Created by "${playerName}" (${visibility})`);
      broadcastRoomList();
    }

    if (msg.type === "join_room") {
      const { code, playerName } = msg;
      const room = rooms[code];
      if (!room) return send(ws, { type: "error", msg: "ไม่พบห้อง " + code });
      if (room.status === "started") return send(ws, { type: "error", msg: "เกมเริ่มไปแล้ว" });
      if (room.players.length >= room.maxPlayers) return send(ws, { type: "error", msg: "ห้องเต็มแล้ว" });
      const idx = room.players.length;
      const name = uniqueName(room, playerName); // กันชื่อซ้ำในห้อง → ตัวตนไม่สับสน
      room.players.push({ name, class: "", idx, ready: false, host: false });
      clients.set(ws, { code, playerIdx: idx });
      send(ws, { type: "joined", playerIdx: idx, room });
      broadcast(code);
      console.log(`[${code}] "${playerName}" joined (${idx})`);
      broadcastRoomList();
    }

    // ── REJOIN: กลับเข้าห้องเดิมหลังรีเฟรช/เน็ตหลุด (อิงชื่อ + รหัสห้องจาก localStorage) ──
    //   • ถ้ายังมีสล็อตชื่อนี้อยู่ → ผูก connection นี้กลับเข้าสล็อตเดิม (ได้ทั้งกลางเกม)
    //   • ถ้าหลุดไปแล้วและห้องยังอยู่ในล็อบบี้ → เพิ่มกลับเข้าห้อง
    //   • ถ้าห้องหาย/เกมเริ่มแล้วแต่ไม่มีสล็อต → rejoin_failed (client ล้าง session กลับหน้าแรก)
    if (msg.type === "rejoin_room") {
      const { code, playerName } = msg;
      const room = rooms[code];
      if (!room) return send(ws, { type: "rejoin_failed", reason: "no_room" });
      let idx = room.players.findIndex(p => p.name === playerName);
      if (idx < 0) {
        if (room.status === "started" || room.gameState)
          return send(ws, { type: "rejoin_failed", reason: "game_started" });
        if (room.players.length >= room.maxPlayers)
          return send(ws, { type: "rejoin_failed", reason: "full" });
        idx = room.players.length;
        room.players.push({ name: uniqueName(room, playerName), class: "", idx, ready: false, host: false });
      }
      clients.set(ws, { code, playerIdx: idx });
      send(ws, { type: "joined", playerIdx: idx, room: redactRoomFor(room, idx), rejoined: true });
      if (room.gameState) send(ws, { type: "game_state", gameState: redactGameStateFor(room.gameState, idx) });
      broadcast(code);
      broadcastRoomList();
      console.log(`[${code}] "${playerName}" rejoined (${idx})`);
    }

    if (msg.type === "pick_class" || msg.type === "pick_character") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      // เลือกตัวละครได้เฉพาะช่วง "เลือกตัวละคร" (หลังสุ่มบทบาทแล้ว)
      if (room.phase !== "charselect") return send(ws, { type: "error", msg: "ยังไม่ถึงขั้นเลือกตัวละคร" });
      const me = room.players[info.playerIdx];
      if (!me) return;
      const charId = msg.charId || msg.classId;
      const charReady = room.charReady || (room.charReady = []);
      // ── พระราชาต้อง "กดยืนยัน" ตัวละครก่อน คนอื่นจึงเลือกได้ ──
      const kingIdx = (room.roles || []).indexOf("king");
      const kingName = kingIdx >= 0 ? room.players[kingIdx]?.name : null;
      const kingConfirmed = kingName != null && charReady.includes(kingName);
      if (info.playerIdx !== kingIdx && !kingConfirmed)
        return send(ws, { type: "error", msg: "👑 รอพระราชายืนยันตัวละครก่อน" });
      // ล็อกเฉพาะตัวที่ "ถูกยืนยันแล้ว" — ใครยืนยันก่อนได้ตัวนั้นไป (ระหว่างยังไม่ยืนยัน เล็งซ้ำกันได้)
      const confirmedTaken = room.players.some(
        (p, i) => p && i !== info.playerIdx && (p.charId === charId) && charReady.includes(p.name)
      );
      if (confirmedTaken) return send(ws, { type: "error", msg: "ตัวละครนี้ถูกยืนยันไปแล้ว — เลือกตัวอื่น" });
      me.charId = charId;
      me.class = charId; // compat
      // เปลี่ยนตัวละคร → ยกเลิกการยืนยันเดิม
      room.charReady = charReady.filter(n => n !== me.name);
      broadcast(info.code);
    }

    // ── ยืนยันตัวละคร (ในขั้นเลือกตัวละคร) ──────────────────────────────────────
    if (msg.type === "confirm_character") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.phase !== "charselect") return;
      const me = room.players[info.playerIdx];
      if (!me || !me.charId) return send(ws, { type: "error", msg: "เลือกตัวละครก่อน" });
      room.charReady = room.charReady || [];
      // ── race: ถ้ามีคนยืนยันตัวละครเดียวกันไปก่อนแล้ว → ปฏิเสธ + ล้างตัวเลือกให้เลือกใหม่ ──
      const conflict = room.players.some(
        (p, i) => p && i !== info.playerIdx && p.charId === me.charId && room.charReady.includes(p.name)
      );
      if (conflict) {
        delete me.charId; me.class = "";
        room.charReady = room.charReady.filter(n => n !== me.name);
        broadcast(info.code);
        return send(ws, { type: "error", msg: "ช้าไป! ตัวละครนี้เพิ่งถูกยืนยัน — เลือกตัวใหม่" });
      }
      if (!room.charReady.includes(me.name)) room.charReady.push(me.name);
      broadcast(info.code);
      // ทุกคนเลือก + ยืนยันครบ → สร้าง gameState แล้วเข้าเกม
      const allPicked = room.players.every(p => !!p.charId);
      if (allPicked && room.charReady.length >= room.players.length) {
        room.phase = "playing";
        room.gameState = createInitialGameState(room);
        room.gameState._code = info.code; // ใช้ใน startTraitorOffer
        for (const [cws, cinfo] of clients) {
          if (cinfo.code === info.code && cws.readyState === 1) {
            const snapshot = redactGameStateFor(room.gameState, cinfo.playerIdx);
            cws.send(JSON.stringify({ type: "all_roles_ready", gameState: snapshot }));
          }
        }
        console.log(`[${info.code}] All characters confirmed → game starting`);
      }
    }

    if (msg.type === "toggle_ready") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room) return;
      const p = room.players[info.playerIdx];
      if (!p) return;
      // ล็อบบี้: กดพร้อมได้เลย (เลือกตัวละครย้ายไปหลังสุ่มบทบาท)
      p.ready = !p.ready;
      broadcast(info.code);
    }

    if (msg.type === "kick_player") {
      const info = clients.get(ws);
      if (!info?.code || info.playerIdx !== 0) return;
      const room = rooms[info.code];
      if (!room) return;
      const kickIdx = msg.playerIdx;
      for (const [cws, cinfo] of clients) {
        if (cinfo.code === info.code && cinfo.playerIdx === kickIdx) {
          send(cws, { type: "kicked" });
          clients.set(cws, { code: null, playerIdx: -1 });
          break;
        }
      }
      room.players = room.players.filter((_, i) => i !== kickIdx).map((p, i) => ({ ...p, idx: i }));
      for (const [, cinfo] of clients) {
        if (cinfo.code === info.code && cinfo.playerIdx > kickIdx) cinfo.playerIdx -= 1;
      }
      broadcast(info.code);
      broadcastRoomList();
    }

    if (msg.type === "start_game") {
      const info = clients.get(ws);
      if (!info?.code || info.playerIdx !== 0) return;
      const room = rooms[info.code];
      if (!room) return;
      if (room.players.length < 3) return send(ws, { type: "error", msg: "ต้องมีอย่างน้อย 3 คน" });
      const notReady = room.players.slice(1).filter(p => !p.ready);
      if (notReady.length > 0) return send(ws, { type: "error", msg: "รอทุกคนกดพร้อมก่อน" });
      // ── สุ่มบทบาทก่อน (ยังไม่สร้าง gameState — รอเลือกตัวละครหลังเปิดบทบาท) ──
      room.roles = assignRoles(room.players.length);
      room.status = "started";
      room.phase = "roles";
      room.startedAt = Date.now();
      room.rolesReady = [];
      room.charReady = [];
      // ล้างตัวละครที่อาจค้างจากรอบก่อน — เริ่มเลือกใหม่หลังเปิดบทบาท
      room.players.forEach(p => { delete p.charId; p.class = ""; });
      room.gameState = null;
      broadcast(info.code);
      broadcastRoomList();
      console.log(`[${info.code}] Roles assigned → role reveal phase`);
    }

    if (msg.type === "role_confirmed") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room || room.status !== "started") return;
      if (!room.rolesReady.includes(msg.playerName)) room.rolesReady.push(msg.playerName);
      // ทุกคนยืนยันบทบาท → เข้าสู่ขั้น "เลือกตัวละคร" (พระราชาเลือกก่อน)
      if (room.phase === "roles" && room.rolesReady.length >= room.players.length) {
        room.phase = "charselect";
        room.charReady = [];
        console.log(`[${info.code}] All roles confirmed → character select phase`);
      }
      broadcast(info.code);
    }

    if (msg.type === "traitor_response") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (!room?.gameState?.traitorOfferPending) return;
      const gs = room.gameState;
      if (info.playerIdx !== gs.traitorOfferTarget) return; // ไม่ใช่คนที่ได้รับ offer
      resolveTraitorOffer(gs, info.code, msg.accepted === true, info.playerIdx);
    }

    if (msg.type === "list_rooms") {
      const list = Object.values(rooms).filter(
        r => r.visibility === "public" && r.status !== "started" && Date.now() - r.createdAt < 30 * 60 * 1000
      );
      send(ws, { type: "room_list", rooms: list });
    }

    if (msg.type === "leave_room") {
      handleLeave(ws);
      clients.set(ws, { code: null, playerIdx: -1 });
    }

    if (msg.type === "game_action") handleGameAction(ws, msg);

    if (msg.type === "request_game_state") {
      const info = clients.get(ws);
      if (!info?.code) return;
      const room = rooms[info.code];
      if (room?.gameState) {
        const snapshot = redactGameStateFor(room.gameState, info.playerIdx);
        send(ws, { type: "game_state", gameState: snapshot });
      }
    }
  });

  ws.on("close", () => { handleLeave(ws); console.log(`[-] Client disconnected — total: ${wss.clients.size}`); });
  ws.on("error", (err) => console.error("WS error:", err.message));
});

// ─── Cleanup stale rooms ────────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [code, room] of Object.entries(rooms)) {
    if (room.createdAt < cutoff) { delete rooms[code]; cleaned++; }
  }
  if (cleaned) console.log(`Cleaned ${cleaned} stale room(s)`);
}, 5 * 60 * 1000);

// SOT_TEST=1 → import โมดูลเพื่อทดสอบฟังก์ชันโดยไม่เปิดพอร์ต/keep-alive
if (!process.env.SOT_TEST) {
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🏰 Shadow of Throne Server v5`);
  console.log(`   Port:      ${PORT}`);
  console.log(`   Features:  move=3, hand=HP-limit, dodge-dice, equipment-range, 8-phase, boss-mode, hidden-roles, fog, side-quests`);
  console.log(`   Health:    http://localhost:${PORT}/health\n`);
});
}

export { createInitialGameState, sanitizeMapConfig, MAP_SIZES };
// test seams (used by smoke.mjs; no effect on the running server)
export { handleGameAction, handleLeave, rooms, clients };

// ─── Keep-alive (กัน Render free tier หลับหลังไม่มีคนใช้ ~15 นาที) ───────────────
// Render ตั้ง RENDER_EXTERNAL_URL ให้อัตโนมัติ → self-ping /health ทุก 10 นาที
// ถือเป็น inbound traffic ทำให้ instance ไม่ spin down (เลี่ยง cold start ~12 วิ)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  const pingUrl = `${SELF_URL.replace(/\/$/, "")}/health`;
  setInterval(() => {
    fetch(pingUrl)
      .then((r) => console.log(`[keep-alive] ${r.status} ${pingUrl}`))
      .catch((e) => console.warn(`[keep-alive] failed: ${e.message}`));
  }, 10 * 60 * 1000);
  console.log(`   Keep-alive: self-ping ${pingUrl} ทุก 10 นาที`);
}
