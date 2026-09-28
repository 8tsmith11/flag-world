// A 2D swept cavern around the river: bounded columns, no volumetric noise.
import { BLOCK, isSolid } from './blocks.js';
import { GORGE_SETTINGS as G, RIVER_SETTINGS as R, GOBLIN_GEN } from './config.js';

export function planRiverCave(terrain,entrance,noise) {
  const r=terrain.radius,start=Math.hypot(entrance.x-terrain.x,entrance.z-terrain.z);
  const startAngle=Math.atan2(entrance.z-terrain.z,entrance.x-terrain.x);
  const side=-terrain.regions.gorgeSide,points=[],step=R.pathStep/(r*(G.caveTurn+G.caveOutward));
  const caveRadius=Math.max(r*G.caveWidth/2,entrance.width/2+G.caveWalkWidth);
  const innerRadius=r*GOBLIN_GEN.reservedFraction+caveRadius+G.caveRockMargin+R.clearance;
  let out=0,distance=0,exit=null,level=entrance.waterY;
  for(let t=0;t<=1+step;t+=step) {
    const phase=Math.min(1,t),bend=noise(phase/G.bendScale,side)*G.caveBend*Math.sin(Math.PI*phase);
    const radial=Math.max(innerRadius,start-r*G.caveInward*Math.sin(Math.PI*phase)+(r*G.caveOutward-start)*phase*phase);
    const angle=startAngle+side*G.caveTurn*phase+bend;
    const x=terrain.x+Math.cos(angle)*radial,z=terrain.z+Math.sin(angle)*radial;
    if(points.length)distance+=Math.hypot(x-points.at(-1).x,z-points.at(-1).z);
    const top=terrain.getTop(Math.round(x),Math.round(z));
    if(top===-32768)out+=points.length?Math.hypot(x-points.at(-1).x,z-points.at(-1).z):0;
    else {
      if(out)return null;
      level=Math.min(level,Math.floor((entrance.waterY-distance*G.caveDrop)/R.levelStep)*R.levelStep);
    }
    const p={x,z,distance,waterY:level,width:entrance.width,tunnel:true,
      caveRadius,
      caveHeight:Math.max(G.caveMinHeight,r*G.caveHeight)};
    points.push(p);
    if(top!==-32768)exit=p;
    if(out>=R.waterfallOverhang)break;
  }
  if(out<R.waterfallOverhang||!exit)return null;
  return {entrance:{x:Math.round(entrance.x),y:entrance.waterY,z:Math.round(entrance.z)},
    exit:{x:Math.round(exit.x),y:exit.waterY,z:Math.round(exit.z)},
    end:{x:points.at(-1).x,y:level,z:points.at(-1).z},rockMargin:G.caveRockMargin,points};
}

export function carveRiverCave(world,terrain,field) {
  for(const c of field.values()) {
    if(!c.tunnel||!c.caveRadius||c.d>=c.caveRadius)continue;
    const top=terrain.getTop(c.x,c.z);if(top===-32768)continue;
    const relative=c.d/c.caveRadius;
    const floor=c.waterY+Math.round(G.caveFloorRise*relative*relative);
    const ceiling=Math.min(top-G.caveRoofMargin,
      Math.floor(c.waterY+c.caveHeight*Math.pow(1-relative*relative,G.caveWallCurve)));
    if(ceiling<=floor)continue;
    // A continuous lined bed covers incidental worm-cave intersections.
    for(let y=floor-R.lakeRim;y<floor;y++)if(!isSolid(world.getBlock(c.x,y,c.z)))world.setBlock(c.x,y,c.z,BLOCK.STONE);
    world.setBlock(c.x,floor,c.z,BLOCK.STONE);
    for(let y=floor+1;y<=ceiling;y++)world.setBlock(c.x,y,c.z,BLOCK.AIR);
  }
}
