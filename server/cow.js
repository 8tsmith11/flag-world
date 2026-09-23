// Cows: server-simulated mobs that live in herds. They reuse the player
// physics (walking, stepping up, swimming, knockback) with their own box and
// the crouch edge protection always on, so they never walk off a cliff.
//
// Each cow grazes, wanders near the middle of its herd, and wanders back if
// it strays. When any cow in a herd is hurt, the whole herd panics and runs
// away from the attacker for COW_PANIC_TIME. Routes come from findPath.

import {
  TICK_RATE, COW_WIDTH, COW_HEIGHT, COW_HP, COW_WANDER_SPEED, COW_FLEE_SPEED,
} from '../shared/config.js';
import { createPlayerState, stepPlayer, isInWater } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { findPath } from './pathfind.js';

export const COW_BOX = { halfW: COW_WIDTH / 2, height: COW_HEIGHT };
// Cows need two blocks of headroom to walk somewhere.
const PATH_HEIGHT = 2;
const WANDER_RADIUS = 6;
const STRAY_DISTANCE = 10;
const FLEE_DISTANCE = 16;
// Ticks between new flight paths while panicking.
const FLEE_REPATH = TICK_RATE;
const STUCK_TICKS = TICK_RATE;

export class Herd {
  constructor(id) {
    this.id = id;
    this.cows = new Set();
    // Game tick the panic ends, and where the danger came from.
    this.panicUntil = 0;
    this.threat = null;
  }

  // Middle of the herd, on the X/Z plane.
  center() {
    let x = 0, z = 0;
    for (const cow of this.cows) {
      x += cow.state.x;
      z += cow.state.z;
    }
    return { x: x / this.cows.size, z: z / this.cows.size };
  }
}

export class Cow {
  constructor(id, herd, x, y, z) {
    this.id = id;
    this.type = ENTITY_TYPE.COW;
    this.herd = herd;
    herd.cows.add(this);
    this.state = createPlayerState(x, y, z);
    this.state.box = COW_BOX;
    this.state.edgeGuard = true;
    this.state.yaw = Math.random() * Math.PI * 2;
    this.hp = COW_HP;
    // Players and cows are both targets for punches and arrows.
    this.dead = false;
    this.connected = true;
    this.path = [];
    // Ticks until the next idea (while grazing), and until the next flight path.
    this.wait = Math.floor(Math.random() * 3 * TICK_RATE);
    this.repath = 0;
    this.stuck = 0;
  }

  // Integer spot the cow stands on, for pathfinding.
  cell() {
    const s = this.state;
    return { x: Math.floor(s.x), y: Math.floor(s.y + 0.01), z: Math.floor(s.z) };
  }

  goTo(world, x, z, maxNodes) {
    this.path = findPath(world, this.cell(), { x: Math.floor(x), z: Math.floor(z) }, { height: PATH_HEIGHT, maxNodes });
    this.stuck = 0;
  }

  // Decide where to go this tick.
  think(world, tick) {
    const herd = this.herd;
    const s = this.state;
    if (tick < herd.panicUntil && herd.threat) {
      if (--this.repath <= 0 || this.path.length === 0) {
        // Away from the threat, loosely together.
        let dx = s.x - herd.threat.x, dz = s.z - herd.threat.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const jitter = (Math.random() - 0.5) * 6;
        this.goTo(world, s.x + dx * FLEE_DISTANCE - dz * jitter, s.z + dz * FLEE_DISTANCE + dx * jitter, 300);
        // Staggered, so a panicking herd doesn't all plan on the same tick.
        this.repath = FLEE_REPATH + Math.floor(Math.random() * FLEE_REPATH);
      }
      return COW_FLEE_SPEED;
    }
    if (this.path.length) return COW_WANDER_SPEED;
    if (--this.wait > 0) return 0;
    this.wait = Math.floor((2 + Math.random() * 4) * TICK_RATE);
    const c = herd.center();
    const far = Math.hypot(s.x - c.x, s.z - c.z) > STRAY_DISTANCE;
    // Back toward the herd if straying; otherwise usually a stroll near it, sometimes just graze.
    if (far || Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * WANDER_RADIUS;
      this.goTo(world, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 250);
    }
    return 0;
  }

  // One tick: follow the path (steering, jumping up steps) through the shared physics.
  step(world, tick) {
    const speed = this.think(world, tick);
    const s = this.state;
    let forward = 0, jump = false;
    const next = this.path[0];
    if (next && speed > 0) {
      const dx = next.x + 0.5 - s.x, dz = next.z + 0.5 - s.z;
      if (Math.hypot(dx, dz) < 0.35) {
        this.path.shift();
      } else {
        // Yaw 0 faces -Z; movement is along (-sin yaw, -cos yaw).
        s.yaw = Math.atan2(-dx, -dz);
        forward = speed;
        jump = next.y > Math.floor(s.y + 0.01) && s.onGround;
      }
    }
    // Keep afloat in water.
    if (isInWater(s, world)) jump = true;
    const { x, z } = s;
    stepPlayer(s, { forward, strafe: 0, jump, yaw: s.yaw, pitch: 0 }, world);
    // No progress on a path for a while: give up on it.
    if (forward > 0 && Math.hypot(s.x - x, s.z - z) < 0.01) {
      if (++this.stuck > STUCK_TICKS) this.path = [];
    } else {
      this.stuck = 0;
    }
  }

  // Sent once in ENTITY_SPAWN / WELCOME.
  describe() {
    return this.snapshot();
  }

  // Per-tick snapshot for STATE, sent on ticks it moved.
  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  }
}
