// Hotbar HUD: one box per hotbar slot (inventory slots 0-8) with the item's
// icon and stack count, and the selected slot highlighted.

import { HOTBAR_SIZE } from '/shared/config.js';
import { renderStack } from './itemIcon.js';

export class Hotbar {
  constructor(element) {
    this.slots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      element.append(slot);
      this.slots.push(slot);
    }
    this.selected = -1;
  }

  // stacks: the inventory's slots (the first HOTBAR_SIZE are shown).
  setInventory(stacks) {
    this.slots.forEach((slot, i) => renderStack(slot, stacks[i]));
  }

  select(index) {
    if (index === this.selected) return;
    this.slots[this.selected]?.classList.remove('selected');
    this.slots[index].classList.add('selected');
    this.selected = index;
  }
}
