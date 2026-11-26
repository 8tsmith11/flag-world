// Drawbridge jog: when an obstructed drawbridge is told to move, a deck
// section slides a little way out of the mechanism and back (DRAWBRIDGE_JOG),
// with a clank and a puff of steam, so everyone can see it tried.
import * as THREE from 'three';
import { DRAWBRIDGE } from '/shared/config.js';
import { BRIDGE_DECK_PARTS } from './defenseParts.js';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const materials = new Map();
const material = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
  return materials.get(color);
};

function deckModel() {
  const group = new THREE.Group();
  for (const { box: [x0, y0, z0, x1, y1, z1], color } of BRIDGE_DECK_PARTS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material(color));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    group.add(mesh);
  }
  return group;
}

export class DrawbridgeEffects {
  constructor(scene, sounds, steam) {
    this.scene = scene; this.sounds = sounds; this.steam = steam;
    this.jogs = [];
  }

  jog(x, y, z, dir) {
    const model = deckModel(), [dx, dz] = DIRS[dir] ?? DIRS[0];
    model.position.set(x, y, z);
    this.scene.add(model);
    this.jogs.push({ model, x, y, z, dx, dz, t: 0 });
    this.steam?.(x, y, z);
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    this.sounds?.tone?.(180, 90, 0.18, 0.3, at, this.sounds.mixer?.listener, 'square');
    this.sounds?.noiseBurst?.(0.25, 900, 0.25, at, this.sounds.mixer?.listener);
  }

  update(dt) {
    const T = DRAWBRIDGE.jogSeconds;
    for (let i = this.jogs.length - 1; i >= 0; i--) {
      const j = this.jogs[i];
      j.t += dt;
      if (j.t >= T) {
        this.scene.remove(j.model);
        j.model.traverse((o) => o.geometry?.dispose());
        this.jogs.splice(i, 1);
        continue;
      }
      // Out to 0.5 blocks with a shudder at the far end, then back.
      const d = 0.5 * Math.sin(Math.PI * j.t / T) + 0.03 * Math.sin(j.t * 60) * Math.sin(Math.PI * j.t / T);
      j.model.position.set(j.x + j.dx * d, j.y, j.z + j.dz * d);
    }
  }
}
