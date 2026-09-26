// Goblin tuning: every number the Goblin Fortress, its Totem, its goblins,
// their projects and the offscreen simulation use lives here. Module shapes
// and surface building templates are in goblinModules.js. Distances in
// blocks, times in seconds, speeds in blocks/s. Caps given per world size are
// { small, medium, large }.

// Speeds up every goblin timer (project pacing, spawning, digging, placing,
// chopping, plot tree growth, waits) for testing. Walking speeds are physics
// and stay as they are. GOBLIN_TIME_SCALE in the server's environment
// overrides it.
import { WALK_SPEED, CARRY_SPEED_SCALE } from './config.js';

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

  // What a new match starts with.
  start: { slots: ['goblinWorker', 'goblinSoldier', 'goblinSoldier'] },

  // Gathering is timed activity. Construction never consumes an inventory.
  gathering: { chopInterval: 35, plotStartBuildings: 5, planksPerTree: 24, dwellingWood: 12 },

  // How goblins break blocks: like a player's hammer of this strength and
  // speed, except any hardness can be broken; each point of hardness above
  // `strength` adds that much again to the time (harder blocks take much
  // longer). Placing a block takes placeTime.
  breaking: { strength: 4, speed: 4, hardnessScale: 0.25, obstacleDelay: 0.4, placeTime: 0.5 },

  // Project pacing: the rest between finishing one project and starting the
  // next, and how often the controller looks for work.
  projects: {
    cooldown: 0,
    relocationBuildings: 6,
    relocationModules: { small: 14, medium: 20, large: 28 },
    relocationMinHops: 2,
    relocationMinLevels: 1,
    relocationMinEntranceDistance: 14,
    relocationNearBase: 60,
    relocationWidth: 3,
    castle: { width: 11, depth: 11, wallHeight: 5, towerHeight: 9, capacity: 6,
      entranceClearance: 2, approachWidth: 3, maxOffset: 4 },
    // Dwellings are due when the population is within this of capacity.
    dwellingSlack: 1,
    // Repairs: how long after a change before goblins treat it as damage
    // (their own work settles first), and the rescan interval for sites.
    repairDelay: 2,
  },
  invasion: { scanTicks: 5, calmSeconds: 30 },
  navigation: { surfaceMaxNodes: 6000, chamberMaxNodes: 500, safeDrop: 1, cachePaths: 512, jumpProbe: 0.4, waypointReach: 0.15, edgeProbeDepth: 3, swimJumpSpeed: 8.4, blockedRetry: 0.75, blockedPatrol: 3, directRange: 1.5, directStep: 0.25 },
  optimization: { targetInterval: 0.5, playerCell: 16, farPlayerRange: 40, farAITicks: 5, turnRate: 10,
    noTeleportRange: 150 },
  network: { range: 336, positionStep: 1 / 16, yawStep: 1 / 256 },
  creativeBoost: { workSecondsPerTick: 1500, growthAheadSeconds: 600, idleStopTicks: 100 },
  walls: { startBuildings: 8, sectionSize: 6, sectionMin: 4,
    maxSections: { small: 2, medium: 3, large: 4 }, sectionMargin: 8, outerMargin: 4,
    height: 3, gateWidth: 2, clearMargin: 3, maxFlatten: 10, postHeight: 4,
    outerLocalFlatten: 2, riverClearance: 3, shoreSearch: 32, shorePathNodes: 60000,
    terrainRise: 10, gateApproach: 3, gateRampLength: 12, gatePathCutDepth: 3, gatePathFillDepth: 3, gateAccessPasses: 4, gateFillCost: 2, gateMaxStep: 1, perimeterSeparation: 2, routeNodes: 24000, gateRouteNodes: 96000, mainGateWidth: 4, gateFrameHeight: 5, gateGuards: 2, guardInset: 2, gatePlanAttempts: 16, foundationDepth: 36 },

  // Caps by world size.
  caps: {
    modules: { small: 40, medium: 48, large: 100 },
    dwellings: { small: 18, medium: 22, large: 36 },
    plots: { small: 1, medium: 1, large: 2 },
    population: { small: 25, medium: 40, large: 60 },
  },

  population: {
    // Capacity from the Totem Hall, and from each Bunk Room.
    hallCapacity: 3,
    bunkCapacity: 2,
    spawnInterval: 45,
    travel: { minSegment: 0.05, pathThreshold: 5, pathArrival: 2, yawThreshold: 0.1 },
    slots: ['goblinWorker', 'goblinSoldier', 'goblinSoldier', 'goblinSoldier', 'goblinArcher', 'goblinWorker'],
    repeatSlots: ['goblinSoldier', 'goblinHound', 'goblinArcher', 'goblinSoldier', 'goblinWorker', 'goblinHound'],
    bruteEvery: 8,
    // Target role shares as the colony grows.
  },

  // Fortress growth (goblinProjects.js). A candidate cell is scored for
  // staying on the ring (radial distance from the island center near the
  // fortress's own), for wrapping around it (angle away from the start), and
  // a random jitter; the best one wins.
  expansion: {
    radialWeight: 0.6,
    outwardWeight: 4,
    wrapWeight: 2,
    jitter: 2.5,
    // Chance of growing a ladder shaft, and then of the next module going
    // up or down from one.
    shaftWeight: 0.8,
    verticalChance: 0.9,
    verticalBonus: 4,
    verticalAfterEntranceBonus: 2,
    upperRouteStartModules: 3,
    upperShaftWeight: 60,
    upperVerticalBonus: 100,
    // Levels (cell y) the fortress may use, relative to the Totem Hall.
    minLevel: -1,
    maxLevel: 6,
    // Stone kept under a module's floor (never digging out the underside).
    underside: 2,
    // Near the edge, a sealed brick spur may be carried beyond shallow stone.
    cliffSupportStartFraction: 0.8,
    // A module can rise out of the ground only if its floor is at most this
    // far above the lowest surface under it.
    emergeFloor: 1,
    // Chance a cell that pokes out of the island's side is allowed (a sealed
    // room at the end of a hallway; nothing grows past it).
    cliffChance: 1,
    cliffRoomGoal: { small: 3, medium: 4, large: 4 },
    cliffBonus: 30,
    cliffSeekStartShare: 0.25,
    cliffSeekBonus: 60,
    cliffFinishBonus: 80,
    // Module types for horizontal growth and their weights; bunkWeight
    // replaces bunkRoom's weight when the population is near capacity.
    types: { room: 2.5, hallway: 3, corner: 2, junctionT: 1.5, junctionCross: 0.5,
      bunkRoom: 1, storeRoom: 0.8, armory: 0.8, ladderShaft: 0.8 },
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
    radius: 60,
    innerRadiusFraction: 0.35,
    clearMargin: 3,
    treeReach: 4,
    treeHeight: 16,
    maxSlope: 3,
    plotMaxSlope: 6,
    attempts: 600, expansionRadius: 80, expansionAttempts: 600,
    distanceBias: 2,
    // Ground under a site must be solid solidDepth blocks down in all but
    // hollowShare of its columns.
    solidDepth: 2,
    hollowShare: 0.05,
    // Tree plots are filled level with dirt, so they take rougher ground.
    plotHollowShare: 0.35,
    // Natural trees are chopped within this of an entrance.
    treeRadius: 15,
    // Space kept between goblin surface buildings, and from keeps/structures/rivers.
    spacing: 2,
    clearance: 5,
  },

  // Tree plots: a 3x3 grid of saplings `spacing` apart inside a plank border.
  plots: {
    grid: 3,
    spacing: 4,
    margin: 1,
    // Growth time of plot saplings (seconds, before goblinTimeScale).
    growTime: [60, 100],
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
    aggroRange: 9,
    chaseRange: 18,
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
    surfaceWanderShare: 0.35,
    surfaceWanderSlotPeriod: 10,
    surfaceWanderSlotFactor: 3,
    idleTime: [8, 16],
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
    patrolShare: 0.3,
    reserveResponseSeconds: 60,
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
    platformIdleStep: [3, 6],
    platformCombatStep: 0.5,
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
  // up a shaft serves blocksPerClimb blocks. Chopping has its own action
  // timer and never supplies or consumes construction materials.
  detail: { chunkRadius: 5, buildChunkRadius: 9, surfaceRange: 80, nearRange: 30, buildRange: 150, fortressLinger: 30 },
  economy: { visibleStep: 0.05, moduleClearance: 16, chopLabor: 1 },
  offscreen: { range: 180, checkInterval: 1, step: 2,
    workScale: { small: 15.9, medium: 12.5, large: 13.8 }, travelFactor: 1.2, overhead: 0.12, perBlock: 0.15,
    blocksPerClimb: 64, woodCreditLimit: 6000 },

  hound: { hp: 8, width: 0.6, height: 0.8, speed: WALK_SPEED * 1.6, damage: 3, cooldown: 0.8,
    knockback: 0.6, reach: 0.8, aggroRange: 24, chaseRange: 60, patrolWait: [2, 5], packRadius: 2 },
  brute: { hp: 50, width: 0.95, height: 1.95, speed: WALK_SPEED * 0.8, damage: 8, cooldown: 1.6,
    knockback: 2.5, reach: 1.4, aggroRange: 16, chaseRange: 40, patrolWait: [6, 14],
    breakSpeed: 5, climbScale: 0.45 },
  traps: { range: 4, cooldown: 3, damage: 2, poisonSeconds: 5, poisonDamage: 1,
    poisonInterval: 1, arrowSpeed: 22, perModule: 2, maxPerLevel: 6, hallExtra: 2, scanSeconds: 1 },
  siege: {
    margin: 1.2, groupSize: [2, 3], spawnInterval: 20, mainArmyProgress: 0.65,
    afterLandingSeconds: 900, hardCapSeconds: 1500, repairAbandonShare: 0.3,
    extraBridgeAfter: 3, extraBridgeChance: 0.5, alternateOffset: 14, keepClearance: 2, launchSettlementClearance: 6, launchSearchOffsets: 8,
    placeSeconds: 0.5, breakSeconds: 1, workAnimationSeconds: 0.25, towerWorkReach: 1.5, towerClearance: 2, repairSeconds: 2, planScanSeconds: 2,
    grabSeconds: 2, carrierSpeed: WALK_SPEED * CARRY_SPEED_SCALE, homeRange: 3, lootChance: 0.12,
    routeNodes: 12000, pathBreakCost: 4, swimSpeedScale: 1, swimWaypointHeight: 2, routeRefresh: 2, localRange: 12, defenseRange: 3, clearRange: 1.5, stagingSpacing: 3, workerHandoffSeconds: 10, bridgeDetourNodes: 8, surfaceTolerance: 1,
    budgets: {
      1: { goblinWorker: 2, goblinSoldier: 5, goblinArcher: 2 },
      2: { goblinWorker: 2, goblinSoldier: 5, goblinArcher: 3, goblinHound: 3, crew: 1 },
      3: { goblinWorker: 2, goblinSoldier: 6, goblinArcher: 4, goblinHound: 4, goblinBrute: 2,
        crew: 1, pilot: 1, riders: 4 },
      4: { goblinWorker: 2, goblinSoldier: 8, goblinArcher: 5, goblinHound: 5, goblinBrute: 3,
        crew: 2, pilot: 1, riders: 4 },
    },
  },
  catapult: { hp: 60, width: 3.2, height: 3.3, wood: 50, range: 60,
    cooldown: 8, platformSize: 5, projectileSeconds: 4, arcHeight: 28, drops: 16, platformRangeShare: 0.94, setback: 6, placementSearch: 12, boulderSize: 0.65, bombSize: 0.38, targetRadius: 26, targetHeight: 8, scanStride: 2, maxDefenseTargets: 64, clusterRadius: 6, targetCycle: ['path','turret','defense','players'],
    boulder: { radius: 1.5, damage: 6, hardness: 4 },
    bomb: { radius: 2.5, damage: 10, hardness: 4 } },
  balloon: { hp: 40, width: 4, height: 7, envelopeOffset: 2.2, wood: 40, speed: 6, hoverHeight: 20,
    cargo: 4, riderTypes: ['goblinSoldier', 'goblinArcher'], dropInterval: 4, bombInterval: 6, bombs: 12, crashGravity: 12,
    glideSpeed: 5, glideFallSpeed: 2.5, launchDelay: 12, launchPadSize: 5, launchRadius: 64, launchRise: 3, launchDepth: 15, launchMaxSlope: 1, clearance: 2, detourDistance: 8, detourHistory: 8, blockedSeconds: 8, bomb: { radius: 1.5, damage: 6, hardness: 4 } },

  effects: { bombParticles: 42, bombSeconds: 0.8, bombFlashSeconds: 0.22, bombFlashIntensity: 8, bombFlashRange: 20, bombParticleSpeed: 7 },
  sounds: { hornSeconds: 2.5, drumSeconds: 12, drumInterval: 0.55, ambientInterval: 8, ambientJitter: 10, workInterval: 0.75 },

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
