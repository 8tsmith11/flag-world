// What held items do. Hammers are the only breaking tools: strength gates
// which blocks they can break (vs. the block's hardness) and speed divides the
// break time. Melee weapons replace fist damage and have their own attack
// cooldown; they may also scale knockback (and its upward lift), slow what
// they hit, or be unable to break anything. Anything else in hand (or
// nothing) counts as bare hands for both.

import {
  HAND_STRENGTH, ATTACK_DAMAGE, ATTACK_COOLDOWN, KNOCKBACK_UP, BOW_FULL_DRAW, BOW_MIN_DRAW, CROSSBOW_LOAD_TIME, TICK_RATE,
} from './config.js';
import { ITEM } from './itemIds.js';
import { modValue } from './modifiers.js';

export const HANDS = { strength: HAND_STRENGTH, speed: 1, damage: ATTACK_DAMAGE, cooldown: ATTACK_COOLDOWN };
// Strength no block's hardness is below: breaks nothing.
const NO_BREAKING = { strength: -Infinity, speed: 1 };

const SWORD_COOLDOWN = 0.6;

// Frost from the Ice Sword: movement speed drops by `slow` for `seconds`.
export const FROST = { slow: 0.4, seconds: 2 };

export const HAMMERS = {
  [ITEM.WOOD_HAMMER]: { strength: 2, speed: 1 },
  [ITEM.STONE_HAMMER]: { strength: 3, speed: 1.5 },
  [ITEM.IRON_HAMMER]: { strength: 4, speed: 2 },
};

// damage, cooldown (seconds); optional knockback (multiplier on the punch's),
// lift (upward speed, blocks/s, instead of KNOCKBACK_UP), frost (applies
// FROST), breaks: false (can't break blocks at all).
export const SWORDS = {
  [ITEM.WOOD_SWORD]: { damage: 3, cooldown: SWORD_COOLDOWN },
  [ITEM.STONE_SWORD]: { damage: 4, cooldown: SWORD_COOLDOWN },
  [ITEM.IRON_SWORD]: { damage: 6, cooldown: SWORD_COOLDOWN },
  [ITEM.WIND_AXE]: { damage: 3, cooldown: 0.8, knockback: 3, lift: KNOCKBACK_UP * 1.8, breaks: false },
  [ITEM.ICE_SWORD]: { damage: 5, cooldown: SWORD_COOLDOWN, frost: true },
};

// Stats for what's in hand take the stack (null = empty hand), so its
// modifiers (shared/modifiers.js) apply.

// { strength, speed } for breaking. Efficient speeds hammers up.
export function breakingStats(stack) {
  const item = stack?.item ?? null;
  if (SWORDS[item]?.breaks === false) return NO_BREAKING;
  const base = HAMMERS[item] ?? HANDS;
  const efficient = modValue(stack, 'efficient');
  return efficient ? { ...base, speed: base.speed * (1 + efficient) } : base;
}

// { damage, cooldown (seconds), knockback?, lift?, frost?, heal } for
// punching or slashing: Sharp adds damage, Keen shortens the cooldown, Heavy
// scales knockback, and Vampiric is the chance (heal) of healing 1 HP on a hit.
export function attackStats(stack) {
  const base = SWORDS[stack?.item ?? null] ?? HANDS;
  if (!stack?.mods?.length) return { ...base, heal: 0 };
  return {
    ...base,
    damage: base.damage + modValue(stack, 'sharp'),
    cooldown: base.cooldown * (1 - modValue(stack, 'keen')),
    knockback: (base.knockback ?? 1) * (1 + modValue(stack, 'heavy')),
    heal: modValue(stack, 'vampiric'),
  };
}

// Bows and crossbows in ticks: a bow's full and shortest draw, a crossbow's
// load, extra arrow damage and an arrow speed scale. Quickdraw shortens the
// draw and load, Power adds damage and Far speeds arrows up.
export function rangedStats(stack) {
  const draw = 1 - modValue(stack, 'quickdraw');
  const ticks = (seconds) => Math.max(1, Math.round(seconds * draw * TICK_RATE));
  return {
    fullDrawTicks: ticks(BOW_FULL_DRAW),
    minDrawTicks: ticks(BOW_MIN_DRAW),
    loadTicks: ticks(CROSSBOW_LOAD_TIME),
    damageBonus: modValue(stack, 'power'),
    speedScale: 1 + modValue(stack, 'far'),
  };
}
