// Builds vertex buffers for one chunk, emitting only faces that border a
// transparent block of a different type. Opaque and transparent (water) blocks
// go into separate buffers so they can use different materials.

import * as THREE from 'three';
import { CHUNK_SIZE } from '/shared/config.js';
import { BLOCK, getBlockDef, ladderFacing, doorState, blockBase, isWater, waterLevel } from '/shared/blocks.js';
import { ANVIL_PARTS } from './models.js';

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

// Linear-space colors for shape part hex colors, converted once.
const hexCache = new Map();
function hexColor(hex) {
  let c = hexCache.get(hex);
  if (!c) {
    c = new THREE.Color().setHex(hex);
    hexCache.set(hex, c);
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
  return { positions: [], normals: [], colors: [], uvs: [], indices: [] };
}

function pushFace(buf, face, x, y, z, color, light) {
  const base = buf.positions.length / 3;
  for (const [cx, cy, cz] of face.corners) {
    buf.positions.push(x + cx, y + cy, z + cz);
    buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    buf.colors.push(color.r * light, color.g * light, color.b * light);
    buf.uvs.push(face.dir[0] ? cz : cx, face.dir[1] ? cz : cy);
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

function pushFaceRect(buf, face, x, y, z, u0, v0, u1, v1, color, light, offset = 0.002) {
  const base = buf.positions.length / 3;
  for (const [u, v] of [[u0, v0], [u0, v1], [u1, v0], [u1, v1]]) {
    const left = face.corners[0], lowerLeft = face.corners[1];
    const right = face.corners[2], lowerRight = face.corners[3];
    for (let axis = 0; axis < 3; axis++) {
      const position = left[axis] * (1 - u) * (1 - v)
        + lowerLeft[axis] * (1 - u) * v
        + right[axis] * u * (1 - v) + lowerRight[axis] * u * v;
      buf.positions.push([x, y, z][axis] + position + face.dir[axis] * offset);
      buf.normals.push(face.dir[axis]);
      buf.colors.push([color.r, color.g, color.b][axis] * light);
    }
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

function pushPatternedFace(buf, face, x, y, z, id, light) {
  const brick = id === BLOCK.STONE_BRICKS || id === BLOCK.MOSSY_STONE_BRICKS
    || id === BLOCK.CRACKED_STONE_BRICKS;
  const base = brick ? 0x555752 : id === BLOCK.WOOD ? 0x4c331f : 0x7b5731;
  pushFace(buf, face, x, y, z, hexColor(base), light);
  if (brick) {
    const tile = blockColor(id);
    for (let row = 0; row < 3; row++) {
      for (let column = -1; column < 3; column++) {
        const shift = row % 2 ? 0.22 : 0;
        const u0 = Math.max(0.012, column * 0.5 + shift + 0.014);
        const u1 = Math.min(0.988, (column + 1) * 0.5 + shift - 0.014);
        if (u1 <= u0) continue;
        const v0 = row / 3 + 0.016, v1 = (row + 1) / 3 - 0.016;
        pushFaceRect(buf, face, x, y, z, u0, v0, u1, v1, tile, light * (0.94 + row * 0.03));
        if (id === BLOCK.MOSSY_STONE_BRICKS && (row + column + x + z) % 3 === 0) {
          pushFaceRect(buf, face, x, y, z, u0 + 0.04, v1 - 0.06,
            Math.min(u1, u0 + 0.2), v1 - 0.02, hexColor(0x466b40), light, 0.004);
        }
        if (id === BLOCK.CRACKED_STONE_BRICKS && (row + column + x + y) % 2 === 0) {
          const middle = (u0 + u1) / 2;
          pushFaceRect(buf, face, x, y, z, middle, v0 + 0.03,
            middle + 0.018, v1 - 0.03, hexColor(0x424541), light, 0.004);
        }
      }
    }
  } else if (id === BLOCK.PLANKS) {
    for (let row = 0; row < 4; row++) {
      const color = hexColor(row % 2 ? 0xb58a55 : 0xa87c48);
      pushFaceRect(buf, face, x, y, z, 0.01, row / 4 + 0.012,
        0.99, (row + 1) / 4 - 0.012, color, light);
      const seam = row % 2 ? 0.35 : 0.68;
      pushFaceRect(buf, face, x, y, z, seam, row / 4 + 0.015,
        seam + 0.012, (row + 1) / 4 - 0.015, hexColor(0x704b2c), light, 0.004);
    }
  } else if (face.dir[1] !== 0) {
    for (let ring = 0; ring < 3; ring++) {
      const inset = 0.1 + ring * 0.13;
      pushFaceRect(buf, face, x, y, z, inset, inset, 1 - inset, 1 - inset,
        hexColor(ring % 2 ? 0xb18857 : 0x9b7245), light, 0.002 + ring * 0.002);
    }
  } else {
    for (let stripe = 0; stripe < 5; stripe++) {
      const u = 0.08 + stripe * 0.19;
      pushFaceRect(buf, face, x, y, z, u, 0.02, u + 0.04, 0.98,
        hexColor(stripe % 2 ? 0x805634 : 0x694528), light);
    }
  }
}

function pushWaterFace(buf, face, x, y, z, color, light, heights) {
  const base = buf.positions.length / 3;
  for (const [cx, cy, cz] of face.corners) {
    buf.positions.push(x + cx, y + (cy ? heights[cx + 2 * cz] : 0), z + cz);
    buf.normals.push(...face.dir);
    buf.colors.push(color.r * light, color.g * light, color.b * light);
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

function waterHeight(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (!isWater(id)) return 0;
  // A falling column fills its entire block, so its sides join into a sheet.
  if (isWater(world.getBlock(x, y + 1, z))) return 1;
  return id === BLOCK.WATER ? 1 : 0.13 + waterLevel(id) * 0.87 / 7;
}

// The four cells touching a corner share one height. Their top surfaces join
// as slopes instead of ending in a stair-step at each flowing-water level.
function waterCornerHeight(world, x, y, z, cx, cz) {
  let total = 0, count = 0;
  for (const dx of [cx - 1, cx]) for (const dz of [cz - 1, cz]) {
    const bx = x + dx, bz = z + dz;
    const id = world.getBlock(bx, y, bz);
    const h = waterHeight(world, bx, y, bz);
    if (h === 1) return 1;
    // Air pulls the last flowing block down to a thin edge. Solid shore
    // blocks do not lower water along the bank.
    if (h > 0 || id === BLOCK.AIR) { total += h; count++; }
  }
  return count ? total / count : 0;
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

// Shaped blocks are lists of boxes in block-local units, laid out facing
// north (front toward -Z) and turned to the block's facing. Each box has an
// optional color (else the block's).
const LADDER_DEPTH = 0.07;
// Ladder against the north side of its cell: two rails and four rungs.
const LADDER = [
  [0.1, 0, 0, 0.22, 1, LADDER_DEPTH],
  [0.78, 0, 0, 0.9, 1, LADDER_DEPTH],
  ...[0.125, 0.375, 0.625, 0.875].map((y) => [0.22, y - 0.04, 0.01, 0.78, y + 0.04, LADDER_DEPTH - 0.01]),
].map((box) => ({ box }));

// Doors are panels described across the door (u, 0-1), up it (v, 0-1) and
// through it (w, around 0). Closed, the panel spans the cell's middle; open,
// it has swung to lie along the west (left-hand) side.
const DOOR_THICKNESS = 0.1875;
const GLASS = 0x9fd3e6;
const FRAME = 0.15, BAR = 0.03;
const panel = (u0, v0, u1, v1, w = DOOR_THICKNESS / 2, color) => ({ panel: [u0, v0, u1, v1, w], color });
const DOOR_LOWER = [panel(0, 0, 1, 1), panel(0.78, 0.45, 0.88, 0.55, DOOR_THICKNESS / 2 + 0.06, 0xd4af37)];
// Upper half: a frame around four panes, split by a cross bar.
const DOOR_UPPER = [
  panel(0, 0, FRAME, 1), panel(1 - FRAME, 0, 1, 1),
  panel(FRAME, 0, 1 - FRAME, FRAME), panel(FRAME, 1 - FRAME, 1 - FRAME, 1),
  panel(0.5 - BAR, FRAME, 0.5 + BAR, 1 - FRAME), panel(FRAME, 0.5 - BAR, 1 - FRAME, 0.5 + BAR),
  ...[[FRAME, 0.5 + BAR], [0.5 + BAR, 1 - FRAME]].flatMap(([u0, u1]) => [[FRAME, 0.5 - BAR], [0.5 + BAR, 1 - FRAME]]
    .map(([v0, v1]) => panel(u0, v0, u1, v1, 0.02, GLASS))),
];

function doorBox({ panel: [u0, v0, u1, v1, w], color }, open) {
  const mid = open ? DOOR_THICKNESS / 2 : 0.5;
  const box = open
    ? [mid - w, v0, u0, mid + w, v1, u1]
    : [u0, v0, mid - w, u1, v1, mid + w];
  return { box, color };
}

// Workbench: a light plank top with a 3x3 grid scored in it, on a darker,
// slightly inset body.
const WORKBENCH = [
  { box: [0, 0.8, 0, 1, 1, 1], color: 0xc49a63 },
  { box: [0.06, 0, 0.06, 0.94, 0.8, 0.94], color: 0x7d5230 },
  ...[1 / 3, 2 / 3].flatMap((t) => [
    { box: [t - 0.015, 1, 0.05, t + 0.015, 1.01, 0.95], color: 0x5a3a1e },
    { box: [0.05, 1, t - 0.015, 0.95, 1.01, t + 0.015], color: 0x5a3a1e },
  ]),
];

// Furnace: a stone block with a dark mouth under a lighter lintel on the
// front, and a vent on top.
const FURNACE = [
  { box: [0, 0, 0, 1, 1, 1] },
  { box: [0.25, 0.12, -0.01, 0.75, 0.5, 0.02], color: 0x1c1b1b },
  { box: [0.2, 0.5, -0.015, 0.8, 0.58, 0.02], color: 0x9c9ca2 },
  { box: [0.35, 1, 0.35, 0.65, 1.01, 0.65], color: 0x2a2a2a },
];

// Chest: a wooden box a little smaller than its cell, a dark band where the
// lid meets the base, and a gold latch on the front.
const CHEST = [
  { box: [0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375] },
  { box: [0.05, 0.56, 0.05, 0.95, 0.62, 0.95], color: 0x5e3d18 },
  { box: [0.44, 0.44, 0.03, 0.56, 0.66, 0.07], color: 0xd4af37 },
];

const SAPLING = [
  { box: [0.46, 0, 0.46, 0.54, 0.4, 0.54], color: 0x71512c },
  { box: [0.22, 0.24, 0.43, 0.78, 0.48, 0.57], color: 0x55a94c },
  { box: [0.43, 0.3, 0.22, 0.57, 0.54, 0.78], color: 0x3c8d3b },
];

// Rope: a thin strand down the middle of the cell with a knot halfway.
const ROPE = [
  { box: [0.45, 0, 0.45, 0.55, 1, 0.55] },
  { box: [0.42, 0.44, 0.42, 0.58, 0.56, 0.58], color: 0x8f7446 },
];

// Anvil: a wide base, a narrow waist and a flat face with a horn toward +X,
// in dark iron with a worn, lighter face (the same boxes as its item model).
const ANVIL = ANVIL_PARTS.map(({ box, light }, i) => ({ box, color: light ? 0x5c5f66 : i % 2 ? 0x34363b : 0x3b3d42 }));

const SHAPES = { workbench: WORKBENCH, furnace: FURNACE, chest: CHEST, sapling: SAPLING, rope: ROPE, anvil: ANVIL };

// [{ box, color }] for a shaped block, turned to its facing.
function shapeBoxes(id, def) {
  const turn = (parts, facing) => parts.map(({ box, color }) => ({ box: rotateBox(box, facing), color }));
  if (def.shape === 'ladder') return turn(LADDER, ladderFacing(id));
  if (def.shape === 'door') {
    const { facing, open, upper } = doorState(id);
    return turn((upper ? DOOR_UPPER : DOOR_LOWER).map((p) => doorBox(p, open)), facing);
  }
  return turn(SHAPES[def.shape], blockBase(id).facing);
}

function toGeometry(buf) {
  if (buf.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geo.setIndex(buf.indices);
  if (buf.uvs.length === buf.positions.length / 3 * 2) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  }
  geo.computeBoundingSphere();
  return geo;
}

// Returns { opaque, transparent } BufferGeometries (either may be null).
// Vertex positions are in world space.
export function meshChunk(world, chunk) {
  const opaque = createBuffers();
  const transparent = createBuffers();
  const ore = createBuffers();
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
          for (const part of shapeBoxes(id, def)) {
            pushBox(opaque, part.box, x, y, z, part.color === undefined ? color : hexColor(part.color), j);
          }
          continue;
        }
        const buf = id === BLOCK.IRON_ORE ? ore : def.transparent ? transparent : opaque;

        if (isWater(id)) {
          const visibleFaces = FACES.filter((face) => {
            const n = world.getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            return !isWater(n) && getBlockDef(n).transparent;
          });
          if (visibleFaces.length === 0) continue;
          const heights = [
            waterCornerHeight(world, x, y, z, 0, 0),
            waterCornerHeight(world, x, y, z, 1, 0),
            waterCornerHeight(world, x, y, z, 0, 1),
            waterCornerHeight(world, x, y, z, 1, 1),
          ];
          for (const face of visibleFaces) pushWaterFace(buf, face, x, y, z, color, face.shade * j, heights);
          continue;
        }

        if (id === BLOCK.STONE_BRICKS || id === BLOCK.MOSSY_STONE_BRICKS
          || id === BLOCK.CRACKED_STONE_BRICKS || id === BLOCK.WOOD || id === BLOCK.PLANKS) {
          for (const face of FACES) {
            const neighbour = world.getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            if (neighbour === id || !getBlockDef(neighbour).transparent) continue;
            pushPatternedFace(buf, face, x, y, z, id, face.shade * j);
          }
          continue;
        }

        for (const face of FACES) {
          const n = world.getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          if (n === id || !getBlockDef(n).transparent) continue;
          pushFace(buf, face, x, y, z, color, face.shade * j);
        }
      }
    }
  }

  return { opaque: toGeometry(opaque), transparent: toGeometry(transparent), ore: toGeometry(ore) };
}
