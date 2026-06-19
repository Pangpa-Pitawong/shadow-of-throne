// src/game/utils/hexMath.js

export function hexToPixel(col, row, size = 52) {
  const w = size * 2;
  const h = Math.sqrt(3) * size;
  const x = col * (w * 0.75) + 60;
  const y = row * h + (col % 2 === 1 ? h / 2 : 0) + 50;
  return { x, y };
}

export function hexPoints(cx, cy, size) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return points.join(" ");
}

// ── SQUARE GRID 8 ทิศ (Chebyshev) — ระยะ = max(|dCol|,|dRow|) เดินทแยงได้ ──
export function hexDistance(a, b) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function getNeighbors(col, row, cells) {
  // เดินได้ทุกช่อง (น้ำผ่านได้ ต้นทุนสูง) — 8 ทิศบน square grid
  return DIRS8
    .map(([dc, dr]) => cells.find(c => c.col === col + dc && c.row === row + dr))
    .filter(Boolean);
}

// คืน Map ของ key → ต้นทุนเดินที่ถูกที่สุดจาก startCell (ไม่จำกัดงบ)
// ใช้สำหรับโชว์ "ต้องใช้กี่งบเดิน" เมื่อเอาเมาส์ชี้ช่อง
export function getCostMap(startCell, cells, TERRAIN) {
  const visited = new Map([[startCell.key, 0]]);
  const queue = [startCell];
  while (queue.length) {
    const cell = queue.shift();
    const base = visited.get(cell.key);
    for (const n of getNeighbors(cell.col, cell.row, cells)) {
      const moveCost = TERRAIN[n.terrain]?.moveCost ?? 1;
      const nc = base + moveCost;
      if (!visited.has(n.key) || visited.get(n.key) > nc) {
        visited.set(n.key, nc);
        queue.push(n); // re-push เมื่อเจอเส้นทางถูกกว่า → ได้ค่าที่สั้นที่สุดในที่สุด
      }
    }
  }
  return visited;
}

// ✅ แก้: รับ TERRAIN เป็น parameter แทน dynamic import
export function getReachable(startCell, steps, cells, TERRAIN) {
  if (steps <= 0) return [];
  const visited = new Map([[startCell.key, 0]]);
  const queue = [{ cell: startCell, steps: 0 }];
  const reachableSet = new Set();

  while (queue.length) {
    const { cell, steps: s } = queue.shift();
    if (s >= steps) continue;
    const neighbors = getNeighbors(cell.col, cell.row, cells);
    for (const n of neighbors) {
      const moveCost = TERRAIN[n.terrain]?.moveCost ?? 1;
      const newSteps = s + moveCost;
      if (newSteps <= steps) {
        const prev = visited.get(n.key);
        if (prev === undefined || prev > newSteps) {
          visited.set(n.key, newSteps);
          reachableSet.add(n);
          queue.push({ cell: n, steps: newSteps });
        }
      }
    }
  }
  return [...reachableSet];
}