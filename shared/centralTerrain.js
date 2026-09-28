// Broad seeded regions and height terraces. No extra voxel passes or 3D noise.
import { CENTRAL_TERRAIN as C, GOBLIN_GEN } from './config.js';
import { mulberry32 } from './structures.js';
import { BIOME_NAMES } from './biomes.js';

const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function centralRegions(seed) {
  const random = mulberry32(seed ^ C.seedSalt);
  const angle = random() * Math.PI * 2;
  return { angle, cosine: Math.cos(angle), sine: Math.sin(angle),
    transition: mix(...C.transitionOffset, random()),
    rangeRadius: mix(...C.rangeRadius, random()), halfArc: mix(...C.rangeHalfArc, random()),
    gorgeSide: random() < 0.5 ? -1 : 1 };
}

export function regionalColumn(island, x, z, wx, wz, baseHeight, baseWeights, noise, detail) {
  const r = island.radius, dx = x - island.x, dz = z - island.z;
  const radial = Math.hypot(dx, dz) / r;
  const influence = smooth((radial - GOBLIN_GEN.reservedFraction) / C.reserveBlend);
  if (!influence) return { height: baseHeight, weights: baseWeights, lowland: 0 };
  const p = island.regions;
  const u = (wx - island.x) / r, v = (wz - island.z) / r;
  const flow = noise(u / C.regionNoiseScale, v / C.regionNoiseScale);
  const high = smooth((u * p.cosine + v * p.sine + flow * C.regionWarp
    - p.transition + C.transitionWidth) / (2 * C.transitionWidth));
  const angle = Math.atan2(dz, dx) - p.angle;
  const arc = smooth((p.halfArc - Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)))) / C.rangeArcFade);
  const ridgeDistance = (radial - p.rangeRadius - flow * C.regionWarp) / C.rangeWidth;
  const ridge = Math.exp(-ridgeDistance * ridgeDistance) * arc;
  const rolling = noise(u / C.rollingScale, v / C.rollingScale);
  const rough = detail(u / C.detailScale, v / C.detailScale);
  let elevation = r * (C.lowlandOffset + rolling * C.rollingHeight + rough * C.detailHeight
    + high * C.highlandHeight * (1 - radial * C.highlandRimFalloff)
    + ridge * (C.rangeHeight * (1 + flow * C.rangeVariation) + rough * C.ridgeRoughness));

  // Compress most of a height band onto an eroded plateau; the remaining
  // fraction is a short cliff. Spatially varying bands avoid regular stairs.
  const erosion = noise(u / C.terraceNoiseScale, v / C.terraceNoiseScale);
  const step = r * C.terraceHeight * (1 + erosion * C.terraceVariation);
  const phase = elevation / step + erosion * C.terraceErosion;
  const band = Math.floor(phase), fraction = phase - band;
  const stepped = (band + smooth((fraction - 1 + C.terraceCliffFraction) / C.terraceCliffFraction)
    - erosion * C.terraceErosion) * step;
  const terraces = high * smooth((flow - C.terracePatchThreshold) / C.terracePatchBlend) * C.terraceStrength;
  elevation = mix(elevation, stepped, terraces);

  const mountains = smooth((high * C.mountainRegionWeight + ridge * (1 - C.mountainRegionWeight)
    - C.mountainThreshold) / C.mountainBlend);
  const forestScale=mix(C.forestScale,C.highlandForestScale,high);
  const forest = smooth((noise(u / forestScale + p.cosine, v / forestScale + p.sine)
    - C.forestThreshold - high*C.highlandForestThreshold + C.forestBlend) / (2 * C.forestBlend))
    * (1 - mountains) * (1-high*C.highlandForestReduction);
  const regional = { plains: 1 - mountains - forest, forest, mountains };
  const weights = {};
  for(const name of BIOME_NAMES)weights[name]=mix(baseWeights[name],regional[name],influence);
  return { height: mix(baseHeight, island.surfaceY + elevation, influence), weights, lowland: 1-high };
}
