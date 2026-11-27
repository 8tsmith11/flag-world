// Cows follow a player holding wheat (their breeding food), like in
// Minecraft: they come from within COW_TEMPT_RANGE, stop a little short
// facing the player, keep following as the player moves, and lose interest
// when the wheat is put away. Panic still wins. Small world, seed 2, on a
// platform in the sky.
//   node scripts/cow-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS } from '../shared/protocol.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM } from '../shared/items.js';
import { TICK_RATE, COW_TEMPT_RANGE, COW_TEMPT_STOP } from '../shared/config.js';
import { Cow, Herd } from '../server/cow.js';

const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 3;
for (let i = 1; i <= 2; i++) game.members.set(i, { id: i, name: `Test ${i}`, team: i - 1, color: TEAMS[i - 1].color, ready: true,
  session: { socket: { readyState: 1, send() {} }, creative: false, localHost: false } });
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '2' });
console.log = log;
const world = game.world, host = game.players.get(1), enemy = game.players.get(2);
host.immortal = true;
const ox = Math.floor(host.state.x) - 20, oz = Math.floor(host.state.z) - 20, Y = world.sizeY - 30;
for (let x = ox; x < ox + 48; x++) for (let z = oz; z < oz + 48; z++) world.setBlock(x, Y, z, BLOCK.STONE);
const at = (who, dx, dz) => Object.assign(who.state, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0 });
at(host, 12, 5); at(enemy, 45, 45);
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };
const hold = (item) => { host.selected = 0; host.inventory.slots[0] = item ? { item, count: 16 } : null; };
const herd = new Herd(game.nextId++);
const cow = new Cow(game.nextId++, herd, ox + 5.5, Y + 1, oz + 5.5);
game.cows.set(cow.id, cow);
const gap = () => Math.hypot(cow.state.x - host.state.x, cow.state.z - host.state.z);
run(5);

// Holding wheat 7 blocks away: it comes over, stops short, faces the player.
hold(ITEM.WHEAT);
assert.ok(gap() < COW_TEMPT_RANGE);
run(TICK_RATE * 12, () => gap() <= COW_TEMPT_STOP + 0.6);
assert.ok(gap() <= COW_TEMPT_STOP + 0.6, `the cow did not come to the wheat (${gap().toFixed(1)} blocks)`);
run(TICK_RATE * 2);
assert.ok(gap() > 1, 'the cow walked into the player');
const facing = Math.atan2(-(host.state.x - cow.state.x), -(host.state.z - cow.state.z));
assert.ok(Math.abs(Math.atan2(Math.sin(cow.state.yaw - facing), Math.cos(cow.state.yaw - facing))) < 0.4, 'the cow is not facing the player');

// The player walks off, a few blocks at a time: it follows.
for (let step = 1; step <= 5; step++) { at(host, 12 + step * 2, 5 + step * 1.4); run(TICK_RATE); }
run(TICK_RATE * 10, () => gap() <= COW_TEMPT_STOP + 0.6);
assert.ok(gap() <= COW_TEMPT_STOP + 0.6, 'the cow did not follow');

// Wheat put away: it loses interest and stays put.
hold(BLOCK.DIRT);
at(host, 30, 12);
const before = { x: cow.state.x, z: cow.state.z };
run(TICK_RATE * 6);
assert.ok(gap() > 5, 'the cow followed a player without wheat');
assert.ok(Math.hypot(cow.state.x - before.x, cow.state.z - before.z) < 7, 'the cow went off chasing the player anyway');

// Too far away to notice: it doesn't come.
hold(ITEM.WHEAT);
// (It may still stroll a few blocks on its own, as cows do.)
at(host, Math.round(cow.state.x - ox) - COW_TEMPT_RANGE - 8, Math.round(cow.state.z - oz));
run(TICK_RATE * 6);
assert.ok(gap() > COW_TEMPT_RANGE, 'a cow came from beyond its tempt range');

// Panic beats wheat: hurt, it runs from the attacker even with wheat close by.
at(host, Math.round(cow.state.x - ox) + 3, Math.round(cow.state.z - oz));
run(TICK_RATE * 4);
at(enemy, Math.round(cow.state.x - ox) - 2, Math.round(cow.state.z - oz));
const start = Math.hypot(cow.state.x - enemy.state.x, cow.state.z - enemy.state.z);
game.hurtCow(cow, 1, enemy);
run(TICK_RATE * 3);
assert.ok(Math.hypot(cow.state.x - enemy.state.x, cow.state.z - enemy.state.z) > start + 3, 'a panicking cow followed the wheat instead of fleeing');

// Feeding it still puts it in love.
run(TICK_RATE * 8);
at(host, Math.round(cow.state.x - ox) + 2, Math.round(cow.state.z - oz));
game.feedCow(host, cow);
assert.ok(cow.loveUntil > game.tick, 'feeding wheat no longer works');

console.log('OK: cows come to a player holding wheat, stop short facing them, follow them, lose interest without wheat, ignore players out of range, flee when hurt, and still breed');
process.exit(0);
