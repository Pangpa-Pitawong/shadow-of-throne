import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ── ไบโอม → สี (สไตล์ Geo Pack voxel) · ความสูงมาจาก cell.elev ──────────────────
const BIOME = {
  grass: 0x6aa844, snow: 0xe3ecf2, forest: 0x3f7a2c, desert: 0xd2a85a,
  beach: 0xdac38d, shadow: 0x3a2d4a, throne: 0x2b2638, lava: 0xe0531f, water: 0x2a6f8c,
};
const HSTEP = 0.55;

// ── โซนพิเศษ → โมเดล Ultimate Fantasy (ที่เหลือใช้ billboard ไอคอน) ──────────────
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
// footprint อาคารเป็น "จำนวนช่อง" → สเกลโมเดลให้กว้างเท่ากับ footprint จริง (occupancy ตรง)
const ZONE_TILES = { throne: 2.1, palace: 1.5, volcano: 1.45, market: 1.3, rebel_camp: 1.3, village: 1.25, cave: 1.25, dungeon: 1.25, oasis: 1.15, treasure: 1.0 };
const ZONE_TILE_DEF = 0.95;
// ครึ่งความกว้างผิวช่อง (ช่องกว้าง 0.98) — โมเดล "ตัวเดี่ยว/พร็อพ" ต้องอยู่ในกรอบนี้ทั้งหมด ไม่ล้นขอบ
const TILE_HALF = 0.43;
// ฐานล้นได้เฉพาะอาคารหลายช่อง (จองช่องข้างไว้แล้ว) — นอกเหนือจากนี้ทุกโมเดลถูกบีบให้พอดีช่อง
const MULTI_TILE_ZONE = new Set(["throne", "palace", "volcano", "market", "rebel_camp", "village", "cave", "dungeon", "oasis"]);
// โมเดลตกแต่งภูมิประเทศ — มีทั้ง "ตัวเดี่ยว" (พอดี 1 ช่อง) และ "กลุ่ม" (ของชิ้นใหญ่ วางกลางช่อง ล้นขอบได้แต่ฐานไม่ลอย)
const PROP = {
  tree: "Resource_Tree1", treeG: "Resource_Tree_Group",
  pine: "Resource_PineTree", pineG: "Resource_PineTree_Group",
  rock: "Resource_Rock_2", rock2: "Rock", rockG: "Rock_Group",
  gold: "Resource_Gold_2", mtn: "Mountain_Single", mtnL: "MountainLarge_Single",
  logs: "Logs",
};
// ของชิ้นใหญ่ → อยู่กลางช่อง (jitter น้อย) เพื่อไม่ให้ปลายโผล่พ้นขอบช่องแล้วดูลอยเวลาติดหน้าผา
const BIG_PROP = new Set(["treeG", "pineG", "rockG", "mtn", "mtnL"]);
// สเกลต่อชนิด (× r.GS) — กลุ่ม/ภูเขาเล็กลงนิดให้ไม่ล้นเกินไป
const PROP_SCALE = { tree: 0.7, treeG: 0.6, pine: 0.72, pineG: 0.58, rock: 0.5, rock2: 0.52, rockG: 0.6, gold: 0.5, mtn: 0.8, mtnL: 0.92, logs: 0.5 };

const HL = { reach: 0x4cc94c, attack: 0xe24b4a, trap: 0xe0962a, skill: 0xa060e0, sel: 0xc9a84c, pend: 0x7CFC7C };
const frac = (n) => n - Math.floor(n);
const rhash = (c, r) => frac(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453);

export default function IslandMap3D(props) {
  const mountRef = useRef(null);
  const R = useRef({ ready: false });
  const pr = useRef(props); pr.current = props;

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
    scene.fog = new THREE.Fog(0x0c1a2e, 40, 95);

    const cam = new THREE.PerspectiveCamera(42, w / h, 0.5, 500);
    cam.position.set(18, 20, 18);

    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 6; controls.maxDistance = 120;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };

    const sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
    sun.position.set(-16, 28, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 110;
    sun.shadow.bias = -0.0004; scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a4232, 0.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const throneGlow = new THREE.PointLight(0xc15ee8, 0, 18, 1.6); scene.add(throneGlow);

    const waterUniforms = { uTime: { value: 0 } };
    const oceanMat = new THREE.MeshStandardMaterial({ color: 0x195270, roughness: 0.18, metalness: 0.18, transparent: true, opacity: 0.94 });
    oceanMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterUniforms.uTime;
      const wave = `
        uniform float uTime;
        float wv(vec2 p, float t){
          float h = 0.0;
          h += sin(p.x * 0.17 + t * 1.05) * 0.045;
          h += sin(p.y * 0.21 - t * 0.85) * 0.035;
          h += sin((p.x + p.y) * 0.13 + t * 1.35) * 0.022;
          h += sin((p.x - p.y) * 0.26 - t * 1.60) * 0.013;
          return h;                                  // รวม ~0.115 → ยอดคลื่นไม่พ้นช่องพื้นเตี้ย (0.55) ไม่ทะลักเข้าแมพ
        }
        varying float vWaveH;
      `;
      shader.vertexShader = wave + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `float e = 1.0;
         float n0 = wv(position.xy, uTime);
         float nx = wv(position.xy + vec2(e, 0.0), uTime);
         float ny = wv(position.xy + vec2(0.0, e), uTime);
         vec3 objectNormal = normalize(vec3(-(nx - n0), -(ny - n0), 1.0));`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vWaveH = wv(position.xy, uTime);
         transformed.z += vWaveH;`
      );
      shader.fragmentShader = "varying float vWaveH;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float crest = smoothstep(0.12, 0.30, vWaveH);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.60, 0.78, 0.86), crest * 0.5);`
      );
      // roughnessFactor มีค่าหลัง <roughnessmap_fragment> เท่านั้น → ฉีดตรงนี้ (กัน shader compile error)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, 0.55, smoothstep(0.12, 0.30, vWaveH));`
      );
    };
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 200, 200), oceanMat);
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = 0.38; ocean.receiveShadow = true; scene.add(ocean);

    // ฟองคลื่นซัดชายฝั่ง — แถบ geometry แบนตามแนวขอบที่พื้นดินจรดน้ำ (สร้างใน rebuildBoard) ใช้ uTime ร่วมกับผิวน้ำ
    const foamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: waterUniforms.uTime },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vWorld; varying float vShore;
        void main(){ vWorld = position.xz; vShore = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform float uTime; varying vec2 vWorld; varying float vShore;
        void main(){
          float fade  = smoothstep(1.0, 0.12, vShore);                                   // เข้มที่ขอบฝั่ง จางเข้าทะเล
          float s1    = sin(vWorld.x * 6.0 + vWorld.y * 6.0 + uTime * 2.2) * 0.5 + 0.5;
          float s2    = sin(vWorld.x * 11.0 - vWorld.y * 9.0 - uTime * 1.6) * 0.5 + 0.5;
          float surge = 0.55 + 0.45 * sin(uTime * 1.3 + (vWorld.x + vWorld.y) * 1.4);     // ฟองม้วนเข้า-ออก
          float a = clamp(fade * (0.4 + 0.6 * s1 * s2) * surge, 0.0, 1.0) * 0.9;
          if (a < 0.03) discard;
          gl_FragColor = vec4(vec3(0.93, 0.98, 1.0), a);
        }
      `,
    });

    const boardGroup = new THREE.Group(); scene.add(boardGroup);
    const propGroup = new THREE.Group(); scene.add(propGroup);
    const tokenGroup = new THREE.Group(); scene.add(tokenGroup);
    const hlGroup = new THREE.Group(); scene.add(hlGroup);
    const labelGroup = new THREE.Group(); labelGroup.visible = !!pr.current.showLabels; scene.add(labelGroup);

    const raycaster = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const clock = new THREE.Clock();

    R.current = {
      ready: true, renderer, scene, cam, controls, throneGlow,
      boardGroup, propGroup, tokenGroup, hlGroup, labelGroup, raycaster, ptr, clock,
      tiles: [], cellWorld: new Map(), templates: {}, modelsReady: false,
      GS: 0.5, boardSig: "", boardRadius: 10, animers: [], hoverKey: null,
      tokenByIdx: new Map(), walks: new Map(), seenTrail: {}, firstTokenBuild: true,
    };
    R.current.foamMat = foamMat;

    const loader = new GLTFLoader();
    const names = [...new Set([...Object.values(ZONE_MODEL), ...Object.values(PROP)])];
    const base = (import.meta.env.BASE_URL || "/");
    Promise.all(names.map(n => new Promise(res => {
      loader.load(`${base}models/gltf/${n}.gltf`,
        g => { R.current.templates[n] = prep(g); res(); },
        undefined, () => res());
    }))).then(() => {
      const ref = R.current.templates["Houses_FirstAge_1_Level2"];
      R.current.GS = ref ? 1.2 / Math.max(0.4, ref.userData.fp) : 0.5;
      R.current.modelsReady = true;
      rebuildBoard(); rebuildTokens(); rebuildHighlights();
    });

    let downX = 0, downY = 0, downT = 0;
    const setPtr = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const pick = () => {
      const r = R.current; if (!r.terrain) return null;
      raycaster.setFromCamera(ptr, cam);
      const hit = raycaster.intersectObject(r.terrain, false)[0];
      return hit && hit.instanceId != null ? (r.cellByInstance[hit.instanceId] || null) : null;
    };
    const onDown = (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); };
    const onUp = (e) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 500) return;
      setPtr(e); const cell = pick(); if (cell) pr.current.onCellClick?.(cell);
    };
    const onMove = (e) => {
      setPtr(e); const cell = pick(); const key = cell?.key ?? null;
      if (key !== R.current.hoverKey) { R.current.hoverKey = key; if (cell) pr.current.onCellHover?.(cell, e.clientX, e.clientY); else pr.current.onCellLeave?.(); }
      else if (cell) pr.current.onCellHover?.(cell, e.clientX, e.clientY);
    };
    const onLeave = () => { R.current.hoverKey = null; pr.current.onCellLeave?.(); };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown); el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", onLeave);

    const onResize = () => { const W = mount.clientWidth, H = mount.clientHeight; if (!W || !H) return; cam.aspect = W / H; cam.updateProjectionMatrix(); renderer.setSize(W, H); };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      waterUniforms.uTime.value = t;
      if (R.current.throneGlow.intensity > 0) R.current.throneGlow.intensity = 24 + Math.sin(t * 2.3) * 5;
      for (const a of R.current.animers) {
        if (a.type === "turn") { a.obj.position.y = a.baseY + Math.abs(Math.sin(t * 3)) * 0.35; a.obj.rotation.y = t * 1.2; }
        else if (a.type === "ring") a.obj.rotation.z = t * 1.5;
        else if (a.type === "pend") a.obj.material.opacity = 0.35 + Math.abs(Math.sin(t * 4)) * 0.4;
        else if (a.type === "hl") {
          const s = 0.5 + 0.5 * Math.sin(t * a.spd + a.ph);          // 0..1 pulse
          a.fill.material.opacity = a.base * (0.55 + 0.45 * s);
          a.fill.material.emissiveIntensity = 0.7 + 0.9 * s;
          a.fill.position.y = a.y0 + s * 0.05;
          if (a.ring) { a.ring.material.opacity = 0.45 + 0.55 * s; const k = 1 + s * 0.06; a.ring.scale.set(k, k, 1); }
        }
        else if (a.type === "torch") a.obj.intensity = a.base + Math.sin(t * 7 + a.ph) * a.base * 0.4;
      }
      // ── เดินทีละช่อง: เลื่อนโทเคนผ่าน waypoints (ทับ bob ของ turn) ──
      if (R.current.walks.size) {
        for (const [idx, wlk] of R.current.walks) {
          const tok = R.current.tokenByIdx.get(idx); if (!tok) { R.current.walks.delete(idx); continue; }
          const n = wlk.pts.length; const p = Math.min(1, (t - wlk.t0) / wlk.dur);
          const f = p * (n - 1); const seg = Math.min(n - 2, Math.floor(f)); const lt = f - seg;
          const a = wlk.pts[seg], b = wlk.pts[seg + 1] || a;
          tok.position.set(a.x + (b.x - a.x) * lt, (a.y + (b.y - a.y) * lt) + Math.sin(p * Math.PI * n) * 0.12, a.z + (b.z - a.z) * lt);
          tok.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
          if (p >= 1) R.current.walks.delete(idx);
        }
      }
      controls.update(); renderer.render(scene, cam);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave);
      controls.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      R.current.ready = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!R.current.ready) return;
    const cells = props.cells || [];
    const sig = cells.length + "|" + cells.map(c => (c.biome || c.terrain || "?")[0] + (c.elev ?? 0) + (c.specialZone ? "z" : "")).join("");
    if (sig !== R.current.boardSig) { R.current.boardSig = sig; rebuildBoard(); rebuildTokens(); rebuildHighlights(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cells]);

  useEffect(() => { if (R.current.ready && R.current.cellWorld.size) frameCamera(R.current); /* eslint-disable-next-line */ }, [props.recenter]);
  useEffect(() => { if (R.current.ready) { animateTrails(); rebuildTokens(); } /* eslint-disable-next-line */ }, [props.players, props.currentTurn]);
  useEffect(() => { if (R.current.ready) rebuildHighlights(); /* eslint-disable-next-line */ },
    [props.reachableCells, props.attackableCells, props.trapCells, props.skillTargetCells, props.selectedCell, props.pendingMove, props.cells]);
  useEffect(() => { if (R.current.ready && R.current.labelGroup) R.current.labelGroup.visible = !!props.showLabels; }, [props.showLabels]);

  // ── BOARD: voxel tiles + biome props + zone buildings ──────────────────────
  function rebuildBoard() {
    const r = R.current; if (!r.ready) return;
    const cells = pr.current.cells || []; if (!cells.length) return;
    clear(r.boardGroup); clear(r.propGroup); r.cellWorld.clear();
    r.animers = r.animers.filter(a => a.type !== "torch"); // คบเพลิงเก่าถูกลบไปกับ propGroup แล้ว
    r.cellByInstance = []; r.terrain = null; r.throneGlow.intensity = 0;

    clear(r.labelGroup);
    let maxC = 0, maxR2 = 0; for (const c of cells) { if (c.col > maxC) maxC = c.col; if (c.row > maxR2) maxR2 = c.row; }
    const ox = maxC / 2, oz = maxR2 / 2;
    r.boardRadius = Math.max(maxC, maxR2) * 0.5 + 1;
    // landmark/structure scaling ตามขนาดแมพ — แมพใหญ่ → landmark อลังการขึ้น, แมพเล็ก → กระชับ
    const landScale = THREE.MathUtils.clamp(r.boardRadius / 8, 0.85, 1.0); // ไม่ขยายเกิน 1 → แมพใหญ่ landmark ไม่บวมล้น footprint ที่จองไว้

    // ── พื้น: InstancedMesh ก้อนเดียว (รับกริดใหญ่ได้ลื่น) ──
    const geo = new THREE.BoxGeometry(0.98, 1, 0.98);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
    const m4 = new THREE.Matrix4(), colr = new THREE.Color();
    cells.forEach((c, i) => {
      const biome = c.biome || "grass";
      const isWater = biome === "water";
      const hgt = isWater ? 0.22 : ((c.elev ?? 1) + 1) * HSTEP;
      const wx = c.col - ox, wz = c.row - oz;
      m4.makeScale(0.98, hgt, 0.98); m4.setPosition(wx, hgt / 2, wz);
      inst.setMatrixAt(i, m4);
      colr.setHex(BIOME[biome] !== undefined ? BIOME[biome] : 0x6aa844);
      inst.setColorAt(i, colr);
      r.cellByInstance[i] = c;
      r.cellWorld.set(c.key, { x: wx, z: wz, top: hgt, water: isWater, cell: c });
    });
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    r.terrain = inst; r.boardGroup.add(inst);

    // ── ฟองคลื่นชายฝั่ง: แถบแบนตามขอบที่พื้นดินจรดน้ำ/ทะเลเปิด (รวมเป็น geometry ก้อนเดียว) ──
    {
      const at = new Map(); for (const c of cells) at.set(c.col + "," + c.row, c);
      const isSea = (col, row) => { const c = at.get(col + "," + row); return !c || (c.biome || "grass") === "water"; }; // ไม่มีช่อง = ทะเลเปิด
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const D = 0.5, FY = 0.40, HALF = 0.49; // ความลึกแถบยื่นเข้าทะเล · ความสูงผิวน้ำ (พอดีผิวทะเลที่สงบลง) · ครึ่งความกว้างช่อง
      const pos = [], uv = [], idx = []; let v = 0;
      for (const c of cells) {
        if ((c.biome || "grass") === "water") continue;        // เริ่มจากช่องพื้นดินเท่านั้น
        const wx = c.col - ox, wz = c.row - oz;
        for (const [dx, dz] of DIRS) {
          if (!isSea(c.col + dx, c.row + dz)) continue;        // ขอบนี้ไม่ติดทะเล → ข้าม
          const px = dz, pz = -dx;                              // เวกเตอร์ตั้งฉาก = แนวขอบ
          const bx = wx + dx * HALF, bz = wz + dz * HALF;      // จุดกลางขอบฝั่ง
          const e1x = bx + px * HALF, e1z = bz + pz * HALF, e2x = bx - px * HALF, e2z = bz - pz * HALF; // ขอบฝั่ง (vShore 0)
          const i1x = e1x + dx * D, i1z = e1z + dz * D, i2x = e2x + dx * D, i2z = e2z + dz * D;         // ยื่นเข้าทะเล (vShore 1)
          pos.push(e1x, FY, e1z, e2x, FY, e2z, i2x, FY, i2z, i1x, FY, i1z);
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
        }
      }
      if (idx.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        const foam = new THREE.Mesh(g, r.foamMat); foam.frustumCulled = false; foam.renderOrder = 2;
        r.boardGroup.add(foam);
      }
    }

    // ── ของบนพื้น: อาคารโซน (สเกลตาม footprint) + ของตกแต่งไบโอม (วางบนผิว ไม่ลอย) ──
    const cellAt = new Map(); for (const c of cells) cellAt.set(c.col + "," + c.row, c);
    // footprint จริงของ landmark = ช่องตัวเอง + ช่อง reserved ที่ต่อกัน (BFS) → ใช้จัดโมเดลให้อยู่กึ่งกลางและกว้างไม่เกินพื้นที่จองจริง
    const footprintOf = (c0) => {
      const seen = new Set([c0.col + "," + c0.row]); const members = [c0]; const stack = [c0];
      while (stack.length) {
        const cur = stack.pop();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (cur.col + dx) + "," + (cur.row + dz);
          if (seen.has(k)) continue;
          const nb = cellAt.get(k);
          if (nb && nb.reserved) { seen.add(k); members.push(nb); stack.push(nb); }
        }
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const m of members) { const mx = m.col - ox, mz = m.row - oz; if (mx < minX) minX = mx; if (mx > maxX) maxX = mx; if (mz < minZ) minZ = mz; if (mz > maxZ) maxZ = mz; }
      return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: (maxX - minX) + 0.98, d: (maxZ - minZ) + 0.98 };
    };
    for (const c of cells) {
      const biome = c.biome || "grass"; if (biome === "water") continue;
      const cw = r.cellWorld.get(c.key); const wx = cw.x, wz = cw.z, hgt = cw.top;
      if (c.specialZone) {
        const fpr = footprintOf(c);
        const zd = (pr.current.zones || {})[c.specialZone];
        const mn = ZONE_MODEL[c.specialZone], tpl = mn && r.templates[mn];
        if (tpl) {
          const o = tpl.clone(true);
          // กว้างไม่เกิน footprint จริง (ด้านแคบสุด − ขอบกันชน) แล้ววางกึ่งกลาง footprint → ไม่มีทางยื่นพ้นขอบ/หน้าผา
          const fitW = Math.min(fpr.w, fpr.d) - 0.08;
          const tiles = Math.min(ZONE_TILES[c.specialZone] || ZONE_TILE_DEF, fitW);
          let zs = tiles / Math.max(0.4, tpl.userData.fp); // กว้างเท่า footprint จริง
          const zMaxH = c.specialZone === "throne" ? 3.4 : 2.0; // กันโมเดลสูงเกิน (ภูเขาไฟ ฯลฯ); บัลลังก์สูงได้
          if ((tpl.userData.h || 1) * zs > zMaxH) zs = zMaxH / (tpl.userData.h || 1);
          o.scale.setScalar(zs);
          o.position.set(fpr.cx, hgt - 0.05, fpr.cz); // กึ่งกลาง footprint · ฝังฐานลงผิวเล็กน้อย ไม่ลอย
          o.rotation.y = Math.floor(rhash(c.col + 7, c.row + 3) * 4) * Math.PI / 2;
          if (c.specialZone === "throne") {
            o.traverse(n => { if (n.isMesh) { n.material = n.material.clone(); n.material.color.multiplyScalar(0.5); n.material.color.lerp(new THREE.Color(0x6a3aa0), 0.45); n.material.emissive = new THREE.Color(0x6a3aa0); n.material.emissiveIntensity = 0.4; } });
            r.throneGlow.position.set(fpr.cx, hgt + 3, fpr.cz); r.throneGlow.intensity = 24;
            buildThroneDecor(r, fpr.cx, hgt, fpr.cz, zs * (tpl.userData.fp || 1) / 2); // ธงขนาบบัลลังก์ (อิงขนาดโมเดลจริง)
          }
          r.propGroup.add(o);
        } else {
          r.propGroup.add(groundFlag(fpr.cx, hgt, fpr.cz, zd?.color || "#c9a84c"));
        }
        // ป้ายชื่อสถานที่ (toggle ได้) — ลอยเหนือ landmark
        if (zd?.name) {
          const lbl = labelSprite(zd.ico || "📍", zd.name, zd.color || "#c9a84c");
          const lift = (MULTI_TILE_ZONE.has(c.specialZone) ? 2.2 : 1.5) * Math.max(1, landScale);
          lbl.position.set(fpr.cx, hgt + lift, fpr.cz); r.labelGroup.add(lbl);
        }
        continue; // ช่องอาคาร: ไม่วางพร็อพทับ
      }
      if (c.reserved) continue; // footprint บัลลังก์: เว้นไว้
      const kinds = propKinds(biome, c);
      kinds.forEach((pk, i) => placeProp(r, pk, wx, hgt, wz, c, i));
    }
    frameCamera(r);
  }

  // คืน "ลิสต์พร็อพ" 0–3 ชิ้นต่อช่อง — เพิ่มความหนาแน่นให้แต่ละโซนไม่โล่ง พร้อมความหลากหลายของชนิด
  function propKinds(biome, c) {
    const hv = rhash(c.col, c.row);
    const hv2 = rhash(c.col + 31, c.row + 17);
    const hv3 = rhash(c.col + 53, c.row + 71);
    const out = [];
    if (biome === "forest") {
      out.push("tree"); if (hv < 0.55) out.push("tree"); if (hv2 < 0.3) out.push(hv2 < 0.14 ? "pine" : "rock"); if (hv3 < 0.12) out.push("logs");
    } else if (biome === "snow") {
      if (hv < 0.7) out.push("pine"); if (hv < 0.28) out.push("pine"); if (hv2 < 0.42) out.push("rock"); if (hv3 < 0.14) out.push("rockG");
    } else if (biome === "desert") {
      if (hv < 0.5) out.push("rock"); if (hv2 < 0.2) out.push("gold"); if (hv3 < 0.3) out.push("rock2"); if (hv > 0.88) out.push("mtn");
    } else if (biome === "grass") {
      if (hv < 0.42) out.push("tree"); if (hv2 < 0.24) out.push("rock"); if (hv3 < 0.16) out.push("tree"); if (hv > 0.93) out.push("logs");
    } else if (biome === "shadow") {
      if (hv < 0.6) out.push("rockGdark"); if (hv2 < 0.34) out.push("rock2dark");
    } else if (biome === "lava") {
      if (hv < 0.6) out.push("rockGdark"); if (hv2 < 0.3) out.push("rockdark");
    } else if (biome === "beach") {
      if (hv < 0.14) out.push("rock");
    }
    if (c.terrain === "mountain" && biome !== "throne" && biome !== "shadow") {
      out.push(hv < 0.5 ? "rockG" : "mtn");
    }
    return out;
  }
  function placeProp(r, kind, wx, top, wz, c, idx = 0) {
    const dark = kind.endsWith("dark");
    const key = dark ? kind.slice(0, -4) : kind;
    const mn = PROP[key]; const tpl = mn && r.templates[mn];
    if (!tpl) return;
    const o = tpl.clone(true);
    // คำนวณก่อนวาง: บีบสเกลให้ "ฐานพอดีช่อง (ไม่ล้นขอบ)" และ "ไม่สูงโผล่เกิน" (กันภูเขา/หินยักษ์)
    const fp = tpl.userData.fp || 1, mh = tpl.userData.h || 1;
    const s = Math.min(r.GS * (PROP_SCALE[key] || 0.55), (TILE_HALF * 2) / fp, 1.25 / mh);
    o.scale.setScalar(s);
    // jitter ถูกจำกัดด้วย "ที่ว่างที่เหลือ" หลังหักครึ่ง footprint → ขอบโมเดลไม่มีทางเลยขอบช่อง
    const room = Math.max(0, TILE_HALF - (fp * s) / 2);
    const half = Math.min(BIG_PROP.has(key) ? 0.12 : 0.3, room);
    const jx = (rhash(c.col * 4 + idx + 1, c.row * 7) - 0.5) * half * 2;
    const jz = (rhash(c.col * 9, c.row * 5 + idx + 2) - 0.5) * half * 2;
    o.position.set(wx + jx, top - 0.08, wz + jz); // ฝังฐานลงผิวเล็กน้อย → ไม่เห็นช่องว่างใต้ฐาน/ไม่ลอย
    o.rotation.y = rhash(c.col + idx * 3 + 2, c.row + 5) * Math.PI * 2;
    if (dark) o.traverse(n => { if (n.isMesh) { n.material = n.material.clone(); n.material.color.multiplyScalar(0.5); n.material.color.lerp(new THREE.Color(0x5a3a8a), 0.4); } });
    r.propGroup.add(o);
  }

  // ── PLAYER TOKENS ──────────────────────────────────────────────────────────
  function rebuildTokens() {
    const r = R.current; if (!r.ready || !r.cellWorld.size) return;
    clear(r.tokenGroup); r.tokenByIdx.clear();
    r.animers = r.animers.filter(a => a.type === "pend");
    const players = pr.current.players || [], ct = pr.current.currentTurn;
    players.forEach((p, i) => {
      if (p.hiddenByFog) return; // ม่านหมอก: ไม่วาดโทเคน
      const cw = r.cellWorld.get(`${p.col},${p.row}`); if (!cw) return;
      const colr = new THREE.Color(p.playerColor || "#cccccc");
      const alive = p.alive !== false;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: alive ? colr : 0x555555, roughness: 0.5, metalness: 0.1, emissive: alive ? colr : 0x000000, emissiveIntensity: alive ? 0.15 : 0 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.7, 12), bodyMat); body.position.y = 0.35; body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bodyMat); head.position.y = 0.82; head.castShadow = true;
      g.add(body, head);
      const ico = iconSprite(p.playerIcon || "🧑", "#ffffff", 0.9); ico.position.y = 1.35; g.add(ico);
      g.position.set(cw.x, cw.top, cw.z); r.tokenGroup.add(g);
      r.tokenByIdx.set(i, g);
      const wlk = r.walks.get(i); if (wlk) { const s = wlk.pts[0]; g.position.set(s.x, s.y, s.z); } // กำลังเดิน → เริ่มจากต้นทาง
      if (alive && i === ct) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd060, emissiveIntensity: 0.6 }));
        ring.rotation.x = Math.PI / 2; ring.position.set(cw.x, cw.top + 0.06, cw.z); r.hlGroup.add(ring);
        r.animers.push({ type: "turn", obj: g, baseY: cw.top }); r.animers.push({ type: "ring", obj: ring });
      }
    });
  }

  // ── เดินทีละช่อง: อ่าน _moveTrail (เส้นทางจริงจาก server) แล้วตั้งคิวเลื่อนโทเคน ──
  function animateTrails() {
    const r = R.current; if (!r.cellWorld.size) return;
    const players = pr.current.players || [];
    players.forEach((p, i) => {
      const tr = p._moveTrail;
      if (!tr || tr.id == null) return;
      // ครั้งแรกที่โหลด/เข้าเกมกลางคัน — จดว่า "เห็นแล้ว" โดยไม่เล่นอนิเมชันย้อนหลัง
      if (r.firstTokenBuild) { r.seenTrail[i] = tr.id; return; }
      if (r.seenTrail[i] === tr.id) return;
      r.seenTrail[i] = tr.id;
      const pts = (tr.path || []).map(s => r.cellWorld.get(`${s.col},${s.row}`)).filter(Boolean)
        .map(cw => ({ x: cw.x, y: cw.top, z: cw.z }));
      if (pts.length < 2) return;
      r.walks.set(i, { pts, t0: r.clock.getElapsedTime(), dur: (pts.length - 1) * 0.26 });
    });
    r.firstTokenBuild = false;
  }

  // ── HIGHLIGHTS ──────────────────────────────────────────────────────────────
  function rebuildHighlights() {
    const r = R.current; if (!r.ready || !r.cellWorld.size) return;
    clear(r.hlGroup);
    r.animers = r.animers.filter(a => a.type === "turn" || a.type === "ring" || a.type === "torch");
    rebuildTokens();
    const p = pr.current;
    // glowing tile marker: bright emissive fill + animated outline ring (ชัดเจน แยกเดิน/โจมตีได้ทันที)
    const disk = (key, color, op, raise, pulse, ringColor) => {
      const cw = r.cellWorld.get(key); if (!cw) return;
      const y = cw.top + 0.06 + (raise || 0);
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.06, 0.9),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, transparent: true, opacity: op }));
      fill.position.set(cw.x, y, cw.z); fill.frustumCulled = false; r.hlGroup.add(fill);
      // outline frame — square ring hugging the tile edge, glows for distance visibility
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.62, 4, 1),
        new THREE.MeshBasicMaterial({ color: ringColor || color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 4;
      ring.position.set(cw.x, y + 0.04, cw.z); ring.frustumCulled = false; r.hlGroup.add(ring);
      if (pulse) r.animers.push({ type: "hl", fill, ring, base: op, y0: y, spd: pulse, ph: (cw.x + cw.z) * 1.3 });
    };
    // เดิน = เขียว-ฟ้าสว่าง + เต้นช้า  ·  โจมตี = แดง-ส้ม + เต้นเร็ว (แยกกันชัด)
    (p.reachableCells || []).forEach(c => disk(c.key, HL.reach, 0.42, 0, 3.2, 0x9bffd6));
    (p.attackableCells || []).forEach(c => disk(c.key, HL.attack, 0.5, 0.01, 5.2, 0xffb070));
    (p.skillTargetCells || []).forEach(c => disk(c.key, HL.skill, 0.5, 0.01, 4.4, 0xd0a0ff));
    (p.trapCells || []).forEach(c => disk(c.key, HL.trap, 0.45, 0, 4.0, 0xffd070));
    // กับดักบนแมพ — ปักธง 🪤 ให้เห็นชัดว่าช่องนี้มีกับดัก (ไม่ใช่แค่ไฮไลต์พื้น)
    (p.cells || []).filter(c => c.trap).forEach(c => {
      const cw = r.cellWorld.get(c.key); if (!cw) return;
      disk(c.key, HL.trap, 0.5, 0.02, 4.0, 0xffd070);
      r.hlGroup.add(trapFlag(cw.x, cw.top, cw.z));
    });
    if (p.selectedCell) disk(p.selectedCell.key, HL.sel, 0.55, 0.03, 3.0, 0xffe9a8);
    if (p.pendingMove) disk(p.pendingMove.key, HL.pend, 0.65, 0.04, 6.0, 0xd6ffd6);
  }

  return <div ref={mountRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function clear(group) { while (group.children.length) { const o = group.children[0]; group.remove(o); o.traverse?.(n => { if (n.geometry) n.geometry.dispose?.(); }); } }
function prep(gltf) {
  const s = gltf.scene;
  s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.roughness = 0.85; } });
  const b = new THREE.Box3().setFromObject(s); const ctr = new THREE.Vector3(); b.getCenter(ctr);
  s.position.x -= ctr.x; s.position.z -= ctr.z; s.position.y -= b.min.y;
  const g = new THREE.Group(); g.add(s); const sz = new THREE.Vector3(); b.getSize(sz);
  g.userData.fp = Math.max(sz.x, sz.z) || 1; g.userData.h = sz.y || 1; // กว้างฐาน + สูง (ใช้ clamp กันโมเดลใหญ่/สูงเกิน)
  return g;
}
function iconSprite(ico, ringColor, scale = 1) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fillStyle = "rgba(13,17,28,0.82)"; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = ringColor; ctx.stroke();
  ctx.font = "64px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ico, 64, 70);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(0.85 * scale, 0.85 * scale, 1); return spr;
}
// ป้ายชื่อสถานที่ — แผ่นป้ายโปร่งใส ไอคอน + ชื่อ (billboard, อ่านได้ทุกมุมกล้อง)
function labelSprite(ico, name, color = "#c9a84c") {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128;
  const ctx = cv.getContext("2d");
  const text = `${ico}  ${name}`;
  ctx.font = "600 52px 'Cinzel', serif";
  const tw = Math.min(496, ctx.measureText(text).width + 44);
  const x0 = (512 - tw) / 2;
  // แผ่นพื้นโค้งมน + ขอบสีโซน
  const rr = 26;
  ctx.beginPath();
  ctx.moveTo(x0 + rr, 28); ctx.arcTo(x0 + tw, 28, x0 + tw, 100, rr); ctx.arcTo(x0 + tw, 100, x0, 100, rr);
  ctx.arcTo(x0, 100, x0, 28, rr); ctx.arcTo(x0, 28, x0 + tw, 28, rr); ctx.closePath();
  ctx.fillStyle = "rgba(10,8,5,0.86)"; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = color; ctx.stroke();
  ctx.font = "600 46px 'Cinzel', serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#f0e2c0"; ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  spr.renderOrder = 999; spr.scale.set(2.6, 0.65, 1); return spr;
}
// ตกแต่งบัลลังก์ — ธงราชวงศ์ 2 ผืนข้างบัลลังก์ (กำแพงถูกถอดออกตามคำขอผู้ใช้)
function buildThroneDecor(r, cx, cy, cz, halfW) {
  // ธงราชวงศ์ 2 ผืนขนาบบัลลังก์ — ระยะอิงครึ่งความกว้างโมเดลจริง จึงอยู่ในกรอบ footprint เสมอ ไม่ยื่นพ้นขอบ
  const off = Math.max(0.25, halfW * 0.9);
  for (const sx of [-off, off]) {
    const banner = groundFlag(cx + sx, cy, cz - off * 0.6, "#7a3ad0");
    banner.scale.setScalar(0.7); r.propGroup.add(banner);
  }
}
function groundFlag(wx, top, wz, color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 }));
  pole.position.y = 0.8; pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.05), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 }));
  flag.position.set(0.28, 1.4, 0); flag.castShadow = true;
  g.add(pole, flag); g.position.set(wx, top, wz); return g;
}
// ธงกับดัก — เสา + ผืนธงแดง + ไอคอน 🪤 ลอยเหนือช่อง (มองเห็นชัดจากทุกมุมกล้อง)
function trapFlag(wx, top, wz) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 1 }));
  pole.position.y = 0.6; pole.castShadow = true;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.04), new THREE.MeshStandardMaterial({ color: 0xe0962a, emissive: 0xc0531f, emissiveIntensity: 0.5, roughness: 0.7 }));
  cloth.position.set(0.26, 1.0, 0); cloth.castShadow = true;
  const ico = iconSprite("🪤", "#e0962a", 0.8); ico.position.y = 1.45;
  g.add(pole, cloth, ico); g.position.set(wx, top, wz); return g;
}
function frameCamera(r) {
  const radius = (r.boardRadius && isFinite(r.boardRadius)) ? r.boardRadius : 10;
  const d = radius * 2.5 + 8;
  r.controls.target.set(0, 1.0, 0);
  r.cam.position.set(d * 0.6, d * 0.82, d * 0.6);
  r.cam.near = 0.5; r.cam.far = d * 6 + 80; r.cam.updateProjectionMatrix();
  r.scene.updateMatrixWorld(true); r.controls.update();
}
