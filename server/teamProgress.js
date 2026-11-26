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

  // A gameplay milestone for the quest book ('role:guard', 'merchantSale',
  // 'kill:goblin', ...). Counted, so quests can ask for several.
  event(team, key, amount = 1) {
    if (team === null || team === undefined) return;
    const events = this.of(team).events;
    events.set(key, (events.get(key) ?? 0) + amount);
    this.onEvent?.(team, key);
  }

  // A one-off discovery or milestone ('visit:fire', 'monkeyFed:crusher'...):
  // recorded once, however often it happens.
  discover(team, key) {
    if (team === null || team === undefined || this.of(team).events.has(key)) return;
    this.event(team, key);
  }

  save() {
    return [...this.teams].map(([team, p]) => ({ team, obtained: [...p.obtained], crafted: [...p.crafted],
      placed: [...p.placed], events: [...p.events] }));
  }

  load(list) {
    for (const data of list ?? []) {
      const p = this.of(data.team);
      for (const id of data.obtained ?? []) p.obtained.add(id);
      for (const id of data.crafted ?? []) p.crafted.add(id);
      for (const id of data.placed ?? []) p.placed.add(id);
      for (const [key, n] of data.events ?? []) p.events.set(key, n);
    }
  }
}
