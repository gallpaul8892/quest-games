// Pet Park — WebXR pet sandbox for Meta Quest 3 (three.js r160)
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const statusEl = document.getElementById('status');
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Model + animation config. Clip names are matched on the part after the last "|".
// ---------------------------------------------------------------------------
const MODEL_CONFIG = {
  dog: {
    url: './models/dog.glb', length: 0.8, yaw: 0,
    mainMat: 'Main', lightMat: 'Main_Light',
    walkNative: 1.0, runNative: 3.2,
    clips: {
      idle: ['Idle'], idle2: ['Idle_2', 'Idle'], sniff: ['Idle_2_HeadLow', 'Eating'],
      walk: ['Walk'], run: ['Gallop'], jump: ['Gallop_Jump', 'Jump_ToIdle'],
      happy: ['Jump_ToIdle', 'Idle_2'], hitL: ['Idle_HitReact_Left'], hitR: ['Idle_HitReact_Right'],
    },
  },
  husky: {
    url: './models/husky.glb', length: 1.0, yaw: 0,
    walkNative: 1.25, runNative: 4.0,
    mainMat: 'Material', lightMat: 'Material.001',
    clips: {
      idle: ['Idle'], idle2: ['Idle_2', 'Idle'], sniff: ['Idle_2_HeadLow', 'Eating'],
      walk: ['Walk'], run: ['Gallop'], jump: ['Gallop_Jump', 'Jump_ToIdle'],
      happy: ['Jump_ToIdle', 'Idle_2'], hitL: ['Idle_HitReact_Left'], hitR: ['Idle_HitReact_Right'],
    },
  },
  cat: {
    // Quaternius Animal Pack Vol.2 cat: only Idle + Walking clips; jumps/headbutts are procedural
    url: './models/cat.glb', length: 0.5, yaw: 0,
    walkNative: 0.55, runNative: 1.25,
    clips: {
      idle: ['Idle'], idle2: ['Idle'], sniff: ['Idle'],
      walk: ['Walking', 'Walk'], run: ['Run', 'Walking'],
    },
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
document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }));

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

const hello = makeTextPanel('Hello, World!', 1024, 256, 130, 1.6);
hello.position.set(0, 2.1, -2.5);
scene.add(hello);
const scorePanel = makeTextPanel('', 2000, 128, 46, 2.6);
scorePanel.position.set(0, 1.75, -2.5);
scene.add(scorePanel);

const stats = { pets: 0, fetches: 0, catScuffles: 0, dogScuffles: 0, fakeOuts: 0 };
function updateScore() {
  scorePanel.userData.setText(`Pets: ${stats.pets}  ·  Fetches: ${stats.fetches}  ·  Fake-outs: ${stats.fakeOuts}  ·  Cat scuffles: ${stats.catScuffles}  ·  Dog pile-ups: ${stats.dogScuffles}`);
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
const [dogTpl, huskyTpl, catTpl] = await Promise.all([loadTemplate('dog'), loadTemplate('husky'), loadTemplate('cat')]);
const TPL = { dog: dogTpl, husky: huskyTpl, cat: catTpl };

// ---------- Animals ----------
const DOG_NAMES = ['Biscuit', 'Pepper', 'Bramble', 'Scout', 'Hamish', 'Maisie', 'Bonnie', 'Archie', 'Rolo', 'Toffee', 'Murphy'];
const CAT_NAMES = ['Mochi', 'Tilly', 'Smudge', 'Willow', 'Haggis', 'Pixel', 'Clover', 'Nutmeg', 'Luna', 'Pudding', 'Socks'];
// dog coats: [main, light]
// Dog line-up: breed, size multiplier and coat [main, light]. Small, medium and large.
const TAN = [0xc47a35, 0xf3e9da], CREAM = [0xead9bd, 0xfaf5ec], BLACKTAN = [0x2b2622, 0xd9b48a], SESAME = [0x8a6540, 0xeadcc6];
const H_BLACK = [0x33343a, 0xf2f2f2], H_GREY = [0x8b8f96, 0xf4f4f4], H_COPPER = [0x9a5a33, 0xf3ece2], H_WHITE = [0xe8e6e0, 0xffffff];
const DOG_TYPES = [
  { breed: 'dog', mul: 0.55, coat: TAN }, { breed: 'dog', mul: 0.62, coat: CREAM }, { breed: 'dog', mul: 0.7, coat: BLACKTAN },
  { breed: 'dog', mul: 0.9, coat: SESAME }, { breed: 'dog', mul: 1.0, coat: TAN }, { breed: 'dog', mul: 1.08, coat: BLACKTAN },
  { breed: 'husky', mul: 0.6, coat: H_GREY },
  { breed: 'husky', mul: 1.0, coat: H_BLACK }, { breed: 'husky', mul: 1.1, coat: H_COPPER },
  { breed: 'husky', mul: 1.22, coat: H_GREY }, { breed: 'husky', mul: 1.35, coat: H_WHITE },
];
// cat tints (multiplied over the texture, or used as the main colour)
// realistic cat colours: black, grey, white, ginger (orange), brown tabby, cream
const CAT_TINTS = [0x26262a, 0x8a8d94, 0xeeeae2, 0xd98a3a, 0x7a6248, 0xe6cfa8];

function setupMaterials(model, kind, coat, cfg) {
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;   // skinned bounds are unreliable; there are only 22 animals
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const c = m.clone();
      if (kind === 'dog') {
        if (c.name === cfg.mainMat) c.color.setHex(coat[0]);
        else if (c.name === cfg.lightMat) c.color.setHex(coat[1]);
      } else {
        if (/grey|main|fur|body/i.test(c.name)) c.color.setHex(coat);
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

function makeAnimal({ kind, breed = kind, mul = 1, name, coat, x, z }) {
  const isDog = kind === 'dog';
  const tpl = TPL[breed];
  const group = new THREE.Group();
  const model = SkeletonUtils.clone(tpl.scene);
  model.scale.multiplyScalar(tpl.k);
  model.position.set(-tpl.centerX, -tpl.minY, -tpl.centerZ);
  setupMaterials(model, kind, coat, tpl.cfg);
  group.add(model);

  let head = null;
  model.traverse(o => { if (!head && o.isBone && /^head$/i.test(o.name)) head = o; });
  if (!head) model.traverse(o => { if (!head && o.isBone && /head/i.test(o.name)) head = o; });
  const bodyAnchor = new THREE.Object3D();
  bodyAnchor.position.y = tpl.height * 0.55;
  group.add(bodyAnchor);
  if (!head) { head = new THREE.Object3D(); head.position.set(0, tpl.height * 0.85, tpl.cfg.length * 0.4); group.add(head); }

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

  const a = {
    kind, name, isDog, group, model, modelBaseY: model.position.y, head, body: bodyAnchor, label,
    mixer, actions, current: null, oneShotUntil: 0, idleKey: 'idle',
    walkNative: tpl.cfg.walkNative * variation, runNative: tpl.cfg.runNative * variation,
    size: (isDog ? 1 : 0.72) * variation,
    speed: (isDog ? 1.1 : 0.8) * (0.6 + 0.4 * variation) * rand(0.9, 1.1), fast: (isDog ? 3.0 : 2.6) * (0.7 + 0.3 * variation) * rand(0.9, 1.1),
    voice: clamp(rand(0.95, 1.1) / Math.sqrt(variation), 0.7, 1.5), seed: rand(0, 100),
    mode: 'wander', target: null, idleT: rand(0, 2), zoom: false,
    curSpeed: 0, petTimer: 0, heartT: 0, lastSound: -10, stroke: 0,
    ball: null, carrying: null, fight: null, followTarget: null, followT: 0, chaseT: 0, excite: 1, bats: 0, pounce: 0, tussleT: 0,
  };
  group.traverse(o => { o.userData.animal = a; });
  play(a, 'idle');
  mixer.update(rand(0, 3));   // desync idle loops
  return a;
}

function play(a, role, { once = false, fade = 0.25, timeScale = 1 } = {}) {
  const act = a.actions[role];
  if (!act) return 0;
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
const dogs = DOG_NAMES.map((name, i) => makeAnimal({ kind: 'dog', name, ...DOG_TYPES[i % DOG_TYPES.length], ...spawnSpot() }));
const cats = CAT_NAMES.map((name, i) => makeAnimal({ kind: 'cat', name, mul: [0.85, 1, 1.1, 0.7][i % 4], coat: CAT_TINTS[i % CAT_TINTS.length], ...spawnSpot() }));
const animals = [...dogs, ...cats];
statusEl.textContent = 'Ready! Tap “Enter VR” on your Quest.';

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
      if (b.vel.y < -1.5 && canPlay('boing', 0.08)) boing(volAt(p) * 0.6);
      if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.5;
      if (Math.abs(b.vel.y) < 0.4) b.vel.y = 0;
      const f = Math.exp(-(onTable ? 5 : 1.1) * dt);
      b.vel.x *= f; b.vel.z *= f;
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 0.01) {
        tmpV.set(b.vel.z, 0, -b.vel.x).normalize();
        b.mesh.rotateOnWorldAxis(tmpV, hs * dt / b.r);
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
const hands = [{ ball: null, btn: null, hist: [] }, { ball: null, btn: null, hist: [] }];
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
    if (d.mode === 'fetch' || d.mode === 'fight') continue;
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
    if (d.mode === 'fetch' || d.mode === 'fight') continue;
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
  if (type === 'dog') { stats.dogScuffles++; updateScore(); }
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
      if (!b || b.state !== 'free') { resolveFight(f); continue; }
      f.center.x += (b.mesh.position.x - f.center.x) * (1 - Math.exp(-3 * dt));
      f.center.z += (b.mesh.position.z - f.center.z) * (1 - Math.exp(-3 * dt));
      if (Math.random() < dt * 2.5) b.vel.set(rand(-1, 1), rand(0.5, 1.2), rand(-1, 1));
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
function chooseTarget(a, player) {
  if (Math.random() < (a.isDog ? 0.12 : 0.3)) {
    let best = null, bd = 6;
    for (const b of balls) {
      if (b.state !== 'free' || b.thrown || b.mesh.position.y > 0.3) continue;
      if (animals.filter(o => o.mode === 'play' && o.ball === b).length >= 2) continue;
      const d = b.mesh.position.distanceTo(a.group.position);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { a.mode = 'play'; a.ball = best; a.bats = 2 + Math.floor(rand(0, 3)); return; }
  }
  const distToPlayer = Math.hypot(player.x - a.group.position.x, player.z - a.group.position.z);
  if (a.isDog && distToPlayer > 3 && Math.random() < 0.1) {
    a.target = new THREE.Vector3(player.x + rand(-.6, .6), 0, player.z + rand(-.6, .6));
  } else {
    const ang = rand(0, Math.PI * 2), rad = Math.sqrt(Math.random()) * ARENA;
    a.target = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
  }
  a.zoom = Math.random() < (a.isDog ? 0.2 : 0.3);
}

function updateAnimal(a, dt, t, player) {
  const g = a.group, p = g.position;
  const dxp = player.x - p.x, dzp = player.z - p.z, distP = Math.hypot(dxp, dzp);
  a.petTimer = Math.max(0, a.petTimer - dt);

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
        b.vel.set(Math.sin(ang) * sp, rand(0.6, 1.8), Math.cos(ang) * sp);
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

  // ----- animation -----
  if (t >= a.oneShotUntil) {
    if (tussle) {
      a.tussleT -= dt;
      if (a.tussleT <= 0) { a.tussleT = rand(0.25, 0.6); playOnce(a, pick(['jump', 'hitL', 'hitR', 'happy']), t, rand(1.1, 1.5)); }
    } else if (a.curSpeed > a.speed * 1.25) {
      play(a, 'run', { timeScale: clamp(a.curSpeed / a.runNative, 0.7, 1.7) });
    } else if (a.curSpeed > 0.08) {
      play(a, 'walk', { timeScale: clamp(a.curSpeed / a.walkNative, 0.6, 2) });
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
  } else a.model.rotation.x = 0;
  a.model.position.y = a.modelBaseY + hop / g.scale.x;
  a.label.visible = label && a.petTimer <= 0;
}

function separateAnimals() {
  for (let i = 0; i < animals.length; i++) {
    const A = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const B = animals[j];
      if (A.fight && A.fight === B.fight) continue;
      const p = A.group.position, q = B.group.position;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      const min = 0.32 * (A.size + B.size);
      if (d > 0.0001 && d < min) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        const wa = A.fight?.phase === 'tussle' ? 0 : 1, wb = B.fight?.phase === 'tussle' ? 0 : 1;
        p.x -= nx * push * wa; p.z -= nz * push * wa;
        q.x += nx * push * wb; q.z += nz * push * wb;
      }
    }
  }
}

let catFightTimer = 3;
function director(dt) {
  catFightTimer -= dt;
  if (catFightTimer > 0) return;
  catFightTimer = rand(2, 5);
  if (fights.filter(f => f.type === 'cat').length >= 2) return;
  const free = cats.filter(c => c.mode === 'wander' && c.petTimer <= 0).sort(() => Math.random() - 0.5);
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
    let b = ballNear(tmpV, isHand(i) ? 0.2 : 0.28);
    if (!b) {
      const a = animalNear(tmpV, isHand(i) ? 0.45 : 0.6);
      if (a) { pet(a, i, false); return; }
      b = ballOnRay(controllerRay(i), 12);
    }
    if (b) { grabBall(b, i); h.btn = btn; haptic(i, 0.4, 50); return; }
    if (btn === 'select') { aiming[i] = true; updateAim(i); }
  };
  const release = (btn) => () => {
    const h = hands[i];
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

    // stroking / patting with an empty hand
    if (!hands[i].ball && palmPoint(i, tmpV)) {
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

// ---------- Main loop ----------
updateScore();
window.petPark = { animals, dogs, cats, balls, fights, stats, throwBall, grabBall, pet, fakeThrow, renderer, scene, camera, dolly };
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
  updateParticles(dt);
  scenery?.update?.(dt, t, playerPos);

  hello.position.y = 2.1 + Math.sin(t * 1.5) * 0.03;
  renderer.render(scene, camera);
});
