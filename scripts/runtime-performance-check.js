// Actual match ticks, with the same seed and two teams across world sizes.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { TEAMS } from '../shared/protocol.js';
import { MOB_EGGS } from '../shared/mobEggs.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { dragonSurface } from '../server/dragonSurface.js';

const sizes=process.argv.slice(2).filter(s=>['small','medium','large'].includes(s));
for(const size of sizes.length?sizes:['medium','large']) {
  const game=new Game();game.worldSize=size;game.hostId=1;game.nextId=3;
  const socket={readyState:1,send:()=>{}};
  for(let i=1;i<=2;i++)game.members.set(i,{id:i,name:`Test ${i}`,team:i-1,color:TEAMS[i-1].color,ready:true,
    session:{socket,creative:false,localHost:true}});
  const started=performance.now();game.startMatch(game.members.get(1),{seed:'1'});
  const generationMs=performance.now()-started;
  assert.ok(game.world);assert.ok(game.monkeys);
  const world=game.world,spawns=[...game.npcs.values()].filter(e=>e.npc==='workMonkey');
  assert.ok(spawns.length>=2,'Working monkeys failed to spawn on team islands');
  game.chunkLoading.update(game.players.values());
  const totals={cows:game.cows.size,dragons:game.dragons.size,mobs:game.mobs.size,monkeys:spawns.length};
  const dormant=[...game.dragons.values()].filter(e=>!game.dragons.active.has(e));
  const positions=dormant.map(e=>({...e.state}));
  const names=spawns.map(e=>e.name);
  const times=[],parts={};
  for(const method of ['updateItems','updateArrows','updateCows','updateDragons','updateMobs','updateNpcs','updateContainers']) {
    const original=game[method].bind(game);
    game[method]=(...args)=>{const t=performance.now(),result=original(...args);parts[method]=(parts[method]??0)+performance.now()-t;return result;};
  }
  for(let i=0;i<240;i++) {const t=performance.now();game.update();if(i>=40)times.push(performance.now()-t);}
  for(let i=0;i<dormant.length;i++)assert.deepEqual(dormant[i].state,positions[i],'Dormant dragon still simulated');
  assert.deepEqual(spawns.map(e=>e.name),names,'Monkey names changed');
  // Compare the original column scan to sparse lookup and repeat queries from
  // actual dragon patrol areas, including empty columns between islands.
  const columns=[...game.dragons.values()].flatMap(d=>Array.from({length:150},(_,i)=>({x:Math.floor(d.home.x+Math.cos(i*.08)*20),z:Math.floor(d.home.z+Math.sin(i*.08)*20)})));
  for(let i=0;i<200;i++)columns.push({x:Math.floor(world.sizeX*.5)+i,z:5});
  const naive=(x,z)=>{for(let y=world.sizeY-1;y>=world.minY;y--)if(isSolid(world.getBlock(x,y,z)))return y;return -1;};
  const query=fn=>{const t=performance.now();const values=[];for(let j=0;j<8;j++)for(const p of columns)values.push(fn(p.x,p.z));return {ms:performance.now()-t,values};};
  const before=query(naive),sparse=query((x,z)=>world.getSurfaceY(x,z,isSolid)),cached=query((x,z)=>dragonSurface(world,x,z));
  assert.deepEqual(sparse.values,before.values);assert.deepEqual(cached.values,before.values);
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({size,generationMs:Math.round(generationMs),
    totals,active:{cows:game.cows.active.size,dragons:game.dragons.active.size,mobs:game.mobs.active.size,npcs:game.npcs.active.size},
    tickMeanMs:times.reduce((a,b)=>a+b,0)/times.length,tickP95Ms:times[Math.floor(times.length*.95)],tickMaxMs:times.at(-1),
    systemMeanMs:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v/240])),
    surfaceQueries:before.values.length,surfaceBeforeMs:before.ms,surfaceSparseMs:sparse.ms,surfaceCachedMs:cached.ms}));

  // Hatch every egg through the authoritative handler with real constructors.
  // A temporary flat patch gives the large Ancient Monkey enough clearance.
  const host=game.players.get(1),x=Math.floor(host.state.x),z=Math.floor(host.state.z),y=Math.floor(host.state.y)-1;
  for(let dx=-5;dx<=5;dx++)for(let dz=-5;dz<=5;dz++) {
    world.setBlock(x+dx,y,z+dz,BLOCK.GRASS);
    for(let dy=1;dy<=15;dy++)world.setBlock(x+dx,y+dy,z+dz,BLOCK.AIR);
  }
  host.creative=true;
  for(const egg of MOB_EGGS) {
    host.inventory.slots[0]={item:egg.item,count:1};
    const maps=[game.cows,game.dragons,game.mobs,game.npcs],old=new Set(maps.flatMap(m=>[...m.keys()]));
    game.stepSpawnEgg(host,{x,y,z},0);
    const fresh=maps.flatMap(m=>[...m.values()]).filter(e=>!old.has(e.id));
    assert.equal(fresh.length,1,`Failed to hatch ${egg.name} in ${size}`);
    assert.equal(fresh[0].type,egg.type);if(egg.npc)assert.equal(fresh[0].npc,egg.npc);
    assert.equal(host.inventory.slots[0],null);
  }
  console.log(`OK: ${size} dormant dragons, team monkey spawning and all ${MOB_EGGS.length} actual creative egg constructors`);
}
