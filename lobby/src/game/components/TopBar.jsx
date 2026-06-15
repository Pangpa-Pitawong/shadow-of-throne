// src/game/components/TopBar.jsx
export default function TopBar({ phase, phaseStep, maxPhases = 8, fogActive, bossMode, bossLevel,
  currentPlayer, isMyTurn, onEndTurn, onCenter, onToggleRules, onToggleStatus, onToggleQuest, hasQuest, onLeave }) {
  const phases = Array.from({ length: maxPhases }, (_, i) => i + 1);
  return (
    <div className="top-bar">
      <span className="tb-title">♛ บัลลังก์เงา</span>
      <div className="tb-divider" />
      {/* Phase track */}
      {!bossMode ? (
        <div className="phase-track">
          {phases.map(n => (
            <span key={n}>
              <div className={`phase-dot ${phase > n ? "done" : phase === n ? "current" : ""}`}>{n}</div>
              {n < maxPhases && <div className={`phase-line ${phase > n ? "done" : ""}`} />}
            </span>
          ))}
        </div>
      ) : (
        <span className="tb-turn" style={{ color: "#e04040" }}>👹 โหมดบอส Lv.{bossLevel}</span>
      )}
      <div className="tb-divider" />
      <span className="tb-turn">เทิร์น {phaseStep + 1}</span>
      {fogActive && <span className="tb-turn" style={{ color: "#8fb8d8" }}>🌫️ ม่านหมอก</span>}
      <div className="tb-current">{currentPlayer?.ico} {currentPlayer?.name} {isMyTurn ? "(คุณ)" : ""}</div>
      <div className="tb-spacer" />
      <button className="tb-btn" onClick={onCenter}>⊕ กลาง</button>
      {onToggleStatus && <button className="tb-btn" onClick={onToggleStatus}>📊 สถานะ</button>}
      {onToggleQuest && <button className="tb-btn" onClick={onToggleQuest}>📜 เควส{hasQuest ? "" : " •"}</button>}
      <button className="tb-btn" onClick={onToggleRules}>📖 กฎ</button>
      {isMyTurn && <button className="tb-btn primary" onClick={onEndTurn}>⏭ จบเทิร์น</button>}
      {onLeave && <button className="tb-btn danger" onClick={onLeave}>✕ ออก</button>}
    </div>
  );
}
