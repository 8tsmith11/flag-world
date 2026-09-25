// Fixed-seed progression comparison. GOBLIN_TIME_SCALE=60 node scripts/goblin-progress.js
import { generateWorld } from '../shared/worldgen.js';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { SaplingGrowth } from '../server/saplings.js';
import { BLOCK } from '../shared/blocks.js';
import { taskReady } from '../server/goblinProjects.js';
import { TICK_RATE } from '../shared/config.js';

const seed = Number(process.argv[2] ?? 12345);
const seconds = Number(process.argv[3] ?? 600);
const size = process.argv[4] ?? 'small';
const sampleEvery = Number(process.argv[5] ?? 60);

for (const mode of ['offscreen', 'full']) {
  const game = new Game();
  game.seed = seed;
  game.worldSize = size;
  game.world = generateWorld(seed, 2, size);
  game.saplings = new SaplingGrowth(game.world, () => false,
    (x, y, z) => game.goblins?.saplingGrowTime(x, y, z));
  game.world.onBlockChanged = (x, y, z, id, oldId) => {
    game.goblins?.blockChanged(x, y, z, id, oldId);
    if (oldId === BLOCK.SAPLING && id !== BLOCK.SAPLING) game.saplings.removed(x, y, z);
    if (id === BLOCK.SAPLING && oldId !== BLOCK.SAPLING) game.saplings.planted(x, y, z, game.tick);
  };
  game.goblins = new GoblinController(game);
  game.goblins.spawnAll();
  game.goblins.forceMode = mode;
  const samples = [];
  const jobs = {};
  for (let tick = 1; tick <= seconds * TICK_RATE; tick++) {
    game.tick = tick;
    game.saplings.tick(tick);
    game.goblins.update(tick);
    if (mode === 'full') {
      for (const mob of [...game.goblins.members]) mob.step(game.world, [], tick);
      const worker = [...game.goblins.members].find((g) => g.type === 'goblinWorker');
      const job = worker?.job?.type ?? 'none';
      jobs[job] = (jobs[job] ?? 0) + 1;
    }
    if (tick % (sampleEvery * TICK_RATE) === 0) {
      const s = game.goblins.status();
      samples.push({ minute: tick / TICK_RATE / 60, modules: s.modules,
        dwellings: s.dwellings, walls: s.walls ?? 0, population: s.population,
        project: s.project?.label ?? null, progress: s.project?.progress ?? null,
        storage: s.storage, stats: { ...game.goblins.stats },
        pending: game.goblins.project?.tasks.find((t) => !t.done) && {
          kind: game.goblins.project.tasks.find((t) => !t.done).kind,
          requires: game.goblins.project.tasks.find((t) => !t.done).requires.length,
        }, ready: game.goblins.project?.tasks.filter((t) => !t.done && taskReady(t, game.world, tick)).slice(0, 4)
          .map((t) => ({ kind: t.kind, material: t.material, id: t.id, x: t.x, y: t.y, z: t.z, requires: t.requires.length,
            claimedBy: t.claimedBy, blockedUntil: t.blockedUntil })),
        worker: [...game.goblins.members].filter((g) => g.type === 'goblinWorker').map((g) => ({
          job: g.job?.type, material: g.job?.material, carried: g.carried(), carrying: Object.fromEntries(g.carrying),
          fleeing: g.fleeing, stray: g.stray, alive: g.hp,
          waiting: g.waitingFor, position: [g.state.x, g.state.y, g.state.z],
        })) });
    }
  }
  console.log(JSON.stringify({ seed, size, mode, scale: process.env.GOBLIN_TIME_SCALE ?? '1',
    totem: game.goblins.totemSpot,
    breakthrough: game.goblins.events.find((e) => e.event === 'breakthrough')?.tick / TICK_RATE ?? null,
    relocation: game.goblins.events.find((e) => e.event === 'entranceRelocation')?.tick / TICK_RATE ?? null,
    jobs, samples, events: game.goblins.events.filter((e) => ['startProject', 'finishProject', 'spawn'].includes(e.event))
      .slice(0, 30), firstPlaces: game.goblins.project?.tasks.filter((t) => !t.done && t.kind === 'place')
      .slice(0, 5).map((t) => ({ id: t.id, material: t.material, requires: t.requires.length,
        blockedUntil: t.blockedUntil, claimedBy: t.claimedBy, x: t.x, y: t.y, z: t.z })) }));
}
