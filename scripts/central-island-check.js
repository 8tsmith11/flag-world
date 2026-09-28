// Focused worldgen acceptance; appearance and gameplay remain manual.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../shared/worldgen.js';
import { isSolid, isWater } from '../shared/blocks.js';
import { GORGE_SETTINGS as G, RIVER_SETTINGS as R } from '../shared/config.js';
import { structureAllowed } from '../shared/structures/place.js';
import { checkVillage } from './village-check.js';

const size = process.argv.includes('--large') ? 'large' : 'small';
const hash = world => {
  const h = createHash('sha256');
  for (const [key, chunk] of world.chunks) { h.update(String(key)); h.update(chunk.blocks); }
  return h.digest('hex');
};
for (const seed of [1, 2, 3]) {
  const started = performance.now(), world = generateWorld(seed, 2, size);
  const worldMs = performance.now() - started;
  for (const s of world.structures) if (s.box) assert(structureAllowed(world, s.box), `${s.kind} in reserve`);
  const gorge = world.rivers.find(r => r.kind === 'gorge'), cave = world.gorgeCave;
  assert(gorge && cave && cave.points.length > 1, 'Missing gorge/cave');
  const terrain = world.centralTerrain;
  const top = (x,z) => terrain.top[x-terrain.x0+terrain.width*(z-terrain.z0)] ?? -32768;
  assert.equal(top(Math.round(gorge.end.x), Math.round(gorge.end.z)), -32768, 'River stops inland');
  assert.equal(gorge.lakes.length,0,'Gorge source is still a lake');
  assert.equal(gorge.waterfalls.length,2,'Gorge needs two waterfalls');
  for(const end of gorge.waterfalls) {
    assert.equal(top(Math.round(end.x),Math.round(end.z)),-32768,'Waterfall stops inland');
    assert(gorge.cells.some(c=>Math.hypot(c.x-end.x,c.z-end.z)<=gorge.width
      && top(c.x,c.z)===-32768&&isWater(world.getBlock(c.x,Math.ceil(world.voidY)+1,c.z))), 'No waterfall into void');
  }
  for(const key of world.terrainExclusions) {
    const [x,z]=key.split(',').map(Number);
    assert(structureAllowed(world,{x0:x,x1:x,z0:z,z1:z}),'Gorge/cave margin in reserve');
  }
  for (const c of gorge.cells) {
    assert(isWater(world.getBlock(c.x,c.waterY,c.z)), 'Missing river water');
    assert(structureAllowed(world,{x0:c.x,x1:c.x,z0:c.z,z1:c.z}), 'River in reserve');
  }
  let roofed = 0, walkable = 0;
  for (let i=0;i<cave.points.length;i++) {
    const p=cave.points[i], x=Math.round(p.x),z=Math.round(p.z);
    if(top(x,z) === -32768)continue;
    // At the mouth, the surface reach can replace a lower cave reach.
    let waterY=p.waterY+R.levelStep;
    while(waterY>=p.waterY-R.levelStep&&!isWater(world.getBlock(x,waterY,z)))waterY--;
    assert(waterY>=p.waterY-R.levelStep,'Disconnected cave river');
    assert(!isSolid(world.getBlock(x,waterY+1,z))&&!isSolid(world.getBlock(x,waterY+2,z)), 'Blocked cavern mouth');
    if(isSolid(world.getBlock(x,Math.floor(waterY+p.caveHeight)+G.caveRoofMargin,z)))roofed++;
    const next=cave.points[Math.min(i+1,cave.points.length-1)], prev=cave.points[Math.max(0,i-1)];
    const dx=next.x-prev.x,dz=next.z-prev.z,len=Math.hypot(dx,dz),offset=Math.ceil(p.width/2)+1;
    let shoulder=false;
    for(const sign of [-1,1]) {
      const sx=Math.round(p.x+sign*dz/len*offset),sz=Math.round(p.z-sign*dx/len*offset);
      for(let y=Math.min(waterY,p.waterY);y<=p.waterY+G.caveFloorRise+R.levelStep;y++)if(isSolid(world.getBlock(sx,y,sz))
        && !isSolid(world.getBlock(sx,y+1,sz))&&!isWater(world.getBlock(sx,y+1,sz))
        && !isSolid(world.getBlock(sx,y+2,sz)))shoulder=true;
    }
    if(shoulder)walkable++;
    else assert.equal(i,cave.points.findLastIndex(p=>top(Math.round(p.x),Math.round(p.z))!==-32768), 'No walking shoulder');
  }
  assert(roofed>0&&walkable>0,'Cave must be roofed and walkable');
  for(const piece of [...world.goblinPlan.fortress.pieces,world.goblinPlan.fortress.shaft])for(const p of cave.points) {
    const b=piece.box, dx=Math.max(b.x0-p.x,0,p.x-b.x1),dz=Math.max(b.z0-p.z,0,p.z-b.z1);
    assert(Math.hypot(dx,dz)>p.caveRadius+G.caveRockMargin,'Fortress intersects cave rock margin');
  }
  const village=checkVillage(world), digest=hash(world);
  assert.equal(digest,hash(generateWorld(seed,2,size)),'Same seed changed world');
  console.log(JSON.stringify({seed,size,worldMs:+worldMs.toFixed(1),roofed,walkable,village,hash:digest}));
}
