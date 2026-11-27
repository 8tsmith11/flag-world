// Drawbridge motion, drawn on clients:
//   - slides (DRAWBRIDGE_SLIDE): the section the bridge is laying slides
//     from the end of the bridge (or out of the mechanism, for the first) to
//     its cell, or the section it is lifting slides back, at a steady
//     speed. The solid deck block appears when a laid section arrives (and
//     goes when a lifted one starts), so the end of the bridge moves linearly.
//   - jogs (DRAWBRIDGE_JOG): an obstructed drawbridge pushes a section a
//     little way out and back, with a clank and a puff of steam.
import * as THREE from 'three';
import { DRAWBRIDGE } from '/shared/config.js';
import { BRIDGE_DECK_PARTS } from './defenseParts.js';

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
    this.slides = [];
  }

  // A section sliding from block `from` to block `to` ({ x, y, z }) over
  // `seconds`; `laying` when it is going out.
  slide(from, to, seconds, laying = true) {
    const model = deckModel();
    model.position.set(from.x, from.y, from.z);
    this.scene.add(model);
    // A laid section lingers a moment at its cell until the solid block arrives.
    this.slides.push({ model, from, to, t: 0, seconds, hold: laying ? 0.25 : 0 });
  }

  // The first section poking out from the mechanism at x, y, z toward
  // (dx, dz) and back.
  jog(x, y, z, dx, dz) {
    const model = deckModel();
    model.position.set(x, y, z);
    this.scene.add(model);
    this.jogs.push({ model, x, y, z, dx, dz, t: 0 });
    this.steam?.(x, y, z);
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    this.sounds?.tone?.(180, 90, 0.18, 0.3, at, this.sounds.mixer?.listener, 'square');
    this.sounds?.noiseBurst?.(0.25, 900, 0.25, at, this.sounds.mixer?.listener);
  }

  update(dt) {
    for (let i = this.slides.length - 1; i >= 0; i--) {
      const s = this.slides[i];
      s.t += dt;
      if (s.t >= s.seconds + s.hold) {
        this.scene.remove(s.model);
        s.model.traverse((o) => o.geometry?.dispose());
        this.slides.splice(i, 1);
        continue;
      }
      const k = Math.min(1, s.t / s.seconds);
      s.model.position.set(s.from.x + (s.to.x - s.from.x) * k, s.from.y, s.from.z + (s.to.z - s.from.z) * k);
    }
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
