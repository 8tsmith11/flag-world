// Module workers do not inherit the page's import map; load the same npm
// noise implementation through its existing static vendor route.
import { createNoise2D, createNoise3D } from '/vendor/simplex-noise/simplex-noise.js';
import { generateIslandWorld } from '/shared/islands.js';
import { generationProgress } from '/shared/generationProgress.js';
import { WORLD_SIZES, DEFAULT_WORLD_SIZE } from '/shared/worldSizes.js';

self.onmessage = ({ data: { seed, teamCount, worldSize } }) => {
  try {
    const world = generateIslandWorld(seed, teamCount,
      WORLD_SIZES[worldSize] ?? WORLD_SIZES[DEFAULT_WORLD_SIZE],
      { createNoise2D, createNoise3D }, generationProgress(percent => self.postMessage({ percent })));
    // Construction plans belong only to the server. Move voxel buffers to
    // the page without copying them or pausing rendering for generation.
    delete world.goblinPlan;
    self.postMessage({ world }, world.transferables());
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
