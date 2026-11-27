"""Seamless ambience loops + music box. Everything here is built periodic (integer-cycle
oscillators, FFT-periodic noise, wrap-around event placement, circular filtering and reverb),
so loop points are sample-exact without crossfades."""
import numpy as np
from lib import *
from sfx import *
from reg import sound


def circ(fn, x):
    """Apply a causal filter in a loop-safe way (state at the seam = steady state)."""
    L = x.shape[-1]
    y = fn(np.concatenate([x, x], axis=-1))
    return y[..., L:]


def loop_phase(freq):
    """Phase whose total cycle count over the loop is an integer (seamless)."""
    cyc = np.sum(freq) / SR
    target = max(1, round(cyc))
    return osc_phase(freq * (target / cyc))


def pnoise(n, slope=0.0):
    return colored(n, slope)  # FFT-generated -> periodic in n


def drops(n, rate, freqs, decays, seed, amp_sigma=0.9, mod=None):
    """Rain patter: Poisson impulses through a bank of small resonant 'drop' kernels (wrap-safe)."""
    r = np.random.default_rng(seed)
    y = np.zeros(n)
    K = len(freqs)
    for k in range(K):
        cnt = r.poisson(rate / K * n / SR)
        pos = r.integers(0, n, cnt)
        a = r.lognormal(0, amp_sigma, cnt)
        if mod is not None:
            a *= mod[pos]
        imp = np.zeros(n)
        np.add.at(imp, pos, a * np.where(r.random(cnt) < 0.5, -1, 1))
        ker = modal_ir([freqs[k], freqs[k] * 1.7], [decays[k], decays[k] * 0.5], [1, 0.4], dur=decays[k] * 6)
        ker = np.concatenate([excite(0.0004, 9000, seed + k)[:8], ker])
        y += circ_conv(imp, ker)
    return y


def rain(n, seed, intensity, roof_lp=2600, brightness=1.0, window=0.0):
    r = np.random.default_rng(seed)
    ch = []
    for c in range(2):
        bed = circ(lambda z: bp(z, 200, 2800 * brightness, 2), pnoise(n, -3)) * 0.35
        roof = drops(n, 2600, r.uniform(1200, 4200, 12) * brightness, r.uniform(0.0015, 0.004, 12), seed + 10 * c, mod=intensity)
        roof = circ(lambda z: lp(z, roof_lp * brightness, 2), roof)
        roof /= rms(roof)
        y = bed * intensity + roof * 0.6
        if window > 0:
            win = drops(n, 140, r.uniform(2500, 6500, 8), r.uniform(0.002, 0.006, 8), seed + 50 + c, amp_sigma=1.2, mod=intensity)
            y += win / rms(win) * window * (1.0 if c == 0 else 0.35)
        ch.append(y)
    return np.stack(ch)


def gutter(n, seed):
    """Trickling downspout: clusters of Minnaert bubbles."""
    r = np.random.default_rng(seed)
    y = np.zeros(n)
    t = 0
    while t < n:
        burst = r.integers(N(0.05), N(0.6))
        for _ in range(int(r.integers(3, 14))):
            f0 = r.uniform(500, 1600)
            tau = r.uniform(0.004, 0.012)
            m = N(tau * 6)
            tb = tt(m)
            b = np.sin(osc_phase(f0 * (1 + 2.5 * tb / (tau * 6)))) * np.exp(-tb / tau) * r.uniform(0.2, 1)
            place_wrap(y, b, t + r.integers(0, burst))
        t += burst + r.integers(N(0.02), N(0.35))
    return y


@sound('amb_rain_interior', loop=True, volume=0.55, spatial=False, level=-22)
def amb_rain_interior():
    L = N(60)
    n = L
    gust = 0.75 + 0.25 * periodic_smooth(n, 6, seed=600)
    x = rain(n, 600, gust, roof_lp=2200, window=0.35)
    g = gutter(n, 601)
    g = circ(lambda z: lp(z, 2500), g)
    x[1] += g / rms(g) * 0.12
    x[0] += g / rms(g) * 0.04
    wind = circ(lambda z: bp(z, 120, 600), pnoise(n, -6)) * np.clip(gust - 0.75, 0, 1) * 2.0
    x += np.stack([wind, np.roll(wind, N(0.03))]) * 0.6
    x = circ(lambda z: lp(biquad(z, 'highshelf', 2500, -9), 7000), x)
    return circ_conv(x, room('room_st')) * 0.35 + x


@sound('amb_house_tone', loop=True, volume=0.5, spatial=False, level=-30)
def amb_house_tone():
    n = N(60)
    sw = 0.8 + 0.2 * periodic_smooth(n, 4, seed=610)
    ch = []
    for c in range(2):
        low = circ(lambda z: lp(z, 160, 2), pnoise(n, -6)) * sw
        air = circ(lambda z: bp(z, 1500, 6000, 1), pnoise(n, -3)) * 0.06
        h = np.zeros(n)
        for k, a in [(1, 0.25), (2, 0.5), (3, 0.12), (4, 0.08)]:
            h += a * np.sin(loop_phase(np.full(n, 60.0 * k)) + c * 0.3)
        ch.append(low + air + h * 0.05)
    x = np.stack(ch)
    for k, t0 in enumerate([7.3, 23.9, 41.2]):  # very faint distant ticks of an old house
        tk = impact(board_body(620 + k, 150, 1800), 0.002, 3000, seed=k)
        place_wrap(x, pan(lp(tk / peak(tk), 2500) * 0.25, [-0.5, 0.6, 0.1][k]), N(t0))
    return circ_conv(x, room('hall_st')) * 0.2 + x


@sound('amb_dread', loop=True, volume=0.55, spatial=False, level=-21, desc='deep evolving dissonant drone; fade in/out with tension')
def amb_dread():
    n = N(90)
    r = np.random.default_rng(630)
    parts = [(36.71, 1.0, 0), (38.89, 0.7, 0), (55.0, 0.6, 1), (58.27, 0.5, 1), (77.78, 0.35, 2), (82.41, 0.3, 2),
             (103.83, 0.3, 2), (155.56, 0.18, 3), (164.81, 0.16, 3), (233.08, 0.1, 4), (311.13, 0.06, 4),
             (329.63, 0.05, 4), (466.16, 0.03, 5), (622.25, 0.02, 5)]
    out = np.zeros((2, n))
    for k, (f, a, tier) in enumerate(parts):
        drift = 1 + 0.004 * periodic_smooth(n, 3, seed=640 + k)
        ph = loop_phase(np.full(n, f) * drift)
        harm = 1 + tier
        tone = np.zeros(n)
        for h in range(1, harm + 1):
            tone += np.sin(h * ph + r.uniform(0, 6)) / h ** 1.3
        env = (0.35 + 0.65 * (0.5 + 0.5 * periodic_smooth(n, 4, seed=660 + k))) ** 2
        p = r.uniform(-0.7, 0.7) * (0.6 + 0.4 * periodic_lfo(n, 1 + k % 3, k))
        out += pan(tone * env * a, p)
    out = circ(lambda z: lp(z, 900, 2), out)
    # breathing noise through slowly moving resonances
    nz = np.stack([pnoise(n, -3), pnoise(n, -3)])
    cen = 300 + 250 * (0.5 + 0.5 * periodic_smooth(n, 5, seed=680))
    br = np.zeros((2, n))
    for c in range(2):
        hop = 512
        frames = np.arange(0, n + 4 * hop, hop)
        br[c] = circ(lambda z: stft_filter(z, lambda T, F: formant_gain(F, [(1, 1, 0)]) + 1 / (1 + ((F[None, :] - np.interp(T[:, None] * SR % n, np.arange(n), cen)) / 80) ** 2), nfft=2048), nz[c])
    swell = (0.5 + 0.5 * periodic_smooth(n, 7, seed=690)) ** 3
    out += br * swell * rms(out) / rms(br) * 0.5
    # cold metallic shimmer high up, slowly beating
    for k, (f, fb) in enumerate([(1873.0, 1.3), (2411.0, 0.7), (3135.0, 2.1)]):
        ph1 = loop_phase(np.full(n, f)); ph2 = loop_phase(np.full(n, f + fb))
        e = np.clip(periodic_smooth(n, 3, seed=700 + k), 0, 1) ** 2
        out += pan((np.sin(ph1) + np.sin(ph2)) * e, [-0.8, 0.8, 0][k]) * rms(out) * 0.08
    # occasional sub pressure swells
    sub = np.sin(loop_phase(np.full(n, 27.5))) * np.clip(periodic_smooth(n, 5, seed=710), 0, 1) ** 2
    out += np.stack([sub, sub]) * rms(out) * 2.5
    wet = circ_conv(out, room('huge_st'))
    return out * 0.7 + wet * 0.6 * rms(out) / rms(wet)


@sound('amb_hunt', loop=True, volume=0.6, spatial=False, level=-17, desc='70 bpm, 60 s = exactly 70 beats')
def amb_hunt():
    n = N(60)
    beat = 60 / 70
    r = np.random.default_rng(720)
    out = np.zeros((2, n))
    # throbbing double pulse
    m = N(0.6)
    t = tt(m)
    sub = np.sin(osc_phase(38 + 40 * np.exp(-t / 0.04))) * np.exp(-t / 0.18)
    grit = saw_bl(osc_phase(np.full(m, 55.0)), 20)
    grit = stft_filter(grit, lambda T, F: 1 / (1 + (F[None, :] / (150 + 1400 * np.exp(-T[:, None] / 0.06))) ** 4), nfft=512) * np.exp(-t / 0.15)
    pulse = sub + softclip(grit * 2, 2) * 0.35
    for b in range(70):
        place_wrap(out, pan(pulse, 0), N(b * beat))
        place_wrap(out, pan(pulse * 0.55, 0), N(b * beat + 0.24))
    # low grinding cluster
    drone = np.zeros(n)
    for f in (41.2, 43.65, 61.74, 87.31):
        drone += saw_bl(loop_phase(np.full(n, f) * (1 + 0.003 * periodic_smooth(n, 4))), 16)
    drone = circ(lambda z: lp(z, 260, 2), softclip(drone * 0.5, 2))
    dsw = 0.6 + 0.4 * periodic_lfo(n, 70 // 8)
    out += np.stack([drone, np.roll(drone, N(0.011))]) * dsw * 0.25
    # strained high strings, sul ponticello
    for k, f in enumerate([880.0, 932.33, 1318.5, 1396.9]):
        vib = 1 + 0.006 * np.sin(loop_phase(np.full(n, 5.5 + 0.4 * k))) + 0.002 * periodic_smooth(n, 20, seed=730 + k)
        s = saw_bl(loop_phase(np.full(n, f) * vib), 10)
        bow = circ(lambda z: bp(z, f, f * 4), pnoise(n, 0)) * 0.08
        e = (0.5 + 0.5 * periodic_lfo(n, 70 // 16, k * 1.3)) ** 3 * (0.6 + 0.4 * periodic_smooth(n, 6, seed=740 + k))
        st = circ(lambda z: biquad(z, 'highshelf', 3000, 6), (s + bow) * e)
        out += pan(lp(st, 7500), [-0.6, 0.6, -0.3, 0.3][k]) * 0.032
    # metallic scrapes
    t0 = 1.5
    k = 0
    while t0 < 58:
        d = r.uniform(0.8, 2.4)
        sc = creak(d, lambda u, a=r.uniform(60, 200), b=r.uniform(150, 600): a + (b - a) * np.sin(np.pi * u),
                   metal_ir(300, 6000, n=30, dmin=0.05, dmax=0.6, seed=750 + k, dur=1.5), jitter=0.4, seed=760 + k, grain=0.0003)
        sc = hp(sc / peak(sc), 250)
        place_wrap(out, pan(sc, r.uniform(-0.9, 0.9)) * 0.22, N(t0))
        t0 += d + r.uniform(1.5, 5.0)
        k += 1
    # tight ticking on eighths
    tick = conv(excite(0.0003, 12000, 770), metal_ir(3000, 9000, n=6, dmin=0.005, dmax=0.02, seed=770, dur=0.05))
    tick /= peak(tick)
    for b in range(140):
        place_wrap(out, pan(tick, 0.4 if b % 2 else -0.4) * (0.06 if b % 2 else 0.035), N(b * beat / 2 + 0.43))
    wet = circ_conv(out, room('hall_st'))
    return out + wet * 0.5 * rms(out) / rms(wet)


@sound('amb_basement', loop=True, volume=0.55, spatial=False, level=-24)
def amb_basement():
    n = N(60)
    r = np.random.default_rng(800)
    ch = []
    for c in range(2):
        rum = circ(lambda z: lp(z, 110, 2), pnoise(n, -6))
        flame = circ(lambda z: bp(z, 60, 320), pnoise(n, -3)) * (0.7 + 0.3 * np.sin(loop_phase(np.full(n, 9.0 + c))) * periodic_smooth(n, 30, seed=801 + c))
        motor = sum(a * np.sin(loop_phase(np.full(n, 29.5 * k))) for k, a in [(1, .3), (2, .5), (4, .2), (6, .1)])
        ch.append(rum + flame * 0.5 + motor * 0.15)
    x = np.stack(ch)
    def drip(f0, seed):
        rr = np.random.default_rng(seed)
        m = N(0.12)
        t = tt(m)
        d = np.sin(osc_phase(f0 * (1 + 0.9 * (1 - np.exp(-t / 0.012))))) * np.exp(-t / 0.03)
        d[:N(0.002)] += rr.standard_normal(N(0.002)) * 0.15
        return lp(d, 3500)
    t0 = 0.4
    while t0 < 60:  # steady drip, left
        place_wrap(x, pan(drip(1150, int(t0 * 10)), -0.6) * 0.9 * rms(x[0]) * 3.2, N(t0))
        t0 += 2.3 * r.uniform(0.93, 1.07)
    t0 = 1.7
    while t0 < 60:  # irregular drip, right
        place_wrap(x, pan(drip(r.uniform(700, 1700), int(t0 * 13)), 0.7) * r.uniform(0.4, 1) * rms(x[0]) * 2.8, N(t0))
        t0 += r.uniform(1.0, 5.5)
    for t0 in (13.2, 38.7, 51.1):  # deep drop into a puddle
        place_wrap(x, pan(drip(520, int(t0)), 0.1) * rms(x[0]) * 3, N(t0))
    t0 = 3.0
    k = 0
    while t0 < 58:  # pipes ticking with thermal expansion
        tk = conv(excite(0.0004, 10000, 820 + k), metal_ir(800, 7000, n=10, dmin=0.01, dmax=0.12, seed=820 + k, dur=0.3))
        burst = int(r.integers(1, 4))
        p = r.uniform(-0.9, 0.9)
        for j in range(burst):
            place_wrap(x, pan(lp(tk / peak(tk), 5000), p) * rms(x[0]) * 1.1 * r.uniform(0.4, 1), N(t0 + j * r.uniform(0.12, 0.4)))
        t0 += r.uniform(3, 10)
        k += 1
    wet = circ_conv(x, room('basement_st'))
    return x + wet * 0.7 * rms(x) / rms(wet)


@sound('amb_attic', loop=True, volume=0.55, spatial=False, level=-21)
def amb_attic():
    n = N(60)
    r = np.random.default_rng(850)
    gust = np.clip(0.55 + 0.45 * periodic_smooth(n, 8, seed=851), 0, 1)
    x = rain(n, 852, 0.7 + 0.3 * gust, roof_lp=3600, brightness=1.0) * 1.2
    x = circ(lambda z: lp(biquad(z, 'highshelf', 3000, -7), 8000), x)
    for c in range(2):
        w = circ(lambda z: bp(z, 180, 1300, 2), pnoise(n, -4)) * gust ** 2 * 1.2
        for k, (lo, hi) in enumerate([(480, 820), (1050, 1450)]):
            fc = lo + (hi - lo) * gust
            z = pnoise(n, 0)
            wh = circ(lambda zz: stft_filter(zz, lambda T, F: 1 / (1 + ((F[None, :] - np.interp((T[:, None] * SR) % n, np.arange(n), fc)) / 9) ** 2), nfft=4096), z)
            w += wh / rms(wh) * gust ** 3 * 0.45 * (1 if (k + c) % 2 else 0.5)
        x[c] += w
    for k, t0 in enumerate([5.0, 19.5, 33.0, 47.5]):
        d = r.uniform(1.5, 3.0)
        g = creak(d, lambda u, a=r.uniform(8, 18): a + 30 * np.sin(np.pi * u) ** 2, board_body(860 + k, 55, 900, 0.16),
                  amp=lambda u: np.sin(np.pi * u) ** 0.8, jitter=0.6, grain=0.0015, seed=860 + k)
        g = lp(g / peak(g), 2500)
        place_wrap(x, pan(g, r.uniform(-0.8, 0.8)) * rms(x[0]) * 2.2, N(t0))
    wet = circ_conv(x, room('attic_st'))
    return x + wet * 0.4 * rms(x) / rms(wet)


@sound('fridge_hum', loop=True, volume=0.35, level=-24)
def fridge_hum():
    n = N(20)
    h = sum(a * np.sin(loop_phase(np.full(n, f))) for f, a in [(60, .4), (120, 1.0), (120.4, .5), (180, .25), (240, .2), (360, .08)])
    rat = circ(lambda z: bp(z, 250, 1800), pnoise(n, 0)) * (0.5 + 0.5 * np.sin(loop_phase(np.full(n, 7.2)))) ** 4
    wh = np.sin(loop_phase(np.full(n, 2150.0))) * 0.01
    return circ(lambda z: lp(z, 2500), h + rat * 0.12 + wh)


@sound('clock_tick', loop=True, volume=0.45, level=-26, desc='grandfather clock, 8 s loop, tick every 1.0 s')
def clock_tick():
    n = N(8)
    x = np.zeros(n)
    case = wood_ir(180, 2400, n=30, dmin=0.01, dmax=0.09, seed=900, dur=0.5)
    esc = metal_ir(2500, 8000, n=8, dmin=0.004, dmax=0.025, seed=901, dur=0.1)
    for k in range(8):
        tock = k % 2
        r = np.random.default_rng(910 + k)
        e = excite(0.0005, 9000, 910 + k)
        a = conv(e, esc) * (0.5 if tock else 0.7)
        b = conv(e, case)
        b = biquad(b, 'peak', 300 if tock else 520, 6, 2)
        y = mix(a / peak(a) * 0.6, b / peak(b))
        place_wrap(x, y * r.uniform(0.92, 1.0), N(k * 1.0 + r.uniform(-0.002, 0.002)))
        place_wrap(x, conv(excite(0.0004, 9000, 930 + k), esc) * 0.15, N(k * 1.0 + 0.03))
    return x + circ_conv(x, room('hall')) * 0.25


# ------------------------------------------------------------------ music box
MELODY = [  # (beats, midi) ; D minor, 3/4. Original.
    (1, 69), (1, 74), (1, 77), (2, 76), (1, 74), (1, 72), (1, 69), (1, 70), (3, 69),
    (1, 69), (1, 74), (1, 77), (1, 79), (1, 77), (1, 76), (1, 77), (1, 74), (1, 68), (3, 69),
    (1, 77), (1, 76), (1, 74), (2, 73), (1, 76), (1, 74), (1, 69), (1, 65), (2, 64), (1, 0), (3, 62),
]
BASS = {0: 50, 3: 46, 6: 53, 9: 45, 12: 50, 15: 46, 18: 52, 21: 45, 24: 50, 27: 45, 30: 46, 33: 45, 36: 50}
DETUNE = {62: 8, 64: -14, 65: 22, 68: -25, 69: 4, 70: -10, 72: 15, 73: -18, 74: -6, 76: 12, 77: 34, 79: -20,
          45: 10, 46: -12, 50: 6, 52: -15, 53: 9}


def midi_hz(m, cents=0):
    return 440 * 2 ** ((m - 69 + cents / 100) / 12)


def tine(f, vel, seed):
    r = np.random.default_rng(seed)
    dec = 2.2 * (440 / f) ** 0.5
    y = modal_ir([f, f * 1.0015, f * 2.0, f * 5.93, f * 9.7], [dec, dec * 0.8, dec * 0.25, 0.12, 0.05],
                 [1, 0.35, 0.06, 0.18, 0.06], dur=min(4.5, dec * 4))
    pluck = hp(excite(0.0015, 11000, seed), 2500) * 0.25
    return mix(y, pluck) * vel


@sound('music_box', loop=False, volume=0.55, level=-19, desc='original D-minor lullaby, spring winding down, ~30 s, one-shot')
def music_box():
    total_beats = sum(b for b, _ in MELODY)
    def beat_len(bpos):
        u = bpos / total_beats
        return 0.52 + 0.35 * u ** 1.6 + 1.3 * max(0.0, u - 0.82) ** 1.5 * 6
    times = [0.0]
    for b in range(total_beats + 4):
        times.append(times[-1] + beat_len(b))
    T = lambda bpos: np.interp(bpos, np.arange(len(times)), times)
    dur = T(total_beats) + 4.0
    x = np.zeros(N(dur))
    bpos = 0.0
    for k, (b, m) in enumerate(MELODY):
        if m:
            f = midi_hz(m, DETUNE.get(m, 0))
            vel = 0.85 + 0.15 * np.random.default_rng(k).random()
            if k == len(MELODY) - 1:
                vel *= 0.8
            place(x, tine(f, vel, 950 + k), N(T(bpos)))
            if int(bpos) in BASS and abs(bpos - int(bpos)) < 1e-6:
                bm = BASS[int(bpos)]
                place(x, tine(midi_hz(bm, DETUNE.get(bm, 0)), 0.55, 990 + k), N(T(bpos) + 0.012))
        bpos += b
    # mechanism: governor whirr + comb pin ticks, slowing down with the spring
    n = len(x)
    t = tt(n)
    rate = np.interp(t, [T(i) for i in range(total_beats + 1)], 8 / np.array([beat_len(i) for i in range(total_beats + 1)]))
    gear = impulse_train(n, rate, None, jitter=0.1, seed=999)
    gear = conv(gear, metal_ir(1500, 6000, n=6, dmin=0.002, dmax=0.01, seed=998, dur=0.03))[:n]
    whirr = bp(white(n), 800, 3000) * (0.5 + 0.5 * np.sin(osc_phase(rate * 3))) * 0.003
    end = T(total_beats)
    mech = (gear / peak(gear) * 0.01 + whirr) * np.clip((end + 0.5 - t) / 1.0, 0, 1)
    x = mix(x, mech)
    board = wood_ir(150, 1200, n=16, dmin=0.01, dmax=0.04, seed=997, dur=0.3)
    x = mix(x, conv(x, board)[:n] * 0.02)
    return reverb(x, room('room'), 0.3)


@sound('radio_static', loop=True, volume=0.35, level=-24)
def radio_static():
    n = N(15)
    x = circ(lambda z: bp(z, 200, 5500), pnoise(n, -1))
    x *= 0.7 + 0.3 * periodic_smooth(n, 12, seed=1001)
    cr = np.zeros(n)
    r = np.random.default_rng(1002)
    for p in r.integers(0, n, 90):
        c = conv(excite(0.0005, 10000, int(p)), wood_ir(800, 5000, n=6, dmax=0.005, seed=int(p) % 50, dur=0.02))
        place_wrap(cr, c * r.lognormal(0, 1), p)
    x += cr / peak(cr) * peak(x) * 0.7
    f = 1400 + 900 * periodic_smooth(n, 4, seed=1003)
    x += np.sin(loop_phase(f)) * np.clip(periodic_smooth(n, 5, seed=1004), 0, 1) ** 2 * rms(x) * 0.5
    try:
        from tts import tts
        v = tts('I can hear you breathing. Come back to bed. It is warm in here, it is warm.', 1.1)
        v = bp(v, 500, 2400) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * tt(len(v))))
        vv = np.zeros(n)
        place_wrap(vv, v, N(4.0))
        x += vv / rms(vv) * rms(x) * 0.22
    except SystemExit:
        pass
    return x
