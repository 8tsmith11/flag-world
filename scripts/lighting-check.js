import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { FACED } from '../shared/blocks.js';
import { World, chunkKey } from '../shared/world.js';
import { VoxelLighting } from '../shared/lighting.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { CHUNK_SIZE, LIGHTING as C } from '../shared/config.js';
const w=new World(1,96,96,{sizeY:128,minY:0});
for(let z=0;z<96;z++)for(let y=0;y<64;y++)w.setBlock(32,y,z,BLOCK.STONE);
w.setBlock(28,24,24,BLOCK.TORCH);
const l=new VoxelLighting(w);
for(let cy=0;cy<4;cy++)for(let cz=0;cz<4;cz++)for(let cx=0;cx<4;cx++)l.load(cx,cy,cz);
assert.equal(l.light(28,24,24),C.torchEmission);
assert.equal(l.light(33,24,24),0,'light crossed opaque wall');
assert.equal(l.light(31,24,24),C.torchEmission-3);
l.edit(28,24,24,BLOCK.AIR,BLOCK.TORCH);
assert([...l.buffers.values()].every(b=>b.light.every(v=>v===0)),'torch left residual light');
assert(l.lastDirty.size<=27,'single torch dirtied unrelated chunks');
l.edit(28,24,24,BLOCK.TORCH,BLOCK.AIR);
l.edit(32,24,24,BLOCK.AIR,BLOCK.STONE);
assert(l.light(33,24,24)>0,'opening did not relight');
l.edit(32,24,24,BLOCK.STONE,BLOCK.AIR);
assert.equal(l.light(33,24,24),0,'closing wall did not remove light');
// A thick island has exterior glow below it and a sealed, dark interior.
const islandWorld=new World(2,80,80,{sizeY:96,minY:-32});
for(let x=8;x<=71;x++)for(let z=8;z<=71;z++)for(let y=16;y<=64;y++)islandWorld.setBlock(x,y,z,BLOCK.STONE);
for(let x=28;x<=52;x++)for(let z=28;z<=52;z++)for(let y=30;y<=42;y++)islandWorld.setBlock(x,y,z,BLOCK.AIR);
const islandLight=new VoxelLighting(islandWorld);
const airAt=(lighting,x,y,z)=>{const b=lighting.load(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE));const i=((x%16+16)%16)+16*(((z%16+16)%16)+16*((y%16+16)%16));return [b.sky[i],b.void[i]];};
assert.deepEqual(airAt(islandLight,40,15,40),[0,Math.round(255*C.voidLevel/C.maxLevel)],'underside lacks void light');
assert.deepEqual(airAt(islandLight,40,65,40),[255,Math.round(255*C.voidLevel/C.maxLevel)],'direct sky lacks full light');
assert.deepEqual(airAt(islandLight,40,35,40),[0,0],'open-air light leaked into a sealed cave');
assert.deepEqual(airAt(islandLight,40,64,40),[0,0],'opaque block contains open-air light');
const voidLevel=Math.round(255*C.voidLevel/C.maxLevel);
assert.deepEqual(airAt(islandLight,40,-400,40),[0,voidLevel],'deep void chunk lacks light');
assert.deepEqual(airAt(islandLight,40,400,40),[255,voidLevel],'high air chunk lacks light');
assert.deepEqual(airAt(islandLight,-400,35,40),[255,voidLevel],'side air chunk lacks light');
// A straight side entrance must not make the whole cave a void source.
const tunnelWorld=World.fromData(structuredClone(islandWorld));
for(let x=8;x<=28;x++)tunnelWorld.setBlock(x,35,40,BLOCK.AIR);
const tunnel=new VoxelLighting(tunnelWorld);
assert(airAt(tunnel,8,35,40)[1]>0,'cave mouth did not receive exterior light');
assert.deepEqual(airAt(tunnel,40,35,40),[0,0],'straight cave became a direct exterior source');
// Remove a roof column: direct sky sources change well below the edit.
for(let y=43;y<=64;y++)islandLight.edit(40,y,40,BLOCK.AIR,BLOCK.STONE);
assert.equal(airAt(islandLight,40,31,40)[0],255,'roof opening did not update distant source cells');
assert.equal(airAt(islandLight,46,35,40)[0],0,'open-air flood exceeded configured reach');
islandLight.edit(40,64,40,BLOCK.STONE,BLOCK.AIR);
assert.deepEqual(airAt(islandLight,40,31,40),[0,0],'closing the roof left stale open-air light');
// Dirty loaded buffers must agree with a clean solve after boundary changes.
const fresh=new VoxelLighting(islandWorld);
for(const b of islandLight.buffers.values()){const expected=fresh.load(b.cx,b.cy,b.cz);assert.deepEqual(b.sky,expected.sky);assert.deepEqual(b.void,expected.void);}
for(let i=0;i<12;i++){l.edit(28,24,24,BLOCK.AIR,BLOCK.TORCH);l.edit(28,24,24,BLOCK.TORCH,BLOCK.AIR);}
l.edit(28,24,24,BLOCK.AIR,BLOCK.TORCH);
assert([...l.buffers.values()].every(b=>b.light.every(v=>v===0)),'rapid edits left stale light');
const game=new Game();game.world=new World(3,32,32,{sizeY:32,minY:0});
const drops=[];game.dropAt=item=>drops.push(item);
game.world.setBlock(16,16,16,BLOCK.STONE);game.world.setBlock(16,17,16,BLOCK.TORCH);
game.world.setBlock(15,16,16,FACED[BLOCK.TORCH][1]);
game.world.onBlockChanged=(x,y,z,id,oldId)=>{if(isSolid(oldId)&&!isSolid(id))game.dropUnsupported(x,y,z);};
game.breakBlock(16,16,16);
assert.equal(game.world.getBlock(16,17,16),BLOCK.AIR);assert.equal(game.world.getBlock(15,16,16),BLOCK.AIR);assert.deepEqual(drops,[BLOCK.TORCH,BLOCK.TORCH,BLOCK.STONE]);
const player={state:{x:16,y:16,z:16,yaw:0},inventory:{get:()=>({item:BLOCK.TORCH,count:10}),takeOne:()=>{}},selected:0};game.swing=()=>{};
game.world.setBlock(16,16,16,BLOCK.STONE);
game.stepPlace(player,{x:16,y:17,z:16,nx:0,ny:1,nz:0},0);assert.equal(game.world.getBlock(16,17,16),BLOCK.TORCH);
game.stepPlace(player,{x:15,y:16,z:16,nx:-1,ny:0,nz:0},0);assert.equal(game.world.getBlock(15,16,16),FACED[BLOCK.TORCH][1]);
game.stepPlace(player,{x:16,y:15,z:16,nx:0,ny:-1,nz:0},0);assert.equal(game.world.getBlock(16,15,16),BLOCK.AIR,'ceiling torch accepted');
game.world.setBlock(18,16,16,BLOCK.FERN);game.stepPlace(player,{x:18,y:17,z:16,nx:0,ny:1,nz:0},0);assert.equal(game.world.getBlock(18,17,16),BLOCK.AIR,'torch on non-solid accepted');
console.log('Lighting: opaque wall, removal, bounded dirty chunks, opening/closing, sky/void opacity, sealed caves, boundary-ray edits and clean-solve agreement passed.');
