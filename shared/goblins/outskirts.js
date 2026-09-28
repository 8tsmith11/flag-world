import { cellKey, CARDINAL } from '../structures/buildability.js';
import { makeGraph, components, nodeKey, surfaceVolumes, walkable } from './areas.js';
import { LIFE as C } from './life.js';
import { BLOCK, doorBlock } from '../blocks.js';
import { gatehouses } from './gatehouses.js';

function perimeterOrder(outline) {
  const edges = new Map(), order = new Map();
  for (const k of outline) {
    const [x, z] = k.split(',').map(Number);
    const sides = [[0, -1, x, z, x + 1, z], [1, 0, x + 1, z, x + 1, z + 1],
      [0, 1, x + 1, z + 1, x, z + 1], [-1, 0, x, z + 1, x, z]];
    for (const [dx, dz, ax, az, bx, bz] of sides) if (!outline.has(cellKey(x + dx, z + dz))) {
      edges.set(cellKey(ax, az), { cell: k, end: cellKey(bx, bz) });
    }
  }
  let length = 0;
  while (edges.size) {
    let key = edges.keys().next().value;
    while (edges.has(key)) {
      const edge = edges.get(key); edges.delete(key);
      if (!order.has(edge.cell)) order.set(edge.cell, length);
      length++; key = edge.end;
    }
  }
  return { order, length };
}

// Rebuild from active development, not a fixed circle or a bounding rectangle.
// Server garrison/nav observe outskirtsVersion and replace section slots/caches.
export function recomputeOutskirts(world, plan = world.goblinPlan) {
  const oldKeys = new Set((plan.outskirts ?? []).flatMap(a => [...a.nodes]));
  for (const k of oldKeys) if (!plan.areas.some(a => a.nodes.has(k))) plan.graph.delete(k);
  plan.gates = plan.gates.filter(g => !g.outskirts);
  for (const a of plan.areas) a.gates = a.gates.filter(id => plan.gates.some(g => g.id === id));
  const active = plan.areas.filter(a => a.kind === 'surface' && a.state === 'active');
  const outer = plan.surface.rings.find(r => r.name === 'outer');
  // Existing walls define development where they stand. New active regions
  // beyond that wall contribute their own outlines until a new ring is built.
  const outline = new Set([...(outer?.area ?? []), ...active.flatMap(a => [...a.columns])]);
  const boundary = [...outline].filter(k => {
    const [x, z] = k.split(',').map(Number);
    return CARDINAL.some(([dx, dz]) => !outline.has(cellKey(x + dx, z + dz)));
  });
  const perimeter = perimeterOrder(outline), source = new Map(boundary.map(k => [k, k]));
  const distance = new Map(boundary.map(k => [k, 0])), queue = [...boundary], band = new Set();
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i], d = distance.get(k); if (d >= C.outskirtsWidth) continue;
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of CARDINAL) {
      const nk = cellKey(x + dx, z + dz), cell = plan.buildability.cells.get(nk);
      if (outline.has(nk) || distance.has(nk) || !cell || cell.reserved || cell.keepOut || cell.water === 'lake') continue;
      distance.set(nk, d + 1); queue.push(nk); band.add(nk);
      source.set(nk, source.get(k));
    }
  }
  const graph = makeGraph(world, surfaceVolumes(plan, band), plan.wallCells, plan.platformCells);
  for (const [k, n] of graph) {
    const ground = plan.surface.roads.find(r => r.x === n.x && r.z === n.z)?.y
      ?? plan.buildability.cells.get(cellKey(n.x, n.z))?.ground;
    // Trees/roofs overhead are not island ground and are never patrol space.
    if (n.y !== ground + 1) graph.delete(k);
  }
  // Gatehouses outside the ring remain in their existing surface area.
  for (const a of active) for (const k of a.nodes) graph.delete(k);
  for (const n of graph.values()) n.edges = n.edges.filter(e => graph.has(e.to));
  // A cliff/reservation can separate a walkable part of the perimeter from
  // existing exits. Give that ground component a real gate through the outer
  // wall, rather than routing over a wall or through reserved ground.
  const patches = components(graph);
  for (const patch of patches) {
    if (patch.length < C.minArea) { for (const n of patch) graph.delete(n.key); continue; }
    const keys = new Set(patch.map(n => n.key));
    const touchesExit = active.some(a => [...a.nodes].some(k => {
      const n = plan.graph.get(k); return n && !plan.wallCells.has(cellKey(n.x, n.z)) && CARDINAL.some(([dx, dz]) => [0, 1, -1].some(dy => keys.has(nodeKey({ x: n.x + dx, y: n.y + dy, z: n.z + dz }))));
    }));
    if (touchesExit || !outer) continue;
    const candidates = outer.wall.flatMap(w => {
      if (plan.surface.posts.some(p => Math.abs(p.x - w.x) + Math.abs(p.z - w.z) <= 2)) return [];
      if (plan.surface.rings.some(r => r !== outer && r.wall.some(p => p.x === w.x && p.z === w.z))) return [];
      for (const [dx, dz] of CARDINAL) for (const dy of [0, 1, -1]) {
        const outside = { x: w.x + dx, y: w.y + 1 + dy, z: w.z + dz };
        if (!keys.has(nodeKey(outside))) continue;
        const inside = { x: w.x - dx, y: w.y + 1, z: w.z - dz };
        const area = active.find(a => a.nodes.has(nodeKey(inside)));
        if (area) return [{ w, area, dx, dz, outside }];
      }
      return [];
    });
    const chosen = candidates.sort((a, b) => Math.abs(a.outside.y - a.w.y - 1) - Math.abs(b.outside.y - b.w.y - 1))[0];
    if (!chosen) { for (const n of patch) graph.delete(n.key); continue; }
    const { w, area, dx, dz } = chosen, point = { x: w.x, y: w.y + 1, z: w.z };
    w.axis = dx ? 'z' : 'x';
    outer.wall.splice(outer.wall.indexOf(w), 1); outer.gates.push(w); plan.wallCells.delete(cellKey(w.x, w.z));
    const blocks = [];
    for (let h = 0; h < plan.settings.gateClearance; h++) blocks.push({ ...point, y: point.y + h,
      id: h < 2 ? doorBlock(dx ? 1 : 0, true, h === 1) : BLOCK.AIR });
    for (const b of blocks) world.setBlock(b.x, b.y, b.z, b.id);
    plan.surface.finishing.push(...blocks);
    for (const b of outer.blocks) if (b.x === w.x && b.z === w.z && b.y > w.y && b.y <= w.y + plan.settings.gateClearance) b.id = world.getBlock(b.x, b.y, b.z);
    const houses = gatehouses({ gates: [w] }, plan.surface.roads, plan.buildability, plan.settings) ?? [];
    for (const house of houses) {
      house.id = `outskirtsGatehouse:${plan.surface.gatehouses.length}`; house.padHeight = house.y;
      for (const b of house.blocks) world.setBlock(b.x, b.y, b.z, b.id);
      plan.surface.gatehouses.push(house); plan.surface.finishing.push(...house.blocks);
      world.structures.push({ kind: 'gatehouse', civilization: 'goblin', box: house.box });
      area.spawns.push({ id: house.id, piece: house.id, box: house.box, supports: house.blocks.filter(b => b.y >= house.box.y1 - 1),
        point: { x: w.x - dx, y: w.y + 1, z: w.z - dz } });
    }
    area.nodes.add(nodeKey(point)); area.columns.add(cellKey(point.x, point.z));
    area.volumes.push({ x0: point.x, x1: point.x, z0: point.z, z1: point.z, y0: w.y, y1: w.y + plan.settings.gatehouseHeight + C.structureHeadroom });
    area.revision = (area.revision ?? 0) + 1;
  }
  // Newly placed gatehouse posts can occupy a candidate band cell. Refresh
  // before sectioning, so patrol endpoints never use those stale feet cells.
  const refreshed = makeGraph(world, surfaceVolumes(plan, band), plan.wallCells, plan.platformCells);
  for (const k of graph.keys()) {
    const n = refreshed.get(k); if (n) graph.set(k, n); else graph.delete(k);
  }
  for (const n of graph.values()) n.edges = n.edges.filter(e => graph.has(e.to));
  for (const a of active) for (const k of a.nodes) {
    const n = plan.graph.get(k);
    if (n && !walkable(world, n)) { a.nodes.delete(k); plan.graph.delete(k); }
  }
  const sections = [];
  const count = Math.max(1, Math.ceil(perimeter.length / C.sectionLength));
  const bins = Array.from({ length: count }, () => new Map());
  for (const [k, n] of graph) {
    const index = Math.min(count - 1, Math.floor((perimeter.order.get(source.get(cellKey(n.x, n.z))) ?? 0) / C.sectionLength));
    bins[index].set(k, n);
  }
  for (const bin of bins) for (const group of components(bin)) {

    const nodes = new Set(group.map(n => n.key)), columns = new Set(group.map(n => cellKey(n.x, n.z)));
    sections.push({ id: `O${sections.length + 1}`, kind: 'outskirts', state: 'active', nodes, columns,
      volumes: surfaceVolumes(plan, columns), spawns: [], interests: [], slots: [], gates: [] });
  }
  // Merge short sections through actual walkable edges. This preserves narrow
  // approaches instead of deleting the cells that connect neighbouring bins.
  const membership = new Map(sections.flatMap(a => [...a.nodes].map(k => [k, a])));
  for (const a of [...sections]) {
    if (a.nodes.size >= C.minArea || !sections.includes(a)) continue;
    const neighbour = [...a.nodes].flatMap(k => graph.get(k)?.edges ?? []).map(e => membership.get(e.to)).find(b => b && b !== a && sections.includes(b));
    if (!neighbour) continue;
    for (const k of a.nodes) { neighbour.nodes.add(k); membership.set(k, neighbour); }
    for (const k of a.columns) neighbour.columns.add(k);
    neighbour.volumes.push(...a.volumes); sections.splice(sections.indexOf(a), 1);
  }
  plan.outskirts = sections;
  // Rebuild edges only in these bounded volumes, including gate approaches.
  const combined = makeGraph(world, [...active.flatMap(a => a.volumes), ...sections.flatMap(a => a.volumes)], plan.wallCells, plan.platformCells);
  for (const [k, n] of combined) {
    const old = plan.graph.get(k);
    for (const e of old?.edges ?? []) if (!combined.has(e.to) && plan.graph.has(e.to)) n.edges.push(e);
    plan.graph.set(k, n);
  }
  const owner = new Map([...active, ...sections].flatMap(a => [...a.nodes].map(k => [k, a.id])));
  const outerGroups = [];
  const remaining = new Map((outer?.gates ?? []).map(p => [cellKey(p.x, p.z), p]));
  while (remaining.size) {
    const cells = [remaining.values().next().value]; remaining.delete(cellKey(cells[0].x, cells[0].z));
    for (let i = 0; i < cells.length; i++) for (const [k, p] of remaining) if (Math.abs(p.x - cells[i].x) + Math.abs(p.z - cells[i].z) === 1) {
      cells.push(p); remaining.delete(k);
    }
    outerGroups.push(cells.map(p => ({ ...p, y: p.y + 1 })));
  }
  const edges = new Map();
  for (const [k, a] of owner) for (const e of plan.graph.get(k)?.edges ?? []) {
    const b = owner.get(e.to); if (!b || a === b || ![a, b].some(id => id.startsWith('O'))) continue;
    const ids = [a, b].sort(), key = ids.join(':');
    if (!edges.has(key)) edges.set(key, { areas: ids, cells: [plan.graph.get(k)], outer: ids.some(id => id.startsWith('S')) });
  }
  for (const [key, edge] of edges) {
    const cells = edge.cells.map(n => ({ x: n.x, y: n.y, z: n.z }));
    const group = edge.outer ? outerGroups.reduce((best, g) => !best || Math.hypot(g[0].x - cells[0].x, g[0].z - cells[0].z)
      < Math.hypot(best[0].x - cells[0].x, best[0].z - cells[0].z) ? g : best, null) : null;
    const gate = { id: `gO:${key}`, kind: edge.outer ? 'outer' : 'section', cells: group ?? cells, areas: edge.areas, outskirts: true };
    plan.gates.push(gate);
    for (const id of gate.areas) [...active, ...sections].find(a => a.id === id).gates.push(gate.id);
  }
  for (const a of sections) {
    // Breadth-first gate crossings find the nearest active spawn area. No
    // economy or population state is carried across recomputation.
    const visited = new Set([a.id]), search = [{ id: a.id, outerGate: null }];
    for (let i = 0; i < search.length; i++) {
      const entry = search[i], area = [...active, ...sections].find(a => a.id === entry.id);
      if (area?.kind === 'surface' && area.spawns.length && entry.outerGate) {
        a.linkedGate = entry.outerGate; a.linkedArea = area.id;
        const point = plan.graph.get([...a.nodes][0]);
        a.linkedSpawn = area.spawns.reduce((best, s) => !best || Math.hypot(s.point.x - point.x, s.point.z - point.z)
          < Math.hypot(best.point.x - point.x, best.point.z - point.z) ? s : best, null);
        break;
      }
      for (const g of plan.gates.filter(g => g.areas.includes(entry.id))) for (const id of g.areas) {
        if (visited.has(id) || ![...active, ...sections].some(a => a.id === id)) continue;
        visited.add(id); search.push({ id, outerGate: g.kind === 'outer' ? g.id : entry.outerGate });
      }
    }
  }
  plan.outskirtsVersion = (plan.outskirtsVersion ?? 0) + 1;
  return sections;
}
