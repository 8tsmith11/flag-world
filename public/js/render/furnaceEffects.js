// Fire in a burning furnace's mouth and a few smoke puffs from its top vent.
// Only lit furnaces have models; the server sends changes only when fuel starts
// or stops burning. Distant effects are hidden to keep per-frame work small.
import * as THREE from 'three';
import { blockBase, BLOCK } from '/shared/blocks.js';

const FLAME_COLORS = [0xff6325, 0xffb537, 0xffde69];
const SMOKE_COUNT = 5;

export class FurnaceEffects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.effects = new Map();
    this.flameGeometry = new THREE.ConeGeometry(0.105, 0.35, 5);
    this.smokeGeometry = new THREE.SphereGeometry(1, 5, 4);
    this.flameMaterials = FLAME_COLORS.map((color) => new THREE.MeshBasicMaterial({ color }));
  }

  setLit(x, y, z, lit) {
    const key = `${x},${y},${z}`;
    if (!lit || blockBase(this.world.getBlock(x, y, z)).base !== BLOCK.FURNACE) {
      this.remove(key);
      return;
    }
    if (this.effects.has(key)) return;
    const group = new THREE.Group();
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = -blockBase(this.world.getBlock(x, y, z)).facing * Math.PI / 2;
    const flames = FLAME_COLORS.map((_, i) => {
      const mesh = new THREE.Mesh(this.flameGeometry, this.flameMaterials[i]);
      mesh.position.set((i - 1) * 0.13, 0.29, -0.535 - i * 0.002);
      group.add(mesh);
      return mesh;
    });
    const smoke = Array.from({ length: SMOKE_COUNT }, (_, i) => {
      const material = new THREE.MeshBasicMaterial({ color: 0x999b9d, transparent: true,
        opacity: 0.25, depthWrite: false });
      const mesh = new THREE.Mesh(this.smokeGeometry, material);
      group.add(mesh);
      return { mesh, age: i / SMOKE_COUNT, driftX: (Math.random() - 0.5) * 0.3,
        driftZ: (Math.random() - 0.5) * 0.3 };
    });
    this.scene.add(group);
    this.effects.set(key, { x, z, group, flames, smoke, time: Math.random() * 10 });
  }

  remove(key) {
    const effect = this.effects.get(key);
    if (!effect) return;
    this.scene.remove(effect.group);
    for (const puff of effect.smoke) puff.mesh.material.dispose();
    this.effects.delete(key);
  }

  update(dt, cameraPosition, viewDistance) {
    const rangeSq = (viewDistance + 8) ** 2;
    for (const effect of this.effects.values()) {
      const dx = effect.x + 0.5 - cameraPosition.x, dz = effect.z + 0.5 - cameraPosition.z;
      effect.group.visible = dx * dx + dz * dz <= rangeSq;
      if (!effect.group.visible) continue;
      effect.time += dt;
      effect.flames.forEach((flame, i) => {
        const flicker = Math.sin(effect.time * (13 + i * 2) + i * 2.7);
        flame.scale.set(0.9 + flicker * 0.12, 0.75 + flicker * 0.18, 1);
      });
      for (const puff of effect.smoke) {
        puff.age = (puff.age + dt * 0.52) % 1;
        const a = puff.age;
        puff.mesh.position.set(puff.driftX * a, 1.08 + a * 1.5, puff.driftZ * a);
        puff.mesh.scale.setScalar(0.055 + a * 0.14);
        puff.mesh.material.opacity = 0.28 * (1 - a);
      }
    }
  }
}
