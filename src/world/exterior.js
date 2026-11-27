import * as THREE from 'three';

const TEX = import.meta.env.BASE_URL + 'assets/textures/';

export class Exterior {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.flash = 0;          // current lightning brightness 0..1
    this.nextStrike = 8 + Math.random() * 10;
    this.seq = [];
    this.enabled = true;

    // ----- sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uFlash: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        varying vec3 vP; uniform float uFlash, uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float y = max(vP.y, 0.0);
          vec2 uv = vP.xz/(vP.y+0.25)*1.4 + vec2(uTime*0.01, 0.0);
          float c = n(uv)*0.5 + n(uv*2.3)*0.3 + n(uv*5.1)*0.2;
          vec3 base = mix(vec3(0.010,0.012,0.016), vec3(0.020,0.024,0.030), c) * (0.6 + 0.4*(1.0-y));
          vec3 fl = vec3(0.55,0.62,0.8) * uFlash * (0.4 + c*1.2) * (0.3 + 0.7*(1.0-y));
          gl_FragColor = vec4(base + fl, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), this.skyMat);
    scene.add(this.sky);

    // ----- ground
    const gm = new THREE.MeshStandardMaterial({ color: 0x15140f, roughness: 0.55, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 1, 1), gm);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; ground.receiveShadow = true;
    scene.add(ground);

    // ----- trees (cross-billboards from silhouettes)
    const loader = new THREE.TextureLoader();
    const treeMats = [1, 2].map((i) => {
      const t = loader.load(TEX + `tree_silhouette_${i}.png`); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, color: 0x2a2a28, roughness: 1, side: THREE.DoubleSide });
    });
    const rnd = (a, b) => a + Math.random() * (b - a);
    const spots = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(13, 40);
      spots.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    spots.push([-10, 9], [9, 12], [-12, -3], [12, -8], [3, -15]);
    for (const [x, z] of spots) {
      const h = rnd(7, 13), w = h * 0.8;
      const mat = treeMats[(Math.random() * 2) | 0];
      for (let k = 0; k < 2; k++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        m.position.set(x, -0.5 + h / 2, z); m.rotation.y = k * Math.PI / 2 + Math.random();
        m.castShadow = true;
        scene.add(m);
      }
    }
    // fence posts along a lane
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1c1915, roughness: 1 });
    for (let x = -24; x <= 24; x += 2.4) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2 + Math.random() * 0.2, 0.1), postMat);
      p.position.set(x, 0.1, 16 + Math.sin(x) * 0.2); p.rotation.z = (Math.random() - 0.5) * 0.15; scene.add(p);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(48, 0.06, 0.05), postMat); rail.position.set(0, 0.45, 16); scene.add(rail);

    // ----- rain
    const N = 14000, pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    let k = 0;
    while (k < N) {
      const x = rnd(-22, 22), z = rnd(-18, 28);
      if (x > -7.4 && x < 7.4 && z > -6.4 && z < 6.4) continue;
      if (x > -3.2 && x < 3.2 && z > 6 && z < 8.9) continue; // porch roof
      const y = rnd(-0.5, 10), len = rnd(0.25, 0.5), s = Math.random();
      pos.set([x, y, z, x - 0.03, y - len, z + 0.02], k * 6);
      seed[k * 2] = s; seed[k * 2 + 1] = s;
      k++;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: `
        attribute float seed; uniform float uTime; varying float vA; uniform vec3 uCam;
        void main(){
          vec3 p = position;
          float fallen = mod(uTime*(9.0 + seed*3.0) + seed*97.0, 10.5);
          p.y = mod(p.y - fallen + 0.5, 10.5) - 0.5;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          vA = clamp(1.0 - (-mv.z)/28.0, 0.0, 1.0);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `uniform float uFlash; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55,0.6,0.7)*(0.05+uFlash*0.9)*vA, 1.0); }`,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // ----- lightning light (shadowed spot aimed through the nearest window)
    const L = new THREE.SpotLight(0xb8c8ff, 0, 30, 0.75, 0.4, 1.2);
    L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0008; L.shadow.camera.near = 0.5; L.shadow.camera.far = 30;
    L.shadow.autoUpdate = false;
    this.light = L; this.target = new THREE.Object3D(); L.target = this.target;
    scene.add(L, this.target);
    // faint moon fill coming in from outside
    this.moon = new THREE.HemisphereLight(0x2a3040, 0x0c0a08, 0.16);
    scene.add(this.moon);
  }

  strike(power = 1, thunderDelay = null) {
    const s = [];
    const n = 2 + ((Math.random() * 3) | 0);
    let t = 0;
    for (let i = 0; i < n; i++) { s.push([t, power * (0.5 + Math.random() * 0.5)]); t += 0.05 + Math.random() * 0.12; s.push([t, 0.05]); t += 0.03 + Math.random() * 0.1; }
    s.push([t + 0.1, 0]);
    this.seq = s; this.seqT = 0;
    this.aimAtPlayer();
    const delay = thunderDelay ?? (0.2 + Math.random() * 2.2) / power;
    const name = delay < 0.6 ? 'thunder_3' : delay < 1.6 ? 'thunder_2' : 'thunder_1';
    const a = this.game.audio;
    a.play(a.defs[name] ? name : 'thunder', { volume: 0.6 + power * 0.4, delay, bus: 'amb' });
    this.game.onLightning?.(power);
  }

  aimAtPlayer() {
    const p = this.game.player.pos;
    let best = null, bd = Infinity;
    for (const w of this.game.house.windows) {
      const dy = Math.abs(w.pos.y - (p.y + 1.5));
      const d = w.pos.distanceTo(p) + dy * 6;
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) return;
    this.light.position.copy(best.pos).addScaledVector(best.normal, 7).add(new THREE.Vector3(0, 4, 0));
    this.target.position.copy(best.pos).addScaledVector(best.normal, -3).add(new THREE.Vector3(0, -1.4, 0));
    this.activeWindow = best;
    this.light.shadow.needsUpdate = true;
  }

  update(dt, t) {
    this.rainMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uTime.value = t;
    if (this.enabled) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) { this.strike(0.4 + Math.random() * 0.7); this.nextStrike = 14 + Math.random() * 28; }
    }
    let f = 0;
    if (this.seq.length) {
      this.seqT += dt;
      for (let i = 0; i < this.seq.length; i++) if (this.seqT >= this.seq[i][0]) f = this.seq[i][1];
      if (this.seqT > this.seq[this.seq.length - 1][0]) { this.seq = []; f = 0; }
    }
    this.flash = f;
    this.skyMat.uniforms.uFlash.value = f;
    this.rainMat.uniforms.uFlash.value = f;
    this.light.intensity = f * 900;
    const gm = this.game.house.glassMat;
    if (gm) gm.emissive.setRGB(0.25 * f, 0.28 * f, 0.36 * f);
    this.moon.intensity = 0.16 + f * 0.3;
  }
}
