// Goblin tuning: every number the Goblin Fortress, its Totem, its goblins,
// their projects and the offscreen simulation use lives here. Module shapes
// and surface building templates are in goblinModules.js. Distances in
// blocks, times in seconds, speeds in blocks/s. Caps given per world size are
// { small, medium, large }.

// Speeds up every goblin timer (project pacing, spawning, digging, placing,
// chopping, plot tree growth, waits) for testing. Walking speeds are physics
// and stay as they are. GOBLIN_TIME_SCALE in the server's environment
// overrides it.
const envScale = Number(globalThis.process?.env?.GOBLIN_TIME_SCALE);
export const goblinTimeScale = envScale > 0 ? envScale : 1;

export const GOBLINS = {
  goblinTimeScale,

  // Where world gen puts the fortress in the central island (islands.js).
  placement: {
    // A ring around the island's center, as fractions of its radius. The
    // outer edge is only where the start is picked; the terrain checks below
    // decide what actually fits. Runtime expansion never comes inside
    // ringInner either.
    ringInner: 0.3,
    ringOuter: 0.62,
    // Natural stone kept around the fortress: under its floor, over its roof
    // and beside it (checked against the island's column mask, since the
    // island tapers with depth).
    underside: 3,
    cover: 5,
    side: 3,
    // The fortress sits this far above the deepest spot it fits (never
    // closer than `cover` to the surface), leaving stone below to grow into.
    floorLift: 10,
    // Where the island is too thin, its underside is deepened under the
    // fortress, rising by keelSlope blocks per block out from it.
    keelSlope: 1.5,
    // Caves stay this far from any module.
    caveClearance: 2,
    attempts: 400,
    // Starting fortress: hallway/junction/corner modules between the Totem
    // Hall and the Quarry room, the chance one of them is a dead-end branch
    // (making a junction), and the chance of a ladder shaft to a second level.
    connectors: [3, 5],
    branchChance: 0.6,
    shaftChance: 0.5,
    // Chance a path keeps its direction instead of turning.
    straightChance: 0.55,
  },

  // What a new match starts with. Planks: enough to ladder the planned
  // surface shaft, plus `extraPlanks`.
  start: { workers: 1, extraPlanks: 80, saplings: 9 },

  // Totem storage. Stone becomes Goblin Bricks 1:1 and wood becomes
  // planksPerWood planks, both only when something needs them.
  materials: {
    planksPerWood: 4,
    // Storage counts below which wood gathering gets priority,
    // and below which a tree plot may be built ("wood is low", counting wood
    // as planks).
    woodWanted: 100,
    woodLow: 100,
  },

  // How goblins break blocks: like a player's hammer of this strength and
  // speed, except any hardness can be broken; each point of hardness above
  // `strength` adds that much again to the time (harder blocks take much
  // longer). Placing a block takes placeTime.
  breaking: { strength: 2, speed: 1, hardnessScale: 1, placeTime: 0.5 },

  // Project pacing: the rest between finishing one project and starting the
  // next, and how often the controller looks for work.
  projects: {
    cooldown: 0,
    relocationBuildings: 6,
    relocationModules: { small: 8, medium: 10, large: 12 },
    relocationNearBase: 35,
    relocationWidth: 3,
    // Dwellings are due when the population is within this of capacity.
    dwellingSlack: 1,
    // Repairs: how long after a change before goblins treat it as damage
    // (their own work settles first), and the rescan interval for sites.
    repairDelay: 2,
  },
  invasion: { scanTicks: 5, calmSeconds: 30 },
  navigation: { surfaceMaxNodes: 1500, chamberMaxNodes: 500, safeDrop: 1 },
  optimization: { farPlayerRange: 40, farAITicks: 5 },
  creativeBoost: { workSecondsPerTick: 1500, growthAheadSeconds: 600, idleStopTicks: 100,
    materialGrant: 10000 },
  walls: { startBuildings: 6, sectionSize: 2, sectionMargin: 4, outerMargin: 2,
    height: 3, gateWidth: 2, clearMargin: 3, maxFlatten: 10, postHeight: 4,
    outerLocalFlatten: 2, riverClearance: 3 },

  // Caps by world size.
  caps: {
    modules: { small: 25, medium: 35, large: 50 },
    dwellings: { small: 18, medium: 30, large: 42 },
    plots: { small: 1, medium: 1, large: 2 },
    population: { small: 25, medium: 40, large: 60 },
    // Natural trees goblins may ever chop, before relying on their plots.
    naturalTrees: 4,
  },

  population: {
    // Capacity from the Totem Hall, and from each Bunk Room.
    hallCapacity: 3,
    bunkCapacity: 2,
    spawnInterval: 180,
    slots: ['goblinWorker', 'goblinSoldier', 'goblinSoldier', 'goblinSoldier', 'goblinArcher', 'goblinWorker'],
    repeatSlots: ['goblinSoldier', 'goblinSoldier', 'goblinArcher', 'goblinSoldier', 'goblinWorker'],
    // Target shares when neither labor nor materials is the bottleneck.
  },

  // Fortress growth (goblinProjects.js). A candidate cell is scored for
  // staying on the ring (radial distance from the island center near the
  // fortress's own), for wrapping around it (angle away from the start), and
  // a random jitter; the best one wins.
  expansion: {
    radialWeight: 1.2,
    wrapWeight: 3,
    jitter: 2.5,
    // Chance of growing a ladder shaft, and then of the next module going
    // up or down from one.
    shaftWeight: 0.8,
    verticalChance: 0.35,
    // Levels (cell y) the fortress may use, relative to the Totem Hall.
    minLevel: -1,
    maxLevel: 3,
    // Stone kept under a module's floor (never digging out the underside).
    underside: 2,
    // A module can rise out of the ground only if its floor is at most this
    // far above the lowest surface under it.
    emergeFloor: 1,
    // Chance a cell that pokes out of the island's side is allowed (a sealed
    // room at the end of a hallway; nothing grows past it).
    cliffChance: 0.5,
    // Module types for horizontal growth and their weights; bunkWeight
    // replaces bunkRoom's weight when the population is near capacity.
    types: { room: 2.5, hallway: 3, corner: 2, junctionT: 1.5, junctionCross: 0.5, bunkRoom: 1, ladderShaft: 0.8 },
    bunkWeight: 5,
    // Blocks kept clear of structures, keeps and rivers.
    clearance: 2,
  },

  // The surface shaft's spot and the gatehouse around its top.
  entrance: {
    // Kept this far from keeps, structures, rivers and the world edge.
    clearance: 6,
    // Spots are ranked by the gatehouse's ground: each block of height off
    // the shaft's top counts 1, each column not solid solidDepth blocks down
    // counts 2; one is picked at random among those within roughSlack of
    // the smoothest.
    solidDepth: 3,
    roughSlack: 6,
    // Each block of the spot's height above the island's usual surface counts this much.
    heightWeight: 3,
  },

  // Surface buildings: within `radius` of an entrance, on ground whose
  // height varies by at most `maxSlope` over the footprint.
  surface: {
    radius: 50,
    innerRadiusFraction: 0.35,
    clearMargin: 3,
    treeReach: 4,
    treeHeight: 16,
    maxSlope: 3,
    plotMaxSlope: 6,
    attempts: 300,
    // Ground under a site must be solid solidDepth blocks down in all but
    // hollowShare of its columns.
    solidDepth: 2,
    hollowShare: 0.05,
    // Tree plots are filled level with dirt, so they take rougher ground.
    plotHollowShare: 0.35,
    // Natural trees are chopped within this of an entrance.
    treeRadius: 80,
    // Space kept between goblin surface buildings, and from keeps/structures/rivers.
    spacing: 3,
    clearance: 5,
  },

  // Tree plots: a 3x3 grid of saplings `spacing` apart inside a plank border.
  plots: {
    grid: 3,
    spacing: 4,
    margin: 1,
    // Growth time of plot saplings (seconds, before goblinTimeScale).
    growTime: [180, 300],
  },

  totem: {
    hp: 400,
    // Collision / hit box (feet at the hall floor).
    width: 1.6,
    height: 4.2,
    // No damage for regenDelay seconds, then regenRate HP per second back to full.
    regenDelay: 30,
    regenRate: 4,
    // How close a goblin gets to deposit or take materials.
    depositRange: 4.5,
  },

  king: {
    hp: 80,
    width: 1.1,
    height: 2.6,
    speed: 4.95,
    damage: 7,
    // Multiplier on the normal punch knockback.
    knockback: 1.8,
    cooldown: 1.5,
    // From the edge of its box to the edge of the target's.
    reach: 1.1,
    // Stays this far inside the Totem Hall's walls; waits by the totem.
    wallMargin: 0.8,
    // Egg-spawned kings outside a fortress guard a square this big around their spawn.
    strayArena: 8,
  },

  worker: {
    hp: 10,
    width: 0.6,
    height: 1.2,
    speed: 4.95,
    fleeSpeed: 6,
    // A player this close makes it flee; it goes back to work after none has
    // been within safeRange for safeTime.
    fleeRange: 8,
    safeRange: 12,
    safeTime: 3,
    // Carrying this many items sends it to the totem, as does having
    // something and nothing to do for idleDeposit seconds.
    carryLimit: 24,
    idleDeposit: 15,
    // How far it reaches to dig (a room's ceiling from its floor).
    reach: 4.5,
  },

  soldier: {
    hp: 16,
    width: 0.7,
    height: 1.3,
    speed: 4.95,
    damage: 4,
    cooldown: 1,
    knockback: 1,
    reach: 1,
    // Attacks players this close (with line of sight), chases up to
    // chaseRange from its patrol spot, then goes back.
    aggroRange: 12,
    chaseRange: 25,
    // Seconds at each patrol spot.
    patrolWait: [6, 14],
  },

  archer: {
    hp: 10,
    width: 0.6,
    height: 1.25,
    speed: 4.95,
    damage: 3,
    range: 20,
    cooldown: 1.5,
    arrowSpeed: 30,
    // Aim spread (radians).
    spread: 0.03,
    // Backs away from players closer than this.
    keepAway: 5,
    aggroRange: 20,
    chaseRange: 25,
    patrolWait: [8, 16],
  },

  // Goblins going up a shaft wait at its bottom for a group of groupSize
  // (or until gatherTime passes), then climb together, soldiers first,
  // `stagger` seconds apart.
  surfacing: { groupSize: [3, 5], gatherTime: 8, stagger: 0.5 },

  // Offscreen mode: on when no player is within `range` of the fortress,
  // its entrances, surface buildings, plots and every goblin (checked every
  // `checkInterval`). Progress then advances in `step`-second batches at
  // estimated rates; `travelFactor` scales the estimated walking time of a
  // trip (routes wind more than straight lines) and `overhead` is the share
  // of time a goblin loses to everything else (waiting, repathing, crowding).
  // `perBlock` seconds go to getting into position for each block, a climb
  // up a shaft serves blocksPerClimb blocks, and while wood is wanted
  // workers give woodShare of their time to chopping when wood is wanted.
  offscreen: { range: 100, checkInterval: 1, step: 2, travelFactor: 1.2, overhead: 0.12, perBlock: 0.15,
    blocksPerClimb: 64, woodShare: 0.3 },

  // Goblins steer apart when closer than `spacing` times their half widths
  // summed; `strength` weighs that push against where they're heading.
  separation: { spacing: 1.6, strength: 0.6 },
};

// Seconds (goblin timers) to ticks at a tick rate, sped up by goblinTimeScale.
export function goblinTicks(seconds, tickRate) {
  return Math.max(1, Math.round(seconds * tickRate / goblinTimeScale));
}

// A per-world-size cap.
export function goblinCap(table, worldSize) {
  return table[worldSize] ?? table.medium;
}
