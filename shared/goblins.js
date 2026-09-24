// Goblin tuning: every number the Goblin Fortress, its Totem, the Goblin King
// and Goblin Workers use lives here. The module shapes themselves are in
// goblinModules.js. Distances in blocks, times in seconds, speeds in blocks/s.

export const GOBLINS = {
  // Where world gen puts the fortress in the central island (islands.js).
  placement: {
    // A ring around the island's center, as fractions of its radius. The
    // outer edge is only where the start is picked; the terrain checks below
    // decide what actually fits.
    ringInner: 0.3,
    ringOuter: 0.62,
    // Natural stone kept around the fortress: under its floor, over its roof
    // and beside it (checked against the island's column mask, since the
    // island tapers with depth).
    underside: 3,
    cover: 5,
    side: 3,
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

  // Workers by world size.
  workerCount: { small: 4, medium: 5, large: 6 },

  totem: {
    hp: 400,
    // Collision / hit box (feet at the hall floor).
    width: 1.6,
    height: 4.2,
    // No damage for regenDelay seconds, then regenRate HP per second back to full.
    regenDelay: 30,
    regenRate: 4,
    // How close a worker gets to deposit.
    depositRange: 3,
  },

  king: {
    hp: 80,
    width: 1.1,
    height: 2.6,
    speed: 3.2,
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
    speed: 3.4,
    fleeSpeed: 4.6,
    // A player this close makes it flee; it goes back to work after none has
    // been within safeRange for safeTime.
    fleeRange: 8,
    safeRange: 12,
    safeTime: 3,
    // Carrying this many items sends it to the totem, as does having
    // something and nothing to mine for idleDeposit seconds.
    carryLimit: 16,
    idleDeposit: 15,
    // Pick: tool speed (1 = hands) on breakTime, and how far it reaches.
    mineSpeed: 1,
    reach: 2.6,
    respawnDelay: 60,
  },

  // Goblins steer apart when closer than `spacing` times their half widths
  // summed; `strength` weighs that push against where they're heading.
  separation: { spacing: 1.6, strength: 0.6 },
};
