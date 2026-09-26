// One always-running siege economy. Roster objects survive changes in client
// interest; home slots are never borrowed. Each army has a finite spawn queue.
import { GOBLINS, goblinTicks } from '../shared/goblins.js';
import { TICK_RATE, CLIMB_SPEED, CARRY_SPEED_SCALE } from '../shared/config.js';
import { BLOCK, isSolid, isClimbable, isWater, getBlockDef } from '../shared/blocks.js';
import { FLAG_STATE, S2C } from '../shared/protocol.js';
import { GoblinWorker, GoblinSoldier, GoblinArcher, GoblinHound, GoblinBrute } from './goblin.js';
import { SiegeMachine, SiegeShot, resolveImpact } from './goblinMachines.js';
import { chooseSiegeTarget, planSiege, settlementBlocksLaunch } from './goblinSiegePlan.js';
import { blockKey, isProtected, goblinBreakTicks, isGround, centralTerrainHeight } from './goblinProjects.js';
import { canStand, findPath } from './pathfind.js';
import { stepPlayer, playerFitsAt, isOnLadder, isInWater } from '../shared/physics.js';
import { canSee, huntable } from './provocation.js';

const TYPES = { goblinWorker: GoblinWorker, goblinSoldier: GoblinSoldier, goblinArcher: GoblinArcher,
  goblinHound: GoblinHound, goblinBrute: GoblinBrute };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const node = (p) => ({ x: Math.floor(p.x), y: Math.round(p.y), z: Math.floor(p.z) });
const center = (p) => ({ x: p.x+0.5, y: p.y, z: p.z+0.5 });

export class GoblinSieges {
  constructor(c) {
    this.c = c; this.active = null; this.pending = null;
    this.roster = new Map(); this.machines = new Map(); this.history = new Map();
    this.protectedBridge = new Set(); this.completedTier3 = 0; this.nextPlan = 0;
    this.flowFields = new Map(); this.nextRepair = 0;this.towerSites=new Map();
  }
  ticks(seconds) { return goblinTicks(seconds,TICK_RATE); }
  base() {
    const outside=this.c.entrances.find((e)=>e.open && !e.sealed)?.outside;
    if(!outside)return this.c.totemSpot;
    const x=Math.floor(outside.x),z=Math.floor(outside.z),world=this.c.world;
    let y=Math.round(outside.y)-1;
    const low=y-GOBLINS.walls.gateRampLength,high=y+GOBLINS.walls.terrainRise;
    while(y>low && !isGround(world.getBlock(x,y,z)))y--;
    if(!isGround(world.getBlock(x,y,z)))return outside;
    while(y<high && isGround(world.getBlock(x,y+1,z)))y++;
    return {...outside,y:y+1};
  }
  prepare() {
    const target = chooseSiegeTarget(this.c.game, this.c.random);
    if (!target || !this.c.surfaceOpen() || !this.c.totemAlive) return null;
    this.pending = planSiege(this.c,target,this.c.tier,this.history,this.machines);
    return this.pending;
  }
  reserve() { return this.pending?.needed ?? 0; }
  launch(force = false) {
    if (this.active || !this.c.totemAlive) return false;
    if(this.pending?.tier!==this.c.tier)this.pending=null;
    let plan = this.pending ?? this.prepare();
    if(plan && plan.mode!=='reuse' && plan.bridges.some(b=>settlementBlocksLaunch(this.c,b.launch))) {
      this.pending=null;plan=this.prepare();
    }
    if (!plan) return false;
    if (!force && this.c.wood < plan.needed) return false;
    if (![...this.c.game.flags.values()].some((f) => f.team === plan.target.team && f.state === FLAG_STATE.HOME)) {
      this.pending = null; return false;
    }
    const storage = this.c.wood;
    this.c.wood = Math.max(0,this.c.wood-plan.needed); this.pending = null;
    const budget = { ...GOBLINS.siege.budgets[plan.tier] };
    // Workers and initial escorts precede the main force. Machine personnel
    // are real individuals drawn from the same queue, including every rider.
    const queue = [];
    const push = (role,type,count) => { for (let i=0;i<count;i++) queue.push({role,type}); };
    push('builder','goblinWorker',budget.goblinWorker ?? 0);
    push('fighter','goblinSoldier',Math.min(2,budget.goblinSoldier ?? 0));
    push('crew','goblinWorker',budget.crew ?? 0);
    for (const [type,count] of Object.entries(budget)) if (TYPES[type] && type !== 'goblinWorker')
      push('fighter',type,count-(type === 'goblinSoldier' ? Math.min(2,count) : 0));
    push('pilot','goblinSoldier',budget.pilot ?? 0);
    for(let i=0;i<(budget.riders ?? 0);i++)push('rider',GOBLINS.balloon.riderTypes[i%GOBLINS.balloon.riderTypes.length],1);
    const s = this.active = { ...plan, id: this.c.game.tick, launchTick: this.c.game.tick,
      nextSpawn: this.c.game.tick, queue, budget, spawned: 0, phase: 'approach', landingTick: null,
      nextWork: 0, army: new Set(), spawnGroups: [], woodStorage: storage, force,
      towerComplete: null, bridgeComplete: null,
      completedBlocks:new Map(plan.bridges.flatMap((b)=>b.blocks).concat(plan.platform ?? [])
        .filter((b)=>b.id!==BLOCK.AIR && this.c.world.getBlock(b.x,b.y,b.z)===b.id).map((b)=>[b.key,b])) };
    const record = this.history.get(plan.target.team); record.count++;
    record.bridges = plan.bridges;
    for (const b of plan.bridges.flatMap((b) => b.blocks).concat(plan.platform ?? []))
      if(b.id!==BLOCK.AIR)this.protectedBridge.add(b.key);
    for(const b of plan.bridges) {
      b.cursor=0;const margin=GOBLINS.siege.towerClearance;
      this.towerSites.set(`${b.launch.x},${b.launch.z}`,{
        x0:Math.floor(Math.min(b.launch.x,b.ladder.x))-margin,x1:Math.floor(Math.max(b.launch.x,b.ladder.x))+margin,
        z0:Math.floor(Math.min(b.launch.z,b.ladder.z))-margin,z1:Math.floor(Math.max(b.launch.z,b.ladder.z))+margin,
        y0:b.launch.y,y1:b.deck[0].y+2,origin:{x:b.launch.x,y:b.launch.y,z:b.launch.z},tower:true});
    }
    if (plan.oldMachine) { plan.oldMachine.siegeId = s.id; plan.oldMachine.phase = 'waitingCrew'; }
    this.c.game.broadcast({type:S2C.CHAT,text:'A goblin siege is underway',kind:'event'});
    this.c.game.broadcast({type:S2C.GOBLIN_SIEGE_DECLARED,...this.base(),target:plan.target.team});
    this.c.log('siegeLaunch',{tier:plan.tier,target:plan.target.team,reason:plan.target.reason,
      bridgePlan:plan.mode, bridges:plan.bridges.length,woodCost:plan.wood,reserved:plan.needed,
      storage,force,platform:!!plan.platform,budget,homePopulation:this.c.population()});
    return true;
  }
  spawn(s,entry) {
    if(['pilot','rider'].includes(entry.role)) {
      if(!s.balloon) {
        const spot=this.balloonLaunch();
        if(!spot || !this.balloonClear(spot))return null;
        const half=Math.floor(GOBLINS.balloon.launchPadSize/2);
        for(let dx=-half;dx<=half;dx++)for(let dz=-half;dz<=half;dz++) {
          const x=Math.floor(spot.x)+dx,z=Math.floor(spot.z)+dz,y=Math.floor(spot.y)-1;
          if(!isProtected(this.c.world.getBlock(x,y,z)))this.c.setBlock(x,y,z,BLOCK.PLANKS);
        }
        s.balloon=this.addMachine('goblinBalloon',spot,s.target.team);
        s.balloon.siegeId=s.id;s.balloon.phase='loading';
        s.balloon.bombs=s.tier>=4?GOBLINS.balloon.bombs:0;
      }
      const m=s.balloon,st=m.state;
      const g=new TYPES[entry.type](this.c.game.nextId++,this.c,st.x,st.y,st.z,{stray:true});
      g.siegeManaged=true;g.siegeId=s.id;g.siegeRole=entry.role;g.aboard=m;g.siegePhase='aboard';
      g.siegePlan=s;g.bridgeIndex=0;s.army.add(g.id);this.roster.set(g.id,g);this.c.add(g);s.spawned++;
      if(entry.role==='pilot')m.crew=g;else m.cargo.push(g);
      return g;
    }
    const viewers=[...this.c.game.players.values()].filter((p)=>p.connected);
    const entrance=this.c.entrances.find((e)=>e.open && !e.sealed);
    const mouths=(entrance?.columns ?? []).map((p)=>({x:p.x+0.5,y:entrance.floorY,z:p.z+0.5}));
    const points=[...mouths,this.c.totemSpot,...this.c.fortress.modules.filter((m)=>!m.building && !m.removed).map((m)=>m.center)];
    const t=points.find((p)=>!viewers.some((v)=>canSee(this.c.world,{x:p.x,y:p.y+1,z:p.z},v)));
    if(!t)return null;
    const g = new TYPES[entry.type](this.c.game.nextId++,this.c,t.x,t.y,t.z,{stray:true});
    g.siegeManaged = true; g.siegeId = s.id; g.siegeRole = entry.role; g.breaksObstacles = true;
    g.bridgeIndex = s.spawned % s.bridges.length;
    g.siegePhase = 'emerging'; g.returning = false;
    s.army.add(g.id); this.roster.set(g.id,g); this.c.add(g);
    // Same scripted module/shaft travel as replacements, planned from inside.
    g.stray = false; this.c.sim.startJourney(g,this.base()); g.stray = true;
    s.spawned++;
    return g;
  }
  // Shared reverse route field: one A* spine per goal/start region/revision,
  // reused by the whole marching group. Individuals keep their own cursor.
  surfaceFloor(x,z) {
    const w=this.c.world,island=w.islands?.find((i)=>['center','central'].includes(i.kind));
    if(!island || !Number.isFinite(island.topY))return null;
    this.surfaceColumns ??= new Map();
    const key=`${x},${z}:${this.c.navigationRevision}`;
    if(this.surfaceColumns.has(key))return this.surfaceColumns.get(key);
    let floor=null;
    const native=w.centralTerrain?centralTerrainHeight(w,x,z):island.topY;
    for(let y=Math.min(w.sizeY-1,native);y>=island.bottomY;y--)
      if(isGround(w.getBlock(x,y,z))) {while(y<w.sizeY-1 && isGround(w.getBlock(x,y+1,z)))y++;floor=y+1;break;}
    if(this.surfaceColumns.size>10000)this.surfaceColumns.clear();
    this.surfaceColumns.set(key,floor);return floor;
  }
  path(from,to,surface=false) {
    const a=node(from), b=node(to);
    const key = `${a.x},${a.y},${a.z}:${b.x},${b.y},${b.z}:${this.c.navigationRevision}:${surface}`;
    if (this.flowFields.has(key)) return this.flowFields.get(key);
    const goalKey=`${b.x},${b.y},${b.z}:${this.c.navigationRevision}:${surface}`;
    this.fields ??= new Map();
    let field=this.fields.get(goalKey);
    if(!field) {if(this.fields.size>128)this.fields.clear();field=new Map();this.fields.set(goalKey,field);}
    const nk=(p)=>`${Math.floor(p.x)},${Math.round(p.y)},${Math.floor(p.z)}`;
    const shared=[],visited=new Set();let current=a;
    while(field.has(nk(current)) && !visited.has(nk(current))) {
      visited.add(nk(current));current=field.get(nk(current));shared.push(current);
    }
    if(shared.length && distance(current,to)<2) {this.flowFields.set(key,shared);return shared;}
    const path = findPath(this.c.world,a,b,{maxNodes:GOBLINS.siege.routeNodes,goalHeight:true,allowWater:true,breakCost:GOBLINS.siege.pathBreakCost,
      canBreak:(x,y,z,id)=>!isProtected(id)
        && (!this.c.intended.has(blockKey(x,y,z)) || this.c.intended.get(blockKey(x,y,z)).id!==id || isGround(id))
        && !(this.protectedBridge.has(blockKey(x,y,z)) && (id===BLOCK.PLANKS || isClimbable(id))),allowed:surface?(x,y,z)=>{const floor=this.surfaceFloor(x,z);return floor!==null && y>=floor-GOBLINS.siege.surfaceTolerance;}:null});
    const points = path.map(center);
    if (points.length && distance(points.at(-1),to) < 2) {
      if(isSolid(this.c.world.getBlock(Math.floor(to.x),Math.round(to.y)-1,Math.floor(to.z)))
        && !isSolid(this.c.world.getBlock(Math.floor(to.x),Math.round(to.y),Math.floor(to.z))))points.push({...to});
      let previous=from;
      for(const p of points) {field.set(nk(previous),p);previous=p;}
    }
    if (this.flowFields.size > 128) this.flowFields.clear();
    this.flowFields.set(key,points); return points;
  }
  setRoute(g,points,key) {
    if (g.marchKey === key) return;
    g.marchKey = key; g.march = points; g.marchIndex = 0;
    if(points.length && !points[0].climb && !isOnLadder(g.state,this.c.world) && canStand(this.c.world,Math.floor(g.state.x),Math.round(g.state.y),Math.floor(g.state.z),2)) {
      const start={x:Math.floor(g.state.x)+0.5,y:Math.round(g.state.y),z:Math.floor(g.state.z)+0.5};
      if(distance(g.state,start)>GOBLINS.navigation.waypointReach)g.march=[start,...points];
    }
  }
  advance(g,points,key,speed=g.settings.speed) {
    // Player physics already applies the carrier slowdown.
    if(g.carrying)speed/=CARRY_SPEED_SCALE;
    this.setRoute(g,points,key);
    const s = g.state, p = g.march[g.marchIndex];
    if (!p) { g.walking=false; return true; }
    const detour=g.bridgeDetour;
    if(detour && detour.key===key) {
      if(canStand(this.c.world,Math.floor(p.x),Math.round(p.y),Math.floor(p.z),2)) {g.bridgeDetour=null;g.route=null;}
      else {
        if(g.walkTo(this.c.world,detour.goal,speed,{urgent:true})) {g.marchIndex=detour.resume+1;g.bridgeDetour=null;g.route=null;}
        return g.marchIndex>=g.march.length;
      }
    }
    if (!p) { g.walking=false; return true; }
    const d = distance(s,p), climbing = !!p.climb;
    const waterHere=isInWater(s,this.c.world);
    if(g.swimExit && s.onGround && !waterHere)g.swimExit=false;
    const swimming=!climbing && (g.swimExit || waterHere
      || [0,-1].some(dy=>isWater(this.c.world.getBlock(Math.floor(p.x),Math.round(p.y)+dy,Math.floor(p.z)))
        || isWater(this.c.world.getBlock(Math.floor(s.x),Math.floor(s.y)+dy,Math.floor(s.z)))));
    if(swimming) {
      g.swimExit=true;
      const guard=s.edgeGuard;s.edgeGuard=false;g.crouching=false;
      g.move(this.c.world,{dx:p.x-s.x,dz:p.z-s.z,swim:true},speed*GOBLINS.siege.swimSpeedScale);s.edgeGuard=guard;
      if(g.stuckTicks>20){this.requestClear(g,p);this.smash(g,p,this.c.game.tick);}
      if(Math.hypot(s.x-p.x,s.z-p.z)<0.3 && Math.abs(s.y-p.y)<=GOBLINS.siege.swimWaypointHeight)g.marchIndex++;
      return g.marchIndex>=g.march.length;
    }
    if(climbing && Math.abs(p.y-s.y)>0.3 && Math.hypot(p.x-s.x,p.z-s.z)<0.2
      && !isOnLadder(s,this.c.world)
      && !isClimbable(this.c.world.getBlock(Math.floor(s.x),Math.floor(s.y)-1,Math.floor(s.z)))) {
      g.climbing=false;this.smash(g,p,this.c.game.tick);g.move(this.c.world,null,speed);return false;
    }
    if(climbing && Math.hypot(p.x-s.x,p.z-s.z)>0.1) {
      const horizontal=Math.hypot(p.x-s.x,p.z-s.z),rate=speed/TICK_RATE;
      if(horizontal>1.5) {this.moveGoal(g,{...p,y:s.y},`ladder-align:${key}`,speed);return false;}
      const k=Math.min(1,rate/horizontal),next={...s,x:s.x+(p.x-s.x)*k,z:s.z+(p.z-s.z)*k};
      if(playerFitsAt(this.c.world,next,s.y)) {s.x=next.x;s.z=next.z;g.climbing=true;}
      else g.move(this.c.world,{dx:p.x-s.x,dz:p.z-s.z},speed);
      return false;
    }
    const rate = climbing ? CLIMB_SPEED * (g.settings.climbScale ?? 1) : speed;
    const step = Math.min(d,rate/TICK_RATE), k = d ? step/d : 1;
    // Walks on known support, or on a scripted shaft/ladder segment. Missing
    // bridge support stops the march until a siege worker repairs it.
    const nx=s.x+(p.x-s.x)*k, nz=s.z+(p.z-s.z)*k;
    let ny=s.y+(p.y-s.y)*k;
    if (!climbing && !g.gliding) {
      // After descending, the body can still overlap the final rung. Walk
      // off it before applying grounded-step checks; otherwise ladder physics
      // holds the carrier above the floor indefinitely.
      if(isOnLadder(s,this.c.world)) {
        g.move(this.c.world,{dx:p.x-s.x,dz:p.z-s.z},speed);
        if(Math.hypot(s.x-p.x,s.z-p.z)<Math.min(GOBLINS.navigation.waypointReach,0.5-s.box.halfW-0.01) && Math.abs(s.y-p.y)<0.3)g.marchIndex++;
        return g.marchIndex>=g.march.length;
      }
      const world=this.c.world,x=Math.floor(nx),z=Math.floor(nz);
      if(Math.hypot(p.x-s.x,p.z-s.z)<=GOBLINS.siege.clearRange && Math.abs(p.y-s.y)<=1.1
        && [0,1].some(dy=>isSolid(world.getBlock(Math.floor(p.x),Math.round(p.y)+dy,Math.floor(p.z))))) {
        this.requestClear(g,p);this.smash(g,p,this.c.game.tick);g.move(world,null,speed);return false;
      }
      // Stair steps change height when entering the supporting column. A
      // diagonal interpolation through a step would be falsely unsupported.
      const foot=[Math.round(s.y),Math.round(p.y),Math.round(s.y)+1,Math.round(s.y)-1]
        .find((y)=>Math.abs(y-s.y)<=1.1 && (isSolid(world.getBlock(x,y-1,z))
          || isClimbable(world.getBlock(x,y-1,z))) && !isSolid(world.getBlock(x,y,z)));
      if(foot===undefined || Math.abs(p.y-s.y)>1.1
        || Math.hypot(p.x-nx,p.z-nz)<0.1 && Math.abs(p.y-ny)>0.1
          && !isSolid(world.getBlock(Math.floor(p.x),Math.round(p.y)-1,Math.floor(p.z)))
          && !isClimbable(world.getBlock(Math.floor(p.x),Math.round(p.y)-1,Math.floor(p.z)))) {
        if(!s.onGround)g.move(world,null,speed);
        g.walking=false;
        if(['cross:','flag-cross:','crew-return'].some(prefix=>key.startsWith(prefix)) && !p.climb) {
          const resume=g.march.findIndex((node,i)=>i>g.marchIndex && i<=g.marchIndex+GOBLINS.siege.bridgeDetourNodes && !node.climb
            && canStand(world,Math.floor(node.x),Math.round(node.y),Math.floor(node.z),2));
          if(resume>=0) {g.bridgeDetour={key,resume,goal:g.march[resume]};g.route=null;}
        }
        if(!['cross:','flag-cross:','build:','crew-return'].some((prefix)=>key.startsWith(prefix)))g.marchKey=null;
        g.nextMarchPlan=this.c.game.tick+Math.round(GOBLINS.siege.routeRefresh*TICK_RATE);this.requestClear(g,p);this.smash(g,p,this.c.game.tick);return false;
      }
      const backward=g.crouching;
      s.yaw=Math.atan2(-(p.x-s.x),-(p.z-s.z));
      g.move(this.c.world,{dx:p.x-s.x,dz:p.z-s.z},speed);
      if(backward)s.yaw=Math.atan2(p.x-s.x,p.z-s.z);
      if(Math.hypot(s.x-p.x,s.z-p.z)<Math.min(GOBLINS.navigation.waypointReach,0.5-s.box.halfW-0.01) && Math.abs(s.y-p.y)<0.3)g.marchIndex++;
      if(g.stuckTicks>20) {
        this.requestClear(g,p);this.smash(g,p,this.c.game.tick);
        if(!['cross:','flag-cross:','build:','crew-return'].some((prefix)=>key.startsWith(prefix))) {
          g.marchKey=null;this.flowFields.clear();this.fields?.clear();
          g.nextMarchPlan=this.c.game.tick+Math.round(GOBLINS.siege.routeRefresh*TICK_RATE);
        }
      }
      return g.marchIndex>=g.march.length;
    }
    if (!playerFitsAt(this.c.world, {...s,x:nx,z:nz}, ny)) {
      g.stuckTicks++;g.walking=false;this.requestClear(g,p);this.smash(g,p,this.c.game.tick);
      if(g.stuckTicks>20 && !climbing && !key.startsWith('build:'))g.marchKey=null;
      return false;
    }
    g.stuckTicks=0;
    s.yaw = g.crouching ? Math.atan2(p.x-s.x,p.z-s.z) : Math.atan2(-(p.x-s.x),-(p.z-s.z));
    Object.assign(s,{x:nx,y:ny,z:nz,vx:0,vy:0,vz:0,onGround:false}); g.walking=step>0.001; g.climbing=!!climbing;
    if (d <= rate/TICK_RATE) g.marchIndex++;
    return g.marchIndex >= g.march.length;
  }
  road(s,g,reverse=false) {
    const b=s.bridges[g.bridgeIndex % s.bridges.length];
    const tower=[{...b.ladder,climb:true},{...b.ladder,y:b.deck[0].y+1,climb:true},
      {x:b.launch.x+0.5,y:b.deck[0].y+1,z:b.launch.z+0.5,climb:true}];
    const deck=b.deck.map((p) => ({x:p.x+0.5,y:p.y+1,z:p.z+0.5}));
    return reverse ? [...b.ramp,...deck].reverse().concat([...tower].reverse()) : tower.concat(deck,b.ramp);
  }
  moveGoal(g,goal,key,speed) {
    const surface=/^(builder-launch|builder-stage|guard-launch|launch|staging|flag-base|return):/.test(key);
    if(surface) {
      g.crouching=false;
      if(distance(g.state,goal)<0.65 && canStand(this.c.world,Math.floor(goal.x),Math.round(goal.y),Math.floor(goal.z),2))return true;
      if(g.marchKey===null && this.c.game.tick<(g.nextMarchPlan ?? 0)) {
        this.smash(g,goal,this.c.game.tick);g.move(this.c.world,null,speed ?? g.settings.speed);return false;
      }
      if(g.marchKey!==key)this.setRoute(g,this.path(g.state,goal,true),key);
      if(!g.march.length) {g.marchKey=null;g.nextMarchPlan=this.c.game.tick+Math.round(GOBLINS.siege.routeRefresh*TICK_RATE);this.requestClear(g,goal);this.smash(g,goal,this.c.game.tick);return false;}
      const arrived=this.advance(g,g.march,key,speed);
      if(arrived && distance(g.state,goal)>=0.65) {
        this.smash(g,goal,this.c.game.tick);g.marchKey=null;return false;
      }
      return arrived;
    }
    if(distance(g.state,goal)<=GOBLINS.siege.localRange || g.localGoalKey===key) {
      g.localGoalKey=key;
      // Near a flag, keep, approach work site or the home entrance, use the
      // same voxel A* and physical steering as ordinary hostile goblins.
      // Long march routes remain cached until actual traversal fails.
      g.marchKey=null;
      if(g.stuckTicks>20) {
        g.route=null;this.requestClear(g,goal);
      }
      g.walkTo(this.c.world,goal,(speed ?? g.settings.speed)/(g.carrying?CARRY_SPEED_SCALE:1),
        {urgent:true,slack:0.25});
      return Math.hypot(g.state.x-goal.x,g.state.z-goal.z)<0.65 && Math.abs(g.state.y-goal.y)<1.5;
    }
    if(g.marchKey===null && this.c.game.tick<(g.nextMarchPlan ?? 0))return false;
    if (g.marchKey !== key) this.setRoute(g,this.path(g.state,goal),key);
    if (!g.march.length) {this.smash(g,goal,this.c.game.tick);g.marchKey=null;g.nextMarchPlan=this.c.game.tick+Math.round(GOBLINS.siege.routeRefresh*TICK_RATE);return false;}
    const arrived=this.advance(g,g.march,key,speed);
    if(arrived && distance(g.state,goal)>1.5) {g.marchKey=null;g.stuckTicks++;g.nextMarchPlan=this.c.game.tick+Math.round(GOBLINS.siege.routeRefresh*TICK_RATE);this.smash(g,goal,this.c.game.tick);return false;}
    return arrived;
  }
  build(s,tick) {
    if(!s.landingTick && s.bridges.every((bridge)=>bridge.blocks.filter((b)=>b.id!==BLOCK.AIR)
      .every((b)=>this.c.world.getBlock(b.x,b.y,b.z)===b.id))) {
      s.landingTick=tick;s.bridgeComplete=tick;s.phase='assault';
      this.c.log('siegeBridgeLanded',{siege:s.id,buildSeconds:(tick-s.launchTick)/TICK_RATE,
        towerSeconds:s.towerComplete?(s.towerComplete-s.launchTick)/TICK_RATE:0});
    }
    if (tick < s.nextWork) return;
    let task = s.tasks[s.cursor];
    while (task && this.c.world.getBlock(task.x,task.y,task.z) === task.id) task=s.tasks[++s.cursor];
    if (!task) {
      if (!s.landingTick) {
        s.landingTick=tick; s.bridgeComplete=tick; s.phase='assault';
        this.c.log('siegeBridgeLanded',{siege:s.id,buildSeconds:(tick-s.launchTick)/TICK_RATE,
          towerSeconds:s.towerComplete ? (s.towerComplete-s.launchTick)/TICK_RATE : 0});
      }
      for(const id of s.army) {const worker=this.roster.get(id);if(worker?.siegeRole==='builder') {worker.workActivity='bridge patrol';worker.crouching=false;}}
      this.buildMachines(s); return;
    }
    const workers=[...s.army].map((id)=>this.roster.get(id)).filter((g)=>g && !g.dead
      && g.siegeRole==='builder' && !g.respawnJourney && !g.displaced);
    const lead=workers.find(worker=>worker.id===s.builderId);
    if(lead) {
      if(!lead.buildTravelProgress || distance(lead.state,lead.buildTravelProgress)>1)lead.buildTravelProgress={...lead.state,tick};
      if(!lead.surfaceLaunchReached && tick-lead.buildTravelProgress.tick>this.ticks(GOBLINS.siege.workerHandoffSeconds)) {
        const next=workers.filter(worker=>worker!==lead).sort((a,b)=>distance(a.state,s.bridges[0].ladder)-distance(b.state,s.bridges[0].ladder))[0];
        if(next && distance(next.state,s.bridges[0].ladder)+GOBLINS.siege.stagingSpacing<distance(lead.state,s.bridges[0].ladder)) {
          s.builderId=next.id;next.buildTravelProgress={...next.state,tick};
          this.c.log('siegeWorkerHandoff',{siege:s.id,from:lead.id,to:next.id});
        }
      }
    }
    if(task.approach && task.workerId!==undefined && task.workerId!==s.builderId) {s.cursor++;s.clearRequests?.delete(task.key);return;}
    let g=task.approach?workers.sort((a,b)=>distance(a.state,task.work)-distance(b.state,task.work))[0]:workers.find((worker)=>worker.id===s.builderId);
    if(!g) {g=workers.sort((a,b)=>distance(a.state,task.work)-distance(b.state,task.work))[0];s.builderId=g?.id;}
    if (!g) return;
    g.lastBuildStep=tick;g.crouching=!!task.work.bridge;g.workActivity='moving to work';
    // Routes to the tower start through the settlement; then follows the
    // completed plan to its edge. The next worker inherits the same task.
    const surfaceFloor=this.surfaceFloor(Math.floor(g.state.x),Math.floor(g.state.z));
    const clearingApproach=task.approach && task.id===BLOCK.AIR && surfaceFloor!==null
      && g.state.y>=surfaceFloor-GOBLINS.siege.surfaceTolerance && distance(g.state,task.work)<GOBLINS.siege.towerWorkReach
      && (canStand(this.c.world,Math.floor(g.state.x),Math.round(g.state.y),Math.floor(g.state.z),2) || isInWater(g.state,this.c.world)
        || [0,-1].some(dy=>isWater(this.c.world.getBlock(Math.floor(g.state.x),Math.floor(g.state.y)+dy,Math.floor(g.state.z)))));
    if (g.siegePhase==='emerging' && !task.approach) {
      g.workActivity='reaching surface launch';
      if (this.moveGoal(g,s.bridges[0].ladder,`builder-launch:${s.id}`)) {g.siegePhase='building';g.surfaceLaunchReached=true;}
      return;
    }
    if(!g.surfaceLaunchReached && !task.approach) {g.siegePhase='emerging';return;}
    const ready=clearingApproach || distance(g.state,task.work)<0.65 || task.work.climb
      && Math.hypot(g.state.x-task.work.x,g.state.z-task.work.z)<0.65
      && Math.abs(g.state.y-task.work.y)<=GOBLINS.siege.towerWorkReach
      && (g.state.onGround || isOnLadder(g.state,this.c.world))
      && distance(g.eye(),{x:task.x+0.5,y:task.y+0.5,z:task.z+0.5})<=GOBLINS.worker.reach;
    if (!ready && task.approach) {
      g.workActivity='reaching path obstruction';this.moveGoal(g,task.work,`builder-stage:clear:${task.key}`);return;
    }
    if (!ready) {
      g.workActivity=task.work.climb?'climbing tower':'moving to build site';
      if(task.work.climb && Math.hypot(g.state.x-task.work.x,g.state.z-task.work.z)<0.65) {
        this.advance(g,[{...task.work,climb:true}],`build:${s.cursor}`,GOBLINS.worker.speed);return;
      }
      const b=s.bridges.find((b)=> b.blocks.includes(task)) ?? s.bridges[0];
      const road=this.road(s,{bridgeIndex:s.bridges.indexOf(b)});
      const nearest=road.reduce((best,p,i)=>distance(p,task.work)<distance(road[best],task.work)?i:best,0);
      if(!task.work.climb && g.state.onGround && !isOnLadder(g.state,this.c.world) && Math.abs(g.state.y-task.work.y)<0.05 && (distance(g.state,task.work)<GOBLINS.siege.localRange || g.localGoalKey===`platform-work:${s.cursor}`)) {
        this.moveGoal(g,task.work,`platform-work:${s.cursor}`);return;
      }
      const start=road.reduce((best,p,i)=>distance(p,g.state)<distance(road[best],g.state)?i:best,0);
      const route=nearest>=start ? road.slice(start,nearest+1) : road.slice(nearest,start+1).reverse();
      if(distance(road[nearest],task.work)>0.2) {
        if(task.work.climb)route.push({...task.work});
        else route.push(...this.path(road[nearest],task.work));
      }
      this.advance(g,route,`build:${s.cursor}`,GOBLINS.worker.speed);
      return;
    }
    if (isProtected(this.c.world.getBlock(task.x,task.y,task.z))) { s.cursor++; return; }
    if (task.id !== BLOCK.AIR && this.c.game.playerIn?.(task.x,task.y,task.z)) {g.workActivity='waiting for player to move';return;}
    if(distance(g.eye(),{x:task.x+0.5,y:task.y+0.5,z:task.z+0.5})>GOBLINS.worker.reach) {
      g.workActivity='build block out of reach';return;
    }
    g.workActivity=task.id===BLOCK.AIR?'clearing block':'placing block';
    g.mining=true;g.miningUntil=tick+Math.ceil(GOBLINS.siege.workAnimationSeconds*TICK_RATE);
    if(task.approach && task.id===BLOCK.AIR && isGround(this.c.world.getBlock(task.x,task.y,task.z)))this.c.intended.delete(task.key);
    this.c.setBlock(task.x,task.y,task.z,task.id);s.completedBlocks.set(task.key,task); s.cursor++;
    if (task.work.bridge && !s.towerComplete) s.towerComplete=tick;
    s.nextWork=tick+this.ticks(task.id===BLOCK.AIR ? GOBLINS.siege.breakSeconds:GOBLINS.siege.placeSeconds);
    // Face back, stepping backward rather than facing the destination.
    const p=task.work; g.state.yaw=Math.atan2(task.x+0.5-p.x,task.z+0.5-p.z);
  }
  buildMachines(s) {
    if (s.tier>=2 && !s.catapult) {
      s.catapult=s.oldMachine ?? this.addMachine('goblinCatapult',s.machineSpot,s.target.team);
      s.catapult.siegeId=s.id; s.catapult.phase='waitingCrew';s.catapult.platform=s.platform;
    }

  }
  addMachine(type,spot,team=null) {
    const m=new SiegeMachine(this.c.game.nextId++,this.c,type,spot,team);
    this.machines.set(m.id,m); this.c.add(m); return m;
  }
  repair(s,tick) {
    if (tick<this.nextRepair) return;
    this.nextRepair=tick+this.ticks(GOBLINS.siege.repairSeconds);
    const final=new Map([...(s.completedBlocks ?? []),...s.tasks.slice(0,s.cursor).map((b)=>[b.key,b])]);
    const lead=this.roster.get(s.builderId);
    const b=[...final.values()].filter(b=>!isProtected(this.c.world.getBlock(b.x,b.y,b.z)) && this.c.world.getBlock(b.x,b.y,b.z)!==b.id)
      .sort((a,b)=>Number(a.id===BLOCK.AIR)-Number(b.id===BLOCK.AIR) || distance(a,lead?.state ?? this.base())-distance(b,lead?.state ?? this.base()))[0];
    if (b) {
      const repair={...b};
      if(b.id===BLOCK.PLANKS && b.work?.bridge) {
        const lead=this.roster.get(s.builderId);
        const spots=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>({x:b.x+dx+0.5,y:b.y+1,z:b.z+dz+0.5,bridge:true}))
          .filter(p=>canStand(this.c.world,Math.floor(p.x),Math.round(p.y),Math.floor(p.z),2));
        if(spots.length)repair.work=spots.sort((a,b)=>distance(a,lead?.state ?? this.base())-distance(b,lead?.state ?? this.base()))[0];
      }
      if(s.tasks[s.cursor]?.key!==b.key || s.tasks[s.cursor]?.id!==b.id)s.tasks.splice(s.cursor,0,repair);
    }
    else {
      const p=s.bridges.flatMap((b)=>b.deck).find((p)=>this.c.world.getBlock(p.x,p.y,p.z)===BLOCK.PLANKS && [1,2].some((dy)=>isSolid(this.c.world.getBlock(p.x,p.y+dy,p.z)) && !isProtected(this.c.world.getBlock(p.x,p.y+dy,p.z))));
      if (p) for (const dy of [1,2]) s.tasks.splice(s.cursor,0,{x:p.x,y:p.y+dy,z:p.z,id:BLOCK.AIR,
        key:blockKey(p.x,p.y+dy,p.z),work:{x:p.x+0.5,y:p.y+1,z:p.z+0.5,bridge:true}});
      if(!p && s.clearRequests?.size) {
        const [key,task]=s.clearRequests.entries().next().value;
        s.clearRequests.delete(key);
        if(isSolid(this.c.world.getBlock(task.x,task.y,task.z)))s.tasks.splice(s.cursor,0,task);
      }
    }
  }
  requestClear(g,goal) {
    const s=this.active;
    if(!s || g.siegeId!==s.id || g.siegeRole!=='builder' || g.id!==s.builderId || g.surfaceLaunchReached)return;
    const dx=goal.x-g.state.x,dz=goal.z-g.state.z,d=Math.hypot(dx,dz)||1;
    const close=Math.hypot(dx,dz)<=GOBLINS.siege.clearRange;
    const x=Math.floor(close?goal.x:g.state.x+dx/d),z=Math.floor(close?goal.z:g.state.z+dz/d);
    s.clearRequests ??= new Map();
    for(let y=close?Math.round(goal.y):Math.floor(g.state.y)+(goal.y>g.state.y+0.5?1:0);y<Math.max(g.state.y,Math.min(goal.y,g.state.y+1))+g.state.box.height;y++) {
      const id=this.c.world.getBlock(x,y,z),key=blockKey(x,y,z);
      if(!isSolid(id) || isProtected(id) || this.c.intended.get(key)?.id===id && !isGround(id) || this.protectedBridge.has(key))continue;
      s.clearRequests.set(key,{x,y,z,key,id:BLOCK.AIR,approach:true,
        work:{x:g.state.x,y:g.state.y,z:g.state.z},workerId:g.id});
    }
  }
  tick(tick) {
    const c=this.c;
    for(const g of this.roster.values())g.mining=(g.miningUntil ?? -1)>=tick;
    if (!this.active && c.totemAlive && tick>=this.nextPlan) {
      this.nextPlan=tick+this.ticks(GOBLINS.siege.planScanSeconds);
      if (this.pending && this.pending.tier!==c.tier) this.pending=null;
      if (!this.pending) this.prepare();
      this.launch();
    }
    const s=this.active;
    if (s) {

      if (!c.totemAlive) this.end('totem destroyed');
      else {
        if (tick>=s.nextSpawn && s.queue.length) {
          const first=s.queue[0];
          const cargoReady=!['pilot','rider'].includes(first.role) || (s.landingTick && tick>=s.landingTick+this.ticks(GOBLINS.balloon.launchDelay));
          if (cargoReady && (s.landingTick || first.role!=='fighter' || s.spawned< GOBLINS.siege.budgets[s.tier].goblinWorker+2
            || s.cursor/Math.max(1,s.tasks.length)>=GOBLINS.siege.mainArmyProgress)) {
            const [low,high]=GOBLINS.siege.groupSize;
            const count=low+Math.floor(c.random()*(high-low+1)), group=[];
            for (let i=0;i<count && s.queue.length;i++) {
              const entry=s.queue[0];
              if(['pilot','rider'].includes(entry.role) && (!s.landingTick
                || tick<s.landingTick+this.ticks(GOBLINS.balloon.launchDelay)))break;
              const g=this.spawn(s,entry);if(!g)break;
              s.queue.shift();group.push(g.siegeRole);
            }
            s.spawnGroups.push({tick,roles:group});
            c.log('siegeSpawnGroup',{siege:s.id,roles:group,remaining:s.queue.length,homePopulation:c.population()});
            s.nextSpawn=tick+this.ticks(GOBLINS.siege.spawnInterval);
          }
        }
        this.repair(s,tick); this.build(s,tick);
        if (tick-s.launchTick>=this.ticks(GOBLINS.siege.hardCapSeconds)
          || s.landingTick && tick-s.landingTick>=this.ticks(GOBLINS.siege.afterLandingSeconds)) this.end('timeout');
        else if (!s.queue.length && [...s.army].every((id)=> !this.roster.has(id)
          || this.roster.get(id).returned)) this.end('army exhausted');
      }
    }
    for (const g of this.roster.values()) if (!g.dead) this.unit(g,this.active?.id===g.siegeId?this.active:g.siegePlan,tick);
    for (const m of this.machines.values()) if (!m.dead) this.machine(m,tick);
    for (const e of c.game.mobs.values()) if (e instanceof SiegeShot) e.advance();
    this.flushImpacts(tick);
  }
  unit(g,s,tick) {
    if (!s || g.returned || g.aboard) return;
    if(g.state.y<this.c.world.voidY) {this.c.game.removeMob(g);return;}
    if (g.respawnJourney) { this.c.sim.progressJourney(g); return; }
    if (g.state.y<this.c.world.voidY) { this.c.game.removeMob(g); return; }
    const k=Math.hypot(g.state.kx,g.state.kz);
    if (k>0.1 || g.displaced) {
      g.respawnJourney=null; g.displaced=true;
      stepPlayer(g.state,{forward:0,strafe:0,yaw:g.state.yaw,pitch:0},this.c.world);
      if (g.state.onGround && k<0.1) { g.displaced=false; g.marchKey=null; }
      return;
    }
    if (g.gliding) {
      const aim=s.aim, st=g.state;
      const dx=aim.x-st.x,dz=aim.z-st.z,d=Math.hypot(dx,dz)||1;
      const next={...st,x:st.x+dx/d*GOBLINS.balloon.glideSpeed/TICK_RATE,
        z:st.z+dz/d*GOBLINS.balloon.glideSpeed/TICK_RATE};
      if(playerFitsAt(this.c.world,next,st.y)) {st.x=next.x;st.z=next.z;}
      const y=st.y-GOBLINS.balloon.glideFallSpeed/TICK_RATE;
      if(playerFitsAt(this.c.world,st,y))st.y=y;
      else {g.gliding=false;g.siegePhase='assault';g.marchKey=null;st.onGround=true;}
      return;
    }
    if (g.carrying) { this.returnCarrier(g,s); return; }
    if (g.siegeRole==='builder' && this.active===s) {
      if(g.lastBuildStep!==tick && g.id===s.builderId && !isOnLadder(g.state,this.c.world))g.move(this.c.world,null,g.settings.speed);
      if(g.lastBuildStep!==tick && g.id!==s.builderId) {
        g.workActivity='backup staging';
        const b=s.bridges[g.bridgeIndex],dx=b.landing.x-b.launch.x,dz=b.landing.z-b.launch.z,d=Math.hypot(dx,dz)||1;
        const index=[...s.army].filter((id)=>id<g.id).length+1;
        const spacing=GOBLINS.siege.stagingSpacing;
        const goal={x:b.ladder.x-dx/d*spacing*2-dz/d*spacing*(index%3-1),y:b.ladder.y,
          z:b.ladder.z-dz/d*spacing*2+dx/d*spacing*(index%3-1)};
        const floor=this.surfaceFloor(Math.floor(goal.x),Math.floor(goal.z));
        if(floor!==null)goal.y=floor;
        if(canStand(this.c.world,Math.floor(goal.x),Math.round(goal.y),Math.floor(goal.z),2))this.moveGoal(g,goal,`staging:${g.id}`);
        else g.move(this.c.world,null,g.settings.speed);
      }
      return;
    }
    if (g.returning) {
      const b=s.bridges[g.bridgeIndex];
      if(g.siegePhase==='assault' || g.returnStage==='bridge') {
        if(g.returnStage!=='bridge') {
          const end=b.ramp.at(-1) ?? {x:b.landing.x+0.5,y:b.deck[0].y+1,z:b.landing.z+0.5};
          if(!this.moveGoal(g,end,`crew-return-start:${s.id}`))return;
          g.returnStage='bridge';g.marchKey=null;
        }
        if(!this.advance(g,this.road(s,g,true),`crew-return-bridge:${s.id}`))return;
        g.siegePhase='home';g.returnStage='base';g.marchKey=null;
      } else if(g.siegePhase==='crewing') {
        const road=this.road(s,g,true);
        const start=road.reduce((a,p,i)=>distance(g.state,p)<distance(g.state,road[a])?i:a,0);
        if(!this.advance(g,road.slice(start),`crew-return:${s.id}`))return;
        g.siegePhase='home';g.marchKey=null;
      }
      if (this.moveGoal(g,this.base(),`return:${s.id}`)) { g.returned=true; this.c.game.removeMob(g); }
      return;
    }
    if (g.siegeRole==='crew' && s.catapult && !s.catapult.dead && ['assault','crewing'].includes(g.siegePhase)) {
      if (!s.catapult.crew || s.catapult.crew.dead) {
        if (distance(g.state,s.catapult.state)<2 || this.moveGoal(g,s.catapult.state,`crew:${s.id}`)) { s.catapult.crew=g; g.siegePhase='crewing'; }
      }
      // Crew travel is a complete assignment; do not also move toward the
      // keep in the same tick and cancel the route to the side platform.
      return;
    }
    if (['pilot','rider'].includes(g.siegeRole) && s.balloon && s.balloon.phase==='loading') {
      if (this.moveGoal(g,s.balloon.state,`balloon:${s.id}`)) {
        g.aboard=s.balloon;
        if (g.siegeRole==='pilot') s.balloon.crew=g;
        else s.balloon.cargo.push(g);
      } return;
    }
    const defense=[...(this.c.game.turretController?.turrets.values() ?? [])]
      .find((t)=>distance(g.state,{x:t.x+0.5,y:t.y,z:t.z+0.5})<=GOBLINS.siege.defenseRange);
    if(defense) {
      const goal={x:defense.x+0.5,y:defense.y,z:defense.z+0.5};
      this.smash(g,goal,tick);
      if(g.type==='goblinBrute') {this.moveGoal(g,goal,`defense:${defense.x},${defense.z}`);return;}
    }
    // Nearby combat remains server-owned, even on a scripted march.
    const target=g.provocation.current(this.c.world,g.eye(),tick) ?? this.c.nearbyPlayers(g.state,g.settings.aggroRange ?? GOBLINS.soldier.aggroRange)
      .filter(huntable).sort((a,b)=>Number(!!b.carrying)-Number(!!a.carrying) || distance(g.state,a.state)-distance(g.state,b.state))
      .find((p)=>canSee(this.c.world,g.eye(),p));
    if (target && g.siegeRole!=='builder') {
      g.target=target;
      if (g.fight) {
        const hit=g.fight(this.c.world,tick);
        if (hit) this.c.game.meleeHit(hit,g.biteDamage,g,g.biteKnockback);
      }
      return;
    }
    g.target=null;
    if (g.siegePhase==='crewing') {g.move(this.c.world,null,g.settings.speed);return;}
    if (!s.landingTick) {
      const b=s.bridges[0],dx=b.landing.x-b.launch.x,dz=b.landing.z-b.launch.z,d=Math.hypot(dx,dz)||1;
      const spacing=GOBLINS.siege.stagingSpacing,side=g.id%5-2;
      const goal={x:b.ladder.x-dx/d*spacing*3-dz/d*side*spacing,y:b.ladder.y,
        z:b.ladder.z-dz/d*spacing*3+dx/d*side*spacing};
      goal.y=this.surfaceFloor(Math.floor(goal.x),Math.floor(goal.z)) ?? goal.y;
      this.moveGoal(g,goal,`guard-launch:${g.id}`);return;
    }
    if (g.siegePhase==='emerging' || g.siegePhase==='crossing') {
      if (g.siegePhase==='emerging') {
        if (!this.moveGoal(g,s.bridges[g.bridgeIndex].ladder,`launch:${s.id}`)) return;
        g.siegePhase='crossing';g.marchKey=null;
      }
      const b=s.bridges[g.bridgeIndex],end=b.ramp.at(-1) ?? {x:b.landing.x+0.5,y:b.deck[0].y+1,z:b.landing.z+0.5};
      if(distance(g.state,end)<GOBLINS.siege.localRange
        && this.c.world.naturalTop[Math.floor(g.state.x)+this.c.world.sizeX*Math.floor(g.state.z)]>-30000
        || this.advance(g,this.road(s,g),`cross:${s.id}`)) {g.siegePhase='assault';g.marchKey=null;}
      return;
    }
    const carrier=[...s.army].map((id)=>this.roster.get(id)).find((u)=>u?.carrying);
    const flag=[...this.c.game.flags.values()].find((f)=>f.team===s.target.team
      && [FLAG_STATE.HOME,FLAG_STATE.DROPPED].includes(f.state));
    const goal=carrier?.state ?? flag?.position ?? s.aim;
    if (g.type==='goblinBrute' || g.stuckTicks>20) this.smash(g,goal,tick);
    if (flag && this.c.game.onFlag(g,flag.position)) {
      g.grabTicks=(g.grabTicks ?? 0)+1;
      if (g.grabTicks>= Math.round(GOBLINS.siege.grabSeconds*TICK_RATE)) {
        this.c.game.takeFlag(g,flag); g.returnStage='keep';g.marchKey=null;
      }
    } else { g.grabTicks=0; this.moveGoal(g,goal,`assault:${s.id}:${Math.floor(goal.x/4)},${Math.floor(goal.z/4)}`); }
  }
  smash(g,goal,tick) {
    if (tick<(g.nextSmash ?? 0)) return;
    const dx=goal.x-g.state.x,dz=goal.z-g.state.z,d=Math.hypot(dx,dz)||1;
    const close=Math.hypot(dx,dz)<=GOBLINS.siege.clearRange;
    const x=Math.floor(close?goal.x:g.state.x+dx/d),z=Math.floor(close?goal.z:g.state.z+dz/d);
    for (let y=close?Math.round(goal.y):Math.floor(g.state.y)+(goal.y>g.state.y+0.5?1:goal.y<g.state.y-0.5?-1:0);y<Math.max(g.state.y,Math.min(goal.y,g.state.y+1))+g.state.box.height;y++) {
      const id=this.c.world.getBlock(x,y,z);
      if (!isSolid(id) || isProtected(id) || this.c.intended.get(blockKey(x,y,z))?.id===id && !isGround(id) || (this.protectedBridge.has(blockKey(x,y,z)) && (id===BLOCK.PLANKS || isClimbable(id)))) continue;
      g.mining=true; g.nextSmash=tick+Math.max(1,Math.round(goblinBreakTicks(id)/(g.settings.breakSpeed ?? 1)));
      if (g.smashBlock===blockKey(x,y,z)) {if(isGround(id))this.c.intended.delete(blockKey(x,y,z));this.c.setBlock(x,y,z,BLOCK.AIR);g.smashBlock=null;g.nextSmash=tick+1;}
      else {g.smashBlock=blockKey(x,y,z);if(!['cross:','flag-cross:','build:','crew-return'].some(prefix=>g.marchKey?.startsWith(prefix)))g.marchKey=null;}
      break;
    }
  }
  returnCarrier(g,s) {
    if(!this.c.totemAlive) {
      const flag=g.carrying;g.carrying=null;g.state.carrying=false;this.c.game.returnFlag(flag);return;
    }
    const b=s.bridges[g.bridgeIndex], end=b.ramp.at(-1) ?? center({...b.deck.at(-1),y:b.deck.at(-1).y+1});
    if (g.returnStage==='keep') {
      if (this.moveGoal(g,end,`flag-to-bridge:${s.id}`,GOBLINS.siege.carrierSpeed)) {
        g.returnStage='bridge';g.marchKey=null;
      }
    } else if (g.returnStage==='bridge') {
      if (this.advance(g,this.road(s,g,true),`flag-cross:${s.id}`,GOBLINS.siege.carrierSpeed)) {
        g.returnStage='base';g.marchKey=null;
      }
    } else if (g.returnStage==='base') {
      if (this.moveGoal(g,this.base(),`flag-base:${s.id}`,GOBLINS.siege.carrierSpeed)) {
        g.returnStage='totem';g.marchKey=null;
        g.stray=false; this.c.sim.startJourney(g,this.c.totemSpot); g.stray=true;
      }
    } else if (g.returnStage==='totem' && distance(g.state,this.c.totemSpot)<GOBLINS.siege.homeRange) {
      const f=g.carrying,t=this.c.totemSpot;
      g.carrying=null;g.state.carrying=false;f.carrier=null;f.state=FLAG_STATE.HELD;
      const pedestal={x:Math.floor(t.x+3),y:Math.floor(t.y)-1,z:Math.floor(t.z+f.team*2),id:BLOCK.PEDESTAL};
      this.c.setBlock(pedestal.x,pedestal.y,pedestal.z,pedestal.id);this.c.intend(pedestal);
      Object.assign(f.body,{x:pedestal.x+0.5,y:pedestal.y+1,z:pedestal.z+0.5,vx:0,vy:0,vz:0});
      this.c.log('siegeFlagHeld',{siege:s.id,team:f.team});
      g.returned=true;this.c.game.removeMob(g);
    }
  }
  machine(m,tick) {
    const s=this.active?.id===m.siegeId?this.active:null;
    if (m.type==='goblinCatapult') {
      Object.assign(m.state,{kx:0,kz:0,vx:0,vy:0,vz:0,onGround:true});
      if (!s) {m.phase='waitingCrew';return;}
      if(!m.crew || m.crew.dead) {
        m.phase='waitingCrew';
        const assigned=[...s.army].map(id=>this.roster.get(id)).some(g=>g && !g.dead && g.siegeRole==='crew' && !g.returning);
        const replacement=assigned?null:[...s.army].map((id)=>this.roster.get(id)).filter((g)=>g && !g.dead && !g.carrying
          && !g.aboard && ['goblinSoldier','goblinArcher'].includes(g.type)
          && g.siegePhase==='assault' && g.siegeRole==='fighter')
          .sort((a,b)=>distance(a.state,m.state)-distance(b.state,m.state))[0];
        if(replacement)replacement.siegeRole='crew';
        return;
      }
      m.phase='firing';m.state.yaw=Math.atan2(-(s.aim.x-m.state.x),-(s.aim.z-m.state.z));
      if (tick>=m.nextShot) {
        const target=this.chooseCatapultTarget(s,m),aim=target.point;
        if (Math.hypot(aim.x-m.state.x,aim.z-m.state.z)<=GOBLINS.catapult.range) {
          this.shoot({...m.state,y:m.state.y+2},aim,s.tier>=4?GOBLINS.catapult.bomb:GOBLINS.catapult.boulder,s.tier>=4);
          m.lastShot=tick;this.c.log('siegeCatapultShot',{siege:s.id,team:m.targetTeam,bomb:s.tier>=4,target:target.kind,aim:{x:aim.x,y:aim.y,z:aim.z}});
        }
        m.nextShot=tick+this.ticks(GOBLINS.catapult.cooldown);
      } return;
    }
    if (m.phase==='loading') {
      if (s && m.crew && m.cargo.length>=Math.min(GOBLINS.balloon.cargo,s.budget.riders ?? 0)) {
        m.phase='ascending';m.launchSpot={...m.state};
        m.flightY=Math.max(m.state.y,s.aim.y)+GOBLINS.balloon.hoverHeight;
      }
      if (!s) m.phase='returning';
    }
    if (m.phase==='crashing' || m.crew?.dead) {
      m.phase='crashing'; m.crashVelocity+=GOBLINS.balloon.crashGravity/TICK_RATE;
      m.state.y-=m.crashVelocity/TICK_RATE;
      if (m.state.y<this.c.world.voidY || isSolid(this.c.world.getBlock(Math.floor(m.state.x),Math.floor(m.state.y),Math.floor(m.state.z)))) {
        for (const g of [m.crew,...m.cargo]) if(g && !g.dead) this.c.game.removeMob(g);
        this.c.game.removeMob(m);
        this.c.log('siegeBalloon',{outcome:'crashed',team:m.targetTeam});
      } return;
    }
    if (!s && !['idle','landing','returning'].includes(m.phase)) m.phase='returning';
    if(m.phase==='ascending') {
      if(this.flyBalloon(m,{x:m.state.x,y:m.flightY,z:m.state.z}))m.phase='outbound';
    }
    if (['outbound','returning'].includes(m.phase)) {
      const returning=m.phase==='returning';
      const destination=returning ? (m.launchSpot ?? this.base()) : s.aim;
      m.flightY=Math.max(m.flightY ?? m.state.y,destination.y+GOBLINS.balloon.hoverHeight);
      const goal={...destination,y:m.flightY};
      if(this.flyBalloon(m,goal)) {
        if(returning) {m.phase='landing';m.launchSpot=this.balloonLaunch() ?? m.launchSpot;}
        else m.phase='hovering';
      }
    }
    if(m.phase==='landing' && this.flyBalloon(m,m.launchSpot)) {
      for(const g of [m.crew,...m.cargo])if(g && !g.dead) {g.returned=true;this.c.game.removeMob(g);}
      m.crew=null;m.cargo=[];m.phase='idle';
      this.c.log('siegeBalloon',{outcome:'returned',team:m.targetTeam});
    }
    if (m.phase==='hovering') {
      const hover={x:m.state.x,y:Math.max(s.aim.y+GOBLINS.balloon.hoverHeight,m.hoverY ?? 0),z:m.state.z};
      this.flyBalloon(m,hover);
      if (m.cargo.length && tick>=m.nextDrop) {
        const g=m.cargo.shift(); g.aboard=null;g.gliding=true;g.siegePhase='gliding';
        Object.assign(g.state,{x:m.state.x,y:m.state.y,z:m.state.z});
        m.nextDrop=tick+this.ticks(GOBLINS.balloon.dropInterval);
        this.c.log('siegeGliderDrop',{id:g.id,team:m.targetTeam});
      }
      if (m.bombs>0 && tick>=m.nextShot) {
        this.shoot(m.state,s.aim,GOBLINS.balloon.bomb,true,true);m.bombs--;
        m.nextShot=tick+this.ticks(GOBLINS.balloon.bombInterval);
      }
      if (!m.cargo.length && !m.bombs) m.phase='returning';
    }
    for (const g of [m.crew,...m.cargo]) if (g && !g.dead) Object.assign(g.state,
      {x:m.state.x,y:m.state.y,z:m.state.z});
  }
  balloonClear(point) {
    const w=this.c.world,half=GOBLINS.balloon.width/2;
    if(point.x-half<0 || point.z-half<0 || point.x+half>=w.sizeX || point.z+half>=w.sizeZ
      || point.y+GOBLINS.balloon.height>=w.sizeY)return false;
    for(let y=Math.floor(point.y);y<point.y+GOBLINS.balloon.height;y++)
      for(let z=Math.floor(point.z-half);z<=Math.floor(point.z+half);z++)
        for(let x=Math.floor(point.x-half);x<=Math.floor(point.x+half);x++)
          if(isSolid(w.getBlock(x,y,z)))return false;
    return true;
  }
  balloonLaunch() {
    const base=this.base(),w=this.c.world,r=GOBLINS.balloon.launchRadius;
    // Choose a clear volume beside the surface base. Height is derived from
    // the complete footprint, so the envelope cannot spawn inside a wall/tree.
    for(let radius=0;radius<=r;radius+=GOBLINS.balloon.clearance) {
      for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]]) {
        const x=Math.floor(base.x+dx)+0.5,z=Math.floor(base.z+dz)+0.5;
        const half=Math.ceil(GOBLINS.balloon.width/2);
        if(this.c.buildings.some(b=>b.kind!=='wall' && b.box && x+half>=b.box.x0 && x-half<=b.box.x1 && z+half>=b.box.z0 && z-half<=b.box.z1)
          || [...this.c.wallFootprints].some(key=>{const [px,pz]=key.split(',').map(Number);return Math.abs(px-x)<=half && Math.abs(pz-z)<=half;}))continue;
        let top=w.minY,low=Infinity;
        const surface=(px,pz)=> {
          for(let y=Math.floor(base.y+GOBLINS.balloon.launchRise);y>=base.y-GOBLINS.balloon.launchDepth;y--)
            if(isGround(w.getBlock(px,y,pz)))return y;
          return w.minY;
        };
        for(let ox=-Math.ceil(GOBLINS.balloon.width/2);ox<=Math.ceil(GOBLINS.balloon.width/2);ox++)
          for(let oz=-Math.ceil(GOBLINS.balloon.width/2);oz<=Math.ceil(GOBLINS.balloon.width/2);oz++)
            {const y=surface(Math.floor(x)+ox,Math.floor(z)+oz);top=Math.max(top,y);low=Math.min(low,y);}
        if(top-low>GOBLINS.balloon.launchMaxSlope)continue;
        const p={x,y:top+1,z};if(top>w.minY && surface(Math.floor(x),Math.floor(z))>w.minY && this.balloonClear(p))return p;
      }
    }
    return null;
  }
  flyBalloon(m,goal) {
    const st=m.state,rate=GOBLINS.balloon.speed/TICK_RATE;
    if(m.flightPhase!==m.phase) {m.flightPhase=m.phase;m.flightDetour=null;m.detourHistory=[];}
    if(m.flightDetour && distance(st,m.flightDetour)<0.3)m.flightDetour=null;
    const destination=m.flightDetour ?? goal,d=distance(st,destination);
    if(d<0.3)return true;
    const t=Math.min(1,rate/d);
    const next={x:st.x+(destination.x-st.x)*t,y:st.y+(destination.y-st.y)*t,z:st.z+(destination.z-st.z)*t};
    if(this.balloonClear(next)) {Object.assign(st,next);m.blockedAt=null;return false;}
    // A player may have added a wall after departure. Ascend or steer around
    // it at flight speed; never snap to the far side of a blocked route.
    m.flightDetour=null;
    const reach=GOBLINS.balloon.detourDistance;
    const choices=[{x:st.x,y:st.y+reach,z:st.z},
      {x:st.x+reach,y:st.y,z:st.z},{x:st.x-reach,y:st.y,z:st.z},
      {x:st.x,y:st.y,z:st.z+reach},{x:st.x,y:st.y,z:st.z-reach}];
    const clearSegment=p=>Array.from({length:Math.ceil(reach/GOBLINS.balloon.clearance)},(_,i)=>{
      const f=(i+1)/Math.ceil(reach/GOBLINS.balloon.clearance);
      return this.balloonClear({x:st.x+(p.x-st.x)*f,y:st.y+(p.y-st.y)*f,z:st.z+(p.z-st.z)*f});
    }).every(Boolean);
    const free=choices.filter(p=>!(m.detourHistory ?? []).some(old=>distance(p,old)<reach/2) && clearSegment(p))
      .sort((a,b)=>distance(a,goal)-distance(b,goal))[0];
    if(free) {
      m.detourHistory ??=[];m.detourHistory.push({x:st.x,y:st.y,z:st.z});
      if(m.detourHistory.length>GOBLINS.balloon.detourHistory)m.detourHistory.shift();
      m.flightDetour=free;m.flightY=Math.max(m.flightY ?? 0,free.y);
      if(m.phase==='hovering')m.hoverY=free.y;
      m.blockedAt=null;
    } else {
      m.blockedAt ??= this.c.game.tick;
      if(this.c.game.tick-m.blockedAt>this.ticks(GOBLINS.balloon.blockedSeconds)) {
        m.phase='crashing';this.c.log('siegeBalloon',{outcome:'flight obstructed',team:m.targetTeam});
      }
    }
    return false;
  }
  chooseCatapultTarget(s,m) {
    const cfg=GOBLINS.catapult,w=this.c.world;
    const eligible=p=>Math.hypot(p.x-m.state.x,p.z-m.state.z)<=cfg.range && distance(p,s.aim)<=cfg.targetRadius;
    const breakable=(x,y,z)=>{
      const id=w.getBlock(x,y,z);
      return isSolid(id) && !isProtected(id) && !this.protectedBridge.has(blockKey(x,y,z)) && getBlockDef(id).hardness<=cfg.boulder.hardness;
    };
    const bridge=s.bridges[0],entry=bridge.ramp.at(-1) ?? {...bridge.landing,y:bridge.deck[0].y+1};
    const obstructions=this.path(entry,s.aim).flatMap(p=>[0,1].map(dy=>({x:Math.floor(p.x)+0.5,y:Math.round(p.y)+dy+0.5,z:Math.floor(p.z)+0.5})))
      .filter(p=>eligible(p) && breakable(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)));
    const turrets=[...(this.c.game.turretController?.turrets.values() ?? [])].filter(eligible).map(p=>({x:p.x+0.5,y:p.y+0.5,z:p.z+0.5}));
    const players=[...this.c.game.players.values()].filter(huntable).map(p=>p.state).filter(eligible);
    players.sort((a,b)=>players.filter(p=>distance(p,b)<=cfg.clusterRadius).length-players.filter(p=>distance(p,a)<=cfg.clusterRadius).length);
    const defenses=[];
    for(let y=Math.floor(s.aim.y)-cfg.targetHeight;y<=Math.ceil(s.aim.y)+cfg.targetHeight;y++)
      for(let z=Math.floor(s.aim.z)-cfg.targetRadius;z<=s.aim.z+cfg.targetRadius;z+=cfg.scanStride)
        for(let x=Math.floor(s.aim.x)-cfg.targetRadius;x<=s.aim.x+cfg.targetRadius;x+=cfg.scanStride) {
          const id=w.getBlock(x,y,z),p={x:x+0.5,y:y+0.5,z:z+0.5};
          if(defenses.length<cfg.maxDefenseTargets && eligible(p) && !isGround(id) && id!==BLOCK.WOOD && id!==BLOCK.LEAVES && breakable(x,y,z))defenses.push(p);
        }
    const buckets={path:obstructions,turret:turrets,defense:defenses,players};
    const index=m.targetCycleIndex ?? 0;m.targetCycleIndex=index+1;
    for(let i=0;i<cfg.targetCycle.length;i++) {
      const kind=cfg.targetCycle[(index+i)%cfg.targetCycle.length],points=buckets[kind];
      if(points.length)return {kind,point:kind==='players'?points[0]:points[Math.floor(this.c.random()*points.length)]};
    }
    return {kind:'keep',point:s.aim};
  }
  shoot(from,to,payload,bomb,drop=false) {
    const shot=new SiegeShot(this.c.game.nextId++,this,from,to,payload,bomb,drop);
    this.c.game.mobs.set(shot.id,shot);
    this.c.game.broadcast({type:S2C.ENTITY_SPAWN,entity:shot.describe()});
  }
  impact(point,payload,bomb=false) {
    const watched=this.c.watchedChunk(point,true);
    if(watched)resolveImpact(this,point,payload,bomb);
    else {this.pendingImpacts ??= [];this.pendingImpacts.push({point:{...point},payload,bomb});}
  }
  flushImpacts(tick) {
    if(!this.pendingImpacts?.length)return;
    const watched=this.pendingImpacts.some((i)=>this.c.watchedChunk(i.point,true));
    if(!watched && tick<(this.nextImpactBatch ?? 0))return;
    this.nextImpactBatch=tick+this.ticks(GOBLINS.offscreen.step);
    for(const i of this.pendingImpacts)resolveImpact(this,i.point,i.payload,i.bomb);
    this.pendingImpacts=[];
  }
  end(reason) {
    const s=this.active; if(!s)return;
    this.active=null; this.pending=null;
    if(s.tier>=3)this.completedTier3++;
    for (const id of s.army) {
      const g=this.roster.get(id); if(!g)continue;
      g.siegePlan=s;g.crouching=false;g.mining=false;
      if(['crew','pilot'].includes(g.siegeRole))g.returning=true;
      if(g.siegeRole==='builder')g.siegeRole='fighter';
    }
    if(s.balloon && !s.balloon.dead && !['crashing','idle','landing'].includes(s.balloon.phase))s.balloon.phase='returning';
    this.c.log('siegeEnd',{siege:s.id,reason,tier:s.tier,target:s.target.team,spawned:s.spawned,
      remaining:s.queue.length,alive:[...s.army].filter((id)=>this.roster.has(id)).length,
      homePopulation:this.c.population(),cursor:s.cursor,tasks:s.tasks.length,next:s.tasks[s.cursor],
      builders:[...s.army].map((id)=>this.roster.get(id)).filter((g)=>g?.siegeRole==='fighter' && g.type==='goblinWorker')
        .map((g)=>({id:g.id,phase:g.siegePhase,x:g.state.x,y:g.state.y,z:g.state.z,key:g.marchKey,next:g.march?.[g.marchIndex]}))});
  }
  removed(g) {
    if(g.carrying)this.c.game.dropFlag(g);
    this.roster.delete(g.id);
    if(g.machine)this.machines.delete(g.id);
  }
  status() {
    const s=this.active ?? this.pending;
    return {phase:this.active?.phase ?? (this.pending?'reserving wood':'idle'),target:s?.target.team ?? null,
      bridgePlan:s?.mode ?? null,reserved:this.reserve(),needed:s?.needed ?? 0,wood:this.c.wood,
      budget:this.active?.budget ?? null,remaining:this.active?.queue.length ?? 0,spawned:this.active?.spawned ?? 0,
      progress:s ? s.cursor/Math.max(1,s.tasks.length):0,
      secondsRemaining:this.active ? Math.max(0,Math.min(
        (this.active.launchTick+this.ticks(GOBLINS.siege.hardCapSeconds)-this.c.game.tick)/TICK_RATE,
        this.active.landingTick ? (this.active.landingTick+this.ticks(GOBLINS.siege.afterLandingSeconds)-this.c.game.tick)/TICK_RATE:Infinity)):0,
      workers:this.active?[...this.active.army].map((id)=>this.roster.get(id)).filter((g)=>g?.siegeRole==='builder')
        .map((g)=>({id:g.id,phase:g.siegePhase,activity:g.respawnJourney?'leaving shaft':g.workActivity ?? 'waiting',
          x:Math.round(g.state.x*10)/10,y:Math.round(g.state.y*10)/10,z:Math.round(g.state.z*10)/10,
          distanceToWork:this.active.tasks[this.active.cursor]?Math.round(distance(g.state,this.active.tasks[this.active.cursor].work)*10)/10:null})):[],
      nextBlock:this.active?.tasks[this.active.cursor]?{x:this.active.tasks[this.active.cursor].x,
        y:this.active.tasks[this.active.cursor].y,z:this.active.tasks[this.active.cursor].z}:null,
      machines:[...this.machines.values()].map((m)=>({id:m.id,type:m.type,hp:m.hp,phase:m.phase,
        cargo:m.cargo.length,bombs:m.bombs,crew:m.crew?.id ?? null}))};
  }
}
