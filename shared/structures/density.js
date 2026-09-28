// Box volume counts the entire excavation, including its lining. Sampling
// every possible integer window origin makes the cap independent of a grid
// alignment. The sum is exact because jigsaw pieces cannot overlap.
export function localFill(boxes, center, config) {
  const { width: w, height: h } = config;
  const region = { x0: center.x, x1: center.x + w - 1,
    z0: center.z, z1: center.z + w - 1, y0: center.y, y1: center.y + h - 1 };
  let volume = 0;
  for (const b of boxes) volume += Math.max(0, Math.min(b.x1, region.x1) - Math.max(b.x0, region.x0) + 1)
    * Math.max(0, Math.min(b.z1, region.z1) - Math.max(b.z0, region.z0) + 1)
    * Math.max(0, Math.min(b.y1, region.y1) - Math.max(b.y0, region.y0) + 1);
  return volume / (w * w * h);
}
// Extrema of the piecewise-linear intersection volume occur when a window
// edge meets a box edge. Check those origins rather than scanning empty space.
export function densityFits(boxes, config, candidate = null) {
  if (!config) return true;
  const relevant = candidate ? boxes.filter(b => ['x', 'y', 'z'].every(axis => {
    const size = axis === 'y' ? config.height : config.width;
    return b[axis + '0'] < candidate[axis + '1'] + size && b[axis + '1'] > candidate[axis + '0'] - size;
  })) : boxes;
  const maximum = relevant.reduce((n, b) => n + (b.x1 - b.x0 + 1) * (b.z1 - b.z0 + 1) * (b.y1 - b.y0 + 1), 0);
  if (maximum <= config.width ** 2 * config.height * config.maxFill) return true;
  const axes = ['x', 'y', 'z'].map(axis => {
    const size = axis === 'y' ? config.height : config.width;
    const values = new Set(relevant.flatMap(b => [b[axis + '0'], b[axis + '1'] + 1,
      b[axis + '0'] - size, b[axis + '1'] - size + 1]));
    return [...values].filter(v => !candidate || v <= candidate[axis + '1'] && v + size > candidate[axis + '0']);
  });
  // Factor intersections by axis once, rather than recomputing six min/max
  // operations per box in every three-dimensional window. A horizontal
  // window whose maximum possible volume fits needs no vertical scan.
  const lengths = axes.map((origins, axis) => {
    const name = ['x', 'y', 'z'][axis], size = axis === 1 ? config.height : config.width;
    return origins.map(origin => relevant.map(b => Math.max(0,
      Math.min(b[name + '1'] + 1, origin + size) - Math.max(b[name + '0'], origin))));
  });
  const heights = relevant.map(b => Math.min(config.height, b.y1 - b.y0 + 1));
  const limit = (config.maxFill + Number.EPSILON) * config.width ** 2 * config.height;
  const weights = new Float64Array(relevant.length);
  for (const xs of lengths[0]) for (const zs of lengths[2]) {
    let upper = 0;
    for (let i = 0; i < relevant.length; i++) {
      weights[i] = xs[i] * zs[i]; upper += weights[i] * heights[i];
    }
    if (upper <= limit) continue;
    for (const ys of lengths[1]) {
      let volume = 0;
      for (let i = 0; i < relevant.length; i++) volume += weights[i] * ys[i];
      if (volume > limit) return false;
    }
  }
  return true;
}
