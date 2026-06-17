// src/game/constants/terrain.js
export const TERRAIN = {
  plains:   { id: "plains",   name: "ที่ราบ",    ico: "🌿", color: "#2d5a27", dark: "#1a3a18", moveCost: 1 },
  forest:   { id: "forest",   name: "ป่า",       ico: "🌲", color: "#1a4a1a", dark: "#0d2e0d", moveCost: 2 },
  mountain: { id: "mountain", name: "ภูเขา",     ico: "⛰️", color: "#4a4040", dark: "#2e2828", moveCost: 3 },
  water:    { id: "water",    name: "แม่น้ำ",    ico: "🌊", color: "#1a3a5a", dark: "#0d2438", moveCost: 3 },
  desert:   { id: "desert",   name: "ทะเลทราย", ico: "🏜️", color: "#6a5a30", dark: "#4a3e20", moveCost: 2 },
  swamp:    { id: "swamp",    name: "หนองน้ำ",   ico: "🌿", color: "#2a4a30", dark: "#182e1e", moveCost: 3 },
};

export const TERRAIN_COLORS = {
  plains: "#2d5a27", forest: "#1a4a1a", mountain: "#4a4040",
  water: "#1a3a5a", desert: "#6a5a30", swamp: "#2a4a30",
};

export const TERRAIN_STROKE = {
  plains: "#3a7a35", forest: "#254a25", mountain: "#5a5050",
  water: "#254a6a", desert: "#7a6a40", swamp: "#3a5a40",
};

export const SPECIAL_ZONES = {
  palace:     { name: "พระราชวัง",   ico: "🏰", effect: "king_buff",  desc: "ราชา HP+3 ทุกเฟส" },
  throne:     { name: "ศาลบัลลังก์", ico: "⚖️", effect: "throne",    desc: "ราชา HP+3 / กบฏ HP-2" },
  village:    { name: "หมู่บ้าน",    ico: "🏘️", effect: "heal",      desc: "ฟื้น HP+2 เมื่อยืน" },
  market:     { name: "ตลาดกลาง",   ico: "🏪", effect: "trade",     desc: "ซื้อขายการ์ดได้" },
  rebel_camp: { name: "ค่ายกบฏ",    ico: "⛺", effect: "rebel_buff", desc: "กบฏ ATK+2 HP+2" },
  dark_forest:{ name: "ป่าดำ",      ico: "🌑", effect: "trap",      desc: "สามารถซ่อนตัวได้" },
  dungeon:    { name: "คุก",         ico: "🗝️", effect: "loot",      desc: "หาสมบัติ แต่เสี่ยงอันตราย" },
  tower:      { name: "หอเวทย์",    ico: "🗼", effect: "magic",     desc: "จั่วเวทย์ฟรี 1 ใบ" },
  shrine:     { name: "ศาลเจ้า",    ico: "⛩️", effect: "full_heal", desc: "ฟื้น HP เต็ม 1 ครั้ง/เกม" },
  cave:       { name: "ถ้ำมังกร",   ico: "🐉", effect: "treasure",  desc: "ทอง+3 แต่เสี่ยง HP-3" },
};