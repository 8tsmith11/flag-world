import assert from 'node:assert/strict';
import { BLOCK, getBlockDef } from '../shared/blocks.js';
import { FLUID, METALS } from '../shared/config.js';
import { ITEM } from '../shared/itemIds.js';
import { getItemDef } from '../shared/items.js';
import { PUMP_PARTS, BOILER_PARTS, CRUSHER_PARTS, pipeParts, tankFrameParts,
  tankExteriorFaces } from '../shared/fluidModels.js';
import { configurableFluidFaces } from '../shared/fluidFaces.js';
import { getRecipe } from '../shared/recipes.js';
import { SWORDS } from '../shared/tools.js';

for(const [id,shape] of [[BLOCK.FLUID_PUMP,'fluidPump'],[BLOCK.BOILER,'boiler'],[BLOCK.CRUSHER,'crusher']])
  assert.equal(getBlockDef(id).shape,shape);
assert.equal(getBlockDef(BLOCK.FLUID_PUMP).name,'fluid pump');
assert.equal(BLOCK.WATER_PUMP,BLOCK.FLUID_PUMP,'historic pump id changed');
assert.equal(getRecipe('fluid_pump').output,BLOCK.FLUID_PUMP);
assert.equal(getRecipe('water_pump').output,BLOCK.FLUID_PUMP,'historical recipe id stopped working');
for(const parts of [PUMP_PARTS,BOILER_PARTS,CRUSHER_PARTS,pipeParts(),tankFrameParts()])
  assert.ok(parts.length>=5,'model missing detailed parts');
assert.ok(!configurableFluidFaces('pump')&&!configurableFluidFaces('crusher'));
assert.ok(configurableFluidFaces('tank')&&configurableFluidFaces('boiler'));

const left={kind:'tank',x:0,y:0,z:0,fluid:'water',fill:0.5};
const right={kind:'tank',x:1,y:0,z:0,fluid:'water',fill:0.5};
const pair=[left,right];
assert.equal(tankExteriorFaces(pair).length,10,'joined glass has an interior face');
assert.equal(tankExteriorFaces(pair,'water').length,10,'joined water has an interior face');
assert.equal(tankFrameParts((dx,dy,dz)=>dx===1&&dy===0&&dz===0).length
  < tankFrameParts().length,true,'joined frame still has seam rails');
const above={...right,x:0,y:1,fill:0.25};
left.fill=1;
assert.equal(tankExteriorFaces([left,above],'water').length,10,'stacked water has an interior face');

const sword=getRecipe('bronze_sword');
assert.equal(sword.output,ITEM.BRONZE_SWORD);
assert.equal(sword.inputs.find(input=>input.item===ITEM.BRONZE_INGOT).count,METALS.crafting.bronzeSwordIngots);
assert.equal(SWORDS[ITEM.BRONZE_SWORD].damage,METALS.bronzeSwordDamage);
assert.equal(getItemDef(ITEM.BRONZE_SWORD).modCategory,'melee');
assert.equal(FLUID.blockIds.pump[0],BLOCK.FLUID_PUMP);
console.log('OK: fluid block models, connected tank surfaces, fixed ports, bronze sword');
