import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hexToPixel } from "../utils/hexMath.js";

// ── ภูมิประเทศ → สี + ความสูง (สไตล์ Geo Pack voxel) ──────────────────────────
const TERR = {
  plains:   { col: 0x6aa844, h: 0.55 },
  forest:   { col: 0x3f7a2c, h: 0.62 },
  mountain: { col: 0x8b8e88, h: 1.35 },
  water:    { col: 0x2a6f8c, h: 0.30, water: true },
  desert:   { col: 0xd2a85a, h: 0.55 },
  swamp:    { col: 0x4a6a40, h: 0.48 },
};

// ── โซนพิเศษ → ไฟล์โมเดล Ultimate Fantasy (ที่เหลือใช้ billboard ไอคอน) ──────────
const ZONE_MODEL = {
  palace: "TownCenter_SecondAge_Level2", throne: "Wonder_SecondAge_Level3",
  village: "Houses_FirstAge_1_Level2", market: "Market_FirstAge_Level2",
  rebel_camp: "Barracks_FirstAge_Level2", tower: "WatchTower_FirstAge_Level2",
  shrine: "Temple_FirstAge_Level2", cave: "Mine", farm: "Farm_FirstAge_Level2_Wheat",
  blacksmith: "Houses_SecondAge_2_Level1", alchemist: "Temple_FirstAge_Level1",
  tavern: "Houses_FirstAge_3_Level2", armory: "Storage_FirstAge_Level2",
  dungeon: "Mine", treasure: "Resource_Gold_2", ruins: "Rock_Group",
  oasis: "Resource_Tree_Group", dark_forest: "Resource_PineTree_Group",
  volcano: "MountainLarge_Single", watchtower: "WatchTower_FirstAge_Level1",
  graveyard: "Rock_Group",
};
const ZONE_SCALE = { throne: 1.5, palace: 1.25, volcano: 1.3, oasis: 0.9, treasure: 0.8 };

const HL = { reach: 0x4cc94c, attack: 0xe24b4a, trap: 0xe0962a, skill: 0xa060e0, sel: 0xc9a84c, pend: 0x7CFC7C };

export default function IslandMap3D(props) {
  const mountRef = useRef(null);
  const R = useRef({ ready: false });
  // props ล่าสุดให้ handler อ่าน (กัน stale closure)
  const pr = useRef(props); pr.current = props;

  // ── INIT (ครั้งเดียว) ──────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 800, h = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1a2e);
    scene.fog = new THREE.Fog(0x0c1a2e, 36, 80);

    const cam = new THREE.PerspectiveCamera(42, w / h, 0.5, 400);
    cam.position.set(18, 20, 18);

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 6; controls.maxDistance = 90;
    // ขวา = เก็บไว้ให้เกม (สลับโหมดโจมตี) → ปิด pan ขวา, ซ้ายหมุน, กลาง pan
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };

    const sun = new THREE.DirectionalLight(0xfff1d4, 2.3);
    sun.position.set(-16, 26, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0004; scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a4232, 0.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const throneGlow = new THREE.PointLight(0xc15ee8, 0, 16, 1.6); scene.add(throneGlow);

    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: 0x14405a, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9 }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = 0.12; ocean.receiveShadow = true; scene.add(ocean);

    const boardGroup = new THREE.Group(); scene.add(boardGroup);
    const propGroup = new THREE.Group(); scene.add(propGroup);
    const tokenGroup = new THREE.Group(); scene.add(tokenGroup);
    const hlGroup = new THREE.Group(); scene.add(hlGroup);

    const raycaster = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const clock = new THREE.Clock();

    R.current = {
      ready: true, renderer, scene, cam, controls, sun, throneGlow,
      boardGroup, propGroup, tokenGroup, hlGroup, raycaster, ptr, clock,
      tiles: [], cellWorld: new Map(), templates: {}, modelsReady: false,
      GS: 1, boardSig: "", animers: [], hoverKey: null, mount,
    };

    // ── โหลดโมเดล glTF (ชุดที่ใช้) ──
    const loader = new GLTFLoader();
    const names = [...new Set(Object.values(ZONE_MODEL))];
    const base = (import.meta.env.BASE_URL || "/");
    let done = 0;
    Promise.all(names.map(n => new Promise(res => {
      loader.load(`${base}models/gltf/${n}.gltf`,
        g => { R.current.templates[n] = prep(g); done++; res(); },
        undefined, () => { done++; res(); });
    }))).then(() => {
      // สเกลรวมจากโมเดลบ้าน → บ้าน ≈ 1.1 ช่อง
      const ref = R.current.templates["Houses_FirstAge_1_Level2"];
      R.current.GS = ref ? 1.15 / Math.max(0.4, ref.userData.fp) : 0.5;
      R.current.modelsReady = true;
      rebuildBoard();
      rebuildTokens();
      rebuildHighlights();
    });

    // ── pointer: คลิก (ไม่ลาก) = เลือกช่อง · เลื่อน = hover ──
    let downX = 0, downY = 0, downT = 0;
    const setPtr = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const pick = () => {
      raycaster.setFromCamera(ptr, cam);
      const hit = raycaster.intersectObjects(R.current.tiles, false)[0];
      return hit?.object?.userData?.cell || null;
    };
    const onDown = (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); };
    const onUp = (e) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 500) return;
      setPtr(e); const cell = pick();
      if (cell) pr.current.onCellClick?.(cell);
    };
    const onMove = (e) => {
      setPtr(e); const cell = pick();
      const key = cell?.key ?? null;
      if (key !== R.current.hoverKey) {
        R.current.hoverKey = key;
        if (cell) pr.current.onCellHover?.(cell, e.clientX, e.clientY);
        else pr.current.onCellLeave?.();
      } else if (cell) {
        pr.current.onCellHover?.(cell, e.clientX, e.clientY);
      }
    };
    const onLeave = () => { R.current.hoverKey = null; pr.current.onCellLeave?.(); };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    // ── resize ──
    const onResize = () => {
      const W = mount.clientWidth, H = mount.clientHeight;
      if (!W || !H) return;
      cam.aspect = W / H; cam.updateProjectionMatrix(); renderer.setSize(W, H);
    };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    // ── loop ──
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      if (R.current.throneGlow.intensity > 0) R.current.throneGlow.intensity = 22 + Math.sin(t * 2.3) * 4;
      for (const a of R.current.animers) {
        if (a.type === "turn") { a.obj.position.y = a.baseY + Math.abs(Math.sin(t * 3)) * 0.35; a.obj.rotation.y = t * 1.2; }
        else if (a.type === "ring") a.obj.rotation.z = t * 1.5;
        else if (a.type === "pend") a.obj.material.opacity = 0.35 + Math.abs(Math.sin(t * 4)) * 0.4;
      }
      controls.update();
      renderer.render(scene, cam);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      controls.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      R.current.ready = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── rebuild เมื่อ "โครงสร้างแมพ" เปลี่ยน (ขนาด/ภูมิประเทศ/โซน) ──────────────
  useEffect(() => {
    if (!R.current.ready) return;
    const cells = props.cells || [];
    const sig = cells.length + "|" + cells.map(c => c.terrain[0] + (c.specialZone ? "z" : "")).join("");
    if (sig !== R.current.boardSig) { R.current.boardSig = sig; rebuildBoard(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cells]);

  useEffect(() => { if (R.current.ready && R.current.cellWorld.size) frameCamera(R.current); /* eslint-disable-next-line */ }, [props.recenter]);
  useEffect(() => { if (R.current.ready) rebuildTokens(); /* eslint-disable-next-line */ }, [props.players, props.currentTurn]);
  useEffect(() => { if (R.current.ready) rebuildHighlights(); /* eslint-disable-next-line */ },
    [props.reachableCells, props.attackableCells, props.trapCells, props.skillTargetCells, props.selectedCell, props.pendingMove, props.cells]);

  // ── BUILD BOARD ────────────────────────────────────────────────────────────
  function rebuildBoard() {
    const r = R.current; if (!r.ready) return;
    const cells = pr.current.cells || []; if (!cells.length) return;
    clear(r.boardGroup); clear(r.propGroup); r.tiles = []; r.cellWorld.clear();
    r.throneGlow.intensity = 0;

    // ศูนย์กลางแมพ → world
    let sx = 0, sy = 0;
    const pos = cells.map(c => { const p = hexToPixel(c.col, c.row, 1); return { c, x: p.x, z: p.y }; });
    for (const p of pos) { sx += p.x; sy += p.z; }
    const cxw = sx / pos.length, cyw = sy / pos.length;

    const hexGeo = new THREE.CylinderGeometry(0.97, 0.97, 1, 6);
    let maxR = 1;
    for (const { c, x, z } of pos) {
      const td = TERR[c.terrain] || TERR.plains;
      const wx = (x - cxw), wz = (z - cyw);
      maxR = Math.max(maxR, Math.hypot(wx, wz));
      const mat = new THREE.MeshStandardMaterial({ color: td.col, roughness: 0.92, flatShading: true });
      if (td.water) { mat.transparent = true; mat.opacity = 0.86; mat.roughness = 0.3; }
      const m = new THREE.Mesh(hexGeo, mat);
      m.scale.y = td.h; m.position.set(wx, td.h / 2, wz);
      m.rotation.y = Math.PI / 6;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData.cell = c;
      r.boardGroup.add(m); r.tiles.push(m);
      const top = td.h;
      r.cellWorld.set(c.key, { x: wx, z: wz, top });

      // โซนพิเศษ: โมเดล + ไอคอน billboard
      if (c.specialZone) {
        const zd = (pr.current.zones || {})[c.specialZone];
        const modelName = ZONE_MODEL[c.specialZone];
        const tpl = modelName && r.templates[modelName];
        if (tpl) {
          const o = tpl.clone(true);
          o.scale.setScalar(r.GS * (ZONE_SCALE[c.specialZone] || 1));
          o.position.set(wx, top, wz);
          o.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
          if (c.specialZone === "throne") {
            o.traverse(n => { if (n.isMesh) { n.material = n.material.clone(); n.material.color.multiplyScalar(0.5); n.material.color.lerp(new THREE.Color(0x6a3aa0), 0.45); n.material.emissive = new THREE.Color(0x6a3aa0); n.material.emissiveIntensity = 0.35; } });
            r.throneGlow.position.set(wx, top + 3, wz); r.throneGlow.intensity = 22;
          }
          r.propGroup.add(o);
        }
        if (zd?.ico) {
          const spr = iconSprite(zd.ico, zd.color || "#c9a84c");
          spr.position.set(wx, top + (tpl ? 2.4 : 1.1), wz);
          r.propGroup.add(spr);
        }
      }
    }

    r.boardRadius = maxR;
    frameCamera(r);
  }

  // ── PLAYER TOKENS ──────────────────────────────────────────────────────────
  function rebuildTokens() {
    const r = R.current; if (!r.ready || !r.cellWorld.size) return;
    clear(r.tokenGroup);
    r.animers = r.animers.filter(a => a.type === "pend"); // คง pend, ล้าง token anims
    const players = pr.current.players || [];
    const ct = pr.current.currentTurn;
    players.forEach((p, i) => {
      const cw = r.cellWorld.get(`${p.col},${p.row}`); if (!cw) return;
      const colr = new THREE.Color(p.playerColor || "#cccccc");
      const alive = p.alive !== false;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: alive ? colr : 0x555555, roughness: 0.5, metalness: 0.1, emissive: alive ? colr : 0x000000, emissiveIntensity: alive ? 0.15 : 0 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.7, 12), bodyMat);
      body.position.y = 0.35; body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bodyMat);
      head.position.y = 0.82; head.castShadow = true;
      g.add(body, head);
      const ico = iconSprite(p.playerIcon || "🧑", "#ffffff", 0.9);
      ico.position.y = 1.35; g.add(ico);
      g.position.set(cw.x, cw.top, cw.z);
      r.tokenGroup.add(g);
      if (alive && i === ct) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24),
          new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd060, emissiveIntensity: 0.6 }));
        ring.rotation.x = Math.PI / 2; ring.position.set(cw.x, cw.top + 0.06, cw.z);
        r.hlGroup.add(ring);
        r.animers.push({ type: "turn", obj: g, baseY: cw.top });
        r.animers.push({ type: "ring", obj: ring });
      }
    });
  }

  // ── HIGHLIGHTS (เดิน/โจมตี/กับดัก/สกิล/เลือก/รอยืนยัน) ───────────────────────
  function rebuildHighlights() {
    const r = R.current; if (!r.ready || !r.cellWorld.size) return;
    // เก็บ ring เทิร์นปัจจุบันไว้ (สร้างใน rebuildTokens) — ลบเฉพาะ overlay เก่า
    clear(r.hlGroup); r.animers = r.animers.filter(a => a.type === "turn" || a.type === "ring");
    rebuildTokens(); // เติม ring เทิร์นกลับ
    const p = pr.current;
    const disk = (key, color, op, raise, pend) => {
      const cw = r.cellWorld.get(key); if (!cw) return;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.99, 0.99, 0.08, 6),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: op }));
      m.rotation.y = Math.PI / 6; m.position.set(cw.x, cw.top + 0.05 + (raise || 0), cw.z);
      r.hlGroup.add(m);
      if (pend) r.animers.push({ type: "pend", obj: m });
    };
    (p.reachableCells || []).forEach(c => disk(c.key, HL.reach, 0.34));
    (p.attackableCells || []).forEach(c => disk(c.key, HL.attack, 0.4));
    (p.skillTargetCells || []).forEach(c => disk(c.key, HL.skill, 0.45));
    (p.trapCells || []).forEach(c => disk(c.key, HL.trap, 0.4));
    (p.cells || []).filter(c => c.trap).forEach(c => disk(c.key, HL.trap, 0.55, 0.02));
    if (p.selectedCell) disk(p.selectedCell.key, HL.sel, 0.5, 0.03);
    if (p.pendingMove) disk(p.pendingMove.key, HL.pend, 0.6, 0.04, true);
  }

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function clear(group) { while (group.children.length) { const o = group.children[0]; group.remove(o); o.traverse?.(n => { if (n.geometry) n.geometry.dispose?.(); }); } }

function prep(gltf) {
  const s = gltf.scene;
  s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.roughness = 0.85; } });
  const box = new THREE.Box3().setFromObject(s);
  const ctr = new THREE.Vector3(); box.getCenter(ctr);
  s.position.x -= ctr.x; s.position.z -= ctr.z; s.position.y -= box.min.y;
  const g = new THREE.Group(); g.add(s);
  const sz = new THREE.Vector3(); box.getSize(sz); g.userData.fp = Math.max(sz.x, sz.z) || 1;
  return g;
}

function iconSprite(ico, ringColor, scale = 1) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(13,17,28,0.82)"; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = ringColor; ctx.stroke();
  ctx.font = "64px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(ico, 64, 70);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(0.85 * scale, 0.85 * scale, 1);
  return spr;
}

function frameCamera(r) {
  // กระดานถูกจัดให้กึ่งกลางที่ origin แล้ว → เล็งที่ origin, ระยะกล้องจากรัศมีกระดาน
  const radius = (r.boardRadius && isFinite(r.boardRadius)) ? r.boardRadius : 10;
  const d = radius * 2.0 + 7;
  r.controls.target.set(0, 0.6, 0);
  r.cam.position.set(d * 0.62, d * 0.8, d * 0.62);
  r.cam.near = 0.5; r.cam.far = d * 6 + 60;
  r.cam.updateProjectionMatrix();
  r.scene.updateMatrixWorld(true);
  r.controls.update();
}
