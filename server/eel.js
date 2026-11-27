// Deep-void swimmers. Natural worldgen terrain blocks their vertical detection;
// player-built bridges do not. The server owns movement, targeting and bites.
import {
  TICK_RATE, TICK_DT, EEL_HP, EEL_SPEED, EEL_CHASE_SPEED, EEL_LUNGE_SPEED,
  EEL_LUNGE_WINDUP, EEL_REACH, EEL_DETECT_RADIUS, EEL_DETECT_HEIGHT,
  EEL_NIGHT_DETECT_SCALE, EEL_NIGHT_RISE_SCALE, EEL_FORGET_TIME,
  EEL_LOSE_RANGE, EEL_WANDER_RADIUS, EEL_ATTACK_COOLDOWN,
  EEL_LUNGE_DURATION, EEL_TURN_RATE, EEL_EDGE_REACH, EEL_LURK_TIME, EEL_LURK_DEPTH, EEL_PLAY_MARGIN, EEL_LURK_WEIGHTS,
} from '../shared/config.js';
import { playerBoxOf, playerFitsAt } from '../shared/physics.js';
import { isSolid } from '../shared/blocks.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { Provocation, huntable } from './provocation.js';
import { FISHING } from '../shared/config.js';

export const EEL_BOX = { halfW: 0.6, height: 0.8 };
const WINDUP_TICKS = Math.round(EEL_LUNGE_WINDUP * TICK_RATE);
const LUNGE_TICKS = Math.round(EEL_LUNGE_DURATION * TICK_RATE);
const FORGET_TICKS = Math.round(EEL_FORGET_TIME * TICK_RATE);
const COOLDOWN_TICKS = Math.round(EEL_ATTACK_COOLDOWN * TICK_RATE);
const EDGE_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  .map(([x, z]) => [x * EEL_EDGE_REACH, z * EEL_EDGE_REACH]);

function turnToward(current, wanted) {
  let difference = (wanted - current + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  return current + Math.max(-EEL_TURN_RATE, Math.min(EEL_TURN_RATE, difference - Math.PI));
}

// The play area eels roam: within EEL_PLAY_MARGIN of the central and team
// islands (and the tiny islands among them), never out to the elemental
// islands. Cached per world.
const playAreas = new WeakMap();
function playArea(world) {
  let area = playAreas.get(world);
  if (area) return area;
  const islands = world.islands ?? [];
  const center = islands.find(i => i.kind === 'center') ?? { x: world.sizeX / 2, z: world.sizeZ / 2, radius: 32 };
  let radius = center.radius + EEL_PLAY_MARGIN;
  for (const i of islands) if (i.kind === 'team') radius = Math.max(radius, Math.hypot(i.x - center.x, i.z - center.z) + i.radius + EEL_PLAY_MARGIN);
  const avoid = islands.filter(i => i.kind === 'fire' || i.kind === 'ice');
  area = { x: center.x, z: center.z, radius, avoid };
  playAreas.set(world, area);
  return area;
}
export function inEelPlayArea(world, x, z) {
  const a = playArea(world);
  return Math.hypot(x - a.x, z - a.z) <= a.radius
    && !a.avoid.some(i => Math.hypot(x - i.x, z - i.z) <= i.radius + EEL_PLAY_MARGIN);
}
// A random column to lurk under: by island (EEL_LURK_WEIGHTS), near a team
// island's edge, anywhere under a small island or under the central island's
// edge; without islands, anywhere in the play area.
function lurkColumn(world) {
  const a = playArea(world), W = EEL_LURK_WEIGHTS;
  const islands = (world.islands ?? []).filter((i) => (i.kind === 'team' || i.kind === 'tiny' || i.kind === 'center')
    && inEelPlayArea(world, i.x, i.z));
  // Each kind's weight is shared among its islands.
  const count = {}; for (const i of islands) count[i.kind] = (count[i.kind] ?? 0) + 1;
  const weight = (i) => W[i.kind] / count[i.kind];
  const total = islands.reduce((n, i) => n + weight(i), 0);
  if (!total) {
    const angle = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * a.radius;
    return { x: Math.floor(a.x + Math.cos(angle) * r), z: Math.floor(a.z + Math.sin(angle) * r) };
  }
  let pick = Math.random() * total, island = islands[0];
  for (const i of islands) { pick -= weight(i); if (pick <= 0) { island = i; break; } }
  const angle = Math.random() * Math.PI * 2;
  const r = island.kind === 'tiny' ? Math.sqrt(Math.random()) * island.radius
    : island.radius * (W.edge + Math.random() * (1.05 - W.edge));
  return { x: Math.floor(island.x + Math.cos(angle) * r), z: Math.floor(island.z + Math.sin(angle) * r) };
}

// A random point a few blocks under the lowest block of a lurk column
// (lurkColumn) that has one, inside the play area; null when a few tries
// find nothing.
export function underBlockSpot(world, band, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const { x, z } = lurkColumn(world);
    if (!inEelPlayArea(world, x, z) || x < 2 || z < 2 || x >= world.sizeX - 2 || z >= world.sizeZ - 2) continue;
    // Scan up from the bottom of the band for the first solid block.
    for (let y = Math.max(world.minY ?? 0, Math.floor(band.bottom)); y < world.sizeY; y++) {
      if (!isSolid(world.getBlock(x, y, z))) continue;
      const depth = EEL_LURK_DEPTH[0] + Math.random() * (EEL_LURK_DEPTH[1] - EEL_LURK_DEPTH[0]);
      return { x: x + 0.5, z: z + 0.5, y: Math.max(band.bottom + 4, y - depth) };
    }
  }
  return null;
}

export class VoidEel {
  // band: {top,bottom}; spawn: {x,y,z}. The spawn point biases initial roaming,
  // but does not leash the eel to an island.
  constructor(id, band, spawn) {
    this.id = id;
    this.type = ENTITY_TYPE.VOID_EEL;
    this.name = 'Void Eel';
    this.band = band;
    this.state = { ...spawn, yaw: Math.random() * Math.PI * 2, pitch: 0,
      box: EEL_BOX, kx: 0, kz: 0, vy: 0 };
    this.hp = EEL_HP;
    this.dead = false;
    this.connected = true;
    this.provocation = new Provocation();
    this.target = null;
    this.lastSeenTick = 0;
    this.nextAttackTick = 0;
    this.windupTicks = 0;
    this.lungeTicks = 0;
    this.lungeDirection = null;
    this.wanderGoal = null;
    this.wanderUntil = 0;
    this.stuckTicks = 0;
    this.trail = Array.from({ length: 16 }, (_, i) => ({
      x: spawn.x + Math.sin(this.state.yaw) * i * 0.55,
      y: spawn.y + EEL_BOX.height / 2,
      z: spawn.z + Math.cos(this.state.yaw) * i * 0.55,
    }));
    this.escapeTrail = [];
  }

  // Hooked on a fishing line (server/fishing.js): reeled up from `from` (the
  // bobber) to `to` beside the fisher, then it hunts `then.hunt` (a player)
  // or, for a monkey's catch (`then.patrol`), hovers around the landing spot
  // for a while. Either way it goes home down the line it came up.
  hooked(tick, from, to, then) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / 2));
    const line = Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / steps,
      y: from.y + (to.y - from.y) * i / steps, z: from.z + (to.z - from.z) * i / steps }));
    this.pull = { line, i: 1, then };
    // Its way home: the line, deepest point first (returnGoal walks it from the end).
    this.homeLine = line.slice();
  }

  // One tick of being reeled in. True while still on the line.
  stepPull(tick) {
    const p = this.pull, s = this.state;
    let move = FISHING.eel.pullSpeed * TICK_DT;
    while (move > 0 && p.i < p.line.length) {
      const goal = p.line[p.i], c = this.center();
      const dx = goal.x - c.x, dy = goal.y - c.y, dz = goal.z - c.z, d = Math.hypot(dx, dy, dz);
      if (d <= move) { s.x += dx; s.y += dy; s.z += dz; move -= d; p.i++; continue; }
      s.x += dx / d * move; s.y += dy / d * move; s.z += dz / d * move;
      s.yaw = Math.atan2(-dx, -dz); s.pitch = Math.atan2(dy, Math.max(0.01, Math.hypot(dx, dz)));
      move = 0;
    }
    this.rememberTrail();
    if (p.i < p.line.length) return true;
    this.pull = null;
    const to = p.line.at(-1);
    if (p.then.hunt) { this.provocation.provoke(p.then.hunt, tick); this.target = p.then.hunt; this.lastSeenTick = tick; }
    if (p.then.patrol) this.patrol = { x: to.x, y: to.y, z: to.z, until: tick + Math.round(FISHING.eel.patrolSeconds * TICK_RATE), goal: null, next: 0 };
    this.escapeTrail = this.homeLine ?? [];
    return false;
  }

  // A monkey's catch hovering where it landed; null once that time is up.
  patrolGoal(tick) {
    const p = this.patrol;
    if (!p) return null;
    if (tick >= p.until) { this.patrol = null; this.wanderGoal = null; return null; }
    const c = this.center(), r = FISHING.eel.patrolRadius;
    if (!p.goal || tick >= p.next || Math.hypot(c.x - p.goal.x, c.y - p.goal.y, c.z - p.goal.z) < 1.2) {
      p.goal = { x: p.x + (Math.random() - 0.5) * 2 * r, y: p.y + (Math.random() - 0.5) * 2, z: p.z + (Math.random() - 0.5) * 2 * r };
      p.next = tick + TICK_RATE * 3;
    }
    return p.goal;
  }

  center() {
    const s = this.state;
    return { x: s.x, y: s.y + EEL_BOX.height / 2, z: s.z };
  }

  bandTop(world, x = this.state.x, z = this.state.z) {
    const center = world.islands?.find((island) => island.kind === 'center');
    if (center && Math.hypot(x - center.x, z - center.z) <= center.radius) return this.band.top;
    const outer = world.islands?.filter((island) => island.kind !== 'center')
      .sort((a, b) => Math.max(0, Math.hypot(x - a.x, z - a.z) - a.radius)
        - Math.max(0, Math.hypot(x - b.x, z - b.z) - b.radius))[0];
    return outer ? Math.max(this.band.top, outer.bottomY - this.band.outerBelowIsland) : this.band.top;
  }

  // Open to the void below: in the player's own column, or (standing near an
  // island's edge) a column within EEL_EDGE_REACH of it, which an eel can rise
  // up beside.
  exposed(world, player) {
    const c = this.center(), p = player.state;
    if (!world.naturalTerrainBetween(p.x, p.z, c.y, p.y + 0.1)) return true;
    for (const [dx, dz] of EDGE_OFFSETS) {
      if (!world.naturalTerrainBetween(p.x + dx, p.z + dz, c.y, p.y - 0.5)) return true;
    }
    return false;
  }

  detectable(world, player, night) {
    if (!huntable(player) || !this.exposed(world, player)) return false;
    const c = this.center(), p = player.state;
    const height = EEL_DETECT_HEIGHT * (night ? EEL_NIGHT_DETECT_SCALE : 1);
    return p.y >= c.y && p.y - c.y <= height
      && Math.hypot(p.x - c.x, p.z - c.z) <= EEL_DETECT_RADIUS;
  }

  chooseTarget(world, players, tick, night) {
    const provoked = this.provocation.target;
    if (provoked && tick - this.provocation.lastSeenTick <= FORGET_TICKS
      && huntable(provoked) && this.exposed(world, provoked)) {
      this.target = provoked;
      this.lastSeenTick = this.provocation.lastSeenTick;
      return provoked;
    }
    if (this.target && huntable(this.target) && this.exposed(world, this.target)) {
      const p = this.target.state, c = this.center();
      if (this.detectable(world, this.target, night)) this.lastSeenTick = tick;
      if (Math.hypot(p.x - c.x, p.z - c.z) <= EEL_LOSE_RANGE
        && tick - this.lastSeenTick <= FORGET_TICKS) return this.target;
    }
    this.target = null;
    this.provocation.target = null;
    let nearest = null;
    for (const player of players) {
      if (!this.detectable(world, player, night)) continue;
      // Hovering where a monkey hooked it, it only goes for players near
      // that spot (one who hits it is still chased, as a provoker).
      if (this.patrol && Math.hypot(player.state.x - this.patrol.x, player.state.z - this.patrol.z) > FISHING.eel.patrolRadius + 6) continue;
      const p = player.state, c = this.center();
      const distance = Math.hypot(p.x - c.x, p.z - c.z);
      if (!nearest || distance < nearest.distance) nearest = { player, distance };
    }
    if (nearest) {
      this.target = nearest.player;
      this.lastSeenTick = tick;
    }
    return this.target;
  }

  // Wandering has no home patrol: every so often the eel picks a new spot
  // under some block (an island's underside or a bridge, at any height) in
  // the main play area and lurks a few blocks below it.
  wander(world, tick) {
    const s = this.state;
    if (this.wanderGoal && tick < this.wanderUntil
      && Math.hypot(s.x - this.wanderGoal.x, s.y - this.wanderGoal.y, s.z - this.wanderGoal.z) > 3) return this.wanderGoal;
    // Arrived: hold there a while, drifting a little, before choosing again.
    if (this.wanderGoal && tick < this.wanderUntil) {
      this.wanderGoal = { ...this.wanderGoal, x: this.wanderGoal.x + (Math.random() - 0.5) * 6,
        z: this.wanderGoal.z + (Math.random() - 0.5) * 6 };
      return this.wanderGoal;
    }
    this.wanderUntil = tick + TICK_RATE * (EEL_LURK_TIME[0] + Math.random() * (EEL_LURK_TIME[1] - EEL_LURK_TIME[0]));
    this.wanderGoal = underBlockSpot(world, this.band) ?? {
      x: s.x + (Math.random() - 0.5) * 20, z: s.z + (Math.random() - 0.5) * 20,
      y: this.band.bottom + 4 + Math.random() * Math.max(1, this.bandTop(world, s.x, s.z) - this.band.bottom - 8) };
    return this.wanderGoal;
  }

  // After a chase it retraces its way back down; otherwise it wanders.
  returnGoal(world, tick) {
    const s = this.state;
    while (this.escapeTrail.length && Math.hypot(s.x - this.escapeTrail.at(-1).x,
      s.y - this.escapeTrail.at(-1).y, s.z - this.escapeTrail.at(-1).z) < 1) this.escapeTrail.pop();
    if (this.escapeTrail.length) return this.escapeTrail.at(-1);
    return this.wander(world, tick);
  }

  clear(world, x, y, z) {
    if (x < 1 || z < 1 || x >= world.sizeX - 1 || z >= world.sizeZ - 1
      || y < world.voidY + 1 || y >= world.sizeY - EEL_BOX.height) return false;
    return playerFitsAt(world, {x,y,z,box:EEL_BOX}, y);
  }

  swim(world, goal, speed, night) {
    const s = this.state, c = this.center();
    const dx = goal.x - c.x, dy = goal.y - c.y, dz = goal.z - c.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.05) return;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 0.05) s.yaw = turnToward(s.yaw, Math.atan2(-dx, -dz));
    s.pitch = turnToward(s.pitch, Math.atan2(dy, Math.max(0.01, horizontal)));
    const step = Math.min(length, speed * (night && dy > 0 ? EEL_NIGHT_RISE_SCALE : 1) * TICK_DT);
    const vx = dx / length * step, vy = dy / length * step, vz = dz / length * step;
    // Straight on, level, dipping under, straight down, then sideways and
    // straight up: what hangs in its way is an island's underside, so a
    // one-block step down there must not stop it (going up or sliding along
    // the step would only keep it pressed against it).
    const down = -Math.max(Math.abs(vy), step * 0.7);
    for (const [ox, oy, oz] of [[vx, vy, vz], [vx, 0, vz], [vx, down, vz], [0, down, 0],
      [-vz, vy, vx], [vz, vy, -vx], [0, vy, 0]]) {
      if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) < 1e-6) continue;
      if (!this.clear(world, s.x + ox, s.y + oy, s.z + oz)) continue;
      s.x += ox; s.y += oy; s.z += oz;
      this.rememberTrail();
      this.stuckTicks = 0;
      return;
    }
    // Wedged: after a second, give up on this spot and pick another.
    if (++this.stuckTicks > TICK_RATE) { this.stuckTicks = 0; this.wanderGoal = null; this.wanderUntil = 0; }
  }

  rememberTrail() {
    const point = this.center();
    if (!this.trail.length || Math.hypot(point.x - this.trail[0].x,
      point.y - this.trail[0].y, point.z - this.trail[0].z) > 0.2) this.trail.unshift(point);
    let length = 0;
    for (let i = 1; i < this.trail.length; i++) {
      length += Math.hypot(this.trail[i].x - this.trail[i - 1].x,
        this.trail[i].y - this.trail[i - 1].y, this.trail[i].z - this.trail[i - 1].z);
      if (length > 8) { this.trail.length = i + 1; break; }
    }
  }

  tailTip() {
    return this.trail.at(-1) ?? { x: this.state.x + Math.sin(this.state.yaw) * 7.7,
      y: this.state.y + EEL_BOX.height / 2, z: this.state.z + Math.cos(this.state.yaw) * 7.7 };
  }

  extraHitBoxes() {
    const tail = this.tailTip();
    return [{ x: tail.x, y: tail.y - 0.2, z: tail.z, halfW: 0.25, height: 0.4,
      damageScale: 2 }];
  }

  inBiteReach(player) {
    const c = this.center(), t = player.state, box = playerBoxOf(t);
    const gapX = Math.max(0, Math.abs(t.x - c.x) - box.halfW);
    const gapZ = Math.max(0, Math.abs(t.z - c.z) - box.halfW);
    const gapY = Math.max(t.y - c.y, c.y - t.y - box.height, 0);
    return Math.hypot(gapX, gapY, gapZ) <= EEL_REACH;
  }

  step(world, players, tick, night = false) {
    this.night = night;
    if (this.pull && this.stepPull(tick)) return null;
    const target = this.chooseTarget(world, players, tick, night);
    if (!target) { this.windupTicks = 0; this.lungeTicks = 0; }
    if (target && this.lungeTicks > 0) {
      this.lungeTicks--;
      const c = this.center(), d = this.lungeDirection;
      this.swim(world, { x: c.x + d.x * 4, y: c.y + d.y * 4, z: c.z + d.z * 4 }, EEL_LUNGE_SPEED, night);
      if (this.inBiteReach(target)) {
        this.lungeTicks = 0;
        this.nextAttackTick = tick + COOLDOWN_TICKS;
        return target;
      }
      if (this.lungeTicks === 0) this.nextAttackTick = tick + COOLDOWN_TICKS;
      return null;
    }
    if (target && this.windupTicks > 0) {
      if (--this.windupTicks === 0) {
        const c = this.center(), p = target.state;
        const dx = p.x - c.x, dy = p.y + playerBoxOf(p).height / 2 - c.y, dz = p.z - c.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        this.lungeDirection = { x: dx / length, y: dy / length, z: dz / length };
        this.lungeTicks = LUNGE_TICKS;
      }
      return null;
    }
    const goal = target
      ? { x: target.state.x + (this.approachOffset?.x ?? 0),
        y: target.state.y + playerBoxOf(target.state).height / 2,
        z: target.state.z + (this.approachOffset?.z ?? 0) }
      : this.patrolGoal(tick) ?? this.returnGoal(world, tick);
    goal.x += this.separation?.x ?? 0;
    goal.y += this.separation?.y ?? 0;
    goal.z += this.separation?.z ?? 0;
    this.swim(world, goal, target ? EEL_CHASE_SPEED : EEL_SPEED, night);
    if (target && this.state.y > this.bandTop(world)) {
      const last = this.escapeTrail.at(-1);
      if (!last || Math.hypot(this.state.x - last.x, this.state.y - last.y,
        this.state.z - last.z) > 1) this.escapeTrail.push({ x: this.state.x, y: this.state.y, z: this.state.z });
      if (this.escapeTrail.length > 500) this.escapeTrail.shift();
    } else if (this.state.y <= this.bandTop(world) && !this.homeLine) this.escapeTrail.length = 0;
    // A hooked eel back down in its band is an ordinary eel again.
    if (this.homeLine && !this.patrol && !target && this.state.y <= this.bandTop(world) && !this.escapeTrail.length) this.homeLine = null;
    if (target && tick >= this.nextAttackTick
      && Math.hypot(target.state.x - this.state.x, target.state.y - this.state.y, target.state.z - this.state.z) < 5) {
      this.windupTicks = WINDUP_TICKS;
    }
    return null;
  }

  describe() { return this.snapshot(); }

  snapshot() {
    const { x, y, z, yaw, pitch } = this.state;
    const tail = this.tailTip();
    return { id: this.id, type: this.type, name: this.name, x, y, z, yaw, pitch,
      coiling: this.windupTicks > 0, lunging: this.lungeTicks > 0, night: !!this.night,
      tail: { x: tail.x, y: tail.y, z: tail.z } };
  }
}
