import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { MOB_EGGS } from '../shared/mobEggs.js';
import { NPC_DEFS } from '../shared/npcs.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { CREATIVE_RECIPES, FUEL, SMELTING } from '../shared/recipes.js';
import { MONKEY_WORK as C, SMELT_TIME, TICK_RATE } from '../shared/config.js';
import { defaultMonkeyConfig } from '../shared/monkeys.js';
import { MonkeyTaming } from '../server/monkeyTaming.js';
import { MonkeyWorkers, WorkMonkey } from '../server/monkeyWorkers.js';
import { Furnace, Chest, INPUT, OUTPUT, FUEL_SLOT } from '../server/containers.js';
import { Inventory } from '../server/inventory.js';
import { mulberry32 } from '../shared/structures.js';
import { createPlayerState, stepPlayer } from '../shared/physics.js';
import { Game } from '../server/game.js';
import { SaplingGrowth } from '../server/saplings.js';

assert.equal(SMELTING[BLOCK.WOOD], ITEM.CHARCOAL);
assert.equal(SMELTING[BLOCK.SAND], BLOCK.GLASS);
assert.equal(FUEL[ITEM.CHARCOAL], 8);
for (const [input, output] of [[BLOCK.WOOD, ITEM.CHARCOAL], [BLOCK.SAND, BLOCK.GLASS]]) {
  const furnace = new Furnace();
  furnace.slots[INPUT] = { item: input, count: 9 };
  furnace.slots[FUEL_SLOT] = { item: ITEM.CHARCOAL, count: 1 };
  for (let i = 0; i < SMELT_TIME * TICK_RATE * 9; i++) furnace.tick();
  assert.deepEqual(furnace.slots[OUTPUT], { item: output, count: 8 });
  assert.equal(furnace.slots[INPUT].count, 1);
  assert.equal(furnace.slots[FUEL_SLOT], null);
}
const creatures = Object.values(ENTITY_TYPE).filter(type => !['player','item','arrow','riftOrb','grenade','npc','airship'].includes(type));
assert.equal(new Set(MOB_EGGS.map(e => e.item)).size, MOB_EGGS.length);
for (const type of creatures) assert.ok(MOB_EGGS.some(e => e.type === type), `No egg for ${type}`);
for (const npc of Object.keys(NPC_DEFS).filter(n => n !== 'skyMerchant')) assert.ok(MOB_EGGS.some(e => e.npc === npc), `No egg for ${npc}`);
for (const egg of MOB_EGGS) {
  assert.equal(getItemDef(egg.item).shape, 'egg');
  assert.ok(CREATIVE_RECIPES.some(r => r.output === egg.item));
}
for (const id of [ITEM.CHARCOAL,BLOCK.GLASS]) assert.ok(CREATIVE_RECIPES.some(r => r.output === id));

const random = mulberry32(17);
for (const kind of ['simon','memory','cups']) {
  const game = new MonkeyTaming(1, {}, {}, 10, random, kind);
  assert.equal(game.action('cup',0,game.expires),'expired');
  if (kind === 'simon') {
    assert.equal(game.action('simon',game.sequence[0],10),'waiting');
    assert.equal(game.action('simon','invalid',game.ready),'invalid');
    for (let i=0;i<game.sequence.length;i++) assert.equal(game.action('simon',game.sequence[i],game.ready+i),i===game.sequence.length-1?'won':'playing');
    const lose = new MonkeyTaming(2,{}, {},10,random,kind);
    assert.equal(lose.action('simon',lose.sequence[0]==='jump'?'crouch':'jump',lose.ready),'lost');
  } else if (kind === 'memory') {
    assert.ok(game.view(10).cards.every(v => v === null));
    const wrong=game.cards.findIndex(v=>v!==game.cards[0]);
    assert.equal(game.action('card',0,10),'playing');assert.equal(game.action('card',0,10),'invalid');
    game.action('card',wrong,10);assert.equal(game.action('card',1,11),'invalid');
    assert.ok(game.view(10+C.cardRevealTicks).cards.every(v=>v===null));
    for(let face=0;face<C.cardPairs;face++) {
      const pair=game.cards.flatMap((v,i)=>v===face?[i]:[]);
      game.action('card',pair[0],100);assert.equal(game.action('card',pair[1],100),face===C.cardPairs-1?'won':'playing');
    }
  } else {
    assert.equal(game.action('cup',game.finalBall,10),'waiting');
    assert.equal('finalBall' in game.view(game.ready),false);
    assert.equal(game.action('cup',(game.finalBall+1)%3,game.ready),'lost');
    assert.equal(game.action('cup',game.finalBall,game.ready),'won');
  }
}

function fixture() {
  const world=new World(1,64,64,{sizeY:80,minY:-16});
  for(let x=0;x<64;x++)for(let z=0;z<64;z++)world.setBlock(x,4,z,BLOCK.GRASS);
  const sent=[],dropped=[];
  const game={world,seed:1,tick:0,nextId:1,npcs:new Map(),items:new Map(),players:new Map(),
    send:(p,msg)=>sent.push({player:p.id,...msg}),removeItem:e=>game.items.delete(e.id),
    stowCursor:p=>{const left=p.inventory.stowCursor();assert.equal(left,null);p.inventoryDirty=true;},
    spawnItem:(item,count,x,y,z,vx,vy,vz,delay,mods)=>dropped.push({item,count,x,y,z,mods})};
  const workers=new MonkeyWorkers(game,mulberry32(5)),monkey=new WorkMonkey(game.nextId++,workers,{x:20.5,y:5,z:20.5});
  game.npcs.set(monkey.id,monkey);world.onBlockChanged=(x,y,z)=>workers.changed(x,y,z);
  const player={id:10,team:0,connected:true,dead:false,state:createPlayerState(20.5,5,21),inventory:new Inventory()};
  const friend={...player,id:11,inventory:new Inventory()},enemy={...player,id:12,team:1,inventory:new Inventory()};
  for(const p of [player,friend,enemy])game.players.set(p.id,p);
  return {world,game,workers,monkey,player,friend,enemy,sent,dropped};
}
// Runs the monkey for up to `ticks` until done() holds.
function run(world,game,workers,monkey,ticks,done=()=>false) {
  for(let i=0;i<ticks;i++){game.tick++;workers.beginTick();monkey.step(world,[],game.tick);if(done())return true;}
  return false;
}
function container(world,p,c,id=BLOCK.CHEST){world.setBlock(p.x,p.y,p.z,id);world.tileEntities.set(`${p.x},${p.y},${p.z}`,c);return c;}
{
  const {game,workers,monkey,player,friend,enemy,sent}=fixture(),name=monkey.name;
  workers.open(player,monkey);
  const session=workers.sessions.get(player.id);
  workers.action(enemy,{id:monkey.id,session:session.id,action:'cup',value:0});
  assert.equal(monkey.team,null,'Another player submitted the taming session');
  game.tick=session.ready;
  if(session.kind==='simon')for(const value of session.sequence) {
    Object.assign(player.state,{onGround:true,vy:value==='jump'?6:0,crouching:value==='crouch'});
    workers.playerInput(player,{jump:value==='jump',crouch:value==='crouch'},true);
    workers.playerInput(player,{jump:false,crouch:false},false);
  }
  if(session.kind==='cups')workers.action(player,{id:monkey.id,session:session.id,action:'cup',value:session.finalBall});
  if(session.kind==='memory')for(let f=0;f<C.cardPairs;f++)for(const i of session.cards.flatMap((v,i)=>v===f?[i]:[]))workers.action(player,{id:monkey.id,session:session.id,action:'card',value:i});
  assert.equal(monkey.team,player.team);assert.equal(monkey.name,name);
  workers.open(friend,monkey);assert.equal(sent.at(-1).editable,true);
  const config={...defaultMonkeyConfig(),role:'collector',dests:[{x:20,y:5,z:20}]};
  workers.action(enemy,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,0);
  workers.action(friend,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,1);
  workers.action(player,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,1,'Stale settings overwrote teammate');
  assert.equal(workers.parseConfig({...config,radius:25}),null);
  assert.equal(workers.parseConfig({...config,quarry:{...config.quarry,depth:0}}),null);
  assert.equal(workers.parseConfig({...config,dests:Array.from({length:9},(_,i)=>({x:i,y:5,z:1}))}),null);
  workers.open(player,monkey);
  // Gear: hammers go in the tool slot, armor in the armor slot, nothing else.
  player.inventory.add(ITEM.STONE_HAMMER,1);player.inventory.add(ITEM.LEATHER_ARMOR,1);player.inventory.add(BLOCK.DIRT,4);
  workers.action(player,{id:monkey.id,action:'inventory',grid:'player',slot:0,button:'left',shift:true});
  workers.action(player,{id:monkey.id,action:'inventory',grid:'player',slot:1,button:'left',shift:true});
  assert.equal(monkey.gear[0]?.item,ITEM.STONE_HAMMER);assert.equal(monkey.gear[1]?.item,ITEM.LEATHER_ARMOR);
  workers.action(player,{id:monkey.id,action:'inventory',grid:'player',slot:2,button:'left'});
  workers.action(player,{id:monkey.id,action:'inventory',grid:'gear',slot:0,button:'left'});
  assert.equal(monkey.gear[0]?.item,ITEM.STONE_HAMMER,'Dirt went into the tool slot');
  assert.equal(monkey.snapshot().tool,ITEM.STONE_HAMMER);
  workers.action(player,{id:monkey.id,action:'close'});
  Game.prototype.talk.call({...game,cows:new Map(),monkeys:workers},player,monkey.id);
  assert.equal(player.monkeyViewing,monkey.id);
  workers.action(player,{id:monkey.id,action:'close'});
  Game.prototype.talk.call({...game,cows:new Map(),monkeys:workers},player,monkey.id);
  assert.equal(sent.at(-1).mode,'configure','Talk cooldown prevented reopening');
}
{
  const {game,workers,monkey,player,friend,enemy}=fixture();monkey.team=0;
  workers.open(player,monkey);workers.open(friend,monkey);
  const mods=[{id:'damage',value:2}];player.inventory.add(ITEM.IRON_SWORD,1,mods);player.inventory.add(BLOCK.DIRT,1);
  workers.action(player,{id:monkey.id,action:'inventory',grid:'player',slot:1,button:'left',shift:true});
  workers.action(player,{id:monkey.id,action:'inventory',grid:'player',slot:0,button:'left',shift:true});
  assert.deepEqual(monkey.gear[0].mods,mods);
  workers.action(enemy,{id:monkey.id,action:'inventory',grid:'gear',slot:0,button:'left'});
  assert.deepEqual(monkey.gear[0].mods,mods,'Enemy took stored gear');
  workers.action(friend,{id:monkey.id,action:'inventory',grid:'gear',slot:0,button:'left'});
  assert.deepEqual(friend.inventory.cursor.mods,mods);
  workers.action(friend,{id:monkey.id,action:'close'});
  assert.deepEqual(friend.inventory.slots[0].mods,mods,'Closing discarded cursor gear');
}
{
  const {world,game,workers,monkey,player}=fixture();
  const session=new MonkeyTaming(1,monkey,player,0,()=>0.25,'simon');
  session.sequence=['jump','crouch','jump','crouch','crouch'];workers.sessions.set(player.id,session);
  assert.equal('sequence' in session.view(0),false,'Simon leaked its answers');
  let jumped=false,crouched=false;
  for(game.tick=1;game.tick<session.ready;game.tick++) {
    workers.beginTick();monkey.step(world,[player],game.tick);
    jumped ||= monkey.state.y>5.1;crouched ||= monkey.pose==='crouch';
  }
  assert.ok(jumped&&crouched,'Monkey did not demonstrate movement in the world');
}
{
  // Courier: two sources, two destinations taking turns.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const s1={x:12,y:5,z:20},s2={x:12,y:5,z:24},d1={x:24,y:5,z:20},d2={x:24,y:5,z:24};
  const a=container(world,s1,new Chest()),b=container(world,s2,new Chest());
  const da=container(world,d1,new Chest()),db=container(world,d2,new Chest());
  a.slots[0]={item:BLOCK.DIRT,count:32};b.slots[0]={item:BLOCK.SAND,count:32};
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'courier',sources:[s1,s2],dests:[d1,d2]});assert.ok(monkey.config);
  run(world,game,workers,monkey,4000,()=>!a.slots[0]&&!b.slots[0]&&!monkey.inventory.slots.some(Boolean));
  const total=c=>c.slots.reduce((n,s)=>n+(s?.count??0),0);
  assert.equal(total(da)+total(db),64,'Courier lost or kept items');
  assert.ok(total(da)>0&&total(db)>0,'Courier did not take turns between destinations');
}
{
  // Idle without work: no walking back and forth.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const src={x:12,y:5,z:20},dst={x:24,y:5,z:20};container(world,src,new Chest());container(world,dst,new Chest());
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'courier',sources:[src],dests:[dst]});
  const start={...monkey.state};
  run(world,game,workers,monkey,600);
  assert.ok(Math.hypot(monkey.state.x-start.x,monkey.state.z-start.z)<0.5,'Idle courier wandered');
  assert.equal(monkey.status,'Waiting for source items');
}
{
  // Lumberjack: the whole leaning tree comes down, leaves left to decay; replants.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const site={x:22,y:5,z:20},dst={x:18,y:5,z:20};container(world,dst,new Chest());
  for(let y=5;y<=9;y++)world.setBlock(22,y,20,BLOCK.WOOD);
  for(let y=9;y<=12;y++)world.setBlock(23,y,20,BLOCK.WOOD);
  world.setBlock(23,13,20,BLOCK.LEAVES);world.setBlock(21,8,20,BLOCK.BRANCH);
  monkey.inventory.add(ITEM.TREE_SEED,1);
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'lumberjack',sites:[site],dests:[dst]});
  run(world,game,workers,monkey,3000,()=>world.getBlock(site.x,site.y,site.z)===BLOCK.SAPLING);
  assert.equal(world.getBlock(23,12,20),BLOCK.AIR,'Leaning trunk left standing');
  assert.equal(world.getBlock(21,8,20),BLOCK.AIR,'Branch left standing');
  assert.equal(world.getBlock(site.x,site.y,site.z),BLOCK.SAPLING,'Lumberjack did not replant');
  run(world,game,workers,monkey,2000,()=>!monkey.inventory.slots.some(s=>s?.item===BLOCK.WOOD));
  const chest=world.tileEntities.get('18,5,20');
  assert.equal(chest.slots.reduce((n,s)=>n+(s?.item===BLOCK.WOOD?s.count:0),0),10,'Wood not delivered');
}
{
  // Quarry: digs a pit with its tool, never opens a hole to the void, climbs out.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  for(let x=10;x<=30;x++)for(let z=10;z<=30;z++)for(let y=0;y<4;y++)world.setBlock(x,y,z,BLOCK.STONE);
  const dst={x:20,y:5,z:12};container(world,dst,new Chest());
  monkey.gear[0]={item:ITEM.STONE_HAMMER,count:1};
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'quarry',cornerA:{x:18,y:4,z:18},cornerB:{x:20,y:4,z:20},
    dests:[dst],quarry:{shape:'box',axis:'down',depth:6,radius:3,returnAt:16}});
  assert.ok(monkey.config);
  run(world,game,workers,monkey,12000,()=>monkey.status==='Quarry finished'&&!monkey.inventory.slots.some(Boolean));
  let dug=0;for(let x=18;x<=20;x++)for(let z=18;z<=20;z++)for(let y=0;y<=4;y++)if(world.getBlock(x,y,z)===BLOCK.AIR)dug++;
  assert.equal(dug,36,`Quarry dug ${dug} of 36 (bottom layer must stay)`);
  for(let x=18;x<=20;x++)for(let z=18;z<=20;z++)assert.equal(world.getBlock(x,-1,z),BLOCK.AIR);
  for(let x=18;x<=20;x++)for(let z=18;z<=20;z++)assert.notEqual(world.getBlock(x,-0,z),BLOCK.STONE===0?1:BLOCK.AIR,'Opened the void');
  assert.ok(monkey.state.y>=4.9,'Quarry monkey stayed in its pit');
  const chest=world.tileEntities.get('20,5,12');
  assert.ok(chest.slots.reduce((n,s)=>n+(s?.count??0),0)>=36,'Mined blocks not delivered');
}
{
  // Quarry without a strong enough tool can't break stone.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  for(let x=18;x<=20;x++)for(let z=18;z<=20;z++){world.setBlock(x,3,z,BLOCK.STONE);world.setBlock(x,4,z,BLOCK.STONE);}
  const dst={x:20,y:5,z:12};container(world,dst,new Chest());
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'quarry',blocks:[{x:19,y:4,z:19}],dests:[dst],
    quarry:{shape:'blocks',axis:'down',depth:1,radius:1,returnAt:1}});
  run(world,game,workers,monkey,400);
  assert.equal(world.getBlock(19,4,19),BLOCK.STONE,'Bare hands broke stone');
  assert.equal(monkey.status,'Needs a stronger tool');
}
{
  // Farmer: harvests ripe wheat on farmland in its area and replants it.
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const dst={x:18,y:5,z:20};container(world,dst,new Chest());
  for(let x=22;x<=24;x++){world.setBlock(x,4,20,BLOCK.FARMLAND);world.setBlock(x,5,20,BLOCK.WHEAT+3);}
  game.harvestCrop=(x,y,z,give)=>Game.prototype.harvestCrop.call(game,x,y,z,give);
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'farmer',cornerA:{x:22,y:4,z:20},cornerB:{x:24,y:4,z:20},dests:[dst]});
  run(world,game,workers,monkey,2000,()=>[22,23,24].every(x=>world.getBlock(x,5,20)===BLOCK.WHEAT));
  for(let x=22;x<=24;x++)assert.equal(world.getBlock(x,5,20),BLOCK.WHEAT,'Farmer did not harvest and replant');
  // A player breaks one crop; the farmer replants the same kind from its seeds.
  world.setBlock(23,5,20,BLOCK.AIR);
  run(world,game,workers,monkey,1000,()=>world.getBlock(23,5,20)===BLOCK.WHEAT);
  assert.equal(world.getBlock(23,5,20),BLOCK.WHEAT,'Farmer did not replant an empty plot');
  // It never tills.
  world.setBlock(25,4,20,BLOCK.DIRT);run(world,game,workers,monkey,400);
  assert.equal(world.getBlock(25,4,20),BLOCK.DIRT);
}
{
  const {world,game,workers,monkey,player,enemy,sent}=fixture();monkey.team=0;
  player.keep={cx:10,cz:10,floorY:4};enemy.keep=player.keep;
  monkey.config={...defaultMonkeyConfig(),home:{x:12,y:4,z:10}};
  workers.open(player,monkey);
  workers.action(enemy,{id:monkey.id,action:'teleportHome'});
  assert.equal(monkey.state.x,20.5,'Enemy teleported another team’s monkey');
  workers.action(player,{id:monkey.id,action:'teleportHome'});
  assert.equal(monkey.state.x,12.5);assert.equal(monkey.state.z,10.5);
  assert.ok(sent.some(msg=>msg.closed&&msg.player===player.id));
  Object.assign(monkey.state,{x:20.5,y:5,z:20.5});
  const near=()=>Math.hypot(monkey.state.x-12.5,monkey.state.z-10.5)<1.6;
  run(world,game,workers,monkey,1800,near);
  assert.ok(near(),'Idle monkey did not return to its configured home');
}
{
  const {world,game}=fixture();game.npcs.clear();world.keeps=[];
  world.islands=[{kind:'tiny',x:32,z:32,radius:8}];
  new MonkeyWorkers(game,()=>0.5).spawn();
  assert.equal(game.npcs.size,0,'Tiny island ignored its spawn chance');
  const rolls=[0,0.99,0,0,0.5,0.5];
  new MonkeyWorkers(game,()=>rolls.shift()??0.2).spawn();
  assert.equal(game.npcs.size,2,'Selected tiny island did not spawn two monkeys');
}
console.log('OK: charcoal/glass, eggs, taming/team access, gear slots, courier round robin, no idle wandering, whole-tree lumberjack, void-safe climbing quarry, tool strength, farmer replanting, home');
