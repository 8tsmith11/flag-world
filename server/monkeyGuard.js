// Guard and lookout monkeys (roles in shared/monkeys.js, tuning in
// MONKEY_DUTY in shared/config.js). Both use the shared hostility rules
// (server/hostility.js), so they never turn on their own team, its monkeys
// or anything friendly.
//
// Guard: walks its patrol points in order, looping back to the first (or
// stands on its only point). Every tick while fighting it aims, swings or
// chases; it looks for a new target every MONKEY_DUTY.guard.retargetTicks.
// A target must be within its detection range, in sight, and no farther
// than `pursuit` from the patrol route; the guard gives up when the target
// leaves that band, dies, or stays out of sight for a few seconds, then
// walks back to its route. With a bow or crossbow in its tool slot it shoots
// (draw time, cooldown, range and a clear arc, like a turret); otherwise it
// fights in melee with whatever weapon it holds (bare hands without one).
//
// Lookout: stands on its post and reports enemy players and goblins it can
// see to its whole team, at most once per target every cooldownSeconds.
import { MONKEY_WORK as C, MONKEY_DUTY as D, TICK_RATE, BOW_COOLDOWN, CROSSBOW_ARROW_DAMAGE } from '../shared/config.js';
import { getItemDef, ITEM } from '../shared/items.js';
import { attackStats, rangedStats, FROST } from '../shared/tools.js';
import { routeDistance } from '../shared/monkeys.js';
import { ballisticAim, ballisticClear } from '../shared/ballistics.js';
import { playerBoxOf } from '../shared/physics.js';
import { S2C } from '../shared/protocol.js';
import { findPath } from './pathfind.js';
import { canSee } from './provocation.js';
import { hostileKind, hostileCandidates } from './hostility.js';
import { Arrow } from './arrow.js';

const G = D.guard, L = D.lookout;
const LOSE_SIGHT_TICKS = 3 * TICK_RATE;
const eye = (m) => ({ x: m.state.x, y: m.state.y + C.box.height * 0.85, z: m.state.z });
const body = (t) => ({ x: t.state.x, y: t.state.y + playerBoxOf(t.state).height * 0.6, z: t.state.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const key = (p) => `${p.x},${p.y},${p.z}`;

function face(m, p) {
  m.state.yaw = Math.atan2(-(p.x - m.state.x), -(p.z - m.state.z));
}

// A target the guard may fight: hostile, near enough to its route, and (for
// a new one) within detection range and in sight.
function eligible(workers, m, t, fresh) {
  if (!t || t === m || !hostileKind(m.team, t)) return false;
  if (routeDistance(m.config.waypoints, t.state) > G.pursuit) return false;
  if (!fresh) return true;
  return distance(t.state, m.state) <= G.range && canSee(workers.game.world, eye(m), t);
}

function findThreat(workers, m) {
  // Whoever just hit it comes first.
  if (m.provoker && eligible(workers, m, m.provoker, false) && distance(m.provoker.state, m.state) <= G.range * 1.5) {
    const t = m.provoker; m.provoker = null; return t;
  }
  let best = null, bestDistance = Infinity;
  for (const t of hostileCandidates(workers.game)) {
    const d = distance(t.state, m.state);
    if (d >= bestDistance || d > G.range) continue;
    if (eligible(workers, m, t, true)) { best = t; bestDistance = d; }
  }
  return best;
}

function chase(workers, m, t, tick) {
  if (m.pathKey === 'chase' && m.path.length && tick < (m.chaseAt ?? 0)) return;
  if (workers.pathBudget <= 0) return;
  workers.pathBudget--; workers.pathSearches++;
  const goal = { x: Math.floor(t.state.x), y: Math.round(t.state.y), z: Math.floor(t.state.z) };
  const path = findPath(workers.game.world, workers.cellOf(m), goal, { height: Math.ceil(C.box.height),
    halfWidth: C.box.halfW, maxNodes: 900, climb: C.climbHeight, maxDrop: 3 });
  m.path = path.map((n) => ({ ...n, grounded: !n.climb }));
  m.pathKey = 'chase'; m.arrived = false; m.routeBounds = null; m.chaseAt = tick + G.retargetTicks;
}

function shoot(workers, m, t, weapon) {
  const game = workers.game, from = eye(m), def = getItemDef(weapon.item);
  const ranged = rangedStats(weapon), speed = G.arrowSpeed * ranged.speedScale;
  const path = ballisticAim(from, body(t), speed);
  if (!path || !ballisticClear(game.world, path)) return false;
  const arrow = new Arrow(game.nextId++, m, from.x, from.y, from.z,
    Math.cos(path.yaw) * Math.cos(path.pitch) * speed, Math.sin(path.pitch) * speed,
    Math.sin(path.yaw) * Math.cos(path.pitch) * speed, 1);
  arrow.damage = (def.tool === 'crossbow' ? CROSSBOW_ARROW_DAMAGE : G.arrowDamage) + ranged.damageBonus;
  game.arrows.set(arrow.id, arrow);
  game.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
  return true;
}

// One tick of a guard's fighting. Returns true while it is fighting (its
// path is then a chase, or empty while it shoots or swings).
export function guardTick(workers, m, tick) {
  const route = m.config.waypoints;
  if (!route.length) { m.target = null; return false; }
  const world = workers.game.world;
  let t = m.target;
  // Too far from its route itself: give up and go back.
  if (t && routeDistance(route, m.state) > G.pursuit) t = null;
  if (t && !eligible(workers, m, t, false)) t = null;
  if (t) {
    if (canSee(world, eye(m), t)) m.lastSeen = tick;
    else if (tick - (m.lastSeen ?? tick) > LOSE_SIGHT_TICKS) t = null;
  }
  if (!t && (m.provoker || tick % G.retargetTicks === m.id % G.retargetTicks)) {
    t = findThreat(workers, m);
    if (t) m.lastSeen = tick;
  }
  if (t !== m.target) { m.drawTicks = 0; if (!t && m.pathKey === 'chase') { m.path = []; m.pathKey = null; } }
  m.target = t;
  if (!t) { m.drawTicks = 0; return false; }

  const weapon = m.gear[0], def = getItemDef(weapon?.item);
  const ranged = def.tool === 'bow' || def.tool === 'crossbow';
  const d = distance(body(t), eye(m)), sees = canSee(world, eye(m), t);
  m.status = `Fighting ${t.name ?? 'an enemy'}`;
  if (ranged && d <= G.bowRange && sees) {
    m.path = []; m.pathKey = null; face(m, t.state);
    const stats = rangedStats(weapon);
    const draw = def.tool === 'crossbow' ? stats.loadTicks : Math.round(G.bowDrawSeconds * TICK_RATE);
    if (tick >= m.nextAttack) m.drawTicks++;
    if (m.drawTicks >= draw) {
      m.drawTicks = 0;
      if (shoot(workers, m, t, weapon)) m.nextAttack = tick + Math.round(BOW_COOLDOWN * TICK_RATE);
      // No clear arc from here: move in closer.
      else chase(workers, m, t, tick);
    }
    return true;
  }
  m.drawTicks = 0;
  const flat = Math.hypot(t.state.x - m.state.x, t.state.z - m.state.z);
  if (!ranged && flat <= G.meleeReach && Math.abs(t.state.y - m.state.y) < 2 && sees) {
    m.path = []; m.pathKey = null; face(m, t.state);
    if (tick >= m.nextAttack) {
      const stats = attackStats(weapon);
      m.nextAttack = tick + Math.round(stats.cooldown * TICK_RATE);
      m.swingUntil = tick + 6;
      if (stats.frost) t.state.slowTicks = Math.round(FROST.seconds * TICK_RATE);
      workers.game.meleeHit(t, stats.damage, m, stats.knockback ?? 1);
    }
    return true;
  }
  chase(workers, m, t, tick);
  return true;
}

// Think tick of a guard that isn't fighting: on to the next patrol point,
// pausing briefly at each.
export function guardPatrol(workers, m, tick) {
  const route = m.config.waypoints;
  if (!route.length) { m.status = 'Select patrol points'; workers.idle(m); return; }
  if (m.pathKey === 'chase') { m.path = []; m.pathKey = null; }
  const index = m.patrolIndex % route.length, p = route[index];
  const goal = `home:${key(p)}`;
  const arrived = (m.pathKey === goal && m.arrived && !m.path.length)
    || (Math.hypot(m.state.x - p.x - 0.5, m.state.z - p.z - 0.5) <= G.arriveDistance && Math.abs(m.state.y - p.y - 1) < 2.5);
  if (arrived) {
    if (route.length === 1) { m.status = 'Guarding its post'; return; }
    m.pauseUntil ||= tick + Math.round(G.patrolPause * TICK_RATE);
    m.status = `Patrolling (point ${index + 1} of ${route.length})`;
    if (tick >= m.pauseUntil) { m.patrolIndex = (index + 1) % route.length; m.pauseUntil = 0; m.pathKey = null; }
    return;
  }
  const result = workers.approachStand(m, p);
  if (result === 'failed') {
    m.status = `Can't reach patrol point ${index + 1}`;
    if (route.length > 1) m.patrolIndex = (index + 1) % route.length;
  } else m.status = `Patrolling to point ${index + 1} of ${route.length}`;
}

// Think tick of a lookout: get to the post, then watch and report.
export function lookoutWatch(workers, m, tick) {
  const post = m.config.post;
  if (!post) { m.status = 'Select a lookout post'; workers.idle(m); return; }
  const there = Math.hypot(m.state.x - post.x - 0.5, m.state.z - post.z - 0.5) <= 1.5 && Math.abs(m.state.y - post.y - 1) < 2.5
    || (m.pathKey === `home:${key(post)}` && m.arrived && !m.path.length);
  if (!there && workers.approachStand(m, post) === 'failed') m.status = 'Can\'t reach its post';
  const spyglass = m.gear[0]?.item === ITEM.SPYGLASS;
  const range = spyglass ? L.spyglassRange : L.range, from = eye(m), game = workers.game;
  const cooldown = L.cooldownSeconds * TICK_RATE;
  const seen = [];
  for (const t of hostileCandidates(game)) {
    const kind = hostileKind(m.team, t);
    if (kind !== 'player' && kind !== 'goblin') continue;
    const d = distance(t.state, m.state);
    if (d > range || !canSee(game.world, from, t)) continue;
    seen.push({ t, kind, d });
  }
  seen.sort((a, b) => a.d - b.d);
  if (seen.length) face(m, seen[0].t.state);
  let reported = 0;
  for (const { t, kind } of seen) {
    if (tick - (m.reports.get(t.id) ?? -Infinity) < cooldown) continue;
    m.reports.set(t.id, tick);
    if (reported++ >= 2) continue;
    const text = !spyglass ? `${m.name} spotted an enemy!`
      : kind === 'player' ? `${m.name} spotted ${t.name}!` : `${m.name} spotted a goblin!`;
    game.teamNotice?.(m.team, text, 'lookout');
    game.teamProgress?.event(m.team, 'lookoutSpotted');
  }
  for (const [id, at] of m.reports) if (tick - at > cooldown * 2) m.reports.delete(id);
  m.status = !there ? m.status === 'Can\'t reach its post' ? m.status : 'Going to its post'
    : seen.length ? `Watching ${seen.length} enem${seen.length === 1 ? 'y' : 'ies'}` : `Keeping watch (${range} blocks)`;
}
