// Seeded tree plans are small, face-connected skeletons with clustered crowns.
// Validate before writing so rejected limbs cannot strand branch components.
import { TREE_SETTINGS as C, KEEP_SIZE, KEEP_MARGIN } from './config.js';
import { BLOCK, isSolid, isWater, isTreeSupport, TREE_SIDES } from './blocks.js';
import { mulberry32 } from './structures.js';
import { structureAllowed } from './structures/place.js';
const integer=(random,[lo,hi])=>lo+Math.floor(random()*(hi-lo+1));
// Coordinates relative to this tree, with a span derived from its shape.
// No world-width assumption, including during validation of edge candidates.
const cellKey=(x,y,z,p)=>x-p.x+p.span*(z-p.z+p.span*(y-p.ground));
// Reuse each species' crown offsets. Preserve iteration/random-call order.
const crownOffsets=new Map();
for(const s of Object.values(C.species))if(!crownOffsets.has(s.crown)) {
  const r=s.crown,offsets=[];
  for(let dy=-1;dy<=1;dy++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++) {
    if(dx*dx+dz*dz+dy*dy<=r*r+1)offsets.push({dx,dy,dz,thin:Math.abs(dx)+Math.abs(dz)>r});
  }
  crownOffsets.set(r,offsets);
}
export function treePlan(x,ground,z,top,{seed=0,species='oak',width=1,hollow=false,maturity=1,straightTrunk=false}={}) {
  const random=mulberry32(seed^Math.imul(x,73856093)^Math.imul(z,19349663)^C.seedSalt);
  let s=C.species[species];
  if(species==='ancient'&&maturity<1) {
    const young=C.species.oak,mix=(a,b)=>a+(b-a)*maturity;
    s={...s,length:s.length.map((v,i)=>Math.round(mix(young.length[i],v))),
      branches:s.branches.map((v,i)=>Math.round(mix(young.branches[i],v))),
      crown:Math.round(mix(young.crown,s.crown)),fork:mix(young.fork,s.fork),lean:mix(young.lean,s.lean)};
  }
  const origin={x,ground,z,span:2*(width+Math.max(...s.length)+s.crown+Math.max(...C.forkLength)+1)+1};
  const cells=new Map(),crowns=[];
  const put=(x,y,z,id)=>{const key=cellKey(x,y,z,origin),old=cells.get(key);if(!old||old.id===BLOCK.LEAVES&&id!==BLOCK.LEAVES||id===BLOCK.WOOD&&old.id!==BLOCK.WOOD)cells.set(key,{x,y,z,id});};
  const crown=(p,r)=>crowns.push({ ...p,r });
  // Manhattan stepping gives angled limbs continuous arms in all six axes.
  function line(from,to,id,decorate=false) {
    const p={...from},axes=['x','z','y'];
    while(axes.some(a=>p[a]!==to[a])) {
      for(const a of axes)if(p[a]!==to[a]) {
        p[a]+=Math.sign(to[a]-p[a]);put(p.x,p.y,p.z,id);
      }
      if(decorate&&p.y>=top&&random()<C.upperLeaves)crown(p,s.crown);
    }
    return p;
  }
  let tx=x,tz=z;
  const leanAxis=random()<0.5?'x':'z',leanSign=random()<0.5?-1:1;
  const lean=random()<s.lean&&!straightTrunk;
  const roots=[];
  for(let y=ground+1;y<=top;y++) {
    if(lean&&y===top-1) {
      const nx=tx+(leanAxis==='x'?leanSign:0),nz=tz+(leanAxis==='z'?leanSign:0);
      // Bridge the sideways shift with full logs on the preceding level.
      for(let dx=0;dx<width;dx++)for(let dz=0;dz<width;dz++)put(nx+dx,y-1,nz+dz,BLOCK.WOOD);
      tx=nx;tz=nz;
    }
    for(let dx=0;dx<width;dx++)for(let dz=0;dz<width;dz++) {
      const inside=dx>0&&dx<width-1&&dz>0&&dz<width-1;
      const entrance=dz===0&&dx>0&&dx<width-1;
      if(hollow&&y<=ground+C.ancient.hollowHeight&&(inside||entrance))continue;
      put(tx+dx,y,tz+dz,BLOCK.WOOD);
    }
    if(y>=ground+Math.ceil((top-ground)*C.branchStart))roots.push({x:tx+Math.floor(width/2),y,z:tz+Math.floor(width/2)});
  }
  const tip={x:tx+Math.floor(width/2),y:top,z:tz+Math.floor(width/2)};
  crown(tip,s.crown);
  if(random()<s.fork) {
    const length=integer(random,C.forkLength),angle=random()*Math.PI*2;
    crown(line(tip,{x:tip.x+Math.round(Math.cos(angle)*length),y:top+length,z:tip.z+Math.round(Math.sin(angle)*length)},
      straightTrunk?BLOCK.BRANCH:BLOCK.WOOD),s.crown);
  }
  const count=integer(random,s.branches),rotation=random()*Math.PI*2;
  for(let i=0;i<count;i++) {
    const root=roots[Math.floor(random()*roots.length)],length=integer(random,s.length);
    const angle=rotation+i*Math.PI*2/count+(random()-0.5)*Math.PI/count;
    const end={x:root.x+Math.round(Math.cos(angle)*length),z:root.z+Math.round(Math.sin(angle)*length),y:root.y+Math.max(1,Math.round(length*s.rise))};
    crown(line(root,end,BLOCK.BRANCH,true),s.crown);
  }
  // Slight seeded corner thinning varies crowns without punching out their core.
  for(const p of crowns)for(const {dx,dy,dz,thin} of crownOffsets.get(p.r)) {
    if(thin&&random()<C.crownThinning)continue;
    put(p.x+dx,p.y+dy,p.z+dz,BLOCK.LEAVES);
  }
  const blocks=[...cells.values()],box={x0:Infinity,y0:Infinity,z0:Infinity,x1:-Infinity,y1:-Infinity,z1:-Infinity};
  for(const b of blocks){box.x0=Math.min(box.x0,b.x);box.x1=Math.max(box.x1,b.x);box.y0=Math.min(box.y0,b.y);box.y1=Math.max(box.y1,b.y);box.z0=Math.min(box.z0,b.z);box.z1=Math.max(box.z1,b.z);}
  return {blocks,box,x,ground,z,top,species,width,hollow,span:origin.span};
}
// Rock intruding through a crown can separate its far side. Only obstructed
// crowns need this small local flood; normal trees take the fast path.
function pruneCanopy(world,plan) {
  const cells=new Map(),distance=new Map(),queue=[];
  for(const b of plan.blocks) {
    const old=world.getBlock(b.x,b.y,b.z);
    if(b.id===BLOCK.LEAVES&&old!==BLOCK.AIR&&!isTreeSupport(old))continue;
    const id=b.id===BLOCK.LEAVES&&old!==BLOCK.AIR?old:b.id;
    const k=cellKey(b.x,b.y,b.z,plan);cells.set(k,{...b,id});
    if(id===BLOCK.WOOD||old===BLOCK.WOOD){distance.set(k,0);queue.push(b);}
  }
  function flood() {
    for(let head=0;head<queue.length;head++) {
      const p=queue[head],d=distance.get(cellKey(p.x,p.y,p.z,plan));if(d>=C.decayReach)continue;
      for(const [dx,dy,dz]of TREE_SIDES) {
        const k=cellKey(p.x+dx,p.y+dy,p.z+dz,plan),next=cells.get(k);
        if(next&&(distance.get(k)??Infinity)>d+1){distance.set(k,d+1);queue.push(next);}
      }
    }
  }
  flood();queue.length=0;
  // An existing log can support canopy behind the local obstruction too.
  for(const [k,b]of cells)if(!distance.has(k)&&TREE_SIDES.some(([dx,dy,dz])=>world.getBlock(b.x+dx,b.y+dy,b.z+dz)===BLOCK.WOOD)) {
    distance.set(k,1);queue.push(b);
  }
  flood();
  plan.blocks=plan.blocks.filter(b=>b.id!==BLOCK.LEAVES||distance.has(cellKey(b.x,b.y,b.z,plan)));
}
function validTree(world,plan) {
  const {x,ground,z,box}=plan;
  if(!structureAllowed(world,box)||box.y1>=world.sizeY||box.x0<0||box.z0<0||box.x1>=world.sizeX||box.z1>=world.sizeZ)return false;
  const soil=world.getBlock(x,ground,z);
  if(soil!==BLOCK.GRASS&&soil!==BLOCK.DIRT)return false;
  const keepReach=Math.floor(KEEP_SIZE/2)+KEEP_MARGIN;
  if(world.keeps.some(k=>box.x0<=k.cx+keepReach&&box.x1>=k.cx-keepReach&&box.z0<=k.cz+keepReach&&box.z1>=k.cz-keepReach))return false;
  if((world.treeObstacles??world.structures).some(s=>s.kind!=='tree'&&s.box&&s.box.y1>ground&&box.x0<=s.box.x1&&box.x1>=s.box.x0&&box.z0<=s.box.z1&&box.z1>=s.box.z0))return false;
  // Only actual occupied crown columns need headroom, preserving trees in
  // open courtyards and over buried fortress rooms.
  const riverChecked=new Set();let obstructed=false;
  for(const b of plan.blocks) {
    if((world.plantClearance?.get(b.x+world.sizeX*b.z)??-Infinity)>=b.y)return false;
    const column=b.x+world.sizeX*b.z;
    if(!riverChecked.has(column)) {
      if(world.riverColumns?.has(`${b.x},${b.z}`))return false;
      riverChecked.add(column);
    }
    const old=world.getBlock(b.x,b.y,b.z);
    if(isWater(old))return false;
    if(b.id===BLOCK.LEAVES&&old!==BLOCK.AIR&&!isTreeSupport(old))obstructed=true;
    if(b.id!==BLOCK.LEAVES&&old!==BLOCK.AIR&&old!==BLOCK.LEAVES&&old!==BLOCK.BRANCH
      &&!(b.id===BLOCK.BRANCH&&old===BLOCK.WOOD)&&!(b.y===ground+1&&old===BLOCK.SAPLING))return false;
  }
  for(let dx=0;dx<plan.width;dx++)for(let dz=0;dz<plan.width;dz++) {
    let y=ground;while(y>=ground-C.ancient.groundRelief&&!isSolid(world.getBlock(x+dx,y,z+dz)))y--;
    const soil=world.getBlock(x+dx,y,z+dz);
    if(soil!==BLOCK.GRASS&&soil!==BLOCK.DIRT)return false;
  }
  if(obstructed)pruneCanopy(world,plan);
  return true;
}
export function canGrowTree(world,x,ground,z,top,options={}) {return validTree(world,treePlan(x,ground,z,top,options));}
export function growTree(world,x,ground,z,top,options={}) {
  const plan=treePlan(x,ground,z,top,options);if(!validTree(world,plan))return false;
  // Short log roots bridge relief under a broad trunk; the hollow's floor
  // is level dirt and remains attached to the surrounding soil.
  for(let dx=0;dx<plan.width;dx++)for(let dz=0;dz<plan.width;dz++) {
    let y=ground;while(!isSolid(world.getBlock(x+dx,y,z+dz))) {
      const interior=plan.hollow&&dx>0&&dx<plan.width-1&&dz<plan.width-1;
      world.setBlock(x+dx,y,z+dz,interior?BLOCK.DIRT:BLOCK.WOOD);y--;
    }
  }
  for(const b of plan.blocks) {
    const old=world.getBlock(b.x,b.y,b.z);
    if(b.id===BLOCK.LEAVES&&old!==BLOCK.AIR||b.id===BLOCK.BRANCH&&old===BLOCK.WOOD)continue;
    world.setBlock(b.x,b.y,b.z,b.id);
  }
  plan.box.y0=Math.min(plan.box.y0,ground-C.ancient.groundRelief);
  const {blocks,...record}=plan;
  (world.trees??=[]).push(record);
  world.structures.push({kind:'tree',x,y:ground,z,box:plan.box});
  return true;
}
