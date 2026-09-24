// Goblin navigation. Between modules, goblins follow the fortress graph
// (shared/goblinModules.js): a breadth-first search over connections gives
// the doorways and ladders to pass. Inside a module they walk a short A*
// path (pathfind.js) to the next point, or climb a shaft's ladder.
//
// A route is a list of actions:
//   { type: 'walk', x, y, z }                  walk to this spot
//   { type: 'climbUp', x, z, y, wall }         climb until the feet reach y
//   { type: 'climbDown', x, z, y, fromY, wall } climb down to y
// followRoute turns the next action into this tick's movement.

import { moduleAt, exitsOf, FACES } from '../shared/goblinModules.js';
import { findPath } from './pathfind.js';

const REACHED = 0.35;
const NODE_REACHED = 0.4;
// Largest sideways nudge per tick toward a ladder's column (blocks).
const LADDER_NUDGE = 0.12;

// Yaw that faces the direction (dx, dz); yaw 0 faces -Z.
export function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

// Modules to pass through from `from` to `to` (module objects): the exits
// taken, in order, or null if they aren't connected.
function searchModules(fortress, from, to) {
  if (from === to) return [];
  const previous = new Map([[from.id, null]]);
  const queue = [from];
  while (queue.length) {
    const module = queue.shift();
    for (const exit of exitsOf(fortress, module)) {
      if (previous.has(exit.other.id)) continue;
      previous.set(exit.other.id, { exit, from: module });
      if (exit.other === to) {
        const exits = [];
        for (let id = to.id; previous.get(id); id = previous.get(id).from.id) exits.unshift(previous.get(id).exit);
        return exits;
      }
      queue.push(exit.other);
    }
  }
  return null;
}

// A route from feet position `from` to `goal` ({ x, y, z }). Outside the
// fortress (or between unconnected parts) it's a single walk.
export function planRoute(fortress, from, goal) {
  const start = fortress && moduleAt(fortress, from.x, from.y + 0.1, from.z);
  const end = fortress && moduleAt(fortress, goal.x, goal.y + 0.1, goal.z);
  const exits = start && end ? searchModules(fortress, start, end) : null;
  const actions = [];
  for (const { points } of exits ?? []) {
    const [a, b] = points;
    if (a.kind === 'door') {
      actions.push({ type: 'walk', x: a.x, y: a.y, z: a.z }, { type: 'walk', x: b.x, y: b.y, z: b.z });
    } else if (a.kind === 'ladderBottom') {
      actions.push({ type: 'walk', x: a.x, y: a.y, z: a.z }, { type: 'climbUp', x: b.x, y: b.y, z: b.z, wall: b.wall });
    } else {
      actions.push({ type: 'walk', x: a.x, y: a.y, z: a.z },
        { type: 'climbDown', x: b.x, y: b.y, z: b.z, fromY: a.y, wall: b.wall });
    }
  }
  actions.push({ type: 'walk', x: goal.x, y: goal.y, z: goal.z });
  return { actions, index: 0, local: null, goal: { ...goal } };
}

// Keeps a climber over the ladder's column so it fits through the hole.
function nudgeTo(state, x, z) {
  const clamp = (v) => Math.max(-LADDER_NUDGE, Math.min(LADDER_NUDGE, v));
  state.x += clamp(x - state.x);
  state.z += clamp(z - state.z);
}

// This tick's movement along `route` for a goblin with physics `state`:
// { dx, dz } (direction to walk, unnormalized) or { yaw, forward } for
// climbing, or { arrived: true } at the end. May nudge the state onto a
// ladder's column.
export function followRoute(route, state, world) {
  while (route.index < route.actions.length) {
    const action = route.actions[route.index];
    if (action.type === 'walk') {
      const dx = action.x - state.x, dz = action.z - state.z;
      if (Math.hypot(dx, dz) < REACHED && Math.abs(action.y - state.y) < 1.5) {
        route.index++;
        route.local = null;
        continue;
      }
      if (!route.local) {
        const cell = { x: Math.floor(state.x), y: Math.floor(state.y + 0.01), z: Math.floor(state.z) };
        route.local = findPath(world, cell, { x: Math.floor(action.x), z: Math.floor(action.z) },
          { height: 2, maxNodes: 400 }).map((node) => ({ x: node.x + 0.5, z: node.z + 0.5 }));
      }
      while (route.local.length && Math.hypot(route.local[0].x - state.x, route.local[0].z - state.z) < NODE_REACHED) {
        route.local.shift();
      }
      // The last A* node is within a block of the spot; head straight there.
      const target = route.local.length > 1 ? route.local[0] : action;
      return { dx: target.x - state.x, dz: target.z - state.z };
    }
    const [wx, , wz] = FACES[action.wall].dir;
    nudgeTo(state, action.x, action.z);
    if (action.type === 'climbUp') {
      if (state.y >= action.y + 0.02) { route.index++; continue; }
      return { yaw: yawToward(wx, wz), forward: 1 };
    }
    if (state.y <= action.y + 0.05 || (state.onGround && state.y < action.fromY - 1)) { route.index++; continue; }
    return { yaw: yawToward(wx, wz), forward: -1 };
  }
  return { arrived: true };
}

// The walk is blocked: find a new local path next tick.
export function repath(route) {
  route.local = null;
}
