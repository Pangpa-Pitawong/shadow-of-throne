import { useState, useEffect, useRef, useCallback } from "react";
import GameBoard from "./game/components/GameBoard";
import "./lobby/lobby.css";
import { WS_URL } from "./lobby/wsConfig";
import { ROLES } from "./game/constants/roles";
import { CLASSES } from "./game/constants/classes";

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
  const [myClass, setMyClass] = useState("");
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

    function connect() {
      if (!alive) return;
      setWsStatus("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        setWsStatus("ok");
        retryDelay = 2000;          // reset delay เมื่อเชื่อมต่อสำเร็จ

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
          case "joined":
            setRoom(msg.room);
            setLoading(false);
            goScreen("lobby"); // ✅ ใช้ goScreen แทน setScreen
            showToast(msg.playerIdx === 0
              ? "✅ สร้างห้องสำเร็จ! รหัส: " + msg.room.code
              : "✅ เข้าห้องสำเร็จ!"
            );
            break;

          // ── Lobby / room state changed ─────────────────────────────────
          case "room_update": {
            setRoom(msg.room);
            if (msg.room.status === "started"
              && screenRef.current !== "roles"      // ✅ ใช้ ref แทน state
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

          case "error":
            showToast("❌ " + msg.msg);
            setLoading(false);
            break;

          default:
            break;
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        setWsStatus("error");
        retryDelay = Math.min(retryDelay * 1.5, 15000);
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
    wsSend({ type: "create_room", playerName: name, maxPlayers: newCount, mode: newMode, visibility: newVis });
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

  const pickClass = (clsId) => {
    setMyClass(clsId);
    wsSend({ type: "pick_class", classId: clsId });
  };

  const toggleReady = () => {
    if (!myClass) { showToast("เลือกอาชีพก่อน"); return; }
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
        : <span className="ws-badge ws-err">✕ ไม่ได้เชื่อมต่อ — รีสตาร์ท server?</span>;

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
              <div className="mdesc">เริ่มเกมใหม่<br />3–6 ผู้เล่น</div>
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
      <div id="cr" className={`screen${screen === "create" ? " on" : ""}`}>
        <div style={{ maxWidth: "440px", width: "100%", padding: "20px" }}>
          <div className="lhdr" style={{ marginBottom: "20px" }}>
            <button className="b-sm" onClick={() => goScreen("title")}>← กลับ</button>
            <h2 className="cinzel" style={{ fontSize: "18px", color: "var(--gold)" }}>🏰 สร้างห้องใหม่</h2>
          </div>

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
                    setJoinModal({ code: r.code, hostName: r.hostName || "Host", mode: r.mode, players: r.players.length, maxPlayers: r.maxPlayers });
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
                    const cls = p?.class ? CLASSES[p.class] : null;
                    if (!p) return (
                      <div key={i} className="slot empty">
                        <div className="sn" style={{ color: "var(--txt-d)" }}>รอผู้เล่น...</div>
                      </div>
                    );
                    return (
                      <div key={i} className={`slot filled${p.ready ? " ready-s" : ""}${i === 0 ? " host-s" : ""}`}>
                        <div className="sn">
                          {cls?.ico || "🧑"} {p.name}
                          {isMe && <span className="tag tag-you">คุณ</span>}
                          {i === 0 && <span className="tag tag-host">Host</span>}
                          {p.ready && <span className="tag tag-ready">✓</span>}
                        </div>
                        <div className="sc">{cls ? cls.name : "ยังไม่เลือกอาชีพ"}</div>
                        {isHost && !isMe && (
                          <button className="b-danger" style={{ fontSize: "10px", padding: "2px 8px", marginTop: "4px" }}
                            onClick={() => kickPlayer(i)}>✕ Kick</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Class selection */}
              <div className="sbox">
                <div className="sh">⚔ เลือกอาชีพของคุณ</div>
                <div className="cgrid">
                  {Object.values(CLASSES).map(cls => (
                    <div key={cls.id} className={`ccard${myClass === cls.id ? " sel" : ""}`} onClick={() => pickClass(cls.id)}>
                      <div className="ci">{cls.ico}</div>
                      <div className="cn">{cls.name}</div>
                      <div className="ce">{cls.evo}</div>
                      <div className="cst">
                        <span className="cs">STR {cls.s.STR}</span>
                        <span className="cs">DEX {cls.s.DEX}</span>
                        <span className="cs">VIT {cls.s.VIT}</span>
                        <span className="cs">INT {cls.s.INT}</span>
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--txt-m)", margin: "3px 0 4px" }}>
                        ❤ {cls.hp} &nbsp; 💧 {cls.mana} &nbsp; 🗺 {cls.move}
                      </div>
                      <div className="cab">⚡ {cls.ability}</div>
                      <div className="cpas">🟢 {cls.passive}</div>
                    </div>
                  ))}
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
                    disabled={!myClass}
                  >
                    {players.find(p => p.name === myName)?.ready ? "✓ พร้อมแล้ว!" : "✓ พร้อมแล้ว"}
                  </button>
                )}
                {isHost && (
                  <button
                    className="btn b-gold"
                    onClick={startGame}
                    disabled={!room || room.players.length < 3 || room.players.slice(1).some(p => !p.ready)}
                  >
                    🎮 เริ่มเกม!
                  </button>
                )}
              </div>
              {!myClass && <div className="pulse" style={{ marginTop: "8px" }}>เลือกอาชีพก่อนกดพร้อม</div>}
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

          <div className="warn-box">⚠ ทุกคนสามารถเปิดดูบทบาทพร้อมกัน เมื่อทุกคนกดยืนยันแล้ว เกมจะเริ่มทันที</div>

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