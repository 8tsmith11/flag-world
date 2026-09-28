// Sound choices are data. Encoded block variants inherit their base material.
import { BLOCK, blockBase, getBlockDef, isLadder, isDoor, isWater } from './blocks.js';
export const SOUND_MATERIALS = {
  grass: [BLOCK.GRASS, BLOCK.LEAVES, BLOCK.SAPLING],
  dirt: [BLOCK.DIRT, BLOCK.SCORCHED_EARTH],
  stone: [BLOCK.STONE, BLOCK.IRON_ORE, BLOCK.KEEP, BLOCK.QUARRY_STONE, BLOCK.FURNACE, BLOCK.ANVIL],
  wood: [BLOCK.BRANCH, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.WORKBENCH, BLOCK.CHEST, BLOCK.ROPE, BLOCK.TORCH, BLOCK.ARROW_TURRET],
  sand: [BLOCK.SAND, BLOCK.STORM_CLOUD],
  brick: [BLOCK.STONE_BRICKS, BLOCK.MOSSY_STONE_BRICKS, BLOCK.CRACKED_STONE_BRICKS, BLOCK.GOBLIN_BRICKS, BLOCK.POISON_TRAP],
};
const materialById = new Map(Object.entries(SOUND_MATERIALS).flatMap(([material, ids]) => ids.map(id => [id, material])));
export function soundMaterial(id) {
  if (isWater(id)) return 'water';
  if (getBlockDef(id).shape === 'plant') return 'grass';
  if (isDoor(id) || isLadder(id)) return 'wood';
  return materialById.get(blockBase(id).base) ?? 'stone';
}
const file = name => `/audio/game/${name}.ogg`;
export const AMBIENT_SOUNDS = Object.fromEntries(['wind', 'birds', 'crickets', 'fortress', 'river', 'waterfall'].map(name => [name, file(name)]));
export const MATERIAL_SOUNDS = Object.fromEntries(['grass', 'dirt', 'stone', 'wood', 'sand', 'brick'].map(material => [material,
  { step: [file(`step-${material}`)], break: [file(`break-${material}`)], place: [file(`place-${material}`)] }]));
export const EFFECT_SOUNDS = { splash: [file('splash')], landing: [file('landing')] };
export const MOB_SOUNDS = {
  cow: { idle: [file('cow-moo')], hurt: [file('cow-hurt')], death: [file('cow-death')] },
  dragon: { wing: [file('dragon-wing')], attack: [file('dragon-roar')], hurt: [file('dragon-hurt')], death: [file('dragon-death')] },
};
// Ancient Monkeys (pre-pitched down in the files) and the storm cloud.
export const MONKEY_SOUNDS = {
  grunt: [file('monkey-grunt-1'), file('monkey-grunt-2'), file('monkey-grunt-3')],
  huff: [file('monkey-huff')], rumble: [file('monkey-rumble')],
  chestBeat: [file('monkey-chest-beat')], roar: [file('monkey-roar')],
};
export const STORM_SOUNDS = { thunder: [file('thunder')] };
