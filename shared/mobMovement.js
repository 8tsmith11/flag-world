// Shared body movement for routed mobs; no autonomous steering or wandering.
import { stepPlayer, isOnLadder, isInWater } from './physics.js';
import { TICK_DT, WALK_SPEED } from './config.js';

export function stepMobPath(mob, world, speed = 1) {
  const s = mob.state, path = mob.path;
  let n = path[0];
  // Consume passed waypoints on every physics tick, including several short
  // steps. Collinear paths are collapsed by nav, so straight runs stay straight.
  while (n) {
    const dx = n.x + 0.5 - s.x, dz = n.z + 0.5 - s.z;
    const next = path[1];
    const passed = next && Math.abs(n.y - s.y) < 0.35
      && (s.x - n.x - 0.5) * (next.x - n.x) + (s.z - n.z - 0.5) * (next.z - n.z) > 0;
    if (!(Math.hypot(dx, dz) < 0.15 && Math.abs(n.y - s.y) < 0.25 || passed)) break;
    path.shift(); n = path[0];
  }
  const climbing = isOnLadder(s, world);
  let forward = 0, jump = false, climb = 0;
  if (n) {
    const dx = n.x + 0.5 - s.x, dz = n.z + 0.5 - s.z, distance = Math.hypot(dx, dz);
    if (distance > 0.04) { s.yaw = Math.atan2(-dx, -dz); forward = Math.min(speed, distance / (WALK_SPEED * TICK_DT)); }
    jump = !climbing && n.y > s.y + 0.25 && s.onGround;
    if (climbing) climb = Math.sign(n.y - s.y);
  }
  if (isInWater(s, world)) jump = true;
  const before = { x: s.x, y: s.y, z: s.z };
  stepPlayer(s, { forward, strafe: 0, jump, climb, yaw: s.yaw, pitch: 0 }, world);
  mob.climbing = climbing && climb !== 0;
  mob.walking = !!n && (forward > 0 || mob.climbing);
  return Math.hypot(s.x - before.x, s.y - before.y, s.z - before.z);
}
