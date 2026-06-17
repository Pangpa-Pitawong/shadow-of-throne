// src/game/components/BottomBar.jsx
import HandCard from "./HandCard.jsx";
import { CHARACTERS } from "../constants/characters.js";

export default function BottomBar({
  me, isMyTurn, currentPlayer, phase, maxPhases = 8,
  actionsDone, actionMode, selectedCard,
  onMove, onAttack, onUseCard, onEndTurn,
  onSelectCard, setTooltip, onDeckClick, deckReady = false,
  onUseSkill, onUseKingSkill,
}) {
  const moveLeft = actionsDone?.moveLeft ?? 0;
  const moveDone = moveLeft <= 0;
  const handLimit = Math.min(10, Math.max(1, me?.hp || 1));
  const handCount = me?.hand?.length || 0;
  const pendingDiscard = me?.pendingDiscard || 0;
  const MAX_CARDS = 4;
  const cardsPlayed = actionsDone.cardsPlayed || 0;
  const cardsMaxed = cardsPlayed >= MAX_CARDS;
  const charDef = CHARACTERS[me?.charId] || CHARACTERS[me?.classId];
  const activeCost = charDef?.active?.cost || 0;
  const canUseSkill = isMyTurn && me && me.mana >= activeCost;
  const isKing = me?.role === "king";
  // fate_read = ใช้ได้ครั้งเดียวตลอดเกม · สกิลราชาอื่น = ครั้งเดียวต่อเฟส
  const isFateRead = charDef?.kingSkill?.id === "fate_read";
  const kingSkillUsed = isFateRead ? !!me?._fateReadUsed : (me?._kingSkillUsedPhase === phase);
  return (
    <div className="bottom-bar">
      <div className="action-row">
        <button className={`act-btn ${moveDone ? "done" : actionMode === "move" ? "active-mode" : ""}`}
          disabled={!isMyTurn || moveDone} onClick={onMove}>
          <span className="act-ico">🚶</span>
          <span>เดิน</span>
          <span className="act-label">{moveDone ? "✓ หมดงบเดิน" : `งบเดิน ${moveLeft}`}</span>
        </button>
        <button className={`act-btn ${actionsDone.attacked ? "done" : actionMode === "attack" ? "active-mode" : ""}`}
          disabled={!isMyTurn || actionsDone.attacked} onClick={onAttack}>
          <span className="act-ico">⚔️</span>
          <span>โจมตี</span>
          <span className="act-label">{actionsDone.attacked ? "✓" : `ATK ${me?.atk || 0} · ระยะ ${me?.range ?? 0}`}</span>
        </button>
        <button className={`act-btn ${cardsMaxed ? "done" : actionMode === "card" || actionMode === "trap" ? "active-mode" : ""}`}
          disabled={!isMyTurn || cardsMaxed || !selectedCard} onClick={onUseCard}>
          <span className="act-ico">🃏</span>
          <span>ใช้การ์ด</span>
          <span className="act-label">{cardsMaxed ? `✓ ครบ ${MAX_CARDS}` : selectedCard ? `"${selectedCard.name}" (${cardsPlayed}/${MAX_CARDS})` : `เลือกก่อน (${cardsPlayed}/${MAX_CARDS})`}</span>
        </button>
        {/* Active Skill */}
        {charDef?.active && (
          <button
            className={`act-btn ${actionMode === "skill" ? "active-mode" : ""}`}
            disabled={!canUseSkill}
            onClick={() => onUseSkill?.(charDef.active)}
            title={`${charDef.active.desc}${actionMode === "skill" ? " — คลิกอีกครั้งเพื่อยกเลิก" : ""}`}
            style={{ borderColor: actionMode === "skill" ? "#a060e0" : canUseSkill ? "#c9a84c" : undefined }}>
            <span className="act-ico">{charDef.ico}</span>
            <span>{charDef.active.name}</span>
            <span className="act-label">
              {actionMode === "skill" ? "🎯 เลือกเป้า" : `💧${activeCost} / ${me?.mana ?? 0}`}
            </span>
          </button>
        )}
        {/* King Skill */}
        {isKing && charDef?.kingSkill && (
          <button
            className={`act-btn ${actionMode === "king_skill" ? "active-mode" : ""}`}
            disabled={!isMyTurn || kingSkillUsed}
            onClick={() => onUseKingSkill?.(charDef.kingSkill)}
            title={`${charDef.kingSkill.desc}${actionMode === "king_skill" ? " — คลิกอีกครั้งเพื่อยกเลิก" : ""}`}
            style={{ borderColor: actionMode === "king_skill" ? "#a060e0" : kingSkillUsed ? "rgba(201,168,76,.2)" : "#c9a84c", opacity: kingSkillUsed ? 0.5 : 1 }}>
            <span className="act-ico">👑</span>
            <span>{charDef.kingSkill.name}</span>
            <span className="act-label">
              {actionMode === "king_skill" ? "🎯 เลือกเป้า" : kingSkillUsed ? "✓ ใช้แล้ว" : "สกิลราชา"}
            </span>
          </button>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",padding:"0 12px",borderLeft:"1px solid rgba(201,168,76,.1)" }}>
          <span style={{ fontSize:"9px",color:"var(--txt-m)" }}>เฟส</span>
          <span style={{ fontFamily:"'Cinzel',serif",color:"var(--gold)",fontSize:"16px" }}>{phase}/{maxPhases}</span>
        </div>
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",padding:"0 12px",borderLeft:"1px solid rgba(201,168,76,.1)" }}>
          <span style={{ fontSize:"9px",color:"var(--txt-m)" }}>ไพ่ในมือ</span>
          <span style={{ color: pendingDiscard > 0 ? "#e05050" : handCount >= handLimit ? "#e08040" : "var(--gold-l)", fontSize:"16px" }}>
            🃏 {handCount}/{handLimit}{pendingDiscard > 0 ? ` · ทิ้ง ${pendingDiscard}` : ""}
          </span>
        </div>
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",padding:"0 12px",borderLeft:"1px solid rgba(201,168,76,.1)" }}>
          <span style={{ fontSize:"9px",color:"var(--txt-m)" }}>ทอง</span>
          <span style={{ color:"var(--gold-l)",fontSize:"16px" }}>💰 {me?.gold || 0}</span>
        </div>
        {isMyTurn
          ? <button className="tb-btn primary" style={{ margin:"4px 8px",alignSelf:"center" }} onClick={onEndTurn}>⏭ จบเทิร์น</button>
          : <div style={{ padding:"0 12px",fontSize:"11px",color:"var(--txt-m)" }}>รอ {currentPlayer?.name}...</div>
        }
      </div>
      {/* Hand cards */}
      <div className="hand-area">
        {/* กองจั่ว — คลิกเพื่อเปิดไพ่ที่จั่วได้เทิร์นนี้ */}
        <div
          className={`draw-deck${deckReady ? " ready" : ""}`}
          onClick={() => deckReady && onDeckClick?.()}
          title={deckReady ? "เปิดไพ่ที่จั่วได้เทิร์นนี้" : "กองจั่ว"}
          style={{
            position: "relative", flexShrink: 0, width: "52px", height: "74px",
            marginRight: "10px", borderRadius: "8px",
            background: "linear-gradient(135deg,#241c10,#3a2c14)",
            border: `1px solid ${deckReady ? "var(--gold)" : "rgba(201,168,76,.3)"}`,
            boxShadow: deckReady ? "0 0 12px rgba(201,168,76,.5)" : "2px 2px 0 rgba(0,0,0,.4)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            cursor: deckReady ? "pointer" : "default",
            animation: deckReady ? "deckPulse 1.2s ease-in-out infinite" : "none",
          }}
        >
          <span style={{ fontSize: "22px" }}>🂠</span>
          <span style={{ fontSize: "8px", color: "var(--gold-l)", marginTop: "2px", fontFamily: "'Cinzel',serif" }}>กองจั่ว</span>
          {deckReady && (
            <span style={{
              position: "absolute", top: "-6px", right: "-6px",
              background: "var(--gold)", color: "#0d0b09", fontSize: "9px", fontWeight: 700,
              borderRadius: "10px", padding: "1px 5px",
            }}>เปิด</span>
          )}
        </div>
        {me?.hand?.map((card, ci) => (
          <HandCard
            key={card.uid || ci}
            card={card}
            isSelected={selectedCard?.uid === card.uid}
            isMyTurn={isMyTurn}
            onSelect={onSelectCard}
            onHover={e => setTooltip({ x: e.clientX + 10, y: e.clientY - 80, title: card.name, desc: card.desc || "" })}
            onLeave={() => setTooltip(null)}
          />
        ))}
        {(!me?.hand || me.hand.length === 0) && (
          <div style={{ color:"var(--txt-d)",fontSize:"11px",padding:"0 12px" }}>ไม่มีการ์ดในมือ</div>
        )}
      </div>
    </div>
  );
}