import * as THREE from 'three';
import { DRAGON_ARENA as C } from '/shared/config.js';

// Camera-local particles make the distant arena feel alive without loading
// particle systems in the ordinary island world.
export class ArenaEffects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    const positions = new Float32Array(C.ashCount * 3);
    const colors = new Float32Array(C.ashCount * 3);
    for (let i = 0; i < C.ashCount; i++) {
      const phase = i * 2.399963229728653;
      const r = C.ashRadius * Math.sqrt((i + 0.5) / C.ashCount);
      const particle = { x: Math.cos(phase) * r, y: (i * 17 % C.ashHeight),
        z: Math.sin(phase) * r, speed: 0.15 + (i % 7) * 0.06 };
      this.particles.push(particle);
      const color = new THREE.Color(i % 4 === 0 ? 0xff7b28 : 0x98736a);
      colors.set(color.toArray(), i * 3);
      positions.set([particle.x, particle.y, particle.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true,
      size: 0.22, transparent: true, opacity: 0.65, depthWrite: false, sizeAttenuation: true }));
    this.points.visible = false;
    scene.add(this.points);
  }
  update(dt, camera, active) {
    this.points.visible = active;
    if (!active) return;
    const positions = this.points.geometry.attributes.position;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y += dt * p.speed;
      if (p.y > C.ashHeight) p.y -= C.ashHeight;
      positions.setXYZ(i, p.x + camera.position.x,
        p.y + camera.position.y - C.ashHeight / 2,
        p.z + camera.position.z);
    }
    positions.needsUpdate = true;
  }
}
