import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { AudioEngine } from './engine/audio.js';
import { Materials } from './world/materials.js';
import { buildHouse } from './world/house.js';
import { Props, PLACEMENTS } from './world/props.js';
import { Exterior } from './world/exterior.js';
import { buildSetpieces } from './world/setpieces.js';
import { Player } from './game/player.js';
import { Flashlight } from './game/flashlight.js';
import { Interact } from './game/interact.js';
import { Entity } from './game/entity.js';
import { Director } from './game/director.js';
import { UI } from './ui/ui.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.R = new Renderer(this.canvas);
    this.renderer = this.R.renderer; this.scene = this.R.scene; this.camera = this.R.camera;
    this.scene.add(this.camera);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.ui = new UI(this);
    this.gltfLoader = new GLTFLoader();
    this.state = 'loading';
    this.time = 0;
    this.dread = 0; this.shockV = 0; this.tear = 0; this.redV = 0;
    this.power = { main: true, basement: false };
    this.surge = 0;
    this.inventory = new Set();
    this.heartT = 0;
    this.settings = { sens: 1, vol: 1, gamma: 1.3, subs: true };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('vigil.settings.v2') || '{}')); } catch (e) {}
    this.clock = new THREE.Clock();
  }

  async boot() {
    const ui = this.ui;
    const steps = { tex: 0, models: 0, audio: 0, entity: 0 };
    const prog = () => ui.loading(steps.tex * 0.1 + steps.models * 0.45 + steps.audio * 0.35 + steps.entity * 0.1);
    this.mats = new Materials(this.renderer);
    await this.mats.init(); steps.tex = 1; prog();
    // environment for faint reflections only
    new RGBELoader().load(import.meta.env.BASE_URL + 'assets/textures/env_night.hdr', (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = hdr; this.scene.environmentIntensity = 0.035;
    }, undefined, () => {});
    this.house = buildHouse(this.mats);
    this.interact = new Interact(this);
    this.props = new Props(this);
    ui.loading(0.1, 'Carrying in the furniture…');
    const pModels = this.props.init((p) => { steps.models = p; prog(); });
    await this.audio.init();
    ui.loading(0.15, 'Listening to the house…');
    const pAudio = this.audio.loadAll((p) => { steps.audio = p; prog(); });
    this.entity = new Entity(this);
    const pEnt = this.entity.load().then(() => { steps.entity = 1; prog(); });
    await Promise.all([pModels, pAudio, pEnt]);
    ui.loading(1, 'Lighting the lamps…');
    for (const p of PLACEMENTS) {
      const [id, x, y, z, rot, opts = {}] = p;
      this.props.place(id, x, y + (opts.y || 0), z, rot, opts);
    }
    this.house.finalize(this.scene);
    this.exterior = new Exterior(this);
    this.player = new Player(this);
    this.flashlight = new Flashlight(this);
    this.sp = buildSetpieces(this);
    this.audio.occluder = (from, to) => this.house.occlusion(from, to);
    this.director = new Director(this);
    this.director.setup();
    this.player.teleport(-2.2, 0, 3.3, Math.PI / 2);
    this.player.applyCamera(0);
    // warm up shaders
    this.renderer.compile(this.scene, this.camera);
    this.R.render(0.016, 0);
    this.applySettings();
    this.bindUI();
    ui.ready();
    this.state = 'title';
    this.loop();
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sens;
    this.audio.setVolume?.(s.vol);
    this.R.fx.uGamma.value = s.gamma;
    this.ui.subsOn = s.subs;
    try { localStorage.setItem('vigil.settings.v2', JSON.stringify(s)); } catch (e) {}
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    const bind = (id, key, num = true) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = this.settings[key]; else el.value = this.settings[key];
      el.addEventListener('input', () => { this.settings[key] = el.type === 'checkbox' ? el.checked : +el.value; this.applySettings(); });
    };
    bind('sens', 'sens'); bind('vol', 'vol'); bind('gamma', 'gamma'); bind('subs', 'subs');
    $('start').addEventListener('click', () => this.startGame());
    $('resume').addEventListener('click', () => this.resume());
    $('retry').addEventListener('click', () => this.retry());
    $('restartCp').addEventListener('click', () => { this.ui.el.pause.classList.add('hidden'); this.retry(); });
    $('again').addEventListener('click', () => location.reload());
    this.input.onLockChange = (locked, failed) => {
      if (!locked && this.state === 'playing' && !failed && !this.ui.noteOpen) this.pause();
      if (failed) this.ui.hint('Click and drag to look around', 5);
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'playing' && this.input.dragLook) this.pause();
      else if (e.code === 'Escape' && this.state === 'paused' && this.input.dragLook) this.resume();
    });
    this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.requestLock(); });
  }

  async startGame() {
    this.input.requestLock();
    if (this.audio.ctx.state !== 'running') await this.audio.ctx.resume();
    this.ui.el.title.classList.add('hidden');
    this.ui.el.hud.classList.remove('hidden');
    this.input.enabled = true;
    // cut to black, then the intro fades in from it
    const f = this.ui.el.fade; f.style.transition = 'none'; f.style.opacity = 1; void f.offsetWidth;
    this.state = 'playing';
    this.startAmbience();
    this.director.start();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.el.pause.classList.remove('hidden');
    // move settings into pause
    const st = document.getElementById('settings');
    document.getElementById('settings2').appendChild(st); st.classList.remove('hidden');
    this.audio.ctx.suspend();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ui.el.pause.classList.add('hidden');
    this.state = 'playing';
    this.audio.ctx.resume();
    this.input.requestLock();
    this.clock.getDelta();
  }

  // ---------------------------------------------------------- ambience
  startAmbience() {
    const a = this.audio;
    this.amb = {
      rain: a.play('amb_rain_interior', { loop: true, volume: 0.0, bus: 'amb', fadeIn: 3 }),
      tone: a.play('amb_house_tone', { loop: true, volume: 0.0, bus: 'amb', fadeIn: 3 }),
      dread: a.play('amb_dread', { loop: true, volume: 0.0, bus: 'amb' }),
      hunt: a.play('amb_hunt', { loop: true, volume: 0.0, bus: 'music' }),
      basement: a.play('amb_basement', { loop: true, volume: 0.0, bus: 'amb' }),
      attic: a.play('amb_attic', { loop: true, volume: 0.0, bus: 'amb' }),
    };
    const clock = this.props.items.get('clock');
    if (clock) this.clockTick = a.play('clock_tick', { loop: true, pos: clock.position.clone().setY(1.4), volume: 0.7, refDistance: 1.5 });
    this.fridgeHum = a.play('fridge_hum', { loop: true, pos: this.sp.fridge.position, volume: 0.45, refDistance: 1.2 });
    this.ambTarget = { dread: 0, hunt: 0 };
  }

  updateAmbience(dt) {
    if (!this.amb) return;
    const z = this.house.zoneAt(this.player.pos);
    const id = z?.id || 'hall';
    const inBase = id === 'basement' || (id === 'stairwell' && this.player.pos.y < -1);
    const inAttic = id === 'attic';
    const frontOpen = this.house.doors.get('front').angle !== 0;
    const rainV = inBase ? 0.12 : inAttic ? 0.9 : id === 'porch' ? 1.0 : frontOpen && this.player.pos.y < 1 ? 0.85 : 0.5;
    const set = (h, v) => h?.setVolume(v, 0.8);
    set(this.amb.rain, rainV);
    set(this.amb.tone, inBase ? 0.15 : 0.35);
    set(this.amb.basement, inBase ? 0.7 : 0);
    set(this.amb.attic, inAttic ? 0.7 : 0);
    const e = this.entity;
    const near = e.mode !== 'off' && e.model.object.visible ? Math.max(0, 1 - e.pos.distanceTo(this.player.pos) / 14) : 0;
    set(this.amb.dread, Math.min(0.9, this.ambTarget.dread + this.dread * 0.5));
    set(this.amb.hunt, (e.mode === 'hunt' || e.mode === 'search') ? (this.ambTarget.hunt * (0.25 + near * 0.75)) : 0);
    if (z && z.reverb && z !== this._lastZone) { this.audio.setReverb(z.reverb[0], z.reverb[1]); this._lastZone = z; }
    this.fridgeHum?.setVolume(this.power.main ? 0.45 : 0, 0.3);
  }

  // ---------------------------------------------------------- fx
  shock(v) { this.shockV = Math.max(this.shockV, v); }

  updateFX(dt) {
    const fx = this.R.fx;
    // dread decays
    if (this.entity.seenAmt < 0.05) this.dread = Math.max(0, this.dread - dt * 0.09);
    if (this.dread >= 1) {
      // overload: the light gutters out and it flees from it
      this.flashlight.dead = 0.8; this.dread = 0.35; this.tear = 1; this.shock(0.7);
      this.audio.play('flashlight_flicker', { volume: 0.8 });
      this.audio.play('tinnitus', { volume: 0.5 });
      this.entity.recoil();
    }
    this.shockV = Math.max(0, this.shockV - dt * 1.6);
    this.tear = Math.max(0, this.tear - dt * 1.8);
    fx.uDread.value += (Math.min(1, this.dread) - fx.uDread.value) * Math.min(1, dt * 3);
    fx.uShock.value = this.shockV;
    fx.uTear.value = this.tear;
    fx.uRed.value = this.redV;
    this.camera.fov = this.R.baseFov - fx.uDread.value * 8 + (this.player.running ? 3 : 0) + this.shockV * 4;
    this.camera.updateProjectionMatrix();
    // heartbeat
    const bpm = 58 + Math.min(1, this.dread) * 90 + (this.player.running ? 20 : 0);
    if (this.dread > 0.2 || this.entity.mode === 'search') {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 60 / bpm;
        this.audio.play('heartbeat', { volume: 0.25 + Math.min(1, this.dread) * 0.75, bus: 'ui' });
      }
    }
    // scared breathing
    const wantBreath = this.dread > 0.45 || (this.player.stamina < 0.3);
    if (wantBreath && !this.breathH?.alive) this.breathH = this.audio.play('breath_scared', { loop: true, volume: 0.0, bus: 'ui' });
    if (this.breathH) this.breathH.setVolume(wantBreath && !this.player.breathHeld ? 0.35 + this.dread * 0.3 : 0, 0.5);
  }

  // ---------------------------------------------------------- death
  async killPlayer(reason) {
    if (this.state !== 'playing' || this.dying) return;
    this.dying = true;
    const e = this.entity, p = this.player, cam = this.camera;
    e.mode = 'kill';
    if (p.hiding) { p.exitHide(); this.ui.setHiding(false); }
    p.frozen = true; p.lookLocked = true;
    // blackout, then it is right there
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    const at = p.pos.clone().addScaledVector(fwd, 0.66);
    at.y = p.pos.y;
    e.placeAt(at, 'jumpscare', p.pos);
    e.model.setJaw(1);
    e.model.object.traverse((o) => { if (o.isMesh || o.isLine || o.isLineSegments) { if (o.userData.cs == null) o.userData.cs = o.castShadow; o.castShadow = false; } });
    e.model.object.updateMatrixWorld(true);
    const face = e.model.faceAnchor.getWorldPosition(new THREE.Vector3());
    e.model.object.position.y += (cam.position.y - face.y) * 0.92;
    e.model.object.updateMatrixWorld(true);
    p.lookTarget = e.model.faceAnchor.getWorldPosition(new THREE.Vector3()); p.lookBlend = 1;
    this._flBase = this._flBase || this.flashlight.baseIntensity;
    this.flashlight.has = true; this.flashlight.on = true; this.flashlight.battery = Math.max(0.5, this.flashlight.battery);
    this.flashlight.dead = 0.22; this.flashlight.flicker = 0;
    this.flashlight.baseIntensity = 4.5;
    this.audio.play('jumpscare', { volume: 1.0, bus: 'ui', delay: 0.18 });
    const t0 = this.time;
    await new Promise((r) => {
      const tick = () => {
        const t = this.time - t0;
        if (t > 0.2) { this.shock(0.55); this.tear = Math.max(this.tear, 0.35); p.shake = Math.max(p.shake, 1.1); }
        if (t > 0.75) this.flashlight.flicker = 0.2;
        e.model.object.position.addScaledVector(fwd, -0.0015);
        this.redV = Math.max(0, Math.min(0.6, (t - 0.3) * 0.7));
        if (t > 1.7) r(); else requestAnimationFrame(tick);
      };
      tick();
    });
    this.R.fx.uBlack.value = 1;
    this.audio.stopAll(0.05);
    this.audio.play('tinnitus', { volume: 0.4, bus: 'ui' });
    this.state = 'dead';
    this.input.exitLock();
    const lines = {
      dark: ['It moved while you could not see it.', 'Keep the light on it.', 'The dark belongs to it.'],
      found: ['It heard you breathing.', 'Hold your breath when it is close.'],
    }[reason] || ['You broke the vigil.'];
    this.ui.el.deathText.textContent = lines[(Math.random() * lines.length) | 0];
    this.ui.el.death.classList.remove('hidden');
    this.ui.el.hud.classList.add('hidden');
  }

  async retry() {
    this.ui.el.death.classList.add('hidden');
    this.ui.el.hud.classList.remove('hidden');
    this.R.fx.uBlack.value = 0;
    this.redV = 0; this.dread = 0; this.shockV = 0;
    this.dying = false;
    this.player.frozen = false; this.player.lookLocked = false; this.player.lookTarget = null; this.player.lookBlend = 0;
    this.entity.model.setJaw(0);
    this.entity.model.object.traverse((o) => { if (o.userData.cs != null) o.castShadow = o.userData.cs; });
    if (this._flBase) this.flashlight.baseIntensity = this._flBase;
    this.flashlight.dead = 0; this.flashlight.flicker = 0;
    this.state = 'playing';
    this.input.requestLock();
    this.audio.stopAll(0.05);
    this.startAmbience();
    await this.director.restoreCheckpoint();
  }

  // ---------------------------------------------------------- hiding
  hideIn(spot) {
    this.player.enterHide(spot);
    this.ui.setHiding(true);
    this._flOnBeforeHide = this.flashlight.on;
    this.flashlight.on = false;
    this.audio.play('wardrobe_close', { pos: spot.pos.clone().setY(spot.pos.y + 1), volume: 0.7 });
  }
  leaveHide() {
    const spot = this.player.hiding;
    this.player.exitHide();
    this.ui.setHiding(false);
    this.audio.play('wardrobe_open', { pos: spot.pos.clone().setY(spot.pos.y + 1), volume: 0.7 });
    if (this._flOnBeforeHide) this.flashlight.on = true;
  }

  // dynamic resolution: keep frame time near 16-20 ms
  adaptResolution() {
    const now = performance.now();
    if (this._frT == null) { this._frT = now; this._frN = 0; this.pixelRatio = this.renderer.getPixelRatio(); return; }
    this._frN++;
    const el = now - this._frT;
    if (el < 2000) return;
    const ms = el / this._frN; this._frT = now; this._frN = 0;
    if (this.state !== 'playing' || this.debugDt) return;
    const max = Math.min(window.devicePixelRatio, 1.5);
    let pr = this.pixelRatio;
    if (ms > 24) pr = Math.max(0.6, pr - 0.2); else if (ms < 13 && pr < max) pr = Math.min(max, pr + 0.1);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.R.resize();
    }
  }

  // ---------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(() => this.loop());
    let dt = this.debugDt || Math.min(0.05, this.clock.getDelta());
    if (this.state === 'paused') { return; }
    if (this.state === 'dead' || this.state === 'end') { this.time += dt; this.R.render(dt, this.time); return; }
    this.time += dt;
    const t = this.time;
    const inp = this.input;
    if (this.state === 'playing') {
      if (this.ui.noteOpen) {
        inp.consumeMouse();
        if (inp.hit('KeyE') || inp.hit('Escape') || inp.clicked) { this.ui.closeNote(); this.director.onNoteClosed?.(); }
      } else {
        this.player.update(dt, inp);
        if (inp.hit('KeyF')) this.flashlight.toggle();
        if (inp.hit('KeyE')) this.interact.use();
        if (inp.hit('Tab') || inp.hit('KeyQ')) this.ui.showObjective();
      }
    } else {
      // title: slow drift of the camera
      this.player.yaw = Math.PI / 2 + Math.sin(t * 0.1) * 0.15; this.player.pitch = -0.12 + Math.sin(t * 0.13) * 0.03;
      this.player.applyCamera(dt);
    }
    if (this.surge > 0) this.surge -= dt;
    for (const d of this.house.doors.values()) d.update(dt);
    this.flashlight.update(dt, t);
    this.props.update(dt, t);
    this.exterior.update(dt, t);
    if (this.state === 'playing') {
      this.entity.update(dt, t);
      this.interact.update();
      this.director.update(dt, t);
      this.updateFX(dt);
      this.updateAmbience(dt);
      this.ui.update(dt);
    }
    this.audio.update(this.camera, dt);
    inp.endFrame();
    this.adaptResolution();
    this.R.render(dt, t);
  }
}

const game = new Game();
window.__game = game;
game.boot().catch((e) => { console.error(e); document.getElementById('loadText').textContent = 'Something went wrong: ' + e.message; });
