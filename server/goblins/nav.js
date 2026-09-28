import { Heap } from '../pathfind.js';
import { makeGraph, nodeKey, insideBox, positionRegion } from '../../shared/goblins/areas.js';
import { LIFE as C, boxOf } from '../../shared/goblins/life.js';
import { playerFitsAt } from '../../shared/physics.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y);
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
    this.waypoints = new Map(); this.dirty = new Set();
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
    for (const id of this.dirty) {
      const area = this.area(id); if (area) this.refresh(area);
    }
    this.dirty.clear();
  }
  regions() { return [...this.plan.areas, ...this.plan.outskirts, ...(this.plan.creativeAreas ?? [])]; }
  area(id) { return this.regions().find(a => a.id === id); }
  contains(area, p) { return area?.volumes.some(v => insideBox(v, p)); }
  changed(x, y, z) {
    const p = { x, y, z };
    for (const a of this.regions()) {
      if (!this.contains(a, p)) continue;
      this.caches.delete(a.id); this.waypoints.delete(a.id);
      a.revision = (a.revision ?? 0) + 1;
      this.dirty.add(a.id);
    }
  }
  refresh(a) {
    // Coalesce edits until the next physics tick. Only this region and its
    // doorway cells refresh; edits outside all volumes invalidate nothing.
    const graph = makeGraph(this.world, a.volumes, this.plan.wallCells, this.plan.platformCells);
    this.reportLadders(graph.ladderProblems);
    for (const k of a.nodes) {
      const old = this.plan.graph.get(k), n = graph.get(k);
      if (!n) { this.plan.graph.delete(k); continue; }
      for (const e of old?.edges ?? []) if (!a.nodes.has(e.to) && this.plan.graph.has(e.to)) n.edges.push(e);
      this.plan.graph.set(k, n);
    }
    for (const [k, n] of graph) if (!this.plan.graph.has(k)) { this.plan.graph.set(k, n); a.nodes.add(k); }
  }
  fits(n, role) {
    return playerFitsAt(this.world, { x: n.x + 0.5, y: n.y, z: n.z + 0.5, box: boxOf(role) }, n.y);
  }
  nearest(area, point, role = 'worker', standing = true) {
    let best = null, d = Infinity;
    for (const k of area?.nodes ?? []) {
      const n = this.plan.graph.get(k); if (!n || standing && !n.grounded || !this.fits(n, role)) continue;
      const score = distance(n, point);
      if (score < d) { best = n; d = score; }
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
    const waypointGraph = area.kind === 'underground' ? this.waypointGraph(area, role, ladders) : null;
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
      if (!options.unlimited && this.budget <= 0) return null;
      const k = heap.pop(); if (closed.has(k)) continue;
      closed.add(k); if (!options.unlimited) this.budget--;
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
  route(start, destination, home, { ladders = true, role = 'worker', unlimited = false } = {}) {
    const goal = this.nearest(home, destination, role); if (!goal) return [];
    const origin = positionRegion(this.plan, start) ?? home;
    const first = this.nearest(origin, { x: Math.floor(start.x), y: Math.round(start.y), z: Math.floor(start.z) }, role, false);
    if (!first) return [];
    if (home.nodes.has(first.key)) {
      let start = first, end = goal, prefix = [], suffix = [];
      if (home.kind === 'underground') {
        const graph = this.waypointGraph(home, role, ladders), options = { role, ladders, unlimited };
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
    const allowed = new Set(chain.flatMap(id => [...this.area(id).nodes]));
    const heap = new Heap(), costs = new Map([[first.key, 0]]), parent = new Map(); heap.push(distance(first, goal), first.key);
    const closed = new Set();
    while (heap.size) {
      if (!unlimited && this.budget <= 0) return null;
      const k = heap.pop(); if (closed.has(k)) continue;
      closed.add(k); if (!unlimited) this.budget--;
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
