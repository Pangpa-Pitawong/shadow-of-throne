// ─── MAP CONFIG — ตั้งค่าภูมิประเทศ/สถานที่ตอนสร้างห้อง ───────────────────────
//   amount ต่อภูมิประเทศ: 0=น้อย · 1=ปกติ · 2=มาก   (ตัวคูณน้ำหนักการสุ่ม)
//   zoneDensity: 0=น้อย · 1=ปกติ · 2=มาก  (จำนวนสถานที่พิเศษบนแมพ)
export const DEFAULT_MAP_CFG = {
  random: false,
  terrain: { forest: 1, mountain: 1, desert: 1, swamp: 1, water: 1 },
  zoneDensity: 1,
  dangerZones: true,
  shops: true,
};

// ขนาดแมพ — สเกลให้ใกล้ความละเอียดของ prototype island3d
export const MAP_SIZES = {
  small:  { cols: 23, rows: 19 },
  medium: { cols: 29, rows: 24 },
  large:  { cols: 35, rows: 29 },
};

export function sanitizeMapConfig(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const clampAmt = (v) => (v === 0 || v === 1 || v === 2 ? v : 1);
  const t = c.terrain && typeof c.terrain === "object" ? c.terrain : {};
  return {
    random: !!c.random,
    size: MAP_SIZES[c.size] ? c.size : "medium",
    terrain: {
      forest: clampAmt(t.forest), mountain: clampAmt(t.mountain),
      desert: clampAmt(t.desert), swamp: clampAmt(t.swamp), water: clampAmt(t.water),
    },
    zoneDensity: clampAmt(c.zoneDensity),
    dangerZones: c.dangerZones !== false,
    shops: c.shops !== false,
  };
}
