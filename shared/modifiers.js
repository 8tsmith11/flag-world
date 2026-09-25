// Item modifiers, as data. A moddable item's stack may carry one
// [{ id, value }] rolled from its category's pool (the item's
// `modCategory` in items.js). Modded stacks are per-instance: moddable items
// all stack to 1, and stacks with mods never merge.
//
// Each modifier has a name (a prefix on the item's name), a category, the
// fixed value, and the tooltip text for that value. What a value does
// is read where it applies, by id, through modValue().

import { getItemDef } from './items.js';

const pct = (value) => `${Math.round(value * 100)}%`;

export const MODIFIERS = {
  sharp: { name: 'Sharp', category: 'melee', value: 2, text: (v) => `+${v} damage` },
  keen: { name: 'Keen', category: 'melee', value: 0.2, text: (v) => `-${pct(v)} attack cooldown` },
  heavy: { name: 'Heavy', category: 'melee', value: 0.45, text: (v) => `+${pct(v)} knockback` },
  vampiric: { name: 'Vampiric', category: 'melee', value: 0.35, text: (v) => `${pct(v)} chance to heal 1 HP on hit` },
  power: { name: 'Power', category: 'ranged', value: 2, text: (v) => `+${v} arrow damage` },
  quickdraw: { name: 'Quickdraw', category: 'ranged', value: 0.25, text: (v) => `-${pct(v)} draw / load time` },
  far: { name: 'Far', category: 'ranged', value: 0.3, text: (v) => `+${pct(v)} arrow speed` },
  sturdy: { name: 'Sturdy', category: 'armor', value: 2, text: (v) => `+${v} armor points` },
  light: { name: 'Light', category: 'armor', value: 0.08, text: (v) => `+${pct(v)} move speed` },
  thorns: { name: 'Thorns', category: 'armor', value: 2, text: (v) => `Melee attackers take ${v} damage` },
  vital: { name: 'Vital', category: 'accessory', value: 2, text: (v) => `+${v} max HP` },
  fleet: { name: 'Fleet', category: 'accessory', value: 0.08, text: (v) => `+${pct(v)} move speed` },
  cushioned: { name: 'Cushioned', category: 'accessory', value: 0.3, text: (v) => `-${pct(v)} fall damage` },
  efficient: { name: 'Efficient', category: 'hammer', value: 0.3, text: (v) => `+${pct(v)} break speed` },
};

const POOLS = {};
for (const [id, { category }] of Object.entries(MODIFIERS)) (POOLS[category] ??= []).push(id);

// 'melee', 'ranged', 'armor', 'accessory', 'hammer', or null (no modifiers).
export function modCategory(item) {
  return item === null || item === undefined ? null : getItemDef(item).modCategory ?? null;
}

export function canHaveMods(item) {
  return !!POOLS[modCategory(item)];
}

// A fresh roll for a moddable item with `random` (a () => [0, 1) stream):
// One modifier. [] for other items.
export function rollMods(item, random) {
  const pool = POOLS[modCategory(item)] ?? [];
  if (!pool.length) return [];
  const id = pool[Math.floor(random() * pool.length)];
  return [{ id, value: MODIFIERS[id].value }];
}

// A modifier's value on a stack (0 without it, or with no stack).
export function modValue(stack, id) {
  return stack?.mods?.some((mod) => mod.id === id) ? MODIFIERS[id]?.value ?? 0 : 0;
}

// Whether two stacks may merge: the same item and neither modded.
export function sameKind(a, b) {
  return !!a && !!b && a.item === b.item && !a.mods?.length && !b.mods?.length;
}

const titleCase = (text) => text.replace(/\b\w/g, (c) => c.toUpperCase());

// One modifier prefix for a modded stack; plain items keep their name.
export function stackName(stack, baseName) {
  if (!stack?.mods?.length) return baseName;
  const id = stack.mods[0].id;
  return `${MODIFIERS[id]?.name ?? id} ${titleCase(baseName)}`;
}

// One tooltip line per modifier, e.g. "Keen: -18% attack cooldown".
export function modLines(stack) {
  return (stack?.mods ?? []).slice(0, 1).filter((mod) => MODIFIERS[mod.id])
    .map((mod) => `${MODIFIERS[mod.id].name}: ${MODIFIERS[mod.id].text(MODIFIERS[mod.id].value)}`);
}
