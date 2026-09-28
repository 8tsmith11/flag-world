// Review harness uses the actual renderer and worker; no network match needed.
import { LOOK_CAPTURE as C, LIGHTING } from '/shared/config.js';
import { BLOCK, isSolid, isWater } from '/shared/blocks.js';
import { generateClientWorld } from './worldGeneration.js';
import { createScene, setViewDistance } from './render/scene.js';
import { playerFitsAt } from '/shared/physics.js';
import { Sky } from './render/sky.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
const params=new URLSearchParams(location.search);
const {renderer,scene,camera,ambient,sun}=createScene(C.viewDistance);
renderer.setPixelRatio(1);
const world=await generateClientWorld({seed:Number(params.get('seed')??C.seed),teamCount:C.teamCount,worldSize:params.get('size')??C.worldSize},()=>{},new AbortController().signal);
const chunks=new ChunkRenderer(scene,world,C.viewDistance,renderer),sky=new Sky(scene,{ambient,sun});
const center=world.islands.find(i=>i.kind==='center');
const terrain=world.centralTerrain;
let forest={x:center.x,y:center.surfaceY,z:center.z}, best=-1;
for(let z=terrain.z0;z<terrain.z0+terrain.width;z+=C.forestStride)for(let x=terrain.x0;x<terrain.x0+terrain.width;x+=C.forestStride){
 const y=terrain.top[x-terrain.x0+terrain.width*(z-terrain.z0)];if(y===-32768||world.biomeAt(x,z)!=='forest')continue;
 let count=0;for(let dz=-C.forestRadius;dz<=C.forestRadius;dz+=C.forestStride)for(let dx=-C.forestRadius;dx<=C.forestRadius;dx+=C.forestStride)for(let dy=1;dy<=C.canopyHeight;dy++)if(world.getBlock(x+dx,y+dy,z+dz)===8)count++;
 if(count>best){best=count;forest={x,y,z};}
}
let ancient=null,ancientScore=-1;
for(const tree of world.trees??[]) {
 if(tree.species!=='ancient'||tree.width<2||world.biomeAt(tree.x,tree.z)!=='ancientForest')continue;
 if(tree.x<terrain.x0||tree.x>=terrain.x0+terrain.width||tree.z<terrain.z0||tree.z>=terrain.z0+terrain.width)continue;
 let count=0;
 for(let dz=-C.forestRadius;dz<=C.forestRadius;dz+=C.forestStride)for(let dx=-C.forestRadius;dx<=C.forestRadius;dx+=C.forestStride)for(let dy=1;dy<=C.ancientCanopyHeight;dy++)if(world.getBlock(tree.x+dx,tree.ground+dy,tree.z+dz)===BLOCK.LEAVES)count++;
 if(count>ancientScore){ancientScore=count;ancient={x:tree.x,y:tree.ground,z:tree.z};}
}
window.look={world,chunks,renderer,scene,camera,sky,forest,ancient,forestScore:best,ancientScore};
function forestEye(point) {
 let fallback=null;
 const offsets=[0];
 for(let d=C.forestStride;d<=C.forestRadius;d+=C.forestStride)offsets.push(-d,d);
 for(const dx of offsets)for(const dz of offsets) {
  const x=point.x+C.forestOffset+dx+0.5,z=point.z+C.forestOffset+dz+0.5;
  const bx=Math.floor(x),bz=Math.floor(z);
  const y=world.getSurfaceY(bx,bz,id=>isSolid(id)&&id!==BLOCK.WOOD&&id!==BLOCK.LEAVES&&id!==BLOCK.BRANCH);
  if(!isSolid(world.getBlock(bx,y,bz)))continue;
  const feet=world.getBlock(Math.floor(x),y+1,Math.floor(z));
  if(isWater(feet)||isSolid(feet)||isSolid(world.getBlock(Math.floor(x),Math.floor(y+C.eyeHeight),Math.floor(z))))continue;
  if(!playerFitsAt(world,{x,y:y+1,z},y+1))continue;
  const eye={x,y:y+C.eyeHeight,z};fallback??=eye;
  if(world.getSurfaceY(bx,bz,id=>isSolid(id)&&id!==BLOCK.BRANCH)>eye.y)return eye;
 }
 if(fallback)return fallback;
 throw Error('No standing space in forest review');
}
window.look.setView=async(view,time=C.dayTime)=>{
 const start=chunks.buildCount,distance=view==='above'?C.overviewDistance:C.viewDistance;
 if(chunks.viewDistance!==distance){chunks.setViewDistance(distance);setViewDistance(scene,camera,distance);}
 if(view==='forest'||view==='ancient'){const point=view==='ancient'?ancient:forest;if(!point)throw Error('No ancient forest in review world');const eye=forestEye(point);camera.position.set(eye.x,eye.y,eye.z);camera.lookAt(point.x,point.y+C.eyeHeight,point.z);}
 else if(view==='above'){camera.position.set(center.x,center.surfaceY+center.radius*C.aboveHeight,center.z+center.radius*C.aboveOffset);camera.lookAt(center.x,center.surfaceY,center.z);}
 else {camera.position.set(center.x+center.radius*C.sideDistance,center.surfaceY+(view==='below'? -C.belowDepth:C.sideHeight),center.z);camera.lookAt(center.x,center.surfaceY-C.targetDepth,center.z);}
 sky.update(time,camera);chunks.daylight.value=LIGHTING.nightSky+(LIGHTING.daySky-LIGHTING.nightSky)*sky.daylight;chunks.daylight.tint.value.copy(sky.light.color);
 const started=performance.now();
 while(true){chunks.update(camera.position.x,camera.position.z);if(chunks.lighting.error)throw chunks.lighting.error;
 if(chunks.queue.length&&chunks.buildCursor>=chunks.queue.length&&!chunks.dirty.size&&!chunks.lighting.edits)break;
 if(performance.now()-started>C.timeoutMs)throw Error('review load timeout');await new Promise(requestAnimationFrame);}
 renderer.render(scene,camera);return {builds:chunks.buildCount-start,chunks:chunks.loadedCount};
};
await chunks.plantReady;await window.look.setView('side');window.lookReady=true;
