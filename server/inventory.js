// Server-owned player inventory: INVENTORY_SIZE slots (the hotbar is 0-8, the
// main grid the rest), each null or a stack { item, count }, plus the stack
// held on the mouse cursor while the inventory screen is open.

import { INVENTORY_SIZE, HOTBAR_SIZE } from '../shared/config.js';
import { getItemDef } from '../shared/items.js';
import { countItems } from '../shared/recipes.js';

export function maxStack(item) {
  return getItemDef(item).maxStack;
}

// A click on slots[index] in an inventory or container screen, moving stacks
// between it and holder.cursor (the stack on the mouse):
//   left:  pick up the whole stack; or put the cursor down, merging into a
//          matching stack (up to its max) or swapping with a different one.
//   right: pick up half (rounded up); or put one item from the cursor down.
// accepts(item): what may be put in this slot. takeOnly: nothing may be put
// in; a left click can still add the slot's stack to a matching cursor stack.
// Returns false if the click did nothing.
export function clickSlot(slots, index, holder, button, { accepts = () => true, takeOnly = false } = {}) {
  const stack = slots[index];
  const cursor = holder.cursor;
  if (!cursor) {
    if (!stack) return false;
    const n = button === 'right' && !takeOnly ? Math.ceil(stack.count / 2) : stack.count;
    holder.cursor = { item: stack.item, count: n };
    stack.count -= n;
    if (stack.count === 0) slots[index] = null;
    return true;
  }
  if (takeOnly) {
    if (!stack || stack.item !== cursor.item || cursor.count + stack.count > maxStack(cursor.item)) return false;
    cursor.count += stack.count;
    slots[index] = null;
    return true;
  }
  if (!accepts(cursor.item)) return false;
  if (button === 'right') {
    if (stack && (stack.item !== cursor.item || stack.count >= maxStack(stack.item))) return false;
    if (stack) stack.count++;
    else slots[index] = { item: cursor.item, count: 1 };
    if (--cursor.count === 0) holder.cursor = null;
    return true;
  }
  if (!stack) {
    slots[index] = cursor;
    holder.cursor = null;
  } else if (stack.item === cursor.item && stack.count < maxStack(stack.item)) {
    const n = Math.min(cursor.count, maxStack(stack.item) - stack.count);
    stack.count += n;
    cursor.count -= n;
    if (cursor.count === 0) holder.cursor = null;
  } else {
    slots[index] = cursor;
    holder.cursor = stack;
  }
  return true;
}

export class Inventory {
  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
    this.cursor = null;
    this.armor = null;
  }

  // Adds up to `count` of `item`, topping up matching stacks before using empty
  // slots, hotbar first in both passes. Returns how many didn't fit.
  add(item, count) {
    return this.addTo(item, count, 0, this.slots.length);
  }

  // add(), limited to slots from..to-1.
  addTo(item, count, from, to) {
    const max = maxStack(item);
    for (let i = from; i < to && count > 0; i++) {
      const stack = this.slots[i];
      if (!stack || stack.item !== item || stack.count >= max) continue;
      const n = Math.min(count, max - stack.count);
      stack.count += n;
      count -= n;
    }
    for (let i = from; i < to && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(count, max);
      this.slots[i] = { item, count: n };
      count -= n;
    }
    return count;
  }

  get(slot) {
    return this.slots[slot] ?? null;
  }

  // Removes one item from a slot; returns its item id, or null if the slot is empty.
  takeOne(slot) {
    const stack = this.slots[slot];
    if (!stack) return null;
    if (--stack.count === 0) this.slots[slot] = null;
    return stack.item;
  }

  // Removes `count` of `item` from wherever it is, main grid first so the
  // hotbar keeps what's in hand. The caller checks there is enough.
  remove(item, count) {
    const order = [...this.slots.keys()].reverse();
    for (const i of order) {
      const stack = this.slots[i];
      if (count === 0) break;
      if (!stack || stack.item !== item) continue;
      const n = Math.min(count, stack.count);
      stack.count -= n;
      count -= n;
      if (stack.count === 0) this.slots[i] = null;
    }
  }

  // Inventory-screen click on one of these slots; see clickSlot.
  click(slot, button) {
    return clickSlot(this.slots, slot, this, button);
  }

  // Shift-click with no container open: moves a stack between the hotbar and
  // the main grid, as much as fits. Returns whether anything moved.
  shiftMove(slot) {
    const stack = this.slots[slot];
    if (!stack) return false;
    const [from, to] = slot < HOTBAR_SIZE ? [HOTBAR_SIZE, this.slots.length] : [0, HOTBAR_SIZE];
    const left = this.addTo(stack.item, stack.count, from, to);
    if (left === stack.count) return false;
    stack.count = left;
    if (left === 0) this.slots[slot] = null;
    return true;
  }

  // Puts the cursor stack back into the slots; returns what didn't fit (a
  // stack) or null.
  stowCursor() {
    if (!this.cursor) return null;
    const { item, count } = this.cursor;
    this.cursor = null;
    const left = this.add(item, count);
    return left > 0 ? { item, count: left } : null;
  }

  // Crafts `recipe` if the slots hold its inputs and the output fits. Returns
  // whether it did.
  craft(recipe) {
    const counts = countItems(this.slots);
    if (!recipe.inputs.every(({ item, count }) => (counts.get(item) ?? 0) >= count)) return false;
    // Try it on a copy so a full inventory refuses the craft rather than losing items.
    const trial = new Inventory(this.slots.length);
    trial.slots = this.slots.map((s) => s && { ...s });
    for (const { item, count } of recipe.inputs) trial.remove(item, count);
    if (trial.add(recipe.output, recipe.count) > 0) return false;
    this.slots = trial.slots;
    return true;
  }

  // Everything held, slots and cursor, emptied out (for dropping on death).
  takeAll() {
    const stacks = [...this.slots, this.cursor, this.armor].filter(Boolean);
    this.slots.fill(null);
    this.cursor = null;
    this.armor = null;
    return stacks;
  }

  toJSON() {
    return { slots: this.slots, cursor: this.cursor, armor: this.armor };
  }
}
