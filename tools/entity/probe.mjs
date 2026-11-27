// Headless probe: builds every pose and reports extents + hair sanity. node tools/entity/probe.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createEntityModel } from '../../src/game/entityModel.js';
const buf = fs.readFileSync(new URL('../../public/assets/entity/lodger.glb', import.meta.url));
const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const m = await createEntityModel(loader, { gltf });
const v = new THREE.Vector3();
for (const p of m.poses) {
  m.setPose(p);
  for (let i = 0; i < 120; i++) m.update(1 / 60, i / 60, false);
  const box = new THREE.Box3();
  const pos = m.mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 3) { m.mesh.getVertexPosition(i, v); v.applyMatrix4(m.mesh.matrixWorld); box.expandByPoint(v); }
  let up = 0, maxRise = 0;
  for (const s of m.hairStrands || []) { for (let i = 2; i < s.N; i++) { const rise = s.pos[i * 3 + 1] - s.pos[1]; if (rise > 0.03) { up++; maxRise = Math.max(maxRise, rise); break; } } }
  const f = m.faceAnchor.getWorldPosition(new THREE.Vector3());
  console.log(p.padEnd(11), 'min', box.min.toArray().map((x) => x.toFixed(2)).join(','), ' max', box.max.toArray().map((x) => x.toFixed(2)).join(','), ' face', f.toArray().map((x) => x.toFixed(2)).join(','), ' hairUp', up, maxRise.toFixed(2));
}
