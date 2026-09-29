// What each team has done, for Wise Monkey hints: items that have been in a
// member's inventory, items crafted and items placed (shared/dialogue.js).
// Only grows; teams are TEAMS indexes.

import { emptyProgress } from '../shared/dialogue.js';

export class TeamProgress {
  constructor() {
    this.teams = new Map();
  }

  of(team) {
    let progress = this.teams.get(team);
    if (!progress) this.teams.set(team, progress = emptyProgress());
    return progress;
  }

  // Everything the player holds now, whichever way it arrived.
  noteInventory(player) {
    const { obtained } = this.of(player.team), inventory = player.inventory;
    const discovered = [];
    for (const stack of [...inventory.slots, inventory.cursor, inventory.armor, inventory.accessory]) {
      if (stack && !obtained.has(stack.item)) {
        obtained.add(stack.item);
        discovered.push(stack.item);
      }
    }
    return discovered;
  }

  crafted(team, item) {
    this.of(team).crafted.add(item);
  }

  placed(team, item) {
    this.of(team).placed.add(item);
  }
}
