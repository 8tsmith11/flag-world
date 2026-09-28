// Focused interaction checks for this change; no entity appearance assertions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../shared/worldgen.js';
import { BLOCK, VEGETATION_IDS, getBlockDef, isSolid, blocksAttack, isTargetable } from '../shared/blocks.js';
import { CHUNK_SIZE, LIGHTING as C } from '../shared/config.js';
import { VoxelLighting } from '../shared/lighting.js';
import { World } from '../shared/world.js';
import { Arrow } from '../server/arrow.js';
import { Game } from '../server/game.js';
import { raycastBlock, raycastPlayers } from '../shared/raycast.js';
import { vegetationReservations } from '../shared/vegetation.js';
import { CREATIVE_RECIPES } from '../shared/recipes.js';
import { generatedTorch } from '../shared/torches.js';
import { checkVillage } from './village-check.js';
const digest=world=>{const hash=createHash('sha256');for(const [key,chunk]of world.chunks){hash.update(String(key));hash.update(chunk.blocks);}return hash.digest('hex');};
for(const seed of [1,2,3]) {
  const start=performance.now(),world=generateWorld(seed,2,'small'),village=checkVillage(world),reserved=vegetationReservations(world);
  const plannedMushrooms=new Set(world.goblinPlan.fortress.pieces.flatMap(p=>p.blocks)
    .filter(b=>b.id===BLOCK.MUSHROOM).map(b=>`${b.x},${b.y},${b.z}`));
  let torches=0,plants=0,hanging=0;
  for(const chunk of world.chunks.values())for(let i=0;i<chunk.blocks.length;i++) {
    const id=chunk.blocks[i],def=getBlockDef(id);if(def.shape!=='plant'&&def.shape!=='torch')continue;
    const x=chunk.cx*CHUNK_SIZE+i%CHUNK_SIZE,y=chunk.cy*CHUNK_SIZE+Math.floor(i/CHUNK_SIZE**2),z=chunk.cz*CHUNK_SIZE+Math.floor(i/CHUNK_SIZE)%CHUNK_SIZE;
    if(def.shape==='torch'){const [dx,dy,dz]=def.support;assert(isSolid(world.getBlock(x+dx,y+dy,z+dz)),`unsupported torch ${x},${y},${z}`);assert.equal(id,generatedTorch(world,x,y,z));torches++;}
    else if(def.hanging){assert(!reserved[x+world.sizeX*z],'hanging strand intrudes into construction');hanging++;}
    else if(id===BLOCK.MUSHROOM&&plannedMushrooms.has(`${x},${y},${z}`))continue; // Existing fortress farm content.
    else {assert(!reserved[x+world.sizeX*z],'plant in path/wall/building/reserve');assert([BLOCK.GRASS,BLOCK.DIRT].includes(world.getBlock(x,y-1,z)));plants++;}
  }
  assert(torches&&plants&&hanging);assert.equal(world.torchGeneration.removed,0,'generator left unsupported torches');
  const lighting=new VoxelLighting(world),room=world.goblinPlan.fortress.pieces.find(p=>p.type==='totemHall');
  const x=room.position.x,y=room.position.y+2,z=room.position.z;
  const sample=lighting.openAirFlood({x0:x,y0:y,z0:z,x1:x,y1:y,z1:z});assert.deepEqual(sample(x,y,z),[0,0],'fortress has exterior light');
  if(seed===1)assert.equal(digest(world),digest(generateWorld(seed,2,'small')),'same seed produced different voxels');
  console.log(`Seed ${seed}: ${(performance.now()-start).toFixed(0)} ms; ${torches} supported torches, ${plants} plants, ${hanging} hanging cells; fortress dark; village`,village);
}
// All decorations remain mineable but never shorten a combat/projectile ray.
const creative=new Set(CREATIVE_RECIPES.map(r=>r.output));
for(const id of VEGETATION_IDS){assert(creative.has(id));const d=getBlockDef(id);assert(!d.solid&&!d.lightOpaque&&!blocksAttack(id));assert(isTargetable(id));assert.equal(d.breakTime,0);assert(d.icon);}
const w=new World(4,32,32,{sizeY:32,minY:0}),origin={x:10.5,y:10.5,z:10.5},dir={x:1,y:0,z:0};
const target={state:{x:12,y:10,z:10.5},connected:true,dead:false};
for(const id of VEGETATION_IDS){w.setBlock(11,10,10,id);assert.equal(raycastBlock(w,origin,dir,3,blocksAttack),null);assert(raycastPlayers(origin,dir,3,[target],{halfW:0.4,height:1}));const arrow=new Arrow(1,null,origin.x,origin.y,origin.z,40,0,0,1);assert.equal(arrow.step(w,[target])?.hit,target);}
// Exercise the actual authoritative melee action with a plant in front.
const game=new Game();game.world=w;game.tick=1;game.swing=()=>{};let hit=null;game.hurt=p=>{hit=p;};
game.mobs.set(1,target);target.state.vy=0;const attacker={state:{x:10.5,y:9,z:10.5,yaw:-Math.PI/2,pitch:0},nextAttackTick:0,attackStats:()=>({cooldown:1,damage:1})};
w.setBlock(11,10,10,BLOCK.FERN);game.stepAttack(attacker);assert.equal(hit,target,'melee missed mob in plants');
console.log('Decoration registry, creative coverage (village check), combat and arrow transparency passed.');
