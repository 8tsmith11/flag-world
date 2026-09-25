// Crawlers: spider-like mobs in dungeons, underside ruins and dark caverns.
// They reuse the player physics (collision, gravity, knockback) with a low,
// wide box and their own walking speed, and climb any wall they walk into.
//
// Idle, a crawler wanders near where it spawned, with edge protection so it
// doesn't stroll off a ledge. It hunts the nearest player it can see within
// CRAWLER_AGGRO_RANGE and gives up once they're beyond CRAWLER_GIVE_UP_RANGE;
// provoked (see provocation.js), it hunts its attacker anywhere.

import {
  TICK_RATE, TICK_DT, GRAVITY, WALK_SPEED, CRAWLER_WIDTH, CRAWLER_HEIGHT, CRAWLER_HP, CRAWLER_SPEED,
  CRAWLER_CLIMB_SPEED, CRAWLER_REACH, CRAWLER_AGGRO_RANGE, CRAWLER_GIVE_UP_RANGE, CRAWLER_WANDER_RADIUS,
  CRAWLER_ATTACK_COOLDOWN,
} from '../shared/config.js';
import { createPlayerState, stepPlayer, playerBoxOf, isInWater } from '../shared/physics.js';
import { isSolid } from '../shared/blocks.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, canSee, huntable } from './provocation.js';

export const CRAWLER_BOX = { halfW: CRAWLER_WIDTH / 2, height: CRAWLER_HEIGHT };
const ATTACK_TICKS = Math.round(CRAWLER_ATTACK_COOLDOWN * TICK_RATE);

export class Crawler {
  constructor(id, x, y, z) {
    this.id = id;
    this.type = ENTITY_TYPE.CRAWLER;
    this.name = 'Crawler';
    this.home = { x, y, z };
    this.state = createPlayerState(x, y, z);
    this.state.box = CRAWLER_BOX;
    this.state.moveScale = CRAWLER_SPEED / WALK_SPEED;
    this.state.yaw = Math.random() * Math.PI * 2;
    this.hp = CRAWLER_HP;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    this.target = null;
    this.nextAttackTick = 0;
    // Walking into a wall last tick: climb it this tick.
    this.climbing = false;
    this.wanderGoal = null;
    this.wait = Math.floor(Math.random() * 3 * TICK_RATE);
  }

  eye() {
    const s = this.state;
    return { x: s.x, y: s.y + CRAWLER_HEIGHT * 0.7, z: s.z };
  }

  // Provoked target, else the current target while in range, else the
  // nearest visible player within aggro range.
  chooseTarget(world, players, tick) {
    const provoked = this.provocation.current(world, this.eye(), tick);
    if (provoked) return provoked;
    const s = this.state;
    const distance = (p) => Math.hypot(p.state.x - s.x, p.state.y - s.y, p.state.z - s.z);
    if (this.target && huntable(this.target) && distance(this.target) <= CRAWLER_GIVE_UP_RANGE) return this.target;
    let best = null;
    for (const player of players) {
      if (!huntable(player)) continue;
      const d = distance(player);
      if (d <= CRAWLER_AGGRO_RANGE && (!best || d < best.d) && canSee(world, this.eye(), player)) best = { player, d };
    }
    return best?.player ?? null;
  }

  // Idle: pauses, then a short stroll to a spot near home.
  wander() {
    const s = this.state;
    if (this.wanderGoal && Math.hypot(this.wanderGoal.x - s.x, this.wanderGoal.z - s.z) > 0.6) return this.wanderGoal;
    this.wanderGoal = null;
    if (--this.wait > 0) return null;
    this.wait = Math.floor((2 + Math.random() * 4) * TICK_RATE);
    const angle = Math.random() * Math.PI * 2, distance = Math.random() * CRAWLER_WANDER_RADIUS;
    this.wanderGoal = { x: this.home.x + Math.cos(angle) * distance, z: this.home.z + Math.sin(angle) * distance };
    return this.wanderGoal;
  }

  // Whether its box is within biting reach of the player's box.
  inReach(player) {
    const s = this.state, p = player.state, box = playerBoxOf(p);
    const gapX = Math.abs(p.x - s.x) - box.halfW - CRAWLER_BOX.halfW;
    const gapZ = Math.abs(p.z - s.z) - box.halfW - CRAWLER_BOX.halfW;
    const gapY = Math.max(s.y - (p.y + box.height), p.y - (s.y + CRAWLER_HEIGHT));
    return Math.max(gapX, gapZ, gapY) <= CRAWLER_REACH;
  }

  // One tick. Returns the player bitten this tick, or null; the game applies the damage.
  step(world, players, tick) {
    const s = this.state;
    this.target = this.chooseTarget(world, players, tick);
    const goal = this.target ? { x: this.target.state.x + (this.approachOffset?.x ?? 0),
      z: this.target.state.z + (this.approachOffset?.z ?? 0) } : this.wander();
    let forward = 0;
    if (goal) {
      const dx = goal.x - s.x, dz = goal.z - s.z;
      if (Math.hypot(dx, dz) > (this.target ? 0.3 : 0.6)) {
        // Yaw 0 faces -Z; movement is along (-sin yaw, -cos yaw).
        s.yaw = Math.atan2(-dx, -dz);
        forward = this.target ? 1 : 0.5;
      }
    }
    // Only idle crawlers mind the edge; hunting ones follow you off it.
    s.edgeGuard = true;
    // Climb only toward a player above us. Idle wandering into a ruin wall
    // should choose another stroll, and a roof must stop a climb.
    const above = this.target && this.target.state.y > s.y + CRAWLER_HEIGHT;
    const ceiling = isSolid(world.getBlock(Math.floor(s.x), Math.floor(s.y + CRAWLER_HEIGHT + 0.1), Math.floor(s.z)));
    if (this.climbing && forward > 0 && above && !ceiling) s.vy = CRAWLER_CLIMB_SPEED + GRAVITY * TICK_DT;
    const { x, z } = s;
    stepPlayer(s, { forward, strafe: 0, jump: isInWater(s, world), yaw: s.yaw, pitch: 0 }, world);
    const expected = CRAWLER_SPEED * forward * TICK_DT;
    const blocked = forward > 0 && Math.hypot(s.x - x, s.z - z) < expected * 0.25;
    this.climbing = !!above && !ceiling && blocked;
    if (blocked && !this.target) {
      this.wanderGoal = null;
      this.wait = Math.floor((1 + Math.random() * 2) * TICK_RATE);
    }

    if (this.target && tick >= this.nextAttackTick && this.inReach(this.target)) {
      this.nextAttackTick = tick + ATTACK_TICKS;
      return this.target;
    }
    return null;
  }

  describe() {
    return this.snapshot();
  }

  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, name: this.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
      climbing: this.climbing && !s.onGround };
  }
}
