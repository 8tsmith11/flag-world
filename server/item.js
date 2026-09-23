// A dropped item stack lying in (or flying through) the world.

import { TICK_RATE, ITEM_DESPAWN_TIME } from '../shared/config.js';
import { createItemState } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';

export class ItemEntity {
  constructor(id, item, count, x, y, z, vx, vy, vz, pickupDelay) {
    this.id = id;
    this.type = ENTITY_TYPE.ITEM;
    this.item = item;
    this.count = count;
    this.state = createItemState(x, y, z, vx, vy, vz);
    // Ticks until players can pick it up, and until it despawns.
    this.pickupTicks = Math.round(pickupDelay * TICK_RATE);
    this.despawnTicks = ITEM_DESPAWN_TIME * TICK_RATE;
  }

  // Sent once in ENTITY_SPAWN / WELCOME.
  describe() {
    return { ...this.snapshot(), item: this.item };
  }

  // Per-tick snapshot for STATE messages, sent only on ticks where it moved.
  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, x: s.x, y: s.y, z: s.z };
  }
}
