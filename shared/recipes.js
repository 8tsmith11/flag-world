// Crafting and smelting, as data.
//
// A crafting recipe makes `count` of `output` from `inputs` ([{ item, count }])
// taken from the player's inventory. `station` is null (craftable anywhere:
// the inventory screen or a workbench) or 'workbench' (only at a workbench).
// `id` is what the client sends to craft it.

import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';

const needs = (...pairs) => pairs.map(([item, count]) => ({ item, count }));

export const RECIPES = [
  { id: 'planks', station: null, output: BLOCK.PLANKS, count: 4, inputs: needs([BLOCK.WOOD, 1]) },
  { id: 'ladder', station: null, output: ITEM.LADDER, count: 2, inputs: needs([BLOCK.PLANKS, 1]) },
  { id: 'workbench', station: null, output: BLOCK.WORKBENCH, count: 1, inputs: needs([BLOCK.PLANKS, 4]) },
  { id: 'wood_hammer', station: 'workbench', output: ITEM.WOOD_HAMMER, count: 1, inputs: needs([BLOCK.PLANKS, 3], [BLOCK.WOOD, 2]) },
  { id: 'stone_hammer', station: 'workbench', output: ITEM.STONE_HAMMER, count: 1, inputs: needs([BLOCK.STONE, 3], [BLOCK.WOOD, 2]) },
  { id: 'iron_hammer', station: 'workbench', output: ITEM.IRON_HAMMER, count: 1, inputs: needs([ITEM.IRON_INGOT, 3], [BLOCK.WOOD, 2]) },
  { id: 'door', station: 'workbench', output: ITEM.DOOR, count: 1, inputs: needs([BLOCK.PLANKS, 6]) },
  { id: 'furnace', station: 'workbench', output: BLOCK.FURNACE, count: 1, inputs: needs([BLOCK.STONE, 8]) },
  { id: 'wood_sword', station: 'workbench', output: ITEM.WOOD_SWORD, count: 1, inputs: needs([BLOCK.PLANKS, 2], [BLOCK.WOOD, 1]) },
  { id: 'stone_sword', station: 'workbench', output: ITEM.STONE_SWORD, count: 1, inputs: needs([BLOCK.STONE, 2], [BLOCK.WOOD, 1]) },
  { id: 'iron_sword', station: 'workbench', output: ITEM.IRON_SWORD, count: 1, inputs: needs([ITEM.IRON_INGOT, 2], [BLOCK.WOOD, 1]) },
];

// Furnace: what each input smelts into, and how many items one fuel item
// smelts. Smelting one item takes SMELT_TIME (shared/config.js).
export const SMELTING = {
  [BLOCK.IRON_ORE]: ITEM.IRON_INGOT,
};

export const FUEL = {
  [BLOCK.WOOD]: 2,
  [BLOCK.PLANKS]: 1,
};

export function getRecipe(id) {
  return RECIPES.find((r) => r.id === id) ?? null;
}

// Recipes usable at a station (null = just the inventory screen).
export function recipesAt(station) {
  return RECIPES.filter((r) => r.station === null || r.station === station);
}

// Total count of each item across inventory slots (null = empty).
export function countItems(slots) {
  const counts = new Map();
  for (const stack of slots) {
    if (stack) counts.set(stack.item, (counts.get(stack.item) ?? 0) + stack.count);
  }
  return counts;
}

export function canAfford(recipe, slots) {
  const counts = countItems(slots);
  return recipe.inputs.every(({ item, count }) => (counts.get(item) ?? 0) >= count);
}
