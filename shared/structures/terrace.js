import { BLOCK, isSolid } from '../blocks.js';
import { STRUCTURE_GEN } from '../config.js';
import { cellKey } from './buildability.js';

export function assessTerrace(map, box, budget, waterCrossing = false, clearance = 0) {
  const cells = [];
  for (let z = box.z0 - clearance; z <= box.z1 + clearance; z++) for (let x = box.x0 - clearance; x <= box.x1 + clearance; x++) {
    const c = map.cells.get(cellKey(x, z));
    if (!c || c.keepOut || c.reserved || c.water === 'lake' && !waterCrossing) return null;
  }
  for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) {
    const c = map.cells.get(cellKey(x, z));
    if (!c || c.keepOut || c.reserved || c.water === 'lake' && !waterCrossing) return null;
    cells.push(c);
  }
  const heights = cells.map(c => c.ground).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const cost = cells.reduce((n, c) => n + Math.abs(c.ground - height), 0);
  return cost <= budget ? { height, cost, budget } : null;
}

// Resolve earthworks as blocks so later construction can replay the same plan.
export function terraceBlocks(world, map, piece, config = STRUCTURE_GEN, occupied = new Set()) {
  const blocks = [], b = piece.box, template = new Map(piece.blocks.map(a => [`${a.x},${a.y},${a.z}`, a.id]));
  for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) {
    const c = map.cells.get(cellKey(x, z)), level = piece.levels?.[cellKey(x, z)] ?? piece.padHeight;
    if (piece.waterCrossing && c.water === 'lake') continue;
    for (let y = c.ground + 1; y <= Math.max(c.ground, level) + config.treeClearance; y++) {
      if (world.getBlock(x, y, z) !== BLOCK.AIR) blocks.push({ x, y, z, id: BLOCK.AIR });
    }
    for (let y = Math.min(c.ground, level); y <= Math.max(c.ground, level); y++) {
      const edge = x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1;
      let id = edge && Math.abs(level - c.ground) > 1 ? piece.retainingBlock : BLOCK.DIRT;
      if (y > level) id = BLOCK.AIR;
      else if (y === level) {
        const covered = Array.from({ length: config.grassClearance }, (_, i) => i + 1)
          .some(dy => isSolid(template.get(`${x},${y + dy},${z}`) ?? BLOCK.AIR));
        id = covered ? BLOCK.DIRT : BLOCK.GRASS;
      }
      blocks.push({ x, y, z, id });
    }
  }
  // Cut faces sit just outside the pad: replace their exposed soil with
  // retaining material without raising it or obstructing an adjoining piece.
  for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) {
    const level = piece.levels?.[cellKey(x, z)] ?? piece.padHeight;
    const sides = [[x === b.x0, -1, 0], [x === b.x1, 1, 0], [z === b.z0, 0, -1], [z === b.z1, 0, 1]];
    for (const [edge, dx, dz] of sides) {
      if (!edge) continue;
      const nx = x + dx, nz = z + dz, k = cellKey(nx, nz), outside = map.cells.get(k);
      if (!outside || outside.keepOut || outside.reserved || outside.water === 'lake' || occupied.has(k) || outside.ground - level <= 1) continue;
      for (let y = level; y < outside.ground; y++) blocks.push({ x: nx, y, z: nz, id: piece.retainingBlock });
    }
  }
  return blocks;
}
