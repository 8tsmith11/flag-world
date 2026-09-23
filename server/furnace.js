// A furnace's own inventory and smelting state (a tile entity, kept in
// world.tileEntities by "x,y,z"). Slots: 0 input, 1 fuel, 2 output. One fuel
// item burns long enough to smelt FUEL[item] items; while it burns and the
// input can smelt into the output, progress builds and every SMELT_TIME one
// item is smelted. The server ticks every furnace, whether or not anyone is
// looking.

import { TICK_RATE, SMELT_TIME } from '../shared/config.js';
import { SMELTING, FUEL } from '../shared/recipes.js';
import { clickSlot, maxStack } from './inventory.js';

export const INPUT = 0;
export const FUEL_SLOT = 1;
export const OUTPUT = 2;
const SMELT_TICKS = Math.round(SMELT_TIME * TICK_RATE);

const SLOT_RULES = [
  { accepts: (item) => item in SMELTING },
  { accepts: (item) => item in FUEL },
  { takeOnly: true },
];

export class Furnace {
  constructor() {
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

  // One server tick. Returns whether anything a viewer sees changed.
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

  // A click on furnace slot 0-2, moving stacks with the player's cursor.
  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button, SLOT_RULES[slot]);
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots = [null, null, null];
    return stacks;
  }

  // What a viewer needs: the slots, fuel left (0-1) and smelt progress (0-1).
  view() {
    return {
      slots: this.slots,
      burn: this.burnTotal ? this.burn / this.burnTotal : 0,
      progress: this.progress / SMELT_TICKS,
    };
  }
}
