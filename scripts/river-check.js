import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generateWorld,WORLD_SIZES} from '../shared/worldgen.js';
import {BLOCK,isSolid,isWater} from '../shared/blocks.js';
import {RIVER_SETTINGS as C,GOBLIN_GEN} from '../shared/config.js';
const size=process.argv.includes('--large')?'large':'medium';
function hash(w){const h=createHash('sha256');for(const [k,c]of w.chunks){h.update(String(k));h.update(c.blocks);}return h.digest('hex');}
for(const seed of process.argv.slice(2).filter(a=>/^\d+$/.test(a)).map(Number).length ? process.argv.slice(2).filter(a=>/^\d+$/.test(a)).map(Number) : [1,2,3]) {
  const start=performance.now(),w=generateWorld(seed,2,size),center=w.islands.find(i=>i.kind==='center'),t=w.centralTerrain;
  const top=(x,z)=>x<t.x0||z<t.z0||x>=t.x0+t.width||z>=t.z0+t.width?-32768:t.top[x-t.x0+t.width*(z-t.z0)];
  assert.equal(w.rivers.length,WORLD_SIZES[size].rivers,`seed ${seed}: missing river`);
  for(const lake of w.lakes){assert(lake.cells.length>=C.minLakeCells,'undersized lake');for(const c of lake.cells)if(lake.kind==='river')assert(Math.hypot(c.x-center.x,c.z-center.z)>center.radius*GOBLIN_GEN.reservedFraction,'lake in reserve');}
  let exposedDirt=0;
  for(const r of w.rivers) {
    if(r.kind==='gorge')assert(!r.lakes.length&&w.gorgeCave&&r.waterfalls.length===2,'gorge must continue through cave to second waterfall');
    else assert(w.lakes.some(l=>l.x===r.source.x&&l.z===r.source.z),'source is not lake');
    assert.equal(top(Math.round(r.end.x),Math.round(r.end.z)),-32768,'river stopped inland');
    assert(r.cells.some(c=>top(c.x,c.z)===-32768&&isWater(w.getBlock(c.x,Math.ceil(w.voidY)+1,c.z))),'waterfall did not reach void');
    for(let i=1;i<r.points.length;i++) {
      const a=r.points[i-1],b=r.points[i];assert(b.waterY<=a.waterY,'uphill water');
      assert.notEqual(a.waterY-b.waterY,1,'one-block staircase');
      assert(Math.hypot(b.x-a.x,b.z-a.z)<=C.pathStep*2,'centerline discontinuity');
    }
    for(const c of r.cells) {
      assert(Math.hypot(c.x-center.x,c.z-center.z)>center.radius*GOBLIN_GEN.reservedFraction,'river in reserve');
      assert(isWater(w.getBlock(c.x,c.waterY,c.z)),'carved river water missing');
      for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x=c.x+dx,z=c.z+dz;
        for(let y=c.waterY+1;y<=top(x,z);y++)if(w.getBlock(x,y,z)===BLOCK.DIRT&&!isSolid(w.getBlock(c.x,y,c.z))){exposedDirt++;console.log('DIRT', {seed,x,y,z,waterY:c.waterY});}
      }
    }
  }
  assert.equal(exposedDirt,0,'exposed dirt walls at river bank');
  const wet=new Map(w.rivers.flatMap(r=>r.cells.map(c=>[`${c.x},${c.z}`,c]))),rects=[];
  for(let z=t.z0;z<t.z0+t.width;z++)for(let x=t.x0;x<t.x0+t.width;x++) {
    const y=top(x,z);if(y===-32768)continue;
    const water=wet.get(`${x},${z}`);let color;
    if(water)color='#4698d0';else {let yy=y+2;while(yy>y-40&&w.getBlock(x,yy,z)===BLOCK.AIR)yy--;const id=w.getBlock(x,yy,z);color=id===BLOCK.SAND?'#d8ca91':id===BLOCK.WATER?'#4698d0':id===BLOCK.GRASS?`rgb(${65+(y-center.surfaceY)*2},${120+(y-center.surfaceY)*2},65)`:'#777b70';}
    rects.push(`<rect x="${x-t.x0}" y="${z-t.z0}" width="1" height="1" fill="${color}"/>`);
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 ${t.width} ${t.width}" style="background:#111b2d">${rects.join('')}<circle cx="${center.x-t.x0}" cy="${center.z-t.z0}" r="${center.radius*GOBLIN_GEN.reservedFraction}" fill="none" stroke="#d593c5" stroke-width="1"/>${w.rivers.map(r=>`<circle cx="${r.source.x-t.x0}" cy="${r.source.z-t.z0}" r="2" fill="#ffda7b"/>`).join('')}</svg>`;
  writeFileSync(`/tmp/river-${seed}.svg`,svg);
  console.log(JSON.stringify({seed,size,worldMs:Math.round(performance.now()-start),riverMs:+w.riverGenerationMs.toFixed(1),rivers:w.rivers.length,lakes:w.lakes.length,lakeCells:w.lakes.map(l=>l.cells.length),waterCells:wet.size}));
  if(seed===1){const again=generateWorld(seed,2,size);assert.equal(hash(w),hash(again),'seed changed voxel output');}
}
