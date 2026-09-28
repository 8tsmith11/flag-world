import { World, Chunk, chunkKey } from '/shared/world.js';
import { VoxelLighting } from '/shared/lighting.js';
let lighting;
function send(type, buffers, extra = {}) {
  const copies=buffers.map(({cx,cy,cz,light,sky,void:voidLight})=>({cx,cy,cz,light:light.slice(),sky:sky.slice(),void:voidLight.slice()}));
  self.postMessage({type,buffers:copies,...extra},copies.flatMap(b=>[b.light.buffer,b.sky.buffer,b.void.buffer]));
}
self.onmessage=({data})=>{
  try {
    if(data.type==='init') {
      const world=Object.assign(Object.create(World.prototype),data.world);
      for(const chunk of world.chunks.values())Object.setPrototypeOf(chunk,Chunk.prototype);
      lighting=new VoxelLighting(world);
    } else if(data.type==='load') {
      const buffers=[];
      for(const [cx,cy,cz] of data.chunks)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
        const k=chunkKey(cx+dx,cy+dy,cz+dz);
        if(lighting.buffers.has(k))continue;
        buffers.push(lighting.load(cx+dx,cy+dy,cz+dz));
      }
      send('load',buffers,{chunks:data.chunks});
    } else if(data.type==='edit') {
      const buffers=lighting.edit(data.x,data.y,data.z,data.id,data.oldId);
      send('edit',buffers,{dirty:[...lighting.lastDirty]});
    }
  } catch(error) { self.postMessage({type:'error',message:error.message}); }
};
