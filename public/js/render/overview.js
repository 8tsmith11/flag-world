// Debug overview: an orthographic camera looking straight down on the whole
// world, north (-Z) up, for checking world gen.

import * as THREE from 'three';

const MARGIN = 1.05;

export class Overview {
  constructor(world) {
    this.world = world;
    this.half = (Math.max(world.sizeX, world.sizeZ) / 2) * MARGIN;
    this.camera = new THREE.OrthographicCamera(-this.half, this.half, this.half, -this.half, 1, world.sizeY + 400);
    this.camera.position.set(world.sizeX / 2, world.sizeY + 200, world.sizeZ / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(world.sizeX / 2, 0, world.sizeZ / 2);
  }

  // Keeps the whole world in view at any window shape.
  fit(aspect) {
    const w = aspect >= 1 ? this.half * aspect : this.half;
    const h = aspect >= 1 ? this.half : this.half / aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }
}
