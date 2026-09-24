import { BIOME_SETTINGS } from './config.js';

export const BIOME_NAMES = ['plains', 'forest', 'mountains', 'swamp'];
const CODE = Object.fromEntries(BIOME_NAMES.map((name, index) => [name, index + 1]));
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function biomeWeights(kind, x, z, noise) {
  const v = noise(x / BIOME_SETTINGS.noiseScale, z / BIOME_SETTINGS.noiseScale);
  if (kind === 'team' || kind === 'tinyFar') {
    const forest = smooth((v + BIOME_SETTINGS.blend) / (2 * BIOME_SETTINGS.blend));
    return { plains: 1 - forest, forest, mountains: 0, swamp: 0 };
  }
  const weights = { plains: 0, forest: 0, mountains: 0, swamp: 1 };
  for (const [threshold, from, to] of [[-0.4, 'swamp', 'plains'], [0.03, 'plains', 'forest'],
    [0.43, 'forest', 'mountains']]) {
    const mix = smooth((v - threshold + BIOME_SETTINGS.blend) / (2 * BIOME_SETTINGS.blend));
    weights[to] += weights[from] * mix;
    weights[from] *= 1 - mix;
  }
  return weights;
}

export function biomeParameters(weights) {
  return {
    hill: BIOME_NAMES.reduce((sum, name) => sum + weights[name] * BIOME_SETTINGS[name].hill, 0),
    offset: BIOME_NAMES.reduce((sum, name) => sum + weights[name] * BIOME_SETTINGS[name].offset, 0),
    trees: BIOME_NAMES.reduce((sum, name) => sum + weights[name] * BIOME_SETTINGS[name].trees, 0),
    cows: BIOME_NAMES.reduce((sum, name) => sum + weights[name] * BIOME_SETTINGS[name].cows, 0),
  };
}

export function surfaceBiome(weights, x, z, detail) {
  const patch = (detail(x / BIOME_SETTINGS.surfacePatchScale + 800,
    z / BIOME_SETTINGS.surfacePatchScale - 500) + 1) / 2;
  let cumulative = 0;
  for (const name of BIOME_NAMES) {
    cumulative += weights[name];
    if (patch <= cumulative) return name;
  }
  return 'forest';
}

export function biomeCode(name) { return CODE[name] ?? 0; }
export function biomeName(code) { return BIOME_NAMES[code - 1] ?? 'plains'; }
