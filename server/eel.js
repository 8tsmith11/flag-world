// Deep-void swimmers. Natural worldgen terrain blocks their vertical detection;
// player-built bridges do not. The server owns movement, targeting and bites.
import {
  TICK_RATE, TICK_DT, EEL_HP, EEL_SPEED, EEL_CHASE_SPEED, EEL_LUNGE_SPEED,
  EEL_LUNGE_WINDUP, EEL_REACH, EEL_DETECT_RADIUS, EEL_DETECT_HEIGHT,
  EEL_NIGHT_DETECT_SCALE, EEL_NIGHT_RISE_SCALE, EEL_FORGET_TIME,
  EEL_LOSE_RANGE, EEL_WANDER_RADIUS, EEL_ATTACK_COOLDOWN,
  EEL_LUNGE_DURATION, EEL_TURN_RATE,
} from '../shared/config.js';
import { isSolid } from '../shared/blocks.js';
import { playerBoxOf } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, huntable } from './provocation.js';

export const EEL_BOX = { halfW: 0.6, height: 0.8 };
const WINDUP_TICKS = Math.round(EEL_LUNGE_WINDUP * TICK_RATE);
const LUNGE_TICKS = Math.round(EEL_LUNGE_DURATION * TICK_RATE);
const FORGET_TICKS = Math.round(EEL_FORGET_TIME * TICK_RATE);
const COOLDOWN_TICKS = Math.round(EEL_ATTACK_COOLDOWN * TICK_RATE);

function turnToward(current, wanted) {
  let difference = (wanted - current + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  return current + Math.max(-EEL_TURN_RATE, Math.min(EEL_TURN_RATE, difference - Math.PI));
}

export class VoidEel {
  // band: {top,bottom}; spawn: {x,y,z}. The spawn point biases initial roaming,
  // but does not leash the eel to an island.
  constructor(id, band, spawn) {
    this.id = id;
    this.type = ENTITY_TYPE.VOID_EEL;
    this.name = 'Void Eel';
    this.band = band;
    this.state = { ...spawn, yaw: Math.random() * Math.PI * 2, pitch: 0,
      box: EEL_BOX, kx: 0, kz: 0, vy: 0 };
    this.hp = EEL_HP;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    this.target = null;
    this.lastSeenTick = 0;
    this.nextAttackTick = 0;
    this.windupTicks = 0;
    this.lungeTicks = 0;
    this.lungeDirection = null;
    this.wanderGoal = null;
    this.wanderUntil = 0;
    this.trail = Array.from({ length: 16 }, (_, i) => ({
      x: spawn.x + Math.sin(this.state.yaw) * i * 0.55,
      y: spawn.y + EEL_BOX.height / 2,
      z: spawn.z + Math.cos(this.state.yaw) * i * 0.55,
    }));
    this.escapeTrail = [];
  }

  center() {
    const s = this.state;
    return { x: s.x, y: s.y + EEL_BOX.height / 2, z: s.z };
  }

  bandTop(world, x = this.state.x, z = this.state.z) {
    const center = world.islands?.find((island) => island.kind === 'center');
    if (center && Math.hypot(x - center.x, z - center.z) <= center.radius) return this.band.top;
    const outer = world.islands?.filter((island) => island.kind !== 'center')
      .sort((a, b) => Math.max(0, Math.hypot(x - a.x, z - a.z) - a.radius)
        - Math.max(0, Math.hypot(x - b.x, z - b.z) - b.radius))[0];
    return outer ? Math.max(this.band.top, outer.bottomY - this.band.outerBelowIsland) : this.band.top;
  }

  exposed(world, player) {
    const c = this.center(), p = player.state;
    return !world.naturalTerrainBetween(p.x, p.z, c.y, p.y + 0.1);
  }

  detectable(world, player, night) {
    if (!huntable(player) || !this.exposed(world, player)) return false;
    const c = this.center(), p = player.state;
    const height = EEL_DETECT_HEIGHT * (night ? EEL_NIGHT_DETECT_SCALE : 1);
    return p.y >= c.y && p.y - c.y <= height
      && Math.hypot(p.x - c.x, p.z - c.z) <= EEL_DETECT_RADIUS;
  }

  chooseTarget(world, players, tick, night) {
    const provoked = this.provocation.target;
    if (provoked && tick - this.provocation.lastSeenTick <= FORGET_TICKS
      && huntable(provoked) && this.exposed(world, provoked)) {
      this.target = provoked;
      this.lastSeenTick = this.provocation.lastSeenTick;
      return provoked;
    }
    if (this.target && huntable(this.target) && this.exposed(world, this.target)) {
      const p = this.target.state, c = this.center();
      if (this.detectable(world, this.target, night)) this.lastSeenTick = tick;
      if (Math.hypot(p.x - c.x, p.z - c.z) <= EEL_LOSE_RANGE
        && tick - this.lastSeenTick <= FORGET_TICKS) return this.target;
    }
    this.target = null;
    this.provocation.target = null;
    let nearest = null;
    for (const player of players) {
      if (!this.detectable(world, player, night)) continue;
      const p = player.state, c = this.center();
      const distance = Math.hypot(p.x - c.x, p.z - c.z);
      if (!nearest || distance < nearest.distance) nearest = { player, distance };
    }
    if (nearest) {
      this.target = nearest.player;
      this.lastSeenTick = tick;
    }
    return this.target;
  }

  wander(world, tick) {
    const s = this.state;
    if (this.wanderGoal && tick < this.wanderUntil
      && Math.hypot(s.x - this.wanderGoal.x, s.y - this.wanderGoal.y, s.z - this.wanderGoal.z) > 3) return this.wanderGoal;
    this.wanderUntil = tick + TICK_RATE * (6 + Math.floor(Math.random() * 7));
    this.wanderGoal = {
      x: Math.max(4, Math.min(world.sizeX - 4, s.x + (Math.random() - 0.5) * EEL_WANDER_RADIUS * 2)),
      y: this.band.bottom + 4 + Math.random() * Math.max(1,
        this.bandTop(world, s.x, s.z) - this.band.bottom - 8),
      z: Math.max(4, Math.min(world.sizeZ - 4, s.z + (Math.random() - 0.5) * EEL_WANDER_RADIUS * 2)),
    };
    return this.wanderGoal;
  }

  returnGoal(world, tick) {
    const s = this.state;
    if (s.y > this.bandTop(world)) {
      while (this.escapeTrail.length && Math.hypot(s.x - this.escapeTrail.at(-1).x,
        s.y - this.escapeTrail.at(-1).y, s.z - this.escapeTrail.at(-1).z) < 1) this.escapeTrail.pop();
      if (this.escapeTrail.length) return this.escapeTrail.at(-1);
      const island = world.islands?.filter((entry) => entry.kind !== 'tiny'
        && s.y >= entry.bottomY - 3
        && Math.hypot(s.x - entry.x, s.z - entry.z) < entry.radius + 8)
        .sort((a, b) => Math.hypot(s.x - a.x, s.z - a.z) - Math.hypot(s.x - b.x, s.z - b.z))[0];
      if (island) {
        const dx = s.x - island.x, dz = s.z - island.z;
        const angle = Math.hypot(dx, dz) > 0.01 ? Math.atan2(dz, dx) : this.id;
        return { x: island.x + Math.cos(angle) * (island.radius + 12),
          y: s.y, z: island.z + Math.sin(angle) * (island.radius + 12) };
      }
      return { x: s.x, y: this.bandTop(world) - 5, z: s.z };
    }
    return this.wander(world, tick);
  }

  clear(world, x, y, z) {
    if (x < 1 || z < 1 || x >= world.sizeX - 1 || z >= world.sizeZ - 1
      || y < world.voidY + 1 || y >= world.sizeY - EEL_BOX.height) return false;
    for (const dx of [-EEL_BOX.halfW, EEL_BOX.halfW]) for (const dz of [-EEL_BOX.halfW, EEL_BOX.halfW]) {
      for (const dy of [0.1, EEL_BOX.height - 0.1]) {
        if (isSolid(world.getBlock(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz)))) return false;
      }
    }
    return true;
  }

  swim(world, goal, speed, night) {
    const s = this.state, c = this.center();
    const dx = goal.x - c.x, dy = goal.y - c.y, dz = goal.z - c.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.05) return;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 0.05) s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz));
    s.pitch = turnToward(s.pitch, Math.atan2(dy, Math.max(0.01, horizontal)));
    const step = Math.min(length, speed * (night && dy > 0 ? EEL_NIGHT_RISE_SCALE : 1) * TICK_DT);
    const vx = dx / length * step, vy = dy / length * step, vz = dz / length * step;
    for (const [ox, oy, oz] of [[vx, vy, vz], [vx, 0, vz], [0, vy, 0],
      [-vz, vy, vx], [vz, vy, -vx]]) {
      if (!this.clear(world, s.x + ox, s.y + oy, s.z + oz)) continue;
      s.x += ox; s.y += oy; s.z += oz;
      this.rememberTrail();
      return;
    }
  }

  rememberTrail() {
    const point = this.center();
    if (!this.trail.length || Math.hypot(point.x - this.trail[0].x,
      point.y - this.trail[0].y, point.z - this.trail[0].z) > 0.2) this.trail.unshift(point);
    let length = 0;
    for (let i = 1; i < this.trail.length; i++) {
      length += Math.hypot(this.trail[i].x - this.trail[i - 1].x,
        this.trail[i].y - this.trail[i - 1].y, this.trail[i].z - this.trail[i - 1].z);
      if (length > 8) { this.trail.length = i + 1; break; }
    }
  }

  tailTip() {
    return this.trail.at(-1) ?? { x: this.state.x + Math.sin(this.state.yaw) * 7.7,
      y: this.state.y + EEL_BOX.height / 2, z: this.state.z + Math.cos(this.state.yaw) * 7.7 };
  }

  extraHitBoxes() {
    const tail = this.tailTip();
    return [{ x: tail.x, y: tail.y - 0.2, z: tail.z, halfW: 0.25, height: 0.4,
      damageScale: 2 }];
  }

  inBiteReach(player) {
    const c = this.center(), t = player.state, box = playerBoxOf(t);
    const gapX = Math.max(0, Math.abs(t.x - c.x) - box.halfW);
    const gapZ = Math.max(0, Math.abs(t.z - c.z) - box.halfW);
    const gapY = Math.max(t.y - c.y, c.y - t.y - box.height, 0);
    return Math.hypot(gapX, gapY, gapZ) <= EEL_REACH;
  }

  step(world, players, tick, night = false) {
    this.night = night;
    const target = this.chooseTarget(world, players, tick, night);
    if (!target) { this.windupTicks = 0; this.lungeTicks = 0; }
    if (target && this.lungeTicks > 0) {
      this.lungeTicks--;
      const c = this.center(), d = this.lungeDirection;
      this.swim(world, { x: c.x + d.x * 4, y: c.y + d.y * 4, z: c.z + d.z * 4 }, EEL_LUNGE_SPEED, night);
      if (this.inBiteReach(target)) {
        this.lungeTicks = 0;
        this.nextAttackTick = tick + COOLDOWN_TICKS;
        return target;
      }
      if (this.lungeTicks === 0) this.nextAttackTick = tick + COOLDOWN_TICKS;
      return null;
    }
    if (target && this.windupTicks > 0) {
      if (--this.windupTicks === 0) {
        const c = this.center(), p = target.state;
        const dx = p.x - c.x, dy = p.y + playerBoxOf(p).height / 2 - c.y, dz = p.z - c.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        this.lungeDirection = { x: dx / length, y: dy / length, z: dz / length };
        this.lungeTicks = LUNGE_TICKS;
      }
      return null;
    }
    const goal = target
      ? { x: target.state.x + (this.approachOffset?.x ?? 0),
        y: target.state.y + playerBoxOf(target.state).height / 2,
        z: target.state.z + (this.approachOffset?.z ?? 0) }
      : this.returnGoal(world, tick);
    goal.x += this.separation?.x ?? 0;
    goal.y += this.separation?.y ?? 0;
    goal.z += this.separation?.z ?? 0;
    this.swim(world, goal, target ? EEL_CHASE_SPEED : EEL_SPEED, night);
    if (target && this.state.y > this.bandTop(world)) {
      const last = this.escapeTrail.at(-1);
      if (!last || Math.hypot(this.state.x - last.x, this.state.y - last.y,
        this.state.z - last.z) > 1) this.escapeTrail.push({ x: this.state.x, y: this.state.y, z: this.state.z });
      if (this.escapeTrail.length > 500) this.escapeTrail.shift();
    } else if (this.state.y <= this.bandTop(world)) this.escapeTrail.length = 0;
    if (target && tick >= this.nextAttackTick
      && Math.hypot(target.state.x - this.state.x, target.state.y - this.state.y, target.state.z - this.state.z) < 5) {
      this.windupTicks = WINDUP_TICKS;
    }
    return null;
  }

  describe() { return this.snapshot(); }

  snapshot() {
    const { x, y, z, yaw, pitch } = this.state;
    const tail = this.tailTip();
    return { id: this.id, type: this.type, name: this.name, x, y, z, yaw, pitch,
      coiling: this.windupTicks > 0, lunging: this.lungeTicks > 0, night: !!this.night,
      tail: { x: tail.x, y: tail.y, z: tail.z } };
  }
}
