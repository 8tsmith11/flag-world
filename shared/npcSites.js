// NPC places, generated after terrain, the gorge and the goblin village and
// before optional structures and trees (which then keep clear of them):
//   - a Wise Monkey shrine on each team island: an open, roofed platform
//     with a large chair, away from the keep, on a levelled pad
//   - the Ancient Water Monkey's seat in the gorge's river cave (or, without
//     a cave, in the gorge river itself)
//   - a hollow storm cloud past the highland edge of the central island,
//     with the Ancient Lightning Monkey's seat on its floor
// Results: world.npcSites ([{ npc, team?, x, y, z, yaw, fallback? }], feet
// positions), world.stormCloud and shrine/cloud boxes in world.structures.
// Everything is seeded; tuning is SHRINE_GEN and STORM_CLOUD in config.js.

import { BLOCK, isSolid, isWater } from './blocks.js';
import { SHRINE_GEN as S, STORM_CLOUD as C, NPC } from './config.js';
import { mulberry32, prepareSurface, surfaceStats } from './structures.js';
import { NPC_KIND } from './npcs.js';

const between = (random, [lo, hi]) => lo + random() * (hi - lo);
const betweenInt = (random, [lo, hi]) => lo + Math.floor(random() * (hi - lo + 1));
// Yaw 0 faces -Z, like players: facing (dx, dz) is atan2(-dx, -dz).
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export function generateNpcSites(world, terrains, seed) {
  world.npcSites = [];
  for (const terrain of terrains) if (terrain.kind === 'team') placeShrine(world, terrain, seed);
  placeWaterMonkey(world);
  placeStormCloud(world, terrains.find((terrain) => terrain.kind === 'center'), seed);
}

// ---- Wise Monkey shrines ----

function boxesOverlap(a, b, margin) {
  return a.x0 <= b.x1 + margin && a.x1 >= b.x0 - margin && a.z0 <= b.z1 + margin && a.z1 >= b.z0 - margin;
}

function shrineSite(world, terrain, keep, random) {
  const reach = S.half + S.margin;
  for (let attempt = 0; attempt < S.attempts; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * terrain.radius * S.maxRadius;
    const x = Math.round(terrain.x + Math.cos(angle) * distance);
    const z = Math.round(terrain.z + Math.sin(angle) * distance);
    if (keep && Math.hypot(x - keep.cx, z - keep.cz) < S.keepDistance + S.half) continue;
    const stats = surfaceStats(terrain.getTop, x - S.half, z - S.half, x + S.half, z + S.half);
    if (!stats || stats.variance > S.maxVariance) continue;
    // The levelled pad and its slope stay on the island, dry and unclaimed.
    if (!surfaceStats(terrain.getTop, x - reach, z - reach, x + reach, z + reach)) continue;
    const box = { x0: x - reach, x1: x + reach, z0: z - reach, z1: z + reach };
    if (world.structures.some((s) => s.box && boxesOverlap(box, s.box, 2))) continue;
    let wet = false;
    for (let zz = box.z0; zz <= box.z1 && !wet; zz++) for (let xx = box.x0; xx <= box.x1 && !wet; xx++) {
      const top = terrain.getTop(xx, zz);
      for (let y = top - 4; y <= top + 2 && !wet; y++) wet = isWater(world.getBlock(xx, y, zz));
    }
    if (wet || world.getBlock(x, terrain.getTop(x, z), z) !== BLOCK.GRASS) continue;
    return { x, z, floorY: stats.median };
  }
  return null;
}

function placeShrine(world, terrain, seed) {
  const team = terrain.teamIndex;
  const random = mulberry32(seed ^ S.seedSalt ^ Math.imul(team + 1, 0x27d4eb2f));
  const keep = world.keeps[team];
  const site = shrineSite(world, terrain, keep, random);
  if (!site) return;
  const { x, z, floorY } = site, h = S.half, top = floorY + S.roofHeight;
  prepareSurface(world, x - h, z - h, x + h, z + h, floorY, terrain.getTop,
    { margin: S.margin, clearTo: top + h + 2, foundation: BLOCK.STONE });
  // The chair's front faces the keep, along the nearer axis.
  const toX = keep ? keep.cx - x : terrain.x - x, toZ = keep ? keep.cz - z : terrain.z - z;
  const [fx, fz] = Math.abs(toX) >= Math.abs(toZ) ? [Math.sign(toX) || 1, 0] : [0, Math.sign(toZ) || 1];
  // Cell `depth` steps along the facing and `side` steps across it.
  const cell = (depth, side) => [x + fx * depth - fz * side, z + fz * depth + fx * side];
  const set = (depth, side, y, id) => { const [cx, cz] = cell(depth, side); world.setBlock(cx, y, cz, id); };

  for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) {
    const roll = random();
    world.setBlock(x + dx, floorY, z + dz, roll < 0.15 ? BLOCK.MOSSY_STONE_BRICKS
      : roll < 0.25 ? BLOCK.CRACKED_STONE_BRICKS : BLOCK.STONE_BRICKS);
  }
  for (const dx of [-h, h]) for (const dz of [-h, h]) {
    for (let y = floorY + 1; y < top; y++) world.setBlock(x + dx, y, z + dz, BLOCK.WOOD);
  }
  // A stepped roof overhanging the platform by one block.
  for (let layer = 0; layer <= h + 1; layer++) {
    const r = h + 1 - layer;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const rim = Math.max(Math.abs(dx), Math.abs(dz)) === r;
      world.setBlock(x + dx, top + layer, z + dz, layer === h + 1 ? BLOCK.WOOD
        : rim ? BLOCK.PLANKS : BLOCK.STONE_BRICKS);
    }
  }
  // The large chair against the back: a two-deep seat, arms and a tall back.
  for (const side of [-1, 0, 1]) {
    for (const depth of [-1, -2]) set(depth, side, floorY + 1, BLOCK.PLANKS);
    for (let y = floorY + 1; y <= floorY + 4; y++) set(-3, side, y, side === 0 && y === floorY + 4 ? BLOCK.PLANKS : BLOCK.WOOD);
  }
  set(-3, 0, floorY + 5, BLOCK.WOOD);
  for (const side of [-2, 2]) for (const depth of [-1, -2]) {
    set(depth, side, floorY + 1, BLOCK.PLANKS);
    set(depth, side, floorY + 2, BLOCK.WOOD);
  }
  // Torches beside each pillar; attachGeneratedTorches turns them to face it.
  for (const side of [-2, 2]) set(3, side, floorY + 3, BLOCK.TORCH);
  for (const side of [-3, 3]) set(-2, side, floorY + 3, BLOCK.TORCH);
  world.structures.push({ kind: 'monkeyShrine', islandKind: 'team', teamIndex: team, x, y: floorY, z,
    box: { x0: x - h - 1, x1: x + h + 1, z0: z - h - 1, z1: z + h + 1, y0: floorY, y1: top + h + 1 } });
  // Seated on the chair, between its two seat rows.
  world.npcSites.push({ npc: NPC_KIND.WISE_MONKEY, team, x: x + 0.5 - fx * 1.5, y: floorY + 2,
    z: z + 0.5 - fz * 1.5, yaw: yawOf(fx, fz) });
}

// ---- The Ancient Water Monkey ----

// The river bed under a water column near (x, z), with enough headroom for
// a standing Ancient Monkey: { x, y (feet), z, depth, headroom } or null.
function riverSeat(world, x, z, waterY) {
  if (!isWater(world.getBlock(x, waterY, z))) return null;
  let bed = waterY;
  while (bed > world.minY && isWater(world.getBlock(x, bed - 1, z))) bed--;
  if (!isSolid(world.getBlock(x, bed - 1, z))) return null;
  let headroom = 0;
  while (headroom < 32 && !isSolid(world.getBlock(x, bed + headroom, z))) headroom++;
  if (headroom < NPC.ancientMonkey.box.height + 1) return null;
  return { x: x + 0.5, y: bed, z: z + 0.5, depth: waterY - bed + 1, headroom };
}

function placeWaterMonkey(world) {
  const cave = world.gorgeCave;
  const gorge = world.rivers?.[0];
  // Points along the underground river, or along the gorge river without one.
  const points = cave?.points?.length ? cave.points : gorge?.points ?? [];
  if (!points.length) return;
  // Search out from the middle; prefer the roomiest seat near it.
  const order = points.map((_, i) => i).sort((a, b) =>
    Math.abs(a - points.length / 2) - Math.abs(b - points.length / 2));
  let best = null;
  for (const i of order.slice(0, Math.ceil(points.length / 2))) {
    const p = points[i];
    for (let r = 0; r <= 2 && !best?.found; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const seat = riverSeat(world, Math.round(p.x) + dx, Math.round(p.z) + dz, p.waterY);
      if (!seat) continue;
      const score = Math.min(seat.headroom, 8) + Math.min(seat.depth, 2) - Math.abs(i - points.length / 2) * 0.02;
      if (!best || score > best.score) best = { seat, score, i };
    }
    if (best && best.score >= 9) break;
  }
  if (!best) return;
  // Facing upstream, toward where players come in from the gorge.
  const toward = points[Math.max(0, best.i - 3)], from = points[best.i];
  world.npcSites.push({ npc: NPC_KIND.ANCIENT_WATER_MONKEY, x: best.seat.x, y: best.seat.y, z: best.seat.z,
    yaw: yawOf(toward.x - from.x, toward.z - from.z) || 0,
    ...(cave?.points?.length ? {} : { fallback: 'gorgeRiver' }) });
}

// ---- The storm cloud and the Ancient Lightning Monkey ----

function cloudShape(random) {
  const rh = between(random, C.radius), rv = between(random, C.height);
  const puffs = Array.from({ length: betweenInt(random, C.puffs) }, () => {
    const angle = random() * Math.PI * 2, rise = random() * 0.9 - 0.2;
    return { x: Math.cos(angle) * rh * 0.8 * Math.cos(rise), y: Math.sin(rise) * rv * 0.8,
      z: Math.sin(angle) * rh * 0.8 * Math.cos(rise), r: between(random, C.puffRadius) };
  });
  const gapCount = betweenInt(random, C.gaps), gapStart = random() * Math.PI * 2;
  const gaps = Array.from({ length: gapCount }, (_, i) => ({
    angle: gapStart + i * Math.PI * 2 / gapCount + (random() - 0.5) * 0.5,
    // The first opening is a doorway at floor level; the others are windows.
    rise: i === 0 ? 2 : 2 + betweenInt(random, [0, 2]),
  }));
  return { rh, rv, puffs, gaps };
}

// Offsets (dx, dy, dz) from the cloud center: 'shell', 'floor' or null.
function cloudCell(shape, dx, dy, dz) {
  const { rh, rv, puffs } = shape;
  // Flatter underneath, like a real cloud base.
  const v = dy < 0 ? rv * 0.75 : rv;
  const main = (dx / rh) ** 2 + (dy / v) ** 2 + (dz / rh) ** 2;
  const puff = puffs.some((p) => (dx - p.x) ** 2 + (dy - p.y) ** 2 + (dz - p.z) ** 2 <= p.r * p.r);
  if (main > 1 && !puff) return null;
  const ih = rh - C.shell, iv = v - C.shell;
  const inner = (dx / ih) ** 2 + (dy / iv) ** 2 + (dz / ih) ** 2 <= 1;
  if (inner && dy > -C.floorDrop) return 'air';
  return 'solid';
}

function placeStormCloud(world, central, seed) {
  if (!central || !world.centralRegions) return;
  const random = mulberry32(seed ^ C.seedSalt);
  const shape = cloudShape(random);
  const reach = Math.ceil(shape.rh + Math.max(...shape.puffs.map((p) => p.r)) + 1);
  const reachY = Math.ceil(shape.rv + Math.max(...shape.puffs.map((p) => p.r)) + 1);
  for (let attempt = 0; attempt < C.attempts; attempt++) {
    const angle = world.centralRegions.angle + (attempt ? (random() * 2 - 1) * C.angleJitter : 0);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let edge = 0;
    while (edge < central.radius * 2 && central.getTop(Math.round(central.x + cos * edge),
      Math.round(central.z + sin * edge)) !== -32768) edge++;
    const cx = Math.round(central.x + cos * (edge + shape.rh * C.edgeOffset));
    const cz = Math.round(central.z + sin * (edge + shape.rh * C.edgeOffset));
    // Above the highest ground of the highland edge beneath it.
    let ground = -Infinity;
    for (let d = Math.max(0, edge - C.sampleRadius); d <= edge; d += 2) {
      for (const side of [-1, -0.5, 0, 0.5, 1]) {
        const a = angle + side * C.sampleRadius / Math.max(edge, 1);
        ground = Math.max(ground, central.getTop(Math.round(central.x + Math.cos(a) * d),
          Math.round(central.z + Math.sin(a) * d)));
      }
    }
    let floorY = ground + C.clearance;
    floorY = Math.min(floorY, world.sizeY - 1 - C.topMargin - reachY - C.floorDrop);
    const cy = floorY + C.floorDrop;
    if (floorY < ground + C.clearance / 2) return;
    const cells = [];
    let clear = true;
    for (let dy = -reachY; dy <= reachY && clear; dy++) for (let dz = -reach; dz <= reach && clear; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const kind = cloudCell(shape, dx, dy, dz);
        if (!kind) continue;
        const x = cx + dx, y = cy + dy, z = cz + dz;
        if (!world.inBounds(x, y, z) || world.getBlock(x, y, z) !== BLOCK.AIR) { clear = false; break; }
        if (kind === 'solid') cells.push([x, y, z]);
      }
    }
    if (!clear) continue;
    for (const [x, y, z] of cells) world.setBlock(x, y, z, BLOCK.STORM_CLOUD);
    // Openings through the shell above the floor: the doorway faces the island.
    const gaps = shape.gaps.map((gap, i) => ({ ...gap, angle: i === 0 ? angle + Math.PI : gap.angle }));
    for (const gap of gaps) {
      const gx = Math.cos(gap.angle), gz = Math.sin(gap.angle), gy = floorY + gap.rise;
      for (let d = shape.rh - C.shell - 1; d <= reach; d += 0.5) {
        const px = cx + 0.5 + gx * d, pz = cz + 0.5 + gz * d;
        const r = C.gapRadius;
        for (let y = Math.max(floorY + 1, Math.floor(gy - r)); y <= Math.ceil(gy + r); y++) {
          for (let z = Math.floor(pz - r); z <= Math.ceil(pz + r); z++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
            if ((x + 0.5 - px) ** 2 + (y + 0.5 - gy) ** 2 + (z + 0.5 - pz) ** 2 > r * r) continue;
            if (world.getBlock(x, y, z) === BLOCK.STORM_CLOUD) world.setBlock(x, y, z, BLOCK.AIR);
          }
        }
      }
    }
    world.stormCloud = { x: cx + 0.5, y: cy, z: cz + 0.5, floorY, radius: shape.rh, height: shape.rv,
      gaps: gaps.map((gap) => ({ x: cx + 0.5 + Math.cos(gap.angle) * shape.rh,
        y: floorY + gap.rise, z: cz + 0.5 + Math.sin(gap.angle) * shape.rh })) };
    world.structures.push({ kind: 'stormCloud', islandKind: 'center', teamIndex: null, x: cx, y: cy - reachY, z: cz,
      box: { x0: cx - reach, x1: cx + reach, z0: cz - reach, z1: cz + reach, y0: cy - reachY, y1: cy + reachY } });
    world.npcSites.push({ npc: NPC_KIND.ANCIENT_LIGHTNING_MONKEY, x: cx + 0.5, y: floorY + 1, z: cz + 0.5,
      yaw: yawOf(-cos, -sin) });
    return;
  }
}
