// Free-fly camera for eliminated players: no body, no collision, and nothing
// is sent to the server. WASD flies along the look direction, Space/Shift go
// straight up/down.

import { lookDirection } from '/shared/raycast.js';

const SPEED = 12;

export class FreeCamera {
  constructor() {
    this.position = { x: 0, y: 0, z: 0 };
  }

  start(x, y, z) {
    this.position = { x, y, z };
  }

  update(dt, input) {
    const forward = input.axis('KeyW', 'KeyS');
    const strafe = input.axis('KeyD', 'KeyA');
    const up = (input.keys.has('Space') ? 1 : 0)
      - (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 1 : 0);
    const look = lookDirection(input.yaw, input.pitch);
    // Right is the strafe direction from stepPlayer.
    const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
    const step = SPEED * dt;
    this.position.x += (look.x * forward + rx * strafe) * step;
    this.position.y += (look.y * forward + up) * step;
    this.position.z += (look.z * forward + rz * strafe) * step;
  }
}
