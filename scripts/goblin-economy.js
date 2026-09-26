// Focused checks for construction independent of cosmetic goblin bodies.
import assert from 'node:assert/strict';
import { OffscreenSim } from '../server/goblinOffscreen.js';
import { Project } from '../server/goblinProjects.js';
import { BLOCK } from '../shared/blocks.js';
import { GOBLINS } from '../shared/goblins.js';

function fixture(offscreen, kind = 'dwelling') {
  const blocks = new Map();
  const world = { getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR };
  const project = new Project(kind, 'Economy regression');
  project.surface = kind === 'dwelling';
  for (let x = 0; x < 100; x++) project.add({ kind: 'place', x, y: 0, z: 0,
    id: BLOCK.GOBLIN_BRICKS, key: `${x},0,0` });
  const controller = { world, worldSize: 'small', fortress: { origin: { x: 0, y: 0, z: 0 }, cells: {}, modules: [] },
    game: { tick: 0, players: new Map(), playerIn: () => false }, project,
    offscreen, fastBuild: false, totemAlive: true, members: [],
    countOf: () => 1, surfaceOpen: () => false, pendingReplants: () => [],
    emptyPlotSpots: () => [], activeProjects: () => [project],
    finishTask(task) { if (!task.done) { task.done = true; project.done++; } },
    forceTask(task) { blocks.set(task.key, task.id); this.finishTask(task); },
    stats: { placed: 0, dug: 0 }, totemSpot: { x: 0, y: 0, z: 0 } };
  return { controller, project, blocks, sim: new OffscreenSim(controller) };
}
const watched = fixture(false), distant = fixture(true);
// Give both schedules the same elapsed time, starting at their first interval.
watched.sim.nextStep = 1;
distant.sim.nextStep = Math.round(GOBLINS.offscreen.step * 20);
for (let tick = 1; tick <= 40; tick++) {
  for (const f of [watched, distant]) { f.controller.game.tick = tick; f.sim.tick(tick); }
}
assert.equal(watched.project.done, distant.project.done, 'watched and distant budgets place the same blocks');
assert.ok(watched.project.done > 0, 'construction advances without worker entities');
const underground = fixture(false, 'module');
underground.controller.game.players.set(1, { connected: true, state: { x: 0, y: 0, z: 0 } });
for (let tick = 1; tick <= 1000; tick++) {
  underground.controller.game.tick = tick;
  underground.sim.tick(tick);
}
assert.equal(underground.project.progress(), 1, 'underground timer finishes while watched');
assert.equal(underground.blocks.size, 0, 'finished underground module waits without changing visible blocks');
underground.controller.game.players.clear();
underground.controller.game.tick++;
underground.sim.tick(underground.controller.game.tick);
assert.equal(underground.blocks.size, 100, 'whole underground plan applies after the player leaves');
console.log('Goblin economy checks passed');
