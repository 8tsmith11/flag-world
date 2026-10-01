// Server-owned sapling timers. Only due timers are visited on each tick.
import { TICK_RATE, SAPLING_GROW_TIME } from '../shared/config.js';
import { BLOCK } from '../shared/blocks.js';
import { canGrowTree, growTree } from '../shared/structures.js';

const RETRY_TICKS = 5 * TICK_RATE;
const TICK_BUDGET = 64;

export class SaplingGrowth {
  // growTime(x, y, z): seconds for the sapling there to grow (default: a
  // random time in SAPLING_GROW_TIME).
  constructor(world, occupied = () => false, growTime = null, loader = null) {
    this.world = world;
    this.occupied = occupied;
    this.growTime = growTime;
    this.loader = loader;
    this.sleeping = loader ? loader.entityMap(p => p) : new Map();
    this.scheduled = new Map();
    this.buckets = new Map();
  }

  scheduleAt(x, y, z, due) {
    const key = `${x},${y},${z}`;
    this.scheduled.set(key, due);
    if (!this.buckets.has(due)) this.buckets.set(due, []);
    this.buckets.get(due).push({ key, x, y, z, due });
  }

  planted(x, y, z, tick) {
    const [low, high] = SAPLING_GROW_TIME;
    const seconds = this.growTime?.(x, y, z) ?? low + Math.random() * (high - low);
    this.scheduleAt(x, y, z, tick + Math.max(1, Math.round(seconds * TICK_RATE)));
  }

  removed(x, y, z) {
    this.scheduled.delete(`${x},${y},${z}`);
    this.sleeping.delete(`${x},${y},${z}`);
  }

  canGrow(x, y, z, top) {
    const world = this.world;
    if (!canGrowTree(world, x, y - 1, z, top, { straightTrunk: true })) return false;
    if (this.occupied(x, y, z, top)) return false;
    return true;
  }

  tick(gameTick) {
    for (const p of this.sleeping.activeValues?.() ?? []) {
      this.sleeping.delete(p.key);
      if (this.scheduled.has(p.key)) this.scheduleAt(p.x, p.y, p.z, gameTick + 1);
    }
    const due = this.buckets.get(gameTick);
    if (!due) return;
    this.buckets.delete(gameTick);
    for (let i = 0; i < due.length; i++) {
      const { key, x, y, z } = due[i];
      if (this.scheduled.get(key) !== gameTick) continue;
      if (this.loader && !this.loader.has(x, z)) { this.sleeping.set(key, { key, x, y, z }); continue; }
      if (i >= TICK_BUDGET) {
        this.scheduleAt(x, y, z, gameTick + 1);
        continue;
      }
      if (this.world.getBlock(x, y, z) !== BLOCK.SAPLING) {
        this.scheduled.delete(key);
        continue;
      }
      const top = y - 1 + 4 + Math.floor(Math.random() * 3);
      if (!this.canGrow(x, y, z, top)) {
        this.scheduleAt(x, y, z, gameTick + RETRY_TICKS);
        continue;
      }
      this.scheduled.delete(key);
      growTree(this.world, x, y - 1, z, top, { straightTrunk: true });
    }
  }
}
