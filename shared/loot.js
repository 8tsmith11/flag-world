import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { getItemDef } from './items.js';
import { mulberry32 } from './structures.js';
import { rollMods } from './modifiers.js';

// Entries: { item, weight, min, max, modChance? }. modChance is the chance a
// moddable item rolls with modifiers (1 or 2, shared/modifiers.js).
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
const goldenBeef = (weight) => ({ item: ITEM.GOLDEN_BEEF, weight, min: 1, max: 1 });
const accessoryEntries = (weight) => [
  ITEM.WIND_BOOTS, ITEM.SPRING_BOOTS, ITEM.HEART_AMULET,
  ITEM.MENDING_CHARM, ITEM.EMBER_HEART,
].map((item) => ({ item, weight, min: 1, max: 1, modChance: RARE_MODS }));
const riftOrb = { item: ITEM.RIFT_ORB, weight: 3, min: 1, max: 1 };
// Loot-only gear: rope is common, the crossbow and grappling hook uncommon, and
// the Wind Axe and Ice Sword rare (less so in central, dungeon and underside loot).
const ropeBundles = { item: ITEM.ROPE_BUNDLE, weight: 8, min: 1, max: 3 };
const uncommonGear = [
  { item: ITEM.CROSSBOW, weight: 3, min: 1, max: 1, modChance: IRON_MODS },
  { item: ITEM.GRAPPLING_HOOK, weight: 3, min: 1, max: 1 },
];
const rareWeapons = (weight) => [ITEM.WIND_AXE, ITEM.ICE_SWORD].map((item) => ({ item, weight, min: 1, max: 1, modChance: RARE_MODS }));
const lootGear = (rareWeight) => [ropeBundles, ...uncommonGear, ...rareWeapons(rareWeight)];

export const LOOT_TABLES = {
  looseChest: { rolls: [2, 4], entries: [...supplies, ...simpleGear, goldenBeef(1), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  looseChestCentral: { rolls: [3, 5], entries: [...supplies, ...simpleGear, ...usefulGear, goldenBeef(2), ...accessoryEntries(3), riftOrb, ...lootGear(3)] },
  tinyIsland: { rolls: [2, 4], entries: [...supplies, ...simpleGear, goldenBeef(1), ...accessoryEntries(4), riftOrb, ...lootGear(1)] },
  house: { rolls: [3, 5], entries: [...supplies, ...simpleGear, ...usefulGear, goldenBeef(1), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  tower: { rolls: [3, 6], entries: [...supplies, ...simpleGear, ...usefulGear, ...ironGear(), goldenBeef(2), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  cave: { rolls: [4, 6], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(2), ...accessoryEntries(1), riftOrb, ...lootGear(1)] },
  caveCentral: { rolls: [5, 7], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(3), ...accessoryEntries(3), riftOrb, ...lootGear(3)] },
  underside: { rolls: [5, 7], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(4), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  dungeon: { rolls: [5, 8], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(4), ...accessoryEntries(4), riftOrb, ...lootGear(4)] },
  // The nest chest at a dragon roost: iron gear, accessories, Golden Beef and
  // Rift Orbs, modded more often than anywhere else.
  roost: { rolls: [5, 8], entries: [...supplies.map((entry) => ({ ...entry, weight: entry.weight / 3 })),
    ...ironGear(4, 0.6), ...accessoryEntries(5).map((entry) => ({ ...entry, modChance: 0.7 })),
    goldenBeef(6), { ...riftOrb, weight: 6, max: 2 }, ...rareWeapons(3).map((entry) => ({ ...entry, modChance: 0.7 })),
    { ...uncommonGear[0], modChance: 0.6 }] },
  dungeonCentral: { rolls: [6, 8], entries: [...supplies, ...usefulGear, ...ironGear(), goldenBeef(5), ...accessoryEntries(5), riftOrb, ...lootGear(5)] },
  // The Goblin Totem's pile when it's destroyed: lots of iron, Golden Beef,
  // accessories and Rift Orbs, modded most of the time.
  goblinTotem: { rolls: [16, 22], entries: [
    { item: ITEM.IRON_INGOT, weight: 14, min: 3, max: 8 },
    { item: BLOCK.IRON_ORE, weight: 6, min: 4, max: 10 },
    ...ironGear(3, 0.75), goldenBeef(8),
    ...accessoryEntries(4).map((entry) => ({ ...entry, modChance: 0.8 })),
    { ...riftOrb, weight: 6, max: 2 },
    ...rareWeapons(2).map((entry) => ({ ...entry, modChance: 0.8 })),
    { ...uncommonGear[0], modChance: 0.75 }] },
  // The Goblin King's drop.
  goblinKing: { rolls: [4, 6], entries: [
    { item: ITEM.IRON_INGOT, weight: 10, min: 2, max: 5 },
    ...ironGear(3, 0.6), goldenBeef(5),
    ...accessoryEntries(2).map((entry) => ({ ...entry, modChance: 0.6 })),
    { ...riftOrb, weight: 3 }] },
};

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
