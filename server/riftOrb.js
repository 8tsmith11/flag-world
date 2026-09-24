import { TICK_DT, RIFT_ORB } from '../shared/config.js';
import { ITEM } from '../shared/itemIds.js';
import { isSolid } from '../shared/blocks.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { raycastBlock } from '../shared/raycast.js';

export class RiftOrbProjectile {
  constructor(id, owner, x, y, z, direction) {
    this.id = id;
    this.owner = owner;
    this.x = x; this.y = y; this.z = z;
    this.vx = direction.x * RIFT_ORB.throwSpeed;
    this.vy = direction.y * RIFT_ORB.throwSpeed + RIFT_ORB.throwSpeed * RIFT_ORB.launchLift;
    this.vz = direction.z * RIFT_ORB.throwSpeed;
  }

  step(world) {
    this.vy -= RIFT_ORB.gravity * TICK_DT;
    const dx = this.vx * TICK_DT, dy = this.vy * TICK_DT, dz = this.vz * TICK_DT;
    const distance = Math.hypot(dx, dy, dz);
    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
    const hit = raycastBlock(world, this, direction, distance + RIFT_ORB.radius, isSolid);
    if (hit) {
      this.x += direction.x * Math.max(0, hit.t - RIFT_ORB.radius);
      this.y += direction.y * Math.max(0, hit.t - RIFT_ORB.radius);
      this.z += direction.z * Math.max(0, hit.t - RIFT_ORB.radius);
      if (hit.ny > 0) return { hit };
      // A wall or ceiling is not a landing surface. Slide down it until the
      // orb reaches solid ground, then open the portal there.
      this.x += hit.nx * RIFT_ORB.radius;
      this.y += hit.ny * RIFT_ORB.radius;
      this.z += hit.nz * RIFT_ORB.radius;
      this.vx = 0;
      this.vz = 0;
      this.vy = Math.min(0, this.vy);
      return null;
    }
    this.x += dx; this.y += dy; this.z += dz;
    if (this.y < world.voidY || this.x < 0 || this.z < 0
      || this.x >= world.sizeX || this.z >= world.sizeZ) return { lost: true };
    return null;
  }

  describe() { return this.snapshot(); }
  snapshot() {
    return { id: this.id, type: ENTITY_TYPE.RIFT_ORB, item: ITEM.RIFT_ORB,
      x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz };
  }
}
