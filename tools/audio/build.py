"""Render all (or selected) sounds:  python3 build.py [id_or_prefix ...]"""
import sys, os, json, time, subprocess
import numpy as np
from lib import *
from reg import REG
import foley, ambience, creature, voice  # noqa: F401  (registration side-effects)


def post(sid, meta, x):
    if meta['loop']:
        lvl = meta['level'] if meta['level'] is not None else -20
        return norm_rms(x, lvl, ceiling=-1.0)
    x = trim_onset(x, -42)
    x = trim_tail(x, -62)
    x = fades(x, 0.0005, 0.02)
    if meta['level'] is not None:
        return norm_rms(x, meta['level'], ceiling=-1.0)
    return norm_peak(x, -1.0)


def main():
    sel = sys.argv[1:]
    ids = [k for k in REG if not sel or any(k == s or k.startswith(s) for s in sel)]
    man_path = os.path.join(OUT, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'sounds': {}}
    for sid in ids:
        meta = REG[sid]
        t0 = time.time()
        x = np.asarray(meta['fn'](), float)
        if meta['post']:
            x = post(sid, meta, x)
        x = np.clip(x, -db(-1.0), db(-1.0))
        path = write_ogg(sid, x)
        for _ in range(3):  # lossy codecs overshoot on dense material: verify decoded peak
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-'], capture_output=True).stdout
            dp = 20 * np.log10(np.abs(np.frombuffer(raw, np.float32)).max() + 1e-12)
            if dp <= -1.0:
                break
            x = x * db(-1.0 - dp - 0.3)
            path = write_ogg(sid, x)
        dur = x.shape[-1] / SR
        e = {'file': sid + '.ogg', 'loop': meta['loop'], 'volume': meta['volume'], 'spatial': meta['spatial']}
        if meta['group']:
            e['group'] = meta['group']
        if meta['subtitle']:
            e['subtitle'] = meta['subtitle']
        e['duration'] = round(dur, 3)
        e['channels'] = 2 if x.ndim == 2 else 1
        man['sounds'][sid] = e
        print(f'{sid:28s} {dur:6.2f}s ch={e["channels"]} peak={20*np.log10(peak(x)):6.1f} rms={20*np.log10(rms(x)):6.1f}  ({time.time()-t0:.1f}s)', flush=True)
    # drop stale entries
    man['sounds'] = {k: v for k, v in sorted(man['sounds'].items()) if k in REG}
    json.dump(man, open(man_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
