// The Goblin Fortress in a match. GoblinController spawns the Totem, the
// King and the colony (Workers, Soldiers, Archers) from
// world.goblinFortress and runs everything they share: the Totem's storage
// (materials by name; nobody can open it), population and spawning, the
// active project and its tasks (goblinProjects.js), repairs to what they
// built, entrances and surfacing groups, surface buildings, and the switch
// to offscreen mode (goblinOffscreen.js) when no player is near. It also
// handles goblin damage and deaths for the Game. Numbers are in
// shared/goblins.js.

import { TICK_RATE, ITEM_POP_SPEED, ITEM_PICKUP_DELAY } from '../shared/config.js';
import { BLOCK, isSolid, isLadder, isWater, isFlowingWater } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { GOBLINS, goblinTicks, goblinCap } from '../shared/goblins.js';
import { MODULE_TYPES, CELL_HEIGHT, moduleAt, moduleBlocks, connectionBlocks, cellOrigin } from '../shared/goblinModules.js';
import { mulberry32 } from '../shared/structures.js';
import { rollLoot } from '../shared/loot.js';
import { S2C, ENTITY_TYPE } from '../shared/protocol.js';
import {
  GoblinTotem, GoblinKing, GoblinWorker, GoblinSoldier, GoblinArcher,
} from './goblin.js';
import {
  Project, blockKey, addBlockTasks, taskReady, taskSatisfied, yieldOf, isProtected,
  chooseModule, moduleProject, shaftCandidates, shaftProject, gatehouseProject,
  dwellingProject, plotProject, wallProject, entrancePoints, TREE_BLOCKS,
} from './goblinProjects.js';
import { OffscreenSim } from './goblinOffscreen.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
export const COLONY_TYPES = [ENTITY_TYPE.GOBLIN_WORKER, ENTITY_TYPE.GOBLIN_SOLDIER, ENTITY_TYPE.GOBLIN_ARCHER];
const CLASSES = {
  [ENTITY_TYPE.GOBLIN_WORKER]: GoblinWorker,
  [ENTITY_TYPE.GOBLIN_SOLDIER]: GoblinSoldier,
  [ENTITY_TYPE.GOBLIN_ARCHER]: GoblinArcher,
};
// Who climbs first out of a surfacing group.
const CLIMB_ORDER = { goblinSoldier: 0, goblinArcher: 1, goblinWorker: 2 };
const MATERIALS = ['stone', 'bricks', 'wood', 'planks', 'dirt', 'saplings'];
// Items a killed goblin's load drops as.
const MATERIAL_ITEMS = { stone: BLOCK.STONE, bricks: BLOCK.GOBLIN_BRICKS, wood: BLOCK.WOOD, planks: BLOCK.PLANKS,
  dirt: BLOCK.DIRT, saplings: ITEM.TREE_SEED };

export class GoblinController {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.worldSize = game.worldSize;
    this.fortress = game.world.goblinFortress ?? null;
    this.random = mulberry32(((game.seed ?? 1) ^ 0x60b1d2) >>> 0);
    this.storage = Object.fromEntries(MATERIALS.map((m) => [m, 0]));
    this.totem = null;
    this.totemAlive = false;
    this.king = null;
    // Colony goblins alive (not strays).
    this.members = new Set();
    this.slots = new Map();
    const modules = this.fortress?.modules ?? [];
    this.hall = modules.find((m) => m.feature?.kind === 'totem') ?? null;
    this.totemSpot = this.hall?.feature ?? null;

    // Projects. `project` is the active one; `repairs` collects fixes to
    // what the goblins built and always goes first.
    this.project = null;
    this.repairs = new Project('repairs', 'Repairs');
    this.nextProjectTick = 0;
    this.lastTrack = null;
    this.completed = [];
    // Blocks the goblins built and keep up (fortress, shafts, gatehouses):
    // key -> { x, y, z, id, climb }. Changes to them by anyone else become
    // repairs after GOBLINS.projects.repairDelay.
    this.intended = new Map();
    this.damage = new Map();
    this.selfChange = 0;
    // Entrances: { id, base, wall, columns, floorY, topY, gatehouse, open, top, step, outside, waiting, groupTarget }.
    this.entrances = [];
    // Surface buildings: { kind, template, capacity, box, origin, solid, saplings, post, front, intact }.
    this.buildings = [];
    this.buildingByBlock = new Map();
    this.damagedBuildings = new Set();
    this.intruders = [];
    this.alarmUntil = 0;
    this.alerted = false;
    this.lastIntruderPos = null;
    this.relocationStarted = false;
    this.relocationNew = null;
    this.relocated = false;
    this.wallSections = [];
    this.outerWallBuilt = false;
    this.wallFootprints = new Set();
    this.fastBuild = false;
    this.fastBuildIdle = 0;
    this.reserved = [];
    this.plotSaplings = new Set();
    this.naturalTreesChopped = 0;
    this.treeClaims = new Set();
    this.nextSpawnTick = 0;
    this.offscreen = false;
    // 'full' or 'offscreen' to pin the mode (tests); null decides by players.
    this.forceMode = null;
    this.nextModeCheck = 0;
    this.sim = new OffscreenSim(this);
    this.events = [];
    this.samples = [];
    this.stats = { forced: 0, dug: 0, placed: 0, chopped: 0, unstuck: 0 };
    this.shaftPlan = null;
    this.startPlanks = GOBLINS.start.extraPlanks;
    if (this.hall) {
      this.planFirstShaft();
      this.recordStartingFortress();
    }
  }

  // ---- Setup ----

  // The first surface shaft is planned at match start (from the seed), so the
  // starting planks can cover its ladders.
  planFirstShaft() {
    const candidates = shaftCandidates(this.world, this);
    if (!candidates.length) return;
    const facing = this.fortress.firstFace;
    const preferred = candidates.filter((c) => c.spec.parent === this.hall && c.spec.parent
      && (facing === 'N' ? c.spec.cell[2] < 0 : facing === 'S' ? c.spec.cell[2] > 1
        : facing === 'E' ? c.spec.cell[0] > 1 : c.spec.cell[0] < 0));
    const options = preferred.length ? preferred : candidates;
    const pick = options[Math.floor(this.random() * options.length)];
    this.shaftPlan = pick;
    const ladders = pick.top - cellOrigin(this.fortress, pick.spec.cell).y;
    this.startPlanks = ladders + GOBLINS.start.extraPlanks;
  }

  recordStartingFortress() {
    for (const module of this.fortress.modules) {
      for (const b of moduleBlocks(module)) this.intend(b);
    }
    for (const connection of this.fortress.connections) {
      for (const b of connectionBlocks(this.fortress, connection)) this.intend(b);
    }
  }

  // Records a block the goblins keep up.
  intend(b) {
    this.intended.set(blockKey(b.x, b.y, b.z), b);
  }

  add(mob) {
    this.game.mobs.set(mob.id, mob);
    return mob;
  }

  spawnAll() {
    if (!this.hall) return;
    const t = this.totemSpot;
    this.totem = this.add(new GoblinTotem(this.game.nextId++, this, t.x, t.y, t.z));
    this.totem.state.yaw = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[this.fortress.firstFace] ?? 0;
    this.totemAlive = true;
    const home = { x: t.x, y: t.y, z: t.z + 2.5 };
    this.king = this.add(new GoblinKing(this.game.nextId++, this, home.x, home.y, home.z, this.hallArena(), home));
    for (let i = 0; i < GOBLINS.start.workers; i++) this.spawnGoblin(ENTITY_TYPE.GOBLIN_WORKER, false, i + 1);
    this.storage.planks = this.startPlanks;
    this.storage.saplings = GOBLINS.start.saplings;
    this.nextSpawnTick = this.game.tick + goblinTicks(GOBLINS.population.spawnInterval, TICK_RATE);
    this.log('start', { planks: this.startPlanks, shaft: !!this.shaftPlan });
  }

  // The Totem Hall's floor, less a margin from its walls, as the King's arena.
  hallArena() {
    const b = this.hall.box, m = GOBLINS.king.wallMargin + GOBLINS.king.width / 2;
    return { x0: b.x0 + 1 + m, x1: b.x1 - m, z0: b.z0 + 1 + m, z1: b.z1 - m, y0: b.y0, y1: b.y1 };
  }

  // A colony goblin by the totem, spread around it.
  spawnGoblin(type, announce = true, slot = null) {
    const t = this.totemSpot;
    const angle = this.random() * Math.PI * 2;
    const goblin = new CLASSES[type](this.game.nextId++, this, t.x + Math.cos(angle) * 2.5, t.y, t.z + Math.sin(angle) * 2.5);
    this.members.add(goblin);
    if (slot !== null) { goblin.slot = slot; this.slots.set(slot, goblin); }
    this.add(goblin);
    if (announce) this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: goblin.describe() });
    return goblin;
  }

  // A goblin from a spawn egg at (x, y, z). Inside the fortress it joins the
  // colony (a King in the Totem Hall guards it); outside, it's a stray that
  // keeps to where it hatched.
  hatch(type, x, y, z) {
    const inFortress = this.fortress && moduleAt(this.fortress, x, y + 0.1, z);
    if (type === ENTITY_TYPE.GOBLIN_KING) {
      const inHall = inFortress === this.hall && this.hall;
      const r = GOBLINS.king.strayArena;
      const arena = inHall ? this.hallArena() : { x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y - 4, y1: y + 6 };
      return new GoblinKing(this.game.nextId++, this, x, y, z, arena, { x, y, z });
    }
    const goblin = new CLASSES[type](this.game.nextId++, this, x, y, z, { stray: !inFortress || !this.hall });
    if (!goblin.stray) this.members.add(goblin);
    return goblin;
  }

  // ---- Counts ----

  countOf(type) {
    let n = 0;
    for (const g of this.members) if (g.type === type) n++;
    return n;
  }

  population() {
    return this.members.size;
  }

  capacity() {
    const settings = GOBLINS.population;
    let capacity = this.hall ? settings.hallCapacity : 0;
    for (const m of this.fortress?.modules ?? []) {
      if (!m.building && !m.removed && MODULE_TYPES[m.type].capacity) capacity += MODULE_TYPES[m.type].capacity;
    }
    for (const b of this.buildings) if (b.kind === 'dwelling' && b.intact) capacity += b.capacity;
    return Math.min(capacity, goblinCap(GOBLINS.caps.population, this.worldSize));
  }

  brickModules() {
    return (this.fortress?.modules ?? []).filter((m) => !m.removed && !m.building
      && MODULE_TYPES[m.type].brick !== false).length;
  }

  dwellings() {
    return this.buildings.filter((b) => b.kind === 'dwelling' && b.intact).length;
  }

  plots() {
    return this.buildings.filter((b) => b.kind === 'plot').length;
  }

  // Wood in storage, counted as planks.
  woodStock() {
    return this.storage.wood * GOBLINS.materials.planksPerWood + this.storage.planks;
  }

  // Entrances, and shafts still being dug or widened (open: false), for
  // telling when a goblin is on a shaft column.
  shafts() {
    const out = [...this.entrances];
    const p = this.project;
    if (p?.kind === 'shaft' && p.entrance) out.push({ ...p.entrance, open: false });
    return out;
  }

  surfaceOpen() {
    return this.entrances.some((e) => e.open);
  }

  // Boxes goblin surface buildings, gatehouses and shafts occupy (for site checks).
  surfaceBoxes() {
    return this.reserved;
  }

  reserveSurface(box) {
    this.reserved.push(box);
  }

  releaseSurface(box) {
    this.reserved = this.reserved.filter((b) => b !== box);
  }

  // ---- Storage ----

  // Takes up to `count` of a material, converting stone into bricks and wood
  // into planks as needed; foundations and ground fill make do with stone
  // for dirt. Returns how many were taken.
  take(material, count) {
    const s = this.storage;
    if (material === 'bricks' && s.bricks < count) {
      const convert = Math.min(s.stone, count - s.bricks);
      s.stone -= convert;
      s.bricks += convert;
    }
    if (material === 'planks' && s.planks < count && s.wood > 0) {
      const per = GOBLINS.materials.planksPerWood;
      const logs = Math.min(s.wood, Math.ceil((count - s.planks) / per));
      s.wood -= logs;
      s.planks += logs * per;
    }
    if (material === 'dirt' && s.dirt < count) {
      const got = s.dirt;
      s.dirt = 0;
      const rest = Math.min(s.stone, count - got);
      s.stone -= rest;
      return got + rest;
    }
    const got = Math.min(s[material] ?? 0, count);
    s[material] -= got;
    return got;
  }

  // How much of a material could be taken (with conversions).
  available(material) {
    const s = this.storage;
    if (material === 'bricks') return s.bricks + s.stone;
    if (material === 'planks') return s.planks + s.wood * GOBLINS.materials.planksPerWood;
    if (material === 'dirt') return s.dirt + s.stone;
    return s[material] ?? 0;
  }

  store(material, count) {
    if (!material || count <= 0) return;
    this.storage[material] = (this.storage[material] ?? 0) + count;
  }

  deposit(goblin) {
    for (const [material, count] of goblin.carrying) this.store(material, count);
    goblin.carrying.clear();
  }

  storageContents() {
    return { ...this.storage };
  }

  // ---- Blocks ----

  // A block change made by goblins (not treated as damage).
  setBlock(x, y, z, id) {
    this.selfChange++;
    try {
      this.world.setBlock(x, y, z, id);
    } finally {
      this.selfChange--;
    }
  }

  // Breaks a block the way a player would (drops and all): for obstacles
  // and containers.
  breakObstacle(x, y, z) {
    this.selfChange++;
    try {
      this.game.breakBlock(x, y, z);
    } finally {
      this.selfChange--;
    }
  }

  // Called by the Game for every block change.
  blockChanged(x, y, z, id) {
    if (this.selfChange) return;
    const key = blockKey(x, y, z);
    const building = this.buildingByBlock.get(key);
    if (building) this.damagedBuildings.add(building);
    const want = this.intended.get(key);
    if (!want || want.id === id) return;
    if (!this.damage.has(key)) this.damage.set(key, this.game.tick + ticks(GOBLINS.projects.repairDelay));
  }

  // ---- Tasks ----

  // Projects with work, in the order goblins look at them: repairs first.
  activeProjects() {
    const out = [];
    if (!this.totemAlive) return out;
    if (this.repairs.remaining > 0) out.push(this.repairs);
    if (this.project) out.push(this.project);
    return out;
  }

  // The next ready, unclaimed task of `kind` ('dig' | 'place') for a goblin,
  // claimed for it: among the first few in order, the nearest. Tasks already
  // satisfied are completed on the way. `filter(task)` can skip some.
  claimTask(goblin, kind, filter = () => true) {
    const tick = this.game.tick;
    for (const project of this.activeProjects()) {
      const options = [];
      for (const task of project.tasks) {
        if (task.done || task.claimedBy || task.kind !== kind) continue;
        if (task.requires.some((t) => !t.done)) continue;
        if (taskSatisfied(task, this.world)) {
          this.finishTask(task, null);
          continue;
        }
        if (!taskReady(task, this.world, tick) || !filter(task)) continue;
        options.push(task);
        if (options.length >= 8) break;
      }
      if (!options.length) continue;
      const s = goblin.state;
      const cost = (t) => (t.order - options[0].order) * 0.3 + Math.hypot(t.x - s.x, (t.y - s.y) * 2, t.z - s.z);
      options.sort((a, b) => cost(a) - cost(b));
      const task = options[0];
      task.claimedBy = goblin.id;
      return task;
    }
    return null;
  }

  // Pending tasks of a kind across active projects.
  pendingCount(kind) {
    let n = 0;
    for (const project of this.activeProjects()) for (const t of project.tasks) if (!t.done && t.kind === kind) n++;
    return n;
  }

  releaseTask(task) {
    if (task && !task.done) task.claimedBy = null;
  }

  // Couldn't reach it: try later; after a few tries it's done for them (so
  // one awkward block never stalls a project).
  failTask(task) {
    if (!task || task.done) return;
    task.claimedBy = null;
    task.attempts++;
    task.blockedUntil = this.game.tick + ticks(8);
    if (task.attempts >= 4) {
      this.log('forced', { project: task.project.kind, kind: task.kind, id: task.id, x: task.x, y: task.y, z: task.z,
        climb: !!task.climb });
      this.forceTask(task);
      this.stats.forced++;
    }
  }

  // Applies a task's change directly (a stuck task, or offscreen work).
  // Returns the material the dug block yields, or null.
  forceTask(task) {
    const current = this.world.getBlock(task.x, task.y, task.z);
    let got = null;
    if (!isProtected(current)) {
      if (task.kind === 'dig') {
        got = yieldOf(current);
        this.setBlock(task.x, task.y, task.z, BLOCK.AIR);
      } else {
        this.setBlock(task.x, task.y, task.z, task.id);
      }
    }
    this.finishTask(task, null);
    return got;
  }

  // Marks a task done (the block is already changed).
  finishTask(task, goblin) {
    if (task.done) return;
    task.done = true;
    task.claimedBy = null;
    task.project.done++;
    const key = task.key;
    if (this.intended.has(key)) {
      const want = task.project.intended.get(key);
      if (want) this.intended.set(key, want);
    }
    this.damage.delete(key);
    if (task.project === this.repairs) {
      const building = this.buildingByBlock.get(key);
      if (building) this.damagedBuildings.add(building);
    }
    if (task.project.breakthroughTask === task) this.breakthrough();
  }

  // ---- Projects ----

  // The first surface shaft reached the sky: the one goblin event besides
  // the Totem falling that everyone hears about.
  breakthrough() {
    if (this.brokeThrough) return;
    this.brokeThrough = true;
    const text = 'The goblins have broken through to the surface!';
    this.game.broadcast({ type: S2C.CHAT, text, kind: 'event' });
    this.log('breakthrough');
    console.log(text);
  }

  startProject(project) {
    if (!project) return false;
    project.startTick = this.game.tick;
    project.tripTime = this.sim.tripTime(project);
    this.project = project;
    this.log('startProject', { kind: project.kind, label: project.label, tasks: project.total });
    return true;
  }

  // Picks the next project by priority (see GOBLINS.projects).
  chooseProject() {
    const world = this.world;
    const random = this.random;
    // The first shaft, then a gatehouse for any entrance without one.
    if (!this.entrances.length) {
      if (!this.shaftPlan) return null;
      const plan = this.shaftPlan;
      this.shaftPlan = null;
      return this.shaftFrom(plan, 'Surface shaft');
    }
    const bare = this.entrances.find((e) => !e.gatehouse && !e.sealed);
    if (bare) return this.gatehouseFor(bare);
    if (this.relocationNew?.gatehouse && !this.relocated) return this.plugOldEntrance();
    // Low on wood: a tree plot, if there's room for another.
    if ((this.fastBuild || this.woodStock() < GOBLINS.materials.woodLow)
      && this.plots() < goblinCap(GOBLINS.caps.plots, this.worldSize)) {
      const plot = plotProject(world, this, random);
      if (plot) return this.surfaceBuilding(plot);
    }
    const relocation = this.relocationNext();
    if (relocation) return relocation;
    const wall = this.wallNext();
    if (wall) return wall;
    // Alternate fortress modules and surface dwellings; either one alone
    // when the other is capped or has nowhere to go.
    const moduleDue = this.brickModules() < goblinCap(GOBLINS.caps.modules, this.worldSize);
    const hardCap = goblinCap(GOBLINS.caps.population, this.worldSize);
    const dwellingDue = this.dwellings() < goblinCap(GOBLINS.caps.dwellings, this.worldSize)
      && (this.fastBuild || (this.population() >= this.capacity() - GOBLINS.projects.dwellingSlack && this.capacity() < hardCap));
    const tracks = [];
    if (moduleDue) tracks.push('module');
    if (dwellingDue) tracks.push('dwelling');
    if (tracks.length === 2 && this.lastTrack === tracks[0]) tracks.reverse();
    for (const track of tracks) {
      const project = track === 'module' ? this.moduleNext() : this.dwellingNext();
      if (project) {
        this.lastTrack = track;
        return project;
      }
    }
    return null;
  }

  moduleNext() {
    const spec = chooseModule(this.world, this, this.random, { ladders: this.woodStock() >= CELL_HEIGHT + 2 });
    return spec ? moduleProject(this.world, this, spec) : null;
  }

  // A dwelling, if the wood it needs is in storage or can still be had
  // (plot trees, or natural trees left to chop).
  dwellingNext() {
    const project = dwellingProject(this.world, this, this.random);
    if (!project) return null;
    const wood = project.tasks.filter((t) => t.material === 'planks' || t.material === 'wood').length;
    const canGet = this.plots() > 0 || this.woodSources().length > 0;
    if (wood > this.woodStock() && !canGet) {
      this.releaseSurface(project.building.box);
      return null;
    }
    return this.surfaceBuilding(project);
  }

  surfaceBuilding(project) {
    const building = project.building;
    if (building.kind === 'plot') for (const sp of building.saplings) this.plotSaplings.add(blockKey(sp.x, sp.y, sp.z));
    project.onComplete = () => {
      building.intact = true;
      building.solid = [...project.intended.values()].filter((b) => isSolid(b.id) && !b.foundation && !b.ground);
      for (const b of project.intended.values()) {
        if (b.grows && b.id === BLOCK.SAPLING) continue;
        this.intend(b);
        this.buildingByBlock.set(blockKey(b.x, b.y, b.z), building);
      }
      this.buildings.push(building);
    };
    return project;
  }

  wallNext() {
    const dwellings = this.buildings.filter((b) => b.kind === 'dwelling' && b.intact);
    const settings = GOBLINS.walls;
    if (dwellings.length < settings.startBuildings) return null;
    const outer = !this.outerWallBuilt && dwellings.length >= goblinCap(GOBLINS.caps.dwellings, this.worldSize);
    const open = dwellings.filter((b) => !b.walled);
    if (!outer && open.length < settings.sectionSize) return null;
    const groups = outer
      ? [this.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind) && b.intact)]
      : open.map((first) => [...open].sort((a, b) =>
        Math.hypot(a.front.x - first.front.x, a.front.z - first.front.z)
        - Math.hypot(b.front.x - first.front.x, b.front.z - first.front.z)).slice(0, settings.sectionSize));
    for (const group of groups) {
      const project = wallProject(this.world, this, group, outer);
      if (!project) continue;
      this.surfaceBuilding(project);
      const built = project.onComplete;
      project.onComplete = () => {
        built();
        for (const key of project.building.footprint) this.wallFootprints.add(key);
        for (const post of project.building.posts) {
          const x = Math.floor(post.post.x), y = Math.floor(post.post.y), z = Math.floor(post.post.z);
          this.buildings.push({ kind: 'wallPost', ...post, intact: true,
            box: { x0: x - 1, x1: x + 1, y0: y - 1, y1: y, z0: z - 1, z1: z + 1 } });
        }
        if (outer) this.outerWallBuilt = true;
        else {
          this.wallSections.push(project.building);
          for (const b of group) b.walled = true;
        }
      };
      return project;
    }
    return null;
  }

  shaftFrom(plan, label) {
    const project = shaftProject(this.world, this, plan, label);
    if (!project) return null;
    const moduleDone = project.onComplete;
    project.onComplete = () => {
      moduleDone();
      const entrance = { id: this.entrances.length, ...project.entrance, gatehouse: null, open: true,
        waiting: new Map(), groupTarget: this.groupTarget() };
      Object.assign(entrance, entrancePoints(entrance));
      this.entrances.push(entrance);
      if (plan.width === GOBLINS.projects.relocationWidth) this.relocationNew = entrance;
    };
    return project;
  }

  gatehouseFor(entrance) {
    const project = gatehouseProject(this.world, this, entrance);
    project.onComplete = () => {
      entrance.gatehouse = project.building;
      this.buildings.push({ ...project.building, kind: 'gatehouse', intact: true });
    };
    return project;
  }

  // Once established, pick the farthest reachable ground-floor parent whose
  // shaft emerges close to the existing surface base.
  relocationNext() {
    const settings = GOBLINS.projects;
    if (this.relocationStarted || this.dwellings() < settings.relocationBuildings
      || this.brickModules() < goblinCap(settings.relocationModules, this.worldSize)) return null;
    const distances = new Map([[this.hall.id, 0]]);
    const queue = [this.hall.id];
    for (const id of queue) for (const connection of this.fortress.connections) {
      const next = connection.a === id ? connection.b : connection.b === id ? connection.a : null;
      if (next === null || distances.has(next)) continue;
      distances.set(next, distances.get(id) + 1);
      queue.push(next);
    }
    const base = this.buildings.filter((b) => b.intact && b.kind === 'dwelling');
    const candidates = shaftCandidates(this.world, this).filter((candidate) => {
      const p = candidate.spec.parent;
      return p && (distances.get(p.id) ?? 0) >= 2
        && base.some((building) => Math.hypot(candidate.column.x - building.front.x,
          candidate.column.z - building.front.z) <= settings.relocationNearBase);
    });
    candidates.sort((a, b) => (distances.get(b.spec.parent.id) ?? 0) - (distances.get(a.spec.parent.id) ?? 0));
    const pick = candidates[0];
    if (!pick || pick.top - pick.spec.parent.floorY + 10 > this.woodStock()) return null;
    const project = this.shaftFrom({ ...pick, width: settings.relocationWidth }, 'Relocated entrance');
    if (project) this.relocationStarted = true;
    return project;
  }

  plugOldEntrance() {
    const old = this.entrances[0];
    if (!old || old.sealed) return null;
    const project = new Project('relocationPlug', 'Seal old entrance');
    const blocks = new Map();
    const put = (b) => blocks.set(blockKey(b.x, b.y, b.z), b);
    const gatehouse = this.buildings.find((b) => b.kind === 'gatehouse' && b.box === old.gatehouse?.box);
    for (const b of gatehouse?.blocks ?? []) {
      if (b.ground || b.foundation) continue;
      put({ x: b.x, y: b.y, z: b.z, id: BLOCK.AIR });
      const key = blockKey(b.x, b.y, b.z);
      this.intended.delete(key);
      this.buildingByBlock.delete(key);
    }
    for (const column of old.columns) for (let y = old.floorY; y <= old.topY; y++) {
      put({ x: column.x, y, z: column.z, id: BLOCK.GOBLIN_BRICKS });
    }
    addBlockTasks(project, this.world, [...blocks.values()], { order: (b) => b.id === BLOCK.AIR ? 0 : 10000 - b.y });
    project.sort();
    project.site = old.step;
    project.onComplete = () => {
      old.open = false;
      old.sealed = true;
      if (gatehouse) this.buildings = this.buildings.filter((b) => b !== gatehouse);
      old.gatehouse = null;
      for (const b of project.intended.values()) this.intend(b);
      this.relocated = true;
      this.log('entranceRelocation', { from: old.id, to: this.relocationNew.id });
    };
    return project;
  }

  // The active project is done: check its blocks, then wrap it up.
  finishProject() {
    const project = this.project;
    // Anything changed since (sabotage, water) goes back on the list.
    const redo = [];
    for (const b of project.intended.values()) {
      const current = this.world.getBlock(b.x, b.y, b.z);
      if (current === b.id || isProtected(current) || (b.ground && isSolid(current))) continue;
      if (b.grows && TREE_BLOCKS.has(current)) continue;
      if (b.id === BLOCK.AIR && !isSolid(current) && !isWater(current) && !isLadder(current)) continue;
      redo.push(b);
    }
    if (redo.length && (project.redoRounds ?? 0) < 3) {
      project.redoRounds = (project.redoRounds ?? 0) + 1;
      addBlockTasks(project, this.world, redo, {});
      project.sort();
      return;
    }
    project.onComplete?.();
    if (['module', 'shaft', 'gatehouse', 'relocationPlug'].includes(project.kind)) {
      for (const b of project.intended.values()) this.intend(b);
    }
    this.completed.push({ kind: project.kind, label: project.label, tick: this.game.tick,
      seconds: (this.game.tick - project.startTick) / TICK_RATE, offscreen: this.offscreen });
    this.log('finishProject', { kind: project.kind, label: project.label,
      seconds: Math.round((this.game.tick - project.startTick) / TICK_RATE) });
    this.project = null;
    this.nextProjectTick = this.game.tick;
  }

  updateProjects(tick) {
    if (!this.totemAlive) return;
    if (tick % ticks(30) === 0) this.checkWoodStarved();
    if (this.project && this.project.remaining === 0) this.finishProject();
    if (!this.project && tick >= this.nextProjectTick) {
      if (!this.startProject(this.chooseProject())) this.nextProjectTick = tick + ticks(20);
    }
    // Damage that's still there after the delay becomes repair tasks.
    if (tick % 10 === 0 && this.damage.size) {
      const due = [];
      for (const [key, when] of this.damage) {
        if (when > tick) continue;
        this.damage.delete(key);
        const want = this.intended.get(key);
        if (!want) continue;
        const current = this.world.getBlock(want.x, want.y, want.z);
        if (current === want.id) continue;
        if (this.repairs.byKey.get(key)?.some((t) => !t.done)) continue;
        // Flowing water drains once its source is gone: sources first.
        if (isFlowingWater(current) && want.id === BLOCK.AIR) {
          this.damage.set(key, tick + ticks(GOBLINS.projects.repairDelay * 3));
          continue;
        }
        due.push(current === BLOCK.WATER ? { ...want, order: -1 } : want);
      }
      if (due.length) {
        if (this.repairs.remaining === 0) {
          this.repairs = new Project('repairs', 'Repairs');
          this.repairs.startTick = tick;
        }
        addBlockTasks(this.repairs, this.world, due, { order: (b) => b.order ?? 0 });
        this.repairs.sort();
        this.log('repairs', { blocks: due.length });
      }
    }
  }

  // Placements that need wood when there's none and no way left to get any
  // (no plot, natural trees used up) would stall the project for good:
  // they're dropped instead.
  checkWoodStarved() {
    // Saplings only come back from plot harvests: plant what there is, and
    // the plot's empty spots get replanted later.
    const carriedSaplings = [...this.members].some((g) => g.carrying?.get('saplings') > 0);
    if (this.storage.saplings === 0 && !carriedSaplings) {
      for (const project of this.activeProjects()) {
        for (const t of project.tasks) {
          if (t.done || t.material !== 'saplings') continue;
          project.intended.delete(t.key);
          this.finishTask(t, null);
        }
      }
    }
    if (this.available('planks') > 0 || this.woodSources().length || this.emptyPlotSpots().length) return;
    if (this.buildings.some((b) => b.kind === 'plot')) return;
    for (const project of this.activeProjects()) {
      // Ladders are never skipped (a shaft without them is useless).
      const starved = project.tasks.filter((t) => !t.done && (t.material === 'planks' || t.material === 'wood')
        && !isLadder(t.id));
      if (!starved.length) continue;
      // A dwelling of wood can't be built at all: give it up.
      if (project.kind === 'dwelling') {
        this.releaseSurface(project.building.box);
        this.log('cancelProject', { label: project.label, reason: 'wood' });
        this.project = null;
        this.nextProjectTick = this.game.tick + goblinTicks(GOBLINS.projects.cooldown, TICK_RATE);
        continue;
      }
      for (const t of starved) {
        project.intended.delete(t.key);
        this.finishTask(t, null);
      }
      this.log('woodSkipped', { project: project.label, blocks: starved.length });
    }
  }

  // ---- Population ----

  groupTarget() {
    const [low, high] = GOBLINS.surfacing.groupSize;
    return low + Math.floor(this.random() * (high - low + 1));
  }

  // The next open slot determines the goblin type in every match.
  neededType() {
    const slot = this.nextOpenSlot();
    const { slots, repeatSlots } = GOBLINS.population;
    return slot <= slots.length ? slots[slot - 1] : repeatSlots[(slot - slots.length - 1) % repeatSlots.length];
  }

  nextOpenSlot() {
    for (let slot = 1; slot <= this.capacity(); slot++) if (!this.slots.has(slot)) return slot;
    return null;
  }

  updateSpawning(tick) {
    if (this.fastBuild) this.nextSpawnTick = tick;
    if (!this.totemAlive || tick < this.nextSpawnTick) return;
    const slot = this.nextOpenSlot();
    if (slot === null) return;
    const goblin = this.spawnGoblin(this.neededType(), true, slot);
    if (this.offscreen) this.sim.place(goblin);
    this.log('spawn', { type: goblin.type });
    this.nextSpawnTick = tick + goblinTicks(GOBLINS.population.spawnInterval, TICK_RATE);
  }

  // Materials pending placements still need (stone counting as bricks).
  reservedFor(material) {
    let n = 0;
    for (const project of this.activeProjects()) {
      for (const t of project.tasks) {
        if (t.done) continue;
        if (t.material === material || (material === 'stone' && t.material === 'bricks')) n++;
      }
    }
    if (material === 'stone') n = Math.max(0, n - this.storage.bricks);
    return n;
  }

  // ---- Surfacing ----

  // A goblin waiting at the bottom of an entrance to climb out. True once
  // its group has been let go and its turn has come.
  gather(entrance, goblin) {
    const tick = this.game.tick;
    let entry = entrance.waiting.get(goblin.id);
    if (!entry) {
      entry = { goblin, since: tick, release: null };
      entrance.waiting.set(goblin.id, entry);
    }
    entry.seen = tick;
    if (entry.release !== null && tick >= entry.release) {
      entrance.waiting.delete(goblin.id);
      return true;
    }
    return false;
  }

  // Where a waiting goblin stands: around the shaft base's middle.
  gatherSpot(entrance, goblin) {
    const c = entrance.base.center;
    const angle = goblin.id * 2.4;
    return { x: c.x + Math.cos(angle) * 1.4, y: entrance.floorY, z: c.z + Math.sin(angle) * 1.4 };
  }

  updateSurfacing(tick) {
    const settings = GOBLINS.surfacing;
    for (const entrance of this.entrances) {
      for (const entry of [...entrance.waiting.values()]) {
        if (entry.goblin.dead || tick - entry.seen > ticks(2)) entrance.waiting.delete(entry.goblin.id);
      }
      const held = [...entrance.waiting.values()].filter((e) => e.release === null);
      if (!held.length) continue;
      const oldest = Math.min(...held.map((e) => e.since));
      if (held.length < entrance.groupTarget && tick - oldest < ticks(settings.gatherTime)) continue;
      held.sort((a, b) => (CLIMB_ORDER[a.goblin.type] ?? 9) - (CLIMB_ORDER[b.goblin.type] ?? 9) || a.since - b.since);
      held.forEach((entry, i) => { entry.release = tick + ticks(settings.stagger) * i; });
      this.stats.surfacings = (this.stats.surfacings ?? 0) + 1;
      entrance.groupTarget = this.groupTarget();
    }
  }

  // ---- Guards ----

  // Spots soldiers and archers patrol: modules, entrances and dwellings.
  patrolSpots() {
    const spots = [];
    const modules = (this.fortress?.modules ?? []).filter((m) => !m.building && !m.removed);
    for (const m of modules) spots.push({ kind: 'fortress', x: m.center.x, y: m.floorY, z: m.center.z });
    for (const e of this.entrances) if (e.open) spots.push({ kind: 'entrance', ...(e.gatehouse ? e.outside : e.step) });
    for (const b of this.buildings) if (b.kind === 'dwelling' && b.intact) spots.push({ kind: 'dwelling', ...b.front });
    return spots;
  }

  // A lookout post for an archer, claimed, or null.
  claimPost(archer) {
    for (const b of this.buildings) {
      if (!b.post || !b.intact) continue;
      if (b.postHolder && !b.postHolder.dead && b.postHolder !== archer) continue;
      b.postHolder = archer;
      return b.post;
    }
    return null;
  }

  // ---- Wood ----

  // Grown trees in plots, and natural trees near an entrance (while the
  // natural allowance lasts): [{ x, y, z, plot, spot }] (the lowest log).
  woodSources() {
    const out = [];
    for (const b of this.buildings) {
      if (b.kind !== 'plot') continue;
      for (const s of b.saplings) {
        if (this.world.getBlock(s.x, s.y, s.z) === BLOCK.WOOD) out.push({ x: s.x, y: s.y, z: s.z, plot: b, spot: s });
      }
    }
    if (!out.length && this.naturalTreesChopped + this.treeClaims.size < GOBLINS.caps.naturalTrees) out.push(...this.naturalTrees());
    return out.filter((t) => !this.treeClaims.has(blockKey(t.x, t.y, t.z)));
  }

  // Plot spots that lost their sapling (or tree) and can take a new one.
  emptyPlotSpots() {
    const out = [];
    for (const b of this.buildings) {
      if (b.kind !== 'plot') continue;
      for (const s of b.saplings) {
        const soil = this.world.getBlock(s.x, s.y - 1, s.z);
        if (this.world.getBlock(s.x, s.y, s.z) === BLOCK.AIR && (soil === BLOCK.GRASS || soil === BLOCK.DIRT)
          && !this.treeClaims.has(blockKey(s.x, s.y, s.z))) out.push({ ...s, plot: b, spot: s, replant: true });
      }
    }
    return out;
  }

  naturalTrees() {
    if (this.cachedTrees && this.game.tick - this.cachedTrees.tick < ticks(10)) return this.cachedTrees.trees;
    const trees = [];
    const radius = GOBLINS.surface.treeRadius;
    const world = this.world;
    for (const e of this.entrances) {
      if (!e.open) continue;
      const cx = Math.floor(e.top.x), cz = Math.floor(e.top.z);
      for (let z = cz - radius; z <= cz + radius; z++) for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.hypot(x - cx, z - cz) > radius || x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) continue;
        const top = world.naturalTop[x + world.sizeX * z];
        if (top < -30000) continue;
        for (let y = top - 2; y <= top + 3; y++) {
          if (world.getBlock(x, y, z) !== BLOCK.WOOD) continue;
          const below = world.getBlock(x, y - 1, z);
          if (below !== BLOCK.GRASS && below !== BLOCK.DIRT) continue;
          // Not on goblin building sites (a plot's own young trees included).
          if (this.reserved.some((b) => x >= b.x0 - 2 && x <= b.x1 + 2 && z >= b.z0 - 2 && z <= b.z1 + 2)) continue;
          if (!this.clearOfOthers(x, z)) continue;
          trees.push({ x, y, z, plot: null, d: Math.hypot(x - cx, z - cz) });
        }
      }
    }
    trees.sort((a, b) => a.d - b.d);
    this.cachedTrees = { tick: this.game.tick, trees };
    return trees;
  }

  // Away from keeps, structures and rivers (for chopping).
  clearOfOthers(x, z) {
    const margin = GOBLINS.surface.clearance;
    return !this.world.keeps.some((k) => Math.abs(x - k.cx) <= 12 + margin && Math.abs(z - k.cz) <= 12 + margin)
      && !this.world.structures.some((s) => s.box && s.kind !== 'goblinFortress' && x >= s.box.x0 - margin
        && x <= s.box.x1 + margin && z >= s.box.z0 - margin && z <= s.box.z1 + margin)
      && !this.world.riverColumns?.has(`${x},${z}`);
  }

  claimTree(tree) {
    this.treeClaims.add(blockKey(tree.x, tree.y, tree.z));
  }

  releaseTree(tree) {
    this.treeClaims.delete(blockKey(tree.x, tree.y, tree.z));
  }

  // A tree has been felled (its trunk is gone).
  treeFelled(tree) {
    this.releaseTree(tree);
    if (!tree.plot) this.naturalTreesChopped++;
    this.stats.chopped++;
    this.cachedTrees = null;
  }

  // Wood is wanted when storage is short of it.
  woodWanted() {
    return this.woodStock() < GOBLINS.materials.woodWanted;
  }

  // Plot saplings grow on the goblin clock.
  saplingGrowTime(x, y, z) {
    if (!this.plotSaplings.has(blockKey(x, y, z))) return null;
    const [low, high] = GOBLINS.plots.growTime;
    return (low + Math.random() * (high - low)) / GOBLINS.goblinTimeScale;
  }

  // ---- Offscreen mode ----

  // Every point a player must be near for full simulation.
  watchPoints() {
    const points = [];
    if (this.fortress) {
      for (const m of this.fortress.modules) if (!m.removed) points.push(m.center);
    }
    for (const e of this.entrances) points.push(e.top);
    for (const b of this.buildings) {
      if (b.box) points.push({ x: (b.box.x0 + b.box.x1) / 2, y: b.origin?.y ?? b.box.y0,
        z: (b.box.z0 + b.box.z1) / 2 });
      else if (b.post) points.push(b.post);
    }
    if (this.project?.site) points.push(this.project.site);
    for (const g of this.members) points.push(g.state);
    return points;
  }

  playerNear() {
    const range = GOBLINS.offscreen.range;
    const players = [...this.game.players.values()].filter((p) => !p.dead && p.connected);
    if (!players.length) return false;
    const points = this.watchPoints();
    return players.some((p) => points.some((q) => Math.abs(q.x - p.state.x) <= range && Math.abs(q.z - p.state.z) <= range
      && Math.hypot(q.x - p.state.x, q.y - p.state.y, q.z - p.state.z) <= range));
  }

  updateMode(tick) {
    if (tick < this.nextModeCheck) return;
    this.nextModeCheck = tick + ticks(GOBLINS.offscreen.checkInterval);
    const offscreen = this.forceMode ? this.forceMode === 'offscreen' : !this.playerNear();
    if (offscreen === this.offscreen) return;
    this.offscreen = offscreen;
    if (offscreen) this.sim.enter();
    else this.sim.leave();
    this.log(offscreen ? 'offscreen' : 'onscreen');
  }

  // Colony goblins stand still offscreen (the simulation places them).
  frozen(mob) {
    return this.offscreen && this.members.has(mob);
  }

  // Fortress guards resting at their spots and the King at home need no
  // physics or AI until a player enters a module. Travelers and workers run.
  sleeping(mob) {
    if (!mob.goblin || mob.stray || this.alerted || this.intruders?.length
      || mob.type === ENTITY_TYPE.GOBLIN_WORKER || mob.type === ENTITY_TYPE.GOBLIN_TOTEM
      || mob.target || mob.climbing || mob.route?.actions?.length) return false;
    const s = mob.state;
    if (!this.fortress || !moduleAt(this.fortress, s.x, s.y + 0.1, s.z)) return false;
    if (mob.type === ENTITY_TYPE.GOBLIN_KING) return Math.hypot(s.x - mob.home.x, s.z - mob.home.z) < 0.7;
    return !!mob.arrived && !!mob.spot && s.onGround;
  }

  // ---- Tick ----

  // Once per tick, before mobs move.
  update(tick) {
    if (!this.hall) return;
    this.updateInvasion(tick);
    this.updateMode(tick);
    this.updateProjects(tick);
    this.updateSpawning(tick);
    this.updateSurfacing(tick);
    if (this.offscreen) this.sim.tick(tick);
    if (this.fastBuild) {
      this.game.saplings?.fastForward(tick + ticks(GOBLINS.creativeBoost.growthAheadSeconds));
      this.fastBuildIdle = this.project || this.repairs.remaining || this.sim.starved ? 0 : this.fastBuildIdle + 1;
      const atCaps = this.brickModules() >= goblinCap(GOBLINS.caps.modules, this.worldSize)
        && this.dwellings() >= goblinCap(GOBLINS.caps.dwellings, this.worldSize)
        && this.plots() >= goblinCap(GOBLINS.caps.plots, this.worldSize)
        && this.relocated && this.outerWallBuilt;
      if (atCaps || this.fastBuildIdle >= GOBLINS.creativeBoost.idleStopTicks) {
        this.fastBuild = false;
        this.forceMode = null;
        this.nextModeCheck = 0;
        this.log('fastBuildFinished', { atCaps });
      }
    }
    if (this.damagedBuildings.size) this.checkBuildings();
    if (tick % ticks(1) === 0) this.sendStatus();
    if (tick % ticks(10) === 0) this.sample(tick);
  }

  startFastBuild() {
    if (!this.totemAlive) return false;
    for (const material of MATERIALS) this.store(material, GOBLINS.creativeBoost.materialGrant);
    this.fastBuild = true;
    this.fastBuildIdle = 0;
    this.forceMode = 'offscreen';
    this.nextModeCheck = 0;
    this.log('fastBuildStarted');
    return true;
  }

  updateInvasion(tick) {
    if (tick % GOBLINS.invasion.scanTicks !== 0) return;
    const modules = this.fortress.modules.filter((m) => !m.building && !m.removed);
    this.intruders = [...this.game.players.values()].filter((player) => !player.dead && player.connected
      && modules.some((m) => player.state.x >= m.box.x0 && player.state.x <= m.box.x1 + 1
        && player.state.y >= m.box.y0 && player.state.y <= m.box.y1 + 1
        && player.state.z >= m.box.z0 && player.state.z <= m.box.z1 + 1));
    if (this.intruders.length) {
      this.alarmUntil = tick + ticks(GOBLINS.invasion.calmSeconds);
      const s = this.intruders[0].state;
      this.lastIntruderPos = { x: s.x, y: s.y, z: s.z };
    }
    const alerted = this.intruders.length > 0 || tick < this.alarmUntil;
    if (alerted === this.alerted) return;
    this.alerted = alerted;
    for (const member of this.members) {
      if (member.type !== ENTITY_TYPE.GOBLIN_ARCHER && member.type !== ENTITY_TYPE.GOBLIN_SOLDIER) continue;
      member.spot = null;
      member.route = null;
      if (member.post) {
        for (const building of this.buildings) if (building.postHolder === member) building.postHolder = null;
        member.post = null;
      }
    }
  }

  // Dwellings that lost too many blocks stop counting (goblins may build
  // another later, as a normal project).
  checkBuildings() {
    for (const b of this.damagedBuildings) {
      if (!b.solid?.length || b.kind !== 'dwelling') continue;
      let missing = 0;
      for (const block of b.solid) if (this.world.getBlock(block.x, block.y, block.z) !== block.id) missing++;
      const intact = missing / b.solid.length < 0.3;
      if (b.intact && !intact) this.log('dwellingLost', { template: b.template });
      b.intact = intact;
    }
    this.damagedBuildings.clear();
  }

  // ---- Inspector ----

  status() {
    const project = this.repairs.remaining > 0 ? this.repairs : this.project;
    const cooldown = !this.project && this.totemAlive ? Math.max(0, (this.nextProjectTick - this.game.tick) / TICK_RATE) : 0;
    return {
      type: S2C.GOBLIN_STATUS,
      totemId: this.totem?.id ?? null,
      totemAlive: this.totemAlive,
      storage: this.storageContents(),
      project: project ? { kind: project.kind, label: project.label, progress: project.progress(),
        done: project.done, total: project.total,
        waiting: [...this.members].some((g) => g.waitingFor) || this.sim.starved } : null,
      nextProjectIn: Math.round(cooldown),
      population: Object.fromEntries(COLONY_TYPES.map((t) => [t, this.countOf(t)])),
      total: this.population(),
      capacity: this.capacity(),
      hardCap: goblinCap(GOBLINS.caps.population, this.worldSize),
      modules: this.brickModules(),
      moduleCap: goblinCap(GOBLINS.caps.modules, this.worldSize),
      dwellings: this.dwellings(),
      dwellingCap: goblinCap(GOBLINS.caps.dwellings, this.worldSize),
      plots: this.plots(),
      walls: this.wallSections.length + Number(this.outerWallBuilt),
      outerWall: this.outerWallBuilt,
      entrances: this.entrances.map((e) => ({ width: e.width ?? 1, gatehouse: !!e.gatehouse, sealed: !!e.sealed })),
      relocation: this.relocated ? 'complete' : this.relocationNew ? 'new entrance' : this.relocationStarted ? 'digging' : 'pending',
      offscreen: this.offscreen,
    };
  }

  // To creative players only.
  sendStatus() {
    const creative = [...this.game.players.values()].filter((p) => p.creative && p.connected);
    if (!creative.length) return;
    const msg = this.status();
    for (const p of creative) this.game.send(p, msg);
  }

  // ---- Log (tests and debugging) ----

  log(event, data = {}) {
    this.events.push({ tick: this.game.tick, event, ...data });
    if (this.events.length > 20000) this.events.shift();
  }

  sample(tick) {
    this.samples.push({ tick, storage: this.storageContents(), population: this.population(),
      byType: Object.fromEntries(COLONY_TYPES.map((t) => [t, this.countOf(t)])),
      modules: this.brickModules(), dwellings: this.dwellings(), plots: this.plots(), offscreen: this.offscreen,
      project: this.project?.label ?? null, progress: this.project?.progress() ?? null });
    if (this.samples.length > 20000) this.samples.shift();
  }

  // ---- Damage ----

  // Damage to a goblin (or the totem) from `attacker`.
  hurt(mob, amount, attacker, isPlayer) {
    const game = this.game;
    if (mob.dead || attacker?.goblin) return;
    if (mob === this.totem || mob instanceof GoblinTotem) {
      // Only player weapons (melee, arrows, bolts) hurt the totem.
      if (!isPlayer) return;
      mob.lastDamageTick = game.tick;
    }
    mob.hp = Math.max(0, mob.hp - amount);
    game.broadcast({ type: S2C.DAMAGE, id: mob.id, attackerId: attacker?.id ?? null, hp: Math.ceil(mob.hp) });
    if (isPlayer && mob.provocation) mob.provocation.provoke(attacker, game.tick);
    if (isPlayer && mob instanceof GoblinWorker) {
      mob.attackedBy = attacker;
      mob.lastThreatTick = game.tick;
      mob.fleeing = true;
      mob.nextFleePlan = 0;
      mob.releaseWork();
    }
    if (mob.hp > 0) return;
    const s = mob.state;
    if (mob instanceof GoblinTotem) this.destroyTotem(mob, attacker);
    else if (mob instanceof GoblinKing) this.spill(rollLoot('goblinKing', Math.random() * 0xffffffff >>> 0, 0, 0, 0), s, 1);
    else if (mob.carrying) this.spillCarried(mob);
    game.removeMob(mob);
  }

  // What a goblin carries, as items.
  spillCarried(goblin) {
    for (const [material, count] of goblin.carrying) {
      if (count > 0 && MATERIAL_ITEMS[material] !== undefined) this.spill([{ item: MATERIAL_ITEMS[material], count }], goblin.state, 1);
    }
    goblin.carrying.clear();
  }

  // Items popping out around a point, `spread` blocks/s sideways.
  spill(stacks, s, spread) {
    for (const stack of stacks) {
      if (!stack) continue;
      this.game.spawnItem(stack.item, stack.count, s.x, s.y + 0.6, s.z, (Math.random() - 0.5) * 2 * spread,
        ITEM_POP_SPEED * (0.8 + Math.random() * 0.6), (Math.random() - 0.5) * 2 * spread, ITEM_PICKUP_DELAY, stack.mods ?? null);
    }
  }

  // Spawning and projects stop; the goblins still alive carry on.
  destroyTotem(totem, attacker) {
    const game = this.game;
    const s = totem.state;
    this.totemAlive = false;
    this.project = null;
    this.spill(rollLoot('goblinTotem', Math.random() * 0xffffffff >>> 0, 0, 0, 0, 40), { ...s, y: s.y + 1.5 }, 2.2);
    game.broadcast({ type: S2C.GOBLIN_TOTEM_DESTROYED, x: s.x, y: s.y, z: s.z });
    const text = attacker?.name ? `${attacker.name} destroyed the Goblin Totem!` : 'The Goblin Totem has been destroyed!';
    game.broadcast({ type: S2C.CHAT, text, kind: 'event' });
    this.log('totemDestroyed');
    console.log(text);
  }

  // A goblin left the world (killed, or fell into the void). Dead goblins
  // aren't respawned; the population refills by spawning.
  removed(mob) {
    if (mob.slot !== undefined) this.slots.delete(mob.slot);
    mob.releaseWork?.();
    this.members.delete(mob);
  }
}
