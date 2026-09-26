// The Goblin Totem breaking apart: chunks of carved wood, stone and green
// glow burst out and tumble down, with a quick green flash.

import * as THREE from 'three';
import { GOBLINS } from '/shared/goblins.js';

const CHUNK = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const COLORS = [0x5b4128, 0x3b2a18, 0x47442e, 0x5f8a33, 0xe6dcc0, 0x9dff5a];
const PIECES = 90;
const GRAVITY = 14;

export class GoblinEffects {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];
    this.flashes = [];
  }

  totemBurst(x, y, z) {
    for (let i = 0; i < PIECES; i++) {
      const color = COLORS[i % COLORS.length];
      const material = color === 0x9dff5a
        ? new THREE.MeshBasicMaterial({ color, transparent: true })
        : new THREE.MeshLambertMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(CHUNK, material);
      mesh.position.set(x + (Math.random() - 0.5) * 1.2, y + Math.random() * 4, z + (Math.random() - 0.5) * 1.2);
      mesh.scale.setScalar(0.6 + Math.random() * 1.4);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 6;
      const life = 1.6 + Math.random() * 1.2;
      this.pieces.push({ mesh, vx: Math.cos(angle) * speed, vy: 3 + Math.random() * 7, vz: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 12, life, remaining: life });
    }
    const light = new THREE.PointLight(0x9dff5a, 6, 20, 1.5);
    light.position.set(x, y + 2.5, z);
    this.scene.add(light);
    this.flashes.push({ light, remaining: 0.8, life: 0.8 });
  }

  explosion(x,y,z,radius) {
    const cfg=GOBLINS.effects;
    for(let i=0;i<cfg.bombParticles;i++) {
      const mesh=new THREE.Mesh(CHUNK,new THREE.MeshBasicMaterial({color:i%3?0xff9b24:0x55504b,transparent:true}));
      mesh.position.set(x,y,z);mesh.scale.setScalar(radius*(0.5+Math.random()));this.scene.add(mesh);
      const angle=Math.random()*Math.PI*2,speed=cfg.bombParticleSpeed*(0.3+Math.random());
      this.pieces.push({mesh,vx:Math.cos(angle)*speed,vy:Math.random()*speed,vz:Math.sin(angle)*speed,spin:Math.random()*6,life:cfg.bombSeconds,remaining:cfg.bombSeconds});
    }
    const light=new THREE.PointLight(0xffaa44,cfg.bombFlashIntensity,cfg.bombFlashRange);light.position.set(x,y,z);this.scene.add(light);
    this.flashes.push({light,life:cfg.bombFlashSeconds,remaining:cfg.bombFlashSeconds,intensity:cfg.bombFlashIntensity});
  }

  update(dt) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.remaining -= dt;
      if (p.remaining <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.pieces.splice(i, 1);
        continue;
      }
      p.vy -= GRAVITY * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * 0.7 * dt;
      p.mesh.material.opacity = Math.min(1, p.remaining / 0.5);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.remaining -= dt;
      f.light.intensity = (f.intensity ?? 6) * Math.max(0, f.remaining / f.life);
      if (f.remaining <= 0) {
        this.scene.remove(f.light);
        this.flashes.splice(i, 1);
      }
    }
  }
}
