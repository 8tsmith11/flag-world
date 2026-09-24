import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { getItemDef } from './items.js';
import { mulberry32 } from './structures.js';

const supplies = [
  { item: BLOCK.PLANKS, weight: 22, min: 3, max: 10 },
  { item: BLOCK.STONE, weight: 19, min: 4, max: 12 },
  { item: BLOCK.SAND, weight: 11, min: 3, max: 9 },
  { item: BLOCK.IRON_ORE, weight: 9, min: 2, max: 6 },
  { item: ITEM.LEATHER, weight: 10, min: 1, max: 4 },
  { item: ITEM.BEEF, weight: 10, min: 1, max: 3 },
];
const simpleGear = [
  { item: ITEM.WOOD_SWORD, weight: 5, min: 1, max: 1 },
  { item: ITEM.WOOD_HAMMER, weight: 5, min: 1, max: 1 },
  { item: ITEM.BOW, weight: 3, min: 1, max: 1 },
];
const usefulGear = [
  { item: ITEM.STONE_SWORD, weight: 5, min: 1, max: 1 },
  { item: ITEM.STONE_HAMMER, weight: 5, min: 1, max: 1 },
  { item: ITEM.LEATHER_ARMOR, weight: 3, min: 1, max: 1 },
  { item: ITEM.IRON_INGOT, weight: 7, min: 1, max: 4 },
];
const ironGear = [
  { item: ITEM.IRON_SWORD, weight: 2, min: 1, max: 1 },
  { item: ITEM.IRON_HAMMER, weight: 2, min: 1, max: 1 },
  { item: ITEM.IRON_ARMOR, weight: 1, min: 1, max: 1 },
];
const goldenBeef = (weight) => ({ item: ITEM.GOLDEN_BEEF, weight, min: 1, max: 1 });
const accessoryEntries = (weight) => [
  ITEM.WIND_BOOTS, ITEM.SPRING_BOOTS, ITEM.HEART_AMULET,
  ITEM.MENDING_CHARM, ITEM.EMBER_HEART,
].map((item) => ({ item, weight, min: 1, max: 1 }));
const riftStone = { item: ITEM.RIFT_STONE, weight: 3, min: 1, max: 1 };

export const LOOT_TABLES = {
  looseChest: { rolls: [2, 4], entries: [...supplies, ...simpleGear, goldenBeef(1), ...accessoryEntries(1), riftStone] },
  looseChestCentral: { rolls: [3, 5], entries: [...supplies, ...simpleGear, ...usefulGear, goldenBeef(2), ...accessoryEntries(3), riftStone] },
  tinyIsland: { rolls: [2, 4], entries: [...supplies, ...simpleGear, goldenBeef(1), ...accessoryEntries(4), riftStone] },
  house: { rolls: [3, 5], entries: [...supplies, ...simpleGear, ...usefulGear, goldenBeef(1), ...accessoryEntries(1), riftStone] },
  tower: { rolls: [3, 6], entries: [...supplies, ...simpleGear, ...usefulGear, ...ironGear, goldenBeef(2), ...accessoryEntries(1), riftStone] },
  cave: { rolls: [4, 6], entries: [...supplies, ...usefulGear, ...ironGear, goldenBeef(2), ...accessoryEntries(1), riftStone] },
  caveCentral: { rolls: [5, 7], entries: [...supplies, ...usefulGear, ...ironGear, goldenBeef(3), ...accessoryEntries(3), riftStone] },
  underside: { rolls: [5, 7], entries: [...supplies, ...usefulGear, ...ironGear, goldenBeef(4), ...accessoryEntries(4), riftStone] },
  dungeon: { rolls: [5, 8], entries: [...supplies, ...usefulGear, ...ironGear, goldenBeef(4), ...accessoryEntries(4), riftStone] },
  dungeonCentral: { rolls: [6, 8], entries: [...supplies, ...usefulGear, ...ironGear, goldenBeef(5), ...accessoryEntries(5), riftStone] },
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
  }
  return slots;
}
