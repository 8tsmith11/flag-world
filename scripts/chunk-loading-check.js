import assert from 'node:assert/strict';
import { ChunkLoading } from '../server/chunkLoading.js';
import { World } from '../shared/world.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { dragonSurface, invalidateDragonSurface } from '../server/dragonSurface.js';
import { EntityInterest } from '../server/entityInterest.js';
import { WaterSimulation } from '../server/water.js';
import { SaplingGrowth } from '../server/saplings.js';
import { mulberry32 } from '../shared/structures.js';
import { Game } from '../server/game.js';
import { Arrow } from '../server/arrow.js';
import { RiftOrbProjectile } from '../server/riftOrb.js';

const world=new World(1,1024,1024,{sizeY:253,minY:-23});
world.islands=[{kind:'team',x:96,z:96,radius:45},{kind:'center',x:500,z:500,radius:210}];
const loader=new ChunkLoading();loader.configure(world);
assert.ok(loader.has(96,96));assert.ok(loader.has(96+45,96));assert.ok(!loader.has(500,500));
const map=loader.entityMap(),near={id:1,state:{x:96,y:70,z:96}},far={id:2,state:{x:500,y:80,z:500}};
map.set(1,near);map.set(2,far);assert.deepEqual([...map.activeValues()],[near]);
for(let i=3;i<=10002;i++)map.set(i,{id:i,state:{x:700+i%200,y:20,z:700+Math.floor(i/200)%200}});
assert.equal(map.active.size,1,'Distant population enters per-tick work');
const player={id:99,connected:true,dead:false,state:{x:500,y:80,z:500}};
loader.update([player]);assert.equal(map.active.size,2);
far.state.x=900;far.state.z=900;map.relocate(far);assert.equal(map.active.size,1);
loader.update([]);assert.equal(map.active.size,1);assert.equal(map.get(2),far,'Unloading deleted an entity');
loader.update([{...player,state:{x:900,y:50,z:900}}]);assert.ok(map.active.has(far));
map.delete(2);assert.equal(map.active.has(far),false);assert.equal([...map.nearbyValues({x:96,z:96},10)].length,1);
const previous=loader.loaded;loader.update([{...player,state:{x:900.5,y:70,z:900.5}}]);assert.equal(loader.loaded,previous,'Same chunk rebuilt tickets');

// Sparse column lookup is identical across partial top/bottom chunks and edits.
const random=mulberry32(4);
for(let i=0;i<1500;i++)world.setBlock(Math.floor(random()*30),Math.floor(random()*276)-23,Math.floor(random()*30),random()<.25?BLOCK.LEAVES:BLOCK.STONE);
const naive=(x,z,predicate)=>{for(let y=world.sizeY-1;y>=world.minY;y--)if(predicate(world.getBlock(x,y,z)))return y;return -1;};
for(let z=0;z<32;z++)for(let x=0;x<32;x++)for(const predicate of [isSolid,id=>id===BLOCK.STONE,id=>id===BLOCK.AIR])assert.equal(world.getSurfaceY(x,z,predicate),naive(x,z,predicate));
for(const [x,z]of [[-1,0],[1024,1]])assert.equal(world.getSurfaceY(x,z,isSolid),-1);
world.onBlockChanged=(x,y,z)=>invalidateDragonSurface(world,x,z);
world.setBlock(45,20,45,BLOCK.GRASS);assert.equal(dragonSurface(world,45,45),20);
world.setBlock(45,190,45,BLOCK.STONE);assert.equal(dragonSurface(world,45,45),190);
world.setBlock(45,190,45,BLOCK.AIR);assert.equal(dragonSurface(world,45,45),20);
world.setBlock(45,20,45,BLOCK.AIR);assert.equal(dragonSurface(world,45,45),-1);

// Water queues remain pending while unloaded and resume on a ticket change.
const water=new WaterSimulation(world,loader);let flows=0;water.updateCell=()=>flows++;
water.enqueue(96,20,96);water.enqueue(500,20,500);water.tick(3);
assert.equal(flows,1);assert.equal(water.pending.size,1);
loader.update([player]);water.tick(6);assert.equal(flows,2);assert.equal(water.pending.size,0);
const growth=new SaplingGrowth(world,()=>false,()=>.05,loader);let trees=0;
growth.canGrow=()=>{trees++;return false;};world.setBlock(800,20,800,BLOCK.SAPLING);growth.planted(800,20,800,0);
growth.tick(1);assert.equal(trees,0);assert.equal(growth.sleeping.size,1);
loader.update([{...player,state:{x:800,y:20,z:800}}]);growth.tick(2);growth.tick(3);assert.equal(trees,1);

// Replication visits active entities only and resumes their latest state.
near.dead=false;near.snapshot=()=>({id:near.id,x:near.state.x,y:near.state.y,z:near.state.z});
const interest=new EntityInterest(),empty=loader.entityMap(),game={tick:1,mobs:empty,cows:empty,dragons:empty,npcs:map,chunkLoading:loader};
// Use a separate index so synthetic distant populations need no snapshot methods.
game.npcs=loader.entityMap();game.npcs.set(1,near);const result=[];
interest.collect(game);interest.forPlayer(game,player,result);assert.equal(result.length,1);
near.state.x=400;near.state.z=400;game.npcs.relocate(near);interest.collect(game);assert.equal(interest.snapshots.size,0);
loader.update([{...player,state:{x:400,y:20,z:400}}]);interest.collect(game);assert.equal(interest.snapshots.size,1);
// Projectiles keep coordinates directly; mobs/items use their physics state.
// Exercise the real Game handlers so both representations are indexed safely.
const match=new Game();match.world=new World(1,64,64,{sizeY:32,minY:0});
match.world.islands=[{kind:'team',x:32,z:32,radius:25}];match.chunkLoading.configure(match.world);
for(let x=0;x<64;x++)for(let z=0;z<64;z++)match.world.setBlock(x,4,z,BLOCK.GRASS);
const arrow=new Arrow(1,{team:0},31,8,32,20,0,0,1),orb=new RiftOrbProjectile(2,{},31,8,34,{x:1,y:0,z:0});
match.arrows.set(1,arrow);match.riftOrbs.set(2,orb);match.nextId=3;
match.spawnItem(BLOCK.WOOD,1,31,8,36,20,0,0,1);
for(let i=0;i<4;i++){match.updateArrows();match.updateRiftOrbs();match.updateItems();}
assert.ok(arrow.x>32&&orb.x>32&&match.items.get(3).state.x>32);
for(const m of [match.arrows,match.riftOrbs,match.items])assert.ok([...m.columns.values()].every(k=>k.startsWith('2,')),'Moving projectile/item index did not follow its chunk');
console.log('OK: always-loaded team islands, bounded active population, movement/unload/reload, sparse surface parity/edit invalidation, dormant water/saplings, replication and projectile/item physics');
