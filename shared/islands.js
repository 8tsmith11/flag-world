// Seeded island planning and terrain. The complete island/keep layout is
// chosen before any blocks are written, so spacing does not depend on order.
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { BLOCK, isSolid } from './blocks.js';
import { World } from './world.js';
import { CHUNK_SIZE, KEEP_HEIGHT } from './config.js';
import { mulberry32, KEEP_REACH, buildKeep, plantTrees, sandShores } from './structures.js';

const EDGE_SHELL = 3;
const KEEP_CLEARANCE = KEEP_REACH + 6;
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function islandBounds(kind, radius, surfaceY) {
  if (kind === 'tiny') {
    return { topY: Math.ceil(surfaceY + 3),
      bottomY: Math.floor(surfaceY - 3 - (2 + radius * 0.45) * 1.1) };
  }
  return { topY: Math.ceil(surfaceY + 24),
    bottomY: Math.floor(surfaceY - 24 - (12 + radius * 0.28) * 1.1) };
}

function planIslands(seed, teamCount, config) {
  const rand = mulberry32(seed ^ 0x2c1b3c6d);
  const island = (kind, x, z, radius, surfaceY, extra = {}) =>
    ({ kind, x: Math.round(x), z: Math.round(z), radius, surfaceY,
      ...islandBounds(kind, radius, surfaceY), ...extra });
  const center = island('center', 0, 0, config.centralRadius, config.centralSurfaceY);
  const islands = [center];
  const keeps = [];
  const teamDistance = config.centralRadius + config.gap + config.teamRadius;
  const rotation = rand() * Math.PI * 2;
  for (let i = 0; i < teamCount; i++) {
    const angle = rotation + i * Math.PI * 2 / teamCount
      + (rand() * 2 - 1) * config.teamAngleJitterDegrees * Math.PI / 180;
    const team = island('team', Math.cos(angle) * teamDistance, Math.sin(angle) * teamDistance,
      config.teamRadius, config.centralSurfaceY + config.teamHeightOffset, { teamIndex: i });
    islands.push(team);
    const keepAngle = rand() * Math.PI * 2;
    const keepDistance = Math.sqrt(rand()) * team.radius * config.keepInnerRadius;
    keeps.push({ cx: Math.round(team.x + Math.cos(keepAngle) * keepDistance),
      cz: Math.round(team.z + Math.sin(keepAngle) * keepDistance), island: team });
  }

  const totalTiny = config.tinyCount[0]
    + Math.floor(rand() * (config.tinyCount[1] - config.tinyCount[0] + 1));
  const counts = config.tinyDistribution.map((part) => Math.round(totalTiny * part));
  counts[3] += totalTiny - counts.reduce((a, b) => a + b, 0);
  for (let category = 0; category < counts.length; category++) {
    for (let i = 0; i < counts[category]; i++) {
      for (let attempt = 0; attempt < config.placementAttempts; attempt++) {
        const radius = config.tinyRadius[0]
          + Math.floor(rand() * (config.tinyRadius[1] - config.tinyRadius[0] + 1));
        const angle = rand() * Math.PI * 2;
        let x, z, surfaceY;
        if (category === 0) {
          const distance = config.centralRadius + radius + config.horizontalClearance
            + rand() * config.centerRingWidth;
          x = Math.cos(angle) * distance;
          z = Math.sin(angle) * distance;
        } else if (category === 1 && teamCount > 0) {
          const team = islands[1 + Math.floor(rand() * teamCount)];
          const distance = team.radius + radius + config.horizontalClearance
            + rand() * config.teamRingWidth;
          x = team.x + Math.cos(angle) * distance;
          z = team.z + Math.sin(angle) * distance;
        } else if (category === 3) {
          const big = islands[Math.floor(rand() * (teamCount + 1))];
          const distance = Math.sqrt(rand()) * big.radius * 0.75;
          x = big.x + Math.cos(angle) * distance;
          z = big.z + Math.sin(angle) * distance;
          const depth = 3 + (2 + radius * 0.45) * 1.1;
          surfaceY = rand() < 0.5
            ? big.topY + config.aboveClearance + depth
            : big.bottomY - config.belowClearance - 3;
        } else {
          const distance = teamDistance + config.teamRadius + config.horizontalClearance
            + rand() * config.outerReach;
          x = Math.cos(angle) * distance;
          z = Math.sin(angle) * distance;
        }
        if (surfaceY === undefined) {
          surfaceY = config.centralSurfaceY + config.tinySurfaceOffset[0]
            + rand() * (config.tinySurfaceOffset[1] - config.tinySurfaceOffset[0]);
        }
        const tiny = island('tiny', x, z, radius, Math.round(surfaceY), { tinyGroup: category });
        if (keeps.some((keep) => Math.hypot(tiny.x - keep.cx, tiny.z - keep.cz)
          < tiny.radius + KEEP_REACH + config.tinyKeepClearance)) continue;
        if (islands.some((other) => {
          const close = Math.hypot(tiny.x - other.x, tiny.z - other.z)
            < tiny.radius + other.radius + config.horizontalClearance;
          const separated = tiny.bottomY >= other.topY + config.verticalClearance
            || other.bottomY >= tiny.topY + config.verticalClearance;
          return close && !separated;
        })) continue;
        islands.push(tiny);
        break;
      }
    }
  }
  return { islands, keeps, rand };
}

function terrainFor(world, island, noise, detail) {
  const reach = Math.ceil(island.radius + 8);
  const width = reach * 2 + 1;
  const x0 = island.x - reach, z0 = island.z - reach;
  const top = new Int16Array(width * width).fill(-32768);
  const bottom = new Int16Array(width * width).fill(-32768);
  const index = (x, z) => x - x0 + width * (z - z0);
  const getTop = (x, z) => x < x0 || z < z0 || x >= x0 + width || z >= z0 + width
    ? -32768 : top[index(x, z)];
  const getBottom = (x, z) => x < x0 || z < z0 || x >= x0 + width || z >= z0 + width
    ? -32768 : bottom[index(x, z)];
  const phase = island.index * 37;
  const outline = (angle) => island.radius * (0.90 + 0.095
    * noise(Math.cos(angle) * 1.9 + 71 + phase, Math.sin(angle) * 1.9 + 71 + phase));
  for (let z = z0; z < z0 + width; z++) for (let x = x0; x < x0 + width; x++) {
    const dx = x + 0.5 - island.x, dz = z + 0.5 - island.z;
    const edge = outline(Math.atan2(dz, dx))
      + Math.min(5, island.radius * 0.08) * detail(x / 9, z / 9);
    const distance = Math.hypot(dx, dz);
    if (distance >= edge) continue;
    const t = distance / edge;
    const hill = island.kind === 'tiny'
      ? 2 * noise(x / 9, z / 9) + detail(x / 5, z / 5)
      : 10 * noise(x / 48, z / 48) + 5 * detail(x / 17, z / 17)
        + 9 * noise(x / 105 + 200, z / 105 + 200);
    const yTop = Math.round(island.surfaceY + hill * (1 - t * t));
    const jag = 0.78 + 0.32 * detail(x / 7 + 100, z / 7 + 100);
    const depth = island.kind === 'tiny'
      ? Math.max(2, Math.round((2 + island.radius * 0.45 * (1 - t) ** 1.5) * jag))
      : Math.round((12 + island.radius * 0.28 * (1 - t) ** 1.4) * jag);
    const yBottom = yTop - depth;
    const dirt = island.kind === 'tiny' ? 2
      : 3 + Math.floor(2 * (detail(x / 11 + 40, z / 11) + 1));
    top[index(x, z)] = yTop;
    bottom[index(x, z)] = yBottom;
    for (let y = yBottom; y <= yTop; y++) {
      world.setBlock(x, y, z, y === yTop ? BLOCK.GRASS : y > yTop - dirt ? BLOCK.DIRT : BLOCK.STONE);
    }
  }
  return { ...island, x0, z0, width, top, bottom, getTop, getBottom,
    bounds: { x0, z0, x1: x0 + width - 1, z1: z0 + width - 1 } };
}

// Winding root tunnels with tapering branches and occasional round chambers.
function carveCaves(world, terrain, rand, noise3, nearKeep, caveArea) {
  const { radius, x: cx, z: cz, getTop, getBottom, bounds } = terrain;
  const inside = (x, y, z, shell = EDGE_SHELL) => {
    if (x < bounds.x0 + shell || z < bounds.z0 + shell
      || x > bounds.x1 - shell || z > bounds.z1 - shell) return false;
    for (const [dx, dz] of [[0, 0], [shell, 0], [-shell, 0], [0, shell], [0, -shell]]) {
      const surface = getTop(x + dx, z + dz), floor = getBottom(x + dx, z + dz);
      if (surface === -32768 || y < floor + shell || y > surface - shell) return false;
    }
    return true;
  };
  const ball = (px, py, pz, r, entrance = false) => {
    for (let z = Math.floor(pz - r); z <= Math.ceil(pz + r); z++)
      for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        if (x < bounds.x0 || z < bounds.z0 || x > bounds.x1 || z > bounds.z1 || nearKeep(x, z)) continue;
        for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
          if ((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2 > r * r) continue;
          if (!entrance && !inside(x, y, z)) continue;
          if (world.getBlock(x, y, z) !== BLOCK.AIR) world.setBlock(x, y, z, BLOCK.AIR);
        }
      }
  };
  const branch = (start, yaw, pitch, length, r, generation) => {
    let { x, y, z } = start;
    const track = rand() * 1000;
    let connected = generation > 0;
    const splitSteps = generation === 0
      ? [Math.floor(length * 0.31), Math.floor(length * 0.68)]
      : generation === 1 ? [Math.floor(length * 0.53)] : [];
    for (let step = 0; step < length; step++) {
      const t = step / length;
      const rr = Math.max(1.1, r * (1 - 0.58 * t)) * (0.9 + 0.12 * noise3(step * 0.08, track, 80));
      const opening = generation === 0 && !connected && step < 48;
      ball(x, y, z, rr, opening);
      if (opening && step >= 8 && inside(Math.floor(x), Math.floor(y), Math.floor(z), Math.ceil(rr + EDGE_SHELL + 1))) connected = true;
      if (splitSteps.includes(step)) {
        ball(x, y, z, rr * (1.7 + rand() * 0.65));
        branch({ x, y, z }, yaw + (rand() < 0.5 ? -1 : 1) * (0.65 + rand() * 0.75),
          -0.2 - rand() * 0.15, Math.floor(length * (generation === 0 ? 0.66 : 0.6)), rr * 0.72, generation + 1);
      }
      if (step === Math.floor(length * 0.83) && rand() < 0.3) ball(x, y, z, rr * 1.8);
      yaw += noise3(step * 0.045, track, 0) * 0.13 + Math.sin(step * 0.075 + track) * 0.025;
      pitch = clamp(pitch * 0.94 + noise3(step * 0.05, track, 30) * 0.03 - 0.01, -0.58, 0.17);
      x += Math.cos(yaw) * 0.9;
      z += Math.sin(yaw) * 0.9;
      y += Math.sin(pitch) * 0.9;
      if (!inside(Math.floor(x), Math.floor(y), Math.floor(z), 1) && step > (generation === 0 ? 15 : 3)) break;
    }
  };
  const count = Math.max(3, Math.round(Math.PI * radius * radius / caveArea));
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = rand() * Math.PI * 2;
      const cliff = rand() < 0.3;
      let distance = radius * (0.12 + rand() * 0.63);
      if (cliff) {
        for (let d = 1; d < radius + 10; d++) {
          if (getTop(Math.floor(cx + Math.cos(angle) * d), Math.floor(cz + Math.sin(angle) * d)) === -32768) break;
          distance = d;
        }
      }
      const x = Math.floor(cx + Math.cos(angle) * distance);
      const z = Math.floor(cz + Math.sin(angle) * distance);
      const surface = getTop(x, z);
      if (surface === -32768 || nearKeep(x, z)) continue;
      const y = cliff ? Math.round((surface + getBottom(x, z)) / 2) : surface - 1;
      const yaw = angle + Math.PI + (cliff ? 0 : (rand() - 0.5) * 1.6);
      branch({ x, y, z }, yaw, cliff ? -0.12 : -0.55,
        105 + Math.floor(rand() * 85), 2.8 + rand() * 1.2, 0);
      break;
    }
  }
}

function addPonds(world, terrain, rand, noise, nearKeep, pondArea) {
  const { radius, x: ix, z: iz, getTop } = terrain;
  const tiny = terrain.kind === 'tiny';
  const count = tiny ? (radius >= 10 && rand() < 0.35 ? 1 : 0)
    : Math.max(6, Math.round(radius * radius / pondArea));
  for (let i = 0; i < count; i++) for (let attempt = 0; attempt < 40; attempt++) {
    const angle = rand() * Math.PI * 2, distance = Math.sqrt(rand()) * radius * (tiny ? 0.3 : 0.72);
    const cx = Math.floor(ix + Math.cos(angle) * distance);
    const cz = Math.floor(iz + Math.sin(angle) * distance);
    const r = tiny ? 1.7 + rand() * 1.3 : 4 + rand() * 5;
    const reach = Math.ceil(r + (tiny ? 1 : 3));
    if (nearKeep(cx, cz)) continue;
    const cells = [];
    let level = Infinity, highest = -Infinity, valid = true;
    for (let dz = -reach; dz <= reach && valid; dz++) for (let dx = -reach; dx <= reach && valid; dx++) {
      const x = cx + dx, z = cz + dz, top = getTop(x, z);
      if (top === -32768 || world.getBlock(x, top, z) !== BLOCK.GRASS || nearKeep(x, z)) { valid = false; break; }
      level = Math.min(level, top);
      if (Math.hypot(dx, dz) < r * (1 + 0.15 * noise(x / 4, z / 4))) {
        cells.push({ x, z, top });
        highest = Math.max(highest, top);
      }
    }
    if (!valid || highest - level > (tiny ? 2 : 6)
      || cells.some(({ x, z }) => !isSolid(world.getBlock(x, level - (tiny ? 1 : 3), z)))) continue;
    for (const { x, z, top } of cells) {
      for (let y = level; y <= top + 2; y++) world.setBlock(x, y, z, BLOCK.AIR);
      world.setBlock(x, level, z, BLOCK.WATER);
    }
    sandShores(world, noise, cx - reach - 3, cz - reach - 3,
      cx + reach + 3, cz + reach + 3, getTop);
    break;
  }
}

export function generateIslandWorld(seed, teamCount, config) {
  const plan = planIslands(seed, teamCount, config);
  const { islands, keeps } = plan;
  const extent = Math.max(...islands.map((island) => Math.max(Math.abs(island.x), Math.abs(island.z)) + island.radius));
  const width = Math.ceil((2 * (extent + config.worldMargin)) / CHUNK_SIZE) * CHUNK_SIZE;
  const origin = width / 2;
  for (const island of islands) { island.x += origin; island.z += origin; }
  for (const keep of keeps) { keep.cx += origin; keep.cz += origin; }
  const lowest = Math.min(...islands.map((island) => island.bottomY));
  const highest = Math.max(...islands.map((island) => island.topY));
  const world = new World(seed, width, width, { sizeY: Math.ceil(highest + 20), minY: Math.floor(lowest - 20) });
  world.islands = islands.map(({ x, z, radius, surfaceY, topY, bottomY, kind, teamIndex, tinyGroup }) =>
    ({ x, z, radius, surfaceY, topY, bottomY, kind, teamIndex, tinyGroup }));
  const noise = createNoise2D(mulberry32(seed ^ 0x68e31da4));
  const detail = createNoise2D(mulberry32(seed ^ 0xb742c35e));
  const noise3 = createNoise3D(mulberry32(seed ^ 0x1b873593));
  const nearKeep = (x, z) => keeps.some((site) =>
    Math.abs(x - site.cx) <= KEEP_CLEARANCE && Math.abs(z - site.cz) <= KEEP_CLEARANCE);
  const terrains = islands.map((island, index) => terrainFor(world, { ...island, index }, noise, detail));
  for (const terrain of terrains) {
    if (terrain.kind === 'tiny') continue;
    const rand = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x79b9d7f3));
    carveCaves(world, terrain, rand, noise3, nearKeep, config.caveArea);
  }

  // One pass over the terrain's chunks keeps ore cost linear in world blocks.
  for (const chunk of world.chunks.values()) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lz = 0; lz < CHUNK_SIZE; lz++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      if (chunk.get(lx, ly, lz) !== BLOCK.STONE) continue;
      const x = chunk.cx * CHUNK_SIZE + lx, y = chunk.cy * CHUNK_SIZE + ly, z = chunk.cz * CHUNK_SIZE + lz;
      const exposed = HORIZONTAL.some(([dx, dz]) => world.getBlock(x + dx, y, z + dz) === BLOCK.AIR)
        || world.getBlock(x, y - 1, z) === BLOCK.AIR || world.getBlock(x, y + 1, z) === BLOCK.AIR;
      if (noise3(x / 5 + 2000, y / 5, z / 5 + 2000) > (exposed ? 0.69 : 0.83)) {
        world.setBlock(x, y, z, BLOCK.IRON_ORE);
      }
    }
  }

  world.keeps = keeps.map((site) => {
    const terrain = terrains[islands.indexOf(site.island)];
    const floorY = clamp(terrain.getTop(site.cx, site.cz), world.minY + 5, world.sizeY - KEEP_HEIGHT - 3);
    const keep = { cx: site.cx, cz: site.cz, floorY };
    buildKeep(world, keep, { fillDepth: 20, clearTo: world.sizeY });
    return keep;
  });
  for (const terrain of terrains) {
    const rand = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x68bc21eb));
    addPonds(world, terrain, rand, noise, nearKeep, config.pondArea);
    plantTrees(world, seed ^ Math.imul(terrain.index + 1, 0x5bd1e995),
      { requireFooting: true, bounds: terrain.bounds, surfaceAt: terrain.getTop });
  }
  return world;
}
