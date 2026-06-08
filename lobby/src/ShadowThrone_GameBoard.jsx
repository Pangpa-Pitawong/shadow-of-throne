cat > /home/claude/GameBoard_new.jsx << 'ENDOFFILE'
import { useState, useEffect, useCallback, useRef } from "react";

// ══════════════════════════════════════════════
// CONSTANTS & DATA
// ══════════════════════════════════════════════

const ROLES = {
  king:     { id:"king",     ico:"👑", name:"พระราชา",  color:"#c9a84c", hp:16, desc:"รักษาบัลลังก์และปกป้องอาณาจักร", win:"ครองราชย์ครบ 6 เฟส หรือปราบกบฏทั้งหมด" },
  rebel:    { id:"rebel",    ico:"⚔️", name:"กบฏ",      color:"#c94040", hp:13, desc:"โค่นบัลลังก์ด้วยการรวมกำลัง",    win:"ราชา HP=0 หรือยึดศาลบัลลังก์ 2 เฟส" },
  traitor:  { id:"traitor",  ico:"🗡️", name:"คนทรยศ",  color:"#8c4cc9", hp:10, desc:"ซ่อนตัวสะสมสมบัติลับ",            win:"สมบัติ 5 ชิ้น หรือรอดคนสุดท้าย" },
  commoner: { id:"commoner", ico:"🧑", name:"ราษฎร",    color:"#4cc94c", hp:11, desc:"สะสมทรัพย์สินเอาตัวรอด",          win:"ทอง 10 เหรียญ หรือ Lv.5" },
};

const CLASSES = {
  warrior: { id:"warrior", ico:"⚔️", name:"นักรบ",   color:"#e05050", hp:12, mana:4,  move:3, atk:3, def:1 },
  knight:  { id:"knight",  ico:"🛡️", name:"อัศวิน",  color:"#5080e0", hp:14, mana:5,  move:2, atk:2, def:3 },
  mage:    { id:"mage",    ico:"🔮", name:"นักเวทย์",color:"#9050e0", hp:7,  mana:14, move:2, atk:5, def:0 },
  archer:  { id:"archer",  ico:"🏹", name:"นักธนู",  color:"#50c050", hp:9,  mana:6,  move:4, atk:4, def:1 },
  rogue:   { id:"rogue",   ico:"🗡️", name:"โจร",     color:"#c0a030", hp:9,  mana:7,  move:5, atk:3, def:1 },
  cleric:  { id:"cleric",  ico:"✨", name:"นักบวช",  color:"#e0c040", hp:10, mana:10, move:2, atk:1, def:2 },
};

const TERRAIN = {
  plains:   { id:"plains",   name:"ที่ราบ",    ico:"🌿", color:"#2a5224", stroke:"#357a2f", moveCost:1 },
  forest:   { id:"forest",   name:"ป่า",       ico:"🌲", color:"#163a16", stroke:"#1f5a1f", moveCost:2 },
  mountain: { id:"mountain", name:"ภูเขา",     ico:"⛰️", color:"#3d3535", stroke:"#5a4a4a", moveCost:3 },
  water:    { id:"water",    name:"แม่น้ำ",    ico:"🌊", color:"#142840", stroke:"#1a4060", moveCost:99 },
  desert:   { id:"desert",   name:"ทะเลทราย", ico:"🏜️", color:"#5a4a20", stroke:"#7a6030", moveCost:2 },
  swamp:    { id:"swamp",    name:"หนองน้ำ",   ico:"🌿", color:"#1e3a22", stroke:"#2a5030", moveCost:3 },
};

const SPECIAL_ZONES = {
  palace:     { name:"พระราชวัง",    ico:"🏰", effect:"king_buff",  desc:"ราชา HP+3 ทุกเฟส" },
  throne:     { name:"ศาลบัลลังก์", ico:"⚖️", effect:"throne",     desc:"ราชา HP+3 / กบฏ HP-2" },
  village:    { name:"หมู่บ้าน",     ico:"🏘️", effect:"heal",       desc:"ฟื้น HP+2 เมื่อยืน" },
  market:     { name:"ตลาดกลาง",    ico:"🏪", effect:"trade",      desc:"ซื้อขายการ์ดได้" },
  rebel_camp: { name:"ค่ายกบฏ",     ico:"⛺", effect:"rebel_buff", desc:"กบฏ ATK+2 HP+2" },
  dark_forest:{ name:"ป่าดำ",        ico:"🌑", effect:"trap",       desc:"สามารถซ่อนตัวได้" },
  dungeon:    { name:"คุก",          ico:"🗝️", effect:"loot",       desc:"หาสมบัติ แต่เสี่ยงอันตราย" },
  tower:      { name:"หอเวทย์",      ico:"🗼", effect:"magic",      desc:"จั่วเวทย์ฟรี 1 ใบ" },
  shrine:     { name:"ศาลเจ้า",      ico:"⛩️", effect:"full_heal",  desc:"ฟื้น HP เต็ม 1 ครั้ง/เกม" },
  cave:       { name:"ถ้ำมังกร",     ico:"🐉", effect:"treasure",   desc:"ทอง+3 แต่เสี่ยง HP-3" },
};

const WEAPON_CARDS = [
  { id:"sword_king",   name:"ดาบแห่งกษัตริย์",  ico:"⚔️", rarity:"divine", atk:2, desc:"ATK+2 (ราชา ATK+4)", type:"weapon" },
  { id:"fire_spear",   name:"หอกปลายเพลิง",      ico:"🔱", rarity:"divine", atk:3, desc:"ทะลุเกราะ + เผา 1 เทิร์น", type:"weapon" },
  { id:"ice_bow",      name:"ธนูคริสตัลน้ำแข็ง", ico:"🏹", rarity:"divine", atk:2, desc:"แช่แข็งเป้า 1 เทิร์น", type:"weapon" },
  { id:"dagger",       name:"มีดลอบสังหาร",       ico:"🗡️", rarity:"common", atk:1, desc:"โจมตีหลัง ATK+3", type:"weapon" },
  { id:"battle_axe",   name:"ขวานสองคม",          ico:"🪓", rarity:"common", atk:3, desc:"ATK+3 เสีย HP1", type:"weapon" },
  { id:"dragon_armor", name:"เกราะเงินมังกร",     ico:"🛡️", rarity:"divine", def:2, desc:"ลด DMG -2 ทุกครั้ง", type:"armor" },
  { id:"oak_shield",   name:"โล่ไม้โอ๊ค",         ico:"🛡️", rarity:"common", def:1, desc:"ป้องกัน ฟื้น HP+1", type:"armor" },
  { id:"thorn_armor",  name:"เกราะหนามเหล็ก",     ico:"🔰", rarity:"common", def:0, desc:"ผู้โจมตีเสีย HP1", type:"armor" },
  { id:"war_hammer",   name:"ค้อนราชันย์",         ico:"🔨", rarity:"secret", atk:5, desc:"ATK+5 สั่นสะเทือนรอบข้าง", type:"weapon" },
  { id:"blood_sword",  name:"ดาบเลือดสาบาน",      ico:"💀", rarity:"secret", atk:6, desc:"เสีย HP2 → ATK+6", type:"weapon" },
];

const MAGIC_CARDS = [
  { id:"hellfire",   name:"ไฟนรก",           ico:"🔥", rarity:"rare",   dmg:6,  desc:"DMG 6 เป้าเดี่ยว", cost:3, type:"magic" },
  { id:"ice_storm",  name:"พายุน้ำแข็ง",     ico:"❄️", rarity:"rare",   dmg:3,  desc:"แช่แข็ง 1 เทิร์น", cost:2, type:"magic" },
  { id:"lightning",  name:"สายฟ้า",           ico:"⚡", rarity:"divine", dmg:3,  desc:"DMG 3 ทุกศัตรู", cost:5, type:"magic" },
  { id:"holy_heal",  name:"แสงศักดิ์สิทธิ์", ico:"✨", rarity:"rare",   heal:5, desc:"ฟื้น HP+5", cost:3, type:"magic" },
  { id:"dark_curse", name:"คำสาปเงา",        ico:"🌑", rarity:"rare",   dmg:0,  desc:"ATK ศัตรู -2 เป็น 2 เทิร์น", cost:2, type:"magic" },
  { id:"time_stop",  name:"หยุดเวลา",         ico:"⏳", rarity:"divine", dmg:0,  desc:"ศัตรูพลาดเทิร์นถัดไป", cost:0, once:true, type:"magic" },
  { id:"warp",       name:"วาร์ปหลบ",         ico:"🌀", rarity:"rare",   dmg:0,  desc:"เทเลพอร์ตไปพื้นที่ใดก็ได้", cost:3, type:"magic" },
  { id:"amrita",     name:"น้ำอมฤต",         ico:"💧", rarity:"divine", heal:99,desc:"ฟื้น HP เต็ม 1 ครั้ง/เกม", cost:0, once:true, type:"magic" },
];

const TRAP_CARDS = [
  { id:"iron_pit", name:"หลุมหนาม",          ico:"🕳️", dmg:3, desc:"DMG -3 ทันที", type:"trap" },
  { id:"poison",   name:"พิษเถาวัลย์",       ico:"☠️", dmg:1, desc:"ติดพิษ -1HP/เทิร์น 3 เทิร์น", poison:3, type:"trap" },
  { id:"net",      name:"ตาข่าย",             ico:"🕸️", dmg:0, desc:"ล็อค 1 เทิร์น", lock:1, type:"trap" },
  { id:"bomb",     name:"ระเบิดควัน",          ico:"💨", dmg:0, desc:"ตาบอด 2 เทิร์น", blind:2, type:"trap" },
  { id:"spikes",   name:"กงเล็บเหล็ก",        ico:"⚙️", dmg:2, desc:"ทำลายเกราะ + DMG -2", destroy_armor:true, type:"trap" },
];

const PHASE_EVENTS = [
  { id:"harvest",  name:"วันเก็บเกี่ยว",   ico:"🌾", desc:"ทุกคนได้ทอง +2",             fx:"gold_all" },
  { id:"holy_day", name:"วันศักดิ์สิทธิ์", ico:"🌟", desc:"ทุกคนฟื้น HP +3",            fx:"heal_all" },
  { id:"ghost",    name:"ขบวนทัพผี",       ico:"👻", desc:"ทุกคนเสีย HP -2",            fx:"dmg_all" },
  { id:"storm",    name:"พายุฝน",          ico:"⛈️", desc:"ทุกคนทิ้งอาวุธ 1 ใบ",       fx:"discard_weapon" },
  { id:"war_drum", name:"กลองศึก",         ico:"🥁", desc:"ทุกคน +1 ATK รอบนี้",        fx:"atk_all" },
  { id:"dragon",   name:"มังกรบุก",         ico:"🐉", desc:"ทุกคนเสียอาวุธ ATK<3",      fx:"discard_weak" },
  { id:"assassin", name:"นักฆ่าลึกลับ",    ico:"🗡️", desc:"ผู้เล่น HP มากสุดเสีย HP-3",fx:"dmg_highest" },
];

const RULES = [
  { ico:"🎯", title:"เป้าหมาย", body:"ผู้เล่นแต่ละฝ่ายมีเป้าหมายซ่อนอยู่ พระราชาต้องรักษาบัลลังก์ กบฏต้องโค่นล้ม คนทรยศสะสมสมบัติ ราษฎรสะสมทอง" },
  { ico:"🚶", title:"เดิน", body:"กดปุ่ม เดิน แล้วคลิกช่องที่ต้องการ เดินได้ไม่เกินค่า SPD ของอาชีพ ป่า/หนองน้ำใช้ต้นทุนเพิ่ม" },
  { ico:"⚔️", title:"โจมตี", body:"กดปุ่ม โจมตี แล้วคลิกศัตรู ทอยเต๋า 3+ = โจมตีถูก, 6 = คริต! ระยะขึ้นอยู่กับอาชีพ" },
  { ico:"🃏", title:"ใช้การ์ด", body:"คลิกการ์ดในมือเพื่อเลือก แล้วกดปุ่ม ใช้การ์ด แล้วคลิกเป้าหมายบนแผนที่" },
  { ico:"📜", title:"เฟส", body:"เมื่อทุกคนเล่นครบ 1 รอบ = 1 เฟส จะเกิดเหตุการณ์สุ่มและจั่วการ์ดเพิ่ม เกมจบเมื่อครบ 6 เฟส" },
  { ico:"🏰", title:"พื้นที่พิเศษ", body:"ศาลบัลลังก์: ราชา HP+3 / กบฏ HP-2 | ค่ายกบฏ: กบฏ ATK+2 | ศาลเจ้า: ฟื้น HP เต็ม | ถ้ำมังกร: ทอง+3 หรือ HP-3" },
  { ico:"💀", title:"การตาย", body:"เมื่อ HP=0 ผู้เล่นตายและถูกเปิดเผยบทบาท กบฏทั้งหมดตาย = ราชาชนะ | ราชาตาย = กบฏชนะ" },
  { ico:"🪤", title:"กับดัก", body:"เลือกการ์ดกับดักแล้วกด ใช้การ์ด คลิกช่องที่ต้องการวาง ศัตรูที่เดินผ่านจะโดนผลทันที" },
];

// ══════════════════════════════════════════════
// MAP GENERATION
// ══════════════════════════════════════════════
function generateHexMap(cols=9, rows=7) {
  const terrainPool = ["plains","plains","plains","plains","forest","forest","mountain","water","desert","swamp"];
  const cells = [];
  const specialPlaces = [
    { zone:"palace",     fixed:{ col:4, row:0 } },
    { zone:"throne",     fixed:{ col:4, row:1 } },
    { zone:"village",    fixed:null },
    { zone:"market",     fixed:{ col:4, row:3 } },
    { zone:"rebel_camp", fixed:null },
    { zone:"dark_forest",fixed:null },
    { zone:"tower",      fixed:null },
    { zone:"shrine",     fixed:null },
    { zone:"cave",       fixed:null },
    { zone:"dungeon",    fixed:null },
  ];
  const fixedMap = {};
  specialPlaces.forEach(sp => { if (sp.fixed) fixedMap[`${sp.fixed.col},${sp.fixed.row}`] = sp.zone; });
  const randomSpecials = specialPlaces.filter(sp => !sp.fixed);
  const usedPositions = new Set(Object.keys(fixedMap));
  randomSpecials.forEach(sp => {
    let placed=false, attempts=0;
    while (!placed && attempts<100) {
      const c=Math.floor(Math.random()*cols), r=Math.floor(Math.random()*rows);
      const key=`${c},${r}`;
      if (!usedPositions.has(key) && !(c===4&&r<=1)) { fixedMap[key]=sp.zone; usedPositions.add(key); placed=true; }
      attempts++;
    }
  });
  for (let row=0; row<rows; row++) {
    for (let col=0; col<cols; col++) {
      const key=`${col},${row}`;
      const specialZone=fixedMap[key]||null;
      let terrain;
      if (specialZone==="palace"||specialZone==="throne") terrain="plains";
      else if (specialZone==="dark_forest"||specialZone==="rebel_camp") terrain="forest";
      else if (specialZone==="cave") terrain="mountain";
      else if (specialZone==="shrine") terrain="plains";
      else terrain=terrainPool[Math.floor(Math.random()*terrainPool.length)];
      if ((col===0||col===cols-1)&&Math.random()<0.3) terrain="water";
      if ((row===0||row===rows-1)&&Math.random()<0.2) terrain="water";
      if (specialZone==="palace") terrain="plains";
      cells.push({ col, row, key, terrain, specialZone, players:[], trap:null });
    }
  }
  return cells;
}

function hexToPixel(col, row, size=48) {
  const w=size*2, h=Math.sqrt(3)*size;
  return { x: col*(w*0.75)+size+10, y: row*h+(col%2===1?h/2:0)+size+10 };
}

function hexDistance(a, b) {
  const ac=a.col-(a.row-(a.row&1))/2, ar=a.row;
  const bc=b.col-(b.row-(b.row&1))/2, br=b.row;
  const dx=bc-ac, dy=br-ar;
  return Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dx-dy));
}

function getNeighbors(col, row, cells) {
  const isOdd=col%2===1;
  const dirs=isOdd?[[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]]:[[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
  return dirs.map(([dc,dr])=>cells.find(c=>c.col===col+dc&&c.row===row+dr)).filter(Boolean).filter(c=>c.terrain!=="water");
}

function getReachable(startCell, steps, cells) {
  if (steps<=0) return [];
  const visited=new Map([[startCell.key,0]]);
  const queue=[{cell:startCell,steps:0}];
  const reachable=[];
  while (queue.length) {
    const {cell,steps:s}=queue.shift();
    if (s>=steps) continue;
    for (const n of getNeighbors(cell.col,cell.row,cells)) {
      const cost=TERRAIN[n.terrain]?.moveCost||1;
      const ns=s+cost;
      if ((!visited.has(n.key)||visited.get(n.key)>ns)&&ns<=steps) {
        visited.set(n.key,ns); reachable.push(n); queue.push({cell:n,steps:ns});
      }
    }
  }
  return [...new Set(reachable)];
}

function hexPoints(cx, cy, size) {
  const pts=[];
  for (let i=0;i<6;i++) { const a=(Math.PI/3)*i; pts.push(`${cx+size*Math.cos(a)},${cy+size*Math.sin(a)}`); }
  return pts.join(" ");
}

// ══════════════════════════════════════════════
// GAME STATE HELPERS
// ══════════════════════════════════════════════
function createPlayers(playerData) {
  return playerData.map((p,i) => {
    const cls=CLASSES[p.classId]||CLASSES.warrior;
    return { id:i, name:p.name, role:p.role, classId:p.classId, color:cls.color, ico:cls.ico,
      hp:cls.hp, maxHp:cls.hp, mana:cls.mana, maxMana:cls.mana, atk:cls.atk, def:cls.def, move:cls.move,
      gold:4, level:1, exp:0, hand:[], alive:true, statusEffects:[], col:0, row:0 };
  });
}

function dealStartingCards() {
  const all=[...WEAPON_CARDS,...MAGIC_CARDS,...TRAP_CARDS];
  return Array.from({length:4},()=>({...all[Math.floor(Math.random()*all.length)],uid:Math.random()}));
}

function spawnPlayers(players, cells) {
  const zones=["village","rebel_camp","palace","dark_forest","dungeon","tower"];
  const spawnCells=zones.map(z=>cells.find(c=>c.specialZone===z)).filter(Boolean);
  while (spawnCells.length<players.length) {
    const r=cells[Math.floor(Math.random()*cells.length)];
    if (!spawnCells.includes(r)&&r.terrain!=="water") spawnCells.push(r);
  }
  return players.map((p,i)=>{const c=spawnCells[i%spawnCells.length];return{...p,col:c.col,row:c.row};});
}

// ══════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════
const css = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cinzel+Decorative:wght@400;700&family=Noto+Sans+Thai:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --gold:#c9a84c;--gold-l:#f0d080;--gold-d:#6a3f0a;--gold-f:rgba(201,168,76,.08);--gold-b:rgba(201,168,76,.15);
  --ink:#070605;--ink2:#0f0d0a;--ink3:#181410;--ink4:#221e17;--ink5:#2d271e;
  --txt:#e4cfaa;--txt2:#a08860;--txt3:#5a4e3a;
  --red:#c94040;--red-l:#e07070;--blue:#4070c9;--green:#40a050;--purple:#8040c9;
  --r:8px;
}
html,body{width:100%;height:100%;overflow:hidden;background:var(--ink)}
body{font-family:'Noto Sans Thai',sans-serif;font-size:13px;color:var(--txt)}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-thumb{background:var(--gold-d);border-radius:2px}
.cinzel{font-family:'Cinzel',serif}
.deco{font-family:'Cinzel Decorative',serif}

/* ── ROOT LAYOUT ── */
.gb-root{
  display:grid;
  grid-template-rows:48px 1fr 170px;
  grid-template-columns:260px 1fr 300px;
  height:100vh;
  width:100vw;
  background:var(--ink);
}

/* ── TOP BAR ── */
.gb-topbar{
  grid-column:1/-1;
  background:linear-gradient(180deg,var(--ink2),var(--ink3));
  border-bottom:1px solid rgba(201,168,76,.2);
  display:flex;align-items:center;gap:0;
  position:relative;z-index:20;
}
.tb-brand{
  display:flex;align-items:center;gap:8px;
  padding:0 16px;border-right:1px solid rgba(201,168,76,.12);
  height:100%;
}
.tb-brand-ico{font-size:18px;filter:drop-shadow(0 0 8px rgba(201,168,76,.5))}
.tb-brand-name{font-family:'Cinzel Decorative',serif;font-size:13px;color:var(--gold);letter-spacing:.06em}
.tb-phases{display:flex;align-items:center;gap:0;padding:0 16px;border-right:1px solid rgba(201,168,76,.12);height:100%}
.tb-phase-dot{
  width:22px;height:22px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-family:'Cinzel',serif;font-size:10px;
  border:1px solid var(--txt3);color:var(--txt3);
  transition:all .3s;
}
.tb-phase-dot.done{background:var(--gold-d);border-color:var(--gold);color:var(--gold-l)}
.tb-phase-dot.cur{background:rgba(201,168,76,.2);border-color:var(--gold);color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.3);animation:phase-pulse 1.5s ease-in-out infinite}
@keyframes phase-pulse{0%,100%{box-shadow:0 0 8px rgba(201,168,76,.2)}50%{box-shadow:0 0 16px rgba(201,168,76,.5)}}
.tb-phase-line{width:10px;height:1px;background:var(--txt3)}
.tb-phase-line.done{background:var(--gold-d)}
.tb-turn-info{display:flex;align-items:center;gap:8px;padding:0 16px;border-right:1px solid rgba(201,168,76,.12);height:100%}
.tb-turn-lbl{font-size:10px;color:var(--txt2)}
.tb-turn-player{
  display:flex;align-items:center;gap:6px;
  background:rgba(201,168,76,.1);border:1px solid var(--gold-b);
  border-radius:20px;padding:3px 10px;
  font-size:11px;color:var(--gold);
}
.tb-turn-player.is-me{border-color:var(--gold);background:rgba(201,168,76,.18);box-shadow:0 0 8px rgba(201,168,76,.2)}
.tb-spacer{flex:1}
.tb-actions{display:flex;align-items:center;gap:6px;padding:0 12px}
.tb-btn{
  height:28px;padding:0 12px;border-radius:6px;border:none;cursor:pointer;
  font-family:'Cinzel',serif;font-size:10px;letter-spacing:.04em;
  transition:all .15s;display:flex;align-items:center;gap:5px;
}
.tb-btn-ghost{background:rgba(201,168,76,.08);color:var(--gold-l);border:1px solid var(--gold-b)}
.tb-btn-ghost:hover{background:var(--gold-b);border-color:var(--gold)}
.tb-btn-primary{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:var(--ink)}
.tb-btn-primary:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}
.tb-btn-primary:disabled{opacity:.35;cursor:not-allowed}
.tb-btn-danger{background:rgba(139,26,26,.5);color:#ffaaaa;border:1px solid rgba(139,26,26,.6)}
.tb-btn-danger:hover{background:rgba(170,30,30,.7)}

/* ── LEFT PANEL ── */
.gb-left{
  background:var(--ink2);
  border-right:1px solid rgba(201,168,76,.1);
  overflow-y:auto;
  display:flex;flex-direction:column;
}
.panel-title{
  font-family:'Cinzel',serif;font-size:10px;letter-spacing:.2em;
  color:var(--txt2);text-transform:uppercase;
  padding:10px 12px 6px;border-bottom:1px solid rgba(201,168,76,.08);
  display:flex;align-items:center;gap:6px;
}
.panel-title::after{content:'';flex:1;height:1px;background:rgba(201,168,76,.08)}

/* player card */
.pcard{
  margin:5px 8px;border-radius:var(--r);
  background:var(--ink3);border:1px solid rgba(201,168,76,.08);
  padding:8px;cursor:default;transition:all .2s;position:relative;overflow:hidden;
}
.pcard::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;opacity:0;transition:opacity .2s}
.pcard.me::before{background:var(--blue);opacity:1}
.pcard.active-turn::before{background:var(--gold);opacity:1}
.pcard.dead{opacity:.35}
.pcard.active-turn{border-color:rgba(201,168,76,.25);background:var(--ink4)}
.pcard:hover{border-color:rgba(201,168,76,.2)}
.pcard-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.pcard-ico{
  width:32px;height:32px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:16px;flex-shrink:0;border:1.5px solid;
}
.pcard-info{flex:1;min-width:0}
.pcard-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcard-role{
  display:inline-flex;align-items:center;gap:3px;
  font-size:9px;padding:1px 6px;border-radius:3px;margin-top:2px;
}
.role-king{background:rgba(201,168,76,.15);color:var(--gold)}
.role-rebel{background:rgba(201,64,64,.15);color:var(--red-l)}
.role-traitor{background:rgba(128,64,201,.15);color:#c080ff}
.role-commoner{background:rgba(64,160,80,.15);color:#70d080}
.pcard-bars{display:flex;flex-direction:column;gap:3px}
.bar{display:flex;align-items:center;gap:5px;font-size:9px;color:var(--txt2)}
.bar-lbl{width:10px;text-align:center}
.bar-track{flex:1;height:5px;background:rgba(0,0,0,.4);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .4s}
.bar-hp{background:linear-gradient(90deg,#8b1a1a,#e06060)}
.bar-hp.low{background:linear-gradient(90deg,#6b0000,#ff4040);animation:hp-pulse .8s ease-in-out infinite}
@keyframes hp-pulse{0%,100%{opacity:.7}50%{opacity:1}}
.bar-mp{background:linear-gradient(90deg,#1a3080,#6080e0)}
.pcard-stats{display:flex;gap:4px;margin-top:5px;flex-wrap:wrap}
.stat-chip{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:4px;padding:2px 5px;font-size:8px;color:var(--txt2);display:flex;gap:3px}
.stat-chip span:last-child{color:var(--txt)}
.turn-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold);animation:turn-glow .9s ease-in-out infinite}
@keyframes turn-glow{0%,100%{opacity:.5;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}

/* ── CENTER MAP ── */
.gb-map{
  background:radial-gradient(ellipse at 50% 40%, #0d0c08 0%, var(--ink) 100%);
  overflow:hidden;position:relative;cursor:grab;
}
.gb-map:active{cursor:grabbing}
.map-svg{overflow:visible;display:block}

/* hex cells */
.hex-cell{cursor:pointer}
.hex-cell .hbg{transition:filter .1s}
.hex-cell:hover .hbg{filter:brightness(1.35)}
.hex-cell.reachable .hbg{filter:brightness(1.5)!important;stroke:#4cc94c!important;stroke-width:2!important}
.hex-cell.attackable .hbg{filter:brightness(1.3)!important;stroke:#e05050!important;stroke-width:2!important}
.hex-cell.selected .hbg{stroke:var(--gold)!important;stroke-width:2.5!important;filter:brightness(1.6)!important}

/* ── BOTTOM BAR ── */
.gb-bottom{
  grid-column:1/-1;
  background:var(--ink2);
  border-top:1px solid rgba(201,168,76,.12);
  display:flex;flex-direction:column;
}
.action-strip{
  display:flex;align-items:center;gap:6px;
  padding:6px 12px;border-bottom:1px solid rgba(201,168,76,.08);
  flex-shrink:0;
}
.act-btn{
  display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:5px 10px;border-radius:var(--r);border:1px solid rgba(201,168,76,.12);
  background:var(--ink3);cursor:pointer;transition:all .15s;min-width:62px;
  font-family:'Noto Sans Thai',sans-serif;
}
.act-btn:hover:not(:disabled){border-color:var(--gold);background:var(--gold-f);transform:translateY(-2px)}
.act-btn:disabled{opacity:.3;cursor:not-allowed}
.act-btn.done{border-color:var(--green);background:rgba(64,160,80,.08);color:#70d080}
.act-btn.active{border-color:var(--gold);background:var(--gold-f);box-shadow:0 0 10px rgba(201,168,76,.2)}
.act-ico{font-size:18px}
.act-lbl{font-size:9px;color:var(--txt2)}
.act-sub{font-size:8px;color:var(--txt3)}
.act-sep{width:1px;height:40px;background:rgba(201,168,76,.1);flex-shrink:0}
.act-info{display:flex;flex-direction:column;align-items:center;gap:2px;padding:0 8px}
.act-info-lbl{font-size:9px;color:var(--txt2)}
.act-info-val{font-family:'Cinzel',serif;font-size:15px;color:var(--gold)}
.act-wait{font-size:11px;color:var(--txt2);padding:0 12px;font-style:italic}

/* hand cards */
.hand-scroll{flex:1;overflow-x:auto;overflow-y:hidden;display:flex;align-items:center;gap:6px;padding:6px 12px}
.hcard{
  flex-shrink:0;width:68px;
  background:var(--ink3);border:1.5px solid rgba(201,168,76,.12);
  border-radius:var(--r);padding:6px;cursor:pointer;
  transition:all .18s;text-align:center;position:relative;
}
.hcard:hover{border-color:var(--gold);background:var(--gold-f);transform:translateY(-8px);z-index:5}
.hcard.sel{border-color:var(--gold);background:var(--gold-f);transform:translateY(-12px);box-shadow:0 10px 24px rgba(201,168,76,.25);z-index:6}
.hcard-ico{font-size:20px;display:block;margin-bottom:2px}
.hcard-name{font-size:7.5px;color:var(--gold);font-family:'Cinzel',serif;line-height:1.2}
.hcard-desc{font-size:7px;color:var(--txt2);margin-top:2px;line-height:1.3}
.hcard-type{font-size:7px;color:var(--txt3);margin-top:3px}
.hcard-rarity{position:absolute;top:3px;right:3px;font-size:7px;padding:1px 3px;border-radius:2px}
.r-common{background:rgba(120,120,120,.2);color:#999}
.r-rare{background:rgba(60,100,210,.2);color:#80a0ff}
.r-divine{background:rgba(180,140,30,.2);color:var(--gold)}
.r-secret{background:rgba(140,30,160,.2);color:#d080ff}

/* ── RIGHT PANEL ── */
.gb-right{
  background:var(--ink2);
  border-left:1px solid rgba(201,168,76,.1);
  display:flex;flex-direction:column;
  overflow:hidden;
}
.rtabs{display:flex;border-bottom:1px solid rgba(201,168,76,.1)}
.rtab{
  flex:1;padding:8px 4px;text-align:center;cursor:pointer;
  font-size:9px;font-family:'Cinzel',serif;letter-spacing:.04em;
  color:var(--txt2);border-bottom:2px solid transparent;
  transition:all .15s;
}
.rtab:hover{color:var(--txt);background:rgba(201,168,76,.05)}
.rtab.on{color:var(--gold);border-bottom-color:var(--gold);background:rgba(201,168,76,.05)}
.rtab-ico{font-size:14px;display:block;margin-bottom:2px}
.rpanel{flex:1;overflow-y:auto;padding:8px}

/* log entries */
.log-e{font-size:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03);color:var(--txt2);line-height:1.5}
.log-e.imp{color:var(--txt)}
.log-e.dmg{color:#ff8080}
.log-e.heal{color:#70d080}
.log-e.event{color:var(--gold)}
.log-e.death{color:#ff5050;font-weight:600}
.log-e.win{color:var(--gold-l);font-size:12px;font-weight:700}

/* rules */
.rule-item{background:var(--ink3);border:1px solid rgba(201,168,76,.08);border-radius:var(--r);padding:10px;margin-bottom:6px}
.rule-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.rule-ico{font-size:16px}
.rule-title{font-family:'Cinzel',serif;font-size:11px;color:var(--gold)}
.rule-body{font-size:10px;color:var(--txt2);line-height:1.7}

/* zone info */
.zone-card{background:var(--ink3);border:1px solid rgba(201,168,76,.15);border-radius:var(--r);padding:10px;margin-bottom:6px}
.zone-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.zone-ico{font-size:20px}
.zone-name{font-family:'Cinzel',serif;font-size:11px;color:var(--gold)}
.zone-desc{font-size:10px;color:var(--txt2);line-height:1.6}

/* objectives */
.obj-box{background:var(--ink3);border:1px solid rgba(201,168,76,.15);border-left:3px solid;border-radius:var(--r);padding:10px;margin-bottom:8px}
.obj-title{font-family:'Cinzel',serif;font-size:11px;margin-bottom:4px}
.obj-text{font-size:10px;color:var(--txt2);line-height:1.7}

/* ── OVERLAYS ── */
.dice-anim{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  font-size:72px;z-index:500;pointer-events:none;
  animation:dice-pop .7s ease-out forwards;
}
@keyframes dice-pop{0%{opacity:0;transform:translate(-50%,-50%) scale(.3) rotate(-180deg)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.3) rotate(10deg)}80%{transform:translate(-50%,-50%) scale(.95)}100%{opacity:0;transform:translate(-50%,-50%) scale(.7)}}

.event-banner{
  position:fixed;top:60px;left:50%;transform:translateX(-50%);
  background:rgba(10,8,5,.95);border:1px solid var(--gold);
  border-radius:12px;padding:16px 28px;text-align:center;z-index:400;
  animation:banner-in .4s ease-out;min-width:260px;max-width:380px;
  box-shadow:0 8px 40px rgba(0,0,0,.8),0 0 40px rgba(201,168,76,.1);
}
@keyframes banner-in{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.ev-ico{font-size:32px;display:block;margin-bottom:6px}
.ev-name{font-family:'Cinzel',serif;color:var(--gold);font-size:15px;margin-bottom:3px}
.ev-desc{font-size:11px;color:var(--txt2)}

.turn-announce{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  background:rgba(10,8,5,.9);border:1px solid var(--gold);
  border-radius:12px;padding:10px 28px;
  font-family:'Cinzel',serif;font-size:16px;color:var(--gold);
  pointer-events:none;z-index:10;
  animation:banner-in .3s ease-out;
  box-shadow:0 0 30px rgba(201,168,76,.2);
}

.tooltip{
  position:fixed;background:var(--ink2);
  border:1px solid rgba(201,168,76,.25);border-radius:8px;
  padding:8px 12px;font-size:11px;pointer-events:none;z-index:999;
  max-width:200px;box-shadow:0 4px 20px rgba(0,0,0,.7);
}
.tt-title{font-family:'Cinzel',serif;color:var(--gold);font-size:12px;margin-bottom:3px}
.tt-desc{color:var(--txt2);line-height:1.5}

/* win overlay */
.win-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:1000}
.win-box{
  background:linear-gradient(160deg,var(--ink2),var(--ink3));
  border:2px solid var(--gold);border-radius:16px;
  padding:36px;text-align:center;max-width:380px;
  box-shadow:0 0 80px rgba(201,168,76,.15);
}
.win-ico{font-size:64px;display:block;margin-bottom:12px;animation:float 2s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.win-title{font-family:'Cinzel Decorative',serif;font-size:22px;color:var(--gold);margin-bottom:6px}
.win-sub{font-size:13px;color:var(--txt2);margin-bottom:16px}
.win-reason{font-size:11px;color:var(--txt);background:var(--ink4);padding:8px 14px;border-radius:8px;margin-bottom:20px;line-height:1.6}

/* mobile guard */
.mobile-guard{display:none;position:fixed;inset:0;background:var(--ink);align-items:center;justify-content:center;text-align:center;padding:24px;z-index:9999}
@media(max-width:900px){.mobile-guard{display:flex}.gb-root{display:none}}
`;

// ══════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════
export default function GameBoard({ roomData, myIdx = 0, onLeave }) {
  const defaultPlayers = [
    { name:"ฝาง (คุณ)", classId:"warrior", role:"king" },
    { name:"ห่อง",      classId:"mage",    role:"rebel" },
    { name:"ชัย",       classId:"archer",  role:"rebel" },
    { name:"นน",        classId:"cleric",  role:"commoner" },
  ];
  const initPlayers = roomData?.players?.map((p,i) => ({
    name: p.name, classId: p.class||"warrior",
    role: roomData.roles?.[i]||["king","rebel","rebel","commoner"][i%4],
  })) || defaultPlayers;

  const [cells, setCells]           = useState(() => generateHexMap(9,7));
  const [mapOffset, setMapOffset]   = useState({ x:0, y:0 });
  const isDragging = useRef(false);
  const dragStart  = useRef({ x:0, y:0, ox:0, oy:0 });

  const [players, setPlayers]       = useState(() => {
    const ps = spawnPlayers(createPlayers(initPlayers), cells);
    return ps.map(p => ({ ...p, hand: dealStartingCards() }));
  });
  const [currentTurn, setCurrentTurn] = useState(0);
  const [phase, setPhase]           = useState(1);
  const [phaseStep, setPhaseStep]   = useState(0);
  const [actionsDone, setActionsDone] = useState({ moved:false, attacked:false, usedItem:false });
  const [actionMode, setActionMode] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [reachableCells, setReachableCells] = useState([]);
  const [attackableCells, setAttackableCells] = useState([]);
  const [log, setLog]               = useState([{ msg:"🏰 เกมเริ่มต้น! โชคดีทุกคน", type:"event", time:Date.now() }]);
  const [gameOver, setGameOver]     = useState(null);
  const [showDice, setShowDice]     = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [tooltip, setTooltip]       = useState(null);
  const [turnAnnounce, setTurnAnnounce] = useState(null);
  const [rightTab, setRightTab]     = useState("log");  // log | rules | zones | obj

  const addLog = useCallback((msg, type="") => {
    setLog(l => [{ msg, type, time:Date.now() }, ...l.slice(0,120)]);
  }, []);

  const me = players[myIdx];
  const currentPlayer = players[currentTurn];
  const isMyTurn = currentTurn === myIdx;

  // ── REACHABLE/ATTACKABLE ──
  useEffect(() => {
    if (actionMode==="move"&&!actionsDone.moved) {
      const cp=players[currentTurn];
      const start=cells.find(c=>c.col===cp.col&&c.row===cp.row);
      if (start) setReachableCells(getReachable(start,cp.move,cells));
    } else setReachableCells([]);
  }, [actionMode,actionsDone.moved,cells,players,currentTurn]);

  useEffect(() => {
    if (actionMode==="attack"&&!actionsDone.attacked) {
      const cp=players[currentTurn];
      const range=cp.classId==="archer"?4:cp.classId==="mage"?3:1;
      const cpCell={col:cp.col,row:cp.row};
      setAttackableCells(cells.filter(c=>{ const d=hexDistance(cpCell,c); return d>0&&d<=range; }));
    } else setAttackableCells([]);
  }, [actionMode,actionsDone.attacked,cells,players,currentTurn]);

  // ── CELL CLICK ──
  const handleCellClick = useCallback((cell) => {
    if (currentTurn!==myIdx) return;
    const cp=players[currentTurn];

    if (actionMode==="move") {
      if (!reachableCells.some(c=>c.key===cell.key)) return;
      setPlayers(ps=>ps.map((p,i)=>i===currentTurn?{...p,col:cell.col,row:cell.row}:p));
      setActionsDone(a=>({...a,moved:true}));
      setActionMode(null);
      addLog(`🚶 ${cp.name} เดินไปยัง ${cell.specialZone?SPECIAL_ZONES[cell.specialZone]?.name:TERRAIN[cell.terrain]?.name}`,"");
      applyZoneEffect(cell,currentTurn);
    } else if (actionMode==="attack") {
      const target=players.find(p=>p.alive&&p.col===cell.col&&p.row===cell.row&&p.id!==currentTurn);
      if (!target) return;
      performAttack(currentTurn,target.id);
    } else if (actionMode==="card"&&selectedCard) {
      useCard(selectedCard,cell,currentTurn);
      setSelectedCard(null); setActionMode(null);
    } else if (actionMode==="trap"&&selectedCard) {
      setCells(cs=>cs.map(c=>c.key===cell.key?{...c,trap:{...selectedCard,ownerId:currentTurn}}:c));
      setPlayers(ps=>ps.map((p,i)=>i===currentTurn?{...p,hand:p.hand.filter(h=>h.uid!==selectedCard.uid)}:p));
      setActionsDone(a=>({...a,usedItem:true}));
      setSelectedCard(null); setActionMode(null);
      addLog(`🪤 ${cp.name} วางกับดัก "${selectedCard.name}"`,"");
    }
    setSelectedCell(cell);
  }, [actionMode,currentTurn,myIdx,players,reachableCells,selectedCard]);

  // ── ZONE EFFECT ──
  const applyZoneEffect = useCallback((cell,playerIdx) => {
    if (!cell.specialZone) return;
    const zone=cell.specialZone;
    setPlayers(ps=>ps.map((p,i)=>{
      if (i!==playerIdx) return p;
      if (zone==="throne") {
        if (p.role==="king"){ addLog(`⚖️ ${p.name} อยู่บนบัลลังก์ HP+3`,"heal"); return{...p,hp:Math.min(p.maxHp,p.hp+3)}; }
        if (p.role==="rebel"){ addLog(`⚖️ ${p.name} บุกบัลลังก์ HP-2`,"dmg"); return{...p,hp:Math.max(0,p.hp-2)}; }
      }
      if (zone==="village"){ addLog(`🏘️ ${p.name} ฟื้น HP+2`,"heal"); return{...p,hp:Math.min(p.maxHp,p.hp+2)}; }
      if (zone==="rebel_camp"&&p.role==="rebel"){ addLog(`⛺ กบฏ ATK+2 HP+2!`,"heal"); return{...p,atk:p.atk+2,hp:Math.min(p.maxHp,p.hp+2)}; }
      if (zone==="cave"){
        const roll=Math.ceil(Math.random()*6);
        setShowDice(roll); setTimeout(()=>setShowDice(null),900);
        if (roll>=4){ addLog(`🐉 🎲${roll} หนีมังกร! +3 ทอง`,"event"); return{...p,gold:p.gold+3}; }
        else{ addLog(`🐉 🎲${roll} โดนมังกร! HP-3`,"dmg"); return{...p,hp:Math.max(0,p.hp-3)}; }
      }
      if (zone==="tower"){ const m=MAGIC_CARDS[Math.floor(Math.random()*MAGIC_CARDS.length)]; addLog(`🗼 ${p.name} ได้เวทย์ "${m.name}"`,"event"); return{...p,hand:[...p.hand,{...m,uid:Math.random()}]}; }
      if (zone==="shrine"&&!p._shrineUsed){ addLog(`⛩️ ${p.name} ฟื้น HP เต็ม!`,"heal"); return{...p,hp:p.maxHp,_shrineUsed:true}; }
      return p;
    }));
    if (cell.trap&&cell.trap.ownerId!==playerIdx) {
      const trap=cell.trap;
      addLog(`🪤 ${players[playerIdx].name} โดนกับดัก "${trap.name}"!`,"dmg");
      setPlayers(ps=>ps.map((p,i)=>i!==playerIdx?p:{...p,hp:Math.max(0,p.hp-(trap.dmg||0))}));
      setCells(cs=>cs.map(c=>c.key===cell.key?{...c,trap:null}:c));
    }
  }, [players,addLog]);

  const rollD6 = ()=>Math.ceil(Math.random()*6);

  // ── ATTACK ──
  const performAttack = useCallback((atkId,defId) => {
    const atk=players[atkId], def=players[defId];
    const roll=rollD6();
    setShowDice(roll); setTimeout(()=>setShowDice(null),900);
    if (roll<3){ addLog(`🎯 ${atk.name} โจมตี ${def.name} — พลาด! 🎲${roll}`,"dmg"); setActionsDone(a=>({...a,attacked:true})); setActionMode(null); return; }
    const crit=roll===6;
    const dmg=Math.max(1,atk.atk+(crit?2:0)-def.def);
    setPlayers(ps=>ps.map(p=>{
      if (p.id!==defId) return p;
      const nhp=Math.max(0,p.hp-dmg);
      if (nhp===0&&p.alive){ setTimeout(()=>checkWin(),200); addLog(`💀 ${p.name} ถูกกำจัด!`,"death"); }
      return{...p,hp:nhp,alive:nhp>0};
    }));
    addLog(`⚔️ ${atk.name} → ${def.name} — ${dmg} ดาเมจ 🎲${roll}${crit?" ✨คริต!":""}`, crit?"event":"dmg");
    setActionsDone(a=>({...a,attacked:true})); setActionMode(null);
  }, [players,addLog]);

  // ── USE CARD ──
  const useCard = useCallback((card,targetCell,playerIdx) => {
    const cp=players[playerIdx];
    const targetPlayer=players.find(p=>p.alive&&p.col===targetCell.col&&p.row===targetCell.row);
    if (card.type==="magic"||MAGIC_CARDS.some(m=>m.id===card.id)) {
      if (cp.mana<(card.cost||0)){ addLog(`❌ มานาไม่พอ`,"dmg"); return; }
      setPlayers(ps=>ps.map(p=>{
        if (p.id===playerIdx) return{...p,mana:Math.max(0,p.mana-(card.cost||0)),hand:p.hand.filter(h=>h.uid!==card.uid)};
        if (targetPlayer&&p.id===targetPlayer.id){
          const nhp=Math.max(0,p.hp-(card.dmg||0)+(card.heal||0));
          addLog(`✨ ${cp.name} ใช้ "${card.name}" → ${targetPlayer.name} ${card.dmg?`HP-${card.dmg}`:`HP+${card.heal}`}`,"event");
          return{...p,hp:Math.min(p.maxHp,nhp)};
        }
        return p;
      }));
    } else {
      setPlayers(ps=>ps.map(p=>{
        if (p.id!==playerIdx) return p;
        addLog(`🗡️ ${cp.name} สวมใส่ "${card.name}"`,"");
        return{...p,atk:p.atk+(card.atk||0),def:p.def+(card.def||0),hand:p.hand.filter(h=>h.uid!==card.uid)};
      }));
    }
    setActionsDone(a=>({...a,usedItem:true}));
  }, [players,addLog]);

  // ── CHECK WIN ──
  const checkWin = useCallback(() => {
    setPlayers(ps=>{
      const alive=ps.filter(p=>p.alive);
      const king=ps.find(p=>p.role==="king");
      const rebels=ps.filter(p=>p.role==="rebel");
      if (!king?.alive){ const ar=rebels.filter(r=>r.alive); if (ar.length>0) setGameOver({winner:"rebel",reason:"กบฏโค่นบัลลังก์สำเร็จ! 🏴",players:ar}); }
      if (rebels.every(r=>!r.alive)&&king?.alive) setGameOver({winner:"king",reason:"พระราชาปราบกบฏสำเร็จ! 👑",players:[king]});
      if (alive.length===1) setGameOver({winner:alive[0].role,reason:`${alive[0].name} รอดคนสุดท้าย!`,players:[alive[0]]});
      return ps;
    });
  }, []);

  // ── END TURN ──
  const endTurn = useCallback(() => {
    setPlayers(ps=>ps.map(p=>{
      if (!p.alive) return p;
      let hp=p.hp;
      const effects=p.statusEffects.filter(s=>s.duration>1).map(s=>({...s,duration:s.duration-1}));
      p.statusEffects.forEach(s=>{ if (s.type==="burn"||s.type==="poison") hp=Math.max(0,hp-1); });
      return{...p,hp,mana:Math.min(p.maxMana,p.mana+1),statusEffects:effects};
    }));
    let next=(currentTurn+1)%players.length;
    while (!players[next]?.alive) next=(next+1)%players.length;
    let newPhase=phase, newStep=phaseStep+1;
    if (newStep>=players.filter(p=>p.alive).length) {
      newStep=0; newPhase=phase+1;
      if (newPhase>6){ const top=[...players].filter(p=>p.alive).sort((a,b)=>b.hp-a.hp)[0]; setGameOver({winner:top?.role||"draw",reason:"ครบ 6 เฟส! ผู้ชนะโดย HP สูงสุด",players:top?[top]:[]}); return; }
      setPhase(newPhase);
      const ev=PHASE_EVENTS[Math.floor(Math.random()*PHASE_EVENTS.length)];
      setActiveEvent(ev); applyPhaseEvent(ev); setTimeout(()=>setActiveEvent(null),3500);
      addLog(`📜 เฟส ${newPhase}: ${ev.ico} ${ev.name} — ${ev.desc}`,"event");
      setPlayers(ps=>ps.map(p=>{ if (!p.alive) return p; const all=[...WEAPON_CARDS,...MAGIC_CARDS]; return{...p,hand:[...p.hand,...Array.from({length:2},()=>({...all[Math.floor(Math.random()*all.length)],uid:Math.random()}))].slice(-8)}; }));
    }
    setPhaseStep(newStep); setCurrentTurn(next);
    setActionsDone({moved:false,attacked:false,usedItem:false});
    setActionMode(null); setSelectedCard(null);
    setTurnAnnounce(`เทิร์นของ ${players[next]?.name||"?"}`);
    setTimeout(()=>setTurnAnnounce(null),1600);
    addLog(`🔔 เทิร์นของ ${players[next]?.name} (เฟส ${newPhase})`,"imp");
    const all=[...WEAPON_CARDS,...MAGIC_CARDS,...TRAP_CARDS];
    setPlayers(ps=>ps.map((p,i)=>i!==next?p:{...p,hand:[...p.hand,{...all[Math.floor(Math.random()*all.length)],uid:Math.random()}].slice(-8)}));
    checkWin();
  }, [currentTurn,phase,phaseStep,players,addLog,checkWin]);

  const applyPhaseEvent = useCallback((ev) => {
    setPlayers(ps=>ps.map(p=>{
      if (!p.alive) return p;
      if (ev.fx==="gold_all") return{...p,gold:p.gold+2};
      if (ev.fx==="heal_all") return{...p,hp:Math.min(p.maxHp,p.hp+3)};
      if (ev.fx==="dmg_all") return{...p,hp:Math.max(1,p.hp-2)};
      if (ev.fx==="atk_all") return{...p,atk:p.atk+1};
      return p;
    }));
  }, []);

  // ── MAP DRAG ──
  const onMapDown=(e)=>{ if (e.button!==0) return; isDragging.current=true; dragStart.current={x:e.clientX,y:e.clientY,ox:mapOffset.x,oy:mapOffset.y}; };
  const onMapMove=(e)=>{ if (!isDragging.current) return; setMapOffset({x:dragStart.current.ox+(e.clientX-dragStart.current.x),y:dragStart.current.oy+(e.clientY-dragStart.current.y)}); };
  const onMapUp=()=>{ isDragging.current=false; };

  // ── MAP SIZE ──
  const HEX_SIZE=48;
  const mapW=9*HEX_SIZE*1.5+HEX_SIZE*2+20;
  const mapH=7*HEX_SIZE*1.73+HEX_SIZE*2+20;

  const rarityClass=(r)=>r==="divine"?"r-divine":r==="rare"?"r-rare":r==="secret"?"r-secret":"r-common";
  const rarityIco=(r)=>r==="divine"?"✦":r==="rare"?"◆":r==="secret"?"★":"·";

  return (
    <>
      <style>{css}</style>

      <div className="mobile-guard">
        <div>
          <div style={{fontSize:"48px",marginBottom:"12px"}}>🏰</div>
          <div style={{fontFamily:"'Cinzel',serif",color:"var(--gold)",fontSize:"18px",marginBottom:"8px"}}>บัลลังก์เงา</div>
          <div style={{color:"var(--txt2)",fontSize:"13px"}}>กรุณาใช้หน้าจอขนาดใหญ่<br/>เพื่อประสบการณ์ที่ดีที่สุด</div>
        </div>
      </div>

      <div className="gb-root">

        {/* ═══ TOP BAR ═══ */}
        <div className="gb-topbar">
          <div className="tb-brand">
            <span className="tb-brand-ico">♛</span>
            <span className="tb-brand-name">บัลลังก์เงา</span>
          </div>

          <div className="tb-phases">
            {[1,2,3,4,5,6].map((n,i) => (
              <span key={n} style={{display:"flex",alignItems:"center"}}>
                <div className={`tb-phase-dot ${phase>n?"done":phase===n?"cur":""}`}>{n}</div>
                {n<6 && <div className={`tb-phase-line ${phase>n?"done":""}`}/>}
              </span>
            ))}
          </div>

          <div className="tb-turn-info">
            <span className="tb-turn-lbl">เทิร์น {phaseStep+1}</span>
            <div className={`tb-turn-player${isMyTurn?" is-me":""}`}>
              {currentPlayer?.ico} {currentPlayer?.name}{isMyTurn?" (คุณ)":""}
            </div>
          </div>

          <div className="tb-spacer"/>

          <div className="tb-actions">
            {isMyTurn && <button className="tb-btn tb-btn-primary" onClick={endTurn} disabled={!!gameOver}>⏭ จบเทิร์น</button>}
            {onLeave && <button className="tb-btn tb-btn-danger" onClick={onLeave}>✕ ออก</button>}
          </div>
        </div>

        {/* ═══ LEFT PANEL ═══ */}
        <div className="gb-left">
          <div className="panel-title">👥 ผู้เล่น</div>
          {players.map((p,i) => {
            const cls=CLASSES[p.classId];
            const role=ROLES[p.role];
            const isMe=i===myIdx;
            const isCur=currentTurn===i;
            return (
              <div key={i} className={`pcard${isMe?" me":""}${isCur?" active-turn":""}${!p.alive?" dead":""}`}
                onMouseEnter={e=>setTooltip({x:e.clientX+10,y:e.clientY+10,title:p.name,desc:`${role?.name} — ${role?.win}`})}
                onMouseLeave={()=>setTooltip(null)}>
                {isCur && <div className="turn-dot"/>}
                <div className="pcard-head">
                  <div className="pcard-ico" style={{background:cls?.color+"22",borderColor:cls?.color+"60"}}>
                    {p.alive?cls?.ico:"💀"}
                  </div>
                  <div className="pcard-info">
                    <div className="pcard-name">{p.name}{isMe?" (คุณ)":""}</div>
                    <span className={`pcard-role role-${p.role}`}>{role?.ico} {role?.name}</span>
                  </div>
                </div>
                <div className="pcard-bars">
                  <div className="bar">
                    <span className="bar-lbl">❤</span>
                    <div className="bar-track"><div className={`bar-fill bar-hp${p.hp/p.maxHp<0.3?" low":""}`} style={{width:`${(p.hp/p.maxHp)*100}%`}}/></div>
                    <span style={{fontSize:"9px",color:"var(--txt2)",minWidth:"28px",textAlign:"right"}}>{p.hp}/{p.maxHp}</span>
                  </div>
                  <div className="bar">
                    <span className="bar-lbl">💧</span>
                    <div className="bar-track"><div className="bar-fill bar-mp" style={{width:`${(p.mana/p.maxMana)*100}%`}}/></div>
                    <span style={{fontSize:"9px",color:"var(--txt2)",minWidth:"28px",textAlign:"right"}}>{p.mana}/{p.maxMana}</span>
                  </div>
                </div>
                <div className="pcard-stats">
                  <div className="stat-chip"><span>ATK</span><span>{p.atk}</span></div>
                  <div className="stat-chip"><span>DEF</span><span>{p.def}</span></div>
                  <div className="stat-chip"><span>SPD</span><span>{p.move}</span></div>
                  <div className="stat-chip"><span>💰</span><span>{p.gold}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ═══ MAP ═══ */}
        <div className="gb-map" onMouseDown={onMapDown} onMouseMove={onMapMove} onMouseUp={onMapUp} onMouseLeave={onMapUp}>
          <svg className="map-svg" width={mapW} height={mapH}
            style={{transform:`translate(${mapOffset.x}px,${mapOffset.y}px)`,display:"block"}}>

            {cells.map(cell => {
              const {x,y}=hexToPixel(cell.col,cell.row,HEX_SIZE);
              const isR=reachableCells.some(c=>c.key===cell.key);
              const isA=attackableCells.some(c=>c.key===cell.key);
              const isSel=selectedCell?.key===cell.key;
              const hasP=players.some(p=>p.alive&&p.col===cell.col&&p.row===cell.row);
              const zone=cell.specialZone?SPECIAL_ZONES[cell.specialZone]:null;
              const terrain=TERRAIN[cell.terrain]||TERRAIN.plains;

              return (
                <g key={cell.key}
                  className={`hex-cell${isR?" reachable":""}${isA?" attackable":""}${isSel?" selected":""}`}
                  onClick={()=>handleCellClick(cell)}
                  onMouseEnter={e=>{ if (zone||cell.terrain!=="plains") setTooltip({x:e.clientX+12,y:e.clientY+12,title:zone?.name||terrain.name,desc:zone?.desc||`ต้นทุนการเดิน: ${terrain.moveCost}`}); }}
                  onMouseLeave={()=>setTooltip(null)}>

                  <polygon className="hbg"
                    points={hexPoints(x,y,HEX_SIZE-2)}
                    fill={terrain.color} stroke={terrain.stroke} strokeWidth="1"/>

                  {isR && <polygon points={hexPoints(x,y,HEX_SIZE-2)} fill="rgba(76,201,76,.18)" stroke="none"/>}
                  {isA && <polygon points={hexPoints(x,y,HEX_SIZE-2)} fill={hasP?"rgba(201,76,76,.3)":"rgba(201,76,76,.1)"} stroke="none"/>}

                  <text x={x} y={y-6} textAnchor="middle" dominantBaseline="middle" fontSize="18" style={{pointerEvents:"none"}}>{terrain.ico}</text>

                  {zone && <>
                    <text x={x} y={y+8} textAnchor="middle" dominantBaseline="middle" fontSize="20" style={{pointerEvents:"none"}}>{zone.ico}</text>
                    <text x={x} y={y+22} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.75)" style={{pointerEvents:"none"}}>{zone.name}</text>
                  </>}

                  {cell.trap && <text x={x+16} y={y-16} fontSize="10" fill="#ff8040" style={{pointerEvents:"none"}}>🪤</text>}
                </g>
              );
            })}

            {players.map((p,i) => {
              if (!p.alive) return null;
              const {x,y}=hexToPixel(p.col,p.row,HEX_SIZE);
              const cls=CLASSES[p.classId];
              const isCur=currentTurn===i;
              const sameCell=players.filter(pp=>pp.alive&&pp.col===p.col&&pp.row===p.row);
              const myI=sameCell.findIndex(pp=>pp.id===p.id);
              const offX=sameCell.length>1?(myI-(sameCell.length-1)/2)*15:0;
              return (
                <g key={i} className={`player-token${isCur?" current-player":""}`}
                  transform={`translate(${x+offX-14},${y-14})`}
                  style={{filter:isCur?"drop-shadow(0 0 10px gold)":"drop-shadow(0 2px 4px rgba(0,0,0,.7))"}}>
                  <circle cx="14" cy="14" r="14" fill={cls?.color+"dd"}
                    stroke={isCur?"gold":i===myIdx?"#4080c9":"rgba(0,0,0,.5)"}
                    strokeWidth={isCur?2.5:i===myIdx?2:1}/>
                  <text x="14" y="14" textAnchor="middle" dominantBaseline="middle" fontSize="16">{cls?.ico}</text>
                  <rect x="1" y="27" width="26" height="3.5" rx="1.75" fill="rgba(0,0,0,.5)"/>
                  <rect x="1" y="27" width={26*(p.hp/p.maxHp)} height="3.5" rx="1.75" fill={p.hp/p.maxHp>0.5?"#c94040":"#ff3030"}/>
                  <text x="14" y="38" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.85)">{p.name}</text>
                </g>
              );
            })}
          </svg>

          {turnAnnounce && <div className="turn-announce">{turnAnnounce}</div>}
        </div>

        {/* ═══ RIGHT PANEL ═══ */}
        <div className="gb-right">
          <div className="rtabs">
            {[
              {id:"log",  ico:"📜", lbl:"บันทึก"},
              {id:"obj",  ico:"🎯", lbl:"เป้าหมาย"},
              {id:"rules",ico:"📖", lbl:"กฎ"},
              {id:"zones",ico:"🗺️", lbl:"พื้นที่"},
            ].map(t=>(
              <div key={t.id} className={`rtab${rightTab===t.id?" on":""}`} onClick={()=>setRightTab(t.id)}>
                <span className="rtab-ico">{t.ico}</span>{t.lbl}
              </div>
            ))}
          </div>

          <div className="rpanel">
            {rightTab==="log" && log.map((e,i)=>(
              <div key={i} className={`log-e ${e.type==="important"?"imp":e.type}`}>{e.msg}</div>
            ))}

            {rightTab==="obj" && <>
              {me && (
                <div className="obj-box" style={{borderLeftColor:ROLES[me.role]?.color}}>
                  <div className="obj-title" style={{color:ROLES[me.role]?.color}}>{ROLES[me.role]?.ico} บทบาทของคุณ: {ROLES[me.role]?.name}</div>
                  <div className="obj-text">{ROLES[me.role]?.desc}</div>
                  <div style={{marginTop:"6px",fontSize:"10px",color:"var(--gold-l)"}}>🏆 {ROLES[me.role]?.win}</div>
                </div>
              )}
              <div style={{fontSize:"10px",color:"var(--txt2)",marginBottom:"8px",fontFamily:"'Cinzel',serif",letterSpacing:".06em"}}>บทบาทในเกม</div>
              {Object.values(ROLES).map(r=>(
                <div key={r.id} className="zone-card" style={{borderColor:r.color+"40"}}>
                  <div className="zone-head"><span className="zone-ico">{r.ico}</span><span className="zone-name" style={{color:r.color}}>{r.name}</span></div>
                  <div className="zone-desc">{r.desc}</div>
                  <div style={{fontSize:"9px",color:"var(--gold-l)",marginTop:"4px"}}>🏆 {r.win}</div>
                </div>
              ))}
            </>}

            {rightTab==="rules" && RULES.map((r,i)=>(
              <div key={i} className="rule-item">
                <div className="rule-head"><span className="rule-ico">{r.ico}</span><span className="rule-title">{r.title}</span></div>
                <div className="rule-body">{r.body}</div>
              </div>
            ))}

            {rightTab==="zones" && Object.entries(SPECIAL_ZONES).map(([id,z])=>(
              <div key={id} className="zone-card">
                <div className="zone-head"><span className="zone-ico">{z.ico}</span><span className="zone-name">{z.name}</span></div>
                <div className="zone-desc">{z.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ BOTTOM BAR ═══ */}
        <div className="gb-bottom">
          <div className="action-strip">
            {/* Action buttons */}
            <button className={`act-btn${actionsDone.moved?" done":actionMode==="move"?" active":""}`}
              disabled={!isMyTurn||actionsDone.moved}
              onClick={()=>setActionMode(actionMode==="move"?null:"move")}>
              <span className="act-ico">🚶</span>
              <span style={{fontSize:"10px"}}>เดิน</span>
              <span className="act-sub">{actionsDone.moved?"✓ แล้ว":`ระยะ ${me?.move||3}`}</span>
            </button>

            <button className={`act-btn${actionsDone.attacked?" done":actionMode==="attack"?" active":""}`}
              disabled={!isMyTurn||actionsDone.attacked}
              onClick={()=>setActionMode(actionMode==="attack"?null:"attack")}>
              <span className="act-ico">⚔️</span>
              <span style={{fontSize:"10px"}}>โจมตี</span>
              <span className="act-sub">{actionsDone.attacked?"✓ แล้ว":`ATK ${me?.atk||0}`}</span>
            </button>

            <button className={`act-btn${actionsDone.usedItem?" done":actionMode==="card"||actionMode==="trap"?" active":""}`}
              disabled={!isMyTurn||actionsDone.usedItem||!selectedCard}
              onClick={()=>{ if (!selectedCard) return; if (TRAP_CARDS.some(t=>t.id===selectedCard.id)) setActionMode(actionMode==="trap"?null:"trap"); else setActionMode(actionMode==="card"?null:"card"); }}>
              <span className="act-ico">🃏</span>
              <span style={{fontSize:"10px"}}>ใช้การ์ด</span>
              <span className="act-sub">{actionsDone.usedItem?"✓ แล้ว":selectedCard?`"${selectedCard.name.substring(0,8)}"`:"-เลือกก่อน-"}</span>
            </button>

            <div className="act-sep"/>

            <div className="act-info">
              <span className="act-info-lbl">เฟส</span>
              <span className="act-info-val">{phase}/6</span>
            </div>
            <div className="act-info">
              <span className="act-info-lbl">ทอง</span>
              <span className="act-info-val">💰 {me?.gold||0}</span>
            </div>
            <div className="act-info">
              <span className="act-info-lbl">มานา</span>
              <span className="act-info-val" style={{color:"#6080e0"}}>💧 {me?.mana||0}</span>
            </div>

            <div className="act-sep"/>

            {isMyTurn
              ? <button className="tb-btn tb-btn-primary" style={{height:"38px",padding:"0 16px",fontSize:"11px"}} onClick={endTurn} disabled={!!gameOver}>⏭ จบเทิร์น</button>
              : <div className="act-wait">⏳ รอ {currentPlayer?.name}…</div>
            }

            {selectedCard && <div style={{marginLeft:"auto",fontSize:"10px",color:"var(--txt2)",padding:"0 8px",fontStyle:"italic"}}>
              เลือก: {selectedCard.ico} {selectedCard.name} — คลิกปุ่มใช้การ์ดแล้วเลือกเป้าหมาย
            </div>}
          </div>

          {/* Hand cards */}
          <div className="hand-scroll">
            {me?.hand?.map((card,ci) => {
              const isSel=selectedCard?.uid===card.uid;
              return (
                <div key={card.uid||ci} className={`hcard${isSel?" sel":""}`}
                  onClick={()=>{ if (!isMyTurn) return; setSelectedCard(isSel?null:card); setActionMode(null); }}
                  onMouseEnter={e=>setTooltip({x:e.clientX+8,y:e.clientY-90,title:card.name,desc:card.desc||""})}
                  onMouseLeave={()=>setTooltip(null)}>
                  <span className={`hcard-rarity ${rarityClass(card.rarity)}`}>{rarityIco(card.rarity)}</span>
                  <span className="hcard-ico">{card.ico}</span>
                  <div className="hcard-name">{card.name}</div>
                  <div className="hcard-desc">{card.desc}</div>
                  <div className="hcard-type">{card.type==="weapon"?"🗡️ อาวุธ":card.type==="magic"?"🔮 เวทย์":"🪤 กับดัก"}</div>
                </div>
              );
            })}
            {(!me?.hand||me.hand.length===0) && <div style={{color:"var(--txt3)",fontSize:"11px",padding:"0 12px",fontStyle:"italic"}}>ไม่มีการ์ดในมือ</div>}
          </div>
        </div>

      </div>{/* end gb-root */}

      {/* ═══ OVERLAYS ═══ */}
      {showDice!==null && <div className="dice-anim">{["⚀","⚁","⚂","⚃","⚄","⚅"][showDice-1]||"🎲"}</div>}

      {activeEvent && (
        <div className="event-banner">
          <span className="ev-ico">{activeEvent.ico}</span>
          <div className="ev-name">{activeEvent.name}</div>
          <div className="ev-desc">{activeEvent.desc}</div>
        </div>
      )}

      {tooltip && (
        <div className="tooltip" style={{left:tooltip.x,top:tooltip.y}}>
          <div className="tt-title">{tooltip.title}</div>
          <div className="tt-desc">{tooltip.desc}</div>
        </div>
      )}

      {gameOver && (
        <div className="win-overlay">
          <div className="win-box">
            <span className="win-ico">{gameOver.winner==="king"?"👑":gameOver.winner==="rebel"?"⚔️":gameOver.winner==="traitor"?"🗡️":"🏆"}</span>
            <div className="win-title">เกมจบแล้ว!</div>
            <div className="win-sub">ผู้ชนะ: {gameOver.players?.map(p=>p.name).join(", ")}</div>
            <div className="win-reason">{gameOver.reason}</div>
            <button className="tb-btn tb-btn-primary" style={{width:"100%",height:"40px",fontSize:"12px"}}
              onClick={()=>{ if (onLeave) onLeave(); else window.location.reload(); }}>
              🏠 กลับหน้าหลัก
            </button>
          </div>
        </div>
      )}
    </>
  );
}
ENDOFFILE