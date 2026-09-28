import { SpatialHash } from './spatialHash.js';
import { MOB_SEPARATION, TICK_DT } from '../shared/config.js';
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

// Separation is applied once after body movement, never as a second steering
// direction. Keep this hook for the existing ground-mob callers.
export function steerGround() {}

const overlapIndex = new SpatialHash(MOB_SEPARATION.gridSize);
const nearby = [];
export function resolveMobOverlaps(world, mobs) {
  const changed = new Set(), pushes = new Map();
  const amount = MOB_SEPARATION.strength * TICK_DT;
  overlapIndex.rebuild(mobs);
  const largest = Math.max(0.5, ...mobs.map(radius));
  for (const mob of mobs) {
    if (mob.dead) continue;
    const s = mob.state;
    for (const other of overlapIndex.query(s, radius(mob) + largest, nearby)) {
      if (other.id <= mob.id || other.dead) continue;
      const o = other.state, sum = radius(mob) + radius(other);
      const ox = sum - Math.abs(s.x - o.x), oz = sum - Math.abs(s.z - o.z);
      const oy = Math.min(s.y + (s.box?.height ?? 1), o.y + (o.box?.height ?? 1)) - Math.max(s.y, o.y);
      if (ox <= 0 || oz <= 0 || oy <= 0) continue;
      // Constant radial pressure, independent of penetration. Walking is
      // much stronger, so approaching bodies overlap and pass each other.
      let dx = s.x - o.x, dz = s.z - o.z;
      let dy = swimmer(mob) && swimmer(other) ? s.y - o.y : 0;
      let length = Math.hypot(dx, dy, dz);
      if (length < 1e-6) { dx = mob.id % 2 ? 1 : -1; dz = 0; dy = 0; length = 1; }
      for (const [body, direction] of [[mob, 1], [other, -1]]) {
        if (body.immovable) continue;
        let push = pushes.get(body);
        if (!push) { push = { x: 0, y: 0, z: 0 }; pushes.set(body, push); }
        push.x += direction * dx / length * amount;
        push.y += direction * dy / length * amount;
        push.z += direction * dz / length * amount;
      }
    }
  }
  for (const [body, push] of pushes) {
    // Even a dense crowd cannot overpower a walking mob's own movement.
    const scale = Math.min(1, amount / Math.max(1e-9, Math.hypot(push.x, push.y, push.z)));
    const proposed = { ...body.state, x: body.state.x + push.x * scale,
      y: body.state.y + push.y * scale, z: body.state.z + push.z * scale };
    if (body.goblin && body.behavior !== 'return' && !body.garrison.nav.contains(body.garrison.nav.area(body.home), proposed)) continue;
    if (!safe(world, body, proposed)) continue;
    body.state.x = proposed.x; body.state.y = proposed.y; body.state.z = proposed.z;
    changed.add(body);
  }
  return changed;
}
