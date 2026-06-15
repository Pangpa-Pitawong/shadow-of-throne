// src/game/components/LeftPanel.jsx
import PlayerCard from "./PlayerCard.jsx";
import { ROLES } from "../constants/roles.js";

export default function LeftPanel({ players, currentTurn, myIdx, me, setTooltip }) {
  const q = me?.quest;
  return (
    <div className="left-panel">
      <div className="sec">
        <div className="sec-hdr">👥 ผู้เล่น</div>
        {players.map((p, i) => (
          <PlayerCard
            key={i}
            player={p}
            isCurrentTurn={currentTurn === i}
            isMe={i === myIdx}
            onHover={e => setTooltip({ x: e.clientX + 10, y: e.clientY + 10,
              title: p.name, desc: ROLES[p.role]
                ? `${ROLES[p.role].name} — ${ROLES[p.role].win}`
                : "บทบาทลับ — ยังไม่เปิดเผย (เปิดเมื่อแพ้)" })}
            onLeave={() => setTooltip(null)}
          />
        ))}
      </div>

      <div className="sec">
        <div className="sec-hdr">🎯 เป้าหมายฝ่าย</div>
        <div className="info-box">
          {me && ROLES[me.role] && (
            <div className="objectives">
              <div className="obj-row obj-active">
                <span>{ROLES[me.role]?.ico}</span>
                <span>{ROLES[me.role]?.win}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* เควสรอง (ลับเฉพาะตัว) */}
      <div className="sec">
        <div className="sec-hdr">📜 เควสรอง (ลับ)</div>
        <div className="info-box">
          {q ? (
            <div style={{ fontSize: "11px", lineHeight: 1.6 }}>
              <div style={{ color: q.done ? "#4cc94c" : "var(--gold)", fontWeight: 600 }}>
                {q.ico} {q.name} {q.done ? "✓ สำเร็จ" : ""}
              </div>
              <div style={{ color: "var(--txt-m)", fontSize: "10px", margin: "3px 0" }}>{q.desc}</div>
              {!q.done && q.visitCount > 1 && (
                <div style={{ color: "var(--txt-d)", fontSize: "10px" }}>
                  คืบหน้า: {q.progress || 0}/{q.visitCount}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "10px", color: "var(--txt-d)" }}>เลือกเควสรองของคุณก่อน</div>
          )}
        </div>
      </div>
    </div>
  );
}
