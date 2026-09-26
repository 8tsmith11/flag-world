// Creative max-base smoke run. GOBLIN_TIME_SCALE=60 node scripts/goblin-max.js
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateWorld } from '../shared/worldgen.js';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { SaplingGrowth } from '../server/saplings.js';
import { wallProject, shaftCandidates, surfaceHeight } from '../server/goblinProjects.js';
import { findPath, canStand } from '../server/pathfind.js';
import { ladderSpot } from '../shared/goblinModules.js';
import { BLOCK, isLadder, isSolid } from '../shared/blocks.js';
import { GOBLINS, goblinCap } from '../shared/goblins.js';

const seed = Number(process.argv[2] ?? 12345);
const size = process.argv[3] ?? 'small';
const limit = Number(process.argv[4] ?? 1000);
const game = new Game();
game.seed = seed;
game.worldSize = size;
game.world = generateWorld(seed, 2, size);
game.saplings = new SaplingGrowth(game.world, () => false,
  (x, y, z) => game.goblins?.saplingGrowTime(x, y, z));
game.world.onBlockChanged = (x, y, z, id, oldId) => {
  game.goblins?.blockChanged(x, y, z, id, oldId);
  if (oldId === BLOCK.SAPLING && id !== BLOCK.SAPLING) game.saplings.removed(x, y, z);
  if (id === BLOCK.SAPLING && oldId !== BLOCK.SAPLING) game.saplings.planted(x, y, z, game.tick);
};
game.goblins = new GoblinController(game);
game.goblins.spawnAll();
game.goblins.startFastBuild();
const samples = [];
for (let tick = 1; tick <= limit; tick++) {
  game.tick = tick;
  game.saplings.tick(tick);
  game.goblins.update(tick);
  if (tick % 20 === 0 || !game.goblins.fastBuild) {
    const s = game.goblins.status();
    if(process.env.GOBLIN_TRACE)console.log(JSON.stringify({trace:true,tick,modules:s.modules,dwellings:s.dwellings,walls:s.walls,outer:s.outerWall,project:s.project?.label}));
    samples.push({ tick, modules: s.modules, dwellings: s.dwellings,
      surfaceBuildings: game.goblins.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind)).length,
      walls: s.walls,
      outerWall: s.outerWall, relocation: s.relocation, population: s.population,
      project: s.project?.label ?? null, progress: s.project?.progress ?? null });
  }
  if (!game.goblins.fastBuild) break;
}
if(!process.env.GOBLIN_MAX_DIAGNOSTIC)assert.equal(game.goblins.fastBuild, false, 'creative boost finishes within the tick limit');
// Once the boost ends, nearby players switch the colony back to full mode.
// Exercise the building scan after wall posts have been added.
const outerDiagnostics = {};
if (!game.goblins.outerWallBuilt) wallProject(game.world, game.goblins,
  game.goblins.buildings.filter((b) => ['dwelling', 'plot', 'gatehouse'].includes(b.kind) && b.intact), true,
  outerDiagnostics);
if(process.env.GOBLIN_MAX_DIAGNOSTIC) {console.log(JSON.stringify({outerDiagnostics,entrances:game.goblins.entrances.map(e=>({outside:e.outside,top:e.top,open:e.open,sealed:e.sealed})),blocks:Array.from({length:7},(_,i)=>game.world.getBlock(Math.floor(game.goblins.sieges.base().x),Math.round(game.goblins.sieges.base().y)+i-3,Math.floor(game.goblins.sieges.base().z)))}));process.exit(0);}
assert.equal(game.goblins.events.find((e) => e.event === 'fastBuildFinished')?.atCaps, true,
  `creative boost reaches the configured base caps: ${JSON.stringify({ modules: game.goblins.brickModules(),
    dwellings: game.goblins.dwellings(), castle: game.goblins.castleBuilt,
    outerWall: game.goblins.outerWallBuilt, relocation: game.goblins.relocated, outerDiagnostics,
    reserve: game.goblins.relocationReserve && { cell: game.goblins.relocationReserve.spec.cell,
      parentFloor: game.goblins.relocationReserve.spec.parent.floorY },
    hallFloor: game.goblins.hall.floorY,
    candidateCount: shaftCandidates(game.world, game.goblins,
      { allowRough: true, allLevels: true, allowExisting: true }).length,
    missingUpper: game.goblins.events.filter((e) => e.event === 'upperCandidateMissing'),
    upperSites: game.goblins.fortress.modules.filter((m) => m.floorY > game.goblins.hall.floorY)
      .slice(0, 5).map((m) => ({ cell: m.cell, box: m.box, spots: ['N','E','S','W'].map((wall) => {
        const p = ladderSpot({ x: m.box.x0, y: m.box.y0, z: m.box.z0 }, wall);
        return { wall, p, top: surfaceHeight(game.world, p.x, p.z) };
      }) })),
    firstEntrance: game.goblins.entrances[0]?.columns[0],
    moduleCells: game.goblins.fortress.modules.map((m) => ({ type: m.type, cell: m.cell, cliff: m.cliffChain })) })}`);
assert.ok(game.goblins.buildings.filter((b) => b.kind === 'wallPost').every((b) => b.box),
  'every archer wall post has a footprint for targeting and nearby-player scans');
assert.ok(game.goblins.wallSections.length > 0, 'interior walls still build');
assert.ok(game.goblins.fortress.modules.filter((module) => module.cliffChain === 1).length
  <= goblinCap(GOBLINS.expansion.cliffRoomGoal, size), 'cliff branches obey the configured global cap');
assert.ok(game.goblins.fortress.modules.every((module) => !module.cliffChain || module.cliffChain <= 2),
  'a cliff branch extends at most one hall and one terminal room');
assert.ok(game.goblins.wallSections.every((wall) => wall.dwellingsEnclosed >= 4),
  'every inner wall encloses at least four dwellings');
for (const wall of game.goblins.buildings.filter((building) => building.kind === 'wall')) {
  for (const key of wall.footprint) {
    const [x, z] = key.split(',').map(Number);
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .filter(([dx, dz]) => wall.footprint.has(`${x + dx},${z + dz}`)).length;
    assert.ok(neighbors >= 2, `${wall.template} perimeter stays connected at ${key}`);
  }
}
const secondGatehouse = game.goblins.buildings.find((b) => b.kind === 'gatehouse'
  && b.origin.x === game.goblins.relocationNew?.gatehouse.origin.x
  && b.origin.z === game.goblins.relocationNew?.gatehouse.origin.z);
const wallDiagnostics = {};
if (secondGatehouse && !secondGatehouse.walled) {
  const near = game.goblins.buildings.filter((b) => b.kind === 'dwelling' && !b.walled).sort((a, b) =>
    Math.hypot(a.front.x - secondGatehouse.front.x, a.front.z - secondGatehouse.front.z)
    - Math.hypot(b.front.x - secondGatehouse.front.x, b.front.z - secondGatehouse.front.z));
  wallProject(game.world, game.goblins, [secondGatehouse, ...near.slice(0, 2)], false, wallDiagnostics);
}
assert.ok(secondGatehouse?.walled, `relocated entrance lies inside an inner wall section: ${JSON.stringify({
  target: game.goblins.relocationNew?.gatehouse?.origin,
  gatehouses: game.goblins.buildings.filter((b) => b.kind === 'gatehouse').map((b) =>
    ({ origin: b.origin, walled: b.walled, box: b.box })),
  sections: game.goblins.wallSections.map((b) => b.box),
  wallDiagnostics,
  near: game.goblins.buildings.filter((b) => b.kind === 'dwelling').map((b) => ({
    template: b.template, front: b.front, walled: b.walled,
    d: Math.hypot(b.front.x - (secondGatehouse?.front.x ?? 0), b.front.z - (secondGatehouse?.front.z ?? 0))
  })).sort((a, b) => a.d - b.d).slice(0, 6),
})}`);
// Wall gates must preserve real paths from the active entrance to every door.
const entrance=game.goblins.entrances.find((e)=>e.open && !e.sealed);
for(const building of game.goblins.buildings.filter((b)=>b.kind==='dwelling' && b.intact)) {
  const from=entrance.outside,goal=building.front;
  const path=findPath(game.world,{x:Math.floor(from.x),y:Math.round(from.y),z:Math.floor(from.z)},
    {x:Math.floor(goal.x),z:Math.floor(goal.z)},{maxNodes:GOBLINS.walls.routeNodes});
  assert.ok(path.length && Math.hypot(path.at(-1).x-goal.x,path.at(-1).z-goal.z)<2,
    `gate network connects entrance to ${building.template} at ${JSON.stringify(goal)}; stopped ${JSON.stringify(path.at(-1))}`);
}
const walls=game.goblins.buildings.filter((b)=>b.kind==='wall');
const outsideWall=(wall)=> {
  const box=wall.box,x0=box.x0-2,x1=box.x1+2,z0=box.z0-2,z1=box.z1+2;
  const seen=new Set([`${x0},${z0}`]),queue=[[x0,z0]];
  for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x=queue[i][0]+dx,z=queue[i][1]+dz,key=`${x},${z}`;
    if(x<x0 || x>x1 || z<z0 || z>z1 || seen.has(key) || wall.footprint.has(key))continue;
    seen.add(key);queue.push([x,z]);
  }
  return seen;
};
for(const wall of walls) {
  const outside=outsideWall(wall);
  const enclosed=game.goblins.buildings.filter((b)=>b.kind==='dwelling' && !outside.has(`${Math.floor((b.box.x0+b.box.x1)/2)},${Math.floor((b.box.z0+b.box.z1)/2)}`)
    && b.box.x0>wall.box.x0 && b.box.x1<wall.box.x1 && b.box.z0>wall.box.z0 && b.box.z1<wall.box.z1);
  assert.ok(enclosed.length>=GOBLINS.walls.sectionMin,`${wall.template} encloses at least four actual dwellings`);
  if(wall.template==='outerWall')for(const b of game.goblins.buildings.filter((b)=>['dwelling','gatehouse','plot'].includes(b.kind)))
    assert.ok(!outside.has(`${Math.floor((b.box.x0+b.box.x1)/2)},${Math.floor((b.box.z0+b.box.z1)/2)}`),`outer wall encloses ${b.template}`);
  const first=wall.footprint.values().next().value,connected=new Set([first]),queue=[first];
  for(let i=0;i<queue.length;i++) {
    const [x,z]=queue[i].split(',').map(Number);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key=`${x+dx},${z+dz}`;
      if(wall.footprint.has(key) && !connected.has(key)) {connected.add(key);queue.push(key);}
    }
  }
  assert.equal(connected.size,wall.footprint.size,'each wall is one connected perimeter');
}

if(process.env.GOBLIN_WALL_DEBUG)writeFileSync('/tmp/wall-debug.json',JSON.stringify(walls.map(w=>({...w,footprint:[...w.footprint]}))));
for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++) {
  for(const key of walls[i].footprint) {
    const [x,z]=key.split(',').map(Number);
    assert.ok(!walls[j].footprint.has(key) && ![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>walls[j].footprint.has(`${x+dx},${z+dz}`)),
      `wall perimeters remain separate at ${key}: ${walls[i].template}/${walls[i].intact} and ${walls[j].template}/${walls[j].intact}`);
  }
}
for(const wall of walls) {
  for(const gate of wall.gates) {
    const x=Math.floor(gate.x),z=Math.floor(gate.z),y=Math.round(gate.y);
    assert.ok(canStand(game.world,x,y,z,2),`gate headroom stays open at ${x},${y},${z}: ${JSON.stringify({gate,wall:wall.template,blocks:Array.from({length:4},(_,i)=>game.world.getBlock(x,y+i-1,z)),intended:Array.from({length:4},(_,i)=>game.goblins.intended.get(`${x},${y+i-1},${z}`))})}`);
    const alongX=wall.footprint.has(`${x-1},${z}`) || wall.footprint.has(`${x+1},${z}`);
    const nx=gate.nx ?? (alongX?0:1),nz=gate.nz ?? (alongX?1:0);
    for(const sign of [-1,1]) {
      const reach=GOBLINS.walls.gateApproach;
      const tx=x+nx*sign*reach,tz=z+nz*sign*reach;
      const route=findPath(game.world,{x,y,z},{x:tx,z:tz},{maxNodes:600,allowWater:true,
        allowed:(px,py,pz)=>Math.abs((px-x)*nz-(pz-z)*nx)<=1 && Math.abs((px-x)*nx+(pz-z)*nz)<=GOBLINS.walls.gateRampLength});
      assert.ok(route.at(-1)?.x===tx && route.at(-1)?.z===tz,
        `gate ramp connects to surrounding terrain at ${tx},${tz}: ${JSON.stringify({gate,nx,nz,sign,last:route.at(-1),owners:game.goblins.buildings.filter(b=>b.blocks?.some(p=>p.x===x+nx && p.z===z+nz && p.y===y && p.id!==BLOCK.AIR)).map(b=>({template:b.template,box:b.box,gates:b.gates})),columns:Array.from({length:reach+1},(_,i)=>({x:x+nx*sign*i,z:z+nz*sign*i,blocks:Array.from({length:7},(_,j)=>game.world.getBlock(x+nx*sign*i,y+j-3,z+nz*sign*i))}))})}`);
    }
  }
  const gates=new Set(wall.gates.map((p)=>`${Math.floor(p.x)},${Math.floor(p.z)}`));
  for(const key of wall.footprint) {
    if(gates.has(key))continue;
    const [x,z]=key.split(',').map(Number);
    const courses=wall.blocks.filter((b)=>b.x===x && b.z===z && [BLOCK.GOBLIN_BRICKS,BLOCK.WOOD].includes(b.id));
    assert.ok(courses.length>=GOBLINS.walls.height,`wall has full courses at ${key}`);
    for(const b of courses)assert.ok(isSolid(game.world.getBlock(x,b.y,z)),`no unplanned wall hole at ${key},${b.y}`);
  }
  if(wall.mainGate) {
    assert.equal(wall.mainGate.span.length,GOBLINS.walls.mainGateWidth,'main gate is a complete straight span');
    for(const p of wall.mainGate.span) {
      assert.equal(game.world.getBlock(p.x,wall.mainGate.y-1+GOBLINS.walls.gateFrameHeight,p.z),BLOCK.WOOD,'continuous gate lintel');
    }
    for(const p of wall.mainGate.guards)assert.ok(canStand(game.world,Math.floor(p.x),Math.round(p.y),Math.floor(p.z),2),'guard stands on clear supported ground');
  }
}
if(process.env.GOBLIN_LAYOUT_DIR) {
  const b=walls.map((w)=>w.box),x0=Math.min(...b.map(b=>b.x0))-8,z0=Math.min(...b.map(b=>b.z0))-8;
  const width=Math.max(...b.map(b=>b.x1))-x0+9,height=Math.max(...b.map(b=>b.z1))-z0+9;
  const shapes=[];
  for(const building of game.goblins.buildings.filter(b=>['dwelling','gatehouse','plot','castle'].includes(b.kind))) {
    const box=building.box;
    shapes.push(`<rect x="${box.x0-x0}" y="${box.z0-z0}" width="${box.x1-box.x0+1}" height="${box.z1-box.z0+1}" fill="#4a684e" stroke="#ccd7bb" stroke-width="0.3"/>`);
    shapes.push(`<text x="${building.front.x-x0}" y="${building.front.z-z0}" font-size="2" fill="white">${building.template ?? building.kind}</text>`);
  }
  walls.forEach((wall,i)=> {
    const gates=new Set(wall.gates.map(p=>`${Math.floor(p.x)},${Math.floor(p.z)}`));
    for(const key of wall.footprint) {const [x,z]=key.split(',').map(Number);shapes.push(`<rect x="${x-x0}" y="${z-z0}" width="1" height="1" fill="${gates.has(key)?'#68dc96':wall.mainGate?'#f5c95b':'#9eafd8'}"/>`);}
    if(wall.mainGate)shapes.push(`<circle cx="${wall.mainGate.x-x0}" cy="${wall.mainGate.z-z0}" r="3" fill="none" stroke="#ff745b" stroke-width="0.5"/>`);
  });
  const grid=Array.from({length:height},()=>Array(width).fill('.'));
  const mark=(x,z,label)=>{if(grid[z-z0]?.[x-x0]!==undefined)grid[z-z0][x-x0]=label;};
  for(const building of game.goblins.buildings.filter(b=>['dwelling','gatehouse','plot'].includes(b.kind))) {
    const box=building.box;
    for(let z=box.z0;z<=box.z1;z++)for(let x=box.x0;x<=box.x1;x++)mark(x,z,building.kind==='plot'?'P':'B');
    for(const point of building.access ?? [])mark(point.x,point.z,'d');
  }
  for(const wall of walls) {
    for(const key of wall.footprint) {const [x,z]=key.split(',').map(Number);mark(x,z,wall.mainGate?'O':'I');}
    for(const p of wall.gates)mark(Math.floor(p.x),Math.floor(p.z),'G');
    for(const p of wall.mainGate?.span ?? [])mark(p.x,p.z,'M');
  }
  mkdirSync(process.env.GOBLIN_LAYOUT_DIR,{recursive:true});
  writeFileSync(`${process.env.GOBLIN_LAYOUT_DIR}/${size}-grid.txt`,`seed=${seed}, origin=${x0},${z0}\nB=building P=plot d=door lane I=inner wall O=outer wall G=gate M=main gate .=open\n${grid.map(row=>row.join('')).join('\n')}\n`);

  writeFileSync(`${process.env.GOBLIN_LAYOUT_DIR}/${size}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -10 ${width+8} ${height+15}" width="1000" height="800"><rect x="-4" y="-10" width="${width+8}" height="${height+15}" fill="#18251c"/><text x="0" y="-4" fill="white" font-size="3">${size}: blue inner / gold outer / green gates / red main gate</text>${shapes.join('')}</svg>`);
}
const structural = new Set([BLOCK.GOBLIN_BRICKS, BLOCK.WOOD, BLOCK.PLANKS]);
const occupiedBuildings = game.goblins.buildings.filter((b) => b.intact
  && ['dwelling', 'plot', 'gatehouse'].includes(b.kind));
for (let i = 0; i < occupiedBuildings.length; i++) for (let j = i + 1; j < occupiedBuildings.length; j++) {
  const a = occupiedBuildings[i], b = occupiedBuildings[j];
  const gapX = Math.max(a.box.x0 - b.box.x1 - 1, b.box.x0 - a.box.x1 - 1);
  const gapZ = Math.max(a.box.z0 - b.box.z1 - 1, b.box.z0 - a.box.z1 - 1);
  assert.ok(gapX >= 2 || gapZ >= 2,
    `${a.template} and ${b.template} retain at least a two-block gap`);
}
for (const building of occupiedBuildings.filter((b) => b.kind !== 'plot')) for (const { x, y: feet, z } of building.access ?? []) {
  for (let y = feet ?? building.origin.y + 1; y <= (feet ?? building.origin.y + 1) + 1; y++) {
    const id = game.world.getBlock(x, y, z);
    assert.ok(!isSolid(id),
      `${building.template} has an open route from its door at ${x},${y},${z}, block ${id}, origin ${JSON.stringify(building.origin)}, ground ${surfaceHeight(game.world, x, z)}, natural ${game.world.naturalTop[x + game.world.sizeX * z]}, plan ${JSON.stringify(building.blocks?.find((b) => b.x === x && b.y === y && b.z === z))}, owners ${JSON.stringify(game.goblins.buildings.filter((other) => other !== building && other.blocks?.some((b) => b.x === x && b.y === y && b.z === z)).map((other) => ({ template: other.template, box: other.box, block: other.blocks.find((b) => b.x === x && b.y === y && b.z === z) })))}`);
  }
}
for (const building of game.goblins.buildings.filter((b) => b.intact && b.blocks)) {
  for (const block of building.blocks) {
    if (!structural.has(block.id) && !isLadder(block.id)) continue;
    const actual = game.world.getBlock(block.x, block.y, block.z);
    const nearbySaplings = game.goblins.buildings.filter((b) => b.saplings?.some((s) =>
      s.x === block.x && s.z === block.z)).map((b) => ({ template: b.template, origin: b.origin }));
    const overlaps = game.goblins.buildings.filter((b) => b !== building && b.blocks?.some((p) =>
      p.x === block.x && p.y === block.y && p.z === block.z)).map((b) => ({
        template: b.template, id: b.blocks.find((p) => p.x === block.x && p.y === block.y && p.z === block.z)?.id,
        origin: b.origin }));
    assert.equal(actual, block.id,
      `${building.template} block at ${block.x},${block.y},${block.z} survives later construction; actual ${actual}; `
      + `origin ${JSON.stringify(building.origin)}; nearby saplings ${JSON.stringify(nearbySaplings)}; `
      + `overlaps ${JSON.stringify(overlaps)}`);
  }
}
assert.ok(game.goblins.entrances[1].floorY >= game.goblins.hall.floorY + 6,
  'wide entrance arrives above the Totem Hall floor');
assert.equal([...game.goblins.members].filter((g) => game.mobs.has(g.id)).length, 0,
  'unwatched colony bodies are absent from the entity map');
const entitiesFar = game.mobs.size;
const saved = [...game.goblins.members][0];
const hp = saved.hp;
const t = game.goblins.totemSpot;
game.players.set(-1, { connected: true, dead: false,
  state: { x: saved.state.x + 2, y: saved.state.y, z: saved.state.z + 2 } });
game.tick += 20;
game.goblins.update(game.tick);
assert.ok(game.mobs.get(saved.id) === saved, 'the same goblin rematerializes when a player arrives');
assert.equal(saved.hp, hp, 'body hibernation preserves HP');
const entitiesNear = game.mobs.size;
const packets = [];
const viewer = { state: { x: t.x, y: t.y, z: t.z }, socket: { readyState: 1,
  send(data) { packets.push(JSON.parse(data)); } } };
const distant = { state: { x: 0, y: 0, z: 0 }, socket: { readyState: 1,
  send(data) { packets.push(JSON.parse(data)); } } };
game.players.set(-2, viewer);
game.players.set(-3, distant);
game.syncGoblinInterest();
assert.ok(viewer.goblinKnown.size > 0, 'nearby player receives goblin bodies');
assert.equal(distant.goblinKnown.size, 0, 'distant player receives no goblin bodies');
viewer.state = distant.state;
game.syncGoblinInterest();
assert.equal(viewer.goblinKnown.size, 0, 'leaving range despawns goblin bodies for this player');
assert.ok(packets.some((packet) => packet.type === 'entitySpawn')
  && packets.some((packet) => packet.type === 'entityDespawn'), 'range changes send spawn and despawn packets');
const manned = game.goblins.buildings.find((building) => building.postHolder && !building.postHolder.dead);
if (manned) {
  const old = manned.postHolder, slot = old.slot;
  game.goblins.forceMode = 'offscreen';
  game.goblins.nextModeCheck = 0;
  game.goblins.updateMode(++game.tick);
  game.removeMob(old);
  const otherArcher = [...game.goblins.members].find((g) => g.type === old.type && g.slot !== slot);
  if (otherArcher) game.goblins.claimPost(otherArcher);
  assert.equal(manned.postSlot, slot, 'another archer cannot take a dead archer’s station');
  game.goblins.nextSpawnTick = ++game.tick;
  game.goblins.updateSpawning(game.tick);
  const replacement = game.goblins.slots.get(slot);
  assert.ok(replacement?.respawnJourney?.length > 2, 'replacement gets an individual travel route');
  assert.notEqual(replacement.state.y, manned.post.y, 'replacement starts away from the post');
  const route = replacement.respawnJourney;
  game.tick = Math.floor((route[0].tick + route.at(-1).tick) / 2);
  game.goblins.sim.progressJourney(replacement);
  assert.ok(Math.hypot(replacement.state.x - manned.post.x,
    replacement.state.y - manned.post.y, replacement.state.z - manned.post.z) > 1,
  'a player arriving mid-journey finds the replacement along its route');
  game.players.get(-1).state = { x: replacement.state.x, y: replacement.state.y, z: replacement.state.z };
  game.goblins.forceMode = null;
  game.goblins.nextModeCheck = 0;
  game.goblins.updateMode(game.tick);
  assert.ok(game.mobs.get(replacement.id) === replacement, 'traveling replacement materializes as itself');
}
game.players.get(-1).state = { x: saved.state.x + 2, y: saved.state.y, z: saved.state.z + 2 };
game.players.get(-1).dead = true;
game.tick += 20;
game.goblins.update(game.tick);
assert.ok(game.mobs.get(saved.id) === saved, 'goblins stay visible behind a connected player’s death screen');
console.log(JSON.stringify({ seed, size, samples, events: game.goblins.events.filter((e) =>
  ['breakthrough', 'entranceRelocation', 'fastBuildFinished', 'startProject', 'finishProject', 'woodSkipped', 'cancelProject'].includes(e.event)),
  cliffModules: game.goblins.fortress.modules.filter((m) => m.cliffChain).map((m) =>
    ({ type: m.type, cell: m.cell, chain: m.cliffChain })),
  moduleExtent: { minX: Math.min(...game.goblins.fortress.modules.map((m) => m.cell[0])),
    maxX: Math.max(...game.goblins.fortress.modules.map((m) => m.cell[0])),
    minZ: Math.min(...game.goblins.fortress.modules.map((m) => m.cell[2])),
    maxZ: Math.max(...game.goblins.fortress.modules.map((m) => m.cell[2])) },
  outermostModule: game.goblins.fortress.modules.map((m) => ({ cell: m.cell,
    r: Math.hypot(m.center.x - game.world.islands[0].x, m.center.z - game.world.islands[0].z) }))
    .sort((a, b) => b.r - a.r)[0],
  entitiesFar, entitiesNear,
  entrances: game.goblins.entrances.map((e) => ({ id: e.id, column: e.columns[0], outside: e.outside,
    floorY: e.floorY, baseCell: e.base.cell, hallFloorY: game.goblins.hall.floorY,
    gatehouse: e.gatehouse?.box })),
  secondEntranceInInnerWall: secondGatehouse?.innerWalled ?? false,
  castle: game.goblins.buildings.find((b) => b.template === 'castle')?.box,
  relocationReserve: game.goblins.relocationReserve && { cell: game.goblins.relocationReserve.spec.cell,
    parent: { type: game.goblins.relocationReserve.spec.parent.type,
      cell: game.goblins.relocationReserve.spec.parent.cell } },
  credits: { worker: game.goblins.sim.workerCredit, place: game.goblins.sim.placeCredit,
    starved: game.goblins.sim.starved },
  remaining: Object.fromEntries([...new Set(game.goblins.project?.tasks.filter((t) => !t.done).map((t) => `${t.kind}:${t.material}`) ?? [])]
    .map((key) => [key, game.goblins.project.tasks.filter((t) => !t.done && `${t.kind}:${t.material}` === key).length])),
  pending: game.goblins.project?.tasks.filter((t) => !t.done).slice(0, 8).map((t) =>
    ({ kind: t.kind, id: t.id, material: t.material, requires: t.requires.length })) }));
