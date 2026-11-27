"""DSP toolkit for VIGIL's offline sound design. Everything is float64 at 48 kHz.
Mono = 1-D array, stereo = array of shape (2, n)."""
import os, subprocess, tempfile, json
import numpy as np
import scipy.signal as ss
import soundfile as sf

SR = 48000
rng = np.random.default_rng(666)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'assets', 'audio'))
RENDER = os.path.join(HERE, 'render')
os.makedirs(OUT, exist_ok=True)
os.makedirs(RENDER, exist_ok=True)


def N(d):
    return int(round(d * SR))


def tt(n):
    return np.arange(n) / SR


def db(x):
    return 10 ** (x / 20)


# ---------------------------------------------------------------- noise
def white(n):
    return rng.standard_normal(n)


def colored(n, slope=-3.0):
    """Noise with `slope` dB/octave spectrum (-3 pink, -6 brown)."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X *= (f / 1000.0) ** (slope / 6.0206)
    y = np.fft.irfft(X, n)
    return y / (np.std(y) + 1e-12)


def pink(n):
    return colored(n, -3)


def brown(n):
    return colored(n, -6)


def smooth_noise(n, rate, seed=None, kind='cubic'):
    """Band-limited random control signal, ~`rate` new values per second, range ~[-1,1]."""
    r = np.random.default_rng(seed) if seed is not None else rng
    k = max(4, int(n * rate / SR) + 4)
    pts = r.uniform(-1, 1, k)
    xp = np.linspace(0, n, k)
    if kind == 'cubic':
        from scipy.interpolate import CubicSpline
        return np.clip(CubicSpline(xp, pts)(np.arange(n)), -1.5, 1.5)
    return np.interp(np.arange(n), xp, pts)


def periodic_lfo(n, cycles, phase=0.0):
    """Sine LFO with an integer number of cycles over n samples (loop-safe)."""
    return np.sin(2 * np.pi * cycles * np.arange(n) / n + phase)


def periodic_smooth(n, k, seed=None):
    """Loop-safe smooth random control: sum of sines with integer cycle counts <= k."""
    r = np.random.default_rng(seed) if seed is not None else rng
    y = np.zeros(n)
    x = np.arange(n) / n
    for c in range(1, k + 1):
        y += r.normal() / c * np.sin(2 * np.pi * c * x + r.uniform(0, 2 * np.pi))
    return y / (np.max(np.abs(y)) + 1e-9)


# ---------------------------------------------------------------- filters
def _sos(kind, f, order):
    return ss.butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return ss.sosfilt(_sos('lowpass', min(f, SR / 2 - 100), order), x, axis=-1)


def hp(x, f, order=2):
    return ss.sosfilt(_sos('highpass', f, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return ss.sosfilt(_sos('bandpass', [lo, min(hi, SR / 2 - 100)], order), x, axis=-1)


def biquad(x, kind, f, gain_db=0.0, q=0.707):
    """RBJ cookbook biquads: peak, lowshelf, highshelf, bandpass(q), notch."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / (2 * q)
    if kind == 'peak':
        b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]
    elif kind == 'lowshelf':
        sA = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) - (A - 1) * cw + sA), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sA)]
        a = [(A + 1) + (A - 1) * cw + sA, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sA]
    elif kind == 'highshelf':
        sA = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
        a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    elif kind == 'bandpass':
        b = [al, 0, -al]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'notch':
        b = [1, -2 * cw, 1]; a = [1 + al, -2 * cw, 1 - al]
    else:
        raise ValueError(kind)
    return ss.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


def reson(x, f, q):
    """Resonant band-pass with unity peak gain."""
    return biquad(x, 'bandpass', f, q=q)


def stft_filter(x, gain_fn, nfft=2048, hop=None):
    """Time-varying spectral shaping. gain_fn(times[F], freqs[K]) -> gains[F,K]."""
    hop = hop or nfft // 4
    f, t, Z = ss.stft(x, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary='zeros', padded=True)
    G = gain_fn(t, f)  # shape (T, F)
    Z = Z * G.T
    _, y = ss.istft(Z, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary=True)
    return y[:len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


def formant_gain(freqs, formants):
    """formants: list of (f, bw, gain_lin). Returns gain curve over freqs."""
    g = np.zeros_like(freqs, dtype=float)
    for fc, bw, a in formants:
        g += a / (1 + ((freqs - fc) / (bw / 2)) ** 2)
    return g


# ---------------------------------------------------------------- envelopes
def env_exp(n, tau, attack=0.0):
    t = tt(n)
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.clip(t / attack, 0, 1)
    return e


def env_points(n, pts):
    """pts: list of (time_s, value) -> linearly interpolated envelope."""
    ts = np.array([p[0] for p in pts]) * SR
    vs = np.array([p[1] for p in pts])
    return np.interp(np.arange(n), ts, vs)


def fades(x, fi=0.002, fo=0.01):
    x = x.copy()
    n = x.shape[-1]
    a, b = N(fi), N(fo)
    if a > 0:
        x[..., :a] *= np.linspace(0, 1, a)
    if b > 0:
        x[..., n - b:] *= np.linspace(1, 0, b) ** 2
    return x


# ---------------------------------------------------------------- synthesis primitives
def modal_ir(freqs, decays, amps, dur=None, phases=None):
    freqs = np.asarray(freqs, float); decays = np.asarray(decays, float); amps = np.asarray(amps, float)
    dur = dur or min(4.0, float(np.max(decays)) * 7)
    t = tt(N(dur))
    y = np.zeros_like(t)
    for i, (f, d, a) in enumerate(zip(freqs, decays, amps)):
        if f >= SR / 2 - 200:
            continue
        ph = 0 if phases is None else phases[i]
        y += a * np.exp(-t / d) * np.sin(2 * np.pi * f * t + ph)
    k = max(1, int(len(t) * 0.3))
    y[-k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2  # never truncate a ringing mode
    return y


def wood_ir(lo=150, hi=2500, n=24, dmin=0.004, dmax=0.05, tilt=1.0, seed=None, dur=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    dmin = min(dmin, dmax * 0.5)
    f = np.exp(r.uniform(np.log(lo), np.log(hi), n))
    d = np.exp(r.uniform(np.log(dmin), np.log(dmax), n)) * (300 / f) ** 0.3
    a = r.uniform(0.3, 1, n) * (lo / f) ** (0.5 * tilt)
    return modal_ir(f, d, a, dur=dur or 0.4)


def metal_ir(lo=400, hi=9000, n=40, dmin=0.05, dmax=0.8, seed=None, dur=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    f = np.exp(r.uniform(np.log(lo), np.log(hi), n))
    d = np.exp(r.uniform(np.log(dmin), np.log(dmax), n))
    a = r.uniform(0.2, 1, n) * (lo / f) ** 0.25
    return modal_ir(f, d, a, dur=dur or 2.0)


def impulse_train(n, rate, amp=None, jitter=0.0, noise_grain=0.0, seed=None):
    """Stick-slip style pulse train. rate: array or scalar (Hz). Returns sparse signal."""
    r = np.random.default_rng(seed) if seed is not None else rng
    rate = np.broadcast_to(np.asarray(rate, float), (n,)).copy()
    if jitter:
        rate *= np.exp(jitter * smooth_noise(n, 40, seed=r.integers(1 << 30)))
    phase = np.cumsum(rate) / SR
    idx = np.nonzero(np.diff(np.floor(phase)) > 0)[0] + 1
    y = np.zeros(n)
    a = np.ones(n) if amp is None else np.broadcast_to(np.asarray(amp, float), (n,))
    y[idx] = a[idx] * r.uniform(0.55, 1.0, len(idx)) * np.where(r.random(len(idx)) < 0.5, 1, -1)
    if noise_grain > 0 and len(idx):
        g = N(noise_grain)
        k = r.standard_normal(g) * np.exp(-np.arange(g) / (g / 4))
        y = ss.fftconvolve(y, k)[:n]
    return y


def conv(x, ir, keep_len=None):
    y = ss.fftconvolve(x, ir) if x.ndim == 1 else np.stack([ss.fftconvolve(c, ir if ir.ndim == 1 else ir[i]) for i, c in enumerate(x)])
    if keep_len is not None:
        y = y[..., :keep_len]
    return y


def circ_conv(x, ir):
    """Circular convolution (length of x preserved) -> loop-safe reverb tails."""
    n = x.shape[-1]
    if ir.shape[-1] > n:
        ir = ir[..., :n]
    X = np.fft.rfft(x, n, axis=-1)
    H = np.fft.rfft(ir, n, axis=-1)
    return np.fft.irfft(X * H, n, axis=-1)


def reverb_ir(t60=1.2, damp=3.0, predelay=0.01, stereo=False, early=8, size=1.0, bright=6000, seed=None, dur=None):
    """Synthetic room IR: early reflections + exponentially decaying noise whose highs die faster."""
    r = np.random.default_rng(seed) if seed is not None else rng
    dur = dur or t60 * 1.2
    n = N(dur)
    chans = []
    for c in range(2 if stereo else 1):
        x = r.standard_normal(n)
        y = stft_filter(x, lambda T, F: np.exp(-6.91 * T[:, None] / t60 * (1 + damp * (F[None, :] / 8000.0) ** 1.2)) * (1 / (1 + (F[None, :] / bright) ** 2)), nfft=1024)
        y[:N(predelay)] = 0
        y[N(predelay):] *= np.clip(np.arange(n - N(predelay)) / N(0.004 * size + 0.001), 0, 1)
        for k in range(early):
            d = N(predelay * 0.3 + r.uniform(0.002, 0.03 * size))
            if d < n:
                y[d] += r.uniform(-1, 1) * 2.5 * (1 - k / early)
        chans.append(y / (np.sqrt(np.sum(y ** 2)) + 1e-9))
    return np.stack(chans) if stereo else chans[0]


def reverb(x, ir, wet=0.3, dry=1.0, circular=False):
    if circular:
        if x.ndim == 1 and ir.ndim == 2:
            x = np.stack([x, x])
        w = circ_conv(x, ir) if (x.ndim == ir.ndim) else np.stack([circ_conv(c, ir) for c in x])
        return dry * x + wet * w
    if x.ndim == 1 and ir.ndim == 1:
        w = ss.fftconvolve(x, ir)
        xx = np.pad(x, (0, len(w) - len(x)))
        return dry * xx + wet * w
    if x.ndim == 1:
        x = np.stack([x, x])
    w = np.stack([ss.fftconvolve(x[i], ir[i] if ir.ndim == 2 else ir) for i in range(2)])
    xx = np.pad(x, ((0, 0), (0, w.shape[1] - x.shape[1])))
    return dry * xx + wet * w


def osc_phase(freq):
    """freq: array Hz -> phase (radians)."""
    return 2 * np.pi * np.cumsum(freq) / SR


def saw_bl(phase, harmonics=12):
    y = np.zeros_like(phase)
    for k in range(1, harmonics + 1):
        y += ((-1) ** (k + 1)) * np.sin(k * phase) / k
    return y * 2 / np.pi


def glottal(freq, n, oq=0.6, shimmer=0.0, seed=None):
    """Rosenberg-ish glottal pulse train following freq (array), band-limited by lowpass."""
    ph = np.cumsum(np.broadcast_to(freq, (n,))) / SR
    frac = ph % 1.0
    tp, tn = oq * 0.7, oq * 0.3
    y = np.where(frac < tp, 0.5 * (1 - np.cos(np.pi * frac / tp)),
                 np.where(frac < tp + tn, np.cos(0.5 * np.pi * (frac - tp) / tn), 0.0))
    y = np.diff(np.concatenate([[0], y]))  # differentiated flow ~ radiation
    y = lp(y, 5000, 2)
    return y / (np.max(np.abs(y)) + 1e-9)


# ---------------------------------------------------------------- dynamics / utility
def peak(x):
    return float(np.max(np.abs(x)) + 1e-12)


def norm_peak(x, dbfs=-1.0):
    return x * (db(dbfs) / peak(x))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def norm_rms(x, dbfs=-20.0, ceiling=-1.0):
    y = x * (db(dbfs) / rms(x))
    if peak(y) > db(ceiling):
        y = limit(y, ceiling)
    return y


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def limit(x, ceiling=-1.0, release=0.08, look=0.003):
    """Simple look-ahead peak limiter."""
    c = db(ceiling)
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    la = N(look)
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    pk = maximum_filter1d(mono, size=2 * la + 1)
    g = np.minimum(1.0, c / (pk + 1e-12))
    # smooth release (one-pole on gain, attack instant)
    a = np.exp(-1 / (release * SR))
    g2 = ss.lfilter([1 - a], [1, -a], g)
    g = np.minimum(g, g2)
    g = uniform_filter1d(g, size=la + 1)
    y = x * g
    return np.clip(y, -c, c)


def trim_onset(x, thr_db=-45, keep=0.001):
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    thr = peak(x) * db(thr_db)
    i = int(np.argmax(mono > thr))
    i = max(0, i - N(keep))
    return x[..., i:]


def trim_tail(x, thr_db=-60, fade=0.05):
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    thr = peak(x) * db(thr_db)
    idx = np.nonzero(mono > thr)[0]
    end = int(idx[-1]) + N(fade) if len(idx) else x.shape[-1]
    y = x[..., :min(end, x.shape[-1])]
    return fades(y, 0, min(fade, y.shape[-1] / SR / 3))


def make_loop(x, L, fade):
    """x has length >= L + fade. Crossfade the overhang into the head (equal power)."""
    F = N(fade) if isinstance(fade, float) else fade
    y = x[..., :L].copy()
    r = np.linspace(0, 1, F)
    y[..., :F] = x[..., :F] * np.sin(r * np.pi / 2) + x[..., L:L + F] * np.cos(r * np.pi / 2)
    return y


def place(dst, src, at, gain=1.0):
    """Add src into dst at sample offset `at` (mono or stereo, clipped to bounds)."""
    at = int(at)
    if at >= dst.shape[-1]:
        return dst
    m = min(src.shape[-1], dst.shape[-1] - at)
    if dst.ndim == 2 and src.ndim == 1:
        dst[:, at:at + m] += gain * src[:m]
    else:
        dst[..., at:at + m] += gain * src[..., :m]
    return dst


def place_wrap(dst, src, at, gain=1.0):
    """Like place but wraps around the end (for loops)."""
    n = dst.shape[-1]
    at = int(at) % n
    m = src.shape[-1]
    idx = (np.arange(m) + at) % n
    if dst.ndim == 2 and src.ndim == 1:
        for c in range(2):
            np.add.at(dst[c], idx, gain * src)
    elif dst.ndim == 2:
        for c in range(2):
            np.add.at(dst[c], idx, gain * src[c])
    else:
        np.add.at(dst, idx, gain * src)
    return dst


def pan(x, p):
    """Equal-power pan of mono x, p in [-1,1] (scalar or array)."""
    a = (np.asarray(p) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def resample(x, ratio):
    """Play back `ratio` times faster (pitch up by ratio, shorter)."""
    n = int(x.shape[-1] / ratio)
    from scipy.signal import resample_poly
    from fractions import Fraction
    fr = Fraction(1 / ratio).limit_denominator(200)
    return resample_poly(x, fr.numerator, fr.denominator, axis=-1)


def ffmpeg_filter(x, filt, sr_in=SR, sr_out=SR):
    """Run an ffmpeg audio filter chain over x."""
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, 'a.wav'), os.path.join(d, 'b.wav')
        sf.write(a, x.T if x.ndim == 2 else x, sr_in, subtype='FLOAT')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a, '-af', filt, '-ar', str(sr_out), '-c:a', 'pcm_f32le', b], check=True)
        y, _ = sf.read(b, always_2d=False)
    return y.T if y.ndim == 2 else y


def pitch_shift(x, semis, formant='shifted'):
    """Duration-preserving pitch shift via rubberband."""
    ratio = 2 ** (semis / 12)
    return ffmpeg_filter(x, f'rubberband=pitch={ratio:.6f}:formant={formant}:pitchq=quality:window=standard')


def stretch(x, factor):
    """Time-stretch by factor (>1 = longer) keeping pitch."""
    return ffmpeg_filter(x, f'rubberband=tempo={1 / factor:.6f}:pitchq=quality')


def whisperize(x, nfft=1024):
    """Channel-vocoder: keep the spectral envelope of x, replace excitation by noise."""
    f, t, Z = ss.stft(x, fs=SR, nperseg=nfft, noverlap=nfft * 3 // 4)
    mag = np.abs(Z)
    from scipy.ndimage import uniform_filter1d
    env = uniform_filter1d(mag, size=9, axis=0)  # smooth across frequency
    nz = ss.stft(rng.standard_normal(len(x)), fs=SR, nperseg=nfft, noverlap=nfft * 3 // 4)[2]
    nz = nz / (np.abs(nz) + 1e-9)
    _, y = ss.istft(env * nz, fs=SR, nperseg=nfft, noverlap=nfft * 3 // 4)
    y = y[:len(x)]
    return hp(y, 300)


def mix(*parts):
    """Sum signals of different lengths/channels."""
    st = any(p.ndim == 2 for p in parts)
    n = max(p.shape[-1] for p in parts)
    out = np.zeros((2, n)) if st else np.zeros(n)
    for p in parts:
        place(out, p, 0)
    return out


def to_stereo(x):
    return x if x.ndim == 2 else np.stack([x, x])


def write_ogg(name, x, q=5):
    path = os.path.join(OUT, name + '.ogg')
    wav = os.path.join(RENDER, name + '.wav')
    x = np.asarray(x, dtype=np.float32)
    sf.write(wav, x.T if x.ndim == 2 else x, SR, subtype='FLOAT')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', str(q), '-ar', str(SR), path], check=True)
    return path
