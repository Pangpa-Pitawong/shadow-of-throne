// src/game/components/PlayerCard.jsx
import { CHARACTERS } from "../constants/characters.js";
import { ROLES }      from "../constants/roles.js";
import CharIcon       from "./CharIcon.jsx";

// แผง "ใบสถานะ" สไตล์ Armello — รูปตัวละคร + ค่าพลังเป็นเหรียญไอคอน + ช่องอุปกรณ์กรอบทอง
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
      {isCurrentTurn && <div className="turn-ribbon">▶ ตาเดิน</div>}
      <div className="p-head">
        <div className="p-ico" style={{ background: cls?.color + "33", border: `1px solid ${cls?.color}60`, overflow: "hidden", padding: 0 }}>
          {player.alive ? <CharIcon ch={cls} size={28} /> : "💀"}
        </div>
        <div style={{ minWidth: 0 }}>
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
      {/* Stat badges — เหรียญพลัง สไตล์ Armello */}
      <div className="p-statbar">
        <div className="stat-coin" title="พลังโจมตี"><span className="sc-ico">⚔️</span><span className="sc-val">{player.atk}</span></div>
        <div className="stat-coin" title="พลังป้องกัน"><span className="sc-ico">🛡️</span><span className="sc-val">{player.def}</span></div>
        <div className="stat-coin" title={player._spdCharge ? `ความเร็ว (ชาร์จ +${player._spdCharge})` : "ความเร็ว / ระยะเดิน"}>
          <span className="sc-ico">👟</span><span className="sc-val">{player.move}{player._spdCharge ? "⚡" : ""}</span>
        </div>
        <div className="stat-coin" title="ระยะโจมตี"><span className="sc-ico">🎯</span><span className="sc-val">{player.range ?? 0}</span></div>
        <div className="stat-coin gold" title="ทอง"><span className="sc-ico">💰</span><span className="sc-val">{player.gold ?? 0}</span></div>
      </div>
      {/* Equipment slots — กรอบทอง */}
      <div className="equip-row">
        {(player.equipment || []).map((e, ei) => (
          <span key={ei} className="equip-slot filled"
            title={`${e.name}${e.atk ? ` ATK+${e.atk}` : ""}${e.def ? ` DEF+${e.def}` : ""}${e.range ? ` ระยะ${e.range}` : ""}`}>
            {e.ico}
          </span>
        ))}
        {/* ช่องว่างให้เห็นว่ายังใส่อุปกรณ์ได้ (เติมจนครบ 3 ช่อง) */}
        {Array.from({ length: Math.max(0, 3 - (player.equipment?.length || 0)) }).map((_, i) => (
          <span key={`e${i}`} className="equip-slot empty" title="ช่องอุปกรณ์ว่าง">＋</span>
        ))}
      </div>
      {/* Passive skill name */}
      {cls?.passive && (
        <div className="p-passive" title={cls.passive.desc}>🟢 {cls.passive.name}</div>
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
