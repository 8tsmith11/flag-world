// What held items do. Hammers are the only breaking tools: strength gates
// which blocks they can break (vs. the block's hardness) and speed divides the
// break time. Swords replace fist damage and have their own attack cooldown.
// Anything else in hand (or nothing) counts as bare hands for both.

import { HAND_STRENGTH, ATTACK_DAMAGE, ATTACK_COOLDOWN } from './config.js';
import { ITEM } from './itemIds.js';

export const HANDS = { strength: HAND_STRENGTH, speed: 1, damage: ATTACK_DAMAGE, cooldown: ATTACK_COOLDOWN };

const SWORD_COOLDOWN = 0.6;

export const HAMMERS = {
  [ITEM.WOOD_HAMMER]: { strength: 2, speed: 1 },
  [ITEM.STONE_HAMMER]: { strength: 3, speed: 1.5 },
  [ITEM.IRON_HAMMER]: { strength: 4, speed: 2 },
};

export const SWORDS = {
  [ITEM.WOOD_SWORD]: { damage: 3, cooldown: SWORD_COOLDOWN },
  [ITEM.STONE_SWORD]: { damage: 4, cooldown: SWORD_COOLDOWN },
  [ITEM.IRON_SWORD]: { damage: 6, cooldown: SWORD_COOLDOWN },
};

// { strength, speed } for breaking with `item` (null = empty hand) in hand.
export function breakingStats(item) {
  return HAMMERS[item] ?? HANDS;
}

// { damage, cooldown (seconds) } for punching or slashing with `item` in hand.
export function attackStats(item) {
  return SWORDS[item] ?? HANDS;
}
