// An arrow shot from a bow or crossbow. It flies with gentle gravity and a little drag.
// Each tick its whole path is swept against blocks and players (so fast
// arrows can't skip through thin walls or players). It sticks where it hits a
// block, or hits a player and is gone. Arrows never damage blocks.

import {
  TICK_RATE, TICK_DT, ARROW_GRAVITY, ARROW_DRAG, ARROW_STICK_TIME, ARROW_SAFE_TIME,
} from '../shared/config.js';
import { isSolid } from '../shared/blocks.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { raycastBlock, raycastPlayers } from '../shared/raycast.js';
import { playerBoxOf } from '../shared/physics.js';

const SAFE_TICKS = Math.round(ARROW_SAFE_TIME * TICK_RATE);
const STICK_TICKS = Math.round(ARROW_STICK_TIME * TICK_RATE);
// Players are a touch easier to hit than their collision box.
const HIT_GROW = 0.1;

export class Arrow {
  // charge: 0..1 of the way from the weakest shot to a full draw.
  constructor(id, shooter, x, y, z, vx, vy, vz, charge) {
    this.id = id;
    this.type = ENTITY_TYPE.ARROW;
    this.shooter = shooter;
    this.charge = charge;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    // Crossbow bolts fall slower than bow arrows.
    this.gravity = ARROW_GRAVITY;
    this.age = 0;
    // Once it hits a block: that block, and ticks left before it disappears.
    this.stuckIn = null;
    this.stuckTicks = 0;
  }

  // One tick. Returns { hit: player, dir } if it hit a player, 'gone' if it
  // should be removed, or null.
  step(world, players) {
    this.age++;
    if (this.stuckIn) {
      const { x, y, z } = this.stuckIn;
      // Falls out (disappears) when its block is broken.
      return --this.stuckTicks <= 0 || !isSolid(world.getBlock(x, y, z)) ? 'gone' : null;
    }
    this.vx *= ARROW_DRAG;
    this.vz *= ARROW_DRAG;
    this.vy = this.vy * ARROW_DRAG - this.gravity * TICK_DT;
    const len = Math.hypot(this.vx, this.vy, this.vz) * TICK_DT;
    if (len === 0) return null;
    const dir = { x: this.vx * TICK_DT / len, y: this.vy * TICK_DT / len, z: this.vz * TICK_DT / len };
    const from = { x: this.x, y: this.y, z: this.z };

    const block = raycastBlock(world, from, dir, len, isSolid);
    const blockT = block ? block.t : len;
    const targets = [...players].filter((p) => !p.dead && p.connected && (p !== this.shooter || this.age > SAFE_TICKS));
    const hit = raycastPlayers(from, dir, blockT, targets, (p) => playerBoxOf(p.state), HIT_GROW);
    if (hit) return { hit: hit.player, dir, damageScale: hit.damageScale ?? 1 };
    if (block) {
      // Stick at the point of impact.
      this.x += dir.x * block.t;
      this.y += dir.y * block.t;
      this.z += dir.z * block.t;
      this.stuckIn = { x: block.x, y: block.y, z: block.z };
      this.stuckTicks = STICK_TICKS;
      return null;
    }
    this.x += dir.x * len;
    this.y += dir.y * len;
    this.z += dir.z * len;
    return null;
  }

  // Sent once in ENTITY_SPAWN / WELCOME.
  describe() {
    return this.snapshot();
  }

  // Per-tick snapshot for STATE while it flies (and once more as it sticks).
  // The velocity lets clients point the model along its flight.
  snapshot() {
    return { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz };
  }
}
