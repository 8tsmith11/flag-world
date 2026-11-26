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

import { MAX_STACK, METALS, ELEMENTAL, EXPLOSIVES } from './config.js';
import { BLOCK, getBlockDef, registeredBlockIds, ladderBlock, doorBlock, blockBase, isLadder, isDoor, doorState, isWater, isLava, isCrop } from './blocks.js';
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
const COPPER_COLOR = 0xb87342, TIN_COLOR = 0xb7c6cc, BRONZE_COLOR = 0xb8793e;
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
defineItem(ITEM.COPPER_INGOT, 'copper ingot', { shape: 'ingot', color: COPPER_COLOR });
defineItem(ITEM.TIN_INGOT, 'tin ingot', { shape: 'ingot', color: TIN_COLOR });
defineItem(ITEM.BRONZE_INGOT, 'bronze ingot', { shape: 'ingot', color: BRONZE_COLOR });
defineItem(ITEM.IRON_DUST, 'iron dust', { shape: 'dust', color: IRON_COLOR });
defineItem(ITEM.COPPER_DUST, 'copper dust', { shape: 'dust', color: COPPER_COLOR });
defineItem(ITEM.TIN_DUST, 'tin dust', { shape: 'dust', color: TIN_COLOR });
defineItem(ITEM.BRONZE_HAMMER, 'bronze hammer', { maxStack: 1, tool: 'hammer', color: BRONZE_COLOR, modCategory: 'hammer' });
defineItem(ITEM.BRONZE_SWORD, 'bronze sword', { maxStack: 1, tool: 'sword', color: BRONZE_COLOR, modCategory: 'melee' });
defineItem(ITEM.CHARCOAL, 'charcoal', { color: 0x292b30, icon: '/textures/charcoal.svg' });
// Hold right click to draw, release to shoot (arrows are unlimited).
defineItem(ITEM.BOW, 'bow', { maxStack: 1, tool: 'bow', color: 0x8a5a2b, modCategory: 'ranged' });
// Dropped by cows.
defineItem(ITEM.LEATHER, 'leather', { shape: 'leather', color: 0x9b5e2f });
defineItem(ITEM.BEEF, 'raw beef', { shape: 'beef', color: 0xc8484a, food: 3 });
defineItem(ITEM.COOKED_BEEF, 'cooked beef', { shape: 'beef', color: 0x8b4d35, food: 8 });
defineItem(ITEM.GOLDEN_BEEF, 'golden beef', { maxStack: 4, shape: 'beef', color: 0xe9bd3e, food: 1, instantHeal: true });
defineItem(ITEM.EMPTY_BUCKET, 'bucket', { maxStack: 1, shape: 'bucket', color: IRON_COLOR });
defineItem(ITEM.WATER_BUCKET, 'water bucket', { maxStack: 1, block: BLOCK.WATER, shape: 'bucket', color: 0x3a6fd8 });
defineItem(ITEM.LAVA_BUCKET, 'lava bucket', { maxStack: 1, block: BLOCK.LAVA, shape: 'bucket', color: ELEMENTAL.colors.lava });
defineItem(ITEM.LEATHER_ARMOR, 'leather armor', { maxStack: 1, shape: 'armor', color: 0x87512f, armorPoints: 3, modCategory: 'armor' });
defineItem(ITEM.IRON_ARMOR, 'iron armor', { maxStack: 1, shape: 'armor', color: IRON_COLOR, armorPoints: 8, modCategory: 'armor' });
defineItem(ITEM.BRONZE_ARMOR, 'bronze armor', { maxStack: 1, shape: 'armor', color: BRONZE_COLOR,
  armorPoints: METALS.bronzeArmorPoints, texture: 'bronze', modCategory: 'armor' });
// Crafted from Dragon Scales (dropped by dragons); shrugs off dragon fire.
defineItem(ITEM.DRAGONSCALE_ARMOR, 'dragonscale armor', {
  maxStack: 1, shape: 'armor', color: 0x3a2a30, armorPoints: 9, fireImmune: true, texture: 'scales', modCategory: 'armor',
});
defineItem(ITEM.DRAGON_SCALE, 'dragon scale', { shape: 'scale', color: 0x7a2f2c });
defineItem(ITEM.DRAGON_HEART, 'dragon heart', { maxStack: 1, shape: 'heart', color: 0xe64b26 });
// Dropped by Crawlers. No use yet.
defineItem(ITEM.SILK, 'silk', { shape: 'silk', color: 0xeeeae0 });
defineItem(ITEM.GLIDER, 'glider', { maxStack: 1, shape: 'glider', color: 0x9b5e2f });
// Dropped by leaves; planted on grass or dirt, it grows into a tree.
defineItem(ITEM.TREE_SEED, 'sapling', { places: 'sapling', shape: 'seed', color: 0x65a84b });
defineItem(ITEM.LADDER, 'ladder', { places: 'ladder', color: getBlockDef(ladderBlock(0)).color });
defineItem(ITEM.DOOR, 'door', { places: 'door', color: getBlockDef(doorBlock(0, false, false)).color });
defineItem(ITEM.REINFORCED_DOOR, 'reinforced door', {
  places: 'reinforcedDoor', color: getBlockDef(doorBlock(0, false, false, true)).color,
});
for (const [id, accessory] of Object.entries(ACCESSORIES)) {
  defineItem(Number(id), accessory.name, { maxStack: 1, shape: 'accessory', color: accessory.color,
    accessory: true, modCategory: 'accessory' });
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
// Farming. Hoes till grass or dirt into farmland (right click); seeds plant on farmland.
const HOES = [[ITEM.WOOD_HOE, 'wood', getBlockDef(BLOCK.PLANKS).color], [ITEM.STONE_HOE, 'stone', getBlockDef(BLOCK.STONE).color],
  [ITEM.IRON_HOE, 'iron', IRON_COLOR]];
for (const [id, material, color] of HOES) defineItem(id, `${material} hoe`, { maxStack: 1, tool: 'hoe', color, icon: `/textures/${material}-hoe.svg` });
defineItem(ITEM.WHEAT_SEEDS, 'wheat seeds', { places: 'crop', crop: 'wheat', color: 0xc9b163, icon: '/textures/wheat-seeds.svg' });
defineItem(ITEM.WHEAT, 'wheat', { color: 0xd8b44a, icon: '/textures/wheat.svg' });
defineItem(ITEM.BREAD, 'bread', { color: 0xb5793a, icon: '/textures/bread.svg', food: 5 });
// The Sky Merchant's currency (shared/merchant.js).
defineItem(ITEM.GOLD_COIN, 'gold coin', { color: 0xf2c230, icon: '/textures/gold-coin.svg' });
// Hold right click to look through it (zoom, farther sight, enemy names).
// In a Lookout monkey's tool slot it extends its sight and names what it sees.
defineItem(ITEM.SPYGLASS, 'spyglass', { maxStack: 1, tool: 'spyglass', color: 0xb8793e, icon: '/textures/spyglass.svg' });
defineItem(ITEM.RIFT_ORB, 'rift orb', { maxStack: RIFT_ORB.maxStack, shape: 'rift', color: 0xa66aff });
// Explosives. Sulfur seeds plant on farmland like wheat seeds (the crop never
// grows wild); sulfur and charcoal make gunpowder; grenades are thrown.
defineItem(ITEM.SULFUR_SEEDS, 'sulfur seeds', { places: 'crop', crop: 'sulfur', color: 0xd9c22a, icon: '/textures/sulfur-seeds.svg' });
defineItem(ITEM.SULFUR, 'sulfur', { color: 0xf0d81e, icon: '/textures/sulfur.svg' });
defineItem(ITEM.GUNPOWDER, 'gunpowder', { color: 0x3b3a38, icon: '/textures/gunpowder.svg' });
defineItem(ITEM.GRENADE, 'grenade', { maxStack: EXPLOSIVES.grenade.maxStack, throwable: true, color: 0x4b5a3a,
  icon: '/textures/grenade.svg' });

// Extra tooltip lines (how to use it) for items that need explaining.
export const ITEM_TIPS = {
  [ITEM.GOLD_COIN]: ['Currency of the Sky Merchant', 'Earn it by selling goods to him or through your Merchant Depot'],
  [ITEM.SPYGLASS]: ['Hold right click to look through it: zoom, see farther, read enemy names',
    'You cannot attack while looking through it', 'Try giving this to a Lookout monkey!'],
  [BLOCK.MERCHANT_DEPOT]: ['Where the Sky Merchant\'s airship docks each morning (one per team)',
    'Place it on your island\'s far edge, the side facing away from the center island',
    'Leave open sky in front of it: the airship flies in from the far side and docks there',
    'Put goods in its selling slots to sell them automatically while he is docked'],
  [BLOCK.REINFORCED_WALL]: ['Stone bricks bound with iron', 'Needs an iron hammer; takes four times as long to break as stone bricks',
    'Twice as blast resistant as stone bricks'],
  [ITEM.SULFUR_SEEDS]: ['Plant on farmland (till grass or dirt with a hoe)', 'Grows into a yellow sulfur plant; harvest it for sulfur and more seeds',
    'Farmer monkeys plant and harvest it too'],
  [ITEM.SULFUR]: ['Grown from sulfur plants', 'With charcoal, makes gunpowder'],
  [ITEM.GUNPOWDER]: ['Made from sulfur and charcoal', 'Goes into grenades and explosive barrels'],
  [ITEM.GRENADE]: ['Right click to throw; it bounces and goes off after a few seconds',
    'Hurts creatures and players nearby; breaks only soft blocks', 'Never damages spike barricades'],
  [BLOCK.EXPLOSIVE_BARREL]: ['Right click a placed barrel to light its fuse', 'Blows apart even stone; nearby explosions light it too',
    'An unlit barrel can be picked back up by breaking it'],
  [BLOCK.SPIKE_BARRICADE]: ['Hurts and throws back enemies and hostile creatures that touch it',
    'Enemies breaking it by hand get hurt; explosions and arrows wear it down', 'Never hurts your own team or monkeys'],
  [BLOCK.DRAWBRIDGE]: ['Steam-powered: pipe steam from a boiler into it', 'Right click to set direction and length, add planks, and extend or retract',
    'Place it at the edge of a platform'],
};

const blockItems = new Map();

export function getItemDef(id) {
  if (tools.has(id)) return tools.get(id);
  let def = blockItems.get(id);
  if (!def) {
    const block = getBlockDef(id);
    def = {
      id, name: block.name, maxStack: MAX_STACK, block: block.id, places: block.shape === 'torch' ? 'torch' : null, tool: null, shape: null, color: block.color, icon: block.icon,
    };
    blockItems.set(id, def);
  }
  return def;
}

export function registeredItemIds() { return [...registeredBlockIds(), ...tools.keys()]; }

// Encoded orientations, door halves/open states and flowing water are runtime
// blocks, not separate choices in the creative inventory.
export function creativeItemIds() {
  const ids = registeredItemIds().map(id => {
    if (id === BLOCK.AIR) return null;
    if (id === BLOCK.SAPLING) return ITEM.TREE_SEED;
    if (isLadder(id)) return ITEM.LADDER;
    if (isDoor(id)) return doorState(id).reinforced ? ITEM.REINFORCED_DOOR : ITEM.DOOR;
    if (isWater(id)) return BLOCK.WATER;
    if (isLava(id)) return BLOCK.LAVA;
    if (id === BLOCK.FIRE_PORTAL || id === BLOCK.BRANCH) return null;
    if (isCrop(id)) return null;
    return id < 256 ? blockBase(id).base : id;
  });
  return [...new Set(ids.filter(id => id !== null))];
}
