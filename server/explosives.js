// Explosives: thrown grenades, explosive barrels and the explosions both make
// (tuning in EXPLOSIVES, shared/config.js).
//
// Grenades are projectiles with gravity that bounce off blocks and go off
// when their fuse runs out. Barrels are blocks; lighting one turns it into a
// LitBarrel entity (like Minecraft's primed TNT): it hops, falls, slides and
// gets pushed like a block-sized item, and goes off where it is when its fuse
// ends (lit over the void it falls out of the world and is gone). An
// explosion lights any barrel in its blast with a short chain fuse, flinging
// it away, instead of destroying it.
//
// Explosions push everything loose: players and mobs (knockback), dropped
// items, grenades and lit barrels. A barrel's blast destroys dropped items
// it beats (itemStrength by distance against itemToughness, shared/items.js);
// a grenade's never does. Blocks a blast breaks drop only `dropChance` of the
// time (Minecraft's explosion decay); a broken container's contents always
// drop.
//
// Triggers: anything that should set a barrel off calls ignite(x, y, z,
// { source, seconds }). A lighter (light(), through the block's `ignite`
// kind and IGNITERS) and nearby explosions are the triggers today; pressure
// plates, remote detonators and new ignitable blocks plug in the same way.
// Right clicking a barrel by hand does nothing.
//
// An explosion hurts entities by distance (less through solid blocks), never
// anyone on the same team as whoever set it off (the game's usual friendly
// fire rule), and damages blocks by distance divided by their resistance
// (blastResistance * max(0.5, hardness / 2)). Damage adds up in `damage`
// until a block reaches 1 and breaks like any broken block (drops, container
// contents, attachments), so reinforced walls take several barrels.
// Grenades never damage spike barricades.
import { EXPLOSIVES as X, TICK_RATE, TICK_DT, KNOCKBACK_SPEED, KNOCKBACK_UP } from '../shared/config.js';
import { BLOCK, getBlockDef, isSolid, isLiquid } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { ENTITY_TYPE, S2C, DEATH_CAUSE } from '../shared/protocol.js';
import { raycastBlock, lookDirection } from '../shared/raycast.js';
import { playerBoxOf, eyeHeight, createItemState, stepItem } from '../shared/physics.js';
import { itemToughness } from '../shared/items.js';

const key = (x, y, z) => `${x},${y},${z}`;
const ticks = (seconds) => Math.max(1, Math.round(seconds * TICK_RATE));

// How hard a block is to blow up (Infinity: never).
export function blastResistance(id) {
  const def = getBlockDef(id);
  if (!def.breakable || def.hardness === Infinity || def.blastResistance === Infinity) return Infinity;
  return def.blastResistance * Math.max(0.5, def.hardness / 2);
}

// What lighting each kind of ignitable block (its def's `ignite`) does.
// Add an entry for a new ignitable block. Returns true if something lit.
export const IGNITERS = {
  barrel: (explosives, x, y, z, source) => explosives.ignite(x, y, z, { source }),
};

export class Grenade {
  constructor(id, thrower, x, y, z, vx, vy, vz) {
    this.id = id; this.thrower = thrower;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.fuse = ticks(X.grenade.fuseSeconds);
    this.resting = false;
  }

  solidAt(world, x, y, z) { return isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }

  // One tick of flight: gravity, then each axis in turn, bouncing off
  // whatever it would enter (two substeps so it can't skip a block).
  step(world) {
    const g = X.grenade, r = g.radius;
    this.vy -= g.gravity * TICK_DT;
    for (let sub = 0; sub < 2; sub++) {
      for (const axis of ['x', 'y', 'z']) {
        const v = `v${axis}`, move = this[v] * TICK_DT / 2;
        if (!move) continue;
        const next = { x: this.x, y: this.y, z: this.z };
        next[axis] += move;
        const edge = { ...next }; edge[axis] += Math.sign(move) * r;
        if (!this.solidAt(world, edge.x, edge.y, edge.z)) { this[axis] = next[axis]; continue; }
        if (axis === 'y' && move < 0) {
          // Landing: lose speed to the bounce and to friction along the ground.
          this.vx *= g.friction; this.vz *= g.friction;
          this.vy = Math.abs(this.vy) * g.bounce < 1.2 ? 0 : -this.vy * g.bounce;
        } else this[v] = -this[v] * g.bounce;
      }
    }
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vz) < 0.05) this.vz = 0;
    this.fuse--;
    if (this.y < world.voidY) return 'lost';
    return this.fuse <= 0 ? 'explode' : null;
  }

  describe() { return this.snapshot(); }
  snapshot() {
    return { id: this.id, type: ENTITY_TYPE.GRENADE, item: ITEM.GRENADE, x: this.x, y: this.y, z: this.z,
      vx: this.vx, vy: this.vy, vz: this.vz, fuse: this.fuse };
  }
}

// A lit barrel: a block-sized loose body with a burning fuse.
export const LIT_BARREL_BOX = { halfW: 0.49, height: 0.98 };
export class LitBarrel {
  constructor(id, x, y, z, fuse, source, velocity = {}) {
    this.id = id; this.fuse = fuse; this.source = source;
    this.state = createItemState(x, y, z, velocity.x ?? 0, velocity.y ?? X.barrel.hop, velocity.z ?? 0);
  }
  // 'explode', 'lost' or null.
  step(world) {
    stepItem(this.state, world, LIT_BARREL_BOX);
    if (this.state.y < world.voidY) return 'lost';
    return --this.fuse <= 0 ? 'explode' : null;
  }
  push(vx, vy, vz) { const s = this.state; s.vx += vx; s.vy = Math.max(s.vy, 0) + vy; s.vz += vz; s.onGround = false; }
  describe() { return this.snapshot(); }
  snapshot() {
    const { x, y, z, vx, vy, vz } = this.state;
    return { id: this.id, type: ENTITY_TYPE.LIT_BARREL, x, y, z, vx, vy, vz, fuse: this.fuse };
  }
}

export class Explosives {
  constructor(game) {
    this.game = game;
    this.grenades = new Map();
    // id -> LitBarrel
    this.barrels = new Map();
    // key -> accumulated blast damage (1 breaks the block)
    this.damage = new Map();
  }

  get world() { return this.game.world; }

  // A player throws the grenade in their hand (the `grenade` input).
  throwGrenade(player) {
    const g = X.grenade, game = this.game;
    if (player.dead || player.held() !== ITEM.GRENADE || game.tick < (player.nextThrowTick ?? 0)) return null;
    const s = player.state, dir = lookDirection(s.yaw, s.pitch);
    let start = { x: s.x + dir.x * 0.4, y: s.y + eyeHeight(s) - 0.15, z: s.z + dir.z * 0.4 };
    if (isSolid(this.world.getBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z))))
      start = { x: s.x, y: s.y + eyeHeight(s), z: s.z };
    player.useOne(player.selected);
    player.inventoryDirty = true;
    player.nextThrowTick = game.tick + ticks(g.cooldownSeconds);
    const grenade = new Grenade(game.nextId++, player, start.x, start.y, start.z,
      dir.x * g.throwSpeed, dir.y * g.throwSpeed + g.throwSpeed * g.lift, dir.z * g.throwSpeed);
    this.grenades.set(grenade.id, grenade);
    game.broadcast({ type: S2C.ENTITY_SPAWN, entity: grenade.describe() });
    game.teamProgress?.event(player.team, 'grenadeThrown');
    game.swing?.(player);
    return grenade;
  }

  // Lights the barrel block at x, y, z: it becomes a LitBarrel that goes off
  // after `seconds` (its fuse by default), hopping up, plus `push` (blocks/s)
  // if a blast flung it. True if lit.
  ignite(x, y, z, { source = null, seconds = X.barrel.fuseSeconds, push = null } = {}) {
    const id = this.world.getBlock(x, y, z);
    if (id !== BLOCK.EXPLOSIVE_BARREL && id !== BLOCK.LIT_BARREL) return false;
    this.world.setBlock(x, y, z, BLOCK.AIR);
    this.spawnBarrel(x + 0.5, y, z + 0.5, ticks(seconds), source, push ?? {});
    if (source?.type === 'player') this.game.teamProgress?.event(source.team, 'barrelLit');
    return true;
  }
  spawnBarrel(x, y, z, fuse, source, velocity = {}) {
    const barrel = new LitBarrel(this.game.nextId++, x, y, z, fuse, source, velocity);
    this.barrels.set(barrel.id, barrel);
    this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: barrel.describe() });
    return barrel;
  }

  // A lighter used on the block at x, y, z by `source`. True if it lit.
  light(x, y, z, source = null) {
    const kind = getBlockDef(this.world.getBlock(x, y, z)).ignite;
    return !!kind && !!IGNITERS[kind]?.(this, x, y, z, source);
  }

  // A block changed: forget damage and fuses that no longer apply.
  changed(x, y, z) { this.damage.delete(key(x, y, z)); }

  // Adds blast damage to a block (arrows on spikes use this too); breaks it
  // at 1. True if it broke.
  damageBlock(x, y, z, amount, dropChance = 1) {
    const id = this.world.getBlock(x, y, z);
    if (blastResistance(id) === Infinity || amount <= 0) return false;
    const k = key(x, y, z), total = (this.damage.get(k) ?? 0) + amount;
    if (total < 1 - 1e-9) { this.damage.set(k, total); return false; }
    this.damage.delete(k);
    this.game.breakBlock(x, y, z, null, { dropChance });
    return true;
  }

  // Grenade flight and fuses, and barrels whose time has come. Returns the
  // grenades that moved (their snapshots go to everyone).
  update() {
    const tick = this.game.tick, moving = [];
    for (const grenade of [...this.grenades.values()]) {
      const result = grenade.step(this.world);
      if (!result) { moving.push(grenade); continue; }
      this.grenades.delete(grenade.id);
      this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: grenade.id });
      if (result === 'explode') this.explode(grenade.x, grenade.y, grenade.z, 'grenade', grenade.thrower);
    }
    for (const barrel of [...this.barrels.values()]) {
      const result = barrel.step(this.world);
      if (!result) { moving.push(barrel); continue; }
      this.barrels.delete(barrel.id);
      this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: barrel.id });
      const st = barrel.state;
      if (result === 'explode') this.explode(st.x, st.y + 0.5, st.z, 'barrel', barrel.source);
    }
    return moving;
  }

  snapshots() { return [...this.grenades.values(), ...this.barrels.values()].map((e) => e.snapshot()); }

  // Everything an explosion can hurt.
  *targets() {
    const g = this.game, active = (map) => map.activeValues?.() ?? map.values();
    for (const p of g.players.values()) if (!p.dead && p.connected) yield p;
    for (const map of [g.mobs, g.dragons, g.cows, g.npcs]) if (map) yield* active(map);
    if (g.boss?.status === 'active') yield g.boss;
  }

  // An explosion of `kind` ('grenade' or 'barrel') at x, y, z, set off by
  // `source` (a player, or null).
  explode(x, y, z, kind, source = null) {
    const k = X[kind], game = this.game, world = this.world;
    game.broadcast({ type: S2C.EXPLOSION, x, y, z, radius: k.blastRadius, kind });
    // Entities.
    for (const t of this.targets()) {
      if (t.dead) continue;
      if (source && t.team !== undefined && t.team !== null && t.team === source.team && t !== source) continue;
      if (source && t === source) continue;
      const s = t.state, box = t === game.boss ? { height: 4 } : playerBoxOf(s);
      const cy = s.y + (box.height ?? 1.8) / 2;
      const dx = s.x - x, dy = cy - y, dz = s.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= k.damageRadius) continue;
      let amount = k.damage * (1 - d / k.damageRadius);
      if (d > 0.3) {
        const dir = { x: dx / d, y: dy / d, z: dz / d };
        const hit = raycastBlock(world, { x, y, z }, dir, d, isSolid);
        if (hit && hit.t < d - 0.4) amount *= X.cover;
      }
      amount = Math.round(amount * 10) / 10;
      if (amount < 0.5) continue;
      if (t !== game.boss) {
        const flat = Math.hypot(dx, dz) || 1, push = KNOCKBACK_SPEED * k.knockback * (1 - d / k.damageRadius);
        s.kx = (s.kx ?? 0) + dx / flat * push;
        s.kz = (s.kz ?? 0) + dz / flat * push;
        s.vy = Math.max(s.vy ?? 0, KNOCKBACK_UP * Math.min(1, k.knockback) * (1 - d / k.damageRadius));
        s.onGround = false;
      }
      game.hurt(t, amount, source, DEATH_CAUSE.EXPLOSION);
    }
    // Loose things: dropped items (destroyed if the blast beats them),
    // grenades and lit barrels, all pushed away.
    const fling = (dx, dy, dz, d) => {
      const f = KNOCKBACK_SPEED * k.knockback * (1 - d / k.damageRadius) / (d || 1);
      return { x: dx * f, y: Math.max(0, dy * f) + KNOCKBACK_UP * (1 - d / k.damageRadius), z: dz * f };
    };
    for (const item of [...game.items.values()]) {
      const s = item.state, dx = s.x - x, dy = s.y - y, dz = s.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= k.damageRadius) continue;
      if ((k.itemStrength ?? 0) * (1 - d / k.damageRadius) > itemToughness(item.item)) { game.removeItem(item); continue; }
      const v = fling(dx, dy, dz, d);
      s.vx += v.x; s.vy = Math.max(s.vy, 0) + v.y; s.vz += v.z; s.onGround = false; item.forceSnapshot = true;
    }
    for (const g of this.grenades.values()) {
      const dx = g.x - x, dy = g.y - y, dz = g.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= k.damageRadius || d < 1e-6) continue;
      const v = fling(dx, dy, dz, d); g.vx += v.x; g.vy += v.y; g.vz += v.z;
    }
    for (const b of this.barrels.values()) {
      const s = b.state, dx = s.x - x, dy = s.y + 0.5 - y, dz = s.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= k.damageRadius) continue;
      const v = fling(dx, dy, dz, d); b.push(v.x, v.y, v.z);
    }
    // Blocks.
    const reach = Math.ceil(k.blastRadius), cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    let budget = X.maxBlocks;
    for (let bx = cx - reach; bx <= cx + reach && budget > 0; bx++)
      for (let by = cy - reach; by <= cy + reach && budget > 0; by++)
        for (let bz = cz - reach; bz <= cz + reach && budget > 0; bz++) {
          const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
          if (d >= k.blastRadius) continue;
          const id = world.getBlock(bx, by, bz);
          if (id === BLOCK.AIR || isLiquid(id) || id === BLOCK.LIT_BARREL) continue;
          budget--;
          if (id === BLOCK.EXPLOSIVE_BARREL) {
            // Lit with a short fuse and flung away from the blast.
            const [lo, hi] = X.barrel.chainFuseSeconds, dx = bx + 0.5 - x, dz = bz + 0.5 - z, flat = Math.hypot(dx, dz) || 1;
            const f = X.barrel.chainPush * (1 - d / k.blastRadius);
            this.ignite(bx, by, bz, { source, seconds: lo + Math.random() * (hi - lo),
              push: { x: dx / flat * f, y: X.barrel.chainLift * (1 - d / k.blastRadius) + X.barrel.hop, z: dz / flat * f } });
            continue;
          }
          if (kind === 'grenade' && id === BLOCK.SPIKE_BARRICADE) continue;
          const resistance = blastResistance(id);
          if (resistance === Infinity) continue;
          this.damageBlock(bx, by, bz, k.power * (1 - d / k.blastRadius) / resistance, k.dropChance ?? 1);
        }
  }

  save() {
    return { barrels: [...this.barrels.values()].map((b) => { const t = b.state; return [t.x, t.y, t.z, t.vx, t.vy, t.vz, b.fuse]; }),
      damage: [...this.damage] };
  }
  load(data) {
    for (const [x, y, z, vx, vy, vz, fuse] of data?.barrels ?? []) this.spawnBarrel(x, y, z, Math.max(1, fuse), null, { x: vx, y: vy, z: vz });
    for (const [k, v] of data?.damage ?? []) this.damage.set(k, v);
    // Saves from before lit barrels were entities: their lit barrel blocks
    // (with or without a saved timer) become lit barrels again.
    const left = new Map((data?.lit ?? []).map(([x, y, z, t]) => [key(x, y, z), t]));
    for (const [k] of [...(this.game.blockChanges ?? [])]) {
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) !== BLOCK.LIT_BARREL) continue;
      this.world.setBlock(x, y, z, BLOCK.AIR);
      this.spawnBarrel(x + 0.5, y, z + 0.5, left.get(k) ?? ticks(X.barrel.fuseSeconds), null, { y: 0 });
    }
  }
}
