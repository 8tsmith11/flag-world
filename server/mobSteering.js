import { MOB_SEPARATION, TICK_DT } from '../shared/config.js';
import { playerFitsAt } from '../shared/physics.js';
import { isSolid } from '../shared/blocks.js';

const key = (x, z) => `${x},${z}`;
const radius = (mob) => mob.state.box?.halfW ?? 0.5;
const swimmer = (mob) => mob.type === 'dragon' || mob.type === 'voidEel';
const safe = (world, mob, state) => playerFitsAt(world, state, state.y)
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
        const angle = (mob.id * 2.399963229728653) % (Math.PI * 2);
        const scale = MOB_SEPARATION.strength * (1 - distance / range) / Math.max(distance, 0.01);
        mob.separation.x += (distance ? vx : Math.cos(angle)) * scale;
        mob.separation.y += threeD ? vy * scale : 0;
        mob.separation.z += (distance ? vz : Math.sin(angle)) * scale;
      }
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.id - b.id);
    group.forEach((mob, index) => {
      const angle = index * Math.PI * 2 / group.length + mob.target.id;
      mob.approachOffset = { x: Math.cos(angle) * MOB_SEPARATION.approachRadius,
        z: Math.sin(angle) * MOB_SEPARATION.approachRadius };
    });
  }
  return grid;
}

export function steerGround(mob, world) {
  const s = mob.state, v = mob.separation;
  if (!v || Math.hypot(v.x, v.z) < 0.01) return;
  const x = s.x + v.x * TICK_DT, z = s.z + v.z * TICK_DT;
  if (safe(world, mob, { ...s, x, z })) { s.x = x; s.z = z; }
}

// Final physical nudge for the rare case in which two steering steps still
// leave bodies fully overlapping. Check the same nearby grid, not every mob.
export function resolveMobOverlaps(world, mobs, grid) {
  const changed = new Set();
  for (const mob of mobs) {
    const s = mob.state, gx = Math.floor(s.x / MOB_SEPARATION.gridSize),
      gz = Math.floor(s.z / MOB_SEPARATION.gridSize);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of grid.get(key(gx + dx, gz + dz)) ?? []) {
        if (other.dead || other.id <= mob.id) continue;
        const o = other.state;
        const overlapX = radius(mob) + radius(other) - Math.abs(s.x - o.x);
        const overlapZ = radius(mob) + radius(other) - Math.abs(s.z - o.z);
        const overlapY = Math.min(s.y + (s.box?.height ?? 1), o.y + (o.box?.height ?? 1)) - Math.max(s.y, o.y);
        if (overlapX <= 0 || overlapZ <= 0 || overlapY <= 0) continue;
        const pushY = swimmer(mob) && swimmer(other)
          && overlapY < Math.min(overlapX, overlapZ);
        const pushX = !pushY && overlapX <= overlapZ;
        const sign = Math.sign(pushX ? s.x - o.x : s.z - o.z) || (mob.id % 2 ? 1 : -1);
        const amount = (pushY ? overlapY : pushX ? overlapX : overlapZ) + MOB_SEPARATION.minGap;
        const moved = { ...s, x: s.x + (pushX ? sign * amount : 0),
          y: s.y + (pushY ? (s.y >= o.y ? 1 : -1) * amount : 0),
          z: s.z + (pushX || pushY ? 0 : sign * amount) };
        if (safe(world, mob, moved)) {
          s.x = moved.x; s.y = moved.y; s.z = moved.z; changed.add(mob); continue;
        }
        const opposite = { ...o, x: o.x - (pushX ? sign * amount : 0),
          y: o.y - (pushY ? (s.y >= o.y ? 1 : -1) * amount : 0),
          z: o.z - (pushX || pushY ? 0 : sign * amount) };
        if (safe(world, other, opposite)) {
          o.x = opposite.x; o.y = opposite.y; o.z = opposite.z; changed.add(other);
        }
      }
    }
  }
  return changed;
}
