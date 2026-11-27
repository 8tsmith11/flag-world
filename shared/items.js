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
// Crafted from Dragon Scales (dropped by dragons); shrugs off dragon fire
// (not their swoops, bites or tail whips).
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
// Farming. The wood hoe tills grass or dirt into farmland (right click);
// seeds plant on farmland. (There is only the one hoe.)
defineItem(ITEM.WOOD_HOE, 'wood hoe', { maxStack: 1, tool: 'hoe', color: getBlockDef(BLOCK.PLANKS).color, icon: '/textures/wood-hoe.svg' });
// Item ids that no longer exist, and what saves turn them into.
export const RETIRED_ITEMS = { 327: ITEM.WOOD_HOE, 328: ITEM.WOOD_HOE };
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
// Right click something ignitable (a block whose def has `ignite`) to light
// it. Reusable: no durability, no fuel.
defineItem(ITEM.LIGHTER, 'lighter', { maxStack: 1, tool: 'lighter', color: 0x9aa0a7, icon: '/textures/lighter.svg' });
// Fishing (shared/fishing.js): rods are tools with fishing attributes and
// rod modifiers; crates open into loot (the table named by `crate`).
defineItem(ITEM.WOOD_FISHING_ROD, 'wooden fishing rod', { maxStack: 1, tool: 'rod', color: 0x8a5a2b, modCategory: 'rod',
  icon: '/textures/wood-fishing-rod.svg' });
defineItem(ITEM.BRONZE_FISHING_ROD, 'bronze fishing rod', { maxStack: 1, tool: 'rod', color: 0xc08a3e, modCategory: 'rod',
  icon: '/textures/bronze-fishing-rod.svg' });
defineItem(ITEM.FISH, 'fish', { color: 0x7fa6c4, icon: '/textures/fish.svg', food: 4 });
defineItem(ITEM.VOID_FISH, 'void fish', { color: 0x4b3a7a, icon: '/textures/void-fish.svg' });
defineItem(ITEM.LOOT_CRATE, 'loot crate', { maxStack: 16, crate: 'lootCrate', color: 0x8a6a3e, icon: '/textures/loot-crate.svg' });
defineItem(ITEM.IRONBOUND_CRATE, 'iron-bound crate', { maxStack: 16, crate: 'ironboundCrate', color: 0x5c5f66, icon: '/textures/ironbound-crate.svg' });
defineItem(ITEM.GRENADE, 'grenade', { maxStack: EXPLOSIVES.grenade.maxStack, throwable: true, color: 0x4b5a3a,
  icon: '/textures/grenade.svg' });

// Extra tooltip lines (how to use it) for items that need explaining.
export const ITEM_TIPS = {
  [ITEM.GOLD_COIN]: ['Currency of the Sky Merchant', 'Earn it by selling goods to him or through your Merchant Depot'],
  [ITEM.SPYGLASS]: ['Hold right click to look through it: zoom, see farther, read enemy names',
    'You cannot attack while looking through it', 'Try giving this to a Lookout monkey!'],
  [BLOCK.MERCHANT_DEPOT]: ['Where the Sky Merchant\'s airship docks each morning (one per team)',
    'Place it right on the edge of your island, on the far side (facing away from the center island)',
    'The airship docks in the open sky in front of it, so keep that space clear; it curves in around anything further out',
    'Put goods in its selling slots to sell them automatically while he is docked'],
  [BLOCK.REINFORCED_WALL]: ['Stone bricks bound with iron', 'Needs an iron hammer; takes four times as long to break as stone bricks',
    'Twice as blast resistant as stone bricks'],
  [ITEM.SULFUR_SEEDS]: ['Plant on farmland (till grass or dirt with a hoe)', 'Grows into a yellow sulfur plant; harvest it for sulfur and more seeds',
    'Farmer monkeys plant and harvest it too'],
  [ITEM.SULFUR]: ['Grown from sulfur plants', 'With charcoal, makes gunpowder'],
  [ITEM.GUNPOWDER]: ['Made from sulfur and charcoal', 'Goes into grenades and explosive barrels'],
  [ITEM.GRENADE]: ['Right click to throw; it bounces and goes off after a few seconds',
    'Hurts creatures and players nearby; breaks only soft blocks', 'Never damages spike barricades'],
  [ITEM.FISH]: ['Caught in water', 'Hold right click to eat'],
  [ITEM.VOID_FISH]: ['Only bites deep in the void', 'Strange and cold. Surely good for something...'],
  [ITEM.LOOT_CRATE]: ['Fished up now and then', 'Right click with it in hand to open'],
  [ITEM.IRONBOUND_CRATE]: ['Fished up with a tier 2 rod', 'Right click with it in hand to open: richer than a loot crate'],
  [ITEM.LIGHTER]: ['Right click an explosive barrel to light its fuse', 'Reusable: never wears out or runs dry'],
  [BLOCK.EXPLOSIVE_BARREL]: ['Light it by right clicking with a lighter', 'Blows apart even stone; nearby explosions light it too',
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

// ---- Toughness of dropped items ----
// What can destroy an item lying on the ground: a hazard of a given strength
// destroys items whose toughness is lower. Fire (later) is strength 1, lava
// 3, and an explosion its kind's itemStrength scaled down with distance
// (EXPLOSIVES in shared/config.js; grenades are 0, so they never destroy
// items).
//   0 flammable: wood, plants, food, leather, cloth, powder, crates
//   1 sturdy: stone, earth, glass and most blocks
//   2 tough: metal (ores, ingots, metal gear, coins), accessories
//   3 fireproof: dragon and fire things (dragon scales and armor, the crown,
//     dragon heart, ember heart), basalt and magma
export const HAZARD = { fire: 1, lava: 3 };
const FLAMMABLE_ITEMS = new Set([ITEM.WOOD_HAMMER, ITEM.WOOD_SWORD, ITEM.WOOD_HOE, ITEM.WOOD_FISHING_ROD, ITEM.BOW,
  ITEM.CROSSBOW, ITEM.LADDER, ITEM.DOOR, ITEM.LEATHER, ITEM.LEATHER_ARMOR, ITEM.BEEF, ITEM.COOKED_BEEF, ITEM.GOLDEN_BEEF,
  ITEM.BREAD, ITEM.WHEAT, ITEM.WHEAT_SEEDS, ITEM.SULFUR_SEEDS, ITEM.SULFUR, ITEM.GUNPOWDER, ITEM.GRENADE, ITEM.TREE_SEED,
  ITEM.SILK, ITEM.ROPE_BUNDLE, ITEM.GLIDER, ITEM.CHARCOAL, ITEM.FISH, ITEM.VOID_FISH, ITEM.LOOT_CRATE, ITEM.IRONBOUND_CRATE]);
const FIREPROOF_ITEMS = new Set([ITEM.DRAGON_SCALE, ITEM.DRAGONSCALE_ARMOR, ITEM.DRAGON_CROWN, ITEM.DRAGON_HEART,
  ITEM.EMBER_HEART, ITEM.LAVA_BUCKET]);
const FLAMMABLE_BLOCKS = new Set([BLOCK.WOOD, BLOCK.PLANKS, BLOCK.LEAVES, BLOCK.WORKBENCH, BLOCK.CHEST, BLOCK.BRANCH,
  BLOCK.EXPLOSIVE_BARREL, BLOCK.BRIDGE_DECK, BLOCK.ROPE].filter((id) => id !== undefined));
export function itemToughness(id) {
  const def = getItemDef(id);
  if (def.toughness !== undefined) return def.toughness;
  if (FIREPROOF_ITEMS.has(id)) return 3;
  if (FLAMMABLE_ITEMS.has(id)) return 0;
  if (id < 256) {
    const block = getBlockDef(id);
    if (FLAMMABLE_BLOCKS.has(id) || block.shape === 'plant' || plantLike(id)) return 0;
    if (id === BLOCK.BASALT || id === BLOCK.MAGMA) return 3;
    if (id === BLOCK.IRON_ORE || id === BLOCK.COPPER_ORE || id === BLOCK.TIN_ORE) return 2;
    return 1;
  }
  return 2;
}
function plantLike(id) { return id === BLOCK.SAPLING || getBlockDef(id).plantArt !== undefined; }
