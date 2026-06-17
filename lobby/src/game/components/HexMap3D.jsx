// src/game/components/HexMap3D.jsx
// แมพ 2.5D มุมมอง Perspective + ช่อง 6 เหลี่ยม + หมุนกล้องได้
// แทนที่การเรนเดอร์ SVG เดิม — รับ cells/players จาก server เหมือนเดิม
import { useRef, useEffect } from "react";
import { CHARACTERS } from "../constants/characters.js";
import { CLASSES } from "../constants/classes.js";

// ─── แปลง terrain ของ server → สไตล์ภาพ ───────────────────────────
// server terrain: plains | forest | mountain | water | desert | swamp
const TVIS = {
  water:    { top: "#2a5a9a", side: "#163354", h: 0.09, flat: true,  prop: null },
  plains:   { top: "#5a8a3a", side: "#33521e", h: 0.24, prop: "grass" },
  forest:   { top: "#3a6a2a", side: "#234118", h: 0.34, prop: "tree" },
  mountain: { top: "#928a80", side: "#544f44", h: 1.35, prop: "rock" },
  desert:   { top: "#c8a050", side: "#8a6826", h: 0.18, prop: "cactus" },
  swamp:    { top: "#3a5440", side: "#1e3024", h: 0.20, prop: "deadTree" },
};
function tvis(t) { return TVIS[t] || TVIS.plains; }

// ─── แคชรูป portrait ตัวละคร (โหลดครั้งเดียว ใช้เป็น billboard sprite) ───
const _charImgCache = new Map(); // id → { img, ok, failed }
function getCharImg(id) {
  if (!id) return null;
  let e = _charImgCache.get(id);
  if (!e) {
    const img = new Image();
    e = { img, ok: false, failed: false };
    img.onload = () => { e.ok = true; };
    img.onerror = () => { e.failed = true; };
    img.src = `/characters/${id}.png`;
    _charImgCache.set(id, e);
  }
  return e;
}

// ─── HEX GEOMETRY (pointy-top, odd-q ให้ตรงกับ server/hexMath) ─────
// server layout (hexToPixel): คอลัมน์เป็นแกนแนวนอน, คอลัมน์คี่เลื่อนลง → odd-q
const R = 0.62;
const HEXC = [];
for (let i = 0; i < 6; i++) {
  const a = (60 * i) * Math.PI / 180; // flat-top hex (มุมเริ่ม 0) ให้ตรง hexPoints เดิม
  HEXC.push({ x: R * Math.cos(a), z: R * Math.sin(a) });
}
// world center ของ hex (odd-q: คอลัมน์คี่ขยับลงครึ่งช่อง)
const COL_SP = R * 1.5;            // ระยะห่างแนวคอลัมน์ (flat-top)
const ROW_SP = R * Math.sqrt(3);   // ระยะห่างแนวแถว
function hexWorld(col, row, cx0, cz0) {
  const x = col * COL_SP - cx0;
  const z = row * ROW_SP + (col & 1 ? ROW_SP / 2 : 0) - cz0;
  return { x, z };
}

// ─── CAMERA constant ──────────────────────────────────────────────
const FOV = 820, CAM_HEIGHT = 9, CAM_DIST = 8;

function shd(hex, p) {
  const n = parseInt(hex.replace("#", ""), 16); const f = p / 100;
  return `rgb(${Math.min(255, Math.max(0, ((n >> 16) & 255) + 255 * f)) | 0},${Math.min(255, Math.max(0, ((n >> 8) & 255) + 255 * f)) | 0},${Math.min(255, Math.max(0, (n & 255) + 255 * f)) | 0})`;
}
function rnd(s) { return ((Math.sin(s * 127.1) * 43758.5453) % 1 + 1) % 1; }
// "#rrggbb" → "r,g,b" (ใช้กับ rgba() ของออร่าผู้เล่น)
function hexToRgb(hex) {
  if (typeof hex !== "string" || hex[0] !== "#") return "200,200,200";
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
const LDX = -0.55, LDZ = -0.83; // ทิศแสง

export default function HexMap3D({
  cells, players, myIdx, currentTurn,
  reachableCells = [], attackableCells = [], trapCells = [],
  skillTargetCells = [], selectedCell, pendingMove,
  zones = {}, categoryColors = {},
  onCellClick, onCellHover, onCellLeave,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  // กล้อง (เก็บใน ref เพื่อไม่ rerender)
  const cam = useRef({ yaw: 0, pitch: 0.62, zoom: 1, panX: 0, panZ: 0, scale: 1 });
  // ข้อมูลล่าสุด (อ่านใน loop)
  const data = useRef({});
  data.current = { cells, players, myIdx, currentTurn, reachableCells, attackableCells, trapCells, skillTargetCells, selectedCell, pendingMove, zones, categoryColors };
  // ✅ เก็บ callback ล่าสุดไว้ใน ref — กัน stale closure ใน event listener (deps []),
  //    เดิม onCellClick/onCellHover ถูกแช่แข็งค่าตอน mount ทำให้คลิกเดินไม่ได้
  const cb = useRef({ onCellClick, onCellHover, onCellLeave });
  useEffect(() => { cb.current = { onCellClick, onCellHover, onCellLeave }; });
  // pick buffer: [{cell, poly:[{x,y}...], depth}]
  const picks = useRef([]);
  const tickRef = useRef(0);
  // ✅ perf: ระหว่าง "ลากกล้อง" วาดฉากแบบเบา (ตัด props/ป้ายชื่อ/ดาวบางส่วน) + ไม่จำกัด fps
  //    → หมุน/เลื่อนลื่นที่สุด แล้วค่อยวาดรายละเอียดเต็มเมื่อปล่อยมือ
  const dragging = useRef(false);
  // ── perf: แคชฉากนิ่ง (พื้นหลัง+ช่อง+props+zone) ─────────────────
  const sceneDirty = useRef(true);          // true = ต้องวาดฉากใหม่ (กล้อง/ข้อมูลเปลี่ยน)
  const sceneCv = useRef(null);             // offscreen canvas เก็บฉากนิ่ง
  const propCache = useRef(new Map());      // cell.key → [{type,wx,wy,wz}] ตำแหน่ง prop (คำนวณครั้งเดียว)
  const zoneModelCache = useRef(new Map()); // cell.key → [faces] โมเดล 3D ของสถานที่ (สร้างครั้งเดียว)

  // จุดศูนย์กลางแมพ (คำนวณจาก cells — รองรับขนาดแมพใดก็ได้ตามจำนวนผู้เล่น)
  const centerRef = useRef({ cx0: 0, cz0: 0, cols: 13, rows: 11 });
  // ── perf: server ส่ง cells ใหม่ทุก broadcast (รวม shopItems ที่ไม่เกี่ยวกับการวาด)
  //   → ฉากนิ่ง (terrain/zone/กับดัก/ขนาดแมพ) แทบไม่เปลี่ยน แต่เดิมถูกบังคับวาดใหม่ทั้งแมพ
  //   ทุกครั้งที่มีใครขยับ. คำนวณ "ลายเซ็น" ของสิ่งที่กระทบฉากจริง แล้ววาดใหม่เฉพาะตอนเปลี่ยน
  const cellsSigRef = useRef("");
  useEffect(() => {
    if (!cells.length) return;
    let maxCol = 0, maxRow = 0, sig = "";
    for (const c of cells) {
      if (c.col > maxCol) maxCol = c.col;
      if (c.row > maxRow) maxRow = c.row;
      sig += c.terrain + (c.specialZone || "") + (c.trap ? "T" : "") + "|";
    }
    if (sig === cellsSigRef.current) return; // ฉากนิ่งเหมือนเดิม → ไม่ต้องทำอะไร
    cellsSigRef.current = sig;
    const cols = maxCol + 1, rows = maxRow + 1;
    const cx0 = (cols - 1) * COL_SP / 2;
    const cz0 = (rows - 1) * ROW_SP / 2 + ROW_SP / 4;
    centerRef.current = { cx0, cz0, cols, rows };
    // auto-fit zoom เริ่มต้นตามขนาดแมพ (เฉพาะตอนแมพเปลี่ยนจริง)
    cam.current.scale = Math.max(0.6, Math.min(1.4, 12 / Math.max(cols, rows)));
    propCache.current.clear();   // ตำแหน่ง prop อิงศูนย์กลางแมพ → ล้างเมื่อแมพเปลี่ยน
    zoneModelCache.current.clear(); // โมเดลสถานที่อิงศูนย์กลางแมพเช่นกัน
    sceneDirty.current = true;   // ขนาด/พื้นผิว/กับดักเปลี่ยน → วาดฉากใหม่
  }, [cells]);

  // ── projection (อ่าน cam ปัจจุบัน) ──
  function project(wx, wy, wz) {
    const c = cam.current;
    const x = (wx - c.panX) * c.scale, z = (wz - c.panZ) * c.scale, y = wy * c.scale;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const rx = x * cs - z * sn, rz = x * sn + z * cs;
    const py = y - CAM_HEIGHT, pz = rz + CAM_DIST, px = rx;
    const sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
    const depth = -py * sp + pz * cp, up = py * cp + pz * sp;
    if (depth <= 0.25) return null;
    const cv = canvasRef.current;
    const sc = FOV * c.zoom / depth;
    return { x: cv.width / 2 + px * sc, y: cv.height * 0.54 - up * sc, s: c.zoom / depth, depth };
  }
  function bbScale(wx, wy, wz) {
    const b = project(wx, wy, wz), t = project(wx, wy + 1, wz);
    if (!b || !t) return null;
    return { base: b, pxPerUnit: Math.abs(b.y - t.y) };
  }

  // ── pointer-in-polygon ──
  function inPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pickCell(px, py) {
    let best = null, bestDepth = Infinity;
    for (const p of picks.current) {
      if (p.depth < bestDepth && inPoly(px, py, p.poly)) { best = p; bestDepth = p.depth; }
    }
    // เลือกตัวที่อยู่ "หน้าสุด" (depth น้อย) ในกลุ่มที่คลิกโดน
    let front = null, fd = Infinity;
    for (const p of picks.current) if (inPoly(px, py, p.poly) && p.depth < fd) { front = p; fd = p.depth; }
    return front ? front.cell : (best ? best.cell : null);
  }

  // ── input ──
  useEffect(() => {
    const cv = canvasRef.current;
    let drag = false, mode = "orbit", sx, sy, syaw, spitch, spanX, spanZ, moved = 0;
    const down = (e) => {
      const t = e.touches ? e.touches[0] : e;
      drag = true; moved = 0;
      mode = (e.shiftKey || (e.touches && e.touches.length > 1)) ? "pan" : "orbit";
      sx = t.clientX; sy = t.clientY;
      const c = cam.current; syaw = c.yaw; spitch = c.pitch; spanX = c.panX; spanZ = c.panZ;
    };
    const move = (e) => {
      if (!drag) return;
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      moved += Math.abs(dx) + Math.abs(dy);
      const c = cam.current;
      if (mode === "pan") {
        const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
        const mx = -dx * 0.016 / c.zoom, mz = -dy * 0.016 / c.zoom;
        c.panX = spanX + (mx * cs - mz * sn); c.panZ = spanZ + (mx * sn + mz * cs);
      } else {
        c.yaw = syaw + dx * 0.006;
        c.pitch = Math.max(0.34, Math.min(1.04, spitch + dy * 0.004));
      }
      dragging.current = true;   // กำลังลาก → โหมดเรนเดอร์เบา (ลื่น)
      sceneDirty.current = true; // กล้องขยับ → วาดฉากใหม่
      if (e.touches) e.preventDefault();
    };
    const up = (e) => {
      if (drag && moved < 6) {
        // คลิก (ไม่ลาก) → เลือกช่อง
        const rect = cv.getBoundingClientRect();
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const cell = pickCell(t.clientX - rect.left, t.clientY - rect.top);
        if (cell && cb.current.onCellClick) cb.current.onCellClick(cell);
      }
      drag = false;
      dragging.current = false;  // ปล่อยมือ → วาดรายละเอียดเต็มอีกครั้ง
      sceneDirty.current = true;
    };
    const wheel = (e) => { e.preventDefault(); cam.current.zoom = Math.min(2.6, Math.max(0.45, cam.current.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); sceneDirty.current = true; };
    const hover = (e) => {
      if (drag) return;
      const rect = cv.getBoundingClientRect();
      const cell = pickCell(e.clientX - rect.left, e.clientY - rect.top);
      if (cell && cb.current.onCellHover) cb.current.onCellHover(cell, e.clientX, e.clientY);
      else if (cb.current.onCellLeave) cb.current.onCellLeave();
    };
    cv.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    cv.addEventListener("mousemove", hover);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("touchstart", down, { passive: false });
    cv.addEventListener("touchmove", move, { passive: false });
    cv.addEventListener("touchend", up);
    return () => {
      cv.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      cv.removeEventListener("mousemove", hover);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("touchstart", down);
      cv.removeEventListener("touchmove", move);
      cv.removeEventListener("touchend", up);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render loop (render-on-demand + แคชฉาก, throttle ~30fps) ──
  useEffect(() => {
    let raf, last = 0;
    const cv = canvasRef.current, ctx = cv.getContext("2d");
    const resize = () => {
      const r = wrapRef.current.getBoundingClientRect();
      cv.width = Math.max(2, r.width | 0); cv.height = Math.max(2, r.height | 0);
      if (!sceneCv.current) sceneCv.current = document.createElement("canvas");
      sceneCv.current.width = cv.width; sceneCv.current.height = cv.height;
      sceneDirty.current = true; // ขนาดจอเปลี่ยน → วาดฉากใหม่
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      // ขณะลากกล้อง: วาดทุกเฟรม (ลื่นสุด) — ปกติจำกัด ~30fps ลดภาระ CPU
      if (!dragging.current && now - last < 32) return;
      last = now;
      tickRef.current++;
      frame(ctx, cv);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FRAME: blit ฉากแคช + วาดเลเยอร์เคลื่อนไหวทับ ──
  function frame(ctx, cv) {
    const t = tickRef.current;
    const d = data.current;
    // วาดฉากนิ่งใหม่เฉพาะเมื่อกล้อง/ข้อมูลเปลี่ยน (sceneDirty)
    if (sceneDirty.current || !sceneCv.current) { renderScene(t); sceneDirty.current = false; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (sceneCv.current) ctx.drawImage(sceneCv.current, 0, 0);
    if (!d.cells.length) return;
    drawDynamic(ctx, cv, t, d);
  }

  // ── SCENE (แคช): พื้นหลัง + ช่อง hex + props + zone — วาดลง offscreen ──
  function renderScene(t) {
    const sc = sceneCv.current; if (!sc) return;
    const sctx = sc.getContext("2d");
    const d = data.current;
    const fast = dragging.current; // โหมดเบาขณะลากกล้อง
    const { cx0, cz0 } = centerRef.current;
    sctx.clearRect(0, 0, sc.width, sc.height);
    drawBG(sctx, sc, t, fast);
    picks.current = [];
    if (!d.cells.length) return;

    // ช่อง hex (พื้นผิว) เรียงตาม depth
    const tiles = [];
    for (const cell of d.cells) { const o = buildHex(cell, t, cx0, cz0); if (o) tiles.push(o); }
    tiles.sort((a, b) => b.depth - a.depth);
    for (const o of tiles) {
      paintHexBase(sctx, o);
      // เก็บเรขาคณิตไว้ให้เลเยอร์ไฮไลต์/คลิกใช้ (back→front)
      picks.current.push({ cell: o.cell, poly: o.top, depth: o.depth, ctr: o.ctr, vt: o.vt });
    }

    // props / zone (นิ่ง) — ขณะลากกล้องตัด props ทิ้ง (ตัวหนักสุด) เพื่อความลื่น
    const ov = [];
    for (const cell of d.cells) {
      const vt = tvis(cell.terrain);
      if (!fast && !cell.specialZone && vt.prop) {
        for (const pr of getProps(cell, cx0, cz0)) ov.push({ depth: pr.depth, kind: "prop", pr });
      }
      if (cell.specialZone) {
        const ctr = hexWorld(cell.col, cell.row, cx0, cz0);
        const pj = project(ctr.x, vt.h, ctr.z);
        ov.push({ depth: pj ? pj.depth : 9999, kind: "zone", cell, ctr });
      }
    }
    ov.sort((a, b) => b.depth - a.depth);
    for (const o of ov) {
      if (o.kind === "prop") drawProp(sctx, o.pr, t);
      else if (o.kind === "zone") drawZone(sctx, o.cell, o.ctr, t, d, fast);
    }
  }

  // ── DYNAMIC: ไฮไลต์ (กะพริบ) + ตัวละคร (เด้ง) — วาดทับทุกเฟรม ──
  function drawDynamic(ctx, cv, t, d) {
    const keyset = (arr) => { const s = new Set(); for (const c of arr) s.add(c.key); return s; };
    const reach = keyset(d.reachableCells), atk = keyset(d.attackableCells),
      trap = keyset(d.trapCells), skill = keyset(d.skillTargetCells);
    const hl = { reach, atk, trap, skill, sel: d.selectedCell, pend: d.pendingMove };
    // ไฮไลต์ตามลำดับ depth (picks เรียง back→front อยู่แล้ว)
    // ข้ามทั้งลูปเมื่อไม่มีช่องไฮไลต์ — ประหยัด 143 รอบต่อเฟรมในกรณีปกติ
    if (reach.size || atk.size || trap.size || skill.size || hl.sel || hl.pend) {
      for (const pk of picks.current) paintHighlight(ctx, pk, t, hl, d);
    }

    // cellMap สำหรับ lookup terrain แบบ O(1) (เลี่ยง .find ต่อ player ต่อเฟรม)
    const cmap = {};
    for (const c of d.cells) cmap[c.key] = c;

    const { cx0, cz0 } = centerRef.current;

    // ── กับดักที่วางไว้ — มาร์กเกอร์ 🪤 เรืองแสงกะพริบ ให้เห็นเด่นชัดทุกช่อง ──
    for (const c of d.cells) {
      if (!c.trap) continue;
      const vt = tvis(c.terrain);
      const ctr = hexWorld(c.col, c.row, cx0, cz0);
      const bb = bbScale(ctr.x, vt.h, ctr.z); if (!bb) continue;
      const s = bb.pxPerUnit * 0.02, pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.09));
      ctx.save(); ctx.translate(bb.base.x, bb.base.y);
      // วงเตือนใต้กับดัก
      ctx.beginPath(); ctx.ellipse(0, -3 * s, 11 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(224,184,76,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 1.6 * s; ctx.setLineDash([3 * s, 2 * s]); ctx.stroke(); ctx.setLineDash([]);
      ctx.shadowColor = "#e0b84c"; ctx.shadowBlur = 12 * s * pulse;
      ctx.font = `${Math.max(13, 17 * s)}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🪤", 0, -7 * s);
      ctx.restore();
    }

    // ตัวละคร — เรียงตาม depth
    const ov = [];
    for (let i = 0; i < d.players.length; i++) {
      const p = d.players[i];
      if (!p.alive) continue;
      if (p.hiddenByFog && i !== d.myIdx) continue;
      const vt = tvis((cmap[p.col + "," + p.row] || {}).terrain);
      const ctr = hexWorld(p.col, p.row, cx0, cz0);
      const pj = project(ctr.x, vt.h, ctr.z);
      ov.push({ depth: pj ? pj.depth : 9999, p, idx: i, ctr, h: vt.h });
    }
    ov.sort((a, b) => b.depth - a.depth);
    for (const o of ov) drawPlayer(ctx, o, t, d);
  }

  function buildHex(cell, t, cx0, cz0) {
    const vt = tvis(cell.terrain);
    const ctr = hexWorld(cell.col, cell.row, cx0, cz0);
    const wav = vt.flat ? Math.sin(t * 0.03 + cell.col * 0.6 + cell.row * 0.5) * 0.025 : 0;
    const yT = vt.h + wav;
    const top = [], bot = [];
    for (let i = 0; i < 6; i++) { const p = project(ctr.x + HEXC[i].x, yT, ctr.z + HEXC[i].z); if (!p) return null; top.push(p); }
    for (let i = 0; i < 6; i++) bot.push(project(ctr.x + HEXC[i].x, 0, ctr.z + HEXC[i].z));
    const cProj = project(ctr.x, yT, ctr.z); if (!cProj) return null;
    return { cell, vt, ctr, yT, top, bot, cProj, depth: cProj.depth };
  }

  // วาดพื้นผิวช่อง (ลงฉากแคช) — ไม่รวมไฮไลต์
  function paintHexBase(ctx, o) {
    const { vt, top, bot, cProj, cell } = o;
    // side faces (เฉพาะด้านหน้า)
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6, t1 = top[i], t2 = top[j], b1 = bot[i], b2 = bot[j];
      if (!b1 || !b2) continue;
      if ((t1.y + t2.y) / 2 <= cProj.y) continue;
      const nx = HEXC[i].x + HEXC[j].x, nz = HEXC[i].z + HEXC[j].z, nl = Math.hypot(nx, nz) || 1;
      const bright = 0.5 + 0.5 * ((nx / nl) * LDX + (nz / nl) * LDZ);
      ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y); ctx.closePath();
      const g = ctx.createLinearGradient(t1.x, t1.y, b1.x, b1.y);
      g.addColorStop(0, shd(vt.side, -8 + bright * 22)); g.addColorStop(1, shd(vt.side, -22 + bright * 16));
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 0.5; ctx.stroke();
    }
    // top face
    ctx.beginPath(); top.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    if (cell.terrain === "water") {
      const g = ctx.createLinearGradient(top[0].x, top[0].y, top[3].x, top[3].y);
      g.addColorStop(0, "#3a6aaa"); g.addColorStop(1, "#244680"); ctx.fillStyle = g;
    } else if (cell.terrain === "mountain") {
      const g = ctx.createLinearGradient(top[5].x, top[5].y, top[2].x, top[2].y);
      g.addColorStop(0, "#b4ad9e"); g.addColorStop(0.5, "#928a80"); g.addColorStop(1, "#615c50"); ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(top[5].x, top[5].y, top[2].x, top[2].y);
      g.addColorStop(0, shd(vt.top, 12)); g.addColorStop(1, shd(vt.top, -10)); ctx.fillStyle = g;
    }
    ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 0.6; ctx.stroke();
  }

  // วาดเส้น/พื้นไฮไลต์ทับ polygon ช่อง (+ เรืองแสงถ้ามี glow)
  function fillTop(ctx, top, fill, stroke, lw, dash, glow) {
    ctx.save();
    ctx.beginPath(); top.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 12; }
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash); ctx.stroke();
    }
    ctx.restore();
  }

  // ── ไฮไลต์ของช่องเดียว (เลเยอร์เคลื่อนไหว วาดทับทุกเฟรม) ──
  function paintHighlight(ctx, pk, t, hl, d) {
    const { cell, poly: top, ctr, vt } = pk;
    const k = cell.key;
    const inReach = hl.reach.has(k), inAtk = hl.atk.has(k),
      inTrap = hl.trap.has(k), inSkill = hl.skill.has(k);
    const isSel = hl.sel && hl.sel.key === k, isPend = hl.pend && hl.pend.key === k;
    // ช่องนี้ไม่มีไฮไลต์ใดๆ → ข้ามทันที (เลี่ยงงานต่อช่องในเฟรมปกติ)
    if (!inReach && !inAtk && !inTrap && !inSkill && !isSel && !isPend) return;
    // ✅ ช่องที่เดินได้: เด่นชัดขึ้นมาก — พื้นเขียวเข้มกะพริบ + ขอบหนาเรืองแสง + เส้นในสว่าง
    if (inReach) {
      const pulse = 0.34 + 0.16 * Math.sin(t * 0.18 + cell.col * 0.5 + cell.row * 0.4);
      fillTop(ctx, top, `rgba(80,230,100,${pulse})`, "#9dff8a", 3, null, "#7CFC7C");
      fillTop(ctx, top, null, "rgba(225,255,215,.9)", 1.2);
    }
    if (inAtk) {
      const hasEnemy = d.players.some(p => p.alive && p.col === cell.col && p.row === cell.row && p.id !== d.currentTurn);
      // ✅ ทุกช่องในระยะโจมตีเห็นชัด: แดงกะพริบ + ขอบแดงประเรืองแสง
      const pulse = 0.20 + 0.13 * Math.sin(t * 0.17 + cell.col * 0.4 + cell.row * 0.5);
      fillTop(ctx, top, `rgba(224,64,64,${pulse})`, "#ff8a6a", 2, [6, 4], "#e05050");
      if (hasEnemy) {
        // มีศัตรูยืนอยู่ → เน้นหนัก: พื้นแดงเข้มเต้น + ขอบหนาเรืองแสง + เป้า 🎯
        const ep = 0.34 + 0.18 * Math.sin(t * 0.24);
        fillTop(ctx, top, `rgba(224,48,48,${ep})`, "#ff5a5a", 3.6, null, "#ff3030");
        const p = project(ctr.x, vt.h + 0.55, ctr.z);
        if (p) { ctx.font = `${Math.max(12, p.s * FOV * 0.028)}px serif`; ctx.textAlign = "center"; ctx.fillText("🎯", p.x, p.y); }
      }
    }
    if (inTrap) {
      // ✅ ช่องที่วางกับดักได้: เหลืองทองกะพริบ + ขอบประหนาเรืองแสง
      const pulse = 0.18 + 0.15 * Math.sin(t * 0.2 + cell.col * 0.6 + cell.row * 0.3);
      fillTop(ctx, top, `rgba(224,184,76,${pulse})`, "#ffd24c", 2.6, [5, 3], "#e0b84c");
    }
    if (inSkill) fillTop(ctx, top, "rgba(140,76,201,.32)", "#a060e0", 2, [6, 3]);
    if (isSel) fillTop(ctx, top, null, "#ffd700", 2.4);
    if (isPend) {
      const pulse = 0.4 + 0.3 * Math.sin(t * 0.12);
      fillTop(ctx, top, `rgba(76,201,76,${pulse})`, "#7CFC7C", 2.8, null, "#7CFC7C");
      // ป้าย 📍 ลอยเหนือช่อง
      const p = project(ctr.x, vt.h + 0.6, ctr.z);
      if (p) { ctx.font = `${Math.max(12, p.s * FOV * 0.03)}px serif`; ctx.textAlign = "center"; ctx.fillText("📍", p.x, p.y); }
    }
  }

  // ── PROPS ──
  function getProps(cell, cx0, cz0) {
    // ตำแหน่ง prop (world) ไม่ขึ้นกับกล้อง → คำนวณครั้งเดียวต่อช่อง แล้วแคชไว้
    let list = propCache.current.get(cell.key);
    if (!list) { list = computePropBases(cell, cx0, cz0); propCache.current.set(cell.key, list); }
    return list.map(pr => { const pj = project(pr.wx, pr.wy, pr.wz); return { ...pr, depth: pj ? pj.depth : 9999, valid: !!pj }; }).filter(pr => pr.valid);
  }
  function computePropBases(cell, cx0, cz0) {
    const vt = tvis(cell.terrain), col = cell.col, row = cell.row;
    const ctr = hexWorld(col, row, cx0, cz0);
    const list = [];
    const push = (type, dx, dz) => list.push({ type, wx: ctr.x + dx * R, wz: ctr.z + dz * R, wy: vt.h });
    if (vt.prop === "grass") {
      const n = Math.floor(rnd(col * 17 + row * 13) * 3) + 1;
      for (let i = 0; i < n; i++) push("grass", (rnd(col * 31 + row * 29 + i * 7) * 2 - 1) * 0.55, (rnd(col * 23 + row * 37 + i * 11) * 2 - 1) * 0.55);
      if (rnd(col * 41 + row * 19) < 0.28) push("smallTree", (rnd(col * 53 + row * 11) * 2 - 1) * 0.45, (rnd(col * 7 + row * 61) * 2 - 1) * 0.45);
      if (rnd(col * 43 + row * 17) < 0.16) push("rock", (rnd(col * 59 + row * 13) * 2 - 1) * 0.45, (rnd(col * 13 + row * 59) * 2 - 1) * 0.45);
      if (rnd(col * 37 + row * 23) < 0.14) push("flower", (rnd(col * 67 + row * 41) * 2 - 1) * 0.45, (rnd(col * 41 + row * 67) * 2 - 1) * 0.45);
    } else if (vt.prop === "tree") {
      const n = Math.floor(rnd(col * 19 + row * 23) * 2) + 2;
      for (let i = 0; i < n; i++) push("tree", (rnd(col * 29 + row * 31 + i * 13) * 2 - 1) * 0.5, (rnd(col * 31 + row * 29 + i * 17) * 2 - 1) * 0.5);
    } else if (vt.prop === "rock") {
      if (rnd(col * 61 + row * 47) < 0.7) push("rock", (rnd(col * 71 + row * 53) * 2 - 1) * 0.4, (rnd(col * 53 + row * 71) * 2 - 1) * 0.4);
      if (rnd(col * 29 + row * 53) < 0.3) push("rock", (rnd(col * 31 + row * 59) * 2 - 1) * 0.5, (rnd(col * 59 + row * 31) * 2 - 1) * 0.5);
    } else if (vt.prop === "cactus") {
      if (rnd(col * 73 + row * 59) < 0.35) push("cactus", (rnd(col * 89 + row * 67) * 2 - 1) * 0.45, (rnd(col * 67 + row * 89) * 2 - 1) * 0.45);
      if (rnd(col * 17 + row * 41) < 0.2) push("rock", (rnd(col * 19 + row * 43) * 2 - 1) * 0.4, (rnd(col * 43 + row * 19) * 2 - 1) * 0.4);
    } else if (vt.prop === "deadTree") {
      if (rnd(col * 67 + row * 41) < 0.5) push("deadTree", (rnd(col * 83 + row * 61) * 2 - 1) * 0.4, 0);
      if (rnd(col * 31 + row * 17) < 0.4) push("grass", (rnd(col * 13 + row * 53) * 2 - 1) * 0.5, (rnd(col * 53 + row * 13) * 2 - 1) * 0.5);
    }
    return list;
  }
  function drawProp(ctx, pr, t) {
    const bb = bbScale(pr.wx, pr.wy, pr.wz); if (!bb) return;
    const u = bb.pxPerUnit; ctx.save(); ctx.translate(bb.base.x, bb.base.y);
    ({ grass: pGrass, tree: pTree, smallTree: pSmallTree, deadTree: pDeadTree, rock: pRock, flower: pFlower, cactus: pCactus }[pr.type] || (() => { }))(ctx, u, pr.wx * 37 + pr.wz * 53, t);
    ctx.restore();
  }

  // ── ZONE (สถานที่พิเศษ) — โมเดล 3D + ไอคอน/ป้ายชื่อลอย ──
  function drawZone(ctx, cell, ctr, t, d, fast) {
    const vt = tvis(cell.terrain);
    const z = d.zones[cell.specialZone];
    const cat = z?.category; const cc = cat ? d.categoryColors[cat] : null;
    const col = z?.color || "#c9a84c";
    const baseY = vt.h;

    // โมเดล: เรขาคณิต world แคชครั้งเดียวต่อช่อง (อิงศูนย์กลางแมพ — ล้างเมื่อแมพเปลี่ยน)
    // ขณะลากกล้อง (fast) วาด silhouette กล่องเดียว → หมุนลื่นสุด
    if (fast) {
      drawZoneModel(ctx, zoneFastFaces(baseY, col), ctr, true);
    } else {
      let faces = zoneModelCache.current.get(cell.key);
      if (!faces) { faces = buildZoneModel(cat, baseY, col); zoneModelCache.current.set(cell.key, faces); }
      drawZoneModel(ctx, faces, ctr, false);
    }

    // ไอคอน + ป้ายชื่อ ลอยเหนือโมเดล (คงไว้ให้ผู้เล่นอ่านง่าย)
    const ip = project(ctr.x, baseY + (ZONE_TOP[cat] ?? 1.0) + 0.35, ctr.z);
    if (!ip) return;
    const sz = Math.max(11, ip.s * FOV * 0.04);
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = sz * 0.5 * (0.6 + 0.4 * Math.abs(Math.sin(t * 0.05)));
    ctx.font = `${sz}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(z?.ico || "❓", ip.x, ip.y);
    ctx.shadowBlur = 0;
    if (!fast && sz > 13) {
      ctx.font = `bold ${Math.max(9, sz * 0.42)}px 'Segoe UI',sans-serif`;
      const nm = z?.name || "";
      const tw = ctx.measureText(nm).width + 10;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.roundRect(ip.x - tw / 2, ip.y - sz * 0.9 - 13, tw, 14, 3); ctx.fill();
      ctx.fillStyle = cc?.border || col;
      ctx.fillText(nm, ip.x, ip.y - sz * 0.9 - 6);
    }
    ctx.restore();
  }

  // โปรเจกต์ faces ของโมเดล (พิกัด local รอบ 0,0) → เลื่อนไปตำแหน่งช่อง → เรียงระยะ → ระบายพร้อมแสง
  function drawZoneModel(ctx, faces, ctr, fast) {
    const items = [];
    for (const f of faces) {
      const sp = []; let ok = true, dep = 0;
      for (const p of f.pts) { const pj = project(ctr.x + p.x, p.y, ctr.z + p.z); if (!pj) { ok = false; break; } sp.push(pj); dep += pj.depth; }
      if (!ok || sp.length < 3) continue;
      // แสงจากทิศคงที่ในโลก (ไม่หมุนตามกล้อง) → เงาติดกับตัวโมเดลถูกต้องเวลาหมุน
      const b = 0.6 + 0.45 * Math.abs(f.nx * ZL[0] + f.ny * ZL[1] + f.nz * ZL[2]);
      items.push({ sp, dep: dep / sp.length, color: fast ? f.color : darken(f.color, b) });
    }
    items.sort((a, b) => b.dep - a.dep);
    ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(0,0,0,0.22)";
    for (const it of items) {
      ctx.beginPath(); it.sp.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = it.color; ctx.fill(); ctx.stroke();
    }
  }

  // ── PLAYER token ── (ขยายใหญ่ + เด่นชัดขึ้น: ออร่าเรืองแสง, เสาฐาน, ลูกศรชี้เทิร์น)
  function drawPlayer(ctx, o, t, d) {
    const { p, idx, ctr, h } = o;
    const bb = bbScale(ctr.x, h, ctr.z); if (!bb) return;
    const s = bb.pxPerUnit * 0.02, bob = Math.sin(t * 0.05 + idx * 0.7) * 3.5 * s;
    const isMe = idx === d.myIdx, isTurn = idx === d.currentTurn;
    const fogged = p.fogged && !isMe;
    const cls = CHARACTERS[p.charId] || CHARACTERS[p.classId] || CLASSES[p.classId];
    const pColor = fogged ? "#555" : (p.playerColor || cls?.color || "#888");
    const ico = fogged ? "❓" : (cls?.ico || "🧑");
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.07 + idx));
    const auraCol = isTurn ? "255,215,0" : isMe ? "255,255,255" : hexToRgb(pColor);
    // โทเคนใหญ่ขึ้น + ยกสูงให้ลอยเด่นเหนือพื้น
    const rad = 18 * s, cy = -26 * s + bob;
    ctx.save(); ctx.translate(bb.base.x, bb.base.y);

    // ── ออร่าวงแสงบนพื้น (เห็นชัดว่าใครยืนตรงไหน) ──
    const auraR = 17 * s;
    const ag = ctx.createRadialGradient(0, 0, 0, 0, 0, auraR);
    ag.addColorStop(0, `rgba(${auraCol},${0.34 * pulse})`);
    ag.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.beginPath(); ctx.ellipse(0, 0, auraR, auraR * 0.42, 0, 0, Math.PI * 2); ctx.fillStyle = ag; ctx.fill();
    // เงาใต้ตัว
    ctx.beginPath(); ctx.ellipse(0, 0, 12 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill();
    // วงฐานสีผู้เล่น
    ctx.beginPath(); ctx.ellipse(0, 0, 14 * s, 5.4 * s, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isTurn ? "#ffd700" : pColor; ctx.lineWidth = s * (isTurn ? 2.6 : 1.8);
    if (isTurn) ctx.setLineDash([4 * s, 2 * s]); ctx.stroke(); ctx.setLineDash([]);

    // ── เสาเชื่อมพื้น→โทเคน (ระบุตำแหน่งชัด) ──
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, cy + rad * 0.7);
    ctx.strokeStyle = `rgba(${auraCol},0.5)`; ctx.lineWidth = 1.6 * s; ctx.stroke();

    // ── ออร่าเรืองแสงรอบโทเคน ──
    ctx.save();
    ctx.shadowColor = isTurn ? "#ffd700" : pColor;
    ctx.shadowBlur = (isTurn ? 18 : 10) * s * pulse;
    ctx.beginPath(); ctx.arc(0, cy, rad + 1.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${auraCol},0.18)`; ctx.fill();
    ctx.restore();

    // ── ตัวละคร (billboard) — รูป portrait ในกรอบวงกลม, fallback เป็นวงสี+emoji ──
    const imgE = fogged ? null : getCharImg(p.charId || p.classId);
    if (imgE && imgE.ok) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, cy, rad, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      // crop จัตุรัสด้านบนของ portrait (หัว/อก) แล้วขยายเต็มวง
      const im = imgE.img, d2 = rad * 2, side = Math.min(im.width, im.height);
      ctx.drawImage(im, (im.width - side) / 2, 0, side, side, -rad, cy - rad, d2, d2);
      ctx.restore();
    } else {
      const gg = ctx.createRadialGradient(-rad * 0.3, cy - rad * 0.3, 0, 0, cy, rad);
      gg.addColorStop(0, shd(pColor, 30)); gg.addColorStop(1, shd(pColor, -25));
      ctx.beginPath(); ctx.arc(0, cy, rad, 0, Math.PI * 2); ctx.fillStyle = gg; ctx.fill();
      ctx.font = `${22 * s}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ico, 0, cy);
    }
    // กรอบวง (หนาขึ้น)
    ctx.beginPath(); ctx.arc(0, cy, rad, 0, Math.PI * 2);
    ctx.lineWidth = s * (isTurn ? 3.2 : isMe ? 2.6 : 2);
    ctx.strokeStyle = isTurn ? "#ffd700" : isMe ? "#fff" : (pColor || "rgba(0,0,0,.5)"); ctx.stroke();

    // ── ลูกศรชี้ลงเหนือหัวผู้เล่นที่กำลังถึงตา ──
    if (isTurn) {
      const ay = cy - rad - 7 * s - Math.abs(Math.sin(t * 0.12)) * 3 * s;
      ctx.fillStyle = "#ffd700"; ctx.shadowColor = "#ffd700"; ctx.shadowBlur = 8 * s;
      ctx.beginPath(); ctx.moveTo(-5 * s, ay); ctx.lineTo(5 * s, ay); ctx.lineTo(0, ay + 6 * s); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // label (มุมขวาบน)
    if (!fogged && p.playerLabel) {
      ctx.font = `bold ${9 * s}px 'Segoe UI'`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "#000"; ctx.shadowBlur = 3 * s;
      ctx.fillText(p.playerLabel, rad * 0.9, cy - rad * 0.78); ctx.shadowBlur = 0;
    }
    // HP bar (กว้าง/หนาขึ้น) + ชื่อ พร้อมพื้นหลังให้อ่านง่าย
    if (!fogged) {
      const bw = 34 * s, bx = -bw / 2, by = cy + rad + 4 * s, bh = 5 * s;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(bx - s, by - s, bw + 2 * s, bh + 2 * s);
      const hpR = Math.max(0, Math.min(1, p.hp / p.maxHp));
      ctx.fillStyle = hpR > 0.5 ? "#4cc94c" : hpR > 0.25 ? "#f0d080" : "#c94040";
      ctx.fillRect(bx, by, bw * hpR, bh);
      // ชื่อ (มีแถบดำหลังตัวอักษรให้อ่านง่าย)
      const nm = (p.name || "").slice(0, 8);
      ctx.font = `bold ${9 * s}px 'Segoe UI'`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const nw = ctx.measureText(nm).width + 8 * s, ny = by + bh + 9 * s;
      ctx.fillStyle = "rgba(0,0,0,.62)";
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-nw / 2, ny - 7 * s, nw, 14 * s, 3 * s); ctx.fill(); }
      else ctx.fillRect(-nw / 2, ny - 7 * s, nw, 14 * s);
      ctx.fillStyle = isTurn ? "#ffe98a" : "#fff";
      ctx.fillText(nm, 0, ny);
    }
    ctx.restore();
  }

  // ── BG ──
  function drawBG(ctx, cv, t, fast) {
    const W = cv.width, H = cv.height;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#04020c"); sky.addColorStop(0.45, "#0c0822"); sky.addColorStop(0.72, "#1a1040"); sky.addColorStop(1, "#241652");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const stars = fast ? 36 : 110; // ขณะลากกล้องวาดดาวน้อยลง
    for (let i = 0; i < stars; i++) {
      const sx = ((Math.sin(i * 7.31) * 9301 + 49297) % 233280) / 233280 * W;
      const sy = ((Math.sin(i * 3.71 + 1) * 9301 + 49297) % 233280) / 233280 * H * 0.5;
      const sr = ((Math.sin(i * 11.1) * 9301 + 49297) % 233280) / 233280;
      ctx.globalAlpha = 0.25 + sr * 0.6 * (0.7 + 0.3 * Math.sin(t * 0.018 + i));
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx, sy, sr * 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const mx = W * 0.82, my = H * 0.12;
    const mg = ctx.createRadialGradient(mx - 5, my - 5, 0, mx, my, 32);
    mg.addColorStop(0, "#fff9e8"); mg.addColorStop(0.7, "#e8d8a8"); mg.addColorStop(1, "transparent");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 32, 0, Math.PI * 2); ctx.fill();
  }

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "grab" }} />
      {/* ปุ่มควบคุมกล้อง */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6, zIndex: 5 }}>
        <CamBtn onClick={() => { cam.current.zoom = Math.min(2.6, cam.current.zoom * 1.15); sceneDirty.current = true; }}>＋</CamBtn>
        <CamBtn onClick={() => { cam.current.zoom = Math.max(0.45, cam.current.zoom * 0.85); sceneDirty.current = true; }}>－</CamBtn>
        <CamBtn onClick={() => { const c = cam.current; c.yaw = 0; c.pitch = 0.62; c.zoom = 1; c.panX = 0; c.panZ = 0; sceneDirty.current = true; }}>⟳</CamBtn>
      </div>
      <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 10, color: "#888", background: "rgba(13,11,8,.7)", border: "1px solid rgba(201,168,76,.25)", borderRadius: 6, padding: "4px 8px", pointerEvents: "none", fontFamily: "'Cinzel',serif" }}>
        ลาก=หมุนกล้อง · Shift+ลาก=เลื่อน · ล้อ=ซูม · คลิก=เลือกช่อง
      </div>
    </div>
  );
}

function CamBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: "rgba(13,11,8,.85)", border: "1px solid rgba(201,168,76,.35)",
      borderRadius: 6, color: "var(--gold,#c9a84c)", fontSize: 14, width: 30, height: 30,
      cursor: "pointer", lineHeight: 1,
    }}>{children}</button>
  );
}

// ════════ helpers วาด 3D ════════
function box(ctx, ox, oy, hw, height, topC, leftC, rightC) {
  ctx.fillStyle = leftC; ctx.beginPath(); ctx.moveTo(ox - hw, oy); ctx.lineTo(ox, oy + hw * 0.5); ctx.lineTo(ox, oy + hw * 0.5 + height); ctx.lineTo(ox - hw, oy + height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rightC; ctx.beginPath(); ctx.moveTo(ox + hw, oy); ctx.lineTo(ox, oy + hw * 0.5); ctx.lineTo(ox, oy + hw * 0.5 + height); ctx.lineTo(ox + hw, oy + height); ctx.closePath(); ctx.fill();
  const tg = ctx.createLinearGradient(ox - hw, oy, ox + hw, oy); tg.addColorStop(0, shd(topC, -5)); tg.addColorStop(0.5, shd(topC, 12)); tg.addColorStop(1, shd(topC, -8));
  ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(ox, oy - hw * 0.5); ctx.lineTo(ox + hw, oy); ctx.lineTo(ox, oy + hw * 0.5); ctx.lineTo(ox - hw, oy); ctx.closePath(); ctx.fill();
}
function pGrass(ctx, u, seed, t) {
  const s = u * 0.018;
  for (let i = 0; i < 4; i++) { const bx = (rnd(seed + i * 7) * 2 - 1) * 4 * s, bh = (7 + rnd(seed + i * 13) * 5) * s, sw = Math.sin(t * 0.03 + seed * 0.1 + i) * 2 * s;
    ctx.strokeStyle = i % 2 ? "#4a8020" : "#5a9828"; ctx.lineWidth = Math.max(0.6, s * 1.1); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(bx, 0); ctx.quadraticCurveTo(bx + sw, -bh * 0.5, bx + sw * 1.5, -bh); ctx.stroke(); }
}
function pTree(ctx, u, seed, t) {
  const s = u * 0.02, h = (32 + rnd(seed) * 14) * s, sw = Math.sin(t * 0.022 + seed * 0.07) * 2.5 * s;
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(0, 0, 12 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  const tg = ctx.createLinearGradient(-2.5 * s, 0, 2.5 * s, 0); tg.addColorStop(0, "#4a2e0a"); tg.addColorStop(0.45, "#6a4018"); tg.addColorStop(1, "#3a2008");
  ctx.fillStyle = tg; ctx.fillRect(-2.5 * s, -h * 0.4, 5 * s, h * 0.4);
  [{ r: 16 * s, y: -h * 0.32, c: "#2a5818", c2: "#163c0e" }, { r: 13 * s, y: -h * 0.56, c: "#347020", c2: "#204812" }, { r: 9.5 * s, y: -h * 0.75, c: "#3d7f25", c2: "#28561a" }, { r: 6 * s, y: -h * 0.9, c: "#4a9030", c2: "#307020" }].forEach((l, i) => {
    ctx.fillStyle = l.c2; ctx.beginPath(); ctx.ellipse(sw * 0.3, l.y + l.r * 0.2, l.r, l.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    const lg = ctx.createRadialGradient(-l.r * 0.3 + sw, l.y - l.r * 0.25, 0, sw * 0.3, l.y, l.r); lg.addColorStop(0, shd(l.c, 28)); lg.addColorStop(0.6, l.c); lg.addColorStop(1, l.c2);
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(sw * 0.4 * (1 - i * 0.2), l.y, l.r, 0, Math.PI * 2); ctx.fill();
  });
}
function pSmallTree(ctx, u, seed, t) {
  const s = u * 0.018, h = (18 + rnd(seed) * 8) * s, sw = Math.sin(t * 0.03 + seed * 0.1) * 1.5 * s;
  ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(0, 0, 8 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4a2e10"; ctx.fillRect(-1.8 * s, -h * 0.42, 3.6 * s, h * 0.42);
  [[10 * s, -h * 0.3, "#2a5818"], [8 * s, -h * 0.55, "#347020"], [5.5 * s, -h * 0.78, "#3d7f25"]].forEach(([r, y, c]) => {
    const lg = ctx.createRadialGradient(-r * 0.3 + sw, y - r * 0.2, 0, sw * 0.3, y, r); lg.addColorStop(0, shd(c, 22)); lg.addColorStop(1, shd(c, -12));
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(sw * 0.3, y, r, 0, Math.PI * 2); ctx.fill();
  });
}
function pDeadTree(ctx, u, seed, t) {
  const s = u * 0.018, h = (22 + rnd(seed) * 8) * s, sw = Math.sin(t * 0.025 + seed * 0.08) * 1.5 * s;
  ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 3.2 * s; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sw, -h); ctx.stroke();
  [[0.35, 0.62, 1], [0.55, 0.46, -1], [0.72, 0.34, 1]].forEach(([ty, tx, sg]) => { const bx = sw * ty, by = -h * tx, bl = (8 + rnd(seed + ty * 9) * 5) * s; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + sg * bl * 0.9, by - bl * 0.5); ctx.stroke(); });
}
function pRock(ctx, u, seed) {
  const s = u * 0.02;
  [{ x: 0, y: 0, rx: 8, ry: 5 }, { x: 5, y: 1, rx: 5.5, ry: 3.5 }, { x: -3.5, y: 1.5, rx: 4.5, ry: 2.8 }].forEach(r => {
    ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(r.x * s, 1 * s, r.rx * s * 1.1, r.ry * s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    const rg = ctx.createLinearGradient((r.x - r.rx) * s, r.y * s, (r.x + r.rx) * s, r.y * s); rg.addColorStop(0, "#7a7870"); rg.addColorStop(0.4, "#9a9890"); rg.addColorStop(1, "#5a5850");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(r.x * s, -r.ry * s * 0.4, r.rx * s, r.ry * s, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.beginPath(); ctx.ellipse((r.x - r.rx * 0.3) * s, (-r.ry * 0.8) * s, r.rx * s * 0.4, r.ry * s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  });
}
function pFlower(ctx, u, seed, t) {
  const s = u * 0.018, sway = Math.sin(t * 0.04 + seed * 0.2) * 1.5 * s, h = (8 + rnd(seed) * 3) * s;
  ctx.strokeStyle = "#3a6018"; ctx.lineWidth = Math.max(0.5, s * 0.7); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sway * 0.5, -h * 0.5, sway, -h); ctx.stroke();
  const fc = ["#e04080", "#e0a020", "#c040c0", "#4080e0"][Math.floor(rnd(seed + 3) * 4)];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.fillStyle = fc; ctx.beginPath(); ctx.ellipse(sway + Math.cos(a) * 3 * s, -h + Math.sin(a) * 3 * s, 2.5 * s, 1.5 * s, a, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#f0e040"; ctx.beginPath(); ctx.arc(sway, -h, 1.8 * s, 0, Math.PI * 2); ctx.fill();
}
function pCactus(ctx, u, seed) {
  const s = u * 0.018, h = (18 + rnd(seed) * 6) * s;
  ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(0, 0, 6 * s, 2.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a7020"; ctx.fillRect(-3 * s, -h, 6 * s, h); ctx.fillStyle = "#4a8828"; ctx.fillRect(-2 * s, -h, 4 * s, h);
  [[-0.55, 0.35, -1], [-0.72, 0.55, 1]].forEach(([ty, ht, side]) => { ctx.fillStyle = "#3a7020"; ctx.fillRect(side * 3 * s, -h * ty, side * 5 * s, 3 * s); ctx.fillRect(side * 8 * s - side * 3 * s, -h * ty, 3 * s, h * ht); });
}

// ════════ โมเดลสถานที่ (ZONE 3D MODELS) ════════
// faces เป็นพิกัด "local" รอบจุด (0,0) — drawZoneModel จะเลื่อนไปตำแหน่งช่องเอง
// ทิศแสงในโลก (คงที่ ไม่หมุนตามกล้อง)
const ZL = (() => { const v = [-0.55, 0.78, -0.83], m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();
// ความสูง (world) ของยอดโมเดลแต่ละหมวด — ใช้วางไอคอน/ป้ายชื่อให้ลอยพอดี
const ZONE_TOP = { royal: 1.25, magic: 1.95, intel: 1.95, holy: 0.95, faction: 0.85, ambush: 0.85, shop: 0.7, safe: 0.7, resource: 0.7, danger: 0.95, dark: 0.95, loot: 1.0, quest: 1.0, special: 1.0 };

function darken(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0, g = Math.min(255, ((n >> 8) & 255) * f) | 0, b = Math.min(255, (n & 255) * f) | 0;
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
// แปลงจุด [x,y,z] → face พร้อม normal (สำหรับคำนวณแสง)
function zface(arr, color) {
  const pts = arr.map(a => ({ x: a[0], y: a[1], z: a[2] }));
  const a = pts[0], b = pts[1], c = pts[2];
  let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const m = Math.hypot(nx, ny, nz) || 1;
  return { pts, nx: nx / m, ny: ny / m, nz: nz / m, color };
}
function mkBox(out, x, z, by, w, d, h, color) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y0 = by, y1 = by + h;
  out.push(zface([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], color)); // บน
  out.push(zface([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color)); // +z
  out.push(zface([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], color)); // -z
  out.push(zface([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], color)); // +x
  out.push(zface([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color)); // -x
}
function mkPyr(out, x, z, by, w, h, color) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - w / 2, z1 = z + w / 2, ax = x, ay = by + h, az = z;
  out.push(zface([[x0, by, z1], [x1, by, z1], [ax, ay, az]], color));
  out.push(zface([[x1, by, z1], [x1, by, z0], [ax, ay, az]], color));
  out.push(zface([[x1, by, z0], [x0, by, z0], [ax, ay, az]], color));
  out.push(zface([[x0, by, z0], [x0, by, z1], [ax, ay, az]], color));
}
function mkPrism(out, x, z, by, w, d, h, color) { // จั่ว/เต็นท์ สันยาวตามแกน z
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, ry = by + h;
  out.push(zface([[x0, by, z0], [x0, by, z1], [x, ry, z1], [x, ry, z0]], color));
  out.push(zface([[x1, by, z1], [x1, by, z0], [x, ry, z0], [x, ry, z1]], color));
  out.push(zface([[x0, by, z1], [x1, by, z1], [x, ry, z1]], color));
  out.push(zface([[x1, by, z0], [x0, by, z0], [x, ry, z0]], color));
}
function mkQuad(out, arr, color) { out.push(zface(arr, color)); }

// ── archetype ตามหมวดของสถานที่ ── (สีอิงจาก zone.color เพื่อคงเอกลักษณ์เดิม)
function zCastle(out, by, col) {
  const wall = darken(col, 0.82), base = darken(col, 0.58), roof = darken(col, 1.0);
  mkBox(out, 0, 0, by, 0.5, 0.5, 0.5, wall);
  for (const dx of [-0.2, 0, 0.2]) for (const dz of [-0.2, 0.2]) mkBox(out, dx, dz, by + 0.5, 0.08, 0.08, 0.1, wall);
  for (const [tx, tz] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) { mkBox(out, tx, tz, by, 0.16, 0.16, 0.7, base); mkPyr(out, tx, tz, by + 0.7, 0.22, 0.26, roof); }
  mkBox(out, 0, 0.25, by, 0.16, 0.06, 0.3, darken(col, 0.4));
  mkBox(out, 0, 0, by + 0.5, 0.025, 0.025, 0.42, "#3a3228");
  mkQuad(out, [[0.012, by + 0.92, 0], [0.012, by + 0.8, 0], [0.24, by + 0.84, 0], [0.24, by + 0.96, 0]], roof);
}
function zTower(out, by, col) {
  const a = darken(col, 0.7), b = darken(col, 0.86), roof = darken(col, 1.05);
  mkBox(out, 0, 0, by, 0.34, 0.34, 0.5, a);
  mkBox(out, 0, 0, by + 0.5, 0.28, 0.28, 0.45, b);
  mkBox(out, 0, 0, by + 0.95, 0.22, 0.22, 0.35, a);
  for (const [wx, wz] of [[0, 0.115], [0.115, 0], [0, -0.115]]) mkBox(out, wx, wz, by + 0.62, 0.05, 0.05, 0.1, "#ffe070");
  mkPyr(out, 0, 0, by + 1.3, 0.32, 0.5, roof);
}
function zCamp(out, by, col) {
  const t = darken(col, 0.8);
  for (const [tx, tz] of [[-0.24, -0.1], [0.24, -0.05], [0, 0.26]]) mkPrism(out, tx, tz, by, 0.3, 0.36, 0.3, t);
  mkBox(out, 0, -0.05, by, 0.1, 0.1, 0.04, "#3a2a18");
  mkBox(out, 0, -0.05, by + 0.04, 0.05, 0.05, 0.13, "#e0843c");
  mkBox(out, -0.34, 0.2, by, 0.03, 0.03, 0.6, "#4a3320");
  mkQuad(out, [[-0.325, by + 0.5, 0.2], [-0.325, by + 0.38, 0.2], [-0.14, by + 0.42, 0.2], [-0.14, by + 0.54, 0.2]], darken(col, 1.0));
}
function zMarket(out, by, col) {
  const w = darken(col, 0.6), aw = darken(col, 1.0); let k = 0;
  for (const [sx, sz] of [[-0.26, -0.1], [0.26, -0.05], [0, 0.26]]) {
    mkBox(out, sx, sz, by, 0.26, 0.26, 0.24, w);
    mkQuad(out, [[sx - 0.17, by + 0.4, sz - 0.17], [sx - 0.17, by + 0.4, sz + 0.17], [sx + 0.17, by + 0.3, sz + 0.17], [sx + 0.17, by + 0.3, sz - 0.17]], k % 2 ? "#e8e0d0" : aw);
    mkBox(out, sx, sz, by + 0.24, 0.16, 0.16, 0.1, darken(col, 0.8)); k++;
  }
}
function zVillage(out, by, col) {
  const wall = darken(col, 0.85), roof = darken(col, 0.6);
  for (const [hx, hz, w, h] of [[-0.26, -0.14, 0.26, 0.26], [0.24, 0.18, 0.28, 0.28], [0, 0.28, 0.24, 0.22]]) {
    mkBox(out, hx, hz, by, w, w, h, wall); mkPrism(out, hx, hz, by + h, w + 0.03, w + 0.03, 0.16, roof);
  }
}
function zDanger(out, by, col) {
  const r = darken(col, 0.75), d = darken(col, 0.45);
  mkBox(out, 0, 0, by, 0.4, 0.4, 0.28, d);
  for (const [sx, sz, h] of [[0, 0, 0.45], [-0.16, 0.1, 0.3], [0.16, -0.08, 0.28]]) mkPyr(out, sx, sz, by + 0.28, 0.22, h, r);
}
function zShrine(out, by, col) {
  const p = darken(col, 0.9), beam = darken(col, 1.0);
  mkBox(out, -0.18, 0, by, 0.06, 0.06, 0.55, p);
  mkBox(out, 0.18, 0, by, 0.06, 0.06, 0.55, p);
  mkBox(out, 0, 0, by + 0.55, 0.52, 0.08, 0.07, beam);
  mkBox(out, 0, 0, by + 0.44, 0.46, 0.05, 0.05, beam);
  mkBox(out, 0, 0, by, 0.16, 0.16, 0.12, darken(col, 0.6));
}
function zMonument(out, by, col) {
  const a = darken(col, 0.78), b = darken(col, 0.55);
  mkBox(out, 0, 0, by, 0.32, 0.32, 0.12, b);
  mkBox(out, 0, 0, by + 0.12, 0.18, 0.18, 0.5, a);
  mkPyr(out, 0, 0, by + 0.62, 0.2, 0.22, darken(col, 1.0));
}
const ZARCH = {
  royal: zCastle, magic: zTower, intel: zTower, faction: zCamp, ambush: zCamp,
  shop: zMarket, safe: zVillage, resource: zVillage, holy: zShrine,
  danger: zDanger, dark: zDanger, loot: zMonument, quest: zMonument, special: zMonument,
};
function buildZoneModel(cat, by, col) { const out = []; (ZARCH[cat] || zMonument)(out, by, col); return out; }
function zoneFastFaces(by, col) { const out = []; mkBox(out, 0, 0, by, 0.42, 0.42, 0.7, col); return out; }
