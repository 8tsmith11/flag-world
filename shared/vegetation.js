// Column-only decoration after all construction and river bank finishing.
import { BLOCK, isSolid, getBlockDef, FACING_DIRS } from './blocks.js';
import { VEGETATION as C } from './config.js';
import { mulberry32, KEEP_REACH } from './structures.js';
export function vegetationReservations(world) {
  const mask=new Uint8Array(world.sizeX*world.sizeZ),reserve=(x0,z0,x1,z1)=>{
    for(let z=Math.max(0,z0);z<=Math.min(world.sizeZ-1,z1);z++)for(let x=Math.max(0,x0);x<=Math.min(world.sizeX-1,x1);x++)mask[x+world.sizeX*z]=1;
  };
  for(const s of world.structures)if(s.kind!=='tree'&&s.box)reserve(s.box.x0-C.structureMargin,s.box.z0-C.structureMargin,s.box.x1+C.structureMargin,s.box.z1+C.structureMargin);
  for(const keep of world.keeps) {const r=KEEP_REACH+C.keepMargin;reserve(keep.cx-r,keep.cz-r,keep.cx+r,keep.cz+r);}
  const plan=world.goblinPlan;
  if(plan){for(const r of plan.surface.roads)reserve(r.x-C.structureMargin,r.z-C.structureMargin,r.x+C.structureMargin,r.z+C.structureMargin);
    for(const ring of plan.surface.rings)for(const r of [...ring.wall,...ring.gates])reserve(r.x-C.structureMargin,r.z-C.structureMargin,r.x+C.structureMargin,r.z+C.structureMargin);
    const r=plan.reserved;for(let z=Math.floor(r.z-r.radius);z<=Math.ceil(r.z+r.radius);z++)for(let x=Math.floor(r.x-r.radius);x<=Math.ceil(r.x+r.radius);x++)if(Math.hypot(x-r.x,z-r.z)<=r.radius)reserve(x,z,x,z);
  }
  return mask;
}
export function generateVegetation(world,terrains,noise) {
  const random=mulberry32(world.seed^C.seedSalt),reserved=vegetationReservations(world);
  let plants=0,hanging=0;
  for(const t of terrains)for(let z=t.z0;z<t.z0+t.width;z++)for(let x=t.x0;x<t.x0+t.width;x++) {
    const top=t.getTop(x,z);if(top===-32768||reserved[x+world.sizeX*z])continue;
    const biome=world.biomeAt(x,z),cluster=noise(x/C.clusterScale,z/C.clusterScale);
    if(cluster>C.clusterThreshold&&random()<C.density[biome==='ancientForest'?'forest':biome==='stoneSpires'?'plains':biome]) {
      const ground=world.getBlock(x,top,z);
      if((ground===BLOCK.GRASS||ground===BLOCK.DIRT)&&Array.from({length:C.surfaceClearance},(_,i)=>world.getBlock(x,top+1+i,z)).every(id=>id===BLOCK.AIR)) {
        let shade=false;for(let dy=C.surfaceClearance+1;dy<=C.shadeHeight;dy++)if(world.getBlock(x,top+dy,z)===BLOCK.LEAVES){shade=true;break;}
        const roll=random();let id=BLOCK.GRASS_TUFT;
        if(biome==='forest'||biome==='ancientForest')id=shade&&roll<C.glowChance?BLOCK.GLOW_MOSS:roll<C.forestMushroomChance? (random()<C.mushroomGlowChance?BLOCK.GLOW_MUSHROOM:BLOCK.MUSHROOM):roll<1-C.bushChance?BLOCK.FERN:BLOCK.BUSH;
        else if(biome==='plains'&&roll<C.flowerChance)id=random()<C.glowChance?BLOCK.GLOW_FLOWER:[BLOCK.RED_FLOWER,BLOCK.BLUE_FLOWER,BLOCK.GOLD_FLOWER][Math.floor(random()*3)];
        world.setBlock(x,top+1,z,id);plants++;
      }
    }
    if(noise(x/C.hangClusterScale+173,z/C.hangClusterScale)>C.hangClusterThreshold&&random()<C.hangChance) {
      const bottom=t.getBottom(x,z),middle=t.surfaceY-(t.surfaceY-t.bottomY)*C.undersideBand;
      // Upper underside only; deeper lobe tips remain bare rock.
      let start=bottom-1;
      if(bottom<middle)continue;
      if(FACING_DIRS.some(([dx,dz])=>t.getTop(x+dx,z+dz)===-32768)) {
        const y=Math.round(top-(top-bottom)*C.cliffBand),side=FACING_DIRS.find(([dx,dz])=>world.getBlock(x+dx,y,z+dz)===BLOCK.AIR);
        if(side){placeHang(x+side[0],y,z+side[1]);}
      }
      if(isSolid(world.getBlock(x,bottom,z)))placeHang(x,start,z);
    }
  }
  function placeHang(x,y,z) {
    const above=world.getBlock(x,y+1,z);
    if(reserved[x+world.sizeX*z]||!isSolid(above)&&!getBlockDef(above).hanging)return;
    const id=random()<C.woodyChance?(random()<C.darkRootChance?BLOCK.DARK_ROOT:BLOCK.ROOT):(random()<C.budChance?BLOCK.BUD_VINE:BLOCK.VINE);
    const length=C.hangLength[0]+Math.floor(random()*(C.hangLength[1]-C.hangLength[0]+1));
    for(let i=0;i<length&&world.inBounds(x,y-i,z)&&world.getBlock(x,y-i,z)===BLOCK.AIR;i++){world.setBlock(x,y-i,z,id);hanging++;}
  }
  world.vegetationGeneration={plants,hanging};
}
