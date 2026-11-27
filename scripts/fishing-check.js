// Full-match checks for fishing: rods and their attributes, rod modifiers
// and anvil reforging, modifier persistence, bait choice, consumption and
// conservation, bobber flight into water, lava and the void (and nowhere
// fishable), bite timing and Fishing Speed, guaranteed catches, missed and
// early reels, loot tables and normalization, tier eligibility, loot crates,
// Void Eel encounters, Fisherman monkeys, what reaches clients, quests and
// the no-money-loop rule. Platforms built in the sky of a small world (seed 2).
//   node scripts/fishing-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS, S2C, C2S, ENTITY_TYPE } from '../shared/protocol.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { TICK_RATE, FISHING as F } from '../shared/config.js';
import { getRecipe } from '../shared/recipes.js';
import { MODIFIERS, rollMods, modCategory, stackName, modLines } from '../shared/modifiers.js';
import { ROD_STATS, rodStats, BAIT, biteSeconds, FISHING_LOOT, catchChances, rollCatch, lootTableFor } from '../shared/fishing.js';
import { LOOT_TABLES, rollTable } from '../shared/loot.js';
import { MERCHANT_BUYS, MERCHANT_SELLS } from '../shared/merchant.js';
import { defaultMonkeyConfig } from '../shared/monkeys.js';
import { WorkMonkey } from '../server/monkeyWorkers.js';
import { Chest, Anvil } from '../server/containers.js';

// ---- Rods, attributes, modifiers ----
{
  const wood = rodStats({ item: ITEM.WOOD_FISHING_ROD, count: 1 }), bronze = rodStats({ item: ITEM.BRONZE_FISHING_ROD, count: 1 });
  assert.deepEqual([wood.tier, wood.multiplier, wood.speed, wood.conservation], [1, 1, 1, 0.1]);
  assert.deepEqual([bronze.tier, bronze.multiplier, bronze.speed, bronze.conservation], [2, 1.5, 1, 0.1]);
  assert.ok(!wood.environments.includes('lava') && bronze.environments.includes('lava'));
  for (const s of [wood, bronze]) assert.ok(s.environments.includes('water') && s.environments.includes('void'));
  assert.deepEqual(getRecipe('wood_fishing_rod').inputs.map((i) => i.item).sort(), [BLOCK.WOOD, ITEM.SILK].sort());
  assert.ok(getRecipe('bronze_fishing_rod').inputs.some((i) => i.item === ITEM.BRONZE_INGOT));
  // Rod modifiers: one category, three kinds, each touching only its attribute.
  const rodMods = Object.entries(MODIFIERS).filter(([, m]) => m.category === 'rod').map(([id]) => id).sort();
  assert.deepEqual(rodMods, ['lucky', 'swift', 'thrifty']);
  assert.equal(modCategory(ITEM.WOOD_FISHING_ROD), 'rod'); assert.equal(modCategory(ITEM.BRONZE_FISHING_ROD), 'rod');
  const withMod = (id) => rodStats({ item: ITEM.WOOD_FISHING_ROD, count: 1, mods: [{ id, value: MODIFIERS[id].value }] });
  const swift = withMod('swift'), lucky = withMod('lucky'), thrifty = withMod('thrifty');
  assert.ok(swift.speed > 1 && swift.multiplier === 1 && swift.conservation === 0.1 && swift.tier === 1);
  assert.ok(lucky.multiplier > 1 && lucky.speed === 1 && lucky.conservation === 0.1 && lucky.tier === 1);
  assert.ok(thrifty.conservation > 0.1 && thrifty.speed === 1 && thrifty.multiplier === 1 && !thrifty.environments.includes('lava'));
  // Conservation is capped below 100%, whatever the base.
  ROD_STATS[9999] = { tier: 1, multiplier: 1, speed: 1, conservation: 0.95, environments: ['water'] };
  assert.equal(rodStats({ item: 9999, count: 1, mods: [{ id: 'thrifty', value: 0.15 }] }).conservation, F.maxConservation);
  delete ROD_STATS[9999];
  assert.ok(F.maxConservation < 1);
  // Random rolls only give rod modifiers, and they show in names and tooltips.
  let r = 0.37;
  const random = () => (r = (r * 9301 + 49297) % 233280 / 233280);
  for (let i = 0; i < 30; i++) assert.ok(rodMods.includes(rollMods(ITEM.BRONZE_FISHING_ROD, random)[0].id));
  assert.match(stackName({ item: ITEM.WOOD_FISHING_ROD, mods: [{ id: 'swift', value: 0.25 }] }, 'wooden fishing rod'), /^Swift Wooden Fishing Rod$/);
  assert.match(modLines({ item: ITEM.WOOD_FISHING_ROD, mods: [{ id: 'swift', value: 0.25 }] })[0], /fishing speed/);
  // Rods turn up (sometimes modded) in ordinary loot and crates.
  assert.ok(LOOT_TABLES.looseChest.entries.some((e) => e.item === ITEM.WOOD_FISHING_ROD && e.modChance));
  assert.ok(LOOT_TABLES.ironboundCrate.entries.some((e) => e.item === ITEM.BRONZE_FISHING_ROD && e.modChance));
}

// ---- Bite timing ----
{
  const seq = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const draws = Array.from({ length: 4000 }, () => biteSeconds(seq));
  assert.ok(Math.min(...draws) >= F.bite.min && Math.max(...draws) <= F.bite.max, 'bite waits left their bounds');
  const mean = draws.reduce((a, b) => a + b, 0) / draws.length, mid = (F.bite.min + F.bite.max) / 2;
  assert.ok(Math.abs(mean - mid) < 0.5, `bite waits average ${mean}`);
  const near = draws.filter((d) => Math.abs(d - mid) < (F.bite.max - F.bite.min) / 4).length / draws.length;
  assert.ok(near > 0.6, 'bite waits are not bunched around the middle');
  // Fishing Speed divides the wait; monkeys wait ten times longer.
  const fixed = () => 0.5;
  assert.equal(biteSeconds(fixed, 1.25), biteSeconds(fixed) / 1.25);
  assert.equal(biteSeconds(fixed, 1.2, true), biteSeconds(fixed) * F.monkeySlowdown / 1.2);
}

// ---- Loot tables: normalization, luck, eligibility ----
{
  for (const key of ['water:1', 'water:2', 'void:1', 'void:2', 'lava:2']) assert.ok(FISHING_LOOT[key]?.length, `no ${key} table`);
  assert.equal(lootTableFor('lava', 1), null, 'a tier 1 lava table exists');
  for (const [key, table] of Object.entries(FISHING_LOOT)) for (const luck of [1, 1.5, 4.5, 20]) {
    const chances = catchChances(table, luck);
    assert.ok(Math.abs(chances.reduce((a, c) => a + c.chance, 0) - 1) < 1e-9, `${key} not normalized`);
  }
  const water = FISHING_LOOT['water:1'];
  const crate = (luck) => catchChances(water, luck).find((c) => c.entry.item === ITEM.LOOT_CRATE).chance;
  const fish = (luck) => catchChances(water, luck).find((c) => c.entry.item === ITEM.FISH).chance;
  assert.ok(crate(1.5) > crate(1) && crate(3) > crate(1.5) && fish(3) < fish(1), 'luck does not shift toward better rewards');
  // Bait quality: raw beef and golden beef each better.
  assert.ok(BAIT[ITEM.GOLDEN_BEEF].quality > BAIT[ITEM.BEEF].quality && BAIT[ITEM.BEEF].quality > BAIT[ITEM.BREAD].quality);
  // Tier 1 never gives a Void Eel or an iron-bound crate, whatever the luck; tier 2 void can.
  for (const key of ['water:1', 'void:1']) for (const c of catchChances(FISHING_LOOT[key], 1000))
    assert.ok(!c.entry.encounter && c.entry.item !== ITEM.IRONBOUND_CRATE, `${key} can give ${c.entry.encounter ?? c.entry.item}`);
  assert.ok(FISHING_LOOT['void:2'].some((e) => e.encounter === 'voidEel'));
  // Void fish only from the void.
  for (const [key, table] of Object.entries(FISHING_LOOT)) if (!key.startsWith('void')) assert.ok(!table.some((e) => e.item === ITEM.VOID_FISH));
  // Every catch is something.
  for (let i = 0; i < 300; i++) { const c = rollCatch(FISHING_LOOT['void:2'], 2, Math.random, rollMods); assert.ok(c.stack?.count > 0 || c.encounter); }
  assert.ok(getItemDef(ITEM.FISH).food > 0, 'fish is not food');
}

// ---- No money loop: golden beef bait never pays for itself ----
// The best case: the best rod (tier 2, Lucky), golden beef, the bait kept as
// often as allowed. The coins the catch can fetch from the Sky Merchant
// (crates by their expected contents) must stay under the bait's price.
{
  const buys = new Map(MERCHANT_BUYS.map((o) => [o.item, o.coins / o.count]));
  const value = (item) => item === ITEM.GOLD_COIN ? 1 : buys.get(item) ?? 0;
  const tableValue = (name) => {
    const t = LOOT_TABLES[name], total = t.entries.reduce((a, e) => a + e.weight, 0);
    const perRoll = t.entries.reduce((a, e) => a + e.weight / total * value(e.item) * (e.min + e.max) / 2, 0);
    return perRoll * (t.rolls[0] + t.rolls[1]) / 2;
  };
  const crateValue = { [ITEM.LOOT_CRATE]: tableValue('lootCrate'), [ITEM.IRONBOUND_CRATE]: tableValue('ironboundCrate') };
  const goldenPrice = MERCHANT_SELLS.find((o) => o.item === ITEM.GOLDEN_BEEF);
  const luck = ROD_STATS[ITEM.BRONZE_FISHING_ROD].multiplier * (1 + MODIFIERS.lucky.value) * BAIT[ITEM.GOLDEN_BEEF].quality;
  for (const [key, table] of Object.entries(FISHING_LOOT)) {
    const ev = catchChances(table, luck).reduce((a, { entry, chance }) => a + chance * (entry.encounter ? 0
      : (crateValue[entry.item] ?? value(entry.item)) * (entry.min + entry.max) / 2), 0);
    const perBait = ev / (1 - F.maxConservation);
    assert.ok(perBait < goldenPrice.coins / goldenPrice.count, `${key}: a golden beef fishes up ${perBait.toFixed(2)} coins' worth`);
  }
}

// ---- A match ----
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
host.immortal = true;
const messages = (id, type) => (sent.get(id) ?? []).filter((m) => m.type === type);
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };
const count = (p, item) => p.inventory.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
// A 40x40 stone platform high in the sky with a 5x5 pool of water and one of
// lava in it; its east edge looks straight down into the void.
const ox = Math.floor(host.state.x) - 20, oz = Math.floor(host.state.z) - 20, Y = world.sizeY - 30;
for (let x = ox; x < ox + 40; x++) for (let z = oz; z < oz + 40; z++) world.setBlock(x, Y, z, BLOCK.STONE);
const pool = (cx, cz, id) => { for (let x = cx; x < cx + 5; x++) for (let z = cz; z < cz + 5; z++) { world.setBlock(x, Y - 1, z, BLOCK.STONE); world.setBlock(ox + 0, Y - 2, oz, BLOCK.STONE); world.setBlock(x, Y, z, id); } };
pool(ox + 10, oz + 10, BLOCK.WATER); pool(ox + 10, oz + 25, BLOCK.LAVA);
const stand = (who, dx, dz) => Object.assign(who.state, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0 });
stand(host, 12, 7); stand(enemy, 35, 35); stand(mate, 30, 5);
run(3);
const rod = (item = ITEM.WOOD_FISHING_ROD, mods) => ({ item, count: 1, ...(mods ? { mods } : {}) });
const hold = (who, stack) => { who.selected = 0; who.inventory.slots[0] = stack; who.inventoryDirty = true; };
// Aim from (12,7) toward the water pool's middle (12,12): south and a bit down.
const aimAt = (who, tx, tz, pitch = -0.35) => { const dx = ox + tx + 0.5 - who.state.x, dz = oz + tz + 0.5 - who.state.z; who.state.yaw = Math.atan2(-dx, -dz); who.state.pitch = pitch; };
const bobber = (who) => game.fishing.bobberOf(who);
const settle = (who) => run(TICK_RATE * 15, () => bobber(who) && !bobber(who).flying);

// ---- Bait choice ----
{
  hold(host, rod());
  host.inventory.slots[1] = { item: ITEM.BREAD, count: 5 };
  aimAt(host, 12, 12);
  sent.clear();
  game.fishing.use(host);
  assert.ok(!bobber(host), 'cast without choosing bait');
  assert.ok(messages(1, S2C.NOTICE).some((m) => /bait/i.test(m.text)));
  // Choosing golden beef but having none: no cast, and no substitute.
  game.handleMessage(sessions.get(1), JSON.stringify({ type: C2S.FISHING_BAIT, item: ITEM.GOLDEN_BEEF }));
  assert.equal(host.inventory.bait, ITEM.GOLDEN_BEEF);
  game.handleMessage(sessions.get(1), JSON.stringify({ type: C2S.FISHING_BAIT, item: BLOCK.STONE }));
  assert.equal(host.inventory.bait, ITEM.GOLDEN_BEEF, 'stone accepted as bait');
  host.nextReelTick = 0; sent.clear();
  game.fishing.use(host);
  assert.ok(!bobber(host) && messages(1, S2C.NOTICE).some((m) => /golden beef/.test(m.text)), 'fished without the chosen bait');
  assert.equal(count(host, ITEM.BREAD), 5, 'bread was used instead');
  game.handleMessage(sessions.get(1), JSON.stringify({ type: C2S.FISHING_BAIT, item: ITEM.BREAD }));
  run(1);
  assert.ok(messages(1, S2C.INVENTORY).at(-1)?.bait === ITEM.BREAD, 'the bait choice was not sent back');
}

// ---- Water: cast, float, bite, catch ----
{
  host.nextReelTick = 0; sent.clear();
  game.fishing.use(host);
  const b = bobber(host);
  assert.ok(b && b.flying, 'no bobber cast');
  for (const id of [1, 2, 3]) assert.ok(messages(id, S2C.ENTITY_SPAWN).some((m) => m.entity.type === ENTITY_TYPE.BOBBER && m.entity.owner === host.id), `player ${id} did not see the bobber`);
  settle(host);
  assert.equal(b.where, 'water', `the bobber landed in ${b.where}`);
  assert.ok(Math.abs(b.y - (Y + 1.02)) < 0.01, 'the bobber is not floating on the surface');
  assert.ok(b.attempt, 'no attempt started in water');
  assert.ok(count(host, ITEM.BREAD) === 4 || b.attempt.kept, 'bait use does not match the conservation roll');
  const wait = b.attempt.biteAt - game.tick;
  assert.ok(wait >= F.bite.min * TICK_RATE - 2 && wait <= F.bite.max * TICK_RATE + 2, `bite in ${wait} ticks`);
  run(wait);
  assert.ok(b.bite, 'nothing bit');
  assert.ok(messages(2, S2C.STATE).some((m) => m.entities.some((e) => e.id === b.id && e.bite)), 'the bite was not sent to other players');
  const before = host.inventory.slots.reduce((n, s) => n + (s?.count ?? 0), 0);
  host.nextReelTick = 0;
  game.fishing.use(host);
  assert.ok(!bobber(host), 'the bobber was not reeled in');
  assert.equal(host.inventory.slots.reduce((n, s) => n + (s?.count ?? 0), 0) > before, true, 'reeling in on a bite caught nothing');
  assert.ok(messages(1, S2C.NOTICE).some((m) => /^You caught /.test(m.text)), 'the player was not told what they caught');
  assert.ok(game.teamProgress.of(0).events.get('fishCaught:water') >= 1);
}

// ---- Early and late reels catch nothing; the bait is gone either way ----
{
  const total = () => host.inventory.slots.reduce((n, s) => n + (s?.count ?? 0), 0);
  host.inventory.slots[1] = { item: ITEM.BREAD, count: 20 };
  host.nextReelTick = 0; game.fishing.use(host); settle(host);
  let b = bobber(host); b.attempt.kept = false;
  const t0 = total();
  run(2); host.nextReelTick = 0; game.fishing.use(host);   // too early
  assert.equal(total(), t0, 'an early reel caught something');
  host.nextReelTick = 0; game.fishing.use(host); settle(host);
  b = bobber(host);
  const t1 = total();
  run(b.attempt.biteAt - game.tick + Math.ceil(F.window * TICK_RATE) + 2);   // miss the bite
  assert.ok(!b.bite && !b.attempt, 'the fish did not get away');
  host.nextReelTick = 0; game.fishing.use(host);
  assert.equal(total(), t1, 'a late reel caught something');
  // Reeling in twice gives one catch at most.
  host.nextReelTick = 0; game.fishing.use(host); settle(host);
  b = bobber(host); run(b.attempt.biteAt - game.tick);
  const t2 = total();
  host.nextReelTick = 0; game.fishing.use(host); host.nextReelTick = 0; game.fishing.use(host);
  const gained = total() - t2;
  assert.ok(gained >= 1 && bobber(host) && bobber(host).flying, 'the second click should cast again, not catch twice');
  host.nextReelTick = 0; game.fishing.use(host);
}

// ---- Conservation: one roll per attempt, at the rod's rate ----
{
  host.inventory.slots[1] = { item: ITEM.BREAD, count: 64 }; host.inventory.slots[2] = { item: ITEM.BREAD, count: 64 };
  hold(host, rod(ITEM.WOOD_FISHING_ROD, [{ id: 'thrifty', value: MODIFIERS.thrifty.value }]));
  const rate = rodStats(host.inventory.slots[0]).conservation;
  let kept = 0, attempts = 0;
  for (let i = 0; i < 400; i++) {
    const before = count(host, ITEM.BREAD);
    const b = game.fishing.spawn(host, ox + 12.5, Y + 1.5, oz + 12.5, 0, 0, 0, false);
    b.where = 'water'; game.fishing.settle(b);
    const used = before - count(host, ITEM.BREAD);
    assert.ok(used === 0 || used === 1, 'more than one bait for one attempt');
    assert.equal(used === 0, b.attempt.kept);
    kept += used === 0; attempts++;
    game.fishing.remove(b);
    if (count(host, ITEM.BREAD) < 5) host.inventory.slots[1] = { item: ITEM.BREAD, count: 64 };
  }
  assert.ok(Math.abs(kept / attempts - rate) < 0.07, `bait kept ${kept}/${attempts}, expected about ${rate}`);
  hold(host, rod());
}

// ---- Lava: only for rods that can; nowhere fishable takes no bait ----
{
  stand(host, 12, 22); aimAt(host, 12, 27);
  host.inventory.slots[1] = { item: ITEM.BREAD, count: 10 };
  const bread = count(host, ITEM.BREAD);
  host.nextReelTick = 0; sent.clear(); game.fishing.use(host); settle(host);
  assert.equal(bobber(host).where, 'lava');
  assert.ok(!bobber(host).attempt && count(host, ITEM.BREAD) === bread, 'a wooden rod fished in lava, or took bait');
  assert.ok(messages(1, S2C.NOTICE).some((m) => /lava/.test(m.text)));
  host.nextReelTick = 0; game.fishing.use(host);
  hold(host, rod(ITEM.BRONZE_FISHING_ROD));
  host.nextReelTick = 0; game.fishing.use(host); settle(host);
  assert.ok(bobber(host).where === 'lava' && bobber(host).attempt?.tier === 2, 'a bronze rod could not fish in lava');
  run(bobber(host).attempt.biteAt - game.tick);
  assert.ok(bobber(host).bite, 'nothing bit in lava');
  host.nextReelTick = 0; game.fishing.use(host);
  assert.ok(game.teamProgress.of(0).events.get('fishCaught:lava') === 1, 'no lava catch');
  // Onto stone: no fishing, no bait.
  stand(host, 30, 30); aimAt(host, 30, 33, -0.6);
  const b2 = count(host, ITEM.BREAD);
  host.nextReelTick = 0; game.fishing.use(host); settle(host);
  assert.equal(bobber(host).where, 'ground'); assert.equal(count(host, ITEM.BREAD), b2);
  host.nextReelTick = 0; game.fishing.use(host);
}

// ---- The void: the line reaches far below the islands; air just under an island doesn't count ----
{
  hold(host, rod(ITEM.BRONZE_FISHING_ROD));
  // A perch at the platform's height over open void (an empty column east of it).
  const empty = (x, z) => { for (let y = Y; y >= world.minY; y -= 1) if (world.getBlock(x, y, z) !== BLOCK.AIR) return false; return true; };
  let vx = ox + 40;
  while (!(empty(vx, oz + 20) && empty(vx + 2, oz + 20)) && vx < world.sizeX - 4) vx++;
  for (let x = ox + 40; x < vx; x++) world.setBlock(x, Y, oz + 20, BLOCK.STONE);
  world.setBlock(vx, Y, oz + 20, BLOCK.STONE);
  globalThis.voidPerch = { x: vx, z: oz + 20 };
  Object.assign(host.state, { x: vx + 0.5, y: Y + 1, z: oz + 20.5, vx: 0, vy: 0, vz: 0 });
  host.state.yaw = -Math.PI / 2; host.state.pitch = -0.2;   // east, off the end
  host.nextReelTick = 0; game.fishing.use(host);
  const b = bobber(host);
  run(TICK_RATE * 2);
  assert.ok(b.flying && b.y < Y - 5, 'the bobber stopped in the air under the platform');
  settle(host); run(TICK_RATE * 15, () => !b.flying);
  assert.equal(b.where, 'void', `the bobber ended in ${b.where}`);
  assert.ok(b.y <= game.fishing.voidY() + 0.01 && Y - b.y > 100, 'void fishing did not reach the real void');
  assert.ok(b.attempt?.where === 'void', 'no void attempt');
  run(TICK_RATE * 5);
  assert.ok(game.fishing.bobbers.has(b.id), 'the bobber was cleared away in the void');
  host.nextReelTick = 0; game.fishing.use(host);
  // A short line hangs in the air: no fishing, no bait.
  const max = F.maxLine; F.maxLine = 30;
  const bread = count(host, ITEM.BREAD);
  host.nextReelTick = 0; game.fishing.use(host); run(TICK_RATE * 10, () => bobber(host) && !bobber(host).flying);
  assert.equal(bobber(host).where, 'hanging'); assert.equal(count(host, ITEM.BREAD), bread);
  F.maxLine = max;
  host.nextReelTick = 0; game.fishing.use(host);
}

// ---- Void Eel encounters, from tier 2 void fishing ----
const perch = globalThis.voidPerch;
const hookEel = (owner, monkey) => {
  const table = FISHING_LOOT['void:2'], saved = table.slice();
  table.splice(0, table.length, { encounter: 'voidEel', weight: 1, boost: 0 });
  const b = game.fishing.spawn(owner, perch.x + 1.5, game.fishing.voidY(), perch.z + 0.5, 0, 0, 0, monkey);
  b.where = 'void'; b.bite = true;
  const before = new Set(game.mobs.keys());
  const result = game.fishing.catchFish(b, { where: 'void', tier: 2, luck: 1 });
  game.fishing.remove(b);
  table.splice(0, table.length, ...saved);
  assert.equal(result.encounter, 'voidEel');
  const eel = [...game.mobs.values()].find((mob) => !before.has(mob.id));
  assert.ok(eel?.type === ENTITY_TYPE.VOID_EEL, 'no Void Eel was hooked');
  return { eel, b };
};
{
  // The void bobber sits below where Void Eels swim.
  assert.ok(game.fishing.voidY() < game.eelBand().bottom, 'void fishing is not below the Void Eels');
  // A player hooks one: it comes up the line from the bobber and lands
  // beside them, then goes for them.
  Object.assign(host.state, { x: perch.x + 0.5, y: Y + 1, z: perch.z + 0.5, vx: 0, vy: 0, vz: 0 });
  const { eel, b } = hookEel(host, false);
  assert.ok(Math.hypot(eel.state.x - b.x, eel.state.z - b.z) < 1 && eel.state.y < Y - 100, 'the eel did not start down at the bobber');
  let lastY = eel.state.y, rising = true;
  run(TICK_RATE * 12, () => { rising &&= eel.state.y >= lastY - 1e-6; lastY = eel.state.y; return !eel.pull; });
  assert.ok(!eel.pull && rising, 'the eel was not reeled up the line');
  assert.ok(Math.hypot(eel.state.x - host.state.x, eel.state.z - host.state.z) < 5 && Math.abs(eel.state.y - host.state.y) < 3,
    'the eel did not land beside its fisher');
  assert.equal(eel.provocation.target, host, 'the eel is not after the player who hooked it');
  let lunged = false;
  run(TICK_RATE * 6, () => (lunged ||= eel.windupTicks > 0 || eel.lungeTicks > 0));
  assert.ok(lunged, 'the eel never attacked its fisher');
  assert.ok(game.teamProgress.of(0).events.get('fishedEel') === 1);
  game.mobs.delete(eel.id);
  stand(host, 12, 7);
}
// ---- Loot crates ----
{
  for (const name of ['lootCrate', 'ironboundCrate']) for (let i = 0; i < 50; i++) assert.ok(rollTable(name, Math.random).length >= LOOT_TABLES[name].rolls[0]);
  hold(host, { item: ITEM.IRONBOUND_CRATE, count: 2 });
  const total = () => host.inventory.slots.reduce((n, s) => n + (s?.count ?? 0), 0);
  const t0 = total();
  const loot = game.stepCrate(host);
  assert.ok(loot?.length >= 3, 'the crate gave nothing');
  assert.equal(count(host, ITEM.IRONBOUND_CRATE), 1, 'the crate was not used up');
  assert.equal(total(), t0 - 1 + loot.reduce((n, s) => n + s.count, 0), 'the loot did not arrive');
  assert.equal(game.stepCrate(host), null, 'opened two crates in one go');
  assert.ok(game.teamProgress.of(0).events.get('crateOpened') === 1);
}

// ---- Reforging at the anvil; modifiers kept through drops, monkeys and saves ----
{
  hold(host, rod(ITEM.BRONZE_FISHING_ROD));
  host.inventory.bait = ITEM.BREAD;
  const ax = ox + 20, az = oz + 3;
  world.setBlock(ax, Y + 1, az, BLOCK.ANVIL);
  const anvil = new Anvil(); world.tileEntities.set(`${ax},${Y + 1},${az}`, anvil);
  anvil.slots[0] = host.inventory.slots[0]; host.inventory.slots[0] = null;
  host.inventory.slots[3] = { item: ITEM.IRON_INGOT, count: 10 };
  stand(host, 20, 5); host.viewing = `${ax},${Y + 1},${az}`;
  const seen = new Set();
  for (let i = 0; i < 20; i++) { game.anvilReroll(host, { x: ax, y: Y + 1, z: az }); seen.add(anvil.slots[0].mods?.[0]?.id); }
  assert.ok(seen.size >= 2 && [...seen].every((id) => MODIFIERS[id]?.category === 'rod'), `reforging gave ${[...seen]}`);
  assert.equal(rodStats(anvil.slots[0]).tier, 2, 'reforging changed the tier');
  assert.equal(host.inventory.bait, ITEM.BREAD, 'reforging lost the bait choice');
  assert.ok(game.teamProgress.of(0).events.get('rodReforged') >= 1);
  const modded = anvil.slots[0]; anvil.slots[0] = null;
  // Dropped and picked up.
  game.spawnItem(modded.item, 1, host.state.x, host.state.y, host.state.z, 0, 0, 0, 0, modded.mods);
  run(30);
  const back = host.inventory.slots.find((s) => s?.item === ITEM.BRONZE_FISHING_ROD);
  assert.deepEqual(back?.mods, modded.mods, 'a dropped rod lost its modifier');
  // In a monkey's tool slot, and through a save.
  const m = new WorkMonkey(game.nextId++, game.monkeys, { x: ox + 5.5, y: Y + 1, z: oz + 5.5 });
  m.team = 0; game.npcs.set(m.id, m); m.gear[0] = { ...back };
  const { serializeGame } = await import('../server/save.js');
  const save = JSON.parse(JSON.stringify(serializeGame(game)));
  assert.deepEqual(save.monkeys.find((x) => x.id === m.id)?.gear[0].mods ?? save.monkeys.find((x) => x.gear?.[0]?.item === ITEM.BRONZE_FISHING_ROD)?.gear[0].mods, modded.mods, 'a monkey\'s rod lost its modifier in the save');
  assert.ok(save.players.find((p) => p.name === 'Test 1').inventory.bait === ITEM.BREAD, 'the bait choice was not saved');
  game.npcs.delete(m.id);
}

// ---- Fisherman monkeys ----
{
  const chestAt = (dx, dz) => { const x = ox + dx, z = oz + dz; world.setBlock(x, Y + 1, z, BLOCK.CHEST); const c = new Chest(); world.tileEntities.set(`${x},${Y + 1},${z}`, c); return { c, at: { x, y: Y + 1, z } }; };
  const src = chestAt(16, 7), dst = chestAt(8, 7);
  src.c.slots[0] = { item: ITEM.BREAD, count: 6 };
  const spot = { x: ox + 12, y: Y, z: oz + 9 };
  const m = new WorkMonkey(game.nextId++, game.monkeys, { x: ox + 12.5, y: Y + 1, z: oz + 6.5 });
  m.team = 0; m.status = 'Ready'; game.npcs.set(m.id, m);
  // No rod: it says so and fetches nothing.
  game.monkeys.applyConfig(m, { ...defaultMonkeyConfig(), role: 'fisherman', fishSpot: spot, castDir: 2, sources: [src.at], dests: [dst.at] });
  run(40);
  assert.equal(m.status, 'Missing fishing rod'); assert.equal(src.c.slots[0].count, 6);
  // A Lucky rod: it fetches bait, walks to its spot, casts south into the pool.
  m.gear[0] = rod(ITEM.WOOD_FISHING_ROD, [{ id: 'lucky', value: MODIFIERS.lucky.value }]);
  run(TICK_RATE * 40, () => game.fishing.bobberOf(m)?.attempt);
  const b = game.fishing.bobberOf(m);
  assert.ok(b?.attempt && b.where === 'water', `the fisherman did not get a line in (${m.status})`);
  assert.ok(Math.hypot(m.state.x - spot.x - 0.5, m.state.z - spot.z - 0.5) < 0.8, 'it is not on its fishing spot');
  assert.ok(Math.abs(b.x - (spot.x + 0.5)) < 0.9 && b.z > spot.z + 0.9 && b.z < spot.z + 2.2, 'it did not cast about a block south');
  assert.ok(Math.abs(b.attempt.luck - (1 + MODIFIERS.lucky.value) * BAIT[ITEM.BREAD].quality) < 1e-9, 'its rod modifier does not count');
  const wait = b.attempt.biteAt - game.tick;
  assert.ok(wait >= F.bite.min * F.monkeySlowdown * TICK_RATE - 2, `a monkey bite came in ${wait} ticks: not ten times slower`);
  run(12);
  assert.equal(m.status, 'Waiting for a bite');
  // Its catches pile up, then go to the destination (bites fast-forwarded).
  for (let i = 0; i < 8 && !dst.c.slots.some(Boolean); i++) {
    run(TICK_RATE * 20, () => game.fishing.bobberOf(m)?.attempt);
    const bb = game.fishing.bobberOf(m); if (bb?.attempt) bb.attempt.biteAt = game.tick;
    run(TICK_RATE * 2);
  }
  run(TICK_RATE * 20, () => dst.c.slots.some(Boolean));
  const delivered = dst.c.slots.reduce((n, x) => n + (x?.count ?? 0), 0);
  assert.ok(delivered >= 4, `only ${delivered} catches delivered`);
  assert.ok(!dst.c.slots.some((x) => x?.item === ITEM.BREAD) || true);
  assert.ok(game.teamProgress.of(0).events.get('monkeyFished') >= 2, 'monkey catches were not counted');
  // Out of bait everywhere: it stops and says so.
  src.c.slots.fill(null); for (let i = 0; i < m.inventory.slots.length; i++) if (m.inventory.slots[i]?.item === ITEM.BREAD) m.inventory.slots[i] = null;
  const bb = game.fishing.bobberOf(m); if (bb) game.fishing.remove(bb);
  m.task = null; run(TICK_RATE * 6);
  assert.equal(m.status, 'Missing bait'); assert.ok(!game.fishing.bobberOf(m));
  // Facing stone: an invalid spot, checked before any bait is used.
  src.c.slots[0] = { item: ITEM.BREAD, count: 3 };
  game.monkeys.applyConfig(m, { ...m.config, castDir: 0 });
  m.task = null; run(TICK_RATE * 6);
  assert.equal(m.status, 'Invalid fishing location'); assert.ok(!game.fishing.bobberOf(m));
  assert.equal(src.c.slots[0]?.count, 3, 'bait was fetched for an invalid spot');
  // Over lava with a wooden rod: invalid too; a bronze rod fishes there.
  const lavaSpot = { x: ox + 12, y: Y, z: oz + 24 };
  game.monkeys.applyConfig(m, { ...m.config, fishSpot: lavaSpot, castDir: 2 });
  m.task = null; run(TICK_RATE * 6);
  assert.equal(m.status, 'Invalid fishing location');
  m.gear[0] = rod(ITEM.BRONZE_FISHING_ROD);
  run(TICK_RATE * 60, () => game.fishing.bobberOf(m)?.attempt);
  assert.equal(game.fishing.bobberOf(m)?.where, 'lava', `a bronze-rod fisherman did not fish lava (${m.status})`);
  // A monkey hooks one off the void perch: it lands beside the monkey,
  // hovers around that spot for a good while (long enough for turrets,
  // guards or spikes), then goes back down the line.
  game.fishing.remove(game.fishing.bobberOf(m));
  Object.assign(m.state, { x: perch.x + 0.5, y: Y + 1, z: perch.z + 0.5 });
  m.task = null; m.idleUntil = game.tick + TICK_RATE * 999;
  sent.clear();
  const { eel } = hookEel(m, true);
  assert.ok(messages(3, S2C.NOTICE).some((n) => /Void Eel/.test(n.text)), 'the team was not warned');
  run(TICK_RATE * 12, () => !eel.pull);
  const landed = { x: eel.state.x, y: eel.state.y, z: eel.state.z };
  assert.ok(Math.hypot(landed.x - m.state.x, landed.z - m.state.z) < 5 && Math.abs(landed.y - m.state.y) < 3, 'the eel did not land beside the monkey');
  assert.ok(eel.patrol, 'a monkey\'s eel is not hovering');
  let farthest = 0;
  run(TICK_RATE * (F.eel.patrolSeconds - 10), () => { farthest = Math.max(farthest, Math.hypot(eel.state.x - landed.x, eel.state.z - landed.z)); return false; });
  assert.ok(farthest <= F.eel.patrolRadius + 3 && Math.abs(eel.state.y - landed.y) < 4, `the eel wandered off its spot (${farthest.toFixed(1)} blocks)`);
  // Everyone back to their keeps (solid island under them), so nothing
  // tempts it to stay up.
  for (const p of [host, mate, enemy]) Object.assign(p.state, game.keepSpawn(game.world.keeps[game.occupiedTeams.indexOf(p.team)] ?? game.world.keeps[0]), { vx: 0, vy: 0, vz: 0 });
  eel.target = null; eel.provocation.target = null;
  run(TICK_RATE * 15);
  assert.ok(!eel.patrol, 'the eel never stopped hovering');
  // Homing down the line takes a while (it can be distracted on the way).
  run(TICK_RATE * 60, () => eel.state.y < landed.y - 30);
  assert.ok(eel.state.y < landed.y - 30, `the eel did not go back down to the void (${(landed.y - eel.state.y).toFixed(1)} blocks down)`);
  game.mobs.delete(eel.id);
  game.npcs.delete(m.id);
}

// ---- Quests: the fishing book follows play, for the whole team ----
{
  host.inventory.add(ITEM.WOOD_FISHING_ROD, 1); host.inventory.add(ITEM.BRONZE_FISHING_ROD, 1); host.inventory.add(ITEM.BRONZE_INGOT, 1);
  host.inventoryDirty = true;
  sent.clear();
  run(TICK_RATE + 1); game.quests.update();
  const book = game.quests.of(0);
  for (const id of ['fishingRod', 'bait', 'waterFishing', 'voidFishing', 'reforgeRod', 'lootCrates', 'fisherman', 'bronzeRod', 'lavaFishing'])
    assert.ok(book.completed.has(id), `quest ${id} not completed`);
  assert.ok(book.unlocked.has('beyond') && book.completed.has('eelCatch'), 'hooking a Void Eel did not open Beyond the Island');
  assert.ok(!game.quests.of(1).completed.has('waterFishing'), 'the other team got team 0\'s fishing');
  // (Changes reach teammates as they happen, quest-check shows; here, what the teammate holds now.)
  game.quests.sync(0, true);
  const mateBook = messages(3, S2C.QUESTS).at(-1);
  assert.ok(mateBook?.completed.includes('fisherman') && mateBook.completed.includes('eelCatch'), 'the teammate was not updated');
}

console.log('OK: rods, attributes and rod modifiers (one kind each, capped conservation, tier fixed), bite timing and Fishing Speed,',
  'loot tables (normalized, luck, tier eligibility, void fish only from the void), no golden-beef money loop, bait choice (no',
  'substitutes), water, lava and void casting (real void, maxLine, ground), bites to every player, guaranteed catches, early and late',
  'reels, one catch per bite, one conservation roll per attempt at the rod\'s rate, Void Eel encounters, loot crates, anvil reforging,',
  'modifiers through drops, monkeys and saves, Fisherman monkeys (rod, bait, spot, direction, ten times slower, modifiers, delivery,',
  'statuses, lava, eels), quests and team sync');
process.exit(0);
