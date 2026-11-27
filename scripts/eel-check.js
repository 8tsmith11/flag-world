// Void Eels: where they lurk and how they swim under islands.
//   - lurk spots favour team-island edges and small islands, not the huge
//     central island (EEL_LURK_WEIGHTS)
//   - an eel swimming under an island's underside dips under a one-block
//     step down instead of getting stuck against it
//   node scripts/eel-check.js
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { BLOCK } from '../shared/blocks.js';
import { generateWorld } from '../shared/worldgen.js';
import { VoidEel, underBlockSpot } from '../server/eel.js';

// ---- Getting past a step in the underside ----
{
  const world = new World(1, 64, 64, { sizeY: 96, minY: 0 }); world.voidY = 0;
  const C = 60;
  for (let x = 5; x < 59; x++) for (let z = 5; z < 59; z++) world.setBlock(x, C, z, BLOCK.STONE);
  for (let z = 5; z < 59; z++) world.setBlock(30, C - 1, z, BLOCK.STONE);   // a one-block step down, wall to wall
  const eel = new VoidEel(1, { top: 80, bottom: 4 }, { x: 20.5, y: C - 1, z: 30.5 });
  Object.assign(eel.state, { x: 20.5, y: C - 1, z: 30.5 });
  const goal = { x: 40.5, y: C - 0.6, z: 30.5 };
  let t = 0;
  for (; t < 400 && eel.state.x < 39; t++) eel.swim(world, goal, 3, false);
  assert.ok(eel.state.x >= 39, `the eel got stuck at the step (x ${eel.state.x.toFixed(1)})`);
}

// ---- Where they lurk ----
{
  const log = console.log; console.log = () => {};
  const world = generateWorld(2, 2, 'small');
  console.log = log;
  const lowest = Math.min(...world.islands.map((i) => i.bottomY));
  const band = { top: lowest - 6, bottom: world.voidY + 6 };
  const n = { center: 0, teamEdge: 0, teamInner: 0, tiny: 0, other: 0 };
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const s = underBlockSpot(world, band);
    if (!s) { n.other++; continue; }
    const isl = world.islands.find((k) => Math.hypot(s.x - k.x, s.z - k.z) <= k.radius * 1.1);
    if (!isl) n.other++;
    else if (isl.kind === 'center') n.center++;
    else if (isl.kind === 'tiny') n.tiny++;
    else if (isl.kind === 'team') Math.hypot(s.x - isl.x, s.z - isl.z) / isl.radius >= 0.65 ? n.teamEdge++ : n.teamInner++;
    else n.other++;
  }
  assert.ok(n.center < N * 0.3, `too many lurk spots under the central island (${JSON.stringify(n)})`);
  assert.ok(n.teamEdge > N * 0.3 && n.tiny > N * 0.15, `team-island edges and small islands are not favoured (${JSON.stringify(n)})`);
  assert.ok(n.teamInner < N * 0.05, `lurk spots in the middle of team islands (${JSON.stringify(n)})`);
}

console.log('OK: eels dip under steps in an underside, and lurk mostly at team-island edges and small islands');
