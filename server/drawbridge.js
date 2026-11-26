// Steam-powered drawbridge (block BLOCK.DRAWBRIDGE, tuning in DRAWBRIDGE in
// shared/config.js). The mechanism is a container with one slot for planks
// and a steam input on the pipe network (server/fluids.js). From its front
// (dir, one of FACING_DIRS) it lays up to `length` BLOCK.BRIDGE_DECK
// sections in a straight line at its own height.
//
// Materials: a section is built once from sectionPlanks planks taken from the
// slot. Retracting a section stores it inside the mechanism (`stored`) and
// the next extension lays stored sections first, so moving back and forth
// never costs or makes planks. A deck section broken by anything drops its
// planks and leaves a gap; extending again fills the gap from stored
// sections or new planks. Breaking the mechanism drops its planks and the
// planks of every stored section.
//
// Steam: the mechanism keeps its own store (`steam`, up to steamStorage),
// topped up from its pipes whenever it isn't full. A state change (extend or
// retract) costs steamPerSection * length, taken all at once when it starts:
// from the store first, then from the connected pipes, boilers and tanks
// (FluidSystem.draw); without that much it doesn't start ("Insufficient
// steam"). Once started it lays or lifts one section every sectionSeconds
// until done, whatever happens to the steam supply, and takes no new command
// while moving.
//
// Obstructions: it never lays a section into a solid block or an entity and
// never removes anything but deck. If the very first section is blocked the
// move doesn't start; the bridge jogs (a section slides out a little and
// back, S2C.DRAWBRIDGE_JOG) to show it tried. If it is blocked after laying
// some of this move's sections it goes back to where the move began
// ("returning"), then rests "Obstructed". Running out of planks stops it
// where it is ("Missing construction materials").
//
// Control: everything goes through command(game, node, action, value), the
// same entry point levers, pressure plates or remote controls can use later.
// Only the owning team may use it (Game checks before opening the screen).
import { DRAWBRIDGE as C, TICK_RATE } from '../shared/config.js';
import { BLOCK, FACING_DIRS } from '../shared/blocks.js';
import { playerBoxOf } from '../shared/physics.js';
import { S2C } from '../shared/protocol.js';
import { clickSlot } from './inventory.js';
import { mergeInto } from './containers.js';

const PLANKS = BLOCK.PLANKS;

export class Drawbridge {
  constructor() {
    this.kind = 'drawbridge';
    this.slots = [null];
    this.rules = [{ accepts: (item) => item === PLANKS }];
    this.dirty = true;
    this.team = null;
    this.dir = 0;
    this.length = C.defaultLength;
    this.target = 'retracted';
    this.stored = 0;
    this.progress = 0;
    this.moving = false;
    this.available = 0;
    this.steam = 0;
    // A move in progress: sections out when it began, the target before it,
    // how many it has laid, and the count to go back to when returning.
    this.startOut = 0;
    this.fromTarget = 'retracted';
    this.laid = 0;
    this.returnTo = null;
    this.extended = 0;
    this.state = 'Retracted';
  }

  // The deck cell `i` sections out (1 = next to the mechanism).
  cell(node, i) {
    const [dx, dz] = FACING_DIRS[this.dir];
    return { x: node.x + dx * i, y: node.y, z: node.z + dz * i };
  }

  // Deck sections currently out within reach (any length up to maxLength).
  deckCount(world, node) {
    let n = 0;
    for (let i = 1; i <= C.maxLength; i++) {
      const c = this.cell(node, i);
      if (world.getBlock(c.x, c.y, c.z) === BLOCK.BRIDGE_DECK) n++;
    }
    return n;
  }

  planks() { return this.slots[0]?.item === PLANKS ? this.slots[0].count : 0; }
  // Planks still to supply for the configured length.
  required() { return Math.max(0, this.length - this.stored - this.extended) * C.sectionPlanks; }

  // Whether something with a box is inside the cell.
  occupied(game, c) {
    const lists = [game.players.values(), game.mobs?.values() ?? [], game.cows?.values() ?? [], game.npcs?.values() ?? [],
      game.dragons?.values() ?? []];
    for (const list of lists) for (const e of list) {
      if (e.dead || (e.connected === false)) continue;
      const s = e.state, box = playerBoxOf(s);
      if (s.x + box.halfW > c.x && s.x - box.halfW < c.x + 1 && s.z + box.halfW > c.z && s.z - box.halfW < c.z + 1
        && s.y + box.height > c.y && s.y < c.y + 1) return true;
    }
    return false;
  }

  inWorld(world, c) { return c.x >= 0 && c.z >= 0 && c.x < world.sizeX && c.z < world.sizeZ && c.y >= world.minY && c.y < world.sizeY; }

  // What the next section move is: { place, cell } / { remove, cell } /
  // { done } / { blocked: status }.
  nextMove(game, node) {
    const world = game.world;
    if (this.target === 'extended') {
      for (let i = 1; i <= this.length; i++) {
        const c = this.cell(node, i), id = this.inWorld(world, c) ? world.getBlock(c.x, c.y, c.z) : -1;
        if (id === BLOCK.BRIDGE_DECK) continue;
        if (id !== BLOCK.AIR || (game.buildable && !game.buildable(c.x, c.y, c.z))) return { blocked: 'Obstructed' };
        if (this.occupied(game, c)) return { blocked: 'Obstructed' };
        if (this.stored <= 0 && this.planks() < C.sectionPlanks) return { blocked: 'Missing construction materials' };
        return { place: true, cell: c };
      }
      return { done: true };
    }
    if (this.returnTo !== null && this.deckCount(world, node) <= this.returnTo) return { done: true };
    for (let i = this.length; i >= 1; i--) {
      const c = this.cell(node, i);
      if (this.inWorld(world, c) && world.getBlock(c.x, c.y, c.z) === BLOCK.BRIDGE_DECK) return { remove: true, cell: c };
    }
    return { done: true };
  }

  // Its store fills from the pipes; command() spends a move's steam at once.
  demand(fluid) { return fluid === 'steam' ? Math.max(0, Math.min(C.fillPerSecond / TICK_RATE, C.steamStorage - this.steam)) : 0; }
  accept(fluid, amount) { if (fluid === 'steam' && amount > 0) this.steam = Math.min(C.steamStorage, this.steam + amount); }

  // Pays `cost` from the store, then the network. True if paid.
  pay(game, node, cost) {
    if (this.steam + 1e-9 >= cost) { this.steam = Math.max(0, this.steam - cost); return true; }
    if (!game.fluids?.draw(node, 'steam', cost - this.steam)) return false;
    this.steam = 0;
    return true;
  }
  steamAvailable(game, node) { return this.steam + (game.fluids?.available(node, 'steam') ?? 0); }

  // The obstructed bridge shows it tried: everyone sees a section jog out and back.
  jog(game, node) { game.broadcast?.({ type: S2C.DRAWBRIDGE_JOG, x: node.x, y: node.y, z: node.z, dir: this.dir }); }

  // The steam a state change costs at the configured length.
  cost() { return C.steamPerSection * this.length; }

  // Ends a move with a state.
  stop(state) { this.moving = false; this.progress = 0; this.state = state; this.returnTo = null; }
  finished() { return this.target === 'extended' ? 'Extended' : 'Retracted'; }

  // One tick (from the fluid system).
  tick(game, node) {
    const before = JSON.stringify([this.state, this.progress, this.extended, this.stored, Math.round(this.available * 10), Math.round(this.steam * 10)]);
    this.available = this.steamAvailable(game, node);
    if (this.moving) {
      this.progress += 1 / Math.max(1, Math.round(C.sectionSeconds * TICK_RATE));
      if (this.progress >= 1 - 1e-9) {
        this.progress = 0;
        const move = this.nextMove(game, node);
        if (!move.done && !move.blocked) {
          const c = move.cell;
          if (move.place) {
            if (this.stored > 0) this.stored--;
            else { this.slots[0].count -= C.sectionPlanks; if (this.slots[0].count <= 0) this.slots[0] = null; }
            game.world.setBlock(c.x, c.y, c.z, BLOCK.BRIDGE_DECK);
            this.laid++;
          } else {
            game.world.setBlock(c.x, c.y, c.z, BLOCK.AIR);
            this.stored++;
          }
          game.broadcast?.({ type: S2C.STEAM_PUFF, x: node.x, y: node.y, z: node.z });
        }
        const next = move.done || move.blocked ? move : this.nextMove(game, node);
        if (next.done) {
          // Back where an obstructed move began.
          if (this.returnTo !== null) { this.target = this.fromTarget; this.stop('Obstructed'); }
          else this.stop(this.finished());
        } else if (next.blocked === 'Obstructed' && this.target === 'extended') {
          if (this.laid > 0) {
            // Blocked partway: go back to where this move began.
            this.target = 'retracted'; this.returnTo = this.startOut;
            this.state = 'Obstructed: going back';
          } else { this.jog(game, node); this.target = this.fromTarget; this.stop('Obstructed'); }
        } else if (next.blocked) this.stop(next.blocked);
      }
    }
    this.extended = this.deckCount(game.world, node);
    if (!this.moving && this.state === 'Extended' && this.extended === 0) this.state = 'Retracted';
    // Quest book: the owning team has had a bridge all the way out.
    if (this.state === 'Extended' && this.extended > 0 && this.team !== null) game.teamProgress?.discover(this.team, 'drawbridgeExtended');
    const after = JSON.stringify([this.state, this.progress, this.extended, this.stored, Math.round(this.available * 10), Math.round(this.steam * 10)]);
    if (after !== before) this.dirty = true;
    return this.dirty;
  }

  // Controls: 'extend', 'retract', 'toggle', 'length' (value 1..maxLength)
  // and 'direction' (value 0..3). Nothing is taken while it is moving. A
  // move starts only if there is something to do, its first section isn't
  // blocked (an obstruction makes it jog instead) and its whole steam cost
  // can be paid now. Length and direction only change while fully
  // retracted. Returns null, or why it was refused.
  command(game, node, action, value) {
    if (this.moving) return 'The drawbridge is already moving';
    if (action === 'extend' || action === 'retract' || action === 'toggle') {
      const previous = this.target;
      this.target = action === 'toggle' ? (this.target === 'extended' ? 'retracted' : 'extended')
        : action === 'extend' ? 'extended' : 'retracted';
      const move = this.nextMove(game, node);
      if (move.done) { const wanted = this.target; this.target = previous; return wanted === 'extended' ? 'Already extended' : 'Already retracted'; }
      if (move.blocked) {
        this.target = previous; this.state = move.blocked; this.dirty = true;
        if (move.blocked === 'Obstructed') { this.jog(game, node); return 'Obstructed: something is in the way'; }
        return move.blocked;
      }
      const cost = this.cost();
      if (!this.pay(game, node, cost)) {
        this.target = previous;
        this.state = 'Insufficient steam';
        this.dirty = true;
        return `Insufficient steam: a move takes ${cost}, ${Math.floor(this.steamAvailable(game, node))} available`;
      }
      this.available = this.steamAvailable(game, node);
      this.startOut = this.deckCount(game.world, node); this.fromTarget = previous; this.laid = 0; this.returnTo = null;
      this.moving = true; this.progress = 0;
      this.state = this.target === 'extended' ? 'Extending' : 'Retracting';
      this.dirty = true;
      return null;
    }
    if (action !== 'length' && action !== 'direction') return 'Unknown control';
    if (this.deckCount(game.world, node) > 0) return 'Retract the bridge fully first';
    if (action === 'length') {
      if (!Number.isInteger(value) || value < 1 || value > C.maxLength) return 'Invalid length';
      this.length = value;
    } else {
      if (!Number.isInteger(value) || value < 0 || value > 3) return 'Invalid direction';
      this.dir = value;
    }
    this.target = 'retracted';
    this.dirty = true;
    return null;
  }

  click(slot, button, holder) { return clickSlot(this.slots, slot, holder, button, this.rules[slot]); }
  insert(stack) { return this.rules[0].accepts(stack.item) && mergeInto(this.slots, 0, stack); }

  view() {
    return { kind: this.kind, slots: this.slots, team: this.team, dir: this.dir, length: this.length, target: this.target, stored: this.stored,
      extended: this.extended, progress: this.progress, moving: this.moving, steamAvailable: this.available, steamCost: this.cost(),
      steamStored: this.steam, steamStorage: C.steamStorage, returning: this.returnTo !== null,
      planks: this.planks(), required: this.required(), status: this.state };
  }

  // Broken: the slot's planks plus every stored section's planks.
  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots = [null];
    let refund = this.stored * C.sectionPlanks;
    this.stored = 0;
    while (refund > 0) { const n = Math.min(64, refund); stacks.push({ item: PLANKS, count: n }); refund -= n; }
    return stacks;
  }
}
