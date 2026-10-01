import { Npc } from './npcs.js';
import { findPath, canStand } from './pathfind.js';
import { stepMobPath } from '../shared/mobMovement.js';
import { playerFitsAt, stepPlayer } from '../shared/physics.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { ITEM, registeredItemIds } from '../shared/items.js';
import { FUEL } from '../shared/recipes.js';
import { MONKEY_WORK as C, TICK_RATE } from '../shared/config.js';
import { NPC_KIND } from '../shared/npcs.js';
import { MONKEY_ROLES, MONKEY_NAMES, defaultMonkeyConfig, monkeyFilter, monkeyRange } from '../shared/monkeys.js';
import { mergeInto, OUTPUT, INPUT, FUEL_SLOT } from './containers.js';
import { S2C } from '../shared/protocol.js';
import { MonkeyTaming } from './monkeyTaming.js';
import { Inventory, clickSlot } from './inventory.js';

const key=p=>`${p.x},${p.y},${p.z}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const items=new Set(registeredItemIds());
const inside=(b,p)=>p.x>=b.x0&&p.x<=b.x1&&p.y>=b.y0&&p.y<=b.y1&&p.z>=b.z0&&p.z<=b.z1;
const cloneStack=(s,count=s.count)=>({...s,count,...(s.mods?{mods:s.mods.map(m=>({...m}))}:{})});

export class WorkMonkey extends Npc {
  constructor(id,manager,site) {
    super(id,{...site,npc:NPC_KIND.WORK_MONKEY,yaw:0},null,manager.game.tick);
    this.manager=manager;this.name=MONKEY_NAMES[Math.floor(manager.random()*MONKEY_NAMES.length)];
    this.config=defaultMonkeyConfig();this.revision=0;this.inventory=new Inventory(C.inventorySize);
    this.routes=new Map();this.path=[];this.pathKey=null;this.stuck=0;this.status='Wild';
    this.state.edgeGuard=true;this.woodJob=null;
  }
  step(world,players,tick) {this.lookAtNearest(players);this.manager.run(this,tick);}
  get seeds() {return this.inventory.slots.reduce((n,s)=>n+(s?.item===ITEM.TREE_SEED?s.count:0),0);}
  set seeds(count) {
    const change=count-this.seeds;
    if(change>0)this.inventory.add(ITEM.TREE_SEED,change);
    else if(change<0)this.inventory.remove(ITEM.TREE_SEED,-change);
  }
  snapshot() {return {...super.snapshot(),role:this.config.role,tamed:this.team!==null};}
}

export class MonkeyWorkers {
  constructor(game,random=Math.random) {
    this.game=game;this.random=random;this.sessions=new Map();this.nextSession=1;
    this.pathBudget=C.pathsPerTick;this.pathSearches=0;
  }
  spawn() {
    const {world}=this.game;
    for(let i=0;i<world.keeps.length;i++) {
      const keep=world.keeps[i];
      const island=world.islands.filter(s=>s.kind==='team').reduce((a,b)=>!a||Math.hypot(b.x-keep.cx,b.z-keep.cz)<Math.hypot(a.x-keep.cx,a.z-keep.cz)?b:a,null);
      if(!island)continue;
      const count=Math.max(C.minSpawns,Math.min(C.maxSpawns,Math.ceil(Math.PI*island.radius**2/C.spawnArea)));
      let spawned=0;
      for(let attempt=0;attempt<C.spawnAttempts&&spawned<count;attempt++) {
        const angle=this.random()*Math.PI*2,r=Math.sqrt(this.random())*island.radius*0.75;
        const x=Math.floor(island.x+Math.cos(angle)*r),z=Math.floor(island.z+Math.sin(angle)*r);
        const y=world.getSurfaceY(x,z,id=>isSolid(id)&&![BLOCK.WOOD,BLOCK.BRANCH,BLOCK.LEAVES].includes(id))+1;
        if(![BLOCK.GRASS,BLOCK.DIRT].includes(world.getBlock(x,y-1,z))||!this.stand(x,y,z)
          ||Math.hypot(x-keep.cx,z-keep.cz)<8)continue;
        const monkey=new WorkMonkey(this.game.nextId++,this,{x:x+0.5,y,z:z+0.5});
        this.game.npcs.set(monkey.id,monkey);spawned++;
      }
    }
    for(const island of world.islands.filter(s=>s.kind==='tiny')) {
      if(this.random()>=C.tinyIslandChance)continue;
      const count=C.tinyIslandCount[0]+Math.floor(this.random()*(C.tinyIslandCount[1]-C.tinyIslandCount[0]+1));
      let spawned=0;
      for(let attempt=0;attempt<C.spawnAttempts&&spawned<count;attempt++) {
        const angle=this.random()*Math.PI*2,r=Math.sqrt(this.random())*island.radius*0.6;
        const x=Math.floor(island.x+Math.cos(angle)*r),z=Math.floor(island.z+Math.sin(angle)*r);
        const y=world.getSurfaceY(x,z,id=>isSolid(id)&&![BLOCK.WOOD,BLOCK.BRANCH,BLOCK.LEAVES].includes(id))+1;
        if(![BLOCK.GRASS,BLOCK.DIRT].includes(world.getBlock(x,y-1,z))||!this.stand(x,y,z)
          ||[...this.game.npcs.values()].some(n=>Math.hypot(n.state.x-x-0.5,n.state.z-z-0.5)<2))continue;
        const monkey=new WorkMonkey(this.game.nextId++,this,{x:x+0.5,y,z:z+0.5});
        this.game.npcs.set(monkey.id,monkey);spawned++;
      }
    }
  }
  beginTick() {
    this.pathBudget=C.pathsPerTick;
    for(const [id,s]of this.sessions)if(this.game.tick>=s.expires||!s.player.connected||s.player.dead
      ||s.monkey.dead||distance(s.player.state,s.monkey.state)>C.configureReach) {
      this.sessions.delete(id);this.send(s.player,s.monkey,{closed:true});
    } else if(s.kind==='memory'&&s.hideAt&&this.game.tick>=s.hideAt) {
      s.view(this.game.tick);this.send(s.player,s.monkey,{mode:'tame',...s.view(this.game.tick)});
    } else if(s.kind==='simon'&&!s.readySent&&this.game.tick>=s.ready) {
      s.readySent=true;this.send(s.player,s.monkey,{mode:'tame',...s.view(this.game.tick)});
    }
    if(this.game.tick%TICK_RATE===0)for(const player of this.game.players.values()) {
      const monkey=this.game.npcs.get(player.monkeyViewing);
      if(!monkey)continue;
      if(player.dead||!player.connected||distance(player.state,monkey.state)>C.configureReach) {
        player.monkeyViewing=null;this.game.stowCursor(player);this.send(player,monkey,{closed:true});
      } else this.view(player,monkey);
    }
  }
  changed(x,y,z) {
    for(const m of this.game.npcs.values())if(m instanceof WorkMonkey) {
      for(const [id,route]of m.routes)if(inside(route.bounds,{x,y,z})) {
        m.routes.delete(id);if(m.pathKey===id){m.path=[];m.pathKey=null;}
      }
    }
  }
  send(player,monkey,data) {this.game.send(player,{type:S2C.MONKEY,id:monkey.id,name:monkey.name,team:monkey.team,...data});}
  view(player,m,message=null) {
    this.send(player,m,{mode:'configure',editable:m.team===player.team,config:m.config,revision:m.revision,
      seeds:m.seeds,slots:m.inventory.slots,status:m.status,...(message?{message}:{})});
  }
  open(player,m) {
    const old=this.sessions.get(player.id);
    if(old?.monkey===m) {this.send(player,m,{mode:'tame',...old.view(this.game.tick)});return;}
    this.sessions.delete(player.id);
    player.monkeyViewing=null;
    if(m.team!==null){player.monkeyViewing=m.id;this.view(player,m);return;}
    if([...this.sessions.values()].some(s=>s.monkey===m)) {
      this.send(player,m,{mode:'result',won:false,message:'The monkey is playing with someone else. Try again shortly.'});return;
    }
    const s=new MonkeyTaming(this.nextSession++,m,player,this.game.tick,this.random);
    this.sessions.set(player.id,s);this.send(player,m,{mode:'tame',...s.view(this.game.tick)});
    this.sound(player,m,'grunt','The monkey invites you to play.');
  }
  sound(player,m,sound,text) {this.game.send(player,{type:S2C.SPEAK,id:m.id,name:m.name,voice:'ancientMonkey',sound,text});}
  action(player,msg) {
    const m=this.game.npcs.get(msg.id);
    if(!(m instanceof WorkMonkey)||player.dead||!player.connected)return;
    if(msg.action==='close') {
      this.sessions.delete(player.id);player.monkeyViewing=null;this.game.stowCursor(player);return;
    }
    if(distance(player.state,m.state)>C.configureReach)return;
    if(m.team===null) {
      if(msg.action==='retry'){this.open(player,m);return;}
      const s=this.sessions.get(player.id);
      if(s?.monkey!==m||s.id!==msg.session)return;
      // Simon answers come exclusively from authoritative player movement.
      if(s.kind==='simon')return;
      const result=s.action(msg.action,msg.value,this.game.tick);
      this.tamingResult(s,result);
      return;
    }
    if(m.team!==player.team){this.view(player,m,'Only its team can configure this monkey.');return;}
    if(msg.action==='inventory') {
      this.inventoryClick(player,m,msg);
    } else if(msg.action==='configure') {
      if(msg.revision!==m.revision){this.view(player,m,'A teammate changed these settings. Review and save again.');return;}
      const config=this.parseConfig(msg.config);
      if(!config){this.view(player,m,'Check the targets and work range. Courier From must be an inventory.');return;}
    const geometry=c=>JSON.stringify([c.role,c.target,c.from,c.to,c.home,c.radius,c.vertical,c.sites]);
      if(geometry(config)!==geometry(m.config)) {
        m.routes.clear();m.path=[];m.pathKey=null;
        if(m.woodJob?.logs)this.store(m,{item:BLOCK.WOOD,count:m.woodJob.logs});
        m.woodJob=null;
      }
      m.config=config;m.revision++;m.status='Ready';
      for(const p of this.game.players.values())if(p.monkeyViewing===m.id)this.view(p,m);
    } else if(msg.action==='teleportHome') {
      this.teleportHome(player,m);
    } else if(msg.action==='retry')this.open(player,m);
  }
  inventoryClick(player,m,msg) {
    if(player.monkeyViewing!==m.id||!Number.isInteger(msg.slot)||!['left','right'].includes(msg.button))return;
    const inv=player.inventory;
    const slots=msg.grid==='player'?inv.slots:msg.grid==='monkey'?m.inventory.slots:null;
    if(!slots||msg.slot<0||msg.slot>=slots.length)return;
    let moved=false;
    if(msg.shift) {
      const stack=slots[msg.slot];if(!stack)return;
      const target=msg.grid==='player'?m.inventory:inv;
      const left=target.addStack(stack);moved=left<stack.count;stack.count=left;
      if(!left)slots[msg.slot]=null;
    } else moved=clickSlot(slots,msg.slot,inv,msg.button);
    if(!moved)return;
    player.inventoryDirty=true;
    for(const p of this.game.players.values())if(p.monkeyViewing===m.id)this.view(p,m);
  }
  playerInput(player,input,wasGrounded) {
    const s=this.sessions.get(player.id);
    if(s?.kind!=='simon'||player.dead||!player.connected)return;
    const jump=!!input.jump,crouch=!!input.crouch;
    const value=jump&&!s.jumpHeld&&wasGrounded&&player.state.vy>0?'jump':
      crouch&&!s.crouchHeld&&player.state.crouching?'crouch':null;
    s.jumpHeld=jump;s.crouchHeld=crouch;
    if(!value||this.game.tick<s.ready||s.monkey.dead||distance(player.state,s.monkey.state)>C.configureReach)return;
    this.tamingResult(s,s.action('simon',value,this.game.tick));
  }
  tamingResult(s,result) {
    const {player,monkey:m}=s;
    if(result==='won') {
      m.team=player.team;m.status='Idle';
      for(const [id,other]of this.sessions)if(other.monkey===m) {
        this.sessions.delete(id);other.player.monkeyViewing=m.id;
        this.view(other.player,m,other.player.team===m.team?'Tamed for your team!':'Another team tamed this monkey.');
      }
      this.sound(player,m,'huff','The monkey joins your team.');
    } else if(result==='lost'||result==='expired') {
      this.sessions.delete(player.id);this.send(player,m,{mode:'result',won:false,message:'Try again when you are ready.'});
      this.sound(player,m,'grunt','The monkey wants another game.');
    } else this.send(player,m,{mode:'tame',...s.view(this.game.tick)});
  }
  position(p) {
    return p&&['x','y','z'].every(k=>Number.isInteger(p[k]))&&this.game.world.inBounds(p.x,p.y,p.z)?{x:p.x,y:p.y,z:p.z}:null;
  }
  parseConfig(input) {
    if(!input||!MONKEY_ROLES.includes(input.role)||!Number.isInteger(input.radius)||input.radius<1||input.radius>C.maxRadius
      ||!Number.isInteger(input.vertical)||input.vertical<0||input.vertical>C.maxVertical
      ||!['whitelist','blacklist'].includes(input.filter?.mode)||!Array.isArray(input.filter.items)
      ||input.filter.items.length>C.maxFilter||input.filter.items.some(id=>!items.has(id)||id===BLOCK.AIR)
      ||!Array.isArray(input.sites)||input.sites.length>C.maxSites)return null;
    if(input.home&&!this.position(input.home))return null;
    const config={role:input.role,target:this.position(input.target),from:this.position(input.from),to:this.position(input.to),
      home:this.position(input.home),
      radius:input.radius,vertical:input.vertical,filter:{mode:input.filter.mode,items:[...new Set(input.filter.items)]},sites:[]};
    if(config.role==='courier') {
      if(!config.from||!config.to||!this.container(config.from))return null;
      config.target=config.to;
      if(key(config.from)===key(config.to)||!monkeyRange(config,config.from))return null;
    }
    if(config.role!=='idle'&&!config.target)return null;
    for(const p of input.sites) {
      const pos=this.position(p);if(!pos)return null;
      const site=[BLOCK.GRASS,BLOCK.DIRT].includes(this.game.world.getBlock(pos.x,pos.y,pos.z))?{...pos,y:pos.y+1}:pos;
      if(!this.position(site)||config.target&&!monkeyRange(config,site))return null;
      if(!config.sites.some(s=>key(s)===key(site)))config.sites.push(site);
    }
    return config;
  }
  container(p) {
    if(!p)return null;
    const c=this.game.world.tileEntities.get(key(p));
    c?.populate?.(this.game.seed,p.x,p.y,p.z);return c;
  }
  teleportHome(player,m) {
    const keep=player.keep;
    if(!keep)return;
    const y=keep.floorY+1;
    const offsets=[[2,0],[-2,0],[0,2],[0,-2],[3,0],[-3,0],[0,3],[0,-3]];
    const site=offsets.map(([dx,dz])=>({x:keep.cx+dx,y,z:keep.cz+dz}))
      .find(p=>this.stand(p.x,p.y,p.z));
    if(!site){this.view(player,m,'No clear spot beside the keep.');return;}
    if(m.woodJob?.logs)this.store(m,{item:BLOCK.WOOD,count:m.woodJob.logs});
    m.woodJob=null;m.routes.clear();m.path=[];m.pathKey=null;
    Object.assign(m.state,{x:site.x+0.5,y:site.y,z:site.z+0.5,vx:0,vy:0,vz:0,kx:0,kz:0,
      onGround:true});
    m.home={x:m.state.x,y:m.state.y,z:m.state.z,yaw:m.state.yaw};
    m.status='At the keep';
    for(const viewer of this.game.players.values())if(viewer.monkeyViewing===m.id) {
      viewer.monkeyViewing=null;this.game.stowCursor(viewer);this.send(viewer,m,{closed:true});
    }
  }
  store(m,stack) {
    const left=m.inventory.addStack(stack);
    if(left) this.game.spawnItem(stack.item,left,m.state.x,m.state.y+1,m.state.z,0,0,0,0.5,stack.mods);
    return stack.count-left;
  }
  deliveryStack(m) {
    let seedReserve=m.config.role==='lumberjack'?1:0;
    for(let slot=0;slot<m.inventory.slots.length;slot++) {
      const stack=m.inventory.slots[slot];
      if(!stack||!monkeyFilter(m.config,stack.item))continue;
      const reserved=stack.item===ITEM.TREE_SEED?Math.min(seedReserve,stack.count):0;
      seedReserve-=reserved;
      const count=Math.min(C.capacity,stack.count-reserved);
      if(count>0)return {slot,stack,count};
    }
    return null;
  }
  stand(x,y,z) {
    return canStand(this.game.world,x,y,z,Math.ceil(C.box.height))
      &&playerFitsAt(this.game.world,{x:x+0.5,y,z:z+0.5,box:C.box},y);
  }
  near(m,p) {return Math.hypot(m.state.x-p.x-0.5,m.state.z-p.z-0.5)<=1.6&&Math.abs(m.state.y-p.y)<=C.maxVertical+1;}
  travel(m,p,leg) {
    if(this.near(m,p)){m.path=[];m.pathKey=null;return true;}
    if(m.pathKey===leg&&m.path.length)return false;
    const start={x:Math.floor(m.state.x),y:Math.round(m.state.y),z:Math.floor(m.state.z)};
    let route=m.routes.get(leg);
    if(route&&key(route.goal)!==key(p)){m.routes.delete(leg);route=null;}
    if(route&&!route.failed) {
      let nearest=0,best=Infinity;
      route.points.forEach((n,i)=>{const d=distance(n,start);if(d<best){best=d;nearest=i;}});
      if(best<=1.5){m.path=route.points.slice(nearest+1).map(n=>({...n}));m.pathKey=leg;return false;}
      m.routes.delete(leg);route=null;
    }
    if(route?.failed){m.status='Waiting for a clear route';return false;}
    if(this.pathBudget<=0)return false;
    this.pathBudget--;this.pathSearches++;
    const candidates=[];
    for(let dy=-C.maxVertical;dy<=C.maxVertical;dy++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const goal={x:p.x+dx,y:p.y+dy,z:p.z+dz};
      if((leg==='home'||monkeyRange(m.config,goal))&&this.stand(goal.x,goal.y,goal.z))candidates.push(goal);
    }
    candidates.sort((a,b)=>distance(a,start)-distance(b,start));
    const goal=candidates[0];
    const path=goal?findPath(this.game.world,start,goal,{height:Math.ceil(C.box.height),halfWidth:C.box.halfW,
      maxNodes:C.pathNodes,goalHeight:true,allowed:(x,y,z)=>!!m.config.home||leg==='home'||monkeyRange(m.config,{x,y,z})
        ||!monkeyRange(m.config,start)&&Math.hypot(x-start.x,z-start.z)<=C.configureReach
          &&Math.abs(y-start.y)<=C.maxVertical}):[];
    const complete=goal&&distance(path.at(-1)??start,goal)<0.1;
    const points=[start,...path].map(n=>({...n,grounded:true}));
    const t=m.config.target??p,r=m.config.radius;
    // Failed searches watch the work volume so opening a new route retries them.
    const bounds=complete?{x0:Math.min(...points.map(n=>n.x))-1,x1:Math.max(...points.map(n=>n.x))+1,
      y0:Math.min(...points.map(n=>n.y))-1,y1:Math.max(...points.map(n=>n.y))+Math.ceil(C.box.height),
      z0:Math.min(...points.map(n=>n.z))-1,z1:Math.max(...points.map(n=>n.z))+1}:
      {x0:t.x-r,x1:t.x+r,y0:Math.min(start.y,t.y-C.maxVertical)-1,y1:t.y+C.maxVertical+3,z0:t.z-r,z1:t.z+r};
    m.routes.set(leg,{goal:{...p},points,bounds,failed:!complete});
    if(complete){m.path=points.slice(1).map(n=>({...n}));m.pathKey=leg;}
    else m.status='Waiting for a clear route';
    return false;
  }
  run(m,tick) {
    if(m.state.y<this.game.world.minY){Object.assign(m.state,m.home,{vy:0});m.routes.clear();m.path=[];m.pathKey=null;}
    const game=[...this.sessions.values()].find(s=>s.monkey===m&&s.kind==='simon');
    if(game) {
      const elapsed=tick-game.start-C.simonStepTicks,index=Math.floor(elapsed/C.simonStepTicks);
      const phase=elapsed%C.simonStepTicks;
      const cue=index>=0&&index<game.sequence.length?game.sequence[index]:null;
      const crouch=cue==='crouch'&&phase<C.simonStepTicks*0.7;
      stepPlayer(m.state,{forward:0,strafe:0,yaw:m.state.yaw,pitch:0,crouch,
        jump:cue==='jump'&&phase===0},this.game.world);
      m.pose=crouch?'crouch':m.state.onGround?'ready':'jump';return;
    }
    const moved=stepMobPath(m,this.game.world,C.speed);
    if(m.path.length&&moved<0.01) {
      if(++m.stuck>=C.stuckTicks){m.routes.clear();m.path=[];m.pathKey=null;m.stuck=0;}
    } else m.stuck=0;
    // Direction changes and pauses between task legs retain an upright pose.
    m.pose=m.walking?'walk':m.team!==null&&m.config.role!=='idle'?'ready':'sit';
    if(m.team===null||tick%C.thinkTicks!==m.id%C.thinkTicks)return;
    let busy=false;
    const delivery=m.config.role!=='idle'&&m.config.target&&this.deliveryStack(m);
    if(delivery)busy=!this.travel(m,m.config.target,'to')||this.deliver(m);
    else {
      if(m.config.role==='collector')busy=this.collect(m);
      if(m.config.role==='courier')busy=this.courier(m);
      if(m.config.role==='lumberjack')busy=this.lumberjack(m,tick);
    }
    if(!busy&&m.config.home) {
      if(!this.near(m,m.config.home))this.travel(m,m.config.home,'home');
      else if(m.config.role==='idle')m.status='Idle at home';
    } else if(m.config.role==='idle')m.status='Idle';
  }
  deliver(m) {
    const delivery=this.deliveryStack(m);
    if(!delivery)return false;
    const {slot,stack,count}=delivery;
    const load=cloneStack(stack,count);
    const c=this.container(m.config.target);
    if(c) {
      if(['alloyFurnace','boiler','crusher'].includes(c.kind)) c.insert(load);
      else if(c.kind==='furnace') {
        if(load.item in FUEL)mergeInto(c.slots,FUEL_SLOT,load);
        if(load.count)mergeInto(c.slots,INPUT,load);
      } else c.insert(load);
      if(load.count!==count)c.dirty=true;
      m.status=load.count?'Destination is full':'Delivered';
    } else {
      const t=m.config.target;
      this.game.spawnItem(load.item,load.count,t.x+0.5,t.y+1.15,t.z+0.5,0,0,0,0.5,load.mods);
      load.count=0;m.status='Delivered';
    }
    const moved=count-load.count;
    stack.count-=moved;
    if(!stack.count)m.inventory.slots[slot]=null;
    return moved>0;
  }
  onTarget(m,p) {
    const t=m.config.target;
    return Math.floor(p.x)===t.x&&Math.floor(p.z)===t.z&&p.y>=t.y&&p.y<=t.y+2;
  }
  collect(m) {
    const drops=[...(this.game.items.nearbyValues?.(m.config.target,m.config.radius)??this.game.items.values())].filter(e=>!e.pickupTicks&&monkeyRange(m.config,e.state)
      &&monkeyFilter(m.config,e.item)&&!this.onTarget(m,e.state));
    const chosen=drops.sort((a,b)=>distance(a.state,m.state)-distance(b.state,m.state))[0];
    if(!chosen){m.status='Waiting for items';return false;}
    const p={x:Math.floor(chosen.state.x),y:Math.floor(chosen.state.y),z:Math.floor(chosen.state.z)};
    if(!this.travel(m,p,`item:${chosen.id}`))return true;
    const n=Math.min(C.capacity,chosen.count),left=m.inventory.addStack(cloneStack(chosen,n));
    if(n===left){m.status='Inventory is full';return false;}
    chosen.count-=n-left;if(!chosen.count)this.game.removeItem(chosen);
    m.routes.delete(`item:${chosen.id}`);m.status='Collecting';
    return true;
  }
  courier(m) {
    const c=this.container(m.config.from);
    if(!c){m.status='Source is missing';return false;}
    const indices=c.kind==='furnace'?[OUTPUT]:c.kind==='alloyFurnace'?[3]:c.kind==='crusher'?[1]
      :c.kind==='boiler'||c.kind==='tank'?[]:c.slots.map((_,i)=>i);
    const index=indices.find(i=>c.slots[i]&&monkeyFilter(m.config,c.slots[i].item));
    if(index===undefined){m.status='Waiting for source items';return false;}
    if(!this.travel(m,m.config.from,'from'))return true;
    const s=c.slots[index],n=Math.min(C.capacity,s.count),left=m.inventory.addStack(cloneStack(s,n));
    if(n===left){m.status='Inventory is full';return false;}
    s.count-=n-left;if(!s.count)c.slots[index]=null;c.dirty=true;m.status='Carrying';
    return true;
  }
  reserveSeed(m) {
    if(m.seeds)return true;
    if(!this.travel(m,m.config.target,'to'))return false;
    const c=this.container(m.config.target),s=c?.slots.find(s=>s?.item===ITEM.TREE_SEED);
    if(s){if(m.inventory.add(ITEM.TREE_SEED,1)){m.status='Make room for a sapling in the inventory';return false;}
      s.count--;if(!s.count)c.slots[c.slots.indexOf(s)]=null;c.dirty=true;return true;}
    const drop=[...(this.game.items.nearbyValues?.(m.config.target,1)??this.game.items.values())].find(e=>e.item===ITEM.TREE_SEED&&this.onTarget(m,e.state)&&!e.pickupTicks);
    if(drop){if(m.inventory.add(ITEM.TREE_SEED,1)){m.status='Make room for a sapling in the inventory';return false;}
      if(!--drop.count)this.game.removeItem(drop);return true;}
    m.status='Needs a sapling before chopping';return false;
  }
  collectTreeSaplings(m) {
    const drops=this.game.items.nearbyValues?.(m.config.target,m.config.radius)??this.game.items.values();
    let chosen=null,best=Infinity;
    for(const e of drops) {
      if(e.item!==ITEM.TREE_SEED||e.pickupTicks||!monkeyRange(m.config,e.state)||this.onTarget(m,e.state)
        ||m.seeds&&!monkeyFilter(m.config,e.item)
        ||!m.config.sites.some(s=>Math.hypot(e.state.x-s.x-0.5,e.state.z-s.z-0.5)<=2.5))continue;
      const d=distance(e.state,m.state);if(d<best){chosen=e;best=d;}
    }
    if(!chosen)return false;
    const p={x:Math.floor(chosen.state.x),y:Math.floor(chosen.state.y),z:Math.floor(chosen.state.z)};
    if(!this.travel(m,p,`seed:${chosen.id}`))return true;
    if(!m.seeds&&m.inventory.add(ITEM.TREE_SEED,1)===0)chosen.count--;
    const n=monkeyFilter(m.config,ITEM.TREE_SEED)?Math.min(C.capacity,chosen.count):0;
    if(n){const left=m.inventory.add(ITEM.TREE_SEED,n);chosen.count-=n-left;}
    if(!chosen.count)this.game.removeItem(chosen);
    m.routes.delete(`seed:${chosen.id}`);m.status=this.deliveryStack(m)?'Gathering saplings':'Sapling reserved';
    return true;
  }
  lumberjack(m,tick) {
    const w=this.game.world;
    if(!m.config.sites.length){m.status='Select tree bases or planting spots';return false;}
    if(!m.woodJob&&this.collectTreeSaplings(m))return true;
    if(!this.reserveSeed(m))return m.pathKey==='to'&&m.path.length>0;
    if(m.woodJob) {
      const job=m.woodJob;if(tick<job.due)return true;
      let budget=C.chopBlocksPerThink;
      while(job.cells.length&&budget-->0) {
        const cell=job.cells.pop();
        if(w.getBlock(cell.x,cell.y,cell.z)!==cell.id)continue;
        w.setBlock(cell.x,cell.y,cell.z,BLOCK.AIR);if(cell.id===BLOCK.WOOD)job.logs++;
      }
      if(job.cells.length)return true;
      const site=job.site;
      if(job.logs&&w.getBlock(site.x,site.y,site.z)===BLOCK.AIR&&[BLOCK.GRASS,BLOCK.DIRT].includes(w.getBlock(site.x,site.y-1,site.z))) {
        w.setBlock(site.x,site.y,site.z,BLOCK.SAPLING);m.seeds--;
        // Each completed tree supplies the next reserved sapling; leaf decay
        // can still yield extra saplings through the normal drop system.
        m.seeds++;
      }
      if(job.logs)this.store(m,{item:BLOCK.WOOD,count:job.logs});
      m.woodJob=null;m.status='Tree chopped and replanted';return true;
    }
    if(!monkeyFilter(m.config,BLOCK.WOOD)){m.status='Logs are excluded by the filter';return false;}
    for(const site of m.config.sites) {
      if(w.getBlock(site.x,site.y,site.z)===BLOCK.WOOD) {
        if(!this.travel(m,site,`tree:${key(site)}`))return true;
        const cells=[];let crown=false,gap=0;
        // Only explicitly marked columns are authorized. No natural-tree
        // registry or connected-log search can expand a job into a building.
        for(let y=site.y;y<Math.min(w.sizeY,site.y+C.maxTreeHeight);y++) {
          const id=w.getBlock(site.x,y,site.z);
          if(id===BLOCK.WOOD||id===BLOCK.BRANCH){cells.push({x:site.x,y,z:site.z,id});gap=0;}
          else if(id===BLOCK.LEAVES){crown=true;gap=0;}
          else if(id!==BLOCK.AIR||++gap>3)break;
        }
        if(!crown||!cells.length)continue;
        m.woodJob={site,cells,logs:0,due:tick+C.chopTicks};m.status='Chopping';return true;
      }
      if(w.getBlock(site.x,site.y,site.z)===BLOCK.AIR&&[BLOCK.GRASS,BLOCK.DIRT].includes(w.getBlock(site.x,site.y-1,site.z))) {
        if(!this.travel(m,site,`tree:${key(site)}`))return true;
        w.setBlock(site.x,site.y,site.z,BLOCK.SAPLING);m.seeds--;m.status='Planted; waiting for growth';return true;
      }
    }
    m.status='Waiting for trees to grow';return false;
  }
}
