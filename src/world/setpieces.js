import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LV } from './house.js';
import { photoTexture, drawingTexture, mulberry } from './props.js';

const { B, BC, G, GC, U, UC, A } = LV;

// ---------------------------------------------------------------- cloth heightfields
function ellipsoidTop(e, x, z) {
  const dx = (x - e[0]) / e[3], dz = (z - e[2]) / e[5];
  const q = 1 - dx * dx - dz * dz;
  return q > 0 ? e[1] + e[4] * Math.sqrt(q) : -1;
}

function bodyParts(state) {
  const turned = state === 'turned';
  return [
    [-0.78, 0.12, turned ? 0.03 : 0, 0.11, 0.1, 0.1],                         // head
    turned ? [-0.8, 0.17, 0.1, 0.03, 0.04, 0.03] : [-0.79, 0.21, 0, 0.03, 0.035, 0.025], // nose
    [-0.62, 0.08, 0, 0.06, 0.05, 0.06],                                         // neck
    [-0.38, 0.09, 0, 0.25, 0.12, 0.21],                                         // chest
    [-0.26, 0.2, 0.0, 0.07, 0.045, 0.11],                                       // folded hands
    [-0.02, 0.08, 0, 0.2, 0.1, 0.19],                                           // hips
    [0.36, 0.07, 0.085, 0.34, 0.075, 0.075], [0.36, 0.07, -0.085, 0.34, 0.075, 0.075], // legs
    [0.8, 0.1, 0.08, 0.05, 0.11, 0.05], [0.8, 0.1, -0.08, 0.05, 0.11, 0.05],     // feet
  ];
}

function clothGeometry(w, l, nx, nz, heightAt, { sag = 0.003, iters = 30, edge = null, seed = 7 } = {}) {
  const geo = new THREE.PlaneGeometry(l, w, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = nx + 1, rows = nz + 1;
  const base = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) base[i] = heightAt(pos.getX(i), pos.getZ(i));
  let h = Float32Array.from(base);
  for (let k = 0; k < iters; k++) {
    const n = new Float32Array(h.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let s = 0, cnt = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        s += h[rr * cols + cc]; cnt++;
      }
      n[i] = Math.max(base[i], s / cnt - sag);
      if (edge) n[i] = Math.min(n[i], edge(pos.getX(i), pos.getZ(i), n[i]));
    }
    h = n;
  }
  const rnd = mulberry(seed);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const wr = Math.sin(x * 23 + z * 7 + ph[0]) * 0.0035 + Math.sin(x * 9 - z * 31 + ph[1]) * 0.003 + Math.sin(x * 41 + ph[2]) * 0.0015;
    pos.setY(i, h[i] + wr);
  }
  geo.computeVertexNormals();
  return geo;
}

function sheetMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: 0x9c968a, roughness: 0.95, sheen: 0.25, sheenColor: new THREE.Color(0xd8d0c0), sheenRoughness: 0.9, side: THREE.DoubleSide });
}

// ---------------------------------------------------------------- handwriting texture
export function noteTexture(lines, { w = 512, h = 640, paper = '#d9d0bb', ink = '#1c1a2a' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = paper; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  const stain = g.createRadialGradient(w * 0.7, h * 0.8, 10, w * 0.7, h * 0.8, w * 0.4);
  stain.addColorStop(0, 'rgba(120,90,40,0.18)'); stain.addColorStop(1, 'rgba(120,90,40,0)');
  g.fillStyle = stain; g.fillRect(0, 0, w, h);
  g.fillStyle = ink; g.font = `${Math.round(w / 17)}px "Homemade Apple", "Caveat", cursive`;
  let y = h * 0.12;
  for (const ln of lines) { g.save(); g.translate(w * 0.08, y); g.rotate((Math.random() - 0.5) * 0.02); g.fillText(ln, 0, 0); g.restore(); y += w / 11; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ======================================================================
export function buildSetpieces(game) {
  const { scene, mats, props } = game;
  const SP = { hideSpots: [], batteries: [] };
  const wood = mats.get('wood_trim');
  const darkWood = new THREE.MeshPhysicalMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, color: 0x5a3a28, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 1, roughness: 0.35 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x202020, metalness: 0.8, roughness: 0.6 });
  const wax = new THREE.MeshPhysicalMaterial({ color: 0xe8dcc4, roughness: 0.55, transmission: 0, sheen: 0.3, emissive: new THREE.Color(0x221100), emissiveIntensity: 0 });

  // ---------------------------------------------------------- the casket (parlour)
  {
    const grp = new THREE.Group();
    const cx = -4.3, cz = 3.25;
    grp.position.set(cx, G, cz);
    // bier with a velvet drape
    const velvet = new THREE.MeshPhysicalMaterial({ color: 0x2a0608, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(0x8a2020), sheenRoughness: 0.5 });
    const bier = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.62, 0.72, 2, 0.04), velvet);
    bier.position.y = 0.31; bier.castShadow = bier.receiveShadow = true; grp.add(bier);
    // coffin hexagon
    const outer = [[-1, -0.22], [-0.55, -0.32], [1, -0.16], [1, 0.16], [-0.55, 0.32], [-1, 0.22]];
    const inner = outer.map(([x, z]) => [x * 0.955, z * 0.84]);
    const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z)));
    shape.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, z)).reverse()));
    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
    wallGeo.rotateX(-Math.PI / 2);
    const walls = new THREE.Mesh(wallGeo, darkWood); walls.position.y = 0.64; walls.castShadow = walls.receiveShadow = true; grp.add(walls);
    const floorGeo = new THREE.ExtrudeGeometry(new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z))), { depth: 0.04, bevelEnabled: false });
    floorGeo.rotateX(-Math.PI / 2);
    const fl = new THREE.Mesh(floorGeo, darkWood); fl.position.y = 0.62; grp.add(fl);
    const satin = new THREE.MeshPhysicalMaterial({ color: 0xcfc4b0, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(0xfff4e0), sheenRoughness: 0.3, side: THREE.DoubleSide });
    const lining = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inner.map(([x, z]) => new THREE.Vector2(x, z)))), satin);
    lining.rotation.x = -Math.PI / 2; lining.position.y = 0.67; grp.add(lining);
    const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.08, 0.36, 3, 0.035), satin);
    pillow.position.set(-0.8, 0.71, 0); grp.add(pillow);
    // brass handles
    for (const x of [-0.6, 0, 0.55]) for (const s of [-1, 1]) {
      const zEdge = x < -0.55 ? 0.3 : 0.3 - (x + 0.55) / 1.55 * 0.15;
      const hnd = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), brass);
      hnd.position.set(x, 0.75, s * (zEdge + 0.03)); hnd.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; hnd.rotation.z = Math.PI; grp.add(hnd);
    }
    // the lid, leaning against the wall behind
    const lidGeo = new THREE.ExtrudeGeometry(new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z))), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2 });
    lidGeo.rotateZ(Math.PI / 2); lidGeo.rotateY(Math.PI / 2);
    const lid = new THREE.Mesh(lidGeo, darkWood);
    lid.position.set(-6.76, G + 1.0, 4.45); lid.rotation.z = 0.09; lid.castShadow = true; lid.receiveShadow = true;
    scene.add(lid);
    // the body under the sheet
    const sheetMat = sheetMaterial();
    const build = (state) => {
      const parts = state === 'empty' ? [] : bodyParts(state);
      const H = (x, z) => {
        let h = 0.075;
        if (x < -0.66 && Math.abs(z) < 0.17) h = 0.11;   // pillow
        for (const e of parts) h = Math.max(h, ellipsoidTop(e, x, z));
        return h;
      };
      return clothGeometry(0.5, 1.86, 90, 30, H, { sag: 0.0045, iters: 10, seed: state === 'turned' ? 3 : 7, edge: (x, z, h) => (Math.abs(z) > 0.23 || Math.abs(x) > 0.9 ? Math.min(h, 0.09) : h) });
    };
    const sheet = new THREE.Mesh(build('rest'), sheetMat);
    sheet.position.y = 0.64; sheet.castShadow = true; sheet.receiveShadow = true;
    grp.add(sheet);
    grp.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(grp);
    // crumpled sheet for later (on the floor)
    const crumple = clothGeometry(1.3, 1.6, 40, 34, (x, z) => {
      let h = 0.005;
      const r = mulberry(11);
      for (let i = 0; i < 14; i++) { const bx = (r() - 0.5) * 1.1, bz = (r() - 0.5) * 0.9, br = 0.12 + r() * 0.2, bh = 0.03 + r() * 0.09; const d = Math.hypot(x - bx, z - bz); if (d < br) h = Math.max(h, bh * Math.cos(d / br * Math.PI / 2)); }
      return h;
    }, { sag: 0.004, iters: 10, seed: 19 });
    const floorSheet = new THREE.Mesh(crumple, sheetMat);
    floorSheet.position.set(-2.6, G, 1.6); floorSheet.rotation.y = 0.7; floorSheet.visible = false; floorSheet.castShadow = true;
    scene.add(floorSheet);
    SP.casket = {
      group: grp, sheet, floorSheet, state: 'rest', pos: new THREE.Vector3(cx, G, cz),
      setState(s) {
        this.state = s;
        if (s === 'empty') { sheet.visible = false; floorSheet.visible = true; }
        else { sheet.visible = true; floorSheet.visible = false; sheet.geometry.dispose(); sheet.geometry = build(s); }
      },
    };
    // pinned instructions note on the casket
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshStandardMaterial({ map: noteTexture(['Keep the candles lit.', 'Keep the doors shut.', '', 'If you hear me call', 'for you — I won\'t.', "Don't come."]), roughness: 0.9 }));
    note.position.set(cx + 0.98, G + 0.62, cz + 0.05); note.rotation.set(0, Math.PI / 2, 0); note.rotation.order = 'YXZ'; note.rotation.x = -0.2;
    scene.add(note); SP.casketNote = note;
  }

  // ---------------------------------------------------------- ritual candles (3 stands)
  SP.candles = [];
  const candleSpots = [[-5.65, 3.25], [-3.6, 2.45], [-3.6, 4.05]];
  for (const [x, z] of candleSpots) {
    const grp = new THREE.Group(); grp.position.set(x, G, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.15, 8), iron); pole.position.y = 0.6; grp.add(pole);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 6), iron);
      const a = i * Math.PI * 2 / 3; leg.position.set(Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1); leg.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); grp.add(leg);
    }
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.02, 16), iron); pan.position.y = 1.18; grp.add(pan);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.26, 14), wax); candle.position.y = 1.32; grp.add(candle);
    // drips
    for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), wax); d.scale.y = 3; const a = Math.random() * 6.28; d.position.set(Math.cos(a) * 0.027, 1.38 - Math.random() * 0.08, Math.sin(a) * 0.027); grp.add(d); }
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(grp);
    const flame = props.flame(x, G + 1.46, z, { lit: false, size: 1.2 });
    SP.candles.push({ group: grp, flame, get lit() { return flame.lit; } });
  }

  // ---------------------------------------------------------- matches (console)
  {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.035), new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.8 }));
    box.position.set(-6.55, G + 0.955, 1.7); box.rotation.y = 0.4; box.castShadow = true; scene.add(box);
    SP.matches = box;
  }

  // ---------------------------------------------------------- refrigerator
  {
    const enamel = new THREE.MeshPhysicalMaterial({ color: 0xcfc7b0, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.3 });
    const f = new THREE.Mesh(new RoundedBoxGeometry(0.72, 1.62, 0.7, 4, 0.08), enamel);
    f.position.set(-6.5, G + 0.81, -0.75); f.castShadow = f.receiveShadow = true; scene.add(f);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.04), brass); h.position.set(-6.13, G + 1.15, -0.5); scene.add(h);
    game.house.collider(-6.86, G, -1.1, -6.14, G + 1.62, -0.4, 'prop', false);
    SP.fridge = f;
  }

  // ---------------------------------------------------------- flashlight drawer (kitchen cabinet) — a hitbox
  SP.kitchenDrawer = game.interact.hitbox(-6.15, G + 0.95, -5.22, 1.1, 0.25, 0.1);

  // ---------------------------------------------------------- fuse on the workbench
  {
    const grp = new THREE.Group();
    const cer = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 14), new THREE.MeshStandardMaterial({ color: 0xe6e0d0, roughness: 0.4 }));
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.014, 12), brass); thread.position.y = -0.017;
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.1, metalness: 0.5 })); win.rotation.x = -Math.PI / 2; win.position.y = 0.0115;
    grp.add(cer, thread, win);
    // little tin it sits in
    const tin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.08), new THREE.MeshStandardMaterial({ color: 0x5a6a5a, metalness: 0.7, roughness: 0.5 })); tin.position.set(0.0, -0.03, 0);
    grp.add(tin);
    grp.position.set(-1.55, B + 0.99, 5.42);
    scene.add(grp);
    SP.fuse = grp;
    SP.fuseHit = game.interact.hitbox(-1.55, B + 1.0, 5.42, 0.25, 0.12, 0.2);
    SP.fuseboxHit = game.interact.hitbox(-6.7, B + 1.5, -3.8, 0.3, 0.6, 0.55);
  }

  // ---------------------------------------------------------- diary on mother's nightstand
  {
    const grp = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.21), new THREE.MeshStandardMaterial({ color: 0x3a1a14, roughness: 0.7 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.024, 0.2), new THREE.MeshStandardMaterial({ color: 0xd8ceb4, roughness: 0.9 }));
    pages.position.x = 0.004; grp.add(cover, pages);
    grp.position.set(-6.55, U + 0.715, 1.55); grp.rotation.y = 0.3;
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(grp); SP.diary = grp;
  }

  // ---------------------------------------------------------- attic pole (in toy chest, child room)
  {
    const pole = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.4, 8), mats.get('wood_trim', { tint: 0xc0a080 }));
    shaft.rotation.z = Math.PI / 2; pole.add(shaft);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 6, 12, Math.PI * 1.4), iron);
    hook.position.set(0.72, 0.03, 0); hook.rotation.z = -0.8; pole.add(hook);
    pole.position.set(2.3, U + 0.5, 1.3); pole.rotation.y = Math.PI / 2 + 0.1;
    pole.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(pole); SP.pole = pole;
    SP.toyChestHit = game.interact.hitbox(2.3, U + 0.45, 1.3, 0.6, 0.5, 1.0);
  }

  // ---------------------------------------------------------- attic hatch + ladder
  {
    const pivot = new THREE.Group(); pivot.position.set(-0.5, UC, 4.9);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.04, 1.58), mats.get('ceiling_plaster'));
    panel.position.set(0, 0.02, -0.79); pivot.add(panel);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.35, 4), new THREE.MeshStandardMaterial({ color: 0x777060 }));
    cord.position.set(0, -0.17, -1.45); pivot.add(cord);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 12), brass); ring.position.set(0, -0.36, -1.45); pivot.add(ring);
    scene.add(pivot);
    const ladder = new THREE.Group();
    const lw = mats.get('wood_trim', { tint: 0xc8aa80 });
    const len = Math.hypot(2.0, 2.8), ang = Math.atan2(2.8, 2.0);
    for (const x of [-0.38, 0.38]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, len), lw); r.position.x = x; ladder.add(r); }
    for (let i = 0; i < 11; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.03, 0.07), lw); r.position.set(0, 0, -len / 2 + (i + 0.5) * len / 11); ladder.add(r); }
    ladder.rotation.x = -ang; ladder.position.set(-0.5, (U + A) / 2 - 0.08, 3.9);
    ladder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    ladder.visible = false; scene.add(ladder);
    SP.hatch = { pivot, ladder, open: false, t: 0 };
    SP.hatchHit = game.interact.hitbox(-0.5, UC - 0.25, 3.6, 1.0, 0.5, 1.2);
    SP.hatchBlock = game.house.collider(-1.0, UC - 0.1, 3.3, 0.0, UC + 0.2, 4.9, 'hatch', true);
  }

  // ---------------------------------------------------------- dress form (sewing room)
  {
    const pts = [[0.0, 1.6], [0.045, 1.58], [0.05, 1.52], [0.16, 1.45], [0.17, 1.38], [0.165, 1.28], [0.13, 1.14], [0.12, 1.08], [0.16, 0.96], [0.185, 0.88], [0.17, 0.8], [0.0, 0.8]].map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 0.95 }));
    body.scale.z = 0.72;
    const grp = new THREE.Group(); grp.add(body);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 8), iron); pole.position.y = 0.4; grp.add(pole);
    for (let i = 0; i < 3; i++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.03), iron); leg.rotation.y = i * 2.09; leg.position.y = 0.02; grp.add(leg); }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mats.get('wood_trim')); cap.position.y = 1.61; grp.add(cap);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    grp.position.set(5.6, U, -4.6); grp.rotation.y = -0.6;
    scene.add(grp); SP.dressForm = grp;
    SP.dressFormCol = game.house.collider(5.4, U, -4.8, 5.8, U + 1.6, -4.4, 'prop', false);
  }

  // ---------------------------------------------------------- music box (child room shelf)
  {
    const grp = new THREE.Group();
    const bx = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.11), darkWood); bx.position.y = 0.035; grp.add(bx);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.11), darkWood); lid.position.set(0, 0.075, -0.055); lid.geometry.translate(0, 0, 0.055); lid.rotation.x = -1.9; grp.add(lid);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 1, roughness: 0.1 })); mirror.position.set(0, 0.08, -0.09); mirror.rotation.x = -0.4; grp.add(mirror);
    const dancer = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xe0c0c0, roughness: 0.6 })); dancer.position.y = 0.095; grp.add(dancer);
    grp.position.set(6.75, U + 0.86, 1.35); grp.rotation.y = -Math.PI / 2;
    scene.add(grp); SP.musicBox = { group: grp, dancer, lid };
  }

  // ---------------------------------------------------------- child drawings, photos
  const pin = (tex, x, y, z, ry, w, h, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.position.set(x, y, z); m.rotation.set(0, ry, tilt); m.receiveShadow = true; scene.add(m); return m;
  };
  SP.drawings = [
    pin(drawingTexture(1, 'family'), 6.88, U + 1.55, 3.0, -Math.PI / 2, 0.42, 0.32, 0.04),
    pin(drawingTexture(2, 'ceiling'), 6.88, U + 1.45, 4.0, -Math.PI / 2, 0.42, 0.32, -0.05),
    pin(drawingTexture(3, 'inside'), 4.6, U + 1.5, 5.88, Math.PI, 0.42, 0.32, 0.02),
  ];
  // family photos in the hall frames: two textures, swapped to scratched later
  SP.photoSwaps = [];
  const photoFor = (name, w, h, seed) => {
    const fr = props.items.get(name); if (!fr) return;
    const clean = photoTexture(seed, { people: 2 }), scratched = photoTexture(seed, { people: 2, scratched: true });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: clean, roughness: 0.6 }));
    m.position.set(0, 0, 0.02); fr.add(m);
    SP.photoSwaps.push({ mesh: m, clean, scratched });
  };
  photoFor('landingFrame', 0.55, 0.32, 41);
  // the covered mirror: a black cloth
  {
    const mir = props.items.get('mirror');
    const cloth = new THREE.Mesh(clothGeometry(0.62, 0.9, 20, 14, (x, z) => 0.01 + Math.max(0, 0.03 - Math.abs(z) * 0.02), { sag: 0.0, iters: 2, seed: 4 }), new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x303040), side: THREE.DoubleSide }));
    cloth.geometry.rotateZ(-Math.PI / 2);
    cloth.position.set(-6.88, G + 1.62, 3.2);
    scene.add(cloth); SP.mirrorCloth = cloth;
  }

  // ---------------------------------------------------------- attic shrine
  {
    const sh = new THREE.Group();
    // photos on the north gable and on strings
    const rnd = mulberry(77);
    for (let i = 0; i < 26; i++) {
      const tex = photoTexture(100 + i, { scratched: true, people: 1 + ((rnd() * 2) | 0) });
      const w = 0.16 + rnd() * 0.08, h = w * 1.25;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      m.position.set((rnd() - 0.5) * 3.2, A + 0.6 + rnd() * 1.4, -5.88); m.rotation.z = (rnd() - 0.5) * 0.5; sh.add(m);
    }
    for (let s = 0; s < 3; s++) {
      const z = -4.9 + s * 0.6, y = A + 1.9 - s * 0.05;
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 3.6, 4), new THREE.MeshStandardMaterial({ color: 0x504a40 }));
      str.rotation.z = Math.PI / 2; str.position.set(0, y, z); sh.add(str);
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.19), new THREE.MeshStandardMaterial({ map: photoTexture(200 + s * 10 + i, { scratched: true, people: 1 }), roughness: 0.7, side: THREE.DoubleSide }));
        m.position.set(-1.5 + i * 0.5 + (rnd() - 0.5) * 0.1, y - 0.12, z); m.rotation.y = (rnd() - 0.5) * 0.8; m.rotation.z = (rnd() - 0.5) * 0.2; sh.add(m);
      }
    }
    // the shrouded body on the floor
    const parts = bodyParts('rest');
    const geo = clothGeometry(0.9, 2.1, 80, 36, (x, z) => { let h = 0.018; for (const e of parts) h = Math.max(h, ellipsoidTop(e, x, z) - 0.04); return h; }, { sag: 0.008, iters: 14, seed: 33 });
    const body = new THREE.Mesh(geo, sheetMaterial());
    body.rotation.y = Math.PI / 2 + 0.1; body.position.set(0, A, -4.2); body.castShadow = true; body.receiveShadow = true;
    sh.add(body);
    // ring of candlesticks with flames
    SP.atticFlames = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = Math.cos(a) * 1.05, z = -4.2 + Math.sin(a) * 1.25;
      const cs = props.place('wooden_candlestick', x, A, z, a, { collide: false });
      const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.08 + rnd() * 0.08, 8), wax);
      cnd.position.set(x, A + 0.24, z); sh.add(cnd);
      SP.atticFlames.push(props.flame(x, A + 0.3 + 0.02, z, { lit: false, size: 0.8, light: i % 3 === 0 }));
    }
    scene.add(sh);
    SP.shrine = { group: sh, body };
    // key on the body's chest
    const key = new THREE.Group();
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 16), brass); key.add(bow);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 8), brass); shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.052; key.add(shaft);
    for (const [x, h] of [[0.075, 0.012], [0.065, 0.008]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.005, h, 0.004), brass); t.position.set(x, -h / 2, 0); key.add(t); }
    key.position.set(0.03, A + 0.2, -4.55); key.rotation.set(-Math.PI / 2, 0, 0.6);
    scene.add(key); SP.key = key;
    SP.keyHit = game.interact.hitbox(0.03, A + 0.2, -4.5, 0.3, 0.2, 0.3);
  }

  // ---------------------------------------------------------- battery packs
  const battSpots = [[2.45, G + 2.25, 0.45], [5.2, U + 0.9, -0.4], [6.55, B + 1.12, 3.0], [-1.8, A + 0.62, 1.4], [-2.9, G + 1.18, -5.5]];
  for (const [x, y, z] of battSpots) {
    const b = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0xb04a10, roughness: 0.7 }));
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.091, 0.02, 0.061), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
    b.add(box, label); b.position.set(x, y + 0.025, z); b.rotation.y = Math.random() * 3; scene.add(b);
    SP.batteries.push(b);
  }

  // ---------------------------------------------------------- hiding spots
  SP.hideSpots.push({ id: 'wardrobeM', pos: new THREE.Vector3(-2.75, U, 5.3), eye: 1.5, yaw: 0, exit: new THREE.Vector3(-2.75, U, 4.35), hit: game.interact.hitbox(-2.75, U + 1.2, 4.8, 1.5, 2.0, 0.15), room: 'bedM' });
  SP.hideSpots.push({ id: 'wardrobeC', pos: new THREE.Vector3(4.0, U, 0.5), eye: 1.5, yaw: Math.PI, exit: new THREE.Vector3(4.0, U, 1.45), hit: game.interact.hitbox(4.0, U + 1.2, 0.8, 1.8, 2.0, 0.15), room: 'child' });
  SP.hideSpots.push({ id: 'cellarShelf', pos: new THREE.Vector3(6.6, B, -3.2), eye: 1.0, yaw: Math.PI / 2, exit: new THREE.Vector3(5.7, B, -3.2), hit: null, room: 'basement', disabled: true });

  return SP;
}
