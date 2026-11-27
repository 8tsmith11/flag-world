// Creative "Infinite items": with it on, using an item (placing a block,
// eating, opening a crate...) keeps it; dropping still drops it; off, items
// are used up as usual; turning creative off turns it off.
//   node scripts/creative-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS } from '../shared/protocol.js';
import { BLOCK } from '../shared/blocks.js';

const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 3;
const session = { socket: { readyState: 1, send() {} }, creative: true, localHost: true };
game.members.set(1, { id: 1, name: 'Host', team: 0, color: TEAMS[0].color, ready: true, session });
game.members.set(2, { id: 2, name: 'Guest', team: 1, color: TEAMS[1].color, ready: true,
  session: { socket: { readyState: 1, send() {} }, creative: false, localHost: false } });
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '2' });
console.log = log;
const world = game.world, p = game.players.get(1);
session.player = p; p.creative = true;
const base = { x: Math.floor(p.state.x) + 2, y: Math.floor(p.state.y), z: Math.floor(p.state.z) };
for (let y = base.y; y < base.y + 4; y++) world.setBlock(base.x, y, base.z, BLOCK.AIR);
world.setBlock(base.x, base.y - 1, base.z, BLOCK.STONE);
const place = (dy) => game.stepPlace(p, { x: base.x, y: base.y + dy, z: base.z, nx: 0, ny: 1, nz: 0 }, 0);
p.inventory.slots[0] = { item: BLOCK.PLANKS, count: 1 }; p.selected = 0;

game.creativeAction(session, 'toggleInfinite');
assert.equal(p.infiniteItems, true);
place(0);
assert.equal(world.getBlock(base.x, base.y, base.z), BLOCK.PLANKS, 'nothing was placed');
assert.equal(p.inventory.slots[0]?.count, 1, 'placing used up the block with infinite items on');
// Dropping still drops it.
game.stepDrop(p, 0);
assert.equal(p.inventory.slots[0], null, 'dropping kept the item');

p.inventory.slots[0] = { item: BLOCK.PLANKS, count: 1 };
game.creativeAction(session, 'toggleInfinite');
assert.equal(p.infiniteItems, false);
place(1);
assert.equal(world.getBlock(base.x, base.y + 1, base.z), BLOCK.PLANKS);
assert.equal(p.inventory.slots[0], null, 'placing kept the block with infinite items off');

// Leaving creative turns it off.
game.creativeAction(session, 'toggleInfinite');
game.toggleCreative?.(session);
if (!session.creative) assert.equal(p.infiniteItems, false, 'infinite items stayed on outside creative');

console.log('OK: creative infinite items keep used items (not dropped ones), and turn off with creative');
