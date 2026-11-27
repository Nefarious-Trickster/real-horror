import * as THREE from 'three';

function cookieTexture() {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  const cx = s / 2, cy = s / 2;
  // soft outer spill
  let grd = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.5);
  grd.addColorStop(0, 'rgba(255,240,215,1)');
  grd.addColorStop(0.18, 'rgba(255,236,205,0.95)');
  grd.addColorStop(0.26, 'rgba(255,230,200,0.62)');
  grd.addColorStop(0.3, 'rgba(255,225,190,0.7)');   // reflector ring
  grd.addColorStop(0.38, 'rgba(255,220,185,0.42)');
  grd.addColorStop(0.55, 'rgba(255,215,180,0.3)');
  grd.addColorStop(0.8, 'rgba(255,215,180,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  // dark hole at the very center (bulb filament shadow) and smudges on the lens
  grd = g.createRadialGradient(cx + 6, cy - 4, 0, cx + 6, cy - 4, 18);
  grd.addColorStop(0, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * s * 0.3;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, rr = 6 + Math.random() * 30;
    grd = g.createRadialGradient(x, y, 0, x, y, rr);
    grd.addColorStop(0, `rgba(0,0,0,${0.05 + Math.random() * 0.12})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // fine concentric reflector ripples
  g.globalCompositeOperation = 'multiply';
  for (let r = 10; r < s * 0.32; r += 7 + Math.random() * 9) {
    const v = 228 + Math.random() * 27;
    g.strokeStyle = `rgba(${v},${v},${v},1)`;
    g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Flashlight {
  constructor(game) {
    this.game = game;
    this.has = false;
    this.on = false;
    this.battery = 1;
    this.flicker = 0;     // seconds of forced flicker remaining
    this.dead = 0;        // seconds of forced blackout
    this.drain = 1 / 300; // per second when on
    const L = new THREE.SpotLight(0xffe2bf, 0, 26, 0.5, 0.6, 1.7);
    L.castShadow = true;
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.camera.near = 0.1; L.shadow.camera.far = 26;
    L.shadow.bias = -0.0006; L.shadow.normalBias = 0.02;
    L.map = cookieTexture();
    this.light = L;
    this.target = new THREE.Object3D();
    L.target = this.target;
    game.scene.add(L, this.target);
    // bounce fill
    this.bounce = new THREE.PointLight(0xffd9b0, 0, 5, 2);
    game.scene.add(this.bounce);
    this.baseIntensity = 130;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.level = 0; // actual output 0..1 this frame
    this.buildModel();
  }

  buildModel() {
    const grp = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.7, roughness: 0.45 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 1, roughness: 0.25 });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 16), body);
    tube.rotation.x = Math.PI / 2; tube.position.z = 0.06; grp.add(tube);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.019, 0.06, 18), chrome);
    head.rotation.x = Math.PI / 2; head.position.z = -0.045; grp.add(head);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    this.lens.position.z = -0.0755; this.lens.rotation.y = Math.PI; grp.add(this.lens);
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.018), chrome);
    sw.position.set(0, 0.018, 0.03); grp.add(sw);
    // hand: a dark simple fist shape so it's not floating
    const skin = new THREE.MeshStandardMaterial({ color: 0x6a4c3c, roughness: 0.8 });
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), skin);
    hand.scale.set(1.15, 0.9, 1.6); hand.position.set(0.004, -0.006, 0.08); grp.add(hand);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.95 }));
    sleeve.rotation.x = Math.PI / 2 - 0.25; sleeve.position.set(0.02, -0.03, 0.23); grp.add(sleeve);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    grp.visible = false;
    this.model = grp;
    this.game.camera.add(grp);
    grp.position.set(0.2, -0.2, -0.36);
    this.sway = new THREE.Vector2();
  }

  give() { this.has = true; this.model.visible = true; }

  toggle() {
    if (!this.has) return;
    this.on = !this.on;
    this.game.audio.play(this.on ? 'flashlight_on' : 'flashlight_off', { volume: 0.6 });
  }

  addBattery(v) { this.battery = Math.min(1, this.battery + v); }

  update(dt, t) {
    const cam = this.game.camera;
    // light lags slightly behind the view for a hand-held feel
    const want = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.dir.lerp(want, Math.min(1, dt * 14)).normalize();
    // model sway
    const yawV = this.game.player.yaw, pitV = this.game.player.pitch;
    this.sway.x += ((this._py ?? yawV) - yawV) * 0.8; this.sway.y += ((this._pp ?? pitV) - pitV) * 0.8;
    this._py = yawV; this._pp = pitV;
    this.sway.multiplyScalar(Math.pow(0.0025, dt));
    this.model.position.set(0.2 + this.sway.x * 0.15, -0.2 - this.sway.y * 0.12 + Math.sin(this.game.player.bobT) * 0.006, -0.36);
    this.model.rotation.set(this.sway.y * 0.4, this.sway.x * 0.5, 0);
    // light from the lens position
    this.model.updateMatrixWorld();
    this.lens.getWorldPosition(this.pos);
    this.pos.lerp(cam.position, 0.35);
    this.light.position.copy(this.pos);
    this.target.position.copy(this.pos).addScaledVector(this.dir, 6);

    // output level
    let lvl = this.on && this.has ? 1 : 0;
    if (lvl) {
      this.battery = Math.max(0, this.battery - this.drain * dt);
      if (this.battery <= 0) lvl = 0;
      const b = this.battery;
      lvl *= b > 0.25 ? 0.75 + 0.25 * b : 0.25 + 2 * b;
      if (b < 0.15 && Math.random() < dt * 4) this.flicker = Math.max(this.flicker, 0.15);
      if (this.flicker > 0) {
        this.flicker -= dt;
        const n = Math.sin(t * 91) * Math.sin(t * 57 + 1.3) + (Math.random() - 0.5);
        lvl *= n > 0.15 ? 1 : n > -0.3 ? 0.25 : 0.0;
        if (!this._fl && Math.random() < 0.3) { this.game.audio.play('flashlight_flicker', { volume: 0.4 }); this._fl = 0.3; }
      }
      if (this.dead > 0) { this.dead -= dt; lvl = 0; }
    }
    if (this._fl) this._fl = Math.max(0, this._fl - dt);
    this.level = lvl;
    this.light.intensity = this.baseIntensity * lvl;
    this.lens.material.color.setScalar(0.15 + lvl * 0.85);
    // fake bounce: point light near where the beam hits
    if (lvl > 0.01) {
      const far = this.pos.clone().addScaledVector(this.dir, 14);
      const f = this.game.house.raycast(this.pos, far, false);
      const d = Math.max(0.3, f * 14);
      this.bounce.position.copy(this.pos).addScaledVector(this.dir, d * 0.82);
      this.bounce.intensity = lvl * 2.2 * Math.min(1, 2.2 / d);
      this.bounce.distance = 3 + d * 0.6;
      this.hitDist = d;
    } else this.bounce.intensity = 0;
  }

  // Is a world point lit by the beam?
  illuminates(p) {
    if (this.level < 0.18) return 0;
    const v = p.clone().sub(this.pos); const d = v.length();
    if (d > 20) return 0;
    v.divideScalar(d);
    const cosA = v.dot(this.dir);
    const inner = Math.cos(this.light.angle * 0.95);
    if (cosA < inner) return 0;
    return this.level * Math.min(1, 8 / d) * (cosA - inner) / (1 - inner) + 0.25;
  }
}
