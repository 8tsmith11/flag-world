// The Sky Merchant's economy and docking, shared by the server (trades,
// depot sales, placement) and the client (trade screen, depot slot hints,
// the docking preview while holding a depot).
//
// Prices are fixed and the same for every team. The merchant buys (pays
// coins for) raw resources and a few processed goods, and sells resources,
// equipment and loot. Every item he both buys and sells pays out less than
// it costs, also through any chain of crafting, smelting, crushing or
// alloying (scripts/commerce-check.js proves this with a fixed-point cost
// search), so coins only come from gathering and work. Valuable goods have
// a daily stock that refills each morning.
//
// Requested goods: a few crafted items, chosen from the seed (so the same
// for every team, all match), that he pays a premium for: more than their
// materials would sell for, never as much as buying those materials from
// him would cost.
import { BLOCK, isSolid, isLiquid } from './blocks.js';
import { ITEM } from './itemIds.js';
import { getItemDef } from './items.js';
import { RECIPES, SMELTING, CRUSHING } from './recipes.js';
import { MERCHANT, METALS } from './config.js';
import { mulberry32 } from './structures.js';

// What he buys: `count` of `item` for `coins`.
export const MERCHANT_BUYS = [
  { item: BLOCK.WOOD, count: 8, coins: 1 },
  { item: BLOCK.STONE, count: 32, coins: 1 },
  { item: BLOCK.SAND, count: 32, coins: 1 },
  { item: BLOCK.GLASS, count: 16, coins: 1 },
  { item: ITEM.CHARCOAL, count: 6, coins: 1 },
  { item: ITEM.WHEAT, count: 8, coins: 1 },
  { item: ITEM.BREAD, count: 2, coins: 1 },
  { item: ITEM.COOKED_BEEF, count: 2, coins: 1 },
  { item: ITEM.LEATHER, count: 2, coins: 1 },
  { item: ITEM.SILK, count: 2, coins: 1 },
  { item: ITEM.COPPER_INGOT, count: 2, coins: 1 },
  { item: ITEM.TIN_INGOT, count: 1, coins: 1 },
  { item: ITEM.IRON_INGOT, count: 1, coins: 2 },
  { item: ITEM.BRONZE_INGOT, count: 1, coins: 1 },
  { item: ITEM.DRAGON_SCALE, count: 1, coins: 3 },
];

// What he sells: `count` of `item` for `coins`; `stock` (optional) is how
// many times a day it can be bought.
export const MERCHANT_SELLS = [
  { id: 'wood', item: BLOCK.WOOD, count: 8, coins: 2 },
  { id: 'stone', item: BLOCK.STONE, count: 32, coins: 3 },
  { id: 'sapling', item: ITEM.TREE_SEED, count: 2, coins: 1 },
  { id: 'seeds', item: ITEM.WHEAT_SEEDS, count: 4, coins: 1 },
  // The only bought source of sulfur seeds (also found in loot); the crop
  // gives seeds back, so a farm never needs more.
  { id: 'sulfur_seeds', item: ITEM.SULFUR_SEEDS, count: 2, coins: 4, stock: 4 },
  { id: 'glass', item: BLOCK.GLASS, count: 4, coins: 2 },
  { id: 'copper', item: ITEM.COPPER_INGOT, count: 2, coins: 3 },
  { id: 'tin', item: ITEM.TIN_INGOT, count: 1, coins: 3, stock: 16 },
  { id: 'iron', item: ITEM.IRON_INGOT, count: 1, coins: 5, stock: 12 },
  { id: 'leather', item: ITEM.LEATHER, count: 2, coins: 3 },
  { id: 'beef', item: ITEM.COOKED_BEEF, count: 2, coins: 3 },
  { id: 'torch', item: BLOCK.TORCH, count: 8, coins: 2 },
  { id: 'bow', item: ITEM.BOW, count: 1, coins: 6, stock: 2 },
  { id: 'leather_armor', item: ITEM.LEATHER_ARMOR, count: 1, coins: 8, stock: 2 },
  { id: 'glider', item: ITEM.GLIDER, count: 1, coins: 12, stock: 1 },
  { id: 'rope', item: ITEM.ROPE_BUNDLE, count: 1, coins: 6, stock: 2 },
  { id: 'spyglass', item: ITEM.SPYGLASS, count: 1, coins: 20, stock: 1 },
  { id: 'golden_beef', item: ITEM.GOLDEN_BEEF, count: 1, coins: 15, stock: 2 },
  { id: 'rift_orb', item: ITEM.RIFT_ORB, count: 1, coins: 14, stock: 2 },
  { id: 'crossbow', item: ITEM.CROSSBOW, count: 1, coins: 40, stock: 1 },
  { id: 'grappling_hook', item: ITEM.GRAPPLING_HOOK, count: 1, coins: 35, stock: 1 },
  { id: 'spring_boots', item: ITEM.SPRING_BOOTS, count: 1, coins: 45, stock: 1 },
];
export const sellOffer = (id) => MERCHANT_SELLS.find((o) => o.id === id) ?? null;

// Crafted goods he may request (one of these may be chosen by the seed).
// Nothing he sells is on the list.
const REQUEST_POOL = ['arrow_turret', 'bronze_sword', 'bronze_hammer', 'bronze_armor', 'iron_sword', 'iron_armor',
  'iron_hammer', 'reinforced_door', 'bucket', 'chest', 'furnace', 'bronze_pipe', 'fluid_tank', 'door', 'anvil',
  'reinforced_wall', 'stone_sword', 'stone_hammer', 'crusher', 'boiler', 'bread', 'alloy_furnace'];

// ---- Value of things ----

const buyRate = new Map(MERCHANT_BUYS.map(({ item, count, coins }) => [item, coins / count]));
const sellRate = new Map(MERCHANT_SELLS.map(({ item, count, coins }) => [item, coins / count]));

// Every way one item becomes another: crafting recipes, smelting, crushing
// and alloying (any form of copper or tin counts as one unit of metal), as
// [{ inputs: [{ item, count }], output, count }].
export function conversions() {
  const out = RECIPES.map(({ inputs, output, count }) => ({ inputs, output, count }));
  for (const [input, output] of Object.entries(SMELTING)) out.push({ inputs: [{ item: Number(input), count: 1 }], output, count: 1 });
  for (const [input, { item, count }] of Object.entries(CRUSHING)) out.push({ inputs: [{ item: Number(input), count: 1 }], output: item, count });
  for (const copper of METAL_FORMS.copper) for (const tin of METAL_FORMS.tin) {
    out.push({ inputs: [{ item: copper, count: METALS.alloy.copper }, { item: tin, count: METALS.alloy.tin }],
      output: ITEM.BRONZE_INGOT, count: METALS.alloy.output });
  }
  return out;
}
// Copper and tin in every form the alloy furnace takes: one ore, dust or
// ingot is one unit (the crusher's two dust per ore keeps its advantage).
export const METAL_FORMS = {
  copper: [BLOCK.COPPER_ORE, ITEM.COPPER_DUST, ITEM.COPPER_INGOT],
  tin: [BLOCK.TIN_ORE, ITEM.TIN_DUST, ITEM.TIN_INGOT],
};
export function metalOf(item) {
  return METAL_FORMS.copper.includes(item) ? 'copper' : METAL_FORMS.tin.includes(item) ? 'tin' : null;
}

// Cheapest way to get one of each item using only coins: buy it from the
// merchant, or buy what makes it and convert (fuel and steam counted as free,
// which only makes the check stricter). Infinity if coins can't get it.
export function purchaseCosts() {
  const cost = new Map(sellRate);
  const list = conversions();
  for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
    changed = false;
    for (const { inputs, output, count } of list) {
      const total = inputs.reduce((sum, { item, count: n }) => sum + (cost.get(item) ?? Infinity) * n, 0) / count;
      if (total < (cost.get(output) ?? Infinity) - 1e-9) { cost.set(output, total); changed = true; }
    }
  }
  return cost;
}

// What an item's materials are worth if sold to the merchant: its own buy
// price, else what its recipe's inputs fetch (planks from wood, and so on).
export function materialValue(item, seen = new Set()) {
  if (buyRate.has(item)) return buyRate.get(item);
  if (seen.has(item)) return 0;
  seen.add(item);
  const recipe = RECIPES.find((r) => r.output === item);
  if (!recipe) {
    const smelted = Object.entries(SMELTING).find(([, out]) => out === item);
    return smelted ? materialValue(Number(smelted[0]), seen) : 0;
  }
  return recipe.inputs.reduce((sum, { item: input, count }) => sum + materialValue(input, new Set(seen)) * count, 0) / recipe.count;
}

// The requested goods for a seed: [{ item, count: 1, coins, recipe }],
// paying requestPremium times their materials' value, but always more than
// that value and less than buying the materials from the merchant.
export function merchantRequests(seed) {
  const random = mulberry32((seed ^ 0x6d2b79f5) >>> 0);
  const pool = [...REQUEST_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const costs = purchaseCosts(), out = [];
  for (const id of pool) {
    if (out.length >= MERCHANT.requests) break;
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe || buyRate.has(recipe.output) || sellRate.has(recipe.output)) continue;
    const value = materialValue(recipe.output);
    const buyBack = costs.get(recipe.output) ?? Infinity;
    let coins = Math.max(Math.ceil(value * MERCHANT.requestPremium), Math.floor(value) + 1);
    if (Number.isFinite(buyBack)) coins = Math.min(coins, Math.ceil(buyBack) - 1);
    if (coins <= value || coins < 2 || coins >= buyBack) continue;
    out.push({ item: recipe.output, count: 1, coins, recipe: id, request: true });
  }
  return out;
}

// Everything he buys for a seed: the regular list plus the requests.
export function buyList(seed) {
  return [...merchantRequests(seed), ...MERCHANT_BUYS];
}
export function buyOffer(list, item) {
  return list.find((o) => o.item === item) ?? null;
}

// Baby monkey price for a team that has bought `bought` before.
export function babyPrice(bought) {
  return Math.round(MERCHANT.babyBase * MERCHANT.babyGrowth ** bought);
}

// ---- Docking ----

// The airship docks beside the depot, its bow `gap` blocks out, lying along
// the dock direction: `length` long, halfWidth to each side, from `below`
// under the depot's floor to `above` over it. The approach corridor runs
// another `corridor` blocks straight out the same way; all of it must be
// open (no solid blocks or liquids) so the ship never passes through
// anything. Facing: 0 north (-Z), 1 east (+X), 2 south (+Z), 3 west (-X).
export const DOCK = { gap: 1, length: 15, halfWidth: 3, below: 4, above: 12, corridor: 48 };
export const DOCK_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Directions facing away from the center island from a point, best first
// (only those within about 70 degrees of straight out).
export function dockFacings(world, x, z) {
  const center = world.islands?.find((i) => i.kind === 'center') ?? { x: world.sizeX / 2, z: world.sizeZ / 2 };
  const ox = x - center.x, oz = z - center.z, len = Math.hypot(ox, oz) || 1;
  return DOCK_DIRS.map(([dx, dz], facing) => ({ facing, dot: (dx * ox + dz * oz) / len }))
    .filter((f) => f.dot > 0.34).sort((a, b) => b.dot - a.dot).map((f) => f.facing);
}

// The first blocked cell of the dock and corridor for a depot at pos facing
// `facing`, or null when it is all clear.
export function dockBlocked(world, pos, facing) {
  const [dx, dz] = DOCK_DIRS[facing], px = -dz, pz = dx;
  for (let s = DOCK.gap; s < DOCK.gap + DOCK.length + DOCK.corridor; s++) {
    for (let w = -DOCK.halfWidth; w <= DOCK.halfWidth; w++) {
      const x = pos.x + dx * s + px * w, z = pos.z + dz * s + pz * w;
      for (let y = pos.y - DOCK.below; y <= pos.y + DOCK.above; y++) {
        const id = world.getBlock(x, y, z);
        if (isSolid(id) || isLiquid(id)) return { x, y, z };
      }
    }
  }
  return null;
}

// Whether a depot may go at pos for a team: { ok, facing, reason }. `island`
// is the team's island ({ x, z, radius }), or null to skip that check.
export function checkDepotSite(world, pos, island) {
  if (island && Math.hypot(pos.x + 0.5 - island.x, pos.z + 0.5 - island.z) > island.radius * 1.25 + 6)
    return { ok: false, reason: 'The Merchant Depot must be on your own island.' };
  const facings = dockFacings(world, pos.x + 0.5, pos.z + 0.5);
  if (!facings.length) return { ok: false, reason: 'Place the depot on the far edge of your island, the side facing away from the center island.' };
  let blocked = null;
  for (const facing of facings) {
    const hit = dockBlocked(world, pos, facing);
    if (!hit) return { ok: true, facing };
    blocked ??= { facing, hit };
  }
  const below = blocked.hit.y < pos.y;
  return { ok: false, facing: blocked.facing, blocked: blocked.hit,
    reason: below ? 'The airship needs open sky in front of the depot: place it right at the island\'s edge, over the drop.'
      : 'Something is in the airship\'s way. Clear the space in front of the depot (shown in red).' };
}

// The ship's docked position (center of the deck at the depot's floor
// height) and yaw (bow toward the depot) for a depot.
export function dockPose(pos, facing) {
  const [dx, dz] = DOCK_DIRS[facing], s = DOCK.gap + DOCK.length / 2;
  return { x: pos.x + 0.5 + dx * s, y: pos.y, z: pos.z + 0.5 + dz * s, yaw: Math.atan2(dx, dz) };
}

// Merchant names and looks: deterministic from a seed number, so a new
// merchant (after one is killed) gets a fresh name and appearance.
const FIRST = ['Oswin', 'Thaddeus', 'Cornelius', 'Barnaby', 'Ignatius', 'Percival', 'Ambrose', 'Lucius',
  'Ezekiel', 'Mortimer', 'Octavius', 'Silas', 'Fitzgerald', 'Horatio', 'Leopold', 'Quentin'];
const LAST = ['Inkwell', 'Brassbottom', 'Coggleby', 'Fathomere', 'Quillfin', 'Gearwhistle', 'Murkwater',
  'Copperkettle', 'Tidewright', 'Sprocket', 'Deepcurrent', 'Velvetfin'];
export function merchantLook(seed) {
  const random = mulberry32((seed * 2654435761) >>> 0);
  const pick = (list) => list[Math.floor(random() * list.length)];
  return {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    // Purple skin hue/lightness, coat and hat colors, tentacle count,
    // monocle and hat style: small variations on one friendly look.
    skinHue: 0.74 + random() * 0.1, skinLight: 0.38 + random() * 0.14,
    coat: pick([0x2f4a6d, 0x5a2e3a, 0x2f5a46, 0x4a3b2a, 0x3b2f5a, 0x6b4a1f]),
    trim: pick([0xd8b25a, 0xc8c8c8, 0xb87342]),
    hat: pick(['top', 'bowler', 'captain']), monocle: random() < 0.5, tentacles: 6 + Math.floor(random() * 3),
  };
}

// Display name for an item (for trade lists and notices).
export function itemName(item) {
  return getItemDef(item).name;
}
