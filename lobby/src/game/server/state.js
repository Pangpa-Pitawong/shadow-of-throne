// ─── Shared server state ──────────────────────────────────────────────────────
//   rooms : code → room object (lobby + gameState)
//   clients : ws → { code, playerIdx }
//   These are process-global maps shared across every server module.
export const rooms = {};
export const clients = new Map();
