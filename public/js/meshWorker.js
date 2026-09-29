// Module workers use the existing vendor route instead of a document import map.
import * as THREE from '/vendor/three/three.module.js';
import { World } from '/shared/world.js';
import { createChunkMesher } from './render/chunkMesher.js';

const meshChunk=createChunkMesher(THREE);
self.onmessage=({data})=>{
  try {
    const started=performance.now(),world=World.fromData(data.world);
    const chunk=world.chunks.get(data.key),geometries=meshChunk(world,chunk);
    const buffers=[];
    for(const [name,geometry] of Object.entries(geometries)) {
      if(!geometry)continue;
      const attributes={};
      for(const [key,attribute] of Object.entries(geometry.attributes)) {
        attributes[key]={array:attribute.array,itemSize:attribute.itemSize};
        buffers.push(attribute.array.buffer);
      }
      buffers.push(geometry.index.array.buffer);
      geometries[name]={attributes,index:geometry.index.array,
        center:geometry.boundingSphere.center.toArray(),radius:geometry.boundingSphere.radius};
    }
    self.postMessage({key:data.key,geometries,ms:performance.now()-started},buffers);
  } catch(error) {self.postMessage({error:error.message});}
};
