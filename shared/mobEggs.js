// Add a new mob and its stable item id here to create its egg item and its
// creative recipe. The server also needs a constructor for its behavior.
import { ITEM } from './itemIds.js';
import { ENTITY_TYPE } from './protocol.js';
import { NPC_KIND } from './npcs.js';

export const MOB_EGGS = [
  { item: ITEM.COW_EGG, type: ENTITY_TYPE.COW, name: 'Cow', color: 0xe9e4d7, spots: 0x25272b },
  { item: ITEM.DRAGON_EGG, type: ENTITY_TYPE.DRAGON, name: 'Dragon', color: 0xb84f45, spots: 0x713027 },
  { item: ITEM.CRAWLER_EGG, type: ENTITY_TYPE.CRAWLER, name: 'Crawler', color: 0x59675e, spots: 0x242e29 },
  { item: ITEM.VOID_EEL_EGG, type: ENTITY_TYPE.VOID_EEL, name: 'Void Eel', color: 0x5a6dac, spots: 0x23315b },
  ...['worker', 'soldier', 'archer', 'brute', 'king', 'totem'].map(role => ({
    item: ITEM[`GOBLIN_${role.toUpperCase()}_EGG`], type: `goblin${role[0].toUpperCase()}${role.slice(1)}`,
    name: `Goblin ${role[0].toUpperCase()}${role.slice(1)}`, color: 0x6f9b3c, spots: 0x3b2a18,
  })),
  ...[
    [ITEM.MONKEY_EGG, NPC_KIND.WORK_MONKEY, 'Monkey', 0x80502f],
    [ITEM.WISE_MONKEY_EGG, NPC_KIND.WISE_MONKEY, 'Wise Monkey', 0xc86b2a],
    [ITEM.ANCIENT_WATER_MONKEY_EGG, NPC_KIND.ANCIENT_WATER_MONKEY, 'Ancient Water Monkey', 0x3d8f8a],
    [ITEM.ANCIENT_LIGHTNING_MONKEY_EGG, NPC_KIND.ANCIENT_LIGHTNING_MONKEY, 'Ancient Lightning Monkey', 0xd8cff5],
  ].map(([item, npc, name, color]) => ({ item, type: ENTITY_TYPE.NPC, npc, name, color, spots: 0x35261c })),
];

export function eggForItem(item) {
  return MOB_EGGS.find((egg) => egg.item === item) ?? null;
}
