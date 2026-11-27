import { MOB_NAVIGATION as NAV } from '../shared/config.js';
// Server-owned dragon. It flies, occasionally lands to wander, pursues nearby
// players, and breathes a short cone of fire with clear sight. It also has
// physical attacks (DRAGON_SWOOP, DRAGON_MELEE), which dragonscale's fire
// immunity doesn't stop: a telegraphed swoop that dives through its target
// with heavy knockback (its choice against a fire-immune target), and, on
// the ground, a bite in front and a tail whip behind. Hits from those go out
// in `this.hits` ({ player, damage, knockback }); Game applies them as melee.
//
// Every dragon is leashed to a home island (a team island, the central island
// or a roost): it roams within leashRadius of the island's middle and only
// goes after players inside that radius. Provoked (see provocation.js), it
// hunts its attacker anywhere until it loses them, then flies home.
import {
  TICK_RATE, TICK_DT, DRAGON_HP, DRAGON_SPEED, DRAGON_SIGHT,
  DRAGON_FIRE_RANGE, DRAGON_FIRE_DURATION, DRAGON_FIRE_COOLDOWN, DRAGON_FIRE_INTERVAL, DRAGON_SWOOP, DRAGON_MELEE,
} from '../shared/config.js';
const ticks = (seconds) => Math.max(1, Math.round(seconds * TICK_RATE));
import { BLOCK, isSolid } from '../shared/blocks.js';
import { playerBoxOf } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { raycastBlock } from '../shared/raycast.js';
import { Provocation, huntable } from './provocation.js';
import { dragonSurface } from './dragonSurface.js';

export const DRAGON_BOX = { halfW: 1.1, height: 2.8 };
const FIRE_TICKS = Math.round(DRAGON_FIRE_DURATION * TICK_RATE);
const FIRE_INTERVAL_TICKS = Math.round(DRAGON_FIRE_INTERVAL * TICK_RATE);
const FIRE_COOLDOWN_TICKS = Math.round(DRAGON_FIRE_COOLDOWN * TICK_RATE);
const TURN_PER_TICK = 0.085;
const CLIMB_SPEED = 4;
const WALK_SPEED = 1.7;
const WALK_HEIGHT = 0.4;
const STANDOFF = 5;

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
    // Physical attacks: a swoop in progress ({ phase: 'windup'|'dive', ... }),
    // a fight on the ground ({ until }), a bite or tail whip winding up
    // ({ kind, at }), and the hits this tick.
    this.swoop = null;
    this.grounded = null;
    this.melee = null;
    this.nextSwoopTick = 0;
    this.nextMeleeTick = 0;
    this.nextEngageTick = 0;
    this.hits = [];
  }

  // Where a player is relative to the dragon: horizontal distance, and
  // whether they are in front (dot of its facing with the direction to them).
  relative(player) {
    const s = this.state, p = player.state, dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz) || 1e-6;
    return { distance: d, front: (-Math.sin(s.yaw) * dx - Math.cos(s.yaw) * dz) / d, dy: p.y - s.y };
  }

  // On the ground fighting: face the target, bite or tail whip, then take off.
  stepGrounded(world, players, target, tick) {
    const s = this.state, g = DRAGON_MELEE;
    const ground = this.groundAt(world, s.x, s.z);
    const rel = target ? this.relative(target) : null;
    if (!target || ground < 0 || tick >= this.grounded.until || rel.distance > g.engage + 3 || Math.abs(rel.dy) > 3) {
      this.grounded = null; this.melee = null; this.walking = false;
      this.nextLandTick = tick + 12 * TICK_RATE;
      this.nextEngageTick = tick + ticks(g.groundSeconds * 1.5);
      return false;
    }
    s.y = ground + WALK_HEIGHT; s.pitch = 0;
    this.walking = true;
    if (this.melee) {
      if (tick >= this.melee.at) {
        // Strike: whoever is still in reach on that side.
        const bite = this.melee.kind === 'bite';
        for (const p of players) {
          if (!huntable(p)) continue;
          const r = this.relative(p);
          if (Math.abs(r.dy) > 2.5) continue;
          if (bite ? r.distance <= g.biteReach && r.front > 0.35 : r.distance <= g.tailReach && r.front < -0.2)
            this.hits.push({ player: p, damage: bite ? g.biteDamage : g.tailDamage, knockback: bite ? g.biteKnockback : g.tailKnockback });
        }
        this.melee = null;
        this.nextMeleeTick = tick + ticks(g.cooldown);
      }
      return true;
    }
    // Close and behind: whip the tail. Close in front: bite. Otherwise turn
    // to face them (walking toward them if they back off).
    if (tick >= this.nextMeleeTick && rel.distance <= g.tailReach && rel.front < -0.2) {
      this.melee = { kind: 'tail', at: tick + ticks(g.windup) };
      return true;
    }
    const p = target.state;
    s.yaw = turnToward(s.yaw, Math.atan2(-(p.x - s.x), -(p.z - s.z)));
    if (tick >= this.nextMeleeTick && rel.distance <= g.biteReach && rel.front > 0.35) {
      this.melee = { kind: 'bite', at: tick + ticks(g.windup) };
      return true;
    }
    if (rel.distance > g.biteReach - 0.8 && rel.front > 0.5) {
      const nx = s.x - Math.sin(s.yaw) * WALK_SPEED * TICK_DT, nz = s.z - Math.cos(s.yaw) * WALK_SPEED * TICK_DT;
      const next = this.groundAt(world, nx, nz);
      if (next >= 0 && Math.abs(next - ground) <= 1) { s.x = nx; s.z = nz; s.y = next + WALK_HEIGHT; }
    }
    return true;
  }

  // A swoop: rise with a screech, then dive through where the target was.
  stepSwoop(world, players, target, tick) {
    const s = this.state, w = DRAGON_SWOOP, sw = this.swoop;
    if (sw.phase === 'windup') {
      if (target) { const p = target.state; s.yaw = turnToward(s.yaw, Math.atan2(-(p.x - s.x), -(p.z - s.z))); this.aimAt(target); }
      s.pitch = 0.35;
      s.y += Math.max(-CLIMB_SPEED * TICK_DT, Math.min(CLIMB_SPEED * TICK_DT, sw.height - s.y));
      if (tick < sw.until) return;
      if (!target) { this.swoop = null; return; }
      // Dive at the target's body, if nothing solid is in the way.
      const p = target.state, aim = { x: p.x, y: p.y + playerBoxOf(p).height / 2, z: p.z };
      const from = { x: s.x, y: s.y + 1.4, z: s.z };
      const dx = aim.x - from.x, dy = aim.y - from.y, dz = aim.z - from.z, d = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / d, y: dy / d, z: dz / d };
      const wall = raycastBlock(world, from, dir, d, isSolid);
      if (wall && wall.t < d - 0.5) { this.swoop = null; return; }
      this.swoop = { phase: 'dive', dir, until: tick + Math.ceil((d + w.overshoot) / w.speed * TICK_RATE), hit: new Set() };
      s.yaw = Math.atan2(-dir.x, -dir.z);
      return;
    }
    // Diving.
    s.pitch = Math.max(-1.1, Math.atan2(sw.dir.y, Math.max(0.1, Math.hypot(sw.dir.x, sw.dir.z))));
    const step = w.speed * TICK_DT;
    const nx = s.x + sw.dir.x * step, ny = s.y + sw.dir.y * step, nz = s.z + sw.dir.z * step;
    const ground = dragonSurface(world, nx, nz);
    const blocked = isSolid(world.getBlock(Math.floor(nx), Math.floor(ny + 1.4), Math.floor(nz)))
      || nx < 3 || nz < 3 || nx >= world.sizeX - 3 || nz >= world.sizeZ - 3;
    if (!blocked) {
      s.x = nx; s.z = nz;
      s.y = ground >= 0 ? Math.max(ground + WALK_HEIGHT, ny) : ny;
    }
    for (const p of players) {
      if (!huntable(p) || sw.hit.has(p.id)) continue;
      const box = playerBoxOf(p.state);
      if (Math.hypot(p.state.x - s.x, p.state.y + box.height / 2 - (s.y + 1.4), p.state.z - s.z) <= w.reach) {
        sw.hit.add(p.id);
        this.hits.push({ player: p, damage: w.damage, knockback: w.knockback, dir: sw.dir });
      }
    }
    const nearGround = ground >= 0 && s.y <= ground + WALK_HEIGHT + w.landBelow;
    if (blocked || tick >= sw.until || (nearGround && sw.dir.y < 0 && s.y <= ground + WALK_HEIGHT + 0.05)) {
      this.swoop = null;
      // Ended low over solid ground near its target: land and fight there.
      if (nearGround && target && this.groundAt(world, s.x, s.z) >= 0 && this.relative(target).distance <= DRAGON_MELEE.engage)
        this.grounded = { until: tick + ticks(DRAGON_MELEE.groundSeconds) };
    }
  }

  get breathing() {
    return this.breathTicks > 0;
  }

  groundAt(world, x, z) {
    if (x < 3 || z < 3 || x >= world.sizeX - 3 || z >= world.sizeZ - 3) return -1;
    const ground = dragonSurface(world, x, z);
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
    let nearest = null, best = DRAGON_SIGHT * DRAGON_SIGHT;
    for (const p of players) {
      if (!huntable(p) || Math.abs(p.state.y - s.y) > NAV.targetVerticalRange
        || (p.state.x - island.x) ** 2 + (p.state.z - island.z) ** 2 > this.leashRadius ** 2) continue;
      const distance = (p.state.x - s.x) ** 2 + (p.state.z - s.z) ** 2;
      if (distance < best) { nearest = p; best = distance; }
    }
    return nearest;
  }

  // Returns players hit by this tick's fire pulse; physical hits are in
  // this.hits. The game applies damage.
  step(world, players, tick) {
    const s = this.state;
    const target = this.chooseTarget(world, players, tick);
    this.target = target;
    this.hits = [];
    if (this.swoop) { this.breathTicks = 0; this.walking = false; this.stepSwoop(world, players, target, tick); return []; }
    if (this.grounded) { this.breathTicks = 0; if (this.stepGrounded(world, players, target, tick)) return []; }
    // A player walking up to a landed dragon gets a fight on the ground.
    if (target && this.walking && tick >= (this.nextEngageTick ?? 0)
      && this.relative(target).distance <= DRAGON_MELEE.engage && Math.abs(this.relative(target).dy) <= 3) {
      this.walking = false; this.landing = false;
      this.grounded = { until: tick + ticks(DRAGON_MELEE.groundSeconds) };
      this.stepGrounded(world, players, target, tick);
      return [];
    }
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
    // Chasing, it holds off STANDOFF blocks from its target (on its own side),
    // facing them: straight overhead its breath cone can't reach them.
    // (A lone attacker has no approach offset; several spread around.)
    let offset = this.approachOffset;
    if (target && Math.hypot(offset?.x ?? 0, offset?.z ?? 0) < 0.5) {
      const ax = s.x - target.state.x, az = s.z - target.state.z, d = Math.hypot(ax, az);
      offset = d > 0.5 ? { x: ax / d * STANDOFF, z: az / d * STANDOFF } : { x: Math.sin(s.yaw) * STANDOFF, z: Math.cos(s.yaw) * STANDOFF };
    }
    const goal = target
      ? { x: target.state.x + (offset?.x ?? 0), y: target.state.y + 3.2, z: target.state.z + (offset?.z ?? 0) }
      : returning ? this.home
      : { x: this.home.x + Math.cos(patrolAngle) * patrolRadius,
        y: this.home.y + 3 * Math.sin(tick * 0.009 + this.id),
        z: this.home.z + Math.sin(patrolAngle) * patrolRadius };
    goal.x += this.separation?.x ?? 0;
    goal.y += this.separation?.y ?? 0;
    goal.z += this.separation?.z ?? 0;
    const dx = goal.x - s.x, dz = goal.z - s.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (target && horizontalDistance < 2.5) {
      const tx = target.state.x - s.x, tz = target.state.z - s.z;
      s.yaw = turnToward(s.yaw, Math.atan2(-tx, -tz));
    } else if (horizontalDistance > 0.1) s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz));
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
    const ground = dragonSurface(world, s.x, s.z);
    const minimum = ground < 0 ? 10 : ground + 3.5;
    const wantedY = Math.max(minimum, Math.min(world.sizeY - DRAGON_BOX.height - 1, goal.y));
    s.y += Math.max(-CLIMB_SPEED * TICK_DT, Math.min(CLIMB_SPEED * TICK_DT, wantedY - s.y));

    if (target) this.aimAt(target);
    if (this.breathTicks > 0) {
      this.breathTicks--;
      if (this.breathTicks % FIRE_INTERVAL_TICKS === 0) return this.fireTargets(world, players);
      return [];
    }
    // A swoop instead of fire: always against a fire-immune target (fire
    // can't hurt them), sometimes otherwise.
    if (target && tick >= this.nextSwoopTick && tick >= this.nextBreathTick - FIRE_TICKS
      && (target.fireImmune?.() || (this.canHit(world, target) && Math.random() < DRAGON_SWOOP.chance))) {
      this.swoop = { phase: 'windup', until: tick + ticks(DRAGON_SWOOP.windup), height: Math.min(world.sizeY - DRAGON_BOX.height - 2, target.state.y + DRAGON_SWOOP.rise) };
      this.nextSwoopTick = tick + ticks(DRAGON_SWOOP.cooldown);
      this.nextBreathTick = Math.max(this.nextBreathTick, tick + ticks(DRAGON_SWOOP.windup) + FIRE_COOLDOWN_TICKS);
      return [];
    }
    if (target && tick >= this.nextBreathTick && !target.fireImmune?.() && this.canHit(world, target)) {
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
      aimYaw: this.aimYaw, aimPitch: this.aimPitch,
      // Telegraphs: 1 rising for a swoop, 2 diving; a bite or tail whip winding up.
      ...(this.swoop ? { swoop: this.swoop.phase === 'windup' ? 1 : 2 } : {}),
      ...(this.melee ? { attack: this.melee.kind } : {}) };
  }
}
