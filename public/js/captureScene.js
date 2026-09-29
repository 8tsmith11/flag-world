// Reproducible real-renderer capture page; no socket or live match is needed.
import { LOBBY_CAPTURE as C, LIGHTING } from '/shared/config.js';
import { generateClientWorld } from './worldGeneration.js';
import { createScene } from './render/scene.js';
import { Sky } from './render/sky.js';
import { Clouds } from './render/clouds.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
const {renderer,scene,camera,ambient,sun}=createScene(C.viewDistance);
renderer.setPixelRatio(1);camera.fov=C.fov;camera.updateProjectionMatrix();
const world=await generateClientWorld(C,()=>{},new AbortController().signal);
const center=world.islands.find(i=>i.kind==='center'),end=world.rivers[0]?.end??{x:center.x+center.radius,y:center.surfaceY,z:center.z};
camera.position.set(end.x+(end.x-center.x)*C.cameraOutward,end.y+C.cameraHeight,end.z+(end.z-center.z)*C.cameraOutward);
camera.lookAt(center.x,center.surfaceY+C.targetHeight,center.z);
const sky=new Sky(scene,{ambient,sun}),clouds=new Clouds(scene,world),chunks=new ChunkRenderer(scene,world,C.viewDistance,renderer);
function frame() {
  chunks.update(camera.position.x,camera.position.z,camera);sky.update(C.dayTime,camera);
  chunks.daylight.value=LIGHTING.nightSky+(LIGHTING.daySky-LIGHTING.nightSky)*sky.daylight;chunks.daylight.tint.value.copy(sky.light.color);clouds.setTint(sky.tint);
  if(chunks.error){window.captureError=chunks.error.message;return;}
  if(chunks.queue.length&&chunks.queue.every(({chunk})=>chunks.meshes.has(chunk.cx+4096*(chunk.cz+4096*chunk.cy)))) {
    renderer.render(scene,camera);
    window.captureReady=true;window.captureInfo={seed:C.seed,worldSize:C.worldSize,riverMs:world.riverGenerationMs,camera:camera.position.toArray()};
  }else requestAnimationFrame(frame);
}
frame();
