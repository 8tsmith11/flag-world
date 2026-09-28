// Focused acceptance on generated voxel geometry. No tick simulation.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { generateWorld, parseSeed } from '../shared/worldgen.js';
import { BLOCK, isSolid, isLadder, ladderFacing, FACING_DIRS, isWater } from '../shared/blocks.js';
import { STRUCTURE_GEN as E, WALK_SPEED, SPRINT_SPEED_SCALE, JUMP_VELOCITY, GRAVITY } from '../shared/config.js';
import { playerFitsAt } from '../shared/physics.js';
import { cellKey } from '../shared/structures/buildability.js';
import { registeredBlockIds } from '../shared/blocks.js';
import { registeredItemIds, creativeItemIds, getItemDef } from '../shared/items.js';
import { CREATIVE_RECIPES } from '../shared/recipes.js';
import { externalPlatformAccess } from '../shared/structures/walls.js';
import { densityFits } from '../shared/structures/density.js';
import { fortressFits } from '../shared/goblins/fortressLayout.js';
import { structureMap } from './structure-map.js';
import { writeFileSync } from 'node:fs';
const key = p => `${p.x},${p.y},${p.z}`;
export function walkGraph(world, start, bounds) {
  const feet = (x, y, z) => playerFitsAt(world, { x: x + 0.5, y, z: z + 0.5 }, y)
    && !isWater(world.getBlock(x, y, z)) && (isSolid(world.getBlock(x, y - 1, z)) || isLadder(world.getBlock(x, y, z)) || isLadder(world.getBlock(x, y - 1, z)));
  const nodes = new Map([[key(start), { ...start, parent: null, distance: 0 }]]), queue = [nodes.get(key(start))];
  const add = (node, x, y, z) => {
    const k = `${x},${y},${z}`;
    if (nodes.has(k) || x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1 || y < bounds.y0 || y > bounds.y1 || !feet(x, y, z)) return false;
    const next = { x, y, z, parent: node, distance: node.distance + 1 }; nodes.set(k, next); queue.push(next); return true;
  };
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (isLadder(world.getBlock(p.x, p.y, p.z)) || isLadder(world.getBlock(p.x, p.y - 1, p.z))) {
      add(p, p.x, p.y + 1, p.z); add(p, p.x, p.y - 1, p.z);
    }
    for (const [dx, dz] of FACING_DIRS) for (const dy of [0, 1, -1]) {
      // A jump needs headroom; walking down must clear the upper body too.
      if (dy === 1 && !playerFitsAt(world, { x: p.x + 0.5, z: p.z + 0.5 }, p.y + 1)) continue;
      if (dy === -1 && !playerFitsAt(world, { x: p.x + dx + 0.5, z: p.z + dz + 0.5 }, p.y)) continue;
      if (add(p, p.x + dx, p.y + dy, p.z + dz)) break;
    }
  }
  return nodes;
}
export function checkVillage(world) {
  const { surface: s, fortress: f, buildability: map, settings: C, reserved } = world.goblinPlan;
  const entrance = s.pieces[0], totem = f.pieces.find(p => p.type === 'totemHall'), mid = f.pieces[0];
  assert.equal(totem.box.y1 - totem.box.y0 - 1, C.totemHeight);
  assert(entrance.padHeight - totem.box.y1 >= C.minDepth, 'Totem ceiling must be deep enough');
  const allBlocks = [...s.pieces.flatMap(p => [...p.blocks, ...p.earthworks]), ...s.finishing,
    ...f.pieces.flatMap(p => p.blocks), ...f.finishing];
  const ladderCells = new Map(allBlocks.filter(b => isLadder(world.getBlock(b.x, b.y, b.z))).map(b => [key(b), b]));
  for (const b of ladderCells.values()) {
    const id = world.getBlock(b.x, b.y, b.z), [dx, dz] = FACING_DIRS[ladderFacing(id)];
    assert(isSolid(world.getBlock(b.x + dx, b.y, b.z + dz)), `Unsupported ladder ${key(b)}`);
  }
  assert.equal(f.shaft.box.x1 - f.shaft.box.x0 - 1, 1);
  for (let y = f.shaft.box.y0; y <= f.shaft.box.y1; y++) {
    assert(isLadder(world.getBlock(f.shaft.position.x, y, f.shaft.position.z)), `Shaft ladder at ${y}`);
    for (const [dx, dz] of FACING_DIRS) {
      if (dx === 1 && y <= mid.position.y + C.passageHeight) continue;
      assert.equal(world.getBlock(f.shaft.position.x + dx, y, f.shaft.position.z + dz), BLOCK.GOBLIN_BRICKS, 'Shaft lining');
    }
  }
  for (const b of f.plug) assert.equal(world.getBlock(b.x, b.y, b.z), BLOCK.GOBLIN_BRICKS, 'Original shaft plug');
  const boxes = [...s.pieces, ...f.pieces].map(p => p.box);
  const bounds = { x0: Math.min(...boxes.map(b => b.x0)) - C.outerMargin - C.roadLength,
    x1: Math.max(...boxes.map(b => b.x1)) + C.outerMargin + C.roadLength,
    z0: Math.min(...boxes.map(b => b.z0)) - C.outerMargin - C.roadLength,
    z1: Math.max(...boxes.map(b => b.z1)) + C.outerMargin + C.roadLength,
    y0: Math.min(...f.pieces.map(p => p.box.y0)), y1: Math.max(...s.pieces.map(p => p.box.y1)) + 3 };
  const graph = walkGraph(world, { x: entrance.position.x, y: entrance.padHeight + 1, z: entrance.position.z }, bounds);
  const destination = graph.get(key({ x: totem.position.x, y: totem.position.y + 1, z: totem.position.z }));
  assert(destination, 'No route: ' + f.routeOrder.map(id => { const p = f.pieces.find(p => p.id === id); return p.type + ':' + graph.has(key({ x:p.position.x, y:p.position.y+1, z:p.position.z })); }).join(' -> '));
  assert(destination.distance >= C.directDepth * C.routeMultiple, `Route too short: ${destination.distance}`);
  const visitedRooms = new Set();
  for (let n = destination; n; n = n.parent) for (const p of f.pieces) {
    if (!p.tags.includes('room') || ['midRoom', 'totemHall', 'royalVault'].includes(p.type)) continue;
    if (n.x > p.box.x0 && n.x < p.box.x1 && n.z > p.box.z0 && n.z < p.box.z1 && n.y > p.box.y0 && n.y < p.box.y1) visitedRooms.add(p.id);
  }
  assert(visitedRooms.size >= C.routeRooms, `Route only visits ${visitedRooms.size} rooms`);
  // Ray march from all accessible shaft/Mid Room eye positions to the entire
  // hall interior, not just its center. A single unobstructed ray is a defect.
  const sources = [...graph.values()].filter(n => n.x === entrance.position.x && n.z === entrance.position.z && n.y >= mid.position.y
    || n.x > mid.box.x0 && n.x < mid.box.x1 && n.z > mid.box.z0 && n.z < mid.box.z1 && n.y > mid.box.y0 && n.y < mid.box.y1);
  for (const a of sources) for (let z = totem.box.z0 + 1; z < totem.box.z1; z++) for (let x = totem.box.x0 + 1; x < totem.box.x1; x++) {
    const target = { x: x + 0.5, y: totem.position.y + 2.5, z: z + 0.5 }, origin = { x: a.x + 0.5, y: a.y + 1.5, z: a.z + 0.5 };
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z), steps = Math.ceil(distance * 4);
    let blocked = false;
    for (let i = 1; i < steps; i++) if (isSolid(world.getBlock(Math.floor(origin.x + (target.x - origin.x) * i / steps),
      Math.floor(origin.y + (target.y - origin.y) * i / steps), Math.floor(origin.z + (target.z - origin.z) * i / steps)))) { blocked = true; break; }
    assert(blocked, 'Totem Hall visible from entrance/shaft/Mid Room');
  }
  for (const p of s.pieces) {
    if (p.type === 'path') assert(s.links.some(l => l.from === p.id), 'Transit path ends without a destination');
    assert(p.earthwork.cost <= p.earthwork.budget, `Earthwork ${p.id}`);
    for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) {
      const c = map.cells.get(cellKey(x, z)); assert(c && !c.keepOut && !c.reserved && (c.water !== 'lake' || p.waterCrossing), `Protected cell ${p.id}`);
    }
    const reachable = [...graph.values()].some(n => n.x >= p.box.x0 && n.x <= p.box.x1 && n.z >= p.box.z0 && n.z <= p.box.z1 && n.y === (p.levels?.[cellKey(n.x, n.z)] ?? p.padHeight) + 1);
    assert(reachable, `Surface piece unreachable: ${p.id}`);
    for (const top of p.platforms) {
      assert.equal(top.ladder.x, top.x); assert.equal(top.ladder.z, top.z);
      assert(isLadder(world.getBlock(top.x, top.ladder.y, top.z)), 'Archer hatch ladder must start in center');
      const h = top.width >> 1;
      for (let z = top.z - h; z <= top.z + h; z++) for (let x = top.x - h; x <= top.x + h; x++) {
        assert(x === top.x && z === top.z || isSolid(world.getBlock(x, top.y, z)), `Archer platform not flat ${p.id} ${x},${top.y},${z}`);
        assert(!isSolid(world.getBlock(x, top.y + 1, z)), 'Archer platform obstructed');
      }
      assert(graph.has(key({ ...top, y: top.y + 1 })), `Archer hatch unreachable ${p.id} at ${key(top)} base=${graph.has(key(top.ladder))}`);
    }
    if (p.type === 'tower') {
      const cx = p.position.x, cz = p.position.z, top = p.padHeight + C.towerHeight;
      assert(isLadder(world.getBlock(cx, p.padHeight + 1, cz)), 'Tower ladder must start at center');
      for (let y = p.padHeight + 1; y <= top; y++) assert(isLadder(world.getBlock(cx, y, cz)), 'Tower ladder missing');
      for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) {
        assert(!isSolid(world.getBlock(x, top + 1, z)), 'Tower has an obstruction over platform');
        assert(x === cx && z === cz || isSolid(world.getBlock(x, top, z)), 'Tower platform not flat');
      }
      assert(graph.has(key({ x: cx, y: top + 1, z: cz })), 'Tower hatch unreachable');
    }
  }
  for (const ring of s.rings) {
    assert(ring.corners <= (ring.name === 'outer' ? E.outerCorners : E.compoundCorners), 'Too many wall corners');
    assert(ring.gates.length, `${ring.name} has no gates`);
    for (const w of ring.wall) {
      assert(C.wallHeight > Math.max(JUMP_VELOCITY ** 2 / (2 * GRAVITY), C.goblinJumpHeight) + 1, 'Wall too low');
      for (let y = w.y + 1; y <= w.y + C.wallHeight; y++) assert(isSolid(world.getBlock(w.x, y, w.z)), `Wall gap ${key(w)}`);
    }
    for (const g of ring.gates) {
      assert(!isSolid(world.getBlock(g.x, g.y + 1, g.z)), 'Gate has a raised floor block');
      assert.notEqual(world.getBlock(g.x, g.y, g.z), BLOCK.GOBLIN_BRICKS, 'Gate replaces path with a brick threshold');
      assert(!ring.blocks.some(b => b.x === g.x && b.z === g.z && b.y <= g.y), 'Gate adds a threshold');
      assert(s.roads.some(r => r.x === g.x && r.z === g.z), 'Gate is not on a path');
      assert(graph.has(key({ ...g, y: g.y + 1 })), 'Gate unreachable');
      assert(FACING_DIRS.some(([dx, dz]) => s.roads.some(r => r.x === g.x + dx && r.z === g.z + dz)
        && s.roads.some(r => r.x === g.x - dx && r.z === g.z - dz)), 'Gate lacks two approaches');
    }
  }
  for (const post of s.posts) {
    for (const b of post.platform) {
      assert(isSolid(world.getBlock(b.x, b.y, b.z)), 'Archer post has no platform');
      assert(!isSolid(world.getBlock(b.x, b.y + 1, b.z)), 'Archer post has an obstruction');
      assert(graph.has(key({ ...b, y: b.y + 1 })), `Archer post unreachable ${key(b)} ladder=${JSON.stringify(post.ladder)} ladderReach=${graph.has(key({x:post.ladder.x,y:post.ladder.base+1,z:post.ladder.z}))}`);
    }
  }
  assert.equal(entrance.type, 'castle', 'Shaft must be inside Castle');
  assert.equal(f.shaft.box.y1, entrance.padHeight, 'Shaft top must be flush with ground floor');
  assert(!isSolid(world.getBlock(entrance.position.x, entrance.padHeight, entrance.position.z)), 'Castle blocks shaft mouth');
  assert(!isLadder(world.getBlock(entrance.position.x, entrance.padHeight + 1, entrance.position.z)), 'Shaft protrudes above floor');
  assert(s.rings.some(r => r.name !== 'outer' && r.pieceIds.includes(entrance.id)), 'Castle lacks compound');
  assert(s.gatehouses.length, 'No outer gatehouses');
  for (const g of s.rings.find(r => r.name === 'outer').gates) assert(s.gatehouses.some(h => h.gates.some(a => a.x === g.x && a.z === g.z)), 'Outer gate lacks gatehouse');
  // Every written cell, including earthworks and auxiliary structures, respects
  // the center reservation. Towers and wall posts cannot supply an outside ladder.
  for (const b of allBlocks) assert(Math.hypot(b.x - reserved.x, b.z - reserved.z) > reserved.radius, `Reserved cell ${key(b)}`);
  for (const post of s.posts) {
    const ring = s.rings.find(r => r.name === post.ring);
    assert(ring?.area.includes(cellKey(post.ladder.x, post.ladder.z)), 'Wall-post ladder outside its wall');
  }
  const jump = { speed: WALK_SPEED * SPRINT_SPEED_SCALE, velocity: JUMP_VELOCITY, gravity: GRAVITY, margin: C.ladderSafetyMargin };
  const raised = [...s.pieces.flatMap(p => p.platforms), ...s.posts.map(p => ({ ...p, width: C.postWidth }))];
  for (const ring of s.rings) {
    assert(!raised.some(top => externalPlatformAccess(top, ring, jump)), 'Raised ladder platform gives outside access to wall');
    const area = new Set(ring.area), wall = new Set(ring.wall.map(w => cellKey(w.x, w.z)));
    for (const b of ladderCells.values()) {
      if (b.y <= entrance.padHeight || area.has(cellKey(b.x, b.z))) continue;
      assert(!FACING_DIRS.some(([dx, dz]) => wall.has(cellKey(b.x + dx, b.z + dz))), `Ladder ${key(b)} climbs ${ring.name} from outside`);
    }
  }
  assert(f.branches >= C.minBranches, 'Fortress does not branch');
  const prefix = [];
  for (const p of f.pieces) {
    assert(!/stair/i.test(p.type + p.template), 'Underground stairs remain');
    assert(fortressFits(map, p, C), `Rock/reservation margin ${p.id}`);
    prefix.push(p.box);
    assert(densityFits(prefix, E.density, p.box), `Local fill limit ${p.id}`);
    if (p.type === 'ladderShaft') {
      assert.equal(p.box.x1 - p.box.x0, 2); assert.equal(p.box.z1 - p.box.z0, 2);
      for (let y = p.box.y0 + 1; y < p.box.y1; y++) assert(isLadder(world.getBlock(p.position.x, y, p.position.z)), 'Vertical shaft has no ladder');
    }
    const doors = f.links.flatMap(l => [l.a, l.b].flatMap(d => {
      const half=Math.floor(Math.min(l.a.width??1,l.b.width??1)/2);
      return Array.from({length:half*2+1},(_,i)=>({...d,
        x:d.x+(d.facing%2?0:i-half),z:d.z+(d.facing%2?i-half:0)}));
    }));
    const windows = [];
    for (const b of p.blocks) {
      const boundary = b.x === p.box.x0 || b.x === p.box.x1 || b.z === p.box.z0 || b.z === p.box.z1 || b.y === p.box.y0 || b.y === p.box.y1;
      if (!boundary || isSolid(world.getBlock(b.x, b.y, b.z))) continue;
      if (doors.some(d => d.x === b.x && d.z === b.z && b.y >= d.y && b.y < d.y + C.passageHeight)
        || p === mid && b.x === f.shaft.position.x && b.z === f.shaft.position.z) continue;
      assert(p.tags.includes('protrusion'), `Unsealed face ${p.id} ${key(b)}`);
      windows.push(b);
    }
    for (const b of windows) assert(!windows.some(a => a !== b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1), 'Protrusion opening exceeds 1x1');
    if (p.tags.includes('protrusion')) assert(windows.length > 0 && f.buttresses.length > 0, 'Protrusion lacks slit/support');
  }
  const column = { ...f.shaft.box, y0: totem.box.y1 + 1 };
  assert(densityFits([...prefix, column], E.density, column), 'Shaft column exceeds fill limit');
  const king = f.pieces.find(p => p.type === 'royalVault');
  assert(king && f.pieces.filter(p => p.tags.includes('room')).every(p => p === king || p.box.y0 > king.box.y0), 'King room is not deepest');
  assert(graph.has(key({ x: king.position.x, y: king.position.y + 1, z: king.position.z })), 'King room unreachable');
  for (const type of C.uniqueRooms) assert(f.pieces.filter(p => p.type === type).length <= 1, `Unique room repeated: ${type}`);
  assert(f.pieces.some(p => p.type === 'treasureVault'), 'Missing treasure vault');
  const creative = new Set(CREATIVE_RECIPES.map(r => r.output));
  for (const id of creativeItemIds()) assert(creative.has(id), `Missing creative item ${id}`);
  assert(getItemDef(BLOCK.MUSHROOM).icon, 'Mushroom lacks unique icon');
  for (const p of f.pieces.filter(p => p.loot.length)) for (const c of p.loot) {
    assert(world.lootChests.has(key(c)), 'Missing loot registration');
    assert.equal(world.getBlock(c.x, c.y, c.z), BLOCK.CHEST + 2, 'Missing loot chest');
  }
  return { routeLength: destination.distance, rooms: visitedRooms.size, pieces: s.pieces.length, ladders: ladderCells.size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const value of process.argv.slice(2).filter(a => !a.startsWith('--')).length ? process.argv.slice(2).filter(a => !a.startsWith('--')) : ['1', '2', '3']) {
    const world = generateWorld(parseSeed(value), 2, 'small');
    if (process.argv.includes('--maps')) writeFileSync(`/tmp/structure-${world.seed}.txt`, structureMap(world));
    console.log(`Seed ${world.seed}:`, checkVillage(world));
  }
}
