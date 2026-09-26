// Simulate unattended colony growth at the configured goblin time scale.
// Usage: node scripts/goblin-benchmark.js [seed] [size] [minutes]
import { performance } from 'node:perf_hooks';
import { generateWorld } from '../shared/worldgen.js';
import { TICK_RATE } from '../shared/config.js';
import { BLOCK } from '../shared/blocks.js';
import { mulberry32 } from '../shared/structures.js';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { wallProject, cellRejections } from '../server/goblinProjects.js';
import { SaplingGrowth } from '../server/saplings.js';

const seed = Number(process.argv[2] ?? 12345);
const size = process.argv[3] ?? 'small';
const minutes = Number(process.argv[4] ?? 100);
const game = new Game();
game.seed = seed;
game.worldSize = size;
game.world = generateWorld(seed, 2, size);
Math.random = mulberry32((seed ^ 0x627a13) >>> 0);
game.saplings = new SaplingGrowth(game.world, () => false,
  (x, y, z) => game.goblins?.saplingGrowTime(x, y, z));
game.world.onBlockChanged = (x, y, z, id, oldId) => {
  game.goblins?.blockChanged(x, y, z, id, oldId);
  if (oldId === BLOCK.SAPLING && id !== BLOCK.SAPLING) game.saplings.removed(x, y, z);
  if (id === BLOCK.SAPLING && oldId !== BLOCK.SAPLING) game.saplings.planted(x, y, z, game.tick);
};
game.goblins = new GoblinController(game);
game.goblins.spawnAll();
const { moduleCap, dwellingCap, hardCap } = game.goblins.status();
let goblinMs = 0;
let ended = false;
for (let tick = 1; tick <= minutes * 60 * TICK_RATE; tick++) {
  game.tick = tick;
  game.saplings.tick(tick);
  const start = performance.now();
  game.goblins.update(tick);
  goblinMs += performance.now() - start;
  if (tick % TICK_RATE === 0 && game.goblins.brickModules() >= moduleCap
    && game.goblins.dwellings() >= dwellingCap
    && game.goblins.castleBuilt && game.goblins.outerWallBuilt) { ended = true; break; }
}
const events = game.goblins.events;
const wallDiagnostics = {};
if (!game.goblins.outerWallBuilt && game.goblins.dwellings() >= dwellingCap) {
  const buildings = game.goblins.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind) && b.intact);
  wallProject(game.world, game.goblins, buildings, true, wallDiagnostics);
}
const at = (event) => events.find((e) => e.event === event)?.tick / TICK_RATE / 60 ?? null;
console.log(JSON.stringify({ seed, size, scale: process.env.GOBLIN_TIME_SCALE ?? 1,
  simulatedMinutes: game.tick / TICK_RATE / 60, completed: ended,
  breakthroughMinute: at('breakthrough'), relocationMinute: at('entranceRelocation'),
  castleMinute: at('castleBuilt'), outerWallMinute: events.find((e) => e.event === 'finishProject'
    && e.label === 'Outer base wall')?.tick / TICK_RATE / 60 ?? null,
  firstSiegeMinute: null, modules: game.goblins.brickModules(), dwellings: game.goblins.dwellings(),
  population: game.goblins.population(), plots: game.goblins.plots(),
  caps: { modules: moduleCap, dwellings: dwellingCap, population: hardCap },
  moduleCells: game.goblins.fortress.modules.map((m) => ({ type: m.type, cell: m.cell, cliff: m.cliffChain })),
  upperReserve: game.goblins.relocationReserve?.spec.parent.floorY,
  meanGoblinTickMs: goblinMs / game.tick, maxBuildEntities: game.mobs.size,
  project: game.goblins.project && { label: game.goblins.project.label,
    done: game.goblins.project.done, total: game.goblins.project.total,
    next: (() => { const t = game.goblins.project.tasks.find((task) => !task.done);
      return t && { kind: t.kind, id: t.id, material: t.material, x: t.x, y: t.y, z: t.z }; })() },
  lastEvents: events.slice(-8),
  wallDiagnostics,
  cellRejections,
}));
