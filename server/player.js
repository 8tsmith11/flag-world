import { MAX_HP, FLAG_GRAB_TIME, TICK_RATE } from '../shared/config.js';
import { createPlayerState } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { breakingStats, attackStats } from '../shared/tools.js';
import { Inventory } from './inventory.js';

// A player in the current match. Outlives its connection: on disconnect the
// socket is set to null and the player stays in the world (position,
// inventory, ...) until someone reconnects with the same name.
export const GRAB_TICKS = Math.round(FLAG_GRAB_TIME * TICK_RATE);

export class Player {
  constructor(id, socket, name, color, spawn) {
    this.id = id;
    this.type = ENTITY_TYPE.PLAYER;
    this.socket = socket;
    this.name = name;
    this.color = color;
    this.state = createPlayerState(spawn.x, spawn.y, spawn.z);
    // Inputs received but not yet simulated, oldest first.
    this.inputQueue = [];
    // Sequence number of the last input simulated; echoed so the client can reconcile.
    this.lastSeq = 0;
    // Block being mined as { x, y, z, ticks held }, or null.
    this.breaking = null;
    this.hp = MAX_HP;
    this.dead = false;
    // Game ticks: when the player died, last took damage, and may next punch.
    this.deathTick = 0;
    this.lastDamageTick = -Infinity;
    this.nextAttackTick = 0;
    // { id, tick } of the last player to hit them, for crediting void deaths.
    this.lastAttacker = null;
    // Highest y since the player last stood, climbed or swam; null while grounded.
    this.fallTop = null;
    // Capture the flag. `flag` is this player's own Flag; `carrying` is the enemy
    // Flag they hold, if any; `grab` is { flag, ticks } while standing on one.
    // Flagless (own flag captured) players who die are eliminated for good.
    this.flag = null;
    this.carrying = null;
    this.grab = null;
    this.eliminated = false;
    this.inventory = new Inventory();
    // "x,y,z" of the furnace whose screen is open, or null.
    this.viewing = null;
    // Hotbar slot in hand, from the latest input.
    this.selected = 0;
    // Set when the inventory changes; the game sends it at the end of the tick.
    this.inventoryDirty = false;
  }

  get connected() {
    return this.socket !== null;
  }

  // Attaches a new connection (null to detach). Drops anything the old client
  // had in flight; inputs keep counting from lastSeq.
  attach(socket) {
    this.socket = socket;
    this.inputQueue.length = 0;
    this.breaking = null;
  }

  // Item id in hand, or null.
  held() {
    return this.inventory.get(this.selected)?.item ?? null;
  }

  // { strength, speed } for breaking with what's in hand (shared/tools.js).
  breakingStats() {
    return breakingStats(this.held());
  }

  // { damage, cooldown } for attacking with what's in hand.
  attackStats() {
    return attackStats(this.held());
  }

  // Public info sent once when a player becomes known to a client.
  describe() {
    return { id: this.id, name: this.name, color: this.color };
  }

  // Per-tick snapshot for STATE messages.
  snapshot() {
    const s = this.state;
    return {
      id: this.id,
      type: this.type,
      x: s.x, y: s.y, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz,
      kx: s.kx, kz: s.kz,
      yaw: s.yaw, pitch: s.pitch,
      onGround: s.onGround,
      crouching: s.crouching,
      hp: this.hp,
      dead: this.dead,
      eliminated: this.eliminated,
      carrying: this.carrying?.id ?? null,
      held: this.held(),
      grab: this.grab ? this.grab.ticks / GRAB_TICKS : 0,
      lastSeq: this.lastSeq,
    };
  }
}
