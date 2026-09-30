// people.js — procedural suspects for "Whodunnit" (see contract.md).
//
//   buildSuspects(suspects, anchors, THREE) -> [{
//     id, group, speak(text), setTalking(on), face(yaw), update(dt), dispose()
//   }]
//
// Each suspect is a limbed humanoid assembled only from THREE primitives plus
// canvas-painted textures. No external assets, no network, and no timers other
// than the caller-driven update(dt). `anchors` is parallel to `suspects`:
// anchor[i] belongs to suspects[i] and gives that person's spot and initial yaw.
//
// Orientation: the model is authored looking down +Z with the feet on the group
// origin (y = 0). face(yaw) rotates the whole group about Y, so to look toward a
// horizontal direction (dx, dz) the caller passes yaw = Math.atan2(dx, dz).

export function buildSuspects(suspects, anchors, THREE) {
  const list = Array.isArray(suspects) ? suspects : [];
  const rng = makeRng(seedFrom(list));

  // Deal distinct skin tones and hair colours to the cast so no two match.
  const skins = shuffled(SKIN.length, rng);
  const hairs = shuffled(HAIR.length, rng);

  return list.map((suspect, i) => {
    const look = {
      skin: SKIN[skins[i % skins.length]],
      hair: HAIR[hairs[i % hairs.length]],
      hairStyle: HAIR_STYLES[i % HAIR_STYLES.length],
      outfit: OUTFITS[i % OUTFITS.length], // palette derived from index/id
      height: 1.56 + rng() * 0.28, // 1.56 .. 1.84 m tall
      build: 0.88 + rng() * 0.26, // shoulder / hip width factor
    };
    const anchor = (anchors && anchors[i]) || null;
    return buildOne(suspect, i, look, anchor, THREE, rng);
  });
}

// ---------------------------------------------------------------------------
// Palettes — period-appropriate (1920s-40s): sober suits, evening gowns and
// tweed country coats. Each outfit entry carries its own silhouette `style`.
// ---------------------------------------------------------------------------

const SKIN = ["#f6d3b0", "#e8b98d", "#d29a6a", "#b07a4c", "#8a5a35", "#5d3c26"];
const HAIR = ["#161210", "#2e2018", "#4a3320", "#7a5a30", "#a89b8c", "#6b6b6b"];
const HAIR_STYLES = ["crop", "long", "bun", "hat", "bob"];

const OUTFITS = [
  // 0 — sober navy three-piece
  { style: "suit", coat: "#26313f", trim: "#1b232e", trouser: "#232c38", shirt: "#e9e1cf", accent: "#8c1f28", shoe: "#191418" },
  // 1 — wine evening dress
  { style: "dress", coat: "#5a2632", trim: "#401a24", trouser: "#4a2029", shirt: "#f0e5d6", accent: "#c9a24b", shoe: "#2a1a1c" },
  // 2 — moss tweed country coat
  { style: "coat", coat: "#3d4a34", trim: "#2c3626", trouser: "#333d2b", shirt: "#e4dcc6", accent: "#7a5c2e", shoe: "#241d15" },
  // 3 — camel business suit
  { style: "suit", coat: "#5b4630", trim: "#453321", trouser: "#4b3a28", shirt: "#efe7d6", accent: "#37485a", shoe: "#211a12" },
  // 4 — charcoal gown
  { style: "dress", coat: "#2c2c38", trim: "#1f1f29", trouser: "#26262f", shirt: "#e2ddd0", accent: "#7a2f4a", shoe: "#15151a" },
];

const NOMINAL = 1.77; // reference head-to-toe height used to scale proportions

// ---------------------------------------------------------------------------
// Deterministic helpers (so a given case always dresses the same way)
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedFrom(list) {
  let h = 0x9e3779b9;
  for (const s of list) h = (h ^ hash(String(s && s.id))) >>> 0;
  return h >>> 0;
}

function shuffled(n, rng) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const v = out[i];
    out[i] = out[j];
    out[j] = v;
  }
  return out;
}

// Primitive constructors. `tube` is a cylinder whose origin sits at its TOP, so
// it hangs from a pivot like a bone; `box`/`ball` are placed in one call.
function tube(THREE, rTop, rBottom, len, seg, mat) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
  geo.translate(0, -len / 2, 0);
  return new THREE.Mesh(geo, mat);
}

function box(THREE, w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function ball(THREE, r, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// Faint canvas weave so the cloth never reads as flat plastic.
function fabricTexture(THREE, seed) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const r = makeRng(seed || 1);
  const img = ctx.createImageData(size, size);
  for (let p = 0; p < size * size; p += 1) {
    const v = 208 + Math.floor(r() * 44);
    img.data[p * 4] = v;
    img.data[p * 4 + 1] = v;
    img.data[p * 4 + 2] = v;
    img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeMaterials(THREE, look) {
  const cloth = fabricTexture(THREE, hash(look.outfit.coat));
  const o = look.outfit;
  const m = (color, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.02 }, extra));
  return {
    skin: m(look.skin, { roughness: 0.62, metalness: 0 }),
    hair: m(look.hair, { roughness: 0.5 }),
    coat: m(o.coat, { map: cloth }),
    coatPlain: m(o.trim, { map: cloth }),
    trouser: m(o.trouser, { map: cloth }),
    shirt: m(o.shirt, { roughness: 0.7 }),
    accent: m(o.accent, { roughness: 0.45, metalness: 0.15 }),
    shoe: m(o.shoe, { roughness: 0.4, metalness: 0.1 }),
    eye: m("#241c16", { roughness: 0.25 }),
    brow: m(look.hair, { roughness: 0.5 }),
    mouth: m("#7a3a38", { roughness: 0.5 }),
  };
}

// ---------------------------------------------------------------------------
// Hair styles — small primitive clusters parented to the head pivot
// ---------------------------------------------------------------------------

function addHair(THREE, headPivot, look, M, d) {
  const { headW, headH, headD, s } = d;
  if (look.hairStyle !== "hat") {
    const cap = box(THREE, headW * 1.1, headH * 0.5, headD * 1.1, M.hair, 0, headH * 0.82, -0.006 * s);
    headPivot.add(cap);
  }
  if (look.hairStyle === "long") {
    headPivot.add(box(THREE, headW * 0.92, headH * 1.7, headD * 0.4, M.hair, 0, headH * 0.15, -headD * 0.52));
  } else if (look.hairStyle === "bun") {
    headPivot.add(ball(THREE, headW * 0.3, M.hair, 0, headH * 0.98, -headD * 0.5));
  } else if (look.hairStyle === "bob") {
    for (const side of [-1, 1]) {
      headPivot.add(box(THREE, 0.03 * s, headH * 0.95, headD * 0.92, M.hair, side * (headW / 2 + 0.008 * s), headH * 0.45, -0.01 * s));
    }
  } else if (look.hairStyle === "hat") {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(headW * 1.35, headW * 1.35, 0.02 * s, 16), M.coatPlain);
    brim.position.y = headH * 0.98;
    headPivot.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(headW * 0.72, headW * 0.78, 0.13 * s, 16), M.coatPlain);
    crown.position.y = headH * 0.98 + 0.065 * s;
    headPivot.add(crown);
  }
}

// ---------------------------------------------------------------------------
// Speech bubble — a camera-facing canvas Sprite
// ---------------------------------------------------------------------------

function makeBubble(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 150;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  sprite.renderOrder = 999;
  return { sprite, canvas, ctx, tex };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Repaint the bubble for `text`; returns its world-space height so the caller
// can float it directly above the head.
function drawBubble(THREE, bubble, text) {
  const { ctx, canvas, tex } = bubble;
  const W = 480;
  const pad = 24;
  const font = 30;
  const lh = 38;
  const maxLines = 4;
  const tail = 20;
  const family = 'Georgia, "Times New Roman", serif';

  ctx.font = `600 ${font}px ${family}`;
  const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > W - pad * 2 && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (line && lines.length >= maxLines) lines[lines.length - 1] += " …";
  if (!lines.length) lines.push("…");

  const bodyH = pad * 2 + lines.length * lh;
  const H = bodyH + tail;
  canvas.width = W;
  canvas.height = H;
  ctx.font = `600 ${font}px ${family}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "rgba(247, 236, 214, 0.97)";
  ctx.strokeStyle = "#3a2c22";
  ctx.lineWidth = 3;
  roundRect(ctx, 2, 2, W - 4, bodyH - 4, 18);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(W / 2 - 16, bodyH - 4);
  ctx.lineTo(W / 2, H - 2);
  ctx.lineTo(W / 2 + 16, bodyH - 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#241a12";
  for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i], W / 2, pad + lh * i + lh / 2);
  tex.needsUpdate = true;

  const wWorld = 0.98;
  const hWorld = wWorld * (H / W);
  bubble.sprite.scale.set(wWorld, hWorld, 1);
  return hWorld;
}

// ---------------------------------------------------------------------------
// One suspect
// ---------------------------------------------------------------------------

function buildOne(suspect, index, look, anchor, THREE, rng) {
  const id = suspect && suspect.id != null ? suspect.id : `s${index}`;
  const group = new THREE.Group();
  group.name = `suspect-${id}`;

  const M = makeMaterials(THREE, look);
  const s = look.height / NOMINAL; // vertical scale
  const w = look.build; // horizontal build factor

  // ---- proportions (metres) ----
  const footH = 0.05 * s;
  const footL = 0.24 * s;
  const footW = 0.11 * s;
  const shin = 0.4 * s;
  const thigh = 0.39 * s;
  const legR = 0.055 * s * w;
  const hipH = 0.15 * s;
  const hipW = 0.3 * s * w;
  const hipD = 0.19 * s;
  const torsoH = 0.33 * s;
  const torsoW = 0.31 * s * w;
  const torsoD = 0.2 * s;
  const chestH = 0.17 * s;
  const chestW = 0.4 * s * w;
  const chestD = 0.22 * s;
  const neckH = 0.06 * s;
  const neckR = 0.052 * s;
  const headW = 0.19 * s;
  const headH = 0.22 * s;
  const headD = 0.2 * s;
  const armR = 0.045 * s * w;
  const upperArm = 0.29 * s;
  const foreArm = 0.26 * s;

  // ---- vertical stack, floor upward ----
  const yHipBottom = footH + shin + thigh;
  const yHipTop = yHipBottom + hipH;
  const yHeadTop = yHipTop + torsoH + chestH + neckH + headH;

  // ---- legs and feet ----
  const legMat = look.outfit.style === "dress" ? M.skin : M.trouser;
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * (hipW / 2 - legR), yHipBottom, 0);
    leg.add(tube(THREE, legR * 1.08, legR, thigh, 8, legMat));
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    knee.add(tube(THREE, legR, legR * 0.82, shin, 8, legMat));
    knee.add(box(THREE, footW, footH, footL, M.shoe, 0, -shin + footH / 2, footL * 0.16));
    leg.add(knee);
    group.add(leg);
  }

  // ---- hips ----
  const hips = box(THREE, hipW, hipH, hipD, look.outfit.style === "dress" ? M.coat : M.trouser, 0, yHipBottom + hipH / 2, 0);
  group.add(hips);

  // Evening-dress skirt flaring from the waist over the thighs.
  if (look.outfit.style === "dress") {
    const skirtH = 0.46 * s;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(hipW * 0.55, hipW * 1.05, skirtH, 10), M.coat);
    skirt.position.y = yHipTop - skirtH / 2 + 0.02 * s;
    group.add(skirt);
  }

  // ---- upper body (pivots at the waist so it can sway and breathe) ----
  const body = new THREE.Group();
  body.position.set(0, yHipTop, 0);
  group.add(body);

  const torso = box(THREE, torsoW, torsoH, torsoD, M.coat, 0, torsoH / 2, 0);
  body.add(torso);
  const chest = box(THREE, chestW, chestH, chestD, M.coat, 0, torsoH + chestH / 2, 0);
  body.add(chest);

  // shirt panel plus a tie / cravat / necklace accent
  body.add(box(THREE, chestW * 0.26, chestH * 0.92, 0.012 * s, M.shirt, 0, torsoH + chestH * 0.5, chestD / 2 + 0.004 * s));
  body.add(box(THREE, 0.05 * s, chestH * 0.7, 0.014 * s, M.accent, 0, torsoH + chestH * 0.48, chestD / 2 + 0.012 * s));

  // long coat tails for the tweed country outfit
  if (look.outfit.style === "coat") {
    body.add(box(THREE, torsoW * 1.08, 0.3 * s, torsoD * 1.12, M.coatPlain, 0, -0.1 * s, 0));
  }

  const neck = tube(THREE, neckR, neckR * 1.15, neckH, 8, M.skin);
  neck.position.y = torsoH + chestH + neckH;
  body.add(neck);

  // ---- arms (shoulder pivots, slight hang, moving hands) ----
  const arms = {};
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (chestW / 2 + armR * 0.4), torsoH + chestH * 0.86, 0);
    shoulder.rotation.z = -side * 0.14;
    shoulder.add(tube(THREE, armR, armR * 0.9, upperArm, 8, M.coat));
    const elbow = new THREE.Group();
    elbow.position.y = -upperArm;
    elbow.add(tube(THREE, armR * 0.9, armR * 0.72, foreArm, 8, M.coat));
    elbow.add(box(THREE, armR * 1.5, armR * 2.2, armR * 1.1, M.skin, 0, -foreArm - armR * 0.6, 0));
    shoulder.add(elbow);
    body.add(shoulder);
    arms[side < 0 ? "left" : "right"] = shoulder;
  }

  // ---- head, face and hair ----
  const headPivot = new THREE.Group();
  headPivot.position.y = torsoH + chestH + neckH;
  body.add(headPivot);

  const head = box(THREE, headW, headH, headD, M.skin, 0, headH / 2, 0);
  headPivot.add(head);
  const faceZ = headD / 2;
  for (const side of [-1, 1]) {
    headPivot.add(box(THREE, 0.03 * s, 0.02 * s, 0.012 * s, M.eye, side * 0.045 * s, headH * 0.6, faceZ + 0.004 * s));
    const brow = box(THREE, 0.05 * s, 0.011 * s, 0.012 * s, M.brow, side * 0.045 * s, headH * 0.71, faceZ + 0.004 * s);
    brow.rotation.z = -side * 0.12;
    headPivot.add(brow);
  }
  headPivot.add(box(THREE, 0.022 * s, 0.034 * s, 0.03 * s, M.skin, 0, headH * 0.52, faceZ + 0.012 * s)); // nose

  const mouthY = headH * 0.34;
  const mouth = box(THREE, 0.06 * s, 0.013 * s, 0.014 * s, M.mouth, 0, mouthY, faceZ + 0.004 * s);
  headPivot.add(mouth);

  addHair(THREE, headPivot, look, M, { headW, headH, headD, s });

  // ---- speech bubble, parked just above the head ----
  const bubble = makeBubble(THREE);
  const bubbleY = yHeadTop + 0.14;
  bubble.sprite.position.set(0, bubbleY, 0);
  group.add(bubble.sprite);

  // Every renderable carries the suspect id so the integrator can raycast a click.
  group.traverse((o) => {
    if (o.isMesh || o.isSprite) o.userData.suspectId = id;
  });

  // ---- placement ----
  if (anchor) {
    const p = anchor.position || [0, 0, 0];
    group.position.set(p[0] || 0, p[1] || 0, p[2] || 0);
    group.rotation.y = Number(anchor.facing) || 0;
  }

  // ---- animation state ----
  const st = {
    t: 0,
    phase: rng() * 10,
    talking: false,
    talkPhase: 0,
    headYaw: 0,
    headYawTarget: 0,
    nextTurn: 1 + rng() * 3,
    bubbleTime: 0,
    bubbleBaseY: bubbleY,
  };

  function update(dt) {
    const d = Math.max(0, Math.min(Number(dt) || 0, 0.05));
    st.t += d;
    const t = st.t + st.phase;

    // gentle breathing (chest swells, whole body lifts a touch)
    const breath = Math.sin(t * 1.7) * 0.5 + 0.5;
    chest.scale.set(1 + breath * 0.015, 1 + breath * 0.025, 1 + breath * 0.015);
    body.position.y = yHipTop + breath * 0.004 * s;

    // slow weight shift
    body.rotation.z = Math.sin(t * 0.45) * 0.022;
    body.position.x = Math.sin(t * 0.45) * 0.007 * s;

    // arms drift with the breathing
    arms.left.rotation.x = Math.sin(t * 0.6 + 1) * 0.035;
    arms.right.rotation.x = Math.sin(t * 0.6) * 0.035;

    // occasional slow head turn
    if (t > st.nextTurn) {
      st.headYawTarget = (rng() * 2 - 1) * 0.55;
      st.nextTurn = t + 2.5 + rng() * 4.5;
    }
    st.headYaw += (st.headYawTarget - st.headYaw) * Math.min(1, d * 2.2);
    headPivot.rotation.y = st.headYaw;
    headPivot.rotation.x = Math.sin(t * 1.1) * 0.02;

    // talking: small jaw + head motion
    if (st.talking) {
      st.talkPhase += d * 12;
      const open = Math.sin(st.talkPhase) * 0.5 + 0.5;
      mouth.scale.y = 1 + open * 1.7;
      mouth.position.y = mouthY - open * 0.006 * s;
      headPivot.rotation.x += Math.sin(st.talkPhase * 0.5) * 0.035;
      headPivot.rotation.y = st.headYaw + Math.sin(st.talkPhase * 0.33) * 0.07;
    } else {
      mouth.scale.y += (1 - mouth.scale.y) * Math.min(1, d * 8);
      mouth.position.y += (mouthY - mouth.position.y) * Math.min(1, d * 8);
    }

    // bubble lifetime + gentle bob
    if (bubble.sprite.visible) {
      st.bubbleTime -= d;
      if (st.bubbleTime <= 0) bubble.sprite.visible = false;
      else bubble.sprite.position.y = st.bubbleBaseY + Math.sin(t * 2.2) * 0.015;
    }
  }

  function speak(text) {
    const hWorld = drawBubble(THREE, bubble, text);
    st.bubbleBaseY = bubbleY + hWorld / 2;
    bubble.sprite.position.set(0, st.bubbleBaseY, 0);
    bubble.sprite.visible = true;
    st.bubbleTime = 5.5;
  }

  function setTalking(on) {
    st.talking = !!on;
    if (!st.talking) st.talkPhase = 0;
  }

  function face(yaw) {
    const y = Number(yaw);
    group.rotation.y = Number.isFinite(y) ? y : 0;
    st.headYaw = 0;
    st.headYawTarget = 0;
    headPivot.rotation.y = 0;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    group.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const key of ["map", "normalMap", "alphaMap", "emissiveMap", "roughnessMap", "metalnessMap"]) {
          if (m[key] && m[key].dispose) m[key].dispose();
        }
        if (m.dispose) m.dispose();
      }
    });
  }

  return { id, group, speak, setTalking, face, update, dispose };
}
