// Seed parsing and the shared generation entry. Dimensions and content
// density live in worldSizes.js; browser workers inject the same noise library.
import { generateIslandWorld } from './islands.js';

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { WORLD_SIZES, DEFAULT_WORLD_SIZE } from './worldSizes.js';
import { WORLDGEN_RETRY } from './config.js';
export { WORLD_SIZES, DEFAULT_WORLD_SIZE } from './worldSizes.js';

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
export function generateWorld(seed, teamCount, size = DEFAULT_WORLD_SIZE, progress = () => {}) {
  const sizeKey = Object.hasOwn(WORLD_SIZES, size) ? size : DEFAULT_WORLD_SIZE;
  let attemptSeed = seed >>> 0;
  for (let attempt = 0; attempt < WORLDGEN_RETRY.attempts; attempt++) {
    try {
      const world = generateIslandWorld(attemptSeed, teamCount, { ...WORLD_SIZES[sizeKey], sizeKey },
        { createNoise2D, createNoise3D }, progress);
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
