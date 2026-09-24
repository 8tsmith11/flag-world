// A dropped item stack lying in (or flying through) the world.

import { TICK_RATE, ITEM_DESPAWN_TIME } from '../shared/config.js';
import { createItemState } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';

export class ItemEntity {
  // mods: the stack's modifiers (shared/modifiers.js), or null.
  constructor(id, item, count, x, y, z, vx, vy, vz, pickupDelay, mods = null) {
    this.id = id;
    this.type = ENTITY_TYPE.ITEM;
    this.item = item;
    this.count = count;
    this.mods = mods?.length ? mods : null;
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
