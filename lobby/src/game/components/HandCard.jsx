// src/game/components/HandCard.jsx
import { RARITY, normRarity } from "../constants/cards.js";

const TYPE_LABEL = {
  weapon: "🗡️ อาวุธ/เกราะ",
  magic:  "🔮 เวทย์",
  trap:   "🪤 กับดัก",
};

const ELEMENT_ICO = {
  fire: "🔥", ice: "❄️", lightning: "⚡", water: "🌊", dark: "🌑", magic: "✦", physical: "",
};

// ป้ายเงื่อนไขการใช้/บัฟ (เงื่อนไขบรรยากาศ)
function condLabel(cond) {
  if (!cond) return null;
  const parts = [];
  if (cond.time === "day") parts.push("☀️กลางวัน");
  if (cond.time === "night") parts.push("🌙กลางคืน");
  if (cond.near === "water") parts.push("🌊ใกล้น้ำ");
  if (cond.terrain) parts.push("🌲ป่า/ที่มืด");
  if (cond.requireArmor) parts.push("🛡️ต้องมีเกราะ");
  if (cond.hpBelowPct) parts.push(`❤️HP<${cond.hpBelowPct}%`);
  return parts.length ? parts.join(" ") : null;
}

export default function HandCard({ card, isSelected, isMyTurn, onSelect, onHover, onLeave }) {
  const rarity = normRarity(card.rarity);
  const meta = RARITY[rarity];
  const cond = condLabel(card.cond);
  const elIco = card.element ? ELEMENT_ICO[card.element] : (card.atkElement ? ELEMENT_ICO[card.atkElement] : "");

  return (
    <div
      className={`hand-card ${isSelected ? "selected" : ""}`}
      onClick={() => isMyTurn && onSelect(isSelected ? null : card)}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span className={`card-rarity rarity-${rarity}`} style={{ color: meta?.color }}>
        {meta?.glyph || "·"}
      </span>
      <span className="card-ico">{card.ico}{elIco}</span>
      <div className="card-nm">{card.name}</div>
      <div className="card-desc">{card.desc}</div>
      <div style={{ fontSize: "8px", marginTop: "3px", color: "var(--txt-d)" }}>
        {TYPE_LABEL[card.type] || "การ์ด"}
        {card.type === "magic" && card.cost != null ? ` · 💧${card.cost}` : ""}
        {card.kind === "dodge" ? " · 🌬️ตอบโต้" : ""}
        {card.cooldown ? ` · ⏳พัก${card.cooldown}` : ""}
      </div>
      {cond && (
        <div style={{ fontSize: "7px", marginTop: "2px", color: "#e0b060" }}>{cond}</div>
      )}
    </div>
  );
}
