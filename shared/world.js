// Chunked voxel storage shared by server (authoritative copy) and client
// (local copy used for meshing and movement prediction).
//
// Chunks are sparse: a chunk only exists once a non-air block is set in it, so
// a big world that is mostly sky costs memory only where there is land.

import { CHUNK_SIZE, WORLD_SIZE_Y, VOID_Y } from './config.js';
import { BLOCK } from './blocks.js';
import { biomeName } from './biomes.js';

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
    this.structures = [];
    this.lootChests = new Map();
    // Block-attached state (e.g. chest contents), keyed by "x,y,z".
    this.tileEntities = new Map();
    this.doorTeams = new Map();
    // Natural terrain column ranges from worldgen only. Player edits never
    // touch this mask, so bridges over the void remain exposed to eels.
    this.naturalBottom = new Int16Array(sizeX * sizeZ).fill(-32768);
    this.naturalTop = new Int16Array(sizeX * sizeZ).fill(-32768);
    this.naturalExtra = new Map();
    this.biomeCodes = new Uint8Array(sizeX * sizeZ);
    // Called with (x, y, z, id, oldId) after setBlock; used to dirty
    // neighbour meshes, broadcast, and update server simulations.
    this.onBlockChanged = null;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= this.minY && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  recordNaturalTerrain(x, z, bottom, top) {
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return;
    const key = x + this.sizeX * z;
    if (this.naturalTop[key] === -32768) {
      this.naturalBottom[key] = bottom;
      this.naturalTop[key] = top;
    } else {
      let extra = this.naturalExtra.get(key);
      if (!extra) this.naturalExtra.set(key, extra = []);
      extra.push(bottom, top);
    }
  }

  naturalTerrainBetween(x, z, lowerY, upperY) {
    x = Math.floor(x); z = Math.floor(z);
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return false;
    const key = x + this.sizeX * z;
    if (this.naturalTop[key] >= lowerY && this.naturalBottom[key] <= upperY) return true;
    const extra = this.naturalExtra.get(key);
    if (extra) for (let i = 0; i < extra.length; i += 2) {
      if (extra[i + 1] >= lowerY && extra[i] <= upperY) return true;
    }
    return false;
  }

  biomeAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return 'plains';
    return biomeName(this.biomeCodes[x + this.sizeX * z]);
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
