// Floating-island world gen for the Small / Medium / Large world sizes.
//
// Three zones around the world center, sized by the WORLD_SIZES entry:
//   1. A large center island, the thickest and tallest, with hills.
//   2. The middle ring: medium islands placed with noise-varied density at
//      staggered altitudes. Every keep gets its own ring island.
//   3. The outer scatter: small islands with big gaps.
// Each island has a noise-eroded outline, a hilly grass/dirt/stone top and a
// jagged underside (one spike, a blunt bulb, or several spikes). It is built in
// its own buffer and flood-filled to drop fragments under MIN_FRAGMENT blocks
// before being written to the world. The center island and ring islands wider
// than CAVE_MIN_WIDTH get noise caves carved first. Then come keeps, a few winding
// land bridges, lines of stepping stones, floating rock crumbs, and trees.
//
// Everything is drawn from seeded PRNG streams and noise, so the server and
// every client build the same world.

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { KEEP_HEIGHT } from './config.js';
import { BLOCK, isSolid } from './blocks.js';
import { World } from './world.js';
import { mulberry32, KEEP_REACH, buildKeep, plantTrees, sandShores } from './structures.js';

// Tuning shared by every island world size. Altitudes are the base height of
// an island's top surface; hills rise above it.
const CENTER_TOP = 88;
// The center island is nudged up to this far off the world center.
const CENTER_JITTER = 8;
const RING_TOP = 66;
const RING_TOP_SPREAD = 22;
const OUTER_TOP = 64;
const OUTER_TOP_SPREAD = 36;
const RING_WIDTH = [45, 75];
const OUTER_WIDTH = [5, 15];
// Keep islands are ring islands wide enough to hold a keep off-center.
const KEEP_ISLAND_WIDTH = [50, 70];
// Islands per square block of zone area, and the minimum gap between islands.
// (About 35% of the ring's area ends up island: big islands can't pack tighter at random.)
const RING_DENSITY = 0.0003;
const OUTER_DENSITY = 0.00008;
const RING_GAP = 1;
const OUTER_GAP = 24;
// Undersides never reach below this, so the void (y < VOID_Y) is always far below.
const MIN_BOTTOM = 4;
// Connected pieces smaller than this are removed from each island.
const MIN_FRAGMENT = 8;
// Connections: chance per nearby ring pair, max gap they span, bridges to the center.
const BRIDGE_CHANCE = 0.3;
const STONES_CHANCE = 0.3;
const MAX_CONNECT_GAP = 45;
const CENTER_BRIDGES = 2;
const STONE_SPACING = 3;
const CRUMB_CHANCE = 0.35;
// Caves (see carveCaves): worm tunnels. Radii and steps in blocks.
const CAVE_MIN_WIDTH = 25;
const CAVE_SHELL = 3;
// No carving this close to a keep's flattened area.
const CAVE_KEEP_CLEARANCE = 6;
// Worms per square block of island (center island; ring islands get fewer).
const WORM_DENSITY = 1 / 480;
const WORM_RADIUS = [1.9, 2.8];
const WORM_STEP = 0.8;
// How fast a worm turns and how its width wanders, per step along it.
const WORM_TURN = 0.2;
const WORM_CLIMB = 0.1;
const WORM_MAX_PITCH = 0.55;
const ENTRANCE_CHANCE = 0.4;
// Round rooms along some center island worms.
const CHAMBER_CHANCE = 0.15;
const CHAMBER_RADIUS = [4, 7];
// Iron ore: blobby 3D noise veins through stone. Stone next to air (cave
// walls, undersides, cliffs) needs less, and the center island less again.
const ORE_SCALE = 1 / 5;
const ORE_THRESHOLD = 0.87;
const ORE_CENTER_BONUS = 0.04;
const ORE_EXPOSED_BONUS = 0.1;
// Ponds: on islands at least this wide, with sand shores.
const POND_MIN_WIDTH = 40;
const POND_RADIUS = [2, 4];

const lerp = ([a, b], t) => a + (b - a) * t;

export function generateIslandWorld(seed, playerCount, layout) {
  const world = new World(seed, layout.width, layout.width, { sizeY: layout.height });
  const random = mulberry32(seed ^ 0x2c1b3c6d);
  const noise = createNoise2D(mulberry32(seed ^ 0x68e31da4));
  const noise3 = createNoise3D(mulberry32(seed ^ 0x1b873593));
  const mid = layout.width / 2;

  // 1. Center island, nudged off the exact center.
  const centerWidth = lerp(layout.center, random());
  // The layout is for the widest center island; pull everything else in to
  // match this one, so the gap to the ring is the same whatever its size.
  const pull = (layout.center[1] - centerWidth) / 2;
  const cfg = {
    ...layout,
    ring: layout.ring.map((r) => r - pull),
    outer: layout.outer.map((r) => r - pull),
    keepDistance: layout.keepDistance - pull,
  };
  const center = makeIsland(random, 'center',
    mid + (random() * 2 - 1) * CENTER_JITTER, mid + (random() * 2 - 1) * CENTER_JITTER,
    centerWidth, CENTER_TOP);
  const islands = [center];

  // 2a. Keep islands, one per player, each holding its keep off-center.
  const sites = placeKeepSites(random, playerCount, cfg, mid);
  const keepIslands = sites.map((site) => {
    const width = lerp(KEEP_ISLAND_WIDTH, random());
    const r = width / 2;
    // Keep the keep's whole footprint inside the island's least-eroded outline.
    const maxOffset = Math.max(0, r * 0.72 - KEEP_REACH * 1.42);
    const angle = random() * Math.PI * 2, offset = random() * maxOffset;
    const top = RING_TOP + (random() - 0.5) * RING_TOP_SPREAD;
    const island = makeIsland(random, 'keep', site.x - Math.cos(angle) * offset, site.z - Math.sin(angle) * offset, width, top);
    island.keepSite = { cx: Math.floor(site.x), cz: Math.floor(site.z) };
    return island;
  });
  islands.push(...keepIslands);

  // 2b. The rest of the middle ring: uniform over the ring's area, thinned by
  // low-frequency noise so it clusters in some places and is sparse in others.
  // Whole islands stay inside the ring, so the gap to the center is exact.
  const [r0, r1] = cfg.ring;
  const ringTarget = Math.round(Math.PI * (r1 * r1 - r0 * r0) * RING_DENSITY);
  const ring = [...keepIslands];
  for (let tries = 0, placed = 0; placed < ringTarget && tries < ringTarget * 40; tries++) {
    const angle = random() * Math.PI * 2;
    const width = lerp(RING_WIDTH, random());
    const [a0, a1] = [r0 + width / 2, r1 - width / 2];
    const dist = Math.sqrt(a0 * a0 + random() * (a1 * a1 - a0 * a0));
    const x = mid + Math.cos(angle) * dist, z = mid + Math.sin(angle) * dist;
    const top = RING_TOP + (random() - 0.5) * RING_TOP_SPREAD;
    // Clustered where this is high, sparse (but not empty) where it's low.
    const density = noise(x / 140 + 300, z / 140 + 300) * 0.5 + 0.5;
    if (random() > 0.45 + density * density * 1.2) continue;
    if (overlaps(islands, x, z, width / 2, RING_GAP)) continue;
    const island = makeIsland(random, 'ring', x, z, width, top);
    islands.push(island);
    ring.push(island);
    placed++;
  }

  // 3. Outer scatter.
  const [o0, o1] = cfg.outer;
  const outerTarget = Math.round(Math.PI * (o1 * o1 - o0 * o0) * OUTER_DENSITY);
  for (let tries = 0, placed = 0; placed < outerTarget && tries < outerTarget * 40; tries++) {
    const angle = random() * Math.PI * 2;
    const width = lerp(OUTER_WIDTH, random());
    const [a0, a1] = [o0 + width / 2, o1 - width / 2];
    const dist = Math.sqrt(a0 * a0 + random() * (a1 * a1 - a0 * a0));
    const x = mid + Math.cos(angle) * dist, z = mid + Math.sin(angle) * dist;
    const top = OUTER_TOP + (random() - 0.5) * OUTER_TOP_SPREAD;
    if (overlaps(islands, x, z, width / 2, OUTER_GAP)) continue;
    islands.push(makeIsland(random, 'outer', x, z, width, top));
    placed++;
  }

  for (const island of islands) writeIsland(world, carveIsland(island, noise, noise3, random));

  // Keeps, flattening the ground under them. Players are assigned in lobby order.
  world.keeps = keepIslands.map((island) => {
    const { cx, cz } = island.keepSite;
    const floorY = Math.min(world.sizeY - KEEP_HEIGHT - 2, world.getSurfaceY(cx, cz, isSolid));
    const keep = { cx, cz, floorY };
    buildKeep(world, keep, { fillDepth: 12, clearTo: Math.min(world.sizeY, floorY + KEEP_HEIGHT + 16) });
    return keep;
  });

  connectIslands(world, random, noise, ring, center);
  for (const island of islands) {
    if (island.kind !== 'outer' && island.r * 2 >= POND_MIN_WIDTH) addPonds(world, random, noise, island);
  }
  for (const island of islands) {
    if (island.kind !== 'center' && random() < CRUMB_CHANCE) addCrumbs(world, random, island);
  }
  plantTrees(world, seed, { requireFooting: true });
  world.islands = islands;
  return world;
}

// Keep sites at random angles around the keep distance, at least keepSpacing
// apart. If that's impossible (too many players), they're spread evenly.
function placeKeepSites(random, playerCount, cfg, mid) {
  const n = Math.max(1, playerCount);
  const jitter = cfg.keepDistance * 0.06;
  const at = (angle, dist) => ({ x: mid + Math.cos(angle) * dist, z: mid + Math.sin(angle) * dist });
  for (let attempt = 0; attempt < 50; attempt++) {
    const sites = [];
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 60; t++) {
        const site = at(random() * Math.PI * 2, cfg.keepDistance + (random() * 2 - 1) * jitter);
        if (sites.every((s) => Math.hypot(s.x - site.x, s.z - site.z) >= cfg.keepSpacing)) {
          sites.push(site);
          break;
        }
      }
      if (sites.length !== i + 1) break;
    }
    if (sites.length === n) return sites;
  }
  const start = random() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => at(start + (Math.PI * 2 * i) / n, cfg.keepDistance));
}

function overlaps(islands, x, z, r, gap) {
  return islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + gap);
}

// Island parameters. Draws the same number of random values for every island.
function makeIsland(random, kind, x, z, width, top) {
  const r = width / 2;
  const shapes = ['spike', 'bulb', 'spikes'];
  const pick = random();
  // The center island is always a big blunt mass or a cluster of spikes.
  const underside = kind === 'center' ? (pick < 0.5 ? 'bulb' : 'spikes') : shapes[Math.floor(pick * 3)];
  const baseDepth = r * { spike: 1.3, bulb: 0.8, spikes: 1.0 }[underside] * (kind === 'center' ? 1.15 : 1);
  const island = {
    kind, x, z, r, top: Math.round(top), underside,
    ox: random() * 10000, oz: random() * 10000,
    hillAmp: Math.max(1, r * (kind === 'center' ? 0.16 : 0.12)),
    depth: Math.min(baseDepth, top - MIN_BOTTOM - 3),
    // Keep islands erode less at the edge, so their keep sits on solid ground.
    edgeNoise: kind === 'keep' ? 0.1 : 0.2,
    spikes: [],
  };
  const count = 3 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2, dist = random() * r * 0.6;
    const spike = {
      dx: Math.cos(angle) * dist, dz: Math.sin(angle) * dist,
      r: r * (0.25 + random() * 0.2), depth: island.depth * (0.6 + random() * 0.5),
    };
    if (underside === 'spikes') island.spikes.push(spike);
  }
  return island;
}

// How far below the top the island goes at a column: a thin rim everywhere,
// plus the underside shape, roughened with noise. t: 0 at the center, 1 at the edge.
function undersideDepth(island, t, dx, dz, jag) {
  const rim = 2 + island.r * 0.08 * (1 - t);
  let cone;
  if (island.underside === 'spike') {
    cone = island.depth * (1 - t) ** 1.8;
  } else if (island.underside === 'bulb') {
    cone = island.depth * Math.sqrt(Math.max(0, 1 - t * t));
  } else {
    cone = island.depth * 0.25 * (1 - t * t);
    for (const s of island.spikes) {
      const d = Math.hypot(dx - s.dx, dz - s.dz) / s.r;
      if (d < 1) cone = Math.max(cone, s.depth * (1 - d) ** 1.5);
    }
  }
  return rim + cone * jag;
}

// Builds one island into its own box of blocks, carves its caves, then removes
// small fragments.
function carveIsland(island, noise, noise3, random) {
  const { r, ox, oz } = island;
  const ext = Math.ceil(r * 1.2) + 1;
  const x0 = Math.floor(island.x) - ext, z0 = Math.floor(island.z) - ext;
  const sx = ext * 2 + 1, sz = sx;
  const yTop = island.top + Math.ceil(island.hillAmp) + 1;
  const y0 = MIN_BOTTOM;
  const sy = yTop - y0 + 1;
  const data = new Uint8Array(sx * sy * sz);
  const index = (lx, ly, lz) => lx + sx * (lz + sz * ly);
  // Per column: the top and bottom block y, or -1 for an empty column.
  const colTop = new Int32Array(sx * sz).fill(-1);
  const colBottom = new Int32Array(sx * sz).fill(-1);

  for (let lz = 0; lz < sz; lz++) {
    for (let lx = 0; lx < sx; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const dx = wx + 0.5 - island.x, dz = wz + 0.5 - island.z;
      const d = Math.hypot(dx, dz) / r;
      if (d > 1.2) continue;
      // Outline: broad lobes around the rim plus finer bites.
      const a = Math.atan2(dz, dx);
      const edge = 1 - island.edgeNoise
        + island.edgeNoise * noise(Math.cos(a) * 1.2 + ox, Math.sin(a) * 1.2 + oz)
        + 0.08 * noise(wx / 6 + ox, wz / 6 + oz);
      if (d >= edge) continue;
      const t = d / edge;

      const hill = noise(wx / (r * 0.6 + 6) + ox, wz / (r * 0.6 + 6) + oz) * 0.5 + 0.5;
      const top = island.top + Math.round(island.hillAmp * hill * (1 - t * t));
      const dirt = 2 + Math.floor((noise(wx / 9 + oz, wz / 9 + ox) * 0.5 + 0.5) * 3.99);
      const jag = 0.7 + 0.6 * (noise(wx / 3.5 + ox, wz / 3.5 + oz) * 0.5 + 0.5);
      const bottom = Math.max(y0, top - dirt - Math.round(undersideDepth(island, t, dx, dz, jag)));
      colTop[lx + lz * sx] = top;
      colBottom[lx + lz * sx] = bottom;
      for (let y = bottom; y <= top; y++) {
        const id = y === top ? BLOCK.GRASS : y > top - dirt ? BLOCK.DIRT : BLOCK.STONE;
        data[index(lx, y - y0, lz)] = id;
      }
    }
  }
  const box = { x0, y0, z0, sx, sy, sz, data, colTop, colBottom };
  if (island.kind === 'center' || (island.kind !== 'outer' && island.r * 2 > CAVE_MIN_WIDTH)) carveCaves(island, box, noise3, random);
  placeOre(island, box, noise3);
  removeFragments(data, sx, sy, sz);
  return box;
}

// Worm caves, like classic Minecraft: each worm starts inside the island and
// crawls along a smooth, winding path (its turning and climbing come from
// smooth noise, so it curves rather than jitters), carving a ball at every
// step. The result is a round tube 4-6 blocks across whose width swells and
// narrows a little. Worms keep a shell of CAVE_SHELL blocks of rock around
// them, except the ones that end as entrances, which steer out through a
// cliff, the underside or the top. Some center island worms open into a
// round room.
function carveCaves(island, box, noise3, random) {
  const { x0, y0, z0, sx, sy, sz, data, colTop, colBottom } = box;
  const column = (lx, lz) => (lx >= 0 && lz >= 0 && lx < sx && lz < sz ? lx + lz * sx : -1);
  const keep = island.keepSite;
  const nearKeep = (wx, wz) => keep
    && Math.abs(wx - keep.cx) <= KEEP_REACH + CAVE_KEEP_CLEARANCE
    && Math.abs(wz - keep.cz) <= KEEP_REACH + CAVE_KEEP_CLEARANCE;

  // At least CAVE_SHELL blocks of island above, below and to every side.
  const shellOffsets = [[0, 0], [CAVE_SHELL, 0], [-CAVE_SHELL, 0], [0, CAVE_SHELL], [0, -CAVE_SHELL],
    [2, 2], [2, -2], [-2, 2], [-2, -2]];
  const interior = (lx, y, lz) => shellOffsets.every(([dx, dz]) => {
    const c = column(lx + dx, lz + dz);
    return c >= 0 && colTop[c] >= 0 && y >= colBottom[c] + CAVE_SHELL && y <= colTop[c] - CAVE_SHELL;
  });
  const inside = (lx, y, lz) => {
    const c = column(lx, lz);
    return c >= 0 && colTop[c] >= 0 && y >= colBottom[c] && y <= colTop[c];
  };

  // Clears a ball (squash < 1 flattens it) around a point in box coordinates.
  // open: allowed to break through the shell (entrances).
  const carve = (px, py, pz, radius, squash, open) => {
    const ry = radius * squash;
    for (let lz = Math.floor(pz - radius); lz <= Math.floor(pz + radius); lz++) {
      for (let lx = Math.floor(px - radius); lx <= Math.floor(px + radius); lx++) {
        if (column(lx, lz) < 0 || nearKeep(x0 + lx, z0 + lz)) continue;
        for (let y = Math.floor(py - ry); y <= Math.floor(py + ry); y++) {
          const ly = y - y0;
          if (ly < 0 || ly >= sy) continue;
          const d = ((lx + 0.5 - px) / radius) ** 2 + ((y + 0.5 - py) / ry) ** 2 + ((lz + 0.5 - pz) / radius) ** 2;
          if (d > 1 || (!open && !interior(lx, y, lz))) continue;
          data[lx + sx * (lz + sz * ly)] = 0;
        }
      }
    }
  };

  // A random point well inside the island, or null.
  const cx = island.x - x0, cz = island.z - z0;
  const pickInterior = () => {
    for (let tries = 0; tries < 12; tries++) {
      const a = random() * Math.PI * 2, d = Math.sqrt(random()) * island.r * 0.75;
      const lx = Math.floor(cx + Math.cos(a) * d), lz = Math.floor(cz + Math.sin(a) * d);
      const c = column(lx, lz);
      if (c < 0 || colTop[c] < 0) continue;
      const low = colBottom[c] + CAVE_SHELL + 3, high = colTop[c] - CAVE_SHELL - 3;
      const y = Math.floor(low + random() * (high - low + 1));
      if (high >= low && interior(lx, y, lz) && !nearKeep(x0 + lx, z0 + lz)) return { x: lx + 0.5, y: y + 0.5, z: lz + 0.5 };
    }
    return null;
  };

  const worm = (start) => {
    let { x, y, z } = start;
    let yaw = random() * Math.PI * 2, pitch = (random() - 0.5) * 0.3;
    const radius = WORM_RADIUS[0] + random() * (WORM_RADIUS[1] - WORM_RADIUS[0]);
    const length = Math.floor(Math.min(200, island.r * (1.5 + random() * 1.5)) / WORM_STEP);
    const exits = random() < ENTRANCE_CHANCE;
    const exitMode = ['side', 'bottom', 'top'][Math.floor(random() * 3)];
    const exitAt = Math.floor(length * 0.6);
    // This worm's own track through the noise, so worms wind differently.
    const track = random() * 1000;
    let outside = 0;
    for (let step = 0; step < length + 60; step++) {
      const exiting = exits && step >= exitAt;
      if (!exiting && step >= length) break;
      const t = step * 0.05;
      const r = radius * (0.85 + 0.3 * (noise3(t * 0.7, track, 100) * 0.5 + 0.5));
      carve(x, y, z, r, 1, exiting);
      yaw += noise3(t, track, 0) * WORM_TURN;
      pitch = Math.max(-WORM_MAX_PITCH, Math.min(WORM_MAX_PITCH, pitch * 0.92 + noise3(t, track, 50) * WORM_CLIMB));
      if (exiting) {
        // Steer out: away from the island center, or down / up.
        if (exitMode === 'side') {
          const out = Math.atan2(z - cz, x - cx);
          yaw += Math.atan2(Math.sin(out - yaw), Math.cos(out - yaw)) * 0.15;
          pitch *= 0.7;
        } else {
          pitch += ((exitMode === 'bottom' ? -1 : 1) - pitch) * 0.15;
        }
      }
      x += Math.cos(yaw) * Math.cos(pitch) * WORM_STEP;
      z += Math.sin(yaw) * Math.cos(pitch) * WORM_STEP;
      y += Math.sin(pitch) * WORM_STEP;
      if (!inside(Math.floor(x), Math.floor(y), Math.floor(z))) {
        // An entrance carries on a couple of blocks into the open; anything else stops.
        if (!exiting || ++outside > 3) break;
      }
    }
  };

  const center = island.kind === 'center';
  const area = Math.PI * island.r * island.r;
  const worms = Math.max(1, Math.round(area * WORM_DENSITY * (center ? 1 : 0.5)));
  for (let i = 0; i < worms; i++) {
    const at = pickInterior();
    if (!at) continue;
    if (center && random() < CHAMBER_CHANCE) {
      carve(at.x, at.y, at.z, CHAMBER_RADIUS[0] + random() * (CHAMBER_RADIUS[1] - CHAMBER_RADIUS[0]), 0.6, false);
    }
    worm(at);
  }
}

// Iron ore veins (see ORE_*), after caves so cave walls count as exposed.
function placeOre(island, box, noise3) {
  const { x0, y0, z0, sx, sy, sz, data } = box;
  const layer = sx * sz;
  const base = ORE_THRESHOLD - (island.kind === 'center' ? ORE_CENTER_BONUS : 0);
  const open = (i, ok) => !ok || data[i] === 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== BLOCK.STONE) continue;
    const lx = i % sx, lz = Math.floor(i / sx) % sz, ly = Math.floor(i / layer);
    const exposed = open(i - 1, lx > 0) || open(i + 1, lx < sx - 1)
      || open(i - sx, lz > 0) || open(i + sx, lz < sz - 1)
      || open(i - layer, ly > 0) || open(i + layer, ly < sy - 1);
    const v = noise3((x0 + lx) * ORE_SCALE + 2000, (y0 + ly) * ORE_SCALE, (z0 + lz) * ORE_SCALE + 2000);
    if (v > base - (exposed ? ORE_EXPOSED_BONUS : 0)) data[i] = BLOCK.IRON_ORE;
  }
}

// Small still ponds on a big island's top (the center island gets a few,
// others maybe one): a noisy round hollow of water, deeper in the middle, on
// ground that's nearly flat and away from the keep. Sand goes around them.
function addPonds(world, random, noise, island) {
  const count = island.kind === 'center' ? 3 : random() < 0.5 ? 1 : 0;
  for (let p = 0; p < count; p++) {
    for (let tries = 0; tries < 8; tries++) {
      const angle = random() * Math.PI * 2, dist = random() * island.r * 0.5;
      const radius = lerp(POND_RADIUS, random());
      const cx = Math.floor(island.x + Math.cos(angle) * dist), cz = Math.floor(island.z + Math.sin(angle) * dist);
      const keep = island.keepSite;
      if (keep && Math.hypot(cx - keep.cx, cz - keep.cz) < KEEP_REACH * 1.5 + radius + 6) continue;
      const level = world.getSurfaceY(cx, cz, isSolid);
      const reach = Math.ceil(radius) + 3;
      // Nearly flat grass all around, so the water sits in a hollow.
      let flat = true;
      for (let dz = -reach; dz <= reach && flat; dz++) {
        for (let dx = -reach; dx <= reach && flat; dx++) {
          const top = world.getSurfaceY(cx + dx, cz + dz, isSolid);
          flat = Math.abs(top - level) <= 1 && world.getBlock(cx + dx, top, cz + dz) === BLOCK.GRASS;
        }
      }
      if (!flat) continue;
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx, dz) / radius * (1 + 0.25 * noise(cx + dx + 0.5, cz + dz + 0.5));
          if (d >= 1) continue;
          const x = cx + dx, z = cz + dz;
          for (let y = level + 1; y <= level + 2; y++) world.setBlock(x, y, z, BLOCK.AIR);
          world.setBlock(x, level, z, BLOCK.WATER);
          if (d < 0.55) world.setBlock(x, level - 1, z, BLOCK.WATER);
        }
      }
      sandShores(world, noise, cx - reach - 3, cz - reach - 3, cx + reach + 3, cz + reach + 3);
      break;
    }
  }
}

// Flood-fills the solid blocks (6-connected) and clears pieces under MIN_FRAGMENT.
function removeFragments(data, sx, sy, sz) {
  const seen = new Uint8Array(data.length);
  const stack = new Int32Array(data.length);
  const piece = [];
  const layer = sx * sz;
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    piece.length = 0;
    const visit = (n) => {
      if (!data[n] || seen[n]) return;
      seen[n] = 1;
      stack[top++] = n;
    };
    while (top > 0) {
      const i = stack[--top];
      if (piece.length < MIN_FRAGMENT) piece.push(i);
      const lx = i % sx, lz = Math.floor(i / sx) % sz, ly = Math.floor(i / layer);
      if (lx > 0) visit(i - 1);
      if (lx < sx - 1) visit(i + 1);
      if (lz > 0) visit(i - sx);
      if (lz < sz - 1) visit(i + sx);
      if (ly > 0) visit(i - layer);
      if (ly < sy - 1) visit(i + layer);
    }
    // `piece` holds the whole piece only when it's small.
    if (piece.length < MIN_FRAGMENT) for (const i of piece) data[i] = 0;
  }
}

function writeIsland(world, { x0, y0, z0, sx, sy, sz, data }) {
  let i = 0;
  for (let ly = 0; ly < sy; ly++) {
    for (let lz = 0; lz < sz; lz++) {
      for (let lx = 0; lx < sx; lx++, i++) {
        if (data[i]) world.setBlock(x0 + lx, y0 + ly, z0 + lz, data[i]);
      }
    }
  }
}

// Top of the land in a column within `range` of an island's altitude, or null.
function landTop(world, x, z, around, range) {
  for (let y = Math.min(world.sizeY - 1, around + range); y >= Math.max(0, around - range); y--) {
    if (isSolid(world.getBlock(x, y, z))) return y;
  }
  return null;
}

// The open stretch on a winding path from island a to island b: samples every
// half block, `wiggle` blocks of sideways sway (0 at the ends). Returns the
// samples plus where the gap starts and ends, with the land heights there, or
// null if the islands touch.
function gapPath(world, noise, a, b, wiggle) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(dist * 2);
  const px = -(b.z - a.z) / dist, pz = (b.x - a.x) / dist;
  const seedA = a.ox;
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sway = Math.sin(Math.PI * t) * wiggle * (Math.sin(t * Math.PI * 2.3 + seedA) * 0.7 + noise(t * 3 + seedA, 7.7) * 0.3);
    samples.push({ x: Math.floor(a.x + (b.x - a.x) * t + px * sway), z: Math.floor(a.z + (b.z - a.z) * t + pz * sway) });
  }
  const rangeA = Math.ceil(a.hillAmp) + 4, rangeB = Math.ceil(b.hillAmp) + 4;
  let start = 0;
  while (start < steps && landTop(world, samples[start + 1].x, samples[start + 1].z, a.top, rangeA) !== null) start++;
  let end = steps;
  while (end > start && landTop(world, samples[end - 1].x, samples[end - 1].z, b.top, rangeB) !== null) end--;
  if (end - start < 2) return null;
  const hA = landTop(world, samples[start].x, samples[start].z, a.top, rangeA);
  const hB = landTop(world, samples[end].x, samples[end].z, b.top, rangeB);
  if (hA === null || hB === null) return null;
  return { samples, start, end, hA, hB, px, pz, length: (end - start) / 2 };
}

function setIfAir(world, x, y, z, id) {
  if (world.getBlock(x, y, z) === BLOCK.AIR) world.setBlock(x, y, z, id);
}

// A thin (2 wide) winding grass bridge over the gap, sloping evenly between
// the two ends. Skipped if the slope would be too steep to walk and jump.
function buildBridge(world, noise, a, b) {
  const gap = gapPath(world, noise, a, b, Math.min(12, Math.hypot(b.x - a.x, b.z - a.z) / 8));
  if (!gap || Math.abs(gap.hB - gap.hA) > gap.length * 0.5) return false;
  const { samples, start, end, hA, hB } = gap;
  const sideX = Math.round(gap.px), sideZ = Math.round(gap.pz);
  for (let i = start + 1; i < end; i++) {
    const { x, z } = samples[i];
    const prev = samples[i - 1];
    const y = Math.round(hA + ((hB - hA) * (i - start)) / (end - start));
    const cells = [[x, z], [x + sideX, z + sideZ]];
    // A diagonal step only touches at a corner; fill it in so it can be walked.
    if (prev.x !== x && prev.z !== z) cells.push([prev.x, z]);
    for (const [bx, bz] of cells) {
      setIfAir(world, bx, y, bz, BLOCK.GRASS);
      setIfAir(world, bx, y - 1, bz, BLOCK.DIRT);
    }
  }
  return true;
}

// Single floating blocks across the gap, STONE_SPACING apart (jumpable gaps),
// rising or falling at most one block per stone.
function buildSteppingStones(world, noise, a, b) {
  const gap = gapPath(world, noise, a, b, 0);
  if (!gap) return false;
  const { samples, start, end, hA, hB } = gap;
  const stones = [];
  for (let i = start + STONE_SPACING * 2; i <= end - STONE_SPACING * 2; i += STONE_SPACING * 2) stones.push(samples[i]);
  if (stones.length === 0 || Math.abs(hB - hA) > stones.length) return false;
  let y = hA;
  stones.forEach((s, k) => {
    const remaining = stones.length - k;
    y += Math.sign(hB - y) * (Math.abs(hB - y) >= remaining ? 1 : 0);
    setIfAir(world, s.x, y, s.z, BLOCK.STONE);
  });
  return true;
}

// Bridges and stepping stones between some nearby ring islands, and a couple
// of bridges from ring islands to the center. Most islands stay unconnected.
function connectIslands(world, random, noise, ring, center) {
  const linked = new Set();
  const pairKey = (a, b) => [ring.indexOf(a), ring.indexOf(b)].sort((p, q) => p - q).join();
  for (const a of ring) {
    let nearest = null, best = Infinity;
    for (const b of ring) {
      if (b === a) continue;
      const gap = Math.hypot(b.x - a.x, b.z - a.z) - a.r - b.r;
      if (gap < best) { best = gap; nearest = b; }
    }
    const roll = random();
    if (!nearest || best > MAX_CONNECT_GAP || linked.has(pairKey(a, nearest))) continue;
    if (roll < BRIDGE_CHANCE) {
      if (buildBridge(world, noise, a, nearest)) linked.add(pairKey(a, nearest));
    } else if (roll < BRIDGE_CHANCE + STONES_CHANCE) {
      if (buildSteppingStones(world, noise, a, nearest)) linked.add(pairKey(a, nearest));
    }
  }
  const byDistance = [...ring].sort((p, q) =>
    Math.hypot(p.x - center.x, p.z - center.z) - Math.hypot(q.x - center.x, q.z - center.z));
  const candidates = byDistance.slice(0, 8);
  for (let built = 0, tries = 0; built < CENTER_BRIDGES && tries < 20 && candidates.length; tries++) {
    const [island] = candidates.splice(Math.floor(random() * candidates.length), 1);
    if (buildBridge(world, noise, island, center)) built++;
  }
}

// 1-3 little rock clumps floating beside and below an island.
function addCrumbs(world, random, island) {
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const dist = island.r * (1.05 + random() * 0.5);
    let x = Math.floor(island.x + Math.cos(angle) * dist);
    let y = Math.max(MIN_BOTTOM, Math.floor(island.top - 3 - random() * island.depth * 0.6));
    let z = Math.floor(island.z + Math.sin(angle) * dist);
    const size = 1 + Math.floor(random() * 3);
    for (let b = 0; b < size; b++) {
      setIfAir(world, x, y, z, BLOCK.STONE);
      const dir = Math.floor(random() * 3);
      if (dir === 0) x++; else if (dir === 1) z++; else y--;
    }
  }
}
