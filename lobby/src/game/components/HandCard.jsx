// src/game/components/HandCard.jsx
// การ์ดในมือ — ขนาดคงที่ทุกใบ · ข้อมูลทั้งหมดอยู่ในการ์ด · ไม่พึ่ง tooltip
// คำอธิบายยาวเกิน → ปุ่ม "รายละเอียด" เปิด modal (onDetail)
import { RARITY, normRarity } from "../constants/cards.js";

// ป้ายประเภทการ์ด (badge) — โทนเข้ม/ทอง ตามธีม dark fantasy
const TYPE_BADGE = {
  weapon:   { label: "ยุทธภัณฑ์", cls: "bdg-weapon" },
  magic:    { label: "กลศึก",     cls: "bdg-magic" },
  trap:     { label: "อุบาย",     cls: "bdg-trap" },
  betrayer: { label: "ตราทรยศ",   cls: "bdg-betrayer" },
};

const ELEMENT_ICO = {
  fire: "🔥", ice: "❄️", lightning: "⚡", water: "🌊", dark: "🌑", magic: "✦", physical: "",
};

// ป้ายเงื่อนไขการใช้ (usage requirement)
function condLabel(cond) {
  if (!cond) return null;
  const parts = [];
  if (cond.time === "day") parts.push("☀️ กลางวัน");
  if (cond.time === "night") parts.push("🌙 กลางคืน");
  if (cond.near === "water") parts.push("🌊 ใกล้น้ำ");
  if (cond.terrain) parts.push("🌲 ป่า/ที่มืด");
  if (cond.requireArmor) parts.push("🛡️ ต้องมีเกราะ");
  if (cond.hpBelowPct) parts.push(`❤️ HP<${cond.hpBelowPct}%`);
  return parts.length ? parts.join(" · ") : null;
}

// ความยาวคำอธิบายที่เกินกว่านี้ → ตัดสั้น + ปุ่มรายละเอียด
const DESC_PREVIEW_LIMIT = 52;

export default function HandCard({ card, isSelected, isMyTurn, onSelect, onDetail }) {
  const rarity = normRarity(card.rarity);
  const meta = RARITY[rarity];
  const badge = TYPE_BADGE[card.type] || { label: "การ์ด", cls: "bdg-weapon" };
  const cond = condLabel(card.cond);
  const elIco = card.element ? ELEMENT_ICO[card.element] : (card.atkElement ? ELEMENT_ICO[card.atkElement] : "");
  const desc = card.desc || "";
  const tooLong = desc.length > DESC_PREVIEW_LIMIT;
  const preview = tooLong ? desc.slice(0, DESC_PREVIEW_LIMIT).trimEnd() + "…" : desc;

  // แถบสถิติย่อ (อาวุธ/เกราะ) + ต้นทุน/คูลดาวน์
  const statBits = [];
  if (card.type === "weapon") {
    if (card.atk > 0) statBits.push(`⚔️+${card.atk}`);
    if (card.def > 0) statBits.push(`🛡️+${card.def}`);
    if (card.range > 0) statBits.push(`🎯${card.range}`);
    if (card.magicAtk > 0) statBits.push(`✨+${card.magicAtk}`);
  }
  if (card.type === "magic" && card.cost != null) statBits.push(`💧${card.cost}`);
  if (card.kind === "dodge") statBits.push("🌬️ ตอบโต้");
  if (card.cooldown) statBits.push(`⏳พัก${card.cooldown}`);

  return (
    <div
      className={`hand-card ${isSelected ? "selected" : ""} type-${card.type}`}
      onClick={() => isMyTurn && onSelect(isSelected ? null : card)}
    >
      <div className="card-top">
        <span className={`card-badge ${badge.cls}`}>{badge.label}</span>
        <span className={`card-rarity rarity-${rarity}`} style={{ color: meta?.color }}>{meta?.glyph || "·"}</span>
      </div>
      <div className="card-head">
        <span className="card-ico">{card.ico}{elIco}</span>
        <div className="card-nm">{card.name}</div>
      </div>
      <div className="card-desc">{preview}</div>
      {statBits.length > 0 && <div className="card-stats">{statBits.join("  ")}</div>}
      {cond && <div className="card-cond">{cond}</div>}
      <div className="card-foot">
        {card.type === "betrayer"
          ? <span className="card-auto">⚠️ ทำงานอัตโนมัติสิ้นเฟส</span>
          : <span />}
        {tooLong && (
          <button
            className="card-more"
            onClick={(e) => { e.stopPropagation(); onDetail?.(card); }}
          >รายละเอียด</button>
        )}
      </div>
    </div>
  );
}
