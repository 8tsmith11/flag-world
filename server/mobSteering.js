import { MOB_SEPARATION, MOB_NAVIGATION as NAV, TICK_DT } from '../shared/config.js';
import { playerFitsAt, playerBoxOf, mobHasFooting } from '../shared/physics.js';
import { isSolid } from '../shared/blocks.js';

const key = (x, z) => `${x},${z}`;
const radius = (mob) => mob.state.box?.halfW ?? 0.5;
const swimmer = (mob) => mob.type === 'dragon' || mob.type === 'voidEel';
const safe = (world, mob, state) => playerFitsAt(world, state, state.y)
  && (!mob.state.edgeGuard || mobHasFooting(world, state))
  && (!mob.state.onGround || isSolid(world.getBlock(Math.floor(state.x),
    Math.floor(state.y - 0.08), Math.floor(state.z))));

export function assignMobSteering(mobs) {
  const grid = new Map();
  for (const mob of mobs) {
    mob.separation = { x: 0, y: 0, z: 0 };
    mob.approachOffset = { x: 0, z: 0 };
    const s = mob.state, gx = Math.floor(s.x / MOB_SEPARATION.gridSize),
      gz = Math.floor(s.z / MOB_SEPARATION.gridSize);
    const cell = key(gx, gz);
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(mob);
  }
  const groups = new Map();
  for (const mob of mobs) {
    if (mob.target && !mob.target.dead) {
      if (!groups.has(mob.target.id)) groups.set(mob.target.id, []);
      groups.get(mob.target.id).push(mob);
    }
    const s = mob.state, gx = Math.floor(s.x / MOB_SEPARATION.gridSize),
      gz = Math.floor(s.z / MOB_SEPARATION.gridSize);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of grid.get(key(gx + dx, gz + dz)) ?? []) {
        if (other.id === mob.id) continue;
        const o = other.state;
        const vx = s.x - o.x, vy = s.y - o.y, vz = s.z - o.z;
        const threeD = swimmer(mob) || swimmer(other);
        if (!threeD && Math.abs(vy) > Math.max(s.box?.height ?? 1, o.box?.height ?? 1)) continue;
        const distance = Math.hypot(vx, threeD ? vy : 0, vz);
        const range = (radius(mob) + radius(other)) * MOB_SEPARATION.rangeScale;
        if (distance >= range) continue;
        const angle = (Math.min(mob.id, other.id) * 2.399963229728653) % (Math.PI * 2);
        const direction = mob.id < other.id ? -1 : 1;
        const scale = MOB_SEPARATION.strength * (1 - distance / range);
        mob.separation.x += (distance ? vx / distance : Math.cos(angle) * direction) * scale;
        mob.separation.y += threeD && distance ? vy / distance * scale : 0;
        mob.separation.z += (distance ? vz / distance : Math.sin(angle) * direction) * scale;
      }
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.id - b.id);
    group.forEach((mob, index) => {
      const angle = index * Math.PI * 2 / group.length + mob.target.id;
      // Ground melee mobs must stop within contact distance, rather than
      // forming an unreachable attack ring several blocks from the target.
      const approachRadius = group.length === 1 ? 0 : swimmer(mob) ? MOB_SEPARATION.approachRadius
        : Math.min(MOB_SEPARATION.approachRadius, radius(mob) + playerBoxOf(mob.target.state).halfW);
      mob.approachOffset = { x: Math.cos(angle) * approachRadius,
        z: Math.sin(angle) * approachRadius };
    });
  }
  return grid;
}

export function steerGround(mob, world) {
  const s = mob.state, v = mob.separation;
  if (!v || Math.hypot(v.x, v.z) < 0.01) return;
  const magnitude = Math.hypot(v.x, v.z), scale = Math.min(TICK_DT, NAV.pushPerTick / magnitude);
  const x = s.x + v.x * scale, z = s.z + v.z * scale;
  if (safe(world, mob, { ...s, x, z })) { s.x = x; s.z = z; }
}

// Final physical nudge for the rare case in which two steering steps still
// leave bodies fully overlapping. Check the same nearby grid, not every mob.
export function resolveMobOverlaps(world, mobs) {
  const changed = new Set();
  // Use post-movement positions and rebuild between bounded passes. A stale
  // pre-movement grid missed pairs that had just walked into each other.
  for (let pass = 0; pass < NAV.collisionPasses; pass++) {
    const grid = new Map();
    for (const mob of mobs) {
      if (mob.dead || mob.climbing) continue;
      const s = mob.state, k = key(Math.floor(s.x / MOB_SEPARATION.gridSize), Math.floor(s.z / MOB_SEPARATION.gridSize));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(mob);
    }
    for (const mob of mobs) {
      if (mob.dead || mob.climbing) continue;
      const s = mob.state, gx = Math.floor(s.x / MOB_SEPARATION.gridSize), gz = Math.floor(s.z / MOB_SEPARATION.gridSize);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const other of grid.get(key(gx + dx, gz + dz)) ?? []) {
        if (other.id <= mob.id) continue;
        const o = other.state, overlapX = radius(mob) + radius(other) - Math.abs(s.x - o.x),
          overlapZ = radius(mob) + radius(other) - Math.abs(s.z - o.z),
          overlapY = Math.min(s.y + (s.box?.height ?? 1), o.y + (o.box?.height ?? 1)) - Math.max(s.y, o.y);
        if (overlapX <= 0 || overlapZ <= 0 || overlapY <= 0) continue;
        const axis = swimmer(mob) && swimmer(other) && overlapY < Math.min(overlapX, overlapZ) ? 'y'
          : overlapX <= overlapZ ? 'x' : 'z';
        const sign = Math.sign(s[axis] - o[axis]) || (mob.id % 2 ? 1 : -1);
        const overlap = axis === 'y' ? overlapY : axis === 'x' ? overlapX : overlapZ;
        const amount = Math.min(NAV.pushPerTick, (overlap + MOB_SEPARATION.minGap) / 2);
        const move = (body, direction, distance) => {
          const proposed = { ...body.state, [axis]: body.state[axis] + direction * distance };
          if (!safe(world, body, proposed)) return false;
          body.state[axis] = proposed[axis]; changed.add(body); return true;
        };
        const a = move(mob, sign, amount), b = move(other, -sign, amount);
        if (!a && b) move(other, -sign, amount);
        if (!b && a) move(mob, sign, amount);
      }
    }
  }
  return changed;
}
