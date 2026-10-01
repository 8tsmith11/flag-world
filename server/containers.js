// Blocks with their own inventory, kept by the server as tile entities in
// world.tileEntities ("x,y,z" -> container). Every container has:
//   kind         the block's tileEntity type (chest, furnace, alloyFurnace,
//                anvil, tank, boiler, or crusher)
//   slots        its stacks (null = empty)
//   click()      an inventory-screen click on one of its slots
//   insert()     shift-click from the player's inventory: take what fits
//   tick()       one server tick; true if viewers need an update
//   view()       what a viewer sees
//   takeAll()    empty it (when the block breaks)
// Any number of players can have one open; every click goes through the
// server one at a time, so two players can never take the same items.

import { TICK_RATE, SMELT_TIME, METALS } from '../shared/config.js';
import { SMELTING, FUEL } from '../shared/recipes.js';
import { ITEM } from '../shared/itemIds.js';
import { clickSlot, maxStack } from './inventory.js';
import { rollLoot } from '../shared/loot.js';
import { canHaveMods, rollMods, sameKind } from '../shared/modifiers.js';
import { FluidTank, Boiler, Crusher } from './machines.js';

// Moves as much of `stack` as fits into slots[index] (empty, or the same item
// with room). Returns whether anything moved.
// A modded stack only goes into an empty slot, modifiers and all.
export function mergeInto(slots, index, stack) {
  const target = slots[index];
  if (target && !sameKind(target, stack)) return false;
  const room = maxStack(stack.item) - (target ? target.count : 0);
  const n = Math.min(room, stack.count);
  if (n <= 0) return false;
  if (target) target.count += n;
  else slots[index] = stack.mods?.length ? { item: stack.item, count: n, mods: stack.mods } : { item: stack.item, count: n };
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
    if (this.burn === 0 && smeltable && this.slots[FUEL_SLOT]
      && this.slots[FUEL_SLOT].item in FUEL) {
      const fuel = this.slots[FUEL_SLOT];
      this.burnTotal = this.burn = FUEL[fuel.item] * SMELT_TICKS;
      const bucket = fuel.item === ITEM.LAVA_BUCKET;
      if (--fuel.count === 0) this.slots[FUEL_SLOT] = null;
      if (bucket) {
        if (!this.slots[FUEL_SLOT]) this.slots[FUEL_SLOT] = { item: ITEM.EMPTY_BUCKET, count: 1 };
        else (this.pendingReturns ??= []).push({ item: ITEM.EMPTY_BUCKET, count: 1 });
      }
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

// Two ingredients, one shared fuel supply and a take-only output.
const ALLOY_FUEL = 2, ALLOY_OUTPUT = 3;
const ALLOY_TICKS = Math.round(METALS.alloy.seconds * TICK_RATE);
const ALLOY_SLOTS = [
  { accepts: item => item === ITEM.COPPER_INGOT || item === ITEM.TIN_INGOT },
  { accepts: item => item === ITEM.COPPER_INGOT || item === ITEM.TIN_INGOT },
  { accepts: item => item in FUEL },
  { takeOnly: true },
];

export class AlloyFurnace extends Furnace {
  constructor() {
    super();
    this.kind = 'alloyFurnace';
    this.slots = [null, null, null, null];
  }

  ingredients() {
    const a = this.slots[0], b = this.slots[1];
    if (!a || !b || a.item === b.item) return null;
    const copper = a.item === ITEM.COPPER_INGOT ? a : b;
    const tin = a.item === ITEM.TIN_INGOT ? a : b;
    return copper.item === ITEM.COPPER_INGOT && copper.count >= METALS.alloy.copper
      && tin.item === ITEM.TIN_INGOT && tin.count >= METALS.alloy.tin ? { copper, tin } : null;
  }

  canSmelt() {
    const output = this.slots[ALLOY_OUTPUT];
    return !!this.ingredients() && (!output || (output.item === ITEM.BRONZE_INGOT
      && output.count + METALS.alloy.output <= maxStack(ITEM.BRONZE_INGOT)));
  }

  tick() {
    const before = `${this.burn},${this.progress}`;
    const ready = this.canSmelt();
    if (!this.burn && ready && this.slots[ALLOY_FUEL]) {
      const fuel = this.slots[ALLOY_FUEL];
      this.burnTotal = this.burn = FUEL[fuel.item] * ALLOY_TICKS;
      if (--fuel.count === 0) this.slots[ALLOY_FUEL] = null;
    }
    if (this.burn > 0) {
      this.burn--;
      if (ready && ++this.progress >= ALLOY_TICKS) {
        this.progress = 0;
        const { copper, tin } = this.ingredients();
        copper.count -= METALS.alloy.copper;
        tin.count -= METALS.alloy.tin;
        for (let i = 0; i < 2; i++) if (this.slots[i]?.count === 0) this.slots[i] = null;
        if (this.slots[ALLOY_OUTPUT]) this.slots[ALLOY_OUTPUT].count += METALS.alloy.output;
        else this.slots[ALLOY_OUTPUT] = { item: ITEM.BRONZE_INGOT, count: METALS.alloy.output };
        return true;
      }
    }
    if (!ready || !this.burn) this.progress = 0;
    return `${this.burn},${this.progress}` !== before;
  }

  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button, ALLOY_SLOTS[slot]);
  }

  insert(stack) {
    if (stack.item in FUEL && mergeInto(this.slots, ALLOY_FUEL, stack)) return true;
    if (stack.item !== ITEM.COPPER_INGOT && stack.item !== ITEM.TIN_INGOT) return false;
    for (let i = 0; i < 2; i++) if ((!this.slots[i] || this.slots[i].item === stack.item)
      && mergeInto(this.slots, i, stack)) return true;
    return false;
  }

  view() {
    return { kind: this.kind, slots: this.slots,
      burn: this.burnTotal ? this.burn / this.burnTotal : 0, progress: this.progress / ALLOY_TICKS };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots.fill(null);
    return stacks;
  }
}

// Anvil: one slot, for a moddable item only. reroll() gives it a fresh roll
// of modifiers (the game charges the cost). Anyone at the anvil sees the
// same slot, like a chest.
const ANVIL_SLOT = { accepts: canHaveMods };

export class Anvil {
  constructor() {
    this.kind = 'anvil';
    this.slots = [null];
  }

  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button, ANVIL_SLOT);
  }

  insert(stack) {
    return canHaveMods(stack.item) && mergeInto(this.slots, 0, stack);
  }

  // Replaces the item's modifiers with a new roll; false with nothing to reroll.
  reroll(random = Math.random) {
    const stack = this.slots[0];
    if (!stack || !canHaveMods(stack.item)) return false;
    stack.mods = rollMods(stack.item, random);
    return true;
  }

  tick() {
    return false;
  }

  view() {
    return { kind: this.kind, slots: this.slots };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots = [null];
    return stacks;
  }
}

export function createContainer(kind) {
  if (kind === 'furnace') return new Furnace();
  if (kind === 'alloyFurnace') return new AlloyFurnace();
  if (kind === 'tank') return new FluidTank();
  if (kind === 'boiler') return new Boiler();
  if (kind === 'crusher') return new Crusher();
  if (kind === 'chest') return new Chest();
  if (kind === 'anvil') return new Anvil();
  return null;
}
