// Build public/assets/models/manifest.json: bbox size/center, triangle count, bytes.
// Also verifies each .glb parses. Usage: node tools/assets/model_manifest.mjs [--verbose]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../../public/assets/models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const verbose = process.argv.includes('--verbose');
const manifestPath = path.join(dir, 'manifest.json');
const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).models ?? {} : {};
const models = {};
// Hand-written notes from a visual check of every model (fronts face +Z, origin at the base unless noted).
const NOTES = {
  steel_frame_shelves_01: 'source authored at 10x scale; fixed (x0.1) in postprocess',
  WoodenChair_01: 'a tall carved gothic throne-like chair (2.27 m), not a plain kitchen chair',
  vintage_telephone_wall_clock: 'red crank-style wall unit with bells and a clock face; the closest thing to an old wall telephone (no rotary phone model exists on Poly Haven)',
  vintage_flashlight: 'large red signal/lantern-style flashlight (not a slim handheld torch)',
  old_gas_mask: 'hanging: origin is at the top hook, the hose hangs down to y = -1.0',
  pull_chain_light_socket: 'ceiling fitting; origin at the ceiling mount, hangs down',
  lantern_chandelier_01: 'ceiling lantern; origin at the top, hangs down',
  Chandelier_01: 'ceiling chandelier; origin at the top mount',
  hanging_picture_frame_01: 'black empty board/frame — good for a custom photo texture',
  hanging_picture_frame_02: 'white frame with a black canvas area — good for a custom photo/scratched-out portrait',
  dining_table: 'has a gingham tablecloth',
  rubber_boots: 'contains two pairs side by side (a clean and a muddy variant)',
  vintage_suitcase: 'contains two suitcases side by side',
  tea_set_01: 'a spread-out set: teapot, cups, saucers',
  brass_candleholders: 'three holders side by side (x = -0.4, 0, +0.4): small single, triple, five-arm candelabra',
  book_encyclopedia_set_01: 'a row of 20 books, each its own node',
  bench_vice_01: 'skinned (rigged) mesh; not quantized',
  ornate_mirror_01: 'mirror glass is metallic/roughness 0 — reflects scene.environment',
  lightbulb_01: 'glass bulb looks black with no emissive; set emissive in code if used lit',
  Television_01: '1970s/80s wood-side CRT TV',
  television_02: '1980s grey CRT TV',
  power_box_01: 'modern-ish breaker board with an open door — the fuse box',
};
const WALL = 'wall-mounted: origin at the centre of the back face (z = 0); place flush on a wall, front +Z';
for (const id of ['ornate_mirror_01', 'wall_clock', 'hanging_picture_frame_01', 'hanging_picture_frame_02', 'fancy_picture_frame_01', 'fancy_picture_frame_02']) {
  NOTES[id] = NOTES[id] ? `${WALL}; ${NOTES[id]}` : WALL;
}
const bad = [];

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
  const id = file.replace(/\.glb$/, '');
  try {
    const doc = await io.read(path.join(dir, file));
    const root = doc.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const { min, max } = getBounds(scene);
    let tris = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
        tris += Math.floor(n / 3);
      }
    }
    const texBytes = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
    const r = (v) => Math.round(v * 1000) / 1000;
    models[id] = {
      ...(prev[id] ?? {}),
      file,
      size: [0, 1, 2].map((i) => r(max[i] - min[i])),
      center: [0, 1, 2].map((i) => r((max[i] + min[i]) / 2)),
      minY: r(min[1]),
      tris,
      bytes: fs.statSync(path.join(dir, file)).size,
      ...(NOTES[id] ? { note: NOTES[id] } : {}),
    };
    if (verbose) console.log(id.padEnd(30), models[id].size.join(' x ').padEnd(24), String(tris).padStart(7), 'tris', (models[id].bytes / 1e6).toFixed(2), 'MB', 'tex', (texBytes / 1e6).toFixed(2), 'MB', root.listTextures().length);
  } catch (e) {
    bad.push(id);
    console.error('FAILED to read', file, e.message);
  }
}

fs.writeFileSync(manifestPath, JSON.stringify({
  _info: 'Poly Haven CC0 models at 1k, optimised (webp textures, simplified to ~12k tris where dense, KHR_mesh_quantization except skinned). Real-world metres. Front faces +Z; origin at the base unless noted. size/center = bounding box as exported. Regenerate: python3 tools/assets/fetch_models.py && node tools/assets/model_manifest.mjs',
  models,
}, null, 2));
const total = Object.values(models).reduce((s, m) => s + m.bytes, 0);
console.log(`${Object.keys(models).length} models, ${(total / 1e6).toFixed(1)} MB total; unreadable: ${bad.join(', ') || 'none'}`);
