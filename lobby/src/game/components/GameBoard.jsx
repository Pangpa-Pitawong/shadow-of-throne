import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "../styles/gameboard.css";

import { ROLES } from "../constants/roles.js";
import { CLASSES } from "../constants/classes.js";
import { CHARACTERS } from "../constants/characters.js";
import { RARITY, normRarity } from "../constants/cards.js";
import { TERRAIN, TERRAIN_COLORS, TERRAIN_STROKE } from "../constants/terrain.js";

import { hexToPixel, hexPoints, hexDistance, getReachable, getCostMap } from "../utils/hexMath.js";

import TopBar from "./TopBar.jsx";
// LeftPanel/RightPanel แทนด้วย HUD overlay บนแมพ (crest/shields/stat bar/log)
import IslandMap3D from "./IslandMap3D.jsx";
import HandCard from "./HandCard.jsx";
import CharIcon from "./CharIcon.jsx";
import WinScreen from "./overlays/WinScreen.jsx";
import DiceAnimation from "./overlays/DiceAnimation.jsx";
import EventBanner from "./overlays/EventBanner.jsx";
import EventCardModal from "./overlays/EventCardModal.jsx";
import InterruptPrompt from "./overlays/InterruptPrompt.jsx";
import Tooltip from "./overlays/Tooltip.jsx";

// ─── CONSTANTS ───────────────────────────────────────────────
const HEX_SIZE = 46;
const MAP_COLS = 13;
const MAP_ROWS = 11;
const HEX_W = HEX_SIZE * 2;
const HEX_H = Math.sqrt(3) * HEX_SIZE;
const MAP_W = MAP_COLS * (HEX_W * 0.75) + HEX_W * 0.25 + 80;
const MAP_H = MAP_ROWS * HEX_H + HEX_H * 0.5 + 100;
// ─── EXTENDED SPECIAL ZONES ──────────────────────────────────
// เพิ่มสถานที่ใหม่หลายแห่ง: shop, quest, event, dungeon, etc.
const EXTENDED_SPECIAL_ZONES = {
  // สถานที่เดิม
  palace: { name: "พระราชวัง", ico: "🏰", effect: "king_buff", desc: "ราชา HP+3 ทุกเฟส", color: "#c9a84c", category: "royal" },
  throne: { name: "ศาลบัลลังก์", ico: "⚖️", effect: "throne", desc: "ราชา HP+3 / กบฏ HP-2", color: "#c9a84c", category: "royal" },
  village: { name: "หมู่บ้าน", ico: "🏘️", effect: "heal", desc: "ฟื้น HP+2 เมื่อยืน", color: "#4cc94c", category: "safe" },
  market: { name: "ตลาดกลาง", ico: "🏪", effect: "trade", desc: "ซื้อขายการ์ดได้ + ทอง+1", color: "#f0d080", category: "shop" },
  rebel_camp: { name: "ค่ายกบฏ", ico: "⛺", effect: "rebel_buff", desc: "กบฏ ATK+2 HP+2", color: "#c94040", category: "faction" },
  dark_forest: { name: "ป่าดำ", ico: "🌑", effect: "trap", desc: "ซ่อนตัวได้ + กับดักฟรี", color: "#4a3a6a", category: "ambush" },
  tower: { name: "หอเวทย์", ico: "🗼", effect: "magic", desc: "จั่วเวทย์ฟรี 1 ใบ + มานา+2", color: "#8060e0", category: "magic" },
  shrine: { name: "ศาลเจ้า", ico: "⛩️", effect: "full_heal", desc: "ฟื้น HP เต็ม 1 ครั้ง/เกม", color: "#80c0ff", category: "holy" },
  cave: { name: "ถ้ำมังกร", ico: "🐉", effect: "treasure", desc: "ทอย 4+: ทอง+3 / 1-3: HP-3", color: "#e05050", category: "danger" },
  // ─── สถานที่ใหม่ ───
  blacksmith: { name: "ช่างตีเหล็ก", ico: "⚒️", effect: "shop_weapon", desc: "🛒 ร้านอาวุธ — ซื้อการ์ดอาวุธ/เกราะ", color: "#e08040", category: "shop" },
  alchemist: { name: "ร้านแม่มด", ico: "🧪", effect: "shop_magic", desc: "🛒 ร้านเวทย์ — ซื้อการ์ดเวทย์มนตร์", color: "#a050e0", category: "shop" },
  tavern: { name: "โรงเตี๊ยม", ico: "🍺", effect: "shop_info", desc: "🛒 ซื้อข้อมูล + ฟื้น HP+1", color: "#c08040", category: "shop" },
  armory: { name: "คลังอาวุธ", ico: "🏯", effect: "draw_weapon", desc: "จั่วอาวุธฟรี 1 ใบ", color: "#8090a0", category: "loot" },
  dungeon: { name: "คุกใต้ดิน", ico: "🗝️", effect: "dungeon", desc: "⚔️ ดันเจี้ยน — เสี่ยงอันตราย รับรางวัลใหญ่", color: "#605060", category: "danger" },
  quest_board: { name: "กระดานเควส", ico: "📋", effect: "quest", desc: "📋 รับเควส — EXP+3 ทอง+2", color: "#40c080", category: "quest" },
  treasure: { name: "คลังสมบัติ", ico: "💰", effect: "big_loot", desc: "💰 สมบัติใหญ่ — ทอย ลุ้นรางวัล", color: "#ffd700", category: "loot" },
  farm: { name: "ไร่นา", ico: "🌾", effect: "farm", desc: "ยืนที่นี่ทุกเทิร์น: ทอง+1", color: "#80c040", category: "resource" },
  river: { name: "แม่น้ำศักดิ์สิทธิ์", ico: "🌊", effect: "mana_well", desc: "ฟื้นมานา+3 ทั้งหมด", color: "#4080c0", category: "magic" },
  ruins: { name: "ซากปรักหักพัง", ico: "🏚️", effect: "ruins", desc: "ค้นหาสมบัติเก่า — เสี่ยงกับดัก", color: "#806040", category: "loot" },
  watchtower: { name: "หอสังเกตการณ์", ico: "🔭", effect: "spy", desc: "ล่วงรู้บทบาทผู้เล่น 1 คน (เฉพาะคุณเห็น)", color: "#60a0c0", category: "intel" },
  graveyard: { name: "สุสาน", ico: "🪦", effect: "graveyard", desc: "ได้การ์ดจากผู้ตาย / HP-1", color: "#607060", category: "dark" },
  volcano: { name: "ภูเขาไฟ", ico: "🌋", effect: "volcano", desc: "⚠️ อันตรายสูง! DMG-4 / ATK+3 1 เทิร์น", color: "#e04020", category: "danger" },
  portal: { name: "ประตูมิติ", ico: "🌀", effect: "teleport", desc: "เทเลพอร์ตไปสถานที่สุ่ม", color: "#4060e0", category: "special" },
  oasis: { name: "โอเอซิส", ico: "🌴", effect: "oasis", desc: "ฟื้น HP+3 + มานา+2 (ทะเลทราย)", color: "#40c0a0", category: "safe" },
};

// ─── CATEGORY COLORS สำหรับ Legend ──────────────────────────
const CATEGORY_COLORS = {
  royal: { bg: "#3a2a00", border: "#c9a84c", label: "สถานที่หลวง" },
  safe: { bg: "#0a2a0a", border: "#4cc94c", label: "พื้นที่ปลอดภัย" },
  shop: { bg: "#2a2000", border: "#f0d080", label: "ร้านค้า/ซื้อขาย" },
  faction: { bg: "#2a0a0a", border: "#c94040", label: "พื้นที่ฝ่าย" },
  ambush: { bg: "#0a0a1a", border: "#8060c0", label: "พื้นที่ซ่อนโจมตี" },
  magic: { bg: "#1a0a3a", border: "#a060e0", label: "สถานที่เวทย์" },
  holy: { bg: "#0a1a2a", border: "#80c0ff", label: "ศักดิ์สิทธิ์" },
  danger: { bg: "#2a0808", border: "#e04040", label: "⚠️ อันตราย" },
  loot: { bg: "#1a1a08", border: "#c0a040", label: "หาสมบัติ" },
  quest: { bg: "#083a20", border: "#40c080", label: "เควส" },
  resource: { bg: "#0a1a08", border: "#80c040", label: "ทรัพยากร" },
  intel: { bg: "#082028", border: "#60a0c0", label: "ข่าวกรอง" },
  dark: { bg: "#101810", border: "#607060", label: "มืด/สุสาน" },
  special: { bg: "#081018", border: "#4060e0", label: "พิเศษ" },
};

// ─── PLAYER ICONS สำหรับแต่ละผู้เล่น ────────────────────────
const PLAYER_ICONS = ["👑", "⚔️", "🔮", "🏹", "🗡️", "✨", "🛡️", "🔥"];
const PLAYER_COLORS = ["#c9a84c", "#c94040", "#8c4cc9", "#4cc94c", "#e08040", "#40c0c0", "#8b7355", "#e05030"];
const PLAYER_LABELS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function GameBoard({ gameState: serverGameState, myIdx, onLeave, onGameAction }) {
  // ── MAP STATE ──
  // ✅ แก้ไข — รับ cells จาก server:
  const [cells, setCells] = useState(() => serverGameState?.cells || []);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [recenterTok, setRecenterTok] = useState(0); // กดปุ่มจัดกึ่งกลาง → รีเฟรมกล้อง 3D
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const mapAreaRef = useRef(null);

  // ── GAME STATE ──
  // ✅ แก้ไข
  const [players, setPlayers] = useState(() => {
    if (!serverGameState?.players) return [];
    return serverGameState.players.map((p, i) => ({
      ...p,
      playerIcon: PLAYER_ICONS[i] ?? "🧑",
      playerColor: PLAYER_COLORS[i] ?? "#888",
      playerLabel: PLAYER_LABELS[i] ?? `P${i + 1}`,
    }));
  });

  const [currentTurn, setCurrentTurn] = useState(0);
  const [phase, setPhase] = useState(1);
  const [maxPhases, setMaxPhases] = useState(8);
  const [fogActive, setFogActive] = useState(false);
  const [bossMode, setBossMode] = useState(false);
  const [bossLevel, setBossLevel] = useState(0);
  const [phaseStep, setPhaseStep] = useState(0);
  const [actionsDone, setActionsDone] = useState({ moved: false, moveLeft: 5, attacked: false, cardsPlayed: 0 });
  const [actionMode, setActionMode] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [pendingMove, setPendingMove] = useState(null); // ช่องที่รอยืนยันการเดิน
  const [reachableCells, setReachableCells] = useState([]);
  const [attackableCells, setAttackableCells] = useState([]);
  const [trapCells, setTrapCells] = useState([]);
  const [skillTargetCells, setSkillTargetCells] = useState([]);

  // ── LOG (ด้านขวา) ──
  const [log, setLog] = useState([
    { msg: "🏰 เกมเริ่มต้น! ทุกคนเกิดที่ขอบแมพ", type: "event" },
    { msg: "💡 เดินไปสถานที่ต่างๆ เพื่อรับของ ซื้อการ์ด และทำเควส", type: "" },
  ]);

  const [gameOver, setGameOver] = useState(null);
  const [showDice, setShowDice] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [ruleTab, setRuleTab] = useState(0); // หมวดกฎที่กำลังเปิดอ่าน
  const [showLegend, setShowLegend] = useState(false);
  const [showShop, setShowShop] = useState(null); // { cell, items }
  const [showStatus, setShowStatus] = useState(false); // ช่องดูสถานะผู้เล่นทุกคน
  const [statusSel, setStatusSel] = useState(null);     // index ผู้เล่นที่เลือกดูข้อมูลตัวละครในหมวดสถานะ
  const [showQuest, setShowQuest] = useState(false);   // อ่านเควสรองของตัวเองซ้ำ (ลับเฉพาะตัว)
  const [turnAnnounce, setTurnAnnounce] = useState(null);
  const [showCards, setShowCards] = useState(false);  // card drawer open/close
  const [logOpen, setLogOpen] = useState(false);      // HUD event log expand/collapse
  const [showLabels, setShowLabels] = useState(false); // toggle ป้ายชื่อสถานที่บนแมพ
  const logBodyRef = useRef(null);                     // เลื่อน log ไปล่างสุดเมื่อมี entry ใหม่/กางออก
  const [drawReveal, setDrawReveal] = useState(null); // { cards, flipped[] } — เปิดไพ่ที่จั่วได้
  const [drawSeen, setDrawSeen] = useState(false);     // เปิดไพ่ของเทิร์นนี้ดูแล้วหรือยัง
  const lastDrawKeyRef = useRef("");
  const [eventModal, setEventModal] = useState(null);  // การ์ดเหตุการณ์ท้ายเฟส (modal กลางจอ)
  const lastEventIdRef = useRef(0);

  // event log: เลื่อนไปล่างสุดเมื่อมี entry ใหม่หรือกางออก (preserve history, ดูล่าสุดทันที)
  useEffect(() => {
    const el = logBodyRef.current;
    if (el && logOpen) el.scrollTop = el.scrollHeight;
  }, [log, logOpen]);

  useEffect(() => {
    if (!serverGameState) return;

    const mergedPlayers = (serverGameState.players ?? []).map((p, i) => ({
      ...p,
      playerIcon: PLAYER_ICONS[i] || "🧑",
      playerColor: PLAYER_COLORS[i] || "#888",
      playerLabel: PLAYER_LABELS[i] || `P${i + 1}`,
    }));

    setPlayers(mergedPlayers);
    setCells(serverGameState.cells ?? []);
    setCurrentTurn(serverGameState.currentTurn ?? 0);
    setPhase(serverGameState.phase ?? 1);
    setMaxPhases(serverGameState.maxPhases ?? 8);
    setFogActive(!!serverGameState.fogActive);
    setBossMode(!!serverGameState.bossMode);
    setBossLevel(serverGameState.bossLevel ?? 0);
    setPhaseStep(serverGameState.phaseStep ?? 0);
    setActionsDone(
      serverGameState.actionsDone ?? {
        moved: false,
        moveLeft: 5,
        attacked: false,
        cardsPlayed: 0,
      }
    );
    setLog(serverGameState.log ?? []);
    if (serverGameState.gameOver) setGameOver(serverGameState.gameOver);

    // อัปเดต ref พร้อมกัน ไม่ใช่ใน useEffect แยก
    currentTurnRef.current = serverGameState.currentTurn ?? 0;

    // การ์ดเหตุการณ์ท้ายเฟส — เด้ง modal เมื่อมี reveal ใหม่
    const er = serverGameState.eventReveal;
    if (er && er.id && er.id !== lastEventIdRef.current) {
      lastEventIdRef.current = er.id;
      setEventModal(er);
    }

  }, [serverGameState]);

  const addLog = useCallback((msg, type = "") => {
    setLog(l => [{ msg, type }, ...l.slice(0, 149)]);
  }, []);

  // ── CENTER MAP ──
  const centerMap = useCallback(() => {
    if (!mapAreaRef.current) return;
    const rect = mapAreaRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fitZoom = Math.min((rect.width - 40) / MAP_W, (rect.height - 40) / MAP_H, 1);
    setZoom(fitZoom);
    setMapOffset({
      x: Math.round((rect.width - MAP_W * fitZoom) / 2),
      y: Math.round((rect.height - MAP_H * fitZoom) / 2),
    });
  }, []);

  useEffect(() => {
    if (!mapAreaRef.current) return;
    const ro = new ResizeObserver(() => { centerMap(); ro.disconnect(); });
    ro.observe(mapAreaRef.current);
    return () => ro.disconnect();
  }, [centerMap]);

  // การซูม/หมุน/เลื่อนแมพ จัดการโดย OrbitControls ภายใน IslandMap3D (กล้อง 3D)
  // — ไม่ต้องดัก wheel ที่นี่อีก (จะตีกับ OrbitControls)

  const me = players[myIdx];
  const currentPlayer = players[currentTurn];
  const isMyTurn = useMemo(
    () => myIdx >= 0 && currentTurn === myIdx,
    [currentTurn, myIdx]
  );

  // ── ต้นทุนเดินจากตำแหน่งผู้เล่นปัจจุบันไปทุกช่อง (ใช้โชว์ตอนเอาเมาส์ชี้) ──
  const moveCostMap = useMemo(() => {
    const cp = players[currentTurn];
    if (!cp) return null;
    const startCell = cells.find(c => c.col === cp.col && c.row === cp.row);
    if (!startCell) return null;
    return getCostMap(startCell, cells, TERRAIN);
  }, [players, currentTurn, cells]);

  // ── จั่วเริ่มเทิร์น: เปิดไพ่ที่เพิ่งจั่วได้ (อนิเมชันลุ้น) ──
  useEffect(() => {
    if (!isMyTurn || !me?.justDrew?.length) return;
    const key = `${currentTurn}:${me.justDrew.join(",")}`;
    if (lastDrawKeyRef.current === key) return;
    lastDrawKeyRef.current = key;
    const cards = me.justDrew.map(uid => me.hand?.find(c => c.uid === uid)).filter(Boolean);
    if (cards.length) { setDrawReveal({ cards, flipped: cards.map(() => false) }); setDrawSeen(false); }
  }, [isMyTurn, currentTurn, me?.justDrew, me?.hand]);

  const flipDrawCard = useCallback((i) => {
    setDrawReveal(d => d ? { ...d, flipped: d.flipped.map((f, j) => (j === i ? true : f)) } : d);
  }, []);
  const reopenDraw = useCallback(() => {
    if (!me?.justDrew?.length) return;
    const cards = me.justDrew.map(uid => me.hand?.find(c => c.uid === uid)).filter(Boolean);
    if (cards.length) setDrawReveal({ cards, flipped: cards.map(() => true) });
  }, [me?.justDrew, me?.hand]);

  // ── ทิ้งการ์ดที่เกินลิมิตมือ (ผู้เล่นเลือกเอง) ──
  const discardCard = useCallback((cardUid) => {
    onGameAction("discard_card", { cardUid });
  }, [onGameAction]);

  useEffect(() => {
    // ใช้ "งบเดินที่เหลือ" (moveLeft) แทนค่าเดินเต็ม — เดินเป็นช่วงๆ ได้จนงบหมด
    const moveLeft = actionsDone.moveLeft ?? 0;
    if (actionMode === "move" && moveLeft > 0) {
      const cp = players[currentTurn];
      if (!cp) return;

      const startCell = cells.find(
        c => c.col === cp.col && c.row === cp.row
      );

      if (startCell) {
        const reachable = getReachable(startCell, moveLeft, cells, TERRAIN);
        setReachableCells(reachable);
      }
    } else {
      setReachableCells([]);
      setPendingMove(null); // ออกจากโหมดเดิน / งบหมด → ล้างช่องที่รอยืนยัน
    }
  }, [
    actionMode,
    actionsDone.moveLeft,
    cells,
    players,
    currentTurn
  ]);

  // ── ATTACK CELLS ──
  useEffect(() => {
    if (actionMode === "attack" && !actionsDone.attacked) {
      const cp = players[currentTurn];
      if (!cp) return;
      // ระยะโจมตีมาจากอุปกรณ์ (range) — ฐาน 0 = ตีได้แค่ช่องเดียวกัน
      const range = cp.range ?? 0;
      const cpCell = { col: cp.col, row: cp.row };
      setAttackableCells(cells.filter(c => {
        const d = hexDistance(cpCell, c);
        return d <= range; // d=0 รวมช่องเดียวกัน
      }));
    } else {
      setAttackableCells([]);
    }
  }, [actionMode, actionsDone.attacked, cells, players, currentTurn]); // 👈 ต้องมี currentTurn และ players เสมอ

  // ── TRAP CELLS — วางกับดักได้เฉพาะช่องที่ยืน + รอบตัวระยะ 1 ช่อง ──
  useEffect(() => {
    if (actionMode === "trap" && selectedCard) {
      const cp = players[currentTurn];
      if (!cp) { setTrapCells([]); return; }
      const center = { col: cp.col, row: cp.row };
      setTrapCells(cells.filter(c =>
        c.terrain !== "water" && !c.trap && hexDistance(center, c) <= 1));
    } else {
      setTrapCells([]);
    }
  }, [actionMode, selectedCard, cells, players, currentTurn]);

  // ── SKILL TARGET CELLS — ไฮไลต์เซลล์ที่มีผู้เล่นเป็นเป้าหมายสกิลได้ ──
  useEffect(() => {
    if ((actionMode === "skill" || actionMode === "king_skill") && isMyTurn) {
      const cp = players[currentTurn];
      if (!cp) { setSkillTargetCells([]); return; }
      const targetCells = cells.filter(c =>
        players.some(p => p.alive && p.id !== cp.id && p.col === c.col && p.row === c.row)
      );
      setSkillTargetCells(targetCells);
    } else {
      setSkillTargetCells([]);
    }
  }, [actionMode, isMyTurn, cells, players, currentTurn]);

  // ── Auto-activate move mode when it becomes my turn ──
  useEffect(() => {
    if (isMyTurn) {
      // เมื่อถึงตา — เปิด move mode อัตโนมัติ (ถ้ายังมีงบเดิน)
      setActionMode(prev => {
        if (prev === "skill" || prev === "king_skill" || prev === "card" || prev === "trap") return prev;
        return (actionsDone.moveLeft ?? 0) > 0 ? "move" : null;
      });
    } else {
      setActionMode(null);
      setShowCards(false);
    }
  }, [isMyTurn, currentTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Right-click on map → toggle attack mode ──
  const handleMapContextMenu = useCallback((e) => {
    e.preventDefault();
    if (!isMyTurn) return;
    if (actionMode === "attack") {
      setActionMode((actionsDone.moveLeft ?? 0) > 0 ? "move" : null);
      setAttackableCells([]);
    } else if (!actionsDone.attacked) {
      setSelectedCard(null);
      setReachableCells([]);
      setActionMode("attack");
    }
  }, [isMyTurn, actionMode, actionsDone]);

  // ── เปิดร้านค้าอัตโนมัติเมื่อเดินไปถึง (อ่าน shopItems จาก server state) ──
  const lastCellKeyRef = useRef(null);
  useEffect(() => {
    if (!isMyTurn || !me) return;
    const myCell = cells.find(c => c.col === me.col && c.row === me.row);
    if (!myCell) return;
    if (lastCellKeyRef.current === myCell.key) return; // เปิดครั้งเดียวต่อการมาถึง
    lastCellKeyRef.current = myCell.key;
    const zoneData = EXTENDED_SPECIAL_ZONES[myCell.specialZone];
    if (zoneData
      && ["shop_weapon", "shop_magic", "trade", "shop_info"].includes(zoneData.effect)
      && myCell.shopItems?.length > 0) {
      setShowShop(myCell.key);
    }
  }, [me?.col, me?.row, isMyTurn, cells]); // eslint-disable-line react-hooks/exhaustive-deps

  // หมายเหตุ: ตรรกะ zone-effect / win-check / attack เป็น authoritative บน server
  // (ฝั่ง client เพียง render state ที่ server ส่งมา) — โค้ดเดิมฝั่ง client ถูกถอดออก

  // ── CELL CLICK ──
  const currentTurnRef = useRef(currentTurn);

  // sync ref ทุกครั้งที่ state เปลี่ยน
  useEffect(() => {
    currentTurnRef.current = currentTurn;
  }, [currentTurn]);

  const handleCellClick = useCallback((cell) => {

    const turn = currentTurnRef.current;
    if (turn !== myIdx || myIdx < 0) return;

    const cp = players[turn];
    if (!cp || !cp.alive) return;

    if (actionMode === "move") {
      if (!reachableCells.some(c => c.key === cell.key)) return;

      // ✅ ขอยืนยันก่อนเดินจริง — ไม่ส่ง action ทันที
      setPendingMove(cell);
      setSelectedCell(cell);
      return;
    }

    // ── ATTACK ─────────────────────────────
    // ✅ แก้ handleCellClick ส่วน attack:
    else if (actionMode === "attack") {
      const cp = players[currentTurn]; // ← ใช้ state โดยตรง ไม่ใช่ ref

      const target = players.find(
        p =>
          p.alive &&
          p.col === cell.col &&
          p.row === cell.row &&
          p.id !== cp.id       // ← เปรียบกับ cp.id ไม่ใช่ currentTurn (index)
      );

      if (!target) return;

      // hexDistance จาก utils รับ (cellA, cellB) หรือ (col,row,col,row) ตามที่ import มา
      // ตรวจว่า import มาแบบไหน แล้วเรียกให้ตรง:
      const distance = hexDistance({ col: cp.col, row: cp.row }, { col: target.col, row: target.row });
      const attackRange = cp.range ?? 0;

      if (distance > attackRange) return;

      onGameAction("attack", { targetId: target.id });
      setActionMode(null);
    }

    // ── USE CARD ───────────────────────────
    else if (actionMode === "card" && selectedCard) {
      onGameAction("use_card", {
        cardUid: selectedCard.uid,
        targetCol: cell.col,
        targetRow: cell.row,
      });

      setSelectedCard(null);
      setActionMode(null);
    }

    // ── USE ACTIVE SKILL (target-required) ─────────────────────────────────
    else if (actionMode === "skill") {
      const cp = players[currentTurn];
      const target = players.find(p => p.alive && p.col === cell.col && p.row === cell.row && p.id !== cp?.id);
      if (!target) return;
      onGameAction("use_skill", { targetId: target.id, targetCol: cell.col, targetRow: cell.row });
      setActionMode(null);
    }

    // ── USE KING SKILL (target-required) ───────────────────────────────────
    else if (actionMode === "king_skill") {
      const cp = players[currentTurn];
      const target = players.find(p => p.alive && p.col === cell.col && p.row === cell.row && p.id !== cp?.id);
      if (!target) return;
      onGameAction("use_king_skill", { targetId: target.id });
      setActionMode(null);
    }

    // ── PLACE TRAP ─────────────────────────
    else if (actionMode === "trap" && selectedCard) {
      // วางได้เฉพาะช่องที่ยืน + รอบตัวระยะ 1 ช่อง (ไฮไลต์ไว้แล้ว)
      if (!trapCells.some(c => c.key === cell.key)) return;

      onGameAction("use_card", {
        cardUid: selectedCard.uid,
        targetCol: cell.col,
        targetRow: cell.row
      });

      setSelectedCard(null);
      setActionMode(null);
    }

    setSelectedCell(cell);

  }, [actionMode, myIdx, currentTurn, players, reachableCells, trapCells, selectedCard, onGameAction]);


  // ─── ยืนยัน / ยกเลิก การเดิน ───
  const confirmMove = useCallback(() => {
    if (!pendingMove) return;
    onGameAction("move", { col: pendingMove.col, row: pendingMove.row });
    setPendingMove(null);
    // คงโหมด "เดิน" ไว้ — ถ้ายังเหลืองบเดิน จะเลือกเดินต่อได้ทันที (server จะส่ง moveLeft ใหม่)
  }, [pendingMove, onGameAction]);

  const cancelMove = useCallback(() => {
    setPendingMove(null);
    setSelectedCell(null);
  }, []);

  // ─── END TURN (แก้ไขระบบส่งต่อตาและซิงค์แอกชันให้ถูกต้อง) ───
  const endTurn = useCallback(() => {
    onGameAction("end_turn");
  }, [onGameAction]);

  // ── SHOP BUY (ผ่าน server — authoritative) ──
  const handleBuy = useCallback((item, shopCell) => {
    if (!isMyTurn) { addLog("❌ ซื้อได้เฉพาะเทิร์นของคุณ", "dmg"); return; }
    const cp = players[myIdx];
    if (!cp || cp.gold < item.price) {
      addLog(`❌ ทองไม่พอ (ต้องการ ${item.price} มี ${cp?.gold || 0})`, "dmg");
      return;
    }
    // server จะหักทอง + เพิ่มการ์ด + ลบสินค้า แล้ว broadcast state ใหม่กลับมา
    onGameAction("buy_item", { shopKey: shopCell.key, itemUid: item.uid });
  }, [players, myIdx, isMyTurn, onGameAction, addLog]);

  // ── PICK SIDE QUEST (เลือกเควสรองลับ — ส่งให้ server) ──
  const pickQuest = useCallback((questId) => {
    onGameAction("pick_quest", { questId });
  }, [onGameAction]);

  // ── MAP DRAG ──
  const handleMapMouseDown = e => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: mapOffset.x, oy: mapOffset.y };
  };
  const handleMapMouseMove = e => {
    if (!isDragging.current) return;
    setMapOffset({ x: dragStart.current.ox + (e.clientX - dragStart.current.x), y: dragStart.current.oy + (e.clientY - dragStart.current.y) });
  };
  const handleMapMouseUp = () => { isDragging.current = false; };

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <>
      <div className="mobile-msg">
        <div>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏰</div>
          <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", fontSize: "18px", marginBottom: "8px" }}>บัลลังก์เงา</div>
          <div style={{ color: "var(--txt-m)", fontSize: "13px" }}>กรุณาใช้หน้าจอขนาดใหญ่</div>
        </div>
      </div>

      <div className="game-root">
        {/* TOP BAR */}
        <TopBar
          phase={phase} phaseStep={phaseStep} maxPhases={maxPhases}
          fogActive={fogActive} bossMode={bossMode} bossLevel={bossLevel}
          currentPlayer={currentPlayer} isMyTurn={isMyTurn}
          onEndTurn={endTurn} onCenter={() => setRecenterTok(n => n + 1)}
          onToggleRules={() => setShowRules(r => !r)}
          onToggleStatus={() => setShowStatus(s => { if (!s) setStatusSel(myIdx >= 0 ? myIdx : 0); return !s; })}
          onToggleQuest={() => setShowQuest(s => !s)}
          hasQuest={!!me?.quest}
          onLeave={onLeave}
        />

        {/* LEFT PANEL ถูกแทนด้วย HUD overlay บนแมพ (crest/shields/stat bar) */}

        {/* ── SKILL MODE BANNER — แสดงเมื่ออยู่ใน skill targeting mode ── */}
        {(actionMode === "skill" || actionMode === "king_skill") && isMyTurn && (
          <div style={{
            position: "absolute", top: "52px", left: "50%", transform: "translateX(-50%)",
            zIndex: 200, background: "rgba(140,76,201,.92)", border: "1px solid #a060e0",
            borderRadius: "8px", padding: "6px 16px", display: "flex", alignItems: "center", gap: "12px",
            fontFamily: "'Cinzel',serif", fontSize: "12px", color: "#fff", backdropFilter: "blur(4px)",
          }}>
            <span>
              {actionMode === "king_skill" ? "👑 สกิลราชา:" : "✨ สกิล:"}
              {" "}กดที่ผู้เล่น (🟣) เพื่อเลือกเป้าหมาย
            </span>
            <button
              onClick={() => setActionMode(null)}
              style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.4)", borderRadius: "4px", padding: "2px 10px", color: "#fff", cursor: "pointer", fontSize: "11px" }}>
              ✕ ยกเลิก
            </button>
          </div>
        )}

        {/* MAP AREA — 2.5D Perspective Hex */}
        <div className="map-area" ref={mapAreaRef} onContextMenu={handleMapContextMenu}>
          <IslandMap3D
            cells={cells}
            players={players}
            myIdx={myIdx}
            currentTurn={currentTurn}
            reachableCells={reachableCells}
            attackableCells={attackableCells}
            trapCells={trapCells}
            skillTargetCells={skillTargetCells}
            selectedCell={selectedCell}
            pendingMove={pendingMove}
            zones={EXTENDED_SPECIAL_ZONES}
            categoryColors={CATEGORY_COLORS}
            showLabels={showLabels}
            recenter={recenterTok}
            onCellClick={handleCellClick}
            onCellHover={(cell, cx, cy) => {
              const zoneData = EXTENDED_SPECIAL_ZONES[cell.specialZone];
              const terrain = TERRAIN[cell.terrain] || TERRAIN.plains;
              // ── ต้นทุนเดินมาช่องนี้ (กี่งบเดิน) จากตำแหน่งผู้เล่นรอบปัจจุบัน ──
              const cp = players[currentTurn];
              const isHere = cp && cp.col === cell.col && cp.row === cell.row;
              const cost = moveCostMap?.get(cell.key);
              const moveLeft = actionsDone.moveLeft ?? 0;
              let move = null;
              if (isHere) {
                move = { text: "คุณอยู่ที่นี่", color: "#c9a84c" };
              } else if (cost != null) {
                const within = isMyTurn && cost <= moveLeft;
                move = {
                  text: `ต้องใช้ ${cost} งบเดิน` + (isMyTurn ? (within ? ` · เหลือ ${moveLeft} ✓` : ` · เกินงบ (เหลือ ${moveLeft})`) : ""),
                  color: !isMyTurn ? "#9aa" : within ? "#7CFC7C" : "#e08080",
                };
              }
              setTooltip({
                x: cx + 12, y: cy + 12,
                title: zoneData?.name || terrain.name,
                desc: zoneData?.desc || `ภูมิประเทศ: ${terrain.name} (ต้นทุน ${terrain.moveCost}/ช่อง)`,
                move,
              });
            }}
            onCellLeave={() => setTooltip(null)}
          />

          {/* ── ยืนยันการเดิน ── */}
          {pendingMove && (
            <div style={{
              position: "absolute", bottom: 64, left: "50%", transform: "translateX(-50%)",
              background: "rgba(13,11,8,.95)", border: "1.5px solid #4cc94c",
              borderRadius: "12px", padding: "12px 16px", zIndex: 30,
              boxShadow: "0 8px 28px rgba(0,0,0,.6), 0 0 18px rgba(76,201,76,.25)",
              textAlign: "center", minWidth: "220px",
            }}>
              <div style={{ fontSize: "12px", color: "#7CFC7C", fontFamily: "'Cinzel',serif", marginBottom: "8px" }}>
                📍 เดินไปช่อง ({pendingMove.col}, {pendingMove.row}) ?
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <button
                  onClick={confirmMove}
                  style={{
                    background: "rgba(76,201,76,.25)", border: "1px solid #4cc94c",
                    color: "#7CFC7C", borderRadius: "8px", padding: "6px 16px",
                    fontSize: "12px", cursor: "pointer", fontWeight: 600,
                  }}
                >✓ ยืนยัน</button>
                <button
                  onClick={cancelMove}
                  style={{
                    background: "rgba(201,76,76,.18)", border: "1px solid #c94040",
                    color: "#e08080", borderRadius: "8px", padding: "6px 16px",
                    fontSize: "12px", cursor: "pointer",
                  }}
                >✕ ยกเลิก</button>
              </div>
            </div>
          )}

          {/* ── Map Legend Button ── */}
          <button
            style={{
              position: "absolute", bottom: 12, left: 12, background: "rgba(13,11,8,.88)",
              border: "1px solid rgba(201,168,76,.35)", borderRadius: "8px",
              padding: "6px 12px", fontSize: "11px", color: "var(--gold)",
              cursor: "pointer", fontFamily: "'Cinzel',serif",
            }}
            onClick={() => setShowLegend(v => !v)}
          >📍 Legend แมพ</button>

          {/* ── END TURN — ปุ่มกรอบทอง/ดำ เข้าธีม (มุมขวาล่าง) ── */}
          {isMyTurn ? (
            <button className="endturn-ornate" onClick={endTurn} title="จบเทิร์นของคุณ">
              <span className="et-crest">⚜️</span>
              <span className="et-label">จบเทิร์น</span>
              <span className="et-sub">END TURN</span>
            </button>
          ) : (
            <div className="endturn-ornate waiting" title={`รอ ${currentPlayer?.name || ""}`}>
              <span className="et-crest">⏳</span>
              <span className="et-label">รอเทิร์น</span>
              <span className="et-sub">{(currentPlayer?.name || "").slice(0, 12)}</span>
            </div>
          )}

          {/* ── Compass / Help ── */}
          <div style={{
            position: "absolute", bottom: 56, left: 12,
            background: "rgba(13,11,8,.85)", border: "1px solid rgba(201,168,76,.3)",
            borderRadius: "8px", padding: "6px 10px", fontSize: "10px",
            color: "var(--txt-m)", lineHeight: "1.6", pointerEvents: "none",
            fontFamily: "'Cinzel',serif",
          }}>
            <div style={{ textAlign: "center", color: "var(--gold)", marginBottom: "2px" }}>🧭 แมพ</div>
            <div>⬆ พระราชวัง</div>
            <div>⬇ ค่ายกบฏ</div>
            <div style={{ fontSize: "9px", color: "var(--txt-d)", marginTop: "2px" }}>Scroll=ซูม | ลาก=เลื่อน</div>
          </div>

          {/* ── Zoom ── */}
          <div style={{
            position: "absolute", top: 8, right: 56,
            background: "rgba(13,11,8,.7)", border: "1px solid rgba(201,168,76,.2)",
            borderRadius: "6px", padding: "3px 8px", fontSize: "10px",
            color: "var(--txt-m)", pointerEvents: "none",
          }}>{Math.round(zoom * 100)}%</div>

          {/* Turn announce */}
          {turnAnnounce && (
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              background: "rgba(13,11,8,.95)", border: "2px solid var(--gold)",
              borderRadius: "14px", padding: "14px 32px",
              fontFamily: "'Cinzel',serif", fontSize: "18px", color: "var(--gold)",
              pointerEvents: "none", zIndex: 10, animation: "slide-down .3s ease-out",
            }}>{turnAnnounce}</div>
          )}

          {/* ═══ BATTLE HUD — crest / shields / event log / stat bar ═══ */}
          {/* crest: ผู้เล่นที่กำลังเดิน (มุมซ้ายบน) */}
          {currentPlayer && (
            <div className="hud-crest">
              <div className="hud-portrait">
                {currentPlayer.alive ? <CharIcon ch={CHARACTERS[currentPlayer.charId]} size={64} /> : "💀"}
                <div className="hud-ap" title="งบเดินที่เหลือ">{actionsDone.moveLeft ?? 0}</div>
              </div>
              <div className="hud-crest-meta">
                <div className="hud-name">{currentPlayer.name}{currentTurn === myIdx ? " (คุณ)" : ""}</div>
                <div className="hud-turn-lbl">▶ กำลังเดิน</div>
                <div className="hud-hearts">{Array.from({ length: currentPlayer.maxHp }).map((_, i) => <span key={i}>{i < currentPlayer.hp ? "❤️" : "🖤"}</span>)}</div>
                {ROLES[me?.role]?.win && <div className="hud-obj">🎯 {ROLES[me.role].win}</div>}
              </div>
            </div>
          )}

          {/* shields: ผู้เล่นทุกคน (คลิกเพื่อดูสถานะ) */}
          <div className="hud-shields">
            {players.map((p, i) => (
              <div key={i} className={`hud-shield ${currentTurn === i ? "active" : ""} ${!p.alive ? "dead" : ""}`}
                onClick={() => { setStatusSel(i); setShowStatus(true); }} title={`ดูสถานะ ${p.name}`}>
                <span className="hs-ico">{p.alive ? <CharIcon ch={CHARACTERS[p.charId]} size={30} /> : "💀"}</span>
                <span className="hs-no">{i + 1}</span>
              </div>
            ))}
          </div>

          {/* event log (ล่างกลาง, ย่อ/ขยายได้) */}
          <div className={`hud-log ${logOpen ? "open" : "collapsed"}`}>
            <div className="hud-log-hd" onClick={() => setLogOpen(v => !v)} title={logOpen ? "ย่อบันทึก" : "ขยายบันทึก"}>
              <span className="lh-t">📜 บันทึกเหตุการณ์</span>
              {!logOpen && log.length > 0 && (
                <span className="lh-sum">{log[log.length - 1].msg}</span>
              )}
              <span className="lh-x">{logOpen ? "▼ ย่อ" : "▲ ขยาย"}</span>
            </div>
            <div className="hud-log-body" ref={logBodyRef}>
              {log.slice(-50).map((e, i) => (
                <div key={i} className={`hud-log-row ${e.type}`}>{e.msg}</div>
              ))}
            </div>
          </div>

          {/* stat bar: ผู้เล่นเรา (ล่างกลาง) */}
          {me && (
            <div className="hud-statbar">
              <div className="hud-sb-portrait" onClick={() => { setStatusSel(myIdx >= 0 ? myIdx : 0); setShowStatus(true); }} title="ดูสถานะเต็ม">
                <div className="hud-sb-mini">{me.alive ? <CharIcon ch={CHARACTERS[me.charId]} size={38} /> : "💀"}</div>
                <div className="hud-sb-id">{me.name}<small>{ROLES[me.role] ? `${ROLES[me.role].ico} ${ROLES[me.role].name}` : "❓ ลับ"}</small></div>
              </div>
              <div className="hud-sb-stats">
                <div className="hud-coin hp"><span className="c-ico">❤️</span><span className="c-val">{me.hp}/{me.maxHp}</span><span className="c-lab">HP</span></div>
                <div className="hud-coin mp"><span className="c-ico">💧</span><span className="c-val">{me.mana}/{me.maxMana}</span><span className="c-lab">มานา</span></div>
                <div className="hud-sb-sep" />
                <div className="hud-coin"><span className="c-ico">⚔️</span><span className="c-val">{me.atk}</span><span className="c-lab">โจมตี</span></div>
                <div className="hud-coin"><span className="c-ico">🛡️</span><span className="c-val">{me.def}</span><span className="c-lab">ป้องกัน</span></div>
                <div className="hud-coin"><span className="c-ico">👟</span><span className="c-val">{me.move}</span><span className="c-lab">ความเร็ว</span></div>
                <div className="hud-coin"><span className="c-ico">🎯</span><span className="c-val">{me.range ?? 0}</span><span className="c-lab">ระยะ</span></div>
                <div className="hud-sb-sep" />
                <div className="hud-coin gold"><span className="c-ico">💰</span><span className="c-val">{me.gold}</span><span className="c-lab">ทอง</span></div>
              </div>
              {me.statusEffects?.length > 0 && (
                <div className="hud-sb-fx">
                  {me.statusEffects.map((s, i) => <span key={i} className={`status-tag status-${s.type}`}>{s.type} {s.duration}t</span>)}
                </div>
              )}
            </div>
          )}

          {/* ── CARD RAIL — มือผู้เล่นติดขอบขวา (เห็นตลอด) · ชี้เมาส์ = การ์ดเด้งออกแนวนอน ── */}
          <div className={`hand-rail${showCards ? " collapsed" : ""}`}>
            <div className="rail-head">
              <span>🂠 {me?.hand?.length || 0}/{Math.min(10, Math.max(1, me?.hp || 1))}</span>
              {(actionsDone.cardsPlayed || 0) > 0 && <span style={{ color:"var(--txt-m)" }}>ใช้ {actionsDone.cardsPlayed}/4</span>}
              {(isMyTurn && !drawReveal && !drawSeen && (me?.justDrew?.length > 0)) && (
                <button className="rail-deck" onClick={reopenDraw} title="เปิดไพ่ที่จั่วได้">จั่ว!</button>
              )}
            </div>
            {me?.pendingDiscard > 0 && (
              <div className="rail-warn">⚠ ต้องทิ้ง {me.pendingDiscard} ใบ</div>
            )}
            {/* Hand cards — >5 ใบ ซ้อนเหลื่อม (fan) ชี้เมาส์ดันขึ้นหน้า */}
            <div className={`rail-list${(me?.hand?.length || 0) > 5 ? " overlap" : ""}`}>
              {me?.hand?.map((card, ci) => (
                <HandCard
                  key={card.uid || ci}
                  card={card}
                  isSelected={selectedCard?.uid === card.uid}
                  isMyTurn={isMyTurn}
                  onSelect={card => {
                    setSelectedCard(card);
                    setActionMode(null);
                  }}
                  onHover={e => setTooltip({ x: e.clientX - 210, y: e.clientY - 40, title: card.name, desc: card.desc || "" })}
                  onLeave={() => setTooltip(null)}
                />
              ))}
              {(!me?.hand || me.hand.length === 0) && (
                <div className="rail-empty">ไม่มีการ์ดในมือ</div>
              )}
            </div>
            {/* Use card button — shows when card selected */}
            {selectedCard && isMyTurn && (
              <button
                className="rail-use tb-btn primary"
                disabled={(actionsDone.cardsPlayed || 0) >= 4}
                onClick={() => {
                  const c = selectedCard;
                  if (!c || !isMyTurn || (actionsDone.cardsPlayed || 0) >= 4) return;
                  if (c.type === "weapon") {
                    onGameAction("use_card", { cardUid: c.uid });
                    setSelectedCard(null); setActionMode(null);
                    return;
                  }
                  if (c.type === "trap") { setActionMode(actionMode === "trap" ? null : "trap"); return; }
                  const t = c.target || "enemy";
                  if (t === "self" || t === "team" || t === "none") {
                    onGameAction("use_card", { cardUid: c.uid });
                    setSelectedCard(null); setActionMode(null);
                    return;
                  }
                  if (t === "aoe") {
                    const needsTile = c.aoeMode === "line" || (c.aoeMode === "pointRadius" && c.byTile);
                    if (!needsTile) {
                      onGameAction("use_card", { cardUid: c.uid });
                      setSelectedCard(null); setActionMode(null);
                      return;
                    }
                  }
                  setActionMode(actionMode === "card" ? null : "card");
                }}
              >
                🃏 ใช้ "{selectedCard.name}" ({actionsDone.cardsPlayed || 0}/4)
              </button>
            )}
          </div>

          {/* ── RIGHT STRIP — icon buttons ── */}
          {(() => {
            const charDef = CHARACTERS[me?.charId] || CHARACTERS[me?.classId];
            const activeCost = charDef?.active?.cost || 0;
            const canUseSkill = isMyTurn && me && me.mana >= activeCost;
            const isKing = me?.role === "king";
            const isFateRead = charDef?.kingSkill?.id === "fate_read";
            const kingSkillUsed = isFateRead ? !!me?._fateReadUsed : (me?._kingSkillUsedPhase === phase);
            const handCount = me?.hand?.length || 0;
            const handLimit = Math.min(10, Math.max(1, me?.hp || 1));
            const deckReady = isMyTurn && !drawReveal && !drawSeen && (me?.justDrew?.length > 0);
            return (
              <div className="right-strip">
                {/* Mode hint */}
                {isMyTurn && actionMode === "move" && (
                  <div style={{ fontSize:"7px", color:"#7cfc7c", textAlign:"center", lineHeight:1.5, padding:"0 3px" }}>🚶เดิน<br/>ช่องเขียว</div>
                )}
                {isMyTurn && actionMode === "attack" && (
                  <div style={{ fontSize:"7px", color:"#e08080", textAlign:"center", lineHeight:1.5, padding:"0 3px" }}>⚔️โจมตี<br/>ช่องแดง</div>
                )}
                {isMyTurn && actionMode === "card" && (
                  <div style={{ fontSize:"7px", color:"#c9a84c", textAlign:"center", lineHeight:1.5, padding:"0 3px" }}>🃏เลือก<br/>เป้าหมาย</div>
                )}
                {!isMyTurn && (
                  <div style={{ fontSize:"7px", color:"var(--txt-d)", textAlign:"center", lineHeight:1.5, padding:"0 3px" }}>รอตา<br/>{currentPlayer?.name?.slice(0,4)}</div>
                )}

                {/* Card drawer toggle */}
                <div
                  className={`strip-btn${showCards ? " active-mode" : ""}${deckReady ? " active-mode" : ""}`}
                  onClick={() => setShowCards(v => !v)}
                  title="ซ่อน/แสดงไพ่ในมือ"
                >
                  🃏
                  <label>ไพ่</label>
                  {handCount > 0 && (
                    <span className="strip-badge">{handCount}</span>
                  )}
                  {deckReady && (
                    <span className="strip-badge" style={{ background:"#4cc94c", top:"-5px", left:"-5px", right:"auto" }}>!</span>
                  )}
                </div>

                {/* Location info toggle — ป้ายชื่อสถานที่บนแมพ */}
                <div
                  className={`strip-btn${showLabels ? " active-mode" : ""}`}
                  onClick={() => setShowLabels(v => !v)}
                  title="แสดง/ซ่อน ป้ายชื่อสถานที่บนแมพ"
                >
                  🗺️
                  <label>สถานที่</label>
                </div>

                {/* Active skill */}
                {charDef?.active && (
                  <div
                    className={`strip-btn${actionMode === "skill" ? " active-mode" : ""}${!canUseSkill ? " done" : ""}`}
                    onClick={() => {
                      if (!canUseSkill) return;
                      const noTargetSkills = new Set(["open_route","blizzard","arrow_rain","self_heal","sword_wind","elixir","shout_command"]);
                      if (noTargetSkills.has(charDef.active.id)) {
                        onGameAction("use_skill", {});
                      } else {
                        setActionMode(prev => prev === "skill" ? (actionsDone.moveLeft > 0 ? "move" : null) : "skill");
                        setSelectedCard(null);
                        setShowCards(false);
                      }
                    }}
                    title={`${charDef.active.name} — ${charDef.active.desc} (💧${activeCost})`}
                  >
                    {charDef.ico}
                    <label>สกิล</label>
                  </div>
                )}

                {/* King skill */}
                {isKing && charDef?.kingSkill && (
                  <div
                    className={`strip-btn${actionMode === "king_skill" ? " active-mode" : ""}${kingSkillUsed || !isMyTurn ? " done" : ""}`}
                    onClick={() => {
                      if (!isMyTurn || kingSkillUsed) return;
                      const noTargetKing = new Set(["drill_troops","royal_envoy","winter","royal_blessing","shadow_hunt","iron_fortress","fire_rain","immortal_potion","battle_pact"]);
                      if (noTargetKing.has(charDef.kingSkill.id)) {
                        onGameAction("use_king_skill", {});
                      } else {
                        setActionMode(prev => prev === "king_skill" ? (actionsDone.moveLeft > 0 ? "move" : null) : "king_skill");
                        setShowCards(false);
                      }
                    }}
                    title={`${charDef.kingSkill.name} — ${charDef.kingSkill.desc}`}
                    style={{ borderColor: kingSkillUsed ? "rgba(201,168,76,.1)" : actionMode === "king_skill" ? "#a060e0" : "rgba(201,168,76,.22)" }}
                  >
                    👑
                    <label>ราชา</label>
                  </div>
                )}

                <div className="strip-spacer" />

                {/* Stats */}
                <div className="strip-stat">เฟส<span>{phase}/{maxPhases}</span></div>
                <div className="strip-stat">💰<span>{me?.gold || 0}</span></div>
                <div className="strip-stat">💧<span>{me?.mana ?? 0}/{me?.maxMana ?? 0}</span></div>

                {/* End turn — ย้ายไปปุ่มกรอบทองมุมขวาล่างแมพ (.endturn-ornate) */}
              </div>
            );
          })()}
        </div>
      </div>{/* end .game-root */}

      <DiceAnimation roll={showDice} />
      <EventBanner event={activeEvent} />
      <EventCardModal reveal={eventModal} onClose={() => setEventModal(null)} />
      <InterruptPrompt
        interrupt={serverGameState?.pendingInterrupt}
        myIdx={myIdx}
        myHand={me?.hand || []}
        onRespond={(uid) => onGameAction("interrupt_respond", { cardUid: uid })}
      />
      <Tooltip tooltip={tooltip} />

      {/* ═══ LEGEND MODAL ═══ */}
      {showLegend && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto" }}
          onClick={() => setShowLegend(false)}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(201,168,76,.3)", borderRadius: "16px", padding: "24px", maxWidth: "680px", width: "95%", maxHeight: "85vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", marginBottom: "16px", fontSize: "16px", textAlign: "center" }}>
              📍 Legend — แผนที่ และสัญลักษณ์
            </h3>

            {/* สีพื้นผิว (Terrain) */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold-l)", fontSize: "11px", marginBottom: "8px", letterSpacing: ".15em" }}>🗺 พื้นผิวแมพ (TERRAIN)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                {[
                  { ico: "🌿", color: "#2d5a27", name: "ที่ราบ", move: 1, desc: "ทั่วไป" },
                  { ico: "🌲", color: "#1a4a1a", name: "ป่าไม้", move: 2, desc: "เดินช้า" },
                  { ico: "⛰️", color: "#4a4040", name: "ภูเขา", move: 3, desc: "เดินยาก" },
                  { ico: "🌊", color: "#1a3a5a", name: "แม่น้ำ", move: 3, desc: "ลุยน้ำ ช้า" },
                  { ico: "🏜️", color: "#6a5a30", name: "ทะเลทราย", move: 2, desc: "ร้อนจัด" },
                  { ico: "🌿", color: "#2a4a30", name: "หนองน้ำ", move: 3, desc: "ชื้นแฉะ" },
                ].map(t => (
                  <div key={t.name} style={{ background: t.color + "99", border: `1px solid ${t.color}`, borderRadius: "6px", padding: "6px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "16px" }}>{t.ico}</span>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: "bold" }}>{t.name}</div>
                      <div style={{ fontSize: "9px", color: "rgba(232,213,176,.6)" }}>ต้นทุนเดิน {t.move === 99 ? "∞(ผ่านไม่ได้)" : t.move} — {t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* หมวดสถานที่พิเศษ */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold-l)", fontSize: "11px", marginBottom: "8px", letterSpacing: ".15em" }}>🏰 หมวดสถานที่พิเศษ</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
                  <div key={key} style={{ background: val.bg + "cc", border: `1px solid ${val.border}`, borderRadius: "6px", padding: "5px 8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: val.border, flexShrink: 0 }} />
                    <span style={{ fontSize: "11px", color: val.border }}>{val.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* รายละเอียดสถานที่ทั้งหมด */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold-l)", fontSize: "11px", marginBottom: "8px", letterSpacing: ".15em" }}>📍 สถานที่ทั้งหมด</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
                {Object.entries(EXTENDED_SPECIAL_ZONES).map(([key, z]) => {
                  const cat = CATEGORY_COLORS[z.category] || {};
                  return (
                    <div key={key} style={{ background: cat.bg + "99", border: `1px solid ${cat.border || "#666"}`, borderRadius: "6px", padding: "5px 8px", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                      <span style={{ fontSize: "16px", flexShrink: 0 }}>{z.ico}</span>
                      <div>
                        <div style={{ fontSize: "11px", color: cat.border || "#ccc", fontWeight: "bold" }}>{z.name}</div>
                        <div style={{ fontSize: "9px", color: "rgba(232,213,176,.6)", lineHeight: 1.4 }}>{z.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* สัญลักษณ์ผู้เล่น */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold-l)", fontSize: "11px", marginBottom: "8px", letterSpacing: ".15em" }}>👥 สัญลักษณ์ผู้เล่น</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "5px" }}>
                {PLAYER_ICONS.slice(0, 6).map((ico, i) => (
                  <div key={i} style={{ background: "rgba(0,0,0,.3)", border: `1px solid ${PLAYER_COLORS[i]}`, borderRadius: "6px", padding: "5px", textAlign: "center" }}>
                    <div style={{ fontSize: "18px" }}>{ico}</div>
                    <div style={{ fontSize: "10px", color: PLAYER_COLORS[i] }}>{PLAYER_LABELS[i]}</div>
                    <div style={{ fontSize: "8px", color: "rgba(232,213,176,.5)" }}>แถบ HP สี{i === 0 ? "เหลือง" : i === 1 ? "แดง" : i === 2 ? "ม่วง" : i === 3 ? "เขียว" : i === 4 ? "ส้ม" : "น้ำเงิน"}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "8px", fontSize: "10px", color: "rgba(232,213,176,.6)", lineHeight: 1.7 }}>
                🟡 HP &gt;50% = เขียว | 🟠 HP 25-50% = เหลือง | 🔴 HP &lt;25% = แดง<br />
                ⭕ วงทองล้อมรอบ = เทิร์นปัจจุบัน | ⬤ ขอบขาว = ตัวคุณเอง
              </div>
            </div>

            <button className="tb-btn primary" style={{ width: "100%", padding: "10px", marginTop: "4px" }} onClick={() => setShowLegend(false)}>
              ✓ เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {/* ═══ SHOP MODAL ═══ */}
      {showShop && (() => {
        const shopCell = cells.find(c => c.key === showShop);
        if (!shopCell) return null;
        const shopItems = shopCell.shopItems || [];
        const zoneData = EXTENDED_SPECIAL_ZONES[shopCell.specialZone];
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowShop(null)}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(201,168,76,.4)", borderRadius: "16px", padding: "24px", maxWidth: "460px", width: "90%", maxHeight: "80vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", marginBottom: "4px", fontSize: "16px" }}>
              {zoneData?.ico} {zoneData?.name}
            </h3>
            <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "14px" }}>
              💰 ทองของคุณ: <span style={{ color: "var(--gold-l)", fontWeight: "bold" }}>{me?.gold || 0}</span>
            </div>
            {shopItems.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--txt-m)" }}>
                สินค้าหมดแล้ว 😔
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {shopItems.map(item => (
                  <div key={item.uid} style={{
                    background: "var(--s3)", border: "1px solid rgba(201,168,76,.2)",
                    borderRadius: "10px", padding: "10px", textAlign: "center",
                  }}>
                    <span style={{ fontSize: "24px" }}>{item.ico}</span>
                    <div style={{ fontFamily: "'Cinzel',serif", fontSize: "10px", color: "var(--gold)", marginTop: "4px" }}>{item.name}</div>
                    <div style={{ fontSize: "9px", color: "var(--txt-m)", margin: "3px 0" }}>{item.desc || item.effect}</div>
                    <div style={{ fontSize: "11px", color: RARITY[normRarity(item.rarity)]?.color || "#aaa", marginBottom: "6px" }}>
                      {RARITY[normRarity(item.rarity)]?.glyph} {RARITY[normRarity(item.rarity)]?.label}
                    </div>
                    <button
                      style={{
                        background: (me?.gold || 0) >= item.price ? "linear-gradient(135deg,var(--gold-d),var(--gold))" : "rgba(255,255,255,.1)",
                        color: (me?.gold || 0) >= item.price ? "#0d0b09" : "rgba(255,255,255,.3)",
                        border: "none", borderRadius: "6px", padding: "5px 12px",
                        cursor: (me?.gold || 0) >= item.price && isMyTurn ? "pointer" : "not-allowed",
                        fontSize: "11px", fontFamily: "'Cinzel',serif", width: "100%",
                      }}
                      disabled={!isMyTurn || (me?.gold || 0) < item.price}
                      onClick={() => handleBuy(item, shopCell)}
                    >
                      💰 {item.price} ทอง
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button style={{ marginTop: "12px", width: "100%", padding: "9px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "8px", color: "var(--txt-m)", cursor: "pointer", fontSize: "12px" }}
              onClick={() => setShowShop(null)}>
              ปิดร้าน
            </button>
          </div>
        </div>
        );
      })()}

      {/* ═══ QUEST PICK MODAL — เลือกเควสรองลับ (3 ตัวเลือกสุ่ม) ═══ */}
      {me?.questChoices?.length > 0 && !me?.quest && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(64,192,128,.4)", borderRadius: "16px", padding: "24px", maxWidth: "560px", width: "100%" }}>
            <div style={{ textAlign: "center", marginBottom: "6px" }}>
              <div style={{ fontSize: "40px" }}>📜</div>
              <h3 style={{ fontFamily: "'Cinzel',serif", color: "#40c080", margin: "4px 0" }}>เลือกเควสรองลับของคุณ</h3>
              <div style={{ fontSize: "11px", color: "var(--txt-m)", lineHeight: 1.6 }}>
                เลือก 1 จาก 3 ภารกิจ — เดินไปยังสถานที่เป้าหมายเพื่อทำให้สำเร็จ<br />
                🔒 เควสนี้เป็นความลับ ผู้เล่นอื่นมองไม่เห็น
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px", marginTop: "14px" }}>
              {me.questChoices.map(q => (
                <div key={q.id}
                  onClick={() => pickQuest(q.id)}
                  style={{ background: "var(--s3)", border: "1px solid rgba(64,192,128,.25)", borderRadius: "10px", padding: "12px 14px", cursor: "pointer", transition: "transform .1s" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.01)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "28px" }}>{q.ico}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", fontSize: "13px" }}>{q.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--txt-m)", margin: "2px 0" }}>{q.desc}</div>
                      <div style={{ fontSize: "10px", color: "#40c080" }}>
                        🏆 รางวัล: {[
                          q.reward.maxHp && `+${q.reward.maxHp} HP สูงสุด`, q.reward.maxMana && `+${q.reward.maxMana} มานาสูงสุด`,
                          q.reward.atk && `+${q.reward.atk} ATK`, q.reward.def && `+${q.reward.def} DEF`,
                          q.reward.spd && `+${q.reward.spd} SPD`, q.reward.gold && `+${q.reward.gold} ทอง`,
                        ].filter(Boolean).join(", ")}
                        {q.visitCount > 1 ? ` · ต้องไป ${q.visitCount} ครั้ง` : ""}
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--txt-d)", fontStyle: "italic", marginTop: "2px" }}>💬 {q.hint}</div>
                    </div>
                    <span style={{ color: "#40c080", fontSize: "12px" }}>เลือก →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ STATUS VIEW MODAL — ดูค่าสถานะ/อุปกรณ์ผู้เล่นทุกคน ═══ */}
      {showStatus && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 310, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "16px" }}
          onClick={() => setShowStatus(false)}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(201,168,76,.35)", borderRadius: "16px", padding: "22px", maxWidth: "720px", width: "100%", maxHeight: "86vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", marginBottom: "4px", fontSize: "16px", textAlign: "center" }}>📊 สถานะผู้เล่นทั้งหมด</h3>
            <div style={{ fontSize: "10px", color: "var(--txt-m)", textAlign: "center", marginBottom: "14px" }}>
              {fogActive ? "🌫️ ม่านหมอกปกคลุม — ข้อมูลของผู้เล่นอื่นถูกปกปิด (ยกเว้นพระราชา)" : "👆 คลิกผู้เล่นเพื่อดูความสามารถตัวละคร · อุปกรณ์ · ค่าพลังปัจจุบัน"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: "10px" }}>
              {players.map((p, i) => {
                const cls = CLASSES[p.classId] || CLASSES.hidden;
                const role = ROLES[p.role];
                const isPicked = statusSel === i;
                return (
                  <div key={i} onClick={() => setStatusSel(i)}
                    style={{ background: isPicked ? "rgba(201,168,76,.12)" : "var(--s3)", border: `1.5px solid ${isPicked ? "var(--gold)" : p.alive ? "rgba(201,168,76,.2)" : "rgba(192,64,64,.3)"}`, borderRadius: "10px", padding: "12px", opacity: p.alive ? 1 : 0.6, cursor: "pointer", transition: "border-color .12s, background .12s", boxShadow: isPicked ? "0 0 14px rgba(201,168,76,.25)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span style={{ width: 30, height: 30, borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "radial-gradient(circle at 38% 30%,#3a2d1a,#120c06)", border: `1.5px solid ${(CHARACTERS[p.charId]?.color || "var(--gold)")}` }}>
                        {p.alive ? <CharIcon ch={CHARACTERS[p.charId]} size={30} /> : "💀"}
                      </span>
                      <div>
                        <div style={{ fontSize: "12px", color: "var(--gold-l)", fontWeight: 600 }}>{p.name}{i === myIdx ? " (คุณ)" : ""}</div>
                        <div style={{ fontSize: "9px", color: "var(--txt-m)" }}>{role ? `${role.ico} ${role.name}` : "❓ บทบาทลับ"}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--txt-m)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px", marginBottom: "6px" }}>
                      <span>❤ HP {p.hp}/{p.maxHp}</span>
                      <span>💧 มานา {p.mana}/{p.maxMana}</span>
                      <span>⚔️ ATK {p.atk}</span>
                      <span>🛡️ DEF {p.def}</span>
                      <span>🗺 SPD {p.move}</span>
                      <span>🎯 ระยะ {p.range ?? 0}</span>
                      <span>💰 {p.gold}</span>
                      <span>⭐ Lv.{p.level || 1}</span>
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--gold)", marginBottom: "2px" }}>🎒 อุปกรณ์สวมใส่</div>
                    <div style={{ fontSize: "10px", color: "var(--txt-m)", marginBottom: "6px", minHeight: "16px" }}>
                      {p.equipment?.length > 0
                        ? p.equipment.map((e, ei) => (
                            <span key={ei} style={{ display: "inline-block", marginRight: "4px" }}>
                              {e.ico} {e.name}{e.atk ? ` +${e.atk}A` : ""}{e.def ? ` +${e.def}D` : ""}{e.range ? ` ระยะ${e.range}` : ""}
                            </span>
                          ))
                        : <span style={{ color: "var(--txt-d)" }}>— ไม่มี —</span>}
                    </div>
                    <div style={{ fontSize: "9px", color: "#c08040", marginBottom: "2px" }}>✨ สถานะ</div>
                    <div style={{ fontSize: "10px", color: "var(--txt-m)", minHeight: "14px" }}>
                      {p.statusEffects?.length > 0
                        ? p.statusEffects.map((s, si) => <span key={si} style={{ marginRight: "5px" }}>{s.type} ({s.duration}t)</span>)
                        : <span style={{ color: "var(--txt-d)" }}>— ปกติ —</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── ความสามารถตัวละคร — โชว์เฉพาะตัวที่เลือกในรอบนั้นๆ ── */}
            {(() => {
              const sp = players[statusSel];
              const ch = sp && CHARACTERS[sp.charId];
              if (!sp || !ch) return null;
              const skillRow = (tag, tagColor, s) => s && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "7px 0", borderBottom: "1px dashed rgba(201,168,76,.12)" }}>
                  <span style={{ flexShrink: 0, fontSize: "9px", fontWeight: 700, color: tagColor, border: `1px solid ${tagColor}`, borderRadius: "5px", padding: "2px 6px", minWidth: "58px", textAlign: "center" }}>{tag}</span>
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--gold-l)", fontWeight: 600 }}>{s.name}{s.cost ? <span style={{ color: "#6cb6e0", fontWeight: 400 }}> · 💧{s.cost}</span> : null}</div>
                    <div style={{ fontSize: "11px", color: "#e8d5b0", lineHeight: 1.55, opacity: .92 }}>{s.desc}</div>
                  </div>
                </div>
              );
              return (
                <div style={{ marginTop: "14px", background: "rgba(0,0,0,.25)", border: `1px solid ${ch.color || "var(--gold)"}55`, borderRadius: "12px", padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <span style={{ width: 76, height: 76, borderRadius: "12px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "40px", background: "radial-gradient(circle at 38% 30%,#3a2d1a,#0e0a06)", border: `2px solid ${ch.color || "var(--gold)"}`, boxShadow: `0 0 14px ${(ch.color || "#c9a84c")}55` }}>
                      <CharIcon ch={ch} size={76} round={false} />
                    </span>
                    <div>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: "16px", color: ch.color || "var(--gold)" }}>{ch.name}{statusSel === myIdx ? " (คุณ)" : ""}</div>
                      {(() => { const r = ROLES[sp.role]; return <div style={{ fontSize: "10px", color: "var(--txt-m)", margin: "2px 0" }}>{r ? `${r.ico} ${r.name}` : "❓ บทบาทลับ"} · ❤ {sp.hp}/{sp.maxHp} · 💧 {sp.mana}/{sp.maxMana}</div>; })()}
                      <div style={{ fontSize: "11px", color: "var(--txt-m)", lineHeight: 1.5 }}>{ch.desc}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "4px 10px", fontSize: "10px", color: "var(--txt-m)", marginBottom: "8px" }}>
                    <span>❤ HP {ch.hp}</span><span>💧 มานา {ch.mana}</span><span>🗺 SPD {ch.move}</span>
                    <span>⚔️ ATK {ch.atk}</span><span>🛡️ DEF {ch.def}</span><span>🎯 ระยะ {ch.range}</span>
                  </div>
                  {skillRow("🟢 Passive", "#4cc94c", ch.passive)}
                  {skillRow("🟡 Active", "#e8c84a", ch.active)}
                  {skillRow("👑 ราชา", "#c9a84c", ch.kingSkill)}
                </div>
              );
            })()}

            <button className="tb-btn primary" style={{ width: "100%", padding: "10px", marginTop: "14px" }} onClick={() => setShowStatus(false)}>✓ ปิด</button>
          </div>
        </div>
      )}

      {/* ═══ QUEST READ MODAL — อ่านเควสรองของตัวเองซ้ำ (ลับเฉพาะตัว) ═══ */}
      {showQuest && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 312, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => setShowQuest(false)}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(64,192,128,.4)", borderRadius: "16px", padding: "24px", maxWidth: "460px", width: "100%" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel',serif", color: "#40c080", marginBottom: "4px", fontSize: "16px", textAlign: "center" }}>📜 เควสรองของคุณ</h3>
            <div style={{ fontSize: "10px", color: "var(--txt-m)", textAlign: "center", marginBottom: "16px" }}>
              🔒 ความลับเฉพาะตัว — ผู้เล่นอื่นมองไม่เห็น
            </div>
            {me?.quest ? (() => {
              const q = me.quest;
              const zoneName = EXTENDED_SPECIAL_ZONES[q.targetZone]?.name || q.targetZone;
              const zoneIco = EXTENDED_SPECIAL_ZONES[q.targetZone]?.ico || "📍";
              return (
                <div style={{ background: "var(--s3)", border: `1px solid ${q.done ? "rgba(76,201,76,.4)" : "rgba(64,192,128,.25)"}`, borderRadius: "12px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "32px" }}>{q.ico}</span>
                    <div>
                      <div style={{ fontFamily: "'Cinzel',serif", color: q.done ? "#4cc94c" : "var(--gold)", fontSize: "15px" }}>
                        {q.name} {q.done ? "✓ สำเร็จแล้ว" : ""}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--txt-m)" }}>{q.desc}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: "#40c080", marginBottom: "4px" }}>
                    🎯 เป้าหมาย: {zoneIco} {zoneName}
                    {q.visitCount > 1 ? ` · ต้องไป ${q.visitCount} ครั้ง` : ""}
                  </div>
                  {!q.done && (
                    <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "4px" }}>
                      📈 คืบหน้า: {q.progress || 0}/{q.visitCount || 1}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: "var(--gold-l)", marginBottom: "4px" }}>
                    🏆 รางวัล: {[
                      q.reward?.maxHp && `+${q.reward.maxHp} HP สูงสุด`, q.reward?.maxMana && `+${q.reward.maxMana} มานาสูงสุด`,
                      q.reward?.atk && `+${q.reward.atk} ATK`, q.reward?.def && `+${q.reward.def} DEF`,
                      q.reward?.spd && `+${q.reward.spd} SPD`, q.reward?.gold && `+${q.reward.gold} ทอง`,
                    ].filter(Boolean).join(", ")}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--txt-d)", fontStyle: "italic" }}>💬 {q.hint}</div>
                </div>
              );
            })() : (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--txt-m)", fontSize: "12px" }}>
                ยังไม่ได้เลือกเควสรอง — เลือกจากหน้าต่างตอนเริ่มเกม
              </div>
            )}
            <button className="tb-btn primary" style={{ width: "100%", padding: "10px", marginTop: "16px" }} onClick={() => setShowQuest(false)}>✓ ปิด</button>
          </div>
        </div>
      )}

      {/* RULES — กฎละเอียด + หมวดวิธีเล่น */}
      {showRules && (
        <div className="rules-overlay" onClick={() => setShowRules(false)}>
          <div className="rules-panel" onClick={e => e.stopPropagation()}>
            <button className="rules-close" onClick={() => setShowRules(false)} aria-label="ปิด">✕</button>
            <div className="rules-head">
              <div className="rules-crest">📖</div>
              <h3 className="rules-title">คู่มือการเล่น</h3>
              <div className="rules-sub cinzel">บัลลังก์เงา · Shadow of Throne</div>
              <div className="rules-tag">เกมวางแผนชิงไหวชิงพริบ ผสมดวงลูกเต๋า — เอาตัวรอดและพิชิตเป้าหมายฝ่ายของคุณ</div>
            </div>

            <div className="rules-body">
            {(() => { const SECTIONS = [
              {
                cat: "ลำดับการเริ่มเกม", ico: "🎴", accent: "#e08040", items: [
                  ["1 · กดพร้อมในล็อบบี้", "ทุกคนเข้าห้องแล้วกด 'พร้อม' — ขั้นนี้ยังไม่ต้องเลือกตัวละคร"],
                  ["2 · สุ่มบทบาทลับ", "เมื่อเริ่มเกม ระบบจะ 'สุ่มแจกบทบาท' ให้ก่อน แตะการ์ดเพื่อเปิดดูบทบาทลับของตัวเอง แล้วกดยืนยัน — ห้ามให้คนอื่นเห็น!"],
                  ["3 · เลือกตัวละคร (👑 ราชาก่อน)", "หลังทุกคนยืนยันบทบาทแล้ว จึงเลือกตัวละคร — พระราชาเลือกก่อน 1 คน จากนั้นผู้เล่นที่เหลือเลือกพร้อมกัน · ห้ามเลือกซ้ำ (ตัวที่ถูกจองจะล็อก 🔒)"],
                  ["4 · เลือกเควสรอง", "เข้าสนามแล้วเลือกเควสรองลับ 1 จาก 3 ตัวเลือก เป็นเป้าหมายเสริมที่ให้รางวัล 'เพิ่มเพดานพลัง' เมื่อสำเร็จ"],
                  ["ของเริ่มต้น", "ทุกคนเริ่มด้วยการ์ดในมือ 4 ใบ, ทอง 4, และอุปกรณ์เริ่มต้นของตัวละคร (ถ้ามี)"],
                ]
              },
              {
                cat: "เป้าหมายและบทบาท", ico: "🎯", accent: "#c9a84c", items: [
                  ["บทบาทลับ", "เริ่มเกมทุกคนได้บทบาทลับ ยกเว้น 👑 พระราชาที่ต้องเปิดเผยตัวต่อทุกคน บทบาทอื่นจะถูกปิดไว้จนกว่าผู้เล่นนั้นจะแพ้ (ตาย) จึงเปิดเผย — สกิลสอดแนม/ทำนายจะเห็นบทบาท 'เฉพาะตัวคุณเอง' เท่านั้น ไม่เปิดให้ทั้งห้อง"],
                  ["พระราชา 👑", "รักษาบัลลังก์ ปราบกบฏให้หมด หรืออยู่รอดครบทุกเฟส — ยิ่งผู้เล่นในเกมมาก ราชายิ่งได้บัฟค่าสถานะสูงขึ้น (สมดุลกับการถูกรุม)"],
                  ["กบฏ ⚔️", "โค่นพระราชา (HP=0) เพื่อยึดอำนาจ"],
                  ["คนทรยศ/ราษฎร", "สะสมทรัพย์ เอาตัวรอดเป็นคนสุดท้าย"],
                ]
              },
              {
                cat: "ระบบเทิร์นและเฟส", ico: "🔄", accent: "#60a0c0", items: [
                  ["ลำดับเล่น", "พระราชาเปิดตัวและเริ่มเล่นก่อน จากนั้นสุ่มลำดับผู้เล่นที่เหลือ เมื่อทุกคนเล่นครบ 1 รอบ = 1 เฟส"],
                  ["จำนวนเฟส", `เกมมีทั้งหมด ${maxPhases} เฟส เมื่อทุกคนเล่นครบรอบจะขึ้นเฟสใหม่และเกิดเหตุการณ์สุ่มประจำเฟส (การ์ดจั่วเริ่มเทิร์น 2 ใบทุกเทิร์น)`],
                  ["👹 โหมดบอส", "หากเล่นครบทุกเฟสยังไม่มีผู้ชนะ บอสจะปรากฏและโจมตีทุกคนทุกเทิร์น แรงขึ้นเรื่อยๆ จนเหลือผู้ชนะ"],
                  ["🌫️ ม่านหมอก", "เฟสคู่จะเกิดม่านหมอก — ตัวละครของผู้เล่นอื่นจะหายไปจากแมพ (มองไม่เห็นตำแหน่ง/ชื่อ/อุปกรณ์) ยกเว้นผู้ที่ยืนช่องเดียวกันกับคุณจะเห็นได้ เมื่อจบเฟสม่านหมอกตัวละครทั้งหมดจะกลับมาแสดง — เฟส 1 แสดงเสมอ"],
                ]
              },
              {
                cat: "การเดิน (งบเดิน 5)", ico: "🚶", accent: "#4cc94c", items: [
                  ["งบเดิน 5 ต่อเทิร์น", "ทุกตัวละครได้ 'งบเดิน' 5 หน่วยต่อเทิร์น — แต่ละก้าวหักด้วยต้นทุนภูมิประเทศ (ที่ราบ 1 · ป่า/ทะเลทราย 2 · ภูเขา/หนองน้ำ 3 · น้ำผ่านไม่ได้)"],
                  ["เดินเป็นช่วงๆ ได้", "เดินทีละช่วงได้ — ถ้ายังเหลืองบเดิน ระบบจะคำนวณจากช่องที่เดินไปแล้วและให้เดินต่อได้อีก จนกว่างบจะหมด (ทำอย่างอื่นสลับได้)"],
                  ["✅ ยืนยันก่อนเดิน", "คลิกช่องปลายทางที่ไฮไลต์ → ช่องจะกระพริบพร้อมหมุด 📍 และมีปุ่มให้ 'ยืนยัน' หรือ 'ยกเลิก' ก่อนเดินจริง กันกดพลาด"],
                  ["🎯 ระยะโจมตี = อุปกรณ์ + SPD", "ระยะโจมตีพื้นฐานมาจากอุปกรณ์ระยะไกล (ธนู/ไม้เท้า) บวกโบนัสจากค่า SPD อัตราส่วน 2:1 (SPD 2 = +1 ระยะ) — ดูหมวด 'การต่อสู้'"],
                ]
              },
              {
                cat: "การต่อสู้ · ค่าสถานะ · ดวง", ico: "🎲", accent: "#c94040", items: [
                  ["💥 ดาเมจ = ATK − DEF", "เมื่อโจมตีโดน ความเสียหาย = ค่า ATK ของผู้โจมตี ลบด้วย DEF ของฝ่ายรับ (อย่างน้อย 1) — ยิ่ง ATK สูง/DEF เป้าต่ำ ยิ่งเจ็บ"],
                  ["⚡ SPD เพิ่มระยะ (2:1)", "ค่า SPD เพิ่มระยะโจมตีในอัตรา 2:1 (SPD 2 = +1 ระยะ) และยังเพิ่มโอกาสหลบด้วย"],
                  ["⚡ ชาร์จความเร็ว", "ถ้าเทิร์นนั้น 'ไม่เดิน และ ไม่โดนความเสียหาย' จะชาร์จ SPD +1 ต่อเทิร์น (สูงสุด +2) เพิ่มทั้งระยะและการหลบ — แต่เมื่อ 'เดินหรือโจมตี' SPD จะกลับคืนค่าเริ่มต้นทันที"],
                  ["ทอยโจมตี vs หลบ", "ผู้โจมตีทอย d6 + โบนัส ATK · ฝ่ายตั้งรับทอย d6 + โบนัสหลบ (จาก SPD และเลือดที่เหลือ)"],
                  ["ดวงมวยรอง", "ถ้าค่าสถานะ 2 ฝ่ายห่างกันมาก ฝ่ายที่อ่อนกว่าจะได้โบนัสหลบเพิ่ม พลิกเกมได้ด้วยดวง"],
                  ["ผลทอย", "ถ้าแต้มตั้งรับ ≥ แต้มโจมตี = หลบสำเร็จ · ทอย 6 = คริติคอล · ทอย 1 = พลาดเสมอ"],
                ]
              },
              {
                cat: "การ์ดและอุปกรณ์", ico: "🃏", accent: "#a060e0", items: [
                  ["ถือไพ่จำกัด", "ถือการ์ดในมือได้ไม่เกินค่า HP ปัจจุบัน (สูงสุด 10 ใบ) ถ้าเกินลิมิตจะต้องเลือกทิ้งเอง"],
                  ["จั่วเริ่มเทิร์น", "เริ่มเทิร์นจั่วการ์ด 2 ใบจากกองจั่ว — คลิกเปิดไพ่เพื่อลุ้น แล้วเก็บเข้ามือ"],
                  ["ใช้การ์ดได้ 4 ใบ/เทิร์น", "แต่ละเทิร์นใช้การ์ดได้ไม่เกิน 4 ใบ (รวมอาวุธ/เวทย์/กับดัก) — แยกจากการเดินและการโจมตี"],
                  ["อาวุธ/เกราะ", "ใช้เพื่อสวมใส่ถาวร เพิ่ม ATK/DEF/ระยะ และเอฟเฟกต์ (เผา/แช่แข็ง/สะท้อน ฯลฯ)"],
                  ["เวทมนตร์", "ใช้มานา ทำดาเมจ/ฟื้น HP/ติดสถานะ บางใบเป็น AOE โดนหลายเป้า"],
                  ["🪤 กับดัก", "วางได้เฉพาะช่องที่ยืน + รอบตัวระยะ 1 ช่อง (ช่องที่วางได้จะถูกไฮไลต์) — ใครก็ตามที่เดินเหยียบ (รวมถึงผู้วางเอง!) จะติดผลทั้งหมด (ดาเมจ/พิษ/ล็อก/ตาบอด/เผา/แช่แข็ง/สลายเกราะ) แล้วกับดักจะหายไปทันที"],
                ]
              },
              {
                cat: "ทรัพยากรและค่าสถานะ", ico: "📊", accent: "#40c0c0", items: [
                  ["❤ HP (เลือด)", "ค่าพลังชีวิต ถ้าลดถึง 0 = แพ้/ตาย และบทบาทจะถูกเปิดเผย · HP ยังเป็นลิมิตจำนวนการ์ดที่ถือได้ด้วย"],
                  ["💧 มานา", "ใช้ร่ายสกิล active และการ์ดเวทมนตร์ · ฟื้นได้จากบางสถานที่ (แม่น้ำ/หอเวทย์/โอเอซิส)"],
                  ["💰 ทอง", "ใช้ซื้อการ์ด/ของในร้านค้า · หาได้จากไร่นา ตลาด เควส สมบัติ"],
                  ["⚔️ ATK / 🛡️ DEF", "ATK ใช้คำนวณดาเมจ (ATK − DEF ของเป้า) · DEF ลดดาเมจที่รับ — รวมจากค่าพื้นฐาน + อุปกรณ์ + สถานะ"],
                  ["🗺 SPD (ความเร็ว)", "ค่าความเร็ว — เพิ่มระยะโจมตี (2:1) และโอกาสหลบ · ชาร์จเพิ่มได้เมื่ออยู่นิ่ง (ดูหมวดการต่อสู้)"],
                  ["🎯 ระยะโจมตี", "ระยะที่โจมตีถึง = อุปกรณ์ระยะไกล + โบนัสจาก SPD (2:1)"],
                ]
              },
              {
                cat: "สถานะผิดปกติ", ico: "☠️", accent: "#a060e0", items: [
                  ["☠️ พิษ (poison)", "เสีย HP ทุกต้นเทิร์นตามจำนวนเทิร์นที่ติด"],
                  ["🔥 เผา (burn)", "เสีย HP ต่อเนื่องทุกเทิร์น — ติดจากสกิลไฟ/กับดัก"],
                  ["❄️ แช่แข็ง (freeze) / 🔒 ล็อก (lock)", "ข้ามการกระทำบางอย่างในเทิร์นที่ติด (เดิน/โจมตีไม่ได้)"],
                  ["🌑 ตาบอด (blind) / 🛡️ สลายเกราะ (armor break)", "ลดความแม่นยำ / ลดค่า DEF ชั่วคราว"],
                  ["ล้างสถานะ", "การ์ด/สกิลบางอย่าง (เช่น หมอยา, นายพล) ล้างสถานะลบทั้งหมดได้"],
                ]
              },
              {
                cat: "ระบบสกิลตัวละคร", ico: "✨", accent: "#e8c84a", items: [
                  ["🟢 Passive", "ทำงานอัตโนมัติตลอดเกม ไม่ต้องสั่ง (เช่น เลือดนักรบ ATK+1 เมื่อ HP สูง)"],
                  ["🟡 Active", "กดปุ่มสกิลเพื่อใช้ ต้องมีมานาพอ — บางสกิลต้องเลือกเป้าหมาย (🎯)"],
                  ["👑 สกิลราชา", "ใช้ได้เฉพาะผู้ที่เป็นพระราชา · ส่วนใหญ่ใช้ได้ครั้งเดียวต่อเฟส — ยกเว้น 🔮 ทำนายชะตา (oracle) ที่เลือกดูบทบาทผู้เล่น 1 คน และใช้ได้ครั้งเดียวตลอดทั้งเกม"],
                ]
              },
              {
                cat: "สถานที่และเควส", ico: "🗺️", accent: "#40c080", items: [
                  ["สถานที่พิเศษ", "เดินไปสถานที่ต่างๆ เพื่อรับผล เช่น ร้านค้า 🛒 ฟื้นเลือด รับการ์ด หรือเสี่ยงดวง (กดปุ่ม 📍 Legend ดูทั้งหมด)"],
                  ["📜 เควสรองลับ", "ทุกคนเลือกเควสรอง 1 จาก 3 ตอนเริ่มเกม (ลับเฉพาะตัว คนอื่นไม่เห็น) เดินไปสถานที่เป้าหมายเพื่อรับรางวัล 'เพิ่มเพดานสถานะถาวร' (เช่น HP/มานาสูงสุด, ATK, DEF, SPD) + เงิน"],
                  ["📊 ดูสถานะ", "กดปุ่ม 📊 สถานะ บนแถบบน เพื่อดูอุปกรณ์และสถานะของผู้เล่นทุกคน"],
                ]
              },
              {
                cat: "เมื่อพระราชาล่ม & การพลิกฝ่าย", ico: "🗡️", accent: "#8c4cc9", items: [
                  ["ราชาตาย", "เมื่อพระราชาถูกกำจัด เกมยังไม่จบทันที — ราษฎรคนหนึ่งจะได้รับข้อเสนอ 'รับโชคชะตา' ภายในเวลาจำกัด"],
                  ["ยอมรับ → ทรยศ 🗡️", "ราษฎรที่ตอบรับจะกลายเป็น 'คนทรยศ' (โรลลับ) ส่วนราษฎรที่เหลือกลายเป็นกบฏ — ศึกชิงบัลลังก์รอบใหม่เริ่มขึ้น"],
                  ["ปฏิเสธ/หมดเวลา", "ถ้าไม่มีใครรับ ราษฎรทั้งหมดแพ้ไปพร้อมฝั่งพระราชา"],
                ]
              },
              {
                cat: "เงื่อนไขแพ้–ชนะ", ico: "🏆", accent: "#c9a84c", items: [
                  ["👑 พระราชาชนะ", "ปราบกบฏและทรยศทั้งหมด หรือครองบัลลังก์รอดจนครบทุกเฟส"],
                  ["⚔️ กบฏชนะ", "สังหารพระราชาและยึดบัลลังก์สำเร็จ"],
                  ["🗡️ ทรยศชนะ", "เป็นผู้รอดชีวิตคนสุดท้ายในสนาม"],
                  ["🧑 ราษฎร", "ชนะไปพร้อมพระราชา — หรือพลิกบทบาทเมื่อราชาล่ม"],
                ]
              },
            ];
            const active = Math.min(ruleTab, SECTIONS.length - 1);
            const sec = SECTIONS[active];
            return (
              <>
                {/* แถบหมวด — คลิกเลือกอ่านทีละหมวด (ไม่พับซ้อนกันจนอ่านไม่ออก) */}
                <div className="rules-tabs">
                  {SECTIONS.map((s, i) => (
                    <button key={s.cat} type="button"
                      className={`rules-tab${i === active ? " active" : ""}`}
                      style={{ "--accent": s.accent }}
                      onClick={() => setRuleTab(i)}>
                      <span className="rules-tab-ico">{s.ico}</span>
                      <span className="rules-tab-name cinzel">{s.cat}</span>
                    </button>
                  ))}
                </div>
                {/* เนื้อหาของหมวดที่เลือก */}
                <div className="rules-sec rules-sec-open" style={{ "--accent": sec.accent }}>
                  <div className="rules-sec-hd">
                    <span className="rules-sec-ico">{sec.ico}</span>
                    <span className="rules-sec-name cinzel">{sec.cat}</span>
                  </div>
                  <div className="rules-items">
                    {sec.items.map(([t, d]) => (
                      <div key={t} className="rule-item">
                        <div className="rule-t">{t}</div>
                        <div className="rule-d">{d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
            })()}
            </div>

            <button className="rules-ok cinzel" onClick={() => setShowRules(false)}>✓ เข้าใจแล้ว เริ่มเล่น</button>
          </div>
        </div>
      )}

      {/* ═══ DRAW REVEAL — เปิดไพ่ที่จั่วได้เริ่มเทิร์น (ลุ้น) ═══ */}
      {drawReveal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 340, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: "16px" }}>
          <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", fontSize: "18px", marginBottom: "4px" }}>🎴 จั่วการ์ดเริ่มเทิร์น</div>
          <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "18px" }}>
            {drawReveal.flipped.every(Boolean) ? "ได้การ์ดเหล่านี้!" : "คลิกการ์ดในกองเพื่อเปิดดู — ลุ้นกันหน่อย!"}
          </div>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            {/* กองจั่ว */}
            <div style={{ position: "relative", width: "74px", height: "104px" }}>
              {[0, 1, 2].map(k => (
                <div key={k} style={{
                  position: "absolute", top: -k * 2, left: -k * 2, width: "74px", height: "104px",
                  borderRadius: "10px", background: "linear-gradient(135deg,#241c10,#3a2c14)",
                  border: "1px solid rgba(201,168,76,.4)", boxShadow: "2px 3px 0 rgba(0,0,0,.4)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px",
                }}>{k === 2 ? "🂠" : ""}</div>
              ))}
            </div>
            <span style={{ fontSize: "22px", color: "var(--gold)" }}>→</span>
            {/* การ์ดที่จั่วได้ */}
            {drawReveal.cards.map((card, i) => {
              const flipped = drawReveal.flipped[i];
              return (
                <div key={card.uid || i}
                  onClick={() => !flipped && flipDrawCard(i)}
                  style={{
                    width: "108px", minHeight: "150px", borderRadius: "12px", padding: "10px",
                    background: flipped ? "linear-gradient(160deg,var(--s3),var(--s2))" : "linear-gradient(135deg,#241c10,#3a2c14)",
                    border: `2px solid ${flipped ? "var(--gold)" : "rgba(201,168,76,.4)"}`,
                    boxShadow: flipped ? "0 0 18px rgba(201,168,76,.45)" : "2px 3px 0 rgba(0,0,0,.4)",
                    cursor: flipped ? "default" : "pointer", textAlign: "center",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    transition: "transform .15s", animation: flipped ? "cardFlipIn .35s ease-out" : "none",
                  }}>
                  {flipped ? (
                    <>
                      <span style={{ fontSize: "34px" }}>{card.ico}</span>
                      <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", fontSize: "12px", margin: "6px 0 2px" }}>{card.name}</div>
                      <div style={{ fontSize: "9px", color: "var(--txt-m)", lineHeight: 1.4 }}>{card.desc}</div>
                      <div style={{ fontSize: "8px", color: "var(--txt-d)", marginTop: "4px" }}>
                        {card.type === "weapon" ? "🗡️ อาวุธ" : card.type === "magic" ? "🔮 เวทย์" : "🪤 กับดัก"}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: "44px", opacity: .85 }}>🂠</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "22px", display: "flex", gap: "10px" }}>
            {!drawReveal.flipped.every(Boolean) && (
              <button className="tb-btn" style={{ padding: "8px 18px" }}
                onClick={() => setDrawReveal(d => d ? { ...d, flipped: d.flipped.map(() => true) } : d)}>
                เปิดทั้งหมด
              </button>
            )}
            <button className="tb-btn primary" style={{ padding: "8px 22px" }}
              onClick={() => { setDrawReveal(null); setDrawSeen(true); }}>
              เก็บเข้ามือ ✓
            </button>
          </div>
        </div>
      )}

      {/* ═══ DISCARD MODAL — ถือไพ่เกินลิมิต ต้องเลือกทิ้งเอง ═══ */}
      {isMyTurn && !drawReveal && (me?.pendingDiscard > 0) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 330, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "var(--s2)", border: "1px solid rgba(224,80,80,.45)", borderRadius: "16px", padding: "22px", maxWidth: "640px", width: "100%", maxHeight: "86vh", overflowY: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: "12px" }}>
              <div style={{ fontSize: "34px" }}>🗑️</div>
              <h3 style={{ fontFamily: "'Cinzel',serif", color: "#e05050", margin: "4px 0" }}>ถือไพ่เกินลิมิต</h3>
              <div style={{ fontSize: "11px", color: "var(--txt-m)", lineHeight: 1.6 }}>
                ลิมิตมือ = HP ปัจจุบัน (สูงสุด 10) — เลือกทิ้งการ์ดเอง<br />
                <span style={{ color: "#e05050", fontWeight: 700 }}>ต้องทิ้งอีก {me.pendingDiscard} ใบ</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: "8px" }}>
              {me.hand?.map((card, ci) => (
                <div key={card.uid || ci}
                  onClick={() => discardCard(card.uid)}
                  style={{
                    background: "var(--s3)", border: "1px solid rgba(224,80,80,.3)", borderRadius: "10px",
                    padding: "10px", textAlign: "center", cursor: "pointer", transition: "transform .1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                  <span style={{ fontSize: "26px" }}>{card.ico}</span>
                  <div style={{ fontFamily: "'Cinzel',serif", color: "var(--gold)", fontSize: "10px", marginTop: "4px" }}>{card.name}</div>
                  <div style={{ fontSize: "8px", color: "var(--txt-m)", margin: "2px 0", minHeight: "22px", lineHeight: 1.3 }}>{card.desc}</div>
                  <div style={{ fontSize: "9px", color: "#e05050" }}>🗑️ ทิ้งใบนี้</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <WinScreen gameOver={gameOver} onLeave={onLeave} />
    </>
  );
}