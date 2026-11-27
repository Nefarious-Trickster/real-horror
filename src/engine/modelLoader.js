import * as THREE from 'three';

// Loads .glb directly, or a self-contained ".gltf.json" (base64-embedded glTF)
// WITHOUT fetching any data: URL: the JSON is fetched as text, its buffers and
// images are decoded here and repacked into an in-memory GLB that the loader
// parses. Needed on hosts whose CSP forbids fetch() of data: URLs and that
// won't serve .glb files.

// Images: use <img>-based TextureLoader (blob: images) instead of
// ImageBitmapLoader, which fetch()es the blob URL and can be blocked by CSP.
export function hardenLoader(loader) {
  if (loader.__hardened) return loader;
  loader.__hardened = true;
  loader.register((parser) => {
    const tl = new THREE.TextureLoader(parser.options.manager);
    tl.setCrossOrigin(parser.options.crossOrigin);
    parser.textureLoader = tl;
    return { name: 'vigil_img_textures' };
  });
  return loader;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function dataUri(uri) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri || '');
  if (!m) return null;
  return { mime: m[1] || 'application/octet-stream', bytes: m[2] ? b64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])) };
}

export function gltfJsonToGlb(json) {
  const chunks = []; let total = 0;
  const push = (bytes) => { const off = total; chunks.push(bytes); total += bytes.length; const pad = (4 - (total % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); total += pad; } return off; };
  const bufferBase = [];
  for (const [i, b] of (json.buffers || []).entries()) {
    const d = dataUri(b.uri);
    if (!d) throw new Error('external buffer not supported: ' + b.uri);
    bufferBase[i] = push(d.bytes);
  }
  for (const bv of json.bufferViews || []) { bv.byteOffset = (bv.byteOffset || 0) + bufferBase[bv.buffer]; bv.buffer = 0; }
  json.bufferViews = json.bufferViews || [];
  for (const im of json.images || []) {
    const d = dataUri(im.uri);
    if (!d) continue;
    const off = push(d.bytes);
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: d.bytes.length });
    im.bufferView = json.bufferViews.length - 1; im.mimeType = im.mimeType || d.mime; delete im.uri;
  }
  json.buffers = [{ byteLength: total }];
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  const glb = new Uint8Array(12 + 8 + jsonBytes.length + jpad + 8 + total);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jsonBytes.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonBytes, 20); glb.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jpad);
  let o = 20 + jsonBytes.length + jpad;
  dv.setUint32(o, total, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { glb.set(c, o); o += c.length; }
  return glb.buffer;
}

export async function loadModel(loader, url) {
  hardenLoader(loader);
  if (!/\.gltf\.json$/.test(url)) return loader.loadAsync(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const glb = gltfJsonToGlb(await res.json());
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  return loader.parseAsync(glb, base);
}
