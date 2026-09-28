// Solid rooted columns and connected arch strips, central highlands only.
import { SPIRE_SETTINGS as C, KEEP_SIZE, KEEP_MARGIN } from './config.js';
import { BLOCK, isSolid } from './blocks.js';
import { mulberry32 } from './structures.js';
import { structureAllowed } from './structures/place.js';
const integer=(r,[lo,hi])=>lo+Math.floor(r()*(hi-lo+1));
export function generateStoneSpires(world,terrain) {
  const started=performance.now(),random=mulberry32(world.seed^C.seedSalt),spires=[];
  world.stoneFeatures=[];
  const allowed=(x,z,r)=>{
    if(!structureAllowed(world,{x0:x-r,x1:x+r,z0:z-r,z1:z+r},C.clearance))return false;
    const keepReach=Math.floor(KEEP_SIZE/2)+KEEP_MARGIN+C.clearance;
    if(world.keeps.some(k=>Math.abs(x-k.cx)<=keepReach+r&&Math.abs(z-k.cz)<=keepReach+r))return false;
    for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++) {
      const bx=x+dx,bz=z+dz,y=terrain.getTop(bx,bz);
      if(y===-32768||world.biomeAt(bx,bz)!=='stoneSpires'||world.terrainExclusions?.has(`${bx},${bz}`)
        ||world.riverColumns?.has(`${bx},${bz}`)||world.plantClearance?.has(bx+world.sizeX*bz)||!isSolid(world.getBlock(bx,y,bz)))return false;
      if(world.structures.some(s=>s.kind!=='stoneSpire'&&s.kind!=='stoneArch'&&s.kind!=='stoneBoulder'&&s.box&&s.box.y1>=y
        &&bx>=s.box.x0-C.clearance&&bx<=s.box.x1+C.clearance&&bz>=s.box.z0-C.clearance&&bz<=s.box.z1+C.clearance))return false;
    }
    return true;
  };
  const feature=(kind,blocks,anchors)=>{
    if(!blocks.length)return;
    const box={x0:Infinity,y0:Infinity,z0:Infinity,x1:-Infinity,y1:-Infinity,z1:-Infinity};
    for(const b of blocks) {
      world.setBlock(b.x,b.y,b.z,b.id);
      for(const a of ['x','y','z']){box[a+'0']=Math.min(box[a+'0'],b[a]);box[a+'1']=Math.max(box[a+'1'],b[a]);}
      const i=b.x-terrain.x0+terrain.width*(b.z-terrain.z0);
      terrain.top[i]=Math.max(terrain.top[i],b.y);
    }
    world.stoneFeatures.push({kind,box,anchors,blocks});
    world.structures.push({kind,box});
  };
  // Restore grassy field tops where the mountain surface pass exposed rock.
  // Construction and protected river/gorge columns retain their materials.
  for(let z=terrain.z0;z<terrain.z0+terrain.width;z++)for(let x=terrain.x0;x<terrain.x0+terrain.width;x++) {
    if(world.biomeAt(x,z)!=='stoneSpires')continue;
    const y=terrain.getTop(x,z);
    if(world.getBlock(x,y,z)===BLOCK.STONE&&allowed(x,z,0))world.setBlock(x,y,z,BLOCK.GRASS);
  }
  for(let z=terrain.z0;z<terrain.z0+terrain.width;z+=C.cell)for(let x=terrain.x0;x<terrain.x0+terrain.width;x+=C.cell) {
    const bx=x+Math.floor(random()*C.cell),bz=z+Math.floor(random()*C.cell);
    const radius=integer(random,C.radius),height=integer(random,C.height),roll=random();
    if(roll>C.chance||!allowed(bx,bz,radius))continue;
    const base=terrain.getTop(bx,bz),top=Math.min(world.sizeY-2,base+height),blocks=[],anchors=[];
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      if(dx*dx+dz*dz>radius*radius)continue;
      const ground=terrain.getTop(bx+dx,bz+dz);
      // Every side column is rooted independently. Narrower tips stay atop
      // the broad base, rather than detaching over eroded overhangs.
      const end=top-Math.floor((Math.abs(dx)+Math.abs(dz))*height*C.taper/(radius+1));
      if(end<=ground)continue;
      anchors.push({x:bx+dx,y:ground,z:bz+dz});
      for(let y=ground+1;y<=end;y++)blocks.push({x:bx+dx,y,z:bz+dz,id:y===end?BLOCK.GRASS:BLOCK.STONE});
    }
    feature('stoneSpire',blocks,anchors);spires.push({x:bx,z:bz,top,radius});
  }
  const joined=new Set();
  for(let i=0;i<spires.length;i++) {
    const p=spires[i];if(joined.has(i)||random()>C.archChance)continue;
    let best=-1,distance=C.archDistance[1];
    for(let j=i+1;j<spires.length;j++) {
      const q=spires[j],d=Math.hypot(p.x-q.x,p.z-q.z);
      if(!joined.has(j)&&d>=C.archDistance[0]&&d<distance){best=j;distance=d;}
    }
    if(best<0)continue;
    const q=spires[best],path=[],length=Math.abs(p.x-q.x)+Math.abs(p.z-q.z);
    let x=p.x,z=p.z;
    path.push({x,z});
    while(x!==q.x||z!==q.z) {
      // Interleave X/Z steps to avoid right-angle bridges.
      if(x!==q.x){x+=Math.sign(q.x-x);path.push({x,z});}
      if(z!==q.z){z+=Math.sign(q.z-z);path.push({x,z});}
    }
    if(path.some(v=>!allowed(v.x,v.z,0)))continue;
    const base=Math.min(p.top,q.top)-C.archRise,blocks=[];
    let previous=base;
    for(let k=0;k<path.length;k++) {
      const t=k/length,y=Math.round(base+Math.sin(t*Math.PI)*C.archRise),v=path[k];
      for(let yy=Math.min(y,previous);yy<Math.max(y,previous)+C.archThickness;yy++)blocks.push({x:v.x,y:yy,z:v.z,id:BLOCK.STONE});
      previous=y;
    }
    if(blocks.some(b=>b.y<=terrain.getTop(b.x,b.z)&&b.x!==p.x&&b.z!==p.z&&b.x!==q.x&&b.z!==q.z))continue;
    feature('stoneArch',blocks,[{x:p.x,y:base,z:p.z},{x:q.x,y:base,z:q.z}]);joined.add(i);joined.add(best);
  }
  // Low rounded boulders leave most inter-spire ground grassy.
  for(let z=terrain.z0;z<terrain.z0+terrain.width;z+=C.cell)for(let x=terrain.x0;x<terrain.x0+terrain.width;x+=C.cell) {
    if(random()>C.boulderChance)continue;
    const radius=integer(random,C.boulderRadius);if(!allowed(x,z,radius))continue;
    if(spires.some(p=>Math.hypot(p.x-x,p.z-z)<=p.radius+radius+C.clearance))continue;
    const blocks=[],anchors=[];
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++) {
      if(dx*dx+dz*dz>radius*radius)continue;
      const ground=terrain.getTop(x+dx,z+dz);anchors.push({x:x+dx,y:ground,z:z+dz});
      const h=Math.max(1,Math.round(Math.sqrt(radius*radius-dx*dx-dz*dz)));
      for(let y=ground+1;y<=ground+h;y++)blocks.push({x:x+dx,y,z:z+dz,id:BLOCK.STONE});
    }
    feature('stoneBoulder',blocks,anchors);
  }
  world.stoneGenerationMs=performance.now()-started;
  return spires;
}
