import { BLOCK, isWater } from '../blocks.js';
import { STRUCTURE_GEN } from '../config.js';
import { KEEP_REACH } from '../structures.js';

export const cellKey = (x, z) => `${x},${z}`;
export const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Every producer registers its occupied volume in world.structures. Keeps
// predate that registry and are included here using their actual footprint.
export function structureBoxes(world) {
  return [...world.structures.filter(s => s.box).map(s => s.box),
    ...world.keeps.map(k => ({ x0: k.cx - KEEP_REACH, x1: k.cx + KEEP_REACH,
      z0: k.cz - KEEP_REACH, z1: k.cz + KEEP_REACH, y0: k.floorY, y1: world.sizeY }))];
}

export function buildability(world, terrain, config = STRUCTURE_GEN, reserved = null) {
  const cells = new Map(), boxes = structureBoxes(world), margin = config.keepOutMargin;
  for (let z = terrain.z0; z < terrain.z0 + terrain.width; z++) {
    for (let x = terrain.x0; x < terrain.x0 + terrain.width; x++) {
      const ground = terrain.getTop(x, z);
      if (ground === -32768) continue;
      let wet = !!world.riverColumns?.has(cellKey(x, z)), trees = false;
      // Ponds can replace several terrain layers; inspect the whole surface band.
      for (let y = ground - config.treeClearance; y <= ground + config.treeClearance; y++) {
        const id = world.getBlock(x, y, z);
        wet ||= isWater(id);
        trees ||= id === BLOCK.WOOD || id === BLOCK.LEAVES;
      }
      cells.set(cellKey(x, z), { x, z, ground, bottom: terrain.getBottom(x, z), slope: 0,
        lowland: terrain.lowland?.[x-terrain.x0+terrain.width*(z-terrain.z0)]??0,
        water: wet ? 'lake' : 'none', trees,
        reserved: !!reserved && Math.hypot(x - reserved.x, z - reserved.z) <= reserved.radius,
        keepOut: !!world.terrainExclusions?.has(cellKey(x,z)) || boxes.some(b => x >= b.x0 - margin && x <= b.x1 + margin
          && z >= b.z0 - margin && z <= b.z1 + margin), edge: 0 });
    }
  }
  const visited = new Set();
  for (const c of cells.values()) {
    c.slope = Math.max(...CARDINAL.map(([dx, dz]) => Math.abs(c.ground -
      (cells.get(cellKey(c.x + dx, c.z + dz))?.ground ?? c.ground))));
    if (c.water === 'none' || visited.has(cellKey(c.x, c.z))) continue;
    const group = [c]; visited.add(cellKey(c.x, c.z));
    let river = false;
    for (let i = 0; i < group.length; i++) {
      const a = group[i]; river ||= !!world.riverColumns?.has(cellKey(a.x, a.z));
      for (const [dx, dz] of CARDINAL) {
        const k = cellKey(a.x + dx, a.z + dz), n = cells.get(k);
        if (n && n.water !== 'none' && !visited.has(k)) { visited.add(k); group.push(n); }
      }
    }
    for (const a of group) a.water = !river && group.length < config.puddleCells ? 'puddle' : 'lake';
  }
  // Distance transform measures the real island outline, including missing columns.
  const queue = [];
  for (const c of cells.values()) if (CARDINAL.some(([dx, dz]) => !cells.has(cellKey(c.x + dx, c.z + dz)))) {
    c.edge = 1; queue.push(c);
  }
  for (let i = 0; i < queue.length; i++) for (const [dx, dz] of CARDINAL) {
    const n = cells.get(cellKey(queue[i].x + dx, queue[i].z + dz));
    if (n && !n.edge) { n.edge = queue[i].edge + 1; queue.push(n); }
  }
  return { x0: terrain.x0, z0: terrain.z0, width: terrain.width, cells, boxes, reserved };
}
