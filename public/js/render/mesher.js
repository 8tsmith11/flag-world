// Builds vertex buffers for one chunk, emitting only faces that border a
// transparent block of a different type. Opaque and transparent (water) blocks
// go into separate buffers so they can use different materials.

import * as THREE from 'three';
import { CHUNK_SIZE } from '/shared/config.js';
import { BLOCK, getBlockDef, FACING_DIRS, ladderFacing, doorState } from '/shared/blocks.js';

// Corner offsets are wound counter-clockwise when viewed from outside.
// Triangles per face: (0,1,2) and (2,1,3). `shade` fakes directional variation.
const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], shade: 0.8, corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], shade: 0.55, corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], shade: 0.7, corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], shade: 0.7, corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

// Linear-space colors per block id, converted once.
const colorCache = new Map();
function blockColor(id) {
  let c = colorCache.get(id);
  if (!c) {
    c = new THREE.Color().setHex(getBlockDef(id).color);
    colorCache.set(id, c);
  }
  return c;
}

// Small deterministic per-block brightness jitter so flat colors read as texture.
function jitter(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return 0.94 + (((h ^ (h >>> 16)) & 0xff) / 255) * 0.12;
}

function createBuffers() {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function pushFace(buf, face, x, y, z, color, light) {
  const base = buf.positions.length / 3;
  for (const [cx, cy, cz] of face.corners) {
    buf.positions.push(x + cx, y + cy, z + cz);
    buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    buf.colors.push(color.r * light, color.g * light, color.b * light);
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

// A box from (x0, y0, z0) to (x1, y1, z1) in block-local units, all six faces.
function pushBox(buf, [x0, y0, z0, x1, y1, z1], x, y, z, color, light) {
  for (const face of FACES) {
    const base = buf.positions.length / 3;
    for (const [cx, cy, cz] of face.corners) {
      buf.positions.push(x + (cx ? x1 : x0), y + (cy ? y1 : y0), z + (cz ? z1 : z0));
      buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
      buf.colors.push(color.r * face.shade * light, color.g * face.shade * light, color.b * face.shade * light);
    }
    buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}

// Turns a box laid out for facing north (-Z side / looking -Z) to another
// facing, rotating around the block's vertical center line.
function rotateBox([x0, y0, z0, x1, y1, z1], facing) {
  const turn = ([x, z]) => {
    for (let i = 0; i < facing; i++) [x, z] = [1 - z, x];
    return [x, z];
  };
  const [ax, az] = turn([x0, z0]), [bx, bz] = turn([x1, z1]);
  return [Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz)];
}

const LADDER_DEPTH = 0.07;
// Ladder against the north side of its cell: two rails and four rungs.
const LADDER_BOXES = [
  [0.1, 0, 0, 0.22, 1, LADDER_DEPTH],
  [0.78, 0, 0, 0.9, 1, LADDER_DEPTH],
  ...[0.125, 0.375, 0.625, 0.875].map((y) => [0.22, y - 0.04, 0.01, 0.78, y + 0.04, LADDER_DEPTH - 0.01]),
];
const DOOR_THICKNESS = 0.1875;
// A door for a player looking north: closed, it's a slab across the middle of
// the cell; open, it has swung to lie along the west (left-hand) side.
const DOOR_CLOSED = [0, 0, 0.5 - DOOR_THICKNESS / 2, 1, 1, 0.5 + DOOR_THICKNESS / 2];
const DOOR_OPEN = [0, 0, 0, DOOR_THICKNESS, 1, 1];
const DOOR_KNOB = [0.78, 0.45, 0.5 - DOOR_THICKNESS / 2 - 0.06, 0.88, 0.55, 0.5 + DOOR_THICKNESS / 2 + 0.06];

function shapeBoxes(id, def) {
  if (def.shape === 'ladder') return LADDER_BOXES.map((b) => rotateBox(b, ladderFacing(id)));
  const { facing, open, upper } = doorState(id);
  const boxes = [open ? DOOR_OPEN : DOOR_CLOSED];
  if (!open && !upper) boxes.push(DOOR_KNOB);
  return boxes.map((b) => rotateBox(b, facing));
}

function toGeometry(buf) {
  if (buf.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geo.setIndex(buf.indices);
  geo.computeBoundingSphere();
  return geo;
}

// Returns { opaque, transparent } BufferGeometries (either may be null).
// Vertex positions are in world space.
export function meshChunk(world, chunk) {
  const opaque = createBuffers();
  const transparent = createBuffers();
  const ox = chunk.cx * CHUNK_SIZE, oy = chunk.cy * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.get(lx, ly, lz);
        if (id === BLOCK.AIR) continue;
        const def = getBlockDef(id);
        const x = ox + lx, y = oy + ly, z = oz + lz;
        const color = blockColor(id);
        const j = jitter(x, y, z);
        // Thin shapes (ladders, doors) are drawn whole; nothing culls them.
        if (def.shape) {
          for (const box of shapeBoxes(id, def)) pushBox(opaque, box, x, y, z, color, j);
          continue;
        }
        const buf = def.transparent ? transparent : opaque;

        for (const face of FACES) {
          const n = world.getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          if (n === id || !getBlockDef(n).transparent) continue;
          pushFace(buf, face, x, y, z, color, face.shade * j);
        }
      }
    }
  }

  return { opaque: toGeometry(opaque), transparent: toGeometry(transparent) };
}
