// Later generators never change blocks inside the Wise Monkey's shrine, the
// storm cloud (Ancient Lightning Monkey) or the fire temple (Ancient Fire
// Monkey) once they are built. Houses and towers reshape the ground
// PREPARE_MARGIN blocks around themselves, so surfaceSite keeps that margin
// clear of other structures. Small seeds 7 and 8 used to put a house's
// margin into a shrine.
//   node scripts/structure-sites-check.js
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { generateWorld } from '../shared/worldgen.js';
import { BLOCK } from '../shared/blocks.js';

const KINDS = new Set(['monkeyShrine', 'stormCloud', 'fireTemple']);
const setBlock = World.prototype.setBlock;
let hits = [];
World.prototype.setBlock = function (x, y, z, id) {
  const old = this.structures && this.getBlock(x, y, z);
  // Torches inside are turned to face their wall afterwards; that's fine.
  if (old && old !== id && old !== BLOCK.TORCH && id !== BLOCK.TORCH) for (const s of this.structures) {
    const b = s.box;
    if (KINDS.has(s.kind) && b && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) {
      hits.push(`${s.kind} at ${x},${y},${z}: ${old} -> ${id}`);
      break;
    }
  }
  return setBlock.call(this, x, y, z, id);
};
for (const seed of [7, 8]) {
  hits = [];
  const log = console.log; console.log = () => {};
  const world = generateWorld(seed, 2, 'small');
  console.log = log;
  assert.equal(world.structures.filter((s) => s.kind === 'monkeyShrine').length, 2, `seed ${seed}: missing shrines`);
  assert.deepEqual(hits, [], `seed ${seed}: generation changed blocks inside a monkey site`);
}
World.prototype.setBlock = setBlock;
console.log('OK: houses, towers and other later structures leave the monkey shrines, storm cloud and fire temple intact');
