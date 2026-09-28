// Overlay subregions on existing forest and central highland masks. The base
// forest mask is retained so every ancient cell has an explicit forest host.
import { TREE_SETTINGS as T, SPIRE_SETTINGS as S } from './config.js';
import { biomeCode } from './biomes.js';
import { structureAllowed } from './structures/place.js';
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function selectWoodedBiomes(world,terrains,noise) {
  world.regularForest=new Uint8Array(world.sizeX*world.sizeZ);
  world.ancientWeights=new Float32Array(world.sizeX*world.sizeZ);
  for(const t of terrains)for(let z=t.z0;z<t.z0+t.width;z++)for(let x=t.x0;x<t.x0+t.width;x++) {
    if(t.getTop(x,z)===-32768)continue;
    const key=x+world.sizeX*z,base=world.biomeAt(x,z);
    if(base==='forest')world.regularForest[key]=1;
    if(!structureAllowed(world,{x0:x,x1:x,z0:z,z1:z}))continue;
    if(base==='forest') {
      const scale=Math.max(T.ancient.minRadius,t.radius*T.ancient.patchScale);
      const weight=smooth((noise(x/scale+T.seedSalt%1000,z/scale)-T.ancient.threshold)/T.ancient.blend);
      if(weight>0){world.ancientWeights[key]=weight;world.biomeCodes[key]=biomeCode('ancientForest');}
    }
    // Stone spires belong exclusively to the central island's highland.
    if(t.kind==='center'&&1-t.lowland[x-t.x0+t.width*(z-t.z0)]>=S.highland
      &&noise(x/(t.radius*S.patchScale)-S.seedSalt%1000,z/(t.radius*S.patchScale))>S.threshold) {
      world.biomeCodes[key]=biomeCode('stoneSpires');world.ancientWeights[key]=0;
    }
  }
}
