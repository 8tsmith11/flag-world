// Goblin navigation. Underground, goblins follow the fortress graph
// (shared/goblinModules.js): a breadth-first search over connections gives
// the doorways and ladders to pass. Entrances join the graph to the surface:
// a goblin climbs a shaft column out (after gathering with its group at the
// bottom) or climbs down into the shaft base. On the surface, and inside a
// module, it walks a short A* path (pathfind.js) to the next point.
//
// A route is a list of actions:
//   { type: 'walk', x, y, z }                  walk to this spot
//   { type: 'climbUp', x, z, y, wall }         climb until the feet reach y
//   { type: 'climbDown', x, z, y, fromY, wall } climb down to y
//   { type: 'climbTo', x, z, y, wall }         climb to y and hold on there
//   { type: 'gather', entrance, x, y, z }      wait there for the surfacing group
//   { type: 'dismount' }                       climb down whatever ladder it's on
// followRoute turns the next action into this tick's movement.

import { moduleAt, exitsOf, FACES } from '../shared/goblinModules.js';
import { findPath } from './pathfind.js';
import { isOnLadder } from '../shared/physics.js';

const REACHED = 0.35;
const NODE_REACHED = 0.4;
// Largest sideways nudge per tick toward a ladder's column (blocks).
const LADDER_NUDGE = 0.12;

// Yaw that faces the direction (dx, dz); yaw 0 faces -Z.
export function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

// Modules to pass through from `from` to `to` (module objects): the exits
// taken, in order, or null if they aren't connected. Connections still
// being dug only lead into (or out of) the site they belong to.
function searchModules(fortress, from, to) {
  if (from === to) return [];
  const previous = new Map([[from.id, null]]);
  const queue = [from];
  while (queue.length) {
    const module = queue.shift();
    for (const exit of exitsOf(fortress, module)) {
      if (previous.has(exit.other.id)) continue;
      if (exit.connection.pending && exit.other !== to && module !== from) continue;
      if (exit.other.building && exit.other !== to) continue;
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

function graphActions(fortress, start, end) {
  const exits = searchModules(fortress, start, end);
  if (!exits) return null;
  const actions = [];
  for (const { points } of exits) {
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
  return actions;
}

// Where a point is: { module }, { entrance, column } (on a shaft column
// above its base) or { surface: true }.
export function locate(controller, p) {
  const fortress = controller.fortress;
  const module = fortress && moduleAt(fortress, p.x, p.y + 0.1, p.z);
  if (module && !module.removed) return { module };
  for (const entrance of controller.shafts()) {
    for (const column of entrance.columns) {
      if (Math.abs(p.x - column.x - 0.5) < 0.9 && Math.abs(p.z - column.z - 0.5) < 0.9
        && p.y >= entrance.floorY - 0.5 && p.y < entrance.topY + 0.9) return { entrance, column };
    }
  }
  return { surface: true };
}

const columnFor = (entrance, goblin) => entrance.columns[goblin.id % entrance.columns.length];

// The open entrance nearest a point.
function nearestEntrance(controller, p) {
  let best = null;
  for (const e of controller.entrances) {
    if (!e.open) continue;
    const d = Math.hypot(e.top.x - p.x, e.top.z - p.z);
    if (!best || d < best.d) best = { e, d };
  }
  return best?.e ?? null;
}

function climbOut(entrance, column, goblin, controller, urgent) {
  const actions = [];
  const bottom = { x: column.x + 0.5, y: entrance.floorY, z: column.z + 0.5 };
  if (!urgent) {
    const spot = controller.gatherSpot(entrance, goblin);
    actions.push({ type: 'gather', entrance, ...spot });
  }
  actions.push({ type: 'walk', ...bottom },
    { type: 'climbUp', x: bottom.x, z: bottom.z, y: entrance.topY + 1, wall: entrance.wall, exit: true });
  const [fx, , fz] = FACES[FACES[entrance.wall].opposite].dir;
  actions.push({ type: 'walk', x: bottom.x + fx * 1.3, y: entrance.topY + 1, z: bottom.z + fz * 1.3 });
  return actions;
}

function climbIn(entrance, column) {
  const top = { x: column.x + 0.5, y: entrance.topY + 1, z: column.z + 0.5 };
  const [fx, , fz] = FACES[FACES[entrance.wall].opposite].dir;
  return [{ type: 'walk', x: top.x + fx * 1.3, y: top.y, z: top.z + fz * 1.3 }, { type: 'walk', ...top, into: true },
    { type: 'climbDown', x: top.x, z: top.z, y: entrance.floorY, fromY: top.y, wall: entrance.wall }];
}

// A route from feet position `from` to `goal` ({ x, y, z }) for `goblin`.
// `urgent` skips waiting for a surfacing group (chases, flight). `climb`
// ({ x, z, wall }) ends it holding on to that shaft column at goal.y.
export function planRoute(controller, goblin, from, goal, { urgent = false, climb = null } = {}) {
  const fortress = controller.fortress;
  const actions = [];
  let here = locate(controller, from);
  const target = climb ? null : locate(controller, goal);
  // A climb target: go to the column's bottom, then climb.
  if (climb) {
    const onIt = Math.abs(from.x - climb.x - 0.5) < 0.9 && Math.abs(from.z - climb.z - 0.5) < 0.9
      && from.y >= climb.floorY - 0.5;
    if (!onIt) {
      const bottom = { x: climb.x + 0.5, y: climb.floorY, z: climb.z + 0.5 };
      const inner = planRoute(controller, goblin, from, bottom, { urgent: true });
      actions.push(...inner.actions);
    }
    actions.push({ type: 'climbTo', x: climb.x + 0.5, z: climb.z + 0.5, y: goal.y, wall: climb.wall });
    return { actions, index: 0, local: null, goal: { ...goal } };
  }
  // Hanging on a ladder in a room: climb down to the floor first (walking
  // on a ladder climbs it).
  if (!here.entrance && isOnLadder(from, controller.world) && !from.onGround) {
    actions.push({ type: 'dismount' });
  }
  // Off a shaft column first: up if heading for the surface, else down.
  if (here.entrance) {
    const { entrance, column } = here;
    const x = column.x + 0.5, z = column.z + 0.5;
    if (target.surface && entrance.open) {
      actions.push({ type: 'climbUp', x, z, y: entrance.topY + 1, wall: entrance.wall, exit: true });
      const [fx, , fz] = FACES[FACES[entrance.wall].opposite].dir;
      actions.push({ type: 'walk', x: x + fx * 1.3, y: entrance.topY + 1, z: z + fz * 1.3 });
      here = { surface: true };
    } else {
      actions.push({ type: 'climbDown', x, z, y: entrance.floorY, fromY: from.y, wall: entrance.wall });
      here = { module: entrance.base };
    }
  }
  const end = target.entrance ? { module: target.entrance.base } : target;
  if (here.module && end.module) {
    actions.push(...(graphActions(fortress, here.module, end.module) ?? []));
  } else if (here.module && end.surface) {
    const entrance = nearestEntrance(controller, goal);
    const toBase = entrance && graphActions(fortress, here.module, entrance.base);
    if (toBase) actions.push(...toBase, ...climbOut(entrance, columnFor(entrance, goblin), goblin, controller, urgent));
  } else if (here.surface && end.module) {
    const entrance = nearestEntrance(controller, from);
    const fromBase = entrance && graphActions(fortress, entrance.base, end.module);
    if (fromBase) actions.push(...climbIn(entrance, columnFor(entrance, goblin)), ...fromBase);
  }
  actions.push({ type: 'walk', x: goal.x, y: goal.y, z: goal.z });
  return { actions, index: 0, local: null, goal: { ...goal }, surfaceWalk: !!(here.surface || end.surface) };
}

// Keeps a climber over the ladder's column so it fits through the hole.
function nudgeTo(state, x, z) {
  const clamp = (v) => Math.max(-LADDER_NUDGE, Math.min(LADDER_NUDGE, v));
  state.x += clamp(x - state.x);
  state.z += clamp(z - state.z);
}

// This tick's movement along `route` for `goblin`: { dx, dz } (direction to
// walk, unnormalized), { yaw, forward } for climbing, { hold: yaw } to
// hang on a ladder, { wait: true } to stand, or { arrived: true } at the
// end. May nudge the state onto a ladder's column.
export function followRoute(route, goblin, world) {
  const state = goblin.state;
  while (route.index < route.actions.length) {
    const action = route.actions[route.index];
    if (action.type === 'walk' || action.type === 'gather') {
      const dx = action.x - state.x, dz = action.z - state.z;
      // A gathering spot only needs to be near (others crowd around it).
      const near = action.into ? 0.25 : action.type === 'gather' ? 1.5 : REACHED;
      if (Math.hypot(dx, dz) < near && Math.abs(action.y - state.y) < 1.5) {
        if (action.type === 'gather') {
          if (!goblin.controller.gather(action.entrance, goblin)) return { wait: true };
        }
        route.index++;
        route.local = null;
        continue;
      }
      if (action.into) {
        // Stepping into a shaft's top: straight over the hole.
        return { dx, dz };
      }
      if (!route.local) {
        const cell = { x: Math.floor(state.x), y: Math.floor(state.y + 0.01), z: Math.floor(state.z) };
        route.local = findPath(world, cell, { x: Math.floor(action.x), z: Math.floor(action.z) },
          { height: 2, maxNodes: route.surfaceWalk ? 1500 : 500, maxDrop: route.surfaceWalk ? 12 : 3 }).map((node) => ({ x: node.x + 0.5, z: node.z + 0.5 }));
      }
      while (route.local.length && Math.hypot(route.local[0].x - state.x, route.local[0].z - state.z) < NODE_REACHED) {
        route.local.shift();
      }
      // Along the A* path; its last node is within a block of the spot when
      // the search got there, so head straight on from it then.
      const last = route.local.at(-1);
      const closeEnough = last && Math.hypot(last.x - action.x, last.z - action.z) < 1.5;
      const target = route.local.length > 1 || (route.local.length === 1 && !closeEnough) ? route.local[0] : action;
      return { dx: target.x - state.x, dz: target.z - state.z };
    }
    if (action.type === 'dismount') {
      if (state.onGround || !isOnLadder(state, world)) { route.index++; continue; }
      return { yaw: state.yaw, forward: -1 };
    }
    const [wx, , wz] = FACES[action.wall].dir;
    const faceWall = yawToward(wx, wz);
    if (action.type === 'climbUp') {
      if (state.y >= action.y + 0.02) { route.index++; continue; }
      nudgeTo(state, action.x, action.z);
      return { yaw: faceWall, forward: 1 };
    }
    if (action.type === 'climbTo') {
      nudgeTo(state, action.x, action.z);
      if (state.y < action.y - 0.1) return { yaw: faceWall, forward: 1 };
      if (state.y > action.y + 0.4 && !state.onGround) return { yaw: faceWall, forward: -1 };
      return { hold: faceWall };
    }
    if (state.y <= action.y + 0.05 || (state.onGround && state.y < action.fromY - 1)) { route.index++; continue; }
    // Not on the ladder yet (standing over the hole): get over the column
    // and drop onto it, rather than backing away (climbing down is walking
    // backward).
    if (!isOnLadder(state, world)) {
      const dx = action.x - state.x, dz = action.z - state.z;
      if (Math.hypot(dx, dz) > 0.3) return { dx, dz };
      nudgeTo(state, action.x, action.z);
      return { hold: faceWall };
    }
    nudgeTo(state, action.x, action.z);
    return { yaw: faceWall, forward: -1 };
  }
  return { arrived: true };
}

// The walk is blocked: find a new local path next tick.
export function repath(route) {
  route.local = null;
}
