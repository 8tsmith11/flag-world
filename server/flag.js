// A player's flag. Its id is the owner's player id. It sits on the pedestal in
// the owner's keep until an enemy takes it; when the carrier dies it drops and
// falls like an item until it's picked up again or returned home.

import { createItemState } from '../shared/physics.js';
import { FLAG_STATE } from '../shared/protocol.js';

export class Flag {
  constructor(ownerId, color, home) {
    this.id = ownerId;
    this.color = color;
    this.home = home;
    this.state = FLAG_STATE.HOME;
    this.carrier = null;
    // Position and velocity while home or dropped (item physics).
    this.body = createItemState(home.x, home.y, home.z);
    // Game tick it was dropped, for the return timer.
    this.droppedTick = 0;
  }

  // Where it is now: the carrier's feet while carried.
  get position() {
    const s = this.carrier ? this.carrier.state : this.body;
    return { x: s.x, y: s.y, z: s.z };
  }

  goHome() {
    this.state = FLAG_STATE.HOME;
    this.carrier = null;
    this.body = createItemState(this.home.x, this.home.y, this.home.z);
  }

  // Sent once in WELCOME.
  describe() {
    return { id: this.id, color: this.color, home: this.home };
  }

  // Per-tick FlagState for STATE messages.
  snapshot() {
    const { x, y, z } = this.position;
    return { id: this.id, state: this.state, carrierId: this.carrier?.id ?? null, x, y, z };
  }
}
