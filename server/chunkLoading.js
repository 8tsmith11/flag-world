// Simulation uses horizontal chunk columns, including their full height.
// Terrain stays authoritative; unloading sleeps entities without deleting them.
import { CHUNK_SIZE, CHUNK_LOADING } from '../shared/config.js';

const key = (x, z) => `${x},${z}`;
const column = p => key(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));

export class ChunkLoading {
  constructor() {
    this.forced = new Set();
    this.loaded = new Set();
    this.maps = new Set();
    this.signature = null;
  }

  configure(world) {
    this.forced.clear();
    for (const island of world.islands ?? []) {
      if (island.kind !== 'team') continue;
      const radius = island.radius + CHUNK_LOADING.teamMargin;
      const x0 = Math.floor((island.x - radius) / CHUNK_SIZE), x1 = Math.floor((island.x + radius) / CHUNK_SIZE);
      const z0 = Math.floor((island.z - radius) / CHUNK_SIZE), z1 = Math.floor((island.z + radius) / CHUNK_SIZE);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const dx = Math.max(x * CHUNK_SIZE - island.x, 0, island.x - (x + 1) * CHUNK_SIZE);
        const dz = Math.max(z * CHUNK_SIZE - island.z, 0, island.z - (z + 1) * CHUNK_SIZE);
        if (dx * dx + dz * dz <= radius * radius) this.forced.add(key(x, z));
      }
    }
    this.signature = null;
    this.update([]);
  }

  update(players) {
    const centers = new Set();
    for (const p of players) if (p.connected && !p.dead && !p.eliminated) centers.add(column(p.state));
    const signature = [...centers].sort().join(';');
    if (signature === this.signature) return;
    this.signature = signature;
    const next = new Set(this.forced), radius = CHUNK_LOADING.simulationDistance;
    for (const center of centers) {
      const [cx, cz] = center.split(',').map(Number);
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        next.add(key(cx + dx, cz + dz));
      }
    }
    for (const k of this.loaded) if (!next.has(k)) for (const map of this.maps) map.activate(k, false);
    for (const k of next) if (!this.loaded.has(k)) {
      for (const map of this.maps) map.activate(k, true);
    }
    this.loaded = next;
  }

  has(x, z) { return this.loaded.has(column({ x, z })); }
  entityMap(position = e => e.state ?? e) { return new ChunkEntityMap(this, position); }
}

// Keep active members indexed so idle distant populations aren't visited each tick.
export class ChunkEntityMap extends Map {
  constructor(loader, position) {
    super();
    this.loader = loader; this.position = position;
    this.buckets = new Map(); this.columns = new Map(); this.active = new Set(); this.ids = new Map();
    loader.maps.add(this);
  }
  set(id, value) {
    if (this.has(id)) this.delete(id);
    super.set(id, value);
    this.ids.set(value, id);
    const k = column(this.position(value, id));
    if (!this.buckets.has(k)) this.buckets.set(k, new Set());
    this.buckets.get(k).add(value); this.columns.set(id, k);
    if (this.loader.loaded.has(k)) this.active.add(value);
    return this;
  }
  delete(id) {
    const value = this.get(id), k = this.columns.get(id);
    if (!super.delete(id)) return false;
    const bucket = this.buckets.get(k); bucket.delete(value);
    if (!bucket.size) this.buckets.delete(k);
    this.columns.delete(id); this.active.delete(value);
    this.ids.delete(value);
    return true;
  }
  clear() { super.clear(); this.buckets.clear(); this.columns.clear(); this.active.clear(); this.ids.clear(); }
  activate(k, enabled) {
    for (const value of this.buckets.get(k) ?? []) {
      if (enabled) this.active.add(value); else this.active.delete(value);
    }
  }
  relocate(entity) {
    if (!this.has(entity.id)) return;
    const old = this.columns.get(entity.id), next = column(this.position(entity, entity.id));
    if (old === next) return;
    const bucket = this.buckets.get(old); bucket.delete(entity);
    if (!bucket.size) this.buckets.delete(old);
    if (!this.buckets.has(next)) this.buckets.set(next, new Set());
    this.buckets.get(next).add(entity); this.columns.set(entity.id, next);
    if (this.loader.loaded.has(next)) this.active.add(entity); else this.active.delete(entity);
  }
  activeValues() { return this.active.values(); }
  *activeEntries() { for (const value of this.active) yield [this.ids.get(value), value]; }
  *nearbyValues(position, radius) {
    const x0 = Math.floor((position.x - radius) / CHUNK_SIZE), x1 = Math.floor((position.x + radius) / CHUNK_SIZE);
    const z0 = Math.floor((position.z - radius) / CHUNK_SIZE), z1 = Math.floor((position.z + radius) / CHUNK_SIZE);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) yield* this.buckets.get(key(x, z)) ?? [];
  }
}
