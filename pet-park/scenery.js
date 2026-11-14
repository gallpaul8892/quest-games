// scenery.js — stylised low-poly park scenery for the WebXR pet park (three r160).
//
//   import { buildScenery } from './scenery.js';
//   const scenery = buildScenery(scene, renderer, { seed: 1234 });
//   // each frame:  scenery.update(dt, t, playerPos)
//   // after a user gesture:  scenery.ambience.start(audioContext)
//
// Everything is procedural: no textures or audio files are downloaded.
// Budget: ~12 draw calls, ~100k triangles. Scenery itself casts no shadows
// (blob shadows are baked in as decals); the ground receives the sun's shadow.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x, y, z) { return hash2(Math.imul(x | 0, 1597334677) ^ (y | 0), z | 0); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- layout constants
const FENCE_R = 13.4;
const GATE_ANGLE = Math.PI / 2;      // gate opening towards +Z (behind the player's start)
const SKY_R = 52;                     // keep inside the game's camera far plane (60)
const GROUND_R = 54;
const FOG_NEAR = 20, FOG_FAR = 50;

// Rolling hills only outside the park; inside r<16 the ground is perfectly flat (y=0).
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < 16) return 0;
  const k = smooth(16, 36, r);
  return k * (0.6 + fbm(x * 0.05 + 11.3, z * 0.05 - 4.7, 3) * 8.5);
}

// ---------------------------------------------------------------- geometry helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Convert to non-indexed position/normal/color geometry, per-face colour jitter, then transform. */
function prep(geo, hex, rnd, { jitter = 0.07, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], shade = null } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(scale[0], scale[1], scale[2]));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(hex);
  const P = g.attributes.position.array;
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rnd() - 0.5) * 2 * jitter;
    for (let j = 0; j < 3; j++) {
      let kk = k;
      if (shade) kk *= shade(P[(i + j) * 3], P[(i + j) * 3 + 1], P[(i + j) * 3 + 2]);
      col[(i + j) * 3] = _c.r * kk; col[(i + j) * 3 + 1] = _c.g * kk; col[(i + j) * 3 + 2] = _c.b * kk;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Lumpy low-poly blob: icosahedron with deterministic per-vertex displacement (no cracks). */
function blob(radius, detail, amp, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + (hash3(Math.round(x * 997) + seed, Math.round(y * 991), Math.round(z * 983)) - 0.5) * 2 * amp;
    p.setXYZ(i, x * d, y * d, z * d);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- textures
function makeGrassTexture(renderer, rnd) {
  const S = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#5f9a3e'; g.fillRect(0, 0, S, S);
  // soft low-frequency blotches (tileable: draw wrapped copies)
  const wrapDraw = (fn, x, y, r) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox + r < 0 || x + ox - r > S || y + oy + r < 0 || y + oy - r > S) continue;
      fn(x + ox, y + oy);
    }
  };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 80;
    const light = rnd() < 0.5;
    wrapDraw((cx, cy) => {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, light ? 'rgba(150,190,80,0.22)' : 'rgba(40,90,40,0.22)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }, x, y, r);
  }
  // blades
  const cols = ['#4f8a33', '#6aa845', '#78b54d', '#3f7a2c', '#86bf55', '#5c9a3a', '#93c463', '#467f30'];
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S, len = 5 + rnd() * 11, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.1;
    g.strokeStyle = cols[(rnd() * cols.length) | 0];
    g.globalAlpha = 0.45 + rnd() * 0.5;
    g.lineWidth = 1 + rnd() * 1.6;
    wrapDraw((cx, cy) => {
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); g.stroke();
    }, x, y, len);
  }
  // tiny specks (clover / dry bits)
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.35 + rnd() * 0.4;
    g.fillStyle = rnd() < 0.7 ? '#a7cf6d' : '#b5a95a';
    g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeBlobTexture() {
  const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// ---------------------------------------------------------------- main
export function buildScenery(scene, renderer, opts = {}) {
  const seed = opts.seed ?? 20241114;
  const rnd = mulberry32(seed);
  const root = new THREE.Group(); root.name = 'scenery';
  scene.add(root);
  const timeU = { value: 0 };

  // ---- palette (sRGB hex; THREE.Color converts to linear)
  const SKY_TOP = new THREE.Color(0x3f8fe0), SKY_HORIZON = new THREE.Color(0xcfe6ee), SKY_BOTTOM = new THREE.Color(0xb9d3c4);
  const SUN_DIR = new THREE.Vector3(0.55, 0.78, 0.42).normalize(); // afternoon sun behind-right of the start view

  // ---- renderer / fog
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.Fog(SKY_HORIZON.clone(), FOG_NEAR, FOG_FAR);
  scene.background = SKY_HORIZON.clone();

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xd6ebff, 0x7d8f4f, 1.05);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const SH = 8;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  root.add(sun); root.add(sun.target);

  // texel-snapped shadow follow (prevents shimmering as the player moves)
  const lRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const lUp = new THREE.Vector3().crossVectors(SUN_DIR, lRight).normalize();
  const texel = (2 * SH) / 1024;
  const _tp = new THREE.Vector3();
  function setShadowTarget(pos) {
    _tp.set(pos ? pos.x : 0, 0, pos ? pos.z : 0);
    const a = Math.round(_tp.dot(lRight) / texel) * texel;
    const b = Math.round(_tp.dot(lUp) / texel) * texel;
    const c = _tp.dot(SUN_DIR);
    _tp.copy(lRight).multiplyScalar(a).addScaledVector(lUp, b).addScaledVector(SUN_DIR, c);
    sun.target.position.copy(_tp);
    sun.position.copy(_tp).addScaledVector(SUN_DIR, 35);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  setShadowTarget(null);

  // ---- sky dome (follows the player horizontally)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, bottom: { value: SKY_BOTTOM },
      sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color(0xfff2d0) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, horizon, bottom, sunDir, sunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.15, 1.0), 0.6))
                         : mix(horizon, bottom, pow(min(-h * 5.0, 1.0), 0.7));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 5.0) * 0.18 + pow(s, 60.0) * 0.35 + smoothstep(0.9990, 0.9995, s) * 1.5);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 16), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; sky.name = 'sky';
  root.add(sky);

  // ---- clouds (one InstancedMesh, drifting group)
  const cloudParts = [];
  {
    const cr = mulberry32(seed + 7);
    const puffs = [[0, 0, 0, 1.0], [1.1, -0.15, 0.2, 0.8], [-1.1, -0.2, -0.1, 0.75], [0.4, 0.35, -0.3, 0.7], [-0.5, 0.25, 0.35, 0.65], [1.9, -0.35, 0.0, 0.5], [-1.9, -0.35, 0.1, 0.5]];
    for (let i = 0; i < puffs.length; i++) {
      const [x, y, z, r] = puffs[i];
      cloudParts.push(prep(blob(r, 1, 0.12, 300 + i), 0xffffff, cr, {
        jitter: 0.03, pos: [x, y, z], scale: [1, 0.8, 1],
        shade: (px, py) => 0.80 + 0.2 * smooth(-0.6, 0.6, py),
      }));
    }
  }
  const cloudGeo = mergeGeometries(cloudParts);
  // flatten bottoms
  { const p = cloudGeo.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.35) p.setY(i, -0.35); cloudGeo.computeVertexNormals(); }
  const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x9fb2c4, fog: false });
  const NCLOUD = 11;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, NCLOUD);
  for (let i = 0; i < NCLOUD; i++) {
    const a = (i / NCLOUD) * Math.PI * 2 + rnd() * 0.4;
    const r = 27 + rnd() * 13;
    const s = 2.4 + rnd() * 2.2;
    _m.compose(_p.set(Math.cos(a) * r, 13 + rnd() * 9, Math.sin(a) * r), _q.setFromEuler(_e.set(0, rnd() * 6.28, 0)), _s.set(s * (1 + rnd() * 0.6), s * 0.85, s));
    clouds.setMatrixAt(i, _m);
  }
  clouds.frustumCulled = false; clouds.name = 'clouds';
  const cloudGroup = new THREE.Group(); cloudGroup.add(clouds); root.add(cloudGroup);

  // ---- ground (polar mesh, vertex colours: mown path ring, variation, distant tint)
  const grassTex = makeGrassTexture(renderer, mulberry32(seed + 1));
  {
    const radii = [];
    for (let r = 0; r < 16; r += 0.5) radii.push(r);
    for (let r = 16; r < 24; r += 1) radii.push(r);
    for (let r = 24; r <= GROUND_R; r += 2.5) radii.push(r);
    const SEG = 96;
    const pos = [], uv = [], col = [], idx = [];
    const TILE = 2.6;
    for (let ri = 0; ri < radii.length; ri++) {
      const r = radii[ri];
      const segs = ri === 0 ? 1 : SEG;
      for (let s = 0; s < segs; s++) {
        const a = (s / SEG) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, y = groundHeight(x, z);
        pos.push(x, y, z); uv.push(x / TILE, z / TILE);
        // colour multiplier
        let k = 0.9 + fbm(x * 0.18 + 3, z * 0.18 - 7, 3) * 0.22;
        const path = smooth(9.55, 9.85, r) * (1 - smooth(10.55, 10.85, r));
        let cr = k, cg = k, cb = k;
        // mown path: darker, slightly bluer green with subtle stripe banding
        const stripe = 0.96 + 0.04 * Math.sin(a * 60);
        cr *= 1 - path * 0.34 * stripe; cg *= 1 - path * 0.2 * stripe; cb *= 1 - path * 0.26;
        // centre: very slightly worn/yellower
        const centre = 1 - smooth(1.5, 3.2, r);
        cr *= 1 + centre * 0.08; cb *= 1 - centre * 0.08;
        // outside fence: meadow tint, warmer on hills
        const out = smooth(14, 30, r);
        cr *= 1 + out * 0.12; cg *= 1 + out * 0.02; cb *= 1 - out * 0.15;
        col.push(cr, cg, cb);
      }
    }
    // centre fan
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
    for (let ri = 1; ri < radii.length - 1; ri++) {
      const b0 = 1 + (ri - 1) * SEG, b1 = 1 + ri * SEG;
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG;
        idx.push(b0 + s, b0 + s1, b1 + s);
        idx.push(b0 + s1, b1 + s1, b1 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // flip winding if needed so normals face up
    if (g.attributes.normal.getY(5) < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true }));
    ground.receiveShadow = true; ground.name = 'ground';
    root.add(ground);
  }

  // ---- placement bookkeeping
  const placed = []; // {x,z,r}
  const free = (x, z, r) => { for (const o of placed) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false; return true; };
  const reserve = (x, z, r) => placed.push({ x, z, r });
  const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  const blobs = []; // blob shadows: [x, z, radius, strength]

  // pond (front-left of the start view, between ~10.7 and 13.2 m)
  const POND_A = -Math.PI / 2 - 0.78, POND_R = 11.95, POND_AX = 2.5, POND_AZ = 1.15;
  const [pondX, pondZ] = polar(POND_A, POND_R);
  const pondRot = -POND_A - Math.PI / 2; // long axis tangential
  reserve(pondX, pondZ, 2.9);
  const inPond = (x, z, m = 0) => {
    const dx = x - pondX, dz = z - pondZ, c = Math.cos(-pondRot), s = Math.sin(-pondRot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c; // into pond local frame
    return (lx / (POND_AX + m)) ** 2 + (lz / (POND_AZ + m)) ** 2 < 1;
  };
  // benches
  const benchSpots = [[-0.42, 11.7], [Math.PI * 0.62, 11.7], [Math.PI * 1.08, 11.7]];
  for (const [a, r] of benchSpots) { const [x, z] = polar(a, r); reserve(x, z, 1.1); }
  // gate keep-clear
  { const [x, z] = polar(GATE_ANGLE, FENCE_R); reserve(x, z, 1.6); }

  // ---- props: merged vertex-coloured flat-shaded geometry, bucketed by sector for frustum culling
  const NSECT = 4;
  const nearBuckets = Array.from({ length: NSECT }, () => []);
  const farBucket = [];
  const bucketFor = (x, z) => nearBuckets[Math.floor(((Math.atan2(z, x) + Math.PI * 2 + Math.PI / 4) % (Math.PI * 2)) / (Math.PI * 2 / NSECT)) % NSECT];
  const addNear = (x, z, geos) => { const b = bucketFor(x, z); for (const g of geos) b.push(g); };

  const TRUNK = 0x7a5534, TRUNK_DK = 0x5e4129;
  const LEAF = [0x4f9a3a, 0x5aa83f, 0x3f8a3a, 0x6db443, 0x468f36];
  const PINE = [0x2f6d3e, 0x2a6438, 0x387a45];
  const BIRCH_LEAF = [0x8cc455, 0x9ccf5d, 0x7fbb4c];
  const BLOSSOM = [0xf2a7c4, 0xf6bdd3, 0xeb93b5];

  function roundTree(x, z, s, r, far = false) {
    const y = groundHeight(x, z);
    const out = [];
    const lean = (r() - 0.5) * 0.08;
    out.push(prep(new THREE.CylinderGeometry(0.11 * s, 0.19 * s, 1.9 * s, far ? 5 : 6), TRUNK, r, { pos: [x, y + 0.95 * s, z], rot: [lean, 0, lean] }));
    const leaf = LEAF[(r() * LEAF.length) | 0];
    const n = far ? 2 : 3 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, d = i === 0 ? 0 : 0.55 * s;
      const rr = (i === 0 ? 1.05 : 0.7 + r() * 0.25) * s;
      const hy = (i === 0 ? 2.45 : 2.0 + r() * 0.8) * s;
      out.push(prep(blob(rr, far ? 0 : 1, 0.16, (r() * 1e6) | 0), leaf, r, {
        jitter: 0.09, pos: [x + Math.cos(a) * d, y + hy, z + Math.sin(a) * d], scale: [1, 0.88, 1],
        shade: (px, py) => 0.72 + 0.34 * smooth(y + hy - rr, y + hy + rr, py),
      }));
    }
    return out;
  }
  function blossomTree(x, z, s, r) {
    const y = groundHeight(x, z), out = [];
    out.push(prep(new THREE.CylinderGeometry(0.1 * s, 0.17 * s, 1.5 * s, 6), TRUNK_DK, r, { pos: [x, y + 0.75 * s, z] }));
    const leaf = BLOSSOM[(r() * BLOSSOM.length) | 0];
    for (let i = 0; i < 4; i++) {
      const a = r() * 6.28, d = i === 0 ? 0 : 0.6 * s, rr = (i === 0 ? 0.95 : 0.65) * s, hy = (i === 0 ? 2.0 : 1.7 + r() * 0.5) * s;
      out.push(prep(blob(rr, 1, 0.16, (r() * 1e6) | 0), leaf, r, {
        jitter: 0.07, pos: [x + Math.cos(a) * d, y + hy, z + Math.sin(a) * d], scale: [1, 0.8, 1],
        shade: (px, py) => 0.8 + 0.25 * smooth(y + hy - rr, y + hy + rr, py),
      }));
    }
    return out;
  }
  function pineTree(x, z, s, r, far = false) {
    const y = groundHeight(x, z), out = [];
    out.push(prep(new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 1.2 * s, 5), TRUNK_DK, r, { pos: [x, y + 0.6 * s, z] }));
    const leaf = PINE[(r() * PINE.length) | 0];
    const tiers = far ? 2 : 3;
    for (let i = 0; i < tiers; i++) {
      const rr = (1.15 - i * (far ? 0.4 : 0.3)) * s, hh = (1.5 - i * 0.2) * s, hy = (1.35 + i * (far ? 1.1 : 0.85)) * s;
      out.push(prep(new THREE.ConeGeometry(rr, hh, far ? 6 : 8, 1), leaf, r, {
        jitter: 0.08, pos: [x, y + hy, z], rot: [0, r() * 6.28, 0],
        shade: (px, py) => 0.75 + 0.3 * smooth(y + hy - hh / 2, y + hy + hh / 2, py),
      }));
    }
    return out;
  }
  function birchTree(x, z, s, r) {
    const y = groundHeight(x, z), out = [];
    out.push(prep(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, 2.6 * s, 5), 0xeae6dc, r, {
      jitter: 0.12, pos: [x, y + 1.3 * s, z],
      shade: (px, py) => (Math.sin(py * 23.0) > 0.75 ? 0.35 : 1.0),
    }));
    const leaf = BIRCH_LEAF[(r() * BIRCH_LEAF.length) | 0];
    for (let i = 0; i < 3; i++) {
      const a = r() * 6.28, d = i === 0 ? 0 : 0.35 * s, rr = (i === 0 ? 0.7 : 0.5) * s, hy = (2.6 + (i === 0 ? 0.3 : r() * 0.5)) * s;
      out.push(prep(blob(rr, 1, 0.18, (r() * 1e6) | 0), leaf, r, {
        jitter: 0.08, pos: [x + Math.cos(a) * d, y + hy, z + Math.sin(a) * d], scale: [0.9, 1.15, 0.9],
        shade: (px, py) => 0.75 + 0.3 * smooth(y + hy - rr, y + hy + rr, py),
      }));
    }
    return out;
  }
  function bush(x, z, s, r, flowers = false) {
    const y = groundHeight(x, z), out = [];
    const leaf = [0x3d7f32, 0x4a8d38, 0x568f3a][(r() * 3) | 0];
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, d = i === 0 ? 0 : 0.32 * s, rr = (i === 0 ? 0.5 : 0.36) * s;
      out.push(prep(blob(rr, 1, 0.2, (r() * 1e6) | 0), leaf, r, {
        jitter: 0.1, pos: [x + Math.cos(a) * d, y + rr * 0.6, z + Math.sin(a) * d], scale: [1, 0.78, 1],
        shade: (px, py) => 0.68 + 0.36 * smooth(y, y + rr * 1.3, py),
      }));
    }
    if (flowers) {
      const fc = [0xffffff, 0xffd84a, 0xe86a8a, 0xb07ae0][(r() * 4) | 0];
      for (let i = 0; i < 7; i++) {
        const a = r() * 6.28, el = 0.3 + r() * 0.9, rr = 0.5 * s;
        out.push(prep(new THREE.OctahedronGeometry(0.055 * s, 0), fc, r, {
          jitter: 0.05, pos: [x + Math.cos(a) * Math.cos(el) * rr * 0.95, y + 0.3 * s + Math.sin(el) * rr * 0.7, z + Math.sin(a) * Math.cos(el) * rr * 0.95],
        }));
      }
    }
    return out;
  }
  function rock(x, z, s, r, y0 = null) {
    const y = y0 ?? groundHeight(x, z);
    const g = new THREE.DodecahedronGeometry(s, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const d = 1 + (hash3(Math.round(vx * 900), Math.round(vy * 900) + 77, Math.round(vz * 900)) - 0.5) * 0.45;
      p.setXYZ(i, vx * d, vy * d, vz * d);
    }
    const base = [0x9a9890, 0x8c8a84, 0xa7a398, 0x85827a][(r() * 4) | 0];
    return [prep(g, base, r, {
      jitter: 0.1, pos: [x, y + s * 0.15, z], rot: [r() * 0.5, r() * 6.28, r() * 0.5], scale: [1.2, 0.6, 1],
      shade: (px, py) => (py > y + s * 0.4 && r() < 0.5 ? 0.85 : 1.0) * (0.85 + 0.2 * smooth(y, y + s * 0.6, py)),
    })];
  }
  function bench(a, rad, r) {
    const [x, z] = polar(a, rad);
    const rot = Math.PI / 2 - a; // sitter faces the centre
    const g = new THREE.Group(); // build in local space then bake
    const parts = [];
    const WOOD = 0xa8743f, IRON = 0x33363a;
    const add = (geo, hex, px, py, pz, rx = 0) => parts.push({ geo, hex, px, py, pz, rx });
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.6, 0.04, 0.12), WOOD, 0, 0.45, -0.16 + i * 0.15);
    for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(1.6, 0.12, 0.035), WOOD, 0, 0.66 + i * 0.17, 0.26, -0.18);
    for (const sx of [-0.68, 0.68]) {
      add(new THREE.BoxGeometry(0.05, 0.45, 0.05), IRON, sx, 0.225, -0.2);
      add(new THREE.BoxGeometry(0.05, 0.9, 0.05), IRON, sx, 0.45, 0.24, -0.18);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.5), IRON, sx, 0.43, 0.02);
      add(new THREE.BoxGeometry(0.06, 0.04, 0.42), IRON, sx, 0.64, -0.02);
    }
    const out = [];
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
    for (const pt of parts) {
      const geo = prep(pt.geo, pt.hex, r, { jitter: 0.08, pos: [pt.px, pt.py, pt.pz], rot: [pt.rx, 0, 0] });
      geo.applyMatrix4(M);
      out.push(geo);
    }
    blobs.push([x, z, 1.0, 0.55]);
    return { x, z, out };
  }
  function lamp(x, z, r) {
    const out = [];
    const IRON = 0x2f3236;
    out.push(prep(new THREE.CylinderGeometry(0.05, 0.08, 2.4, 6), IRON, r, { pos: [x, 1.2, z] }));
    out.push(prep(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 6), IRON, r, { pos: [x, 0.06, z] }));
    out.push(prep(new THREE.CylinderGeometry(0.12, 0.09, 0.28, 6), 0xfff1b8, r, { jitter: 0.02, pos: [x, 2.5, z] }));
    out.push(prep(new THREE.ConeGeometry(0.2, 0.18, 6), IRON, r, { pos: [x, 2.73, z] }));
    blobs.push([x, z, 0.35, 0.45]);
    return out;
  }

  // -- benches + lamps
  for (const [a, rad] of benchSpots) {
    const b = bench(a, rad, rnd);
    addNear(b.x, b.z, b.out);
    const [lx, lz] = polar(a + 0.115, rad + 0.25);
    addNear(lx, lz, lamp(lx, lz, rnd));
    // flowering bushes flanking the bench
    const [bx, bz] = polar(a - 0.12, rad + 0.5);
    addNear(bx, bz, bush(bx, bz, 0.8, rnd, true)); blobs.push([bx, bz, 0.6, 0.5]);
  }

  // -- picket fence ring
  {
    const WHITE = 0xece6d6;
    const gateHalf = 0.8 / FENCE_R; // angular half-width of the opening
    const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
    const nPost = Math.round((Math.PI * 2 * FENCE_R) / 2.2);
    // distribute posts evenly over the arc excluding the gate
    const arc = Math.PI * 2 - 2 * gateHalf;
    const postA = [];
    for (let i = 0; i <= nPost; i++) postA.push(GATE_ANGLE + gateHalf + (i / nPost) * arc);
    for (let i = 0; i < postA.length; i++) {
      const a = postA[i], [x, z] = polar(a, FENCE_R + 0.04);
      const isGate = i === 0 || i === postA.length - 1;
      const h = isGate ? 1.15 : 0.98;
      const pg = [prep(new THREE.BoxGeometry(isGate ? 0.14 : 0.1, h, isGate ? 0.14 : 0.1), WHITE, rnd, { jitter: 0.04, pos: [x, h / 2, z], rot: [0, -a - Math.PI / 2, 0] })];
      pg.push(prep(new THREE.ConeGeometry(isGate ? 0.12 : 0.085, 0.09, 4), WHITE, rnd, { jitter: 0.04, pos: [x, h + 0.045, z], rot: [0, -a - Math.PI / 2 + Math.PI / 4, 0] }));
      if (isGate) pg.push(prep(new THREE.IcosahedronGeometry(0.07, 0), WHITE, rnd, { pos: [x, h + 0.13, z] }));
      addNear(x, z, pg);
      if (i < postA.length - 1) {
        const a2 = postA[i + 1], am = (a + a2) / 2, half = (a2 - a) / 2;
        const len = 2 * (FENCE_R + 0.07) * Math.sin(half);
        const [mx, mz] = polar(am, (FENCE_R + 0.07) * Math.cos(half));
        const rails = [];
        for (const ry of [0.26, 0.62]) rails.push(prep(new THREE.BoxGeometry(len, 0.06, 0.035), WHITE, rnd, { jitter: 0.03, pos: [mx, ry, mz], rot: [0, -am - Math.PI / 2, 0] }));
        // pickets
        const nP = Math.max(1, Math.round(len / 0.19));
        for (let k = 0; k < nP; k++) {
          const pa = a + (2 * half) * ((k + 0.5) / nP);
          if (Math.abs(angDiff(pa, a)) < 0.004 || Math.abs(angDiff(pa, a2)) < 0.004) continue;
          const [px, pz] = polar(pa, FENCE_R);
          const ph = 0.78 + (k % 2) * 0.0;
          rails.push(prep(new THREE.BoxGeometry(0.085, ph, 0.025), WHITE, rnd, { jitter: 0.05, pos: [px, ph / 2, pz], rot: [0, -pa - Math.PI / 2, 0] }));
          rails.push(prep(new THREE.ConeGeometry(0.06, 0.09, 4), WHITE, rnd, { jitter: 0.05, pos: [px, ph + 0.045, pz], rot: [0, -pa - Math.PI / 2 + Math.PI / 4, 0], scale: [1, 1, 0.42] }));
        }
        addNear(mx, mz, rails);
      }
    }
  }

  // -- pond decor (sand bank is part of the water mesh; stones, reeds, lily pads here)
  {
    const pr = mulberry32(seed + 33);
    const c = Math.cos(pondRot), s = Math.sin(pondRot);
    const toWorld = (lx, lz) => [pondX + lx * c + lz * s, pondZ - lx * s + lz * c];
    const out = [];
    const nStones = 26;
    for (let i = 0; i < nStones; i++) {
      const t = (i / nStones) * Math.PI * 2 + pr() * 0.1;
      const k = 1.08 + pr() * 0.06;
      const [x, z] = toWorld(Math.cos(t) * POND_AX * k, Math.sin(t) * POND_AZ * k * 1.05);
      out.push(...rock(x, z, 0.14 + pr() * 0.12, pr, -0.03));
    }
    // reeds + cattails at the outer end
    for (let i = 0; i < 26; i++) {
      const t = Math.PI * (0.62 + pr() * 0.5) + (pr() < 0.4 ? Math.PI : 0);
      const k = 0.9 + pr() * 0.25;
      const [x, z] = toWorld(Math.cos(t) * POND_AX * k, Math.sin(t) * POND_AZ * k);
      const h = 0.5 + pr() * 0.6;
      out.push(prep(new THREE.ConeGeometry(0.025, h, 3), 0x5f8f3a, pr, { pos: [x, h / 2, z], rot: [(pr() - 0.5) * 0.25, 0, (pr() - 0.5) * 0.25] }));
      if (pr() < 0.4) out.push(prep(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 5), 0x6b4527, pr, { pos: [x, h * 0.85, z] }));
    }
    // lily pads
    for (let i = 0; i < 9; i++) {
      const t = pr() * Math.PI * 2, k = 0.25 + pr() * 0.55;
      const [x, z] = toWorld(Math.cos(t) * POND_AX * k, Math.sin(t) * POND_AZ * k);
      const rr = 0.13 + pr() * 0.08;
      out.push(prep(new THREE.CylinderGeometry(rr, rr, 0.012, 9, 1, false, 0.3, Math.PI * 2 - 0.6), 0x4c9a3c, pr, { pos: [x, 0.06, z], rot: [0, pr() * 6.28, 0] }));
      if (pr() < 0.35) out.push(prep(new THREE.ConeGeometry(0.05, 0.06, 6), 0xf3b6cf, pr, { pos: [x + 0.03, 0.09, z], rot: [Math.PI, 0, 0] }));
    }
    addNear(pondX, pondZ, out);
  }

  // -- trees, bushes and rocks around the rim
  const tr = mulberry32(seed + 99);
  const placeRing = (count, rMin, rMax, minGap, fn) => {
    let tries = 0, n = 0;
    while (n < count && tries < count * 40) {
      tries++;
      const a = tr() * Math.PI * 2, r = rMin + tr() * (rMax - rMin);
      const [x, z] = polar(a, r);
      if (!free(x, z, minGap) || inPond(x, z, 0.9)) continue;
      fn(x, z, a, r); n++;
    }
  };
  // inside the fence: a few trees, bushes, rocks (all beyond 10.8 m)
  placeRing(9, 11.0, 12.4, 1.4, (x, z) => {
    reserve(x, z, 1.4);
    const k = tr(), s = 0.8 + tr() * 0.3;
    const g = k < 0.4 ? roundTree(x, z, s, tr) : k < 0.62 ? birchTree(x, z, s, tr) : k < 0.8 ? blossomTree(x, z, s, tr) : pineTree(x, z, s, tr);
    addNear(x, z, g); blobs.push([x - SUN_DIR.x * 0.5, z - SUN_DIR.z * 0.5, 1.6 * s, 0.6]);
  });
  placeRing(16, 10.9, 12.8, 0.6, (x, z) => {
    reserve(x, z, 0.6);
    const s = 0.7 + tr() * 0.5;
    addNear(x, z, bush(x, z, s, tr, tr() < 0.35)); blobs.push([x, z, 0.75 * s, 0.5]);
  });
  placeRing(10, 10.8, 12.9, 0.4, (x, z) => {
    reserve(x, z, 0.4);
    const s = 0.2 + tr() * 0.3;
    addNear(x, z, rock(x, z, s, tr)); blobs.push([x, z, s * 1.4, 0.4]);
  });
  // just outside the fence: denser woodland edge
  placeRing(34, 14.4, 18.5, 1.5, (x, z) => {
    reserve(x, z, 1.5);
    const k = tr(), s = 0.95 + tr() * 0.5;
    const g = k < 0.45 ? roundTree(x, z, s, tr) : k < 0.75 ? pineTree(x, z, s * 1.1, tr) : k < 0.9 ? birchTree(x, z, s, tr) : blossomTree(x, z, s, tr);
    addNear(x, z, g); blobs.push([x - SUN_DIR.x * 0.6, z - SUN_DIR.z * 0.6, 1.8 * s, 0.55]);
  });
  placeRing(26, 13.9, 16.5, 0.6, (x, z) => {
    reserve(x, z, 0.6);
    const s = 0.8 + tr() * 0.6;
    addNear(x, z, bush(x, z, s, tr, tr() < 0.25)); blobs.push([x, z, 0.8 * s, 0.5]);
  });
  // distant forest on the hills (low detail)
  placeRing(170, 20, 44, 1.3, (x, z, a, r) => {
    reserve(x, z, 1.3);
    const s = 1.3 + tr() * 1.1 + (r - 20) * 0.02;
    const g = tr() < 0.55 ? pineTree(x, z, s, tr, true) : roundTree(x, z, s, tr, true);
    for (const gg of g) farBucket.push(gg);
  });

  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const propMeshes = [];
  for (const b of [...nearBuckets, farBucket]) {
    if (!b.length) continue;
    const g = mergeGeometries(b);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, propMat);
    m.name = 'props'; root.add(m); propMeshes.push(m);
    for (const gg of b) gg.dispose();
  }

  // ---- blob shadows (one instanced, transparent decal)
  {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeBlobTexture(), color: 0x1d3312, transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const im = new THREE.InstancedMesh(g, mat, blobs.length);
    blobs.forEach(([x, z, r, k], i) => {
      _m.compose(_p.set(x, 0.012, z), _q.identity(), _s.set(r * 2 * (0.6 + k * 0.7), 1, r * 2 * (0.6 + k * 0.7)));
      im.setMatrixAt(i, _m);
    });
    im.renderOrder = 1; im.name = 'blobShadows';
    root.add(im);
  }

  // ---- pond water (animated shader) + sand bank
  let waterU;
  {
    const bank = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshLambertMaterial({ color: 0xc8b98a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    bank.rotation.set(-Math.PI / 2, 0, pondRot);
    bank.scale.set(POND_AX * 1.16, POND_AZ * 1.3, 1);
    bank.position.set(pondX, 0.015, pondZ);
    bank.name = 'pondBank';
    // merge bank into the water draw by keeping it separate but cheap (1 call)
    root.add(bank);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        deep: { value: new THREE.Color(0x2d6f78) }, shallow: { value: new THREE.Color(0x6fb3a6) },
        skyCol: { value: new THREE.Color(0xb7dcf0) }, sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color(0xfff4dc) },
      }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vWorld; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 deep, shallow, skyCol, sunDir, sunCol;
        varying vec3 vWorld; varying vec2 vUv;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec2 p = vWorld.xz; float t = uTime;
          vec2 g = vec2(cos(p.x * 3.1 + t * 1.3) * 0.6 + cos((p.x + p.y) * 4.7 - t * 1.7) * 0.4,
                        cos(p.y * 3.7 - t * 1.1) * 0.6 + cos((p.x - p.y) * 5.3 + t * 1.9) * 0.4);
          vec3 n = normalize(vec3(g.x * 0.09, 1.0, g.y * 0.09));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          float e = length((vUv - 0.5) * 2.0);
          vec3 c = mix(deep, shallow, smoothstep(0.45, 1.0, e));
          c = mix(c, skyCol, 0.18 + 0.6 * fres);
          float spec = pow(max(dot(n, normalize(sunDir + v)), 0.0), 220.0);
          c += sunCol * spec * 1.4;
          c += vec3(0.05) * (g.x * g.y);
          c = mix(c, vec3(0.86, 0.92, 0.88), smoothstep(0.88, 1.0, e) * 0.45);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), waterMat);
    water.rotation.set(-Math.PI / 2, 0, pondRot);
    water.scale.set(POND_AX, POND_AZ, 1);
    water.position.set(pondX, 0.03, pondZ);
    water.name = 'pondWater';
    root.add(water);
    waterU = waterMat.uniforms.uTime;
  }

  // ---- grass tufts (instanced, wind sway)
  const windPatch = (shader, extraHead = '', extraBody = '') => {
    shader.uniforms.uTime = timeU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\n' + extraHead)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uTime * 1.7 + ip.x * 0.35 + ip.y * 0.22) * 0.65 + sin(uTime * 3.1 + ip.x * 1.1 - ip.y * 0.7) * 0.35;
        float bend = max(transformed.y, 0.0);
        transformed.x += sw * bend * 0.28;
        transformed.z += sw * bend * 0.12;
        ${extraBody}`);
  };
  {
    const gr = mulberry32(seed + 5);
    const pos = [], col = [], nrm = [];
    const base = new THREE.Color(0x4a8a34), tip = new THREE.Color(0xa6d468);
    const BL = 7;
    for (let i = 0; i < BL; i++) {
      const a = (i / BL) * Math.PI * 2 + gr() * 0.6, d = 0.02 + gr() * 0.05;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      const h = 0.09 + gr() * 0.11, w = 0.016 + gr() * 0.01;
      const ta = gr() * Math.PI; // blade facing
      const tx = Math.cos(ta) * w, tz = Math.sin(ta) * w;
      const lean = 0.03 + gr() * 0.06;
      pos.push(cx - tx, 0, cz - tz, cx + tx, 0, cz + tz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
      for (let k = 0; k < 3; k++) nrm.push(0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => windPatch(s);
    const N = opts.grassCount ?? 5200;
    const im = new THREE.InstancedMesh(g, mat, N);
    const tint = new THREE.Color();
    let n = 0, tries = 0;
    while (n < N && tries < N * 3) {
      tries++;
      const r = Math.sqrt(gr()) * 19.5, a = gr() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (inPond(x, z, 0.1)) continue;
      // clumpier near the rim and in noise patches
      const dens = 0.45 + fbm(x * 0.3, z * 0.3, 2) * 0.8 + smooth(9, 13, r) * 0.4;
      if (gr() > dens) continue;
      const s = 0.55 + gr() * 0.6 + smooth(12.5, 15, r) * 0.7;
      _m.compose(_p.set(x, groundHeight(x, z), z), _q.setFromEuler(_e.set(0, gr() * 6.28, 0)), _s.set(s, s * (0.8 + gr() * 0.5), s));
      im.setMatrixAt(n, _m);
      const v = gr();
      tint.setRGB(0.85 + v * 0.3 + gr() * 0.1, 0.9 + v * 0.2, 0.75 + v * 0.2);
      im.setColorAt(n, tint);
      n++;
    }
    im.count = n;
    im.computeBoundingSphere();
    im.name = 'grassTufts';
    root.add(im);
  }

  // ---- flowers (instanced: green stem + tintable petals, yellow centre)
  {
    const fr = mulberry32(seed + 6);
    const pos = [], col = [], nrm = [], tintA = [];
    const STEM = new THREE.Color(0x4c8a33), CEN = new THREE.Color(0xffd23a), PET = new THREE.Color(0xffffff);
    const H = 0.16;
    // stem (two crossed triangles)
    pos.push(-0.006, 0, 0, 0.006, 0, 0, 0, H, 0, 0, 0, -0.006, 0, 0, 0.006, 0, H, 0);
    for (let k = 0; k < 6; k++) { col.push(STEM.r, STEM.g, STEM.b); nrm.push(0, 1, 0); tintA.push(0); }
    // head: 5 petals as a star fan, slightly cupped
    const NP = 10, R1 = 0.068, R0 = 0.028;
    const ring = [];
    for (let i = 0; i < NP; i++) { const a = (i / NP) * Math.PI * 2, rr = i % 2 === 0 ? R1 : R0; ring.push([Math.cos(a) * rr, H + (i % 2 === 0 ? 0.012 : 0.004), Math.sin(a) * rr]); }
    for (let i = 0; i < NP; i++) {
      const p1 = ring[i], p2 = ring[(i + 1) % NP];
      pos.push(0, H + 0.006, 0, ...p2, ...p1);
      col.push(CEN.r, CEN.g, CEN.b, PET.r, PET.g, PET.b, PET.r, PET.g, PET.b);
      for (let k = 0; k < 3; k++) nrm.push(0, 1, 0);
      tintA.push(0, 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(tintA, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      windPatch(s, 'attribute float aTint;');
      s.vertexShader = s.vertexShader.replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor = mix(vColor, vColor * instanceColor, aTint);
        #endif`);
    };
    const palette = [0xffffff, 0xffffff, 0xffffff, 0xfff27a, 0xf58fb0, 0xc49cf0, 0x8fb8ff, 0xff7a6a, 0xffb347];
    const N = opts.flowerCount ?? 1600;
    const im = new THREE.InstancedMesh(g, mat, N);
    const c = new THREE.Color();
    let n = 0;
    // clusters
    const clusters = [];
    for (let i = 0; i < 38; i++) {
      const r = i < 10 ? 3.5 + fr() * 6 : 9.8 + fr() * 6, a = fr() * Math.PI * 2;
      clusters.push([Math.cos(a) * r, Math.sin(a) * r, 0.5 + fr() * 1.1, palette[(fr() * palette.length) | 0]]);
    }
    let tries = 0;
    while (n < N && tries < N * 4) {
      tries++;
      let x, z, hex;
      if (fr() < 0.7) {
        const cl = clusters[(fr() * clusters.length) | 0];
        const a = fr() * 6.28, d = Math.sqrt(fr()) * cl[2];
        x = cl[0] + Math.cos(a) * d; z = cl[1] + Math.sin(a) * d; hex = fr() < 0.85 ? cl[3] : palette[(fr() * palette.length) | 0];
      } else {
        const r = Math.sqrt(fr()) * 17, a = fr() * 6.28;
        x = Math.cos(a) * r; z = Math.sin(a) * r; hex = palette[(fr() * 3) | 0];
      }
      if (inPond(x, z, 0.35) || Math.hypot(x, z) > 18) continue;
      if (Math.abs(Math.hypot(x, z) - FENCE_R) < 0.15) continue;
      const s = 0.75 + fr() * 0.6;
      _m.compose(_p.set(x, groundHeight(x, z), z), _q.setFromEuler(_e.set((fr() - 0.5) * 0.35, fr() * 6.28, (fr() - 0.5) * 0.35)), _s.set(s, s * (0.7 + fr() * 0.7), s));
      im.setMatrixAt(n, _m);
      c.set(hex); im.setColorAt(n, c);
      n++;
    }
    im.count = n;
    im.computeBoundingSphere();
    im.name = 'flowers';
    root.add(im);
  }

  // ---- ambience
  const ambience = createAmbience();

  // ---- per-frame update
  function update(dt = 0, t = 0, playerPos = null) {
    timeU.value = t;
    waterU.value = t;
    if (playerPos) {
      setShadowTarget(playerPos);
      sky.position.set(playerPos.x, 0, playerPos.z);
      cloudGroup.position.set(playerPos.x, 0, playerPos.z);
    }
    cloudGroup.rotation.y = t * 0.004;
  }

  return { update, sun, hemi, setShadowTarget, ambience, group: root, groundHeight };
}

// ---------------------------------------------------------------- procedural ambience (Web Audio)
function createAmbience() {
  let ctx = null, master = null, birdBus = null, timer = null, running = false;
  const sources = [];

  function makeNoise(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // Paul Kellet pink noise
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    // short crossfade so the loop point is seamless
    const xf = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
    return buf;
  }

  function lfo(ac, freq, depth, target) {
    const o = ac.createOscillator(); o.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(target); o.start(); sources.push(o);
  }

  function chirp(when, pan) {
    const ac = ctx;
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (p) { p.pan.value = pan; p.connect(birdBus); }
    const out = p || birdBus;
    const type = Math.random();
    const base = 2600 + Math.random() * 2200;
    const note = (t0, dur, f0, f1, vol) => {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.015, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + dur + 0.02);
    };
    let t = when;
    if (type < 0.4) { // tweet-tweet
      const n = 2 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) { note(t, 0.07 + Math.random() * 0.05, base * 1.25, base * 0.8, 0.5); t += 0.12 + Math.random() * 0.08; }
    } else if (type < 0.7) { // trill
      const n = 8 + ((Math.random() * 8) | 0);
      for (let i = 0; i < n; i++) { note(t, 0.03, base * (i % 2 ? 1.1 : 0.95), base * (i % 2 ? 0.9 : 1.05), 0.35); t += 0.045; }
    } else if (type < 0.88) { // slow whistle (two notes)
      const f = 1700 + Math.random() * 900;
      note(t, 0.28, f, f * 1.18, 0.4); note(t + 0.34, 0.35, f * 1.2, f * 0.92, 0.35);
    } else { // rising "sweet" call
      note(t, 0.18, base * 0.6, base * 1.1, 0.4); note(t + 0.22, 0.09, base * 1.2, base, 0.35); note(t + 0.34, 0.09, base * 1.2, base, 0.3);
    }
  }

  function scheduleBirds() {
    if (!running) return;
    const now = ctx.currentTime + 0.05;
    const pan = Math.random() * 1.6 - 0.8;
    chirp(now, pan);
    if (Math.random() < 0.35) chirp(now + 0.8 + Math.random() * 0.8, -pan * 0.8); // reply from elsewhere
    timer = setTimeout(scheduleBirds, 2500 + Math.random() * 7000);
  }

  function start(audioContext) {
    if (!audioContext || running) return;
    ctx = audioContext; running = true;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    master = ctx.createGain(); master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(0.55, ctx.currentTime, 1.5);

    // wind: pink noise -> lowpass (swept) -> gain (gusting)
    const noise = makeNoise(ctx, 6);
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
    const windGain = ctx.createGain(); windGain.gain.value = 0.09;
    src.connect(lp); lp.connect(windGain); windGain.connect(master);
    lfo(ctx, 0.053, 0.045, windGain.gain);
    lfo(ctx, 0.11, 0.02, windGain.gain);
    lfo(ctx, 0.07, 260, lp.frequency);
    src.start(); sources.push(src);
    // faint high rustle (leaves)
    const src2 = ctx.createBufferSource(); src2.buffer = noise; src2.loop = true; src2.playbackRate.value = 0.83;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const rg = ctx.createGain(); rg.gain.value = 0.012;
    src2.connect(bp); bp.connect(rg); rg.connect(master);
    lfo(ctx, 0.083, 0.01, rg.gain);
    src2.start(); sources.push(src2);

    // birds: bus with a little slap-back "space"
    birdBus = ctx.createGain(); birdBus.gain.value = 0.06;
    const dly = ctx.createDelay(1); dly.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3500;
    birdBus.connect(master); birdBus.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); fb.connect(master);
    timer = setTimeout(scheduleBirds, 1200);
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(timer); timer = null;
    const m = master, srcs = sources.splice(0);
    try { m.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2); } catch (e) { /* ignore */ }
    setTimeout(() => {
      for (const s of srcs) { try { s.stop(); } catch (e) { /* ignore */ } }
      try { m.disconnect(); } catch (e) { /* ignore */ }
    }, 1200);
  }

  return { start, stop };
}
