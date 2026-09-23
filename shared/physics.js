// Player and item movement simulation. The server runs this authoritatively; the client
// runs the exact same code to predict its own player between server updates.
// It must stay deterministic: same state + input + world => same result.

import {
  TICK_DT, PLAYER_WIDTH, PLAYER_HEIGHT, WALK_SPEED, JUMP_VELOCITY, GRAVITY,
  TERMINAL_VELOCITY, SWIM_GRAVITY_SCALE, SWIM_UP_SPEED, SWIM_SPEED_SCALE, SWIM_EXIT_VELOCITY,
  ITEM_SIZE, ITEM_AIR_DRAG, ITEM_GROUND_FRICTION, KNOCKBACK_SPEED, KNOCKBACK_AIR_DECAY,
  KNOCKBACK_GROUND_DECAY, CARRY_SPEED_SCALE, CLIMB_SPEED, PLAYER_EYE_HEIGHT,
  CROUCH_SPEED_SCALE, CROUCH_HEIGHT, CROUCH_EYE_DROP, CROUCH_MAX_DROP,
} from './config.js';
import { BLOCK, isSolid, isLadder } from './blocks.js';

// Collision boxes: half width on X/Z and height above the feet position.
export const PLAYER_BOX = { halfW: PLAYER_WIDTH / 2, height: PLAYER_HEIGHT };
export const CROUCH_BOX = { halfW: PLAYER_WIDTH / 2, height: CROUCH_HEIGHT };
const ITEM_BOX = { halfW: ITEM_SIZE / 2, height: ITEM_SIZE };
// Item speeds below this (blocks/s) snap to zero so resting items stop moving.
const ITEM_REST_SPEED = 0.05;
// Knockback below this (blocks/s) stops.
const KNOCKBACK_REST_SPEED = 0.05;
const EPS = 1e-4;
// Largest per-axis step, so fast falls can't tunnel through a block.
const MAX_STEP = 0.4;

// kx/kz: knockback velocity, added on top of the input-driven velocity and decaying each tick.
// carrying: holding a flag, which slows walking. Set by the server.
// crouching: lower and slower, with edge protection; set by input, but only
// clears once there's room to stand.
export function createPlayerState(x, y, z) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, yaw: 0, pitch: 0, onGround: false, carrying: false, crouching: false,
  };
}

// The player's collision box: shorter while crouching.
export function playerBoxOf(state) {
  return state.crouching ? CROUCH_BOX : PLAYER_BOX;
}

// Eye height above the feet: lower while crouching.
export function eyeHeight(state) {
  return PLAYER_EYE_HEIGHT - (state.crouching ? CROUCH_EYE_DROP : 0);
}

// An empty input, for ticks where nothing is pressed.
export function createInput(seq = 0) {
  return { seq, forward: 0, strafe: 0, jump: false, yaw: 0, pitch: 0 };
}

function collides(world, minX, minY, minZ, maxX, maxY, maxZ) {
  const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY), y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function collidesAt(world, box, x, y, z) {
  return collides(world, x - box.halfW, y, z - box.halfW, x + box.halfW, y + box.height, z + box.halfW);
}

// Whether a player standing at (x, y, z) would overlap the block at (bx, by, bz).
// box: their collision box (playerBoxOf).
export function playerOverlapsBlock(x, y, z, bx, by, bz, box = PLAYER_BOX) {
  const { halfW, height } = box;
  return x + halfW > bx + EPS && x - halfW < bx + 1 - EPS
    && y + height > by + EPS && y < by + 1 - EPS
    && z + halfW > bz + EPS && z - halfW < bz + 1 - EPS;
}

// Moves along one axis; on hit, snaps flush against the block face. Returns true if blocked.
function moveAxis(state, world, box, axis, delta) {
  let blocked = false;
  let remaining = delta;
  while (remaining !== 0) {
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, remaining));
    remaining -= step;
    const prev = state[axis];
    state[axis] = prev + step;
    if (!collidesAt(world, box, state.x, state.y, state.z)) continue;

    // Snap to the nearest block boundary in the direction of travel.
    const extent = axis === 'y' ? (step > 0 ? box.height : 0) : (step > 0 ? box.halfW : -box.halfW);
    const edge = prev + extent + step;
    state[axis] = step > 0
      ? Math.floor(edge) - extent - EPS
      : Math.ceil(edge) - extent + EPS;
    if (collidesAt(world, box, state.x, state.y, state.z)) state[axis] = prev;
    blocked = true;
    break;
  }
  return blocked;
}

export function isInWater(state, world) {
  return world.getBlock(Math.floor(state.x), Math.floor(state.y + 0.4), Math.floor(state.z)) === BLOCK.WATER;
}

// Whether the player's body overlaps a ladder block.
export function isOnLadder(state, world) {
  const { halfW, height } = playerBoxOf(state);
  const x0 = Math.floor(state.x - halfW), x1 = Math.floor(state.x + halfW - EPS);
  const y0 = Math.floor(state.y), y1 = Math.floor(state.y + height - EPS);
  const z0 = Math.floor(state.z - halfW), z1 = Math.floor(state.z + halfW - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isLadder(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function feetInWater(state, world) {
  return world.getBlock(Math.floor(state.x), Math.floor(state.y), Math.floor(state.z)) === BLOCK.WATER;
}

// Advances `state` in place by one fixed tick using `input`.
export function stepPlayer(state, input, world) {
  state.yaw = input.yaw;
  state.pitch = input.pitch;

  // Crouch while asked; standing back up needs room for the full height.
  if (input.crouch) state.crouching = true;
  else if (state.crouching && !collidesAt(world, PLAYER_BOX, state.x, state.y, state.z)) state.crouching = false;
  const box = playerBoxOf(state);

  const inWater = isInWater(state, world);
  const onLadder = isOnLadder(state, world);

  // Horizontal movement is direct (no acceleration) for responsive controls.
  let fwd = Math.max(-1, Math.min(1, input.forward));
  // On a ladder S climbs down rather than walking you off it.
  const climb = input.forward > 0 || input.jump ? 1 : input.forward < 0 ? -1 : 0;
  if (onLadder && fwd < 0) fwd = 0;
  let strafe = Math.max(-1, Math.min(1, input.strafe));
  const len = Math.hypot(fwd, strafe);
  if (len > 1) { fwd /= len; strafe /= len; }
  const speed = WALK_SPEED * (inWater ? SWIM_SPEED_SCALE : 1) * (state.carrying ? CARRY_SPEED_SCALE : 1)
    * (state.crouching ? CROUCH_SPEED_SCALE : 1);
  const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
  // Yaw 0 looks down -Z (Three.js camera convention).
  // Knockback takes control away: none right after a hit, back to full as it fades.
  const control = 1 - Math.min(1, Math.hypot(state.kx, state.kz) / KNOCKBACK_SPEED);
  state.vx = (-sin * fwd + cos * strafe) * speed * control + state.kx;
  state.vz = (-cos * fwd - sin * strafe) * speed * control + state.kz;

  if (onLadder) {
    // No gravity on a ladder: climb, or hold still.
    state.vy = climb * CLIMB_SPEED;
  } else if (inWater) {
    state.vy -= GRAVITY * SWIM_GRAVITY_SCALE * TICK_DT;
    state.vy *= 0.8;
    if (input.jump) state.vy = SWIM_UP_SPEED;
  } else {
    if (input.jump && state.onGround) state.vy = JUMP_VELOCITY;
    // Head above water but feet still in it: at the surface, so bounce out.
    else if (input.jump && feetInWater(state, world)) state.vy = Math.max(state.vy, SWIM_EXIT_VELOCITY);
    state.vy -= GRAVITY * TICK_DT;
  }
  state.vy = Math.max(-TERMINAL_VELOCITY, state.vy);

  // Edge protection: crouching on the ground (not jumping), don't walk off
  // anything that would drop you more than CROUCH_MAX_DROP.
  const guard = state.crouching && state.onGround && state.vy <= 0;
  moveBody(state, world, box, guard);

  // Knockback fades (slowly in the air, fast on the ground) and stops against a wall.
  const decay = state.onGround ? KNOCKBACK_GROUND_DECAY : KNOCKBACK_AIR_DECAY;
  state.kx = state.vx === 0 || Math.abs(state.kx) < KNOCKBACK_REST_SPEED ? 0 : state.kx * decay;
  state.kz = state.vz === 0 || Math.abs(state.kz) < KNOCKBACK_REST_SPEED ? 0 : state.kz * decay;
}

// Ground within CROUCH_MAX_DROP below a box at (x, y, z), or a ladder to hold
// (in the body, or below within that drop).
function hasFooting(world, box, x, y, z) {
  const minY = y - CROUCH_MAX_DROP - 0.01;
  if (collides(world, x - box.halfW, minY, z - box.halfW, x + box.halfW, y, z + box.halfW)) return true;
  const x0 = Math.floor(x - box.halfW), x1 = Math.floor(x + box.halfW - EPS);
  const z0 = Math.floor(z - box.halfW), z1 = Math.floor(z + box.halfW - EPS);
  for (let by = Math.floor(minY); by <= Math.floor(y + box.height - EPS); by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (isLadder(world.getBlock(bx, by, bz))) return true;
      }
    }
  }
  return false;
}

// The part of a step along one axis that keeps footing: all of it, or the
// most of it (found by halving) that stops at the edge.
function guardedStep(state, world, box, axis, delta) {
  if (delta === 0) return 0;
  const fits = (d) => hasFooting(world, box, axis === 'x' ? state.x + d : state.x, state.y, axis === 'z' ? state.z + d : state.z);
  if (fits(delta)) return delta;
  let ok = 0, bad = delta;
  for (let i = 0; i < 8; i++) {
    const mid = (ok + bad) / 2;
    if (fits(mid)) ok = mid; else bad = mid;
  }
  return ok;
}

// guard: edge protection, checked for X and Z separately so the player can
// still slide along an edge.
function moveBody(state, world, box, guard = false) {
  const dx = guard ? guardedStep(state, world, box, 'x', state.vx * TICK_DT) : state.vx * TICK_DT;
  if (moveAxis(state, world, box, 'x', dx)) state.vx = 0;
  const dz = guard ? guardedStep(state, world, box, 'z', state.vz * TICK_DT) : state.vz * TICK_DT;
  if (moveAxis(state, world, box, 'z', dz)) state.vz = 0;
  const falling = state.vy < 0;
  const hitY = moveAxis(state, world, box, 'y', state.vy * TICK_DT);
  state.onGround = hitY && falling;
  if (hitY) state.vy = 0;
}

export function createItemState(x, y, z, vx = 0, vy = 0, vz = 0) {
  return { x, y, z, vx, vy, vz, onGround: false };
}

// Advances a dropped item by one tick: gravity, drag and block collision.
export function stepItem(state, world) {
  // A block placed on top of an item pushes it up out of the way.
  if (collidesAt(world, ITEM_BOX, state.x, state.y, state.z)) {
    state.y = Math.floor(state.y) + 1;
    state.vy = 0;
  }
  state.vy = Math.max(-TERMINAL_VELOCITY, state.vy - GRAVITY * TICK_DT);
  const drag = state.onGround ? ITEM_GROUND_FRICTION : ITEM_AIR_DRAG;
  state.vx *= drag;
  state.vz *= drag;
  if (Math.abs(state.vx) < ITEM_REST_SPEED) state.vx = 0;
  if (Math.abs(state.vz) < ITEM_REST_SPEED) state.vz = 0;
  moveBody(state, world, ITEM_BOX);
}
