// One generated seed, geometry/route assertions only; no long simulation.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { generateWorld, parseSeed } from '../shared/worldgen.js';
import { Garrison } from '../server/goblins/garrison.js';
import { GOBLINS, LIFE } from '../shared/goblins/life.js';
import { recomputeOutskirts } from '../shared/goblins/outskirts.js';
import { nodeKey, insideBox, positionRegion } from '../shared/goblins/areas.js';
import { cellKey } from '../shared/structures/buildability.js';
import { lifeMap, structureMap } from './structure-map.js';

const seed = parseSeed(process.argv[2] ?? '1');
const world = generateWorld(seed, 2, 'small');
const game = { world, tick: 0, nextId: 1, mobs: new Map(), broadcast() {} };
const garrison = new Garrison(game), plan = world.goblinPlan;
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
for (const area of plan.areas) check(area.spawns.length > 0, `${area.id} has no spawn room`);
const underground = plan.areas.filter(a => a.kind === 'underground');
check(underground.length >= LIFE.undergroundAreas[0] && underground.length <= LIFE.undergroundAreas[1], 'Underground area count outside configured bounds');
for (const area of plan.areas) check(area.nodes.size <= (area.kind === 'surface' ? LIFE.maxSurfaceArea : LIFE.maxUndergroundArea), `${area.id} exceeds configured area size`);
for (const area of plan.outskirts) {
  check(!!area.linkedSpawn, `${area.id} has no linked spawn`);
  check(plan.gates.some(g => g.id === area.linkedGate && g.kind === 'outer'), `${area.id} has no outer gate`);
}
for (const g of plan.gates) check(g.areas.length === 2 && new Set(g.areas).size === 2, `Gate ${g.id} must connect exactly two regions`);
let routes = 0;
for (const slot of garrison.slots.values()) {
  const area = garrison.nav.area(slot.home), spawn = garrison.spawnFor(slot);
  if (!spawn) { problems.push(`${slot.id} has no spawn`); continue; }
  const start = { x: spawn.point.x + 0.5, y: spawn.point.y, z: spawn.point.z + 0.5 };
  const route = garrison.nav.route(start, slot.point, area, { role: slot.role, ladders: GOBLINS[slot.role].ladders, unlimited: true });
  const same = nodeKey(spawn.point) === nodeKey(slot.point);
  check(route?.length > 0 || same, `${slot.id} ${slot.role}/${slot.duty} unreachable from ${spawn.id} to ${nodeKey(slot.point)}`);
  const end = route?.at(-1) ?? spawn.point;
  check(nodeKey(end) === nodeKey(slot.point), `${slot.id} doesn't reach its post`);
  // Cross-area spawns necessarily begin outside home. Check their permitted
  // gate-chain transit, then require every patrol/working leg to remain home.
  const origin = positionRegion(plan, start), chain = garrison.nav.chain(origin?.id, area.id);
  const volumes = (chain ?? [area.id]).flatMap(id => garrison.nav.area(id).volumes);
  for (const p of route ?? []) check(volumes.some(v => insideBox(v, { ...p, x: p.x + 0.5, z: p.z + 0.5 })), `${slot.id} transit leaves gate-chain volumes`);
  for (const p of [...slot.loop, ...area.interests]) {
    const leg = garrison.nav.route({ x: slot.point.x + 0.5, y: slot.point.y, z: slot.point.z + 0.5 }, p, area,
      { role: slot.role, ladders: GOBLINS[slot.role].ladders, unlimited: true });
    // King's radius/room duty is deliberately smaller than its containing area.
    if (slot.role === 'king' || slot.role === 'totem') break;
    check(leg?.length > 0 || nodeKey(p) === nodeKey(slot.point), `${slot.id} cannot reach home patrol/interest ${nodeKey(p)}`);
    for (const n of leg ?? []) check(area.volumes.some(v => insideBox(v, { ...n, x: n.x + 0.5, z: n.z + 0.5 })), `${slot.id} patrol leaves home volume`);
  }
  if (slot.role === 'king') {
    const field = garrison.nav.field(area, garrison.nav.nearest(area, slot.point, 'king'), false, 'king');
    for (const [a, b] of field.next) check(!plan.graph.get(a).edges.find(e => e.to === b)?.ladder, 'King nav contains ladder');
  }
  routes++;
}
for (const area of [...plan.areas, ...plan.outskirts]) for (const key of area.nodes) {
  const n = plan.graph.get(key); if (!n) continue;
  for (const e of n.edges) {
    const b = plan.graph.get(e.to); if (!b) continue;
    for (const p of [n, b]) {
      const wall = plan.wallCells.get(cellKey(p.x, p.z));
      check(!wall || p.y < wall.y0 || p.y > wall.y1 || plan.platformCells.has(p.key), `Nav edge crosses wall at ${p.key}`);
    }
  }
}
writeFileSync(`/tmp/goblin-life-${seed}.txt`, lifeMap(world));
writeFileSync(`/tmp/goblin-life-detail-${seed}.txt`, structureMap(world));
console.log(lifeMap(world));
assert.equal(problems.length, 0, problems.join('\n'));
const initial = `${plan.areas.length} areas, ${plan.outskirts.length} sections, ${plan.gates.length} gates, ${routes} reachable slots`;
// Rebuild the same seed's geometry only: planned -> active simulates future
// growth, and verifies obsolete slot objects/caches cannot survive a rebuild.
const changedArea = plan.areas.filter(a => a.kind === 'surface').at(-1);
for (const state of ['planned', 'active']) {
  const previous = new Set(plan.outskirts.flatMap(a => a.slots)), version = plan.outskirtsVersion;
  changedArea.state = state; recomputeOutskirts(world);
  assert(plan.outskirtsVersion > version);
  garrison.update(-1); // No spawn/physics simulation; only rebuild slot data.
  for (const section of plan.outskirts) {
    assert(section.linkedSpawn && section.linkedGate, `${state}: ${section.id} lacks spawn/gate`);
    assert(garrison.nav.area(section.linkedArea)?.state === 'active');
    for (const slot of section.slots) assert(!previous.has(slot), 'Old section slot retained');
  }
  for (const slot of garrison.slots.values()) if (slot.home.startsWith('O')) assert(plan.outskirts.some(a => a.id === slot.home), 'Obsolete slot survived');
}
console.log(`OK seed ${seed}: ${initial}; planned/active outskirts rebuilds passed`);
