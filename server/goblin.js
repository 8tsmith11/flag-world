// Goblins: the Goblin Totem, the Goblin King, and the colony: Workers
// (dig, build, chop and repair),
// Soldiers and Archers (guard duty). They live in Game.mobs beside Crawlers
// and Void Eels and reuse the player physics with their own boxes and
// speeds. What they share (storage, projects, entrances) is kept by
// GoblinController (goblins.js), which each one holds as `controller`.
// Numbers are in shared/goblins.js.

import { TICK_RATE, WALK_SPEED } from '../shared/config.js';
import { BLOCK, isSolid, isWater, getBlockDef, isDoor } from '../shared/blocks.js';
import { GOBLINS } from '../shared/goblins.js';
import { moduleAt } from '../shared/goblinModules.js';
import { createPlayerState, stepPlayer, playerBoxOf, isInWater, isOnLadder } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, canSee, huntable } from './provocation.js';
import { planRoute, followRoute, repath, yawToward } from './goblinNav.js';
import { canStand } from './pathfind.js';
import { goblinBreakTicks, goblinPlaceTicks, yieldOf, isProtected, taskSatisfied } from './goblinProjects.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const boxOf = ({ width, height }) => ({ halfW: width / 2, height });

export const TOTEM_BOX = boxOf(GOBLINS.totem);
export const KING_BOX = boxOf(GOBLINS.king);
export const WORKER_BOX = boxOf(GOBLINS.worker);
export const SOLDIER_BOX = boxOf(GOBLINS.soldier);
export const ARCHER_BOX = boxOf(GOBLINS.archer);

// How long a goblin keeps trying to reach its work before giving it up.
const REACH_TIMEOUT = 20;
// Being stuck this long makes a laborer break what's in its way.
const OBSTACLE_AFTER = 40;
const UNSTICK_AFTER = 400;
// Seconds a laborer waits on site for its next task to come free.
const HOLD_TIME = 4;

// Common to walking goblins: physics, steering with separation, routes,
// and being stuck.
class Goblin {
  constructor(id, type, name, controller, x, y, z, box, hp) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.goblin = true;
    this.controller = controller;
    this.state = createPlayerState(x, y, z);
    this.state.box = box;
    this.state.edgeGuard = true;
    this.state.yaw = Math.random() * Math.PI * 2;
    this.hp = hp;
    this.maxHp = hp;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    // Set each tick by mob steering: a push away from crowding mobs.
    this.separation = { x: 0, z: 0 };
    this.stuckTicks = 0;
    this.climbing = false;
    this.walking = false;
    this.mining = false;
    this.route = null;
    this.routeKey = null;
    // Laborers break blocks in their way (see clearObstacle).
    this.breaksObstacles = false;
    this.obstacle = null;
  }

  eye() {
    const s = this.state;
    return { x: s.x, y: s.y + s.box.height * 0.85, z: s.z };
  }

  // One physics tick. `move`: { dx, dz } to walk that way (plus separation),
  // { yaw, forward } to climb, { hold: yaw } to hang on a ladder, or null
  // to stand (still nudged apart).
  move(world, move, speed) {
    const s = this.state;
    s.moveScale = speed / WALK_SPEED;
    let forward = 0;
    let jump = isInWater(s, world);
    const sep = this.separation ?? { x: 0, z: 0 };
    if (move && 'hold' in move) {
      s.yaw = move.hold;
      jump = false;
    } else if (move && 'forward' in move) {
      s.yaw = move.yaw;
      forward = move.forward;
    } else {
      let dx = move?.dx ?? 0, dz = move?.dz ?? 0;
      const length = Math.hypot(dx, dz);
      if (length > 1e-3) { dx /= length; dz /= length; }
      // Crowding bends a walker's heading (never more than sideways) but
      // never stops it; standing goblins just drift apart.
      let px = sep.x * GOBLINS.separation.strength, pz = sep.z * GOBLINS.separation.strength;
      const push = Math.hypot(px, pz);
      if (push > 0.9) { px *= 0.9 / push; pz *= 0.9 / push; }
      if (length > 1e-3) {
        const back = px * dx + pz * dz;
        if (back < 0) { px -= back * dx; pz -= back * dz; }
        s.yaw = yawToward(dx + px, dz + pz);
        forward = 1;
      } else if (push > 0.15) {
        s.yaw = yawToward(px, pz);
        forward = Math.min(0.6, push);
      }
    }
    const { x, z } = s;
    stepPlayer(s, { forward, strafe: 0, jump: jump || (this.stuckTicks > 3 && forward > 0), yaw: s.yaw, pitch: 0 }, world);
    const moved = Math.hypot(s.x - x, s.z - z);
    const onLadder = isOnLadder(s, world);
    const climbingNow = onLadder && move && ('forward' in move || 'hold' in move);
    this.stuckTicks = forward > 0 && !(onLadder && 'forward' in (move ?? {})) && moved < speed * forward / TICK_RATE * 0.2
      ? this.stuckTicks + 1 : 0;
    this.climbing = !!climbingNow;
    this.walking = moved > 0.01;
  }

  // Walks a route to `goal` (replanning when the goal moves); true once there.
  walkTo(world, goal, speed, options = {}) {
    const key = `${options.urgent ? 1 : 0},${options.climb ? `${options.climb.x},${options.climb.z}` : ''}`;
    const route = this.route;
    const moved = route && Math.hypot(route.goal.x - goal.x, route.goal.y - goal.y, route.goal.z - goal.z);
    if (!route || this.routeKey !== key || moved > (options.slack ?? 0.5)) {
      this.route = planRoute(this.controller, this, this.state, goal, options);
      this.routeKey = key;
      this.obstacle = null;
    }
    if (this.stuckTicks > 20 && this.stuckTicks % 20 === 1) repath(this.route);
    if (this.breaksObstacles && this.stuckTicks > OBSTACLE_AFTER && this.clearObstacle(world)) return false;
    const step = followRoute(this.route, this, world);
    if (step.arrived) {
      this.move(world, null, speed);
      this.progress = null;
      return true;
    }
    if (step.wait || 'hold' in step) this.progress = null;
    else if (this.watchProgress()) return false;
    this.move(world, step.wait ? null : step, speed);
    return false;
  }

  // Hopelessly stuck (walled in by a cave-in, say): after UNSTICK_AFTER
  // ticks of trying to move without getting anywhere, back to the totem.
  watchProgress() {
    const tick = this.controller.game.tick;
    const p = this.progress;
    if (!p || Math.hypot(this.state.x - p.x, this.state.y - p.y, this.state.z - p.z) > 1.5) {
      this.progress = { x: this.state.x, y: this.state.y, z: this.state.z, tick };
      return false;
    }
    if (tick - p.tick <= UNSTICK_AFTER || !this.controller.members.has(this) || this.obstacle) return false;
    const spot = this.idleSpot();
    this.controller.log('unstuck', { type: this.type, x: Math.round(this.state.x), y: Math.round(this.state.y),
      z: Math.round(this.state.z), job: this.job?.type ?? this.spot?.kind ?? null,
      action: this.route?.actions[this.route.index]?.type ?? null });
    Object.assign(this.state, { x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0 });
    this.progress = null;
    this.stuckTicks = 0;
    this.route = null;
    this.teleported = true;
    this.controller.stats.unstuck++;
    this.releaseWork?.();
    return true;
  }

  // Breaks the block in front of a stuck laborer (feet or head height):
  // anything but keep blocks and what the goblins built themselves, taking
  // as long as the block's hardness says. True while busy with it.
  clearObstacle(world) {
    const s = this.state;
    if (!this.obstacle) {
      const dirX = -Math.sin(s.yaw), dirZ = -Math.cos(s.yaw);
      const reach = s.box.halfW + 0.45;
      const x = Math.floor(s.x + dirX * reach), z = Math.floor(s.z + dirZ * reach);
      for (const y of [Math.floor(s.y + 0.05), Math.floor(s.y + 1.05)]) {
        const id = world.getBlock(x, y, z);
        if (!isSolid(id) || isProtected(id) || this.controller.intended.get(`${x},${y},${z}`)?.id === id) continue;
        this.obstacle = { x, y, z, id, ticks: 0 };
        break;
      }
      if (!this.obstacle) {
        this.stuckTicks = 0;
        return false;
      }
    }
    const o = this.obstacle;
    if (world.getBlock(o.x, o.y, o.z) !== o.id) {
      this.obstacle = null;
      this.stuckTicks = 0;
      return false;
    }
    this.mining = true;
    s.yaw = yawToward(o.x + 0.5 - s.x, o.z + 0.5 - s.z);
    this.move(world, null, 0.01);
    if (++o.ticks >= goblinBreakTicks(o.id)) {
      this.controller.breakObstacle(o.x, o.y, o.z);
      this.obstacle = null;
      this.stuckTicks = 0;
      if (this.route) repath(this.route);
    }
    return true;
  }

  describe() {
    return { ...this.snapshot(), maxHp: this.maxHp };
  }

  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, name: this.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
      walking: this.walking, climbing: this.climbing, mining: this.mining, hp: this.hp };
  }

  // Changes that STATE must carry even when it stands still.
  extraKey() {
    return `${this.climbing},${this.mining}`;
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

  // Where to wait with nothing to do: a spot by the totem.
  idleSpot() {
    const t = this.controller.totemSpot;
    const angle = this.id * 1.7;
    return { x: t.x + Math.cos(angle) * 3, y: t.y, z: t.z + Math.sin(angle) * 3 };
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
    this.fixed = true;
    this.controller = controller;
    this.state = createPlayerState(x, y, z);
    this.state.box = TOTEM_BOX;
    this.hp = GOBLINS.totem.hp;
    this.maxHp = GOBLINS.totem.hp;
    this.dead = false;
    this.connected = true;
    this.lastDamageTick = -Infinity;
    this.home = { x, y, z };
  }

  step(world, players, tick) {
    // Hits and crowding push the state around; the totem stays put.
    Object.assign(this.state, { ...this.home, kx: 0, kz: 0, vx: 0, vy: 0, vz: 0, slowTicks: 0 });
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
    return { id: this.id, type: this.type, name: this.name, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: Math.ceil(this.hp) };
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
  }

  inArena(p) {
    if (this.controller.king === this) {
      return this.controller.fortress.modules.some((m) => !m.building && !m.removed
        && m.floorY === this.controller.hall.floorY && p.x >= m.box.x0 + 1 && p.x <= m.box.x1
        && p.z >= m.box.z0 + 1 && p.z <= m.box.z1 && p.y >= m.floorY && p.y < m.box.y1);
    }
    const a = this.arena;
    return p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1 && p.y >= a.y0 && p.y <= a.y1;
  }

  chooseTarget(world, players, tick) {
    const provoked = this.provocation.current(world, this.eye(), tick);
    if (provoked && this.inArena(provoked.state)) return provoked;
    if (this.target && huntable(this.target) && this.inArena(this.target.state)) return this.target;
    let best = null;
    for (const player of players) {
      if (!huntable(player) || !this.inArena(player.state)) continue;
      const d = Math.hypot(player.state.x - this.state.x, player.state.z - this.state.z);
      if ((!best || d < best.d) && canSee(world, this.eye(), player)) best = { player, d };
    }
    return best?.player ?? null;
  }

  step(world, players, tick) {
    const s = this.state;
    this.target = this.chooseTarget(world, players, tick);
    if (this.controller.king === this) {
      const goal = this.target && this.inArena(this.target.state) ? this.target.state : this.home;
      this.walkTo(world, { x: goal.x, y: this.home.y, z: goal.z }, GOBLINS.king.speed,
        { urgent: !!this.target, slack: 0.7 });
      if (this.target && tick >= this.nextAttackTick && inReach(this, this.target, GOBLINS.king.reach)) {
        this.nextAttackTick = tick + ticks(GOBLINS.king.cooldown);
        return this.target;
      }
      return null;
    }
    const a = this.arena;
    const goal = this.target ? { x: this.target.state.x, z: this.target.state.z } : this.home;
    const gx = Math.max(a.x0, Math.min(a.x1, goal.x)), gz = Math.max(a.z0, Math.min(a.z1, goal.z));
    const far = Math.hypot(gx - s.x, gz - s.z) > (this.target ? 0.4 : 0.6);
    this.move(world, far ? { dx: gx - s.x, dz: gz - s.z } : null, GOBLINS.king.speed);
    // Never pushed out of its arena (knockback included).
    s.x = Math.max(a.x0, Math.min(a.x1, s.x));
    s.z = Math.max(a.z0, Math.min(a.z1, s.z));
    if (this.target && !far) s.yaw = yawToward(this.target.state.x - s.x, this.target.state.z - s.z);
    if (this.target && tick >= this.nextAttackTick && inReach(this, this.target, GOBLINS.king.reach)) {
      this.nextAttackTick = tick + ticks(GOBLINS.king.cooldown);
      return this.target;
    }
    return null;
  }
}

// Whether a player is within `reach` of a goblin's box (edge to edge).
function inReach(goblin, player, reach) {
  const s = goblin.state, p = player.state, box = playerBoxOf(p);
  const gapX = Math.abs(p.x - s.x) - box.halfW - s.box.halfW;
  const gapZ = Math.abs(p.z - s.z) - box.halfW - s.box.halfW;
  const gapY = Math.max(s.y - (p.y + box.height), p.y - (s.y + s.box.height));
  return Math.max(gapX, gapZ, gapY) <= reach;
}

// A spot to stand on to reach block `b` from (within `reach` of the eyes),
// nearest the goblin, or null.
function standSpot(world, goblin, b, reach) {
  const eyeUp = goblin.state.box.height * 0.85;
  const s = goblin.state;
  let best = null;
  for (let dy = -4; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const x = b.x + dx, y = b.y + dy, z = b.z + dz;
    if (dx === 0 && dz === 0 && dy >= -1) continue;
    if (!canStand(world, x, y, z, 2)) continue;
    const d = Math.hypot(b.x + 0.5 - (x + 0.5), b.y + 0.5 - (y + eyeUp), b.z + 0.5 - (z + 0.5));
    if (d > reach - 0.2) continue;
    const cost = Math.hypot(x + 0.5 - s.x, (y - s.y) * 1.5, z + 0.5 - s.z) + d * 0.5;
    if (!best || cost < best.cost) best = { x: x + 0.5, y, z: z + 0.5, cost };
  }
  return best;
}

// The highest ladder in an unbroken run up a shaft column from its floor.
function topLadder(world, climb) {
  let y = climb.floorY;
  while (y <= climb.topY && getBlockDef(world.getBlock(climb.x, y + 1, climb.z)).shape === 'ladder') y++;
  return getBlockDef(world.getBlock(climb.x, y, climb.z)).shape === 'ladder' ? y : climb.floorY;
}

// Workers flee when attacked, carry things between the totem and their work,
// and work through jobs. `stray` ones (hatched
// outside the fortress) potter about where they hatched instead.
class Laborer extends Goblin {
  constructor(id, type, name, controller, x, y, z, box, settings, { stray = false } = {}) {
    super(id, type, name, controller, x, y, z, box, settings.hp);
    this.settings = settings;
    this.stray = stray;
    this.home = { x, y, z };
    this.breaksObstacles = true;
    // material -> count
    this.carrying = new Map();
    this.job = null;
    this.fleeing = false;
    this.lastThreatTick = -Infinity;
    this.fleeGoal = null;
    this.nextFleePlan = 0;
    this.wanderGoal = null;
    // Set while it waits for a material the totem doesn't have.
    this.waitingFor = null;
    this.lastTaskTick = -Infinity;
    this.lastClimb = null;
  }

  carried() {
    let total = 0;
    for (const count of this.carrying.values()) total += count;
    return total;
  }

  carry(material, count = 1) {
    if (material) this.carrying.set(material, (this.carrying.get(material) ?? 0) + count);
  }

  // Drops its job (and anything claimed with it).
  releaseWork() {
    const job = this.job;
    if (job?.task) this.controller.releaseTask(job.task);
    if (job?.tree) this.controller.releaseTree(job.tree);
    this.job = null;
    this.route = null;
    this.waitingFor = null;
  }

  // The module farthest from every threatening player, as a place to run to.
  fleeTarget(players) {
    const fortress = this.controller.fortress;
    const threats = players.filter((p) => huntable(p)
      && Math.hypot(p.state.x - this.state.x, p.state.z - this.state.z) <= this.settings.safeRange);
    const away = (point) => Math.min(...threats.map((p) => Math.hypot(p.state.x - point.x, p.state.y - point.y, p.state.z - point.z)));
    const here = fortress && moduleAt(fortress, this.state.x, this.state.y + 0.1, this.state.z);
    if (!here || !threats.length) {
      // Outside the fortress: straight away from the nearest player.
      const t = threats[0]?.state ?? this.state;
      const dx = this.state.x - t.x, dz = this.state.z - t.z, length = Math.hypot(dx, dz) || 1;
      return { x: this.state.x + dx / length * 6, y: this.state.y, z: this.state.z + dz / length * 6 };
    }
    let best = null;
    for (const module of fortress.modules) {
      if (module.building || module.removed) continue;
      const spot = module.feature?.kind === 'totem'
        ? { x: module.box.x0 + 2.5, y: module.floorY, z: module.box.z0 + 2.5 }
          : module.center;
      const score = away(spot);
      if (!best || score > best.score) best = { spot, score };
    }
    return best.spot;
  }

  // Fleeing from players within fleeRange; back to work once none has been
  // within safeRange for safeTime. True while fleeing.
  flee(world, players, tick) {
    const settings = this.settings;
    if (!this.fleeing) return false;
    if (this.attackedBy && huntable(this.attackedBy)
      && Math.hypot(this.attackedBy.state.x - this.state.x, this.attackedBy.state.z - this.state.z) < settings.safeRange) {
      this.lastThreatTick = tick;
    }
    if (tick - this.lastThreatTick >= ticks(settings.safeTime)) {
      this.fleeing = false;
      this.route = null;
      return false;
    }
    if (tick >= this.nextFleePlan) {
      this.fleeGoal = this.fleeTarget(players);
      this.nextFleePlan = tick + ticks(1);
    }
    this.walkTo(world, this.fleeGoal, settings.fleeSpeed, { urgent: true, slack: 2 });
    return true;
  }

  // Strays stroll around home.
  wander(world) {
    const speed = this.settings.speed * 0.5;
    if (!this.wanderGoal || this.walkTo(world, this.wanderGoal, speed)) {
      if (!this.wanderGoal || Math.random() < 0.02) {
        const angle = Math.random() * Math.PI * 2, distance = Math.random() * 4;
        this.wanderGoal = { x: this.home.x + Math.cos(angle) * distance, y: this.home.y, z: this.home.z + Math.sin(angle) * distance };
        this.route = null;
      }
    }
  }

  // Goes to the totem and leaves what it carries. True once done.
  depositTrip(world) {
    const totem = this.controller.totemSpot;
    const goal = { x: totem.x + (this.id % 2 ? 2 : -2), y: totem.y, z: totem.z + ((this.id >> 1) % 2 ? 2 : -2) };
    const arrived = this.walkTo(world, goal, this.settings.speed);
    const s = this.state;
    if (arrived || (Math.hypot(totem.x - s.x, totem.z - s.z) <= GOBLINS.totem.depositRange && Math.abs(totem.y - s.y) < 1.5)) {
      this.controller.deposit(this);
      return true;
    }
    return false;
  }

  // Walks to reach block `b` (a task, a log...), standing where it can reach
  // it; true once it can work on it. Shaft work is done from the column's
  // ladders. Gives up after REACH_TIMEOUT (returns 'fail').
  approach(world, b, reach, tick) {
    const job = this.job;
    job.since = job.since ?? tick;
    job.misses = job.misses ?? 0;
    const eye = this.eye();
    const distance = Math.hypot(b.x + 0.5 - eye.x, b.y + 0.5 - eye.y, b.z + 0.5 - eye.z);
    if (b.climb) {
      const top = topLadder(world, b.climb);
      const y = Math.max(b.climb.floorY, Math.min(top, b.y - 2));
      const onColumn = Math.abs(this.state.x - b.climb.x - 0.5) < 0.6 && Math.abs(this.state.z - b.climb.z - 0.5) < 0.6;
      if (onColumn && Math.abs(this.state.y - y) < 0.6 && distance <= reach) {
        this.lastClimb = yawToward(...wallDir(b.climb.wall));
        this.move(world, { hold: this.lastClimb }, this.settings.speed);
        return true;
      }
      this.walkTo(world, { x: b.climb.x + 0.5, y, z: b.climb.z + 0.5 }, this.settings.speed, { climb: b.climb, urgent: true, slack: 0.3 });
    } else {
      const footing = this.state.onGround || isInWater(this.state, world);
      if (distance <= reach && footing && (!job.stand || Math.hypot(job.stand.x - this.state.x, job.stand.z - this.state.z) < 0.6)) {
        this.move(world, null, this.settings.speed);
        return true;
      }
      if (!job.stand || tick >= (job.restand ?? 0)) {
        job.stand = standSpot(world, this, b, reach);
        job.restand = tick + ticks(4);
        if (!job.stand) return tick - job.since > ticks(3) ? 'fail' : false;
      }
      // There, but still out of reach: that spot won't do.
      if (this.walkTo(world, job.stand, this.settings.speed, { slack: 0.3 }) && distance > reach) {
        job.stand = null;
        if (++job.misses >= 3) return 'fail';
      }
    }
    return tick - job.since > ticks(REACH_TIMEOUT) ? 'fail' : false;
  }

  // Swinging at block b for `need` ticks; true when done.
  workOn(b, need) {
    const s = this.state;
    s.yaw = yawToward(b.x + 0.5 - s.x, b.z + 0.5 - s.z);
    this.mining = true;
    this.job.work = (this.job.work ?? 0) + 1;
    return this.job.work >= need;
  }

  step(world, players, tick) {
    this.mining = false;
    if (this.flee(world, players, tick)) return null;
    if (this.stray || !this.controller.totemSpot) {
      this.wander(world);
      return null;
    }
    if (!this.job) this.job = this.chooseJob(world, tick);
    if (this.job?.type === 'hold') this.hold(world, tick);
    else if (this.job) this.doJob(world, tick);
    return null;
  }

  // Just finished a task and more of its kind are waiting on others (the
  // next ladder, the next dig): stay put (on the ladder, if on one).
  stayOnSite(tick) {
    return tick - this.lastTaskTick < ticks(1) && this.controller.pendingCount(this.type === ENTITY_TYPE.GOBLIN_WORKER ? 'dig' : 'place') > 0;
  }

  // Shaft work comes a block at a time: wait longer on the ladder.
  holdTime() {
    return this.lastTask?.climb ? HOLD_TIME * 5 : HOLD_TIME;
  }

  hold(world, tick) {
    const job = this.job;
    if (isOnLadder(this.state, world) && this.lastClimb) this.move(world, { hold: this.lastClimb }, this.settings.speed);
    else this.move(world, null, this.settings.speed);
    if (tick % 5 === 0) {
      const task = this.controller.claimTask(this, job.kind, (t) => job.kind === 'dig' || this.has(t.material));
      if (task) {
        this.job = { type: job.kind, task };
        return;
      }
    }
    if (tick >= job.until) this.job = null;
  }

  snapshot() {
    return { ...super.snapshot(), carrying: this.carried() };
  }

  extraKey() {
    return `${this.climbing},${this.mining},${this.carried()}`;
  }
}

const wallDir = (wall) => ({ N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] })[wall];

// Goblin Workers dig for projects, chop wood when the totem is short of it
// (tending the tree plots).
export class GoblinWorker extends Laborer {
  constructor(id, controller, x, y, z, options) {
    super(id, ENTITY_TYPE.GOBLIN_WORKER, 'Goblin Worker', controller, x, y, z, WORKER_BOX, GOBLINS.worker, options);
  }

  has(material) {
    return !material || (this.carrying.get(material) ?? 0) > 0;
  }

  chooseJob(world, tick) {
    const c = this.controller;
    const placement = c.claimTask(this, 'place', (t) => this.has(t.material));
    if (placement) return { type: 'place', task: placement };
    if (this.carried() >= this.settings.carryLimit) return { type: 'deposit' };
    const task = c.claimTask(this, 'dig');
    if (task) return { type: 'dig', task };
    if (c.pendingCount('place')) return BUILD_WORK.chooseJob.call(this, world, tick);
    if (this.stayOnSite(tick)) return { type: 'hold', kind: 'dig', until: tick + ticks(this.holdTime()) };
    if (c.surfaceOpen() && c.storage.saplings > 0) {
      const spot = c.emptyPlotSpots()[0];
      if (spot) {
        c.claimTree(spot);
        return { type: 'plant', tree: spot };
      }
    }
    if (c.surfaceOpen() && c.woodWanted()) {
      const tree = c.woodSources()[0];
      if (tree) {
        c.claimTree(tree);
        return { type: 'chop', tree };
      }
    }
    if (this.carried() > 0) return { type: 'deposit' };
    return { type: 'idle', until: tick + ticks(3) };
  }

  doJob(world, tick) {
    const job = this.job;
    if (job.type === 'place' || job.type === 'fetch') return BUILD_WORK.doJob.call(this, world, tick);
    const c = this.controller;
    const reach = this.settings.reach;
    switch (job.type) {
      case 'deposit':
        if (this.depositTrip(world)) this.job = null;
        return;
      case 'idle':
        if (this.carried() > 0 && tick >= job.until + ticks(GOBLINS.worker.idleDeposit)) this.job = { type: 'deposit' };
        else this.walkTo(world, c.project?.site && !c.project.surface ? c.project.site : this.idleSpot(), this.settings.speed * 0.6);
        if (tick >= job.until && this.job === job) this.job = null;
        return;
      case 'dig': {
        const task = job.task;
        if (task.done || taskSatisfied(task, world)) {
          if (!task.done) c.finishTask(task, null);
          this.job = null;
          return;
        }
        const ready = this.approach(world, task, reach, tick);
        if (ready === 'fail') {
          c.failTask(task);
          this.job = null;
          return;
        }
        if (!ready) return;
        const id = world.getBlock(task.x, task.y, task.z);
        if (!this.workOn(task, goblinBreakTicks(id))) return;
        if (isDoor(id) || world.tileEntities.has(`${task.x},${task.y},${task.z}`)) c.breakObstacle(task.x, task.y, task.z);
        else {
          this.carry(yieldOf(id));
          c.setBlock(task.x, task.y, task.z, BLOCK.AIR);
        }
        c.stats.dug++;
        c.finishTask(task, this);
        this.lastTaskTick = tick;
        this.lastTask = task;
        this.job = null;
        return;
      }
      case 'chop':
      case 'plant': {
        const tree = job.tree;
        // Logs from the bottom up; a plot tree is replanted at once.
        let log = null;
        if (job.type === 'chop') {
          for (let y = tree.y; y < tree.y + 12; y++) {
            if (world.getBlock(tree.x, y, tree.z) === BLOCK.WOOD) { log = { x: tree.x, y, z: tree.z }; break; }
            if (y > tree.y && world.getBlock(tree.x, y, tree.z) !== BLOCK.AIR) break;
          }
          if (!log) {
            c.treeFelled(tree);
            if (tree.plot) {
              c.store('saplings', 1);
              this.job = { type: 'plant', tree };
              c.claimTree(tree);
            } else this.job = null;
            return;
          }
        }
        const target = log ?? tree;
        // Trunks are tall: reach further up them.
        const ready = this.approach(world, { x: target.x, y: Math.min(target.y, tree.y + 1), z: target.z }, reach + 1, tick);
        if (ready === 'fail') {
          c.releaseTree(tree);
          if (job.type === 'chop' && !tree.plot) c.treeFelled(tree);
          this.job = null;
          return;
        }
        if (!ready) return;
        if (job.type === 'plant') {
          if (!this.workOn(tree, goblinPlaceTicks())) return;
          const soil = world.getBlock(tree.x, tree.y - 1, tree.z);
          if (world.getBlock(tree.x, tree.y, tree.z) === BLOCK.AIR && (soil === BLOCK.GRASS || soil === BLOCK.DIRT)
            && c.take('saplings', 1)) c.setBlock(tree.x, tree.y, tree.z, BLOCK.SAPLING);
          c.releaseTree(tree);
          this.job = null;
          return;
        }
        if (!this.workOn(log, goblinBreakTicks(BLOCK.WOOD))) return;
        c.setBlock(log.x, log.y, log.z, BLOCK.AIR);
        this.carry('wood');
        job.work = 0;
        return;
      }
      default:
        this.job = null;
    }
  }

}

// Placement actions shared by every Worker.
const BUILD_WORK = {
  chooseJob(world, tick) {
    const c = this.controller;
    this.waitingFor = null;
    const task = c.claimTask(this, 'place', (t) => this.has(t.material));
    if (task) return { type: 'place', task };
    if (this.carried() > 0 && this.stayOnSite(tick)) return { type: 'hold', kind: 'place', until: tick + ticks(this.holdTime()) };
    // Something to place (now or soon) needs a material it hasn't got: fetch some.
    const wanted = c.claimTask(this, 'place', () => true);
    if (wanted) {
      c.releaseTask(wanted);
      return { type: 'fetch', material: wanted.material };
    }
    if (this.carried() > 0) return { type: 'deposit' };
    return { type: 'idle', until: tick + ticks(3) };
  },

  doJob(world, tick) {
    const job = this.job;
    const c = this.controller;
    switch (job.type) {
      case 'deposit':
        if (this.depositTrip(world)) this.job = null;
        return;
      case 'idle':
        this.walkTo(world, c.project?.site && !c.project.surface ? c.project.site : this.idleSpot(), this.settings.speed * 0.6);
        if (tick >= job.until) this.job = null;
        return;
      case 'fetch': {
        if (job.waitUntil && tick < job.waitUntil) {
          this.move(world, null, this.settings.speed);
          return;
        }
        if (!this.depositTrip(world)) return;
        // Enough for the pending placements needing it, up to a load.
        let need = 0;
        for (const project of c.activeProjects()) for (const t of project.tasks) if (!t.done && t.material === job.material) need++;
        const got = c.take(job.material, Math.min(need, this.settings.carryLimit));
        if (got > 0) {
          this.carry(job.material, got);
          this.waitingFor = null;
          this.job = null;
        } else {
          // Nothing in storage: wait for the workers.
          this.waitingFor = job.material;
          job.waitUntil = tick + ticks(3);
          job.tries = (job.tries ?? 0) + 1;
          if (job.tries > 20) this.job = null;
        }
        return;
      }
      case 'place': {
        const task = job.task;
        if (task.done || taskSatisfied(task, world)) {
          if (!task.done) c.finishTask(task, null);
          this.job = null;
          return;
        }
        if (!this.has(task.material)) {
          c.releaseTask(task);
          this.job = null;
          return;
        }
        const ready = this.approach(world, task, this.settings.reach, tick);
        if (ready === 'fail') {
          c.failTask(task);
          this.job = null;
          return;
        }
        if (!ready) return;
        const current = world.getBlock(task.x, task.y, task.z);
        // Break what's there first (hardness decides how long), then place.
        const breaking = isSolid(current) || (current !== BLOCK.AIR && !isWater(current) && task.id !== BLOCK.AIR);
        const need = (breaking && !isProtected(current) ? goblinBreakTicks(current) : 0) + goblinPlaceTicks();
        if (!this.workOn(task, need)) return;
        if (isSolid(task.id) && c.game.playerIn(task.x, task.y, task.z)) {
          job.work = 0;
          c.failTask(task);
          this.job = null;
          return;
        }
        if (breaking) this.carry(yieldOf(current));
        c.setBlock(task.x, task.y, task.z, task.id);
        if (task.material) {
          const left = (this.carrying.get(task.material) ?? 1) - 1;
          if (left > 0) this.carrying.set(task.material, left);
          else this.carrying.delete(task.material);
        }
        c.stats.placed++;
        c.finishTask(task, this);
        this.lastTaskTick = tick;
        this.lastTask = task;
        this.job = null;
        return;
      }
      default:
        this.job = null;
    }
  }
};

// Soldiers and Archers: guard duty. They patrol between the fortress, the
// entrances and the dwellings, go for players within aggroRange (with line
// of sight) or who hurt them, and give up a chase chaseRange from their
// patrol spot (unless provoked).
class Guard extends Goblin {
  constructor(id, type, name, controller, x, y, z, box, settings, { stray = false } = {}) {
    super(id, type, name, controller, x, y, z, box, settings.hp);
    this.settings = settings;
    this.stray = stray;
    this.home = { x, y, z };
    this.spot = null;
    this.waitUntil = 0;
    this.target = null;
    this.nextAttackTick = 0;
    this.chaseGoal = null;
    this.nextChasePlan = 0;
  }

  releaseWork() {
    this.route = null;
    this.spot = null;
  }

  patrolSpot() {
    if (this.stray) {
      const angle = Math.random() * Math.PI * 2, d = Math.random() * 6;
      return { x: this.home.x + Math.cos(angle) * d, y: this.home.y, z: this.home.z + Math.sin(angle) * d };
    }
    if (this.controller.alerted && this.controller.lastIntruderPos) return { ...this.controller.lastIntruderPos, kind: 'alarm' };
    const spots = this.controller.patrolSpots();
    if (!spots.length) return this.idleSpot();
    const kinds = [...new Set(spots.map((s) => s.kind))];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const pool = spots.filter((s) => s.kind === kind);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { x: pick.x + (Math.random() - 0.5) * 2, y: pick.y, z: pick.z + (Math.random() - 0.5) * 2, kind };
  }

  anchor() {
    return this.spot ?? this.home;
  }

  chooseTarget(world, players, tick) {
    const provoked = this.provocation.current(world, this.eye(), tick);
    if (provoked) return provoked;
    if (this.controller.alerted && this.controller.intruders.length) {
      return this.controller.intruders.filter(huntable)
        .sort((a, b) => Math.hypot(a.state.x - this.state.x, a.state.z - this.state.z)
          - Math.hypot(b.state.x - this.state.x, b.state.z - this.state.z))[0] ?? null;
    }
    const anchor = this.anchor();
    const settings = this.settings;
    if (this.target && huntable(this.target)) {
      const t = this.target.state;
      if (Math.hypot(t.x - anchor.x, t.z - anchor.z) <= settings.chaseRange && canSee(world, this.eye(), this.target)) return this.target;
    }
    let best = null;
    for (const player of players) {
      if (!huntable(player)) continue;
      const p = player.state;
      const d = Math.hypot(p.x - this.state.x, p.y - this.state.y, p.z - this.state.z);
      if (d > settings.aggroRange || Math.hypot(p.x - anchor.x, p.z - anchor.z) > settings.chaseRange) continue;
      if ((!best || d < best.d) && canSee(world, this.eye(), player)) best = { player, d };
    }
    return best?.player ?? null;
  }

  patrol(world, tick) {
    if (!this.spot) {
      this.spot = this.patrolSpot();
      this.arrived = false;
    }
    if (!this.arrived) {
      // Close enough (the spot may be in a dip, or crowded).
      const s = this.state;
      const near = Math.hypot(this.spot.x - s.x, this.spot.z - s.z) < 1.5 && Math.abs(this.spot.y - s.y) < 3;
      if (near || this.walkTo(world, this.spot, this.settings.speed * 0.7)) {
        this.arrived = true;
        const [lo, hi] = this.settings.patrolWait;
        this.waitUntil = tick + ticks(lo + Math.random() * (hi - lo));
      }
      return;
    }
    this.move(world, null, this.settings.speed);
    if (tick >= this.waitUntil) this.spot = null;
  }

  // Walking toward the target (replanned every half second).
  chase(world, tick, urgentGoal) {
    if (!this.chaseGoal || tick >= this.nextChasePlan) {
      this.chaseGoal = urgentGoal;
      this.nextChasePlan = tick + ticks(0.5);
    }
    this.walkTo(world, this.chaseGoal, this.settings.speed, { urgent: true, slack: 1 });
  }

  step(world, players, tick) {
    this.mining = false;
    this.aiming = false;
    const ai = GOBLINS.optimization;
    const distant = !this.controller.alerted && !this.target && players.every((player) => !huntable(player)
      || Math.hypot(player.state.x - this.state.x, player.state.z - this.state.z) > ai.farPlayerRange);
    if (!distant || tick % ai.farAITicks === this.id % ai.farAITicks) {
      this.target = this.chooseTarget(world, players, tick);
    }
    if (!this.target) {
      this.patrol(world, tick);
      return null;
    }
    return this.fight(world, tick);
  }
}

export class GoblinSoldier extends Guard {
  constructor(id, controller, x, y, z, options) {
    super(id, ENTITY_TYPE.GOBLIN_SOLDIER, 'Goblin Soldier', controller, x, y, z, SOLDIER_BOX, GOBLINS.soldier, options);
    this.biteDamage = GOBLINS.soldier.damage;
    this.biteKnockback = GOBLINS.soldier.knockback;
  }

  fight(world, tick) {
    const s = this.state, t = this.target.state;
    const offset = this.approachOffset ?? { x: 0, z: 0 };
    const close = Math.hypot(t.x - s.x, t.z - s.z) < 2.2 && Math.abs(t.y - s.y) < 1.5;
    if (close) this.move(world, { dx: t.x - s.x, dz: t.z - s.z }, this.settings.speed);
    else this.chase(world, tick, { x: t.x + offset.x * 0.5, y: t.y, z: t.z + offset.z * 0.5 });
    if (close) s.yaw = yawToward(t.x - s.x, t.z - s.z);
    if (tick >= this.nextAttackTick && inReach(this, this.target, this.settings.reach)) {
      this.nextAttackTick = tick + ticks(this.settings.cooldown);
      return this.target;
    }
    return null;
  }
}

export class GoblinArcher extends Guard {
  constructor(id, controller, x, y, z, options) {
    super(id, ENTITY_TYPE.GOBLIN_ARCHER, 'Goblin Archer', controller, x, y, z, ARCHER_BOX, GOBLINS.archer, options);
    this.aiming = false;
    this.post = null;
  }

  // Archers keep a lookout post when there is one; otherwise they stand by
  // an entrance, or patrol.
  patrolSpot() {
    if (this.stray) return super.patrolSpot();
    if (this.controller.alerted) return super.patrolSpot();
    const post = this.controller.claimPost(this);
    if (post) {
      this.post = post;
      return { ...post, kind: 'post' };
    }
    const spots = this.controller.patrolSpots().filter((s) => s.kind === 'entrance');
    if (spots.length && Math.random() < 0.6) {
      const pick = spots[Math.floor(Math.random() * spots.length)];
      return { x: pick.x + (Math.random() - 0.5) * 3, y: pick.y, z: pick.z + (Math.random() - 0.5) * 3, kind: 'entrance' };
    }
    return super.patrolSpot();
  }

  patrol(world, tick) {
    // At a post: climb the lookout's ladder, then stay.
    if (this.spot?.kind === 'post') {
      const building = this.controller.buildings.find((b) => b.post === this.post);
      if (!building?.intact) {
        this.spot = null;
        return;
      }
      if (Math.hypot(this.state.x - this.post.x, this.state.z - this.post.z) < 0.6 && Math.abs(this.state.y - this.post.y) < 0.6) {
        this.move(world, null, this.settings.speed);
        return;
      }
      if (!this.route?.post) {
        const ladder = building.ladder;
        this.route = planRoute(this.controller, this, this.state, { x: ladder.x + 0.5, y: ladder.floorY, z: ladder.z + 0.5 });
        this.route.actions.push({ type: 'climbUp', x: ladder.x + 0.5, z: ladder.z + 0.5, y: ladder.topY + 1, wall: ladder.wall },
          { type: 'walk', ...this.post });
        this.route.post = true;
        this.routeKey = 'post';
      }
      const step = followRoute(this.route, this, world);
      this.move(world, step.arrived || step.wait ? null : step, this.settings.speed * 0.7);
      if (this.stuckTicks > 100) this.route = null;
      return;
    }
    super.patrol(world, tick);
  }

  fight(world, tick) {
    const s = this.state, t = this.target.state;
    const settings = this.settings;
    const d = Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z);
    const sees = canSee(world, this.eye(), this.target);
    const onPost = this.spot?.kind === 'post' && Math.abs(s.y - (this.post?.y ?? -99)) < 0.6;
    if (d < settings.keepAway && !onPost) {
      // Back away.
      this.route = null;
      this.move(world, { dx: s.x - t.x, dz: s.z - t.z }, settings.speed);
    } else if ((d > settings.range * 0.85 || !sees) && !onPost) {
      this.chase(world, tick, { x: t.x, y: t.y, z: t.z });
    } else if (onPost) {
      const building = this.controller.buildings.find((b) => b.post === this.post);
      if (building) {
        const cx = (building.box.x0 + building.box.x1 + 1) / 2;
        const cz = (building.box.z0 + building.box.z1 + 1) / 2;
        const dx = t.x - cx, dz = t.z - cz;
        const edge = Math.abs(dx) > Math.abs(dz)
          ? { x: cx + Math.sign(dx) * 1.5, y: this.post.y, z: cz }
          : { x: cx, y: this.post.y, z: cz + Math.sign(dz) * 1.5 };
        this.walkTo(world, edge, settings.speed * 0.7, { slack: 0.4 });
      } else this.move(world, null, settings.speed);
    } else {
      this.move(world, null, settings.speed);
    }
    s.yaw = yawToward(t.x - s.x, t.z - s.z);
    if (sees && d <= settings.range) {
      this.aiming = true;
      if (tick >= this.nextAttackTick) {
        this.nextAttackTick = tick + ticks(settings.cooldown);
        this.controller.game.goblinShoot(this, this.target);
      }
    }
    return null;
  }

  snapshot() {
    return { ...super.snapshot(), aiming: this.aiming };
  }

  extraKey() {
    return `${this.climbing},${this.aiming}`;
  }
}
