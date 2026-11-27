#!/usr/bin/env python3
"""Generate a seamless, faded vintage damask wallpaper (1k diff/nor/rough).

The pattern is procedural (ours); the ageing (grime, fibre, roughness, normal detail) is
taken from Poly Haven's CC0 "decrepit_wallpaper" maps, which fetch_textures.py does not keep,
so they are downloaded here into the cache.
Output: public/assets/textures/wallpaper/{diff,nor,rough}.jpg and a manifest entry.
"""
import io, json, math, pathlib, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/textures/wallpaper"
CACHE = ROOT / "tools/assets/.cache/wallpaper"
UA = {"User-Agent": "vigil-asset-fetch/1.0"}
N = 1024          # output size
SS = 3            # supersampling for the motif
TILE_M = 0.53     # one tile = 53 cm of wall (a classic wallpaper repeat)
rng = np.random.default_rng(1953)


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            dest.write_bytes(r.read())
    return Image.open(dest)


def ph_map(key):
    with urllib.request.urlopen(urllib.request.Request("https://api.polyhaven.com/files/decrepit_wallpaper", headers=UA)) as r:
        files = json.load(r)
    url = files[key]["1k"]["jpg"]["url"]
    return fetch(url, CACHE / pathlib.Path(url).name)


# ---------------------------------------------------------------- motif (mask, 0..1)
def bezier(p0, p1, p2, p3, n=40):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def half_motif():
    """Polygons for the right half of a damask medallion in unit space (x>=0, y down, centred at 0,0)."""
    P = np.array
    polys = []
    # central teardrop / bud
    bud = np.vstack([bezier(P([0, -0.62]), P([0.16, -0.45]), P([0.2, -0.15]), P([0, 0.02]))])
    polys.append(bud)
    # big outer leaf sweeping down and out
    leaf = np.vstack([
        bezier(P([0.02, -0.05]), P([0.35, -0.25]), P([0.55, 0.05]), P([0.42, 0.32])),
        bezier(P([0.42, 0.32]), P([0.34, 0.18]), P([0.2, 0.08]), P([0.02, 0.1])),
    ])
    polys.append(leaf)
    # lower scroll
    scroll = np.vstack([
        bezier(P([0.0, 0.18]), P([0.25, 0.22]), P([0.36, 0.5]), P([0.16, 0.62])),
        bezier(P([0.16, 0.62]), P([0.24, 0.48]), P([0.14, 0.33]), P([0.0, 0.32])),
    ])
    polys.append(scroll)
    # small upper curl
    curl = np.vstack([
        bezier(P([0.05, -0.55]), P([0.3, -0.62]), P([0.42, -0.4]), P([0.3, -0.3])),
        bezier(P([0.3, -0.3]), P([0.32, -0.42]), P([0.2, -0.5]), P([0.05, -0.45])),
    ])
    polys.append(curl)
    # foot
    foot = np.vstack([bezier(P([0, 0.66]), P([0.08, 0.7]), P([0.1, 0.8]), P([0, 0.86]))])
    polys.append(foot)
    return polys


def draw_motif(draw, cx, cy, scale, fill):
    for poly in half_motif():
        for mirror in (1, -1):
            pts = [(cx + mirror * x * scale, cy + y * scale) for x, y in poly]
            draw.polygon(pts, fill=fill)


def small_sprig(draw, cx, cy, scale, fill):
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        x, y = cx + math.cos(ang) * scale * 0.18, cy + math.sin(ang) * scale * 0.18
        r = scale * 0.07
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)
    r = scale * 0.05
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def motif_mask():
    S = N * SS
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    sc = S * 0.42
    # Medallion at the centre and half-drop copies at the corners; draw with wrap offsets.
    for ox in (-S, 0, S):
        for oy in (-S, 0, S):
            draw_motif(d, S / 2 + ox, S / 2 + oy, sc, 255)
            draw_motif(d, 0 + ox, 0 + oy, sc, 255)
            small_sprig(d, S / 2 + ox, 0 + oy, sc, 255)
            small_sprig(d, 0 + ox, S / 2 + oy, sc, 255)
    # thin vertical pinstripes between medallion columns
    for x in (S * 0.25, S * 0.75):
        w = S * 0.0035
        d.rectangle([x - w, 0, x + w, S], fill=150)
    img = img.resize((N, N), Image.LANCZOS)
    return np.asarray(img, dtype=np.float32) / 255.0


# ---------------------------------------------------------------- tileable noise helpers
def tile_blur(a, radius):
    im = Image.fromarray(np.uint8(np.clip(a, 0, 1) * 255))
    big = Image.new("L", (N * 3, N * 3))
    for i in range(3):
        for j in range(3):
            big.paste(im, (i * N, j * N))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(big.crop((N, N, 2 * N, 2 * N)), dtype=np.float32) / 255.0


def tile_noise(cells, radius):
    a = rng.random((cells, cells)).astype(np.float32)
    im = Image.fromarray(np.uint8(a * 255)).resize((N, N), Image.BICUBIC)
    return tile_blur(np.asarray(im, dtype=np.float32) / 255.0, radius)


def water_stains():
    """Tileable tide-mark stains: blurred blobs with a darker rim."""
    acc = np.zeros((N, N), np.float32)
    rim = np.zeros((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    for _ in range(3):
        cx, cy = rng.random() * N, rng.random() * N * 0.6
        rx, ry = N * (0.06 + rng.random() * 0.12), N * (0.12 + rng.random() * 0.25)
        dx = np.minimum(np.abs(xx - cx), N - np.abs(xx - cx)) / rx
        dy = np.minimum(np.abs(yy - cy), N - np.abs(yy - cy)) / ry
        r = np.sqrt(dx * dx + dy * dy)
        wob = tile_noise(24, 6) * 0.5
        r = r + wob - 0.25
        acc = np.maximum(acc, np.clip(1 - r, 0, 1))
        rim = np.maximum(rim, np.exp(-((r - 1) ** 2) / 0.002) * (0.4 + 0.6 * tile_noise(16, 8)))
    return tile_blur(acc, 10), tile_blur(rim, 2)


def height_to_normal(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)  # OpenGL convention (+Y up)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1)


def blend_normals(a, b):
    """Whiteout blend of two unit normal maps."""
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    mask = motif_mask()
    base_diff = np.asarray(ph_map("Diffuse").convert("RGB").resize((N, N)), np.float32) / 255.0
    base_nor = np.asarray(ph_map("nor_gl").convert("RGB").resize((N, N)), np.float32) / 255.0 * 2 - 1
    base_rough = np.asarray(ph_map("Rough").convert("L").resize((N, N)), np.float32) / 255.0

    # colours (linear-ish sRGB values): dusty sage ground, olive print, faint cream outline
    ground = np.array([0.66, 0.65, 0.53], np.float32)
    ink = np.array([0.50, 0.51, 0.39], np.float32)
    outline = np.array([0.74, 0.71, 0.58], np.float32)
    edge = np.clip(tile_blur(mask, 2.2) - mask, 0, 1) * 2.5
    col = ground[None, None] * (1 - mask[..., None]) + ink[None, None] * mask[..., None]
    col = col * (1 - edge[..., None] * 0.5) + outline[None, None] * edge[..., None] * 0.5

    # fade: print worn away in patches
    wear = tile_noise(10, 12)
    col = col + (ground - col) * np.clip((wear - 0.45) * 1.4, 0, 0.7)[..., None]

    # age with the scanned grime: modulate by its luminance relative to its mean
    lum = base_diff.mean(-1)
    col = col * (lum / lum.mean())[..., None] ** 0.9
    # yellowing towards the top of the tile is not tileable, so use low-frequency noise instead
    yellow = tile_noise(4, 40)
    col = col * (1 - 0.12 * yellow[..., None]) + np.array([0.08, 0.05, 0.0]) * yellow[..., None] * 0.6
    stain, rim = water_stains()
    stain_col = np.array([0.55, 0.44, 0.28], np.float32)
    col = col * (1 - 0.22 * stain[..., None]) + stain_col * 0.22 * stain[..., None]
    col = col * (1 - 0.12 * rim[..., None])
    col = np.clip(col * 0.92, 0, 1)
    Image.fromarray(np.uint8(col * 255)).save(OUT / "diff.jpg", quality=82, optimize=True, progressive=True)

    # normal: scanned paper detail + a faint emboss of the printed ink
    emb = height_to_normal(tile_blur(mask, 1.0), 2.0)
    nrm = blend_normals(base_nor, emb)
    Image.fromarray(np.uint8((nrm * 0.5 + 0.5) * 255)).save(OUT / "nor.jpg", quality=85, optimize=True)

    # roughness: paper is matte; ink slightly less rough; stains a little glossier (dried residue)
    rough = np.clip(base_rough * 0.6 + 0.35 - mask * 0.08 - stain * 0.06, 0.3, 1)
    Image.fromarray(np.uint8(rough * 255)).save(OUT / "rough.jpg", quality=80, optimize=True)

    mpath = ROOT / "public/assets/textures/manifest.json"
    m = json.loads(mpath.read_text()) if mpath.exists() else {"textures": {}}
    m["textures"]["wallpaper"] = {
        "maps": {"diff": "wallpaper/diff.jpg", "nor": "wallpaper/nor.jpg", "rough": "wallpaper/rough.jpg"},
        "tileSize": [TILE_M, TILE_M],
        "source": "generated by tools/assets/make_wallpaper.py (procedural damask) + https://polyhaven.com/a/decrepit_wallpaper (CC0) for ageing",
        "license": "CC0",
        "note": "faded sage-green damask wallpaper with water stains; seamless",
    }
    mpath.write_text(json.dumps(m, indent=2))
    print("wallpaper written")


if __name__ == "__main__":
    main()
