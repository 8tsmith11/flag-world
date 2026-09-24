// Item modifiers, as data. A moddable item's stack may carry `mods`: 1 or 2
// distinct [{ id, value }] rolled from its category's pool (the item's
// `modCategory` in items.js). Modded stacks are per-instance: moddable items
// all stack to 1, and stacks with mods never merge.
//
// Each modifier has a name (a prefix on the item's name), a category, the
// range its value rolls in (whole numbers if `integer`, else a fraction
// rounded to hundredths), and the tooltip text for a value. What a value does
// is read where it applies, by id, through modValue().

import { getItemDef } from './items.js';

const pct = (value) => `${Math.round(value * 100)}%`;

export const MODIFIERS = {
  sharp: { name: 'Sharp', category: 'melee', range: [1, 2], integer: true, text: (v) => `+${v} damage` },
  keen: { name: 'Keen', category: 'melee', range: [0.15, 0.25], text: (v) => `-${pct(v)} attack cooldown` },
  heavy: { name: 'Heavy', category: 'melee', range: [0.3, 0.6], text: (v) => `+${pct(v)} knockback` },
  vampiric: { name: 'Vampiric', category: 'melee', range: [0.25, 0.5], text: (v) => `${pct(v)} chance to heal 1 HP on hit` },
  power: { name: 'Power', category: 'ranged', range: [1, 2], integer: true, text: (v) => `+${v} arrow damage` },
  quickdraw: { name: 'Quickdraw', category: 'ranged', range: [0.2, 0.35], text: (v) => `-${pct(v)} draw / load time` },
  far: { name: 'Far', category: 'ranged', range: [0.2, 0.4], text: (v) => `+${pct(v)} arrow speed` },
  sturdy: { name: 'Sturdy', category: 'armor', range: [1, 2], integer: true, text: (v) => `+${v} armor points` },
  light: { name: 'Light', category: 'armor', range: [0.05, 0.1], text: (v) => `+${pct(v)} move speed` },
  thorns: { name: 'Thorns', category: 'armor', range: [1, 2], integer: true, text: (v) => `Melee attackers take ${v} damage` },
  vital: { name: 'Vital', category: 'accessory', range: [1, 2], integer: true, text: (v) => `+${v} max HP` },
  fleet: { name: 'Fleet', category: 'accessory', range: [0.05, 0.1], text: (v) => `+${pct(v)} move speed` },
  cushioned: { name: 'Cushioned', category: 'accessory', range: [0.2, 0.4], text: (v) => `-${pct(v)} fall damage` },
  efficient: { name: 'Efficient', category: 'hammer', range: [0.2, 0.4], text: (v) => `+${pct(v)} break speed` },
};

// Chance of a roll giving 1 modifier; otherwise 2.
export const ONE_MOD_CHANCE = 0.75;

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
// 1 modifier (ONE_MOD_CHANCE) or 2, distinct. [] for other items.
export function rollMods(item, random) {
  const pool = [...(POOLS[modCategory(item)] ?? [])];
  if (!pool.length) return [];
  const count = Math.min(pool.length, random() < ONE_MOD_CHANCE ? 1 : 2);
  const mods = [];
  for (let i = 0; i < count; i++) {
    const id = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const { range: [lo, hi], integer } = MODIFIERS[id];
    const value = integer ? lo + Math.floor(random() * (hi - lo + 1))
      : Math.round((lo + random() * (hi - lo)) * 100) / 100;
    mods.push({ id, value });
  }
  return mods;
}

// A modifier's value on a stack (0 without it, or with no stack).
export function modValue(stack, id) {
  return stack?.mods?.find((mod) => mod.id === id)?.value ?? 0;
}

// Whether two stacks may merge: the same item and neither modded.
export function sameKind(a, b) {
  return !!a && !!b && a.item === b.item && !a.mods?.length && !b.mods?.length;
}

const titleCase = (text) => text.replace(/\b\w/g, (c) => c.toUpperCase());

// "Keen Heavy Iron Sword" for a modded stack; plain items keep their name.
export function stackName(stack, baseName) {
  if (!stack?.mods?.length) return baseName;
  return `${stack.mods.map((mod) => MODIFIERS[mod.id]?.name ?? mod.id).join(' ')} ${titleCase(baseName)}`;
}

// One tooltip line per modifier, e.g. "Keen: -18% attack cooldown".
export function modLines(stack) {
  return (stack?.mods ?? []).filter((mod) => MODIFIERS[mod.id])
    .map((mod) => `${MODIFIERS[mod.id].name}: ${MODIFIERS[mod.id].text(mod.value)}`);
}
