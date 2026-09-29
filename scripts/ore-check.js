import assert from 'node:assert/strict';
import { generateWorld } from '../shared/worldgen.js';
import { ORE_SETTINGS } from '../shared/config.js';
import { BLOCK } from '../shared/blocks.js';

const density=ORE_SETTINGS.ironDensity;
try {
  ORE_SETTINGS.ironDensity=1;
  const before=generateWorld(1,2,'small');
  ORE_SETTINGS.ironDensity=density;
  const after=generateWorld(1,2,'small');
  let oldIron=0,newIron=0;
  assert.equal(before.chunks.size,after.chunks.size);
  for(const [key,a] of before.chunks) {
    const b=after.chunks.get(key);assert.ok(b);
    for(let i=0;i<a.blocks.length;i++) {
      if(a.blocks[i]===BLOCK.IRON_ORE) {
        oldIron++;if(b.blocks[i]===BLOCK.IRON_ORE)newIron++;
        else assert.equal(b.blocks[i],BLOCK.STONE,'Thinning iron changed another block type');
      } else assert.equal(b.blocks[i],a.blocks[i],'Thinning iron changed seeded terrain/structures/trees');
    }
  }
  assert.ok(newIron/oldIron>.47&&newIron/oldIron<.53,'Iron density is not approximately halved');
  console.log(`OK: iron ${oldIron} -> ${newIron} (${(newIron/oldIron*100).toFixed(1)}% retained); all other seeded voxels identical`);
} finally {ORE_SETTINGS.ironDensity=density;}
