// Goblin projects: what the fortress builds, as ordered lists of block
// tasks. A task digs or places a block (both are done by workers).
// Planners here pick sites and turn intended blocks into tasks; the
// controller (goblins.js) chooses which
// project runs, goblins (goblin.js) claim and do its tasks, and offscreen
// mode (goblinOffscreen.js) applies them at estimated rates.
//
// Task: { key, x, y, z, kind: 'dig' | 'place', id (placed id, or AIR for a
// dig), material (timing category, never counted or spent), order, requires ([task] done first),
// climb (a shaft column to stand on while doing it), done, claimedBy,
// attempts, blockedUntil }.

import { BLOCK, getBlockDef, isSolid, isWater, isLadder, ladderBlock, ladderFacing } from '../shared/blocks.js';
import { TICK_RATE } from '../shared/config.js';
import { GOBLINS, goblinCap } from '../shared/goblins.js';
import {
  CELL_SIZE, CELL_HEIGHT, FACES, HORIZONTAL, MODULE_TYPES, SURFACE_TEMPLATES, DWELLINGS,
  cellKey, stepCell, cellOrigin, footprint, footprintCells, canAddModule, opens,
  registerModule, moduleBlocks, planAutoConnect, registerConnection, ladderSpot, rotateFace, materialOf,
  plotTemplate, templateBlocks, DOOR_PATH, templateBounds, templateSize, turnLocal, turnsFront, turnsBack,
} from '../shared/goblinModules.js';
import { KEEP_REACH } from '../shared/structures.js';
import { findPath, canStand } from './pathfind.js';
import { Chest } from './containers.js';

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
    return this.tasks.length ? this.tasks.reduce((count, task) => count + (task.done || task.simDone ? 1 : 0), 0) / this.tasks.length : 1;
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
    if (b.ground && (isGround(current) || current===BLOCK.GOBLIN_BRICKS)) {b.id=current;continue;}
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
export function islandTerrainHeight(world,island,x,z) {
  const terrain=world.mainTerrains?.find(t=>t.index===world.islands.indexOf(island));
  if(!terrain)return world.naturalTop[x+world.sizeX*z];
  if(x<terrain.x0 || z<terrain.z0 || x>=terrain.x0+terrain.width || z>=terrain.z0+terrain.width)return NONE;
  return terrain.top[x-terrain.x0+terrain.width*(z-terrain.z0)];
}

export function centralTerrainHeight(world,x,z) {
  const terrain=world.centralTerrain;
  if(!terrain)return world.naturalTop[x+world.sizeX*z];
  if(x<terrain.x0 || z<terrain.z0 || x>=terrain.x0+terrain.width || z>=terrain.z0+terrain.width)return NONE;
  return terrain.top[x-terrain.x0+terrain.width*(z-terrain.z0)];
}

export function surfaceHeight(world, x, z) {
  if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return NONE;
  const natural = centralTerrainHeight(world,x,z);
  if (natural === NONE) return NONE;
  const start=world.centralTerrain?natural:Math.min(world.sizeY-1,natural+GOBLINS.walls.terrainRise);
  for (let y = start; y >= Math.max(world.minY,natural-GOBLINS.walls.foundationDepth); y--) {
    const id = world.getBlock(x,y,z);
    if(id===BLOCK.WATER)return NONE;
    if(isGround(id) || id===BLOCK.GOBLIN_BRICKS) {
      while(y<world.sizeY-1 && (isGround(world.getBlock(x,y+1,z)) || world.getBlock(x,y+1,z)===BLOCK.GOBLIN_BRICKS))y++;
      return y;
    }
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
export function clearSite(world, controller, box, margin, goblinMargin = margin) {
  for (let z = box.z0 - goblinMargin; z <= box.z1 + goblinMargin; z++) {
    for (let x = box.x0 - goblinMargin; x <= box.x1 + goblinMargin; x++) {
      if (controller.wallFootprints?.has(`${x},${z}`)
        && (box.y1 === undefined || box.y1 + margin >= surfaceHeight(world, x, z))) return false;
    }
  }
  for (const keep of world.keeps) {
    if (box.x0 - margin <= keep.cx + KEEP_REACH && box.x1 + margin >= keep.cx - KEEP_REACH
      && box.z0 - margin <= keep.cz + KEEP_REACH && box.z1 + margin >= keep.cz - KEEP_REACH
      && (box.y1 === undefined || box.y1 + margin >= keep.floorY - 3)) return false;
  }
  for (const s of world.structures) {
    if (!s.box || s.kind === 'goblinFortress') continue;
    const b = s.box;
    if (box.x0 - margin <= b.x1 && box.x1 + margin >= b.x0 && box.z0 - margin <= b.z1 && box.z1 + margin >= b.z0
      && (box.y0 === undefined || (box.y0 - margin <= b.y1 && box.y1 + margin >= b.y0))) return false;
  }
  if (world.riverColumns?.size) {
    for (let z = box.z0 - margin; z <= box.z1 + margin; z++) {
      for (let x = box.x0 - margin; x <= box.x1 + margin; x++) if (world.riverColumns.has(`${x},${z}`)
        && (box.y1 === undefined || box.y1 + margin >= world.naturalTop[x + world.sizeX * z] - 3)) return false;
    }
  }
  for (const other of controller.surfaceBoxes()) {
    if (box.x0 - goblinMargin <= other.x1 && box.x1 + goblinMargin >= other.x0
      && box.z0 - goblinMargin <= other.z1 && box.z1 + goblinMargin >= other.z0
      && (box.y0 === undefined || other.y0 === undefined || (box.y0 - margin <= other.y1 && box.y1 + margin >= other.y0))) return false;
  }
  // Keep the walk out of an existing building's doorway free for later
  // dwellings and plots as the village grows.
  for (const building of controller.buildings) {
    if (!building.access) continue;
    if (building.access.some(({ x, z }) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1)) return false;
  }
  for (const reserve of controller.surfaceBoxes()) {
    if (reserve.access?.some(({ x, z }) => x >= box.x0 && x <= box.x1
      && z >= box.z0 && z <= box.z1)) return false;
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
  const island = centralIsland(world);
  let outside = 0, unsupported = 0, columns = 0, minTop = Infinity, emerging = false;
  for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) {
    columns++;
    if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return null;
    const index = x + world.sizeX * z;
    const top = world.naturalTop[index], bottom = world.naturalBottom[index];
    if (top === NONE) { outside++; continue; }
    // Never dig out through the island's underside.
    if (bottom > box.y0 - settings.underside) {
      if (!island || Math.hypot(x - island.x, z - island.z)
        < island.radius * settings.cliffSupportStartFraction) return null;
      unsupported++;
    }
    minTop = Math.min(minTop, top);
    if (box.y1 > top) emerging = true;
  }
  // A connected spur may stand fully beyond the cliff face. Its brick shell
  // and one terminal room close the route; the parent connection supports it.
  // Rising out of the ground: its floor must rest on the terrain.
  if (emerging && box.y0 > minTop + settings.emergeFloor) return null;
  return { cliff: outside > 0, fullyOutside: outside === columns, emerging, unsupported };
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
  if (terrain.unsupported && !['room', 'hallway', 'corner'].includes(type)) return why('cliffSupport');
  if (terrain.fullyOutside && !['room', 'hallway', 'corner'].includes(type)) return why('terrain');
  if (type === 'ladderShaft' && !HORIZONTAL.some((wall) => {
    const spot = ladderSpot({ x: box.x0, y: box.y0, z: box.z0 }, wall);
    return surfaceHeight(world, spot.x, spot.z) !== NONE;
  })) return why('shaftVoid');
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
    // A cliff spur may have one hall and one terminal room. Once its hall
    // has a child, no other opening may grow from it.
    if (m.cliffChain === 1 && fortress.connections.some((c) =>
      (c.a === m.id || c.b === m.id) && c.a !== m.cliffParentId && c.b !== m.cliffParentId)) continue;
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
  const upperEntranceReady = controller.relocationReserve?.spec.parent.floorY >= controller.hall.floorY
    + GOBLINS.projects.relocationMinLevels * CELL_HEIGHT;
  const seekUpperRoute = !upperEntranceReady && controller.brickModules() >= settings.upperRouteStartModules;
  if (seekUpperRoute && ladders) weights.ladderShaft = settings.upperShaftWeight;
  const cliffRoots = controller.fortress.modules.filter((m) => m.cliffChain === 1).length;
  const seekCliff = upperEntranceReady
    && controller.brickModules() >= goblinCap(GOBLINS.caps.modules, controller.worldSize) * settings.cliffSeekStartShare
    && cliffRoots < goblinCap(settings.cliffRoomGoal, controller.worldSize);
  if (upperEntranceReady) delete weights.ladderShaft;
  // Shafts need planks for their ladders.
  if (!ladders) delete weights.ladderShaft;
  let best = null;
  for (const step of frontier(controller)) {
    if (controller.relocationReserve?.spec.cell.every((value, index) => value === step.cell[index])) continue;
    const vertical = step.face === 'U' || step.face === 'D';
    if (vertical && (!ladders || step.parent.cliffChain || random() > settings.verticalChance)) continue;
    const back = FACES[step.face].opposite;
    const options = [];
    if (step.parent.cliffChain === 1) options.push({ type: 'room', rotation: 0, weight: 1 });
    else if (vertical) options.push({ type: 'ladderShaft', rotation: 0, weight: 1 });
    else {
      for (const [type, weight] of Object.entries(weights)) {
        for (const rotation of rotationsOpening(type, back)) options.push({ type, rotation, weight });
      }
    }
    // A weighted pick of a type that fits.
    let total = options.reduce((sum, o) => sum + o.weight, 0);
    let pick = null;
    while (options.length && !pick) {
      let roll = random() * total;
      const index = Math.max(0, options.findIndex((o) => (roll -= o.weight) < 0));
      const option = options.splice(index, 1)[0];
      total -= option.weight;
      const fits = cellAllowed(world, controller, option.type, step.cell, option.rotation);
      if (fits) pick = { ...option, fits };
    }
    if (!pick) continue;
    if (seekCliff && !vertical && !step.parent.cliffChain && island) {
      const hallFits = cellAllowed(world, controller, 'hallway', step.cell,
        rotationsOpening('hallway', back)[0]);
      const cx = (hallFits?.box.x0 + hallFits?.box.x1 + 1) / 2;
      const cz = (hallFits?.box.z0 + hallFits?.box.z1 + 1) / 2;
      if (hallFits && Math.hypot(cx - island.x, cz - island.z)
        > Math.hypot(step.parent.center.x - island.x, step.parent.center.z - island.z)) {
        pick = { type: 'hallway', rotation: rotationsOpening('hallway', back)[0], fits: hallFits, seeking: true };
      }
    }
    // Rooms and corridor ends may emerge from the cliff, but remain sealed
    // terminal modules so they never open into empty space.
    if (pick.fits.cliff && !step.parent.cliffChain) {
      if (cliffRoots >= goblinCap(settings.cliffRoomGoal, controller.worldSize)) continue;
      if (vertical || random() > settings.cliffChance) continue;
      if (!['room', 'hallway', 'corner'].includes(pick.type)) {
        const fits = cellAllowed(world, controller, 'room', step.cell, 0);
        if (!fits) continue;
        pick = { type: 'room', rotation: 0, fits };
      }
    }
    const box = pick.fits.box;
    let score = random() * settings.jitter;
    if (pick.seeking) score += settings.cliffSeekBonus;
    if (step.parent.cliffChain === 1) score += settings.cliffFinishBonus;
    if (vertical) score += upperEntranceReady ? settings.verticalAfterEntranceBonus
      : seekUpperRoute ? settings.upperVerticalBonus : settings.verticalBonus;
    if (pick.fits.cliff && controller.fortress.modules.filter((m) => m.cliffChain === 1).length
      < goblinCap(settings.cliffRoomGoal, controller.worldSize)) score += settings.cliffBonus;
    if (island) {
      const cx = (box.x0 + box.x1 + 1) / 2, cz = (box.z0 + box.z1 + 1) / 2;
      const r = Math.hypot(cx - island.x, cz - island.z);
      let wrap = Math.abs(Math.atan2(cz - island.z, cx - island.x) - place.angle) % (Math.PI * 2);
      if (wrap > Math.PI) wrap = Math.PI * 2 - wrap;
      score += settings.wrapWeight * wrap / Math.PI * 4
        - settings.radialWeight * Math.abs(r - place.distance) / CELL_SIZE
        + settings.outwardWeight * r / CELL_SIZE;
    }
    if (!best || score > best.score) {
      best = { score, type: pick.type, cell: step.cell, rotation: pick.rotation, parent: step.parent,
        ladderFace: vertical ? step.parent.ladderFace : null, cliff: pick.fits.cliff,
        cliffChain: step.parent.cliffChain ? 2 : pick.fits.cliff ? 1 : 0, face: step.face };
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
  if (spec.cliffChain) {
    module.cliffChain = spec.cliffChain;
    module.cliffParentId = spec.parent?.id;
    module.noGrow = spec.cliffChain === 2 || module.type !== 'hallway';
  }
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
    if (module.feature?.kind === 'stores' || module.feature?.kind === 'armory') {
      const { x0, y0, z0 } = module.box;
      const key = blockKey(x0 + 1, y0 + 1, z0 + 1);
      const table = module.feature.kind === 'armory' ? 'dungeonCentral' : 'houseCentral';
      world.lootChests.set(key, table);
      world.tileEntities.set(key, new Chest(table));
    }
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
export function shaftCandidates(world, controller, { awayFrom = [], allowRough = false,
  allLevels = false, allowExisting = false } = {}) {
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
        if (h === NONE) { ok = false; break; }
        if (!allowRough && Math.abs(h - top) > GOBLINS.surface.maxSlope + 1) { ok = false; break; }
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
  if (allowExisting) for (const module of fortress.modules) {
    if (module.building || module.removed || module.cliffChain || module.floorY < controller.hall.floorY + CELL_HEIGHT
      || !['room', 'shaft'].includes(MODULE_TYPES[module.type].shape)) continue;
    const base = cellOrigin(fortress, module.cell);
    for (const wall of HORIZONTAL) {
      const column = ladderSpot(base, wall), top = surfaceHeight(world, column.x, column.z);
      if (top === NONE || top <= module.box.y1 + 1) continue;
      const turns = turnsBack(wall);
      const [ox, oz] = turnLocal(SURFACE_TEMPLATES.gatehouse.shaft.x,
        SURFACE_TEMPLATES.gatehouse.shaft.z, turns);
      const bounds = templateBounds(SURFACE_TEMPLATES.gatehouse, column.x - ox, column.z - oz, turns);
      if (!clearSite(world, controller, bounds, settings.clearance)) continue;
      let blocked = false, rough = 0;
      for (let y = module.box.y1 + 1; y <= top && !blocked; y += CELL_HEIGHT) {
        const cell = [Math.floor((column.x - fortress.origin.x) / CELL_SIZE),
          Math.floor((y - fortress.origin.y) / CELL_HEIGHT),
          Math.floor((column.z - fortress.origin.z) / CELL_SIZE)];
        if (fortress.cells[cellKey(...cell)] !== undefined) blocked = true;
      }
      if (blocked) continue;
      for (let z = bounds.z0 - 1; z <= bounds.z1 + 1 && !blocked; z++)
        for (let x = bounds.x0 - 1; x <= bounds.x1 + 1; x++) {
          const h = surfaceHeight(world, x, z);
          if (h === NONE || !allowRough && Math.abs(h - top) > GOBLINS.surface.maxSlope + 1) {
            blocked = true; break;
          }
          rough += Math.abs(h - top);
        }
      if (blocked) continue;
      out.push({ spec: { type: 'entrance', cell: module.cell, rotation: 0, ladderFace: wall,
        parent: module, existingBase: module }, column, wall, top, level: module.cell[1], topLevel, rough });
    }
  }
  // The top level if possible, then the smoothest ground (within `roughSlack`).
  const level = allLevels ? out : out.some((c) => c.level === topLevel)
    ? out.filter((c) => c.level === topLevel) : out;
  const smoothest = Math.min(...level.map((c) => c.rough));
  return allLevels ? out : level.filter((c) => c.rough <= smoothest + settings.roughSlack);
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
    for (let side = -1; side <= 1; side++) blocks.push({ x: column.x + along[0] * side,
      y, z: column.z + along[1] * side, id: ladderBlock(facing), climb, column: true });
    if (y < ceilingY) continue;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const x = column.x + dx, z = column.z + dz;
      const inside = interior.has(blockKey(x, 0, z));
      const adjacent = HORIZONTAL.some((face) => {
        const [fx, , fz] = FACES[face].dir;
        return interior.has(blockKey(x + fx, 0, z + fz));
      });
      if (!inside && !adjacent) continue;
      if (inside && x === column.x + along[0] * -1 && z === column.z + along[1] * -1) continue;
      if (inside && x === column.x && z === column.z) continue;
      if (inside && x === column.x + along[0] && z === column.z + along[1]) continue;
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
  const project = candidate.spec.existingBase ? new Project('shaft', label)
    : moduleProject(world, controller, candidate.spec, label);
  if (!project) return null;
  project.kind = 'shaft';
  const module = candidate.spec.existingBase ?? project.module;
  if (candidate.spec.existingBase) {
    project.module = module;
    project.site = { x: module.center.x, y: module.floorY, z: module.center.z };
    project.onComplete = () => {};
  }
  const { column, wall, top } = candidate;
  const blocks = candidate.width === GOBLINS.projects.relocationWidth
    ? wideShaftBlocks(column, wall, module.floorY, top, module.box.y1)
    : shaftColumnBlocks(world, column, wall, module.floorY, top, module.box.y1);
  const tasks = addBlockTasks(project, world, blocks, {});
  wireShaftTasks(project, tasks, GOBLINS.worker.reach);
  const surface = tasks.find((t) => t.kind === 'dig' && t.y === top && t.x === column.x && t.z === column.z);
  project.breakthroughTask = surface ?? null;
  reserveShaftCells(controller, column, module.box.y1 + 1, top + 2);
  const along = wall === 'N' || wall === 'S' ? [1, 0] : [0, 1];
  const columns = candidate.width === GOBLINS.projects.relocationWidth
    ? [0, -1, 1].map((side) => ({ x: column.x + along[0] * side, z: column.z + along[1] * side }))
    : [{ ...column }];
  project.entrance = { base: module, wall, columns, width: candidate.width ?? 1,
    floorY: module.floorY, topY: top };
  return project;
}

// ---- Surface buildings ----

// A template's blocks at `origin` (ground layer at origin.y), plus terrain
// flattening (natural ground above the ground layer is dug out) and
// foundations (anything open under the ground layer is filled down to the
// terrain).
function surfaceBlocks(world, controller, template, origin, turns, skip = () => false) {
  const blocks = templateBlocks(template, origin, turns).filter((b) => !skip(b));
  const [, height] = templateSize(template);
  const bounds = templateBounds(template, origin.x, origin.z, turns);
  const byKey = new Map(blocks.map((b) => [blockKey(b.x, b.y, b.z), b]));
  const extra = [];
  const occupied = (x, z) => [...(controller.sieges?.towerSites?.values() ?? [])]
    .some((box)=>x>=box.x0 && x<=box.x1 && z>=box.z0 && z<=box.z1)
    || controller.wallFootprints.has(`${x},${z}`)
    || controller.buildings.some((building) =>
    building.access?.some((point) => point.x === x && point.z === z)
    || building.box && (building.kind !== 'wall' || building.footprint?.has(`${x},${z}`))
      && x >= building.box.x0 && x <= building.box.x1
      && z >= building.box.z0 && z <= building.box.z1);
  const { clearMargin: margin, treeReach, treeHeight } = GOBLINS.surface;
  const clearBox = { x0: bounds.x0 - margin, x1: bounds.x1 + margin,
    z0: bounds.z0 - margin, z1: bounds.z1 + margin };
  // Remove whole natural trees when either their trunk or canopy enters the site.
  for (let tz = clearBox.z0 - treeReach; tz <= clearBox.z1 + treeReach; tz++) {
    for (let tx = clearBox.x0 - treeReach; tx <= clearBox.x1 + treeReach; tx++) {
      const ground = surfaceHeight(world, tx, tz);
      if (occupied(tx, tz)) continue;
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
          if (!occupied(x, z) && world.getBlock(x, y, z) === BLOCK.LEAVES) extra.push({ x, y, z, id: BLOCK.AIR });
        }
      }
    }
  }
  // Level the entire construction area, including a margin around it.
  for (let z = clearBox.z0; z <= clearBox.z1; z++) for (let x = clearBox.x0; x <= clearBox.x1; x++) {
    if (skip({ x, y: origin.y, z }) || occupied(x, z)) continue;
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
      if (occupied(x, z)) continue;
      if (byKey.has(blockKey(x, origin.y + 1, z))) continue;
      const ground = surfaceHeight(world, x, z);
      if (ground === NONE) continue;
      for (let y = ground + 1; y <= origin.y; y++) extra.push({ x, y, z,
        id: y === origin.y ? BLOCK.GRASS : BLOCK.DIRT, ground: true });
      for (let y = origin.y + 1; y <= Math.max(ground + 2, origin.y + 4); y++) {
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
  for (let attempt = 0; attempt < settings.attempts+settings.expansionAttempts; attempt++) {
    const entrance = entrances[Math.floor(random() * entrances.length)];
    const exit = entrance.outside;
    const angle = random() * Math.PI * 2;
    const minimum = 6 + Math.max(sx, sz) / 2;
    const radius=attempt<settings.attempts?settings.radius:settings.expansionRadius;
    const distance = minimum + random() ** settings.distanceBias * (radius - minimum);
    const cx = Math.round(exit.x + Math.cos(angle) * distance), cz = Math.round(exit.z + Math.sin(angle) * distance);
    const turns = turnsFront(exit.x - cx, exit.z - cz);
    // Local (0, 0) such that the template's middle lands at (cx, cz).
    const [mx, mz] = turnLocal(Math.floor(sx / 2), Math.floor(sz / 2), turns);
    const ox = cx - mx, oz = cz - mz;
    const bounds = templateBounds(template, ox, oz, turns);
    if (!clearSite(world, controller, bounds, settings.clearance, settings.spacing)) continue;
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
    if (template.door !== undefined && Array.from({ length: DOOR_PATH * 3 }, (_, index) => {
      const d = Math.floor(index / 3) + 1, side = index % 3 - 1;
      const [dx, dz] = turnLocal(template.door + side, templateSize(template)[2] - 1 + d, turns);
      return { x: ox + dx, z: oz + dz };
    }).some(({ x, z }) => controller.wallFootprints.has(`${x},${z}`)
      || controller.buildings.some((building) => building.access?.some((point) => point.x === x && point.z === z))
      || controller.surfaceBoxes().some((box) => box.access?.some((point) => point.x === x && point.z === z))
      || controller.surfaceBoxes().some((box) => x >= box.x0 && x <= box.x1
        && z >= box.z0 && z <= box.z1)
      || controller.buildings.some((building) => building.box
        && (building.kind !== 'wall' || building.footprint?.has(`${x},${z}`))
        && x >= building.box.x0 && x <= building.box.x1
        && z >= building.box.z0 && z <= building.box.z1))) continue;
    return { origin: { x: ox, y: ground, z: oz }, turns, bounds: { ...bounds, y0: ground - 2, y1: ground + sy + 1 }, entrance };
  }
  return null;
}

// A surface building project (dwelling, tree plot or gatehouse) from a
// template at a chosen site.
export function surfaceProject(world, controller, kind, templateName, template, site, { skip } = {}) {
  const project = new Project(kind, template.label);
  const blocks = surfaceBlocks(world, controller, template, site.origin, site.turns, skip);
  // A plot's trees may grow while it's being built.
  if (template.plot) for (const b of blocks) b.grows = b.id === BLOCK.SAPLING || b.id === BLOCK.AIR;
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
      if(template.door===undefined) {
        const ladders=blocks.filter(b=>isLadder(b.id));
        if(ladders.length) {const low=ladders.reduce((a,b)=>a.y<b.y?a:b);return {x:low.x+0.5,y:low.y,z:low.z+0.5};}
      }
      const [sx, , sz] = templateSize(template);
      const [fx, fz] = turnLocal(template.door ?? Math.floor(sx / 2), sz + 1, site.turns);
      return { x: site.origin.x + fx + 0.5, y: site.origin.y + 1, z: site.origin.z + fz + 0.5 };
    })(),
    access: template.door === undefined ? [] : Array.from({ length: DOOR_PATH * 3 }, (_, index) => {
      const d = Math.floor(index / 3) + 1, side = index % 3 - 1;
      const [dx, dz] = turnLocal(template.door + side, templateSize(template)[2] - 1 + d, site.turns);
      return { x: site.origin.x + dx, z: site.origin.z + dz };
    }),
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
  // The underground shaft remains 3×3. At its mouth the gatehouse floor
  // covers the two rows in front of the ladders, giving climbers a landing.
  const skip = (b) => spots.some((s) => s.x === b.x && s.z === b.z) && b.y <= origin.y;
  const project = surfaceProject(world, controller, 'gatehouse', 'gatehouse', template, { origin, turns, bounds }, { skip });
  project.label = 'Shaft gatehouse';
  return project;
}

// A stone castle over the entrance that was sealed during relocation. Its
// battlements are accessible to archers from the inside ladder.
export function castleProject(world, controller, entrance) {
  const cfg = GOBLINS.projects.castle;
  let cx = Math.floor(entrance.top.x), cz = Math.floor(entrance.top.z);
  const other = controller.relocationNew?.gatehouse?.box;
  if (other) {
    const oldX = cx, oldZ = cz;
    const required = (coordinate, low, high, size) => {
      const left = coordinate - Math.floor(size / 2), right = left + size - 1;
      if (right + cfg.entranceClearance < low || left - cfg.entranceClearance > high) return 0;
      const away = coordinate < (low + high) / 2 ? -1 : 1;
      return away < 0 ? low - cfg.entranceClearance - 1 - right
        : high + cfg.entranceClearance + 1 - left;
    };
    const shiftX = required(cx, other.x0, other.x1, cfg.width);
    const shiftZ = required(cz, other.z0, other.z1, cfg.depth);
    if (Math.abs(shiftX) <= Math.abs(shiftZ) && Math.abs(shiftX) <= cfg.maxOffset) cx += shiftX;
    else if (Math.abs(shiftZ) <= cfg.maxOffset) cz += shiftZ;
    else { cx = oldX + Math.sign(shiftX) * cfg.maxOffset; cz = oldZ + Math.sign(shiftZ) * cfg.maxOffset; }
  }
  const x0 = cx - Math.floor(cfg.width / 2), z0 = cz - Math.floor(cfg.depth / 2);
  const x1 = x0 + cfg.width - 1, z1 = z0 + cfg.depth - 1;
  const y = entrance.topY + 1;
  const project = new Project('castle', 'Goblin Castle');
  const planned = new Map();
  const put = (x, by, z, id, extra={}) => planned.set(blockKey(x, by, z), { x, y: by, z, id, ...extra });
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    const corner = (x <= x0 + 1 || x >= x1 - 1) && (z <= z0 + 1 || z >= z1 - 1);
    put(x, y, z, BLOCK.GOBLIN_BRICKS);
    for (let h = 1; h <= (corner ? cfg.towerHeight : cfg.wallHeight); h++) {
      const doorway = z === z1 && x === cx && h <= 3;
      put(x, y + h, z, doorway || !edge && !corner ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS);
    }
    if (!edge) for (let h = 1; h <= cfg.wallHeight; h++) put(x, y + h, z, BLOCK.AIR);
    if (edge && !corner) put(x, y + cfg.wallHeight + 1, z,
      (x + z) % 2 ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS);
  }
  const ladder = { x: x0 + 1, z: z0 + 2, wall: 'N', floorY: y + 1, topY: y + cfg.towerHeight };
  for (let h = 1; h <= cfg.towerHeight; h++) {
    put(ladder.x, y + h, ladder.z, ladderBlock(FACES.N.facing));
    put(ladder.x, y + h, ladder.z - 1, BLOCK.GOBLIN_BRICKS);
  }
  // The castle floor is one block above the former entrance. Its doorway
  // needs a real supported approach at that height, then stairs to the yard.
  const access=[];
  for(let side=-Math.floor(cfg.approachWidth/2);side<=Math.floor(cfg.approachWidth/2);side++) {
    let floor=y;
    for(let offset=1;offset<=GOBLINS.walls.gateRampLength;offset++) {
      const px=cx+side,pz=z1+offset;
      if(controller.buildings.some(b=>b.box && (b.kind!=='wall' || b.footprint?.has(`${px},${pz}`)) && px>=b.box.x0 && px<=b.box.x1 && pz>=b.box.z0 && pz<=b.box.z1))break;
      let ground=y;
      while(ground>y-GOBLINS.walls.foundationDepth && !isGround(world.getBlock(px,ground,pz)))ground--;
      if(!isGround(world.getBlock(px,ground,pz)))break;
      while(ground<y+GOBLINS.walls.terrainRise && isGround(world.getBlock(px,ground+1,pz)))ground++;
      if(offset>1)floor=Math.max(floor-GOBLINS.walls.gateMaxStep,Math.min(floor+GOBLINS.walls.gateMaxStep,ground));
      for(let by=ground+1;by<=floor;by++)put(px,by,pz,BLOCK.DIRT,{ground:true});
      put(px,floor,pz,BLOCK.GRASS,{ground:true});
      for(let by=floor+1;by<=Math.max(floor+2,ground);by++)put(px,by,pz,BLOCK.AIR,{passage:true});
      access.push({x:px,y:floor+1,z:pz});
      if(offset>=GOBLINS.walls.gateApproach && floor===ground)break;
    }
  }
  const blocks = [...planned.values()];
  addBlockTasks(project, world, blocks, { order: (b) => b.id === BLOCK.AIR ? 0 : b.y * 10 });
  project.sort();
  project.surface = true;
  project.site = { x: cx + 0.5, y: y + 1, z: z1 + 1.5, surface: true };
  project.building = { kind: 'dwelling', template: 'castle', capacity: cfg.capacity,
    box: { x0, x1, z0, z1, y0: y, y1: y + cfg.towerHeight + 1 },
    origin: { x: x0, y, z: z0 }, front: project.site,
    blocks, access, ladder, post: { x: x0 + 1.5, y: y + cfg.towerHeight + 1, z: z0 + 1.5 }, intact: false };
  controller.reserveSurface(project.building.box);
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
    outside: entrance.gatehouse?.front ?? { x: top.x + fx * 5, y: top.y, z: top.z + fz * 5 },
  };
}

// A three-block-high brick enclosure around a group of existing buildings.
// The perimeter is levelled and cleared before construction; its two-wide
// gates stay open for goblin routes. Raised posts use ladders on the inside.
export function wallProject(world, controller, buildings, outer = false, diagnostics = null, gateAttempt = 0) {
  const reject = (reason) => { if (diagnostics) diagnostics.reason = reason; if(process.env.GOBLIN_WALL_TRACE && outer)console.error(JSON.stringify({wallReject:reason,...diagnostics})); return null; };
  if (!buildings.length) return null;
  const sourceBuildings=buildings;
  const settings = GOBLINS.walls;
  const existingWalls=controller.buildings.filter((b)=>b.kind==='wall');
  // Relocating an entrance marks its old gatehouse damaged/sealed, but its
  // structure still occupies ground. The outer enclosure must include ruins
  // and their door lanes too, rather than tracing straight through them.
  if(outer)buildings=[...new Set([...buildings,...controller.buildings.filter(b=>b.box
    && ['dwelling','plot','gatehouse'].includes(b.kind))])];
  if(outer)buildings=[...buildings,...buildings.flatMap(b=>(b.access ?? []).map(p=>({origin:b.origin,box:{x0:p.x,x1:p.x,z0:p.z,z1:p.z}}))),...existingWalls.flatMap((wall)=>[...wall.footprint].map((key)=>{
    const [x,z]=key.split(',').map(Number);return {origin:wall.origin,box:{x0:x,x1:x,z0:z,z1:z}};
  }))];
  const contour = true;
  const margin = outer ? settings.outerMargin : settings.sectionMargin;
  const x0 = Math.min(...buildings.map((b) => b.box.x0)) - margin;
  const x1 = Math.max(...buildings.map((b) => b.box.x1)) + margin;
  const z0 = Math.min(...buildings.map((b) => b.box.z0)) - margin;
  const z1 = Math.max(...buildings.map((b) => b.box.z1)) + margin;
  const heights = buildings.map((b) => b.origin.y).sort((a, b) => a - b);
  const y0 = heights[Math.floor(heights.length / 2)];
  if(!outer && existingWalls.some((b)=>x0<=b.box.x1+settings.perimeterSeparation && x1>=b.box.x0-settings.perimeterSeparation
    && z0<=b.box.z1+settings.perimeterSeparation && z1>=b.box.z0-settings.perimeterSeparation))return reject('overlappingSection');
  const terrainCache = new Map();
  const terrainBelow = (x, z) => {
    const key = `${x},${z}`;
    if (terrainCache.has(key)) return terrainCache.get(key);
    if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) return NONE;
    const natural = centralTerrainHeight(world,x,z);
    if (natural === NONE) return NONE;
    for (let y = Math.min(world.sizeY - 1,world.centralTerrain?natural:y0+settings.terrainRise);
      y >= Math.max(world.minY,natural-settings.foundationDepth); y--) {
      if (isGround(world.getBlock(x,y,z))) {
        while(y<world.sizeY-1 && isGround(world.getBlock(x,y+1,z)))y++;
        terrainCache.set(key,y);return y;
      }
    }
    terrainCache.set(key, NONE);
    return NONE;
  };
  const futureBuilding = (x, z) => [!controller.relocated && controller.relocationReserve?.box, !controller.castleBuilt && controller.castleReserve]
    .some((box) => box && (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1
      || box.access?.some((point) => point.x === x && point.z === z)));
  if (x0 < 1 || z0 < 1 || x1 >= world.sizeX - 1 || z1 >= world.sizeZ - 1) return reject('bounds');
  const centerX = (x0 + x1) / 2, centerZ = (z0 + z1) / 2;
  const toward = controller.entrances.find((e)=>e.open && !e.sealed)?.outside ?? { x: centerX, z: z0 - 1 };
  const side = Math.abs(toward.x - centerX) > Math.abs(toward.z - centerZ)
    ? toward.x < centerX ? 'W' : 'E' : toward.z < centerZ ? 'N' : 'S';
  const gates = new Set(),gateDirections=new Map();
  let selectedGate=null;
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
  if (contour) {
    if(outer) {
      // Trace the outside boundary of the camp's usable ground. Expanding a
      // building hull inward around voids can cut straight through inner walls.
      const land=new Set(),radius=settings.perimeterSeparation;
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++) {
        if(terrainBelow(x,z)===NONE)continue;
        if(![[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([dx,dz])=>terrainBelow(x+dx,z+dz)!==NONE))continue;
        land.add(`${x},${z}`);
      }
      // Preserve a complete margin around every enclosure and building. Local
      // erosion near rivers must not put the outside boundary through a house.
      for(const building of buildings)for(let z=building.box.z0-margin;z<=building.box.z1+margin;z++)
        for(let x=building.box.x0-margin;x<=building.box.x1+margin;x++)
          if(x>0 && z>0 && x<world.sizeX-1 && z<world.sizeZ-1)land.add(`${x},${z}`);
      // Siege towers belong outside the village perimeter. Keep their work
      // area clear without extending the village enclosure to every launch site.
      for(const box of controller.sieges?.towerSites?.values() ?? [])
        for(let z=box.z0;z<=box.z1;z++)for(let x=box.x0;x<=box.x1;x++)land.delete(`${x},${z}`);
      const edges=new Map();
      const edge=(ax,az,bx,bz)=> {
        const key=`${ax},${az}`;if(!edges.has(key))edges.set(key,[]);
        edges.get(key).push([bx,bz]);
      };
      for(const key of land) {
        const [x,z]=key.split(',').map(Number);
        if(!land.has(`${x},${z-1}`))edge(x,z,x+1,z);
        if(!land.has(`${x+1},${z}`))edge(x+1,z,x+1,z+1);
        if(!land.has(`${x},${z+1}`))edge(x+1,z+1,x,z+1);
        if(!land.has(`${x-1},${z}`))edge(x,z+1,x,z);
      }
      const loops=[];
      while(edges.size) {
        const start=edges.keys().next().value,current=start.split(',').map(Number),loop=[current];
        let point=current,key=start,area=0;
        for(let count=0;count<settings.shorePathNodes;count++) {
          const choices=edges.get(key);if(!choices?.length)break;
          // At a diagonal contact keep the same boundary on the right,
          // instead of jumping into the adjacent component's outline.
          if(choices.length>1 && loop.length>1) {
            const previous=loop.at(-2),dx=point[0]-previous[0],dz=point[1]-previous[1];
            const rank=(next)=> {
              const tx=next[0]-point[0],tz=next[1]-point[1];
              const turn=dx*tz-dz*tx,dot=dx*tx+dz*tz;
              return turn>0?3:dot>0?2:turn<0?1:0;
            };
            choices.sort((a,b)=>rank(a)-rank(b));
          }
          const next=choices.pop();if(!choices.length)edges.delete(key);
          area+=point[0]*next[1]-next[0]*point[1];point=next;key=`${point[0]},${point[1]}`;
          if(key===start) {loops.push({loop,area:Math.abs(area)});break;}
          loop.push(point);
        }
      }
      const boundary=loops.sort((a,b)=>b.area-a.area)[0];
      if(!boundary)return reject('shoreContour');
      const cells=boundary.loop.map(([x,z],i)=> {
        const [tx,tz]=boundary.loop[(i+1)%boundary.loop.length],dx=tx-x,dz=tz-z;
        return dx>0?[x,z]:dz>0?[x-1,z]:dx<0?[x-1,z-1]:[x,z-1];
      });
      for(let i=0;i<cells.length;i++) {
        const [x,z]=cells[i],[tx,tz]=cells[(i+1)%cells.length];
        perimeter.add(`${x},${z}`);
        if(x!==tx && z!==tz) {
          const corner=[[tx,z],[x,tz]].find(([cx,cz])=>land.has(`${cx},${cz}`));
          if(!corner)return reject('shoreCorner');
          perimeter.add(`${corner[0]},${corner[1]}`);
        }
      }
    } else {
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
    const coastClear = (x,z) => {
      for(let dz=-settings.outerMargin;dz<=settings.outerMargin;dz++)
        for(let dx=-settings.outerMargin;dx<=settings.outerMargin;dx++)
          if(terrainBelow(x+dx,z+dz)===NONE)return false;
      return true;
    };
    const validGround = (x, z) => terrainBelow(x, z) !== NONE
      && coastClear(x,z)
      && (outer || [[settings.outerMargin+settings.perimeterSeparation,0],[-settings.outerMargin-settings.perimeterSeparation,0],
        [0,settings.outerMargin+settings.perimeterSeparation],[0,-settings.outerMargin-settings.perimeterSeparation]]
        .every(([dx,dz])=>terrainBelow(x+dx,z+dz)!==NONE))
      && !existingWalls.some((b)=> {
        for(let dz=-settings.perimeterSeparation;dz<=settings.perimeterSeparation;dz++)
          for(let dx=-settings.perimeterSeparation;dx<=settings.perimeterSeparation;dx++)
            if(b.footprint.has(`${x+dx},${z+dz}`))return true;
        return false;
      })
      && ![...(controller.sieges?.towerSites?.values() ?? [])].some((box)=>x>=box.x0 && x<=box.x1 && z>=box.z0 && z<=box.z1)
      && !world.keeps.some((keep) => Math.abs(x - keep.cx) <= KEEP_REACH && Math.abs(z - keep.cz) <= KEEP_REACH)
      && !futureBuilding(x, z)
      && !controller.buildings.some((building) => building.kind !== 'wall' && building.box
        && x >= building.box.x0 && x <= building.box.x1
        && z >= building.box.z0 && z <= building.box.z1);
    const snapGround = ([x, z]) => {
      if (validGround(x, z)) return [x, z];
      for (let r = 1; r <= settings.shoreSearch; r++) {
        const sx = Math.round(x + (centerX - x) * r / settings.shoreSearch);
        const sz = Math.round(z + (centerZ - z) * r / settings.shoreSearch);
        if (validGround(sx, sz)) return [sx, sz];
      }
      return null;
    };
    const grounded = hull.map(snapGround);
    if (grounded.some((point) => !point)) return reject('void');
    const pathGround = (start, end) => {
      const key = ([x, z]) => `${x},${z}`;
      const visited = new Set([key(start)]), queue = [start], parents = new Map();
      const minX = Math.max(1, x0 - settings.shoreSearch), maxX = Math.min(world.sizeX - 2, x1 + settings.shoreSearch);
      const minZ = Math.max(1, z0 - settings.shoreSearch), maxZ = Math.min(world.sizeZ - 2, z1 + settings.shoreSearch);
      for (let i = 0; i < queue.length && i < settings.shorePathNodes; i++) {
        const point = queue[i];
        if (point[0] === end[0] && point[1] === end[1]) {
          const path = [point];
          while (parents.has(key(path.at(-1)))) path.push(parents.get(key(path.at(-1))));
          return path.reverse();
        }
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .sort((a, b) => Math.hypot(point[0] + a[0] - end[0], point[1] + a[1] - end[1])
            - Math.hypot(point[0] + b[0] - end[0], point[1] + b[1] - end[1]));
        for (const [dx, dz] of directions) {
          const next = [point[0] + dx, point[1] + dz], k = key(next);
          if (next[0] < minX || next[0] > maxX || next[1] < minZ || next[1] > maxZ
            || visited.has(k) || !validGround(...next)) continue;
          visited.add(k); parents.set(k, point); queue.push(next);
        }
      }
      return null;
    };
    for (let i = 0; i < grounded.length; i++) {
      const path = pathGround(grounded[i], grounded[(i + 1) % grounded.length]);
      if (!path) return reject(`voidRoute:${grounded[i]}:${grounded[(i + 1) % grounded.length]}`);
      for (const [x, z] of path) perimeter.add(`${x},${z}`);
    }
    }
  } else {
    for (let x = x0; x <= x1; x++) { perimeter.add(`${x},${z0}`); perimeter.add(`${x},${z1}`); }
    for (let z = z0; z <= z1; z++) { perimeter.add(`${x0},${z}`); perimeter.add(`${x1},${z}`); }
  }
  // Ground detours can retrace part of an earlier edge. Remove dangling
  // branches from those overlaps; only closed perimeter cycles are walls.
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of perimeter) {
      const [x, z] = key.split(',').map(Number);
      const degree = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .filter(([dx, dz]) => perimeter.has(`${x + dx},${z + dz}`)).length;
      if (degree < 2) { perimeter.delete(key); changed = true; }
    }
  }
  if (!perimeter.size) return reject('openContour');
  const wallHeights = new Map();
  for (const key of perimeter) {
    const [x, z] = key.split(',').map(Number);
    if (futureBuilding(x, z) || [...(controller.sieges?.towerSites?.values() ?? [])].some((box)=>x>=box.x0 && x<=box.x1 && z>=box.z0 && z<=box.z1)) return reject('reservedBuilding');
    if(outer && existingWalls.some(wall=>[[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>wall.footprint.has(`${x+dx},${z+dz}`))))return reject('wallSeparation');
    const ground = surfaceHeight(world, x, z);
    const terrain = terrainBelow(x, z);
    if (terrain === NONE && !outer) return reject('void');
    if (!contour && Math.abs(ground - y0) > settings.maxFlatten) return reject('slope');
    if (!contour && world.riverColumns?.has(key)) return reject('river');
    if (!contour && controller.wallFootprints.has(key)) return reject('wall');
    if (world.keeps.some((keep) => Math.abs(x - keep.cx) <= KEEP_REACH && Math.abs(z - keep.cz) <= KEEP_REACH)) return reject('keep');
    const obstacle = world.structures.find(({ box }) => box && y0 >= box.y0 && y0 <= box.y1
      && x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1);
    if (obstacle && !outer) {
      if (diagnostics) diagnostics.obstacle = { kind: obstacle.kind, x, z };
      return reject('structure');
    }
    if (controller.buildings.some((b) => b.kind !== 'wall' && b.box
      && x >= b.box.x0 && x <= b.box.x1 && z >= b.box.z0 && z <= b.box.z1)) {if(diagnostics)diagnostics.at={x,z,terrain,y0,boxes:controller.buildings.filter((b)=>b.kind!=='wall'&&b.box&&x>=b.box.x0&&x<=b.box.x1&&z>=b.box.z0&&z<=b.box.z1).map((b)=>({kind:b.kind,box:b.box}))};return reject('building');}
    const river = contour && world.riverColumns?.has(key);
    wallHeights.set(key, terrain === NONE ? buildings.reduce((nearest,b)=>Math.hypot(x-(b.box.x0+b.box.x1)/2,z-(b.box.z0+b.box.z1)/2)<Math.hypot(x-(nearest.box.x0+nearest.box.x1)/2,z-(nearest.box.z0+nearest.box.z1)/2)?b:nearest,buildings[0]).origin.y : river || outer && ground === NONE
      ? Math.max(y0, terrain + settings.riverClearance)
      : contour ? terrain : Math.max(y0, terrain));
  }
  if (!contour) {
    // Put the section entrance on a level, clear stretch. A gate centered
    // blindly on a rectangle can land against a dwelling or an older wall.
    const candidates = [];
    const clearGate = (x, z, dx, dz) => {
      for (const side of [-2, -1, 1, 2]) {
        const sx = x + dx * side, sz = z + dz * side;
        if (terrainBelow(sx, sz) === NONE || controller.wallFootprints.has(`${sx},${sz}`)
          || controller.buildings.some((b) => b.box && sx >= b.box.x0 && sx <= b.box.x1
            && sz >= b.box.z0 && sz <= b.box.z1)) return false;
      }
      return true;
    };
    for (const side of ['N', 'S', 'W', 'E']) {
      const alongX = side === 'N' || side === 'S';
      const fixed = side === 'N' ? z0 : side === 'S' ? z1 : side === 'W' ? x0 : x1;
      const lo = alongX ? x0 + 2 : z0 + 2, hi = alongX ? x1 - 2 : z1 - 2;
      for (let along = lo; along <= hi; along++) {
        const x = alongX ? along : fixed, z = alongX ? fixed : along;
        const x2 = x + (alongX ? 1 : 0), z2 = z + (alongX ? 0 : 1);
        if (Math.abs(wallHeights.get(`${x},${z}`) - wallHeights.get(`${x2},${z2}`)) > 1
          || !clearGate(x, z, alongX ? 0 : 1, alongX ? 1 : 0)
          || !clearGate(x2, z2, alongX ? 0 : 1, alongX ? 1 : 0)) continue;
        candidates.push({ keys: [`${x},${z}`, `${x2},${z2}`],
          score: Math.hypot(x - toward.x, z - toward.z) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length) return reject('gates');
    gates.clear();
    for (const key of candidates[0].keys) gates.add(key);
  }
  if (contour) {
    gates.clear();
    const pairs = [];
    const gateRejects = { footprint: 0, terrain: 0, height: 0, approach: 0 };
    for (const key of perimeter) {
      const [x, z] = key.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const other = `${x + dx},${z + dz}`;
        const [nx, nz] = dx ? [0, 1] : [1, 0];
        const clearApproach = (px, pz) => Array.from({length: settings.gateApproach * 2}, (_, i) => i < settings.gateApproach ? -i - 1 : i - settings.gateApproach + 1).every((side) => {
          const sx = px + nx * side, sz = pz + nz * side;
          const ground = terrainBelow(sx, sz);
          return ground !== NONE
            && Math.abs(ground - terrainBelow(px, pz)) <= settings.gateMaxStep
            && !world.riverColumns?.has(`${sx},${sz}`)
            && !controller.wallFootprints.has(`${sx},${sz}`)
            && !perimeter.has(`${sx},${sz}`)
            && !futureBuilding(sx,sz)
            && !controller.buildings.some((b) => b.kind !== 'wall' && b.box
              && sx >= b.box.x0 && sx <= b.box.x1
              && sz >= b.box.z0 && sz <= b.box.z1);
        });
        if (!perimeter.has(other)) continue;
        if (controller.wallFootprints.has(key) || controller.wallFootprints.has(other)) {
          gateRejects.footprint++; continue;
        }
        if (terrainBelow(x, z) === NONE || terrainBelow(x + dx, z + dz) === NONE) {
          gateRejects.terrain++; continue;
        }
        if (Math.abs(wallHeights.get(key) - wallHeights.get(other)) > 1) {
          gateRejects.height++; continue;
        }
        if (!clearApproach(x, z) || !clearApproach(x + dx, z + dz)) {
          gateRejects.approach++; continue;
        }
        const width=outer?settings.mainGateWidth:settings.gateWidth;
        const keys=Array.from({length:width},(_,i)=>`${x+dx*i},${z+dz*i}`);
        const frame=[`${x-dx},${z-dz}`,`${x+dx*width},${z+dz*width}`];
        if(![...keys,...frame].every((k)=>perimeter.has(k)))continue;
        if(!keys.every((k)=>{const [px,pz]=k.split(',').map(Number);
          return Math.abs(wallHeights.get(k)-wallHeights.get(key))<=settings.gateMaxStep && clearApproach(px,pz);}))continue;
        pairs.push({keys,x:x+dx*(width-1)/2,z:z+dz*(width-1)/2,nx,nz,dx,dz});
      }
    }
    pairs.sort((a, b) => Math.hypot(a.x - toward.x, a.z - toward.z)
      - Math.hypot(b.x - toward.x, b.z - toward.z));
    if (!pairs.length) {
      if (diagnostics) diagnostics.gateRejects = gateRejects;
      return reject('gates');
    }
    // Adjacent sliding spans are the same gate site. Retry distinct sites
    // around the perimeter instead of exhausting attempts on one ledge.
    const sites=[];
    for(const pair of pairs)if(sites.every(site=>Math.hypot(site.x-pair.x,site.z-pair.z)>=settings.mainGateWidth+settings.gateApproach))sites.push(pair);
    selectedGate=sites[gateAttempt];
    if(!selectedGate)return reject('gateRoute');
    const mainFloor=Math.max(...selectedGate.keys.map(key=>{const [x,z]=key.split(',').map(Number);return terrainBelow(x,z);}));
    for (const key of selectedGate.keys) {gates.add(key);gateDirections.set(key,{nx:selectedGate.nx,nz:selectedGate.nz});wallHeights.set(key,mainFloor);}
    const opposite = [...pairs].sort((a, b) => Math.hypot(b.x - selectedGate.x, b.z - selectedGate.z)
      - Math.hypot(a.x - selectedGate.x, a.z - selectedGate.z))[0];
    const oppositeFloor=Math.max(...opposite.keys.map(key=>{const [x,z]=key.split(',').map(Number);return terrainBelow(x,z);}));
    for (const key of opposite.keys) {gates.add(key);gateDirections.set(key,{nx:opposite.nx,nz:opposite.nz});wallHeights.set(key,oppositeFloor);}
  }
  const anchor=controller.sieges?.base() ?? controller.entrances.find((e)=>e.open && !e.sealed)?.outside ?? toward;
  const routes=[],floors=new Map();
  // Door lanes must remain inside a section or outside it, never puncture it.
  if(controller.buildings.some((b)=>b.access?.some((p)=>perimeter.has(`${p.x},${p.z}`)))) {if(diagnostics)diagnostics.doorLane=controller.buildings.flatMap(b=>(b.access ?? []).filter(p=>perimeter.has(`${p.x},${p.z}`)).map(p=>({template:b.template,point:p,terrain:terrainBelow(p.x,p.z),box:b.box})));return reject('doorLane');}
  const desired = new Map();
  const put = (b) => {const key=blockKey(b.x,b.y,b.z);desired.set(key,{...b,passage:b.passage || desired.get(key)?.passage});};
  const clear = new Map();
  // Gate approaches follow a walkable ramp to the surrounding terrain.
  // A uniformly level strip can end at an impassable ledge on either side.
  const laneBlocks=new Map();
  const lanePut=b=>laneBlocks.set(blockKey(b.x,b.y,b.z),b);
  for(const key of gates) {
    const [x,z]=key.split(',').map(Number),base=wallHeights.get(key);
    const alongX=perimeter.has(`${x-1},${z}`) || perimeter.has(`${x+1},${z}`);
    const {nx,nz}=gateDirections.get(key) ?? {nx:alongX?0:1,nz:alongX?1:0};
    for(const sign of [-1,1]) {
      let floor=base;
      for(let offset=0;offset<=settings.gateRampLength;offset++) {
        const px=x+nx*sign*offset,pz=z+nz*sign*offset,ground=terrainBelow(px,pz);
        if(ground===NONE)break;
        if(offset)floor=Math.max(floor-settings.gateMaxStep,Math.min(floor+settings.gateMaxStep,ground));
        if(perimeter.has(`${px},${pz}`) && !gates.has(`${px},${pz}`))break;
        if(controller.wallFootprints.has(`${px},${pz}`) || controller.buildings.some(b=>b.kind!=='wall' && b.box
          && px>=b.box.x0 && px<=b.box.x1 && pz>=b.box.z0 && pz<=b.box.z1))continue;
        for(let y=ground+1;y<=floor;y++)lanePut({x:px,y,z:pz,id:BLOCK.DIRT,ground:true});
        lanePut({x:px,y:floor,z:pz,id:perimeter.has(`${px},${pz}`)?BLOCK.GOBLIN_BRICKS:BLOCK.GRASS,ground:true});
        for(let y=floor+1;y<=Math.max(floor+settings.height,ground);y++)lanePut({x:px,y,z:pz,id:BLOCK.AIR});
        const next=terrainBelow(px+nx*sign,pz+nz*sign);
        if(offset>=settings.gateApproach && floor===ground && next!==NONE && Math.abs(next-floor)<=settings.gateMaxStep)break;
      }
    }
  }
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
    if ([...(controller.sieges?.towerSites?.values() ?? [])].some((box)=>x>=box.x0 && x<=box.x1 && z>=box.z0 && z<=box.z1))continue;
    if (controller.buildings.some((building) => building.access?.some((point) => point.x === x && point.z === z))) continue;
    if (controller.buildings.some((b) => b.box && x >= b.box.x0 && x <= b.box.x1 && z >= b.box.z0 && z <= b.box.z1)) continue;
    const ground = terrainBelow(x, z);
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
      if (controller.buildings.some((building) => building.box && tx >= building.box.x0
        && tx <= building.box.x1 && tz >= building.box.z0 && tz <= building.box.z1)) continue;
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
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => wallHeights.get(`${x + dx},${z + dz}`)).filter((height) => height !== undefined);
    const native=terrainBelow(x,z);
    const low = Math.min(baseY, ...neighbors, native===NONE?baseY:native), high = Math.max(baseY, ...neighbors);
    for (let y = low; y <= baseY; y++) put({ x, y, z, id: BLOCK.GOBLIN_BRICKS });
    for (let h = 1; h <= high - baseY + settings.height; h++) put({ x, y: baseY + h, z,
      id: gates.has(key) ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS });
  }
  for(const b of laneBlocks.values())put(b);
  let mainGate=null;
  if(outer && selectedGate) {
    const span=selectedGate.keys.map((k)=>{const [x,z]=k.split(',').map(Number);return {x,z};});
    const {dx,dz,nx,nz}=selectedGate,first=span[0],last=span.at(-1);
    const floor=wallHeights.get(selectedGate.keys[0]);
    for(const p of span)put({...p,y:floor+settings.gateFrameHeight,id:BLOCK.WOOD});
    for(const p of [{x:first.x-dx,z:first.z-dz},{x:last.x+dx,z:last.z+dz}]) {
      for(let y=wallHeights.get(`${p.x},${p.z}`)+1;y<=floor+settings.gateFrameHeight;y++)put({...p,y,id:BLOCK.WOOD});
      put({...p,y:floor+settings.gateFrameHeight+1,id:BLOCK.GOBLIN_BRICKS});
    }
    const inward=(centerX-selectedGate.x)*nx+(centerZ-selectedGate.z)*nz>0?1:-1;
    mainGate={x:selectedGate.x+0.5,y:floor+1,z:selectedGate.z+0.5,width:span.length,span,
      guards:[first,last].map((p)=> {
        const x=p.x+nx*inward*settings.guardInset,z=p.z+nz*inward*settings.guardInset;
        const overlay={getBlock:(px,py,pz)=>desired.get(blockKey(px,py,pz))?.id ?? world.getBlock(px,py,pz)};
        const y=[floor+1,floor,floor+2].find(y=>canStand(overlay,x,y,z,2));
        return {x:x+0.5,y:y ?? floor+1,z:z+0.5};
      })};
  }
  const posts = [];
  const postClear = (x, z) => {
    if([...gates].some(key=>{const [gx,gz]=key.split(',').map(Number);return Math.abs(gx-x)<=settings.gateApproach && Math.abs(gz-z)<=settings.gateApproach;}))return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (controller.buildings.some((building) => building.box && x + dx >= building.box.x0
        && x + dx <= building.box.x1 && z + dz >= building.box.z0
        && z + dz <= building.box.z1)) return false;
      if (futureBuilding(x + dx, z + dz)) return false;
    }
    return true;
  };
  const postSites = [...perimeter].flatMap((key) => {
    if (gates.has(key)) return [];
    const [x, z] = key.split(',').map(Number);
    if (perimeter.has(`${x - 1},${z}`) && perimeter.has(`${x + 1},${z}`)) {
      const inward = z < centerZ ? 1 : -1;
      if (!perimeter.has(`${x},${z + inward}`) && postClear(x, z + inward))
        return [{ x, z: z + inward, wall: inward > 0 ? 'N' : 'S', baseY: wallHeights.get(key) }];
    }
    if (perimeter.has(`${x},${z - 1}`) && perimeter.has(`${x},${z + 1}`)) {
      const inward = x < centerX ? 1 : -1;
      if (!perimeter.has(`${x + inward},${z}`) && postClear(x + inward, z))
        return [{ x: x + inward, z, wall: inward > 0 ? 'W' : 'E', baseY: wallHeights.get(key) }];
    }
    return [];
  });
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
    posts.push({ post: { x: px + 1.5, y: baseY + settings.postHeight + 1, z: lz + 0.5 },
      ladder: climb });
  }
  const project = new Project('wall', outer ? 'Outer base wall' : 'Base section wall');
  // The levelling strip around a later section may cross an earlier wall.
  // Preserve those bricks even when the new section clears nearby terrain.
  for (const [key, b] of desired) if (!b.passage && b.id !== BLOCK.GOBLIN_BRICKS
    && controller.wallFootprints.has(`${b.x},${b.z}`)
    && world.getBlock(b.x, b.y, b.z) === BLOCK.GOBLIN_BRICKS) desired.delete(key);
  // No levelling operation may fill an existing doorway's reserved lane.
  for(const building of controller.buildings)for(const point of building.access ?? []) {
    for(let y=point.y ?? building.origin.y+1;y<=(point.y ?? building.origin.y+1)+settings.height-1;y++) {
      const key=blockKey(point.x,y,point.z),b=desired.get(key);
      if(b && b.id!==BLOCK.AIR)desired.set(key,{...b,id:BLOCK.AIR,passage:true});
    }
  }
  // Validate access against the complete proposed wall, including posts.
  // Plan shallow terrain clearance and stream footbridges where necessary;
  // never cut a building or an existing wall to make a route appear valid.
  for(const wall of existingWalls)for(const gate of wall.gates)for(let offset=-settings.gateApproach;offset<=settings.gateApproach;offset++) {
    const x=Math.floor(gate.x)+(gate.nx ?? 0)*offset,z=Math.floor(gate.z)+(gate.nz ?? 1)*offset;
    const feet=Array.from({length:settings.gateRampLength*2+1},(_,i)=>Math.round(gate.y)+i-settings.gateRampLength).find(y=>canStand(world,x,y,z,2));
    if(feet!==undefined)for(let y=feet-1;y<=feet+1;y++)desired.delete(blockKey(x,y,z));
  }
  const planned={getBlock:(x,y,z)=>desired.get(blockKey(x,y,z))?.id ?? world.getBlock(x,y,z)};
  const protectedWalkColumns=new Set([...controller.wallFootprints,...perimeter,`${Math.floor(anchor.x)},${Math.floor(anchor.z)}`,
    ...[mainGate,...existingWalls.map(w=>w.mainGate)].filter(Boolean).flatMap(g=>g.guards.map(p=>`${Math.floor(p.x)},${Math.floor(p.z)}`)),
    ...[...existingWalls.flatMap(w=>w.gates),...[...gates].map(key=>{const [x,z]=key.split(',').map(Number);return {x:x+0.5,z:z+0.5,...gateDirections.get(key)};})]
      .flatMap(g=>Array.from({length:settings.gateApproach*2+1},(_,i)=>`${Math.floor(g.x)+(g.nx ?? 0)*(i-settings.gateApproach)},${Math.floor(g.z)+(g.nz ?? 1)*(i-settings.gateApproach)}`))]);
  for(const building of controller.buildings.filter(b=>b.kind!=='wall')) {
    for(const point of building.access ?? [])protectedWalkColumns.add(`${point.x},${point.z}`);
    if(building.box)for(let z=building.box.z0;z<=building.box.z1;z++)for(let x=building.box.x0;x<=building.box.x1;x++)protectedWalkColumns.add(`${x},${z}`);
  }
  const roadWorld={getBlock:(x,y,z)=>{const id=planned.getBlock(x,y,z);return isWater(id)?BLOCK.GOBLIN_BRICKS:id;}};
  const planAccess=(goal)=> {
    // Roads cross on the water surface; swimming nodes inside the river
    // cannot be converted into dry, stable footbridges.
    const path=findPath(roadWorld,{x:Math.floor(anchor.x),y:Math.round(anchor.y),z:Math.floor(anchor.z)},goal,
      {maxNodes:settings.gateRouteNodes,goalHeight:true,diagonal:false,supportCost:settings.gateFillCost,
        canSupport:(px,py,pz)=>!protectedWalkColumns.has(`${px},${pz}`)
          && terrainBelow(px,pz)!==NONE && py<=terrainBelow(px,pz)+settings.gatePathFillDepth,
        allowed:(px,py,pz)=>{const ground=terrainBelow(px,pz);return ground!==NONE && (protectedWalkColumns.has(`${px},${pz}`) && canStand(planned,px,py,pz,2) || py>=ground-settings.gatePathCutDepth && py<=ground+settings.gateRampLength);},
        canBreak:(px,py,pz,id)=>!protectedWalkColumns.has(`${px},${pz}`) && (isGround(id) || id===BLOCK.LEAVES
          || id===BLOCK.WOOD && controller.intended.get(blockKey(px,py,pz))?.id!==id)});
    const end=path.at(-1),complete=end && end.x===goal.x && end.y===goal.y && end.z===goal.z;
    if(complete)for(const node of path) {
      if(protectedWalkColumns.has(`${node.x},${node.z}`))continue;
      const ground=terrainBelow(node.x,node.z);
      const overWater=Array.from({length:Math.max(0,node.y-ground-1)},(_,i)=>ground+i+1).some(y=>isWater(planned.getBlock(node.x,y,node.z)));
      if(overWater)put({x:node.x,y:node.y-1,z:node.z,id:BLOCK.PLANKS,passage:true});
      else for(let y=ground+1;y<node.y;y++)if(!isSolid(planned.getBlock(node.x,y,node.z)))put({x:node.x,y,z:node.z,id:BLOCK.DIRT,ground:true,passage:true});
      for(let y=node.y;y<=Math.max(node.y+1,terrainBelow(node.x,node.z));y++)if(isGround(planned.getBlock(node.x,y,node.z)) || y<node.y+2 && isSolid(planned.getBlock(node.x,y,node.z)))put({x:node.x,y,z:node.z,id:BLOCK.AIR,passage:true});
    }
    if(diagnostics)diagnostics.lastGatePath={goal,end,length:path.length,ground:terrainBelow(goal.x,goal.z),protected:protectedWalkColumns.has(`${goal.x},${goal.z}`),blocks:Array.from({length:8},(_,i)=>planned.getBlock(goal.x,goal.y+i-1,goal.z)),worldBlocks:Array.from({length:8},(_,i)=>world.getBlock(goal.x,goal.y+i-1,goal.z))};
    return complete;
  };
  if(selectedGate) {
    const floor=wallHeights.get(selectedGate.keys[0])+1;
    const reachable=[-1,1].every(sign=>selectedGate.keys.some(key=> {
      const [x,z]=key.split(',').map(Number);
      const gx=x+selectedGate.nx*sign*settings.gateApproach,gz=z+selectedGate.nz*sign*settings.gateApproach;
      const gy=Array.from({length:settings.gateRampLength*2+1},(_,i)=>floor+i-settings.gateRampLength).sort((a,b)=>Math.abs(a-floor)-Math.abs(b-floor)).find(y=>canStand(planned,gx,y,gz,2));
      return gy!==undefined && planAccess({x:gx,y:gy,z:gz});
    }));
    let doors=reachable && controller.buildings.filter(b=>b.kind==='dwelling' && b.intact && b.front).every(building=> {
      const x=Math.floor(building.front.x),z=Math.floor(building.front.z),floor=Math.round(building.front.y);
      const y=Array.from({length:GOBLINS.surface.maxSlope*2+1},(_,i)=>floor+i-GOBLINS.surface.maxSlope).sort((a,b)=>Math.abs(a-floor)-Math.abs(b-floor)).find(y=>canStand(planned,x,y,z,2));
      return planAccess({x,y:y ?? floor,z});
    });
    // Later access cuts can change an earlier road's support. Verify the
    // finished overlay, and repair only failed connections before accepting it.
    const homes=controller.buildings.filter(b=>b.kind==='dwelling' && b.intact && b.front);
    for(let pass=0;doors && pass<settings.gateAccessPasses;pass++) {
      let fixed=false;
      for(const home of homes) {
        const x=Math.floor(home.front.x),z=Math.floor(home.front.z),floor=Math.round(home.front.y);
        const y=Array.from({length:GOBLINS.surface.maxSlope*2+1},(_,i)=>floor+i-GOBLINS.surface.maxSlope).sort((a,b)=>Math.abs(a-floor)-Math.abs(b-floor)).find(y=>canStand(planned,x,y,z,2));
        if(y===undefined){doors=false;break;}
        const goal={x,y,z},route=findPath(planned,{x:Math.floor(anchor.x),y:Math.round(anchor.y),z:Math.floor(anchor.z)},goal,
          {maxNodes:settings.routeNodes,goalHeight:true});
        const end=route.at(-1);
        if(end?.x===x && end.y===y && end.z===z)continue;
        if(pass===settings.gateAccessPasses-1 || !planAccess(goal)){doors=false;break;}
        fixed=true;
      }
      if(!fixed)break;
    }
    if(!reachable || !doors) {
      if(process.env.GOBLIN_WALL_TRACE && outer)console.error(JSON.stringify({gateAttempt,reachable,doors,last:diagnostics?.lastGatePath}));
      if(diagnostics)diagnostics.gateRoute={anchor,gate:selectedGate,doors};
      if(gateAttempt+1<settings.gatePlanAttempts)return wallProject(world,controller,sourceBuildings,outer,diagnostics,gateAttempt+1);
      return reject(doors===false && reachable?'buildingRoute':'gateRoute');
    }
  }
  addBlockTasks(project, world, [...desired.values()], { order: (b) => b.id === BLOCK.AIR ? 0
    : b.ground ? 1000 + b.y : isLadder(b.id) ? 4000 + b.y : 2000 + b.y });
  wireShaftTasks(project, project.tasks.filter((t) => t.climb), GOBLINS.worker.reach);
  project.sort();
  project.onComplete=()=> {
    for(const wall of existingWalls) {
      for(const block of wall.blocks ?? []) {
        const replacement=desired.get(blockKey(block.x,block.y,block.z));
        if(replacement?.passage)block.id=replacement.id;
      }
    }
  };
  project.surface = true;
  project.site = { x: centerX, y: y0 + 1, z: centerZ, surface: true };
  project.building = { kind: 'wall', template: outer ? 'outerWall' : 'sectionWall',
    box: { x0, x1, z0, z1, y0, y1: y0 + settings.postHeight + 1 }, origin: { x: x0, y: y0, z: z0 },
    front: project.site, mainGate, gates: [...gates].map((key)=>{const [x,z]=key.split(',').map(Number);return {x:x+0.5,y:wallHeights.get(key)+1,z:z+0.5,...gateDirections.get(key)};}), blocks: [...desired.values()], footprint: perimeter, posts, intact: false };
  return project;
}
