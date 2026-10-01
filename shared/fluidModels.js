// Box-model parts shared by chunk meshes and held/dropped block models.
// Boxes use 0..1 block coordinates; north is the front of a placed pump.
import { FLUID_FACES } from './fluidFaces.js';

const BRONZE=0xb8793e, BRONZE_LIGHT=0xd6a66b, IRON=0x555c61, DARK=0x30363a;
const part=(box,color,hiddenFaces=0)=>({box,color,hiddenFaces});

export const PUMP_PARTS = [
  part([0.08,0.04,0.08,0.92,0.22,0.92],DARK),
  part([0.15,0.2,0.16,0.85,0.76,0.84],BRONZE),
  part([0.21,0.76,0.22,0.79,0.85,0.78],BRONZE_LIGHT),
  part([0.37,0.84,0.34,0.63,0.93,0.66],DARK),
  part([0.3,0.32,0.04,0.7,0.67,0.16],BRONZE_LIGHT),
  part([0.37,0.39,0.015,0.63,0.61,0.045],DARK),
  part([0.08,0.3,0.31,0.17,0.67,0.69],BRONZE_LIGHT),
  part([0.83,0.3,0.31,0.92,0.67,0.69],BRONZE_LIGHT),
];

export const BOILER_PARTS = [
  part([0.04,0.02,0.04,0.96,0.14,0.96],DARK),
  part([0.16,0.13,0.16,0.84,0.85,0.84],IRON),
  part([0.08,0.23,0.08,0.92,0.3,0.92],BRONZE),
  part([0.08,0.68,0.08,0.92,0.75,0.92],BRONZE),
  part([0.35,0.84,0.35,0.65,1.02,0.65],BRONZE_LIGHT),
  part([0.39,1.02,0.39,0.61,1.19,0.61],DARK),
  part([0.34,1.15,0.34,0.66,1.2,0.66],BRONZE),
  part([0.29,0.39,0.065,0.71,0.61,0.13],BRONZE_LIGHT),
  part([0.37,0.43,0.045,0.63,0.57,0.068],DARK),
  part([0.08,0.38,0.35,0.16,0.63,0.65],0x6da8b0),
];

export const CRUSHER_PARTS = [
  part([0.04,0.02,0.04,0.96,0.17,0.96],DARK),
  part([0.11,0.16,0.11,0.89,0.74,0.89],IRON),
  part([0.08,0.71,0.08,0.92,0.8,0.92],BRONZE),
  part([0.13,0.8,0.13,0.87,0.91,0.87],BRONZE_LIGHT),
  part([0.2,0.91,0.2,0.8,1.02,0.8],DARK),
  part([0.24,1.02,0.24,0.76,1.07,0.76],BRONZE),
  part([0.16,0.35,0.035,0.84,0.65,0.11],BRONZE),
  part([0.22,0.39,0.02,0.78,0.6,0.037],DARK),
  part([0.29,0.4,0.005,0.38,0.59,0.022],0x9ba19e),
  part([0.45,0.4,0.005,0.54,0.59,0.022],0x9ba19e),
  part([0.61,0.4,0.005,0.7,0.59,0.022],0x9ba19e),
  part([0.17,0.3,0.88,0.83,0.7,0.94],BRONZE_LIGHT),
];

export function pipeParts(connects=i=>i<2) {
  // A uniform tube has no collars or capped stubs. Only connected sides
  // extend out of the center, so bends and junctions keep the same width.
  const low=0.30,high=0.70;
  const joined=FLUID_FACES.map((_,i)=>!!connects(i));
  const innerFaces=joined.reduce((mask,yes,i)=>yes?mask|(1<<i):mask,0);
  const parts=[part([low,low,low,high,high,high],BRONZE,innerFaces)];
  FLUID_FACES.forEach(([dx,dy,dz],i)=>{
    if(!joined[i])return;
    parts.push(part([dx<0?0:dx>0?high:low,dy<0?0:dy>0?high:low,dz<0?0:dz>0?high:low,
      dx<0?low:dx>0?1:high,dy<0?low:dy>0?1:high,dz<0?low:dz>0?1:high],BRONZE,
      (1<<i)|(1<<(i^1))));
  });
  return parts;
}

export function tankFrameParts(hasTank=()=>false) {
  const parts=[];
  const postBottom=hasTank(0,-1,0)?0:0.09;
  const postTop=hasTank(0,1,0)?1:0.91;
  for(const [y,dy] of [[0,-1],[0.91,1]]) {
    if(hasTank(0,dy,0))continue;
    for(const z of [0,0.91])if(!hasTank(0,0,z===0?-1:1))
      parts.push(part([0,y,z,1,y+0.09,z+0.09],BRONZE));
    for(const x of [0,0.91])if(!hasTank(x===0?-1:1,0,0))
      parts.push(part([x,y,0,x+0.09,y+0.09,1],BRONZE));
  }
  for(const x of [0,0.91])for(const z of [0,0.91]) {
    if(hasTank(x===0?-1:1,0,0)||hasTank(0,0,z===0?-1:1))continue;
    parts.push(part([x,postBottom,z,x+0.09,postTop,z+0.09],BRONZE_LIGHT));
  }
  return parts;
}

// Connected tank surfaces omit shared glass and fluid faces. This also avoids
// coplanar transparent panels, which shimmer as their sort order changes.
export function tankExteriorFaces(nodes,fluid=null) {
  const lookup=new Map(nodes.map(node=>[`${node.x},${node.y},${node.z}`,node]));
  const faces=[];
  for(const node of nodes) {
    if(node.kind!=='tank'||fluid&&(node.fluid!==fluid||node.fill<=0))continue;
    FLUID_FACES.forEach(([dx,dy,dz],face)=>{
      const other=lookup.get(`${node.x+dx},${node.y+dy},${node.z+dz}`);
      if(other?.kind==='tank'&&(!fluid||other.fluid===fluid&&other.fill>0
        &&(dy===0||dy<0&&other.fill>=1||dy>0&&node.fill>=1)))return;
      faces.push({node,face});
    });
  }
  return faces;
}
