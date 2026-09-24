// Block type registry. Block ids are stored as bytes in chunk data, so ids must
// stay below 256 and must never be renumbered once worlds are saved.
//
// Properties:
//   solid        - collides with entities
//   transparent  - neighbours still draw their faces against this block
//   color        - flat render color (0xRRGGBB) until textures exist
//   breakable    - can be mined at all
//   hardness     - minimum tool strength needed to break it (bare hands are HAND_STRENGTH)
//   breakTime    - seconds of holding the break button to mine it
//   drops        - item id dropped when broken (default: the block's own id), or null
//   shape        - null for a plain cube, or a name the mesher draws from boxes
//                  ('ladder', 'door', 'workbench', 'furnace', 'chest', 'rope', 'anvil')
//
// Ladders and doors keep their state in the block id:
//   ladder: LADDER + facing, where facing is the side of the cell it hangs on
//           (toward the block holding it up)
//   door:   DOOR + facing + 4 * open + 8 * upper half, where facing is the
//           way the placing player looked
//   furnace, chest, anvil: one id per facing (FACED), where facing is the way the
//           front faces (toward the player who placed it). The first id is
//           the item, the drop, and the id used in recipes.
// Facing: 0 north (-Z), 1 east (+X), 2 south (+Z), 3 west (-X).
//   tileEntity   - name of the tile entity type attached when placed ('furnace', 'chest', 'anvil')

import { TICK_RATE } from './config.js';
import { ITEM } from './itemIds.js';

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WATER: 4,
  KEEP: 5,
  PEDESTAL: 6,
  WOOD: 7,
  LEAVES: 8,
  PLANKS: 9,
  // Ranges: LADDER..LADDER+3 and DOOR..DOOR+15.
  LADDER: 10,
  DOOR: 14,
  IRON_ORE: 30,
  SAND: 31,
  WORKBENCH: 32,
  FURNACE: 33,
  CHEST: 34,
  // Flowing water: 1 is weakest, 7 is strongest. WATER is a source.
  WATER_FLOW_1: 41,
  WATER_FLOW_7: 47,
  SAPLING: 48,
  STONE_BRICKS: 49,
  MOSSY_STONE_BRICKS: 50,
  CRACKED_STONE_BRICKS: 51,
  // Hung in columns by a Rope Bundle; climbed like a ladder.
  ROPE: 52,
  // Reroll item modifiers. Ids 53-56, one per facing (FACED).
  ANVIL: 53,
  // The darkened ground inside a dragon roost's nest.
  SCORCHED_EARTH: 57,
};

export function isWater(id) {
  return id === BLOCK.WATER || (id >= BLOCK.WATER_FLOW_1 && id <= BLOCK.WATER_FLOW_7);
}

export function isFlowingWater(id) {
  return id >= BLOCK.WATER_FLOW_1 && id <= BLOCK.WATER_FLOW_7;
}

export function waterLevel(id) {
  return id === BLOCK.WATER ? 8 : isFlowingWater(id) ? id - BLOCK.WATER_FLOW_1 + 1 : 0;
}

// Blocks with a front: their id for each facing. Furnace was a single id
// before it had a front, so its other facings come later in the id space.
export const FACED = {
  [BLOCK.FURNACE]: [BLOCK.FURNACE, 38, 39, 40],
  [BLOCK.CHEST]: [BLOCK.CHEST, 35, 36, 37],
  [BLOCK.ANVIL]: [BLOCK.ANVIL, 54, 55, 56],
};

const facedIds = new Map();
for (const [base, ids] of Object.entries(FACED)) ids.forEach((id, facing) => facedIds.set(id, { base: Number(base), facing }));

// The id to place for a faced block (its base id) facing `facing`; other blocks as is.
export function facedBlock(base, facing) {
  return FACED[base]?.[facing] ?? base;
}

// { base, facing } for any id (facing 0 for blocks without a front).
export function blockBase(id) {
  return facedIds.get(id) ?? { base: id, facing: 0 };
}

export function isFurnace(id) {
  return blockBase(id).base === BLOCK.FURNACE;
}

export function isChest(id) {
  return blockBase(id).base === BLOCK.CHEST;
}

export function isAnvil(id) {
  return blockBase(id).base === BLOCK.ANVIL;
}

// Unit X/Z steps for each facing.
export const FACING_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Facing of the axis direction (dx, dz), which must be one of FACING_DIRS.
export function facingOf(dx, dz) {
  return FACING_DIRS.findIndex(([x, z]) => x === dx && z === dz);
}

export function ladderBlock(facing) {
  return BLOCK.LADDER + facing;
}

export function isLadder(id) {
  return id >= BLOCK.LADDER && id < BLOCK.LADDER + 4;
}

// Ladders and rope: no gravity while overlapping one, and climbable up and down.
export function isClimbable(id) {
  return isLadder(id) || id === BLOCK.ROPE;
}

export function ladderFacing(id) {
  return id - BLOCK.LADDER;
}

export function doorBlock(facing, open, upper) {
  return BLOCK.DOOR + facing + (open ? 4 : 0) + (upper ? 8 : 0);
}

export function isDoor(id) {
  return id >= BLOCK.DOOR && id < BLOCK.DOOR + 16;
}

export function doorState(id) {
  const n = id - BLOCK.DOOR;
  return { facing: n & 3, open: (n & 4) !== 0, upper: (n & 8) !== 0 };
}

const defs = [];

function define(id, name, props) {
  defs[id] = {
    id,
    name,
    solid: true,
    transparent: false,
    color: 0xff00ff,
    breakable: true,
    hardness: 1,
    breakTime: 0.75,
    tileEntity: null,
    drops: id,
    shape: null,
    ...props,
  };
}

define(BLOCK.AIR, 'air', { solid: false, transparent: true, color: 0x000000, breakable: false, hardness: 0 });
define(BLOCK.GRASS, 'grass', { color: 0x5da83a, breakTime: 0.6 });
define(BLOCK.DIRT, 'dirt', { color: 0x8a5a36, breakTime: 0.5 });
define(BLOCK.STONE, 'stone', { color: 0x8a8a8a, hardness: 2, breakTime: 1.5 });
define(BLOCK.STONE_BRICKS, 'stone bricks', { color: 0x92918d, hardness: 4, breakTime: 1.5 });
define(BLOCK.MOSSY_STONE_BRICKS, 'mossy stone bricks', { color: 0x778a70, hardness: 4, breakTime: 1.5 });
define(BLOCK.CRACKED_STONE_BRICKS, 'cracked stone bricks', { color: 0x858480, hardness: 4, breakTime: 1.5 });
define(BLOCK.WATER, 'water', { solid: false, transparent: true, color: 0x3a6fd8, breakable: false, hardness: 0 });
for (let level = 1; level <= 7; level++) {
  define(BLOCK.WATER_FLOW_1 + level - 1, 'flowing water', {
    solid: false, transparent: true, color: 0x3a6fd8, breakable: false, hardness: 0, drops: null,
  });
}
// Keeps are built by world gen around each flag. No tool is strong enough.
define(BLOCK.KEEP, 'keep', { color: 0x4b5263, hardness: Infinity });
define(BLOCK.PEDESTAL, 'pedestal', { color: 0xd4af37, hardness: Infinity });
define(BLOCK.WOOD, 'wood', { color: 0x6b4a2b, breakTime: 1 });
define(BLOCK.LEAVES, 'leaves', { color: 0x3f8f3a, breakTime: 0.2, drops: null });
define(BLOCK.SAPLING, 'sapling', { color: 0x50a346, solid: false, transparent: true,
  breakTime: 0.15, drops: ITEM.TREE_SEED, shape: 'sapling' });
define(BLOCK.PLANKS, 'planks', { color: 0xb58a55, breakTime: 0.8 });
define(BLOCK.IRON_ORE, 'iron ore', { color: 0xb88a6a, hardness: 3, breakTime: 2 });
define(BLOCK.SAND, 'sand', { color: 0xdccf8e, breakTime: 0.5 });
// Right click opens a crafting screen. Transparent: the table is inset from its cell.
define(BLOCK.WORKBENCH, 'workbench', { color: 0xa0703f, breakTime: 1, shape: 'workbench', transparent: true });
// Furnaces and chests have their own inventory (server/containers.js);
// breaking one drops what's inside.
for (const id of FACED[BLOCK.FURNACE]) {
  define(id, 'furnace', {
    color: 0x6e6e72, hardness: 2, breakTime: 1.5, tileEntity: 'furnace', shape: 'furnace', drops: BLOCK.FURNACE,
  });
}
for (const id of FACED[BLOCK.CHEST]) {
  define(id, 'chest', {
    color: 0x9c6b30, breakTime: 1, tileEntity: 'chest', shape: 'chest', transparent: true, drops: BLOCK.CHEST,
  });
}
// Thin shapes: neighbours draw their faces against them (transparent).
for (let facing = 0; facing < 4; facing++) {
  define(ladderBlock(facing), 'ladder', {
    solid: false, transparent: true, shape: 'ladder', color: 0x9a6b3c, breakTime: 0.4, drops: ITEM.LADDER,
  });
  for (const open of [false, true]) {
    for (const upper of [false, true]) {
      // Breaking either half drops one door; the server handles the pair.
      define(doorBlock(facing, open, upper), 'door', {
        solid: !open, transparent: true, shape: 'door', color: 0x8b5a2b, breakTime: 0.6, drops: ITEM.DOOR,
      });
    }
  }
}

// Anvils hold one item to reroll its modifiers (server/containers.js). The
// horn points the way the front faces.
for (const id of FACED[BLOCK.ANVIL]) {
  define(id, 'anvil', {
    color: 0x3b3d42, hardness: 2, breakTime: 2, tileEntity: 'anvil', shape: 'anvil', transparent: true, drops: BLOCK.ANVIL,
  });
}
define(BLOCK.SCORCHED_EARTH, 'scorched earth', { color: 0x3a2f29, breakTime: 0.5, drops: BLOCK.DIRT });

// Rope breaks in one tick and leaves nothing behind.
define(BLOCK.ROPE, 'rope', {
  solid: false, transparent: true, shape: 'rope', color: 0xb89a62, breakTime: 0, drops: null,
});

export function getBlockDef(id) {
  return defs[id] ?? defs[BLOCK.AIR];
}

export function isSolid(id) {
  return getBlockDef(id).solid;
}

export function isTransparent(id) {
  return getBlockDef(id).transparent;
}

// Blocks the crosshair stops on: anything you can collide with or mine.
export function isTargetable(id) {
  const def = getBlockDef(id);
  return def.solid || def.breakable || isWater(id);
}

// Ticks the break button must be held on a block before it breaks, with a
// tool of the given speed (shared/tools.js; hands are 1).
export function breakTicks(id, speed = 1) {
  return Math.max(1, Math.round((getBlockDef(id).breakTime * TICK_RATE) / speed));
}

export function canBreak(id, toolStrength) {
  const def = getBlockDef(id);
  return def.breakable && toolStrength >= def.hardness;
}
