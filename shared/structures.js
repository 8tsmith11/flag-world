// Structures shared by every kind of world gen: keeps (one per player, with
// the flag on a pedestal in the middle), sand shores and trees. Also the
// seeded PRNG all world gen uses.

import { KEEP_SIZE, KEEP_HEIGHT, KEEP_MARGIN } from './config.js';
import { BLOCK, isSolid } from './blocks.js';

// mulberry32: tiny seeded PRNG so world gen matches across machines.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const KEEP_HALF = Math.floor(KEEP_SIZE / 2);
// Half-width of the area a keep flattens: the keep plus its margin.
export const KEEP_REACH = KEEP_HALF + KEEP_MARGIN;

export function surfaceStats(surfaceAt, x0, z0, x1, z1) {
  const heights = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const height = surfaceAt(x, z);
    if (height === -32768 || height < 0) return null;
    heights.push(height);
  }
  heights.sort((a, b) => a - b);
  return { median: heights[Math.floor(heights.length / 2)],
    variance: heights.at(-1) - heights[0] };
}

export function prepareSurface(world, x0, z0, x1, z1, floorY, surfaceAt,
  { margin = 4, clearTo = floorY + 8, foundation = BLOCK.DIRT } = {}) {
  for (let z = z0 - margin; z <= z1 + margin; z++) for (let x = x0 - margin; x <= x1 + margin; x++) {
    const natural = surfaceAt(x, z);
    if (natural === -32768 || natural < 0) continue;
    const outside = Math.max(x0 - x, x - x1, z0 - z, z - z1, 0);
    const level = outside === 0 ? floorY
      : Math.round(floorY + (natural - floorY) * outside / (margin + 1));
    for (let y = natural + 1; y <= Math.max(clearTo, level); y++) {
      if (world.getBlock(x, y, z) !== BLOCK.AIR) world.setBlock(x, y, z, BLOCK.AIR);
    }
    for (let y = natural; y > level; y--) world.setBlock(x, y, z, BLOCK.AIR);
    for (let y = level - 1; y >= world.minY && !isSolid(world.getBlock(x, y, z)); y--) {
      world.setBlock(x, y, z, foundation);
    }
    if (outside > 0) world.setBlock(x, level, z, BLOCK.GRASS);
  }
}

// The keep whose volume (the floor up to the top of the frame) contains the block, or null.
export function keepAt(world, x, y, z) {
  for (const keep of world.keeps) {
    if (Math.abs(x - keep.cx) <= KEEP_HALF && Math.abs(z - keep.cz) <= KEEP_HALF
      && y >= keep.floorY && y <= keep.floorY + KEEP_HEIGHT) return keep;
  }
  return null;
}

// Where a keep's flag stands: on the pedestal in the middle of the floor.
export function flagHome(keep) {
  return { x: keep.cx + 0.5, y: keep.floorY + 1, z: keep.cz + 0.5 };
}

// Builds a keep on a filled foundation with a sloped grass margin.
export function buildKeep(world, { cx, cz, floorY }, { clearTo = world.sizeY,
  surfaceAt = (x, z) => world.getSurfaceY(x, z, isSolid) } = {}) {
  prepareSurface(world, cx - KEEP_HALF, cz - KEEP_HALF, cx + KEEP_HALF, cz + KEEP_HALF,
    floorY, surfaceAt, { margin: 4, clearTo });
  for (let z = cz - KEEP_HALF; z <= cz + KEEP_HALF; z++) {
    for (let x = cx - KEEP_HALF; x <= cx + KEEP_HALF; x++) {
      const edgeX = Math.abs(x - cx) === KEEP_HALF, edgeZ = Math.abs(z - cz) === KEEP_HALF;
      world.setBlock(x, floorY, z, x === cx && z === cz ? BLOCK.PEDESTAL : BLOCK.KEEP);
      // Corner pillars, and beams along the top edges.
      if (edgeX && edgeZ) {
        for (let y = floorY + 1; y <= floorY + KEEP_HEIGHT; y++) world.setBlock(x, y, z, BLOCK.KEEP);
      } else if (edgeX || edgeZ) {
        world.setBlock(x, floorY + KEEP_HEIGHT, z, BLOCK.KEEP);
      }
    }
  }
}

// Sand shores: grass and dirt at the surface within 1-3 blocks of water (the
// width wanders with `noise`, a 2D noise function) turn to sand, a couple of
// blocks deep. Works on the columns from (x0, z0) to (x1, z1).
export function sandShores(world, noise, x0, z0, x1, z1, surfaceAt = (x, z) => world.getSurfaceY(x, z, isSolid)) {
  const MAX_BORDER = 3;
  const soft = (id) => id === BLOCK.GRASS || id === BLOCK.DIRT;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const top = surfaceAt(x, z);
      if (top < 0 || !soft(world.getBlock(x, top, z))) continue;
      const border = 1 + Math.floor((noise(x / 7 + 50, z / 7 + 50) * 0.5 + 0.5) * MAX_BORDER * 0.999);
      let shore = false;
      for (let dz = -border; dz <= border && !shore; dz++) {
        for (let dx = -border; dx <= border && !shore; dx++) {
          if (dx * dx + dz * dz > border * border) continue;
          for (let dy = -3; dy <= 1 && !shore; dy++) {
            shore = world.getBlock(x + dx, top + dy, z + dz) === BLOCK.WATER;
          }
        }
      }
      if (!shore) continue;
      for (let y = top; y > top - 2 && soft(world.getBlock(x, y, z)); y--) world.setBlock(x, y, z, BLOCK.SAND);
    }
  }
}

// Trees: at most one per TREE_CELL x TREE_CELL cell, at a random spot in it,
// on grass, clear of keeps (with their margin) and the world edge.
// requireFooting: also need solid ground two blocks out on every side, so
// trees don't grow on bridges or hang off island edges.
const TREE_CELL = 7;
const TREE_CHANCE = 0.45;
const TREE_MIN_TRUNK = 4;
const TREE_MAX_TRUNK = 6;
const LEAF_RADIUS = 2;

export function plantTrees(world, seed, { requireFooting = false,
  bounds = { x0: 0, z0: 0, x1: world.sizeX - 1, z1: world.sizeZ - 1 },
  surfaceAt = (x, z) => world.getSurfaceY(x, z, isSolid) } = {}) {
  // A separate stream from the terrain, so trees don't shift the terrain.
  const random = mulberry32(seed ^ 0x5bd1e995);
  const clearOfKeeps = KEEP_REACH + LEAF_RADIUS;
  for (let cz = Math.floor(bounds.z0 / TREE_CELL) * TREE_CELL; cz <= bounds.z1; cz += TREE_CELL) {
    for (let cx = Math.floor(bounds.x0 / TREE_CELL) * TREE_CELL; cx <= bounds.x1; cx += TREE_CELL) {
      // Always draw every number so each cell uses the same amount of the stream.
      const roll = random(), ox = random(), oz = random(), trunkRoll = random();
      if (roll >= TREE_CHANCE) continue;
      const x = cx + Math.floor(ox * TREE_CELL), z = cz + Math.floor(oz * TREE_CELL);
      if (x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1) continue;
      if (x < LEAF_RADIUS || z < LEAF_RADIUS || x >= world.sizeX - LEAF_RADIUS || z >= world.sizeZ - LEAF_RADIUS) continue;
      if (world.keeps.some((k) => Math.abs(x - k.cx) <= clearOfKeeps && Math.abs(z - k.cz) <= clearOfKeeps)) continue;
      const ground = surfaceAt(x, z);
      if (ground < 0 || world.getBlock(x, ground, z) !== BLOCK.GRASS) continue;
      if (requireFooting && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => !isSolid(world.getBlock(x + dx, ground, z + dz)))) continue;
      const trunk = TREE_MIN_TRUNK + Math.floor(trunkRoll * (TREE_MAX_TRUNK - TREE_MIN_TRUNK + 1));
      const top = ground + trunk;
      if (top + 2 >= world.sizeY) continue;
      growTree(world, x, ground, z, top);
    }
  }
}

// Trunk from ground + 1 to top; leaves: two wide layers around the top of the
// trunk, then a narrow cap. Leaves only fill air.
export function growTree(world, x, ground, z, top) {
  world.setBlock(x, ground, z, BLOCK.DIRT);
  for (let y = ground + 1; y <= top; y++) world.setBlock(x, y, z, BLOCK.WOOD);
  const layers = [[top - 1, LEAF_RADIUS], [top, LEAF_RADIUS], [top + 1, 1], [top + 2, 0]];
  for (const [y, r] of layers) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        if (world.getBlock(x + dx, y, z + dz) === BLOCK.AIR) world.setBlock(x + dx, y, z + dz, BLOCK.LEAVES);
      }
    }
  }
}
