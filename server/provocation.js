// Provocation, shared by Crawlers, Void Eels and dragons: any damage from a
// player makes the mob hunt that player, ignoring its normal aggro range and
// leash, until the player dies (or leaves, or is eliminated) or the mob has
// had no line of sight to them for PROVOKE_FORGET_TIME. Then it goes home.

import { TICK_RATE, PROVOKE_FORGET_TIME } from '../shared/config.js';
import { isSolid } from '../shared/blocks.js';
import { raycastBlock } from '../shared/raycast.js';
import { playerBoxOf } from '../shared/physics.js';

const FORGET_TICKS = Math.round(PROVOKE_FORGET_TIME * TICK_RATE);

// Whether nothing solid lies between `from` ({ x, y, z }) and the middle of
// the player's body.
export function canSee(world, from, player) {
  const p = player.state;
  const to = { x: p.x, y: p.y + playerBoxOf(p).height * 0.6, z: p.z };
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.01) return true;
  const hit = raycastBlock(world, from, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, isSolid);
  return !hit || hit.t >= distance - 0.3;
}

// A live, connected player who hasn't been eliminated.
export function huntable(player) {
  return !player.dead && player.connected && !player.eliminated;
}

export class Provocation {
  constructor() {
    this.target = null;
    this.lastSeenTick = 0;
  }

  provoke(player, tick) {
    this.target = player;
    this.lastSeenTick = tick;
  }

  // The provoking player while the grudge lasts, else null. `eye` is where
  // the mob looks from.
  current(world, eye, tick) {
    const target = this.target;
    if (!target) return null;
    if (!huntable(target)) {
      this.target = null;
      return null;
    }
    if (canSee(world, eye, target)) this.lastSeenTick = tick;
    else if (tick - this.lastSeenTick > FORGET_TICKS) {
      this.target = null;
      return null;
    }
    return target;
  }
}
