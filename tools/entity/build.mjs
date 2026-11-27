// Build script for "the Lodger" — VIGIL's creature.
//
//   node tools/entity/build.mjs            -> public/assets/entity/lodger.glb
//
// Pipeline: skeleton (joint positions) -> body authored as a signed distance field
// (smooth unions of round cones / ellipsoids / spheres, smooth subtractions for the
// eye sockets, mouth, cheeks) -> narrow-band sampled on a 3 mm grid -> naive surface
// nets -> Newton projection onto the exact SDF -> meshoptimizer decimation ->
// per-vertex skin weights from primitive proximity (+ explicit head/jaw split) ->
// baked vertex colour (mottling, veins, cavity AO, dirt, necrotic extremities) and
// roughness -> teeth and claws as separate crisp meshes -> GLB (plain glTF 2.0, no
// extensions required).
//
// All authoring is done in "design units" for a ~2.4 m tall rest (A-)pose; the
// final model is uniformly scaled by S at export.

import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../public/assets/entity/lodger.glb');

const INFLATE = 0.002; // uniform skin thickness over everything
const S = 1.05;           // export scale (the rest pose is already authored at full size)
const H = 0.003;         // voxel size (m)
const BS = 8;            // block size in voxels (narrow band granularity)
const TARGET_TRIS = 72000;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ------------------------------------------------------------------ math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rad = (d) => (d * Math.PI) / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(1337);
const rr = (a, b) => a + (b - a) * R();

// 3D gradient noise (Perlin) for colour baking
const perm = new Uint8Array(512); { const p = [...Array(256).keys()]; const r = rng(99); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
function noise(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return mix(mix(mix(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u), mix(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
    mix(mix(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u), mix(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}
function fbm(x, y, z, oct = 4) { let a = 0, f = 1, s = 0.5; for (let i = 0; i < oct; i++) { a += s * noise(x * f, y * f, z * f); f *= 2.03; s *= 0.5; } return a; }

// ------------------------------------------------------------------ skeleton
const bones = []; const B = {};
function bone(name, parent, pos) { const b = { name, parent, pos, idx: bones.length }; bones.push(b); B[name] = b; return b; }

bone('Hips', null, [0, 1.16, -0.01]);
bone('Spine', 'Hips', [0, 1.30, -0.025]);
bone('Spine1', 'Spine', [0, 1.45, -0.035]);
bone('Spine2', 'Spine1', [0, 1.62, -0.04]);
bone('Neck', 'Spine2', [0, 1.82, -0.035]);
bone('Neck1', 'Neck', [0, 1.95, -0.02]);
bone('Head', 'Neck1', [0, 2.08, -0.01]);
bone('Jaw', 'Head', [0, 2.14, 0.0]);

const ARM_ANGLE = rad(22);
const FINGERS = {
  Index: { o: 0.021, spread: 0.10, back: 0.004, L: [0.062, 0.05, 0.042, 0.034] },
  Middle: { o: 0.007, spread: 0.03, back: 0.0, L: [0.068, 0.055, 0.045, 0.036] },
  Ring: { o: -0.007, spread: -0.045, back: 0.003, L: [0.064, 0.052, 0.043, 0.034] },
  Pinky: { o: -0.020, spread: -0.13, back: 0.013, L: [0.052, 0.042, 0.035, 0.028] },
};
const FR = [0.0078, 0.0070, 0.0062, 0.0054, 0.0045]; // finger radii at joints 1..4 and tip
const arm = {}; // per side geometry info for primitives
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const P = side + '_';
  const dA = nrm([s * Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), -0.03]);
  const w = [0, 0, 1];
  const n = mul(cross(dA, w), s); // palm normal, facing medially
  const UA = [s * 0.20, 1.77, -0.015];
  const FA = add(add(UA, mul(dA, 0.43)), [0, 0, -0.008]);
  const HA = add(FA, mul(dA, 0.44));
  bone(P + 'Clavicle', 'Spine2', [s * 0.025, 1.77, 0.02]);
  bone(P + 'UpperArm', P + 'Clavicle', UA);
  bone(P + 'Forearm', P + 'UpperArm', FA);
  bone(P + 'Hand', P + 'Forearm', HA);
  const K = add(HA, mul(dA, 0.10));
  const fingers = {};
  for (const [fname, f] of Object.entries(FINGERS)) {
    const df = nrm(add(dA, mul(w, f.spread)));
    let j = add(add(K, mul(w, f.o)), mul(dA, -f.back));
    const joints = [j];
    for (let i = 0; i < 4; i++) {
      bone(P + fname + (i + 1), i === 0 ? P + 'Hand' : P + fname + i, j);
      j = add(j, mul(df, f.L[i]));
      joints.push(j);
    }
    fingers[fname] = { joints, df };
  }
  // thumb (3 segments), on the +Z (forward) side of the palm
  {
    const dt = nrm(add(add(mul(dA, 0.72), mul(w, 0.58)), mul(n, 0.28)));
    let j = add(add(add(HA, mul(dA, 0.028)), mul(w, 0.021)), mul(n, 0.008));
    const joints = [j]; const L = [0.05, 0.04, 0.033];
    for (let i = 0; i < 3; i++) {
      bone(P + 'Thumb' + (i + 1), i === 0 ? P + 'Hand' : P + 'Thumb' + i, j);
      j = add(j, mul(dt, L[i]));
      joints.push(j);
    }
    fingers.Thumb = { joints, df: dt };
  }
  arm[side] = { s, dA, w, n, UA, FA, HA, K, fingers };
}
const leg = {};
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const P = side + '_';
  const hip = [s * 0.088, 1.12, 0.0], knee = [s * 0.095, 0.625, 0.018], ankle = [s * 0.10, 0.088, -0.02], ball = [s * 0.112, 0.022, 0.135];
  bone(P + 'Thigh', 'Hips', hip);
  bone(P + 'Shin', P + 'Thigh', knee);
  bone(P + 'Foot', P + 'Shin', ankle);
  bone(P + 'Toe', P + 'Foot', ball);
  leg[side] = { s, hip, knee, ankle, ball };
}

// ------------------------------------------------------------------ primitives
// type 0 sphere, 1 round cone, 2 ellipsoid
const prims = [];
const boneW = (name) => { if (!B[name]) throw new Error('no bone ' + name); return [[B[name].idx, 1]]; };
function ygrad(list) { // [[y, bone], ...] ascending
  const L = list.map(([y, n]) => [y, B[n].idx]);
  return (p) => {
    const y = p[1];
    if (y <= L[0][0]) return [[L[0][1], 1]];
    for (let i = 0; i < L.length - 1; i++) if (y <= L[i + 1][0]) { const t = (y - L[i][0]) / (L[i + 1][0] - L[i][0]); return [[L[i][1], 1 - t], [L[i + 1][1], t]]; }
    return [[L[L.length - 1][1], 1]];
  };
}
function mkBone(b) { return typeof b === 'function' ? b : typeof b === 'string' ? (() => { const w = boneW(b); return () => w; })() : (() => b); }
function pushPrim(p, o) {
  p.op = o.op || 'add'; p.k = o.k ?? 0.01; p.tag = o.tag || 'skin'; p.bw = mkBone(o.bone); p.id = prims.length; prims.push(p); return p;
}
function sph(c, r, o) { return pushPrim({ type: 0, c, r, aabb: [sub(c, [r, r, r]), add(c, [r, r, r])] }, o); }
function cone(a, b, r1, r2, o) {
  const ba = sub(b, a), l2 = dot(ba, ba), rd = r1 - r2;
  const mn = [Math.min(a[0] - r1, b[0] - r2), Math.min(a[1] - r1, b[1] - r2), Math.min(a[2] - r1, b[2] - r2)];
  const mx = [Math.max(a[0] + r1, b[0] + r2), Math.max(a[1] + r1, b[1] + r2), Math.max(a[2] + r1, b[2] + r2)];
  return pushPrim({ type: 1, a, b, ba, l2, rd, a2: l2 - rd * rd, il2: 1 / l2, r1, r2, aabb: [mn, mx] }, o);
}
function chain(pts, radii, o) { for (let i = 0; i < pts.length - 1; i++) cone(pts[i], pts[i + 1], radii[i], radii[i + 1], o); }
// ellipsoid with local axes ax (columns: unit vectors for local x,y,z)
function ell(c, r, o = {}, axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
  const m = Math.max(r[0], r[1], r[2]);
  return pushPrim({ type: 2, c, r, ax: axes, aabb: [sub(c, [m, m, m]), add(c, [m, m, m])] }, o);
}
function rotAxes(yaw = 0, pitch = 0, roll = 0) { // returns axes after YXZ euler (deg)
  const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw)), cx = Math.cos(rad(pitch)), sx = Math.sin(rad(pitch)), cz = Math.cos(rad(roll)), sz = Math.sin(rad(roll));
  // M = Ry * Rx * Rz ; columns are local axes in world
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]], Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mm = (A, Bm) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * Bm[0][j] + row[1] * Bm[1][j] + row[2] * Bm[2][j]));
  const M = mm(mm(Ry, Rx), Rz);
  return [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
}

function primDist(p, x, y, z) {
  switch (p.type) {
    case 0: { const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r; }
    case 1: { // iq round cone
      const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
      const ba = p.ba, l2 = p.l2;
      const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
      const zz = yy - l2;
      const xx0 = pax * l2 - ba[0] * yy, xx1 = pay * l2 - ba[1] * yy, xx2 = paz * l2 - ba[2] * yy;
      const x2 = xx0 * xx0 + xx1 * xx1 + xx2 * xx2;
      const y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = Math.sign(p.rd) * p.rd * p.rd * x2;
      if (Math.sign(zz) * p.a2 * z2 > k) return Math.sqrt(x2 + z2) * p.il2 - p.r2;
      if (Math.sign(yy) * p.a2 * y2 < k) return Math.sqrt(x2 + y2) * p.il2 - p.r1;
      return (Math.sqrt(x2 * p.a2 * p.il2) + yy * p.rd) * p.il2 - p.r1;
    }
    case 2: {
      const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], a = p.ax, r = p.r;
      const lx = (dx * a[0][0] + dy * a[0][1] + dz * a[0][2]) / r[0];
      const ly = (dx * a[1][0] + dy * a[1][1] + dz * a[1][2]) / r[1];
      const lz = (dx * a[2][0] + dy * a[2][1] + dz * a[2][2]) / r[2];
      const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const k1 = Math.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2);
      return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
    }
  }
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ================================================================== BODY
const spineY = ygrad([[1.16, 'Hips'], [1.30, 'Spine'], [1.45, 'Spine1'], [1.62, 'Spine2'], [1.82, 'Neck'], [1.95, 'Neck1'], [2.08, 'Head']]);

// --- pelvis & abdomen
ell([0, 1.15, -0.012], [0.112, 0.08, 0.072], { k: 0.04, bone: 'Hips' });
ell([0, 1.29, -0.016], [0.092, 0.135, 0.058], { k: 0.06, bone: spineY }); // sunken belly
ell([0, 1.33, -0.05], [0.07, 0.12, 0.038], { k: 0.03, bone: spineY });  // lumbar muscle
for (const s of [1, -1]) {
  chain([[s * 0.05, 1.20, -0.06], [s * 0.098, 1.215, -0.012], [s * 0.084, 1.195, 0.04]], [0.010, 0.011, 0.009], { k: 0.035, bone: 'Hips' }); // iliac crest
  ell([s * 0.06, 1.085, -0.058], [0.058, 0.068, 0.043], { k: 0.03, bone: ygrad([[1.04, s > 0 ? 'L_Thigh' : 'R_Thigh'], [1.14, 'Hips']]) }); // wasted buttock
}

// --- rib cage: core + individual ribs
ell([0, 1.615, -0.003], [0.121, 0.21, 0.087], { k: 0.02, bone: ygrad([[1.45, 'Spine1'], [1.68, 'Spine2']]) });
ell([0, 1.49, -0.008], [0.108, 0.105, 0.074], { k: 0.03, bone: ygrad([[1.40, 'Spine'], [1.55, 'Spine1']]) });
const ribW = [0.072, 0.096, 0.112, 0.122, 0.128, 0.130, 0.128, 0.122, 0.112, 0.100];
for (let i = 0; i < 10; i++) {
  const yv = 1.775 - i * 0.036;
  const W = ribW[i], D = 0.092 - (i > 6 ? (i - 6) * 0.004 : 0);
  const drop = 0.055 + 0.006 * i;
  const th1 = i < 7 ? Math.PI - 0.32 - i * 0.02 : [2.25, 1.95, 1.62][i - 7];
  for (const s of [1, -1]) {
    const pts = [], radii = [];
    const N = 9;
    for (let k = 0; k <= N; k++) {
      const th = 0.28 + (th1 - 0.28) * (k / N);
      pts.push([s * W * Math.sin(th), yv - drop * (1 - Math.cos(th)) * 0.5, -D * Math.cos(th) - 0.004]);
      const cart = i < 7 && k / N > 0.78; // costal cartilage is thinner
      radii.push(cart ? 0.0058 : 0.0078);
    }
    chain(pts, radii, { k: 0.042, bone: ygrad([[1.50, 'Spine1'], [1.70, 'Spine2']]) });
  }
}
ell([0, 1.735, 0.035], [0.095, 0.06, 0.055], { k: 0.045, bone: 'Spine2' }); // upper chest fill
cone([0, 1.765, 0.078], [0, 1.53, 0.088], 0.011, 0.008, { k: 0.02, bone: ygrad([[1.50, 'Spine1'], [1.70, 'Spine2']]) }); // sternum
// spine knobs
for (let y = 1.09; y < 2.06; y += 0.0265) {
  let z, r;
  if (y < 1.42) { z = -0.068 + (y - 1.09) * -0.06; r = 0.012; } else if (y < 1.83) { const t = (y - 1.42) / 0.41; z = -0.088 - Math.sin(t * Math.PI) * 0.012; r = 0.0105; } else { const t = (y - 1.83) / 0.23; z = mix(-0.078, -0.045, t); r = 0.0095; }
  if (Math.abs(y - 1.835) < 0.014) r = 0.014; // C7 prominens
  sph([0, y, z], r, { k: 0.014, bone: spineY });
}

// --- shoulder girdle
for (const side of ['L', 'R']) {
  const { s } = arm[side]; const P = side + '_';
  const clavW = ygrad([[1.6, 'Spine2'], [1.8, P + 'Clavicle']]);
  chain([[s * 0.018, 1.775, 0.083], [s * 0.095, 1.792, 0.068], [s * 0.19, 1.793, 0.0]], [0.008, 0.0085, 0.009], { k: 0.024, bone: P + 'Clavicle' }); // clavicle
  // scapula — winged, inferior angle sticks out
  ell([s * 0.088, 1.655, -0.095], [0.052, 0.074, 0.011], { k: 0.018, bone: P + 'Clavicle' }, rotAxes(s * -24, -8, s * -10));
  chain([[s * 0.04, 1.712, -0.106], [s * 0.12, 1.74, -0.09], [s * 0.185, 1.785, -0.035]], [0.006, 0.0075, 0.008], { k: 0.012, bone: P + 'Clavicle' }); // spine of scapula
  cone([s * 0.07, 1.70, 0.025], [s * 0.185, 1.745, -0.005], 0.042, 0.033, { k: 0.04, bone: ygrad([[1.66, 'Spine2'], [1.76, P + 'Clavicle']]) }); // pectoral / front shoulder
  cone([s * 0.075, 1.61, -0.065], [s * 0.18, 1.725, -0.035], 0.036, 0.03, { k: 0.04, bone: ygrad([[1.62, 'Spine2'], [1.74, P + 'Clavicle']]) }); // lat / back of armpit
  cone([s * 0.03, 1.875, -0.035], [s * 0.17, 1.785, -0.03], 0.026, 0.016, { k: 0.035, bone: ygrad([[1.78, P + 'Clavicle'], [1.86, 'Neck']]) }); // trapezius
  void clavW;
}

// --- neck (too long)
const neckW = ygrad([[1.80, 'Spine2'], [1.86, 'Neck'], [1.97, 'Neck1'], [2.09, 'Head']]);
cone([0, 1.80, -0.016], [0, 2.085, -0.006], 0.046, 0.032, { k: 0.03, bone: neckW });
cone([0, 1.82, -0.042], [0, 2.09, -0.026], 0.022, 0.02, { k: 0.02, bone: neckW });
for (const s of [1, -1]) cone([s * 0.046, 2.10, -0.02], [s * 0.017, 1.79, 0.066], 0.0085, 0.0078, { k: 0.026, bone: neckW }); // SCM cords
ell([0, 1.975, 0.03], [0.0135, 0.02, 0.012], { k: 0.012, bone: neckW }); // larynx
cone([0, 1.952, 0.027], [0, 1.80, 0.042], 0.0105, 0.0105, { k: 0.012, bone: neckW }); // trachea

// --- head (small, long gaunt face)
const headJaw = 'Head';
ell([0, 2.205, -0.026], [0.067, 0.087, 0.088], { k: 0.02, bone: headJaw }); // cranium
ell([0, 2.168, -0.058], [0.055, 0.058, 0.047], { k: 0.02, bone: headJaw }); // occiput
cone([-0.042, 2.212, 0.062], [0.042, 2.212, 0.062], 0.0095, 0.0095, { k: 0.032, bone: headJaw }); // brow ridge
ell([0, 2.142, 0.049], [0.043, 0.046, 0.040], { k: 0.02, bone: headJaw }); // maxilla / mid face
for (const s of [1, -1]) {
  cone([s * 0.035, 2.172, 0.064], [s * 0.063, 2.166, 0.012], 0.0102, 0.0088, { k: 0.012, bone: headJaw }); // zygoma
  ell([s * 0.069, 2.17, -0.016], [0.0062, 0.021, 0.012], { k: 0.008, bone: headJaw }, rotAxes(s * 15, 0, s * -8)); // shrivelled ear
}
cone([0, 2.198, 0.079], [0, 2.159, 0.093], 0.0062, 0.0078, { k: 0.008, bone: headJaw }); // nasal ridge
ell([0, 2.155, 0.093], [0.0105, 0.0085, 0.0085], { k: 0.008, bone: headJaw }); // collapsed tip
// mandible (Jaw)
for (const s of [1, -1]) {
  chain([[s * 0.058, 2.147, -0.006], [s * 0.054, 2.072, 0.006], [s * 0.029, 2.052, 0.058], [0, 2.048, 0.07]], [0.0098, 0.0104, 0.0108, 0.0115], { k: 0.012, bone: 'Jaw' });
}
sph([0, 2.05, 0.069], 0.0118, { k: 0.01, bone: 'Jaw' }); // chin point
ell([0, 2.086, 0.040], [0.040, 0.030, 0.037], { k: 0.02, bone: 'Jaw' }); // lower face

// --- subtractions (carved)
for (const s of [1, -1]) {
  const dn = s < 0 ? 0.0025 : 0; const big = s < 0 ? 1.08 : 1; // asymmetric: its left eye sits lower and larger
  ell([s * 0.028, 2.186 - dn, 0.083], [0.0172 * big, 0.0215 * big, 0.02], { op: 'sub', k: 0.009, tag: 'socket', bone: headJaw }, rotAxes(0, 0, s * -14));
  sph([s * 0.027, 2.183 - dn, 0.063], 0.0152 * big, { op: 'sub', k: 0.006, tag: 'socket', bone: headJaw });
  sph([s * 0.053, 2.124, 0.071], 0.019, { op: 'sub', k: 0.02, tag: 'skin', bone: headJaw }); // hollow cheeks
  sph([s * 0.077, 2.21, 0.03], 0.019, { op: 'sub', k: 0.02, tag: 'skin', bone: headJaw }); // temples
  ell([s * 0.0062, 2.149, 0.097], [0.0032, 0.0048, 0.008], { op: 'sub', k: 0.002, tag: 'cavity', bone: headJaw }, rotAxes(0, 0, s * 18)); // nostril slits
}
ell([0, 2.105, 0.056], [0.052, 0.0055, 0.046], { op: 'sub', k: 0.004, tag: 'mouth', bone: headJaw }); // mouth slit, too wide
ell([0, 2.10, 0.034], [0.034, 0.016, 0.034], { op: 'sub', k: 0.006, tag: 'mouth', bone: headJaw }); // oral cavity
ell([0, 2.09, -0.004], [0.02, 0.024, 0.02], { op: 'sub', k: 0.006, tag: 'mouth', bone: headJaw }); // throat

// --- arms
for (const side of ['L', 'R']) {
  const { s, dA, w, n, UA, FA, HA, fingers } = arm[side]; const P = side + '_';
  const back = [0, 0, -1];
  sph(UA, 0.034, { k: 0.03, bone: ygrad([[1.70, P + 'UpperArm'], [1.79, P + 'Clavicle']]) });
  ell(add(UA, [s * 0.012, -0.035, 0]), [0.03, 0.058, 0.034], { k: 0.03, bone: P + 'UpperArm' }, [nrm(cross([0, 0, 1], dA)), dA, [0, 0, 1]].map((v) => v)); // deltoid
  cone(UA, FA, 0.034, 0.024, { k: 0.026, bone: P + 'UpperArm' });
  sph(add(FA, mul(back, 0.012)), 0.018, { k: 0.02, bone: P + 'Forearm' }); // olecranon
  sph(add(FA, mul(n, -0.018)), 0.0135, { k: 0.01, bone: P + 'UpperArm' }); // lateral epicondyle
  sph(add(FA, mul(n, 0.016)), 0.0125, { k: 0.01, bone: P + 'UpperArm' }); // medial epicondyle
  cone(add(FA, mul(dA, 0.02)), HA, 0.027, 0.016, { k: 0.02, bone: P + 'Forearm' });
  cone(add(add(FA, mul(back, 0.01)), mul(dA, 0.03)), add(HA, mul(back, 0.006)), 0.015, 0.0105, { k: 0.01, bone: P + 'Forearm' }); // ulna ridge
  sph(add(add(HA, mul(back, 0.009)), mul(n, -0.006)), 0.0108, { k: 0.008, bone: P + 'Forearm' }); // ulna head
  // palm
  ell(add(HA, mul(dA, 0.052)), [0.054, 0.031, 0.0105], { k: 0.012, bone: P + 'Hand' }, [dA, w, n]);
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const j0 = fingers[f].joints[0];
    cone(add(add(HA, mul(dA, 0.012)), mul(w, FINGERS[f].o * 0.55)), j0, 0.006, 0.0075, { k: 0.006, bone: P + 'Hand' }); // metacarpal ridge
    const J = fingers[f].joints;
    for (let i = 0; i < 4; i++) {
      cone(J[i], J[i + 1], FR[i], FR[i + 1], { k: 0.004, bone: P + f + (i + 1) });
      sph(J[i], FR[i] + 0.0022, { k: 0.004, bone: i === 0 ? P + 'Hand' : P + f + i }); // bony knuckle
    }
  }
  { // thumb
    const J = fingers.Thumb.joints; const TR = [0.0105, 0.0092, 0.0078, 0.0062];
    ell(add(add(HA, mul(dA, 0.03)), mul(w, 0.016)), [0.026, 0.014, 0.009], { k: 0.012, bone: P + 'Thumb1' }, [nrm(fingers.Thumb.df), nrm(cross(n, fingers.Thumb.df)), n]); // thenar (wasted)
    for (let i = 0; i < 3; i++) { cone(J[i], J[i + 1], TR[i], TR[i + 1], { k: 0.004, bone: P + 'Thumb' + (i + 1) }); if (i) sph(J[i], TR[i] + 0.002, { k: 0.004, bone: P + 'Thumb' + i }); }
  }
}

// --- legs
for (const side of ['L', 'R']) {
  const { s, hip, knee, ankle, ball } = leg[side]; const P = side + '_';
  cone(hip, knee, 0.064, 0.039, { k: 0.035, bone: ygrad([[0.9, P + 'Thigh'], [1.13, P + 'Thigh']]) });
  sph([s * 0.123, 1.09, -0.004], 0.021, { k: 0.02, bone: P + 'Thigh' }); // greater trochanter
  sph(add(knee, [s * 0.022, 0.016, -0.002]), 0.027, { k: 0.026, bone: P + 'Thigh' }); // condyles
  sph(add(knee, [s * -0.019, 0.016, -0.002]), 0.026, { k: 0.026, bone: P + 'Thigh' });
  ell(add(knee, [0, 0.008, 0.033]), [0.021, 0.025, 0.012], { k: 0.012, bone: P + 'Shin' }); // patella
  sph(add(knee, [s * 0.018, -0.03, 0.006]), 0.024, { k: 0.024, bone: P + 'Shin' });
  sph(add(knee, [s * -0.018, -0.03, 0.006]), 0.024, { k: 0.024, bone: P + 'Shin' });
  cone(add(knee, [0, -0.03, 0]), ankle, 0.029, 0.018, { k: 0.02, bone: P + 'Shin' });
  cone(add(knee, [0, -0.05, 0.02]), add(ankle, [s * -0.005, 0.05, 0.012]), 0.012, 0.008, { k: 0.01, bone: P + 'Shin' }); // tibial crest
  ell(add(knee, [s * 0.004, -0.15, -0.03]), [0.036, 0.11, 0.034], { k: 0.03, bone: P + 'Shin' }); // calf, wasted
  sph(add(ankle, [s * 0.022, -0.004, -0.004]), 0.0135, { k: 0.008, bone: P + 'Shin' }); // malleoli
  sph(add(ankle, [s * -0.018, 0.004, 0.0]), 0.0128, { k: 0.008, bone: P + 'Shin' });
  cone(add(ankle, [0, 0.07, -0.026]), [s * 0.10, 0.04, -0.06], 0.0085, 0.009, { k: 0.01, bone: P + 'Foot' }); // achilles
  sph([s * 0.10, 0.032, -0.052], 0.029, { k: 0.016, bone: P + 'Foot' }); // heel
  const fd = nrm(sub(ball, [s * 0.10, 0.03, -0.05]));
  ell([s * 0.106, 0.035, 0.045], [0.095, 0.021, 0.036], { k: 0.02, bone: P + 'Foot' }, [fd, [0, 1, 0], nrm(cross(fd, [0, 1, 0]))]);
  const toeOff = [-0.027, -0.011, 0.002, 0.014, 0.025], toeL = [0.06, 0.056, 0.05, 0.045, 0.038], toeR = [0.0105, 0.0078, 0.0074, 0.007, 0.0066];
  for (let t = 0; t < 5; t++) {
    const base = add(ball, [s * toeOff[t], 0.002, -0.012 * Math.abs(toeOff[t]) / 0.027]);
    cone([s * 0.10 + s * toeOff[t] * 0.6, 0.05, 0.0], base, 0.0062, 0.0075, { k: 0.008, bone: P + 'Foot' }); // metatarsal tendon ridge
    const dir = nrm([s * toeOff[t] * 0.5, -0.12, 1]);
    const mid = add(base, mul(dir, toeL[t] * 0.55));
    const tip = add(add(base, mul(dir, toeL[t])), [0, -0.004, 0]);
    cone(base, mid, toeR[t] + 0.001, toeR[t], { k: 0.005, bone: P + 'Toe' });
    sph(mid, toeR[t] + 0.0015, { k: 0.004, bone: P + 'Toe' });
    cone(mid, tip, toeR[t], toeR[t] * 0.78, { k: 0.004, bone: P + 'Toe' });
  }
}
log(`${prims.length} primitives, ${bones.length} bones`);

// ------------------------------------------------------------------ narrow band grid
const PAD = 0.03;
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (const p of prims) if (p.op === 'add') for (let a = 0; a < 3; a++) { bmin[a] = Math.min(bmin[a], p.aabb[0][a]); bmax[a] = Math.max(bmax[a], p.aabb[1][a]); }
for (let a = 0; a < 3; a++) { bmin[a] -= PAD; bmax[a] += PAD; }
const nbx = Math.ceil((bmax[0] - bmin[0]) / (H * BS)), nby = Math.ceil((bmax[1] - bmin[1]) / (H * BS)), nbz = Math.ceil((bmax[2] - bmin[2]) / (H * BS));
const nx = nbx * BS + 1, ny = nby * BS + 1, nz = nbz * BS + 1;
log(`grid ${nx}x${ny}x${nz} = ${(nx * ny * nz / 1e6).toFixed(1)}M voxels, ${nbx * nby * nbz} blocks`);

const MARGIN = 0.05;
const blockLists = new Array(nbx * nby * nbz);
for (let i = 0; i < blockLists.length; i++) blockLists[i] = null;
const BW = H * BS;
for (const p of prims) {
  const m = MARGIN + p.k;
  const i0 = Math.max(0, Math.floor((p.aabb[0][0] - m - bmin[0]) / BW)), i1 = Math.min(nbx - 1, Math.floor((p.aabb[1][0] + m - bmin[0]) / BW));
  const j0 = Math.max(0, Math.floor((p.aabb[0][1] - m - bmin[1]) / BW)), j1 = Math.min(nby - 1, Math.floor((p.aabb[1][1] + m - bmin[1]) / BW));
  const k0 = Math.max(0, Math.floor((p.aabb[0][2] - m - bmin[2]) / BW)), k1 = Math.min(nbz - 1, Math.floor((p.aabb[1][2] + m - bmin[2]) / BW));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const bi = i + nbx * (j + nby * k);
    let L = blockLists[bi]; if (!L) L = blockLists[bi] = { add: [], sub: [] };
    (p.op === 'sub' ? L.sub : L.add).push(p);
  }
}
const EMPTY = { add: [], sub: [] };
function listAt(x, y, z) {
  const i = Math.floor((x - bmin[0]) / BW), j = Math.floor((y - bmin[1]) / BW), k = Math.floor((z - bmin[2]) / BW);
  if (i < 0 || j < 0 || k < 0 || i >= nbx || j >= nby || k >= nbz) return EMPTY;
  return blockLists[i + nbx * (j + nby * k)] || EMPTY;
}
function sdfL(L, x, y, z) {
  let d = 1e9;
  const A = L.add; for (let i = 0; i < A.length; i++) { const p = A[i]; const di = primDist(p, x, y, z); d = smin(d, di, p.k); }
  d -= INFLATE;
  const Sb = L.sub; for (let i = 0; i < Sb.length; i++) { const p = Sb[i]; const di = -primDist(p, x, y, z); d = -smin(-d, -di, p.k); }
  return d;
}
const sdf = (x, y, z) => sdfL(listAt(x, y, z), x, y, z);

const NV = nx * ny * nz;
const field = new Float32Array(NV).fill(1);
const active = new Uint8Array(nbx * nby * nbz);
const half = BW * 0.5, bandTol = BW * 0.866 * 2.0 + 0.004;
let nActive = 0;
for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
  const L = blockLists[bi + nbx * (bj + nby * bk)];
  const cx = bmin[0] + bi * BW + half, cy = bmin[1] + bj * BW + half, cz = bmin[2] + bk * BW + half;
  if (!L) continue;
  const dc = sdfL(L, cx, cy, cz);
  const ii0 = bi * BS, jj0 = bj * BS, kk0 = bk * BS;
  if (Math.abs(dc) > bandTol) {
    if (dc < 0) for (let k = kk0; k <= kk0 + BS; k++) for (let j = jj0; j <= jj0 + BS; j++) for (let i = ii0; i <= ii0 + BS; i++) field[i + nx * (j + ny * k)] = -1;
    continue;
  }
  active[bi + nbx * (bj + nby * bk)] = 1; nActive++;
  for (let k = kk0; k <= kk0 + BS; k++) { const z = bmin[2] + k * H; for (let j = jj0; j <= jj0 + BS; j++) { const y = bmin[1] + j * H; for (let i = ii0; i <= ii0 + BS; i++) { field[i + nx * (j + ny * k)] = sdfL(L, bmin[0] + i * H, y, z); } } }
}
log(`sampled ${nActive} active blocks`);

// ------------------------------------------------------------------ surface nets
const vid = new Int32Array(NV).fill(-1);
const verts = [];
const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const cv = new Float64Array(8);
for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
  if (!active[bi + nbx * (bj + nby * bk)]) continue;
  for (let k = bk * BS; k < bk * BS + BS; k++) for (let j = bj * BS; j < bj * BS + BS; j++) for (let i = bi * BS; i < bi * BS + BS; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = field[(i + corner[c][0]) + nx * ((j + corner[c][1]) + ny * (k + corner[c][2]))]; cv[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t; sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t; sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t; n++;
    }
    vid[i + nx * (j + ny * k)] = verts.length / 3;
    verts.push(bmin[0] + (i + sx / n) * H, bmin[1] + (j + sy / n) * H, bmin[2] + (k + sz / n) * H);
  }
}
const tris = [];
const D = [1, nx, nx * ny];
for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
  if (!active[bi + nbx * (bj + nby * bk)]) continue;
  for (let k = bk * BS; k < bk * BS + BS; k++) for (let j = bj * BS; j < bj * BS + BS; j++) for (let i = bi * BS; i < bi * BS + BS; i++) {
    const idx = i + nx * (j + ny * k);
    if (vid[idx] < 0) continue;
    const v0 = field[idx];
    const ijk = [i, j, k];
    for (let ax = 0; ax < 3; ax++) {
      const u = (ax + 1) % 3, w = (ax + 2) % 3;
      if (ijk[u] === 0 || ijk[w] === 0) continue;
      const v1 = field[idx + D[ax]];
      if ((v0 < 0) === (v1 < 0)) continue;
      const a = vid[idx], b = vid[idx - D[u]], c = vid[idx - D[u] - D[w]], d = vid[idx - D[w]];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (v0 < 0) tris.push(a, d, c, a, c, b); else tris.push(a, b, c, a, c, d);
    }
  }
}
log(`surface nets: ${verts.length / 3} verts, ${tris.length / 3} tris`);

// Newton projection onto the exact surface + gradient normals
const EPS = 0.0004;
function gradAt(x, y, z) {
  const L = listAt(x, y, z);
  return [sdfL(L, x + EPS, y, z) - sdfL(L, x - EPS, y, z), sdfL(L, x, y + EPS, z) - sdfL(L, x, y - EPS, z), sdfL(L, x, y, z + EPS) - sdfL(L, x, y, z - EPS)].map((g) => g / (2 * EPS));
}
for (let v = 0; v < verts.length; v += 3) {
  for (let it = 0; it < 3; it++) {
    const x = verts[v], y = verts[v + 1], z = verts[v + 2];
    const d = sdf(x, y, z); const g = gradAt(x, y, z); const g2 = dot(g, g);
    if (g2 < 1e-8) break;
    let step = d / g2; const sl = Math.abs(step) * Math.sqrt(g2); if (sl > H * 0.75) step *= (H * 0.75) / sl;
    verts[v] -= g[0] * step; verts[v + 1] -= g[1] * step; verts[v + 2] -= g[2] * step;
  }
}
log('projected');

// ------------------------------------------------------------------ decimate
await MeshoptSimplifier.ready;
const posF = new Float32Array(verts);
let idxU = new Uint32Array(tris);
{
  const [out, err] = MeshoptSimplifier.simplify(idxU, posF, 3, TARGET_TRIS * 3, 0.01, []);
  log(`simplified to ${out.length / 3} tris (err ${err.toExponential(2)})`);
  idxU = out;
}
// compact
const remap = new Int32Array(posF.length / 3).fill(-1);
const P = []; const I = new Uint32Array(idxU.length);
for (let i = 0; i < idxU.length; i++) { const o = idxU[i]; if (remap[o] < 0) { remap[o] = P.length / 3; P.push(posF[o * 3], posF[o * 3 + 1], posF[o * 3 + 2]); } I[i] = remap[o]; }
const nv = P.length / 3;
log(`body mesh ${nv} verts`);

// ------------------------------------------------------------------ attributes
const NRM = new Float32Array(nv * 3);
for (let v = 0; v < nv; v++) { const g = nrm(gradAt(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])); NRM[v * 3] = g[0]; NRM[v * 3 + 1] = g[1]; NRM[v * 3 + 2] = g[2]; }
// winding check against normals
{
  let agree = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const fn = cross(e1, e2);
    agree += Math.sign(dot(fn, [NRM[a * 3], NRM[a * 3 + 1], NRM[a * 3 + 2]]));
  }
  if (agree < 0) { for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; } log('flipped winding'); }
}
// adjacency
const adj = Array.from({ length: nv }, () => new Set());
for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b); }

// skin weights
const NB = bones.length;
const TAU = 0.0075;
let W = new Float32Array(nv * NB);
const tagOf = new Array(nv); const subDepth = new Float32Array(nv); // how deep into a carved cavity
for (let v = 0; v < nv; v++) {
  const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
  const L = listAt(x, y, z);
  let dmin = Infinity; const ds = [];
  for (const p of L.add) { const d = primDist(p, x, y, z); ds.push(d); if (d < dmin) dmin = d; }
  let best = null, bestD = Infinity;
  for (let i = 0; i < L.add.length; i++) {
    const p = L.add[i], d = ds[i];
    if (d < bestD) { bestD = d; best = p; }
    const e = d - dmin; if (e > TAU * 6) continue;
    const wgt = Math.exp(-e / TAU);
    for (const [bi, bw] of p.bw([x, y, z])) W[v * NB + bi] += wgt * bw;
  }
  let tag = best ? best.tag : 'skin';
  // carved surface?
  for (const p of L.sub) { const d = primDist(p, x, y, z); if (Math.abs(d) < 0.0025 && p.tag !== 'skin') { tag = p.tag; if (tag === 'socket') subDepth[v] = 1; } }
  tagOf[v] = tag;
}
// head / jaw split: plane through hinge and mouth slit, blended over a band that widens toward the cheeks
{
  const hi = B.Head.idx, ji = B.Jaw.idx;
  for (let v = 0; v < nv; v++) {
    const sum = W[v * NB + hi] + W[v * NB + ji];
    if (sum <= 1e-6) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    // mouth line: y = 2.1115 at front, rising to hinge (2.14 at z=0)
    const lineY = z > 0.0 ? mix(2.145, 2.105, clamp(z / 0.05, 0, 1)) : 2.145 + (-z) * 0.4;
    const band = z > 0.075 ? 0.0012 : mix(0.012, 0.003, clamp(z / 0.07, 0, 1));
    let jw = 1 - smoothstep(lineY - band, lineY + band, y);
    if (tagOf[v] === 'mouth') jw = y < lineY - 0.002 ? 1 : y > lineY + 0.002 ? 0 : jw;
    // only in front of the neck
    if (z < -0.03 || y < 2.03) jw *= smoothstep(-0.05, -0.03, z) * smoothstep(2.02, 2.05, y);
    W[v * NB + hi] = sum * (1 - jw); W[v * NB + ji] = sum * jw;
  }
}
// smooth weights over the mesh (2 passes) — skip the face so the mouth stays crisp
for (let pass = 0; pass < 2; pass++) {
  const W2 = new Float32Array(W.length);
  for (let v = 0; v < nv; v++) {
    const face = P[v * 3 + 1] > 2.03 && P[v * 3 + 2] > 0.0;
    let tot = 0;
    for (let b = 0; b < NB; b++) tot += W[v * NB + b];
    const own = face ? 1 : 0.5;
    for (let b = 0; b < NB; b++) W2[v * NB + b] = (W[v * NB + b] / (tot || 1)) * own;
    if (!face) { const nn = adj[v].size; for (const u of adj[v]) { let tu = 0; for (let b = 0; b < NB; b++) tu += W[u * NB + b]; for (let b = 0; b < NB; b++) W2[v * NB + b] += ((W[u * NB + b] / (tu || 1)) * 0.5) / nn; } }
  }
  W = W2;
}
const JOINTS = new Uint8Array(nv * 4), WEIGHTS = new Float32Array(nv * 4);
const domBone = new Int32Array(nv);
for (let v = 0; v < nv; v++) {
  const arr = []; for (let b = 0; b < NB; b++) if (W[v * NB + b] > 1e-4) arr.push([b, W[v * NB + b]]);
  arr.sort((a, b) => b[1] - a[1]); const top = arr.slice(0, 4); const tot = top.reduce((s, a) => s + a[1], 0) || 1;
  if (!top.length) top.push([0, 1]);
  domBone[v] = top[0][0];
  for (let i = 0; i < 4; i++) { JOINTS[v * 4 + i] = top[i] ? top[i][0] : 0; WEIGHTS[v * 4 + i] = top[i] ? top[i][1] / tot : 0; }
}
log('weights done');

// ------------------------------------------------------------------ colour bake
const srgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const C = {
  skin: srgb(0x7f898c), skin2: srgb(0x6c7676), bruise: srgb(0x4e3b4d), bile: srgb(0x66705c), vein: srgb(0x2f3a55),
  dirt: srgb(0x2a211c), necro: srgb(0x332826), socket: srgb(0x050303), mouth: srgb(0x1c0606), gum: srgb(0x341818), lip: srgb(0x3e3033), cavity: srgb(0x0c0505),
};
// convexity from mesh
const convex = new Float32Array(nv);
for (let v = 0; v < nv; v++) {
  let c = 0; const n = [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]];
  for (const u of adj[v]) { const d = [P[v * 3] - P[u * 3], P[v * 3 + 1] - P[u * 3 + 1], P[v * 3 + 2] - P[u * 3 + 2]]; const l2 = dot(d, d) || 1e-9; c += dot(n, d) / Math.sqrt(l2); }
  convex[v] = c / (adj[v].size || 1);
}
const COLOR = new Float32Array(nv * 4), UV = new Float32Array(nv * 2);
const boneName = bones.map((b) => b.name);
for (let v = 0; v < nv; v++) {
  const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; const n = [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]];
  // ambient occlusion from the SDF
  let occ = 0, sca = 1;
  for (let i = 1; i <= 5; i++) { const h = 0.004 + 0.009 * i; const d = sdf(x + n[0] * h, y + n[1] * h, z + n[2] * h); occ += (h - Math.min(d, h)) * sca; sca *= 0.8; }
  const ao = clamp(1 - 5.5 * occ, 0, 1);
  const tag = tagOf[v];
  let col, rough = 0.62, sss = 1;
  const bn = boneName[domBone[v]];
  if (tag === 'socket') {
    // fade from a bruised rim into black depth
    const depth = clamp((0.088 - z) / 0.03, 0, 1);
    col = mixc(srgb(0x2b1e20), C.socket, smoothstep(0.1, 0.6, depth)); rough = 0.18; sss = 0;
  } else if (tag === 'mouth') { col = mixc(C.gum, C.mouth, smoothstep(0.075, 0.05, z)); rough = 0.2; sss = 0.2; }
  else if (tag === 'cavity') { col = C.cavity; rough = 0.3; sss = 0; }
  else {
    const m1 = fbm(x * 7, y * 7, z * 7), m2 = fbm(x * 3.1 + 40, y * 3.1, z * 3.1 - 11, 3), m3 = fbm(x * 22, y * 22, z * 22, 2);
    col = mixc(C.skin, C.skin2, smoothstep(-0.2, 0.3, m2));
    col = mixc(col, C.bile, 0.4 * smoothstep(0.05, 0.35, m2));
    col = mixc(col, C.bruise, 0.75 * smoothstep(0.12, 0.42, m1));
    // veins: ridged warped noise, strongest on limbs, neck and temples
    const wx = fbm(x * 4 + 7, y * 4, z * 4, 2) * 0.6;
    const ridge = 1 - Math.abs(noise(x * 16 + wx * 3, y * 9 + wx, z * 16 - wx * 2));
    const veinMask = /Arm|Forearm|Hand|Thigh|Shin|Neck|Head/.test(bn) ? 1 : 0.55;
    col = mixc(col, C.vein, veinMask * 0.75 * smoothstep(0.89, 0.98, ridge));
    col = col.map((c) => c * (0.9 + 0.2 * m3));
    // bony ridges paler, creases dirtier
    const cv2 = clamp(convex[v] * 8, -1, 1);
    col = col.map((c) => c * (1 + 0.22 * Math.max(cv2, 0)));
    col = mixc(col, C.dirt, clamp((1 - ao) * 0.85 + Math.max(-cv2, 0) * 0.25, 0, 0.9));
    // necrotic extremities
    const fm = bn.match(/(Index|Middle|Ring|Pinky|Thumb)(\d)/);
    if (fm) { const seg = +fm[2] / (fm[1] === 'Thumb' ? 3 : 4); col = mixc(col, C.necro, 0.25 + 0.6 * seg); rough = 0.5; }
    if (/Toe/.test(bn)) { col = mixc(col, C.necro, 0.6); }
    if (/Hand/.test(bn)) col = mixc(col, C.necro, 0.18);
    if (/Foot/.test(bn)) col = mixc(col, C.dirt, 0.35 * smoothstep(0.06, 0.0, y));
    // face: bruising round the sockets, dark wet lips
    if (y > 2.03) { // the face is the money shot: blotchier, greyer, veined temples
      const fb = fbm(x * 30 + 3, y * 30, z * 30, 3);
      col = mixc(col, C.bruise, 0.55 * smoothstep(0.0, 0.35, fb));
      col = mixc(col, srgb(0x56605f), 0.35 * smoothstep(-0.2, 0.2, fbm(x * 12, y * 12 + 5, z * 12, 2)));
      const tr = 1 - Math.abs(noise(x * 60 + 2, y * 35, z * 60));
      if (Math.abs(x) > 0.035) col = mixc(col, C.vein, 0.7 * smoothstep(0.9, 0.975, tr));
    }
    if (y > 2.05 && z > 0.03) {
      for (const s of [1, -1]) { const dd = Math.hypot(x - s * 0.028, (y - 2.186) * 0.85, z - 0.083); col = mixc(col, srgb(0x3a2a2e), 0.85 * smoothstep(0.042, 0.02, dd)); if (dd < 0.026) rough = mix(0.25, rough, smoothstep(0.018, 0.026, dd)); }
      const md = Math.abs(y - 2.105) / 0.010 + Math.max(0, Math.abs(x) - 0.04) / 0.02;
      if (z > 0.05 && md < 1.6) { col = mixc(col, C.lip, smoothstep(1.6, 0.4, md)); rough = mix(0.28, rough, smoothstep(0.4, 1.6, md)); }
      for (const s of [1, -1]) { // dark wet streaks running down from the sockets
        const sx = Math.abs(x - s * (0.03 + (2.17 - y) * 0.08)); const n1 = noise(x * 300, y * 40, z * 300);
        if (y < 2.168 && y > 2.08 && z > 0.05) col = mixc(col, srgb(0x1e1416), 0.75 * smoothstep(0.006, 0.0015, sx + n1 * 0.002) * smoothstep(2.08, 2.12, y));
      }
      const nd = Math.hypot(x, (y - 2.149) * 0.8, z - 0.097);
      col = mixc(col, C.cavity, smoothstep(0.014, 0.006, nd) * 0.6);
    }
    col = col.map((c) => c * mix(0.35, 1, ao));
    rough = clamp(rough + 0.12 * m3, 0.15, 0.85);
  }
  COLOR[v * 4] = col[0]; COLOR[v * 4 + 1] = col[1]; COLOR[v * 4 + 2] = col[2]; COLOR[v * 4 + 3] = 1;
  UV[v * 2] = rough; UV[v * 2 + 1] = sss;
}
log('colours baked');

// ------------------------------------------------------------------ teeth and claws (separate crisp geometry)
const extra = { P: [], N: [], C: [], UV: [], J: [], W: [], I: [] };
function icosphere(sub) {
  const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) { const cache = new Map(); const mid = (a, b) => { const key = a < b ? a + '_' + b : b + '_' + a; if (cache.has(key)) return cache.get(key); V.push(nrm(mul(add(V[a], V[b]), 0.5))); cache.set(key, V.length - 1); return V.length - 1; }; const F2 = []; for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } F = F2; }
  return { V, F };
}
const ICO = icosphere(2);
// shape(u) maps a unit sphere point to local space; frame = [x,y,z axes], o = origin
function addBlob(shape, frame, o, boneIdx, colorFn, rough) {
  const base = extra.P.length / 3;
  const pts = ICO.V.map(shape);
  const toW = (q) => add(o, add(add(mul(frame[0], q[0]), mul(frame[1], q[1])), mul(frame[2], q[2])));
  const wp = pts.map(toW);
  const vn = wp.map(() => [0, 0, 0]);
  for (const [a, b, c] of ICO.F) { const fn = cross(sub(wp[b], wp[a]), sub(wp[c], wp[a])); for (const i of [a, b, c]) { vn[i] = add(vn[i], fn); } }
  wp.forEach((p, i) => {
    extra.P.push(...p); extra.N.push(...nrm(vn[i])); const c = colorFn(pts[i], ICO.V[i]); extra.C.push(c[0], c[1], c[2], 1); extra.UV.push(rough, 0);
    extra.J.push(boneIdx, 0, 0, 0); extra.W.push(1, 0, 0, 0);
  });
  for (const [a, b, c] of ICO.F) extra.I.push(base + a, base + b, base + c);
}
// teeth: crooked, yellowed, a couple missing, tips pointed
const toothCol = (q, u) => { const t = (u[1] + 1) / 2; return mixc(srgb(0x231a12), srgb(0x6f644c), smoothstep(0.1, 0.8, t)); };
for (const [row, yRoot, dirY, boneN] of [['up', 2.12, -1, 'Head'], ['lo', 2.091, 1, 'Jaw']]) {
  const N = 12;
  for (let t = 0; t < N; t++) {
    if ((row === 'up' && (t === 3 || t === 9)) || (row === 'lo' && t === 7)) continue; // missing teeth
    const broken = R() < 0.25 ? 0.55 : 1;
    const ph = (t / (N - 1)) * 2 - 1;
    const x = 0.041 * ph, z = 0.054 + 0.031 * (1 - ph * ph) - (row === 'lo' ? 0.003 : 0);
    const big = Math.abs(ph) > 0.3 && Math.abs(ph) < 0.55 ? 1.35 : 1; // canines
    const len = (0.0095 + rr(-0.0015, 0.0025)) * big * broken, wid = rr(0.0036, 0.0046) * (Math.abs(ph) > 0.6 ? 1.2 : 1), thk = 0.003;
    let up = [rr(-0.25, 0.25), dirY, rr(-0.25, 0.35)]; up = nrm(up); // tooth axis root->tip
    const out = nrm([x * 0.8, 0, z - 0.03]);
    const side = nrm(cross(up, out)); const fwd = cross(side, up);
    const root = [x, yRoot + rr(-0.0015, 0.0015), z];
    const o = add(root, mul(up, len * 0.5));
    addBlob((u) => { const tip = (u[1] + 1) / 2; const taper = mix(1, 0.35, Math.pow(tip, 1.4)); return [u[0] * wid * taper, u[1] * len * 0.5, u[2] * thk * taper]; }, [side, up, fwd], o, B[boneN].idx, toothCol, 0.32);
  }
}
// claws on fingers and toes
const clawCol = (q, u) => mixc(srgb(0x1a1210), srgb(0x3a2e24), (u[1] + 1) / 2 * 0.6);
for (const side of ['L', 'R']) {
  const { n, fingers } = arm[side];
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
    const J = fingers[f].joints; const tip = J[J.length - 1], prev = J[J.length - 2];
    const df = nrm(sub(tip, prev)); const dorsal = mul(n, -1);
    const side3 = nrm(cross(df, dorsal));
    const L = f === 'Thumb' ? 0.019 : 0.021;
    const o = add(add(tip, mul(df, -0.003)), mul(dorsal, 0.0035));
    addBlob((u) => { const t = (u[1] + 1) / 2; const taper = mix(1, 0.15, Math.pow(t, 1.3)); const curl = -t * t * 0.006; return [u[0] * 0.0058 * taper, u[1] * L * 0.5, u[2] * 0.0022 * taper + curl]; }, [side3, df, dorsal], add(o, mul(df, L * 0.3)), B[side + '_' + f + (f === 'Thumb' ? 3 : 4)].idx, clawCol, 0.28);
  }
}
log(`teeth/claws: ${extra.P.length / 3} verts`);

// ------------------------------------------------------------------ assemble & export
const totalV = nv + extra.P.length / 3;
const fP = new Float32Array(totalV * 3), fN = new Float32Array(totalV * 3), fC = new Uint8Array(totalV * 4), fUV = new Float32Array(totalV * 2), fJ = new Uint8Array(totalV * 4), fW = new Uint8Array(totalV * 4);
fP.set(P.map((x) => x * S)); fP.set(extra.P.map((x) => x * S), nv * 3);
fN.set(NRM); fN.set(extra.N, nv * 3);
const allC = [...COLOR, ...extra.C]; for (let i = 0; i < allC.length; i++) fC[i] = Math.round(clamp(allC[i], 0, 1) * 255);
fUV.set(UV); fUV.set(extra.UV, nv * 2);
fJ.set(JOINTS); fJ.set(extra.J, nv * 4);
const allW = [...WEIGHTS, ...extra.W];
for (let v = 0; v < totalV; v++) { // quantise weights so they sum to exactly 255
  const w = [0, 1, 2, 3].map((i) => allW[v * 4 + i]); const q = w.map((x) => Math.floor(x * 255)); let rem = 255 - q.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2, 3].sort((a, b) => (w[b] * 255 - q[b]) - (w[a] * 255 - q[a])); for (let i = 0; rem > 0; i = (i + 1) % 4, rem--) q[order[i]]++;
  for (let i = 0; i < 4; i++) fW[v * 4 + i] = q[i];
}
const allI = new Uint32Array(I.length + extra.I.length); allI.set(I); allI.set(extra.I.map((i) => i + nv), I.length);

const doc = new Document(); const buf = doc.createBuffer();
const acc = (type, arr, norm = false) => doc.createAccessor().setType(type).setArray(arr).setNormalized(norm).setBuffer(buf);
const mat = doc.createMaterial('LodgerSkin').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', acc('VEC3', fP)).setAttribute('NORMAL', acc('VEC3', fN))
  .setAttribute('COLOR_0', acc('VEC4', fC, true)).setAttribute('TEXCOORD_0', acc('VEC2', fUV))
  .setAttribute('JOINTS_0', acc('VEC4', fJ)).setAttribute('WEIGHTS_0', acc('VEC4', fW, true))
  .setIndices(acc('SCALAR', totalV < 65535 ? new Uint16Array(allI) : allI)).setMaterial(mat);
const mesh = doc.createMesh('Lodger').addPrimitive(prim);
const nodes = bones.map((b) => doc.createNode(b.name));
bones.forEach((b, i) => { const pp = b.parent ? B[b.parent].pos : [0, 0, 0]; nodes[i].setTranslation(mul(sub(b.pos, pp), S)); if (b.parent) nodes[B[b.parent].idx].addChild(nodes[i]); });
const ibm = new Float32Array(16 * bones.length);
bones.forEach((b, i) => { ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos[0] * S, -b.pos[1] * S, -b.pos[2] * S, 1], i * 16); });
const skin = doc.createSkin('LodgerSkin').setSkeleton(nodes[0]).setInverseBindMatrices(acc('MAT4', ibm));
nodes.forEach((n) => skin.addJoint(n));
const meshNode = doc.createNode('LodgerMesh').setMesh(mesh).setSkin(skin);
const root = doc.createNode('Lodger').addChild(nodes[0]).addChild(meshNode);
root.setExtras({
  scale: S,
  eyes: [[0.027, 2.183, 0.052], [-0.027, 2.1805, 0.051]].map((p) => mul(p, S)),
  face: mul([0, 2.185, 0.10], S),
  scalp: { center: mul([0, 2.205, -0.026], S), radii: mul([0.067, 0.087, 0.088], S) },
});
doc.createScene('Scene').addChild(root);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await new NodeIO().write(OUT, doc);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB), ${allI.length / 3} tris, ${totalV} verts`);
