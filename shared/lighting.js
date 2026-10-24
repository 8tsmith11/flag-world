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
  // caps each BFS, even in empty sky; walls are checked at every edge. Light
  // reaching the box starts within maxLevel of it and spreads at most maxLevel
  // further, so a flat array over the box plus 2 * maxLevel holds every cell.
  // Returns a lookup (x, y, z) -> level.
  flood(box) {
    const w=this.world, r=C.maxLevel, m=2*r;
    const x0=box.x0-m,y0=box.y0-m,z0=box.z0-m,sx=box.x1-box.x0+1+2*m,sy=box.y1-box.y0+1+2*m,sz=box.z1-box.z0+1+2*m;
    const sxz=sx*sz, values=new Uint8Array(sxz*sy), opaque=new Uint8Array(sxz*sy); // opaque: 0 unknown, 1 clear, 2 opaque
    const buckets=Array.from({length:r+1},()=>[]);
    for (let cy=Math.floor((box.y0-r)/CHUNK_SIZE);cy<=Math.floor((box.y1+r)/CHUNK_SIZE);cy++)
      for (let cz=Math.floor((box.z0-r)/CHUNK_SIZE);cz<=Math.floor((box.z1+r)/CHUNK_SIZE);cz++)
        for (let cx=Math.floor((box.x0-r)/CHUNK_SIZE);cx<=Math.floor((box.x1+r)/CHUNK_SIZE);cx++) {
          const sources=this.emitters.get(chunkKey(cx,cy,cz)); if (!sources) continue;
          for (const s of sources.values()) {
            const distance=Math.max(box.x0-s.x,0,s.x-box.x1)+Math.max(box.y0-s.y,0,s.y-box.y1)+Math.max(box.z0-s.z,0,s.z-box.z1);
            if (distance >= s.level) continue;
            const i=s.x-x0+sx*(s.z-z0)+sxz*(s.y-y0);
            if (values[i]<s.level) { values[i]=s.level; buckets[s.level].push(i); }
          }
        }
    for (let v=r;v>1;v--) {
      const next=v-1, bucket=buckets[v];
      for (let b=0;b<bucket.length;b++) {
        const i=bucket[b]; if (values[i]!==v) continue;
        const lx=i%sx, lz=Math.floor(i/sx)%sz, ly=Math.floor(i/sxz);
        for (let d=0;d<6;d++) {
          const [dx,dy,dz]=LIGHT_DIRS[d], nx=lx+dx, ny=ly+dy, nz=lz+dz;
          if (nx<0||nx>=sx||ny<0||ny>=sy||nz<0||nz>=sz) continue;
          const n=i+dx+sx*dz+sxz*dy; if (values[n]>=next) continue;
          if (!opaque[n]) {
            const x=nx+x0,y=ny+y0,z=nz+z0;
            opaque[n]=!w.inBounds(x,y,z)||getBlockDef(w.getBlock(x,y,z)).lightOpaque ? 2 : 1;
          }
          if (opaque[n]===2) continue;
          values[n]=next; if (next>1) buckets[next].push(n);
        }
      }
    }
    return (x,y,z)=>{
      const lx=x-x0,ly=y-y0,lz=z-z0;
      return lx<0||lx>=sx||ly<0||ly>=sy||lz<0||lz>=sz ? 0 : values[lx+sx*lz+sxz*ly];
    };
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
        const i=Chunk.index(x,y,z); data.light[i]=this.world.inBounds(x0+x,y0+y,z0+z) ? flood(x0+x,y0+y,z0+z) : 0;
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
  edit(x,y,z,id,oldId) { return this.editMany([{x,y,z,id,oldId}]); }
  // Applies block edits in order, then relights once. Block light is redone
  // over merged boxes around the edits, so a ring of hundreds of lava blocks
  // costs one flood instead of one per block.
  editMany(edits) {
    this.lastDirty=new Set();
    const w=this.world, changed=new Set(), r=C.maxLevel, regions=new Map(), airBoxes=[];
    const ra=Math.ceil(C.maxLevel/C.openAirLoss)-1;
    for (const {x,y,z,id,oldId} of edits) {
      const newDef=getBlockDef(id), oldDef=getBlockDef(oldId);
      const opaqueChanged=newDef.lightOpaque!==oldDef.lightOpaque;
      const before=opaqueChanged?[0,1,2].map(axis=>this.rayBounds(axis,x,y,z)):null;
      w.setBlock(x,y,z,id);
      const ck=chunkKey(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE));
      if (newDef.emission!==oldDef.emission) {
        let sources=this.emitters.get(ck); if (!sources) this.emitters.set(ck,sources=new Map());
        sources.delete(this.key(x,y,z));
        if(newDef.emission) sources.set(this.key(x,y,z),{x,y,z,level:Math.min(C.maxLevel,newDef.emission)});
      }
      if (newDef.emission!==oldDef.emission || opaqueChanged) {
        const region=regions.get(ck);
        if (!region) regions.set(ck,{x0:x,y0:y,z0:z,x1:x,y1:y,z1:z});
        else Object.assign(region,{x0:Math.min(region.x0,x),y0:Math.min(region.y0,y),z0:Math.min(region.z0,z),
          x1:Math.max(region.x1,x),y1:Math.max(region.y1,y),z1:Math.max(region.z1,z)});
      }
      if (before) {
        const p=[x,y,z];
        airBoxes.push({lo:p.map(v=>v-ra),hi:p.map(v=>v+ra)});
        // A changed boundary ray can create/remove direct sources arbitrarily
        // far away. Reflood only loaded chunks intersecting those changed beams.
        for(let axis=0;axis<3;axis++) {
          this.rays[axis].delete(this.rayKey(axis,x,y,z));
          const after=this.rayBounds(axis,x,y,z);
          for(let end=0;end<2;end++)if(before[axis][end]!==after[end]) {
            const lo=p.map(v=>v-ra),hi=p.map(v=>v+ra);
            lo[axis]=Math.min(before[axis][end],after[end])-ra;hi[axis]=Math.max(before[axis][end],after[end])+ra;
            airBoxes.push({lo,hi});
          }
        }
      }
    }
    for (const box of mergeBoxes([...regions.values()].map(b=>({x0:b.x0-r,y0:b.y0-r,z0:b.z0-r,x1:b.x1+r,y1:b.y1+r,z1:b.z1+r})))) {
      const flood=this.flood(box);
      for (const buffer of this.buffers.values()) {
        const bx0=buffer.cx*CHUNK_SIZE,by0=buffer.cy*CHUNK_SIZE,bz0=buffer.cz*CHUNK_SIZE;
        const xa=Math.max(box.x0,bx0),xb=Math.min(box.x1,bx0+CHUNK_SIZE-1);
        const ya=Math.max(box.y0,by0),yb=Math.min(box.y1,by0+CHUNK_SIZE-1);
        const za=Math.max(box.z0,bz0),zb=Math.min(box.z1,bz0+CHUNK_SIZE-1);
        if (xa>xb||ya>yb||za>zb) continue;
        for (let y=ya;y<=yb;y++) for (let z=za;z<=zb;z++) for (let x=xa;x<=xb;x++) {
          const i=Chunk.index(x-bx0,y-by0,z-bz0), level=w.inBounds(x,y,z) ? flood(x,y,z) : 0;
          if (buffer.light[i]===level) continue;
          buffer.light[i]=level; changed.add(chunkKey(buffer.cx,buffer.cy,buffer.cz)); this.markCell(x,y,z);
        }
      }
    }
    if (airBoxes.length) {
      for(const [key,buffer] of this.buffers) {
        const origin=[buffer.cx,buffer.cy,buffer.cz].map(v=>v*CHUNK_SIZE);
        if(!airBoxes.some(b=>origin.every((v,i)=>v<=b.hi[i]&&v+CHUNK_SIZE-1>=b.lo[i])))continue;
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

const union=(a,b)=>({x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),z0:Math.min(a.z0,b.z0),
  x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1),z1:Math.max(a.z1,b.z1)});
// Merge boxes while the union costs no more than flooding both separately
// (each flood also pays for a 2 * maxLevel margin).
function mergeBoxes(boxes) {
  const m=4*C.maxLevel, cost=b=>(b.x1-b.x0+1+m)*(b.y1-b.y0+1+m)*(b.z1-b.z0+1+m);
  for (let merged=true;merged;) {
    merged=false;
    for (let i=0;i<boxes.length&&!merged;i++) for (let j=i+1;j<boxes.length;j++) {
      const u=union(boxes[i],boxes[j]);
      if (cost(u)>cost(boxes[i])+cost(boxes[j])) continue;
      boxes[i]=u; boxes.splice(j,1); merged=true; break;
    }
  }
  return boxes;
}
