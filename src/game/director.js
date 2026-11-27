import * as THREE from 'three';
import { LV } from '../world/house.js';

const { B, BC, G, GC, U, UC, A } = LV;
const CANCEL = Symbol('cancel');
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const NOTES = {
  casket: `<span class="date">pinned to the casket</span>Eli —

Sit with me until dawn. Promise me that.

Keep the candles lit. Keep the doors shut.
If you hear me call for you — I won't. Don't come.

If the lights go, the fuse box is in the cellar. There are spare fuses on the bench.

I'm sorry. I'm so sorry.
— Mom`,
  list: `<span class="date">on the kitchen table</span>milk
bread
salt — LOTS of salt
bulbs (60w)
batteries for the torch

it doesn't eat.
why do I keep setting two places`,
  cellar: `<span class="date">tucked into the bed frame</span>It stayed down here for thirty-one days.
I chained the bed so it couldn't get up.

On the thirty-second day I woke up chained to it myself.

I don't remember who did that.`,
  photo: `<span class="date">a photograph in a standing frame</span>Mom, the summer before it came back. She is laughing at something out of frame.

Someone has pressed a thumbnail through both of her eyes.`,
  drawings: `<span class="date">pinned to your old wall</span>Crayon drawings. Yours — your name is on the back, in her handwriting, with a year you were six.

You don't remember drawing them.

In every one of them there is a tall black figure. In one of them it is labelled: "the lodger".`,
  diary: `<span class="date">her diary — the last pages</span><b>March.</b> It came back the week after your father's funeral. It doesn't live in the house. It lives in whoever is grieving in it.

<b>April.</b> I saw it in the hall, at the far end, standing like it was waiting to be let in. When I turned the lamp on it, it did not move. Not a twitch. I stood there with the lamp until morning.

<span class="scrawl">IT CANNOT MOVE WHILE IT IS SEEN.</span>

Only seen in the light, though. In the dark my eyes don't count. In the dark it comes so quickly.

<b>August.</b> It wears me now, mostly. I lose hours. I wake up in the attic with my hands full of your photographs.

<b>October.</b> The doctor says weeks. When I go it will need a new coat. It wants the one who grieves the most.

I asked you to sit the vigil because the old way says it stays in the box until dawn if someone keeps watch. I thought the candles would be enough.

If you are reading this, it is already out.

Keep the light on it. Don't let it reach you in the dark. If it is close and you cannot run, hide and do not breathe.

Get out of the house, Eli. It can only wear what's inside.`,
};

export class Director {
  constructor(game) {
    this.game = game;
    this.gen = 0;
    this.waits = [];
    this.flags = {};
    this.stage = 0;
    this.checkpoint = null;
    this.ambT = 25;
    this.stages = ['intro', 'knock', 'phone', 'cellar', 'returning', 'diary', 'hunt', 'attic', 'escape'];
  }

  // ---------------------------------------------------------- async helpers
  wait(s) { const gen = this.gen; return new Promise((res, rej) => this.waits.push({ t: this.game.time + s, res, rej, gen })); }
  until(fn) { const gen = this.gen; return new Promise((res, rej) => this.waits.push({ fn, res, rej, gen })); }
  update(dt, t) {
    const keep = [];
    for (const w of this.waits) {
      if (w.gen !== this.gen) { w.rej(CANCEL); continue; }
      let done = false;
      try { done = w.fn ? !!w.fn() : t >= w.t; } catch (e) { console.error(e); done = true; }
      if (done) w.res(); else keep.push(w);
    }
    this.waits = keep;
    this.perFrame(dt, t);
  }

  async run(from) {
    const gen = ++this.gen;
    try {
      for (let s = from; s < this.stages.length; s++) {
        if (gen !== this.gen) return;
        this.stage = s;
        await this[this.stages[s]]();
      }
    } catch (e) { if (e !== CANCEL) console.error(e); }
  }

  start() { this.run(0); }

  // ---------------------------------------------------------- utility
  get p() { return this.game.player; }
  zone() { return this.game.house.zoneAt(this.p.pos)?.id; }
  near(v, r) { return this.p.pos.distanceTo(v) < r; }
  looking(v, cos = 0.9, maxDist = 30) {
    const cam = this.game.camera;
    const d = v.clone().sub(cam.position); const len = d.length();
    if (len > maxDist) return false;
    d.divideScalar(len);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    if (f.dot(d) < cos) return false;
    return this.game.house.raycast(cam.position, v, false) > 0.97;
  }
  objective(t, sub) { this.game.ui.objective(t, sub); }
  say(id, pos, opts = {}) {
    const g = this.game, def = g.audio.defs[id] || g.audio.defs[g.audio.resolve(id)];
    const h = g.audio.play(id, { pos, volume: opts.volume ?? 1, bus: 'voice', reverb: opts.reverb ?? 0.25, refDistance: 2.5, ...opts });
    const text = opts.text || def?.subtitle;
    if (text) g.ui.subtitle(`“${text}”`, opts.who ?? 'Mother', Math.max(2.5, g.audio.duration(id) + 0.8));
    return h;
  }
  sfx(id, pos, opts = {}) { return this.game.audio.play(id, { pos, ...opts }); }
  give(item, label) { this.game.inventory.add(item); this.refreshInv(); if (label) this.game.ui.hint(label, 3); }
  take(item) { this.game.inventory.delete(item); this.refreshInv(); }
  has(item) { return this.game.inventory.has(item); }
  refreshInv() {
    const names = { matches: 'a box of matches', flashlight: 'the flashlight', fuse: 'a glass fuse', pole: 'the attic pole', key: 'the front door key' };
    this.game.ui.inventory([...this.game.inventory].map((i) => names[i] || i));
  }
  lampsCircuit(c, on) { this.game.power[c] = on; }
  candlesOut(list) { for (const f of list) { if (f.lit) { f.lit = false; this.sfx('candle_out', f.pos.clone(), { volume: 0.6, jitter: 0.1 }); } } }

  // ---------------------------------------------------------- setup: lamps + interactables
  setup() {
    const g = this.game, P = g.props, sp = g.sp, I = g.interact;
    // lamps
    this.lamps = {
      parlor: P.lamp(-1.75, G + 1.0, 5.6, { intensity: 6, distance: 8, flicker: 0.1, bulb: false, color: 0xffb070 }),
      console: P.lamp(-6.35, G + 1.35, 1.25, { intensity: 3.5, distance: 5, bulb: false, color: 0xffa860 }),
      hallS: P.lamp(0, GC - 0.2, 4.3, { intensity: 5, distance: 7 }),
      hallN: P.lamp(-0.4, GC - 0.2, -3.6, { intensity: 3.0, distance: 6, flicker: 0.2 }),
      kitchen: P.lamp(-4.1, GC - 0.62, -3.0, { intensity: 7, distance: 8, bulb: false }),
      back: P.lamp(3.5, GC - 0.25, -3.0, { intensity: 2.5, distance: 6, flicker: 0.5 }),
      b1: P.lamp(4.0, BC - 0.2, -3.5, { intensity: 4, distance: 7, circuit: 'basement' }),
      b2: P.lamp(3.6, BC - 0.2, 3.0, { intensity: 4, distance: 7, circuit: 'basement' }),
      b3: P.lamp(-3.4, BC - 0.2, 0.5, { intensity: 4, distance: 7, circuit: 'basement', flicker: 0.4 }),
      upS: P.lamp(-0.4, UC - 0.2, 1.5, { intensity: 3, distance: 6 }),
      upN: P.lamp(-0.4, UC - 0.2, -3.6, { intensity: 3, distance: 6, flicker: 0.15 }),
      bedM: P.lamp(-6.6, U + 1.2, 4.6, { intensity: 2.2, distance: 5.5, bulb: false, color: 0xffa860 }),
    };
    // doors
    for (const d of g.house.doors.values()) {
      I.add(d.panel, () => d.locked ? 'Locked' : d.open ? 'Close' : 'Open', () => this.useDoor(d), { door: d, range: 2.0 });
    }
    // casket note
    I.add(sp.casketNote, 'Read the note', () => this.read('casket'));
    // matches
    this.itMatches = I.add(sp.matches, () => this.has('matches') ? null : 'Take the matches', () => {
      this.give('matches', 'You take the matches.'); sp.matches.visible = false; this.sfx('pickup', sp.matches.position);
    });
    // candles
    sp.candles.forEach((c, i) => {
      I.add(c.group, () => c.flame.lit ? null : this.has('matches') ? 'Light the candle' : 'An unlit candle', () => {
        if (!this.has('matches')) { g.ui.hint('You need something to light it.', 3); return; }
        this.sfx('match_strike', c.flame.pos, { volume: 0.8 });
        setTimeout(() => { c.flame.lit = true; this.flags.candlesLit = (this.flags.candlesLit || 0) + 1; }, 450);
      }, { range: 2.2 });
    });
    // kitchen list note
    const list = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.2), new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.9 }));
    list.rotation.x = -Math.PI / 2; list.rotation.z = 0.4; list.position.set(-3.7, G + 0.885, -2.9); g.scene.add(list);
    I.add(list, 'Read the list', () => this.read('list'));
    // photo, drawings, cellar note
    const photo = P.items.get('momPhoto'); if (photo) I.add(photo, 'Look at the photograph', () => this.read('photo'));
    for (const d of sp.drawings) I.add(d, 'Look at the drawings', () => this.read('drawings'));
    const cn = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.16), new THREE.MeshStandardMaterial({ color: 0xd0c6ae, roughness: 0.9 }));
    cn.position.set(-5.6, B + 0.62, -1.55); cn.rotation.y = 0.1; g.scene.add(cn);
    I.add(cn, 'Read the note', () => this.read('cellar'));
    // phone
    const phone = P.items.get('phone');
    this.phoneHit = I.hitbox(-1.45, G + 1.35, -3.3, 0.25, 0.5, 0.4);
    I.add(this.phoneHit, () => this.flags.ringing ? 'Answer the phone' : null, () => { this.flags.answered = true; });
    // flashlight drawer
    I.add(sp.kitchenDrawer, () => this.has('flashlight') ? null : 'Open the drawer', () => {
      this.sfx('drawer_open', sp.kitchenDrawer.position, { volume: 0.8 });
      if (!this.flags.flashlightAllowed) { g.ui.hint('Tea towels. Spoons. A ball of string.', 3); return; }
      this.give('flashlight', 'The flashlight. Press F.'); g.flashlight.give(); this.flags.gotFlashlight = true;
    });
    // fuse and fusebox
    I.add(sp.fuseHit, () => this.has('fuse') || this.flags.fuseFitted ? null : 'Take the fuse', () => {
      this.give('fuse', 'A spare fuse.'); sp.fuse.children.slice(0, 3).forEach((m) => { m.visible = false; }); this.sfx('pickup', sp.fuse.position);
    });
    I.add(sp.fuseboxHit, () => this.flags.fuseFitted ? null : this.has('fuse') ? 'Fit the fuse' : 'The fuse box', () => {
      if (!this.has('fuse')) { g.ui.hint('One fuse is blackened and cracked. There should be spares on the bench.', 4); this.flags.sawFusebox = true; return; }
      this.take('fuse'); this.flags.fuseFitted = true;
    });
    // diary
    I.add(sp.diary, 'Read her diary', () => { this.read('diary'); this.flags.diaryRead = true; });
    // toy chest / pole
    I.add(sp.toyChestHit, () => this.has('pole') || this.flags.hatchOpen ? null : 'Open the toy chest', () => {
      this.sfx('wardrobe_open', sp.pole.position, { volume: 0.6 });
      this.give('pole', 'The hooked attic pole. Why is it in here?'); sp.pole.visible = false;
    });
    // hatch
    I.add(sp.hatchHit, () => this.flags.hatchOpen ? null : this.has('pole') ? 'Hook the hatch' : 'The attic hatch', () => {
      if (!this.has('pole')) { g.ui.hint('Too high to reach. There used to be a pole with a hook…', 4); return; }
      this.take('pole'); this.openHatch();
    }, { range: 2.6 });
    // key
    I.add(sp.keyHit, () => this.has('key') ? null : 'Take the key', () => { this.flags.keyTaken = true; });
    // batteries
    for (const b of sp.batteries) I.add(b, () => b.visible ? 'Take the batteries' : null, () => {
      b.visible = false; g.flashlight.addBattery(0.55); this.sfx('pickup', b.position); g.ui.hint('Fresh batteries.', 2);
    });
    // hiding spots
    for (const s of sp.hideSpots) if (s.hit) I.add(s.hit, 'Hide inside', () => g.hideIn(s), { ignore: [P.items.get(s.id)?.userData.collider].filter(Boolean) });
    // music box
    I.add(sp.musicBox.group, () => this.musicH?.alive ? 'Close the music box' : null, () => { this.musicH?.stop(0.2); this.sfx('drawer_open', sp.musicBox.group.position, { volume: 0.4 }); sp.musicBox.lid.rotation.x = 0; });
    // TV
    const tv = P.items.get('tv');
    this.tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.tvScreen.position.set(5.15 - 0.16, G + 1.39, -3.0); this.tvScreen.rotation.y = -Math.PI / 2; g.scene.add(this.tvScreen);
    this.tvLight = new THREE.PointLight(0xa8c0ff, 0, 4, 2); this.tvLight.position.set(4.7, G + 1.4, -3.0); g.scene.add(this.tvLight);
    I.add(this.tvScreen, () => this.tvH?.alive ? 'Switch it off' : null, () => this.tvOff());
    this.staticTex = makeStaticTexture();
    // glints on everything the story needs you to find
    const has = (i) => this.has(i);
    this.glint(sp.matches, () => !has('matches'), [0, 0.03, 0]);
    this.glint(sp.casketNote, () => !this.flags.read_casket, [0, 0.03, 0]);
    sp.candles.forEach((c) => this.glint(c.flame.sprite, () => has('matches') && !c.flame.lit && this.stage === 0, [0, -0.04, 0], 0.8));
    this.glint(sp.kitchenDrawer, () => this.flags.flashlightAllowed && !has('flashlight'), [0, 0.02, 0.06]);
    this.glint(this.phoneHit, () => this.flags.ringing, [0, 0, 0.1]);
    this.glint(sp.fuseHit, () => !has('fuse') && !this.flags.fuseFitted && this.stage >= 3, [0, 0.03, 0]);
    this.glint(sp.fuseboxHit, () => has('fuse'), [0.2, 0, 0]);
    this.glint(sp.diary, () => !this.flags.diaryRead && this.stage >= 5, [0, 0.04, 0]);
    this.glint(sp.toyChestHit, () => !has('pole') && !this.flags.hatchOpen && this.stage >= 6, [0, 0.3, 0]);
    this.glint(sp.hatchHit, () => has('pole') && !this.flags.hatchOpen, [0, -0.2, -0.3]);
    this.glint(sp.keyHit, () => !has('key') && this.stage >= 7, [0, 0.03, 0]);
    for (const b of sp.batteries) this.glint(b, () => b.visible, [0, 0.04, 0], 0.7);
    // initial power: on in the main house, the cellar circuit is dead
    g.power.main = true; g.power.basement = false;
    this.lamps.back.broken = false;
    for (const k of ['b1', 'b2', 'b3']) this.lamps[k].on = true;
  }

  // soft pulsing glints so key items can be found in the dark
  glint(obj, active, offset = [0, 0.05, 0], size = 1) {
    if (!this._glintTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,240,210,1)'); g.addColorStop(0.15, 'rgba(255,230,190,0.7)'); g.addColorStop(1, 'rgba(255,220,180,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      x.strokeStyle = 'rgba(255,240,220,0.5)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(32, 4); x.lineTo(32, 60); x.moveTo(4, 32); x.lineTo(60, 32); x.stroke();
      this._glintTex = new THREE.CanvasTexture(c);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    const p = obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...offset));
    s.position.copy(p); s.scale.setScalar(0.09 * size); s.renderOrder = 5;
    this.game.scene.add(s);
    (this.glints = this.glints || []).push({ s, active, phase: Math.random() * 6 });
  }

  useDoor(d) {
    const g = this.game;
    if (d.locked) {
      this.sfx('door_locked', d.worldCenter(), { volume: 0.8 });
      if (d.id === 'front' && this.has('key')) { this.flags.unlocking = true; return; }
      if (d.id === 'front') this.flags.triedFront = true;
      g.ui.hint(d.id === 'front' ? 'Locked. The key is gone from the hook.' : d.id === 'bath' ? 'It won\'t open. Something is leaning against it.' : 'Locked.', 3);
      return;
    }
    const open = !d.open;
    d.setOpen(open);
    this.sfx(open ? 'door_open' : 'door_close', d.worldCenter(), { volume: 0.7, jitter: 0.08 });
    g.player.noise = Math.max(g.player.noise, 0.4);
  }

  read(id) {
    this.sfx('paper', null, { volume: 0.6, bus: 'ui' });
    this.game.ui.note(NOTES[id]);
    this.flags['read_' + id] = true;
    this.game.input.mouseDX = this.game.input.mouseDY = 0;
  }

  openHatch() {
    const g = this.game, sp = g.sp, h = g.house;
    this.flags.hatchOpen = true;
    this.sfx('door_open', V(-0.5, UC, 4.0), { volume: 0.9, rate: 0.7 });
    sp.hatchBlock.enabled = false;
    const t0 = g.time;
    const anim = () => {
      const t = Math.min(1, (g.time - t0) / 1.6);
      sp.hatch.pivot.rotation.x = -1.35 * (1 - Math.pow(1 - t, 3));
      if (t > 0.4) { sp.hatch.ladder.visible = true; sp.hatch.ladder.position.y = (U + A) / 2 - 0.08 + (1 - Math.min(1, (t - 0.4) / 0.6)) * 1.2; }
      if (t < 1) requestAnimationFrame(anim);
    };
    anim();
    setTimeout(() => this.sfx('stair_creak', V(-0.5, U + 1, 3.5), { volume: 1 }), 900);
    h.ladderRamp.disabled = false;
    for (const id of ['ladder_top', 'at_s', 'at_m', 'at_n']) h.nodes.get(id).disabled = false;
    h.link('ladder_bot', 'ladder_top');
    for (const f of sp.atticFlames) f.lit = true;
  }

  tvOn() {
    this.tvScreen.material = new THREE.MeshBasicMaterial({ map: this.staticTex, color: 0x99aabb });
    this.tvH = this.sfx('radio_static', this.tvScreen.position, { loop: true, volume: 0.6 });
    this.tvLight.intensity = 1.2;
  }
  tvOff() { this.tvH?.stop(0.1); this.tvScreen.material = new THREE.MeshBasicMaterial({ color: 0x000000 }); this.tvLight.intensity = 0; this.sfx('flashlight_off', this.tvScreen.position); }

  // ---------------------------------------------------------- per-frame
  perFrame(dt, t) {
    const g = this.game;
    if (this.glints) for (const gl of this.glints) {
      const on = gl.active() && gl.s.position.distanceTo(g.camera.position) < 9;
      const target = on ? 0.35 + 0.3 * Math.sin(t * 2.4 + gl.phase) : 0;
      gl.s.material.opacity += (target - gl.s.material.opacity) * Math.min(1, dt * 4);
      gl.s.visible = gl.s.material.opacity > 0.01;
    }
    // tv static animation
    if (this.tvH?.alive) { this.staticTex.offset.set(Math.random(), Math.random()); this.tvLight.intensity = 0.8 + Math.random() * 0.6; }
    // rocking chair
    if (this.flags.rocking) {
      const r = g.props.items.get('rocker');
      if (r) { r.rotation.x = Math.sin(t * 1.9) * 0.07; if (Math.sin(t * 1.9) > 0.995 && !this._rk) { this._rk = 1; this.sfx('floor_creak', r.position.clone().setY(U + 0.2), { volume: 0.4 }); } if (Math.sin(t * 1.9) < 0) this._rk = 0; }
    }
    // music box dancer
    if (this.musicH?.alive) g.sp.musicBox.dancer.rotation.y += dt * 2;
    // front door unlocking
    if (this.flags.unlocking && !this.flags.unlocked) {
      this.flags.unlocking = false; this.flags.unlocked = true;
      const d = g.house.doors.get('front');
      this.sfx('fuse_insert', d.worldCenter(), { volume: 0.9, rate: 0.8 });
      setTimeout(() => { d.locked = false; d.setOpen(true, 1.6); this.sfx('door_open', d.worldCenter(), { volume: 1 }); }, 900);
    }
    // ambient events
    if (this.stage >= 1 && g.entity.mode !== 'kill') {
      this.ambT -= dt;
      if (this.ambT <= 0) { this.ambT = 18 + Math.random() * 30; this.ambientEvent(); }
    }
  }

  ambientEvent() {
    const g = this.game, p = this.p.pos;
    const r = Math.random();
    const around = (d) => { const a = Math.random() * Math.PI * 2; return V(p.x + Math.cos(a) * d, p.y + 1.5 + (Math.random() < 0.3 ? 2.8 : 0), p.z + Math.sin(a) * d); };
    const hunting = g.entity.mode === 'hunt';
    if (hunting && r < 0.3) this.sfx('entity_whisper', around(3 + Math.random() * 3), { volume: 0.55 });
    else if (hunting && r < 0.45 && g.entity.pos.distanceTo(p) > 7) {
      // it calls in her voice from wherever it is — or claims to be somewhere else
      const line = ['vo_call_2', 'vo_where', 'vo_cold', 'vo_call_1', 'vo_name'][(Math.random() * 5) | 0];
      this.say(line, g.entity.pos.clone().setY(g.entity.pos.y + 1.8), { volume: 0.8 });
    } else if (r < 0.65) this.sfx('floor_creak', around(4 + Math.random() * 4), { volume: 0.5 });
    else if (r < 0.75) this.sfx('glass_rattle', g.house.windows[(Math.random() * g.house.windows.length) | 0].pos, { volume: 0.5 });
    else if (r < 0.85) this.sfx('door_close', around(7), { volume: 0.35 });
    else if (r < 0.92) this.sfx('wall_knock', around(2.5), { volume: 0.4 });
    else g.exterior.strike(0.9);
  }

  onNoteClosed() { this.flags.noteClosed = (this.flags.noteClosed || 0) + 1; }

  // ---------------------------------------------------------- checkpoints
  setCheckpoint(name) { this.checkpoint = name; }
  async restoreCheckpoint() {
    const g = this.game, sp = g.sp;
    const cp = this.checkpoint || 'hunt';
    this.waits.forEach((w) => w.rej(CANCEL)); this.waits = [];
    this.gen++;
    g.entity.stop();
    this.tvOff();
    g.power.main = false; g.power.basement = false;
    this.candlesOut(sp.candles.map((c) => c.flame));
    sp.casket.setState('empty');
    g.flashlight.give(); g.inventory.add('flashlight'); g.flashlight.on = true;
    g.flashlight.battery = Math.max(g.flashlight.battery, 0.7);
    g.house.doors.get('front').locked = !this.flags.unlocked;
    this.flags.rocking = false;
    this.refreshInv();
    g.ui.fade(0, 0.01);
    if (cp === 'hunt') {
      g.player.teleport(-3.4, U, 2.2, -Math.PI / 2);
      this.run(this.stages.indexOf('hunt'));
    } else if (cp === 'attic') {
      g.player.teleport(-0.5, U, 1.9, Math.PI);
      this.run(this.stages.indexOf('attic'));
    } else if (cp === 'escape') {
      this.flags.keyTaken = true;
      g.player.teleport(0, A, -2.4, Math.PI);
      this.flags.escapeRetry = true;
      this.run(this.stages.indexOf('escape'));
    }
  }

  // ======================================================================
  // STAGES
  // ======================================================================
  async intro() {
    const g = this.game, ui = g.ui;
    g.player.teleport(-2.2, G, 3.3, Math.PI / 2, -0.08);
    g.player.frozen = true;
    ui.subtitle('11:52 p.m.', '', 3);
    ui.fade(0, 3.5);
    await this.wait(3.5);
    g.player.frozen = false;
    await this.wait(1.0);
    this.objective('Read the note on the casket.', 'The vigil');
    await this.until(() => this.flags.read_casket && !g.ui.noteOpen);
    await this.wait(0.6);
    this.objective('Light the three candles. The matches are on the carved table, right of the far window.');
    let warned = false;
    await this.until(() => {
      if (!warned && this.flags.candlesLit >= 2) { warned = true; this.lamps.parlor.flicker = 0.9; setTimeout(() => { this.lamps.parlor.flicker = 0.1; }, 2500); }
      return (this.flags.candlesLit || 0) >= 3;
    });
    this.objective('Keep watch.');
    await this.wait(5);
  }

  async knock() {
    const g = this.game, front = g.house.doors.get('front');
    const doorPos = V(0, G + 1.4, 5.95);
    this.sfx('knock_door', doorPos, { volume: 1.0, refDistance: 2.5 });
    g.player.shake = 0.15;
    await this.wait(4);
    this.objective('Someone is knocking at the front door.');
    await this.until(() => front.open || this.near(V(0, G, 5.4), 1.0));
    await this.until(() => front.open);
    // nobody. the storm.
    await this.wait(0.8);
    g.exterior.strike(1.0, 0.4);
    // when they turn away from the door, the wind slams it
    await this.until(() => !this.looking(doorPos, 0.4) && this.p.pos.z < 5.3);
    await this.wait(0.4);
    if (front.open) { front.slam(false); this.sfx('door_slam', doorPos, { volume: 1 }); g.shock(0.6); g.player.shake = 0.5; }
    // something has changed in the parlour
    this.candlesOut([g.sp.candles[1].flame]);
    g.sp.casket.setState('turned');
    this.flags.ringPending = true;
    await this.wait(1.2);
    this.objective('Return to her.');
    await this.until(() => this.zone() === 'parlor' || this.p.pos.distanceTo(g.sp.casket.pos) < 4);
  }

  async phone() {
    const g = this.game;
    await this.wait(2.5);
    this.flags.ringing = true;
    const phonePos = V(-1.4, G + 1.3, -3.3);
    let ring = 0;
    this.objective('The telephone. In the kitchen.');
    while (!this.flags.answered) {
      if (ring <= 0) { this.sfx('phone_ring', phonePos, { volume: 1, refDistance: 2.5 }); ring = 3.6; }
      await this.wait(0.1); ring -= 0.1;
    }
    this.flags.ringing = false;
    this.sfx('phone_pickup', phonePos, { volume: 0.8 });
    g.player.frozen = true;
    const line = this.sfx('phone_line', null, { volume: 0.8, bus: 'voice' });
    ui_sub(g, '…', '', 3);
    await this.wait(4.0);
    this.say('vo_phone', null, { volume: 1.0, reverb: 0.1 });
    await this.wait(Math.max(3, g.audio.duration('vo_phone') + 0.6));
    line?.stop(0.2);
    this.sfx('phone_hangup', phonePos, { volume: 0.7 });
    await this.wait(0.7);
    // the power dies
    this.sfx('power_down', V(-3, G + 2.4, -2), { volume: 1 });
    await this.wait(0.35);
    g.power.main = false;
    this.candlesOut(g.sp.candles.map((c) => c.flame));
    g.player.frozen = false;
    g.shock(0.4);
    await this.wait(1.5);
    g.exterior.strike(0.8, 1.2);
    this.flags.flashlightAllowed = true;
    this.objective('Find light. She kept a flashlight in a kitchen drawer.');
    await this.until(() => this.flags.gotFlashlight);
    g.ui.hint('F — flashlight', 4);
    await this.until(() => g.flashlight.on);
    this.objective('Restore the power. The fuse box is in the cellar — through the back room.');
    // a figure at the end of the hall, once
    await this.until(() => this.zone() === 'hall' && this.p.pos.z < 1 && this.p.pos.y < 1);
    const at = V(0.1, G, 5.3);
    g.entity.appear(at, 'stand', { vanishUnseen: 0.25, timeout: 25, onSeen: () => { this.sfx('sting_low', null, { volume: 0.8 }); g.shock(0.5); } });
  }

  async cellar() {
    const g = this.game;
    const cellarDoor = g.house.doors.get('cellar');
    await this.until(() => this.p.pos.y < -1.6);
    // the door above eases shut behind you
    await this.wait(1.2);
    if (cellarDoor.open) { cellarDoor.setOpen(false, 0.4); this.sfx('door_close', cellarDoor.worldCenter(), { volume: 0.8, rate: 0.85 }); }
    this.objective('Find a spare fuse.');
    await this.until(() => this.p.pos.y < -2.8);
    await this.wait(6);
    // footsteps cross the floor above you, toward the parlour
    const above = this.p.pos.clone().setY(G + 0.1);
    this.sfx('footsteps_above', above, { volume: 1.0, refDistance: 3, occlude: false });
    await this.wait(7);
    this.sfx('drag_above', V(-3.5, G + 0.1, 2.5), { volume: 1.0, refDistance: 3, occlude: false });
    await this.until(() => this.has('fuse'));
    this.objective('Fit the fuse in the fuse box.');
    this.sfx('wall_knock', V(-6.9, B + 1.2, 2.0), { volume: 0.8 });
    // while you are down here, the house changes
    g.sp.casket.setState('empty');
    for (const s of g.sp.photoSwaps) s.mesh.material.map = s.scratched;
    g.house.doors.get('front').locked = true;
    await this.until(() => this.flags.fuseFitted);
    this.sfx('fuse_insert', V(-6.7, B + 1.5, -3.8), { volume: 1 });
    await this.wait(0.8);
    this.sfx('power_up', V(-4, B + 2.5, -3), { volume: 1 });
    await this.wait(0.3);
    g.power.basement = true; g.power.main = true;
    await this.wait(3.5);
    this.say('vo_call_1', V(-3.5, G + 1.6, 3.0), { volume: 0.9 });
    this.objective('Go back upstairs.');
  }

  async returning() {
    const g = this.game, sp = g.sp;
    await this.until(() => this.p.pos.y > -0.3);
    // the television in the back room
    await this.wait(0.8);
    this.tvOn();
    g.shock(0.3);
    // the wheelchair has moved to the foot of the stairs
    const wc = g.props.items.get('wheelchair');
    if (wc) { wc.position.set(-0.55, G, 2.9); wc.rotation.y = Math.PI; if (wc.userData.collider) { wc.userData.collider.cx = -0.55; wc.userData.collider.cz = 2.9; wc.userData.collider.enabled = false; } }
    this.objective('Check on her.');
    // the empty casket
    await this.until(() => this.looking(sp.casket.pos.clone().setY(G + 0.8), 0.85, 6));
    this.sfx('stinger', null, { volume: 0.8 });
    g.shock(0.7); g.player.shake = 0.4;
    await this.wait(2.5);
    this.say('vo_cold', V(0.6, U + 1.6, 2.0), { volume: 0.75 });
    this.objective('She is gone. Get out of the house.');
    await this.until(() => this.flags.triedFront || g.house.doors.get('front').locked && this.near(V(0, G, 5.4), 0.9));
    await this.wait(1.5);
    this.objective('The front door is locked and the key is gone. Her room is upstairs.');
    this.flags.rocking = true;
    g.house.doors.get('bedM').setOpen(true, 0.3);
  }

  async diary() {
    const g = this.game;
    await this.until(() => this.zone() === 'bedM');
    this.objective('Her diary is by the bed.');
    await this.until(() => this.flags.diaryRead && !g.ui.noteOpen);
    this.flags.rocking = false;
    await this.wait(1.0);
    // the lights die. for good.
    this.sfx('power_down', V(-1, U + 2.4, 1), { volume: 1 });
    g.surge = 1.2;
    await this.wait(1.0);
    g.power.main = false; g.power.basement = false;
    this.tvOff();
    await this.wait(1.2);
    // a creak behind you, in the doorway
    const door = V(-0.75, U, 1.45);
    this.sfx('floor_creak', door.clone().setY(U + 0.2), { volume: 0.9 });
    g.entity.placeAt(door, 'stand', this.p.pos);
    g.entity.mode = 'hunt'; g.entity.cfg = { interval: [3.8, 5.5], step: 2.2, killDist: 1.4, lunge: 1.0, react: 0.55 };
    g.entity.nextMove = 6;
    g.ui.hint('It cannot move while it is seen. Keep the light on it.', 7);
    this.setCheckpoint('hunt');
    g.ambTarget.dread = 0.35; g.ambTarget.hunt = 0.6;
  }

  async hunt() {
    const g = this.game;
    if (g.entity.mode !== 'hunt') {
      // restored from checkpoint
      g.entity.placeAt(V(-0.6, U, 4.6), 'stand', this.p.pos);
      g.entity.startHunt({ interval: [3.8, 5.5], step: 2.2, killDist: 1.4, lunge: 1.0, react: 0.55, firstDelay: 5 });
      g.ambTarget.dread = 0.35; g.ambTarget.hunt = 0.6;
    }
    this.objective('Find the key. Something is up in the attic — the hatch is on the landing.');
    // music box in your old room
    let mbStarted = false;
    await this.until(() => {
      if (!mbStarted && this.zone() === 'child') {
        mbStarted = true;
        this.musicH = this.sfx('music_box', g.sp.musicBox.group.position, { volume: 0.8, refDistance: 1.2 });
        g.sp.musicBox.lid.rotation.x = -1.9;
      }
      return this.flags.hatchOpen;
    });
    // let it breathe for a moment
    g.entity.stop();
    this.setCheckpoint('attic');
    g.ambTarget.hunt = 0.0;
  }

  async attic() {
    const g = this.game, sp = g.sp;
    if (!this.flags.hatchOpen) this.openHatch();
    for (const f of sp.atticFlames) f.lit = true;
    this.objective('Climb into the attic.');
    await this.until(() => this.zone() === 'attic');
    g.ambTarget.dread = 0.5;
    this.say('vo_lullaby_hum', V(0, A + 0.5, -4.2), { volume: 0.7, text: '(humming)' });
    await this.until(() => this.near(V(0, A, -4.2), 3.2));
    this.objective('The key.');
    await this.until(() => this.flags.keyTaken);
    this.give('key');
    sp.key.visible = false;
    this.sfx('pickup', sp.key.position);
    await this.wait(0.6);
    // every candle goes out at once
    this.candlesOut(sp.atticFlames);
    this.sfx('candle_out', V(0, A + 0.5, -4.2), { volume: 1 });
    g.shock(0.5);
    await this.wait(1.0);
    this.say('vo_coat', V(0, A + 0.6, -4.2), { volume: 1 });
    sp.shrine.body.visible = false;
    this.setCheckpoint('escape');
  }

  async escape() {
    const g = this.game, sp = g.sp;
    sp.key.visible = false; sp.shrine.body.visible = false; this.candlesOut(sp.atticFlames);
    if (!this.has('key')) this.give('key');
    // it waits between you and the hatch
    g.entity.placeAt(V(1.55, A, 2.2), 'crouch', this.p.pos);
    g.entity.startHunt({ interval: [1.5, 2.4], step: 3.2, killDist: 1.45, lunge: 1.8, react: 0.35, firstDelay: 2.5 });
    g.ambTarget.dread = 0.4; g.ambTarget.hunt = 1.0;
    this.objective('Get out. The front door.');
    if (this.flags.escapeRetry) g.ui.hint('Keep the light on it as you pass.', 5);
    await this.until(() => this.p.pos.y < U + 0.3);
    this.setCheckpoint('escape');
    // it is faster now
    g.entity.cfg.interval = [1.1, 1.9]; g.entity.cfg.step = 3.6; g.entity.cfg.lunge = 2.2; g.entity.cfg.react = 0.3;
    await this.until(() => this.p.pos.y < 0.5 && this.p.pos.y > -0.5);
    this.say('vo_found', g.entity.pos.clone().setY(g.entity.pos.y + 1.8), { volume: 1 });
    await this.until(() => this.p.pos.z > 7.0);
    await this.ending();
  }

  async ending() {
    const g = this.game, ui = g.ui;
    g.entity.stop();
    g.player.frozen = true;
    const front = g.house.doors.get('front');
    front.slam(false); this.sfx('door_slam', front.worldCenter(), { volume: 1 });
    g.ambTarget.hunt = 0; g.ambTarget.dread = 0;
    await ui.fade(1, 3);
    g.audio.stopAll(2);
    g.state = 'end';
    ui.el.hud.classList.add('hidden');
    ui.el.end.classList.remove('hidden');
    const txt = ui.el.endText;
    const lines = ['The vigil ended at 3:12 a.m.', 'Dawn was at 6:58.', '', 'You never went back for her.'];
    txt.textContent = '';
    for (const l of lines) { txt.textContent += l + '\n'; await sleep(2200); }
    await sleep(2500);
    g.audio.play('phone_ring', { volume: 0.5, bus: 'ui', reverb: 0.6 });
    await sleep(3600);
    g.audio.play('phone_ring', { volume: 0.5, bus: 'ui', reverb: 0.6 });
    await sleep(3000);
    g.audio.play('vo_phone_end', { volume: 0.9, bus: 'ui' });
    if (g.ui.subsOn) txt.textContent += '\n“Eli. Come back inside.”';
    await sleep(5000);
    txt.textContent += '\n\nVIGIL';
    ui.el.again.classList.remove('hidden');
    g.input.exitLock();
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ui_sub(g, t, who, s) { g.ui.subtitle(t, who, s); }

function makeStaticTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.5, 0.5); t.colorSpace = THREE.SRGBColorSpace; return t;
}
