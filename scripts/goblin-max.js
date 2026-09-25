// Creative max-base smoke run. GOBLIN_TIME_SCALE=60 node scripts/goblin-max.js
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/worldgen.js';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { SaplingGrowth } from '../server/saplings.js';
import { BLOCK } from '../shared/blocks.js';

const seed = Number(process.argv[2] ?? 12345);
const size = process.argv[3] ?? 'small';
const limit = Number(process.argv[4] ?? 1000);
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
game.goblins.startFastBuild();
const samples = [];
for (let tick = 1; tick <= limit; tick++) {
  game.tick = tick;
  game.saplings.tick(tick);
  game.goblins.update(tick);
  if (tick % 20 === 0 || !game.goblins.fastBuild) {
    const s = game.goblins.status();
    samples.push({ tick, modules: s.modules, dwellings: s.dwellings,
      surfaceBuildings: game.goblins.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind)).length,
      walls: s.walls,
      outerWall: s.outerWall, relocation: s.relocation, population: s.population,
      project: s.project?.label ?? null, progress: s.project?.progress ?? null });
  }
  if (!game.goblins.fastBuild) break;
}
assert.equal(game.goblins.fastBuild, false, 'creative boost finishes within the tick limit');
// Once the boost ends, nearby players switch the colony back to full mode.
// Exercise the building scan after wall posts have been added.
assert.equal(game.goblins.events.find((e) => e.event === 'fastBuildFinished')?.atCaps, true,
  'creative boost reaches the configured base caps');
assert.ok(game.goblins.buildings.filter((b) => b.kind === 'wallPost').every((b) => b.box),
  'every archer wall post has a footprint for targeting and nearby-player scans');
const t = game.goblins.totemSpot;
game.players.set(-1, { connected: true, dead: false,
  state: { x: t.x + 10, y: t.y, z: t.z + 10 } });
game.tick++;
game.goblins.update(game.tick);
console.log(JSON.stringify({ seed, size, samples, events: game.goblins.events.filter((e) =>
  ['breakthrough', 'entranceRelocation', 'fastBuildFinished', 'startProject', 'finishProject', 'woodSkipped', 'cancelProject'].includes(e.event)),
  storage: game.goblins.storageContents(),
  credits: { worker: game.goblins.sim.workerCredit, place: game.goblins.sim.placeCredit,
    starved: game.goblins.sim.starved },
  remaining: Object.fromEntries([...new Set(game.goblins.project?.tasks.filter((t) => !t.done).map((t) => `${t.kind}:${t.material}`) ?? [])]
    .map((key) => [key, game.goblins.project.tasks.filter((t) => !t.done && `${t.kind}:${t.material}` === key).length])),
  pending: game.goblins.project?.tasks.filter((t) => !t.done).slice(0, 8).map((t) =>
    ({ kind: t.kind, id: t.id, material: t.material, requires: t.requires.length })) }));
