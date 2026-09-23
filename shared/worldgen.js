// Deterministic world generation. Server and client both run this with the
// same seed, player count and world size and get identical worlds, so only
// those three go over the wire.
//
// Two generators: 'test' is a small flat-ish slab for quick testing; the other
// sizes build floating islands (shared/islands.js).

import { createNoise2D } from 'simplex-noise';
import {
  CHUNK_SIZE, WORLD_SIZE_Y, WORLD_BASE_CHUNKS, WORLD_MAX_CHUNKS, WATER_LEVEL,
  KEEP_HEIGHT, KEEP_RING,
} from './config.js';
import { BLOCK, isSolid } from './blocks.js';
import { World } from './world.js';
import { mulberry32, KEEP_REACH, buildKeep, plantTrees, sandShores } from './structures.js';
import { generateIslandWorld } from './islands.js';

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
  edgeMargin: 16,
  keepSpacing: 0.55,
};

// Lobby world sizes. `center` is the center island's width range [min, max];
// `ringGap` is from the center island's edge to the nearest ring island edge.
// Derived layouts (islandLayout), for the widest center island; the generator
// pulls the ring and scatter in to fit a narrower one:
//            center    gap  ring       keeps at  outer      world
//   Small    150-180   12   102-222    162       242-302    636
//   Medium   230-280   34   174-294    234       314-374    780
//   Large    320-380   66   256-376    316       396-456    944
export const WORLD_SIZES = {
  test: { label: 'Test' },
  small: { label: 'Small', center: [150, 180], ringGap: 12 },
  medium: { label: 'Medium', center: [230, 280], ringGap: 34 },
  large: { label: 'Large', center: [320, 380], ringGap: 66 },
};

// Everything the island generator needs for a size, in blocks from the world
// center: { width, height, center, ring: [min, max], keepDistance,
// outer: [min, max], keepSpacing }.
export function islandLayout(size) {
  const L = ISLAND_LAYOUT;
  const { center, ringGap } = WORLD_SIZES[size];
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
  const chunks = Math.min(WORLD_MAX_CHUNKS, WORLD_BASE_CHUNKS + Math.max(1, playerCount));
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

function generateTestWorld(seed, playerCount) {
  const size = worldSize(playerCount);
  const world = new World(seed, size, size, { sizeY: WORLD_SIZE_Y, closedBottom: true });
  const noise = createNoise2D(mulberry32(seed));

  const DIRT_DEPTH = 3;
  const heights = new Int32Array(size * size);

  for (let z = 0; z < world.sizeZ; z++) {
    for (let x = 0; x < world.sizeX; x++) {
      // Two octaves: broad hills plus small bumps.
      const n =
        noise(x / 48, z / 48) * 0.75 +
        noise(x / 16 + 100, z / 16 + 100) * 0.25;
      const height = Math.max(1, Math.min(WORLD_SIZE_Y - 2, Math.round(WATER_LEVEL + 1 + n * 9)));
      heights[x + z * size] = height;

      for (let y = 0; y <= height; y++) {
        let id;
        if (y === height) id = height >= WATER_LEVEL ? BLOCK.GRASS : BLOCK.DIRT;
        else if (y > height - DIRT_DEPTH) id = BLOCK.DIRT;
        else id = BLOCK.STONE;
        world.setBlock(x, y, z, id);
      }
      for (let y = height + 1; y <= WATER_LEVEL; y++) {
        world.setBlock(x, y, z, BLOCK.WATER);
      }
    }
  }

  world.keeps = keepSites(size, playerCount).map(({ cx, cz }) => {
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
