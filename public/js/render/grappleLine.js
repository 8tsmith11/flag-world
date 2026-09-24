// A grappling hook's rope while it pulls: a thin line from the shooter's hand
// to the hook, with the hook head caught at the far end pointing back along
// the rope.

import * as THREE from 'three';
import { placeRod, createHookHead } from './models.js';

const ROPE_THICKNESS = 0.03;
const UP = new THREE.Vector3(0, 1, 0);
// Base of the hook head's shaft to its tip.
const HEAD_LENGTH = 0.26;

export class GrappleLine {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.rope = new THREE.Mesh(new THREE.BoxGeometry(ROPE_THICKNESS, 1, ROPE_THICKNESS),
      new THREE.MeshLambertMaterial({ color: 0xb89a62 }));
    this.head = createHookHead();
    this.group.add(this.rope, this.head);
    this.group.visible = false;
    scene.add(this.group);
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
  }

  // from: the hand, { x, y, z }; grapple: the pulling state's { hx, hy, hz },
  // or null to hide it.
  update(from, grapple) {
    this.group.visible = !!(from && grapple);
    if (!this.group.visible) return;
    this.from.set(from.x, from.y, from.z);
    this.to.set(grapple.hx, grapple.hy, grapple.hz);
    const dir = new THREE.Vector3().subVectors(this.to, this.from);
    if (dir.lengthSq() < 1e-6) return;
    placeRod(this.rope, this.from, this.to, dir);
    // The head's +Y points onward, with its tip at the point it caught.
    dir.normalize();
    this.head.position.copy(this.to).addScaledVector(dir, -HEAD_LENGTH);
    this.head.quaternion.setFromUnitVectors(UP, dir);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
