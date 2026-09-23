// Keeps chunk meshes in the scene for chunks within the view distance of the
// camera (horizontally), building the nearest ones first, a few per frame,
// rebuilding any marked dirty, and unloading ones that fall out of range.
// Only chunks that exist are considered; the world stores no empty ones.

import * as THREE from 'three';
import { CHUNK_SIZE } from '/shared/config.js';
import { chunkKey } from '/shared/world.js';
import { meshChunk } from './mesher.js';

// Meshes built per frame: normally, and while the debug overview loads everything.
const BUILDS_PER_FRAME = 4;
const BUILDS_PER_FRAME_FAST = 24;
// Loaded chunks are kept until this much past the view distance, so walking
// back and forth over the edge doesn't rebuild them.
const UNLOAD_MARGIN = CHUNK_SIZE * 2;

export class ChunkRenderer {
  constructor(scene, world, viewDistance) {
    this.scene = scene;
    this.world = world;
    this.viewDistance = viewDistance;
    // chunkKey -> { opaque: Mesh|null, transparent: Mesh|null }
    this.meshes = new Map();
    this.dirty = new Set();
    // Chunks in range, nearest first; recomputed when the camera changes chunk.
    this.queue = [];
    this.queueFrom = null;
    this.fast = false;

    this.opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    world.onBlockChanged = (x, y, z) => this.markBlockDirty(x, y, z);
  }

  // fast: build more per frame (the debug overview, which loads the whole world).
  setViewDistance(distance, fast = false) {
    this.viewDistance = distance;
    this.fast = fast;
    this.queueFrom = null;
  }

  // A block change can expose faces in neighbouring chunks when it sits on a border.
  markBlockDirty(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    this.dirty.add(chunkKey(cx, cy, cz));
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz));
    if (lx === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx + 1, cy, cz));
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz));
    if (ly === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx, cy + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1));
    if (lz === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx, cy, cz + 1));
    // A block placed in empty sky may have created a chunk the queue doesn't know.
    if (!this.meshes.has(chunkKey(cx, cy, cz))) this.queueFrom = null;
  }

  // Horizontal distance from (x, z) to a chunk's center.
  distanceTo(chunk, x, z) {
    return Math.hypot((chunk.cx + 0.5) * CHUNK_SIZE - x, (chunk.cz + 0.5) * CHUNK_SIZE - z);
  }

  update(x, z) {
    const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
    if (key !== this.queueFrom) {
      this.queueFrom = key;
      this.queue = [];
      for (const chunk of this.world.chunks.values()) {
        const d = this.distanceTo(chunk, x, z);
        if (d <= this.viewDistance) this.queue.push({ chunk, d });
      }
      this.queue.sort((a, b) => a.d - b.d);
      for (const [meshKey, entry] of this.meshes) {
        if (this.distanceTo(entry.chunk, x, z) > this.viewDistance + UNLOAD_MARGIN) this.unload(meshKey);
      }
    }

    let budget = this.fast ? BUILDS_PER_FRAME_FAST : BUILDS_PER_FRAME;
    for (const { chunk } of this.queue) {
      if (budget === 0) break;
      const k = chunkKey(chunk.cx, chunk.cy, chunk.cz);
      if (this.meshes.has(k) && !this.dirty.has(k)) continue;
      this.build(k, chunk);
      budget--;
    }
    // Dirty chunks that are loaded but outside the queue (just past the edge) still need rebuilding.
    for (const k of this.dirty) {
      if (budget === 0) break;
      const entry = this.meshes.get(k);
      if (!entry) {
        this.dirty.delete(k);
        continue;
      }
      this.build(k, entry.chunk);
      budget--;
    }
  }

  build(key, chunk) {
    this.unload(key);
    this.dirty.delete(key);
    const geo = meshChunk(this.world, chunk);
    const entry = {
      chunk,
      opaque: geo.opaque && new THREE.Mesh(geo.opaque, this.opaqueMaterial),
      transparent: geo.transparent && new THREE.Mesh(geo.transparent, this.transparentMaterial),
    };
    if (entry.opaque) this.scene.add(entry.opaque);
    if (entry.transparent) {
      entry.transparent.renderOrder = 1;
      this.scene.add(entry.transparent);
    }
    this.meshes.set(key, entry);
  }

  unload(key) {
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const mesh of [entry.opaque, entry.transparent]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  get loadedCount() {
    return this.meshes.size;
  }
}
