// Seeded multi-island terrain shared by server and browser. All layout
// distances and counts live in these size presets for easy tuning.
import { generateIslandWorld } from './islands.js';

export const WORLD_SIZES = {
  small: {
    label: 'Small', centralRadius: 180, teamRadius: 70, gap: 55,
    tinyCount: [12, 18], tinyRadius: [5, 15], teamHeightOffset: 40,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    horizontalClearance: 20, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 100,
    centerRingWidth: 60, teamRingWidth: 60, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.35, 0.35, 0.15, 0.15], placementAttempts: 50,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
  },
  medium: {
    label: 'Medium', centralRadius: 260, teamRadius: 100, gap: 80,
    tinyCount: [20, 30], tinyRadius: [5, 15], teamHeightOffset: 40,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    horizontalClearance: 20, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 100,
    centerRingWidth: 60, teamRingWidth: 60, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.35, 0.35, 0.15, 0.15], placementAttempts: 50,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
  },
  large: {
    label: 'Large', centralRadius: 350, teamRadius: 140, gap: 105,
    tinyCount: [35, 50], tinyRadius: [5, 15], teamHeightOffset: 40,
    centralSurfaceY: 86, teamAngleJitterDegrees: 15, keepInnerRadius: 0.7,
    horizontalClearance: 20, verticalClearance: 20, tinyKeepClearance: 25,
    aboveClearance: 30, belowClearance: 20, outerReach: 100,
    centerRingWidth: 60, teamRingWidth: 60, tinySurfaceOffset: [-20, 60],
    tinyDistribution: [0.35, 0.35, 0.15, 0.15], placementAttempts: 50,
    caveArea: 6000, pondArea: 1500, worldMargin: 24,
  },
};
export const DEFAULT_WORLD_SIZE = 'medium';

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function parseSeed(text) {
  const str = String(text ?? '').trim();
  if (str === '') return randomSeed();
  if (/^\d+$/.test(str)) return Number(BigInt(str) % 4294967296n);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// teamCount is the number of occupied teams; each team gets an island/keep.
export function generateWorld(seed, teamCount, size = DEFAULT_WORLD_SIZE) {
  return generateIslandWorld(seed, teamCount, WORLD_SIZES[size] ?? WORLD_SIZES[DEFAULT_WORLD_SIZE]);
}
