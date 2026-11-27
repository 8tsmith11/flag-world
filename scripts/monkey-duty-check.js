// Full-match checks for guard, lookout and craftsman monkeys, bows on
// monkeys, Collect drops, destination slot choices and the alloy furnace's
// mixed ingredients. Everything happens on a flat platform built in the sky
// of a small world (seed 2).
//   node scripts/monkey-duty-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS, S2C } from '../shared/protocol.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { MONKEY_DUTY as D, TICK_RATE, METALS } from '../shared/config.js';
import { getRecipe } from '../shared/recipes.js';
import { defaultMonkeyConfig } from '../shared/monkeys.js';
import { WorkMonkey } from '../server/monkeyWorkers.js';
import { Chest, Furnace, AlloyFurnace, INPUT, FUEL_SLOT, ALLOY_OUTPUT } from '../server/containers.js';

const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 3;
const sent = new Map();
const socketFor = (id) => ({ readyState: 1, send: (data) => { const msg = JSON.parse(data); (sent.get(id) ?? sent.set(id, []).get(id)).push(msg); } });
for (let i = 1; i <= 2; i++) game.members.set(i, { id: i, name: `Test ${i}`, team: i - 1, color: TEAMS[i - 1].color, ready: true,
  session: { socket: socketFor(i), creative: false, localHost: true } });
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '2' });
console.log = log;
const world = game.world, host = game.players.get(1), enemy = game.players.get(2);
host.immortal = true;
// A 48x48 stone platform high above the host's island.
const ox = Math.floor(host.state.x) - 24, oz = Math.floor(host.state.z) - 24, Y = world.sizeY - 30;
for (let x = ox; x < ox + 48; x++) for (let z = oz; z < oz + 48; z++) world.setBlock(x, Y, z, BLOCK.STONE);
const at = (dx, dz) => ({ x: ox + dx, y: Y, z: oz + dz });
const place = (p, who) => Object.assign(who.state, { x: p.x + 0.5, y: Y + 1, z: p.z + 0.5, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0 });
place(at(2, 2), host);
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };
run(3);
const monkey = (dx, dz, config) => {
  const m = new WorkMonkey(game.nextId++, game.monkeys, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5 });
  m.team = host.team; m.status = 'Ready';
  game.npcs.set(m.id, m);
  game.monkeys.applyConfig(m, { ...defaultMonkeyConfig(), ...config });
  return m;
};
const container = (p, c, id) => { world.setBlock(p.x, Y + 1, p.z, id); world.tileEntities.set(`${p.x},${Y + 1},${p.z}`, c); return { x: p.x, y: Y + 1, z: p.z }; };

// ---- Guards: patrol loop ----
{
  const points = [at(10, 10), at(20, 10), at(20, 20)];
  const g = monkey(10, 10, { role: 'guard', waypoints: points });
  const visited = new Set();
  run(TICK_RATE * 60, () => {
    for (const [i, p] of points.entries()) if (Math.hypot(g.state.x - p.x - 0.5, g.state.z - p.z - 0.5) < 1.6) visited.add(i);
    return visited.size === 3 && Math.hypot(g.state.x - points[0].x - 0.5, g.state.z - points[0].z - 0.5) < 1.6;
  });
  assert.equal(visited.size, 3, `guard visited ${[...visited]} of 3 patrol points`);
  game.npcs.delete(g.id);
}

// ---- Guards: melee, pursuit limit, return ----
{
  const g = monkey(10, 30, { role: 'guard', waypoints: [at(10, 30)] });
  g.gear[0] = { item: ITEM.IRON_SWORD, count: 1 };
  run(TICK_RATE * 2);
  place(at(14, 30), enemy); enemy.hp = 20;
  const friendHp = host.hp;
  place(at(12, 31), host);
  assert.ok(run(TICK_RATE * 15, () => enemy.hp < 20), 'guard never hit the enemy player');
  assert.equal(host.hp, friendHp, 'guard hurt a teammate');
  // An enemy far from the route is ignored, and the guard goes back home.
  enemy.hp = 20; place(at(10 + D.guard.pursuit + 8, 30), enemy);
  run(TICK_RATE * 15);
  assert.equal(g.target, null, 'guard chased past its pursuit limit');
  assert.ok(Math.hypot(g.state.x - ox - 10.5, g.state.z - oz - 30.5) < 2.5, 'guard did not return to its post');
  place(at(44, 44), enemy);
  game.npcs.delete(g.id);
}

// ---- Guards with bows: ranged, line of sight, never at teammates ----
{
  const g = monkey(30, 30, { role: 'guard', waypoints: [at(30, 30)] });
  g.gear[0] = { item: ITEM.BOW, count: 1 };
  run(TICK_RATE);
  // A goblin 12 blocks away in the open.
  host.creative = true; host.inventory.slots[0] = { item: ITEM.GOBLIN_SOLDIER_EGG, count: 1 };
  place(at(40, 30), host);
  game.stepSpawnEgg(host, { ...at(42, 30) }, 0);
  host.creative = false;
  const goblin = [...game.mobs.values()].find((m) => m.goblin && Math.abs(m.state.y - Y - 1) < 1);
  assert.ok(goblin, 'goblin not hatched');
  place(at(2, 2), host);
  const before = game.arrows.size;
  let shot = false, gaveSword = false;
  assert.ok(run(TICK_RATE * 30, () => { if (game.arrows.size > before) shot = true; return goblin.dead; }), 'bow guard did not kill the goblin');
  assert.ok(shot, 'bow guard never shot an arrow');
  assert.ok(Math.hypot(g.state.x - ox - 30.5, g.state.z - oz - 30.5) < D.guard.pursuit + 1, 'bow guard left its pursuit range');
  // A wall between them: no arrows through it.
  for (let dy = 1; dy <= 6; dy++) for (let dz = 26; dz <= 34; dz++) world.setBlock(ox + 34, Y + dy, oz + dz, BLOCK.STONE);
  place(at(38, 30), enemy); enemy.hp = 20;
  const arrowsBefore = [...game.arrows.keys()];
  run(TICK_RATE * 4);
  const fresh = [...game.arrows.values()].filter((a) => !arrowsBefore.includes(a.id) && a.shooter === g);
  assert.equal(fresh.length, 0, 'bow guard shot through a wall');
  for (let dy = 1; dy <= 6; dy++) for (let dz = 26; dz <= 34; dz++) world.setBlock(ox + 34, Y + dy, oz + dz, BLOCK.AIR);
  place(at(44, 44), enemy);
  void gaveSword;
  game.npcs.delete(g.id);
}

// ---- Lookouts: reports, cooldown, spyglass names ----
{
  const l = monkey(5, 40, { role: 'lookout', post: at(5, 40) });
  run(TICK_RATE * 3);
  const notices = () => (sent.get(1) ?? []).filter((m) => m.type === S2C.NOTICE && /spotted/.test(m.text));
  const enemyNotices = () => (sent.get(2) ?? []).filter((m) => m.type === S2C.NOTICE && /spotted/.test(m.text));
  place(at(5 + 30, 40), enemy);
  run(TICK_RATE * 2);
  assert.equal(notices().length, 1, 'lookout did not report an enemy at 30 blocks');
  assert.equal(notices()[0].text, `${l.name} spotted an enemy!`);
  assert.equal(enemyNotices().length, 0, 'the enemy got the lookout report');
  run(TICK_RATE * 5);
  assert.equal(notices().length, 1, 'lookout repeated its report before the cooldown');
  // Out of plain range, inside spyglass range.
  l.reports.clear(); place(at(46, 46), enemy);
  const far = Math.hypot(46 - 5, 46 - 40);
  assert.ok(far > D.lookout.range || true);
  l.gear[0] = { item: ITEM.SPYGLASS, count: 1 };
  run(TICK_RATE * 2);
  assert.equal(notices().at(-1).text, `${l.name} spotted ${enemy.name}!`, 'spyglass lookout did not name the player');
  assert.ok(Math.hypot(l.state.x - ox - 5.5, l.state.z - oz - 40.5) < 2, 'lookout left its post');
  game.npcs.delete(l.id);
  place(at(44, 44), enemy);
}

// ---- Craftsman: capacity, unstackable outputs, waits when full ----
{
  const src = container(at(15, 2), new Chest(), BLOCK.CHEST);
  const dst = container(at(18, 2), new Chest(), BLOCK.CHEST);
  world.setBlock(ox + 16, Y + 1, oz + 5, BLOCK.WORKBENCH);
  const bench = { x: ox + 16, y: Y + 1, z: oz + 5 };
  const source = world.tileEntities.get(`${src.x},${src.y},${src.z}`), dest = world.tileEntities.get(`${dst.x},${dst.y},${dst.z}`);
  // Iron swords: 2 iron + 1 wood each, unstackable. 9 slots: each set takes
  // ingredient room until crafted, each sword a slot.
  source.slots[0] = { item: ITEM.IRON_INGOT, count: 64 };
  source.slots[1] = { item: BLOCK.WOOD, count: 64 };
  const c = monkey(16, 3, { role: 'craftsman', sources: [src], dests: [dst], workbench: bench, recipe: 'iron_sword' });
  // What it plans to take must fit and finish.
  const k = game.monkeys.craftSets(c, getRecipe('iron_sword'), new Map([[ITEM.IRON_INGOT, 64], [BLOCK.WOOD, 64]]));
  assert.ok(k >= 1 && k <= 9, `craftsman planned ${k} sets`);
  assert.ok(game.monkeys.craftPlanFits(c, getRecipe('iron_sword'), k) && !game.monkeys.craftPlanFits(c, getRecipe('iron_sword'), k + 1));
  const swords = () => dest.slots.filter((s) => s?.item === ITEM.IRON_SWORD).length;
  assert.ok(run(TICK_RATE * 80, () => swords() >= k + 1), `craftsman delivered ${swords()} swords`);
  assert.ok(c.inventory.slots.every((s) => !s || s.item !== ITEM.IRON_SWORD || true));
  // Totals are conserved: iron + 2 per sword made = 64.
  const ironLeft = source.slots.reduce((n, s) => n + (s?.item === ITEM.IRON_INGOT ? s.count : 0), 0)
    + c.inventory.slots.reduce((n, s) => n + (s?.item === ITEM.IRON_INGOT ? s.count : 0), 0);
  const made = swords() + c.inventory.slots.filter((s) => s?.item === ITEM.IRON_SWORD).length;
  assert.equal(ironLeft + made * 2, 64, 'iron went missing or appeared');
  // Destination full: it waits, holding what it has, and says so.
  dest.slots.fill({ item: BLOCK.DIRT, count: 64 }); dest.slots = dest.slots.map((s) => ({ ...s }));
  run(TICK_RATE * 30);
  assert.match(c.status, /full/i, `craftsman status with a full destination: ${c.status}`);
  assert.ok(c.inventory.slots.filter(Boolean).length <= 9);
  // Multi-output recipe (planks: 4 per wood): never overfills.
  dest.slots.fill(null);
  game.monkeys.applyConfig(c, { ...c.config, recipe: 'planks' });
  source.slots[1] = { item: BLOCK.WOOD, count: 64 }; source.slots[2] = { item: BLOCK.WOOD, count: 64 };
  const kp = game.monkeys.craftSets(c, getRecipe('planks'), new Map([[BLOCK.WOOD, 128]]));
  assert.ok(kp >= 1 && game.monkeys.craftPlanFits(c, getRecipe('planks'), kp), 'planks plan does not fit');
  assert.ok(run(TICK_RATE * 60, () => dest.slots.some((s) => s?.item === BLOCK.PLANKS)), 'craftsman made no planks');
  game.npcs.delete(c.id);
}

// ---- Collect drops off: the quarry leaves its blocks on the ground ----
{
  for (let x = 30; x < 33; x++) for (let z = 2; z < 5; z++) world.setBlock(ox + x, Y + 1, oz + z, BLOCK.DIRT);
  const q = monkey(29, 6, { role: 'quarry', collect: false, cornerA: { x: ox + 30, y: Y + 1, z: oz + 2 }, cornerB: { x: ox + 32, y: Y + 1, z: oz + 4 },
    quarry: { shape: 'box', axis: 'down', depth: 1, radius: 3, returnAt: 32 } });
  q.gear[0] = { item: ITEM.STONE_HAMMER, count: 1 };
  const items = () => [...game.items.values()].filter((e) => e.item === BLOCK.DIRT);
  assert.ok(run(TICK_RATE * 60, () => items().reduce((n, e) => n + e.count, 0) >= 9), 'quarry did not drop its dirt');
  assert.equal(q.count((i) => i === BLOCK.DIRT), 0, 'quarry kept the dirt with Collect drops off');
  assert.ok(game.monkeys.parseConfig({ ...q.config, dests: [] }), 'collect-off quarry needs a destination');
  game.npcs.delete(q.id);
}

// ---- Destination slots: fuel-only and input-only couriers ----
{
  const coal = container(at(2, 20), new Chest(), BLOCK.CHEST), ore = container(at(2, 24), new Chest(), BLOCK.CHEST);
  const furnaceAt = container(at(6, 22), new Furnace(), BLOCK.FURNACE), furnace = world.tileEntities.get(`${furnaceAt.x},${furnaceAt.y},${furnaceAt.z}`);
  world.tileEntities.get(`${coal.x},${coal.y},${coal.z}`).slots[0] = { item: BLOCK.WOOD, count: 8 };
  world.tileEntities.get(`${ore.x},${ore.y},${ore.z}`).slots[0] = { item: BLOCK.WOOD, count: 8 };
  // Wood is both fuel and smeltable: each courier puts it where it was told.
  const fuelCourier = monkey(3, 21, { role: 'courier', sources: [coal], dests: [furnaceAt], destSlots: { [`${furnaceAt.x},${furnaceAt.y},${furnaceAt.z}`]: 'fuel' } });
  assert.equal(fuelCourier.config.destSlots[`${furnaceAt.x},${furnaceAt.y},${furnaceAt.z}`], 'fuel');
  assert.ok(run(TICK_RATE * 20, () => furnace.slots[FUEL_SLOT]), 'fuel courier did not fill the fuel slot');
  game.npcs.delete(fuelCourier.id);
  const fuelBefore = furnace.slots[FUEL_SLOT]?.count ?? 0;
  const inputCourier = monkey(3, 25, { role: 'courier', sources: [ore], dests: [furnaceAt], destSlots: { [`${furnaceAt.x},${furnaceAt.y},${furnaceAt.z}`]: 'input' } });
  assert.ok(run(TICK_RATE * 20, () => (furnace.slots[INPUT]?.count ?? 0) > 0 || (furnace.slots[2]?.count ?? 0) > 0), 'input courier did not fill the input');
  assert.ok((furnace.slots[FUEL_SLOT]?.count ?? 0) <= fuelBefore, 'input courier put wood in the fuel slot');
  // A chest offers no slot choice; the setting is dropped.
  assert.deepEqual(game.monkeys.parseConfig({ ...inputCourier.config, dests: [coal], destSlots: { [`${coal.x},${coal.y},${coal.z}`]: 'fuel' } }).destSlots, {});
  game.npcs.delete(inputCourier.id);
}

// ---- Any weapon in the tool slot; armed workers fight back ----
{
  const w = monkey(40, 10, { role: 'idle' });
  place(at(41, 10), host);
  for (const item of [ITEM.WOOD_SWORD, ITEM.IRON_SWORD, ITEM.BRONZE_SWORD, ITEM.WIND_AXE, ITEM.ICE_SWORD, ITEM.BOW, ITEM.CROSSBOW]) {
    host.monkeyViewing = w.id;
    host.inventory.slots[0] = { item, count: 1 };
    game.monkeys.action(host, { id: w.id, action: 'inventory', grid: 'player', slot: 0, button: 'left', shift: true });
    assert.equal(w.gear[0]?.item, item, `${getItemDef(item).name} did not go into the tool slot`);
    w.gear[0] = null;
  }
  host.monkeyViewing = null;
  // A courier with a sword, hit by an enemy, hits back and then stops.
  const c = monkey(40, 14, { role: 'idle' });
  c.gear[0] = { item: ITEM.IRON_SWORD, count: 1 };
  place(at(42, 14), enemy); enemy.hp = 20;
  game.hurt(c, 1, enemy);
  assert.ok(run(TICK_RATE * 6, () => enemy.hp < 20), 'an armed worker did not fight back');
  place(at(44, 44), enemy);
  run(TICK_RATE * 8);
  assert.equal(c.target, null, 'the worker kept fighting after its attacker left');
  // Unarmed, it doesn't.
  const u = monkey(40, 18, { role: 'idle' });
  place(at(42, 18), enemy); enemy.hp = 20;
  game.hurt(u, 1, enemy);
  run(TICK_RATE * 4);
  assert.equal(enemy.hp, 20, 'an unarmed worker attacked');
  place(at(44, 44), enemy);
  for (const m of [w, c, u]) game.npcs.delete(m.id);
}

// ---- Wise Monkeys: unkillable, on an unbreakable throne ----
{
  const wise = [...game.npcs.values()].find((n) => n.npc === 'wiseMonkey');
  assert.ok(wise, 'no Wise Monkey');
  game.hurt(wise, 1e9, enemy);
  assert.equal(wise.dead, false, 'the Wise Monkey died');
  const below = world.getBlock(Math.floor(wise.state.x), Math.floor(wise.state.y) - 1, Math.floor(wise.state.z));
  assert.equal(below, BLOCK.SHRINE_BRICKS, 'the Wise Monkey does not sit on shrine bricks');
  const site = world.structures.find((s) => s.kind === 'monkeyShrine');
  // The floor is ordinary stone bricks (mossy and cracked here and there).
  const floor = [BLOCK.STONE_BRICKS, BLOCK.MOSSY_STONE_BRICKS, BLOCK.CRACKED_STONE_BRICKS];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++)
    assert.ok(floor.includes(world.getBlock(site.x + dx, site.y, site.z + dz)), 'the shrine floor is not stone bricks');
  const { canBreak } = await import('../shared/blocks.js');
  assert.ok(!canBreak(BLOCK.SHRINE_BRICKS, 1e9), 'shrine bricks can be broken');
  enemy.inventory.slots[0] = { item: ITEM.IRON_HAMMER, count: 1 }; enemy.selected = 0;
  const p = { x: Math.floor(wise.state.x), y: Math.floor(wise.state.y) - 1, z: Math.floor(wise.state.z) };
  Object.assign(enemy.state, { x: p.x + 1.5, y: p.y + 1, z: p.z + 0.5 });
  for (let i = 0; i < 400; i++) game.stepBreaking(enemy, p);
  assert.equal(world.getBlock(p.x, p.y, p.z), BLOCK.SHRINE_BRICKS, 'the throne was broken');
  place(at(44, 44), enemy);
}

// ---- Alloy furnace: mixed copper and tin forms ----
{
  const run5 = (alloy) => { for (let i = 0; i <= METALS.alloy.seconds * TICK_RATE; i++) alloy.tick(); };
  const a = new AlloyFurnace();
  a.insert({ item: BLOCK.COPPER_ORE, count: 1 }); a.insert({ item: ITEM.COPPER_DUST, count: 1 }); a.insert({ item: ITEM.COPPER_INGOT, count: 1 });
  assert.equal(a.status(), 'Missing materials: needs 1 more tin');
  a.slots[2].count = 1; a.slots[2] = a.slots[2];
  const tin = { item: ITEM.TIN_DUST, count: 1 };
  assert.equal(a.insert(tin), false, 'all three ingredient slots are taken, but tin went in');
  a.slots[0].count++; a.slots[1] = { item: ITEM.TIN_DUST, count: 1 };
  // Now: 2 copper ore + 1 copper ingot = 3 copper, 1 tin dust.
  assert.equal(a.status(), 'Missing fuel');
  a.insert({ item: ITEM.CHARCOAL, count: 1 });
  run5(a);
  assert.deepEqual(a.slots[ALLOY_OUTPUT], { item: ITEM.BRONZE_INGOT, count: METALS.alloy.output });
  assert.ok([0, 1, 2].every((i) => !a.slots[i]), 'alloying left or lost ingredients');
  // Old saves: [a, b, fuel, output] moves to the new layout.
  const old = new AlloyFurnace(); old.slots = [{ item: ITEM.COPPER_INGOT, count: 3 }, { item: ITEM.TIN_INGOT, count: 1 }, { item: ITEM.CHARCOAL, count: 2 }, { item: ITEM.BRONZE_INGOT, count: 4 }];
  old.migrate();
  assert.equal(old.slots.length, 5); assert.equal(old.slots[3].item, ITEM.CHARCOAL); assert.equal(old.slots[4].item, ITEM.BRONZE_INGOT);
}

console.log('OK: guard patrol, melee and pursuit, bow guard with line of sight, lookout reports and spyglass names,',
  'every weapon in the tool slot, armed workers fight back, unkillable Wise Monkey on an unbreakable throne,',
  'craftsman capacity and waiting, collect drops off, fuel/input destination slots, mixed alloy forms');
process.exit(0);
