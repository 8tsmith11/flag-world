// Fishing, as data and pure rules shared by the server (which decides
// everything) and the client (tooltips, the bait screen, the quest book).
//
// Rods: each has four attributes plus where it can fish (ROD_STATS); future
// rods are just new entries. Random modifiers (shared/modifiers.js, category
// 'rod') change the effective values: Swift multiplies Fishing Speed, Lucky
// multiplies the Fishing Multiplier, Thrifty adds Bait Conservation (capped
// at FISHING.maxConservation). Nothing changes a rod's tier or environments.
//
// Bait: BAIT lists what can be used and its quality. Quality, like the
// Fishing Multiplier, only changes which reward bites (never the wait).
//
// Bites: biteSeconds() samples a bounded wait bunched around its middle and
// divides it by the effective Fishing Speed; monkeys wait monkeySlowdown
// times longer.
//
// Loot: FISHING_LOOT has one table per environment and tier ('water:1',
// 'void:2', 'lava:2', ...). Each entry is an item ({ item, min, max,
// modChance? }) or an encounter ({ encounter: 'voidEel' }), with a base
// weight and a boost. A catch's luck is multiplier * bait quality; each
// weight becomes weight * luck^boost, then they are normalized and one is
// picked. Boost 0 entries (the plain catch) never grow, so luck shifts the
// odds toward the boosted rewards without adding anything the table lacks.
// Every catch gives exactly one result.
import { ITEM } from './itemIds.js';
import { BLOCK } from './blocks.js';
import { FISHING } from './config.js';
import { modValue } from './modifiers.js';

export const ROD_STATS = {
  [ITEM.WOOD_FISHING_ROD]: { tier: 1, multiplier: 1, speed: 1, conservation: 0.1, environments: ['water', 'void'] },
  [ITEM.BRONZE_FISHING_ROD]: { tier: 2, multiplier: 1.5, speed: 1, conservation: 0.1, environments: ['water', 'void', 'lava'] },
};

export function isRod(item) { return !!ROD_STATS[item]; }

// The rod's effective attributes, modifiers included. null if not a rod.
export function rodStats(stack) {
  const base = ROD_STATS[stack?.item];
  if (!base) return null;
  return {
    tier: base.tier,
    multiplier: base.multiplier * (1 + modValue(stack, 'lucky')),
    speed: base.speed * (1 + modValue(stack, 'swift')),
    conservation: Math.min(FISHING.maxConservation, base.conservation + modValue(stack, 'thrifty')),
    environments: base.environments,
  };
}

// Bait, best last. quality multiplies the luck of a catch.
export const BAIT = {
  [ITEM.BREAD]: { quality: 1, effect: 'Basic bait' },
  [ITEM.BEEF]: { quality: 1.6, effect: 'Better catches (×1.6 luck)' },
  [ITEM.GOLDEN_BEEF]: { quality: 3, effect: 'Much better catches (×3 luck)' },
};
export const BAIT_ITEMS = Object.keys(BAIT).map(Number);
export function isBait(item) { return !!BAIT[item]; }

// A base bite wait in seconds from `random`: the mean of a few uniform draws
// between min and max, so it never leaves that range but is usually near the
// middle. Divided by the rod's speed (and slowed for monkeys).
export function biteSeconds(random, speed = 1, monkey = false) {
  const { min, max, samples } = FISHING.bite;
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += random();
  const base = min + (max - min) * sum / samples;
  return base * (monkey ? FISHING.monkeySlowdown : 1) / speed;
}

const item = (id, weight, boost, min = 1, max = 1, extra = {}) => ({ item: id, weight, boost, min, max, ...extra });

// Loot tables by `${environment}:${tier}`.
export const FISHING_LOOT = {
  'water:1': [
    item(ITEM.FISH, 70, 0), item(ITEM.WHEAT_SEEDS, 6, 0.3, 1, 3), item(ITEM.LEATHER, 5, 0.4),
    item(ITEM.ROPE_BUNDLE, 2, 0.8), item(ITEM.SULFUR_SEEDS, 2, 0.8, 1, 2), item(ITEM.GOLD_COIN, 2, 1, 1, 2),
    item(ITEM.IRON_INGOT, 1.5, 1), item(ITEM.LOOT_CRATE, 2.5, 1),
  ],
  'water:2': [
    item(ITEM.FISH, 62, 0), item(ITEM.WHEAT_SEEDS, 5, 0.3, 1, 3), item(ITEM.LEATHER, 5, 0.4),
    item(ITEM.ROPE_BUNDLE, 2, 0.8), item(ITEM.SULFUR_SEEDS, 2.5, 0.8, 1, 3), item(ITEM.GOLD_COIN, 2.5, 1, 1, 3),
    item(ITEM.IRON_INGOT, 3, 1), item(ITEM.GOLDEN_BEEF, 0.5, 1.2), item(ITEM.LOOT_CRATE, 3, 1),
    item(ITEM.IRONBOUND_CRATE, 1.2, 1.2),
  ],
  'void:1': [
    item(ITEM.VOID_FISH, 60, 0), item(ITEM.SILK, 6, 0.3, 1, 2), item(BLOCK.GLOW_MOSS, 5, 0.3, 1, 3),
    item(BLOCK.OBSIDIAN, 3, 0.5), item(ITEM.RIFT_ORB, 1.5, 1), item(ITEM.GOLD_COIN, 2, 1, 1, 2),
    item(ITEM.LOOT_CRATE, 2.5, 1),
  ],
  'void:2': [
    item(ITEM.VOID_FISH, 55, 0), item(ITEM.SILK, 6, 0.3, 1, 3), item(BLOCK.GLOW_MOSS, 4, 0.3, 1, 3),
    item(BLOCK.OBSIDIAN, 3, 0.5, 1, 2), item(ITEM.RIFT_ORB, 2.5, 1), item(ITEM.DRAGON_SCALE, 0.6, 1.3),
    item(ITEM.GOLD_COIN, 2, 1, 1, 3), item(ITEM.LOOT_CRATE, 3, 1), item(ITEM.IRONBOUND_CRATE, 1.4, 1.2),
    { encounter: 'voidEel', weight: 3, boost: 0 },
  ],
  'lava:2': [
    item(BLOCK.BASALT, 22, 0, 1, 3), item(ITEM.CHARCOAL, 16, 0, 1, 3), item(BLOCK.OBSIDIAN, 10, 0.2),
    item(ITEM.COPPER_INGOT, 10, 0.4, 1, 2), item(ITEM.TIN_INGOT, 7, 0.5), item(ITEM.IRON_INGOT, 7, 0.7, 1, 2),
    item(ITEM.DRAGON_SCALE, 0.6, 1.3), item(ITEM.EMBER_HEART, 0.25, 1.5, 1, 1, { modChance: 0.5 }),
    item(ITEM.IRONBOUND_CRATE, 2.5, 1.1),
  ],
};

export function lootTableFor(environment, tier) { return FISHING_LOOT[`${environment}:${tier}`] ?? null; }

// The table's entries with luck applied and normalized: [{ entry, chance }].
export function catchChances(table, luck) {
  const weights = table.map((entry) => entry.weight * Math.pow(Math.max(luck, 1e-6), entry.boost));
  const total = weights.reduce((a, b) => a + b, 0);
  return table.map((entry, i) => ({ entry, chance: weights[i] / total }));
}

// One catch: { stack: {item, count, mods?} } or { encounter }. Never empty.
// `rollMods(item, random)` is passed in (the server's modifier roll).
export function rollCatch(table, luck, random, rollMods = null) {
  const chances = catchChances(table, luck);
  let r = random();
  const { entry } = chances.find((c) => (r -= c.chance) < 0) ?? chances.at(-1);
  if (entry.encounter) return { encounter: entry.encounter };
  const count = entry.min + Math.floor(random() * (entry.max - entry.min + 1));
  const stack = { item: entry.item, count };
  if (entry.modChance && rollMods && random() < entry.modChance) {
    const mods = rollMods(entry.item, random);
    if (mods.length) stack.mods = mods;
  }
  return { stack };
}

// Where a rod can fish, in words, for tooltips (positive statements only).
export const ENVIRONMENT_NAMES = { water: 'water', void: 'the void', lava: 'lava' };
