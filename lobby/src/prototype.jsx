// prototype.jsx — มิเรอร์ HUD จริงของ GameBoard (ใช้คลาส hud-*/hand-rail/right-strip/endturn-ornate จาก gameboard.css)
// ใช้ตรวจ composition/collision ก่อน deploy
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./prototype.css";
import CharIcon from "./game/components/CharIcon.jsx";
import { CHARACTERS } from "./game/constants/characters.js";

const PLAYERS = [
  { id: 0, charId: "sunwu", name: "ซุนวู่", roleIco: "👑", roleName: "พระราชา", hp: 9, maxHp: 11, mana: 7, maxMana: 8, atk: 2, def: 2, move: 3, range: 1, gold: 5, alive: true,
    statusEffects: [{ type: "regen", duration: 2 }, { type: "poison", duration: 2 }] },
  { id: 1, charId: "zhenghe", name: "เจิ้งเหอ", roleIco: "⚔️", roleName: "กบฏ", hp: 10, maxHp: 10, mana: 4, maxMana: 10, atk: 2, def: 1, move: 3, range: 0, gold: 9, alive: true, statusEffects: [] },
  { id: 2, charId: "assassin", name: "นักฆ่าเงา", roleIco: "❓", roleName: "ปริศนา", hp: 6, maxHp: 11, mana: 5, maxMana: 8, atk: 4, def: 1, move: 4, range: 0, gold: 3, alive: true, statusEffects: [] },
  { id: 3, charId: "archer", name: "อาชาฝีมือ", roleIco: "❓", roleName: "ปริศนา", hp: 0, maxHp: 10, mana: 0, maxMana: 9, atk: 2, def: 1, move: 3, range: 2, gold: 0, alive: false, statusEffects: [] },
];
const CARDS = [
  { ico: "🏹", nm: "ลูกศรเพลิง", desc: "ยิงศัตรูระยะไกล เสียหาย 3 + ไฟไหม้ 2 เทิร์น", rar: "rare", g: "◆" },
  { ico: "🛡️", nm: "เกราะหยก", desc: "สวมเกราะ DEF +2 ตลอดเกม", rar: "common", g: "·" },
  { ico: "🪤", nm: "กับดักเงา", desc: "วางช่องข้างเคียง ศัตรูเหยียบ → ล็อกขา 2 เทิร์น", rar: "rare", g: "◆" },
  { ico: "❄️", nm: "พายุหิมะ", desc: "แช่แข็งศัตรูทุกคนรอบตัว 1 เทิร์น", rar: "divine", g: "✦" },
  { ico: "✨", nm: "พรศักดิ์สิทธิ์", desc: "ฟื้น HP +4 ให้ตัวเองหรือพันธมิตร", rar: "common", g: "·" },
  { ico: "💰", nm: "ปล้นทรัพย์", desc: "ขโมยทอง 3 จากศัตรูในระยะ", rar: "common", g: "·" },
];
const LOG = [
  { type: "event", msg: "🎲 ซุนวู่ (พระราชา) เริ่มเล่นก่อน" },
  { type: "card", msg: "🃏 เจิ้งเหอ ใช้การ์ด \"เกราะหยก\"" },
  { type: "dmg", msg: "⚔️ นักฆ่าเงา โจมตี อาชาฝีมือ เสียหาย 4" },
  { type: "heal", msg: "🌿 ซุนวู่ ฟื้นฟู HP +2" },
  { type: "death", msg: "💀 อาชาฝีมือ ถูกปราบ! เปิดเผยบทบาท: กบฏ" },
  { type: "card", msg: "🃏 ซุนวู่ ใช้การ์ด \"พายุหิมะ\" — แช่แข็งทุกคน" },
];

function Proto() {
  const [logOpen, setLogOpen] = useState(false);
  const [openCard, setOpenCard] = useState(-1);
  const [waiting, setWaiting] = useState(false);
  const me = PLAYERS[0], cur = PLAYERS[0], ct = 0;

  return (
    <div className="pt-root">
      <div className="pt-dev">
        <button onClick={() => { setOpenCard(-1); setLogOpen(false); setWaiting(false); }}>Battle</button>
        <button className={openCard === 0 ? "on" : ""} onClick={() => setOpenCard(openCard === 0 ? -1 : 0)}>Hover การ์ด</button>
        <button className={logOpen ? "on" : ""} onClick={() => setLogOpen(v => !v)}>Log</button>
        <button className={waiting ? "on" : ""} onClick={() => setWaiting(v => !v)}>รอเทิร์น</button>
      </div>

      {/* จำลองบริบทจริง: HUD อยู่ใน .map-area (มี rule .map-area>* ที่เคยทำ position เพี้ยน) */}
      <div className="map-area" style={{ position: "absolute", inset: 0 }}>
      <div className="pt-map pt-map-static" />
      <div className="pt-scrim" />

      {/* crest */}
      <div className="hud-crest">
        <div className="hud-portrait"><CharIcon ch={CHARACTERS[cur.charId]} size={64} /><div className="hud-ap">3</div></div>
        <div className="hud-crest-meta">
          <div className="hud-name">{cur.name} (คุณ)</div>
          <div className="hud-turn-lbl">▶ กำลังเดิน</div>
          <div className="hud-hearts">{Array.from({ length: cur.maxHp }).map((_, i) => <span key={i}>{i < cur.hp ? "❤️" : "🖤"}</span>)}</div>
          <div className="hud-obj">🎯 กำจัดกบฏทั้งหมด หรือรอดจนจบเกม</div>
        </div>
      </div>

      {/* shields */}
      <div className="hud-shields">
        {PLAYERS.map((p, i) => (
          <div key={p.id} className={`hud-shield ${i === ct ? "active" : ""} ${!p.alive ? "dead" : ""}`}>
            <span className="hs-ico">{p.alive ? <CharIcon ch={CHARACTERS[p.charId]} size={30} /> : "💀"}</span>
            <span className="hs-no">{i + 1}</span>
          </div>
        ))}
      </div>

      {/* right strip (mock) */}
      <div className="right-strip">
        <div className="strip-btn">🃏<label>ไพ่</label></div>
        <div className="strip-btn">⚔️<label>สกิล</label></div>
        <div className="strip-spacer" />
        <div className="strip-stat">เฟส<span>1/8</span></div>
        <div className="strip-stat">💰<span>5</span></div>
      </div>

      {/* card rail (mock, ใช้คลาสจริง) */}
      <div className="hand-rail">
        <div className="rail-head"><span>🂠 {CARDS.length}/10</span></div>
        <div className="rail-list">
          {CARDS.map((c, i) => (
            <div key={i} className={`hand-card ${openCard === i ? "selected" : ""}`}
              onMouseEnter={() => setOpenCard(i)} onMouseLeave={() => setOpenCard(p => p === i ? -1 : p)}>
              <span className={`card-rarity rarity-${c.rar}`}>{c.g}</span>
              <span className="card-ico">{c.ico}</span>
              <div className="card-nm">{c.nm}</div>
              <div className="card-desc">{c.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* end turn */}
      {!waiting ? (
        <button className="endturn-ornate"><span className="et-crest">⚜️</span><span className="et-label">จบเทิร์น</span><span className="et-sub">END TURN</span></button>
      ) : (
        <div className="endturn-ornate waiting"><span className="et-crest">⏳</span><span className="et-label">รอเทิร์น</span><span className="et-sub">เจิ้งเหอ</span></div>
      )}

      {/* event log */}
      <div className={`hud-log ${logOpen ? "" : "collapsed"}`}>
        <div className="hud-log-hd" onClick={() => setLogOpen(v => !v)}>
          <span className="lh-t">📜 บันทึกเหตุการณ์</span><span className="lh-x">{logOpen ? "▼ ย่อ" : "▲ ขยาย"}</span>
        </div>
        <div className="hud-log-body">
          {(logOpen ? LOG : LOG.slice(-1)).map((e, i) => <div key={i} className={`hud-log-row ${e.type}`}>{e.msg}</div>)}
        </div>
      </div>

      {/* stat bar */}
      <div className="hud-statbar">
        <div className="hud-sb-portrait"><div className="hud-sb-mini"><CharIcon ch={CHARACTERS[me.charId]} size={38} /></div>
          <div className="hud-sb-id">{me.name}<small>{me.roleIco} {me.roleName}</small></div></div>
        <div className="hud-sb-stats">
          <div className="hud-coin hp"><span className="c-ico">❤️</span><span className="c-val">{me.hp}/{me.maxHp}</span><span className="c-lab">HP</span></div>
          <div className="hud-coin mp"><span className="c-ico">💧</span><span className="c-val">{me.mana}/{me.maxMana}</span><span className="c-lab">มานา</span></div>
          <div className="hud-sb-sep" />
          <div className="hud-coin"><span className="c-ico">⚔️</span><span className="c-val">{me.atk}</span><span className="c-lab">โจมตี</span></div>
          <div className="hud-coin"><span className="c-ico">🛡️</span><span className="c-val">{me.def}</span><span className="c-lab">ป้องกัน</span></div>
          <div className="hud-coin"><span className="c-ico">👟</span><span className="c-val">{me.move}</span><span className="c-lab">ความเร็ว</span></div>
          <div className="hud-coin"><span className="c-ico">🎯</span><span className="c-val">{me.range}</span><span className="c-lab">ระยะ</span></div>
          <div className="hud-sb-sep" />
          <div className="hud-coin gold"><span className="c-ico">💰</span><span className="c-val">{me.gold}</span><span className="c-lab">ทอง</span></div>
        </div>
        <div className="hud-sb-fx">
          {me.statusEffects.map((s, i) => <span key={i} className={`status-tag status-${s.type}`}>{s.type} {s.duration}t</span>)}
        </div>
      </div>
      </div>{/* end .map-area */}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Proto /></StrictMode>);
