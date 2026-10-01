// The temple and arena are generated from the same seed on server and client.
// The arena uses sparse chunks beyond the normal island bounds, so the
// ordinary island terrain maps keep their original size.
import { BLOCK } from './blocks.js';
import { DRAGON_ARENA as A, FIRE_TEMPLE as T } from './config.js';
import { NPC_KIND } from './npcs.js';
import { mulberry32 } from './structures.js';

const put = (world, x, y, z, id) => world.setBlock(x, y, z, id);
const box = (x0, y0, z0, x1, y1, z1) => ({ x0, y0, z0, x1, y1, z1 });

function portalFrame(world, cx, floorY, cz) {
  const half = Math.floor(T.portalWidth / 2);
  for (let dy = 0; dy < T.portalHeight; dy++) for (let dx = -half; dx <= half; dx++)
    put(world, cx + dx, floorY + dy, cz,
      dy === 0 || dy === T.portalHeight - 1 || Math.abs(dx) === half
        ? BLOCK.CHISELED_BASALT : BLOCK.FIRE_PORTAL);
  return { x: cx + 0.5, y: floorY + 1, z: cz + 0.5,
    width: T.portalWidth - 2, height: T.portalHeight - 2 };
}

export function generateFireTemple(world) {
  const area = world.specialIslands?.fire?.templeArea;
  if (!area) return;
  const cx = Math.floor((area.x0 + area.x1) / 2), cz = Math.floor((area.z0 + area.z1) / 2), y = area.y;
  const x0 = cx - T.hallHalfWidth - 1, x1 = cx + T.hallHalfWidth + 1;
  const z0 = cz + T.entranceZ, z1 = cz + T.portalZ + 4;
  const bounds = box(x0, y - 3, z0, x1, y + T.portalHeight + 2, z1);
  if (world.structures.some(s => s.box && !(s.box.x1 < x0 || s.box.x0 > x1
    || s.box.z1 < z0 || s.box.z0 > z1 || s.box.y1 < bounds.y0 || s.box.y0 > bounds.y1)))
    throw new Error('Fire temple overlaps another structure');
  // Foundations over the natural basalt, then clear the hall and the portal room.
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    for (let yy = y - 3; yy < y; yy++) if (world.getBlock(x, yy, z) === BLOCK.AIR)
      put(world, x, yy, z, BLOCK.BASALT);
    for (let yy = y + 1; yy <= bounds.y1; yy++) put(world, x, yy, z, BLOCK.AIR);
    put(world, x, y, z, BLOCK.BASALT_BRICKS);
  }
  for (let z = cz + T.hallFront; z <= cz + T.hallBack; z++) {
    for (let yy = y + 1; yy <= y + T.wallHeight; yy++) {
      for (const x of [cx - T.hallHalfWidth, cx + T.hallHalfWidth])
        put(world, x, yy, z, yy % 3 === 0 ? BLOCK.CHISELED_BASALT : BLOCK.BASALT_BRICKS);
      if ((z === cz + T.hallFront || z === cz + T.hallBack))
        for (let x = cx - T.hallHalfWidth; x <= cx + T.hallHalfWidth; x++)
          if (Math.abs(x - cx) > 1 || yy > 4) put(world, x, yy, z, BLOCK.BASALT_BRICKS);
    }
  }
  for (let z = cz + T.hallFront + 1; z < cz + T.sanctumFront; z++) {
    for (const dx of [-T.lavaChannelOffset, T.lavaChannelOffset]) put(world, cx + dx, y, z, BLOCK.LAVA);
  }
  for (const z of T.pillarZ) for (const dx of [-T.pillarOffset + 2, T.pillarOffset - 2])
    for (let yy = y + 1; yy <= y + T.wallHeight; yy++)
      put(world, cx + dx, yy, cz + z, yy === y + T.wallHeight ? BLOCK.CHISELED_BASALT : BLOCK.BASALT_BRICKS);
  // A wide throne remains reachable from the central aisle.
  for (let dx = -2; dx <= 2; dx++) {
    put(world, cx + dx, y + 1, cz + T.throneZ, BLOCK.CHISELED_BASALT);
    if (Math.abs(dx) === 2) put(world, cx + dx, y + 2, cz + T.throneZ, BLOCK.CHISELED_BASALT);
    for (let yy = y + 2; yy <= y + 4; yy++)
      put(world, cx + dx, yy, cz + T.throneZ + 1, BLOCK.CHISELED_BASALT);
  }
  // Lit braziers flank the stepped entrance. Their magma cores emit light.
  for (let step = 0; step < T.stairCount; step++)
    for (let dx = -2; dx <= 2; dx++) put(world, cx + dx, y - T.stairCount + step,
      cz + T.entranceZ - T.stairCount + step, BLOCK.BASALT_BRICKS);
  for (const dx of [-T.hallHalfWidth + 1, T.hallHalfWidth - 1]) {
    const z = cz + T.entranceZ;
    put(world, cx + dx, y + 1, z, BLOCK.CHISELED_BASALT);
    put(world, cx + dx, y + 2, z, BLOCK.MAGMA);
  }
  // The rear chamber encloses the always visible frame.
  for (let z = cz + T.hallBack + 1; z <= z1; z++)
    for (let yy = y + 1; yy <= y + T.wallHeight; yy++) {
      for (const dx of [-T.hallHalfWidth, T.hallHalfWidth])
        put(world, cx + dx, yy, z, BLOCK.BASALT_BRICKS);
      if (z === z1) for (let x = cx - T.hallHalfWidth; x <= cx + T.hallHalfWidth; x++)
        put(world, x, yy, z, BLOCK.BASALT_BRICKS);
    }
  const portal = portalFrame(world, cx, y, cz + T.portalZ);
  const sanctum = box(cx - T.hallHalfWidth, y, cz + T.sanctumFront,
    cx + T.hallHalfWidth, y + T.wallHeight, cz + T.hallBack);
  world.fireTemple = { x: cx, y, z: cz, bounds, sanctum, portal,
    portalProtection: box(cx - Math.floor(T.portalWidth / 2), y,
      cz + T.portalZ, cx + Math.floor(T.portalWidth / 2), y + T.portalHeight - 1, cz + T.portalZ),
    returnSpawn: { x: cx + 0.5, y: y + 1, z: cz + T.portalZ - 3 + 0.5 } };
  world.structures.push({ kind: 'fireTemple', islandKind: 'fire', x: cx, y, z: cz, box: bounds });
  world.npcSites.push({ npc: NPC_KIND.ANCIENT_FIRE_MONKEY,
    x: cx + 0.5, y: y + 2, z: cz + T.throneZ + 0.5, yaw: 0 });
}

export function generateDragonArena(world) {
  const cx = world.sizeX + A.gap + A.regionHalfWidth;
  const cz = Math.floor(world.sizeZ / 2), y = A.floorY;
  const bounds = box(cx - A.regionHalfWidth, world.minY, cz - A.regionHalfDepth,
    cx + A.regionHalfWidth, world.sizeY - 1, cz + A.regionHalfDepth);
  world.dragonArena = { x: cx, y, z: cz, bounds, spawn: { x: cx + 0.5,
    y: y + 1, z: cz + A.spawnOffset + 0.5 }, pillars: [] };
  const random = mulberry32(world.seed ^ 0x74b2e691);
  for (let dz = -A.lakeRadius; dz <= A.lakeRadius; dz++)
    for (let dx = -A.lakeRadius; dx <= A.lakeRadius; dx++) {
      const r = Math.hypot(dx, dz); if (r > A.lakeRadius) continue;
      for (let depth = 1; depth <= A.lavaDepth; depth++)
        put(world, cx + dx, y - depth - 1, cz + dz, BLOCK.BASALT);
      put(world, cx + dx, y - 1, cz + dz, BLOCK.LAVA);
      if (r <= A.mainRadius) put(world, cx + dx, y, cz + dz, BLOCK.OBSIDIAN);
    }
  for (let i = 0; i < A.pillarCount; i++) {
    const angle = i * Math.PI * 2 / A.pillarCount;
    const px = cx + Math.round(Math.cos(angle) * A.pillarDistance);
    const pz = cz + Math.round(Math.sin(angle) * A.pillarDistance);
    world.dragonArena.pillars.push({ x: px, z: pz });
    for (let yy = y + 1; yy <= y + A.pillarHeight; yy++)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        put(world, px + dx, yy, pz + dz, BLOCK.OBSIDIAN);
  }
  for (let i = 0; i < A.edgePlatformCount; i++) {
    const angle = (i + 0.5) * Math.PI * 2 / A.edgePlatformCount;
    const px = cx + Math.round(Math.cos(angle) * A.edgePlatformDistance);
    const pz = cz + Math.round(Math.sin(angle) * A.edgePlatformDistance);
    for (let dz = -A.edgePlatformRadius; dz <= A.edgePlatformRadius; dz++)
      for (let dx = -A.edgePlatformRadius; dx <= A.edgePlatformRadius; dx++)
        if (Math.hypot(dx, dz) <= A.edgePlatformRadius)
          put(world, px + dx, y + 2, pz + dz, BLOCK.OBSIDIAN);
  }
  const perchZ = cz + A.perchDistance;
  for (let dz = -A.perchRadius; dz <= A.perchRadius; dz++)
    for (let dx = -A.perchRadius; dx <= A.perchRadius; dx++)
      if (Math.hypot(dx, dz) <= A.perchRadius)
        put(world, cx + dx, y + A.perchHeight, perchZ + dz, BLOCK.OBSIDIAN);
  for (let i = 0; i < A.horizonFormations; i++) {
    const angle = i * Math.PI * 2 / A.horizonFormations + random() * 0.15;
    const px = cx + Math.round(Math.cos(angle) * A.horizonRadius);
    const pz = cz + Math.round(Math.sin(angle) * A.horizonRadius);
    const height = Math.round(A.horizonHeight[0] + random() * (A.horizonHeight[1] - A.horizonHeight[0]));
    for (let yy = y; yy < y + height; yy++) {
      const radius = Math.max(1, Math.round(4 * (1 - (yy - y) / height)));
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++)
        if (dx * dx + dz * dz <= radius * radius) put(world, px + dx, yy, pz + dz, BLOCK.BASALT);
    }
    if (i % 4 === 0) for (let yy = y + height; yy >= y - 1; yy--)
      put(world, px + 2, yy, pz, BLOCK.LAVA);
  }
  world.dragonArena.portal = portalFrame(world, cx, y, cz + A.exitOffset);
  world.dragonArena.perch = { x: cx + 0.5, y: y + A.perchHeight + 5, z: perchZ + 0.5 };
  world.structures.push({ kind: 'dragonArena', islandKind: 'arena', x: cx, y, z: cz, box: bounds });
}

export function inDragonArena(world, x, z) {
  const b = world.dragonArena?.bounds;
  return !!b && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
}

export function inFireSanctum(world, x, y, z) {
  for (const b of [world.fireTemple?.sanctum, world.fireTemple?.portalProtection])
    if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
  return false;
}
