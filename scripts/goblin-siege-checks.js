// Focused siege invariants, including sabotage and client-interest independence.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { GoblinController } from '../server/goblins.js';
import { Flag } from '../server/flag.js';
import { World } from '../shared/world.js';
import { BLOCK, isSolid, blockBase } from '../shared/blocks.js';
import { FLAG_STATE, S2C } from '../shared/protocol.js';
import { GOBLINS } from '../shared/goblins.js';
import { TICK_RATE } from '../shared/config.js';
import { chooseSiegeTarget, planSiege, bridgeDamage, newBridge } from '../server/goblinSiegePlan.js';
import { SiegeShot } from '../server/goblinMachines.js';
import { raycastPlayers } from '../shared/raycast.js';
import { playerFitsAt, createPlayerState, stepPlayer } from '../shared/physics.js';
import { wallProject, surfaceHeight, chooseSurfaceSite } from '../server/goblinProjects.js';
import { SURFACE_TEMPLATES } from '../shared/goblinModules.js';
import { Inventory } from '../server/inventory.js';
import { findPath } from '../server/pathfind.js';

function fixture() {
  const game=new Game();game.seed=4;game.worldSize='small';game.world=new World(4,180,90,{sizeY:70,minY:0});
  const w=game.world;
  for(const [cx,y] of [[40,10],[135,14]])for(let z=12;z<=66;z++)for(let x=cx-27;x<=cx+27;x++) {
    w.setBlock(x,y,z,BLOCK.GRASS);w.naturalTop[x+w.sizeX*z]=y;
  }
  w.islands=[{kind:'center',x:40,z:40,radius:27,topY:10,bottomY:0},{kind:'team',x:135,z:40,radius:27,topY:14,bottomY:0}];
  w.keeps=[{cx:135,cz:40,floorY:14}];
  const f=new Flag(100,0xff0000,{x:135.5,y:15,z:40.5},3);game.flags.set(f.id,f);
  const c=game.goblins=new GoblinController(game);
  c.totemSpot={x:35.5,y:11,z:35.5};c.totemAlive=true;
  c.fortress={origin:{x:0,y:0,z:0},cells:{},modules:[],connections:[]};
  c.entrances=[{open:true,sealed:false,top:{x:35.5,y:11,z:35.5},outside:{x:35.5,y:11,z:35.5},
    columns:[],floorY:5,topY:10}];
  c.capacity=()=>16;
  // This fixture isolates siege state. Real module/shaft journeys are covered
  // by accelerated generated-world matches and the existing max-base checks.
  c.sim.startJourney=()=>{};
  for(let i=1;i<=3;i++)c.spawnGoblin(i===1?'goblinWorker':'goblinSoldier',false,i);
  return {game,c,w,f};
}

// A later siege cannot reserve a tower across an existing house's doorway.
{
  const {c}=fixture(),first=newBridge(c,3,1,0),p=first.launch;
  c.buildings.push({kind:'dwelling',box:{x0:p.x-2,x1:p.x+2,z0:p.z-2,z1:p.z+2},
    access:[{x:p.x,z:p.z+5}]});
  const next=newBridge(c,3,1,0).launch,margin=GOBLINS.siege.launchSettlementClearance;
  assert.ok(Math.abs(next.x-p.x)>margin+2 || Math.abs(next.z-p.z)>margin+2,'launch moves away from the house');
  assert.ok(Math.abs(next.x-p.x)>margin || Math.abs(next.z-p.z-5)>margin,'launch preserves the doorway lane');
}
// Pending towers reserve space before wood arrives; a changed construction
// reserve invalidates a cached launch instead of producing a clipped tower.
{
  const {c}=fixture();const plan=c.sieges.prepare(),p=plan.bridges[0].launch;
  assert.ok(c.surfaceBoxes().some(b=>p.x>=b.x0 && p.x<=b.x1 && p.z>=b.z0 && p.z<=b.z1));
  c.reserved.push({x0:p.x-2,x1:p.x+2,z0:p.z-2,z1:p.z+2});
  assert.equal(c.sieges.launch(true),true);
  assert.notDeepEqual(c.sieges.active.bridges[0].launch,p,'cached tower site is replanned around construction');
  const {c:blocked}=fixture();blocked.reserved.push({x0:0,x1:180,z0:0,z1:90});
  assert.equal(blocked.sieges.prepare(),null,'a fully blocked island waits for a usable launch');
}
// A far tree's labor cost may exceed the old 150-second credit ceiling.
{
  const {c,game,w}=fixture();c.spawnGoblin('goblinWorker',false,1);c.offscreen=true;
  const tree={x:60,y:11,z:35,plot:null};for(let y=11;y<17;y++)w.setBlock(60,y,35,BLOCK.WOOD);
  c.woodSources=()=>w.getBlock(60,11,35)===BLOCK.WOOD?[tree]:[];
  c.sim.roundTrip=()=>400;
  for(let step=1;step<500 && w.getBlock(60,11,35)===BLOCK.WOOD;step++){game.tick=step*40;c.sim.tick(game.tick);}
  assert.equal(w.getBlock(60,11,35),BLOCK.AIR,'workers eventually save enough labor to chop the far tree');
  assert.ok(c.wood>=GOBLINS.gathering.planksPerTree);
}
// Filling the compact village does not strand progression one dwelling
// short when clear native ground exists in the configured expansion ring.
{
  const {c,w}=fixture();c.entrances[0].gatehouse={};
  for(let z=0;z<w.sizeZ;z++)for(let x=0;x<w.sizeX;x++){
    w.setBlock(x,14,z,BLOCK.AIR);w.setBlock(x,9,z,BLOCK.DIRT);w.setBlock(x,10,z,BLOCK.GRASS);w.naturalTop[x+w.sizeX*z]=10;
  }
  c.reserved.push({x0:0,x1:95,z0:0,z1:90});
  const site=chooseSurfaceSite(w,c,SURFACE_TEMPLATES.hut,c.random);
  assert.ok(site && site.bounds.x0>95,'a dwelling finds open ground beyond the filled compact village');
}

// Stable target/team mapping, wood gate, finite army and immutable home slots.
{
  const {game,c,f}=fixture(),home=[...c.members],slotIds=[...c.slots.values()].map((g)=>g.id);
  assert.deepEqual(chooseSiegeTarget(game,()=>0),{team:3,reason:'random home flag'});
  assert.equal(c.sieges.launch(),false);assert.ok(c.sieges.reserve()>0);
  c.wood=c.sieges.reserve();assert.equal(c.sieges.launch(),true);
  assert.equal(c.wood,0);assert.equal(c.sieges.launch(true),false,'only one active siege');
  const s=c.sieges.active;
  assert.equal(s.queue.length,9);assert.equal(s.budget.goblinWorker,2);
  c.sieges.tick(0);
  assert.ok(s.spawned>=2 && s.spawned<=3);assert.ok(s.queue.length>0,'army emerges in groups');
  const g=c.sieges.roster.values().next().value;g.hp=4;
  const before={...g.state};game.players.set(9,{id:9,dead:true,connected:true,state:{x:175,y:11,z:80}});
  c.sieges.tick(1);game.players.clear();c.sieges.tick(2);
  assert.equal(c.sieges.roster.get(g.id),g);assert.equal(g.hp,4,'interest changes preserve individual health');
  assert.equal(c.members.size,home.length);assert.deepEqual([...c.slots.values()].map((g)=>g.id),slotIds);
  game.removeMob(g);assert.equal(c.sieges.roster.has(g.id),false);
  assert.equal(s.queue.length,9-s.spawned,'death never replenishes siege budget');
  c.totemAlive=false;c.sieges.tick(3);assert.equal(c.sieges.active,null);
  assert.ok(c.events.some((e)=>e.event==='siegeEnd' && e.reason==='totem destroyed'));
  assert.equal(f.state,FLAG_STATE.HOME);
}

// Known bridges widen and repair; damaged bridges are forgotten, use a new
// launch/landing, and never queue changes against protected keep blocks.
{
  const {c,w}=fixture();let p=planSiege(c,{team:3,reason:'test'},1,c.sieges.history,c.sieges.machines);
  const history=c.sieges.history.get(3);history.count=1;history.bridges=p.bridges;
  for(const b of p.tasks)w.setBlock(b.x,b.y,b.z,b.id);
  assert.equal(bridgeDamage(w,p.bridges[0]),0);
  const old=p.bridges[0];p=planSiege(c,{team:3},2,c.sieges.history,c.sieges.machines);
  assert.equal(p.mode,'reuse');assert.equal(p.bridges[0],old);assert.equal(old.width,2);
  assert.ok(p.platform,'long-range catapult requires a bridge platform');
  // A player hole in the completed deck is repaired before remaining tasks.
  const solid=p.tasks.find((b)=>b.id===BLOCK.PLANKS);
  w.setBlock(solid.x,solid.y,solid.z,solid.id);
  const s={...p,id:7,army:new Set(),tasks:[solid],cursor:1,landingTick:1};c.sieges.active=s;
  w.setBlock(solid.x,solid.y,solid.z,BLOCK.AIR);c.sieges.repair(s,20);
  assert.equal(s.tasks[s.cursor].key,solid.key);assert.equal(s.tasks[s.cursor].id,solid.id);
  // Head obstruction is cleared without counting an unreachable keep as work.
  const protectedSpot=old.deck.at(-1);w.setBlock(protectedSpot.x,protectedSpot.y+1,protectedSpot.z,BLOCK.KEEP);
  const intact=old.blocks.filter((b)=>b.id!==BLOCK.AIR);
  for(let i=0;i<Math.ceil(intact.length*0.6);i++)w.setBlock(intact[i].x,intact[i].y,intact[i].z,BLOCK.AIR);
  p=planSiege(c,{team:3},2,c.sieges.history,c.sieges.machines);
  assert.equal(p.mode,'abandoned');assert.equal(history.bridges.includes(old),false);
  assert.equal(p.bridges[0].width,2);assert.notDeepEqual(p.bridges[0].launch,old.launch);
  assert.notDeepEqual(p.bridges[0].landing,old.landing);
  assert.ok(p.tasks.every((b)=>w.getBlock(b.x,b.y,b.z)!==BLOCK.KEEP));
}

// Tier substitutions retain existing unit identities and switch on respawn.
{
  const {c}=fixture();for(let i=4;i<8;i++)c.spawnGoblin('goblinSoldier',false,i);
  assert.equal(c.nextOpenSlot(),8);assert.equal(c.neededType(),'goblinSoldier');
  const old=[...c.members];c.minimumTier=3;c.updateTier();assert.equal(c.neededType(),'goblinBrute');
  assert.deepEqual([...c.members],old);
  c.sieges.completedTier3=2;c.outerWallBuilt=true;c.updateTier();assert.equal(c.tier,4);
  assert.equal(GOBLINS.population.spawnInterval,45);
  c.treeFelled({x:1,y:1,z:1,plot:null});assert.equal(c.replantQueue.length,0,'natural trees are not replanted');
}

// Impact protection, unseen batching and actual ballistic flight.
{
  const {c,w,game}=fixture();const point={x:80.5,y:20.5,z:40.5};
  w.setBlock(80,20,40,BLOCK.PLANKS);c.sieges.protectedBridge.add('80,20,40');
  w.setBlock(81,20,40,BLOCK.STONE);w.setBlock(80,20,41,BLOCK.KEEP);w.setBlock(79,20,40,BLOCK.GOBLIN_BRICKS);
  c.sieges.impact(point,GOBLINS.catapult.bomb);
  assert.equal(w.getBlock(81,20,40),BLOCK.STONE,'unseen impact waits for batch resolution');
  c.sieges.flushImpacts(1);assert.equal(w.getBlock(81,20,40),BLOCK.AIR);
  assert.equal(w.getBlock(80,20,40),BLOCK.PLANKS);assert.equal(w.getBlock(80,20,41),BLOCK.KEEP);
  assert.equal(w.getBlock(79,20,40),BLOCK.GOBLIN_BRICKS);
  const shot=new SiegeShot(game.nextId++,c.sieges,{x:80,y:25,z:40},{x:90,y:15,z:40},GOBLINS.catapult.boulder);
  game.mobs.set(shot.id,shot);shot.advance();assert.ok(shot.state.y>25,'boulder rises into an arc');
}

// Machine crew loss/replacement, airborne crash and independent pilot hitbox.
{
  const {c,game}=fixture();c.minimumTier=3;c.updateTier();c.wood=10000;c.sieges.launch();
  const s=c.sieges.active;c.sieges.buildMachines(s);
  const cat=s.catapult,pilot=c.sieges.spawn(s,{type:'goblinSoldier',role:'pilot'}),balloon=s.balloon;
  balloon.crew=pilot;pilot.aboard=balloon;balloon.phase='outbound';balloon.state.y=35;
  c.hurt(balloon,100,{id:9},false);assert.equal(balloon.phase,'crashing');assert.equal(balloon.dead,false);
  c.hurt(balloon,2,{id:9},false);assert.equal(balloon.dead,false,'repeated hits preserve crash flight');
  for(let tick=0;tick<400 && !balloon.dead;tick++)c.sieges.machine(balloon,tick);
  assert.equal(balloon.dead,true);assert.equal(pilot.dead,true);
  const crew=c.sieges.spawn(s,{type:'goblinSoldier',role:'fighter'});crew.siegePhase='assault';
  Object.assign(crew.state,{x:cat.state.x,y:cat.state.y,z:cat.state.z,onGround:true});
  c.world.setBlock(Math.floor(cat.state.x),Math.round(cat.state.y)-1,Math.floor(cat.state.z),BLOCK.PLANKS);
  cat.crew=null;c.sieges.machine(cat,1);
  assert.equal(crew.siegeRole,'crew');c.sieges.unit(crew,s,2);assert.equal(cat.crew,crew);
  game.removeMob(crew);c.sieges.machine(cat,3);assert.equal(cat.phase,'waitingCrew');
  const envelope={id:22,state:{x:0,y:0,z:0,box:{halfW:2,height:4.8,offsetY:2.2}}};
  assert.equal(raycastPlayers({x:0,y:1,z:-5},{x:0,y:0,z:1},10,[envelope],p=>p.state.box),null);
  assert.ok(raycastPlayers({x:0,y:4,z:-5},{x:0,y:0,z:1},10,[envelope],p=>p.state.box));
}

// Goblin-held flags obey normal grab/drop notifications but cannot time out
// or capture. An owning player touches the pedestal to return immediately.
{
  const {game,c,f}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const g=c.sieges.spawn(s,{type:'goblinSoldier',role:'fighter'});
  game.takeFlag(g,f);assert.equal(f.snapshot().carrierId,g.id);
  game.removeMob(g);assert.equal(f.state,FLAG_STATE.DROPPED);
  const carrier=c.sieges.spawn(s,{type:'goblinSoldier',role:'fighter'});
  game.takeFlag(carrier,f);carrier.returnStage='totem';Object.assign(carrier.state,c.totemSpot);
  c.sieges.returnCarrier(carrier,s);assert.equal(f.state,FLAG_STATE.HELD);
  assert.equal(c.winnerId,undefined); // Controller never calls capture/eliminate.
  game.tick=100000;game.updateFlags();assert.equal(f.state,FLAG_STATE.HELD);
  const player={id:200,team:3,name:'Owner',connected:true,dead:false,inventory:new Inventory(),
    state:{...f.body},flag:f,hp:20,maxHp:()=>20};game.players.set(player.id,player);
  game.updateFlags();assert.equal(f.state,FLAG_STATE.HOME);
}

// Traps only see players on their facing line; poison ticks survive detail
// changes and are counted by the server, without client physics involvement.
{
  const {game,c,w}=fixture();const trap={x:20,y:11,z:20,facing:1,id:80,nextShot:0};
  w.setBlock(20,11,20,80);c.traps.traps.set('20,11,20',trap);
  const player={id:8,connected:true,dead:false,creative:false,immortal:false,state:{x:23,y:11,z:20.5}};
  game.players.set(8,player);c.nearbyPlayers=()=>[player];c.traps.tick(1);
  assert.equal(game.arrows.size,1);const arrow=[...game.arrows.values()][0];assert.equal(arrow.poison,true);
  assert.equal(arrow.damage,GOBLINS.traps.damage);c.traps.tick(2);assert.equal(game.arrows.size,1);
  game.players.clear();c.nearbyPlayers=()=>[];game.tick=100;c.traps.tick(100);assert.equal(game.arrows.size,1);
  game.players.set(8,player);player.poisonUntil=201;player.nextPoison=101;
  let poisonDamage=0;game.hurt=(_,amount)=>poisonDamage+=amount;
  for(let tick=101;tick<=201;tick++)c.traps.tick(tick);
  assert.equal(poisonDamage,5);
}

// Expired journey estimates cannot snap bodies through changed dwelling walls.
{
  const {game,c,w}=fixture(),g=[...c.members][1];
  Object.assign(g.state,{x:35.5,y:11,z:35.5,onGround:true});
  for(let y=11;y<=13;y++)w.setBlock(38,y,35,BLOCK.GOBLIN_BRICKS);
  g.respawnJourney=[{x:35.5,y:11,z:35.5,tick:0},{x:42.5,y:11,z:35.5,tick:1}];
  g.journeyRoute={actions:[{type:'walk',x:42.5,y:11,z:35.5}],index:0,local:null,goal:{x:42.5,y:11,z:35.5}};
  for(let tick=100;tick<220;tick++) {
    game.tick=tick;c.sim.progressJourney(g);
    assert.ok(playerFitsAt(w,g.state,g.state.y),'journey stays outside solid blocks');
  }
  assert.ok(g.state.x>39,'walker routes around obstruction');
}
// A floating island overhead cannot pull settlement walls up to its elevation.
{
  const {c,w}=fixture();
  const building={kind:'dwelling',origin:{x:33,y:10,z:33},box:{x0:33,x1:40,z0:33,z1:40}};
  c.buildings=[building];
  for(let z=25;z<=48;z++)for(let x=25;x<=48;x++) {
    w.setBlock(x,42,z,BLOCK.STONE);w.naturalTop[x+w.sizeX*z]=42;
  }
  const plan=wallProject(w,c,[building],true);
  assert.ok(plan,'ground-level wall still has a plan');
  assert.ok(plan.building.blocks.every(b=>b.y<30),'no wall tasks reach overhead island');
  assert.ok(plan.building.gates.length>=4,'exterior wall has open gates');
}
// Balloon flight cannot enter an added wall or start inside the settlement.
{
  const {c,w}=fixture();
  const start=c.sieges.balloonLaunch();assert.ok(c.sieges.balloonClear(start));
  const m={state:{x:35.5,y:20,z:35.5},phase:'outbound',flightY:20};
  for(let y=20;y<=27;y++)for(let z=32;z<=39;z++)w.setBlock(38,y,z,BLOCK.GOBLIN_BRICKS);
  for(let tick=0;tick<80;tick++) {
    c.game.tick=tick;c.sieges.flyBalloon(m,{x:45.5,y:m.flightY,z:35.5});
    assert.ok(c.sieges.balloonClear(m.state),'envelope remains outside wall');
  }
}
// Balloons wait for the ground army; occupants use the remaining siege budget.
{
  const {c,game}=fixture();c.minimumTier=3;c.updateTier();c.wood=10000;c.sieges.launch();
  const s=c.sieges.active,home=c.members.size;
  s.queue=s.queue.filter((e)=>['pilot','rider'].includes(e.role));s.spawned=19;
  game.tick=1;c.sieges.tick(1);assert.equal(s.balloon,undefined,'no premature balloon');
  s.landingTick=2;s.cursor=s.tasks.length;
  const departure=2+c.sieges.ticks(GOBLINS.balloon.launchDelay);
  game.tick=departure-1;c.sieges.tick(game.tick);assert.equal(s.balloon,undefined,'delay follows bridge landing');
  for(let group=0;group<5 && s.queue.length;group++) {
    game.tick=departure+group*c.sieges.ticks(GOBLINS.siege.spawnInterval);c.sieges.tick(game.tick);
  }
  assert.equal(s.queue.length,0);assert.equal(s.spawned,24);assert.equal(c.members.size,home);
  assert.ok(s.balloon.crew);assert.equal(s.balloon.cargo.length,4);
  assert.ok(s.balloon.cargo.every((g)=>g.aboard===s.balloon && g.siegeManaged));
  assert.ok(c.sieges.balloonClear(s.balloon.state));
}
// A worker below the surface must finish staging before any bridge task.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const worker=c.sieges.spawn(s,{type:'goblinWorker',role:'builder'});
  Object.assign(worker.state,{x:s.bridges[0].ladder.x,y:5,z:s.bridges[0].ladder.z,onGround:true});
  worker.siegePhase='building';const task=s.tasks[0],before=w.getBlock(task.x,task.y,task.z);
  c.sieges.build(s,1);assert.equal(w.getBlock(task.x,task.y,task.z),before);
  assert.equal(worker.surfaceLaunchReached,undefined);assert.equal(worker.siegePhase,'emerging');
  assert.ok(c.sieges.path({x:35.5,y:11,z:35.5},s.bridges[0].ladder,true).every(p=>p.y>=11));
}
// Chunk interest uses discrete chunk boundaries. Falling persists without viewers.
{
  const {c,game,w}=fixture();
  game.players.set(9,{connected:true,state:{x:16,y:16,z:16}});
  assert.equal(c.watchedChunk({x:16*(1+GOBLINS.detail.chunkRadius)+15,y:16,z:16}),true);
  assert.equal(c.watchedChunk({x:16*(2+GOBLINS.detail.chunkRadius),y:16,z:16}),false);
  game.players.clear();const g=[...c.members][0];g.simPositioned=true;
  Object.assign(g.state,{x:80.5,y:8,z:80.5,onGround:false});game.mobs.delete(g.id);
  c.sim.startJourney=()=>{};
  for(let tick=1;tick<200 && !g.dead;tick++) {game.tick=tick;c.update(tick);}
  assert.equal(g.dead,true,'unobserved falling home goblin dies in the void');
  assert.equal(c.members.has(g),false,'void death releases the persistent home slot');
}
// Tall walls never trigger repeated jumping; a clear one-block step does.
{
  const {c,w}=fixture(),g=[...c.members][1];
  Object.assign(g.state,{x:45.5,y:11,z:35.5,yaw:-Math.PI/2,onGround:true});
  for(let y=11;y<=13;y++)w.setBlock(46,y,35,BLOCK.STONE);
  let highest=11;
  for(let tick=0;tick<100;tick++) {g.move(w,{dx:1,dz:0},g.settings.speed);highest=Math.max(highest,g.state.y);}
  assert.ok(highest<11.01,'blocked goblin does not jump at a tall wall');
  w.setBlock(46,12,35,BLOCK.AIR);w.setBlock(46,13,35,BLOCK.AIR);
  for(let tick=0;tick<30;tick++) {g.move(w,{dx:1,dz:0},g.settings.speed);highest=Math.max(highest,g.state.y);}
  assert.ok(highest>11.5,'goblin jumps onto a reachable one-block step');
}
// Full flat-island siege: cross, steal a flag, return down the tower and hold it.
{
  const {c,game,f}=fixture();c.wood=10000;c.sieges.launch();
  for(let tick=1;tick<=12000 && f.state!==FLAG_STATE.HELD;tick++) {
    game.tick=tick;c.sieges.tick(tick);
  }
  assert.equal(f.state,FLAG_STATE.HELD,JSON.stringify([...c.sieges.roster.values()].filter(g=>g.carrying).map(g=>({state:g.state,stage:g.returnStage,next:g.march?.[g.marchIndex],index:g.marchIndex,route:g.route,journey:g.journeyRoute}))));
  assert.equal(c.members.size,3,'flag assault never borrows a home goblin');
}
// An intact reused bridge with no construction tasks still releases its army.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();let s=c.sieges.active;
  for(const b of s.bridges[0].blocks)w.setBlock(b.x,b.y,b.z,b.id);
  c.sieges.end('test reset');c.sieges.launch(true);s=c.sieges.active;
  for(const b of s.tasks)w.setBlock(b.x,b.y,b.z,b.id);
  c.sieges.end('test reset');c.sieges.launch(true);s=c.sieges.active;
  assert.equal(s.tasks.length,0,'intact wide bridge needs no construction');
  const spawnDeadline=s.queue.length*c.sieges.ticks(GOBLINS.siege.spawnInterval)+2;
  for(let tick=1;tick<spawnDeadline && s.queue.length;tick++) {game.tick=tick;c.sieges.tick(tick);}
  assert.equal(s.queue.length,0,'zero construction tasks never blocks fighter spawning');
}
// A repair worker can clear and replace the next rung from below it.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const worker=c.sieges.spawn(s,{type:'goblinWorker',role:'builder'});
  const original=s.bridges[0].blocks.find(b=>b.work.climb && b.id!==BLOCK.AIR && b.id!==BLOCK.PLANKS);
  assert.ok(original);
  const task={...original,id:BLOCK.AIR};s.tasks=[task];s.cursor=0;s.nextWork=0;
  Object.assign(worker.state,{x:task.work.x,y:task.work.y-1,z:task.work.z,onGround:true});
  worker.siegePhase='building';worker.surfaceLaunchReached=true;
  w.setBlock(task.x,task.y,task.z,BLOCK.STONE);game.tick=1;c.sieges.build(s,1);
  assert.equal(w.getBlock(task.x,task.y,task.z),BLOCK.AIR,'blocked next rung is reachable from below');
  assert.equal(s.cursor,1);assert.equal(worker.mining,true);
  s.tasks=[original];s.cursor=0;s.nextWork=0;game.tick=2;c.sieges.build(s,2);
  assert.equal(w.getBlock(original.x,original.y,original.z),original.id,'next rung can be replaced from below');
  s.tasks=[{...original,id:BLOCK.AIR,work:{...original.work,y:original.work.y+10}}];s.cursor=0;s.nextWork=0;
  const advance=c.sieges.advance;c.sieges.advance=()=>false;
  worker.mining=false;game.tick=3;c.sieges.build(s,3);c.sieges.advance=advance;
  assert.equal(s.cursor,0);assert.equal(worker.mining,false,'travel toward unreachable work does not animate hammer swings');
}
// Clearing player obstructions must not destroy the colony's intended walls.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const worker=c.sieges.spawn(s,{type:'goblinWorker',role:'builder'});
  Object.assign(worker.state,{x:40.5,y:11,z:40.5});const goal={x:45.5,y:11,z:40.5};
  s.builderId=worker.id;
  const key='41,11,40';w.setBlock(41,11,40,BLOCK.GOBLIN_BRICKS);c.intended.set(key,{id:BLOCK.GOBLIN_BRICKS});
  c.sieges.requestClear(worker,goal);assert.equal(s.clearRequests.size,0);
  for(let tick=1;tick<200;tick++)c.sieges.smash(worker,goal,tick);
  assert.equal(w.getBlock(41,11,40),BLOCK.GOBLIN_BRICKS);
  c.intended.delete(key);c.sieges.requestClear(worker,goal);assert.equal(s.clearRequests.size,1);
  for(let tick=200;tick<400;tick++)c.sieges.smash(worker,goal,tick);
  assert.equal(w.getBlock(41,11,40),BLOCK.AIR,'player obstruction is cleared');
}
// Supported downhill steps must not be treated as a void edge.
{
  const {c,w}=fixture(),g=[...c.members][1];
  Object.assign(g.state,{x:45.5,y:11,z:35.5,yaw:-Math.PI/2,onGround:true});
  for(let x=46;x<=67;x++){w.setBlock(x,10,35,BLOCK.AIR);w.setBlock(x,9,35,BLOCK.STONE);}
  let lowest=11;
  for(let tick=0;tick<240;tick++){g.move(w,{dx:1,dz:0},g.settings.speed);lowest=Math.min(lowest,g.state.y);}
  assert.ok(lowest<10.1,'goblin descends the supported one-block stair');
  assert.ok(g.state.x>46.2,'goblin continues past the downhill waypoint');
  assert.ok(g.state.x<68.5 && g.state.y>9.9,'void edge protection remains active beyond the stair');
}
// Local siege paths enter a river using swimming physics and leave at the far bank.
{
  const {c,game,w}=fixture(),g=[...c.members][1];g.siegeManaged=true;g.breaksObstacles=true;
  Object.assign(g.state,{x:45.5,y:11,z:35.5,yaw:-Math.PI/2,onGround:true});
  for(let x=46;x<=50;x++)for(let z=12;z<=66;z++){w.setBlock(x,10,z,BLOCK.WATER);w.setBlock(x,9,z,BLOCK.STONE);}
  for(let tick=1;tick<=200 && g.state.x<52;tick++){game.tick=tick;g.walkTo(w,{x:55.5,y:11,z:35.5},g.settings.speed,{urgent:true});}
  assert.ok(g.state.x>51,'siege local route crosses the river and reaches its far bank');
  assert.ok(g.state.y>9.8,'swimming preserves physical river support');
}
// The mob stair allowance never changes player crouch prediction.
{
  const {w}=fixture();for(let x=46;x<=67;x++){w.setBlock(x,10,35,BLOCK.AIR);w.setBlock(x,9,35,BLOCK.STONE);}
  const state=createPlayerState(45.5,11,35.5);state.onGround=true;
  for(let tick=0;tick<700;tick++)stepPlayer(state,{forward:1,strafe:0,yaw:-Math.PI/2,pitch:0,crouch:true},w);
  assert.ok(state.x<68.31 && state.y>9.9,'player crouching retains its existing one-step descent and void edge protection');
}
// Long-route flag movement uses the normal carrier speed exactly once.
{
  const {c,game,f}=fixture(),g=[...c.members][1];g.carrying=f;g.state.carrying=true;
  Object.assign(g.state,{x:35.5,y:11,z:35.5,yaw:-Math.PI/2,onGround:true});game.tick=1;
  c.sieges.advance(g,[{x:45.5,y:11,z:35.5}],'flag-speed',GOBLINS.siege.carrierSpeed);
  assert.ok(Math.abs(g.state.x-35.5-GOBLINS.siege.carrierSpeed/TICK_RATE)<0.001,'carrier slowdown applies once');
}
// A sharp path turn must not spend its first ticks walking into the old heading.
{
  const {c,w}=fixture(),g=[...c.members][1];
  Object.assign(g.state,{x:45.5,y:11,z:35.5,yaw:0,onGround:true});
  g.move(w,{dx:1,dz:0},g.settings.speed);
  assert.ok(g.state.x>45.5 && Math.abs(g.state.z-35.5)<0.001,'movement follows the new waypoint without a turning arc');
}
// A river-exit bounce must keep horizontal progress above the water surface.
{
  const {c,game,w}=fixture(),g=[...c.members][1];g.siegeManaged=true;
  for(let x=44;x<=45;x++){w.setBlock(x,10,35,BLOCK.WATER);w.setBlock(x,9,35,BLOCK.STONE);}
  Object.assign(g.state,{x:45.5,y:10.9,z:35.5,yaw:-Math.PI/2,onGround:false});
  for(let tick=1;tick<=100 && g.state.x<47;tick++){game.tick=tick;c.sieges.advance(g,[{x:46.5,y:11,z:35.5},{x:48.5,y:11,z:35.5}],'water-exit',g.settings.speed);}
  assert.ok(g.state.x>46.3,'long-route swimmer keeps moving while bouncing onto the bank');
}
// Wide brutes must center themselves before turning through a one-cell lane.
{
  const {c,game,w}=fixture(),g=[...c.members][1];g.siegeManaged=true;
  g.state.box={halfW:GOBLINS.brute.width/2,height:GOBLINS.brute.height};
  Object.assign(g.state,{x:45.5,y:11,z:35.5,yaw:0,onGround:true});
  for(let y=11;y<14;y++)for(const [x,z] of [[45,36],[47,35],[47,36]])w.setBlock(x,y,z,BLOCK.STONE);
  for(let tick=1;tick<=200 && g.state.z<37;tick++){game.tick=tick;g.walkTo(w,{x:46.5,y:11,z:37.5},g.settings.speed,{urgent:true});}
  assert.ok(g.state.z>37,'wide goblin turns through the narrow lane without getting wedged');
}
// A diggable corner is still solid until the sim actually clears it.
{
  const {w}=fixture();w.setBlock(46,12,35,BLOCK.STONE);
  const path=findPath(w,{x:45,y:11,z:35},{x:46,y:11,z:36},{canBreak:()=>true,breakCost:0,goalHeight:true});
  assert.ok(path.length && !(path[0].x===46 && path[0].z===36),'digging routes approach solid corners before turning past them');
}
// The surface rendezvous follows terraform changes, ignoring separated overhead islands.
{
  const {c,w}=fixture();w.setBlock(35,11,35,BLOCK.GRASS);w.setBlock(35,18,35,BLOCK.GRASS);
  assert.equal(c.sieges.base().y,12,'rendezvous uses contiguous ground at the actual entrance');
}
// A blocked lead hands construction to the backup already at the launch.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const lead=c.sieges.spawn(s,s.queue.shift()),backup=c.sieges.spawn(s,s.queue.shift());
  Object.assign(lead.state,{x:35.5,y:11,z:35.5});Object.assign(backup.state,s.bridges[0].ladder);
  s.builderId=lead.id;lead.buildTravelProgress={...lead.state,tick:0};
  w.setBlock(36,11,35,BLOCK.STONE);
  s.tasks.unshift({x:36,y:11,z:35,id:BLOCK.AIR,key:'36,11,35',approach:true,work:{...lead.state},workerId:lead.id});
  game.tick=c.sieges.ticks(GOBLINS.siege.workerHandoffSeconds)+1;c.sieges.build(s,game.tick);
  assert.equal(s.builderId,backup.id,'backup takes over without a teleport or extra recruit');
  assert.ok(s.cursor>=1,'old builder-only obstruction work no longer holds up the bridge');
  assert.equal(w.getBlock(36,11,35),BLOCK.STONE,'obsolete clearing work is skipped');
}
// Construction searches can plan a descending stair from a raised platform.
{
  const {w}=fixture();w.setBlock(45,14,35,BLOCK.PLANKS);
  const path=findPath(w,{x:45,y:15,z:35},{x:40,y:11,z:35},{goalHeight:true,diagonal:false,
    canSupport:(x,y,z)=>y<=15 && w.getBlock(x,10,z)===BLOCK.GRASS,supportCost:2});
  assert.deepEqual(path.at(-1),{x:40,y:11,z:35},'support planning descends to the real yard height');
  let y=15;for(const node of path){assert.ok(Math.abs(node.y-y)<=1);y=node.y;}
}
// Above-island terrain must never become the village's construction surface.
{
  const {w,c}=fixture();w.centralTerrain={x0:0,z0:0,width:w.sizeX,top:w.naturalTop.slice()};
  w.setBlock(40,30,40,BLOCK.GRASS);w.naturalTop[40+w.sizeX*40]=30;
  assert.equal(surfaceHeight(w,40,40),10,'site planning stays on the original central island');
  assert.equal(c.sieges.surfaceFloor(40,40),11,'siege staging also stays on that island');
}
// A carrier can use the second lane after the original bridge lane is broken.
{
  const {c,game,w,f}=fixture(),g=[...c.members][1];g.siegeManaged=true;g.carrying=f;g.state.carrying=true;
  Object.assign(g.state,{x:40.5,y:11,z:35.5,onGround:true});w.setBlock(42,10,35,BLOCK.AIR);
  const road=Array.from({length:5},(_,i)=>({x:41.5+i,y:11,z:35.5}));
  for(let tick=1;tick<=300 && g.state.x<44;tick++){game.tick=tick;c.sieges.advance(g,road,'flag-cross:broken',GOBLINS.siege.carrierSpeed);}
  assert.ok(g.state.x>44,'carrier replans locally around the broken bridge lane');
  assert.equal(w.getBlock(42,10,35),BLOCK.AIR,'the test crosses via the surviving lane without repairing or flying over the gap');
}
// A builder keeps local steering after crossing the cached-route handoff distance.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const worker=c.sieges.spawn(s,s.queue.shift());worker.respawnJourney=null;
  Object.assign(worker.state,{x:40.5,y:11,z:35.5,onGround:true});
  worker.surfaceLaunchReached=true;worker.siegePhase='building';s.builderId=worker.id;
  s.bridges[0].deck=Array.from({length:16},(_,i)=>({x:40+i,y:10,z:35}));
  s.bridges[0].ladder={x:39.5,y:11,z:35.5};s.bridges[0].launch={x:40,y:10,z:35};
  s.tasks=[{x:56,y:10,z:35,id:BLOCK.PLANKS,key:'56,10,35',work:{x:55.5,y:11,z:35.5,bridge:true}}];s.cursor=0;
  for(let tick=1;tick<900 && s.cursor===0;tick++){game.tick=tick;c.sieges.build(s,tick);}
  assert.equal(w.getBlock(56,10,35),BLOCK.PLANKS,'builder reaches its work site instead of oscillating at localRange');
}
// A worker stranded on the far side repairs consecutive holes from its own bank.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  for(const b of s.tasks)w.setBlock(b.x,b.y,b.z,b.id);
  s.completedBlocks=new Map(s.bridges[0].blocks.filter(b=>b.id!==BLOCK.AIR).map(b=>[b.key,b]));
  s.cursor=s.tasks.length;s.landingTick=1;
  const gap=s.bridges[0].deck[Math.floor(s.bridges[0].deck.length/2)],next=s.bridges[0].deck[s.bridges[0].deck.findIndex(p=>p===gap)+1];
  const worker=c.sieges.spawn(s,{type:'goblinWorker',role:'builder'});worker.surfaceLaunchReached=true;worker.siegePhase='building';s.builderId=worker.id;
  const far=s.bridges[0].deck[s.bridges[0].deck.findIndex(p=>p===gap)+2];Object.assign(worker.state,{x:far.x+0.5,y:far.y+1,z:far.z+0.5,onGround:true});
  w.setBlock(gap.x,gap.y,gap.z,BLOCK.AIR);w.setBlock(next.x,next.y,next.z,BLOCK.AIR);
  for(let tick=20;tick<700;tick++){game.tick=tick;c.sieges.repair(s,tick);c.sieges.build(s,tick);}
  assert.equal(w.getBlock(gap.x,gap.y,gap.z),BLOCK.PLANKS);assert.equal(w.getBlock(next.x,next.y,next.z),BLOCK.PLANKS);
}
// Catapult bombs lob, while balloon bombs fall; only bombs announce an explosion.
{
  const {c,game}=fixture();const messages=[];game.broadcast=m=>messages.push(m);
  const shot=new SiegeShot(999,c.sieges,{x:70,y:30,z:40},{x:110,y:30,z:40},GOBLINS.catapult.bomb,true);
  for(let i=0;i<Math.floor(shot.duration/2);i++)shot.advance();
  assert.ok(shot.state.y>45,'bomb follows a high arc');
  c.sieges.impact({x:80,y:20,z:40},GOBLINS.catapult.boulder,false);c.sieges.flushImpacts(100);
  assert.equal(messages.filter(m=>m.type===S2C.SIEGE_EXPLOSION).length,0);
  c.sieges.impact({x:80,y:20,z:40},GOBLINS.catapult.bomb,true);c.sieges.flushImpacts(200);
  assert.equal(messages.filter(m=>m.type===S2C.SIEGE_EXPLOSION).length,1);
}
// Artillery remains grounded after taking a melee hit.
{
  const {c,game}=fixture();const cat=c.sieges.addMachine('goblinCatapult',{x:40.5,y:11,z:35.5});
  const attacker={id:999,state:{x:38,y:11,z:35.5}};
  const damage=game.damage;game.damage=()=>{};game.meleeHit(cat,3,attacker,2);game.damage=damage;
  assert.equal(cat.state.kx,0);assert.equal(cat.state.kz,0);assert.equal(cat.state.vy,0);
}
// Separation cannot push a wide goblin sideways along a one-block bridge.
{
  const {c,w}=fixture();const g=c.spawnGoblin('goblinBrute',false,9);
  for(let x=75;x<=85;x++)w.setBlock(x,20,40,BLOCK.PLANKS);
  Object.assign(g.state,{x:75.5,y:21,z:40.5,onGround:true});g.separation={x:0,z:1};
  for(let i=0;i<100;i++)g.move(w,{dx:85.5-g.state.x,dz:40.5-g.state.z},g.settings.speed);
  assert.ok(g.state.x>84 && Math.abs(g.state.z-40.5)<0.02,'wide goblin crosses with exact lane alignment');
  for(let i=0;i<100;i++)g.move(w,{dx:1,dz:0},g.settings.speed);
  assert.ok(g.state.x<86 && g.state.y>20.9,'goblin does not intentionally walk into the void');
  for(let x=86;x<=90;x++)w.setBlock(x,21,40,BLOCK.PLANKS);
  for(let i=0;i<180;i++)g.move(w,{dx:89.5-g.state.x,dz:40.5-g.state.z},g.settings.speed);
  assert.ok(g.state.x>89 && g.state.y>=21.9,'brute climbs the bridge landing step without leaving the lane');
}
// Marchers pass a grounded ladder without endlessly recentring on its rung.
{
  const {c,w}=fixture(),g=c.spawnGoblin('goblinSoldier',false,9);
  w.setBlock(45,11,35,BLOCK.LADDER);Object.assign(g.state,{x:45.7,y:11,z:35.5,onGround:true});
  const road=[{x:45.5,y:11,z:35.5},{x:46.5,y:11,z:35.5},{x:47.5,y:11,z:35.5}];
  for(let i=0;i<150;i++)c.sieges.advance(g,road,'cross:grounded-ladder');
  assert.ok(g.state.x>47,'route advances past the grounded ladder');
}
// Each higher rung is built without routing down to the tower's base again.
{
  const {c,game,w}=fixture();c.wood=10000;c.sieges.launch();const s=c.sieges.active;
  const worker=c.sieges.spawn(s,{type:'goblinWorker',role:'builder'});worker.surfaceLaunchReached=true;worker.siegePhase='building';s.builderId=worker.id;
  Object.assign(worker.state,{...s.bridges[0].ladder,onGround:true});
  s.tasks=s.tasks.filter(b=>b.work.climb);s.cursor=0;s.queue=[];
  let highest=worker.state.y,worstDescent=0;
  for(let tick=1;tick<600 && s.cursor<s.tasks.length;tick++) {
    game.tick=tick;c.sieges.build(s,tick);c.sieges.unit(worker,s,tick);
    highest=Math.max(highest,worker.state.y);worstDescent=Math.max(worstDescent,highest-worker.state.y);
  }
  assert.equal(s.cursor,s.tasks.length,'all tower work completes');assert.ok(worstDescent<0.5,'worker climbs progressively rather than returning to the bottom');
}
// Artillery cycles defenses and turrets even when a player is in firing range.
{
  const {c,game,w}=fixture();c.wood=10000;c.minimumTier=4;c.updateTier();c.sieges.launch();const s=c.sieges.active;
  const cat=c.sieges.addMachine('goblinCatapult',{x:80.5,y:15,z:40.5});
  game.turretController={turrets:new Map([['t',{x:128,y:15,z:42}]])};
  game.players.set(800,{id:800,connected:true,dead:false,creative:false,state:{x:135.5,y:15,z:40.5}});
  w.setBlock(125,15,40,BLOCK.PLANKS);
  const kinds=Array.from({length:4},()=>c.sieges.chooseCatapultTarget(s,cat).kind);
  assert.ok(kinds.includes('turret') && kinds.includes('defense') && kinds.includes('players'),'players never monopolize artillery targeting');
}
// River exits can reach a bank one block higher than the water surface.
{
  const {c,game,w}=fixture(),g=c.spawnGoblin('goblinWorker',false,9);g.siegeManaged=true;
  for(let x=43;x<=45;x++)w.setBlock(x,11,35,BLOCK.WATER);
  for(let x=46;x<=49;x++)w.setBlock(x,12,35,BLOCK.DIRT);
  Object.assign(g.state,{x:43.5,y:11,z:35.5,onGround:true});
  const road=[{x:44.5,y:12,z:35.5},{x:45.5,y:12,z:35.5},{x:46.5,y:13,z:35.5},{x:47.5,y:13,z:35.5}];
  for(let tick=1;tick<600 && g.state.x<47;tick++){game.tick=tick;c.sieges.advance(g,road,'river-bank');if(process.env.GOBLIN_WATER_TRACE && tick%10===0)console.log(tick,g.state.x,g.state.y,g.state.vx,g.state.vy,g.marchIndex,g.stuckTicks);}
  assert.ok(g.state.x>47 && g.state.y>=12.9,`worker leaves the river onto the raised bank: ${JSON.stringify({x:g.state.x,y:g.state.y,vy:g.state.vy,index:g.marchIndex})}`);
}
// A wall under a low roof requires a committed lateral detour, rather than
// alternating tiny backward/forward moves forever.
{
  const {c,game,w}=fixture();
  for(let x=30;x<=52;x++)for(let z=30;z<=40;z++)w.setBlock(x,25,z,BLOCK.PLANKS);
  for(let y=11;y<=25;y++)for(let z=30;z<=40;z++)w.setBlock(45,y,z,BLOCK.PLANKS);
  const m=c.sieges.addMachine('goblinBalloon',{x:40.5,y:18,z:35.5}),goal={x:60.5,y:18,z:35.5};m.phase='outbound';
  let arrived=false;
  for(let tick=1;tick<600 && !arrived;tick++){
    game.tick=tick;const before={...m.state};arrived=c.sieges.flyBalloon(m,goal);
    assert.ok(c.sieges.balloonClear(m.state),'balloon never clips the roof or wall');
    assert.ok(Math.hypot(m.state.x-before.x,m.state.y-before.y,m.state.z-before.z)<=GOBLINS.balloon.speed/20+0.001,'detours move at flight speed');
  }
  assert.ok(arrived,'balloon reaches the goal around the wall');
}
// Homebound carriers and machine crews use the surface route to the entrance,
// even when an apparently shorter diggable cave route exists below a wall.
{
  const {c,game,w}=fixture(),g=c.spawnGoblin('goblinSoldier',false,9);
  for(let z=0;z<w.sizeZ;z++)for(let y=11;y<=14;y++){
    w.setBlock(45,y,z,BLOCK.GOBLIN_BRICKS);c.intended.set(`45,${y},${z}`,{id:BLOCK.GOBLIN_BRICKS});
  }
  for(let x=40;x<=53;x++){
    const floor=Math.min(10,6+Math.max(0,x-49)+Math.max(0,44-x));
    w.setBlock(x,floor,35,BLOCK.DIRT);
    for(let y=floor+1;y<floor+3;y++)w.setBlock(x,y,35,BLOCK.AIR);
  }
  Object.assign(g.state,{x:60.5,y:11,z:35.5,onGround:true});
  for(let tick=1;tick<300;tick++){
    game.tick=tick;c.sieges.moveGoal(g,{x:35.5,y:11,z:35.5},'flag-base:99');
    assert.ok(g.state.y>=9.9,'homebound goblin does not descend into the cave shortcut');
  }
}
// A low building roof is not mistaken for a ground launch pad.
{
  const {c,w}=fixture();c.buildings.push({kind:'dwelling',box:{x0:33,x1:39,z0:32,z1:39,y0:10,y1:13}});
  for(let z=32;z<=39;z++)for(let x=33;x<=39;x++)w.setBlock(x,12,z,BLOCK.PLANKS);
  const pad=c.sieges.balloonLaunch();assert.ok(pad && pad.y===11,'balloon begins on clear ground beside the building');
  assert.ok(c.sieges.balloonClear(pad));
}
console.log('Goblin siege checks passed');
