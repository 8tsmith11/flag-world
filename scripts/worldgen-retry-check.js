import assert from 'node:assert/strict';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { generateWorldWithNoise } from '../shared/worldgenRetry.js';
import { WORLDGEN_RETRY } from '../shared/config.js';

const reportedSeed = 1702761748;
const large = generateWorldWithNoise(reportedSeed, 1, 'large', { createNoise2D, createNoise3D });
assert.equal(large.requestedSeed, reportedSeed);
assert.equal(large.islands.find(island => island.kind === 'fire')?.radius, 35);
assert(large.rivers.some(river => river.kind === 'gorge'));

let first = true;
const retry = generateWorldWithNoise(1, 1, 'small', {
  createNoise2D(seed) {
    if (first) { first = false; throw new Error('No gorge source fits seed 1'); }
    return createNoise2D(seed);
  },
  createNoise3D,
});
assert.equal(retry.generationAttempt, 1);
assert.equal(retry.requestedSeed, 1);
assert.equal(retry.seed,
  (Math.imul(1 ^ WORLDGEN_RETRY.salt, 1664525) + 1013904223) >>> 0);
assert(retry.rivers.some(river => river.kind === 'gorge'));
console.log('Large reported seed and deterministic retry: OK');
