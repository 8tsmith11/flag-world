// Void Eels: long serpents that swim through the air under an island. Each
// has a home island and patrols a zone below its underside, above the void.
// It goes after players who glide, fall or climb within EEL_AGGRO_RANGE,
// drops them once they're back on their feet or out of EEL_LOSE_RANGE, and
// swims home. Provoked (see provocation.js), it hunts its attacker anywhere.
//
// The server moves only the head; clients draw the body trailing behind it.
// Its box is around the head (y is the bottom of the head).

import {
  TICK_RATE, TICK_DT, EEL_HP, EEL_SPEED, EEL_CHASE_SPEED, EEL_REACH, EEL_AGGRO_RANGE, EEL_LOSE_RANGE,
  EEL_ATTACK_COOLDOWN,
} from '../shared/config.js';
import { isSolid } from '../shared/blocks.js';
import { playerBoxOf, isOnLadder } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, huntable } from './provocation.js';

export const EEL_BOX = { halfW: 0.6, height: 0.8 };
const ATTACK_TICKS = Math.round(EEL_ATTACK_COOLDOWN * TICK_RATE);
const TURN_PER_TICK = 0.12;
// A player falling faster than this (blocks/s) counts as falling, not jumping.
const FALLING_SPEED = 6;

function turnToward(current, wanted, rate) {
  let difference = (wanted - current + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  difference -= Math.PI;
  return current + Math.max(-rate, Math.min(rate, difference));
}

// Gliding, falling or on a ladder or rope: what draws an eel.
function exposed(player, world) {
  const s = player.state;
  return s.gliding || (!s.onGround && s.vy < -FALLING_SPEED) || isOnLadder(s, world);
}

export class VoidEel {
  // zone: { x, z, radius, top, bottom }, the space it patrols.
  constructor(id, zone) {
    this.id = id;
    this.type = ENTITY_TYPE.VOID_EEL;
    this.name = 'Void Eel';
    this.zone = zone;
    const y = (zone.top + zone.bottom) / 2;
    this.state = { x: zone.x, y, z: zone.z, yaw: Math.random() * Math.PI * 2, pitch: 0, box: EEL_BOX,
      kx: 0, kz: 0, vy: 0 };
    this.hp = EEL_HP;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    this.target = null;
    this.nextAttackTick = 0;
    this.phase = Math.random() * Math.PI * 2;
  }

  center() {
    const s = this.state;
    return { x: s.x, y: s.y + EEL_BOX.height / 2, z: s.z };
  }

  inZone(x, y, z) {
    const zone = this.zone;
    return Math.hypot(x - zone.x, z - zone.z) <= zone.radius && y >= zone.bottom && y <= zone.top;
  }

  chooseTarget(world, players, tick) {
    const provoked = this.provocation.current(world, this.center(), tick);
    if (provoked) return provoked;
    const c = this.center();
    const distance = (p) => Math.hypot(p.state.x - c.x, p.state.y + 0.9 - c.y, p.state.z - c.z);
    if (this.target && huntable(this.target) && exposed(this.target, world)
      && distance(this.target) <= EEL_LOSE_RANGE) return this.target;
    let best = null;
    for (const player of players) {
      if (!huntable(player) || !exposed(player, world)) continue;
      const d = distance(player);
      if (d <= EEL_AGGRO_RANGE && (!best || d < best.d)) best = { player, d };
    }
    return best?.player ?? null;
  }

  // A slow circuit around the middle of the zone, bobbing up and down.
  patrolGoal(tick) {
    const zone = this.zone;
    const angle = tick * 0.004 + this.phase;
    const radius = zone.radius * (0.35 + 0.2 * Math.sin(tick * 0.002 + this.phase));
    return {
      x: zone.x + Math.cos(angle) * radius,
      y: (zone.top + zone.bottom) / 2 + (zone.top - zone.bottom) * 0.35 * Math.sin(tick * 0.006 + this.phase),
      z: zone.z + Math.sin(angle) * radius,
    };
  }

  // One tick. Returns the player bitten this tick, or null.
  step(world, players, tick) {
    const s = this.state;
    this.target = this.chooseTarget(world, players, tick);
    const home = !this.target && !this.inZone(s.x, s.y, s.z);
    const goal = this.target
      ? { x: this.target.state.x, y: this.target.state.y + playerBoxOf(this.target.state).height / 2, z: this.target.state.z }
      : home ? { x: this.zone.x, y: (this.zone.top + this.zone.bottom) / 2, z: this.zone.z } : this.patrolGoal(tick);
    const c = this.center();
    const dx = goal.x - c.x, dy = goal.y - c.y, dz = goal.z - c.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 0.2) s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz), TURN_PER_TICK);
    s.pitch = turnToward(s.pitch, Math.max(-0.9, Math.min(0.9, Math.atan2(dy, Math.max(0.5, horizontal)))), TURN_PER_TICK);
    const speed = (this.target || home ? EEL_CHASE_SPEED : EEL_SPEED) * TICK_DT;
    const step = {
      x: -Math.sin(s.yaw) * Math.cos(s.pitch) * speed,
      y: Math.sin(s.pitch) * speed,
      z: -Math.cos(s.yaw) * Math.cos(s.pitch) * speed,
    };
    // Close in, but not through the target; slide around blocks, trying up
    // or down when the way ahead is solid.
    if (!(this.target && Math.hypot(dx, dy, dz) < EEL_REACH * 0.6)) {
      const blocked = (x, y, z) => isSolid(world.getBlock(Math.floor(x), Math.floor(y + EEL_BOX.height / 2), Math.floor(z)));
      for (const lift of [0, speed, -speed]) {
        if (!blocked(s.x + step.x, s.y + step.y + lift, s.z + step.z)) {
          s.x += step.x;
          s.y += step.y + lift;
          s.z += step.z;
          break;
        }
      }
    }
    s.y = Math.max(world.voidY + 2, Math.min(world.sizeY - 2, s.y));

    if (this.target && tick >= this.nextAttackTick) {
      const t = this.target.state, box = playerBoxOf(t);
      const nearestY = Math.max(t.y, Math.min(t.y + box.height, c.y));
      if (Math.hypot(Math.max(0, Math.abs(t.x - c.x) - box.halfW), nearestY - c.y,
        Math.max(0, Math.abs(t.z - c.z) - box.halfW)) <= EEL_REACH) {
        this.nextAttackTick = tick + ATTACK_TICKS;
        return this.target;
      }
    }
    return null;
  }

  describe() {
    return this.snapshot();
  }

  snapshot() {
    const { x, y, z, yaw, pitch } = this.state;
    return { id: this.id, type: this.type, name: this.name, x, y, z, yaw, pitch };
  }
}
