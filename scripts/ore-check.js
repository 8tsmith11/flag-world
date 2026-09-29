import assert from 'node:assert/strict';
import { generateWorld } from '../shared/worldgen.js';
import { BLOCK, canBreak } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { HAMMERS } from '../shared/tools.js';
import { RECIPES } from '../shared/recipes.js';
import { Furnace, AlloyFurnace } from '../server/containers.js';
import { MonkeyWorkers } from '../server/monkeyWorkers.js';
import { Inventory } from '../server/inventory.js';
import { TICK_RATE, METALS } from '../shared/config.js';

const world = generateWorld(1, 2, 'medium');
const ores = [BLOCK.COPPER_ORE, BLOCK.TIN_ORE, BLOCK.IRON_ORE];
const totals = { center: [0, 0, 0], team: [0, 0, 0], tiny: [0, 0, 0] };
for (const island of world.islands) {
  const counts = [0, 0, 0];
  // Sample each island's core, clear of neighbouring and stacked edges.
  const r = Math.floor(island.radius * 0.7);
  for (let z = island.z - r; z <= island.z + r; z++) for (let x = island.x - r; x <= island.x + r; x++) {
    if (Math.hypot(x - island.x, z - island.z) > r) continue;
    for (let y = island.bottomY; y <= island.topY; y++) {
      const index = ores.indexOf(world.getBlock(x, y, z));
      if (index >= 0) counts[index]++;
    }
  }
  counts.forEach((n, i) => totals[island.kind][i] += n);
  if (island.kind === 'team') {
    assert.ok(counts[0] > counts[1] && counts[1] > 0, `team ore mix ${counts}`);
    assert.equal(counts[2], 0, `iron on team island: ${counts}`);
  }
}
assert.ok(totals.tiny[1] > totals.tiny[2] && totals.tiny[2] > 0, `tiny ore mix ${totals.tiny}`);
assert.ok(totals.center.every(n => n > 0), `central ore mix ${totals.center}`);
console.log('Medium ore counts [copper,tin,iron]:', totals);

const stone = HAMMERS[ITEM.STONE_HAMMER].strength;
const bronze = HAMMERS[ITEM.BRONZE_HAMMER].strength;
const iron = HAMMERS[ITEM.IRON_HAMMER].strength;
assert.ok(canBreak(BLOCK.COPPER_ORE, stone) && canBreak(BLOCK.TIN_ORE, stone));
assert.ok(!canBreak(BLOCK.IRON_ORE, stone));
assert.ok(canBreak(BLOCK.IRON_ORE, bronze) && !canBreak(BLOCK.STONE_BRICKS, bronze));
assert.ok(canBreak(BLOCK.STONE_BRICKS, iron));

const smelt = ore => {
  const furnace = new Furnace();
  furnace.insert({ item: ore, count: 1 });
  furnace.insert({ item: BLOCK.PLANKS, count: 1 });
  for (let i = 0; i <= 5 * TICK_RATE; i++) furnace.tick();
  return furnace.slots[2]?.item;
};
assert.equal(smelt(BLOCK.COPPER_ORE), ITEM.COPPER_INGOT);
assert.equal(smelt(BLOCK.TIN_ORE), ITEM.TIN_INGOT);
for (const reversed of [false, true]) {
  const alloy = new AlloyFurnace();
  alloy.slots[reversed ? 1 : 0] = { item: ITEM.COPPER_INGOT, count: METALS.alloy.copper };
  alloy.slots[reversed ? 0 : 1] = { item: ITEM.TIN_INGOT, count: METALS.alloy.tin };
  alloy.insert({ item: BLOCK.PLANKS, count: 1 });
  for (let i = 0; i <= METALS.alloy.seconds * TICK_RATE; i++) alloy.tick();
  assert.deepEqual(alloy.slots[3], { item: ITEM.BRONZE_INGOT, count: METALS.alloy.output });
  const courier = { config: { from: {}, target: {}, filter: { mode: 'blacklist', items: [] } }, cargo: null, routes: new Map() };
  MonkeyWorkers.prototype.courier.call({ container: () => alloy, travel: () => true }, courier);
  assert.equal(courier.cargo?.item, ITEM.BRONZE_INGOT);
  courier.cargo = { item: ITEM.COPPER_INGOT, count: 3 };
  MonkeyWorkers.prototype.deliver.call({ container: () => alloy }, courier);
  assert.equal(courier.cargo, null);
  courier.cargo = { item: BLOCK.PLANKS, count: 1 };
  MonkeyWorkers.prototype.deliver.call({ container: () => alloy }, courier);
  assert.equal(alloy.slots[2]?.item, BLOCK.PLANKS);
}
for (const id of ['alloy_furnace', 'bronze_hammer', 'bronze_armor']) {
  assert.ok(RECIPES.find(r => r.id === id && r.station === 'workbench'));
}
const inventory = new Inventory();
inventory.add(ITEM.BRONZE_INGOT, METALS.crafting.bronzeHammerIngots + METALS.crafting.bronzeArmorIngots);
inventory.add(BLOCK.WOOD, METALS.crafting.bronzeHammerWood);
for (const id of ['bronze_hammer', 'bronze_armor']) assert.ok(inventory.craft(RECIPES.find(r => r.id === id)));
assert.ok(inventory.slots.some(s => s?.item === ITEM.BRONZE_HAMMER));
assert.ok(inventory.slots.some(s => s?.item === ITEM.BRONZE_ARMOR));
console.log('OK: smelting, alloying, courier output/input, recipes and mining tiers');
