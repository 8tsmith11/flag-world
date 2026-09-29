// Crafting and smelting, as data.
//
// A crafting recipe makes `count` of `output` from `inputs` ([{ item, count }])
// taken from the player's inventory. `station` is null (craftable anywhere:
// the inventory screen or a workbench) or 'workbench' (only at a workbench).
// `id` is what the client sends to craft it.

import { LIGHTING, METALS, FLUID } from './config.js';
import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { creativeItemIds } from './items.js';

const needs = (...pairs) => pairs.map(([item, count]) => ({ item, count }));

export const RECIPES = [
  { id: 'torch', station: null, output: BLOCK.TORCH, count: LIGHTING.torchCraftCount, inputs: needs([BLOCK.PLANKS, LIGHTING.torchCraftPlanks]) },
  { id: 'planks', station: null, output: BLOCK.PLANKS, count: 4, inputs: needs([BLOCK.WOOD, 1]) },
  { id: 'stone_bricks', station: null, output: BLOCK.STONE_BRICKS, count: 1, inputs: needs([BLOCK.STONE, 1]) },
  { id: 'ladder', station: null, output: ITEM.LADDER, count: 2, inputs: needs([BLOCK.PLANKS, 1]) },
  { id: 'workbench', station: null, output: BLOCK.WORKBENCH, count: 1, inputs: needs([BLOCK.PLANKS, 4]) },
  { id: 'wood_hammer', station: 'workbench', output: ITEM.WOOD_HAMMER, count: 1, inputs: needs([BLOCK.PLANKS, 3], [BLOCK.WOOD, 2]) },
  { id: 'stone_hammer', station: 'workbench', output: ITEM.STONE_HAMMER, count: 1, inputs: needs([BLOCK.STONE, 3], [BLOCK.WOOD, 2]) },
  { id: 'iron_hammer', station: 'workbench', output: ITEM.IRON_HAMMER, count: 1, inputs: needs([ITEM.IRON_INGOT, 3], [BLOCK.WOOD, 2]) },
  { id: 'bronze_hammer', station: 'workbench', output: ITEM.BRONZE_HAMMER, count: 1,
    inputs: needs([ITEM.BRONZE_INGOT, METALS.crafting.bronzeHammerIngots], [BLOCK.WOOD, METALS.crafting.bronzeHammerWood]) },
  { id: 'door', station: 'workbench', output: ITEM.DOOR, count: 1, inputs: needs([BLOCK.PLANKS, 6]) },
  { id: 'reinforced_door', station: 'workbench', output: ITEM.REINFORCED_DOOR, count: 1,
    inputs: needs([ITEM.IRON_INGOT, 6]) },
  { id: 'arrow_turret', station: 'workbench', output: BLOCK.ARROW_TURRET, count: 1,
    inputs: needs([ITEM.IRON_INGOT, 4], [BLOCK.PLANKS, 4]) },
  { id: 'furnace', station: 'workbench', output: BLOCK.FURNACE, count: 1, inputs: needs([BLOCK.STONE, 8]) },
  { id: 'alloy_furnace', station: 'workbench', output: BLOCK.ALLOY_FURNACE, count: 1,
    inputs: needs([BLOCK.FURNACE, 1], [ITEM.COPPER_INGOT, METALS.crafting.alloyFurnaceCopper]) },
  { id: 'bronze_pipe', station: 'workbench', output: BLOCK.BRONZE_PIPE, count: FLUID.craft.pipeCount,
    inputs: needs([ITEM.BRONZE_INGOT, FLUID.craft.pipeBronze]) },
  { id: 'fluid_tank', station: 'workbench', output: BLOCK.FLUID_TANK, count: FLUID.craft.machineCount,
    inputs: needs([ITEM.BRONZE_INGOT, FLUID.craft.tankBronze], [BLOCK.GLASS, FLUID.craft.tankGlass]) },
  { id: 'water_pump', station: 'workbench', output: BLOCK.WATER_PUMP, count: FLUID.craft.machineCount,
    inputs: needs([ITEM.BRONZE_INGOT, FLUID.craft.pumpBronze], [BLOCK.BRONZE_PIPE, FLUID.craft.pumpPipes]) },
  { id: 'boiler', station: 'workbench', output: BLOCK.BOILER, count: FLUID.craft.machineCount,
    inputs: needs([BLOCK.FURNACE, FLUID.craft.boilerFurnaces], [ITEM.BRONZE_INGOT, FLUID.craft.boilerBronze]) },
  { id: 'crusher', station: 'workbench', output: BLOCK.CRUSHER, count: FLUID.craft.machineCount,
    inputs: needs([ITEM.BRONZE_INGOT, FLUID.craft.crusherBronze], [BLOCK.STONE, FLUID.craft.crusherStone],
      [BLOCK.BRONZE_PIPE, FLUID.craft.crusherPipes]) },
  { id: 'chest', station: 'workbench', output: BLOCK.CHEST, count: 1, inputs: needs([BLOCK.PLANKS, 8]) },
  { id: 'wood_sword', station: 'workbench', output: ITEM.WOOD_SWORD, count: 1, inputs: needs([BLOCK.PLANKS, 2], [BLOCK.WOOD, 1]) },
  { id: 'stone_sword', station: 'workbench', output: ITEM.STONE_SWORD, count: 1, inputs: needs([BLOCK.STONE, 2], [BLOCK.WOOD, 1]) },
  { id: 'bow', station: 'workbench', output: ITEM.BOW, count: 1, inputs: needs([BLOCK.PLANKS, 3], [BLOCK.WOOD, 2]) },
  { id: 'iron_sword', station: 'workbench', output: ITEM.IRON_SWORD, count: 1, inputs: needs([ITEM.IRON_INGOT, 2], [BLOCK.WOOD, 1]) },
  { id: 'bucket', station: 'workbench', output: ITEM.EMPTY_BUCKET, count: 1, inputs: needs([ITEM.COPPER_INGOT, METALS.crafting.bucketCopper]) },
  { id: 'leather_armor', station: 'workbench', output: ITEM.LEATHER_ARMOR, count: 1, inputs: needs([ITEM.LEATHER, 3]) },
  { id: 'iron_armor', station: 'workbench', output: ITEM.IRON_ARMOR, count: 1, inputs: needs([ITEM.IRON_INGOT, 10]) },
  { id: 'bronze_armor', station: 'workbench', output: ITEM.BRONZE_ARMOR, count: 1, inputs: needs([ITEM.BRONZE_INGOT, METALS.crafting.bronzeArmorIngots]) },
  { id: 'anvil', station: 'workbench', output: BLOCK.ANVIL, count: 1, inputs: needs([ITEM.IRON_INGOT, 6]) },
  { id: 'dragonscale_armor', station: 'workbench', output: ITEM.DRAGONSCALE_ARMOR, count: 1, inputs: needs([ITEM.DRAGON_SCALE, 8]) },
  { id: 'glider', station: 'workbench', output: ITEM.GLIDER, count: 1, inputs: needs([ITEM.LEATHER, 3], [BLOCK.WOOD, 2]) },
];

// Server checks creative permission before accepting these ids. The client
// shows the full catalogue without requiring or consuming any ingredients.
export const CREATIVE_RECIPES = creativeItemIds()
  .map((item) => ({ id: `creative:${item}`, creative: true, station: null,
    output: item, count: 1, inputs: [] }));
const creativeById = new Map(CREATIVE_RECIPES.map((recipe) => [recipe.id, recipe]));

// Rerolling an item's modifiers at an anvil costs this, from the inventory.
export const ANVIL_REROLL_COST = needs([ITEM.IRON_INGOT, 2]);

// Furnace: what each input smelts into, and how many items one fuel item
// smelts. Smelting one item takes SMELT_TIME (shared/config.js).
export const SMELTING = {
  [BLOCK.WOOD]: ITEM.CHARCOAL,
  [BLOCK.SAND]: BLOCK.GLASS,
  [BLOCK.IRON_ORE]: ITEM.IRON_INGOT,
  [BLOCK.COPPER_ORE]: ITEM.COPPER_INGOT,
  [BLOCK.TIN_ORE]: ITEM.TIN_INGOT,
  [ITEM.IRON_DUST]: ITEM.IRON_INGOT,
  [ITEM.COPPER_DUST]: ITEM.COPPER_INGOT,
  [ITEM.TIN_DUST]: ITEM.TIN_INGOT,
  [ITEM.BEEF]: ITEM.COOKED_BEEF,
};

export const CRUSHING = {
  [BLOCK.STONE]: { item: BLOCK.SAND, count: FLUID.crusherStoneOutput },
  [BLOCK.IRON_ORE]: { item: ITEM.IRON_DUST, count: FLUID.crusherOreDust },
  [BLOCK.COPPER_ORE]: { item: ITEM.COPPER_DUST, count: FLUID.crusherOreDust },
  [BLOCK.TIN_ORE]: { item: ITEM.TIN_DUST, count: FLUID.crusherOreDust },
};

export const FUEL = {
  [ITEM.CHARCOAL]: 8,
  [BLOCK.WOOD]: 2,
  [BLOCK.PLANKS]: 1,
};

export function getRecipe(id) {
  return RECIPES.find((r) => r.id === id) ?? creativeById.get(id) ?? null;
}

// Recipes usable at a station (null = just the inventory screen).
export function recipesAt(station, creative = false) {
  return creative ? CREATIVE_RECIPES : RECIPES.filter((r) => r.station === null || r.station === station);
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
