import assert from 'node:assert/strict';
import { generateWorld } from '../shared/worldgen.js';
import { BLOCK } from '../shared/blocks.js';
import { QUARRY_SURFACE } from '../shared/config.js';

for(const [size,expected] of [['small',1],['medium',2],['large',3]]) for(const seed of [1,2,3]) {
  const world=generateWorld(seed,2,size);
  for(const terrain of world.mainTerrains) {
    const island=world.islands[terrain.index];if(island.kind!=='team')continue;
    const keep=world.keeps.find(k=>Math.hypot(k.cx-island.x,k.cz-island.z)<island.radius);
    const surface=world.quarries.filter(({x,y,z})=>{
      const i=x-terrain.x0+terrain.width*(z-terrain.z0);
      return i>=0&&i<terrain.top.length&&terrain.top[i]===y
        &&Math.hypot(x-island.x,z-island.z)<island.radius;
    });
    assert.equal(surface.length,expected,`${size} seed ${seed} team surface quarries`);
    for(const {x,y,z} of surface) {
      assert.equal(world.getBlock(x,y,z),BLOCK.QUARRY_STONE);
      assert.ok(Math.hypot(x-keep.cx,z-keep.cz)>=QUARRY_SURFACE.minKeepDistance);
      for(let h=1;h<=QUARRY_SURFACE.headroom;h++)assert.equal(world.getBlock(x,y+h,z),BLOCK.AIR);
    }
  }
  console.log(`${size} seed ${seed}: ${expected} surface Quarry Stones per team island`);
}
