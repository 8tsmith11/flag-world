// The Wise Monkey's quest book, as data: chapters (technological stages) and
// the quests placed on each chapter's graph.
//
// Chapters: each has an `unlock` ({ goal, text }) or none (open from the
// start). A chapter unlocks for a team the first time its team progress meets
// the goal, and stays unlocked. Chapters never depend on each other's quests.
// To add a stage, append a chapter with its unlock goal and give its quests
// that chapter id; nothing else needs to change.
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
//          or it's complete, to keep rare and late things a mystery.
//
// The book is a guide, not a lock: every recipe, item and mechanic works
// whether or not its quest or chapter is available. Progress is per team
// (server/teamProgress.js) and is always recorded, so a goal met before its
// quest or chapter is available completes it the moment it becomes available.
//
// Goals:
//   { obtained: [ids] }  any of these has been in a member's inventory
//   { crafted: [ids] } / { placed: [ids] }
//   { event: 'name', count }  a milestone happened (count times)
//   { all: [goals] } / { any: [goals] }
import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { METALS, FLUID, MERCHANT, MONKEY_DUTY, REINFORCED_WALL, SMELT_TIME, FLAG_GRAB_TIME, FLAG_CAPTURE_TIME,
  SAPLING_DROP_CHANCE, TURRET, FLAG_RETURN_TIME } from './config.js';

const obtained = (...ids) => ({ obtained: ids });
const crafted = (...ids) => ({ crafted: ids });
const made = (...ids) => ({ any: [{ crafted: ids }, { placed: ids }] });
const event = (name, count = 1) => ({ event: name, count });
const coins = (count) => [{ item: ITEM.GOLD_COIN, count }];
const region = (label, x0, y0, x1, y1) => ({ label, x0, y0, x1, y1 });
const ACCESSORY_ITEMS = [ITEM.WIND_BOOTS, ITEM.SPRING_BOOTS, ITEM.HEART_AMULET, ITEM.MENDING_CHARM, ITEM.EMBER_HEART, ITEM.DRAGON_CROWN];
const ANCIENT_MEETINGS = ['ancientWaterMonkey', 'ancientLightningMonkey', 'ancientFireMonkey'].map((kind) => event(`meet:${kind}`));

export const CHAPTERS = [
  { id: 'adventure', numeral: 'I', name: 'A Brand New Adventure', icon: BLOCK.WOOD, unlock: null,
    regions: [region('Tools and building', 0, 0, 4, 1), region('Metalworking', 5, 1, 7, 2), region('Keep and combat', 0, 3, 3, 4),
      region('Food and farming', 4, 3, 5, 3), region('Monkeys', 0, 5, 1, 7), region('Exploration and creatures', 3, 5, 6, 7)],
    intro: 'Wood, stone and your first tools; a keep to hold and a flag to protect; your first monkeys, furnaces and fights, and the islands around you.' },
  { id: 'business', numeral: 'II', name: 'Monkey Business', icon: ITEM.BRONZE_INGOT,
    unlock: { goal: obtained(ITEM.BRONZE_INGOT), text: 'Unlocks when anyone on your team first holds a bronze ingot (made in an Alloy Furnace).' },
    regions: [region('Bronze and iron', 0, 0, 2, 3), region('Defenses', 3, 0, 4, 2), region('Monkey roles', 5, 0, 6, 2),
      region('Steam power', 1, 4, 3, 5), region('Automation', 4, 3, 6, 3), region('Sky Merchant', 7, 1, 9, 4),
      region('The central island', 0, 6, 1, 7), region('Dragons and rare loot', 3, 6, 7, 7)],
    intro: 'Bronze and iron, steam machines, monkeys that guard, watch and craft, factories that run themselves, the Sky Merchant and his gold, and the dangers of the central island and beyond.' },
];

export const QUESTS = [
  // ======== Chapter I: A Brand New Adventure ========

  // ---- Tools and gathering (top left) ----
  { id: 'wise', chapter: 'adventure', x: 0, y: 0, icon: ITEM.WISE_MONKEY_EGG, title: 'The Wise Monkey', goal: event('meet:wiseMonkey'),
    text: ['Right click your team\'s Wise Monkey, on his shrine on your island, to open this book. Quests complete by themselves when anyone on your team does what they ask, and they count what you did before you read them.',
      'A reward can be claimed once for the whole team, by whoever presses Claim first while standing near me.',
      'Quests joined by a solid line need the earlier quest done first; dashed lines only mark related quests. Nothing here locks a recipe or an item: you can always craft and use anything you have the materials for.',
      'Chapter II opens for your whole team as soon as any of you holds a bronze ingot, whether or not this chapter is finished.'] },
  { id: 'wood', chapter: 'adventure', x: 0, y: 1, icon: BLOCK.WOOD, title: 'Wood', goal: obtained(BLOCK.WOOD),
    text: ['Hold left click on a tree trunk to break it. Bare hands are enough for wood, dirt, sand and leaves.',
      `Breaking a block drops it as an item; walk over it to pick it up. Leaves drop a sapling ${Math.round(SAPLING_DROP_CHANCE * 100)}% of the time: plant it on grass or dirt to grow a new tree.`] },
  { id: 'planks', chapter: 'adventure', x: 1, y: 1, icon: BLOCK.PLANKS, title: 'Planks', deps: ['wood'], goal: crafted(BLOCK.PLANKS),
    text: ['Press E to open your inventory. Its crafting list shows every recipe your team has found an ingredient for.',
      'One wood makes four planks. Planks make torches, ladders, a workbench and more.'] },
  { id: 'light', chapter: 'adventure', x: 1, y: 0, icon: BLOCK.TORCH, title: 'Light', deps: ['planks'], goal: made(BLOCK.TORCH),
    text: ['One plank makes four torches, no workbench needed. Place them on floors or walls to light caves and nights.',
      'Nights are dark but short.'] },
  { id: 'workbench', chapter: 'adventure', x: 2, y: 1, icon: BLOCK.WORKBENCH, title: 'Workbench', deps: ['planks'], goal: made(BLOCK.WORKBENCH),
    reward: [{ item: BLOCK.TORCH, count: 8 }],
    text: ['Craft a workbench from 4 planks and place it with right click. Right click the workbench to use it.',
      'Most tools, weapons, machines and armor can only be crafted at a workbench.'] },
  { id: 'chests', chapter: 'adventure', x: 2, y: 0, icon: BLOCK.CHEST, title: 'Chests and Sorting', deps: ['workbench'], goal: made(BLOCK.CHEST),
    text: ['A chest (8 planks, at a workbench) holds 27 stacks. Shift-click moves stacks between it and your inventory.',
      'The Sort buttons merge partial stacks and group identical items: on your inventory it sorts the main grid (your hotbar stays as it is); on a chest, the whole chest.'] },
  { id: 'hammer', chapter: 'adventure', x: 3, y: 1, icon: ITEM.WOOD_HAMMER, title: 'Hammers', deps: ['workbench'],
    goal: crafted(ITEM.WOOD_HAMMER, ITEM.STONE_HAMMER),
    text: ['Hammers are the only breaking tools. A block can only be broken by a hammer whose strength is at least the block\'s hardness, and better hammers break faster.',
      'Wood hammer (3 planks, 2 wood): strength 2. Stone hammer (3 stone, 2 wood): strength 3, breaks copper and tin ore. Bronze: 4 (iron ore). Iron: 5 (stone bricks, reinforced walls).'] },
  { id: 'stone', chapter: 'adventure', x: 4, y: 1, icon: BLOCK.STONE, title: 'Stone', deps: ['hammer'], goal: obtained(BLOCK.STONE),
    text: ['Stone needs a wooden hammer or better. Look under the grass, in cliffs, or in caves.',
      'Quarry Stones (dark blocks with glowing seams) regrow stone on their open faces every few seconds: mine around them for an endless supply.'] },

  // ---- Building a base (top, by the tools) ----
  { id: 'doors', chapter: 'adventure', x: 3, y: 0, icon: ITEM.DOOR, title: 'Doors', deps: ['workbench'], links: ['bricks'], goal: made(ITEM.DOOR),
    text: ['A door (6 planks, at a workbench) is two blocks tall; right click to open or close it. Anyone can open a wooden door.',
      'A reinforced door (6 iron ingots) only opens for the team that placed it; see Chapter II.'] },
  { id: 'bricks', chapter: 'adventure', x: 4, y: 0, icon: BLOCK.STONE_BRICKS, title: 'Stone Bricks', deps: ['stone'], goal: crafted(BLOCK.STONE_BRICKS),
    text: ['One stone makes one stone brick, anywhere. Stone bricks need an iron hammer (strength 5) to break, so they make strong walls around your keep.',
      'Raiders with stone or bronze hammers can\'t dig through them; they have to find a door or a gap.'] },

  // ---- Furnaces and early metallurgy (top right) ----
  { id: 'furnace', chapter: 'adventure', x: 5, y: 1, icon: BLOCK.FURNACE, title: 'Furnace', deps: ['stone'], goal: made(BLOCK.FURNACE),
    text: ['A furnace (8 stone, at a workbench) smelts ore into ingots, sand into glass, wood into charcoal and beef into cooked beef.',
      `Put what to smelt in the top slot and fuel in the bottom slot; each item takes ${SMELT_TIME} seconds. Charcoal smelts 8 items, wood 2, planks 1, a lava bucket many more.`,
      'Its screen shows what it is doing and why it stopped (missing fuel, output full...). Take results from the output slot.'] },
  { id: 'copper', chapter: 'adventure', x: 6, y: 1, icon: ITEM.COPPER_INGOT, title: 'Copper and Tin', deps: ['furnace'],
    goal: { all: [obtained(ITEM.COPPER_INGOT), obtained(ITEM.TIN_INGOT)] }, reward: [{ item: ITEM.CHARCOAL, count: 4 }],
    text: ['Copper ore is common on your island; tin ore is rare there but plentiful on the small islands. Both need a stone hammer.',
      'Smelt them into ingots in a furnace, or feed them straight into an Alloy Furnace.'] },
  { id: 'bucket', chapter: 'adventure', x: 6, y: 2, icon: ITEM.EMPTY_BUCKET, title: 'Buckets', deps: ['copper'], goal: obtained(ITEM.EMPTY_BUCKET),
    text: [`Craft a bucket from ${METALS.crafting.bucketCopper} copper ingot at a workbench. Right click water or lava with it to fill it, and right click a block with a full bucket to pour it out (you keep the empty bucket).`,
      'A lava bucket is the longest-burning fuel for furnaces, alloy furnaces and boilers; the machine hands the empty bucket back.'] },
  { id: 'alloy', chapter: 'adventure', x: 7, y: 1, icon: BLOCK.ALLOY_FURNACE, title: 'Alloy Furnace', deps: ['copper'],
    goal: made(BLOCK.ALLOY_FURNACE), reward: [{ item: ITEM.TIN_INGOT, count: 2 }],
    text: [`Build it from a furnace and ${METALS.crafting.alloyFurnaceCopper} copper ingots at a workbench. It has three ingredient slots, a fuel slot and an output.`,
      `${METALS.alloy.copper} copper and ${METALS.alloy.tin} tin make ${METALS.alloy.output} bronze ingots in ${METALS.alloy.seconds} seconds. Copper and tin count in any form: ore, dust or ingot each count as one, and you can mix them.`,
      'Its screen shows how much copper and tin it holds and what is missing. Your first bronze ingot opens Chapter II: Monkey Business.'] },

  // ---- Keep, flags and early combat (middle left) ----
  { id: 'keep', chapter: 'adventure', x: 0, y: 3, icon: BLOCK.PEDESTAL, title: 'Your Keep and Flag', goal: obtained(BLOCK.WOOD, BLOCK.DIRT),
    text: ['Your team spawns in its keep, beside your flag on its golden pedestal. Nobody can break the keep or build inside it.',
      `To steal a flag, stand on an enemy pedestal for ${FLAG_GRAB_TIME} seconds. Carry it home and stand on your own pedestal for ${FLAG_CAPTURE_TIME} seconds while your flag is home to capture it.`,
      'A team whose flag is captured can no longer respawn: each member who dies is out. The last team standing wins.'] },
  { id: 'capture', chapter: 'adventure', x: 1, y: 4, icon: BLOCK.PEDESTAL, title: 'Capture a Flag', links: ['keep', 'firstBlood'], goal: event('flagCaptured'),
    text: [`Bring an enemy flag home and stand on your own pedestal for ${FLAG_CAPTURE_TIME} seconds while your own flag is on it.`,
      `If you die while carrying a flag, it drops where you fell. A dropped flag goes home after ${Math.round(FLAG_RETURN_TIME / 60)} minutes, when it falls into the void, or as soon as its owner touches it.`] },
  { id: 'weapon', chapter: 'adventure', x: 2, y: 3, icon: ITEM.WOOD_SWORD, title: 'Weapons', deps: ['workbench'],
    goal: crafted(ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.BRONZE_SWORD, ITEM.IRON_SWORD, ITEM.BOW),
    text: ['Swords (1 wood plus 2 planks, stone, bronze or iron ingots, at a workbench) deal more damage than fists. A bow (3 planks, 2 wood) has unlimited arrows: hold right click to draw and release to shoot; a fuller draw flies farther and hits harder.',
      'Knocking enemies off an island into the void kills them.'] },
  { id: 'armor', chapter: 'adventure', x: 3, y: 3, icon: ITEM.LEATHER_ARMOR, title: 'Armor', links: ['weapon'],
    goal: obtained(ITEM.LEATHER_ARMOR, ITEM.BRONZE_ARMOR, ITEM.IRON_ARMOR, ITEM.DRAGONSCALE_ARMOR),
    text: ['Leather armor takes 3 leather (from cows) at a workbench. Put armor in the armor slot of your inventory to reduce the damage you take.',
      'Leather < bronze < iron < dragonscale (which also stops dragon fire).'] },
  { id: 'firstBlood', chapter: 'adventure', x: 2, y: 4, icon: ITEM.STONE_SWORD, title: 'First Blood', links: ['weapon'], goal: event('kill:player'),
    text: ['Defeat an enemy player. You respawn in your keep until your flag is captured; an enemy team without its flag can\'t respawn at all.'] },

  // ---- Food and farming (middle right) ----
  { id: 'food', chapter: 'adventure', x: 4, y: 3, icon: ITEM.COOKED_BEEF, title: 'Food and Health', goal: obtained(ITEM.BEEF, ITEM.BREAD, ITEM.COOKED_BEEF),
    text: ['You heal slowly on your own a while after being hurt. Food heals faster: hold right click with food in hand while hurt.',
      'Cows drop beef and leather. Cook beef in a furnace for more healing. Wheat makes bread (3 wheat, no workbench).'] },
  { id: 'farming', chapter: 'adventure', x: 5, y: 3, icon: ITEM.WHEAT, title: 'Farming', links: ['food'], goal: obtained(ITEM.WHEAT),
    reward: [{ item: ITEM.WHEAT_SEEDS, count: 4 }],
    text: ['Breaking grass tufts and ferns sometimes gives wheat seeds. Craft a hoe at a workbench (wood hoe: 2 planks and 1 wood; stone hoe: 2 stone and 1 wood; iron hoe: 2 iron ingots and 1 wood) and right click grass or dirt with it to till farmland, then right click farmland with seeds to plant.',
      'Crops grow by themselves. Right click a ripe crop to harvest it and replant. Feed wheat to two cows to breed them.'] },

  // ---- Monkeys (bottom left) ----
  { id: 'tame', chapter: 'adventure', x: 0, y: 6, icon: ITEM.MONKEY_EGG, title: 'Taming a Monkey', goal: event('tame'),
    reward: [{ item: ITEM.BREAD, count: 3 }],
    text: ['Wild monkeys live on team islands, some small islands and (rarely) in the central island\'s tallest trees. Right click one to play its game; win and it joins your team.',
      'Games: Simon (repeat its jumps and crouches), card memory (match the pairs) and cup shuffle (follow the ball).',
      'Right click a tamed monkey to configure it: pick a role, select blocks in the world for it, and give it a tool and armor. Your own team can\'t hurt it. With a weapon in its tool slot it fights back when attacked.'] },
  { id: 'courier', chapter: 'adventure', x: 1, y: 5, icon: BLOCK.CHEST, title: 'Couriers and Collectors', deps: ['tame'],
    goal: { any: [event('role:courier'), event('role:collector')] },
    text: ['Courier: takes items out of its source containers and delivers them to its destinations in turn. From machines it only takes the output, and into a furnace it puts ore in the input and fuel in the fuel slot.',
      'Collector: picks up dropped items within its range of its first destination and delivers them.',
      'The item filter (all except / only these) limits what any monkey carries.'] },
  { id: 'gatherers', chapter: 'adventure', x: 1, y: 7, icon: ITEM.STONE_HAMMER, title: 'Gatherers', deps: ['tame'],
    goal: { any: [event('role:lumberjack'), event('role:quarry'), event('role:farmer')] },
    text: ['Lumberjack: chops whole grown trees at its tree sites and replants saplings. Quarry: digs a box, circle or single blocks, never opening a hole into the void. Farmer: harvests and replants ripe crops in its area.',
      'Breaking speed and strength come from the hammer in its tool slot, like yours. It brings what it breaks to its destination containers.'] },

  // ---- Exploration and creatures (bottom right) ----
  { id: 'islands', chapter: 'adventure', x: 3, y: 6, icon: BLOCK.GRASS, title: 'The Floating Islands', goal: obtained(BLOCK.DIRT, BLOCK.WOOD),
    text: ['Your team\'s island floats beside the great central island, with small islands scattered around and above. Below is the void: falling in kills you and your items are lost.',
      'Small islands hold tin, a little iron, loot chests and wild monkeys. The central island holds much more iron, goblins and older things.'] },
  { id: 'bridge', chapter: 'adventure', x: 4, y: 5, icon: ITEM.LADDER, title: 'Crossing the Gaps', deps: ['islands'], goal: made(ITEM.LADDER, BLOCK.PLANKS),
    text: ['Build bridges by placing blocks against the edge of the one you stand on. Crouch (Shift) to stop yourself walking off an edge.',
      'Jump and place a block under your feet to tower straight up. Ladders (1 plank makes 2) and rope can be climbed.'] },
  { id: 'glider', chapter: 'adventure', x: 5, y: 5, icon: ITEM.GLIDER, title: 'Glider', deps: ['bridge'], goal: obtained(ITEM.GLIDER),
    text: ['Craft a glider from 3 leather and 2 wood at a workbench. Hold it and hold right click in the air to glide down slowly.',
      'Gliding lets you cross gaps from high ground, but Void Eels may knock you out of the air.'] },
  { id: 'eels', chapter: 'adventure', x: 6, y: 5, icon: ITEM.RIFT_ORB, title: 'Void Eels', links: ['glider'], hidden: true,
    reveal: { any: [obtained(ITEM.RIFT_ORB), event('kill:eel')] }, goal: { any: [obtained(ITEM.RIFT_ORB), event('kill:eel')] },
    text: ['Void Eels swim under the islands and lunge at anyone exposed over the void, especially at night.',
      'Killing one drops Rift Orbs. Throw a Rift Orb (right click) to open a portal back to your keep for a short time.'] },
  { id: 'loot', chapter: 'adventure', x: 4, y: 7, icon: BLOCK.CHEST, title: 'Loot', links: ['islands'],
    goal: obtained(ITEM.WIND_AXE, ITEM.ICE_SWORD, ITEM.CROSSBOW, ITEM.ROPE_BUNDLE, ITEM.GRAPPLING_HOOK, ITEM.GOLDEN_BEEF, ...ACCESSORY_ITEMS),
    reward: coins(4),
    text: ['Chests in ruins, towers, caves and dungeons hold loot you can\'t craft: the crossbow (slow to load, hits hard), grappling hook (fire at a block to be pulled to it), rope bundles (place a column of rope you can climb), wind axe (huge knockback), ice sword (slows its target) and golden beef (heals instantly).',
      'Loot weapons and armor may carry modifiers, and chests may hold accessories (see Rare Accessories in Chapter II).'] },
  { id: 'crawlers', chapter: 'adventure', x: 5, y: 7, icon: ITEM.CRAWLER_EGG, title: 'Crawlers', links: ['loot'],
    goal: { any: [event('kill:crawler'), obtained(ITEM.SILK)] },
    text: ['Crawlers lurk in caves and dungeons, climb walls and bite. They drop silk.',
      'Hurting a creature makes it hunt you until it loses sight of you for a while. Bring torches into caves so they can\'t surprise you.'] },

  // ======== Chapter II: Monkey Business ========

  // ---- Bronze and iron (top left) ----
  { id: 'bronze', chapter: 'business', x: 0, y: 3, icon: ITEM.BRONZE_INGOT, title: 'Bronze', goal: obtained(ITEM.BRONZE_INGOT),
    text: ['Bronze is made in the Alloy Furnace from copper and tin. Crushing ore first gives two dust per ore, so a crusher doubles your bronze.',
      'Bronze makes hammers that break iron ore, swords, armor, pipes, tanks, pumps, boilers, crushers and spyglasses.'] },
  { id: 'bronzeTools', chapter: 'business', x: 1, y: 2, icon: ITEM.BRONZE_HAMMER, title: 'Bronze Tools', deps: ['bronze'],
    goal: crafted(ITEM.BRONZE_HAMMER, ITEM.BRONZE_SWORD, ITEM.BRONZE_ARMOR),
    text: ['Bronze hammer: 3 bronze ingots and 2 wood, strength 4, breaks iron ore. Bronze sword: 2 bronze ingots and 1 wood. Bronze armor: 10 bronze ingots.',
      'All at a workbench; a solid step up from stone and leather.'] },
  { id: 'iron', chapter: 'business', x: 2, y: 1, icon: ITEM.IRON_INGOT, title: 'Iron', deps: ['bronzeTools'], goal: obtained(ITEM.IRON_INGOT),
    text: ['Iron ore needs a bronze hammer. There is none on your own island: look on the small islands and, far more, on the central island. Smelt it, or crush it first for double.',
      'Iron makes the iron hammer (strength 5), iron swords, hoes and armor (10 ingots), reinforced doors and walls, arrow turrets and anvils.'] },
  { id: 'anvil', chapter: 'business', x: 2, y: 0, icon: BLOCK.ANVIL, title: 'Anvil', deps: ['iron'], goal: made(BLOCK.ANVIL),
    text: ['An anvil (6 iron ingots) rerolls an item\'s modifiers for 2 iron ingots. Put a weapon, tool, armor or accessory in it and press Reroll.'] },
  { id: 'spyglass', chapter: 'business', x: 0, y: 2, icon: ITEM.SPYGLASS, title: 'Spyglass', deps: ['bronze'], goal: obtained(ITEM.SPYGLASS),
    text: ['Craft a spyglass from 2 bronze ingots and 1 glass at a workbench, or buy one from the Sky Merchant.',
      'Hold right click to look through it: you see much farther and can read the name of any player you look at. You can\'t attack, break or place while looking.',
      'Put it in a Lookout monkey\'s tool slot to double its sight and have it name what it sees.'] },

  // ---- Advanced equipment and defenses (top middle) ----
  { id: 'reinforced', chapter: 'business', x: 3, y: 0, icon: BLOCK.REINFORCED_WALL, title: 'Reinforced Walls', deps: ['iron'],
    goal: made(BLOCK.REINFORCED_WALL), reward: [{ item: BLOCK.STONE_BRICKS, count: 10 }],
    text: [`1 iron ingot and ${REINFORCED_WALL.craftBricks} stone bricks make ${REINFORCED_WALL.craftCount} reinforced walls at a workbench.`,
      'They need an iron hammer and take four times as long to break as stone bricks. They can still be broken.'] },
  { id: 'reinforcedDoor', chapter: 'business', x: 3, y: 2, icon: ITEM.REINFORCED_DOOR, title: 'Reinforced Doors', deps: ['iron'], goal: made(ITEM.REINFORCED_DOOR),
    text: ['A reinforced door (6 iron ingots, at a workbench) only opens for the team that placed it, and needs an iron hammer to break.',
      'Put one in the walls around your keep so your team can come and go and nobody else can.'] },
  { id: 'turret', chapter: 'business', x: 3, y: 1, icon: BLOCK.ARROW_TURRET, title: 'Arrow Turrets', deps: ['iron'], goal: made(BLOCK.ARROW_TURRET),
    text: [`An arrow turret (4 iron ingots, 4 planks) needs the block above it clear. It shoots enemy players and monkeys, goblins and hostile creatures within ${TURRET.range} blocks when it has a clear shot.`,
      'It never shoots your team or your monkeys, needs no ammunition, and switches to the next target when one dies or leaves range.'] },
  { id: 'defense', chapter: 'business', x: 4, y: 1, icon: BLOCK.ARROW_TURRET, title: 'Defending Your Flag', deps: ['turret'], links: ['guard'],
    goal: { all: [made(BLOCK.ARROW_TURRET), event('role:guard')] },
    text: ['Have an arrow turret and a guard monkey watching over your base. Surround your keep with walls, put a reinforced door in them, and post a lookout where raiders will come from.'] },

  // ---- Advanced monkey roles (top right) ----
  { id: 'guard', chapter: 'business', x: 5, y: 0, icon: ITEM.IRON_SWORD, title: 'Guard Monkeys', goal: event('role:guard'),
    text: [`Guard: walks its patrol points in order and loops back to the first; with one point it guards that spot. It attacks enemy players and monkeys, goblins and hostile creatures it can see within ${MONKEY_DUTY.guard.range} blocks.`,
      `It never chases more than ${MONKEY_DUTY.guard.pursuit} blocks from its route, and returns to it after losing its target. The patrol route is drawn while you select its points.`,
      'Give it a sword or axe for melee, or a bow or crossbow to shoot from range (it needs a clear shot). Armor in its armor slot protects it.'] },
  { id: 'lookout', chapter: 'business', x: 6, y: 0, icon: ITEM.SPYGLASS, title: 'Lookout Monkeys', links: ['guard'], goal: event('lookoutSpotted'),
    text: [`Lookout: stands at its post and watches for enemy players and goblins within ${MONKEY_DUTY.lookout.range} blocks, in sight. When it spots one it warns your whole team ("[name] spotted an enemy!").`,
      `It reports each target at most once every ${MONKEY_DUTY.lookout.cooldownSeconds} seconds and never leaves its post. Pick a high post with a wide view.`,
      `With a spyglass in its tool slot it sees ${MONKEY_DUTY.lookout.spyglassRange} blocks and names what it sees: "[name] spotted [player]!" or "[name] spotted a goblin!"`] },
  { id: 'craftsman', chapter: 'business', x: 5, y: 2, icon: BLOCK.WORKBENCH, title: 'Craftsman Monkeys', goal: event('monkeyCrafted'),
    reward: coins(3),
    text: ['Craftsman: give it a source container, a workbench, a recipe and a destination. It fetches ingredients, crafts at the workbench one recipe at a time and delivers what it makes.',
      'It only takes as many sets of ingredients as it can finish and carry, counting stack sizes, unstackable outputs and recipes that make several items. If the destination is full it waits.'] },

  // ---- Steam power (middle left) ----
  { id: 'pipes', chapter: 'business', x: 1, y: 4, icon: BLOCK.BRONZE_PIPE, title: 'Pumps and Pipes', deps: ['bronze'],
    goal: { all: [made(BLOCK.FLUID_PUMP), made(BLOCK.BRONZE_PIPE)] },
    text: ['1 bronze ingot makes 4 bronze pipes; a fluid pump takes 3 bronze ingots and a pipe. A pump touching water pulls it into connected pipes. Pipes carry water and steam between machines and tanks.',
      'Crouch and right click a pipe where it meets a machine to set that connection: blue dot = input into the pipe, orange = output from the pipe, none = automatic.'] },
  { id: 'tank', chapter: 'business', x: 1, y: 5, icon: BLOCK.FLUID_TANK, title: 'Fluid Tanks', deps: ['pipes'], goal: made(BLOCK.FLUID_TANK),
    text: [`A fluid tank (4 bronze ingots, 4 glass) stores ${FLUID.tankCapacity} units of one fluid and joins with neighbouring tanks. Right click a tank to see what it holds.`] },
  { id: 'boiler', chapter: 'business', x: 2, y: 4, icon: BLOCK.BOILER, title: 'Boiler', deps: ['pipes'], goal: made(BLOCK.BOILER),
    text: [`A boiler (a furnace and 4 bronze ingots) burns fuel (charcoal ${FLUID.boilerFuelSeconds.charcoal} s, wood ${FLUID.boilerFuelSeconds.wood} s, lava buckets much longer) to turn ${FLUID.boilerPerSecond} water a second into steam.`,
      'It needs water piped in, fuel in its slot, and a pipe taking its steam to a machine. Its screen tells you which one is missing; a lit boiler puffs a plume.'] },
  { id: 'crusher', chapter: 'business', x: 3, y: 4, icon: BLOCK.CRUSHER, title: 'Crusher', deps: ['boiler'],
    goal: obtained(ITEM.IRON_DUST, ITEM.COPPER_DUST, ITEM.TIN_DUST), reward: [{ item: ITEM.CHARCOAL, count: 8 }],
    text: [`The crusher (4 bronze ingots, 2 stone, 1 pipe) uses ${FLUID.crusherPerSecond} steam a second. Each ore becomes ${FLUID.crusherOreDust} dust in ${FLUID.crusherSeconds} seconds; stone becomes sand.`,
      'Dust smelts into ingots in a furnace or goes straight into the Alloy Furnace, so crushing doubles your metal. With too little steam it runs slowly.'] },

  // ---- Automation (middle) ----
  { id: 'feedMachines', chapter: 'business', x: 4, y: 3, icon: BLOCK.FURNACE, title: 'Feeding Machines', links: ['crusher'],
    goal: event('role:courier'),
    text: ['A courier whose destination is a furnace or alloy furnace puts ore in the input and fuel in the fuel slot by itself.',
      'For each furnace or alloy furnace destination you can choose Automatic, Material input or Fuel input in its configuration: use one courier for charcoal into the fuel slot and another for ore into the input.',
      'Chain a crusher in: one courier carries ore to the crusher and another takes its dust to the alloy furnace.'] },
  { id: 'gatherSplit', chapter: 'business', x: 6, y: 3, icon: ITEM.WOOD_HAMMER, title: 'Specialist Gatherers', links: ['craftsman'],
    goal: { all: [event('role:collector'), { any: [event('role:quarry'), event('role:lumberjack')] }] },
    text: ['Collect drops (on by default) decides whether a gatherer carries what it breaks. Turn it off on a quarry or lumberjack monkey and it leaves the drops on the ground and keeps working without walking back.',
      'Then give a collector monkey a destination chest nearby to bring the drops home.'] },
  { id: 'factory', chapter: 'business', x: 5, y: 3, icon: BLOCK.WORKBENCH, title: 'A Factory', deps: ['craftsman'], links: ['feedMachines'],
    goal: event('monkeyCrafted', 20), reward: coins(6),
    text: ['Have craftsman monkeys craft 20 times. Chain monkeys together: gatherers fill a chest, couriers feed furnaces, a craftsman turns the results into goods, another courier takes them on.',
      'A craftsman crafting the merchant\'s requested goods, with a courier carrying them to the depot, earns coins with nobody watching.'] },

  // ---- Sky Merchant and commerce (right) ----
  { id: 'depot', chapter: 'business', x: 7, y: 3, icon: BLOCK.MERCHANT_DEPOT, title: 'Merchant Depot', goal: event('depotPlaced'),
    text: ['Ask me for a Merchant Depot with the button at the top of this book. Your team can only have one placed at a time; ask again if yours is destroyed or lost.',
      'Place it on your island\'s far edge, facing away from the center island, with open sky in front: the Sky Merchant\'s airship flies in from the far side and docks right in front of it.',
      'Holding the depot shows where the airship would dock (green: clear, red: something in the way).'] },
  { id: 'merchant', chapter: 'business', x: 8, y: 2, icon: ITEM.GOLD_COIN, title: 'The Sky Merchant', deps: ['depot'], goal: event('merchantTrade'),
    reward: coins(5),
    text: ['A traveling merchant from a far-off civilization beyond the islands. He arrives by airship each morning, stays by your depot all day and leaves at night.',
      'Right click him to trade. He buys raw resources and some goods for gold coins and sells resources, equipment and loot. Prices are fixed; valuable goods have a daily stock that refills each morning.',
      'Enemies can kill him; he drops nothing, and a new merchant comes the next morning.'] },
  { id: 'baby', chapter: 'business', x: 8, y: 1, icon: ITEM.MONKEY_EGG, title: 'Baby Monkeys', deps: ['merchant'], goal: event('babyMonkey'),
    text: [`The Sky Merchant sells baby monkeys for gold coins (${MERCHANT.babyBase} for your team's first). Each one your team buys makes the next cost more, for the whole match.`,
      `Babies belong to your team but can't work or fight. They grow into ordinary monkeys after ${Math.round(MONKEY_DUTY.baby.growSeconds / 60)} minutes; right click one to see how long is left.`] },
  { id: 'requests', chapter: 'business', x: 9, y: 2, icon: BLOCK.ARROW_TURRET, title: 'Requested Goods', deps: ['merchant'], goal: event('requestSold'),
    text: ['Each world the merchant asks for a few crafted goods (marked Requested in his trade screen). He pays more for them than their materials would fetch, so making them is worth it.',
      'Buying the materials from him always costs more than he pays, so the coins have to come from your own gathering and work.'] },
  { id: 'autosell', chapter: 'business', x: 8, y: 4, icon: BLOCK.MERCHANT_DEPOT, title: 'Automated Selling', deps: ['depot'], goal: event('autoSale', 10),
    reward: coins(5),
    text: [`Earn 10 coins through the depot. While the merchant is docked, the depot sells one batch from its selling slots every ${MERCHANT.sellTicks / 20} seconds and puts the coins in its coin slots. It only takes items he buys; its screen lists them with their prices.`,
      'Selling stops when he is away or the coin slots are full. Couriers can deliver goods to the depot and take coins out of it.'] },
  { id: 'wealth', chapter: 'business', x: 9, y: 3, icon: ITEM.GOLD_COIN, title: 'A Thriving Trade', deps: ['requests', 'autosell'],
    goal: event('merchantSale', 100), reward: coins(8),
    text: ['Earn 100 gold coins from the merchant, by hand or through the depot. Spend them on monkeys, gear and the materials your islands lack.'] },

  // ---- The central island (bottom left) ----
  { id: 'center', chapter: 'business', x: 0, y: 6, icon: BLOCK.IRON_ORE, title: 'The Central Island', goal: obtained(BLOCK.IRON_ORE),
    text: ['The central island is huge and rich in iron. Goblins live in its lowlands, and its tallest trees sometimes hide wild monkeys you can tame.',
      'Bring a bronze hammer: iron ore needs strength 4. Mine some iron ore to complete this quest.'] },
  { id: 'goblins', chapter: 'business', x: 1, y: 7, icon: ITEM.GOBLIN_SOLDIER_EGG, title: 'Goblins', links: ['center'], goal: event('kill:goblin'),
    reward: [{ item: ITEM.IRON_INGOT, count: 2 }],
    text: ['Goblins build villages and a sealed fortress in the central island\'s lowlands, and keep expanding. Workers, soldiers, archers, brutes and a king defend them, and their walls hide poison traps.',
      'Turrets, guard monkeys and lookouts all treat goblins as enemies.'] },

  // ---- Dragons and rare loot (bottom right) ----
  { id: 'dragons', chapter: 'business', x: 3, y: 7, icon: ITEM.DRAGON_SCALE, title: 'Dragons', goal: { any: [event('kill:dragon'), obtained(ITEM.DRAGON_SCALE)] },
    text: ['Dragons patrol islands of their own, land to rest and breathe fire at anyone nearby. Hurting one makes it hunt you.',
      'They drop iron, leather and Dragon Scales.'] },
  { id: 'dragonscale', chapter: 'business', x: 3, y: 6, icon: ITEM.DRAGONSCALE_ARMOR, title: 'Dragonscale Armor', deps: ['dragons'], goal: obtained(ITEM.DRAGONSCALE_ARMOR),
    text: ['8 Dragon Scales make dragonscale armor at a workbench: the best armor there is, and it shrugs off dragon fire.'] },
  { id: 'lava', chapter: 'business', x: 4, y: 6, icon: ITEM.LAVA_BUCKET, title: 'The Fire Island', links: ['dragonLord'], goal: obtained(ITEM.LAVA_BUCKET),
    text: ['A burning island of basalt and lava floats among the others, with a temple at its heart. Fill a bucket from its lava (right click lava with an empty bucket).',
      'A lava bucket burns far longer than charcoal in furnaces, alloy furnaces and boilers, and the machine hands the empty bucket back.'] },
  { id: 'dragonLord', chapter: 'business', x: 5, y: 7, icon: ITEM.DRAGON_HEART, title: 'The Dragon Lord', hidden: true,
    reveal: obtained(ITEM.LAVA_BUCKET, ITEM.DRAGON_SCALE), goal: obtained(ITEM.DRAGON_CROWN, ITEM.DRAGON_HEART),
    text: ['The portal in the fire temple leads to the Dragon Lord\'s arena. He sleeps until you come close, then fights on the ground and in the air.',
      'Defeating him drops the Dragon Crown (an accessory: +5 maximum health and immunity to fire), a Dragon Heart and Dragon Scales.'] },
  { id: 'accessories', chapter: 'business', x: 6, y: 6, icon: ITEM.HEART_AMULET, title: 'Rare Accessories', links: ['dragonLord'], goal: obtained(...ACCESSORY_ITEMS),
    text: ['Accessories go in the accessory slot of your inventory; you can wear one at a time. They come from loot chests (and the Dragon Crown from the Dragon Lord).',
      'Wind boots: move faster. Spring boots: hold jump to charge a high leap. Heart amulet: +5 maximum health. Mending charm: start healing steadily 5 seconds after being hurt. Ember heart: when a blow would kill you (not a fall into the void) it burns up instead and leaves you with 10 health.'] },
  { id: 'ancient', chapter: 'business', x: 7, y: 7, icon: ITEM.ANCIENT_WATER_MONKEY_EGG, title: 'Ancient Monkeys', hidden: true,
    reveal: { any: ANCIENT_MEETINGS }, goal: { any: ANCIENT_MEETINGS },
    text: ['Ancient Monkeys sit in hidden places: a cave under a gorge, a storm above the peaks, a temple on a burning island. They can\'t be harmed. Right click one to hear what it has to say.',
      'What they want is still a mystery.'] },
];

export const questById = new Map(QUESTS.map((q) => [q.id, q]));
export const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));

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
