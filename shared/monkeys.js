import { MONKEY_WORK as C, MONKEY_DUTY as D } from './config.js';

// Working monkey roles, what each does (shown when hovering in the monkey
// screen), and the block selections each needs, in the order the selection
// mode walks through them.
export const MONKEY_ROLES=['idle','courier','collector','lumberjack','quarry','farmer','craftsman','fisherman','guard','lookout'];
// Gathering roles that can leave what they gather on the ground (Collect drops off).
// Roles with a Collect drops switch (off: what they gather is left on the
// ground for collector monkeys and players).
export const GATHERING_ROLES=['lumberjack','quarry','farmer','fisherman'];
export const ROLE_INFO={
  idle:{name:'Idle',tip:'Does nothing. It waits at its home spot if one is set.'},
  courier:{name:'Courier',tip:'Takes items out of source containers and delivers them to destination containers, taking turns between destinations.'},
  collector:{name:'Collector',tip:'Picks up dropped items within its range of the first destination and delivers them.'},
  lumberjack:{name:'Lumberjack',tip:'Chops down whole grown trees at its tree sites, replants a sapling and delivers the wood. Faster with a better hammer.'},
  quarry:{name:'Quarry',tip:'Digs out a box, a circle or single blocks with the tool you give it and brings the blocks back once it carries enough. It never digs a block that would open a hole into the void, and climbs walls to get out.'},
  farmer:{name:'Farmer',tip:'Harvests ripe crops on farmland inside its area and replants the same crop. It never tills new soil.'},
  craftsman:{name:'Craftsman',tip:'Takes the ingredients of one recipe from its sources, crafts it at its workbench and delivers what it makes. It only takes as many sets as it can finish and carry.'},
  fisherman:{name:'Fisherman',tip:'Takes bait from its sources, stands on its fishing spot and casts a short way out in its direction, into water, lava or the void below. It reels in every bite, but fishes at a tenth of your speed (faster with a Swift rod), and takes each catch to its destinations (or, with Collect drops off, leaves it at its feet for a collector monkey). Give it a fishing rod.'},
  guard:{name:'Guard',tip:'Walks its patrol points in order and back to the first (or stands at a single point). Attacks enemy players and monkeys, goblins and hostile creatures it sees, but never chases far from its route. Give it a sword, axe or bow and armor.'},
  lookout:{name:'Lookout',tip:`Stands at its post and watches. When it sees an enemy player or goblin (up to ${D.lookout.range} blocks, ${D.lookout.spyglassRange} with a spyglass in its tool slot) it warns your whole team. With a spyglass it also says who it saw.`},
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
  waypoints:{name:'Patrol points',list:true,color:D.waypointColor,max:D.maxWaypoints,tip:'Blocks to stand on, visited in order and then back to the first. One point: it guards that spot.'},
  post:{name:'Lookout post',color:D.postColor,tip:'The block it stands on to keep watch. Somewhere high with a wide view works best.'},
  workbench:{name:'Workbench',color:D.workbenchColor,tip:'The workbench it crafts at.'},
  fishSpot:{name:'Fishing spot',color:0x5ac8fa,tip:'The block it stands on to fish. It casts about one block out from here, in its casting direction: put water, lava or open void below that.'},
};
// Fisherman casting directions (FACING_DIRS order).
export const CAST_DIRECTIONS=['North','East','South','West'];
// Where a monkey may put items in a machine (dests' slot choice): only
// machines with more than one kind of input slot get a choice.
export const SLOT_MODES={auto:'Automatic',input:'Material input',fuel:'Fuel input'};
export const SLOT_OPTIONS={furnace:['auto','input','fuel'],alloyFurnace:['auto','input','fuel']};
// The selections a configuration needs, in order (home is always optional).
export function monkeyFields(config) {
  switch(config.role) {
    case 'courier': return ['sources','dests'];
    case 'collector': return ['dests'];
    case 'lumberjack': return config.collect===false?['sites']:['sites','dests'];
    case 'farmer': return config.collect===false?['cornerA','cornerB']:['cornerA','cornerB','dests'];
    case 'craftsman': return ['sources','workbench','dests'];
    case 'fisherman': return ['fishSpot','sources','dests'];
    case 'guard': return ['waypoints'];
    case 'lookout': return ['post'];
    case 'quarry': {
      const area=config.quarry.shape==='blocks'?['blocks']:config.quarry.shape==='circle'?['cornerA']:['cornerA','cornerB'];
      return config.collect===false?area:[...area,'dests'];
    }
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
  quarry:{shape:'box',axis:'down',depth:4,radius:3,returnAt:32},radius:C.defaultRadius,filter:{mode:'blacklist',items:[]},
  waypoints:[],post:null,workbench:null,recipe:null,collect:true,destSlots:{},fishSpot:null,castDir:0});
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

// Shortest horizontal distance from p to a patrol route: the loop through
// its points (a single point is just that point). Infinity without points.
export function routeDistance(points,p) {
  if(!points.length)return Infinity;
  const c=q=>({x:q.x+0.5,z:q.z+0.5});
  if(points.length===1){const a=c(points[0]);return Math.hypot(p.x-a.x,p.z-a.z);}
  let best=Infinity;
  for(let i=0;i<points.length;i++) {
    const a=c(points[i]),b=c(points[(i+1)%points.length]),dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz;
    const t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len)):0;
    best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t));
  }
  return best;
}
