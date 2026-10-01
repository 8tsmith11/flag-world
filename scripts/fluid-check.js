import assert from 'node:assert/strict';
import { BLOCK } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { FLUID, TICK_RATE, SMELT_TIME } from '../shared/config.js';
import { Furnace } from '../server/containers.js';
import { RECIPES, CRUSHING, SMELTING } from '../shared/recipes.js';
import { createContainer } from '../server/containers.js';
import { FluidSystem } from '../server/fluids.js';

function fixture() {
  const blocks=new Map(),events=[];
  const world={getBlock:(x,y,z)=>blocks.get(`${x},${y},${z}`)??BLOCK.AIR};
  const game={world,chunkLoading:{has:()=>true},broadcast:message=>events.push(message)};
  const fluids=new FluidSystem(game);
  function place(x,z,id,y=0) {
    const k=`${x},${y},${z}`,old=world.getBlock(x,y,z);
    blocks.set(k,id);fluids.changed(x,y,z,id,old);
    const kind={ [BLOCK.FLUID_TANK]:'tank',[BLOCK.BOILER]:'boiler',[BLOCK.CRUSHER]:'crusher' }[id];
    if(kind){const container=createContainer(kind);fluids.attach(x,y,z,container);return container;}
    return null;
  }
  function mode(x,z,value,y=0) {for(let i=0;i<value;i++)assert.ok(fluids.cycle(x,y,z));}
  function ticks(count,start=0) {for(let i=1;i<=count;i++)fluids.tick(start+i);}
  return {world,game,fluids,events,place,mode,ticks};
}

const f=fixture();
assert.equal(f.fluids.cycle(0,0,0),false);
for(const [id,output,count] of [
  ['bronze_pipe',BLOCK.BRONZE_PIPE,FLUID.craft.pipeCount],
  ['fluid_tank',BLOCK.FLUID_TANK,1],['fluid_pump',BLOCK.FLUID_PUMP,1],
  ['boiler',BLOCK.BOILER,1],['crusher',BLOCK.CRUSHER,1]]) {
  const recipe=RECIPES.find(r=>r.id===id);
  assert.equal(recipe?.station,'workbench');assert.equal(recipe.output,output);assert.equal(recipe.count,count);
}
for(const [ore,dust,ingot] of [[BLOCK.IRON_ORE,ITEM.IRON_DUST,ITEM.IRON_INGOT],
  [BLOCK.COPPER_ORE,ITEM.COPPER_DUST,ITEM.COPPER_INGOT],[BLOCK.TIN_ORE,ITEM.TIN_DUST,ITEM.TIN_INGOT]]) {
  assert.deepEqual(CRUSHING[ore],{item:dust,count:FLUID.crusherOreDust});
  assert.equal(SMELTING[dust],ingot);
}
assert.deepEqual(CRUSHING[BLOCK.STONE],{item:BLOCK.SAND,count:1});
f.place(1,0,BLOCK.WATER);
f.place(0,0,BLOCK.FLUID_PUMP);
assert.equal(f.fluids.cycle(0,0,0),false,'Machines do not have mode arrows');
f.place(0,-1,BLOCK.BRONZE_PIPE);
assert.equal(f.fluids.nodes.get('0,0,-1').mode,FLUID.faceNone);
const waterTank=f.place(0,-2,BLOCK.FLUID_TANK);
f.ticks(100);
assert.equal(waterTank.view().fluid,'water');
assert.ok(Math.abs(waterTank.view().amount-FLUID.pumpPerSecond*100/TICK_RATE)<1e-6);
assert.ok(f.fluids.snapshot().find(n=>n.z===-2).fill>0);

const manual=fixture();manual.place(1,0,BLOCK.WATER);manual.place(0,0,BLOCK.FLUID_PUMP);
manual.place(0,-1,BLOCK.BRONZE_PIPE);const manualTank=manual.place(0,-2,BLOCK.FLUID_TANK);
manual.mode(0,-1,FLUID.faceInput);manual.ticks(10);
assert.equal(manualTank.view().amount,0,'Input pipe unexpectedly fed a tank');
manual.mode(0,-1,1);assert.equal(manual.fluids.nodes.get('0,0,-1').mode,FLUID.faceOutput);
manual.ticks(10,10);assert.ok(manualTank.view().amount>0,'Output pipe did not feed a tank');
manual.mode(0,-1,1);assert.equal(manual.fluids.nodes.get('0,0,-1').mode,FLUID.faceNone);

f.place(0,-3,BLOCK.BRONZE_PIPE);
const boiler=f.place(0,-4,BLOCK.BOILER);
boiler.insert({item:ITEM.CHARCOAL,count:1});
f.place(0,-5,BLOCK.BRONZE_PIPE);
const steamTank=f.place(0,-6,BLOCK.FLUID_TANK);
f.place(0,-7,BLOCK.BRONZE_PIPE);
const crusher=f.place(0,-8,BLOCK.CRUSHER);
assert.equal(f.fluids.cycle(0,0,-8),false);
crusher.insert({item:BLOCK.COPPER_ORE,count:1});
f.ticks(250,100);
assert.equal(steamTank.view().fluid,'steam');
assert.ok(steamTank.view().amount>0);
assert.equal(boiler.burnTotal,FLUID.boilerFuelSeconds.charcoal*TICK_RATE);
assert.equal(crusher.slots[1]?.item,ITEM.COPPER_DUST);
assert.equal(crusher.slots[1]?.count,FLUID.crusherOreDust);
assert.ok(crusher.insert({item:BLOCK.STONE,count:1}));
assert.equal(crusher.slots[0]?.item,BLOCK.STONE);
assert.ok(boiler.insert({item:BLOCK.WOOD,count:1}));
assert.equal(boiler.slots[0]?.item,BLOCK.WOOD);
const furnace=new Furnace();
furnace.insert({item:ITEM.COPPER_DUST,count:2});furnace.insert({item:ITEM.CHARCOAL,count:1});
for(let i=0;i<2*SMELT_TIME*TICK_RATE+1;i++)furnace.tick();
assert.deepEqual(furnace.slots[2],{item:ITEM.COPPER_INGOT,count:2});
assert.ok(f.events.some(e=>e.type==='boilerLit'&&e.lit));

// A connected tank shares capacity; cutting its middle loses that block's
// proportional share and leaves two separate groups.
const t=fixture();
t.place(0,0,BLOCK.FLUID_TANK);t.place(1,0,BLOCK.FLUID_TANK);t.place(2,0,BLOCK.FLUID_TANK);
const whole=t.fluids.nodes.get('0,0,0').tank;
assert.equal(whole.capacity,3*FLUID.tankCapacity);
whole.fluid='water';whole.amount=3000;
t.place(1,0,BLOCK.AIR);
assert.equal(t.fluids.nodes.get('0,0,0').tank.amount,1000);
assert.equal(t.fluids.nodes.get('2,0,0').tank.amount,1000);

// Ports on both sides of one tank and the same pipe graph cannot circulate.
const loop=fixture();
loop.place(0,0,BLOCK.FLUID_TANK);loop.place(-1,0,BLOCK.BRONZE_PIPE);
loop.place(-1,-1,BLOCK.BRONZE_PIPE);loop.place(0,-1,BLOCK.BRONZE_PIPE);
assert.equal(loop.fluids.networks[0].ports.length,2);
loop.fluids.nodes.get('0,0,0').tank.fluid='water';loop.fluids.nodes.get('0,0,0').tank.amount=100;
loop.ticks(20);assert.equal(loop.fluids.nodes.get('0,0,0').tank.amount,100);
const sleepy=fixture();sleepy.place(1,0,BLOCK.WATER);sleepy.place(0,0,BLOCK.FLUID_PUMP);
sleepy.place(0,-1,BLOCK.BRONZE_PIPE);const sleepingTank=sleepy.place(0,-2,BLOCK.FLUID_TANK);
sleepy.game.chunkLoading.has=()=>false;
sleepy.ticks(TICK_RATE);assert.equal(sleepingTank.view().amount,0);

// One fluid per network: a pump cannot add water to a steam-filled pipe.
const s=fixture();s.place(1,0,BLOCK.WATER);s.place(0,0,BLOCK.FLUID_PUMP);
s.place(0,-1,BLOCK.BRONZE_PIPE);s.place(0,-2,BLOCK.BOILER);
const mixed=s.fluids.networks[0];mixed.fluid='steam';mixed.amount=10;
s.ticks(1);assert.equal(mixed.fluid,'steam');assert.ok(mixed.amount>=10);
const joined=fixture();joined.place(0,0,BLOCK.BRONZE_PIPE);joined.place(2,0,BLOCK.BRONZE_PIPE);
joined.fluids.networks[0].fluid='water';joined.fluids.networks[0].amount=10;
joined.fluids.networks[1].fluid='steam';joined.fluids.networks[1].amount=20;
joined.place(1,0,BLOCK.BRONZE_PIPE);
assert.equal(joined.fluids.networks.length,1);
assert.equal(joined.fluids.networks[0].fluid,'steam');
assert.ok(joined.fluids.networks[0].amount<30);

// Three consumers receive the same fraction of a constrained output.
const g=fixture(),b=g.place(0,0,BLOCK.BOILER);b.steam=20;
g.place(0,-1,BLOCK.BRONZE_PIPE);g.place(-1,-1,BLOCK.BRONZE_PIPE);g.place(1,-1,BLOCK.BRONZE_PIPE);
const machines=[[-2,-1],[0,-2],[2,-1]].map(([x,z])=>{
  const c=g.place(x,z,BLOCK.CRUSHER);c.insert({item:BLOCK.STONE,count:4});
  return c;
});
g.ticks(20);
assert.ok(machines[0].progress>0);
assert.ok(machines[0].progress<20/(FLUID.crusherSeconds*TICK_RATE));
assert.ok(machines.every(c=>Math.abs(c.progress-machines[0].progress)<1e-9));

// A cut pipe isolates downstream consumers once their small buffer drains.
f.place(0,-7,BLOCK.AIR);
f.ticks(300,350);
assert.equal(crusher.lastReceived,0);

console.log('OK: pump, tank, boiler, steam tank, crusher, dust smelting, fluid exclusion, fair sharing and pipe break');
