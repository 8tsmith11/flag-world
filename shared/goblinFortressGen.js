// Places the starting Goblin Fortress in the central island's deep layer
// (islands.js): a seeded angle and distance within the placement ring, a
// seeded layout (goblinModules.js), as deep as the island's underside
// allows, with natural stone all around. Planned before caves are carved (so
// they can steer clear of it) and built right after.

import { GOBLINS } from './goblins.js';
import { CELL_SIZE, CELL_HEIGHT, planStartingLayout, layoutCells, buildLayout } from './goblinModules.js';
import { mulberry32 } from './structures.js';
import { BLOCK } from './blocks.js';

const NONE = -32768;

// { origin, layout, boxes, bounds, angle, distance, keel } or null.
// `terrain` is the central island's terrain (its getTop / getBottom column
// mask). Each attempt picks a spot in the ring and a layout; it fits if
// every cell has island columns `side` blocks around it, and room for
// `underside` stone below and `cover` above. The deepest fitting position
// wins. If no attempt fits (thin islands), the attempt closest to fitting is
// used, hung from the surface cover, and the island's underside is deepened
// under it with a tapered stone keel (world, terrain updated).
export function planGoblinFortress(world, terrain, seed) {
  if (!terrain) return null;
  const settings = GOBLINS.placement;
  const random = mulberry32(seed ^ 0x60b11f0e);
  const radius = terrain.radius;
  let best = null;
  for (let attempt = 0; attempt < settings.attempts; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = radius * (settings.ringInner + random() * (settings.ringOuter - settings.ringInner));
    const layout = planStartingLayout(random, settings);
    if (!layout) continue;
    // The hall's middle (two cells across) at the chosen spot.
    const ox = Math.round(terrain.x + Math.cos(angle) * distance) - CELL_SIZE;
    const oz = Math.round(terrain.z + Math.sin(angle) * distance) - CELL_SIZE;
    const cells = layoutCells(layout);
    let low = -Infinity, high = Infinity, ok = true;
    for (const [cx, cy, cz] of cells) {
      const x0 = ox + cx * CELL_SIZE, z0 = oz + cz * CELL_SIZE;
      // Never within the inner ring: the cell's nearest point to the center.
      const nx = Math.max(x0, Math.min(terrain.x, x0 + CELL_SIZE - 1));
      const nz = Math.max(z0, Math.min(terrain.z, z0 + CELL_SIZE - 1));
      if (Math.hypot(nx - terrain.x, nz - terrain.z) < radius * settings.ringInner) { ok = false; break; }
      for (let z = z0 - settings.side; z < z0 + CELL_SIZE + settings.side && ok; z++) {
        for (let x = x0 - settings.side; x < x0 + CELL_SIZE + settings.side; x++) {
          const bottom = terrain.getBottom(x, z), top = terrain.getTop(x, z);
          if (bottom === NONE) { ok = false; break; }
          low = Math.max(low, bottom + settings.underside - cy * CELL_HEIGHT);
          high = Math.min(high, top - settings.cover - (cy + 1) * CELL_HEIGHT + 1);
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    const deficit = low - high;
    if (!best || deficit < best.deficit) best = { deficit, ox, oz, y0: deficit <= 0 ? low : high, layout, cells, angle, distance };
    if (deficit <= 0) break;
  }
  if (!best) return null;
  const { ox, oz, y0, layout, cells, angle, distance } = best;
  const boxes = cells.map(([cx, cy, cz]) => ({
    x0: ox + cx * CELL_SIZE, x1: ox + (cx + 1) * CELL_SIZE - 1,
    y0: y0 + cy * CELL_HEIGHT, y1: y0 + (cy + 1) * CELL_HEIGHT - 1,
    z0: oz + cz * CELL_SIZE, z1: oz + (cz + 1) * CELL_SIZE - 1,
  }));
  const bounds = { x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)),
    y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)),
    z0: Math.min(...boxes.map((b) => b.z0)), z1: Math.max(...boxes.map((b) => b.z1)) };
  const keel = best.deficit > 0 ? addKeel(world, terrain, boxes, bounds) : 0;
  return { origin: { x: ox, y: y0, z: oz }, layout, boxes, bounds, angle, distance, keel };
}

// Deepens the island's underside under the fortress: `underside` blocks of
// stone below every cell, rising away from it by keelSlope per block, only in
// columns the island already has. Returns the number of columns deepened.
function addKeel(world, terrain, boxes, bounds) {
  const { underside, keelSlope } = GOBLINS.placement;
  const reach = Math.ceil(((bounds.y1 - bounds.y0) + underside) / keelSlope) + 1;
  let columns = 0;
  for (let z = bounds.z0 - reach; z <= bounds.z1 + reach; z++) {
    for (let x = bounds.x0 - reach; x <= bounds.x1 + reach; x++) {
      const bottom = terrain.getBottom(x, z);
      if (bottom === NONE) continue;
      let need = Infinity;
      for (const b of boxes) {
        const d = Math.max(b.x0 - x, x - b.x1, b.z0 - z, z - b.z1, 0);
        need = Math.min(need, b.y0 - underside + Math.ceil(d * keelSlope));
      }
      if (need >= bottom) continue;
      for (let y = need; y < bottom; y++) world.setBlock(x, y, z, BLOCK.STONE);
      terrain.bottom[x - terrain.x0 + terrain.width * (z - terrain.z0)] = need;
      columns++;
    }
  }
  return columns;
}

// Whether (x, y, z) is within `margin` of a planned fortress cell.
export function nearFortress(plan, x, y, z, margin = GOBLINS.placement.caveClearance) {
  if (!plan) return false;
  const all = plan.bounds;
  if (x < all.x0 - margin || x > all.x1 + margin || y < all.y0 - margin || y > all.y1 + margin
    || z < all.z0 - margin || z > all.z1 + margin) return false;
  return plan.boxes.some((b) => x >= b.x0 - margin && x <= b.x1 + margin
    && y >= b.y0 - margin && y <= b.y1 + margin && z >= b.z0 - margin && z <= b.z1 + margin);
}

// Builds the planned fortress; the graph goes in world.goblinFortress.
export function buildGoblinFortress(world, plan) {
  const fortress = buildLayout(world, plan.origin, plan.layout);
  fortress.placement = { angle: plan.angle, distance: plan.distance, keelColumns: plan.keel };
  world.goblinFortress = fortress;
  return fortress;
}
