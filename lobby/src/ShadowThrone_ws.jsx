import { useState, useEffect, useRef, useCallback } from "react";
import GameBoard from "./game/components/GameBoard";
import "./lobby/lobby.css";
import { WS_URL, warmServer } from "./lobby/wsConfig";
import { ROLES } from "./game/constants/roles";
import { CHARACTERS } from "./game/constants/characters";
import CharIcon from "./game/components/CharIcon.jsx";

// ─── MAP CONFIG helpers ──────────────────────────────────────────────────────
const TERRAIN_LABELS = {
  forest: "🌲 ป่า", mountain: "⛰️ ภูเขา", desert: "🏜️ ทะเลทราย",
  swamp: "🥾 บึง", water: "🌊 น้ำ",
};
const AMT_LABELS = ["น้อย", "ปกติ", "มาก"];
const DENSITY_LABELS = ["น้อย", "ปกติ", "มาก"];

// จำนวนสถานที่พิเศษบนแมพ (ต้องตรงกับ logic ใน server.js createInitialGameState)
//   โซนหลัก 6 (มีเสมอ) · อันตราย 6 · ร้านค้า 4 · เสริม 8 = สูงสุด 24 จุด
const ZONE_GROUPS = { core: 6, danger: 6, shop: 4, extra: 8 };
function zoneCountEstimate(cfg) {
  const p = cfg.zoneDensity === 0 ? 0.4 : cfg.zoneDensity === 2 ? 1 : 0.78;
  const shopP = Math.max(p, 0.6);
  const core = ZONE_GROUPS.core;
  const danger = cfg.dangerZones ? Math.round(ZONE_GROUPS.danger * p) : 0;
  const shop = cfg.shops ? Math.round(ZONE_GROUPS.shop * shopP) : 0;
  const extra = Math.round(ZONE_GROUPS.extra * p);
  const expected = core + danger + shop + extra;
  const max = core + (cfg.dangerZones ? ZONE_GROUPS.danger : 0) + (cfg.shops ? ZONE_GROUPS.shop : 0) + ZONE_GROUPS.extra;
  return { expected, max, core, danger, shop, extra };
}

// สรุปการตั้งค่าแมพเป็นข้อความสั้นๆ (โชว์ในล็อบบี้/หน้าเข้าร่วม)
function mapCfgSummary(cfg) {
  if (!cfg) return null;
  if (cfg.random) return ["🎲 ภูมิประเทศ: สุ่มทั้งหมด"];
  const lines = [];
  const more = [], less = [];
  for (const [k, lbl] of Object.entries(TERRAIN_LABELS)) {
    const a = cfg.terrain?.[k] ?? 1;
    if (a === 2) more.push(lbl);
    else if (a === 0) less.push(lbl);
  }
  if (more.length) lines.push("เยอะ: " + more.join(" "));
  if (less.length) lines.push("น้อย: " + less.join(" "));
  if (!more.length && !less.length) lines.push("ภูมิประเทศ: สมดุล");
  const z = zoneCountEstimate(cfg);
  lines.push(`สถานที่พิเศษ: ${DENSITY_LABELS[cfg.zoneDensity ?? 1]} (≈ ${z.expected} จุด)` +
    (cfg.dangerZones === false ? " · ปิดโซนอันตราย" : "") +
    (cfg.shops === false ? " · ปิดร้านค้า" : ""));
  return lines;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ShadowThrone() {
  // ── Screen state ──────────────────────────────────────────────────────────
  const [screen, setScreen] = useState("title");
  const [tab, setTab] = useState("browse");

  const screenRef = useRef("title");

  const goScreen = useCallback((s) => {
    screenRef.current = s;
    setScreen(s);
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const wsRef = useRef(null);
  const [wsStatus, setWsStatus] = useState("connecting");

  // ── Identity ──────────────────────────────────────────────────────────────
  const [myName, setMyName] = useState("");
  const [myClass, setMyClass] = useState(""); // charId ที่เลือก

  // ── Traitor Offer ─────────────────────────────────────────────────────────
  const [traitorOffer, setTraitorOffer] = useState(null); // { countdown } | null
  const traitorTimerRef = useRef(null);
  const myNameRef = useRef(""); // stable ref to avoid stale closure bugs

  // ── Room state ────────────────────────────────────────────────────────────
  const [room, _setRoom] = useState(null);
  const roomRef = useRef(null);
  const setRoom = (r) => { roomRef.current = r; _setRoom(r); };

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");

  // ── Create form ───────────────────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newCount, setNewCount] = useState(4);
  const [newMode, setNewMode] = useState("standard");
  const [newVis, setNewVis] = useState("public"); // "public" | "private"

  // ── Map config (ตั้งค่าภูมิประเทศ/สถานที่ตอนสร้างห้อง) ─────────────────────
  const [mapCfg, setMapCfg] = useState({
    random: false,
    terrain: { forest: 1, mountain: 1, desert: 1, swamp: 1, water: 1 },
    zoneDensity: 1,
    dangerZones: true,
    shops: true,
  });
  const setTerrainAmt = (key, v) =>
    setMapCfg(c => ({ ...c, terrain: { ...c.terrain, [key]: v } }));

  // ── Join form ─────────────────────────────────────────────────────────────
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  // ── Browse-room inline name modal ─────────────────────────────────────────
  const [joinModal, setJoinModal] = useState(null); // { code, hostName } | null
  const [joinModalName, setJoinModalName] = useState("");

  // ── Role reveal ───────────────────────────────────────────────────────────
  const [flipped, setFlipped] = useState(false);
  const [myRole, setMyRole] = useState(null);
  const [roleConfirmed, setRoleConfirmed] = useState(false); // I confirmed
  const [allRolesReady, setAllRolesReady] = useState(false); // everyone confirmed

  // ── Character select (after role reveal) ───────────────────────────────────
  const [charConfirmed, setCharConfirmed] = useState(false); // I locked my character

  // ── Server Config (สำหรับ Cloudflare Tunnel) ─────────────────────────────
  const [serverUrlInput, setServerUrlInput] = useState(
    (() => { try { return localStorage.getItem("sot_ws_url") || ""; } catch { return ""; } })()
  );
  const [showServerConfig, setShowServerConfig] = useState(false);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState({ msg: "", show: false });
  const showToast = useCallback((msg) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2600);
  }, []);

  // ── WebSocket connection with auto-reconnect ───────────────────────────────
  const wsSend = useCallback((data) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
  }, []);

  useEffect(() => {
    let alive = true;
    let ws;
    let reconnectTimer;
    let retryDelay = 2000; // เริ่มที่ 2 วินาที
    let attempts = 0;      // นับครั้งที่ลองต่อ — ใช้แยก "cold start" ออกจาก error จริง
    let connectStart = Date.now();

    function connect() {
      if (!alive) return;
      attempts += 1;
      connectStart = Date.now();
      // ครั้งแรกที่ยังต่อไม่ติด = น่าจะ cold start (Render กำลังตื่น) → โชว์ "กำลังปลุกเซิร์ฟเวอร์"
      setWsStatus(attempts === 1 ? "connecting" : "waking");
      // ปลุกเซิร์ฟเวอร์ผ่าน HTTP คู่ขนานไปกับการต่อ WS — request ขาเข้าจะทำให้ Render ตื่น
      warmServer();
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        setWsStatus("ok");
        retryDelay = 2000;          // reset delay เมื่อเชื่อมต่อสำเร็จ
        attempts = 0;

        if (screenRef.current === "gameboard") {
          wsSend({ type: "request_game_state" });
        }
      };

      ws.onmessage = (e) => {
        if (!alive) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        switch (msg.type) {
          // ── Server assigned us a slot ──────────────────────────────────
          case "joined": {
            setRoom(msg.room);
            setLoading(false);
            // ✅ รับ "ชื่อจริง" ที่ server กำหนด (อาจถูกเติม (2)/(3) กันซ้ำ) มาเป็นตัวตนของเรา
            //    ตัวตนทั้งหมด (บทบาท/ตัวละคร/เทิร์น) หาจากชื่อ — ต้องตรงกับฝั่ง server
            const meJoined = msg.room.players?.[msg.playerIdx];
            if (meJoined?.name) { setMyName(meJoined.name); myNameRef.current = meJoined.name; }
            goScreen("lobby"); // ✅ ใช้ goScreen แทน setScreen
            showToast(msg.playerIdx === 0
              ? "✅ สร้างห้องสำเร็จ! รหัส: " + msg.room.code
              : "✅ เข้าห้องสำเร็จ!"
            );
            break;
          }

          // ── Lobby / room state changed ─────────────────────────────────
          case "room_update": {
            setRoom(msg.room);
            if (msg.room.status === "started"
              && screenRef.current !== "roles"      // ✅ ใช้ ref แทน state
              && screenRef.current !== "charselect"
              && screenRef.current !== "gameboard") {
              const myIdx = msg.room.players.findIndex(
                p => p.name === myNameRef.current
              );
              if (myIdx >= 0 && msg.room.roles) {
                setMyRole(msg.room.roles[myIdx]);
                setFlipped(false);
                setRoleConfirmed(false);
                setAllRolesReady(false);
                goScreen("roles"); // ✅ ใช้ goScreen
              }
            }
            // ทุกคนยืนยันบทบาทแล้ว → เข้าหน้าเลือกตัวละคร (พระราชาเลือกก่อน)
            if (msg.room.status === "started" && msg.room.phase === "charselect"
              && screenRef.current !== "gameboard"
              && screenRef.current !== "charselect") {
              setCharConfirmed(false);
              setMyClass("");
              goScreen("charselect");
            }
            break;
          }

          // ── Room list for browse tab ───────────────────────────────────
          case "room_list":
            setRooms(msg.rooms || []);
            break;

          // ── All players confirmed their role → open game board ─────────
          case "all_roles_ready":
            // ✅ FIX: เก็บ gameState ที่ server ส่งมาพร้อมกัน ก่อนเปลี่ยนหน้า
            //    (ไม่งั้น room.gameState จะเป็น null → GameBoard ไม่ render → จอดำ)
            if (msg.gameState) {
              setRoom(prev => prev ? { ...prev, gameState: { ...msg.gameState } } : prev);
            }
            setAllRolesReady(true);
            goScreen("gameboard"); // ✅ ใช้ goScreen
            break;

          case "kicked":
            showToast("คุณถูกเตะออกจากห้อง");
            setRoom(null); setMyClass(""); setMyRole(null);
            goScreen("title"); // ✅ ใช้ goScreen
            break;

          case "room_closed":
            showToast("⚠ " + (msg.reason === "host_left" ? "Host ออกจากห้องแล้ว" : "ห้องถูกปิด"));
            setRoom(null); setMyClass(""); setMyRole(null);
            goScreen("title"); // ✅ ใช้ goScreen
            break;

          case "game_state": {
            const gs = msg.gameState;
            if (!gs) break;
            setRoom(prev => {
              if (!prev) return prev;
              // force new reference ทุกครั้ง
              return { ...prev, gameState: { ...gs } };
            });
            break;
          }

          // ── Traitor offer (ส่งเฉพาะผู้เล่นที่ถูกเลือก) ────────────────────
          case "traitor_offer": {
            let secs = msg.timeout || 30;
            setTraitorOffer({ countdown: secs });
            if (traitorTimerRef.current) clearInterval(traitorTimerRef.current);
            traitorTimerRef.current = setInterval(() => {
              secs -= 1;
              setTraitorOffer(prev => prev ? { ...prev, countdown: secs } : null);
              if (secs <= 0) {
                clearInterval(traitorTimerRef.current);
                setTraitorOffer(null);
              }
            }, 1000);
            break;
          }

          case "error":
            showToast("❌ " + msg.msg);
            setLoading(false);
            // ถูกปฏิเสธตอนเลือก/ยืนยันตัวละคร → ล้างตัวเลือกให้เลือกใหม่
            if (screenRef.current === "charselect") {
              setCharConfirmed(false);
              setMyClass("");
            }
            break;

          default:
            break;
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        const elapsed = Date.now() - connectStart;
        // ── cold start ของ Render ใช้เวลาได้ถึง ~50 วิ ──
        //   ช่วง ~70 วินาทีแรก: ลองใหม่เร็วๆ (ทุก 2.5 วิ) เพื่อให้ต่อติดทันทีที่ server ตื่น
        //   หลังจากนั้นถือว่ามีปัญหาจริง → backoff ยาวขึ้นกันยิงถี่
        if (attempts <= 28) {
          setWsStatus("waking");
          // ถ้าเพิ่งปิดเร็วมาก (เช่น server ยังไม่ตื่น) เว้นอย่างน้อย 2.5 วิ
          retryDelay = Math.max(0, 2500 - elapsed);
        } else {
          setWsStatus("error");
          retryDelay = Math.min(Math.max(retryDelay * 1.5, 3000), 15000);
        }
        reconnectTimer = setTimeout(connect, retryDelay);
      };

      ws.onerror = () => {
        if (!alive) return;
        setWsStatus("error");
        // ไม่ต้อง reconnect ที่นี่ — onclose จะทำแทน
      };
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // ── Browse: auto-refresh when on join tab ─────────────────────────────────
  const browseRooms = useCallback(() => wsSend({ type: "list_rooms" }), [wsSend]);
  useEffect(() => {
    if (screen !== "join") return;
    browseRooms();
    const t = setInterval(browseRooms, 4000);
    return () => clearInterval(t);
  }, [screen, browseRooms]);

  // ── Safety net: ถ้าเข้าหน้า gameboard แล้วแต่ยังไม่มี gameState → ขอซ้ำ ──────
  useEffect(() => {
    if (screen !== "gameboard" || !allRolesReady) return;
    if (room?.gameState) return;
    wsSend({ type: "request_game_state" });
    const t = setInterval(() => wsSend({ type: "request_game_state" }), 1500);
    return () => clearInterval(t);
  }, [screen, allRolesReady, room?.gameState, wsSend]);

  // ── Save Server URL ───────────────────────────────────────────────────────
  const saveServerUrl = () => {
    try {
      const url = serverUrlInput.trim();
      if (url) {
        localStorage.setItem("sot_ws_url", url);
      } else {
        localStorage.removeItem("sot_ws_url");
      }
      window.location.reload();
    } catch { /* localStorage ไม่พร้อมใช้งาน — ข้าม */ }
  };

  // ─── ACTIONS ──────────────────────────────────────────────────────────────
  const saveName = (name) => {
    const n = name.trim();
    setMyName(n);
    myNameRef.current = n;
  };

  const createRoom = () => {
    const name = newName.trim() || "ผู้เล่น 1";
    saveName(name);
    setLoading(true);
    setLoadMsg("กำลังสร้างห้อง...");
    setMyClass("");
    // NOTE: code is generated SERVER-SIDE now — do NOT send a code
    wsSend({ type: "create_room", playerName: name, maxPlayers: newCount, mode: newMode, visibility: newVis, mapConfig: mapCfg });
  };

  const joinRoom = (codeArg, nameArg) => {
    const code = (codeArg || joinCode).trim().toUpperCase();
    const name = (nameArg || joinName).trim() || "ผู้เล่น";
    if (!code) { showToast("กรอกรหัสห้องก่อน"); return; }
    saveName(name);
    setLoading(true);
    setLoadMsg("กำลังเข้าร่วมห้อง...");
    setMyClass("");
    wsSend({ type: "join_room", code, playerName: name });
  };

  const pickClass = (charId) => {
    setMyClass(charId);
    setCharConfirmed(false); // เปลี่ยนตัวละคร → ยกเลิกการยืนยันเดิม
    // ส่งทั้ง 2 format เพื่อ compat กับ server ทั้งเก่าและใหม่
    wsSend({ type: "pick_class", classId: charId });
    wsSend({ type: "pick_character", charId });
  };

  // ยืนยันตัวละคร (ขั้นเลือกตัวละครหลังเปิดบทบาท)
  const confirmCharacter = () => {
    if (!myClass) { showToast("เลือกตัวละครก่อน"); return; }
    setCharConfirmed(true);
    wsSend({ type: "confirm_character" });
  };

  const respondTraitorOffer = (accepted) => {
    if (traitorTimerRef.current) clearInterval(traitorTimerRef.current);
    setTraitorOffer(null);
    wsSend({ type: "traitor_response", accepted });
  };

  const toggleReady = () => {
    // ล็อบบี้ใหม่: กดพร้อมได้เลย — เลือกตัวละครย้ายไปหลังสุ่มบทบาท
    wsSend({ type: "toggle_ready" });
  };

  const startGame = () => wsSend({ type: "start_game" });
  const kickPlayer = (idx) => wsSend({ type: "kick_player", playerIdx: idx });

  // FIX: proper leave — notify server first so it can clean up
  const leaveRoom = () => {
    wsSend({ type: "leave_room" });
    setRoom(null);
    setMyClass("");
    setMyRole(null);
    setRoleConfirmed(false);
    setAllRolesReady(false);
    setCharConfirmed(false);
    goScreen("title");
  };

  // ── Role reveal confirm ────────────────────────────────────────────────────
  // FIX: each player confirms independently; server tracks progress
  const confirmRole = () => {
    if (!roleConfirmed) {
      setRoleConfirmed(true);
      wsSend({ type: "role_confirmed", playerName: myNameRef.current });
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const players = room?.players || [];
  const myIdx = players.findIndex(p => p.name === myName);
  const isHost = myIdx === 0;
  const readyCount = players.filter(p => p.ready || p.host).length;
  const rolesReadyList = room?.rolesReady || [];

  const roleDef = myRole ? ROLES[myRole] : null;

  // ── WS status badge ───────────────────────────────────────────────────────
  const wsBadge =
    wsStatus === "ok" ? <span className="ws-badge ws-ok">● เชื่อมต่อแล้ว</span>
      : wsStatus === "connecting" ? <span className="ws-badge ws-connecting">○ กำลังเชื่อมต่อ...</span>
        : wsStatus === "waking" ? <span className="ws-badge ws-connecting">🔌 กำลังปลุกเซิร์ฟเวอร์ (~30 วิ)...</span>
          : <span className="ws-badge ws-err">✕ เชื่อมต่อไม่ได้ — ตรวจอินเทอร์เน็ต/ลองรีโหลด</span>;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* LOADING */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-txt">{loadMsg}</div>
        </div>
      )}

      {/* TOAST */}
      <div className={`toast${toast.show ? "" : " hide"}`}>{toast.msg}</div>

      {/* ── JOIN NAME MODAL (browse tab) ──────────────────────────── */}
      {joinModal && (
        <div className="name-modal-backdrop" onClick={() => setJoinModal(null)}>
          <div className="name-modal" onClick={e => e.stopPropagation()}>
            <span className="nm-room-ico">🏰</span>
            <div className="nm-room-code">{joinModal.code}</div>
            <div className="nm-room-host">
              👑 {joinModal.hostName} &ensp;·&ensp;
              {joinModal.mode === "quick" ? "โหมดด่วน" : joinModal.mode === "epic" ? "มหากาพย์" : "มาตรฐาน"}
              &ensp;·&ensp; {joinModal.players}/{joinModal.maxPlayers} คน
            </div>
            {joinModal.mapConfig && (
              <div className="mc-summary" style={{ textAlign: "left", margin: "10px 0 0" }}>
                <b>🗺️ แผนที่:</b>
                {(mapCfgSummary(joinModal.mapConfig) || []).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            <div className="nm-divider" />
            <div className="nm-label">ชื่อที่ใช้ในเกม</div>
            <div className="nm-input-wrap">
              <input
                autoFocus
                value={joinModalName}
                onChange={e => setJoinModalName(e.target.value.slice(0, 12))}
                placeholder="กรอกชื่อของคุณ..."
                onKeyDown={e => {
                  if (e.key === "Enter" && joinModalName.trim()) {
                    const name = joinModalName.trim();
                    setJoinModal(null);
                    setJoinName(name);
                    joinRoom(joinModal.code, name);
                  }
                  if (e.key === "Escape") setJoinModal(null);
                }}
              />
              <span className="nm-char-count">{joinModalName.length}/12</span>
            </div>
            <div className="nm-actions">
              <button className="nm-cancel" onClick={() => setJoinModal(null)}>ยกเลิก</button>
              <button
                className="btn b-gold"
                disabled={!joinModalName.trim() || wsStatus !== "ok"}
                onClick={() => {
                  const name = joinModalName.trim();
                  setJoinModal(null);
                  setJoinName(name);
                  joinRoom(joinModal.code, name);
                }}
              >
                เข้าร่วม ⚔️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ TITLE ═══════════════════ */}
      <div id="t" className={`screen${screen === "title" ? " on" : ""}`}>
        <div className="stars" />
        <div className="twrap">
          <span className="crown">♛</span>
          <h1 className="tmain">บัลลังก์เงา</h1>
          <div className="tsub">Shadow of Throne</div>
          <div className="divl" />
          <p className="lore">ในยุคแห่งความแตกแยก บัลลังก์รอผู้พิชิต<br />ใช้เล่ห์เหลี่ยม อาวุธ เวทย์มนตร์ และโชคชะตา</p>
          <div style={{ marginBottom: "16px" }}>
            {wsBadge}
            <div style={{ marginTop: "8px" }}>
              {/* <button
                  className="b-sm"
                  onClick={() => setShowServerConfig(v => !v)}
                  style={{ fontSize: "10px" }}
                >
                  🌐 {showServerConfig ? "ซ่อน" : "ตั้งค่า"} Server URL
                </button> */}
            </div>
            {showServerConfig && (
              <div style={{
                marginTop: "10px",
                background: "var(--s3)",
                border: "1px solid rgba(201,168,76,.2)",
                borderRadius: "10px",
                padding: "14px",
                maxWidth: "340px",
                width: "100%",
                textAlign: "left",
              }}>
                <div style={{ fontSize: "11px", color: "var(--gold)", marginBottom: "6px", fontFamily: "'Cinzel',serif" }}>
                  🌐 Server URL (สำหรับเล่นข้ามอินเทอร์เน็ต)
                </div>
                <div style={{ fontSize: "10px", color: "var(--txt-m)", marginBottom: "8px", lineHeight: 1.8 }}>
                  <b style={{ color: "var(--gold)" }}>วิธีเล่นข้ามอินเทอร์เน็ต:</b><br />
                  1️⃣ host รัน <code style={{ color: "var(--gold-l)", fontSize: "9px" }}>cloudflared tunnel --url http://localhost:3001</code><br />
                  2️⃣ คัดลอก URL ที่ได้ เช่น <code style={{ color: "var(--gold-l)", fontSize: "9px" }}>https://abc.trycloudflare.com</code><br />
                  3️⃣ ใส่ด้านล่างนี้เป็น <code style={{ color: "var(--gold-l)", fontSize: "9px" }}>wss://abc.trycloudflare.com</code><br />
                  4️⃣ กด "บันทึก" แล้วส่งลิงก์แชร์ให้เพื่อน ✨
                </div>
                <input
                  value={serverUrlInput}
                  onChange={e => setServerUrlInput(e.target.value)}
                  placeholder="wss://xxx.trycloudflare.com/ws  (หรือเว้นว่าง)"
                  style={{ marginBottom: "8px", fontSize: "11px" }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="btn b-gold"
                    style={{ flex: 1, padding: "8px", fontSize: "11px" }}
                    onClick={saveServerUrl}
                  >
                    💾 บันทึก &amp; รีโหลด
                  </button>
                  {serverUrlInput && (
                    <button
                      className="b-sm"
                      onClick={() => {
                        setServerUrlInput("");
                        localStorage.removeItem("sot_ws_url");
                      }}
                      style={{ fontSize: "10px" }}
                    >
                      ✕ ล้าง
                    </button>
                  )}
                </div>
                <div style={{ marginTop: "8px", fontSize: "9px", color: "var(--txt-d)" }}>
                  URL ปัจจุบัน: {WS_URL}
                </div>
                {/* ✅ FIX 3: แสดงลิงก์แชร์สำหรับเพื่อน */}
                {WS_URL && !WS_URL.includes("localhost") && (
                  <div style={{ marginTop: "10px", background: "rgba(76,201,76,.08)", border: "1px solid rgba(76,201,76,.25)", borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "10px", color: "#4cc94c", marginBottom: "6px", fontWeight: 600 }}>
                      🔗 ลิงก์สำหรับเพื่อนต่างเน็ต
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--txt-m)", marginBottom: "6px", lineHeight: 1.6 }}>
                      ส่งลิงก์นี้ให้เพื่อน — คลิกแล้วเข้าเกมได้ทันที ไม่ต้องกรอก URL เอง
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--gold-l)", background: "rgba(0,0,0,.3)", padding: "5px 8px", borderRadius: "4px", wordBreak: "break-all", marginBottom: "6px" }}>
                      {(() => {
                        const serverHost = WS_URL.replace(/^wss?:\/\//, "").replace(/\/ws\/?$/, "");
                        return `${window.location.origin}${window.location.pathname}?server=${encodeURIComponent(serverHost)}`;
                      })()}
                    </div>
                    <button className="b-sm" style={{ width: "100%", background: "rgba(76,201,76,.2)", borderColor: "rgba(76,201,76,.4)", color: "#4cc94c" }}
                      onClick={() => {
                        const serverHost = WS_URL.replace(/^wss?:\/\//, "").replace(/\/ws\/?$/, "");
                        const shareUrl = `${window.location.origin}${window.location.pathname}?server=${encodeURIComponent(serverHost)}`;
                        navigator.clipboard?.writeText(shareUrl).catch(() => { });
                        setShowServerConfig(false);
                      }}>
                      📋 คัดลอกลิงก์
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mcards">
            <div className="mcard" onClick={() => goScreen("create")}>
              <span className="mico">🏰</span>
              <div className="mnm">สร้างห้อง</div>
              <div className="mdesc">เริ่มเกมใหม่<br />3–8 ผู้เล่น</div>
            </div>
            <div className="mcard" onClick={() => goScreen("join")}>
              <span className="mico">⚔️</span>
              <div className="mnm">หาห้อง / เข้าร่วม</div>
              <div className="mdesc">เลือกห้องสาธารณะ<br />หรือใส่รหัสส่วนตัว</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════ CREATE ROOM ═══════════════ */}
      <div id="cr" className={`screen${screen === "create" ? " on" : ""}`} style={{ overflowY: "auto" }}>
        <div style={{ maxWidth: "880px", width: "100%", padding: "20px" }}>
          <div className="lhdr" style={{ marginBottom: "20px" }}>
            <button className="b-sm" onClick={() => goScreen("title")}>← กลับ</button>
            <h2 className="cinzel" style={{ fontSize: "18px", color: "var(--gold)" }}>🏰 สร้างห้องใหม่</h2>
          </div>

          <div className="create-cols">
          <div className="sbox">
            <div className="sh">⚙ ตั้งค่าห้อง</div>

            <div className="row">
              <label>ชื่อของคุณ:</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อ Host" maxLength={12} />
            </div>
            <div className="row">
              <label>จำนวนผู้เล่น:</label>
              <select value={newCount} onChange={e => setNewCount(+e.target.value)}>
                <option value={3}>3 คน</option>
                <option value={4}>4 คน</option>
                <option value={5}>5 คน</option>
                <option value={6}>6 คน</option>
                <option value={7}>7 คน</option>
                <option value={8}>8 คน</option>
              </select>
            </div>
            <div className="row">
              <label>โหมดเกม:</label>
              <select value={newMode} onChange={e => setNewMode(e.target.value)}>
                <option value="standard">มาตรฐาน (8 เฟส)</option>
                <option value="quick">ด่วน (6 เฟส)</option>
                <option value="epic">มหากาพย์ (10 เฟส)</option>
              </select>
            </div>

            {/* ✨ NEW: visibility toggle */}
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", color: "var(--txt-m)", marginBottom: "6px" }}>ประเภทห้อง:</div>
              <div className="vis-toggle">
                <div className={`vis-opt${newVis === "public" ? " sel" : ""}`} onClick={() => setNewVis("public")}>
                  <div className="vis-ico">🌐</div>
                  <div className="vis-nm">สาธารณะ</div>
                  <div className="vis-desc">แสดงในรายการห้อง<br />ทุกคนเข้าได้</div>
                </div>
                <div className={`vis-opt${newVis === "private" ? " sel" : ""}`} onClick={() => setNewVis("private")}>
                  <div className="vis-ico">🔒</div>
                  <div className="vis-nm">ส่วนตัว</div>
                  <div className="vis-desc">ซ่อนจากรายการ<br />ต้องมีรหัสเข้า</div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: "10px", color: "var(--txt-m)", background: "rgba(201,168,76,.05)", padding: "8px 10px", borderRadius: "6px", border: "1px solid rgba(201,168,76,.15)" }}>
              🎲 รหัสห้องจะถูกสร้างโดยอัตโนมัติ — แชร์ให้เพื่อนเพื่อเข้าร่วม
            </div>
          </div>

          {/* ✨ NEW: ตั้งค่าแมพ */}
          <div className="sbox">
            <div className="sh">🗺️ ตั้งค่าแผนที่</div>

            <div className="mc-help">
              แผนที่ขนาด <b>13 × 11 = 143 ช่อง</b> · ปรับได้ว่าจะให้มีภูมิประเทศแต่ละแบบมาก/น้อยแค่ไหน
              และมีสถานที่พิเศษกี่จุด
            </div>

            <label className="mc-toggle">
              <input type="checkbox" checked={mapCfg.random}
                onChange={e => setMapCfg(c => ({ ...c, random: e.target.checked }))} />
              🎲 สุ่มทุกอย่าง (ระบบสุ่มค่าทั้งหมดให้)
            </label>

            <div className={mapCfg.random ? "mc-disabled" : ""}>
              <div style={{ fontSize: "12px", color: "var(--txt-m)", margin: "10px 0 4px", fontWeight: 600 }}>
                ปริมาณภูมิประเทศ:
              </div>
              <div className="mc-note">
                <b>น้อย</b> = พบราว ⅓ ของปกติ · <b>ปกติ</b> = สมดุล · <b>มาก</b> = พบบ่อยขึ้น ≈ 2 เท่า
                <br />(ช่องที่เหลือเป็น “ที่ราบ” เสมอ — เดินง่ายที่สุด)
              </div>
              {Object.entries(TERRAIN_LABELS).map(([key, lbl]) => (
                <div className="mc-row" key={key}>
                  <span className="mc-label">{lbl}</span>
                  <div className="seg">
                    {AMT_LABELS.map((al, i) => (
                      <button key={i}
                        className={`seg-btn${(mapCfg.terrain[key] ?? 1) === i ? " on" : ""}`}
                        onClick={() => setTerrainAmt(key, i)}>{al}</button>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{ fontSize: "12px", color: "var(--txt-m)", margin: "14px 0 4px", fontWeight: 600 }}>
                สถานที่พิเศษบนแมพ:
              </div>
              <div className="mc-note">
                จุดสำคัญ (วัง/บัลลังก์/หมู่บ้าน/ตลาด/ค่ายกบฏ/กระดานเควส) มี <b>6 จุดเสมอ</b>
                <br /><b>น้อย</b> ≈ 12–14 จุด · <b>ปกติ</b> ≈ 18–20 จุด · <b>มาก</b> = ครบทุกจุด (สูงสุด 24)
              </div>
              <div className="mc-row">
                <span className="mc-label">🏰 จำนวนสถานที่พิเศษ</span>
                <div className="seg">
                  {DENSITY_LABELS.map((dl, i) => (
                    <button key={i}
                      className={`seg-btn${(mapCfg.zoneDensity ?? 1) === i ? " on" : ""}`}
                      onClick={() => setMapCfg(c => ({ ...c, zoneDensity: i }))}>{dl}</button>
                  ))}
                </div>
              </div>
              {(() => {
                const z = zoneCountEstimate(mapCfg);
                return (
                  <div className="mc-count">
                    ▸ คาดว่าจะมี ≈ <b>{z.expected} จุด</b> (สูงสุด {z.max} จุด)
                  </div>
                );
              })()}

              <label className="mc-toggle" style={{ marginTop: "12px" }}>
                <input type="checkbox" checked={mapCfg.dangerZones}
                  onChange={e => setMapCfg(c => ({ ...c, dangerZones: e.target.checked }))} />
                ⚠️ มีโซนอันตราย — 6 แห่ง (ถ้ำ/ภูเขาไฟ/ดันเจี้ยน/ซากปรักหักพัง/ป่าดำ/สุสาน)
              </label>
              <label className="mc-toggle">
                <input type="checkbox" checked={mapCfg.shops}
                  onChange={e => setMapCfg(c => ({ ...c, shops: e.target.checked }))} />
                🛒 มีร้านค้า — 4 ร้าน (ช่างตีเหล็ก/ร้านเวทย์/โรงเตี๊ยม/คลังอาวุธ)
              </label>
            </div>

            <div className="mc-summary">
              <b>สรุป:</b> {(mapCfgSummary(mapCfg) || []).join(" · ")}
            </div>
          </div>
          </div>{/* /create-cols */}

          <div style={{ textAlign: "center", marginTop: "8px" }}>
            <button className="btn b-gold" onClick={createRoom} disabled={!newName.trim() || wsStatus !== "ok"}>
              🏰 สร้างห้องเลย
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════ JOIN / BROWSE ═══════════════ */}
      <div id="rl" className={`screen${screen === "join" ? " on" : ""}`}>
        <div className="rlwrap">
          <div className="lhdr">
            <button className="b-sm" onClick={() => goScreen("title")}>← กลับ</button>
            <h2 className="cinzel" style={{ fontSize: "18px", color: "var(--gold)" }}>⚔️ เข้าร่วมเกม</h2>
          </div>

          <div className="tabs">
            <div className={`tab${tab === "browse" ? " on" : ""}`} onClick={() => { setTab("browse"); browseRooms(); }}>
              🔍 ห้องสาธารณะ
            </div>
            <div className={`tab${tab === "manual" ? " on" : ""}`} onClick={() => goScreen("manual")}>
              🔒 ใส่รหัสห้อง
            </div>
          </div>

          {tab === "browse" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", color: "var(--txt-m)" }}>ห้องสาธารณะที่กำลังรอผู้เล่น</div>
                <button className="b-sm" onClick={browseRooms}>🔄 รีเฟรช</button>
              </div>

              {rooms.length === 0 ? (
                <div className="empty-rooms">
                  <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏰</div>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: "15px", color: "var(--txt-m)", marginBottom: "6px" }}>
                    ยังไม่มีห้องสาธารณะเปิดอยู่
                  </div>
                  <div style={{ fontSize: "11px", marginBottom: "16px", color: "var(--txt-m)" }}>
                    สร้างห้องเอง หรือใช้แท็บ "ใส่รหัสห้อง" สำหรับห้องส่วนตัว
                  </div>
                  <button className="btn b-ghost" onClick={() => goScreen("create")}>+ สร้างห้อง</button>
                </div>
              ) : (
                rooms.map(r => (
                  <div className="room-card" key={r.code} onClick={() => {
                    setJoinModal({ code: r.code, hostName: r.hostName || "Host", mode: r.mode, players: r.players.length, maxPlayers: r.maxPlayers, mapConfig: r.mapConfig });
                    setJoinModalName("");
                  }}>
                    <div className="rc-code">{r.code}</div>
                    <div className="rc-info">
                      <div className="rc-host">👑 {r.hostName || "Host"}</div>
                      <div className="rc-meta">
                        {r.mode === "quick" ? "โหมดด่วน" : r.mode === "epic" ? "มหากาพย์" : "มาตรฐาน"}
                        &ensp;·&ensp;{Math.round((Date.now() - r.createdAt) / 60000)} นาทีที่แล้ว
                      </div>
                    </div>
                    <div className="rc-count">{r.players.length}/{r.maxPlayers}</div>
                  </div>
                ))
              )}
            </>
          )}

          {tab === "manual" && (
            <div className="join-box">
              <div className="join-title">🔒 กรอกรหัสห้อง</div>

              {/* Room code input */}
              <div style={{ marginBottom: "4px", textAlign: "left", fontSize: "10px", color: "var(--txt-m)", letterSpacing: ".06em" }}>รหัสห้อง</div>
              <input
                className="join-input"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="SOT-XXXX"
                maxLength={8}
                style={{ marginBottom: "12px" }}
              />

              {/* Name input — styled same as modal */}
              <div style={{ marginBottom: "4px", textAlign: "left", fontSize: "10px", color: "var(--txt-m)", letterSpacing: ".06em" }}>ชื่อที่ใช้ในเกม</div>
              <div className="nm-input-wrap" style={{ marginBottom: "16px" }}>
                <input
                  value={joinName}
                  onChange={e => setJoinName(e.target.value.slice(0, 12))}
                  placeholder="กรอกชื่อของคุณ..."
                  onKeyDown={e => { if (e.key === "Enter" && joinCode.length >= 4 && joinName.trim()) joinRoom(); }}
                />
                <span className="nm-char-count">{joinName.length}/12</span>
              </div>

              <button className="btn b-gold" style={{ width: "100%", padding: "12px" }} onClick={() => joinRoom()} disabled={joinCode.length < 4 || !joinName.trim() || wsStatus !== "ok"}>
                เข้าร่วมห้อง ⚔️
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════ LOBBY ═══════════════════ */}
      <div id="l" className={`screen${screen === "lobby" ? " on" : ""}`}>
        <div className="lwrap">
          <div className="lhdr">
            <button className="b-danger" onClick={leaveRoom}>✕ ออก</button>
            <h2 className="cinzel" style={{ fontSize: "17px", color: "var(--gold)" }}>ห้องเกม</h2>
            {room && (
              <>
                <div className="code-badge">{room.code}</div>
                <span className={`vis-badge ${room.visibility === "private" ? "vis-prv" : "vis-pub"}`}>
                  {room.visibility === "private" ? "🔒 ส่วนตัว" : "🌐 สาธารณะ"}
                </span>
                <button className="b-sm" onClick={() => {
                  navigator.clipboard?.writeText(room.code).catch(() => { });
                  showToast("📋 คัดลอกรหัสห้องแล้ว: " + room.code);
                }}>📋 คัดลอก</button>
                {/* ✅ FIX 2: ปุ่มแชร์ลิงก์สำหรับเพื่อนต่างเน็ต */}
                {WS_URL && !WS_URL.includes("localhost") && !WS_URL.includes("127.0.0.1") && (
                  <button className="b-sm" style={{ background: "rgba(76,201,76,.15)", borderColor: "rgba(76,201,76,.4)", color: "#4cc94c" }}
                    onClick={() => {
                      // สร้างลิงก์ที่เพื่อนกดแล้ว connect server ได้ทันที
                      const serverHost = WS_URL.replace(/^wss?:\/\//, "").replace(/\/ws\/?$/, "");
                      const shareUrl = `${window.location.origin}${window.location.pathname}?server=${encodeURIComponent(serverHost)}`;
                      navigator.clipboard?.writeText(shareUrl).catch(() => { });
                      showToast("🔗 คัดลอกลิงก์แชร์แล้ว! ส่งให้เพื่อนคลิกเพื่อเข้าร่วม");
                    }}>🔗 แชร์ลิงก์</button>
                )}
              </>
            )}
          </div>

          {room && (
            <>
              {/* Ready dots */}
              <div className="rbar">
                {Array.from({ length: room.maxPlayers }).map((_, i) => {
                  const p = room.players[i];
                  return <div key={i} className={`rdot${p && (p.ready || p.host) ? " on" : ""}`} title={p?.name || "ว่าง"} />;
                })}
                <span style={{ fontSize: "11px", color: "var(--txt-m)", marginLeft: "6px" }}>
                  {readyCount}/{room.maxPlayers} พร้อม
                </span>
              </div>

              {/* Player slots */}
              <div className="sbox">
                <div className="sh">👥 ผู้เล่น ({room.players.length}/{room.maxPlayers})</div>
                <div className="slots">
                  {Array.from({ length: room.maxPlayers }).map((_, i) => {
                    const p = room.players[i];
                    const isMe = p && p.name === myName;
                    const cls = p?.charId ? CHARACTERS[p.charId] : (p?.class ? CHARACTERS[p.class] : null);
                    if (!p) return (
                      <div key={i} className="slot empty">
                        <div className="sn" style={{ color: "var(--txt-d)" }}>รอผู้เล่น...</div>
                      </div>
                    );
                    return (
                      <div key={i} className={`slot filled${p.ready ? " ready-s" : ""}${i === 0 ? " host-s" : ""}`}>
                        <div className="sn" style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                          <CharIcon ch={cls} size={22} /> {p.name}
                          {isMe && <span className="tag tag-you">คุณ</span>}
                          {i === 0 && <span className="tag tag-host">Host</span>}
                          {p.ready && <span className="tag tag-ready">✓</span>}
                        </div>
                        <div className="sc">{cls ? cls.name : (p.ready || p.host ? "พร้อมแล้ว ✓" : "รอกดพร้อม...")}</div>
                        {isHost && !isMe && (
                          <button className="b-danger" style={{ fontSize: "10px", padding: "2px 8px", marginTop: "4px" }}
                            onClick={() => kickPlayer(i)}>✕ Kick</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Map settings — ข้อมูลการตั้งค่าแมพ (โชว์ให้ผู้เล่นทุกคนเห็น) */}
              {room.mapConfig && (
                <div className="sbox">
                  <div className="sh">🗺️ ตั้งค่าแผนที่</div>
                  <div className="mc-summary" style={{ marginTop: 0 }}>
                    {(mapCfgSummary(room.mapConfig) || []).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Flow note — ลำดับการเริ่มเกมแบบใหม่ */}
              <div className="sbox">
                <div className="sh">📜 ลำดับการเริ่มเกม</div>
                <div className="flow-steps">
                  <div className="flow-step"><span className="fs-no">1</span><div><b>กดพร้อม</b> — รอทุกคนในห้องพร้อม</div></div>
                  <div className="flow-step"><span className="fs-no">2</span><div><b>สุ่มบทบาทลับ</b> — เปิดดูบทบาทของคุณ (👑/⚔️/🧑)</div></div>
                  <div className="flow-step"><span className="fs-no">3</span><div><b>เลือกตัวละคร</b> — 👑 พระราชาเลือกก่อน จากนั้นคนอื่นเลือกพร้อมกัน</div></div>
                  <div className="flow-step"><span className="fs-no">4</span><div><b>เข้าสู่สนาม</b> — เริ่มต่อสู้ชิงบัลลังก์!</div></div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginTop: "4px" }}>
                {!isHost && (
                  <button
                    className={`btn b-ghost`}
                    style={players.find(p => p.name === myName)?.ready
                      ? { background: "rgba(42,122,53,.3)", borderColor: "#2a7a35" } : {}}
                    onClick={toggleReady}
                  >
                    {players.find(p => p.name === myName)?.ready ? "✓ พร้อมแล้ว!" : "✓ กดเพื่อพร้อม"}
                  </button>
                )}
                {isHost && (
                  <button
                    className="btn b-gold"
                    onClick={startGame}
                    disabled={!room || room.players.length < 3 || room.players.slice(1).some(p => !p.ready)}
                  >
                    🎮 เริ่มเกม! (สุ่มบทบาท)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═════════════ ROLE REVEAL ═════════════ */}
      {/* FIX: ทุกคนเปิดโรลพร้อมกันได้ — ไม่ต้องรอตามลำดับ */}
      <div id="rr" className={`screen${screen === "roles" ? " on" : ""}`}>
        <div className="rrwrap">
          <span style={{ fontSize: "40px", display: "block", animation: "float 3s ease-in-out infinite", filter: "drop-shadow(0 0 20px rgba(201,168,76,.5))", marginBottom: "8px" }}>♛</span>
          <h2 className="deco" style={{ color: "var(--gold)", marginBottom: "4px", fontSize: "clamp(15px,3vw,20px)" }}>
            รุ่งอรุณแห่งสงคราม
          </h2>
          <p style={{ fontSize: "12px", color: "var(--txt-m)", marginBottom: "14px" }}>
            แตะไพ่เพื่อดูบทบาทลับของคุณ — ห้ามให้คนอื่นเห็น!
          </p>

          <div className="warn-box">⚠ ทุกคนเปิดดูบทบาทพร้อมกันได้ — เมื่อทุกคนยืนยันแล้ว จะเข้าสู่ขั้น <b>เลือกตัวละคร</b> (👑 พระราชาเลือกก่อน)</div>

          {/* Flip card */}
          <div className="flip-outer" onClick={() => !roleConfirmed && setFlipped(true)}>
            <div className={`flip${flipped ? " f" : ""}`}>
              <div className="fback">
                <div className="fbglyph">⚜</div>
                <p style={{ fontSize: "10px", color: "var(--txt-m)", marginTop: "10px" }}>แตะเพื่อดูบทบาท</p>
              </div>
              {roleDef && (
                <div className={`ffront ff-${roleDef.id}`}>
                  <div className="fico">{roleDef.ico}</div>
                  <div className="fnm" style={{ color: roleDef.color }}>{roleDef.name}</div>
                  <div className="fwhy">{roleDef.why}</div>
                  <div className="fwin">🏆 {roleDef.win}</div>
                </div>
              )}
            </div>
          </div>

          {/* Confirm button (only after flip) */}
          {flipped && !roleConfirmed && (
            <div style={{ textAlign: "center", marginTop: "14px" }}>
              <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "8px" }}>
                คุณคือ {roleDef?.ico} <span className="cinzel" style={{ color: "var(--gold)" }}>{roleDef?.name}</span>
              </div>
              <button className="btn b-gold" onClick={confirmRole}>
                จำแล้ว — ยืนยัน ✓
              </button>
            </div>
          )}

          {roleConfirmed && (
            <div style={{ textAlign: "center", marginTop: "14px" }}>
              <div style={{ fontSize: "12px", color: "#4cc94c", marginBottom: "10px" }}>
                ✅ คุณยืนยันแล้ว — รอผู้เล่นคนอื่น...
              </div>
            </div>
          )}

          {/* Show who has confirmed */}
          {room && room.rolesReady && room.rolesReady.length > 0 && (
            <div style={{ marginTop: "16px", width: "100%", maxWidth: "360px" }}>
              <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "6px", textAlign: "center" }}>
                ยืนยันแล้ว {rolesReadyList.length}/{players.length} คน
              </div>
              <div className="confirmed-row">
                {players.map((p, i) => {
                  const confirmed = rolesReadyList.includes(p.name);
                  return (
                    <div key={i} className={`conf-chip${confirmed ? "" : " waiting"}`}>
                      {confirmed ? "✓" : "○"} {p.name}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!flipped && (
            <div className="blink" style={{ marginTop: "16px" }}>แตะการ์ดเพื่อดูบทบาทของคุณ</div>
          )}
        </div>
      </div>

      {/* ═════════════ CHARACTER SELECT (หลังเปิดบทบาท) ═════════════ */}
      {(() => {
        const kingIdx = room?.roles ? room.roles.indexOf("king") : -1;
        const kingPlayer = kingIdx >= 0 ? room?.players?.[kingIdx] : null;
        const charReadyList = room?.charReady || [];
        const iAmKing = myIdx >= 0 && myIdx === kingIdx;
        // 👑 พระราชาต้อง "ยืนยัน" ตัวละครก่อน คนอื่นจึงเลือกได้
        const kingConfirmed = !!(kingPlayer && charReadyList.includes(kingPlayer.name));
        const canPick = iAmKing || kingConfirmed;
        const myReady = charReadyList.includes(myName);
        return (
          <div id="cs" className={`screen${screen === "charselect" ? " on" : ""}`}>
            <div className="cswrap">
              <div className="cs-head">
                <h2 className="cinzel" style={{ color: "var(--gold)", fontSize: "clamp(16px,3vw,22px)", margin: 0 }}>
                  ⚔ เลือกตัวละคร
                </h2>
                {roleDef && (
                  <div className="cs-role" style={{ borderColor: roleDef.color, color: roleDef.color }}>
                    บทบาทของคุณ: {roleDef.ico} {roleDef.name}
                  </div>
                )}
              </div>

              {/* แถบสถานะลำดับการเลือก */}
              <div className={`cs-banner${canPick ? " go" : " wait"}`}>
                {iAmKing
                  ? "👑 คุณคือพระราชา — เลือกแล้วกด \"ยืนยัน\" ก่อนใคร! เมื่อคุณยืนยันแล้วคนอื่นจึงเลือกได้"
                  : kingConfirmed
                    ? `👑 ${kingPlayer?.name || "พระราชา"} ยืนยันแล้ว — แย่งเลือกได้เลย ใครกดยืนยันก่อนได้ตัวนั้นไป!`
                    : `⏳ รอพระราชา (${kingPlayer?.name || "—"}) ยืนยันตัวละครก่อน...`}
              </div>

              <div className="sbox" style={{ position: "relative" }}>
                <div className="sh">เลือกตัวละครของคุณ {myClass ? "✓" : ""}</div>
                <div className="cgrid">
                  {Object.values(CHARACTERS).map(ch => {
                    const others = (room?.players || []).filter(
                      p => p && p.name !== myName && (p.charId === ch.id || p.class === ch.id)
                    );
                    // ล็อกจริงเฉพาะคนที่ "ยืนยันแล้ว" — ระหว่างยังไม่ยืนยันถือว่ายังแย่งกันได้
                    const owner = others.find(p => charReadyList.includes(p.name));
                    const eyeing = !owner && others[0]; // มีคนเล็งอยู่แต่ยังไม่ยืนยัน
                    const taken = !!owner;
                    const locked = taken || !canPick;
                    return (
                      <div key={ch.id}
                        className={`ccard${myClass === ch.id ? " sel" : ""}${locked ? " taken" : ""}${eyeing ? " eyeing" : ""}`}
                        onClick={() => {
                          if (myReady) { showToast("คุณยืนยันตัวละครแล้ว"); return; }
                          if (!canPick) { showToast("👑 รอพระราชายืนยันก่อน"); return; }
                          if (taken) { showToast(`${ch.name} ถูก ${owner.name} ยืนยันแล้ว`); return; }
                          pickClass(ch.id);
                        }}
                        style={{ borderColor: myClass === ch.id ? ch.color : undefined }}>
                        {taken && <div className="ctaken">🔒 {owner.name}</div>}
                        {eyeing && <div className="ctaken eye">👀 {eyeing.name} กำลังเล็ง</div>}
                        <div className="ci" style={{ color: ch.color }}>
                          <CharIcon ch={ch} size={92} round={false}
                            style={{ margin: "0 auto", boxShadow: `0 2px 10px ${ch.color}55`, border: `1px solid ${ch.color}55` }} />
                        </div>
                        <div className="cn">{ch.name}</div>
                        <div className="ce" style={{ color: ch.color }}>{ch.desc}</div>
                        <div style={{ fontSize: "12px", color: "var(--txt)", margin: "5px 0 3px", display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", fontWeight: 600 }}>
                          <span>❤ {ch.hp}</span>
                          <span>💧 {ch.mana}</span>
                          <span>🗡 SPD {ch.move}</span>
                          <span>⚔ {ch.atk}</span>
                          <span>🛡 {ch.def}</span>
                        </div>
                        <div className="cab">🟡 {ch.active.name} (💧{ch.active.cost}) — {ch.active.desc}</div>
                        <div className="cpas">🟢 {ch.passive.name} — {ch.passive.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Confirm */}
              <div style={{ textAlign: "center", marginTop: "6px" }}>
                <button
                  className="btn b-gold"
                  onClick={confirmCharacter}
                  disabled={!myClass || myReady}
                  style={myReady ? { background: "rgba(42,122,53,.3)", borderColor: "#2a7a35" } : {}}>
                  {myReady ? "✓ ยืนยันแล้ว — รอผู้เล่นอื่น..." : myClass ? "✓ ยืนยันตัวละครนี้" : "เลือกตัวละครก่อน"}
                </button>
              </div>

              {/* ใครยืนยันแล้วบ้าง */}
              <div style={{ marginTop: "14px", width: "100%", maxWidth: "420px", marginLeft: "auto", marginRight: "auto" }}>
                <div style={{ fontSize: "11px", color: "var(--txt-m)", marginBottom: "6px", textAlign: "center" }}>
                  ยืนยันแล้ว {charReadyList.length}/{players.length} คน
                </div>
                <div className="confirmed-row">
                  {players.map((p, i) => {
                    const done = charReadyList.includes(p.name);
                    const picked = !!(p.charId || p.class);
                    return (
                      <div key={i} className={`conf-chip${done ? "" : " waiting"}`}>
                        {done ? "✓" : picked ? "…" : "○"} {p.name}{i === kingIdx ? " 👑" : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════ TRAITOR OFFER OVERLAY ═══════════ */}
      {traitorOffer && screen === "gameboard" && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,.85)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "linear-gradient(160deg,#1a0a1a,#2a1040)",
            border: "2px solid #8c4cc9",
            borderRadius: "18px",
            padding: "32px 40px",
            maxWidth: "400px",
            textAlign: "center",
            boxShadow: "0 0 40px rgba(140,76,201,.4)",
          }}>
            <div style={{ fontSize: "48px", marginBottom: "8px" }}>🗡️</div>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: "20px", color: "#8c4cc9", marginBottom: "6px" }}>
              โอกาสแห่งการทรยศ
            </div>
            <div style={{ fontSize: "13px", color: "#d4b8f0", marginBottom: "16px", lineHeight: 1.7 }}>
              พระราชาล้มแล้ว!<br />
              คุณได้รับโอกาสลับ — กลายเป็น<br />
              <span style={{ color: "#8c4cc9", fontWeight: 700 }}>คนทรยศ</span> และสู้เพื่อตัวเองคนเดียว<br />
              <span style={{ fontSize: "11px", color: "#998" }}>(ปฏิเสธ → คุณแพ้ไปกับฝั่งพระราชา)</span>
            </div>
            <div style={{ fontSize: "22px", color: traitorOffer.countdown <= 10 ? "#e04040" : "#c9a84c", marginBottom: "20px", fontFamily: "'Cinzel',serif" }}>
              ⏱ {traitorOffer.countdown} วินาที
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button
                onClick={() => respondTraitorOffer(true)}
                style={{
                  background: "linear-gradient(135deg,#4a1a6a,#8c4cc9)",
                  border: "1px solid #8c4cc9", color: "#fff",
                  padding: "12px 28px", borderRadius: "10px",
                  fontFamily: "'Cinzel',serif", fontSize: "14px", cursor: "pointer",
                }}>🗡️ ยอมรับ — ทรยศ!</button>
              <button
                onClick={() => respondTraitorOffer(false)}
                style={{
                  background: "rgba(255,255,255,.07)",
                  border: "1px solid rgba(255,255,255,.2)", color: "#aaa",
                  padding: "12px 28px", borderRadius: "10px",
                  fontSize: "14px", cursor: "pointer",
                }}>ปฏิเสธ</button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════ GAMEBOARD ═════════════ */}
      {/* ✅ FIX: แสดง overlay รอถ้ายังไม่พร้อม หรือ gameState ยังมาไม่ถึง (กันจอดำ) */}
      {screen === "gameboard" && !(allRolesReady && room && room.gameState) && (
        <div className="screen on" id="gb">
          <div className="wait-overlay">
            <div className="loading-spinner" />
            <div className="loading-txt">
              {allRolesReady ? "กำลังโหลดกระดานเกม..." : "รอผู้เล่นทุกคนยืนยันบทบาท..."}
            </div>
            {room && (
              <div className="confirmed-row">
                {players.map((p, i) => {
                  const confirmed = rolesReadyList.includes(p.name);
                  return (
                    <div key={i} className={`conf-chip${confirmed ? "" : " waiting"}`}>
                      {confirmed ? "✓" : "○"} {p.name}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {screen === "gameboard" && allRolesReady && room && room.gameState && (
        <GameBoard
          roomData={room}
          gameState={room.gameState}
          myIdx={myIdx >= 0 ? myIdx : 0}
          onLeave={leaveRoom}
          onGameAction={(actionType, payload) => {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "game_action",
                action: actionType,
                payload,
              }));
            }
          }}
        />
      )}
    </>
  );
}