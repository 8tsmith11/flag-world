import { BLOCK, ladderBlock, isSolid, isDoor, FACING_DIRS } from '../blocks.js';
import { STRUCTURE_GEN as E, WALK_SPEED, SPRINT_SPEED_SCALE, JUMP_VELOCITY, GRAVITY } from '../config.js';
import { buildability, cellKey } from '../structures/buildability.js';
import { selectSites } from '../structures/site.js';
import { generateJigsaw, openConnections, pruneLeaves } from '../structures/jigsaw.js';
import { terraceBlocks } from '../structures/terrace.js';
import { wallRing, clusterPieces, enclosedMask, externalPlatformAccess, ringArea } from '../structures/walls.js';
import { densityFits } from '../structures/density.js';
import { placePlan } from '../structures/place.js';
import { surfaceContent } from './surfacePieces.js';
import { generateFortress } from './fortressLayout.js';
import { villageSettings } from './settings.js';
import { gatehouses } from './gatehouses.js';
const B = BLOCK.GOBLIN_BRICKS;
function shaft(x, z, lower, upper, room, stage, C) {
  const blocks = [];
  for (let y = lower; y <= upper; y++) {
    blocks.push({ x, y, z, id: ladderBlock(0) });
    for (const [dx, dz] of FACING_DIRS) {
      const opening = dx === 1 && y >= room.position.y + 1 && y <= room.position.y + C.passageHeight;
      blocks.push({ x: x + dx, y, z: z + dz, id: opening ? BLOCK.AIR : B });
    }
  }
  return { id: `shaft:${stage}`, type: 'shaft', position: { x, y: lower, z }, padHeight: lower, rotation: 0,
    stages: [stage], tags: [], connectors: [], blocks, loot: [], route: [],
    box: { x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1, y0: lower, y1: upper } };
}
function resolveSurface(world, map, plan, C) {
  const fail = reason => { plan.rejection = reason; return null; };
  const paths = plan.pieces.filter(p => p.type === 'path'), roads = [];
  for (const p of paths) {
    const incoming = plan.links.find(l => l.to === p.id), outgoing = plan.links.find(l => l.from === p.id);
    const begin = incoming.a.y - 1, end = outgoing ? outgoing.b.y - 1 : p.padHeight;
    const c0 = incoming.b, c1 = p.connectors.find(c => c.index !== c0.index);
    p.levels = {};
    for (const b of p.blocks) {
      const length = Math.abs(c1.x - c0.x) + Math.abs(c1.z - c0.z);
      const distance = Math.abs(c1.x === c0.x ? b.z - c0.z : b.x - c0.x);
      b.y = Math.round(begin + (end - begin) * distance / length);
      p.levels[cellKey(b.x, b.z)] = b.y; roads.push({ ...b, bridge: p.waterCrossing });
    }
    p.earthwork.cost = Object.entries(p.levels).reduce((n, [k, y]) => n + Math.abs(y - map.cells.get(k).ground), 0);
    if (p.earthwork.cost > p.earthwork.budget) return fail('pathBudget');
  }
  for (const p of paths) for (const c of p.connectors) c.y = p.levels[cellKey(c.x, c.z)] + 1;
  for (const l of plan.links) {
    l.a = { ...plan.pieces.find(p => p.id === l.from).connectors[l.a.index] };
    l.b = { ...plan.pieces.find(p => p.id === l.to).connectors[l.b.index] };
  }
  const levels = new Map();
  for (const p of plan.pieces) for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) levels.set(cellKey(x, z), p.levels?.[cellKey(x, z)] ?? p.padHeight);
  // Extend clear building exits through the outer ring into open terrain.
  // Gate placement uses these actual road cells, including both approaches.
  for (const p of plan.pieces.filter(p => ['home', 'longhouse', 'workshop', 'storehouse'].includes(p.type))) {
    for (const c of p.connectors.filter(c => c.pool === 'ends' && !c.resolved)) {
      const [dx, dz] = FACING_DIRS[c.facing], exit = [];
      let valid = true, previous = p.padHeight;
      for (let i = 0; i <= C.outerMargin + C.roadLength && valid; i++) {
        const x = c.x + dx * i, z = c.z + dz * i, cell = map.cells.get(cellKey(x, z));
        if (!cell) { valid = false; break; }
        const y = i <= C.outerMargin ? p.padHeight : Math.max(previous - 1, Math.min(previous + 1, cell.ground));
        previous = y;
        for (let side = -1; side <= 1; side++) {
          if (i === 0 && side) continue;
          const r = { x: x + dz * side, y, z: z - dx * side }, n = map.cells.get(cellKey(r.x, r.z));
          if (!n || n.keepOut || n.reserved || n.water === 'lake' || plan.pieces.some(q => q !== p && q.type !== 'path'
            && r.x >= q.box.x0 && r.x <= q.box.x1 && r.z >= q.box.z0 && r.z <= q.box.z1)) { valid = false; break; }
          exit.push(r);
        }
      }
      if (!valid) continue;
      for (let j = 1; j < C.buildingWidth - 1; j++) exit.push({ x: c.x - dx * j, y: p.padHeight, z: c.z - dz * j });
      for (const r of exit) { roads.push(r); levels.set(cellKey(r.x, r.z), r.y); }
    }
  }
  const bridgeCells = new Set(roads.filter(r => r.bridge).map(r => cellKey(r.x, r.z)));
  const planned = new Map(plan.pieces.flatMap(p => p.blocks.map(b => [`${b.x},${b.y},${b.z}`, b.id])));
  const groundAt = (x, z) => {
    const c = map.cells.get(cellKey(x, z));
    return c && !c.keepOut && !c.reserved && (c.water !== 'lake' || bridgeCells.has(cellKey(x, z))) ? levels.get(cellKey(x, z)) ?? c.ground : null;
  };
  const compounds = clusterPieces(plan.pieces.filter(p => p.type !== 'path'), plan.seed,
    { groupSize: C.compoundGroup, distance: C.compoundDistance, fraction: C.compoundFraction });
  // Preserve small compounds. If two smoothed outlines meet, keep the first
  // cluster and leave the other buildings in the outer enclosure.
  const masks = [];
  for (let i = 0; i < compounds.length;) {
    const area = enclosedMask(compounds[i], C.innerMargin);
    if (masks.some(a => [...area].some(k => a.has(k)))) compounds.splice(i, 1);
    else { masks.push(area); i++; }
  }
  const rings = [], jump = { speed: WALK_SPEED * SPRINT_SPEED_SCALE, velocity: JUMP_VELOCITY,
    gravity: GRAVITY, margin: C.ladderSafetyMargin };
  for (const [index, initial] of compounds.entries()) {
    const members = [...initial];
    let ring = null;
    for (;;) {
      ring = wallRing({ name: `compound${index + 1}`, pieces: members, margin: C.innerMargin,
        paths: roads, groundAt, material: B, height: C.wallHeight, gateHeight: C.gateClearance, cornerLimit: E.compoundCorners });
      if (!ring || !ring.gates.length || ring.corners > E.compoundCorners) { ring = null; break; }
      const crossed = plan.pieces.filter(p => p.type !== 'path' && !members.includes(p)).find(p =>
        ring.wall.some(w => w.x >= p.box.x0 && w.x <= p.box.x1 && w.z >= p.box.z0 && w.z <= p.box.z1)
        || p.platforms.some(top => externalPlatformAccess(top, ring, jump)));
      if (!crossed) break;
      if (members.length >= C.compoundGroup[1]) { ring = null; break; }
      members.push(crossed);
    }
    if (ring && rings.some(r => ring.area.some(k => ringArea(r).has(k)))) ring = null;
    if (!ring) { if (members.some(p => p.tags.includes('core'))) return fail('compound'); continue; }
    rings.push(ring);
  }
  const outer = wallRing({ name: 'outer', pieces: plan.pieces, margin: C.outerMargin,
    paths: roads, groundAt, material: B, height: C.wallHeight, gateHeight: C.gateClearance, cornerLimit: E.outerCorners });
  if (!outer || !outer.gates.length || outer.corners > E.outerCorners) return fail('ring');
  rings.push(outer);
  // Road earthworks and clearance are explicit plan data as well.
  const finishing = [];
  for (const r of roads) {
    const c = map.cells.get(cellKey(r.x, r.z)); if (!c || c.keepOut || c.reserved || c.water === 'lake' && !r.bridge) return fail('road');
    if (r.bridge && c.water === 'lake') finishing.push({ x: r.x, y: r.y, z: r.z, id: BLOCK.PLANKS });
    else for (let y = Math.min(r.y, c.ground); y <= r.y; y++) finishing.push({ x: r.x, y, z: r.z, id: y === r.y ? r.id ?? BLOCK.DIRT : BLOCK.DIRT });
    const covered = plan.pieces.some(p => ['home', 'longhouse', 'workshop', 'storehouse'].includes(p.type)
      && r.x >= p.box.x0 && r.x <= p.box.x1 && r.z >= p.box.z0 && r.z <= p.box.z1);
    const clearTo = covered ? r.y + C.passageHeight : Math.max(c.ground + E.treeClearance, r.y + C.gateClearance);
    for (let y = r.y + 1; y <= clearTo; y++) {
      if (!isDoor(planned.get(`${r.x},${y},${r.z}`))) finishing.push({ x: r.x, y, z: r.z, id: BLOCK.AIR });
    }
  }
  const posts = [];
  for (const ring of rings) {
    for (const w of [...ring.wall, ...ring.gates]) {
      // Foundations replace small puddles; clear tree branches over the rim.
      if (!ring.gates.includes(w)) for (let y = w.y; y >= w.y - E.treeClearance && !isSolid(world.getBlock(w.x, y, w.z)); y--) {
        finishing.push({ x: w.x, y, z: w.z, id: B });
      }
      for (let y = w.y + 1; y <= w.y + E.treeClearance; y++) finishing.push({ x: w.x, y, z: w.z, id: BLOCK.AIR });
    }
    for (let i = 0; i < ring.wall.length; i += C.postSpacing) {
      const w = ring.wall[i];
      const inside = FACING_DIRS.find(([dx, dz]) => ringArea(ring).has(cellKey(w.x + dx, w.z + dz))
        && !ring.wall.some(a => a.x === w.x + dx && a.z === w.z + dz)
        && !roads.some(a => a.x === w.x + dx && a.z === w.z + dz));
      if (!inside) continue;
      const [dx, dz] = inside, x = w.x + dx, z = w.z + dz;
      // A ladder can be inside this compound but outside an adjacent one.
      // Require the inside face of every wall beside the proposed column.
      if (rings.some(other => !ringArea(other).has(cellKey(x, z))
        && other.wall.some(a => Math.abs(a.x - x) + Math.abs(a.z - z) === 1))) continue;
      const base = groundAt(x, z); if (base === null || Math.abs(base - w.y) > 1) continue;
      const facing = FACING_DIRS.findIndex(d => d[0] === -dx && d[1] === -dz);
      const platform = [];
      // A level three-block shooting ledge embedded in a straight wall run.
      for (let side = -(C.postWidth >> 1); side <= C.postWidth >> 1; side++) {
        const px = w.x + dz * side, pz = w.z - dx * side;
        const support = ring.wall.find(a => a.x === px && a.z === pz);
        if (!support || support.y !== w.y) { platform.length = 0; break; }
        platform.push({ x: px, y: w.y + C.wallHeight, z: pz });
      }
      if (platform.length !== C.postWidth || rings.some(other => externalPlatformAccess({ x: w.x, z: w.z, y: w.y + C.wallHeight, width: C.postWidth }, other, jump))) continue;
      for (let y = base + 1; y <= w.y + C.wallHeight + E.grassClearance; y++) finishing.push({ x, y, z, id: BLOCK.AIR });
      for (let y = base; y >= base - E.treeClearance && !isSolid(world.getBlock(x, y, z)); y--) finishing.push({ x, y, z, id: BLOCK.DIRT });
      for (let y = base + 1; y <= w.y + C.wallHeight; y++) finishing.push({ x, y, z, id: ladderBlock(facing) });
      posts.push({ ring: ring.name, x: w.x, y: w.y + C.wallHeight, z: w.z, platform, ladder: { x, z, base, facing } });
    }
  }
  // Only clear connected doorways; towers keep their own interior hatch.
  finishing.push(...openConnections(plan, C.passageHeight).filter(b => {
    const p = plan.pieces.find(p => b.x >= p.box.x0 && b.x <= p.box.x1 && b.z >= p.box.z0 && b.z <= p.box.z1);
    return p?.type !== 'tower';
  }));
  for (const ring of rings) finishing.push(...ring.blocks);
  const houses = gatehouses(rings.find(r => r.name === 'outer'), roads, map, C);
  if (!houses) return fail('gatehouse');
  const occupied = new Set(levels.keys());
  for (const p of plan.pieces) p.earthworks = terraceBlocks(world, map, p, E, occupied);
  finishing.push(...houses.flatMap(p => p.blocks));
  plan.gatehouses = houses; plan.compounds = rings.filter(r => r.name !== 'outer').map(r => r.pieceIds);
  plan.roads = roads; plan.rings = rings; plan.posts = posts; plan.finishing = finishing;
  return plan;
}

export function generateGoblinVillage(world, terrain, progress = () => {}) {
  const C = villageSettings(terrain), seed = world.seed ^ C.seedSalt;
  const reserved = { ...C.center, radius: C.reservedRadius };
  const map = buildability(world, terrain, E, reserved), surface = surfaceContent(C);
  const audit = {};
  let attempt = 0;
  for (const site of selectSites(map, seed, { ...E, siteRadius: Math.round(C.radius * C.siteClearanceFraction), anchorRadius: (C.castleWidth >> 1) + C.outerMargin })) {
    progress('village', { attempt: ++attempt });
    // Each anchor gets a repeatable layout instead of retrying the same
    // unsuitable branch pattern across an entire region.
    const index=site.x-terrain.x0+terrain.width*(site.z-terrain.z0);
    const layoutSeed=seed^Math.imul(index,C.surfaceSiteSalt);
    const village = generateJigsaw({ seed:layoutSeed, anchor: 'castle', position: site, ...surface, map,
      config: { ...E, density: null, maxDepth: C.surfaceDepth, maxPieces: C.surfacePieces } });
    if (!village || village.pieces.filter(p => !['path', 'castle'].includes(p.type)).length < C.minSurfaceBuildings) continue;
    pruneLeaves(village, p => p.type === 'path');
    audit.surface = (audit.surface ?? 0) + 1;
    if (!resolveSurface(world, map, village, C)) { audit[village.rejection] = (audit[village.rejection] ?? 0) + 1; continue; }
    const entrance = village.pieces[0];
    progress('fortress', { attempt });
    const fortress = generateFortress(map, site, entrance.padHeight, seed, C);
    if (!fortress) { audit.fortress = (audit.fortress ?? 0) + 1; continue; }
    const mid = fortress.pieces[0], totem = fortress.pieces.find(p => p.type === 'totemHall');
    const upperShaft = shaft(site.x, site.z, mid.position.y + 1, entrance.padHeight, mid, 'final', C);
    const initialShaft = shaft(site.x, site.z, totem.position.y + 1, entrance.padHeight, totem, 'initial', C);
    const plug = [];
    for (let y = totem.box.y1 + 1; y <= mid.position.y; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) plug.push({ x: site.x + dx, y, z: site.z + dz, id: B });
    const column = { ...upperShaft.box, y0: totem.box.y1 + 1 };
    if (!densityFits([...fortress.pieces.map(p => p.box), column], E.density, column)) continue;
    fortress.finishing = [...openConnections(fortress, C.passageHeight), ...upperShaft.blocks, ...plug, ...fortress.buttresses];
    fortress.shaft = upperShaft; fortress.plug = plug;
    fortress.stages = { initial: { pieces: [totem, initialShaft], finishing: initialShaft.blocks },
      final: { pieces: [...fortress.pieces, upperShaft], finishing: fortress.finishing } };
    for (const p of fortress.pieces) p.stages = p === totem ? ['initial', 'final'] : ['final'];
    village.civilization = fortress.civilization = 'goblin';
    placePlan(world, village); placePlan(world, fortress);
    world.structures.push({ kind: upperShaft.type, civilization: 'goblin', box: { ...upperShaft.box } });
    for (const p of village.gatehouses) world.structures.push({ kind: 'gatehouse', civilization: 'goblin', box: p.box });
    world.goblinPlan = { seed, site, settings: C, reserved, buildability: map, surface: village, fortress };
    return world.goblinPlan;
  }
  throw new Error(`No complete goblin village/fortress fits seed ${world.seed}: ${JSON.stringify(audit)}`);
}
