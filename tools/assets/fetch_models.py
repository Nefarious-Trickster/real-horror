#!/usr/bin/env python3
"""Download Poly Haven (CC0) models at 1k and optimise them to .glb.

Usage: python3 tools/assets/fetch_models.py [id ...]
Raw downloads go to tools/assets/.cache (gitignored); output to public/assets/models/.
"""
import json, os, subprocess, sys, urllib.request, pathlib, shutil, concurrent.futures as cf

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools/assets/.cache/models"
OUT = ROOT / "public/assets/models"
GT = str(ROOT / "node_modules/.bin/gltf-transform")
POST = str(ROOT / "tools/assets/postprocess.mjs")
# Sources authored at the wrong unit scale (checked against Poly Haven's listed dimensions)
SCALE_FIX = {"steel_frame_shelves_01": 0.1}
# Small props spread out in one file (bbox is large) that still deserve 512px textures
SMALL_TEX = {"brass_candleholders", "lantern_chandelier_01"}

MODELS = [
    # requested
    "ArmChair_01", "Sofa_01", "Rockingchair_01", "WoodenChair_01", "WoodenTable_01", "dining_table",
    "dining_chair_02", "GothicBed_01", "old_bed_frame", "GothicCabinet_01", "GothicCommode_01",
    "ClassicNightstand_01", "ClassicConsole_01", "drawer_cabinet", "ornate_mirror_01", "mantel_clock_01",
    "brass_candleholders", "fancy_picture_frame_01", "fancy_picture_frame_02", "hanging_picture_frame_01",
    "hanging_picture_frame_02", "Chandelier_01", "Television_01", "Shelf_01", "cardboard_box_01", "Barrel_01",
    "barrel_stove", "metal_tool_chest", "painted_wooden_cabinet", "Lantern_01",  # decorative_book_set_01 has no glTF download
   
    "book_encyclopedia_set_01", "antique_ceramic_vase_01", "Ottoman_01", "CoffeeTable_01", "hatchet",
    "crowbar_01", "mousetrap", "old_gas_mask", "lightbulb_01",
    # extras for a 1950s farmhouse at night
    "vintage_grandfather_clock_01", "vintage_telephone_wall_clock", "vintage_flashlight", "vintage_oil_lamp",
    "wooden_candlestick", "power_box_01", "wooden_bookshelf_worn", "wooden_ladder", "vintage_suitcase",
    "wheelchair_01", "spinning_wheel_01", "vintage_cabinet_01", "vintage_day_bed", "wooden_crate_01",
    "pull_chain_light_socket", "side_table_01", "tea_set_01", "wicker_basket_01", "wooden_stool_01",
    "television_02", "electric_stove", "painted_wooden_bench", "horse_statue_01", "wall_clock",
    "standing_picture_frame_01", "treasure_chest", "steel_frame_shelves_01", "bench_vice_01",
    "metal_toolbox", "wooden_bucket_01", "rubber_boots", "lantern_chandelier_01", "tool_cart",
]


def get(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "vigil-asset-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(str(dest) + ".part", "wb") as f:
                shutil.copyfileobj(r, f)
            os.replace(str(dest) + ".part", dest)
            return
        except Exception as e:  # noqa
            if attempt == 3:
                raise
            print("retry", url, e)


def api(path):
    req = urllib.request.Request("https://api.polyhaven.com" + path, headers={"User-Agent": "vigil-asset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def run(*args):
    r = subprocess.run([GT, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(" ".join(args) + "\n" + r.stderr[-2000:] + r.stdout[-1000:])


def fetch(mid):
    files = api(f"/files/{mid}")
    g = files["gltf"]["1k"]["gltf"]
    d = CACHE / mid
    gltf = d / pathlib.Path(g["url"]).name
    get(g["url"], gltf)
    for rel, inc in g["include"].items():
        get(inc["url"], d / rel)
    out = OUT / f"{mid}.glb"
    tmp = d / "tmp.glb"
    run("copy", str(gltf), str(tmp))
    run("dedup", str(tmp), str(tmp))
    run("prune", str(tmp), str(tmp))
    run("weld", str(tmp), str(tmp))
    run("resize", str(tmp), str(tmp), "--width", "1024", "--height", "1024")
    try:
        run("webp", str(tmp), str(out), "--quality", "82")
    except RuntimeError as e:
        print("webp failed for", mid, e)
        shutil.copy(tmp, out)
    args = ["node", POST, str(out)]
    if mid in SCALE_FIX:
        args += ["--scale", str(SCALE_FIX[mid])]
    if mid in SMALL_TEX:
        args += ["--small-textures"]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("postprocess: " + r.stderr[-2000:])
    print(r.stdout.strip())
    return mid, out.stat().st_size


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[1:] or MODELS
    failed = []
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(fetch, m): m for m in ids}
        for f in cf.as_completed(futs):
            m = futs[f]
            try:
                mid, n = f.result()
                print(f"ok {mid} {n/1e6:.2f} MB")
            except Exception as e:
                failed.append(m)
                print(f"FAIL {m}: {e}")
    print("failed:", failed)
