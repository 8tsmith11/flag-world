// Start a real Small match and verify discovery reaches only the right team.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS, S2C } from '../shared/protocol.js';
import { ITEM } from '../shared/itemIds.js';

const game = new Game();
game.worldSize = 'small';
game.hostId = 1;
game.nextId = 4;
const messages = new Map();
for (const [id, team] of [[1,0],[2,0],[3,1]]) {
  const received=[];
  messages.set(id,received);
  const socket={readyState:1,send:data=>received.push(JSON.parse(data))};
  game.members.set(id,{id,name:`Recipe ${id}`,team,color:TEAMS[team].color,ready:true,
    session:{socket,creative:false,localHost:true}});
}
game.startMatch(game.members.get(1),{seed:'recipe-browser-check'});
assert.equal(game.phase,'playing');
for(const received of messages.values())assert.deepEqual(received.find(m=>m.type===S2C.WELCOME).teamObtained,[]);
game.players.get(1).inventory.add(ITEM.COPPER_INGOT,1);
game.players.get(1).inventoryDirty=true;
game.update();
for(const id of [1,2])assert.ok(messages.get(id).some(m=>m.type===S2C.TEAM_OBTAINED
  &&m.items.includes(ITEM.COPPER_INGOT)),`team member ${id} missed discovery`);
assert.equal(messages.get(3).some(m=>m.type===S2C.TEAM_OBTAINED),false);
assert.ok(game.teamProgress.of(0).obtained.has(ITEM.COPPER_INGOT));
assert.equal(game.teamProgress.of(1).obtained.has(ITEM.COPPER_INGOT),false);
console.log('OK: match pickup updates team recipe discovery without leaking to opponents');
