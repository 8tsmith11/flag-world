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
const creatures = Object.values(ENTITY_TYPE).filter(type => !['player','item','arrow','riftOrb','npc'].includes(type));
assert.equal(new Set(MOB_EGGS.map(e => e.item)).size, MOB_EGGS.length);
for (const type of creatures) assert.ok(MOB_EGGS.some(e => e.type === type), `No egg for ${type}`);
for (const npc of Object.keys(NPC_DEFS)) assert.ok(MOB_EGGS.some(e => e.npc === npc), `No egg for ${npc}`);
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
    spawnItem:(item,count,x,y,z,vx,vy,vz,delay,mods)=>dropped.push({item,count,x,y,z,mods})};
  const workers=new MonkeyWorkers(game,mulberry32(5)),monkey=new WorkMonkey(game.nextId++,workers,{x:20.5,y:5,z:20.5});
  game.npcs.set(monkey.id,monkey);world.onBlockChanged=(x,y,z)=>workers.changed(x,y,z);
  const player={id:10,team:0,connected:true,dead:false,state:{x:20.5,y:5,z:21},inventory:new Inventory()};
  const friend={...player,id:11,inventory:new Inventory()},enemy={...player,id:12,team:1,inventory:new Inventory()};
  for(const p of [player,friend,enemy])game.players.set(p.id,p);
  return {world,game,workers,monkey,player,friend,enemy,sent,dropped};
}
{
  const {game,workers,monkey,player,friend,enemy,sent}=fixture(),name=monkey.name;
  workers.open(player,monkey);
  const session=workers.sessions.get(player.id);
  workers.action(enemy,{id:monkey.id,session:session.id,action:'cup',value:0});
  assert.equal(monkey.team,null,'Another player submitted the taming session');
  game.tick=session.ready;
  if(session.kind==='simon')for(const value of session.sequence)workers.action(player,{id:monkey.id,session:session.id,action:'simon',value});
  if(session.kind==='cups')workers.action(player,{id:monkey.id,session:session.id,action:'cup',value:session.finalBall});
  if(session.kind==='memory')for(let f=0;f<C.cardPairs;f++)for(const i of session.cards.flatMap((v,i)=>v===f?[i]:[]))workers.action(player,{id:monkey.id,session:session.id,action:'card',value:i});
  assert.equal(monkey.team,player.team);assert.equal(monkey.name,name);
  workers.open(friend,monkey);assert.equal(sent.at(-1).editable,true);
  const config={...defaultMonkeyConfig(),role:'collector',target:{x:20,y:5,z:20}};
  workers.action(enemy,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,0);
  workers.action(friend,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,1);
  workers.action(player,{id:monkey.id,action:'configure',revision:0,config});assert.equal(monkey.revision,1,'Stale settings overwrote teammate');
  assert.equal(workers.parseConfig({...config,radius:25}),null);
  assert.equal(workers.parseConfig({...config,vertical:4}),null);
  player.inventory.add(ITEM.TREE_SEED,1);workers.action(player,{id:monkey.id,action:'seed'});
  assert.equal(monkey.seeds,1);assert.equal(player.inventory.slots.filter(Boolean).length,0);
}
{
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const from={x:12,y:5,z:20},to={x:20,y:5,z:20};
  world.setBlock(from.x,from.y,from.z,BLOCK.CHEST);world.setBlock(to.x,to.y,to.z,BLOCK.FURNACE);
  const chest=new Chest(),furnace=new Furnace();chest.slots[0]={item:BLOCK.WOOD,count:64};chest.slots[1]={item:BLOCK.WOOD,count:64};
  world.tileEntities.set('12,5,20',chest);world.tileEntities.set('20,5,20',furnace);
  monkey.config=workers.parseConfig({...defaultMonkeyConfig(),role:'courier',from,to});assert.ok(monkey.config);
  // Start on standing space adjacent to the destination, not inside its block.
  Object.assign(monkey.state,{x:21.5,y:5,z:20.5});
  for(game.tick=1;game.tick<=2200;game.tick++){workers.beginTick();monkey.step(world,[],game.tick);}
  assert.deepEqual(furnace.slots[FUEL_SLOT],{item:BLOCK.WOOD,count:64});
  assert.deepEqual(furnace.slots[INPUT],{item:BLOCK.WOOD,count:64});
  assert.equal(chest.slots[0],null);assert.ok(workers.pathSearches<=4,`Unchanged courier recomputed ${workers.pathSearches} paths`);
  assert.ok(monkey.routes.size>=2);
  const searches=workers.pathSearches;
  world.setBlock(55,5,55,BLOCK.STONE);assert.equal(workers.pathSearches,searches);assert.ok(monkey.routes.size>=2);
  const route=monkey.routes.get('from'),cell=route.points[Math.floor(route.points.length/2)];
  world.setBlock(cell.x,cell.y,cell.z,BLOCK.STONE);assert.equal(monkey.routes.has('from'),false,'Route edit did not invalidate cache');
  const output=new Furnace();output.slots[INPUT]={item:BLOCK.SAND,count:4};output.slots[FUEL_SLOT]={item:ITEM.CHARCOAL,count:2};
  output.slots[OUTPUT]={item:BLOCK.GLASS,count:2};world.tileEntities.set('12,5,20',output);
  Object.assign(monkey.state,{x:13.5,y:5,z:20.5});monkey.cargo=null;workers.courier(monkey);
  assert.equal(monkey.cargo.item,BLOCK.GLASS);assert.equal(output.slots[INPUT].count,4);assert.equal(output.slots[FUEL_SLOT].count,2);
}
{
  const {world,workers,monkey}=fixture();monkey.team=0;
  monkey.config={...defaultMonkeyConfig(),role:'collector',target:{x:20,y:5,z:20}};
  const goal={x:30,y:5,z:30};
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])for(let y=5;y<=10;y++)world.setBlock(30+dx,y,30+dz,BLOCK.STONE);
  workers.travel(monkey,goal,'blocked');const searches=workers.pathSearches;
  for(let i=0;i<20;i++)workers.travel(monkey,goal,'blocked');
  assert.equal(workers.pathSearches,searches,'Failed route searched every think tick');
  assert.equal(monkey.routes.get('blocked').failed,true);
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])for(let y=5;y<=10;y++)world.setBlock(30+dx,y,30+dz,BLOCK.AIR);
  workers.travel(monkey,goal,'blocked');assert.equal(workers.pathSearches,searches+1);
  assert.equal(monkey.routes.get('blocked').failed,false,'Opened route did not resume');
}
{
  const {game,workers,monkey,dropped}=fixture();monkey.team=0;
  monkey.config={...defaultMonkeyConfig(),role:'collector',target:{x:20,y:4,z:20}};
  const mods=[{id:'damage',value:2}],drop={id:40,item:ITEM.IRON_SWORD,count:1,pickupTicks:0,mods,state:{x:21.5,y:5,z:20.5}};
  game.items.set(drop.id,drop);workers.collect(monkey);assert.deepEqual(monkey.cargo.mods,mods);
  workers.deliver(monkey);assert.deepEqual(dropped[0].mods,mods);
  game.items.set(41,{id:41,item:BLOCK.WOOD,count:2,pickupTicks:0,state:{x:20.5,y:5,z:20.5}});
  workers.collect(monkey);assert.equal(monkey.cargo,null,'Collected its own delivery pile');
  monkey.config.filter={mode:'whitelist',items:[ITEM.CHARCOAL]};game.items.set(42,{...drop,id:42,item:BLOCK.WOOD});
  workers.collect(monkey);assert.equal(monkey.cargo,null,'Ignored whitelist');
}
{
  const {world,game,workers,monkey}=fixture();monkey.team=0;
  const site={x:21,y:5,z:20};
  for(let y=5;y<=10;y++)world.setBlock(21,y,20,BLOCK.WOOD);
  world.setBlock(21,11,20,BLOCK.LEAVES);world.setBlock(22,9,20,BLOCK.WOOD);
  monkey.config={...defaultMonkeyConfig(),role:'lumberjack',target:{x:20,y:4,z:20},sites:[site]};
  workers.lumberjack(monkey,0);assert.equal(monkey.woodJob,null,'Chopped without a reserved sapling');
  monkey.seeds=1;workers.lumberjack(monkey,0);assert.ok(monkey.woodJob);
  workers.lumberjack(monkey,C.chopTicks);
  assert.equal(world.getBlock(21,5,20),BLOCK.SAPLING);assert.equal(world.getBlock(22,9,20),BLOCK.WOOD,'Expanded outside a marked column');
  assert.equal(monkey.cargo.count,6);assert.equal(monkey.seeds,1);
  assert.equal('grownTrees' in world,false);assert.equal('treeRecords' in world,false);
  // Trees outside the list never become candidates.
  monkey.cargo=null;monkey.config.sites=[];world.setBlock(22,10,20,BLOCK.LEAVES);
  workers.lumberjack(monkey,200);assert.equal(monkey.woodJob,null);
}
{
  const {game,workers,monkey,dropped}=fixture();monkey.team=0;
  monkey.config={...defaultMonkeyConfig(),role:'lumberjack',target:{x:18,y:4,z:20},sites:[{x:21,y:5,z:20}]};
  const seed={id:50,item:ITEM.TREE_SEED,count:3,pickupTicks:0,state:{x:21.5,y:5,z:20.5}};
  game.items.set(50,seed);workers.lumberjack(monkey,0);
  assert.equal(monkey.seeds,1);assert.deepEqual(monkey.cargo,{item:ITEM.TREE_SEED,count:2,mods:undefined});
  workers.deliver(monkey);assert.equal(dropped[0].item,ITEM.TREE_SEED);assert.equal(dropped[0].count,2);
  game.items.set(51,{...seed,id:51,count:3,state:{x:18.5,y:5,z:20.5}});
  assert.equal(workers.collectTreeSaplings(monkey),false,'Lumberjack looped on its own sapling pile');
}
console.log('OK: charcoal/glass, every creative egg, authoritative taming/team access, courier cache/furnace slots, filters/modifiers, marked-column lumberjack and saplings');
