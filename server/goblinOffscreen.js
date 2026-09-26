// Persistent colony economy. Bodies display work; only this simulation
// advances construction, both while watched and while players are away.

import { TICK_RATE, CLIMB_SPEED } from '../shared/config.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { GOBLINS, goblinCap } from '../shared/goblins.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { goblinBreakTicks, goblinPlaceTicks, taskSatisfied, isProtected } from './goblinProjects.js';
import { planRoute, followRoute, repath, yawToward } from './goblinNav.js';
import { canStand, findPath } from './pathfind.js';
import { moduleAt } from '../shared/goblinModules.js';

const seconds = (gameTicks) => gameTicks / TICK_RATE;
const LADDER_DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export class OffscreenSim {
  constructor(controller) {
    this.controller = controller;
    this.workerCredit = 0;
    this.placeCredit = 0;
    this.nextStep = 0;
    // Compatibility with the creative completion inspector.
    this.starved = false;
  }

  // Seconds of walking for a round trip between the totem and `point`,
  // counting shaft climbs and the wait to surface together.
  roundTrip(point) {
    const c = this.controller;
    const t = c.totemSpot;
    const { travelFactor } = GOBLINS.offscreen;
    const speed = GOBLINS.worker.speed;
    let walk = Math.hypot(point.x - t.x, point.y - t.y, point.z - t.z) * travelFactor / speed;
    const entrance = point.surface && c.entrances[0];
    if (entrance) {
      walk += (entrance.topY - entrance.floorY) / CLIMB_SPEED;
      walk += GOBLINS.surfacing.gatherTime;
    }
    return walk * 2 / GOBLINS.goblinTimeScale;
  }

  // Shaft and ladder work: climbing up to the block and back down, shared
  // by the few blocks done per climb.
  climbTime(task) {
    if (!task.climb) return 0;
    return 2 * Math.max(0, task.y - task.climb.floorY) / CLIMB_SPEED / GOBLINS.offscreen.blocksPerClimb / GOBLINS.goblinTimeScale;
  }

  tripTime(project) {
    if (!project?.site) return 0;
    return this.roundTrip({ ...project.site, surface: !!project.surface });
  }

  enter() {
    const c = this.controller;
    for (const g of c.members) {
      g.releaseWork?.();
      this.place(g);
    }
    this.workerCredit = this.placeCredit = 0;
    this.nextStep = c.game.tick + Math.round(GOBLINS.offscreen.step * TICK_RATE);
  }

  leave() {
    for (const g of this.controller.members) {
      g.route = null;
      g.job = null;
      g.stuckTicks = 0;
    }
  }

  // A respawn travels from the Totem Hall to its assignment. The route is
  // planned once and stored on that individual so an approaching player can
  // see the same goblin halfway through a room or shaft.
  startJourney(goblin, destination = null) {
    const c = this.controller;
    if (!c.surfaceOpen() || goblin.stray) return;
    let goal = destination ?? goblin.gateSpot, post = null;
    if (!destination && !goblin.siegeManaged && goblin.type === ENTITY_TYPE.GOBLIN_ARCHER) {
      post = c.buildings.find((building) => building.post && building.intact
        && (building.postSlot === goblin.slot || building.postSlot === undefined)
        && (!building.postHolder || building.postHolder.dead || building.postHolder === goblin));
      if (post) {
        c.claimPost(goblin);
        goblin.post = post.post;
        goblin.assignment = 'post';
        goal = { x: post.ladder.x + 0.5, y: post.ladder.floorY, z: post.ladder.z + 0.5 };
      }
    }
    if (!goal && goblin.type === ENTITY_TYPE.GOBLIN_WORKER && !goblin.surfaceWanderer()) {
      const halls = c.patrolSpots().filter((spot) => spot.kind === 'fortress');
      goal = c.project?.surface ? c.project.site : halls[goblin.slot % halls.length] ?? c.totemSpot;
    }
    if (!goal && goblin.assignment === 'reserve' && c.game.tick >= c.surfaceAlarmUntil) {
      const spots = c.patrolSpots().filter((spot) => spot.kind === 'fortress');
      goal = spots[goblin.slot % spots.length] ?? c.totemSpot;
    }
    if (!goal) {
      const spots = c.patrolSpots().filter((spot) => spot.kind !== 'fortress');
      goal = spots[goblin.slot % spots.length] ?? c.totemSpot;
    }
    const route = planRoute(c, goblin, goblin.state, goal, { urgent: true });
    if (post) route.actions.push({ type: 'climbUp', x: post.ladder.x + 0.5,
      y: post.ladder.topY + 1, z: post.ladder.z + 0.5, wall: post.ladder.wall },
    { type: 'walk', ...post.post });
    const points = [{ x: goblin.state.x, y: goblin.state.y, z: goblin.state.z, tick: c.game.tick }];
    const speed = goblin.settings?.speed ?? GOBLINS.worker.speed;
    const travel = GOBLINS.population.travel;
    for (const action of route.actions) {
      if (![action.x, action.y, action.z].every(Number.isFinite)) continue;
      const previous = points.at(-1);
      const distance = Math.hypot(action.x - previous.x, action.y - previous.y, action.z - previous.z);
      if (distance < travel.minSegment) continue;
      if (action.type === 'walk' && distance > travel.pathThreshold) {
        const path = findPath(c.world,
          { x: Math.floor(previous.x), y: Math.round(previous.y), z: Math.floor(previous.z) },
          { x: Math.floor(action.x), y: Math.round(action.y), z: Math.floor(action.z) },
          { maxNodes: moduleAt(c.fortress, previous.x, previous.y + 0.1, previous.z)
            ? GOBLINS.navigation.chamberMaxNodes : GOBLINS.navigation.surfaceMaxNodes });
        if (path.length && Math.hypot(path.at(-1).x - action.x, path.at(-1).z - action.z) < travel.pathArrival) {
          for (const node of path) {
            const last = points.at(-1);
            const p = { x: node.x + 0.5, y: node.y, z: node.z + 0.5 };
            const d = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
            points.push({ ...p, tick: last.tick + Math.max(1, Math.ceil(d / speed * TICK_RATE)), type: 'walk' });
          }
          continue;
        }
      }
      const rate = action.type.startsWith('climb') ? CLIMB_SPEED * (goblin.settings?.climbScale ?? 1) : speed;
      points.push({ x: action.x, y: action.y, z: action.z,
        tick: previous.tick + Math.max(1, Math.ceil(distance / rate * TICK_RATE)), type: action.type,
        wall: action.wall });
    }
    if (points.length > 1) {goblin.respawnJourney = points;goblin.journeyRoute = route;goblin.journeyTick = null;}
  }

  progressJourney(goblin) {
    const points = goblin.respawnJourney;
    if (!points?.length) return false;
    const tick = this.controller.game.tick;
    if (goblin.journeyTick === tick) return true;
    goblin.journeyTick = tick;
    const c=this.controller;
    if(goblin.siegeManaged && goblin.siegePhase==='emerging') {
      const base=c.sieges.base();
      if(Math.hypot(base.x-points.at(-1).x,base.y-points.at(-1).y,base.z-points.at(-1).z)>1) {
        points[points.length-1]={...base,tick};goblin.journeyRoute=null;
      }
    }
    let route = goblin.journeyRoute ??= planRoute(this.controller, goblin,
      goblin.state, points.at(-1), {urgent: true});
    const action = route.actions[route.index];
    if ((action?.type === 'walk' && Math.abs(action.y-goblin.state.y)>2
      || route.actions.some(a=>a.type==='climbUp' && c.entrances.some(e=>e.sealed && e.columns.some(col=>Math.abs(col.x+0.5-a.x)<0.1 && Math.abs(col.z+0.5-a.z)<0.1))))
      && tick >= (goblin.nextJourneyRetry ?? 0)) {
      goblin.nextJourneyRetry=tick+TICK_RATE*2;
      route=goblin.journeyRoute=planRoute(this.controller,goblin,goblin.state,points.at(-1),{urgent:true});
    }
    if (goblin.stuckTicks > 20 && goblin.stuckTicks % 20 === 1) repath(route);
    const step = followRoute(route, goblin, this.controller.world);
    const stuck=goblin.stuckTicks;
    if(step.blocked && goblin.breaksObstacles) {
      goblin.state.yaw=Math.atan2(-(action?.x-goblin.state.x),-(action?.z-goblin.state.z));
      goblin.clearObstacle(c.world);
    }
    goblin.move(this.controller.world, step.wait || step.arrived ? null : step,
      goblin.settings?.speed ?? GOBLINS.worker.speed);
    if(step.blocked)goblin.stuckTicks=stuck+1;
    if (step.arrived) {
      goblin.respawnJourney = null;
      goblin.journeyRoute = null;
      goblin.respawnArrived = true;
      goblin.respawnArrivedProject = this.controller.project;
      if (goblin.post) {goblin.spot = {...goblin.post, kind: 'post'};goblin.arrived = true;}
    }
    return true;
  }

  // The next task of a kind whose requirements are done (reach and exposure
  // don't matter offscreen), or null.
  nextTask(kind) {
    const c = this.controller;
    for (const project of c.activeProjects()) {
      if (project.economyTaskCount !== project.tasks.length) {
        project.economyTaskCount = project.tasks.length;
        project.economyQueues = { dig: project.tasks.filter((task) => task.kind === 'dig'),
          place: project.tasks.filter((task) => task.kind === 'place') };
        project.economyCursor = { dig: 0, place: 0 };
      }
      const queue = project.economyQueues[kind];
      for (let index = project.economyCursor[kind]; index < queue.length; index++) {
        const task = queue[index];
        if (task.done || task.simDone) {
          if (index === project.economyCursor[kind]) project.economyCursor[kind]++;
          continue;
        }
        if (task.requires.some((required) => !required.done && !required.simDone)) continue;
        if (taskSatisfied(task, c.world)) {
          c.finishTask(task, null);
          continue;
        }
        return task;
      }
    }
    return null;
  }

  tick(tick) {
    if (tick < this.nextStep) return;
    const c = this.controller;
    const step = c.fastBuild ? GOBLINS.creativeBoost.workSecondsPerTick
      : c.offscreen ? GOBLINS.offscreen.step : GOBLINS.economy.visibleStep;
    this.nextStep = tick + (c.fastBuild ? 1 : Math.round(step * TICK_RATE));
    const share = step * (1 - GOBLINS.offscreen.overhead)
      * goblinCap(GOBLINS.offscreen.workScale, c.worldSize);
    const workers = c.countOf(ENTITY_TYPE.GOBLIN_WORKER);
    // Credit carries over (a task can take longer than a step), but only so far.
    // While wood is wanted, part of the workers' time goes to chopping.
    const woodTime = c.surfaceOpen() && tick >= c.nextChopTick && c.woodSources().length
      ? workers * step * GOBLINS.economy.chopLabor : 0;
    this.woodCredit = woodTime ? Math.min((this.woodCredit ?? 0) + woodTime, GOBLINS.offscreen.woodCreditLimit) : 0;
    // (The cap leaves room to save up for a whole tree.)
    this.workerCredit = Math.min(this.workerCredit + workers * share, workers * step * 4 + 150);
    if (c.totemAlive) {
      this.placeCredit = this.workerCredit;
      this.workerCredit = 0;
      this.build();
      this.workerCredit = this.placeCredit;
      this.placeCredit = 0;
      this.work();
    }
    this.commitFinished();
    if (c.offscreen) for (const g of c.members) this.place(g);
  }

  // Fells an unseen tree when its action timer permits it. This labor budget
  // describes time only; no wood or sapling inventory exists.
  chop(pool) {
    const c = this.controller;
    const world = c.world;
    if (!c.surfaceOpen() || c.game.tick < c.nextChopTick) return false;
    const tree = c.woodSources().find((source) => !this.watched(source));
    if (!tree) return false;
    const logs = [];
    for (let y = tree.y; y < tree.y + GOBLINS.surface.treeHeight; y++)
      if (world.getBlock(tree.x, y, tree.z) === BLOCK.WOOD) logs.push(y);
    const cost = logs.length * (seconds(goblinBreakTicks(BLOCK.WOOD)) + GOBLINS.offscreen.perBlock / GOBLINS.goblinTimeScale)
      + this.roundTrip({ ...tree, surface: true }) * Math.max(0.5, logs.length / GOBLINS.worker.carryLimit);
    if (this[pool] < cost) return 'short';
    this[pool] -= cost;
    for (const y of logs) c.setBlock(tree.x, y, tree.z, BLOCK.AIR);
    c.treeFelled(tree);
    return true;
  }

  // Independent tree actions, project digs, and plot maintenance.
  work() {
    const c = this.controller;
    const world = c.world;
    const carry = GOBLINS.worker.carryLimit;
    while (this.woodCredit > 0 && this.chop('woodCredit') === true);
    for (let guard = 0; guard < 2000 && this.workerCredit > 0; guard++) {
      const replant = c.pendingReplants().find((spot) => !this.watched(spot));
      if (replant) {
        const cost = seconds(goblinPlaceTicks()) + this.roundTrip({ ...replant, surface: true }) / 2;
        if (this.workerCredit < cost) return;
        this.workerCredit -= cost;
        const soil = world.getBlock(replant.x, replant.y - 1, replant.z);
        if (world.getBlock(replant.x, replant.y, replant.z) === BLOCK.AIR
          && (soil === BLOCK.GRASS || soil === BLOCK.DIRT))
          c.setBlock(replant.x, replant.y, replant.z, BLOCK.SAPLING);
        c.replanted(replant);
        continue;
      }
      const spot = c.emptyPlotSpots().find((point) => !this.watched(point));
      if (spot) {
        const cost = seconds(goblinPlaceTicks()) + this.roundTrip({ ...spot, surface: true }) / 2;
        if (this.workerCredit < cost) return;
        this.workerCredit -= cost;
        c.setBlock(spot.x, spot.y, spot.z, BLOCK.SAPLING);
        continue;
      }
      const task = this.nextTask('dig');
      if (task) {
        const cost = seconds(goblinBreakTicks(world.getBlock(task.x, task.y, task.z))) + task.project.tripTime / carry
          + this.climbTime(task) + GOBLINS.offscreen.perBlock / GOBLINS.goblinTimeScale;
        if (this.workerCredit < cost) return;
        this.workerCredit -= cost;
        this.applyTask(task);
        c.stats.dug++;
        continue;
      }
      const chopped = false;
      if (chopped === true) continue;
      // Save credit for a tree.
      if (chopped === 'short') return;
      return;
    }
  }


  // Placement work from the project plan; there are no material checks.
  build() {
    const c = this.controller;
    const world = c.world;
    const carry = GOBLINS.worker.carryLimit;
    this.starved = false;
    for (let guard = 0; guard < 2000 && this.placeCredit > 0; guard++) {
      const task = this.nextTask('place');
      if (!task) {
        return;
      }
      const current = world.getBlock(task.x, task.y, task.z);
      const replacing = isSolid(current) && !isProtected(current);
      const cost = seconds(goblinPlaceTicks()) + (replacing ? seconds(goblinBreakTicks(current)) : 0)
        + (task.material ? task.project.tripTime / carry : 0) + this.climbTime(task) + GOBLINS.offscreen.perBlock / GOBLINS.goblinTimeScale;
      if (this.placeCredit < cost) return;
      this.placeCredit -= cost;
      if (!this.deferred(task.project) && isSolid(task.id) && c.game.playerIn?.(task.x, task.y, task.z)) return;
      this.applyTask(task);
      c.stats.placed++;
    }
  }

  watched(point) {
    return this.controller.watchedChunk(point,true);
  }

  deferred(project) {
    return !project.surface && ['module', 'shaft', 'relocationPlug'].includes(project.kind);
  }

  applyTask(task) {
    if (!this.deferred(task.project)) {
      this.controller.forceTask(task);
      return;
    }
    task.simDone = true;
    task.project.simDone = (task.project.simDone ?? 0) + 1;
  }

  commitFinished() {
    const c = this.controller;
    for (const project of c.activeProjects()) {
      if (!this.deferred(project) || project.done + (project.simDone ?? 0) < project.total) continue;
      if (!c.fastBuild && [...c.game.players.values()].some((player) => {
        if (!player.connected) return false;
        const s = player.state;
        if (moduleAt(c.fortress, s.x, s.y + 0.1, s.z)) return true;
        const range = GOBLINS.economy.moduleClearance;
        return project.tasks.some((task) => Math.abs(task.x - s.x) <= range
          && Math.abs(task.y - s.y) <= range && Math.abs(task.z - s.z) <= range);
      })) continue;
      for (const task of project.tasks) if (!task.done) c.forceTask(task);
      project.simDone = 0;
    }
  }

  // Puts a goblin somewhere plausible for what it would be doing.
  place(goblin) {
    const c = this.controller;
    if (goblin.type === ENTITY_TYPE.GOBLIN_WORKER
      && goblin.respawnArrivedProject !== c.project) goblin.respawnArrived = false;
    if (this.progressJourney(goblin) || goblin.respawnArrived || goblin.simPositioned) return;
    goblin.simPositioned = true;
    let spot = null;
    const project = c.repairs.remaining > 0 ? c.repairs : c.project;
    const site = project?.site;
    const t = c.totemSpot;
    const jitter = (p, r) => ({ x: p.x + Math.cos(goblin.id * 2.3) * r, y: p.y, z: p.z + Math.sin(goblin.id * 2.3) * r });
    if (goblin.stray || !t) return;
    if (goblin.type === ENTITY_TYPE.GOBLIN_WORKER) {
      const ambient = goblin.surfaceWanderer();
      if (ambient) {
        const spots = c.patrolSpots().filter((point) => point.kind !== 'fortress');
        if (spots.length) spot = spots[goblin.id % spots.length];
      } else if (site && (this.nextTask('dig') || this.nextTask('place'))) spot = jitter(site, 1);
      else {
        const spots = c.patrolSpots().filter((point) => point.kind === 'fortress');
        if (spots.length) spot = spots[goblin.id % spots.length];
      }
    } else {
      const reserve = goblin.assignment === 'reserve' && c.game.tick >= c.surfaceAlarmUntil;
      let spots = c.patrolSpots().filter((s) => reserve ? s.kind === 'fortress' : s.kind !== 'fortress');
      if (reserve && spots.length) {
        const floors = [...new Set(spots.map((s) => s.y))].sort((a, b) => a - b);
        spots = spots.filter((s) => s.y === floors[(goblin.slot ?? goblin.id) % floors.length]);
      }
      const post = goblin.type === ENTITY_TYPE.GOBLIN_ARCHER && c.claimPost(goblin);
      if (post) {
        goblin.post = post;
        goblin.spot = { ...post, kind: 'post' };
        goblin.arrived = true;
        spot = post;
      } else if (spots.length) {
        const pick = spots[goblin.id % spots.length];
        spot = jitter(pick, 1);
        goblin.spot = { ...spot, kind: pick.kind };
        goblin.arrived = true;
        goblin.waitUntil = 0;
      }
    }
    spot = goblin.gateSpot ?? spot ?? jitter(t, 3);
    const s = goblin.state;
    if (Math.hypot(s.x - spot.x, s.y - spot.y, s.z - spot.z) < 0.01) return;
    // Materialize only in a standable cell on this floor, never a dwelling wall.
    let safe = null;
    for (let r = 0; r <= 4 && !safe; r++) for (let dz = -r; dz <= r && !safe; dz++)
      for (let dx = -r; dx <= r && !safe; dx++) for (const dy of [0, -1, 1]) {
        const x = Math.floor(spot.x) + dx, y = Math.round(spot.y) + dy, z = Math.floor(spot.z) + dz;
        if (canStand(c.world, x, y, z, 2)) safe = {x: x + 0.5, y, z: z + 0.5};
      }
    if (!safe) return;
    Object.assign(s, { ...safe, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, onGround: false });
    goblin.teleported = true;
  }
}
