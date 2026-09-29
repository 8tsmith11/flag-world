// Invisible floor sensors paired with camouflaged wall shooters. Projectiles
// and damage use the ordinary authoritative arrow/combat pipeline.
import { BLOCK, FACING_DIRS, facedBlock } from '../shared/blocks.js';
import { FORTRESS_TRAP as C, TICK_RATE } from '../shared/config.js';
import { Arrow } from './arrow.js';
import { S2C } from '../shared/protocol.js';
import { huntable } from './provocation.js';
export const isGoblin = target => target.faction === 'goblin' || target.type?.startsWith('goblin');
export class FortressTraps {
  constructor(game) {
    this.game = game; this.cooldowns = new Map(); this.poison = new Map();
    this.traps = game.chunkLoading ? game.chunkLoading.entityMap(p => p) : new Map();
    for (const piece of game.world.goblinPlan?.fortress.pieces ?? []) for (const trap of piece.traps ?? []) {
      this.traps.set(`${trap.x},${trap.y},${trap.z}`, trap);
    }
  }
  infect(target) {
    this.poison.set(target, { until: this.game.tick + Math.round(C.poisonSeconds * TICK_RATE),
      next: this.game.tick + Math.round(C.poisonInterval * TICK_RATE) });
  }
  step() {
    const g = this.game, targets = [...g.players.values(), ...(g.cows.activeValues?.() ?? g.cows.values()),
      ...(g.mobs.activeValues?.() ?? g.mobs.values()), ...(g.dragons.activeValues?.() ?? g.dragons.values())];
    for (const trap of this.traps.activeValues?.() ?? this.traps.values()) {
      const k = `${trap.x},${trap.y},${trap.z}`;
      if ((this.cooldowns.get(k) ?? 0) > g.tick || g.world.getBlock(trap.x, trap.y, trap.z) !== facedBlock(BLOCK.POISON_TRAP, trap.facing)) continue;
      const [dx, dz] = FACING_DIRS[trap.facing], x = trap.sensor?.x ?? trap.x + dx, z = trap.sensor?.z ?? trap.z + dz;
      const target = targets.find(t => huntable(t) && !isGoblin(t) && Math.floor(t.state.x) === x && Math.floor(t.state.z) === z
        && t.state.y < trap.y + C.triggerHeight && t.state.y + (t.state.box?.height ?? C.triggerHeight) > trap.y);
      if (!target) continue;
      const shooter = { id: null, team: -1, trap: true, name: 'Poison trap' };
      const arrow = new Arrow(g.nextId++, shooter, trap.x + 0.5 + dx * 0.55, trap.y + 0.5,
        trap.z + 0.5 + dz * 0.55, dx * C.speed, 0, dz * C.speed, 1);
      arrow.damage = C.damage; arrow.poison = true;
      g.arrows.set(arrow.id, arrow); g.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
      this.cooldowns.set(k, g.tick + Math.round(C.cooldown * TICK_RATE));
    }
    for (const [target, poison] of this.poison) {
      if (!huntable(target) || g.tick >= poison.until) { this.poison.delete(target); continue; }
      if (g.chunkLoading && !g.chunkLoading.has(target.state.x, target.state.z)) continue;
      if (g.tick < poison.next) continue;
      poison.next = g.tick + Math.round(C.poisonInterval * TICK_RATE);
      if (target.hp > 1) g.hurt(target, Math.min(C.poisonDamage, target.hp - 1), null);
    }
  }
}
