import { cellKey, CARDINAL } from './buildability.js';
import { mulberry32 } from '../structures.js';
import { STRUCTURE_GEN } from '../config.js';

// Outlines are immutable after creation. Reuse their membership index for
// compound intersections, inside-face ladders and platform reachability.
const areas = new WeakMap();
export function ringArea(ring) {
  if (!areas.has(ring)) areas.set(ring, new Set(ring.area));
  return areas.get(ring);
}

export function clusterPieces(pieces, seed, { groupSize, distance, fraction }) {
  const random = mulberry32(seed), remaining = [...pieces].sort((a, b) => Number(b.tags.includes('core')) - Number(a.tags.includes('core')) || a.id.localeCompare(b.id));
  const clusters = [];
  while (remaining.length) {
    const first = remaining.shift();
    if (!first.tags.includes('core') && random() > fraction) continue;
    const count = groupSize[0] + Math.floor(random() * (groupSize[1] - groupSize[0] + 1));
    const cluster = [first];
    while (cluster.length < count && remaining.length) {
      const near = remaining.map((p, i) => ({ p, i, distance: Math.min(...cluster.map(q => Math.hypot(p.position.x - q.position.x, p.position.z - q.position.z))) }))
        .filter(p => p.distance <= distance).sort((a, b) => a.distance - b.distance);
      if (!near.length) break;
      const chosen = near[Math.floor(random() * Math.min(2, near.length))];
      cluster.push(chosen.p); remaining.splice(chosen.i, 1);
    }
    if (cluster.length >= groupSize[0] || first.tags.includes('core')) clusters.push(cluster);
  }
  return clusters;
}
function bounds(area) {
  const c = [...area].map(k => k.split(',').map(Number));
  return { x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])),
    z0: Math.min(...c.map(p => p[1])), z1: Math.max(...c.map(p => p[1])) };
}
function fillHoles(area) {
  const b = bounds(area), outside = new Set(), queue = [[b.x0 - 1, b.z0 - 1]];
  outside.add(cellKey(...queue[0]));
  for (let i = 0; i < queue.length; i++) for (const [dx, dz] of CARDINAL) {
    const x = queue[i][0] + dx, z = queue[i][1] + dz, k = cellKey(x, z);
    if (x < b.x0 - 1 || x > b.x1 + 1 || z < b.z0 - 1 || z > b.z1 + 1 || area.has(k) || outside.has(k)) continue;
    outside.add(k); queue.push([x, z]);
  }
  for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) if (!outside.has(cellKey(x, z))) area.add(cellKey(x, z));
}
export function outlineCorners(area) {
  let count = 0;
  const b = bounds(area);
  for (let z = b.z0; z <= b.z1 + 1; z++) for (let x = b.x0; x <= b.x1 + 1; x++) {
    const a = [area.has(cellKey(x - 1, z - 1)), area.has(cellKey(x, z - 1)), area.has(cellKey(x - 1, z)), area.has(cellKey(x, z))];
    const n = a.filter(Boolean).length;
    if (n === 1 || n === 3) count++;
    else if (n === 2 && a[0] === a[3]) count += 2;
  }
  return count;
}
// Quantized footprints guarantee broad lobes and long straight segments.
// Close small gaps first, then fill the cheapest remaining notches until the
// corner budget holds. This preserves the occupied outline instead of using
// its bounding rectangle as the wall.
export function enclosedMask(pieces, margin, config = STRUCTURE_GEN, cornerLimit = config.compoundCorners, buildable = () => true) {
  const g = config.outlineGrid, coarse = new Set(), raw = new Set();
  for (const p of pieces) for (let z = p.box.z0 - margin; z <= p.box.z1 + margin; z++) for (let x = p.box.x0 - margin; x <= p.box.x1 + margin; x++) raw.add(cellKey(x, z));
  for (const p of pieces) for (let z = Math.floor((p.box.z0 - margin) / g); z <= Math.floor((p.box.z1 + margin) / g); z++) {
    for (let x = Math.floor((p.box.x0 - margin) / g); x <= Math.floor((p.box.x1 + margin) / g); x++) coarse.add(cellKey(x, z));
  }
  const allowed = k => {
    const [x, z] = k.split(',').map(Number);
    for (let dz = 0; dz < g; dz++) for (let dx = 0; dx < g; dx++) if (!buildable(x * g + dx, z * g + dz)) return false;
    return true;
  };
  const close = (maximum) => {
    const b = bounds(coarse), gaps = [];
    for (const vertical of [false, true]) {
      const low = vertical ? b.x0 : b.z0, high = vertical ? b.x1 : b.z1;
      const begin = vertical ? b.z0 : b.x0, end = vertical ? b.z1 : b.x1;
      for (let line = low; line <= high; line++) {
        let last = null;
        for (let t = begin; t <= end; t++) {
          const k = vertical ? cellKey(line, t) : cellKey(t, line);
          if (!coarse.has(k)) continue;
          if (last !== null && t - last > 1 && t - last - 1 <= maximum) {
            const cells = [];
            for (let j = last + 1; j < t; j++) cells.push(vertical ? cellKey(line, j) : cellKey(j, line));
            if (cells.every(allowed)) gaps.push(cells);
          }
          last = t;
        }
      }
    }
    return gaps.sort((a, b) => a.length - b.length);
  };
  for (const gap of close(Math.ceil(config.outlineGap / g))) for (const k of gap) coarse.add(k);
  fillHoles(coarse);
  while (outlineCorners(coarse) > cornerLimit) {
    let gap = close(Infinity)[0];
    if (!gap) {
      const candidates = new Map();
      for (const k of coarse) { const [x, z] = k.split(',').map(Number);
        for (const [dx, dz] of CARDINAL) { const empty = cellKey(x + dx, z + dz);
          if (coarse.has(empty)) continue;
          candidates.set(empty, (candidates.get(empty) ?? 0) + 1);
        }
      }
      const notch = [...candidates].filter(([k, n]) => n >= 2 && allowed(k)).sort((a, b) => b[1] - a[1])[0];
      if (!notch) break;
      gap = [notch[0]];
    }
    for (const k of gap) coarse.add(k);
    fillHoles(coarse);
  }
  const area = new Set();
  for (const k of coarse) {
    const [cx, cz] = k.split(',').map(Number);
    const expand = allowed(k);
    for (let z = cz * g; z < (cz + 1) * g; z++) for (let x = cx * g; x < (cx + 1) * g; x++) {
      if ((expand || raw.has(cellKey(x, z))) && buildable(x, z)) area.add(cellKey(x, z));
    }
  }
  return area;
}
export function wallRing({ pieces, margin, paths, groundAt, material, height, gateHeight, name, config = STRUCTURE_GEN, cornerLimit }) {
  const area = enclosedMask(pieces, margin, config, cornerLimit, (x, z) => groundAt(x, z) !== null), wall = [], gates = [], blocks = [];
  if (!area) return null;
  const pathCells = new Map(paths.map(p => [cellKey(p.x, p.z), p]));
  for (const k of area) {
    const [x, z] = k.split(',').map(Number);
    const edge = [-1, 0, 1].some(dx => [-1, 0, 1].some(dz => !area.has(cellKey(x + dx, z + dz))));
    if (!edge) continue;
    const y = groundAt(x, z); if (y === null) return null;
    const gate = pathCells.has(k)&&CARDINAL.some(([dx,dz])=>
      pathCells.has(cellKey(x+dx,z+dz))&&pathCells.has(cellKey(x-dx,z-dz)));
    (gate ? gates : wall).push({ x, y, z, ring: name });
    // The threshold is the original path/ground, never an added floor block.
    for (let dy = 1; dy <= height; dy++) blocks.push({ x, y: y + dy, z, id: gate && dy <= gateHeight ? 0 : material });
  }
  return { name, height, pieceIds: pieces.map(p => p.id), wall, gates, blocks, area: [...area], corners: outlineCorners(area) };
}

// Can a normal sprint-jump from a raised platform outside this enclosure
// land on its wall? Use the platform edge, not just the ladder's center.
export function externalPlatformAccess(platform, ring, jump) {
  const area = ringArea(ring);
  if (area.has(cellKey(platform.x, platform.z))) return false;
  const half = platform.width / 2;
  return ring.wall.some(w => {
    const drop = platform.y - w.y - ring.height;
    const discriminant = jump.velocity ** 2 + 2 * jump.gravity * drop;
    if (discriminant < 0) return false;
    const time = (jump.velocity + Math.sqrt(discriminant)) / jump.gravity;
    const dx = Math.max(0, Math.abs(w.x - platform.x) - half), dz = Math.max(0, Math.abs(w.z - platform.z) - half);
    return Math.hypot(dx, dz) <= jump.speed * time + jump.margin;
  });
}
