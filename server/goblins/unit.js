import { createPlayerState, playerFitsAt, playerBoxOf } from '../../shared/physics.js';
import { stepMobPath } from '../../shared/mobMovement.js';
import { GOBLINS, LIFE as C, COMBAT as K, WORK as W, DUTIES, boxOf } from '../../shared/goblins/life.js';
import { positionRegion } from '../../shared/goblins/areas.js';
import { ballisticAim, ballisticClear } from '../../shared/ballistics.js';
import { GOBLIN_STATE, S2C } from '../../shared/protocol.js';
import { isLadder } from '../../shared/blocks.js';
import { TICK_RATE } from '../../shared/config.js';
import { canSee, huntable } from '../provocation.js';
import { Arrow } from '../arrow.js';

const ticks = seconds => Math.round(seconds * TICK_RATE);
const wait = range => Math.round((range[0] + Math.random() * (range[1] - range[0])) * TICK_RATE);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const center = n => ({ x: n.x + 0.5, y: n.y, z: n.z + 0.5 });
export const UNIT_STATES = ['idle', 'work', 'patrol', 'post', 'fight', 'flee', 'return'];

// One state machine for every role; what a role does in a fight comes from its
// data (GOBLINS[role].melee / ranged / flee). Duty states (idle, patrol, post)
// run when there's no enemy. With a target it fights; workers flee instead.
// A rally (reinforcement order from the garrison) walks it to an area under
// attack. Losing the target, or the rally ending, sends it home ('return'),
// after which it resumes its duty.
export class GoblinUnit {
  constructor(id, garrison, slot, spawn) {
    this.id = id; this.garrison = garrison; this.slot = slot; this.home = slot.home;
    this.role = slot.role; this.def = GOBLINS[this.role]; this.type = `goblin${this.role[0].toUpperCase()}${this.role.slice(1)}`;
    this.name = this.def.name;
    this.immovable = !!this.def.immovable;
    this.goblin = true; this.faction = 'goblin'; this.connected = true; this.dead = false;
    this.hp = this.def.hp; this.state = createPlayerState(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
    this.state.box = boxOf(this.role); this.state.edgeGuard = !this.immovable;
    this.path = []; this.behavior = 'return'; this.destination = slot.point;
    this.wait = 0; this.index = 0; this.stuck = 0; this.retried = false; this.walking = false; this.climbing = false;
    this.navVersion = garrison.nav.version;
    this.homeRevision = garrison.nav.area(this.home)?.revision ?? 0; this.lookWait = 0;
    // Combat state.
    this.target = null; this.lastSeen = 0; this.nextAttack = 0; this.nextChase = 0; this.nextSpot = 0;
    this.ignore = null; this.rally = null; this.threat = null; this.safeSince = 0;
    // Work: the claimed job or inspection, and the hammer swing timer.
    this.task = null; this.nextSwing = 0; this.working = false;
    // Game.updateMobs lands the hit a melee step returns, with this damage/knockback.
    if (this.def.melee) { this.biteDamage = this.def.melee.damage; this.biteKnockback = this.def.melee.knockback; }
  }
  get game() { return this.garrison.game; }
  options() { return { ladders: this.def.ladders, role: this.role }; }
  eye(point = this.state) { return { x: point.x, y: point.y + this.def.height * 0.85, z: point.z }; }
  // Fighting, rallying and returning may leave the home area (through gates).
  get roaming() { return !!(this.target || this.rally || this.task) || this.behavior === 'return'; }
  // A destination with no route (a post not built yet) isn't searched again
  // for noRouteTicks: the answer is cached instead of re-run every tick.
  go(point) {
    const tick = this.game.tick, key = `${point.x},${point.y},${point.z}`;
    this.destination = point;
    if (this.noRoute?.key === key && tick < this.noRoute.until) { this.path = []; this.routePending = false; return []; }
    const area = this.garrison.nav.area(this.home);
    const route = this.garrison.nav.route(this.state, point, area, this.options());
    if (route !== null) this.path = route;
    this.routePending = route === null;
    if (route?.length === 0 && flat(this.state, center(point)) > 1) this.noRoute = { key, until: tick + C.noRouteTicks + this.id % 20 };
    return route;
  }

  // ---- Targeting ----

  setTarget(target, tick) {
    if (this.def.flee) {
      this.endTask();
      this.threat = target; this.safeSince = tick;
      if (this.behavior !== 'flee') { this.behavior = 'flee'; this.path = []; this.routePending = false; this.nextChase = 0; }
      return;
    }
    if (!this.def.melee && !this.def.ranged) return;
    this.target = target; this.lastSeen = tick; this.behavior = 'fight';
    this.path = []; this.routePending = false; this.nextChase = 0; this.nextSpot = 0;
  }
  loseTarget() {
    this.target = null; this.path = []; this.routePending = false; this.behavior = 'return';
  }
  // A target with no walkable route (or past the leash) is ignored for a while,
  // so the next scan doesn't pick it straight back up.
  giveUp(tick) {
    this.ignore = { target: this.target, until: tick + ticks(K.unreachableSeconds) };
    this.loseTarget();
  }
  // Damage from an enemy: fight (or flee from) the attacker even unseen.
  provoked(attacker, tick) {
    if (this.def.flee || !this.target) this.setTarget(attacker, tick);
  }
  updateTarget(world, tick) {
    const t = this.target;
    if (t) {
      if (!huntable(t)) this.loseTarget();
      else if (canSee(world, this.eye(), t)) this.lastSeen = tick;
      else if (tick - this.lastSeen > ticks(K.forgetSeconds)) this.loseTarget();
    }
    // Staggered round-robin: each goblin scans on its own tick of the interval.
    if (this.target || !this.def.sight || (tick + this.id) % K.scanTicks) return;
    const found = this.garrison.findTarget(this, this.def.flee?.range ?? this.def.sight, tick);
    if (found) this.setTarget(found, tick);
  }

  // ---- Melee ----

  // The leash is measured from home, or from the rally point while reinforcing.
  anchor() {
    return (this.rally && this.garrison.alarms.get(this.rally.area)?.point) || center(this.slot.point);
  }
  reach(target) { return this.def.melee.reach + this.state.box.halfW + playerBoxOf(target.state).halfW; }
  // A walkable route to the target through gates, false when there is none
  // (no region under it, its nearest node isn't next to it, or the King would
  // leave his floor), or null when the tick's search budget ran out.
  chaseRoute(ts) {
    const nav = this.garrison.nav, home = this.slot.point;
    const dest = { x: Math.floor(ts.x), y: Math.round(ts.y), z: Math.floor(ts.z) };
    if (this.def.floorOnly && Math.abs(dest.y - home.y) > 1) return false;
    const region = positionRegion(this.garrison.plan, ts); if (!region) return false;
    const goal = nav.nearest(region, dest, this.role);
    if (!goal || flat(goal, dest) > 2 || Math.abs(goal.y - dest.y) > 1.5) return false;
    const route = nav.route(this.state, dest, region, this.options());
    if (route === null) return null;
    if (!route.length) return flat(this.state, ts) < 3 ? [] : false;
    if (this.def.floorOnly && route.some(n => Math.abs(n.y - home.y) > 1)) return false;
    return route;
  }
  meleeStep(tick) {
    const t = this.target, ts = t.state, s = this.state;
    if (flat(s, this.anchor()) > this.def.leash) { this.giveUp(tick); return; }
    const d = flat(s, ts);
    if (d <= this.reach(t) + K.closeRange && Math.abs(ts.y - s.y) < 1.2) {
      // In contact range: step straight at it rather than following nodes.
      this.path = d > this.reach(t) * 0.7 ? [{ x: Math.floor(ts.x), y: Math.round(s.y), z: Math.floor(ts.z), grounded: true }] : [];
      return;
    }
    if (tick < this.nextChase && this.path.length) return;
    this.nextChase = tick + K.chaseReplanTicks;
    const route = this.chaseRoute(ts);
    if (route === false) this.giveUp(tick);
    else if (route === null) this.nextChase = tick + 1;
    else this.path = route;
  }

  // ---- Archery ----

  // A clear ballistic shot from a standing point (feet) at the target, or null.
  aim(world, at, target) {
    const r = this.def.ranged, ts = target.state;
    const to = { x: ts.x, y: ts.y + playerBoxOf(ts).height * 0.6, z: ts.z }, eye = this.eye(at);
    const hx = to.x - eye.x, hz = to.z - eye.z, h = Math.hypot(hx, hz);
    // Release half a block toward the target, past its own body and the edge
    // it stands on, so shots straight down off a post still clear.
    const from = h > 0.01 ? { x: eye.x + hx / h * 0.5, y: eye.y, z: eye.z + hz / h * 0.5 } : eye;
    if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > r.range) return null;
    let path = ballisticAim(from, to, r.arrowSpeed); if (!path) return null;
    const lead = { x: to.x + (ts.vx ?? 0) * path.time, y: to.y, z: to.z + (ts.vz ?? 0) * path.time };
    path = ballisticAim(from, lead, r.arrowSpeed) ?? path;
    return ballisticClear(world, path) ? path : null;
  }
  // Where to stand for a clear shot. Tower archers stay on their post,
  // nearest edge to the target first; ground archers step around their spot
  // but stay behind their gate guards; others step around where they are.
  shotSpot(world, t) {
    const nav = this.garrison.nav, area = nav.area(this.home), duty = this.slot.duty;
    let spots;
    if (duty === 'tower') {
      spots = nav.nodesNear(area, center(this.slot.point), K.postEdge + 0.5, this.role)
        .filter(n => n.y === this.slot.point.y).sort((a, b) => flat(center(a), t.state) - flat(center(b), t.state));
    } else {
      const base = duty === 'ground' ? center(this.slot.point) : this.state;
      spots = nav.nodesNear(area, base, K.archerShift, this.role).filter(n => Math.abs(n.y - base.y) <= 1);
      if (this.slot.guard) {
        const limit = flat(center(this.slot.guard), t.state);
        spots = spots.filter(n => flat(center(n), t.state) >= limit);
      }
    }
    return spots.slice(0, K.shotSpots).find(n => this.aim(world, center(n), t)) ?? null;
  }
  rangedStep(world, tick) {
    if (this.routePending) { this.go(this.destination); return; }
    if (this.path.length || tick < this.nextSpot) return;
    this.nextSpot = tick + K.scanTicks;
    if (this.aim(world, this.state, this.target)) return;
    const spot = this.shotSpot(world, this.target);
    if (spot) this.go(spot);
  }
  shoot(path) {
    const game = this.game, spread = this.def.ranged.spread * path.speed, jitter = () => (Math.random() - 0.5) * 2 * spread;
    const arrow = new Arrow(game.nextId++, this, path.from.x, path.from.y, path.from.z,
      path.vx + jitter(), path.vy + jitter(), path.vz + jitter(), 0.5);
    arrow.damage = this.def.ranged.damage;
    game.arrows.set(arrow.id, arrow);
    game.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
  }

  // ---- Fleeing (workers) and rallying ----

  fleeStep(tick) {
    const threat = this.threat, f = this.def.flee;
    if (threat && huntable(threat) && flat(threat.state, this.state) <= f.safeRange) this.safeSince = tick;
    else if (tick - this.safeSince >= ticks(f.safeTime)) { this.threat = null; this.behavior = 'return'; return; }
    if (this.routePending) { this.go(this.destination); return; }
    if (!threat || this.path.length || tick < this.nextChase) return;
    this.nextChase = tick + K.chaseReplanTicks;
    const nav = this.garrison.nav, area = nav.area(this.home);
    const away = nav.nodesNear(area, this.state, f.safeRange, this.role)
      .reduce((best, n) => !best || flat(center(n), threat.state) > flat(center(best), threat.state) ? n : best, null);
    if (away && flat(center(away), threat.state) > flat(this.state, threat.state) + 1) this.go(away);
  }
  rallyStep(tick) {
    const alarm = this.garrison.alarms.get(this.rally.area);
    if (!alarm) { this.rally = null; this.behavior = 'return'; return; }
    if (this.path.length || tick < this.nextChase || flat(this.state, alarm.point) < 3) return;
    this.nextChase = tick + K.chaseReplanTicks * 2;
    const nav = this.garrison.nav, route = nav.route(this.state, alarm.point, nav.area(this.rally.area), this.options());
    if (route?.length) this.path = route;
  }

  // ---- Work ----

  // Ends the current job or inspection; a job goes back to the pool unless
  // finished. The worker looks for its next task straight away.
  endTask() {
    const job = this.task?.job;
    if (job?.worker === this) job.worker = null;
    this.task = null; this.working = false;
    if (this.behavior === 'work') { this.behavior = 'idle'; this.wait = 0; }
  }
  // Seconds per swing: construction runs at its paced interval.
  // Schedules the next swing. Construction's paced interval can be a
  // fraction of a tick: back-to-back swings carry the remainder over.
  swing(job, tick) {
    const seconds = job?.entry || job?.climb ? this.garrison.construction?.swing ?? W.swingSeconds : W.swingSeconds;
    const base = this.nextSwing > tick - 2 ? this.nextSwing : tick;
    this.nextSwing = base + seconds * TICK_RATE;
  }
  workStep(tick) {
    const task = this.task, work = this.garrison.work, nav = this.garrison.nav, job = task.job;
    if (job && (!work.jobs.has(job) || job.worker !== this)) { this.endTask(); return; }
    const areaId = job ? job.area : this.home, area = nav.area(areaId);
    // No work while an enemy is inside the area; the job waits for the area to clear.
    if (this.garrison.occupied.has(areaId)) { this.endTask(); return; }
    // A task with no block placed for taskTimeout (blocked, unroutable, stuck)
    // is given up; the job waits a while before anyone tries it again.
    task.since ??= tick;
    if (tick - task.since > ticks(W.taskTimeout)) {
      if (!task.close) work.badSpot(job?.spot);
      this.giveUpJob(job, tick); this.endTask(); return;
    }
    if (job?.climb) { this.climbStep(tick, job); return; }
    task.dest ??= job ? job.spot : nav.nearest(area, task.section.center, this.role);
    if (!task.dest) { this.endTask(); return; }
    const s = this.state, dest = center(task.dest);
    const arrived = task.close || flat(s, dest) <= W.arriveDistance && Math.abs(s.y - task.dest.y) < 0.6
      || !job && flat(s, task.section.center) <= W.inspectDistance;
    if (!arrived) {
      this.working = false;
      if (this.path.length) return;
      // A spot it can't walk to: the job waits until blocks there change.
      if ((task.tries = (task.tries ?? 0) + 1) > 2) { work.badSpot(job?.spot); this.giveUpJob(job, tick); this.endTask(); return; }
      const route = this.routeTo(task.dest, area);
      // An empty route means it's already on the goal node (crowds can push
      // it slightly off center): close enough to work.
      if (route?.length === 0 && flat(s, dest) <= W.closeEnough && Math.abs(s.y - task.dest.y) < 1) { task.close = true; return; }
      if (route === null || route.exit) task.tries--;
      if (route) this.path = route;
      return;
    }
    if (!job) { work.inspect(task.section, this); this.endTask(); return; }
    this.path = []; this.working = true;
    if (tick < this.nextSwing) return;
    // The swing lands on the block chosen (and faced) at its start.
    if (task.current && work.need(task.current)) { work.apply(task.current); this.garrison.construction?.progressed(job); task.since = tick; }
    task.current = null;
    const block = work.nextBlock(job, this);
    if (block === null) { work.drop(job); this.endTask(); return; }
    this.swing(job, tick);
    if (block === 'blocked') {
      // Possibly its own body, off the spot's center: step back onto it. If it
      // stays blocked (a player standing there), the job goes back for later.
      if ((task.blocked = (task.blocked ?? 0) + 1) > W.blockedSwings) { this.giveUpJob(job, tick); this.endTask(); return; }
      if (job.spot) this.path = [{ x: job.spot.x, y: job.spot.y, z: job.spot.z, grounded: true }];
      return;
    }
    task.blocked = 0;
    task.current = block;
    s.yaw = Math.atan2(-(block.x + 0.5 - s.x), -(block.z + 0.5 - s.z));
  }
  // A job its worker can't do: construction work joins its area's backlog
  // (re-checked when more becomes reachable); a repair waits.
  giveUpJob(job, tick) {
    if (!job || job.climb) return;
    if (job.worker === this) job.worker = null;
    if (this.garrison.construction?.deferJob(job)) return;
    job.waiting = true; job.retryAt = tick + ticks(W.waitRetrySeconds * 3);
  }
  // Shaft work: the worker stands on the ladder column (job.climb.offset
  // blocks from its block), or at the approach node on the floor beside it
  // when that's out of the column's range or not dug yet.
  climbStep(tick, job) {
    const task = this.task, work = this.garrison.work, nav = this.garrison.nav, c = job.climb, s = this.state;
    if (!task.current) {
      const block = work.nextBlock(job, this);
      if (block === null) { work.drop(job); this.endTask(); return; }
      if (block === 'blocked') return;
      const y = block.y + c.offset;
      const ladder = y >= c.min && y <= c.max && y !== block.y && isLadder(this.game.world.getBlock(c.x, y, c.z));
      task.current = block; task.stand = ladder ? { x: c.x, y, z: c.z } : null; task.tries = 0; task.swung = false;
    }
    const block = task.current, stand = task.stand ?? c.approach;
    if (!stand) { this.endTask(); return; }
    const inColumn = Math.abs(s.x - c.x - 0.5) < 0.3 && Math.abs(s.z - c.z - 0.5) < 0.3;
    const arrived = task.stand ? inColumn && Math.abs(s.y - stand.y) < 0.4
      : flat(s, center(stand)) <= W.arriveDistance && Math.abs(s.y - stand.y) < 0.6;
    if (!arrived) {
      this.working = false;
      if (this.path.length) return;
      if ((task.tries = (task.tries ?? 0) + 1) > 3) { this.endTask(); return; }
      if (!task.stand) {
        // Off the ladder: walk to the approach node (out of the column first).
        const route = this.routeTo(stand, nav.area(c.approachArea));
        if (route === null || route.exit) task.tries--;
        if (route) this.path = route;
      } else if (inColumn) this.path = [{ x: c.x, y: stand.y, z: c.z, ladder: true }];
      else {
        // Walk to the approach node, step across into the column, then climb.
        const route = flat(s, center(c.approach)) <= W.arriveDistance ? [] : this.routeTo(c.approach, nav.area(c.approachArea));
        if (route === null) { task.tries--; return; }
        if (route.exit) { task.tries--; this.path = route; return; }
        const steps = [], a = c.approach;
        for (let x = a.x; x !== c.x; x += Math.sign(c.x - x)) if (x !== a.x) steps.push({ x, y: a.y, z: a.z, grounded: true });
        for (let z = a.z; z !== c.z; z += Math.sign(c.z - z)) steps.push({ x: c.x, y: a.y, z, grounded: true });
        this.path = [...route, ...steps, { x: c.x, y: a.y, z: c.z, ladder: true }, { x: c.x, y: stand.y, z: c.z, ladder: true }];
      }
      return;
    }
    this.path = []; this.working = true;
    s.yaw = Math.atan2(-(block.x + 0.5 - s.x), -(block.z + 0.5 - s.z));
    if (!task.swung) { task.swung = true; this.swing(job, tick); return; }
    if (tick < this.nextSwing) return;
    if (work.need(block)) { work.apply(block); this.garrison.construction?.progressed(job); task.since = tick; }
    task.current = null;
  }
  // Waypoints to a node: through a planned area's construction site when the
  // destination is in one, walking out of the site it stands in first
  // (marked .exit, not a real attempt), or a normal route.
  routeTo(dest, area) {
    const construction = this.garrison.construction, here = this.garrison.regionAt(this.state);
    if (here?.state === 'planned' && here !== area) {
      const exit = construction?.site(here)?.exit(this);
      if (exit?.length) { exit.exit = true; return exit; }
    }
    if (area?.state === 'planned') return construction?.site(area)?.routeTo(this, dest) ?? [];
    return this.garrison.nav.route(this.state, dest, area, this.options());
  }
  // A worker that finished a job inside a construction site walks out
  // through the site's nearest entry before going home.
  leaveSite() {
    const area = this.garrison.regionAt(this.state);
    if (!area || area.state !== 'planned') return false;
    const path = this.garrison.construction?.site(area)?.exit(this);
    if (!path?.length) return false;
    this.path = path; this.behavior = 'return'; return true;
  }

  // ---- Duties ----

  think() {
    const duty = DUTIES[this.slot.duty];
    if (this.routePending) { this.go(this.destination); return; }
    if (this.path.length || --this.wait > 0) return;
    switch (this.behavior) {
      case 'return':
        this.behavior = duty?.state ?? 'idle'; this.wait = wait(C.wanderWait); break;
      case 'patrol': {
        const loop = this.slot.loop;
        this.go(loop[this.index++ % loop.length]); break;
      }
      case 'idle': {
        // Workers take a job (or an inspection) before wandering.
        const task = this.slot.duty === 'worker' ? this.garrison.work.nextTask(this, this.game.tick) : null;
        if (task) { this.task = task; this.behavior = 'work'; this.path = []; return; }
        const area = this.garrison.nav.area(this.home), points = area.interests.length ? area.interests : this.slot.loop;
        this.go(points[Math.floor(Math.random() * points.length)] ?? this.slot.point);
        this.wait = wait(C.wanderWait); break;
      }
      case 'post': {
        const area = this.garrison.nav.area(this.home), radius = duty?.radius ?? C.postRadius;
        const point = this.slot.point;
        const choices = this.garrison.nav.nodesNear(area, center(point), radius, this.role).filter(n => n.y === point.y
          && (!this.slot.box || n.x > this.slot.box.x0 && n.x < this.slot.box.x1 && n.z > this.slot.box.z0 && n.z < this.slot.box.z1));
        this.go(this.shifted ? point : choices[Math.floor(Math.random() * choices.length)] ?? point);
        this.shifted = !this.shifted; this.state.yaw += (Math.random() - 0.5) * Math.PI;
        this.wait = wait(C.postWait); break;
      }
      // Fight and flee run from step(); work is unused until repairs exist.
      case 'work': case 'fight': case 'flee': break;
      default: this.behavior = 'return';
    }
  }
  unseen(world, players, point = this.state) {
    return players.every(p => p.dead || !p.connected
      || !canSee(world, { x: point.x, y: point.y + this.def.height * 0.7, z: point.z }, p));
  }
  // One tick. Returns the target a melee hit lands on, else null.
  step(world, players) {
    if (this.def.speed === 0) return null;
    const nav = this.garrison.nav, tick = this.game.tick;
    if (this.navVersion !== nav.version) { this.path = []; this.routePending = !this.roaming; this.nextChase = 0; this.navVersion = nav.version; }
    const area = nav.area(this.home); if (!area) return null;
    if (this.homeRevision !== (area.revision ?? 0)) { this.path = []; this.routePending = !this.roaming; this.nextChase = 0; this.homeRevision = area.revision ?? 0; }
    this.updateTarget(world, tick);
    let speed = this.def.speed;
    if (this.behavior === 'flee') { this.fleeStep(tick); speed *= K.chaseSpeed; }
    else if (this.target) {
      if (this.def.melee) this.meleeStep(tick); else this.rangedStep(world, tick);
      speed *= K.chaseSpeed;
    } else if (this.rally) { this.rallyStep(tick); speed *= K.chaseSpeed; }
    else if (this.task) this.workStep(tick);
    else {
      // Workers look for work wherever they are (a finished job may leave them
      // outside their home, on a construction site).
      if (this.slot.duty === 'worker' && !this.path.length && tick >= (this.nextWorkLook ?? 0)) {
        this.nextWorkLook = tick + K.scanTicks;
        const task = this.garrison.work.nextTask(this, tick);
        if (task) { this.task = task; this.behavior = 'work'; return this.afterMove(world, tick); }
      }
      if (this.behavior === 'post' && !this.path.length && --this.lookWait <= 0) {
        this.state.yaw += (Math.random() - 0.5) * Math.PI; this.lookWait = wait(C.postWait);
      }
      // A hit may knock a goblin outside its home. Only its return journey may
      // use gate crossings; normal decisions are strictly home constrained.
      if (!nav.contains(area, this.state) && this.behavior !== 'return' && !this.leaveSite()) { this.behavior = 'return'; this.go(this.slot.point); }
      if (this.behavior === 'return' && !this.path.length && !this.routePending && Math.hypot(this.state.x - this.slot.point.x - 0.5,
        this.state.y - this.slot.point.y, this.state.z - this.slot.point.z - 0.5) > 0.4) {
        // A post that isn't built yet: wait at the area's spawn point instead.
        const route = this.go(this.slot.point);
        if (route?.length === 0 && !this.garrison.construction?.done) {
          this.waitPoint ??= this.garrison.spawnFor(this.slot)?.point ?? null;
          if (this.waitPoint) this.go(this.waitPoint);
        }
      }
      this.think();
    }
    const hadPath = this.path.length > 0, moved = stepMobPath(this, world, speed);
    if (hadPath && moved < 0.02) this.stuck++; else { this.stuck = 0; if (moved > 0.04) this.retried = false; }
    if (this.stuck >= C.stuckTicks) {
      this.stuck = 0;
      // Fights and rallies re-plan on their own schedule.
      if (this.target || this.rally) { this.path = []; this.nextChase = 0; }
      else this.unstick(world, players, area);
    }
    return this.afterMove(world, tick);
  }
  unstick(world, players, area) {
    const nav = this.garrison.nav;
    if (this.retried && this.path.length && this.unseen(world, players)) {
      const p = this.path[0], dx = p.x + 0.5 - this.state.x, dy = p.y - this.state.y, dz = p.z + 0.5 - this.state.z;
      const length = Math.hypot(dx, dy, dz), scale = Math.min(1, C.unseenAdvance / Math.max(length, 0.01));
      const next = nav.nearest(area, { x: this.state.x + dx * scale, y: this.state.y + dy * scale, z: this.state.z + dz * scale }, this.role);
      const clear = next && Array.from({ length: Math.ceil(C.unseenAdvance * 4) + 1 }, (_, i) => {
        const t = i / (Math.ceil(C.unseenAdvance * 4) + 1);
        const point = { x: this.state.x + (next.x + 0.5 - this.state.x) * t, y: this.state.y + (next.y - this.state.y) * t,
          z: this.state.z + (next.z + 0.5 - this.state.z) * t, box: this.state.box };
        return nav.contains(area, point) && playerFitsAt(world, point, point.y);
      }).every(Boolean);
      // Advance along this path segment only, with body clearance and no
      // player visibility at either end. Never cut across a wall.
      if (next && clear && Math.hypot(next.x + 0.5 - this.state.x, next.y - this.state.y, next.z + 0.5 - this.state.z) <= C.unseenAdvance && nav.fits(next, this.role)
        && this.unseen(world, players, { x: next.x + 0.5, y: next.y, z: next.z + 0.5 })) {
        this.state.x = next.x + 0.5; this.state.y = next.y; this.state.z = next.z + 0.5; this.state.vy = 0;
      }
    }
    this.retried = true; this.go(this.destination);
  }
  // Face the target, and attack once the cooldown allows: a melee hit in
  // reach (returned for Game to land), or an arrow when standing with a clear shot.
  afterMove(world, tick) {
    const t = this.target; if (!t) return null;
    const s = this.state, ts = t.state, dx = ts.x - s.x, dz = ts.z - s.z, d = Math.hypot(dx, dz);
    if (this.def.melee) {
      if (d > this.reach(t) + K.closeRange) return null;
      s.yaw = Math.atan2(-dx, -dz);
      if (tick < this.nextAttack || d > this.reach(t) || Math.abs(ts.y - s.y) >= 1.5 || !canSee(world, this.eye(), t)) return null;
      this.nextAttack = tick + ticks(this.def.melee.cooldown);
      return t;
    }
    if (this.path.length) return null;
    s.yaw = Math.atan2(-dx, -dz);
    if (tick < this.nextAttack) return null;
    const shot = this.aim(world, s, t);
    if (!shot) { this.nextAttack = tick + K.scanTicks / 2; return null; }
    this.shoot(shot);
    this.nextAttack = tick + ticks(this.def.ranged.cooldown);
    return null;
  }
  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100,
      z: Math.round(s.z * 100) / 100, yaw: Math.round(s.yaw * 100) / 100,
      g: this.climbing ? GOBLIN_STATE.CLIMB : this.walking ? GOBLIN_STATE.WALK
        : this.working ? GOBLIN_STATE.WORK : GOBLIN_STATE.IDLE };
  }
  describe() { return { ...this.snapshot(), name: this.name, hp: this.hp, maxHp: this.def.hp }; }
}
