// Explosions and burning fuses (the explosives update), all client-side
// decoration of what the server reports:
//   - explode(): a bright flash, a fireball, smoke and debris, a boom and a
//     camera shake that fades with distance (EXPLOSION messages)
//   - lit barrels: sparks from the fuse and a crackling hiss while a block is
//     a lit barrel entity (litBarrel, every frame it is drawn)
//   - grenades: beeps that speed up as the fuse runs out (entity snapshots)
import * as THREE from 'three';
import { BLOCK } from '/shared/blocks.js';

const BALL = new THREE.SphereGeometry(0.5, 8, 6);
const CHIP = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const SPARK = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const material = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });

export class ExplosionEffects {
  constructor(scene, sounds) {
    this.scene = scene;
    this.sounds = sounds;
    this.particles = [];
    this.lights = [];
    this.barrels = new Map();
    this.beeps = new Map();
    this.shake = 0;
  }

  add(geometry, color, x, y, z, vx, vy, vz, life, grow = 0, gravity = 0, scale = 1) {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x, y, z); mesh.scale.setScalar(scale);
    this.scene.add(mesh);
    this.particles.push({ mesh, vx, vy, vz, life, remaining: life, grow, gravity });
  }

  // A blast of the given radius at x, y, z ('grenade' or 'barrel').
  explode(x, y, z, radius, kind, listener) {
    const big = kind === 'barrel', r = () => Math.random() - 0.5;
    const light = new THREE.PointLight(0xffb050, big ? 60 : 25, radius * 5, 2);
    light.position.set(x, y + 0.3, z);
    this.scene.add(light);
    this.lights.push({ light, life: 0.35, remaining: 0.35, start: light.intensity });
    for (let i = 0; i < (big ? 26 : 12); i++) {
      const s = radius * (0.5 + Math.random() * 0.6);
      this.add(BALL, [0xfff1b0, 0xffb347, 0xff7a2a, 0xe0431e][i % 4], x + r() * 0.6, y + r() * 0.6, z + r() * 0.6,
        r() * s * 2.5, r() * s * 2 + 0.6, r() * s * 2.5, 0.35 + Math.random() * 0.25, radius * 1.4, 0, 0.4);
    }
    for (let i = 0; i < (big ? 18 : 8); i++) {
      this.add(BALL, [0x4a4a4a, 0x6b6b6b, 0x8a8a8a][i % 3], x + r() * radius, y + r() * 0.8, z + r() * radius,
        r() * 1.2, 1 + Math.random() * 1.6, r() * 1.2, 1.4 + Math.random() * 1.2, 0.9, 0, 0.5);
    }
    for (let i = 0; i < (big ? 30 : 10); i++) {
      this.add(CHIP, [0x3a3530, 0x5b4a3a, 0x7a7a7a][i % 3], x, y, z, r() * 14, 3 + Math.random() * 8, r() * 14, 1 + Math.random() * 0.6, 0, 22);
    }
    this.sounds?.explosion?.({ x, y, z }, big);
    if (listener) {
      const d = Math.hypot(listener.x - x, listener.y - y, listener.z - z);
      this.shake = Math.max(this.shake, (big ? 0.45 : 0.22) * Math.max(0, 1 - d / (radius * 6)));
    }
  }

  // A lit barrel entity's fuse, every frame it is drawn (position: its
  // bottom center). Sparks and hiss come from update().
  litBarrel(id, position) {
    const b = this.barrels.get(id) ?? { next: 0, hiss: 0 };
    b.x = position.x - 0.5; b.y = position.y; b.z = position.z - 0.5; b.seen = performance.now();
    this.barrels.set(id, b);
  }

  // A grenade's fuse (ticks left), every frame it is drawn.
  grenade(id, position, fuse) {
    const interval = fuse > 30 ? 0.5 : fuse > 12 ? 0.25 : 0.12, now = performance.now() / 1000;
    if (now - (this.beeps.get(id) ?? 0) < interval) return;
    this.beeps.set(id, now);
    this.sounds?.grenadeBeep?.(position, fuse <= 12);
    this.add(SPARK, 0xffd36a, position.x, position.y + 0.25, position.z, (Math.random() - 0.5), 1.2, (Math.random() - 0.5), 0.25, 0, 4);
  }

  update(dt) {
    const now = performance.now();
    for (const [id, barrel] of this.barrels) {
      if (now - barrel.seen > 250) { this.barrels.delete(id); continue; } // gone (went off, or out of view)
      barrel.next -= dt; barrel.hiss -= dt;
      if (barrel.next <= 0) {
        barrel.next = 0.04;
        this.add(SPARK, Math.random() < 0.5 ? 0xffe27a : 0xff8a2a, barrel.x + 0.5, barrel.y + 1.1, barrel.z + 0.5,
          (Math.random() - 0.5) * 2.4, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4, 0.35, 0, 6);
      }
      if (barrel.hiss <= 0) { barrel.hiss = 0.22; this.sounds?.fuseHiss?.({ x: barrel.x + 0.5, y: barrel.y + 1, z: barrel.z + 0.5 }); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.remaining -= dt;
      if (p.remaining <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.particles.splice(i, 1); continue; }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt * 0.6);
      p.mesh.material.opacity = Math.min(1, p.remaining / p.life * 1.4);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.remaining -= dt;
      if (l.remaining <= 0) { this.scene.remove(l.light); l.light.dispose?.(); this.lights.splice(i, 1); continue; }
      l.light.intensity = l.start * l.remaining / l.life;
    }
    this.shake = Math.max(0, this.shake - dt * 1.2);
    if (this.beeps.size > 64) this.beeps.clear();
  }

  clear() {
    for (const p of this.particles) { this.scene.remove(p.mesh); p.mesh.material.dispose(); }
    for (const l of this.lights) this.scene.remove(l.light);
    this.particles = []; this.lights = []; this.barrels.clear(); this.beeps.clear(); this.shake = 0;
  }
}
