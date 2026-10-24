// Work orders: every block job goblins do, repairs and construction alike.
//
// Each cell of a plan footprint has a target block id: the village and
// fortress as generated (plan.construction.targets, kept when worldgen unbuilt
// them), or the world at match start when there is no construction plan.
// Footprints are split into sections. Block changes mark sections dirty;
// workers inspect sections of active areas and turn differences into jobs.
// Construction (construction.js) turns its build entries into jobs the same
// way. Jobs are connected clusters, split in space until each fits
// maxJobBlocks and has one standing spot within reach of all its blocks.
// One worker per job.
import { BLOCK, getBlockDef, isSolid, isDoor, doorState, isFlowingWater, isLava, isTreeSupport } from '../../shared/blocks.js';
import { WORK as C } from '../../shared/goblins/life.js';
import { cellKey } from '../../shared/structures/buildability.js';
import { turretType } from '../../shared/turrets.js';
import { TICK_RATE } from '../../shared/config.js';
import { createContainer } from '../containers.js';

const ticks = seconds => Math.round(seconds * TICK_RATE);
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// A target meaning "remove trees and plants, leave everything else" (the
// cleared band outside the outer wall). Block ids are bytes, so it can't clash.
export const CLEAR = -1;

const plant = id => getBlockDef(id).shape === 'plant' || id === BLOCK.SAPLING;
// Plants and configured natural blocks are never part of a plan; flowing
// liquids settle on their own.
const ignored = id => plant(id) || C.ignoredBlocks.includes(id) || isFlowingWater(id) || isLava(id) && id !== BLOCK.LAVA;
// Removing these would lose state (containers, turrets).
const protectedBlock = id => C.protectedBlocks.includes(id) || !!getBlockDef(id).tileEntity || !!turretType(id);
// A door's open/closed state is a player choice, not damage.
// Grass and dirt count as one: grass spreads over placed dirt and covered
// grass turns back to dirt, so neither is ever worth redoing.
const soil = id => id === BLOCK.DIRT || id === BLOCK.GRASS;
const same = (a, b) => a === b || soil(a) && soil(b) || isDoor(a) && isDoor(b)
  && ['facing', 'upper', 'reinforced'].every(k => doorState(a)[k] === doorState(b)[k]);

export class WorkOrders {
  constructor(garrison) {
    this.garrison = garrison; this.game = garrison.game; this.world = garrison.game.world;
    this.targets = new Map();       // cell key -> target block id (or CLEAR)
    this.badSpots = new Map();      // standing spot key -> tick it may be offered again
    this.sections = new Map();      // section key -> { key, cells, area, dirty, center }
    this.byArea = new Map();        // area id -> sections
    this.dirty = new Map();         // area id -> Set of dirty sections
    this.jobs = new Set();
    this.claimed = new Map();       // cell key -> job (every job's target cells)
    this.reserved = new Set();      // cells construction hasn't built yet; inspections skip them
    this.nextInspect = new Map();   // area id -> tick
    this.applying = null;           // cell key a worker is changing right now
    this.nextJobId = 1;
    this.capture();
  }
  key(x, y, z) { return this.world.cellIndex(x, y, z); }
  cell(key) {
    const w = this.world, x = key % w.sizeX, rest = (key - x) / w.sizeX, z = rest % w.sizeZ;
    return { x, y: (rest - z) / w.sizeZ + w.minY, z };
  }
  sectionKey(x, y, z) { const s = C.sectionSize; return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`; }

  // Targets, then sections, each belonging to the area most of its cells lie in.
  capture() {
    const plan = this.garrison.plan, w = this.world;
    if (plan.construction) for (const [key, id] of plan.construction.targets) this.targets.set(key, id);
    else this.captureWorld();
    if (plan.construction) this.addClearBand();
    for (const key of this.targets.keys()) {
      const { x, y, z } = this.cell(key), sk = this.sectionKey(x, y, z);
      let section = this.sections.get(sk);
      if (!section) this.sections.set(sk, section = { key: sk, cells: [], area: null, dirty: false });
      section.cells.push(key);
    }
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
          const owner = (columns.get(cellKey(p.x + dx, p.z + dz)) ?? []).find(a => a.kind !== 'outskirts'
            && this.garrison.nav.contains(a, { ...p, x: p.x + dx, z: p.z + dz }));
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
  // Without a construction plan: every block the plans wrote plus each
  // piece's box, as the world holds them at match start.
  captureWorld() {
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
      const { x, y, z } = this.cell(key), id = w.getBlock(x, y, z);
      this.targets.set(key, ignored(id) ? BLOCK.AIR : id);
    }
  }
  // Trees and plants are cleared in a band outside the outer wall, from the
  // ground up to clearHeight.
  addClearBand() {
    const plan = this.garrison.plan, outer = plan.surface.rings.find(r => r.name === 'outer'); if (!outer) return;
    const inside = new Set(outer.area), cells = plan.buildability.cells;
    for (const w of [...outer.wall, ...outer.gates]) for (let dz = -C.clearBand; dz <= C.clearBand; dz++) for (let dx = -C.clearBand; dx <= C.clearBand; dx++) {
      const k = cellKey(w.x + dx, w.z + dz), c = cells.get(k);
      if (!c || inside.has(k)) continue;
      for (let y = c.ground + 1; y <= c.ground + C.clearHeight; y++) {
        const key = this.key(w.x + dx, y, w.z + dz);
        if (this.world.inBounds(w.x + dx, y, w.z + dz) && !this.targets.has(key)) this.targets.set(key, CLEAR);
      }
    }
  }

  // Whether a block still needs work: the world differs from its target.
  // Construction (build) also removes trees and plants, and places
  // containers; repairs leave both alone.
  need(b) {
    const have = this.world.getBlock(b.x, b.y, b.z), want = b.want;
    if (want === CLEAR || want === BLOCK.AIR && b.build) return !protectedBlock(have)
      && (plant(have) || isTreeSupport(have) || want === BLOCK.AIR && have !== BLOCK.AIR && !ignored(have));
    if (same(have, want) || ignored(want) || getBlockDef(want).tileEntity && !b.build) return false;
    if (ignored(have) && !isSolid(want)) return false;
    return !protectedBlock(have);
  }
  // The work a cell needs as a block { key, x, y, z, want, build }, or null.
  difference(key, build = false) {
    const want = this.targets.get(key); if (want === undefined) return null;
    const b = { key, ...this.cell(key), want, build };
    return this.need(b) ? b : null;
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
    for (const job of this.jobs) if (job.waiting && (!area || job.area === area || job.sites)) job.retry = true;
  }

  // ---- Jobs ----

  // Areas a worker may work in: its own, and planned areas directly adjacent
  // (also through a link area such as the temporary shaft).
  areasFor(unit) {
    const plan = this.garrison.plan, nav = this.garrison.nav, home = unit.home;
    const next = id => plan.gates.filter(g => g.areas.includes(id)).flatMap(g => g.areas).filter(a => a !== id);
    // During construction, neighbours also include touching surface areas.
    const construction = this.garrison.construction;
    const near = new Set(construction && !construction.done ? construction.neighbours(nav.area(home)).map(a => a.id) : next(home));
    for (const id of [...near]) if (nav.area(id)?.link) for (const n of next(id)) near.add(n);
    return [home, ...[...near].filter(id => nav.area(id)?.state === 'planned')];
  }
  // A standing spot from which every block is within reach: the nearest
  // supported walkable node, never inside any job's target cells. Planned
  // areas offer the reachable nodes of their construction site.
  // pool: candidates gathered once for a larger set of blocks (see addJobs).
  spotFor(blocks, areaIds, pool = this.spotPool(blocks, areaIds)) {
    const own = new Set(blocks.map(b => b.key));
    let cx = 0, cy = 0, cz = 0;
    for (const b of blocks) { cx += b.x + 0.5; cy += b.y + 0.5; cz += b.z + 0.5; }
    const mid = { x: cx / blocks.length, y: cy / blocks.length, z: cz / blocks.length };
    // Areas in preference order, then the nearest node in each.
    for (const { id, nodes } of pool) {
      let best = null, d = Infinity;
      for (const n of nodes) {
        const dn = Math.hypot(n.x + 0.5 - mid.x, n.z + 0.5 - mid.z);
        if (dn > C.reach + 1 || dn >= d) continue;
        const feet = this.key(n.x, n.y, n.z), head = this.key(n.x, n.y + 1, n.z);
        if (own.has(feet) || own.has(head) || this.claimed.has(feet) || this.claimed.has(head)) continue;
        if (this.game.tick < (this.badSpots.get(n.key) ?? 0)) continue;
        const body = { x: n.x + 0.5, y: n.y + 0.6, z: n.z + 0.5 };
        if (blocks.every(b => Math.hypot(b.x + 0.5 - body.x, b.y + 0.5 - body.y, b.z + 0.5 - body.z) <= C.reach)) { best = n; d = dn; }
      }
      if (best) return { spot: best, area: id };
    }
    return null;
  }
  // Standing-spot candidates for every subset of `blocks`: each area's
  // reachable nodes within reach + 1 of any of them.
  spotPool(blocks, areaIds) {
    const nav = this.garrison.nav;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of blocks) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z); }
    const mid = { x: (x0 + x1 + 1) / 2, y: 0, z: (z0 + z1 + 1) / 2 };
    const radius = C.reach + 1 + Math.hypot(x1 - x0, z1 - z0) / 2;
    const pool = [];
    for (const id of areaIds) {
      const area = nav.area(id); if (!area) continue;
      const site = area.state === 'planned' ? this.garrison.construction?.site(area) : null;
      const reachable = !site && this.garrison.plan.construction ? nav.reachable(s => this.garrison.spawnAlive(s), this.game.tick) : null;
      const nodes = site ? site.nodesNear(mid, radius)
        : area.state === 'active' ? nav.nodesNear(area, mid, radius, 'worker', true).filter(n => !reachable || reachable.has(n.key)) : [];
      if (nodes.length) pool.push({ id, nodes });
    }
    return pool;
  }
  // A worker couldn't walk to this standing spot: it isn't offered again for
  // badSpotSeconds (the nav graph and reachability can disagree briefly).
  badSpot(spot) { if (spot) this.badSpots.set(spot.key, this.game.tick + ticks(C.badSpotSeconds)); }
  // Halves along the longest axis of the blocks' bounding box.
  split(blocks) {
    const axis = ['x', 'y', 'z'].map(a => [a, Math.max(...blocks.map(b => b[a])) - Math.min(...blocks.map(b => b[a]))])
      .sort((a, b) => b[1] - a[1])[0][0];
    const sorted = [...blocks].sort((a, b) => a[axis] - b[axis]), half = sorted.length >> 1;
    return [sorted.slice(0, half), sorted.slice(half)];
  }
  // Pieces of at most maxJobBlocks, each with a standing spot when possible;
  // a single block with no spot becomes a waiting job. extra: fields for
  // every job (a construction entry, the areas its sites may use).
  // With defer (construction), a block with no spot is handed back instead
  // of becoming a waiting job.
  addJobs(blocks, areaIds, extra = {}, defer = null, pool = this.spotPool(blocks, areaIds)) {
    // Nothing to stand on near any of them: all handed back at once.
    if (!pool.length && defer) { for (const b of blocks) defer(b); return; }
    if (blocks.length > C.maxJobBlocks) { for (const half of this.split(blocks)) this.addJobs(half, areaIds, extra, defer, pool); return; }
    const found = pool.length ? this.spotFor(blocks, areaIds, pool) : null;
    if (!found && blocks.length > 1) { for (const half of this.split(blocks)) this.addJobs(half, areaIds, extra, defer, pool); return; }
    if (!found && defer) { defer(blocks[0]); return; }
    this.addJob(blocks, { spot: found?.spot ?? null, area: found?.area ?? areaIds[0], waiting: !found, sites: areaIds, ...extra });
  }
  addJob(blocks, fields) {
    const job = { id: this.nextJobId++, blocks, spot: null, area: null, waiting: false, retry: false, worker: null, ...fields };
    this.jobs.add(job); job.entry?.jobs.add(job);
    for (const b of blocks) this.claimed.set(b.key, job);
    return job;
  }
  // Connected clusters (6-neighbour) of blocks, as jobs.
  addClusters(blocks, areaIds, extra = {}, defer = null) {
    const diffs = new Map(blocks.map(b => [b.key, b]));
    while (diffs.size) {
      const first = diffs.values().next().value, cluster = [first], queue = [first]; diffs.delete(first.key);
      for (let i = 0; i < queue.length; i++) for (const [dx, dy, dz] of SIDES) {
        const k = this.key(queue[i].x + dx, queue[i].y + dy, queue[i].z + dz), d = diffs.get(k);
        if (!d) continue;
        diffs.delete(k); cluster.push(d); queue.push(d);
      }
      this.addJobs(cluster, areaIds, extra, defer);
    }
  }
  // A worker compared a section of its (active) area with its targets.
  inspect(section, unit) {
    section.dirty = false; this.dirty.get(section.area)?.delete(section);
    const diffs = [];
    for (const key of section.cells) {
      if (this.claimed.has(key) || this.reserved.has(key)) continue;
      const d = this.difference(key); if (d) diffs.push(d);
    }
    this.addClusters(diffs, this.areasFor(unit));
  }
  // A job ended (done, given up or cancelled): its claims and standing spot
  // are free, which may make parked construction work possible.
  drop(job, wake = true) {
    this.jobs.delete(job);
    const construction = this.garrison.construction;
    if (construction && wake) { construction.wake(job.spot); construction.wake(job.blocks[0]); }
    for (const b of job.blocks) if (this.claimed.get(b.key) === job) this.claimed.delete(b.key);
    if (job.worker?.task?.job === job) job.worker.task = null;
  }
  release(unit) {
    for (const job of this.jobs) if (job.worker === unit) job.worker = null;
  }
  // Order: rebuilding a lost spawn building first, then jobs touching
  // existing structure, then the rest; nearest first within each.
  rank(job) {
    if (job.first) return 0;
    const area = this.garrison.nav.area(job.area);
    const lost = (area?.spawns ?? []).filter(s => s.box && !this.garrison.spawnAlive(s));
    if (job.blocks.some(b => lost.some(s => b.x >= s.box.x0 && b.x <= s.box.x1 && b.z >= s.box.z0 && b.z <= s.box.z1
      && b.y >= s.box.y0 && b.y <= s.box.y1))) return 0;
    const pending = job.blocks.filter(b => this.need(b));
    if (!pending.length) return 1;
    const touches = pending.some(b => b.want === BLOCK.AIR || b.want === CLEAR || SIDES.some(([dx, dy, dz]) => {
      const k = this.key(b.x + dx, b.y + dy, b.z + dz);
      return isSolid(this.world.getBlock(b.x + dx, b.y + dy, b.z + dz)) && !job.blocks.some(o => o.key === k);
    }));
    return touches ? 1 : 2;
  }
  // The next job for an idle worker, or an inspection when its area's timer
  // is due. Nothing while an enemy is inside the area.
  // A worker of a neighbouring surface area may help finish a surface area
  // whose own construction phases are done (underground workers stay below:
  // the shaft they would cross is relocated at the end).
  helps(unit, area) {
    const construction = this.garrison.construction;
    if (!construction || area.kind !== 'surface' || !construction.areaDone(area)) return false;
    return construction.neighbours(area).some(a => a.id === unit.home && a.kind === 'surface');
  }
  nextTask(unit, tick) {
    const areas = this.areasFor(unit), occupied = this.garrison.occupied;
    let retries = C.retriesPerTask;
    // Waiting jobs are re-checked after nearby blocks change, and every
    // waitRetrySeconds anyway (navigation catches up with a change a tick
    // or more later).
    for (const job of this.jobs) {
      if (!job.waiting || job.climb || !job.retry && tick < (job.retryAt ?? 0)
        || !areas.includes(job.area) && !job.sites?.some(id => areas.includes(id))) continue;
      if (retries-- <= 0) break;
      job.retry = false; job.retryAt = tick + ticks(C.waitRetrySeconds);
      const found = this.spotFor(job.blocks, job.sites ?? [job.area]);
      if (found) Object.assign(job, { spot: found.spot, area: found.area, waiting: false });
    }
    let best = null, bestScore = Infinity;
    for (const job of this.jobs) {
      // A construction job belongs to its entry's area wherever its spot is.
      // Once that area's own phases are built, what's left there (the Castle,
      // backlog cleanup) is open to the neighbours' workers too.
      const own = areas.includes(job.area) || job.entry && areas.includes(job.entry.area.id)
        || job.entry && this.helps(unit, job.entry.area);
      if (job.worker || job.waiting || !own || occupied.has(job.area)) continue;
      const at = job.spot ?? job.blocks[0];
      const score = this.rank(job) * 1e6 + Math.hypot(at.x - unit.state.x, at.z - unit.state.z);
      if (score < bestScore) { best = job; bestScore = score; }
    }
    if (best) { best.worker = unit; return { kind: 'job', job: best }; }
    const home = unit.home;
    if (occupied.has(home) || this.garrison.nav.area(home)?.state !== 'active' || tick < (this.nextInspect.get(home) ?? 0)) return null;
    const sections = this.byArea.get(home); if (!sections?.length) return null;
    this.nextInspect.set(home, tick + ticks(C.inspectSeconds));
    const dirty = this.dirty.get(home);
    const section = dirty?.size ? dirty.values().next().value : sections[Math.floor(Math.random() * sections.length)];
    return { kind: 'inspect', section };
  }
  // The job's next block. Ordered jobs (the shaft) go in their own order;
  // others do removals top-down, then placements bottom-up. Null when the
  // job is done; 'blocked' when someone stands in every remaining placement.
  nextBlock(job, worker = null) {
    const pending = job.blocks.filter(b => this.need(b));
    if (!pending.length) return null;
    if (job.ordered) return this.occupied(pending[0], worker) && pending[0].want !== BLOCK.AIR ? 'blocked' : pending[0];
    const removals = pending.filter(b => b.want === BLOCK.AIR || b.want === CLEAR).sort((a, b) => b.y - a.y);
    if (removals.length) return removals[0];
    const free = pending.filter(b => !this.occupied(b, worker)).sort((a, b) => a.y - b.y);
    return free[0] ?? 'blocked';
  }
  // Someone stands in the cell. A goblin there (not the worker itself) is
  // nudged out of the way with a small push; a player is waited for.
  occupied(b, worker = null) {
    if (this.game.playerIn(b.x, b.y, b.z)) return true;
    let found = false;
    for (const m of this.game.mobs.values()) {
      const s = m.state, w = s.box?.halfW ?? 0.3, h = s.box?.height ?? 1.8;
      if (!(s.x + w > b.x && s.x - w < b.x + 1 && s.z + w > b.z && s.z - w < b.z + 1 && s.y < b.y + 1 && s.y + h > b.y)) continue;
      found = true;
      if (m.goblin && m !== worker && !m.immovable) {
        const dx = s.x - (worker?.state.x ?? b.x + 0.5), dz = s.z - (worker?.state.z ?? b.z + 0.5), d = Math.hypot(dx, dz) || 1;
        s.kx = dx / d * C.nudgeSpeed; s.kz = dz / d * C.nudgeSpeed;
      }
    }
    return found;
  }
  // One swing's work: remove the wrong block (as if broken, so its item
  // drops; trees and plants just go), then place the target block. Placed
  // containers get their tile entity (loot chests already have one).
  apply(b) {
    const have = this.world.getBlock(b.x, b.y, b.z), want = b.want === CLEAR ? BLOCK.AIR : b.want;
    this.applying = b.key;
    try {
      // Construction cuts terrain without drops; repairs break player blocks
      // so their items drop.
      if (ignored(have) || isTreeSupport(have) || b.build) this.world.setBlock(b.x, b.y, b.z, BLOCK.AIR);
      else if (have !== BLOCK.AIR) this.game.breakBlock(b.x, b.y, b.z);
      if (want !== BLOCK.AIR) {
        this.world.setBlock(b.x, b.y, b.z, want);
        const kind = getBlockDef(want).tileEntity, key = `${b.x},${b.y},${b.z}`;
        if (kind && !this.world.tileEntities.has(key)) {
          const container = createContainer(kind);
          if (container) { this.world.tileEntities.set(key, container); this.game.fluids?.attach(b.x, b.y, b.z, container); }
        }
      }
    } finally { this.applying = null; }
  }
}
