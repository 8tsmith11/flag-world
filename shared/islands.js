// Seeded island planning and terrain. The complete island/keep layout is
// chosen before any blocks are written, so spacing does not depend on order.
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { BLOCK, isSolid } from './blocks.js';
import { World } from './world.js';
import { CHUNK_SIZE, KEEP_HEIGHT, CENTRAL_EXTRA_DEPTH, VOID_BELOW_LOWEST_ISLAND,
  EEL_BAND } from './config.js';
import { mulberry32, KEEP_REACH, buildKeep, plantTrees, sandShores, surfaceStats, growTree } from './structures.js';
import { generateStructures } from './worldStructures.js';
import { placeQuarries } from './quarryPlacement.js';
import { planGoblinFortress, buildGoblinFortress, nearFortress } from './goblinFortressGen.js';
import { generateRivers } from './rivers.js';
import { biomeWeights, biomeParameters, surfaceBiome, biomeCode } from './biomes.js';
import { BIOME_SETTINGS } from './config.js';

const EDGE_SHELL = 3;
const KEEP_CLEARANCE = KEEP_REACH + 6;
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Tiny islands hang a tapered, root-like stone underside about this many
// radii deep below their surface.
const TINY_ROOT_DEPTH = 0.6;
const tinyDepth = (radius) => 1.5 + radius * TINY_ROOT_DEPTH;

function islandBounds(kind, radius, surfaceY) {
  if (kind === 'tiny') {
    return { topY: Math.ceil(surfaceY + 3),
      bottomY: Math.floor(surfaceY - 2 - tinyDepth(radius) * 1.35) };
  }
  return { topY: Math.ceil(surfaceY + 24),
    bottomY: Math.floor(surfaceY - 24 - (12 + radius * 0.28 + (kind === 'center' ? CENTRAL_EXTRA_DEPTH : 0)) * 1.1) };
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
  const tinyPlacementStats = { requested: totalTiny, placed: 0, failedByGroup: [0, 0, 0, 0],
    rejectedKeep: 0, rejectedOverlap: 0 };
  const mainIslands = islands.slice(0, teamCount + 1);
  const lowestMainBottom = Math.min(...mainIslands.map((entry) => entry.bottomY));
  const stackedDirections = Array.from({ length: counts[3] }, (_, index) =>
    index < Math.round(counts[3] * 0.7));
  for (let index = stackedDirections.length - 1; index > 0; index--) {
    const other = Math.floor(rand() * (index + 1));
    [stackedDirections[index], stackedDirections[other]] =
      [stackedDirections[other], stackedDirections[index]];
  }
  for (let category = 0; category < counts.length; category++) {
    for (let i = 0; i < counts[category]; i++) {
      let placed = false;
      for (let attempt = 0; attempt < config.placementAttempts; attempt++) {
        // Four out of five keep the old size range; the rest can be a little broader.
        const larger = rand() < 0.2;
        const minRadius = larger ? config.tinyRadius[1] + 1 : config.tinyRadius[0];
        const maxRadius = config.tinyRadius[larger ? 2 : 1];
        const radius = minRadius + Math.floor(rand() * (maxRadius - minRadius + 1));
        const spread = attempt < config.placementAttempts / 2 ? 0.65 : 2.5;
        const angle = (i + (rand() - 0.5) * spread) * Math.PI * 2 / counts[category];
        let x, z, surfaceY, stackedOn = null, stackAbove = null, stackOffset = 0;
        if (category === 0) {
          const distance = config.centralRadius + radius + config.islandSpacing
            + Math.sqrt(rand()) * config.centerRingWidth;
          x = Math.cos(angle) * distance;
          z = Math.sin(angle) * distance;
        } else if (category === 1 && teamCount > 0) {
          const teamIndex = i % teamCount;
          const team = islands[1 + teamIndex];
          const teamSlot = Math.floor(i / teamCount);
          const teamTotal = Math.ceil((counts[category] - teamIndex) / teamCount);
          const teamAngle = (teamSlot + (rand() - 0.5) * spread) * Math.PI * 2 / teamTotal;
          const distance = team.radius + radius + config.islandSpacing
            + Math.sqrt(rand()) * config.teamRingWidth;
          x = team.x + Math.cos(teamAngle) * distance;
          z = team.z + Math.sin(teamAngle) * distance;
        } else if (category === 3) {
          stackedOn = rand() < 0.6 ? 0 : 1 + Math.floor(rand() * teamCount);
          const big = islands[stackedOn];
          const distance = Math.sqrt(rand()) * big.radius * 0.75;
          x = big.x + Math.cos(angle) * distance;
          z = big.z + Math.sin(angle) * distance;
          stackAbove = stackedDirections[i];
          stackOffset = Math.floor(rand() * (config.tinyStackOffset + 1));
          surfaceY = stackAbove
            ? big.topY + 25 + stackOffset + Math.ceil(2 + tinyDepth(radius) * 1.35)
            : big.bottomY - 15 - stackOffset - 3;
        } else {
          const distance = teamDistance + config.teamRadius + config.islandSpacing
            + Math.sqrt(rand()) * config.outerReach;
          x = Math.cos(angle) * distance;
          z = Math.sin(angle) * distance;
        }
        if (surfaceY === undefined) {
          const nearest = mainIslands.reduce((best, entry) =>
            Math.hypot(x - entry.x, z - entry.z) < Math.hypot(x - best.x, z - best.z)
              ? entry : best, mainIslands[0]);
          surfaceY = rand() < 0.8
            ? nearest.surfaceY + (rand() + rand() - 1) * 15
            : config.centralSurfaceY - 25 + rand() * (config.teamHeightOffset + 65);
        }
        let tiny = island('tiny', x, z, radius, Math.round(surfaceY),
          { tinyGroup: category, stackedOn, stackAbove, stackOffset });
        if (tiny.bottomY < lowestMainBottom - 30) {
          tiny = island('tiny', x, z, radius,
            tiny.surfaceY + lowestMainBottom - 30 - tiny.bottomY,
            { tinyGroup: category, stackedOn, stackAbove, stackOffset });
        }
        if (keeps.some((keep) => Math.hypot(tiny.x - keep.cx, tiny.z - keep.cz)
          < tiny.radius + KEEP_REACH + config.tinyKeepClearance)) {
          tinyPlacementStats.rejectedKeep++;
          continue;
        }
        if (islands.some((other) => {
          const close = Math.hypot(tiny.x - other.x, tiny.z - other.z)
            < tiny.radius + other.radius + config.islandSpacing;
          const separated = tiny.bottomY >= other.topY + config.verticalClearance
            || other.bottomY >= tiny.topY + config.verticalClearance;
          return close && !separated;
        })) {
          tinyPlacementStats.rejectedOverlap++;
          continue;
        }
        islands.push(tiny);
        tinyPlacementStats.placed++;
        placed = true;
        break;
      }
      if (!placed) tinyPlacementStats.failedByGroup[category]++;
    }
  }
  return { islands, keeps, rand, tinyPlacementStats };
}

// Tiny islands: an irregular, lobed outline, a gently uneven grass surface,
// and an underside that tapers from about TINY_ROOT_DEPTH radii at the middle
// to a thin rim, with root-like spurs hanging lower here and there.
function tinyColumn(island, x, z, noise, detail) {
  const phase = island.index * 37;
  const dx = x + 0.5 - island.x, dz = z + 0.5 - island.z;
  const angle = Math.atan2(dz, dx);
  const c = Math.cos(angle), s = Math.sin(angle);
  const edge = island.radius * (0.84 + 0.2 * noise(c * 1.3 + phase, s * 1.3 + phase)
    + 0.1 * noise(c * 3.2 + phase + 40, s * 3.2 + phase + 40)) + 0.7 * detail(x / 4, z / 4);
  const distance = Math.hypot(dx, dz);
  if (distance >= edge) return null;
  const t = distance / edge;
  const yTop = Math.round(island.surfaceY + (1.2 * noise(x / 6 + phase, z / 6) + 0.6 * detail(x / 4, z / 4)) * (1 - 0.5 * t * t));
  const spur = Math.max(0, detail(x / 2.5 + 300, z / 2.5 + 300) - 0.35) * island.radius * 0.45 * (1 - t);
  const jag = 0.85 + 0.25 * detail(x / 5 + 100, z / 5 + 100);
  const depth = Math.max(2, Math.round((1.5 + island.radius * TINY_ROOT_DEPTH * (1 - t) ** 1.6 + spur) * jag));
  return { yTop, yBottom: yTop - depth };
}

function terrainColumn(island, x, z, noise, detail) {
  if (island.kind === 'tiny') return tinyColumn(island, x, z, noise, detail);
  const phase = island.index * 37;
  const dx = x + 0.5 - island.x, dz = z + 0.5 - island.z;
  const angle = Math.atan2(dz, dx);
  const edge = island.radius * (0.90 + 0.095
    * noise(Math.cos(angle) * 1.9 + 71 + phase, Math.sin(angle) * 1.9 + 71 + phase))
    + Math.min(5, island.radius * 0.08) * detail(x / 9, z / 9);
  const distance = Math.hypot(dx, dz);
  if (distance >= edge) return null;
  const t = distance / edge;
  const weights = biomeWeights(island.kind, x, z, (bx, bz) => noise(bx + 800, bz - 600));
  const biome = biomeParameters(weights);
  const hill = biome.hill * (noise(x / 48, z / 48) + 0.35 * detail(x / 17, z / 17)
    + 0.3 * noise(x / 105 + 200, z / 105 + 200));
  const yTop = Math.round(island.surfaceY + biome.offset + hill * (1 - t * t));
  const jag = 0.78 + 0.32 * detail(x / 7 + 100, z / 7 + 100);
  const depth = Math.round((12 + island.radius * 0.28 * (1 - t) ** 1.4
    + (island.kind === 'center' ? CENTRAL_EXTRA_DEPTH * (1 - t) ** 1.3 : 0)) * jag);
  return { yTop, yBottom: yTop - depth, weights };
}

function alignStackedTiny(islands, noise, detail) {
  const lowestMainBottom = Math.min(...islands.filter((entry) => entry.kind !== 'tiny')
    .map((entry) => entry.bottomY));
  islands.forEach((tiny, index) => {
    if (tiny.stackedOn === null || tiny.kind !== 'tiny') return;
    const big = { ...islands[tiny.stackedOn], index: tiny.stackedOn };
    const small = { ...tiny, index };
    let above = tiny.stackAbove;
    for (let pass = 0; pass < 2; pass++) {
      let shift = above ? -Infinity : Infinity;
      for (let z = tiny.z - tiny.radius; z <= tiny.z + tiny.radius; z++) {
        for (let x = tiny.x - tiny.radius; x <= tiny.x + tiny.radius; x++) {
          const tinyColumn = terrainColumn(small, x, z, noise, detail);
          const bigColumn = terrainColumn(big, x, z, noise, detail);
          if (!tinyColumn || !bigColumn) continue;
          if (above) shift = Math.max(shift,
            bigColumn.yTop + 25 + tiny.stackOffset - tinyColumn.yBottom);
          else shift = Math.min(shift,
            bigColumn.yBottom - 15 - tiny.stackOffset - tinyColumn.yTop);
        }
      }
      if (!Number.isFinite(shift)) break;
      const surfaceY = tiny.surfaceY + shift;
      const bounds = islandBounds('tiny', tiny.radius, surfaceY);
      if (!above && bounds.bottomY < lowestMainBottom - 30) {
        above = true;
        continue;
      }
      Object.assign(tiny, { surfaceY, ...bounds, stackAbove: above });
      break;
    }
  });
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
  for (let z = z0; z < z0 + width; z++) for (let x = x0; x < x0 + width; x++) {
    const column = terrainColumn(island, x, z, noise, detail);
    if (!column) continue;
    const { yTop, yBottom } = column;
    const weights = island.kind === 'tiny'
      ? { plains: 0, forest: 0, mountains: 0, swamp: 0, [island.biomeOverride ?? 'forest']: 1 }
      : column.weights;
    const biome = surfaceBiome(weights, x, z, detail);
    world.biomeCodes[x + world.sizeX * z] = biomeCode(biome);
    const dirt = island.kind === 'tiny' ? 2
      : 3 + Math.floor(2 * (detail(x / 11 + 40, z / 11) + 1));
    top[index(x, z)] = yTop;
    bottom[index(x, z)] = yBottom;
    world.recordNaturalTerrain(x, z, yBottom, yTop);
    for (let y = yBottom; y <= yTop; y++) {
      const snowy = biome === 'mountains' && yTop >= island.surfaceY + BIOME_SETTINGS.snowHeight;
      world.setBlock(x, y, z, y === yTop ? (snowy ? BLOCK.SNOW : BLOCK.GRASS)
        : y > yTop - dirt ? BLOCK.DIRT : BLOCK.STONE);
    }
  }
  if (island.kind !== 'tiny') {
    for (let z = z0; z < z0 + width; z++) for (let x = x0; x < x0 + width; x++) {
      const y = getTop(x, z);
      if (y === -32768 || world.biomeAt(x, z) !== 'mountains') continue;
      const slope = Math.max(...HORIZONTAL.map(([dx, dz]) => Math.abs(y - getTop(x + dx, z + dz))));
      if (slope < BIOME_SETTINGS.cliffSlope) continue;
      for (let yy = y; yy >= y - 3; yy--) {
        if (world.getBlock(x, yy, z) === BLOCK.GRASS || world.getBlock(x, yy, z) === BLOCK.DIRT
          || world.getBlock(x, yy, z) === BLOCK.SNOW) world.setBlock(x, yy, z, BLOCK.STONE);
      }
    }
  }
  return { ...island, x0, z0, width, top, bottom, getTop, getBottom,
    bounds: { x0, z0, x1: x0 + width - 1, z1: z0 + width - 1 } };
}

// Winding root tunnels with tapering branches and occasional round chambers.
// `reserved(x, y, z)`: blocks caves must leave alone (the Goblin Fortress).
function carveCaves(world, terrain, rand, noise3, nearKeep, caveArea, reserved = () => false) {
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
          if (reserved(x, y, z)) continue;
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

// Ponds on the main islands (tiny islands have none).
function addPonds(world, terrain, rand, noise, nearKeep, pondArea) {
  const { radius, x: ix, z: iz, getTop } = terrain;
  const tiny = terrain.kind === 'tiny';
  const count = tiny ? 0 : Math.max(6, Math.round(radius * radius / pondArea))
    * (terrain.kind === 'center' ? BIOME_SETTINGS.swampPondScale : 1);
  for (let i = 0; i < count; i++) for (let attempt = 0; attempt < 40; attempt++) {
    const angle = rand() * Math.PI * 2, distance = Math.sqrt(rand()) * radius * (tiny ? 0.3 : 0.72);
    const cx = Math.floor(ix + Math.cos(angle) * distance);
    const cz = Math.floor(iz + Math.sin(angle) * distance);
    const swamp = world.biomeAt(cx, cz) === 'swamp';
    if (terrain.kind === 'center' && !swamp && rand() < 0.65) continue;
    const r = tiny ? 1.7 + rand() * 1.3 : 4 + rand() * 5;
    const reach = Math.ceil(r + (tiny ? 1 : 3)
      + (swamp ? BIOME_SETTINGS.waterRimClearance : 0));
    if (nearKeep(cx, cz)) continue;
    const cells = [];
    let level = Infinity, highest = -Infinity, valid = true;
    for (let dz = -reach; dz <= reach && valid; dz++) for (let dx = -reach; dx <= reach && valid; dx++) {
      const x = cx + dx, z = cz + dz, top = getTop(x, z);
      if (top === -32768 || world.getBlock(x, top, z) !== BLOCK.GRASS || nearKeep(x, z)) { valid = false; break; }
      level = Math.min(level, top);
      if (Math.hypot(dx, dz) < r * (1 + 0.15 * noise(x / 4, z / 4))
        && !(swamp && noise(x / 3 + 200, z / 3 - 100) > 0.55)) {
        cells.push({ x, z, top });
        highest = Math.max(highest, top);
      }
    }
    if (!valid || highest - level > (tiny ? 2 : 6)
      || cells.some(({ x, z }) => !isSolid(world.getBlock(x, level - (tiny ? 1 : 3), z)))) continue;
    const waterDepth = swamp ? BIOME_SETTINGS.swampWaterDepth[0]
      + Math.floor(rand() * (BIOME_SETTINGS.swampWaterDepth[1] - BIOME_SETTINGS.swampWaterDepth[0] + 1)) : 1;
    const pondCells = new Set(cells.map(({ x, z }) => `${x},${z}`));
    for (const { x, z, top } of cells) {
      for (let y = level; y <= top + 2; y++) world.setBlock(x, y, z, BLOCK.AIR);
      for (let y = level - 3; y < level - waterDepth; y++) {
        if (world.getBlock(x, y, z) === BLOCK.AIR) world.setBlock(x, y, z, BLOCK.STONE);
      }
      if (waterDepth > 1) world.setBlock(x, level - 1, z, BLOCK.WATER);
      world.setBlock(x, level, z, BLOCK.WATER);
      for (const [dx, dz] of HORIZONTAL) {
        const bx = x + dx, bz = z + dz;
        if (pondCells.has(`${bx},${bz}`)) continue;
        for (let y = level - waterDepth; y <= level; y++) {
          if (world.getBlock(bx, y, bz) === BLOCK.AIR) world.setBlock(bx, y, bz, BLOCK.DIRT);
        }
      }
    }
    sandShores(world, noise, cx - reach - 3, cz - reach - 3,
      cx + reach + 3, cz + reach + 3, getTop);
    break;
  }
}

// What each tiny island holds, at most one: a dragon roost (big enough ones,
// by chance, up to the size's cap), else by chance a loose chest, else nothing.
function chooseTinyContents(islands, seed, config) {
  const rand = mulberry32(seed ^ 0x3e0f5a21);
  let roosts = 0;
  for (const island of islands) {
    if (island.kind !== 'tiny') continue;
    const roll = rand(), chestRoll = rand();
    if (island.radius >= config.roosts.minRadius && roosts < config.roosts.max && roll < config.roosts.chance) {
      island.content = 'roost';
      roosts++;
    } else island.content = chestRoll < config.structures.tinyChance ? 'chest' : 'plain';
  }
}

// 1-2 trees near the middle of a tiny island big enough to hold them.
function plantTinyTrees(world, terrain, rand, { minRadius, count }) {
  if (terrain.radius < minRadius || terrain.content === 'roost') return;
  const trees = count[0] + Math.floor(rand() * (count[1] - count[0] + 1));
  for (let planted = 0, attempt = 0; planted < trees && attempt < 30; attempt++) {
    const angle = rand() * Math.PI * 2, distance = rand() * terrain.radius * 0.45;
    const trunk = 4 + Math.floor(rand() * 2);
    const x = Math.round(terrain.x + Math.cos(angle) * distance);
    const z = Math.round(terrain.z + Math.sin(angle) * distance);
    const ground = terrain.getTop(x, z);
    if (ground === -32768 || world.getBlock(x, ground, z) !== BLOCK.GRASS) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !isSolid(world.getBlock(x + dx, ground, z + dz)))) continue;
    if ([[2, 0], [-2, 0], [0, 2], [0, -2], [0, 0]].some(([dx, dz]) =>
      world.getBlock(x + dx, ground + trunk - 1, z + dz) !== BLOCK.AIR)) continue;
    growTree(world, x, ground, z, ground + trunk);
    planted++;
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
  const noise = createNoise2D(mulberry32(seed ^ 0x68e31da4));
  const detail = createNoise2D(mulberry32(seed ^ 0xb742c35e));
  for (const tiny of islands.filter((entry) => entry.kind === 'tiny')) {
    const nearest = islands.filter((entry) => entry.kind !== 'tiny').reduce((best, entry) =>
      Math.hypot(tiny.x - entry.x, tiny.z - entry.z) < Math.hypot(tiny.x - best.x, tiny.z - best.z)
        ? entry : best);
    const far = Math.hypot(tiny.x - nearest.x, tiny.z - nearest.z) > nearest.radius + config.gap;
    const weights = biomeWeights(far ? 'tinyFar' : nearest.kind, tiny.x, tiny.z,
      (bx, bz) => noise(bx + 800, bz - 600));
    tiny.biomeOverride = Object.keys(weights).sort((a, b) => weights[b] - weights[a])[0];
  }
  alignStackedTiny(islands, noise, detail);
  chooseTinyContents(islands, seed, config);
  const lowest = Math.min(...islands.map((island) => island.bottomY));
  const highest = Math.max(...islands.map((island) => island.topY));
  const highestTeamSurface = Math.max(config.centralSurfaceY,
    ...islands.filter((island) => island.kind === 'team').map((island) => island.surfaceY));
  const world = new World(seed, width, width, {
    sizeY: Math.ceil(Math.max(highest + 20, highestTeamSurface + 121)),
    minY: Math.floor(lowest - Math.max(VOID_BELOW_LOWEST_ISLAND,
      EEL_BAND.belowIsland + EEL_BAND.aboveVoid + EEL_BAND.minHeight)),
  });
  world.tinyPlacementStats = plan.tinyPlacementStats;
  world.islands = islands.map(({ x, z, radius, surfaceY, topY, bottomY,
    kind, teamIndex, tinyGroup, stackedOn, stackAbove, content, biomeOverride }) =>
    ({ x, z, radius, surfaceY, topY, bottomY, kind, teamIndex, tinyGroup, stackedOn, stackAbove,
      biomeOverride, content: content ?? null }));
  const noise3 = createNoise3D(mulberry32(seed ^ 0x1b873593));
  const nearKeep = (x, z) => keeps.some((site) =>
    Math.abs(x - site.cx) <= KEEP_CLEARANCE && Math.abs(z - site.cz) <= KEEP_CLEARANCE);
  const terrains = islands.map((island, index) => terrainFor(world, { ...island, index }, noise, detail));
  for (const terrain of terrains) {
    let actualTop = -Infinity, actualBottom = Infinity;
    for (let i = 0; i < terrain.top.length; i++) {
      if (terrain.top[i] === -32768) continue;
      actualTop = Math.max(actualTop, terrain.top[i]);
      actualBottom = Math.min(actualBottom, terrain.bottom[i]);
    }
    if (Number.isFinite(actualTop)) {
      terrain.topY = actualTop; terrain.bottomY = actualBottom;
      world.islands[terrain.index].topY = actualTop;
      world.islands[terrain.index].bottomY = actualBottom;
    }
  }
  const actualLowest = Math.min(...world.islands.map((entry) => entry.bottomY));
  world.voidY = actualLowest - Math.max(VOID_BELOW_LOWEST_ISLAND,
    EEL_BAND.belowIsland + EEL_BAND.aboveVoid + EEL_BAND.minHeight);
  for (const site of keeps) {
    const terrain = terrains[islands.indexOf(site.island)];
    let best = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = plan.rand() * Math.PI * 2;
      const distance = Math.sqrt(plan.rand()) * Math.min(14, terrain.radius * 0.3);
      const cx = attempt === 0 ? site.cx : Math.round(site.cx + Math.cos(angle) * distance);
      const cz = attempt === 0 ? site.cz : Math.round(site.cz + Math.sin(angle) * distance);
      const stats = surfaceStats(terrain.getTop, cx - 3, cz - 3, cx + 3, cz + 3);
      if (!stats) continue;
      if (!best || stats.variance < best.stats.variance) best = { cx, cz, stats };
      if (stats.variance <= 3) break;
    }
    if (best) { site.cx = best.cx; site.cz = best.cz; }
  }
  // The Goblin Fortress: planned before the caves so they go around it.
  const fortressPlan = planGoblinFortress(world, terrains.find((terrain) => terrain.kind === 'center'), seed);
  world.goblinFortress = null;
  for (const terrain of terrains) {
    if (terrain.kind === 'tiny') continue;
    const rand = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x79b9d7f3));
    carveCaves(world, terrain, rand, noise3, nearKeep, config.caveArea,
      terrain.kind === 'center' ? (x, y, z) => nearFortress(fortressPlan, x, y, z) : undefined);
  }
  if (fortressPlan) buildGoblinFortress(world, fortressPlan);

  // One pass over the terrain's chunks keeps ore cost linear in world blocks.
  for (const chunk of world.chunks.values()) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lz = 0; lz < CHUNK_SIZE; lz++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      if (chunk.get(lx, ly, lz) !== BLOCK.STONE) continue;
      const x = chunk.cx * CHUNK_SIZE + lx, y = chunk.cy * CHUNK_SIZE + ly, z = chunk.cz * CHUNK_SIZE + lz;
      const exposed = HORIZONTAL.some(([dx, dz]) => world.getBlock(x + dx, y, z + dz) === BLOCK.AIR)
        || world.getBlock(x, y - 1, z) === BLOCK.AIR || world.getBlock(x, y + 1, z) === BLOCK.AIR;
      const threshold = exposed && world.biomeAt(x, z) === 'mountains'
        ? BIOME_SETTINGS.mountainOreThreshold : exposed ? 0.69 : 0.83;
      if (noise3(x / 5 + 2000, y / 5, z / 5 + 2000) > threshold) {
        world.setBlock(x, y, z, BLOCK.IRON_ORE);
      }
    }
  }

  world.keeps = keeps.map((site) => {
    const terrain = terrains[islands.indexOf(site.island)];
    const stats = surfaceStats(terrain.getTop, site.cx - 3, site.cz - 3, site.cx + 3, site.cz + 3);
    const floorY = clamp(stats?.median ?? terrain.getTop(site.cx, site.cz), world.minY + 5, world.sizeY - KEEP_HEIGHT - 3);
    const keep = { cx: site.cx, cz: site.cz, floorY };
    buildKeep(world, keep, { clearTo: world.sizeY, surfaceAt: terrain.getTop });
    return keep;
  });
  for (const terrain of terrains) {
    const rand = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x68bc21eb));
    addPonds(world, terrain, rand, noise, nearKeep, config.pondArea);
    if (terrain.kind === 'tiny') plantTinyTrees(world, terrain, rand, config.tinyTrees);
    else plantTrees(world, seed ^ Math.imul(terrain.index + 1, 0x5bd1e995),
      { requireFooting: true, bounds: terrain.bounds, surfaceAt: terrain.getTop });
  }
  generateRivers(world, terrains[0], seed, config.rivers);
  
  const fortressBoxes = fortressPlan ? fortressPlan.boxes : [];
  world.structures.push(...fortressBoxes.map((box) => ({ kind: 'goblinFortress', islandKind: 'center',
    teamIndex: null, x: Math.floor((box.x0 + box.x1) / 2), y: box.y0, z: Math.floor((box.z0 + box.z1) / 2), box })));
  generateStructures(world, terrains, config, seed, fortressBoxes);
  placeQuarries(world, terrains, seed, config.quarry);
  const fortressQuarry = world.goblinFortress?.modules.find((module) => module.feature?.kind === 'quarry')?.feature;
  if (fortressQuarry) world.quarries.push({ x: fortressQuarry.x, y: fortressQuarry.y, z: fortressQuarry.z });
  return world;
}
