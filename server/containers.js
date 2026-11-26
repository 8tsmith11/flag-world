// Blocks with their own inventory, kept by the server as tile entities in
// world.tileEntities ("x,y,z" -> container). Every container has:
//   kind         the block's tileEntity type (chest, furnace, alloyFurnace,
//                anvil, tank, boiler, crusher or depot)
//   slots        its stacks (null = empty)
//   click()      an inventory-screen click on one of its slots
//   insert()     shift-click from the player's inventory: take what fits
//   tick()       one server tick; true if viewers need an update
//   view()       what a viewer sees
//   takeAll()    empty it (when the block breaks)
// Any number of players can have one open; every click goes through the
// server one at a time, so two players can never take the same items.

import { TICK_RATE, SMELT_TIME, METALS, MERCHANT } from '../shared/config.js';
import { SMELTING, FUEL } from '../shared/recipes.js';
import { ITEM } from '../shared/itemIds.js';
import { clickSlot, maxStack } from './inventory.js';
import { rollLoot } from '../shared/loot.js';
import { canHaveMods, rollMods, sameKind } from '../shared/modifiers.js';
import { FluidTank, Boiler, Crusher } from './machines.js';
import { metalOf } from '../shared/merchant.js';

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

  // Why it is or isn't smelting, in words.
  status() {
    const input = this.slots[INPUT], output = this.slots[OUTPUT];
    if (this.burn > 0 && this.canSmelt()) return 'Operating';
    if (!input) return this.burn > 0 ? 'Missing materials (still burning)' : 'Idle: add something to smelt';
    if (!(input.item in SMELTING)) return 'Invalid recipe: that can\'t be smelted';
    if (output && (output.item !== SMELTING[input.item] || output.count >= maxStack(output.item)))
      return 'Output full: take out what\'s in the output slot';
    return 'Missing fuel: add charcoal, wood, planks or a lava bucket';
  }

  // Fuel left (0-1) and smelt progress (0-1) as well as the slots.
  view() {
    return {
      kind: this.kind,
      slots: this.slots,
      burn: this.burnTotal ? this.burn / this.burnTotal : 0,
      progress: this.progress / SMELT_TICKS,
      status: this.status(),
    };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots = [null, null, null];
    return stacks;
  }
}

// Alloy furnace: three ingredient slots, one fuel slot and a take-only
// output. Ingredients are copper and tin in any form: ore, dust or ingot,
// each worth one unit of metal (shared/merchant.js METAL_FORMS), and mixed
// forms add up. METALS.alloy copper units + tin units make
// METALS.alloy.output bronze ingots. Units are whole items, so nothing is
// ever split or made from nothing; crushing ore first (two dust per ore)
// still doubles the bronze, so the crusher stays worth it.
export const ALLOY_INPUTS = [0, 1, 2], ALLOY_FUEL = 3, ALLOY_OUTPUT = 4;
const ALLOY_TICKS = Math.round(METALS.alloy.seconds * TICK_RATE);
const ALLOY_SLOTS = [
  { accepts: item => metalOf(item) !== null },
  { accepts: item => metalOf(item) !== null },
  { accepts: item => metalOf(item) !== null },
  { accepts: item => item in FUEL },
  { takeOnly: true },
];

export class AlloyFurnace extends Furnace {
  constructor() {
    super();
    this.kind = 'alloyFurnace';
    this.slots = [null, null, null, null, null];
  }

  // Saves from before the third ingredient slot: [a, b, fuel, output].
  migrate() {
    if (this.slots.length === 4) this.slots = [this.slots[0], this.slots[1], null, this.slots[2], this.slots[3]];
  }

  accepts(slot, item) { return !!ALLOY_SLOTS[slot]?.accepts?.(item); }

  // Copper and tin units in the ingredient slots.
  units() {
    const units = { copper: 0, tin: 0 };
    for (const i of ALLOY_INPUTS) { const s = this.slots[i], metal = s && metalOf(s.item); if (metal) units[metal] += s.count; }
    return units;
  }

  ingredients() {
    const { copper, tin } = this.units();
    return copper >= METALS.alloy.copper && tin >= METALS.alloy.tin;
  }

  outputFits() {
    const output = this.slots[ALLOY_OUTPUT];
    return !output || (output.item === ITEM.BRONZE_INGOT && output.count + METALS.alloy.output <= maxStack(ITEM.BRONZE_INGOT));
  }

  canSmelt() {
    return this.ingredients() && this.outputFits();
  }

  // Takes `count` units of `metal` from the ingredient slots, first slot first.
  consume(metal, count) {
    for (const i of ALLOY_INPUTS) {
      const s = this.slots[i];
      if (!count || !s || metalOf(s.item) !== metal) continue;
      const n = Math.min(count, s.count);
      s.count -= n; count -= n;
      if (s.count === 0) this.slots[i] = null;
    }
  }

  tick() {
    const before = `${this.burn},${this.progress}`;
    const ready = this.canSmelt();
    if (!this.burn && ready && this.slots[ALLOY_FUEL]) {
      const fuel = this.slots[ALLOY_FUEL];
      this.burnTotal = this.burn = FUEL[fuel.item] * ALLOY_TICKS;
      const bucket = fuel.item === ITEM.LAVA_BUCKET;
      if (--fuel.count === 0) this.slots[ALLOY_FUEL] = null;
      if (bucket) {
        if (!this.slots[ALLOY_FUEL]) this.slots[ALLOY_FUEL] = { item: ITEM.EMPTY_BUCKET, count: 1 };
        else (this.pendingReturns ??= []).push({ item: ITEM.EMPTY_BUCKET, count: 1 });
      }
    }
    if (this.burn > 0) {
      this.burn--;
      if (ready && ++this.progress >= ALLOY_TICKS) {
        this.progress = 0;
        this.consume('copper', METALS.alloy.copper);
        this.consume('tin', METALS.alloy.tin);
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

  // Fuel to the fuel slot; copper or tin onto a matching stack, else an empty slot.
  insert(stack) {
    if (stack.item in FUEL && mergeInto(this.slots, ALLOY_FUEL, stack)) return true;
    if (metalOf(stack.item) === null) return false;
    let moved = false;
    for (const i of ALLOY_INPUTS) if (this.slots[i]?.item === stack.item && stack.count) moved = mergeInto(this.slots, i, stack) || moved;
    for (const i of ALLOY_INPUTS) if (!this.slots[i] && stack.count) moved = mergeInto(this.slots, i, stack) || moved;
    return moved;
  }

  status() {
    const { copper, tin } = this.units();
    if (this.burn > 0 && this.canSmelt()) return 'Operating';
    if (!copper && !tin) return this.slots[ALLOY_FUEL] ? 'Idle: add copper and tin' : 'Idle';
    if (copper < METALS.alloy.copper || tin < METALS.alloy.tin) {
      const need = [copper < METALS.alloy.copper && `${METALS.alloy.copper - copper} more copper`,
        tin < METALS.alloy.tin && `${METALS.alloy.tin - tin} more tin`].filter(Boolean);
      return `Missing materials: needs ${need.join(' and ')}`;
    }
    if (!this.outputFits()) return 'Output full: take out the bronze';
    return 'Missing fuel';
  }

  view() {
    const units = this.units();
    return { kind: this.kind, slots: this.slots, copper: units.copper, tin: units.tin, status: this.status(),
      burn: this.burnTotal ? this.burn / this.burnTotal : 0, progress: this.progress / ALLOY_TICKS };
  }

  takeAll() {
    const stacks = this.slots.filter(Boolean);
    this.slots.fill(null);
    return stacks;
  }
}

// Merchant Depot: selling slots (any item the merchant buys) and take-only
// coin slots. While the team's merchant is docked, server/merchants.js
// sells one batch every MERCHANT.sellTicks (the merchant's batch size, e.g.
// 8 wood for a coin) and puts the coins in the coin slots; a batch is only
// sold when all its coins fit. Items he doesn't buy can't go in.
export const DEPOT_INPUTS = Array.from({ length: MERCHANT.depotInput }, (_, i) => i);
export const DEPOT_OUTPUTS = Array.from({ length: MERCHANT.depotOutput }, (_, i) => MERCHANT.depotInput + i);
let depotOffers = [];
// The merchant's buy list for this match (set by server/merchants.js).
export function setDepotOffers(list) { depotOffers = list; }

export class Depot {
  constructor() {
    this.kind = 'depot';
    this.slots = new Array(MERCHANT.depotInput + MERCHANT.depotOutput).fill(null);
    // Whether the team's merchant is docked (kept up to date by the merchant system).
    this.present = false;
    this.team = null;
    this.sold = 0;
  }

  offer(item) { return depotOffers.find((o) => o.item === item) ?? null; }
  sellable(item) { return !!this.offer(item); }
  inputSlots() { return DEPOT_INPUTS; }

  click(slot, button, holder) {
    return clickSlot(this.slots, slot, holder, button,
      slot < MERCHANT.depotInput ? { accepts: (item) => this.sellable(item) } : { takeOnly: true });
  }

  insert(stack) {
    if (!this.sellable(stack.item) || stack.mods?.length) return false;
    let moved = false;
    for (const i of DEPOT_INPUTS) if (this.slots[i]?.item === stack.item && stack.count) moved = mergeInto(this.slots, i, stack) || moved;
    for (const i of DEPOT_INPUTS) if (!this.slots[i] && stack.count) moved = mergeInto(this.slots, i, stack) || moved;
    return moved;
  }

  // Room for this many more coins in the coin slots.
  coinRoom() {
    return DEPOT_OUTPUTS.reduce((n, i) => n + (!this.slots[i] ? maxStack(ITEM.GOLD_COIN)
      : this.slots[i].item === ITEM.GOLD_COIN ? maxStack(ITEM.GOLD_COIN) - this.slots[i].count : 0), 0);
  }

  // Sells one batch of the first sellable stack that has a full batch and
  // whose coins fit. Returns { item, count, coins } or null.
  sellOne() {
    const counts = new Map();
    for (const i of DEPOT_INPUTS) { const s = this.slots[i]; if (s) counts.set(s.item, (counts.get(s.item) ?? 0) + s.count); }
    const room = this.coinRoom();
    for (const i of DEPOT_INPUTS) {
      const s = this.slots[i], offer = s && this.offer(s.item);
      if (!offer || counts.get(s.item) < offer.count || offer.coins > room) continue;
      let left = offer.count;
      for (const j of DEPOT_INPUTS) {
        const t = this.slots[j];
        if (!left || t?.item !== s.item) continue;
        const n = Math.min(left, t.count); t.count -= n; left -= n;
        if (!t.count) this.slots[j] = null;
      }
      const coins = { item: ITEM.GOLD_COIN, count: offer.coins };
      for (const j of DEPOT_OUTPUTS) if (coins.count) mergeInto(this.slots, j, coins);
      this.sold += offer.coins;
      return { item: offer.item, count: offer.count, coins: offer.coins };
    }
    return null;
  }

  status() {
    const goods = DEPOT_INPUTS.some((i) => this.slots[i]);
    if (!this.present) return goods ? 'Waiting for the merchant (he docks each morning)' : 'The merchant is away';
    if (!goods) return 'Merchant docked: put goods in the selling slots';
    if (!this.coinRoom()) return 'Coin slots full: take out the coins';
    const counts = new Map();
    for (const i of DEPOT_INPUTS) { const s = this.slots[i]; if (s) counts.set(s.item, (counts.get(s.item) ?? 0) + s.count); }
    const ready = [...counts].some(([item, n]) => n >= (this.offer(item)?.count ?? Infinity));
    return ready ? 'Selling' : 'Not enough for a full batch yet';
  }

  tick() { return false; }

  view() {
    return { kind: this.kind, slots: this.slots, present: this.present, status: this.status(), sold: this.sold };
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
  if (kind === 'depot') return new Depot();
  return null;
}
