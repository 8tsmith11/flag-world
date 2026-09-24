// The Goblin Fortress in a match: spawns the Totem, the King and the Workers
// from world.goblinFortress, keeps the Totem's shared storage (a count per
// item; nobody can open it), quarry claims, worker respawns and goblin
// crowding, and handles goblin damage and deaths for the Game.

import { TICK_RATE, ITEM_POP_SPEED, ITEM_PICKUP_DELAY } from '../shared/config.js';
import { GOBLINS } from '../shared/goblins.js';
import { moduleAt } from '../shared/goblinModules.js';
import { rollLoot } from '../shared/loot.js';
import { S2C } from '../shared/protocol.js';
import { GoblinTotem, GoblinKing, GoblinWorker } from './goblin.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);

export class GoblinController {
  constructor(game) {
    this.game = game;
    this.fortress = game.world.goblinFortress ?? null;
    // Shared goblin storage: item id -> count.
    this.storage = new Map();
    this.claims = new Set();
    this.totem = null;
    this.totemAlive = false;
    this.king = null;
    this.workerCount = GOBLINS.workerCount[game.worldSize] ?? GOBLINS.workerCount.medium;
    // Fortress workers alive, and ticks when dead ones come back.
    this.workers = new Set();
    this.respawns = [];
    const modules = this.fortress?.modules ?? [];
    this.hall = modules.find((m) => m.feature?.kind === 'totem') ?? null;
    this.quarry = modules.find((m) => m.feature?.kind === 'quarry')?.feature ?? null;
    this.totemSpot = this.hall?.feature ?? null;
  }

  // The Totem Hall's floor, less a margin from its walls, as the King's arena.
  hallArena() {
    const b = this.hall.box, m = GOBLINS.king.wallMargin + GOBLINS.king.width / 2;
    return { x0: b.x0 + 1 + m, x1: b.x1 - m, z0: b.z0 + 1 + m, z1: b.z1 - m, y0: b.y0, y1: b.y1 };
  }

  add(mob) {
    this.game.mobs.set(mob.id, mob);
    return mob;
  }

  spawnAll() {
    if (!this.hall) return;
    const t = this.totemSpot;
    this.totem = this.add(new GoblinTotem(this.game.nextId++, this, t.x, t.y, t.z));
    this.totemAlive = true;
    const home = { x: t.x, y: t.y, z: t.z + 2.5 };
    this.king = this.add(new GoblinKing(this.game.nextId++, this, home.x, home.y, home.z, this.hallArena(), home));
    for (let i = 0; i < this.workerCount; i++) this.spawnWorker();
  }

  // A fortress worker by the totem, spread around it.
  spawnWorker() {
    const t = this.totemSpot;
    const angle = Math.random() * Math.PI * 2;
    const worker = new GoblinWorker(this.game.nextId++, this,
      t.x + Math.cos(angle) * 2.5, t.y, t.z + Math.sin(angle) * 2.5);
    this.workers.add(worker);
    return this.add(worker);
  }

  // A goblin from a spawn egg at (x, y, z). Inside the fortress it joins in
  // (a King in the Totem Hall guards it); outside, a Worker potters about
  // and a King guards a square around where it hatched.
  hatch(type, x, y, z) {
    const inFortress = this.fortress && moduleAt(this.fortress, x, y + 0.1, z);
    if (type === 'goblinWorker') return new GoblinWorker(this.game.nextId++, this, x, y, z, { stray: !inFortress });
    const inHall = inFortress === this.hall && this.hall;
    const r = GOBLINS.king.strayArena;
    const arena = inHall ? this.hallArena() : { x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y - 4, y1: y + 6 };
    return new GoblinKing(this.game.nextId++, this, x, y, z, arena, { x, y, z });
  }

  deposit(worker) {
    for (const [item, count] of worker.carrying) this.storage.set(item, (this.storage.get(item) ?? 0) + count);
    worker.carrying.clear();
  }

  storageContents() {
    return Object.fromEntries(this.storage);
  }

  // Once per tick, before mobs move: respawns, and each goblin's push away
  // from crowding goblins.
  update(tick) {
    while (this.respawns.length && this.respawns[0] <= tick) {
      this.respawns.shift();
      if (this.totemAlive && this.workers.size < this.workerCount) {
        const worker = this.spawnWorker();
        this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: worker.describe() });
      }
    }
    const walkers = [...this.game.mobs.values()].filter((mob) => mob.goblin && mob.separation);
    const { spacing } = GOBLINS.separation;
    for (const goblin of walkers) {
      const sep = goblin.separation;
      sep.x = sep.z = 0;
      const s = goblin.state;
      for (const other of walkers) {
        if (other === goblin) continue;
        const o = other.state;
        const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz);
        const reach = (s.box.halfW + o.box.halfW) * spacing;
        if (d >= reach || Math.abs(s.y - o.y) > 1.5) continue;
        const push = (reach - d) / reach;
        if (d < 1e-3) { sep.x += Math.cos(goblin.id) * push; sep.z += Math.sin(goblin.id) * push; } else {
          sep.x += dx / d * push;
          sep.z += dz / d * push;
        }
      }
    }
  }

  // Damage to a goblin (or the totem) from `attacker`.
  hurt(mob, amount, attacker, isPlayer) {
    const game = this.game;
    if (mob.dead) return;
    if (mob === this.totem || mob instanceof GoblinTotem) {
      // Only player weapons (melee, arrows, bolts) hurt the totem.
      if (!isPlayer) return;
      mob.lastDamageTick = game.tick;
    }
    mob.hp = Math.max(0, mob.hp - amount);
    game.broadcast({ type: S2C.DAMAGE, id: mob.id, attackerId: attacker?.id ?? null, hp: Math.ceil(mob.hp) });
    if (isPlayer && mob.provocation) mob.provocation.provoke(attacker, game.tick);
    if (mob.hp > 0) return;
    const s = mob.state;
    if (mob instanceof GoblinTotem) this.destroyTotem(mob, attacker);
    else if (mob instanceof GoblinKing) this.spill(rollLoot('goblinKing', Math.random() * 0xffffffff >>> 0, 0, 0, 0), s, 1);
    else if (mob instanceof GoblinWorker) {
      mob.releaseClaim();
      for (const [item, count] of mob.carrying) this.spill([{ item, count }], s, 1);
      mob.carrying.clear();
    }
    game.removeMob(mob);
  }

  // Items popping out around a point, `spread` blocks/s sideways.
  spill(stacks, s, spread) {
    for (const stack of stacks) {
      if (!stack) continue;
      this.game.spawnItem(stack.item, stack.count, s.x, s.y + 0.6, s.z, (Math.random() - 0.5) * 2 * spread,
        ITEM_POP_SPEED * (0.8 + Math.random() * 0.6), (Math.random() - 0.5) * 2 * spread, ITEM_PICKUP_DELAY, stack.mods ?? null);
    }
  }

  destroyTotem(totem, attacker) {
    const game = this.game;
    const s = totem.state;
    this.totemAlive = false;
    this.respawns.length = 0;
    this.spill(rollLoot('goblinTotem', Math.random() * 0xffffffff >>> 0, 0, 0, 0, 40), { ...s, y: s.y + 1.5 }, 2.2);
    game.broadcast({ type: S2C.GOBLIN_TOTEM_DESTROYED, x: s.x, y: s.y, z: s.z });
    const text = attacker?.name ? `${attacker.name} destroyed the Goblin Totem!` : 'The Goblin Totem has been destroyed!';
    game.broadcast({ type: S2C.CHAT, text, kind: 'event' });
    console.log(text);
  }

  // A goblin left the world (killed, or fell into the void).
  removed(mob) {
    if (!(mob instanceof GoblinWorker)) return;
    mob.releaseClaim();
    if (this.workers.delete(mob) && this.totemAlive) {
      this.respawns.push(this.game.tick + ticks(GOBLINS.worker.respawnDelay));
      this.respawns.sort((a, b) => a - b);
    }
  }
}
