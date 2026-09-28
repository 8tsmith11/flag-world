import { WALK_SPEED } from '../config.js';

// Body/model dimensions recovered from 5be99f1. Roles and duties are data.
export const GOBLINS = {
  worker: { width: 0.6, height: 1.2, hp: 10, speed: 0.55, respawn: 15, ladders: true, duty: 'worker' },
  soldier: { width: 0.7, height: 1.3, hp: 16, speed: 0.6, respawn: 20, ladders: true },
  archer: { width: 0.6, height: 1.25, hp: 10, speed: 0.55, respawn: 20, ladders: true },
  brute: { width: 0.95, height: 1.95, hp: 50, speed: 0.45, respawn: 45, ladders: true },
  king: { width: 1.1, height: 2.6, hp: 80, speed: 0.4, respawn: null, ladders: false },
  totem: { width: 1.6, height: 4.2, hp: 400, speed: 0, respawn: null, ladders: false, immovable: true },
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
  nodeBudget: 1800, ladderCost: 10, cacheDestinations: 48,
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
