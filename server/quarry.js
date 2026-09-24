import { BLOCK } from '../shared/blocks.js';
import { ITEM_SIZE, QUARRY_REGROW_TIME, TICK_RATE } from '../shared/config.js';
import { playerBoxOf, playerOverlapsBlock } from '../shared/physics.js';
import { S2C } from '../shared/protocol.js';

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const INTERVAL = Math.round(QUARRY_REGROW_TIME * TICK_RATE);
const keyOf = (x, y, z) => `${x},${y},${z}`;

export class QuarryRegrowth {
  constructor(game) {
    this.game = game;
    this.stones = new Map();
    for (const pos of game.world.quarries ?? []) this.changed(pos.x, pos.y, pos.z, BLOCK.QUARRY_STONE);
  }

  changed(x, y, z, id) {
    const key = keyOf(x, y, z);
    if (id === BLOCK.QUARRY_STONE) {
      if (!this.stones.has(key)) this.stones.set(key, { x, y, z, due: FACES.map(() => this.game.tick + INTERVAL) });
    } else this.stones.delete(key);
  }

  occupied(x, y, z) {
    const game = this.game;
    for (const player of game.players.values()) {
      if (!player.dead && playerOverlapsBlock(player.state.x, player.state.y, player.state.z,
        x, y, z, playerBoxOf(player.state))) return true;
    }
    for (const mob of [...game.cows.values(), ...game.dragons.values(), ...game.mobs.values()]) {
      const s = mob.state;
      if (!mob.dead && playerOverlapsBlock(s.x, s.y, s.z, x, y, z, s.box)) return true;
    }
    return false;
  }

  // Pick the nearest free voxel center so items cannot remain trapped inside
  // the newly created stone. Search short 3D shells, preferring upward space.
  moveItems(x, y, z) {
    const world = this.game.world;
    const overlaps = [...this.game.items.values()].filter(({ state: s }) =>
      playerOverlapsBlock(s.x, s.y, s.z, x, y, z, { halfW: ITEM_SIZE / 2, height: ITEM_SIZE }));
    if (!overlaps.length) return;
    // A mined one-cell pocket may be surrounded by many layers of stone.
    // Expand until there is real air, rather than assuming it is nearby.
    let nearest = null;
    const limit = Math.max(world.sizeX, world.sizeY, world.sizeZ);
    for (let radius = 1; radius <= limit && !nearest; radius++) {
      const options = [];
      for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (!world.inBounds(xx, yy, zz) || world.getBlock(xx, yy, zz) !== BLOCK.AIR) continue;
        options.push({ x: xx, y: yy, z: zz, distance: dx * dx + dy * dy + dz * dz });
      }
      options.sort((a, b) => a.distance - b.distance || b.y - a.y);
      nearest = options[0] ?? null;
    }
    for (const item of overlaps) {
      if (!nearest) continue;
      Object.assign(item.state, { x: nearest.x + 0.5, y: nearest.y + 0.2, z: nearest.z + 0.5,
        vx: 0, vy: 0, vz: 0, onGround: false });
      item.forceSnapshot = true;
    }
  }

  tick(tick) {
    const world = this.game.world;
    for (const stone of this.stones.values()) {
      for (let face = 0; face < FACES.length; face++) {
        if (tick < stone.due[face]) continue;
        stone.due[face] += INTERVAL;
        const [dx, dy, dz] = FACES[face];
        const x = stone.x + dx, y = stone.y + dy, z = stone.z + dz;
        if (!world.inBounds(x, y, z) || world.getBlock(x, y, z) !== BLOCK.AIR || this.occupied(x, y, z)) continue;
        this.moveItems(x, y, z);
        world.setBlock(x, y, z, BLOCK.STONE);
        this.game.broadcast({ type: S2C.QUARRY_PUFF, x, y, z });
      }
    }
  }
}
