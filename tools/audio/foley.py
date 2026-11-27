"""Foley: footsteps, doors, house, objects."""
import numpy as np
from lib import *
from sfx import *
from reg import sound, variants


# ------------------------------------------------------------------ footsteps
def _step(seed, surface):
    r = np.random.default_rng(seed)
    n = N(0.7)
    out = np.zeros(n)
    t_toe = r.uniform(0.045, 0.085)
    for k, (t0, a) in enumerate([(0.0, 1.0), (t_toe, r.uniform(0.3, 0.55))]):
        if surface == 'wood':
            body = board_body(seed * 7 + k, 85, 1500, dmax=0.07)
            hit = impact(body, 0.004 if k == 0 else 0.002, 2500 if k == 0 else 5000, thump_f=r.uniform(70, 100), thump_tau=0.035, thump_gain=0.8 if k == 0 else 0.2, seed=seed + k)
            scuff = bp(white(N(0.04)), 1200, 6000) * env_exp(N(0.04), 0.01) * 0.12
        elif surface == 'concrete':
            body = wood_ir(300, 4000, n=16, dmin=0.002, dmax=0.012, seed=seed * 7 + k, dur=0.1)
            hit = impact(body, 0.0015, 7000, thump_f=r.uniform(55, 75), thump_tau=0.025, thump_gain=0.5 if k == 0 else 0.1, seed=seed + k)
            g = N(0.06)
            grit = impulse_train(g, 900, env_exp(g, 0.02), jitter=1.0, seed=seed + 40 + k)
            grit = hp(conv(grit, excite(0.0005, 10000))[:g], 2500) * 0.6
            scuff = mix(grit, bp(white(N(0.05)), 2000, 9000) * env_exp(N(0.05), 0.012) * 0.25)
        else:  # carpet
            body = wood_ir(60, 600, n=12, dmin=0.006, dmax=0.03, seed=seed * 7 + k, dur=0.15)
            hit = impact(body, 0.008, 700, thump_f=r.uniform(55, 70), thump_tau=0.03, thump_gain=0.9, seed=seed + k)
            nz = N(0.09)
            scuff = lp(white(nz), 1600) * env_points(nz, [(0, 0), (0.01, 1), (0.09, 0)]) * 0.35
        place(out, hit * a, N(t0))
        place(out, scuff * a, N(t0 + 0.002))
    if surface == 'wood' and seed % 2 == 0:  # a faint board creak under weight
        cr = creak(r.uniform(0.18, 0.3), lambda u: 70 + 160 * u ** 0.7, board_body(seed + 99, 120, 1200), jitter=0.35, seed=seed)
        place(out, cr / peak(cr) * 0.22, N(t_toe + 0.02))
    if surface == 'concrete' and seed % 2:
        sc = bp(white(N(0.12)), 1500, 7000) * env_points(N(0.12), [(0, 0), (0.02, 1), (0.12, 0)]) * 0.08
        place(out, sc, N(t_toe + 0.03))
    ir = room('small') if surface != 'concrete' else room('basement')
    return reverb(out, ir, wet=0.09 if surface != 'concrete' else 0.12)


@variants('footstep_wood', 6, volume=0.45)
def footstep_wood(i):
    return _step(10 + i, 'wood')


@variants('footstep_concrete', 4, volume=0.45)
def footstep_concrete(i):
    return _step(30 + i, 'concrete')


@variants('footstep_carpet', 4, volume=0.4)
def footstep_carpet(i):
    return _step(50 + i, 'carpet')


@variants('stair_creak', 3, volume=0.5)
def stair_creak(i):
    r = np.random.default_rng(70 + i)
    d = r.uniform(0.45, 0.85)
    shapes = [lambda u: 60 + 220 * np.sin(np.pi * u) ** 1.5,
              lambda u: 140 + 120 * u + 60 * np.sin(9 * u),
              lambda u: 45 + 330 * u ** 2]
    cr = creak(d, shapes[i - 1], board_body(70 + i, 100, 1400, 0.1), jitter=0.3, seed=70 + i, squeal=0.15)
    th = impact(board_body(80 + i, 70, 900), 0.006, 1500, thump_f=65, thump_gain=0.8, seed=i)
    y = mix(th * 0.5, np.pad(cr / peak(cr), (N(0.03), 0)))
    return reverb(y, room('hall'), 0.18)


@variants('floor_creak', 5, volume=0.55, desc='house settling: 1-3 long groans, 4-5 sharp pops')
def floor_creak(i):
    r = np.random.default_rng(90 + i)
    if i <= 3:
        d = [2.6, 1.8, 3.2][i - 1]
        rates = [lambda u: 14 + 40 * u + 15 * np.sin(5 * u),
                 lambda u: 25 + 70 * np.sin(np.pi * u) ** 2,
                 lambda u: 10 + 22 * u + 50 * np.clip(u - 0.7, 0, 1)]
        body = board_body(90 + i, 60, 1100, 0.14)
        amp = lambda u: (np.sin(np.pi * u) ** 0.7) * (0.6 + 0.4 * np.sin(13 * u + i) ** 2)
        cr = creak(d, rates[i - 1], body, amp=amp, jitter=0.55, grain=0.0012, seed=90 + i)
        hi = creak(d, lambda u: rates[i - 1](u) * 2.3, board_body(95 + i, 400, 3000, 0.04), amp=amp, jitter=0.6, seed=91 + i)
        y = mix(cr / peak(cr), hi / peak(hi) * 0.25)
        y = lp(y, 3500)
        return reverb(y, room('hall'), 0.35)
    # sharp pops: a dry crack and a ringing board
    n = N(0.025)
    burst = impulse_train(n, 1800, env_exp(n, 0.006), jitter=1.0, seed=i)
    body = board_body(100 + i, 120, 2600, 0.12)
    y = conv(mix(burst, excite(0.001, 8000) * 3), body)
    y /= peak(y)
    tail = creak(0.25, lambda u: 90 - 50 * u, board_body(110 + i, 100, 900), jitter=0.5, seed=i + 5)
    y = mix(y, np.pad(tail / peak(tail) * 0.2, (N(0.05), 0)))
    return reverb(y, room('hall'), 0.4)


# ------------------------------------------------------------------ doors
def _latch(seed, gain=1.0):
    b = metal_ir(900, 8000, n=14, dmin=0.004, dmax=0.04, seed=seed, dur=0.15)
    y = mix(conv(excite(0.0006, 9000, seed), b), np.pad(conv(excite(0.0005, 9000, seed + 1), b) * 0.6, (N(0.011), 0)))
    return y / peak(y) * gain


@variants('door_open', 3, volume=0.6)
def door_open(i):
    r = np.random.default_rng(120 + i)
    d = [2.2, 1.7, 2.6][i - 1]
    curves = [lambda u: 90 + 380 * np.sin(np.pi * u ** 0.8) ** 2 + 60 * np.sin(17 * u),
              lambda u: 200 + 260 * u + 90 * np.sin(11 * u) * u,
              lambda u: 60 + 200 * u + 300 * np.clip(np.sin(3.5 * np.pi * u), 0, 1) ** 2]
    amp = lambda u: np.clip(u * 8, 0, 1) * (1 - u) ** 0.6 * (0.5 + 0.5 * np.abs(np.sin(7 * u + i)))
    cr = creak(d, curves[i - 1], hinge_body(120 + i * 3), amp=amp, jitter=0.22, grain=0.0004, seed=120 + i, squeal=0.35)
    y = mix(_latch(130 + i, 0.5), np.pad(cr / peak(cr), (N(0.08), 0)))
    air = lp(white(N(d)), 500) * env_points(N(d), [(0, 0), (d * 0.4, 0.04), (d, 0)])
    y = mix(y, air)
    return reverb(y, room('hall'), 0.28)


def _door_body(seed):
    return wood_ir(60, 1300, n=36, dmin=0.01, dmax=0.16, seed=seed, dur=0.9)


@variants('door_close', 2, volume=0.65)
def door_close(i):
    cr = creak(0.35, lambda u: 260 - 150 * u, hinge_body(140 + i), jitter=0.2, seed=140 + i, squeal=0.25)
    hit = impact(_door_body(141 + i), 0.006, 2200, thump_f=58, thump_tau=0.07, thump_gain=1.2, seed=i)
    y = mix(cr / peak(cr) * 0.35, np.pad(hit / peak(hit), (N(0.3), 0)), np.pad(_latch(150 + i, 0.45), (N(0.312), 0)))
    return reverb(y, room('hall'), 0.3)


def _rattle(dur, rate, body, seed, decay=0.3):
    n = N(dur)
    imp = impulse_train(n, rate, env_exp(n, decay), jitter=0.8, seed=seed)
    return conv(imp, body)


@variants('door_slam', 2, volume=1.0)
def door_slam(i):
    r = np.random.default_rng(160 + i)
    hit = impact(_door_body(160 + i), 0.012, 3000, thump_f=42, thump_tau=0.18, thump_gain=2.5, seed=i)
    hit2 = impact(_door_body(161 + i), 0.004, 4000, seed=i + 9) * 0.35
    crack = conv(impulse_train(N(0.02), 3000, env_exp(N(0.02), 0.005), jitter=1, seed=i), board_body(170 + i, 300, 4000, 0.03))
    frame = _rattle(1.2, 28, wood_ir(150, 1800, n=12, dmax=0.02, seed=171 + i, dur=0.1), 172 + i, 0.25)
    glass = _rattle(1.4, 34, metal_ir(1800, 7500, n=12, dmin=0.01, dmax=0.07, seed=173 + i, dur=0.2), 174 + i, 0.35)
    y = mix(hit / peak(hit), np.pad(hit2, (N(0.07), 0)), crack / peak(crack) * 0.5,
            np.pad(frame / peak(frame) * 0.18, (N(0.02), 0)), np.pad(glass / peak(glass) * 0.12, (N(0.03), 0)),
            np.pad(_latch(175 + i, 0.4), (N(0.05), 0)))
    y = softclip(y / peak(y) * 1.4, 1.2)
    return reverb(y, room('hall'), 0.45)


@sound('door_locked', volume=0.7)
def door_locked():
    b = metal_ir(500, 7000, n=26, dmin=0.01, dmax=0.12, seed=180, dur=0.4)
    door = _door_body(181)
    out = np.zeros(N(1.4))
    times = [0, 0.07, 0.15, 0.22, 0.50, 0.565, 0.64, 0.70, 0.78]
    for k, t0 in enumerate(times):
        h = conv(excite(0.0008, 8000, 200 + k), b)
        place(out, h / peak(h) * (0.7 + 0.3 * np.random.default_rng(k).random()), N(t0))
        w = conv(excite(0.004, 1500, 220 + k), door)
        place(out, w / peak(w) * 0.25, N(t0 + 0.004))
    return reverb(out, room('hall'), 0.25)


@sound('knock_door', volume=0.9, desc='three slow heavy knocks on the front door')
def knock_door():
    door = wood_ir(80, 1700, n=40, dmin=0.012, dmax=0.14, seed=190, dur=0.9)
    out = np.zeros(N(3.4))
    for k, (t0, a) in enumerate([(0, 0.85), (1.02, 0.8), (2.12, 1.0)]):
        h = impact(door, 0.003, 2600, thump_f=95, thump_tau=0.06, thump_gain=0.9, seed=190 + k)
        place(out, h / peak(h) * a, N(t0))
    return reverb(out, room('hall'), 0.4)


@sound('wall_knock', volume=0.7, desc='muffled irregular knocking from inside a wall')
def wall_knock():
    wall = wood_ir(70, 900, n=24, dmin=0.01, dmax=0.08, seed=200, dur=0.6)
    pattern = [0, 0.9, 1.15, 2.6, 2.75, 2.9, 3.05, 4.4, 4.45]
    out = np.zeros(N(5.4))
    r = np.random.default_rng(200)
    for k, t0 in enumerate(pattern):
        h = impact(wall, 0.005, 1500, thump_f=80, thump_gain=1.0, seed=200 + k)
        place(out, h / peak(h) * r.uniform(0.5, 1.0), N(t0))
    sc = creak(1.0, lambda u: 25 + 30 * u, wall, jitter=0.8, seed=201)
    place(out, sc / peak(sc) * 0.25, N(1.5))
    out = reson(out, 180, 1.5) * 2 + lp(out, 600, 4)
    return reverb(out, room('room'), 0.3)


# ------------------------------------------------------------------ small objects
@sound('match_strike', volume=0.6)
def match_strike():
    n1 = N(0.13)
    scr = impulse_train(n1, 2400 + 1500 * smooth_noise(n1, 30), env_points(n1, [(0, 0.3), (0.03, 1), (0.13, 0.6)]), jitter=1.0, seed=210)
    scr = bp(conv(scr, excite(0.0006, 10000))[:n1], 1500, 9000)
    n2 = N(1.3)
    flare = white(n2)
    flare = stft_filter(flare, lambda T, F: (np.exp(-T[:, None] / 0.25) * 0.9 + 0.1) / (1 + (F[None, :] / (1500 + 7000 * np.exp(-T[:, None] / 0.12))) ** 2), nfft=512)
    flare *= env_points(n2, [(0, 0), (0.015, 1), (0.25, 0.35), (1.3, 0.0)])
    flare *= 1 + 0.3 * smooth_noise(n2, 18)
    cr = crackle(1.0, 60, 2500, seed=211) * env_exp(N(1.0), 0.3)
    y = mix(scr / peak(scr) * 0.8, np.pad(flare / peak(flare), (N(0.11), 0)), np.pad(cr / peak(cr) * 0.3, (N(0.12), 0)))
    return reverb(y, room('small'), 0.12)


@sound('candle_out', volume=0.5)
def candle_out():
    b = breath(0.45, 'out', seed=220, brightness=1.3, attack=0.15, release=0.6)
    s = crackle(0.4, 80, 3500, seed=221) * env_exp(N(0.4), 0.12)
    hiss = bp(white(N(0.8)), 2000, 7000) * env_points(N(0.8), [(0, 0), (0.3, 0.05), (0.8, 0)])
    y = mix(b / peak(b), np.pad(s / peak(s) * 0.2, (N(0.32), 0)), np.pad(hiss, (N(0.3), 0)))
    return reverb(y, room('small'), 0.1)


def _bell(f0, seed):
    ratios = [1, 2.31, 2.74, 3.92, 5.37, 6.8]
    dec = [1.1, 0.55, 0.45, 0.28, 0.18, 0.12]
    amp = [1, 0.55, 0.45, 0.3, 0.2, 0.1]
    r = np.random.default_rng(seed)
    return modal_ir([f0 * x * r.uniform(0.997, 1.003) for x in ratios], dec, amp, dur=2.5)


@sound('phone_ring', volume=0.75, desc='one ring cycle; code repeats it with ~2.5 s gaps')
def phone_ring():
    dur_ring = 1.9
    n = N(dur_ring)
    a = np.zeros(n); b = np.zeros(n)
    rate = 20.0
    for k in range(int(dur_ring * rate)):
        idx = N(k / rate + 0.002 * np.sin(k))
        (a if k % 2 == 0 else b)[idx] = 0.8 + 0.2 * np.random.default_rng(k).random()
    tick = excite(0.0004, 9000, 230)
    ya = conv(conv(a, tick), _bell(1045, 231))
    yb = conv(conv(b, tick), _bell(1310, 232))
    buzz = bp(np.sign(np.sin(2 * np.pi * 20 * tt(n))) * 1.0, 300, 900) * 0.05
    y = mix(ya, yb * 0.85, buzz * peak(ya))
    y = biquad(y, 'peak', 2500, 3, 1.5)
    return reverb(y, room('room'), 0.25)


@sound('phone_pickup', volume=0.6)
def phone_pickup():
    plastic = wood_ir(500, 5000, n=18, dmin=0.002, dmax=0.02, seed=240, dur=0.1)
    clack = conv(excite(0.001, 8000, 240), plastic)
    hook = conv(excite(0.0005, 9000, 241), metal_ir(1500, 6000, n=6, dmin=0.02, dmax=0.08, seed=241, dur=0.3))
    tink = conv(excite(0.0004, 9000, 242), _bell(1045, 243)) * 0.05
    rust = bp(white(N(0.3)), 500, 4000) * env_points(N(0.3), [(0, 0), (0.05, 1), (0.3, 0)]) * 0.15
    y = mix(clack / peak(clack), np.pad(hook / peak(hook) * 0.4, (N(0.05), 0)), np.pad(tink / peak(tink) * 0.12, (N(0.04), 0)), np.pad(rust, (N(0.06), 0)))
    return reverb(y, room('room'), 0.15)


@sound('phone_hangup', volume=0.7)
def phone_hangup():
    plastic = wood_ir(180, 3000, n=20, dmin=0.004, dmax=0.04, seed=250, dur=0.2)
    thunk = impact(plastic, 0.003, 4000, thump_f=150, thump_gain=0.5, seed=250)
    thunk2 = impact(plastic, 0.002, 5000, seed=251) * 0.4
    tink = conv(excite(0.0005, 9000, 252), _bell(1310, 253))
    y = mix(thunk / peak(thunk), np.pad(thunk2, (N(0.045), 0)), tink / peak(tink) * 0.15)
    return reverb(y, room('room'), 0.18)


@sound('phone_line', volume=0.7, desc='line hiss + wet breathing, telephone band')
def phone_line():
    d = 9.5
    n = N(d)
    hiss = white(n) * db(-30) * (1 + 0.2 * smooth_noise(n, 0.5))
    humm = hum(d, 50, (1, .5, .4, .3)) * db(-40)
    cr = crackle(d, 6, 1200, seed=260) * db(-14)
    out = mix(hiss, humm, cr)
    t0 = 0.6
    for k in range(3):
        bi = breath(1.25, 'in', seed=261 + k, shake=0.25, wet=0.7, brightness=0.9)
        bo = breath(1.6, 'out', seed=271 + k, shake=0.35, wet=0.5, voiced=0.25 if k == 1 else 0.0, f0=85)
        place(out, bi / peak(bi) * 0.3, N(t0))
        place(out, bo / peak(bo) * 0.36, N(t0 + 1.25))
        t0 += 3.0 + 0.2 * k
    out = bp(out, 300, 3400, 3)
    out = softclip(out / peak(out) * 1.6, 1.5)
    return out


@sound('power_down', volume=0.8)
def power_down():
    d = 4.2
    n = N(d)
    t = tt(n)
    relay = impact(metal_ir(400, 5000, n=16, dmin=0.01, dmax=0.08, seed=280, dur=0.3), 0.002, 6000, thump_f=70, thump_gain=1.0, seed=280)
    # mains buzz dying quickly
    buzz = hum(d, 120, (1, .7, .5, .4, .3, .2), buzz=0.6) * env_exp(n, 0.25)
    # transformer whine falling in pitch
    f = 2200 * np.exp(-t / 0.9) + 120
    whine = (np.sin(osc_phase(f)) + 0.3 * np.sin(osc_phase(2 * f))) * env_points(n, [(0, 0.5), (0.1, 1), (2.6, 0.0), (d, 0)])
    # fridge winding down + shudder
    ff = 60 * (1 - 0.45 * np.clip(t / 2.5, 0, 1) ** 2)
    fr = (np.sin(osc_phase(ff)) + 0.6 * np.sin(osc_phase(2 * ff)) + 0.3 * np.sin(osc_phase(3 * ff))) * env_points(n, [(0, 0.8), (2.0, 0.5), (2.8, 0.0), (d, 0)])
    shud = lp(white(n), 200) * env_points(n, [(0, 0), (2.4, 0), (2.6, 1), (3.3, 0), (d, 0)]) * (1 + np.sin(2 * np.pi * 9 * t))
    clunk = impact(wood_ir(80, 900, seed=281), 0.006, 1200, thump_f=55, thump_gain=1, seed=281)
    y = mix(relay / peak(relay), buzz * 0.25, whine * 0.08, fr * 0.25, shud * 0.12, np.pad(clunk / peak(clunk) * 0.4, (N(2.7), 0)))
    return reverb(y, room('room'), 0.25)


@sound('power_up', volume=0.75)
def power_up():
    d = 2.8
    n = N(d)
    t = tt(n)
    relay = impact(metal_ir(400, 5000, n=16, dmin=0.01, dmax=0.08, seed=290, dur=0.3), 0.002, 6000, thump_f=60, thump_gain=1.4, seed=290)
    buzz = hum(d, 120, (1, .7, .5, .4, .3, .2), buzz=0.6) * env_points(n, [(0, 0), (0.05, 0.9), (0.6, 0.35), (2.2, 0.2), (d, 0)])
    f = 300 + 1900 * (1 - np.exp(-t / 0.35))
    whine = np.sin(osc_phase(f)) * env_points(n, [(0, 0), (0.1, 0.6), (1.5, 0.2), (d, 0)])
    out = mix(relay / peak(relay), buzz * 0.25, whine * 0.05, crackle(0.5, 120, 2500, seed=291) * 0.15)
    for k, t0 in enumerate([0.18, 0.31, 0.47]):
        p = conv(excite(0.0003, 12000, 292 + k), metal_ir(4000, 9000, n=6, dmin=0.01, dmax=0.05, seed=292 + k, dur=0.15))
        place(out, p / peak(p) * 0.25, N(t0))
    return reverb(out, room('room'), 0.2)


def _switch(seed, low=False):
    body = wood_ir(1200 if not low else 900, 6500, n=10, dmin=0.0015, dmax=0.008, seed=seed, dur=0.05)
    a = conv(excite(0.0004, 12000, seed), body)
    b = conv(excite(0.0003, 12000, seed + 1), body)
    y = mix(a / peak(a) * (0.6 if not low else 1), np.pad(b / peak(b) * (1 if not low else 0.5), (N(0.013), 0)))
    return reverb(y, room('small'), 0.05)


@sound('flashlight_on', volume=0.4)
def flashlight_on():
    return _switch(300)


@sound('flashlight_off', volume=0.4)
def flashlight_off():
    return _switch(310, low=True)


@sound('flashlight_flicker', volume=0.35)
def flashlight_flicker():
    d = 0.45
    n = N(d)
    gate = (smooth_noise(n, 40, seed=320, kind='linear') > 0.1).astype(float)
    gate = lp(gate, 400)
    bz = hum(d, 115, (1, .8, .6, .5, .4, .3), buzz=1.0) * gate
    cr = crackle(d, 250, 3000, seed=321)
    y = mix(bp(bz, 200, 5000) * 0.6, cr / peak(cr) * 0.5)
    return y * env_points(n, [(0, 1), (d * 0.7, 0.8), (d, 0)])


@sound('pickup', volume=0.5)
def pickup():
    d = 0.4
    n = N(d)
    g = np.abs(smooth_noise(n, 70, seed=330, kind='linear')) ** 2
    rus = bp(white(n), 400, 6000) * g * env_points(n, [(0, 0), (0.03, 1), (0.25, 0.5), (d, 0)])
    th = lp(white(N(0.02)), 300) * env_exp(N(0.02), 0.005)
    return reverb(mix(th / peak(th) * 0.6, rus / peak(rus)), room('small'), 0.08)


@sound('paper', volume=0.5)
def paper():
    d = 0.95
    n = N(d)
    gest = env_points(n, [(0, 0), (0.04, 1), (0.35, 0.6), (0.45, 0.15), (0.55, 0.9), (0.8, 0.3), (d, 0)])
    cr = impulse_train(n, 120 + 200 * np.abs(smooth_noise(n, 8)), gest, jitter=1.2, seed=340)
    cr = hp(conv(cr, excite(0.0007, 11000))[:n], 1800)
    rus = bp(white(n), 900, 8000) * gest * np.abs(smooth_noise(n, 25)) * 0.5
    return reverb(mix(cr / peak(cr), rus / peak(rus) * 0.4), room('small'), 0.08)


@sound('fuse_insert', volume=0.6)
def fuse_insert():
    out = np.zeros(N(1.6))
    cer = wood_ir(1500, 7000, n=12, dmin=0.002, dmax=0.015, seed=350, dur=0.06)
    for k, t0 in enumerate([0, 0.17, 0.33, 0.52, 0.68]):
        g = N(0.06)
        gr = impulse_train(g, 700, env_points(g, [(0, 1), (0.06, 0)]), jitter=1, seed=351 + k)
        gr = hp(conv(gr, cer)[:g], 2000)
        place(out, gr / peak(gr) * 0.5, N(t0))
    seat = conv(excite(0.0006, 10000, 360), metal_ir(800, 6000, n=12, dmin=0.005, dmax=0.04, seed=360, dur=0.15))
    place(out, seat / peak(seat), N(0.86))
    zap = mix(crackle(0.06, 900, 2000, seed=361), hum(0.06, 120, buzz=1) * 0.3) * env_exp(N(0.06), 0.02)
    place(out, zap / peak(zap) * 0.45, N(0.9))
    return reverb(out, room('basement'), 0.15)


@sound('drawer_open', volume=0.55)
def drawer_open():
    d = 0.75
    sl = creak(d, lambda u: 45 + 40 * u, wood_ir(150, 1500, n=20, dmin=0.004, dmax=0.03, seed=370), amp=lambda u: np.clip(u * 10, 0, 1) * (1 - 0.3 * u), jitter=0.9, grain=0.002, seed=370)
    out = np.zeros(N(1.2))
    place(out, sl / peak(sl) * 0.7, 0)
    sp = metal_ir(2000, 8000, n=10, dmin=0.02, dmax=0.12, seed=371, dur=0.3)
    for k, t0 in enumerate([0.12, 0.2, 0.31, 0.55]):
        h = conv(excite(0.0003, 12000, 372 + k), sp)
        place(out, h / peak(h) * 0.18, N(t0))
    stop = impact(wood_ir(120, 1200, seed=376), 0.004, 2000, thump_f=90, thump_gain=0.6, seed=376)
    place(out, stop / peak(stop) * 0.8, N(d - 0.02))
    return reverb(out, room('room'), 0.15)


def _hangers(out, t0, seed, count=6):
    r = np.random.default_rng(seed)
    hb = metal_ir(1800, 8500, n=14, dmin=0.03, dmax=0.25, seed=seed, dur=0.5)
    for k in range(count):
        h = conv(excite(0.0003, 12000, seed + k), hb)
        place(out, h / peak(h) * r.uniform(0.08, 0.2), N(t0 + r.uniform(0, 0.5)))


@sound('wardrobe_open', volume=0.6)
def wardrobe_open():
    d = 1.5
    cr = creak(d, lambda u: 70 + 180 * np.sin(np.pi * u) ** 2, hinge_body(380), amp=lambda u: np.clip(u * 6, 0, 1) * (1 - u) ** 0.5, jitter=0.3, seed=380, squeal=0.2)
    out = np.zeros(N(2.2))
    place(out, _latch(381, 0.4), 0)
    place(out, cr / peak(cr), N(0.06))
    _hangers(out, 0.3, 382)
    return reverb(out, room('room'), 0.2)


@sound('wardrobe_close', volume=0.6)
def wardrobe_close():
    out = np.zeros(N(1.3))
    cr = creak(0.3, lambda u: 220 - 120 * u, hinge_body(390), jitter=0.3, seed=390, squeal=0.2)
    place(out, cr / peak(cr) * 0.3, 0)
    th = impact(wood_ir(70, 1100, n=30, dmin=0.01, dmax=0.12, seed=391), 0.006, 1800, thump_f=60, thump_gain=1.2, seed=391)
    place(out, th / peak(th), N(0.28))
    place(out, _latch(392, 0.4), N(0.295))
    _hangers(out, 0.3, 393, 5)
    return reverb(out, room('room'), 0.2)


@sound('drag_above', volume=0.8, desc='heavy body dragged across floorboards above, muffled')
def drag_above():
    d = 6.5
    n = N(d)
    out = np.zeros(n)
    t = 0.0
    k = 0
    r = np.random.default_rng(400)
    while t < d - 0.8:
        L = r.uniform(0.9, 1.4)
        m = N(L)
        fr = brown(m) * env_points(m, [(0, 0), (0.06, 1), (L * 0.6, 0.6), (L, 0)])
        ss_ = creak(L, lambda u: 18 + 30 * (1 - u), board_body(401 + k, 60, 700, 0.12), amp=lambda u: np.clip(u * 15, 0, 1) * (1 - u), jitter=0.9, grain=0.003, seed=401 + k)
        place(out, mix(fr * 0.3, ss_ / peak(ss_) * 0.8), N(t))
        if k % 2 == 0:
            th = impact(board_body(420 + k, 50, 600), 0.01, 600, thump_f=48, thump_gain=1.5, seed=k)
            place(out, th / peak(th) * 0.7, N(t + r.uniform(0, 0.2)))
        t += L + r.uniform(0.15, 0.45)
        k += 1
    gr = creak(2.0, lambda u: 12 + 20 * u, board_body(430, 60, 800, 0.15), jitter=0.6, seed=430)
    place(out, gr / peak(gr) * 0.5, N(2.0))
    out = muffle(out, 360)
    return reverb(out, room('room'), 0.35)


@sound('footsteps_above', volume=0.8, desc='slow heavy footsteps crossing the ceiling, muffled')
def footsteps_above():
    d = 6.5
    out = np.zeros(N(d + 1))
    r = np.random.default_rng(440)
    t0 = 0.0
    k = 0
    while t0 < d - 0.4:
        dist = 1 - abs((t0 / d) - 0.45) * 1.2
        th = impact(board_body(441 + k, 45, 700, 0.1), 0.012, 700, thump_f=r.uniform(42, 55), thump_tau=0.09, thump_gain=2.0, seed=441 + k)
        place(out, th / peak(th) * max(0.25, dist), N(t0))
        if k % 2 == 1:
            cr = creak(0.5, lambda u: 30 + 80 * u, board_body(460 + k, 70, 900), jitter=0.5, seed=460 + k)
            place(out, cr / peak(cr) * 0.35 * dist, N(t0 + 0.05))
        if k == 3:
            sc = lp(brown(N(0.5)), 400) * env_points(N(0.5), [(0, 0), (0.05, 1), (0.5, 0)])
            place(out, sc * 0.2, N(t0 + 0.1))
        t0 += r.uniform(0.95, 1.25) + (0.35 if k == 3 else 0)
        k += 1
    out = muffle(out, 420)
    return reverb(out, room('room'), 0.3)


@variants('thunder', 3, volume=0.85, spatial=False, desc='1 distant roll, 2 mid, 3 close crack (stereo)')
def thunder(i):
    d = [9.0, 8.0, 8.5][i - 1]
    n = N(d)
    r = np.random.default_rng(470 + i)
    chans = []
    for c in range(2):
        rum = brown(n)
        rolls = 0.5 + 0.5 * smooth_noise(n, 1.6, seed=480 + i * 3 + c)
        rolls = np.clip(rolls, 0, 1) ** 1.6
        if i == 1:
            shape = env_points(n, [(0, 0), (1.2, 0.6), (2.5, 1), (5, 0.5), (d, 0)])
            y = lp(rum, 160, 4) * shape * (0.4 + rolls)
        elif i == 2:
            shape = env_points(n, [(0, 0), (0.15, 1), (1.5, 0.6), (4, 0.5), (d, 0)])
            y = lp(rum, 260, 4) * shape * (0.4 + rolls)
            y += lp(white(n), 1500) * env_exp(n, 0.25, 0.02) * 0.2
        else:
            shape = env_points(n, [(0, 0), (0.25, 0.0), (0.32, 1), (1.6, 0.7), (4.5, 0.4), (d, 0)])
            y = lp(rum, 380, 4) * shape * (0.35 + rolls)
            m = N(0.35)
            crk = impulse_train(m, 2500 + 2000 * smooth_noise(m, 40, seed=c), env_points(m, [(0, 1), (0.08, 0.8), (0.35, 0)]), jitter=1.2, seed=490 + c)
            crk = lp(conv(crk, excite(0.0006, 12000))[:m], 7000)
            y[:m] += crk / peak(crk) * 2.0 * peak(y)
            boom = np.sin(osc_phase(45 * np.exp(-tt(N(2)) / 0.8) + 25)) * env_exp(N(2), 0.5, 0.01)
            y = place(y, boom * peak(y) * 0.8, N(0.3))
        y = biquad(y, 'lowshelf', 80, 4)
        chans.append(y)
    st = np.stack(chans)
    st = st / peak(st)
    return reverb(st, room('huge_st'), 0.5)


@sound('glass_rattle', volume=0.55)
def glass_rattle():
    d = 1.1
    n = N(d)
    imp = impulse_train(n, 26 + 12 * smooth_noise(n, 6, seed=500), env_points(n, [(0, 0.3), (0.1, 1), (d, 0)]), jitter=0.7, seed=500)
    gl = conv(imp, metal_ir(1500, 7500, n=16, dmin=0.008, dmax=0.06, seed=501, dur=0.2))
    fr = lp(conv(imp, wood_ir(90, 600, n=10, dmax=0.03, seed=502, dur=0.1)), 400)
    return reverb(mix(gl / peak(gl), fr / peak(fr) * 0.4), room('room'), 0.2)
