// prototype.jsx — Armello-style battle UI mockup (รอ approve ก่อนรวมเข้า GameBoard จริง)
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./prototype.css";
import CharIcon from "./game/components/CharIcon.jsx";
import { CHARACTERS } from "./game/constants/characters.js";

const ROLE_TAG = { king: "tag-king", rebel: "tag-rebel", traitor: "tag-traitor", commoner: "tag-commoner", hidden: "tag-hidden" };

const PLAYERS = [
  { id: 0, charId: "sunwu", name: "ซุนวู่", role: "👑 พระราชา", roleTag: "king", turn: 1,
    hp: 9, maxHp: 11, mana: 7, maxMana: 8, atk: 2, def: 2, move: 3, range: 1, gold: 5, alive: true,
    buffs: [{ ico: "🛡️", t: "เกราะ +2" }, { ico: "⚡", t: "เร่งเร็ว 1 เทิร์น" }], debuffs: [{ ico: "☠️", t: "พิษ 2 เทิร์น" }],
    passive: { ico: "🌑", name: "เงามืด", desc: "ตอนกลางคืนได้รับการพรางตัวทุกที่ ยกเว้นที่บัลลังก์" },
    active: [{ ico: "🔥", t: "ดาบวายุ — พร้อมใช้" }], equip: [{ ico: "🗡️", nm: "ดาบเหล็ก" }, { ico: "💍", nm: "แหวนทับทิม" }] },
  { id: 1, charId: "zhenghe", name: "เจิ้งเหอ", role: "⚔️ กบฏ", roleTag: "rebel", turn: 2,
    hp: 10, maxHp: 10, mana: 4, maxMana: 10, atk: 2, def: 1, move: 3, range: 0, gold: 9, alive: true,
    buffs: [{ ico: "🌿", t: "ฟื้นฟู 1/เทิร์น" }], debuffs: [],
    passive: { ico: "⛵", name: "นักสำรวจ", desc: "เดินเข้าโซนพิเศษ ได้ทอง +1 พิเศษ" },
    active: [], equip: [{ ico: "🏹", nm: "ธนูยาว" }] },
  { id: 2, charId: "assassin", name: "นักฆ่าเงา", role: "❓ ปริศนา", roleTag: "hidden", turn: 3,
    hp: 6, maxHp: 11, mana: 5, maxMana: 8, atk: 4, def: 1, move: 4, range: 0, gold: 3, alive: true,
    buffs: [], debuffs: [{ ico: "🩸", t: "เลือดไหล 1/เทิร์น" }],
    passive: { ico: "🗡️", name: "ลอบกัด", desc: "โจมตีจากด้านหลังสร้างความเสียหาย +2" },
    active: [], equip: [] },
  { id: 3, charId: "archer", name: "อาชาฝีมือ", role: "❓ ปริศนา", roleTag: "hidden", turn: 4,
    hp: 0, maxHp: 10, mana: 0, maxMana: 9, atk: 2, def: 1, move: 3, range: 2, gold: 0, alive: false,
    buffs: [], debuffs: [],
    passive: { ico: "🏹", name: "ตาเหยี่ยว", desc: "ถ้าไม่เดินในเทิร์น ระยะยิง +1" },
    active: [], equip: [] },
];
const CARDS = [
  { ico: "🏹", nm: "ลูกศรเพลิง", tag: "เวทย์ · 💧2", desc: "ยิงศัตรูระยะไกล เสียหาย 3 + ไฟไหม้ 2 เทิร์น", rar: "R" },
  { ico: "🛡️", nm: "เกราะหยก", tag: "อุปกรณ์", desc: "สวมเกราะ DEF +2 ตลอดเกม", rar: "C" },
  { ico: "🪤", nm: "กับดักเงา", tag: "กับดัก", desc: "วางช่องข้างเคียง ศัตรูเหยียบ → ล็อกขา 2 เทิร์น", rar: "R" },
  { ico: "❄️", nm: "พายุหิมะ", tag: "เวทย์ · 💧3", desc: "แช่แข็งศัตรูทุกคนรอบตัว 1 เทิร์น", rar: "D" },
  { ico: "✨", nm: "พรศักดิ์สิทธิ์", tag: "เวทย์ · 💧2", desc: "ฟื้น HP +4 ให้ตัวเองหรือพันธมิตร", rar: "C" },
  { ico: "💰", nm: "ปล้นทรัพย์", tag: "เวทย์ · 💧1", desc: "ขโมยทอง 3 จากศัตรูในระยะ", rar: "C" },
];
const LOG = [
  { turn: 1, type: "event", msg: "🎲 ซุนวู่ (พระราชา) เริ่มเล่นก่อน" },
  { turn: 1, type: "card", msg: "🃏 เจิ้งเหอ ใช้การ์ด \"เกราะหยก\"" },
  { turn: 2, type: "dmg", msg: "⚔️ นักฆ่าเงา โจมตี อาชาฝีมือ เสียหาย 4" },
  { turn: 2, type: "heal", msg: "🌿 ซุนวู่ ฟื้นฟู HP +2" },
  { turn: 3, type: "dmg", msg: "🪤 อาชาฝีมือ เหยียบกับดัก — ถูกล็อกขา 2 เทิร์น" },
  { turn: 3, type: "event", msg: "💀 อาชาฝีมือ ถูกปราบ! เปิดเผยบทบาท: กบฏ" },
  { turn: 4, type: "card", msg: "🃏 ซุนวู่ ใช้การ์ด \"พายุหิมะ\" — แช่แข็งทุกคน" },
];

function Hearts({ hp, max }) {
  return <div className="pt-hearts">{Array.from({ length: max }).map((_, i) => <span key={i}>{i < hp ? "❤️" : "🖤"}</span>)}</div>;
}

function Proto() {
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [openCard, setOpenCard] = useState(-1);
  const [waiting, setWaiting] = useState(false);
  const [sheetIdx, setSheetIdx] = useState(-1);   // -1 = ปิด, มิฉะนั้น = index ผู้เล่นที่กำลังดู
  const active = 0;
  const me = PLAYERS[active];
  const sp = sheetIdx >= 0 ? PLAYERS[sheetIdx] : null;

  return (
    <div className="pt-root">
      <div className="pt-map pt-map-static" />
      <div className="pt-scrim" />

      {/* dev: สลับ state เพื่อถ่ายภาพ */}
      <div className="pt-dev">
        <button onClick={() => { setSheetIdx(-1); setOpenCard(-1); setLogCollapsed(true); setWaiting(false); }}>Battle</button>
        <button className={openCard === 0 ? "on" : ""} onClick={() => setOpenCard(openCard === 0 ? -1 : 0)}>Hover การ์ด</button>
        <button className={!logCollapsed ? "on" : ""} onClick={() => setLogCollapsed(v => !v)}>Log</button>
        <button className={sheetIdx === 0 ? "on" : ""} onClick={() => setSheetIdx(sheetIdx === 0 ? -1 : 0)}>Sheet: เรา</button>
        <button className={sheetIdx === 2 ? "on" : ""} onClick={() => setSheetIdx(sheetIdx === 2 ? -1 : 2)}>Sheet: คนอื่น</button>
        <button className={waiting ? "on" : ""} onClick={() => setWaiting(v => !v)}>รอเทิร์น</button>
      </div>

      {/* ── TOP-LEFT active crest ── */}
      <div className="pt-active">
        <div className="pt-portrait"><CharIcon ch={CHARACTERS[me.charId]} size={70} round /><div className="pt-ap">3</div></div>
        <div className="pt-active-meta">
          <div className="pt-name-plate">{me.name}</div>
          <Hearts hp={me.hp} max={me.maxHp} />
        </div>
      </div>

      {/* ── TOP-RIGHT shields (คลิกเพื่อดู status) ── */}
      <div className="pt-shields">
        {PLAYERS.map((p, i) => (
          <div key={p.id} className={`pt-shield ${i === active ? "active" : ""} ${!p.alive ? "dead" : ""}`}
            onClick={() => setSheetIdx(i)} title={`ดูสถานะ ${p.name}`}>
            <span className="sh-ico">{p.alive ? <CharIcon ch={CHARACTERS[p.charId]} size={26} round /> : "💀"}</span>
            <span className="sh-no">{i + 1}</span>
          </div>
        ))}
      </div>

      {/* ── RIGHT card hand — แนวนอน, hover ขยายในที่ (scale only) ไม่กระพริบ ── */}
      <div className="pt-hand">
        <div className="pt-hand-title">🂠 ไพ่ {CARDS.length}/10</div>
        {CARDS.map((c, i) => (
          <div key={i} className={`pt-card rar-${c.rar} ${openCard === i ? "is-open" : ""}`}
            onMouseEnter={() => setOpenCard(i)} onMouseLeave={() => setOpenCard(p => p === i ? -1 : p)}>
            <span className="cd-ico">{c.ico}</span>
            <div className="cd-body">
              <div className="cd-nm">{c.nm}</div>
              <div className="cd-tag">{c.tag}</div>
              <div className="cd-desc">{c.desc}</div>
            </div>
            <span className="cd-rar">{c.rar}</span>
          </div>
        ))}
      </div>

      {/* ── BOTTOM-CENTER event log ── */}
      <div className={`pt-log ${logCollapsed ? "collapsed" : ""}`}>
        <div className="pt-log-hd" onClick={() => setLogCollapsed(v => !v)}>
          <span className="lh-title">📜 บันทึกเหตุการณ์</span>
          <span className="lh-toggle">{logCollapsed ? "▲ ขยาย" : "▼ ย่อ"}</span>
        </div>
        <div className="pt-log-body">
          {(logCollapsed ? LOG.slice(-1) : LOG).map((e, i) => (
            <div key={i} className={`pt-log-row ${e.type}`}><span className="lr-turn">T{e.turn}</span><span>{e.msg}</span></div>
          ))}
        </div>
      </div>

      {/* ── BOTTOM-CENTER stat bar ── */}
      <div className="pt-statbar">
        <div className="pt-sb-portrait" onClick={() => setSheetIdx(active)} title="ดูสถานะเต็ม">
          <div className="pt-sb-mini"><CharIcon ch={CHARACTERS[me.charId]} size={40} round /></div>
          <div className="pt-sb-id">{me.name}<small>{me.role}</small></div>
        </div>
        <div className="pt-sb-stats">
          <div className="pt-coin hp"><span className="c-ico">❤️</span><span className="c-val">{me.hp}/{me.maxHp}</span><span className="c-lab">HP</span></div>
          <div className="pt-coin mp"><span className="c-ico">💧</span><span className="c-val">{me.mana}/{me.maxMana}</span><span className="c-lab">มานา</span></div>
          <div className="pt-sb-sep" />
          <div className="pt-coin"><span className="c-ico">⚔️</span><span className="c-val">{me.atk}</span><span className="c-lab">โจมตี</span></div>
          <div className="pt-coin"><span className="c-ico">🛡️</span><span className="c-val">{me.def}</span><span className="c-lab">ป้องกัน</span></div>
          <div className="pt-coin"><span className="c-ico">👟</span><span className="c-val">{me.move}</span><span className="c-lab">ความเร็ว</span></div>
          <div className="pt-coin"><span className="c-ico">🎯</span><span className="c-val">{me.range}</span><span className="c-lab">ระยะ</span></div>
          <div className="pt-sb-sep" />
          <div className="pt-coin gold"><span className="c-ico">💰</span><span className="c-val">{me.gold}</span><span className="c-lab">ทอง</span></div>
        </div>
        <div className="pt-sb-fx">
          {me.buffs.map((b, i) => <span key={i} className="pt-fx buff" title={b.t}>{b.ico}</span>)}
          {me.debuffs.map((b, i) => <span key={i} className="pt-fx debuff" title={b.t}>{b.ico}</span>)}
        </div>
      </div>

      {/* ── BOTTOM-RIGHT end turn (ornate gold/dark) ── */}
      <button className={`pt-endturn ${waiting ? "waiting" : ""}`} onClick={() => setWaiting(v => !v)}>
        <span className="et-crest">{waiting ? "⏳" : "⚜️"}</span>
        <span className="et-label">{waiting ? "รอผู้เล่น" : "จบเทิร์น"}</span>
        <span className="et-sub">{waiting ? "เทิร์นของคนอื่น" : "END TURN"}</span>
      </button>

      {/* ── STATUS SHEET — ตรวจได้ทุกคน, สลับด้วยแท็บด้านบน, ไม่เปลี่ยนหน้า ── */}
      {sp && (
        <div className="pt-sheet-bd" onClick={() => setSheetIdx(-1)}>
          <div className="pt-sheet" onClick={e => e.stopPropagation()}>
            <div className="pt-sheet-x" onClick={() => setSheetIdx(-1)}>✕</div>
            {/* แท็บผู้เล่น — คลิกสลับดูคนอื่นได้ทันที */}
            <div className="pt-sheet-tabs">
              <span className="tabs-label">ดูสถานะ:</span>
              {PLAYERS.map((p, i) => (
                <div key={p.id} className={`pt-tab ${i === sheetIdx ? "active" : ""} ${!p.alive ? "dead" : ""}`}
                  onClick={() => setSheetIdx(i)} title={p.name}>
                  {p.alive ? <CharIcon ch={CHARACTERS[p.charId]} size={36} round /> : "💀"}
                </div>
              ))}
            </div>
            <div className="pt-sheet-grid">
              {/* ซ้าย: รูปตัวละคร + ชื่อ + โรล + HP + ลำดับเทิร์น */}
              <div className="pt-sheet-left">
                <div className="pt-sheet-port"><CharIcon ch={CHARACTERS[sp.charId]} size={168} round={false} /></div>
                <h2>{sp.name}</h2>
                <span className={`pt-role tag ${ROLE_TAG[sp.roleTag]}`}>{sp.role}</span>
                <Hearts hp={sp.hp} max={sp.maxHp} />
                <div className="pt-turnorder">🎲 ลำดับเทิร์น {sp.turn}/4 {sp.id === active ? "· ตานี้" : ""}{!sp.alive ? "· พ่ายแพ้" : ""}</div>
              </div>
              {/* ขวา: ค่าพลัง + สกิล + ทรัพยากร + buff/debuff + อุปกรณ์ */}
              <div className="pt-sheet-right">
                <div className="pt-sheet-stats">
                  <div className="ss-stat"><span className="ss-ico">❤️</span><div><div className="ss-v">{sp.hp}/{sp.maxHp}</div><div className="ss-l">HP</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">💧</span><div><div className="ss-v">{sp.mana}/{sp.maxMana}</div><div className="ss-l">มานา</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">⚔️</span><div><div className="ss-v">{sp.atk}</div><div className="ss-l">โจมตี</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">🛡️</span><div><div className="ss-v">{sp.def}</div><div className="ss-l">ป้องกัน</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">👟</span><div><div className="ss-v">{sp.move}</div><div className="ss-l">ความเร็ว</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">🎯</span><div><div className="ss-v">{sp.range}</div><div className="ss-l">ระยะ</div></div></div>
                  <div className="ss-stat"><span className="ss-ico">💰</span><div><div className="ss-v">{sp.gold}</div><div className="ss-l">ทอง</div></div></div>
                </div>
                <div className="pt-sheet-skill">
                  <span className="sk-ico">{sp.passive.ico}</span>
                  <div><div className="sk-nm">{sp.passive.name} <small>(Passive)</small></div><div className="sk-d">{sp.passive.desc}</div></div>
                </div>
                <div className="pt-sheet-fx">
                  <div className="fx-col"><div className="fx-h buff">🟢 บัฟ</div>{sp.buffs.length ? sp.buffs.map((b, i) => <span key={i} className="pt-fx buff">{b.ico} {b.t}</span>) : <span className="fx-none">—</span>}</div>
                  <div className="fx-col"><div className="fx-h debuff">🔴 ดีบัฟ</div>{sp.debuffs.length ? sp.debuffs.map((b, i) => <span key={i} className="pt-fx debuff">{b.ico} {b.t}</span>) : <span className="fx-none">—</span>}</div>
                  <div className="fx-col"><div className="fx-h active">✨ เอฟเฟกต์</div>{sp.active.length ? sp.active.map((b, i) => <span key={i} className="pt-fx act">{b.ico} {b.t}</span>) : <span className="fx-none">—</span>}</div>
                </div>
                <div className="pt-sheet-equip">
                  {sp.equip.map((e, i) => <div key={i} className="pt-eq"><div className="eq-frame">{e.ico}</div><div className="eq-nm">{e.nm}</div></div>)}
                  {Array.from({ length: Math.max(0, 3 - sp.equip.length) }).map((_, i) => <div key={`e${i}`} className="pt-eq"><div className="eq-frame empty">＋</div><div className="eq-nm">ว่าง</div></div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Proto /></StrictMode>);
