import { BLOCK, isSolid, isWater, isClimbable, FACING_DIRS, doorBlock } from '../blocks.js';
import { playerFitsAt } from '../physics.js';
import { cellKey } from '../structures/buildability.js';
import { LIFE as C } from './life.js';

export const nodeKey = p => `${Math.floor(p.x)},${Math.round(p.y)},${Math.floor(p.z)}`;
export const insideBox = (b, p) => p.x >= b.x0 && p.x < b.x1 + 1 && p.y >= b.y0
  && p.y < b.y1 + 1 && p.z >= b.z0 && p.z < b.z1 + 1;
const body = { halfW: 0.35, height: 1.95 };
export function walkable(world, p) {
  return !isWater(world.getBlock(p.x, p.y, p.z))
    && playerFitsAt(world, { x: p.x + 0.5, y: p.y, z: p.z + 0.5, box: body }, p.y)
    && (isSolid(world.getBlock(p.x, p.y - 1, p.z))
      || isClimbable(world.getBlock(p.x, p.y, p.z)) || isClimbable(world.getBlock(p.x, p.y - 1, p.z)));
}
export function makeGraph(world, volumes, wallCells = new Set(), platforms = new Set()) {
  const nodes = new Map();
  for (const v of volumes) for (let y = v.y0; y <= v.y1; y++) {
    const p = { x: v.x0, y, z: v.z0 }, k = nodeKey(p);
    if (!nodes.has(k) && walkable(world, p)) nodes.set(k, { ...p, key: k, edges: [] });
  }
  for (const p of nodes.values()) {
    const ladder = isClimbable(world.getBlock(p.x, p.y, p.z)) || isClimbable(world.getBlock(p.x, p.y - 1, p.z));
    if (ladder) for (const dy of [-1, 1]) {
      const n = nodes.get(nodeKey({ ...p, y: p.y + dy }));
      if (n) p.edges.push({ to: n.key, cost: C.ladderCost, ladder: true });
    }
    for (const [dx, dz] of FACING_DIRS) for (const dy of [0, 1, -1]) {
      const n = nodes.get(nodeKey({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
      if (!n) continue;
      // Explicit shooting ledges may be entered from their inside ladder.
      // Every other edge onto/along a wall column is forbidden at every height.
      if ([p, n].some(a => {
        const wall = wallCells.get?.(cellKey(a.x, a.z));
        return wall && a.y >= wall.y0 && a.y <= wall.y1 && !platforms.has(a.key);
      })) continue;
      if (dy === 1 && !playerFitsAt(world, { x: p.x + 0.5, z: p.z + 0.5, box: body }, p.y + 1)) continue;
      if (dy === -1 && !playerFitsAt(world, { x: n.x + 0.5, z: n.z + 0.5, box: body }, p.y)) continue;
      p.edges.push({ to: n.key, cost: 1 + Math.abs(dy) * 0.5, ladder: false });
      break;
    }
  }
  return nodes;
}
export function components(graph, removed = new Set()) {
  const seen = new Set(removed), result = [];
  for (const first of graph.values()) {
    if (seen.has(first.key)) continue;
    const group = [first]; seen.add(first.key);
    for (let i = 0; i < group.length; i++) for (const edge of group[i].edges) {
      const n = graph.get(edge.to);
      if (n && !seen.has(n.key)) { seen.add(n.key); group.push(n); }
    }
    result.push(group);
  }
  return result;
}
export function surfaceVolumes(plan, columns) {
  const pieces = [...plan.surface.pieces, ...plan.surface.gatehouses, ...(plan.surface.guardRooms ?? [])];
  const contained = pieces.filter(p => columns.has(cellKey(p.position?.x ?? p.x, p.position?.z ?? p.z)));
  const highest = Math.max(-Infinity, ...contained.map(p => p.box.y1));
  return [...columns].flatMap(k => {
    const c = plan.buildability.cells.get(k); if (!c) return [];
    const roofs = pieces.filter(p => c.x >= p.box.x0 && c.x <= p.box.x1 && c.z >= p.box.z0 && c.z <= p.box.z1);
    const ground = plan.surface.roads.find(r => r.x === c.x && r.z === c.z)?.y
      ?? roofs[0]?.padHeight ?? c.ground;
    return [{ x0: c.x, x1: c.x, z0: c.z, z1: c.z, y0: ground - C.surfaceDepth,
      y1: Math.max(ground, highest) + C.structureHeadroom }];
  });
}
function gateGroups(cells) {
  const remaining = new Map(cells.map(p => [nodeKey(p), p])), groups = [];
  while (remaining.size) {
    const group = [remaining.values().next().value]; remaining.delete(nodeKey(group[0]));
    for (let i = 0; i < group.length; i++) for (const [k, p] of remaining) {
      if (Math.abs(p.x - group[i].x) + Math.abs(p.z - group[i].z) === 1 && Math.abs(p.y - group[i].y) <= 1) {
        remaining.delete(k); group.push(p);
      }
    }
    groups.push(group);
  }
  return groups;
}
function regions(graph, gates, kind, plan) {
  let groups, owner;
  // Small pockets caused by furniture/steps are merged through a doorway.
  // A gate that doesn't separate two components is simply an interior doorway.
  for (;;) {
    groups = components(graph, new Set(gates.flatMap(g => g.cells.map(nodeKey))));
    owner = new Map(groups.flatMap((a, i) => a.map(n => [n.key, i])));
    const invalid = gates.find(g => {
      const neighbours = new Set(g.cells.flatMap(p => (graph.get(nodeKey(p))?.edges ?? []).map(e => owner.get(e.to))).filter(i => i !== undefined));
      g.groups = [...neighbours];
      return neighbours.size !== 2 || g.groups.some(i => groups[i].length < C.minArea);
    });
    if (!invalid) break;
    gates.splice(gates.indexOf(invalid), 1);
  }
  const areas = groups.filter(a => a.length >= C.minArea).map((nodes, index) => {
    const id = `${kind === 'surface' ? 'S' : 'U'}${index + 1}`;
    const keys = new Set(nodes.map(n => n.key));
    const cols = new Set(nodes.map(n => cellKey(n.x, n.z)));
    const volumes = kind === 'surface' ? surfaceVolumes(plan, cols) : [...cols].map(k => {
      const inColumn = nodes.filter(n => cellKey(n.x, n.z) === k), p = inColumn[0];
      const rooms = plan.fortress.pieces.filter(room => p.x >= room.box.x0 && p.x <= room.box.x1 && p.z >= room.box.z0 && p.z <= room.box.z1
        && inColumn.some(n => n.y >= room.box.y0 && n.y <= room.box.y1));
      return { x0: p.x, x1: p.x, z0: p.z, z1: p.z, y0: Math.min(...inColumn.map(n => n.y)) - 1,
        y1: Math.max(...inColumn.map(n => n.y + 3), ...rooms.map(room => room.box.y1)) };
    });
    return { id, kind, state: 'active', nodes: keys, columns: cols, volumes, spawns: [], interests: [], gates: [], slots: [] };
  });
  const byNode = new Map(areas.flatMap(a => [...a.nodes].map(k => [k, a])));
  for (const g of gates) {
    g.areas = [...new Set(g.cells.flatMap(p => (graph.get(nodeKey(p))?.edges ?? []).map(e => byNode.get(e.to)?.id)).filter(Boolean))];
    if (g.areas.length !== 2) continue;
    for (const id of g.areas) {
      const a = areas.find(a => a.id === id);
      for (const p of g.cells) { a.nodes.add(nodeKey(p)); a.volumes.push({ x0: p.x, x1: p.x, z0: p.z, z1: p.z, y0: p.y - 1, y1: p.y + 3 }); }
      a.gates.push(g.id);
    }
  }
  return { areas, gates: gates.filter(g => g.areas.length === 2) };
}
export function positionRegion(plan, position) {
  if (!plan) return null;
  const k = cellKey(Math.floor(position.x), Math.floor(position.z));
  for (const a of [...(plan.areas ?? []), ...(plan.outskirts ?? []), ...(plan.creativeAreas ?? [])]) {
    if (a.state !== 'active' || !a.columns.has(k) && !a.volumes.some(v => v.x0 === Math.floor(position.x) && v.z0 === Math.floor(position.z))) continue;
    if (a.volumes.some(v => insideBox(v, position))) return a;
  }
  return null;
}
export function computeAreas(world, plan) {
  const s = plan.surface, f = plan.fortress;
  const walls = new Map(s.rings.flatMap(r => r.wall.map(p => [cellKey(p.x, p.z), { y0: p.y + 1, y1: p.y + r.height + 2 }])));
  const platforms = new Set(s.posts.flatMap(p => p.platform.map(b => nodeKey({ ...b, y: b.y + 1 }))));
  const outer = s.rings.find(r => r.name === 'outer');
  const columns = new Set(outer?.area ?? s.pieces.flatMap(p => {
    const cells = []; for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) cells.push(cellKey(x, z)); return cells;
  }));
  // Gatehouses straddle the perimeter and belong to its inner area.
  for (const p of s.gatehouses) for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) columns.add(cellKey(x, z));
  const sg = makeGraph(world, surfaceVolumes(plan, columns), walls, platforms);
  // Roofs and tree crowns are not plan walking space. Only designed floors,
  // galleries, tower platforms and their ladders belong to the surface graph.
  for (const [k, n] of sg) {
    const pieces = [...s.pieces, ...s.gatehouses].filter(p => n.x >= p.box.x0 && n.x <= p.box.x1 && n.z >= p.box.z0 && n.z <= p.box.z1);
    const aboveFloor = pieces.some(p => n.y > (p.padHeight ?? p.y ?? p.box.y0) + 1);
    const designed = pieces.some(p => (p.platforms ?? []).some(t => n.y === t.y + 1 && Math.abs(n.x - t.x) <= (t.width >> 1) && Math.abs(n.z - t.z) <= (t.width >> 1))
      || p.type === 'castle' && n.y === p.padHeight + plan.settings.castleGalleryHeight + 1);
    const ladder = isClimbable(world.getBlock(n.x, n.y, n.z)) || isClimbable(world.getBlock(n.x, n.y - 1, n.z));
    if (aboveFloor && !designed && !ladder && !platforms.has(k)) sg.delete(k);
  }
  for (const n of sg.values()) n.edges = n.edges.filter(e => sg.has(e.to));
  const castle = s.pieces.find(p => p.type === 'castle');
  const castleCells = castle.connectors.flatMap(c => [-1, 0, 1].map(d => ({ x: c.x + (c.facing % 2 ? 0 : d), y: c.y, z: c.z + (c.facing % 2 ? d : 0) })));
  const surfaceGates = gateGroups([...s.rings.filter(r => r.name !== 'outer').flatMap(r => r.gates.map(p => ({ ...p, y: p.y + 1 }))), ...castleCells])
    .map((cells, i) => ({ id: `gS${i}`, kind: 'surface', cells }));
  const boxes = [...f.pieces.map(p => p.box), f.shaft.box];
  const uv = boxes.flatMap(b => { const v = []; for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) v.push({ ...b, x0: x, x1: x, z0: z, z1: z }); return v; });
  const ug = makeGraph(world, uv);
  // Hallway cut planes are genuine brick-framed, open doorways. Choose cuts
  // by component sizes, not room type, then remove unnecessary small cuts.
  const candidates = f.pieces.filter(p => ['hall', 'trapCorridor'].includes(p.type) && p.connectors.length === 2).map((p, i) => {
    const alongX = p.box.x1 - p.box.x0 > p.box.z1 - p.box.z0;
    const x = Math.round((p.box.x0 + p.box.x1) / 2), z = Math.round((p.box.z0 + p.box.z1) / 2), y = p.position.y + 1;
    const cells = [];
    for (let d = -(plan.settings.corridorWidth >> 1); d <= plan.settings.corridorWidth >> 1; d++) cells.push({ x: x + (alongX ? 0 : d), y, z: z + (alongX ? d : 0) });
    return { id: `gU${i}`, kind: 'underground', cells, piece: p.id, alongX };
  });
  const target = Math.max(C.undergroundAreas[0], Math.min(C.undergroundAreas[1], Math.ceil(f.pieces.filter(p => p.tags.includes('room')).length / C.roomsPerArea)));
  const cuts = [];
  for (;;) {
    const groups = components(ug, new Set(cuts.flatMap(g => g.cells.map(nodeKey))));
    if (groups.length >= C.undergroundAreas[1]) break;
    if (groups.length >= target && Math.max(...groups.map(g => g.length)) <= C.maxUndergroundArea) break;
    let best = null;
    for (const g of candidates.filter(g => !cuts.includes(g))) {
      const next = components(ug, new Set([...cuts, g].flatMap(g => g.cells.map(nodeKey))));
      if (next.length <= groups.length || next.some(a => a.length < C.minArea)) continue;
      const score = Math.max(...next.map(a => a.length));
      if (!best || score < best.score) best = { g, score };
    }
    if (!best) break;
    cuts.push(best.g);
  }
  splitLargeSurface(world, plan, sg, surfaceGates, walls);
  const sr = regions(sg, surfaceGates, 'surface', plan), ur = regions(ug, cuts, 'underground', plan);
  plan.graph = new Map([...sg, ...ug]); plan.wallCells = walls; plan.platformCells = platforms;
  plan.areas = [...sr.areas, ...ur.areas]; plan.gates = [...sr.gates, ...ur.gates];
  for (const g of ur.gates) for (const p of g.cells) {
    // The open wooden leaves are traversable; their surrounding hall is brick.
    world.setBlock(p.x, p.y, p.z, doorBlock(g.alongX ? 1 : 0, true, false));
    world.setBlock(p.x, p.y + 1, p.z, doorBlock(g.alongX ? 1 : 0, true, true));
    f.finishing.push({ ...p, id: world.getBlock(p.x, p.y, p.z) }, { ...p, y: p.y + 1, id: world.getBlock(p.x, p.y + 1, p.z) });
  }
  const spawnTypes = new Set(['home', 'longhouse', 'castle', 'gatehouse', 'barracks', 'guardroom', 'totemHall']);
  for (const a of plan.areas) {
    const pieces = a.kind === 'surface' ? [...s.pieces, ...s.gatehouses] : f.pieces;
    for (const p of pieces) {
      const floor = p.padHeight ?? p.position?.y ?? p.y ?? p.box.y0;
      const cx = p.position?.x ?? p.x ?? (p.box.x0 + p.box.x1) / 2, cz = p.position?.z ?? p.z ?? (p.box.z0 + p.box.z1) / 2;
      const n = [...a.nodes].map(k => plan.graph.get(k)).filter(n => n && n.x > p.box.x0 && n.x < p.box.x1 && n.z > p.box.z0 && n.z < p.box.z1
        && n.y === floor + 1 && !isClimbable(world.getBlock(n.x, n.y - 1, n.z)))
        .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
      if (!n) continue;
      a.interests.push({ ...n, edges: undefined });
      for (const door of p.connectors ?? []) if (a.nodes.has(nodeKey(door))) a.interests.push({ x: door.x, y: door.y, z: door.z });
      if (spawnTypes.has(p.type)) {
        const supports = p.blocks.filter(b => b.y >= p.box.y1 - 1 && isSolid(world.getBlock(b.x, b.y, b.z)));
        a.spawns.push({ id: p.id, piece: p.id, box: p.box, supports, point: { x: n.x, y: n.y, z: n.z } });
      }
    }
    if (!a.spawns.length) {
      // An ordinary room/courtyard gets a small guard room, kept clear of
      // roads, doorways and posts. This is plan content, not a population rule.
      const nodes = [...a.nodes].map(k => plan.graph.get(k));
      const broad = nodes.find(n => FACING_DIRS.every(([dx, dz]) => a.nodes.has(nodeKey({ ...n, x: n.x + dx * 2, z: n.z + dz * 2 }))));
      const center = broad ?? nodes.find(n => FACING_DIRS.every(([dx, dz]) => a.nodes.has(nodeKey({ ...n, x: n.x + dx, z: n.z + dz })))) ?? nodes[0];
      const half = broad ? 2 : 1;
      const box = { x0: center.x - half, x1: center.x + half, z0: center.z - half, z1: center.z + half, y0: center.y - 1, y1: center.y + 2 };
      const room = { id: `guard:${a.id}`, type: 'guardroom', box, position: { ...center }, blocks: [], area: a.id };
      // Partition an existing underground room; surface rooms get a timber
      // canopy and corner posts, with four broad open entrances.
      for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) {
        if (!a.nodes.has(nodeKey({ ...center, x: center.x + dx, z: center.z + dz }))) continue;
        room.blocks.push({ x: center.x + dx, y: center.y - 1, z: center.z + dz, id: BLOCK.PLANKS });
        if (a.kind === 'surface') {
          room.blocks.push({ x: center.x + dx, y: center.y + 2, z: center.z + dz, id: BLOCK.PLANKS });
          if (Math.abs(dx) === half && Math.abs(dz) === half) for (let y = center.y; y < center.y + 2; y++) room.blocks.push({ x: center.x + dx, y, z: center.z + dz, id: BLOCK.WOOD });
        }
      }
      for (const b of room.blocks) world.setBlock(b.x, b.y, b.z, b.id);
      (a.kind === 'surface' ? s : f).guardRooms ??= []; (a.kind === 'surface' ? s : f).guardRooms.push(room);
      world.structures.push({ kind: 'guardroom', civilization: 'goblin', box });
      a.spawns.push({ id: room.id, piece: room.id, box, supports: [{ x: center.x, y: box.y1, z: center.z }], point: { x: center.x, y: center.y, z: center.z } });
      a.interests.push({ x: center.x, y: center.y, z: center.z });
    }
  }
  // Guard-room details are real geometry. Remove their occupied feet cells
  // and headroom-blocked jump edges before anyone receives a slot or route.
  for (const [k, n] of plan.graph) if (!walkable(world, n)) plan.graph.delete(k);
  for (const a of plan.areas) for (const k of a.nodes) if (!plan.graph.has(k)) a.nodes.delete(k);
  for (const n of plan.graph.values()) n.edges = n.edges.filter(e => {
    const b = plan.graph.get(e.to); if (!b) return false;
    if (e.ladder) return true;
    return b.y <= n.y || playerFitsAt(world, { x: n.x + 0.5, z: n.z + 0.5, box: body }, n.y + 1);
  });
  // Shaft-mouth gate joins surface and underground volumes; the long shaft
  // itself belongs to the Mid Room area.
  const p = { x: f.shaft.position.x, y: f.shaft.box.y1 + 1, z: f.shaft.position.z };
  const sa = plan.areas.find(a => a.kind === 'surface' && a.nodes.has(nodeKey(p)));
  const ua = plan.areas.find(a => a.kind === 'underground' && a.nodes.has(nodeKey({ ...p, y: p.y - 1 })));
  if (sa && ua) {
    const mid = f.pieces.find(room => room.type === 'midRoom');
    const gate = { id: 'shaftGate', kind: 'shaft', cells: [p], areas: [sa.id, ua.id],
      posts: { [sa.id]: { ...p, x: p.x + 2 }, [ua.id]: { x: mid.position.x + 2, y: mid.position.y + 1, z: mid.position.z } } };
    plan.gates.push(gate); sa.gates.push(gate.id); ua.gates.push(gate.id);
    const n = plan.graph.get(nodeKey(p)), down = plan.graph.get(nodeKey({ ...p, y: p.y - 1 }));
    if (n && down) { n.edges.push({ to: down.key, ladder: true, cost: C.ladderCost }); down.edges.push({ to: n.key, ladder: true, cost: C.ladderCost }); }
  }
  for (const a of plan.areas) for (const g of plan.gates.filter(g => g.areas.includes(a.id))) {
    for (const p of g.posts?.[a.id] ? [g.posts[a.id]] : g.cells) if (a.nodes.has(nodeKey(p))) a.interests.push({ x: p.x, y: p.y, z: p.z });
  }
  completeVolumes(plan);
  return plan.areas;
}

// Membership covers the developed volume, including solid walls/furniture,
// not just feet cells. Those blocks must be locatable for edits and repairs.
function completeVolumes(plan) {
  const surface = plan.areas.filter(a => a.kind === 'surface');
  const outline = new Set(plan.surface.rings.find(r => r.name === 'outer')?.area ?? []);
  for (const ring of plan.surface.rings) for (const w of ring.wall) outline.add(cellKey(w.x, w.z));
  for (const p of [...plan.surface.pieces, ...plan.surface.gatehouses, ...(plan.surface.guardRooms ?? [])]) {
    for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) outline.add(cellKey(x, z));
  }
  const owner = new Map(surface.flatMap(a => [...a.columns].map(k => [k, a]))), queue = [...owner.keys()];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i], [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of FACING_DIRS) {
      const next = cellKey(x + dx, z + dz);
      if (!outline.has(next) || owner.has(next)) continue;
      const a = owner.get(k); owner.set(next, a); a.columns.add(next); queue.push(next);
    }
  }
  for (const a of surface) a.volumes.push(...surfaceVolumes(plan, a.columns));
  const underground = plan.areas.filter(a => a.kind === 'underground');
  for (const p of [...plan.fortress.pieces, plan.fortress.shaft]) {
    const floor = p === plan.fortress.shaft ? plan.fortress.shaft.box.y0 : p.position.y + 1;
    const candidates = underground.flatMap(a => [...a.nodes].map(k => plan.graph.get(k))
      .filter(n => n && n.y === floor && n.x >= p.box.x0 && n.x <= p.box.x1 && n.z >= p.box.z0 && n.z <= p.box.z1)
      .map(n => ({ n, a })));
    if (!candidates.length) continue;
    for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) {
      const { a } = candidates.reduce((best, c) => Math.abs(c.n.x - x) + Math.abs(c.n.z - z)
        < Math.abs(best.n.x - x) + Math.abs(best.n.z - z) ? c : best);
      a.columns.add(cellKey(x, z));
      a.volumes.push({ x0: x, x1: x, z0: z, z1: z, y0: p.box.y0, y1: p.box.y1 });
    }
  }
}

// Oversized courtyards are divided by a brick partition with a traversable
// doorway. Existing buildings/platforms are never cut by the partition.
function splitLargeSurface(world, plan, graph, gates, walls) {
  let serial = 0;
  for (;;) {
    const groups = components(graph, new Set(gates.flatMap(g => g.cells.map(nodeKey))));
    const large = groups.find(g => g.length > C.maxSurfaceArea); if (!large) return;
    let best = null;
    for (const axis of ['x', 'z']) {
      const low = Math.min(...large.map(n => n[axis])), high = Math.max(...large.map(n => n[axis]));
      for (let coordinate = low + 2; coordinate < high - 1; coordinate++) {
        if (plan.surface.pieces.some(p => p.type !== 'path' && coordinate >= p.box[`${axis}0`] && coordinate <= p.box[`${axis}1`])) continue;
        const plane = large.filter(n => n[axis] === coordinate); if (!plane.length) continue;
        const removed = new Set([...gates.flatMap(g => g.cells.map(nodeKey)), ...plane.map(n => n.key)]);
        const next = components(graph, removed);
        if (next.length !== groups.length + 1 || next.some(g => g.length < C.minArea)) continue;
        const score = Math.max(...next.map(g => g.length));
        if (!best || score < best.score) best = { plane, axis, score };
      }
    }
    if (!best) throw new Error('Oversized surface area has no building-safe gate partition');
    const middle = best.plane[Math.floor(best.plane.length / 2)];
    const gate = { id: `splitS${serial++}`, kind: 'surface', cells: [{ x: middle.x, y: middle.y, z: middle.z }] };
    const ring = { name: gate.id, height: plan.settings.wallHeight, wall: [], gates: [], blocks: [],
      area: [...new Set(large.map(n => cellKey(n.x, n.z)))], pieceIds: [], corners: 4 };
    for (const n of best.plane) {
      const doorway = n.key === middle.key;
      (doorway ? ring.gates : ring.wall).push({ x: n.x, y: n.y - 1, z: n.z });
      if (!doorway) { graph.delete(n.key); walls.set(cellKey(n.x, n.z), { y0: n.y, y1: n.y + ring.height + 1 }); }
      for (let h = 0; h < ring.height; h++) {
        const id = doorway && h < plan.settings.gateClearance ? h < 2 ? doorBlock(best.axis === 'x' ? 1 : 0, true, h === 1) : BLOCK.AIR : BLOCK.GOBLIN_BRICKS;
        const b = { x: n.x, y: n.y + h, z: n.z, id }; world.setBlock(b.x, b.y, b.z, id); ring.blocks.push(b);
      }
    }
    for (const n of graph.values()) n.edges = n.edges.filter(e => graph.has(e.to));
    gates.push(gate); plan.surface.rings.push(ring); plan.surface.finishing.push(...ring.blocks);
  }
}
