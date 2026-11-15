// Pet Park — WebXR pet sandbox for Meta Quest 3 (three.js r160)
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const statusEl = document.getElementById('status');
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Model + animation config. Clip names are matched on the part after the last "|".
// ---------------------------------------------------------------------------
// afk.ai models (dog, cat, sphynx) were static sculptures; tools/retarget.mjs fitted the Shiba Inu
// skeleton + animations (models/rig-shiba.glb, Quaternius CC0) to each of them.
const MODEL_CONFIG = {
  dog: {
    url: './models/dog.glb', length: 1.35, yaw: 0, tint: true, sinkFrac: 0.3,
    headBone: 'Head',
    walkNative: 1.65, runNative: 5.4,
    clips: {
      idle: ['Idle'], idle2: ['Idle_2', 'Idle'], sniff: ['Idle_2_HeadLow', 'Eating'],
      walk: ['Walk'], run: ['Gallop'], jump: ['Gallop_Jump', 'Jump_ToIdle'],
      happy: ['Jump_ToIdle', 'Idle_2'], hitL: ['Idle_HitReact_Left'], hitR: ['Idle_HitReact_Right'],
      eat: ['Eating', 'Idle_2_HeadLow'],
    },
  },
  cat: {
    url: './models/cat.glb', length: 0.52, yaw: 0, tint: true, sinkFrac: 0.26,
    headBone: 'Head',
    walkNative: 0.65, runNative: 2.2,
    clips: {
      idle: ['Idle'], idle2: ['Idle_2', 'Idle'], sniff: ['Idle_2_HeadLow', 'Eating'],
      walk: ['Walk'], run: ['Gallop'], jump: ['Gallop_Jump', 'Jump_ToIdle'],
      happy: ['Jump_ToIdle', 'Idle_2'], hitL: ['Idle_HitReact_Left'], hitR: ['Idle_HitReact_Right'],
      eat: ['Eating', 'Idle_2_HeadLow'],
    },
  },
  sphynx: {
    url: './models/sphynx.glb', length: 0.5, yaw: 0, tint: true, sinkFrac: 0.28,
    headBone: 'Head',
    walkNative: 0.65, runNative: 2.2,
    clips: {
      idle: ['Idle'], idle2: ['Idle_2', 'Idle'], sniff: ['Idle_2_HeadLow', 'Eating'],
      walk: ['Walk'], run: ['Gallop'], jump: ['Gallop_Jump', 'Jump_ToIdle'],
      happy: ['Jump_ToIdle', 'Idle_2'], hitL: ['Idle_HitReact_Left'], hitR: ['Idle_HitReact_Right'],
      eat: ['Eating', 'Idle_2_HeadLow'],
    },
  },
  fox: {
    // Fennec fox generated with afk.ai (supplied by Paul). Clips: Walk, Trot, Run — no idle, so idle holds a still pose
    url: './models/fennec-fox.glb', length: 0.58, yaw: 0, sinkFrac: 0.28, staticIdle: true,
    headBone: 'Head',
    walkNative: 0.9, runNative: 3.0,
    clips: { walk: ['Walk'], run: ['Run', 'Trot'], trot: ['Trot'] },
  },
};

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc6e8);
scene.fog = new THREE.Fog(0x9fc6e8, 18, 45);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
camera.position.set(0, 1.6, 0);
camera.rotation.order = 'YXZ';

const dolly = new THREE.Group();
dolly.position.set(0, 0, 1.5);
dolly.add(camera);
scene.add(dolly);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
vrButton.style.visibility = 'hidden';
document.body.appendChild(vrButton);

const ARENA = 9.5;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();
const playerPos = new THREE.Vector3();

// Scenery lives in scenery.js; fall back to a plain field if it's missing or fails.
let scenery = null;
try {
  const mod = await import('./scenery.js');
  scenery = mod.buildScenery(scene, renderer);
} catch (err) {
  console.warn('Scenery unavailable, using a basic field:', err);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a7a4a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 2); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshLambertMaterial({ color: 0x5f9a4a }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
}

// ---------- Text helpers ----------
function drawPanel(canvas, text, fontPx) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath(); g.roundRect(6, 6, canvas.width - 12, canvas.height - 12, canvas.height * 0.22); g.fill();
  g.strokeStyle = '#ff9a3d'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#2a2140';
  g.font = `bold ${fontPx}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + fontPx * 0.04);
}
function makeTextPanel(text, w, h, fontPx, worldW) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  drawPanel(c, text, fontPx);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldW * h / w),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.userData.setText = (t) => { drawPanel(c, t, fontPx); tex.needsUpdate = true; };
  return mesh;
}
function makeTextSprite(text, w, h, fontPx, worldW) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  drawPanel(c, text, fontPx);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(worldW, worldW * h / w, 1);
  return s;
}

const scorePanel = makeTextPanel('', 2500, 128, 46, 3.2);
scorePanel.position.set(0, 1.85, -2.8);
scene.add(scorePanel);

const stats = { pets: 0, fetches: 0, catScuffles: 0, dogScuffles: 0, fakeOuts: 0, meals: 0, cleans: 0 };
function updateScore() {
  scorePanel.userData.setText(`Pets ${stats.pets}  ·  Fetches ${stats.fetches}  ·  Fake-outs ${stats.fakeOuts}  ·  Meals ${stats.meals}  ·  Trays cleaned ${stats.cleans}  ·  Cat scuffles ${stats.catScuffles}  ·  Dog pile-ups ${stats.dogScuffles}`);
}

// ---------- Ball table ----------
const TABLE = { x: 0.55, z: 1.0, r: 0.32, top: 0.85 };
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.8, flatShading: true });
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, TABLE.top - 0.04, 12), wood);
  leg.position.set(TABLE.x, (TABLE.top - 0.04) / 2, TABLE.z);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r + 0.03, TABLE.r + 0.03, 0.04, 24), wood);
  top.position.set(TABLE.x, TABLE.top - 0.02, TABLE.z);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE.r + 0.03, 0.015, 6, 32), wood);
  rim.rotation.x = Math.PI / 2; rim.position.set(TABLE.x, TABLE.top + 0.01, TABLE.z);
  for (const m of [leg, top, rim]) { m.castShadow = true; m.receiveShadow = true; }
  scene.add(leg, top, rim);
  const sign = makeTextSprite('Balls! Grab & throw', 512, 128, 52, 0.5);
  sign.position.set(TABLE.x, TABLE.top + 0.45, TABLE.z);
  scene.add(sign);
}

// ---------- Automatic feeder + bowls ----------
const HUNGRY = 0.65;
const FEEDER = { x: -1.9, z: -0.7 };
const BUTTON = new THREE.Vector3(-0.6, 0.97, 1.0);
const feeder = { busyUntil: 0, spin: 0, pressT: -9 };
const bowls = [];
const kibbles = [];
let kibbleMesh, spinner, buttonCap;
{
  const body = new THREE.MeshStandardMaterial({ color: 0xe8573f, roughness: 0.5, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, transparent: true, opacity: 0.45 });
  const fx = FEEDER.x, fz = FEEDER.z;
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const ang = i * Math.PI * 2 / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.8, 8), metal);
    leg.position.set(fx + Math.cos(ang) * 0.28, 0.4, fz + Math.sin(ang) * 0.28);
    parts.push(leg);
  }
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.1, 0.3, 16), body); funnel.position.set(fx, 0.95, fz);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.5, 16, 1, true), glass); tank.position.set(fx, 1.35, fz);
  const kib = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.32, 16), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9, flatShading: true }));
  kib.position.set(fx, 1.26, fz);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.25, 16), body); roof.position.set(fx, 1.73, fz);
  spinner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), metal); spinner.position.set(fx, 0.78, fz);
  parts.push(funnel, tank, kib, roof, spinner);
  for (const m of parts) { m.castShadow = true; scene.add(m); }
  const sign = makeTextSprite('Auto Feeder', 512, 128, 56, 0.5);
  sign.position.set(fx, 2.05, fz); scene.add(sign);

  // button post near the start
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, BUTTON.y - 0.06, 10), metal);
  post.position.set(BUTTON.x, (BUTTON.y - 0.06) / 2, BUTTON.z);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.17), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 }));
  box.position.set(BUTTON.x, BUTTON.y - 0.04, BUTTON.z);
  buttonCap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.035, 20),
    new THREE.MeshStandardMaterial({ color: 0xe8253a, roughness: 0.3, emissive: 0x550000 }));
  buttonCap.position.set(BUTTON.x, BUTTON.y + 0.015, BUTTON.z);
  for (const m of [post, box, buttonCap]) { m.castShadow = true; scene.add(m); }
  const bsign = makeTextSprite('FEED the pets!', 512, 128, 54, 0.42);
  bsign.position.set(BUTTON.x, BUTTON.y + 0.3, BUTTON.z); scene.add(bsign);
  // cable from the button to the feeder
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(BUTTON.x, 0.02, BUTTON.z), new THREE.Vector3((BUTTON.x + fx) / 2, 0.02, (BUTTON.z + fz) / 2 + 0.3), new THREE.Vector3(fx, 0.02, fz),
  ]), 20, 0.012, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  scene.add(cable);

  // ring of bowls
  const bowlProfile = [[0, 0], [0.1, 0], [0.13, 0.015], [0.15, 0.065], [0.135, 0.065], [0.115, 0.022], [0, 0.022]].map(([x, y]) => new THREE.Vector2(x, y));
  const bowlGeo = new THREE.LatheGeometry(bowlProfile, 20);
  const foodGeo = new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const foodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.95, flatShading: true });
  const BOWL_COLOURS = [0x3b8fd9, 0xf2a93b, 0x6cc070, 0xe86a92, 0x9b6bff];
  const N = 10, R = 1.3;
  for (let i = 0; i < N; i++) {
    const ang = i * Math.PI * 2 / N + 0.3;
    const pos = new THREE.Vector3(fx + Math.cos(ang) * R, 0, fz + Math.sin(ang) * R);
    const bowl = new THREE.Mesh(bowlGeo, new THREE.MeshStandardMaterial({ color: BOWL_COLOURS[i % BOWL_COLOURS.length], roughness: 0.4 }));
    bowl.position.copy(pos); bowl.castShadow = true; scene.add(bowl);
    const food = new THREE.Mesh(foodGeo, foodMat);
    food.position.set(pos.x, 0.022, pos.z); food.visible = false; scene.add(food);
    bowls.push({ pos, mesh: bowl, foodMesh: food, food: 0, occupant: null });
  }
  kibbleMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.014, 0), foodMat, 400);
  kibbleMesh.count = 0;
  kibbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(kibbleMesh);
}
// ---------- Eagles (soaring overhead) ----------
// The eagle model was sculpted perched with folded wings, so in flight it's pitched forward and given spread wings.
const birds = [];
function makeEagles(src) {
  const box = new THREE.Box3().setFromObject(src, true);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x241913, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  // a broad wing with fingered primaries, in the XZ plane (x = span)
  const wingShape = (span) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.16); sh.lineTo(span * 0.45, 0.19); sh.lineTo(span * 0.72, 0.15);
    for (let k = 0; k < 5; k++) { const x = span * (0.78 + k * 0.05); sh.lineTo(x, 0.12 - k * 0.055); sh.lineTo(x - span * 0.035, 0.07 - k * 0.055); }
    sh.lineTo(span * 0.68, -0.2); sh.lineTo(span * 0.3, -0.22); sh.lineTo(0, -0.2); sh.lineTo(0, 0.16);
    const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); return g;
  };
  const span = 1.0;
  const innerGeo = wingShape(span);
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    const pitch = new THREE.Group();
    pitch.rotation.x = 1.35;                       // body level, head forward, talons tucked back
    const model = src.clone(true);
    model.position.copy(c).multiplyScalar(-1);
    pitch.add(model);
    const scale = 1.25 / size.y;                   // ~1.25 m from beak to tail
    pitch.scale.setScalar(scale);
    root.add(pitch);
    const wl = new THREE.Mesh(innerGeo, wingMat), wr = new THREE.Mesh(innerGeo, wingMat);
    wl.position.set(0.08, 0.03, 0.12); wr.position.set(-0.08, 0.03, 0.12); wr.scale.x = -1;
    root.add(wl, wr);
    root.scale.setScalar(1 / 3);                   // a third of the original size
    root.traverse(o => { if (o.isMesh) o.castShadow = false; });
    const ang = rand(0, Math.PI * 2);
    root.position.set(Math.cos(ang) * 9, rand(8, 13), Math.sin(ang) * 9);
    scene.add(root);
    birds.push({
      root, wl, wr, state: 'fly', vel: new THREE.Vector3(),
      orbit: { cx: rand(-5, 5), cz: rand(-5, 5), r: rand(7, 12), h: rand(8, 13), th: ang, w: (Math.random() < 0.5 ? 1 : -1) * rand(0.18, 0.3) },
      swoopT: rand(20, 50), flapT: rand(2, 6), flap: 0, seed: rand(0, 100),
    });
  }
}
function screech(pos) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime, v = Math.min(0.35, volAt(pos) * 2);
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 4;
  const g = c.createGain(); env(g, t, 0.18 * v, 0.03, 0.25, 0.25);
  o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + 0.6);
}
const birdTmp = new THREE.Vector3();
function updateBirds(dt, t) {
  for (const b of birds) {
    const p = b.root.position, o = b.orbit;
    o.th += o.w * dt;
    b.swoopT -= dt;
    let h = o.h + Math.sin(t * 0.3 + b.seed) * 0.8;
    if (b.swoopT < 0) {                            // a low pass over the park
      h = 2.6;
      if (b.swoopT > -0.1 && canPlay('screech', 3)) screech(p);
      if (b.swoopT < -7) { b.swoopT = rand(30, 60); }
    }
    birdTmp.set(o.cx + Math.cos(o.th) * o.r, h, o.cz + Math.sin(o.th) * o.r);
    const desired = birdTmp.sub(p);
    const dist = desired.length();
    if (dist > 0.001) desired.multiplyScalar(Math.min(5.5, dist * 2) / dist);
    b.vel.lerp(desired, 1 - Math.exp(-1.2 * dt));
    p.addScaledVector(b.vel, dt);
    if (b.vel.lengthSq() > 0.01) b.root.rotation.y = Math.atan2(b.vel.x, b.vel.z);
    b.root.rotation.z = clamp(-o.w * 2.2, -0.5, 0.5);     // bank into the turn
    // mostly soaring; a few slow, deep wingbeats now and then
    b.flapT -= dt;
    if (b.flapT < 0) { b.flap += dt * 7; if (b.flapT < -2) b.flapT = rand(4, 9); }
    const wing = b.flapT < 0 ? Math.sin(b.flap) * 0.55 : 0.08 + Math.sin(t * 0.8 + b.seed) * 0.04;
    b.wl.rotation.z = wing; b.wr.rotation.z = -wing;
  }
}

// ---------- Butterflies (the cats chase them, but never catch them) ----------
const butterflies = [];
function makeButterflies(src) {
  // split the static model into left and right wing halves so they can flap
  let mesh = null; src.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  src.updateMatrixWorld(true);
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).toNonIndexed();
  geo.computeBoundingBox();
  const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2, cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2, y0 = geo.boundingBox.min.y;
  geo.translate(-cx, -y0, -cz);
  const halves = [[], []];
  const pos = geo.attributes.position;
  for (let tri = 0; tri < pos.count / 3; tri++) {
    const mx = (pos.getX(tri * 3) + pos.getX(tri * 3 + 1) + pos.getX(tri * 3 + 2)) / 3;
    halves[mx >= 0 ? 0 : 1].push(tri);
  }
  const sub = (tris) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const arr = new Float32Array(tris.length * 3 * attr.itemSize);
      tris.forEach((tri, k) => { for (let v = 0; v < 3; v++) for (let c = 0; c < attr.itemSize; c++) arr[(k * 3 + v) * attr.itemSize + c] = attr.getComponent(tri * 3 + v, c); });
      g.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
    }
    return g;
  };
  const right = sub(halves[0]), left = sub(halves[1]);
  const mat = mesh.material.clone(); mat.side = THREE.DoubleSide;
  for (let i = 0; i < 10; i++) {
    const root = new THREE.Group();
    const wl = new THREE.Mesh(left, mat), wr = new THREE.Mesh(right, mat);
    root.add(wl, wr);
    root.scale.setScalar(rand(1.1, 1.5));
    const sp = spawnSpot();
    root.position.set(sp.x, rand(0.4, 1.4), sp.z);
    scene.add(root);
    butterflies.push({ root, wl, wr, state: 'fly', vel: new THREE.Vector3(), target: null, retargetT: 0, groundT: 0, seed: rand(0, 100), stalker: null, fleeDelay: -1 });
  }
}
function butterflyTakeOff(b) {
  if (b.state === 'fly') return;
  b.state = 'fly'; b.fleeDelay = -1;
  b.vel.set(rand(-1, 1), rand(1.5, 2.2), rand(-1, 1));
  b.target = new THREE.Vector3(b.root.position.x + rand(-3, 3), rand(1.4, 2.4), b.root.position.z + rand(-3, 3));
  b.retargetT = rand(1.5, 3);
}
function updateButterflies(dt, t) {
  for (const b of butterflies) {
    const p = b.root.position;
    if (b.state === 'ground') {
      b.groundT -= dt;
      const open = 0.15 + (Math.sin(t * 1.4 + b.seed) * 0.5 + 0.5) * 1.1;     // slowly opening and closing
      b.wl.rotation.z = -open; b.wr.rotation.z = open;
      let threat = playerPos.distanceTo(birdTmp.set(p.x, playerPos.y, p.z)) < 0.9;
      for (const a of animals) {
        const d = Math.hypot(a.group.position.x - p.x, a.group.position.z - p.z);
        if (d < 0.55 || (a.isDog && d < 1.5 && a.curSpeed > 0.6)) { threat = true; break; }
      }
      if (b.fleeDelay >= 0) { b.fleeDelay -= dt; if (b.fleeDelay < 0) threat = true; }
      if (threat || b.groundT <= 0) butterflyTakeOff(b);
      continue;
    }
    // fluttering: wander between random points with a bobbing, erratic path
    b.retargetT -= dt;
    if (!b.target || b.retargetT <= 0 || p.distanceTo(b.target) < 0.3) {
      const ang = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * 8.5;
      b.target = new THREE.Vector3(Math.cos(ang) * rr, rand(0.35, 1.6), Math.sin(ang) * rr);
      b.retargetT = rand(2, 5);
      if (Math.random() < 0.18) { b.target.y = 0.03; b.landing = true; } else b.landing = false;
    }
    const desired = birdTmp.copy(b.target).sub(p);
    const dist = desired.length();
    desired.multiplyScalar(Math.min(1.3, dist * 1.5) / Math.max(dist, 1e-3));
    desired.x += Math.sin(t * 3.1 + b.seed) * 0.6; desired.y += Math.sin(t * 5.3 + b.seed * 2) * 0.5; desired.z += Math.cos(t * 2.7 + b.seed) * 0.6;
    b.vel.lerp(desired, 1 - Math.exp(-3 * dt));
    p.addScaledVector(b.vel, dt);
    if (p.y < 0.03) p.y = 0.03;
    if (b.landing && p.distanceTo(b.target) < 0.08) { b.state = 'ground'; b.groundT = rand(4, 10); p.y = 0.03; b.vel.set(0, 0, 0); continue; }
    const hv = Math.hypot(b.vel.x, b.vel.z);
    if (hv > 0.05) b.root.rotation.y = Math.atan2(b.vel.x, b.vel.z);
    const flap = Math.sin(t * 22 + b.seed) * 1.0;
    b.wl.rotation.z = -flap; b.wr.rotation.z = flap;
  }
}

// ---------- Cat climbing frames ----------
function releasePlatform(a) {
  const c = a.climb;
  if (c && c.reserved) { c.reserved.occ = Math.max(0, c.reserved.occ - 1); c.reserved = null; }
}
const catTrees = [];
{
  const TREE_SPOTS = [{ x: 4.3, z: -3.2, rot: 0.4, carpet: 0x6fb7b0 }, { x: -4.8, z: 3.4, rot: 2.2, carpet: 0xc88fc4 }, { x: 3.2, z: 5.0, rot: 4.1, carpet: 0x8fb0d9 }];
  const LEVELS = [{ a: 0, d: 0.34, y: 0.45, r: 0.2 }, { a: 2.1, d: 0.32, y: 0.88, r: 0.2 }, { a: 4.2, d: 0.32, y: 1.3, r: 0.2 }, { a: 0, d: 0, y: 1.72, r: 0.3, bed: true }];
  const sisal = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.95, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.8 });
  for (const spot of TREE_SPOTS) {
    const carpet = new THREE.MeshStandardMaterial({ color: spot.carpet, roughness: 1 });
    const parts = { carpet: [], sisal: [], wood: [] };
    const add = (key, geo, x, y, z) => { geo.translate(x, y, z); parts[key].push(geo); };
    add('carpet', new THREE.BoxGeometry(0.95, 0.06, 0.95), spot.x, 0.03, spot.z);
    add('sisal', new THREE.CylinderGeometry(0.075, 0.075, 1.7, 10), spot.x, 0.88, spot.z);
    const tree = { x: spot.x, z: spot.z, platforms: [] };
    for (const L of LEVELS) {
      const ang = L.a + spot.rot;
      const px = spot.x + Math.cos(ang) * L.d, pz = spot.z + Math.sin(ang) * L.d;
      add('carpet', new THREE.CylinderGeometry(L.r, L.r, 0.06, 16), px, L.y - 0.03, pz);
      if (L.d > 0) {
        add('sisal', new THREE.CylinderGeometry(0.04, 0.04, L.y - 0.06, 8), px + Math.cos(ang) * 0.08, (L.y - 0.06) / 2 + 0.06, pz + Math.sin(ang) * 0.08);
        const arm = new THREE.BoxGeometry(L.d, 0.04, 0.06); arm.rotateY(-ang);
        add('wood', arm, spot.x + Math.cos(ang) * L.d / 2, L.y - 0.08, spot.z + Math.sin(ang) * L.d / 2);
      }
      if (L.bed) {
        const rim = new THREE.TorusGeometry(L.r - 0.03, 0.05, 6, 20); rim.rotateX(Math.PI / 2);
        add('carpet', rim, px, L.y + 0.02, pz);
        // dangling pom-pom toy
        add('wood', new THREE.CylinderGeometry(0.004, 0.004, 0.35, 4), px + L.r * 0.9, L.y - 0.2, pz);
        add('carpet', new THREE.SphereGeometry(0.045, 8, 6), px + L.r * 0.9, L.y - 0.4, pz);
      }
      tree.platforms.push({ x: px, z: pz, y: L.y, r: L.r, occ: 0, cap: L.bed ? 2 : 1, bed: !!L.bed, ang });
    }
    for (const [key, mat] of [['carpet', carpet], ['sisal', sisal], ['wood', wood]]) {
      const m = new THREE.Mesh(mergeGeometries(parts[key]), mat);
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
    }
    catTrees.push(tree);
  }
}
// ---------- Litter trays ----------
const TRAY_FULL = 3;
const trays = [];
{
  const plastic = [0x4fb3e8, 0xf28c6b, 0x8ad07a];
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xe6d3a3, roughness: 1, flatShading: true });
  const clumpMat = new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 1, flatShading: true });
  const clumpGeo = new THREE.DodecahedronGeometry(0.028, 0);
  const stinkTex = canvasTex(g => {
    g.strokeStyle = 'rgba(120,180,60,0.9)'; g.lineWidth = 7; g.lineCap = 'round';
    for (const x of [36, 64, 92]) { g.beginPath(); for (let y = 118; y > 12; y -= 4) g.lineTo(x + Math.sin(y * 0.09 + x) * 10, y); g.stroke(); }
  });
  [-3.6, -2.7, -1.8].forEach((z, i) => {
    const x = -5.7;
    const body = new THREE.MeshStandardMaterial({ color: plastic[i], roughness: 0.5 });
    const W = 0.5, D = 0.38, H = 0.12, T = 0.02;
    const walls = [
      new THREE.BoxGeometry(W, 0.02, D).translate(0, 0.01, 0),
      new THREE.BoxGeometry(W, H, T).translate(0, H / 2, D / 2), new THREE.BoxGeometry(W, H, T).translate(0, H / 2, -D / 2),
      new THREE.BoxGeometry(T, H, D).translate(W / 2, H / 2, 0), new THREE.BoxGeometry(T, H * 0.6, D).translate(-W / 2, H * 0.3, 0),
    ];
    const tray = new THREE.Mesh(mergeGeometries(walls), body);
    tray.position.set(x, 0, z); tray.castShadow = true; scene.add(tray);
    const sand = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.05, D - 0.04), sandMat);
    sand.position.set(x, 0.045, z); scene.add(sand);
    const clumps = [];
    for (let k = 0; k < TRAY_FULL * 2; k++) {
      const c = new THREE.Mesh(clumpGeo, clumpMat);
      c.position.set(x + rand(-0.15, 0.15), 0.075, z + rand(-0.1, 0.1));
      c.rotation.set(rand(0, 3), rand(0, 3), 0); c.visible = false; scene.add(c); clumps.push(c);
    }
    const stink = new THREE.Sprite(new THREE.SpriteMaterial({ map: stinkTex, transparent: true, depthWrite: false }));
    stink.scale.setScalar(0.35); stink.position.set(x, 0.3, z); stink.visible = false; scene.add(stink);
    const sign = makeTextSprite('Clean me!', 512, 128, 60, 0.36);
    sign.position.set(x, 0.62, z); sign.visible = false; scene.add(sign);
    trays.push({ x, z, dirt: 0, occupant: null, clumps, stink, sign });
  });
  const label = makeTextSprite('Litter trays', 512, 128, 56, 0.5);
  label.position.set(-5.7, 1.0, -2.7); scene.add(label);
}
function addClump(tr) {
  for (let k = 0; k < 2; k++) { const c = tr.clumps.find(c => !c.visible); if (c) c.visible = true; }
}
function cleanTray(tr, handIndex = -1) {
  if (tr.dirt <= 0) return false;
  tr.dirt = 0;
  for (const c of tr.clumps) {
    if (c.visible) { tmpV.copy(c.position); tmpV.y += 0.05; spawnParticle('star', tmpV); }
    c.visible = false;
  }
  stats.cleans++; updateScore();
  haptic(handIndex, 0.5, 70);
  crunch(0.7, 1200); setTimeout(() => crunch(0.6, 900), 90); setTimeout(ding, 200);
  return true;
}
function trayNear(pos, maxD) {
  let best = null, bd = maxD;
  for (const tr of trays) { const d = Math.hypot(pos.x - tr.x, pos.z - tr.z) + Math.max(0, pos.y - 0.25); if (d < bd) { bd = d; best = tr; } }
  return best;
}
function trayOnRay(ray, maxDist) {
  for (const tr of trays) {
    if (tr.dirt <= 0) continue;
    tmpV2.set(tr.x, 0.07, tr.z);
    if (tmpV2.distanceTo(ray.origin) < maxDist && ray.distanceSqToPoint(tmpV2) < 0.28 * 0.28) return tr;
  }
  return null;
}
function cleanTrayFor(a) {
  let best = null, bd = Infinity;
  for (const tr of trays) {
    if (tr.dirt >= TRAY_FULL || (tr.occupant && tr.occupant !== a)) continue;
    const d = Math.hypot(tr.x - a.group.position.x, tr.z - a.group.position.z);
    if (d < bd) { bd = d; best = tr; }
  }
  return best;
}
function updateTrays(t) {
  anyCleanTray = trays.some(tr => tr.dirt < TRAY_FULL);
  for (const tr of trays) {
    const dirty = tr.dirt >= TRAY_FULL;
    tr.stink.visible = tr.dirt >= TRAY_FULL - 1;
    tr.stink.material.opacity = 0.6 + 0.3 * Math.sin(t * 3 + tr.x);
    tr.stink.position.y = 0.3 + Math.sin(t * 1.5 + tr.z) * 0.03;
    tr.sign.visible = dirty;
  }
}

function freePlatform(tree, minIdx = 1) {
  const free = tree.platforms.map((pl, i) => ({ pl, i })).filter(({ pl, i }) => i >= minIdx && pl.occ < pl.cap);
  return free.length ? pick(free).i : -1;
}

function freeBowlFor(a) {
  let best = null, bd = Infinity;
  for (const b of bowls) {
    if (b.food <= 0.08 || (b.occupant && b.occupant !== a)) continue;
    const d = b.pos.distanceTo(a.group.position);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function pressFeeder(handIndex = -1) {
  const t = clock.elapsedTime;
  feeder.pressT = t;
  haptic(handIndex, 0.7, 80);
  if (t < feeder.busyUntil) return;
  feeder.busyUntil = t + 2.2;
  audio(); ding();
  // fire kibble from the spinner into every bowl
  const spout = new THREE.Vector3(FEEDER.x, 0.78, FEEDER.z);
  for (const b of bowls) {
    for (let k = 0; k < 14; k++) {
      const delay = rand(0, 1.6), T = rand(0.45, 0.7);
      const target = new THREE.Vector3(b.pos.x + rand(-0.06, 0.06), 0.05, b.pos.z + rand(-0.06, 0.06));
      const vel = target.clone().sub(spout).sub(new THREE.Vector3(0, -0.5 * 9.8 * T * T, 0)).divideScalar(T);
      kibbles.push({ start: t + delay, T, from: spout.clone(), vel, bowl: b, rot: rand(0, 6) });
    }
  }
}
const kibM = new THREE.Matrix4(), kibQ = new THREE.Quaternion(), kibS = new THREE.Vector3(1, 1, 1), kibE = new THREE.Euler();
function updateFeeder(dt, t) {
  const pressed = t - feeder.pressT < 0.25;
  buttonCap.position.y = BUTTON.y + (pressed ? 0.002 : 0.015);
  buttonCap.material.emissive.setHex(t < feeder.busyUntil ? 0xff3030 : 0x550000);
  feeder.spin = t < feeder.busyUntil ? 14 : feeder.spin * Math.exp(-3 * dt);
  spinner.rotation.y += feeder.spin * dt;
  if (t < feeder.busyUntil && Math.random() < dt * 25 && canPlay('rattle', 0.03)) crunch(0.35, 3200);
  let n = 0;
  for (let i = kibbles.length - 1; i >= 0; i--) {
    const k = kibbles[i];
    const age = t - k.start;
    if (age < 0) continue;
    if (age >= k.T) {
      k.bowl.food = Math.min(1, k.bowl.food + 1 / 14);
      kibbles.splice(i, 1);
      continue;
    }
    if (n >= 400) continue;
    tmpV.copy(k.from).addScaledVector(k.vel, age); tmpV.y -= 0.5 * 9.8 * age * age;
    kibE.set(k.rot + age * 9, k.rot * 2 + age * 7, 0); kibQ.setFromEuler(kibE);
    kibM.compose(tmpV, kibQ, kibS);
    kibbleMesh.setMatrixAt(n++, kibM);
  }
  kibbleMesh.count = n;
  kibbleMesh.instanceMatrix.needsUpdate = true;
  for (const b of bowls) {
    b.foodMesh.visible = b.food > 0.01;
    b.foodMesh.scale.set(0.6 + b.food * 0.4, 0.15 + b.food * 0.55, 0.6 + b.food * 0.4);
  }
}

// ---------- Audio (synthesised) ----------
let actx = null;
function audio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    try { scenery?.ambience?.start(actx); } catch (e) { console.warn(e); }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
const audioOK = () => actx && actx.state === 'running';
const lastSnd = {};
function canPlay(type, gap) {
  const t = clock.elapsedTime;
  if ((lastSnd[type] ?? -99) + gap > t) return false;
  lastSnd[type] = t; return true;
}
const volAt = (pos) => Math.min(1, 1.8 / (1 + pos.distanceTo(playerPos)));
function env(g, t0, peak, attack, hold, release) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}
function bark(vol = 1, pitch = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  for (let k = 0; k < 2; k++) {
    const t0 = t + k * 0.2;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(430 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(150 * pitch, t0 + 0.13);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300;
    const g = c.createGain(); env(g, t0, 0.35 * vol, 0.012, 0, 0.15);
    o.connect(f).connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 0.18);
  }
}
function yip(vol = 1, pitch = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(900 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(480 * pitch, t + 0.09);
  const g = c.createGain(); env(g, t, 0.3 * vol, 0.008, 0, 0.09);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.12);
}
function meow(vol = 1, pitch = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(520 * pitch, t);
  o.frequency.linearRampToValueAtTime(820 * pitch, t + 0.25);
  o.frequency.linearRampToValueAtTime(460 * pitch, t + 0.62);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(900, t);
  f.frequency.linearRampToValueAtTime(1900, t + 0.25);
  f.frequency.linearRampToValueAtTime(700, t + 0.62);
  const g = c.createGain(); env(g, t, 0.4 * vol, 0.05, 0.4, 0.2);
  o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + 0.7);
}
function mrrp(vol = 1, pitch = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(560 * pitch, t);
  o.frequency.linearRampToValueAtTime(720 * pitch, t + 0.22);
  const lfo = c.createOscillator(); lfo.frequency.value = 28;
  const lg = c.createGain(); lg.gain.value = 40;
  lfo.connect(lg).connect(o.frequency);
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
  const g = c.createGain(); env(g, t, 0.18 * vol, 0.02, 0.15, 0.08);
  o.connect(f).connect(g).connect(c.destination);
  o.start(t); lfo.start(t); o.stop(t + 0.3); lfo.stop(t + 0.3);
}
function purr(vol = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 26;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
  const g = c.createGain(); env(g, t, 0.12 * vol, 0.15, 0.9, 0.4);
  o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + 1.5);
}
let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const n = c.createBufferSource(); n.buffer = noiseBuf; return n;
}
function crunch(vol = 1, freq = 2200) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const n = noise(c);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * rand(0.8, 1.25); f.Q.value = 1.5;
  const g = c.createGain(); env(g, t, 0.25 * vol, 0.003, 0.01, 0.05);
  n.connect(f).connect(g).connect(c.destination); n.start(t, rand(0, 0.2)); n.stop(t + 0.08);
}
function whine(vol = 1, pitch = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(650 * pitch, t);
  o.frequency.linearRampToValueAtTime(950 * pitch, t + 0.25);
  o.frequency.linearRampToValueAtTime(700 * pitch, t + 0.55);
  const lfo = c.createOscillator(); lfo.frequency.value = 9;
  const lg = c.createGain(); lg.gain.value = 25; lfo.connect(lg).connect(o.frequency);
  const g = c.createGain(); env(g, t, 0.16 * vol, 0.05, 0.35, 0.15);
  o.connect(g).connect(c.destination); o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
}
function ding() {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  for (const [f, d] of [[880, 0], [1320, 0.12]]) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = c.createGain(); env(g, t + d, 0.2, 0.005, 0.05, 0.5);
    o.connect(g).connect(c.destination); o.start(t + d); o.stop(t + d + 0.6);
  }
}
function boing(vol = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(260, t);
  o.frequency.exponentialRampToValueAtTime(520, t + 0.08);
  const g = c.createGain(); env(g, t, 0.15 * vol, 0.005, 0, 0.12);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.15);
}

// ---------- Particles ----------
function canvasTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {
  zzz: canvasTex(g => {
    g.font = 'bold 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = '#5a6cff';
    g.strokeText('z', 44, 84); g.fillText('z', 44, 84);
    g.font = 'bold 44px system-ui, sans-serif';
    g.strokeText('z', 90, 40); g.fillText('z', 90, 40);
  }),
  heart: canvasTex(g => {
    g.fillStyle = '#ff4d7a'; g.beginPath(); g.moveTo(64, 112);
    g.bezierCurveTo(8, 72, 8, 18, 40, 18); g.bezierCurveTo(54, 18, 64, 30, 64, 40);
    g.bezierCurveTo(64, 30, 74, 18, 88, 18); g.bezierCurveTo(120, 18, 120, 72, 64, 112); g.fill();
  }),
  puff: canvasTex(g => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  }),
  star: canvasTex(g => {
    g.fillStyle = '#ffd84a'; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 22 : 58, a = i * Math.PI / 5 - Math.PI / 2;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  }),
};
const particles = [];
function spawnParticle(type, pos) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[type], transparent: true, depthWrite: false }));
  s.position.copy(pos);
  const u = { type, age: 0 };
  if (type === 'heart') { u.life = 1.3; u.size = rand(0.1, 0.15); u.vel = new THREE.Vector3(rand(-.12, .12), 0.45, rand(-.12, .12)); }
  if (type === 'puff')  { u.life = 0.6; u.size = rand(0.14, 0.24); u.vel = new THREE.Vector3(rand(-.4, .4), rand(.1, .4), rand(-.4, .4)); }
  if (type === 'zzz')   { u.life = 2.2; u.size = rand(0.1, 0.13); u.vel = new THREE.Vector3(rand(-.05, .05), 0.16, rand(-.05, .05)); }
  if (type === 'star')  { u.life = 0.8; u.size = rand(0.07, 0.1); u.vel = new THREE.Vector3(rand(-.6, .6), rand(.8, 1.3), rand(-.6, .6)); }
  s.scale.setScalar(u.size);
  s.userData = u; scene.add(s); particles.push(s);
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const s = particles[i], u = s.userData;
    u.age += dt;
    s.position.addScaledVector(u.vel, dt);
    const k = u.age / u.life;
    if (u.type === 'puff') { s.scale.setScalar(u.size * (1 + k * 1.5)); s.material.opacity = 0.7 * (1 - k); }
    else if (u.type === 'zzz') { s.scale.setScalar(u.size * (0.7 + k * 0.8)); s.material.opacity = k < 0.2 ? k * 5 : 1 - (k - 0.2) / 0.8; }
    else if (u.type === 'star') { u.vel.y -= 2.5 * dt; s.material.rotation += dt * 6; s.material.opacity = 1 - k * k; }
    else s.material.opacity = 1 - k;
    if (u.age > u.life) { scene.remove(s); s.material.dispose(); particles.splice(i, 1); }
  }
}

// ---------- Load animal models ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const clipKey = (name) => name.split('|').pop();

async function loadTemplate(kind) {
  const cfg = MODEL_CONFIG[kind];
  const gltf = await loader.loadAsync(cfg.url);
  const root = gltf.scene;
  root.rotation.y = cfg.yaw;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  const k = cfg.length / size.z;
  const clips = {};
  for (const c of gltf.animations) { const key = clipKey(c.name); if (!clips[key]) clips[key] = c; }
  const resolved = {};
  for (const [role, names] of Object.entries(cfg.clips)) {
    const found = names.map(n => clips[n]).find(Boolean);
    if (found) resolved[role] = found;
  }
  return { cfg, scene: root, k, height: size.y * k, minY: box.min.y * k, centerX: (box.min.x + box.max.x) / 2 * k, centerZ: (box.min.z + box.max.z) / 2 * k, clips: resolved };
}
const TPL = {};
await Promise.all(['dog', 'cat', 'sphynx', 'fox'].map(async k => { TPL[k] = await loadTemplate(k); }));
TPL.puppy = TPL.dog; TPL.kitten = TPL.cat;   // puppies and kittens are little dogs and cats
const [eagleGltf, butterflyGltf] = await Promise.all([loader.loadAsync('./models/eagle.glb'), loader.loadAsync('./models/butterfly.glb')]);
makeEagles(eagleGltf.scene);
makeButterflies(butterflyGltf.scene);

// ---------- Hunger icon ----------
const HUNGRY_MAT = new THREE.SpriteMaterial({ depthWrite: false, transparent: true, map: (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ff9a3d'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#7a4a24'; g.beginPath(); g.ellipse(64, 66, 30, 12, 0, Math.PI, 0); g.fill();   // kibble pile
  g.fillStyle = '#3b8fd9'; g.beginPath(); g.moveTo(24, 66); g.lineTo(104, 66); g.lineTo(92, 92); g.lineTo(36, 92); g.closePath(); g.fill();  // bowl
  g.fillStyle = '#e8463a'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.fillText('!', 64, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})() });

const TRAY_ICON_MAT = new THREE.SpriteMaterial({ depthWrite: false, transparent: true, map: (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ff9a3d'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#e6d3a3'; g.fillRect(26, 62, 76, 14);
  g.fillStyle = '#4fb3e8'; g.beginPath(); g.moveTo(20, 60); g.lineTo(108, 60); g.lineTo(100, 92); g.lineTo(28, 92); g.closePath(); g.fill();
  g.strokeStyle = '#6aa832'; g.lineWidth = 5;
  for (const x of [48, 64, 80]) { g.beginPath(); for (let y = 54; y > 18; y -= 3) g.lineTo(x + Math.sin(y * 0.25 + x) * 4, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})() });

// ---------- Animals ----------
const DOG_NAMES = ['Biscuit', 'Pepper', 'Bramble', 'Scout', 'Hamish', 'Maisie', 'Bonnie', 'Archie', 'Rolo', 'Toffee', 'Murphy',
  'Bella', 'Duke', 'Poppy', 'Bruno', 'Daisy', 'Hector', 'Skye', 'Monty', 'Rosie'];
const CAT_NAMES = ['Mochi', 'Tilly', 'Smudge', 'Willow', 'Haggis', 'Pixel', 'Clover', 'Nutmeg', 'Luna', 'Pudding', 'Socks',
  'Oscar', 'Misty', 'Ziggy', 'Bramble', 'Toast', 'Pebble', 'Ginger', 'Shadow', 'Biscotti'];
// dog coats: [main, light]
// Dog line-up: breed, size multiplier and coat [main, light]. Small, medium and large.
// Dog line-up: size multiplier and a coat tint (multiplied over the texture). Small, medium and large.
const DOG_TINTS = [0xffffff, 0xf2dcc0, 0xb8a089, 0xfff4e6, 0x9c8b7c, 0xe6d2bd];
const DOG_TYPES = [0.55, 0.62, 0.7, 0.85, 1, 1.08, 0.6, 1.15, 0.95, 1.25, 0.78].map((mul, i) => ({ breed: 'dog', mul, coat: DOG_TINTS[i % DOG_TINTS.length] }));
// cats: tabby and sphynx, with gentle tints (white = as sculpted)
const CAT_TYPES = [
  { breed: 'cat', coat: 0xffffff }, { breed: 'sphynx', coat: 0xffffff }, { breed: 'cat', coat: 0xffd8b0 }, { breed: 'cat', coat: 0xc7c8d2 },
  { breed: 'sphynx', coat: 0xffe6da }, { breed: 'cat', coat: 0xa89a8c }, { breed: 'cat', coat: 0xfff0dc },
];

function setupMaterials(model, kind, coat, cfg) {
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;   // skinned bounds are unreliable; there are only 22 animals
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const c = m.clone();
      if (kind === 'dog') {
        if (cfg.tint && typeof coat === 'number') c.color.setHex(coat);
        else if (c.name === cfg.mainMat) c.color.setHex(coat[0]);
        else if (c.name === cfg.lightMat) c.color.setHex(coat[1]);
      } else {
        if (cfg.tint || /grey|main|fur|body/i.test(c.name)) c.color.setHex(coat);
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

// ---------- Collars ----------
const COLLAR_COLOURS = [0xe8253a, 0x2f7de1, 0x2fb36a, 0xff8a1f, 0x9b4de0, 0xff5fa8, 0x18b5b0, 0xffd23f];
let collarIdx = 0;
const COLLAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
const collarGeoCache = {};
function collarGeometry(colour) {
  if (collarGeoCache[colour]) return collarGeoCache[colour];
  const band = new THREE.TorusGeometry(1, 0.2, 6, 20);
  const tag = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12);
  tag.rotateX(Math.PI / 2); tag.translate(0, -1.45, 0.15);
  const ring = new THREE.TorusGeometry(0.16, 0.05, 4, 8); ring.translate(0, -1.17, 0.15);
  const paint = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const merged = mergeGeometries([paint(band, colour), paint(tag, 0xffcf3f), paint(ring, 0xd0d4da)]);
  return (collarGeoCache[colour] = merged);
}

function makeAnimal({ kind, breed = kind, mul = 1, name, coat, x, z }) {
  const isDog = kind === 'dog';
  const tpl = TPL[breed];
  const sitter = !!tpl.cfg.static;
  const group = new THREE.Group();
  const model = SkeletonUtils.clone(tpl.scene);
  model.scale.multiplyScalar(tpl.k);
  model.position.set(-tpl.centerX, -tpl.minY, -tpl.centerZ);
  setupMaterials(model, kind, coat, tpl.cfg);
  group.add(model);

  const bone = (n) => { let f = null; model.traverse(o => { if (!f && o.isBone && o.name === n) f = o; }); return f; };
  let head = bone(tpl.cfg.headBone);
  if (!head) model.traverse(o => { if (!head && o.isBone && /head/i.test(o.name)) head = o; });
  // collar, fitted to the neck in the bind pose and then parented to the neck bone so it follows the head
  const cc = tpl.cfg.collar, nb = cc && bone(cc.from), hb = cc && bone(cc.to);
  if (nb && hb) {
    group.updateMatrixWorld(true);
    const pa = nb.getWorldPosition(new THREE.Vector3()), pb = hb.getWorldPosition(new THREE.Vector3());
    const zAxis = pb.clone().sub(pa).normalize();
    const xAxis = new THREE.Vector3().crossVectors(UP, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    const collar = new THREE.Mesh(collarGeometry(COLLAR_COLOURS[collarIdx++ % COLLAR_COLOURS.length]), COLLAR_MAT);
    collar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    collar.position.copy(pa).lerp(pb, cc.t);
    collar.scale.setScalar(cc.r);
    group.add(collar);
    (cc.to === tpl.cfg.headBone && cc.t > 0.5 ? hb : nb).attach(collar);
  }
  const bodyAnchor = new THREE.Object3D();
  bodyAnchor.position.y = tpl.height * 0.55;
  group.add(bodyAnchor);
  if (!head) { head = new THREE.Object3D(); head.position.set(0, tpl.height * 0.85, tpl.cfg.length * 0.4); group.add(head); }

  const hungryIcon = new THREE.Sprite(HUNGRY_MAT);
  hungryIcon.scale.setScalar(0.22);
  hungryIcon.position.y = tpl.height + 0.3;
  hungryIcon.visible = false;
  group.add(hungryIcon);
  const label = makeTextSprite(`${name}: pet me!`, 512, 128, 56, 0.55);
  label.position.y = tpl.height + 0.28;
  label.visible = false;
  group.add(label);

  const variation = mul * rand(0.96, 1.04);
  group.scale.setScalar(variation);
  group.position.set(x, 0, z);
  group.rotation.y = rand(0, Math.PI * 2);
  scene.add(group);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [role, clip] of Object.entries(tpl.clips)) actions[role] = mixer.clipAction(clip);
  if (tpl.cfg.staticIdle && tpl.clips.walk) {
    const still = mixer.clipAction(tpl.clips.walk.clone());
    actions.idle = actions.idle2 = actions.sniff = still;
  }

  const a = {
    kind, name, isDog, sitter, group, model, hungryIconSprite: hungryIcon, modelBaseY: model.position.y, modelBaseZ: model.position.z, heldT: 0, lickT: 0, lickAnim: 0, vy: 0, escaped: false, head, body: bodyAnchor, label,
    mixer, actions, current: null, oneShotUntil: 0, idleKey: 'idle',
    walkNative: tpl.cfg.walkNative * variation, runNative: tpl.cfg.runNative * variation,
    size: (isDog ? 1 : 0.72) * variation, len: tpl.cfg.length * variation,
    cycleLen: rand(70, 120), sleepFrac: isDog ? 0.27 : 0.34, cycleT: 0, lying: false, sinkCur: 0, sinkMax: tpl.height * (tpl.cfg.sinkFrac ?? (isDog ? 0.3 : 0.24)), staticIdle: !!tpl.cfg.staticIdle, zzzT: 0, climb: null, sleepSpot: null,
    toilet: rand(0, 0.4), toiletRate: isDog ? 0 : 1 / rand(90, 150), tray: null, inTray: false, litterT: 0,
    hunger: rand(0.15, 0.5), hungerRate: 1 / rand(100, 170), bowl: null, eatingNow: false, foodCheckT: rand(0, 0.5), hungryIcon: null,
    speed: (isDog ? 1.1 : 0.8) * (0.6 + 0.4 * variation) * rand(0.9, 1.1), fast: (isDog ? 3.0 : 2.6) * (0.7 + 0.3 * variation) * rand(0.9, 1.1),
    voice: clamp(rand(0.95, 1.1) / Math.sqrt(variation) * (breed === 'fox' ? 1.45 : 1), 0.7, 1.8), seed: rand(0, 100),
    mode: 'wander', target: null, idleT: rand(0, 2), zoom: false,
    curSpeed: 0, petTimer: 0, heartT: 0, lastSound: -10, stroke: 0,
    ball: null, carrying: null, fight: null, followTarget: null, followT: 0, chaseT: 0, excite: 1, bats: 0, pounce: 0, tussleT: 0,
  };
  group.traverse(o => { o.userData.animal = a; });
  a.cycleT = rand(0, a.cycleLen);
  if (sitter) { a.mode = 'sit'; a.hungerRate = 0; a.toiletRate = 0; a.hunger = 0; a.toilet = 0; a.group.rotation.y = Math.atan2(-x, 1.5 - z); }
  play(a, 'idle');
  mixer.update(rand(0, 3));   // desync idle loops
  return a;
}

function play(a, role, { once = false, fade = 0.25, timeScale = 1 } = {}) {
  const act = a.actions[role];
  if (!act) return 0;
  if (a.staticIdle && (role === 'idle' || role === 'idle2' || role === 'sniff')) timeScale = 0;   // hold a still pose
  if (a.current === act && !once) { act.timeScale = timeScale; return 0; }
  act.reset();
  act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  act.clampWhenFinished = once;
  act.timeScale = timeScale;
  act.setEffectiveWeight(1);
  act.fadeIn(fade).play();
  if (a.current && a.current !== act) a.current.fadeOut(fade);
  a.current = act;
  return act.getClip().duration / timeScale;
}
function playOnce(a, role, t, timeScale = 1) {
  if (!a.actions[role]) {
    // no clip for this (the cat): do a little procedural hop / headbutt instead
    const dur = role === 'happy' ? 0.5 : 0.42;
    a.hopT0 = t; a.hopDur = dur; a.hopH = role === 'happy' ? 0.06 : rand(0.1, 0.16);
    a.nuzzle = role === 'happy';
    return;
  }
  const d = play(a, role, { once: true, fade: 0.12, timeScale });
  if (d > 0) a.oneShotUntil = t + d * 0.92;
}

function spawnSpot() {
  const ang = rand(0, Math.PI * 2), r = rand(2.5, 8.5);
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
}
const dogs = [], cats = [], animals = [];
function despawnPets() {
  for (const f of [...fights]) resolveFight(f);
  for (const a of animals) {
    if (a.carrying) dropCarried(a);
    toWander(a);
    scene.remove(a.group);
    a.mixer.stopAllAction();
  }
  dogs.length = 0; cats.length = 0; animals.length = 0;
  for (const b of balls) { if (b.state === 'carried') { scene.attach(b.mesh); b.state = 'free'; b.carrier = null; } }
}
const FOX_NAMES = ['Sandy', 'Zara', 'Sahara', 'Pip', 'Dune', 'Rusty', 'Nala', 'Kit', 'Ember', 'Sirocco'];
const PUPPY_NAMES = ['Teddy', 'Bear', 'Cookie', 'Bonnie', 'Mabel'], KITTEN_NAMES = ['Button', 'Twinkle', 'Peanut', 'Fluff', 'Bean'];
function spawnPets(nDogs, nCats, nFoxes = 0, nPuppies = 0, nKittens = 0) {
  despawnPets();
  for (let i = 0; i < nDogs; i++) dogs.push(makeAnimal({ kind: 'dog', name: DOG_NAMES[i % DOG_NAMES.length], ...DOG_TYPES[i % DOG_TYPES.length], ...spawnSpot() }));
  for (let i = 0; i < nCats; i++) cats.push(makeAnimal({ kind: 'cat', name: CAT_NAMES[i % CAT_NAMES.length], mul: [1, 0.9, 1.1, 0.85, 1.05][i % 5], ...CAT_TYPES[i % CAT_TYPES.length], ...spawnSpot() }));
  // puppies and kittens: small, quick little versions that start near you
  const nearYou = () => { const ang = rand(-2.6, -0.5), r0 = rand(1.5, 3); return { x: Math.cos(ang) * r0, z: 1.5 + Math.sin(ang) * r0 }; };
  for (let i = 0; i < nPuppies; i++) dogs.push(makeAnimal({ kind: 'dog', breed: 'puppy', name: PUPPY_NAMES[i % PUPPY_NAMES.length], mul: rand(0.42, 0.5), coat: [0xffffff, 0xf2e2cf, 0xd9c5b0][i % 3], ...nearYou() }));
  for (let i = 0; i < nKittens; i++) cats.push(makeAnimal({ kind: 'cat', breed: 'kitten', name: KITTEN_NAMES[i % KITTEN_NAMES.length], mul: rand(0.5, 0.58), coat: [0xffffff, 0xffe2c6, 0xd6d6de][i % 3], ...nearYou() }));
  for (let i = 0; i < nFoxes; i++) dogs.push(makeAnimal({ kind: 'dog', breed: 'fox', name: FOX_NAMES[i % FOX_NAMES.length], mul: [1, 0.9, 1.1][i % 3], coat: [0, 0], ...spawnSpot() }));
  animals.push(...dogs, ...cats);
}

// ---------- Start menu ----------
{
  const menu = document.getElementById('menu');
  const dogIn = document.getElementById('dogCount'), catIn = document.getElementById('catCount'), foxIn = document.getElementById('foxCount');
  const pupIn = document.getElementById('pupCount'), kitIn = document.getElementById('kitCount');
  const dogOut = document.getElementById('dogVal'), catOut = document.getElementById('catVal'), foxOut = document.getElementById('foxVal');
  const pupOut = document.getElementById('pupVal'), kitOut = document.getElementById('kitVal');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('petpark-counts') || '{}'); } catch (e) {}
  dogIn.value = saved.dogs ?? 8; catIn.value = saved.cats ?? 8; foxIn.value = saved.foxes ?? 1; pupIn.value = saved.puppies ?? 2; kitIn.value = saved.kittens ?? 2;
  const show = () => { dogOut.textContent = dogIn.value; catOut.textContent = catIn.value; foxOut.textContent = foxIn.value; pupOut.textContent = pupIn.value; kitOut.textContent = kitIn.value; };
  dogIn.oninput = catIn.oninput = foxIn.oninput = pupIn.oninput = kitIn.oninput = show; show();
  document.getElementById('startBtn').onclick = () => {
    const nd = +dogIn.value, nc = +catIn.value, nf = +foxIn.value, np = +pupIn.value, nk = +kitIn.value;
    try { localStorage.setItem('petpark-counts', JSON.stringify({ dogs: nd, cats: nc, foxes: nf, puppies: np, kittens: nk })); } catch (e) {}
    spawnPets(nd, nc, nf, np, nk);
    menu.style.display = 'none';
    document.getElementById('changeBtn').style.display = 'block';
    vrButton.style.visibility = 'visible';
    statusEl.textContent = `${nd} dog${nd === 1 ? '' : 's'}, ${nc} cat${nc === 1 ? '' : 's'}${nf ? ` and ${nf} fennec fox${nf === 1 ? '' : 'es'}` : ''} are waiting. Tap “Enter VR” on your Quest.`;
    audio();
  };
  document.getElementById('changeBtn').onclick = () => { menu.style.display = 'flex'; };
  menu.style.display = 'flex';
  statusEl.textContent = 'Choose your pets to begin.';
}

// ---------- Balls ----------
const balls = [];
const ballGeo = {}, ballMat = {};
function makeBall(color, stripe, r, x, y, z) {
  const mesh = new THREE.Mesh(ballGeo['b' + r] ??= new THREE.SphereGeometry(r, 18, 12),
    ballMat[color] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  const seam = new THREE.Mesh(ballGeo['s' + r] ??= new THREE.TorusGeometry(r, r * 0.1, 4, 24),
    ballMat[stripe] ??= new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.7 }));
  seam.rotation.x = Math.PI / 2.4;
  mesh.add(seam);
  mesh.castShadow = true;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const b = { mesh, r, vel: new THREE.Vector3(), state: 'free', thrown: false, carrier: null, hand: null, fight: null, tackles: 0 };
  balls.push(b);
  return b;
}
for (let i = 0; i < 4; i++) {
  const ang = i * Math.PI / 2;
  makeBall(0xc8e640, 0xffffff, 0.07, TABLE.x + Math.cos(ang) * 0.14, TABLE.top + 0.07, TABLE.z + Math.sin(ang) * 0.14);
}
const BALL_COLOURS = [[0xff5a5a, 0xffffff], [0x4a8cff, 0xffe14a], [0xff7ad9, 0xffffff], [0x9b6bff, 0x7cf0c0], [0xffa63d, 0x4a8cff], [0x5ad17a, 0xffffff], [0xc8e640, 0xffffff], [0xff5a5a, 0x4a8cff]];
for (const [c, st] of BALL_COLOURS) { const p = spawnSpot(); makeBall(c, st, 0.06, p.x, 0.06, p.z); }

// ---------- Balls of yarn: they unravel as they roll ----------
const YARN_SEGS = 420;
const yarnSegGeo = new THREE.BoxGeometry(0.009, 0.006, 1);
function makeYarn(colour, x, z) {
  const r0 = 0.075;
  const parts = [new THREE.IcosahedronGeometry(r0 * 0.93, 2)];
  for (let i = 0; i < 9; i++) {
    const t = new THREE.TorusGeometry(r0 * rand(0.86, 0.97), 0.008, 4, 28);
    t.rotateX(rand(0, Math.PI)); t.rotateY(rand(0, Math.PI)); t.rotateZ(rand(0, Math.PI));
    parts.push(t.toNonIndexed());
  }
  parts[0] = parts[0].index ? parts[0].toNonIndexed() : parts[0];
  for (const g of parts) { g.deleteAttribute('uv'); }
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 1, flatShading: true });
  const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
  mesh.castShadow = true;
  mesh.position.set(x, r0, z);
  scene.add(mesh);
  const strand = new THREE.InstancedMesh(yarnSegGeo, mat, YARN_SEGS);
  strand.count = 0; strand.frustumCulled = false;
  strand.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(strand);
  const b = { mesh, r: r0, r0, vel: new THREE.Vector3(), state: 'free', thrown: false, carrier: null, hand: null, fight: null, tackles: 0,
              yarn: true, unwound: 0, strand, last: null };
  balls.push(b);
  return b;
}
const segM = new THREE.Matrix4(), segQ = new THREE.Quaternion(), segS = new THREE.Vector3(), segP = new THREE.Vector3(), segE = new THREE.Euler();
function unravel(b, ds) {
  if (b.unwound >= 1) return;
  b.unwound = Math.min(1, b.unwound + ds / 14);              // fully unravelled after ~14 m of rolling
  b.r = b.r0 * (1 - 0.6 * b.unwound);
  b.mesh.scale.setScalar(b.r / b.r0);
  const here = new THREE.Vector3(b.mesh.position.x, 0.004, b.mesh.position.z);
  if (!b.last) { b.last = here; return; }
  const len = here.distanceTo(b.last);
  if (len < 0.035 || b.strand.count >= YARN_SEGS) return;
  segP.addVectors(here, b.last).multiplyScalar(0.5);
  segE.set(0, Math.atan2(here.x - b.last.x, here.z - b.last.z), 0); segQ.setFromEuler(segE);
  segS.set(1, 1, len);
  segM.compose(segP, segQ, segS);
  b.strand.setMatrixAt(b.strand.count++, segM);
  b.strand.instanceMatrix.needsUpdate = true;
  b.last = here;
}
function rewind(b) {
  b.unwound = 0; b.r = b.r0; b.mesh.scale.setScalar(1);
  b.strand.count = 0; b.last = null;
}
const YARN_COLOURS = [0xe8463a, 0x3b7fd9, 0x9b5de5, 0x2fb36a, 0xffc93c, 0xff7eb6];
YARN_COLOURS.forEach((c, i) => {
  const tr = catTrees[i % catTrees.length], ang = rand(0, Math.PI * 2);
  makeYarn(c, tr.x + Math.cos(ang) * rand(1, 2), tr.z + Math.sin(ang) * rand(1, 2));
});

const ballWorld = (b, out) => b.mesh.getWorldPosition(out);

function updateBalls(dt) {
  for (const b of balls) {
    if (b.state !== 'free') continue;
    const p = b.mesh.position;
    b.vel.y -= 9.8 * dt;
    p.addScaledVector(b.vel, dt);
    const tdx = p.x - TABLE.x, tdz = p.z - TABLE.z;
    const onTable = tdx * tdx + tdz * tdz < TABLE.r * TABLE.r && p.y - b.r > TABLE.top - 0.15;
    const floorY = onTable ? TABLE.top + b.r : b.r;
    if (p.y < floorY) {
      p.y = floorY;
      if (!b.yarn && b.vel.y < -1.5 && canPlay('boing', 0.08)) boing(volAt(p) * 0.6);
      if (b.vel.y < 0) b.vel.y = -b.vel.y * (b.yarn ? 0.25 : 0.5);
      if (Math.abs(b.vel.y) < 0.4) b.vel.y = 0;
      const f = Math.exp(-(onTable ? 5 : b.yarn ? 1.7 : 1.1) * dt);
      b.vel.x *= f; b.vel.z *= f;
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 0.01) {
        tmpV.set(b.vel.z, 0, -b.vel.x).normalize();
        b.mesh.rotateOnWorldAxis(tmpV, hs * dt / b.r);
        if (b.yarn && !onTable) unravel(b, hs * dt);
      }
    }
    const pr = Math.hypot(p.x, p.z), wall = ARENA + 2;
    if (pr > wall) {
      const nx = p.x / pr, nz = p.z / pr;
      p.x = nx * wall; p.z = nz * wall;
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn > 0) { b.vel.x -= 1.6 * vn * nx; b.vel.z -= 1.6 * vn * nz; }
    }
  }
}

// ---------- Ball handling ----------
const hands = [{ ball: null, btn: null, hist: [], grab: null }, { ball: null, btn: null, hist: [], grab: null }];
let heldPet = null;
let deskBall = null;
const holders = [new THREE.Object3D(), new THREE.Object3D()];   // follow hand pinch / controller grip
holders.forEach(h => scene.add(h));

function releaseFromCarrier(b) {
  if (b.state === 'carried' && b.carrier) {
    const dog = b.carrier;
    dog.carrying = null;
    toWander(dog);
    dog.petTimer = 1.2;
  }
  b.carrier = null;
}
function grabBall(b, handIndex) {
  releaseFromCarrier(b);
  b.state = 'held';
  if (b.fight) resolveFight(b.fight);
  b.thrown = false; b.vel.set(0, 0, 0); b.hand = handIndex;
  if (b.yarn) rewind(b);   // winding it back up
  const holder = handIndex >= 0 ? holders[handIndex] : camera;
  holder.add(b.mesh);
  b.mesh.scale.setScalar(1);
  b.mesh.quaternion.identity();
  if (handIndex >= 0) { b.mesh.position.set(0, 0, 0); hands[handIndex].ball = b; }
  else { b.mesh.position.set(0.22, -0.2, -0.5); deskBall = b; }
}
// ---------- Fake throws: swing like you're throwing but keep hold of the ball ----------
let pendingFake = null, fakeCooldownUntil = 0;
function landingPoint(p0, v) {
  const y0 = Math.max(p0.y, 0.1), g = 9.8;
  const tFlight = (v.y + Math.sqrt(Math.max(0, v.y * v.y + 2 * g * (y0 - 0.07)))) / g;
  const pt = new THREE.Vector3(p0.x + v.x * tFlight * 1.2, 0, p0.z + v.z * tFlight * 1.2);
  const r = Math.hypot(pt.x, pt.z);
  if (r > ARENA) pt.multiplyScalar(ARENA / r);
  return pt;
}
function fakeThrow(point) {
  fakeCooldownUntil = clock.elapsedTime + 2;
  let fooled = 0, barks = 0;
  for (const d of dogs) {
    if (d.sitter || d.mode === 'fetch' || d.mode === 'fight' || d.mode === 'eat' || d.mode === 'sleep' || d.mode === 'held' || d.mode === 'falling' || d.hunger > HUNGRY) continue;
    toWander(d);
    d.mode = 'fooled'; d.fakePhase = 'run'; d.fakeRunT = 0; d.excite = rand(0.92, 1.08);
    const ang = rand(0, Math.PI * 2), rad = rand(0.3, 1.8);
    d.fakeTarget = new THREE.Vector3(point.x + Math.cos(ang) * rad, 0, point.z + Math.sin(ang) * rad);
    fooled++;
    if (barks < 3 && Math.random() < 0.4) {
      barks++;
      setTimeout(() => { d.group.getWorldPosition(tmpV2); bark(volAt(tmpV2) * 0.8, d.voice); }, rand(0, 400));
    }
  }
  if (fooled) { stats.fakeOuts++; updateScore(); }
}

function throwBall(b, vel) {
  pendingFake = null;
  scene.attach(b.mesh);
  b.mesh.scale.setScalar(1);
  b.state = 'free'; b.hand = null;
  b.vel.copy(vel);
  if (vel.length() > 1.2) { b.thrown = true; b.tackles = 0; dogsChase(b); }
}
function dogsChase(b) {
  let barks = 0;
  for (const d of dogs) {
    if (d.sitter || d.mode === 'fetch' || d.mode === 'fight' || d.mode === 'eat' || d.mode === 'sleep' || d.mode === 'held' || d.mode === 'falling' || d.hunger > HUNGRY) continue;   // too hungry (or sleepy, or being held) to care
    toWander(d);
    d.mode = 'chase'; d.ball = b; d.chaseT = 0; d.excite = rand(0.92, 1.08);
    if (barks < 3 && Math.random() < 0.4) {
      barks++;
      setTimeout(() => { d.group.getWorldPosition(tmpV2); bark(volAt(tmpV2) * 0.8, d.voice); }, rand(0, 400));
    }
  }
}
function dogGrab(a, b) {
  b.state = 'carried'; b.carrier = a; b.thrown = false; b.vel.set(0, 0, 0);
  // hold the ball just in front of the dog's head
  a.head.getWorldPosition(tmpV);
  tmpV2.set(Math.sin(a.group.rotation.y), 0, Math.cos(a.group.rotation.y));
  b.mesh.position.copy(tmpV).addScaledVector(tmpV2, 0.09 * a.size).add(tmpV3.set(0, -0.05 * a.size, 0));
  a.head.attach(b.mesh);
  a.carrying = b; a.mode = 'fetch'; a.ball = null;
  for (const d of dogs) if (d !== a && d.mode === 'chase' && d.ball === b) startFollow(d, a);
}
function dropCarried(a) {
  const b = a.carrying;
  if (!b) return null;
  scene.attach(b.mesh);
  b.mesh.scale.setScalar(1);
  b.state = 'free'; b.carrier = null;
  a.carrying = null;
  return b;
}
function dogDrop(a) {
  const b = dropCarried(a);
  if (!b) return;
  tmpV.set(playerPos.x - b.mesh.position.x, 0, playerPos.z - b.mesh.position.z).normalize();
  b.vel.set(tmpV.x * 0.7, 1.2, tmpV.z * 0.7);
  toWander(a); a.idleT = 1.5; a.petTimer = 1.6; a.heartT = 0;
  stats.fetches++; updateScore();
  bark(volAt(b.mesh.position), a.voice);
}
function startFollow(d, leader) {
  d.mode = 'follow'; d.followTarget = leader; d.followT = rand(1.5, 3); d.ball = null;
}
function toWander(a) {
  if (a.mode === 'climb' && a.climb && a.group.position.y > 0.01) {   // can't just wander off a platform
    a.climb.sleep = false; a.lying = false;
    if (a.climb.stage === 'perch') a.climb.perchT = 0;
    return;
  }
  if (a.climb) { releasePlatform(a); a.climb = null; }
  a.lying = false; a.sleepSpot = null;
  if (a.stalkBird) { if (a.stalkBird.stalker === a) a.stalkBird.stalker = null; a.stalkBird = null; }
  if (a.tray) { if (a.tray.occupant === a) a.tray.occupant = null; a.tray = null; }
  a.inTray = false;
  if (a.bowl) { if (a.bowl.occupant === a) a.bowl.occupant = null; a.bowl = null; }
  a.eatingNow = false;
  if (a.mode === 'catchase' && a.chaseCat && a.chaseCat.chaser === a) a.chaseCat.chaser = null;
  a.mode = 'wander'; a.ball = null; a.target = null; a.fight = null; a.followTarget = null;
  a.idleT = rand(0.3, 1.2); a.zoom = false; a.pounce = 0;
}

// ---------- Play-fights ----------
const fights = [];
function startFight(type, members, center, ball = null) {
  const f = { type, members: [], center: center.clone(), ball, phase: type === 'cat' ? 'approach' : 'tussle',
              timer: type === 'cat' ? 0 : rand(1.6, 2.8), puffT: 0, dir: Math.random() < 0.5 ? 1 : -1 };
  f.center.y = 0;
  fights.push(f);
  if (ball) ball.fight = f;
  for (const m of members) joinFight(f, m);
  if (type === 'dog' && ball) { stats.dogScuffles++; updateScore(); }
  return f;
}
function joinFight(f, a) {
  a.mode = 'fight'; a.fight = f; a.ball = null;
  a.orbit = Math.atan2(a.group.position.z - f.center.z, a.group.position.x - f.center.x);
  f.members.push(a);
}
function resolveFight(f) {
  const i = fights.indexOf(f);
  if (i < 0) return;
  fights.splice(i, 1);
  if (f.ball) f.ball.fight = null;
  if (f.type === 'cat') {
    for (const c of f.members) {
      toWander(c);
      if (f.phase === 'tussle') {
        tmpV.set(c.group.position.x - f.center.x, 0, c.group.position.z - f.center.z).normalize();
        c.target = new THREE.Vector3(c.group.position.x + tmpV.x * 2.2, 0, c.group.position.z + tmpV.z * 2.2);
        c.zoom = true; c.idleT = 0;
      }
    }
    return;
  }
  const b = f.ball;
  const winner = pick(f.members);
  for (const d of f.members) d.fight = null;
  if (b && b.state === 'free' && winner.group.position.distanceTo(b.mesh.position) < 2.5) {
    for (const d of f.members) toWander(d);
    for (const d of f.members) if (d !== winner) { d.mode = 'chase'; d.ball = b; }
    dogGrab(winner, b);
    winner.petTimer = 0;
  } else if (b && b.state === 'free' && b.thrown) {
    for (const d of f.members) { toWander(d); d.mode = 'chase'; d.ball = b; d.chaseT = 0; }
  } else {
    for (const d of f.members) {
      toWander(d);
      if (b && b.state === 'carried' && b.carrier) startFollow(d, b.carrier);
    }
  }
}
function updateFights(dt) {
  for (const f of [...fights]) {
    if (f.type === 'cat' && f.phase === 'approach') {
      const [a, b] = f.members;
      f.timer += dt;
      const d = a.group.position.distanceTo(b.group.position);
      if (d < 0.6) {
        f.phase = 'tussle'; f.timer = rand(2, 3.5);
        f.center.set((a.group.position.x + b.group.position.x) / 2, 0, (a.group.position.z + b.group.position.z) / 2);
        for (const m of f.members) m.orbit = Math.atan2(m.group.position.z - f.center.z, m.group.position.x - f.center.x);
        stats.catScuffles++; updateScore();
      } else if (f.timer > 6) resolveFight(f);
      continue;
    }
    f.timer -= dt;
    if (f.type === 'dog') {
      const b = f.ball;
      if (b && b.state !== 'free') { resolveFight(f); continue; }
      if (b) {
        f.center.x += (b.mesh.position.x - f.center.x) * (1 - Math.exp(-3 * dt));
        f.center.z += (b.mesh.position.z - f.center.z) * (1 - Math.exp(-3 * dt));
        if (Math.random() < dt * 2.5) b.vel.set(rand(-1, 1), rand(0.5, 1.2), rand(-1, 1));
      }
    }
    f.puffT -= dt;
    if (f.puffT <= 0) {
      f.puffT = 0.09;
      tmpV.set(f.center.x + rand(-.3, .3), rand(0.08, 0.35), f.center.z + rand(-.3, .3));
      spawnParticle('puff', tmpV);
      if (Math.random() < 0.3) spawnParticle('star', tmpV.setY(0.45));
    }
    if (Math.random() < dt * 3) {
      const m = pick(f.members);
      if (f.type === 'cat' ? canPlay('mrrp', 0.25) : canPlay('yip', 0.2)) {
        (f.type === 'cat' ? mrrp : yip)(volAt(f.center), m.voice);
      }
    }
    if (f.timer <= 0) resolveFight(f);
  }
}

// ---------- Animal brain ----------
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function turnTo(a, heading, dt, rate) {
  a.group.rotation.y += wrapAngle(heading - a.group.rotation.y) * (1 - Math.exp(-rate * dt));
}
function steer(a, x, z, dt, rate) {
  const dx = x - a.group.position.x, dz = z - a.group.position.z;
  turnTo(a, Math.atan2(dx, dz), dt, rate);
  return Math.hypot(dx, dz);
}
let anyCleanTray = true;
function isRowdy(a) { return !a.isDog && a.toilet > 0.85 && !anyCleanTray; }   // needs the litter tray but they're all dirty
function platformPoint(pl) {
  const ang = rand(0, Math.PI * 2), rr = rand(0, pl.r * 0.3);
  return new THREE.Vector3(pl.x + Math.cos(ang) * rr, pl.y + (pl.bed ? 0.01 : 0), pl.z + Math.sin(ang) * rr);
}
function hopTo(a, c, to, t) {
  c.from = a.group.position.clone(); c.to = to.clone(); c.t0 = t; c.stage = 'hop';
  c.dur = 0.35 + Math.min(0.3, c.from.distanceTo(c.to) * 0.25);
  if (Math.random() < 0.25 && canPlay('mrrp', 0.6)) mrrp(volAt(c.from) * 0.5, a.voice);
}
function startClimb(a, tree, targetIdx, sleep) {
  toWander(a);
  const p0 = tree.platforms[0];
  const out = new THREE.Vector3(Math.cos(p0.ang), 0, Math.sin(p0.ang));
  const path = []; for (let i = 0; i <= targetIdx; i++) path.push(i);
  const reserved = tree.platforms[targetIdx]; reserved.occ++;
  a.mode = 'climb';
  a.climb = { tree, path, reserved, sleep, stage: 'approach', i: 0, dir: 1,
              start: new THREE.Vector3(tree.x + out.x * (0.34 + p0.r + 0.3), 0, tree.z + out.z * (0.34 + p0.r + 0.3)) };
}
function startSleep(a, t) {
  if (!a.isDog && Math.random() < 0.35) {           // cats love a high bed
    const trees = [...catTrees].sort((x, y) => Math.hypot(x.x - a.group.position.x, x.z - a.group.position.z) - Math.hypot(y.x - a.group.position.x, y.z - a.group.position.z));
    for (const tr of trees.slice(0, 2)) { const idx = freePlatform(tr, 2); if (idx >= 0) { startClimb(a, tr, idx, true); return; } }
  }
  toWander(a);
  // snuggle up next to another sleeper of the same kind
  const buddies = (a.isDog ? dogs : cats).filter(o => o !== a && o.mode === 'sleep' && o.lying && o.group.position.distanceTo(a.group.position) < (a.isDog ? 6 : 9));
  const buddy = buddies.length && (!a.isDog || Math.random() < 0.5) ? pick(buddies) : null;
  if (buddy) {
    const ang = rand(0, Math.PI * 2), rr = 0.3 * (a.size + buddy.size);
    a.sleepSpot = new THREE.Vector3(buddy.group.position.x + Math.cos(ang) * rr, 0, buddy.group.position.z + Math.sin(ang) * rr);
  } else {
    a.sleepSpot = new THREE.Vector3(a.group.position.x + rand(-1.5, 1.5), 0, a.group.position.z + rand(-1.5, 1.5));
    const r = Math.hypot(a.sleepSpot.x, a.sleepSpot.z); if (r > ARENA) a.sleepSpot.multiplyScalar(ARENA / r);
  }
  a.mode = 'sleep'; a.lying = false; a.zzzT = rand(0.5, 1.5);
  // cats nod off in groups: nearby cats close to bedtime join in
  if (!a.isDog) {
    const startOfSleep = a.cycleLen * (1 - a.sleepFrac);
    for (const o of cats) {
      if (o === a || o.mode !== 'wander') continue;
      const oStart = o.cycleLen * (1 - o.sleepFrac);
      if (o.group.position.distanceTo(a.group.position) < 5 && oStart - o.cycleT < 25 && oStart - o.cycleT > 0) o.cycleT = oStart + 0.01;
    }
  }
}

function chooseTarget(a, player) {
  if (a.hunger > HUNGRY && Math.random() < 0.5) {
    const ang = rand(0, Math.PI * 2), rad = rand(1.6, 2.6);
    a.target = new THREE.Vector3(FEEDER.x + Math.cos(ang) * rad, 0, FEEDER.z + Math.sin(ang) * rad);
    return;
  }
  if (!a.isDog && a.hunger < HUNGRY && Math.random() < 0.15) {
    const tree = catTrees.filter(tr => Math.hypot(tr.x - a.group.position.x, tr.z - a.group.position.z) < 10)
      .sort((x, y) => Math.hypot(x.x - a.group.position.x, x.z - a.group.position.z) - Math.hypot(y.x - a.group.position.x, y.z - a.group.position.z))[0];
    const idx = tree ? freePlatform(tree) : -1;
    if (idx >= 0) { startClimb(a, tree, idx, false); return; }
  }
  if (a.hunger < HUNGRY && Math.random() < (a.isDog ? 0.12 : 0.3)) {
    let best = null, bd = 6;
    for (const b of balls) {
      if (b.state !== 'free' || b.thrown || b.mesh.position.y > 0.3) continue;
      if (a.isDog && b.yarn) continue;
      if (animals.filter(o => o.mode === 'play' && o.ball === b).length >= 2) continue;
      const d = b.mesh.position.distanceTo(a.group.position) * (!a.isDog && b.yarn ? 0.4 : 1);   // cats much prefer yarn
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { a.mode = 'play'; a.ball = best; a.bats = best.yarn ? 3 + Math.floor(rand(0, 4)) : 2 + Math.floor(rand(0, 3)); return; }
  }
  const distToPlayer = Math.hypot(player.x - a.group.position.x, player.z - a.group.position.z);
  if (a.isDog && distToPlayer > 3 && Math.random() < 0.1) {
    a.target = new THREE.Vector3(player.x + rand(-.6, .6), 0, player.z + rand(-.6, .6));
  } else {
    const ang = rand(0, Math.PI * 2), rad = Math.sqrt(Math.random()) * ARENA;
    a.target = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
  }
  a.zoom = Math.random() < (a.isDog ? 0.2 : isRowdy(a) ? 0.7 : 0.3);
}

function updateAnimal(a, dt, t, player) {
  if (a.sitter && a.mode === 'wander') a.mode = 'sit';
  const g = a.group, p = g.position;
  const dxp = player.x - p.x, dzp = player.z - p.z, distP = Math.hypot(dxp, dzp);
  a.petTimer = Math.max(0, a.petTimer - dt);
  if (a.mode !== 'eat' || !a.eatingNow) a.hunger = Math.min(1, a.hunger + a.hungerRate * dt * (a.lying ? 0.5 : 1));
  a.cycleT = (a.cycleT + dt) % a.cycleLen;
  const sleepy = !a.sitter && a.cycleT > a.cycleLen * (1 - a.sleepFrac);
  if (sleepy && a.mode === 'wander' && a.petTimer <= 0 && a.hunger < HUNGRY && !isRowdy(a)) startSleep(a, t);
  if (a.mode !== 'litter') a.toilet = Math.min(1, a.toilet + a.toiletRate * dt * (a.lying ? 0.4 : 1));
  // go and eat when hungry and there's food in a bowl; cats use the litter tray when they need to
  a.foodCheckT -= dt;
  if (a.foodCheckT <= 0) {
    a.foodCheckT = 0.5;
    const free = a.mode === 'wander' || a.mode === 'play' || a.mode === 'follow';
    const trayCheck = !a.isDog && a.toilet > 0.5 && (free || (a.mode === 'sleep' && a.toilet > 0.85));
    const tr = trayCheck ? cleanTrayFor(a) : null;
    if (tr) { toWander(a); a.mode = 'litter'; a.tray = tr; tr.occupant = a; }
    else if (a.hunger > 0.35 && (a.mode === 'wander' || a.mode === 'play' || a.mode === 'follow' || a.mode === 'fooled')) {
      const bw = freeBowlFor(a);
      if (bw) { toWander(a); a.mode = 'eat'; a.bowl = bw; bw.occupant = a; }
    }
  }
  // hungry pets are noisy
  if ((a.hunger > HUNGRY || isRowdy(a)) && a.mode !== 'eat' && a.mode !== 'litter' && Math.random() < dt * 0.3 * Math.max(a.hunger, a.toilet) && canPlay('hungry', 0.45)) {
    a.group.getWorldPosition(tmpV2);
    const v = volAt(tmpV2) * 0.8;
    if (a.isDog) (Math.random() < 0.55 ? whine : bark)(v, a.voice); else meow(v, a.voice * rand(0.95, 1.15));
  }

  let want = 0, hop = 0, label = false, direct = false, attend = false, tussle = false;

  const happy = a.petTimer > 0 && (a.mode === 'wander' || a.mode === 'play' || a.mode === 'follow');
  if (happy) {
    if (a.mode !== 'wander') toWander(a);
    turnTo(a, Math.atan2(dxp, dzp), dt, 6);
    if (a.isDog) hop = Math.abs(Math.sin(t * 9)) * 0.02;
    a.heartT -= dt;
    if (a.heartT <= 0) { a.heartT = 0.28; a.head.getWorldPosition(tmpV); tmpV.y += 0.15; spawnParticle('heart', tmpV); }
  } else switch (a.mode) {
    case 'chase': {
      const b = a.ball;
      a.chaseT += dt;
      if (!b || a.chaseT > 12) { toWander(a); break; }
      if (b.state === 'held') {
        toWander(a); a.target = new THREE.Vector3(player.x + rand(-1, 1), 0, player.z + rand(-1, 1)); a.idleT = 0; break;
      }
      if (b.state === 'carried') { if (b.carrier !== a) startFollow(a, b.carrier); break; }
      const bp = b.mesh.position;
      const d = steer(a, bp.x, bp.z, dt, 8);
      a.head.getWorldPosition(tmpV);
      const dHead = Math.hypot(tmpV.x - bp.x, tmpV.z - bp.z);
      want = dHead > 0.12 ? a.fast * a.excite * clamp(d / 0.8, 0.35, 1) : 0;
      if (b.fight) {
        if (d < 1.2 && b.fight.members.length < 6) joinFight(b.fight, a);
      } else if (dHead < 0.22 && bp.y < 0.45) {
        const rivals = dogs.filter(o => o !== a && o.mode === 'chase' && o.ball === b &&
          Math.hypot(o.group.position.x - bp.x, o.group.position.z - bp.z) < 2.2);
        if (rivals.length) startFight('dog', [a, ...rivals], bp, b);
        else dogGrab(a, b);
      }
      break;
    }
    case 'fetch': {
      const d = steer(a, player.x, player.z, dt, 6);
      want = a.speed * 1.4;
      if (d < 1.0) dogDrop(a);
      break;
    }
    case 'eat': {
      const bw = a.bowl;
      if (!bw || bw.food <= 0.01) {                     // bowl empty: try another, else give up
        toWander(a);
        const nb = a.hunger > 0.1 && freeBowlFor(a);
        if (nb) { a.mode = 'eat'; a.bowl = nb; nb.occupant = a; }
        break;
      }
      const ox = bw.pos.x - FEEDER.x, oz = bw.pos.z - FEEDER.z, ol = Math.hypot(ox, oz) || 1;
      const sx = bw.pos.x + ox / ol * a.len * 0.45, sz = bw.pos.z + oz / ol * a.len * 0.45;
      const d = steer(a, sx, sz, dt, 7);
      if (d > 0.12) {
        a.eatingNow = false;
        want = a.speed * (a.hunger > HUNGRY ? 1.6 : 1.1) * clamp(d / 0.6, 0.3, 1);
      } else {
        a.eatingNow = true;
        p.x += (sx - p.x) * 0.1; p.z += (sz - p.z) * 0.1;
        turnTo(a, Math.atan2(bw.pos.x - p.x, bw.pos.z - p.z), dt, 8);
        a.hunger = Math.max(0, a.hunger - 0.28 * dt);
        bw.food = Math.max(0, bw.food - 0.09 * dt);
        if (Math.random() < dt * 5 && canPlay('crunch', 0.06)) crunch(volAt(p) * 0.7, a.isDog ? 1800 : 2600);
        if (a.hunger < 0.04) {                          // full and happy
          toWander(a); a.idleT = rand(1, 2.5); a.petTimer = 1.0; a.heartT = 0;
          stats.meals++; updateScore();
        }
      }
      break;
    }
    case 'sit': {
      // puppies and kittens stay sitting; they turn to look at you and love a fuss
      if (distP < 2.2) { turnTo(a, Math.atan2(dxp, dzp), dt, 3); label = true; }
      if (a.petTimer > 0) {
        hop = a.isDog ? Math.abs(Math.sin(t * 9)) * 0.03 : 0;
        a.heartT -= dt;
        if (a.heartT <= 0) { a.heartT = 0.3; a.head.getWorldPosition(tmpV); tmpV.y += 0.12; spawnParticle('heart', tmpV); }
        a.model.rotation.z = Math.sin(t * (a.isDog ? 14 : 5)) * 0.06;
      } else a.model.rotation.z *= 0.9;
      break;
    }
    case 'stalk': {
      const bd = a.stalkBird;
      if (!bd) { toWander(a); break; }
      const bp = bd.root.position;
      const dB = Math.hypot(bp.x - p.x, bp.z - p.z);
      if (a.stalkPhase === 'creep') {
        if (bd.state !== 'ground') { a.stalkPhase = 'lookup'; a.stalkT = rand(1.2, 2); if (Math.random() < 0.5) playOnce(a, 'jump', t); break; }
        steer(a, bp.x, bp.z, dt, 5);
        want = a.speed * 0.4;                                   // low, slow creep
        if (dB < 1.3) { a.stalkPhase = 'wiggle'; a.stalkT = rand(0.5, 0.9); }
      } else if (a.stalkPhase === 'wiggle') {
        turnTo(a, Math.atan2(bp.x - p.x, bp.z - p.z), dt, 10);
        a.stalkT -= dt;
        if (bd.state !== 'ground') { a.stalkPhase = 'lookup'; a.stalkT = 1.5; break; }
        if (a.stalkT <= 0) {
          a.stalkPhase = 'pounce';
          a.pFrom = p.clone(); a.pTo = new THREE.Vector3(bp.x, 0, bp.z); a.pT0 = t;
          bd.fleeDelay = 0.12;                                   // the bird always notices just in time
          if (canPlay('mrrp', 0.3)) mrrp(volAt(p), a.voice * 1.1);
        }
      } else if (a.stalkPhase === 'pounce') {
        direct = true;
        const k = Math.min(1, (t - a.pT0) / 0.45);
        p.lerpVectors(a.pFrom, a.pTo, k);
        p.y = Math.sin(k * Math.PI) * 0.32;
        a.pounceK = k;
        if (k >= 1) { p.y = 0; a.pounceK = 0; a.stalkPhase = 'lookup'; a.stalkT = rand(1.2, 2.2); }
      } else if (a.stalkPhase === 'chaseFly') {
        // bounding after a fluttering butterfly, leaping at it now and then
        a.stalkT -= dt; a.pounceCD -= dt;
        if (bd.state === 'ground') { a.stalkPhase = 'creep'; break; }
        steer(a, bp.x, bp.z, dt, 7);
        want = dB > 0.35 ? a.fast * 0.6 : 0;
        if (dB < 0.7 && a.pounceCD <= 0) {
          a.pounceCD = rand(0.9, 1.5);
          playOnce(a, 'jump', t, 1.3);
          bd.vel.y += rand(0.8, 1.4); bd.vel.x += rand(-1, 1); bd.vel.z += rand(-1, 1);   // flutters up out of reach
          if (canPlay('mrrp', 0.5)) mrrp(volAt(p) * 0.6, a.voice * 1.1);
        }
        if (a.stalkT <= 0 || bp.y > 2.2 || dB > 6) { a.stalkPhase = 'lookup'; a.stalkT = rand(1, 1.8); }
      } else if (a.stalkPhase === 'lookup') {
        // missed! watch it fly away, maybe give chase for a moment
        a.stalkT -= dt;
        turnTo(a, Math.atan2(bp.x - p.x, bp.z - p.z), dt, 6);
        if (bd.state !== 'ground' && bp.y < 2.5 && dB < 4) want = a.fast * 0.8;
        if (a.stalkT <= 0) { toWander(a); a.idleT = rand(0.5, 1.5); }
      }
      break;
    }
    case 'held': {
      direct = true;
      const mid = heldPoint(tmpV);
      if (!mid || mid.distanceTo(playerPos) > 1.4) { dropPet(a); break; }
      a.heldT += dt;
      p.set(mid.x, Math.max(0, mid.y - a.body.position.y * g.scale.x), mid.z);
      turnTo(a, Math.atan2(playerPos.x - p.x, playerPos.z - p.z), dt, 10);
      if (a.isDog) {
        // tries to lick your face
        a.lickT -= dt;
        if (a.lickT <= 0 && a.lickAnim <= 0) { a.lickAnim = 0.35; a.lickT = rand(0.7, 1.6); }
        if (a.lickAnim > 0) {
          const before = a.lickAnim;
          a.lickAnim -= dt;
          if (before > 0.175 && a.lickAnim <= 0.175) {
            a.head.getWorldPosition(tmpV2);
            if (tmpV2.distanceTo(playerPos) < 0.6) {
              slurp(1); spawnParticle('heart', tmpV2.lerp(playerPos, 0.5));
              haptic(0, 0.3, 40); haptic(1, 0.3, 40);
            }
          }
        }
        if (Math.random() < dt * 0.4 && canPlay('yip', 1.2)) yip(0.6, a.voice);
      } else {
        if (a.heldT < CAT_HOLD_OK) {
          // content for a while: purrs and hearts
          if (Math.random() < dt * 0.25 && canPlay('purr', 2.5)) purr(0.8);
          if (Math.random() < dt * 0.5) { a.head.getWorldPosition(tmpV2); tmpV2.y += 0.1; spawnParticle('heart', tmpV2); }
        } else {
          // had enough: meows and wriggles, then hops down
          if (Math.random() < dt * 1.2 && canPlay('meow', 0.9)) meow(0.9, a.voice * 1.15);
          if (Math.random() < dt * 4) { haptic(0, 0.4, 50); haptic(1, 0.4, 50); }
          if (a.heldT > CAT_HOLD_OK + 6) { dropPet(a, true); break; }
        }
      }
      break;
    }
    case 'falling': {
      direct = true;
      a.vy -= 9.8 * dt;
      p.y += a.vy * dt;
      if (a.escaped) { p.x += Math.sin(g.rotation.y + Math.PI) * 1.2 * dt; p.z += Math.cos(g.rotation.y + Math.PI) * 1.2 * dt; }
      if (p.y <= 0) {
        p.y = 0;
        const esc = a.escaped;
        toWander(a); a.idleT = esc ? 0 : 0.6;
        if (esc) {   // dashes off
          const ang = g.rotation.y + Math.PI + rand(-0.6, 0.6);
          a.target = new THREE.Vector3(p.x + Math.sin(ang) * 3, 0, p.z + Math.cos(ang) * 3); a.zoom = true;
        } else if (a.isDog) { a.petTimer = 1.2; a.heartT = 0; }
      }
      break;
    }
    case 'litter': {
      const tr = a.tray;
      if (!tr) { toWander(a); break; }
      if (!a.inTray) {
        if (tr.dirt >= TRAY_FULL) { toWander(a); break; }       // got dirty before we arrived
        const d = steer(a, tr.x, tr.z, dt, 7);
        want = a.speed * clamp(d / 0.6, 0.3, 1.2);
        if (d < 0.18) { a.inTray = true; a.litterT = rand(3, 4.5); }
      } else {
        direct = true;
        p.x += (tr.x - p.x) * 0.1; p.z += (tr.z - p.z) * 0.1;
        a.litterT -= dt;
        g.rotation.y += Math.sin(t * 2.5 + a.seed) * dt * 1.6;     // scratch and turn about
        if (a.litterT <= 0) {
          a.toilet = 0; tr.dirt = Math.min(TRAY_FULL, tr.dirt + 1); addClump(tr);
          toWander(a);
          const ang = rand(0, Math.PI * 2);
          a.target = new THREE.Vector3(tr.x + 1.5 + Math.cos(ang), 0, tr.z + Math.sin(ang) * 1.5);
          a.zoom = Math.random() < 0.6; a.idleT = 0;                  // post-litter zoomies
        }
      }
      break;
    }
    case 'sleep': {
      if (!a.lying && (!sleepy || a.hunger > HUNGRY || isRowdy(a))) { toWander(a); break; }
      if (!a.lying) {
        const d = steer(a, a.sleepSpot.x, a.sleepSpot.z, dt, 5);
        if (d > 0.2) want = a.speed * 0.8 * clamp(d / 0.6, 0.4, 1);
        else { a.lying = true; g.rotation.y += rand(-1.2, 1.2); }
      } else {
        a.zzzT -= dt;
        if (a.zzzT <= 0) { a.zzzT = rand(1.3, 2.2); a.head.getWorldPosition(tmpV); tmpV.y += 0.1; spawnParticle('zzz', tmpV); }
        if (!sleepy || a.hunger > HUNGRY || isRowdy(a)) { toWander(a); a.idleT = rand(1, 2.5); a.idleKey = 'idle2'; }
      }
      break;
    }
    case 'climb': {
      const c = a.climb;
      if (!c) { toWander(a); break; }
      if (c.stage === 'approach') {
        const d = steer(a, c.start.x, c.start.z, dt, 7);
        want = a.speed * 1.3 * clamp(d / 0.6, 0.4, 1);
        if (d < 0.18) { c.i = 0; hopTo(a, c, platformPoint(c.tree.platforms[c.path[0]]), t); c.dir = 1; }
      } else if (c.stage === 'hop') {
        direct = true;
        const k = Math.min(1, (t - c.t0) / c.dur);
        p.lerpVectors(c.from, c.to, k);
        p.y += Math.sin(k * Math.PI) * (0.18 + Math.abs(c.to.y - c.from.y) * 0.25);
        turnTo(a, Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z), dt, 14);
        hop = 0; a.hopping = k;
        if (k >= 1) {
          a.hopping = 0;
          p.copy(c.to);
          if (c.dir > 0 && c.i < c.path.length - 1) { c.i++; c.stage = 'pause'; c.pauseT = rand(0.1, 0.3); }
          else if (c.dir > 0) {
            c.stage = 'perch'; c.perchT = c.sleep ? Infinity : rand(6, 15);
            g.rotation.y = rand(0, Math.PI * 2);
            if (c.sleep) a.lying = true;
          } else if (c.i >= -1) { c.stage = 'pause'; c.pauseT = rand(0.1, 0.25); }
          else { releasePlatform(a); a.climb = null; a.mode = 'wander'; toWander(a); a.idleT = rand(0.5, 1.5); }
        }
      } else if (c.stage === 'pause') {
        direct = true;
        c.pauseT -= dt;
        if (c.pauseT <= 0) {
          if (c.dir > 0) hopTo(a, c, platformPoint(c.tree.platforms[c.path[c.i]]), t);
          else if (c.i >= 0) { hopTo(a, c, platformPoint(c.tree.platforms[c.path[c.i]]), t); c.i--; }
          else { c.i = -2; hopTo(a, c, c.start, t); }
        }
      } else if (c.stage === 'perch') {
        direct = true;
        if (a.lying) {
          a.zzzT -= dt;
          if (a.zzzT <= 0) { a.zzzT = rand(1.3, 2.2); a.head.getWorldPosition(tmpV); tmpV.y += 0.1; spawnParticle('zzz', tmpV); }
          if (!sleepy || a.hunger > HUNGRY || isRowdy(a)) { a.lying = false; c.sleep = false; c.perchT = rand(1, 2); }
        } else c.perchT -= dt;
        if (!a.lying && (c.perchT <= 0 || a.hunger > HUNGRY)) {
          // climb back down, one platform at a time
          c.dir = -1; c.i = c.path.length - 2;
          if (c.i >= 0) hopTo(a, c, platformPoint(c.tree.platforms[c.path[c.i]]), t);
          else hopTo(a, c, c.start, t);
          c.i--;
        }
      }
      break;
    }
    case 'catchase': {
      // a dog bounding after a cat — it never quite catches it
      const c = a.chaseCat;
      a.catChaseT -= dt;
      const d = c ? Math.hypot(c.group.position.x - p.x, c.group.position.z - p.z) : 99;
      if (!c || c.mode !== 'flee' || a.catChaseT <= 0 || d > 7) { giveUpCatChase(a); break; }
      steer(a, c.group.position.x, c.group.position.z, dt, 6);
      want = Math.min(a.fast * 0.9, c.fast * 0.9);
      if (d < 0.7) want *= 0.6;   // ease off rather than bump into it
      if (Math.random() < dt * 0.6 && canPlay('yip', 0.5)) yip(volAt(p) * 0.6, a.voice);
      break;
    }
    case 'flee': {
      const dog = a.chaser;
      if (!dog || dog.mode !== 'catchase' || dog.chaseCat !== a) { toWander(a); a.idleT = rand(0.5, 1.5); break; }
      const ddx = p.x - dog.group.position.x, ddz = p.z - dog.group.position.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      const r0 = Math.hypot(p.x, p.z) || 1;
      const inward = clamp((r0 - (ARENA - 2.5)) / 2, 0, 1) * 1.6;      // swerve away from the fence
      const wob = Math.sin(t * 1.7 + a.seed) * 0.5;
      let hx = ddx / dd - p.x / r0 * inward, hz = ddz / dd - p.z / r0 * inward;
      hx += -hz * wob; hz += hx * wob;
      turnTo(a, Math.atan2(hx, hz), dt, 6);
      want = a.fast;
      a.dodgeT = (a.dodgeT ?? 0) - dt;
      if (dd < 0.75 && a.dodgeT <= 0) {               // a nimble sideways hop
        a.dodgeT = 1.2;
        g.rotation.y += (Math.random() < 0.5 ? 1 : -1) * rand(0.9, 1.4);
        playOnce(a, 'jump', t);
        if (canPlay('mrrp', 0.3)) mrrp(volAt(p) * 0.7, a.voice * 1.1);
      }
      break;
    }
    case 'fooled': {
      if (a.fakePhase === 'run') {
        const d = steer(a, a.fakeTarget.x, a.fakeTarget.z, dt, 7);
        want = a.fast * a.excite * clamp(d / 1.2, 0.35, 1);
        a.fakeRunT += dt;
        if (d < 0.9 || a.fakeRunT > 6) {
          a.fakePhase = 'search'; a.fakeT = rand(1.4, 2.4); a.lookDir = Math.random() < 0.5 ? 1 : -1;
          a.idleKey = 'sniff';
        }
      } else if (a.fakePhase === 'search') {
        // sniff about and look around for the ball that never came
        a.fakeT -= dt;
        g.rotation.y += a.lookDir * 1.4 * dt;
        if (Math.random() < dt * 0.8) a.lookDir *= -1;
        if (a.fakeT <= 0) { a.fakePhase = 'return'; a.idleKey = 'idle2'; }
      } else {
        const d = steer(a, player.x, player.z, dt, 6);
        want = d > 1.4 ? a.fast * 0.75 : 0;
        if (d < 1.5) { toWander(a); a.idleT = rand(1, 2.5); }
      }
      break;
    }
    case 'follow': {
      a.followT -= dt;
      const lead = a.followTarget;
      if (a.followT <= 0 || !lead) { toWander(a); break; }
      const d = steer(a, lead.group.position.x, lead.group.position.z, dt, 6);
      want = d > 0.7 ? a.fast * 0.85 : 0;
      if (lead.carrying && !lead.fight && d < 0.8 && (lead.carrying.tackles ?? 0) < 2 && Math.random() < dt * 0.15) {
        const b = dropCarried(lead);
        b.thrown = true; b.tackles = (b.tackles ?? 0) + 1;
        b.vel.set(rand(-.5, .5), 1, rand(-.5, .5));
        const crew = dogs.filter(o => o !== lead && o !== a && o.mode === 'follow' && o.followTarget === lead &&
          o.group.position.distanceTo(lead.group.position) < 1.8).slice(0, 4);
        startFight('dog', [lead, a, ...crew], b.mesh.position, b);
      }
      break;
    }
    case 'play': {
      const b = a.ball;
      if (!b || b.state !== 'free' || b.thrown) { toWander(a); break; }
      const bp = b.mesh.position;
      const d = steer(a, bp.x, bp.z, dt, 7);
      a.head.getWorldPosition(tmpV);
      const dHead = Math.hypot(tmpV.x - bp.x, tmpV.z - bp.z);
      want = dHead > 0.15 ? a.fast * (a.isDog ? 0.6 : 0.55) * clamp(d / 0.8, 0.3, 1) : 0;
      if (a.pounce > 0) a.pounce -= dt;
      else if (dHead < 0.2 && bp.y < 0.3) {
        const ang = g.rotation.y + rand(-1, 1), sp = rand(1.2, 3);
        if (b.yarn) b.vel.set(Math.sin(ang) * sp * 0.7, rand(0.15, 0.6), Math.cos(ang) * sp * 0.7);
        else b.vel.set(Math.sin(ang) * sp, rand(0.6, 1.8), Math.cos(ang) * sp);
        a.pounce = 0.5; a.bats--;
        playOnce(a, 'jump', t, 1.3);
        if (!a.isDog && canPlay('mrrp', 0.4) && Math.random() < 0.5) mrrp(volAt(p) * 0.7, a.voice);
        if (a.bats <= 0) { toWander(a); a.idleT = rand(1, 3); }
      }
      break;
    }
    case 'fight': {
      const f = a.fight;
      if (!f) { toWander(a); break; }
      if (f.phase === 'approach') {
        const o = f.members.find(m => m !== a);
        steer(a, o.group.position.x, o.group.position.z, dt, 6);
        want = a.speed * 1.4;
      } else {
        direct = true; tussle = true;
        a.orbit += f.dir * 2.2 * dt;
        const R = (f.type === 'cat' ? 0.22 : 0.32) + (f.type === 'cat' ? 0.05 : 0.08) * f.members.length;
        const tx = f.center.x + Math.cos(a.orbit) * R, tz = f.center.z + Math.sin(a.orbit) * R;
        const k = 1 - Math.exp(-10 * dt);
        p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
        turnTo(a, Math.atan2(f.center.x - p.x, f.center.z - p.z), dt, 12);
        hop = Math.abs(Math.sin(t * 9 + a.seed)) * 0.05;
      }
      break;
    }
    default: {
      if (distP < 1.7) {
        turnTo(a, Math.atan2(dxp, dzp), dt, 4);
        label = true; attend = true;
        a.target = null; a.idleT = 0.4;
      } else if (a.idleT > 0) {
        a.idleT -= dt;
      } else {
        if (!a.target) chooseTarget(a, player);
        if (a.mode !== 'wander' || !a.target) break;
        const d = steer(a, a.target.x, a.target.z, dt, a.zoom ? 7 : 4);
        if (d < 0.25) {
          a.target = null; a.zoom = false; a.idleT = rand(0.8, 4);
          a.idleKey = Math.random() < 0.35 ? 'sniff' : (Math.random() < 0.5 ? 'idle2' : 'idle');
        } else want = a.zoom ? a.fast : a.speed;
      }
    }
  }

  if (!direct) {
    a.curSpeed += (want - a.curSpeed) * (1 - Math.exp(-6 * dt));
    p.x += Math.sin(g.rotation.y) * a.curSpeed * dt;
    p.z += Math.cos(g.rotation.y) * a.curSpeed * dt;
  } else a.curSpeed = 0;
  const r = Math.hypot(p.x, p.z);
  if (r > ARENA + 1) { p.x *= (ARENA + 1) / r; p.z *= (ARENA + 1) / r; }
  if (!direct && a.mode !== 'climb') p.y = 0;

  // ----- animation -----
  const lyingNow = a.lying && ((a.mode === 'sleep') || (a.mode === 'climb' && a.climb?.stage === 'perch'));
  if (a.mode === 'held' || a.mode === 'falling') {
    play(a, a.isDog ? 'idle2' : 'idle', { timeScale: a.mode === 'held' && !a.isDog && a.heldT > CAT_HOLD_OK ? 2.5 : 1 });
  } else if (lyingNow) {
    play(a, a.isDog ? 'sniff' : 'idle', { timeScale: 0.18 });   // slow sleepy breathing
  } else if (a.mode === 'climb' && (a.climb?.stage === 'hop' || a.climb?.stage === 'pause' || a.climb?.stage === 'perch')) {
    play(a, 'idle');
  } else if (t >= a.oneShotUntil) {
    if (tussle) {
      a.tussleT -= dt;
      if (a.tussleT <= 0) { a.tussleT = rand(0.25, 0.6); playOnce(a, pick(['jump', 'hitL', 'hitR', 'happy']), t, rand(1.1, 1.5)); }
    } else if (a.curSpeed > a.speed * 1.25) {
      play(a, 'run', { timeScale: clamp(a.curSpeed / a.runNative, 0.7, 1.7) });
    } else if (a.curSpeed > 0.08) {
      play(a, 'walk', { timeScale: clamp(a.curSpeed / a.walkNative, 0.6, 2) });
    } else if (a.mode === 'eat' && a.eatingNow) {
      play(a, a.actions.eat ? 'eat' : 'idle');
    } else if (happy || attend) {
      play(a, 'idle2');
    } else {
      play(a, a.idleKey);
    }
  }
  if (a.hopDur && t - a.hopT0 < a.hopDur) {
    const k = (t - a.hopT0) / a.hopDur;
    hop += Math.sin(k * Math.PI) * a.hopH;
    a.model.rotation.x = a.nuzzle ? Math.sin(k * Math.PI) * 0.25 : -Math.sin(k * Math.PI * 2) * 0.18;
  } else if (a.mode !== 'stalk') {
    // cats have no eating clip: tip the head down into the bowl
    const tilt = (a.mode === 'eat' && a.eatingNow && !a.actions.eat) ? 0.32 + Math.sin(t * 7 + a.seed) * 0.04 : 0;
    a.model.rotation.x += (tilt - a.model.rotation.x) * (1 - Math.exp(-8 * dt));
  }
  const onPlatform = p.y > 0.05;
  const crouch = a.mode === 'stalk' && (a.stalkPhase === 'creep' || a.stalkPhase === 'wiggle');
  const sinkTarget = lyingNow ? (onPlatform ? Math.min(a.sinkMax, 0.05 / g.scale.x) : a.sinkMax) : crouch ? a.sinkMax * 0.4 : (a.mode === 'litter' && a.inTray ? a.sinkMax * 0.3 - 0.06 / g.scale.x : 0);
  a.sinkCur += (sinkTarget - a.sinkCur) * (1 - Math.exp(-4 * dt));
  if (a.mode === 'climb' && a.hopping) a.model.rotation.x = -0.35 * Math.sin(a.hopping * Math.PI);
  let zOff = 0, roll = 0;
  if (a.mode === 'stalk') {
    if (a.stalkPhase === 'wiggle') roll = Math.sin(t * 24) * 0.12;
    if (a.stalkPhase === 'pounce') a.model.rotation.x = -0.5 * Math.sin((a.pounceK || 0) * Math.PI);
    else if (a.stalkPhase === 'lookup') a.model.rotation.x += (-0.25 - a.model.rotation.x) * (1 - Math.exp(-6 * dt));
  }
  if (a.mode === 'held') {
    a.model.rotation.x = -0.45;                                          // held up, head toward you
    if (a.isDog && a.lickAnim > 0) zOff = Math.sin((1 - a.lickAnim / 0.35) * Math.PI) * 0.14;   // lunge in for a lick
    if (!a.isDog && a.heldT > CAT_HOLD_OK) { roll = Math.sin(t * 17) * 0.35; zOff = Math.sin(t * 11) * 0.03; }   // wriggle
  }
  a.model.rotation.z += (roll - a.model.rotation.z) * (1 - Math.exp(-15 * dt));
  a.model.position.z = a.modelBaseZ + zOff / g.scale.x;
  a.model.position.y = a.modelBaseY + hop / g.scale.x - a.sinkCur;
  a.label.visible = label && a.petTimer <= 0 && a.mode !== 'held';
  const rowdy = isRowdy(a) && a.mode !== 'litter';
  const showHungry = (a.hunger > HUNGRY || rowdy) && a.mode !== 'eat' && !a.label.visible;
  a.hungryIconSprite.material = a.hunger > HUNGRY ? HUNGRY_MAT : TRAY_ICON_MAT;
  a.hungryIconSprite.visible = showHungry;
  if (showHungry) a.hungryIconSprite.position.y = a.label.position.y + 0.02 + Math.sin(t * 3 + a.seed) * 0.03;
}

function separateAnimals() {
  // keep pets on the ground out of the cat trees' posts
  for (const A of animals) {
    if (A.group.position.y > 0.05 || A.mode === 'climb') continue;
    for (const tr of catTrees) {
      const dx = A.group.position.x - tr.x, dz = A.group.position.z - tr.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 0.001) { A.group.position.x = tr.x + dx / d * 0.6; A.group.position.z = tr.z + dz / d * 0.6; }
    }
  }
  for (let i = 0; i < animals.length; i++) {
    const A = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const B = animals[j];
      if (A.fight && A.fight === B.fight) continue;
      if (A.group.position.y > 0.05 || B.group.position.y > 0.05) continue;
      const snug = (A.mode === 'sleep' && B.mode === 'sleep') ? 0.55 : 1;
      const p = A.group.position, q = B.group.position;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      const min = 0.32 * (A.size + B.size) * snug;
      if (d > 0.0001 && d < min) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        const wa = A.fight?.phase === 'tussle' ? 0 : 1, wb = B.fight?.phase === 'tussle' ? 0 : 1;
        p.x -= nx * push * wa; p.z -= nz * push * wa;
        q.x += nx * push * wb; q.z += nz * push * wb;
      }
    }
  }
}

let catFightTimer = 3, catChaseTimer = rand(5, 9), dogSquabbleTimer = 4, birdWatchT = 2;
function giveUpCatChase(dog) {
  const c = dog.chaseCat;
  toWander(dog); dog.chaseCat = null;
  dog.idleT = rand(1.5, 3); dog.idleKey = Math.random() < 0.6 ? 'sniff' : 'idle2';
  if (c && c.mode === 'flee' && c.chaser === dog) { toWander(c); c.chaser = null; c.idleT = rand(0.8, 2); }
}
function startCatChase() {
  if (dogs.filter(d => d.mode === 'catchase').length >= 2) return;
  const freeDogs = dogs.filter(d => d.mode === 'wander' && d.petTimer <= 0 && d.group.position.distanceTo(playerPos) > 2).sort(() => Math.random() - 0.5);
  for (const d of freeDogs) {
    let best = null, bd = 6;
    for (const c of cats) {
      if (c.mode !== 'wander' || c.petTimer > 0) continue;
      const dist = c.group.position.distanceTo(d.group.position);
      if (dist < bd) { bd = dist; best = c; }
    }
    if (!best) continue;
    toWander(d);
    d.mode = 'catchase'; d.chaseCat = best; d.catChaseT = rand(3.5, 6.5);
    toWander(best);
    best.mode = 'flee'; best.chaser = d;
    best.group.getWorldPosition(tmpV);
    if (canPlay('bark', 0.5)) bark(volAt(tmpV) * 0.7, d.voice);
    if (canPlay('meow', 0.5)) setTimeout(() => meow(volAt(tmpV) * 0.6, best.voice * 1.15), 250);
    return;
  }
}
function director(dt) {
  birdWatchT -= dt;
  if (birdWatchT <= 0) {
    birdWatchT = rand(1.5, 3);
    for (const bd of butterflies) {
      if (bd.stalker) continue;
      if (bd.state === 'fly' && bd.root.position.y < 1.3) {
        // a low-flying butterfly: a nearby cat gives chase
        const c = cats.find(c => c.mode === 'wander' && !c.sitter && c.petTimer <= 0 && c.hunger < HUNGRY && !isRowdy(c) &&
          Math.hypot(c.group.position.x - bd.root.position.x, c.group.position.z - bd.root.position.z) < 4.5);
        if (c && Math.random() < 0.5) { toWander(c); c.mode = 'stalk'; c.stalkBird = bd; c.stalkPhase = 'chaseFly'; c.stalkT = rand(3, 5.5); c.pounceCD = 0; bd.stalker = c; }
        continue;
      }
      if (bd.state !== 'ground') continue;
      let best = null, bdist = 7;
      for (const c of cats) {
        if (c.mode !== 'wander' || c.sitter || c.petTimer > 0 || c.hunger > HUNGRY || isRowdy(c)) continue;
        const d = Math.hypot(c.group.position.x - bd.root.position.x, c.group.position.z - bd.root.position.z);
        if (d < bdist && d > 1.4) { bdist = d; best = c; }
      }
      if (best && Math.random() < 0.75) {
        toWander(best);
        best.mode = 'stalk'; best.stalkBird = bd; best.stalkPhase = 'creep'; bd.stalker = best;
      }
    }
  }
  catChaseTimer -= dt;
  if (catChaseTimer <= 0) { catChaseTimer = rand(6, 12); startCatChase(); }
  // hungry dogs get grumpy-playful with each other
  dogSquabbleTimer -= dt;
  if (dogSquabbleTimer <= 0) {
    dogSquabbleTimer = rand(3, 6);
    const hungryDogs = dogs.filter(d => d.mode === 'wander' && d.hunger > HUNGRY && d.petTimer <= 0);
    for (const d of hungryDogs) {
      const o = hungryDogs.find(x => x !== d && x.group.position.distanceTo(d.group.position) < 3);
      if (o && fights.filter(f => f.type === 'dog' && !f.ball).length < 2) {
        tmpV.addVectors(d.group.position, o.group.position).multiplyScalar(0.5);
        startFight('dog', [d, o], tmpV);
        break;
      }
    }
  }
  const hungryCats = cats.filter(c => c.hunger > HUNGRY || isRowdy(c)).length;
  catFightTimer -= dt * (1 + hungryCats * 0.35);
  if (catFightTimer > 0) return;
  catFightTimer = rand(2, 5);
  if (fights.filter(f => f.type === 'cat').length >= 2 + (hungryCats > 3 ? 1 : 0)) return;
  const free = cats.filter(c => c.mode === 'wander' && c.petTimer <= 0).sort((x, y) => (y.hunger - x.hunger) + rand(-0.3, 0.3));
  for (const c of free) {
    const partner = free.find(o => o !== c && o.group.position.distanceTo(c.group.position) < 4);
    if (partner) {
      tmpV.addVectors(c.group.position, partner.group.position).multiplyScalar(0.5);
      startFight('cat', [c, partner], tmpV);
      if (canPlay('meow', 0.5)) meow(volAt(tmpV) * 0.6, c.voice * 1.1);
      return;
    }
  }
}

function animalNear(pos, maxD) {
  let best = null, bd = maxD;
  for (const a of animals) {
    a.head.getWorldPosition(tmpV2); let d = pos.distanceTo(tmpV2);
    a.body.getWorldPosition(tmpV2); d = Math.min(d, pos.distanceTo(tmpV2));
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
function ballNear(pos, maxD) {
  let best = null, bd = maxD;
  for (const b of balls) {
    if (b.state === 'held') continue;
    const d = pos.distanceTo(ballWorld(b, tmpV2));
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function ballOnRay(ray, maxDist) {
  let best = null, bestAlong = maxDist;
  for (const b of balls) {
    if (b.state === 'held') continue;
    ballWorld(b, tmpV2);
    const along = tmpV.copy(tmpV2).sub(ray.origin).dot(ray.direction);
    if (along < 0 || along > bestAlong) continue;
    const tol = 0.12 + along * 0.04;
    if (ray.distanceSqToPoint(tmpV2) < tol * tol) { bestAlong = along; best = b; }
  }
  return best;
}

// ---------- Picking pets up with two hands ----------
const CAT_HOLD_OK = 10;   // seconds a cat is happy to be held before it starts wriggling
function pickUp(a) {
  if (a.fight) resolveFight(a.fight);
  if (a.carrying) { const b = dropCarried(a); if (b) b.vel.set(0, 0.5, 0); }
  if (a.climb) { releasePlatform(a); a.climb = null; }
  toWander(a);
  a.mode = 'held'; a.heldT = 0; a.lickT = rand(0.6, 1.2); a.lickAnim = 0; a.escaped = false;
  heldPet = a;
  a.group.getWorldPosition(tmpV2);
  if (a.isDog) { if (canPlay('yip', 0.2)) yip(volAt(tmpV2), a.voice); }
  else if (canPlay('mrrp', 0.2)) mrrp(volAt(tmpV2), a.voice);
  haptic(0, 0.5, 60); haptic(1, 0.5, 60);
}
function dropPet(a, escaped = false) {
  if (heldPet === a) heldPet = null;
  for (const h of hands) if (h.grab?.a === a) h.grab = null;
  a.mode = 'falling'; a.vy = escaped ? 1.5 : 0; a.escaped = escaped;
}
const hp0 = new THREE.Vector3(), hp1 = new THREE.Vector3();
function heldPoint(out) {
  // midpoint between the two hands (window.__debugHands lets the desktop test harness fake two hands)
  if (window.__debugHands) return out.copy(window.__debugHands[0]).add(window.__debugHands[1]).multiplyScalar(0.5);
  if (!pinchPoint(0, hp0) || !pinchPoint(1, hp1)) return null;
  return out.copy(hp0).add(hp1).multiplyScalar(0.5);
}
function slurp(vol = 1) {
  if (!audioOK()) return;
  const c = actx, t = c.currentTime;
  const n = noise(c);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
  const g = c.createGain(); env(g, t, 0.35 * vol, 0.01, 0.06, 0.08);
  n.connect(f).connect(g).connect(c.destination); n.start(t); n.stop(t + 0.2);
}

function pet(a, handIndex, stroking) {
  if (a.fight && a.fight.phase === 'tussle') resolveFight(a.fight);
  const fresh = a.petTimer <= 0;
  a.petTimer = 2.4;
  const t = clock.elapsedTime;
  if (fresh) {
    a.heartT = 0; stats.pets++; updateScore();
    if (a.mode === 'wander' || a.mode === 'play' || a.mode === 'follow') playOnce(a, 'happy', t);
  }
  if (t - a.lastSound > 1.6 && canPlay(a.isDog ? 'bark' : 'meow', 0.4)) {
    a.lastSound = t;
    a.group.getWorldPosition(tmpV2);
    if (a.isDog) bark(volAt(tmpV2), a.voice);
    else if (Math.random() < 0.5) meow(volAt(tmpV2), a.voice); else purr(volAt(tmpV2));
  }
  haptic(handIndex, stroking ? 0.25 : 0.6, stroking ? 40 : 90);
}

// ---------- XR input: controllers + tracked hands ----------
const controllers = [], grips = [], xrHands = [], xrSources = [null, null];
const controllerFactory = new XRControllerModelFactory();
const handFactory = new XRHandModelFactory();
const isHand = (i) => !!xrSources[i]?.hand;
function haptic(i, strength, ms) {
  if (i < 0) return;
  const h = xrSources[i]?.gamepad?.hapticActuators?.[0];
  if (h?.pulse) h.pulse(strength, ms);
}
function jointWorld(i, name, out) {
  const j = xrHands[i]?.joints?.[name];
  if (!j || !j.visible) return null;
  return j.getWorldPosition(out);
}
// Where a hand "is" for grabbing: the pinch point (hands) or the grip (controllers)
function pinchPoint(i, out) {
  if (isHand(i)) {
    if (!jointWorld(i, 'index-finger-tip', out) || !jointWorld(i, 'thumb-tip', tmpV3)) return null;
    return out.add(tmpV3).multiplyScalar(0.5);
  }
  return grips[i].getWorldPosition(out);
}
// Where the palm is, for stroking/patting
function palmPoint(i, out) {
  if (isHand(i)) return jointWorld(i, 'middle-finger-phalanx-proximal', out) || jointWorld(i, 'wrist', out);
  return grips[i].getWorldPosition(out);
}
const ctrlRay = new THREE.Ray();
function controllerRay(i) {
  controllers[i].getWorldPosition(ctrlRay.origin);
  controllers[i].getWorldQuaternion(tmpQ);
  ctrlRay.direction.set(0, 0, -1).applyQuaternion(tmpQ);
  return ctrlRay;
}
function handVelocity(i) {
  const h = hands[i].hist;
  if (h.length < 2) return new THREE.Vector3();
  let dtSum = 0;
  for (let k = 1; k < h.length; k++) dtSum += h[k].dt;
  return h[h.length - 1].p.clone().sub(h[0].p).divideScalar(Math.max(dtSum, 1e-3));
}

// teleport aiming
const aiming = [false, false];
const aimPoint = [new THREE.Vector3(), new THREE.Vector3()], aimValid = [false, false];
const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32),
  new THREE.MeshBasicMaterial({ color: 0x4af0ff, transparent: true, opacity: 0.85, depthWrite: false }));
marker.rotation.x = -Math.PI / 2; marker.visible = false;
scene.add(marker);
function updateAim(i) {
  const ray = controllerRay(i);
  aimValid[i] = false;
  if (ray.direction.y < -0.05) {
    const tt = -ray.origin.y / ray.direction.y;
    if (tt < 15) {
      aimPoint[i].copy(ray.origin).addScaledVector(ray.direction, tt);
      const r = Math.hypot(aimPoint[i].x, aimPoint[i].z);
      if (r > 11.5) aimPoint[i].multiplyScalar(11.5 / r);
      aimPoint[i].y = 0.01;
      aimValid[i] = true;
    }
  }
}
function teleportTo(pt) {
  camera.getWorldPosition(tmpV);
  dolly.position.x += pt.x - tmpV.x;
  dolly.position.z += pt.z - tmpV.z;
}

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  ctrl.addEventListener('connected', e => { xrSources[i] = e.data; });
  ctrl.addEventListener('disconnected', () => { xrSources[i] = null; aiming[i] = false; });
  const press = (btn) => () => {
    const h = hands[i];
    if (h.ball) return;
    audio();
    if (!pinchPoint(i, tmpV)) return;
    if (tmpV.distanceTo(BUTTON) < 0.22) { pressFeeder(i); return; }
    { const tr = trayNear(tmpV, 0.35); if (tr && cleanTray(tr, i)) return; }
    let b = ballNear(tmpV, isHand(i) ? 0.2 : 0.28);
    if (!b) {
      const otherGrab = hands[1 - i].grab?.a;
      const a = (otherGrab && animalNear(tmpV, 0.75) === otherGrab) ? otherGrab : animalNear(tmpV, isHand(i) ? 0.45 : 0.6);
      if (a) {
        pet(a, i, false);
        h.grab = { a, btn };
        const other = hands[1 - i].grab;
        if (other && other.a === a && !heldPet) pickUp(a);
        return;
      }
      b = ballOnRay(controllerRay(i), 12);
      if (!b) { const tr = trayOnRay(controllerRay(i), 4); if (tr) { cleanTray(tr, i); return; } }
    }
    if (b) { grabBall(b, i); h.btn = btn; haptic(i, 0.4, 50); return; }
    if (btn === 'select') { aiming[i] = true; updateAim(i); }
  };
  const release = (btn) => () => {
    const h = hands[i];
    if (h.grab && h.grab.btn === btn) {
      const a = h.grab.a; h.grab = null;
      if (heldPet === a) dropPet(a);
      return;
    }
    if (h.ball && h.btn === btn) {
      const v = handVelocity(i).multiplyScalar(isHand(i) ? 1.6 : 1.4);
      if (v.length() > 16) v.setLength(16);
      throwBall(h.ball, v);
      h.ball = null; h.btn = null;
      return;
    }
    if (btn === 'select' && aiming[i]) {
      aiming[i] = false;
      updateAim(i);
      if (aimValid[i]) { teleportTo(aimPoint[i]); haptic(i, 0.3, 40); }
    }
  };
  ctrl.addEventListener('selectstart', press('select'));
  ctrl.addEventListener('squeezestart', press('squeeze'));
  ctrl.addEventListener('selectend', release('select'));
  ctrl.addEventListener('squeezeend', release('squeeze'));
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
  );
  ray.scale.z = 3;
  ctrl.add(ray);
  ctrl.userData.ray = ray;
  dolly.add(ctrl); controllers.push(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  dolly.add(grip); grips.push(grip);

  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, 'mesh'));
  dolly.add(hand); xrHands.push(hand);
}
renderer.xr.addEventListener('sessionstart', () => audio());

const prevPalm = [new THREE.Vector3(), new THREE.Vector3()], hasPrev = [false, false];
function updateHands(dt) {
  let showMarker = false;
  for (let i = 0; i < 2; i++) {
    const hand = isHand(i);
    grips[i].visible = !hand;
    controllers[i].userData.ray.visible = !hand || aiming[i];
    if (!xrSources[i]) { hasPrev[i] = false; hands[i].hist.length = 0; continue; }

    // ball holder follows the pinch point / grip
    if (pinchPoint(i, tmpV)) {
      holders[i].position.copy(tmpV);
      (hand ? xrHands[i] : grips[i]).getWorldQuaternion(holders[i].quaternion);
      const hist = hands[i].hist;
      hist.push({ p: tmpV.clone(), dt });
      if (hist.length > 6) hist.shift();
      // spot a throwing swing while still holding the ball
      if (hands[i].ball && !pendingFake && clock.elapsedTime > fakeCooldownUntil) {
        const v = handVelocity(i);
        camera.getWorldDirection(tmpV2); tmpV2.y = 0; tmpV2.normalize();
        const fwd = v.x * tmpV2.x + v.z * tmpV2.z;
        if (Math.hypot(v.x, v.z) > 2.0 && fwd > 1.4) {
          pendingFake = { hand: i, ball: hands[i].ball, t0: clock.elapsedTime, pos: tmpV.clone(), vel: v.multiplyScalar(isHand(i) ? 1.6 : 1.4) };
        }
      }
    }

    if (aiming[i]) {
      updateAim(i);
      if (aimValid[i]) { marker.position.copy(aimPoint[i]); showMarker = true; }
    }

    // scoop out a dirty tray by reaching into the sand
    {
      const tip = hand ? jointWorld(i, 'index-finger-tip', tmpV3) : grips[i].getWorldPosition(tmpV3);
      if (tip && tip.y < 0.16) for (const tr of trays) if (Math.abs(tip.x - tr.x) < 0.24 && Math.abs(tip.z - tr.z) < 0.18) cleanTray(tr, i);
    }
    // poke the feed button with a fingertip (hands) or the controller
    {
      const tip = hand ? jointWorld(i, 'index-finger-tip', tmpV3) : grips[i].getWorldPosition(tmpV3);
      if (tip && Math.hypot(tip.x - BUTTON.x, tip.z - BUTTON.z) < 0.08 && tip.y < BUTTON.y + 0.06 && tip.y > BUTTON.y - 0.05) pressFeeder(i);
    }
    // stroking / patting with an empty hand
    if (!hands[i].ball && !hands[i].grab && palmPoint(i, tmpV)) {
      if (hasPrev[i] && dt > 0) {
        tmpV2.copy(tmpV).sub(prevPalm[i]).divideScalar(dt);
        const speed = tmpV2.length();
        const a = animalNear(tmpV, hand ? 0.3 : 0.35);
        if (a) {
          if (hand && tmpV2.y < -0.6) pet(a, i, false);        // a downward pat
          else if (speed > 0.15) {                              // a stroke
            a.stroke += dt;
            if (a.stroke > 0.2) { a.stroke = 0; pet(a, i, true); }
          }
        }
      }
      prevPalm[i].copy(tmpV); hasPrev[i] = true;
    } else hasPrev[i] = false;
  }
  marker.visible = showMarker;
  marker.material.opacity = 0.6 + 0.3 * Math.sin(clock.elapsedTime * 8);
}

let snapReady = true, bWasDown = true;
function updateXRLocomotion(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp || src.hand) continue;
    if (src.handedness === 'right') {
      const bDown = !!gp.buttons[5]?.pressed;      // B button exits VR
      if (bDown && !bWasDown) { session.end(); return; }
      bWasDown = bDown;
    }
    if (gp.axes.length < 4) continue;
    const ax = gp.axes[2], ay = gp.axes[3];
    if (src.handedness === 'left') {
      if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
        camera.getWorldDirection(tmpV); tmpV.y = 0; tmpV.normalize();
        tmpV2.crossVectors(tmpV, UP).normalize();
        dolly.position.addScaledVector(tmpV, -ay * 2 * dt);
        dolly.position.addScaledVector(tmpV2, ax * 2 * dt);
      }
    } else if (src.handedness === 'right') {
      if (Math.abs(ax) > 0.7 && snapReady) {
        snapReady = false;
        const angle = -Math.sign(ax) * Math.PI / 6;
        camera.getWorldPosition(tmpV);
        dolly.position.sub(tmpV).applyAxisAngle(UP, angle).add(tmpV);
        dolly.rotation.y += angle;
      } else if (Math.abs(ax) < 0.3) snapReady = true;
    }
  }
}

// ---------- Desktop controls ----------
let yaw = 0, pitch = -0.2;
const keys = new Set();
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'KeyE' && !renderer.xr.isPresenting) pressFeeder(-1);
  if (e.code === 'KeyC' && !renderer.xr.isPresenting) { const tr = trayNear(playerPos.clone().setY(0), 3); if (tr) cleanTray(tr); }
  if (e.code === 'KeyF' && deskBall && clock.elapsedTime > fakeCooldownUntil && !renderer.xr.isPresenting) {
    camera.getWorldPosition(tmpV); camera.getWorldDirection(tmpV2);
    fakeThrow(landingPoint(tmpV, tmpV2.multiplyScalar(9).add(new THREE.Vector3(0, 2.5, 0))));
  }
});
addEventListener('keyup', e => keys.delete(e.code));
let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', e => {
  audio(); dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
  yaw -= dx * 0.004; pitch = clamp(pitch - dy * 0.004, -1.3, 1.3);
  lastX = e.clientX; lastY = e.clientY;
});
const raycaster = new THREE.Raycaster();
addEventListener('pointerup', e => {
  const wasClick = dragging && !dragMoved;
  dragging = false;
  if (!wasClick || renderer.xr.isPresenting) return;
  raycaster.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (raycaster.ray.distanceSqToPoint(BUTTON) < 0.1 * 0.1 && raycaster.ray.origin.distanceTo(BUTTON) < 3.5) { pressFeeder(-1); return; }
  { const tr = trayOnRay(raycaster.ray, 5); if (tr) { cleanTray(tr); return; } }
  if (deskBall) {
    camera.getWorldDirection(tmpV);
    const b = deskBall; deskBall = null;
    throwBall(b, tmpV.multiplyScalar(9).add(new THREE.Vector3(0, 2.5, 0)));
    return;
  }
  raycaster.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const b = ballOnRay(raycaster.ray, 4);
  // animals: test against a sphere around each body (skinned meshes don't raycast well)
  let hitA = null, hitD = Infinity;
  for (const a of animals) {
    a.body.getWorldPosition(tmpV2);
    const along = tmpV.copy(tmpV2).sub(raycaster.ray.origin).dot(raycaster.ray.direction);
    if (along > 0 && along < hitD && raycaster.ray.distanceSqToPoint(tmpV2) < (0.3 * a.size) ** 2) { hitA = a; hitD = along; }
  }
  const ballDist = b ? ballWorld(b, tmpV).distanceTo(raycaster.ray.origin) : Infinity;
  if (b && (!hitA || ballDist < hitD + 0.2)) { grabBall(b, -1); return; }
  if (hitA && hitD < 2.8) pet(hitA, -1, false);
});
function updateDesktop(dt) {
  camera.rotation.set(pitch, yaw, 0);
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (f || r) {
    const sp = 2.4 * dt;
    dolly.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * r) * sp;
    dolly.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * r) * sp;
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const SHADOW_PETS = 14;
let shadowT = 0;

// ---------- Main loop ----------
updateScore();
window.petPark = { birds, butterflies, animals, dogs, cats, balls, fights, stats, bowls, pressFeeder, trays, cleanTray, pickUp, dropPet, hands, throwBall, grabBall, pet, fakeThrow, startCatChase, renderer, scene, camera, dolly };
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (renderer.xr.isPresenting) { updateXRLocomotion(dt); updateHands(dt); }
  else { updateDesktop(dt); marker.visible = false; }

  const pr = Math.hypot(dolly.position.x, dolly.position.z);
  if (pr > 12) { dolly.position.x *= 12 / pr; dolly.position.z *= 12 / pr; }
  camera.getWorldPosition(playerPos);

  if (pendingFake && clock.elapsedTime - pendingFake.t0 > 0.3) {
    // still holding the ball after the swing: it was a fake!
    const pf = pendingFake; pendingFake = null;
    if (pf.ball.state === 'held') fakeThrow(landingPoint(pf.pos, pf.vel));
  }
  director(dt);
  updateFights(dt);
  for (const a of animals) {
    updateAnimal(a, dt, t, playerPos);
    a.mixer.update(dt);
  }
  separateAnimals();
  updateBalls(dt);
  updateFeeder(dt, t);
  updateTrays(t);
  updateBirds(dt, t);
  updateButterflies(dt, t);
  updateParticles(dt);
  scenery?.update?.(dt, t, playerPos);
  shadowT -= dt;
  if (shadowT <= 0) {
    shadowT = 0.5;
    const ranked = [...animals].sort((x, y) => x.group.position.distanceToSquared(playerPos) - y.group.position.distanceToSquared(playerPos));
    ranked.forEach((a, i) => { const on = i < SHADOW_PETS; if (a.shadowOn !== on) { a.shadowOn = on; a.group.traverse(o => { if (o.isMesh && !o.isSprite) o.castShadow = on; }); } });
  }

  renderer.render(scene, camera);
});
