// Server-owned lava propagation. Sources are explicit and never created by
// neighbours. Rechecking cells after every change also lets old flows recede.
import { BLOCK, isSolid, isLava, isWater, lavaLevel } from '../shared/blocks.js';
import { CHUNK_SIZE, ELEMENTAL } from '../shared/config.js';
import { inDragonArena } from '../shared/fireTempleArena.js';

const TICK_PERIOD = ELEMENTAL.lavaTickPeriod;
const TICK_BUDGET = ELEMENTAL.lavaTickBudget;
const SEARCH_DISTANCE = ELEMENTAL.lavaFlowDistance;
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class LavaSimulation {
  constructor(world, loader = null) {
    this.world = world;
    this.pending = loader ? loader.entityMap(p => p) : new Map();
    // Generated pools and falls are sources. Seed exposed boundaries so a
    // large world does not fill the queue with enclosed interior cells.
    for (const chunk of world.chunks.values()) {
      for (let y = 0; y < CHUNK_SIZE; y++) for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
        if (chunk.get(x, y, z) !== BLOCK.LAVA) continue;
        const bx = chunk.cx * CHUNK_SIZE + x, by = chunk.cy * CHUNK_SIZE + y, bz = chunk.cz * CHUNK_SIZE + z;
        if (HORIZONTAL.some(([dx, dz]) => world.getBlock(bx + dx, by, bz + dz) === BLOCK.AIR)
          || world.getBlock(bx, by - 1, bz) === BLOCK.AIR) this.enqueueAround(bx, by, bz);
      }
    }
  }

  enqueue(x, y, z) {
    if (!this.world.inBounds(x, y, z)) return;
    if (inDragonArena(this.world, x, z)) return;
    this.pending.set(`${x},${y},${z}`, { x, y, z });
  }

  enqueueAround(x, y, z) {
    this.enqueue(x, y, z);
    this.enqueue(x, y - 1, z);
    this.enqueue(x, y + 1, z);
    for (const [dx, dz] of HORIZONTAL) this.enqueue(x + dx, y, z + dz);
  }

  // Short breadth-first search along one level. A path may pass through air or
  // lava; a drop is an open cell below a passable cell.
  dropDistance(x, y, z) {
    const world = this.world;
    const seen = new Set([`${x},${z}`]);
    let frontier = [{ x, z }];
    for (let distance = 0; distance <= SEARCH_DISTANCE; distance++) {
      const next = [];
      for (const p of frontier) {
        if (world.getBlock(p.x, y - 1, p.z) === BLOCK.AIR) return distance;
        for (const [dx, dz] of HORIZONTAL) {
          const nx = p.x + dx, nz = p.z + dz, key = `${nx},${nz}`;
          if (seen.has(key) || !world.inBounds(nx, y, nz)) continue;
          if (world.getBlock(nx, y, nz) !== BLOCK.AIR && !isLava(world.getBlock(nx, y, nz))) continue;
          seen.add(key);
          next.push({ x: nx, z: nz });
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  canFlowToward(x, y, z, fromX, fromZ) {
    const current = this.dropDistance(x, y, z);
    const options = HORIZONTAL.filter(([dx, dz]) => {
      const nx = fromX + dx, nz = fromZ + dz;
      return this.world.inBounds(nx, y, nz) &&
        (this.world.getBlock(nx, y, nz) === BLOCK.AIR || isLava(this.world.getBlock(nx, y, nz)));
    });
    const best = Math.min(...options.map(([dx, dz]) => this.dropDistance(fromX + dx, y, fromZ + dz)));
    return best === Infinity || current === best;
  }

  updateCell(x, y, z) {
    const world = this.world;
    const old = world.getBlock(x, y, z);
    if (y <= world.voidY) {
      if (isLava(old) && old !== BLOCK.LAVA) world.setBlock(x, y, z, BLOCK.AIR);
      return;
    }
    if (isLava(old) && [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) =>
      isWater(world.getBlock(x+dx,y+dy,z+dz)))) {
      world.setBlock(x,y,z,old===BLOCK.LAVA ? BLOCK.STONE
        : ((x^y^z^world.seed)&1) ? BLOCK.STONE : BLOCK.COBBLE);
      return;
    }
    if (old === BLOCK.LAVA || (old !== BLOCK.AIR && !isLava(old))) return;
    let level = 0;
    const above = lavaLevel(world.getBlock(x, y + 1, z));
    if (above) level = above === ELEMENTAL.lavaFlowDistance + 1 ? ELEMENTAL.lavaFlowDistance : above;
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx, nz = z + dz;
      const neighbour = lavaLevel(world.getBlock(nx, y, nz));
      if (neighbour <= 1) continue;
      // A source or flowing column without solid footing falls straight down.
      // It fans out only when it reaches a floor, avoiding wide sheets in air.
      if (!isSolid(world.getBlock(nx, y - 1, nz))) continue;
      if (!this.canFlowToward(x, y, z, nx, nz)) continue;
      level = Math.max(level, neighbour - 1);
    }
    const next = level ? BLOCK.LAVA_FLOW_1 + level - 1 : BLOCK.AIR;
    if (next !== BLOCK.AIR && [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) =>
      isWater(world.getBlock(x+dx,y+dy,z+dz)))) {
      world.setBlock(x,y,z,((x^y^z^world.seed)&1) ? BLOCK.STONE : BLOCK.COBBLE);
      return;
    }
    if (old !== next) {
      world.setBlock(x, y, z, next);
      this.enqueueAround(x, y, z);
    }
  }

  tick(gameTick) {
    if (gameTick % TICK_PERIOD) return;
    let budget = TICK_BUDGET;
    while (budget-- > 0) {
      const entry = (this.pending.activeEntries?.() ?? this.pending.entries()).next().value;
      if (!entry) break;
      const [key, pos] = entry;
      this.pending.delete(key);
      this.updateCell(pos.x, pos.y, pos.z);
    }
  }
}
