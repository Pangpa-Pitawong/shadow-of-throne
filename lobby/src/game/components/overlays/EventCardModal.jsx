// src/game/components/overlays/EventCardModal.jsx
// การ์ดเหตุการณ์ท้ายเฟส — เด้งกลางจอ (1–3 ใบ)
export default function EventCardModal({ reveal, onClose }) {
  if (!reveal || !reveal.cards?.length) return null;
  return (
    <div className="evcard-backdrop" onClick={onClose}>
      <div className="evcard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="evcard-title">📜 เหตุการณ์จบเฟส {reveal.phase} — เปิด {reveal.cards.length} ใบ</div>
        <div className="evcard-row">
          {reveal.cards.map((c, i) => (
            <div key={c.id + i} className="evcard" style={{ animationDelay: `${i * 0.12}s` }}>
              <span className="evcard-ico">{c.ico}</span>
              <div className="evcard-name">{c.name}</div>
              <div className="evcard-desc">{c.desc}</div>
            </div>
          ))}
        </div>
        <button className="evcard-close" onClick={onClose}>รับทราบ</button>
      </div>
    </div>
  );
}
