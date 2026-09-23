// Raycasting: voxel traversal (Amanatides & Woo) for the block under the
// crosshair, and ray/box tests for players.

// Unit vector for a look direction. yaw 0 looks toward -Z; positive pitch looks up.
export function lookDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

// Walks the blocks along a ray and returns the first one where hit(id) is true,
// as { x, y, z, id, nx, ny, nz, t } (n is the normal of the face entered, t the
// distance along the ray to it), or null
// if nothing is hit within maxDist. dir must be a unit vector.
export function raycastBlock(world, origin, dir, maxDist, hit) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
  // Distance along the ray to the next boundary on each axis.
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (hit(id)) return { x, y, z, id, nx, ny, nz, t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

// Distance along the ray to where it enters the axis-aligned box, 0 if it
// starts inside, or null if it misses. dir must be a unit vector.
export function rayBox(origin, dir, minX, minY, minZ, maxX, maxY, maxZ) {
  let tMin = 0, tMax = Infinity;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, minX, maxX], [origin.y, dir.y, minY, maxY], [origin.z, dir.z, minZ, maxZ],
  ]) {
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

// Nearest player whose box (grown by `grow` on every side) the ray enters
// within maxDist, as { player, t }, or null. `players` yields objects with a
// feet position in `state`.
export function raycastPlayers(origin, dir, maxDist, players, box, grow = 0) {
  let best = null;
  for (const player of players) {
    const { x, y, z } = player.state;
    const w = box.halfW + grow;
    const t = rayBox(origin, dir, x - w, y - grow, z - w, x + w, y + box.height + grow, z + w);
    if (t !== null && t <= maxDist && (!best || t < best.t)) best = { player, t };
  }
  return best;
}
