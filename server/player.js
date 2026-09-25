import { MAX_HP, FLAG_GRAB_TIME, TICK_RATE } from '../shared/config.js';
import { createPlayerState } from '../shared/physics.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { breakingStats, attackStats, rangedStats } from '../shared/tools.js';
import { getItemDef } from '../shared/items.js';
import { modValue } from '../shared/modifiers.js';
import { Inventory } from './inventory.js';
import { accessoryDef } from '../shared/accessories.js';
import { ITEM } from '../shared/itemIds.js';

// A player in the current match. Outlives its connection: on disconnect the
// socket is set to null and the player stays in the world (position,
// inventory, ...) until someone reconnects with the same name.
export const GRAB_TICKS = Math.round(FLAG_GRAB_TIME * TICK_RATE);

export class Player {
  constructor(id, socket, name, color, spawn, team = 0) {
    this.id = id;
    this.type = ENTITY_TYPE.PLAYER;
    this.socket = socket;
    this.name = name;
    this.color = color;
    this.team = team;
    this.state = createPlayerState(spawn.x, spawn.y, spawn.z);
    this.state.team = team;
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
    this.creative = false;
    this.immortal = false;
    // Bow: ticks the draw has been held, and the game tick it can next shoot.
    this.drawTicks = 0;
    this.nextShotTick = 0;
    // Crossbow: ticks spent loading, whether it's loaded (only while held),
    // and whether right click must be let go before loading again (after a
    // right click fires it).
    this.loadTicks = 0;
    this.loaded = false;
    this.loadNeedsRelease = false;
    this.eatTicks = 0;
    this.eatingItem = null;
    this.foodHealing = [];
    this.invulnerableUntilTick = 0;
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

  // The stack in hand, or null.
  heldStack() {
    return this.inventory.get(this.selected);
  }

  // { strength, speed } for breaking with what's in hand (shared/tools.js).
  breakingStats() {
    return breakingStats(this.heldStack());
  }

  // { damage, cooldown, ... } for attacking with what's in hand.
  attackStats() {
    return attackStats(this.heldStack());
  }

  // Draw and load ticks, damage bonus and speed scale for the bow or crossbow in hand.
  rangedStats() {
    return rangedStats(this.heldStack());
  }

  // Worn gear, with modifiers: max HP (Heart Amulet, Vital), armor points
  // (Sturdy), walking speed (Light, Fleet), fall damage cut (Cushioned) and
  // Thorns damage to melee attackers.
  maxHp() {
    const accessory = this.inventory.accessory;
    return MAX_HP + (accessoryDef(accessory?.item)?.maxHpBonus ?? 0) + modValue(accessory, 'vital');
  }

  armorPoints() {
    const armor = this.inventory.armor;
    return armor ? (getItemDef(armor.item).armorPoints || 0) + modValue(armor, 'sturdy') : 0;
  }

  moveScale() {
    return (1 + modValue(this.inventory.armor, 'light')) * (1 + modValue(this.inventory.accessory, 'fleet'));
  }

  fallDamageScale() {
    return 1 - modValue(this.inventory.accessory, 'cushioned');
  }

  thorns() {
    return modValue(this.inventory.armor, 'thorns');
  }

  fireImmune() {
    return !!getItemDef(this.inventory.armor?.item).fireImmune;
  }

  // Public info sent once when a player becomes known to a client.
  describe() {
    return { id: this.id, name: this.name, color: this.color, team: this.team };
  }

  // Per-tick snapshot for STATE messages.
  snapshot() {
    const s = this.state;
    return {
      id: this.id,
      team: this.team,
      type: this.type,
      x: s.x, y: s.y, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz,
      kx: s.kx, kz: s.kz,
      yaw: s.yaw, pitch: s.pitch,
      onGround: s.onGround,
      crouching: s.crouching,
      gliding: s.gliding,
      glideBlockedTicks: s.glideBlockedTicks ?? 0,
      flying: s.flying,
      hp: this.hp,
      maxHp: this.maxHp(),
      dead: this.dead,
      eliminated: this.eliminated,
      carrying: this.carrying?.id ?? null,
      held: this.held(),
      armor: this.inventory.armor?.item ?? null,
      accessory: this.inventory.accessory?.item ?? null,
      springCharge: s.springCharge,
      springBouncing: s.springBouncing,
      grab: this.grab ? this.grab.ticks / GRAB_TICKS : 0,
      // How far a bow is drawn or a crossbow loaded, 0..1.
      draw: this.held() === ITEM.CROSSBOW
        ? (this.loaded ? 1 : Math.min(1, this.loadTicks / this.rangedStats().loadTicks))
        : Math.min(1, this.drawTicks / this.rangedStats().fullDrawTicks),
      slowTicks: s.slowTicks,
      grapple: s.grapple,
      hookCooldown: s.hookCooldown,
      moveScale: s.moveScale,
      lastSeq: this.lastSeq,
    };
  }
}
