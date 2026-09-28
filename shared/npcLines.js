// What NPCs say, as data (see dialogue.js for conditions and voices).
//
// Wise Monkeys, to their own team: hints follow the main tech tree; the
// monkey speaks from the first hint whose `done` condition isn't met, or
// `complete` once all are. Now and then (DIALOGUE.clueChance) it gives a
// clue about the world instead, from those whose `when` is met. Players of
// other teams only get `strangers`. Lines never name places, positions,
// enemy keeps, creative mode or recipes a team can't already see.
//
// Ancient Monkeys only make sounds: each response names a sound in
// MONKEY_SOUNDS (audio.js) and the subtitles describing it.

import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';

const HAMMERS = [ITEM.WOOD_HAMMER, ITEM.STONE_HAMMER, ITEM.IRON_HAMMER];
const WEAPONS = [ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.IRON_SWORD, ITEM.BOW];
const ARMOR = [ITEM.LEATHER_ARMOR, ITEM.IRON_ARMOR, ITEM.DRAGONSCALE_ARMOR];
// Crafted, or placed (blocks from loot or trades count too).
const made = (...ids) => ({ any: [{ crafted: ids }, { placed: ids }] });

export const WISE_MONKEY_HINTS = [
  { id: 'wood', done: { obtained: [BLOCK.WOOD] }, lines: [
    'Every tower was once a tree. Begin with wood.',
    'Strike a tree with open hands. The wood will come.',
  ] },
  { id: 'workbench', done: made(BLOCK.WORKBENCH), lines: [
    'Wood becomes planks. Planks become a bench to work upon.',
    'Hands make little. A workbench makes much.',
  ] },
  { id: 'hammer', done: { crafted: HAMMERS }, lines: [
    'Wood becomes tools. Tools become more.',
    'Make a hammer at the bench. Stone does not yield to bare hands.',
  ] },
  { id: 'stone', done: { obtained: [BLOCK.STONE] }, lines: [
    'Beneath the grass lies stone. Your hammer knows the way down.',
    'Dig. Stone waits patiently under every field.',
  ] },
  { id: 'stoneHammer', done: { crafted: [ITEM.STONE_HAMMER, ITEM.IRON_HAMMER] }, lines: [
    'A stone hammer breaks what a wooden one cannot.',
    'Stronger hammers open stronger things. Make one of stone.',
  ] },
  { id: 'weapon', done: { crafted: WEAPONS }, lines: [
    'Others will come for your flag. Carry a blade, or a bow.',
    'Peace is kept by those who could break it. Make a weapon.',
  ] },
  { id: 'furnace', done: made(BLOCK.FURNACE), lines: [
    'Stone, shaped at the bench, becomes a furnace. Fire changes things.',
    'Build a furnace. What is raw, fire makes useful.',
  ] },
  { id: 'ironOre', done: { obtained: [BLOCK.IRON_ORE, ITEM.IRON_INGOT] }, lines: [
    'Look for stone with rusty veins. Iron sleeps inside.',
    'Iron hides in the rock, often where caves meet the air.',
  ] },
  { id: 'ironIngot', done: { obtained: [ITEM.IRON_INGOT] }, lines: [
    'Ore above, fuel below, and patience. The furnace gives you iron.',
    'Raw iron is only a stone. Fire it.',
  ] },
  { id: 'ironHammer', done: { crafted: [ITEM.IRON_HAMMER] }, lines: [
    'An iron hammer. Then little will stand in your way.',
    'Iron in the head of a hammer. The hardest stone will listen.',
  ] },
  { id: 'armor', done: { any: [{ crafted: ARMOR }, { obtained: ARMOR }] }, lines: [
    'Skin is thin. Wear leather, or better, iron.',
    'The cows give leather. Leather gives you a second skin.',
  ] },
  { id: 'turret', done: made(BLOCK.ARROW_TURRET), lines: [
    'A turret watches when you cannot. Give your keep one.',
    'Iron can guard your flag while you sleep. Build a turret.',
  ] },
  { id: 'reinforcedDoor', done: made(ITEM.REINFORCED_DOOR), lines: [
    'An iron door opens only for its own.',
    'Wood lets anyone in. Iron remembers who you are.',
  ] },
  { id: 'dragonScale', done: { obtained: [ITEM.DRAGON_SCALE] }, lines: [
    'Dragons wear the finest armor. Take it from them.',
    'The dragon\'s scales turn fire. Earn them.',
  ] },
];

export const WISE_MONKEY_COMPLETE = [
  'I have taught you what I know. Now protect what is yours.',
  'There is nothing more I can show you. Go, and win.',
];

export const WISE_MONKEY_CLUES = [
  { id: 'goblins', lines: [
    'The goblins keep to the low country, where the land sinks.',
    'In the lowlands, small hands build high walls.',
  ] },
  { id: 'gorge', when: { feature: 'gorgeCave' }, lines: [
    'The river in the gorge does not end. It runs on beneath the earth.',
    'Follow the gorge water where the light cannot.',
  ] },
  { id: 'forest', lines: [
    'The Ancient Forest hides old things among its roots.',
    'Old trees remember. Walk softly in the Ancient Forest.',
  ] },
  { id: 'center', lines: [
    'The center of the world is waiting.',
    'Something at the heart of the world is waiting. Not yet.',
  ] },
  { id: 'storm', when: { feature: 'stormCloud' }, lines: [
    'Something sits in the storm above the mountains.',
    'Look past the high peaks. That storm is not empty.',
  ] },
];

export const WISE_MONKEY_STRANGERS = [
  'You are not mine to teach.',
  'Go home, little one.',
  'Hm.',
  'I have nothing for you.',
];

export const ANCIENT_MONKEY_RESPONSES = [
  { sound: 'grunt', lines: ['*a deep, rumbling grunt*', '*a low grunt*'] },
  { sound: 'huff', lines: ['*a heavy huff*', '*a snort through wide nostrils*'] },
  { sound: 'rumble', lines: ['*a long rumble, deep in its chest*'] },
];
