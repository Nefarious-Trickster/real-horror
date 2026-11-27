import * as THREE from 'three';
import { loadModel } from '../engine/modelLoader.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// Fallback creature if the real model module is missing.
function fallbackModel() {
  const object = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.7 });
  const cap = (r, l, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 8), mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; object.add(m); return m; };
  cap(0.12, 0.5, 0, 1.55, 0); const head = cap(0.09, 0.08, 0, 2.15, 0.05);
  cap(0.04, 0.9, -0.28, 1.25, 0, 0, 0.15); cap(0.04, 0.9, 0.28, 1.25, 0, 0, -0.15);
  cap(0.05, 0.8, -0.1, 0.55, 0); cap(0.05, 0.8, 0.1, 0.55, 0);
  const faceAnchor = new THREE.Object3D(); faceAnchor.position.set(0, 2.15, 0.15); object.add(faceAnchor);
  return { object, poses: ['stand', 'crouch', 'crawl', 'ceiling', 'reach', 'lie', 'jumpscare', 'peek_left', 'peek_right'], setPose() {}, update(dt, t, seen) { head.rotation.z = Math.sin(t * 7) * 0.05 * (seen ? 2 : 1); }, setJaw() {}, faceAnchor, dispose() {} };
}

export class Entity {
  constructor(game) {
    this.game = game;
    this.mode = 'off';          // off | stalk | hunt | search | kill
    this.pos = new THREE.Vector3(0, -50, 0);
    this.yaw = 0;
    this.unseen = 0;
    this.nextMove = 2.5;
    this.seenAmt = 0;
    this.everSeen = false;
    this.lastSting = -99;
    this.cfg = { interval: [2.4, 3.8], step: 3.0, killDist: 1.45, lunge: 3.0, react: 0.3 };
    this.pendingDoor = null;
    this.searchT = 0;
    this.cooldown = 0;
    this.visibleSince = 0;
    this.stalk = null;
  }

  async load() {
    let model = null;
    try {
      const mod = await import('./entityModel.js');
      const base = import.meta.env.BASE_URL + 'assets/entity/';
      let gltf = null;
      for (const name of ['lodger.glb', 'lodger.gltf.json']) {
        try { gltf = await loadModel(this.game.gltfLoader, base + name); break; } catch (e) { /* try the next form */ }
      }
      model = await mod.createEntityModel(this.game.gltfLoader, gltf ? { gltf } : {});
    } catch (e) { console.warn('entity model fallback', e); model = fallbackModel(); }
    this.model = model;
    this.model.object.visible = false;
    this.game.scene.add(this.model.object);
    this.points = [new THREE.Vector3(0, 2.05, 0), new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, 0.7, 0)];
  }

  setPose(p) { this.pose = p; this.model.setPose(p); }

  placeAt(p, pose = 'stand', faceTarget = null) {
    this.pos.copy(p);
    const gy = this.game.house.groundAt(p.x, p.z, p.y + 0.6);
    if (gy > -Infinity) this.pos.y = gy;
    this.setPose(pose);
    this.face(faceTarget || this.game.player.pos);
    this.model.object.position.copy(this.pos);
    this.model.object.visible = true;
    this.node = this.game.house.nearestVisibleNode(this.pos);
  }

  face(target) {
    const d = _v.copy(target).sub(this.pos);
    this.yaw = Math.atan2(d.x, d.z);
    this.model.object.rotation.set(0, this.yaw, 0);
  }

  hide() { this.model.object.visible = false; this.pos.set(0, -50, 0); this.stopBreath(); }

  // ---------------------------------------------------------- observation
  litAt(p) {
    const g = this.game;
    let lit = g.flashlight.illuminates(p);
    if (lit > 0) return lit;
    if (g.exterior.flash > 0.25) return 0.8;
    for (const l of g.props.lamps) {
      if (l.level < 0.3) continue;
      const d = l.light.position.distanceTo(p);
      if (d > l.light.distance * 0.75) continue;
      if (g.house.raycast(l.light.position, p, false) < 0.97) continue;
      return 0.6;
    }
    for (const f of g.props.flames) {
      if (!f.lit || !f.light) continue;
      if (f.pos.distanceTo(p) < 3.2 && g.house.raycast(f.pos, p, false) > 0.97) return 0.5;
    }
    return 0;
  }

  // 0..1 how well the player can see a creature standing at `at` (or the current pose)
  observedAt(at, posePoints = this.points) {
    const g = this.game, cam = g.camera;
    if (g.player.hiding) return 0;
    let best = 0;
    for (const lp of posePoints) {
      _w.copy(lp);
      if (this.pose === 'ceiling') _w.y = 2.75 - lp.y * 0.35;
      else if (this.pose === 'crawl' || this.pose === 'crouch') _w.y = lp.y * 0.45;
      _w.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(at);
      const d = _w.distanceTo(cam.position);
      if (d > 24) continue;
      _v.copy(_w).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.02 || Math.abs(_v.y) > 1.02) continue;
      if (g.house.raycast(cam.position, _w, false) < 0.985) continue;
      const lit = this.litAt(_w);
      if (lit <= 0) continue;
      const centre = 1 - Math.min(1, Math.hypot(_v.x, _v.y));
      best = Math.max(best, Math.min(1, lit) * (0.5 + 0.5 * centre));
    }
    return best;
  }

  // ---------------------------------------------------------- control
  startHunt(cfg = {}) {
    Object.assign(this.cfg, cfg);
    this.mode = 'hunt';
    this.nextMove = this.cfg.firstDelay ?? 2.5;
    this.unseen = 0;
  }
  stop() { this.mode = 'off'; this.hide(); this.stalk = null; }

  // scripted appearance; resolves when it vanishes
  appear(p, pose, opts = {}) {
    this.mode = 'stalk';
    this.placeAt(p, pose, opts.face);
    this.stalk = { seen: false, t: 0, vanishUnseen: opts.vanishUnseen ?? 0.35, timeout: opts.timeout ?? 60, minSeen: opts.minSeen ?? 0.12, seenT: 0, onSeen: opts.onSeen };
    return new Promise((res) => { this.stalk.resolve = res; });
  }

  // ---------------------------------------------------------- movement
  pathPoints() {
    const h = this.game.house;
    const pp = this.game.player.pos;
    const from = this.node || h.nearestVisibleNode(this.pos);
    const to = h.nearestVisibleNode(pp);
    if (!from || !to) return null;
    const ids = h.path(from.id, to.id);
    if (!ids) return null;
    const pts = [{ p: this.pos.clone(), id: null }];
    for (let i = 0; i < ids.length; i++) {
      const n = h.nodes.get(ids[i]);
      pts.push({ p: n.p.clone(), id: n.id, door: i > 0 ? h.nodes.get(ids[i - 1]).doors.get(n.id) : null });
    }
    pts.push({ p: pp.clone(), id: null });
    // skip the first node if it is behind us (closer to player directly)
    return pts;
  }

  tryMove() {
    const g = this.game, h = g.house;
    // a door it reached last move: open it now (loudly)
    if (this.pendingDoor) {
      const d = this.pendingDoor; this.pendingDoor = null;
      if (!d.locked && !d.open) { d.slam(true); g.audio.play('door_slam', { pos: d.worldCenter(), volume: 0.9 }); g.shock(0.25); return true; }
    }
    const pts = this.pathPoints();
    if (!pts) return false;
    // distance along the path until the first closed door
    let remain = 0, doorAt = Infinity, door = null, doorIdx = -1;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].door && !pts[i].door.open && door === null) { door = pts[i].door; doorAt = remain; doorIdx = i; }
      remain += pts[i].p.distanceTo(pts[i - 1].p);
    }
    const step = this.cfg.step * (0.75 + Math.random() * 0.5) * (1 + g.player.noise * 0.6);
    if (!door && remain <= (this.cfg.lunge ?? step) + this.cfg.killDist && Math.abs(g.player.pos.y - this.pos.y) < 1.6) {
      g.killPlayer('dark');
      return true;
    }
    if (door && doorAt <= step) {
      // go stand at the door and open it next time
      const at = pts[doorIdx - 1].p.clone();
      if (at.distanceTo(this.pos) < 0.5) { this.pendingDoor = door; return this.tryMove(); }
      if (this.commit(at, pts[doorIdx - 1].id)) { this.pendingDoor = door; return true; }
      return false;
    }
    for (const frac of [1, 0.7, 0.45]) {
      const want = step * frac;
      let acc = 0, cand = null, nodeId = null;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1].p, b = pts[i].p, seg = a.distanceTo(b);
        if (acc + seg >= want) { cand = a.clone().lerp(b, (want - acc) / Math.max(seg, 1e-4)); nodeId = pts[i].id || pts[i - 1].id; break; }
        acc += seg;
      }
      if (cand && this.commit(cand, nodeId)) return true;
    }
    return false;
  }

  // move to cand if the destination itself is unobserved
  commit(cand, nodeId) {
    const g = this.game, h = g.house;
    const gy = h.groundAt(cand.x, cand.z, cand.y + 0.8);
    if (gy === -Infinity) return false;
    cand.y = gy;
    const pose = this.choosePose(cand);
    const prevPose = this.pose, prevYaw = this.yaw;
    this.pose = pose; this.yaw = Math.atan2(g.player.pos.x - cand.x, g.player.pos.z - cand.z);
    const vis = this.observedAt(cand);
    this.pose = prevPose; this.yaw = prevYaw;
    if (vis > 0.05) return false;
    this.placeAt(cand, pose);
    this.node = nodeId ? h.nodes.get(nodeId) : h.nearestVisibleNode(cand);
    const s = this.pos.clone(); s.y += 0.5;
    g.audio.play('entity_skitter', { pos: s, volume: 0.9, jitter: 0.15, refDistance: 1.8 });
    if (Math.random() < 0.5) g.audio.play('entity_crack', { pos: s.clone().setY(s.y + 1.2), volume: 0.6, delay: 0.25 + Math.random() * 0.3, jitter: 0.1 });
    return true;
  }

  choosePose(p) {
    const d = p.distanceTo(this.game.player.pos);
    const r = Math.random();
    const h = this.game.house;
    const zone = h.zoneAt(p);
    const ceilingOk = zone && !['attic', 'stairwell'].includes(zone.id) && Math.abs(h.groundAt(p.x, p.z, p.y + 0.2) - p.y) < 0.05 && !h.floors.some((f) => f.ramp && p.x >= f.x0 && p.x <= f.x1 && p.z >= f.z0 && p.z <= f.z1);
    if (zone?.id === 'attic') return r < 0.5 ? 'crawl' : 'crouch';
    if (d < 4.5) return r < 0.45 ? 'reach' : r < 0.7 ? 'crouch' : 'stand';
    if (d < 9) return r < 0.25 && ceilingOk ? 'ceiling' : r < 0.5 ? 'crawl' : r < 0.75 ? 'crouch' : 'stand';
    return r < 0.15 && ceilingOk ? 'ceiling' : 'stand';
  }

  // driven back by the light: retreat out of sight, far away, then a grace period
  recoil(minD = 8, maxD = 18) {
    const g = this.game, h = g.house;
    if (this.mode !== 'hunt' && this.mode !== 'stalk') return;
    const pp = g.player.pos, cam = g.camera.position;
    const from = this.pos.clone().setY(this.pos.y + 1.5);
    const cands = [...h.nodes.values()].filter((n) => !n.disabled && Math.abs(n.p.y - pp.y) < 1.6)
      .map((n) => ({ n, d: n.p.distanceTo(pp) })).filter((c) => c.d >= minD && c.d <= maxD);
    // prefer spots you can't see from where you stand
    cands.sort((a, b) => {
      const va = h.raycast(cam, a.n.p.clone().setY(a.n.p.y + 1.5), false) < 0.98 ? 0 : 1;
      const vb = h.raycast(cam, b.n.p.clone().setY(b.n.p.y + 1.5), false) < 0.98 ? 0 : 1;
      return va - vb || b.d - a.d;
    });
    let pick = cands[0]?.n;
    if (!pick) { const all = [...h.nodes.values()].filter((n) => !n.disabled).sort((a, b) => b.p.distanceTo(pp) - a.p.distanceTo(pp)); pick = all[0]; }
    g.audio.play('entity_skitter', { pos: from, volume: 1.0, rate: 1.15 });
    if (this.mode === 'stalk') { this.hide(); return; }
    this.placeAt(pick.p, 'stand');
    this.node = pick; this.pendingDoor = null;
    this.nextMove = 7 + Math.random() * 3;
    this.unseen = 0;
  }

  // ---------------------------------------------------------- hiding search
  beginSearch(spot) {
    if (this.mode !== 'hunt') return;
    const dist = this.pos.distanceTo(spot.pos);
    if (dist > 16) return;
    this.mode = 'search'; this.searchSpot = spot; this.searchT = 0; this.searchPhase = 0;
    this.nextMove = 1.5 + Math.random();
  }

  updateSearch(dt) {
    const g = this.game, spot = this.searchSpot;
    if (!g.player.hiding) { this.mode = 'hunt'; this.nextMove = 1.2; return; }
    this.searchT += dt;
    this.nextMove -= dt;
    if (this.nextMove > 0) {
      // lingering at the doors: if it is close and you breathe, it finds you
      if (this.searchPhase === 3) {
        if (!g.player.breathHeld && g.player.noise > 0.05) {
          this.lingerFail = (this.lingerFail || 0) + dt;
          if (this.lingerFail > 0.9) { g.killPlayer('found'); return; }
        }
      }
      return;
    }
    this.searchPhase++;
    if (this.searchPhase === 1 || this.searchPhase === 2) {
      // move toward the room, sounds only (you can't see it in the dark)
      const toward = spot.exit.clone().lerp(this.pos, this.searchPhase === 1 ? 0.6 : 0.3);
      toward.x += (Math.random() - 0.5) * 1.2; toward.z += (Math.random() - 0.5) * 1.2;
      const gy = g.house.groundAt(toward.x, toward.z, toward.y + 0.6);
      if (gy > -Infinity) { toward.y = gy; this.placeAt(toward, 'crouch', spot.pos); }
      g.audio.play('entity_skitter', { pos: this.pos.clone().setY(this.pos.y + 0.4), volume: 0.8 });
      this.nextMove = 2 + Math.random() * 1.5;
      if (this.searchPhase === 2) g.ui.hint('Hold SPACE to hold your breath', 4);
    } else if (this.searchPhase === 3) {
      // right outside the doors
      const p = spot.exit.clone().lerp(spot.pos, 0.15);
      this.placeAt(p, 'stand', spot.pos);
      this.lingerFail = 0;
      g.audio.play('entity_crack', { pos: p.clone().setY(p.y + 2), volume: 0.8 });
      g.audio.play('vo_where', { pos: p.clone().setY(p.y + 2), volume: 0.7, delay: 1.5 });
      this.nextMove = 5.5 + Math.random() * 2;
    } else {
      // gives up: it leaves
      const far = [...g.house.nodes.values()].filter((n) => !n.disabled && n.p.distanceTo(spot.pos) > 9);
      const n = far[(Math.random() * far.length) | 0];
      if (n) { this.placeAt(n.p, 'stand'); this.node = n; }
      g.audio.play('entity_skitter', { pos: spot.exit, volume: 0.5 });
      this.mode = 'hunt'; this.nextMove = 9 + Math.random() * 5;
    }
  }

  // ---------------------------------------------------------- sounds
  startBreath() {
    if (this.breathH?.alive) return;
    this.breathH = this.game.audio.play('entity_breath', { follow: this.model.faceAnchor, loop: true, volume: 0.0, refDistance: 1.0, rolloff: 1.8 });
  }
  stopBreath() { this.breathH?.stop(0.5); this.breathH = null; }

  // ---------------------------------------------------------- update
  update(dt, t) {
    if (!this.model) return;
    const g = this.game;
    if (this.mode === 'off') return;
    const seen = this.model.object.visible ? this.observedAt(this.pos) : 0;
    this.seenAmt = seen;
    this.model.update(dt, t, seen > 0.05);
    const dist = this.pos.distanceTo(g.player.pos);

    // breath when near
    if (this.model.object.visible && dist < 9) { this.startBreath(); this.breathH?.setVolume(Math.max(0, 1 - dist / 9) * 0.9, 0.3); }
    else if (this.breathH) this.stopBreath();

    if (seen > 0.05) {
      this.unseen = 0;
      if (!this.wasSeen) this.onSeenStart(dist);
      this.wasSeen = true;
      this.stare = (this.stare || 0) + dt;
      if (this.stare > 4.5 && g.dread > 0.7 && !this.saidDontLook && this.mode === 'hunt') {
        this.saidDontLook = true;
        g.director.say('vo_dont_look', this.model.faceAnchor.getWorldPosition(new THREE.Vector3()), { volume: 0.9 });
      }
      // dread grows when you hold it in the light
      g.dread = Math.min(1.2, g.dread + dt * Math.min(1, seen * 1.6) * (0.06 + 0.22 / Math.max(1, dist)));
      // the flashlight struggles near it
      if (dist < 7 && Math.random() < dt * (0.25 + (7 - dist) * 0.12)) g.flashlight.flicker = Math.max(g.flashlight.flicker, 0.12 + Math.random() * 0.25);
    } else {
      this.unseen += dt;
      this.wasSeen = false;
      this.stare = 0;
    }

    if (this.mode === 'stalk' && this.stalk) {
      const s = this.stalk; s.t += dt;
      if (seen > 0.05) { s.seenT += dt; if (!s.seen && s.seenT > s.minSeen) { s.seen = true; s.onSeen?.(); } }
      if ((s.seen && this.unseen > s.vanishUnseen) || s.t > s.timeout) {
        this.hide(); this.mode = 'off'; const r = s.resolve; this.stalk = null; r?.(s.seen);
      }
      return;
    }
    if (this.mode === 'search') { this.updateSearch(dt); return; }
    if (this.mode === 'hunt') {
      if (g.player.hiding) { this.beginSearch(g.player.hiding); }
      this.nextMove -= dt;
      if (this.nextMove <= 0 && this.unseen > (this.cfg.react ?? 0.3) && g.flashlight.dead <= 0) {
        this.tryMove();
        const [a, b] = this.cfg.interval;
        this.nextMove = a + Math.random() * (b - a);
        if (g.player.noise > 0.5) this.nextMove *= 0.6;
        if (!g.flashlight.on) this.nextMove *= 0.8;
      }
      // standing still right next to you, unseen → it takes you
      if (dist < this.cfg.killDist && this.unseen > 0.6 && Math.abs(g.player.pos.y - this.pos.y) < 1.2) g.killPlayer('dark');
    }
  }

  onSeenStart(dist) {
    const g = this.game;
    const now = g.time;
    if (now - this.lastSting > (dist < 4 ? 6 : 14)) {
      this.lastSting = now;
      g.audio.play(dist < 4 ? 'stinger' : 'sting_low', { volume: dist < 4 ? 0.9 : 0.7 });
      g.shock(dist < 4 ? 0.8 : 0.4);
      g.player.shake = Math.max(g.player.shake, dist < 4 ? 0.7 : 0.3);
    }
    this.everSeen = true;
  }
}
