// scene.js — the 3D room for the party deduction game (agent D).
//
//   createScene(canvas, THREE) -> {
//     setPlayers, setPhase, highlight, vote, eliminate, revealRoles,
//     setCameraShot, update, dispose
//   }
//
// A moody round-table room with one seated avatar per player. Everything is
// procedural: box / sphere / cylinder primitives sharing a handful of unit
// geometries, plus textures painted onto <canvas> elements. No external assets,
// no network, no timers — the caller drives update(dt).
//
// Grid: XZ is the ground plane, Y is up, the floor sits at y = 0. The table is
// centred on the origin and the seats ring it. Every mesh belonging to an
// avatar carries `userData.playerId` so the integrator can raycast a tap.
//
// Camera control is programmatic; the caller owns pointer input.

// ---------------------------------------------------------------------------
// Canvas texture helpers (module scope so a scene never re-creates them twice).
// ---------------------------------------------------------------------------

function cvs(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Wrap a canvas as an sRGB repeating THREE texture. */
function finish(THREE, canvas, rx, ry) {
  const t = new THREE.CanvasTexture(canvas);
  if ("colorSpace" in t) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || 1);
  t.anisotropy = 4;
  return t;
}

/** Dark parquet floorboards. */
function texFloor(THREE) {
  const c = cvs(512, 512);
  const g = c.getContext("2d");
  g.fillStyle = "#2a1d14";
  g.fillRect(0, 0, 512, 512);
  const ph = 64;
  for (let row = 0; row < 8; row++) {
    const y = row * ph;
    const off = (row % 2) * 128;
    for (let x = -256 + off; x < 512; x += 256) {
      const s = 0.78 + Math.random() * 0.4;
      const v = Math.round(96 * s);
      g.fillStyle = `rgb(${v + 18},${v},${Math.round(v * 0.62)})`;
      g.fillRect(x + 3, y + 3, 250, ph - 6);
      g.strokeStyle = "rgba(20,12,6,0.5)";
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const gy = y + 8 + Math.random() * (ph - 16);
        g.beginPath();
        g.moveTo(x + 4, gy);
        g.bezierCurveTo(x + 90, gy + 3, x + 170, gy - 3, x + 250, gy);
        g.stroke();
      }
    }
  }
  return finish(THREE, c, 4, 4);
}

/** Dark papered wall with faint stripes and damask dots. */
function texWall(THREE) {
  const c = cvs(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#2b2119";
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = (x / 16) % 2 ? "rgba(255,220,170,0.05)" : "rgba(0,0,0,0.12)";
    g.fillRect(x, 0, 8, 256);
  }
  g.fillStyle = "rgba(255,220,180,0.07)";
  for (let y = 16; y < 256; y += 48) {
    for (let x = 16; x < 256; x += 48) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "rgba(0,0,0,0.0)");
  grd.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return finish(THREE, c, 6, 2);
}

/** Warm table wood grain. */
function texWood(THREE) {
  const c = cvs(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#5a3d24";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(38,24,12,0.5)";
  g.lineWidth = 1.4;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(85, y + 5, 170, y - 5, 256, y);
    g.stroke();
  }
  g.strokeStyle = "rgba(120,86,50,0.35)";
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(85, y + 4, 170, y - 4, 256, y);
    g.stroke();
  }
  return finish(THREE, c, 2, 2);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexStr(n) {
  return "#" + (n >>> 0).toString(16).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Frame-rate independent approach factor. */
function damp(dt, speed) {
  return 1 - Math.exp(-Math.max(0, speed) * dt);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOut(v) {
  const x = clamp01(v);
  return 1 - (1 - x) * (1 - x);
}

// Cast palette dealt to the seats — outfit, skin and hair by player index.
const SKIN = [0xf6d3b0, 0xe8b98d, 0xd29a6a, 0xb07a4c, 0x8a5a35, 0x5d3c26];
const HAIR = [0x161210, 0x2e2018, 0x4a3320, 0x7a5a30, 0xa89b8c, 0x4a4a52];
const HAIR_STYLES = ["crop", "long", "bun", "cap", "bob"];

const OUTFITS = [
  { style: "suit", main: 0x2b3a55, dark: 0x1c2740, shirt: 0xe8e2d2, accent: 0xb03a3a },
  { style: "dress", main: 0x6a2440, dark: 0x4a1830, shirt: 0xf0e6d6, accent: 0xd4af5a },
  { style: "suit", main: 0x2f5138, dark: 0x1f3a26, shirt: 0xe6e0cc, accent: 0x7a5c2e },
  { style: "suit", main: 0x6b4a2c, dark: 0x4a311c, shirt: 0xefe7d6, accent: 0x37485a },
  { style: "dress", main: 0x33333f, dark: 0x22222b, shirt: 0xe2ddd0, accent: 0x8a3550 },
  { style: "suit", main: 0x8a3b2a, dark: 0x5f271b, shirt: 0xf0e6d2, accent: 0x2f4a5a },
  { style: "dress", main: 0x2e4a6b, dark: 0x1e3450, shirt: 0xe8e2d4, accent: 0xc07a3a },
  { style: "suit", main: 0x4a3a5a, dark: 0x332740, shirt: 0xe9e3d6, accent: 0x8a9a3a },
  { style: "dress", main: 0x7a5a2a, dark: 0x553d1a, shirt: 0xf2ead8, accent: 0x3a5a4a },
  { style: "suit", main: 0x24484a, dark: 0x173032, shirt: 0xe6e0d0, accent: 0xa83030 },
];

// Per-phase mood: light intensities/colours, fog and background. Values are
// eased toward, so switching phase flows rather than snaps.
const PHASES = {
  lobby:    { hemi: 1.05, key: 1.15, table: 14, accent: 4.5, hemiCol: 0xffd9a0, keyCol: 0xffdcae, tableCol: 0xffb060, accentCol: 0xff8a50, fogCol: 0x120c08, bgCol: 0x120c08, fogNear: 8, fogFar: 26, lean: 0 },
  briefing: { hemi: 0.7, key: 0.9, table: 8, accent: 4, hemiCol: 0x9fb4d8, keyCol: 0x9fb4d8, tableCol: 0x6f86b0, accentCol: 0x4a6a9a, fogCol: 0x070a12, bgCol: 0x070a12, fogNear: 5, fogFar: 16, lean: 0.05 },
  roles:    { hemi: 0.8, key: 1, table: 9.5, accent: 4.2, hemiCol: 0xcdb894, keyCol: 0xd8c49c, tableCol: 0xd0a060, accentCol: 0x7a6a9a, fogCol: 0x0b0810, bgCol: 0x0b0810, fogNear: 5, fogFar: 18, lean: 0.03 },
  round:    { hemi: 0.95, key: 1.15, table: 12.5, accent: 3.8, hemiCol: 0xffd9a0, keyCol: 0xffd6a0, tableCol: 0xffb060, accentCol: 0x7a6a9a, fogCol: 0x0d0a08, bgCol: 0x0d0a08, fogNear: 7, fogFar: 22, lean: 0 },
  vote:     { hemi: 0.85, key: 1, table: 11, accent: 5, hemiCol: 0xff9a86, keyCol: 0xff9a86, tableCol: 0xff6a4a, accentCol: 0xa02020, fogCol: 0x140606, bgCol: 0x140606, fogNear: 5, fogFar: 18, lean: 0.14 },
  result:   { hemi: 0.8, key: 1.05, table: 12, accent: 3.6, hemiCol: 0xffd0a0, keyCol: 0xffd0a0, tableCol: 0xffa050, accentCol: 0x8a5a3a, fogCol: 0x0b0806, bgCol: 0x0b0806, fogNear: 5, fogFar: 18, lean: 0.04 },
  reveal:   { hemi: 0.75, key: 0.95, table: 15, accent: 4.2, hemiCol: 0xcfe0ff, keyCol: 0xcfe0ff, tableCol: 0xffe0b0, accentCol: 0x5070b0, fogCol: 0x05070e, bgCol: 0x05070e, fogNear: 4, fogFar: 20, lean: 0 },
  ended:    { hemi: 0.85, key: 1, table: 10, accent: 3.8, hemiCol: 0xd8c8a8, keyCol: 0xd8c8a8, tableCol: 0xd8a860, accentCol: 0x6a5a7a, fogCol: 0x0a0806, bgCol: 0x0a0806, fogNear: 7, fogFar: 24, lean: 0 },
};

const OVERVIEW_POS = [0, 4.3, 5.4];
const OVERVIEW_TGT = [0, 1.0, 0];
const GREY = 0x2a2a2a;

// ---------------------------------------------------------------------------

import { buildSuspects as buildModels } from "./models.js";

export function createScene(canvas, THREE) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1.333, 0.1, 140);

  // ---- resource registries so dispose() frees everything exactly once -----
  const geoSet = new Set();
  const matSet = new Set();
  const texSet = new Set();

  function regGeo(g) {
    if (g) geoSet.add(g);
    return g;
  }
  function regMat(m) {
    if (m) {
      matSet.add(m);
      for (const key of ["map", "emissiveMap", "alphaMap", "roughnessMap", "normalMap"]) {
        if (m[key]) texSet.add(m[key]);
      }
    }
    return m;
  }

  // Shared unit geometries — every part is one of these, scaled. Registered
  // once for the whole scene, never per avatar.
  const G = {
    box: regGeo(new THREE.BoxGeometry(1, 1, 1)),
    sphere: regGeo(new THREE.SphereGeometry(1, 16, 12)),
    capsule: regGeo(new THREE.CapsuleGeometry(0.5, 1, 6, 14)),
    cyl: regGeo(new THREE.CylinderGeometry(1, 1, 1, 16)),
    disc: regGeo(new THREE.CircleGeometry(1, 40)),
    ring: regGeo(new THREE.TorusGeometry(1, 0.06, 8, 32)),
    cone: regGeo(new THREE.ConeGeometry(1, 1, 14)),
    plane: regGeo(new THREE.PlaneGeometry(1, 1)),
  };

  /** Room/scene material, tracked for dispose(). */
  function stdMat(color, extra) {
    return regMat(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.02 }, extra || {})));
  }
  /** Per-avatar material, tracked by the avatar itself. */
  function rawMat(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.02 }, extra || {}));
  }

  /** A shared-geometry part: position (p), scale (s), optional rotation (r). */
  function part(parent, geo, mat, p, s, r) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p[0], p[1], p[2]);
    m.scale.set(s[0], s[1], s[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---- background / fog ---------------------------------------------------
  const fog = new THREE.Fog(0x120c08, 8, 26);
  scene.fog = fog;
  scene.background = new THREE.Color(0x120c08);

  // ---- the room shell -----------------------------------------------------
  const room = new THREE.Group();
  room.name = "party-room";
  scene.add(room);

  const floor = part(room, G.disc, stdMat(0xffffff, { map: texFloor(THREE), roughness: 0.95 }), [0, 0, 0], [7.4, 7.4, 1], [-Math.PI / 2, 0, 0]);
  floor.castShadow = false;

  const wallGeo = regGeo(new THREE.CylinderGeometry(7.4, 7.4, 5.2, 56, 1, true));
  const wall = new THREE.Mesh(wallGeo, stdMat(0xffffff, { map: texWall(THREE), roughness: 0.98, side: THREE.DoubleSide }));
  wall.position.y = 2.6;
  wall.receiveShadow = true;
  room.add(wall);

  const ceil = part(room, G.disc, stdMat(0x17110d, { roughness: 1.0 }), [0, 5.2, 0], [7.4, 7.4, 1], [Math.PI / 2, 0, 0]);
  ceil.receiveShadow = false;
  ceil.castShadow = false;

  // A shallow trim ring where the wall meets the floor.
  part(room, G.cyl, stdMat(0x3a2a1c, { roughness: 0.6, metalness: 0.15 }), [0, 0.04, 0], [7.42, 0.08, 7.42]);

  // ---- the round table ----------------------------------------------------
  const tableMat = stdMat(0xffffff, { map: texWood(THREE), roughness: 0.7 });
  const TABLE_TOP = 0.79; // top surface height
  part(room, G.cyl, tableMat, [0, TABLE_TOP - 0.045, 0], [1.24, 0.09, 1.24]);
  part(room, G.cyl, tableMat, [0, 0.4, 0], [0.19, 0.72, 0.19]);
  part(room, G.cyl, tableMat, [0, 0.035, 0], [0.52, 0.07, 0.52]);

  // Centrepiece: a shallow bowl and three stub candles (emissive only — the
  // table point light does the real lighting).
  part(room, G.cyl, stdMat(0x6a4a2a, { roughness: 0.5, metalness: 0.1 }), [0, TABLE_TOP + 0.03, 0], [0.3, 0.06, 0.3]);
  const waxMat = stdMat(0xefe6cc, { roughness: 0.8, emissive: 0x3a2a10, emissiveIntensity: 0.25 });
  const flameMat = stdMat(0xffcf7a, { emissive: 0xff9a2e, emissiveIntensity: 2.2, roughness: 0.5 });
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a) * 0.14;
    const z = Math.sin(a) * 0.14;
    part(room, G.cyl, waxMat, [x, TABLE_TOP + 0.11, z], [0.028, 0.2, 0.028]);
    flames.push(part(room, G.sphere, flameMat, [x, TABLE_TOP + 0.24, z], [0.035, 0.06, 0.035]));
  }

  // ---- lighting (four lights, one shadow caster) --------------------------
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x1a120c, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffdcae, 0.6);
  key.position.set(4.5, 7.5, 3.2);
  key.target.position.set(0, 0.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4.5;
  key.shadow.camera.right = 4.5;
  key.shadow.camera.top = 4.5;
  key.shadow.camera.bottom = -4.5;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);

  const tableLight = new THREE.PointLight(0xffb060, 9, 11, 2);
  tableLight.position.set(0, 2.35, 0);
  scene.add(tableLight);

  const accentLight = new THREE.PointLight(0x7a6a9a, 2.4, 14, 2);
  accentLight.position.set(-3.6, 2.1, -3.0);
  scene.add(accentLight);

  // Current (eased) lighting state, seeded from the lobby phase.
  const lightState = {
    hemi: hemi.intensity,
    key: key.intensity,
    table: tableLight.intensity,
    accent: accentLight.intensity,
    hemiCol: hemi.color.clone(),
    keyCol: key.color.clone(),
    tableCol: tableLight.color.clone(),
    accentCol: accentLight.color.clone(),
    fogCol: fog.color.clone(),
    bgCol: scene.background.clone(),
    fogNear: fog.near,
    fogFar: fog.far,
    lean: 0,
  };
  const lightTarget = Object.assign({}, lightState);
  const PHASE_FALLBACK = "round";

  function setPhase(next) {
    const name = PHASES[next] ? next : PHASE_FALLBACK;
    const p = PHASES[name];
    lightTarget.hemi = p.hemi;
    lightTarget.key = p.key;
    lightTarget.table = p.table;
    lightTarget.accent = p.accent;
    lightTarget.hemiCol.set(p.hemiCol);
    lightTarget.keyCol.set(p.keyCol);
    lightTarget.tableCol.set(p.tableCol);
    lightTarget.accentCol.set(p.accentCol);
    lightTarget.fogCol.set(p.fogCol);
    lightTarget.bgCol.set(p.bgCol);
    lightTarget.fogNear = p.fogNear;
    lightTarget.fogFar = p.fogFar;
    lightTarget.lean = p.lean;
  }

  // ---- renderer (with a headless fallback) --------------------------------
  // In a browser this is a normal shadowed WebGLRenderer. Under a DOM shim with
  // no real GL context the constructor throws; fall back to a null renderer so
  // the scene still builds and updates headlessly.
  let renderer = null;
  if (canvas && typeof canvas.getContext === "function") {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.enabled = true;
      if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
      if ("toneMapping" in renderer && THREE.ACESFilmicToneMapping) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.28;
      }
      const pr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
      renderer.setPixelRatio(Math.min(pr, 2));
    } catch (err) {
      renderer = null;
    }
  }

  let lastW = 0;
  let lastH = 0;
  function syncSize() {
    const vw = typeof innerWidth === "number" ? innerWidth : 0;
    const vh = typeof innerHeight === "number" ? innerHeight : 0;
    const w = Math.max(1, canvas.clientWidth || vw || 800);
    const h = Math.max(1, canvas.clientHeight || vh || 600);
    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      // setSize(w, h, true) lets three set the canvas' drawing buffer + CSS box.
      if (renderer) renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  function resize(w, h) {
    if (w) canvas.style.width = `${w}px`;
    if (h) canvas.style.height = `${h}px`;
    lastW = 0; // force the next sync to apply
    lastH = 0;
    syncSize();
  }
  syncSize();

  // ---- seats / camera -----------------------------------------------------
  const seats = new Map(); // playerId -> avatar
  const camPos = new THREE.Vector3(OVERVIEW_POS[0], OVERVIEW_POS[1], OVERVIEW_POS[2]);
  const camTarget = new THREE.Vector3(OVERVIEW_TGT[0], OVERVIEW_TGT[1], OVERVIEW_TGT[2]);
  const viewCenter = new THREE.Vector3(0, 1.0, 0);
  const upVec = new THREE.Vector3(0, 1, 0);
  const tmpDir = new THREE.Vector3();
  let shot = "overview";
  let orbitAngle = 0;

  function desiredShot() {
    if (shot.startsWith("focus:")) {
      const a = seats.get(shot.slice(6));
      if (a) {
        const p = a.group.position;
        const out = new THREE.Vector3(p.x, 0, p.z);
        if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
        out.normalize();
        const tangent = new THREE.Vector3(-out.z, 0, out.x);
        // Stand back and frame the FACE. The old shot sat 0.85m away at y=1.55 —
        // inside the avatar's head — so the near plane clipped through the body
        // and filled the screen with a giant coloured surface.
        const pos = new THREE.Vector3(p.x, 1.62, p.z)
          .addScaledVector(out, 1.85)
          .addScaledVector(tangent, 0.7);
        const target = new THREE.Vector3(p.x, 1.28, p.z).addScaledVector(out, -0.2);
        return { pos, target };
      }
    }
    if (shot === "reveal") {
      return { pos: new THREE.Vector3(0.4, 1.55, 4.2), target: new THREE.Vector3(0, 1.05, 0) };
    }
    if (shot === "orbit") {
      const r = 5.3;
      return { pos: new THREE.Vector3(Math.sin(orbitAngle) * r, 3.05, Math.cos(orbitAngle) * r), target: viewCenter };
    }
    return { pos: new THREE.Vector3(OVERVIEW_POS[0], OVERVIEW_POS[1], OVERVIEW_POS[2]), target: new THREE.Vector3(OVERVIEW_TGT[0], OVERVIEW_TGT[1], OVERVIEW_TGT[2]) };
  }

  function setCameraShot(name) {
    const next = String(name || "overview");
    if (next === "orbit" && shot !== "orbit") orbitAngle = Math.atan2(camPos.x, camPos.z);
    shot = next;
  }

  // ---- name cards and role labels ----------------------------------------
  function makeCardMesh(name, accent) {
    const canvas = cvs(320, 100);
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, 320, 100);
    g.fillStyle = "#efe4cf";
    roundRect(g, 4, 4, 312, 92, 16);
    g.fill();
    g.strokeStyle = "#2a211a";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = hexStr(accent);
    g.fillRect(16, 16, 288, 15);
    g.fillStyle = "#241a12";
    const label = String(name == null ? "" : name).slice(0, 18);
    const size = Math.max(20, Math.min(44, Math.floor(520 / Math.max(1, label.length))));
    g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 160, 64);

    const tex = new THREE.CanvasTexture(canvas);
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.8, metalness: 0.0,
      emissive: 0x111111, emissiveIntensity: 0.25, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(G.plane, mat);
    mesh.scale.set(0.44, 0.138, 1);
    mesh.rotation.set(-Math.PI / 2 + 0.42, 0, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { mesh, mat, tex };
  }

  function drawRole(canvas, roleName, traitor) {
    const g = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = traitor ? "#4a0d16" : "#141c2a";
    roundRect(g, 6, 6, W - 12, H - 12, 22);
    g.fill();
    g.strokeStyle = traitor ? "#ff6a6a" : "#cdbb8a";
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = traitor ? "#ff8a8a" : "#a8c0e0";
    g.font = "700 30px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(traitor ? "TRAITOR" : "CREW", W / 2, 40);
    g.fillStyle = traitor ? "#ffd9d9" : "#f0e8d2";
    const label = String(roleName == null ? "" : roleName);
    const size = Math.max(22, Math.min(46, Math.floor(620 / Math.max(1, label.length))));
    g.font = `700 ${size}px Georgia, serif`;
    g.fillText(label.slice(0, 22), W / 2, 100);
  }

  // ---- vote tokens (pooled) ----------------------------------------------
  const tokenMat = stdMat(0xffe6a0, { emissive: 0xffb040, emissiveIntensity: 2.4, roughness: 0.4, metalness: 0.2 });
  const tokens = [];
  function acquireToken() {
    for (const t of tokens) {
      if (!t.active) {
        t.active = true;
        t.mesh.visible = true;
        return t;
      }
    }
    const mesh = new THREE.Mesh(G.cone, tokenMat);
    mesh.scale.set(0.075, 0.24, 0.075);
    mesh.visible = false;
    mesh.castShadow = false;
    scene.add(mesh);
    const t = { mesh, active: true, t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), targetId: null };
    tokens.push(t);
    mesh.visible = true;
    return t;
  }

  // ---- one seated avatar --------------------------------------------------
  // Reuse the detailed whodunnit character models (rounded torso/limbs, coats,
  // hats, hair) instead of hand-rolled primitives. We adapt their API to the
  // party scene's needs: a ground glow ring, a secret card, a name label.
  function buildAvatar(player, index, count) {
    const id = player && player.id != null ? player.id : `p${index}`;
    const name = player && player.name != null ? player.name : id;

    const anchor = { position: [0, 0, 0], facing: 0 };
    const model = buildModels([{ id, name }], [anchor], THREE)[0];
    const group = model.group;
    group.name = `avatar-${id}`;

    // The model's controller (people.js): { id, group, speak, setTalking, face, update, dispose }
    const inner = model;

    // Stand them (they were seated in whodunnit); this scene is a standing table.
    group.position.set(0, 0, 0);

    // Glow ring on the floor so the active speaker reads clearly.
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xe6b96a, emissive: new THREE.Color(0xe6b96a), emissiveIntensity: 0, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0,
    });
    const ring = new THREE.Mesh(G.ring, ringMat);
    ring.scale.set(0.62, 0.62, 0.62);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    // The secret card they are dealt (invisible until then).
    const secretCard = new THREE.Mesh(G.box, new THREE.MeshStandardMaterial({ color: 0xefe4cf, roughness: 0.8, emissive: 0x222222, emissiveIntensity: 0 }));
    secretCard.scale.set(0.16, 0.22, 0.012);
    secretCard.position.set(0, 1.15, 0.28);
    secretCard.visible = false;
    group.add(secretCard);

    // Name card floating in front of them.
    const card = makeCardMesh(name, 0xe6b96a);
    card.mesh.position.set(0, 1.32, 0.42);
    group.add(card.mesh);

    // Place around the table.
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    const SEAT_R = 1.62;
    const px = Math.sin(angle) * SEAT_R;
    const pz = Math.cos(angle) * SEAT_R;
    group.position.set(px, 0, pz);
    group.rotation.y = Math.atan2(-px, -pz);

    scene.add(group);

    const avatar = {
      id,
      name,
      group,
      inner,
      upper: group,       // people.js has no torso pivot; slump tilts the whole group
      chest: group,
      headPivot: group,
      arms: null,
      matList: [ringMat, secretCard.material, card.mat],
      texList: [card.tex],
      mainMat: { emissiveIntensity: 0, color: new THREE.Color(0xe6b96a) },
      accentMat: { emissiveIntensity: 0, color: new THREE.Color(0xe6b96a) },
      ringMat,
      ring,
      t: Math.random() * 10,
      headYaw: 0,
      headYawTarget: 0,
      nextTurn: 1 + Math.random() * 3,
      glow: 0,
      glowTarget: 0,
      flash: 0,
      eliminated: false,
      slump: 0,
      dim: 0,
      label: { canvas: null, tex: null, mat: null, sprite: null },
      secretCard,
      deal: 0,
      look: 0,
    };

    group.traverse((o) => {
      o.userData.playerId = id;
    });

    return avatar;
  }

  function disposeAvatar(a) {
    if (a.inner && a.inner.dispose) a.inner.dispose();
    scene.remove(a.group);
    for (const m of a.matList) if (m && m.dispose) m.dispose();
    for (const t of a.texList) if (t && t.dispose) t.dispose();
    if (a.label.mat && a.label.mat.dispose) a.label.mat.dispose();
    if (a.label.tex && a.label.tex.dispose) a.label.tex.dispose();
  }

  let avatars = [];

  function clearAvatars() {
    for (const a of avatars) disposeAvatar(a);
    avatars = [];
    seats.clear();
  }

  function setPlayers(players) {
    clearAvatars();
    const list = Array.isArray(players) ? players : [];
    avatars = list.map((p, i) => buildAvatar(p, i, list.length));
    for (const a of avatars) seats.set(a.id, a);
  }

  // Deal a secret card to one player, hold their gaze on it, then look away.
  // Returns the duration (seconds) so the caller can pace the cutscene.
  function dealCard(playerId) {
    const a = seats.get(playerId);
    if (!a) return 0;
    a.deal = 1;
    a.look = 1;
    a.headYawTarget = 0;
    setTimeout(() => {
      if (a) a.look = 0; // look away — the role is never exposed to the room
    }, 1200);
    return 2.0;
  }

  function highlight(playerId) {
    for (const a of avatars) a.glowTarget = a.id === playerId ? 1 : 0;
  }

  function vote(voterId, targetId) {
    const from = seats.get(voterId);
    const to = seats.get(targetId);
    if (!from || !to) return;
    const t = acquireToken();
    const a = from.group.position;
    const b = to.group.position;
    t.from.set(a.x, 1.12, a.z);
    t.to.set(b.x, 1.12, b.z);
    t.t = 0;
    t.dur = 0.95;
    t.targetId = targetId;
  }

  function eliminate(playerId) {
    const a = seats.get(playerId);
    if (!a || a.eliminated) return;
    a.eliminated = true;
    a.glowTarget = 0;
    a.slump = 0;
  }

  function revealRoles(revealed) {
    const list = Array.isArray(revealed) ? revealed : [];
    const byId = new Map();
    for (const r of list) if (r && r.id != null) byId.set(r.id, r);
    for (const a of avatars) {
      const r = byId.get(a.id);
      if (!r) continue;
      if (!a.label.sprite) {
        const canvas = cvs(420, 150);
        const tex = new THREE.CanvasTexture(canvas);
        if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.25, 1.25 * (150 / 420), 1);
        sprite.position.set(0, 1.85, 0);
        sprite.renderOrder = 20;
        a.group.add(sprite);
        a.label.canvas = canvas;
        a.label.tex = tex;
        a.label.mat = mat;
        a.label.sprite = sprite;
      }
      drawRole(a.label.canvas, r.roleName, !!r.traitor);
      a.label.tex.needsUpdate = true;
      a.label.sprite.visible = true;
      a.label.sprite.userData.playerId = a.id;
    }
  }

  // ---- palette/lighting easing -------------------------------------------
  function updateLighting(dt) {
    const k = damp(dt, 2.2);
    lightState.hemi += (lightTarget.hemi - lightState.hemi) * k;
    lightState.key += (lightTarget.key - lightState.key) * k;
    lightState.table += (lightTarget.table - lightState.table) * k;
    lightState.accent += (lightTarget.accent - lightState.accent) * k;
    lightState.hemiCol.lerp(lightTarget.hemiCol, k);
    lightState.keyCol.lerp(lightTarget.keyCol, k);
    lightState.tableCol.lerp(lightTarget.tableCol, k);
    lightState.accentCol.lerp(lightTarget.accentCol, k);
    lightState.fogCol.lerp(lightTarget.fogCol, k);
    lightState.bgCol.lerp(lightTarget.bgCol, k);
    lightState.fogNear += (lightTarget.fogNear - lightState.fogNear) * k;
    lightState.fogFar += (lightTarget.fogFar - lightState.fogFar) * k;
    lightState.lean += (lightTarget.lean - lightState.lean) * k;

    hemi.intensity = lightState.hemi;
    hemi.color.copy(lightState.hemiCol);
    key.intensity = lightState.key;
    key.color.copy(lightState.keyCol);
    tableLight.intensity = lightState.table;
    tableLight.color.copy(lightState.tableCol);
    accentLight.intensity = lightState.accent;
    accentLight.color.copy(lightState.accentCol);
    fog.color.copy(lightState.fogCol);
    fog.near = lightState.fogNear;
    fog.far = lightState.fogFar;
    scene.background.copy(lightState.bgCol);
  }

  // ---- avatar animation ---------------------------------------------------
  const grey = new THREE.Color(GREY);

  function updateAvatar(a, dt, time) {
    // Let the reused model breathe and idle.
    if (a.inner && a.inner.update) a.inner.update(dt);

    if (a.eliminated) {
      a.slump = Math.min(1, a.slump + dt * 1.7);
      const sl = easeOut(a.slump);
      a.group.rotation.x = sl * 0.5;
      a.group.position.y = -sl * 0.15;
      a.ring.visible = false;
      return;
    }
    a.group.rotation.x = 0;

    // glow (highlight + vote flash)
    a.flash = Math.max(0, a.flash - dt);
    const effective = Math.max(a.glowTarget, a.flash > 0 ? 1 : 0);
    a.glow += (effective - a.glow) * damp(dt, 6);
    const pulse = 0.85 + Math.sin(time * 4) * 0.15;
    a.ringMat.emissiveIntensity = a.glow * 2.2 * pulse;
    a.ringMat.opacity = a.glow * 0.85;
    a.ring.visible = a.glow > 0.01;
    a.ring.scale.setScalar(0.62 + a.glow * 0.05);

    // the dealt card: slides in, they glance at it, then look away
    if (a.deal > 0 || a.look > 0) {
      a.deal = Math.max(0, a.deal - dt * 1.4);
      a.secretCard.visible = true;
      a.secretCard.position.y = 1.15 + a.deal * 0.35;
      a.secretCard.position.z = 0.28 + a.deal * 0.35;
      a.secretCard.rotation.z = a.deal * 0.5;
      if (a.deal <= 0 && a.look <= 0) a.secretCard.visible = false;
    }
  }


  // ---- vote tokens --------------------------------------------------------
  function updateTokens(dt) {
    for (const tk of tokens) {
      if (!tk.active) continue;
      tk.t += dt / tk.dur;
      if (tk.t >= 1) {
        tk.active = false;
        tk.mesh.visible = false;
        const target = seats.get(tk.targetId);
        if (target && !target.eliminated) target.flash = 0.6;
        continue;
      }
      const s = tk.t;
      tk.mesh.position.lerpVectors(tk.from, tk.to, s);
      tk.mesh.position.y += Math.sin(Math.PI * s) * 0.6;
      tmpDir.subVectors(tk.to, tk.from);
      tmpDir.y = 0;
      if (tmpDir.lengthSq() > 1e-6) {
        tmpDir.normalize();
        tk.mesh.quaternion.setFromUnitVectors(upVec, tmpDir);
      }
    }
  }

  // ---- camera -------------------------------------------------------------
  function updateCamera(dt) {
    if (shot === "orbit") orbitAngle += dt * 0.24;
    const d = desiredShot();
    const k = damp(dt, shot.startsWith("focus:") ? 3.4 : 3.0);
    camPos.lerp(d.pos, k);
    camTarget.lerp(d.target, k);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  // ---- the frame ----------------------------------------------------------
  let time = 0;
  let timeScale = 1;
  function setTimeScale(scale) {
    timeScale = Math.max(0.05, Math.min(1, Number(scale) || 1));
  }

  function update(dt) {
    const d = Math.max(0, Math.min(Number(dt) || 0, 0.05)) * timeScale;
    time += d;

    for (let i = 0; i < flames.length; i++) {
      const n = Math.sin(time * 7 + i * 2.1);
      flames[i].scale.set(0.035 + n * 0.006, 0.06 + n * 0.012, 0.035 + n * 0.006);
    }

    updateLighting(d);
    for (const a of avatars) updateAvatar(a, d, time);
    updateTokens(d);
    updateCamera(d);
    syncSize();

    syncSize();
    if (renderer) renderer.render(scene, camera);
  }

  // ---- teardown -----------------------------------------------------------
  function dispose() {
    clearAvatars();
    for (const tk of tokens) scene.remove(tk.mesh);
    tokens.length = 0;
    scene.remove(room);
    scene.remove(hemi);
    scene.remove(key);
    scene.remove(key.target);
    scene.remove(tableLight);
    scene.remove(accentLight);
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    geoSet.forEach((g) => g.dispose());
    matSet.forEach((m) => m.dispose());
    texSet.forEach((t) => t.dispose());
    geoSet.clear();
    matSet.clear();
    texSet.clear();
    scene.fog = null;
    scene.background = null;
  }

  function avatarObjects() {
    return avatars.map((a) => a.group).filter(Boolean);
  }

  // Two soft fill lights so the room reads even in the dim phases.
  const fillA = new THREE.PointLight(0xffd9a0, 0.5, 16, 2);
  fillA.position.set(4.2, 3.4, 3.6);
  scene.add(fillA);
  const fillB = new THREE.PointLight(0x9fd0ff, 0.4, 16, 2);
  fillB.position.set(-4.4, 3.2, -3.4);
  scene.add(fillB);

  // Seed the lobby mood immediately.
  setPhase("lobby");
  update(0.016);

  return { setPlayers,
    setPhase,
    highlight,
    vote,
    eliminate,
    revealRoles,
    setCameraShot,
    resize, update,
    dispose,
    camera: () => camera,
    dealCard,
    setTimeScale,
    scene: () => scene,
    avatarObjects,
  };
}
