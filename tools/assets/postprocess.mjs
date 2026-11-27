// Post-process one optimised Poly Haven .glb in place:
//   - optional uniform scale fix (some sources are authored at the wrong unit scale)
//   - simplify very dense meshes to ~TARGET_TRIS (meshoptimizer; no decoder needed at runtime)
//   - downsize textures of small props to 512 px
//   - KHR_mesh_quantization (natively supported by three's GLTFLoader)
// Usage: node tools/assets/postprocess.mjs <file.glb> [--scale 0.1] [--small-textures]
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, quantize, textureCompress, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const TARGET_TRIS = 12000;
const SMALL_PROP = 0.45; // metres: largest bbox dimension below this → 512px textures

const [file, ...rest] = process.argv.slice(2);
const scaleArg = rest.indexOf('--scale');
const scale = scaleArg >= 0 ? parseFloat(rest[scaleArg + 1]) : 1;
const forceSmall = rest.includes('--small-textures');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.simplifier': MeshoptSimplifier });
const doc = await io.read(file);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

if (scale !== 1) {
  for (const node of scene.listChildren()) {
    node.setScale(node.getScale().map((s) => s * scale));
    node.setTranslation(node.getTranslation().map((t) => t * scale));
  }
}

const countTris = () =>
  root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0), 0);

const before = countTris();
const ops = [];
if (before > TARGET_TRIS * 1.25) {
  await MeshoptSimplifier.ready;
  ops.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.06, TARGET_TRIS / before), error: 0.002 }));
}
const { min, max } = getBounds(scene);
const maxDim = Math.max(...[0, 1, 2].map((i) => max[i] - min[i]));
if (maxDim < SMALL_PROP || forceSmall) {
  ops.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }));
}
// Skinned meshes: quantization moves the dequantisation into the inverse bind matrices, which
// renders fine but breaks naive bounds and is fragile for placement code, so leave them alone.
const skinned = root.listSkins().length > 0;
if (!skinned) ops.push(quantize());
ops.push(dedup(), prune());
await doc.transform(...ops);
await io.write(file, doc);
console.log(JSON.stringify({ file, before, after: countTris(), maxDim: +maxDim.toFixed(3), scale, skinned }));
