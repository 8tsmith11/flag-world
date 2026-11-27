// Fishing, server side (rules and tables in shared/fishing.js, tuning in
// FISHING). Everything is decided here: casting, where the bobber ends up,
// bait, bites, catches and rewards. Clients only see bobber snapshots.
//
// A cast throws a bobber (players along their aim; Fisherman monkeys a
// short way out in their configured direction). It falls under gravity
// until it reaches water or lava (it then floats on the surface), the real
// void (FISHING.voidBelowIslands below the lowest island's underside; not
// the air just under an island), solid ground (no fishing), or FISHING.maxLine
// from where it was cast (it hangs there; no fishing). Bobbers live in their
// own map, so nothing that clears entities in the void removes them.
//
// When it settles somewhere its rod can fish, the attempt starts: the owner
// must still have bait (a player's chosen bait, a monkey's carried bait),
// Bait Conservation is rolled once (on success the bait is kept), and a bite
// is scheduled after biteSeconds(). A bite lasts FISHING.window: a player
// who reels in during it always catches something; reeling in before it, or
// letting it pass, catches nothing (the bait is gone either way). Monkeys
// reel in at once and never miss. A settled bobber nowhere fishable never
// takes bait.
import { FISHING as F, TICK_RATE, TICK_DT, EEL_BAND } from '../shared/config.js';
import { isSolid, isWater, isLava, isLiquid } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { getItemDef } from '../shared/items.js';
import { ENTITY_TYPE, S2C } from '../shared/protocol.js';
import { rollMods } from '../shared/modifiers.js';
import { rodStats, BAIT, BAIT_ITEMS, biteSeconds, lootTableFor, rollCatch, ENVIRONMENT_NAMES } from '../shared/fishing.js';
import { lookDirection } from '../shared/raycast.js';
import { eyeHeight } from '../shared/physics.js';
import { FACING_DIRS } from '../shared/blocks.js';
import { VoidEel } from './eel.js';

const ticks = (seconds) => Math.max(1, Math.round(seconds * TICK_RATE));

export class Bobber {
  constructor(id, owner, x, y, z, vx, vy, vz, monkey) {
    this.id = id; this.owner = owner; this.monkey = monkey;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.origin = { x, y, z };
    // flying, then settled: 'water' | 'lava' | 'void' | 'ground' | 'hanging'.
    this.where = null;
    this.attempt = null;      // { luck, biteAt, biteUntil } while waiting or biting
    this.bite = false;
    this.moved = true;
  }

  get flying() { return this.where === null; }

  // One tick of flight. Returns true once it has settled.
  step(world, voidY) {
    if (!this.flying) return false;
    this.vy = Math.max(-F.maxFall, this.vy - F.gravity * TICK_DT);
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy, this.vz) * TICK_DT / 0.4));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx * TICK_DT / steps, ny = this.y + this.vy * TICK_DT / steps, nz = this.z + this.vz * TICK_DT / steps;
      const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (isWater(id) || isLava(id)) {
        // Float on top of the liquid column.
        let top = Math.floor(ny);
        while (isLiquid(world.getBlock(Math.floor(nx), top + 1, Math.floor(nz)))) top++;
        Object.assign(this, { x: nx, y: top + 1.02, z: nz, vx: 0, vy: 0, vz: 0, where: isLava(id) ? 'lava' : 'water' });
        return true;
      }
      if (isSolid(id)) {
        // Hit something: sideways it slides down, landing it rests.
        if (this.vy < 0 && isSolid(world.getBlock(Math.floor(this.x), Math.floor(ny), Math.floor(this.z)))) {
          Object.assign(this, { y: Math.floor(ny) + 1.05, vx: 0, vy: 0, vz: 0, where: 'ground' });
          return true;
        }
        this.vx = 0; this.vz = 0;
        continue;
      }
      this.x = nx; this.y = ny; this.z = nz;
      if (this.y <= voidY) { Object.assign(this, { y: voidY, vx: 0, vy: 0, vz: 0, where: 'void' }); return true; }
      const o = this.origin;
      if (Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) >= F.maxLine) {
        Object.assign(this, { vx: 0, vy: 0, vz: 0, where: 'hanging' });
        return true;
      }
    }
    return false;
  }

  describe() { return this.snapshot(); }
  snapshot() {
    return { id: this.id, type: ENTITY_TYPE.BOBBER, owner: this.owner.id, x: this.x, y: this.y, z: this.z,
      where: this.where, bite: this.bite };
  }
}

export class Fishing {
  constructor(game) {
    this.game = game;
    this.bobbers = new Map();
  }

  get world() { return this.game.world; }

  // How low a bobber must get to be fishing in the void.
  voidY() {
    const lowest = Math.min(...(this.world.islands ?? []).map((i) => i.bottomY));
    const y = Number.isFinite(lowest) ? lowest - F.voidBelowIslands : this.world.voidY + EEL_BAND.aboveVoid;
    return Math.max(y, this.world.voidY + 2);
  }

  bobberOf(owner) { for (const b of this.bobbers.values()) if (b.owner === owner) return b; return null; }

  spawn(owner, x, y, z, vx, vy, vz, monkey) {
    const bobber = new Bobber(this.game.nextId++, owner, x, y, z, vx, vy, vz, monkey);
    this.bobbers.set(bobber.id, bobber);
    this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: bobber.describe() });
    return bobber;
  }

  remove(bobber) {
    if (!this.bobbers.delete(bobber.id)) return;
    this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: bobber.id });
  }

  // The bait a player would use: their chosen bait, if they have any of it.
  // { item } or { error }.
  playerBait(player) {
    const choice = player.inventory.bait;
    if (!choice || !BAIT[choice]) return { error: 'Choose bait first: right click your fishing rod in your inventory.' };
    if (!player.inventory.slots.some((s) => s?.item === choice && !s.mods?.length))
      return { error: `You have no ${getItemDef(choice).name} for bait.` };
    return { item: choice };
  }

  // The bait a monkey carries (whatever compatible bait it holds first).
  monkeyBait(m) {
    for (const s of m.inventory.slots) if (s && BAIT[s.item] && !s.mods?.length) return s.item;
    return null;
  }

  notify(owner, text) { if (!owner.npc) this.game.send(owner, { type: S2C.NOTICE, text, kind: 'info' }); }

  // A player's right click with a rod: cast, or reel in what is out.
  use(player) {
    const tick = this.game.tick;
    if (player.dead || tick < (player.nextReelTick ?? 0)) return;
    player.nextReelTick = tick + ticks(F.reelCooldown);
    const out = this.bobberOf(player);
    if (out) { this.reel(out); return; }
    const rod = player.inventory.get(player.selected);
    const stats = rodStats(rod);
    if (!stats) return;
    const bait = this.playerBait(player);
    if (bait.error) { this.notify(player, bait.error); return; }
    const s = player.state, dir = lookDirection(s.yaw, s.pitch);
    const start = { x: s.x + dir.x * 0.5, y: s.y + eyeHeight(s) - 0.1, z: s.z + dir.z * 0.5 };
    if (isSolid(this.world.getBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)))) Object.assign(start, { x: s.x, z: s.z });
    this.spawn(player, start.x, start.y, start.z, dir.x * F.castSpeed, dir.y * F.castSpeed + F.castSpeed * F.castLift, dir.z * F.castSpeed, false);
    this.game.swing?.(player);
  }

  // Where a monkey standing at `spot` (the block it stands on) casting in
  // direction `dir` would fish: 'water' | 'lava' | 'void' | null. The
  // bobber drops straight down about one block out.
  castTarget(spot, dir) {
    const [dx, dz] = FACING_DIRS[dir] ?? FACING_DIRS[0];
    const x = spot.x + dx, z = spot.z + dz, voidY = this.voidY();
    for (let y = spot.y + 1; y > voidY; y--) {
      const id = this.world.getBlock(x, y, z);
      if (isWater(id)) return 'water';
      if (isLava(id)) return 'lava';
      if (isSolid(id)) return null;
      if (spot.y + 1 - y > F.maxLine) return null;
    }
    return 'void';
  }

  // A Fisherman monkey casts (its worker checked the spot first).
  monkeyCast(m, dir) {
    if (this.bobberOf(m)) return null;
    const [dx, dz] = FACING_DIRS[dir] ?? FACING_DIRS[0];
    const s = m.state;
    return this.spawn(m, s.x + dx * 0.4, s.y + 1.2, s.z + dz * 0.4, dx * F.monkeyCastSpeed, 2, dz * F.monkeyCastSpeed, true);
  }

  // The bobber settled: start an attempt if its rod can fish there and its
  // owner has bait (rolling Bait Conservation once).
  settle(bobber) {
    const owner = bobber.owner;
    const stats = rodStats(bobber.monkey ? owner.gear?.[0] : owner.inventory.get(owner.selected));
    const where = bobber.where;
    if (!stats || !stats.environments.includes(where)) {
      if (!bobber.monkey) this.notify(owner, where === 'ground' ? 'Nothing to catch there.'
        : where === 'hanging' ? 'Your line ran out before it reached anything.'
          : stats ? `This rod can't fish in ${ENVIRONMENT_NAMES[where] ?? where}.` : 'Nothing to catch there.');
      return;
    }
    const baitItem = bobber.monkey ? this.monkeyBait(owner) : this.playerBait(owner).item;
    if (!baitItem) { if (!bobber.monkey) this.notify(owner, this.playerBait(owner).error); return; }
    const kept = Math.random() < stats.conservation;
    if (!kept) {
      if (bobber.monkey) owner.inventory.remove(baitItem, 1);
      else { owner.inventory.remove(baitItem, 1); owner.inventoryDirty = true; }
    }
    const wait = biteSeconds(Math.random, stats.speed, bobber.monkey);
    bobber.attempt = { luck: stats.multiplier * BAIT[baitItem].quality, tier: stats.tier, where, kept, bait: baitItem,
      biteAt: this.game.tick + ticks(wait), biteUntil: null };
  }

  // Reeling in: a catch if something is biting, otherwise nothing.
  reel(bobber) {
    const attempt = bobber.attempt;
    if (attempt && bobber.bite) this.catchFish(bobber, attempt);
    this.remove(bobber);
  }

  // One catch for the bobber's owner: an item into their inventory (the
  // rest dropped at their feet) or a Void Eel next to the bobber.
  catchFish(bobber, attempt) {
    const game = this.game, owner = bobber.owner, team = owner.team;
    bobber.attempt = null; bobber.bite = false;
    const table = lootTableFor(attempt.where, attempt.tier);
    if (!table) return null;
    const result = rollCatch(table, attempt.luck, Math.random, rollMods);
    game.teamProgress?.event(team, `fishCaught:${attempt.where}`);
    if (bobber.monkey) game.teamProgress?.event(team, 'monkeyFished');
    if (result.encounter === 'voidEel') {
      const eel = new VoidEel(game.nextId++, game.eelBand(), { x: bobber.x, y: bobber.y, z: bobber.z });
      game.mobs.set(eel.id, eel);
      game.broadcast({ type: S2C.ENTITY_SPAWN, entity: eel.describe() });
      game.teamProgress?.event(team, 'fishedEel');
      if (!bobber.monkey) this.notify(owner, 'Something huge took the bait... a Void Eel!');
      else game.teamNotice?.(team, `${owner.name} hooked a Void Eel!`, 'danger');
      return result;
    }
    const stack = result.stack;
    if (bobber.monkey) game.monkeys?.store(owner, stack);
    else {
      const left = owner.inventory.add(stack.item, stack.count, stack.mods ?? null);
      if (left > 0) game.spawnItem(stack.item, left, owner.state.x, owner.state.y + 1, owner.state.z, 0, 2, 0, 0, stack.mods ?? null);
      owner.inventoryDirty = true;
    }
    return result;
  }

  // Each tick: flight, settling, bites, escapes and owners who left.
  update() {
    const tick = this.game.tick, voidY = this.voidY(), moved = [];
    for (const bobber of [...this.bobbers.values()]) {
      const owner = bobber.owner;
      // An owner who left, died, put the rod away or wandered off takes it back.
      const gone = owner.dead || owner.connected === false
        || (bobber.monkey ? !this.game.npcs.has(owner.id) || owner.config?.role !== 'fisherman' || !rodStats(owner.gear?.[0])
          : !rodStats(owner.inventory.get(owner.selected)))
        || Math.hypot(owner.state.x - bobber.origin.x, owner.state.z - bobber.origin.z) > 24;
      if (gone) { this.remove(bobber); continue; }
      const before = JSON.stringify([bobber.x, bobber.y, bobber.z, bobber.where, bobber.bite]);
      if (bobber.step(this.world, voidY)) this.settle(bobber);
      const a = bobber.attempt;
      if (a) {
        if (!bobber.bite && tick >= a.biteAt) {
          if (bobber.monkey) { this.catchFish(bobber, a); this.remove(bobber); continue; }
          bobber.bite = true; a.biteUntil = tick + ticks(F.window);
        } else if (bobber.bite && tick >= a.biteUntil) {
          // It got away: the attempt is over.
          bobber.bite = false; bobber.attempt = null;
        }
      }
      if (JSON.stringify([bobber.x, bobber.y, bobber.z, bobber.where, bobber.bite]) !== before) moved.push(bobber);
    }
    return moved;
  }

  snapshots() { return [...this.bobbers.values()].map((b) => b.snapshot()); }
}
