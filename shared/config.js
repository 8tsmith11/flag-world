// Shared constants used by both server and client.
// Changing anything here affects simulation on both sides, so keep them in sync
// by only ever reading from this module.

// Shows an FPS counter and player coordinates on screen.
export const DEBUG = true;

export const PORT = 3000;

// World height in blocks. The X/Z size follows the selected island radius.
export const WORLD_SIZE_Y = 128;

// Chunks are cubes of CHUNK_SIZE blocks.
export const CHUNK_SIZE = 16;

// Client view distance in blocks (horizontal): chunks further away aren't
// meshed, and fog hides the edge. Players can change it within the range.
export const VIEW_DISTANCE = 160;
export const VIEW_DISTANCE_MIN = 64;
export const VIEW_DISTANCE_MAX = 320;


// Simulation runs at a fixed rate. Every client input represents exactly one tick.
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const QUARRY_REGROW_TIME = 5;
// Saplings: the chance breaking leaves drops one, and how long a planted one
// takes to grow into a tree (seconds, a random time in this range).
export const SAPLING_DROP_CHANCE = 0.1;
export const SAPLING_GROW_TIME = [180, 300];

// Player physics (blocks, seconds).
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const WALK_SPEED = 4.3;
export const FLIGHT_SPEED = WALK_SPEED * 2;
export const SPRINT_SPEED_SCALE = 1.5;
export const JUMP_VELOCITY = 8.4;
export const GRAVITY = 28;
export const TERMINAL_VELOCITY = 50;
export const SWIM_GRAVITY_SCALE = 0.25;
export const SWIM_UP_SPEED = 2.4;
export const SWIM_SPEED_SCALE = 0.4;
export const WATER_CURRENT_SPEED = 2.2;
export const GLIDE_SPEED = 8;
export const GLIDE_FALL_SPEED = 2;
// Upward speed when jumping at the water surface: the smallest value (tuned at
// 20 Hz) that reliably lifts the feet above the surface, so you can climb onto
// shore blocks level with the water.
export const SWIM_EXIT_VELOCITY = 4;
// Crouching (Shift): walking speed scale (multiplies with carrying a flag),
// collision height (fits under 1.5 blocks), how far the eyes drop, and the
// biggest drop edge protection lets a crouched player walk off.
export const CROUCH_SPEED_SCALE = 0.3;
export const CROUCH_HEIGHT = 1.45;
export const CROUCH_EYE_DROP = 0.3;
export const CROUCH_MAX_DROP = 1;
// Towering: a player in the air may place a block in the cell their feet are
// in once they're at least this far up it; they're lifted on top of it.
export const TOWER_MIN_HEIGHT = 0.5;
// Ladders: climbing speed up or down (blocks/s).
export const CLIMB_SPEED = 3;

// Server drops queued inputs beyond this so a stalled client can't burst-move.
export const MAX_QUEUED_INPUTS = 10;

// Block interaction. Reach is measured from the eyes.
export const REACH_DISTANCE = 5;
// Tool strength of an empty hand; a block breaks only if strength >= its hardness.
export const HAND_STRENGTH = 1;

// Inventory: the hotbar is slots 0-8, the main grid the 27 after it.
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const MAX_STACK = 64;

// Dropped items. Sizes in blocks, times in seconds, speeds in blocks/s.
export const ITEM_SIZE = 0.25;
export const ITEM_PICKUP_RADIUS = 1.5;
export const ITEM_DESPAWN_TIME = 300;
// Before an item can be picked up: a short beat for block drops so the pop is
// visible, longer for thrown items so they leave the thrower's pickup radius.
export const ITEM_PICKUP_DELAY = 0.5;
export const ITEM_THROW_PICKUP_DELAY = 2;
export const ITEM_THROW_SPEED = 6;
export const ITEM_POP_SPEED = 4;
// Per-tick velocity multipliers on X/Z.
export const ITEM_AIR_DRAG = 0.98;
export const ITEM_GROUND_FRICTION = 0.6;

// Combat. Times in seconds, speeds in blocks/s.
export const MAX_HP = 20;
export const REGEN_DELAY = 12;
export const REGEN_INTERVAL = 3;
export const ATTACK_DAMAGE = 2;
export const ATTACK_COOLDOWN = 0.4;
// The server grows hitboxes by this much when confirming a punch, since the
// attacker saw the target slightly in the past.
export const HIT_TOLERANCE = 0.3;
// Knockback launches the target, then fades: slowly in the air, quickly once
// they land. While it lasts it overrides their walking (see stepPlayer).
export const KNOCKBACK_SPEED = 8;
export const KNOCKBACK_UP = 6.5;
// Per-tick multipliers on knockback velocity.
export const KNOCKBACK_AIR_DECAY = 0.91;
export const KNOCKBACK_GROUND_DECAY = 0.6;
export const RESPAWN_DELAY = 3;
// Falling below this y kills the player.
export const VOID_Y = -20;
export const VOID_BELOW_LOWEST_ISLAND = 95;
export const EEL_BAND = { belowIsland: 30, outerBelowIsland: 20, aboveVoid: 10, minHeight: 40 };
export const CENTRAL_EXTRA_DEPTH = 45;
export const BIOME_SETTINGS = {
  noiseScale: 95, blend: 0.17, surfacePatchScale: 7,
  plains: { hill: 2.2, offset: 0, trees: 0.35, cows: 1.8 },
  forest: { hill: 4, offset: 1, trees: 1.8, cows: 0.8 },
  mountains: { hill: 27, offset: 8, trees: 0.22, cows: 0.25 },
  ancientForest: { hill: 4, offset: 1, trees: 1.8, cows: 0.8 },
  cliffSlope: 5, mountainOreThreshold: 0.54,
  undersideJagAmplitude: 0.07, undersideRootChance: 0.82,
  undersideRootDepth: 8, undersideRootScale: 12,
  treeCell: 7, forestTreeCell: 4, treeChance: 0.45,
  riverSkyClearance: 10,
  forestLargeTreeChance: 0.28, forestLargeTreeExtra: 2,
  forestDensityMultiplier: 1.4, treeChanceCap: 0.99,
  forestClusterFraction: 0.14, forestClusterVariation: 0.2,
  forestClearingThreshold: -0.55, forestClearingBlend: 0.18,
  towerOtherBiomeChance: 0.22,
};
// Tree species share log/leaf materials; only their seeded silhouettes differ.
export const TREE_SETTINGS = {
  seedSalt: 0x19b57c31, minTrunk: 4, maxTrunk: 6, leafRadius: 2,
  branchBreakTime: 0.5, branchWidth: 1 / 3, collisionSteps: 12,
  decaySaplingChance: 0.04, decayReach: 32, decayTickBudget: 64, decayNodeBudget: 512, decayEnqueueBudget: 512,
  species: {
    oak: { lean: 0.45, fork: 0.5, branches: [3, 5], length: [2, 3], rise: 0.35, crown: 2 },
    birch: { lean: 0.2, fork: 0.25, branches: [2, 4], length: [1, 3], rise: 0.65, crown: 1 },
    pine: { lean: 0.1, fork: 0.15, branches: [4, 6], length: [1, 2], rise: 0.25, crown: 1 },
    ancient: { lean: 0.3, fork: 0.9, branches: [5, 8], length: [6, 10], rise: 0.35, crown: 3 },
  },
  crownThinning: 0.2, branchStart: 0.65, upperLeaves: 0.65, forkLength: [1, 3],
  ancient: { patchScale: 0.23, threshold: 0.28, blend: 0.3, minRadius: 5,
    spacing: 12, height: [17, 26], trunkWidth: [2, 4], hollowChance: 0.28,
    hollowWidth: 4, hollowHeight: 4, groundRelief: 3,
    fallenChance: 0.2, fallenLength: [5, 10], fallenOffset: 7 },
};
export const RIVER_SETTINGS = {
  seedSalt: 0x6d8a437b, countAttempts: 48, sourceRadius: [0.38, 0.6], sourceSpacing: 0.25,
  minLakeCells: 100, lakeRadius: [7, 11], lakeShapeScale: 12, lakeShapeVariation: 0.22, lakeAspect: [0.75, 1.2],
  lakeRim: 2, lakeDepth: 3, lakeMaxCut: 24, lakeDepthCurve: 0.7,
  width: [3.5, 5], downstreamGrowth: 1.6, widthNoiseScale: 35, widthNoise: 0.13,
  pathStep: 1.5, maxSteps: 450, noiseScale: 48, gradientSample: 4,
  downhillWeight: 0.7, outwardWeight: 1.4, meanderWeight: 0.9, turnEase: 0.16,
  maxTurn: 0.16, minOutward: 0.28, bankWidth: 4, shoreWidth: 0.8,
  channelDepth: 3, depthCurve: 0.65, segmentLength: 14, levelStep: 2,
  skyClearance: 2, waterfallOverhang: 2, throughLakeChance: 0.5, throughLakeFraction: [0.35, 0.65],
  clearance: 2, pondRadiusPadding: 1.2,
};
// Fractions use the central island's actual radius; angles are radians.
export const CENTRAL_TERRAIN = {
  seedSalt: 0x3759ca41, transitionOffset: [-0.08, 0.1], transitionWidth: 0.28,
  reserveBlend: 0.14, regionWarp: 0.06, regionNoiseScale: 0.4,
  rangeRadius: [0.59, 0.72], rangeHalfArc: [1.1, 1.65], rangeWidth: 0.14,
  rangeArcFade: 0.3, rangeHeight: 0.17, rangeVariation: 0.3,
  highlandHeight: 0.055, highlandRimFalloff: 0.45,
  lowlandOffset: 0, rollingHeight: 0.012, rollingScale: 0.29,
  detailHeight: 0.004, detailScale: 0.1, ridgeRoughness: 0.018,
  forestScale: 0.4, highlandForestScale: 0.22, forestThreshold: 0, forestBlend: 0.18,
  highlandForestThreshold: 0.2, highlandForestReduction: 0.65,
  mountainThreshold: 0.5, mountainBlend: 0.3, mountainRegionWeight: 0.55,
  terraceHeight: 0.027, terraceVariation: 0.27, terraceNoiseScale: 0.22,
  terraceErosion: 0.55, terraceCliffFraction: 0.16, terraceStrength: 0.88,
  terracePatchThreshold: -0.3, terracePatchBlend: 0.5, boundsMargin: 8,
};
export const GORGE_SETTINGS = {
  sourceRadius: 0.49, sourceArcFraction: 0.9, sourceAttempts: 12, sourceAngleStep: 0.09,
  depth: 0.16, downstreamDrop: 0.035, width: 0.115, widthVariation: 0.22,
  bend: 0.16, bendScale: 0.3, widthScale: 0.19,
  rimWidth: 0.012, wallCurve: 0.12, valleyFloorWidth: 1.7, valleyFloorFraction: 0.45,
  constructionMargin: 0.035, lakeCutAllowance: 0.3,
  caveTurn: 2.2, caveInward: 0.12, caveOutward: 1.35, caveBend: 0.025,
  caveDrop: 0.018, caveWidth: 0.1, caveHeight: 0.075,
  caveMinHeight: 6, caveWalkWidth: 3, caveRoofMargin: 4, caveRockMargin: 5,
  caveFloorRise: 1, caveWallCurve: 0.5,
};
export const MOB_SEPARATION = { strength: 0.2,
  approachRadius: 2.5, gridSize: 6 };
// A void or fall death is credited to whoever hit the player within this long before.
export const KILL_CREDIT_TIME = 5;
// Falls up to this many blocks are free; each block further costs 1 HP.
export const FALL_SAFE_DISTANCE = 3;

// Capture the flag. Sizes in blocks, times in seconds.
// Keeps: a KEEP_SIZE x KEEP_SIZE floor and a frame KEEP_HEIGHT blocks tall.
export const KEEP_SIZE = 7;
export const KEEP_HEIGHT = 5;
// Terrain around a keep is flattened this far out so it can be walked into from any side.
export const KEEP_MARGIN = 2;
export const FLAG_GRAB_TIME = 2;
export const FLAG_RETURN_TIME = 120;
// A player is on a flag when their feet are within this horizontal distance of its base.
export const FLAG_TOUCH_RADIUS = 0.8;
export const CARRY_SPEED_SCALE = 0.6;

// Bows. Times in seconds, speeds in blocks/s. Charge runs from the shortest
// draw that shoots (BOW_MIN_DRAW) to a full draw (BOW_FULL_DRAW); arrow speed
// and damage scale linearly across it.
export const BOW_FULL_DRAW = 1;
export const BOW_MIN_DRAW = 0.2;
export const BOW_COOLDOWN = 0.5;
export const BOW_DRAW_SPEED_SCALE = 0.5;
export const EAT_SPEED_SCALE = 0.45;
export const EAT_TIME = 1.5;
export const FOOD_HEAL_TIME = 3;
export const ARROW_SPEED = [15, 50];
export const ARROW_DAMAGE = [1, 5];
// Arrows fall slower than players (GRAVITY) so they arc gently, and lose a
// little speed each tick.
export const ARROW_GRAVITY = 12;
export const ARROW_DRAG = 0.99;
export const ARROW_STICK_TIME = 10;
// An arrow can't hit whoever shot it this soon after leaving the bow.
export const ARROW_SAFE_TIME = 0.2;
export const ARROW_KNOCKBACK = 3;
export const TURRET = { range: 20, damage: 3, cooldown: 1.5, arrowSpeed: 28,
  updateTicks: 5, sightCacheSeconds: 0.25, spatialCell: 8, arcStep: 2,
  headTurnRadiansPerTick: 0.15 };

// Crossbows: hold right click CROSSBOW_LOAD_TIME to load, then click to fire.
// Bolts fly 1.6x a full bow draw with a flatter arc (less gravity).
export const CROSSBOW_LOAD_TIME = 1.2;
export const CROSSBOW_ARROW_SPEED = ARROW_SPEED[1] * 1.6;
export const CROSSBOW_ARROW_GRAVITY = 5;
export const CROSSBOW_ARROW_DAMAGE = ARROW_DAMAGE[1] + 2;

// Rope Bundles hang a column of rope at most this many blocks long.
export const ROPE_LENGTH = 40;

// Grappling hooks: range of the hook (blocks), pull speed (blocks/s) and
// cooldown between shots (seconds).
export const GRAPPLE_RANGE = 30;
export const GRAPPLE_SPEED = 20;
export const GRAPPLE_COOLDOWN = 3;

// Cows: collision box, health, walking speeds (fractions of WALK_SPEED),
// herds (how many per square block of world, and their size), how long a
// herd panics after one of them is hurt, and what they drop.
export const COW_WIDTH = 0.9;
export const COW_HEIGHT = 1.3;
export const COW_HP = 10;
export const COW_WANDER_SPEED = 0.3;
export const COW_FLEE_SPEED = 0.85;
export const COW_HERD_AREA = 20000;
export const COW_HERD_SIZE = [3, 6];
export const COW_PANIC_TIME = 5;
export const COW_DROPS = { leather: [0, 2], beef: [1, 3] };

// Dragons patrol above the island and dive to breathe fire at nearby players.
export const DRAGON_HP = 30;
export const DRAGON_SPEED = 5.5;
export const DRAGON_SIGHT = 45;
export const DRAGON_FIRE_RANGE = 14;
export const DRAGON_FIRE_DAMAGE = 2.5;
export const DRAGON_FIRE_DURATION = 1.2;
export const DRAGON_FIRE_COOLDOWN = 4;
export const DRAGON_FIRE_INTERVAL = 0.3;
export const DRAGON_DROPS = { iron: [2, 5], leather: [2, 4], scales: [2, 4] };
// How far past its island a leashed dragon roams unless chasing: team
// islands, the central island and roosts (measured from the island's edge).
export const DRAGON_LEASH = { team: 15, center: 20, roost: 20 };

// Provocation: any damage from a player makes a Crawler, Void Eel or dragon
// chase that player, ignoring its aggro range and leash, until the player
// dies or it has lost sight of them this long (seconds).
export const PROVOKE_FORGET_TIME = 10;

// Crawlers: spider-like mobs in dungeons, underside ruins and dark caverns.
// Speeds in blocks/s, ranges in blocks, times in seconds.
export const CRAWLER_WIDTH = 0.9;
export const CRAWLER_HEIGHT = 0.6;
export const CRAWLER_HP = 12;
export const CRAWLER_DAMAGE = 3;
export const CRAWLER_ATTACK_COOLDOWN = 1;
export const CRAWLER_SPEED = 4.8;
export const CRAWLER_CLIMB_SPEED = 3;
// Bite reach, from the edge of its box to the edge of the target's.
export const CRAWLER_REACH = 0.6;
export const CRAWLER_AGGRO_RANGE = 12;
export const CRAWLER_GIVE_UP_RANGE = 24;
// Idle crawlers wander this far from where they spawned.
export const CRAWLER_WANDER_RADIUS = 5;
export const CRAWLER_DROPS = { silk: [0, 2] };

// Void Eels roam the open deep band, rising after players above exposed void.
export const EEL_HP = 30;
export const EEL_DAMAGE = 4;
export const EEL_ATTACK_COOLDOWN = 1.2;
export const EEL_SPEED = 5;
export const EEL_CHASE_SPEED = 10;
export const EEL_LUNGE_SPEED = 20;
export const EEL_LUNGE_WINDUP = 1;
export const EEL_LUNGE_DURATION = 0.45;
export const EEL_TURN_RATE = 0.2;
export const EEL_GLIDE_BREAK = 1.5;
export const EEL_DETECT_RADIUS = 24;
export const EEL_DETECT_HEIGHT = 180;
export const EEL_NIGHT_DETECT_SCALE = 1.3;
export const EEL_NIGHT_RISE_SCALE = 1.3;
export const EEL_FORGET_TIME = 10;
export const EEL_WANDER_RADIUS = 65;
export const EEL_DROPS = [1, 2];
// Bite reach from the head's center to the target's box.
export const EEL_REACH = 1.2;
export const EEL_LOSE_RANGE = 30;
export const RIFT_ORB = { durationSeconds: 10, maxStack: 4, throwSpeed: 13,
  gravity: 20, radius: 0.18, launchLift: 0.35, launchForward: 0.7 };

// Day/night: one full cycle in seconds (half day, half night). Time of day is
// a fraction of the cycle: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
// Matches start at DAY_START, in the morning.
export const DAY_LENGTH = 12 * 60;
export const DAY_START = 0.04;

// Furnace: seconds to smelt one item.
export const SMELT_TIME = 5;

// Reusable worldgen structure engine. Distances are in blocks; budgets are
// total cut + fill volume, not a world-size multiplier.
export const STRUCTURE_GEN = {
  keepOutMargin: 3, reservationMargin: 4, puddleCells: 24, grassClearance: 4, treeClearance: 10,
  siteStride: 4, siteRadius: 24, siteLimit: 320,
  score: { slope: 4, relief: 0.35, lowland: 28, water: 30, keepOut: 100, edge: -0.5 },
  maxDepth: 32, maxPieces: 160, retries: 16, connectorStep: 1,
  outlineGrid: 4, outlineGap: 8, compoundCorners: 24, outerCorners: 48,
  density: { width: 24, height: 16, stride: 4, maxFill: 0.34 },
};
export const GOBLIN_GEN = {
  seedSalt: 0x41c6ce57, surfaceSiteSalt: 0x2f6e35b9, reservedFraction: 0.25, siteClearanceFraction: 0.36,
  scale: { surfaceBase: 54, surfacePerRadius: 0.35, surfaceDepthBase: 5,
    surfaceDepthPerRadius: 0.025, buildingsBase: 5, buildingsPerRadius: 0.018,
    depthBase: 52, depthPerRadius: 0.08, roomsBase: 12, roomsPerRadius: 0.04,
    wallMarginBase: 3, wallMarginPerRadius: 0.008 },
  minDepth: 42, midFraction: 0.45, kingDrop: 8, rockMargin: 3,
  routeMultiple: 2.5, routeRooms: 8, layoutAttempts: 40, walkChoices: 24,
  roomWidth: 9, roomHeight: 4, totemWidth: 11, totemHeight: 5,
  corridorWidth: 3, corridorLength: [7, 17], passageHeight: 2,
  torchSpacing: 6,
  descentInterval: 2, branchCountFraction: 0.3, minBranches: 2,
  cliffBias: 2, protrusionLength: 7, buttressDepth: 6, windowHeight: 2,
  uniqueRooms: ['barracks', 'storeroom', 'mushroomFarm', 'forge', 'shrine',
    'prison', 'trophyHall', 'treasureVault'],
  commonRooms: ['guardroom', 'messHall', 'quarters', 'junction'],
  buildingWidth: 9, buildingHeight: 4, buildingVariants: 3, variantLengthStep: 2,
  roofRise: 3, pathLength: 7, pathWidth: 3,
  weights: { bridge: 1, path: 3, building: 3, tower: 2 },
  floorPatternPeriod: 3, goblinJumpHeight: 1.5,
  surfaceStep: 3, earthwork: 600, pathEarthwork: 300, castleEarthwork: 2400,
  castleWidth: 21, castleWallHeight: 6, castleTowerHeight: 10,
  castleTowerWidth: 5, castleGalleryHeight: 4,
  compoundGroup: [2, 4], compoundDistance: 30, compoundFraction: 0.8,
  innerMargin: 3, ladderSafetyMargin: 1, wallHeight: 4, gateClearance: 3,
  gatehouseDepth: 3, gatehouseHeight: 5, gatehousePostWidth: 1,
  roadLength: 12, postSpacing: 16, postWidth: 3, towerHeight: 8,
  brickHardness: 8, brickBreakTime: 4,
  loot: { shallow: 'houseCentral', middle: 'caveCentral', deep: 'dungeonCentral', best: 'roost' },
  map: { overviewStep: 4, margin: 4 },
};
export const FORTRESS_TRAP = { cooldown: 2, speed: 24, damage: 2,
  poisonSeconds: 6, poisonInterval: 1, poisonDamage: 1, triggerHeight: 2 };
export const MOB_NAVIGATION = { repathTicks: 20, maxNodes: 600, maxDrop: 3,
  waypointReach: 0.3, targetVerticalRange: 64 };
export const BLOCK_TEXTURE = { tileSize: 64, tileStride: 128, atlasColumns: 4 };

// Baked voxel illumination. Runtime edits are bounded by maxLevel.
export const LIGHTING = {
  maxLevel: 12, torchEmission: 12, openAirLoss: 3, voidLevel: 5,
  voidTint: [0.65, 0.77, 1], voidDay: 0.3, voidNight: 0.045, ambientFloor: 0.008, nightSky: 0.035, daySky: 1,
  faceShades: [0.8, 0.8, 0.55, 1, 0.7, 0.7],
  blockStrength: 1.25, blockTint: [1, 0.72, 0.4], aoStrength: 0.18,
  buildsPerFrame: 2, buildBudgetMs: 4, unloadMargin: 32, workerBatch: 4,
  entitySmoothSeconds: 0.16, entityUpShade: 1, entityDownShade: 0.75,
  entityPlayerSample: 0.9, entityCrouchSampleScale: 0.85, entityTallThreshold: 2, entityHeadFraction: 0.8,
  entityItemSample: 0.125,
  torchCraftCount: 4, torchCraftPlanks: 1,
  torch: { width: 0.12, height: 0.65, headHeight: 0.18, wallOffset: 0.06, wallHeight: 0.22, wallLean: 0.48 },
};

export const SKY_SETTINGS = {
  dayColor: 0x9fd4ff, nightColor: 0x02040a, dawnColor: 0xcdd5ed, duskColor: 0xe9aa68,
  sunColor: 0xffedc9, moonColor: 0xa6a5e7, nightAmbient: 0x666b9c,
  ambientDay: 1.1, ambientNight: 0.04, sunDay: 1.5, sunNight: 0.012,
  nightFog: 0.6, fogStart: 0.55, distance: 300, stars: 4600, starSize: 0.8,
  tilt: 0.35, daylightRange: [-0.18, 0.2], glowRange: 0.32, glowStrength: 0.75,
  starFade: 1.2, starOpacity: 0.7, starRotation: 0.12,
  sunRadius: 18, moonRadius: 11, discSegments: 24, discDistance: 0.9,
  farScale: 0.85, sunHorizon: -0.15, moonHorizon: 0.15,
  cloudNightTint: 0.06, cloudGlowTint: 0.32, seed: 0x4172ce,
};
export const CLOUD_SEA = {
  textureSize: 512, overhang: 600, tileSpan: 320, belowLowest: 22,
  layers: [[0, 0.8, 0.35, 110], [-6, 0.65, 0.55, 90], [-13, 0.5, 0.7, 70]],
  radius: [18, 56], blobOpacity: 0.85, diagonalDrift: 0.23,
  overhead: { height: 32, opacity: 0.48, drift: 0.24, blobs: 14 },
};

export const RENDER_SETTINGS = { maxPixelRatio: 1.5 };

export const GENERATION_PROGRESS = { terrain: [0, 35], caves: [35, 50], ores: [50, 62],
  structures: [62, 74], village: [74, 88], fortress: [88, 99], complete: [100, 100] };
export const LOBBY_MEDIA = {
  image: '/img/lobby.png', music: '/audio/lobby.ogg', musicVolume: 0.35, fadeSeconds: 2,
  volumeStep: 0.01, fadeTickHz: 30, audioSampleRate: 44100, audioQuality: 4, audioLoudness: -20, audioTruePeak: -2, audioRange: 7,
  serverProgressWeight: 0.45, localProgressWeight: 0.45, meshProgressWeight: 0.1,
};
export const LOBBY_CAPTURE = { seed: 1, teamCount: 2, worldSize: 'large', dayTime: 0.485,
  viewDistance: 650, width: 1920, height: 1080, cameraOutward: 0.85, cameraHeight: 56,
  targetHeight: 10, fov: 65, timeoutMs: 180000 };

// Audio distances are world blocks; all intervals are seconds.
export const AUDIO = {
  volumes: { master: 0.8, music: 0.35, ambience: 0.5, effects: 0.7, voice: 0.9 },
  maxVoices: 24, effectsRange: 30, playerRange: 24, cowRange: 32, dragonRange: 110,
  nightStart: 0.52, nightEnd: 0.98,
  ambienceInterval: 0.5, ambienceFade: 2, windHeight: 80, windBase: 0.045,
  windGain: 0.16, birdsGain: 0.13, cricketsGain: 0.11, fortressGain: 0.5,
  ambienceBursts: { birds: { play: [5, 11], silence: [20, 45], fade: 2.5 } },
  waterRange: 20, waterfallRange: 38, waterGain: 0.22, waterfallGain: 0.45,
  waterScanRadius: 18, waterScanStride: 3, waterScanHeight: 5, waterfallDrop: 3,
  footsteps: { walkInterval: 0.39, sprintInterval: 0.27, gain: 0.23, sprintGain: 0.3, minSpeed: 0.7 },
  blockGain: { hit: 0.12, break: 0.34, place: 0.22 },
  splashGain: 0.4, landingGain: 0.32, landingSpeed: 8,
  mobCallDelay: [8, 20], cowGain: 0.38, dragonGain: 0.65, wingGain: 0.16,
  wingInterval: 0.8, mobHurtGain: 0.5, mobDeathGain: 0.65,
  pitchVariation: 0.07, decodeConcurrency: 3,
  sampleRate: 44100, quality: 4, loudness: { ambience: -26, effects: -20 },
  truePeak: -2, codecPeakHeadroom: 1.5, loudnessRange: 7, loopCrossfade: 0.5,
  // Ancient Monkeys: falloff range, gains, idle call spacing while sitting and
  // the chance a stand-up chest beat ends in a roar. Thunder from the storm cloud.
  monkeyRange: 45, monkeyGain: 0.6, monkeyBeatGain: 0.7, monkeyRoarGain: 0.8,
  monkeyCallDelay: [9, 22], monkeyRoarChance: 0.35, monkeyRate: 1,
  thunderRange: 120, thunderGain: 0.55,
};

// Reproducible browser review and software-GPU timings.
export const LOOK_CAPTURE = { seed: 1, teamCount: 2, worldSize: 'small', viewDistance: 112, overviewDistance: 360,
  width: 960, height: 600, dayTime: 0.3, nightTime: 0.8, timeoutMs: 240000,
  ancientCanopyHeight: 40, forestStride: 4, forestRadius: 12, canopyHeight: 12, forestOffset: 8, eyeHeight: 2,
  aboveHeight: 1.4, aboveOffset: 0.35, sideDistance: 1.4, sideHeight: 12, belowDepth: 75,
  targetDepth: 20, sampleFrames: 60, warmFrames: 12 };

// Continuous terrain/profile controls; no named world-size branches.
export const ISLAND_SHAPE = {
  warpScale: 120, warpAmplitude: 23, warpOffset: 317,
  lobeScale: 0.3, lobeAmplitude: 0.17, lobeFloor: 0.1,
  tinyDepth: 0.6, tinyRim: 3, rimDepth: 12, depthScale: 0.28,
  taperPower: 6, taperCurve: 0.6, centerRimFraction: 0.55,
  shellWidth: 5, sheerDepth: 7, sideTaper: 0.025,
  sideNoiseScale: 24, sideNoiseAmplitude: 0.16, ledgeScale: 9,
  ledgeThreshold: 0.65, ledgeAmplitude: 0.25,
};
export const WORLD_LOOK = { grass: 0x405f35, leaves: 0x344e32 };
export const VEGETATION = {
  seedSalt: 0x471dc963, clusterScale: 19, clusterThreshold: -0.25,
  density: { forest: 0.2, plains: 0.13, mountains: 0.035 },
  shadeHeight: 10, glowChance: 0.035, flowerChance: 0.25, bushChance: 0.1,
  forestMushroomChance: 0.25, mushroomGlowChance: 0.05,
  surfaceClearance: 2, structureMargin: 1, keepMargin: 6,
  hangClusterScale: 13, hangClusterThreshold: 0.25, hangChance: 0.18,
  undersideBand: 0.7, cliffBand: 0.35, hangLength: [2, 9],
  woodyChance: 0.4, darkRootChance: 0.35, budChance: 0.06,
  emission: { flower: 2, moss: 1, mushroom: 2, buds: 1 },
  maxDistance: 80, fadeDistance: 64, alphaTest: 0.45,
  hangingWidth: 0.45, sway: 0.06, hangingSway: 0.025, windSpeed: 1.3, windScale: 0.22,
  heights: { tuft: 0.65, fern: 0.8, flower: 0.7, bush: 0.8, mushroom: 0.55, moss: 0.25, hanging: 1 },
  atlasTile: 64, atlasStride: 128, atlasColumns: 4,
};

// NPCs (Wise Monkeys, Ancient Monkeys). Distances in blocks, times in seconds.
// Boxes are feet-anchored like players (half width, height) and used for
// punching and talking. Ancient Monkeys alternate sitting with a short stand,
// chest beat and stroll inside walkRadius of their seat.
export const NPC = {
  talkReach: 6, talkCooldown: 1.2, lookRange: 14, lookLimit: 1.1, lookStep: 0.05,
  wiseMonkey: { hp: 160, box: { halfW: 0.95, height: 2.4 } },
  ancientMonkey: { box: { halfW: 1.5, height: 3.6 }, sitTime: [25, 60], standTime: 2.8,
    lookTime: [1.8, 3.5], walkSteps: [1, 3], walkRadius: 3.5, walkSpeed: 1.2, arriveDistance: 0.25,
    groundSearch: 3 },
};

// Spoken dialogue: chance a Wise Monkey gives a world clue instead of a hint,
// subtitle timing, and per-voice speech synthesis settings (pitch and rate as
// the Web Speech API takes them; 1 is normal).
export const DIALOGUE = {
  clueChance: 0.25, subtitleBase: 2, subtitlePerChar: 0.065, subtitleMin: 2.5,
  subtitleMax: 9, subtitleFade: 0.7, soundSubtitle: 2.8,
  voices: { wiseMonkey: { pitch: 0.4, rate: 0.72 } },
};

// Wise Monkey shrines on team islands (npcSites.js): the square footprint's
// half width, roof height, clearance from the keep, how far out on the island
// (fraction of its radius) and how uneven the ground may be.
export const SHRINE_GEN = {
  seedSalt: 0x5a7e1b3d, half: 3, roofHeight: 6, keepDistance: 20, maxRadius: 0.7,
  maxVariance: 2, attempts: 400, margin: 3,
};

// The storm cloud off the highland edge of the central island (npcSites.js).
// Radii in blocks; edgeOffset is how far past the island edge its center sits,
// as a fraction of its horizontal radius. clearance is its floor's height
// above the highest terrain nearby. Flashes and thunder are client effects.
export const STORM_CLOUD = {
  seedSalt: 0x3c6ef372, radius: [11, 14], height: [7, 8], shell: 2, floorDrop: 2,
  puffs: [9, 13], puffRadius: [3, 5.5], gaps: [3, 4], gapRadius: 2.3,
  edgeOffset: 0.85, angleJitter: 0.35, attempts: 16, clearance: 24, sampleRadius: 40, topMargin: 3,
  flashInterval: [3, 11], flashPulses: [1, 3], flashOpacity: 0.55, flashSize: 14,
  thunderInterval: [10, 26], thunderDelay: [0.4, 2.5],
};
