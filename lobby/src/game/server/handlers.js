// ─── WebSocket game-action handlers ───────────────────────────────────────────
//   handleGameAction routes one in-game message (move/attack/use_card/skill/…);
//   handleLeave tears down a client's room slot on disconnect.
import {
  useMagic, equipWeapon, placeTrap, triggerTrap, isGearActive,
} from "../utils/cardEngine.js";
import { CHARACTERS } from "../constants/characters.js";
import { rooms, clients } from "./state.js";
import { makeUid } from "./util.js";
import { getReachableCostMap, getPath, hexDistanceServer } from "./hex.js";
import { MAX_CARDS_PER_TURN } from "./constants.js";
import { send, broadcast, broadcastGameState, broadcastRoomList } from "./net.js";
import {
  setActiveGS, recomputeStats, applyDamage, addStatus, hasStatus, consumeDodge,
  killPlayer, pushLog, giveCard, enforceHandLimit, resolveAttack,
  beginTurn, advancePointer, onPhaseAdvance, bossTurn,
  checkQuestProgress, applyZoneEffectServer, applyRandomZoneEvent,
  startAttackCard, resolveAttackCard, applyPlayableCard, CARD_CTX,
} from "./engine.js";

// ─── Game Action Handler ─────────────────────────────────────────────────────
export function handleGameAction(ws, msg) {
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
      // เส้นทางต้นทุนต่ำสุดถึงเป้าหมาย (server-authoritative) — เดินผ่านทีละช่อง ไม่วาปข้าม
      const route = getPath(cp.col, cp.row, moveLeft, col, row, gs.cells);
      if (!route) return send(ws, { type: "error", msg: `เดินไป (${col},${row}) ไม่ได้ — ไกลเกินงบเดินที่เหลือ` });
      const costMap = getReachableCostMap(cp.col, cp.row, moveLeft, gs.cells);

      // เดินทีละช่องตามเส้นทาง — เหยียบกับดักระหว่างทาง = ทริกเกอร์ทันที + หยุดที่ช่องนั้น
      const startKey = `${cp.col},${cp.row}`;
      const trail = [{ col: cp.col, row: cp.row }];
      let landed = gs.cells.find(c => c.col === cp.col && c.row === cp.row);
      let trapped = false;
      for (let i = 1; i < route.cells.length; i++) {
        const step = route.cells[i];
        cp.col = step.col; cp.row = step.row;
        landed = step;
        trail.push({ col: step.col, row: step.row });
        if (step.trap) {
          triggerTrap(gs, cp, step, CARD_CTX); // โดนกับดักระหว่างทาง → หยุดเดิน
          trapped = true;
          break;
        }
        if (!cp.alive) break;
      }

      const spent = costMap.get(`${landed.col},${landed.row}`) ?? 0;
      gs.actionsDone.moveLeft = moveLeft - spent;
      gs.actionsDone.moved = true;
      // เดิน → ล้างการชาร์จความเร็ว (SPD กลับค่าเริ่มต้น) + จดว่าเทิร์นนี้ได้เดิน
      cp._movedSinceTurn = true;
      if (cp._spdCharge) cp._spdCharge = 0;
      // passive: ตาเหยี่ยว (archer) หมดเมื่อเดิน
      cp._hawkEyeActive = false;
      recomputeStats(cp);
      // เส้นทางจริง → ส่งให้ client เล่นอนิเมชันเดินทีละช่อง
      cp._moveTrail = { id: (gs._moveSeq = (gs._moveSeq || 0) + 1), path: trail };
      pushLog(gs, `🚶 ${cp.name} → (${landed.col}, ${landed.row})` + (trapped ? " (หยุดเพราะกับดัก!)" : ""), "");

      // ผลของช่องที่หยุดยืน — เฉพาะถ้ายังไม่ตายและไม่ถูกกับดักหยุดกลางทาง
      if (cp.alive && !trapped && startKey !== `${landed.col},${landed.row}`) {
        // passive: นักสำรวจ (zhenghe) ทอง +1 พิเศษเมื่อเดินเข้า zone
        if (cp.charId === "zhenghe" && landed.specialZone) {
          cp.gold += 1;
          pushLog(gs, `⛵ ${cp.name} นักสำรวจ: ทอง+1 พิเศษ`, "event");
        }
        // king skill: shadow_hunt / iron_fortress ข้ามผลกระทบ zone
        if (!cp._skipZoneEffect) {
          const hpBefore = cp.hp;
          applyZoneEffectServer(cp, landed, gs);
          const healed = cp.hp - hpBefore;
          if (healed > 0 && (cp.charId === "cleric" || cp.charId === "herbalist")) {
            cp.hp = Math.min(cp.maxHp, cp.hp + 1);
            pushLog(gs, `✨ ${cp.name} passive: HP+1 พิเศษจากสมุนไพร`, "heal");
          }
          applyRandomZoneEvent(cp, landed, gs);
        } else {
          cp._skipZoneEffect = false;
          pushLog(gs, `🌑 ${cp.name} ข้ามผลกระทบ zone (สกิลราชา)`, "event");
        }
        checkQuestProgress(cp, landed, gs);
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
        // ถึงลิมิต 2 ชิ้น — แจ้ง client เปิด swap dialog
        if (result?.needsSwap) {
          return send(ws, { type: "equip_swap_needed", currentEquipment: result.currentEquipment, newCardUid: cardUid });
        }
      } else if (card.type === "betrayer") {
        return send(ws, { type: "error", msg: "ตราทรยศจะทำงานอัตโนมัติเมื่อสิ้นเฟส — ไม่สามารถใช้งานได้โดยตรง" });
      } else if (card.type === "political" || card.type === "battlefield" || card.type === "legendary") {
        result = applyPlayableCard(gs, info.code, cp, card, { targetPlayer });
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

    // ── สลับอุปกรณ์ — ถอดชิ้นเก่า + สวมใส่ชิ้นใหม่ในครั้งเดียว ──────────────
    case "swap_equip": {
      const { removeEquipId, newCardUid } = payload;
      const newCardIdx = cp.hand.findIndex(c => c.uid === newCardUid);
      if (newCardIdx < 0) return send(ws, { type: "error", msg: "ไม่พบการ์ดในมือ" });
      const newCard = cp.hand[newCardIdx];
      if (newCard.type !== "weapon") return send(ws, { type: "error", msg: "ต้องเป็นการ์ดอาวุธ/เกราะ" });
      const removeIdx = (cp.equipment || []).findIndex(e => e.id === removeEquipId);
      if (removeIdx < 0) return send(ws, { type: "error", msg: "ไม่พบอุปกรณ์ที่ต้องการถอด" });
      const removed = cp.equipment.splice(removeIdx, 1)[0];
      recomputeStats(cp, gs);
      const result2 = equipWeapon(gs, cp, newCard, CARD_CTX);
      if (result2?.error) {
        cp.equipment.splice(removeIdx, 0, removed); // rollback
        recomputeStats(cp, gs);
        return send(ws, { type: "error", msg: result2.error });
      }
      cp.hand.splice(newCardIdx, 1);
      enforceHandLimit(cp);
      gs.actionsDone.cardsPlayed = (gs.actionsDone.cardsPlayed || 0) + 1;
      pushLog(gs, `🔄 ${cp.name} เปลี่ยนอุปกรณ์ — ถอด "${removed.name}" แล้วสวม "${newCard.name}"`, "");
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
export function handleLeave(ws) {
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
