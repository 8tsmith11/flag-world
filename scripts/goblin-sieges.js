// Actual world/economy match, no connected defenders. Time scale affects
// timers; walking/flight remain real speeds. Output is evidence, not assertions
// that the siege is unbeatable. GOBLIN_TIME_SCALE=8 node scripts/goblin-sieges.js
import { Game } from '../server/game.js';
import { generateWorld, WORLD_SIZES } from '../shared/worldgen.js';
import { GoblinController } from '../server/goblins.js';
import { SaplingGrowth } from '../server/saplings.js';
import { Flag } from '../server/flag.js';
import { flagHome } from '../shared/structures.js';
import { BLOCK, isWater } from '../shared/blocks.js';
import { Player } from '../server/player.js';
import { moduleAt } from '../shared/goblinModules.js';
import { findPath } from '../server/pathfind.js';
import { wallProject } from '../server/goblinProjects.js';
import { planSiege } from '../server/goblinSiegePlan.js';
import { GOBLINS, goblinCap } from '../shared/goblins.js';
import { TICK_RATE } from '../shared/config.js';
import assert from 'node:assert/strict';
const sizes=process.argv[2] ? [process.argv[2]] : Object.keys(WORLD_SIZES);
const seconds=Number(process.argv[3] ?? 7200);
const scenario=process.argv[4] ?? 'progression';
for(const size of sizes) {
  const game=new Game();game.seed=12345;game.worldSize=size;
  game.world=generateWorld(game.seed,2,size);
  game.world.keeps.forEach((k,i)=>game.flags.set(i+100,new Flag(i+100,0xff0000,flagHome(k),i)));
  game.saplings=new SaplingGrowth(game.world,()=>false,(x,y,z)=>game.goblins?.saplingGrowTime(x,y,z));
  game.world.onBlockChanged=(x,y,z,id,old)=>{
    game.goblins?.blockChanged(x,y,z,id,old);
    if(old===BLOCK.SAPLING && id!==old)game.saplings.removed(x,y,z);
    if(id===BLOCK.SAPLING && id!==old)game.saplings.planted(x,y,z,game.tick);
  };
  game.goblins=new GoblinController(game);game.goblins.spawnAll();
  let observer=null;
  const packets={spawns:0,despawns:0,status:0},homeCounts=[],siegeHome=[];
  if(scenario==='fortress' || scenario==='fortress-tier4' || scenario==='mature-distant') {
    game.flags.clear();game.goblins.startFastBuild();
    for(let tick=1;tick<=2000 && game.goblins.fastBuild;tick++) {
      game.tick=tick;game.saplings.tick(tick);game.goblins.update(tick);
    if(observer) {
      game.updateMobs();game.syncGoblinInterest();
    }
    homeCounts.push(game.goblins.population());
    }
    game.world.keeps.forEach((k,i)=>game.flags.set(i+100,new Flag(i+100,0xff0000,flagHome(k),i)));
    if(scenario.startsWith('fortress')) {
      const c=game.goblins,spot={x:c.hall.box.x0+2.5,y:c.hall.floorY,z:c.hall.box.z0+2.5};
      observer=new Player(1000,{readyState:1,send(raw){
        const m=JSON.parse(raw);
        if(m.type==='entitySpawn')packets.spawns++;
        if(m.type==='entityDespawn')packets.despawns++;
        if(m.type==='goblinStatus')packets.status++;
      }},'Fortress observer',0xff0000,spot,0);
      observer.creative=true;observer.state.creative=true;observer.immortal=true;
      observer.flag=game.flags.get(100);observer.keep=game.world.keeps[0];
      game.players.set(observer.id,observer);
    }
    if(scenario==='fortress-tier4'){game.goblins.minimumTier=4;game.goblins.updateTier();}
    if(process.env.GOBLIN_TARGET_TEAM!==undefined) {
      const c=game.goblins;c.sieges.pending=planSiege(c,{team:Number(process.env.GOBLIN_TARGET_TEAM),reason:'test scenario'},c.tier,c.sieges.history,c.sieges.machines);
    }
    game.goblins.sieges.launch(true);
  }
  homeCounts.length=0;
  const baseTick=game.tick;
  const defenderReturns=[],behaviorSamples=[];
  const postSiegeTicks=Number(process.env.GOBLIN_POST_SIEGE_SECONDS ?? 0)*TICK_RATE;
  let endedAt=null;
  for(let tick=baseTick+1;tick<=baseTick+seconds*TICK_RATE;tick++) {
    game.tick=tick;game.saplings.tick(tick);game.goblins.update(tick);
    assert.ok(Number.isFinite(game.goblins.sim.workerCredit),`finite labor credit: ${JSON.stringify({tick,project:game.goblins.project?.label,trip:game.goblins.project?.tripTime,repairTasks:game.goblins.repairs.tasks.filter(t=>!t.done).map(t=>({kind:t.kind,y:t.y,climb:t.climb,trip:t.project.tripTime}))})}`);
    if(observer) {
      game.updateMobs();game.syncGoblinInterest();
    }
    game.updateArrows();game.updateFlags();
    homeCounts.push(game.goblins.population());
    const active=game.goblins.sieges.active;
    if(active) {
      let record=siegeHome.find((r)=>r.id===active.id);
      if(!record) {record={id:active.id,min:Infinity,max:0,slotReplacements:0};siegeHome.push(record);}
      record.min=Math.min(record.min,game.goblins.population());record.max=Math.max(record.max,game.goblins.population());
    }
    if(process.env.GOBLIN_TRACE && tick%2000===0)console.log(JSON.stringify({trace:true,tick,tier:game.goblins.tier,wood:game.goblins.wood,project:game.goblins.project?.label,worker:game.goblins.sieges.status().workers,journeys:active?[...active.army].map(id=>game.goblins.sieges.roster.get(id)).filter(g=>g?.siegeRole==='builder').map(g=>({id:g.id,goal:g.respawnJourney?.at(-1),action:g.journeyRoute?.actions[g.journeyRoute.index],local:g.journeyRoute?.local?.slice(0,2),stuck:g.stuckTicks})):[],phase:active?.phase,cursor:active?.cursor,total:active?.tasks.length}));
    if(active && tick%400===0) {
      behaviorSamples.push({tick,siege:active.id,phase:active.phase,cursor:active.cursor,total:active.tasks.length,
        spawned:active.spawned,remaining:active.queue.length,workers:game.goblins.sieges.status().workers,
        roles:[...active.army].map(id=>game.goblins.sieges.roster.get(id)).filter(Boolean).reduce((out,g)=>{
          const key=`${g.siegeRole}:${g.siegePhase}`;out[key]=(out[key] ?? 0)+1;return out;},{}),
        machines:game.goblins.sieges.status().machines});
    }
    if(tick%200===0) {
      game.pendingBlockChanges.clear();
      for(const flag of game.flags.values()) if(scenario==='progression' && flag.state==='held') {
        // Test defender reaches the pedestal; the production onFlag/return
        // rules are exercised separately in goblin-siege-checks.js.
        defenderReturns.push({tick,team:flag.team});game.returnFlag(flag);
      }
    }
    if(scenario!=='progression' && game.goblins.events.some((e)=>e.event==='siegeEnd' && e.tick>baseTick)) {
      endedAt ??= tick;game.goblins.sieges.pending=null;game.goblins.sieges.nextPlan=Infinity;
      if(tick-endedAt>=postSiegeTicks)break;
    }
    if(scenario==='progression' && game.goblins.tier===4 && game.goblins.events.some((e)=>e.event==='siegeEnd' && e.tier===4))break;
    if(process.env.GOBLIN_STOP_AT_CAPS && !game.goblins.project
      && game.goblins.dwellings()>=goblinCap(GOBLINS.caps.dwellings,size)
      && game.goblins.brickModules()>=goblinCap(GOBLINS.caps.modules,size))break;
  }
  const c=game.goblins,s=c.sieges.active;
  const outerDiagnostics={};
  if(!c.outerWallBuilt)wallProject(game.world,c,c.buildings.filter(b=>['dwelling','plot','gatehouse'].includes(b.kind)&&b.intact),true,outerDiagnostics);
  console.log(JSON.stringify({size,scenario,seed:game.seed,scale:process.env.GOBLIN_TIME_SCALE ?? 1,
    simulatedSeconds:game.tick/TICK_RATE,baseTick,postSiegeSeconds:endedAt===null?0:(game.tick-endedAt)/TICK_RATE,packets,
    observerInside:observer ? !!moduleAt(c.fortress,observer.state.x,observer.state.y+0.1,observer.state.z):null,
    observerAlive:observer ? !observer.dead:null,homeMin:homeCounts.reduce((a,b)=>Math.min(a,b),Infinity),homeMax:homeCounts.reduce((a,b)=>Math.max(a,b),0),supportedSizes:Object.keys(WORLD_SIZES),tier:c.tier,wood:c.wood,
    homePopulation:c.population(),capacity:c.capacity(),base:c.status(),construction:c.project&&{label:c.project.label,done:c.project.done,total:c.project.total,progress:c.project.progress(),trip:c.project.tripTime},labor:{worker:c.sim.workerCredit,place:c.sim.placeCredit},outerDiagnostics,siegeHome,defenderReturns,behaviorSamples,flags:[...game.flags.values()].map((f)=>f.snapshot()),
    events:c.events.filter((e)=>['tierUnlocked','siegeLaunch','siegeSpawnGroup','siegeBridgeLanded','siegeEnd','siegeBalloon','siegeFlagHeld','siegeGliderDrop','siegeCatapultShot','siegeWorkerHandoff'].includes(e.event)),
    survivors:[...c.sieges.roster.values()].filter((g)=>g.carrying || g.siegeRole==='crew').map((g)=>({id:g.id,role:g.siegeRole,phase:g.siegePhase,returnStage:g.returnStage,x:g.state.x,y:g.state.y,z:g.state.z,march:g.march?.[g.marchIndex],key:g.marchKey})),
    bridges:[...c.sieges.history.values()].flatMap((h)=>h.bridges).map((b)=>({deck:b.deck.slice(0,8).map((p)=>({...p,id:game.world.getBlock(p.x,p.y,p.z)}))})),
    active:s && {cursor:s.cursor,total:s.tasks.length,next:s.tasks[s.cursor],phase:s.phase,
      army:[...s.army].map((id)=>c.sieges.roster.get(id)).filter(Boolean).map((g)=>({id:g.id,role:g.siegeRole,
        phase:g.siegePhase,position:{x:g.state.x,y:g.state.y,z:g.state.z},journey:!!g.respawnJourney,journeyAction:g.journeyRoute?.actions[g.journeyRoute?.index],local:g.journeyRoute?.local,
        march:g.march?.[g.marchIndex],key:g.marchKey}))},status:c.sieges.status(),walls:c.buildings.filter(b=>b.kind==='wall').map(w=>({kind:w.template,gates:w.gates.map(p=>({...p,blocks:Array.from({length:5},(_,i)=>c.world.getBlock(Math.floor(p.x),Math.floor(p.y)+i-1,Math.floor(p.z))),intended:c.intended.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)?.id}))})),pathTests:s?[...s.army].map(id=>c.sieges.roster.get(id)).filter(g=>g?.siegeRole==='builder').map(g=>{const goal=s.bridges[0].ladder,cached=c.sieges.path(g.state,goal,true),fresh=findPath(c.world,{x:Math.floor(g.state.x),y:Math.round(g.state.y),z:Math.floor(g.state.z)},{x:Math.floor(goal.x),y:Math.round(goal.y),z:Math.floor(goal.z)},{maxNodes:50000,goalHeight:true,allowed:(x,y,z)=>{const f=c.sieges.surfaceFloor(x,z);return f!==null&&y>=f-1;}});const waterWorld={getBlock:(x,y,z)=>{const id=c.world.getBlock(x,y,z);return isWater(id)?BLOCK.STONE:id;}};const waterWalk=findPath(waterWorld,{x:Math.floor(g.state.x),y:Math.round(g.state.y),z:Math.floor(g.state.z)},{x:Math.floor(goal.x),y:Math.round(goal.y),z:Math.floor(goal.z)},{maxNodes:50000,goalHeight:true});const unrestricted=findPath(c.world,{x:Math.floor(g.state.x),y:Math.round(g.state.y),z:Math.floor(g.state.z)},{x:Math.floor(goal.x),y:Math.round(goal.y),z:Math.floor(goal.z)},{maxNodes:50000,goalHeight:true});return {id:g.id,goal,waterWalk:waterWalk.length,waterWalkEnd:waterWalk.at(-1),unrestricted:unrestricted.length,unrestrictedEnd:unrestricted.at(-1),cached:cached.length,cachedEnd:cached.at(-1),fresh:fresh.length,freshEnd:fresh.at(-1)};}):[],debugWorkers:[...c.sieges.roster.values()].filter(g=>g.type==='goblinWorker').map(g=>({id:g.id,phase:g.siegePhase,stuck:g.stuckTicks,route:g.route,work:g.workActivity,goalKey:g.localGoalKey,state:g.state,marchIndex:g.marchIndex,next:g.march?.[g.marchIndex],nearby:Array.from({length:5},(_,i)=>i-2).flatMap(dx=>Array.from({length:5},(_,i)=>i-2).map(dz=>({dx,dz,floor:c.sieges.surfaceFloor(Math.floor(g.state.x)+dx,Math.floor(g.state.z)+dz),blocks:Array.from({length:5},(_,dy)=>game.world.getBlock(Math.floor(g.state.x)+dx,Math.floor(g.state.y)+dy-1,Math.floor(g.state.z)+dz))})))}))}));
}
