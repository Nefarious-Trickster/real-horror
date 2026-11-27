import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL + 'assets/audio/';
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

// AudioEngine: buffers from manifest, HRTF spatialisation, a generated
// convolution reverb send, per-source occlusion low-pass, mix buses.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.defs = {};
    this.groups = new Map();
    this.active = new Set();
    this.occluder = null; // fn(fromVec3, toVec3) -> 0..1 occlusion amount
    this.listenerPos = new THREE.Vector3();
    this.lastPick = new Map();
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 22000;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.knee.value = 8; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
    this.master.connect(this.muffle).connect(this.comp).connect(ctx.destination);

    this.bus = {};
    for (const b of ['sfx', 'amb', 'music', 'voice', 'ui']) {
      const g = ctx.createGain(); g.connect(this.master); this.bus[b] = g;
    }
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(this.reverb);

    try {
      const res = await fetch(BASE + 'manifest.json');
      const man = await res.json();
      this.defs = man.sounds || {};
    } catch (e) { console.warn('audio manifest missing', e); this.defs = {}; }
    for (const [id, d] of Object.entries(this.defs)) {
      const g = d.group || id.replace(/_\d+$/, '');
      if (!this.groups.has(g)) this.groups.set(g, []);
      this.groups.get(g).push(id);
    }
  }

  async loadAll(onProgress) {
    const ids = Object.keys(this.defs);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(BASE + this.defs[id].file);
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers.set(id, buf);
      } catch (e) { console.warn('audio load fail', id, e); }
      done++; onProgress?.(done / ids.length);
    }));
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + diffuse tail, darkened over time
        const n = Math.random() * 2 - 1;
        const a = 0.05 + 0.95 * (1 - t);
        lp += (n - lp) * (0.9 - 0.75 * t);
        d[i] = lp * Math.pow(1 - t, decay) * a;
        if (i < rate * 0.08 && Math.random() < 0.004) d[i] += (Math.random() * 2 - 1) * 0.6;
      }
    }
    return buf;
  }

  setReverb(amount, seconds) {
    if (!this.ctx) return;
    this.reverbGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.5);
    if (seconds && Math.abs(seconds - (this._revSec || 0)) > 0.3) {
      this._revSec = seconds;
      this.reverb.buffer = this.makeImpulse(seconds, 2.0);
    }
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  setMuffle(on) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 900 : 22000, this.ctx.currentTime, 0.15);
  }

  resolve(name) {
    if (this.defs[name]) {
      // explicit id; but if it's also a group name and has variants, randomise
      if (!this.groups.has(name) || this.groups.get(name).length <= 1) return name;
    }
    const g = this.groups.get(name);
    if (!g || !g.length) return this.defs[name] ? name : null;
    if (g.length === 1) return g[0];
    let pick;
    const last = this.lastPick.get(name);
    do { pick = g[(Math.random() * g.length) | 0]; } while (pick === last && g.length > 1);
    this.lastPick.set(name, pick);
    return pick;
  }

  has(name) { return !!this.resolve(name); }

  duration(name) {
    const id = this.resolve(name); const b = id && this.buffers.get(id); return b ? b.duration : 0;
  }

  // opts: pos (Vector3) | follow (Object3D), volume, rate, loop, bus, reverb, delay,
  //       refDistance, rolloff, fadeIn, offset, detune, occlude(bool)
  play(name, opts = {}) {
    if (!this.ctx) return null;
    const id = this.resolve(name);
    if (!id) return null;
    const buf = this.buffers.get(id);
    if (!buf) return null;
    const def = this.defs[id] || {};
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop ?? !!def.loop;
    src.playbackRate.value = (opts.rate ?? 1) * (opts.jitter ? 1 + (Math.random() - 0.5) * opts.jitter : 1);
    const gain = ctx.createGain();
    const vol = (opts.volume ?? 1) * (def.volume ?? 1);
    const t0 = ctx.currentTime + (opts.delay || 0);
    if (opts.fadeIn) { gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(vol, t0 + opts.fadeIn); }
    else gain.gain.value = vol;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = opts.lowpass ?? 22000; lp.Q.value = 0.5;
    src.connect(lp).connect(gain);

    let panner = null;
    const spatial = (opts.pos || opts.follow) && (opts.spatial ?? def.spatial ?? true);
    const bus = this.bus[opts.bus || def.bus || (def.group?.startsWith('vo') || id.startsWith('vo_') ? 'voice' : id.startsWith('amb') ? 'amb' : 'sfx')] || this.bus.sfx;
    if (spatial) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.refDistance ?? 1.2;
      panner.rolloffFactor = opts.rolloff ?? 1.4;
      panner.maxDistance = 60;
      const p = opts.pos || opts.follow.getWorldPosition(_v);
      panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z;
      gain.connect(panner).connect(bus);
      const send = ctx.createGain(); send.gain.value = opts.reverb ?? 0.6;
      panner.connect(send).connect(this.reverbSend);
    } else {
      gain.connect(bus);
      if ((opts.reverb ?? 0) > 0) {
        const send = ctx.createGain(); send.gain.value = opts.reverb;
        gain.connect(send).connect(this.reverbSend);
      }
    }
    src.start(t0, opts.offset ? opts.offset % buf.duration : 0);

    const h = {
      id, src, gain, lp, panner, follow: opts.follow || null, pos: opts.pos ? opts.pos.clone() : null,
      occlude: opts.occlude ?? spatial, baseLP: opts.lowpass ?? 22000, vol, alive: true,
      stop: (fade = 0.05) => {
        if (!h.alive) return; h.alive = false;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fade);
        try { src.stop(now + fade + 0.02); } catch (e) {}
        this.active.delete(h);
      },
      setVolume: (v, time = 0.1) => { h.vol = v; gain.gain.setTargetAtTime(v, ctx.currentTime, time); },
      setRate: (r) => { src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.1); },
      setPos: (p) => { if (!panner) return; h.pos = p.clone(); panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z; },
    };
    src.onended = () => { h.alive = false; this.active.delete(h); };
    this.active.add(h);
    if (h.occlude && this.occluder) this.applyOcclusion(h, true);
    return h;
  }

  applyOcclusion(h, instant) {
    const p = h.follow ? h.follow.getWorldPosition(_v) : h.pos;
    if (!p) return;
    const occ = this.occluder(p, this.listenerPos); // 0..1
    const f = Math.min(h.baseLP, 22000 * Math.pow(0.04, occ));
    if (instant) h.lp.frequency.value = f;
    else h.lp.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.12);
  }

  update(camera, dt) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    camera.getWorldPosition(this.listenerPos);
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const p = this.listenerPos;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
      L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z;
    } else {
      L.setPosition(p.x, p.y, p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
    this._occT = (this._occT || 0) + dt;
    const doOcc = this._occT > 0.15;
    if (doOcc) this._occT = 0;
    for (const h of this.active) {
      if (h.follow && h.panner) {
        h.follow.getWorldPosition(_v);
        h.panner.positionX.value = _v.x; h.panner.positionY.value = _v.y; h.panner.positionZ.value = _v.z;
      }
      if (doOcc && h.occlude && this.occluder) this.applyOcclusion(h, false);
    }
  }

  stopAll(fade = 0.3) { for (const h of [...this.active]) h.stop(fade); }
}
