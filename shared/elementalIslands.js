// Seeded fire and ice terrain. The fire island records a flat temple site;
// the ice island records its hollow glacier cavity.
import { BLOCK } from './blocks.js';
import { ELEMENTAL as C } from './config.js';
import { mulberry32 } from './structures.js';

const AIR_TOP = -32768;
const hash = (seed, x, z, salt = 0) => {
  let h = seed ^ salt ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663);
  h = Math.imul(h ^ h >>> 16, 2246822519);
  return ((h ^ h >>> 13) >>> 0) / 4294967296;
};

export function generateElementalIsland(world, island) {
  const c = C, rand = mulberry32(world.seed ^ c.terrainSalt ^ (island.kind === 'fire' ? 1 : 2));
  const reach = Math.ceil(island.radius + c.glacierRadius + 2);
  const width = reach * 2 + 1, x0 = island.x - reach, z0 = island.z - reach;
  const top = new Int16Array(width * width).fill(AIR_TOP);
  const bottom = new Int16Array(width * width).fill(AIR_TOP);
  const index = (x, z) => x - x0 + width * (z - z0);
  const getTop = (x, z) => x < x0 || z < z0 || x >= x0 + width || z >= z0 + width
    ? AIR_TOP : top[index(x, z)];
  const getBottom = (x, z) => x < x0 || z < z0 || x >= x0 + width || z >= z0 + width
    ? AIR_TOP : bottom[index(x, z)];
  const templeHalf = Math.floor(c.templeSize / 2);
  for (let z = z0; z < z0 + width; z++) for (let x = x0; x < x0 + width; x++) {
    const distance = Math.hypot(x - island.x, z - island.z);
    const edge = island.radius * (1 + (hash(world.seed, Math.floor(x / 5), Math.floor(z / 5), c.terrainSalt) - 0.5) * c.edgeJitter);
    if (distance > edge) continue;
    const temple = island.kind === 'fire' && Math.abs(x - island.x) <= templeHalf && Math.abs(z - island.z) <= templeHalf;
    const yTop = island.surfaceY + (temple ? c.templeFlatY
      : Math.round((hash(world.seed, x, z, c.terrainSalt) - 0.5) * c.surfaceVariation));
    const depth = Math.max(c.rimDepth, Math.round(c.depth * (1 - (distance / edge) ** 1.5)));
    const yBottom = yTop - depth;
    top[index(x, z)] = yTop; bottom[index(x, z)] = yBottom;
    world.recordNaturalTerrain(x, z, yBottom, yTop);
    for (let y = yBottom; y <= yTop; y++) {
      let block;
      if (island.kind === 'fire') {
        block = y === yTop ? (temple ? BLOCK.BASALT
          : hash(world.seed, x, z, 91) < c.magmaChance ? BLOCK.MAGMA
            : hash(world.seed, x, z, 95) < c.surfaceBasaltChance ? BLOCK.BASALT : BLOCK.ASH)
          : y > yTop - c.ashDepth ? BLOCK.ASH : BLOCK.BASALT;
        if (block === BLOCK.BASALT && !temple && hash(world.seed ^ y, x, z, 92) < c.oreChance)
          block = hash(world.seed ^ y, x, z, 93) < c.copperFraction ? BLOCK.COPPER_ORE : BLOCK.IRON_ORE;
      } else block = y === yTop ? BLOCK.SNOW : BLOCK.PACKED_ICE;
      world.setBlock(x, y, z, block);
    }
  }
  const terrain = { ...island, x0, z0, width, top, bottom, getTop, getBottom,
    bounds: { x0, z0, x1: x0 + width - 1, z1: z0 + width - 1 } };
  world.specialIslands ??= {};
  if (island.kind === 'fire') {
    world.specialIslands.fire = { x: island.x, z: island.z, radius: island.radius,
      templeArea: { x0: island.x - templeHalf, x1: island.x + templeHalf,
        z0: island.z - templeHalf, z1: island.z + templeHalf, y: island.surfaceY + c.templeFlatY } };
    for (let i = 0; i < c.spireCount; i++) {
      const angle = rand() * Math.PI * 2, d = island.radius * (c.spireDistance[0] + rand() * (c.spireDistance[1]-c.spireDistance[0]));
      const x = Math.round(island.x + Math.cos(angle) * d), z = Math.round(island.z + Math.sin(angle) * d);
      if(Math.abs(x-island.x)<=templeHalf && Math.abs(z-island.z)<=templeHalf)continue;
      const y = getTop(x, z); if (y === AIR_TOP) continue;
      const height = c.spireHeight[0] + Math.floor(rand() * (c.spireHeight[1] - c.spireHeight[0] + 1));
      for (let n = 1; n <= height; n++) world.setBlock(x, y + n, z, BLOCK.BASALT);
    }
    for (let i = 0; i < c.lavaPools; i++) {
      const angle = rand() * Math.PI * 2, d = island.radius * (c.poolDistance[0] + rand() * (c.poolDistance[1]-c.poolDistance[0]));
      const cx = Math.round(island.x + Math.cos(angle) * d), cz = Math.round(island.z + Math.sin(angle) * d);
      const r = c.lavaPoolRadius[0] + rand() * (c.lavaPoolRadius[1] - c.lavaPoolRadius[0]);
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (Math.hypot(x - cx, z - cz) > r) continue;
          if(Math.abs(x-island.x)<=templeHalf+c.lavaFlowDistance
            && Math.abs(z-island.z)<=templeHalf+c.lavaFlowDistance)continue;
          const y = getTop(x, z); if (y === AIR_TOP) continue;
          world.setBlock(x, y, z, BLOCK.LAVA);
        }
    }
    for (let i = 0; i < c.lavaFalls; i++) {
      const angle = (i + rand() * 0.3) * Math.PI * 2 / c.lavaFalls;
      let x = island.x, z = island.z, fallX = null, fallZ = null;
      for (let d = 0; d < island.radius + 3; d++) {
        const nx = Math.round(island.x + Math.cos(angle) * d), nz = Math.round(island.z + Math.sin(angle) * d);
        if (getTop(nx, nz) === AIR_TOP) { fallX=nx;fallZ=nz;break; }
        x = nx; z = nz;
      }
      const y = getTop(x, z); if (y === AIR_TOP) continue;
      world.setBlock(x, y, z, BLOCK.LAVA);
      if(fallX===null)continue;
      for (let yy = y; yy > world.voidY; yy--)
        if (world.getBlock(fallX, yy, fallZ) === BLOCK.AIR) world.setBlock(fallX, yy, fallZ, BLOCK.LAVA);
    }
  } else {
    const lakeX = island.x + Math.round(island.radius * c.lakeOffset), lakeZ = island.z;
    for (let z = lakeZ - c.lakeRadius; z <= lakeZ + c.lakeRadius; z++)
      for (let x = lakeX - c.lakeRadius; x <= lakeX + c.lakeRadius; x++) {
        if (Math.hypot(x - lakeX, z - lakeZ) > c.lakeRadius) continue;
        const y = getTop(x, z); if (y === AIR_TOP) continue;
        for (let n = 1; n <= c.lakeDepth; n++) world.setBlock(x, y - n, z, BLOCK.WATER);
        world.setBlock(x, y, z, BLOCK.ICE);
      }
    for (let z = z0; z < z0 + width; z++) for (let x = x0; x < x0 + width; x++) {
      const y = getTop(x, z); if (y === AIR_TOP) continue;
      if (hash(world.seed, x, z, 94) < c.icePatchChance && world.getBlock(x, y, z) === BLOCK.SNOW)
        world.setBlock(x, y, z, BLOCK.PACKED_ICE);
    }
    const gx = island.x + Math.round(island.radius * c.glacierOffset), gz = island.z;
    const gy = island.surfaceY + Math.floor(c.glacierHeight / 2);
    for (let z = gz - c.glacierRadius; z <= gz + c.glacierRadius; z++)
      for (let x = gx - c.glacierRadius; x <= gx + c.glacierRadius; x++) {
        const d = Math.hypot(x - gx, z - gz); if (d > c.glacierRadius || getTop(x, z) === AIR_TOP) continue;
        const height = Math.round(c.glacierHeight * (1 - d * d / (c.glacierRadius * c.glacierRadius)));
        for (let y = getTop(x, z) + 1; y <= getTop(x, z) + height; y++)
          world.setBlock(x, y, z, BLOCK.PACKED_ICE);
      }
    for (let z = gz - c.cavityRadius; z <= gz + c.cavityRadius; z++)
      for (let x = gx - c.cavityRadius; x <= gx + c.cavityRadius; x++)
        for (let y = gy - Math.floor(c.cavityHeight / 2); y <= gy + Math.floor(c.cavityHeight / 2); y++)
          if ((x - gx) ** 2 + (z - gz) ** 2 <= c.cavityRadius ** 2)
            world.setBlock(x, y, z, BLOCK.AIR);
    world.specialIslands.ice = { x: island.x, z: island.z, radius: island.radius,
      glacierCavity: { x: gx, y: gy, z: gz, radius: c.cavityRadius, height: c.cavityHeight } };
  }
  return terrain;
}
