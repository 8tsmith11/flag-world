// A few ground-following fallen trunks in old-growth forest. Each log rests
// on actual soil; reject construction, rivers and reserve before writing.
import { BLOCK } from './blocks.js';
import { TREE_SETTINGS as C } from './config.js';
import { mulberry32 } from './structures.js';
import { structureAllowed } from './structures/place.js';
export function generateFallenTrees(world,terrains) {
  const random=mulberry32(world.seed^C.seedSalt);
  for(const tree of (world.trees??[]).filter(t=>t.species==='ancient'&&t.width>1)) {
    if(random()>C.ancient.fallenChance)continue;
    const t=terrains.find(t=>tree.x>=t.x0&&tree.x<t.x0+t.width&&tree.z>=t.z0&&tree.z<t.z0+t.width);
    const length=C.ancient.fallenLength[0]+Math.floor(random()*(C.ancient.fallenLength[1]-C.ancient.fallenLength[0]+1));
    const alongX=random()<0.5,blocks=[];
    for(let i=0;i<length;i++) {
      const x=tree.x+(alongX?i:C.ancient.fallenOffset),z=tree.z+(alongX?C.ancient.fallenOffset:i),y=t.getTop(x,z)+1;
      blocks.push({x,y,z});
    }
    const box={x0:Math.min(...blocks.map(b=>b.x)),x1:Math.max(...blocks.map(b=>b.x)),
      z0:Math.min(...blocks.map(b=>b.z)),z1:Math.max(...blocks.map(b=>b.z)),
      y0:Math.min(...blocks.map(b=>b.y)),y1:Math.max(...blocks.map(b=>b.y))};
    if(!structureAllowed(world,box)||world.structures.some(s=>s.kind!=='tree'&&s.box&&box.x0<=s.box.x1&&box.x1>=s.box.x0&&box.z0<=s.box.z1&&box.z1>=s.box.z0&&box.y0<=s.box.y1))continue;
    if(blocks.some((b,i)=>world.biomeAt(b.x,b.z)!=='ancientForest'||world.getBlock(b.x,b.y-1,b.z)!==BLOCK.GRASS
      ||world.getBlock(b.x,b.y,b.z)!==BLOCK.AIR||world.plantClearance?.has(b.x+world.sizeX*b.z)
      ||world.riverColumns?.has(`${b.x},${b.z}`)||i&&Math.abs(b.y-blocks[i-1].y)>1))continue;
    for(let i=0;i<blocks.length;i++) {
      const b=blocks[i];world.setBlock(b.x,b.y,b.z,BLOCK.WOOD);
      if(i&&b.y!==blocks[i-1].y)world.setBlock(b.x,Math.min(b.y,blocks[i-1].y),b.z,BLOCK.WOOD);
    }
    world.structures.push({kind:'fallenTree',box});
  }
}
