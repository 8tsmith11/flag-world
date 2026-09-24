// Hotbar HUD: one box per hotbar slot (inventory slots 0-8) with the item's
// icon and stack count, and the selected slot highlighted.

import { HOTBAR_SIZE } from '/shared/config.js';
import { getItemDef } from '/shared/items.js';
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
    this.stacks = [];
    this.nameLabel = document.createElement('div');
    this.nameLabel.className = 'selected-item-name';
    this.nameLabel.hidden = true;
    element.append(this.nameLabel);
    this.nameTimer = null;
    this.selected = -1;
  }

  // stacks: the inventory's slots (the first HOTBAR_SIZE are shown).
  setInventory(stacks) {
    this.stacks = stacks;
    this.slots.forEach((slot, i) => renderStack(slot, stacks[i]));
  }

  select(index) {
    if (index === this.selected) return;
    const hadSelection = this.selected >= 0;
    this.slots[this.selected]?.classList.remove('selected');
    this.slots[index].classList.add('selected');
    this.selected = index;
    clearTimeout(this.nameTimer);
    const item = this.stacks[index]?.item;
    this.nameLabel.hidden = !hadSelection || item == null;
    if (!this.nameLabel.hidden) {
      this.nameLabel.textContent = getItemDef(item).name;
      this.nameTimer = setTimeout(() => { this.nameLabel.hidden = true; }, 1000);
    }
  }
}
