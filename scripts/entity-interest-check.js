import assert from 'node:assert/strict';
import { EntityInterest } from '../server/entityInterest.js';

const dragon={id:7,dead:false,state:{x:10,y:30,z:10},snapshot(){return {id:this.id,x:this.state.x,y:this.state.y,z:this.state.z};}};
const dragons=new Map([[dragon.id,dragon]]),empty=new Map();
let loaded=true;
const game={mobs:empty,cows:empty,dragons,npcs:empty,tick:1,
  chunkLoading:{has:()=>loaded}};
const player={state:{x:10,y:5,z:10}};
const interest=new EntityInterest();
interest.collect(game);
let updates=[];interest.forPlayer(game,player,updates);
assert.equal(updates.length,1);
assert.equal(updates[0].id,dragon.id);
loaded=false;game.tick++;interest.collect(game);
updates=[];interest.forPlayer(game,player,updates);
assert.deepEqual(updates,[{id:dragon.id,unloaded:true}]);
game.tick++;updates=[];interest.forPlayer(game,player,updates);
assert.equal(updates.length,0,'Sleeping dragon sent repeated unload messages');
loaded=true;game.tick++;updates=[];interest.forPlayer(game,player,updates);
assert.equal(updates.length,1,'Reactivated dragon did not receive a fresh pose');
assert.equal(updates[0].unloaded,undefined);
console.log('OK: sleeping dragons unload once and reappear on activation');
