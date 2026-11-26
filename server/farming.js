// Farming: crop growth timers and grass spreading onto dirt.
//
// Crops are tracked from block changes (any writer: players, farmer monkeys,
// a loaded save): each growing crop has one due tick for its next stage.
// Grass spread samples random columns near players instead of scanning.
import { TICK_RATE, FARMING as C } from '../shared/config.js';
import { BLOCK, cropAt, isSolid, isLiquid } from '../shared/blocks.js';

const stageTicks = () => Math.round((C.stageTime[0] + Math.random() * (C.stageTime[1] - C.stageTime[0])) * TICK_RATE);

export class Farming {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    // key -> { x, y, z, due }
    this.crops = new Map();
  }

  changed(x, y, z, id) {
    const key = `${x},${y},${z}`;
    const crop = cropAt(id);
    if (crop && crop.stage < crop.crop.stages.length - 1) this.crops.set(key, { x, y, z, due: this.game.tick + stageTicks() });
    else this.crops.delete(key);
  }

  tick(tick) {
    for (const entry of this.crops.values()) {
      if (tick < entry.due) continue;
      const { x, y, z } = entry, id = this.world.getBlock(x, y, z), crop = cropAt(id);
      if (!crop) { this.crops.delete(`${x},${y},${z}`); continue; }
      // Crops only grow on farmland; anything else under one breaks it.
      if (this.world.getBlock(x, y - 1, z) !== BLOCK.FARMLAND) { this.game.breakBlock(x, y, z); continue; }
      // The block change reschedules (or, when mature, forgets) it.
      this.world.setBlock(x, y, z, crop.crop.stages[crop.stage + 1]);
    }
    this.spreadGrass();
  }

  // Exposed dirt next to grass (within one block up or down) turns to grass.
  spreadGrass() {
    const w = this.world;
    for (const player of this.game.players.values()) {
      if (player.dead || !player.connected) continue;
      for (let i = 0; i < C.grassSamples; i++) {
        const x = Math.floor(player.state.x + (Math.random() * 2 - 1) * C.grassRange);
        const z = Math.floor(player.state.z + (Math.random() * 2 - 1) * C.grassRange);
        if (x < 0 || z < 0 || x >= w.sizeX || z >= w.sizeZ) continue;
        const y = w.getSurfaceY(x, z, isSolid);
        if (w.getBlock(x, y, z) !== BLOCK.DIRT) continue;
        const above = w.getBlock(x, y + 1, z);
        if (isSolid(above) || isLiquid(above)) continue;
        let grass = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let dy = -1; dy <= 1 && !grass; dy++) grass = w.getBlock(x + dx, y + dy, z + dz) === BLOCK.GRASS;
          if (grass) break;
        }
        if (grass) w.setBlock(x, y, z, BLOCK.GRASS);
      }
    }
  }
}
