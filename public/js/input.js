// Keyboard state, pointer-locked mouse look, mouse buttons and hotbar selection.

import { HOTBAR_SIZE } from '/shared/config.js';

const MOUSE_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.01;
// Arrow-key look speed in radians/second, for touchpads that ignore input while typing.
const KEY_TURN_SPEED = 2.5;

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.locked = false;
    // Left mouse button held (break).
    this.primaryDown = false;
    // One-shot actions, latched until the next simulation tick consumes them.
    this.attackPressed = false;
    this.placePressed = false;
    this.dropPressed = false;
    this.slot = 0;

    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyQ' && !e.repeat) this.dropPressed = true;
      if (!e.repeat) this.onKey?.(e.code);
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && Number(digit[1]) <= HOTBAR_SIZE) this.slot = Number(digit[1]) - 1;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.release());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.release();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.primaryDown = this.attackPressed = true;
      if (e.button === 2) this.placePressed = true;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked || e.deltaY === 0) return;
      this.slot = (this.slot + Math.sign(e.deltaY) + HOTBAR_SIZE) % HOTBAR_SIZE;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primaryDown = false;
    });
    // A refused lock request leaves us unlocked; report it like an unlock.
    document.addEventListener('pointerlockerror', () => this.onLockChange?.(false));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.clampPitch();
    });
  }

  release() {
    this.keys.clear();
    this.primaryDown = false;
    this.attackPressed = false;
    this.placePressed = false;
    this.dropPressed = false;
  }

  clampPitch() {
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  // Applies arrow-key look; call once per rendered frame.
  update(dt) {
    this.yaw += this.axis('ArrowLeft', 'ArrowRight') * KEY_TURN_SPEED * dt;
    this.pitch += this.axis('ArrowUp', 'ArrowDown') * KEY_TURN_SPEED * dt;
    this.clampPitch();
  }

  requestLock() {
    this.element.requestPointerLock();
  }

  axis(positive, negative) {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  // Snapshot of the controls for one simulation tick (without seq). Consumes
  // the one-shot attack/place/drop presses.
  sample() {
    const attack = this.attackPressed, place = this.placePressed, drop = this.dropPressed;
    this.attackPressed = this.placePressed = this.dropPressed = false;
    return {
      attack,
      place,
      drop,
      slot: this.slot,
      forward: this.axis('KeyW', 'KeyS'),
      strafe: this.axis('KeyD', 'KeyA'),
      jump: this.keys.has('Space'),
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }
}
