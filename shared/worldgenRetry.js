// Shared by Node and the browser worker. The worker supplies its vendor copy
// of simplex-noise because module workers do not inherit the page import map.
import { generateIslandWorld } from './islands.js';
import { WORLD_SIZES, DEFAULT_WORLD_SIZE } from './worldSizes.js';
import { WORLDGEN_RETRY } from './config.js';

export function generateWorldWithNoise(seed, teamCount, size, noise, progress = () => {}) {
  const sizeKey = Object.hasOwn(WORLD_SIZES, size) ? size : DEFAULT_WORLD_SIZE;
  let attemptSeed = seed >>> 0;
  for (let attempt = 0; attempt < WORLDGEN_RETRY.attempts; attempt++) {
    try {
      const world = generateIslandWorld(attemptSeed, teamCount,
        { ...WORLD_SIZES[sizeKey], sizeKey }, noise, progress);
      world.requestedSeed = seed >>> 0;
      world.generationAttempt = attempt;
      return world;
    } catch (error) {
      const recoverable = /No gorge source fits|No complete goblin village\/fortress fits|Oversized surface area has no building-safe gate partition/.test(error.message);
      if (!recoverable || attempt === WORLDGEN_RETRY.attempts - 1) throw error;
      attemptSeed = Math.imul(attemptSeed ^ WORLDGEN_RETRY.salt ^ attempt, 1664525) + 1013904223 >>> 0;
    }
  }
}
