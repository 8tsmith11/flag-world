import { BLOCK, FACING_DIRS } from '../blocks.js';
import { ISLAND_SHAPE, STRUCTURE_GEN } from '../config.js';
import { mulberry32 } from '../structures.js';
import { cellKey } from '../structures/buildability.js';
import { createJigsaw, connectedRoute, rotate } from '../structures/jigsaw.js';
import { fortressContent } from './fortressPieces.js';

const intersects = (a, b, m) => a.x0 <= b.x1 + m && a.x1 >= b.x0 - m && a.z0 <= b.z1 + m && a.z1 >= b.z0 - m && a.y0 <= b.y1 + m && a.y1 >= b.y0 - m;
export function fortressFits(map, p, C) {
  const protruding = p.tags.includes('protrusion');
  const reservedSquared=map.reserved.radius*map.reserved.radius;
  for (let z = p.box.z0 - C.rockMargin; z <= p.box.z1 + C.rockMargin; z++) for (let x = p.box.x0 - C.rockMargin; x <= p.box.x1 + C.rockMargin; x++) {
    const rx=x-map.reserved.x,rz=z-map.reserved.z;
    if (rx*rx+rz*rz <= reservedSquared) return false;
    const c = map.cells.get(cellKey(x, z));
    if (c?.keepOut) return false;
    if (!c) { if (!protruding) return false; continue; }
    // A sealed cliff gallery is allowed to bridge the tapered outer shell;
    // interior rooms/corridors still need their complete rock margin.
    const shellBridge=protruding&&c.edge<=ISLAND_SHAPE.shellWidth+C.rockMargin;
    if ((!shellBridge&&p.box.y0<c.bottom+C.rockMargin)||p.box.y1>c.ground-C.rockMargin)return false;
  }
  return !map.boxes.some(b => intersects(p.box, b, C.rockMargin));
}
export function nearestCliff(map, site) {
  let closest = null, distance = Infinity;
  for (const c of map.cells.values()) if (c.edge === 1) {
    if(c.keepOut||c.reserved)continue;
    const d = Math.hypot(c.x - site.x, c.z - site.z);
    if(d>=distance)continue;
    // Aim at a usable cliff, rather than retrying a gallery whose approach
    // crosses a reserved area, construction, or an excluded terrain rim.
    let clear=true;
    const steps=Math.ceil(d/STRUCTURE_GEN.siteStride);
    for(let i=1;i<=steps;i++) {
      const n=map.cells.get(cellKey(Math.round(site.x+(c.x-site.x)*i/steps),Math.round(site.z+(c.z-site.z)*i/steps)));
      if(!n||n.keepOut||n.reserved){clear=false;break;}
    }
    if(clear){closest=c;distance=d;}
  }
  return closest?{ x: closest.x, z: closest.z, distance }:null;
}
export function generateFortress(map, site, floor, seed, C) {
  const content = fortressContent(C), midY = floor - Math.round(C.directDepth * C.midFraction);
  const cliff = nearestCliff(map, site), goal = { x: site.x, y: floor - C.directDepth, z: site.z };
  if(!cliff)return null;
  const toward = Math.abs(cliff.x - site.x) > Math.abs(cliff.z - site.z) ? cliff.x > site.x ? 1 : 3 : cliff.z > site.z ? 2 : 0;
  for (let attempt = 0; attempt < C.layoutAttempts; attempt++) {
    const random = mulberry32(seed + attempt), used = new Set();
    const protectedColumn = { x0: goal.x - 1, x1: goal.x + 1, z0: goal.z - 1, z1: goal.z + 1,
      y0: goal.y + C.totemHeight + 2, y1: midY - 1 };
    const engine = createJigsaw({ seed, density: STRUCTURE_GEN.density,
      validate: p => fortressFits(map, p, C) && !intersects(p.box, protectedColumn, 0) });
    const mid = engine.add(content.rooms.midRoom, { x: site.x, z: site.z, y: midY });
    if (!mid) return null;
    const spine = [mid];
    const roomTemplate = (type, y) => {
      const template = content.rooms[type];
      const depth = (midY - y) / (midY - goal.y);
      const table = type === 'treasureVault' || type === 'kingsRoom' ? C.loot.best : depth > 0.65 ? C.loot.deep : depth > 0.2 ? C.loot.middle : C.loot.shallow;
      return { ...template, loot: template.loot.map(l => ({ ...l, table })) };
    };
    const facingBetween = (a, b) => a.x === b.x ? b.z > a.z ? 2 : 0 : b.x > a.x ? 1 : 3;
    const connectorAt = (p, facing) => ({ piece: p, index: p.connectors.findIndex(c => c.facing === facing) });
    function join(a, b, trap = false) {
      const facing = facingBetween(a.position, b.position), [dx, dz] = FACING_DIRS[facing];
      const start = connectorAt(a, facing), end = connectorAt(b, (facing + 2) % 4);
      const ca = a.connectors[start.index], cb = b.connectors[end.index];
      if (ca.resolved || cb.resolved) return false;
      const length = Math.abs(cb.x - ca.x) + Math.abs(cb.z - ca.z) - 1;
      const drop = a.position.y - b.position.y;
      if (length < C.corridorLength[0] || drop < 0) return false;
      const count = engine.plan.pieces.length, linkCount = engine.plan.links.length, chain = [start];
      const addHall = (first, length, y, trap) => {
        const t = content.hall(length, trap), [ox, oz] = rotate(0, t.z1, facing);
        const p = engine.add(t, { x: first.x - ox, z: first.z - oz, y }, facing);
        if (p) chain.push({ piece: p, index: 0 }, { piece: p, index: 1 });
        return p;
      };
      const first = { x: ca.x + dx, z: ca.z + dz };
      let success;
      if (!drop) success = addHall(first, length, a.position.y, trap);
      else {
        const before = Math.floor((length - 3) / 2), after = length - 3 - before;
        if (before < 2 || after < 2) return false;
        const center = { x: first.x + dx * (before + 1), z: first.z + dz * (before + 1), y: b.position.y };
        const h1 = addHall(first, before, a.position.y, trap);
        const shaft = h1 && engine.add(content.shaft(drop, facing), center);
        if (shaft) chain.push({ piece: shaft, index: 0 }, { piece: shaft, index: 1 });
        success = shaft && addHall({ x: center.x + dx * 2, z: center.z + dz * 2 }, after, b.position.y, false);
      }
      if (!success) { engine.rollback(count, linkCount); return false; }
      chain.push(end);
      for (let i = 0; i < chain.length; i += 2) engine.connect(chain[i], chain[i + 1]);
      return true;
    }
    function addRoom(at, type, parent, trap = false) {
      const n = engine.plan.pieces.length, l = engine.plan.links.length;
      const p = engine.add(roomTemplate(type, at.y), at);
      if (p && join(parent, p, trap)) { used.add(type); return p; }
      engine.rollback(n, l); return null;
    }
    // Seeded self-avoiding walk with varying corridor lengths. Lower levels
    // favor thicker rock inward; upper levels favor the nearest cliff.
    let failed = false;
    for (let i = 0; i < C.roomCount; i++) {
      const parent = spine.at(-1), progress = Math.floor((i + 1) / C.descentInterval) / Math.floor(C.roomCount / C.descentInterval);
      const y = midY - Math.round((midY - goal.y) * progress);
      const entries = content.pools.rooms.entries.filter(e => !e.unique || !used.has(e.id));
      // The vault is required, but its position is selected from the same pool.
      const type = i === C.roomCount - 1 && !used.has('treasureVault') ? 'treasureVault' : entries[Math.floor(random() * entries.length)].id;
      let next = null;
      const choices = [];
      for (let j = 0; j < C.walkChoices; j++) {
        const facing = Math.floor(random() * FACING_DIRS.length), [dx, dz] = FACING_DIRS[facing];
        const length = C.corridorLength[0] + Math.floor(random() * (C.corridorLength[1] - C.corridorLength[0] + 1));
        const distance = C.roomWidth + length;
        const at = { x: parent.position.x + dx * distance, z: parent.position.z + dz * distance, y };
        const cell = map.cells.get(cellKey(at.x, at.z));
        const targetEdge = C.rockMargin + C.roomWidth + (floor - y) * C.midFraction;
        const cliffDistance = Math.hypot(at.x - cliff.x, at.z - cliff.z);
        choices.push({ at, priority: random() - (Math.abs((cell?.edge ?? 0) - targetEdge)
          + cliffDistance * C.cliffBias * (1 - progress)) / C.radius });
      }
      choices.sort((a, b) => b.priority - a.priority);
      for (const choice of choices) {
        next = addRoom(choice.at, type, parent, i % C.floorPatternPeriod === 1);
        if (next) break;
      }
      if (!next) { failed = true; break; }
      spine.push(next);
    }
    if (failed) continue;
    // Return to the hall under the original entrance by a side approach.
    // Try both orthogonal doglegs, then wider doglegs if a depth overlaps.
    const last = spine.at(-1), returns = [
      [{ x: last.position.x, z: goal.z }, goal], [{ x: goal.x, z: last.position.z }, goal],
    ];
    const span = C.roomWidth + C.corridorLength[1];
    for (const sign of [-1, 1]) {
      returns.push([{ x: last.position.x + sign * span, z: last.position.z }, { x: last.position.x + sign * span, z: goal.z }, goal]);
      returns.push([{ x: last.position.x, z: last.position.z + sign * span }, { x: goal.x, z: last.position.z + sign * span }, goal]);
    }
    let totem = null;
    for (const points of returns) {
      const n = engine.plan.pieces.length, l = engine.plan.links.length, added = [], old = last.connectors.map(c => ({ ...c }));
      let parent = last, good = true;
      for (let i = 0; i < points.length; i++) {
        if (points[i].x === parent.position.x && points[i].z === parent.position.z) continue;
        const p = addRoom({ ...points[i], y: goal.y }, i === points.length - 1 ? 'totemHall' : 'junction', parent);
        if (!p) { good = false; break; } added.push(p); parent = p;
      }
      if (good && parent.type === 'totemHall') { totem = parent; spine.push(...added); break; }
      engine.rollback(n, l); last.connectors = old;
    }
    if (!totem) continue;
    // The King's room is connected to the hall and is the deepest chamber.
    let king = null;
    for (const facing of [toward, (toward + 1) % 4, (toward + 3) % 4, (toward + 2) % 4]) {
      const [dx, dz] = FACING_DIRS[facing], distance = (C.totemWidth + C.roomWidth) / 2 + C.corridorLength[1];
      king = addRoom({ x: goal.x + dx * distance, z: goal.z + dz * distance, y: goal.y - C.kingDrop }, 'kingsRoom', totem);
      if (king) break;
    }
    if (!king) continue;
    // Branches use the same room pool and collision/density checks as the spine.
    let branches = 0;
    for (let i = 0; i < Math.round(C.roomCount * C.branchCountFraction); i++) {
      for (let choice = 0; choice < C.walkChoices; choice++) {
        const parent = spine[Math.floor(random() * spine.length)], facing = Math.floor(random() * FACING_DIRS.length), [dx, dz] = FACING_DIRS[facing];
        const entries = content.pools.rooms.entries.filter(e => !e.unique || !used.has(e.id)), type = entries[Math.floor(random() * entries.length)].id;
        const length = C.roomWidth + C.corridorLength[0] + Math.floor(random() * (C.corridorLength[1] - C.corridorLength[0]));
        if (addRoom({ x: parent.position.x + dx * length, z: parent.position.z + dz * length, y: parent.position.y }, type, parent, true)) { branches++; break; }
      }
    }
    if (branches < C.minBranches) continue;
    // One sealed cliff gallery, reached from a free connector on an upper room.
    let protrusion = null;
    for (const parent of spine.filter(p => p.position.y >= midY - C.kingDrop)) {
      const c = parent.connectors[toward]; if (c.resolved) continue;
      const [dx, dz] = FACING_DIRS[toward];
      let length = 0;
      while (length < map.width && map.cells.has(cellKey(c.x + dx * (length + 1), c.z + dz * (length + 1)))) length++;
      length += C.protrusionLength;
      const t = content.hall(length, false, true), [ox, oz] = rotate(0, t.z1, toward);
      const p = engine.add(t, { x: c.x + dx - ox, z: c.z + dz - oz, y: parent.position.y }, toward);
      if (!p) continue;
      engine.connect({ piece: parent, index: toward }, { piece: p, index: 0 });
      protrusion = p; break;
    }
    if (!protrusion) continue;
    const plan = engine.finish();
    plan.roomOrder = spine.map(p => p.id); plan.routeOrder = connectedRoute(plan, mid.id, totem.id); plan.cliff = cliff;
    plan.branches = branches; plan.protrusions = [protrusion.id]; plan.buttresses = [];
    const [dx, dz] = FACING_DIRS[toward];
    for (const b of protrusion.blocks.filter(b => b.y === protrusion.position.y)) {
      const cell = map.cells.get(cellKey(b.x, b.z));
      if (cell && cell.edge > C.buttressDepth) continue;
      let outside = 0;
      while (outside <= C.protrusionLength && !map.cells.has(cellKey(b.x - dx * outside, b.z - dz * outside))) outside++;
      const depth = Math.max(1, C.buttressDepth - Math.floor(outside * C.buttressDepth / (C.protrusionLength + 1)));
      for (let y = b.y - depth; y < b.y; y++) {
        if (!cell || cell.edge<=ISLAND_SHAPE.shellWidth+C.rockMargin || y >= cell.bottom + C.rockMargin) plan.buttresses.push({ x: b.x, y, z: b.z, id: BLOCK.GOBLIN_BRICKS });
      }
    }
    plan.spawnPoints = { goblinTotem: { x: goal.x + 0.5, y: goal.y + 1, z: goal.z + 0.5 },
      goblinKing: { x: king.position.x + 0.5, y: king.position.y + 1, z: king.position.z + 0.5 } };
    plan.attempt = attempt; return plan;
  }
  return null;
}
