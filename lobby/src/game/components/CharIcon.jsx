// src/game/components/CharIcon.jsx
// แสดงรูป portrait ของตัวละคร (/characters/<id>.png) พร้อม fallback เป็น emoji
import { useState } from "react";

export default function CharIcon({ ch, size = 28, round = true, style }) {
  const [err, setErr] = useState(false);
  const id = ch?.id;
  const src = id ? `/characters/${id}.png` : null;

  if (!src || err) {
    return (
      <span style={{ fontSize: Math.round(size * 0.7), lineHeight: 1, ...style }}>
        {ch?.ico ?? "🧑"}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={ch?.name || ""}
      onError={() => setErr(true)}
      style={{
        width: size,
        height: size,
        objectFit: "cover",
        borderRadius: round ? "50%" : "8px",
        display: "block",
        ...style,
      }}
    />
  );
}
