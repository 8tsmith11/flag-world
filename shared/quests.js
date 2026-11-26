// The Wise Monkey's quest book, as data: chapters, and quests placed on each
// chapter's graph (x, y in grid cells) with the quests they follow from
// (deps, drawn as lines), what completes them (goal), an optional small
// reward and the knowledge entry (text) that explains the mechanic.
//
// The book is a guide, not a lock: every recipe and mechanic works whether
// or not its quest is done. Progress is per team (server/quests.js) and is
// detected from play: items a member has held (obtained), crafted or
// placed, and milestones (events, see server/teamProgress.js). Rewards are
// claimed once per team.
//
// Goals:
//   { obtained: [ids] }  any of these has been in a member's inventory
//   { crafted: [ids] } / { placed: [ids] }
//   { event: 'name', count }  a milestone happened (count times)
//   { all: [goals] } / { any: [goals] }
// hidden: shown as "???" (no title or text) until a dependency is done or
// its `reveal` goal is met, to keep rare and late things a mystery.
import { BLOCK } from './blocks.js';
import { ITEM } from './itemIds.js';
import { METALS, FLUID, MERCHANT, MONKEY_DUTY, REINFORCED_WALL, SMELT_TIME, FLAG_GRAB_TIME, FLAG_CAPTURE_TIME } from './config.js';

const obtained = (...ids) => ({ obtained: ids });
const crafted = (...ids) => ({ crafted: ids });
const made = (...ids) => ({ any: [{ crafted: ids }, { placed: ids }] });
const event = (name, count = 1) => ({ event: name, count });
const coins = (count) => [{ item: ITEM.GOLD_COIN, count }];

export const CHAPTERS = [
  { id: 'start', name: 'Getting Started', icon: BLOCK.WOOD,
    intro: 'Your keep, your flag and your first tools. Everything else grows from wood and stone.' },
  { id: 'explore', name: 'Exploration', icon: ITEM.GLIDER,
    intro: 'Floating islands, the void between them, and what lives out there.' },
  { id: 'monkeys', name: 'Monkeys', icon: ITEM.MONKEY_EGG,
    intro: 'Monkeys work, guard and watch for your team. Find them, win their trust, give them a job.' },
  { id: 'building', name: 'Building', icon: BLOCK.STONE_BRICKS,
    intro: 'Walls, doors and turrets keep your flag safe.' },
  { id: 'metal', name: 'Metallurgy', icon: ITEM.BRONZE_INGOT,
    intro: 'Ore becomes ingots, ingots become bronze, and metal tools open the world.' },
  { id: 'steam', name: 'Steam Power', icon: BLOCK.BOILER,
    intro: 'Pumps, pipes, boilers and crushers: double your ore with steam.' },
  { id: 'automation', name: 'Automation', icon: BLOCK.CHEST,
    intro: 'Let monkeys move, gather and craft so your factories run on their own.' },
  { id: 'commerce', name: 'Commerce', icon: ITEM.GOLD_COIN,
    intro: 'The Sky Merchant flies in each morning. Sell what you make, buy what you lack.' },
  { id: 'warfare', name: 'Warfare', icon: ITEM.IRON_SWORD,
    intro: 'Weapons, armor and the enemies who want your flag.' },
];

export const QUESTS = [
  // ---- Getting Started ----
  { id: 'wood', chapter: 'start', x: 0, y: 1, icon: BLOCK.WOOD, title: 'Wood', goal: obtained(BLOCK.WOOD),
    text: ['Hold left click on a tree trunk to break it. Bare hands are enough for wood, dirt, sand and leaves.',
      'Breaking a block drops it as an item; walk over it to pick it up. Leaves sometimes drop saplings.'] },
  { id: 'planks', chapter: 'start', x: 1, y: 1, icon: BLOCK.PLANKS, title: 'Planks', deps: ['wood'], goal: crafted(BLOCK.PLANKS),
    text: ['Press E to open your inventory. Its crafting list shows every recipe your team has found an ingredient for.',
      'One wood makes four planks. Planks make torches, ladders, a workbench and more.'] },
  { id: 'workbench', chapter: 'start', x: 2, y: 1, icon: BLOCK.WORKBENCH, title: 'Workbench', deps: ['planks'], goal: made(BLOCK.WORKBENCH),
    reward: [{ item: BLOCK.TORCH, count: 8 }],
    text: ['Craft a workbench from 4 planks and place it with right click. Right click the workbench to use it.',
      'Most tools, weapons, machines and armor can only be crafted at a workbench.'] },
  { id: 'hammer', chapter: 'start', x: 3, y: 0, icon: ITEM.WOOD_HAMMER, title: 'Hammers', deps: ['workbench'],
    goal: crafted(ITEM.WOOD_HAMMER, ITEM.STONE_HAMMER),
    text: ['Hammers are the only breaking tools. A block can only be broken by a hammer whose strength is at least the block\'s hardness, and better hammers break faster.',
      'Wood hammer: strength 2. Stone hammer: strength 3 (breaks copper and tin ore). Bronze: 4 (iron ore). Iron: 5 (stone bricks, reinforced walls).'] },
  { id: 'stone', chapter: 'start', x: 4, y: 0, icon: BLOCK.STONE, title: 'Stone', deps: ['hammer'], goal: obtained(BLOCK.STONE),
    text: ['Stone needs a wooden hammer or better. Look under the grass, in cliffs, or in caves.',
      'Quarry Stones (dark blocks with glowing seams) regrow stone on their open faces every few seconds: mine around them for an endless supply.'] },
  { id: 'keep', chapter: 'start', x: 1, y: 3, icon: BLOCK.PEDESTAL, title: 'Your Keep and Flag', goal: obtained(BLOCK.WOOD),
    text: ['Your team spawns in its keep, beside your flag on its golden pedestal. Nobody can break the keep or build inside it.',
      `To steal a flag, stand on an enemy pedestal for ${FLAG_GRAB_TIME} seconds. Carry it home and stand on your own pedestal for ${FLAG_CAPTURE_TIME} seconds while your flag is home to capture it.`,
      'A team whose flag is captured can no longer respawn: each member who dies is out. The last team standing wins.'] },
  { id: 'food', chapter: 'start', x: 3, y: 3, icon: ITEM.COOKED_BEEF, title: 'Food and Health', deps: ['workbench'],
    goal: obtained(ITEM.BEEF, ITEM.BREAD, ITEM.COOKED_BEEF),
    text: ['You heal slowly on your own a while after being hurt. Food heals faster: hold right click with food in hand while hurt.',
      'Cows drop beef and leather. Cook beef in a furnace. Wheat makes bread (3 wheat).'] },
  { id: 'farming', chapter: 'start', x: 4, y: 3, icon: ITEM.WHEAT, title: 'Farming', deps: ['food'], goal: obtained(ITEM.WHEAT),
    reward: [{ item: ITEM.WHEAT_SEEDS, count: 4 }],
    text: ['Breaking grass tufts and ferns sometimes gives wheat seeds. Right click grass or dirt with a hoe to till farmland, then right click farmland with seeds to plant.',
      'Crops grow by themselves. Right click a ripe crop to harvest it and replant. Feed wheat to two cows to breed them.'] },

  // ---- Exploration ----
  { id: 'islands', chapter: 'explore', x: 0, y: 1, icon: BLOCK.GRASS, title: 'The Floating Islands', goal: obtained(BLOCK.DIRT, BLOCK.WOOD),
    text: ['Your team\'s island floats beside the great central island, with small islands scattered around and above. Below is the void: falling in kills you and your items are lost.',
      'Small islands hold tin, a little iron, loot chests and wild monkeys. The central island holds much more iron, goblins and older things.'] },
  { id: 'bridge', chapter: 'explore', x: 1, y: 0, icon: ITEM.LADDER, title: 'Crossing the Gaps', deps: ['islands'], goal: made(ITEM.LADDER, BLOCK.PLANKS),
    text: ['Build bridges by placing blocks against the edge of the one you stand on. Crouch (Shift) to stop yourself walking off an edge.',
      'Jump and place a block under your feet to tower straight up. Ladders and rope can be climbed.'] },
  { id: 'glider', chapter: 'explore', x: 2, y: 0, icon: ITEM.GLIDER, title: 'Glider', deps: ['bridge'], goal: obtained(ITEM.GLIDER),
    text: ['Craft a glider from 3 leather and 2 wood at a workbench. Hold it and hold right click in the air to glide down slowly.',
      'Gliding lets you cross gaps from high ground, but Void Eels may knock you out of the air.'] },
  { id: 'loot', chapter: 'explore', x: 2, y: 2, icon: BLOCK.CHEST, title: 'Loot', deps: ['islands'],
    goal: obtained(ITEM.WIND_AXE, ITEM.ICE_SWORD, ITEM.CROSSBOW, ITEM.ROPE_BUNDLE, ITEM.GRAPPLING_HOOK, ITEM.GOLDEN_BEEF, ITEM.SPRING_BOOTS, ITEM.WIND_BOOTS, ITEM.HEART_AMULET, ITEM.MENDING_CHARM),
    reward: coins(4),
    text: ['Chests in ruins, towers, caves and dungeons hold loot you can\'t craft: the crossbow, grappling hook, rope bundles, wind axe, ice sword and accessories.',
      'Loot weapons and armor may carry modifiers. Accessories go in the accessory slot of your inventory.'] },
  { id: 'eels', chapter: 'explore', x: 3, y: 1, icon: ITEM.RIFT_ORB, title: 'Void Eels', deps: ['glider'], hidden: true,
    reveal: obtained(ITEM.RIFT_ORB), goal: obtained(ITEM.RIFT_ORB),
    text: ['Void Eels swim under the islands and lunge at anyone exposed over the void, especially at night.',
      'Killing one drops Rift Orbs. Throw a Rift Orb (right click) to open a portal back to your keep for a short time.'] },
  { id: 'spyglass', chapter: 'explore', x: 3, y: 3, icon: ITEM.SPYGLASS, title: 'Spyglass', deps: ['islands'], goal: obtained(ITEM.SPYGLASS),
    text: ['Craft a spyglass from 2 bronze ingots and 1 glass at a workbench, or buy one from the Sky Merchant.',
      'Hold right click to look through it: you see much farther and can read the name of any player you look at. You can\'t attack while looking.',
      'Put it in a Lookout monkey\'s tool slot to double its sight and have it name what it sees.'] },
  { id: 'center', chapter: 'explore', x: 4, y: 1, icon: BLOCK.IRON_ORE, title: 'The Central Island', deps: ['bridge'],
    goal: obtained(BLOCK.IRON_ORE, ITEM.IRON_INGOT),
    text: ['The central island is huge and rich in iron. Goblins live in its lowlands, and its tallest trees sometimes hide wild monkeys.',
      'Bring a bronze hammer: iron ore needs strength 4.'] },
  { id: 'ancient', chapter: 'explore', x: 5, y: 1, icon: ITEM.ANCIENT_WATER_MONKEY_EGG, title: 'Ancient Things', deps: ['center'], hidden: true,
    reveal: obtained(ITEM.DRAGON_SCALE), goal: obtained(ITEM.DRAGON_SCALE, ITEM.DRAGON_HEART),
    text: ['Ancient Monkeys sit in hidden places: a cave under a gorge, a storm above the peaks, a temple on a burning island. What they want is still a mystery.',
      'Dragons guard islands of their own. They drop iron, leather and Dragon Scales, which make armor that shrugs off dragon fire.'] },

  // ---- Monkeys ----
  { id: 'tame', chapter: 'monkeys', x: 0, y: 1, icon: ITEM.MONKEY_EGG, title: 'Taming a Monkey', goal: event('tame'),
    reward: [{ item: ITEM.BREAD, count: 3 }],
    text: ['Wild monkeys live on team islands, some small islands and (rarely) in the central island\'s tallest trees. Right click one to play its game; win and it joins your team.',
      'Games: Simon (repeat its jumps and crouches), card memory (match the pairs) and cup shuffle (follow the ball).',
      'Right click a tamed monkey to configure it: pick a role, select blocks in the world for it, and give it a tool and armor. Your own team can\'t hurt it.'] },
  { id: 'courier', chapter: 'monkeys', x: 1, y: 0, icon: BLOCK.CHEST, title: 'Couriers and Collectors', deps: ['tame'],
    goal: { any: [event('role:courier'), event('role:collector')] },
    text: ['Courier: takes items out of its source containers and delivers them to its destinations in turn. From machines it only takes the output.',
      'Collector: picks up dropped items within its range of its first destination and delivers them.',
      'The item filter (all except / only these) limits what any monkey carries.'] },
  { id: 'gatherers', chapter: 'monkeys', x: 1, y: 2, icon: ITEM.STONE_HAMMER, title: 'Gatherers', deps: ['tame'],
    goal: { any: [event('role:lumberjack'), event('role:quarry'), event('role:farmer')] },
    text: ['Lumberjack: chops whole grown trees at its tree sites and replants saplings. Quarry: digs a box, circle or single blocks, never opening a hole into the void. Farmer: harvests and replants ripe crops in its area.',
      'Breaking speed and strength come from the hammer in its tool slot, like yours.',
      'Collect drops (on by default): with it off, a gatherer leaves what it breaks on the ground and keeps working. Pair it with a Collector to split the work.'] },
  { id: 'guard', chapter: 'monkeys', x: 2, y: 0, icon: ITEM.IRON_SWORD, title: 'Guard Monkeys', deps: ['courier'], goal: event('role:guard'),
    text: [`Guard: walks its patrol points in order and loops back to the first; with one point it guards that spot. It attacks enemy players and monkeys, goblins and hostile creatures it can see within ${MONKEY_DUTY.guard.range} blocks.`,
      `It never chases more than ${MONKEY_DUTY.guard.pursuit} blocks from its route, and returns to it after losing its target. The patrol route is drawn while you select its points.`,
      'Give it a sword or axe for melee, or a bow or crossbow to shoot from range (it needs a clear shot). Armor in its armor slot protects it.'] },
  { id: 'lookout', chapter: 'monkeys', x: 3, y: 0, icon: ITEM.SPYGLASS, title: 'Lookout Monkeys', deps: ['guard'], goal: event('lookoutSpotted'),
    text: [`Lookout: stands at its post and watches for enemy players and goblins within ${MONKEY_DUTY.lookout.range} blocks, in sight. When it spots one it warns your whole team ("[name] spotted an enemy!").`,
      `It reports each target at most once every ${MONKEY_DUTY.lookout.cooldownSeconds} seconds and never leaves its post. Pick a high post with a wide view.`,
      `With a spyglass in its tool slot it sees ${MONKEY_DUTY.lookout.spyglassRange} blocks and names what it sees: "[name] spotted [player]!" or "[name] spotted a goblin!"`] },
  { id: 'craftsman', chapter: 'monkeys', x: 2, y: 2, icon: BLOCK.WORKBENCH, title: 'Craftsman Monkeys', deps: ['gatherers'], goal: event('monkeyCrafted'),
    reward: coins(3),
    text: ['Craftsman: give it a source container, a workbench, a recipe and a destination. It fetches ingredients, crafts at the workbench one recipe at a time and delivers what it makes.',
      'It only takes as many sets of ingredients as it can finish and carry, counting stack sizes, unstackable outputs and recipes that make several items. If the destination is full it waits.'] },
  { id: 'baby', chapter: 'monkeys', x: 4, y: 1, icon: ITEM.MONKEY_EGG, title: 'Baby Monkeys', deps: ['tame'], goal: event('babyMonkey'),
    text: [`The Sky Merchant sells baby monkeys for gold coins (${MERCHANT.babyBase} for your team's first). Each one your team buys makes the next cost more, for the whole match.`,
      `Babies belong to your team but can't work or fight. They grow into ordinary monkeys after ${Math.round(MONKEY_DUTY.baby.growSeconds / 60)} minutes; right click one to see how long is left.`] },

  // ---- Building ----
  { id: 'bricks', chapter: 'building', x: 0, y: 1, icon: BLOCK.STONE_BRICKS, title: 'Stone Bricks', deps: ['stone'], goal: crafted(BLOCK.STONE_BRICKS),
    text: ['One stone makes one stone brick, anywhere. Stone bricks need an iron hammer (strength 5) to break, so they make strong walls.'] },
  { id: 'doors', chapter: 'building', x: 1, y: 0, icon: ITEM.DOOR, title: 'Doors', deps: ['bricks'], goal: made(ITEM.DOOR, ITEM.REINFORCED_DOOR),
    text: ['Doors are two blocks tall; right click to open or close. Anyone can open a wooden door.',
      'A reinforced door (6 iron ingots) only opens for the team that placed it, and needs an iron hammer to break.'] },
  { id: 'reinforced', chapter: 'building', x: 2, y: 1, icon: BLOCK.REINFORCED_WALL, title: 'Reinforced Walls', deps: ['bricks'],
    goal: made(BLOCK.REINFORCED_WALL), reward: [{ item: BLOCK.STONE_BRICKS, count: 10 }],
    text: [`1 iron ingot and ${REINFORCED_WALL.craftBricks} stone bricks make ${REINFORCED_WALL.craftCount} reinforced walls at a workbench.`,
      'They need an iron hammer and take four times as long to break as stone bricks, and they resist explosions. They can still be broken.'] },
  { id: 'turret', chapter: 'building', x: 3, y: 0, icon: BLOCK.ARROW_TURRET, title: 'Arrow Turrets', deps: ['doors'], goal: made(BLOCK.ARROW_TURRET),
    text: ['An arrow turret (4 iron ingots, 4 planks) needs the block above it clear. It shoots enemy players and monkeys, goblins and hostile creatures within 20 blocks when it has a clear shot.',
      'It never shoots your team or your monkeys, needs no ammunition, and switches to the next target when one dies or leaves range.'] },
  { id: 'light', chapter: 'building', x: 3, y: 2, icon: BLOCK.TORCH, title: 'Light', deps: ['bricks'], goal: made(BLOCK.TORCH),
    text: ['Torches light caves and nights. Place them on floors or walls. Nights are dark but short.'] },

  // ---- Metallurgy ----
  { id: 'furnace', chapter: 'metal', x: 0, y: 1, icon: BLOCK.FURNACE, title: 'Furnace', deps: ['stone'], goal: made(BLOCK.FURNACE),
    text: ['A furnace (8 stone, at a workbench) smelts ore into ingots, sand into glass, wood into charcoal and beef into cooked beef.',
      `Put what to smelt in the top slot and fuel in the bottom slot; each item takes ${SMELT_TIME} seconds. Charcoal smelts 8 items, wood 2, planks 1, a lava bucket many more.`,
      'Its screen shows what it is doing and why it stopped (missing fuel, output full...). Take results from the output slot.'] },
  { id: 'copper', chapter: 'metal', x: 1, y: 0, icon: ITEM.COPPER_INGOT, title: 'Copper and Tin', deps: ['furnace'],
    goal: { all: [obtained(ITEM.COPPER_INGOT), obtained(ITEM.TIN_INGOT)] }, reward: [{ item: ITEM.CHARCOAL, count: 4 }],
    text: ['Copper ore is common on your island; tin is rare there but plentiful on the small islands. Both need a stone hammer.',
      'Smelt them into ingots, or feed them straight into an Alloy Furnace.'] },
  { id: 'alloy', chapter: 'metal', x: 2, y: 1, icon: BLOCK.ALLOY_FURNACE, title: 'Alloy Furnace and Bronze', deps: ['copper'],
    goal: obtained(ITEM.BRONZE_INGOT), reward: [{ item: ITEM.TIN_INGOT, count: 2 }],
    text: [`Build it from a furnace and ${METALS.crafting.alloyFurnaceCopper} copper ingots at a workbench. It has three ingredient slots, a fuel slot and an output.`,
      `${METALS.alloy.copper} copper and ${METALS.alloy.tin} tin make ${METALS.alloy.output} bronze ingots in ${METALS.alloy.seconds} seconds. Copper and tin count in any form: ore, dust or ingot each count as one, and you can mix them.`,
      'Crushing ore first gives two dust per ore, so a crusher doubles your bronze. Its screen shows how much copper and tin it holds and what is missing.',
      'Bronze makes hammers that break iron ore, swords, armor, pipes, tanks, pumps, boilers, crushers and spyglasses.'] },
  { id: 'bronzeTools', chapter: 'metal', x: 3, y: 0, icon: ITEM.BRONZE_HAMMER, title: 'Bronze Tools', deps: ['alloy'],
    goal: crafted(ITEM.BRONZE_HAMMER, ITEM.BRONZE_SWORD, ITEM.BRONZE_ARMOR),
    text: ['A bronze hammer (strength 4) breaks iron ore. Bronze swords and armor are a solid step up from stone and leather.'] },
  { id: 'iron', chapter: 'metal', x: 4, y: 1, icon: ITEM.IRON_INGOT, title: 'Iron', deps: ['bronzeTools'], goal: obtained(ITEM.IRON_INGOT),
    text: ['Iron ore is on the small islands and, far more, on the central island. Smelt it, or crush it first for double.',
      'Iron makes the iron hammer (strength 5), iron swords and armor, reinforced doors and walls, arrow turrets and anvils.'] },
  { id: 'anvil', chapter: 'metal', x: 5, y: 0, icon: BLOCK.ANVIL, title: 'Anvil', deps: ['iron'], goal: made(BLOCK.ANVIL),
    text: ['An anvil (6 iron) rerolls an item\'s modifiers for 2 iron ingots. Put a weapon, tool, armor or accessory in it and press Reroll.'] },

  // ---- Steam Power ----
  { id: 'pipes', chapter: 'steam', x: 0, y: 1, icon: BLOCK.BRONZE_PIPE, title: 'Pumps and Pipes', deps: ['alloy'],
    goal: { all: [made(BLOCK.FLUID_PUMP), made(BLOCK.BRONZE_PIPE)] },
    text: ['A fluid pump touching water pulls it into connected bronze pipes. Pipes carry water and steam between machines and tanks.',
      'Crouch and right click a pipe where it meets a machine to set that connection: blue dot = input into the pipe, orange = output from the pipe, none = automatic.'] },
  { id: 'tank', chapter: 'steam', x: 1, y: 0, icon: BLOCK.FLUID_TANK, title: 'Fluid Tanks', deps: ['pipes'], goal: made(BLOCK.FLUID_TANK),
    text: [`Tanks store ${FLUID.tankCapacity} units of one fluid and join with neighbouring tanks. Right click a tank to see what it holds.`] },
  { id: 'boiler', chapter: 'steam', x: 2, y: 1, icon: BLOCK.BOILER, title: 'Boiler', deps: ['pipes'], goal: made(BLOCK.BOILER),
    text: [`A boiler burns fuel (charcoal ${FLUID.boilerFuelSeconds.charcoal} s, wood ${FLUID.boilerFuelSeconds.wood} s) to turn ${FLUID.boilerPerSecond} water a second into steam.`,
      'It needs water piped in, fuel in its slot, and a pipe taking its steam to a machine. Its screen tells you which one is missing; a lit boiler puffs a plume.'] },
  { id: 'crusher', chapter: 'steam', x: 3, y: 1, icon: BLOCK.CRUSHER, title: 'Crusher', deps: ['boiler'],
    goal: obtained(ITEM.IRON_DUST, ITEM.COPPER_DUST, ITEM.TIN_DUST), reward: [{ item: ITEM.CHARCOAL, count: 8 }],
    text: [`The crusher uses ${FLUID.crusherPerSecond} steam a second. Each ore becomes ${FLUID.crusherOreDust} dust in ${FLUID.crusherSeconds} seconds; stone becomes sand.`,
      'Dust smelts into ingots in a furnace or goes straight into the Alloy Furnace, so crushing doubles your metal. With too little steam it runs slowly.'] },

  // ---- Automation ----
  { id: 'chests', chapter: 'automation', x: 0, y: 1, icon: BLOCK.CHEST, title: 'Chests and Sorting', deps: ['workbench'], goal: made(BLOCK.CHEST),
    text: ['A chest (8 planks) holds 27 stacks. Shift-click moves stacks between it and your inventory.',
      'The Sort buttons merge partial stacks and group identical items: on your inventory it sorts the main grid (your hotbar stays as it is); on a chest, the whole chest.'] },
  { id: 'feedFurnace', chapter: 'automation', x: 1, y: 0, icon: BLOCK.FURNACE, title: 'Feeding Machines', deps: ['chests', 'courier'],
    goal: event('role:courier'),
    text: ['Couriers put items into machines: ore into a furnace\'s input and fuel into its fuel slot automatically.',
      'For a furnace or alloy furnace destination you can choose Automatic, Material input or Fuel input. Use one courier for coal into the fuel slot and another for ore into the input.'] },
  { id: 'gatherSplit', chapter: 'automation', x: 1, y: 2, icon: ITEM.WOOD_HAMMER, title: 'Specialist Gatherers', deps: ['gatherers'],
    goal: { all: [event('role:collector'), { any: [event('role:quarry'), event('role:lumberjack')] }] },
    text: ['Turn off Collect drops on a quarry or lumberjack monkey so it never stops to walk back, and let a collector bring the drops home.'] },
  { id: 'factory', chapter: 'automation', x: 2, y: 1, icon: BLOCK.WORKBENCH, title: 'A Factory', deps: ['feedFurnace', 'craftsman'],
    goal: event('monkeyCrafted', 20), reward: coins(6),
    text: ['Chain monkeys together: gatherers fill a chest, couriers feed furnaces, a craftsman turns the results into goods, another courier takes them on.',
      'A craftsman crafting the merchant\'s requested goods, with a courier carrying them to the depot, earns coins with nobody watching.'] },

  // ---- Commerce ----
  { id: 'depot', chapter: 'commerce', x: 0, y: 1, icon: BLOCK.MERCHANT_DEPOT, title: 'Merchant Depot', goal: event('depotPlaced'),
    text: ['Ask me for a Merchant Depot with the button at the top of this book. Your team can only have one placed at a time; ask again if yours is destroyed or lost.',
      'Place it on your island\'s far edge, facing away from the center island, with open sky in front: the Sky Merchant\'s airship flies in from the far side and docks right in front of it.',
      'Holding the depot shows where the airship would dock (green: clear, red: something in the way).'] },
  { id: 'merchant', chapter: 'commerce', x: 1, y: 0, icon: ITEM.GOLD_COIN, title: 'The Sky Merchant', deps: ['depot'], goal: event('merchantTrade'),
    reward: coins(5),
    text: ['A traveling merchant from a far-off civilization beyond the islands. He arrives by airship each morning, stays by your depot all day and leaves at night.',
      'Right click him to trade. He buys raw resources and some goods for gold coins and sells resources, equipment and loot. Prices are fixed; valuable goods have a daily stock that refills each morning.',
      'Enemies can kill him; he drops nothing, and a new merchant comes the next morning.'] },
  { id: 'requests', chapter: 'commerce', x: 2, y: 0, icon: BLOCK.ARROW_TURRET, title: 'Requested Goods', deps: ['merchant'], goal: event('requestSold'),
    text: ['Each world the merchant asks for a few crafted goods (marked Requested in his trade screen). He pays more for them than their materials would fetch, so making them is worth it.',
      'Buying the materials from him always costs more than he pays, so the coins have to come from your own gathering and work.'] },
  { id: 'autosell', chapter: 'commerce', x: 2, y: 2, icon: BLOCK.MERCHANT_DEPOT, title: 'Automated Selling', deps: ['depot'], goal: event('autoSale', 10),
    reward: coins(5),
    text: [`While the merchant is docked, the depot sells one batch from its selling slots every ${MERCHANT.sellTicks / 20} seconds and puts the coins in its coin slots. It only takes items he buys; its screen lists them with their prices.`,
      'Selling stops when he is away or the coin slots are full. Couriers can deliver goods to the depot and take coins out of it.'] },
  { id: 'wealth', chapter: 'commerce', x: 3, y: 1, icon: ITEM.GOLD_COIN, title: 'A Thriving Trade', deps: ['requests', 'autosell'],
    goal: event('merchantSale', 100), reward: coins(8),
    text: ['Earn 100 gold coins from the merchant. Spend them on monkeys, gear and the materials your islands lack.'] },

  // ---- Warfare ----
  { id: 'weapon', chapter: 'warfare', x: 0, y: 1, icon: ITEM.WOOD_SWORD, title: 'Weapons', deps: ['workbench'],
    goal: crafted(ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.BRONZE_SWORD, ITEM.IRON_SWORD, ITEM.BOW),
    text: ['Swords deal more damage than fists. A bow (hold right click to draw, release to shoot) has unlimited arrows; a fuller draw flies farther and hits harder.',
      'Knocking enemies off an island into the void kills them.'] },
  { id: 'armor', chapter: 'warfare', x: 1, y: 0, icon: ITEM.LEATHER_ARMOR, title: 'Armor', deps: ['weapon'],
    goal: obtained(ITEM.LEATHER_ARMOR, ITEM.BRONZE_ARMOR, ITEM.IRON_ARMOR, ITEM.DRAGONSCALE_ARMOR),
    text: ['Armor goes in the armor slot of your inventory and reduces damage. Leather < bronze < iron < dragonscale (which also stops dragon fire).'] },
  { id: 'goblins', chapter: 'warfare', x: 2, y: 1, icon: ITEM.GOBLIN_SOLDIER_EGG, title: 'Goblins', deps: ['weapon'], goal: event('kill:goblin'),
    reward: [{ item: ITEM.IRON_INGOT, count: 2 }],
    text: ['Goblins build villages and a sealed fortress in the central island\'s lowlands, and keep expanding. Workers, soldiers, archers, brutes and a king defend them.',
      'Turrets, guard monkeys and lookouts all treat goblins as enemies.'] },
  { id: 'creatures', chapter: 'warfare', x: 2, y: 3, icon: ITEM.CRAWLER_EGG, title: 'Hostile Creatures', deps: ['weapon'],
    goal: { any: [event('kill:crawler'), event('kill:eel'), event('kill:dragon')] },
    text: ['Crawlers lurk in caves and dungeons and drop silk. Void Eels hunt under the islands. Dragons patrol their islands and breathe fire.',
      'Hurting one makes it hunt you until it loses sight of you for a while.'] },
  { id: 'defense', chapter: 'warfare', x: 3, y: 0, icon: BLOCK.ARROW_TURRET, title: 'Defending Your Flag', deps: ['armor', 'turret', 'guard'],
    goal: { all: [made(BLOCK.ARROW_TURRET), event('role:guard')] },
    text: ['Surround your keep with walls, turrets and guard monkeys, and post a lookout where raiders will come from. Reinforced doors let your team through and nobody else.'] },
  { id: 'raid', chapter: 'warfare', x: 4, y: 1, icon: BLOCK.PEDESTAL, title: 'Raiding', deps: ['defense'], goal: event('kill:player'),
    text: ['Defeat an enemy player. Then go for their flag: an enemy team without its flag can\'t respawn.'] },
];

export const questById = new Map(QUESTS.map((q) => [q.id, q]));

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
