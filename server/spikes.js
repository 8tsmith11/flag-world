// Iron spike barricades (block BLOCK.SPIKE_BARRICADE, tuning in SPIKES in
// shared/config.js). Each remembers the team that placed it (null when
// placed by no team), and the shared hostility rules (server/hostility.js)
// decide whom it hurts: enemy players and tamed monkeys, goblins and hostile
// creatures, never its own team, its monkeys, wild monkeys or cows.
//
//   - Touch: anything hostile within touchMargin of a spike block takes
//     contactDamage and is thrown back from the block's center, at most once
//     per contactCooldown seconds each.
//   - Breaking by hand: a hostile player breaking one takes breakDamage every
//     breakInterval seconds while they work at it (Game.stepBreaking).
//   - Ranged: arrows that stick in one wear it down (arrowDamage per arrow,
//     boltDamage per crossbow bolt), through the explosives' block damage, so
//     arrows and barrels together can clear a spiked wall without touching it.
import { SPIKES as C, TICK_RATE, KNOCKBACK_SPEED, KNOCKBACK_UP, CROSSBOW_ARROW_DAMAGE } from '../shared/config.js';
import { BLOCK } from '../shared/blocks.js';
import { DEATH_CAUSE } from '../shared/protocol.js';
import { playerBoxOf } from '../shared/physics.js';
import { isHostileTo, hostileCandidates } from './hostility.js';

const key = (x, y, z) => `${x},${y},${z}`;
const ticks = (seconds) => Math.max(1, Math.round(seconds * TICK_RATE));

export class Spikes {
  constructor(game) {
    this.game = game;
    // key -> team (null: nobody's)
    this.teams = new Map();
  }

  get world() { return this.game.world; }

  // Who a spike block belongs to (null: nobody, hurting everyone).
  teamAt(x, y, z) { return this.teams.get(key(x, y, z)) ?? null; }

  // A player placed one.
  placed(x, y, z, team) { this.teams.set(key(x, y, z), team ?? null); }

  // Any block change (Game's onBlockChanged).
  changed(x, y, z, id) {
    const k = key(x, y, z);
    if (id === BLOCK.SPIKE_BARRICADE) { if (!this.teams.has(k)) this.teams.set(k, null); }
    else this.teams.delete(k);
  }

  // Throws `target` away from the spike at x, y, z and hurts it.
  strike(target, x, y, z, amount) {
    const s = target.state;
    let dx = s.x - (x + 0.5), dz = s.z - (z + 0.5);
    const len = Math.hypot(dx, dz);
    if (len < 0.05) { dx = Math.cos(target.id ?? 0); dz = Math.sin(target.id ?? 0); } else { dx /= len; dz /= len; }
    s.kx = dx * KNOCKBACK_SPEED * C.knockback;
    s.kz = dz * KNOCKBACK_SPEED * C.knockback;
    s.vy = Math.max(s.vy ?? 0, KNOCKBACK_UP * Math.min(1, C.knockback) * (s.y >= y + 0.9 ? 1 : 0.6));
    s.onGround = false;
    this.game.hurt(target, amount, null, DEATH_CAUSE.SPIKES);
  }

  // The spike block a target is touching, if one is hostile to it.
  touching(target) {
    const s = target.state, box = playerBoxOf(s), m = C.touchMargin;
    const x0 = Math.floor(s.x - box.halfW - m), x1 = Math.floor(s.x + box.halfW + m);
    const y0 = Math.floor(s.y - m), y1 = Math.floor(s.y + box.height + m);
    const z0 = Math.floor(s.z - box.halfW - m), z1 = Math.floor(s.z + box.halfW + m);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (this.world.getBlock(x, y, z) !== BLOCK.SPIKE_BARRICADE) continue;
      if (isHostileTo(this.teamAt(x, y, z), target)) return { x, y, z };
    }
    return null;
  }

  // Each tick: contact damage.
  update(tick) {
    if (!this.teams.size) return;
    for (const target of hostileCandidates(this.game)) {
      if (target.dead || tick < (target.spikeReadyTick ?? 0)) continue;
      const spike = this.touching(target);
      if (!spike) continue;
      target.spikeReadyTick = tick + ticks(C.contactCooldown);
      this.strike(target, spike.x, spike.y, spike.z, C.contactDamage);
    }
  }

  // A player has been breaking the block at pos for `breakTicks` ticks.
  breaking(player, pos, breakTicks) {
    if (this.world.getBlock(pos.x, pos.y, pos.z) !== BLOCK.SPIKE_BARRICADE) return;
    if (!isHostileTo(this.teamAt(pos.x, pos.y, pos.z), player)) return;
    if (breakTicks % ticks(C.breakInterval) !== 1) return;
    this.game.hurt(player, C.breakDamage, null, DEATH_CAUSE.SPIKES);
  }

  // An arrow just stuck in a block: spikes (not its shooter's own) wear down.
  arrowHit(arrow) {
    const at = arrow.stuckIn;
    if (!at || this.world.getBlock(at.x, at.y, at.z) !== BLOCK.SPIKE_BARRICADE) return;
    const team = this.teamAt(at.x, at.y, at.z), shooter = arrow.shooter;
    if (team !== null && shooter?.team === team) return;
    const bolt = arrow.damage >= CROSSBOW_ARROW_DAMAGE;
    this.game.explosives.damageBlock(at.x, at.y, at.z, bolt ? C.boltDamage : C.arrowDamage);
  }

  save() { return [...this.teams]; }
  load(list) {
    // Saved blocks are replayed without the change hook: find the spikes.
    for (const [k] of this.game.blockChanges ?? []) {
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === BLOCK.SPIKE_BARRICADE) this.teams.set(k, null);
    }
    for (const [k, team] of list ?? []) {
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === BLOCK.SPIKE_BARRICADE) this.teams.set(k, team);
    }
  }
}
