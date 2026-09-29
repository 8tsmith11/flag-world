// Quarry placement after caves, keeps, and structures are built. The per-island
// helper can also be used by a later island type with its own counts.
import { BLOCK } from './blocks.js';
import { KEEP_REACH, mulberry32 } from './structures.js';
import { structureAllowed } from './structures/place.js';
import { QUARRY_SURFACE } from './config.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function clearOfBuiltArea(world, x, y, z) {
  if(!structureAllowed(world,{x0:x,x1:x,z0:z,z1:z}))return false;
  if (world.keeps.some((keep) => Math.abs(x - keep.cx) <= KEEP_REACH + 6
    && Math.abs(z - keep.cz) <= KEEP_REACH + 6)) return false;
  return !world.structures.some(({ box }) => box && x >= box.x0 - 2 && x <= box.x1 + 2
    && y >= box.y0 - 2 && y <= box.y1 + 2 && z >= box.z0 - 2 && z <= box.z1 + 2);
}

// Reusable for other island kinds: try cave-adjacent stones first, then solid
// underground stones. A cave-adjacent face must open into two blocks of air.
export function placeQuarriesInIsland(world, terrain, random, count, caveAdjacent = 0) {
  const placed = [];
  const valid = (x, y, z, nearCave) => {
    if (world.getBlock(x, y, z) !== BLOCK.STONE || !clearOfBuiltArea(world, x, y, z)) return false;
    if (!nearCave) return true;
    return DIRS.some(([dx, dy, dz]) => {
      const ax = x + dx, ay = y + dy, az = z + dz;
      return ay >= terrain.getBottom(ax, az) + 2 && ay + 1 <= terrain.getTop(ax, az) - 2
        && world.getBlock(ax, ay, az) === BLOCK.AIR
        && world.getBlock(ax, ay + 1, az) === BLOCK.AIR;
    });
  };
  const place = (x, y, z) => {
    world.setBlock(x, y, z, BLOCK.QUARRY_STONE);
    placed.push({ x, y, z });
    return true;
  };
  const choose = (nearCave) => {
    for (let attempt = 0; attempt < 2400; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * terrain.radius * (terrain.kind === 'tiny' ? 0.55 : 0.78);
      const x = Math.floor(terrain.x + Math.cos(angle) * distance);
      const z = Math.floor(terrain.z + Math.sin(angle) * distance);
      const top = terrain.getTop(x, z), bottom = terrain.getBottom(x, z);
      const low = bottom + (terrain.kind === 'tiny' ? 1 : 4);
      const high = top - (terrain.kind === 'tiny' ? 2 : 6);
      if (top === -32768 || high < low) continue;
      const y = low + Math.floor(random() * (high - low + 1));
      if (valid(x, y, z, nearCave)) return place(x, y, z);
    }
    // Rare seeds can have very little exposed cave wall. Scan the island so
    // a run of unlucky random samples cannot defeat the promised count.
    const reach = Math.ceil(terrain.radius * (terrain.kind === 'tiny' ? 0.55 : 0.78));
    for (let z = Math.floor(terrain.z) - reach; z <= terrain.z + reach; z++) {
      for (let x = Math.floor(terrain.x) - reach; x <= terrain.x + reach; x++) {
        if (Math.hypot(x - terrain.x, z - terrain.z) > reach) continue;
        const top = terrain.getTop(x, z), bottom = terrain.getBottom(x, z);
        const low = bottom + (terrain.kind === 'tiny' ? 1 : 4);
        const high = top - (terrain.kind === 'tiny' ? 2 : 6);
        for (let y = low; y <= high; y++) if (valid(x, y, z, nearCave)) return place(x, y, z);
      }
    }
    return false;
  };
  for (let i = 0; i < caveAdjacent; i++) choose(true);
  for (let i = caveAdjacent; i < count; i++) choose(false);
  return placed;
}

function placeSurfaceQuarries(world, terrain, random, count, keep) {
  const placed = [];
  const valid = (x, z) => {
    const y = terrain.getTop(x, z);
    if (y === -32768 || Math.hypot(x - terrain.x, z - terrain.z) > terrain.radius * QUARRY_SURFACE.placementFraction
      || Math.hypot(x - keep.cx, z - keep.cz) < QUARRY_SURFACE.minKeepDistance
      || placed.some(p => Math.hypot(x - p.x, z - p.z) < QUARRY_SURFACE.minSpacing)) return false;
    if (!clearOfBuiltArea(world, x, y, z) || ![BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE].includes(world.getBlock(x, y, z))) return false;
    for (let h = 1; h <= QUARRY_SURFACE.headroom; h++) if (world.getBlock(x, y + h, z) !== BLOCK.AIR) return false;
    const neighbours = [[1,0],[-1,0],[0,1],[0,-1]];
    return neighbours.every(([dx,dz]) => Math.abs(terrain.getTop(x+dx,z+dz) - y) <= QUARRY_SURFACE.maxSlope);
  };
  const place = (x,z) => { const y=terrain.getTop(x,z);world.setBlock(x,y,z,BLOCK.QUARRY_STONE);
    placed.push({x,y,z});world.structures.push({kind:'surfaceQuarry',box:{x0:x,x1:x,y0:y,y1:y,z0:z,z1:z}}); };
  for(let i=0;i<count;i++) {
    let found=false;
    for(let attempt=0;attempt<QUARRY_SURFACE.attempts;attempt++) {
      const angle=random()*Math.PI*2, distance=Math.sqrt(random())*terrain.radius*QUARRY_SURFACE.placementFraction;
      const x=Math.floor(terrain.x+Math.cos(angle)*distance), z=Math.floor(terrain.z+Math.sin(angle)*distance);
      if(valid(x,z)){place(x,z);found=true;break;}
    }
    if(found)continue;
    for(let z=Math.floor(terrain.z-terrain.radius);z<=terrain.z+terrain.radius&&!found;z++)
      for(let x=Math.floor(terrain.x-terrain.radius);x<=terrain.x+terrain.radius&&!found;x++)
        if(valid(x,z)){place(x,z);found=true;}
  }
  return placed;
}

export function placeQuarries(world, terrains, seed, config) {
  world.quarries = [];
  const random = mulberry32(seed ^ 0x7b94f2c1);
  for (const terrain of terrains) {
    if (terrain.kind === 'team') {
      world.quarries.push(...placeQuarriesInIsland(world, terrain, random, config.perTeam, config.caveAdjacent));
    } else if (terrain.kind === 'tiny' && random() < config.tinyChance) {
      world.quarries.push(...placeQuarriesInIsland(world, terrain, random, 1));
    }
  }
}

export function placeSurfaceQuarriesForTeams(world, terrains, seed, config) {
  const random=mulberry32(seed^QUARRY_SURFACE.seedSalt);
  for(const terrain of terrains) {
    if(terrain.kind!=='team')continue;
    const keep=world.keeps.find(k=>Math.hypot(k.cx-terrain.x,k.cz-terrain.z)<terrain.radius);
    if(keep)world.quarries.push(...placeSurfaceQuarries(world,terrain,random,
      QUARRY_SURFACE.countsByUnderground[config.perTeam],keep));
  }
}
