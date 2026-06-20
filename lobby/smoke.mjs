// Seeded behavioral snapshot of the game engine — refactor safety net.
// Runs createInitialGameState() + a scripted game over several RNG seeds with
// deterministic RNG, and prints a stable signature (timestamps/uids stripped).
// The hash MUST stay identical across behavior-preserving refactors.
// Usage: SOT_TEST=1 node smoke.mjs
import crypto from "crypto";

function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realRandom = Math.random;
let _clock = 1_700_000_000_000;
Date.now = () => (_clock += 1);

const { createInitialGameState, handleGameAction, rooms, clients } =
  await import("./server.js");

function strip(obj) {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj).sort()) {
      if (k === "uid" || k === "ts" || k === "_code" || k === "_interruptTimer") continue;
      out[k] = strip(obj[k]);
    }
    return out;
  }
  return obj;
}

function runScenario(seed) {
  Math.random = seededRandom(seed);
  const CHARS = ["sunwu", "icemage", "archer", "cleric", "assassin", "guardian"];
  const ROLES = ["king", "rebel", "commoner", "commoner", "rebel", "commoner"];
  const n = 5 + (seed % 2); // 5 or 6 players
  const room = {
    code: "SOT-" + seed, mode: "standard", roles: ROLES.slice(0, n),
    mapConfig: { size: "medium", random: false, zoneDensity: 1, dangerZones: true, shops: true,
      terrain: { forest: 1, mountain: 1, desert: 1, swamp: 1, water: 1 } },
    players: CHARS.slice(0, n).map((charId, i) => ({ name: `P${i}`, charId, class: charId, idx: i })),
  };
  const gs = createInitialGameState(room);
  room.gameState = gs; gs._code = room.code; rooms[room.code] = room;
  const fakeWs = gs.players.map((p, i) => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(s); } };
    clients.set(ws, { code: room.code, playerIdx: i });
    return ws;
  });

  let turns = 0;
  while (!gs.gameOver && turns < 300) {
    // resolve any pending traitor offer (accept) so the game progresses
    if (gs.traitorOfferPending) {
      const t = gs.traitorOfferTarget;
      handleGameAction(fakeWs[t] || fakeWs[0], { action: "noop", payload: {} });
      const gs2 = rooms[room.code].gameState;
      // simulate traitor_response accept via the server's resolver path
      if (gs2.traitorOfferPending) {
        // mirror server.js traitor_response handling
        gs2.traitorOfferPending = false;
        const traitor = gs2.players[gs2.traitorOfferTarget];
        if (traitor && traitor.alive) { traitor.role = "traitor"; traitor.revealed = false; }
        gs2.players.forEach(p => { if (p.alive && p.role === "commoner") p.role = "rebel"; });
      }
      continue;
    }
    const cur = gs.currentTurn;
    const cp = gs.players[cur];
    let guard = 0;
    while (cp.pendingDiscard > 0 && cp.hand.length && guard++ < 20) {
      handleGameAction(fakeWs[cur], { action: "discard_card", payload: { cardUid: cp.hand[0].uid } });
    }
    handleGameAction(fakeWs[cur], { action: "end_turn", payload: {} });
    turns++;
  }

  return strip({
    seed, players: gs.players.length, mapCols: gs.mapCols, mapRows: gs.mapRows,
    turnOrder: gs.turnOrder, cellCount: gs.cells.length,
    cellsSummary: gs.cells.map(c => `${c.key}:${c.terrain}:${c.biome}:${c.elev}:${c.specialZone || ""}`),
    turnsRun: turns, phaseEnd: gs.phase, bossLevel: gs.bossLevel,
    gameOver: gs.gameOver ? { winner: gs.gameOver.winner, n: gs.gameOver.players.length } : null,
    finalHp: gs.players.map(p => `${p.name}:${p.hp}:${p.alive ? 1 : 0}:${p.role}:${p.gold}`),
    logCount: gs.log.length,
  });
}

const sigs = [101, 202, 303, 404].map(runScenario);
Math.random = realRandom;

const json = JSON.stringify(sigs);
const hash = crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
console.log("MULTI_SIG_HASH=" + hash);
for (const s of sigs) {
  console.log(`seed=${s.seed} players=${s.players} turns=${s.turnsRun} phase=${s.phaseEnd} ` +
    `boss=${s.bossLevel} over=${JSON.stringify(s.gameOver)} log=${s.logCount}`);
}
process.exit(0);
