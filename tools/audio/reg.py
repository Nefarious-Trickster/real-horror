"""Sound registry: each generator registers metadata; build.py renders + writes manifest."""
REG = {}


def sound(sid, group=None, loop=False, volume=0.8, spatial=True, subtitle=None, level=None, post=True, desc=''):
    def deco(fn):
        REG[sid] = dict(fn=fn, group=group, loop=loop, volume=volume, spatial=spatial,
                        subtitle=subtitle, level=level, post=post, desc=desc)
        return fn
    return deco


def variants(base, count, **kw):
    """Register fn(i) under base_1..base_count, grouped as `base`."""
    def deco(fn):
        for i in range(1, count + 1):
            sound(f'{base}_{i}', group=base, **kw)(lambda i=i: fn(i))
        return fn
    return deco
