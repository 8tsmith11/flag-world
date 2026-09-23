// First-person arm: the same arm and fist as the player model, in the lower
// right of the screen, holding the item in hand. It has its own scene and
// camera and is drawn after the world with the depth buffer cleared, so it
// never clips into walls.
//
// Animations: a swing arc on click (repeating while mining), a short push
// when placing, sway that lags behind mouse look, and bob while walking.
// Drawing a bow brings the arm level toward the middle of the view, holding
// the bow upright, and pulls the string back.

import * as THREE from 'three';
import { createArm, setHandItem, setBowDraw, handItem } from './models.js';

// Resting pose: shoulder below and right of the view, arm reaching forward and
// a little up (pitch past 90° from hanging), so the fist sits in the lower right.
const REST = new THREE.Vector3(0.45, -0.55, -0.15);
const REST_PITCH = 1.9;
const REST_YAW = 0.15;

// Aiming a bow: the arm level (pitch 90° from hanging) and nearer the middle.
const AIM = new THREE.Vector3(0.2, -0.42, -0.1);
const AIM_PITCH = Math.PI / 2;
const AIM_YAW = 0.05;
const AIM_EASE = 10;

const SWING_MS = 280;
const PUSH_MS = 160;
const SWAY = 0.08;
const SWAY_FOLLOW = 10;
const BOB_PER_BLOCK = 2.4;

export class ViewModel {
  constructor(color) {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    light.position.set(0.3, 1, 0.6);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

    const { pivot, hand } = createArm(color);
    this.pivot = pivot;
    this.hand = hand;
    this.scene.add(pivot);

    this.swingStart = -Infinity;
    this.pushStart = -Infinity;
    // Look direction smoothed toward the real one; the difference is the sway.
    this.lagYaw = null;
    this.lagPitch = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    // Eased 0..1: how far into the aiming pose.
    this.aim = 0;
  }

  swing() {
    const now = performance.now();
    // Don't restart a swing that's already under way.
    if (now - this.swingStart >= SWING_MS) this.swingStart = now;
  }

  push() {
    this.pushStart = performance.now();
  }

  // look: { yaw, pitch }; speed: horizontal blocks/s on the ground (0 in the air);
  // mining: keep swinging.
  // draw: how far a bow is drawn (0..1), 0 when not drawing.
  update(dt, { look, speed, mining, held, draw = 0 }) {
    const now = performance.now();
    if (mining) this.swing();
    setHandItem(this.hand, held);
    this.aim += ((draw > 0 ? 1 : 0) - this.aim) * Math.min(1, dt * AIM_EASE);
    setBowDraw(handItem(this.hand), draw);

    if (this.lagYaw === null) this.lagYaw = look.yaw;
    const follow = 1 - Math.exp(-dt * SWAY_FOLLOW);
    // Unwrap so a turn across ±π doesn't whip the arm around.
    let dYaw = look.yaw - this.lagYaw;
    dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
    this.lagYaw += dYaw * follow;
    this.lagPitch += (look.pitch - this.lagPitch) * follow;
    const swayX = Math.max(-1, Math.min(1, dYaw)) * SWAY;
    const swayY = Math.max(-1, Math.min(1, look.pitch - this.lagPitch)) * SWAY;

    this.bobAmount += ((speed > 0.1 ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += speed * dt * BOB_PER_BLOCK;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount;
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.025 * this.bobAmount;

    const s = (now - this.swingStart) / SWING_MS;
    const swing = s >= 0 && s < 1 ? Math.sin(Math.PI * s) : 0;
    const p = (now - this.pushStart) / PUSH_MS;
    const push = p >= 0 && p < 1 ? Math.sin(Math.PI * p) : 0;

    const k = this.aim;
    this.pivot.position.set(
      REST.x + (AIM.x - REST.x) * k + swayX + bobX,
      REST.y + (AIM.y - REST.y) * k - swayY + bobY,
      REST.z + (AIM.z - REST.z) * k - push * 0.12,
    );
    // The swing chops down and across toward the crosshair.
    this.pivot.rotation.set(
      REST_PITCH + (AIM_PITCH - REST_PITCH) * k - swing * 0.9,
      REST_YAW + (AIM_YAW - REST_YAW) * k + swing * 0.35,
      swing * 0.2,
    );
  }

  render(renderer) {
    const size = renderer.getSize(new THREE.Vector2());
    if (this.camera.aspect !== size.x / size.y) {
      this.camera.aspect = size.x / size.y;
      this.camera.updateProjectionMatrix();
    }
    renderer.clearDepth();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
