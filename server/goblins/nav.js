import { Heap } from '../pathfind.js';
import { makeGraph, nodeKey, insideBox, positionRegion } from '../../shared/goblins/areas.js';
import { cellKey } from '../../shared/structures/buildability.js';
import { LIFE as C, boxOf } from '../../shared/goblins/life.js';
import { playerFitsAt } from '../../shared/physics.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y);
// Column bucket size for the per-area nearest-node index.
const BUCKET = 8;
export function straighten(path) {
  return path.filter((p, i) => {
    if (!i || i === path.length - 1) return true;
    const a = path[i - 1], b = path[i + 1];
    // Keep vertical, step-up/down, and ladder entry/exit points explicit.
    return p.ladder || a.ladder || b.ladder || a.y !== p.y || b.y !== p.y || (p.x - a.x) * (b.z - p.z) !== (p.z - a.z) * (b.x - p.x);
  }).map((p, i, points) => {
    const next = points[i + 1];
    const previous = points[i - 1];
    const landing = p.grounded && previous?.ladder && !previous.grounded
      && p.y >= previous.y && (p.x !== previous.x || p.z !== previous.z);
    const exitHeight = p.ladder && !p.grounded && next?.grounded && next.y >= p.y ? next.y : undefined;
    return { x: p.x, y: p.y, z: p.z, ladder: p.ladder, grounded: p.grounded,
      exitHeight: landing ? p.y : exitHeight };
  });
}
export class GoblinNav {
  constructor(world) {
    this.world = world; this.plan = world.goblinPlan; this.caches = new Map();
    this.budget = C.nodeBudget; this.version = this.plan.outskirtsVersion;
    // dirty: area id -> columns ("x,z") edited since the last tick.
    this.waypoints = new Map(); this.dirty = new Map(); this.indexes = new Map();
    this.reportLadders(this.plan.ladderProblems ?? []);
  }
  reportLadders(problems) {
    for (const p of problems) console.warn(`Ladder has no valid top landing at ${nodeKey(p)}`);
  }
  beginTick() {
    this.budget = C.nodeBudget;
    if (this.version !== this.plan.outskirtsVersion) {
      for (const id of this.caches.keys()) if (id.startsWith('O')) this.caches.delete(id);
      this.version = this.plan.outskirtsVersion;
    }
    for (const [id, columns] of this.dirty) {
      const area = this.area(id); if (area) this.refresh(area, columns);
    }
    this.dirty.clear();
  }
  regions() { return [...this.plan.areas, ...this.plan.outskirts, ...(this.plan.creativeAreas ?? [])]; }
  // By id; rebuilt when outskirts are recomputed or a creative home is added.
  area(id) {
    const plan = this.plan;
    const signature = `${plan.areas.length}:${plan.creativeAreas?.length ?? 0}`;
    if (!this.byId || this.byIdOutskirts !== plan.outskirts || this.byIdSignature !== signature) {
      this.byId = new Map(this.regions().map(a => [a.id, a]));
      this.byIdOutskirts = plan.outskirts; this.byIdSignature = signature;
    }
    return this.byId.get(id);
  }
  // Volumes indexed by column, rebuilt when an area's volume list changes
  // (block edits test every region, so a linear scan over thousands of
  // per-column volumes is too slow).
  contains(area, p) {
    if (!area) return false;
    let index = area.volumeIndex;
    if (!index || index.count !== area.volumes.length) {
      index = area.volumeIndex = new Map(); index.count = area.volumes.length;
      for (const v of area.volumes) for (let z = v.z0; z <= v.z1; z++) for (let x = v.x0; x <= v.x1; x++) {
        const k = cellKey(x, z); if (!index.has(k)) index.set(k, []);
        index.get(k).push(v);
      }
    }
    return !!index.get(cellKey(Math.floor(p.x), Math.floor(p.z)))?.some(v => insideBox(v, p));
  }
  // Edits are coalesced per area until the next tick; see refresh().
  changed(x, y, z) {
    const p = { x, y, z };
    for (const a of this.regions()) {
      if (!this.contains(a, p)) continue;
      if (!this.dirty.has(a.id)) this.dirty.set(a.id, new Set());
      this.dirty.get(a.id).add(cellKey(x, z));
    }
  }
  // Rebuilds the graph only around edited columns: nodes within one column
  // of an edit are rebuilt (from a graph two columns wide, so all their edges
  // are fresh), and nodes in the ring around them get fresh edges toward the
  // rebuilt ones. Edges leaving the window (gates into other areas) are
  // kept. Route caches and the revision only change when the walkable graph
  // did, so roof and wall repairs don't make every goblin re-plan.
  refresh(a, columns) {
    const around = r => {
      const out = new Set();
      for (const k of columns) {
        const [x, z] = k.split(',').map(Number);
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.add(cellKey(x + dx, z + dz));
      }
      return out;
    };
    const inner = around(1), window = around(2), plan = this.plan;
    const column = key => { const [x, , z] = key.split(','); return `${x},${z}`; };
    const volumes = a.volumes.filter(v => window.has(cellKey(v.x0, v.z0)));
    const graph = makeGraph(this.world, volumes, plan.wallCells, plan.platformCells);
    // Cells the rebuild covered: inner columns, within this area's volumes
    // (a column can continue below or above them, e.g. a shaft).
    const byColumn = new Map();
    for (const v of volumes) { const k = cellKey(v.x0, v.z0); if (!byColumn.has(k)) byColumn.set(k, []); byColumn.get(k).push(v); }
    const rebuilt = key => {
      const [x, y, z] = key.split(',').map(Number);
      return inner.has(cellKey(x, z)) && !!byColumn.get(cellKey(x, z))?.some(v => y >= v.y0 && y <= v.y1);
    };
    this.reportLadders(graph.ladderProblems);
    const edgesKey = edges => edges.map(e => `${e.to}:${e.cost}:${!!e.ladder}`).sort().join('|');
    let changed = false;
    for (const k of [...a.nodes]) {
      if (!inner.has(column(k))) continue;
      const old = plan.graph.get(k), n = graph.get(k);
      if (!n) { plan.graph.delete(k); a.nodes.delete(k); changed = true; continue; }
      // Edges into rebuilt columns come only from the new graph; edges leaving
      // the window (gates into other areas) are kept.
      for (const e of old?.edges ?? []) if (!graph.has(e.to) && !rebuilt(e.to) && plan.graph.has(e.to)) n.edges.push(e);
      // Keep the old node (and its cached fit answers) when nothing differs.
      if (old && old.grounded === n.grounded && old.ladder === n.ladder && edgesKey(old.edges) === edgesKey(n.edges)
        && Object.keys(old.fits ?? {}).every(role => this.fits(n, role) === old.fits[role])) continue;
      plan.graph.set(k, n); changed = true;
    }
    for (const [k, n] of graph) {
      if (inner.has(column(k))) {
        if (!a.nodes.has(k)) { plan.graph.set(k, n); a.nodes.add(k); changed = true; }
        continue;
      }
      const old = plan.graph.get(k); if (!old || !a.nodes.has(k)) continue;
      const edges = [...old.edges.filter(e => !rebuilt(e.to)), ...n.edges.filter(e => rebuilt(e.to))];
      if (edgesKey(edges) !== edgesKey(old.edges)) { old.edges = edges; changed = true; }
    }
    if (!changed) return;
    this.caches.delete(a.id); this.waypoints.delete(a.id); this.indexes.delete(a.id);
    a.revision = (a.revision ?? 0) + 1;
  }
  // Cached on the node: refresh() replaces an edited region's nodes, which
  // drops their cached answers with them.
  fits(n, role) {
    const cache = n.fits ??= {};
    return cache[role] ??= playerFitsAt(this.world, { x: n.x + 0.5, y: n.y, z: n.z + 0.5, box: boxOf(role) }, n.y);
  }
  // An area's nodes bucketed by column, rebuilt when its graph changes.
  index(area) {
    let index = this.indexes.get(area.id);
    if (index && index.revision === (area.revision ?? 0) && index.size === area.nodes.size) return index;
    const buckets = new Map(); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of area.nodes) {
      const n = this.plan.graph.get(k); if (!n) continue;
      const bx = Math.floor(n.x / BUCKET), bz = Math.floor(n.z / BUCKET), key = `${bx},${bz}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(n);
      x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); z0 = Math.min(z0, bz); z1 = Math.max(z1, bz);
    }
    index = { revision: area.revision ?? 0, size: area.nodes.size, buckets, x0, x1, z0, z1 };
    this.indexes.set(area.id, index); return index;
  }
  // Nodes goblins can actually walk to: a search from every standing spawn
  // point through the nodes of active areas. Natural caves inside a planned
  // volume are walkable but cut off. Recomputed at most every reachTicks.
  reachable(spawnAlive, tick) {
    if (this.reach && tick - this.reach.tick < C.reachTicks) return this.reach.set;
    const active = this.regions().filter(a => a.state === 'active');
    const member = k => active.some(a => a.nodes.has(k)), set = new Set(), queue = [];
    for (const a of active) for (const s of a.spawns ?? []) {
      const k = nodeKey(s.point);
      if (spawnAlive(s) && this.plan.graph.has(k) && !set.has(k)) { set.add(k); queue.push(k); }
    }
    for (let i = 0; i < queue.length; i++) for (const e of this.plan.graph.get(queue[i])?.edges ?? []) {
      if (set.has(e.to) || !this.plan.graph.has(e.to) || !member(e.to)) continue;
      set.add(e.to); queue.push(e.to);
    }
    this.reach = { tick, set };
    return set;
  }
  // Grounded nodes that fit the role within `radius` (horizontal) of a point,
  // nearest first.
  nodesNear(area, point, radius, role) {
    if (!area) return [];
    const index = this.index(area), result = [];
    for (let bz = Math.floor((point.z - radius) / BUCKET); bz <= Math.floor((point.z + radius) / BUCKET); bz++)
      for (let bx = Math.floor((point.x - radius) / BUCKET); bx <= Math.floor((point.x + radius) / BUCKET); bx++)
        for (const n of index.buckets.get(`${bx},${bz}`) ?? []) {
          const d = Math.hypot(n.x + 0.5 - point.x, n.z + 0.5 - point.z);
          if (d <= radius && n.grounded && this.fits(n, role)) result.push({ n, d });
        }
    return result.sort((a, b) => a.d - b.d).map(e => e.n);
  }
  // Searches buckets in rings around the point and stops once a ring can't
  // hold anything closer than the best so far.
  nearest(area, point, role = 'worker', standing = true) {
    if (!area) return null;
    const index = this.index(area), bx = Math.floor(point.x / BUCKET), bz = Math.floor(point.z / BUCKET);
    const rings = Math.max(bx - index.x0, index.x1 - bx, bz - index.z0, index.z1 - bz);
    let best = null, d = Infinity;
    const scan = (x, z) => {
      for (const n of index.buckets.get(`${x},${z}`) ?? []) {
        if (standing && !n.grounded || !this.fits(n, role)) continue;
        const score = distance(n, point);
        if (score < d) { best = n; d = score; }
      }
    };
    for (let r = 0; r <= rings; r++) {
      if ((r - 1) * BUCKET > d) break;
      if (!r) { scan(bx, bz); continue; }
      for (let x = bx - r; x <= bx + r; x++) { scan(x, bz - r); scan(x, bz + r); }
      for (let z = bz - r + 1; z <= bz + r - 1; z++) { scan(bx - r, z); scan(bx + r, z); }
    }
    return best;
  }
  // Reverse weighted flow fields for surface destinations. Underground fields
  // retain room/connector/shaft waypoints from the plan and their voxel paths.
  field(area, goal, ladders, role) {
    let cache = this.caches.get(area.id);
    if (!cache || cache.revision !== (area.revision ?? 0)) {
      cache = new Map(); cache.revision = area.revision ?? 0; this.caches.set(area.id, cache); this.waypoints.delete(area.id);
    }
    const key = `${goal.key}:${ladders}:${role}`;
    if (cache.has(key)) return cache.get(key);
    // Waypoints follow the finished fortress's rooms; an area still being
    // built (area.unfinished) routes over its plain graph.
    const waypointGraph = area.kind === 'underground' && !area.unfinished ? this.waypointGraph(area, role, ladders) : null;
    const members = waypointGraph ? new Set(waypointGraph.keys()) : area.nodes;
    const reverse = new Map();
    for (const k of members) {
      const n = this.plan.graph.get(k); if (!n || !this.fits(n, role)) continue;
      for (const e of n.edges) if (members.has(e.to) && (ladders || !e.ladder)) {
        if (!reverse.has(e.to)) reverse.set(e.to, []);
        reverse.get(e.to).push({ from: k, cost: e.cost });
      }
    }
    const heap = new Heap(), costs = new Map([[goal.key, 0]]), next = new Map(); heap.push(0, goal.key);
    while (heap.size) {
      const k = heap.pop(), cost = costs.get(k);
      for (const e of reverse.get(k) ?? []) {
        const c = cost + e.cost;
        if (c >= (costs.get(e.from) ?? Infinity)) continue;
        costs.set(e.from, c); next.set(e.from, k); heap.push(c, e.from);
      }
    }
    if (cache.size >= C.cacheDestinations) cache.delete(cache.keys().next().value);
    const field = { next, costs }; cache.set(key, field); return field;
  }
  waypointGraph(area, role, ladders) {
    let cache = this.waypoints.get(area.id);
    if (!cache) { cache = new Map(); this.waypoints.set(area.id, cache); }
    const key = `${role}:${ladders}`; if (cache.has(key)) return cache.get(key);
    const keys = new Set();
    for (const p of this.plan.fortress.pieces) {
      for (const point of [...(p.route ?? []), ...p.connectors]) keys.add(nodeKey(point));
      if (p.tags.includes('room')) {
        // Room crosses connect all four doorways. Details remain off these
        // lines; local endpoint attachments handle furniture and pacing.
        for (let x = p.box.x0; x <= p.box.x1; x++) keys.add(nodeKey({ x, y: p.position.y + 1, z: p.position.z }));
        for (let z = p.box.z0; z <= p.box.z1; z++) keys.add(nodeKey({ x: p.position.x, y: p.position.y + 1, z }));
        // A circulation ring links the crosses around lined shaft supports
        // or a central obstruction (especially the Mid Room's shaft).
        for (let x = p.box.x0 + 2; x <= p.box.x1 - 2; x++) for (const z of [p.box.z0 + 2, p.box.z1 - 2]) keys.add(nodeKey({ x, y: p.position.y + 1, z }));
        for (let z = p.box.z0 + 2; z <= p.box.z1 - 2; z++) for (const x of [p.box.x0 + 2, p.box.x1 - 2]) keys.add(nodeKey({ x, y: p.position.y + 1, z }));
      }
    }
    const shaft = this.plan.fortress.shaft;
    for (let y = shaft.box.y0; y <= shaft.box.y1 + 1; y++) keys.add(nodeKey({ x: shaft.position.x, y, z: shaft.position.z }));
    for (const k of [...keys]) {
      const n = this.plan.graph.get(k);
      if (n?.ladder) for (const e of n.edges) if (e.ladder) keys.add(e.to);
    }
    const graph = new Map();
    for (const k of keys) {
      const n = this.plan.graph.get(k);
      if (area.nodes.has(k) && n && this.fits(n, role)) graph.set(k, n);
    }
    cache.set(key, graph); return graph;
  }
  attach(area, point, graph, options) {
    if (graph.has(point.key)) return [point];
    const heap = new Heap(), costs = new Map([[point.key, 0]]), parent = new Map(), closed = new Set(); heap.push(0, point.key);
    while (heap.size) {
      if (!options.free && this.budget <= 0) return null;
      const k = heap.pop(); if (closed.has(k)) continue;
      closed.add(k); this.budget--;
      if (graph.has(k)) {
        const path = []; for (let n = k; n; n = parent.get(n)) path.push(this.plan.graph.get(n)); return path.reverse();
      }
      for (const e of this.plan.graph.get(k)?.edges ?? []) {
        const n = this.plan.graph.get(e.to);
        if (!n || !area.nodes.has(e.to) || !options.ladders && e.ladder || !this.fits(n, options.role)) continue;
        const cost = costs.get(k) + e.cost;
        if (cost >= (costs.get(e.to) ?? Infinity)) continue;
        costs.set(e.to, cost); parent.set(e.to, k); heap.push(cost, e.to);
      }
    }
    return [];
  }
  // Every node in a gate chain's areas, cached until any of them changes.
  chainNodes(chain) {
    this.chainCache ??= new Map();
    // Active link areas (the temporary shaft) beside the chain are walkable too.
    const links = this.regions().filter(a => a.link && a.state === 'active'
      && this.plan.gates.some(g => g.areas.includes(a.id) && g.areas.some(id => chain.includes(id))));
    const key = [...chain, ...links.map(a => a.id)].join('>'), areas = [...chain.map(id => this.area(id)), ...links];
    const signature = areas.map(a => `${a.revision ?? 0}/${a.nodes.size}`).join(',');
    const cached = this.chainCache.get(key);
    if (cached?.signature === signature) return cached.nodes;
    const nodes = new Set(areas.flatMap(a => [...a.nodes]));
    if (this.chainCache.size >= C.cacheDestinations) this.chainCache.delete(this.chainCache.keys().next().value);
    this.chainCache.set(key, { signature, nodes }); return nodes;
  }
  chain(from, to) {
    const queue = [[from]], seen = new Set([from]);
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i], id = path.at(-1); if (id === to) return path;
      for (const g of this.plan.gates.filter(g => g.areas.includes(id))) for (const n of g.areas) {
        if (seen.has(n) || this.area(n)?.state !== 'active') continue;
        seen.add(n); queue.push([...path, n]);
      }
    }
    return null;
  }
  // Searches share a per-tick node budget and return null when it runs out.
  // The first search of a tick (full budget) always runs to completion, so a
  // route longer than the budget still gets found instead of restarting forever.
  route(start, destination, home, { ladders = true, role = 'worker', unlimited = false } = {}) {
    const free = unlimited || this.budget >= C.nodeBudget;
    // A destination that is itself one of the area's nodes (a ladder rung,
    // say) is the goal; otherwise the nearest standing node.
    const exact = home?.nodes.has(nodeKey(destination)) ? this.plan.graph.get(nodeKey(destination)) : null;
    const goal = exact && this.fits(exact, role) ? exact : this.nearest(home, destination, role); if (!goal) return [];
    const origin = positionRegion(this.plan, start) ?? home;
    const first = this.nearest(origin, { x: Math.floor(start.x), y: Math.round(start.y), z: Math.floor(start.z) }, role, false);
    if (!first) return [];
    if (home.nodes.has(first.key)) {
      let start = first, end = goal, prefix = [], suffix = [];
      if (home.kind === 'underground' && !home.unfinished) {
        const graph = this.waypointGraph(home, role, ladders), options = { role, ladders, free };
        const a = this.attach(home, first, graph, options), b = this.attach(home, goal, graph, options);
        if (a === null || b === null) return null;
        if (!a.length || !b.length) return [];
        start = a.at(-1); end = b.at(-1); prefix = a.slice(1); suffix = b.reverse().slice(1);
      }
      const field = this.field(home, end, ladders, role); if (!field.costs.has(start.key)) return [];
      const path = [...prefix]; let k = start.key;
      while (k !== end.key) { k = field.next.get(k); if (!k) return []; path.push(this.plan.graph.get(k)); }
      path.push(...suffix);
      return straighten([first, ...path]).slice(1);
    }
    const chain = this.chain(origin.id, home.id); if (!chain) return [];
    const allowed = this.chainNodes(chain);
    const heap = new Heap(), costs = new Map([[first.key, 0]]), parent = new Map(); heap.push(distance(first, goal), first.key);
    const closed = new Set();
    while (heap.size) {
      if (!free && this.budget <= 0) return null;
      const k = heap.pop(); if (closed.has(k)) continue;
      closed.add(k); this.budget--;
      if (k === goal.key) {
        const path = []; for (let n = k; n !== first.key; n = parent.get(n)) path.push(this.plan.graph.get(n));
        return straighten([first, ...path.reverse()]).slice(1);
      }
      for (const e of this.plan.graph.get(k)?.edges ?? []) {
        const n = this.plan.graph.get(e.to);
        if (!n || !allowed.has(e.to) || !ladders && e.ladder || !this.fits(n, role)) continue;
        const c = costs.get(k) + e.cost;
        if (c >= (costs.get(e.to) ?? Infinity)) continue;
        costs.set(e.to, c); parent.set(e.to, k); heap.push(c + distance(n, goal), e.to);
      }
    }
    return [];
  }
}
