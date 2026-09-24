// Check only leaves near a removed log. A leaf survives when a path through
// adjacent leaves reaches wood within six steps. Work is capped per game tick.
import { BLOCK } from '../shared/blocks.js';

const REACH = 6;
const DIAMETER = REACH * 2 + 1;
const TICK_BUDGET = 128;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function localIndex(dx, dy, dz) {
  return dx + REACH + DIAMETER * (dz + REACH + DIAMETER * (dy + REACH));
}

export class LeafDecay {
  constructor(world, onDecay = () => {}) {
    this.world = world;
    this.onDecay = onDecay;
    this.pending = new Map();
    this.visited = new Uint16Array(DIAMETER ** 3);
    this.visitId = 0;
  }

  // Only a leaf within six block connections of this log could have depended
  // on it. The diamond visits 377 cells, independent of world or forest size.
  enqueueAroundLog(x, y, z) {
    for (let dy = -REACH; dy <= REACH; dy++) {
      for (let dz = -REACH + Math.abs(dy); dz <= REACH - Math.abs(dy); dz++) {
        const remaining = REACH - Math.abs(dy) - Math.abs(dz);
        for (let dx = -remaining; dx <= remaining; dx++) {
          const bx = x + dx, by = y + dy, bz = z + dz;
          if (this.world.getBlock(bx, by, bz) === BLOCK.LEAVES) {
            this.pending.set(`${bx},${by},${bz}`, { x: bx, y: by, z: bz });
          }
        }
      }
    }
  }

  hasWoodWithinReach(x, y, z) {
    if (++this.visitId === 65535) {
      this.visited.fill(0);
      this.visitId = 1;
    }
    const queue = [{ dx: 0, dy: 0, dz: 0, distance: 0 }];
    this.visited[localIndex(0, 0, 0)] = this.visitId;
    for (let head = 0; head < queue.length; head++) {
      const { dx, dy, dz, distance } = queue[head];
      if (distance >= REACH) continue;
      for (const [sx, sy, sz] of SIDES) {
        const nx = dx + sx, ny = dy + sy, nz = dz + sz;
        if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) > REACH) continue;
        const id = this.world.getBlock(x + nx, y + ny, z + nz);
        if (id === BLOCK.WOOD) return true;
        if (id !== BLOCK.LEAVES) continue;
        const index = localIndex(nx, ny, nz);
        if (this.visited[index] === this.visitId) continue;
        this.visited[index] = this.visitId;
        queue.push({ dx: nx, dy: ny, dz: nz, distance: distance + 1 });
      }
    }
    return false;
  }

  tick() {
    let budget = TICK_BUDGET;
    while (budget-- > 0 && this.pending.size) {
      const [key, { x, y, z }] = this.pending.entries().next().value;
      this.pending.delete(key);
      if (this.world.getBlock(x, y, z) !== BLOCK.LEAVES) continue;
      if (!this.hasWoodWithinReach(x, y, z)) {
        this.world.setBlock(x, y, z, BLOCK.AIR);
        this.onDecay(x, y, z);
      }
    }
  }
}
