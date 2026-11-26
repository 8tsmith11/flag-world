// Colored outlines on the blocks a monkey has selected, drawn only while
// selecting (main.js passes null otherwise). Drawn through terrain so a
// buried corner or a block behind a wall still shows.
import * as THREE from 'three';

const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04));

export class SelectionOutlines {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    scene.add(this.group);
    this.materials = new Map();
    this.key = '';
    this.boxMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.35 });
  }

  material(color) {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
      this.materials.set(color, m);
    }
    return m;
  }

  // list: [{ pos: {x,y,z}, color }] or null to hide.
  update(list) {
    const key = list ? JSON.stringify(list) : '';
    if (key === this.key) return;
    this.key = key;
    this.group.clear();
    for (const { pos, box, color } of list ?? []) {
      const line = new THREE.LineSegments(EDGES, box ? this.boxMaterial : this.material(color));
      if (box) {
        line.scale.set((box.x1 - box.x0 + 1) / 1.04, (box.y1 - box.y0 + 1) / 1.04, (box.z1 - box.z0 + 1) / 1.04);
        line.position.set((box.x0 + box.x1 + 1) / 2, (box.y0 + box.y1 + 1) / 2, (box.z0 + box.z1 + 1) / 2);
      } else line.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      line.renderOrder = 10;
      this.group.add(line);
    }
  }
}
