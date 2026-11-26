import { MONKEY_WORK as C } from './config.js';

// Working monkey roles, what each does (shown when hovering in the monkey
// screen), and the block selections each needs, in the order the selection
// mode walks through them.
export const MONKEY_ROLES=['idle','courier','collector','lumberjack','quarry','farmer'];
export const ROLE_INFO={
  idle:{name:'Idle',tip:'Does nothing. It waits at its home spot if one is set.'},
  courier:{name:'Courier',tip:'Takes items out of source containers and delivers them to destination containers, taking turns between destinations.'},
  collector:{name:'Collector',tip:'Picks up dropped items within its range of the first destination and delivers them.'},
  lumberjack:{name:'Lumberjack',tip:'Chops down whole grown trees at its tree sites, replants a sapling and delivers the wood. Faster with a better hammer.'},
  quarry:{name:'Quarry',tip:'Digs out a box, a circle or single blocks with the tool you give it and brings the blocks back once it carries enough. It never digs a block that would open a hole into the void, and climbs walls to get out.'},
  farmer:{name:'Farmer',tip:'Harvests ripe crops on farmland inside its area and replants the same crop. It never tills new soil.'},
};
// Block selections. list: several blocks (picked one after another); color:
// the outline drawn on them while selecting.
export const MONKEY_FIELDS={
  sources:{name:'Sources',list:true,color:0xff9a2e,max:C.maxTargets,tip:'Containers it takes items from (chests, furnace output, crusher output…).'},
  dests:{name:'Destinations',list:true,color:0x3d8bff,max:C.maxTargets,tip:'Containers (or any block, to drop items on top) it delivers to, one after another.'},
  sites:{name:'Tree sites',list:true,color:0x4cd964,max:C.maxSites,tip:'Tree trunks to chop, or grass/dirt to plant a sapling on.'},
  cornerA:{name:'Corner 1',color:0xffd60a,tip:'One corner of the area (included).'},
  cornerB:{name:'Corner 2',color:0xffd60a,tip:'The opposite corner of the area (included).'},
  blocks:{name:'Blocks to break',list:true,color:0xff3b30,max:C.maxBlocks,tip:'Single blocks to break, in the order you pick them.'},
  home:{name:'Home',color:0xbf5af2,tip:'Where it waits when there is nothing to do. Optional.'},
};
// The selections a configuration needs, in order (home is always optional).
export function monkeyFields(config) {
  switch(config.role) {
    case 'courier': return ['sources','dests'];
    case 'collector': return ['dests'];
    case 'lumberjack': return ['sites','dests'];
    case 'farmer': return ['cornerA','cornerB','dests'];
    case 'quarry': return config.quarry.shape==='blocks'?['blocks','dests']
      :config.quarry.shape==='circle'?['cornerA','dests']:['cornerA','cornerB','dests'];
    default: return [];
  }
}
// The label of a field for this configuration (a circle's corner is its center).
export function fieldName(config,field) {
  if(field==='cornerA'&&config.role==='quarry'&&config.quarry.shape==='circle')return 'Center';
  return MONKEY_FIELDS[field].name;
}
// Quarry options, with what they do on hover.
export const QUARRY_OPTIONS={
  shape:{name:'Shape',tip:'Box: between two corners. Circle: around a center, with a radius. Blocks: only the single blocks you pick.',
    values:{box:'Box',circle:'Circle',blocks:'Single blocks'}},
  axis:{name:'Dig direction',tip:'Down digs a pit layer by layer. A side direction turns the shape on its side and tunnels that way from Corner 1 (or the center).',
    values:{down:'Down',north:'North',south:'South',east:'East',west:'West'}},
  depth:{name:'Depth',tip:'How many layers it digs in the dig direction.',min:1,max:C.maxQuarryDepth},
  radius:{name:'Radius',tip:'Circle radius in blocks.',min:1,max:C.maxQuarryRadius},
  returnAt:{name:'Return after',tip:'Blocks it carries before taking them to a destination.',min:1,max:C.inventorySize*64},
};
export const MONKEY_NAMES=['Mango','Pip','Coco','Bongo','Peanut','Nori','Mochi','Fig',
  'Tiki','Basil','Maple','Bean','Kiki','Otis','Ziggy','Juniper','Milo','Poppy','Rolo','Chai'];
export const MONKEY_GAMES=['simon','memory','cups'];
export const defaultMonkeyConfig=()=>({role:'idle',sources:[],dests:[],sites:[],blocks:[],cornerA:null,cornerB:null,home:null,
  quarry:{shape:'box',axis:'down',depth:4,radius:3,returnAt:32},radius:C.defaultRadius,filter:{mode:'blacklist',items:[]}});
export function monkeyFilter(config,item) {
  const included=config.filter.items.includes(item);
  return config.filter.mode==='whitelist'?included:!included;
}
// Collector range: around the first destination.
export function monkeyRange(config,p) {
  const t=config.dests[0];
  return !!t&&Math.hypot(p.x-t.x,p.z-t.z)<=config.radius&&Math.abs(p.y-t.y)<=C.maxVertical;
}
const AXES={down:[0,-1,0],north:[0,0,-1],south:[0,0,1],east:[1,0,0],west:[-1,0,0]};
// Every cell a quarry digs, in order: layer by layer along the dig
// direction, each layer in a back-and-forth sweep. [] until its selections
// are complete. Capped at C.maxQuarryCells.
export function quarryCells(config) {
  const q=config.quarry;
  if(q.shape==='blocks')return config.blocks.map(p=>({...p}));
  const a=config.cornerA,b=q.shape==='circle'?a:config.cornerB;
  if(!a||!b)return [];
  const [ax,ay,az]=AXES[q.axis]??AXES.down;
  // u, v span each layer; w runs along the dig direction.
  const vertical=ay!==0;
  const out=[];
  for(let layer=0;layer<q.depth;layer++) {
    const cells=[];
    if(q.shape==='circle') {
      const r=q.radius;
      for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++) {
        if(i*i+j*j>r*r+r*0.8)continue;
        cells.push(vertical?{x:a.x+i,y:a.y-layer,z:a.z+j}
          :ax!==0?{x:a.x+ax*layer,y:a.y+j,z:a.z+i}:{x:a.x+i,y:a.y+j,z:a.z+az*layer});
      }
    } else if(vertical) {
      const top=Math.max(a.y,b.y)-layer;
      for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)for(let z=Math.min(a.z,b.z);z<=Math.max(a.z,b.z);z++)cells.push({x,y:top,z});
    } else {
      const y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);
      for(let y=y1;y>=y0;y--) {
        if(ax!==0)for(let z=Math.min(a.z,b.z);z<=Math.max(a.z,b.z);z++)cells.push({x:a.x+ax*layer,y,z});
        else for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)cells.push({x,y,z:a.z+az*layer});
      }
    }
    out.push(...cells);
    if(out.length>=C.maxQuarryCells)return out.slice(0,C.maxQuarryCells);
  }
  return out;
}
// The farmer's area: the box between its corners, one block deeper and two
// higher, so farmland and the crops on it both fall inside.
export function farmBox(config) {
  const a=config.cornerA,b=config.cornerB;
  if(!a||!b)return null;
  return {x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),z0:Math.min(a.z,b.z),z1:Math.max(a.z,b.z),
    y0:Math.min(a.y,b.y)-1,y1:Math.max(a.y,b.y)+2};
}
