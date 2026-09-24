// Goblins: the Goblin Totem, the Goblin King and Goblin Workers. They live in
// Game.mobs beside Crawlers and Void Eels and reuse the player physics with
// their own boxes and speeds. Their fortress-wide state (storage, respawns,
// quarry claims) is kept by GoblinController (goblins.js), which each one
// holds as `controller`. Numbers are in shared/goblins.js.

import { TICK_RATE, WALK_SPEED } from '../shared/config.js';
import { BLOCK, breakTicks } from '../shared/blocks.js';
import { GOBLINS } from '../shared/goblins.js';
import { moduleAt } from '../shared/goblinModules.js';
import { createPlayerState, stepPlayer, playerBoxOf, isInWater, isOnLadder } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, canSee, huntable } from './provocation.js';
import { planRoute, followRoute, repath, yawToward } from './goblinNav.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const boxOf = ({ width, height }) => ({ halfW: width / 2, height });

export const TOTEM_BOX = boxOf(GOBLINS.totem);
export const KING_BOX = boxOf(GOBLINS.king);
export const WORKER_BOX = boxOf(GOBLINS.worker);

// Common to walking goblins: physics, steering with separation, and being stuck.
class Goblin {
  constructor(id, type, name, controller, x, y, z, box, hp) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.goblin = true;
    this.controller = controller;
    this.state = createPlayerState(x, y, z);
    this.state.box = box;
    this.state.yaw = Math.random() * Math.PI * 2;
    this.hp = hp;
    this.maxHp = hp;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    // Set by the controller each tick: a push away from crowding goblins.
    this.separation = { x: 0, z: 0 };
    this.stuckTicks = 0;
    this.climbing = false;
    this.walking = false;
  }

  eye() {
    const s = this.state;
    return { x: s.x, y: s.y + s.box.height * 0.85, z: s.z };
  }

  // One physics tick. `move`: { dx, dz } to walk that way (plus separation),
  // { yaw, forward } to climb, or null to stand (still nudged apart).
  move(world, move, speed) {
    const s = this.state;
    s.moveScale = speed / WALK_SPEED;
    let forward = 0;
    let jump = isInWater(s, world);
    const sep = this.separation;
    if (move && 'forward' in move) {
      s.yaw = move.yaw;
      forward = move.forward;
    } else {
      let dx = move?.dx ?? 0, dz = move?.dz ?? 0;
      const length = Math.hypot(dx, dz);
      if (length > 1e-3) { dx /= length; dz /= length; }
      dx += sep.x * GOBLINS.separation.strength;
      dz += sep.z * GOBLINS.separation.strength;
      const pushed = Math.hypot(dx, dz);
      if (pushed > 0.15) {
        s.yaw = yawToward(dx, dz);
        forward = length > 1e-3 ? 1 : Math.min(0.6, pushed);
      }
    }
    const { x, z } = s;
    stepPlayer(s, { forward, strafe: 0, jump: jump || this.stuckTicks > 3, yaw: s.yaw, pitch: 0 }, world);
    const moved = Math.hypot(s.x - x, s.z - z);
    const climbingNow = isOnLadder(s, world) && move && 'forward' in move;
    this.stuckTicks = forward > 0 && !climbingNow && moved < speed * forward / TICK_RATE * 0.2 ? this.stuckTicks + 1 : 0;
    this.climbing = !!climbingNow;
    this.walking = moved > 0.01;
  }

  // Walks the current route (replanning to `goal` when it changes); true once there.
  walkTo(world, goal, speed) {
    const fortress = this.controller.fortress;
    const route = this.route;
    if (!route || Math.hypot(route.goal.x - goal.x, route.goal.y - goal.y, route.goal.z - goal.z) > 0.5) {
      this.route = planRoute(fortress, this.state, goal);
    }
    if (this.stuckTicks > 20) {
      repath(this.route);
      this.stuckTicks = 0;
    }
    const step = followRoute(this.route, this.state, world);
    if (step.arrived) {
      this.move(world, null, speed);
      return true;
    }
    this.move(world, step, speed);
    return false;
  }

  describe() {
    return { ...this.snapshot(), maxHp: this.maxHp };
  }

  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, name: this.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
      walking: this.walking, climbing: this.climbing, hp: this.hp };
  }

  // Changes that STATE must carry even when it stands still.
  extraKey() {
    return `${this.climbing}`;
  }
}

// The Goblin Totem: a stationary target with the fortress's shared storage
// (kept by the controller). Only player weapons hurt it; after regenDelay
// without damage it heals back to full.
export class GoblinTotem {
  constructor(id, controller, x, y, z) {
    this.id = id;
    this.type = ENTITY_TYPE.GOBLIN_TOTEM;
    this.name = 'Goblin Totem';
    this.goblin = true;
    this.controller = controller;
    this.state = createPlayerState(x, y, z);
    this.state.box = TOTEM_BOX;
    this.hp = GOBLINS.totem.hp;
    this.maxHp = GOBLINS.totem.hp;
    this.dead = false;
    this.connected = true;
    this.lastDamageTick = -Infinity;
  }

  step(world, players, tick) {
    // Hits push the state around; the totem stays put.
    Object.assign(this.state, { kx: 0, kz: 0, vx: 0, vy: 0, vz: 0, slowTicks: 0 });
    if (this.hp < this.maxHp && tick - this.lastDamageTick >= ticks(GOBLINS.totem.regenDelay)) {
      this.hp = Math.min(this.maxHp, this.hp + GOBLINS.totem.regenRate / TICK_RATE);
    }
    return null;
  }

  describe() {
    return { ...this.snapshot(), maxHp: this.maxHp };
  }

  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, name: this.name, x: s.x, y: s.y, z: s.z, yaw: 0, hp: Math.ceil(this.hp) };
  }

  extraKey() {
    return Math.ceil(this.hp);
  }
}

// The Goblin King guards its arena (the Totem Hall, or a square around where
// an egg hatched it): it attacks players who enter, chases its provoker
// within the arena but never out of it, and goes back beside the totem.
export class GoblinKing extends Goblin {
  constructor(id, controller, x, y, z, arena, home) {
    super(id, ENTITY_TYPE.GOBLIN_KING, 'Goblin King', controller, x, y, z, KING_BOX, GOBLINS.king.hp);
    // { x0, z0, x1, z1, y0, y1 } in world units (feet inside it), and where it waits.
    this.arena = arena;
    this.home = home;
    this.target = null;
    this.nextAttackTick = 0;
    this.biteDamage = GOBLINS.king.damage;
    this.biteKnockback = GOBLINS.king.knockback;
    this.swung = false;
  }

  inArena(p) {
    const a = this.arena;
    return p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1 && p.y >= a.y0 && p.y <= a.y1;
  }

  chooseTarget(world, players, tick) {
    const provoked = this.provocation.current(world, this.eye(), tick);
    if (provoked) return provoked;
    if (this.target && huntable(this.target) && this.inArena(this.target.state)) return this.target;
    let best = null;
    for (const player of players) {
      if (!huntable(player) || !this.inArena(player.state)) continue;
      const d = Math.hypot(player.state.x - this.state.x, player.state.z - this.state.z);
      if ((!best || d < best.d) && canSee(world, this.eye(), player)) best = { player, d };
    }
    return best?.player ?? null;
  }

  inReach(player) {
    const s = this.state, p = player.state, box = playerBoxOf(p);
    const gapX = Math.abs(p.x - s.x) - box.halfW - KING_BOX.halfW;
    const gapZ = Math.abs(p.z - s.z) - box.halfW - KING_BOX.halfW;
    const gapY = Math.max(s.y - (p.y + box.height), p.y - (s.y + KING_BOX.height));
    return Math.max(gapX, gapZ, gapY) <= GOBLINS.king.reach;
  }

  step(world, players, tick) {
    const s = this.state;
    this.target = this.chooseTarget(world, players, tick);
    const a = this.arena;
    const goal = this.target ? { x: this.target.state.x, z: this.target.state.z } : this.home;
    const gx = Math.max(a.x0, Math.min(a.x1, goal.x)), gz = Math.max(a.z0, Math.min(a.z1, goal.z));
    const far = Math.hypot(gx - s.x, gz - s.z) > (this.target ? 0.4 : 0.6);
    this.move(world, far ? { dx: gx - s.x, dz: gz - s.z } : null, GOBLINS.king.speed);
    // Never pushed out of its arena (knockback included).
    s.x = Math.max(a.x0, Math.min(a.x1, s.x));
    s.z = Math.max(a.z0, Math.min(a.z1, s.z));
    if (this.target && !far) s.yaw = yawToward(this.target.state.x - s.x, this.target.state.z - s.z);
    if (this.target && tick >= this.nextAttackTick && this.inReach(this.target)) {
      this.nextAttackTick = tick + ticks(GOBLINS.king.cooldown);
      this.swung = true;
      return this.target;
    }
    return null;
  }
}

// Goblin Workers mine what the Quarry Stone regrows, carry it to the totem
// and flee from players. `stray` workers (hatched outside the fortress)
// potter about where they hatched instead.
export class GoblinWorker extends Goblin {
  constructor(id, controller, x, y, z, { stray = false } = {}) {
    super(id, ENTITY_TYPE.GOBLIN_WORKER, 'Goblin Worker', controller, x, y, z, WORKER_BOX, GOBLINS.worker.hp);
    this.stray = stray;
    this.home = { x, y, z };
    // item id -> count
    this.carrying = new Map();
    // 'work' (to the quarry, mining), 'deposit' (to the totem) or 'flee'.
    this.mode = 'work';
    this.claim = null;
    this.mineTicks = 0;
    this.mining = false;
    this.idleTicks = 0;
    this.lastThreatTick = -Infinity;
    this.fleeGoal = null;
    this.nextFleePlan = 0;
    this.route = null;
    this.wanderGoal = null;
  }

  carried() {
    let total = 0;
    for (const count of this.carrying.values()) total += count;
    return total;
  }

  nearestThreat(players, range) {
    let best = null;
    for (const player of players) {
      if (!huntable(player)) continue;
      const d = Math.hypot(player.state.x - this.state.x, player.state.y - this.state.y, player.state.z - this.state.z);
      if (d <= range && (!best || d < best.d)) best = { player, d };
    }
    return best;
  }

  releaseClaim() {
    if (this.claim) this.controller.claims.delete(this.claim.key);
    this.claim = null;
    this.mineTicks = 0;
  }

  // The module farthest from every threatening player, as a place to run to.
  fleeTarget(players) {
    const fortress = this.controller.fortress;
    const threats = players.filter((p) => huntable(p)
      && Math.hypot(p.state.x - this.state.x, p.state.z - this.state.z) <= GOBLINS.worker.safeRange);
    const away = (point) => Math.min(...threats.map((p) => Math.hypot(p.state.x - point.x, p.state.y - point.y, p.state.z - point.z)));
    const here = fortress && moduleAt(fortress, this.state.x, this.state.y + 0.1, this.state.z);
    if (!here) {
      // Outside the fortress: straight away from the nearest player.
      const t = threats[0]?.state ?? this.state;
      const dx = this.state.x - t.x, dz = this.state.z - t.z, length = Math.hypot(dx, dz) || 1;
      return { x: this.state.x + dx / length * 6, y: this.state.y, z: this.state.z + dz / length * 6 };
    }
    let best = null;
    for (const module of fortress.modules) {
      const spot = module.feature?.kind === 'totem'
        ? { x: module.box.x0 + 2.5, y: module.floorY, z: module.box.z0 + 2.5 }
        : module.feature?.kind === 'quarry' ? { x: module.box.x0 + 1.5, y: module.floorY, z: module.box.z0 + 1.5 }
          : module.center;
      const score = away(spot);
      if (!best || score > best.score) best = { spot, score };
    }
    return best.spot;
  }

  // A stone next to the fortress quarry that nobody has claimed, with the
  // spot to stand on to mine it, or null.
  findWork(world) {
    const quarry = this.controller.quarry;
    if (!quarry || world.getBlock(quarry.x, quarry.y, quarry.z) !== BLOCK.QUARRY_STONE) return null;
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const options = [];
    for (const [dx, dz] of sides) {
      const stand = { x: quarry.x + 2 * dx + 0.5, y: quarry.y, z: quarry.z + 2 * dz + 0.5 };
      if (world.getBlock(quarry.x + 2 * dx, quarry.y, quarry.z + 2 * dz) !== BLOCK.AIR) continue;
      for (const block of [{ x: quarry.x + dx, y: quarry.y, z: quarry.z + dz }, { x: quarry.x, y: quarry.y + 1, z: quarry.z }]) {
        const key = `${block.x},${block.y},${block.z}`;
        if (world.getBlock(block.x, block.y, block.z) !== BLOCK.STONE || this.controller.claims.has(key)) continue;
        options.push({ key, block, stand, d: Math.hypot(stand.x - this.state.x, stand.z - this.state.z) });
      }
    }
    options.sort((a, b) => a.d - b.d);
    return options[0] ?? null;
  }

  // Where to wait for stone: a quiet corner of the quarry room.
  waitSpot() {
    const quarry = this.controller.quarry;
    const corner = this.id % 4;
    return { x: quarry.x + (corner & 1 ? 2.5 : -1.5), y: quarry.y, z: quarry.z + (corner & 2 ? 2.5 : -1.5) };
  }

  step(world, players, tick) {
    const s = this.state;
    this.mining = false;
    const settings = GOBLINS.worker;
    const threat = this.nearestThreat(players, settings.fleeRange);
    if (threat) {
      this.lastThreatTick = tick;
      if (this.mode !== 'flee') {
        this.releaseClaim();
        this.mode = 'flee';
        this.nextFleePlan = 0;
      }
    }
    if (this.mode === 'flee') {
      // Safe once nobody is near it, nor near where it would go back to work.
      const resume = this.carried() >= settings.carryLimit ? this.controller.totemSpot : this.controller.quarry;
      const watched = resume && players.some((p) => huntable(p)
        && Math.hypot(p.state.x - resume.x, p.state.y - resume.y, p.state.z - resume.z) <= settings.fleeRange);
      if (watched || this.nearestThreat(players, settings.safeRange)) this.lastThreatTick = tick;
      if (tick - this.lastThreatTick >= ticks(settings.safeTime)) {
        this.mode = this.carried() >= settings.carryLimit ? 'deposit' : 'work';
        this.route = null;
      } else {
        if (tick >= this.nextFleePlan) {
          this.fleeGoal = this.fleeTarget(players);
          this.nextFleePlan = tick + ticks(1);
        }
        this.walkTo(world, this.fleeGoal, settings.fleeSpeed);
        return null;
      }
    }

    const quarry = this.controller.quarry;
    if (this.stray || !quarry) {
      // Nothing to work: stroll around home.
      if (!this.wanderGoal || this.walkTo(world, this.wanderGoal, settings.speed * 0.5)) {
        if (!this.wanderGoal || Math.random() < 0.02) {
          const angle = Math.random() * Math.PI * 2, distance = Math.random() * 4;
          this.wanderGoal = { x: this.home.x + Math.cos(angle) * distance, y: this.home.y, z: this.home.z + Math.sin(angle) * distance };
          this.route = null;
        }
      }
      return null;
    }

    if (this.mode === 'deposit') {
      const totem = this.controller.totemSpot;
      const goal = { x: totem.x + (this.id % 2 ? 2 : -2), y: totem.y, z: totem.z + ((this.id >> 1) % 2 ? 2 : -2) };
      const arrived = this.walkTo(world, goal, settings.speed);
      if (arrived || Math.hypot(totem.x - s.x, totem.z - s.z) <= GOBLINS.totem.depositRange && Math.abs(totem.y - s.y) < 1.5) {
        this.controller.deposit(this);
        this.mode = 'work';
        this.idleTicks = 0;
        this.route = null;
      }
      return null;
    }

    // Working: keep the claimed stone while it's there, else find another.
    if (this.claim && world.getBlock(this.claim.block.x, this.claim.block.y, this.claim.block.z) !== BLOCK.STONE) this.releaseClaim();
    if (!this.claim) {
      const work = this.findWork(world);
      if (work) {
        this.claim = work;
        this.controller.claims.add(work.key);
      }
    }
    if (!this.claim) {
      this.walkTo(world, this.waitSpot(), settings.speed);
      if (this.carried() > 0 && ++this.idleTicks >= ticks(settings.idleDeposit)) {
        this.mode = 'deposit';
        this.route = null;
      }
      return null;
    }
    this.idleTicks = 0;
    const { block, stand } = this.claim;
    const eye = this.eye();
    const reach = Math.hypot(block.x + 0.5 - eye.x, block.y + 0.5 - eye.y, block.z + 0.5 - eye.z);
    const there = Math.hypot(stand.x - s.x, stand.z - s.z) < 0.5;
    if (!there && reach > settings.reach) {
      this.mineTicks = 0;
      this.walkTo(world, stand, settings.speed);
      return null;
    }
    if (!there) this.walkTo(world, stand, settings.speed);
    else this.move(world, null, settings.speed);
    s.yaw = yawToward(block.x + 0.5 - s.x, block.z + 0.5 - s.z);
    this.mining = true;
    if (++this.mineTicks >= breakTicks(BLOCK.STONE, settings.mineSpeed)) {
      world.setBlock(block.x, block.y, block.z, BLOCK.AIR);
      this.carrying.set(BLOCK.STONE, (this.carrying.get(BLOCK.STONE) ?? 0) + 1);
      this.releaseClaim();
      if (this.carried() >= settings.carryLimit) {
        this.mode = 'deposit';
        this.route = null;
      }
    }
    return null;
  }

  snapshot() {
    return { ...super.snapshot(), mining: this.mining, carrying: this.carried() };
  }

  extraKey() {
    return `${this.climbing},${this.mining},${this.carried()}`;
  }
}

