// Plants drop only when broken with a hoe (HOE_DROPS): tufts, ferns,
// flowers, bushes, roots and vines give nothing by hand, by explosions or
// when their support goes; with a hoe they drop themselves (and tufts and
// ferns sometimes wheat seeds). Mushrooms and glow moss drop however they
// break. Checks blockDrops and a player breaking plants in a small world.
//   node scripts/plant-drops-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS } from '../shared/protocol.js';
import { BLOCK, VEGETATION_IDS, HOE_DROPS, blockDrops } from '../shared/blocks.js';
import { ITEM } from '../shared/items.js';

const always = () => 0;
for (const id of VEGETATION_IDS) {
  const free = id === BLOCK.MUSHROOM || id === BLOCK.GLOW_MUSHROOM || id === BLOCK.GLOW_MOSS;
  assert.equal(HOE_DROPS.has(id), !free, `plant ${id} in the wrong drop group`);
  for (const tool of [null, 'hammer']) {
    const drops = blockDrops(id, always, tool);
    if (free) assert.ok(drops.some((s) => s.item === id), `plant ${id} did not drop without a hoe`);
    else assert.deepEqual(drops, [], `plant ${id} dropped without a hoe (${tool})`);
  }
  assert.ok(blockDrops(id, always, 'hoe').some((s) => s.item === id), `plant ${id} did not drop with a hoe`);
}
for (const id of [BLOCK.GRASS_TUFT, BLOCK.FERN]) {
  assert.ok(blockDrops(id, always, 'hoe').some((s) => s.item === ITEM.WHEAT_SEEDS), 'no wheat seeds from a tuft or fern with a hoe');
  assert.ok(!blockDrops(id, always, null).length, 'wheat seeds from a tuft or fern without a hoe');
}
// Ordinary blocks don't care about the tool.
assert.ok(blockDrops(BLOCK.DIRT, always, null).some((s) => s.item === BLOCK.DIRT));

// In the game: a player breaking plants by hand and with a hoe.
const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 3;
for (let i = 1; i <= 2; i++) game.members.set(i, { id: i, name: `Test ${i}`, team: i - 1, color: TEAMS[i - 1].color, ready: true,
  session: { socket: { readyState: 1, send() {} }, creative: false, localHost: false } });
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '2' });
console.log = log;
const world = game.world, host = game.players.get(1);
const ox = Math.floor(host.state.x), oz = Math.floor(host.state.z), Y = world.sizeY - 30;
for (let x = ox - 4; x <= ox + 4; x++) for (let z = oz - 4; z <= oz + 4; z++) world.setBlock(x, Y, z, BLOCK.GRASS);
Object.assign(host.state, { x: ox + 0.5, y: Y + 1, z: oz + 0.5, vx: 0, vy: 0, vz: 0 });
const breakWith = (item, id, dx) => {
  const pos = { x: ox + dx, y: Y + 1, z: oz + 2 };
  world.setBlock(pos.x, pos.y, pos.z, id);
  host.selected = 0; host.inventory.slots[0] = item ? { item, count: 1 } : null;
  const before = new Set(game.items.keys());
  for (let i = 0; i < 40 && world.getBlock(pos.x, pos.y, pos.z) === id; i++) game.stepBreaking(host, pos);
  assert.equal(world.getBlock(pos.x, pos.y, pos.z), BLOCK.AIR, `plant ${id} was not broken`);
  return [...game.items.values()].filter((e) => !before.has(e.id)).map((e) => e.item);
};
assert.deepEqual(breakWith(null, BLOCK.FERN, -2), [], 'a fern broken by hand dropped something');
assert.deepEqual(breakWith(ITEM.WOOD_SWORD, BLOCK.RED_FLOWER, -1), [], 'a flower broken with a sword dropped something');
assert.ok(breakWith(ITEM.WOOD_HOE, BLOCK.RED_FLOWER, 0).includes(BLOCK.RED_FLOWER), 'a flower broken with a hoe dropped nothing');
assert.ok(breakWith(null, BLOCK.MUSHROOM, 1).includes(BLOCK.MUSHROOM), 'a mushroom broken by hand dropped nothing');
assert.ok(breakWith(null, BLOCK.GLOW_MOSS, 2).includes(BLOCK.GLOW_MOSS), 'glow moss broken by hand dropped nothing');

console.log('OK: plants drop only with a hoe (tufts and ferns give seeds then); mushrooms and glow moss drop however they break');
