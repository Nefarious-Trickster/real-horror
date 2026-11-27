"""Piper TTS wrapper (LJ Speech voice, public domain dataset) -> float array at 48 kHz."""
import os
from functools import lru_cache
import numpy as np
from scipy.signal import resample_poly
from lib import SR, HERE

VOICE = os.path.join(HERE, 'voices', 'en_US-ljspeech-high.onnx')


@lru_cache(None)
def _voice():
    from piper import PiperVoice
    if not os.path.exists(VOICE):
        raise SystemExit('Download the voice first: see tools/audio/README.md')
    return PiperVoice.load(VOICE)


def tts(text, length_scale=1.2, noise_scale=0.667, noise_w=0.8):
    from piper import SynthesisConfig
    v = _voice()
    cfg = SynthesisConfig(length_scale=length_scale, noise_scale=noise_scale, noise_w_scale=noise_w)
    chunks = [c.audio_float_array for c in v.synthesize(text, syn_config=cfg)]
    x = np.concatenate(chunks).astype(float)
    sr = v.config.sample_rate  # 22050
    y = resample_poly(x, 320, 147) if sr == 22050 else resample_poly(x, SR, sr)
    return y
