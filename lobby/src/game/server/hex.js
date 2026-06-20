// ─── TERRAIN MOVEMENT + GRID DISTANCE (server authority) ──────────────────────
//   SQUARE grid, 8 ทิศ (เดินทแยงได้). น้ำผ่านได้แต่ต้นทุนสูง (ไม่ใช่กำแพง).
//   ระยะ = Chebyshev distance (ตรงกับ client hexMath).

export const TERRAIN_MOVE_COST = { plains: 1, forest: 2, mountain: 3, water: 3, desert: 2, swamp: 3 };

export const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function getNeighborKeys(col, row, cellMap, blockWater = true) {
  return DIRS8
    .map(([dc, dr]) => `${col + dc},${row + dr}`)
    .filter(k => cellMap[k] && (!blockWater || cellMap[k].terrain !== "water"));
}

// คืน Map ของ key → ต้นทุนการเดินที่ถูกที่สุด (ใช้ตรวจระยะ + หักงบเดิน)
export function getReachableCostMap(startCol, startRow, steps, cells) {
  const cellMap = {};
  for (const c of cells) cellMap[c.key] = c;
  const visited = new Map();
  const startKey = `${startCol},${startRow}`;
  visited.set(startKey, 0);
  const queue = [{ key: startKey, cost: 0 }];
  while (queue.length > 0) {
    const { key, cost } = queue.shift();
    const cell = cellMap[key];
    if (!cell) continue;
    for (const nk of getNeighborKeys(cell.col, cell.row, cellMap, false)) {
      const neighbor = cellMap[nk];
      if (!neighbor) continue;
      const moveCost = TERRAIN_MOVE_COST[neighbor.terrain] || 1;
      const newCost = cost + moveCost;
      if (newCost <= steps && (!visited.has(nk) || visited.get(nk) > newCost)) {
        visited.set(nk, newCost);
        queue.push({ key: nk, cost: newCost });
      }
    }
  }
  visited.delete(startKey);
  return visited;
}

export function getReachableServer(startCol, startRow, steps, cells) {
  return new Set(getReachableCostMap(startCol, startRow, steps, cells).keys());
}

export function hexDistanceServer(aCol, aRow, bCol, bRow) {
  // SQUARE grid 8 ทิศ → Chebyshev distance
  return Math.max(Math.abs(aCol - bCol), Math.abs(aRow - bRow));
}
