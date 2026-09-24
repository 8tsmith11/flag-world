// Offscreen goblins. While no player is near (GoblinController.updateMode),
// colony goblins stop moving and this simulation advances their work at
// estimated rates instead: every GOBLINS.offscreen.step seconds, workers and
// builders each get that much working time, spent on the same tasks they
// would do (repairs, project digs and placements, chopping, quarrying).
// A task costs its break or place time plus its share of the trips between
// the totem and the site (a load of carryLimit per trip). Changes are
// applied to the world directly, in batches, and goblins are put at their
// work sites, so switching back to full simulation picks up from there.

import { TICK_RATE, CLIMB_SPEED } from '../shared/config.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { GOBLINS } from '../shared/goblins.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { goblinBreakTicks, goblinPlaceTicks, taskSatisfied, isProtected, yieldOf } from './goblinProjects.js';

const seconds = (gameTicks) => gameTicks / TICK_RATE;

export class OffscreenSim {
  constructor(controller) {
    this.controller = controller;
    this.workerCredit = 0;
    this.builderCredit = 0;
    this.nextStep = 0;
    // Builders ran out of a material this step (for spawning decisions).
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
    return walk * 2;
  }

  // Shaft and ladder work: climbing up to the block and back down, shared
  // by the few blocks done per climb.
  climbTime(task) {
    if (!task.climb) return 0;
    return 2 * Math.max(0, task.y - task.climb.floorY) / CLIMB_SPEED / GOBLINS.offscreen.blocksPerClimb;
  }

  tripTime(project) {
    if (!project?.site) return 0;
    return this.roundTrip({ ...project.site, surface: !!project.surface });
  }

  enter() {
    const c = this.controller;
    for (const g of c.members) {
      g.releaseWork?.();
      if (g.carrying?.size) c.deposit(g);
      this.place(g);
    }
    this.workerCredit = this.builderCredit = 0;
    this.nextStep = c.game.tick + Math.round(GOBLINS.offscreen.step * TICK_RATE);
  }

  leave() {
    for (const g of this.controller.members) {
      g.route = null;
      g.job = null;
      g.stuckTicks = 0;
    }
  }

  // The next task of a kind whose requirements are done (reach and exposure
  // don't matter offscreen), or null.
  nextTask(kind) {
    const c = this.controller;
    for (const project of c.activeProjects()) {
      for (const task of project.tasks) {
        if (task.done || task.kind !== kind) continue;
        if (task.requires.some((t) => !t.done)) continue;
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
    const step = GOBLINS.offscreen.step;
    this.nextStep = tick + Math.round(step * TICK_RATE);
    const share = step * (1 - GOBLINS.offscreen.overhead);
    const workers = c.countOf(ENTITY_TYPE.GOBLIN_WORKER), builders = c.countOf(ENTITY_TYPE.GOBLIN_BUILDER);
    // Credit carries over (a task can take longer than a step), but only so far.
    // While wood is wanted, part of the workers' time goes to chopping.
    const woodTime = c.surfaceOpen() && c.woodWanted() && c.woodSources().length ? workers * share * GOBLINS.offscreen.woodShare : 0;
    this.woodCredit = woodTime ? Math.min((this.woodCredit ?? 0) + woodTime, 150) : 0;
    // (The cap leaves room to save up for a whole tree.)
    this.workerCredit = Math.min(this.workerCredit + workers * share - woodTime, workers * step * 4 + 150);
    this.builderCredit = Math.min(this.builderCredit + builders * share, builders * step * 4 + 30);
    if (c.totemAlive) {
      this.work();
      this.build();
    }
    for (const g of c.members) this.place(g);
  }

  // Fells one tree if wood is wanted and the credit `pool` ('workerCredit'
  // or 'woodCredit') covers it. True if one fell, 'short' if there's a tree
  // but not yet the credit for it.
  chop(pool) {
    const c = this.controller;
    const world = c.world;
    if (!c.surfaceOpen() || !c.woodWanted()) return false;
    const tree = c.woodSources()[0];
    if (!tree) return false;
    const logs = [];
    for (let y = tree.y; y < tree.y + 12 && world.getBlock(tree.x, y, tree.z) === BLOCK.WOOD; y++) logs.push(y);
    const cost = logs.length * (seconds(goblinBreakTicks(BLOCK.WOOD)) + GOBLINS.offscreen.perBlock)
      + this.roundTrip({ ...tree, surface: true }) * Math.max(0.5, logs.length / GOBLINS.worker.carryLimit);
    if (this[pool] < cost) return 'short';
    this[pool] -= cost;
    for (const y of logs) c.setBlock(tree.x, y, tree.z, BLOCK.AIR);
    c.store('wood', logs.length);
    c.treeFelled(tree);
    if (tree.plot && world.getBlock(tree.x, tree.y - 1, tree.z) !== BLOCK.AIR) c.setBlock(tree.x, tree.y, tree.z, BLOCK.SAPLING);
    return true;
  }

  // Workers: some wood if it's wanted, project digs, then more wood, then the quarry.
  work() {
    const c = this.controller;
    const world = c.world;
    const carry = GOBLINS.worker.carryLimit;
    while (this.woodCredit > 0 && this.chop('woodCredit') === true);
    for (let guard = 0; guard < 2000 && this.workerCredit > 0; guard++) {
      const task = this.nextTask('dig');
      if (task) {
        const cost = seconds(goblinBreakTicks(world.getBlock(task.x, task.y, task.z))) + task.project.tripTime / carry
          + this.climbTime(task) + GOBLINS.offscreen.perBlock;
        if (this.workerCredit < cost) return;
        this.workerCredit -= cost;
        c.store(c.forceTask(task), 1);
        c.stats.dug++;
        continue;
      }
      if (c.surfaceOpen() && c.storage.saplings > 0) {
        const spot = c.emptyPlotSpots()[0];
        if (spot) {
          const cost = seconds(goblinPlaceTicks()) + this.roundTrip({ ...spot, surface: true }) / 2;
          if (this.workerCredit < cost) return;
          this.workerCredit -= cost;
          if (c.take('saplings', 1)) c.setBlock(spot.x, spot.y, spot.z, BLOCK.SAPLING);
          continue;
        }
      }
      const chopped = this.chop('workerCredit');
      if (chopped === true) continue;
      // Saving up for a tree rather than quarrying.
      if (chopped === 'short') return;
      const stone = this.quarryStone();
      if (!stone) {
        this.workerCredit = Math.min(this.workerCredit, 0);
        return;
      }
      const cost = seconds(goblinBreakTicks(BLOCK.STONE)) + this.roundTrip(stone) / carry + GOBLINS.offscreen.quarryWalk;
      if (this.workerCredit < cost) return;
      this.workerCredit -= cost;
      c.setBlock(stone.x, stone.y, stone.z, BLOCK.AIR);
      c.store('stone', 1);
      c.stats.quarried++;
    }
  }

  quarryStone() {
    const q = this.controller.quarry;
    const world = this.controller.world;
    if (!q || world.getBlock(q.x, q.y, q.z) !== BLOCK.QUARRY_STONE) return null;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      if (world.getBlock(q.x + dx, q.y + dy, q.z + dz) === BLOCK.STONE) return { x: q.x + dx, y: q.y + dy, z: q.z + dz };
    }
    return null;
  }

  // Builders: placements in order, as materials allow.
  build() {
    const c = this.controller;
    const world = c.world;
    const carry = GOBLINS.builder.carryLimit;
    this.starved = false;
    for (let guard = 0; guard < 2000 && this.builderCredit > 0; guard++) {
      const task = this.nextTask('place');
      if (!task) {
        this.builderCredit = Math.min(this.builderCredit, 0);
        return;
      }
      if (task.material && c.available(task.material) < 1) {
        this.starved = true;
        this.builderCredit = Math.min(this.builderCredit, 0);
        return;
      }
      const current = world.getBlock(task.x, task.y, task.z);
      const replacing = isSolid(current) && !isProtected(current);
      const cost = seconds(goblinPlaceTicks()) + (replacing ? seconds(goblinBreakTicks(current)) : 0)
        + (task.material ? task.project.tripTime / carry : 0) + this.climbTime(task) + GOBLINS.offscreen.perBlock;
      if (this.builderCredit < cost) return;
      this.builderCredit -= cost;
      if (task.material) c.take(task.material, 1);
      if (replacing) c.store(yieldOf(current), 1);
      c.setBlock(task.x, task.y, task.z, task.id);
      c.finishTask(task, null);
      c.stats.placed++;
    }
  }

  // Puts a goblin somewhere plausible for what it would be doing.
  place(goblin) {
    const c = this.controller;
    let spot = null;
    const project = c.repairs.remaining > 0 ? c.repairs : c.project;
    const site = project?.site;
    const t = c.totemSpot;
    const jitter = (p, r) => ({ x: p.x + Math.cos(goblin.id * 2.3) * r, y: p.y, z: p.z + Math.sin(goblin.id * 2.3) * r });
    if (goblin.stray || !t) return;
    if (goblin.type === ENTITY_TYPE.GOBLIN_WORKER) {
      if (site && this.nextTask('dig')) spot = jitter(site, 1);
      else if (c.quarry) spot = jitter({ x: c.quarry.x + 0.5, y: c.quarry.y, z: c.quarry.z + 0.5 }, 2);
    } else if (goblin.type === ENTITY_TYPE.GOBLIN_BUILDER) {
      if (site && this.nextTask('place') && !this.starved) spot = jitter(site, 1.2);
    } else {
      const spots = c.patrolSpots();
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
    spot = spot ?? jitter(t, 3);
    const s = goblin.state;
    if (Math.hypot(s.x - spot.x, s.y - spot.y, s.z - spot.z) < 0.01) return;
    Object.assign(s, { x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, onGround: false });
    goblin.teleported = true;
  }
}

