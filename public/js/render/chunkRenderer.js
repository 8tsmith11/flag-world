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
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

// Goblin Bricks: rough, dark greenish-brown bricks in staggered rows of
// uneven lengths, deep mortar, pitted faces and flecks of moss.
function goblinBrickTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1f1e14';
  ctx.fillRect(0, 0, size, size);
  let seed = 0x6b1e5;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rows = [0, 8, 16, 24, 32];
  for (let row = 0; row < 4; row++) {
    const top = rows[row] + 1, bottom = rows[row + 1] - 1;
    let x = row % 2 ? -6 : 0;
    while (x < size) {
      const length = 9 + Math.floor(random() * 7);
      const r = 66 + Math.floor(random() * 22), g = 68 + Math.floor(random() * 20), b = 40 + Math.floor(random() * 12);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      // Chipped corners: each brick is inset a little differently.
      const inset = random() < 0.5 ? 1 : 0;
      ctx.fillRect(x + 1, top + inset, length - 1, bottom - top - inset + (random() < 0.3 ? 0 : 1));
      if (x < 0) ctx.fillRect(x + 1 + size, top + inset, length - 1, bottom - top - inset);
      // Darker lower edge, lighter upper edge for a rough bevel.
      ctx.fillStyle = 'rgba(20,18,10,0.45)';
      ctx.fillRect(x + 1, bottom - 1, length - 1, 1);
      ctx.fillStyle = 'rgba(150,150,100,0.25)';
      ctx.fillRect(x + 1, top + inset, length - 1, 1);
      x += length;
    }
  }
  for (let i = 0; i < 90; i++) {
    const shade = random() < 0.6 ? 'rgba(25,22,12,0.5)' : 'rgba(120,118,80,0.35)';
    ctx.fillStyle = shade;
    ctx.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? '#4d6a2a' : '#3d5a24';
    ctx.fillRect(Math.floor(random() * size), rows[Math.floor(random() * 4) + 1] - 2, 2 + Math.floor(random() * 3), 1 + Math.floor(random() * 2));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

function stoneBrickTexture(variant = 'plain') {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#9b9b9b';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#777777';
  for (let row = 0; row < 4; row++) {
    const y = row * 16;
    ctx.fillRect(0, y, size, 2);
    for (let x = (row % 2) * 16; x < size + 32; x += 32) {
      ctx.fillRect(x, y, 2, 16);
    }
  }
  if (variant === 'mossy') {
    ctx.fillStyle = '#62745a';
    for (let i = 0; i < 28; i++) ctx.fillRect((i * 37) % size,
      (i * 23 + 7) % size, 2 + i % 5, 1 + i % 3);
  } else if (variant === 'cracked') {
    ctx.strokeStyle = '#444847';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const x = (i * 31 + 9) % size, y = (i * 17 + 5) % size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 4); ctx.lineTo(x + 1, y + 9); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

function patternedTexture(kind) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (kind === 'planks') {
    ctx.fillStyle = '#75502d'; ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      ctx.fillStyle = row % 2 ? '#ae8350' : '#a67a47';
      ctx.fillRect(0, y + 1, size, 14);
      ctx.fillStyle = '#d1a269'; ctx.fillRect(0, y + 2, size, 1);
      ctx.fillStyle = '#684525'; ctx.fillRect((row % 2 ? 22 : 43), y + 1, 2, 14);
    }
  } else if (kind === 'woodSides') {
    ctx.fillStyle = '#76502d'; ctx.fillRect(0, 0, size, size);
    for (let stripe = 0; stripe < 15; stripe++) {
      ctx.fillStyle = stripe % 3 ? '#8e6338' : '#593a21';
      ctx.fillRect(stripe * 5, 0, 2 + stripe % 3, size);
    }
  } else if (kind === 'woodEnds') {
    ctx.fillStyle = '#a47a49'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#654522'; ctx.lineWidth = 2;
    for (let radius = 5; radius <= 29; radius += 5) {
      ctx.beginPath(); ctx.ellipse(32, 32, radius, radius * 0.88, 0, 0, Math.PI * 2); ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#303840'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 36; i++) {
      const x = (i * 37 + 11) % size, y = (i * 29 + 7) % size;
      ctx.fillStyle = i % 3 ? '#252e36' : '#49515a';
      ctx.fillRect(x, y, 2 + i % 4, 1 + i % 3);
    }
    ctx.strokeStyle = '#6da8b0'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = (i * 41 + 7) % size, y = (i * 19 + 9) % size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 2); ctx.lineTo(x + 3, y + 7); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
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
    this.goblinMaterial = new THREE.MeshLambertMaterial({ map: goblinBrickTexture(), vertexColors: true });
    this.brickMaterial = new THREE.MeshLambertMaterial({ map: stoneBrickTexture(), vertexColors: true });
    this.mossyBrickMaterial = new THREE.MeshLambertMaterial({ map: stoneBrickTexture('mossy'), vertexColors: true });
    this.crackedBrickMaterial = new THREE.MeshLambertMaterial({ map: stoneBrickTexture('cracked'), vertexColors: true });
    this.plankMaterial = new THREE.MeshLambertMaterial({ map: patternedTexture('planks'), vertexColors: true });
    this.woodSideMaterial = new THREE.MeshLambertMaterial({ map: patternedTexture('woodSides'), vertexColors: true });
    this.woodEndMaterial = new THREE.MeshLambertMaterial({ map: patternedTexture('woodEnds'), vertexColors: true });
    this.quarryMaterial = new THREE.MeshLambertMaterial({ map: patternedTexture('quarry'), vertexColors: true });
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
      goblin: geo.goblin && new THREE.Mesh(geo.goblin, this.goblinMaterial),
      bricks: geo.bricks && new THREE.Mesh(geo.bricks, this.brickMaterial),
      mossyBricks: geo.mossyBricks && new THREE.Mesh(geo.mossyBricks, this.mossyBrickMaterial),
      crackedBricks: geo.crackedBricks && new THREE.Mesh(geo.crackedBricks, this.crackedBrickMaterial),
      planks: geo.planks && new THREE.Mesh(geo.planks, this.plankMaterial),
      woodSides: geo.woodSides && new THREE.Mesh(geo.woodSides, this.woodSideMaterial),
      woodEnds: geo.woodEnds && new THREE.Mesh(geo.woodEnds, this.woodEndMaterial),
      quarry: geo.quarry && new THREE.Mesh(geo.quarry, this.quarryMaterial),
      glow: geo.glow && new THREE.Mesh(geo.glow, this.glowMaterial),
      transparent: geo.transparent && new THREE.Mesh(geo.transparent, this.transparentMaterial),
    };
    if (entry.opaque) this.scene.add(entry.opaque);
    if (entry.ore) this.scene.add(entry.ore);
    if (entry.goblin) this.scene.add(entry.goblin);
    if (entry.bricks) this.scene.add(entry.bricks);
    for (const name of ['mossyBricks', 'crackedBricks', 'planks', 'woodSides', 'woodEnds', 'quarry']) {
      if (entry[name]) this.scene.add(entry[name]);
    }
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
    for (const mesh of [entry.opaque, entry.ore, entry.goblin, entry.bricks,
      entry.mossyBricks, entry.crackedBricks, entry.planks, entry.woodSides, entry.woodEnds,
      entry.quarry, entry.glow, entry.transparent]) {
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
