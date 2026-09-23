// A small A* for walking mobs. Nodes are standing spots: integer (x, y, z)
// where the mob's feet are at y, the block below is solid, and it's clear
// `height` blocks up (no water: mobs keep out of ponds). Moves go to the 8
// neighbours, stepping up or down at most one block; diagonals need both
// straight neighbours open so paths don't cut corners.
//
// The search stops after maxNodes. If the goal wasn't reached it returns the
// path to the closest spot found, which is what a fleeing mob wants anyway.

import { BLOCK, isSolid } from '../shared/blocks.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function canStand(world, x, y, z, height) {
  if (!isSolid(world.getBlock(x, y - 1, z))) return false;
  for (let h = 0; h < height; h++) {
    const id = world.getBlock(x, y + h, z);
    if (isSolid(id) || id === BLOCK.WATER) return false;
  }
  return true;
}

// Min-heap of [priority, key].
class Heap {
  constructor() {
    this.items = [];
  }

  push(priority, key) {
    const a = this.items;
    a.push([priority, key]);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }

  get size() {
    return this.items.length;
  }
}

const key = (x, y, z) => (y * 2048 + z) * 2048 + x;

// Path of standing spots from `start` (integer {x, y, z}, where the mob
// stands) toward the column (goal.x, goal.z): [{x, y, z}, ...] not including
// the start, or [] if it can't move at all.
export function findPath(world, start, goal, { height = 2, maxNodes = 600 } = {}) {
  const h = (x, z) => Math.hypot(goal.x - x, goal.z - z);
  const nodes = new Map();
  const heap = new Heap();
  const startKey = key(start.x, start.y, start.z);
  nodes.set(startKey, { ...start, g: 0, parent: null, closed: false });
  heap.push(h(start.x, start.z), startKey);
  let best = nodes.get(startKey);
  let bestH = h(start.x, start.z);
  let expanded = 0;

  while (heap.size && expanded < maxNodes) {
    const node = nodes.get(heap.pop());
    if (node.closed) continue;
    node.closed = true;
    expanded++;
    const nh = h(node.x, node.z);
    if (nh < bestH) {
      best = node;
      bestH = nh;
    }
    if (nh < 1) break;
    for (const [dx, dz] of DIRS) {
      const nx = node.x + dx, nz = node.z + dz;
      // Same level, one up (with headroom to jump), or one down.
      let ny = null;
      for (const dy of [0, 1, -1]) {
        if (dy === 1 && !canStand(world, node.x, node.y, node.z, height + 1)) continue;
        if (canStand(world, nx, node.y + dy, nz, height)) {
          ny = node.y + dy;
          break;
        }
      }
      if (ny === null) continue;
      // No corner cutting on diagonals.
      if (dx && dz && (!canStand(world, node.x + dx, ny, node.z, height) || !canStand(world, node.x, ny, node.z + dz, height))) continue;
      const g = node.g + (dx && dz ? Math.SQRT2 : 1) + (ny !== node.y ? 0.5 : 0);
      const k = key(nx, ny, nz);
      const known = nodes.get(k);
      if (known && (known.closed || known.g <= g)) continue;
      nodes.set(k, { x: nx, y: ny, z: nz, g, parent: node, closed: false });
      heap.push(g + h(nx, nz), k);
    }
  }

  const path = [];
  for (let n = best; n && n.parent; n = n.parent) path.push({ x: n.x, y: n.y, z: n.z });
  return path.reverse();
}
