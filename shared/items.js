// Item registry. Every block is also an item with the same id (0-255), placed
// as that block. Items that aren't blocks (tools, ladders, doors, ingots) get
// ids from 256 up (shared/itemIds.js). Like block ids, item ids must never be
// renumbered. What tools do when held is in shared/tools.js.
//
// Properties:
//   name, color   - for icons and models
//   maxStack      - largest stack in one inventory slot (tools: 1)
//   block         - block id placed with this item, or null
//   tool          - model/icon shape for tools ('hammer', 'sword', 'bow', 'windAxe',
//                   'iceSword', 'crossbow', 'grapple'), or null
//   shape         - model/icon shape for other non-block items ('ingot', 'leather', 'beef', 'rope'), or null
//   places        - for items placed by special rules: 'ladder', 'door', 'sapling' or 'rope'
//   modCategory   - which modifier pool it rolls from (shared/modifiers.js): 'melee',
//                   'ranged', 'armor', 'accessory' or 'hammer'; absent = no modifiers
//   armorPoints   - armor: damage reduction (see Game.damage); fireImmune: no dragon fire damage
//   texture       - armor: 'scales' draws the pieces with a scaled texture

import { MAX_STACK } from './config.js';
import { BLOCK, getBlockDef, ladderBlock, doorBlock } from './blocks.js';
import { ITEM } from './itemIds.js';
import { ACCESSORIES, RIFT_ORB } from './accessories.js';
import { MOB_EGGS } from './mobEggs.js';

export { ITEM };

const tools = new Map();

function defineItem(id, name, props) {
  tools.set(id, {
    id, name, maxStack: MAX_STACK, block: null, places: null, tool: null, shape: null, color: 0xff00ff, ...props,
  });
}

// Tool heads and blades are drawn in their material's color.
const IRON_COLOR = 0xd9d9de;
const MATERIALS = [
  ['wood', getBlockDef(BLOCK.PLANKS).color, ITEM.WOOD_HAMMER, ITEM.WOOD_SWORD],
  ['stone', getBlockDef(BLOCK.STONE).color, ITEM.STONE_HAMMER, ITEM.STONE_SWORD],
  ['iron', IRON_COLOR, ITEM.IRON_HAMMER, ITEM.IRON_SWORD],
];
for (const [material, color, hammer, sword] of MATERIALS) {
  defineItem(hammer, `${material} hammer`, { maxStack: 1, tool: 'hammer', color, modCategory: 'hammer' });
  defineItem(sword, `${material} sword`, { maxStack: 1, tool: 'sword', color, modCategory: 'melee' });
}
defineItem(ITEM.IRON_INGOT, 'iron ingot', { shape: 'ingot', color: IRON_COLOR });
// Hold right click to draw, release to shoot (arrows are unlimited).
defineItem(ITEM.BOW, 'bow', { maxStack: 1, tool: 'bow', color: 0x8a5a2b, modCategory: 'ranged' });
// Dropped by cows.
defineItem(ITEM.LEATHER, 'leather', { shape: 'leather', color: 0x9b5e2f });
defineItem(ITEM.BEEF, 'raw beef', { shape: 'beef', color: 0xc8484a, food: 3 });
defineItem(ITEM.COOKED_BEEF, 'cooked beef', { shape: 'beef', color: 0x8b4d35, food: 8 });
defineItem(ITEM.GOLDEN_BEEF, 'golden beef', { maxStack: 4, shape: 'beef', color: 0xe9bd3e, food: 1, instantHeal: true });
defineItem(ITEM.EMPTY_BUCKET, 'bucket', { maxStack: 1, shape: 'bucket', color: IRON_COLOR });
defineItem(ITEM.WATER_BUCKET, 'water bucket', { maxStack: 1, block: BLOCK.WATER, shape: 'bucket', color: 0x3a6fd8 });
defineItem(ITEM.LEATHER_ARMOR, 'leather armor', { maxStack: 1, shape: 'armor', color: 0x87512f, armorPoints: 3, modCategory: 'armor' });
defineItem(ITEM.IRON_ARMOR, 'iron armor', { maxStack: 1, shape: 'armor', color: IRON_COLOR, armorPoints: 8, modCategory: 'armor' });
// Crafted from Dragon Scales (dropped by dragons); shrugs off dragon fire.
defineItem(ITEM.DRAGONSCALE_ARMOR, 'dragonscale armor', {
  maxStack: 1, shape: 'armor', color: 0x3a2a30, armorPoints: 9, fireImmune: true, texture: 'scales', modCategory: 'armor',
});
defineItem(ITEM.DRAGON_SCALE, 'dragon scale', { shape: 'scale', color: 0x7a2f2c });
// Dropped by Crawlers. No use yet.
defineItem(ITEM.SILK, 'silk', { shape: 'silk', color: 0xeeeae0 });
defineItem(ITEM.GLIDER, 'glider', { maxStack: 1, shape: 'glider', color: 0x9b5e2f });
// Dropped by leaves; planted on grass or dirt, it grows into a tree.
defineItem(ITEM.TREE_SEED, 'sapling', { places: 'sapling', shape: 'seed', color: 0x65a84b });
defineItem(ITEM.LADDER, 'ladder', { places: 'ladder', color: getBlockDef(ladderBlock(0)).color });
defineItem(ITEM.DOOR, 'door', { places: 'door', color: getBlockDef(doorBlock(0, false, false)).color });
for (const [id, accessory] of Object.entries(ACCESSORIES)) {
  defineItem(Number(id), accessory.name, { maxStack: 1, shape: 'accessory', color: accessory.color,
    accessory: true, modCategory: id === String(ITEM.FLIGHT_ORB) ? null : 'accessory' });
}
for (const egg of MOB_EGGS) {
  defineItem(egg.item, `${egg.name.toLowerCase()} spawn egg`,
    { maxStack: 16, shape: 'egg', color: egg.color, spots: egg.spots, mobType: egg.type });
}
// Loot-only weapons and tools. What the weapons do in hand is in tools.js.
defineItem(ITEM.WIND_AXE, 'wind axe', { maxStack: 1, tool: 'windAxe', color: 0xbfe9ef, modCategory: 'melee' });
defineItem(ITEM.ICE_SWORD, 'ice sword', { maxStack: 1, tool: 'iceSword', color: 0x9fdcf5, modCategory: 'melee' });
// Hold right click to load, then click to fire (bolts are unlimited).
defineItem(ITEM.CROSSBOW, 'crossbow', { maxStack: 1, tool: 'crossbow', color: 0x6e4a2a, modCategory: 'ranged' });
// Right click a block face to hang a column of rope down from there.
defineItem(ITEM.ROPE_BUNDLE, 'rope bundle', { maxStack: 8, places: 'rope', shape: 'rope', color: getBlockDef(BLOCK.ROPE).color });
// Right click to fire; pulls you to the block it hits.
defineItem(ITEM.GRAPPLING_HOOK, 'grappling hook', { maxStack: 1, tool: 'grapple', color: 0x8d9299 });
defineItem(ITEM.RIFT_ORB, 'rift orb', { maxStack: RIFT_ORB.maxStack, shape: 'rift', color: 0xa66aff });

const blockItems = new Map();

export function getItemDef(id) {
  if (tools.has(id)) return tools.get(id);
  let def = blockItems.get(id);
  if (!def) {
    const block = getBlockDef(id);
    def = {
      id, name: block.name, maxStack: MAX_STACK, block: block.id, places: null, tool: null, shape: null, color: block.color,
    };
    blockItems.set(id, def);
  }
  return def;
}
