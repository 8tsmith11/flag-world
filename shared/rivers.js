import { BLOCK, isSolid } from './blocks.js';
import { RIVER_SETTINGS } from './config.js';
import { KEEP_REACH, mulberry32 } from './structures.js';

const blocked = (world, x, z, margin) => world.keeps.some((keep) =>
  Math.abs(x - keep.cx) <= KEEP_REACH + margin && Math.abs(z - keep.cz) <= KEEP_REACH + margin)
  || world.structures.some(({ box }) => box && x >= box.x0 - margin && x <= box.x1 + margin
    && z >= box.z0 - margin && z <= box.z1 + margin);

function chooseSource(world, terrain, random, used) {
  let best = null;
  for (let attempt = 0; attempt < RIVER_SETTINGS.sourceSearch; attempt++) {
    const angle = random() * Math.PI * 2;
    const distance = terrain.radius * (0.15 + random() * 0.48);
    const x = Math.round(terrain.x + Math.cos(angle) * distance);
    const z = Math.round(terrain.z + Math.sin(angle) * distance);
    const top = terrain.getTop(x, z);
    if (top === -32768 || blocked(world, x, z, 8)
      || used.some((point) => Math.hypot(point.x - x, point.z - z) < terrain.radius * 0.25)) continue;
    const mountain = world.biomeAt(x, z) === 'mountains';
    const height = top - terrain.surfaceY;
    const score = height + (mountain ? RIVER_SETTINGS.sourceMinHeight : 0)
      + random() * RIVER_SETTINGS.sourceJitter;
    if (!best || score > best.score) best = { x, z, top, score };
  }
  return best;
}

function route(world, terrain, source, random, width) {
  const points = [{ ...source, waterY: source.top }];
  let angle = Math.atan2(source.z - terrain.z, source.x - terrain.x);
  let level = source.top;
  for (let step = 0; step < RIVER_SETTINGS.maxSteps; step++) {
    const current = points.at(-1);
    let best = null;
    for (const turn of [-0.5, -0.22, 0, 0.22, 0.5]) {
      const nextAngle = angle + turn;
      const x = Math.round(current.x + Math.cos(nextAngle) * RIVER_SETTINGS.pathStep);
      const z = Math.round(current.z + Math.sin(nextAngle) * RIVER_SETTINGS.pathStep);
      const top = terrain.getTop(x, z);
      if (top === -32768) continue;
      if (blocked(world, x, z, width + RIVER_SETTINGS.bankWidth + 2)) continue;
      let nearPond = false;
      for (let dz = -RIVER_SETTINGS.pondAvoidance; dz <= RIVER_SETTINGS.pondAvoidance && !nearPond; dz++) {
        for (let dx = -RIVER_SETTINGS.pondAvoidance; dx <= RIVER_SETTINGS.pondAvoidance && !nearPond; dx++) {
          const ground = terrain.getTop(x + dx, z + dz);
          if (ground === -32768) continue;
          for (let y = ground; y >= ground - 7; y--) {
            if (world.getBlock(x + dx, y, z + dz) === BLOCK.WATER) { nearPond = true; break; }
          }
        }
      }
      if (nearPond) continue;
      const outward = Math.hypot(x - terrain.x, z - terrain.z)
        - Math.hypot(current.x - terrain.x, current.z - terrain.z);
      if (outward < 0.5) continue;
      const score = top + Math.abs(turn) * 3 - outward * 0.8 + random() * 0.8;
      if (!best || score < best.score) best = { x, z, top, angle: nextAngle, score };
    }
    if (!best) break;
    level = Math.min(level, best.top);
    points.push({ x: best.x, z: best.z, top: best.top, waterY: level });
    angle = best.angle;
    if (Math.hypot(best.x - terrain.x, best.z - terrain.z)
      >= terrain.radius - RIVER_SETTINGS.rimMargin) break;
  }
  return points.length > terrain.radius * 0.25 ? points : null;
}

function carve(world, terrain, points, width) {
  const channel = new Map();
  for (const point of points) {
    const radius = Math.floor(width / 2);
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = point.x + dx, z = point.z + dz;
      if (Math.hypot(dx, dz) > radius + 0.2 || terrain.getTop(x, z) === -32768) continue;
      const key = `${x},${z}`;
      const old = channel.get(key);
      if (!old || point.waterY < old.waterY) channel.set(key, { x, z, waterY: point.waterY });
    }
  }
  const end = points.at(-1);
  const reachesRim = Math.hypot(end.x - terrain.x, end.z - terrain.z)
    >= terrain.radius - RIVER_SETTINGS.rimMargin;
  // An inland river widens into a small lake. The same carved channel and
  // raised bank rules contain its water on every side.
  if (!reachesRim) {
    const radius = RIVER_SETTINGS.endPoolRadius;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const x = end.x + dx, z = end.z + dz;
      if (Math.hypot(dx, dz) > radius || terrain.getTop(x, z) === -32768) continue;
      const key = `${x},${z}`;
      const old = channel.get(key);
      if (!old || end.waterY < old.waterY) channel.set(key, { x, z, waterY: end.waterY });
    }
  }
  for (const { x, z, waterY } of channel.values()) {
    world.riverCells.add(`${x},${waterY},${z}`);
    world.riverColumns.add(`${x},${z}`);
    const top = terrain.getTop(x, z);
    for (let y = waterY; y <= top + 2; y++) world.setBlock(x, y, z, BLOCK.AIR);
    for (let y = waterY - RIVER_SETTINGS.channelDepth; y < waterY; y++) {
      if (!isSolid(world.getBlock(x, y, z))) world.setBlock(x, y, z, BLOCK.STONE);
    }
    world.setBlock(x, waterY, z, BLOCK.WATER);
  }
  // Keep low terrain next to the channel from letting water escape sideways.
  for (const { x, z, waterY } of channel.values()) {
    for (let dz = -RIVER_SETTINGS.bankWidth; dz <= RIVER_SETTINGS.bankWidth; dz++) {
      for (let dx = -RIVER_SETTINGS.bankWidth; dx <= RIVER_SETTINGS.bankWidth; dx++) {
        const bx = x + dx, bz = z + dz;
        if (channel.has(`${bx},${bz}`) || terrain.getTop(bx, bz) === -32768) continue;
        if (Math.hypot(dx, dz) > RIVER_SETTINGS.bankWidth + 0.2) continue;
        const bankTop = Math.max(terrain.getTop(bx, bz), waterY + 1);
        for (let y = terrain.getTop(bx, bz) + 1; y <= bankTop; y++) {
          if (world.getBlock(bx, y, bz) === BLOCK.AIR) world.setBlock(bx, y, bz, BLOCK.DIRT);
        }
      }
    }
  }
}

export function generateRivers(world, terrain, seed, count) {
  world.rivers = [];
  world.riverCells = new Set();
  world.riverColumns = new Set();
  const random = mulberry32(seed ^ 0x6d8a437b);
  const used = [];
  for (let i = 0; i < count; i++) {
    let made = false;
    for (let attempt = 0; attempt < RIVER_SETTINGS.placementAttempts && !made; attempt++) {
      const source = chooseSource(world, terrain, random, used);
      if (!source) break;
      const width = RIVER_SETTINGS.width[0]
        + Math.floor(random() * (RIVER_SETTINGS.width[1] - RIVER_SETTINGS.width[0] + 1));
      const points = route(world, terrain, source, random, width);
      if (!points) continue;
      carve(world, terrain, points, width);
      world.rivers.push({ source: { x: source.x, y: source.top, z: source.z },
        end: { x: points.at(-1).x, y: points.at(-1).waterY, z: points.at(-1).z }, width });
      used.push(source);
      made = true;
    }
  }
}
