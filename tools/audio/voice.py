"""The mother's voice: Piper TTS (LJ Speech, public domain) + processing so it is almost human."""
import numpy as np
from lib import *
from sfx import *
from reg import sound
from ambience import MELODY, midi_hz


def mother(text, ls=1.3, semis=-1.6, sub=0.0, rev_whisper=0.0, breath_in=False, seed=0, noise=0.7, wet=0.18):
    from tts import tts
    r = np.random.default_rng(3000 + seed)
    x = tts(text, ls, noise, 0.9)
    x = x / peak(x)
    main = pitch_shift(x, semis, formant='shifted')
    dbl = pitch_shift(x, semis + 0.17, formant='shifted')
    n = len(main)
    out = main.copy()
    place(out, dbl * db(-10), N(0.019))
    if sub > 0:  # subliminal octave-down undertone
        lo = pitch_shift(x, semis - 12, formant='shifted')
        place(out, lp(lo, 2500) * sub, N(0.004))
    wh = whisperize(main)
    out = mix(out, wh / rms(wh) * rms(main) * db(-11))
    if rev_whisper > 0:
        rw = whisperize(x[::-1])
        rw = pitch_shift(rw, -3, formant='preserved')
        pre = N(0.35)
        y = np.zeros(len(out) + pre)
        place(y, rw / rms(rw) * rms(main) * rev_whisper, 0)
        place(y, out, pre)
        out = y
    out = hp(out, 85)
    out = biquad(out, 'lowshelf', 220, 2.5)
    out = biquad(out, 'peak', 2900, -2.5, 1.0)
    out = biquad(out, 'highshelf', 6500, -5)
    out = softclip(out / peak(out) * 1.2, 1.1)
    if breath_in:
        b = breath(0.6, 'in', seed=3100 + seed, shake=0.3, brightness=1.0, wet=0.4)
        out = mix(b / peak(b) * 0.25, np.pad(out, (N(0.55), 0)))
    y = reverb(out, room('room'), wet)
    y = reverb(y, room('dark'), 0.05)
    return trim_tail(y, -48, 0.25)


def telephone(x, seed=0):
    y = bp(x, 320, 3300, 4)
    y = resample(resample(y, 6.0), 1 / 6.0)[:len(y)]  # 8 kHz degrade
    y = softclip(y / peak(y) * 2.2, 2.0)
    n = len(y)
    hiss = bp(white(n), 300, 3400) * db(-34)
    cr = crackle(n / SR, 7, 1200, seed=3200 + seed) * db(-18)
    y = mix(y, hiss, cr)
    pad = np.zeros(N(0.25))
    pad += bp(white(len(pad)), 300, 3400) * db(-34)
    return np.concatenate([pad, y, pad[::-1]])


@sound('vo_phone', volume=0.9, spatial=True, subtitle='Why did you let them put me in the box?')
def vo_phone():
    return telephone(mother('Why did you let them... put me in the box?', 1.35, -1.2, seed=1, wet=0.05), 1)


@sound('vo_phone_end', volume=0.9, spatial=True, subtitle='Eli. Come back inside.')
def vo_phone_end():
    return telephone(mother('Ee-lye.   Come back inside.', 1.45, -1.4, sub=0.12, seed=2, wet=0.05), 2)


@sound('vo_call_1', volume=0.85, subtitle='Sweetheart? Come here a minute.')
def vo_call_1():
    return mother('Sweetheart?  Come here a minute.', 1.3, -1.5, seed=3)


@sound('vo_call_2', volume=0.85, subtitle="I'm in the kitchen, baby.")
def vo_call_2():
    return mother("I'm in the kitchen, baby.", 1.35, -1.6, seed=4, rev_whisper=0.25)


@sound('vo_where', volume=0.85, subtitle='Where are you hiding?')
def vo_where():
    return mother('Where are you hiding?', 1.45, -2.0, seed=5, breath_in=True, rev_whisper=0.3)


@sound('vo_cold', volume=0.85, subtitle="It's so cold in here.")
def vo_cold():
    return mother("It's so cold in here.", 1.55, -2.2, seed=6, sub=0.08)


@sound('vo_found', volume=0.9, subtitle='There you are.')
def vo_found():
    return mother('There you are.', 1.6, -2.5, sub=0.22, seed=7, breath_in=True, wet=0.1)


@sound('vo_dont_look', volume=0.9, subtitle="Don't look at me. I'm not finished.")
def vo_dont_look():
    return mother("Don't look at me.   I'm not finished.", 1.5, -2.8, sub=0.3, rev_whisper=0.35, seed=8)


@sound('vo_coat', volume=0.9, subtitle='You will fit. You will fit so well.')
def vo_coat():
    return mother('You will fit.   You will fit... so well.', 1.6, -3.0, sub=0.35, rev_whisper=0.4, seed=9, breath_in=True)


@sound('vo_name', volume=0.85, subtitle='Eli?')
def vo_name():
    return mother('Ee-lye?', 1.5, -1.8, seed=10, wet=0.3)


@sound('vo_lullaby_hum', volume=0.75, subtitle='(humming)')
def vo_lullaby_hum():
    """A formant-synth hum of the music-box melody, a little flat and drifting."""
    r = np.random.default_rng(3300)
    beat = 0.8
    notes = []
    tpos = 0.55
    for b, m in MELODY[:9]:
        notes.append((tpos, b * beat, m - 12))
        tpos += b * beat
    dur = tpos + 1.0
    n = N(dur)
    t = tt(n)
    f = np.full(n, midi_hz(notes[0][2]))
    amp = np.zeros(n)
    for k, (t0, d, m) in enumerate(notes):
        a, b = N(t0), N(t0 + d)
        drift = -12 - 25 * (t0 / tpos)  # cents, sinking flatter
        target = midi_hz(m, drift + r.uniform(-8, 8))
        f[a:] = target
        seg = np.arange(b - a) / SR
        amp[a:b] = np.clip(seg / 0.07, 0, 1) * np.clip((d - seg) / 0.12, 0.35, 1)
    if True:  # the last note sags a semitone and wavers
        t0, d, m = notes[-1]
        a = N(t0)
        seg = np.arange(n - a) / SR
        f[a:] *= 2 ** (-np.clip(seg - 0.8, 0, 2) * 0.5 / 12)
        amp[a:] = np.clip(seg / 0.07, 0, 1) * np.clip((dur - 0.3 - t0 - seg) / 0.9, 0, 1)
    from scipy.ndimage import gaussian_filter1d
    f = gaussian_filter1d(f, N(0.025))  # portamento
    vib_on = gaussian_filter1d((amp > 0.5).astype(float), N(0.25))
    f *= 1 + 0.007 * np.sin(osc_phase(np.full(n, 5.2))) * vib_on + 0.004 * smooth_noise(n, 7, seed=3301)
    amp = gaussian_filter1d(amp, N(0.01))
    src = glottal(f, n, 0.62)
    fm = [(260, 90, 1.0), (1050, 250, 0.03), (2250, 300, 0.07), (3300, 400, 0.03)]
    y = stft_filter(src, lambda T, F: np.broadcast_to(formant_gain(F, fm), (len(T), len(F))), nfft=2048)
    y = biquad(y, 'notch', 1300, q=2)
    y = y / peak(y) * amp
    air = breath(dur, 'out', seed=3302, brightness=0.8) * amp * 0.08
    b1 = breath(0.5, 'in', seed=3303, shake=0.2)
    out = mix(y, air / (peak(air) + 1e-9) * 0.06)
    place(out, b1 / peak(b1) * 0.22, 0)
    dbl = resample(out, 2 ** (0.12 / 12))
    out = mix(out, np.pad(dbl * 0.3, (N(0.022), 0)))
    out = reverb(out, room('room'), 0.25)
    return reverb(out, room('dark'), 0.06)
