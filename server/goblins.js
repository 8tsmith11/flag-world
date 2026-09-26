// The Goblin Fortress in a match. GoblinController spawns the Totem, the
// King and the colony (Workers, Soldiers, Archers) from
// world.goblinFortress and runs everything they share: timed projects
// (materials by name; nobody can open it), population and spawning, the
// active project and its tasks (goblinProjects.js), repairs to what they
// built, entrances and surfacing groups, surface buildings, and the switch
// to offscreen mode (goblinOffscreen.js) when no player is near. It also
// handles goblin damage and deaths for the Game. Numbers are in
// shared/goblins.js.

import { TICK_RATE, CHUNK_SIZE, ITEM_POP_SPEED, ITEM_PICKUP_DELAY } from '../shared/config.js';
import { BLOCK, isSolid, isLadder, isWater, isFlowingWater } from '../shared/blocks.js';
import { GOBLINS, goblinTicks, goblinCap } from '../shared/goblins.js';
import { MODULE_TYPES, CELL_HEIGHT, moduleAt, moduleBlocks, connectionBlocks, cellOrigin,
  SURFACE_TEMPLATES, DOOR_PATH, turnLocal, turnsBack, templateBounds } from '../shared/goblinModules.js';
import { mulberry32 } from '../shared/structures.js';
import { rollLoot } from '../shared/loot.js';
import { S2C, ENTITY_TYPE } from '../shared/protocol.js';
import {
  GoblinTotem, GoblinKing, GoblinWorker, GoblinSoldier, GoblinArcher, GoblinHound, GoblinBrute,
} from './goblin.js';
import {
  Project, blockKey, addBlockTasks, taskReady, taskSatisfied, isProtected,
  chooseModule, moduleProject, shaftCandidates, shaftProject, gatehouseProject,
  dwellingProject, plotProject, wallProject, entrancePoints, TREE_BLOCKS,
  castleProject, surfaceHeight,
} from './goblinProjects.js';
import { canStand } from './pathfind.js';
import { isOnLadder } from '../shared/physics.js';
import { canSee } from './provocation.js';
import { OffscreenSim } from './goblinOffscreen.js';
import { GoblinSieges } from './goblinSieges.js';
import { GoblinTraps } from './goblinTraps.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
export const COLONY_TYPES = [ENTITY_TYPE.GOBLIN_WORKER, ENTITY_TYPE.GOBLIN_SOLDIER, ENTITY_TYPE.GOBLIN_ARCHER, ENTITY_TYPE.GOBLIN_HOUND, ENTITY_TYPE.GOBLIN_BRUTE];
const CLASSES = {
  [ENTITY_TYPE.GOBLIN_WORKER]: GoblinWorker,
  [ENTITY_TYPE.GOBLIN_SOLDIER]: GoblinSoldier,
  [ENTITY_TYPE.GOBLIN_ARCHER]: GoblinArcher,
  [ENTITY_TYPE.GOBLIN_HOUND]: GoblinHound,
  [ENTITY_TYPE.GOBLIN_BRUTE]: GoblinBrute,
};
// Who climbs first out of a surfacing group.
const CLIMB_ORDER = { goblinSoldier: 0, goblinArcher: 1, goblinWorker: 2 };

export class GoblinController {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.worldSize = game.worldSize;
    this.fortress = game.world.goblinFortress ?? null;
    this.random = mulberry32(((game.seed ?? 1) ^ 0x60b1d2) >>> 0);
    this.nextChopTick = 0;
    this.navigationRevision = 0;
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
    this.surfaceAlarmUntil = 0;
    this.relocationStarted = false;
    this.relocationNew = null;
    this.castleReserve = null;
    this.relocated = false;
    this.castleBuilt = false;
    this.wallSections = [];
    this.outerWallBuilt = false;
    this.wallFootprints = new Set();
    this.fastBuild = false;
    this.fastBuildIdle = 0;
    this.reserved = [];
    this.plotSaplings = new Set();
    this.replantQueue = [];
    this.naturalTreesChopped = 0;
    this.treeClaims = new Set();
    this.nextSpawnTick = 0;
    this.offscreen = false;
    // 'full' or 'offscreen' to pin the mode (tests); null decides by players.
    this.forceMode = null;
    this.nextModeCheck = 0;
    this.sim = new OffscreenSim(this);
    this.wood = 0; this.tier = 1; this.minimumTier = 1;
    this.sieges = new GoblinSieges(this);
    this.traps = new GoblinTraps(this);
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
    this.game.goblinEntityIds.add(mob.id);
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
    GOBLINS.start.slots.forEach((type, i) => this.spawnGoblin(type, false, i + 1));
    this.updateAssignments();
    this.nextSpawnTick = this.game.tick + goblinTicks(GOBLINS.population.spawnInterval, TICK_RATE);
    this.log('start', { shaft: !!this.shaftPlan });
    this.log('tierUnlocked', { tier: 1 });
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
    this.game.goblinEntityIds.add(goblin.id);
    this.nextModeCheck = 0;
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
    const approaches=this.buildings.filter(b=>b.kind==='wall').flatMap(w=>w.gates.map(g=>{
      const r=GOBLINS.walls.gateApproach,nx=g.nx ?? 0,nz=g.nz ?? 1;
      return {x0:Math.floor(g.x)-Math.abs(nx)*r,x1:Math.floor(g.x)+Math.abs(nx)*r,
        z0:Math.floor(g.z)-Math.abs(nz)*r,z1:Math.floor(g.z)+Math.abs(nz)*r,y0:g.y-1,y1:g.y+GOBLINS.walls.height};
    }));
    const margin=GOBLINS.siege.launchSettlementClearance;
    const towers=[...(this.sieges?.towerSites?.values() ?? [])].map(b=>({...b,
      x0:b.x0-margin,x1:b.x1+margin,z0:b.z0-margin,z1:b.z1+margin}));
    const planned=(this.sieges?.pending?.bridges ?? []).map(b=>({
      x0:b.launch.x-margin,x1:b.launch.x+margin,z0:b.launch.z-margin,z1:b.launch.z+margin}));
    return [...this.reserved,...approaches,...towers,...planned];
  }

  reserveSurface(box) {
    // Surface reservations must not occupy the entire underground column.
    // Otherwise a future gatehouse or Castle can block all module growth
    // beneath it before its shaft is even started.
    if (box.y0 === undefined) {
      const ground = surfaceHeight(this.world, Math.floor((box.x0 + box.x1) / 2),
        Math.floor((box.z0 + box.z1) / 2));
      box.y0 = ground + 1;
      box.y1 = ground + GOBLINS.projects.castle.towerHeight + 2;
    }
    this.reserved.push(box);
  }

  gatehouseReserve(pick) {
    const template = SURFACE_TEMPLATES.gatehouse;
    const turns = turnsBack(pick.wall);
    const [sx, sz] = turnLocal(template.shaft.x, template.shaft.z, turns);
    const ox = pick.column.x - sx, oz = pick.column.z - sz;
    const box = templateBounds(template, ox, oz, turns);
    box.access = Array.from({ length: DOOR_PATH * 3 }, (_, index) => {
      const d = Math.floor(index / 3) + 1, side = index % 3 - 1;
      const [dx, dz] = turnLocal(template.door + side, template.layers[0].length - 1 + d, turns);
      return { x: ox + dx, z: oz + dz };
    });
    return box;
  }

  releaseSurface(box) {
    this.reserved = this.reserved.filter((b) => b !== box);
  }

  // ---- Blocks ----

  // A block change made by goblins (not treated as damage).
  setBlock(x, y, z, id) {
    if (this.world.getBlock(x, y, z) !== id) this.navigationRevision++;
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
    if (!this.selfChange) this.navigationRevision++;
    if (this.cachedTrees && id === BLOCK.WOOD
      && [BLOCK.GRASS, BLOCK.DIRT].includes(this.world.getBlock(x, y - 1, z))
      && this.entrances.some((entrance) => entrance.open
        && Math.hypot(x - entrance.top.x, z - entrance.top.z) <= GOBLINS.surface.treeRadius)
      && !this.cachedTrees.trees.some((tree) => tree.x === x && tree.y === y && tree.z === z)) {
      this.cachedTrees.trees.push({ x, y, z, plot: null, d: 0 });
    }
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
  forceTask(task) {
    const current = this.world.getBlock(task.x, task.y, task.z);
    if (!isProtected(current)) {
      if (task.kind === 'dig') {
        this.setBlock(task.x, task.y, task.z, BLOCK.AIR);
      } else {
        this.setBlock(task.x, task.y, task.z, task.id);
      }
    }
    this.finishTask(task, null);
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
    if (project.kind === 'dwelling' && !this.fastBuild) this.wood -= GOBLINS.gathering.dwellingWood;
    this.log('startProject', { kind: project.kind, label: project.label, tasks: project.total });
    if (project.surface && !this.fastBuild) for (const goblin of this.members) {
      if (goblin.type !== ENTITY_TYPE.GOBLIN_WORKER || goblin.surfaceWanderer()
        || this.game.mobs.has(goblin.id)) continue;
      this.sim.startJourney(goblin, project.site);
    }
    return true;
  }

  // Picks the next project by priority (see GOBLINS.projects).
  chooseProject() {
    if (this.relocated && this.castleBuilt && this.outerWallBuilt
      && this.brickModules() >= goblinCap(GOBLINS.caps.modules, this.worldSize)
      && this.dwellings() >= goblinCap(GOBLINS.caps.dwellings, this.worldSize)
      && this.plots() >= goblinCap(GOBLINS.caps.plots, this.worldSize)) return null;
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
    if (this.relocated && !this.castleBuilt) {
      if (this.castleReserve) this.releaseSurface(this.castleReserve);
      const castle = castleProject(world, this, this.entrances[0]);
      this.surfaceBuilding(castle);
      const built = castle.onComplete;
      castle.onComplete = () => { built(); this.castleBuilt = true; this.log('castleBuilt'); };
      return castle;
    }
    // Secure the later entrance's upper-floor route before village sites
    // surround it. The surface shaft itself still waits for relocation's
    // configured module and dwelling thresholds.
    const upperReady = this.relocationReserve?.spec.parent.floorY >= this.hall.floorY
      + GOBLINS.projects.relocationMinLevels * CELL_HEIGHT;
    if (!upperReady && this.brickModules() >= GOBLINS.expansion.upperRouteStartModules
      && this.brickModules() < goblinCap(GOBLINS.caps.modules, this.worldSize)) {
      const upper = this.moduleNext();
      if (upper) return upper;
    }
    // A tree plot, if the village has grown enough and there is room.
    if ((this.fastBuild || this.sieges.pending || this.dwellings() >= GOBLINS.gathering.plotStartBuildings)
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
    const dwellingDue = this.dwellings() < goblinCap(GOBLINS.caps.dwellings, this.worldSize)
      && (this.fastBuild || this.wood >= this.sieges.reserve() + GOBLINS.gathering.dwellingWood);
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
    const spec = chooseModule(this.world, this, this.random);
    return spec ? moduleProject(this.world, this, spec) : null;
  }

  dwellingNext() {
    const project = dwellingProject(this.world, this, this.random);
    return project ? this.surfaceBuilding(project) : null;
  }

  surfaceBuilding(project) {
    const building = project.building;
    if (building.kind === 'plot') for (const sp of building.saplings) this.plotSaplings.add(blockKey(sp.x, sp.y, sp.z));
    const completed=project.onComplete;
    project.onComplete = () => {
      completed?.();
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
    const secondGatehouse = this.relocationNew?.gatehouse && this.buildings.find((b) =>
      b.kind === 'gatehouse' && b.origin.x === this.relocationNew.gatehouse.origin.x
      && b.origin.z === this.relocationNew.gatehouse.origin.z && !b.walled);
    const outer = !this.outerWallBuilt
      && dwellings.length >= goblinCap(GOBLINS.caps.dwellings, this.worldSize);
    const open = dwellings.filter((b) => !b.walled);
    if (!outer && !secondGatehouse && (open.length < settings.sectionMin
      || this.wallSections.length >= goblinCap(settings.maxSections, this.worldSize) - 1)) return null;
    const entranceGroups = secondGatehouse
      ? [settings.sectionSize, settings.sectionMin].map((count) => [secondGatehouse,
        ...[...dwellings].sort((a, b) =>
          Math.hypot(a.front.x - secondGatehouse.front.x, a.front.z - secondGatehouse.front.z)
          - Math.hypot(b.front.x - secondGatehouse.front.x, b.front.z - secondGatehouse.front.z)).slice(0, count)])
        .filter((group) => group.length >= settings.sectionMin + 1)
      : [];
    const groups = outer
      ? [...entranceGroups, this.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind) && b.intact)]
      : entranceGroups.concat(Array.from({ length: settings.sectionSize - settings.sectionMin + 1 },
        (_, i) => settings.sectionSize - i).filter((count) => count <= open.length)
        .flatMap((count) => open.map((first) => [...open].sort((a, b) =>
          Math.hypot(a.front.x - first.front.x, a.front.z - first.front.z)
          - Math.hypot(b.front.x - first.front.x, b.front.z - first.front.z)).slice(0, count))));
    for (const group of groups) {
      const isOuter = outer && group === groups.at(-1);
      const project = wallProject(this.world, this, group, isOuter,process.env.GOBLIN_WALL_TRACE?{}:null);
      if (!project) continue;
      project.building.dwellingsEnclosed = group.filter((b) => b.kind === 'dwelling').length;
      this.surfaceBuilding(project);
      const built = project.onComplete;
      project.onComplete = () => {
        built();
        for (const key of project.building.footprint) this.wallFootprints.add(key);
        for (const block of project.intended.values()) if (block.id === BLOCK.GOBLIN_BRICKS || isLadder(block.id))
          this.wallFootprints.add(`${block.x},${block.z}`);
        for (const post of project.building.posts) {
          const x = Math.floor(post.post.x), y = Math.floor(post.post.y), z = Math.floor(post.post.z);
          this.buildings.push({ kind: 'wallPost', ...post, intact: true,
            box: { x0: x - 1, x1: x + 1, y0: y - 1, y1: y, z0: z - 1, z1: z + 1 } });
        }
        if (isOuter) {
          this.outerWallBuilt = true;
          for (const b of group) b.walled = true;
        }
        else {
          this.wallSections.push(project.building);
          for (const b of group) { b.walled = true; b.innerWalled = true; }
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
      else if (!this.relocationReserve) {
        const candidates = shaftCandidates(this.world, this, { allowRough: true });
        const pick = candidates.sort((a, b) => b.level - a.level || a.rough - b.rough)[0];
        if (pick) {
          const box = this.gatehouseReserve(pick);
          this.relocationReserve = { ...pick, box };
          this.reserveSurface(box);
        }
      }
    };
    return project;
  }

  gatehouseFor(entrance) {
    const project = gatehouseProject(this.world, this, entrance);
    project.onComplete = () => {
      entrance.gatehouse = project.building;
      Object.assign(entrance, entrancePoints(entrance));
      this.buildings.push({ ...project.building, kind: 'gatehouse', intact: true });
      if (entrance.id === 0 && !this.castleReserve) {
        const cfg = GOBLINS.projects.castle;
        const cx = Math.floor(entrance.top.x), cz = Math.floor(entrance.top.z);
        const x = Math.floor(cfg.width / 2) + cfg.maxOffset;
        const z = Math.floor(cfg.depth / 2) + cfg.maxOffset;
        this.castleReserve = { x0: cx - x, x1: cx + x, z0: cz - z, z1: cz + z };
        this.reserveSurface(this.castleReserve);
      }
    };
    return project;
  }

  reserveUpperEntrance() {
    if (this.relocationStarted || !this.entrances.length) return;
    const current = this.relocationReserve;
    if (current) this.releaseSurface(current.box);
    const first = this.entrances[0].columns[0];
    const settings = GOBLINS.projects;
    const pick = shaftCandidates(this.world, this, { allowRough: true, allLevels: true, allowExisting: true })
      .filter((candidate) => candidate.spec.parent.floorY >= this.hall.floorY
        + settings.relocationMinLevels * CELL_HEIGHT
        && Math.hypot(candidate.column.x - first.x, candidate.column.z - first.z)
          >= settings.relocationMinEntranceDistance)
      .sort((a, b) => b.level - a.level || a.rough - b.rough)[0];
    if (!pick && this.brickModules() <= 20) this.log('upperCandidateMissing', { modules: this.brickModules() });
    if (!pick || current && current.level >= pick.level) {
      if (current) this.reserveSurface(current.box);
      return;
    }
    const box = this.gatehouseReserve(pick);
    this.relocationReserve = { ...pick, box };
    this.reserveSurface(box);
  }

  // The later entrance must join an upper floor reached through the fortress.
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
    const first = this.entrances[0]?.columns[0];
    const nearBase = (candidate) => {
      const p = candidate.spec.parent;
      return p && p.floorY >= this.hall.floorY + settings.relocationMinLevels * CELL_HEIGHT
        && (distances.get(p.id) ?? 0) >= settings.relocationMinHops
        && (!first || Math.hypot(candidate.column.x - first.x, candidate.column.z - first.z)
          >= settings.relocationMinEntranceDistance)
        && base.some((building) => Math.hypot(candidate.column.x - building.front.x,
          candidate.column.z - building.front.z) <= settings.relocationNearBase);
    };
    if (this.relocationReserve) this.releaseSurface(this.relocationReserve.box);
    let candidates = shaftCandidates(this.world, this, { allLevels: true, allowExisting: true }).filter(nearBase);
    if (!candidates.length) candidates = shaftCandidates(this.world, this,
      { allowRough: true, allLevels: true, allowExisting: true }).filter(nearBase);
    candidates.sort((a, b) => b.level - a.level
      || (distances.get(b.spec.parent.id) ?? 0) - (distances.get(a.spec.parent.id) ?? 0));
    const pick = this.relocationReserve?.spec.parent.floorY >= this.hall.floorY
      + settings.relocationMinLevels * CELL_HEIGHT ? this.relocationReserve : candidates[0];
    if (!pick) {
      if (this.relocationReserve) this.reserveSurface(this.relocationReserve.box);
      return null;
    }
    const project = this.shaftFrom({ ...pick, width: settings.relocationWidth }, 'Relocated entrance');
    if (project) this.relocationStarted = true;
    else if (this.relocationReserve) {
      this.reserveSurface(this.relocationReserve.box);
      if (this.game.tick % ticks(30) === 0) this.log('relocationBlocked', {
        cell: pick.spec.cell, existing: this.fortress.cells[pick.spec.cell.join(',')],
      });
    }
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
      if (b.x < gatehouse.box.x0 || b.x > gatehouse.box.x1
        || b.z < gatehouse.box.z0 || b.z > gatehouse.box.z1) continue;
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
      if (gatehouse) {
        this.buildings = this.buildings.filter((b) => b !== gatehouse);
        this.releaseSurface(gatehouse.box);
      }
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
    if (project.kind === 'module') this.reserveUpperEntrance();
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

  // ---- Population ----

  groupTarget() {
    const [low, high] = GOBLINS.surfacing.groupSize;
    return low + Math.floor(this.random() * (high - low + 1));
  }

  // The next open slot determines the goblin type in every match.
  neededType() {
    const slot = this.nextOpenSlot();
    const { slots, repeatSlots } = GOBLINS.population;
    const type = slot % GOBLINS.population.bruteEvery === 0 ? 'goblinBrute'
      : slot <= slots.length ? slots[slot - 1] : repeatSlots[(slot - slots.length - 1) % repeatSlots.length];
    if ((type === 'goblinHound' && this.tier < 2) || (type === 'goblinBrute' && this.tier < 3)) return 'goblinSoldier';
    return type;
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
    this.updateAssignments();
    this.sim.startJourney(goblin);
    if (this.offscreen) this.sim.place(goblin);
    this.log('spawn', { type: goblin.type });
    this.nextSpawnTick = tick + goblinTicks(GOBLINS.population.spawnInterval, TICK_RATE);
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

  updateVisibleGathering() {
    if (!this.surfaceOpen() || this.fastBuild) return;
    const replants = this.pendingReplants();
    const source = replants.length ? replants[0]
      : this.game.tick >= this.nextChopTick ? this.woodSources()[0] : this.emptyPlotSpots()[0];
    if (!source || !this.sim.watched(source)) return;
    const worker = [...this.members].find((goblin) => goblin.type === ENTITY_TYPE.GOBLIN_WORKER
      && !goblin.respawnJourney && !goblin.fleeing
      && (!goblin.job || ['idle', 'hold'].includes(goblin.job.type)));
    if (!worker) return;
    let stand = null;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      if (canStand(this.world, source.x + dx, source.y, source.z + dz, 2)) {
        stand = { x: source.x + dx + 0.5, y: source.y, z: source.z + dz + 0.5 };
        break;
      }
    }
    if (!stand) return;
    this.claimTree(source);
    worker.job = { type: this.world.getBlock(source.x, source.y, source.z) === BLOCK.WOOD
      ? 'chop' : 'plant', tree: source };
    this.sim.startJourney(worker, stand);
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

  updateAssignments() {
    const soldiers = [...this.members].filter((g) => g.type === ENTITY_TYPE.GOBLIN_SOLDIER)
      .sort((a, b) => a.slot - b.slot);
    const patrollers = this.surfaceOpen()
      ? Math.max(1, Math.ceil(soldiers.length * GOBLINS.soldier.patrolShare)) : 0;
    soldiers.forEach((g, i) => {
      const gate=this.buildings.find((b)=>b.mainGate && b.intact)?.mainGate;
      const gateDuty=gate && i<Math.min(GOBLINS.walls.gateGuards,patrollers);
      g.gateSpot=gateDuty?gate.guards[i%gate.guards.length]:null;
      const assignment = gateDuty ? 'gate' : i < patrollers ? 'patrol' : 'reserve';
      if (g.assignment === assignment) return;
      g.assignment = assignment;
      g.spot = null;
      g.route = null;
      if (!this.fastBuild && this.surfaceOpen()) this.sim.startJourney(g,g.gateSpot);
    });
    for (const g of this.members) if (g.type === ENTITY_TYPE.GOBLIN_ARCHER) {
      if (!g.post && !g.respawnJourney && this.buildings.some((building) => building.post
        && building.intact && (building.postSlot === undefined || building.postSlot === g.slot)
        && (!building.postHolder || building.postHolder.dead))) this.sim.startJourney(g);
      g.assignment = g.post ? 'post' : 'patrol';
    }
    else if (g.type === ENTITY_TYPE.GOBLIN_WORKER) g.assignment = 'project';
  }

  // A lookout post for an archer, claimed, or null.
  claimPost(archer) {
    for (const b of this.buildings) {
      if (!b.post || !b.intact) continue;
      // A station belongs to one population slot. Killing its archer leaves
      // it empty until that slot respawns and walks back to the post.
      if (b.postSlot !== undefined && b.postSlot !== archer.slot) continue;
      if (b.postHolder && !b.postHolder.dead && b.postHolder !== archer) continue;
      b.postSlot ??= archer.slot;
      b.postHolder = archer;
      return b.post;
    }
    return null;
  }

  // ---- Wood ----

  // Alternate plot and natural trees, so both visibly get harvested.
  woodSources() {
    const plots = [];
    for (const b of this.buildings) {
      if (b.kind !== 'plot') continue;
      for (const s of b.saplings) {
        if (this.world.getBlock(s.x, s.y, s.z) === BLOCK.WOOD) plots.push({ x: s.x, y: s.y, z: s.z, plot: b, spot: s });
      }
    }
    const natural = this.naturalTrees();
    const out = this.stats.chopped % 2 ? [...natural, ...plots] : [...plots, ...natural];
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
          && !this.treeClaims.has(blockKey(s.x, s.y, s.z))
          && !this.replantQueue.some((tree) => tree.x === s.x && tree.y === s.y && tree.z === s.z))
          out.push({ ...s, plot: b, spot: s, replant: true });
      }
    }
    return out;
  }

  naturalTrees() {
    const signature = this.entrances.filter((entrance) => entrance.open).map((entrance) => entrance.id).join(',') + ':' + this.buildings.length;
    if (this.cachedTrees?.signature === signature) return this.cachedTrees.trees.filter((tree) =>
      this.world.getBlock(tree.x, tree.y, tree.z) === BLOCK.WOOD && this.clearOfOthers(tree.x, tree.z)
      && !this.reserved.some((box) => tree.x >= box.x0 - 2 && tree.x <= box.x1 + 2
        && tree.z >= box.z0 - 2 && tree.z <= box.z1 + 2));
    const trees = [];
    const radius = GOBLINS.surface.treeRadius;
    const world = this.world;
    const areas = this.entrances.filter((e) => e.open).map((e) => ({ x0:e.top.x,x1:e.top.x,z0:e.top.z,z1:e.top.z }))
      .concat(this.buildings.filter((b) => b.box).map((b) => b.box));
    const found = new Set();
    for (const area of areas) {
      const cx = Math.floor((area.x0+area.x1)/2), cz = Math.floor((area.z0+area.z1)/2);
      const reach = radius + Math.ceil(Math.max(area.x1-area.x0,area.z1-area.z0)/2);
      for (let z = cz - reach; z <= cz + reach; z++) for (let x = cx - reach; x <= cx + reach; x++) {
        if (Math.hypot(Math.max(area.x0-x,0,x-area.x1),Math.max(area.z0-z,0,z-area.z1)) > radius || x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) continue;
        const top = world.naturalTop[x + world.sizeX * z];
        if (top < -30000) continue;
        for (let y = top - 2; y <= top + 3; y++) {
          if (world.getBlock(x, y, z) !== BLOCK.WOOD) continue;
          const below = world.getBlock(x, y - 1, z);
          if (below !== BLOCK.GRASS && below !== BLOCK.DIRT) continue;
          // Not on goblin building sites (a plot's own young trees included).
          if (this.reserved.some((b) => x >= b.x0 - 2 && x <= b.x1 + 2 && z >= b.z0 - 2 && z <= b.z1 + 2)) continue;
          if (!this.clearOfOthers(x, z)) continue;
          const key = blockKey(x,y,z); if (found.has(key)) continue; found.add(key);
          trees.push({ x, y, z, plot: null, d: Math.hypot(x - cx, z - cz) });
        }
      }
    }
    trees.sort((a, b) => a.d - b.d);
    this.cachedTrees = { signature, trees };
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
    this.wood += GOBLINS.gathering.planksPerTree;
    this.nextChopTick = this.game.tick + goblinTicks(GOBLINS.gathering.chopInterval, TICK_RATE);
    if (tree.plot && !this.replantQueue.some((spot) => spot.x === tree.x && spot.y === tree.y && spot.z === tree.z))
      this.replantQueue.push({ x: tree.x, y: tree.y, z: tree.z, plot: tree.plot ?? null });
  }

  pendingReplants() {
    this.replantQueue = this.replantQueue.filter((tree) => this.world.getBlock(tree.x, tree.y, tree.z) === BLOCK.AIR
      && (tree.plot || !this.buildings.some((building) => building.box
        && tree.x >= building.box.x0 && tree.x <= building.box.x1
        && tree.z >= building.box.z0 && tree.z <= building.box.z1)));
    return this.replantQueue.filter((tree) => !this.treeClaims.has(blockKey(tree.x, tree.y, tree.z)));
  }

  replanted(tree) {
    this.releaseTree(tree);
    this.replantQueue = this.replantQueue.filter((spot) =>
      spot.x !== tree.x || spot.y !== tree.y || spot.z !== tree.z);
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

  watchedChunk(point,build=false) {
    const radius=build?GOBLINS.detail.buildChunkRadius:GOBLINS.detail.chunkRadius;
    const x=Math.floor(point.x/CHUNK_SIZE),y=Math.floor(point.y/CHUNK_SIZE),z=Math.floor(point.z/CHUNK_SIZE);
    return (this.viewerChunks ?? [...this.game.players.values()].filter((p)=>p.connected)
      .map((p)=>({x:Math.floor(p.state.x/CHUNK_SIZE),y:Math.floor(p.state.y/CHUNK_SIZE),z:Math.floor(p.state.z/CHUNK_SIZE)})))
      .some((p)=>Math.abs(x-p.x)<=radius && Math.abs(y-p.y)<=radius && Math.abs(z-p.z)<=radius);
  }

  playerNear() {
    return this.watchPoints().some((point)=>this.watchedChunk(point));
  }

  updateMode(tick) {
    if (tick < this.nextModeCheck) return;
    this.nextModeCheck = tick + ticks(GOBLINS.offscreen.checkInterval);
    const viewers = [...this.game.players.values()].filter((player) => player.connected);
    const inside = viewers.some((player) => moduleAt(this.fortress,
      player.state.x, player.state.y + 0.1, player.state.z));
    if (inside) this.lastFortressViewer = tick;
    const fortressVisible = inside || (this.lastFortressViewer !== undefined
      && tick - this.lastFortressViewer < ticks(GOBLINS.detail.fortressLinger));
    let bodies = 0;
    for (const goblin of [this.king, ...this.members]) {
      if (!goblin || goblin.dead) continue;
      this.sim.progressJourney(goblin);
      const s = goblin.state;
      const underground = !!moduleAt(this.fortress, s.x, s.y + 0.1, s.z);
      let wanted=underground?fortressVisible:this.watchedChunk(s);
      if(goblin.type===ENTITY_TYPE.GOBLIN_WORKER && this.project?.surface
        && goblin.job?.task && this.watchedChunk(s,true))wanted=true;
      if (goblin.target?.connected && !goblin.target.dead) wanted = true;
      if (this.forceMode) wanted = this.forceMode === 'full';
      const exists = this.game.mobs.has(goblin.id);
      if (wanted) {
        goblin.simPositioned=true;
        bodies++;
        if (!exists) {
          goblin.stuckTicks = 0;
          this.add(goblin);
          this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: goblin.describe() });
        }
      } else if (exists) {
        goblin.releaseWork?.();
        this.game.mobs.delete(goblin.id);
        this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: goblin.id });
      }
    }
    this.offscreen = bodies === 0;
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

  updatePlayerGrid(tick) {
    if (this.playerGrid && tick < this.nextPlayerGridTick) return;
    this.nextPlayerGridTick = tick + ticks(GOBLINS.optimization.targetInterval);
    this.playerGrid = new Map();
    this.playerQueries = new Map();
    const cell = GOBLINS.optimization.playerCell;
    for (const player of this.game.players.values()) {
      if (!player.connected || player.dead || player.eliminated) continue;
      const s = player.state;
      const key = `${Math.floor(s.x / cell)},${Math.floor(s.y / cell)},${Math.floor(s.z / cell)}`;
      if (!this.playerGrid.has(key)) this.playerGrid.set(key, []);
      this.playerGrid.get(key).push(player);
    }
  }

  nearbyPlayers(point, range) {
    if (!this.playerGrid) return [...this.game.players.values()];
    if (!this.playerGrid.size) return [];
    const cell = GOBLINS.optimization.playerCell, result = [];
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)},${Math.floor(point.z / cell)}:${range}`;
    if (this.playerQueries.has(key)) return this.playerQueries.get(key);
    // Include a cell of margin for player movement between hash updates.
    for (let y = Math.floor((point.y - range) / cell) - 1; y <= Math.floor((point.y + range) / cell) + 1; y++)
      for (let z = Math.floor((point.z - range) / cell) - 1; z <= Math.floor((point.z + range) / cell) + 1; z++)
        for (let x = Math.floor((point.x - range) / cell) - 1; x <= Math.floor((point.x + range) / cell) + 1; x++) {
          const players = this.playerGrid.get(`${x},${y},${z}`);
          if (players) result.push(...players);
        }
    this.playerQueries.set(key, result);
    return result;
  }

  // ---- Tick ----

  // Once per tick, before mobs move.
  update(tick) {
    this.viewerChunks=[...this.game.players.values()].filter((p)=>p.connected)
      .map((p)=>({x:Math.floor(p.state.x/CHUNK_SIZE),y:Math.floor(p.state.y/CHUNK_SIZE),z:Math.floor(p.state.z/CHUNK_SIZE)}));
    for(const goblin of [this.king,...this.members])if(goblin && !goblin.dead) {
      if(goblin.state.y<this.world.voidY) {this.game.removeMob(goblin);continue;}
      // Falling is persistent physics, independent of observer chunks. Bodies
      // outside the entity map must still land or die and release their slot.
      if(!this.game.mobs.has(goblin.id) && !goblin.state.onGround
        && !isOnLadder(goblin.state,this.world) && !goblin.climbing) {
        goblin.move(this.world,null,goblin.settings?.speed ?? GOBLINS.worker.speed);
        if(goblin.state.y<this.world.voidY) {this.game.removeMob(goblin);continue;}
      }
      this.sim.progressJourney(goblin);
    }
    if (!this.hall) return;
    this.updatePlayerGrid(tick);
    this.updateInvasion(tick);
    this.updateMode(tick);
    this.updateProjects(tick);
    this.updateSpawning(tick);
    if (tick % ticks(1) === 0) {
      this.updateAssignments();
      this.updateVisibleGathering();
    }
    if (tick === this.surfaceAlarmUntil) for (const guard of this.members) {
      if (guard.assignment !== 'reserve') continue;
      guard.spot = null;
      guard.route = null;
      guard.target = null;
      this.sim.startJourney(guard);
    }
    this.updateSurfacing(tick);
    this.sim.tick(tick);
    this.updateTier();
    this.sieges.tick(tick);
    this.traps.tick(tick);
    if (this.offscreen && this.totemAlive) this.totem.step(this.world, [], tick);
    if (this.fastBuild) {
      this.game.saplings?.fastForward(tick + ticks(GOBLINS.creativeBoost.growthAheadSeconds));
      this.fastBuildIdle = this.project || this.repairs.remaining || this.sim.starved ? 0 : this.fastBuildIdle + 1;
      const atCaps = this.brickModules() >= goblinCap(GOBLINS.caps.modules, this.worldSize)
        && this.dwellings() >= goblinCap(GOBLINS.caps.dwellings, this.worldSize)
        && this.plots() >= goblinCap(GOBLINS.caps.plots, this.worldSize)
        && this.relocated && this.castleBuilt && this.outerWallBuilt
        && this.buildings.some((b) => b.kind === 'gatehouse' && b.walled
          && b.origin.x === this.relocationNew?.gatehouse.origin.x
          && b.origin.z === this.relocationNew?.gatehouse.origin.z);
      if (atCaps || this.fastBuildIdle >= GOBLINS.creativeBoost.idleStopTicks) {
        if (atCaps) for (const goblin of this.members) {
          goblin.respawnJourney = null;
          goblin.respawnArrived = false;
          goblin.simPositioned = false;
          this.sim.place(goblin);
        }
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

  updateTier() {
    const natural = this.outerWallBuilt ? (this.sieges.completedTier3 >= 2 ? 4 : 3)
      : this.relocated && this.castleBuilt ? 2 : 1;
    const tier = Math.max(this.minimumTier, this.tier, natural);
    if (tier !== this.tier) { this.tier = tier; this.log('tierUnlocked', { tier }); }
  }

  raiseTier() { this.minimumTier = Math.min(4, this.tier + 1); this.updateTier(); }

  startFastBuild() {
    if (!this.totemAlive) return false;
    this.fastBuild = true;
    this.fastBuildIdle = 0;
    // Fast build advances the economy directly without hiding goblins in view.
    this.nextModeCheck = 0;
    this.log('fastBuildStarted');
    return true;
  }

  updateInvasion(tick) {
    if (tick % GOBLINS.invasion.scanTicks !== 0) return;
    const viewers = [...this.game.players.values()].filter((player) => player.connected && !player.dead);
    const modules = viewers.length ? this.fortress.modules.filter((m) => !m.building && !m.removed) : [];
    this.intruders = viewers.filter((player) => !player.dead && player.connected
      && modules.some((m) => player.state.x >= m.box.x0 && player.state.x <= m.box.x1 + 1
        && player.state.y >= m.box.y0 && player.state.y <= m.box.y1 + 1
        && player.state.z >= m.box.z0 && player.state.z <= m.box.z1 + 1));
    if (this.intruders.length) {
      this.alarmUntil = tick + ticks(GOBLINS.invasion.calmSeconds);
      const s = this.intruders[0].state;
      this.lastIntruderPos = { x: s.x, y: s.y, z: s.z };
    }
    const alerted = this.intruders.length > 0 || tick < this.alarmUntil;
    this.alerted = alerted;
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
      project: project ? { kind: project.kind, label: project.label, progress: project.progress(),
        done: project.done, total: project.total } : null,
      nextProjectIn: Math.round(cooldown),
      population: Object.fromEntries(COLONY_TYPES.map((t) => [t, this.countOf(t)])),
      slots: [...this.slots].sort((a, b) => a[0] - b[0]).map(([slot, g]) => ({
        slot, id: g.id, role: g.type, assignment: g.assignment ?? 'reserve',
        hp: Math.ceil(g.hp), activity: g.climbing ? 'climbing' : g.target ? 'combat'
          : g.respawnJourney ? 'traveling'
          : g.job?.type ?? g.spot?.kind ?? 'idle',
        x: Math.round(g.state.x), y: Math.round(g.state.y), z: Math.round(g.state.z),
        spawned: this.game.mobs.has(g.id),
      })),
      spawnedEntities: [...this.members].filter((g) => this.game.mobs.has(g.id)).length,
      tier: this.tier,
      siege: this.sieges.status(),
      total: this.population(),
      capacity: this.capacity(),
      hardCap: goblinCap(GOBLINS.caps.population, this.worldSize),
      modules: this.brickModules(),
      moduleCap: goblinCap(GOBLINS.caps.modules, this.worldSize),
      dwellings: this.dwellings(),
      dwellingCap: goblinCap(GOBLINS.caps.dwellings, this.worldSize),
      plots: this.plots(),
      walls: this.wallSections.length + Number(this.outerWallBuilt),
      castle: this.castleBuilt,
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
    this.samples.push({ tick, population: this.population(),
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
    if (isPlayer && mob.provocation) {
      mob.provocation.provoke(attacker, game.tick);
      mob.nextTargetTick = game.tick;
      mob.respawnJourney = null;
    }
    if (isPlayer && this.members.has(mob) && !moduleAt(this.fortress, mob.state.x, mob.state.y + 0.1, mob.state.z)) {
      this.surfaceAlarmUntil = game.tick + goblinTicks(GOBLINS.soldier.reserveResponseSeconds, TICK_RATE);
      for (const guard of this.members) if (guard.assignment === 'reserve') {
        guard.spot = null; guard.route = null;
        if (!guard.respawnJourney) this.sim.startJourney(guard, { x: mob.state.x, y: mob.state.y, z: mob.state.z });
      }
    }
    if (isPlayer && mob instanceof GoblinWorker) {
      mob.attackedBy = attacker;
      mob.lastThreatTick = game.tick;
      mob.fleeing = true;
      mob.nextFleePlan = 0;
      mob.releaseWork();
    }
    if (mob.hp > 0) return;
    if (mob.type === ENTITY_TYPE.GOBLIN_BALLOON) {
      mob.phase = 'crashing'; return;
    }
    const s = mob.state;
    if (mob.type === ENTITY_TYPE.GOBLIN_CATAPULT) this.spill([{item:BLOCK.PLANKS,count:GOBLINS.catapult.drops}],s,1);
    if (mob.siegeId !== undefined && !mob.machine && this.random() < GOBLINS.siege.lootChance)
      this.spill(rollLoot('siegeGoblin', this.random()*0xffffffff>>>0,0,0,0),s,1);
    if (mob instanceof GoblinTotem) this.destroyTotem(mob, attacker);
    else if (mob instanceof GoblinKing) this.spill(rollLoot('goblinKing', Math.random() * 0xffffffff >>> 0, 0, 0, 0), s, 1);
    game.removeMob(mob);
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
    this.sieges.end('totem destroyed');
    for (const flag of game.flags.values()) if (flag.state === 'held') game.returnFlag(flag);
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
    this.sieges.removed(mob);
    if (mob.slot !== undefined) this.slots.delete(mob.slot);
    mob.releaseWork?.();
    this.members.delete(mob);
  }
}
