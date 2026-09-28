import { GOBLIN_GEN as C } from '../config.js';

// Continuous scaling from the central island's dimensions, never its preset.
export function villageSettings(terrain) {
  const r = terrain.radius, s = C.scale;
  return { ...C, radius: r, center: { x: terrain.x, z: terrain.z },
    reservedRadius: r * C.reservedFraction,
    surfacePieces: Math.round(s.surfaceBase + r * s.surfacePerRadius),
    surfaceDepth: Math.round(s.surfaceDepthBase + r * s.surfaceDepthPerRadius),
    minSurfaceBuildings: Math.round(s.buildingsBase + r * s.buildingsPerRadius),
    directDepth: Math.round(s.depthBase + r * s.depthPerRadius),
    roomCount: Math.round(s.roomsBase + r * s.roomsPerRadius),
    outerMargin: Math.round(s.wallMarginBase + r * s.wallMarginPerRadius) };
}
