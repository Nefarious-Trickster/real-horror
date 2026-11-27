import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUV } from './materials.js';

export const T = 0.2;           // wall thickness
export const LV = { B: -3.0, BC: -0.25, G: 0, GC: 2.8, U: 3.0, UC: 5.6, A: 5.8 };
const EPS = 1e-4;

// ---------------------------------------------------------------- colliders
// Oriented rectangle in XZ with a Y range. Static walls have angle 0.
export class Collider {
  constructor(cx, cz, hx, hz, y0, y1, angle = 0, tag = 'wall') {
    this.cx = cx; this.cz = cz; this.hx = hx; this.hz = hz; this.y0 = y0; this.y1 = y1;
    this.setAngle(angle); this.tag = tag; this.enabled = true; this.occludes = true;
  }
  setAngle(a) { this.angle = a; this.c = Math.cos(a); this.s = Math.sin(a); }
  // push a circle (x,z,r) out; returns [dx,dz] or null
  push(x, z, r) {
    const lx0 = x - this.cx, lz0 = z - this.cz;
    const lx = lx0 * this.c + lz0 * this.s;     // rotate into local (inverse)
    const lz = -lx0 * this.s + lz0 * this.c;
    const qx = Math.max(-this.hx, Math.min(this.hx, lx));
    const qz = Math.max(-this.hz, Math.min(this.hz, lz));
    let dx = lx - qx, dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return null;
    let nx, nz, pen;
    if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
    else { // centre inside: push along least penetration axis
      const px = this.hx - Math.abs(lx), pz = this.hz - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + r; }
    }
    // rotate normal back to world
    const wx = nx * this.c - nz * this.s, wz = nx * this.s + nz * this.c;
    return [wx * pen, wz * pen];
  }
  // segment intersection test (3D). returns t in [0,1] or -1
  ray(ox, oy, oz, dx, dy, dz) {
    const lx0 = ox - this.cx, lz0 = oz - this.cz;
    const lox = lx0 * this.c + lz0 * this.s, loz = -lx0 * this.s + lz0 * this.c;
    const ldx = dx * this.c + dz * this.s, ldz = -dx * this.s + dz * this.c;
    let tmin = 0, tmax = 1;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      return tmin <= tmax;
    };
    if (!slab(lox, ldx, -this.hx, this.hx)) return -1;
    if (!slab(loz, ldz, -this.hz, this.hz)) return -1;
    if (!slab(oy, dy, this.y0, this.y1)) return -1;
    return tmin;
  }
}

// ---------------------------------------------------------------- door
export class Door {
  constructor(house, { id, axis, c, a, b, hingeAtA = true, swing = 1, y = 0, h = 2.1, locked = false, mat, exterior = false }) {
    this.id = id; this.house = house; this.locked = locked; this.axis = axis;
    const w = b - a;
    this.width = w;
    // hinge position in world
    const hingeS = hingeAtA ? a : b;
    const hx = axis === 'x' ? hingeS : c;
    const hz = axis === 'x' ? c : hingeS;
    this.pivot = new THREE.Group();
    this.pivot.position.set(hx, y, hz);
    // base rotation: panel extends along +X local from hinge
    let base = 0;
    if (axis === 'x') base = hingeAtA ? 0 : Math.PI;
    else base = hingeAtA ? -Math.PI / 2 : Math.PI / 2;
    this.base = base;
    this.pivot.rotation.y = base;
    // swing direction: which world side the door opens to (+1 → +z/+x side)
    // rotation +θ about Y moves +X local toward -Z world.
    const dirLocal = (axis === 'x') ? (hingeAtA ? -swing : swing) : (hingeAtA ? swing : -swing);
    this.openSign = dirLocal;
    const pw = w - 0.02, ph = h - 0.02, pt = 0.045;
    const g = new THREE.BoxGeometry(pw, ph, pt);
    g.translate(pw / 2 + 0.01, ph / 2 + 0.005, 0);
    const uv = g.attributes.uv; // scale uv to metres
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * pw, uv.getY(i) * ph);
    this.panel = new THREE.Mesh(g, mat);
    this.panel.castShadow = true; this.panel.receiveShadow = true;
    this.pivot.add(this.panel);
    // panels detail: inset rails (cheap: 4 thin boxes each side)
    const rail = house.mats.get('wood_trim', { tint: 0x8a7a6a });
    const addR = (x0, y0, x1, y1) => {
      for (const zs of [-1, 1]) {
        const rg = new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.012);
        rg.translate((x0 + x1) / 2, (y0 + y1) / 2, zs * (pt / 2 + 0.006));
        const m = new THREE.Mesh(rg, rail); m.castShadow = false; m.receiveShadow = true;
        this.pivot.add(m);
      }
    };
    const m = 0.11;
    addR(m, 0.12, pw - m + 0.02, 0.17); addR(m, ph * 0.52, pw - m + 0.02, ph * 0.52 + 0.05);
    addR(m, ph - 0.17, pw - m + 0.02, ph - 0.12);
    addR(m, 0.12, m + 0.05, ph - 0.12); addR(pw - m - 0.03, 0.12, pw - m + 0.02, ph - 0.12);
    // knob
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.9, roughness: 0.35 });
    for (const zs of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), knobMat);
      k.position.set(pw - 0.07, 1.0, zs * 0.06); this.pivot.add(k);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), knobMat);
      st.rotation.x = Math.PI / 2; st.position.set(pw - 0.07, 1.0, zs * 0.03); this.pivot.add(st);
    }
    house.group.add(this.pivot);
    this.angle = 0; this.target = 0; this.vel = 0;
    this.open = false;
    this.collider = new Collider(0, 0, pw / 2, pt / 2 + 0.01, y, y + h, 0, 'door');
    this.collider.door = this;
    house.colliders.push(this.collider);
    this.panel.userData.interact = { door: this };
    this.updateCollider();
    this.slow = 2.2;
  }
  worldCenter(out = new THREE.Vector3()) {
    return out.set(this.width / 2, 1.0, 0).applyMatrix4(this.pivot.matrixWorld);
  }
  setOpen(open, speed = 1) {
    this.open = open;
    this.target = open ? this.openSign * 1.75 : 0;
    this.slow = 2.2 * speed;
  }
  slam(open) { this.open = open; this.target = open ? this.openSign * 1.9 : 0; this.slow = 14; }
  updateCollider() {
    this.pivot.updateMatrixWorld(true);
    const a = this.base + this.angle;
    const cx = this.pivot.position.x + Math.cos(a) * (this.width / 2);
    const cz = this.pivot.position.z - Math.sin(a) * (this.width / 2);
    this.collider.cx = cx; this.collider.cz = cz;
    this.collider.setAngle(-a);
  }
  update(dt) {
    const d = this.target - this.angle;
    if (Math.abs(d) < 0.0005) { if (this.angle !== this.target) { this.angle = this.target; this.pivot.rotation.y = this.base + this.angle; this.updateCollider(); } return; }
    const step = Math.sign(d) * Math.min(Math.abs(d), dt * this.slow * (0.25 + Math.min(1, Math.abs(d))));
    this.angle += step;
    this.pivot.rotation.y = this.base + this.angle;
    this.updateCollider();
  }
}

// ---------------------------------------------------------------- house
export class House {
  constructor(mats) {
    this.mats = mats;
    this.group = new THREE.Group();
    this.buckets = new Map(); // material -> geometries
    this.colliders = [];
    this.floors = [];
    this.doors = new Map();
    this.windows = [];
    this.lamps = [];
    this.nodes = new Map();
    this.zones = [];
  }

  m(name, opts) { return this.mats.get(name, opts); }

  addGeo(mat, geo) {
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(geo);
  }

  box(mat, x0, y0, z0, x1, y1, z1, opts = {}) {
    if (x1 - x0 < EPS || y1 - y0 < EPS || z1 - z0 < EPS) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    worldUV(g, opts.rotUV);
    this.addGeo(typeof mat === 'string' ? this.m(mat) : mat, g);
    if (opts.collide !== false) {
      const c = new Collider((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, y0, y1, 0, opts.tag || 'wall');
      c.occludes = opts.occlude !== false;
      this.colliders.push(c);
    }
  }

  collider(x0, y0, z0, x1, y1, z1, tag = 'block', occludes = false) {
    const c = new Collider((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, y0, y1, 0, tag);
    c.occludes = occludes; this.colliders.push(c); return c;
  }

  // Wall along axis ('x' = runs along X at z=c; 'z' = runs along Z at x=c).
  // sides: [{side:-1|1, mat, y0, y1, skirt:true, trim:true}]
  // openings: [{a,b,y0,y1,kind:'door'|'open'|'window'}]
  wall(axis, c, s0, s1, sides, openings = [], wopts = {}) {
    const trimMat = this.m('wood_trim');
    for (const S of sides) {
      const mat = this.m(S.mat, S.matOpts);
      const ops = openings.filter((o) => o.y1 > S.y0 + EPS && o.y0 < S.y1 - EPS && o.b > s0 && o.a < s1);
      const bps = [s0, s1];
      for (const o of ops) { bps.push(Math.max(s0, o.a), Math.min(s1, o.b)); }
      bps.sort((p, q) => p - q);
      const u = [...new Set(bps.map((v) => +v.toFixed(5)))];
      const t0 = S.side < 0 ? c - T / 2 : c, t1 = S.side < 0 ? c : c + T / 2;
      const face = S.side < 0 ? c - T / 2 : c + T / 2;
      for (let i = 0; i < u.length - 1; i++) {
        const p = u[i], q = u[i + 1];
        if (q - p < EPS) continue;
        const mid = (p + q) / 2;
        const cov = ops.filter((o) => o.a <= mid && o.b >= mid).map((o) => [Math.max(S.y0, o.y0), Math.min(S.y1, o.y1)]).sort((x, y) => x[0] - y[0]);
        let y = S.y0; const free = [];
        for (const [a, b] of cov) { if (a > y + EPS) free.push([y, a]); y = Math.max(y, b); }
        if (S.y1 > y + EPS) free.push([y, S.y1]);
        for (const [ya, yb] of free) {
          if (axis === 'x') this.box(mat, p, ya, t0, q, yb, t1);
          else this.box(mat, t0, ya, p, t1, yb, q);
          if (S.skirt !== false && Math.abs(ya - S.y0) < EPS && S.floorY != null) {
            const fy = S.floorY, sh = 0.14, st = 0.022;
            const f0 = S.side < 0 ? face - st : face, f1 = S.side < 0 ? face : face + st;
            if (axis === 'x') this.box(trimMat, p, fy, f0, q, fy + sh, f1, { collide: false });
            else this.box(trimMat, f0, fy, p, f1, fy + sh, q, { collide: false });
          }
        }
      }
      // trims around openings on this face
      if (S.trim !== false) {
        for (const o of ops) {
          if (o.kind === 'open' && !o.trim) continue;
          const tw = 0.07, tt = 0.025;
          const f0 = S.side < 0 ? face - tt : face, f1 = S.side < 0 ? face : face + tt;
          const oy0 = Math.max(S.y0, o.y0), oy1 = Math.min(S.y1, o.y1);
          const bx = (a, b, y0, y1) => axis === 'x' ? this.box(trimMat, a, y0, f0, b, y1, f1, { collide: false }) : this.box(trimMat, f0, y0, a, f1, y1, b, { collide: false });
          bx(o.a - tw, o.a, oy0 - (o.kind === 'window' ? tw : 0), oy1 + tw);
          bx(o.b, o.b + tw, oy0 - (o.kind === 'window' ? tw : 0), oy1 + tw);
          bx(o.a - tw, o.b + tw, oy1, oy1 + tw);
          if (o.kind === 'window') bx(o.a - tw - 0.03, o.b + tw + 0.03, oy0 - tw - 0.03, oy0);
        }
      }
    }
    // reveal surfaces (jamb thickness) inside openings
    for (const o of (wopts.reveal === false ? [] : openings)) {
      if (o.kind === 'window') this.windowPane(axis, c, o);
      const jm = this.m('wood_trim');
      const jt = 0.012;
      if (axis === 'x') {
        this.box(jm, o.a, o.y0, c - T / 2, o.a + jt, o.y1, c + T / 2, { collide: false });
        this.box(jm, o.b - jt, o.y0, c - T / 2, o.b, o.y1, c + T / 2, { collide: false });
        this.box(jm, o.a, o.y1 - jt, c - T / 2, o.b, o.y1, c + T / 2, { collide: false });
        if (o.kind === 'window') this.box(jm, o.a, o.y0, c - T / 2, o.b, o.y0 + jt, c + T / 2, { collide: false });
      } else {
        this.box(jm, c - T / 2, o.y0, o.a, c + T / 2, o.y1, o.a + jt, { collide: false });
        this.box(jm, c - T / 2, o.y0, o.b - jt, c + T / 2, o.y1, o.b, { collide: false });
        this.box(jm, c - T / 2, o.y1 - jt, o.a, c + T / 2, o.y1, o.b, { collide: false });
        if (o.kind === 'window') this.box(jm, c - T / 2, o.y0, o.a, c + T / 2, o.y0 + jt, o.b, { collide: false });
      }
      if (o.kind === 'window') {
        // windows block movement
        if (axis === 'x') this.collider(o.a, o.y0, c - T / 2, o.b, o.y1, c + T / 2, 'window', false);
        else this.collider(c - T / 2, o.y0, o.a, c + T / 2, o.y1, o.b, 'window', false);
      }
    }
  }

  windowPane(axis, c, o) {
    if (!this.glassMat) {
      this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.08, metalness: 0.0, transmission: 0, transparent: true, opacity: 0.55, envMapIntensity: 1.2, emissive: new THREE.Color(0x0), clearcoat: 1, depthWrite: false });
      this.glassMat.userData.lightningFlash = true;
      this.frameMat = this.m('wood_trim', { tint: 0x6a6a64 });
    }
    const w = o.b - o.a, h = o.y1 - o.y0;
    const g = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(g, this.glassMat);
    mesh.renderOrder = 2;
    if (axis === 'x') { mesh.position.set((o.a + o.b) / 2, (o.y0 + o.y1) / 2, c); }
    else { mesh.position.set(c, (o.y0 + o.y1) / 2, (o.a + o.b) / 2); mesh.rotation.y = Math.PI / 2; }
    const back = mesh.clone(); back.rotation.y += Math.PI; back.position.copy(mesh.position);
    this.group.add(mesh, back);
    // muntins: one vertical, two horizontal
    const fm = this.frameMat, mt = 0.03;
    const mx = (o.a + o.b) / 2, my1 = o.y0 + h * 0.5;
    if (axis === 'x') {
      this.box(fm, mx - mt / 2, o.y0, c - 0.03, mx + mt / 2, o.y1, c + 0.03, { collide: false });
      this.box(fm, o.a, my1 - mt / 2, c - 0.03, o.b, my1 + mt / 2, c + 0.03, { collide: false });
      this.box(fm, o.a, my1 - 0.025, c - 0.045, o.b, my1 + 0.025, c + 0.045, { collide: false });
    } else {
      this.box(fm, c - 0.03, o.y0, mx - mt / 2, c + 0.03, o.y1, mx + mt / 2, { collide: false });
      this.box(fm, c - 0.03, my1 - mt / 2, o.a, c + 0.03, my1 + mt / 2, o.b, { collide: false });
      this.box(fm, c - 0.045, my1 - 0.025, o.a, c + 0.045, my1 + 0.025, o.b, { collide: false });
    }
    const pos = axis === 'x' ? new THREE.Vector3(mx, (o.y0 + o.y1) / 2, c) : new THREE.Vector3(c, (o.y0 + o.y1) / 2, mx);
    const normal = axis === 'x' ? new THREE.Vector3(0, 0, o.out ?? 1) : new THREE.Vector3(o.out ?? 1, 0, 0);
    this.windows.push({ pos, normal, w, h, mesh });
  }

  floor(mat, x0, x1, z0, z1, y, opts = {}) {
    this.box(this.m(mat, opts.matOpts), x0, y - (opts.thick ?? 0.1), z0, x1, y, z1, { collide: false, rotUV: opts.rotUV });
    if (opts.walk !== false) this.floors.push({ x0, x1, z0, z1, y });
  }
  ceiling(mat, x0, x1, z0, z1, y, thick = 0.1) {
    this.box(this.m(mat), x0, y, z0, x1, y + thick, z1, { collide: false });
  }
  ramp(x0, x1, z0, z1, axis, a, ya, b, yb) { const r = { x0, x1, z0, z1, ramp: { axis, a, ya, b, yb } }; this.floors.push(r); return r; }

  // Stairs: treads along axis from s0 (height y0) to s1 (height y1), lateral [l0,l1]
  stairs(axis, s0, s1, y0, y1, l0, l1, opts = {}) {
    const n = Math.max(2, Math.round((y1 - y0) / 0.185));
    const rise = (y1 - y0) / n, run = (s1 - s0) / n;
    const tread = this.m('floor_wood');
    const riser = this.m('wood_trim');
    for (let i = 0; i < n; i++) {
      const top = y0 + rise * (i + 1);
      const a = s0 + run * i, b = s0 + run * (i + 1);
      const sa = Math.min(a, b), sb = Math.max(a, b);
      const bottom = opts.solid ? y0 : top - 0.06;
      if (axis === 'z') {
        this.box(tread, l0, top - 0.045, sa - 0.02, l1, top, sb + 0.02, { collide: false });
        // riser at the low edge
        const rz = run < 0 ? Math.max(a, b) : Math.min(a, b);
        this.box(riser, l0 + 0.01, top - rise, rz - 0.012, l1 - 0.01, top - 0.045, rz + 0.012, { collide: false });
        if (opts.solid) this.box(riser, l0 + 0.01, y0, sa, l1 - 0.01, top - rise, sb, { collide: false });
      }
    }
    // stringer soffit underneath (sloped board)
    const len = Math.hypot(s1 - s0, y1 - y0);
    const g = new THREE.BoxGeometry(l1 - l0, 0.05, len);
    const ang = Math.atan2(y1 - y0, Math.abs(s1 - s0));
    g.rotateX(run < 0 ? ang : -ang);
    g.translate((l0 + l1) / 2, (y0 + y1) / 2 - 0.22, (s0 + s1) / 2);
    worldUV(g);
    this.addGeo(this.m('wood_trim'), g);
    this.ramp(l0, l1, Math.min(s0, s1), Math.max(s0, s1), 'z', s0, y0, s1, y1);
    return { n, rise, run };
  }

  // walkable height under (x,z) that is not above maxY
  groundAt(x, z, maxY) {
    let best = -Infinity;
    for (const f of this.floors) {
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      if (f.disabled) continue;
      let y;
      if (f.ramp) {
        const r = f.ramp; const s = r.axis === 'z' ? z : x;
        const t = Math.max(0, Math.min(1, (s - r.a) / (r.b - r.a)));
        y = r.ya + (r.yb - r.ya) * t;
      } else y = f.y;
      if (y <= maxY && y > best) best = y;
    }
    return best;
  }

  // returns fraction [0,1] of first hit along segment, or 1 if clear
  raycast(from, to, ignoreDoors = false) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let best = 1;
    for (const c of this.colliders) {
      if (!c.enabled || !c.occludes) continue;
      if (ignoreDoors && c.tag === 'door') continue;
      const t = c.ray(from.x, from.y, from.z, dx, dy, dz);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }
  // number of occluding surfaces crossed (approx thickness) for audio
  occlusion(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let n = 0;
    for (const c of this.colliders) {
      if (!c.enabled || !c.occludes) continue;
      if (c.ray(from.x, from.y, from.z, dx, dy, dz) >= 0) { n += c.tag === 'door' ? 0.5 : 1; if (n >= 3) break; }
    }
    return Math.min(1, n * 0.42);
  }

  addNode(id, x, y, z, links = []) { this.nodes.set(id, { id, p: new THREE.Vector3(x, y, z), links: new Set(), doors: new Map() }); for (const l of links) this.link(id, l); }
  link(a, b, door) {
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (!A || !B) { this._pending = this._pending || []; this._pending.push([a, b, door]); return; }
    A.links.add(b); B.links.add(a);
    if (door) { A.doors.set(b, door); B.doors.set(a, door); }
  }
  resolvePending() { const p = this._pending || []; this._pending = []; for (const [a, b, d] of p) this.link(a, b, d); }

  nearestNode(p, sameFloor = true) {
    let best = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (n.disabled) continue;
      if (sameFloor && Math.abs(n.p.y - p.y) > 1.6) continue;
      const d = n.p.distanceToSquared(p);
      if (d < bd) {
        // prefer nodes with line of sight
        bd = d; best = n;
      }
    }
    return best;
  }
  nearestVisibleNode(p) {
    const list = [...this.nodes.values()].filter((n) => !n.disabled && Math.abs(n.p.y - p.y) < 1.6)
      .sort((a, b) => a.p.distanceToSquared(p) - b.p.distanceToSquared(p));
    const from = p.clone(); from.y += 0.8;
    for (const n of list.slice(0, 6)) {
      const to = n.p.clone(); to.y += 0.8;
      if (this.raycast(from, to, true) >= 0.999) return n;
    }
    return list[0] || null;
  }

  path(fromId, toId) {
    const open = new Map([[fromId, 0]]);
    const came = new Map(); const g = new Map([[fromId, 0]]);
    const goal = this.nodes.get(toId).p;
    const closed = new Set();
    while (open.size) {
      let cur = null, cf = Infinity;
      for (const [id, f] of open) if (f < cf) { cf = f; cur = id; }
      if (cur === toId) {
        const out = [cur]; while (came.has(cur)) { cur = came.get(cur); out.unshift(cur); } return out;
      }
      open.delete(cur); closed.add(cur);
      const N = this.nodes.get(cur);
      for (const nb of N.links) {
        if (closed.has(nb)) continue;
        const M = this.nodes.get(nb); if (M.disabled) continue;
        const door = N.doors.get(nb);
        const cost = N.p.distanceTo(M.p) + (door && !door.open ? 2.5 : 0) + (door && door.locked ? 1e6 : 0);
        const ng = g.get(cur) + cost;
        if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); came.set(nb, cur); open.set(nb, ng + M.p.distanceTo(goal)); }
      }
    }
    return null;
  }

  finalize(scene) {
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.buckets.clear();
    scene.add(this.group);
    this.resolvePending();
  }

  zoneAt(p) {
    for (const z of this.zones) if (p.x >= z.x0 && p.x <= z.x1 && p.z >= z.z0 && p.z <= z.z1 && p.y >= z.y0 && p.y <= z.y1) return z;
    return null;
  }
}

// ======================================================================
// THE LAYOUT
// ======================================================================
export function buildHouse(mats) {
  const H = new House(mats);
  const { B, BC, G, GC, U, UC, A } = LV;
  const X0 = -7, X1 = 7, Z0 = -6, Z1 = 6;
  const hx = 1.25; // hall half-width
  const DH = 2.1;  // door height

  // ---------- zones (rooms) for reverb, footsteps, naming
  const zone = (id, name, x0, x1, z0, z1, y0, y1, surface, reverb) => H.zones.push({ id, name, x0, x1, z0, z1, y0, y1, surface, reverb });
  zone('parlor', 'Parlour', X0, -hx, 0, Z1, G - 0.5, GC, 'carpet', [0.25, 1.6]);
  zone('kitchen', 'Kitchen', X0, -hx, Z0, 0, G - 0.5, GC, 'tile', [0.3, 1.4]);
  zone('hall', 'Hall', -hx, hx, Z0, Z1, G - 0.5, GC, 'wood', [0.4, 2.0]);
  zone('dining', 'Dining room', hx, X1, 0, Z1, G - 0.5, GC, 'wood', [0.35, 1.8]);
  zone('back', 'Back room', hx, X1, Z0, 0, G - 0.5, GC, 'wood', [0.35, 1.6]);
  zone('stairwell', 'Cellar stairs', 5.8, X1, Z0, -0.8, B, GC, 'wood', [0.6, 2.6]);
  zone('basement', 'Cellar', X0, X1, Z0, Z1, B - 0.5, BC, 'concrete', [0.7, 3.2]);
  zone('upHall', 'Landing', -hx, hx, Z0, Z1, U - 0.5, UC, 'wood', [0.4, 1.9]);
  zone('bedM', "Mother's room", X0, -hx, 0, Z1, U - 0.5, UC, 'carpet', [0.2, 1.3]);
  zone('bath', 'Bathroom', X0, -hx, Z0, 0, U - 0.5, UC, 'tile', [0.6, 1.8]);
  zone('child', 'Your old room', hx, X1, 0, Z1, U - 0.5, UC, 'carpet', [0.2, 1.3]);
  zone('sew', 'Sewing room', hx, X1, Z0, 0, U - 0.5, UC, 'wood', [0.3, 1.5]);
  zone('attic', 'Attic', X0, X1, Z0, Z1, A - 0.5, 9, 'wood', [0.5, 2.4]);
  zone('porch', 'Porch', -8, 8, Z1, 12, -1, 3, 'wood', [0.1, 0.8]);

  // ---------- floors & ceilings
  // ground
  H.floor('carpet', X0, -hx, 0, Z1, G, { thick: 0.1 });            // parlour (rug-like carpet)
  H.floor('tiles_kitchen', X0, -hx, Z0, 0, G, { matOpts: { size: 1.1 } });
  H.floor('floor_wood', -hx, hx, Z0, Z1, G);                       // hall (stairs over part)
  H.floor('floor_wood', hx, X1, 0, Z1, G);                         // dining
  H.floor('floor_wood', hx, 5.8, Z0, 0, G);                        // back room
  H.floor('floor_wood', 5.8, X1, -0.8, 0, G);
  H.floor('floor_wood', 5.8, X1, -1.6, -0.8, G);                   // cellar landing
  // ground ceilings (hole over main stairs x∈[0.25,1.25] z∈[-2.5,2.5], cellar stair hole)
  H.ceiling('ceiling_plaster', X0, -hx, Z0, Z1, GC);
  H.ceiling('ceiling_plaster', -hx, 0.25, Z0, Z1, GC);
  H.ceiling('ceiling_plaster', 0.25, hx, Z0, -2.5, GC);
  H.ceiling('ceiling_plaster', 0.25, hx, 2.5, Z1, GC);
  H.ceiling('ceiling_plaster', hx, X1, Z0, Z1, GC);
  // upstairs floors (same stair hole)
  H.floor('floor_wood', X0, -hx, 0, Z1, U, { matOpts: {} });
  H.floor('tiles_kitchen', X0, -hx, Z0, 0, U, { matOpts: { size: 0.9 } });
  H.floor('floor_wood', -hx, 0.25, Z0, Z1, U);
  H.floor('floor_wood', 0.25, hx, Z0, -2.5, U);
  H.floor('floor_wood', 0.25, hx, 2.5, Z1, U);
  H.floor('carpet', hx, X1, 0, Z1, U);
  H.floor('floor_wood', hx, X1, Z0, 0, U);
  // upstairs ceilings (attic hatch hole x∈[-1,0] z∈[3.3,4.9])
  H.ceiling('ceiling_plaster', X0, -1.0, Z0, Z1, UC);
  H.ceiling('ceiling_plaster', 0.0, X1, Z0, Z1, UC);
  H.ceiling('ceiling_plaster', -1.0, 0.0, Z0, 3.3, UC);
  H.ceiling('ceiling_plaster', -1.0, 0.0, 4.9, Z1, UC);
  // attic floor
  H.floor('attic_planks', X0, -1.0, Z0, Z1, A, { thick: 0.1 });
  H.floor('attic_planks', 0.0, X1, Z0, Z1, A, { thick: 0.1 });
  H.floor('attic_planks', -1.0, 0.0, Z0, 3.3, A, { thick: 0.1 });
  H.floor('attic_planks', -1.0, 0.0, 4.9, Z1, A, { thick: 0.1 });
  // basement
  H.floor('concrete_floor', X0, X1, Z0, Z1, B, { thick: 0.2 });
  H.ceiling('roof_rafters', X0, X1, Z0, -5.4, BC, 0.15);
  H.ceiling('roof_rafters', X0, X1, -1.6, Z1, BC, 0.15);
  H.ceiling('roof_rafters', X0, 5.8, -5.4, -1.6, BC, 0.15);
  // joists in basement ceiling
  for (let x = X0 + 0.6; x < X1; x += 0.6) {
    if (x > 5.7) continue;
    H.box('roof_rafters', x - 0.04, BC - 0.2, Z0, x + 0.04, BC, Z1, { collide: false });
  }

  // ---------- stairs
  H.stairs('z', 2.5, -2.5, G, U, 0.25, hx - 0.1);                    // main stairs, rising northward
  H.stairs('z', -1.6, -5.4, G, B, 5.9, X1 - T / 2, {});              // cellar stairs, descending north
  H.floor('concrete_floor', 5.8, X1, Z0, -5.4, B, { walk: true, thick: 0.05 });

  // under-stairs closet wall (stepped) along x=0.25 for the low part
  for (let i = 0; i < 16; i++) {
    const z1 = 2.5 - i * (5 / 16), z0 = z1 - 5 / 16;
    const top = G + (i + 1) * (3 / 16) - 0.3;
    if (top < 0.05) continue;
    if (z1 < -0.9) break;
    H.box('wall_plaster', 0.2, G, z0, 0.3, Math.min(top, GC), z1, {});
  }
  // back of the under-stairs closet
  H.box('wall_plaster', 0.25, G, -1.05, hx - 0.1, 1.75, -0.95, {});
  // banister along stairs (colliders per step + visual handrail & balusters)
  const railMat = mats.get('wood_trim');
  for (let i = 0; i < 16; i++) {
    const z1 = 2.5 - i * (5 / 16), z0 = z1 - 5 / 16;
    const top = G + (i + 1) * (3 / 16);
    H.collider(0.15, top, z0, 0.3, top + 1.0, z1, 'rail');
    H.box(railMat, 0.2, top, (z0 + z1) / 2 - 0.02, 0.24, top + 0.9, (z0 + z1) / 2 + 0.02, { collide: false });
  }
  {
    const len = Math.hypot(5, 3);
    const g = new THREE.BoxGeometry(0.07, 0.06, len);
    g.rotateX(Math.atan2(3, 5)); g.translate(0.22, G + 1.5 + 0.92 - 0.05, 0); worldUV(g); H.addGeo(railMat, g);
    // newel posts
    H.box(railMat, 0.16, G, 2.42, 0.28, G + 1.15, 2.54, { collide: true, tag: 'rail' });
  }
  // upstairs railing around the stairwell opening (x=0.25 for z∈[-2.5,2.5], and z=2.5)
  for (let z = -2.5; z <= 2.5; z += 0.18) H.box(railMat, 0.2, U, z - 0.02, 0.24, U + 0.9, z + 0.02, { collide: false });
  for (let x = 0.25; x <= hx; x += 0.18) H.box(railMat, x - 0.02, U, 2.48, x + 0.02, U + 0.9, 2.52, { collide: false });
  H.box(railMat, 0.17, U + 0.9, -2.5, 0.27, U + 0.96, 2.55, { collide: false });
  H.box(railMat, 0.17, U + 0.9, 2.45, hx, U + 0.96, 2.55, { collide: false });
  H.collider(0.15, U, -2.5, 0.3, U + 1.2, 2.55, 'rail');
  H.collider(0.15, U, 2.45, hx, U + 1.2, 2.6, 'rail');
  // cellar stair rail (open west side in basement)
  H.collider(5.75, B, -5.0, 5.85, BC, -1.6, 'rail');
  for (let z = -5.0; z <= -1.6; z += 0.4) {
    const y = G + (B - G) * ((-1.6 - z) / 3.8);
    H.box(railMat, 5.78, y, z - 0.025, 5.83, y + 0.95, z + 0.025, { collide: false });
  }

  // ---------- walls helpers
  const gIn = (mat, side) => ({ side, mat, y0: G, y1: GC, floorY: G });
  const uIn = (mat, side) => ({ side, mat, y0: U, y1: UC, floorY: U });
  const bIn = (mat, side) => ({ side, mat, y0: B, y1: BC, floorY: null, skirt: false, trim: false });
  const door = (a, b, y) => ({ a, b, y0: y, y1: y + DH, kind: 'door' });
  const open = (a, b, y, h = 2.3) => ({ a, b, y0: y, y1: y + h, kind: 'open', trim: true });
  const win = (a, b, y, out) => ({ a, b, y0: y + 0.85, y1: y + 2.15, kind: 'window', out });

  // exterior walls — inner faces per floor, outer siding full height
  const outer = (side) => ({ side, mat: 'siding', y0: -0.5, y1: A + 0.4, skirt: false });
  // south z=6 (front)
  H.wall('x', Z1, X0 - T / 2, X1 + T / 2, [outer(1)], [door(-0.5, 0.5, G), win(-5, -3.6, G, 1), win(3.6, 5, G, 1), win(-5, -3.8, U, 1), win(3.8, 5, U, 1)]);
  H.wall('x', Z1, X0 + T / 2, -hx, [gIn('wallpaper', -1), uIn('wallpaper', -1)], [win(-5, -3.6, G, 1), win(-5, -3.8, U, 1)], { reveal: false });
  H.wall('x', Z1, -hx, hx, [gIn('wall_plaster', -1), uIn('wall_plaster', -1)], [door(-0.5, 0.5, G)], { reveal: false });
  H.wall('x', Z1, hx, X1 - T / 2, [gIn('wall_plaster', -1), uIn('wallpaper', -1, )], [win(3.6, 5, G, 1), win(3.8, 5, U, 1)], { reveal: false });
  // north z=-6
  H.wall('x', Z0, X0 - T / 2, X1 + T / 2, [outer(-1)], [win(-5, -3.8, G, -1), win(3.5, 4.7, G, -1), win(3.5, 4.7, U, -1)]);
  H.wall('x', Z0, X0 + T / 2, -hx, [gIn('wall_plaster', 1), uIn('wall_damaged', 1)], [win(-5, -3.8, G, -1)], { reveal: false });
  H.wall('x', Z0, -hx, hx, [gIn('wall_plaster', 1), uIn('wall_plaster', 1)], [], { reveal: false });
  H.wall('x', Z0, hx, X1 - T / 2, [gIn('wall_plaster', 1), uIn('wallpaper', 1)], [win(3.5, 4.7, G, -1), win(3.5, 4.7, U, -1)], { reveal: false });
  // west x=-7
  H.wall('z', X0, Z0 - T / 2, Z1 + T / 2, [outer(-1)], [win(2.5, 3.9, G, -1), win(-3.5, -2.3, G, -1), win(2.0, 3.2, U, -1), { a: -3.5, b: -2.8, y0: U + 1.2, y1: U + 1.9, kind: 'window', out: -1 }]);
  H.wall('z', X0, 0, Z1 - T / 2, [gIn('wallpaper', 1), uIn('wallpaper', 1)], [win(2.5, 3.9, G, -1), win(2.0, 3.2, U, -1)], { reveal: false });
  H.wall('z', X0, Z0 + T / 2, 0, [gIn('wall_plaster', 1), uIn('wall_damaged', 1)], [win(-3.5, -2.3, G, -1), { a: -3.5, b: -2.8, y0: U + 1.2, y1: U + 1.9, kind: 'window', out: -1 }], { reveal: false });
  // east x=7
  H.wall('z', X1, Z0 - T / 2, Z1 + T / 2, [outer(1)], [win(2.5, 3.9, G, 1), win(-3.5, -2.3, G, 1), win(2.0, 3.2, U, 1)]);
  H.wall('z', X1, 0, Z1 - T / 2, [gIn('wall_plaster', -1), uIn('wallpaper', -1)], [win(2.5, 3.9, G, 1), win(2.0, 3.2, U, 1)], { reveal: false });
  H.wall('z', X1, Z0 + T / 2, 0, [gIn('wall_plaster', -1), uIn('wall_plaster', -1)], [win(-3.5, -2.3, G, 1)], { reveal: false });
  // slab band (between floors on the outside is covered by siding; inside, hide gaps)
  // basement walls (brick), full perimeter
  H.wall('x', Z1, X0, X1, [bIn('brick_wall', -1)]);
  H.wall('x', Z0, X0, X1, [bIn('brick_wall', 1)]);
  H.wall('z', X0, Z0, Z1, [bIn('brick_wall', 1)]);
  H.wall('z', X1, Z0, Z1, [bIn('brick_wall', -1)]);
  // basement partition x=1 from z=-6 to z=2.6 (open south end)
  H.wall('z', 1.0, Z0, 2.6, [bIn('brick_wall', -1), bIn('brick_wall', 1)]);
  // cellar stairwell side wall in basement (x=5.8, z∈[-5.0,-1.6] is railing; above slab enclosed)

  // interior ground walls
  // x=-1.25 (hall west): kitchen door z∈[-2.0,-1.1], parlour wide opening z∈[1.4,3.0]
  H.wall('z', -hx, Z0 + T / 2, Z1 - T / 2, [gIn('wall_plaster', 1)], [door(-2.0, -1.1, G), open(1.4, 3.0, G)]);
  H.wall('z', -hx, Z0 + T / 2, 0, [gIn('wall_plaster', -1)], [door(-2.0, -1.1, G)], { reveal: false });
  H.wall('z', -hx, 0, Z1 - T / 2, [gIn('wallpaper', -1)], [open(1.4, 3.0, G)], { reveal: false });
  // x=+1.25 (hall east): back-room door z∈[-5.2,-4.3], dining wide opening z∈[3.4,5.0]
  H.wall('z', hx, Z0 + T / 2, Z1 - T / 2, [gIn('wall_plaster', -1)], [door(-5.2, -4.3, G), open(3.4, 5.0, G)]);
  H.wall('z', hx, Z0 + T / 2, 0, [gIn('wall_plaster', 1)], [door(-5.2, -4.3, G)], { reveal: false });
  H.wall('z', hx, 0, Z1 - T / 2, [gIn('wall_plaster', 1)], [open(3.4, 5.0, G)], { reveal: false });
  // z=0 west: parlour/kitchen door x∈[-4.5,-3.6]
  H.wall('x', 0, X0 + T / 2, -hx - T / 2, [gIn('wall_plaster', -1), gIn('wallpaper', 1)], [door(-4.5, -3.6, G)]);
  // z=0 east: dining/back door x∈[3.6,4.5]
  H.wall('x', 0, hx + T / 2, X1 - T / 2, [gIn('wall_plaster', -1), gIn('wall_plaster', 1)], [door(3.6, 4.5, G)]);
  // cellar stairwell: x=5.8 z∈[-6,-0.8] and z=-0.8 x∈[5.8,7] with door x∈[5.95,6.75]
  H.wall('z', 5.8, Z0 + T / 2, -0.8, [gIn('wall_plaster', -1), { side: 1, mat: 'brick_wall', y0: G, y1: GC, floorY: G }]);
  H.box('brick_wall', 5.7, BC - 0.3, -5.4, 5.9, BC + 0.01, -1.6, { collide: false }); // header beam over stair
  H.wall('x', -0.8, 5.8 + T / 2, X1 - T / 2, [gIn('wall_plaster', 1), { side: -1, mat: 'brick_wall', y0: G, y1: GC, floorY: G }], [door(5.95, 6.75, G)]);

  // interior upstairs walls
  H.wall('z', -hx, Z0 + T / 2, Z1 - T / 2, [uIn('wall_plaster', 1)], [door(1.0, 1.9, U), door(-2.2, -1.3, U)]);
  H.wall('z', -hx, 0, Z1 - T / 2, [uIn('wallpaper', -1)], [door(1.0, 1.9, U)], { reveal: false });
  H.wall('z', -hx, Z0 + T / 2, 0, [uIn('wall_damaged', -1)], [door(-2.2, -1.3, U)], { reveal: false });
  H.wall('z', hx, Z0 + T / 2, Z1 - T / 2, [uIn('wall_plaster', -1)], [door(3.4, 4.3, U), door(-4.6, -3.7, U)]);
  H.wall('z', hx, 0, Z1 - T / 2, [uIn('wallpaper', 1)], [door(3.4, 4.3, U)], { reveal: false });
  H.wall('z', hx, Z0 + T / 2, 0, [uIn('wallpaper', 1)], [door(-4.6, -3.7, U)], { reveal: false });
  H.wall('x', 0, X0 + T / 2, -hx - T / 2, [uIn('wall_damaged', -1), uIn('wallpaper', 1)]);
  H.wall('x', 0, hx + T / 2, X1 - T / 2, [uIn('wallpaper', -1), uIn('wallpaper', 1)]);

  // slab edges between floors along hall walls (fill the 0.2 gap at ceiling level)
  // attic: gable walls at z=±6 (planks), knee walls, roof planes
  const ridge = A + 2.6, eave = A + 0.35;
  {
    const roofMat = mats.get('roof_rafters');
    const slopeW = Math.hypot(7.2, ridge - eave);
    const ang = Math.atan2(ridge - eave, 7.2);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(slopeW + 0.3, 0.08, 12.6);
      g.rotateZ(-s * ang);
      g.translate(s * 3.6, (ridge + eave) / 2 + 0.05, 0);
      worldUV(g); H.addGeo(roofMat, g);
      // rafters
      for (let z = -5.8; z <= 5.8; z += 0.8) {
        const r = new THREE.BoxGeometry(slopeW, 0.16, 0.07);
        r.rotateZ(-s * ang); r.translate(s * 3.6, (ridge + eave) / 2 - 0.06, z); worldUV(r); H.addGeo(roofMat, r);
      }
    }
    // ridge beam + collar ties
    H.box(roofMat, -0.08, ridge - 0.28, -6, 0.08, ridge - 0.02, 6, { collide: false });
    for (let z = -5.6; z <= 5.6; z += 1.6) H.box(roofMat, -2.0, ridge - 0.95, z - 0.04, 2.0, ridge - 0.8, z + 0.04, { collide: false });
    // gable walls: stacked boxes approximating the triangle
    for (const zc of [Z0, Z1]) {
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const y0 = A + (i / steps) * (ridge - A), y1 = A + ((i + 1) / steps) * (ridge - A);
        const half = 7.2 * (1 - Math.max(0, (y1 - eave)) / (ridge - eave));
        const hw = Math.min(7.0, Math.max(0.1, half));
        const side = zc < 0 ? 1 : -1;
        const z0 = side > 0 ? zc : zc - T / 2, z1 = side > 0 ? zc + T / 2 : zc;
        if (zc > 0 && y0 > A + 1.0 && y1 < A + 1.8) {
          // small window in south gable
          H.box('attic_planks', -hw, y0, z0, -0.45, y1, z1, { collide: false });
          H.box('attic_planks', 0.45, y0, z0, hw, y1, z1, { collide: false });
        } else H.box('attic_planks', -hw, y0, z0, hw, y1, z1, { collide: false });
      }
    }
    H.windowPane('x', Z1 - 0.05, { a: -0.45, b: 0.45, y0: A + 1.0, y1: A + 1.8, out: 1 });
    // attic movement limits (low roof) + gables
    H.collider(-7.5, A, Z0 - 0.2, -2.35, A + 3, Z1 + 0.2, 'roof');
    H.collider(2.35, A, Z0 - 0.2, 7.5, A + 3, Z1 + 0.2, 'roof');
    H.collider(-7, A, Z1 - 0.15, 7, A + 3, Z1 + 0.3, 'roof');
    H.collider(-7, A, Z0 - 0.3, 7, A + 3, Z0 + 0.15, 'roof');
    H.attic = { ridge, eave };
  }

  // ---------- exterior: porch
  H.floor('floor_wood', -3, 3, Z1 + 0.1, Z1 + 2.6, G - 0.05, { thick: 0.2 });
  H.floor('floor_wood', -1.2, 1.2, Z1 + 2.6, Z1 + 3.4, G - 0.3, { thick: 0.15 });
  H.floors.push({ x0: -40, x1: 40, z0: Z1 + 3.4, z1: 60, y: G - 0.5 }); // yard (visual in exterior.js)
  for (const x of [-2.9, 2.9]) H.box('wood_trim', x - 0.08, G - 0.05, Z1 + 2.42, x + 0.08, G + 2.7, Z1 + 2.58, { tag: 'post' });
  H.box('siding', -3.1, G + 2.7, Z1 + 0.1, 3.1, G + 2.82, Z1 + 2.8, { collide: false });
  // porch rails
  for (const x of [-2.9, 2.9]) H.collider(x - 0.1, G - 0.05, Z1 + 0.1, x + 0.1, G + 1, Z1 + 2.5, 'rail');
  H.collider(-3, G - 0.05, Z1 + 2.45, -1.2, G + 1, Z1 + 2.6, 'rail');
  H.collider(1.2, G - 0.05, Z1 + 2.45, 3, G + 1, Z1 + 2.6, 'rail');
  for (let x = -2.9; x <= 2.9; x += 0.2) { if (Math.abs(x) < 1.2) continue; H.box('wood_trim', x - 0.02, G - 0.05, Z1 + 2.48, x + 0.02, G + 0.9, Z1 + 2.52, { collide: false }); }
  H.box('wood_trim', -3, G + 0.9, Z1 + 2.45, -1.2, G + 0.96, Z1 + 2.55, { collide: false });
  H.box('wood_trim', 1.2, G + 0.9, Z1 + 2.45, 3, G + 0.96, Z1 + 2.55, { collide: false });
  // cap the outside of the slab bands so the house reads solid from the porch
  // roof eaves overhang (simple)

  // ---------- doors
  const dm = mats.get('wood_trim', { tint: 0xb8a48c });
  const D = (o) => { const d = new Door(H, { mat: dm, ...o }); H.doors.set(o.id, d); return d; };
  D({ id: 'front', axis: 'x', c: Z1, a: -0.5, b: 0.5, hingeAtA: true, swing: -1, y: G, locked: false });
  D({ id: 'parlorKitchen', axis: 'x', c: 0, a: -4.5, b: -3.6, hingeAtA: true, swing: -1, y: G });
  D({ id: 'kitchenHall', axis: 'z', c: -hx, a: -2.0, b: -1.1, hingeAtA: false, swing: -1, y: G });
  D({ id: 'diningBack', axis: 'x', c: 0, a: 3.6, b: 4.5, hingeAtA: false, swing: -1, y: G });
  D({ id: 'backHall', axis: 'z', c: hx, a: -5.2, b: -4.3, hingeAtA: true, swing: 1, y: G });
  D({ id: 'cellar', axis: 'x', c: -0.8, a: 5.95, b: 6.75, hingeAtA: false, swing: 1, y: G });
  D({ id: 'bedM', axis: 'z', c: -hx, a: 1.0, b: 1.9, hingeAtA: true, swing: -1, y: U });
  D({ id: 'bath', axis: 'z', c: -hx, a: -2.2, b: -1.3, hingeAtA: false, swing: -1, y: U });
  D({ id: 'child', axis: 'z', c: hx, a: 3.4, b: 4.3, hingeAtA: true, swing: 1, y: U });
  D({ id: 'sew', axis: 'z', c: hx, a: -4.6, b: -3.7, hingeAtA: false, swing: 1, y: U });

  // ---------- nav graph
  const N = (id, x, y, z, l) => H.addNode(id, x, y, z, l);
  N('hall_s', 0, G, 4.6, []); N('foyer', 0, G, 5.4, ['hall_s']);
  N('hall_m', -0.55, G, 0.6, ['hall_s']); N('hall_n', -0.2, G, -3.6, ['hall_m']); N('hall_nn', 0.3, G, -5.2, ['hall_n']);
  N('parlor_out', -0.6, G, 2.2, ['hall_s', 'hall_m']); N('parlor_in', -2.0, G, 2.2, ['parlor_out']);
  N('parlor_c', -4.2, G, 3.2, ['parlor_in']); N('parlor_k', -4.05, G, 0.75, ['parlor_c', 'parlor_in']);
  N('kitchen_p', -4.05, G, -0.75, []); H.link('parlor_k', 'kitchen_p', H.doors.get('parlorKitchen'));
  N('kitchen_c', -4.2, G, -3.2, ['kitchen_p']); N('kitchen_d', -2.0, G, -1.55, ['kitchen_c', 'kitchen_p']);
  N('kitchen_out', -0.6, G, -1.55, ['hall_m', 'hall_n']); H.link('kitchen_d', 'kitchen_out', H.doors.get('kitchenHall'));
  N('dining_out', 0.4, G, 4.2, ['hall_s']); N('dining_in', 2.0, G, 4.2, ['dining_out']);
  N('dining_c', 4.2, G, 3.0, ['dining_in']); N('dining_b', 4.05, G, 0.75, ['dining_c']);
  N('back_d', 4.05, G, -0.75, []); H.link('dining_b', 'back_d', H.doors.get('diningBack'));
  N('back_c', 3.4, G, -3.0, ['back_d']); N('back_in', 2.0, G, -4.75, ['back_c']);
  N('back_out', 0.6, G, -4.75, ['hall_nn', 'hall_n']); H.link('back_in', 'back_out', H.doors.get('backHall'));
  N('cellar_out', 6.35, G, -0.2, ['back_d', 'back_c']); N('cellar_land', 6.35, G, -1.25, []);
  H.link('cellar_out', 'cellar_land', H.doors.get('cellar'));
  N('cellar_bot', 6.35, B, -5.75, ['cellar_land']);
  N('bE_n', 4.0, B, -5.2, ['cellar_bot']); N('bE_m', 3.5, B, -0.5, ['bE_n']); N('bE_s', 3.5, B, 4.4, ['bE_m']);
  N('bW_s', -2.0, B, 4.4, ['bE_s']); N('bW_m', -3.5, B, 0, ['bW_s']); N('bW_n', -4.0, B, -4.2, ['bW_m']);
  N('st_bot', -0.4, G, 3.2, ['hall_s', 'hall_m', 'parlor_out']);
  N('st_low', 0.75, G, 3.0, ['st_bot']); N('st_top', 0.75, U, -3.0, ['st_low']);
  N('uh_n', -0.5, U, -3.6, ['st_top']); N('uh_nn', -0.3, U, -5.2, ['uh_n']); N('uh_m', -0.6, U, 0.2, ['uh_n']); N('uh_s', -0.1, U, 4.4, ['uh_m']); N('uh_ss', 0.2, U, 5.4, ['uh_s']);
  N('bedM_out', -0.6, U, 1.45, ['uh_m', 'uh_s']); N('bedM_in', -2.0, U, 1.45, []); H.link('bedM_out', 'bedM_in', H.doors.get('bedM'));
  N('bedM_c', -4.2, U, 3.4, ['bedM_in']);
  N('bath_out', -0.6, U, -1.75, ['uh_m', 'uh_n']); N('bath_in', -2.0, U, -1.75, []); H.link('bath_out', 'bath_in', H.doors.get('bath'));
  N('bath_c', -4.2, U, -3.2, ['bath_in']);
  N('child_out', 0.6, U, 3.85, ['uh_s']); N('child_in', 2.0, U, 3.85, []); H.link('child_out', 'child_in', H.doors.get('child'));
  N('child_c', 4.2, U, 3.0, ['child_in']);
  N('sew_out', 0.6, U, -4.15, ['uh_n', 'uh_nn']); N('sew_in', 2.0, U, -4.15, []); H.link('sew_out', 'sew_in', H.doors.get('sew'));
  N('sew_c', 4.2, U, -3.0, ['sew_in']);
  N('ladder_bot', -0.5, U, 2.6, ['uh_s', 'uh_m']); N('ladder_top', -0.5, A, 5.2, []);
  N('at_s', 0, A, 3.0, ['ladder_top']); N('at_m', 0, A, -0.5, ['at_s']); N('at_n', 0, A, -4.6, ['at_m']);
  N('porch', 0, G, 7.4, []); H.link('foyer', 'porch', H.doors.get('front'));
  H.nodes.get('ladder_top').disabled = true; H.nodes.get('at_s').disabled = true; H.nodes.get('at_m').disabled = true; H.nodes.get('at_n').disabled = true;
  H.ladderRamp = H.ramp(-1.0, 0.0, 2.9, 4.9, 'z', 2.9, U, 4.9, A);
  H.ladderRamp.disabled = true;

  return H;
}
