// Work orders: every block job goblins do (repairs now, construction later).
//
// Each cell of a plan footprint has a target block id. Repairs take the
// village and fortress as generated (the world at match start) as their
// target; construction can later write targets for planned areas. Footprints
// are split into sections. Block changes mark sections dirty; workers inspect
// sections, compare them with their targets and turn the differences into
// jobs: connected clusters, split in space until each fits maxJobBlocks and
// has one standing spot within reach of all its blocks. One worker per job.
import { BLOCK, getBlockDef, isSolid, isDoor, doorState, isFlowingWater, isLava } from '../../shared/blocks.js';
import { WORK as C } from '../../shared/goblins/life.js';
import { cellKey } from '../../shared/structures/buildability.js';
import { turretType } from '../../shared/turrets.js';
import { TICK_RATE } from '../../shared/config.js';

const ticks = seconds => Math.round(seconds * TICK_RATE);
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const center = b => ({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });

// Plants and configured natural blocks are never part of a plan; flowing
// liquids settle on their own.
const ignored = id => getBlockDef(id).shape === 'plant' || C.ignoredBlocks.includes(id)
  || isFlowingWater(id) || isLava(id) && id !== BLOCK.LAVA;
// Removing these would lose state (containers, turrets).
const protectedBlock = id => C.protectedBlocks.includes(id) || !!getBlockDef(id).tileEntity || !!turretType(id);
// A door's open/closed state is a player choice, not damage.
const same = (a, b) => a === b || isDoor(a) && isDoor(b)
  && ['facing', 'upper', 'reinforced'].every(k => doorState(a)[k] === doorState(b)[k]);

export class WorkOrders {
  constructor(garrison) {
    this.garrison = garrison; this.game = garrison.game; this.world = garrison.game.world;
    this.targets = new Map();       // cell key -> target block id
    this.sections = new Map();      // section key -> { key, cells, area, dirty, center }
    this.byArea = new Map();        // area id -> sections
    this.dirty = new Map();         // area id -> Set of dirty sections
    this.jobs = new Set();
    this.claimed = new Map();       // cell key -> job (every job's target cells)
    this.nextInspect = new Map();   // area id -> tick
    this.applying = null;           // cell key a worker is changing right now
    this.nextJobId = 1;
    this.capture();
  }
  key(x, y, z) { const w = this.world; return x + w.sizeX * (z + w.sizeZ * (y - w.minY)); }
  cell(key) {
    const w = this.world, x = key % w.sizeX, rest = (key - x) / w.sizeX, z = rest % w.sizeZ;
    return { x, y: (rest - z) / w.sizeZ + w.minY, z };
  }
  sectionKey(x, y, z) { const s = C.sectionSize; return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`; }

  // Footprints: every block the village and fortress plans wrote, plus each
  // piece's box. Their contents at match start are the repair targets.
  capture() {
    const plan = this.garrison.plan, w = this.world, cells = new Set();
    const add = (x, y, z) => { if (w.inBounds(x, y, z)) cells.add(this.key(x, y, z)); };
    const box = b => { for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) add(x, y, z); };
    for (const part of [plan.surface, plan.fortress]) {
      for (const p of part.pieces) {
        for (const b of [...(p.earthworks ?? []), ...p.blocks]) add(b.x, b.y, b.z);
        if (p.type !== 'path') box(p.box);
      }
      for (const b of part.finishing ?? []) add(b.x, b.y, b.z);
    }
    for (const house of plan.surface.gatehouses ?? []) box(house.box);
    if (plan.fortress.shaft) box(plan.fortress.shaft.box);
    for (const key of cells) {
      const { x, y, z } = this.cell(key), id = w.getBlock(x, y, z), sk = this.sectionKey(x, y, z);
      this.targets.set(key, ignored(id) ? BLOCK.AIR : id);
      let section = this.sections.get(sk);
      if (!section) this.sections.set(sk, section = { key: sk, cells: [], area: null, dirty: false });
      section.cells.push(key);
    }
    // Each section belongs to the area most of its cells lie in.
    const columns = new Map();
    for (const a of this.garrison.nav.regions()) for (const k of a.columns ?? []) {
      if (!columns.has(k)) columns.set(k, []);
      columns.get(k).push(a);
    }
    for (const section of this.sections.values()) {
      const votes = new Map(); let sx = 0, sy = 0, sz = 0;
      for (const key of section.cells) {
        const p = this.cell(key); sx += p.x; sy += p.y; sz += p.z;
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const owner = (columns.get(cellKey(p.x + dx, p.z + dz)) ?? []).find(a => this.garrison.nav.contains(a, { ...p, x: p.x + dx, z: p.z + dz }));
          if (owner) { votes.set(owner.id, (votes.get(owner.id) ?? 0) + 1); break; }
        }
      }
      const n = section.cells.length;
      section.center = { x: sx / n + 0.5, y: sy / n, z: sz / n + 0.5 };
      section.area = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!section.area) continue;
      if (!this.byArea.has(section.area)) this.byArea.set(section.area, []);
      this.byArea.get(section.area).push(section);
    }
  }

  // The block a worker would set at a cell, or null when it matches.
  difference(key) {
    const want = this.targets.get(key); if (want === undefined) return null;
    const p = this.cell(key), have = this.world.getBlock(p.x, p.y, p.z);
    if (same(have, want) || ignored(want) || getBlockDef(want).tileEntity) return null;
    if (ignored(have) && !isSolid(want)) return null;
    if (protectedBlock(have)) return null;
    return { key, ...p, want };
  }

  // A block changed (from World.onBlockChanged): its section needs inspecting,
  // and waiting jobs in that area may now have a standing spot.
  changed(x, y, z) {
    // A worker's own write needs no inspection; side effects (a ladder that
    // fell with the block behind it) still do.
    if (this.applying === this.key(x, y, z)) return;
    const section = this.sections.get(this.sectionKey(x, y, z));
    if (section && this.targets.has(this.key(x, y, z)) && section.area) {
      if (!this.dirty.has(section.area)) this.dirty.set(section.area, new Set());
      this.dirty.get(section.area).add(section); section.dirty = true;
    }
    const area = section?.area;
    for (const job of this.jobs) if (job.waiting && (!area || job.area === area)) job.retry = true;
  }

  // ---- Jobs ----

  // Areas a worker may work in: its own, and planned areas directly adjacent.
  areasFor(unit) {
    const plan = this.garrison.plan, nav = this.garrison.nav, home = unit.home;
    const planned = plan.gates.filter(g => g.areas.includes(home)).flatMap(g => g.areas)
      .filter(id => id !== home && nav.area(id)?.state === 'planned');
    return [home, ...new Set(planned)];
  }
  // A standing spot from which every block is within reach: the nearest
  // supported walkable node, never inside any job's target cells.
  spotFor(blocks, areaIds) {
    const nav = this.garrison.nav, own = new Set(blocks.map(b => b.key));
    let cx = 0, cy = 0, cz = 0;
    for (const b of blocks) { cx += b.x + 0.5; cy += b.y + 0.5; cz += b.z + 0.5; }
    const mid = { x: cx / blocks.length, y: cy / blocks.length, z: cz / blocks.length };
    for (const id of areaIds) {
      for (const n of nav.nodesNear(nav.area(id), mid, C.reach + 1, 'worker')) {
        const feet = this.key(n.x, n.y, n.z), head = this.key(n.x, n.y + 1, n.z);
        if (own.has(feet) || own.has(head) || this.claimed.has(feet) || this.claimed.has(head)) continue;
        const body = { x: n.x + 0.5, y: n.y + 0.6, z: n.z + 0.5 };
        if (blocks.every(b => Math.hypot(b.x + 0.5 - body.x, b.y + 0.5 - body.y, b.z + 0.5 - body.z) <= C.reach)) return { spot: n, area: id };
      }
    }
    return null;
  }
  // Halves along the longest axis of the blocks' bounding box.
  split(blocks) {
    const axis = ['x', 'y', 'z'].map(a => [a, Math.max(...blocks.map(b => b[a])) - Math.min(...blocks.map(b => b[a]))])
      .sort((a, b) => b[1] - a[1])[0][0];
    const sorted = [...blocks].sort((a, b) => a[axis] - b[axis]), half = sorted.length >> 1;
    return [sorted.slice(0, half), sorted.slice(half)];
  }
  // Pieces of at most maxJobBlocks, each with a standing spot when possible;
  // a single block with no spot becomes a waiting job.
  addJobs(blocks, areaIds) {
    if (blocks.length > C.maxJobBlocks) { for (const half of this.split(blocks)) this.addJobs(half, areaIds); return; }
    const found = this.spotFor(blocks, areaIds);
    if (!found && blocks.length > 1) { for (const half of this.split(blocks)) this.addJobs(half, areaIds); return; }
    const job = { id: this.nextJobId++, blocks, spot: found?.spot ?? null, area: found?.area ?? areaIds[0],
      waiting: !found, retry: false, worker: null };
    this.jobs.add(job);
    for (const b of blocks) this.claimed.set(b.key, job);
  }
  // A worker compared a section with its targets: differing blocks become
  // connected clusters, then jobs.
  inspect(section, unit) {
    section.dirty = false; this.dirty.get(section.area)?.delete(section);
    const diffs = new Map();
    for (const key of section.cells) {
      if (this.claimed.has(key)) continue;
      const d = this.difference(key); if (d) diffs.set(key, d);
    }
    const areaIds = this.areasFor(unit);
    while (diffs.size) {
      const first = diffs.values().next().value, cluster = [first], queue = [first]; diffs.delete(first.key);
      for (let i = 0; i < queue.length; i++) for (const [dx, dy, dz] of SIDES) {
        const k = this.key(queue[i].x + dx, queue[i].y + dy, queue[i].z + dz), d = diffs.get(k);
        if (!d) continue;
        diffs.delete(k); cluster.push(d); queue.push(d);
      }
      this.addJobs(cluster, areaIds);
    }
  }
  drop(job) {
    this.jobs.delete(job);
    for (const b of job.blocks) if (this.claimed.get(b.key) === job) this.claimed.delete(b.key);
    if (job.worker?.task?.job === job) job.worker.task = null;
  }
  release(unit) {
    for (const job of this.jobs) if (job.worker === unit) job.worker = null;
  }
  // Order: rebuilding a lost spawn building first, then jobs touching
  // existing structure, then the rest; nearest first within each.
  rank(job) {
    const area = this.garrison.nav.area(job.area);
    const lost = (area?.spawns ?? []).filter(s => s.box && !this.garrison.spawnAlive(s));
    if (job.blocks.some(b => lost.some(s => b.x >= s.box.x0 && b.x <= s.box.x1 && b.z >= s.box.z0 && b.z <= s.box.z1
      && b.y >= s.box.y0 && b.y <= s.box.y1))) return 0;
    const pending = job.blocks.filter(b => this.difference(b.key));
    if (!pending.length) return 1;
    const touches = pending.some(b => !isSolid(b.want) || SIDES.some(([dx, dy, dz]) => {
      const k = this.key(b.x + dx, b.y + dy, b.z + dz);
      return isSolid(this.world.getBlock(b.x + dx, b.y + dy, b.z + dz)) && !job.blocks.some(o => o.key === k);
    }));
    return touches ? 1 : 2;
  }
  // The next job for an idle worker, or an inspection when its area's timer
  // is due. Nothing while an enemy is inside the area.
  nextTask(unit, tick) {
    const areas = this.areasFor(unit), occupied = this.garrison.occupied;
    for (const job of this.jobs) if (job.waiting && job.retry) {
      job.retry = false;
      const found = this.spotFor(job.blocks, areas.includes(job.area) ? areas : [job.area]);
      if (found) Object.assign(job, { spot: found.spot, area: found.area, waiting: false });
    }
    let best = null, bestScore = Infinity;
    for (const job of this.jobs) {
      if (job.worker || job.waiting || !areas.includes(job.area) || occupied.has(job.area)) continue;
      const score = this.rank(job) * 1e6 + Math.hypot(job.spot.x - unit.state.x, job.spot.z - unit.state.z);
      if (score < bestScore) { best = job; bestScore = score; }
    }
    if (best) { best.worker = unit; return { kind: 'job', job: best }; }
    const home = unit.home;
    if (occupied.has(home) || tick < (this.nextInspect.get(home) ?? 0)) return null;
    const sections = this.byArea.get(home); if (!sections?.length) return null;
    this.nextInspect.set(home, tick + ticks(C.inspectSeconds));
    const dirty = this.dirty.get(home);
    const section = dirty?.size ? dirty.values().next().value : sections[Math.floor(Math.random() * sections.length)];
    return { kind: 'inspect', section };
  }
  // The job's next block: removals top-down, then placements bottom-up.
  // Null when the job is done; 'blocked' when someone stands in every
  // remaining placement.
  nextBlock(job) {
    const pending = job.blocks.map(b => this.difference(b.key) && b).filter(Boolean);
    if (!pending.length) return null;
    const removals = pending.filter(b => !isSolid(b.want)).sort((a, b) => b.y - a.y);
    if (removals.length) return removals[0];
    const free = pending.filter(b => !this.occupied(b)).sort((a, b) => a.y - b.y);
    return free[0] ?? 'blocked';
  }
  occupied(b) {
    if (this.game.playerIn(b.x, b.y, b.z)) return true;
    for (const m of this.game.mobs.values()) {
      const s = m.state, w = s.box?.halfW ?? 0.3, h = s.box?.height ?? 1.8;
      if (s.x + w > b.x && s.x - w < b.x + 1 && s.z + w > b.z && s.z - w < b.z + 1 && s.y < b.y + 1 && s.y + h > b.y) return true;
    }
    return false;
  }
  // One swing's work: remove the wrong block (as if broken, so its item
  // drops), then place the target block.
  apply(b) {
    const have = this.world.getBlock(b.x, b.y, b.z);
    this.applying = b.key;
    try {
      if (have !== BLOCK.AIR && !ignored(have)) this.game.breakBlock(b.x, b.y, b.z);
      else if (ignored(have)) this.world.setBlock(b.x, b.y, b.z, BLOCK.AIR);
      if (b.want !== BLOCK.AIR) this.world.setBlock(b.x, b.y, b.z, b.want);
    } finally { this.applying = null; }
  }
}
