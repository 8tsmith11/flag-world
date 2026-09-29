import { GoblinNav } from './nav.js';
import { GoblinUnit } from './unit.js';
import { GOBLINS, LIFE as C } from '../../shared/goblins/life.js';
import { nodeKey, positionRegion, makeGraph, components } from '../../shared/goblins/areas.js';
import { cellKey } from '../../shared/structures/buildability.js';
import { TICK_RATE } from '../../shared/config.js';
import { S2C } from '../../shared/protocol.js';
import { isSolid } from '../../shared/blocks.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y);
export class Garrison {
  constructor(game) {
    this.game = game; this.plan = game.world.goblinPlan; this.nav = new GoblinNav(game.world);
    this.releases = new Map(); this.slots = game.chunkLoading ? game.chunkLoading.entityMap(s => s.point) : new Map(); this.version = this.plan.outskirtsVersion;
    this.generateSlots(this.nav.regions());
  }
  add(area, role, duty, point, extras = {}) {
    const target = this.nav.nearest(area, point, role); if (!target) throw new Error(`No post in ${area.id}`);
    const slot = { id: `${area.id}:${area.slots.length}`, home: area.id, role, duty,
      point: { x: target.x, y: target.y, z: target.z }, mob: null, ready: 0, loop: this.loop(area), ...extras };
    area.slots.push(slot); this.slots.set(slot.id, slot); return slot;
  }
  loop(area) {
    const nodes = [...area.nodes].map(k => this.plan.graph.get(k)).filter(n => n?.grounded);
    if (!nodes.length) return [];
    const flat = nodes.filter(n => n.y === nodes[0].y), points = flat.length ? flat : nodes;
    const chosen = [points[0]];
    for (let i = 1; i < C.patrolPoints; i++) {
      const n = points.reduce((best, n) => Math.min(...chosen.map(p => dist(p, n))) > Math.min(...chosen.map(p => dist(p, best))) ? n : best, points[0]);
      if (chosen.includes(n)) break; chosen.push(n);
    }
    // A graph diameter gives a section's length even around a corner.
    if (area.kind === 'outskirts') {
      const flood = first => {
        const queue = [first], parent = new Map([[first.key, null]]);
        for (let i = 0; i < queue.length; i++) for (const e of queue[i].edges) {
          if (!area.nodes.has(e.to) || parent.has(e.to)) continue;
          const n = this.plan.graph.get(e.to); if (!n) continue;
          parent.set(e.to, queue[i].key); queue.push(n);
        }
        return { end: queue.at(-1), parent };
      };
      const from = flood(points[0]).end, result = flood(from), route = [];
      for (let k = result.end.key; k; k = result.parent.get(k)) route.push(this.plan.graph.get(k));
      chosen.length = 0;
      for (let i = 0; i < C.patrolPoints; i++) chosen.push(route[Math.round(i * (route.length - 1) / (C.patrolPoints - 1))]);
      chosen.push(...chosen.slice(1, -1).reverse());
    }
    return chosen.map(n => ({ x: n.x, y: n.y, z: n.z }));
  }
  generateSlots(areas) {
    const s = this.plan.surface, f = this.plan.fortress;
    for (const area of areas) {
      area.slots = [];
      area.interests = area.interests.map(p => this.nav.nearest(area, p)).filter(Boolean)
        .map(n => ({ x: n.x, y: n.y, z: n.z }));
      const loop = this.loop(area), point = loop[0]; if (!point) continue;
      if (area.kind === 'outskirts') {
        for (let i = 0; i < C.patrolSoldiers; i++) this.add(area, 'soldier', 'patrol', loop[i % loop.length]);
        for (let i = 0; i < C.patrolArchers; i++) this.add(area, 'archer', 'patrol', loop[(i + 1) % loop.length]);
        continue;
      }
      for (let i = 0; i < Math.max(1, Math.ceil(area.nodes.size / C.workersPerCells)); i++) this.add(area, 'worker', 'worker', area.interests[i % area.interests.length] ?? point);
      for (let i = 0; i < Math.max(1, Math.ceil(area.nodes.size / C.patrolPerCells)); i++) this.add(area, 'soldier', 'patrol', loop[i % loop.length]);
      for (const id of area.gates) {
        const gate = this.plan.gates.find(g => g.id === id);
        const post = this.nav.nearest(area, gate.posts?.[area.id] ?? gate.cells[0]);
        for (let i = 0; i < C.gateGuards; i++) this.add(area, 'soldier', 'gate', post);
        // A reachable point on this side of the gate, two cells behind guards.
        const behind = [...area.nodes].map(k => this.plan.graph.get(k)).filter(n => n && n.y === post.y && dist(n, post) >= 2 && dist(n, post) <= 3)
          .sort((a, b) => dist(a, point) - dist(b, point))[0] ?? post;
        for (let i = 0; i < C.gateArchers; i++) this.add(area, 'archer', 'ground', behind);
      }
      if (area.kind === 'surface') {
        for (let i = 0; i < C.courtyardArchers; i++) this.add(area, 'archer', 'ground', area.interests[0] ?? point);
        const platforms = [...s.pieces.flatMap(p => p.platforms ?? []), ...s.posts.map(p => ({ ...p, width: 3 }))];
        for (const p of platforms) {
          const top = { x: p.x, y: p.y + 1, z: p.z };
          if (!area.nodes.has(nodeKey(top))) continue;
          for (let i = 0; i < C.towerArchers; i++) this.add(area, 'archer', 'tower', top);
        }
      }
      const castle = s.pieces.find(p => p.type === 'castle');
      const hall = f.pieces.find(p => p.type === 'totemHall'), mid = f.pieces.find(p => p.type === 'midRoom');
      for (const p of [castle, mid]) {
        const center = { x: p.position.x + 2, y: (p.padHeight ?? p.position.y) + 1, z: p.position.z + 2 };
        if (area.nodes.has(nodeKey(center))) this.add(area, 'brute', 'point', center, { box: p.box });
      }
      const castlePoint = { ...castle.position, y: castle.padHeight + 1 };
      if (area.nodes.has(nodeKey(castlePoint))) for (let i = 0; i < C.reserve; i++) this.add(area, 'soldier', 'reserve', { ...castlePoint, x: castlePoint.x + 3 + i % 2, z: castlePoint.z + 3 + Math.floor(i / 2) });
      const king = { x: hall.position.x + 2, y: hall.position.y + 1, z: hall.position.z };
      if (area.nodes.has(nodeKey(king))) {
        this.add(area, 'king', 'point', king, { box: hall.box, unique: true, spawnOverride: king });
        const totem = { x: hall.position.x, y: hall.position.y + 1, z: hall.position.z };
        this.add(area, 'totem', 'point', totem, { unique: true, spawnOverride: totem });
      }
    }
  }
  spawnFor(slot) {
    if (slot.spawnOverride) return { id: slot.id, point: slot.spawnOverride };
    const home = this.nav.area(slot.home);
    const alive = a => a.spawns.filter(s => isSolid(this.game.world.getBlock(s.point.x, s.point.y - 1, s.point.z))
      && (!s.supports || s.supports.some(p => isSolid(this.game.world.getBlock(p.x, p.y, p.z))))
      && (!s.box || [s.box.x0, s.box.x1].some(x => isSolid(this.game.world.getBlock(x, s.box.y0, s.box.z0)))));
    if (home.kind === 'outskirts') {
      const linked = this.nav.area(home.linkedArea), spawns = linked ? alive(linked) : [];
      if (spawns.some(s => s.id === home.linkedSpawn?.id)) return home.linkedSpawn;
    }
    const queue = [home], seen = new Set([home.id]);
    for (let i = 0; i < queue.length; i++) {
      const area = queue[i], spawns = alive(area);
      if (spawns.length) return spawns.reduce((a, b) => dist(a.point, slot.point) <= dist(b.point, slot.point) ? a : b);
      for (const g of this.plan.gates.filter(g => g.areas.includes(area.id))) for (const id of g.areas) {
        const next = this.nav.area(id); if (!next || next.state !== 'active' || seen.has(id)) continue;
        seen.add(id); queue.push(next);
      }
    }
    return null;
  }
  update(tick) {
    this.nav.beginTick();
    if (this.version !== this.plan.outskirtsVersion) {
      for (const [id, slot] of this.slots) if (slot.home.startsWith('O')) {
        if (slot.mob) this.game.removeMob(slot.mob); this.slots.delete(id);
      }
      this.generateSlots(this.plan.outskirts); this.version = this.plan.outskirtsVersion;
    }
    for (const slot of this.slots.activeValues?.() ?? this.slots.values()) {
      if (this.game.chunkLoading && !this.game.chunkLoading.has(slot.point.x, slot.point.z)) continue;
      if (slot.mob || slot.ready === null || tick < slot.ready || this.nav.area(slot.home)?.state !== 'active') continue;
      const spawn = this.spawnFor(slot); if (!spawn || tick < (this.releases.get(spawn.id) ?? 0)) continue;
      const route = this.nav.route({ x: spawn.point.x + 0.5, y: spawn.point.y, z: spawn.point.z + 0.5 }, slot.point,
        this.nav.area(slot.home), { role: slot.role, ladders: GOBLINS[slot.role].ladders });
      if (route === null || !route.length && dist(spawn.point, slot.point) > 0.1) continue;
      const mob = new GoblinUnit(this.game.nextId++, this, slot, spawn.point); mob.path = route;
      slot.mob = mob; this.game.mobs.set(mob.id, mob);
      this.releases.set(spawn.id, tick + Math.round(C.releaseSeconds * TICK_RATE));
      this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: mob.describe() });
    }
  }
  removed(mob) {
    const slot = mob.slot; if (!slot || this.slots.get(slot.id) !== slot) return;
    slot.mob = null; slot.ready = GOBLINS[slot.role].respawn === null ? null : this.game.tick + GOBLINS[slot.role].respawn * TICK_RATE;
  }
  hatch(type, x, y, z) {
    let home = positionRegion(this.plan, { x, y, z });
    if (!home) {
      // Eggs outside the village get a small local home using exactly the
      // same volume/graph/physics. These homes don't extend village outskirts.
      const volumes = [], r = C.creativeRadius;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.hypot(dx, dz) <= r) {
        volumes.push({ x0: Math.floor(x) + dx, x1: Math.floor(x) + dx, z0: Math.floor(z) + dz, z1: Math.floor(z) + dz,
          y0: y - C.surfaceDepth, y1: y + C.structureHeadroom });
      }
      const graph = makeGraph(this.game.world, volumes);
      this.nav.reportLadders(graph.ladderProblems);
      const group = components(graph).find(g => g.some(n => n.key === nodeKey({ x, y, z })));
      if (!group) return null;
      const nodes = new Set(group.map(n => n.key)), columns = new Set(group.map(n => cellKey(n.x, n.z)));
      home = { id: `eggHome:${this.game.nextId}`, kind: 'surface', creative: true, state: 'active', nodes, columns,
        volumes: volumes.filter(v => columns.has(cellKey(v.x0, v.z0))), spawns: [], interests: [], gates: [], slots: [] };
      this.plan.creativeAreas ??= []; this.plan.creativeAreas.push(home);
      for (const n of group) if (!this.plan.graph.has(n.key)) this.plan.graph.set(n.key, n);
    }
    const role = type.replace('goblin', '').toLowerCase();
    const slot = { id: `egg:${this.game.nextId}`, home: home.id, role, duty: GOBLINS[role].duty ?? 'point', point: { x: Math.floor(x), y, z: Math.floor(z) }, loop: this.loop(home) };
    return new GoblinUnit(this.game.nextId++, this, slot, slot.point);
  }
}
