"""Player body sounds, the entity, stingers and the jumpscare."""
import numpy as np
from lib import *
from sfx import *
from reg import sound, variants
from ambience import circ


# ------------------------------------------------------------------ player
@sound('heartbeat', volume=0.9, spatial=False, desc='one lub-dub; retrigger at heart rate')
def heartbeat():
    out = np.zeros(N(0.75))
    for t0, f0, f1, tau, a in [(0, 62, 34, 0.09, 1.0), (0.29, 78, 44, 0.07, 0.7)]:
        m = N(0.4)
        t = tt(m)
        s = np.sin(osc_phase(f1 + (f0 - f1) * np.exp(-t / 0.03))) * np.exp(-t / tau) * np.clip(t / 0.006, 0, 1)
        s += 0.25 * np.sin(2 * osc_phase(f1 + (f0 - f1) * np.exp(-t / 0.03))) * np.exp(-t / (tau * 0.7))
        th = lp(white(m), 300) * np.exp(-t / 0.02) * 0.25
        place(out, (s + th) * a, N(t0))
    return lp(out, 500)


@sound('breath_scared', loop=True, volume=0.45, spatial=False, level=-24, desc='shaky breathing loop (7 s)')
def breath_scared():
    n = N(7.0)
    x = np.zeros(n)
    t0 = 0.0
    k = 0
    r = np.random.default_rng(1100)
    while t0 < 7.0 - 0.3:
        di = r.uniform(0.55, 0.8)
        do = r.uniform(0.9, 1.15)
        bi = breath(di, 'in', seed=1101 + k, shake=0.35, brightness=1.1)
        bo = breath(do, 'out', seed=1121 + k, shake=0.7, voiced=0.06 if k % 2 else 0.0, f0=230)
        place_wrap(x, bi / peak(bi) * 0.75, N(t0))
        place_wrap(x, bo / peak(bo), N(t0 + di + 0.04))
        t0 += di + do + r.uniform(0.0, 0.1)
        k += 1
    return x + circ_conv(x, room('small')) * 0.1


@sound('breath_hold_release', volume=0.6, spatial=False)
def breath_hold_release():
    g = breath(0.32, 'in', seed=1150, shake=0.2, voiced=0.15, f0=260, brightness=1.2, attack=0.15, release=0.2)
    o = breath(1.2, 'out', seed=1151, shake=0.9, voiced=0.05, f0=200)
    o2 = breath(0.7, 'in', seed=1152, shake=0.6, brightness=1.0)
    y = mix(g / peak(g), np.pad(o / peak(o) * 0.8, (N(0.34), 0)), np.pad(o2 / peak(o2) * 0.5, (N(1.6), 0)))
    return reverb(y, room('small'), 0.08)


@sound('player_hurt_gasp', volume=0.7, spatial=False)
def player_hurt_gasp():
    g = breath(0.2, 'in', seed=1160, voiced=0.5, f0=320, brightness=1.3, attack=0.05, release=0.3)
    u = breath(0.28, 'out', seed=1161, voiced=0.7, f0=240, attack=0.02, release=0.6)
    t = breath(0.8, 'out', seed=1162, shake=1.0, voiced=0.1, f0=200)
    y = mix(g / peak(g), np.pad(u / peak(u) * 0.9, (N(0.17), 0)), np.pad(t / peak(t) * 0.5, (N(0.48), 0)))
    return reverb(y, room('small'), 0.1)


# ------------------------------------------------------------------ entity
def _bone_hit(seed, kind):
    r = np.random.default_rng(seed)
    if kind == 'knock':
        h = impact(board_body(seed % 40 + 1200, 140, 2600, 0.04), 0.0015, 7000, thump_f=r.uniform(90, 140), thump_tau=0.02, thump_gain=0.5, seed=seed)
    elif kind == 'nail':
        h = mix(hp(excite(0.0004, 14000, seed), 3000) * 2, hp(conv(excite(0.0003, 14000, seed), wood_ir(2000, 9000, n=8, dmax=0.004, seed=seed, dur=0.02)), 2000))
    else:  # palm/flesh
        h = mix(lp(excite(0.004, 900, seed), 700) * 3, 0.3 * conv(excite(0.002, 2500, seed), board_body(seed % 40 + 1250, 90, 900, 0.03)))
    return h / peak(h)


@variants('entity_skitter', 4, volume=0.85, desc='plays whenever it moves unseen')
def entity_skitter(i):
    r = np.random.default_rng(1200 + i)
    d = [0.65, 0.95, 1.25, 1.5][i - 1]
    n = N(d + 0.4)
    out = np.zeros(n)
    # galloping groups of 4-6 limb strikes, accelerating, then a dead stop
    t0 = 0.0
    g = 0
    while t0 < d - 0.05:
        u = t0 / d
        period = 0.24 - 0.11 * min(1, u * 2.2)
        limbs = int(r.integers(4, 7))
        for L in range(limbs):
            tl = t0 + L * r.uniform(0.012, 0.035)
            kind = r.choice(['knock', 'knock', 'nail', 'nail', 'flesh'])
            h = _bone_hit(int(r.integers(1 << 20)), kind)
            place(out, h * r.uniform(0.35, 1.0) * (0.8 if kind == 'flesh' else 1), N(tl))
        if r.random() < 0.2:  # fingernail drag
            sd = r.uniform(0.05, 0.14)
            sc = creak(sd, lambda uu, a=r.uniform(700, 1500): a * (1 + 0.4 * uu), wood_ir(1500, 8000, n=10, dmax=0.003, seed=g, dur=0.02), jitter=0.8, grain=0.0002, seed=1300 + g)
            place(out, hp(sc / peak(sc), 1500) * 0.16, N(t0 + 0.02))
        t0 += period * r.uniform(0.75, 1.25)
        g += 1
    # final heavy settle: a knock and a joint crack
    place(out, _bone_hit(1400 + i, 'knock') * 1.0, N(d))
    place(out, _bone_hit(1410 + i, 'flesh') * 0.7, N(d + 0.015))
    body = reverb(out, room('small'), 0.07)[:n]
    # weight: an octave-down shadow of the same scramble
    heavy = lp(resample(out, 0.5)[:n], 900) * 0.6
    # wet chitter under it
    ch = impulse_train(n, 22 + 10 * smooth_noise(n, 8), env_points(n, [(0, 0), (0.1, 1), (d, 1), (d + 0.1, 0), (d + 0.4, 0)]), jitter=0.9, seed=1500 + i)
    ch = conv(ch, modal_ir([480, 1150, 2300], [0.006, 0.004, 0.002], [1, .6, .3], dur=0.03))[:n]
    hiss = bp(white(n), 1500, 6000) * env_points(n, [(0, 0), (0.15, 1), (d, 0.6), (d + 0.15, 0), (d + 0.4, 0)]) * 0.012
    return mix(body / peak(body), heavy / peak(heavy) * 0.35, ch / peak(ch) * 0.12, hiss)


def _pop(seed, size=1.0):
    r = np.random.default_rng(seed)
    m = N(r.uniform(0.005, 0.025) * size)
    imp = impulse_train(m, r.uniform(800, 2500), env_exp(m, m / SR / 2), jitter=1.2, seed=seed)
    imp[0] = 1.0
    bone = modal_ir(r.uniform(900, 4500, 5), r.uniform(0.002, 0.008, 5), r.uniform(0.3, 1, 5), dur=0.05)
    c = hp(conv(imp, bone), 600)
    tt_ = tt(N(0.08))
    thock = np.sin(osc_phase(r.uniform(140, 240) * (1 + 0.5 * np.exp(-tt_ / 0.004)))) * np.exp(-tt_ / 0.015) * 0.6 * size
    return mix(c / peak(c), thock)


def _squelch(dur, seed):
    n = N(dur)
    x = white(n)
    y = stft_filter(x, lambda T, F: 1 / (1 + ((F[None, :] - (700 - 500 * T[:, None] / dur)) / 60) ** 2), nfft=512)
    return y * env_points(n, [(0, 0), (0.01, 1), (dur, 0)])


@variants('entity_crack', 4, volume=0.8)
def entity_crack(i):
    r = np.random.default_rng(1600 + i)
    out = np.zeros(N(1.6))
    if i == 1:
        for k, (t0, s) in enumerate([(0, 1.2), (0.09, 0.5), (0.31, 0.6)]):
            place(out, _pop(1601 + k, s) * s, N(t0))
    elif i == 2:  # spine rolling, accelerating
        t0 = 0.0
        for k in range(7):
            place(out, _pop(1620 + k, 0.7 + 0.06 * k) * (0.5 + 0.08 * k), N(t0))
            t0 += 0.16 * (0.82 ** k)
    elif i == 3:  # slow twist of cartilage then a big crack
        cr = creak(0.55, lambda u: 25 + 50 * u, modal_ir(r.uniform(700, 3000, 6), r.uniform(0.003, 0.01, 6), np.ones(6), dur=0.05), jitter=0.9, grain=0.0008, seed=1640)
        place(out, hp(cr / peak(cr), 400) * 0.45, 0)
        place(out, _pop(1641, 1.5) * 1.0, N(0.55))
        place(out, _squelch(0.18, 1642) * 0.25, N(0.56))
    else:  # wet double crack
        place(out, _pop(1660, 1.0), 0)
        place(out, _squelch(0.22, 1661) * 0.4, N(0.01))
        place(out, _pop(1662, 1.2), N(0.2))
        place(out, _squelch(0.3, 1663) * 0.5, N(0.21))
    return reverb(out, room('small'), 0.1)


def _rattle_voice(dur, f0, kind, seed, rough=0.5):
    """Glottal fry / growl through low vocal-tract formants."""
    r = np.random.default_rng(seed)
    n = N(dur)
    f = f0 * (1 + 0.15 * smooth_noise(n, 9, seed=seed))
    src = impulse_train(n, f, None, jitter=0.6 * rough, seed=seed)
    sub = impulse_train(n, f / 2, None, jitter=0.4, seed=seed + 1) * rough  # subharmonic roughness
    src = src + sub * 0.7
    fm = [(320, 120, 1), (850, 200, 0.5), (2300, 400, 0.15)] if kind == 'in' else [(420, 150, 1), (1000, 250, 0.6), (2500, 500, 0.12)]
    y = stft_filter(conv(src, excite(0.0008, 4000))[:n], lambda T, F: np.broadcast_to(formant_gain(F, fm), (len(T), len(F))), nfft=1024)
    turb = breath(dur, kind, seed=seed + 7, brightness=0.7, wet=0.8)
    e = env_points(n, [(0, 0), (dur * 0.25, 1), (dur * 0.8, 0.9), (dur, 0)])
    return y / peak(y) * e + turb / peak(turb) * 0.45


@sound('entity_breath', loop=True, volume=0.7, level=-20, desc='5 s loop: slow wet rattling inhale + growl exhale')
def entity_breath():
    n = N(5.0)
    x = np.zeros(n)
    inh = _rattle_voice(2.1, 32, 'in', 1700, rough=0.6)
    exh = _rattle_voice(2.4, 58, 'out', 1701, rough=0.9)
    exh_low = pitch_shift(exh, -5)
    gur = np.zeros(N(2.4))
    r = np.random.default_rng(1702)
    for k in range(18):  # gurgling bubbles in the exhale
        f0 = r.uniform(250, 700)
        m = N(0.05)
        tb = tt(m)
        b = np.sin(osc_phase(f0 * (1 + 3 * tb))) * np.exp(-tb / 0.01)
        place(gur, b * r.uniform(0.2, 1), N(r.uniform(0.3, 2.2)))
    exh = mix(exh, exh_low * 0.6, gur / peak(gur) * 0.25)
    place_wrap(x, inh / peak(inh) * 0.85, N(0.1))
    place_wrap(x, exh / peak(exh), N(2.35))
    return x + circ_conv(x, room('small')) * 0.15


WHISPERS = [
    ['let me in', 'you will fit inside', 'wear you, wear you'],
    ["she isn't here any more", 'only me now', 'gone, gone, gone'],
    ['Ee-lye', 'come closer, Ee-lye', 'I can see you'],
    ['so warm', 'open up', 'hold still, hold still'],
]


@variants('entity_whisper', 4, volume=0.65, desc='layered unintelligible whispers; _3 contains the name Eli')
def entity_whisper(i):
    from tts import tts
    r = np.random.default_rng(1800 + i)
    layers = []
    for k, ph in enumerate(WHISPERS[i - 1]):
        v = tts(ph, r.uniform(1.15, 1.6), 0.8, 0.9)
        if k == 1 and i != 3:
            v = v[::-1]
        if k == 2:
            v = v[::-1]
        w = whisperize(v)
        w = pitch_shift(w, r.uniform(-3, 1), formant='preserved')
        layers.append((w / rms(w), r.uniform(0, 0.7), [1.0, 0.55, 0.45][k]))
    n = max(len(w) + N(o) for w, o, _ in layers) + N(0.3)
    out = np.zeros(n)
    for w, o, a in layers:
        place(out, w * a, N(o))
    out = biquad(out, 'peak', 4200, 4, 1.0)
    out = biquad(out, 'lowshelf', 250, 3)
    return reverb(out, room('room'), 0.25)


@variants('entity_click', 3, volume=0.7, desc='wet throat clicks')
def entity_click(i):
    r = np.random.default_rng(1900 + i)
    d = [0.6, 0.9, 1.1][i - 1]
    n = N(d)
    rate = env_points(n, [(0, 9), (d * 0.5, 24), (d, 12)]) if i != 2 else env_points(n, [(0, 30), (d, 8)])
    imp = impulse_train(n, rate, env_points(n, [(0, 0.4), (0.05, 1), (d, 0.5)]), jitter=0.5, seed=1900 + i)
    clk = modal_ir([r.uniform(350, 600), r.uniform(900, 1400), r.uniform(2000, 2800)], [0.008, 0.005, 0.003], [1, .7, .3], dur=0.04)
    y = conv(imp, clk)
    wet = _squelch(0.12, 1910 + i)
    out = mix(y / peak(y), wet / peak(wet) * 0.15)
    if i == 3:
        cr = _rattle_voice(0.9, 22, 'out', 1920, rough=1.0)
        out = mix(out, cr / peak(cr) * 0.45)
    return reverb(out, room('small'), 0.12)


# ------------------------------------------------------------------ scares
def _shriek(dur, f_from, f_to, seed):
    r = np.random.default_rng(seed)
    n = N(dur)
    u = np.linspace(0, 1, n)
    f0 = f_from + (f_to - f_from) * (1 - (1 - u) ** 2)
    f0 *= 1 + 0.045 * np.sin(osc_phase(np.full(n, 11.0))) + 0.02 * smooth_noise(n, 30, seed=seed)
    a = glottal(f0, n, 0.4)
    b = glottal(f0 * 0.5 * 1.06, n, 0.5)  # biphonation: a detuned subharmonic voice
    src = a + 0.6 * b + 0.25 * r.standard_normal(n)
    fm = [(1050, 300, 1.0), (1650, 350, 0.8), (2900, 500, 0.7), (4200, 700, 0.35)]
    y = stft_filter(src, lambda T, F: np.broadcast_to(formant_gain(F, fm) + 0.05, (len(T), len(F))), nfft=1024)
    return softclip(y / peak(y) * 3, 2.5)


def _cluster(dur, notes, seed, harmonics=24, attack=0.004, tau=0.9):
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    r = np.random.default_rng(seed)
    for m in notes:
        f = 440 * 2 ** ((m - 69) / 12) * (1 + 0.003 * smooth_noise(n, 6, seed=int(r.integers(1 << 20))))
        y += saw_bl(osc_phase(f), harmonics)
    e = np.clip(t / attack, 0, 1) * (0.25 + 0.75 * np.exp(-t / tau)) * np.clip((dur - t) / (dur * 0.35), 0, 1) ** 2
    y = stft_filter(y, lambda T, F: 1 / (1 + (F[None, :] / (600 + 5000 * np.exp(-T[:, None] / 0.3))) ** 2), nfft=1024)
    return softclip(y * e / peak(y) * 2, 1.5)


@sound('jumpscare', volume=1.0, spatial=False, level=-9, desc='THE scream')
def jumpscare():
    dur = 2.3
    n = N(dur)
    t = tt(n)
    layers = []
    # sub impact + crack
    sub = np.sin(osc_phase(26 + 40 * np.exp(-t / 0.08))) * np.exp(-t / 0.5)
    hit = lp(white(n), 3500) * np.exp(-t / 0.06)
    layers += [sub * 1.2, hit * 0.8]
    # synthetic shrieks (two voices, one higher and rising)
    s1 = _shriek(dur, 640, 980, 2000)
    s2 = _shriek(dur, 900, 1350, 2001)
    # TTS-derived scream texture: a held vowel pitched up/down, ring-modulated and destroyed
    try:
        from tts import tts
        v = tts('Aaaaaaaaaaaaah!', 1.6, 0.9, 1.0)
        v = v[:N(1.6)] if len(v) > N(1.6) else v
        v = stretch(v / peak(v), dur / (len(v) / SR) * 1.05)[:n]
        v = np.pad(v, (0, max(0, n - len(v))))
        vu = pitch_shift(v, 7, formant='shifted')
        vd = pitch_shift(v, -10, formant='shifted')
        rm = v * np.sin(2 * np.pi * 73 * t)
        tex = softclip((vu + vd * 0.8 + rm * 0.7) / peak(vu) * 4, 4)
        layers.append(tex * 0.55)
    except Exception as e:  # pragma: no cover
        print('tts scream layer skipped:', e)
    # metallic screech: bowed-metal stick-slip rising
    ms = creak(dur, lambda u: 900 + 900 * u ** 0.7, metal_ir(1200, 9000, n=40, dmin=0.1, dmax=0.6, seed=2010, dur=1.0), amp=lambda u: np.ones_like(u), jitter=0.15, grain=0.0001, seed=2011)
    ms = hp(ms / peak(ms), 1500)
    # dissonant brass/string stab
    cl = _cluster(dur, [45, 46, 51, 52, 57, 58, 63], 2020, tau=0.7)
    env = env_points(n, [(0, 1), (1.4, 0.9), (dur, 0)])
    out = mix(*layers, s1 * 0.7 * env, s2 * 0.55 * env, ms[:n] * 0.4 * env, cl * 0.6 * env)
    out = out[:n] * env_points(n, [(0, 1), (1.7, 1), (dur, 0)])
    out = biquad(out, 'peak', 3000, 3, 0.8)
    out = reverb(out, room('room'), 0.2)
    return limit(norm_peak(out, 0) * db(9), -1.0)


@variants('stinger', 3, volume=0.9, spatial=False)
def stinger(i):
    if i == 1:  # string cluster sfz into shuddering tremolo
        d = 3.2
        n = N(d)
        cl = _cluster(d, [64, 65, 66, 70, 52, 58], 2100, harmonics=30, tau=0.5)
        trem = 0.6 + 0.4 * np.sin(osc_phase(np.full(n, 14.0)))
        bow = bp(white(n), 2000, 8000) * np.exp(-tt(n) / 0.1) * 0.3
        sub = np.sin(osc_phase(30 + 30 * np.exp(-tt(n) / 0.05))) * np.exp(-tt(n) / 0.6)
        y = mix(cl * np.where(tt(n) < 0.25, 1, trem), bow, sub * 0.8)
    elif i == 2:  # tam-tam like metal hit
        d = 4.5
        hitir = metal_ir(90, 6000, n=90, dmin=0.4, dmax=3.0, seed=2110, dur=4.5)
        y = conv(excite(0.01, 6000, 2111), hitir)
        y /= peak(y)
        sub = np.sin(osc_phase(36 + 30 * np.exp(-tt(N(d)) / 0.05))) * np.exp(-tt(N(d)) / 0.8)
        y = mix(y, sub * 0.7)
    else:  # high screeching glissando over a low brass growl
        d = 2.8
        n = N(d)
        u = tt(n) / d
        hi = np.zeros(n)
        for k, f in enumerate([1975.5, 2093.0, 2217.5]):
            hi += saw_bl(osc_phase(f * (1 + 0.06 * u ** 0.5) * (1 + 0.01 * np.sin(osc_phase(np.full(n, 7.0 + k))))), 6)
        hi = hp(hi, 1500) * np.exp(-tt(n) / 1.2) * np.clip((d - tt(n)) / 0.8, 0, 1)
        lo = _cluster(d, [28, 29, 35], 2120, harmonics=40, tau=1.0)
        scr = bp(white(n), 3000, 9000) * np.exp(-tt(n) / 0.15) * 0.4
        y = mix(hi / peak(hi) * 0.5, lo, scr)
    y = norm_peak(y, -1)
    return reverb(y, room('dark'), 0.35)


@sound('sting_low', volume=0.9, spatial=False)
def sting_low():
    d = 5.0
    n = N(d)
    t = tt(n)
    f = 24 + 20 * np.exp(-t / 0.15)
    y = np.sin(osc_phase(f)) * np.exp(-t / 1.4) + 0.3 * np.sin(2 * osc_phase(f)) * np.exp(-t / 0.8)
    y += lp(brown(n), 140) * np.exp(-t / 1.2) * 0.3
    y *= np.clip(t / 0.008, 0, 1)
    return reverb(y, room('dark'), 0.3)


@sound('tinnitus', volume=0.35, spatial=False, level=-22)
def tinnitus():
    d = 3.2
    n = N(d)
    t = tt(n)
    y = np.sin(osc_phase(6400 * (1 + 0.002 * smooth_noise(n, 3)))) + 0.35 * np.sin(osc_phase(np.full(n, 7055.0)))
    e = np.clip(t / 0.03, 0, 1) * np.exp(-t / 1.3)
    return y * e
