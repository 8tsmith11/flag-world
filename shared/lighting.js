// Exact bounded flood fills, used by the lighting worker and focused checks.
// Only chunks requested for rendering own light buffers. No server tick work.
import { CHUNK_SIZE, LIGHTING as C } from './config.js';
import { getBlockDef } from './blocks.js';
import { Chunk, chunkKey } from './world.js';
export const LIGHT_DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const mod = n => (n % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;

export class VoxelLighting {
  constructor(world) {
    this.world = world;
    this.buffers = new Map();
    this.rays = [new Map(), new Map(), new Map()];
    this.emitters = new Map();
    for (const [key, chunk] of world.chunks) {
      const sources = new Map();
      for (let i = 0; i < chunk.blocks.length; i++) {
        const level = Math.min(C.maxLevel, getBlockDef(chunk.blocks[i]).emission);
        if (!level) continue;
        const x = chunk.cx * CHUNK_SIZE + i % CHUNK_SIZE;
        const y = chunk.cy * CHUNK_SIZE + Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
        const z = chunk.cz * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
        sources.set(this.key(x,y,z), {x,y,z,level});
      }
      if (sources.size) this.emitters.set(key, sources);
    }
  }
  key(x,y,z) { return x + this.world.sizeX * (z + this.world.sizeZ * (y - this.world.minY)); }
  buffer(x,y,z) { return this.buffers.get(chunkKey(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE))); }
  light(x,y,z) { return this.buffer(x,y,z)?.light[Chunk.index(mod(x),mod(y),mod(z))] ?? 0; }
  // Cache first/last opaque cell on axis-aligned rays to the real boundaries.
  // Empty chunk segments are skipped. Transparent decorations never cast cover.
  rayBounds(axis, x, y, z) {
    const w=this.world, key=axis===1 ? x+w.sizeX*z : axis===0 ? z+w.sizeZ*(y-w.minY) : x+w.sizeX*(y-w.minY);
    const cache=this.rays[axis];if(cache.has(key))return cache.get(key);
    const lo=axis===1?w.minY:0,hi=[w.sizeX,w.sizeY,w.sizeZ][axis];
    let first=Infinity,last=-Infinity;
    const p=[x,y,z];
    for(let c=Math.floor(lo/CHUNK_SIZE);c<=Math.floor((hi-1)/CHUNK_SIZE);c++) {
      p[axis]=c*CHUNK_SIZE;
      if(!w.chunks.has(chunkKey(Math.floor(p[0]/CHUNK_SIZE),Math.floor(p[1]/CHUNK_SIZE),Math.floor(p[2]/CHUNK_SIZE))))continue;
      for(let v=Math.max(lo,c*CHUNK_SIZE);v<Math.min(hi,(c+1)*CHUNK_SIZE);v++) {
        p[axis]=v;if(!getBlockDef(w.getBlock(...p)).lightOpaque)continue;
        first=Math.min(first,v);last=v;
      }
    }
    const bounds=[first,last];cache.set(key,bounds);return bounds;
  }
  rayKey(axis,x,y,z) { const w=this.world;return axis===1?x+w.sizeX*z:axis===0?z+w.sizeZ*(y-w.minY):x+w.sizeX*(y-w.minY); }
  // Flood sources that can possibly influence a caller's region. Attenuation
  // caps each BFS, even in empty sky; walls are checked at every edge.
  flood(box) {
    const values=new Map(), queue=[], w=this.world, r=C.maxLevel;
    for (let cy=Math.floor((box.y0-r)/CHUNK_SIZE);cy<=Math.floor((box.y1+r)/CHUNK_SIZE);cy++)
      for (let cz=Math.floor((box.z0-r)/CHUNK_SIZE);cz<=Math.floor((box.z1+r)/CHUNK_SIZE);cz++)
        for (let cx=Math.floor((box.x0-r)/CHUNK_SIZE);cx<=Math.floor((box.x1+r)/CHUNK_SIZE);cx++) {
          for (const s of this.emitters.get(chunkKey(cx,cy,cz))?.values() ?? []) {
            const distance=Math.max(box.x0-s.x,0,s.x-box.x1)+Math.max(box.y0-s.y,0,s.y-box.y1)+Math.max(box.z0-s.z,0,s.z-box.z1);
            if (distance >= s.level) continue;
            const k=this.key(s.x,s.y,s.z); values.set(k,s.level); queue.push(s);
          }
        }
    for (let i=0;i<queue.length;i++) {
      const p=queue[i]; if (p.level<=1 || values.get(this.key(p.x,p.y,p.z))!==p.level) continue;
      for (const [dx,dy,dz] of LIGHT_DIRS) {
        const x=p.x+dx,y=p.y+dy,z=p.z+dz, level=p.level-1;
        if (!w.inBounds(x,y,z) || getBlockDef(w.getBlock(x,y,z)).lightOpaque) continue;
        const k=this.key(x,y,z); if ((values.get(k)??0)>=level) continue;
        values.set(k,level); queue.push({x,y,z,level});
      }
    }
    return values;
  }
  openAirFlood(box) {
    const w=this.world,r=Math.ceil(C.maxLevel/C.openAirLoss)-1,loss=C.openAirLoss;
    const x0=Math.max(0,box.x0-r),z0=Math.max(0,box.z0-r),y0=Math.max(w.minY,box.y0-r);
    const x1=Math.min(w.sizeX-1,box.x1+r),z1=Math.min(w.sizeZ-1,box.z1+r),y1=Math.min(w.sizeY-1,box.y1+r);
    const sx=x1-x0+1,sz=z1-z0+1,sy=y1-y0+1;
    const index=(x,y,z)=>x-x0+sx*(z-z0+sz*(y-y0));
    const length=sx>0&&sz>0&&sy>0?sx*sz*sy:0,sky=new Uint8Array(length),voidLight=new Uint8Array(length),opaque=new Uint8Array(length);
    const floods=[sky,voidLight], buckets=floods.map(()=>Array.from({length:C.maxLevel+1},()=>[]));
    if(sx>0&&sz>0&&sy>0) {
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++) {
        const vertical=this.rayBounds(1,x,y0,z);
        for(let y=y0;y<=y1;y++) {
          const i=index(x,y,z);opaque[i]=getBlockDef(w.getBlock(x,y,z)).lightOpaque?1:0;if(opaque[i])continue;
          if(y>vertical[1])sky[i]=C.maxLevel;
          const a=this.rayBounds(0,x,y,z),b=this.rayBounds(2,x,y,z);
          const sideOpen=x<a[0]||x>a[1]||z<b[0]||z>b[1];
          // Roof-and-floor-enclosed air is a cavity, rather than exterior
          // void. An open horizontal axis still admits glow between stacked
          // islands. Slits receive a short flood from the exterior, so long
          // straight fortress galleries do not become direct light sources.
          const exterior=y>vertical[1]||!Number.isFinite(a[0])||!Number.isFinite(b[0]);
          if(y<vertical[0]||sideOpen&&exterior)voidLight[i]=C.voidLevel;
        }
      }
      // Sources only need a queue entry where they border darker air.
      for(let f=0;f<floods.length;f++) {
        const values=floods[f],bucket=buckets[f];
        for(let i=0;i<length;i++) {
          const v=values[i];if(v<=loss)continue;
          const x=i%sx,y=Math.floor(i/(sx*sz)),z=Math.floor(i/sx)%sz;
          if(LIGHT_DIRS.some(([dx,dy,dz])=>x+dx>=0&&x+dx<sx&&y+dy>=0&&y+dy<sy&&z+dz>=0&&z+dz<sz
            &&!opaque[i+dx+sx*(dz+sz*dy)]&&values[i+dx+sx*(dz+sz*dy)]<v-loss))bucket[v].push(i);
        }
        for(let v=C.maxLevel;v>loss;v--)for(const i of bucket[v]) {
          if(values[i]!==v)continue;
          const x=i%sx,y=Math.floor(i/(sx*sz)),z=Math.floor(i/sx)%sz;
          for(const [dx,dy,dz] of LIGHT_DIRS) {
            if(x+dx<0||x+dx>=sx||y+dy<0||y+dy>=sy||z+dz<0||z+dz>=sz)continue;
            const n=i+dx+sx*(dz+sz*dy),next=v-loss;
            if(opaque[n]||values[n]>=next)continue;
            values[n]=next;if(next>loss)bucket[next].push(n);
          }
        }
      }
    }
    return (x,y,z)=>!w.inBounds(x,y,z) ? [y>=w.sizeY||x<0||x>=w.sizeX||z<0||z>=w.sizeZ?255:0,Math.round(255*C.voidLevel/C.maxLevel)]
      : [Math.round(255*(sky[index(x,y,z)]??0)/C.maxLevel),Math.round(255*(voidLight[index(x,y,z)]??0)/C.maxLevel)];
  }
  load(cx,cy,cz) {
    const key=chunkKey(cx,cy,cz); if (this.buffers.has(key)) return this.buffers.get(key);
    const data={cx,cy,cz,light:new Uint8Array(CHUNK_SIZE**3),sky:new Uint8Array(CHUNK_SIZE**3),void:new Uint8Array(CHUNK_SIZE**3)};
    this.buffers.set(key,data);
    const x0=cx*CHUNK_SIZE,y0=cy*CHUNK_SIZE,z0=cz*CHUNK_SIZE;
    const flood=this.flood({x0,y0,z0,x1:x0+CHUNK_SIZE-1,y1:y0+CHUNK_SIZE-1,z1:z0+CHUNK_SIZE-1});
    const air=this.openAirFlood({x0,y0,z0,x1:x0+CHUNK_SIZE-1,y1:y0+CHUNK_SIZE-1,z1:z0+CHUNK_SIZE-1});
    for(let z=0;z<CHUNK_SIZE;z++)for(let x=0;x<CHUNK_SIZE;x++) {
      for(let y=0;y<CHUNK_SIZE;y++) {
        const i=Chunk.index(x,y,z); data.light[i]=this.world.inBounds(x0+x,y0+y,z0+z)
          ? flood.get(this.key(x0+x,y0+y,z0+z))??0 : 0;
        [data.sky[i],data.void[i]]=air(x0+x,y0+y,z0+z);
      }
    }
    return data;
  }
  markCell(x,y,z) {
    const xs=[Math.floor(x/CHUNK_SIZE)],ys=[Math.floor(y/CHUNK_SIZE)],zs=[Math.floor(z/CHUNK_SIZE)];
    for(const [v,list] of [[x,xs],[y,ys],[z,zs]]) {
      if(mod(v)===0)list.push(list[0]-1);
      if(mod(v)===CHUNK_SIZE-1)list.push(list[0]+1);
    }
    for(const cx of xs)for(const cy of ys)for(const cz of zs)this.lastDirty.add(chunkKey(cx,cy,cz));
  }
  edit(x,y,z,id,oldId) {
    this.lastDirty=new Set();
    const w=this.world, changed=new Set(), newDef=getBlockDef(id), oldDef=getBlockDef(oldId);
    const before=newDef.lightOpaque!==oldDef.lightOpaque?[0,1,2].map(axis=>this.rayBounds(axis,x,y,z)):null;
    w.setBlock(x,y,z,id);
    if (newDef.emission!==oldDef.emission) {
      const ck=chunkKey(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE));
      let sources=this.emitters.get(ck); if (!sources) this.emitters.set(ck,sources=new Map());
      sources.delete(this.key(x,y,z));
      if(newDef.emission) sources.set(this.key(x,y,z),{x,y,z,level:Math.min(C.maxLevel,newDef.emission)});
    }
    if (newDef.emission!==oldDef.emission || newDef.lightOpaque!==oldDef.lightOpaque) {
      const r=C.maxLevel, box={x0:x-r,y0:y-r,z0:z-r,x1:x+r,y1:y+r,z1:z+r};
      const pending=[];
      // Remove old illumination only inside the edit's Manhattan radius.
      for(let dz=-r;dz<=r;dz++)for(let dy=-r;dy<=r;dy++) {
        const reach=r-Math.abs(dy)-Math.abs(dz); if(reach<0)continue;
        for(let dx=-reach;dx<=reach;dx++) {
          const bx=x+dx,by=y+dy,bz=z+dz, buffer=this.buffer(bx,by,bz); if(!buffer)continue;
          const i=Chunk.index(mod(bx),mod(by),mod(bz)), old=buffer.light[i];
          pending.push({bx,by,bz,buffer,i,old}); buffer.light[i]=0;
        }
      }
      // Re-add from all surrounding emitters whose bounded flood reaches it.
      const flood=this.flood(box);
      for(const p of pending) {
        const level=flood.get(this.key(p.bx,p.by,p.bz))??0; p.buffer.light[p.i]=level;
        if(level!==p.old){changed.add(chunkKey(p.buffer.cx,p.buffer.cy,p.buffer.cz));this.markCell(p.bx,p.by,p.bz);}
      }
    }
    if(before) {
      const r=Math.ceil(C.maxLevel/C.openAirLoss)-1,p=[x,y,z];
      const boxes=[{lo:p.map(v=>v-r),hi:p.map(v=>v+r)}];
      // A changed boundary ray can create/remove direct sources arbitrarily
      // far away. Reflood only loaded chunks intersecting those changed beams.
      for(let axis=0;axis<3;axis++) {
        this.rays[axis].delete(this.rayKey(axis,x,y,z));
        const after=this.rayBounds(axis,x,y,z);
        for(let end=0;end<2;end++)if(before[axis][end]!==after[end]) {
          const lo=p.map(v=>v-r),hi=p.map(v=>v+r);
          lo[axis]=Math.min(before[axis][end],after[end])-r;hi[axis]=Math.max(before[axis][end],after[end])+r;
          boxes.push({lo,hi});
        }
      }
      for(const [key,buffer] of this.buffers) {
        const origin=[buffer.cx,buffer.cy,buffer.cz].map(v=>v*CHUNK_SIZE);
        if(!boxes.some(b=>origin.every((v,i)=>v<=b.hi[i]&&v+CHUNK_SIZE-1>=b.lo[i])))continue;
        const [x0,y0,z0]=origin,air=this.openAirFlood({x0,y0,z0,x1:x0+CHUNK_SIZE-1,y1:y0+CHUNK_SIZE-1,z1:z0+CHUNK_SIZE-1});
        for(let bz=0;bz<CHUNK_SIZE;bz++)for(let by=0;by<CHUNK_SIZE;by++)for(let bx=0;bx<CHUNK_SIZE;bx++) {
          const i=Chunk.index(bx,by,bz),[sky,voidLight]=air(x0+bx,y0+by,z0+bz);
          if(buffer.sky[i]===sky&&buffer.void[i]===voidLight)continue;
          buffer.sky[i]=sky;buffer.void[i]=voidLight;changed.add(key);this.markCell(x0+bx,y0+by,z0+bz);
        }
      }
    }
    return [...changed].map(key=>this.buffers.get(key));
  }
}
