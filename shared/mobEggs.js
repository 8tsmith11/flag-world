// Add a new mob and its stable item id here to create its egg item and its
// creative recipe. The server also needs a constructor for its behavior.
import { ITEM } from './itemIds.js';
import { ENTITY_TYPE } from './protocol.js';

export const MOB_EGGS = [
  { item: ITEM.COW_EGG, type: ENTITY_TYPE.COW, name: 'Cow', color: 0xe9e4d7, spots: 0x25272b },
  { item: ITEM.DRAGON_EGG, type: ENTITY_TYPE.DRAGON, name: 'Dragon', color: 0xb84f45, spots: 0x713027 },
  { item: ITEM.CRAWLER_EGG, type: ENTITY_TYPE.CRAWLER, name: 'Crawler', color: 0x59675e, spots: 0x242e29 },
  { item: ITEM.VOID_EEL_EGG, type: ENTITY_TYPE.VOID_EEL, name: 'Void Eel', color: 0x5a6dac, spots: 0x23315b },
];

export function eggForItem(item) {
  return MOB_EGGS.find((egg) => egg.item === item) ?? null;
}
