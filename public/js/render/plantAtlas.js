import { PLANT_ATLAS_IDS } from '/shared/blocks.js';
import { VEGETATION as C } from '/shared/config.js';
export const PLANT_ROWS=2**Math.ceil(Math.log2(Math.ceil(PLANT_ATLAS_IDS.length/C.atlasColumns)));
export function plantUV(id,u,v) {
 const index=PLANT_ATLAS_IDS.indexOf(id),pad=(C.atlasStride-C.atlasTile)/2;
 return [(index%C.atlasColumns*C.atlasStride+pad+u*C.atlasTile)/(C.atlasColumns*C.atlasStride),
  1-(Math.floor(index/C.atlasColumns)*C.atlasStride+pad+(1-v)*C.atlasTile)/(PLANT_ROWS*C.atlasStride)];
}
