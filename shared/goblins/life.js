import { WALK_SPEED } from '../config.js';

// Body/model dimensions recovered from 5be99f1. Roles and duties are data.
// Combat is data too. sight: target scan range (blocks, line of sight).
// leash: how far from its slot a melee goblin chases before giving up.
// melee: damage, reach (box edge to box edge), cooldown (s), knockback (scale
// on the player punch). ranged: damage, range, cooldown, arrowSpeed, spread
// (radians). flee: run from enemies within range, back to work once none has
// been within safeRange for safeTime (s). floorOnly: chases stay on the floor
// of its slot (the King and the Totem Hall level).
export const GOBLINS = {
  worker: { width: 0.6, height: 1.2, hp: 10, speed: 0.55, respawn: 15, ladders: true, duty: 'worker',
    name: 'Goblin Worker', sight: 10, flee: { range: 8, safeRange: 12, safeTime: 3 } },
  soldier: { width: 0.7, height: 1.3, hp: 16, speed: 0.6, respawn: 20, ladders: true,
    name: 'Goblin Soldier', sight: 12, leash: 25, melee: { damage: 4, reach: 1, cooldown: 1, knockback: 1 } },
  archer: { width: 0.6, height: 1.25, hp: 10, speed: 0.55, respawn: 20, ladders: true,
    name: 'Goblin Archer', sight: 20, ranged: { damage: 3, range: 20, cooldown: 1.5, arrowSpeed: 30, spread: 0.03 } },
  brute: { width: 0.95, height: 1.95, hp: 50, speed: 0.45, respawn: 45, ladders: true,
    name: 'Goblin Brute', sight: 16, leash: 30, melee: { damage: 8, reach: 1.4, cooldown: 1.8, knockback: 2.5 } },
  king: { width: 1.1, height: 2.6, hp: 80, speed: 0.4, respawn: null, ladders: false, floorOnly: true,
    name: 'Goblin King', sight: 12, leash: 18, melee: { damage: 12, reach: 1.2, cooldown: 1.5, knockback: 1.8 } },
  totem: { width: 1.6, height: 4.2, hp: 400, speed: 0, respawn: null, ladders: false, immovable: true,
    name: 'Goblin Totem' },
};
// Shared combat tuning. Seconds unless noted.
export const COMBAT = {
  scanTicks: 10,            // each goblin rescans for targets this often (staggered by id)
  forgetSeconds: 4,         // a target out of sight this long is dropped
  chaseReplanTicks: 10,     // melee chase route refresh
  chaseSpeed: 1.3,          // speed multiplier while fighting or fleeing
  unreachableSeconds: 4,    // ignore a target with no walkable route for this long
  closeRange: 1.2,          // past melee reach, step straight at the target instead of routing
  postEdge: 2,              // tower archers stand within this many blocks of their post
  archerShift: 3,           // ground archers step this far for a clear shot
  shotSpots: 24,            // candidate standing spots tested per archer reposition
  reserveRadius: 40,        // damage to a goblin this close to the Castle deploys the reserve
  reinforceCount: 2,        // fighters pulled from each adjacent area
  reinforceLinger: 10,      // reinforcements go home after no enemy for this long
};
export const LIFE = {
  surfaceDepth: 3, structureHeadroom: 4,
  minArea: 30, maxSurfaceArea: 24000, maxUndergroundArea: 1600,
  undergroundAreas: [3, 8], roomsPerArea: 6,
  outskirtsWidth: 6, sectionLength: 48,
  releaseSeconds: 1.5, workersPerCells: 650, patrolPerCells: 900,
  patrolSoldiers: 2, patrolArchers: 1, reserve: 4,
  courtyardArchers: 1, towerArchers: 1, gateGuards: 1, gateArchers: 1,
  postRadius: 2, postWait: [3, 8], wanderWait: [2, 5], patrolPoints: 6,
  stuckTicks: 40, unseenAdvance: 3, creativeRadius: 6,
  nodeBudget: 1800, ladderCost: 10, cacheDestinations: 48, spawnRetryTicks: 40,
  walkSpeed: WALK_SPEED,
};
export const DUTIES = {
  tower: { state: 'post', radius: 1, ladders: true },
  gate: { state: 'post', radius: 1 },
  ground: { state: 'post', radius: 2 },
  point: { state: 'post', radius: 2 },
  reserve: { state: 'post', radius: 2 },
  patrol: { state: 'patrol' },
  worker: { state: 'idle', interests: true },
};
export const roleOf = type => type.replace('goblin', '').toLowerCase();
export const boxOf = role => ({ halfW: GOBLINS[role].width / 2, height: GOBLINS[role].height });
