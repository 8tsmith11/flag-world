import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { BLOCK, FACING_DIRS, ladderBlock } from '../shared/blocks.js';
import { createPlayerState, playerFitsAt } from '../shared/physics.js';
import { makeGraph, nodeKey } from '../shared/goblins/areas.js';
import { GoblinNav } from '../server/goblins/nav.js';
import { stepMobPath } from '../shared/mobMovement.js';
import { resolveMobOverlaps } from '../server/mobSteering.js';
import { MOB_SEPARATION, TICK_DT } from '../shared/config.js';

function route(world, graph, start, goal) {
  const volumes = [...graph.values()].map(n => ({ x0: n.x, x1: n.x, z0: n.z, z1: n.z, y0: n.y, y1: n.y + 2 }));
  const area = { id: 'test', kind: 'surface', state: 'active', nodes: new Set(graph.keys()),
    columns: new Set([...graph.values()].map(n => `${n.x},${n.z}`)), volumes };
  world.goblinPlan = { graph, areas: [area], outskirts: [], gates: [], outskirtsVersion: 0 };
  const nav = new GoblinNav(world);
  assert(nav.nearest(area, goal).grounded, 'Destination is an unsupported hatch cell');
  const path = nav.route({ x: start.x + 0.5, y: start.y, z: start.z + 0.5 }, goal, area, { unlimited: true });
  assert(path?.length, `No route ${nodeKey(start)} -> ${nodeKey(goal)}`);
  return path;
}
function body(id, point, path = []) {
  const state = createPlayerState(point.x + 0.5, point.y, point.z + 0.5);
  state.box = { halfW: 0.3, height: 1.2 }; state.edgeGuard = true;
  return { id, state, path };
}
function follow(world, graph, start, goal, box = { halfW: 0.3, height: 1.2 }) {
  const mob = body(1, start, route(world, graph, start, goal));
  mob.state.box = box;
  for (let tick = 0; tick < 240; tick++) {
    stepMobPath(mob, world, 0.55);
    assert(playerFitsAt(world, mob.state, mob.state.y), 'Moved inside terrain');
    if (!mob.path.length && mob.state.onGround) break;
  }
  assert.equal(mob.path.length, 0, `Stuck at ${JSON.stringify(mob.state)} targeting ${JSON.stringify(mob.path[0])}`);
  assert(Math.hypot(mob.state.x - goal.x - 0.5, mob.state.z - goal.z - 0.5) < 0.16);
  assert(Math.abs(mob.state.y - goal.y) < 0.01);
}
for (let facing = 0; facing < 4; facing++) for (const hatch of [false, true]) {
  const world = new World(1, 24, 24, { sizeY: 24, minY: 0 });
  for (let x = 3; x <= 17; x++) for (let z = 3; z <= 17; z++) world.setBlock(x, 0, z, BLOCK.STONE);
  const [sx, sz] = FACING_DIRS[facing], x = 10, z = 10;
  for (let y = 1; y <= 5; y++) {
    world.setBlock(x + sx, y, z + sz, BLOCK.STONE);
    world.setBlock(x, y, z, ladderBlock(facing));
  }
  if (hatch) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (dx || dz) world.setBlock(x + dx, 5, z + dz, BLOCK.PLANKS);
  }
  // An exit toward the support exercises walking over its top edge;
  // a hatch also has side and opposite exits.
  const goal = { x: x + sx, y: 6, z: z + sz }, start = { x, y: 1, z };
  const volumes = [];
  for (let vx = 3; vx <= 17; vx++) for (let vz = 3; vz <= 17; vz++) volumes.push({ x0: vx, x1: vx, z0: vz, z1: vz, y0: 1, y1: 8 });
  const graph = makeGraph(world, volumes);
  assert.equal(graph.ladderProblems.length, 0);
  const goals = hatch ? FACING_DIRS.map(([dx, dz]) => ({ x: x + dx, y: 6, z: z + dz })) : [goal];
  for (const box of [{ halfW: 0.3, height: 1.2 }, { halfW: 0.475, height: 1.95 }]) {
    for (const landing of goals) { follow(world, graph, start, landing, box); follow(world, graph, landing, start, box); }
  }
  if (hatch) {
    // Two blocks of clearance at the landing: the takeoff must still work
    // when a shaft roof limits its upward impulse.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) world.setBlock(x + dx, 8, z + dz, BLOCK.STONE);
    const roofed = makeGraph(world, volumes);
    for (const landing of goals) {
      follow(world, roofed, start, landing, { halfW: 0.475, height: 1.95 });
      follow(world, roofed, landing, start, { halfW: 0.475, height: 1.95 });
    }
  }
  // Removing all landing floors must remove the climb route and report it.
  for (const landing of goals) world.setBlock(landing.x, 5, landing.z, BLOCK.AIR);
  const invalid = makeGraph(world, volumes);
  assert(invalid.ladderProblems.some(p => p.x === x && p.z === z));
  assert([...invalid.values()].filter(n => n.x === x && n.z === z).every(n => n.edges.every(e => !e.ladder)));
}
const world = new World(2, 24, 24, { sizeY: 24, minY: 0 });
for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) world.setBlock(x, 0, z, BLOCK.STONE);
for (const overlap of [0.02, 0.3, 0.59]) {
  const a = body(1, { x: 10, y: 1, z: 10 }), b = body(2, { x: 10, y: 1, z: 10 });
  b.state.x += 0.6 - overlap;
  const before = a.state.x;
  resolveMobOverlaps(world, [a, b]);
  assert(Math.abs(before - a.state.x - MOB_SEPARATION.strength * TICK_DT) < 1e-8, 'Push depends on overlap');
}
const a = body(1, { x: 5, y: 1, z: 10 }, [{ x: 15, y: 1, z: 10 }]);
const b = body(2, { x: 15, y: 1, z: 10 }, [{ x: 5, y: 1, z: 10 }]);
let overlapped = false;
for (let tick = 0; tick < 120; tick++) {
  stepMobPath(a, world, 0.45); stepMobPath(b, world, 0.45);
  if (Math.abs(a.state.x - b.state.x) < 0.6) overlapped = true;
  resolveMobOverlaps(world, [a, b]);
}
assert(overlapped && a.state.x > b.state.x, 'Opposing mobs could not pass');
assert.equal(a.path.length + b.path.length, 0);
console.log('OK: constant crowd push, opposing walkers, four ladder facings, hatch exits, reverse descent, missing landing diagnostics');
