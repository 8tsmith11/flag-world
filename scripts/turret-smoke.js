import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { BLOCK } from '../shared/blocks.js';
import { TurretController } from '../server/turrets.js';

function scenario(blocked = false) {
  const world = new World(1, 64, 64);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) world.setBlock(x, 0, z, BLOCK.STONE);
  world.setBlock(10, 1, 10, BLOCK.ARROW_TURRET);
  if (blocked) for (let y = 1; y < 6; y++) world.setBlock(20, y, 10, BLOCK.STONE);
  const target = { id: 2, type: 'player', team: 1, connected: true, dead: false,
    state: { x: 29.5, y: 1, z: 10.5, crouching: false } };
  const game = { world, players: new Map([[2, target]]), mobs: new Map(), dragons: new Map(),
    arrows: new Map(), nextId: 3, broadcast() {} };
  const turrets = new TurretController(game);
  turrets.place(10, 1, 10, BLOCK.ARROW_TURRET, 0);
  for (let tick = 1; tick <= 10; tick++) turrets.step(tick);
  return { world, target, game, turret: turrets.snapshot()[0] };
}

const { world, target, game, turret } = scenario();
assert.ok(Math.abs(turret.yaw + Math.PI / 2) < 0.1, 'head faces the target');
const arrow = [...game.arrows.values()][0];
assert.ok(arrow, 'clear target receives an arrow');
let moved = false, hit = false;
for (let i = 0; i < 30; i++) {
  const before = arrow.x;
  const result = arrow.step(world, [target]);
  moved ||= arrow.x > before;
  if (result?.hit === target) { hit = true; break; }
  assert.equal(arrow.stuckIn, null, 'arrow does not stick before target');
}
assert.ok(moved, 'arrow travels through the air');
assert.ok(hit, 'arrow hits at long range');
assert.equal(scenario(true).game.arrows.size, 0, 'solid wall prevents firing');
console.log('Turret shot moves, hits at range, turns its head, and respects cover.');
