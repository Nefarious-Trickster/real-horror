#!/usr/bin/env python3
"""Download Poly Haven (CC0) PBR textures at 1k into public/assets/textures/<name>/.

Maps written: diff.jpg, nor.jpg (OpenGL), rough.jpg, ao.jpg (when available).
Also fetches the night HDRI. Run tools/assets/make_wallpaper.py afterwards for the wallpaper.
"""
import json, pathlib, urllib.request, io
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/textures"
UA = {"User-Agent": "vigil-asset-fetch/1.0"}

# game name -> (poly haven id, note)
TEXTURES = {
    "floor_wood": ("old_wooden_floor_02", "old dark hardwood floorboards"),
    "wall_plaster": ("painted_plaster_wall", "aged off-white painted plaster"),
    "wall_damaged": ("damaged_plaster", "plaster chipped back to brick (accent / decay)"),
    "ceiling_plaster": ("ceiling_interior", "ceiling paint with drips"),
    "wood_trim": ("dark_wood", "dark varnished mahogany for doors/skirting/trim"),
    "wainscot": ("dark_paneled_wood", "dark panelled wood (wainscoting, casket)"),
    "concrete_floor": ("damaged_concrete_floor_03", "basement floor, chipped and stained"),
    "brick_wall": ("brick_wall_10", "dark weathered brick, basement foundation"),
    "attic_planks": ("old_planks_02", "rough grey raw boards"),
    "roof_rafters": ("brown_planks_09", "raw brown boards for rafters/roof underside"),
    "tiles_kitchen": ("floor_tiles_06", "checkerboard floor tiles"),
    "carpet": ("dirty_carpet", "dirty faded carpet / rug"),
    "metal_rust": ("metal_plate_02", "corroded steel sheet (fuse box)"),
}


def api(path):
    with urllib.request.urlopen(urllib.request.Request("https://api.polyhaven.com" + path, headers=UA), timeout=60) as r:
        return json.load(r)


def fetch_bytes(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def save_jpg(data, dest, quality=82, gray=False):
    im = Image.open(io.BytesIO(data))
    im = im.convert("L" if gray else "RGB")
    if im.size[0] > 1024:
        im = im.resize((1024, 1024), Image.LANCZOS)
    im.save(dest, quality=quality, optimize=True, progressive=True)


def main():
    manifest = {"textures": {}}
    for name, (pid, note) in TEXTURES.items():
        files = api(f"/files/{pid}")
        info = api(f"/info/{pid}")
        d = OUT / name
        d.mkdir(parents=True, exist_ok=True)
        maps = {}
        for key, fname, gray in (("Diffuse", "diff", False), ("nor_gl", "nor", False), ("Rough", "rough", True), ("AO", "ao", True)):
            if key not in files:
                continue
            url = files[key]["1k"]["jpg"]["url"]
            save_jpg(fetch_bytes(url), d / f"{fname}.jpg", quality=85 if fname == "nor" else 80, gray=gray)
            maps[fname] = f"{name}/{fname}.jpg"
        dims = info.get("dimensions") or [1000, 1000]
        manifest["textures"][name] = {
            "maps": maps,
            "tileSize": [round(dims[0] / 1000, 3), round(dims[1] / 1000, 3)],
            "source": f"https://polyhaven.com/a/{pid}",
            "license": "CC0",
            "note": note,
        }
        print("ok", name, pid, manifest["textures"][name]["tileSize"])

    # HDRI
    for hid in ("kloppenheim_02", "moonless_golf", "narrow_moonlit_road", "dikhololo_night"):
        try:
            f = api(f"/files/{hid}")
            data = fetch_bytes(f["hdri"]["1k"]["hdr"]["url"])
            (OUT / "env_night.hdr").write_bytes(data)
            manifest["env"] = {"file": "env_night.hdr", "source": f"https://polyhaven.com/a/{hid}", "license": "CC0"}
            print("ok hdri", hid)
            break
        except Exception as e:  # noqa
            print("hdri fail", hid, e)

    mpath = OUT / "manifest.json"
    if mpath.exists():  # keep entries added by other scripts (e.g. generated wallpaper)
        old = json.loads(mpath.read_text())
        for k, v in old.get("textures", {}).items():
            manifest["textures"].setdefault(k, v)
        for k in old:
            if k != "textures":
                manifest.setdefault(k, old[k])
    mpath.write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
