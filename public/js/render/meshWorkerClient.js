import * as THREE from 'three';
import { chunkKey } from '/shared/world.js';
import { LIGHTING as C } from '/shared/config.js';

// Only a chunk's 3x3x3 neighbourhood is copied. The bounded queue keeps memory
// and main-thread copying independent of the total size of the world.
export class MeshWorkerClient {
  constructor(world) {
    this.world=world;this.pending=new Map();
    this.worker=new Worker(new URL('../meshWorker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(data.error){this.error=new Error(data.error);console.error('Mesh worker:',this.error);return;}
      const job=this.pending.get(data.key);
      if(job)job.result=data;
    };
    this.worker.onerror=event=>{this.error=new Error(event.message);console.error('Mesh worker:',this.error);};
  }
  request(key,chunk) {
    if(this.pending.has(key)||this.pending.size>=C.meshWorkerBatch)return false;
    const world=this.world,chunks=new Map(),lightChunks=new Map();
    for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
      const k=chunkKey(chunk.cx+dx,chunk.cy+dy,chunk.cz+dz),neighbour=world.chunks.get(k);
      if(neighbour)chunks.set(k,{cx:neighbour.cx,cy:neighbour.cy,cz:neighbour.cz,blocks:neighbour.blocks});
      const light=world.lightChunks?.get(k);if(light)lightChunks.set(k,light);
    }
    this.pending.set(key,{chunk,stale:false,result:null});
    this.worker.postMessage({key,world:{sizeX:world.sizeX,sizeY:world.sizeY,sizeZ:world.sizeZ,minY:world.minY,chunks,lightChunks}});
    return true;
  }
  invalidate(key) {const job=this.pending.get(key);if(job)job.stale=true;}
  dispose() {this.worker.terminate();this.pending.clear();}
}

// All expensive geometry construction and bounds calculations happened in the
// worker. These transferred arrays can be installed without copying them again.
export function restoreGeometries(data) {
  const result={};
  for(const [name,buffer] of Object.entries(data)) {
    if(!buffer){result[name]=null;continue;}
    const geometry=new THREE.BufferGeometry();
    for(const [key,attribute] of Object.entries(buffer.attributes))
      geometry.setAttribute(key,new THREE.BufferAttribute(attribute.array,attribute.itemSize));
    geometry.setIndex(new THREE.BufferAttribute(buffer.index,1));
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(buffer.center),buffer.radius);
    result[name]=geometry;
  }
  return result;
}
