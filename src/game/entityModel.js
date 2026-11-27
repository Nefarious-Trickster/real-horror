// The Lodger — creature model, skin shader, poses, micro-motion and wet matted hair.
//
// Contract (see DESIGN.md):
//   const m = await createEntityModel(gltfLoader);
//   m.object            Object3D, origin at the feet, faces +Z, ~2.3 m tall in 'stand'
//   m.poses             pose names
//   m.setPose(name)     instant snap (call only while unseen); also settles the hair
//   m.update(dt,t,seen) breathing, snapping twitches, hair simulation
//   m.setJaw(v)         0..1 (1 = dislocated)
//   m.faceAnchor        Object3D between the eye sockets (for the jumpscare camera)
//   m.dispose()
// Extras: m.bones (name -> Bone), m.hands {L,R} (attach props, e.g. the key, to these),
//         m.mesh (SkinnedMesh), m.material, m.setTint(color, darkness)

import * as THREE from 'three';

const DEG = Math.PI / 180;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e = new THREE.Euler();

function defaultUrl() {
  let base = '/';
  try { base = (import.meta.env && import.meta.env.BASE_URL) || '/'; } catch (e) { /* not vite */ }
  return base + 'assets/entity/lodger.glb';
}

// ------------------------------------------------------------------ skin material
const NOISE_GLSL = /* glsl */ `
float lh_hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float lh_noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(lh_hash(i+vec3(0,0,0)), lh_hash(i+vec3(1,0,0)), f.x), mix(lh_hash(i+vec3(0,1,0)), lh_hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(lh_hash(i+vec3(0,0,1)), lh_hash(i+vec3(1,0,1)), f.x), mix(lh_hash(i+vec3(0,1,1)), lh_hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
float lh_skinHeight(vec3 p){
  // wrinkles: anisotropic, running across limbs; lumps; pores
  float w = lh_noise(vec3(p.x*90.0, p.y*420.0, p.z*90.0)) ;
  float lumps = lh_noise(p*45.0);
  float pores = lh_noise(p*700.0);
  float fw = length(fwidth(p))*420.0; // fade the fine detail with distance
  return lumps*0.6 + w*0.35*(1.0-smoothstep(0.4,1.2,fw)) - pores*0.2*(1.0-smoothstep(0.15,0.6,fw*1.6));
}
vec3 lh_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`;

function makeSkinMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: 0xffffff });
  const uniforms = {
    uBump: { value: 0.0028 },
    uWrap: { value: 0.35 },
    uSSS: { value: new THREE.Color(0.38, 0.12, 0.09) },
    uTint: { value: new THREE.Color(1, 1, 1) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRestPos;\nvarying vec2 vRS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position;\nvRS = uv;');
    const lights = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `float lhWrap = saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) );
	vec3 lhSSS = max( lhWrap - dotNL, 0.0 ) * directLight.color * uSSS * vRS.y;
	reflectedLight.directDiffuse += ( irradiance + lhSSS ) * BRDF_Lambert( material.diffuseColor );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRestPos;\nvarying vec2 vRS;\nuniform float uBump;\nuniform float uWrap;\nuniform vec3 uSSS;\nuniform vec3 uTint;\n${NOISE_GLSL}`)
      .replace('#include <lights_physical_pars_fragment>', lights)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uTint;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRS.x;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{ float lhH = lh_skinHeight( vRestPos );
	  vec2 lhD = vec2( dFdx( lhH ), dFdy( lhH ) ) * uBump * 60.0;
	  normal = lh_perturb( -vViewPosition, normal, lhD, faceDirection ); }`);
  };
  mat.customProgramCacheKey = () => 'lodger-skin-v1';
  return mat;
}

// ------------------------------------------------------------------ hair
class Hair {
  constructor(model, roots) {
    this.model = model;
    this.strands = [];
    const rnd = mulberry(7);
    for (const r of roots) {
      const thick = r.stray ? rnd() * 0.0006 + 0.0007 : rnd() * 0.0028 + 0.0036;
      const length = r.len;
      const N = r.stray ? 12 : 16;
      const seg = length / (N - 1);
      this.strands.push({ root: r.p, nrm: r.n, N, seg, thick, pos: new Float32Array(N * 3), prev: new Float32Array(N * 3), grey: rnd() < 0.18 });
    }
    // geometry: 3-sided tubes with a tip vertex
    let nv = 0, ni = 0;
    for (const s of this.strands) { s.vo = nv; nv += s.N * 3 + 1; ni += (s.N - 1) * 3 * 6 + 3 * 3; }
    this.posArr = new Float32Array(nv * 3); this.nrmArr = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3); const idx = new Uint32Array(ni);
    let ii = 0;
    for (const s of this.strands) {
      const c = s.grey ? [0.09, 0.085, 0.078] : [0.008, 0.006, 0.005];
      for (let v = 0; v < s.N * 3 + 1; v++) col.set(c, (s.vo + v) * 3);
      for (let k = 0; k < s.N - 1; k++) for (let j = 0; j < 3; j++) {
        const a = s.vo + k * 3 + j, b = s.vo + k * 3 + ((j + 1) % 3), c2 = a + 3, d = b + 3;
        idx[ii++] = a; idx[ii++] = c2; idx[ii++] = b; idx[ii++] = b; idx[ii++] = c2; idx[ii++] = d;
      }
      const tip = s.vo + s.N * 3, last = s.vo + (s.N - 1) * 3;
      for (let j = 0; j < 3; j++) { idx[ii++] = last + j; idx[ii++] = tip; idx[ii++] = last + ((j + 1) % 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrmArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.0 });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'LodgerHair';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.lastHead = new THREE.Vector3(1e9, 0, 0);
    this.acc = 0;
    this.gravity = new THREE.Vector3(0, -9.8, 0);
    this.colliders = [];
    this.floorY = -1e9;
  }
  rootWorld(s, out) { return out.copy(s.root).applyMatrix4(this.model.headLocalToWorld); }
  reset() {
    const head = this.model.bones.Head; this.model.computeHeadMatrix();
    for (const s of this.strands) {
      this.rootWorld(s, _v1);
      _v2.copy(s.nrm).transformDirection(this.model.headLocalToWorld);
      for (let i = 0; i < s.N; i++) {
        // fall from the root, first a little along the scalp normal then down
        const out = Math.min(i, 1) * s.seg * 0.3;
        const down = Math.max(0, i - 1) * s.seg;
        s.pos[i * 3] = _v1.x + _v2.x * out; s.pos[i * 3 + 1] = _v1.y + _v2.y * out - down; s.pos[i * 3 + 2] = _v1.z + _v2.z * out;
      }
      s.prev.set(s.pos);
    }
    head.getWorldPosition(this.lastHead);
    this.updateColliders();
    this.floorY = this.model.object.matrixWorld.elements[13] + 0.004;
    for (let i = 0; i < 140; i++) this.step(1 / 60, true);
    this.write();
  }
  updateColliders() {
    const b = this.model.bones; const S = this.model.scale;
    const C = this.colliders; C.length = 0;
    const add = (bone, off, r) => { const p = new THREE.Vector3(...off).multiplyScalar(S); p.applyMatrix4(bone.matrixWorld); C.push([p, r * S]); };
    add(b.Neck1, [0, 0.03, 0], 0.042); add(b.Neck, [0, 0.0, 0], 0.05); add(b.Spine2, [0, 0.06, 0.0], 0.12);
    add(b.L_UpperArm, [0, 0, 0], 0.045); add(b.R_UpperArm, [0, 0, 0], 0.045); add(b.Spine2, [0, -0.05, 0.02], 0.12);
    add(b.Jaw, [0, -0.04, 0.05], 0.035);
  }
  step(dt, settling = false) {
    const g = this.gravity; const damp = settling ? 0.9 : 0.985;
    const H = this.model.headLocalToWorld; const Hinv = this.model.headWorldToLocal; const er = this.model.scalpRadii;
    for (const s of this.strands) {
      const P = s.pos, Q = s.prev;
      for (let i = 1; i < s.N; i++) {
        const k = i * 3;
        const x = P[k], y = P[k + 1], z = P[k + 2];
        P[k] += (x - Q[k]) * damp + g.x * dt * dt; P[k + 1] += (y - Q[k + 1]) * damp + g.y * dt * dt; P[k + 2] += (z - Q[k + 2]) * damp + g.z * dt * dt;
        Q[k] = x; Q[k + 1] = y; Q[k + 2] = z;
      }
      this.rootWorld(s, _v1); P[0] = _v1.x; P[1] = _v1.y; P[2] = _v1.z; Q[0] = _v1.x; Q[1] = _v1.y; Q[2] = _v1.z;
      _v2.copy(s.nrm).transformDirection(H);
      for (let it = 0; it < 4; it++) {
        // stiff base: second point sticks out of the scalp a little
        P[3] += (_v1.x + _v2.x * s.seg * 0.3 - P[3]) * 0.25; P[4] += (_v1.y + _v2.y * s.seg * 0.3 - P[4]) * 0.25; P[5] += (_v1.z + _v2.z * s.seg * 0.3 - P[5]) * 0.25;
        for (let i = 0; i < s.N - 1; i++) {
          const a = i * 3, b = a + 3;
          const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6; const diff = (d - s.seg) / d;
          if (i === 0) { P[b] -= dx * diff; P[b + 1] -= dy * diff; P[b + 2] -= dz * diff; }
          else { P[a] += dx * diff * 0.5; P[a + 1] += dy * diff * 0.5; P[a + 2] += dz * diff * 0.5; P[b] -= dx * diff * 0.5; P[b + 1] -= dy * diff * 0.5; P[b + 2] -= dz * diff * 0.5; }
        }
        // collisions: head ellipsoid + spheres + the floor under the creature
        for (let i = 2; i < s.N; i++) {
          const k = i * 3;
          if (P[k + 1] < this.floorY) P[k + 1] = this.floorY;
          _v3.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(Hinv);
          const lx = (_v3.x - er.cx) / er.x, ly = (_v3.y - er.cy) / er.y, lz = (_v3.z - er.cz) / er.z;
          const l = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (l < 1) { _v3.set(er.cx + (lx / l) * er.x, er.cy + (ly / l) * er.y, er.cz + (lz / l) * er.z).applyMatrix4(H); P[k] = _v3.x; P[k + 1] = _v3.y; P[k + 2] = _v3.z; }
          for (const [c, r] of this.colliders) {
            const dx = P[k] - c.x, dy = P[k + 1] - c.y, dz = P[k + 2] - c.z; const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-6; const f = r / d; P[k] = c.x + dx * f; P[k + 1] = c.y + dy * f; P[k + 2] = c.z + dz * f; }
          }
        }
      }
    }
  }
  write() {
    const inv = _m1.copy(this.model.object.matrixWorld).invert();
    const PA = this.posArr, NA = this.nrmArr;
    const t = new THREE.Vector3(), n = new THREE.Vector3(), bn = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3(), ref = new THREE.Vector3(0.3, 0.2, 1).normalize();
    for (const s of this.strands) {
      const P = s.pos;
      for (let i = 0; i < s.N; i++) {
        const a = Math.max(0, i - 1) * 3, b = Math.min(s.N - 1, i + 1) * 3;
        t.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]).normalize();
        n.crossVectors(t, ref).normalize(); bn.crossVectors(t, n);
        const r = s.thick * (1 - (i / s.N) * 0.75);
        p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        for (let j = 0; j < 3; j++) {
          const ang = (j / 3) * Math.PI * 2;
          q.copy(n).multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
          const vi = (s.vo + i * 3 + j) * 3;
          _v1.copy(p).addScaledVector(q, r).applyMatrix4(inv);
          PA[vi] = _v1.x; PA[vi + 1] = _v1.y; PA[vi + 2] = _v1.z;
          _v2.copy(q).transformDirection(inv); NA[vi] = _v2.x; NA[vi + 1] = _v2.y; NA[vi + 2] = _v2.z;
        }
      }
      const li = (s.N - 1) * 3, ti = (s.vo + s.N * 3) * 3;
      t.set(P[li] - P[li - 3], P[li + 1] - P[li - 2], P[li + 2] - P[li - 1]).normalize();
      _v1.set(P[li], P[li + 1], P[li + 2]).addScaledVector(t, s.seg * 0.5).applyMatrix4(inv);
      PA[ti] = _v1.x; PA[ti + 1] = _v1.y; PA[ti + 2] = _v1.z;
      _v2.copy(t).transformDirection(inv); NA[ti] = _v2.x; NA[ti + 1] = _v2.y; NA[ti + 2] = _v2.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
  update(dt) {
    const head = this.model.bones.Head;
    head.getWorldPosition(_v1);
    if (_v1.distanceTo(this.lastHead) > 0.35) { this.reset(); return; } // teleported (unseen move)
    this.lastHead.copy(_v1);
    this.model.computeHeadMatrix();
    this.updateColliders();
    this.floorY = this.model.object.matrixWorld.elements[13] + 0.004;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= 1 / 60) { this.step(1 / 60); this.acc -= 1 / 60; }
    this.write();
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ rig helpers (pose authoring)
class Rig {
  constructor(model) { this.m = model; this.b = model.bones; this.k = model.scale; }
  // abs(): following targets are absolute metres (e.g. a 2.8 m ceiling), not scaled with the body
  abs() { this.k = 1; return this; }
  reset() {
    this.k = this.m.scale; for (const [n, bone] of Object.entries(this.b)) { bone.position.copy(this.m.bindPos[n]); bone.quaternion.identity(); } this.upd(); }
  upd() { this.m.object.updateMatrixWorld(true); }
  // local euler (deg, YXZ); for R_ bones the angles are given in "left-side terms" and mirrored
  R(name, x = 0, y = 0, z = 0) {
    const mir = name.startsWith('R_');
    _e.set(x * DEG, (mir ? -y : y) * DEG, (mir ? -z : z) * DEG, 'YXZ');
    this.b[name].quaternion.setFromEuler(_e); this.upd(); return this;
  }
  S(name, l, r) { this.R('L_' + name, ...l); this.R('R_' + name, ...(r || l)); return this; }
  hips(x, y, z, rx = 0, ry = 0, rz = 0) { const u = this.k; this.b.Hips.position.set(x * u, y * u, z * u); _e.set(rx * DEG, ry * DEG, rz * DEG, 'YXZ'); this.b.Hips.quaternion.setFromEuler(_e); this.upd(); return this; }
  wpos(name, out = new THREE.Vector3()) { return this.b[name].getWorldPosition(out); }
  setWorldQuat(name, q) { const bone = this.b[name]; bone.parent.getWorldQuaternion(_q1); bone.quaternion.copy(_q1.invert().multiply(q)); this.upd(); }
  worldEuler(x, y, z, order = 'YXZ') { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, order)); }
  aim(name, childName, dir) {
    const a = this.wpos(name), c = this.wpos(childName);
    const cur = c.sub(a).normalize(); const want = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const bone = this.b[name]; bone.getWorldQuaternion(_q2); q.multiply(_q2);
    this.setWorldQuat(name, q);
  }
  // two-bone IK: upper -> lower -> end, end placed at target, mid joint bends toward pole
  ik(upper, lower, end, target, pole) {
    const u = this.k;
    const T = target.clone().multiplyScalar(u), Pp = pole.clone().multiplyScalar(u);
    const A = this.wpos(upper), Bp = this.wpos(lower), Cp = this.wpos(end);
    const l1 = A.distanceTo(Bp), l2 = Bp.distanceTo(Cp);
    let d = A.distanceTo(T); d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
    const dir = T.clone().sub(A).normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = Pp.clone().sub(A); pd.addScaledVector(dir, -pd.dot(dir)).normalize();
    const elbow = A.clone().addScaledVector(dir, a).addScaledVector(pd, h);
    this.aim(upper, lower, elbow.clone().sub(A));
    const e2 = this.wpos(lower); const tgt = A.clone().addScaledVector(dir, d);
    this.aim(lower, end, tgt.sub(e2));
    return this;
  }
  arm(side, target, pole) { const P = side + '_'; return this.ik(P + 'UpperArm', P + 'Forearm', P + 'Hand', v(target), v(pole)); }
  leg(side, target, pole) { const P = side + '_'; return this.ik(P + 'Thigh', P + 'Shin', P + 'Foot', v(target), v(pole)); }
  // CCD: bring the Head joint to a target by bending the neck/spine chain
  reachHead(target, chain = ['Neck1', 'Neck', 'Spine2'], iters = 12, maxStep = 25) {
    const T = v(target).multiplyScalar(this.k);
    for (let it = 0; it < iters; it++) for (const name of chain) {
      const j = this.wpos(name), e = this.wpos('Head');
      const a = e.sub(j).normalize(), b = T.clone().sub(j).normalize();
      const ang = Math.min(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)), maxStep * DEG);
      if (ang < 1e-4) continue;
      const axis = new THREE.Vector3().crossVectors(a, b).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      const bone = this.b[name]; bone.getWorldQuaternion(_q2); this.setWorldQuat(name, q.multiply(_q2));
    }
    return this;
  }
  head(x, y, z) { this.setWorldQuat('Head', this.worldEuler(x, y, z)); return this; }
  // orient a hand so its fingers point along `fingers` and the palm faces `palm` (world)
  hand(side, fingers, palm) {
    const h = this.m.handFrames[side];
    const f = v(fingers).normalize(), pn = v(palm); pn.addScaledVector(f, -pn.dot(f)).normalize();
    const Mb = new THREE.Matrix4().makeBasis(h.dir, h.nrm, new THREE.Vector3().crossVectors(h.dir, h.nrm));
    const Mt = new THREE.Matrix4().makeBasis(f, pn, new THREE.Vector3().crossVectors(f, pn));
    const q = new THREE.Quaternion().setFromRotationMatrix(Mt.multiply(Mb.transpose()));
    this.setWorldQuat(side + '_Hand', q); return this;
  }
  foot(side, x, y, z, order = 'YXZ') { this.setWorldQuat(side + '_Foot', this.worldEuler(x, y, z, order)); return this; }
  // curl: per finger [seg1..seg4] degrees toward the palm (negative = hyperextend); spread degrees
  fingers(side, spec) {
    for (const [f, c] of Object.entries(spec)) {
      const segs = f === 'Thumb' ? 3 : 4; const info = this.m.fingerAxes[side][f];
      const curls = Array.isArray(c) ? c : c.c; const spread = Array.isArray(c) ? 0 : c.s || 0;
      for (let i = 0; i < segs; i++) {
        const bone = this.b[`${side}_${f}${i + 1}`];
        const q = new THREE.Quaternion().setFromAxisAngle(info.curl, (curls[i] ?? curls[curls.length - 1]) * DEG);
        if (i === 0 && spread) q.premultiply(_q1.setFromAxisAngle(info.spread, spread * DEG));
        bone.quaternion.copy(q);
      }
    }
    this.upd(); return this;
  }
  toes(side, deg) { this.b[side + '_Toe'].quaternion.setFromEuler(_e.set(deg * DEG, 0, 0)); this.upd(); return this; }
}
const v = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

// ------------------------------------------------------------------ poses
// Coordinates are object space in metres (feet at y=0, facing +Z). Body assumes a 2.8 m ceiling.
const CLAW = { Thumb: [10, 15, 20], Index: [8, 30, 35, 30], Middle: [10, 35, 40, 35], Ring: [12, 38, 42, 38], Pinky: [15, 40, 45, 40] };
const LIMP = { Thumb: [5, 10, 10], Index: [6, 12, 14, 12], Middle: [8, 14, 16, 14], Ring: [10, 16, 18, 16], Pinky: [12, 18, 20, 18] };

const POSES = {
  stand(r) {
    r.reset();
    r.hips(0.015, 1.115, 0.0, 0, -6, 4);
    r.R('Spine', 3, 0, -3).R('Spine1', 4, 2, 0).R('Spine2', 11, -4, 6);
    r.R('Neck', 18, 0, 0).R('Neck1', -4, 5, 0);
    r.S('Clavicle', [0, -14, -3], [0, -18, -9]);
    r.leg('L', [0.11, 0.088, 0.03], [0.2, 0.6, 1]);
    r.leg('R', [-0.14, 0.098, 0.08], [0.15, 0.6, 1]);
    r.foot('L', 0, -6, 0).foot('R', 6, -24, -4).toes('L', 18).toes('R', -10);
    r.arm('L', [0.27, 0.86, 0.10], [0.5, 1.2, -0.6]);
    r.arm('R', [-0.30, 0.84, 0.02], [-0.6, 1.2, -0.5]);
    r.hand('L', [0.05, -1, 0.15], [-1, 0, 0.1]).hand('R', [-0.1, -1, 0.25], [0.9, 0, 0.4]);
    r.fingers('L', LIMP);
    r.fingers('R', { Thumb: { c: [-5, 5, 10], s: 10 }, Index: { c: [-8, -10, -6, -5], s: 12 }, Middle: [6, 40, 60, 40], Ring: { c: [0, 6, 4, 0], s: -6 }, Pinky: { c: [-6, -12, -8, -6], s: -18 } });
    r.head(-8, 6, -28);
    return { jaw: 0.16 };
  },
  peek_left(r) {
    // origin = the wall edge (on the creature's side); wall occupies x<0, z in [0, +thickness]
    r.reset();
    r.hips(-0.34, 1.02, -0.17, 4, 10, -6);
    r.R('Spine', 6, 0, -10).R('Spine1', 5, -2, -12).R('Spine2', 8, 8, -16);
    r.reachHead([0.03, 1.80, -0.04], ['Neck1', 'Neck', 'Spine2', 'Spine1'], 16, 20);
    r.head(4, -12, -84);
    r.leg('L', [-0.18, 0.088, -0.12], [0.2, 0.6, 1]).leg('R', [-0.48, 0.088, -0.22], [-0.1, 0.6, 1]);
    r.foot('L', 0, 8, 0).foot('R', 0, -10, 0);
    r.arm('L', [0.005, 1.48, -0.045], [-0.35, 1.05, -0.35]);
    r.hand('L', [0.05, -0.18, 1], [-1, 0, 0]);
    r.fingers('L', { Thumb: [10, 20, 25], Index: [4, 10, 35, 55], Middle: [2, 8, 40, 60], Ring: [4, 12, 45, 55], Pinky: [8, 20, 45, 50] });
    r.S('Clavicle', [0, -6, 12], [0, -10, -6]);
    r.arm('R', [-0.52, 0.86, -0.12], [-1.0, 1.2, -0.6]);
    r.fingers('R', LIMP);
    return { jaw: 0.25 };
  },
  crouch(r) {
    r.reset();
    r.hips(0.0, 0.43, -0.12, 24, 4, -3);
    r.R('Spine', 18, 0, 4).R('Spine1', 16, -5, 0).R('Spine2', 16, 6, -4).R('Neck', 18, 0, 0).R('Neck1', -20, 0, 0);
    r.S('Clavicle', [0, -16, -6], [0, -14, -2]);
    r.leg('L', [0.21, 0.12, 0.04], [0.9, 0.9, 1.0]).leg('R', [-0.25, 0.13, 0.0], [-0.9, 0.9, 1.0]);
    r.foot('L', 38, -8, 0).foot('R', 42, 14, 0).toes('L', -45).toes('R', -40);
    r.arm('L', [0.07, 0.24, 0.30], [0.6, 0.6, -0.4]).arm('R', [-0.10, 0.20, 0.36], [-0.6, 0.6, -0.4]);
    r.hand('L', [0.15, -0.55, 1], [0, -1, 0]).hand('R', [-0.35, -0.6, 1], [0, -1, 0]);
    r.fingers('L', { Thumb: [10, 10, 10], Index: { c: [10, 20, 25, 30], s: 10 }, Middle: [12, 22, 30, 35], Ring: [10, 20, 30, 30], Pinky: { c: [8, 15, 25, 20], s: -14 } });
    r.fingers('R', { Thumb: [15, 20, 25], Index: { c: [-5, 20, 50, 60], s: 6 }, Middle: [5, 15, 20, 15], Ring: [10, 35, 50, 40], Pinky: { c: [-10, 0, 10, 20], s: -20 } });
    r.head(-30, -6, 34);
    return { jaw: 0.3 };
  },
  crawl(r) {
    r.reset();
    r.hips(0.0, 0.97, -0.42, 70, 0, 3);
    r.R('Spine', 8, 0, -2).R('Spine1', 4, 3, 0).R('Spine2', 0, -3, 3);
    r.reachHead([0.04, 1.08, 0.68], ['Neck1', 'Neck', 'Spine2'], 14, 25);
    r.head(-24, 8, -38);
    r.leg('L', [0.22, 0.09, -0.92], [0.8, 0.5, -0.2]).leg('R', [-0.20, 0.09, -0.98], [-0.8, 0.5, -0.4]);
    r.foot('L', 20, 14, 0).foot('R', 26, -10, 0).toes('L', -30).toes('R', -25);
    r.S('Clavicle', [0, -10, 4], [0, -12, 2]);
    r.arm('L', [0.30, 0.08, 0.55], [1.0, 0.7, 0.0]).arm('R', [-0.26, 0.08, 0.62], [-1.0, 0.7, 0.2]);
    r.hand('L', [0.35, -0.1, 1], [0, -1, 0]).hand('R', [-0.2, -0.1, 1], [0, -1, 0]);
    r.fingers('L', { Thumb: { c: [10, 0, 0], s: 20 }, Index: { c: [-5, 10, 20, 15], s: 10 }, Middle: [-5, 12, 20, 18], Ring: [-4, 14, 22, 16], Pinky: { c: [0, 14, 22, 14], s: -18 } });
    r.fingers('R', { Thumb: { c: [10, 10, 0], s: 20 }, Index: { c: [-8, 15, 25, 25], s: 14 }, Middle: [-6, 20, 30, 25], Ring: [-6, 20, 30, 25], Pinky: { c: [-6, 20, 25, 20], s: -20 } });
    return { jaw: 0.4 };
  },
  ceiling(r) {
    // spider-clinging to a ceiling at ~2.75 m, belly to the floor, face upside down and looking at you
    r.reset(); r.abs();
    r.hips(0.0, 2.34, -0.34, 92, 0, 0);
    r.R('Spine', -6, 0, 3).R('Spine1', -6, 2, 0).R('Spine2', -4, -4, -3);
    r.reachHead([0.05, 2.12, 0.42], ['Neck1', 'Neck', 'Spine2'], 14, 25);
    r.head(32, 10, 168);
    r.leg('L', [0.46, 2.66, -0.86], [1.6, 1.8, -0.6]).leg('R', [-0.42, 2.66, -0.95], [-1.6, 1.8, -0.8]);
    r.foot('L', 180, 160, 0, 'XYZ').foot('R', 180, 205, 0, 'XYZ');
    r.toes('L', -20).toes('R', -10);
    r.S('Clavicle', [0, -8, 18], [0, -6, 22]);
    r.arm('L', [0.50, 2.62, 0.32], [1.6, 1.9, -0.3]).arm('R', [-0.46, 2.62, 0.42], [-1.6, 1.9, -0.2]);
    r.hand('L', [0.5, 0.1, 1], [0, 1, 0]).hand('R', [-0.4, 0.1, 1], [0, 1, 0]);
    r.fingers('L', { Thumb: { c: [10, 0, 0], s: 25 }, Index: { c: [-5, 10, 25, 20], s: 14 }, Middle: [-5, 12, 25, 20], Ring: [-4, 14, 22, 16], Pinky: { c: [0, 14, 22, 14], s: -20 } });
    r.fingers('R', { Thumb: { c: [10, 0, 0], s: 25 }, Index: { c: [-6, 20, 30, 30], s: 16 }, Middle: [-6, 18, 28, 26], Ring: [-6, 16, 25, 22], Pinky: { c: [-6, 14, 20, 20], s: -22 } });
    return { jaw: 0.55 };
  },
  reach(r) {
    r.reset();
    r.hips(0.0, 1.05, -0.08, 4, 10, -3);
    r.R('Spine', 14, 0, 0).R('Spine1', 10, 4, 0).R('Spine2', 12, 8, -6);
    r.reachHead([0.04, 1.96, 0.36], ['Neck1', 'Neck', 'Spine2'], 12, 20);
    r.head(-6, -10, 44);
    r.leg('L', [0.13, 0.088, 0.20], [0.2, 0.6, 1]).leg('R', [-0.12, 0.14, -0.30], [-0.1, 0.6, 1]);
    r.foot('L', -4, -8, 0).foot('R', 36, 10, 0).toes('R', -40);
    r.S('Clavicle', [0, -24, 8], [0, -10, -4]);
    r.arm('L', [0.12, 1.64, 0.86], [0.8, 1.0, 0.3]);
    r.hand('L', [-0.05, 0.05, 1], [0, -0.6, 0.8]);
    r.fingers('L', { Thumb: { c: [0, 10, 20], s: 25 }, Index: { c: [-10, 10, 25, 30], s: 16 }, Middle: { c: [-8, 12, 28, 32], s: 4 }, Ring: { c: [-6, 15, 30, 35], s: -8 }, Pinky: { c: [-4, 18, 30, 35], s: -22 } });
    r.arm('R', [-0.26, 0.85, -0.16], [-0.6, 1.2, -0.8]);
    r.fingers('R', CLAW);
    return { jaw: 0.35 };
  },
  lie(r) {
    // on its back, head toward -Z, feet toward +Z, centred on the origin (body ~2.3 m long)
    r.reset();
    r.hips(0.0, 0.12, 0.02, -90, 0, 0);
    r.R('Spine', -2, 0, 0).R('Spine1', -2, 0, 2).R('Spine2', -2, 0, -2).R('Neck', 4, 0, 0).R('Neck1', 2, 0, 0);
    r.setWorldQuat('Head', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 52 * DEG).multiply(r.worldEuler(-84, 0, 0)));
    r.S('Clavicle', [0, 0, -6], [0, 0, -4]);
    r.arm('L', [0.04, 0.25, -0.24], [0.7, 0.08, -0.05]);
    r.hand('L', [-1, 0, 0.35], [0, -1, 0]);
    r.arm('R', [-0.25, 0.08, 0.16], [-0.75, 0.04, -0.25]);
    r.hand('R', [-0.15, -0.05, 1], [0.8, 0, 0]);
    r.fingers('L', { Thumb: [10, 15, 15], Index: [10, 25, 30, 25], Middle: [12, 28, 32, 28], Ring: [14, 30, 35, 30], Pinky: [16, 32, 38, 30] });
    r.fingers('R', { Thumb: [25, 30, 30], Index: [30, 50, 50, 40], Middle: [35, 55, 55, 45], Ring: [40, 55, 55, 45], Pinky: [40, 55, 55, 45] });
    r.R('L_Thigh', 0, 4, 2).R('R_Thigh', 0, 2, 3).R('L_Shin', 3, 0, 0).R('R_Shin', 5, 0, 0);
    r.foot('L', -40, 30, 20).foot('R', -45, -35, -25);
    return { jaw: 0.35 };
  },
  jumpscare(r) {
    r.reset();
    r.hips(0.0, 1.0, -0.05, 12, 0, 0);
    r.R('Spine', 14, 0, 0).R('Spine1', 10, 0, 0).R('Spine2', 6, 0, 0);
    r.reachHead([0.0, 1.94, 0.42], ['Neck1', 'Neck', 'Spine2'], 12, 25);
    r.head(-14, 4, 16);
    r.S('Clavicle', [0, -12, 24], [0, -10, 26]);
    r.arm('L', [0.62, 1.70, 0.42], [0.8, 0.9, -0.6]).arm('R', [-0.60, 1.62, 0.48], [-0.8, 0.9, -0.6]);
    r.hand('L', [-0.55, 0.45, 0.7], [-0.3, 0, -1]).hand('R', [0.6, 0.35, 0.7], [0.3, 0, -1]);
    r.fingers('L', { Thumb: { c: [0, 20, 30], s: 30 }, Index: { c: [-15, 25, 40, 45], s: 18 }, Middle: { c: [-12, 25, 40, 45], s: 5 }, Ring: { c: [-10, 28, 45, 45], s: -10 }, Pinky: { c: [-8, 30, 45, 45], s: -26 } });
    r.fingers('R', { Thumb: { c: [0, 20, 30], s: 30 }, Index: { c: [-15, 30, 45, 50], s: 18 }, Middle: { c: [-12, 30, 45, 50], s: 5 }, Ring: { c: [-10, 30, 45, 45], s: -10 }, Pinky: { c: [-8, 30, 45, 45], s: -26 } });
    r.leg('L', [0.15, 0.088, 0.34], [0.2, 0.6, 1]).leg('R', [-0.13, 0.17, -0.46], [-0.1, 0.6, 1]);
    r.foot('L', 0, 0, 0).foot('R', 45, 0, 0).toes('R', -45);
    return { jaw: 1.0 };
  },
};

// mirror peek_left -> peek_right (across the YZ plane)
function mirrorPose(src) {
  const quats = {}; for (const [n, q] of Object.entries(src.quats)) { const m = n.startsWith('L_') ? 'R_' + n.slice(2) : n.startsWith('R_') ? 'L_' + n.slice(2) : n; quats[m] = new THREE.Quaternion(q.x, -q.y, -q.z, q.w); }
  return { quats, hipsPos: new THREE.Vector3(-src.hipsPos.x, src.hipsPos.y, src.hipsPos.z), jaw: src.jaw };
}

// ------------------------------------------------------------------ factory
export async function createEntityModel(loader, opts = {}) {
  const gltf = opts.gltf || await loader.loadAsync(opts.url || defaultUrl());
  const object = new THREE.Group(); object.name = 'Lodger';
  const root = gltf.scene; object.add(root);
  const extras = root.getObjectByName('Lodger')?.userData || {};
  let mesh = null; root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!mesh) throw new Error('lodger.glb: no skinned mesh');
  const material = makeSkinMaterial();
  mesh.material.dispose(); mesh.material = material;
  mesh.castShadow = true; mesh.receiveShadow = true;
  const bones = {}; for (const b of mesh.skeleton.bones) bones[b.name] = b;
  const bindPos = {}; for (const [n, b] of Object.entries(bones)) bindPos[n] = b.position.clone();
  const scale = extras.scale || 1;
  object.updateMatrixWorld(true);
  const bindWorld = {}; for (const [n, b] of Object.entries(bones)) bindWorld[n] = b.getWorldPosition(new THREE.Vector3());

  const model = { object, bones, bindPos, scale, mesh, material };

  // hand frames & finger axes from the bind skeleton
  model.handFrames = {}; model.fingerAxes = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1, P = side + '_';
    const dir = bindWorld[P + 'Middle1'].clone().sub(bindWorld[P + 'Hand']).normalize();
    const w = bindWorld[P + 'Index1'].clone().sub(bindWorld[P + 'Pinky1']).normalize();
    const nrm = new THREE.Vector3().crossVectors(dir, w).multiplyScalar(s).normalize();
    model.handFrames[side] = { dir, nrm };
    model.fingerAxes[side] = {};
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const df = bindWorld[P + f + '2'].clone().sub(bindWorld[P + f + '1']).normalize();
      model.fingerAxes[side][f] = { curl: new THREE.Vector3().crossVectors(df, nrm).normalize(), spread: nrm.clone().multiplyScalar(s) };
    }
  }

  // head-space helpers for the hair (bind rotations are identity)
  const headBind = bindWorld.Head.clone();
  model.headLocalToWorld = new THREE.Matrix4(); model.headWorldToLocal = new THREE.Matrix4();
  model.computeHeadMatrix = () => { bones.Head.updateWorldMatrix(true, false); model.headLocalToWorld.copy(bones.Head.matrixWorld).multiply(_m1.makeTranslation(-headBind.x, -headBind.y, -headBind.z)); model.headWorldToLocal.copy(model.headLocalToWorld).invert(); };
  const sc = extras.scalp || { center: [0, 2.205 * scale, -0.026 * scale], radii: [0.067 * scale, 0.087 * scale, 0.088 * scale] };
  model.scalpRadii = { cx: sc.center[0], cy: sc.center[1], cz: sc.center[2], x: sc.radii[0] + 0.006 * scale, y: sc.radii[1] + 0.006 * scale, z: sc.radii[2] + 0.006 * scale };

  // eye glints: tiny wet beads deep in the sockets
  const glintMat = new THREE.MeshPhysicalMaterial({ color: 0x050404, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
  const glintGeo = new THREE.SphereGeometry(0.0042 * scale, 12, 8);
  for (const e of extras.eyes || [[0.028 * scale, 2.186 * scale, 0.056 * scale], [-0.028 * scale, 2.186 * scale, 0.056 * scale]]) {
    const g = new THREE.Mesh(glintGeo, glintMat); g.position.set(e[0] - headBind.x, e[1] - headBind.y, e[2] - headBind.z); bones.Head.add(g);
  }
  // face anchor
  const faceAnchor = new THREE.Object3D(); faceAnchor.name = 'LodgerFace';
  const fp = extras.face || [0, 2.19 * scale, 0.10 * scale];
  faceAnchor.position.set(fp[0] - headBind.x, fp[1] - headBind.y, fp[2] - headBind.z); bones.Head.add(faceAnchor);

  // hair roots from scalp vertices
  {
    const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, nr = mesh.geometry.attributes.normal;
    const headIdx = mesh.skeleton.bones.indexOf(bones.Head);
    const cand = [];
    for (let i = 0; i < pos.count; i++) {
      if (si.getX(i) !== headIdx || sw.getX(i) < 0.85) continue;
      const x = pos.getX(i) / scale, y = pos.getY(i) / scale, z = pos.getZ(i) / scale;
      const ny = nr.getY(i), nz = nr.getZ(i);
      const scalp = (y > 2.212 && z < 0.055) || (y > 2.14 && z < -0.03) || (y > 2.19 && z < 0.025 && Math.abs(x) < 0.07);
      if (!scalp || ny < -0.5 || (Math.abs(x) > 0.062 && y < 2.2 && z > -0.035)) continue; // keep ears & face clear
      cand.push([x, y, z, nr.getX(i), ny, nz]);
    }
    const rnd = mulberry(31);
    const roots = []; const minD = 0.012;
    for (let tries = 0; tries < 6000 && roots.length < 115; tries++) {
      const c = cand[Math.floor(rnd() * cand.length)]; if (!c) break;
      if (roots.some((r) => Math.hypot(r.raw[0] - c[0], r.raw[1] - c[1], r.raw[2] - c[2]) < minD)) continue;
      const back = c[2] < 0 ? 1 : 0.7;
      roots.push({ raw: c, stray: false, len: (0.42 + rnd() * 0.36) * back * scale });
    }
    for (let i = 0; i < 40; i++) { const c = cand[Math.floor(rnd() * cand.length)]; roots.push({ raw: c, stray: true, len: (0.3 + rnd() * 0.5) * scale }); }
    const hroots = roots.map((r) => ({ ...r, p: new THREE.Vector3(r.raw[0] * scale, r.raw[1] * scale, r.raw[2] * scale).addScaledVector(new THREE.Vector3(r.raw[3], r.raw[4], r.raw[5]), -0.002 * scale), n: new THREE.Vector3(r.raw[3], r.raw[4], r.raw[5]) }));
    model.hair = new Hair(model, hroots);
    object.add(model.hair.mesh);
  }

  // build poses
  const rig = new Rig(model);
  const built = {};
  for (const [name, fn] of Object.entries(POSES)) {
    const res = fn(rig) || {};
    const quats = {}; for (const [n, b] of Object.entries(bones)) quats[n] = b.quaternion.clone();
    built[name] = { quats, hipsPos: bones.Hips.position.clone(), jaw: res.jaw ?? 0.15 };
  }
  built.peek_right = mirrorPose(built.peek_left);
  const poseNames = ['stand', 'peek_left', 'peek_right', 'crouch', 'crawl', 'ceiling', 'reach', 'lie', 'jumpscare'];

  // micro-motion state
  const live = ['Spine1', 'Spine2', 'L_Clavicle', 'R_Clavicle', 'Neck1', 'Head', 'Jaw'];
  for (const side of ['L', 'R']) for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let i = 2; i <= 4; i++) live.push(`${side}_${f}${i}`);
  const offs = {}; for (const n of live) offs[n] = new THREE.Quaternion();
  const st = { pose: null, jaw: 0, jawTwitch: 0, nextTwitch: 1.5, headHold: 0, fingerHold: 0, fingerBones: [], breathPhase: Math.random() * 10 };
  const rnd = Math.random;

  function applyBase() {
    const P = built[st.pose];
    for (const [n, b] of Object.entries(bones)) { b.quaternion.copy(P.quats[n]); b.position.copy(bindPos[n]); }
    bones.Hips.position.copy(P.hipsPos);
  }
  function applyLive() {
    const P = built[st.pose];
    for (const n of live) bones[n].quaternion.copy(P.quats[n]).multiply(offs[n]);
    const j = THREE.MathUtils.clamp(st.jaw + st.jawTwitch, 0, 1.1);
    bones.Jaw.quaternion.multiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), j * 56 * DEG));
    const disl = Math.max(0, j - 0.6) / 0.4;
    bones.Jaw.position.copy(bindPos.Jaw).add(_v1.set(0, -0.007 * disl * scale, -0.003 * disl * scale));
  }
  function setPose(name) {
    if (!built[name]) throw new Error('unknown pose ' + name);
    st.pose = name; st.jaw = built[name].jaw; st.jawTwitch = 0;
    for (const n of live) offs[n].identity();
    st.headHold = 0; st.fingerHold = 0; st.nextTwitch = 0.6 + rnd() * 2;
    applyBase(); applyLive();
    object.updateMatrixWorld(true);
    model.hair.reset();
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius *= 1.15;
  }
  function setJaw(val) { st.jaw = THREE.MathUtils.clamp(val, 0, 1); }

  const e2 = new THREE.Euler();
  function update(dt, t, seen) {
    if (!st.pose) return;
    dt = Math.min(dt, 0.1);
    // breathing: slow, shallow, with a catch every few breaths
    st.breathPhase += dt * (seen ? 0.42 : 0.3);
    const ph = st.breathPhase % 1; const cyc = Math.floor(st.breathPhase);
    let br = ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI * 0.5) : Math.cos(((ph - 0.4) / 0.6) * Math.PI * 0.5);
    if (cyc % 4 === 3 && ph > 0.2 && ph < 0.32) br *= 0.55; // ragged catch
    offs.Spine2.setFromEuler(e2.set(-br * 1.6 * DEG, 0, 0));
    offs.Spine1.setFromEuler(e2.set(-br * 0.8 * DEG, 0, 0));
    offs.L_Clavicle.setFromEuler(e2.set(0, 0, br * 1.4 * DEG)); offs.R_Clavicle.setFromEuler(e2.set(0, 0, -br * 1.4 * DEG));
    // twitches: instantaneous snaps, then holds
    st.nextTwitch -= dt; st.headHold -= dt; st.fingerHold -= dt;
    if (st.headHold <= 0 && !offs.Head.equals(_q2.identity())) { if (rnd() < 0.6) { offs.Head.identity(); offs.Neck1.identity(); } st.headHold = 1e9; }
    if (st.fingerHold <= 0 && st.fingerBones.length) { for (const n of st.fingerBones) offs[n].identity(); st.fingerBones = []; }
    if (st.jawTwitch > 0) st.jawTwitch = Math.max(0, st.jawTwitch - dt * 1.8);
    if (st.nextTwitch <= 0) {
      const k = rnd();
      if (k < 0.55) {
        const amp = seen ? 1 : 0.6;
        offs.Head.setFromEuler(e2.set((rnd() - 0.5) * 22 * amp * DEG, (rnd() - 0.5) * 26 * amp * DEG, (rnd() - 0.5) * 38 * amp * DEG, 'YXZ'));
        offs.Neck1.setFromEuler(e2.set((rnd() - 0.5) * 8 * DEG, 0, (rnd() - 0.5) * 10 * DEG));
        st.headHold = 0.12 + rnd() * (seen ? 1.2 : 2.5);
      } else if (k < 0.85) {
        const side = rnd() < 0.5 ? 'L' : 'R'; const f = ['Index', 'Middle', 'Ring', 'Pinky'][Math.floor(rnd() * 4)];
        const amt = (rnd() < 0.3 ? -1 : 1) * (18 + rnd() * 30); const axis = model.fingerAxes[side][f].curl;
        for (const n of st.fingerBones) offs[n].identity();
        st.fingerBones = [];
        for (let i = 2; i <= 4; i++) { const n = `${side}_${f}${i}`; offs[n].setFromAxisAngle(axis, amt * DEG * (i === 2 ? 0.6 : 1)); st.fingerBones.push(n); }
        st.fingerHold = 0.15 + rnd() * 1.4;
      } else {
        st.jawTwitch = 0.08 + rnd() * 0.12;
      }
      st.nextTwitch = seen ? 0.25 + rnd() * 1.3 : 1.5 + rnd() * 4.5;
    }
    applyLive();
    object.updateMatrixWorld(true);
    model.hair.update(dt);
  }
  function setTint(color, darkness = 0) {
    const c = new THREE.Color(color); c.multiplyScalar(1 - darkness);
    material.userData.uniforms.uTint.value.copy(c);
  }
  function dispose() {
    mesh.geometry.dispose(); material.dispose(); glintGeo.dispose(); glintMat.dispose(); model.hair.dispose();
    object.removeFromParent();
  }

  setPose('stand');
  return {
    object, poses: poseNames, setPose, update, setJaw, faceAnchor, dispose,
    bones, mesh, material, hands: { L: bones.L_Hand, R: bones.R_Hand }, setTint, hairStrands: model.hair.strands,
    get pose() { return st.pose; },
  };
}
