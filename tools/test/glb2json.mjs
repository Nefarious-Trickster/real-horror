// Convert .glb files to self-contained .gltf JSON (base64 data URIs), named *.gltf.json
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const { json, resources } = await io.writeJSON(doc);
  const mime = (u) => u.endsWith('.webp') ? 'image/webp' : u.endsWith('.png') ? 'image/png' : u.endsWith('.jpg') || u.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';
  for (const b of json.buffers || []) if (b.uri && resources[b.uri]) b.uri = 'data:application/octet-stream;base64,' + Buffer.from(resources[b.uri]).toString('base64');
  for (const im of json.images || []) if (im.uri && resources[im.uri]) im.uri = `data:${mime(im.uri)};base64,` + Buffer.from(resources[im.uri]).toString('base64');
  fs.writeFileSync(f.replace(/\.glb$/, '.gltf.json'), JSON.stringify(json));
  fs.unlinkSync(f);
}
