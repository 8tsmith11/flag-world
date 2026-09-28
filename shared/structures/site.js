import { STRUCTURE_GEN } from '../config.js';
import { mulberry32 } from '../structures.js';
import { cellKey } from './buildability.js';

// Rank, then try in order: the highest-scoring site may not fit a complete plan.
export function selectSites(map, seed, config = STRUCTURE_GEN) {
  const random = mulberry32(seed), candidates = [], r = config.siteRadius, w = config.score;
  for (const c of map.cells.values()) {
    if (c.x % config.siteStride || c.z % config.siteStride || c.edge < r || c.reserved || c.keepOut) continue;
    const ar = config.anchorRadius ?? 0;
    let eligible = true;
    for (let z = c.z - ar; z <= c.z + ar && eligible; z++) for (let x = c.x - ar; x <= c.x + ar; x++) {
      const n = map.cells.get(cellKey(x, z));
      if (!n || n.keepOut || n.reserved || n.water === 'lake') { eligible = false; break; }
    }
    if (!eligible) continue;
    let slope = 0, water = 0, keepOut = 0, count = 0, low = Infinity, high = -Infinity;
    for (let dz = -r; dz <= r; dz += config.siteStride) for (let dx = -r; dx <= r; dx += config.siteStride) {
      const n = map.cells.get(cellKey(c.x + dx, c.z + dz));
      if (!n) { keepOut++; count++; continue; }
      slope += n.slope; water += n.water === 'lake'; keepOut += n.keepOut || n.reserved; count++;
      if(!n.keepOut&&!n.reserved&&n.water!=='lake'){low=Math.min(low,n.ground);high=Math.max(high,n.ground);}
    }
    candidates.push({ x: c.x, z: c.z, y: c.ground,
      score: c.edge * w.edge - (slope * w.slope + water * w.water + keepOut * w.keepOut) / count
        - (Number.isFinite(low)?high-low:0) * w.relief + c.lowland*w.lowland,
      tie: random() });
  }
  return candidates.sort((a, b) => b.score - a.score || a.tie - b.tie).slice(0, config.siteLimit);
}
