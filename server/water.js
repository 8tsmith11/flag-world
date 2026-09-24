// Server-owned water propagation. Sources are explicit and never created by
// neighbours. Rechecking cells after every change also lets old flows recede.
import { BLOCK, isSolid, isWater, waterLevel } from '../shared/blocks.js';
import { CHUNK_SIZE } from '../shared/config.js';

const TICK_PERIOD = 3;
const TICK_BUDGET = 240;
const SEARCH_DISTANCE = 4;
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class WaterSimulation {
  constructor(world) {
    this.world = world;
    this.pending = new Map();
    // Generated pond water is source water. Seed its boundary, not its entire
    // volume, so starting a large world does not fill the queue with interiors.
    for (const chunk of world.chunks.values()) {
      for (let y = 0; y < CHUNK_SIZE; y++) for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
        if (chunk.get(x, y, z) !== BLOCK.WATER) continue;
        const bx = chunk.cx * CHUNK_SIZE + x, by = chunk.cy * CHUNK_SIZE + y, bz = chunk.cz * CHUNK_SIZE + z;
        if (HORIZONTAL.some(([dx, dz]) => world.getBlock(bx + dx, by, bz + dz) === BLOCK.AIR)
          || world.getBlock(bx, by - 1, bz) === BLOCK.AIR) this.enqueueAround(bx, by, bz);
      }
    }
  }

  enqueue(x, y, z) {
    if (!this.world.inBounds(x, y, z)) return;
    this.pending.set(`${x},${y},${z}`, { x, y, z });
  }

  enqueueAround(x, y, z) {
    this.enqueue(x, y, z);
    this.enqueue(x, y - 1, z);
    this.enqueue(x, y + 1, z);
    for (const [dx, dz] of HORIZONTAL) this.enqueue(x + dx, y, z + dz);
  }

  // Short breadth-first search along one level. A path may pass through air or
  // water; a drop is an open cell below a passable cell.
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
          if (world.getBlock(nx, y, nz) !== BLOCK.AIR && !isWater(world.getBlock(nx, y, nz))) continue;
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
        (this.world.getBlock(nx, y, nz) === BLOCK.AIR || isWater(this.world.getBlock(nx, y, nz)));
    });
    const best = Math.min(...options.map(([dx, dz]) => this.dropDistance(fromX + dx, y, fromZ + dz)));
    return best === Infinity || current === best;
  }

  updateCell(x, y, z) {
    const world = this.world;
    const old = world.getBlock(x, y, z);
    if (y <= world.voidY) {
      if (isWater(old) && old !== BLOCK.WATER) world.setBlock(x, y, z, BLOCK.AIR);
      return;
    }
    if (old === BLOCK.WATER || (old !== BLOCK.AIR && !isWater(old))) return;
    let level = 0;
    const above = waterLevel(world.getBlock(x, y + 1, z));
    if (above) level = above === 8 ? 7 : above;
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx, nz = z + dz;
      const neighbour = waterLevel(world.getBlock(nx, y, nz));
      if (neighbour <= 1) continue;
      // A source or flowing column without solid footing falls straight down.
      // It fans out only when it reaches a floor, avoiding wide sheets in air.
      if (!isSolid(world.getBlock(nx, y - 1, nz))) continue;
      if (!this.canFlowToward(x, y, z, nx, nz)) continue;
      level = Math.max(level, neighbour - 1);
    }
    const next = level ? BLOCK.WATER_FLOW_1 + level - 1 : BLOCK.AIR;
    if (old !== next) {
      world.setBlock(x, y, z, next);
      this.enqueueAround(x, y, z);
    }
  }

  tick(gameTick) {
    if (gameTick % TICK_PERIOD) return;
    let budget = TICK_BUDGET;
    while (budget-- > 0 && this.pending.size) {
      const [key, pos] = this.pending.entries().next().value;
      this.pending.delete(key);
      this.updateCell(pos.x, pos.y, pos.z);
    }
  }
}
