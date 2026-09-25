// Goblin projects: what the fortress builds, as ordered lists of block
// tasks. A task digs or places a block (both are done by workers).
// Planners here pick sites and turn intended blocks into tasks; the
// controller (goblins.js) chooses which
// project runs, goblins (goblin.js) claim and do its tasks, and offscreen
// mode (goblinOffscreen.js) applies them at estimated rates.
//
// Task: { key, x, y, z, kind: 'dig' | 'place', id (placed id, or AIR for a
// dig), material (spent placing), order, requires ([task] done first),
// climb (a shaft column to stand on while doing it), done, claimedBy,
// attempts, blockedUntil }.

import { BLOCK, getBlockDef, isSolid, isWater, isLadder, ladderBlock, ladderFacing } from '../shared/blocks.js';
import { TICK_RATE } from '../shared/config.js';
import { GOBLINS } from '../shared/goblins.js';
import {
  CELL_SIZE, CELL_HEIGHT, FACES, HORIZONTAL, MODULE_TYPES, SURFACE_TEMPLATES, DWELLINGS,
  cellKey, stepCell, cellOrigin, footprint, footprintCells, canAddModule, opens,
  registerModule, moduleBlocks, planAutoConnect, registerConnection, ladderSpot, rotateFace, materialOf,
  plotTemplate, templateBlocks, DOOR_PATH, templateBounds, templateSize, turnLocal, turnsFront, turnsBack,
} from '../shared/goblinModules.js';
import { KEEP_REACH } from '../shared/structures.js';

const NONE = -32768;
export const blockKey = (x, y, z) => `${x},${y},${z}`;

// ---- Blocks ----

const SOIL = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, BLOCK.SCORCHED_EARTH]);
const ROCK = new Set([BLOCK.STONE, BLOCK.IRON_ORE, BLOCK.STONE_BRICKS, BLOCK.MOSSY_STONE_BRICKS,
  BLOCK.CRACKED_STONE_BRICKS, BLOCK.QUARRY_STONE]);

// Ground a building can stand on, and that surface searches look for.
export function isGround(id) {
  return SOIL.has(id) || ROCK.has(id);
}

// What a goblin gets from digging a block out, as a storage material, or null.
export function yieldOf(id) {
  if (ROCK.has(id)) return 'stone';
  if (SOIL.has(id)) return 'dirt';
  if (id === BLOCK.WOOD) return 'wood';
  if (id === BLOCK.PLANKS || isLadder(id)) return 'planks';
  if (id === BLOCK.GOBLIN_BRICKS) return 'bricks';
  return null;
}

// Blocks goblins never break.
export function isProtected(id) {
  return id === BLOCK.KEEP || id === BLOCK.PEDESTAL;
}

// Ticks a goblin needs to break a block: like a hammer of GOBLINS.breaking's
// strength and speed, but any hardness goes, each point above the strength
// adding the base time again. Water is scooped up in placeTime.
export function goblinBreakTicks(id) {
  const { strength, speed, hardnessScale, placeTime } = GOBLINS.breaking;
  const scale = GOBLINS.goblinTimeScale;
  if (isWater(id)) return Math.max(1, Math.round(placeTime * TICK_RATE / scale));
  const def = getBlockDef(id);
  const factor = 1 + Math.max(0, def.hardness - strength) * hardnessScale;
  return Math.max(1, Math.round(def.breakTime * TICK_RATE / speed * factor / scale));
}

export function goblinPlaceTicks() {
  return Math.max(1, Math.round(GOBLINS.breaking.placeTime * TICK_RATE / GOBLINS.goblinTimeScale));
}

// Whether a block counts as open (walkable through, or reachable across).
const open = (id) => !isSolid(id);

// ---- Projects ----

export class Project {
  // kind: 'repairs' | 'shaft' | 'gatehouse' | 'module' | 'dwelling' | 'plot' | 'widen'
  constructor(kind, label) {
    this.kind = kind;
    this.label = label;
    this.tasks = [];
    this.byKey = new Map();
    this.done = 0;
    // For the controller: called once every task is done and verified.
    this.onComplete = null;
    // The blocks it's meant to leave, key -> { x, y, z, id }, to re-check at the end.
    this.intended = new Map();
    // Where goblins without a task wait, and where offscreen mode puts them.
    this.site = null;
    this.startTick = 0;
    // Offscreen: seconds of walking for one trip between the totem and the site.
    this.tripTime = 0;
  }

  add(task) {
    task.project = this;
    task.order = task.order ?? this.tasks.length;
    task.done = false;
    task.claimedBy = null;
    task.attempts = 0;
    task.blockedUntil = 0;
    task.requires = task.requires ?? [];
    this.tasks.push(task);
    if (!this.byKey.has(task.key)) this.byKey.set(task.key, []);
    this.byKey.get(task.key).push(task);
    return task;
  }

  get total() {
    return this.tasks.length;
  }

  get remaining() {
    return this.tasks.length - this.done;
  }

  progress() {
    return this.tasks.length ? this.done / this.tasks.length : 1;
  }

  pending(kind) {
    return this.tasks.filter((t) => !t.done && (!kind || t.kind === kind));
  }

  sort() {
    this.tasks.sort((a, b) => a.order - b.order);
  }
}

// The tasks that turn the world's current blocks into `blocks`
// ([{ x, y, z, id }]): digs for air, places for the rest (after a dig when
// something solid is in the way of a ladder or sapling). `keepSolid(b)`:
// for a brick cell already holding something solid, leave it (true) or
// replace it with bricks (false). `order(b)` sorts. Returns the tasks, and
// records the blocks in project.intended.
export function addBlockTasks(project, world, blocks, { keepSolid = () => false, order = () => 0 } = {}) {
  const made = [];
  for (const b of blocks) {
    const key = blockKey(b.x, b.y, b.z);
    const current = world.getBlock(b.x, b.y, b.z);
    project.intended.set(key, b);
    if (isProtected(current)) continue;
    const o = order(b);
    if (b.id === BLOCK.AIR) {
      if (current === BLOCK.AIR) continue;
      made.push(project.add({ key, x: b.x, y: b.y, z: b.z, kind: isWater(current) ? 'place' : 'dig',
        id: BLOCK.AIR, material: null, order: o, climb: b.climb, grows: b.grows }));
      continue;
    }
    if (current === b.id) continue;
    if (b.ground && isSolid(current)) continue;
    if (b.id === BLOCK.GOBLIN_BRICKS && isSolid(current) && keepSolid(b)) continue;
    let requires = [];
    // Ladders and saplings go into an emptied cell; dig it first.
    if ((isLadder(b.id) || b.id === BLOCK.SAPLING) && isSolid(current)) {
      requires = [project.add({ key, x: b.x, y: b.y, z: b.z, kind: 'dig', id: BLOCK.AIR, material: null, order: o, climb: b.climb })];
      made.push(requires[0]);
    }
    made.push(project.add({ key, x: b.x, y: b.y, z: b.z, kind: 'place', id: b.id, material: materialOf(b.id),
      order: o + 0.5, requires, climb: b.climb, grows: b.grows }));
  }
  return made;
}

// Whether a task can be worked on now: not done, its requirements done, the
// block still needs changing, and (for digs) some face of it is open.
export function taskReady(task, world, tick) {
  if (task.done || task.blockedUntil > tick) return false;
  if (task.requires.some((t) => !t.done)) return false;
  if (task.ready && !task.ready(task)) return false;
  // Digs work outward from open space; placements reach wherever a goblin can stand.
  if (task.kind === 'place') return true;
  for (const [dx, dy, dz] of NEIGHBOURS) {
    if (open(world.getBlock(task.x + dx, task.y + dy, task.z + dz))) return true;
  }
  return false;
}

// Whether a task's block already is what the task would make it.
// Blocks a tree plot's trees are made of: on a plot they're what's meant to be there.
export const TREE_BLOCKS = new Set([BLOCK.SAPLING, BLOCK.WOOD, BLOCK.LEAVES]);

export function taskSatisfied(task, world) {
  const current = world.getBlock(task.x, task.y, task.z);
  if (task.grows && TREE_BLOCKS.has(current)) return true;
  if (task.kind === 'dig') return current === BLOCK.AIR || (!isSolid(current) && !isWater(current) && !isLadder(current)
    && current !== BLOCK.SAPLING);
  return current === task.id;
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---- Site checks ----

// The world's top solid ground block in a column (ignoring trees, plants and
// goblin-built wood), searched down from above the natural terrain, or NONE.
export function surfaceHeight(world, x, z) {
  if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return NONE;
  const natural = world.naturalTop[x + world.sizeX * z];
  if (natural === NONE) return NONE;
  for (let y = Math.min(world.sizeY - 1, natural + 12); y >= natural - 12; y--) {
    const id = world.getBlock(x, y, z);
    if (isGround(id) || id === BLOCK.WATER || id === BLOCK.GOBLIN_BRICKS) return isGround(id) || id === BLOCK.GOBLIN_BRICKS ? y : NONE;
  }
  return NONE;
}

// Whether the blocks from y down `depth` in a column are all solid ground.
export function solidBelow(world, x, y, z, depth) {
  for (let d = 0; d < depth; d++) if (!isSolid(world.getBlock(x, y - d, z))) return false;
  return true;
}

// Whether a box (x0..x1, z0..z1, optional y0..y1) keeps `margin` from every
// keep, world structure (other than the fortress itself), river and goblin
// surface building / shaft.
export function clearSite(world, controller, box, margin) {
  for (let z = box.z0 - margin; z <= box.z1 + margin; z++) {
    for (let x = box.x0 - margin; x <= box.x1 + margin; x++) {
      if (controller.wallFootprints?.has(`${x},${z}`)) return false;
    }
  }
  for (const keep of world.keeps) {
    if (box.x0 - margin <= keep.cx + KEEP_REACH && box.x1 + margin >= keep.cx - KEEP_REACH
      && box.z0 - margin <= keep.cz + KEEP_REACH && box.z1 + margin >= keep.cz - KEEP_REACH) return false;
  }
  for (const s of world.structures) {
    if (!s.box || s.kind === 'goblinFortress') continue;
    const b = s.box;
    if (box.x0 - margin <= b.x1 && box.x1 + margin >= b.x0 && box.z0 - margin <= b.z1 && box.z1 + margin >= b.z0
      && (box.y0 === undefined || (box.y0 - margin <= b.y1 && box.y1 + margin >= b.y0))) return false;
  }
  if (world.riverColumns?.size) {
    for (let z = box.z0 - margin; z <= box.z1 + margin; z++) {
      for (let x = box.x0 - margin; x <= box.x1 + margin; x++) if (world.riverColumns.has(`${x},${z}`)) return false;
    }
  }
  for (const other of controller.surfaceBoxes()) {
    if (box.x0 - margin <= other.x1 && box.x1 + margin >= other.x0 && box.z0 - margin <= other.z1 && box.z1 + margin >= other.z0
      && (box.y0 === undefined || other.y0 === undefined || (box.y0 - margin <= other.y1 && box.y1 + margin >= other.y0))) return false;
  }
  if (box.x0 - margin < 0 || box.z0 - margin < 0 || box.x1 + margin >= world.sizeX || box.z1 + margin >= world.sizeZ) return false;
  return true;
}

// The central island (the fortress's island).
export function centralIsland(world) {
  return world.islands?.find((island) => island.kind === 'center') ?? world.islands?.[0] ?? null;
}

// Terrain facts about a cell box: whether it can hold a module and how.
// Returns null (can't), or { cliff, emerging }.
function cellTerrain(world, box) {
  const settings = GOBLINS.expansion;
  let outside = 0, columns = 0, minTop = Infinity, emerging = false;
  for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) {
    columns++;
    if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return null;
    const index = x + world.sizeX * z;
    const top = world.naturalTop[index], bottom = world.naturalBottom[index];
    if (top === NONE) { outside++; continue; }
    // Never dig out through the island's underside.
    if (bottom > box.y0 - settings.underside) return null;
    minTop = Math.min(minTop, top);
    if (box.y1 > top) emerging = true;
  }
  if (outside === columns) return null;
  // Rising out of the ground: its floor must rest on the terrain.
  if (emerging && box.y0 > minTop + settings.emergeFloor) return null;
  return { cliff: outside > 0, emerging };
}

// ---- Fortress modules ----

// A cell box in block coordinates.
function cellBox(fortress, type, cell, rotation) {
  const size = footprint(type, rotation);
  const low = cellOrigin(fortress, cell);
  return { x0: low.x, y0: low.y, z0: low.z,
    x1: low.x + size[0] * CELL_SIZE - 1, y1: low.y + size[1] * CELL_HEIGHT - 1, z1: low.z + size[2] * CELL_SIZE - 1 };
}

// Whether a module could go in `cell`: free, on an allowed level, outside
// the inner ring, clear of structures, rivers and goblin buildings, and in
// the island (or poking out of its side / top as terrain allows).
export function cellAllowed(world, controller, type, cell, rotation) {
  const fortress = controller.fortress;
  const settings = GOBLINS.expansion;
  const hallLevel = controller.hall.cell[1];
  if (!canAddModule(fortress, type, cell, rotation)) return why('taken');
  for (const c of footprintCells(type, cell, rotation)) {
    if (c[1] - hallLevel < settings.minLevel || c[1] - hallLevel > settings.maxLevel) return why('level');
  }
  const box = cellBox(fortress, type, cell, rotation);
  const island = centralIsland(world);
  if (island) {
    const nx = Math.max(box.x0, Math.min(island.x, box.x1)), nz = Math.max(box.z0, Math.min(island.z, box.z1));
    if (Math.hypot(nx - island.x, nz - island.z) < island.radius * GOBLINS.placement.ringInner) return why('ring');
  }
  if (!clearSite(world, controller, box, settings.clearance)) return why('site');
  const terrain = cellTerrain(world, box);
  if (!terrain) return why('terrain');
  return { box, ...terrain };
}

// Why the last cellAllowed said no (debugging).
export const cellRejections = {};
function why(reason) {
  cellRejections[reason] = (cellRejections[reason] ?? 0) + 1;
  return null;
}

// Candidate growth steps from the fortress: [{ parent, face, cell, cellFrom }].
function frontier(controller) {
  const fortress = controller.fortress;
  const out = [];
  for (const m of fortress.modules) {
    if (m.building || m.noGrow) continue;
    const def = MODULE_TYPES[m.type];
    for (const c of footprintCells(m.type, m.cell, m.rotation)) {
      for (const face of [...HORIZONTAL, ...(def.vertical ?? [])]) {
        if (!opens(m, face, c)) continue;
        const next = stepCell(c, face);
        if (cellKey(...next) in fortress.cells) continue;
        out.push({ parent: m, face, cell: next, cellFrom: c });
      }
    }
  }
  return out;
}

// Rotations of `type` that open `face` (toward the parent).
function rotationsOpening(type, face) {
  const faces = MODULE_TYPES[type].faces;
  if (faces === 'any') return [0];
  return [0, 1, 2, 3].filter((r) => faces.some((f) => rotateFace(f, r) === face));
}

// Picks the next module: a frontier cell scored for staying on the ring,
// wrapping around it and a little randomness, and a type (weighted, with
// Bunk Rooms favoured when the goblins need room). Returns a spec
// { type, cell, rotation, ladderFace, parent, cliff } or null.
export function chooseModule(world, controller, random, { ladders = true } = {}) {
  const settings = GOBLINS.expansion;
  const island = centralIsland(world);
  const place = controller.fortress.placement ?? { angle: 0, distance: 0 };
  const needRoom = controller.population() >= controller.capacity() - GOBLINS.projects.dwellingSlack;
  const weights = { ...settings.types, bunkRoom: needRoom ? settings.bunkWeight : settings.types.bunkRoom };
  // Shafts need planks for their ladders.
  if (!ladders) delete weights.ladderShaft;
  let best = null;
  for (const step of frontier(controller)) {
    const vertical = step.face === 'U' || step.face === 'D';
    if (vertical && (!ladders || random() > settings.verticalChance)) continue;
    const back = FACES[step.face].opposite;
    const options = [];
    if (vertical) options.push({ type: 'ladderShaft', rotation: 0, weight: 1 });
    else {
      for (const [type, weight] of Object.entries(weights)) {
        for (const rotation of rotationsOpening(type, back)) options.push({ type, rotation, weight });
      }
    }
    // A weighted pick of a type that fits.
    let total = options.reduce((sum, o) => sum + o.weight, 0);
    let pick = null;
    for (let tries = 0; tries < 6 && options.length && !pick; tries++) {
      let roll = random() * total;
      const option = options.find((o) => (roll -= o.weight) < 0) ?? options.at(-1);
      const fits = cellAllowed(world, controller, option.type, step.cell, option.rotation);
      if (fits) pick = { ...option, fits };
    }
    if (!pick) continue;
    // Poking out of the island's side: only a sealed room off a hallway, sometimes.
    if (pick.fits.cliff) {
      if (vertical || MODULE_TYPES[step.parent.type].shape !== 'corridor' || random() > settings.cliffChance) continue;
      const fits = cellAllowed(world, controller, 'room', step.cell, 0);
      if (!fits) continue;
      pick = { type: 'room', rotation: 0, fits };
    }
    const box = pick.fits.box;
    let score = random() * settings.jitter;
    if (island) {
      const cx = (box.x0 + box.x1 + 1) / 2, cz = (box.z0 + box.z1 + 1) / 2;
      const r = Math.hypot(cx - island.x, cz - island.z);
      let wrap = Math.abs(Math.atan2(cz - island.z, cx - island.x) - place.angle) % (Math.PI * 2);
      if (wrap > Math.PI) wrap = Math.PI * 2 - wrap;
      score += settings.wrapWeight * wrap / Math.PI * 4 - settings.radialWeight * Math.abs(r - place.distance) / CELL_SIZE;
    }
    if (!best || score > best.score) {
      best = { score, type: pick.type, cell: step.cell, rotation: pick.rotation, parent: step.parent,
        ladderFace: vertical ? step.parent.ladderFace : null, cliff: pick.fits.cliff, face: step.face };
    }
  }
  return best;
}

// A project building a planned module (spec from chooseModule or the shaft
// planner): registers it (as a building site, so goblins can path to it),
// plans its connections, and turns its blocks into tasks ordered outward
// from the doorway to its parent. Extra blocks (a shaft column) may be
// appended by the caller.
export function moduleProject(world, controller, spec, label) {
  const fortress = controller.fortress;
  const module = registerModule(fortress, spec);
  if (!module) return null;
  module.building = true;
  if (spec.cliff) module.noGrow = true;
  const def = MODULE_TYPES[module.type];
  const project = new Project('module', label ?? def.label);
  project.module = module;
  const plans = planAutoConnect(fortress, module).filter((plan) => {
    const other = fortress.modules[plan.connection.a === module.id ? plan.connection.b : plan.connection.a];
    return !other.building;
  });
  const connections = plans.map((plan) => registerConnection(fortress, { ...plan.connection, pending: true }));
  project.connections = connections;
  const blocks = new Map();
  for (const b of moduleBlocks(module)) blocks.set(blockKey(b.x, b.y, b.z), b);
  for (const plan of plans) for (const b of plan.blocks) blocks.set(blockKey(b.x, b.y, b.z), b);
  // Order: distance from the parent doorway, so digging works outward.
  const parentPlan = plans.find((plan) => [plan.connection.a, plan.connection.b].includes(spec.parent?.id)) ?? plans[0];
  const door = parentPlan?.blocks[0] ?? { x: module.center.x, y: module.floorY, z: module.center.z };
  const order = (b) => Math.abs(b.x - door.x) + Math.abs(b.y - door.y) * 0.5 + Math.abs(b.z - door.z);
  // Every cell in a new module is converted to its template. Replacing stone
  // with bricks yields the excavated stone for the colony's stores.
  const tasks = addBlockTasks(project, world, [...blocks.values()], { order });
  // A ladder up from the module below is built from the ladder, and when
  // that's the way in, everything else waits for it.
  const climbing = tasks.filter((t) => t.climb);
  if (climbing.length) {
    wireShaftTasks(project, climbing, GOBLINS.worker.reach);
    if (spec.face === 'U' || spec.face === 'D') {
      for (const t of tasks) if (!t.climb) t.requires = [...t.requires, ...climbing];
    }
  }
  project.sort();
  project.site = { x: module.center.x, y: module.floorY, z: module.center.z };
  project.onComplete = () => {
    module.building = false;
    for (const c of connections) c.pending = false;
  };
  project.onAbandon = () => {
    for (const c of fortress.cells ? Object.keys(fortress.cells) : []) if (fortress.cells[c] === module.id) delete fortress.cells[c];
    module.removed = true;
    for (const c of connections) c.removed = true;
    fortress.connections = fortress.connections.filter((c) => !c.removed);
  };
  return project;
}

// ---- Surface shafts ----

// Candidate spots for a surface shaft: a free cell beside a module on the
// fortress's top level (any level if none fits), with a wall for its
// ladder, whose column rises to a surface spot clear of keeps, structures,
// rivers and other goblin buildings, with room for the gatehouse around its
// top. Returns [{ spec, column, wall, top }].
export function shaftCandidates(world, controller, { awayFrom = [] } = {}) {
  const fortress = controller.fortress;
  const settings = GOBLINS.entrance;
  const out = [];
  const topLevel = Math.max(...fortress.modules.filter((m) => !m.building).map((m) => m.cell[1] + m.size[1] - 1));
  for (const step of frontier(controller)) {
    if (step.face === 'U' || step.face === 'D') continue;
    const fits = cellAllowed(world, controller, 'entrance', step.cell, 0);
    if (!fits || fits.cliff || fits.emerging) continue;
    const back = FACES[step.face].opposite;
    for (const wall of HORIZONTAL) {
      if (wall === back) continue;
      const base = cellOrigin(fortress, step.cell);
      const column = ladderSpot(base, wall);
      const top = surfaceHeight(world, column.x, column.z);
      if (top === NONE || top <= base.y + CELL_HEIGHT) continue;
      // The gatehouse around it, and the column itself, must be clear.
      const turns = turnsBack(wall);
      const [sx, sz] = [SURFACE_TEMPLATES.gatehouse.shaft.x, SURFACE_TEMPLATES.gatehouse.shaft.z];
      const [ox, oz] = turnLocal(sx, sz, turns);
      const bounds = templateBounds(SURFACE_TEMPLATES.gatehouse, column.x - ox, column.z - oz, turns);
      if (!clearSite(world, controller, bounds, settings.clearance)) continue;
      if (awayFrom.some((p) => Math.hypot(p.x - column.x, p.z - column.z) < GOBLINS.surface.radius)) continue;
      // Level, solid ground for the gatehouse: scored by how far the ground
      // strays from the shaft's top and how many hollows lie under it.
      let rough = 0, ok = true;
      for (let z = bounds.z0 - 1; z <= bounds.z1 + 1 && ok; z++) for (let x = bounds.x0 - 1; x <= bounds.x1 + 1; x++) {
        const h = surfaceHeight(world, x, z);
        if (h === NONE || Math.abs(h - top) > GOBLINS.surface.maxSlope + 1) { ok = false; break; }
        rough += Math.abs(h - top) + (solidBelow(world, x, h, z, settings.solidDepth) ? 0 : 2);
      }
      if (!ok) continue;
      // Hilltops make long climbs down to everything else.
      const island = centralIsland(world);
      if (island) rough += Math.max(0, top - island.surfaceY) * settings.heightWeight;
      out.push({ spec: { type: 'entrance', cell: step.cell, rotation: 0, ladderFace: wall, parent: step.parent },
        column, wall, top, level: step.cell[1], topLevel, rough });
    }
  }
  // The top level if possible, then the smoothest ground (within `roughSlack`).
  const level = out.some((c) => c.level === topLevel) ? out.filter((c) => c.level === topLevel) : out;
  const smoothest = Math.min(...level.map((c) => c.rough));
  return level.filter((c) => c.rough <= smoothest + settings.roughSlack);
}

// Reserves the cells a shaft column passes through, so no module is built there.
export function reserveShaftCells(controller, column, fromY, toY) {
  const fortress = controller.fortress;
  for (let y = fromY; y <= toY; y += 1) {
    const cell = [Math.floor((column.x - fortress.origin.x) / CELL_SIZE), Math.floor((y - fortress.origin.y) / CELL_HEIGHT),
      Math.floor((column.z - fortress.origin.z) / CELL_SIZE)];
    const key = cellKey(...cell);
    if (!(key in fortress.cells)) fortress.cells[key] = 'shaft';
  }
}

// The blocks of one shaft column: ladders from the base's floor up to the
// surface block, the lining around it where it isn't solid, and headroom
// above its top. `climb` on each tells goblins to stand on the column.
export function shaftColumnBlocks(world, column, wall, floorY, top, ceilingY, { lining = true } = {}) {
  const facing = FACES[wall].facing;
  const climb = { x: column.x, z: column.z, wall, floorY, topY: top };
  const blocks = [];
  for (let y = floorY; y <= top; y++) {
    blocks.push({ x: column.x, y, z: column.z, id: ladderBlock(facing), climb, column: true });
    if (!lining || y < ceilingY) continue;
    for (const face of HORIZONTAL) {
      const [dx, , dz] = FACES[face].dir;
      const x = column.x + dx, z = column.z + dz;
      blocks.push({ x, y, z, id: BLOCK.GOBLIN_BRICKS, climb, lining: true });
    }
  }
  for (let y = top + 1; y <= top + 2; y++) {
    if (world.getBlock(column.x, y, column.z) !== BLOCK.AIR) blocks.push({ x: column.x, y, z: column.z, id: BLOCK.AIR, climb });
  }
  return blocks;
}

// A three-wide relocation shaft: a clear 3×3 interior with one ladder column
// against its outer brick wall. The other eight cells remain open.
export function wideShaftBlocks(column, wall, floorY, top, ceilingY) {
  const facing = FACES[wall].facing;
  const [wx, , wz] = FACES[wall].dir;
  const along = wall === 'N' || wall === 'S' ? [1, 0] : [0, 1];
  const interior = new Set();
  for (let depth = 0; depth < 3; depth++) for (let side = -1; side <= 1; side++) {
    interior.add(blockKey(column.x - wx * depth + along[0] * side, 0,
      column.z - wz * depth + along[1] * side));
  }
  const climb = { x: column.x, z: column.z, wall, floorY, topY: top };
  const blocks = [];
  for (let y = floorY; y <= top; y++) {
    blocks.push({ x: column.x, y, z: column.z, id: ladderBlock(facing), climb, column: true });
    if (y < ceilingY) continue;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const x = column.x + dx, z = column.z + dz;
      const inside = interior.has(blockKey(x, 0, z));
      const adjacent = HORIZONTAL.some((face) => {
        const [fx, , fz] = FACES[face].dir;
        return interior.has(blockKey(x + fx, 0, z + fz));
      });
      if (!inside && !adjacent) continue;
      if (x === column.x && z === column.z) continue;
      blocks.push({ x, y, z, id: inside ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS, climb, lining: !inside });
    }
  }
  for (let y = top + 1; y <= top + 2; y++) for (const key of interior) {
    const [x, , z] = key.split(',').map(Number);
    blocks.push({ x, y, z, id: BLOCK.AIR, climb });
  }
  return blocks;
}

// Orders a shaft column's tasks bottom up, and holds each until the goblin
// can reach it from the ladders below.
export function wireShaftTasks(project, tasks, reach) {
  const ladders = new Map();
  for (const t of tasks) if (t.kind === 'place' && isLadder(t.id) && t.climb) ladders.set(`${t.x},${t.y},${t.z}`, t);
  for (const t of tasks) {
    if (!t.climb) continue;
    const { x, z, floorY } = t.climb;
    t.order = 10000 + (t.y - floorY) * 4 + (t.kind === 'dig' ? 0 : isLadder(t.id) ? 1 : 2) + t.order * 1e-6;
    // Standing on the ladder at y - 2 at most (eyes about a block above the
    // feet): the ladders up to that far below must be up.
    const below = [];
    for (let y = floorY; y <= t.y - Math.floor(reach - 1.5); y++) {
      const ladder = ladders.get(`${x},${y},${z}`);
      if (ladder) below.push(ladder);
    }
    if (isLadder(t.id) && t.kind === 'place') {
      const under = ladders.get(`${x},${t.y - 1},${z}`);
      if (under) below.push(under);
    }
    t.requires = [...t.requires, ...below];
  }
  project.sort();
}

// The surface shaft project: the shaft base module at a candidate spot and
// its column up to the surface. `onBreakthrough` runs when the last block
// to the sky is dug.
export function shaftProject(world, controller, candidate, label = 'Surface shaft') {
  const project = moduleProject(world, controller, candidate.spec, label);
  if (!project) return null;
  project.kind = 'shaft';
  const module = project.module;
  const { column, wall, top } = candidate;
  const blocks = candidate.width === GOBLINS.projects.relocationWidth
    ? wideShaftBlocks(column, wall, module.floorY, top, module.box.y1)
    : shaftColumnBlocks(world, column, wall, module.floorY, top, module.box.y1);
  const tasks = addBlockTasks(project, world, blocks, {});
  wireShaftTasks(project, tasks, GOBLINS.worker.reach);
  const surface = tasks.find((t) => t.kind === 'dig' && t.y === top && t.x === column.x && t.z === column.z);
  project.breakthroughTask = surface ?? null;
  reserveShaftCells(controller, column, module.box.y1 + 1, top + 2);
  project.entrance = { base: module, wall, columns: [{ ...column }], width: candidate.width ?? 1,
    floorY: module.floorY, topY: top };
  return project;
}

// ---- Surface buildings ----

// A template's blocks at `origin` (ground layer at origin.y), plus terrain
// flattening (natural ground above the ground layer is dug out) and
// foundations (anything open under the ground layer is filled down to the
// terrain).
function surfaceBlocks(world, template, origin, turns, skip = () => false) {
  const blocks = templateBlocks(template, origin, turns).filter((b) => !skip(b));
  const [, height] = templateSize(template);
  const bounds = templateBounds(template, origin.x, origin.z, turns);
  const byKey = new Map(blocks.map((b) => [blockKey(b.x, b.y, b.z), b]));
  const extra = [];
  const { clearMargin: margin, treeReach, treeHeight } = GOBLINS.surface;
  const clearBox = { x0: bounds.x0 - margin, x1: bounds.x1 + margin,
    z0: bounds.z0 - margin, z1: bounds.z1 + margin };
  // Remove whole natural trees when either their trunk or canopy enters the
  // site. The dig tasks yield logs to storage like other worker digging.
  for (let tz = clearBox.z0 - treeReach; tz <= clearBox.z1 + treeReach; tz++) {
    for (let tx = clearBox.x0 - treeReach; tx <= clearBox.x1 + treeReach; tx++) {
      const ground = surfaceHeight(world, tx, tz);
      if (ground === NONE || world.getBlock(tx, ground + 1, tz) !== BLOCK.WOOD) continue;
      let enters = tx >= clearBox.x0 && tx <= clearBox.x1 && tz >= clearBox.z0 && tz <= clearBox.z1;
      if (!enters) {
        for (let z = Math.max(clearBox.z0, tz - treeReach); z <= Math.min(clearBox.z1, tz + treeReach) && !enters; z++) {
          for (let x = Math.max(clearBox.x0, tx - treeReach); x <= Math.min(clearBox.x1, tx + treeReach) && !enters; x++) {
            for (let y = ground + 1; y <= ground + treeHeight; y++) {
              if (world.getBlock(x, y, z) === BLOCK.LEAVES) { enters = true; break; }
            }
          }
        }
      }
      if (!enters) continue;
      for (let y = ground + 1; y <= ground + treeHeight; y++) {
        if (world.getBlock(tx, y, tz) === BLOCK.WOOD) extra.push({ x: tx, y, z: tz, id: BLOCK.AIR });
        for (let z = tz - treeReach; z <= tz + treeReach; z++) for (let x = tx - treeReach; x <= tx + treeReach; x++) {
          if (world.getBlock(x, y, z) === BLOCK.LEAVES) extra.push({ x, y, z, id: BLOCK.AIR });
        }
      }
    }
  }
  // Level the entire construction area, including a margin around it.
  for (let z = clearBox.z0; z <= clearBox.z1; z++) for (let x = clearBox.x0; x <= clearBox.x1; x++) {
    if (skip({ x, y: origin.y, z })) continue;
    const ground = surfaceHeight(world, x, z);
    if (ground === NONE) continue;
    for (let y = origin.y + 1; y <= ground; y++) extra.push({ x, y, z, id: BLOCK.AIR });
    for (let y = ground + 1; y <= origin.y; y++) extra.push({ x, y, z, id: y === origin.y ? BLOCK.GRASS : BLOCK.DIRT, ground: true });
  }
  for (let z = bounds.z0; z <= bounds.z1; z++) for (let x = bounds.x0; x <= bounds.x1; x++) {
    if (skip({ x, y: origin.y, z })) continue;
    for (let y = origin.y + 1; y <= origin.y + height + GOBLINS.surface.maxSlope; y++) {
      if (byKey.has(blockKey(x, y, z))) continue;
      if (isGround(world.getBlock(x, y, z))) extra.push({ x, y, z, id: BLOCK.AIR });
    }
    const groundCell = byKey.get(blockKey(x, origin.y, z));
    if (!groundCell) continue;
    for (let y = origin.y - 1; y > origin.y - 8 && !isSolid(world.getBlock(x, y, z)); y--) {
      extra.push({ x, y, z, id: template.foundationBlock ?? BLOCK.STONE, foundation: true });
    }
  }
  // A way out of the door: headroom dug, ground under it.
  if (template.door !== undefined) {
    for (let d = 1; d <= DOOR_PATH; d++) for (let side = -1; side <= 1; side++) {
      const [dx, dz] = turnLocal(template.door + side, templateSize(template)[2] - 1 + d, turns);
      const x = origin.x + dx, z = origin.z + dz;
      if (byKey.has(blockKey(x, origin.y + 1, z))) continue;
      if (!isSolid(world.getBlock(x, origin.y, z))) extra.push({ x, y: origin.y, z, id: BLOCK.GRASS, ground: true });
      for (let y = origin.y + 1; y <= origin.y + 3; y++) {
        if (isSolid(world.getBlock(x, y, z))) extra.push({ x, y, z, id: BLOCK.AIR });
      }
    }
  }
  return [...new Map([...extra, ...blocks].map((b) => [blockKey(b.x, b.y, b.z), b])).values()];
}

// Orders surface tasks: clearing and foundations first (bottom up), then
// the building from the ground up.
function surfaceOrder(originY) {
  return (b) => (b.id === BLOCK.AIR ? 0 : b.foundation ? 1000 + b.y : 2000 + (b.y - originY) * 100) + (b.sapling ? 50 : 0);
}

// Picks a spot within GOBLINS.surface.radius of an entrance for a template:
// in the island, clear, and level enough. Returns { origin, turns, bounds } or null.
export function chooseSurfaceSite(world, controller, template, random) {
  const settings = GOBLINS.surface;
  const entrances = controller.entrances.filter((e) => e.gatehouse);
  if (!entrances.length) return null;
  const [sx, sy, sz] = templateSize(template);
  for (let attempt = 0; attempt < settings.attempts; attempt++) {
    const entrance = entrances[Math.floor(random() * entrances.length)];
    const exit = entrance.outside;
    const angle = random() * Math.PI * 2;
    const distance = 6 + Math.max(sx, sz) / 2 + random() * (settings.radius - 6 - Math.max(sx, sz) / 2);
    const cx = Math.round(exit.x + Math.cos(angle) * distance), cz = Math.round(exit.z + Math.sin(angle) * distance);
    const turns = turnsFront(exit.x - cx, exit.z - cz);
    // Local (0, 0) such that the template's middle lands at (cx, cz).
    const [mx, mz] = turnLocal(Math.floor(sx / 2), Math.floor(sz / 2), turns);
    const ox = cx - mx, oz = cz - mz;
    const bounds = templateBounds(template, ox, oz, turns);
    if (!clearSite(world, controller, bounds, settings.clearance)) continue;
    const heights = [];
    let ok = true, hollow = 0;
    for (let z = bounds.z0 - 1; z <= bounds.z1 + 1 && ok; z++) for (let x = bounds.x0 - 1; x <= bounds.x1 + 1; x++) {
      const h = surfaceHeight(world, x, z);
      if (h === NONE || world.getBlock(x, h + 1, z) === BLOCK.WATER) { ok = false; break; }
      heights.push(h);
      if (!solidBelow(world, x, h, z, settings.solidDepth)) hollow++;
    }
    // Solid ground under (nearly) all of it, a block around included.
    if (!ok || hollow > heights.length * (template.plot ? settings.plotHollowShare : settings.hollowShare)) continue;
    heights.sort((a, b) => a - b);
    if (heights.at(-1) - heights[0] > (template.plot ? settings.plotMaxSlope : settings.maxSlope)) continue;
    const ground = heights[Math.floor(heights.length / 2)];
    const island = centralIsland(world);
    if (island && Math.hypot(cx - island.x, cz - island.z)
      < island.radius * settings.innerRadiusFraction) continue;
    return { origin: { x: ox, y: ground, z: oz }, turns, bounds: { ...bounds, y0: ground - 2, y1: ground + sy + 1 }, entrance };
  }
  return null;
}

// A surface building project (dwelling, tree plot or gatehouse) from a
// template at a chosen site.
export function surfaceProject(world, controller, kind, templateName, template, site, { skip } = {}) {
  const project = new Project(kind, template.label);
  const blocks = surfaceBlocks(world, template, site.origin, site.turns, skip);
  // A plot's trees may grow while it's being built.
  if (template.plot) for (const b of blocks) b.grows = true;
  // Blocks high up a building with a ladder (a lookout's platform) are
  // placed from the ladder.
  const ladders = blocks.filter((b) => isLadder(b.id));
  if (ladders.length) {
    const low = ladders.reduce((a, b) => (b.y < a.y ? b : a));
    const climb = { x: low.x, z: low.z, wall: HORIZONTAL[ladderFacing(low.id)], floorY: low.y,
      topY: Math.max(...ladders.map((b) => b.y)) };
    for (const b of blocks) {
      if (b.y >= low.y + 3 && Math.max(Math.abs(b.x - low.x), Math.abs(b.z - low.z)) <= 3) b.climb = climb;
    }
  }
  addBlockTasks(project, world, blocks, { order: surfaceOrder(site.origin.y) });
  project.sort();
  const bounds = site.bounds;
  project.surface = true;
  project.building = {
    kind, template: templateName, capacity: template.capacity ?? 0, box: bounds, origin: site.origin, turns: site.turns,
    blocks: blocks.filter((b) => b.id !== BLOCK.AIR || !isGround(world.getBlock(b.x, b.y, b.z))),
    saplings: blocks.filter((b) => b.sapling).map(({ x, y, z }) => ({ x, y, z })),
    ladder: (() => {
      const ladders = blocks.filter((b) => isLadder(b.id));
      if (!ladders.length) return null;
      const low = ladders.reduce((a, b) => (b.y < a.y ? b : a));
      return { x: low.x, z: low.z, floorY: low.y, topY: Math.max(...ladders.map((b) => b.y)),
        wall: HORIZONTAL[ladderFacing(low.id)] };
    })(),
    post: template.post ? (() => {
      const [px, pz] = turnLocal(template.post[0], template.post[2], site.turns);
      return { x: site.origin.x + px + 0.5, y: site.origin.y + template.post[1], z: site.origin.z + pz + 0.5 };
    })() : null,
    front: (() => {
      const [sx, , sz] = templateSize(template);
      const [fx, fz] = turnLocal(Math.floor(sx / 2), sz + 1, site.turns);
      return { x: site.origin.x + fx + 0.5, y: site.origin.y + 1, z: site.origin.z + fz + 0.5 };
    })(),
  };
  project.site = project.building.front;
  controller.reserveSurface(project.building.box);
  return project;
}

// A dwelling project: a weighted pick of template, at a site near an entrance.
export function dwellingProject(world, controller, random) {
  let total = Object.values(DWELLINGS).reduce((a, b) => a + b, 0);
  const names = Object.keys(DWELLINGS).sort(() => random() - 0.5);
  let roll = random() * total;
  const first = names.find((name) => (roll -= DWELLINGS[name]) < 0) ?? names[0];
  for (const name of [first, ...names.filter((n) => n !== first)]) {
    const template = SURFACE_TEMPLATES[name];
    const site = chooseSurfaceSite(world, controller, template, random);
    if (site) return surfaceProject(world, controller, 'dwelling', name, template, site);
  }
  return null;
}

export function plotProject(world, controller, random) {
  const template = plotTemplate(GOBLINS.plots);
  const site = chooseSurfaceSite(world, controller, template, random);
  return site ? surfaceProject(world, controller, 'plot', 'plot', template, site) : null;
}

// The gatehouse around an entrance's top: the template turned so its back
// wall holds the ladders, its shaft spot on the entrance's first column.
export function gatehouseProject(world, controller, entrance) {
  const template = SURFACE_TEMPLATES.gatehouse;
  const turns = turnsBack(entrance.wall);
  const [sx, sz] = turnLocal(template.shaft.x, template.shaft.z, turns);
  const column = entrance.columns[0];
  const origin = { x: column.x - sx, y: entrance.topY, z: column.z - sz };
  const bounds = { ...templateBounds(template, origin.x, origin.z, turns), y0: origin.y - 2, y1: origin.y + templateSize(template)[1] };
  // Shaft columns keep their ladders (the widened ones' spots too).
  const [ax, az] = turnLocal(template.shaft.x - 1, template.shaft.z, turns);
  const [bx, bz] = turnLocal(template.shaft.x + 1, template.shaft.z, turns);
  const spots = [{ x: column.x, z: column.z }, { x: origin.x + ax, z: origin.z + az }, { x: origin.x + bx, z: origin.z + bz }];
  if (entrance.width === GOBLINS.projects.relocationWidth) {
    for (let dz = 1; dz <= 2; dz++) for (let dx = -1; dx <= 1; dx++) {
      const [sx, sz] = turnLocal(template.shaft.x + dx, template.shaft.z + dz, turns);
      spots.push({ x: origin.x + sx, z: origin.z + sz });
    }
  }
  const skip = (b) => spots.some((s) => s.x === b.x && s.z === b.z) && b.y <= origin.y;
  const project = surfaceProject(world, controller, 'gatehouse', 'gatehouse', template, { origin, turns, bounds }, { skip });
  project.label = 'Shaft gatehouse';
  return project;
}

// Where goblins step off the top of an entrance's column, and the spot
// outside its gatehouse door.
export function entrancePoints(entrance) {
  const [fx, , fz] = FACES[FACES[entrance.wall].opposite].dir;
  const column = entrance.columns[0];
  const top = { x: column.x + 0.5, y: entrance.topY + 1, z: column.z + 0.5 };
  return {
    top,
    step: { x: top.x + fx * 1.2, y: top.y, z: top.z + fz * 1.2 },
    outside: { x: top.x + fx * 5, y: top.y, z: top.z + fz * 5 },
  };
}

// A three-block-high brick enclosure around a group of existing buildings.
// The perimeter is levelled and cleared before construction; its two-wide
// gates stay open for goblin routes. Raised posts use ladders on the inside.
export function wallProject(world, controller, buildings, outer = false) {
  if (!buildings.length) return null;
  const settings = GOBLINS.walls;
  const margin = outer ? settings.outerMargin : settings.sectionMargin;
  const x0 = Math.min(...buildings.map((b) => b.box.x0)) - margin;
  const x1 = Math.max(...buildings.map((b) => b.box.x1)) + margin;
  const z0 = Math.min(...buildings.map((b) => b.box.z0)) - margin;
  const z1 = Math.max(...buildings.map((b) => b.box.z1)) + margin;
  const heights = buildings.map((b) => b.origin.y).sort((a, b) => a - b);
  const y0 = heights[Math.floor(heights.length / 2)];
  if (x0 < 1 || z0 < 1 || x1 >= world.sizeX - 1 || z1 >= world.sizeZ - 1) return null;
  const centerX = (x0 + x1) / 2, centerZ = (z0 + z1) / 2;
  const toward = controller.entrances[0]?.outside ?? { x: centerX, z: z0 - 1 };
  const side = Math.abs(toward.x - centerX) > Math.abs(toward.z - centerZ)
    ? toward.x < centerX ? 'W' : 'E' : toward.z < centerZ ? 'N' : 'S';
  const gates = new Set();
  const addGate = (face) => {
    if (face === 'N' || face === 'S') {
      const z = face === 'N' ? z0 : z1, x = Math.floor(centerX);
      for (let i = 0; i < settings.gateWidth; i++) gates.add(`${x + i},${z}`);
    } else {
      const x = face === 'W' ? x0 : x1, z = Math.floor(centerZ);
      for (let i = 0; i < settings.gateWidth; i++) gates.add(`${x},${z + i}`);
    }
  };
  addGate(side);
  if (outer) addGate(FACES[side].opposite);
  const perimeter = new Set();
  if (outer) {
    // A contour follows the spread-out base without extending the corners of
    // one enormous rectangle beyond the island's edge.
    const points = buildings.flatMap(({ box }) => [
      [box.x0 - margin, box.z0 - margin], [box.x0 - margin, box.z1 + margin],
      [box.x1 + margin, box.z0 - margin], [box.x1 + margin, box.z1 + margin],
    ]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const lower = [], upper = [];
    for (const p of points) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
    for (const p of [...points].reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    for (let i = 0; i < hull.length; i++) {
      const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      for (let step = 0; step <= steps; step++) perimeter.add(`${Math.round(ax + (bx - ax) * step / steps)},${Math.round(az + (bz - az) * step / steps)}`);
    }
  } else {
    for (let x = x0; x <= x1; x++) { perimeter.add(`${x},${z0}`); perimeter.add(`${x},${z1}`); }
    for (let z = z0; z <= z1; z++) { perimeter.add(`${x0},${z}`); perimeter.add(`${x1},${z}`); }
  }
  const wallHeights = new Map();
  for (const key of perimeter) {
    const [x, z] = key.split(',').map(Number);
    const ground = surfaceHeight(world, x, z);
    if (ground === NONE && !outer) return null;
    if (!outer && Math.abs(ground - y0) > settings.maxFlatten) return null;
    if (!outer && world.riverColumns?.has(key)) return null;
    if (!outer && controller.wallFootprints.has(key)) return null;
    if (world.keeps.some((keep) => Math.abs(x - keep.cx) <= KEEP_REACH && Math.abs(z - keep.cz) <= KEEP_REACH)) return null;
    if (world.structures.some(({ box }) => box && y0 >= box.y0 && y0 <= box.y1
      && x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1)) return null;
    if (controller.buildings.some((b) => b.box && (!outer || (b.kind !== 'wall' && b.kind !== 'wallPost'))
      && x >= b.box.x0 && x <= b.box.x1 && z >= b.box.z0 && z <= b.box.z1)) return null;
    const river = outer && world.riverColumns?.has(key);
    const naturalTop = world.naturalTop[x + world.sizeX * z];
    wallHeights.set(key, river ? Math.max(y0, naturalTop + settings.riverClearance)
      : outer && ground !== NONE ? ground : y0);
  }
  if (outer) {
    gates.clear();
    const pairs = [];
    for (const key of perimeter) {
      const [x, z] = key.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const other = `${x + dx},${z + dz}`;
        if (!perimeter.has(other) || surfaceHeight(world, x, z) === NONE
          || surfaceHeight(world, x + dx, z + dz) === NONE
          || Math.abs(wallHeights.get(key) - wallHeights.get(other)) > 1) continue;
        pairs.push({ keys: [key, other], x: x + dx / 2, z: z + dz / 2 });
      }
    }
    pairs.sort((a, b) => Math.hypot(a.x - toward.x, a.z - toward.z)
      - Math.hypot(b.x - toward.x, b.z - toward.z));
    if (!pairs.length) return null;
    for (const key of pairs[0].keys) gates.add(key);
    const opposite = [...pairs].sort((a, b) => Math.hypot(b.x - pairs[0].x, b.z - pairs[0].z)
      - Math.hypot(a.x - pairs[0].x, a.z - pairs[0].z))[0];
    for (const key of opposite.keys) gates.add(key);
  }
  const desired = new Map();
  const put = (b) => desired.set(blockKey(b.x, b.y, b.z), b);
  const clear = new Map();
  for (const key of perimeter) {
    const [x, z] = key.split(',').map(Number);
    for (let dz = -settings.clearMargin; dz <= settings.clearMargin; dz++) {
      for (let dx = -settings.clearMargin; dx <= settings.clearMargin; dx++) {
        const cell = `${x + dx},${z + dz}`;
        const old = clear.get(cell);
        if (!old || dx * dx + dz * dz < old.distance) clear.set(cell,
          { y: wallHeights.get(key), distance: dx * dx + dz * dz });
      }
    }
  }
  for (const [key, target] of clear) {
    const [x, z] = key.split(',').map(Number);
    if (controller.buildings.some((b) => b.box && x >= b.box.x0 && x <= b.box.x1 && z >= b.box.z0 && z <= b.box.z1)) continue;
    const ground = surfaceHeight(world, x, z);
    if (ground === NONE) continue;
    if (outer && Math.abs(ground - target.y) > settings.outerLocalFlatten) continue;
    for (let y = target.y + 1; y <= ground; y++) put({ x, y, z, id: BLOCK.AIR });
    for (let y = ground + 1; y <= target.y; y++) put({ x, y, z, id: y === target.y ? BLOCK.GRASS : BLOCK.DIRT, ground: true });
  }
  // Whole natural trees touched by the clearing strip are removed.
  const reach = GOBLINS.surface.treeReach;
  for (let tz = z0 - settings.clearMargin - reach; tz <= z1 + settings.clearMargin + reach; tz++) {
    for (let tx = x0 - settings.clearMargin - reach; tx <= x1 + settings.clearMargin + reach; tx++) {
      const ground = surfaceHeight(world, tx, tz);
      if (ground === NONE || world.getBlock(tx, ground + 1, tz) !== BLOCK.WOOD) continue;
      let touched = clear.has(`${tx},${tz}`);
      for (let dz = -reach; dz <= reach && !touched; dz++) for (let dx = -reach; dx <= reach && !touched; dx++) {
        if (!clear.has(`${tx + dx},${tz + dz}`)) continue;
        for (let y = ground + 1; y <= ground + GOBLINS.surface.treeHeight; y++) {
          if (world.getBlock(tx + dx, y, tz + dz) === BLOCK.LEAVES) { touched = true; break; }
        }
      }
      if (!touched) continue;
      for (let y = ground + 1; y <= ground + GOBLINS.surface.treeHeight; y++) {
        if (world.getBlock(tx, y, tz) === BLOCK.WOOD) put({ x: tx, y, z: tz, id: BLOCK.AIR });
        for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
          const x = tx + dx, z = tz + dz;
          if (world.getBlock(x, y, z) === BLOCK.LEAVES) put({ x, y, z, id: BLOCK.AIR });
        }
      }
    }
  }
  for (const key of perimeter) {
    const [x, z] = key.split(',').map(Number);
    const baseY = wallHeights.get(key);
    put({ x, y: baseY, z, id: BLOCK.GOBLIN_BRICKS });
    for (let h = 1; h <= settings.height; h++) put({ x, y: baseY + h, z,
      id: gates.has(key) ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS });
  }
  const posts = [];
  const postSites = outer ? [...perimeter].flatMap((key) => {
    if (gates.has(key)) return [];
    const [x, z] = key.split(',').map(Number);
    if (!perimeter.has(`${x - 1},${z}`) || !perimeter.has(`${x + 1},${z}`)) return [];
    const inward = z < centerZ ? 1 : -1;
    if (perimeter.has(`${x},${z + inward}`)) return [];
    return [{ x, z: z + inward, wall: inward > 0 ? 'N' : 'S', baseY: wallHeights.get(key) }];
  }) : [{ x: x0 + 3, z: z0 + 1, wall: 'N', baseY: y0 }];
  const selected = outer && postSites.length > 1
    ? [postSites[0], [...postSites].sort((a, b) => Math.hypot(b.x - postSites[0].x, b.z - postSites[0].z)
      - Math.hypot(a.x - postSites[0].x, a.z - postSites[0].z))[0]] : postSites.slice(0, 1);
  for (const { x: px, z: lz, wall, baseY } of selected) {
    const climb = { x: px, z: lz, wall, floorY: baseY + 1, topY: baseY + settings.postHeight };
    for (let h = 1; h <= settings.postHeight; h++) put({ x: px, y: baseY + h, z: lz,
      id: ladderBlock(FACES[wall].facing), climb });
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      put({ x: px + dx, y: baseY + settings.postHeight, z: lz + dz,
        id: BLOCK.GOBLIN_BRICKS, climb });
    }
    posts.push({ post: { x: px + 0.5, y: baseY + settings.postHeight + 1, z: lz + 0.5 },
      ladder: climb });
  }
  const project = new Project('wall', outer ? 'Outer base wall' : 'Base section wall');
  addBlockTasks(project, world, [...desired.values()], { order: (b) => b.id === BLOCK.AIR ? 0
    : b.ground ? 1000 + b.y : isLadder(b.id) ? 4000 + b.y : 2000 + b.y });
  wireShaftTasks(project, project.tasks.filter((t) => t.climb), GOBLINS.worker.reach);
  project.sort();
  project.surface = true;
  project.site = { x: centerX, y: y0 + 1, z: centerZ, surface: true };
  project.building = { kind: 'wall', template: outer ? 'outerWall' : 'sectionWall',
    box: { x0, x1, z0, z1, y0, y1: y0 + settings.postHeight + 1 }, origin: { x: x0, y: y0, z: z0 },
    front: project.site, blocks: [...desired.values()], footprint: perimeter, posts, intact: false };
  return project;
}
