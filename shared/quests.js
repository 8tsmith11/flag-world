// The Wise Monkey's quest book, as data: chapters and the quests placed on
// each chapter's graph. Design rules for chapters and quests are in
// CLAUDE.md / AGENTS.md ("Quest book design rules"); follow them when adding
// or changing anything here.
//
// Chapters are stages of technological development or discovery, unnumbered
// and with no fixed order:
//   unlock: null                 open from the start
//   unlock: { goal, text }       opens for a team the first time its progress
//                                meets the goal (shown locked, with text)
//   unlock: { discovery: true, goal?, text }
//                                hidden until the team meets the goal or any
//                                goal or reveal of one of the chapter's own
//                                quests (unlockGoal below)
// A chapter stays unlocked once opened. Add a stage by appending a chapter and
// giving quests its id; nothing else needs to change.
//
// regions: labelled boxes on the chapter's graph (grid cells x0..x1, y0..y1)
// grouping related quests.
//
// Quests: x, y are grid cells on the chapter's graph.
//   deps   prerequisites, all in the same chapter. A quest becomes available
//          once its chapter is unlocked and its deps are done, and only then
//          completes. Use them only for a real technological step.
//   links  related quests in the same chapter: drawn as dashed lines, never
//          required.
//   goal   what completes it (below); reward (optional, small) is claimed
//          once per team; text is the knowledge entry explaining the mechanic.
//   hidden shown as "???" until a dependency is done, its `reveal` goal is met
//          or it's complete, to keep secrets and legendary things a mystery.
//
// The book is a guide, not a lock: every recipe, item and mechanic works
// whether or not its quest or chapter is available. Progress is per team
// (server/teamProgress.js) and is always recorded, hidden chapters included,
// so a goal met before its quest or chapter is available completes it the
// moment it becomes available.
//
// Goals:
//   { obtained: [ids] }  any of these has been in a member's inventory
//   { crafted: [ids] } / { placed: [ids] }
//   { event: 'name', count }  a milestone happened (count times)
//   { all: [goals] } / { any: [goals] }
import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { RECIPES } from './recipes.js';
import { METALS, FLUID, MERCHANT, MONKEY_DUTY, REINFORCED_WALL, SMELT_TIME, FLAG_GRAB_TIME, FLAG_CAPTURE_TIME,
  SAPLING_DROP_CHANCE, TURRET, FLAG_RETURN_TIME, EXPLOSIVES, SPIKES, DRAWBRIDGE, FARMING, FISHING } from './config.js';
import { ROD_STATS, BAIT } from './fishing.js';
import { MODIFIERS } from './modifiers.js';
import { MERCHANT_SELLS } from './merchant.js';

const obtained = (...ids) => ({ obtained: ids });
const crafted = (...ids) => ({ crafted: ids });
const made = (...ids) => ({ any: [{ crafted: ids }, { placed: ids }] });
const event = (name, count = 1) => ({ event: name, count });
const anyEvent = (prefix, ids) => ({ any: ids.map((id) => event(`${prefix}:${id}`)) });
const coins = (count) => [{ item: ITEM.GOLD_COIN, count }];
const region = (label, x0, y0, x1, y1) => ({ label, x0, y0, x1, y1 });
const SULFUR_OFFER = MERCHANT_SELLS.find((o) => o.item === ITEM.SULFUR_SEEDS);
const ACCESSORY_ITEMS = [ITEM.WIND_BOOTS, ITEM.SPRING_BOOTS, ITEM.HEART_AMULET, ITEM.MENDING_CHARM, ITEM.EMBER_HEART, ITEM.DRAGON_CROWN];
// Bronze ingots and everything crafted from them.
const BRONZE_GOODS = [ITEM.BRONZE_INGOT,
  ...new Set(RECIPES.filter((r) => r.inputs.some((i) => i.item === ITEM.BRONZE_INGOT)).map((r) => r.output))];

export const CHAPTERS = [
  { id: 'adventure', name: 'A Brand New Adventure', icon: BLOCK.WOOD, unlock: null,
    regions: [region('Tools and building', 0, 0, 4, 1), region('Metalworking', 5, 1, 7, 2), region('Food and farming', 8, 1, 9, 1),
      region('Keep and combat', 0, 3, 2, 4), region('Iron and defenses', 3, 3, 6, 4),
      region('Monkeys', 0, 5, 4, 7), region('The Sky Merchant', 6, 5, 8, 7), region('Exploration and creatures', 0, 8, 5, 10),
      region('Explosives', 7, 8, 10, 10), region('Fishing', 8, 3, 11, 4)],
    intro: 'Everything you can do with wood, stone, copper, tin and iron: tools and buildings, your keep and flag, monkeys and their jobs, furnaces, fights and defenses, explosives, the Sky Merchant, and the islands around you.' },
  { id: 'business', name: 'Monkey Business', icon: ITEM.BRONZE_INGOT,
    unlock: { goal: obtained(ITEM.BRONZE_INGOT), text: 'Unlocks when anyone on your team first holds a bronze ingot (made in an Alloy Furnace).' },
    regions: [region('Bronze', 0, 0, 2, 1), region('Steam power', 0, 3, 3, 4), region('Industry', 5, 1, 6, 3), region('Fishing', 5, 5, 6, 5)],
    intro: 'What bronze makes possible: bronze tools and iron mining, pumps, pipes, boilers, crushers and steam drawbridges, and monkey-run industry that feeds machines, works metal and sells it.' },
  { id: 'beyond', name: 'Beyond the Island', icon: ITEM.DRAGON_SCALE,
    unlock: { discovery: true, goal: event('encounter:dragon'), text: 'Found by discovering something remarkable out in the world.' },
    regions: [region('The fire island', 0, 0, 2, 0), region('Dragons', 4, 0, 5, 0), region('Treasures', 7, 1, 7, 1),
      region('The frozen island', 0, 2, 1, 2), region('Ancient Monkeys', 3, 2, 5, 2), region('The deep void', 7, 3, 7, 3)],
    intro: 'Far islands, ancient secrets, dragons and the treasures they guard.' },
];

export const QUESTS = [
  // ======== A Brand New Adventure ========

  // ---- Tools and building ----
  { id: 'wise', chapter: 'adventure', x: 0, y: 0, icon: ITEM.WISE_MONKEY_EGG, title: 'The Wise Monkey', goal: event('meet:wiseMonkey'),
    text: ['Right click your team\'s Wise Monkey, on his shrine on your island, to open this book. Quests complete by themselves when anyone on your team does what they ask, and they count what you did before you read them.',
      'A reward can be claimed once for the whole team, by whoever presses Claim first while standing near me.',
      'Quests joined by a solid line need the earlier quest done first; dashed lines only mark related quests. Nothing here locks a recipe or an item: you can always craft and use anything you have the materials for.',
      'The book has more than one chapter. Monkey Business opens for your whole team as soon as any of you holds a bronze ingot, whether or not this chapter is finished. Other chapters stay hidden until your team stumbles onto something remarkable out in the world.'] },
  { id: 'wood', chapter: 'adventure', x: 0, y: 1, icon: BLOCK.WOOD, title: 'Wood', goal: obtained(BLOCK.WOOD),
    text: ['Hold left click on a tree trunk to break it. Bare hands are enough for wood, dirt, sand and leaves.',
      `Breaking a block drops it as an item; walk over it to pick it up. Leaves drop a sapling ${Math.round(SAPLING_DROP_CHANCE * 100)}% of the time: plant it on grass or dirt to grow a new tree.`] },
  { id: 'planks', chapter: 'adventure', x: 1, y: 1, deps: ['wood'], icon: BLOCK.PLANKS, title: 'Planks', goal: crafted(BLOCK.PLANKS),
    text: ['Press E to open your inventory. Its crafting list shows every recipe your team has found an ingredient for.',
      'One wood makes four planks. Planks make torches, ladders, a workbench and more.'] },
  { id: 'light', chapter: 'adventure', x: 1, y: 0, deps: ['planks'], icon: BLOCK.TORCH, title: 'Light', goal: made(BLOCK.TORCH),
    text: ['One plank makes four torches, no workbench needed. Place them on floors or walls to light caves and nights.',
      'Nights are dark but short.'] },
  { id: 'workbench', chapter: 'adventure', x: 2, y: 1, deps: ['planks'], icon: BLOCK.WORKBENCH, title: 'Workbench', goal: made(BLOCK.WORKBENCH),
    reward: [{ item: BLOCK.TORCH, count: 8 }],
    text: ['Craft a workbench from 4 planks and place it with right click. Right click the workbench to use it.',
      'Most tools, weapons, machines and armor can only be crafted at a workbench.'] },
  { id: 'chests', chapter: 'adventure', x: 2, y: 0, deps: ['workbench'], icon: BLOCK.CHEST, title: 'Chests and Sorting', goal: made(BLOCK.CHEST),
    text: ['A chest (8 planks, at a workbench) holds 27 stacks. Shift-click moves stacks between it and your inventory.',
      'The Sort buttons merge partial stacks and group identical items: on your inventory it sorts the main grid (your hotbar stays as it is); on a chest, the whole chest.'] },
  { id: 'hammer', chapter: 'adventure', x: 3, y: 1, deps: ['workbench'], icon: ITEM.WOOD_HAMMER, title: 'Hammers',
    goal: crafted(ITEM.WOOD_HAMMER, ITEM.STONE_HAMMER),
    text: ['Hammers are the only breaking tools. A block can only be broken by a hammer whose strength is at least the block\'s hardness, and better hammers break faster.',
      'Wood hammer (3 planks, 2 wood): strength 2. Stone hammer (3 stone, 2 wood): strength 3, breaks copper and tin ore. Bronze: 4 (iron ore). Iron: 5 (stone bricks, reinforced walls).'] },
  { id: 'stone', chapter: 'adventure', x: 4, y: 1, deps: ['hammer'], icon: BLOCK.STONE, title: 'Stone', goal: obtained(BLOCK.STONE),
    text: ['Stone needs a wooden hammer or better. Look under the grass, in cliffs, or in caves.',
      'Quarry Stones (dark blocks with glowing seams) regrow stone on their open faces every few seconds: mine around them for an endless supply.'] },
  { id: 'doors', chapter: 'adventure', x: 3, y: 0, deps: ['workbench'], links: ['bricks'], icon: ITEM.DOOR, title: 'Doors', goal: made(ITEM.DOOR),
    text: ['A door (6 planks, at a workbench) is two blocks tall; right click to open or close it. Anyone can open a wooden door.',
      'A reinforced door (6 iron ingots) only opens for the team that placed it; see Reinforced Doors.'] },
  { id: 'bricks', chapter: 'adventure', x: 4, y: 0, deps: ['stone'], icon: BLOCK.STONE_BRICKS, title: 'Stone Bricks', goal: crafted(BLOCK.STONE_BRICKS),
    text: ['One stone makes one stone brick, anywhere. Stone bricks need an iron hammer (strength 5) to break, so they make strong walls around your keep.',
      'Raiders with stone or bronze hammers can\'t dig through them; they have to find a door or a gap.'] },

  // ---- Metalworking ----
  { id: 'furnace', chapter: 'adventure', x: 5, y: 1, deps: ['stone'], icon: BLOCK.FURNACE, title: 'Furnace', goal: made(BLOCK.FURNACE),
    text: ['A furnace (8 stone, at a workbench) smelts ore into ingots, sand into glass, wood into charcoal and beef into cooked beef.',
      `Put what to smelt in the top slot and fuel in the bottom slot; each item takes ${SMELT_TIME} seconds. Charcoal smelts 8 items, wood 2, planks 1, a lava bucket many more.`,
      'Its screen shows what it is doing and why it stopped (missing fuel, output full...). Take results from the output slot.'] },
  { id: 'copper', chapter: 'adventure', x: 6, y: 1, deps: ['furnace'], icon: ITEM.COPPER_INGOT, title: 'Copper and Tin',
    goal: { all: [obtained(ITEM.COPPER_INGOT), obtained(ITEM.TIN_INGOT)] }, reward: [{ item: ITEM.CHARCOAL, count: 4 }],
    text: ['Copper ore is common on your island; tin ore is rare there but plentiful on the small islands. Both need a stone hammer.',
      'Smelt them into ingots in a furnace, or feed them straight into an Alloy Furnace.'] },
  { id: 'bucket', chapter: 'adventure', x: 6, y: 2, deps: ['copper'], icon: ITEM.EMPTY_BUCKET, title: 'Buckets', goal: obtained(ITEM.EMPTY_BUCKET),
    text: [`Craft a bucket from ${METALS.crafting.bucketCopper} copper ingot at a workbench. Right click water or lava with it to fill it, and right click a block with a full bucket to pour it out (you keep the empty bucket).`,
      'A lava bucket is the longest-burning fuel for furnaces, alloy furnaces and boilers; the machine hands the empty bucket back.'] },
  { id: 'alloy', chapter: 'adventure', x: 7, y: 1, deps: ['copper'], icon: BLOCK.ALLOY_FURNACE, title: 'Alloy Furnace',
    goal: made(BLOCK.ALLOY_FURNACE), reward: [{ item: ITEM.TIN_INGOT, count: 2 }],
    text: [`Build it from a furnace and ${METALS.crafting.alloyFurnaceCopper} copper ingots at a workbench. It has three ingredient slots, a fuel slot and an output.`,
      `${METALS.alloy.copper} copper and ${METALS.alloy.tin} tin make ${METALS.alloy.output} bronze ingots in ${METALS.alloy.seconds} seconds. Copper and tin count in any form: ore, dust or ingot each count as one, and you can mix them.`,
      'Its screen shows how much copper and tin it holds and what is missing. Your team\'s first bronze ingot opens the Monkey Business chapter of this book.'] },

  // ---- Food and farming ----
  { id: 'food', chapter: 'adventure', x: 8, y: 1, icon: ITEM.COOKED_BEEF, title: 'Food and Health', goal: obtained(ITEM.BEEF, ITEM.BREAD, ITEM.COOKED_BEEF),
    text: ['You heal slowly on your own a while after being hurt. Food heals faster: hold right click with food in hand while hurt.',
      'Cows drop beef and leather. Cook beef in a furnace for more healing. Wheat makes bread (3 wheat, no workbench).'] },
  { id: 'farming', chapter: 'adventure', x: 9, y: 1, links: ['food'], icon: ITEM.WHEAT, title: 'Farming', goal: obtained(ITEM.WHEAT),
    reward: [{ item: ITEM.WHEAT_SEEDS, count: 4 }],
    text: ['Breaking grass tufts and ferns sometimes gives wheat seeds. Craft a hoe at a workbench (wood hoe: 2 planks and 1 wood; stone hoe: 2 stone and 1 wood; iron hoe: 2 iron ingots and 1 wood) and right click grass or dirt with it to till farmland, then right click farmland with seeds to plant.',
      'Crops grow by themselves. Right click a ripe crop to harvest it and replant. Cows follow anyone holding wheat, so you can lead them home; feed wheat to two cows to breed them.'] },

  // ---- Keep and combat ----
  { id: 'keep', chapter: 'adventure', x: 0, y: 3, icon: BLOCK.PEDESTAL, title: 'Your Keep and Flag', goal: obtained(BLOCK.WOOD, BLOCK.DIRT),
    text: ['Your team spawns in its keep, beside your flag on its golden pedestal. Nobody can break the keep or build inside it.',
      `To steal a flag, stand on an enemy pedestal for ${FLAG_GRAB_TIME} seconds. Carry it home and stand on your own pedestal for ${FLAG_CAPTURE_TIME} seconds while your flag is home to capture it.`,
      'A team whose flag is captured can no longer respawn: each member who dies is out. The last team standing wins.'] },
  { id: 'capture', chapter: 'adventure', x: 0, y: 4, links: ['keep', 'firstBlood'], icon: BLOCK.PEDESTAL, title: 'Capture a Flag', goal: event('flagCaptured'),
    text: [`Bring an enemy flag home and stand on your own pedestal for ${FLAG_CAPTURE_TIME} seconds while your own flag is on it.`,
      `If you die while carrying a flag, it drops where you fell. A dropped flag goes home after ${Math.round(FLAG_RETURN_TIME / 60)} minutes, when it falls into the void, or as soon as its owner touches it.`] },
  { id: 'weapon', chapter: 'adventure', x: 1, y: 3, deps: ['workbench'], icon: ITEM.WOOD_SWORD, title: 'Weapons',
    goal: crafted(ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.BRONZE_SWORD, ITEM.IRON_SWORD, ITEM.BOW),
    text: ['Swords (1 wood plus 2 planks, stone, bronze or iron ingots, at a workbench) deal more damage than fists. A bow (3 planks, 2 wood) has unlimited arrows: hold right click to draw and release to shoot; a fuller draw flies farther and hits harder.',
      'Knocking enemies off an island into the void kills them.'] },
  { id: 'armor', chapter: 'adventure', x: 2, y: 3, links: ['weapon'], icon: ITEM.LEATHER_ARMOR, title: 'Armor',
    goal: obtained(ITEM.LEATHER_ARMOR, ITEM.BRONZE_ARMOR, ITEM.IRON_ARMOR, ITEM.DRAGONSCALE_ARMOR),
    text: ['Leather armor takes 3 leather (from cows) at a workbench. Put armor in the armor slot of your inventory to reduce the damage you take.',
      'Leather < bronze < iron < dragonscale (which also stops dragon fire).'] },
  { id: 'firstBlood', chapter: 'adventure', x: 1, y: 4, links: ['weapon'], icon: ITEM.STONE_SWORD, title: 'First Blood', goal: event('kill:player'),
    text: ['Defeat an enemy player. You respawn in your keep until your flag is captured; an enemy team without its flag can\'t respawn at all.'] },

  // ---- Iron and defenses ----
  { id: 'iron', chapter: 'adventure', x: 4, y: 3, icon: ITEM.IRON_INGOT, title: 'Iron', goal: obtained(ITEM.IRON_INGOT),
    text: ['Get an iron ingot. You don\'t need to mine: the Sky Merchant sells a few iron ingots every day, dragons drop some, and the Goblins quest rewards two.',
      'Mining iron ore yourself needs a bronze hammer (strength 4); see Monkey Business. Smelt ore in a furnace, or crush it first for double.',
      'Iron makes the iron hammer (strength 5, breaks stone bricks and reinforced walls), iron swords, hoes and armor (10 ingots), reinforced doors and walls, arrow turrets and anvils.'] },
  { id: 'anvil', chapter: 'adventure', x: 3, y: 4, deps: ['iron'], icon: BLOCK.ANVIL, title: 'Anvil', goal: made(BLOCK.ANVIL),
    text: ['An anvil (6 iron ingots) rerolls an item\'s modifiers for 2 iron ingots. Put a weapon, tool, armor or accessory in it and press Reroll.'] },
  { id: 'reinforced', chapter: 'adventure', x: 4, y: 4, deps: ['iron'], icon: BLOCK.REINFORCED_WALL, title: 'Reinforced Walls',
    goal: made(BLOCK.REINFORCED_WALL), reward: [{ item: BLOCK.STONE_BRICKS, count: 10 }],
    text: [`1 iron ingot and ${REINFORCED_WALL.craftBricks} stone bricks make ${REINFORCED_WALL.craftCount} reinforced walls at a workbench.`,
      'They need an iron hammer and take four times as long to break as stone bricks. They can still be broken.'] },
  { id: 'reinforcedDoor', chapter: 'adventure', x: 5, y: 4, deps: ['iron'], icon: ITEM.REINFORCED_DOOR, title: 'Reinforced Doors', goal: made(ITEM.REINFORCED_DOOR),
    text: ['A reinforced door (6 iron ingots, at a workbench) only opens for the team that placed it, and needs an iron hammer to break.',
      'Put one in the walls around your keep so your team can come and go and nobody else can.'] },
  { id: 'turret', chapter: 'adventure', x: 5, y: 3, deps: ['iron'], icon: BLOCK.ARROW_TURRET, title: 'Arrow Turrets', goal: made(BLOCK.ARROW_TURRET),
    text: [`An arrow turret (4 iron ingots, 4 planks) needs the block above it clear. It shoots enemy players and monkeys, goblins and hostile creatures within ${TURRET.range} blocks when it has a clear shot.`,
      'It never shoots your team or your monkeys, needs no ammunition, and switches to the next target when one dies or leaves range.'] },
  { id: 'defense', chapter: 'adventure', x: 6, y: 3, deps: ['turret'], icon: BLOCK.ARROW_TURRET, title: 'Defending Your Flag',
    goal: { all: [made(BLOCK.ARROW_TURRET), event('role:guard')] },
    text: ['Have an arrow turret and a guard monkey watching over your base. Surround your keep with walls, put a reinforced door in them, and post a lookout where raiders will come from.'] },

  { id: 'spikes', chapter: 'adventure', x: 3, y: 3, deps: ['iron'], icon: BLOCK.SPIKE_BARRICADE, title: 'Spike Barricades', goal: { placed: [BLOCK.SPIKE_BARRICADE] },
    text: [`${SPIKES.craftIron} iron ingots make ${SPIKES.craftCount} iron spike barricades at a workbench. Place them like any block: on floors, walls, ceilings or under your island. They work the same whichever way they face.`,
      `Enemy players and monkeys, goblins and hostile creatures that touch one take ${SPIKES.contactDamage} damage and are thrown back (at most once every ${SPIKES.contactCooldown} seconds). An enemy breaking one by hand (it needs a stone hammer) takes ${SPIKES.breakDamage} damage every ${SPIKES.breakInterval} seconds while they work at it. Your own team and monkeys are never hurt.`,
      `Raiders can still get through: about ${Math.ceil(1 / SPIKES.arrowDamage)} arrows (or ${Math.ceil(1 / SPIKES.boltDamage)} crossbow bolts) wear one away, and an explosive barrel blows them apart. Grenades don't touch them. Use them on outer walls, bridge ends and the underside of your island.`] },

  // ---- Monkeys ----
  { id: 'tame', chapter: 'adventure', x: 0, y: 6, icon: ITEM.MONKEY_EGG, title: 'Taming a Monkey', goal: event('tame'),
    reward: [{ item: ITEM.BREAD, count: 3 }],
    text: ['Wild monkeys live on team islands, some small islands and (rarely) in the central island\'s tallest trees. Right click one to play its game; win and it joins your team.',
      'Games: Simon (repeat its jumps and crouches), card memory (match the pairs) and cup shuffle (follow the ball).',
      'Right click a tamed monkey to configure it: pick a role, select blocks in the world for it, and give it a tool and armor. Your own team can\'t hurt it. With a weapon in its tool slot it fights back when attacked.'] },
  { id: 'courier', chapter: 'adventure', x: 1, y: 5, deps: ['tame'], icon: BLOCK.CHEST, title: 'Couriers and Collectors',
    goal: { any: [event('role:courier'), event('role:collector')] },
    text: ['Courier: takes items out of its source containers and delivers them to its destinations in turn. From machines it only takes the output, and into a furnace it puts ore in the input and fuel in the fuel slot.',
      'Collector: picks up dropped items within its range of its first destination and delivers them.',
      'The item filter (all except / only these) limits what any monkey carries.'] },
  { id: 'guard', chapter: 'adventure', x: 1, y: 6, deps: ['tame'], icon: ITEM.IRON_SWORD, title: 'Guard Monkeys', goal: event('role:guard'),
    text: [`Guard: walks its patrol points in order and loops back to the first; with one point it guards that spot. It attacks enemy players and monkeys, goblins and hostile creatures it can see within ${MONKEY_DUTY.guard.range} blocks.`,
      `It never chases more than ${MONKEY_DUTY.guard.pursuit} blocks from its route, and returns to it after losing its target. The patrol route is drawn while you select its points.`,
      'Give it a sword or axe for melee, or a bow or crossbow to shoot from range (it needs a clear shot). Armor in its armor slot protects it.'] },
  { id: 'gatherers', chapter: 'adventure', x: 1, y: 7, deps: ['tame'], icon: ITEM.STONE_HAMMER, title: 'Gatherers',
    goal: { any: [event('role:lumberjack'), event('role:quarry'), event('role:farmer')] },
    text: ['Lumberjack: chops whole grown trees at its tree sites and replants saplings. Quarry: digs a box, circle or single blocks, never opening a hole into the void. Farmer: harvests and replants ripe crops in its area.',
      'Breaking speed and strength come from the hammer in its tool slot, like yours. It brings what it breaks to its destination containers.'] },
  { id: 'feedMachines', chapter: 'adventure', x: 3, y: 5, links: ['courier'], icon: BLOCK.FURNACE, title: 'Feeding Machines',
    goal: event('role:courier'),
    text: ['A courier whose destination is a furnace or alloy furnace puts ore in the input and fuel in the fuel slot by itself.',
      'For each furnace or alloy furnace destination you can choose Automatic, Material input or Fuel input in its configuration: use one courier for charcoal into the fuel slot and another for ore into the input.',
      'Chain a crusher in: one courier carries ore to the crusher and another takes its dust to the alloy furnace.'] },
  { id: 'lookout', chapter: 'adventure', x: 2, y: 6, links: ['guard'], icon: ITEM.SPYGLASS, title: 'Lookout Monkeys', goal: event('lookoutSpotted'),
    text: [`Lookout: stands at its post and watches for enemy players and goblins within ${MONKEY_DUTY.lookout.range} blocks, in sight. When it spots one it warns your whole team ("[name] spotted an enemy!").`,
      `It reports each target at most once every ${MONKEY_DUTY.lookout.cooldownSeconds} seconds and never leaves its post. Pick a high post with a wide view.`,
      `With a spyglass in its tool slot it sees ${MONKEY_DUTY.lookout.spyglassRange} blocks and names what it sees: "[name] spotted [player]!" or "[name] spotted a goblin!"`] },
  { id: 'gatherSplit', chapter: 'adventure', x: 2, y: 7, links: ['gatherers'], icon: ITEM.WOOD_HAMMER, title: 'Specialist Gatherers',
    goal: { all: [event('role:collector'), { any: [event('role:quarry'), event('role:lumberjack')] }] },
    text: ['Collect drops (on by default) decides whether a gatherer carries what it breaks. Turn it off on a quarry or lumberjack monkey and it leaves the drops on the ground and keeps working without walking back.',
      'Then give a collector monkey a destination chest nearby to bring the drops home.'] },
  { id: 'craftsman', chapter: 'adventure', x: 3, y: 6, icon: BLOCK.WORKBENCH, title: 'Craftsman Monkeys', goal: event('monkeyCrafted'),
    reward: coins(3),
    text: ['Craftsman: give it a source container, a workbench, a recipe and a destination. It fetches ingredients, crafts at the workbench one recipe at a time and delivers what it makes.',
      'It only takes as many sets of ingredients as it can finish and carry, counting stack sizes, unstackable outputs and recipes that make several items. If the destination is full it waits.'] },
  { id: 'factory', chapter: 'adventure', x: 4, y: 6, deps: ['craftsman'], links: ['feedMachines'], icon: BLOCK.WORKBENCH, title: 'A Factory',
    goal: event('monkeyCrafted', 20), reward: coins(6),
    text: ['Have craftsman monkeys craft 20 times. Chain monkeys together: gatherers fill a chest, couriers feed furnaces, a craftsman turns the results into goods, another courier takes them on.',
      'A craftsman crafting the merchant\'s requested goods, with a courier carrying them to the depot, earns coins with nobody watching.'] },

  // ---- The Sky Merchant ----
  { id: 'depot', chapter: 'adventure', x: 6, y: 6, icon: BLOCK.MERCHANT_DEPOT, title: 'Merchant Depot', goal: event('depotPlaced'),
    text: ['Ask me for a Merchant Depot with the button at the top of this book. Your team can only have one placed at a time; ask again if yours is destroyed or lost.',
      'Place it on your island\'s far edge, facing away from the center island, with open sky in front: the Sky Merchant\'s airship flies in from the far side and docks right in front of it.',
      'Holding the depot shows where the airship would dock (green: clear, red: something in the way).'] },
  { id: 'merchant', chapter: 'adventure', x: 7, y: 5, deps: ['depot'], icon: ITEM.GOLD_COIN, title: 'The Sky Merchant', goal: event('merchantTrade'),
    reward: coins(5),
    text: ['A traveling merchant from a far-off civilization beyond the islands. He arrives by airship each morning, stays by your depot all day and leaves at night.',
      'Right click him to trade. He buys raw resources and some goods for gold coins and sells resources, equipment and loot. Prices are fixed; valuable goods have a daily stock that refills each morning.',
      'Enemies can kill him; he drops nothing, and a new merchant comes the next morning.'] },
  { id: 'baby', chapter: 'adventure', x: 6, y: 5, deps: ['merchant'], icon: ITEM.MONKEY_EGG, title: 'Baby Monkeys', goal: event('babyMonkey'),
    text: [`The Sky Merchant sells baby monkeys for gold coins (${MERCHANT.babyBase} for your team's first). Each one your team buys makes the next cost more, for the whole match.`,
      `Babies belong to your team but can't work or fight. They grow into ordinary monkeys after ${Math.round(MONKEY_DUTY.baby.growSeconds / 60)} minutes; right click one to see how long is left.`] },
  { id: 'requests', chapter: 'adventure', x: 8, y: 5, deps: ['merchant'], icon: BLOCK.ARROW_TURRET, title: 'Requested Goods', goal: event('requestSold'),
    text: ['Each world the merchant asks for a few crafted goods (marked Requested in his trade screen). He pays more for them than their materials would fetch, so making them is worth it.',
      'Buying the materials from him always costs more than he pays, so the coins have to come from your own gathering and work.'] },
  { id: 'autosell', chapter: 'adventure', x: 7, y: 7, deps: ['depot'], icon: BLOCK.MERCHANT_DEPOT, title: 'Automated Selling', goal: event('autoSale', 10),
    reward: coins(5),
    text: [`Earn 10 coins through the depot. While the merchant is docked, the depot sells one batch from its selling slots every ${MERCHANT.sellTicks / 20} seconds and puts the coins in its coin slots. It only takes items he buys; its screen lists them with their prices.`,
      'Selling stops when he is away or the coin slots are full. Couriers can deliver goods to the depot and take coins out of it.'] },
  { id: 'wealth', chapter: 'adventure', x: 8, y: 6, deps: ['requests', 'autosell'], icon: ITEM.GOLD_COIN, title: 'A Thriving Trade',
    goal: event('merchantSale', 100), reward: coins(8),
    text: ['Earn 100 gold coins from the merchant, by hand or through the depot. Spend them on monkeys, gear and the materials your islands lack.'] },

  // ---- Exploration and creatures ----
  { id: 'spyglass', chapter: 'adventure', x: 0, y: 8, icon: ITEM.SPYGLASS, title: 'Spyglass', goal: obtained(ITEM.SPYGLASS),
    text: ['Buy a spyglass from the Sky Merchant (one a day), or craft one from 2 bronze ingots and 1 glass at a workbench.',
      'Hold right click to look through it: you see much farther and can read the name of any player you look at. You can\'t attack, break or place while looking.',
      'Put it in a Lookout monkey\'s tool slot to double its sight and have it name what it sees.'] },
  { id: 'islands', chapter: 'adventure', x: 1, y: 9, icon: BLOCK.GRASS, title: 'The Floating Islands', goal: obtained(BLOCK.DIRT, BLOCK.WOOD),
    text: ['Your team\'s island floats beside the great central island, with small islands scattered around and above. Below is the void: falling in kills you and your items are lost.',
      'Small islands hold tin, a little iron, loot chests and wild monkeys. The central island holds much more iron, goblins and older things.'] },
  { id: 'bridge', chapter: 'adventure', x: 2, y: 8, deps: ['islands'], icon: ITEM.LADDER, title: 'Crossing the Gaps', goal: made(ITEM.LADDER, BLOCK.PLANKS),
    text: ['Build bridges by placing blocks against the edge of the one you stand on. Crouch (Shift) to stop yourself walking off an edge.',
      'Jump and place a block under your feet to tower straight up. Ladders (1 plank makes 2) and rope can be climbed.'] },
  { id: 'glider', chapter: 'adventure', x: 3, y: 8, deps: ['bridge'], icon: ITEM.GLIDER, title: 'Glider', goal: obtained(ITEM.GLIDER),
    text: ['Craft a glider from 3 leather and 2 wood at a workbench. Hold it and hold right click in the air to glide down slowly.',
      'Gliding lets you cross gaps from high ground, but Void Eels may knock you out of the air.'] },
  { id: 'eels', chapter: 'adventure', x: 4, y: 8, links: ['glider'], icon: ITEM.RIFT_ORB, title: 'Void Eels', hidden: true,
    reveal: { any: [obtained(ITEM.RIFT_ORB), event('kill:eel')] }, goal: { any: [obtained(ITEM.RIFT_ORB), event('kill:eel')] },
    text: ['Void Eels swim under the islands and lunge at anyone exposed over the void, especially at night.',
      'Killing one drops Rift Orbs. Throw a Rift Orb (right click) to open a portal back to your keep for a short time.'] },
  { id: 'loot', chapter: 'adventure', x: 4, y: 9, links: ['islands'], icon: BLOCK.CHEST, title: 'Loot',
    goal: obtained(ITEM.WIND_AXE, ITEM.ICE_SWORD, ITEM.CROSSBOW, ITEM.ROPE_BUNDLE, ITEM.GRAPPLING_HOOK, ITEM.GOLDEN_BEEF, ...ACCESSORY_ITEMS),
    reward: coins(4),
    text: ['Chests in ruins, towers, caves and dungeons hold loot you can\'t craft: the crossbow (slow to load, hits hard), grappling hook (fire at a block to be pulled to it), rope bundles (place a column of rope you can climb), wind axe (huge knockback), ice sword (slows its target) and golden beef (heals instantly).',
      'Loot weapons and armor may carry modifiers, and chests may hold accessories, which you wear in the accessory slot of your inventory.'] },
  { id: 'crawlers', chapter: 'adventure', x: 5, y: 9, links: ['loot'], icon: ITEM.CRAWLER_EGG, title: 'Crawlers',
    goal: { any: [event('kill:crawler'), obtained(ITEM.SILK)] },
    text: ['Crawlers lurk in caves and dungeons, climb walls and bite. They drop silk.',
      'Hurting a creature makes it hunt you until it loses sight of you for a while. Bring torches into caves so they can\'t surprise you.'] },
  { id: 'center', chapter: 'adventure', x: 2, y: 10, links: ['islands'], icon: BLOCK.IRON_ORE, title: 'The Central Island', goal: { any: [event('visit:center'), obtained(BLOCK.IRON_ORE)] },
    text: ['Cross to the great island at the middle of the world and set foot on it: bridge across from your own island, or glide down from high ground.',
      'It is huge and rich in iron ore (which needs a bronze hammer). Goblins live in its lowlands, and its tallest trees sometimes hide wild monkeys you can tame.'] },
  { id: 'goblins', chapter: 'adventure', x: 3, y: 10, links: ['center'], icon: ITEM.GOBLIN_SOLDIER_EGG, title: 'Goblins', goal: event('kill:goblin'),
    reward: [{ item: ITEM.IRON_INGOT, count: 2 }],
    text: ['Goblins build villages and a sealed fortress in the central island\'s lowlands, and keep expanding. Workers, soldiers, archers, brutes and a king defend them, and their walls hide poison traps.',
      'Turrets, guard monkeys and lookouts all treat goblins as enemies.'] },

  // ---- Explosives ----
  { id: 'sulfurSeeds', chapter: 'adventure', x: 7, y: 9, icon: ITEM.SULFUR_SEEDS, title: 'Sulfur Seeds', goal: obtained(ITEM.SULFUR_SEEDS),
    text: [`Sulfur never grows wild. Buy sulfur seeds from the Sky Merchant (${SULFUR_OFFER.count} seeds for ${SULFUR_OFFER.coins} coins, up to ${SULFUR_OFFER.stock} times a day) or look for them in loot chests on the islands.`,
      'You only need a few: every sulfur plant gives seeds back when you harvest it.'] },
  { id: 'sulfurFarm', chapter: 'adventure', x: 8, y: 9, deps: ['sulfurSeeds'], icon: ITEM.SULFUR, title: 'Growing Sulfur', goal: obtained(ITEM.SULFUR),
    reward: [{ item: ITEM.CHARCOAL, count: 4 }],
    text: ['Plant sulfur seeds like wheat: till grass or dirt into farmland with a hoe, then right click the farmland with the seeds. The plant grows by itself through four stages into a bright yellow crop.',
      `Right click a ripe plant to harvest it: you get 1 sulfur and ${FARMING.matureSeeds[0]} to ${FARMING.matureSeeds[1]} seeds, so the farm keeps itself going without buying more.`] },
  { id: 'sulfurAuto', chapter: 'adventure', x: 8, y: 8, links: ['sulfurFarm'], icon: ITEM.SULFUR_SEEDS, title: 'Sulfur Farmhands', goal: event('monkeyHarvested:sulfur'),
    text: ['Give a Farmer monkey an area covering your sulfur farmland, a destination chest and a few sulfur seeds. It harvests ripe plants, replants them from the seeds it gets back and brings the sulfur to the chest, with nobody watching.'] },
  { id: 'gunpowder', chapter: 'adventure', x: 9, y: 9, deps: ['sulfurFarm'], icon: ITEM.GUNPOWDER, title: 'Gunpowder', goal: crafted(ITEM.GUNPOWDER),
    text: [`${EXPLOSIVES.gunpowder.craftSulfur} sulfur and ${EXPLOSIVES.gunpowder.craftCharcoal} charcoal make ${EXPLOSIVES.gunpowder.craftCount} gunpowder, no workbench needed. Smelt wood in a furnace for charcoal.`,
      'Gunpowder goes into grenades and explosive barrels. It stacks and travels like any item, so couriers can carry it.'] },
  { id: 'explosivesFactory', chapter: 'adventure', x: 8, y: 10, links: ['gunpowder'], icon: BLOCK.WORKBENCH, title: 'An Explosives Factory',
    goal: event(`monkeyCrafted:${ITEM.GUNPOWDER}`), reward: coins(3),
    text: ['Have a Craftsman monkey make gunpowder: a source chest with sulfur and charcoal, a workbench, the gunpowder recipe and a destination chest. A second craftsman can turn that gunpowder (and copper) into grenades.',
      'With a farmer filling the sulfur chest and a courier bringing charcoal from a furnace burning wood, the whole chain runs itself, no mining needed.'] },
  { id: 'grenades', chapter: 'adventure', x: 9, y: 8, deps: ['gunpowder'], icon: ITEM.GRENADE, title: 'Grenades', goal: event('grenadeThrown'),
    text: [`${EXPLOSIVES.grenade.craftGunpowder} gunpowder and ${EXPLOSIVES.grenade.craftCopper} copper ingot make ${EXPLOSIVES.grenade.craftCount} grenades at a workbench. Right click to throw one: it arcs, bounces off blocks, blinks and beeps faster and faster, and goes off ${EXPLOSIVES.grenade.fuseSeconds} seconds after it leaves your hand.`,
      `The blast does up to ${EXPLOSIVES.grenade.damage} damage at the center, less with distance (nothing beyond ${EXPLOSIVES.grenade.damageRadius} blocks) and less through walls, and throws things back. It never hurts your own team. It only breaks soft blocks (dirt, sand, wood, leaves, glass, crops) right next to it, and never spike barricades: it is for creatures and players, not walls.`] },
  { id: 'lighter', chapter: 'adventure', x: 10, y: 10, deps: ['gunpowder'], icon: ITEM.LIGHTER, title: 'Lighter', goal: obtained(ITEM.LIGHTER),
    text: [`${EXPLOSIVES.lighter.craftGunpowder} gunpowder and ${EXPLOSIVES.lighter.craftIron} iron ingot make a lighter at a workbench. It never wears out and needs no fuel.`,
      'Hold it and right click an explosive barrel to light the fuse. It is the only way to light a barrel by hand: right clicking one with anything else does nothing.'] },
  { id: 'barrels', chapter: 'adventure', x: 9, y: 10, deps: ['gunpowder'], links: ['lighter'], icon: BLOCK.EXPLOSIVE_BARREL, title: 'Explosive Barrels', goal: event('barrelLit'),
    text: [`${EXPLOSIVES.barrel.craftGunpowder} gunpowder, ${EXPLOSIVES.barrel.craftPlanks} planks and ${EXPLOSIVES.barrel.craftCopper} copper ingot make an explosive barrel at a workbench (look for the skull). Place it, then right click it with a lighter to light the fuse: it sparks and hisses for ${EXPLOSIVES.barrel.fuseSeconds} seconds and can't be picked up once lit. An unlit barrel breaks back into its item.`,
      `It blows apart stone and most blocks within about ${Math.floor(EXPLOSIVES.barrel.blastRadius * (1 - 1 / EXPLOSIVES.barrel.power))} blocks and hurts everything nearby (up to ${EXPLOSIVES.barrel.damage} damage). Stone bricks only crack, and reinforced walls take several barrels; damage adds up. Spike barricades go. Unbreakable blocks never do.`,
      'Another explosion lights any barrel in its blast with a short fuse, so rows of barrels go off one after another.'] },

  // ---- Fishing ----
  { id: 'fishingRod', chapter: 'adventure', x: 8, y: 3, icon: ITEM.WOOD_FISHING_ROD, title: 'Fishing Rod', goal: obtained(ITEM.WOOD_FISHING_ROD),
    text: [`Craft a wooden fishing rod from ${FISHING.craft.woodRodWood} wood and ${FISHING.craft.woodRodSilk} silk (Crawlers drop silk) at a workbench. Hold it and right click to cast; right click again to reel in.`,
      `Every rod has four attributes, shown in its tooltip. Fishing Tier decides what can bite and where it can fish (a wooden rod is tier ${ROD_STATS[ITEM.WOOD_FISHING_ROD].tier}: water and the void). Fishing Multiplier makes better catches more likely. Fishing Speed shortens the wait for a bite. Bait Conservation is the chance a cast doesn't use up its bait (${Math.round(ROD_STATS[ITEM.WOOD_FISHING_ROD].conservation * 100)}% on a wooden rod).`] },
  { id: 'bait', chapter: 'adventure', x: 8, y: 4, deps: ['fishingRod'], icon: ITEM.BREAD, title: 'Bait', goal: event('baitChosen'),
    text: ['Fishing takes bait. Right click your fishing rod in your inventory to choose it: the Bait list shows each kind, how many you have and what it does. Your choice is remembered for every cast; if you run out, you can\'t cast until you have more or choose another.',
      `Bread is cheap, basic bait. Raw beef (×${BAIT[ITEM.BEEF].quality} luck) and golden beef (×${BAIT[ITEM.GOLDEN_BEEF].quality}) make the good catches much more likely. Bait never changes how long you wait or where you can fish.`,
      'A cast that lands somewhere fishable uses one bait, unless the rod\'s Bait Conservation roll saves it. A cast that lands on the ground or runs out of line uses none.'] },
  { id: 'waterFishing', chapter: 'adventure', x: 9, y: 3, deps: ['fishingRod'], icon: ITEM.FISH, title: 'Gone Fishing', goal: event('fishCaught:water'),
    text: ['Cast into water: the bobber flies where you aim, falls, and floats on the surface. Then wait.',
      `When something bites, the tip of your rod bends down a little, and the bobber dips under with a splash. Reel in straight away (within about a second) and you always catch something. Reel in before the bite, or too late, and it gets away, bait and all. Bites usually come after ${FISHING.bite.min}-${FISHING.bite.max} seconds.`,
      'Water gives fish (eat them: hold right click), and now and then seeds, leather, rope, coins, iron or a loot crate.'] },
  { id: 'voidFishing', chapter: 'adventure', x: 10, y: 3, links: ['waterFishing'], icon: ITEM.VOID_FISH, title: 'Fishing the Void', goal: event('fishCaught:void'),
    text: [`Cast off the edge of an island into the void. Your line is very long (${FISHING.maxLine} blocks), and the bobber has to fall all the way down to the real void, far below the islands and below where the Void Eels swim; the open air under an island isn't deep enough.`,
      'Down there you can\'t see the bobber, so watch the tip of your rod: it bends when something bites. The void gives void fish, which bite nowhere else, and other odd things.'] },
  { id: 'lootCrates', chapter: 'adventure', x: 10, y: 4, links: ['waterFishing'], icon: ITEM.LOOT_CRATE, title: 'Loot Crates', goal: event('crateOpened'),
    text: ['Now and then a catch is a loot crate. Hold it and right click to open it: coins, metal, seeds, leather and silk, sometimes gear, a fishing rod with a modifier, or an accessory.',
      'Better rods, a higher Fishing Multiplier and better bait all make crates more likely. Tier 2 rods can also pull up iron-bound crates, which hold more.'] },
  { id: 'reforgeRod', chapter: 'adventure', x: 9, y: 4, links: ['fishingRod'], icon: BLOCK.ANVIL, title: 'Reforged Rods', goal: event('rodReforged'),
    text: [`Fishing rods can carry one modifier, like weapons and tools: Swift (+${Math.round(MODIFIERS.swift.value * 100)}% Fishing Speed), Lucky (+${Math.round(MODIFIERS.lucky.value * 100)}% Fishing Multiplier) or Thrifty (+${Math.round(MODIFIERS.thrifty.value * 100)}% Bait Conservation). Rods found in chests and crates often have one.`,
      `Put a rod in an anvil and press Reroll (2 iron ingots) for a new modifier, to specialize it for speed, catches or saving bait. A modifier never changes the rod's tier or where it can fish, and Bait Conservation never goes above ${Math.round(FISHING.maxConservation * 100)}%.`] },
  { id: 'fisherman', chapter: 'adventure', x: 11, y: 3, links: ['voidFishing'], icon: ITEM.MONKEY_EGG, title: 'Fisherman Monkeys', goal: event('monkeyFished'),
    text: [`Fisherman: give a monkey a fishing rod in its tool slot, a fishing spot (the block it stands on), a casting direction, a source chest with bait and a destination for its catch. It casts about one block out from its spot, into whatever is below: water, lava or the void.`,
      `It uses whatever bait its source holds, never misses a bite, and gets everything a player would (its rod's modifiers included), but it fishes at a tenth of your speed (more with a Swift rod). It stops when it runs out of bait, and won't cast where its rod can't fish.`] },

  // ======== Monkey Business ========

  // ---- Bronze ----
  { id: 'bronze', chapter: 'business', x: 0, y: 1, icon: ITEM.BRONZE_INGOT, title: 'Bronze', goal: obtained(ITEM.BRONZE_INGOT),
    text: ['Bronze is made in the Alloy Furnace from copper and tin. Crushing ore first gives two dust per ore, so a crusher doubles your bronze.',
      'Bronze makes hammers that break iron ore, swords, armor, pipes, tanks, pumps, boilers, crushers and spyglasses.'] },
  { id: 'bronzeTools', chapter: 'business', x: 1, y: 0, deps: ['bronze'], icon: ITEM.BRONZE_HAMMER, title: 'Bronze Tools',
    goal: crafted(ITEM.BRONZE_HAMMER, ITEM.BRONZE_SWORD, ITEM.BRONZE_ARMOR),
    text: ['Bronze hammer: 3 bronze ingots and 2 wood, strength 4, breaks iron ore. Bronze sword: 2 bronze ingots and 1 wood. Bronze armor: 10 bronze ingots.',
      'All at a workbench; a solid step up from stone and leather.'] },
  { id: 'ironMining', chapter: 'business', x: 2, y: 0, deps: ['bronzeTools'], icon: BLOCK.IRON_ORE, title: 'Mining Iron', goal: obtained(BLOCK.IRON_ORE),
    text: ['Iron ore needs strength 4: a bronze hammer. None grows on your own island; small islands have a little and the central island has plenty.',
      'Smelt it in a furnace for one ingot each, or crush it first for two dust, which smelt into two ingots. Mining your own iron frees you from the merchant\'s daily limit.'] },

  // ---- Steam power ----
  { id: 'pipes', chapter: 'business', x: 1, y: 3, deps: ['bronze'], icon: BLOCK.BRONZE_PIPE, title: 'Pumps and Pipes',
    goal: { all: [made(BLOCK.FLUID_PUMP), made(BLOCK.BRONZE_PIPE)] },
    text: ['1 bronze ingot makes 4 bronze pipes; a fluid pump takes 3 bronze ingots and a pipe. A pump touching water pulls it into connected pipes. Pipes carry water and steam between machines and tanks.',
      'Crouch and right click a pipe where it meets a machine to set that connection: blue dot = input into the pipe, orange = output from the pipe, none = automatic.'] },
  { id: 'tank', chapter: 'business', x: 1, y: 4, deps: ['pipes'], icon: BLOCK.FLUID_TANK, title: 'Fluid Tanks', goal: made(BLOCK.FLUID_TANK),
    text: [`A fluid tank (4 bronze ingots, 4 glass) stores ${FLUID.tankCapacity} units of one fluid and joins with neighbouring tanks. Right click a tank to see what it holds.`] },
  { id: 'boiler', chapter: 'business', x: 2, y: 3, deps: ['pipes'], icon: BLOCK.BOILER, title: 'Boiler', goal: made(BLOCK.BOILER),
    text: [`A boiler (a furnace and 4 bronze ingots) burns fuel (charcoal ${FLUID.boilerFuelSeconds.charcoal} s, wood ${FLUID.boilerFuelSeconds.wood} s, lava buckets much longer) to turn ${FLUID.boilerPerSecond} water a second into steam.`,
      'It needs water piped in, fuel in its slot, and a pipe taking its steam to a machine. Its screen tells you which one is missing; a lit boiler puffs a plume.'] },
  { id: 'crusher', chapter: 'business', x: 3, y: 3, deps: ['boiler'], icon: BLOCK.CRUSHER, title: 'Crusher',
    goal: obtained(ITEM.IRON_DUST, ITEM.COPPER_DUST, ITEM.TIN_DUST), reward: [{ item: ITEM.CHARCOAL, count: 8 }],
    text: [`The crusher (4 bronze ingots, 2 stone, 1 pipe) uses ${FLUID.crusherPerSecond} steam a second. Each ore becomes ${FLUID.crusherOreDust} dust in ${FLUID.crusherSeconds} seconds; stone becomes sand.`,
      `Dust smelts into ingots in a furnace or goes straight into the Alloy Furnace, so crushing doubles your metal. It keeps up to ${FLUID.crusherSteamBuffer} steam in its own store, so it rides out short gaps in the supply; with too little steam it runs slowly.`] },

  { id: 'drawbridge', chapter: 'business', x: 2, y: 4, deps: ['boiler'], icon: BLOCK.DRAWBRIDGE, title: 'Steam Drawbridge',
    goal: { all: [made(BLOCK.DRAWBRIDGE), event('drawbridgeExtended')] }, reward: [{ item: BLOCK.PLANKS, count: 9 }],
    text: [`Craft a drawbridge from ${DRAWBRIDGE.craftBronze} bronze ingots, ${DRAWBRIDGE.craftIron} iron ingots and ${DRAWBRIDGE.craftPipe} bronze pipe at a workbench, and place it at the edge of a platform: it extends the way you were facing. Right click it to set its direction and its length (1 to ${DRAWBRIDGE.maxLength}); while its screen is open an outline shows where the bridge will go. Length and direction only change while it is fully retracted. Only your team can open it.`,
      `Put planks in its slot: each section is built once from ${DRAWBRIDGE.sectionPlanks} planks. Retracted sections are stored inside and laid again for free, so moving it back and forth costs nothing.`,
      `Pipe steam in from a boiler. The drawbridge keeps up to ${DRAWBRIDGE.steamStorage} steam in its own store, topped up from the pipes. Each extend or retract costs ${DRAWBRIDGE.steamPerSection} steam per block of length (${DRAWBRIDGE.steamPerSection * DRAWBRIDGE.defaultLength} for ${DRAWBRIDGE.defaultLength} blocks, ${DRAWBRIDGE.steamPerSection * DRAWBRIDGE.maxLength} for ${DRAWBRIDGE.maxLength}), all taken the moment you press the button: from its store first, then the pipes, boilers and tanks. Without enough it won't start. Once started it slides straight out (or in) a section every ${DRAWBRIDGE.sectionSeconds} seconds to the end, even if the steam runs out, and you can't change your mind until it stops.`,
      'It never builds into a block or anyone in the way. If the first section is blocked it just jogs (no steam used); if something is in the way further out it slides as far as it can and stops there, so nobody standing on it is dropped. Without planks it also stops where it is. A broken section drops its planks and leaves a gap; press Extend with planks supplied to replace it. Monkeys walk across an extended bridge.'] },

  // ---- Fishing ----
  { id: 'bronzeRod', chapter: 'business', x: 5, y: 5, icon: ITEM.BRONZE_FISHING_ROD, title: 'Bronze Fishing Rod', goal: obtained(ITEM.BRONZE_FISHING_ROD),
    text: [`Craft one from a wooden fishing rod and ${FISHING.craft.bronzeRodBronze} bronze ingots at a workbench. It is tier ${ROD_STATS[ITEM.BRONZE_FISHING_ROD].tier} with a ×${ROD_STATS[ITEM.BRONZE_FISHING_ROD].multiplier} Fishing Multiplier: richer catches in water and the void (iron-bound crates among them), and it can fish in lava. It is no faster.`] },
  { id: 'lavaFishing', chapter: 'business', x: 6, y: 5, deps: ['bronzeRod'], icon: ITEM.IRONBOUND_CRATE, title: 'Lava Fishing', goal: { all: [obtained(ITEM.BRONZE_FISHING_ROD), event('fishCaught:lava')] },
    text: ['Cast a bronze fishing rod into lava: the bobber floats on top and bites come like anywhere else (watch for the fiery splash). Lava gives basalt, charcoal, obsidian, copper, tin and iron, and now and then an iron-bound crate or something rarer.'] },

  // ---- Industry ----
  { id: 'metalwork', chapter: 'business', x: 5, y: 1, icon: BLOCK.BRONZE_PIPE, title: 'Automated Metalwork', goal: anyEvent('monkeyCrafted', BRONZE_GOODS),
    text: ['Have a Craftsman monkey craft something made with bronze: pipes, pumps, tanks, boilers, crushers, bronze tools, swords, armor or spyglasses.',
      'Give it a chest holding bronze ingots (and any other ingredients) as its source, a workbench, the recipe and a destination; a courier from your alloy furnace can keep that chest stocked.'] },
  { id: 'industrialTrade', chapter: 'business', x: 6, y: 2, links: ['metalwork'], icon: BLOCK.MERCHANT_DEPOT, title: 'Industrial Trade',
    goal: anyEvent('depotSold', BRONZE_GOODS), reward: coins(5),
    text: ['Sell bronze through your Merchant Depot: the Sky Merchant buys bronze ingots, and pays well for bronze goods on the days he requests them (marked Requested on his screen and the depot\'s price list).',
      'Put them in the depot\'s selling slots, or have a courier bring them from your alloy furnace or craftsman, and the coins pile up in its coin slots while he is docked.'] },
  { id: 'steamFed', chapter: 'business', x: 5, y: 3, links: ['crusher'], icon: BLOCK.CRUSHER, title: 'Steam-Fed Machines',
    goal: { any: [event('monkeyFed:crusher'), event('monkeyFed:boiler')] },
    text: ['Have a courier monkey deliver to a crusher or a boiler: add the machine as one of its destinations.',
      'A courier fills a boiler\'s fuel slot and a crusher\'s input, and takes only finished output out of machines it uses as sources. Chain them: one courier carries ore to the crusher, another carries its dust to the alloy furnace, and your ore doubles without you.'] },

  // ======== Beyond the Island ========

  // ---- The fire island ----
  { id: 'lava', chapter: 'beyond', x: 0, y: 0, icon: ITEM.LAVA_BUCKET, title: 'The Fire Island', goal: { any: [event('visit:fire'), obtained(ITEM.LAVA_BUCKET)] },
    text: ['You set foot on the burning island: basalt, ash and pools of lava, with a temple at its heart. Fill a bucket from its lava (right click lava with an empty bucket); watch your step, lava burns.',
      'A lava bucket burns far longer than charcoal in furnaces, alloy furnaces and boilers, and the machine hands the empty bucket back.'] },
  { id: 'fireTemple', chapter: 'beyond', x: 1, y: 0, links: ['lava'], icon: BLOCK.CHISELED_BASALT, title: 'The Fire Temple', hidden: true,
    reveal: event('visit:fire'), goal: event('discover:fireTemple'),
    text: ['A temple of basalt stands at the heart of the fire island. Step inside.',
      'At the back of its sanctum a glowing portal leads somewhere else entirely.'] },
  { id: 'dragonLord', chapter: 'beyond', x: 2, y: 0, links: ['fireTemple'], icon: ITEM.DRAGON_HEART, title: 'The Dragon Lord', hidden: true,
    reveal: event('encounter:dragonLord'), goal: obtained(ITEM.DRAGON_CROWN, ITEM.DRAGON_HEART),
    text: ['The portal in the fire temple leads to the Dragon Lord\'s arena. He sleeps until you come close, then fights on the ground and in the air.',
      'Defeating him drops the Dragon Crown (an accessory: +5 maximum health and immunity to fire), a Dragon Heart and Dragon Scales.'] },

  // ---- Dragons and treasures ----
  { id: 'dragons', chapter: 'beyond', x: 4, y: 0, icon: ITEM.DRAGON_SCALE, title: 'Dragons', goal: { any: [event('kill:dragon'), obtained(ITEM.DRAGON_SCALE)] },
    text: ['Dragons patrol islands of their own, land to rest and breathe fire at anyone nearby. Hurting one makes it hunt you.',
      'They drop iron, leather and Dragon Scales.'] },
  { id: 'dragonscale', chapter: 'beyond', x: 5, y: 0, deps: ['dragons'], icon: ITEM.DRAGONSCALE_ARMOR, title: 'Dragonscale Armor', goal: obtained(ITEM.DRAGONSCALE_ARMOR),
    text: ['8 Dragon Scales make dragonscale armor at a workbench: the best armor there is, and it shrugs off dragon fire.'] },
  { id: 'accessories', chapter: 'beyond', x: 7, y: 1, icon: ITEM.HEART_AMULET, title: 'Rare Accessories', goal: obtained(...ACCESSORY_ITEMS),
    text: ['Accessories go in the accessory slot of your inventory; you can wear one at a time. They come from loot chests; the Sky Merchant sometimes sells spring boots, and the Dragon Crown comes from the Dragon Lord.',
      'Wind boots: move faster. Spring boots: hold jump to charge a high leap. Heart amulet: +5 maximum health. Mending charm: start healing steadily 5 seconds after being hurt. Ember heart: when a blow would kill you (not a fall into the void) it burns up instead and leaves you with 10 health.'] },

  // ---- The deep void ----
  { id: 'eelCatch', chapter: 'beyond', x: 7, y: 3, icon: ITEM.VOID_EEL_EGG, title: 'Something Bit Back', hidden: true,
    reveal: event('fishedEel'), goal: event('fishedEel'),
    text: ['Fishing the deep void with a tier 2 rod, you hooked a Void Eel and reeled it all the way up. It landed right beside you, and it is angry: it hunts whoever hooked it.',
      `A Fisherman monkey working the void can hook one too. That eel lands beside the monkey and hovers around its fishing spot for about ${Math.round(FISHING.eel.patrolSeconds / 60)} minutes before sinking back down: arrow turrets, guard monkeys or spike barricades there can deal with it.`] },

  // ---- The frozen island and the Ancient Monkeys ----
  { id: 'iceIsland', chapter: 'beyond', x: 0, y: 2, icon: BLOCK.PACKED_ICE, title: 'The Frozen Island', goal: event('visit:ice'),
    text: ['Somewhere among the outer islands floats one of snow and ice, with a frozen lake and a great glacier. Find it and set foot on it.',
      'Ice and packed ice can be mined with a hammer and built with like any block.'] },
  { id: 'glacier', chapter: 'beyond', x: 1, y: 2, links: ['iceIsland'], icon: BLOCK.ICE, title: 'The Hollow Glacier', hidden: true,
    reveal: event('visit:ice'), goal: event('discover:glacier'),
    text: ['The glacier on the frozen island is hollow: a round chamber hides at its heart. Dig your way in.'] },
  { id: 'ancientWater', chapter: 'beyond', x: 3, y: 2, icon: ITEM.ANCIENT_WATER_MONKEY_EGG, title: 'The Ancient Water Monkey', hidden: true,
    reveal: event('meet:ancientWaterMonkey'), goal: event('meet:ancientWaterMonkey'),
    text: ['You found the Ancient Water Monkey in the cave beneath the gorge. Ancient Monkeys can\'t be harmed. Right click one to hear what it has to say.',
      'What they want is still a mystery.'] },
  { id: 'ancientLightning', chapter: 'beyond', x: 4, y: 2, icon: ITEM.ANCIENT_LIGHTNING_MONKEY_EGG, title: 'The Ancient Lightning Monkey', hidden: true,
    reveal: event('meet:ancientLightningMonkey'), goal: event('meet:ancientLightningMonkey'),
    text: ['You found the Ancient Lightning Monkey in the storm above the central island\'s peaks. Ancient Monkeys can\'t be harmed. Right click one to hear what it has to say.',
      'What they want is still a mystery.'] },
  { id: 'ancientFire', chapter: 'beyond', x: 5, y: 2, icon: ITEM.ANCIENT_FIRE_MONKEY_EGG, title: 'The Ancient Fire Monkey', hidden: true,
    reveal: event('meet:ancientFireMonkey'), goal: event('meet:ancientFireMonkey'),
    text: ['You found the Ancient Fire Monkey on the burning island. Ancient Monkeys can\'t be harmed. Right click one to hear what it has to say.',
      'What they want is still a mystery.'] },
];

export const questById = new Map(QUESTS.map((q) => [q.id, q]));
export const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));

// What unlocks a chapter: its own goal, and for a discovery chapter also any
// goal or reveal of its quests (so finding any one of its secrets opens it).
const UNLOCK_GOALS = new Map(CHAPTERS.filter((c) => c.unlock).map((c) => [c.id, !c.unlock.discovery ? c.unlock.goal
  : { any: [c.unlock.goal, ...QUESTS.filter((q) => q.chapter === c.id).flatMap((q) => [q.goal, q.reveal])].filter(Boolean) }]));
export function unlockGoal(chapter) { return UNLOCK_GOALS.get(chapter.id) ?? null; }
// Hidden from the sidebar until unlocked (discovery chapters).
export function chapterHidden(chapter) { return !!chapter.unlock?.discovery; }

// Whether a goal is met by a team's progress.
export function goalMet(goal, progress) {
  if (!goal) return false;
  if (goal.all) return goal.all.every((g) => goalMet(g, progress));
  if (goal.any) return goal.any.some((g) => goalMet(g, progress));
  if (goal.obtained) return goal.obtained.some((id) => progress.obtained.has(id));
  if (goal.crafted) return goal.crafted.some((id) => progress.crafted.has(id));
  if (goal.placed) return goal.placed.some((id) => progress.placed.has(id));
  if (goal.event) return (progress.events.get(goal.event) ?? 0) >= (goal.count ?? 1);
  return false;
}

// [have, need] for a counted milestone goal, else null.
export function goalCount(goal, progress) {
  return goal?.event && (goal.count ?? 1) > 1 ? [Math.min(goal.count, progress.events.get(goal.event) ?? 0), goal.count] : null;
}

// A team's book state, the same rules on server and client:
//   unlocked  Set of chapter ids
//   completed Set of quest ids
export function chapterOpen(chapter, unlocked) {
  return !chapter.unlock || unlocked.has(chapter.id);
}
// Available: its chapter is unlocked and every prerequisite is done.
export function questAvailable(quest, unlocked, completed) {
  return chapterOpen(chapterById.get(quest.chapter), unlocked) && (quest.deps ?? []).every((d) => completed.has(d));
}
