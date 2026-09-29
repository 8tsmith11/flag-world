import { isSolid } from '../shared/blocks.js';

const caches = new WeakMap();
const LIMIT = 4096;
export function dragonSurface(world, x, z) {
  x = Math.floor(x); z = Math.floor(z);
  let cache = caches.get(world);
  if (!cache) caches.set(world, cache = new Map());
  const key = `${x},${z}`;
  if (cache.has(key)) return cache.get(key);
  const ground = world.getSurfaceY(x, z, isSolid);
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, ground);
  return ground;
}
export function invalidateDragonSurface(world, x, z) { caches.get(world)?.delete(`${x},${z}`); }
