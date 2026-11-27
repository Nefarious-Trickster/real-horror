// Creature preview: dark room, one warm flashlight-like spotlight near the camera.
// URL params: pose=<name>|cycle, cam=full|face|close|side|top|low, amb=<float>, jaw=<0..1>, seen=1, t=<seconds of idle sim>
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createEntityModel } from '../../src/game/entityModel.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1280), Hh = +(q.get('h') || 720);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, Hh); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = +(q.get('exp') || 1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.08);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.75 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b3a34, roughness: 0.9 });
const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.8), wallMat); back.position.set(0, 1.4, -1.6); back.receiveShadow = true; scene.add(back);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), wallMat); ceil.rotation.x = Math.PI / 2; ceil.position.y = 2.8; ceil.receiveShadow = true; scene.add(ceil);
const pose = q.get('pose') || 'stand';
if (pose.startsWith('peek')) { // a wall with a door edge at x=0, z in [0,0.14]
  const s = pose === 'peek_left' ? 1 : -1;
  const w = new THREE.Mesh(new THREE.BoxGeometry(2, 2.8, 0.14), wallMat); w.position.set(-s * 1.0, 1.4, 0.07); w.castShadow = w.receiveShadow = true; scene.add(w);
}
scene.add(new THREE.HemisphereLight(0x8899aa, 0x221811, +(q.get('amb') || 0.015)));

const cams = {
  full: [[0.25, 1.55, 3.4], [0, 1.15, 0]], face: [[0.05, 2.0, 0.55], [0, 1.95, 0]], close: [[0.1, 1.9, 1.3], [0, 1.6, 0]],
  side: [[3.2, 1.4, 0.2], [0, 1.1, 0]], top: [[0.4, 1.4, 3.0], [0, 2.3, 0]], low: [[0.3, 0.9, 2.6], [0, 0.6, 0]], back: [[-0.6, 1.5, -2.8], [0, 1.2, 0]], q3: [[2.2, 1.6, 2.4], [0, 1.2, 0]], torso: [[0.4, 1.6, 1.3], [0, 1.5, 0]], face2: [[0.25, 2.1, 0.9], [0, 2.0, 0.2]], headside: [[1.1, 2.05, 0.3], [0, 2.0, 0.1]], above: [[1.2, 2.2, 1.6], [0, 0.1, 0]], headback: [[0.5, 2.2, -1.0], [0, 2.0, 0.0]],
  peek: [[1.3, 1.65, 2.6], [0, 1.6, 0]], peekR: [[-1.3, 1.65, 2.6], [0, 1.6, 0]],
};
const [cp, ct] = cams[q.get('cam') || 'full'] || cams.full;
const camera = new THREE.PerspectiveCamera(+(q.get('fov') || 55), W / Hh, 0.05, 50);
camera.position.set(...cp); camera.lookAt(...ct);
const spot = new THREE.SpotLight(0xffd6a0, +(q.get('li') || 40), 18, 0.42, 0.55, 2);
spot.position.copy(camera.position).add(new THREE.Vector3(0.18, -0.15, 0));
spot.target.position.set(...ct); scene.add(spot.target);
spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.015; spot.shadow.camera.near = 0.05;
scene.add(spot);

const model = await createEntityModel(new GLTFLoader());
scene.add(model.object);
if (q.get('nohair') === '1') model.object.getObjectByName('LodgerHair').visible = false;
const info = document.getElementById('info');
function anchorCam() { // frame the face like the jumpscare camera would
  if (q.get('cam') !== 'anchor') return;
  model.object.updateMatrixWorld(true);
  const f = model.faceAnchor.getWorldPosition(new THREE.Vector3());
  const d = +(q.get('dist') || 0.4);
  camera.position.set(f.x + 0.03, f.y + 0.02, f.z + d); camera.lookAt(f);
  spot.position.copy(camera.position).add(new THREE.Vector3(0.08, -0.12, 0.05)); spot.target.position.copy(f);
}
let names = pose === 'cycle' ? model.poses : [pose];
let pi = 0;
function show(n) { model.setPose(n); if (q.get('jaw')) model.setJaw(+q.get('jaw')); info.textContent = n; }
show(names[0]); anchorCam();
const seen = q.get('seen') === '1';
const simT = +(q.get('t') || 0);
for (let i = 0; i < simT * 60; i++) model.update(1 / 60, i / 60, seen);
if (q.get('jaw')) model.setJaw(+q.get('jaw'));
const clock = new THREE.Clock(); let last = 0;
function frame() {
  const t = clock.getElapsedTime();
  if (pose === 'cycle' && t - last > 2.5) { last = t; pi = (pi + 1) % names.length; show(names[pi]); }
  if (q.get('anim') === '1') model.update(clock.getDelta ? 1 / 60 : 0, t, seen);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
renderer.render(scene, camera); window.__ready = true;
frame();
