import { BLOCK, FACING_DIRS } from '../blocks.js';
import { cellKey } from '../structures/buildability.js';

// Timber gatehouses are content; the neutral wall engine only records gates.
export function gatehouses(ring, roads, map, C) {
  const remaining = new Map(ring.gates.map(g => [cellKey(g.x, g.z), g])), result = [];
  while (remaining.size) {
    const group = [remaining.values().next().value]; remaining.delete(cellKey(group[0].x, group[0].z));
    for (let i = 0; i < group.length; i++) for (const [dx, dz] of FACING_DIRS) {
      const k = cellKey(group[i].x + dx, group[i].z + dz), g = remaining.get(k);
      if (g) { group.push(g); remaining.delete(k); }
    }
    const alongX = group[0].axis !== 'z' && group.every(g => g.z === group[0].z), alongZ = group.every(g => g.x === group[0].x);
    if (!alongX && !alongZ) return null;
    const cx = Math.round(group.reduce((n, g) => n + g.x, 0) / group.length), cz = Math.round(group.reduce((n, g) => n + g.z, 0) / group.length);
    const y = Math.max(...group.map(g => g.y)), blocks = [];
    const sides = group.map(g => alongX ? g.x - cx : g.z - cz);
    const left = Math.min(...sides) - C.gatehousePostWidth, right = Math.max(...sides) + C.gatehousePostWidth;
    const point = (side, depth, height, id) => {
      const x = cx + (alongX ? side : depth), z = cz + (alongX ? depth : side), c = map.cells.get(cellKey(x, z));
      if (!c || c.keepOut || c.reserved || c.water === 'lake') return false;
      blocks.push({ x, y: y + height, z, id }); return true;
    };
    for (const side of [left, right]) for (let depth = -(C.gatehouseDepth >> 1); depth <= C.gatehouseDepth >> 1; depth++) {
      const px = cx + (alongX ? side : depth), pz = cz + (alongX ? depth : side);
      const ground = map.cells.get(cellKey(px, pz))?.ground ?? y;
      for (let h = Math.min(1, ground - y + 1); h <= C.gatehouseHeight; h++) if (!point(side, depth, h, BLOCK.WOOD)) return null;
    }
    // A lintel and overhead gallery, with braces and hanging banner blocks.
    for (let side = left; side <= right; side++) for (let depth = -(C.gatehouseDepth >> 1); depth <= C.gatehouseDepth >> 1; depth++) {
      if (!point(side, depth, C.gatehouseHeight, BLOCK.PLANKS)) return null;
    }
    for (const side of [left, right]) { point(side, 0, C.gatehouseHeight - 1, BLOCK.PLANKS); point(side, -1, C.gatehouseHeight - 2, BLOCK.SCORCHED_EARTH); }
    // Gate openings and the road below them are untouched by the gatehouse.
    result.push({ type: 'gatehouse', x: cx, y, z: cz, gates: group, blocks,
      box: { x0: Math.min(...blocks.map(b => b.x)), x1: Math.max(...blocks.map(b => b.x)),
        z0: Math.min(...blocks.map(b => b.z)), z1: Math.max(...blocks.map(b => b.z)), y0: y + 1, y1: y + C.gatehouseHeight } });
  }
  return result;
}
