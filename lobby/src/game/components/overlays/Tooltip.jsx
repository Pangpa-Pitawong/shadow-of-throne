// src/game/components/overlays/Tooltip.jsx
export default function Tooltip({ tooltip }) {
  if (!tooltip) return null;
  return (
    <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <div className="tooltip-title">{tooltip.title}</div>
      {tooltip.desc && <div className="tooltip-desc">{tooltip.desc}</div>}
      {tooltip.move && (
        <div className="tooltip-move" style={{
          marginTop: 5, paddingTop: 5, borderTop: "1px solid rgba(201,168,76,.2)",
          fontSize: 11, fontWeight: 700, color: tooltip.move.color,
        }}>
          🚶 {tooltip.move.text}
        </div>
      )}
    </div>
  );
}