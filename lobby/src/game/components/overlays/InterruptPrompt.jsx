// src/game/components/overlays/InterruptPrompt.jsx
// ระบบตอบโต้การโจมตี (reactive) — หลบ/บล็อก/รับการโจมตี
export default function InterruptPrompt({ interrupt, myIdx, myHand = [], onRespond }) {
  if (!interrupt) return null;
  const entry = (interrupt.entries || []).find((e) => e.id === myIdx && !e.resolved);
  if (!entry) {
    // ไม่ใช่เป้าหมายที่ต้องตอบโต้ — แสดงสถานะรออยู่เฉยๆ
    return (
      <div className="intr-wait">
        ⏳ {interrupt.casterName} ใช้ "{interrupt.card?.name}" — รอผู้เล่นเป้าหมายตอบโต้...
      </div>
    );
  }
  const dodgeCard = myHand.find((c) => c.id === "wind_dodge");
  const blockCard = myHand.find((c) => c.id === "mana_bolt");
  const card = interrupt.card || {};
  return (
    <div className="intr-backdrop">
      <div className="intr-modal">
        <div className="intr-title">⚔️ ถูกโจมตี!</div>
        <div className="intr-sub">
          <span className="intr-cardico">{card.ico}</span>
          <b>{card.name}</b> จาก {interrupt.casterName}
        </div>
        <div className="intr-effect">
          ⚠ ผลที่จะเกิดกับคุณ: <b>{card.effectText || (card.dmg ? `${card.dmg} ดาเมจ` : "—")}</b>
        </div>
        <div className="intr-actions">
          {entry.canDodge && dodgeCard && (
            <button className="intr-btn dodge" onClick={() => onRespond(dodgeCard.uid)}>
              🌬️ หลบ (ลมเวทย์หลบภัย)
            </button>
          )}
          {entry.canBlock && blockCard && (
            <button className="intr-btn block" onClick={() => onRespond(blockCard.uid)}>
              ✦ บล็อก (พลังเวทย์พื้นฐาน)
            </button>
          )}
          <button className="intr-btn take" onClick={() => onRespond(null)}>
            💢 รับการโจมตี
          </button>
        </div>
      </div>
    </div>
  );
}
