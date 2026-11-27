import * as THREE from 'three';

// Interactables: { object, label() -> string|null, use(), range }
export class Interact {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.ray = new THREE.Raycaster();
    this.current = null;
    this.center = new THREE.Vector2(0, 0);
  }

  add(object, label, use, opts = {}) {
    const it = { object, label: typeof label === 'function' ? label : () => label, use, range: opts.range ?? 2.1, enabled: true, ...opts };
    object.traverse?.((o) => { o.userData.interactable = it; });
    this.list.push(it);
    return it;
  }

  remove(it) { this.list = this.list.filter((x) => x !== it); }

  // invisible hit box helper
  hitbox(x, y, z, w, h, d, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    (parent || this.game.scene).add(m);
    return m;
  }

  update() {
    const g = this.game;
    this.current = null;
    if (g.player.frozen || g.player.hiding) {
      if (g.player.hiding) this.current = { label: () => 'E — Leave', use: () => g.leaveHide() };
      return;
    }
    const cam = g.camera;
    this.ray.setFromCamera(this.center, cam);
    this.ray.far = 2.6;
    const objs = [];
    for (const it of this.list) {
      if (!it.enabled || !it.object.visible) continue;
      if (it.object.getWorldPosition(new THREE.Vector3()).distanceToSquared(cam.position) > 16) continue;
      objs.push(it.object);
    }
    const hits = this.ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object; let it = null;
      while (o && !it) { it = o.userData.interactable; o = o.parent; }
      if (!it || h.distance > it.range) continue;
      // walls in the way?
      const to = h.point;
      const ign = [it.door?.collider, ...(it.ignore || [])].filter(Boolean);
      const saved = ign.map((c) => c.enabled);
      ign.forEach((c) => { c.enabled = false; });
      const f = g.house.raycast(cam.position, to, false);
      ign.forEach((c, i) => { c.enabled = saved[i]; });
      if (f < 0.97) continue;
      const lbl = it.label();
      if (!lbl) continue;
      this.current = it;
      break;
    }
  }

  use() {
    if (this.current) this.current.use();
  }
}
