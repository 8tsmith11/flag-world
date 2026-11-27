// Full-match checks for the explosives and defensive infrastructure update:
// sulfur farming (renewable, farmer monkeys), sulfur seed sources (merchant
// and loot), gunpowder and grenades from craftsman monkeys, grenade flight
// and explosions, explosive barrels (fuse, falling when lit, chain reactions, structural damage,
// reinforced walls), spike barricades (geometry, contact, breaking, arrows,
// teams), steam-powered drawbridges (lengths, directions, steam, obstruction,
// broken sections, no duplication, pathfinding) and what reaches clients.
// Everything happens on platforms built in the sky of a small world (seed 2).
//   node scripts/explosives-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS, S2C, C2S, ENTITY_TYPE } from '../shared/protocol.js';
import { drawbridgeCell } from '../shared/drawbridge.js';
import { BLOCK, CROPS, getBlockDef, blockDrops, FACING_DIRS } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { TICK_RATE, EXPLOSIVES as X, SPIKES as SP, DRAWBRIDGE as DB, FARMING } from '../shared/config.js';
import { getRecipe, RECIPES } from '../shared/recipes.js';
import { MERCHANT_SELLS } from '../shared/merchant.js';
import { rollLoot, LOOT_TABLES } from '../shared/loot.js';
import { SPIKE_PARTS, SPIKE_DIRECTIONS } from '../shared/spikeGeometry.js';
import { defaultMonkeyConfig } from '../shared/monkeys.js';
import { WorkMonkey } from '../server/monkeyWorkers.js';
import { Chest } from '../server/containers.js';
import { blastResistance } from '../server/explosives.js';
import { findPath } from '../server/pathfind.js';

const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 4;
const sent = new Map();
const socketFor = (id) => ({ readyState: 1, send: (data) => { const msg = JSON.parse(data); (sent.get(id) ?? sent.set(id, []).get(id)).push(msg); } });
const sessions = new Map();
for (const [id, team] of [[1, 0], [2, 1], [3, 0]]) {
  const session = { socket: socketFor(id), creative: false, localHost: true };
  sessions.set(id, session);
  game.members.set(id, { id, name: `Test ${id}`, team, color: TEAMS[team].color, ready: true, session });
}
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '2' });
console.log = log;
for (const id of [1, 2, 3]) sessions.get(id).player = game.players.get(id);
const world = game.world, host = game.players.get(1), enemy = game.players.get(2), mate = game.players.get(3);
const messages = (id, type) => (sent.get(id) ?? []).filter((m) => m.type === type);
// A 64x64 stone platform high in the sky.
const ox = Math.floor(host.state.x) - 32, oz = Math.floor(host.state.z) - 32, Y = world.sizeY - 30;
for (let x = ox; x < ox + 64; x++) for (let z = oz; z < oz + 64; z++) world.setBlock(x, Y, z, BLOCK.STONE);
const at = (dx, dz, dy = 1) => ({ x: ox + dx, y: Y + dy, z: oz + dz });
const stand = (who, dx, dz) => Object.assign(who.state, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0 });
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };
const heal = (...who) => { for (const p of who) { p.hp = p.maxHp(); p.dead = false; p.invulnerableUntilTick = 0; } };
const park = (who, dx, dz) => { stand(who, dx, dz); heal(who); };
park(host, 2, 2); park(enemy, 60, 60); park(mate, 60, 2);
run(3);
const count = (p, item) => p.inventory.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
const monkey = (dx, dz, config) => {
  const m = new WorkMonkey(game.nextId++, game.monkeys, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5 });
  m.team = host.team; m.status = 'Ready';
  game.npcs.set(m.id, m);
  game.monkeys.applyConfig(m, { ...defaultMonkeyConfig(), ...config });
  return m;
};
const chestAt = (p) => { world.setBlock(p.x, p.y, p.z, BLOCK.CHEST); const c = new Chest(); world.tileEntities.set(`${p.x},${p.y},${p.z}`, c); return c; };
const chestCount = (c, item) => c.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
const clear = (x0, z0, x1, z1, y0 = 1, y1 = 4) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) world.setBlock(ox + x, Y + y, oz + z, BLOCK.AIR); };

// ---- Sulfur: sources, crop data ----
{
  assert.ok(MERCHANT_SELLS.some((o) => o.item === ITEM.SULFUR_SEEDS), 'the merchant does not sell sulfur seeds');
  let found = false;
  for (let seed = 0; seed < 400 && !found; seed++) found = rollLoot('tinyIsland', seed, 0, 0, 0).some((s) => s?.item === ITEM.SULFUR_SEEDS);
  assert.ok(found, 'sulfur seeds never turn up in loot');
  assert.equal(getItemDef(ITEM.SULFUR_SEEDS).crop, 'sulfur');
  // Never wild: nothing in the generated world is a sulfur plant.
  for (const chunk of world.chunks.values()) for (const id of CROPS.sulfur.stages) assert.ok(!chunk.blocks.includes(id), 'sulfur grows wild');
  // Mature plants give sulfur and at least one seed back: renewable.
  const drops = blockDrops(CROPS.sulfur.stages[3], () => 0);
  assert.ok(drops.some((d) => d.item === ITEM.SULFUR) && drops.find((d) => d.item === ITEM.SULFUR_SEEDS).count >= FARMING.matureSeeds[0]);
  assert.ok(FARMING.matureSeeds[0] >= 1, 'a harvest can give no seeds back');
  assert.ok(getBlockDef(CROPS.sulfur.stages[3]).plantArt.startsWith('sulfur'));
}

// ---- A sulfur farm run by a farmer monkey, from two seeds ----
{
  // Three farmland plots: one planted mature, two bare; the farmer has two seeds.
  for (let x = 10; x <= 12; x++) world.setBlock(ox + x, Y, oz + 10, BLOCK.FARMLAND);
  world.setBlock(ox + 10, Y + 1, oz + 10, CROPS.sulfur.stages[3]);
  const out = chestAt(at(8, 10));
  const m = monkey(9, 10, { role: 'farmer', cornerA: at(10, 10, 0), cornerB: at(12, 10, 0), dests: [at(8, 10)] });
  m.inventory.add(ITEM.SULFUR_SEEDS, 2);
  const planted = () => [10, 11, 12].every((x) => CROPS.sulfur.stages.includes(world.getBlock(ox + x, Y + 1, oz + 10)));
  run(TICK_RATE * 60, planted);
  assert.ok(planted(), 'the farmer did not plant sulfur on every plot');
  // Grow everything (the growth timers, fast-forwarded) a few times over.
  let harvests = 0;
  for (let round = 0; round < 3; round++) {
    for (let stage = 0; stage < 4; stage++) { for (const e of game.farming.crops.values()) e.due = game.tick; run(2); }
    run(TICK_RATE * 40, () => [10, 11, 12].every((x) => world.getBlock(ox + x, Y + 1, oz + 10) === CROPS.sulfur.stages[0]) && chestCount(out, ITEM.SULFUR) > harvests);
    harvests = chestCount(out, ITEM.SULFUR);
  }
  assert.ok(harvests >= 6, `only ${harvests} sulfur after three harvests of three plants`);
  assert.ok([10, 11, 12].every((x) => CROPS.sulfur.stages.includes(world.getBlock(ox + x, Y + 1, oz + 10))), 'the farm ran out of seeds');
  game.npcs.delete(m.id);
}

// ---- Gunpowder and grenades from a craftsman monkey ----
{
  const gunpowder = getRecipe('gunpowder'), grenade = getRecipe('grenade');
  assert.deepEqual(gunpowder.inputs.map((i) => i.item).sort(), [ITEM.CHARCOAL, ITEM.SULFUR].sort());
  assert.ok(grenade.inputs.some((i) => i.item === ITEM.GUNPOWDER) && getRecipe('explosive_barrel').inputs.some((i) => i.item === ITEM.GUNPOWDER));
  assert.ok(getItemDef(ITEM.GUNPOWDER).maxStack > 1 && getItemDef(ITEM.GRENADE).maxStack > 1);
  const src = chestAt(at(20, 20)), dst = chestAt(at(26, 20));
  world.setBlock(ox + 23, Y + 1, oz + 22, BLOCK.WORKBENCH);
  src.slots[0] = { item: ITEM.SULFUR, count: 6 }; src.slots[1] = { item: ITEM.CHARCOAL, count: 6 };
  const m = monkey(23, 20, { role: 'craftsman', sources: [at(20, 20)], dests: [at(26, 20)], workbench: at(23, 22), recipe: 'gunpowder' });
  run(TICK_RATE * 90, () => chestCount(dst, ITEM.GUNPOWDER) >= 12);
  assert.equal(chestCount(dst, ITEM.GUNPOWDER), 12, 'the craftsman did not make gunpowder from all the sulfur');
  // Then grenades from that gunpowder (and copper).
  src.slots[0] = { item: ITEM.GUNPOWDER, count: 8 }; src.slots[1] = { item: ITEM.COPPER_INGOT, count: 4 };
  game.monkeys.applyConfig(m, { ...m.config, recipe: 'grenade' });
  run(TICK_RATE * 90, () => chestCount(dst, ITEM.GRENADE) >= 8);
  assert.equal(chestCount(dst, ITEM.GRENADE), 8, 'the craftsman did not make grenades');
  game.npcs.delete(m.id);
  clear(18, 18, 28, 24);
}

// ---- Grenades: thrown, bounce, fuse, explode for everyone ----
const { Crawler } = await import('../server/crawler.js');
const spawnCrawler = (dx, dz) => { const c = new Crawler(game.nextId++, ox + dx + 0.5, Y + 1, oz + dz + 0.5); game.mobs.set(c.id, c); return c; };
{
  park(host, 32, 32);
  host.state.yaw = -Math.PI / 2; host.state.pitch = 0.3;          // east, a little up
  host.inventory.slots[host.selected] = { item: ITEM.GRENADE, count: 2 };
  sent.clear();
  const g = game.explosives.throwGrenade(host);
  assert.ok(g, 'could not throw a grenade');
  assert.equal(count(host, ITEM.GRENADE), 1, 'the grenade was not used up');
  assert.equal(game.explosives.throwGrenade(host), null, 'threw again inside the cooldown');
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.ENTITY_SPAWN).some((m) => m.entity.type === ENTITY_TYPE.GRENADE), `player ${id} did not see the grenade`);
  const startY = g.y;
  let peak = g.y, landed = false, moves = 0;
  run(Math.round(X.grenade.fuseSeconds * TICK_RATE) - 2, () => {
    peak = Math.max(peak, g.y); moves += messages(2, S2C.STATE).at(-1)?.entities.some((e) => e.id === g.id) ? 1 : 0;
    if (g.vy === 0 && Math.abs(g.y - (Y + 1 + X.grenade.radius)) < 0.2) landed = true;
    return false;
  });
  assert.ok(peak > startY + 0.3 && landed, `the grenade did not arc and land (peak ${peak - startY}, landed ${landed})`);
  assert.ok(g.x > host.state.x + 3, 'the grenade did not fly forward');
  assert.ok(moves > 5, 'grenade positions were not sent');
  run(5);
  assert.ok(!game.explosives.grenades.has(g.id), 'the grenade never went off');
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.EXPLOSION).some((m) => m.kind === 'grenade'), `player ${id} did not see the explosion`);
}
{
  // Damage falls with distance; the thrower's team is spared; creatures are hurt.
  const c = { x: ox + 40.5, y: Y + 1.3, z: oz + 40.5 };
  park(enemy, 41, 40); park(mate, 40, 41);
  const far = spawnCrawler(43, 40);
  const near0 = enemy.hp, far0 = far.hp;
  game.explosives.explode(c.x, c.y, c.z, 'grenade', host);
  const nearLoss = near0 - enemy.hp, farLoss = far0 - far.hp;
  assert.ok(nearLoss > 4, `a grenade a block away did ${nearLoss} damage`);
  assert.ok(farLoss > 0 && farLoss < nearLoss, `damage did not fall off with distance (${nearLoss} near, ${farLoss} farther)`);
  assert.equal(mate.hp, mate.maxHp(), 'the grenade hurt the thrower\'s teammate');
  assert.ok(enemy.state.kx > 0, 'no knockback away from the blast');
  game.removeMob?.(far); game.mobs.delete(far.id);
  heal(enemy); park(enemy, 60, 60); park(mate, 60, 2);
}
{
  // Grenades break soft blocks only, and never spikes.
  const p = at(36, 50);
  world.setBlock(p.x + 1, p.y, p.z, BLOCK.PLANKS); world.setBlock(p.x - 1, p.y, p.z, BLOCK.STONE);
  world.setBlock(p.x, p.y, p.z + 1, BLOCK.REINFORCED_WALL); world.setBlock(p.x, p.y, p.z - 1, BLOCK.SPIKE_BARRICADE);
  game.explosives.explode(p.x + 0.5, p.y + 0.5, p.z + 0.5, 'grenade', null);
  assert.equal(world.getBlock(p.x + 1, p.y, p.z), BLOCK.AIR, 'a grenade did not break planks next to it');
  assert.equal(world.getBlock(p.x - 1, p.y, p.z), BLOCK.STONE, 'a grenade broke stone');
  assert.equal(world.getBlock(p.x, p.y, p.z + 1), BLOCK.REINFORCED_WALL);
  assert.equal(world.getBlock(p.x, p.y, p.z - 1), BLOCK.SPIKE_BARRICADE, 'a grenade broke a spike barricade');
  assert.ok(!game.explosives.damage.has(`${p.x},${p.y},${p.z - 1}`), 'a grenade damaged a spike barricade');
  clear(34, 48, 38, 52);
}

// ---- Explosive barrels ----
const barrelAt = (dx, dz) => { const p = at(dx, dz); world.setBlock(p.x, p.y, p.z, BLOCK.EXPLOSIVE_BARREL); return p; };
const fuse = Math.round(X.barrel.fuseSeconds * TICK_RATE);
{
  // Only a lighter lights one: an empty hand or anything else does nothing.
  const p = barrelAt(50, 10);
  park(host, 48, 10);
  host.inventory.slots[host.selected] = null;
  game.stepUse(host, p);
  host.inventory.slots[host.selected] = { item: ITEM.GUNPOWDER, count: 3 };
  game.stepUse(host, p);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.EXPLOSIVE_BARREL, 'a barrel was lit without a lighter');
  const lighter = getRecipe('lighter');
  assert.deepEqual(lighter.inputs.map((i) => [i.item, i.count]).sort(), [[ITEM.GUNPOWDER, 1], [ITEM.IRON_INGOT, 1]].sort());
  assert.equal(getItemDef(ITEM.LIGHTER).tool, 'lighter');
  // A lighter lights it: visible to everyone, can't be broken, goes off
  // after its fuse. The lighter is not used up.
  host.inventory.slots[host.selected] = { item: ITEM.LIGHTER, count: 1 };
  sent.clear();
  game.stepUse(host, p);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.LIT_BARREL, 'the lighter did not light the barrel');
  assert.deepEqual(host.inventory.slots[host.selected], { item: ITEM.LIGHTER, count: 1 }, 'the lighter was used up or worn');
  game.stepUse(host, at(51, 11, 0));
  assert.equal(world.getBlock(ox + 51, Y, oz + 11), BLOCK.STONE, 'the lighter did something to stone');
  run(1);
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.BLOCK_CHANGES).some((m) => m.changes.some((c) => c.x === p.x && c.id === BLOCK.LIT_BARREL)), `player ${id} was not shown the lit fuse`);
  assert.equal(getBlockDef(BLOCK.LIT_BARREL).breakable, false);
  run(fuse - 3);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.LIT_BARREL, 'the barrel went off early');
  run(4);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.AIR, 'the barrel did not go off');
  assert.ok(messages(2, S2C.EXPLOSION).some((m) => m.kind === 'barrel'));
  park(host, 2, 2);
  // An unlit barrel breaks into its item.
  const q = barrelAt(52, 14), before = game.items.size;
  game.breakBlock(q.x, q.y, q.z);
  assert.ok([...game.items.values()].slice(before).some((i) => i.item === BLOCK.EXPLOSIVE_BARREL || i.stack?.item === BLOCK.EXPLOSIVE_BARREL)
    || [...game.items.values()].some((i) => (i.item ?? i.stack?.item) === BLOCK.EXPLOSIVE_BARREL), 'breaking an unlit barrel lost it');
}
{
  // Structure: stone near a barrel goes, stone bricks only crack, reinforced walls
  // hold for longer; much more than a grenade does.
  const p = at(50, 20);
  const wallAt = (dx, id) => world.setBlock(p.x + dx, p.y, p.z, id);
  wallAt(-2, BLOCK.STONE); wallAt(2, BLOCK.STONE_BRICKS); world.setBlock(p.x, p.y, p.z + 2, BLOCK.REINFORCED_WALL);
  world.setBlock(p.x, p.y, p.z - 3, BLOCK.STONE);
  const boom = () => { world.setBlock(p.x, p.y, p.z, BLOCK.EXPLOSIVE_BARREL); game.explosives.ignite(p.x, p.y, p.z, { seconds: 0.05 }); run(3); };
  boom();
  assert.equal(world.getBlock(p.x - 2, p.y, p.z), BLOCK.AIR, 'a barrel did not break stone two blocks away');
  assert.equal(world.getBlock(p.x, p.y, p.z - 3), BLOCK.AIR, 'a barrel did not break stone three blocks away');
  assert.equal(world.getBlock(p.x + 2, p.y, p.z), BLOCK.STONE_BRICKS, 'one barrel broke stone bricks two blocks away');
  assert.equal(world.getBlock(p.x, p.y, p.z + 2), BLOCK.REINFORCED_WALL);
  const brick = game.explosives.damage.get(`${p.x + 2},${p.y},${p.z}`) ?? 0, wall = game.explosives.damage.get(`${p.x},${p.y},${p.z + 2}`) ?? 0;
  assert.ok(brick > 0 && wall > 0 && wall < brick, `reinforced walls are not more blast resistant (bricks ${brick}, wall ${wall})`);
  assert.ok(blastResistance(BLOCK.REINFORCED_WALL) >= 2 * blastResistance(BLOCK.STONE_BRICKS) && blastResistance(BLOCK.STONE_BRICKS) > blastResistance(BLOCK.STONE));
  let barrels = 1;
  while (world.getBlock(p.x + 2, p.y, p.z) === BLOCK.STONE_BRICKS && barrels < 10) { boom(); barrels++; }
  const brickBarrels = barrels;
  while (world.getBlock(p.x, p.y, p.z + 2) === BLOCK.REINFORCED_WALL && barrels < 30) { boom(); barrels++; }
  assert.ok(brickBarrels >= 2 && barrels > brickBarrels && barrels < 30, `stone bricks took ${brickBarrels} barrels, the reinforced wall ${barrels}`);
  // Unbreakable blocks never go.
  world.setBlock(p.x + 1, p.y, p.z, BLOCK.SHRINE_BRICKS); boom();
  assert.equal(world.getBlock(p.x + 1, p.y, p.z), BLOCK.SHRINE_BRICKS);
  world.setBlock(p.x + 1, p.y, p.z, BLOCK.AIR);
  // The floor under the blast is gone: patch it.
  for (let x = ox + 40; x < ox + 64; x++) for (let z = oz; z < oz + 30; z++) if (world.getBlock(x, Y, z) === BLOCK.AIR) world.setBlock(x, Y, z, BLOCK.STONE);
  clear(40, 4, 63, 29, 1, 5);
}
{
  // Chain reaction: each barrel caught in a blast gets a short fuse instead of
  // going off at once; the same setup always goes the same way.
  const chain = () => {
    // On unbreakable blocks, so a lit barrel doesn't fall through the blasted floor.
    const ps = [0, 3, 6, 9].map((d) => { const p = barrelAt(44 + d, 26); world.setBlock(p.x, p.y - 1, p.z, BLOCK.SHRINE_BRICKS); return p; });
    sent.clear();
    game.explosives.ignite(ps[0].x, ps[0].y, ps[0].z, { seconds: 0.05 });
    const times = [];
    run(TICK_RATE * 8, () => {
      const n = messages(1, S2C.EXPLOSION).length;
      while (times.length < n) times.push(game.tick);
      // (Lit, it may be falling: the blast can take the floor out from under it.)
      if (times.length === 1) for (const q of ps.slice(1, 2))
        assert.ok([...game.explosives.lit.values()].some((e) => e.x === q.x && e.z === q.z), 'the next barrel was not lit by the blast');
      return n >= 4;
    });
    for (let x = ox + 40; x < ox + 64; x++) for (let z = oz + 20; z < oz + 32; z++)
      if (world.getBlock(x, Y, z) === BLOCK.AIR || world.getBlock(x, Y, z) === BLOCK.SHRINE_BRICKS) world.setBlock(x, Y, z, BLOCK.STONE);
    clear(40, 20, 63, 31, 1, 5);
    return times;
  };
  const a = chain(), b = chain();
  assert.equal(a.length, 4, `only ${a.length} of 4 barrels went off`);
  assert.equal(b.length, 4);
  const minGap = Math.round(X.barrel.chainFuseSeconds[0] * TICK_RATE) - 1;
  for (const times of [a, b]) for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= minGap, `barrels went off together (${times})`);
}

// ---- Spike barricades ----
{
  // Geometry: a hub and eight points, one toward each corner of the cube,
  // the same under mirroring of any axis.
  const tips = new Set(), faces = new Set();
  for (const { box } of SPIKE_PARTS) {
    const c = [0, 1, 2].map((i) => (box[i] + box[i + 3]) / 2 - 0.5);
    if (c.every((v) => Math.abs(v) < 1e-9)) continue;
    const onAxis = c.filter((v) => Math.abs(v) > 1e-9).length === 1;
    assert.ok(onAxis || c.every((v) => Math.abs(Math.abs(v) - Math.abs(c[0])) < 1e-9), 'a spike part is off the body diagonals and face axes');
    (onAxis ? faces : tips).add(c.map((v) => Math.abs(v) < 1e-9 ? 0 : Math.sign(v)).join());
    for (const axis of [0, 1, 2]) {
      const mirrored = box.slice(); mirrored[axis] = 1 - box[axis + 3]; mirrored[axis + 3] = 1 - box[axis];
      assert.ok(SPIKE_PARTS.some((p) => p.box.every((v, i) => Math.abs(v - mirrored[i]) < 1e-9)), 'the caltrop is not symmetric');
    }
  }
  assert.equal(tips.size, 8, 'the caltrop does not point at all eight corners');
  assert.equal(faces.size, 6, 'no spike out of every face');
  assert.ok(SPIKE_PARTS.every(({ box }) => box.every((v) => v >= 0 && v <= 1)), 'a spike sticks out of its block');
  assert.equal(SPIKE_DIRECTIONS.length, 8);
  const reach = Math.max(...SPIKE_PARTS.map(({ box }) => box[3]));
  assert.ok(reach > 0.9 && reach <= 1, 'the points do not reach the corners');
  assert.ok(getBlockDef(BLOCK.SPIKE_BARRICADE).solid);
}
const spikeAt = (dx, dz, team = host.team, dy = 1) => { const p = at(dx, dz, dy); world.setBlock(p.x, p.y, p.z, BLOCK.SPIKE_BARRICADE); game.spikes.placed(p.x, p.y, p.z, team); return p; };
{
  // Contact: enemies and creatures are hurt and thrown back (once per
  // cooldown); teammates and their monkeys are not.
  const p = spikeAt(10, 50);
  park(enemy, 11, 50); enemy.state.x = p.x + 1 + 0.32;
  const hp0 = enemy.hp;
  run(1);
  assert.equal(hp0 - enemy.hp, SP.contactDamage, 'touching an enemy spike did no damage');
  assert.ok(enemy.state.kx > 0, 'the enemy was not thrown away from the spike');
  Object.assign(enemy.state, { x: p.x + 1.32, kx: 0, kz: 0, vy: 0 });
  run(2);
  assert.equal(hp0 - enemy.hp, SP.contactDamage, 'spikes hurt again inside the cooldown');
  Object.assign(enemy.state, { x: p.x + 1.32, y: Y + 1, kx: 0, kz: 0, vy: 0 });
  enemy.spikeReadyTick = 0; run(1);
  assert.equal(hp0 - enemy.hp, SP.contactDamage * 2, 'spikes did not hurt again after the cooldown');
  heal(enemy); park(enemy, 60, 60);
  park(mate, 9, 50); mate.state.x = p.x - 0.32;
  const own = monkey(10, 51, {}); own.state.z = p.z + 1.4;
  run(TICK_RATE);
  assert.equal(mate.hp, mate.maxHp(), 'a spike hurt its own team');
  assert.equal(own.hp, own.maxHp ?? own.hp, 'a spike hurt its own team\'s monkey');
  game.npcs.delete(own.id); park(mate, 60, 2);
  const crawler = spawnCrawler(10, 49); crawler.state.z = p.z - 0.4;
  const c0 = crawler.hp;
  run(1);
  assert.ok(crawler.hp < c0 || crawler.dead, 'a spike did not hurt a Crawler');
  game.mobs.delete(crawler.id);
  const goblin = game.garrison.hatch('goblinSoldier', p.x + 0.5, Y + 1, p.z - 0.4);
  if (goblin) {
    game.mobs.set(goblin.id, goblin);
    Object.assign(goblin.state, { x: p.x + 0.5, z: p.z - 0.4, y: Y + 1 });
    const g0 = goblin.hp; goblin.spikeReadyTick = 0;
    game.spikes.update(game.tick);
    assert.ok(goblin.hp < g0 || goblin.dead, 'a spike did not hurt a goblin');
    game.mobs.delete(goblin.id);
  }
}
{
  // Breaking by hand: an enemy is hurt while breaking (not only at the end);
  // the owning team is not.
  const p = spikeAt(14, 50);
  park(enemy, 16, 50);
  enemy.inventory.slots[enemy.selected] = { item: ITEM.STONE_HAMMER, count: 1 };
  const hp0 = enemy.hp;
  for (let i = 0; i < 20; i++) game.stepBreaking(enemy, p);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.SPIKE_BARRICADE, 'the spike broke too quickly');
  assert.ok(enemy.hp < hp0, 'breaking an enemy spike did not hurt');
  const hpMid = enemy.hp;
  for (let i = 0; i < 2; i++) game.stepBreaking(enemy, p);
  assert.ok(hpMid - enemy.hp <= SP.breakDamage, 'breaking damage came every tick');
  for (let i = 0; i < 200 && world.getBlock(p.x, p.y, p.z) === BLOCK.SPIKE_BARRICADE; i++) { heal(enemy); game.stepBreaking(enemy, p); }
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.AIR, 'spikes could not be broken by hand at all');
  heal(enemy); park(enemy, 60, 60);
  const q = spikeAt(16, 52);
  park(mate, 18, 52); mate.inventory.slots[mate.selected] = { item: ITEM.STONE_HAMMER, count: 1 };
  for (let i = 0; i < 200 && world.getBlock(q.x, q.y, q.z) === BLOCK.SPIKE_BARRICADE; i++) game.stepBreaking(mate, q);
  assert.equal(mate.hp, mate.maxHp(), 'breaking your own team\'s spike hurt');
  park(mate, 60, 2);
}
{
  // Counterplay without touching it: enemy arrows wear it down, a barrel blows it up.
  const p = spikeAt(20, 50);
  const arrow = { stuckIn: p, shooter: enemy, damage: 3 };
  game.spikes.arrowHit({ ...arrow, shooter: host });
  assert.ok(!game.explosives.damage.has(`${p.x},${p.y},${p.z}`), 'the owners\' arrows damaged their spike');
  let shots = 0;
  while (world.getBlock(p.x, p.y, p.z) === BLOCK.SPIKE_BARRICADE && shots < 20) { game.spikes.arrowHit(arrow); shots++; }
  assert.ok(shots > 2 && shots <= Math.ceil(1 / SP.arrowDamage), `arrows took ${shots} hits`);
  const q = spikeAt(24, 50); barrelAt(26, 50);
  game.explosives.ignite(ox + 26, Y + 1, oz + 50, { seconds: 0.05 }); run(3);
  assert.equal(world.getBlock(q.x, q.y, q.z), BLOCK.AIR, 'a barrel did not destroy a spike barricade');
  for (let x = ox; x < ox + 34; x++) for (let z = oz + 40; z < oz + 60; z++) if (world.getBlock(x, Y, z) === BLOCK.AIR) world.setBlock(x, Y, z, BLOCK.STONE);
  clear(0, 40, 33, 59);
  // Spikes on a wall and a ceiling work the same: a spike above an enemy's head.
  const c = spikeAt(30, 45, host.team, 3);
  park(enemy, 30, 45);
  enemy.state.y = Y + 1.25;                    // jumping up into it
  const hp0 = enemy.hp; enemy.spikeReadyTick = 0;
  game.spikes.update(game.tick);
  assert.equal(hp0 - enemy.hp, SP.contactDamage, 'a ceiling spike did not hurt');
  world.setBlock(c.x, c.y, c.z, BLOCK.AIR);
  heal(enemy); park(enemy, 60, 60);
}

// ---- Steam-powered drawbridge ----
{
  // The mechanism sits in the platform's east edge; a steam tank feeds it
  // through a pipe below. A second platform waits 5 blocks out to the east.
  const L = 5, mx = ox + 63, mz = oz + 30, key = `${mx},${Y},${mz}`;
  world.setBlock(mx, Y - 1, mz, BLOCK.BRONZE_PIPE);
  world.setBlock(mx, Y - 2, mz, BLOCK.FLUID_TANK);
  const tank = () => game.fluids.nodes.get(`${mx},${Y - 2},${mz}`).tank;
  const pipe = () => game.fluids.networks.find((n) => n.pipeKeys.has(`${mx},${Y - 1},${mz}`));
  let bridge = null;
  // All the steam there is: tank, pipe and the drawbridge's own store.
  const steam = () => (tank().amount ?? 0) + (pipe()?.amount ?? 0) + (bridge?.steam ?? 0);
  const fill = (amount = 4000) => { tank().fluid = amount ? 'steam' : null; tank().amount = amount; const n = pipe(); if (n) { n.amount = 0; n.fluid = null; } if (bridge) bridge.steam = 0; };
  fill();
  for (let x = mx + L + 1; x <= mx + L + 6; x++) for (let z = mz - 2; z <= mz + 2; z++) world.setBlock(x, Y, z, BLOCK.STONE);
  // Placed by the host, looking east: owned by their team, extending east.
  world.setBlock(mx, Y, mz, BLOCK.AIR);
  park(host, 61, 30); host.state.yaw = -Math.PI / 2; host.state.pitch = 0;
  host.inventory.slots[host.selected] = { item: BLOCK.DRAWBRIDGE, count: 1 };
  game.stepPlace(host, { x: mx, y: Y, z: mz, nx: 1, ny: 0, nz: 0 }, host.selected);
  assert.equal(world.getBlock(mx, Y, mz), BLOCK.DRAWBRIDGE, 'the drawbridge was not placed');
  bridge = world.tileEntities.get(key);
  assert.ok(bridge?.kind === 'drawbridge' && bridge.team === host.team, 'the drawbridge has no owner');
  assert.deepEqual(FACING_DIRS[bridge.dir], [1, 0], 'the drawbridge does not face the way it was placed');
  assert.equal(bridge.side, 1, 'a new drawbridge does not run along its right side');
  // These checks use the straight-out layout (side 0, as saved bridges from
  // before sides keep); the side layout is checked at the end.
  bridge.side = 0;
  run(2);
  const deck = () => { let n = 0; for (let i = 1; i <= DB.maxLength; i++) if (world.getBlock(mx + i, Y, mz) === BLOCK.BRIDGE_DECK) n++; return n; };
  const action = (who, action, value) => { sent.clear(); game.handleMessage(sessions.get(who.id), JSON.stringify({ type: C2S.MACHINE_ACTION, action, value })); return messages(who.id, S2C.CONTAINER).at(-1); };
  const sectionTicks = Math.round(DB.sectionSeconds * TICK_RATE), whole = sectionTicks * (L + 2);
  // The enemy can't open or work it.
  park(enemy, 61, 31); sent.clear();
  game.openContainer(enemy, { x: mx, y: Y, z: mz });
  assert.ok(messages(2, S2C.NOTICE).some((m) => /another team/.test(m.text)) && !enemy.viewing, 'an enemy opened the drawbridge');
  game.handleMessage(sessions.get(2), JSON.stringify({ type: C2S.MACHINE_ACTION, action: 'extend' }));
  assert.ok(!bridge.moving && deck() === 0, 'an enemy worked the drawbridge');
  park(enemy, 60, 60);
  // The owner: length 5, and the screen shows the cost and the steam on hand.
  game.openContainer(host, { x: mx, y: Y, z: mz });
  let view = action(host, 'length', L);
  assert.equal(view.length, L);
  assert.equal(view.required, L * DB.sectionPlanks, 'wrong materials shown for the length');
  assert.equal(view.steamCost, L * DB.steamPerSection, 'the cost is not proportional to the length');
  // Its own store fills from the pipes and stops at its capacity; nothing is lost.
  run(Math.ceil(DB.steamStorage / DB.fillPerSecond * TICK_RATE) + 10);
  assert.ok(Math.abs(bridge.steam - DB.steamStorage) < 1e-6, `the drawbridge's store holds ${bridge.steam}`);
  assert.ok(Math.abs(steam() - 4000) < 1e-6, 'filling the store lost or made steam');
  assert.ok(Math.abs(bridge.view().steamAvailable - 4000) < 1 && bridge.view().steamStored === bridge.steam, 'the steam on hand is not shown');
  // A move paid from the store alone, with the pipes cut off: tank emptied.
  { const before = bridge.steam; tank().amount = 0; tank().fluid = null; const n = pipe(); if (n) { n.amount = 0; n.fluid = null; }
    bridge.slots[0] = { item: BLOCK.PLANKS, count: L * DB.sectionPlanks };
    assert.ok(!action(host, 'extend').message, 'the store could not pay for a move');
    assert.equal(bridge.steam, before - L * DB.steamPerSection); run(whole); assert.equal(deck(), L);
    fill(); bridge.steam = L * DB.steamPerSection; action(host, 'retract'); run(whole); assert.equal(deck(), 0);
    bridge.slots[0] = null; bridge.stored = 0; }
  // Not enough steam: nothing starts and nothing is taken.
  fill(L * DB.steamPerSection - 1);
  bridge.slots[0] = { item: BLOCK.PLANKS, count: 9 };
  view = action(host, 'extend');
  assert.match(view.message ?? '', /Insufficient steam/);
  assert.ok(!bridge.moving && view.status === 'Insufficient steam');
  run(whole);
  assert.equal(deck(), 0, 'it moved without enough steam');
  assert.equal(steam(), L * DB.steamPerSection - 1, 'steam was taken for a move that never started');
  // Enough steam: the whole cost is taken at once, then it moves on its own
  // even when the steam is cut off; 9 planks build 3 sections and then it
  // stops for materials.
  fill();
  view = action(host, 'extend');
  assert.ok(!view.message && bridge.moving, 'the move did not start');
  assert.equal(4000 - steam(), L * DB.steamPerSection, 'the whole cost was not taken when the move began');
  fill(0);
  assert.match(action(host, 'retract').message ?? '', /already moving/, 'a new order was taken while moving');
  run(sectionTicks + 1);
  assert.equal(deck(), 1, 'sections did not go out one at a time');
  run(whole);
  assert.equal(deck(), 3, 'losing steam stopped a move that had started, or the planks were miscounted');
  assert.equal(bridge.state, 'Missing construction materials'); assert.ok(!bridge.moving);
  assert.equal(bridge.slots[0], null);
  // More planks; the next press pays again and finishes the job.
  bridge.slots[0] = { item: BLOCK.PLANKS, count: 10 };
  fill();
  action(host, 'extend'); run(whole);
  assert.equal(deck(), L); assert.equal(bridge.state, 'Extended');
  assert.equal(bridge.slots[0].count, 4, 'the wrong number of planks was used');
  assert.equal(4000 - steam(), L * DB.steamPerSection);
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.BLOCK_CHANGES).some((m) => m.changes.some((c) => c.id === BLOCK.BRIDGE_DECK)), `player ${id} did not see the bridge go out`);
  assert.match(action(host, 'extend').message ?? '', /Already extended/);
  // Standing still uses nothing.
  const still = steam(); run(TICK_RATE * 3);
  assert.equal(steam(), still, 'steam used while extended');
  // The deck is solid ground and monkeys find their way over it.
  const from = { x: mx - 2, y: Y + 1, z: mz }, to = { x: mx + L + 3, y: Y + 1, z: mz };
  const path = () => { const p = findPath(world, from, to, { height: 2, halfWidth: 0.4, maxNodes: 4000, climb: 1, maxDrop: 3 });
    return p.length && p.at(-1).x === to.x && p.at(-1).z === to.z ? p : []; };
  assert.ok(path().length, 'no path over the extended bridge');
  // Length and direction can't change while it is out.
  view = action(host, 'length', 8);
  assert.match(view.message ?? '', /Retract/); assert.equal(bridge.length, L);
  // Retract and extend three times: nothing is used up or made; each move
  // costs the same steam.
  const planksInSystem = () => (bridge.slots[0]?.count ?? 0) + (bridge.stored + deck()) * DB.sectionPlanks;
  const total = planksInSystem();
  for (let round = 0; round < 3; round++) {
    fill(); action(host, 'retract'); run(whole);
    assert.equal(deck(), 0, 'it did not retract fully'); assert.equal(bridge.state, 'Retracted');
    assert.equal(4000 - steam(), L * DB.steamPerSection, 'retracting cost the wrong steam');
    assert.equal(bridge.stored, L, 'retracted sections were not stored');
    assert.equal(planksInSystem(), total, 'retracting made or lost planks');
    fill(); action(host, 'extend'); run(whole);
    assert.equal(deck(), L);
    assert.equal(planksInSystem(), total, 'extending made or lost planks');
  }
  assert.equal(bridge.slots[0].count, 4, 'stored sections were paid for again');
  // Retracted, monkeys have no way across (their paths update).
  fill(); action(host, 'retract'); run(whole);
  assert.equal(path().length, 0, 'a path across a retracted bridge');
  // Steam drawn from a boiler's store counts too: swap the tank for a boiler.
  world.setBlock(mx, Y - 2, mz, BLOCK.BOILER);
  const { createContainer } = await import('../server/containers.js');
  const boiler = createContainer('boiler'); world.tileEntities.set(`${mx},${Y - 2},${mz}`, boiler); game.fluids.attach(mx, Y - 2, mz, boiler);
  boiler.steam = 40; bridge.steam = 0; { const n = pipe(); if (n) { n.amount = 0; n.fluid = null; } }
  action(host, 'extend');
  assert.ok(bridge.moving, 'steam in a boiler did not pay for a move');
  assert.equal(boiler.steam, 40 - L * DB.steamPerSection);
  run(whole);
  world.setBlock(mx, Y - 2, mz, BLOCK.FLUID_TANK); fill();
  // A broken section drops its planks, leaves a gap, and is only replaced with new planks.
  bridge.slots[0] = null;
  const items0 = game.items.size;
  game.breakBlock(mx + 3, Y, mz);
  const dropped = [...game.items.values()].filter((i) => (i.item ?? i.stack?.item) === BLOCK.PLANKS).reduce((n, i) => n + (i.count ?? i.stack?.count ?? 0), 0);
  assert.ok(game.items.size > items0 && dropped >= DB.sectionPlanks, 'a broken section did not drop its planks');
  run(whole);
  assert.equal(world.getBlock(mx + 3, Y, mz), BLOCK.AIR, 'a broken section came back for free');
  assert.match(action(host, 'extend').message ?? '', /Missing construction materials/, 'extending into a gap without planks');
  fill(); action(host, 'retract'); run(whole);
  assert.equal(bridge.stored, L - 1, 'a broken section was stored');
  fill(); action(host, 'extend'); run(whole);
  assert.equal(deck(), L - 1, 'retracting and extending restored a broken section for free');
  bridge.slots[0] = { item: BLOCK.PLANKS, count: DB.sectionPlanks };
  fill(); action(host, 'retract'); run(whole); fill(); action(host, 'extend'); run(whole);
  assert.equal(deck(), L, 'new planks did not replace the broken section');
  // Obstructions. Blocked at the very first section: it only jogs (everyone
  // sees it), takes no steam and lays nothing.
  fill(); action(host, 'retract'); run(whole);
  world.setBlock(mx + 1, Y, mz, BLOCK.STONE);
  fill(); sent.clear();
  view = action(host, 'extend');
  assert.match(view.message ?? '', /Obstructed/);
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.DRAWBRIDGE_JOG).some((m) => m.x === mx && m.z === mz && m.dx === 1 && m.dz === 0), `player ${id} did not see the jog`);
  assert.equal(steam(), 4000, 'a jog took steam'); assert.equal(deck(), 0); assert.ok(!bridge.moving);
  assert.equal(world.getBlock(mx + 1, Y, mz), BLOCK.STONE);
  world.setBlock(mx + 1, Y, mz, BLOCK.AIR);
  // Blocked further out: it slides as far as the obstruction and stops
  // there (it never goes back), leaving the block alone. Everyone sees each
  // section slide.
  world.setBlock(mx + 3, Y, mz, BLOCK.STONE);
  fill(); sent.clear(); action(host, 'extend');
  run(whole);
  assert.equal(deck(), 2, 'it did not stop at the obstruction'); assert.equal(bridge.state, 'Obstructed'); assert.ok(!bridge.moving);
  assert.equal(world.getBlock(mx + 3, Y, mz), BLOCK.STONE, 'the bridge removed a block in its way');
  for (const id of [1, 2, 3]) {
    const slides = messages(id, S2C.DRAWBRIDGE_SLIDE);
    // Cells out along x from the mechanism (from/to are blocks).
    const out = (c) => c.z === mz ? c.x - mx : NaN;
    assert.ok(slides.length >= 2 && out(slides[0].from) === 0 && out(slides[0].to) === 1 && out(slides[1].from) === 1 && out(slides[1].to) === 2
      && slides[0].laying, `player ${id} did not see the sections slide out`);
  }
  run(whole);
  assert.equal(deck(), 2, 'it went back after the obstruction');
  // Someone on the bridge isn't dropped when an enemy blocks its end mid-move.
  world.setBlock(mx + 3, Y, mz, BLOCK.AIR);
  fill(); action(host, 'retract'); run(whole);
  park(mate, 63 + 1, 30); mate.state.y = Y + 1;
  fill(); action(host, 'extend'); run(sectionTicks * 2 + 2);
  world.setBlock(mx + 4, Y, mz, BLOCK.STONE);            // an enemy blocks the far end
  run(whole);
  assert.ok(deck() >= 3 && world.getBlock(mx + 1, Y, mz) === BLOCK.BRIDGE_DECK, 'blocking the end pulled the bridge back');
  assert.equal(bridge.state, 'Obstructed');
  world.setBlock(mx + 4, Y, mz, BLOCK.AIR); park(mate, 60, 2);
  // Someone standing in the way stops it before them.
  park(enemy, 63 + 5, 30); enemy.state.y = Y; enemy.state.x = mx + 5.5;   // standing in cell 5
  fill(); action(host, 'extend'); run(whole * 2);
  assert.equal(deck(), 4, 'the bridge was laid into a player'); assert.equal(bridge.state, 'Obstructed');
  park(enemy, 60, 60);
  fill(); action(host, 'extend'); run(whole);
  assert.equal(deck(), L);
  // Retracting slides each section back in.
  fill(); sent.clear(); action(host, 'retract'); run(whole);
  assert.equal(deck(), 0);
  const inward = messages(1, S2C.DRAWBRIDGE_SLIDE);
  assert.ok(inward.length === L && inward[0].from.x - mx === L && inward[0].to.x - mx === L - 1 && inward.at(-1).to.x === mx && !inward[0].laying,
    'retracting sections did not slide back in');
  fill(); action(host, 'extend'); run(whole);
  assert.equal(deck(), L);
  // Another length and direction once retracted: 3 north, at a smaller cost.
  fill(); action(host, 'retract'); run(whole);
  for (let i = 1; i <= 3; i++) world.setBlock(mx, Y, mz - i, BLOCK.AIR);   // a gap in the floor to the north
  view = action(host, 'direction', 0);
  assert.equal(view.dir, 0); action(host, 'length', 3);
  fill(); action(host, 'extend');
  assert.equal(4000 - steam(), 3 * DB.steamPerSection, 'a shorter bridge did not cost less');
  run(sectionTicks * 6);
  for (let i = 1; i <= 3; i++) assert.equal(world.getBlock(mx, Y, mz - i), BLOCK.BRIDGE_DECK, `no north section ${i}`);
  assert.equal(world.getBlock(mx, Y, mz - 4), BLOCK.STONE);
  assert.equal(bridge.stored, L - 3, 'a shorter bridge did not keep the spare sections');
  // Beside the mechanism: on its right (facing north, that's east) the first
  // section sits next to it and the rest run north; switching sides only
  // while retracted; the mechanism's own line stays clear.
  fill(); action(host, 'retract'); run(sectionTicks * 6);
  view = action(host, 'side', 1);
  assert.equal(view.side, 1);
  const cells = (side) => [1, 2, 3].map((i) => drawbridgeCell({ x: mx, y: Y, z: mz }, 0, side, i));
  assert.deepEqual(cells(1)[0], { x: mx + 1, y: Y, z: mz }, 'the first section is not right beside the mechanism');
  assert.deepEqual(cells(1)[2], { x: mx + 1, y: Y, z: mz - 2 });
  for (const c of [...cells(1), ...cells(-1)]) world.setBlock(c.x, c.y, c.z, BLOCK.AIR);
  fill(); action(host, 'extend'); run(sectionTicks * 6);
  for (const c of cells(1)) assert.equal(world.getBlock(c.x, c.y, c.z), BLOCK.BRIDGE_DECK, `no right-side section at ${c.x},${c.z}`);
  for (let i = 1; i <= 3; i++) assert.notEqual(world.getBlock(mx, Y, mz - i), BLOCK.BRIDGE_DECK, 'a section went straight out of the front');
  assert.match(action(host, 'side', -1).message ?? '', /Retract/, 'the side changed while extended');
  fill(); action(host, 'retract'); run(sectionTicks * 6);
  assert.equal(action(host, 'side', -1).side, -1);
  fill(); action(host, 'extend'); run(sectionTicks * 6);
  for (const c of cells(-1)) assert.equal(world.getBlock(c.x, c.y, c.z), BLOCK.BRIDGE_DECK, `no left-side section at ${c.x},${c.z}`);
  for (const c of cells(1)) assert.notEqual(world.getBlock(c.x, c.y, c.z), BLOCK.BRIDGE_DECK, 'the right side kept a section');
  // A saved bridge from before sides keeps the straight layout.
  { const { Drawbridge } = await import('../server/drawbridge.js'); const old = new Drawbridge(); old.migrate({ dir: 1, length: 3 }); assert.equal(old.side, 0); }
  // Breaking the mechanism gives back the slot and the stored sections' planks.
  fill(); action(host, 'retract'); run(sectionTicks * 6);
  for (const i of [...game.items.keys()]) { game.items.delete(i); }
  const owed = (bridge.slots[0]?.count ?? 0) + bridge.stored * DB.sectionPlanks;
  game.breakBlock(mx, Y, mz);
  const back = [...game.items.values()].filter((i) => (i.item ?? i.stack?.item) === BLOCK.PLANKS).reduce((n, i) => n + (i.count ?? i.stack?.count ?? 0), 0);
  assert.equal(back, owed, `breaking the mechanism gave back ${back} of ${owed} planks`);
}

// ---- A lit barrel falls like sand and goes off where it lands ----
{
  clear(50, 50, 52, 52, 1, 12);
  const top = at(51, 51, 8); world.setBlock(top.x, top.y - 1, top.z, BLOCK.STONE); // a ledge to light it on
  world.setBlock(top.x, top.y, top.z, BLOCK.EXPLOSIVE_BARREL);
  world.setBlock(top.x, Y + 1, top.z, BLOCK.RED_FLOWER); // on the ground below
  const booms = [], explode = game.explosives.explode.bind(game.explosives);
  game.explosives.explode = (x, y, z, ...rest) => { booms.push({ x, y, z }); return explode(x, y, z, ...rest); };
  assert.ok(game.explosives.ignite(top.x, top.y, top.z));
  run(5);
  assert.equal(world.getBlock(top.x, top.y, top.z), BLOCK.LIT_BARREL, 'a supported lit barrel moved');
  world.setBlock(top.x, top.y - 1, top.z, BLOCK.AIR); // its support goes
  assert.ok(run(TICK_RATE * 2, () => world.getBlock(top.x, Y + 1, top.z) === BLOCK.LIT_BARREL), 'the lit barrel did not fall to the ground');
  for (let y = Y + 2; y <= top.y; y++) assert.equal(world.getBlock(top.x, y, top.z), BLOCK.AIR, 'the falling barrel left a block behind');
  assert.equal([...game.items.values()].filter((e) => e.item === BLOCK.RED_FLOWER).length, 0, 'the crushed flower dropped (no hoe)');
  assert.ok(run(fuse + 5, () => booms.length > 0), 'the fallen barrel never went off');
  assert.ok(Math.abs(booms[0].y - (Y + 1.5)) < 0.01 && Math.abs(booms[0].x - (top.x + 0.5)) < 0.01, 'it went off somewhere other than where it landed');
  game.explosives.explode = explode;
}

// ---- Saves: lit barrels, spike owners, drawbridges ----
{
  const p = barrelAt(40, 40); game.explosives.ignite(p.x, p.y, p.z);
  const s = spikeAt(44, 40, enemy.team);
  const { serializeGame } = await import('../server/save.js');
  const save = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.ok(save.explosives.lit.some(([x, y, z]) => x === p.x && z === p.z), 'a lit barrel was not saved');
  assert.ok(save.spikes.some(([k, team]) => k === `${s.x},${s.y},${s.z}` && team === enemy.team), 'a spike\'s owner was not saved');
}

// ---- Quests: everything above counts for the host's team, synced to the teammate ----
{
  host.inventory.add(ITEM.SULFUR_SEEDS, 1); host.inventory.add(ITEM.SULFUR, 1); host.inventory.add(ITEM.BRONZE_INGOT, 1);
  host.inventory.add(ITEM.LIGHTER, 1);
  host.inventoryDirty = true;
  // The steam line the drawbridge needs (its quest follows the boiler's).
  for (const id of [BLOCK.FLUID_PUMP, BLOCK.BRONZE_PIPE, BLOCK.BOILER]) game.teamProgress.placed(host.team, id);
  sent.clear();
  run(TICK_RATE + 1);
  game.quests.update();
  const book = game.quests.of(host.team);
  for (const id of ['sulfurSeeds', 'sulfurFarm', 'sulfurAuto', 'gunpowder', 'explosivesFactory', 'grenades', 'barrels', 'lighter', 'drawbridge'])
    assert.ok(book.completed.has(id), `quest ${id} not completed`);
  assert.ok(!game.quests.of(enemy.team).completed.has('grenades'), 'the other team got the host\'s grenade quest');
  const mateBook = messages(3, S2C.QUESTS).at(-1);
  assert.ok(mateBook?.completed.includes('drawbridge') && mateBook.completed.includes('barrels'), 'the teammate\'s book was not updated');
}

console.log('OK: sulfur seeds from the merchant and loot, a renewable sulfur farm run by a farmer monkey, gunpowder and grenades from a',
  'craftsman, grenade throwing, flight, fuse and falloff damage (soft blocks only, never spikes), barrels (lit only by a lighter, fuse, structure,',
  'reinforced walls, chain reactions), spike geometry (corners and faces), contact, breaking, arrows and teams, drawbridges (beside the mechanism on either side, steam paid up front per move,',
  'refused without it, moves finish without it, no orders while moving, materials, no duplication, broken sections, obstruction,',
  'lengths and directions, pathfinding, ownership), saves, quests, sync');
process.exit(0);
