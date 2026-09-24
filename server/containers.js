// Blocks with their own inventory, kept by the server as tile entities in
// world.tileEntities ("x,y,z" -> container). Every container has:
//   kind         'furnace' or 'chest' (the block's tileEntity)
//   slots        its stacks (null = empty)
//   click()      an inventory-screen click on one of its slots
//   insert()     shift-click from the player's inventory: take what fits
//   tick()       one server tick; true if viewers need an update
//   view()       what a viewer sees
//   takeAll()    empty it (when the block breaks)
// Any number of players can have one open; every click goes through the
// server one at a time, so two players can never take the same items.

import { TICK_RATE, SMELT_TIME } from '../shared/config.js';
import { SMELTING, FUEL } from '../shared/recipes.js';
import { clickSlot, maxStack } from './inventory.js';
import { rollLoot } from '../shared/loot.js';

// Moves as much of `stack` as fits into slots[index] (empty, or the same item
// with room). Returns whether anything moved.
function mergeInto(slots, index, stack) {
  const target = slots[index];
  if (target && target.item !== stack.item) return false;
  const room = maxStack(stack.item) - (target ? target.count : 0);
  const n = Math.min(room, stack.count);
  if (n <= 0) return false;
  if (target) target.count += n;
  else slots[index] = { item: stack.item, count: n };
  stack.count -= n;
  return true;
}

export const CHEST_SIZE = 27;

export class Chest {
  constructor(lootTable = null) {
    this.kind = 'chest';
    this.slots = new Array(CHEST_SIZE).fill(null);
    this.lootTable = lootTable;
  }

  populate(seed, x, y, z) {
    if (!this.lootTable) return;
    this.slots = rollLoot(this.lootTable, seed, x, y, z, CHEST_SIZE);
    this.lootTable = null;
    this.dirty = true;
  }

  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button);
  }

  // Tops up matching stacks, then fills empty slots.
  insert(stack) {
    let moved = false;
    for (let i = 0; i < this.slots.length && stack.count > 0; i++) {
      if (this.slots[i]?.item === stack.item) moved = mergeInto(this.slots, i, stack) || moved;
    }
    for (let i = 0; i < this.slots.length && stack.count > 0; i++) {
      if (!this.slots[i]) moved = mergeInto(this.slots, i, stack) || moved;
    }
    return moved;
  }

  tick() {
    return false;
  }

  view() {
    return { kind: this.kind, slots: this.slots };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots.fill(null);
    return stacks;
  }
}

// Furnace slots: 0 input, 1 fuel, 2 output. One fuel item burns long enough to
// smelt FUEL[item] items; while it burns and the input can smelt into the
// output, progress builds and every SMELT_TIME one item is smelted. The server
// ticks every furnace, whether or not anyone is looking.
export const INPUT = 0;
export const FUEL_SLOT = 1;
export const OUTPUT = 2;
const SMELT_TICKS = Math.round(SMELT_TIME * TICK_RATE);

const FURNACE_SLOTS = [
  { accepts: (item) => item in SMELTING },
  { accepts: (item) => item in FUEL },
  { takeOnly: true },
];

export class Furnace {
  constructor() {
    this.kind = 'furnace';
    this.slots = [null, null, null];
    // Ticks of fuel left, out of how many the current fuel item gave.
    this.burn = 0;
    this.burnTotal = 0;
    // Ticks of smelting done on the current input item.
    this.progress = 0;
  }

  // Whether the input can smelt into the output slot right now.
  canSmelt() {
    const input = this.slots[INPUT], output = this.slots[OUTPUT];
    if (!input || !(input.item in SMELTING)) return false;
    const result = SMELTING[input.item];
    return !output || (output.item === result && output.count < maxStack(result));
  }

  tick() {
    const before = `${this.burn},${this.progress}`;
    const smeltable = this.canSmelt();
    if (this.burn === 0 && smeltable && this.slots[FUEL_SLOT]) {
      const fuel = this.slots[FUEL_SLOT];
      this.burnTotal = this.burn = FUEL[fuel.item] * SMELT_TICKS;
      if (--fuel.count === 0) this.slots[FUEL_SLOT] = null;
    }
    if (this.burn > 0) {
      this.burn--;
      if (smeltable && ++this.progress >= SMELT_TICKS) {
        this.progress = 0;
        const input = this.slots[INPUT];
        const result = SMELTING[input.item];
        if (--input.count === 0) this.slots[INPUT] = null;
        if (this.slots[OUTPUT]) this.slots[OUTPUT].count++;
        else this.slots[OUTPUT] = { item: result, count: 1 };
        return true;
      }
    }
    // Out of fuel or nothing to smelt: the half-done item starts over.
    if (!smeltable || this.burn === 0) this.progress = 0;
    return `${this.burn},${this.progress}` !== before;
  }

  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button, FURNACE_SLOTS[slot]);
  }

  // Ore goes to the input, fuel to the fuel slot; nothing else goes in.
  insert(stack) {
    if (stack.item in SMELTING) return mergeInto(this.slots, INPUT, stack);
    if (stack.item in FUEL) return mergeInto(this.slots, FUEL_SLOT, stack);
    return false;
  }

  // Fuel left (0-1) and smelt progress (0-1) as well as the slots.
  view() {
    return {
      kind: this.kind,
      slots: this.slots,
      burn: this.burnTotal ? this.burn / this.burnTotal : 0,
      progress: this.progress / SMELT_TICKS,
    };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots = [null, null, null];
    return stacks;
  }
}

export function createContainer(kind) {
  if (kind === 'furnace') return new Furnace();
  if (kind === 'chest') return new Chest();
  return null;
}
