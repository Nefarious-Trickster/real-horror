import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL + 'assets/textures/';
const loader = new THREE.TextureLoader();

// Fallback tints when a texture set is missing.
const FALLBACK = {
  floor_wood: { color: 0x3a2a1e, rough: 0.7, size: 2 },
  wall_plaster: { color: 0x9a948a, rough: 0.9, size: 2 },
  wallpaper: { color: 0x6c705a, rough: 0.85, size: 1 },
  ceiling_plaster: { color: 0x8e8a82, rough: 0.95, size: 2 },
  wood_trim: { color: 0x2a1a10, rough: 0.5, size: 1 },
  concrete_floor: { color: 0x55524d, rough: 0.95, size: 2 },
  brick_wall: { color: 0x5a3a30, rough: 0.95, size: 2 },
  attic_planks: { color: 0x5a4632, rough: 0.9, size: 2 },
  roof_rafters: { color: 0x4a3828, rough: 0.9, size: 2 },
  tiles_kitchen: { color: 0x8a8678, rough: 0.4, size: 1 },
  carpet: { color: 0x4a2422, rough: 1.0, size: 1.5 },
  metal_rust: { color: 0x5a4a3a, rough: 0.7, size: 1 },
  siding: { color: 0x5c5a55, rough: 0.9, size: 2 },
};

export class Materials {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.cache = new Map();
    this.manifest = {};
  }

  async init() {
    try {
      const r = await fetch(BASE + 'manifest.json');
      const m = await r.json();
      this.manifest = m.textures || m;
    } catch (e) { this.manifest = {}; }
  }

  entry(name) {
    const e = this.manifest[name];
    if (!e) return null;
    // accept {maps:[..]|{diff:..}, size:n|[w,h]}
    let maps = e.maps || e.files || e;
    if (Array.isArray(maps)) maps = Object.fromEntries(maps.map((k) => [k, `${name}/${k}.jpg`]));
    let size = e.size ?? e.tile ?? e.tileSize ?? e.realSize ?? 2;
    if (Array.isArray(size)) size = size[0];
    return { maps, size: +size || 2, dir: e.dir || name };
  }

  tex(path, srgb, repeat) {
    const t = loader.load(BASE + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = this.maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  mapPath(e, key, name) {
    const v = e.maps[key];
    if (!v) return null;
    if (typeof v === 'string') return v.includes('/') ? v : `${name}/${v}`;
    return `${name}/${key}.jpg`;
  }

  // Returns a MeshStandardMaterial whose maps expect UVs in metres.
  get(name, opts = {}) {
    const key = name + JSON.stringify(opts);
    if (this.cache.has(key)) return this.cache.get(key);
    const fb = FALLBACK[name] || { color: 0x777777, rough: 0.8, size: 2 };
    const e = this.entry(name);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    if (e) {
      const rep = 1 / (opts.size || e.size);
      const pick = (...keys) => { for (const k of keys) { const p = this.mapPath(e, k, name); if (p) return p; } return null; };
      const d = pick('diff', 'diffuse', 'albedo', 'color');
      const n = pick('nor', 'normal', 'nor_gl');
      const r = pick('rough', 'roughness');
      const ao = pick('ao', 'arm');
      if (d) mat.map = this.tex(d, true, rep);
      if (n) { mat.normalMap = this.tex(n, false, rep); mat.normalScale.set(1, 1); }
      if (r) mat.roughnessMap = this.tex(r, false, rep);
      if (ao) { mat.aoMap = this.tex(ao, false, rep); mat.aoMapIntensity = 0.8; }
      if (opts.tint) mat.color.set(opts.tint);
    } else {
      mat.color.set(opts.tint || fb.color);
      mat.map = noiseTexture(fb.color, opts.size || fb.size);
      mat.roughness = fb.rough;
    }
    if (opts.rough != null) mat.roughness = opts.rough;
    if (opts.metal != null) mat.metalness = opts.metal;
    if (opts.side) mat.side = opts.side;
    if (opts.envMapIntensity != null) mat.envMapIntensity = opts.envMapIntensity;
    mat.name = name;
    this.cache.set(key, mat);
    return mat;
  }
}

function noiseTexture(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size, 1 / size);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Assign UVs in metres from world-space positions, chosen per face normal.
export function worldUV(geo, rotateU = false) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; if (rotateU) { u = z; v = x; } }
    else if (ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
