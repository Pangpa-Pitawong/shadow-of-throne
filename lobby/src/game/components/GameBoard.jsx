import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "../styles/gameboard.css";

import { ROLES }       from "../constants/roles.js";
import { CLASSES }     from "../constants/classes.js";
import { WEAPON_CARDS, MAGIC_CARDS, TRAP_CARDS } from "../constants/cards.js";
import { TERRAIN, TERRAIN_COLORS, TERRAIN_STROKE, SPECIAL_ZONES } from "../constants/terrain.js";
import { PHASE_EVENTS } from "../constants/events.js";

import { hexToPixel, hexPoints, hexDistance, getNeighbors, getReachable } from "../utils/hexMath.js";
import { generateHexMap }  from "../utils/mapGenerator.js";
import { createPlayers, dealStartingCards, spawnPlayers } from "../utils/gameLogic.js";

import TopBar        from "./TopBar.jsx";
import LeftPanel     from "./LeftPanel.jsx";
import RightPanel    from "./RightPanel.jsx";
import BottomBar     from "./BottomBar.jsx";
import WinScreen     from "./overlays/WinScreen.jsx";
import DiceAnimation from "./overlays/DiceAnimation.jsx";
import EventBanner   from "./overlays/EventBanner.jsx";
import Tooltip       from "./overlays/Tooltip.jsx";

// ─── CONSTANTS ───────────────────────────────────────────────
const HEX_SIZE = 46;
const MAP_COLS = 13;
const MAP_ROWS = 11;
const HEX_W   = HEX_SIZE * 2;
const HEX_H   = Math.sqrt(3) * HEX_SIZE;
const MAP_W   = MAP_COLS * (HEX_W * 0.75) + HEX_W * 0.25 + 80;
const MAP_H   = MAP_ROWS * HEX_H + HEX_H * 0.5 + 100;
const ALL_CARDS = [...WEAPON_CARDS, ...MAGIC_CARDS, ...TRAP_CARDS];

function makeUid() { return `${Date.now()}-${Math.random()}`; }
function drawCard() { return { ...ALL_CARDS[Math.floor(Math.random() * ALL_CARDS.length)], uid: makeUid() }; }

// ─── EXTENDED SPECIAL ZONES ──────────────────────────────────
// เพิ่มสถานที่ใหม่หลายแห่ง: shop, quest, event, dungeon, etc.
const EXTENDED_SPECIAL_ZONES = {
  // สถานที่เดิม
  palace:      { name: "พระราชวัง",       ico: "🏰", effect: "king_buff",   desc: "ราชา HP+3 ทุกเฟส", color: "#c9a84c", category: "royal" },
  throne:      { name: "ศาลบัลลังก์",     ico: "⚖️", effect: "throne",     desc: "ราชา HP+3 / กบฏ HP-2", color: "#c9a84c", category: "royal" },
  village:     { name: "หมู่บ้าน",         ico: "🏘️", effect: "heal",       desc: "ฟื้น HP+2 เมื่อยืน", color: "#4cc94c", category: "safe" },
  market:      { name: "ตลาดกลาง",        ico: "🏪", effect: "trade",      desc: "ซื้อขายการ์ดได้ + ทอง+1", color: "#f0d080", category: "shop" },
  rebel_camp:  { name: "ค่ายกบฏ",         ico: "⛺", effect: "rebel_buff",  desc: "กบฏ ATK+2 HP+2", color: "#c94040", category: "faction" },
  dark_forest: { name: "ป่าดำ",           ico: "🌑", effect: "trap",       desc: "ซ่อนตัวได้ + กับดักฟรี", color: "#4a3a6a", category: "ambush" },
  tower:       { name: "หอเวทย์",         ico: "🗼", effect: "magic",      desc: "จั่วเวทย์ฟรี 1 ใบ + มานา+2", color: "#8060e0", category: "magic" },
  shrine:      { name: "ศาลเจ้า",         ico: "⛩️", effect: "full_heal",  desc: "ฟื้น HP เต็ม 1 ครั้ง/เกม", color: "#80c0ff", category: "holy" },
  cave:        { name: "ถ้ำมังกร",        ico: "🐉", effect: "treasure",   desc: "ทอย 4+: ทอง+3 / 1-3: HP-3", color: "#e05050", category: "danger" },
  // ─── สถานที่ใหม่ ───
  blacksmith:  { name: "ช่างตีเหล็ก",     ico: "⚒️", effect: "shop_weapon", desc: "🛒 ร้านอาวุธ — ซื้อการ์ดอาวุธ/เกราะ", color: "#e08040", category: "shop" },
  alchemist:   { name: "ร้านแม่มด",       ico: "🧪", effect: "shop_magic",  desc: "🛒 ร้านเวทย์ — ซื้อการ์ดเวทย์มนตร์", color: "#a050e0", category: "shop" },
  tavern:      { name: "โรงเตี๊ยม",       ico: "🍺", effect: "shop_info",   desc: "🛒 ซื้อข้อมูล + ฟื้น HP+1", color: "#c08040", category: "shop" },
  armory:      { name: "คลังอาวุธ",       ico: "🏯", effect: "draw_weapon", desc: "จั่วอาวุธฟรี 1 ใบ", color: "#8090a0", category: "loot" },
  dungeon:     { name: "คุกใต้ดิน",       ico: "🗝️", effect: "dungeon",    desc: "⚔️ ดันเจี้ยน — เสี่ยงอันตราย รับรางวัลใหญ่", color: "#605060", category: "danger" },
  quest_board: { name: "กระดานเควส",     ico: "📋", effect: "quest",       desc: "📋 รับเควส — EXP+3 ทอง+2", color: "#40c080", category: "quest" },
  treasure:    { name: "คลังสมบัติ",      ico: "💰", effect: "big_loot",    desc: "💰 สมบัติใหญ่ — ทอย ลุ้นรางวัล", color: "#ffd700", category: "loot" },
  farm:        { name: "ไร่นา",           ico: "🌾", effect: "farm",        desc: "ยืนที่นี่ทุกเทิร์น: ทอง+1", color: "#80c040", category: "resource" },
  river:       { name: "แม่น้ำศักดิ์สิทธิ์", ico: "🌊", effect: "mana_well", desc: "ฟื้นมานา+3 ทั้งหมด", color: "#4080c0", category: "magic" },
  ruins:       { name: "ซากปรักหักพัง",  ico: "🏚️", effect: "ruins",       desc: "ค้นหาสมบัติเก่า — เสี่ยงกับดัก", color: "#806040", category: "loot" },
  watchtower:  { name: "หอสังเกตการณ์",  ico: "🔭", effect: "spy",         desc: "เปิดเผยบทบาทผู้เล่น 1 คน", color: "#60a0c0", category: "intel" },
  graveyard:   { name: "สุสาน",           ico: "🪦", effect: "graveyard",   desc: "ได้การ์ดจากผู้ตาย / HP-1", color: "#607060", category: "dark" },
  volcano:     { name: "ภูเขาไฟ",         ico: "🌋", effect: "volcano",     desc: "⚠️ อันตรายสูง! DMG-4 / ATK+3 1 เทิร์น", color: "#e04020", category: "danger" },
  portal:      { name: "ประตูมิติ",       ico: "🌀", effect: "teleport",    desc: "เทเลพอร์ตไปสถานที่สุ่ม", color: "#4060e0", category: "special" },
  oasis:       { name: "โอเอซิส",         ico: "🌴", effect: "oasis",       desc: "ฟื้น HP+3 + มานา+2 (ทะเลทราย)", color: "#40c0a0", category: "safe" },
};

// ─── CATEGORY COLORS สำหรับ Legend ──────────────────────────
const CATEGORY_COLORS = {
  royal:    { bg: "#3a2a00", border: "#c9a84c", label: "สถานที่หลวง" },
  safe:     { bg: "#0a2a0a", border: "#4cc94c", label: "พื้นที่ปลอดภัย" },
  shop:     { bg: "#2a2000", border: "#f0d080", label: "ร้านค้า/ซื้อขาย" },
  faction:  { bg: "#2a0a0a", border: "#c94040", label: "พื้นที่ฝ่าย" },
  ambush:   { bg: "#0a0a1a", border: "#8060c0", label: "พื้นที่ซ่อนโจมตี" },
  magic:    { bg: "#1a0a3a", border: "#a060e0", label: "สถานที่เวทย์" },
  holy:     { bg: "#0a1a2a", border: "#80c0ff", label: "ศักดิ์สิทธิ์" },
  danger:   { bg: "#2a0808", border: "#e04040", label: "⚠️ อันตราย" },
  loot:     { bg: "#1a1a08", border: "#c0a040", label: "หาสมบัติ" },
  quest:    { bg: "#083a20", border: "#40c080", label: "เควส" },
  resource: { bg: "#0a1a08", border: "#80c040", label: "ทรัพยากร" },
  intel:    { bg: "#082028", border: "#60a0c0", label: "ข่าวกรอง" },
  dark:     { bg: "#101810", border: "#607060", label: "มืด/สุสาน" },
  special:  { bg: "#081018", border: "#4060e0", label: "พิเศษ" },
};

// ─── SHOP ITEMS สำหรับแต่ละร้าน ──────────────────────────────
function generateShopItems(shopType) {
  const items = [];
  if (shopType === "shop_weapon" || shopType === "draw_weapon") {
    const pool = WEAPON_CARDS;
    for (let i = 0; i < 4; i++) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      const price = card.rarity === "divine" ? 6 : card.rarity === "secret" ? 8 : 3;
      items.push({ ...card, uid: makeUid(), price });
    }
  } else if (shopType === "shop_magic") {
    const pool = MAGIC_CARDS;
    for (let i = 0; i < 4; i++) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      const price = card.rarity === "divine" ? 7 : 4;
      items.push({ ...card, uid: makeUid(), price });
    }
  } else if (shopType === "trade" || shopType === "shop_info") {
    const pool = ALL_CARDS;
    for (let i = 0; i < 5; i++) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      const price = card.rarity === "divine" ? 6 : card.rarity === "secret" ? 8 : card.rarity === "rare" ? 4 : 2;
      items.push({ ...card, uid: makeUid(), price });
    }
  } else {
    const pool = ALL_CARDS;
    for (let i = 0; i < 3; i++) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      items.push({ ...card, uid: makeUid(), price: 3 });
    }
  }
  return items;
}

// ─── PLAYER ICONS สำหรับแต่ละผู้เล่น ────────────────────────
const PLAYER_ICONS = ["👑", "⚔️", "🔮", "🏹", "🗡️", "✨"];
const PLAYER_COLORS = ["#c9a84c", "#c94040", "#8c4cc9", "#4cc94c", "#e08040", "#40c0c0"];
const PLAYER_LABELS = ["P1", "P2", "P3", "P4", "P5", "P6"];

// ─── EXTENDED MAP GENERATOR ──────────────────────────────────
// แทนที่ generateHexMap เดิมด้วยเวอร์ชันที่มีสถานที่มากขึ้น
function generateExtendedHexMap(cols = MAP_COLS, rows = MAP_ROWS) {
  const terrainPool = ["plains","plains","plains","forest","forest","mountain","water","desert","swamp"];
  const cells = [];

  // กำหนดสถานที่สำคัญ (fixed positions)
  const fixedSpecials = {
    "6,0":  "palace",
    "6,1":  "throne",
    "2,1":  "village",
    "6,5":  "market",
    "1,8":  "rebel_camp",
    "4,5":  "dark_forest",
    "9,2":  "tower",
    "0,10": "shrine",
    "11,9": "cave",
    // สถานที่ใหม่
    "3,3":  "blacksmith",
    "9,7":  "alchemist",
    "2,5":  "tavern",
    "10,4": "armory",
    "5,9":  "dungeon",
    "7,3":  "quest_board",
    "4,1":  "treasure",
    "8,9":  "farm",
    "6,3":  "river",
    "11,5": "ruins",
    "0,2":  "watchtower",
    "3,7":  "graveyard",
    "10,1": "volcano",
    "5,5":  "portal",
    "12,8": "oasis",
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `${col},${row}`;
      const specialZone = fixedSpecials[key] || null;

      let terrain;
      if (["palace","throne","village","market","quest_board","treasure","river","blacksmith","alchemist","tavern"].includes(specialZone)) {
        terrain = "plains";
      } else if (["dark_forest","rebel_camp","graveyard"].includes(specialZone)) {
        terrain = "forest";
      } else if (["cave","dungeon","volcano","ruins","armory","watchtower"].includes(specialZone)) {
        terrain = "mountain";
      } else if (["shrine","oasis"].includes(specialZone)) {
        terrain = "plains";
      } else if (["farm"].includes(specialZone)) {
        terrain = "plains";
      } else {
        terrain = terrainPool[Math.floor(Math.random() * terrainPool.length)];
      }

      // ขอบแมพบางส่วนเป็นน้ำ
      if ((col === 0 || col === cols-1) && Math.random() < 0.25) terrain = "water";
      if ((row === 0 || row === rows-1) && Math.random() < 0.2)  terrain = "water";

      // ป้องกันสถานที่สำคัญเป็นน้ำ
      if (specialZone) terrain = terrain === "water" ? "plains" : terrain;

      cells.push({
        col, row, key, terrain, specialZone,
        players: [], trap: null, item: null,
        shopItems: specialZone && ["shop_weapon","shop_magic","trade","shop_info","draw_weapon"].includes(
          EXTENDED_SPECIAL_ZONES[specialZone]?.effect
        ) ? generateShopItems(EXTENDED_SPECIAL_ZONES[specialZone]?.effect) : null,
      });
    }
  }
  return cells;
}

// ─── SPAWN ที่ขอบแมพ ─────────────────────────────────────────
function spawnAtEdge(players, cells) {
  // หาช่องขอบแมพทั้งหมดที่ไม่ใช่น้ำ
  const edgeCells = cells.filter(c =>
    c.terrain !== "water" &&
    !c.specialZone &&
    (c.col === 0 || c.col === MAP_COLS - 1 || c.row === 0 || c.row === MAP_ROWS - 1)
  );

  // แบ่งขอบเป็น 4 มุม เพื่อกระจายผู้เล่น
  const corners = [
    edgeCells.filter(c => c.col <= 2 && c.row <= 3),       // มุม TL
    edgeCells.filter(c => c.col >= MAP_COLS-3 && c.row <= 3), // มุม TR
    edgeCells.filter(c => c.col <= 2 && c.row >= MAP_ROWS-3), // มุม BL
    edgeCells.filter(c => c.col >= MAP_COLS-3 && c.row >= MAP_ROWS-3), // มุม BR
    edgeCells.filter(c => c.row === 0 || c.row === MAP_ROWS-1), // ขอบบน/ล่าง
    edgeCells.filter(c => c.col === 0 || c.col === MAP_COLS-1), // ขอบซ้าย/ขวา
  ];

  const used = new Set();
  return players.map((p, i) => {
    const pool = (corners[i % corners.length].filter(c => !used.has(c.key)));
    const fallback = edgeCells.filter(c => !used.has(c.key));
    const available = pool.length > 0 ? pool : fallback;
    if (available.length === 0) return { ...p, col: i * 2, row: 0 };
    const cell = available[Math.floor(Math.random() * available.length)];
    used.add(cell.key);
    return { ...p, col: cell.col, row: cell.row };
  });
}

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function GameBoard({ roomData, myIdx = 0, onLeave }) {
  const defaultPlayers = [
    { name: "P1 (คุณ)",  classId: "warrior", role: "king"     },
    { name: "P2",        classId: "mage",    role: "rebel"    },
    { name: "P3",        classId: "archer",  role: "rebel"    },
    { name: "P4",        classId: "cleric",  role: "commoner" },
  ];
  const initPlayers = roomData?.players?.map((p, i) => ({
    name:    p.name,
    classId: p.class || "warrior",
    role:    roomData.roles?.[i] || ["king","rebel","rebel","commoner"][i % 4],
  })) || defaultPlayers;

  // ── MAP STATE ──
  const [cells, setCells]           = useState(() => generateExtendedHexMap());
  const [mapOffset, setMapOffset]   = useState({ x: 0, y: 0 });
  const [zoom, setZoom]             = useState(1);
  const isDragging  = useRef(false);
  const dragStart   = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const mapAreaRef  = useRef(null);

  // ── GAME STATE ──
  const [players, setPlayers] = useState(() => {
    const base = createPlayers(initPlayers);
    // เพิ่ม icon/color ให้แต่ละผู้เล่น
    const withIcons = base.map((p, i) => ({
      ...p,
      playerIcon: PLAYER_ICONS[i] || "🧑",
      playerColor: PLAYER_COLORS[i] || "#888",
      playerLabel: PLAYER_LABELS[i] || `P${i+1}`,
    }));
    const spawned = spawnAtEdge(withIcons, generateExtendedHexMap());
    return spawned.map(p => ({ ...p, hand: Array.from({ length: 4 }, drawCard) }));
  });

  const [currentTurn, setCurrentTurn] = useState(0);
  const [phase, setPhase]             = useState(1);
  const [phaseStep, setPhaseStep]     = useState(0);
  const [actionsDone, setActionsDone] = useState({ moved: false, attacked: false, usedItem: false });
  const [actionMode, setActionMode]   = useState(null);
  const [selectedCard, setSelectedCard]     = useState(null);
  const [selectedCell, setSelectedCell]     = useState(null);
  const [reachableCells, setReachableCells] = useState([]);
  const [attackableCells, setAttackableCells] = useState([]);

  // ── LOG (ด้านขวา) ──
  const [log, setLog] = useState([
    { msg: "🏰 เกมเริ่มต้น! ทุกคนเกิดที่ขอบแมพ", type: "event" },
    { msg: "💡 เดินไปสถานที่ต่างๆ เพื่อรับของ ซื้อการ์ด และทำเควส", type: "" },
  ]);

  const [gameOver, setGameOver]   = useState(null);
  const [showDice, setShowDice]   = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [tooltip, setTooltip]     = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showShop, setShowShop]   = useState(null); // { cell, items }
  const [showQuest, setShowQuest] = useState(null);
  const [turnAnnounce, setTurnAnnounce] = useState(null);

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
      x: Math.round((rect.width  - MAP_W * fitZoom) / 2),
      y: Math.round((rect.height - MAP_H * fitZoom) / 2),
    });
  }, []);

  useEffect(() => {
    if (!mapAreaRef.current) return;
    const ro = new ResizeObserver(() => { centerMap(); ro.disconnect(); });
    ro.observe(mapAreaRef.current);
    return () => ro.disconnect();
  }, [centerMap]);

  // Wheel zoom
  useEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      setZoom(prev => {
        const next = Math.min(Math.max(prev * factor, 0.25), 2.5);
        setMapOffset(p => ({
          x: cx - (cx - p.x) * (next / prev),
          y: cy - (cy - p.y) * (next / prev),
        }));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const me            = players[myIdx];
  const currentPlayer = players[currentTurn];
  const isMyTurn      = useMemo(() => currentTurn === myIdx, [currentTurn, myIdx]);

  // ── MOVE CELLS ──
  useEffect(() => {
    if (actionMode === "move" && !actionsDone.moved) {
      const cp = players[currentTurn];
      const startCell = cells.find(c => c.col === cp.col && c.row === cp.row);
      if (startCell) setReachableCells(getReachable(startCell, cp.move, cells, TERRAIN));
    } else {
      setReachableCells([]);
    }
  }, [actionMode, actionsDone.moved, cells, players, currentTurn]);

  // ── ATTACK CELLS ──
  useEffect(() => {
    if (actionMode === "attack" && !actionsDone.attacked) {
      const cp = players[currentTurn];
      const range = cp.classId === "archer" ? 4 : cp.classId === "mage" ? 3 : 1;
      const cpCell = { col: cp.col, row: cp.row };
      setAttackableCells(cells.filter(c => {
        const d = hexDistance(cpCell, c);
        return d > 0 && d <= range;
      }));
    } else {
      setAttackableCells([]);
    }
  }, [actionMode, actionsDone.attacked, cells, players, currentTurn]);

  // ── ZONE EFFECT ──────────────────────────────────────────────
  const applyZoneEffect = useCallback((cell, playerIdx) => {
    const zone = cell.specialZone;
    const zoneData = EXTENDED_SPECIAL_ZONES[zone];
    if (!zone || !zoneData) return;

    const effect = zoneData.effect;

    // ร้านค้า → เปิด modal
    if (["shop_weapon","shop_magic","trade","shop_info"].includes(effect)) {
      if (cell.shopItems && cell.shopItems.length > 0) {
        setShowShop({ cell, items: cell.shopItems });
        addLog(`🛒 ${players[playerIdx]?.name} เข้าร้าน ${zoneData.name}`, "event");
      }
      return;
    }
    // เควส
    if (effect === "quest") {
      setShowQuest({ playerIdx, cell });
      addLog(`📋 ${players[playerIdx]?.name} พบกระดานเควส!`, "event");
      return;
    }

    setPlayers(ps => ps.map((p, i) => {
      if (i !== playerIdx) return p;
      switch(effect) {
        case "king_buff": case "throne":
          if (p.role === "king")  { addLog(`⚖️ ${p.name} HP+3 (บัลลังก์)`, "heal"); return { ...p, hp: Math.min(p.maxHp, p.hp+3) }; }
          if (p.role === "rebel") { addLog(`⚖️ ${p.name} HP-2 (ต้องแค้น)`, "dmg");  return { ...p, hp: Math.max(0, p.hp-2) }; }
          return p;
        case "heal":
          addLog(`🏘️ ${p.name} ฟื้น HP+2`, "heal"); return { ...p, hp: Math.min(p.maxHp, p.hp+2) };
        case "rebel_buff":
          if (p.role === "rebel") { addLog(`⛺ กบฏ ATK+2 HP+2!`, "heal"); return { ...p, atk: p.atk+2, hp: Math.min(p.maxHp, p.hp+2) }; }
          return p;
        case "full_heal":
          if (!p._shrineUsed) { addLog(`⛩️ ${p.name} ฟื้น HP เต็ม!`, "heal"); return { ...p, hp: p.maxHp, _shrineUsed: true }; }
          addLog(`⛩️ ${p.name} ใช้ศาลเจ้าไปแล้ว`, ""); return p;
        case "magic": {
          const magic = MAGIC_CARDS[Math.floor(Math.random()*MAGIC_CARDS.length)];
          addLog(`🗼 ${p.name} ได้เวทย์ "${magic.name}" + มานา+2`, "event");
          return { ...p, mana: Math.min(p.maxMana, p.mana+2), hand: [...p.hand, { ...magic, uid: makeUid() }] };
        }
        case "draw_weapon": case "armory": {
          const w = WEAPON_CARDS[Math.floor(Math.random()*WEAPON_CARDS.length)];
          addLog(`⚒️ ${p.name} ได้อาวุธ "${w.name}"`, "event");
          return { ...p, hand: [...p.hand, { ...w, uid: makeUid() }] };
        }
        case "mana_well":
          addLog(`🌊 ${p.name} มานา+3!`, "heal"); return { ...p, mana: Math.min(p.maxMana, p.mana+3) };
        case "farm":
          addLog(`🌾 ${p.name} ทำนา ทอง+1`, ""); return { ...p, gold: p.gold+1 };
        case "treasure": case "big_loot": {
          const roll = Math.ceil(Math.random()*6);
          setShowDice(roll); setTimeout(() => setShowDice(null), 800);
          if (roll >= 4) { const c = drawCard(); addLog(`💰 ${p.name} 🎲${roll} พบสมบัติ "${c.name}"!`, "event"); return { ...p, hand: [...p.hand, c] }; }
          else { addLog(`💰 ${p.name} 🎲${roll} ไม่พบอะไร HP-1`, "dmg"); return { ...p, hp: Math.max(0, p.hp-1) }; }
        }
        case "ruins": {
          const roll = Math.ceil(Math.random()*6);
          if (roll >= 4) { const c = drawCard(); addLog(`🏚️ ${p.name} 🎲${roll} ขุดพบ "${c.name}"`, "event"); return { ...p, hand: [...p.hand, c] }; }
          else { addLog(`🏚️ ${p.name} 🎲${roll} โดนกับดักเก่า! HP-2`, "dmg"); return { ...p, hp: Math.max(0, p.hp-2) }; }
        }
        case "dungeon": {
          const roll = Math.ceil(Math.random()*6);
          setShowDice(roll); setTimeout(() => setShowDice(null), 800);
          if (roll >= 5) {
            const c1 = drawCard(), c2 = drawCard();
            addLog(`🗝️ ${p.name} 🎲${roll} บุกดันเจี้ยน! ได้ ${c1.name} + ${c2.name} + ทอง+3`, "event");
            return { ...p, gold: p.gold+3, hand: [...p.hand, c1, c2] };
          } else if (roll >= 3) {
            const c = drawCard();
            addLog(`🗝️ ${p.name} 🎲${roll} ดันเจี้ยน ได้ "${c.name}"`, "event");
            return { ...p, hand: [...p.hand, c] };
          } else {
            addLog(`🗝️ ${p.name} 🎲${roll} ดันเจี้ยนอันตราย! HP-4`, "dmg");
            return { ...p, hp: Math.max(0, p.hp-4) };
          }
        }
        case "cave": {
          const roll = Math.ceil(Math.random()*6);
          setShowDice(roll); setTimeout(() => setShowDice(null), 800);
          if (roll >= 4) { addLog(`🐉 ${p.name} 🎲${roll} หนีมังกร! +3 ทอง`, "event"); return { ...p, gold: p.gold+3 }; }
          else           { addLog(`🐉 ${p.name} 🎲${roll} โดนมังกร! HP-3`, "dmg");   return { ...p, hp: Math.max(0, p.hp-3) }; }
        }
        case "volcano": {
          const roll = Math.ceil(Math.random()*6);
          if (roll >= 5) { addLog(`🌋 ${p.name} 🎲${roll} พลังภูเขาไฟ ATK+3!`, "event"); return { ...p, atk: p.atk+3 }; }
          else { addLog(`🌋 ${p.name} 🎲${roll} ลาวา! HP-4`, "dmg"); return { ...p, hp: Math.max(0, p.hp-4) }; }
        }
        case "graveyard": {
          addLog(`🪦 ${p.name} ค้นหาในสุสาน HP-1`, "dmg");
          const c = drawCard();
          addLog(`🪦 ได้การ์ด "${c.name}" จากวิญญาณ`, "event");
          return { ...p, hp: Math.max(0, p.hp-1), hand: [...p.hand, c] };
        }
        case "teleport": case "portal": {
          const nonWater = cells.filter(c => c.terrain !== "water" && !c.specialZone);
          const target = nonWater[Math.floor(Math.random()*nonWater.length)];
          if (target) {
            addLog(`🌀 ${p.name} เทเลพอร์ต!`, "event");
            return { ...p, col: target.col, row: target.row };
          }
          return p;
        }
        case "oasis":
          addLog(`🌴 ${p.name} โอเอซิส HP+3 มานา+2`, "heal");
          return { ...p, hp: Math.min(p.maxHp, p.hp+3), mana: Math.min(p.maxMana, p.mana+2) };
        case "spy": case "watchtower": {
          const others = players.filter((_, j) => j !== playerIdx && players[j]?.alive);
          if (others.length > 0) {
            const target = others[Math.floor(Math.random()*others.length)];
            addLog(`🔭 ${p.name} สอดแนม → ${target.name} เป็น ${ROLES[target.role]?.ico} ${ROLES[target.role]?.name}!`, "event");
          }
          return p;
        }
        case "trap":
          addLog(`🌑 ${p.name} ซ่อนตัวในป่าดำได้`, ""); return p;
        default: return p;
      }
    }));

    // กับดักบนพื้น
    if (cell.trap && cell.trap.ownerId !== playerIdx) {
      const trap = cell.trap;
      addLog(`🪤 ${players[playerIdx]?.name} โดนกับดัก "${trap.name}"!`, "dmg");
      setPlayers(ps => ps.map((p, i) =>
        i !== playerIdx ? p : { ...p, hp: Math.max(0, p.hp - (trap.dmg || 0)) }
      ));
      setCells(cs => cs.map(c => c.key === cell.key ? { ...c, trap: null } : c));
    }
  }, [players, cells, addLog]);

  // ── CHECK WIN ──
  const checkWin = useCallback(() => {
    setPlayers(ps => {
      const alive  = ps.filter(p => p.alive);
      const king   = ps.find(p => p.role === "king");
      const rebels = ps.filter(p => p.role === "rebel");
      if (!king?.alive && rebels.some(r => r.alive))
        setGameOver({ winner:"rebel", reason:"กบฏโค่นบัลลังก์สำเร็จ! 🏴", players: rebels.filter(r => r.alive) });
      if (rebels.every(r => !r.alive) && king?.alive)
        setGameOver({ winner:"king",  reason:"พระราชาปราบกบฏสำเร็จ! 👑", players:[king] });
      if (alive.length === 1)
        setGameOver({ winner:alive[0].role, reason:`${alive[0].name} รอดคนสุดท้าย!`, players:[alive[0]] });
      return ps;
    });
  }, []);

  // ── ATTACK ──
  const performAttack = useCallback((attackerId, defenderId) => {
    const attacker = players[attackerId];
    const defender = players[defenderId];
    const roll = Math.ceil(Math.random()*6);
    setShowDice(roll); setTimeout(() => setShowDice(null), 800);
    if (roll < 3) {
      addLog(`🎯 ${attacker.name} โจมตี ${defender.name} — พลาด! (🎲${roll})`, "dmg");
      setActionsDone(a => ({ ...a, attacked: true }));
      setActionMode(null); return;
    }
    const crit     = roll === 6;
    const finalDmg = Math.max(1, attacker.atk + (crit ? 2 : 0) - defender.def);
    setPlayers(ps => ps.map(p => {
      if (p.id !== defenderId) return p;
      const newHp = Math.max(0, p.hp - finalDmg);
      if (newHp === 0 && p.alive) {
        addLog(`💀 ${p.name} (${ROLES[p.role]?.ico}${ROLES[p.role]?.name}) ถูกกำจัด!`, "death");
        setTimeout(() => checkWin(), 200);
      }
      return { ...p, hp: newHp, alive: newHp > 0 };
    }));
    addLog(`⚔️ ${attacker.name} → ${defender.name} ${finalDmg} ดาเมจ 🎲${roll}${crit?" ✨คริต!":""}`, "dmg");
    setActionsDone(a => ({ ...a, attacked: true }));
    setActionMode(null);
  }, [players, addLog, checkWin]);

  // ── USE CARD ──
  const useCard = useCallback((card, targetCell, playerIdx) => {
    const cp = players[playerIdx];
    const targetPlayer = players.find(p => p.alive && p.col === targetCell.col && p.row === targetCell.row);
    if (MAGIC_CARDS.some(m => m.id === card.id)) {
      if (cp.mana < (card.cost || 0)) { addLog(`❌ มานาไม่พอ`, "dmg"); return; }
      setPlayers(ps => ps.map(p => {
        if (p.id === playerIdx)
          return { ...p, mana: Math.max(0, p.mana-(card.cost||0)), hand: p.hand.filter(h => h.uid !== card.uid) };
        if (targetPlayer && p.id === targetPlayer.id) {
          const newHp = Math.min(p.maxHp, Math.max(0, p.hp-(card.dmg||0)+(card.heal||0)));
          addLog(`✨ ${cp.name} ใช้ "${card.name}" → ${targetPlayer.name}`, "event");
          return { ...p, hp: newHp };
        }
        return p;
      }));
    } else {
      setPlayers(ps => ps.map(p => {
        if (p.id !== playerIdx) return p;
        addLog(`🗡️ ${cp.name} สวมใส่ "${card.name}"`, "");
        return { ...p, atk: p.atk+(card.atk||0), def: p.def+(card.def||0), hand: p.hand.filter(h => h.uid !== card.uid) };
      }));
    }
    setActionsDone(a => ({ ...a, usedItem: true }));
  }, [players, addLog]);

  // ── CELL CLICK ──
  const currentTurnRef = useRef(currentTurn);
  useEffect(() => { currentTurnRef.current = currentTurn; }, [currentTurn]);

  const handleCellClick = useCallback((cell) => {
    if (currentTurnRef.current !== myIdx) return;
    const cp = players[currentTurnRef.current];

    if (actionMode === "move") {
      if (!reachableCells.some(c => c.key === cell.key)) return;
      setPlayers(ps => ps.map((p, i) => i === currentTurnRef.current ? { ...p, col: cell.col, row: cell.row } : p));
      setActionsDone(a => ({ ...a, moved: true }));
      setActionMode(null);
      const zoneData = EXTENDED_SPECIAL_ZONES[cell.specialZone];
      addLog(`🚶 ${cp.name} → ${zoneData?.name || TERRAIN[cell.terrain]?.name}`, "");
      applyZoneEffect(cell, currentTurnRef.current);
    } else if (actionMode === "attack") {
      const target = players.find(p => p.alive && p.col === cell.col && p.row === cell.row && p.id !== currentTurnRef.current);
      if (!target) return;
      performAttack(currentTurnRef.current, target.id);
    } else if (actionMode === "card" && selectedCard) {
      useCard(selectedCard, cell, currentTurnRef.current);
      setSelectedCard(null); setActionMode(null);
    } else if (actionMode === "trap" && selectedCard) {
      setCells(cs => cs.map(c => c.key === cell.key ? { ...c, trap: { ...selectedCard, ownerId: currentTurnRef.current } } : c));
      setPlayers(ps => ps.map((p, i) => i === currentTurnRef.current ? { ...p, hand: p.hand.filter(h => h.uid !== selectedCard.uid) } : p));
      setActionsDone(a => ({ ...a, usedItem: true }));
      setSelectedCard(null); setActionMode(null);
      addLog(`🪤 ${cp.name} วางกับดัก "${selectedCard.name}"`, "");
    }
    setSelectedCell(cell);
  }, [actionMode, myIdx, players, reachableCells, selectedCard, applyZoneEffect, performAttack, useCard, addLog]);

  // ── PHASE EVENT ──
  const applyPhaseEvent = useCallback((ev) => {
    setPlayers(ps => ps.map(p => {
      if (!p.alive) return p;
      if (ev.fx === "gold_all") return { ...p, gold: p.gold+2 };
      if (ev.fx === "heal_all") return { ...p, hp: Math.min(p.maxHp, p.hp+3) };
      if (ev.fx === "dmg_all")  return { ...p, hp: Math.max(1, p.hp-2) };
      if (ev.fx === "atk_all")  return { ...p, atk: p.atk+1 };
      return p;
    }));
  }, []);

  // ── END TURN (FIX: ส่งต่อคนถัดไปถูกต้อง) ──────────────────
  const endTurn = useCallback(() => {
    if (gameOver) return;
    const snap = players;

    // หา next player ที่มีชีวิต
    let next = (currentTurn + 1) % snap.length;
    let guard = 0;
    while (!snap[next]?.alive && guard < snap.length) {
      next = (next + 1) % snap.length;
      guard++;
    }

    const aliveCount = snap.filter(p => p.alive).length;
    const newStep    = phaseStep + 1;
    const phaseOver  = newStep >= aliveCount;
    const newPhase   = phaseOver ? phase + 1 : phase;

    if (phaseOver && newPhase > 6) {
      const top = [...snap].filter(p => p.alive).sort((a, b) => b.hp - a.hp)[0];
      setGameOver({ winner: top?.role || "draw", reason:"ครบ 6 เฟส! ผู้ชนะโดย HP สูงสุด", players: top ? [top] : [] });
      return;
    }

    // Update players: tick status + mana regen + draw
    setPlayers(ps => {
      let updated = ps.map(p => {
        if (!p.alive) return p;
        let hp = p.hp;
        const effects = p.statusEffects?.map(s => ({ ...s, duration: s.duration-1 })).filter(s => s.duration > 0) || [];
        p.statusEffects?.forEach(s => {
          if (s.type === "burn" || s.type === "poison") hp = Math.max(0, hp-1);
        });
        return { ...p, hp, mana: Math.min(p.maxMana, p.mana+1), statusEffects: effects };
      });

      if (phaseOver) {
        updated = updated.map(p => !p.alive ? p : ({
          ...p, hand: [...p.hand, drawCard(), drawCard()].slice(-8),
        }));
      }

      // จั่ว 1 ใบให้คนถัดไป
      updated = updated.map((p, i) =>
        i === next ? { ...p, hand: [...p.hand, drawCard()].slice(-8) } : p
      );

      return updated;
    });

    if (phaseOver) {
      setPhase(newPhase);
      const ev = PHASE_EVENTS[Math.floor(Math.random()*PHASE_EVENTS.length)];
      setActiveEvent(ev);
      applyPhaseEvent(ev);
      setTimeout(() => setActiveEvent(null), 3000);
      addLog(`📜 เฟส ${newPhase}: ${ev.ico} ${ev.name} — ${ev.desc}`, "event");
    }

    // ── RESET ทั้งหมดพร้อมกัน ──
    setPhaseStep(phaseOver ? 0 : newStep);
    setCurrentTurn(next);
    setActionsDone({ moved: false, attacked: false, usedItem: false });
    setActionMode(null);
    setSelectedCard(null);
    setSelectedCell(null);
    setReachableCells([]);
    setAttackableCells([]);

    const nextName = snap[next]?.name || "?";
    setTurnAnnounce(`🔔 เทิร์นของ ${nextName}`);
    setTimeout(() => setTurnAnnounce(null), 2000);
    addLog(`🔔 เทิร์นของ ${nextName} (เฟส ${newPhase})`, "turn");

    checkWin();
  }, [gameOver, currentTurn, phase, phaseStep, players, addLog, checkWin, applyPhaseEvent]);

  // ── SHOP BUY ──
  const handleBuy = useCallback((item, shopCell) => {
    const cp = players[myIdx];
    if (!cp || cp.gold < item.price) {
      addLog(`❌ ทองไม่พอ (ต้องการ ${item.price} มี ${cp?.gold || 0})`, "dmg");
      return;
    }
    setPlayers(ps => ps.map((p, i) => {
      if (i !== myIdx) return p;
      const newCard = { ...item, uid: makeUid() };
      addLog(`🛒 ${p.name} ซื้อ "${item.name}" ราคา ${item.price} ทอง`, "event");
      return { ...p, gold: p.gold - item.price, hand: [...p.hand, newCard].slice(-8) };
    }));
    // ลบสินค้าออกจากร้าน
    setCells(cs => cs.map(c => {
      if (c.key !== shopCell.key || !c.shopItems) return c;
      return { ...c, shopItems: c.shopItems.filter(s => s.uid !== item.uid) };
    }));
    setShowShop(prev => prev ? { ...prev, items: prev.items.filter(s => s.uid !== item.uid) } : null);
  }, [players, myIdx, addLog]);

  // ── QUEST COMPLETE ──
  const handleQuest = useCallback((playerIdx) => {
    setPlayers(ps => ps.map((p, i) => {
      if (i !== playerIdx) return p;
      addLog(`📋 ${p.name} ทำเควสสำเร็จ! +3 EXP +2 ทอง`, "event");
      return { ...p, gold: p.gold + 2, exp: (p.exp || 0) + 3 };
    }));
    setShowQuest(null);
  }, [addLog]);

  // ── MAP DRAG ──
  const handleMapMouseDown = e => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current  = { x: e.clientX, y: e.clientY, ox: mapOffset.x, oy: mapOffset.y };
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
          <div style={{ fontSize:"48px", marginBottom:"12px" }}>🏰</div>
          <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold)", fontSize:"18px", marginBottom:"8px" }}>บัลลังก์เงา</div>
          <div style={{ color:"var(--txt-m)", fontSize:"13px" }}>กรุณาใช้หน้าจอขนาดใหญ่</div>
        </div>
      </div>

      <div className="game-root">
        {/* TOP BAR */}
        <TopBar
          phase={phase} phaseStep={phaseStep}
          currentPlayer={currentPlayer} isMyTurn={isMyTurn}
          onEndTurn={endTurn} onCenter={centerMap}
          onToggleRules={() => setShowRules(r => !r)}
          onLeave={onLeave}
        />

        {/* LEFT PANEL — Players */}
        <LeftPanel players={players} currentTurn={currentTurn} myIdx={myIdx} me={me} setTooltip={setTooltip} />

        {/* RIGHT PANEL — Log (ด้านขวา) */}
        <RightPanel log={log} />

        {/* MAP AREA */}
        <div
          className="map-area" ref={mapAreaRef}
          onMouseDown={handleMapMouseDown}
          onMouseMove={handleMapMouseMove}
          onMouseUp={handleMapMouseUp}
          onMouseLeave={handleMapMouseUp}
        >
          <svg
            className="hex-map-svg"
            width={MAP_W} height={MAP_H}
            style={{
              position:"absolute", top:0, left:0,
              transform:`translate(${mapOffset.x}px,${mapOffset.y}px) scale(${zoom})`,
              transformOrigin:"0 0", overflow:"visible",
            }}
          >
            {/* ── Hex Cells ── */}
            {cells.map(cell => {
              const { x, y }     = hexToPixel(cell.col, cell.row, HEX_SIZE);
              const isReachable  = reachableCells.some(c => c.key === cell.key);
              const isAttackable = attackableCells.some(c => c.key === cell.key);
              const isSelected   = selectedCell?.key === cell.key;
              const hasEnemy     = players.some(p => p.alive && p.col === cell.col && p.row === cell.row && p.id !== currentTurn);
              const zoneData     = EXTENDED_SPECIAL_ZONES[cell.specialZone];
              const terrain      = TERRAIN[cell.terrain] || TERRAIN.plains;
              const fill         = TERRAIN_COLORS[cell.terrain] || "#2d5a27";
              const stroke       = TERRAIN_STROKE[cell.terrain]  || "#3a7a35";
              const cat          = zoneData?.category;
              const catColor     = cat ? CATEGORY_COLORS[cat] : null;

              return (
                <g
                  key={cell.key}
                  className={`hex-cell${isReachable?" hex-reachable":""}${isAttackable?" hex-attackable":""}${isSelected?" hex-selected":""}`}
                  onClick={() => handleCellClick(cell)}
                  onMouseEnter={e => {
                    if (zoneData || cell.terrain !== "plains")
                      setTooltip({ x: e.clientX+12, y: e.clientY+12, title: zoneData?.name || terrain.name, desc: zoneData?.desc || `ต้นทุนเดิน: ${terrain.moveCost}` });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* พื้นฐาน terrain */}
                  <polygon className="hex-bg" points={hexPoints(x, y, HEX_SIZE-2)} fill={fill} stroke={stroke} strokeWidth="1" />
                  {/* สีเน้นสถานที่พิเศษ */}
                  {catColor && <polygon points={hexPoints(x, y, HEX_SIZE-2)} fill={catColor.bg + "88"} stroke={catColor.border} strokeWidth="1.5" />}
                  {/* highlight reachable/attackable */}
                  {isReachable  && <polygon points={hexPoints(x, y, HEX_SIZE-2)} fill="rgba(76,201,76,.22)"  stroke="none" />}
                  {isAttackable && <polygon points={hexPoints(x, y, HEX_SIZE-2)} fill={`rgba(201,76,76,${hasEnemy?.28:.10})`} stroke="none" />}
                  {/* terrain icon */}
                  <text x={x} y={y-10} className="hex-label" fontSize="16">{terrain.ico}</text>
                  {/* Zone icon + name */}
                  {zoneData && (
                    <>
                      <text x={x} y={y+6} fontSize="20" textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,.95)">{zoneData.ico}</text>
                      <text x={x} y={y+22} fontSize="7" textAnchor="middle" fill={catColor?.border || "rgba(255,255,255,.75)"}>{zoneData.name}</text>
                    </>
                  )}
                  {/* กับดัก */}
                  {cell.trap && <text x={x+16} y={y-16} fontSize="10">🪤</text>}
                  {/* ร้านค้า badge */}
                  {zoneData?.category === "shop" && <text x={x-16} y={y-18} fontSize="9">🛒</text>}
                  {/* เควส badge */}
                  {zoneData?.category === "quest" && <text x={x-16} y={y-18} fontSize="9">📋</text>}
                </g>
              );
            })}

            {/* ── Player Tokens (สัญลักษณ์ชัดเจน) ── */}
            {players.map((p, i) => {
              if (!p.alive) return null;
              const { x, y } = hexToPixel(p.col, p.row, HEX_SIZE);
              const cls = CLASSES[p.classId];
              const isCurrentTurn = currentTurn === i;
              const isMe = i === myIdx;
              const sameCell  = players.filter(pp => pp.alive && pp.col === p.col && pp.row === p.row);
              const slotIdx   = sameCell.findIndex(pp => pp.id === p.id);
              const offX      = sameCell.length > 1 ? (slotIdx - (sameCell.length-1)/2) * 16 : 0;
              const tx = x + offX - 16;
              const ty = y - 12 - 16;
              const pColor = p.playerColor || "#888";

              return (
                <g key={i} className={`player-token${isCurrentTurn?" current-player":""}`} transform={`translate(${tx},${ty})`}>
                  {/* วงกลมพื้น */}
                  <circle cx="16" cy="16" r="16" fill={pColor} stroke={isCurrentTurn ? "#ffd700" : isMe ? "#ffffff" : "rgba(0,0,0,.5)"} strokeWidth={isCurrentTurn ? 3 : isMe ? 2 : 1} />
                  {/* class icon ใหญ่ */}
                  <text x="16" y="16" textAnchor="middle" dominantBaseline="middle" fontSize="18">{cls?.ico}</text>
                  {/* player label มุมบน */}
                  <text x="28" y="4" fontSize="8" fill="#fff" fontWeight="bold" textAnchor="middle"
                    style={{ textShadow:"0 0 3px #000" }}>{p.playerLabel || `P${i+1}`}</text>
                  {/* HP bar */}
                  <rect x="2" y="30" width="28" height="4" rx="2" fill="rgba(0,0,0,.5)" />
                  <rect x="2" y="30" width={28*(p.hp/p.maxHp)} height="4" rx="2" fill={p.hp > p.maxHp*0.5 ? "#4cc94c" : p.hp > p.maxHp*0.25 ? "#f0d080" : "#c94040"} />
                  {/* Name */}
                  <text x="16" y="42" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.9)"
                    style={{ textShadow:"0 1px 2px #000" }}>{p.name.slice(0,6)}</text>
                  {/* เทิร์นปัจจุบัน — ประกาย */}
                  {isCurrentTurn && <circle cx="16" cy="16" r="18" fill="none" stroke="#ffd700" strokeWidth="2" opacity="0.6" strokeDasharray="4 2" />}
                </g>
              );
            })}
          </svg>

          {/* ── Map Legend Button ── */}
          <button
            style={{
              position:"absolute", bottom:12, left:12, background:"rgba(13,11,8,.88)",
              border:"1px solid rgba(201,168,76,.35)", borderRadius:"8px",
              padding:"6px 12px", fontSize:"11px", color:"var(--gold)",
              cursor:"pointer", fontFamily:"'Cinzel',serif",
            }}
            onClick={() => setShowLegend(v => !v)}
          >📍 Legend แมพ</button>

          {/* ── Compass / Help ── */}
          <div style={{
            position:"absolute", bottom:12, right:12,
            background:"rgba(13,11,8,.85)", border:"1px solid rgba(201,168,76,.3)",
            borderRadius:"8px", padding:"6px 10px", fontSize:"10px",
            color:"var(--txt-m)", lineHeight:"1.6", pointerEvents:"none",
            fontFamily:"'Cinzel',serif",
          }}>
            <div style={{ textAlign:"center", color:"var(--gold)", marginBottom:"2px" }}>🧭 แมพ</div>
            <div>⬆ พระราชวัง</div>
            <div>⬇ ค่ายกบฏ</div>
            <div style={{ fontSize:"9px", color:"var(--txt-d)", marginTop:"2px" }}>Scroll=ซูม | ลาก=เลื่อน</div>
          </div>

          {/* ── Zoom ── */}
          <div style={{
            position:"absolute", top:8, right:8,
            background:"rgba(13,11,8,.7)", border:"1px solid rgba(201,168,76,.2)",
            borderRadius:"6px", padding:"3px 8px", fontSize:"10px",
            color:"var(--txt-m)", pointerEvents:"none",
          }}>{Math.round(zoom*100)}%</div>

          {/* Turn announce */}
          {turnAnnounce && (
            <div style={{
              position:"absolute", top:"50%", left:"50%",
              transform:"translate(-50%,-50%)",
              background:"rgba(13,11,8,.95)", border:"2px solid var(--gold)",
              borderRadius:"14px", padding:"14px 32px",
              fontFamily:"'Cinzel',serif", fontSize:"18px", color:"var(--gold)",
              pointerEvents:"none", zIndex:10, animation:"slide-down .3s ease-out",
            }}>{turnAnnounce}</div>
          )}
        </div>

        {/* BOTTOM BAR */}
        <BottomBar
          me={me} isMyTurn={isMyTurn} currentPlayer={currentPlayer} phase={phase}
          actionsDone={actionsDone} actionMode={actionMode} selectedCard={selectedCard}
          onMove={() => { if (!isMyTurn || actionsDone.moved) return; setActionMode(p => p==="move"?null:"move"); }}
          onAttack={() => { if (!isMyTurn || actionsDone.attacked) return; setActionMode(p => p==="attack"?null:"attack"); }}
          onUseCard={() => {
            if (!selectedCard || !isMyTurn || actionsDone.usedItem) return;
            setActionMode(TRAP_CARDS.some(t => t.id === selectedCard.id) ? "trap" : (actionMode==="card"?null:"card"));
          }}
          onEndTurn={endTurn}
          onSelectCard={card => { setSelectedCard(card); setActionMode(null); }}
          setTooltip={setTooltip}
        />
      </div>

      <DiceAnimation roll={showDice} />
      <EventBanner event={activeEvent} />
      <Tooltip tooltip={tooltip} />

      {/* ═══ LEGEND MODAL ═══ */}
      {showLegend && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", overflowY:"auto" }}
          onClick={() => setShowLegend(false)}>
          <div style={{ background:"var(--s2)", border:"1px solid rgba(201,168,76,.3)", borderRadius:"16px", padding:"24px", maxWidth:"680px", width:"95%", maxHeight:"85vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:"'Cinzel',serif", color:"var(--gold)", marginBottom:"16px", fontSize:"16px", textAlign:"center" }}>
              📍 Legend — แผนที่ และสัญลักษณ์
            </h3>

            {/* สีพื้นผิว (Terrain) */}
            <div style={{ marginBottom:"16px" }}>
              <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold-l)", fontSize:"11px", marginBottom:"8px", letterSpacing:".15em" }}>🗺 พื้นผิวแมพ (TERRAIN)</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px" }}>
                {[
                  { ico:"🌿", color:"#2d5a27", name:"ที่ราบ", move:1, desc:"ทั่วไป" },
                  { ico:"🌲", color:"#1a4a1a", name:"ป่าไม้", move:2, desc:"เดินช้า" },
                  { ico:"⛰️", color:"#4a4040", name:"ภูเขา", move:3, desc:"เดินยาก" },
                  { ico:"🌊", color:"#1a3a5a", name:"แม่น้ำ", move:99, desc:"ผ่านไม่ได้" },
                  { ico:"🏜️", color:"#6a5a30", name:"ทะเลทราย", move:2, desc:"ร้อนจัด" },
                  { ico:"🌿", color:"#2a4a30", name:"หนองน้ำ", move:3, desc:"ชื้นแฉะ" },
                ].map(t => (
                  <div key={t.name} style={{ background:t.color+"99", border:`1px solid ${t.color}`, borderRadius:"6px", padding:"6px 8px", display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:"16px" }}>{t.ico}</span>
                    <div>
                      <div style={{ fontSize:"11px", fontWeight:"bold" }}>{t.name}</div>
                      <div style={{ fontSize:"9px", color:"rgba(232,213,176,.6)" }}>SPD ×{t.move === 99 ? "∞(หยุด)" : t.move} — {t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* หมวดสถานที่พิเศษ */}
            <div style={{ marginBottom:"16px" }}>
              <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold-l)", fontSize:"11px", marginBottom:"8px", letterSpacing:".15em" }}>🏰 หมวดสถานที่พิเศษ</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px" }}>
                {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
                  <div key={key} style={{ background:val.bg+"cc", border:`1px solid ${val.border}`, borderRadius:"6px", padding:"5px 8px", display:"flex", alignItems:"center", gap:"8px" }}>
                    <div style={{ width:"12px", height:"12px", borderRadius:"3px", background:val.border, flexShrink:0 }} />
                    <span style={{ fontSize:"11px", color:val.border }}>{val.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* รายละเอียดสถานที่ทั้งหมด */}
            <div style={{ marginBottom:"16px" }}>
              <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold-l)", fontSize:"11px", marginBottom:"8px", letterSpacing:".15em" }}>📍 สถานที่ทั้งหมด</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px" }}>
                {Object.entries(EXTENDED_SPECIAL_ZONES).map(([key, z]) => {
                  const cat = CATEGORY_COLORS[z.category] || {};
                  return (
                    <div key={key} style={{ background:cat.bg+"99", border:`1px solid ${cat.border || "#666"}`, borderRadius:"6px", padding:"5px 8px", display:"flex", alignItems:"flex-start", gap:"6px" }}>
                      <span style={{ fontSize:"16px", flexShrink:0 }}>{z.ico}</span>
                      <div>
                        <div style={{ fontSize:"11px", color: cat.border || "#ccc", fontWeight:"bold" }}>{z.name}</div>
                        <div style={{ fontSize:"9px", color:"rgba(232,213,176,.6)", lineHeight:1.4 }}>{z.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* สัญลักษณ์ผู้เล่น */}
            <div style={{ marginBottom:"16px" }}>
              <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold-l)", fontSize:"11px", marginBottom:"8px", letterSpacing:".15em" }}>👥 สัญลักษณ์ผู้เล่น</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"5px" }}>
                {PLAYER_ICONS.slice(0,6).map((ico, i) => (
                  <div key={i} style={{ background:"rgba(0,0,0,.3)", border:`1px solid ${PLAYER_COLORS[i]}`, borderRadius:"6px", padding:"5px", textAlign:"center" }}>
                    <div style={{ fontSize:"18px" }}>{ico}</div>
                    <div style={{ fontSize:"10px", color:PLAYER_COLORS[i] }}>{PLAYER_LABELS[i]}</div>
                    <div style={{ fontSize:"8px", color:"rgba(232,213,176,.5)" }}>แถบ HP สี{i===0?"เหลือง":i===1?"แดง":i===2?"ม่วง":i===3?"เขียว":i===4?"ส้ม":"น้ำเงิน"}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:"8px", fontSize:"10px", color:"rgba(232,213,176,.6)", lineHeight:1.7 }}>
                🟡 HP &gt;50% = เขียว | 🟠 HP 25-50% = เหลือง | 🔴 HP &lt;25% = แดง<br />
                ⭕ วงทองล้อมรอบ = เทิร์นปัจจุบัน | ⬤ ขอบขาว = ตัวคุณเอง
              </div>
            </div>

            <button className="tb-btn primary" style={{ width:"100%", padding:"10px", marginTop:"4px" }} onClick={() => setShowLegend(false)}>
              ✓ เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {/* ═══ SHOP MODAL ═══ */}
      {showShop && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowShop(null)}>
          <div style={{ background:"var(--s2)", border:"1px solid rgba(201,168,76,.4)", borderRadius:"16px", padding:"24px", maxWidth:"460px", width:"90%", maxHeight:"80vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:"'Cinzel',serif", color:"var(--gold)", marginBottom:"4px", fontSize:"16px" }}>
              {EXTENDED_SPECIAL_ZONES[showShop.cell.specialZone]?.ico} {EXTENDED_SPECIAL_ZONES[showShop.cell.specialZone]?.name}
            </h3>
            <div style={{ fontSize:"11px", color:"var(--txt-m)", marginBottom:"14px" }}>
              💰 ทองของคุณ: <span style={{ color:"var(--gold-l)", fontWeight:"bold" }}>{me?.gold || 0}</span>
            </div>
            {showShop.items.length === 0 ? (
              <div style={{ textAlign:"center", padding:"24px", color:"var(--txt-m)" }}>
                สินค้าหมดแล้ว 😔
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                {showShop.items.map(item => (
                  <div key={item.uid} style={{
                    background:"var(--s3)", border:"1px solid rgba(201,168,76,.2)",
                    borderRadius:"10px", padding:"10px", textAlign:"center",
                  }}>
                    <span style={{ fontSize:"24px" }}>{item.ico}</span>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:"10px", color:"var(--gold)", marginTop:"4px" }}>{item.name}</div>
                    <div style={{ fontSize:"9px", color:"var(--txt-m)", margin:"3px 0" }}>{item.desc || item.effect}</div>
                    <div style={{ fontSize:"11px", color:item.rarity==="divine"?"#ffd700":item.rarity==="secret"?"#c080ff":item.rarity==="rare"?"#80a0ff":"#aaa", marginBottom:"6px" }}>
                      {item.rarity === "divine" ? "✦ สมบัติ" : item.rarity === "secret" ? "★ ลึกลับ" : item.rarity === "rare" ? "◆ หายาก" : "· ธรรมดา"}
                    </div>
                    <button
                      style={{
                        background: (me?.gold || 0) >= item.price ? "linear-gradient(135deg,var(--gold-d),var(--gold))" : "rgba(255,255,255,.1)",
                        color: (me?.gold || 0) >= item.price ? "#0d0b09" : "rgba(255,255,255,.3)",
                        border:"none", borderRadius:"6px", padding:"5px 12px",
                        cursor: (me?.gold || 0) >= item.price && isMyTurn ? "pointer" : "not-allowed",
                        fontSize:"11px", fontFamily:"'Cinzel',serif", width:"100%",
                      }}
                      disabled={!isMyTurn || (me?.gold || 0) < item.price}
                      onClick={() => handleBuy(item, showShop.cell)}
                    >
                      💰 {item.price} ทอง
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button style={{ marginTop:"12px", width:"100%", padding:"9px", background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:"8px", color:"var(--txt-m)", cursor:"pointer", fontSize:"12px" }}
              onClick={() => setShowShop(null)}>
              ปิดร้าน
            </button>
          </div>
        </div>
      )}

      {/* ═══ QUEST MODAL ═══ */}
      {showQuest && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowQuest(null)}>
          <div style={{ background:"var(--s2)", border:"1px solid rgba(64,192,128,.4)", borderRadius:"16px", padding:"24px", maxWidth:"360px", width:"90%", textAlign:"center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:"48px", marginBottom:"8px" }}>📋</div>
            <h3 style={{ fontFamily:"'Cinzel',serif", color:"#40c080", marginBottom:"8px" }}>เควสได้รับ!</h3>
            <div style={{ fontSize:"13px", color:"var(--txt-m)", marginBottom:"16px", lineHeight:1.8 }}>
              ช่วยชาวบ้านพาสัตว์กลับฟาร์ม<br />
              <span style={{ color:"var(--gold)" }}>รางวัล: +3 EXP, +2 ทอง</span>
            </div>
            <div style={{ display:"flex", gap:"8px" }}>
              <button style={{ flex:1, padding:"10px", background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:"8px", color:"var(--txt-m)", cursor:"pointer", fontSize:"12px" }}
                onClick={() => setShowQuest(null)}>ปฏิเสธ</button>
              <button style={{ flex:1, padding:"10px", background:"linear-gradient(135deg,#204a30,#40c080)", border:"none", borderRadius:"8px", color:"#fff", cursor:"pointer", fontSize:"12px", fontFamily:"'Cinzel',serif" }}
                onClick={() => handleQuest(showQuest.playerIdx)}>ยอมรับ ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* RULES */}
      {showRules && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowRules(false)}>
          <div style={{ background:"var(--s2)", border:"1px solid rgba(201,168,76,.3)", borderRadius:"16px", padding:"24px", maxWidth:"480px", width:"90%", maxHeight:"80vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily:"'Cinzel',serif", color:"var(--gold)", marginBottom:"12px", fontSize:"16px" }}>📖 กฎการเล่น</h3>
            {[
              ["🎯 เป้าหมาย","แต่ละฝ่ายมีเป้าหมายลับ — ราชารักษาบัลลังก์, กบฏโค่นบัลลังก์, คนทรยศสะสมสมบัติ"],
              ["🚶 การเดิน","คลิก 'เดิน' แล้วเลือก hex สีเขียว ระยะขึ้นกับ SPD ของอาชีพ"],
              ["⚔️ การโจมตี","คลิก 'โจมตี' แล้วเลือก hex ศัตรูสีแดง 🎲3+ = โจมตีถูก, 6 = คริต!"],
              ["🛒 ร้านค้า","เดินไปสถานที่ icon 🛒 เพื่อเปิดร้านซื้อการ์ด ต้องมีทองเพียงพอ"],
              ["📋 เควส","เดินไปกระดานเควส 📋 รับภารกิจ ทำสำเร็จได้ EXP + ทอง"],
              ["📜 เฟส","ทุกคนเล่นครบ 1 รอบ = 1 เฟส เกิดเหตุการณ์สุ่ม จั่วการ์ดเพิ่ม"],
            ].map(([t, d]) => (
              <div key={t} style={{ marginBottom:"10px" }}>
                <div style={{ fontFamily:"'Cinzel',serif", color:"var(--gold)", fontSize:"12px", marginBottom:"4px" }}>{t}</div>
                <div style={{ fontSize:"11px", color:"var(--txt-m)", lineHeight:"1.6" }}>{d}</div>
              </div>
            ))}
            <button className="tb-btn primary" style={{ width:"100%", padding:"10px", marginTop:"8px" }} onClick={() => setShowRules(false)}>ปิด</button>
          </div>
        </div>
      )}

      <WinScreen gameOver={gameOver} onLeave={onLeave} />
    </>
  );
}