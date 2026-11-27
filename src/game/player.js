import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(-3, 0, 3);   // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.radius = 0.28;
    this.eye = 1.62; this.eyeCur = 1.62;
    this.crouch = false; this.running = false;
    this.stamina = 1;
    this.bobT = 0; this.stepDist = 0; this.lastFoot = 0;
    this.noise = 0;          // 0..1 loudness this moment
    this.frozen = false;     // cutscene control
    this.lookLocked = false;
    this.hiding = null;      // hide spot when in wardrobe
    this.breathHeld = false; this.breath = 1;
    this.shake = 0; this.shakeT = 0;
    this.speedMul = 1;
    this.camOffset = new THREE.Vector3();
    this.lookTarget = null;  // cutscene look-at (Vector3), blended
    this.lookBlend = 0;
    this.fall = 0;
    this.smoothY = 0;
  }

  teleport(x, y, z, yaw = this.yaw, pitch = 0) {
    this.pos.set(x, y, z); this.yaw = yaw; this.pitch = pitch; this.vel.set(0, 0, 0); this.smoothY = y;
  }

  update(dt, input) {
    const g = this.game, house = g.house, cam = g.camera;
    // ---------- look
    const [mx, my] = input.consumeMouse();
    if (!this.lookLocked) {
      this.yaw -= mx; this.pitch -= my;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
    if (this.hiding) { this.updateHiding(dt, input); return; }

    // ---------- move
    let fx = 0, fz = 0;
    if (!this.frozen) {
      if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) fz += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
      if (input.hit('KeyC') || input.hit('ControlLeft')) this.crouch = !this.crouch;
    }
    const moving = fx !== 0 || fz !== 0;
    const wantRun = !this.frozen && (input.down('ShiftLeft') || input.down('ShiftRight')) && moving && fz <= 0 && !this.crouch;
    this.running = wantRun && this.stamina > 0.05;
    if (this.running) this.stamina = Math.max(0, this.stamina - dt / 7);
    else this.stamina = Math.min(1, this.stamina + dt / (moving ? 9 : 5));

    let speed = this.crouch ? 0.95 : this.running ? 3.6 : 1.7;
    speed *= this.speedMul;
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (fx * cos + fz * sin) / len, wz = (-fx * sin + fz * cos) / len;
    const accel = moving ? 10 : 12;
    this.vel.x += (wx * speed * (moving ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * speed * (moving ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);

    const ox = this.pos.x, oz = this.pos.z;
    let nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    // ---------- collide (several relaxation passes)
    const y0 = this.pos.y + 0.36, y1 = this.pos.y + (this.crouch ? 1.1 : 1.75);
    for (let it = 0; it < 4; it++) {
      let any = false;
      for (const c of house.colliders) {
        if (!c.enabled || c.y1 < y0 || c.y0 > y1) continue;
        const p = c.push(nx, nz, this.radius);
        if (p) { nx += p[0]; nz += p[1]; any = true; }
      }
      if (!any) break;
    }
    // ---------- ground
    const gy = house.groundAt(nx, nz, this.pos.y + 0.5);
    if (gy === -Infinity) { nx = ox; nz = oz; }
    else {
      if (gy < this.pos.y - 0.02) { // falling / stepping down
        this.fall += 9.8 * dt;
        this.pos.y = Math.max(gy, this.pos.y - this.fall * dt);
        if (this.pos.y - gy < 0.6 && this.pos.y > gy) this.pos.y = Math.max(gy, this.pos.y - 2.2 * dt);
      } else { this.pos.y = gy; this.fall = 0; }
    }
    const moved = Math.hypot(nx - ox, nz - oz);
    this.pos.x = nx; this.pos.z = nz;
    // smooth the camera over steps
    this.smoothY += (this.pos.y - this.smoothY) * Math.min(1, dt * 14);
    if (Math.abs(this.smoothY - this.pos.y) > 1) this.smoothY = this.pos.y;

    // ---------- footsteps & bob
    const horiz = moved / Math.max(dt, 1e-4);
    const stride = this.running ? 0.78 : this.crouch ? 0.55 : 0.68;
    if (horiz > 0.2) {
      this.stepDist += moved;
      this.bobT += moved / stride * Math.PI;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.footstep();
      }
    } else this.bobT += (Math.round(this.bobT / Math.PI) * Math.PI - this.bobT) * Math.min(1, dt * 6);
    // noise: running is loud, crouching silent
    const target = horiz < 0.2 ? 0 : this.running ? 1 : this.crouch ? 0.05 : 0.3;
    this.noise += (target - this.noise) * Math.min(1, dt * 4);

    // ---------- camera
    const eyeT = this.crouch ? 1.05 : 1.62;
    this.eyeCur += (eyeT - this.eyeCur) * Math.min(1, dt * 8);
    const bobAmp = this.running ? 0.055 : this.crouch ? 0.02 : 0.032;
    const bob = Math.abs(Math.sin(this.bobT)) * bobAmp * Math.min(1, horiz / 1.5);
    const sway = Math.cos(this.bobT) * bobAmp * 0.5 * Math.min(1, horiz / 1.5);
    this.applyCamera(dt, bob, sway);
  }

  applyCamera(dt, bob = 0, sway = 0) {
    const cam = this.game.camera;
    // shake (decays) + subtle idle breathing sway
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakeT += dt;
    const sh = this.shake * this.shake;
    const t = this.shakeT;
    const breathe = Math.sin(t * 1.3) * 0.004 * (1 + this.game.dread * 3);
    const sx = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.012 * sh;
    const sy = (Math.sin(t * 41.3) + Math.sin(t * 29.1)) * 0.012 * sh;
    cam.position.set(this.pos.x, this.smoothY + this.eyeCur + bob + breathe, this.pos.z);
    // sway sideways relative to yaw
    cam.position.x += Math.cos(this.yaw) * sway;
    cam.position.z -= Math.sin(this.yaw) * sway;
    cam.position.add(this.camOffset);
    let yaw = this.yaw, pitch = this.pitch;
    if (this.lookTarget && this.lookBlend > 0) {
      const d = this.lookTarget.clone().sub(cam.position);
      const ty = Math.atan2(-d.x, -d.z), tp = Math.atan2(d.y, Math.hypot(d.x, d.z));
      let dy = ty - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * this.lookBlend; pitch += (tp - pitch) * this.lookBlend;
      if (this.lookBlend >= 0.999) { this.yaw = yaw; this.pitch = pitch; }
    }
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = yaw + sx;
    cam.rotation.x = pitch + sy;
    cam.rotation.z = sway * -0.6 + sx * 0.5;
  }

  footstep() {
    const g = this.game;
    const z = g.house.zoneAt(this.pos);
    let surf = z?.surface || 'wood';
    // stairs creak
    const onRamp = g.house.floors.some((f) => f.ramp && !f.disabled && this.pos.x >= f.x0 && this.pos.x <= f.x1 && this.pos.z >= f.z0 && this.pos.z <= f.z1 && Math.abs(g.house.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1) - this.pos.y) < 0.05);
    const name = surf === 'concrete' ? 'footstep_concrete' : surf === 'carpet' ? 'footstep_carpet' : surf === 'tile' ? 'footstep_concrete' : 'footstep_wood';
    const vol = this.running ? 1.0 : this.crouch ? 0.22 : 0.55;
    const p = this.pos.clone(); p.y += 0.05;
    g.audio.play(name, { pos: p, volume: vol, jitter: 0.12, refDistance: 2, occlude: false, rate: surf === 'tile' ? 1.15 : 1 });
    if (onRamp && Math.random() < 0.45) g.audio.play('stair_creak', { pos: p, volume: vol * 0.8, jitter: 0.1, occlude: false });
    else if (surf === 'wood' && Math.random() < (this.running ? 0.15 : 0.06)) g.audio.play('floor_creak', { pos: p, volume: 0.35, jitter: 0.1, occlude: false });
    g.onPlayerStep?.(this.running);
  }

  // ---------- hiding (wardrobe)
  enterHide(spot) {
    this.hiding = spot; this.crouch = false;
    this.preHide = { pos: this.pos.clone(), yaw: this.yaw };
    this.yaw = spot.yaw; this.pitch = -0.05;
    this.game.audio.setMuffle(true);
  }
  exitHide() {
    const s = this.hiding; this.hiding = null;
    this.pos.copy(s.exit); this.smoothY = this.pos.y;
    this.game.audio.setMuffle(false);
    if (this.breathHeld) this.releaseBreath();
  }
  releaseBreath() {
    this.breathHeld = false;
    this.game.audio.play('breath_hold_release', { volume: 0.7 * (1.2 - this.breath) });
  }
  updateHiding(dt, input) {
    const s = this.hiding;
    // limit look inside the wardrobe
    let dy = this.yaw - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    dy = Math.max(-0.5, Math.min(0.5, dy)); this.yaw = s.yaw + dy;
    this.pitch = Math.max(-0.4, Math.min(0.3, this.pitch));
    const hold = input.down('Space');
    if (hold && this.breath > 0) {
      if (!this.breathHeld) { this.breathHeld = true; }
      this.breath = Math.max(0, this.breath - dt / 9);
      if (this.breath <= 0) { this.releaseBreath(); this.noise = 0.7; }
    } else {
      if (this.breathHeld) this.releaseBreath();
      this.breath = Math.min(1, this.breath + dt / 6);
    }
    this.noise = this.breathHeld ? 0 : Math.max(this.noise * 0.95, 0.08);
    this.pos.copy(s.pos); this.smoothY = this.pos.y; this.eyeCur = s.eye ?? 1.55;
    this.applyCamera(dt, 0, 0);
  }
}
