import { Npc } from './npcs.js';
import { findPath, canStand } from './pathfind.js';
import { stepMobPath } from '../shared/mobMovement.js';
import { playerFitsAt } from '../shared/physics.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { ITEM, registeredItemIds } from '../shared/items.js';
import { FUEL } from '../shared/recipes.js';
import { MONKEY_WORK as C, TICK_RATE } from '../shared/config.js';
import { NPC_KIND } from '../shared/npcs.js';
import { MONKEY_ROLES, MONKEY_NAMES, defaultMonkeyConfig, monkeyFilter, monkeyRange } from '../shared/monkeys.js';
import { mergeInto, OUTPUT, INPUT, FUEL_SLOT } from './containers.js';
import { S2C } from '../shared/protocol.js';
import { MonkeyTaming } from './monkeyTaming.js';

const key=p=>`${p.x},${p.y},${p.z}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const items=new Set(registeredItemIds());
const inside=(b,p)=>p.x>=b.x0&&p.x<=b.x1&&p.y>=b.y0&&p.y<=b.y1&&p.z>=b.z0&&p.z<=b.z1;
const cloneStack=(s,count=s.count)=>({...s,count,...(s.mods?{mods:s.mods.map(m=>({...m}))}:{})});

export class WorkMonkey extends Npc {
  constructor(id,manager,site) {
    super(id,{...site,npc:NPC_KIND.WORK_MONKEY,yaw:0},null,manager.game.tick);
    this.manager=manager;this.name=MONKEY_NAMES[Math.floor(manager.random()*MONKEY_NAMES.length)];
    this.config=defaultMonkeyConfig();this.revision=0;this.seeds=0;this.cargo=null;
    this.routes=new Map();this.path=[];this.pathKey=null;this.stuck=0;this.status='Wild';
    this.state.edgeGuard=true;this.woodJob=null;
  }
  step(world,players,tick) {this.lookAtNearest(players);this.manager.run(this,tick);}
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
  }
  beginTick() {
    this.pathBudget=C.pathsPerTick;
    for(const [id,s]of this.sessions)if(this.game.tick>=s.expires||!s.player.connected||s.player.dead
      ||s.monkey.dead||distance(s.player.state,s.monkey.state)>C.configureReach) {
      this.sessions.delete(id);this.send(s.player,s.monkey,{closed:true});
    } else if(s.kind==='memory'&&s.hideAt&&this.game.tick>=s.hideAt) {
      s.view(this.game.tick);this.send(s.player,s.monkey,{mode:'tame',...s.view(this.game.tick)});
    }
    if(this.game.tick%TICK_RATE===0)for(const player of this.game.players.values()) {
      const monkey=this.game.npcs.get(player.monkeyViewing);
      if(!monkey)continue;
      if(player.dead||!player.connected||distance(player.state,monkey.state)>C.configureReach) {
        player.monkeyViewing=null;this.send(player,monkey,{closed:true});
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
      seeds:m.seeds,cargo:m.cargo,status:m.status,...(message?{message}:{})});
  }
  open(player,m) {
    if(m.team!==null){player.monkeyViewing=m.id;this.view(player,m);return;}
    const old=this.sessions.get(player.id);
    const s=old?.monkey===m?old:new MonkeyTaming(this.nextSession++,m,player,this.game.tick,this.random);
    this.sessions.set(player.id,s);this.send(player,m,{mode:'tame',...s.view(this.game.tick)});
    this.sound(player,m,'grunt','The monkey invites you to play.');
  }
  sound(player,m,sound,text) {this.game.send(player,{type:S2C.SPEAK,id:m.id,name:m.name,voice:'ancientMonkey',sound,text});}
  action(player,msg) {
    const m=this.game.npcs.get(msg.id);
    if(!(m instanceof WorkMonkey)||player.dead||!player.connected)return;
    if(msg.action==='close') {
      this.sessions.delete(player.id);player.monkeyViewing=null;return;
    }
    if(distance(player.state,m.state)>C.configureReach)return;
    if(m.team===null) {
      if(msg.action==='retry'){this.open(player,m);return;}
      const s=this.sessions.get(player.id);
      if(s?.monkey!==m||s.id!==msg.session)return;
      const result=s.action(msg.action,msg.value,this.game.tick);
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
      return;
    }
    if(m.team!==player.team){this.view(player,m,'Only its team can configure this monkey.');return;}
    if(msg.action==='seed') {
      const stack=player.inventory.slots.find(s=>s?.item===ITEM.TREE_SEED&&s.count>0);
      if(stack&&m.seeds<64){stack.count--;if(!stack.count)player.inventory.slots[player.inventory.slots.indexOf(stack)]=null;
        m.seeds++;player.inventoryDirty=true;this.view(player,m,'Sapling supplied.');}
      else this.view(player,m,'Carry a sapling in your inventory first.');
    } else if(msg.action==='configure') {
      if(msg.revision!==m.revision){this.view(player,m,'A teammate changed these settings. Review and save again.');return;}
      const config=this.parseConfig(msg.config);
      if(!config){this.view(player,m,'Check the targets and work range. Courier From must be an inventory.');return;}
      const geometry=c=>JSON.stringify([c.role,c.target,c.from,c.to,c.radius,c.vertical,c.sites]);
      if(geometry(config)!==geometry(m.config)) {
        m.routes.clear();m.path=[];m.pathKey=null;
        if(m.woodJob?.logs)m.cargo={item:BLOCK.WOOD,count:m.woodJob.logs};
        m.woodJob=null;
      }
      m.config=config;m.revision++;m.status='Ready';
      // Cargo survives configuration changes and is delivered before new work.
      for(const p of this.game.players.values())if(p.monkeyViewing===m.id)this.view(p,m,'Settings saved.');
    } else if(msg.action==='retry')this.open(player,m);
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
    const config={role:input.role,target:this.position(input.target),from:this.position(input.from),to:this.position(input.to),
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
      if(monkeyRange(m.config,goal)&&this.stand(goal.x,goal.y,goal.z))candidates.push(goal);
    }
    candidates.sort((a,b)=>distance(a,start)-distance(b,start));
    const goal=candidates[0];
    const path=goal?findPath(this.game.world,start,goal,{height:Math.ceil(C.box.height),halfWidth:C.box.halfW,
      maxNodes:C.pathNodes,goalHeight:true,allowed:(x,y,z)=>monkeyRange(m.config,{x,y,z})
        ||!monkeyRange(m.config,start)&&Math.hypot(x-start.x,z-start.z)<=C.configureReach
          &&Math.abs(y-start.y)<=C.maxVertical}):[];
    const complete=goal&&distance(path.at(-1)??start,goal)<0.1;
    const points=[start,...path].map(n=>({...n,grounded:true}));
    const t=m.config.target,r=m.config.radius;
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
    const moved=stepMobPath(m,this.game.world,C.speed);
    if(m.path.length&&moved<0.01) {
      if(++m.stuck>=C.stuckTicks){m.routes.clear();m.path=[];m.pathKey=null;m.stuck=0;}
    } else m.stuck=0;
    m.pose=m.walking?'walk':m.woodJob?'stand':'sit';
    if(m.team===null||tick%C.thinkTicks!==m.id%C.thinkTicks)return;
    if(m.cargo) {
      if(m.config.target&&this.travel(m,m.config.target,'to'))this.deliver(m);
      return;
    }
    if(m.config.role==='idle'){m.status='Idle';return;}
    if(m.config.role==='collector')this.collect(m);
    if(m.config.role==='courier')this.courier(m);
    if(m.config.role==='lumberjack')this.lumberjack(m,tick);
  }
  deliver(m) {
    const c=this.container(m.config.target);
    if(c) {
      const before=m.cargo.count;
      if(c.kind==='furnace') {
        if(m.cargo.item in FUEL)mergeInto(c.slots,FUEL_SLOT,m.cargo);
        if(m.cargo.count)mergeInto(c.slots,INPUT,m.cargo);
      } else c.insert(m.cargo);
      if(m.cargo.count!==before)c.dirty=true;
      m.status=m.cargo.count?'Destination is full':'Delivered';
      if(!m.cargo.count)m.cargo=null;
    } else {
      const t=m.config.target,s=m.cargo;
      this.game.spawnItem(s.item,s.count,t.x+0.5,t.y+1.15,t.z+0.5,0,0,0,0.5,s.mods);
      m.cargo=null;m.status='Delivered';
    }
  }
  onTarget(m,p) {
    const t=m.config.target;
    return Math.floor(p.x)===t.x&&Math.floor(p.z)===t.z&&p.y>=t.y&&p.y<=t.y+2;
  }
  collect(m) {
    const drops=[...(this.game.items.nearbyValues?.(m.config.target,m.config.radius)??this.game.items.values())].filter(e=>!e.pickupTicks&&monkeyRange(m.config,e.state)
      &&monkeyFilter(m.config,e.item)&&!this.onTarget(m,e.state));
    const chosen=drops.sort((a,b)=>distance(a.state,m.state)-distance(b.state,m.state))[0];
    if(!chosen){m.status='Waiting for items';return;}
    const p={x:Math.floor(chosen.state.x),y:Math.floor(chosen.state.y),z:Math.floor(chosen.state.z)};
    if(!this.travel(m,p,`item:${chosen.id}`))return;
    const n=Math.min(C.capacity,chosen.count);m.cargo=cloneStack({item:chosen.item,count:n,mods:chosen.mods},n);
    chosen.count-=n;if(!chosen.count)this.game.removeItem(chosen);
    m.routes.delete(`item:${chosen.id}`);m.status='Collecting';
  }
  courier(m) {
    const c=this.container(m.config.from);
    if(!c){m.status='Source is missing';return;}
    if(!this.travel(m,m.config.from,'from'))return;
    const indices=c.kind==='furnace'?[OUTPUT]:c.slots.map((_,i)=>i);
    const index=indices.find(i=>c.slots[i]&&monkeyFilter(m.config,c.slots[i].item));
    if(index===undefined){m.status='Waiting for source items';return;}
    const s=c.slots[index],n=Math.min(C.capacity,s.count);m.cargo=cloneStack(s,n);
    s.count-=n;if(!s.count)c.slots[index]=null;c.dirty=true;m.status='Carrying';
  }
  reserveSeed(m) {
    if(m.seeds)return true;
    if(!this.travel(m,m.config.target,'to'))return false;
    const c=this.container(m.config.target),s=c?.slots.find(s=>s?.item===ITEM.TREE_SEED);
    if(s){s.count--;if(!s.count)c.slots[c.slots.indexOf(s)]=null;c.dirty=true;m.seeds++;return true;}
    const drop=[...(this.game.items.nearbyValues?.(m.config.target,1)??this.game.items.values())].find(e=>e.item===ITEM.TREE_SEED&&this.onTarget(m,e.state)&&!e.pickupTicks);
    if(drop){if(!--drop.count)this.game.removeItem(drop);m.seeds++;return true;}
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
    if(!m.seeds){m.seeds++;chosen.count--;}
    const n=monkeyFilter(m.config,ITEM.TREE_SEED)?Math.min(C.capacity,chosen.count):0;
    if(n){m.cargo=cloneStack({item:chosen.item,count:n,mods:chosen.mods},n);chosen.count-=n;}
    if(!chosen.count)this.game.removeItem(chosen);
    m.routes.delete(`seed:${chosen.id}`);m.status=m.cargo?'Gathering saplings':'Sapling reserved';
    return true;
  }
  lumberjack(m,tick) {
    const w=this.game.world;
    if(!m.config.sites.length){m.status='Select tree bases or planting spots';return;}
    if(!m.woodJob&&this.collectTreeSaplings(m))return;
    if(!this.reserveSeed(m))return;
    if(m.woodJob) {
      const job=m.woodJob;if(tick<job.due)return;
      let budget=C.chopBlocksPerThink;
      while(job.cells.length&&budget-->0) {
        const cell=job.cells.pop();
        if(w.getBlock(cell.x,cell.y,cell.z)!==cell.id)continue;
        w.setBlock(cell.x,cell.y,cell.z,BLOCK.AIR);if(cell.id===BLOCK.WOOD)job.logs++;
      }
      if(job.cells.length)return;
      const site=job.site;
      if(job.logs&&w.getBlock(site.x,site.y,site.z)===BLOCK.AIR&&[BLOCK.GRASS,BLOCK.DIRT].includes(w.getBlock(site.x,site.y-1,site.z))) {
        w.setBlock(site.x,site.y,site.z,BLOCK.SAPLING);m.seeds--;
        // Each completed tree supplies the next reserved sapling; leaf decay
        // can still yield extra saplings through the normal drop system.
        m.seeds++;
      }
      if(job.logs)m.cargo={item:BLOCK.WOOD,count:job.logs};
      m.woodJob=null;m.status='Tree chopped and replanted';return;
    }
    if(!monkeyFilter(m.config,BLOCK.WOOD)){m.status='Logs are excluded by the filter';return;}
    for(const site of m.config.sites) {
      if(w.getBlock(site.x,site.y,site.z)===BLOCK.WOOD) {
        if(!this.travel(m,site,`tree:${key(site)}`))return;
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
        m.woodJob={site,cells,logs:0,due:tick+C.chopTicks};m.status='Chopping';return;
      }
      if(w.getBlock(site.x,site.y,site.z)===BLOCK.AIR&&[BLOCK.GRASS,BLOCK.DIRT].includes(w.getBlock(site.x,site.y-1,site.z))) {
        if(!this.travel(m,site,`tree:${key(site)}`))return;
        w.setBlock(site.x,site.y,site.z,BLOCK.SAPLING);m.seeds--;m.status='Planted; waiting for growth';return;
      }
    }
    m.status='Waiting for trees to grow';
  }
}
