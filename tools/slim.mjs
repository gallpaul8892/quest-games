// Usage: node slim.mjs in.glb out.glb targetTris texSize
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
const [,, inp, out, target, tex] = process.argv;
await MeshoptSimplifier.ready; await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const tris0 = prim.getIndices() ? prim.getIndices().getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
await doc.transform(weld({}), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, +target / tris0), error: 0.02, lockBorder: false }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [+tex, +tex], quality: 82 }), prune(), dedup());
const p2 = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const tris1 = p2.getIndices().getCount() / 3;
const b = getBounds(doc.getRoot().listScenes()[0]);
console.log(inp.split('/').pop(), 'tris', tris0, '->', tris1, 'bounds', JSON.stringify(b));
await io.write(out, doc);
