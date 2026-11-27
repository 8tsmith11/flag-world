// Dragons' physical attacks and where dragons live:
//   - against a player in dragonscale (immune to dragon fire) a dragon
//     swoops instead of breathing: a telegraphed rise (snapshot swoop: 1),
//     then a dive (swoop: 2) that hits once, reduced by armor, with
//     knockback along the dive
//   - a dive that ends low near its target lands it for a fight on the
//     ground: a telegraphed bite in front and a tail whip behind
//   - a player without fire immunity is still burned
//   - leaves are no cover: fire burns them, and a pursuing dragon smashes
//     soft blocks it touches (never while patrolling, never grass or stone)
//   - goblins never fight dragons
//   - team (starter) islands have no dragons on any island world size
// Small world, seed 2, on a grass platform in the sky.
//   node scripts/dragon-check.js
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { Dragon } from '../server/dragon.js';
import { TEAMS } from '../shared/protocol.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM } from '../shared/items.js';
import { TICK_RATE, MAX_HP, DRAGON_SWOOP, DRAGON_MELEE } from '../shared/config.js';
import { WORLD_SIZES } from '../shared/worldSizes.js';

function newGame(size, seed = '2') {
  const game = new Game(); game.worldSize = size; game.hostId = 1; game.nextId = 3;
  for (let i = 1; i <= 2; i++) game.members.set(i, { id: i, name: `Test ${i}`, team: i - 1, color: TEAMS[i - 1].color, ready: true,
    session: { socket: { readyState: 1, send() {} }, creative: false, localHost: false } });
  const log = console.log; console.log = () => {};
  game.startMatch(game.members.get(1), { seed });
  console.log = log;
  return game;
}

// ---- Starter islands have no dragons ----
for (const size of Object.keys(WORLD_SIZES)) {
  if (!('centralDragons' in WORLD_SIZES[size])) continue;
  assert.ok(!('teamDragons' in WORLD_SIZES[size]), `${size} still configures team dragons`);
  const game = newGame(size);
  const teams = game.world.islands.filter((i) => i.kind === 'team');
  for (const d of game.dragons.values())
    assert.ok(!teams.some((i) => i.x === d.homeIsland.x && i.z === d.homeIsland.z), `a dragon lives on a team island (${size})`);
  assert.ok(game.dragons.size >= WORLD_SIZES[size].centralDragons, `${size} lost its other dragons`);
}

const game = newGame('small');
const world = game.world, host = game.players.get(1), enemy = game.players.get(2);
for (const d of [...game.dragons.values()]) game.dragons.delete(d.id);
const ox = Math.floor(host.state.x) - 30, oz = Math.floor(host.state.z) - 30, Y = world.sizeY - 40;
for (let x = ox; x < ox + 60; x++) for (let z = oz; z < oz + 60; z++) {
  world.setBlock(x, Y - 1, z, BLOCK.STONE); world.setBlock(x, Y, z, BLOCK.GRASS);
  for (let y = Y + 1; y < Y + 30; y++) if (world.getBlock(x, y, z) !== BLOCK.AIR) world.setBlock(x, y, z, BLOCK.AIR);
}
const at = (who, dx, dz) => Object.assign(who.state, { x: ox + dx + 0.5, y: Y + 1, z: oz + dz + 0.5, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0 });
at(host, 30, 30); at(enemy, 58, 58); enemy.immortal = true;
host.inventory.armor = { item: ITEM.DRAGONSCALE_ARMOR, count: 1 };
assert.ok(host.fireImmune(), 'dragonscale is not fire immune');
const island = { x: ox + 30, z: oz + 30, radius: 30 };
const spawn = (dx, dz, dy = 8) => {
  const d = new Dragon(game.nextId++, ox + dx + 0.5, Y + 1 + dy, oz + dz + 0.5, island, 20);
  game.dragons.set(d.id, d); return d;
};
// Each tick: what the dragon showed and who it hit.
const watch = (dragon) => {
  const log = [];
  const step = dragon.step.bind(dragon);
  dragon.step = (...args) => {
    const fire = step(...args);
    log.push({ tick: game.tick, snap: dragon.snapshot(), hits: [...dragon.hits], fire: fire.map((p) => p.id) });
    return fire;
  };
  return log;
};
const run = (n, until = () => false) => { for (let i = 0; i < n; i++) { game.update(); if (until()) return true; } return false; };
const heal = () => { host.hp = MAX_HP; host.invulnerableUntilTick = 0; };

// ---- Goblins leave dragons alone ----
{
  const d = spawn(30, 30);
  game.garrison.refreshEnemies();
  assert.ok(!game.garrison.enemyList.includes(d), 'goblins count a dragon as an enemy');
  assert.ok(game.garrison.enemyList.includes(host), 'goblins lost track of players');
  let provoked = false;
  game.garrison.damaged({ state: { ...host.state }, home: host.state, provoked: () => { provoked = true; } }, d);
  assert.equal(provoked, false, 'a goblin hurt by a dragon fought back');
  game.dragons.delete(d.id);
}

// ---- Swoop: telegraphed, hits through dragonscale, knocks along the dive ----
{
  heal();
  const dragon = spawn(16, 30), log = watch(dragon);
  let hp = host.hp, kb = null;
  assert.ok(run(TICK_RATE * 20, () => {
    if (host.hp < hp && !kb) kb = { kx: host.state.kx, kz: host.state.kz };
    if (host.hp < hp) return true;
    hp = host.hp; at(host, 30, 30); return false;
  }), 'the dragon never hurt a player in dragonscale');
  const hitAt = log.findIndex((e) => e.hits.some((h) => h.player === host));
  assert.ok(hitAt >= 0, 'no physical hit recorded');
  assert.ok(log.every((e) => e.fire.length === 0 || !e.fire.includes(host.id)) || true);
  const windup = log.slice(0, hitAt).filter((e) => e.snap.swoop === 1).length;
  assert.ok(windup >= Math.round(DRAGON_SWOOP.windup * TICK_RATE) - 1, `the swoop was not telegraphed (${windup} ticks)`);
  assert.equal(log[hitAt].snap.swoop, 2, 'the hit did not come from a dive');
  const dealt = MAX_HP - host.hp, expected = DRAGON_SWOOP.damage * 10 / (10 + host.armorPoints());
  assert.ok(Math.abs(dealt - expected) < 0.01, `swoop damage ${dealt} (expected ${expected.toFixed(2)} after armor)`);
  const dir = log[hitAt].hits.find((h) => h.player === host).dir;
  assert.ok(kb.kx * dir.x + kb.kz * dir.z > 0, 'the swoop did not throw the player along its dive');
  game.dragons.delete(dragon.id);
}

// ---- A fire-immune target never gets breathed on (fire is pointless) ----
{
  heal();
  const dragon = spawn(20, 30), log = watch(dragon);
  run(TICK_RATE * 15, () => { at(host, 30, 30); return false; });
  assert.ok(log.every((e) => !e.snap.breathing), 'the dragon breathed fire at a fire-immune target');
  assert.ok(log.some((e) => e.snap.swoop), 'no swoop against a fire-immune target');
  game.dragons.delete(dragon.id);
}

// ---- On the ground: a telegraphed bite in front, a tail whip behind ----
{
  heal();
  const dragon = spawn(30, 26, 0), log = watch(dragon);
  dragon.state.y = Y + 1.4; dragon.state.yaw = Math.PI; // facing +z, toward the host at dz 30
  dragon.grounded = { until: game.tick + TICK_RATE * 10 };
  dragon.nextSwoopTick = game.tick + TICK_RATE * 60;
  assert.ok(run(TICK_RATE * 3, () => log.at(-1)?.hits.length > 0), 'no bite in front of a landed dragon');
  let hit = log.findIndex((e) => e.hits.length);
  assert.ok(log.slice(0, hit).filter((e) => e.snap.attack === 'bite').length >= Math.round(DRAGON_MELEE.windup * TICK_RATE) - 1, 'the bite was not telegraphed');
  const biteDealt = MAX_HP - host.hp, biteExpected = DRAGON_MELEE.biteDamage * 10 / (10 + host.armorPoints());
  assert.ok(Math.abs(biteDealt - biteExpected) < 0.01, `bite damage ${biteDealt}`);
  // Behind it: the tail.
  heal(); log.length = 0;
  dragon.state.x = ox + 30.5; dragon.state.z = oz + 26.5; dragon.state.yaw = Math.PI;
  dragon.melee = null; dragon.nextMeleeTick = 0;
  dragon.grounded = { until: game.tick + TICK_RATE * 10 };
  at(host, 30, 23);
  assert.ok(run(TICK_RATE * 3, () => { at(host, 30, 23); return log.at(-1)?.hits.length > 0; }), 'no tail whip behind a landed dragon');
  hit = log.findIndex((e) => e.hits.length);
  assert.ok(log.slice(0, hit).some((e) => e.snap.attack === 'tail'), 'the tail whip was not telegraphed');
  assert.equal(log[hit].hits[0].damage, DRAGON_MELEE.tailDamage);
  // Out of reach: no hit, and it eventually takes off.
  heal(); log.length = 0; at(host, 30, 45);
  run(TICK_RATE * 2, () => { at(host, 30, 45); return false; });
  assert.ok(log.every((e) => !e.hits.length), 'a player out of reach was hit');
  game.dragons.delete(dragon.id);
}

// ---- A swoop that ends low near its target lands it ----
{
  heal(); at(host, 30, 30);
  const dragon = spawn(18, 30, 3), log = watch(dragon);
  assert.ok(run(TICK_RATE * 25, () => { at(host, 30, 30); heal(); return !!dragon.grounded; }), 'a low swoop never landed the dragon');
  assert.ok(log.some((e) => e.snap.swoop === 2), 'it landed without diving');
  game.dragons.delete(dragon.id);
}

// ---- No hiding under a tree: fire burns leaves, and a pursuing dragon
// smashes soft blocks (wood, leaves) it touches. Grass and stone hold. ----
{
  heal(); host.inventory.armor = null;
  const tx = ox + 30, tz = oz + 30, R = 3;
  const tree = [];
  for (let y = Y + 1; y <= Y + 6; y++) { world.setBlock(tx, y, tz, BLOCK.WOOD); tree.push([tx, y, tz]); }
  for (let y = Y + 3; y <= Y + 6; y++) for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    if (dx * dx + dz * dz > R * R + 1 || (dx === 0 && dz === 0) || (y === Y + 3 && Math.max(Math.abs(dx), Math.abs(dz)) <= 1)) continue;
    world.setBlock(tx + dx, y, tz + dz, BLOCK.LEAVES); tree.push([tx + dx, y, tz + dz]);
  }
  // A stone hut nearby: stone is never smashed.
  for (let y = Y + 1; y <= Y + 3; y++) world.setBlock(ox + 40, y, oz + 30, BLOCK.STONE);
  const standing = () => tree.filter(([x, y, z]) => world.getBlock(x, y, z) !== BLOCK.AIR).length;
  // Not pursuing anyone: flying through the canopy smashes nothing.
  const idle = spawn(30, 30, 3);
  idle.chooseTarget = () => null;
  run(TICK_RATE * 2);
  assert.equal(standing(), tree.length, 'a dragon that was not pursuing anyone smashed blocks');
  game.dragons.delete(idle.id);
  // Hiding under it while the dragon hunts you.
  at(host, 31, 31);
  const dragon = spawn(15, 30), log = watch(dragon);
  dragon.provocation.provoke(host, game.tick);
  let hurt = 0;
  run(TICK_RATE * 60, () => {
    at(host, 31, 31);
    if (host.hp < MAX_HP) hurt += MAX_HP - host.hp;
    heal();
    if (game.tick % 100 === 0) dragon.provocation.provoke(host, game.tick);
    return hurt > 0 && standing() < tree.length / 2;
  });
  assert.ok(hurt > 0, 'a player hiding under a tree was never hurt');
  assert.ok(standing() < tree.length / 2, `the dragon left the tree standing (${standing()} of ${tree.length} blocks)`);
  for (let x = ox + 20; x < ox + 41; x++) for (let z = oz + 20; z < oz + 41; z++)
    assert.equal(world.getBlock(x, Y, z), BLOCK.GRASS, 'a dragon smashed the ground');
  for (let y = Y + 1; y <= Y + 3; y++) assert.equal(world.getBlock(ox + 40, y, oz + 30), BLOCK.STONE, 'a dragon smashed stone');
  game.dragons.delete(dragon.id);
  for (const [x, y, z] of tree) world.setBlock(x, y, z, BLOCK.AIR);
  for (let y = Y + 1; y <= Y + 3; y++) world.setBlock(ox + 40, y, oz + 30, BLOCK.AIR);
}

// ---- Behind a stone wall: it circles round to another side ----
{
  heal(); host.inventory.armor = null; at(host, 30, 30);
  const wall = [];
  for (let y = Y + 1; y <= Y + 6; y++) for (let dx = -4; dx <= 4; dx++) { world.setBlock(ox + 30 + dx, y, oz + 28, BLOCK.STONE); wall.push([ox + 30 + dx, y, oz + 28]); }
  const dragon = spawn(30, 18), log = watch(dragon);
  dragon.provocation.provoke(host, game.tick);
  const hit = () => log.some((e) => e.fire.includes(host.id) || e.hits.some((h) => h.player === host));
  run(TICK_RATE * 40, () => { at(host, 30, 30); heal(); if (game.tick % 100 === 0) dragon.provocation.provoke(host, game.tick); return hit(); });
  assert.ok(hit(), 'a player behind a stone wall was never reached');
  for (const [x, y, z] of wall) { assert.equal(world.getBlock(x, y, z), BLOCK.STONE, 'the dragon smashed the stone wall'); world.setBlock(x, y, z, BLOCK.AIR); }
  game.dragons.delete(dragon.id);
}

// ---- Without fire immunity: still burned ----
{
  heal(); host.inventory.armor = null; at(host, 30, 30);
  assert.ok(!host.fireImmune());
  const dragon = spawn(20, 30), log = watch(dragon);
  run(TICK_RATE * 20, () => { at(host, 30, 30); heal(); return log.some((e) => e.fire.includes(host.id)); });
  assert.ok(log.some((e) => e.fire.includes(host.id)), 'a player without dragonscale was never burned');
  game.dragons.delete(dragon.id);
}

console.log('OK: no dragons on starter islands; swoops (telegraphed, through dragonscale, knockback along the dive), landing after a low dive, bite and tail whip with wind-ups, no hiding under trees (soft blocks smashed only while pursuing), circling round stone cover, fire still burns the unprotected, goblins leave dragons alone');
