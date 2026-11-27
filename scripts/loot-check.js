// Central-island chests (every *Central loot table) hold no wood or stone
// tools, and are richer than their outer-island versions: iron gear and
// ingots more often. Rolls still produce valid stacks.
//   node scripts/loot-check.js
import assert from 'node:assert/strict';
import { LOOT_TABLES } from '../shared/loot.js';
import { ITEM } from '../shared/itemIds.js';
import { getItemDef } from '../shared/items.js';

const weak = new Set([ITEM.WOOD_SWORD, ITEM.WOOD_HAMMER, ITEM.STONE_SWORD, ITEM.STONE_HAMMER]);
const iron = new Set([ITEM.IRON_SWORD, ITEM.IRON_HAMMER, ITEM.IRON_ARMOR, ITEM.IRON_INGOT]);
const share = (table, set) => {
  const total = table.entries.reduce((n, e) => n + e.weight, 0);
  return table.entries.filter((e) => set.has(e.item)).reduce((n, e) => n + e.weight, 0) / total;
};
const central = Object.keys(LOOT_TABLES).filter((k) => k.endsWith('Central'));
assert.ok(central.length >= 6, 'central tables missing');
for (const name of central) {
  const table = LOOT_TABLES[name], outer = LOOT_TABLES[name.replace(/Central$/, '')];
  assert.ok(!table.entries.some((e) => weak.has(e.item)), `${name} still has wood or stone tools`);
  for (const e of table.entries) assert.ok(getItemDef(e.item)?.name, `${name} has an unknown item ${e.item}`);
  if (outer) assert.ok(share(table, iron) > share(outer, iron), `${name} is not richer in iron than ${name.replace(/Central$/, '')}`);
}
console.log(`OK: ${central.length} central loot tables, no wood or stone tools, more iron than the outer islands`);
