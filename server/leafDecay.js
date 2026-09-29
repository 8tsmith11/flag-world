// Event-driven tree decay. Branches need a branch-only path to a log; leaves
// can use both leaves and branches. Player-placed foliage is never removed.
import { BLOCK, TREE_SIDES, isDecayingTreeBlock } from '../shared/blocks.js';
import { TREE_SETTINGS as C } from '../shared/config.js';
const REACH=C.decayReach, DIAMETER=REACH*2+1;
const localIndex=(dx,dy,dz)=>dx+REACH+DIAMETER*(dz+REACH+DIAMETER*(dy+REACH));
export class LeafDecay {
  constructor(world,onDecay=()=>{},loader=null) {
    this.world=world;this.onDecay=onDecay;this.pending=loader?loader.entityMap(p=>p):new Map();this.placedBlocks=new Set();this.explorations=[];this.decaying=false;
    this.visited=new Uint16Array(DIAMETER**3);this.visitId=0;
  }
  placed(x,y,z,id) { if(isDecayingTreeBlock(id))this.placedBlocks.add(`${x},${y},${z}`); }
  changed(x,y,z,id,oldId) {
    this.placedBlocks.delete(`${x},${y},${z}`);
    if((oldId===BLOCK.WOOD||isDecayingTreeBlock(oldId))&&id!==oldId&&!this.decaying)this.enqueueAroundLog(x,y,z);
  }
  enqueue(x,y,z) {
    const key=`${x},${y},${z}`;
    if(isDecayingTreeBlock(this.world.getBlock(x,y,z))&&!this.placedBlocks.has(key))this.pending.set(key,{x,y,z});
  }
  // Follow only connected foliage, bounded by reach, without scanning air.
  enqueueAroundLog(x,y,z) {
    this.explorations.push({queue:[{x,y,z,d:0}],head:0,seen:new Set([`${x},${y},${z}`])});
    for(const [dx,dy,dz]of TREE_SIDES)this.enqueue(x+dx,y+dy,z+dz);
  }
  explore() {
    let budget=C.decayEnqueueBudget;
    while(budget-- > 0&&this.explorations.length) {
      const e=this.explorations[0],p=e.queue[e.head++];
      if(p.d<REACH)for(const [dx,dy,dz]of TREE_SIDES) {
        const x=p.x+dx,y=p.y+dy,z=p.z+dz,key=`${x},${y},${z}`;
        if(e.seen.has(key)||!isDecayingTreeBlock(this.world.getBlock(x,y,z)))continue;
        e.seen.add(key);this.enqueue(x,y,z);e.queue.push({x,y,z,d:p.d+1});
      }
      if(e.head===e.queue.length)this.explorations.shift();
    }
  }
  hasWoodWithinReach(x,y,z) {
    if(++this.visitId===65535){this.visited.fill(0);this.visitId=1;}
    this.lastSearchWork=0;
    const branchOnly=this.world.getBlock(x,y,z)===BLOCK.BRANCH,queue=[{dx:0,dy:0,dz:0,d:0}];
    this.visited[localIndex(0,0,0)]=this.visitId;
    for(let head=0;head<queue.length;head++) {
      this.lastSearchWork++;
      const p=queue[head];if(p.d>=REACH)continue;
      for(const [sx,sy,sz]of TREE_SIDES) {
        const dx=p.dx+sx,dy=p.dy+sy,dz=p.dz+sz,id=this.world.getBlock(x+dx,y+dy,z+dz);
        if(id===BLOCK.WOOD)return true;
        if(id!==BLOCK.BRANCH&&(branchOnly||id!==BLOCK.LEAVES))continue;
        const i=localIndex(dx,dy,dz);if(this.visited[i]===this.visitId)continue;
        this.visited[i]=this.visitId;queue.push({dx,dy,dz,d:p.d+1});
      }
    }
    return false;
  }
  tick() {
    this.explore();
    let budget=C.decayTickBudget,work=C.decayNodeBudget;
    while(budget-- > 0&&work>0&&this.pending.size) {
      const entry=(this.pending.activeEntries?.()??this.pending.entries()).next().value;
      if(!entry)break;
      const [key,{x,y,z}]=entry;this.pending.delete(key);
      const id=this.world.getBlock(x,y,z);
      if(!isDecayingTreeBlock(id)||this.placedBlocks.has(key))continue;
      if(!this.hasWoodWithinReach(x,y,z)) {
        this.decaying=true;
        this.world.setBlock(x,y,z,BLOCK.AIR);this.decaying=false;this.onDecay(x,y,z,id);
        for(const [dx,dy,dz]of TREE_SIDES)this.enqueue(x+dx,y+dy,z+dz);
      }
      work-=this.lastSearchWork;
    }
  }
}
