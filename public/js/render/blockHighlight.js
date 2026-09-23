// Outline drawn around the block under the crosshair, plus a darkening overlay
// that fills in as the block is being broken.

import * as THREE from 'three';

// Slightly larger than a block so the lines don't z-fight with its faces.
const SIZE = 1.004;
const MAX_BREAK_OPACITY = 0.6;

export class BlockHighlight {
  constructor(scene) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(SIZE, SIZE, SIZE));
    const material = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 });
    this.mesh = new THREE.LineSegments(edges, material);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.overlay = new THREE.Mesh(
      new THREE.BoxGeometry(SIZE, SIZE, SIZE),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false }),
    );
    this.overlay.visible = false;
    scene.add(this.overlay);
  }

  // target: { x, y, z } block coordinates, or null to hide.
  // progress: 0..1 of the way through breaking the target.
  update(target, progress = 0) {
    this.mesh.visible = !!target;
    this.overlay.visible = !!target && progress > 0;
    if (!target) return;
    this.mesh.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    this.overlay.position.copy(this.mesh.position);
    this.overlay.material.opacity = progress * MAX_BREAK_OPACITY;
  }
}
