// Per-client last sent values retain final stopped positions across rate limits.
const NEAR_RANGE = 64;
const MIDDLE_RANGE = 160;
const UPDATE_TICKS = [1, 3, 6];

export class EntityInterest {
  constructor() {
    this.snapshots = new Map();
  }

  collect(game) {
    const next = new Map();
    for (const map of [game.mobs, game.cows, game.dragons, game.npcs]) for (const entity of map.activeValues?.() ?? map.values()) {
      if (entity.dead) continue;
      const snapshot = entity.snapshot();
      const key = JSON.stringify(snapshot), old = this.snapshots.get(entity.id);
      next.set(entity.id, old?.key === key ? old : { entity, snapshot, key });
    }
    this.snapshots = next;
  }

  forPlayer(game, player, result) {
    const sent = player.entityLast ??= new Map();
    const loaded = new Set();
    for (const { entity, snapshot, key } of this.snapshots.values()) {
      if (game.chunkLoading && !game.chunkLoading.has(entity.state.x, entity.state.z)) continue;
      loaded.add(entity.id);
      const distance = Math.hypot(player.state.x - entity.state.x,
        player.state.y - entity.state.y, player.state.z - entity.state.z);
      const every = UPDATE_TICKS[distance < NEAR_RANGE ? 0 : distance < MIDDLE_RANGE ? 1 : 2];
      const last = sent.get(entity.id);
      if ((last && game.tick - last.tick < every) || (last?.key === key && last.every === every)) continue;
      result.push({ ...snapshot, u: every });
      sent.set(entity.id, { key, tick: game.tick, every });
    }
    for (const id of sent.keys()) if (!loaded.has(id)) {
      // The entity still exists, but its simulation column is asleep.
      // Clear the client's last pose until an active snapshot arrives again.
      if (game.cows.has(id) || game.dragons.has(id) || game.mobs.has(id) || game.npcs.has(id))
        result.push({ id, unloaded: true });
      sent.delete(id);
    }
  }
}
