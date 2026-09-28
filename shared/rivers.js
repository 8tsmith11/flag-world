import { BLOCK, isSolid } from './blocks.js';
import { RIVER_SETTINGS as C, GOBLIN_GEN, GORGE_SETTINGS as G } from './config.js';
import { KEEP_REACH, mulberry32 } from './structures.js';
import { planRiverCave, carveRiverCave } from './riverCave.js';
const key=(x,z)=>`${x},${z}`;
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const insideReserve=(terrain,x,z,margin=0)=>Math.hypot(x-terrain.x,z-terrain.z)<=terrain.radius*GOBLIN_GEN.reservedFraction+margin;
const blocked=(world,terrain,x,z,margin=0)=>insideReserve(terrain,x,z,margin)
  || world.keeps.some(k=>Math.abs(x-k.cx)<=KEEP_REACH+margin&&Math.abs(z-k.cz)<=KEEP_REACH+margin)
  || world.structures.some(({box:b})=>b&&x>=b.x0-margin&&x<=b.x1+margin&&z>=b.z0-margin&&z<=b.z1+margin);

function lakePlan(world,terrain,x,z,radius,noise,cutLimit=C.lakeMaxCut) {
  x=Math.round(x);z=Math.round(z);
  const aspect=mix(...C.lakeAspect,(noise(x/C.lakeShapeScale,z/C.lakeShapeScale)+1)/2);
  const angle=noise(x/C.noiseScale,z/C.noiseScale)*Math.PI,cs=Math.cos(angle),sn=Math.sin(angle);
  const reach=Math.ceil(radius*Math.max(aspect,1/aspect)*(1+C.lakeShapeVariation)+C.lakeRim),cells=[],rim=[];
  let lowest=Infinity,highest=-Infinity,outlet=null;
  for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++) {
    const bx=x+dx,bz=z+dz,distance=Math.hypot((dx*cs+dz*sn)/aspect,(-dx*sn+dz*cs)*aspect);
    const edge=radius*(1+C.lakeShapeVariation*noise(bx/C.lakeShapeScale,bz/C.lakeShapeScale));
    if(distance>edge+C.lakeRim)continue;
    const top=terrain.getTop(bx,bz);
    if(top===-32768||blocked(world,terrain,bx,bz,C.clearance))return null;
    highest=Math.max(highest,top);
    if(distance<=edge)cells.push({x:bx,z:bz,d:distance/edge,top});
    else {
      rim.push({x:bx,z:bz,top});
      // A lower notch becomes the outlet; ties prefer the island's exterior.
      const outward=Math.hypot(bx-terrain.x,bz-terrain.z);
      if(top<lowest || top===lowest&&outward>outlet.outward){lowest=top;outlet={x:bx,z:bz,outward};}
    }
  }
  if(cells.length<C.minLakeCells||highest-lowest>cutLimit)return null;
  const waterY=Math.floor((lowest-1)/C.levelStep)*C.levelStep;
  if(cells.some(c=>terrain.getBottom(c.x,c.z)>=waterY-C.lakeDepth-C.lakeRim))return null;
  return {x,z,radius,waterY,cells,rim,outlet};
}

function height(terrain,x,z,fallback) {
  const ix=Math.floor(x),iz=Math.floor(z),tx=x-ix,tz=z-iz;
  const top=(x,z)=>{const y=terrain.getTop(x,z);return y===-32768?fallback:y;};
  return mix(mix(top(ix,iz),top(ix+1,iz),tx),mix(top(ix,iz+1),top(ix+1,iz+1),tx),tz);
}

function trace(world,terrain,lake,noise) {
  const points=[],ox=lake.outlet.x-lake.x,oz=lake.outlet.z-lake.z,len=Math.hypot(ox,oz);
  for(let d=0;d<len;d+=C.pathStep)points.push({x:lake.x+ox*d/len,z:lake.z+oz*d/len,lake});
  let x=lake.outlet.x,z=lake.outlet.z,angle=Math.atan2(oz,ox),out=0;
  for(let i=0;i<C.maxSteps;i++) {
    const top=terrain.getTop(Math.round(x),Math.round(z));
    if(top===-32768)out+=C.pathStep;
    else if(out)return null; // Reject a route that jumps an inland gap.
    points.push({x,z,lake:null});
    if(out>=C.waterfallOverhang)return points;
    // Tributaries share the gorge's existing downstream centerline and levels.
    const gorge=world.rivers.find(r=>r.kind==='gorge');
    if(gorge) {
      const index=gorge.points.findIndex(p=>Math.hypot(x-p.x,z-p.z)<=p.width/2);
      if(index>=0) {
        const join=gorge.points[index];
        if(lake.waterY<join.waterY)return null;
        const distance=Math.hypot(join.x-x,join.z-z);
        for(let d=C.pathStep;d<distance;d+=C.pathStep)points.push({x:mix(x,join.x,d/distance),z:mix(z,join.z,d/distance)});
        points.push(...gorge.points.slice(index).map(p=>({...p,joined:true,gorgeWidth:undefined})));
        return points;
      }
    }
    if(blocked(world,terrain,x,z,C.width[1]*C.downstreamGrowth/2+C.bankWidth))return null;
    const radial=Math.atan2(z-terrain.z,x-terrain.x),g=C.gradientSample;
    const fallback=top===-32768?lake.waterY:top;
    const gx=(height(terrain,x+g,z,fallback)-height(terrain,x-g,z,fallback))/(2*g);
    const gz=(height(terrain,x,z+g,fallback)-height(terrain,x,z-g,fallback))/(2*g);
    const bend=noise(x/C.noiseScale,z/C.noiseScale)*C.meanderWeight;
    const rx=Math.cos(radial),rz=Math.sin(radial);
    const vx=rx*C.outwardWeight-gx*C.downhillWeight-rz*bend;
    const vz=rz*C.outwardWeight-gz*C.downhillWeight+rx*bend;
    let desired=Math.atan2(vz,vx);
    let delta=Math.atan2(Math.sin(desired-angle),Math.cos(desired-angle));
    angle+=Math.max(-C.maxTurn,Math.min(C.maxTurn,delta*C.turnEase));
    // A smooth outward component guarantees escape without grid walks.
    if(Math.cos(angle-radial)<C.minOutward) {
      delta=Math.atan2(Math.sin(radial-angle),Math.cos(radial-angle));
      angle+=Math.max(-C.maxTurn,Math.min(C.maxTurn,delta));
    }
    x+=Math.cos(angle)*C.pathStep;z+=Math.sin(angle)*C.pathStep;
  }
  return null;
}

function planLevels(terrain,points,lakes,width,noise) {
  let distance=0;
  const segments=[];
  for(let i=0;i<points.length;i++) {
    if(i)distance+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
    const p=points[i];p.distance=distance;
    p.width=width*mix(1,C.downstreamGrowth,smooth(i/(points.length-1)))
      *(1+C.widthNoise*noise(p.x/C.widthNoiseScale,p.z/C.widthNoiseScale));
    p.segment=Math.floor(distance/C.segmentLength);
    const s=segments[p.segment]??(segments[p.segment]={level:Infinity});
    if(p.joined){s.joinLevel=Math.min(s.joinLevel??Infinity,p.waterY);continue;}
    const reach=Math.ceil(p.width/2+C.shoreWidth);
    for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++) {
      if(Math.hypot(dx,dz)>reach)continue;
      const t=terrain.getTop(Math.round(p.x)+dx,Math.round(p.z)+dz);
      if(t!==-32768)s.level=Math.min(s.level,t-1);
    }
    for(const lake of lakes)if(Math.hypot(p.x-lake.x,p.z-lake.z)<=lake.radius+C.lakeRim)s.level=Math.min(s.level,lake.waterY);
  }
  let level=lakes[0].waterY;
  for(const s of segments){level=Math.min(level,s.joinLevel??(Number.isFinite(s.level)?Math.floor(s.level/C.levelStep)*C.levelStep:level));s.level=level;}
  for(const p of points) {
    if(p.joined)continue;
    p.waterY=segments[p.segment].level;
    for(const lake of lakes)if(Math.hypot(p.x-lake.x,p.z-lake.z)<=lake.radius)p.waterY=lake.waterY;
  }
  // Through-lake level cannot rise above its incoming reach.
  for(let i=1;i<points.length;i++)points[i].waterY=Math.min(points[i].waterY,points[i-1].waterY);
  return segments;
}

function distanceField(points,lakes,gorgeMargin=0) {
  const field=new Map();
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
    if(!len2)continue;
    const bankWidth=a.tunnel&&b.tunnel?0:C.bankWidth;
    const reach=Math.max(Math.max(a.width,b.width,a.gorgeWidth??0,b.gorgeWidth??0)/2,
      a.caveRadius??0,b.caveRadius??0)+bankWidth+gorgeMargin;
    for(let z=Math.floor(Math.min(a.z,b.z)-reach);z<=Math.ceil(Math.max(a.z,b.z)+reach);z++)
      for(let x=Math.floor(Math.min(a.x,b.x)-reach);x<=Math.ceil(Math.max(a.x,b.x)+reach);x++) {
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2));
        const d=Math.hypot(x-mix(a.x,b.x,t),z-mix(a.z,b.z,t)),radius=mix(a.width,b.width,t)/2;
        const gorgeRadius=a.gorgeWidth?mix(a.gorgeWidth,b.gorgeWidth,t)/2:0;
        const tunnel=t<0.5?!!a.tunnel:!!b.tunnel;
        const caveRadius=tunnel?mix(a.caveRadius??b.caveRadius,b.caveRadius??a.caveRadius,t):0;
        const caveHeight=tunnel?mix(a.caveHeight??b.caveHeight,b.caveHeight??a.caveHeight,t):0;
        if(d>Math.max(radius,gorgeRadius,caveRadius)+bankWidth+gorgeMargin)continue;
        const k=key(x,z),old=field.get(k);
        if(!old||d/radius<old.relative)field.set(k,{x,z,d,radius,relative:d/radius,gorgeRadius,tunnel,caveRadius,caveHeight,
          waterY:t<C.pathStep/C.segmentLength?a.waterY:b.waterY});
      }
  }
  for(const lake of lakes)for(const c of [...lake.cells,...lake.rim]) {
    const k=key(c.x,c.z),old=field.get(k),d=Math.hypot(c.x-lake.x,c.z-lake.z);
    const wet=lake.cells.includes(c);
    // Wet lake footprints override the narrow river's distance field.
    if(wet||!old)field.set(k,{x:c.x,z:c.z,d:wet?c.d*lake.radius:d,radius:lake.radius,relative:wet?c.d:d/lake.radius,waterY:lake.waterY,lake,wet});
  }
  return field;
}

function carve(world,terrain,field,protectedField=null) {
  carveRiverCave(world,terrain,field);
  const wet=new Map();
  for(const [k,c]of field)if(c.wet===true||c.wet!==false&&c.relative<=1)wet.set(k,c);
  for(const [k,c] of wet) {
    const top=terrain.getTop(c.x,c.z);
    world.riverColumns.add(k);world.riverCells.add(`${c.x},${c.waterY},${c.z}`);
    if(top===-32768) {
      // A falling sheet continues into the void; no artificial bed in air.
      for(let y=c.waterY;y>world.voidY;y--) {
        if(isSolid(world.getBlock(c.x,y,c.z)))break;
        world.setBlock(c.x,y,c.z,y===c.waterY?BLOCK.WATER:BLOCK.WATER_FLOW_7);
      }
      continue;
    }
    const depth=Math.max(1,Math.round((c.lake?C.lakeDepth:C.channelDepth)*(1-Math.pow(c.relative,c.lake?C.lakeDepthCurve:C.depthCurve))));
    const bed=c.waterY-depth;
    // Line through cave openings, then fill the entire cross-section with water.
    for(let y=bed-C.lakeRim;y<bed;y++)if(!isSolid(world.getBlock(c.x,y,c.z)))world.setBlock(c.x,y,c.z,BLOCK.STONE);
    world.setBlock(c.x,bed,c.z,BLOCK.SAND);
    const ceiling=c.tunnel?Math.min(top-G.caveRoofMargin,Math.floor(c.waterY+c.caveHeight*Math.pow(
      Math.max(0,1-(c.d/c.caveRadius)**2),G.caveWallCurve))):Math.max(top+C.skyClearance,c.waterY);
    for(let y=bed+1;y<=Math.max(c.waterY,ceiling);y++)world.setBlock(c.x,y,c.z,y<=c.waterY?BLOCK.WATER:BLOCK.AIR);
  }
  // Smooth cut slopes blend back to existing terrain. Only a thin sand edge
  // borders water; every exposed dirt face above it is grassed over.
  for(const [k,c]of field) {
    const other=protectedField?.get(k);
    // Preserve a joining channel and its walking shoulders when shaping banks.
    if(wet.has(k)||other?.tunnel&&other.d<other.caveRadius||c.tunnel)continue;
    const top=terrain.getTop(c.x,c.z);if(top===-32768)continue;
    if(c.gorgeRadius&&c.d>c.gorgeRadius+terrain.radius*G.rimWidth)continue;
    const edge=c.lake?C.lakeRim:C.bankWidth;
    const floorRadius=Math.min(c.radius*G.valleyFloorWidth,c.gorgeRadius*G.valleyFloorFraction);
    const t=c.gorgeRadius
      ? smooth(Math.min(1,Math.max(0,(c.d-floorRadius)/(c.gorgeRadius-floorRadius))))**G.wallCurve
      : smooth(Math.min(1,Math.max(0,(c.d-c.radius)/edge)));
    const bank=Math.max(c.waterY,Math.round(mix(c.waterY,Math.max(c.waterY,top),t)));
    for(let y=bank+1;y<=top+C.skyClearance;y++)world.setBlock(c.x,y,c.z,BLOCK.AIR);
    const id=c.d-c.radius<C.shoreWidth&&bank<=c.waterY+1?BLOCK.SAND
      : c.gorgeRadius&&bank<top?BLOCK.STONE:BLOCK.GRASS;
    for(let y=Math.min(top,bank)-C.lakeRim;y<=bank;y++)if(!isSolid(world.getBlock(c.x,y,c.z)))world.setBlock(c.x,y,c.z,BLOCK.STONE);
    world.setBlock(c.x,bank,c.z,id);
    c.bank=bank;
  }
  for(const c of field.values()) {
    if(c.tunnel)continue;
    const top=c.bank??terrain.getTop(c.x,c.z);
    if(top===-32768)continue;
    for(let y=c.waterY+1;y<=top;y++) {
      if(world.getBlock(c.x,y,c.z)!==BLOCK.DIRT)continue;
      if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>!isSolid(world.getBlock(c.x+dx,y,c.z+dz))))world.setBlock(c.x,y,c.z,BLOCK.GRASS);
    }
  }
  return wet;
}

// An outward, noise-bent polar route cannot cross the circular reserve.
// Lake and river carving remain the same producer; only the bank profile and
// a radius-scaled depth turn this first watercourse into a rock gorge.
function gorgePlan(world,terrain,noise,random) {
  const r=terrain.radius,p=terrain.regions;
  for(let attempt=0;attempt<G.sourceAttempts;attempt++) {
    const offset=Math.ceil(attempt/2)*(attempt%2?1:-1)*G.sourceAngleStep;
    const angle=p.angle+p.gorgeSide*p.halfArc*G.sourceArcFraction+offset;
    const distance=r*G.sourceRadius,x=terrain.x+Math.cos(angle)*distance,z=terrain.z+Math.sin(angle)*distance;
    const lake=lakePlan(world,terrain,x,z,mix(...C.lakeRadius,random()),noise,r*G.lakeCutAllowance);
    if(!lake)continue;
    lake.waterY-=Math.round(r*G.depth/C.levelStep)*C.levelStep;
    if(lake.cells.some(c=>terrain.getBottom(c.x,c.z)>=lake.waterY-C.lakeDepth-C.lakeRim))continue;
    const points=[],width=mix(...C.width,random());
    const start=Math.hypot(lake.x-terrain.x,lake.z-terrain.z),startAngle=Math.atan2(lake.z-terrain.z,lake.x-terrain.x);
    const bendStart=noise(start/(r*G.bendScale),p.gorgeSide);
    let out=0,level=lake.waterY;
    for(let d=0;d<r+C.waterfallOverhang;d+=C.pathStep) {
      const radial=start+d;
      const bend=G.bend*(noise(radial/(r*G.bendScale),p.gorgeSide)-bendStart);
      const a=startAngle+bend,bx=terrain.x+Math.cos(a)*radial,bz=terrain.z+Math.sin(a)*radial;
      const top=terrain.getTop(Math.round(bx),Math.round(bz));
      if(top===-32768)out+=C.pathStep;
      else {
        if(out){points.length=0;break;}
        level=Math.min(level,Math.floor((lake.waterY-d*G.downstreamDrop/G.sourceRadius)/C.levelStep)*C.levelStep,
          Math.floor((top-1)/C.levelStep)*C.levelStep);
      }
      const grow=smooth(d/(r-start));
      points.push({x:bx,z:bz,distance:d,segment:Math.floor(d/C.segmentLength),waterY:level,
        width:width*mix(1,C.downstreamGrowth,grow),
        gorgeWidth:r*G.width*(1+G.widthVariation*noise(bx/(r*G.widthScale),bz/(r*G.widthScale)))});
      if(out>=C.waterfallOverhang)break;
    }
    if(!points.length||out<C.waterfallOverhang)continue;
    const cave=planRiverCave(terrain,points[0],noise);if(!cave)continue;
    const margin=Math.max(r*G.constructionMargin,G.caveRockMargin),field=distanceField(points,[],margin);
    const caveField=distanceField(cave.points,[],G.caveRockMargin);
    if([...field.values(),...caveField.values()].some(c=>blocked(world,terrain,c.x,c.z)))continue;
    return {source:lake,points,width,field,cave,caveField};
  }
  throw new Error(`No gorge source fits seed ${world.seed}`);
}

function recordRiver(world,lakes,points,width,segments,wet,kind='river') {
  world.lakes.push(...lakes.map(l=>({x:l.x,z:l.z,radius:l.radius,waterY:l.waterY,
    cells:l.cells.map(({x,z})=>({x,z})),outlet:l.outlet,kind:'river'})));
  const last=points.at(-1),lake=lakes[0];
  world.rivers.push({kind,source:{x:lake.x,y:lake.waterY,z:lake.z},end:{x:last.x,y:last.waterY,z:last.z},width,
    points:points.map(({lake,...p})=>p),segments,lakes:lakes.map(l=>({x:l.x,z:l.z,waterY:l.waterY})),
    cells:[...wet.values()].map(({x,z,waterY})=>({x,z,waterY}))});
}

export function generateRivers(world,terrain,seed,count,noise) {
  const started=performance.now(),random=mulberry32(seed^C.seedSalt);
  world.rivers=[];world.lakes??=[];world.riverCells=new Set();world.riverColumns=new Set();
  world.terrainExclusions=new Set();
  const gorge=gorgePlan(world,terrain,noise,random);
  world.gorgeCave=gorge.cave;
  const wetCave=carve(world,terrain,gorge.caveField);
  const wetGorge=carve(world,terrain,gorge.field,gorge.caveField);
  // The entire rim (not only the water) is unavailable to buildings, roads,
  // enclosure walls and underground rooms. Preserve original natural masks.
  for(const [k,c]of gorge.field) {
    world.terrainExclusions.add(k);
    if(c.tunnel)continue;
    const top=terrain.getTop(c.x,c.z);if(top===-32768)continue;
    const wet=wetGorge.get(k),height=wet?c.waterY:c.bank??top;
    terrain.top[c.x-terrain.x0+terrain.width*(c.z-terrain.z0)]=height;
  }
  for(const k of gorge.caveField.keys())world.terrainExclusions.add(k);
  const wet=new Map([...wetCave,...wetGorge]),first=gorge.points[0],last=gorge.points.at(-1);
  world.rivers.push({kind:'gorge',source:{x:first.x,y:first.waterY,z:first.z},
    end:{x:last.x,y:last.waterY,z:last.z},waterfalls:[{x:last.x,y:last.waterY,z:last.z},gorge.cave.end],
    width:gorge.width,points:gorge.points,segments:[],lakes:[],
    cells:[...wet.values()].map(({x,z,waterY})=>({x,z,waterY}))});
  const used=[gorge.source];
  for(let river=1;river<count;river++)for(let attempt=0;attempt<C.countAttempts;attempt++) {
    const angle=random()*Math.PI*2,distance=terrain.radius*mix(...C.sourceRadius,random());
    const x=terrain.x+Math.cos(angle)*distance,z=terrain.z+Math.sin(angle)*distance;
    if(used.some(l=>Math.hypot(x-l.x,z-l.z)<terrain.radius*C.sourceSpacing))continue;
    const lake=lakePlan(world,terrain,x,z,mix(...C.lakeRadius,random()),noise);if(!lake)continue;
    let points=trace(world,terrain,lake,noise);if(!points)continue;
    const lakes=[lake],width=mix(...C.width,random());
    if(!points.some(p=>p.joined)&&random()<C.throughLakeChance) {
      const index=Math.floor(points.length*mix(...C.throughLakeFraction,random())),p=points[index];
      const next=lakePlan(world,terrain,p.x,p.z,mix(...C.lakeRadius,random()),noise);
      if(next&&next.waterY<=lake.waterY&&Math.hypot(next.x-lake.x,next.z-lake.z)>next.radius+lake.radius+C.bankWidth) {
        const downstream=trace(world,terrain,next,noise);
        if(downstream){points=[...points.slice(0,index),...downstream];lakes.push(next);}
      }
    }
    const segments=planLevels(terrain,points,lakes,width,noise),field=distanceField(points,lakes);
    if(points.some(p=>p.joined&&segments[p.segment].level<p.waterY))continue;
    if([...field.values()].some(c=>blocked(world,terrain,c.x,c.z)))continue;
    const wet=carve(world,terrain,field);
    recordRiver(world,lakes,points,width,segments,wet);
    used.push(lake);break;
  }
  world.riverGenerationMs=performance.now()-started;
}

// Structure earthworks run after rivers. Skin exposed soil once all producers
// have finished, so later village pads cannot reintroduce bare dirt walls.
export function finishRiverBanks(world) {
  const started=performance.now(),banks=new Map();
  for(const river of world.rivers)for(const c of river.cells)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x=c.x+dx,z=c.z+dz,k=key(x,z),old=banks.get(k);
    if(old===undefined||c.waterY<old)banks.set(k,c.waterY);
  }
  for(const [k,waterY]of banks) {
    const [x,z]=k.split(',').map(Number);
    for(let y=waterY+1;y<world.sizeY;y++) {
      if(world.getBlock(x,y,z)!==BLOCK.DIRT)continue;
      if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>!isSolid(world.getBlock(x+dx,y,z+dz))))world.setBlock(x,y,z,BLOCK.GRASS);
    }
  }
  world.riverGenerationMs+=performance.now()-started;
}
