// preview.jsx — โชว์งานที่แก้ (items 14–20): log ย่อ/ขยาย · มือซ้อนเหลื่อม · ไฮไลต์เดิน/โจมตี · ป้ายสถานที่ · ลานบัลลังก์
import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./game/styles/gameboard.css";
import IslandMap3D from "./game/components/IslandMap3D.jsx";
import HandCard from "./game/components/HandCard.jsx";

// ── แมพจำลอง: ที่ราบล้อมที่สูง(เงา) + บัลลังก์กลาง + landmark หลายจุด ──
const cells = [];
for (let col = 0; col < 9; col++) {
  for (let row = 0; row < 9; row++) {
    let biome = "grass", elev = 1, terrain = "plains";
    const inPlateau = col >= 2 && col <= 6 && row >= 2 && row <= 6;
    if (inPlateau) { biome = "shadow"; elev = 5; terrain = "mountain"; }
    else if (col < 2) { biome = "snow"; elev = 2; }
    else if (col > 6) { biome = "forest"; elev = 1; terrain = "forest"; }
    else if (row > 6) { biome = "forest"; elev = 1; terrain = "forest"; }
    else if (row < 2) { biome = "desert"; elev = 1; }
    cells.push({ col, row, key: `${col},${row}`, biome, elev, terrain });
  }
}
const throne = cells.find(c => c.col === 4 && c.row === 4); throne.specialZone = "throne"; throne.biome = "throne";
for (const c of cells) if (Math.abs(c.col - 4) <= 1 && Math.abs(c.row - 4) <= 1 && c !== throne) c.reserved = true;
const setZone = (cc, rr, z) => { const t = cells.find(c => c.col === cc && c.row === rr); if (t) t.specialZone = z; };
setZone(6, 3, "village"); setZone(1, 6, "market"); setZone(7, 7, "rebel_camp"); setZone(2, 1, "tower"); setZone(8, 1, "cave");
for (const [cc, rr] of [[1, 5], [3, 7]]) { const t = cells.find(c => c.col === cc && c.row === rr); if (t) t.trap = { name: "กับดักหนาม", ico: "🪤", ownerId: 0 }; }

// ชื่อสถานที่ → โชว์ป้ายเมื่อเปิด toggle
const ZONES = {
  throne: { name: "ศาลบัลลังก์", ico: "👑", color: "#c9a84c" },
  village: { name: "หมู่บ้าน", ico: "🏠", color: "#8fce6a" },
  market: { name: "ตลาด", ico: "🪙", color: "#e0b84a" },
  rebel_camp: { name: "ค่ายกบฏ", ico: "⚔️", color: "#e06a5a" },
  tower: { name: "หอสังเกตการณ์", ico: "🗼", color: "#9ab0d0" },
  cave: { name: "ถ้ำมืด", ico: "🕳️", color: "#a070d0" },
};

const basePlayers = [
  { id: "p1", name: "ซุนหวู่", charId: "sunwu", role: "king", col: 1, row: 8, hp: 9, maxHp: 11, mana: 7, maxMana: 8, atk: 2, def: 2, move: 3, range: 1, alive: true, playerColor: "#e05050", playerIcon: "👑", gold: 5 },
  { id: "p2", name: "เจิ้งเหอ", charId: "zhenghe", role: "rebel", col: 7, row: 8, hp: 10, maxHp: 10, mana: 4, maxMana: 10, atk: 2, def: 1, move: 3, range: 0, alive: true, playerColor: "#50a0e0", playerIcon: "⛵", gold: 9 },
];

const HAND = [
  { uid: "c1", name: "ลูกศรเพลิง", ico: "🏹", desc: "ยิงศัตรูระยะไกล เสียหาย 3 + ไฟไหม้ 2 เทิร์น", type: "magic", cost: 2, rarity: "rare", element: "fire", target: "enemy" },
  { uid: "c2", name: "เกราะหยก", ico: "🛡️", desc: "สวมเกราะ DEF +2 ตลอดเกม", type: "weapon", rarity: "common", target: "self" },
  { uid: "c3", name: "กับดักเงามืด", ico: "🪤", desc: "วางกับดักช่องข้างเคียง ล็อกขา 2 เทิร์น", type: "trap", rarity: "rare", target: "tile" },
  { uid: "c4", name: "พายุหิมะ", ico: "❄️", desc: "แช่แข็งศัตรูรอบตัว 1 เทิร์น", type: "magic", cost: 3, rarity: "divine", element: "ice", target: "aoe" },
  { uid: "c5", name: "ฟ้าผ่า", ico: "⚡", desc: "เสียหาย 4 ใส่เป้าหมายเดียว", type: "magic", cost: 2, rarity: "rare", element: "lightning", target: "enemy" },
  { uid: "c6", name: "ยาฟื้นพลัง", ico: "🧪", desc: "ฟื้น HP 4 หน่วย", type: "magic", cost: 1, rarity: "common", target: "self" },
  { uid: "c7", name: "ดาบมังกร", ico: "🗡️", desc: "ATK +3 ตลอดเกม", type: "weapon", rarity: "epic", target: "self" },
  { uid: "c8", name: "เงาลวง", ico: "🌑", desc: "ล่องหน 1 เทิร์น หลบโจมตี", type: "magic", cost: 2, rarity: "epic", element: "dark", target: "self" },
];

const LOG = [
  { type: "event", msg: "🎲 เกมเริ่ม! พระราชาเปิดตัวและเริ่มเล่นก่อน" },
  { type: "", msg: "ซุนหวู่ เดินไปช่อง (1,7)" },
  { type: "dmg", msg: "⚔️ ซุนหวู่ โจมตี เจิ้งเหอ — เสียหาย 3" },
  { type: "heal", msg: "🧪 เจิ้งเหอ ใช้ยาฟื้นพลัง — HP +4" },
  { type: "event", msg: "🪤 เจิ้งเหอ เหยียบกับดักหนาม! ล็อกขา 2 เทิร์น" },
  { type: "death", msg: "💀 ทหารกบฏถูกสังหารที่ค่ายกบฏ" },
  { type: "event", msg: "🌙 กลางคืนปกคลุมเกาะ — เวทมืดแรงขึ้น" },
];

function Preview() {
  const [players, setPlayers] = useState(basePlayers);
  const [showLabels, setShowLabels] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [bigHand, setBigHand] = useState(true);
  const [statbarOpen, setStatbarOpen] = useState(true);

  useEffect(() => {
    const loop = [[1, 8], [1, 7], [2, 7], [3, 7], [3, 8], [5, 8], [7, 8], [7, 7], [8, 7], [8, 8], [7, 8], [5, 8], [3, 8], [1, 8]];
    let id = 1;
    const step = () => setPlayers(ps => ps.map((p, i) => i === 0
      ? { ...p, col: loop[loop.length - 1][0], row: loop[loop.length - 1][1], _moveTrail: { id: id++, path: loop.map(([col, row]) => ({ col, row })) } }
      : p));
    step();
    const t = setInterval(step, 4000);
    return () => clearInterval(t);
  }, []);

  // ช่องเดินได้ (เขียว) รอบผู้เล่น 1  ·  ช่องโจมตีได้ (แดง) รอบผู้เล่น 2
  const reach = cells.filter(c => Math.abs(c.col - players[0].col) <= 1 && Math.abs(c.row - players[0].row) <= 1 && !(c.col === players[0].col && c.row === players[0].row));
  const attack = cells.filter(c => Math.abs(c.col - players[1].col) <= 1 && Math.abs(c.row - players[1].row) <= 1 && !(c.col === players[1].col && c.row === players[1].row));
  const hand = bigHand ? HAND : HAND.slice(0, 3);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0a14", color: "#e8d5b0" }}>
      <div className="map-area" style={{ position: "absolute", inset: 0 }}>
        <IslandMap3D
          cells={cells} players={players} myIdx={0} currentTurn={0}
          reachableCells={reach} attackableCells={attack} trapCells={[]} skillTargetCells={[]}
          selectedCell={null} pendingMove={null} zones={ZONES} categoryColors={{}}
          showLabels={showLabels}
          onCellClick={() => {}} onCellHover={() => {}} onCellLeave={() => {}}
        />

        {/* ── 14: event log ย่อ/ขยายได้ (ล่างกลาง) ── */}
        <div className={`hud-log ${logOpen ? "open" : "collapsed"}`}>
          <div className="hud-log-hd" onClick={() => setLogOpen(v => !v)}>
            <span className="lh-t">📜 บันทึกเหตุการณ์</span>
            {!logOpen && <span className="lh-sum">{LOG[LOG.length - 1].msg}</span>}
            <span className="lh-x">{logOpen ? "▼ ย่อ" : "▲ ขยาย"}</span>
          </div>
          <div className="hud-log-body">
            {LOG.map((e, i) => <div key={i} className={`hud-log-row ${e.type}`}>{e.msg}</div>)}
          </div>
        </div>

        {/* ── 15: มือผู้เล่น — >5 ใบ ซ้อนเหลื่อม ── */}
        <div className="hand-rail">
          <div className="rail-head"><span>🂠 {hand.length}/10</span><span style={{ color: "var(--txt-m)" }}>ชี้เมาส์เพื่อกาง →</span></div>
          <div className={`rail-list${hand.length > 5 ? " overlap" : ""}`}>
            {hand.map((card, i) => (
              <HandCard key={card.uid} card={card} isSelected={i === 0} isMyTurn={true}
                onSelect={() => {}} onHover={() => {}} onLeave={() => {}} />
            ))}
          </div>
        </div>

        {/* ── 28: แถบสถานะถูกยุบเข้า right-strip (คอลัมน์ขวา) ── */}

        {/* ── 16: right strip + สถานะผู้เล่นแนวตั้ง ── */}
        <div className="right-strip">
          <div className="strip-btn"><span style={{ pointerEvents: "none" }}>🃏</span><label>ไพ่</label><span className="strip-badge">{hand.length}</span></div>
          <div className={`strip-btn${showLabels ? " active-mode" : ""}`} onClick={() => setShowLabels(v => !v)} title="ป้ายชื่อสถานที่">🗺️<label>สถานที่</label></div>
          <div className="strip-btn">🐯<label>สกิล</label></div>
          <div className="strip-btn">👑<label>ราชา</label></div>
          <div className="strip-spacer" />
          {/* สถานะผู้เล่นเรา (ยุบแนวตั้ง) */}
          <div className="strip-sep" />
          <div className="strip-portrait" title="ดูสถานะเต็ม">👑</div>
          <div className="strip-stat hp">❤️<span>9/11</span></div>
          <div className="strip-stat mp">💧<span>7/8</span></div>
          <div className="strip-stat">⚔️<span>2</span></div>
          <div className="strip-stat">🛡️<span>2</span></div>
          <div className="strip-stat">👟<span>3</span></div>
          <div className="strip-stat">🎯<span>1</span></div>
          <div className="strip-stat gold">💰<span>5</span></div>
          <div className="strip-sep" />
          <div className="strip-stat">เฟส<span>2/3</span></div>
        </div>

        {/* ── ตัวควบคุม preview ── */}
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 60, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 520 }}>
          <button className="tb-btn" onClick={() => setLogOpen(v => !v)}>Log: {logOpen ? "ขยาย" : "ย่อ"}</button>
          <button className="tb-btn" onClick={() => setShowLabels(v => !v)}>ป้ายสถานที่: {showLabels ? "เปิด" : "ปิด"}</button>
          <button className="tb-btn" onClick={() => setBigHand(v => !v)}>มือ: {bigHand ? "8 ใบ" : "3 ใบ"}</button>
          <button className="tb-btn" onClick={() => setStatbarOpen(v => !v)}>แถบสถานะ: {statbarOpen ? "ขยาย" : "ย่อ"}</button>
        </div>
        <div style={{ position: "absolute", top: 46, left: 10, zIndex: 60, background: "rgba(0,0,0,.6)", padding: "5px 10px", borderRadius: 8, fontFamily: "monospace", fontSize: 11, color: "#c9a84c", maxWidth: 520, lineHeight: 1.5 }}>
          PREVIEW items 14–20 · เขียว=เดิน แดง=โจมตี (เรืองแสง+เต้น) · ลานบัลลังก์มีรั้ว/คบเพลิง/ธง · ป้ายชื่อสถานที่ · มือ 8 ใบซ้อนเหลื่อม · log ย่อ/ขยาย · แถบขวาใหญ่ขึ้น
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Preview /></StrictMode>);
