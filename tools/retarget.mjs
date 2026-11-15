// node retarget2.mjs rig.glb target.glb out.glb
// Fits a rigged quadruped's skeleton + animations onto a static quadruped mesh (both Y-up, facing +Z).
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
const root = doc.getRoot();
const buf = root.listBuffers()[0];

// ---------- rig in its BIND pose ----------
const skinNode = root.listNodes().find(n => n.getSkin() && n.getMesh());
const skin = skinNode.getSkin();
const joints = skin.listJoints();
const jointSet = new Set(joints);
const meshWorld = M(skinNode.getWorldMatrix());
const ibmAcc = skin.getInverseBindMatrices();
// frame F maps raw mesh coordinates to the rig's world at rest (taken from the root joint, which is at its bind pose)
const IBM = joints.map((j, i) => new THREE.Matrix4().fromArray(ibmAcc.getElement(i, [])));
const F = M(joints[0].getWorldMatrix()).multiply(IBM[0]);
const bindWorld = new Map(joints.map((j, i) => [j, F.clone().multiply(IBM[i].clone().invert())]));
const rigPts = [], rigJ = [], rigW = [];
for (const prim of skinNode.getMesh().listPrimitives()) {
  const P = prim.getAttribute('POSITION'), JJ = prim.getAttribute('JOINTS_0'), WW = prim.getAttribute('WEIGHTS_0');
  for (let i = 0; i < P.getCount(); i++) {
    rigPts.push(new THREE.Vector3().fromArray(P.getElement(i, [])).applyMatrix4(F));
    rigJ.push(JJ.getElement(i, [])); rigW.push(WW.getElement(i, []));
  }
}

// ---------- target ----------
const tNode = tdoc.getRoot().listNodes().find(n => n.getMesh());
const tW = M(tNode.getWorldMatrix()); const tN = new THREE.Matrix3().getNormalMatrix(tW);
const tPrim = tNode.getMesh().listPrimitives()[0];
const TP = tPrim.getAttribute('POSITION'), TN = tPrim.getAttribute('NORMAL');
const tgtPts = [];
for (let i = 0; i < TP.getCount(); i++) tgtPts.push(new THREE.Vector3().fromArray(TP.getElement(i, [])).applyMatrix4(tW));

// ---------- straighten the target: point its body's long axis along +Z ----------
{
  const ys = tgtPts.map(p => p.y).sort((a, b) => a - b), H0 = ys[0], H1 = ys[ys.length - 1];
  const body = tgtPts.filter(p => p.y > H0 + 0.25 * (H1 - H0) && p.y < H0 + 0.7 * (H1 - H0));
  const mx = body.reduce((a, p) => a + p.x, 0) / body.length, mz = body.reduce((a, p) => a + p.z, 0) / body.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of body) { const dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  // principal axis angle measured from +Z toward +X
  let ang = 0.5 * Math.atan2(2 * sxz, szz - sxx);
  if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
  console.log('straightening by', (ang * 180 / Math.PI).toFixed(1), 'deg');
  const R = new THREE.Matrix4().makeRotationY(-ang);
  const C = new THREE.Matrix4().makeTranslation(mx, 0, mz).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-mx, 0, -mz));
  tgtPts.forEach(p => p.applyMatrix4(C));
  tW.premultiply(C); tN.getNormalMatrix(tW);
}

// ---------- affine map rig -> target from robust boxes ----------
const pct = (pts, ax, q) => { const a = pts.map(p => p.getComponent(ax)).sort((x, y) => x - y); return a[Math.floor(q * (a.length - 1))]; };
const box = (pts) => [0, 1, 2].map(ax => [pct(pts, ax, 0.02), pct(pts, ax, 0.98)]);
const bs = box(rigPts), bt = box(tgtPts);
bs[1][0] = Math.min(...rigPts.map(p => p.y)); bt[1][0] = Math.min(...tgtPts.map(p => p.y));
const S = [0, 1, 2].map(ax => (bt[ax][1] - bt[ax][0]) / (bs[ax][1] - bs[ax][0]));
const A = (p) => new THREE.Vector3(...[0, 1, 2].map(ax => (p.getComponent(ax) - bs[ax][0]) * S[ax] + bt[ax][0]));
const tgtCx = (bt[0][0] + bt[0][1]) / 2, tgtCz = (bt[2][0] + bt[2][1]) / 2, tgtH = bt[1][1] - bt[1][0], tgtL = bt[2][1] - bt[2][0];
function snapToLeg(p, name) {
  const side = p.x >= tgtCx ? 1 : -1, front = /Front/.test(name);
  let band = 0.03 * tgtH, pts = [];
  for (let k = 0; k < 4 && pts.length < 12; k++, band *= 1.8)
    pts = tgtPts.filter(v => Math.abs(v.y - p.y) < band && Math.sign(v.x - tgtCx) === side && (front ? v.z > tgtCz : v.z < tgtCz) && Math.abs(v.z - p.z) < 0.22 * tgtL);
  if (pts.length < 6) return;
  const closest = pts.reduce((b, v) => (Math.hypot(v.x - p.x, v.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? v : b));
  const cl = pts.filter(v => Math.hypot(v.x - closest.x, v.z - closest.z) < 0.09 * tgtL);
  const cx = cl.reduce((a, v) => a + v.x, 0) / cl.length, cz = cl.reduce((a, v) => a + v.z, 0) / cl.length;
  const k = p.y < bt[1][0] + 0.45 * tgtH ? 1 : 0.5;
  p.x += (cx - p.x) * k; p.z += (cz - p.z) * k;
}

// ---------- new bind pose: same joint orientations, joints moved to fit the target ----------
const newBind = new Map();
const order = []; const visit = (n) => { order.push(n); n.listChildren().forEach(visit); };
root.listScenes()[0].listChildren().forEach(visit);
const restWorld = new Map(order.map(n => [n, M(n.getWorldMatrix())]));
const parentBind = (n) => { const p = n.getParentNode(); return p ? (newBind.get(p) || bindWorld.get(p) || restWorld.get(p)) : new THREE.Matrix4(); };
const oldParentBind = (n) => { const p = n.getParentNode(); return p ? (bindWorld.get(p) || restWorld.get(p)) : new THREE.Matrix4(); };
const bindLocalOld = new Map(), bindLocalNew = new Map(), parentLin = new Map();
for (const n of order) {
  if (!jointSet.has(n)) continue;
  const bw = bindWorld.get(n);
  const pos = new THREE.Vector3().setFromMatrixPosition(bw);
  const target = A(pos);
  if (/(Leg|Shoulder)/.test(n.getName()) && !/^IK/.test(n.getName())) snapToLeg(target, n.getName());
  const pb = parentBind(n);
  const local = target.clone().applyMatrix4(pb.clone().invert());
  bindLocalOld.set(n, pos.clone().applyMatrix4(oldParentBind(n).clone().invert()));
  bindLocalNew.set(n, local);
  parentLin.set(n, new THREE.Matrix3().setFromMatrix4(pb));
  n.setTranslation(local.toArray());
  const nb = bw.clone(); nb.setPosition(target);
  newBind.set(n, nb);
}
// animated translations: keep the motion but scale it like the skeleton, around the new rest
for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) {
  if (ch.getTargetPath() !== 'translation') continue;
  const n = ch.getTargetNode(); if (!jointSet.has(n)) continue;
  const sampler = ch.getSampler(), out = sampler.getOutput(), cnt = out.getCount();
  const PW = parentLin.get(n), PWi = PW.clone().invert();
  const oldRest = bindLocalOld.get(n), newRest = bindLocalNew.get(n);
  const arr = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const e = new THREE.Vector3(...out.getElement(i, [])).sub(oldRest).applyMatrix3(PW);
    e.set(e.x * S[0], e.y * S[1], e.z * S[2]).applyMatrix3(PWi).add(newRest);
    e.toArray(arr, i * 3);
  }
  sampler.setOutput(doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(buf));
}

// ---------- skin weights ----------
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));
const remapName = (nm) => {
  const side = nm.endsWith('.L') ? '.L' : nm.endsWith('.R') ? '.R' : '';
  if (/^(FF|IKFrontLeg|PoleTarget)\./.test(nm)) return 'FrontLowerLeg' + side;
  if (/^(FFB|IKBackLeg|PoleTargetBack)\./.test(nm)) return 'BackLowerLeg' + side;
  if (process.env.RIGID_TAIL && /^Tail/.test(nm)) return 'Back';   // tail hangs differently from the rig's curled tail
  return nm;
};
const remap = joints.map(j => jointIndex.get(remapName(j.getName())) ?? jointIndex.get(j.getName()));
for (let i = 0; i < rigJ.length; i++) rigJ[i] = rigJ[i].map(j => remap[j]);
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
const deform = (nm) => !/^(FF|FFB|IK|PoleTarget)/.test(nm) && !(process.env.RIGID_TAIL && /^Tail/.test(nm));
const jpos = (j) => new THREE.Vector3().setFromMatrixPosition(newBind.get(j));
const segs = joints.map((j, i) => {
  if (!deform(j.getName())) return null;
  const kids = j.listChildren().filter(c => jointSet.has(c) && deform(c.getName()));
  const a = jpos(j);
  const b = kids.length ? kids.map(jpos).reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(kids.length) : a.clone();
  return { i, a, b, name: j.getName() };
}).filter(Boolean);
const segDist = (p, s) => { const ab = s.b.clone().sub(s.a); const t = Math.max(0, Math.min(1, p.clone().sub(s.a).dot(ab) / Math.max(ab.lengthSq(), 1e-12))); return p.distanceTo(s.a.clone().addScaledVector(ab, t)); };
const JA = new Uint16Array(tgtPts.length * 4), WA = new Float32Array(tgtPts.length * 4);
const hindZ = Math.min(...joints.filter(j => /^(BackLeg|BackUpperLeg|BackLowerLeg|FFB)/.test(j.getName())).map(j => jpos(j).z));
const backIdx = jointIndex.get('Back');
tgtPts.forEach((p, vi) => {
  const near = segs.map(s => [s, segDist(p, s)]).sort((x, y) => x[1] - y[1]);
  const legNear = near.find(([s]) => /Lower|Upper/.test(s.name));
  if (process.env.RIGID_TAIL && p.z < hindZ - 0.04 * tgtL && !(legNear && legNear[1] < 0.03 * tgtL)) { JA[vi * 4] = backIdx; WA[vi * 4] = 1; return; }   // tail stays with the hips
  if (/Lower|Upper/.test(near[0][0].name) && p.y < near[0][0].a.y && near[0][1] < 0.07 * tgtL) {
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

// ---------- swap in the target mesh ----------
const before = new Set(root.listMeshes());
mergeDocuments(doc, tdoc);
const newMesh = root.listMeshes().find(m => !before.has(m));
const prim = newMesh.listPrimitives()[0];
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
// mesh node at the world origin with identity transform, so mesh space == world space
let pn = skinNode.getParentNode(); while (pn) { if (!(pn.getTranslation().every(v => v === 0) && pn.getScale().every(v => v === 1) && pn.getRotation()[3] === 1)) { console.warn('skinned mesh parent has a transform:', pn.getName()); } pn = pn.getParentNode(); }
skinNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const ibm = new Float32Array(joints.length * 16);
joints.forEach((j, i) => { newBind.get(j).clone().invert().toArray(ibm, i * 16); });
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buf));
for (const sc of root.listScenes().slice(1)) { sc.listChildren().forEach(n => n.dispose()); sc.dispose(); }
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
await doc.transform(unpartition(), prune(), dedup());
await io.write(outPath, doc);
console.log('wrote', outPath, 'scale', S.map(v => v.toFixed(3)).join(','));
