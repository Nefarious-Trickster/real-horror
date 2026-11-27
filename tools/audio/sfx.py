"""Mid-level sound design building blocks shared by the generator modules."""
from functools import lru_cache
import numpy as np
from lib import *


@lru_cache(None)
def room(kind):
    """Cached impulse responses for the house's spaces."""
    if kind == 'small':
        return reverb_ir(0.45, damp=3, predelay=0.004, size=0.5, bright=3500, seed=11)
    if kind == 'room':
        return reverb_ir(0.9, damp=3, predelay=0.008, size=0.8, bright=3000, seed=12)
    if kind == 'hall':
        return reverb_ir(1.4, damp=2.5, predelay=0.012, size=1.2, bright=2600, seed=13)
    if kind == 'basement':
        return reverb_ir(1.6, damp=1.6, predelay=0.01, size=1.0, bright=4500, seed=14)
    if kind == 'dark':
        return reverb_ir(3.5, damp=4, predelay=0.03, size=2, bright=2500, seed=15)
    if kind == 'huge_st':
        return reverb_ir(5.0, damp=3, predelay=0.04, size=3, bright=3000, seed=16, stereo=True)
    if kind == 'room_st':
        return reverb_ir(1.0, damp=3, predelay=0.008, size=0.8, bright=3000, seed=17, stereo=True)
    if kind == 'hall_st':
        return reverb_ir(1.8, damp=2.5, predelay=0.015, size=1.3, bright=2600, seed=18, stereo=True)
    if kind == 'basement_st':
        return reverb_ir(1.8, damp=1.6, predelay=0.012, size=1.1, bright=4500, seed=19, stereo=True)
    if kind == 'attic_st':
        return reverb_ir(1.1, damp=2.2, predelay=0.006, size=0.7, bright=3000, seed=20, stereo=True)
    raise KeyError(kind)


def click(dur=0.0006, lo_f=3000):
    n = max(8, N(dur))
    return hp(white(n) * np.exp(-np.arange(n) / (n / 3)), lo_f, 1)


def excite(dur=0.003, bright=4000, seed=None):
    """Short noise burst used to strike modal bodies."""
    r = np.random.default_rng(seed) if seed is not None else rng
    n = max(16, N(dur))
    e = r.standard_normal(n) * np.exp(-np.arange(n) / (n / 4))
    return lp(e, bright, 2)


def impact(body_ir, dur=0.003, bright=4000, gain=1.0, thump_f=None, thump_tau=0.05, thump_gain=0.0, seed=None):
    y = conv(excite(dur, bright, seed), body_ir)
    y /= peak(y)
    if thump_f:
        t = tt(N(thump_tau * 6))
        f = thump_f * (1 + 0.6 * np.exp(-t / 0.01))
        th = np.sin(osc_phase(f)) * np.exp(-t / thump_tau)
        y = mix(y, th * thump_gain)
    return y * gain


def creak(dur, rate, body, amp=None, jitter=0.25, grain=0.0006, seed=None, squeal=0.0):
    """Stick-slip creak: a pulse train (rate: array or callable of 0..1) through a resonant body."""
    n = N(dur)
    u = np.linspace(0, 1, n)
    r = rate(u) if callable(rate) else np.broadcast_to(rate, (n,))
    a = amp(u) if callable(amp) else (np.sin(np.pi * u) ** 0.5 if amp is None else amp)
    imp = impulse_train(n, r, a, jitter=jitter, noise_grain=grain, seed=seed)
    y = conv(imp, body)
    if squeal > 0:  # pitched component riding the slip rate (hinge squeals)
        ph = osc_phase(r * 1.0)
        sq = (np.sin(ph) + 0.4 * np.sin(2 * ph + 0.3) + 0.2 * np.sin(3 * ph)) * a * np.clip((r - 150) / 300, 0, 1)
        y = mix(y, bp(sq, 300, 5000) * squeal * peak(y) / (peak(sq) + 1e-9))
    return y


def hinge_body(seed):
    return mix(metal_ir(700, 6500, n=22, dmin=0.006, dmax=0.06, seed=seed, dur=0.4) * 0.7,
               wood_ir(90, 1100, n=24, dmin=0.01, dmax=0.08, seed=seed + 1, dur=0.5))


def board_body(seed, lo=80, hi=1600, dmax=0.09):
    return wood_ir(lo, hi, n=30, dmin=0.008, dmax=dmax, seed=seed, dur=0.6)


def breath(dur, kind='out', seed=None, shake=0.0, wet=0.0, voiced=0.0, f0=110, brightness=1.0, attack=None, release=None):
    """Filtered-noise breath with formant shaping; optional tremble, saliva crackle and voicing."""
    r = np.random.default_rng(seed) if seed is not None else rng
    n = N(dur)
    u = np.linspace(0, 1, n)
    if kind == 'in':
        fm = [(900 * brightness, 500, 0.6), (1900 * brightness, 800, 1.0), (3300 * brightness, 1400, 0.8), (6000, 3000, 0.25)]
        at, rl = attack or 0.35, release or 0.25
    else:
        fm = [(520 * brightness, 350, 1.0), (1250 * brightness, 600, 0.7), (2500 * brightness, 1000, 0.4), (4500, 2500, 0.12)]
        at, rl = attack or 0.12, release or 0.55
    x = r.standard_normal(n)
    y = stft_filter(x, lambda T, F: np.broadcast_to(formant_gain(F, fm), (len(T), len(F))), nfft=1024)
    env = np.clip(u / at, 0, 1) ** 1.5 * np.clip((1 - u) / rl, 0, 1) ** 1.2
    if shake > 0:
        env *= 1 + shake * smooth_noise(n, 22, seed=r.integers(1 << 30))
    y *= env
    if voiced > 0:
        f = f0 * (1 + 0.03 * smooth_noise(n, 5, seed=r.integers(1 << 30)))
        g = glottal(f, n, 0.55)
        v = stft_filter(g, lambda T, F: np.broadcast_to(formant_gain(F, fm), (len(T), len(F))), nfft=1024)
        y += v * env * voiced * rms(y) / (rms(v * env) + 1e-9)
    if wet > 0:
        imp = impulse_train(n, 25 + 60 * (0.5 + 0.5 * smooth_noise(n, 6)), env, jitter=0.9)
        imp *= (r.random(n) < 0.6)
        cr = conv(imp, modal_ir(r.uniform(1200, 3500, 6), r.uniform(0.001, 0.004, 6), np.ones(6), dur=0.02))[:n]
        y += cr * wet * peak(y) / (peak(cr) + 1e-9)
    return y


def muffle(x, f=380):
    """Heard through a floor/ceiling."""
    y = lp(x, f, 4)
    y = biquad(y, 'peak', 110, 4, 1.2)
    return y


def crackle(dur, rate=200, bright=3000, seed=None):
    n = N(dur)
    imp = impulse_train(n, rate, jitter=1.2, seed=seed)
    imp *= np.random.default_rng(seed).random(n) ** 3 * 2
    return hp(conv(imp, excite(0.0008, 9000))[:n], bright)


def hum(dur, f=60, harm=(1, .6, .35, .2, .12, .08), buzz=0.0, seed=None):
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    r = np.random.default_rng(seed)
    for k, a in enumerate(harm, start=1):
        y += a * np.sin(2 * np.pi * f * k * t + r.uniform(0, 6.28))
    if buzz:
        y += buzz * np.sign(np.sin(2 * np.pi * 2 * f * t)) * 0.3
        y = lp(y, 3000)
    return y
