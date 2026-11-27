// Steam-powered drawbridge (block BLOCK.DRAWBRIDGE, tuning in DRAWBRIDGE in
// shared/config.js). The mechanism is a container with one slot for planks
// and a steam input on the pipe network (server/fluids.js). Facing `dir`
// (one of FACING_DIRS) it lays up to `length` BLOCK.BRIDGE_DECK sections in a
// straight line at its own height, beside itself on `side` (1 right, -1
// left; drawbridgeCell in shared/drawbridge.js), so the walkway never runs
// over the mechanism.
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
// steam"). Once started it runs to the end whatever happens to the steam
// supply, and takes no new command while moving.
//
// Sliding: the bridge slides straight out and back in, one section per step
// of sectionSeconds. Extending, the next section slides out from the end of
// the bridge (S2C.DRAWBRIDGE_SLIDE, drawn by clients) and becomes a solid
// deck block when it arrives. Retracting, the end section stops being solid
// and slides back in. Each step is `step` ({ place|remove, cell, i }).
//
// Obstructions: it never lays a section into a solid block or an entity and
// never removes anything but deck. If the very first section is blocked the
// move doesn't start; the bridge jogs (a section slides out a little and
// back, S2C.DRAWBRIDGE_JOG) to show it tried. Blocked further out, it slides
// as far as the obstruction and stops there ("Obstructed"), so a block put
// at its end never pulls the bridge from under anyone on it. Running out of
// planks also stops it where it is ("Missing construction materials").
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
import { drawbridgeCell } from '../shared/drawbridge.js';

const PLANKS = BLOCK.PLANKS;

export class Drawbridge {
  constructor() {
    this.kind = 'drawbridge';
    this.slots = [null];
    this.rules = [{ accepts: (item) => item === PLANKS }];
    this.dirty = true;
    this.team = null;
    this.dir = 0;
    this.side = 1;
    this.length = C.defaultLength;
    this.target = 'retracted';
    this.stored = 0;
    this.progress = 0;
    this.moving = false;
    this.available = 0;
    this.steam = 0;
    // A move in progress: the target before it, how many sections it has
    // laid, and the section sliding now.
    this.fromTarget = 'retracted';
    this.laid = 0;
    this.step = null;
    this.extended = 0;
    this.state = 'Retracted';
  }

  // The deck cell `i` sections out (1 = the first section; 0 = the mechanism).
  cell(node, i) { return drawbridgeCell(node, this.dir, this.side, i); }

  // Saved before sides existed: keep the old straight-out layout, so its
  // laid sections stay where they are.
  migrate(data) { if (data && !('side' in data)) this.side = 0; }

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
        return { place: true, cell: c, i };
      }
      return { done: true };
    }
    for (let i = this.length; i >= 1; i--) {
      const c = this.cell(node, i);
      if (this.inWorld(world, c) && world.getBlock(c.x, c.y, c.z) === BLOCK.BRIDGE_DECK) return { remove: true, cell: c, i };
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
  // The first section pokes out toward its cell and back.
  jog(game, node) {
    const c = this.cell(node, 1);
    game.broadcast?.({ type: S2C.DRAWBRIDGE_JOG, x: node.x, y: node.y, z: node.z, dx: c.x - node.x, dz: c.z - node.z });
  }

  // The steam a state change costs at the configured length.
  cost() { return C.steamPerSection * this.length; }

  // Ends a move with a state.
  stop(state) { this.moving = false; this.progress = 0; this.state = state; this.step = null; }

  // Starts the next section sliding, or ends the move. False if it ended.
  beginStep(game, node) {
    const move = this.nextMove(game, node);
    if (move.done) { this.stop(this.finished()); return false; }
    if (move.blocked) {
      // Blocked before laying anything: only a jog. Otherwise it rests here.
      if (move.blocked === 'Obstructed' && this.laid === 0) { this.jog(game, node); this.target = this.fromTarget; }
      this.stop(move.blocked);
      return false;
    }
    const c = move.cell;
    this.step = { place: !!move.place, cell: c, i: move.i };
    if (move.remove) { game.world.setBlock(c.x, c.y, c.z, BLOCK.AIR); this.stored++; }
    const from = this.cell(node, move.place ? move.i - 1 : move.i), to = this.cell(node, move.place ? move.i : move.i - 1);
    game.broadcast?.({ type: S2C.DRAWBRIDGE_SLIDE, from, to, laying: !!move.place, seconds: C.sectionSeconds });
    game.broadcast?.({ type: S2C.STEAM_PUFF, x: node.x, y: node.y, z: node.z });
    this.progress = 0;
    return true;
  }

  // The sliding section arrived: a laid one becomes solid deck if its cell
  // is still clear and paid for; otherwise the bridge stops where it is.
  endStep(game) {
    const step = this.step, c = step.cell;
    this.step = null;
    if (!step.place) return true;
    const world = game.world;
    if (world.getBlock(c.x, c.y, c.z) !== BLOCK.AIR || this.occupied(game, c)) { this.stop('Obstructed'); return false; }
    if (this.stored <= 0 && this.planks() < C.sectionPlanks) { this.stop('Missing construction materials'); return false; }
    if (this.stored > 0) this.stored--;
    else { this.slots[0].count -= C.sectionPlanks; if (this.slots[0].count <= 0) this.slots[0] = null; }
    world.setBlock(c.x, c.y, c.z, BLOCK.BRIDGE_DECK);
    this.laid++;
    return true;
  }
  finished() { return this.target === 'extended' ? 'Extended' : 'Retracted'; }

  // One tick (from the fluid system).
  tick(game, node) {
    const before = JSON.stringify([this.state, this.progress, this.extended, this.stored, Math.round(this.available * 10), Math.round(this.steam * 10)]);
    this.available = this.steamAvailable(game, node);
    if (this.moving && (this.step || this.beginStep(game, node))) {
      this.progress += 1 / Math.max(1, Math.round(C.sectionSeconds * TICK_RATE));
      // Arrived: finish this section and start the next straight away, so
      // the end of the bridge slides at a steady speed.
      if (this.progress >= 1 - 1e-9 && this.endStep(game)) this.beginStep(game, node);
    }
    this.extended = this.deckCount(game.world, node);
    if (!this.moving && this.state === 'Extended' && this.extended === 0) this.state = 'Retracted';
    // Quest book: the owning team has had a bridge all the way out.
    if (this.state === 'Extended' && this.extended > 0 && this.team !== null) game.teamProgress?.discover(this.team, 'drawbridgeExtended');
    const after = JSON.stringify([this.state, this.progress, this.extended, this.stored, Math.round(this.available * 10), Math.round(this.steam * 10)]);
    if (after !== before) this.dirty = true;
    return this.dirty;
  }

  // Controls: 'extend', 'retract', 'toggle', 'length' (value 1..maxLength),
  // 'direction' (value 0..3) and 'side' (1 right, -1 left). Nothing is taken while it is moving. A
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
      this.fromTarget = previous; this.laid = 0; this.step = null;
      this.moving = true; this.progress = 0;
      this.state = this.target === 'extended' ? 'Extending' : 'Retracting';
      this.dirty = true;
      return null;
    }
    if (action !== 'length' && action !== 'direction' && action !== 'side') return 'Unknown control';
    if (this.deckCount(game.world, node) > 0) return 'Retract the bridge fully first';
    if (action === 'length') {
      if (!Number.isInteger(value) || value < 1 || value > C.maxLength) return 'Invalid length';
      this.length = value;
    } else if (action === 'side') {
      if (value !== 1 && value !== -1) return 'Invalid side';
      this.side = value;
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
    return { kind: this.kind, slots: this.slots, team: this.team, dir: this.dir, side: this.side, length: this.length, target: this.target, stored: this.stored,
      extended: this.extended, progress: this.progress, moving: this.moving, steamAvailable: this.available, steamCost: this.cost(),
      steamStored: this.steam, steamStorage: C.steamStorage,
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
