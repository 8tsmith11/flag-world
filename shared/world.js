// Chunked voxel storage shared by server (authoritative copy) and client
// (local copy used for meshing and movement prediction).
//
// Chunks are sparse: a chunk only exists once a non-air block is set in it, so
// a big world that is mostly sky costs memory only where there is land.

import { CHUNK_SIZE, WORLD_SIZE_Y } from './config.js';
import { BLOCK } from './blocks.js';

const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
// Chunk coordinates stay far below this, so keys are unique numbers.
const KEY_SPAN = 4096;

export function chunkKey(cx, cy, cz) {
  return cx + KEY_SPAN * (cz + KEY_SPAN * cy);
}

export class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    // Bumped on every change; renderers compare against it to know when to remesh.
    this.version = 0;
  }

  static index(lx, ly, lz) {
    return lx + CHUNK_SIZE * (lz + CHUNK_SIZE * ly);
  }

  get(lx, ly, lz) {
    return this.blocks[Chunk.index(lx, ly, lz)];
  }

  set(lx, ly, lz, id) {
    this.blocks[Chunk.index(lx, ly, lz)] = id;
    this.version++;
  }
}

export class World {
  // Sizes in blocks. closedBottom: solid stone below y = 0 under the world
  // (the Test world); otherwise everything below is open void.
  constructor(seed, sizeX, sizeZ, { sizeY = WORLD_SIZE_Y, closedBottom = false } = {}) {
    this.seed = seed;
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.closedBottom = closedBottom;
    this.chunksX = Math.ceil(sizeX / CHUNK_SIZE);
    this.chunksY = Math.ceil(sizeY / CHUNK_SIZE);
    this.chunksZ = Math.ceil(sizeZ / CHUNK_SIZE);
    // Only chunks that have held a non-air block.
    this.chunks = new Map();
    // Keeps built by world gen: [{ cx, cz, floorY }].
    this.keeps = [];
    // Block-attached state (e.g. chest contents), keyed by "x,y,z".
    this.tileEntities = new Map();
    // Called with (x, y, z, id) after setBlock; used to dirty neighbour meshes / broadcast.
    this.onBlockChanged = null;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  getChunk(cx, cy, cz) {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  // Integer block coordinates. Outside the world is air (so walking off an
  // edge falls into the void), except stone below a closed bottom.
  getBlock(x, y, z) {
    if (!this.inBounds(x, y, z)) {
      const underWorld = this.closedBottom && y < 0 && x >= 0 && z >= 0 && x < this.sizeX && z < this.sizeZ;
      return underWorld ? BLOCK.STONE : BLOCK.AIR;
    }
    const chunk = this.getChunk(
      Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE),
    );
    return chunk ? chunk.get(x % CHUNK_SIZE, y % CHUNK_SIZE, z % CHUNK_SIZE) : BLOCK.AIR;
  }

  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    let chunk = this.getChunk(cx, cy, cz);
    if (!chunk) {
      // Air in a missing chunk is already air.
      if (id === BLOCK.AIR) return true;
      chunk = new Chunk(cx, cy, cz);
      this.chunks.set(chunkKey(cx, cy, cz), chunk);
    }
    chunk.set(x % CHUNK_SIZE, y % CHUNK_SIZE, z % CHUNK_SIZE, id);
    this.onBlockChanged?.(x, y, z, id);
    return true;
  }

  // Highest solid block's y in a column, or -1 if none.
  getSurfaceY(x, z, isSolid) {
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(x, y, z))) return y;
    }
    return -1;
  }
}
