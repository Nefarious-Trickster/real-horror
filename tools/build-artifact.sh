#!/usr/bin/env bash
# Builds a copy of dist/ suited to hosts that only serve common web types:
# .glb -> self-contained .gltf.json, CSS inlined, no doctype/head wrapper.
# usage: tools/build-artifact.sh <dist-dir> <out-dir>
set -euo pipefail
DIST=$1; OUT=$2; HERE=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$OUT"; cp -r "$DIST" "$OUT"
node "$HERE/tools/test/glb2json.mjs" "$OUT"/assets/models/*.glb "$OUT"/assets/entity/lodger.glb
rm -f "$OUT/assets/textures/env_night.hdr"
cd "$OUT" && python3 - <<'PY'
import json,glob,re,os
m=json.load(open('assets/models/manifest.json'))
for k in ['CoffeeTable_01','Ottoman_01','Television_01','WoodenChair_01','WoodenTable_01','brass_candleholders','book_encyclopedia_set_01','vintage_day_bed','vintage_flashlight']:
    if k in m['models']:
        f='assets/models/'+m['models'][k]['file'].replace('.glb','.gltf.json')
        if os.path.exists(f): os.remove(f)
        del m['models'][k]
for v in m['models'].values(): v['file']=v['file'].replace('.glb','.gltf.json')
json.dump(m,open('assets/models/manifest.json','w'))
for js in glob.glob('assets/*.js'):
    s=open(js).read()
    if 'lodger.glb' in s: open(js,'w').write(s.replace('lodger.glb','lodger.gltf.json'))
s=open('index.html').read()
link=re.search(r'<link rel="stylesheet" crossorigin href="\./(assets/[^"]+\.css)">',s)
s=s.replace(link.group(0),'<style>'+open(link.group(1)).read()+'</style>'); os.remove(link.group(1))
s=re.sub(r'<!doctype html>\s*','',s,flags=re.I)
for pat in [r'</?html[^>]*>',r'</?head>',r'</?body>',r'<meta charset[^>]*>\s*',r'<meta name="viewport"[^>]*>\s*']: s=re.sub(pat,'',s)
s=s.replace('<title>VIGIL</title>','<title>VIGIL</title>\n<style>:root{padding:0!important;color-scheme:dark}html,body{background:#000}</style>')
open('vigil.html','w').write(s.strip()+'\n'); os.remove('index.html')
print('js:', sorted(glob.glob('assets/*.js')))
PY
