// Server-owned dragon. It flies, occasionally lands to wander, pursues nearby
// players, and breathes a short cone of fire with clear sight.
//
// Every dragon is leashed to a home island (a team island, the central island
// or a roost): it roams within leashRadius of the island's middle and only
// goes after players inside that radius. Provoked (see provocation.js), it
// hunts its attacker anywhere until it loses them, then flies home.
import {
  TICK_RATE, TICK_DT, DRAGON_HP, DRAGON_SPEED, DRAGON_SIGHT,
  DRAGON_FIRE_RANGE, DRAGON_FIRE_DURATION, DRAGON_FIRE_COOLDOWN, DRAGON_FIRE_INTERVAL,
} from '../shared/config.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { playerBoxOf } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { raycastBlock } from '../shared/raycast.js';
import { Provocation, huntable } from './provocation.js';

export const DRAGON_BOX = { halfW: 1.1, height: 2.8 };
const FIRE_TICKS = Math.round(DRAGON_FIRE_DURATION * TICK_RATE);
const FIRE_INTERVAL_TICKS = Math.round(DRAGON_FIRE_INTERVAL * TICK_RATE);
const FIRE_COOLDOWN_TICKS = Math.round(DRAGON_FIRE_COOLDOWN * TICK_RATE);
const TURN_PER_TICK = 0.085;
const CLIMB_SPEED = 4;
const WALK_SPEED = 1.7;
const WALK_HEIGHT = 0.4;

function turnToward(current, wanted) {
  let difference = (wanted - current + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  difference -= Math.PI;
  return current + Math.max(-TURN_PER_TICK, Math.min(TURN_PER_TICK, difference));
}

export class Dragon {
  // homeIsland: { x, z, radius }; leash: how far past its radius it may roam.
  constructor(id, x, y, z, homeIsland, leash) {
    this.id = id;
    this.type = ENTITY_TYPE.DRAGON;
    this.name = 'Dragon';
    this.home = { x, y, z };
    this.homeIsland = homeIsland;
    this.leashRadius = homeIsland.radius + leash;
    this.provocation = new Provocation();
    this.state = { x, y, z, yaw: Math.random() * Math.PI * 2, pitch: 0, box: DRAGON_BOX };
    this.hp = DRAGON_HP;
    this.dead = false;
    this.connected = true;
    this.breathTicks = 0;
    this.nextBreathTick = Math.floor(Math.random() * TICK_RATE * 2);
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.walking = false;
    this.landing = false;
    this.nextLandTick = 10 * TICK_RATE + Math.floor(Math.random() * 10 * TICK_RATE);
    this.walkUntil = 0;
    this.walkGoal = null;
  }

  get breathing() {
    return this.breathTicks > 0;
  }

  groundAt(world, x, z) {
    if (x < 3 || z < 3 || x >= world.sizeX - 3 || z >= world.sizeZ - 3) return -1;
    const ground = world.getSurfaceY(Math.floor(x), Math.floor(z), isSolid);
    if (ground < 0 || world.getBlock(Math.floor(x), ground, Math.floor(z)) !== BLOCK.GRASS) return -1;
    for (let y = ground + 1; y <= ground + 3; y++) {
      if (isSolid(world.getBlock(Math.floor(x), y, Math.floor(z)))) return -1;
    }
    return ground;
  }

  chooseWalkGoal() {
    const angle = Math.random() * Math.PI * 2;
    const distance = 3 + Math.random() * 8;
    const x = this.state.x + Math.cos(angle) * distance;
    const z = this.state.z + Math.sin(angle) * distance;
    if (Math.hypot(x - this.homeIsland.x, z - this.homeIsland.z) > this.leashRadius) {
      this.walkGoal = { x: this.home.x, z: this.home.z };
    } else this.walkGoal = { x, z };
  }

  // The provoking player, else the nearest player within sight who is inside
  // its leash.
  chooseTarget(world, players, tick) {
    const s = this.state;
    const provoked = this.provocation.current(world, { x: s.x, y: s.y + 1.7, z: s.z }, tick);
    if (provoked) return provoked;
    const island = this.homeIsland;
    return players.filter((p) => huntable(p)
      && Math.hypot(p.state.x - island.x, p.state.z - island.z) <= this.leashRadius)
      .map((p) => ({ player: p, distance: Math.hypot(p.state.x - s.x, p.state.y - s.y, p.state.z - s.z) }))
      .filter(({ distance }) => distance < DRAGON_SIGHT)
      .sort((a, b) => a.distance - b.distance)[0]?.player ?? null;
  }

  // Returns players hit by this tick's fire pulse. The game applies damage.
  step(world, players, tick) {
    const s = this.state;
    const target = this.chooseTarget(world, players, tick);
    this.target = target;
    const returning = !target && Math.hypot(s.x - this.home.x, s.z - this.home.z) > 20;
    if (returning) {
      this.walking = false;
      this.landing = false;
    }
    if (target && (this.walking || this.landing)) {
      this.walking = false;
      this.landing = false;
      this.nextLandTick = tick + 12 * TICK_RATE;
    }
    if (!target && !returning && !this.walking && !this.landing && tick >= this.nextLandTick) {
      if (this.groundAt(world, s.x, s.z) >= 0) this.landing = true;
      else this.nextLandTick = tick + 3 * TICK_RATE;
    }
    if (this.walking && tick >= this.walkUntil) {
      this.walking = false;
      this.nextLandTick = tick + (8 + Math.floor(Math.random() * 8)) * TICK_RATE;
    }
    if (this.walking) {
      const ground = this.groundAt(world, s.x, s.z);
      if (ground < 0) {
        this.walking = false;
        this.nextLandTick = tick + 12 * TICK_RATE;
      } else {
        if (!this.walkGoal || Math.hypot(this.walkGoal.x - s.x, this.walkGoal.z - s.z) < 1.5) this.chooseWalkGoal();
        const dx = this.walkGoal.x - s.x, dz = this.walkGoal.z - s.z;
        s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz));
        const nx = s.x - Math.sin(s.yaw) * WALK_SPEED * TICK_DT;
        const nz = s.z - Math.cos(s.yaw) * WALK_SPEED * TICK_DT;
        const nextGround = this.groundAt(world, nx, nz);
        if (nextGround >= 0 && Math.abs(nextGround - ground) <= 1
          && Math.hypot(nx - this.homeIsland.x, nz - this.homeIsland.z) <= this.leashRadius) {
          s.x = nx;
          s.z = nz;
          s.y = nextGround + WALK_HEIGHT;
        } else this.chooseWalkGoal();
        s.pitch = 0;
        return [];
      }
    }
    if (this.landing) {
      const ground = this.groundAt(world, s.x, s.z);
      if (ground < 0) {
        this.landing = false;
        this.nextLandTick = tick + 3 * TICK_RATE;
      } else {
        s.pitch = 0;
        s.y = Math.max(ground + WALK_HEIGHT, s.y - CLIMB_SPEED * TICK_DT);
        if (s.y <= ground + WALK_HEIGHT + 0.01) {
          this.landing = false;
          this.walking = true;
          this.walkUntil = tick + (5 + Math.floor(Math.random() * 5)) * TICK_RATE;
          this.chooseWalkGoal();
        }
        return [];
      }
    }
    const patrolAngle = tick * 0.007 + this.id * 1.7;
    const patrolRadius = 16 + 5 * Math.sin(tick * 0.003 + this.id);
    const goal = target
      ? { x: target.state.x + (this.approachOffset?.x ?? 0),
        y: target.state.y + 3.2, z: target.state.z + (this.approachOffset?.z ?? 0) }
      : returning ? this.home
      : { x: this.home.x + Math.cos(patrolAngle) * patrolRadius,
        y: this.home.y + 3 * Math.sin(tick * 0.009 + this.id),
        z: this.home.z + Math.sin(patrolAngle) * patrolRadius };
    goal.x += this.separation?.x ?? 0;
    goal.y += this.separation?.y ?? 0;
    goal.z += this.separation?.z ?? 0;
    const dx = goal.x - s.x, dz = goal.z - s.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance > 0.1) s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz));
    s.pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(goal.y - s.y - 1.8, Math.max(1, horizontalDistance))));
    const speed = target && horizontalDistance < 6 ? DRAGON_SPEED * 0.2 : DRAGON_SPEED;
    const nx = s.x - Math.sin(s.yaw) * speed * TICK_DT;
    const nz = s.z - Math.cos(s.yaw) * speed * TICK_DT;
    const islandDistance = Math.hypot(nx - this.homeIsland.x, nz - this.homeIsland.z);
    if (nx > 3 && nz > 3 && nx < world.sizeX - 3 && nz < world.sizeZ - 3
      && (target || islandDistance <= this.leashRadius
        || islandDistance < Math.hypot(s.x - this.homeIsland.x, s.z - this.homeIsland.z))) {
      s.x = nx;
      s.z = nz;
    }
    const ground = world.getSurfaceY(Math.floor(s.x), Math.floor(s.z), isSolid);
    const minimum = ground < 0 ? 10 : ground + 3.5;
    const wantedY = Math.max(minimum, Math.min(world.sizeY - DRAGON_BOX.height - 1, goal.y));
    s.y += Math.max(-CLIMB_SPEED * TICK_DT, Math.min(CLIMB_SPEED * TICK_DT, wantedY - s.y));

    if (target) this.aimAt(target);
    if (this.breathTicks > 0) {
      this.breathTicks--;
      if (this.breathTicks % FIRE_INTERVAL_TICKS === 0) return this.fireTargets(world, players);
      return [];
    }
    if (target && tick >= this.nextBreathTick && this.canHit(world, target)) {
      this.breathTicks = FIRE_TICKS;
      this.nextBreathTick = tick + FIRE_TICKS + FIRE_COOLDOWN_TICKS;
      return this.fireTargets(world, players);
    }
    return [];
  }

  canHit(world, player) {
    const s = this.state, p = player.state;
    const from = { x: s.x - Math.sin(s.yaw) * 1.85, y: s.y + 1.7,
      z: s.z - Math.cos(s.yaw) * 1.85 };
    const dx = p.x - from.x, dy = p.y + playerBoxOf(p).height / 2 - from.y, dz = p.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > DRAGON_FIRE_RANGE || distance < 0.01) return false;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 0.01 || (-Math.sin(s.yaw) * dx - Math.cos(s.yaw) * dz) / horizontal < Math.cos(0.48)) return false;
    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
    const wall = raycastBlock(world, from, direction, distance, isSolid);
    return !wall || wall.t >= distance - 0.4;
  }

  fireTargets(world, players) {
    return players.filter((player) => huntable(player) && this.canHit(world, player));
  }

  aimAt(player) {
    const s = this.state, p = player.state;
    const dx = p.x - (s.x - Math.sin(s.yaw) * 1.85);
    const dz = p.z - (s.z - Math.cos(s.yaw) * 1.85);
    const dy = p.y + playerBoxOf(p).height / 2 - (s.y + 1.7);
    const wantedYaw = Math.atan2(-dx, -dz);
    let relativeYaw = (wantedYaw - s.yaw + Math.PI) % (Math.PI * 2);
    if (relativeYaw < 0) relativeYaw += Math.PI * 2;
    this.aimYaw = relativeYaw - Math.PI;
    this.aimPitch = Math.atan2(dy, Math.max(0.1, Math.hypot(dx, dz)));
  }

  describe() { return this.snapshot(); }

  snapshot() {
    const { x, y, z, yaw, pitch } = this.state;
    return { id: this.id, type: this.type, name: this.name, x, y, z, yaw, pitch,
      hp: this.hp, breathing: this.breathing, walking: this.walking,
      aimYaw: this.aimYaw, aimPitch: this.aimPitch };
  }
}
