import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { getItemDef } from './items.js';
import { mulberry32 } from './structures.js';
import { rollMods } from './modifiers.js';

// Entries: { item, weight, min, max, modChance? }. modChance is the chance a
// moddable item rolls its one fixed-value modifier (shared/modifiers.js).
// Common gear is rarely modded; rarer finds often are.
const COMMON_MODS = 0.15;
const IRON_MODS = 0.3;
const RARE_MODS = 0.5;

const supplies = [
  { item: BLOCK.PLANKS, weight: 22, min: 3, max: 10 },
  { item: BLOCK.STONE, weight: 19, min: 4, max: 12 },
  { item: BLOCK.SAND, weight: 11, min: 3, max: 9 },
  { item: BLOCK.IRON_ORE, weight: 9, min: 2, max: 6 },
  { item: ITEM.LEATHER, weight: 10, min: 1, max: 4 },
  { item: ITEM.BEEF, weight: 10, min: 1, max: 3 },
  // Sulfur never grows wild: chests and the Sky Merchant are where seeds start.
  { item: ITEM.SULFUR_SEEDS, weight: 6, min: 1, max: 3 },
];
const simpleGear = [
  { item: ITEM.WOOD_SWORD, weight: 5, min: 1, max: 1, modChance: COMMON_MODS },
  { item: ITEM.WOOD_HAMMER, weight: 5, min: 1, max: 1, modChance: COMMON_MODS },
  { item: ITEM.BOW, weight: 3, min: 1, max: 1, modChance: COMMON_MODS },
];
const usefulGear = [
  { item: ITEM.STONE_SWORD, weight: 5, min: 1, max: 1, modChance: COMMON_MODS },
  { item: ITEM.STONE_HAMMER, weight: 5, min: 1, max: 1, modChance: COMMON_MODS },
  { item: ITEM.LEATHER_ARMOR, weight: 3, min: 1, max: 1, modChance: COMMON_MODS },
  { item: ITEM.IRON_INGOT, weight: 7, min: 1, max: 4 },
];
const ironGear = (weight = 1, modChance = IRON_MODS) => [
  { item: ITEM.IRON_SWORD, weight: 2 * weight, min: 1, max: 1, modChance },
  { item: ITEM.IRON_HAMMER, weight: 2 * weight, min: 1, max: 1, modChance },
  { item: ITEM.IRON_ARMOR, weight: weight, min: 1, max: 1, modChance },
];
// The central island is where the good stuff is: no wood or stone tools,
// fewer bulk blocks, ingots and coins instead, and iron gear more often.
const centralSupplies = [
  ...supplies.map((entry) => [BLOCK.PLANKS, BLOCK.STONE, BLOCK.SAND].includes(entry.item) ? { ...entry, weight: entry.weight / 3 } : entry),
  { item: ITEM.COPPER_INGOT, weight: 6, min: 2, max: 5 },
  { item: ITEM.TIN_INGOT, weight: 5, min: 1, max: 3 },
  { item: ITEM.GOLD_COIN, weight: 6, min: 2, max: 6 },
];
const centralGear = [
  { item: ITEM.LEATHER_ARMOR, weight: 3, min: 1, max: 1, modChance: IRON_MODS },
  { item: ITEM.IRON_INGOT, weight: 9, min: 2, max: 5 },
];
const goldenBeef = (weight) => ({ item: ITEM.GOLDEN_BEEF, weight, min: 1, max: 1 });
const accessoryEntries = (weight) => [
  ITEM.WIND_BOOTS, ITEM.SPRING_BOOTS, ITEM.HEART_AMULET,
  ITEM.MENDING_CHARM, ITEM.EMBER_HEART,
].map((item) => ({ item, weight, min: 1, max: 1, modChance: RARE_MODS }));
const riftOrb = { item: ITEM.RIFT_ORB, weight: 3, min: 1, max: 1 };
// Loot-only gear: rope is common, the crossbow and grappling hook uncommon, and
// the Wind Axe and Ice Sword rare (less so in central, dungeon and underside loot).
const ropeBundles = { item: ITEM.ROPE_BUNDLE, weight: 8, min: 1, max: 3 };
const fishingRod = { item: ITEM.WOOD_FISHING_ROD, weight: 2, min: 1, max: 1, modChance: COMMON_MODS };
const uncommonGear = [
  { item: ITEM.CROSSBOW, weight: 3, min: 1, max: 1, modChance: IRON_MODS },
  { item: ITEM.GRAPPLING_HOOK, weight: 3, min: 1, max: 1 },
];
const rareWeapons = (weight) => [ITEM.WIND_AXE, ITEM.ICE_SWORD].map((item) => ({ item, weight, min: 1, max: 1, modChance: RARE_MODS }));
const lootGear = (rareWeight) => [ropeBundles, fishingRod, ...uncommonGear, ...rareWeapons(rareWeight)];

export const LOOT_TABLES = {
  looseChest: { rolls: [2, 3], entries: [...supplies, ...simpleGear, goldenBeef(1), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  looseChestCentral: { rolls: [4, 6], entries: [...centralSupplies, ...centralGear, ...ironGear(2), goldenBeef(2), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  // Out-of-the-way tiny islands pay for the trip: iron, iron gear, accessories.
  tinyIsland: { rolls: [4, 6], entries: [...supplies, ...usefulGear, ...ironGear(2, 0.4),
    { item: ITEM.IRON_INGOT, weight: 12, min: 2, max: 6 }, goldenBeef(3), ...accessoryEntries(5), riftOrb, ...lootGear(4)] },
  house: { rolls: [2, 4], entries: [...supplies, ...simpleGear, ...usefulGear, goldenBeef(1), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  houseCentral: { rolls: [4, 6], entries: [...centralSupplies, ...centralGear, ...ironGear(2), goldenBeef(2), ...accessoryEntries(3), riftOrb, ...lootGear(3)] },
  tower: { rolls: [3, 5], entries: [...supplies, ...simpleGear, ...usefulGear, ...ironGear(), goldenBeef(2), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  towerCentral: { rolls: [4, 7], entries: [...centralSupplies, ...centralGear, ...ironGear(3), goldenBeef(3), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  cave: { rolls: [3, 5], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(2), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  caveCentral: { rolls: [5, 7], entries: [...centralSupplies, ...centralGear, ...ironGear(3),
    { item: ITEM.IRON_INGOT, weight: 10, min: 2, max: 5 }, goldenBeef(3), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  underside: { rolls: [5, 7], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(4), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  undersideCentral: { rolls: [6, 8], entries: [...centralSupplies, ...centralGear, ...ironGear(3),
    { item: ITEM.IRON_INGOT, weight: 12, min: 2, max: 6 }, goldenBeef(4), ...accessoryEntries(6), riftOrb, ...lootGear(6)] },
  dungeon: { rolls: [4, 7], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(3), ...accessoryEntries(3), riftOrb, ...lootGear(3)] },
  // The nest chest at a dragon roost: iron gear, accessories, Golden Beef and
  // Rift Orbs, modded more often than anywhere else.
  roost: { rolls: [5, 8], entries: [...supplies.map((entry) => ({ ...entry, weight: entry.weight / 3 })),
    ...ironGear(4, 0.6), ...accessoryEntries(5).map((entry) => ({ ...entry, modChance: 0.7 })),
    goldenBeef(6), { ...riftOrb, weight: 6, max: 2 }, ...rareWeapons(3).map((entry) => ({ ...entry, modChance: 0.7 })),
    { ...uncommonGear[0], modChance: 0.6 }] },
  dungeonCentral: { rolls: [6, 9], entries: [...centralSupplies, ...centralGear, ...ironGear(3),
    { item: ITEM.IRON_INGOT, weight: 12, min: 2, max: 6 }, goldenBeef(5), ...accessoryEntries(6), riftOrb, ...lootGear(6)] },
  // Fishing loot crates (opened from the inventory, Game.stepCrate): a
  // modest mix like a loose chest's; the iron-bound crate (tier 2 fishing)
  // is richer, near a central tower's. Fishing rods inside often carry a
  // modifier.
  lootCrate: { rolls: [2, 3], entries: [
    { item: ITEM.GOLD_COIN, weight: 10, min: 2, max: 5 }, { item: ITEM.IRON_INGOT, weight: 7, min: 1, max: 2 },
    { item: ITEM.COPPER_INGOT, weight: 8, min: 2, max: 4 }, { item: ITEM.TIN_INGOT, weight: 6, min: 1, max: 2 },
    { item: ITEM.WHEAT_SEEDS, weight: 6, min: 2, max: 5 }, { item: ITEM.SULFUR_SEEDS, weight: 5, min: 1, max: 3 },
    { item: ITEM.LEATHER, weight: 6, min: 1, max: 3 }, { item: ITEM.SILK, weight: 5, min: 1, max: 3 },
    ropeBundles, goldenBeef(1.5), { item: ITEM.WOOD_FISHING_ROD, weight: 2, min: 1, max: 1, modChance: 0.6 },
    ...usefulGear.slice(0, 2), ...accessoryEntries(0.5)] },
  ironboundCrate: { rolls: [3, 4], entries: [
    { item: ITEM.GOLD_COIN, weight: 10, min: 3, max: 7 }, { item: ITEM.IRON_INGOT, weight: 9, min: 2, max: 4 },
    { item: ITEM.BRONZE_INGOT, weight: 5, min: 1, max: 3 }, goldenBeef(3), { ...riftOrb, weight: 2 },
    { item: ITEM.WOOD_FISHING_ROD, weight: 2, min: 1, max: 1, modChance: 0.8 },
    { item: ITEM.BRONZE_FISHING_ROD, weight: 1, min: 1, max: 1, modChance: 0.8 },
    ...ironGear(1, 0.4), ...accessoryEntries(1.2), { item: ITEM.DRAGON_SCALE, weight: 0.8, min: 1, max: 2 }, ...uncommonGear] },
};

// The stacks a table gives with `random` (no chest slots): used for crates.
export function rollTable(tableName, random) {
  const table = LOOT_TABLES[tableName];
  if (!table) throw new Error(`Unknown loot table: ${tableName}`);
  const out = [];
  const rolls = table.rolls[0] + Math.floor(random() * (table.rolls[1] - table.rolls[0] + 1));
  const totalWeight = table.entries.reduce((total, entry) => total + entry.weight, 0);
  for (let i = 0; i < rolls; i++) {
    let choice = random() * totalWeight;
    const entry = table.entries.find((candidate) => (choice -= candidate.weight) < 0) ?? table.entries.at(-1);
    const stack = { item: entry.item, count: Math.min(getItemDef(entry.item).maxStack, entry.min + Math.floor(random() * (entry.max - entry.min + 1))) };
    if (entry.modChance && random() < entry.modChance) { const mods = rollMods(entry.item, random); if (mods.length) stack.mods = mods; }
    out.push(stack);
  }
  return out;
}

export function rollLoot(tableName, seed, x, y, z, slotCount = 27) {
  const table = LOOT_TABLES[tableName];
  if (!table) throw new Error(`Unknown loot table: ${tableName}`);
  const random = mulberry32(seed ^ Math.imul(x, 0x9e3779b1)
    ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35));
  const slots = new Array(slotCount).fill(null);
  const rolls = table.rolls[0] + Math.floor(random() * (table.rolls[1] - table.rolls[0] + 1));
  const totalWeight = table.entries.reduce((total, entry) => total + entry.weight, 0);
  for (let index = 0; index < Math.min(rolls, slotCount); index++) {
    let choice = random() * totalWeight;
    const entry = table.entries.find((candidate) => (choice -= candidate.weight) < 0)
      ?? table.entries.at(-1);
    const count = Math.min(getItemDef(entry.item).maxStack,
      entry.min + Math.floor(random() * (entry.max - entry.min + 1)));
    let slot = Math.floor(random() * slotCount);
    while (slots[slot]) slot = (slot + 1) % slotCount;
    slots[slot] = { item: entry.item, count };
    if (entry.modChance && random() < entry.modChance) {
      const mods = rollMods(entry.item, random);
      if (mods.length) slots[slot].mods = mods;
    }
  }
  return slots;
}
