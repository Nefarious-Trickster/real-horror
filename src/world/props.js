import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Collider, LV } from './house.js';
import { worldUV } from './materials.js';

const BASE = import.meta.env.BASE_URL + 'assets/models/';
const { B, BC, G, GC, U, UC, A } = LV;
const HALF = Math.PI / 2;

export class Props {
  constructor(game) {
    this.game = game;
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.manifest = {};
    this.items = new Map();  // named placed props
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.lamps = [];
    this.flames = [];
  }

  async init(onProgress) {
    try { this.manifest = (await (await fetch(BASE + 'manifest.json')).json()).models || {}; } catch (e) { this.manifest = {}; }
    const ids = [...new Set([...PLACEMENTS.map((p) => p[0]), 'wooden_candlestick', 'lightbulb_01'])].filter((id) => this.manifest[id]);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        let gltf = null, err = null;
        for (let attempt = 0; attempt < 4 && !gltf; attempt++) {
          try { gltf = await this.loader.loadAsync(BASE + this.manifest[id].file); }
          catch (e) { err = e; await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
        }
        if (!gltf) throw err;
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            const m = o.material;
            if (m && m.isMeshStandardMaterial) { m.envMapIntensity = 0.35; }
          }
        });
        this.cache.set(id, root);
      } catch (e) {
        console.warn('model fail', id, e);
        // stand-in so the room isn't missing furniture (and collision still matches)
        const [w, h, d] = this.manifest[id].size; const [cx, cy, cz] = this.manifest[id].center;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 }));
        m.position.set(cx, cy, cz); m.castShadow = m.receiveShadow = true;
        const root = new THREE.Group(); root.add(m); this.cache.set(id, root); this.failed = (this.failed || 0) + 1;
      }
      done++; onProgress?.(done / ids.length);
    }));
  }

  place(id, x, y, z, rot = 0, opts = {}) {
    const src = this.cache.get(id);
    if (!src) return null;
    const o = src.clone(true);
    o.position.set(x, y, z); o.rotation.y = rot;
    if (opts.scale) o.scale.setScalar(opts.scale);
    if (opts.tilt) { o.rotation.x = opts.tilt[0]; o.rotation.z = opts.tilt[1]; }
    if (opts.noShadow) o.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.group.add(o);
    const info = this.manifest[id];
    if (opts.collide !== false && info && !opts.wall) {
      const s = opts.scale || 1;
      const [w, h, d] = info.size;
      const [cx, , cz] = info.center;
      const cosr = Math.cos(rot), sinr = Math.sin(rot);
      const wx = x + (cx * cosr + cz * sinr) * s, wz = z + (-cx * sinr + cz * cosr) * s;
      const shrink = opts.shrink ?? 0.9;
      const c = new Collider(wx, wz, (w * s * shrink) / 2, (d * s * shrink) / 2, y + (info.minY || 0), y + h * s, -rot, 'prop');
      c.occludes = !!opts.occlude;
      this.game.house.colliders.push(c);
      o.userData.collider = c;
    }
    if (opts.name) this.items.set(opts.name, o);
    return o;
  }

  // ---------- lights
  lamp(x, y, z, { intensity = 8, distance = 7, color = 0xffc98a, circuit = 'main', bulb = true, shadow = false, name, flicker = 0 } = {}) {
    const L = new THREE.PointLight(color, 0, distance, 2);
    L.position.set(x, y, z);
    if (shadow) { L.castShadow = true; L.shadow.mapSize.set(512, 512); L.shadow.bias = -0.002; L.shadow.camera.near = 0.1; L.shadow.camera.far = distance; }
    this.game.scene.add(L);
    let mesh = null;
    if (bulb) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(color), emissiveIntensity: 0 }));
      mesh.position.set(x, y, z); this.group.add(mesh);
    }
    const lamp = { light: L, mesh, base: intensity, circuit, name, flicker, on: true, level: 0, broken: false };
    this.lamps.push(lamp);
    return lamp;
  }

  // ---------- flames (candles)
  flame(x, y, z, { lit = false, name, light = true, size = 1 } = {}) {
    if (!this._flameTex) this._flameTex = flameTexture();
    const mat = new THREE.SpriteMaterial({ map: this._flameTex, color: 0xffcc88, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.035 * size, 0.08 * size, 1);
    s.position.set(x, y + 0.035 * size, z);
    s.visible = lit;
    this.group.add(s);
    let L = null;
    if (light) {
      L = new THREE.PointLight(0xff9a40, 0, 6, 2);
      L.position.set(x, y + 0.08, z);
      this.game.scene.add(L);
    }
    const f = { sprite: s, light: L, lit, name, phase: Math.random() * 100, base: 1.6 * size, pos: new THREE.Vector3(x, y, z) };
    this.flames.push(f);
    return f;
  }

  update(dt, t) {
    for (const f of this.flames) {
      if (!f.lit) { f.sprite.visible = false; if (f.light) f.light.intensity = 0; continue; }
      f.sprite.visible = true;
      const n = Math.sin(t * 13 + f.phase) * 0.12 + Math.sin(t * 31 + f.phase * 2) * 0.07 + (Math.random() - 0.5) * 0.08;
      f.sprite.scale.y = 0.08 * (1 + n) * (f.base / 1.6);
      f.sprite.material.opacity = 0.85 + n;
      if (f.light) f.light.intensity = f.base * (1 + n * 0.8);
    }
    for (const l of this.lamps) {
      let target = (l.on && !l.broken && this.game.power[l.circuit]) ? 1 : 0;
      if (target && l.flicker) {
        const n = Math.sin(t * 7.3 + l.base) * Math.sin(t * 19.1);
        if (n > 1 - l.flicker * 0.3) target = Math.random() < 0.5 ? 0.15 : 0.6;
      }
      if (this.game.surge > 0 && target) target *= Math.random() < 0.5 ? 0.05 : 1.2;
      l.level += (target - l.level) * Math.min(1, dt * (target > l.level ? 9 : 22));
      l.light.intensity = l.base * l.level;
      if (l.mesh) l.mesh.material.emissiveIntensity = l.level * 6;
    }
  }
}

function flameTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 88, 2, 32, 76, 56);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.2, 'rgba(255,220,140,0.95)');
  grd.addColorStop(0.5, 'rgba(255,140,40,0.5)');
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(56, 60, 52, 120, 32, 122); g.bezierCurveTo(12, 120, 8, 60, 32, 4); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- procedural textures
export function photoTexture(seed, { scratched = false, people = 2, w = 256, h = 320, sepia = true } = {}) {
  const rnd = mulberry(seed);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  // background: room/sky gradient
  const bg = g.createLinearGradient(0, 0, 0, h);
  const b0 = 140 + rnd() * 60, b1 = 60 + rnd() * 50;
  bg.addColorStop(0, `rgb(${b0},${b0 * 0.92},${b0 * 0.8})`); bg.addColorStop(1, `rgb(${b1},${b1 * 0.9},${b1 * 0.75})`);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // background elements (window/doorframe)
  g.fillStyle = `rgba(30,25,20,${0.2 + rnd() * 0.3})`;
  g.fillRect(w * (0.05 + rnd() * 0.5), h * 0.08, w * 0.25, h * 0.45);
  g.filter = 'blur(1.5px)';
  const faces = [];
  for (let i = 0; i < people; i++) {
    const px = w * ((i + 0.5) / people) + (rnd() - 0.5) * w * 0.12;
    const tall = i === 0 && people > 1 ? 1 : 0.72 + rnd() * 0.2;
    const top = h * (0.3 + (1 - tall) * 0.6);
    const tone = 25 + rnd() * 40;
    g.fillStyle = `rgb(${tone},${tone * 0.9},${tone * 0.8})`;
    // body
    g.beginPath();
    g.moveTo(px - w * 0.16 * tall, h);
    g.quadraticCurveTo(px - w * 0.17 * tall, top + h * 0.14, px - w * 0.06 * tall, top + h * 0.11 * tall);
    g.lineTo(px + w * 0.06 * tall, top + h * 0.11 * tall);
    g.quadraticCurveTo(px + w * 0.17 * tall, top + h * 0.14, px + w * 0.16 * tall, h);
    g.fill();
    // head
    const hr = w * 0.065 * tall + 3;
    const ft = 150 + rnd() * 50;
    g.fillStyle = `rgb(${ft},${ft * 0.85},${ft * 0.72})`;
    g.beginPath(); g.ellipse(px, top + h * 0.04, hr, hr * 1.25, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgb(${tone * 0.5},${tone * 0.45},${tone * 0.4})`;
    g.beginPath(); g.ellipse(px, top + h * 0.04 - hr * 0.55, hr * 1.05, hr * 0.7, 0, Math.PI, Math.PI * 2); g.fill();
    // eyes/mouth smudges
    g.fillStyle = 'rgba(30,20,15,0.7)';
    g.fillRect(px - hr * 0.45, top + h * 0.035, hr * 0.25, hr * 0.15); g.fillRect(px + hr * 0.2, top + h * 0.035, hr * 0.25, hr * 0.15);
    g.fillRect(px - hr * 0.25, top + h * 0.065, hr * 0.5, hr * 0.1);
    faces.push([px, top + h * 0.04, hr]);
  }
  g.filter = 'none';
  // scratching out faces
  if (scratched) {
    for (const [fx, fy, r] of faces) {
      g.strokeStyle = 'rgba(15,8,6,0.95)'; g.lineCap = 'round';
      for (let k = 0; k < 60; k++) {
        g.lineWidth = 1 + rnd() * 3;
        g.beginPath();
        g.moveTo(fx + (rnd() - 0.5) * r * 2.6, fy + (rnd() - 0.5) * r * 3);
        g.lineTo(fx + (rnd() - 0.5) * r * 2.6, fy + (rnd() - 0.5) * r * 3);
        g.stroke();
      }
      g.strokeStyle = 'rgba(230,220,200,0.6)';
      for (let k = 0; k < 14; k++) { g.lineWidth = 0.7; g.beginPath(); g.moveTo(fx + (rnd() - 0.5) * r * 2.4, fy + (rnd() - 0.5) * r * 2.8); g.lineTo(fx + (rnd() - 0.5) * r * 2.4, fy + (rnd() - 0.5) * r * 2.8); g.stroke(); }
    }
  }
  // age: sepia, grain, vignette, scratches
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    const l = 0.3 * r + 0.59 * gg + 0.11 * b;
    if (sepia) { r = l * 1.07 + 18; gg = l * 0.92 + 8; b = l * 0.72; }
    const x = (i / 4) % w, y = (i / 4 / w) | 0;
    const vx = x / w - 0.5, vy = y / h - 0.5;
    const v = 1 - (vx * vx + vy * vy) * 1.6;
    const n = (rnd() - 0.5) * 30;
    d[i] = Math.max(0, Math.min(255, r * v + n)); d[i + 1] = Math.max(0, Math.min(255, gg * v + n)); d[i + 2] = Math.max(0, Math.min(255, b * v + n));
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,250,235,0.35)';
  for (let k = 0; k < 8; k++) { g.lineWidth = 0.6; g.beginPath(); const x = rnd() * w; g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 30, h); g.stroke(); }
  // white border
  g.strokeStyle = 'rgb(225,215,190)'; g.lineWidth = 14; g.strokeRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function drawingTexture(seed, kind = 'family') {
  const rnd = mulberry(seed);
  const w = 512, h = 384;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e0cc'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,100,70,${rnd() * 0.06})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  const crayon = (col, wdt, pts) => {
    g.strokeStyle = col; g.lineWidth = wdt; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let pass = 0; pass < 3; pass++) {
      g.globalAlpha = 0.55; g.beginPath();
      pts.forEach(([x, y], i) => { const jx = x + (rnd() - 0.5) * 3, jy = y + (rnd() - 0.5) * 3; i ? g.lineTo(jx, jy) : g.moveTo(jx, jy); });
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const stick = (x, base, hgt, col, headR = 18, armsLong = false) => {
    const top = base - hgt;
    const pts = []; for (let a = 0; a <= 6.3; a += 0.4) pts.push([x + Math.cos(a) * headR, top + Math.sin(a) * headR]);
    crayon(col, 4, pts);
    crayon(col, 4, [[x, top + headR], [x, base - hgt * 0.35]]);
    crayon(col, 4, [[x, base - hgt * 0.35], [x - hgt * 0.15, base]]);
    crayon(col, 4, [[x, base - hgt * 0.35], [x + hgt * 0.15, base]]);
    const ay = top + headR + hgt * 0.12;
    const al = armsLong ? hgt * 0.75 : hgt * 0.3;
    crayon(col, 4, [[x, ay], [x - hgt * 0.2, ay + al]]);
    crayon(col, 4, [[x, ay], [x + hgt * 0.2, ay + al]]);
    if (armsLong) for (const s of [-1, 1]) for (let f = 0; f < 4; f++) crayon(col, 2, [[x + s * hgt * 0.2, ay + al], [x + s * hgt * 0.2 + s * (f - 1.5) * 6, ay + al + 18]]);
  };
  // ground and sun
  crayon('#3a7a2a', 8, [[0, h - 40], [w, h - 45]]);
  if (kind === 'family') {
    crayon('#e0a020', 6, [[60, 50], [80, 40], [95, 60], [75, 78], [55, 66], [60, 50]]);
    // house
    crayon('#7a3a20', 5, [[300, h - 45], [300, 170], [460, 170], [460, h - 45]]);
    crayon('#7a3a20', 5, [[290, 175], [380, 100], [470, 175]]);
    crayon('#222', 4, [[360, 210], [400, 210], [400, 250], [360, 250], [360, 210]]);
    stick(110, h - 45, 150, '#3050a0');         // mama
    stick(190, h - 45, 90, '#b02030', 14);      // me
    crayon('#222', 3, [[100, 40], [140, 40]]);
    g.fillStyle = '#3050a0'; g.font = 'bold 26px "Comic Sans MS", cursive'; g.fillText('MAMA', 70, h - 12);
    g.fillStyle = '#b02030'; g.fillText('ME', 170, h - 12);
    // the tall one at the window — black, drawn hard
    stick(380, 250, 120, '#111', 12, true);
    g.fillStyle = '#111'; g.font = 'bold 20px "Comic Sans MS", cursive'; g.fillText('the lodger', 330, 140);
  } else if (kind === 'inside') {
    // mama with a tall black thing inside her outline
    stick(250, h - 45, 260, '#3050a0', 30);
    stick(250, h - 70, 200, '#111', 14, true);
    g.fillStyle = '#111'; g.font = 'bold 24px "Comic Sans MS", cursive';
    g.fillText('ITS INSIDE MAMA', 120, 40);
  } else {
    // me in bed, it on the ceiling
    crayon('#7a3a20', 5, [[120, 300], [400, 300], [400, 260], [120, 260], [120, 300]]);
    stick(180, 270, 50, '#b02030', 10);
    crayon('#222', 5, [[60, 30], [450, 30]]);
    // upside down figure
    g.save(); g.translate(300, 30); g.scale(1, -1); stick(0, 0, 150, '#111', 14, true); g.restore();
    g.fillStyle = '#111'; g.font = 'bold 22px "Comic Sans MS", cursive'; g.fillText('it watches when the light is off', 60, 360);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- placements
// [modelId, x, y, z, rotY, opts]
export const PLACEMENTS = [
  // ===== PARLOUR (x -7..-1.25, z 0..6)
  ['vintage_grandfather_clock_01', -6.65, G, 5.25, HALF, { name: 'clock' }],
  ['Sofa_01', -5.7, G, 0.48, 0],
  ['ArmChair_01', -2.2, G, 5.15, -2.5, { name: 'armchair' }],
  ['side_table_01', -1.75, G, 5.6, 0],
  ['vintage_oil_lamp', -1.75, G + 0.55, 5.6, 0.3, { collide: false }],
  ['ClassicConsole_01', -6.62, G, 1.55, HALF, { name: 'console' }],
  ['mantel_clock_01', -6.65, G + 0.95, 1.9, HALF, { collide: false }],
  ['standing_picture_frame_01', -6.65, G + 0.95, 1.2, HALF + 0.3, { collide: false, name: 'momPhoto' }],
  ['ornate_mirror_01', -6.89, G + 1.65, 3.2, HALF, { wall: true, name: 'mirror' }],
  ['hanging_picture_frame_02', -5.7, G + 1.75, 0.11, 0, { wall: true }],
  ['antique_ceramic_vase_01', -1.6, G, 0.45, 0],
  // ===== KITCHEN (x -7..-1.25, z -6..0)
  ['dining_table', -4.1, G, -3.0, 0, { name: 'kitchenTable' }],
  ['dining_chair_02', -4.7, G, -2.15, Math.PI, {}],
  ['dining_chair_02', -3.5, G, -2.15, Math.PI, { name: 'kchair' }],
  ['dining_chair_02', -4.7, G, -3.85, 0, {}],
  ['dining_chair_02', -5.5, G, -3.0, HALF, {}],
  ['painted_wooden_cabinet', -6.15, G, -5.55, 0, { name: 'kitchenCab' }],
  ['electric_stove', -2.0, G, -5.5, 0],
  ['painted_wooden_cabinet', -2.95, G, -5.55, 0],
  ['tea_set_01', -2.95, G + 1.18, -5.55, 0, { collide: false }],
  ['vintage_telephone_wall_clock', -1.36, G + 1.15, -3.3, -HALF, { wall: true, name: 'phone' }],
  ['lantern_chandelier_01', -4.1, GC, -3.0, 0, { collide: false }],
  ['wooden_bucket_01', -6.6, G, -4.4, 0.4],
  ['Lantern_01', -6.1, G + 1.18, -5.55, 0.2, { collide: false }],
  // ===== HALL
  ['ClassicNightstand_01', -0.98, G, 5.2, HALF],
  ['wall_clock', 1.14, G + 2.05, 5.4, -HALF, { wall: true }],
  ['fancy_picture_frame_01', -1.14, G + 1.6, -0.2, HALF, { wall: true, name: 'hallPhoto1' }],
  ['fancy_picture_frame_02', -1.14, G + 1.6, -3.0, HALF, { wall: true, name: 'hallPhoto2' }],
  ['fancy_picture_frame_01', 1.14, G + 1.6, -3.8, -HALF, { wall: true, name: 'hallPhoto3' }],
  ['pull_chain_light_socket', 0, GC, 4.3, 0, { collide: false }],
  ['pull_chain_light_socket', -0.4, GC, -3.6, 0, { collide: false }],
  ['rubber_boots', 0.75, G, 5.55, Math.PI, { collide: false }],
  // ===== DINING (x 1.25..7, z 0..6)
  ['dining_table', 4.3, G, 3.1, 0, { name: 'diningTable' }],
  ['dining_chair_02', 3.5, G, 3.95, Math.PI],
  ['dining_chair_02', 4.6, G, 3.95, Math.PI],
  ['dining_chair_02', 3.5, G, 2.25, 0],
  ['dining_chair_02', 4.6, G, 2.25, 0, { name: 'dchair' }],
  ['dining_chair_02', 5.7, G, 3.1, -HALF],
  ['Chandelier_01', 4.3, GC, 3.1, 0, { collide: false }],
  ['GothicCabinet_01', 6.35, G, 1.4, -HALF, { occlude: true }],
  ['vintage_cabinet_01', 2.45, G, 0.45, 0, { occlude: true, shrink: 0.95 }],
  ['hanging_picture_frame_01', 6.89, G + 1.6, 4.6, -HALF, { wall: true }],
  // ===== BACK ROOM (x 1.25..5.8, z -6..0)
  ['wheelchair_01', 3.0, G, -2.2, 2.3, { name: 'wheelchair' }],
  ['wooden_bookshelf_worn', 3.4, G, -5.6, 0, { occlude: true }],
  ['painted_wooden_cabinet', 5.15, G, -3.0, -HALF, { name: 'tvStand' }],
  ['television_02', 5.15, G + 1.18, -3.0, -HALF, { collide: false, name: 'tv' }],
  ['vintage_suitcase', 2.1, G, -0.4, Math.PI, { shrink: 0.8 }],
  ['spinning_wheel_01', 1.9, G, -5.2, 0.6],
  // ===== BASEMENT (y -3)
  ['steel_frame_shelves_01', 6.55, B, 3.0, -HALF, { occlude: false }],
  ['steel_frame_shelves_01', 6.55, B, 1.6, -HALF],
  ['Barrel_01', 5.6, B, 5.3, 0],
  ['Barrel_01', 6.3, B, 4.8, 1],
  ['wooden_crate_01', 3.0, B, 5.6, 0.1],
  ['wooden_crate_01', 3.0, B, 5.6, 0.25, { collide: false, y: 0.35 }],
  ['cardboard_box_01', 4.2, B, 5.6, 0.4],
  ['cardboard_box_01', 1.6, B, -5.5, 0.2],
  ['barrel_stove', -0.6, B, -4.5, 0.3, { name: 'furnace' }],
  ['power_box_01', -6.88, B + 1.5, -3.8, HALF, { wall: true, name: 'fusebox' }],
  ['tool_cart', -2.2, B, 5.5, Math.PI, { name: 'workbench' }],
  ['bench_vice_01', -2.6, B + 0.96, 5.5, Math.PI, { collide: false }],
  ['metal_toolbox', -1.7, B + 0.96, 5.55, Math.PI + 0.2, { collide: false }],
  ['hatchet', -2.1, B + 0.96, 5.35, 1.2, { collide: false }],
  ['old_gas_mask', -3.4, BC - 0.2, 3.0, 0.4, { collide: false }],
  ['wooden_ladder', -6.7, B, 0.6, HALF, { tilt: [0, -0.25] }],
  ['old_bed_frame', -5.6, B, -0.6, 0, { name: 'cellarBed' }],
  ['metal_tool_chest', -6.4, B, 5.4, 0.2],
  ['crowbar_01', -6.0, B + 0.3, 5.0, 0, { collide: false, tilt: [1.4, 0] }],
  ['wooden_stool_01', -3.0, B, 4.9, 0.8],
  ['mousetrap', 2.2, B, -2.0, 0.3, { collide: false }],
  ['mousetrap', -4.4, B, 2.7, 1.3, { collide: false }],
  ['pull_chain_light_socket', 4.0, BC, -3.5, 0, { collide: false }],
  ['pull_chain_light_socket', 3.6, BC, 3.0, 0, { collide: false }],
  ['pull_chain_light_socket', -3.4, BC, 0.5, 0, { collide: false }],
  ['pull_chain_light_socket', -3.6, BC, -4.0, 0, { collide: false }],
  // ===== MOTHER'S ROOM (U, x -7..-1.25, z 0..6)
  ['GothicBed_01', -5.85, U, 3.1, HALF, { name: 'bedM' }],
  ['ClassicNightstand_01', -6.6, U, 1.6, HALF, { name: 'nightstand' }],
  ['ClassicNightstand_01', -6.6, U, 4.6, HALF],
  ['vintage_oil_lamp', -6.6, U + 0.7, 4.6, 0, { collide: false }],
  ['GothicCabinet_01', -2.75, U, 5.35, Math.PI, { occlude: true, name: 'wardrobeM' }],
  ['Rockingchair_01', -2.2, U, 0.9, -2.4, { name: 'rocker' }],
  ['GothicCommode_01', -4.2, U, 0.45, 0, { occlude: false }],
  ['ornate_mirror_01', -4.2, U + 1.65, 0.11, 0, { wall: true }],
  ['wall_clock', -6.89, U + 1.9, 3.1, HALF, { wall: true }],
  // ===== SEWING ROOM (U, x 1.25..7, z -6..0)
  ['spinning_wheel_01', 3.8, U, -3.4, -0.5],
  ['wicker_basket_01', 4.4, U, -2.8, 0.3, { collide: false }],
  ['treasure_chest', 6.4, U, -4.8, -HALF],
  ['vintage_suitcase', 2.3, U, -0.35, Math.PI],
  ['painted_wooden_bench', 5.2, U, -0.4, Math.PI],
  ['drawer_cabinet', 6.6, U, -1.6, -HALF, { occlude: true }],
  // ===== YOUR OLD ROOM (U, x 1.25..7, z 0..6)
  ['old_bed_frame', 6.3, U, 4.4, Math.PI, { name: 'childBed' }],
  ['vintage_cabinet_01', 4.0, U, 0.45, 0, { occlude: true, name: 'wardrobeC', shrink: 0.95 }],
  ['Shelf_01', 6.75, U, 1.6, -HALF],
  ['horse_statue_01', 6.75, U + 1.25, 1.4, -HALF + 0.5, { collide: false }],
  ['wooden_stool_01', 2.6, U, 5.2, 0.3],
  ['treasure_chest', 2.3, U, 1.3, HALF, { name: 'toyChest' }],
  ['standing_picture_frame_01', 6.75, U + 0.84, 1.8, -HALF, { collide: false }],
  // ===== UPSTAIRS HALL
  ['pull_chain_light_socket', -0.4, UC, -3.6, 0, { collide: false }],
  ['pull_chain_light_socket', -0.4, UC, 1.5, 0, { collide: false }],
  ['fancy_picture_frame_02', -1.14, U + 1.6, -4.6, HALF, { wall: true }],
  ['hanging_picture_frame_02', 1.14, U + 1.6, 5.1, -HALF, { wall: true, name: 'landingFrame' }],
  // ===== ATTIC (A)
  ['cardboard_box_01', -1.8, A, 4.2, 0.3],
  ['cardboard_box_01', -1.8, A + 0.34, 4.2, 0.6, { collide: false }],
  ['cardboard_box_01', 1.9, A, 2.0, 1.1],
  ['vintage_suitcase', 1.7, A, -1.0, HALF + 0.2],
  ['wooden_crate_01', -1.9, A, -0.6, HALF],
  ['Rockingchair_01', 1.5, A, -4.2, -2.6, { name: 'atticRocker' }],
  ['treasure_chest', -1.8, A, 1.4, HALF],
  ['wheelchair_01', -1.6, A, -2.6, 0.9],
];
