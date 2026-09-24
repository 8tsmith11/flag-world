import * as THREE from 'three';
import { BLOCK } from '/shared/blocks.js';

const SPARKLE = new THREE.SphereGeometry(0.035, 5, 4);
const DUST = new THREE.BoxGeometry(0.08, 0.08, 0.08);
const SPARKLE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x78e6dd, transparent: true, depthWrite: false });
const DUST_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x77777a, transparent: true, depthWrite: false });

export class QuarryEffects {
  constructor(scene, world) {
    this.scene = scene;
    this.stones = new Map();
    this.particles = [];
    for (const { x, y, z } of world.quarries ?? []) {
      if (world.getBlock(x, y, z) === BLOCK.QUARRY_STONE) this.changed(x, y, z, BLOCK.QUARRY_STONE);
    }
  }

  changed(x, y, z, id) {
    const key = `${x},${y},${z}`;
    if (id === BLOCK.QUARRY_STONE) this.stones.set(key, { x, y, z, next: Math.random() * 8 });
    else this.stones.delete(key);
  }

  add(x, y, z, vx, vy, vz, life, dust = false) {
    const mesh = new THREE.Mesh(dust ? DUST : SPARKLE, dust ? DUST_MATERIAL.clone() : SPARKLE_MATERIAL.clone());
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.particles.push({ mesh, vx, vy, vz, life, remaining: life });
  }

  puff(x, y, z) {
    for (let i = 0; i < 9; i++) {
      this.add(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6,
        z + 0.2 + Math.random() * 0.6, (Math.random() - 0.5) * 1.4,
        Math.random() * 1.1, (Math.random() - 0.5) * 1.4, 0.45 + Math.random() * 0.35, true);
    }
  }

  update(dt, camera, range) {
    const distanceSq = (range + 2) ** 2;
    for (const stone of this.stones.values()) {
      stone.next -= dt;
      if (stone.next > 0) continue;
      stone.next = 7 + Math.random() * 7;
      const dx = stone.x + 0.5 - camera.x, dy = stone.y + 0.5 - camera.y, dz = stone.z + 0.5 - camera.z;
      if (dx * dx + dy * dy + dz * dz > distanceSq) continue;
      this.add(stone.x + 0.1 + Math.random() * 0.8, stone.y + 0.1 + Math.random() * 0.8,
        stone.z + 0.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.08,
        0.12, (Math.random() - 0.5) * 0.08, 1.8);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.remaining -= dt;
      if (particle.remaining <= 0) {
        this.scene.remove(particle.mesh);
        particle.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      if (particle.mesh.geometry === DUST) particle.vy -= 2.2 * dt;
      particle.mesh.material.opacity = particle.remaining / particle.life;
    }
  }
}
