// The storm cloud's weather, visual and sound only: faint flashes of light
// inside it now and then, and distant thunder after some of them while the
// listener is within earshot (STORM_CLOUD and AUDIO in config.js). The glow
// is additive sprites in the chamber, at the openings and on the side of the
// cloud facing the camera; no scene lights.

import * as THREE from 'three';
import { STORM_CLOUD as C, AUDIO } from '/shared/config.js';
import { STORM_SOUNDS } from '/shared/audio.js';

const PULSE_SECONDS = 0.14;
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d'), gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class StormEffects {
  constructor(scene, cloud, mixer) {
    this.scene = scene;
    this.cloud = cloud;
    this.mixer = mixer;
    this.center = new THREE.Vector3(cloud.x, cloud.y, cloud.z);
    this.group = new THREE.Group();
    this.texture = glowTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, color: 0xdcd4ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = (x, y, z, size) => {
      const s = new THREE.Sprite(this.material);
      s.position.set(x, y, z);
      s.scale.setScalar(size);
      this.group.add(s);
      return s;
    };
    sprite(cloud.x, cloud.floorY + 3, cloud.z, C.flashSize);
    for (const gap of cloud.gaps) sprite(gap.x, gap.y, gap.z, C.flashSize * 0.6);
    // Moved each frame to the cloud's surface on the camera's side.
    this.surface = sprite(cloud.x, cloud.y, cloud.z, cloud.radius * 1.8);
    this.group.visible = false;
    scene.add(this.group);
    this.time = 0;
    this.pulses = [];
    this.nextFlash = between(C.flashInterval);
    this.nextThunder = 0;
    this.thunderAt = null;
  }

  update(dt, listener, active) {
    this.time += dt;
    const near = listener && this.center.distanceTo(listener) < AUDIO.thunderRange;
    if (this.time >= this.nextFlash) {
      const count = C.flashPulses[0] + Math.floor(Math.random() * (C.flashPulses[1] - C.flashPulses[0] + 1));
      for (let i = 0; i < count; i++) {
        this.pulses.push({ start: this.time + i * (PULSE_SECONDS + Math.random() * 0.12), strength: 0.5 + Math.random() * 0.5 });
      }
      this.nextFlash = this.time + between(C.flashInterval);
      if (active && near && this.time >= this.nextThunder && this.thunderAt === null) {
        this.thunderAt = this.time + between(C.thunderDelay);
        this.nextThunder = this.time + between(C.thunderInterval);
      }
    }
    if (this.thunderAt !== null && this.time >= this.thunderAt) {
      this.thunderAt = null;
      if (active) this.mixer.play(STORM_SOUNDS.thunder, AUDIO.thunderGain, this.center, AUDIO.thunderRange);
    }
    let intensity = 0;
    this.pulses = this.pulses.filter((pulse) => {
      const age = this.time - pulse.start;
      if (age >= 0 && age < PULSE_SECONDS) intensity = Math.max(intensity, pulse.strength * (1 - age / PULSE_SECONDS));
      return age < PULSE_SECONDS;
    });
    this.group.visible = intensity > 0;
    if (!this.group.visible) return;
    this.material.opacity = intensity * C.flashOpacity;
    if (listener) {
      const toward = new THREE.Vector3().subVectors(listener, this.center).normalize();
      this.surface.position.copy(this.center).addScaledVector(toward, this.cloud.radius + 1.5);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.material.dispose();
    this.texture.dispose();
  }
}
