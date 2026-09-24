// Player and item movement simulation. The server runs this authoritatively; the client
// runs the exact same code to predict its own player between server updates.
// It must stay deterministic: same state + input + world => same result.

import {
  TICK_DT, PLAYER_WIDTH, PLAYER_HEIGHT, WALK_SPEED, JUMP_VELOCITY, GRAVITY,
  TERMINAL_VELOCITY, SWIM_GRAVITY_SCALE, SWIM_UP_SPEED, SWIM_SPEED_SCALE, SWIM_EXIT_VELOCITY,
  ITEM_SIZE, ITEM_AIR_DRAG, ITEM_GROUND_FRICTION, KNOCKBACK_SPEED, KNOCKBACK_AIR_DECAY,
  KNOCKBACK_GROUND_DECAY, CARRY_SPEED_SCALE, CLIMB_SPEED, PLAYER_EYE_HEIGHT,
  CROUCH_SPEED_SCALE, CROUCH_HEIGHT, CROUCH_EYE_DROP, CROUCH_MAX_DROP, BOW_DRAW_SPEED_SCALE, EAT_SPEED_SCALE,
  GLIDE_SPEED, GLIDE_FALL_SPEED, SPRINT_SPEED_SCALE, WATER_CURRENT_SPEED,
  GRAPPLE_RANGE, GRAPPLE_SPEED, GRAPPLE_COOLDOWN,
  FLIGHT_SPEED,
} from './config.js';
import { BLOCK, isSolid, isClimbable, isLadder, isWater, waterLevel } from './blocks.js';
import { accessoryDef } from './accessories.js';
import { ITEM } from './itemIds.js';
import { FROST } from './tools.js';
import { lookDirection, raycastBlock } from './raycast.js';

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
const GRAPPLE_COOLDOWN_TICKS = Math.round(GRAPPLE_COOLDOWN / TICK_DT);

// kx/kz: knockback velocity, added on top of the input-driven velocity and decaying each tick.
// carrying: holding a flag, which slows walking. Set by the server.
// crouching: lower and slower, with edge protection; set by input, but only
// clears once there's room to stand.
// slowTicks: ticks of frost slow left (set by the server on an Ice Sword hit).
// grapple: while a grappling hook pulls, { hx, hy, hz } where the hook hit
// and { x, y, z } where the feet are heading; otherwise null.
// hookCooldown: ticks until the grappling hook can fire again.
// moveScale: walking speed multiplier from armor and accessory modifiers.
export function createPlayerState(x, y, z) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, yaw: 0, pitch: 0,
    onGround: false, carrying: false, crouching: false, gliding: false, flying: false, creative: false,
    accessory: null, springCharge: 0, springBouncing: false,
    slowTicks: 0, grapple: null, hookCooldown: 0, moveScale: 1,
  };
}

// The collision box: shorter while crouching. Mobs that reuse the player
// physics (cows) set their own `box` in their state.
export function playerBoxOf(state) {
  return state.box ?? (state.crouching ? CROUCH_BOX : PLAYER_BOX);
}

// Whether the player's box fits (hits no solid block) with its feet at height y.
export function playerFitsAt(world, state, y) {
  return !collidesAt(world, playerBoxOf(state), state.x, y, state.z);
}

// Eye height above the feet: lower while crouching.
export function eyeHeight(state) {
  return PLAYER_EYE_HEIGHT - (state.crouching ? CROUCH_EYE_DROP : 0);
}

// An empty input, for ticks where nothing is pressed.
export function createInput(seq = 0) {
  return { seq, forward: 0, strafe: 0, sprint: false, jump: false, yaw: 0, pitch: 0 };
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
  const { halfW } = playerBoxOf(state);
  for (let z = Math.floor(state.z - halfW); z <= Math.floor(state.z + halfW - EPS); z++) {
    for (let x = Math.floor(state.x - halfW); x <= Math.floor(state.x + halfW - EPS); x++) {
      for (let y = Math.floor(state.y); y <= Math.floor(state.y + 0.4); y++) {
        if (isWater(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

// Current follows decreasing water levels and open drops. Sampling only the
// few cells around the feet keeps this deterministic and cheap on both peers.
export function waterCurrent(state, world) {
  const x = Math.floor(state.x), y = Math.floor(state.y + 0.2), z = Math.floor(state.z);
  const level = waterLevel(world.getBlock(x, y, z));
  if (!level) return { x: 0, y: 0, z: 0 };
  let vx = 0, vz = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const neighbor = world.getBlock(x + dx, y, z + dz);
    if (isSolid(neighbor)) continue;
    const difference = level - waterLevel(neighbor);
    if (difference > 0) { vx += dx * difference; vz += dz * difference; }
  }
  const length = Math.hypot(vx, vz);
  const falling = !isSolid(world.getBlock(x, y - 1, z))
    && (isWater(world.getBlock(x, y - 1, z)) || world.getBlock(x, y - 1, z) === BLOCK.AIR);
  return { x: length ? vx / length : 0, y: falling ? -1 : 0, z: length ? vz / length : 0 };
}

// What the player's body is holding on to: 'ladder' if it overlaps a ladder,
// else 'rope' if it overlaps rope, else null.
function climbableAt(state, world) {
  const { halfW, height } = playerBoxOf(state);
  const x0 = Math.floor(state.x - halfW), x1 = Math.floor(state.x + halfW - EPS);
  const y0 = Math.floor(state.y), y1 = Math.floor(state.y + height - EPS);
  const z0 = Math.floor(state.z - halfW), z1 = Math.floor(state.z + halfW - EPS);
  let rope = false;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = world.getBlock(x, y, z);
        if (isLadder(id)) return 'ladder';
        if (isClimbable(id)) rope = true;
      }
    }
  }
  return rope ? 'rope' : null;
}

// Whether the player's body overlaps a ladder or rope block.
export function isOnLadder(state, world) {
  return climbableAt(state, world) !== null;
}

function feetInWater(state, world) {
  return isWater(world.getBlock(Math.floor(state.x), Math.floor(state.y), Math.floor(state.z)));
}

// Advances `state` in place by one fixed tick using `input`.
export function stepPlayer(state, input, world) {
  state.yaw = input.yaw;
  state.pitch = input.pitch;

  // Crouch while asked; standing back up needs room for the full height.
  if (input.crouch) state.crouching = true;
  else if (state.crouching && !collidesAt(world, PLAYER_BOX, state.x, state.y, state.z)) state.crouching = false;
  const box = playerBoxOf(state);

  if (input.flyToggle && state.creative && state.accessory === ITEM.FLIGHT_ORB) state.flying = !state.flying;
  if (!state.creative || state.accessory !== ITEM.FLIGHT_ORB) state.flying = false;

  // Grappling hook (input.hook is only kept by the server with one in hand).
  // A pull replaces all other movement until it ends.
  if (state.hookCooldown > 0) state.hookCooldown--;
  if (state.slowTicks > 0) state.slowTicks--;
  if (state.flying) {
    state.grapple = null;
    state.gliding = false;
    state.springCharge = 0;
    state.springBouncing = false;
    let fwd = Math.max(-1, Math.min(1, input.forward));
    let strafe = Math.max(-1, Math.min(1, input.strafe));
    const length = Math.hypot(fwd, strafe);
    if (length > 1) { fwd /= length; strafe /= length; }
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    state.vx = (-sin * fwd + cos * strafe) * FLIGHT_SPEED + state.kx;
    state.vz = (-cos * fwd - sin * strafe) * FLIGHT_SPEED + state.kz;
    state.vy = (Number(!!input.jump) - Number(!!input.crouch)) * FLIGHT_SPEED;
    moveBody(state, world, box);
    state.kx *= KNOCKBACK_AIR_DECAY;
    state.kz *= KNOCKBACK_AIR_DECAY;
    return;
  }
  if (input.hook) fireGrapple(state, world);
  if (state.grapple && state.carrying) state.grapple = null;
  if (state.grapple) {
    stepGrapple(state, world, box);
    return;
  }

  const inWater = isInWater(state, world);
  const current = inWater ? waterCurrent(state, world) : null;
  const climbing = climbableAt(state, world);
  const onLadder = climbing !== null;
  const accessory = accessoryDef(state.accessory);
  const spring = accessory?.visual === 'spring' ? accessory : null;
  if (!spring) { state.springCharge = 0; state.springBouncing = false; }
  if (inWater || onLadder) { state.springCharge = 0; state.springBouncing = false; }
  state.gliding = !!input.glide && !state.onGround && !inWater && !onLadder;

  // Horizontal movement is direct (no acceleration) for responsive controls.
  let fwd = Math.max(-1, Math.min(1, input.forward));
  // On a ladder S climbs down rather than walking you off it. Rope hangs
  // free, with no wall to lean into, so there W doesn't walk you off either
  // (strafe to step off, or climb past the top).
  const climb = input.forward > 0 || input.jump ? 1 : input.forward < 0 ? -1 : 0;
  if (onLadder && fwd < 0) fwd = 0;
  if (climbing === 'rope') fwd = 0;
  let strafe = Math.max(-1, Math.min(1, input.strafe));
  const len = Math.hypot(fwd, strafe);
  if (len > 1) { fwd /= len; strafe /= len; }
  const sprinting = !!input.sprint && fwd > 0 && !inWater && !onLadder && !state.crouching && !input.draw && !input.eat;
  const speed = WALK_SPEED * (sprinting ? SPRINT_SPEED_SCALE : 1) * (inWater ? SWIM_SPEED_SCALE : 1) * (state.carrying ? CARRY_SPEED_SCALE : 1)
    * (state.crouching ? CROUCH_SPEED_SCALE : 1)
    // Drawing a bow (input.draw is only sent, and only kept by the server, while holding one).
    * (input.draw ? BOW_DRAW_SPEED_SCALE : 1)
    * (input.eat ? EAT_SPEED_SCALE : 1)
    * (accessory?.moveMultiplier ?? 1)
    // Light armor and Fleet accessories (set by the server), or a mob's own speed.
    * (state.moveScale ?? 1)
    * (state.slowTicks > 0 ? 1 - FROST.slow : 1);
  const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
  // Yaw 0 looks down -Z (Three.js camera convention).
  // Knockback takes control away: none right after a hit, back to full as it fades.
  const control = 1 - Math.min(1, Math.hypot(state.kx, state.kz) / KNOCKBACK_SPEED);
  state.vx = (-sin * fwd + cos * strafe) * speed * control + state.kx;
  state.vz = (-cos * fwd - sin * strafe) * speed * control + state.kz;
  if (current) {
    state.vx += current.x * WATER_CURRENT_SPEED;
    state.vz += current.z * WATER_CURRENT_SPEED;
  }
  if (state.gliding) {
    state.vx = -sin * GLIDE_SPEED * Math.max(0.3, Math.cos(state.pitch)) + state.kx;
    state.vz = -cos * GLIDE_SPEED * Math.max(0.3, Math.cos(state.pitch)) + state.kz;
  }

  if (onLadder) {
    // No gravity on a ladder: climb, or hold still.
    state.vy = climb * CLIMB_SPEED;
  } else if (inWater) {
    state.vy -= GRAVITY * SWIM_GRAVITY_SCALE * TICK_DT;
    state.vy *= 0.8;
    state.vy += current.y * 1.2 * TICK_DT;
    if (input.jump) {
      const midWater = isWater(world.getBlock(Math.floor(state.x), Math.floor(state.y + 0.4), Math.floor(state.z)));
      state.vy = midWater ? SWIM_UP_SPEED : SWIM_EXIT_VELOCITY;
    }
  } else {
    if (spring && state.onGround) {
      if (input.jump) state.springCharge = Math.min(Math.round(spring.chargeSeconds / TICK_DT), state.springCharge + 1);
      else if (state.springCharge > 0) {
        const charge = state.springCharge / Math.round(spring.chargeSeconds / TICK_DT);
        state.vy = JUMP_VELOCITY + (Math.sqrt(2 * GRAVITY * spring.jumpHeight) - JUMP_VELOCITY) * charge;
        state.springCharge = 0;
        state.springBouncing = false;
      }
    } else if (input.jump && state.onGround) state.vy = JUMP_VELOCITY;
    // Head above water but feet still in it: at the surface, so bounce out.
    else if (input.jump && feetInWater(state, world)) state.vy = Math.max(state.vy, SWIM_EXIT_VELOCITY);
    state.vy -= GRAVITY * TICK_DT;
  }
  state.vy = Math.max(-TERMINAL_VELOCITY, state.vy);
  if (state.gliding) state.vy = Math.max(-GLIDE_FALL_SPEED, state.vy);

  // Edge protection: crouching on the ground (not jumping), don't walk off
  // anything that would drop you more than CROUCH_MAX_DROP. Mobs set
  // state.edgeGuard to always have it.
  const guard = (state.crouching || state.edgeGuard) && state.onGround && state.vy <= 0;
  moveBody(state, world, box, guard);

  // Knockback fades (slowly in the air, fast on the ground) and stops against a wall.
  const decay = state.onGround ? KNOCKBACK_GROUND_DECAY : KNOCKBACK_AIR_DECAY;
  state.kx = state.vx === 0 || Math.abs(state.kx) < KNOCKBACK_REST_SPEED ? 0 : state.kx * decay;
  state.kz = state.vz === 0 || Math.abs(state.kz) < KNOCKBACK_REST_SPEED ? 0 : state.kz * decay;
}

// Fires a grappling hook from the eyes along the look direction (starting its
// cooldown, hit or miss). If it hits a solid block within range, a pull
// begins: toward standing on a top face, or bringing the body's middle to a
// side or bottom face.
function fireGrapple(state, world) {
  if (state.grapple || state.hookCooldown > 0 || state.carrying) return;
  state.hookCooldown = GRAPPLE_COOLDOWN_TICKS;
  const eye = { x: state.x, y: state.y + eyeHeight(state), z: state.z };
  const dir = lookDirection(state.yaw, state.pitch);
  const hit = raycastBlock(world, eye, dir, GRAPPLE_RANGE, isSolid);
  if (!hit || hit.t === 0) return;
  const hx = eye.x + dir.x * hit.t, hy = eye.y + dir.y * hit.t, hz = eye.z + dir.z * hit.t;
  const y = hit.ny === 1 ? hy : hy - playerBoxOf(state).height / 2;
  state.grapple = { hx, hy, hz, x: hx, y, z: hz };
}

// One tick of a grapple pull: a straight line toward the target at
// GRAPPLE_SPEED with no gravity or knockback. It ends on arrival or when any
// axis of the move is blocked, leaving the player at rest (so they fall from
// there, and fall damage counts from the highest point as usual).
function stepGrapple(state, world, box) {
  const g = state.grapple;
  const dx = g.x - state.x, dy = g.y - state.y, dz = g.z - state.z;
  const dist = Math.hypot(dx, dy, dz);
  const step = GRAPPLE_SPEED * TICK_DT;
  const k = dist > step ? step / dist : 1;
  state.kx = state.kz = 0;
  state.gliding = false;
  state.springCharge = 0;
  state.springBouncing = false;
  const blockedX = moveAxis(state, world, box, 'x', dx * k);
  const blockedZ = moveAxis(state, world, box, 'z', dz * k);
  const blockedY = moveAxis(state, world, box, 'y', dy * k);
  const moving = k < 1 && !blockedX && !blockedZ && !blockedY;
  const speed = moving ? GRAPPLE_SPEED / dist : 0;
  state.vx = dx * speed;
  state.vy = dy * speed;
  state.vz = dz * speed;
  state.onGround = blockedY && dy < 0;
  if (!moving) state.grapple = null;
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
        if (isClimbable(world.getBlock(bx, by, bz))) return true;
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
  const impactSpeed = falling ? -state.vy : 0;
  const hitY = moveAxis(state, world, box, 'y', state.vy * TICK_DT);
  state.onGround = hitY && falling;
  if (hitY) {
    state.vy = 0;
    const spring = accessoryDef(state.accessory);
    if (state.onGround && spring?.visual === 'spring' && !state.crouching
      && (state.springBouncing || impactSpeed > Math.sqrt(2 * GRAVITY * 3))) {
      const rebound = impactSpeed * spring.bounceScale;
      const continues = rebound >= Math.sqrt(2 * GRAVITY * spring.minBounceHeight);
      if (!state.springBouncing || continues) {
        state.vy = rebound;
        state.onGround = false;
        state.springBouncing = continues;
      } else state.springBouncing = false;
    } else state.springBouncing = false;
  }
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
  const current = waterCurrent(state, world);
  if (isInWater(state, world)) {
    state.vy = Math.max(-2, Math.min(1, state.vy * 0.82 + (0.6 + current.y * 1.2) * TICK_DT));
    state.vx = state.vx * 0.84 + current.x * WATER_CURRENT_SPEED * 0.16;
    state.vz = state.vz * 0.84 + current.z * WATER_CURRENT_SPEED * 0.16;
  } else {
    state.vy = Math.max(-TERMINAL_VELOCITY, state.vy - GRAVITY * TICK_DT);
    const drag = state.onGround ? ITEM_GROUND_FRICTION : ITEM_AIR_DRAG;
    state.vx *= drag;
    state.vz *= drag;
  }
  if (Math.abs(state.vx) < ITEM_REST_SPEED) state.vx = 0;
  if (Math.abs(state.vz) < ITEM_REST_SPEED) state.vz = 0;
  moveBody(state, world, ITEM_BOX);
}
