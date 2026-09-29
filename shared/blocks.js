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
//                  ('ladder', 'door', 'workbench', 'furnace', 'chest', 'rope', 'anvil', 'sapling', 'branch')
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

import { TICK_RATE, GOBLIN_GEN, LIGHTING, WORLD_LOOK, VEGETATION, TREE_SETTINGS } from './config.js';
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
  QUARRY_STONE: 58,
  // IDs 59 (snow) and 61 (fence) remain reserved.
  GOBLIN_BRICKS: 60,
  REINFORCED_DOOR: 62,
  ARROW_TURRET: 78,
  POISON_TRAP: 79, // 79–82: preserve the historical facing range.
  MUSHROOM: 83,
  TORCH: 84, // 84 floor, 85–88 wall attachments.
  GRASS_TUFT: 89, FERN: 90, RED_FLOWER: 91, BLUE_FLOWER: 92, GOLD_FLOWER: 93,
  BUSH: 94, GLOW_FLOWER: 95, GLOW_MOSS: 96, GLOW_MUSHROOM: 97,
  ROOT: 98, DARK_ROOT: 99, VINE: 100, BUD_VINE: 101,
  BRANCH: 102,
  // The Ancient Lightning Monkey's cloud. Kept clear of the plant range above.
  STORM_CLOUD: 120,
  GLASS: 121,
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
  [BLOCK.POISON_TRAP]: [79, 80, 81, 82],
  [BLOCK.FURNACE]: [BLOCK.FURNACE, 38, 39, 40],
  [BLOCK.CHEST]: [BLOCK.CHEST, 35, 36, 37],
  [BLOCK.ANVIL]: [BLOCK.ANVIL, 54, 55, 56],
};

FACED[BLOCK.TORCH] = [85, 86, 87, 88];
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

export const LADDER_DEPTH = 0.07;
// Bounds of the thin attached panel in block-local coordinates. The facing
// points from the ladder cell toward its support, just as player placement does.
export function ladderBounds(id) {
  switch (ladderFacing(id)) {
    case 0: return [0.1, 0, 0, 0.9, 1, LADDER_DEPTH];
    case 1: return [1-LADDER_DEPTH, 0, 0.1, 1, 1, 0.9];
    case 2: return [0.1, 0, 1-LADDER_DEPTH, 0.9, 1, 1];
    case 3: return [0, 0, 0.1, LADDER_DEPTH, 1, 0.9];
  }
}

// Unsupported ladders cannot provide footing or vertical navigation edges.
export function climbableBlockAt(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (isLadder(id)) {
    const [dx, dz] = FACING_DIRS[ladderFacing(id)];
    return isSolid(world.getBlock(x+dx, y, z+dz)) ? id : BLOCK.AIR;
  }
  return id === BLOCK.ROPE ? id : BLOCK.AIR;
}

export function doorBlock(facing, open, upper, reinforced = false) {
  return (reinforced ? BLOCK.REINFORCED_DOOR : BLOCK.DOOR) + facing + (open ? 4 : 0) + (upper ? 8 : 0);
}

export function isDoor(id) {
  return id >= BLOCK.DOOR && id < BLOCK.DOOR + 16
    || id >= BLOCK.REINFORCED_DOOR && id < BLOCK.REINFORCED_DOOR + 16;
}

export function doorState(id) {
  const reinforced = id >= BLOCK.REINFORCED_DOOR && id < BLOCK.REINFORCED_DOOR + 16;
  const n = id - (reinforced ? BLOCK.REINFORCED_DOOR : BLOCK.DOOR);
  return { facing: n & 3, open: (n & 4) !== 0, upper: (n & 8) !== 0, reinforced };
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
    support: null,
    emission: 0,
    blocksAttack: true,
    lightOpaque: props.solid !== false && !props.transparent,
    ...props,
  };
}

for (const id of [BLOCK.TORCH, ...FACED[BLOCK.TORCH]]) define(id, 'torch', {
  solid: false, transparent: true, lightOpaque: false, emission: LIGHTING.torchEmission,
  support: id === BLOCK.TORCH ? [0,-1,0] : [FACING_DIRS[FACED[BLOCK.TORCH].indexOf(id)][0],0,FACING_DIRS[FACED[BLOCK.TORCH].indexOf(id)][1]],
  shape: 'torch', color: 0xffc05a, icon: '/textures/torch.svg', drops: BLOCK.TORCH, breakTime: 0.2,
});

export const VEGETATION_IDS = [BLOCK.MUSHROOM, BLOCK.GRASS_TUFT, BLOCK.FERN, BLOCK.RED_FLOWER,
  BLOCK.BLUE_FLOWER, BLOCK.GOLD_FLOWER, BLOCK.BUSH, BLOCK.GLOW_FLOWER, BLOCK.GLOW_MOSS,
  BLOCK.GLOW_MUSHROOM, BLOCK.ROOT, BLOCK.DARK_ROOT, BLOCK.VINE, BLOCK.BUD_VINE];
const plantKinds = ['mushroom', 'tuft', 'fern', 'red-flower', 'blue-flower', 'gold-flower', 'bush',
  'glow-flower', 'glow-moss', 'glow-mushroom', 'root', 'dark-root', 'vine', 'bud-vine'];
VEGETATION_IDS.forEach((id, i) => {
  const art = plantKinds[i], hanging = i >= 10;
  const heightKey = hanging ? 'hanging' : art.includes('flower') ? 'flower'
    : art.includes('mushroom') ? 'mushroom' : art === 'glow-moss' ? 'moss' : art;
  const emission = art === 'glow-flower' ? VEGETATION.emission.flower : art === 'glow-moss' ? VEGETATION.emission.moss
    : art === 'glow-mushroom' ? VEGETATION.emission.mushroom : art === 'bud-vine' ? VEGETATION.emission.buds : 0;
  define(id, art.replaceAll('-', ' '), { solid: false, transparent: true, lightOpaque: false,
    blocksAttack: false, hardness: 0, breakTime: 0, shape: 'plant', plantArt: art, hanging,
    support: hanging ? [0,1,0] : null,
    plantHeight: VEGETATION.heights[heightKey], emission, color: 0xffffff, icon: `/textures/${art}.svg` });
});
define(BLOCK.AIR, 'air', { solid: false, transparent: true, color: 0x000000, breakable: false, hardness: 0 });
define(BLOCK.GRASS, 'grass', { color: WORLD_LOOK.grass, breakTime: 0.6, drops: BLOCK.DIRT });
define(BLOCK.DIRT, 'dirt', { color: 0x8a5a36, breakTime: 0.5 });
define(BLOCK.STONE, 'stone', { color: 0x8a8a8a, hardness: 2, breakTime: 1.5 });
define(BLOCK.GOBLIN_BRICKS, 'goblin bricks', { color: 0x657258, hardness: GOBLIN_GEN.brickHardness, breakTime: GOBLIN_GEN.brickBreakTime });
for (const id of FACED[BLOCK.POISON_TRAP]) define(id, 'hidden poison shooter', { color: 0x657258, hardness: GOBLIN_GEN.brickHardness, breakTime: GOBLIN_GEN.brickBreakTime, drops: BLOCK.GOBLIN_BRICKS });
define(BLOCK.QUARRY_STONE, 'quarry stone', { color: 0x343b42, hardness: 8, breakTime: 4 });
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
define(BLOCK.BRANCH, 'branch', { color: 0x6b4a2b, breakTime: TREE_SETTINGS.branchBreakTime,
  transparent: true, lightOpaque: false, shape: 'branch', icon: '/textures/branch.svg' });
define(BLOCK.LEAVES, 'leaves', { color: WORLD_LOOK.leaves, breakTime: 0.2, drops: null });
define(BLOCK.SAPLING, 'sapling', { color: 0x50a346, solid: false, transparent: true,
  breakTime: 0.15, drops: ITEM.TREE_SEED, shape: 'sapling' });
define(BLOCK.PLANKS, 'planks', { color: 0xb58a55, breakTime: 0.8 });
define(BLOCK.IRON_ORE, 'iron ore', { color: 0xb88a6a, hardness: 3, breakTime: 2 });
define(BLOCK.GLASS, 'glass', { color: 0xc9edf5, transparent: true, lightOpaque: false,
  hardness: 1, breakTime: 0.4, icon: '/textures/glass.svg' });
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
        solid: !open, transparent: true, lightOpaque: !open, shape: 'door', color: 0x8b5a2b, breakTime: 0.6, drops: ITEM.DOOR,
      });
      define(doorBlock(facing, open, upper, true), 'reinforced door', {
        solid: !open, transparent: true, lightOpaque: !open, shape: 'door', color: 0xa5a8ac,
        hardness: 4, breakTime: 2, drops: ITEM.REINFORCED_DOOR,
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
define(BLOCK.ARROW_TURRET, 'arrow turret', { color: 0x85888c, hardness: 3, breakTime: 2 });
// Dark, soft and solid: players can stand on it and dig through it by hand.
// Daylight seeps through it, so its hollow inside isn't pitch black.
define(BLOCK.STORM_CLOUD, 'storm cloud', { color: 0x4d5059, breakTime: 0.35, lightOpaque: false });

// Rope breaks in one tick and leaves nothing behind.
define(BLOCK.ROPE, 'rope', {
  solid: false, transparent: true, shape: 'rope', color: 0xb89a62, breakTime: 0, drops: null,
});

export function getBlockDef(id) {
  return defs[id] ?? defs[BLOCK.AIR];
}

// Enumerate the actual registry, including air and encoded block variants.
export function registeredBlockIds() { return defs.filter(Boolean).map(d => d.id); }
export function creativeBlockIds() { return registeredBlockIds(); }

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

// Mining still targets decorations; combat rays explicitly pass through them.
export function blocksAttack(id) { return isTargetable(id) && !isWater(id) && getBlockDef(id).blocksAttack; }

export const TREE_SIDES = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export function isTreeSupport(id) { return id === BLOCK.WOOD || id === BLOCK.BRANCH || id === BLOCK.LEAVES; }
export function isDecayingTreeBlock(id) { return id === BLOCK.LEAVES || id === BLOCK.BRANCH; }
// Cache all neighbour masks once. Physics, raycasts and meshing use the same
// disjoint boxes: a square core plus up to six arms, with no hidden cube.
const branchShapes = Array.from({ length: 64 }, (_, mask) => {
  const lo = (1 - TREE_SETTINGS.branchWidth) / 2, hi = 1 - lo;
  const boxes = [[lo,lo,lo,hi,hi,hi]];
  boxes[0].hiddenFaces=0;
  TREE_SIDES.forEach((side, i) => {
    if (!(mask & (1 << i))) return;
    const box = [lo,lo,lo,hi,hi,hi], axis = side.findIndex(v => v !== 0);
    if (side[axis] > 0) { box[axis] = hi; box[axis+3] = 1; }
    else { box[axis] = 0; box[axis+3] = lo; }
    box.hiddenFaces=1<<i;
    boxes[0].hiddenFaces |= 1<<(i^1);
    boxes.push(box);
  });
  return boxes;
});
export function branchBoxes(world, x, y, z) {
  let mask = 0;
  TREE_SIDES.forEach(([dx,dy,dz], i) => {
    if (isTreeSupport(world.getBlock(x+dx,y+dy,z+dz))) mask |= 1 << i;
  });
  return branchShapes[mask];
}
