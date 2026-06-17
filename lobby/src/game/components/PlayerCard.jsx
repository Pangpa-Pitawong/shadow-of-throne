// src/game/components/PlayerCard.jsx
import { CHARACTERS } from "../constants/characters.js";
import { ROLES }      from "../constants/roles.js";
import CharIcon       from "./CharIcon.jsx";

export default function PlayerCard({ player, isCurrentTurn, isMe, onHover, onLeave }) {
  const cls  = CHARACTERS[player.charId] || CHARACTERS[player.classId];
  const role = ROLES[player.role];
  // บทบาทลับ: ถ้า server ซ่อนไว้ (role === "hidden") จะไม่มีใน ROLES → แสดง "ปริศนา"
  const roleLabel = role ? `${role.ico} ${role.name}` : "❓ ปริศนา";
  return (
    <div
      className={`pcard ${isCurrentTurn ? "active" : ""} ${!player.alive ? "dead" : ""} ${isMe ? "me" : ""}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {isCurrentTurn && <div className="turn-indicator" />}
      <div className="p-head">
        <div className="p-ico" style={{ background: cls?.color + "33", border: `1px solid ${cls?.color}60`, overflow: "hidden", padding: 0 }}>
          {player.alive ? <CharIcon ch={cls} size={28} /> : "💀"}
        </div>
        <div>
          <div className="p-name">{player.name}{isMe ? " (คุณ)" : ""}</div>
          <span className={`p-role tag tag-${role ? player.role : "hidden"}`}>{roleLabel}</span>
        </div>
      </div>
      {/* HP/MP bars */}
      <div className="p-bars">
        <div className="bar-row">
          <span>❤</span>
          <div className="bar-track">
            <div className="bar-fill bar-hp" style={{ width: `${(player.hp / player.maxHp) * 100}%` }} />
          </div>
          <span>{player.hp}/{player.maxHp}</span>
        </div>
        <div className="bar-row">
          <span>💧</span>
          <div className="bar-track">
            <div className="bar-fill bar-mp" style={{ width: `${(player.mana / player.maxMana) * 100}%` }} />
          </div>
          <span>{player.mana}/{player.maxMana}</span>
        </div>
      </div>
      {/* Stats grid */}
      <div className="p-stats">
        <div className="p-stat"><span>ATK</span><span>{player.atk}</span></div>
        <div className="p-stat"><span>DEF</span><span>{player.def}</span></div>
        <div className="p-stat" title={player._spdCharge ? `ชาร์จความเร็ว +${player._spdCharge}` : "ความเร็ว (เพิ่มระยะโจมตี 2:1)"}>
          <span>SPD</span><span>{player.move}{player._spdCharge ? " ⚡" : ""}</span>
        </div>
        <div className="p-stat" title="ระยะโจมตี"><span>🎯</span><span>{player.range ?? 0}</span></div>
      </div>
      {/* Equipment */}
      {player.equipment?.length > 0 && (
        <div className="status-row" style={{ gap: "3px" }}>
          {player.equipment.map((e, ei) => (
            <span key={ei} className="status-tag" style={{ background: "rgba(201,168,76,.15)", border: "1px solid rgba(201,168,76,.3)" }}
              title={`${e.name}${e.atk ? ` ATK+${e.atk}` : ""}${e.def ? ` DEF+${e.def}` : ""}${e.range ? ` ระยะ${e.range}` : ""}`}>
              {e.ico}
            </span>
          ))}
        </div>
      )}
      {/* Passive skill name */}
      {cls?.passive && (
        <div style={{ fontSize: "9px", color: "var(--txt-d)", margin: "2px 0 0", opacity: 0.8 }}
          title={cls.passive.desc}>
          🟢 {cls.passive.name}
        </div>
      )}
      {/* Status effects */}
      {player.statusEffects?.length > 0 && (
        <div className="status-row">
          {player.statusEffects.map((s, si) => (
            <span key={si} className={`status-tag status-${s.type}`}>{s.type} {s.duration}t</span>
          ))}
        </div>
      )}
    </div>
  );
}