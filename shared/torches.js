// Attach after every generator/earthwork has finished, using the actual faces.
import { BLOCK, FACED, FACING_DIRS, facedBlock, isSolid, isDoor } from './blocks.js';
import { CHUNK_SIZE } from './config.js';
export function generatedTorch(world,x,y,z) {
  const support=id=>isSolid(id)&&!isDoor(id);
  const facing=FACING_DIRS.findIndex(([dx,dz])=>support(world.getBlock(x+dx,y,z+dz)));
  if(facing>=0)return facedBlock(BLOCK.TORCH,facing);
  return support(world.getBlock(x,y-1,z))?BLOCK.TORCH:BLOCK.AIR;
}
export function attachGeneratedTorches(world) {
  let count=0,removed=0;
  for(const chunk of world.chunks.values())for(let i=0;i<chunk.blocks.length;i++) {
    const id=chunk.blocks[i];if(id!==BLOCK.TORCH&&!FACED[BLOCK.TORCH].includes(id))continue;
    const x=chunk.cx*CHUNK_SIZE+i%CHUNK_SIZE,y=chunk.cy*CHUNK_SIZE+Math.floor(i/CHUNK_SIZE**2),z=chunk.cz*CHUNK_SIZE+Math.floor(i/CHUNK_SIZE)%CHUNK_SIZE;
    const attached=generatedTorch(world,x,y,z);world.setBlock(x,y,z,attached);count++;if(attached===BLOCK.AIR)removed++;
  }
  world.torchGeneration={count,removed};
}
