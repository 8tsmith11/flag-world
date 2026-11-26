// Checks for the commerce, automation and defense update: sorting, shared
// hostility and turret targeting, reinforced walls and recipes. Later
// sections cover the merchant economy, monkeys and quests.
//   node scripts/commerce-check.js
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { BLOCK, getBlockDef, canBreak, breakTicks } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { getRecipe } from '../shared/recipes.js';
import { HAMMERS } from '../shared/tools.js';
import { sortSlots } from '../server/inventory.js';
import { TurretController } from '../server/turrets.js';
import { isHostileTo, hostileKind } from '../server/hostility.js';
import { NPC_KIND } from '../shared/npcs.js';
import { buyList, purchaseCosts, materialValue, merchantRequests, MERCHANT_SELLS, babyPrice } from '../shared/merchant.js';
import { Depot, DEPOT_OUTPUTS } from '../server/containers.js';
import { MonkeyWorkers } from '../server/monkeyWorkers.js';
import { MERCHANT } from '../shared/config.js';

// ---- Sorting ----
{
  const slots = Array(36).fill(null);
  slots[0] = { item: ITEM.WOOD_SWORD, count: 1 };
  slots[10] = { item: BLOCK.DIRT, count: 40 };
  slots[12] = { item: BLOCK.STONE, count: 5 };
  slots[15] = { item: BLOCK.DIRT, count: 40 };
  slots[20] = { item: ITEM.IRON_SWORD, count: 1, mods: [{ id: 'sharp', value: 1 }] };
  slots[21] = { item: ITEM.IRON_SWORD, count: 1 };
  slots[30] = { item: BLOCK.STONE, count: 60 };
  slots[35] = { item: ITEM.IRON_INGOT, count: 3 };
  const totals = (list) => list.reduce((m, s) => s ? m.set(s.item, (m.get(s.item) ?? 0) + s.count) : m, new Map());
  const before = totals(slots.slice(9));
  assert.ok(sortSlots(slots, 9));
  assert.deepEqual(totals(slots.slice(9)), before, 'sorting changed item totals');
  assert.deepEqual(slots[0], { item: ITEM.WOOD_SWORD, count: 1 }, 'hotbar moved');
  const main = slots.slice(9).filter(Boolean);
  assert.equal(main[0].item, ITEM.IRON_SWORD); assert.equal(main[1].mods?.[0]?.id, 'sharp', 'modded sword kept apart, after the plain one');
  assert.deepEqual(main.slice(2, 4), [{ item: BLOCK.DIRT, count: 64 }, { item: BLOCK.DIRT, count: 16 }]);
  assert.deepEqual(main.slice(4, 6), [{ item: BLOCK.STONE, count: 64 }, { item: BLOCK.STONE, count: 1 }]);
  assert.deepEqual(main[6], { item: ITEM.IRON_INGOT, count: 3 });
  assert.equal(sortSlots(slots, 9), false, 'sorting twice changes nothing');
}

// ---- Reinforced walls ----
{
  const recipe = getRecipe('reinforced_wall');
  assert.equal(recipe.station, 'workbench');
  assert.equal(recipe.count, 10);
  assert.deepEqual(recipe.inputs, [{ item: ITEM.IRON_INGOT, count: 1 }, { item: BLOCK.STONE_BRICKS, count: 10 }]);
  const wall = getBlockDef(BLOCK.REINFORCED_WALL), bricks = getBlockDef(BLOCK.STONE_BRICKS);
  assert.ok(!canBreak(BLOCK.REINFORCED_WALL, HAMMERS[ITEM.BRONZE_HAMMER].strength), 'bronze hammer breaks reinforced walls');
  assert.ok(canBreak(BLOCK.REINFORCED_WALL, HAMMERS[ITEM.IRON_HAMMER].strength), 'iron hammer cannot break reinforced walls');
  assert.equal(breakTicks(BLOCK.REINFORCED_WALL, 2), breakTicks(BLOCK.STONE_BRICKS, 2) * 4);
  assert.ok(wall.blastResistance > bricks.blastResistance && bricks.blastResistance > getBlockDef(BLOCK.STONE).blastResistance);
  assert.equal(getRecipe('spyglass').inputs.map(i => i.item).join(), [ITEM.BRONZE_INGOT, BLOCK.GLASS].join());
  assert.equal(getItemDef(ITEM.GOLD_COIN).maxStack, 64);
}

// ---- Hostility and turret targeting ----
const target = (props) => ({ connected: true, dead: false, eliminated: false, invisible: false,
  state: { x: 29.5, y: 1, z: 10.5, crouching: false }, ...props });
{
  const enemy = target({ id: 2, type: 'player', team: 1 }), friend = target({ id: 3, type: 'player', team: 0 });
  const goblin = target({ id: 4, type: 'goblinSoldier', goblin: true, faction: 'goblin', state: { x: 29.5, y: 1, z: 10.5, box: { halfW: 0.35, height: 1.5 } } });
  const enemyMonkey = target({ id: 5, type: 'npc', npc: NPC_KIND.WORK_MONKEY, team: 1, state: { x: 29.5, y: 1, z: 10.5, box: { halfW: 0.4, height: 1.4 } } });
  const ownMonkey = { ...enemyMonkey, id: 6, team: 0 }, wild = { ...enemyMonkey, id: 7, team: null }, baby = { ...enemyMonkey, id: 8, baby: true };
  const cow = target({ id: 9, type: 'cow' }), crawler = target({ id: 10, type: 'crawler' });
  assert.equal(hostileKind(0, enemy), 'player'); assert.equal(hostileKind(0, friend), null);
  assert.equal(hostileKind(0, goblin), 'goblin'); assert.equal(hostileKind(0, enemyMonkey), 'monkey');
  for (const t of [ownMonkey, wild, baby, cow]) assert.equal(isHostileTo(0, t), false, `${t.id} counted as hostile`);
  assert.equal(hostileKind(0, crawler), 'creature');

  // A turret on team 0 with each kind of target in turn, in the open.
  const shoot = (who) => {
    const world = new World(1, 64, 64);
    for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) world.setBlock(x, 0, z, BLOCK.STONE);
    world.setBlock(10, 1, 10, BLOCK.ARROW_TURRET);
    const game = { world, players: new Map(), mobs: new Map(), dragons: new Map(), npcs: new Map(),
      arrows: new Map(), nextId: 100, broadcast() {} };
    for (const t of who) (t.type === 'player' ? game.players : t.type === 'npc' ? game.npcs : game.mobs).set(t.id, t);
    const turrets = new TurretController(game);
    turrets.place(10, 1, 10, BLOCK.ARROW_TURRET, 0);
    for (let tick = 1; tick <= 10; tick++) turrets.step(tick);
    return game.arrows.size;
  };
  assert.equal(shoot([goblin]), 1, 'turret ignores a goblin');
  assert.equal(shoot([enemyMonkey]), 1, 'turret ignores a hostile monkey');
  assert.equal(shoot([enemy]), 1, 'turret ignores an enemy player');
  assert.equal(shoot([friend, ownMonkey, wild, cow]), 0, 'turret shot at something friendly');
  // A goblin that dies is dropped and the turret picks the next target.
  goblin.dead = true;
  assert.equal(shoot([goblin, enemy]), 1, 'turret did not move on from a dead goblin');
  goblin.dead = false;
}

// ---- Merchant economy: no money loops ----
// For every seed's buy list (requests included), what the merchant pays per
// item must be less than the cheapest way to get that item with coins:
// buying it, or buying what makes it and crafting, smelting, crushing or
// alloying (fuel and steam counted as free, which only makes this stricter).
{
  const costs = purchaseCosts();
  for (let seed = 0; seed < 300; seed++) {
    const requests = merchantRequests(seed);
    assert.equal(requests.length, MERCHANT.requests, `seed ${seed} has ${requests.length} requests`);
    assert.deepEqual(requests, merchantRequests(seed), 'requests are not deterministic');
    for (const r of requests) {
      assert.ok(r.coins > materialValue(r.item), `request ${r.recipe} pays no more than its materials`);
      assert.ok(!MERCHANT_SELLS.some((o) => o.item === r.item), `requested ${r.recipe} is also sold`);
    }
    for (const o of buyList(seed)) {
      const pay = o.coins / o.count, cost = costs.get(o.item) ?? Infinity;
      assert.ok(pay < cost - 1e-9, `seed ${seed}: ${getItemDef(o.item).name} pays ${pay} per item but costs ${cost} to buy back`);
    }
  }
  assert.ok(babyPrice(1) > babyPrice(0) && babyPrice(2) > babyPrice(1));
}

// ---- Depot: selling slots, coin output, couriers ----
{
  const { setDepotOffers } = await import('../server/containers.js');
  setDepotOffers(buyList(1));
  const depot = new Depot();
  assert.equal(depot.insert({ item: BLOCK.DIRT, count: 5 }), false, 'depot took dirt');
  const wood = { item: BLOCK.WOOD, count: 20 };
  assert.ok(depot.insert(wood)); assert.equal(wood.count, 0);
  const workers = Object.create(MonkeyWorkers.prototype);
  workers.container = () => depot;
  // Couriers may deliver sellable goods (not dirt) and take only coins out.
  assert.ok(workers.accepts({}, [{ stack: { item: BLOCK.STONE, count: 4 } }]));
  assert.ok(!workers.accepts({}, [{ stack: { item: BLOCK.DIRT, count: 4 } }]));
  assert.deepEqual(workers.sourceSlots(depot), DEPOT_OUTPUTS);
  assert.deepEqual(depot.sellOne(), { item: BLOCK.WOOD, count: 8, coins: 1 });
  assert.deepEqual(depot.sellOne(), { item: BLOCK.WOOD, count: 8, coins: 1 });
  assert.equal(depot.sellOne(), null, '4 wood is not a batch');
  assert.equal(depot.slots[DEPOT_OUTPUTS[0]].count, 2);
}

console.log('OK: sorting, reinforced walls, recipes, hostility and turret targeting, no merchant money loops (300 seeds), depot');
