// Keeps chunk meshes in the scene for chunks within the view distance of the
// camera (horizontally), building the nearest ones first, a few per frame,
// rebuilding any marked dirty, and unloading ones that fall out of range.
// Only chunks that exist are considered; the world stores no empty ones.

import * as THREE from 'three';
import { CHUNK_SIZE } from '/shared/config.js';
import { chunkKey } from '/shared/world.js';
import { meshChunk } from './mesher.js';

// Meshes built per frame.
const BUILDS_PER_FRAME = 4;
// Loaded chunks are kept until this much past the view distance, so walking
// back and forth over the edge doesn't rebuild them.
const UNLOAD_MARGIN = CHUNK_SIZE * 2;

function ironTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#858787';
  ctx.fillRect(0, 0, 32, 32);
  let seed = 0x83f15;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 260; i++) {
    const g = Math.floor(105 + random() * 75);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(Math.floor(random() * 32), Math.floor(random() * 32), 1 + Math.floor(random() * 3), 1 + Math.floor(random() * 3));
  }
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(random() * 30), y = Math.floor(random() * 30);
    ctx.fillStyle = i % 3 === 0 ? '#d39b61' : '#9d603d';
    ctx.fillRect(x, y, 3 + Math.floor(random() * 4), 2 + Math.floor(random() * 3));
    ctx.fillStyle = '#e5b278';
    ctx.fillRect(x + 1, y, 1 + Math.floor(random() * 2), 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

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

    this.opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.oreMaterial = new THREE.MeshLambertMaterial({ map: ironTexture() });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
      opacity: 0.75, depthWrite: false });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    world.onBlockChanged = (x, y, z) => this.markBlockDirty(x, y, z);
  }

  setViewDistance(distance) {
    this.viewDistance = distance;
    this.queueFrom = null;
  }

  // A block change can expose faces in neighbouring chunks when it sits on a border.
  markBlockDirty(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    // Water corner heights also depend on diagonally adjacent cells.
    const xs = [cx], ys = [cy], zs = [cz];
    if (lx === 0) xs.push(cx - 1);
    if (lx === CHUNK_SIZE - 1) xs.push(cx + 1);
    if (ly === 0) ys.push(cy - 1);
    if (ly === CHUNK_SIZE - 1) ys.push(cy + 1);
    if (lz === 0) zs.push(cz - 1);
    if (lz === CHUNK_SIZE - 1) zs.push(cz + 1);
    for (const ax of xs) for (const ay of ys) for (const az of zs) this.dirty.add(chunkKey(ax, ay, az));
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

    let budget = BUILDS_PER_FRAME;
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
      ore: geo.ore && new THREE.Mesh(geo.ore, this.oreMaterial),
      glow: geo.glow && new THREE.Mesh(geo.glow, this.glowMaterial),
      transparent: geo.transparent && new THREE.Mesh(geo.transparent, this.transparentMaterial),
    };
    if (entry.opaque) this.scene.add(entry.opaque);
    if (entry.ore) this.scene.add(entry.ore);
    if (entry.glow) { entry.glow.renderOrder = 2; this.scene.add(entry.glow); }
    if (entry.transparent) {
      entry.transparent.renderOrder = 1;
      this.scene.add(entry.transparent);
    }
    this.meshes.set(key, entry);
  }

  unload(key) {
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const mesh of [entry.opaque, entry.ore, entry.glow, entry.transparent]) {
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
