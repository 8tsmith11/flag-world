// Goblin construction: the village and fortress are planned at world
// generation but only the Totem Hall stands (shared/goblins/construction.js).
// This walks the build order and hands its blocks to the work order system.
//
// Build order: the initial shaft is dug from the hall to the surface; then
// areas are built outward along the area graph, each one adjacent to an
// active area (surface outward from the entrance area, underground outward
// from the hall, in parallel). Within an area: site prep, its spawn
// building, walls and gates, everything else. An area becomes active when its
// spawn building is done. Once every underground area is built, the shaft is
// relocated (lined above the Mid Room, plugged below it), then the Castle
// goes up over the shaft entrance.
import { BLOCK, getBlockDef } from '../../shared/blocks.js';
import { WORK as C, LIFE } from '../../shared/goblins/life.js';
import { makeGraph, nodeKey } from '../../shared/goblins/areas.js';
import { recomputeOutskirts } from '../../shared/goblins/outskirts.js';
import { cellKey } from '../../shared/structures/buildability.js';
import { S2C } from '../../shared/protocol.js';
import { TICK_RATE } from '../../shared/config.js';
import { straighten } from './nav.js';
import { CLEAR } from './work.js';
import { createContainer } from '../containers.js';

// access: site prep along a route from where the area is entered to its spawn
// building, and the building's own footprint; spawn: the building (the area
// goes active); prep: the rest of the site prep; walls; rest.
const PHASES = ['access', 'spawn', 'prep', 'walls', 'rest'];
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const column = key => { const [x, , z] = key.split(','); return `${x},${z}`; };
const inBox = (b, x, y, z) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;

// Navigation inside a planned area: its walkable nodes as the world stands
// (no walls yet), the entries where they touch an active neighbour, and a
// breadth-first flow from those entries. Rebuilt around edited columns only.
class Site {
  constructor(construction, area) {
    this.c = construction; this.area = area; this.dirty = new Set(); this.reachedAt = -Infinity;
    this.graph = makeGraph(construction.world, area.volumes, new Map(), construction.plan.platformCells);
  }
  changed(x, z) { this.dirty.add(cellKey(x, z)); }
  refresh() {
    if (!this.dirty.size) return;
    const around = r => {
      const out = new Set();
      for (const k of this.dirty) {
        const [x, z] = k.split(',').map(Number);
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.add(cellKey(x + dx, z + dz));
      }
      return out;
    };
    const inner = around(1), window = around(2);
    const g = makeGraph(this.c.world, this.area.volumes.filter(v => window.has(cellKey(v.x0, v.z0))), new Map(), this.c.plan.platformCells);
    for (const k of [...this.graph.keys()]) if (inner.has(column(k))) this.graph.delete(k);
    for (const [k, n] of g) {
      if (inner.has(column(k))) { this.graph.set(k, n); continue; }
      const old = this.graph.get(k);
      if (old) old.edges = [...old.edges.filter(e => !inner.has(column(e.to))), ...n.edges.filter(e => inner.has(column(e.to)))];
    }
    this.dirty.clear(); this.reachedAt = -Infinity;
  }
  // Entries and the flow from them, at most every siteRefreshTicks.
  reach() {
    this.refresh();
    const tick = this.c.game.tick;
    if (tick - this.reachedAt < C.siteRefreshTicks) return;
    this.reachedAt = tick;
    const active = this.c.neighbours(this.area).filter(a => a.state === 'active');
    const reachable = this.c.nav.reachable(s => this.c.garrison.spawnAlive(s), tick);
    this.parent = new Map(); this.entry = new Map();
    const queue = [];
    for (const [k, n] of this.graph) {
      let hit = null;
      for (const a of active) {
        if (a.nodes.has(k) && reachable.has(k)) { hit = { key: k, area: a.id }; break; }
        for (const [dx, dz] of SIDES) for (const dy of [-1, 0, 1]) {
          const other = nodeKey({ x: n.x + dx, y: n.y + dy, z: n.z + dz });
          if (a.nodes.has(other) && reachable.has(other)) { hit = { key: other, area: a.id }; break; }
        }
        if (!hit) for (const dy of [-1, 1]) {
          const other = nodeKey({ x: n.x, y: n.y + dy, z: n.z });
          if (a.nodes.has(other) && reachable.has(other)) { hit = { key: other, area: a.id }; break; }
        }
        if (hit) break;
      }
      if (hit) { this.entry.set(k, hit); this.parent.set(k, null); queue.push(k); }
    }
    for (let i = 0; i < queue.length; i++) for (const e of this.graph.get(queue[i]).edges) {
      if (this.parent.has(e.to) || !this.graph.has(e.to)) continue;
      this.parent.set(e.to, queue[i]); queue.push(e.to);
    }
    this.buckets = new Map();
    for (const k of this.parent.keys()) {
      const n = this.graph.get(k), b = `${Math.floor(n.x / 8)},${Math.floor(n.z / 8)}`;
      if (!this.buckets.has(b)) this.buckets.set(b, []);
      this.buckets.get(b).push(n);
    }
  }
  // Reachable, grounded nodes a worker fits on near a point, nearest first.
  nodesNear(point, radius) {
    this.reach();
    const nav = this.c.nav, out = [];
    for (let bz = Math.floor((point.z - radius) / 8); bz <= Math.floor((point.z + radius) / 8); bz++)
      for (let bx = Math.floor((point.x - radius) / 8); bx <= Math.floor((point.x + radius) / 8); bx++)
        for (const n of this.buckets.get(`${bx},${bz}`) ?? []) {
          const d = Math.hypot(n.x + 0.5 - point.x, n.z + 0.5 - point.z);
          if (d <= radius && n.grounded && nav.fits(n, 'worker')) out.push({ n, d });
        }
    return out.sort((a, b) => a.d - b.d).map(e => e.n);
  }
  // Waypoints to a node of this site: from inside it, a local search; from
  // outside, a normal route to the entry's active node, then the flow in.
  // Null when the route search ran out of budget; [] when unreachable.
  routeTo(unit, target) {
    this.reach();
    const here = nodeKey(unit.state);
    if (this.graph.has(here)) return this.search(here, k => k === target.key) ?? [];
    if (!this.parent.has(target.key)) return [];
    const local = [];
    for (let k = target.key; k; k = this.parent.get(k)) local.push(this.graph.get(k));
    local.reverse();
    const entry = this.entry.get(local[0].key), dest = this.c.plan.graph.get(entry.key);
    const route = this.c.nav.route(unit.state, dest, this.c.nav.area(entry.area), unit.options());
    if (route === null) return null;
    return [...route, ...straighten(local)];
  }
  // Waypoints out of the site to the nearest entry's active node, for a
  // worker going home.
  exit(unit) {
    this.reach();
    const here = nodeKey(unit.state); if (!this.graph.has(here)) return null;
    const path = this.search(here, k => this.entry.has(k)); if (!path) return null;
    const last = path.at(-1) ?? this.graph.get(here), dest = this.c.plan.graph.get(this.entry.get(nodeKey(last))?.key);
    return dest ? [...path, { x: dest.x, y: dest.y, z: dest.z, grounded: dest.grounded, ladder: dest.ladder }] : path;
  }
  search(from, goal) {
    const parent = new Map([[from, null]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      if (goal(k)) {
        const path = []; for (let p = k; p; p = parent.get(p)) path.push(this.graph.get(p));
        return straighten(path.reverse()).slice(1);
      }
      for (const e of this.graph.get(k)?.edges ?? []) if (!parent.has(e.to) && this.graph.has(e.to)) { parent.set(e.to, k); queue.push(e.to); }
    }
    return null;
  }
}

export class Construction {
  constructor(garrison) {
    this.garrison = garrison; this.game = garrison.game; this.world = garrison.game.world;
    this.plan = garrison.plan; this.nav = garrison.nav; this.work = garrison.work;
    this.data = this.plan.construction; this.sites = new Map();
    this.swing = C.buildSwingSeconds(this.plan.settings.radius);
    this.done = !this.data; if (this.done) return;
    const f = this.plan.fortress;
    this.hall = f.pieces.find(p => p.type === 'totemHall');
    this.mid = f.pieces.find(p => p.type === 'midRoom');
    this.castle = this.plan.surface.pieces.find(p => p.type === 'castle');
    this.hallArea = this.plan.areas.find(a => a.spawns.some(s => s.id === this.data.hall));
    const col = this.data.column;
    this.entranceArea = this.areaAt({ x: col.x, y: this.castle.padHeight + 1, z: col.z }, 'surface');
    this.midArea = this.areaAt({ x: col.x + 2, y: this.mid.position.y + 1, z: col.z }, 'underground');
    for (const a of this.plan.areas) { a.state = a === this.hallArea ? 'active' : 'planned'; a.unfinished = true; }
    // Access routes come from the finished plan's graph, before any area's
    // graph is rebuilt from the (mostly unbuilt) world.
    this.planEntries();
    // The hall's area is active, but its graph describes the finished
    // fortress; rebuild it from the world (only the hall stands).
    this.nav.refresh(this.hallArea, new Set(this.hallArea.columns));
    // The hall's spawn point is its center, inside the shaft's lining for
    // now: goblins appear beside it instead.
    const spawn = this.hallArea.spawns.find(s => s.id === this.data.hall);
    const beside = this.nav.nearest(this.hallArea, { x: col.x + 3, y: spawn.point.y, z: col.z + 3 });
    if (beside) spawn.point = { x: beside.x, y: beside.y, z: beside.z };
    this.hallArea.interests = this.hallArea.interests.filter(p => Math.max(Math.abs(p.x - col.x), Math.abs(p.z - col.z)) > 1);
    recomputeOutskirts(this.world, this.plan, { runtime: true });
    this.startTick = this.game.tick; this.breached = false;
    this.makeShaft();
    this.holdSlots();
  }
  areaAt(p, kind) {
    return this.plan.areas.find(a => a.kind === kind && this.nav.contains(a, p))
      ?? this.plan.areas.filter(a => a.kind === kind).sort((a, b) => this.distance(a, p) - this.distance(b, p))[0];
  }
  distance(area, p) {
    let best = Infinity;
    for (const k of area.columns) { const [x, z] = k.split(',').map(Number); best = Math.min(best, Math.hypot(x - p.x, z - p.z)); }
    return best;
  }
  // Areas sharing a gate (through link areas such as the shaft too).
  neighbours(area) {
    const gates = this.plan.gates, ids = new Set();
    const next = id => gates.filter(g => g.areas.includes(id)).flatMap(g => g.areas).filter(a => a !== id);
    for (const id of next(area.id)) {
      ids.add(id);
      if (this.nav.area(id)?.link) for (const n of next(id)) if (n !== area.id) ids.add(n);
    }
    return [...ids].map(id => this.nav.area(id)).filter(Boolean);
  }
  site(area) {
    if (area.state !== 'planned') return null;
    if (!this.sites.has(area.id)) this.sites.set(area.id, new Site(this, area));
    return this.sites.get(area.id);
  }

  // ---- The shaft ----

  // A temporary link area for the dug 1x1 shaft and its opening into the hall.
  makeShaft() {
    const col = this.data.column, volumes = [{ x0: col.x, x1: col.x, z0: col.z, z1: col.z, y0: col.y0 - 1, y1: col.y1 + 3 }];
    const openings = this.data.dig.filter(b => b.id === BLOCK.AIR);
    for (const k of new Set(openings.map(b => cellKey(b.x, b.z)))) {
      const [x, z] = k.split(',').map(Number), ys = openings.filter(b => b.x === x && b.z === z).map(b => b.y);
      volumes.push({ x0: x, x1: x, z0: z, z1: z, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1 });
    }
    this.shaft = { id: 'shaft', kind: 'underground', link: true, state: 'active', nodes: new Set(),
      columns: new Set(volumes.map(v => cellKey(v.x0, v.z0))), volumes, spawns: [], interests: [], gates: [], slots: [] };
    this.plan.areas.push(this.shaft);
    this.addGate('shaft:hall', this.hallArea, openings[0] ?? { x: col.x, y: col.y0, z: col.z });
    this.nav.refresh(this.shaft, new Set(this.shaft.columns));
    this.linkShaft();
    // The digger approaches from the hall floor beside the opening.
    const opening = openings[0] ?? { x: col.x, y: col.y0, z: col.z };
    const approach = this.nav.nearest(this.hallArea, { x: 2 * opening.x - col.x, y: opening.y, z: 2 * opening.z - col.z });
    this.digJob = this.work.addJob(this.data.dig.map(b => ({ key: this.world.cellIndex(b.x, b.y, b.z), x: b.x, y: b.y, z: b.z, want: b.id, build: true })),
      { area: this.hallArea.id, ordered: true, first: true,
        climb: { x: col.x, z: col.z, offset: -2, min: col.y0, max: col.y1, approach, approachArea: this.hallArea.id } });
  }
  addGate(id, area, cell) {
    if (this.plan.gates.some(g => g.id === id)) return;
    this.plan.gates.push({ id, kind: 'shaft', cells: [{ x: cell.x, y: cell.y, z: cell.z }], areas: ['shaft', area.id] });
    this.shaft.gates.push(id); area.gates.push(id);
  }
  // Edges between the shaft's nodes and its active neighbours' nodes, from a
  // small graph over both around the shaft.
  linkShaft() {
    if (!this.shaft || !this.plan.areas.includes(this.shaft)) return;
    const owners = [this.shaft, ...this.neighbours(this.shaft).filter(a => a.state === 'active')];
    const window = new Set();
    for (const k of this.shaft.columns) {
      const [x, z] = k.split(',').map(Number);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) window.add(cellKey(x + dx, z + dz));
    }
    const volumes = owners.flatMap(a => a.volumes.filter(v => window.has(cellKey(v.x0, v.z0))));
    const g = makeGraph(this.world, volumes, this.plan.wallCells, this.plan.platformCells);
    const owner = k => owners.find(a => a.nodes.has(k));
    for (const [k, n] of g) {
      const node = this.plan.graph.get(k), a = owner(k); if (!node || !a) continue;
      for (const e of n.edges) {
        const b = owner(e.to);
        if (!b || a === b || a !== this.shaft && b !== this.shaft || node.edges.some(x => x.to === e.to)) continue;
        node.edges.push(e);
      }
    }
    for (const a of owners) { this.nav.caches.delete(a.id); a.revision = (a.revision ?? 0) + 1; }
  }
  breach() {
    this.breached = true;
    const col = this.data.column;
    this.addGate('shaft:surface', this.entranceArea, { x: col.x, y: col.y1 + 1, z: col.z });
    this.addGate('shaft:mid', this.midArea, { x: col.x, y: this.mid.position.y + 1, z: col.z });
    this.linkShaft();
    this.game.broadcast({ type: S2C.ANNOUNCE, text: 'The goblins have breached the surface' });
    console.log(`Goblins breached the surface after ${this.minutes()} min`);
  }

  // ---- Build entries ----

  // Every target cell goes to one entry: the shaft relocation, the Castle,
  // or an area's prep / spawn / walls / rest.
  planEntries() {
    const work = this.work, col = this.data.column, hall = this.hall.box, plan = this.plan;
    const shaftCells = new Set(this.data.dig.map(b => this.world.cellIndex(b.x, b.y, b.z)));
    for (let y = hall.y0; y <= Math.max(col.y1, this.castle.padHeight) + 1; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (y <= hall.y1 && (dx || dz)) continue;
      const key = this.world.cellIndex(col.x + dx, y, col.z + dz);
      if (work.targets.has(key)) shaftCells.add(key);
    }
    this.relocation = { id: 'relocation', phase: 'relocation', cells: [...shaftCells], jobs: new Set() };
    this.castleEntry = { id: 'castle', phase: 'castle', area: this.entranceArea, cells: [], jobs: new Set() };
    const entries = new Map(plan.areas.filter(a => a !== this.shaft).map(a =>
      [a.id, PHASES.map(phase => ({ id: `${a.id}:${phase}`, phase, area: a, cells: [], jobs: new Set() }))]));
    const spawnOf = new Map(plan.areas.map(a => [a.id, this.spawnBuilding(a)]));
    const walls = plan.wallCells, gatehouses = plan.surface.gatehouses ?? [];
    this.originOf = this.origins();
    const access = this.accessCells(spawnOf);
    for (const [key, want] of work.targets) {
      if (shaftCells.has(key)) continue;
      const { x, y, z } = work.cell(key);
      // The Castle and its earthworks; the fortress below it isn't part of it.
      if (x >= this.castle.box.x0 && x <= this.castle.box.x1 && z >= this.castle.box.z0 && z <= this.castle.box.z1
        && y >= this.castle.box.y0 - C.castleDepth) {
        this.castleEntry.cells.push(key); continue;
      }
      const area = this.cellArea(key); if (!area || !entries.has(area.id)) continue;
      const spawn = spawnOf.get(area.id);
      const prep = want === CLEAR || want === BLOCK.AIR || C.terrainBlocks.includes(want);
      const inSpawn = spawn && inBox({ ...spawn.box, y0: spawn.box.y0 - 1, y1: spawn.box.y1 + 1 }, x, y, z);
      const phase = prep && (inSpawn || access.has(key)) ? 'access' : inSpawn ? 'spawn' : prep ? 'prep'
        : walls.has(cellKey(x, z)) || gatehouses.some(h => inBox(h.box, x, y, z)) ? 'walls' : 'rest';
      entries.get(area.id)[PHASES.indexOf(phase)].cells.push(key);
    }
    this.entries = entries;
    for (const list of entries.values()) for (const e of list) for (const k of e.cells) work.reserved.add(k);
    for (const k of [...this.relocation.cells, ...this.castleEntry.cells]) work.reserved.add(k);
  }
  // Where each area is entered: breadth-first from the hall over the area
  // graph (the shaft reaches the entrance area and the Mid Room's area), the
  // cell of the gate to its parent.
  origins() {
    const col = this.data.column, out = new Map([[this.hallArea.id, this.hall.position]]);
    const queue = [this.hallArea];
    for (const [area, y] of [[this.entranceArea, Math.max(col.y1 + 1, this.castle.padHeight + 1)], [this.midArea, this.mid.position.y + 1]]) {
      if (area && !out.has(area.id)) { out.set(area.id, { x: col.x, y, z: col.z }); queue.push(area); }
    }
    for (let i = 0; i < queue.length; i++) for (const g of this.plan.gates.filter(g => g.areas.includes(queue[i].id) && !g.outskirts)) {
      const next = this.plan.areas.find(a => g.areas.includes(a.id) && a !== queue[i]);
      if (!next || out.has(next.id)) continue;
      out.set(next.id, g.cells[0]); queue.push(next);
    }
    return out;
  }
  // Floor, feet and head cells along a shortest walk (breadth-first over
  // the finished plan's graph, within the area) from each area's origin to
  // its spawn building.
  accessCells(spawnOf) {
    const cells = new Set(), work = this.work, graph = this.plan.graph;
    for (const area of this.plan.areas) {
      const spawn = spawnOf.get(area.id), origin = this.originOf.get(area.id);
      if (!spawn || !origin) continue;
      const from = this.nav.nearest(area, origin, 'worker', false), to = nodeKey(spawn.point);
      if (!from) continue;
      const parent = new Map([[from.key, null]]), queue = [from.key];
      for (let i = 0; i < queue.length && !parent.has(to); i++) for (const e of graph.get(queue[i])?.edges ?? []) {
        if (parent.has(e.to) || !area.nodes.has(e.to) || !graph.has(e.to)) continue;
        parent.set(e.to, queue[i]); queue.push(e.to);
      }
      if (!parent.has(to)) continue;
      for (let k = to; k; k = parent.get(k)) {
        const n = graph.get(k);
        for (const dy of [-1, 0, 1]) { const c = work.key(n.x, n.y + dy, n.z); if (work.targets.has(c)) cells.add(c); }
      }
    }
    return cells;
  }
  // The area a cell's section belongs to, else the nearest area.
  cellArea(key) {
    const work = this.work, p = work.cell(key), section = work.sections.get(work.sectionKey(p.x, p.y, p.z));
    if (section?.area) return this.nav.area(section.area);
    this.nearestCache ??= new Map();
    const sk = section?.key ?? key;
    if (!this.nearestCache.has(sk)) {
      const kind = p.y < this.castle.padHeight - 4 ? 'underground' : 'surface';
      this.nearestCache.set(sk, this.plan.areas.filter(a => a.kind === kind && a !== this.shaft)
        .sort((a, b) => this.distance(a, p) - this.distance(b, p))[0] ?? null);
    }
    return this.nearestCache.get(sk);
  }
  // An area's spawn building: a spawn site other than the Castle and the
  // Totem Hall, nearest the hall.
  spawnBuilding(area) {
    const hall = this.hall.position;
    return area.spawns.filter(s => s.id !== this.castle.id && s.id !== this.data.hall)
      .sort((a, b) => Math.hypot(a.point.x - hall.x, a.point.z - hall.z) - Math.hypot(b.point.x - hall.x, b.point.z - hall.z))[0] ?? null;
  }
  // Only the starting group, the King and the Totem spawn in the hall at first.
  holdSlots() {
    const left = { ...LIFE.startGroup };
    for (const slot of this.hallArea.slots) {
      if (slot.unique) continue;
      if ((left[slot.role] ?? 0) > 0) { left[slot.role]--; continue; }
      slot.held = true;
    }
  }
  current(area) { return this.entries.get(area.id)?.find(e => !e.done) ?? null; }
  areaDone(area) { return this.entries.get(area.id)?.every(e => e.done) ?? true; }
  available(area) { return area.state === 'active' || this.neighbours(area).some(a => a.state === 'active'); }

  // Starting an entry queues its cells; jobs are made a few at a time.
  // Site prep first skips pieces whose site would need too much earthwork.
  start(e) {
    e.started = true; e.lastProgress = this.game.tick;
    if (e.phase === 'prep') this.skipPieces(e.area);
    const removal = k => { const w = this.work.targets.get(k); return w === BLOCK.AIR || w === CLEAR ? 1 : 0; };
    // Cutting and digging spread outward from where the area is entered;
    // fills and building go bottom-up after.
    const origin = this.origin(e.area), at = new Map(e.cells.map(k => [k, this.work.cell(k)]));
    const far = k => { const p = at.get(k); return Math.hypot(p.x - origin.x, p.z - origin.z) + Math.abs(p.y - origin.y); };
    e.queue = e.cells.filter(k => this.work.targets.has(k))
      .sort((a, b) => (removal(b) - removal(a)) || (removal(a) ? far(a) - far(b) : at.get(a).y - at.get(b).y));
    e.queued = new Set(e.queue); e.pos = 0; e.deferred = new Set(); e.requeueAt = 0;
  }
  // More jobs for an entry while it has fewer than openJobs open: connected
  // clusters grown from the next queued cell through other queued cells.
  feed(e) {
    const work = this.work, sites = [e.area.id, ...this.neighbours(e.area).filter(a => a.state === 'active').map(a => a.id)];
    const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    // Cells nobody could reach go back in the queue every waitRetrySeconds.
    if (e.deferred.size && this.game.tick >= e.requeueAt) {
      e.queue = [...e.queue.slice(e.pos).filter(k => e.queued.has(k)), ...e.deferred];
      e.queued = new Set(e.queue); e.pos = 0; e.deferred.clear();
    }
    const defer = b => { e.deferred.add(b.key); e.requeueAt = this.game.tick + C.waitRetrySeconds * TICK_RATE; };
    while (e.jobs.size < C.openJobs) {
      while (e.pos < e.queue.length && !e.queued.has(e.queue[e.pos])) e.pos++;
      if (e.pos >= e.queue.length) break;
      const seed = e.queue[e.pos]; e.queued.delete(seed);
      const first = work.claimed.has(seed) ? null : work.difference(seed, true);
      if (!first) continue;
      const cluster = [first];
      for (let i = 0; i < cluster.length && cluster.length < C.maxJobBlocks * 4; i++) for (const [dx, dy, dz] of sides) {
        const k = work.key(cluster[i].x + dx, cluster[i].y + dy, cluster[i].z + dz);
        if (!e.queued.has(k)) continue;
        e.queued.delete(k);
        const b = work.claimed.has(k) ? null : work.difference(k, true);
        if (b) cluster.push(b);
      }
      work.addClusters(cluster, sites, { entry: e }, defer);
    }
  }
  // Where building in an area starts (see origins()).
  origin(area) {
    if (this.originOf?.has(area.id)) return this.originOf.get(area.id);
    const col = this.data.column;
    if (area === this.hallArea) return this.hall.position;
    if (area === this.entranceArea) return { x: col.x, y: col.y1 + 1, z: col.z };
    if (area === this.midArea) return { x: col.x, y: this.mid.position.y + 1, z: col.z };
    const active = new Set(this.neighbours(area).filter(a => a.state === 'active').map(a => a.id));
    const gate = this.plan.gates.find(g => g.areas.includes(area.id) && g.areas.some(id => active.has(id)));
    return gate?.cells[0] ?? this.hall.position;
  }
  // Finished: nothing queued and no jobs left; or every remaining job has
  // waited stallSeconds with no progress (those are dropped).
  finished(e) {
    for (const job of e.jobs) if (!this.work.jobs.has(job)) e.jobs.delete(job);
    if (e.queue && e.pos < e.queue.length) return false;
    const stuck = [...e.jobs].every(j => j.waiting);
    if (!e.jobs.size && !e.deferred?.size) return true;
    // Only when the whole build has stalled: nothing placed anywhere.
    if (stuck && this.game.tick - Math.max(e.lastProgress, this.lastProgress ?? 0) > C.stallSeconds * TICK_RATE) {
      for (const job of e.jobs) this.work.drop(job);
      console.warn(`Goblin construction: ${e.id} finished without ${e.jobs.size + (e.deferred?.size ?? 0)} unreachable block(s)`);
      e.jobs.clear(); e.deferred?.clear(); return true;
    }
    return false;
  }
  finish(e) {
    e.done = true;
    for (const k of e.cells) this.work.reserved.delete(k);
    if (e.phase === 'spawn') this.activate(e.area);
    if (e.area && this.areaDone(e.area)) { e.area.unfinished = false; this.nav.caches.delete(e.area.id); }
  }
  progressed(job) { this.lastProgress = this.game.tick; if (job.entry) job.entry.lastProgress = this.game.tick; }

  // ---- Skipping pieces ----

  // A piece whose footprint needs more than maxRestore cut/fill (a player dug
  // or piled into it) is skipped with its jigsaw children; the doorway its
  // parent had for it is closed with the parent's main block.
  skipPieces(area) {
    const work = this.work, list = this.entries.get(area.id), prep = new Set(list[0].cells);
    for (const part of [this.plan.surface, this.plan.fortress]) for (const piece of part.pieces) {
      if (piece.skipped || piece === this.castle || piece === this.hall || piece.type === 'path') continue;
      const keys = [...(piece.earthworks ?? []), ...piece.blocks].map(b => work.key(b.x, b.y, b.z));
      if (!keys.some(k => prep.has(k))) continue;
      const moves = keys.filter(k => prep.has(k) && work.difference(k, true)).length;
      if (moves <= C.maxRestore) continue;
      const skipped = [piece], links = part.links ?? [];
      for (let i = 0; i < skipped.length; i++) for (const l of links.filter(l => l.from === skipped[i].id)) {
        const child = part.pieces.find(p => p.id === l.to);
        if (child && !skipped.includes(child)) skipped.push(child);
      }
      for (const p of skipped) this.skip(p, part);
      for (const l of links.filter(l => l.to === piece.id)) this.fallback(part.pieces.find(p => p.id === l.from), l.a);
    }
  }
  skip(piece, part) {
    piece.skipped = true;
    const work = this.work, cells = new Set([...(piece.earthworks ?? []), ...piece.blocks].map(b => work.key(b.x, b.y, b.z)));
    for (const k of cells) { work.targets.delete(k); work.reserved.delete(k); }
    for (const list of this.entries.values()) for (const e of list) {
      e.cells = e.cells.filter(k => !cells.has(k));
      for (const k of cells) e.queued?.delete(k);
    }
    console.log(`Goblin construction: skipped ${piece.id} (${part === this.plan.surface ? 'surface' : 'fortress'})`);
  }
  fallback(parent, connector) {
    if (!parent || parent.skipped) return;
    const counts = new Map();
    for (const b of parent.blocks) if (b.id !== BLOCK.AIR) counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
    const wall = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? BLOCK.GOBLIN_BRICKS;
    for (let y = connector.y; y < connector.y + this.plan.settings.passageHeight; y++) {
      const k = this.work.key(connector.x, y, connector.z);
      if (this.work.targets.get(k) === BLOCK.AIR) this.work.targets.set(k, wall);
    }
  }

  // ---- Areas coming alive ----

  activate(area) {
    if (area.state !== 'active') {
      area.state = 'active';
      this.sites.delete(area.id);
      this.nav.dirty.set(area.id, new Set(area.columns));
      this.relink = true;
      console.log(`Goblin construction: ${area.id} active after ${this.minutes()} min`);
    }
    if (area === this.hallArea) for (const slot of area.slots) slot.held = false;
    if (area.kind === 'surface') {
      this.plan.outerBuilt = this.plan.areas.every(a => a.kind !== 'surface' || a.state === 'active');
      recomputeOutskirts(this.world, this.plan, { runtime: true });
    }
  }
  minutes() { return ((this.game.tick - this.startTick) / TICK_RATE / 60).toFixed(1); }

  // ---- Per tick ----

  update() {
    if (this.done) return;
    if (this.relink) { this.relink = false; this.linkShaft(); }
    if (!this.breached && !this.work.jobs.has(this.digJob)) this.breach();
    if (!this.breached) return;
    for (const list of this.entries.values()) {
      const e = list.find(e => !e.done); if (!e) continue;
      if (!e.started) { if (!this.available(e.area)) continue; this.start(e); }
      this.feed(e);
      if (this.finished(e)) this.finish(e);
    }
    const underground = this.plan.areas.filter(a => a.kind === 'underground' && a !== this.shaft);
    const r = this.relocation;
    if (!r.done && !r.started && underground.every(a => this.areaDone(a)) && this.entranceArea.state === 'active' && this.midArea.state === 'active') this.startRelocation();
    if (r.started && !r.done && !this.work.jobs.has(r.job)) this.relocated();
    const c = this.castleEntry, surface = this.plan.areas.filter(a => a.kind === 'surface');
    if (!c.done && r.done && surface.every(a => this.areaDone(a))) {
      if (!c.started) this.start(c);
      this.feed(c);
      if (this.finished(c)) { this.finish(c); this.complete(); }
    }
  }
  // One worker lines the shaft above the Mid Room and plugs it below,
  // bottom-up, standing on the ladder two blocks above its work.
  startRelocation() {
    const r = this.relocation, work = this.work, col = this.data.column;
    r.started = true;
    const blocks = r.cells.map(k => work.difference(k, true)).filter(Boolean)
      .sort((a, b) => a.y - b.y || (a.x === col.x && a.z === col.z) - (b.x === col.x && b.z === col.z));
    const approach = this.nav.nearest(this.midArea, { x: col.x + 1, y: this.mid.position.y + 1, z: col.z });
    r.job = work.addJob(blocks, { area: this.midArea.id, ordered: true, first: true, entry: r,
      climb: { x: col.x, z: col.z, offset: 2, min: this.data.column.y0, max: col.y1, approach, approachArea: this.midArea.id } });
    console.log(`Goblin construction: relocation started after ${this.minutes()} min`);
  }
  relocated() {
    this.relocation.done = true;
    for (const k of this.relocation.cells) this.work.reserved.delete(k);
    this.removeShaft();
    console.log(`Goblin construction: shaft relocated after ${this.minutes()} min`);
  }
  removeShaft() {
    const shaft = this.shaft; if (!this.plan.areas.includes(shaft)) return;
    this.plan.areas.splice(this.plan.areas.indexOf(shaft), 1);
    const ids = new Set(shaft.gates);
    this.plan.gates = this.plan.gates.filter(g => !ids.has(g.id));
    for (const a of this.plan.areas) a.gates = a.gates.filter(id => !ids.has(id));
    for (const k of shaft.nodes) if (!this.plan.areas.some(a => a.nodes.has(k))) this.plan.graph.delete(k);
    for (const a of this.plan.areas) { this.nav.caches.delete(a.id); this.nav.waypoints.delete(a.id); }
  }
  complete() {
    this.done = true;
    console.log(`Goblin construction: fortress complete after ${this.minutes()} min`);
    this.game.broadcast({ type: S2C.ANNOUNCE, text: 'The goblin fortress is complete' });
  }

  // A block changed: construction sites around it rebuild their navigation.
  changed(x, y, z) {
    if (this.done) return;
    const p = { x, y, z };
    for (const site of this.sites.values()) if (this.nav.contains(site.area, p)) site.changed(x, z);
    if (this.shaft && this.nav.contains(this.shaft, p)) this.relink = true;
  }

  // ---- Creative: Max goblin fortress ----

  // Places every remaining target block at once and brings every area to life.
  completeAll() {
    if (this.done) return;
    const work = this.work, world = this.world;
    this.garrison.bulk = true;
    try {
      for (const job of [...work.jobs]) if (job.entry || job.climb) work.drop(job);
      for (const [key, want] of work.targets) {
        const b = work.difference(key, true); if (!b) continue;
        const id = want === CLEAR ? BLOCK.AIR : want;
        world.setBlock(b.x, b.y, b.z, id);
        const kind = id !== BLOCK.AIR && getBlockDef(id).tileEntity;
        if (kind && !world.tileEntities.has(`${b.x},${b.y},${b.z}`)) {
          const container = createContainer(kind);
          if (container) world.tileEntities.set(`${b.x},${b.y},${b.z}`, container);
        }
      }
    } finally { this.garrison.bulk = false; }
    for (const list of this.entries.values()) for (const e of list) e.done = true;
    this.relocation.done = this.castleEntry.done = true;
    work.reserved.clear();
    this.removeShaft();
    if (!this.breached) {
      this.breached = true;
      this.game.broadcast({ type: S2C.ANNOUNCE, text: 'The goblins have breached the surface' });
    }
    this.sites.clear();
    for (const a of this.plan.areas) {
      a.state = 'active'; a.unfinished = false;
      this.nav.dirty.set(a.id, new Set(a.columns));
      for (const slot of a.slots) slot.held = false;
    }
    this.plan.outerBuilt = true;
    recomputeOutskirts(world, this.plan, { runtime: true });
    this.complete();
  }
}
