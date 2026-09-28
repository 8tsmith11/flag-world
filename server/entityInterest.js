// Per-client last sent values retain final stopped positions across rate limits.
const NEAR_RANGE = 64;
const MIDDLE_RANGE = 160;
const UPDATE_TICKS = [1, 3, 6];

export class EntityInterest {
  constructor() {
    this.snapshots = new Map();
  }

  collect(game) {
    for (const map of [game.mobs, game.cows, game.dragons, game.npcs]) for (const entity of map.values()) {
      const snapshot = entity.snapshot();
      const key = JSON.stringify(snapshot), old = this.snapshots.get(entity.id);
      if (!old || old.key !== key) this.snapshots.set(entity.id, { entity, snapshot, key });
    }
    for (const [id, record] of this.snapshots) {
      if (record.entity.dead || !(game.mobs.has(id) || game.cows.has(id) || game.dragons.has(id) || game.npcs.has(id))) {
        this.snapshots.delete(id);
      }
    }
  }

  forPlayer(game, player, result) {
    const sent = player.entityLast ??= new Map();
    for (const { entity, snapshot, key } of this.snapshots.values()) {
      const distance = Math.hypot(player.state.x - entity.state.x,
        player.state.y - entity.state.y, player.state.z - entity.state.z);
      const every = UPDATE_TICKS[distance < NEAR_RANGE ? 0 : distance < MIDDLE_RANGE ? 1 : 2];
      const last = sent.get(entity.id);
      if ((last && game.tick - last.tick < every) || (last?.key === key && last.every === every)) continue;
      result.push({ ...snapshot, u: every });
      sent.set(entity.id, { key, tick: game.tick, every });
    }
    for (const id of sent.keys()) if (!this.snapshots.has(id)) sent.delete(id);
  }
}
