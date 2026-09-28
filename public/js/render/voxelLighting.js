import { chunkKey } from '/shared/world.js';
import { getBlockDef } from '/shared/blocks.js';
import { CHUNK_SIZE, LIGHTING as C } from '/shared/config.js';

// One worker mirrors blocks; only light buffers for chunks near the camera
// return to the main thread. FIFO edits cannot overwrite newer illumination.
export class LightingClient {
  constructor(world, dirty) {
    this.world=world; this.dirty=dirty; this.ready=new Set();this.pending=new Set();this.edits=0;
    world.lightChunks=new Map();
    this.samples=new Map();
    world.requestLight=(x,y,z)=>this.requestCell(x,y,z);
    this.worker=new Worker(new URL('../lightingWorker.js',import.meta.url),{type:'module'});
    this.worker.postMessage({type:'init',world:{sizeX:world.sizeX,sizeY:world.sizeY,sizeZ:world.sizeZ,minY:world.minY,
      chunks:world.chunks}});
    this.worker.onmessage=({data})=>{
      if(data.type==='error') {this.error=new Error(data.message);console.error('Lighting worker:',this.error);return;}
      for(const b of data.buffers) {
        const key=chunkKey(b.cx,b.cy,b.cz); world.lightChunks.set(key,b);
        const chunk=world.chunks.get(key);if(chunk) {chunk.light=b.light;chunk.skylight=b.sky;chunk.voidlight=b.void;}
      }
      if(data.type==='load')for(const [cx,cy,cz]of data.chunks){const k=chunkKey(cx,cy,cz);this.ready.add(k);this.pending.delete(k);}
      if(data.type==='edit'){this.edits--;for(const key of data.dirty)this.dirty.add(key);}
      this.request();
    };
    this.worker.onerror=event=>{this.error=new Error(event.message);console.error(this.error);};
  }
  setQueue(chunks) {this.queue=chunks;this.cursor=0;this.request();}
  requestCell(x,y,z) {
    const cx=Math.floor(x/CHUNK_SIZE),cy=Math.floor(y/CHUNK_SIZE),cz=Math.floor(z/CHUNK_SIZE);
    const key=chunkKey(cx,cy,cz);
    if(this.ready.has(key)||this.pending.has(key))return;
    this.samples.set(key,[cx,cy,cz]);this.request();
  }
  request() {
    if(this.error||this.pending.size>=C.workerBatch)return;
    const batch=[];
    for(const [key,chunk] of this.samples) {
      this.samples.delete(key);
      if(this.ready.has(key)||this.pending.has(key))continue;
      this.pending.add(key);batch.push(chunk);
      if(batch.length>=C.workerBatch)break;
    }
    while(batch.length<C.workerBatch&&this.cursor<(this.queue?.length??0)) {
      const chunk=this.queue[this.cursor++],k=chunkKey(chunk.cx,chunk.cy,chunk.cz);
      if(this.ready.has(k)||this.pending.has(k))continue;
      this.pending.add(k);batch.push([chunk.cx,chunk.cy,chunk.cz]);if(batch.length>=C.workerBatch)break;
    }
    if(batch.length)this.worker.postMessage({type:'load',chunks:batch});
  }
  edit(x,y,z,id,oldId){
    const a=getBlockDef(id),b=getBlockDef(oldId);
    if(a.emission===b.emission&&a.lightOpaque===b.lightOpaque&&a.solid===b.solid)return;
    this.edits++;this.worker.postMessage({type:'edit',x,y,z,id,oldId});}
  dispose(){this.worker.terminate();}
}

// Basic materials use baked illumination rather than global Three lights.
// Day/night scales only the skylight attribute, never block light or geometry.
export function litMaterial(material, daylight) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.voxelDaylight=daylight;
    shader.uniforms.voxelSkyTint=daylight.tint;
    shader.uniforms.voxelVoidStrength={get value(){return C.voidNight+(C.voidDay-C.voidNight)
      *Math.min(1,Math.max(0,(daylight.value-C.nightSky)/(C.daySky-C.nightSky)));}};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec3 voxelLight; varying vec3 vVoxelLight;')
      .replace('#include <color_vertex>','#include <color_vertex>\nvVoxelLight = voxelLight;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float voxelDaylight; uniform vec3 voxelSkyTint; uniform float voxelVoidStrength; varying vec3 vVoxelLight;')
      .replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
        diffuseColor.rgb *= vec3(${C.ambientFloor}) + vVoxelLight.x * vec3(${C.blockTint.join(',')}) * ${C.blockStrength}
          + voxelSkyTint * vVoxelLight.y * voxelDaylight
          + vec3(${C.voidTint.join(',')}) * vVoxelLight.z * (1.0 - vVoxelLight.y) * voxelVoidStrength;`);
  };
  material.customProgramCacheKey=()=> 'voxel-light-v4';return material;
}
