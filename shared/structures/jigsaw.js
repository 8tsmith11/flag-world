import { BLOCK, blockBase, facedBlock, isLadder, ladderFacing, ladderBlock, isDoor, doorState, doorBlock } from '../blocks.js';
import { STRUCTURE_GEN } from '../config.js';
import { mulberry32 } from '../structures.js';
import { assessTerrace } from './terrace.js';
import { densityFits } from './density.js';

export function rotate(x, z, turns) {
  for (let i = 0; i < turns; i++) [x, z] = [-z, x];
  return [x, z];
}
function rotatedBlock(id, turns) {
  if (id === BLOCK.TORCH) return id; // Floor attachments have no horizontal facing.
  if (isLadder(id)) return ladderBlock((ladderFacing(id) + turns) % 4);
  if (isDoor(id)) { const d = doorState(id); return doorBlock((d.facing + turns) % 4, d.open, d.upper, d.reinforced); }
  const d = blockBase(id); return facedBlock(d.base, (d.facing + turns) % 4);
}
export function resolvePiece(template, position, rotation, index, deferBlocks = false) {
  const point = (p) => { const [x, z] = rotate(p.x, p.z, rotation);
    return { x: x + position.x, y: p.y + position.y, z: z + position.z }; };
  const corners = [point({ x: template.x0, z: template.z0, y: template.y0 }),
    point({ x: template.x1, z: template.z1, y: template.y1 })];
  const piece = { id: `${template.id}:${index}`, type: template.type, template: template.id,
    position: { ...position }, rotation, padHeight: position.y,
    tags: [...(template.tags ?? [])], stages: [...(template.stages ?? ['final'])],
    waterCrossing: !!template.waterCrossing, retainingBlock: template.retainingBlock,
    box: { x0: Math.min(...corners.map(p => p.x)), x1: Math.max(...corners.map(p => p.x)),
      z0: Math.min(...corners.map(p => p.z)), z1: Math.max(...corners.map(p => p.z)),
      y0: position.y + template.y0, y1: position.y + template.y1 },
    connectors: template.connectors.map((p, i) => ({ ...p, ...point(p),
      facing: (p.facing + rotation) % 4, index: i, resolved: false })),
    loot: (template.loot ?? []).map(p => ({ ...p, ...point(p) })),
    traps: (template.traps ?? []).map(p => ({ ...p, ...point(p), facing: (p.facing + rotation) % 4, sensor: p.sensor ? point(p.sensor) : null })),
    route: (template.route ?? []).map(point),
    platforms: (template.platforms ?? []).map(p => ({ ...p, ...point(p), ladder: point(p.ladder) })),
    windows: (template.windows ?? []).map(point) };
  const blocks = () => template.blocks.map(p => ({ ...point(p), id: rotatedBlock(p.id, rotation) }));
  if (deferBlocks) Object.defineProperty(piece, 'blocks', { enumerable: true, configurable: true,
    get() {
      const value = blocks();
      Object.defineProperty(piece, 'blocks', { enumerable: true, configurable: true, writable: true, value });
      return value;
    } });
  else piece.blocks = blocks();
  return piece;
}
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0 && a.y0 <= b.y1 && a.y1 >= b.y0;
const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Templates, pools and validators are data/callbacks; no civilization rules.
// A fallback with no blocks closes the connector rather than leaving a hole.
export function generateJigsaw({ seed, anchor, position, rotation = 0, pieces, pools,
  map = null, validate = () => true, config = STRUCTURE_GEN }) {
  const required = new Set(Object.values(pools).flatMap(p => p.entries.filter(e => e.required).map(e => e.id)));
  for (let attempt = 0; attempt < config.retries; attempt++) {
    const random = mulberry32(seed + attempt), placed = [], links = [], used = new Set(), queue = [];
    const add = (piece, template, depth, consumed = -1) => {
      // Only accepted pieces allocate their voxel lists. Plans remain plain
      // data, and validators that inspect blocks still get the same list.
      void piece.blocks;
      placed.push(piece); used.add(template.id);
      piece.connectors.forEach((c, i) => {
        if (i === consumed) c.resolved = true;
        else queue.push({ piece, c, depth });
      });
    };
    let first = resolvePiece(pieces[anchor], position, rotation, 0, true);
    if (map) {
      const t = assessTerrace(map, first.box, pieces[anchor].earthwork, false, pieces[anchor].clearance);
      if (!t) return null;
      first = resolvePiece(pieces[anchor], { ...position, y: t.height }, rotation, 0, true);
      first.earthwork = t;
    }
    if (!validate(first, { placed: [], links: [] }) || !densityFits([first.box], config.density, first.box)) return null;
    add(first, pieces[anchor], 0);
    for (let q = 0; q < queue.length; q++) {
      const { piece: parent, c, depth } = queue[q], pool = pools[c.pool];
      if (!pool) throw new Error(`Unknown connector pool ${c.pool}`);
      const choices = depth >= config.maxDepth || placed.length >= config.maxPieces ? []
        : pool.entries.filter(e => !(e.unique && used.has(e.id))).map(e =>
          ({ ...e, priority: -Math.log(Math.max(Number.EPSILON, random())) / e.weight }))
          .sort((a, b) => Number(!!b.required && !used.has(b.id)) - Number(!!a.required && !used.has(a.id)) || a.priority - b.priority);
      choices.push({ id: pool.fallback, fallback: true });
      let fitted = false;
      for (const entry of choices) {
        const template = pieces[entry.id];
        if (!template) throw new Error(`Unknown piece ${entry.id}`);
        if (!template.blocks.length) { c.closed = true; fitted = true; break; }
        for (let ci = 0; ci < template.connectors.length && !fitted; ci++) {
          const match = template.connectors[ci];
          if (match.name !== c.name) continue;
          const turn = (c.facing + 2 - match.facing + 4) % 4;
          const [mx, mz] = rotate(match.x, match.z, turn), [dx, dz] = directions[c.facing];
          const at = { x: c.x + dx - mx, z: c.z + dz - mz, y: c.y - match.y };
          let candidate = resolvePiece(template, at, turn, placed.length, true);
          if (map) {
            const t = assessTerrace(map, candidate.box, template.earthwork, template.waterCrossing, template.clearance);
            if (!t || Math.abs(t.height - at.y) > Math.min(c.maxStep ?? config.connectorStep, match.maxStep ?? config.connectorStep)) continue;
            at.y = t.height; candidate = resolvePiece(template, at, turn, placed.length, true); candidate.earthwork = t;
          }
          if (placed.some(p => overlaps(p.box, candidate.box)) || !validate(candidate, { placed, links, parent })
            || !densityFits([...placed.map(p => p.box), candidate.box], config.density, candidate.box)) continue;
          c.resolved = true;
          links.push({ from: parent.id, to: candidate.id, a: { ...c }, b: { ...candidate.connectors[ci] } });
          add(candidate, template, depth + 1, ci); fitted = true;
        }
        if (fitted) break;
      }
      if (!fitted) c.closed = true;
    }
    if ([...required].some(id => !used.has(id))) continue;
    return { pieces: placed, links, order: placed.map(p => p.id), seed, attempt };
  }
  return null;
}

export function openConnections(plan, height) {
  const openings = [];
  for (const link of plan.links) for (const c of [link.a, link.b]) {
    const half = Math.floor(Math.min(link.a.width ?? 1, link.b.width ?? 1) / 2);
    for (let side = -half; side <= half; side++) for (let dy = 0; dy < height; dy++) {
      openings.push({ x: c.x + (c.facing % 2 ? 0 : side), y: c.y + dy,
        z: c.z + (c.facing % 2 ? side : 0), id: BLOCK.AIR });
    }
  }
  return openings;
}

// Remove unfinished transit branches, preserving terminal destinations. This
// runs on plan data before placement, so closed template faces stay intact.
export function pruneLeaves(plan, predicate) {
  let changed = true;
  while (changed) {
    changed = false;
    const leaves = new Set(plan.pieces.filter(p => predicate(p) && !plan.links.some(l => l.from === p.id)).map(p => p.id));
    if (!leaves.size) break;
    for (const link of plan.links.filter(l => leaves.has(l.to))) {
      const parent = plan.pieces.find(p => p.id === link.from), c = parent.connectors[link.a.index];
      c.resolved = false; c.closed = true;
    }
    plan.pieces = plan.pieces.filter(p => !leaves.has(p.id));
    plan.links = plan.links.filter(l => !leaves.has(l.from) && !leaves.has(l.to));
    plan.order = plan.order.filter(id => !leaves.has(id));
    changed = true;
  }
  return plan;
}

// Assemble a guided spine and its branches using the same resolution,
// collision and density rules as connector growth. Content chooses templates
// and anchors; this engine owns placement, connections and breadth-first order.
export function createJigsaw({ seed, validate = () => true, density = null }) {
  const plan = { seed, pieces: [], links: [], order: [] };
  return {
    plan,
    add(template, position, rotation = 0) {
      const p = resolvePiece(template, position, rotation, plan.pieces.length, true);
      if (plan.pieces.some(q => overlaps(q.box, p.box))
        || !validate(p, { placed: plan.pieces, links: plan.links })
        || !densityFits([...plan.pieces.map(q => q.box), p.box], density, p.box)) return null;
      void p.blocks;
      plan.pieces.push(p); return p;
    },
    connect(a, b) {
      const ca = a.piece.connectors[a.index], cb = b.piece.connectors[b.index];
      const [dx, dz] = directions[ca.facing];
      if (ca.resolved || cb.resolved || ca.name !== cb.name || cb.facing !== (ca.facing + 2) % 4
        || ca.x + dx !== cb.x || ca.z + dz !== cb.z || ca.y !== cb.y) throw new Error('Mismatched guided connectors');
      ca.resolved = cb.resolved = true;
      plan.links.push({ from: a.piece.id, to: b.piece.id, a: { ...ca }, b: { ...cb } });
    },
    finish() {
      if (!plan.pieces.length) return plan;
      const queue = [plan.pieces[0].id], seen = new Set(queue);
      for (let i = 0; i < queue.length; i++) for (const l of plan.links) {
        const next = l.from === queue[i] ? l.to : l.to === queue[i] ? l.from : null;
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
      plan.order = queue;
      for (const p of plan.pieces) for (const c of p.connectors) if (!c.resolved) c.closed = true;
      return plan;
    },
    rollback(count, linkCount) { plan.pieces.length = count; plan.links.length = linkCount; },
  };
}

export function connectedRoute(plan, start, destination) {
  const parents = new Map([[start, null]]), queue = [start];
  for (let i = 0; i < queue.length && !parents.has(destination); i++) for (const l of plan.links) {
    const next = l.from === queue[i] ? l.to : l.to === queue[i] ? l.from : null;
    if (next && !parents.has(next)) { parents.set(next, queue[i]); queue.push(next); }
  }
  if (!parents.has(destination)) return [];
  const route = [];
  for (let id = destination; id !== null; id = parents.get(id)) route.push(id);
  return route.reverse();
}
