// src/game/components/HandCard.jsx
import { RARITY, normRarity } from "../constants/cards.js";

const TYPE_LABEL = {
  weapon: "🗡️ อาวุธ",
  magic:  "🔮 เวทย์",
  trap:   "🪤 กับดัก",
};

export default function HandCard({ card, isSelected, isMyTurn, onSelect, onHover, onLeave }) {
  const rarity = normRarity(card.rarity);
  const meta = RARITY[rarity];

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
      <span className="card-ico">{card.ico}</span>
      <div className="card-nm">{card.name}</div>
      <div className="card-desc">{card.desc}</div>
      <div style={{ fontSize: "8px", marginTop: "3px", color: "var(--txt-d)" }}>
        {TYPE_LABEL[card.type] || "การ์ด"}
        {card.type === "magic" && card.cost != null ? ` · 💧${card.cost}` : ""}
      </div>
    </div>
  );
}
