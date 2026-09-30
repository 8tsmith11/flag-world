import assert from 'node:assert/strict';
import { BLOCK } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { placesThroughInteraction } from '../shared/interactions.js';
import { Game } from '../server/game.js';
import { World } from '../shared/world.js';
import { Inventory } from '../server/inventory.js';

assert.equal(placesThroughInteraction(true,BLOCK.STONE),true);
assert.equal(placesThroughInteraction(true,ITEM.LADDER),true);
assert.equal(placesThroughInteraction(false,BLOCK.STONE),false);
assert.equal(placesThroughInteraction(true,ITEM.BRONZE_SWORD),false);
assert.equal(placesThroughInteraction(true,null),false);

const game=new Game();game.world=new World(3,32,32,{sizeY:32,minY:0});
game.buildable=()=>true;game.inReach=()=>true;game.swing=()=>{};
const player={team:0,state:{x:8,y:7,z:8,yaw:0,vy:0},dead:false,inventory:new Inventory(),selected:0};
player.inventory.add(BLOCK.STONE,8);
for(const [i,id] of [BLOCK.FLUID_TANK,BLOCK.BOILER,BLOCK.CRUSHER,BLOCK.FLUID_PUMP,
  BLOCK.WORKBENCH,BLOCK.FURNACE,BLOCK.CHEST,BLOCK.ANVIL].entries()) {
  game.world.setBlock(4+i,8,8,id);
  game.stepPlace(player,{x:4+i,y:9,z:8,nx:0,ny:1,nz:0},0);
  assert.equal(game.world.getBlock(4+i,9,8),BLOCK.STONE,`could not place on ${id}`);
}
assert.equal(player.inventory.get(0),null);
console.log('OK: crouch placement selection and blocks placed on interactable tops');
