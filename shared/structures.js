// Structures shared by every kind of world gen: keeps (one per player, with
// the flag on a pedestal in the middle), sand shores and trees. Also the
// seeded PRNG all world gen uses.

import { KEEP_SIZE, KEEP_HEIGHT, KEEP_MARGIN, BIOME_SETTINGS, TREE_SETTINGS as T } from './config.js';
import { BLOCK, isSolid, isWater } from './blocks.js';
import { growTree } from './trees.js';
export { canGrowTree, growTree } from './trees.js';

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
const TREE_MIN_TRUNK = T.minTrunk;
const TREE_MAX_TRUNK = T.maxTrunk;
const LEAF_RADIUS = T.leafRadius;

export function plantTrees(world, seed, { requireFooting = false,
  noise=()=>0, clusterScale=BIOME_SETTINGS.treeCell,
  bounds = { x0: 0, z0: 0, x1: world.sizeX - 1, z1: world.sizeZ - 1 },
  surfaceAt = (x, z) => world.getSurfaceY(x, z, isSolid) } = {}) {
  // A separate stream from the terrain, so trees don't shift the terrain.
  const random = mulberry32(seed ^ 0x5bd1e995);
  const clearOfKeeps = KEEP_REACH + LEAF_RADIUS;
  const TREE_CELL = BIOME_SETTINGS.forestTreeCell;
  const candidates=[], giantCells=new Set();
  for (let cz = Math.floor(bounds.z0 / TREE_CELL) * TREE_CELL; cz <= bounds.z1; cz += TREE_CELL) {
    for (let cx = Math.floor(bounds.x0 / TREE_CELL) * TREE_CELL; cx <= bounds.x1; cx += TREE_CELL) {
      // Always draw every number so each cell uses the same amount of the stream.
      const roll = random(), ox = random(), oz = random(), trunkRoll = random();
      const x = cx + Math.floor(ox * TREE_CELL), z = cz + Math.floor(oz * TREE_CELL);
      const actualBiome = world.biomeAt(x, z);
      const biome = actualBiome === 'ancientForest' ? 'forest' : actualBiome;
      const density = biome === 'forest' ? 1 : (TREE_CELL / BIOME_SETTINGS.treeCell) ** 2;
      let forestDensity=1;
      if(biome==='forest') {
        const cluster=noise(x/clusterScale,z/clusterScale);
        const t=Math.max(0,Math.min(1,(cluster-BIOME_SETTINGS.forestClearingThreshold)/BIOME_SETTINGS.forestClearingBlend));
        forestDensity=BIOME_SETTINGS.forestDensityMultiplier*(1+cluster*BIOME_SETTINGS.forestClusterVariation)*t*t*(3-2*t);
      }
      if (roll >= Math.min(BIOME_SETTINGS.treeChanceCap, BIOME_SETTINGS.treeChance * BIOME_SETTINGS[biome].trees * density*forestDensity)) continue;
      if (x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1) continue;
      if (x < LEAF_RADIUS || z < LEAF_RADIUS || x >= world.sizeX - LEAF_RADIUS || z >= world.sizeZ - LEAF_RADIUS) continue;
      if (world.keeps.some((k) => Math.abs(x - k.cx) <= clearOfKeeps && Math.abs(z - k.cz) <= clearOfKeeps)) continue;
      let ground = surfaceAt(x, z);
      if (ground < 0 || world.getBlock(x, ground, z) !== BLOCK.GRASS) continue;
      if ((world.treeObstacles??world.structures).some(({ box, kind }) => kind !== 'tree' && box && box.y1>ground && x >= box.x0 - LEAF_RADIUS && x <= box.x1 + LEAF_RADIUS
        && z >= box.z0 - LEAF_RADIUS && z <= box.z1 + LEAF_RADIUS)) continue;
      if (Array.from({ length: LEAF_RADIUS * 2 + 1 }, (_, i) => i - LEAF_RADIUS).some((dx) =>
        Array.from({ length: LEAF_RADIUS * 2 + 1 }, (_, i) => i - LEAF_RADIUS).some((dz) =>
          isWater(world.getBlock(x + dx, surfaceAt(x + dx, z + dz), z + dz))
          || world.riverColumns?.has(`${x + dx},${z + dz}`)))) continue;
      if (requireFooting && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => !isSolid(world.getBlock(x + dx, ground, z + dz)))) continue;
      let trunk = TREE_MIN_TRUNK + Math.floor(trunkRoll * (TREE_MAX_TRUNK - TREE_MIN_TRUNK + 1))
        + (biome === 'forest' && trunkRoll < BIOME_SETTINGS.forestLargeTreeChance
          ? BIOME_SETTINGS.forestLargeTreeExtra : 0);
      const weight=world.ancientWeights?.[x+world.sizeX*z]??0;
      const treeRandom=mulberry32(seed^Math.imul(x,73856093)^Math.imul(z,19349663));
      let species=['oak','birch','pine'][Math.floor(treeRandom()*3)],width=1,hollow=false;
      if(weight>0) {
        const cell=`${Math.floor(x/T.ancient.spacing)},${Math.floor(z/T.ancient.spacing)}`;
        if(!giantCells.has(cell)) {
          species='ancient';
          trunk=Math.round(trunk+weight*(T.ancient.height[0]+treeRandom()*(T.ancient.height[1]-T.ancient.height[0])-trunk));
          width=1+Math.round(weight*(T.ancient.trunkWidth[0]+treeRandom()*(T.ancient.trunkWidth[1]-T.ancient.trunkWidth[0])-1));
          hollow=width>=T.ancient.hollowWidth&&treeRandom()<T.ancient.hollowChance;
          const heights=[];for(let dx=0;dx<width;dx++)for(let dz=0;dz<width;dz++)heights.push(surfaceAt(x+dx,z+dz));
          if(Math.max(...heights)-Math.min(...heights)>T.ancient.groundRelief)continue;
          ground=Math.max(...heights);giantCells.add(cell);
        }
      }
      const top=ground+trunk;if(top+T.species[species].crown>=world.sizeY)continue;
      candidates.push({x,ground,z,top,seed,species,width,hollow,maturity:weight});
    }
  }
  // Giants reserve their trunks before regular understorey trees.
  candidates.sort((a,b)=>(b.species==='ancient')-(a.species==='ancient'));
  for(const p of candidates)growTree(world,p.x,p.ground,p.z,p.top,p);
}
