// Deterministic world generation. Server and client both run this with the
// same seed, player count and world size and get identical worlds, so only
// those three go over the wire.
//
// Two generators: 'test' is a small flat-ish slab for quick testing; the other
// sizes build floating islands (shared/islands.js).

import { createNoise2D, createNoise3D } from 'simplex-noise';
import {
  CHUNK_SIZE, WORLD_SIZE_Y, WORLD_BASE_CHUNKS, WORLD_CHUNKS_PER_PLAYER, WORLD_MAX_CHUNKS, WATER_LEVEL,
  KEEP_HEIGHT, KEEP_RING,
} from './config.js';
import { BLOCK, isSolid } from './blocks.js';
import { World } from './world.js';
import { mulberry32, KEEP_REACH, buildKeep, plantTrees, sandShores } from './structures.js';
import { generateIslandWorld, carveCaves } from './islands.js';

// Island layout, shared by every island size (blocks). The sizes differ in the
// center island's width and its gap to the ring (both per size, below); the
// middle ring and outer scatter keep the same thickness, island sizes and
// spacing, and sit further out around a bigger center. World width follows.
//   ringWidth    thickness of the middle ring
//   outerGap     outer edge of the ring -> inner edge of the outer scatter
//   outerWidth   thickness of the outer scatter
//   edgeMargin   outer scatter -> world edge
//   keepSpacing  minimum distance between keeps, as a fraction of their
//                distance from the center (0.55 fits about 11 keeps)
export const ISLAND_LAYOUT = {
  height: 128,
  ringWidth: 120,
  outerGap: 20,
  outerWidth: 60,
  // Room for the center island's nudge (up to ~11 blocks) pushing everything out.
  edgeMargin: 28,
  keepSpacing: 0.55,
};

// Lobby world sizes. `center` is the center island's width range [min, max];
// `ringGap` is from the center island's edge to the nearest ring island's
// center-side bound. Eroded island edges add ~5 blocks, so the gaps seen in a
// world are about 8 / 13 / 31 / 63 blocks.
// A size can also override ISLAND_LAYOUT values: Tiny thins the ring (one row
// of the usual islands) and the outer scatter to stay small.
// Derived layouts (islandLayout), for the widest center island; the generator
// pulls the ring and scatter in to fit a narrower one:
//            center    gap  ring       keeps at  outer      world
//   Tiny     70-90     3    48-118     83        138-168    392
//   Small    150-180   6    96-216     156       236-296    648
//   Medium   230-280   27   167-287    227       307-367    790
//   Large    320-380   58   248-368    308       388-448    952
export const WORLD_SIZES = {
  test: { label: 'Test' },
  tiny: { label: 'Tiny', center: [70, 90], ringGap: 3, ringWidth: 70, outerWidth: 30 },
  small: { label: 'Small', center: [150, 180], ringGap: 6 },
  medium: { label: 'Medium', center: [230, 280], ringGap: 27 },
  large: { label: 'Large', center: [320, 380], ringGap: 58 },
};

// Everything the island generator needs for a size, in blocks from the world
// center: { width, height, center, ring: [min, max], keepDistance,
// outer: [min, max], keepSpacing }.
export function islandLayout(size) {
  const L = { ...ISLAND_LAYOUT, ...WORLD_SIZES[size] };
  const { center, ringGap } = L;
  const ring = [center[1] / 2 + ringGap, center[1] / 2 + ringGap + L.ringWidth];
  const outer = [ring[1] + L.outerGap, ring[1] + L.outerGap + L.outerWidth];
  const keepDistance = (ring[0] + ring[1]) / 2;
  return {
    width: 2 * Math.ceil(outer[1] + L.edgeMargin),
    height: L.height,
    center,
    ring,
    keepDistance,
    outer,
    keepSpacing: keepDistance * L.keepSpacing,
  };
}

export const DEFAULT_WORLD_SIZE = 'medium';

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// Parses a seed typed by a player: a whole number is used as is (mod 2^32), any
// other text is hashed (FNV-1a), and blank gives a random seed.
export function parseSeed(text) {
  const str = String(text ?? '').trim();
  if (str === '') return randomSeed();
  if (/^\d+$/.test(str)) return Number(BigInt(str) % 4294967296n);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function generateWorld(seed, playerCount, size = DEFAULT_WORLD_SIZE) {
  if (size === 'test' || !WORLD_SIZES[size]) return generateTestWorld(seed, playerCount);
  return generateIslandWorld(seed, playerCount, islandLayout(size));
}

// ---- Test world ----

// Test world X/Z size in blocks for a match with this many players.
export function worldSize(playerCount) {
  const chunks = Math.min(WORLD_MAX_CHUNKS, WORLD_BASE_CHUNKS + WORLD_CHUNKS_PER_PLAYER * Math.max(1, playerCount));
  return chunks * CHUNK_SIZE;
}

// Test world keep centers: one per player, spaced evenly on a ring around the
// world center (a single keep goes in the middle). Index i belongs to the i-th
// player in lobby order.
export function keepSites(size, playerCount) {
  const n = Math.max(1, playerCount);
  const radius = n === 1 ? 0 : size * KEEP_RING;
  const clamp = (v) => Math.max(KEEP_REACH, Math.min(size - 1 - KEEP_REACH, v));
  const sites = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + Math.PI / 4;
    sites.push({
      cx: clamp(Math.floor(size / 2 + Math.cos(angle) * radius)),
      cz: clamp(Math.floor(size / 2 + Math.sin(angle) * radius)),
    });
  }
  return sites;
}

// Gentle hills with water in the low spots, worm caves like the islands' (in
// a buffer first, so the island cave code can carve it), keeps, a tunnel by
// the first keep with some iron ore, sand shores and trees.
function generateTestWorld(seed, playerCount) {
  const size = worldSize(playerCount);
  const world = new World(seed, size, size, { sizeY: WORLD_SIZE_Y, closedBottom: true });
  const noise = createNoise2D(mulberry32(seed));
  const sites = keepSites(size, playerCount);

  const DIRT_DEPTH = 3;
  const heights = new Int32Array(size * size);
  const sy = WORLD_SIZE_Y;
  const data = new Uint8Array(size * sy * size);
  const colTop = new Int32Array(size * size);
  const colBottom = new Int32Array(size * size);
  // Columns with water, or next to it: caves stay out so no water hangs.
  const wet = new Uint8Array(size * size);

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      // Two octaves: broad hills plus small bumps.
      const n =
        noise(x / 48, z / 48) * 0.75 +
        noise(x / 16 + 100, z / 16 + 100) * 0.25;
      const height = Math.max(1, Math.min(WORLD_SIZE_Y - 2, Math.round(WATER_LEVEL + 1 + n * 9)));
      heights[x + z * size] = height;
      colTop[x + z * size] = height;
      for (let y = 0; y <= height; y++) {
        let id;
        if (y === height) id = height >= WATER_LEVEL ? BLOCK.GRASS : BLOCK.DIRT;
        else if (y > height - DIRT_DEPTH) id = BLOCK.DIRT;
        else id = BLOCK.STONE;
        data[x + size * (z + size * y)] = id;
      }
      for (let y = height + 1; y <= WATER_LEVEL; y++) {
        data[x + size * (z + size * y)] = BLOCK.WATER;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (x + dx >= 0 && z + dz >= 0 && x + dx < size && z + dz < size) wet[x + dx + (z + dz) * size] = 1;
          }
        }
      }
    }
  }

  const test = {
    kind: 'test', square: true, x: size / 2, z: size / 2, r: size / 2,
    avoid: (wx, wz) => wet[wx + wz * size] === 1
      || sites.some((k) => Math.abs(wx - k.cx) <= KEEP_REACH + 6 && Math.abs(wz - k.cz) <= KEEP_REACH + 6),
  };
  carveCaves(test, { x0: 0, y0: 0, z0: 0, sx: size, sy, sz: size, data, colTop, colBottom },
    createNoise3D(mulberry32(seed ^ 0x1b873593)), mulberry32(seed ^ 0x2c1b3c6d));
  let i = 0;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++, i++) {
        if (data[i]) world.setBlock(x, y, z, data[i]);
      }
    }
  }

  world.keeps = sites.map(({ cx, cz }) => {
    // Level with the ground at the center, but never under water or poking out the top.
    const floorY = Math.max(1, Math.min(WORLD_SIZE_Y - KEEP_HEIGHT - 2,
      Math.max(heights[cx + cz * size], WATER_LEVEL + 1)));
    const keep = { cx, cz, floorY };
    buildKeep(world, keep);
    return keep;
  });

  digTestTunnel(world, world.keeps[0]);
  sandShores(world, noise, 0, 0, world.sizeX - 1, world.sizeZ - 1);
  plantTrees(world, seed);
  return world;
}

// One short tunnel near the first keep, for testing caves: it starts at the
// surface a little way off, steps down like stairs, then runs level, 2 wide and
// 3 tall. It heads whichever way the ground rises most, avoiding ponds. A few
// iron ore blocks go in its walls, for testing mining and smelting.
function digTestTunnel(world, keep) {
  const START = KEEP_REACH + 7;
  const LENGTH = 16;
  const surface = (x, z) => world.getSurfaceY(x, z, isSolid);
  let best = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const sx = keep.cx + dx * START, sz = keep.cz + dz * START;
    const ex = sx + dx * LENGTH, ez = sz + dz * LENGTH;
    if (!world.inBounds(ex, 0, ez) || !world.inBounds(sx, 0, sz)) continue;
    // Water doesn't flow, so a tunnel under a pond would leave it hanging.
    let wet = false;
    for (let i = 0; i <= LENGTH && !wet; i++) {
      for (let y = 0; y < world.sizeY && !wet; y++) wet = world.getBlock(sx + dx * i, y, sz + dz * i) === BLOCK.WATER;
    }
    const rise = surface(ex, ez) - surface(sx, sz) - (wet ? 1000 : 0);
    if (!best || rise > best.rise) best = { dx, dz, sx, sz, rise };
  }
  if (!best) return;
  const { dx, dz, sx, sz } = best;
  let floor = surface(sx, sz);
  for (let i = 0; i < LENGTH; i++) {
    // Down one block a step for the first six (jumpable back up), then level.
    if (i > 0 && i <= 6) floor--;
    for (let w = 0; w < 2; w++) {
      // Width runs sideways to the heading.
      const x = sx + dx * i + (dz !== 0 ? w : 0), z = sz + dz * i + (dx !== 0 ? w : 0);
      for (let y = floor; y <= floor + 2; y++) world.setBlock(x, y, z, BLOCK.AIR);
    }
    // Ore in the wall on the far side of the level stretch.
    if (i >= 9 && i % 2 === 1) {
      const x = sx + dx * i + (dz !== 0 ? 2 : 0), z = sz + dz * i + (dx !== 0 ? 2 : 0);
      for (const y of [floor, floor + 1]) {
        if (isSolid(world.getBlock(x, y, z))) world.setBlock(x, y, z, BLOCK.IRON_ORE);
      }
    }
  }
}
