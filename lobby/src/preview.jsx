// preview.jsx — โชว์ผลงานที่แก้ (ไม่ใช่เกมจริง): map 3D + ธงกับดัก + เดินทีละช่อง + การ์ดราง + ใบสถานะ
import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./game/styles/gameboard.css";
import IslandMap3D from "./game/components/IslandMap3D.jsx";
import PlayerCard from "./game/components/PlayerCard.jsx";
import HandCard from "./game/components/HandCard.jsx";

// ── แมพจำลอง: ที่ราบเขียวล้อมที่สูง(เงา) เป็นหน้าผา + บัลลังก์กลาง — ดูว่าพร็อพไม่ล้นขอบ ──
const cells = [];
for (let col = 0; col < 9; col++) {
  for (let row = 0; row < 9; row++) {
    let biome = "grass", elev = 1, terrain = "plains";
    const inPlateau = col >= 2 && col <= 6 && row >= 2 && row <= 6;
    if (inPlateau) { biome = "shadow"; elev = 5; terrain = "mountain"; }
    else if (col < 2) { biome = "snow"; elev = 2; }
    else if (col > 6) { biome = "forest"; elev = 1; terrain = "forest"; }
    else if (row > 6) { biome = "forest"; elev = 1; terrain = "forest"; }
    else if (row < 2) { biome = "desert"; elev = 1; terrain = "desert"; }
    cells.push({ col, row, key: `${col},${row}`, biome, elev, terrain });
  }
}
// บัลลังก์เงากลางที่สูง + reserve ช่องรอบ
const throne = cells.find(c => c.col === 4 && c.row === 4); throne.specialZone = "throne"; throne.biome = "throne";
for (const c of cells) if (Math.abs(c.col - 4) <= 1 && Math.abs(c.row - 4) <= 1 && c !== throne) c.reserved = true;
// หมู่บ้านที่ขอบหน้าผา (โชว์อาคารพอดีช่อง)
const vil = cells.find(c => c.col === 6 && c.row === 3); if (vil) vil.specialZone = "village";
// กับดัก 2 จุด (โชว์ธง 🪤)
for (const [cc, rr] of [[1, 5], [3, 7]]) { const t = cells.find(c => c.col === cc && c.row === rr); if (t) t.trap = { name: "กับดักหนาม", ico: "🪤", ownerId: 0 }; }

const basePlayers = [
  { id: "p1", name: "ซุนหวู่", charId: "sunwu", role: "king", col: 1, row: 8, hp: 9, maxHp: 11, mana: 7, maxMana: 8, atk: 2, def: 2, move: 3, range: 1, alive: true, playerColor: "#e05050", playerIcon: "👑", gold: 5, equipment: [{ name: "ดาบเหล็ก", ico: "🗡️", atk: 2 }] },
  { id: "p2", name: "เจิ้งเหอ", charId: "zhenghe", role: "rebel", col: 7, row: 8, hp: 10, maxHp: 10, mana: 4, maxMana: 10, atk: 2, def: 1, move: 3, range: 0, alive: true, playerColor: "#50a0e0", playerIcon: "⛵", gold: 9, equipment: [] },
];

const HAND = [
  { uid: "c1", name: "ลูกศรเพลิง", ico: "🏹", desc: "ยิงศัตรูระยะไกล สร้างความเสียหาย 3 + ไฟไหม้ 2 เทิร์น", type: "magic", cost: 2, rarity: "rare", element: "fire", target: "enemy" },
  { uid: "c2", name: "เกราะหยก", ico: "🛡️", desc: "สวมเกราะ DEF +2 ตลอดเกม", type: "weapon", rarity: "common", target: "self" },
  { uid: "c3", name: "กับดักเงามืด", ico: "🪤", desc: "วางกับดักช่องข้างเคียง ศัตรูเหยียบโดนล็อกขา 2 เทิร์น", type: "trap", rarity: "rare", target: "tile" },
  { uid: "c4", name: "พายุหิมะ", ico: "❄️", desc: "แช่แข็งศัตรูทุกคนรอบตัว 1 เทิร์น", type: "magic", cost: 3, rarity: "divine", element: "ice", target: "aoe" },
];

function Preview() {
  const [players, setPlayers] = useState(basePlayers);
  // เดินวนรอบขอบแมพเป็นลูป (waypoints ยาว) → โทเคน "เลื่อนทีละช่อง" เกือบตลอดเวลา (ดูชัดว่าไม่วาป)
  useEffect(() => {
    const loop = [[1, 8], [1, 7], [2, 7], [3, 7], [3, 8], [5, 8], [7, 8], [7, 7], [8, 7], [8, 8], [7, 8], [5, 8], [3, 8], [1, 8]];
    let id = 1;
    const step = () => {
      setPlayers(ps => ps.map((p, i) => i === 0
        ? { ...p, col: loop[loop.length - 1][0], row: loop[loop.length - 1][1], _moveTrail: { id: id++, path: loop.map(([col, row]) => ({ col, row })) } }
        : p));
    };
    step();
    const t = setInterval(step, 4000);
    return () => clearInterval(t);
  }, []);

  // ช่องที่ "เดินได้" รอบผู้เล่น 1 (โชว์ไฮไลต์เขียวอัตโนมัติ)
  const reach = cells.filter(c => Math.abs(c.col - players[0].col) <= 1 && Math.abs(c.row - players[0].row) <= 1 && !(c.col === players[0].col && c.row === players[0].row));

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0a14", display: "grid", gridTemplateColumns: "230px 1fr", color: "#e8d5b0" }}>
      {/* ซ้าย: ใบสถานะ (UI สถานะ/อุปกรณ์แบบใหม่) */}
      <div className="left-panel" style={{ overflowY: "auto" }}>
        <div className="sec-hdr" style={{ marginTop: 4 }}>ผู้เล่น (UI สถานะใหม่)</div>
        {players.map((p, i) => (
          <PlayerCard key={p.id} player={p} isCurrentTurn={i === 0} isMe={i === 0} onHover={() => {}} onLeave={() => {}} />
        ))}
      </div>

      {/* ขวา: แมพ + รางการ์ด */}
      <div className="map-area" style={{ position: "relative" }}>
        <IslandMap3D
          cells={cells} players={players} myIdx={0} currentTurn={0}
          reachableCells={reach} attackableCells={[]} trapCells={[]} skillTargetCells={[]}
          selectedCell={null} pendingMove={null} zones={{}} categoryColors={{}}
          onCellClick={() => {}} onCellHover={() => {}} onCellLeave={() => {}}
        />
        {/* การ์ดราง — ใบที่ 1 ตั้งเป็น selected เพื่อโชว์การ "เด้งออกแนวนอน" */}
        <div className="hand-rail">
          <div className="rail-head"><span>🂠 {HAND.length}/10</span><span style={{ color: "var(--txt-m)" }}>ชี้เมาส์เพื่อกาง →</span></div>
          <div className="rail-list">
            {HAND.map((card, i) => (
              <HandCard key={card.uid} card={card} isSelected={i === 0} isMyTurn={true}
                onSelect={() => {}} onHover={() => {}} onLeave={() => {}} />
            ))}
          </div>
          <button className="rail-use tb-btn primary">🃏 ใช้ "{HAND[0].name}" (0/4)</button>
        </div>

        <div style={{ position: "absolute", top: 8, left: 8, zIndex: 50, background: "rgba(0,0,0,.65)", padding: "6px 12px", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#c9a84c", maxWidth: 360, lineHeight: 1.6 }}>
          PREVIEW — โทเคน 👑 เดินทีละช่องวนไปมา (ดูว่าเลื่อน ไม่วาป) · ธง 🪤 = กับดัก · พร็อพไม่ล้นขอบ · การ์ดด้านขวา · ใบสถานะซ้าย
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Preview /></StrictMode>);
