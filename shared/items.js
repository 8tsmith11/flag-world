// Item registry. Every block is also an item with the same id (0-255), placed
// as that block. Items that aren't blocks (tools, ladders, doors, ingots) get
// ids from 256 up (shared/itemIds.js). Like block ids, item ids must never be
// renumbered. What tools do when held is in shared/tools.js.
//
// Properties:
//   name, color   - for icons and models
//   maxStack      - largest stack in one inventory slot (tools: 1)
//   block         - block id placed with this item, or null
//   tool          - model/icon shape for tools ('hammer', 'sword', 'bow'), or null
//   shape         - model/icon shape for other non-block items ('ingot'), or null

//   places        - for items placed by special rules: 'ladder' or 'door'

import { MAX_STACK } from './config.js';
import { BLOCK, getBlockDef, ladderBlock, doorBlock } from './blocks.js';
import { ITEM } from './itemIds.js';

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
  defineItem(hammer, `${material} hammer`, { maxStack: 1, tool: 'hammer', color });
  defineItem(sword, `${material} sword`, { maxStack: 1, tool: 'sword', color });
}
defineItem(ITEM.IRON_INGOT, 'iron ingot', { shape: 'ingot', color: IRON_COLOR });
// Hold right click to draw, release to shoot (arrows are unlimited).
defineItem(ITEM.BOW, 'bow', { maxStack: 1, tool: 'bow', color: 0x8a5a2b });
defineItem(ITEM.LADDER, 'ladder', { places: 'ladder', color: getBlockDef(ladderBlock(0)).color });
defineItem(ITEM.DOOR, 'door', { places: 'door', color: getBlockDef(doorBlock(0, false, false)).color });

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
