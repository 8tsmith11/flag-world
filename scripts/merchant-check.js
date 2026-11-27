// Full-match checks for the Sky Merchant: depot placement rules, the daily
// airship cycle, trading, automated depot sales, killing and replacement,
// baby monkeys and their prices, and quest rewards. Small world, seed 1.
//   node scripts/merchant-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS, S2C } from '../shared/protocol.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { ITEM } from '../shared/items.js';
import { MERCHANT, MONKEY_DUTY, TICK_RATE, DAY_LENGTH, DAY_START } from '../shared/config.js';
import { checkDepotSite, babyPrice, DOCK_DIRS } from '../shared/merchant.js';
import { SkyMerchant } from '../server/merchants.js';

const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 3;
const sent = new Map();
const socketFor = (id) => ({ readyState: 1, send: (data) => { const msg = JSON.parse(data); (sent.get(id) ?? sent.set(id, []).get(id)).push(msg); } });
for (let i = 1; i <= 2; i++) game.members.set(i, { id: i, name: `Test ${i}`, team: i - 1, color: TEAMS[i - 1].color, ready: true,
  session: { socket: socketFor(i), creative: false, localHost: false } });
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '1' });
console.log = log;
const world = game.world, host = game.players.get(1), enemy = game.players.get(2);
const messages = (id, type) => (sent.get(id) ?? []).filter((m) => m.type === type);
// Forward to the next time of day t (days keep counting up).
const setTime = (t) => {
  const now = DAY_START + game.dayOffset + game.tick / (DAY_LENGTH * TICK_RATE);
  let target = Math.floor(now) + t; if (target <= now) target++;
  game.dayOffset = target - DAY_START - game.tick / (DAY_LENGTH * TICK_RATE);
};
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };

// ---- Find a depot site on the far edge of team 0's island ----
const island = game.merchants.teamIsland(host.team);
let site = null;
for (let a = 0; a < 720 && !site; a++) {
  const angle = a / 720 * Math.PI * 2;
  for (let r = island.radius * 1.2; r > island.radius * 0.5 && !site; r -= 1) {
    const x = Math.floor(island.x + Math.cos(angle) * r), z = Math.floor(island.z + Math.sin(angle) * r);
    const top = world.getSurfaceY(x, z, isSolid);
    if (top < world.minY || world.getBlock(x, top, z) !== BLOCK.GRASS) continue;
    const pos = { x, y: top + 1, z };
    if (world.getBlock(x, pos.y, z) !== BLOCK.AIR || world.getBlock(x, pos.y + 1, z) !== BLOCK.AIR) continue;
    const check = checkDepotSite(world, pos, island);
    if (check.ok) site = { pos, facing: check.facing };
    break;
  }
}
assert.ok(site, 'no valid depot site on the team island');
const { pos, facing } = site, [fx, fz] = DOCK_DIRS[facing];
// The player stands two blocks behind the depot (island side).
const stand = { x: pos.x - fx * 2 + 0.5, y: pos.y, z: pos.z - fz * 2 + 0.5 };
for (let dy = 0; dy < 3; dy++) world.setBlock(Math.floor(stand.x), pos.y + dy, Math.floor(stand.z), BLOCK.AIR);
world.setBlock(Math.floor(stand.x), pos.y - 1, Math.floor(stand.z), BLOCK.STONE);
Object.assign(host.state, { ...stand, vx: 0, vy: 0, vz: 0 });

// Wrong places are refused with a reason; the item stays.
host.inventory.slots[0] = { item: BLOCK.MERCHANT_DEPOT, count: 1 };
const inland = { x: Math.floor(island.x), y: world.getSurfaceY(Math.floor(island.x), Math.floor(island.z), isSolid) + 1, z: Math.floor(island.z) };
assert.equal(checkDepotSite(world, inland, island).ok, false, 'depot allowed in the middle of the island');
game.stepPlace(host, { ...inland, nx: 0, ny: 1, nz: 0 }, 0);
assert.equal(host.inventory.slots[0]?.item, BLOCK.MERCHANT_DEPOT, 'refused placement used up the depot');
// The real place works.
game.stepPlace(host, { ...pos, nx: 0, ny: 1, nz: 0 }, 0);
assert.equal(world.getBlock(pos.x, pos.y, pos.z), BLOCK.MERCHANT_DEPOT, 'depot not placed at a valid site');
assert.equal(host.inventory.slots[0], null);
assert.deepEqual(game.merchants.record(host.team).depot, { ...pos, facing });
// A second depot for the same team is refused, and requests are refused while one stands.
host.inventory.slots[1] = { item: BLOCK.MERCHANT_DEPOT, count: 1 };
assert.equal(game.merchants.canPlaceDepot(host, pos).ok, false);
host.inventory.slots[1] = null;
assert.match(game.merchants.requestDepot(host), /still standing/);

// ---- Arrival ----
setTime(MERCHANT.arriveTime + 0.01);
const r = game.merchants.record(host.team);
assert.ok(run(5, () => r.phase === 'arriving'), 'merchant did not set off in the morning');
const ship = r.ship, start = { ...ship.state };
assert.ok(Math.hypot(start.x - pos.x, start.z - pos.z) > MERCHANT.approachDistance * 0.9, 'airship starts too close');
// It comes from the far side: the start lies out along the dock direction.
assert.ok((start.x - pos.x) * fx + (start.z - pos.z) * fz > MERCHANT.approachDistance * 0.9, 'airship does not come from the far side');
assert.ok(run(MERCHANT.flightSeconds * TICK_RATE + 10, () => r.phase === 'docked'), 'airship never docked');
const merchant = r.merchant;
assert.ok(merchant instanceof SkyMerchant && game.npcs.has(merchant.id));
run(MERCHANT.walkSeconds * TICK_RATE + 2);
assert.ok(Math.hypot(merchant.state.x - pos.x - 0.5, merchant.state.z - pos.z - 0.5) < 3, 'merchant did not step off beside the depot');
assert.ok(messages(1, S2C.NOTICE).some((m) => /docked/.test(m.text)), 'team not told of the arrival');
assert.ok(!messages(2, S2C.NOTICE).some((m) => /docked/.test(m.text)), 'enemy told of the arrival');
const depot = world.tileEntities.get(`${pos.x},${pos.y},${pos.z}`);
assert.equal(depot.present, true);

// ---- Trading ----
Object.assign(host.state, { x: merchant.state.x + 1, y: merchant.state.y, z: merchant.state.z });
game.talk(host, merchant.id);
assert.equal(messages(1, S2C.MERCHANT).at(-1)?.open, true, 'trade screen did not open');
game.tick += TICK_RATE * 2; game.talk(enemy, merchant.id);
assert.ok(!messages(2, S2C.MERCHANT).length, 'enemy got the trade screen');
const coins = () => game.merchants.coins(host);
host.inventory.slots.fill(null);
host.inventory.add(BLOCK.WOOD, 20);
game.merchants.action(host, { action: 'sell', item: BLOCK.WOOD, all: true });
assert.equal(coins(), 2, 'selling 16 of 20 wood did not pay 2 coins');
assert.equal(host.inventory.slots.reduce((n, s) => n + (s?.item === BLOCK.WOOD ? s.count : 0), 0), 4);
game.merchants.action(host, { action: 'buy', offer: 'iron' });
assert.equal(coins(), 2, 'bought iron without enough coins');
host.inventory.add(ITEM.GOLD_COIN, 200);
game.merchants.action(host, { action: 'buy', offer: 'iron', times: 12 });
assert.equal(coins(), 202 - 60);
game.merchants.action(host, { action: 'buy', offer: 'iron' });
assert.equal(coins(), 142, 'bought past the daily stock');
assert.match(messages(1, S2C.MERCHANT).at(-1).message, /sold out/);

// ---- Automated depot sales ----
depot.slots[0] = { item: BLOCK.STONE, count: 64 };
depot.slots[1] = { item: BLOCK.DIRT, count: 5 };
assert.equal(depot.insert({ item: BLOCK.DIRT, count: 3 }), false, 'depot accepted something unsellable');
run(MERCHANT.sellTicks * 3);
assert.equal(depot.slots[0], null, 'depot did not sell its stone');
assert.equal(depot.slots.find((s) => s?.item === ITEM.GOLD_COIN)?.count, 2);
assert.deepEqual(depot.slots[1], { item: BLOCK.DIRT, count: 5 }, 'unsellable item disappeared');
// A full coin output stops sales.
for (const i of [9, 10, 11, 12, 13, 14, 15, 16, 17]) depot.slots[i] = { item: ITEM.GOLD_COIN, count: 64 };
depot.slots[0] = { item: BLOCK.WOOD, count: 8 };
run(MERCHANT.sellTicks * 3);
assert.deepEqual(depot.slots[0], { item: BLOCK.WOOD, count: 8 }, 'sold with a full coin output');
for (const i of [9, 10, 11, 12, 13, 14, 15, 16, 17]) depot.slots[i] = null;

// ---- Baby monkeys ----
const before = babyPrice(0);
const npcsBefore = game.npcs.size;
game.merchants.action(host, { action: 'baby' });
const baby = [...game.npcs.values()].find((n) => n.baby);
assert.ok(baby && game.npcs.size === npcsBefore + 1, 'no baby monkey');
// It starts wild: right clicking it starts its taming game, and winning tames it.
assert.equal(baby.team, null, 'a bought baby monkey started tamed');
game.monkeys.open(host, baby);
const session = game.monkeys.sessions.get(host.id);
assert.equal(session?.monkey, baby, 'a wild baby did not offer its taming game');
game.monkeys.tamingResult(session, 'won');
assert.equal(baby.team, host.team, 'winning did not tame the baby');
assert.ok(baby.baby, 'taming made the baby grow up');
assert.equal(coins(), 142 - before);
assert.equal(babyPrice(1) > before, true);
game.merchants.action(host, { action: 'baby' });
assert.equal(coins(), 142 - before - babyPrice(1), 'second baby did not cost more');
assert.equal(game.merchants.record(host.team).babies, 2);
// Babies take no job but Idle, and nothing hostile targets them.
game.monkeys.action(host, { id: baby.id, action: 'configure', revision: 0, config: { ...baby.config, role: 'guard' } });
assert.equal(baby.config.role, 'idle', 'a baby took a role');
// Idle (with a home spot) is the one job a baby takes, and it goes there.
const home = { x: Math.floor(baby.state.x) + 2, y: Math.floor(baby.state.y) - 1, z: Math.floor(baby.state.z) };
const revision = baby.revision;
game.monkeys.action(host, { id: baby.id, action: 'configure', revision, config: { ...baby.config, role: 'idle', home } });
assert.equal(baby.revision, revision + 1, 'a baby could not be set to Idle');
assert.deepEqual(baby.config.home, home, 'a baby\'s home spot was not kept');
assert.ok(baby.baby);
// It can be sent back to the keep, like an adult.
game.monkeys.action(host, { id: baby.id, action: 'teleportHome' });
assert.ok(Math.hypot(baby.state.x - host.keep.cx - 0.5, baby.state.z - host.keep.cz - 0.5) <= 4.5, 'a baby could not be sent back to the keep');
Object.assign(host.state, { x: baby.state.x + 1, y: baby.state.y, z: baby.state.z });
baby.growAt = game.tick + 2; run(TICK_RATE);
assert.equal(baby.baby, false, 'baby did not grow up');

// ---- Killing the merchant ----
const name = merchant.name;
const dropsBefore = game.items.size;
Object.assign(enemy.state, { x: merchant.state.x + 1, y: merchant.state.y, z: merchant.state.z });
game.hurt(merchant, 1000, host);
assert.equal(merchant.dead, false, 'his own team hurt the merchant');
game.hurt(merchant, 1000, enemy);
assert.equal(merchant.dead, true);
assert.equal(game.items.size, dropsBefore, 'the merchant dropped something');
assert.equal(depot.present, false);
assert.ok(run(5, () => r.phase === 'departing'), 'airship did not leave after the merchant died');
run(MERCHANT.flightSeconds * TICK_RATE + 5);
assert.equal(r.phase, 'away');
assert.ok(!run(TICK_RATE * 5, () => r.phase !== 'away'), 'a new merchant came the same day');
// Next morning: a new merchant with another name.
setTime(MERCHANT.arriveTime + 0.005);
assert.ok(run(MERCHANT.flightSeconds * TICK_RATE + 40, () => r.phase === 'docked'), 'no new merchant next morning');
assert.notEqual(r.merchant.name, name, 'the replacement merchant has the same name');
assert.equal(game.merchants.record(host.team).babies, 2, 'baby purchases reset with the new merchant');

// ---- Night: he leaves ----
setTime(MERCHANT.departTime + 0.01);
assert.ok(run(MERCHANT.walkSeconds * TICK_RATE + 10, () => r.phase === 'departing'), 'merchant did not leave at night');
assert.equal(depot.present, false);

// ---- Losing the depot ----
game.breakBlock(pos.x, pos.y, pos.z);
assert.equal(game.merchants.record(host.team).depot, null);
assert.match(game.merchants.requestDepot(host) ?? '', /lying on the ground/, 'request ignored the dropped depot');
for (const e of [...game.items.values()]) if (e.item === BLOCK.MERCHANT_DEPOT) game.removeItem(e);
game.tick += TICK_RATE * 10;
assert.equal(game.merchants.requestDepot(host), null, 'replacement refused after the depot was lost');
assert.ok(host.inventory.slots.some((s) => s?.item === BLOCK.MERCHANT_DEPOT));

// ---- Saves keep depots, babies bought and quest progress ----
const { serializeGame } = await import('../server/save.js');
const save = JSON.parse(JSON.stringify(serializeGame(game)));
assert.equal(save.merchants.find((m) => m.team === host.team).babies, 2);
assert.ok(save.teamProgress.find((t) => t.team === host.team).events.some(([k]) => k === 'babyMonkey'));
console.log('OK: depot placement and limits, arrival from the far side, docking, trading and stock, depot sales,',
  'babies and prices, killing and replacement, night departure, replacement depots, saves');
process.exit(0);
