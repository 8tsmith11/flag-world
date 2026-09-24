// Chunked voxel storage shared by server (authoritative copy) and client
// (local copy used for meshing and movement prediction).
//
// Chunks are sparse: a chunk only exists once a non-air block is set in it, so
// a big world that is mostly sky costs memory only where there is land.

import { CHUNK_SIZE, WORLD_SIZE_Y, VOID_Y } from './config.js';
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
  // Sizes in blocks. The world is open void below its floating island.
  constructor(seed, sizeX, sizeZ, { sizeY = WORLD_SIZE_Y, minY = VOID_Y } = {}) {
    this.seed = seed;
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.minY = minY;
    this.voidY = minY;
    this.sizeZ = sizeZ;
    this.chunksX = Math.ceil(sizeX / CHUNK_SIZE);
    this.chunksY = Math.ceil((sizeY - minY) / CHUNK_SIZE);
    this.chunksZ = Math.ceil(sizeZ / CHUNK_SIZE);
    // Only chunks that have held a non-air block.
    this.chunks = new Map();
    // Keeps built by world gen: [{ cx, cz, floorY }].
    this.keeps = [];
    // Block-attached state (e.g. chest contents), keyed by "x,y,z".
    this.tileEntities = new Map();
    // Called with (x, y, z, id, oldId) after setBlock; used to dirty
    // neighbour meshes, broadcast, and update server simulations.
    this.onBlockChanged = null;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= this.minY && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  getChunk(cx, cy, cz) {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  // Integer block coordinates. Outside the world is air (so walking off an
  // edge falls into the void).
  getBlock(x, y, z) {
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    const chunk = this.getChunk(
      Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE),
    );
    return chunk ? chunk.get(x % CHUNK_SIZE, ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, z % CHUNK_SIZE) : BLOCK.AIR;
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
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const oldId = chunk.get(x % CHUNK_SIZE, ly, z % CHUNK_SIZE);
    if (oldId === id) return true;
    chunk.set(x % CHUNK_SIZE, ly, z % CHUNK_SIZE, id);
    this.onBlockChanged?.(x, y, z, id, oldId);
    return true;
  }

  // Highest solid block's y in a column, or -1 if none.
  getSurfaceY(x, z, isSolid) {
    for (let y = this.sizeY - 1; y >= this.minY; y--) {
      if (isSolid(this.getBlock(x, y, z))) return y;
    }
    return -1;
  }
}
