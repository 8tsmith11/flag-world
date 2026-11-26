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
// Movement: each section takes steamPerSection steam, drawn at up to
// steamPerSecond only while it is moving (demand is zero standing still,
// finished, obstructed or out of planks). Without steam it holds where it is
// and carries on when steam returns. It never lays a section into a solid
// block or an entity ("Obstructed") and never removes anything but deck.
//
// Control: everything goes through command(game, node, action, value), the
// same entry point levers, pressure plates or remote controls can use later.
// Only the owning team may use it (Game checks before opening the screen).
import { DRAWBRIDGE as C, TICK_RATE } from '../shared/config.js';
import { BLOCK, FACING_DIRS } from '../shared/blocks.js';
import { playerBoxOf } from '../shared/physics.js';
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
    this.received = 0;
    this.lastReceived = 0;
    this.moving = false;
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
    for (let i = this.length; i >= 1; i--) {
      const c = this.cell(node, i);
      if (this.inWorld(world, c) && world.getBlock(c.x, c.y, c.z) === BLOCK.BRIDGE_DECK) return { remove: true, cell: c };
    }
    return { done: true };
  }

  demand(fluid) { return fluid === 'steam' && this.moving ? C.steamPerSecond / TICK_RATE : 0; }
  accept(fluid, amount) { if (fluid === 'steam') this.received += amount; }

  // One tick (from the fluid system, after steam has been handed out).
  tick(game, node) {
    const before = JSON.stringify([this.state, this.progress, this.extended, this.stored, this.lastReceived]);
    this.lastReceived = this.received; this.received = 0;
    const move = this.nextMove(game, node);
    if (move.done) {
      this.moving = false; this.progress = 0;
      this.state = this.target === 'extended' ? 'Extended' : 'Retracted';
    } else if (move.blocked) {
      this.moving = false;
      this.state = move.blocked;
    } else {
      this.moving = true;
      this.progress += this.lastReceived / C.steamPerSection;
      this.state = this.lastReceived <= 1e-9 ? 'Insufficient steam' : move.place ? 'Extending' : 'Retracting';
      if (this.progress >= 1 - 1e-9) {
        this.progress = 0;
        const c = move.cell;
        if (move.place) {
          if (this.stored > 0) this.stored--;
          else { this.slots[0].count -= C.sectionPlanks; if (this.slots[0].count <= 0) this.slots[0] = null; }
          game.world.setBlock(c.x, c.y, c.z, BLOCK.BRIDGE_DECK);
        } else {
          game.world.setBlock(c.x, c.y, c.z, BLOCK.AIR);
          this.stored++;
        }
        // Ask for steam next tick only if there is another move to make.
        const next = this.nextMove(game, node);
        this.moving = !next.done && !next.blocked;
      }
    }
    this.extended = this.deckCount(game.world, node);
    // Quest book: the owning team has had a bridge all the way out.
    if (this.state === 'Extended' && this.extended > 0 && this.team !== null) game.teamProgress?.discover(this.team, 'drawbridgeExtended');
    const after = JSON.stringify([this.state, this.progress, this.extended, this.stored, this.lastReceived]);
    if (after !== before) this.dirty = true;
    return this.dirty;
  }

  // Controls: 'extend', 'retract', 'toggle', 'length' (value 1..maxLength)
  // and 'direction' (value 0..3). Length and direction only change while
  // fully retracted. Returns null, or why it was refused.
  command(game, node, action, value) {
    if (action === 'extend' || action === 'retract' || action === 'toggle') {
      this.target = action === 'toggle' ? (this.target === 'extended' ? 'retracted' : 'extended')
        : action === 'extend' ? 'extended' : 'retracted';
      this.progress = 0;
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
      extended: this.extended, progress: this.progress, steamReceived: this.lastReceived * TICK_RATE, steamNeeded: C.steamPerSecond,
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
