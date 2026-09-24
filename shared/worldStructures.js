import { BLOCK, facedBlock, ladderBlock, doorBlock, isSolid } from './blocks.js';
import { KEEP_REACH, mulberry32, prepareSurface, surfaceStats } from './structures.js';
import { BIOME_SETTINGS } from './config.js';

const randInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const chestKey = (x, y, z) => `${x},${y},${z}`;

function weathered(random, block, essential = false) {
  if (!essential && random() < 0.15) return BLOCK.AIR;
  if (block !== BLOCK.STONE_BRICKS) return block;
  const roll = random();
  return roll < 0.13 ? BLOCK.MOSSY_STONE_BRICKS
    : roll < 0.26 ? BLOCK.CRACKED_STONE_BRICKS : block;
}

function placeChest(world, x, y, z, table, facing = 0) {
  world.setBlock(x, y, z, facedBlock(BLOCK.CHEST, facing));
  world.lootChests.set(chestKey(x, y, z), table);
}

function overlaps(world, placed, box) {
  if (world.riverColumns) {
    for (let z = box.z0 - 2; z <= box.z1 + 2; z++) {
      for (let x = box.x0 - 2; x <= box.x1 + 2; x++) {
        if (world.riverColumns.has(`${x},${z}`)) return true;
      }
    }
  }
  if (world.keeps.some((keep) => box.x0 <= keep.cx + KEEP_REACH + 2
    && box.x1 >= keep.cx - KEEP_REACH - 2
    && box.z0 <= keep.cz + KEEP_REACH + 2
    && box.z1 >= keep.cz - KEEP_REACH - 2)) return true;
  return placed.some((other) => box.x0 <= other.x1 + 2 && box.x1 >= other.x0 - 2
    && box.z0 <= other.z1 + 2 && box.z1 >= other.z0 - 2
    && box.y0 <= other.y1 + 2 && box.y1 >= other.y0 - 2);
}

function record(world, placed, kind, island, box) {
  placed.push(box);
  world.structures.push({ kind, islandKind: island.kind, teamIndex: island.teamIndex ?? null,
    x: Math.floor((box.x0 + box.x1) / 2), y: box.y0, z: Math.floor((box.z0 + box.z1) / 2), box: { ...box } });
}

function surfaceSite(world, terrain, placed, random, halfX, halfZ, height, maxVariance = 4,
  acceptsBiome = () => true) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * Math.max(1, terrain.radius - Math.max(halfX, halfZ) - 7);
    const x = Math.round(terrain.x + Math.cos(angle) * distance);
    const z = Math.round(terrain.z + Math.sin(angle) * distance);
    if (!acceptsBiome(world.biomeAt(x, z), random)) continue;
    const x0 = x - halfX, x1 = x + halfX, z0 = z - halfZ, z1 = z + halfZ;
    const stats = surfaceStats(terrain.getTop, x0, z0, x1, z1);
    if (!stats || stats.variance > maxVariance) continue;
    const floorY = stats.median;
    if (floorY + height >= world.sizeY) continue;
    const box = { x0, x1, z0, z1, y0: floorY, y1: floorY + height };
    if (overlaps(world, placed, box)) continue;
    if (world.getBlock(x, terrain.getTop(x, z), z) !== BLOCK.GRASS) continue;
    return { x, z, floorY, box };
  }
  return null;
}

function buildHouse(world, terrain, site, random) {
  const { x, z, floorY, box } = site;
  prepareSurface(world, box.x0, box.z0, box.x1, box.z1, floorY, terrain.getTop,
    { clearTo: floorY + 8 });
  for (let zz = box.z0; zz <= box.z1; zz++) for (let xx = box.x0; xx <= box.x1; xx++) {
    world.setBlock(xx, floorY, zz, xx === box.x0 || xx === box.x1 ? BLOCK.STONE_BRICKS : BLOCK.PLANKS);
    const edgeX = xx === box.x0 || xx === box.x1;
    const edgeZ = zz === box.z0 || zz === box.z1;
    if (!edgeX && !edgeZ) continue;
    for (let y = floorY + 1; y <= floorY + 3; y++) {
      const essential = (edgeX && edgeZ) || y === floorY + 1;
      const block = y === floorY + 1 ? BLOCK.STONE_BRICKS : BLOCK.PLANKS;
      world.setBlock(xx, y, zz, weathered(random, block, essential));
    }
  }
  for (let offset = -4; offset <= 4; offset++) {
    const roofY = floorY + 4 + (4 - Math.abs(offset));
    for (let zz = box.z0 - 1; zz <= box.z1 + 1; zz++) {
      world.setBlock(x + offset, roofY, zz, weathered(random, BLOCK.PLANKS, Math.abs(offset) === 4));
    }
  }
  world.setBlock(x, floorY + 1, box.z1, doorBlock(2, false, false));
  world.setBlock(x, floorY + 2, box.z1, doorBlock(2, false, true));
  placeChest(world, box.x0 + 1, floorY + 1, box.z0 + 1, 'house', 2);
}

function buildTower(world, terrain, site, random) {
  const { x, z, floorY, box } = site;
  const top = box.y1 - 1;
  prepareSurface(world, box.x0, box.z0, box.x1, box.z1, floorY, terrain.getTop,
    { clearTo: top + 3, foundation: BLOCK.STONE });
  for (let y = floorY; y <= top; y++) {
    for (let zz = box.z0; zz <= box.z1; zz++) for (let xx = box.x0; xx <= box.x1; xx++) {
      const edgeX = xx === box.x0 || xx === box.x1;
      const edgeZ = zz === box.z0 || zz === box.z1;
      const platform = y === floorY || y === top || (y - floorY) % 4 === 0;
      if (platform && !(xx === box.x1 - 1 && zz === z && y !== floorY)) {
        world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS, true));
      } else if (edgeX || edgeZ) {
        world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS,
          edgeX && edgeZ || y === floorY + 1));
      }
    }
    if (y > floorY && y < top) world.setBlock(box.x1 - 1, y, z, ladderBlock(1));
  }
  placeChest(world, x, top + 1, z, 'tower', 2);
}

function buildLooseChest(world, terrain, site, table, random) {
  const { x, z, floorY } = site;
  const buried = random() < 0.3;
  const y = floorY + (buried ? 0 : 1);
  if (buried) world.setBlock(x, floorY, z, BLOCK.AIR);
  placeChest(world, x, y, z, table, randInt(random, 0, 3));
}

// A dragon roost on a tiny island: a rough ring of logs and stone around the
// middle, low at its edges so it blends into the grass, with scorched ground
// inside and a little beyond, and the nest chest in the middle. Returns the
// nest spot (where the chest stands) and the box it covers, or null.
function buildRoost(world, terrain, random) {
  let cx = Math.round(terrain.x), cz = Math.round(terrain.z);
  for (let attempt = 0; terrain.getTop(cx, cz) === -32768 && attempt < 20; attempt++) {
    cx = Math.round(terrain.x + (random() - 0.5) * 4);
    cz = Math.round(terrain.z + (random() - 0.5) * 4);
  }
  const floor = terrain.getTop(cx, cz);
  if (floor === -32768) return null;
  const RING_IN = 2.6, RING_OUT = 4.3, SCORCH_OUT = 5.4;
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
    const x = cx + dx, z = cz + dz, top = terrain.getTop(x, z);
    if (top === -32768) continue;
    const d = Math.hypot(dx, dz) + (random() - 0.5) * 0.7;
    const soil = world.getBlock(x, top, z);
    if (d < RING_IN || (d < SCORCH_OUT && d >= RING_OUT && random() < 0.45)) {
      if (soil === BLOCK.GRASS || soil === BLOCK.DIRT) world.setBlock(x, top, z, BLOCK.SCORCHED_EARTH);
      for (let y = top + 1; y <= top + 4; y++) if (world.getBlock(x, y, z) !== BLOCK.AIR) world.setBlock(x, y, z, BLOCK.AIR);
    } else if (d < RING_OUT) {
      // Taller in the middle of the ring's band, one block at its rims.
      const height = Math.abs(d - (RING_IN + RING_OUT) / 2) < 0.55 && random() < 0.6 ? 2 : 1;
      for (let y = top + 1; y <= top + height; y++) {
        world.setBlock(x, y, z, random() < 0.6 ? BLOCK.WOOD : BLOCK.STONE);
      }
      if (random() < 0.5 && (soil === BLOCK.GRASS)) world.setBlock(x, top, z, BLOCK.DIRT);
    }
  }
  placeChest(world, cx, floor + 1, cz, 'roost', randInt(random, 0, 3));
  return { x: cx, y: floor + 1, z: cz,
    box: { x0: cx - 5, x1: cx + 5, z0: cz - 5, z1: cz + 5, y0: floor, y1: floor + 3 } };
}

// Crawler spawn points: `count` distinct cells of `cells` ([{ x, y, z }]
// feet positions) with two blocks of air and solid ground beneath.
function addCrawlers(world, random, cells, count) {
  const open = cells.filter(({ x, y, z }) => world.getBlock(x, y, z) === BLOCK.AIR
    && world.getBlock(x, y + 1, z) === BLOCK.AIR && isSolid(world.getBlock(x, y - 1, z)));
  for (let i = 0; i < count && open.length; i++) {
    world.mobSpawns.crawlers.push(open.splice(Math.floor(random() * open.length), 1)[0]);
  }
}

function caveFloor(world, terrain, random, requireRoom = false) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * terrain.radius * 0.8;
    const x = Math.round(terrain.x + Math.cos(angle) * distance);
    const z = Math.round(terrain.z + Math.sin(angle) * distance);
    const top = terrain.getTop(x, z), bottom = terrain.getBottom(x, z);
    if (top === -32768 || top - bottom < 14) continue;
    for (let y = top - 5; y >= bottom + 4; y--) {
      if (world.getBlock(x, y, z) !== BLOCK.AIR
        || !isSolid(world.getBlock(x, y - 1, z))
        || world.getBlock(x, y + 1, z) !== BLOCK.AIR) continue;
      if (!requireRoom || top >= y + 7 && bottom <= y - 3) return { x, y, z };
    }
  }
  return null;
}

function dungeonBox(terrain, x, y, z, half) {
  const box = { x0: x - half, x1: x + half, z0: z - half, z1: z + half,
    y0: y - 1, y1: y + 4 };
  for (const xx of [box.x0, box.x1]) for (const zz of [box.z0, box.z1]) {
    if (terrain.getTop(xx, zz) < y + 5 || terrain.getBottom(xx, zz) > y - 3) return null;
  }
  return box;
}

function buildDungeon(world, site, random, table) {
  const { x, y, z, box } = site;
  for (let zz = box.z0; zz <= box.z1; zz++) for (let xx = box.x0; xx <= box.x1; xx++) {
    for (let yy = y - 1; yy <= y + 4; yy++) {
      const edge = xx === box.x0 || xx === box.x1 || zz === box.z0 || zz === box.z1;
      const floorOrRoof = yy === y - 1 || yy === y + 4;
      world.setBlock(xx, yy, zz, edge || floorOrRoof
        ? weathered(random, BLOCK.STONE_BRICKS, true)
        : BLOCK.AIR);
    }
  }
  placeChest(world, x - 2, y, z - 2, table, 2);
  if (random() < 0.45) placeChest(world, x + 2, y, z + 2, table, 0);
}

function cliffBox(x, y, z, outX, outZ, balconyLength) {
  const sideX = -outZ, sideZ = outX;
  const corners = [];
  for (const depth of [-3, 3 + balconyLength]) for (const width of [-3, 3]) {
    corners.push({ x: x + outX * depth + sideX * width,
      z: z + outZ * depth + sideZ * width });
  }
  return { x0: Math.min(...corners.map((point) => point.x)),
    x1: Math.max(...corners.map((point) => point.x)),
    z0: Math.min(...corners.map((point) => point.z)),
    z1: Math.max(...corners.map((point) => point.z)), y0: y - 2, y1: y + 5 };
}

function buildCliffside(world, site, random) {
  const { x, y, z, outX, outZ, balconyLength } = site;
  const sideX = -outZ, sideZ = outX;
  const cell = (depth, width) => ({ x: x + outX * depth + sideX * width,
    z: z + outZ * depth + sideZ * width });
  for (let depth = -3; depth <= 3; depth++) for (let width = -3; width <= 3; width++) {
    const { x: xx, z: zz } = cell(depth, width);
    world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS, true));
    for (let yy = y + 1; yy <= y + 3; yy++) {
      const wall = depth === -3 || Math.abs(width) === 3;
      world.setBlock(xx, yy, zz, wall
        ? weathered(random, BLOCK.STONE_BRICKS, yy === y + 1 && depth === -3)
        : BLOCK.AIR);
    }
    if (depth <= 1) world.setBlock(xx, y + 4, zz,
      weathered(random, BLOCK.STONE_BRICKS, depth === -3));
    if (depth <= -1) for (let yy = y - 1; yy >= y - 3; yy--) {
      if (isSolid(world.getBlock(xx, yy, zz))) break;
      world.setBlock(xx, yy, zz, BLOCK.STONE);
    }
  }
  for (let depth = 4; depth <= 3 + balconyLength; depth++) for (let width = -2; width <= 2; width++) {
    const { x: xx, z: zz } = cell(depth, width);
    world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS, true));
    if (Math.abs(width) === 2 || depth === 3 + balconyLength) {
      world.setBlock(xx, y + 1, zz, weathered(random, BLOCK.STONE_BRICKS));
    }
    if (depth === 4 && Math.abs(width) === 2) {
      world.setBlock(xx, y - 1, zz, BLOCK.STONE_BRICKS);
      world.setBlock(xx, y - 2, zz, weathered(random, BLOCK.STONE_BRICKS));
    }
  }
  const first = cell(-1, -1);
  placeChest(world, first.x, y + 1, first.z, 'underside', 2);
  if (random() < 0.4) {
    const second = cell(2, 1);
    placeChest(world, second.x, y + 1, second.z, 'underside', 0);
  }
}

function buildHanging(world, site, random) {
  const { x, z, y, outX, outZ } = site;
  for (let zz = z - 3; zz <= z + 3; zz++) for (let xx = x - 3; xx <= x + 3; xx++) {
    world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS, true));
    const edge = xx === x - 3 || xx === x + 3 || zz === z - 3 || zz === z + 3;
    for (let yy = y + 1; yy <= y + 3; yy++) {
      world.setBlock(xx, yy, zz, edge
        ? weathered(random, BLOCK.STONE_BRICKS, yy === y + 1) : BLOCK.AIR);
    }
    world.setBlock(xx, y + 4, zz, weathered(random, BLOCK.STONE_BRICKS));
  }
  for (let depth = 4; depth <= 6; depth++) for (let width = -1; width <= 1; width++) {
    const xx = x + outX * depth - outZ * width;
    const zz = z + outZ * depth + outX * width;
    world.setBlock(xx, y, zz, weathered(random, BLOCK.STONE_BRICKS, true));
  }
  placeChest(world, x - 2, y + 1, z - 2, 'underside', 2);
  if (random() < 0.4) placeChest(world, x + 2, y + 1, z + 2, 'underside', 0);
}

// Structures, chests, dragon roosts (world.roosts) and Crawler spawn points
// (world.mobSpawns.crawlers), all seeded. Mob spawns use their own random
// stream so they don't move the structures.
export function generateStructures(world, terrains, config, seed) {
  const placed = [];
  const settings = config.structures;
  const crawlers = config.crawlers;
  world.roosts = [];
  world.mobSpawns = { crawlers: [] };
  for (const terrain of terrains) {
    const island = world.islands[terrain.index];
    const random = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x6c8e9cf5));
    const mobRandom = mulberry32(seed ^ Math.imul(terrain.index + 1, 0x2f6b1c3d));
    const crawlerCount = () => randInt(mobRandom, ...crawlers.perStructure);
    const central = terrain.kind === 'center';
    if (terrain.kind === 'tiny') {
      if (island.content === 'chest') {
        const site = surfaceSite(world, terrain, placed, random, 0, 0, 2, 2);
        if (site) {
          buildLooseChest(world, terrain, site, 'tinyIsland', random);
          record(world, placed, 'tinyChest', island, site.box);
        }
      } else if (island.content === 'roost') {
        const nest = buildRoost(world, terrain, random);
        if (nest) {
          record(world, placed, 'roost', island, nest.box);
          world.roosts.push({ x: nest.x, y: nest.y, z: nest.z, island: terrain.index });
        } else island.content = 'plain';
      }
      continue;
    }
    const addSurface = (kind, count, halfX, halfZ, height, build, acceptsBiome) => {
      for (let index = 0; index < count; index++) {
        const site = surfaceSite(world, terrain, placed, random, halfX, halfZ, height, 4, acceptsBiome);
        if (!site) continue;
        build(site);
        record(world, placed, kind, island, site.box);
      }
    };
    const houseCount = central ? settings.houseCentral
      : randInt(random, ...settings.houseTeam);
    addSurface('house', houseCount, 3, 3, 8,
      (site) => buildHouse(world, terrain, site, random),
      (biome) => biome === 'plains' || biome === 'forest');
    const towerCount = central ? settings.towerCentral : Number(random() < settings.towerTeamChance);
    addSurface('tower', towerCount, 2, 2, 19,
      (site) => {
        site.box.y1 = site.floorY + randInt(random, 12, 18) + 1;
        buildTower(world, terrain, site, random);
      }, (biome, random) => biome === 'mountains' || random() < BIOME_SETTINGS.towerOtherBiomeChance);
    const dungeonCount = central ? settings.dungeonCentral : settings.dungeonTeam;
    for (let index = 0; index < dungeonCount; index++) {
      let site = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const cell = caveFloor(world, terrain, random, true);
        if (!cell) break;
        const half = randInt(random, 4, 5);
        const box = dungeonBox(terrain, cell.x, cell.y, cell.z, half);
        if (!box || overlaps(world, placed, box)) continue;
        site = { ...cell, box };
        break;
      }
      for (let attempt = 0; !site && attempt < 300; attempt++) {
        const angle = random() * Math.PI * 2;
        const distance = terrain.radius * (0.25 + random() * 0.35);
        const x = Math.round(terrain.x + Math.cos(angle) * distance);
        const z = Math.round(terrain.z + Math.sin(angle) * distance);
        const top = terrain.getTop(x, z), bottom = terrain.getBottom(x, z);
        if (top === -32768 || top - bottom < 15) continue;
        const y = top - 9;
        const half = 4;
        const box = dungeonBox(terrain, x, y, z, half);
        if (!box || overlaps(world, placed, box)) continue;
        site = { x, y, z, box };
      }
      if (!site) continue;
      buildDungeon(world, site, random, central ? 'dungeonCentral' : 'dungeon');
      record(world, placed, 'dungeon', island, site.box);
      const cells = [];
      for (let zz = site.box.z0 + 1; zz < site.box.z1; zz++) {
        for (let xx = site.box.x0 + 1; xx < site.box.x1; xx++) cells.push({ x: xx, y: site.y, z: zz });
      }
      addCrawlers(world, mobRandom, cells, crawlerCount());
    }

    const caveCount = central ? settings.caveCentral : settings.caveTeam;
    for (let index = 0; index < caveCount; index++) {
      let cell = null, box = null;
      for (let attempt = 0; attempt < 200; attempt++) {
        cell = caveFloor(world, terrain, random);
        if (!cell) break;
        box = { x0: cell.x, x1: cell.x, z0: cell.z, z1: cell.z,
          y0: cell.y, y1: cell.y + 1 };
        if (!overlaps(world, placed, box)) break;
      }
      if (!cell || overlaps(world, placed, box)) continue;
      placeChest(world, cell.x, cell.y, cell.z, central ? 'caveCentral' : 'cave', randInt(random, 0, 3));
      record(world, placed, 'caveChest', island, box);
    }

    const undersideCount = central ? settings.undersideCentral
      : Number(random() < settings.undersideTeamChance);
    for (let index = 0; index < undersideCount; index++) {
      const preferred = central
        ? world.islands.filter((entry) => entry.kind === 'team')[index % world.keeps.length]
        : world.islands[0];
      let variant = random() < 0.5 ? 'cliffside' : 'hanging';
      let site = null;
      for (let pass = 0; pass < 2 && !site; pass++) {
        if (pass === 1) variant = variant === 'cliffside' ? 'hanging' : 'cliffside';
        for (let attempt = 0; attempt < 200; attempt++) {
          const facing = preferred && (central || random() < 0.75)
            ? Math.atan2(preferred.z - terrain.z, preferred.x - terrain.x)
              + (random() - 0.5) * 1.1
            : random() * Math.PI * 2;
          const outX = Math.abs(Math.cos(facing)) >= Math.abs(Math.sin(facing))
            ? Math.sign(Math.cos(facing)) : 0;
          const outZ = outX === 0 ? Math.sign(Math.sin(facing)) : 0;
          let distance;
          if (variant === 'cliffside') {
            let edgeDistance = terrain.radius;
            for (let step = 1; step <= terrain.radius + 10; step++) {
              const edgeX = Math.round(terrain.x + Math.cos(facing) * step);
              const edgeZ = Math.round(terrain.z + Math.sin(facing) * step);
              if (terrain.getTop(edgeX, edgeZ) === -32768) { edgeDistance = step; break; }
            }
            distance = edgeDistance - 4 - random() * 2;
          } else distance = terrain.radius * (0.45 + random() * 0.25);
          const x = Math.round(terrain.x + Math.cos(facing) * distance);
          const z = Math.round(terrain.z + Math.sin(facing) * distance);
          const bottom = terrain.getBottom(x, z), top = terrain.getTop(x, z);
          if (bottom === -32768 || top - bottom < 10) continue;
          const y = variant === 'cliffside' ? bottom + 3 : bottom - 4;
          if (y - 2 < world.minY || y + 5 >= world.sizeY) continue;
          const balconyLength = variant === 'cliffside' ? randInt(random, 3, 6) : 3;
          const box = cliffBox(x, y, z, outX, outZ, balconyLength);
          if (overlaps(world, placed, box)) continue;
          if (variant === 'cliffside' && terrain.getTop(x - outX * 2, z - outZ * 2) < y + 5) continue;
          site = { x, y, z, outX, outZ, balconyLength, box };
          break;
        }
      }
      if (!site) continue;
      if (variant === 'cliffside') buildCliffside(world, site, random);
      else buildHanging(world, site, random);
      record(world, placed, 'underside', island, site.box);
      world.structures.at(-1).variant = variant;
      const cells = [];
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        cells.push(variant === 'cliffside'
          ? { x: site.x + site.outX * a - site.outZ * b, y: site.y + 1, z: site.z + site.outZ * a + site.outX * b }
          : { x: site.x + a, y: site.y + 1, z: site.z + b });
      }
      addCrawlers(world, mobRandom, cells, crawlerCount());
    }

    // Now and then a Crawler in a dark cavern: a cave floor well under the surface.
    for (let index = 0; index < crawlers.cavernCap; index++) {
      if (mobRandom() >= crawlers.cavernChance) continue;
      for (let attempt = 0; attempt < 10; attempt++) {
        const cell = caveFloor(world, terrain, mobRandom);
        if (!cell) break;
        if (terrain.getTop(cell.x, cell.z) - cell.y < 10) continue;
        addCrawlers(world, mobRandom, [cell], 1);
        break;
      }
    }
  }
}
