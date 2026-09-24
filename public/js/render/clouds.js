// Cloud layers: large flat sheets of soft white blobs at a few heights, one
// below the islands, one among them (partly hiding some) and one above. Each
// drifts slowly. Purely visual; the server knows nothing about them.

import * as THREE from 'three';

const TEXTURE_SIZE = 512;
// [height as a fraction of world height, opacity, drift in blocks/s, blob count]
const LAYERS = [
  [0.22, 0.55, 1.5, 70],
  [0.52, 0.7, 2.5, 55],
  [0.86, 0.8, 4, 80],
];
// Sheets extend past the world so the edges aren't visible from the islands.
const OVERHANG = 400;

// A tile of soft blobs. Uses Math.random: clouds needn't match between players.
function cloudTexture(blobs) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < blobs; i++) {
    const x = Math.random() * TEXTURE_SIZE, y = Math.random() * TEXTURE_SIZE;
    const r = 12 + Math.random() * 40;
    // Draw wrapped copies so the tile repeats seamlessly.
    for (const ox of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
      for (const oy of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Clouds {
  constructor(scene, world) {
    this.group = new THREE.Group();
    this.layers = [];
    const span = Math.max(world.sizeX, world.sizeZ) + OVERHANG * 2;
    for (const [height, opacity, drift, blobs] of LAYERS) {
      const texture = cloudTexture(blobs);
      // One texture tile per ~300 blocks.
      texture.repeat.set(span / 300, span / 300);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(span, span),
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(world.sizeX / 2, world.sizeY * height, world.sizeZ / 2);
      this.group.add(mesh);
      this.layers.push({ texture, drift: drift / 300, material: mesh.material });
    }
    scene.add(this.group);
  }

  update(dt) {
    for (const { texture, drift } of this.layers) texture.offset.x += drift * dt;
  }

  // Clouds take the sky's light: `color` is a THREE.Color (white at noon).
  setTint(color) {
    for (const { material } of this.layers) material.color.copy(color);
  }

  set visible(visible) {
    this.group.visible = visible;
  }
}
