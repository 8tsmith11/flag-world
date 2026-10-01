// Module workers do not inherit the page's import map; load the same npm
// noise implementation through its existing static vendor route.
import { createNoise2D, createNoise3D } from '/vendor/simplex-noise/simplex-noise.js';
import { generateWorldWithNoise } from '/shared/worldgenRetry.js';
import { generationProgress } from '/shared/generationProgress.js';

self.onmessage = ({ data: { seed, teamCount, worldSize } }) => {
  try {
    const world = generateWorldWithNoise(seed, teamCount, worldSize,
      { createNoise2D, createNoise3D }, generationProgress(percent => self.postMessage({ percent })));
    // Construction plans belong only to the server. Move voxel buffers to
    // the page without copying them or pausing rendering for generation.
    delete world.goblinPlan;
    self.postMessage({ world }, world.transferables());
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
