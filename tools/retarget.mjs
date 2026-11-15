// node retarget.mjs rig.glb target.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [,, rigPath, tgtPath, outPath] = process.argv;
const doc = await io.read(rigPath);
const tdoc = await io.read(tgtPath);
const M = (arr) => new THREE.Matrix4().fromArray(arr);

// ---------- rig: rest-pose world positions of its skinned vertices ----------
const root = doc.getRoot();
const skinNode = root.listNodes().find(n => n.getSkin() && n.getMesh());
const skin = skinNode.getSkin();
const joints = skin.listJoints();
const ibmAcc = skin.getInverseBindMatrices();
const J = joints.map((j, i) => M(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibmAcc.getElement(i, []))));
const rigPts = [], rigJ = [], rigW = [];
for (const prim of skinNode.getMesh().listPrimitives()) {
  const P = prim.getAttribute('POSITION'), JJ = prim.getAttribute('JOINTS_0'), WW = prim.getAttribute('WEIGHTS_0');
  for (let i = 0; i < P.getCount(); i++) {
    const v = new THREE.Vector3().fromArray(P.getElement(i, []));
    const jj = JJ.getElement(i, []), ww = WW.getElement(i, []);
    const out = new THREE.Vector3();
    for (let k = 0; k < 4; k++) if (ww[k] > 0) out.addScaledVector(v.clone().applyMatrix4(J[jj[k]]), ww[k]);
    rigPts.push(out); rigJ.push(jj); rigW.push(ww);
  }
}

// ---------- target: world positions/normals ----------
const tNode = tdoc.getRoot().listNodes().find(n => n.getMesh());
const tW = M(tNode.getWorldMatrix());
const tN = new THREE.Matrix3().getNormalMatrix(tW);
const tPrim = tNode.getMesh().listPrimitives()[0];
const TP = tPrim.getAttribute('POSITION'), TN = tPrim.getAttribute('NORMAL');
const tgtPts = [];
for (let i = 0; i < TP.getCount(); i++) tgtPts.push(new THREE.Vector3().fromArray(TP.getElement(i, [])).applyMatrix4(tW));

// ---------- robust boxes (2%..98% per axis) and the affine map rig -> target ----------
const pct = (pts, ax, q) => { const a = pts.map(p => p.getComponent(ax)).sort((x, y) => x - y); return a[Math.floor(q * (a.length - 1))]; };
const box = (pts) => [0, 1, 2].map(ax => [pct(pts, ax, 0.02), pct(pts, ax, 0.98)]);
const bs = box(rigPts), bt = box(tgtPts);
// ground contact: use true minimum y for both so the feet stay on the floor
bs[1][0] = Math.min(...rigPts.map(p => p.y)); bt[1][0] = Math.min(...tgtPts.map(p => p.y));
const S = [0, 1, 2].map(ax => (bt[ax][1] - bt[ax][0]) / (bs[ax][1] - bs[ax][0]));
const A = (p) => new THREE.Vector3(...[0, 1, 2].map(ax => (p.getComponent(ax) - bs[ax][0]) * S[ax] + bt[ax][0]));
console.log('scale per axis', S.map(v => v.toFixed(3)));

// ---------- move the skeleton to fit the target ----------
const armature = joints[0].getParentNode ? null : null;
const jointSet = new Set(joints);
const restWorld = new Map();          // node -> original world matrix
for (const n of root.listNodes()) restWorld.set(n, M(n.getWorldMatrix()));
const newWorld = new Map();
// snap a leg joint to the middle of the target's matching leg at that height
const tgtCx = (bt[0][0] + bt[0][1]) / 2, tgtCz = (bt[2][0] + bt[2][1]) / 2, tgtH = bt[1][1] - bt[1][0], tgtL = bt[2][1] - bt[2][0];
function snapToLeg(p, name) {
  const left = name.endsWith('.L') ? (p.x >= tgtCx) : (p.x < tgtCx);
  const side = p.x >= tgtCx ? 1 : -1;
  const front = /Front/.test(name);
  let band = 0.03 * tgtH, pts = [];
  for (let tries = 0; tries < 4 && pts.length < 12; tries++, band *= 1.8) {
    pts = tgtPts.filter(v => Math.abs(v.y - p.y) < band && Math.sign(v.x - tgtCx) === side && (front ? v.z > tgtCz : v.z < tgtCz) && Math.abs(v.z - p.z) < 0.22 * tgtL);
  }
  if (pts.length < 6) return;
  // the leg nearest to the mapped joint: cluster around the closest point
  const closest = pts.reduce((b, v) => (Math.hypot(v.x - p.x, v.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? v : b));
  const cl = pts.filter(v => Math.hypot(v.x - closest.x, v.z - closest.z) < 0.09 * tgtL);
  const cx = cl.reduce((a, v) => a + v.x, 0) / cl.length, cz = cl.reduce((a, v) => a + v.z, 0) / cl.length;
  // only pull the joint toward the leg centre for joints below the belly; shoulders/hips stay in the body
  const k = p.y < bt[1][0] + 0.45 * tgtH ? 1 : 0.5;
  p.x += (cx - p.x) * k; p.z += (cz - p.z) * k;
}
const order = [];
const visit = (n) => { order.push(n); n.listChildren().forEach(visit); };
root.listScenes()[0].listChildren().forEach(visit);
const origT = new Map();
for (const n of order) origT.set(n, n.getTranslation().slice());
// which nodes to move: every node under the armature (the joints and IK helpers)
const armatureRoot = (() => { let n = joints[0]; while (n.getParentNode() && !n.getParentNode().getMesh() && n.getParentNode().getParentNode()) n = n.getParentNode(); return n; })();
const moveSet = new Set(); const mark = (n) => { moveSet.add(n); n.listChildren().forEach(mark); }; armatureRoot.listChildren().forEach(mark);
for (const n of order) {
  const parent = n.getParentNode();
  const pW = parent ? (newWorld.get(parent) || restWorld.get(parent)) : new THREE.Matrix4();
  if (moveSet.has(n)) {
    const pos = new THREE.Vector3().setFromMatrixPosition(restWorld.get(n));
    const target = A(pos);
    if (/(Leg|Shoulder)/.test(n.getName()) && !/^IK/.test(n.getName())) snapToLeg(target, n.getName());
    const local = target.clone().applyMatrix4(pW.clone().invert());
    n.setTranslation(local.toArray());
  }
  const lm = new THREE.Matrix4().compose(new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()), new THREE.Vector3(...n.getScale()));
  newWorld.set(n, pW.clone().multiply(lm));
}
// shift translation keyframes by the change in rest translation
for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) {
  if (ch.getTargetPath() !== 'translation') continue;
  const n = ch.getTargetNode(); if (!moveSet.has(n)) continue;
  const sampler = ch.getSampler();
  const out = sampler.getOutput();
  const cnt = out.getCount();
  const arr = new Float32Array(cnt * 3);
  // motion relative to the old rest translation, scaled per world axis like the skeleton, then re-based on the new rest
  const parent = n.getParentNode();
  const PW = new THREE.Matrix3().setFromMatrix4(newWorld.get(parent) || restWorld.get(parent));
  const PWi = PW.clone().invert();
  const oldRest = new THREE.Vector3(...origT.get(n)), newRest = new THREE.Vector3(...n.getTranslation());
  for (let i = 0; i < cnt; i++) {
    const e = new THREE.Vector3(...out.getElement(i, [])).sub(oldRest).applyMatrix3(PW);
    e.set(e.x * S[0], e.y * S[1], e.z * S[2]).applyMatrix3(PWi).add(newRest);
    e.toArray(arr, i * 3);
  }
  // always give each sampler its own fresh float accessor, so shared/quantized data is never shifted twice
  sampler.setOutput(doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(doc.getRoot().listBuffers()[0]));
}

// ---------- weights by nearest rig vertices (rig points mapped into target space) ----------
const mapped = rigPts.map(A);
const cell = 0.03 * Math.max(...[0, 1, 2].map(ax => bt[ax][1] - bt[ax][0]));
const grid = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
mapped.forEach((p, i) => { const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
const nearest = (p, K) => {
  const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
  for (let r = 1; r < 40; r++) {
    const cand = [];
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) { const g = grid.get(key(x, y, z)); if (g) cand.push(...g); }
    if (cand.length >= K) return cand.map(i => [i, mapped[i].distanceToSquared(p)]).sort((a, b) => a[1] - b[1]).slice(0, K);
  }
  return [];
};
// feet in the source rig hang off IK helper bones; give their weight to the lower leg so paws move with the leg
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));
const remapName = (nm) => {
  const side = nm.endsWith('.L') ? '.L' : nm.endsWith('.R') ? '.R' : '';
  if (/^(FF|IKFrontLeg|PoleTarget)\./.test(nm)) return 'FrontLowerLeg' + side;
  if (/^(FFB|IKBackLeg|PoleTargetBack)\./.test(nm)) return 'BackLowerLeg' + side;
  return nm;
};
const remap = joints.map(j => jointIndex.get(remapName(j.getName())) ?? jointIndex.get(j.getName()));
for (let i = 0; i < rigJ.length; i++) rigJ[i] = rigJ[i].map(j => remap[j]);
const JA = new Uint16Array(tgtPts.length * 4), WA = new Float32Array(tgtPts.length * 4);
// bone segments of the retargeted skeleton (deforming bones only)
const deform = (nm) => !/^(FF|FFB|IK|PoleTarget)/.test(nm);
const jw = (j) => new THREE.Vector3().setFromMatrixPosition(newWorld.get(j));
const segs = joints.map((j, i) => {
  if (!deform(j.getName())) return null;
  const kids = j.listChildren().filter(c => jointSet.has(c) && deform(c.getName()));
  const a = jw(j);
  const b = kids.length ? kids.map(jw).reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(kids.length) : a.clone().add(a.clone().sub(jw(j.getParentNode() || j)).multiplyScalar(0.5));
  return { i, a, b, name: j.getName() };
}).filter(Boolean);
const legRe = /(Leg|Shoulder)/;
const segDist = (p, s) => { const ab = s.b.clone().sub(s.a); const t = Math.max(0, Math.min(1, p.clone().sub(s.a).dot(ab) / Math.max(ab.lengthSq(), 1e-9))); return p.distanceTo(s.a.clone().addScaledVector(ab, t)); };
tgtPts.forEach((p, vi) => {
  // legs: bind to the nearest leg bones by distance, which follows the target's own leg shape
  const near = segs.map(s => [s, segDist(p, s)]).sort((x, y) => x[1] - y[1]);
  if (/Lower|Upper/.test(near[0][0].name) && p.y < near[0][0].a.y) {
    const top = near.slice(0, 2).map(([s, d]) => [s.i, 1 / Math.pow(d + 1e-3, 4)]);
    const sum = top.reduce((a, e) => a + e[1], 0);
    top.forEach(([j, w], k) => { JA[vi * 4 + k] = j; WA[vi * 4 + k] = w / sum; });
    return;
  }
  const acc = new Map();
  for (const [i, d2] of nearest(p, 6)) { const w0 = 1 / (Math.sqrt(d2) + 1e-4); for (let k = 0; k < 4; k++) if (rigW[i][k] > 0) acc.set(rigJ[i][k], (acc.get(rigJ[i][k]) || 0) + rigW[i][k] * w0); }
  const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  top.forEach(([j, w], k) => { JA[vi * 4 + k] = j; WA[vi * 4 + k] = w / sum; });
});

// ---------- bring the target mesh into the rig document ----------
const before = new Set(doc.getRoot().listMeshes());
mergeDocuments(doc, tdoc);
const newMesh = doc.getRoot().listMeshes().find(m => !before.has(m));
const prim = newMesh.listPrimitives()[0];
const buf = doc.getRoot().listBuffers()[0];
const posArr = new Float32Array(tgtPts.length * 3); tgtPts.forEach((p, i) => p.toArray(posArr, i * 3));
const nrmArr = new Float32Array(tgtPts.length * 3);
for (let i = 0; i < TN.getCount(); i++) new THREE.Vector3().fromArray(TN.getElement(i, [])).applyMatrix3(tN).normalize().toArray(nrmArr, i * 3);
prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(posArr).setBuffer(buf));
prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrmArr).setBuffer(buf));
prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(JA).setBuffer(buf));
prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(WA).setBuffer(buf));
const oldMesh = skinNode.getMesh();
skinNode.setMesh(newMesh);
oldMesh.listPrimitives().forEach(p => p.dispose()); oldMesh.dispose();
// skinned mesh node at identity so mesh space == world space
skinNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
// new inverse bind matrices
const ibm = new Float32Array(joints.length * 16);
joints.forEach((j, i) => { newWorld.get(j).clone().invert().toArray(ibm, i * 16); });
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buf));
// drop the target's own scene/nodes
for (const sc of doc.getRoot().listScenes().slice(1)) { sc.listChildren().forEach(n => n.dispose()); sc.dispose(); }
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
await doc.transform(unpartition(), prune(), dedup());
await io.write(outPath, doc);
console.log('wrote', outPath, 'verts', tgtPts.length, 'joints', joints.length);
