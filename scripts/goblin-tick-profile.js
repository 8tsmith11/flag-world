// Compare goblin controller and body work across source revisions.
// Usage: node scripts/goblin-tick-profile.js [seed] [size] [mode] [ticks]
import { performance } from 'node:perf_hooks';
import { generateWorld } from '../shared/worldgen.js';
import { BLOCK } from '../shared/blocks.js';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { SaplingGrowth } from '../server/saplings.js';

const seed = Number(process.argv[2] ?? 12345);
const size = process.argv[3] ?? 'small';
const mode = process.argv[4] ?? 'far';
const count = Number(process.argv[5] ?? 6000);
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
if (process.argv[6] === 'mature') {
  game.goblins.startFastBuild();
  for (let tick = 1; tick <= 2000 && game.goblins.fastBuild; tick++) {
    game.tick = tick;
    game.saplings.tick(tick);
    game.goblins.update(tick);
  }
}
if (mode === 'near' || mode === 'surface') {
  const t = mode === 'surface' ? game.goblins.entrances.find((entrance) => entrance.open)?.outside
    ?? game.goblins.totemSpot : game.goblins.totemSpot;
  game.players.set(-1, { connected: true, dead: false, eliminated: true,
    state: { x: t.x + 10, y: t.y, z: t.z + 10 } });
}
const detail = {};
if (process.env.GOBLIN_PROFILE_DETAILS) {
  for (const [owner, names] of [[game.goblins, ['updateMode', 'updateProjects', 'updateAssignments',
    'updateVisibleGathering', 'naturalTrees', 'updateInvasion']], [game.goblins.sim, ['tick']]]) {
    for (const name of names) {
      const original = owner[name].bind(owner);
      owner[name] = (...args) => {
        const before = performance.now();
        const result = original(...args);
        detail[name] = (detail[name] ?? 0) + performance.now() - before;
        return result;
      };
    }
  }
}
const warmup = Math.min(1000, Math.floor(count / 4));
const baseTick = game.tick;
let total = 0;
for (let offset = 1; offset <= count + warmup; offset++) {
  const tick = baseTick + offset;
  game.tick = tick;
  game.saplings.tick(tick);
  const start = performance.now();
  game.goblins.update(tick);
  game.updateMobs();
  if (offset > warmup) total += performance.now() - start;
}
console.log(JSON.stringify({ seed, size, mode, ticks: count, meanGoblinMs: total / count, detail,
  modules: game.goblins.brickModules(), dwellings: game.goblins.dwellings(),
  population: game.goblins.population(), goblinBodies: [...game.mobs.values()].filter((mob) => mob.goblin).length }));
