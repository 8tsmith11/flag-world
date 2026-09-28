// Acceptance coverage: geometry/physics, natural decay, real generated limbs,
// biome containment, grounded rock components, repeatability and timing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { generateWorld } from '../shared/worldgen.js';
import { World } from '../shared/world.js';
import { BLOCK, TREE_SIDES, branchBoxes, isSolid, isTargetable, getBlockDef } from '../shared/blocks.js';
import { creativeItemIds,getItemDef } from '../shared/items.js';
import { CREATIVE_RECIPES } from '../shared/recipes.js';
import { CHUNK_SIZE, TREE_SETTINGS as C } from '../shared/config.js';
import { Game } from '../server/game.js';
import { VoidEel } from '../server/eel.js';
import { Inventory } from '../server/inventory.js';
import { LeafDecay } from '../server/leafDecay.js';
import { raycastBlock } from '../shared/raycast.js';
import { createPlayerState,createInput,playerFitsAt,stepPlayer } from '../shared/physics.js';
import { growTree } from '../shared/trees.js';
import { structureAllowed } from '../shared/structures/place.js';
import { VoxelLighting } from '../shared/lighting.js';
const key=(x,y,z)=>`${x},${y},${z}`;
const hash=w=>{const h=createHash('sha256');for(const [k,c]of w.chunks){h.update(String(k));h.update(c.blocks);}h.update(w.biomeCodes);return h.digest('hex');};
const world=new World(1,96,96,{sizeY:128,minY:0}),decay=new LeafDecay(world);
world.onBlockChanged=(x,y,z,id,oldId)=>decay.changed(x,y,z,id,oldId);
world.setBlock(10,10,10,BLOCK.BRANCH);
assert.equal(branchBoxes(world,10,10,10).length,1);
assert.equal(getBlockDef(BLOCK.BRANCH).lightOpaque,false);
assert(creativeItemIds().includes(BLOCK.BRANCH));
assert(CREATIVE_RECIPES.some(r=>r.output===BLOCK.BRANCH));
assert.equal(getItemDef(BLOCK.BRANCH).icon,'/textures/branch.svg');
for(const [dx,dy,dz]of TREE_SIDES)world.setBlock(10+dx,10+dy,10+dz,BLOCK.WOOD);
assert.equal(branchBoxes(world,10,10,10).length,7);
for(const [dx,dy,dz]of TREE_SIDES)world.setBlock(10+dx,10+dy,10+dz,BLOCK.AIR);
assert.equal(raycastBlock(world,{x:9,y:10.1,z:10.1},{x:1,y:0,z:0},3,isTargetable),null,'ray hit empty branch corner');
const hit=raycastBlock(world,{x:9,y:10.5,z:10.5},{x:1,y:0,z:0},3,isTargetable);
assert(Math.abs(hit.t-(1+(1-C.branchWidth)/2))<1e-8);
assert(playerFitsAt(world,{x:10.1,y:10,z:10.1,box:{halfW:0.05,height:0.1}},10));
assert(!playerFitsAt(world,{x:10.5,y:10.4,z:10.5,box:{halfW:0.05,height:0.1}},10.4));
assert(VoidEel.prototype.clear(world,10,10.4,9.6),'eel hit empty space beside core');
assert(!VoidEel.prototype.clear(world,10.5,10.4,10.5),'eel passed through core');
// A falling item-sized body lands on the core, not on the enclosing voxel.
const falling=createPlayerState(10.5,11,10.5);falling.box={halfW:0.05,height:0.1};
for(let i=0;i<30;i++)stepPlayer(falling,createInput(),world);
assert(falling.onGround&&Math.abs(falling.y-(10+(1+C.branchWidth)/2))<0.001,'wrong thin landing surface');
// Cut the root of a long angled limb. A leaf route to a log must not support
// branches. Player foliage persists; logs never disappear through decay.
const w=new World(2,96,96,{sizeY:128,minY:0}),d=new LeafDecay(w);
w.onBlockChanged=(x,y,z,id,oldId)=>d.changed(x,y,z,id,oldId);
w.setBlock(5,8,5,BLOCK.WOOD);
for(let x=6;x<=16;x++)w.setBlock(x,8,5,BLOCK.BRANCH);
w.setBlock(16,9,5,BLOCK.BRANCH);w.setBlock(16,9,6,BLOCK.BRANCH);
for(let x=15;x<=17;x++)w.setBlock(x,10,6,BLOCK.LEAVES);
w.setBlock(17,9,6,BLOCK.BRANCH);d.placed(17,9,6,BLOCK.BRANCH);
w.setBlock(17,11,6,BLOCK.LEAVES);d.placed(17,11,6,BLOCK.LEAVES);
assert(d.hasWoodWithinReach(16,9,6));w.setBlock(6,8,5,BLOCK.AIR);
let ticks=0;while(d.pending.size||d.explorations.length){d.tick();assert(++ticks<1000,'decay did not finish');}
for(let x=7;x<=16;x++)assert.equal(w.getBlock(x,8,5),BLOCK.AIR,'detached branch survived');
assert.equal(w.getBlock(16,9,6),BLOCK.AIR);assert.equal(w.getBlock(15,10,6),BLOCK.AIR);
assert.equal(w.getBlock(17,9,6),BLOCK.BRANCH);assert.equal(w.getBlock(17,11,6),BLOCK.LEAVES);assert.equal(w.getBlock(5,8,5),BLOCK.WOOD);
// Authoritative placement marks both kinds of foliage, and replacement
// removes protection so a natural regrowth at that cell can decay later.
const placeWorld=new World(5,32,32,{sizeY:64,minY:0}),game=new Game();
game.world=placeWorld;game.leafDecay=new LeafDecay(placeWorld);game.inReach=()=>true;game.swing=()=>{};
placeWorld.onBlockChanged=(x,y,z,id,oldId)=>game.leafDecay.changed(x,y,z,id,oldId);
placeWorld.setBlock(8,7,8,BLOCK.STONE);
const player={state:createPlayerState(2,8,2),dead:false,inventory:new Inventory(),selected:0};
game.players.set(1,player);
for(const id of [BLOCK.BRANCH,BLOCK.LEAVES]) {
 player.inventory.add(id,1);game.stepPlace(player,{x:8,y:8,z:8,ny:1,nx:0,nz:0},0);
 assert.equal(placeWorld.getBlock(8,8,8),id);assert(game.leafDecay.placedBlocks.has('8,8,8'));
 placeWorld.setBlock(8,7,8,BLOCK.WOOD);placeWorld.setBlock(8,7,8,BLOCK.AIR);
 for(let i=0;i<5;i++)game.leafDecay.tick();assert.equal(placeWorld.getBlock(8,8,8),id,'placed foliage decayed');
 placeWorld.setBlock(8,8,8,BLOCK.AIR);assert(!game.leafDecay.placedBlocks.has('8,8,8'));
 placeWorld.setBlock(8,7,8,BLOCK.STONE);
}
// Leaves cannot carry branch support, even when they touch a real log.
w.setBlock(25,8,5,BLOCK.BRANCH);w.setBlock(26,8,5,BLOCK.LEAVES);w.setBlock(27,8,5,BLOCK.WOOD);
assert.equal(d.hasWoodWithinReach(25,8,5),false,'branch survived on a leaf-only route');
assert(d.hasWoodWithinReach(26,8,5),'leaves lost direct wood support');
// Exercise actual tree shapes and hollow walk-in bases on a flat test plot.
const plot=new World(3,96,96,{sizeY:128,minY:0});
for(let x=0;x<96;x++)for(let z=0;z<96;z++)plot.setBlock(x,4,z,BLOCK.GRASS);
assert(growTree(plot,40,4,40,28,{seed:7,species:'ancient',width:4,hollow:true}));
assert(playerFitsAt(plot,{x:41.5,y:5,z:41.5},5),'hollow cannot hold a player');
assert(playerFitsAt(plot,{x:41.5,y:5,z:40.5},5),'hollow entrance blocked');
const roof=new VoxelLighting(plot).load(2,0,2),i=(41%16)+16*((41%16)+16*5);
assert(roof.sky[i]<255,'hollow base receives direct daylight');
console.log('Branch geometry, prediction physics, creative item, hollow and decay checks passed');
const size=process.argv.includes('--large')?'large':'small',teams=process.argv.includes('--large')?4:2;
const baselinePath=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11)??'/tmp/trees-before.json';
const baseline=size==='large'&&existsSync(baselinePath)?JSON.parse(readFileSync(baselinePath,'utf8')):null,results=[];
for(const seed of [1,2,3]) {
  const start=performance.now(),w=generateWorld(seed,teams,size),ms=performance.now()-start;
  const branches=new Map(),foliage=new Map();
  for(const chunk of w.chunks.values())for(let i=0;i<chunk.blocks.length;i++) {
    const id=chunk.blocks[i];if(id!==BLOCK.BRANCH&&id!==BLOCK.LEAVES)continue;
    const x=chunk.cx*CHUNK_SIZE+i%CHUNK_SIZE,y=chunk.cy*CHUNK_SIZE+Math.floor(i/(CHUNK_SIZE*CHUNK_SIZE)),z=chunk.cz*CHUNK_SIZE+Math.floor(i/CHUNK_SIZE)%CHUNK_SIZE;
    const p={x,y,z,id};foliage.set(key(x,y,z),p);if(id===BLOCK.BRANCH)branches.set(key(x,y,z),p);
  }
  function connected(cells) {
    const reached=new Map(),queue=[];
    for(const [k,p]of cells)if(TREE_SIDES.some(([dx,dy,dz])=>w.getBlock(p.x+dx,p.y+dy,p.z+dz)===BLOCK.WOOD)){reached.set(k,1);queue.push(p);}
    for(let head=0;head<queue.length;head++) {
      const p=queue[head],dist=reached.get(key(p.x,p.y,p.z));if(dist>=C.decayReach)continue;
      for(const [dx,dy,dz]of TREE_SIDES){const k=key(p.x+dx,p.y+dy,p.z+dz),next=cells.get(k);if(next&&!reached.has(k)){reached.set(k,dist+1);queue.push(next);}}
    }
    for(const k of cells.keys())assert(reached.has(k),`seed ${seed}: tree cell ${k} lacks a log within decay reach`);
  }
  connected(branches);connected(foliage);assert(branches.size>0,'no branches generated');
  let ancientCells=0;
  for(let z=0;z<w.sizeZ;z++)for(let x=0;x<w.sizeX;x++) {
    const biome=w.biomeAt(x,z);
    if(biome==='ancientForest'){ancientCells++;assert.equal(w.regularForest[x+w.sizeX*z],1,'ancient forest has no regular forest host');}
    if(biome==='ancientForest')assert(structureAllowed(w,{x0:x,x1:x,z0:z,z1:z}),'biome in reserve');
  }
  assert(ancientCells>0,'missing ancient biome');
  const digest=hash(w);assert.equal(digest,hash(generateWorld(seed,teams,size)),'repeat seed differs');
  const before=baseline?.find(r=>r.seed===seed)?.ms,ratio=before?ms/before:null;
  const result={seed,size,teams,ms,baselineMs:before,ratio,branches:branches.size,ancientCells,treeMs:w.treeGenerationMs,trees:w.trees.length,ancientTrees:w.trees.filter(t=>t.species==='ancient').length,hollow:w.trees.filter(t=>t.hollow).length,hash:digest};
  results.push(result);console.log(JSON.stringify(result));
  if(ratio)assert(ratio<=1.2,`seed ${seed}: generation exceeds 20% budget (${ratio})`);
}
writeFileSync(`/tmp/trees-${size}-after.json`,JSON.stringify(results,null,2));
