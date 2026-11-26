// Working monkeys: taming, configuration and the work itself.
//
// A tamed monkey thinks every MONKEY_WORK.thinkTicks: it keeps doing its
// current task (walk somewhere, then act there), or picks the next one:
// deliver when it carries enough, else its role's work, else deliver what's
// left, else wait (at home if it has one). Availability is always checked
// from afar first, so an idle monkey never walks back and forth to look.
//
// Roles (shared/monkeys.js): courier, collector, lumberjack, quarry, farmer.
// Destinations take turns (round robin). Breaking speed and ability come
// from the hammer in its tool slot, like a player's. Monkeys climb walls
// (pathfinding `climb`), drawn with the 'climb' pose.
import { Npc } from './npcs.js';
import { findPath, canStand } from './pathfind.js';
import { stepMobPath } from '../shared/mobMovement.js';
import { playerFitsAt, stepPlayer } from '../shared/physics.js';
import { BLOCK, isSolid, isLiquid, getBlockDef, canBreak, breakTicks, blockDrops, cropAt, isMatureCrop, isCrop,
  CROPS, isDoor, isLadder } from '../shared/blocks.js';
import { ITEM, getItemDef, registeredItemIds } from '../shared/items.js';
import { FUEL, SMELTING } from '../shared/recipes.js';
import { breakingStats } from '../shared/tools.js';
import { MONKEY_WORK as C, TICK_RATE, TICK_DT } from '../shared/config.js';
import { NPC_KIND } from '../shared/npcs.js';
import { MONKEY_ROLES, MONKEY_NAMES, MONKEY_FIELDS, defaultMonkeyConfig, monkeyFilter, monkeyRange,
  quarryCells, farmBox, QUARRY_OPTIONS, GATHERING_ROLES, SLOT_OPTIONS } from '../shared/monkeys.js';
import { getRecipe } from '../shared/recipes.js';
import { MONKEY_DUTY as D, ITEM_POP_SPEED, ITEM_PICKUP_DELAY } from '../shared/config.js';
import { guardTick, guardPatrol, lookoutWatch, holdsWeapon } from './monkeyGuard.js';
import { mergeInto, OUTPUT, INPUT, FUEL_SLOT, ALLOY_INPUTS, ALLOY_FUEL, ALLOY_OUTPUT, DEPOT_OUTPUTS } from './containers.js';
import { S2C } from '../shared/protocol.js';
import { MonkeyTaming } from './monkeyTaming.js';
import { Inventory, clickSlot } from './inventory.js';
import { modValue } from '../shared/modifiers.js';

const key=p=>`${p.x},${p.y},${p.z}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const items=new Set(registeredItemIds());
const inside=(b,p)=>p.x>=b.x0&&p.x<=b.x1&&p.y>=b.y0&&p.y<=b.y1&&p.z>=b.z0&&p.z<=b.z1;
const cloneStack=(s,count=s.count)=>({...s,count,...(s.mods?{mods:s.mods.map(m=>({...m}))}:{})});
const TOOL=0,ARMOR=1;
const CROP_SEEDS=new Set(Object.values(CROPS).map(c=>c.seed));

export class WorkMonkey extends Npc {
  constructor(id,manager,site) {
    super(id,{...site,npc:NPC_KIND.WORK_MONKEY,yaw:0},null,manager.game.tick);
    this.manager=manager;this.name=MONKEY_NAMES[Math.floor(manager.random()*MONKEY_NAMES.length)];
    this.config=defaultMonkeyConfig();this.revision=0;this.inventory=new Inventory(C.inventorySize);
    // [tool, armor] stacks.
    this.gear=[null,null];
    this.path=[];this.pathKey=null;this.stuck=0;this.status='Wild';
    this.task=null;this.badSpots=new Map();this.destIndex=0;this.sourceIndex=0;
    this.quarry={cells:null,index:0,signature:null,wrapAt:0,done:false};
    // Farmland cell key -> crop kind last seen growing there.
    this.cropMemory=new Map();this.farmScan=null;
    this.idleUntil=0;this.working=false;
    this.state.edgeGuard=true;
    // Babies (bought from the Sky Merchant) grow up at growAt; until then
    // they can't take a role or fight.
    this.baby=false;this.growAt=0;
    // Guards and lookouts: patrol progress, combat target, reports.
    this.patrolIndex=0;this.target=null;this.nextAttack=0;this.drawTicks=0;this.reports=new Map();
    // Arrows a monkey shoots only hit what is hostile to its team.
    this.teamShooter=true;
  }
  step(world,players,tick) {this.lookAtNearest(players);this.manager.run(this,tick);}
  get tool() {return this.gear[TOOL];}
  armorPoints() {const a=this.gear[ARMOR];return a?(getItemDef(a.item).armorPoints||0)+modValue(a,'sturdy'):0;}
  count(test) {return this.inventory.slots.reduce((n,s)=>n+(s&&test(s.item)?s.count:0),0);}
  take(item,count) {this.inventory.remove(item,count);}
  snapshot() {
    return {...super.snapshot(),role:this.config.role,tamed:this.team!==null,tool:this.gear[TOOL]?.item??null,
      armor:this.gear[ARMOR]?.item??null,...(this.baby?{baby:true}:{}),...(this.drawTicks?{draw:1}:{})};
  }
}

export class MonkeyWorkers {
  constructor(game,random=Math.random) {
    this.game=game;this.random=random;this.sessions=new Map();this.nextSession=1;
    this.pathBudget=C.pathsPerTick;this.pathSearches=0;
  }

  // ---- Spawning ----

  spawn() {
    const {world}=this.game;
    for(let i=0;i<world.keeps.length;i++) {
      const keep=world.keeps[i];
      const island=world.islands.filter(s=>s.kind==='team').reduce((a,b)=>!a||Math.hypot(b.x-keep.cx,b.z-keep.cz)<Math.hypot(a.x-keep.cx,a.z-keep.cz)?b:a,null);
      if(!island)continue;
      const count=Math.max(C.minSpawns,Math.min(C.maxSpawns,Math.ceil(Math.PI*island.radius**2/C.spawnArea)));
      this.spawnOn(island,count,0.75,(x,z)=>Math.hypot(x-keep.cx,z-keep.cz)>=8);
    }
    this.spawnInCentralTrees();
    for(const island of world.islands.filter(s=>s.kind==='tiny')) {
      if(this.random()>=C.tinyIslandChance)continue;
      const count=C.tinyIslandCount[0]+Math.floor(this.random()*(C.tinyIslandCount[1]-C.tinyIslandCount[0]+1));
      this.spawnOn(island,count,0.6,(x,z)=>![...this.game.npcs.values()].some(n=>Math.hypot(n.state.x-x-0.5,n.state.z-z-0.5)<2));
    }
  }
  // A baby monkey for a team (bought from the Sky Merchant) at a standing cell.
  spawnBaby(spot,team) {
    const m=new WorkMonkey(this.game.nextId++,this,{x:spot.x+0.5,y:spot.y,z:spot.z+0.5});
    m.team=team;m.baby=true;m.growAt=this.game.tick+Math.round(D.baby.growSeconds*TICK_RATE);m.status='Growing up';
    m.home={x:m.state.x,y:m.state.y,z:m.state.z,yaw:0};
    this.game.npcs.set(m.id,m);
    this.game.broadcast?.({type:S2C.ENTITY_SPAWN,entity:m.describe()});
    return m;
  }
  // Wild monkeys up in the central island's tallest trees, now and then:
  // never many, so team and tiny islands stay the main place to find them.
  spawnInCentralTrees() {
    const {world}=this.game,T=D.centralTrees,center=world.islands.find(i=>i.kind==='center');
    if(!center)return 0;
    const random=this.random,spots=[];
    const r=center.radius*0.9;
    for(let i=0;i<6000&&spots.length<T.max*20;i++) {
      const angle=random()*Math.PI*2,d=Math.sqrt(random())*r;
      const x=Math.floor(center.x+Math.cos(angle)*d),z=Math.floor(center.z+Math.sin(angle)*d);
      const top=world.getSurfaceY(x,z,isSolid);
      if(top<world.minY||world.getBlock(x,top,z)!==BLOCK.LEAVES)continue;
      // A tall trunk under the canopy.
      let y=top,trunk=0;
      while(y>top-24&&world.getBlock(x,y,z)!==BLOCK.WOOD)y--;
      while(world.getBlock(x,y,z)===BLOCK.WOOD){trunk++;y--;}
      if(trunk<T.minHeight||!this.stand(x,top+1,z))continue;
      if(spots.some(p=>Math.hypot(p.x-x,p.z-z)<12))continue;
      spots.push({x,y:top+1,z});
    }
    // 0 to max of them, each tall tree equally likely (varies by world).
    const count=Math.min(spots.length,Math.floor(random()*(T.max+1)));
    for(let i=0;i<count;i++) {
      const p=spots.splice(Math.floor(random()*spots.length),1)[0];
      const monkey=new WorkMonkey(this.game.nextId++,this,{x:p.x+0.5,y:p.y,z:p.z+0.5});
      monkey.treeMonkey=true;this.game.npcs.set(monkey.id,monkey);
    }
    return count;
  }
  spawnOn(island,count,spread,ok) {
    const {world}=this.game;let spawned=0;
    for(let attempt=0;attempt<C.spawnAttempts&&spawned<count;attempt++) {
      const angle=this.random()*Math.PI*2,r=Math.sqrt(this.random())*island.radius*spread;
      const x=Math.floor(island.x+Math.cos(angle)*r),z=Math.floor(island.z+Math.sin(angle)*r);
      const y=world.getSurfaceY(x,z,id=>isSolid(id)&&![BLOCK.WOOD,BLOCK.BRANCH,BLOCK.LEAVES].includes(id))+1;
      if(![BLOCK.GRASS,BLOCK.DIRT].includes(world.getBlock(x,y-1,z))||!this.stand(x,y,z)||!ok(x,z))continue;
      const monkey=new WorkMonkey(this.game.nextId++,this,{x:x+0.5,y,z:z+0.5});
      this.game.npcs.set(monkey.id,monkey);spawned++;
    }
  }

  // ---- Sessions and views ----

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
      if(!monkey){if(player.monkeyViewing){player.monkeyViewing=null;}continue;}
      if(player.dead||!player.connected||distance(player.state,monkey.state)>C.configureReach) {
        player.monkeyViewing=null;this.game.stowCursor(player);this.send(player,monkey,{closed:true});
      } else this.view(player,monkey);
    }
  }
  // A block changed: cached routes through it are dropped.
  changed(x,y,z) {
    for(const m of this.game.npcs.values())if(m instanceof WorkMonkey&&m.routeBounds&&inside(m.routeBounds,{x,y,z})) {
      m.path=[];m.pathKey=null;m.routeBounds=null;
    }
  }
  send(player,monkey,data) {this.game.send(player,{type:S2C.MONKEY,id:monkey.id,name:monkey.name,team:monkey.team,...data});}
  view(player,m,message=null) {
    const baby=m.baby?{baby:{progress:Math.min(1,1-(m.growAt-this.game.tick)/(D.baby.growSeconds*TICK_RATE)),
      secondsLeft:Math.max(0,Math.ceil((m.growAt-this.game.tick)/TICK_RATE))}}:{};
    this.send(player,m,{mode:'configure',editable:m.team===player.team,config:m.config,revision:m.revision,
      slots:m.inventory.slots,gear:m.gear,hp:m.hp,maxHp:C.hp,status:m.status,...baby,...(message?{message}:{})});
  }
  viewAll(m) {for(const p of this.game.players.values())if(p.monkeyViewing===m.id)this.view(p,m);}
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
      this.tamingResult(s,s.action(msg.action,msg.value,this.game.tick));
      return;
    }
    if(m.team!==player.team){this.view(player,m,'Only its team can configure this monkey.');return;}
    if(msg.action==='inventory') this.inventoryClick(player,m,msg);
    else if(msg.action==='configure'&&m.baby) this.view(player,m,'It is too young to work. Wait until it grows up.');
    else if(msg.action==='configure') {
      if(msg.revision!==m.revision){this.view(player,m,'A teammate changed these settings. Review and save again.');return;}
      const config=this.parseConfig(msg.config);
      if(!config){this.view(player,m,'Those settings are not valid.');return;}
      this.applyConfig(m,config);
    } else if(msg.action==='teleportHome') this.teleportHome(player,m);
    else if(msg.action==='retry')this.open(player,m);
  }
  applyConfig(m,config) {
    const was=JSON.stringify(m.config);
    m.config=config;m.revision++;
    if(was!==JSON.stringify(config)){this.dropTask(m);m.quarry.signature=null;m.farmScan=null;m.idleUntil=0;m.badSpots.clear();
      m.target=null;m.patrolIndex=0;m.drawTicks=0;}
    m.status='Ready';this.viewAll(m);
    if(config.role!=='idle')this.game.teamProgress?.event(m.team,`role:${config.role}`);
  }
  inventoryClick(player,m,msg) {
    if(player.monkeyViewing!==m.id||!Number.isInteger(msg.slot)||!['left','right'].includes(msg.button))return;
    const inv=player.inventory;
    const slots=msg.grid==='player'?inv.slots:msg.grid==='monkey'?m.inventory.slots:msg.grid==='gear'?m.gear:null;
    if(!slots||msg.slot<0||msg.slot>=slots.length)return;
    // The tool slot takes any tool or weapon (hammer, sword, axe, bow,
    // crossbow, spyglass...); the armor slot takes armor.
    const accepts=msg.grid!=='gear'?()=>true:msg.slot===TOOL?item=>!!getItemDef(item).tool:item=>!!getItemDef(item).armorPoints;
    let moved=false;
    if(msg.shift) {
      const stack=slots[msg.slot];if(!stack)return;
      if(msg.grid==='player') {
        // Shift from the player: gear goes to its slot if empty, else the inventory.
        const def=getItemDef(stack.item),gear=def.tool?TOOL:def.armorPoints?ARMOR:-1;
        if(gear>=0&&!m.gear[gear]){m.gear[gear]=stack;slots[msg.slot]=null;moved=true;}
        else {const left=m.inventory.addStack(stack);moved=left<stack.count;stack.count=left;if(!left)slots[msg.slot]=null;}
      } else {
        const left=inv.addStack(stack);moved=left<stack.count;stack.count=left;if(!left)slots[msg.slot]=null;
      }
    } else moved=clickSlot(slots,msg.slot,inv,msg.button,{accepts});
    if(!moved)return;
    player.inventoryDirty=true;
    this.game.markNpcChanged?.(m);
    this.viewAll(m);
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
      this.game.teamProgress?.event(player.team,'tame');
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

  // ---- Configuration ----

  position(p) {
    return p&&['x','y','z'].every(k=>Number.isInteger(p[k]))&&this.game.world.inBounds(p.x,p.y,p.z)?{x:p.x,y:p.y,z:p.z}:null;
  }
  positions(list,max) {
    if(!Array.isArray(list)||list.length>max)return null;
    const out=[];
    for(const p of list){const pos=this.position(p);if(!pos)return null;if(!out.some(o=>key(o)===key(pos)))out.push(pos);}
    return out;
  }
  parseConfig(input) {
    const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
    if(!input||!MONKEY_ROLES.includes(input.role)||!int(input.radius,1,C.maxRadius)
      ||!['whitelist','blacklist'].includes(input.filter?.mode)||!Array.isArray(input.filter.items)
      ||input.filter.items.length>C.maxFilter||input.filter.items.some(id=>!items.has(id)||id===BLOCK.AIR))return null;
    const q=input.quarry;
    if(!q||!(q.shape in QUARRY_OPTIONS.shape.values)||!(q.axis in QUARRY_OPTIONS.axis.values)
      ||!['depth','radius','returnAt'].every(f=>int(q[f],QUARRY_OPTIONS[f].min,QUARRY_OPTIONS[f].max)))return null;
    const sources=this.positions(input.sources,MONKEY_FIELDS.sources.max),dests=this.positions(input.dests,MONKEY_FIELDS.dests.max);
    const sites=this.positions(input.sites,MONKEY_FIELDS.sites.max),blocks=this.positions(input.blocks,MONKEY_FIELDS.blocks.max);
    // Fields added later default when a saved configuration lacks them.
    const waypoints=this.positions(input.waypoints??[],MONKEY_FIELDS.waypoints.max);
    if(!sources||!dests||!sites||!blocks||!waypoints)return null;
    for(const f of ['cornerA','cornerB','home','post','workbench'])if(input[f]&&!this.position(input[f]))return null;
    if(input.collect!==undefined&&typeof input.collect!=='boolean')return null;
    const recipe=input.recipe===null||input.recipe===undefined?null:getRecipe(input.recipe);
    if(input.recipe!==null&&input.recipe!==undefined&&(!recipe||recipe.creative))return null;
    // A slot choice per destination, only where that machine offers one.
    const destSlots={};
    if(input.destSlots!==undefined&&(typeof input.destSlots!=='object'||input.destSlots===null))return null;
    for(const d of dests) {
      const mode=input.destSlots?.[key(d)],options=SLOT_OPTIONS[this.container(d)?.kind];
      if(mode&&mode!=='auto'&&options?.includes(mode))destSlots[key(d)]=mode;
    }
    const config={role:input.role,sources,dests,blocks,home:this.position(input.home),
      cornerA:this.position(input.cornerA),cornerB:this.position(input.cornerB),
      quarry:{shape:q.shape,axis:q.axis,depth:q.depth,radius:q.radius,returnAt:q.returnAt},
      radius:input.radius,filter:{mode:input.filter.mode,items:[...new Set(input.filter.items)]},sites:[],
      waypoints,post:this.position(input.post),workbench:this.position(input.workbench),recipe:recipe?.id??null,
      collect:input.collect!==false,destSlots};
    // A soil selection marks the cell above it (where the sapling goes).
    for(const pos of sites) {
      const site=[BLOCK.GRASS,BLOCK.DIRT].includes(this.game.world.getBlock(pos.x,pos.y,pos.z))?{...pos,y:pos.y+1}:pos;
      if(this.position(site)&&!config.sites.some(s=>key(s)===key(site)))config.sites.push(site);
    }
    if(config.role==='farmer'&&config.cornerA&&config.cornerB
      &&(Math.abs(config.cornerA.x-config.cornerB.x)>=C.maxFarmWidth||Math.abs(config.cornerA.z-config.cornerB.z)>=C.maxFarmWidth))return null;
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
    const site=offsets.map(([dx,dz])=>({x:keep.cx+dx,y,z:keep.cz+dz})).find(p=>this.stand(p.x,p.y,p.z));
    if(!site){this.view(player,m,'No clear spot beside the keep.');return;}
    this.dropTask(m);
    Object.assign(m.state,{x:site.x+0.5,y:site.y,z:site.z+0.5,vx:0,vy:0,vz:0,kx:0,kz:0,onGround:true});
    m.home={x:m.state.x,y:m.state.y,z:m.state.z,yaw:m.state.yaw};
    m.status='At the keep';
    for(const viewer of this.game.players.values())if(viewer.monkeyViewing===m.id) {
      viewer.monkeyViewing=null;this.game.stowCursor(viewer);this.send(viewer,m,{closed:true});
    }
  }
  // A tamed monkey died: everything it carried falls where it was.
  died(m) {
    const s=m.state;
    for(const stack of [...m.inventory.slots,...m.gear])if(stack)this.game.spawnItem(stack.item,stack.count,s.x,s.y+0.5,s.z,
      (Math.random()-0.5)*2,3,(Math.random()-0.5)*2,0.5,stack.mods);
    m.inventory.slots.fill(null);m.gear.fill(null);
    for(const viewer of this.game.players.values())if(viewer.monkeyViewing===m.id) {
      viewer.monkeyViewing=null;this.game.stowCursor(viewer);this.send(viewer,m,{closed:true});
    }
  }

  // ---- Inventory ----

  store(m,stack) {
    const left=m.inventory.addStack(stack);
    if(left) this.game.spawnItem(stack.item,left,m.state.x,m.state.y+1,m.state.z,0,0,0,0.5,stack.mods);
    return stack.count-left;
  }
  // What a gathering monkey gets from a block or crop at p: kept (Collect
  // drops on), or left on the ground there for collectors and players. With
  // Collect drops off it still keeps the saplings or seeds it replants with.
  gathered(m,stack,p) {
    if(this.collects(m)){this.store(m,stack);return;}
    const keep=Math.max(0,Math.min(stack.count,this.reserve(m,stack.item)-m.count(i=>i===stack.item)));
    if(keep)this.store(m,{...stack,count:keep});
    if(stack.count>keep)this.game.dropAt?.(stack.item,p.x,p.y,p.z,stack.count-keep,stack.mods??null);
  }
  room(m) {return m.inventory.slots.some(s=>!s);}
  // Kept back from deliveries: a couple of saplings for a lumberjack, seeds
  // for a farmer's replanting.
  reserve(m,item) {
    if(m.config.role==='lumberjack'&&item===ITEM.TREE_SEED)return 2;
    if(m.config.role==='farmer'&&CROP_SEEDS.has(item))return C.seedReserve;
    return 0;
  }
  // [{slot, stack, count}] of what it would deliver. A craftsman delivers
  // everything but its recipe's ingredients.
  deliverable(m) {
    const kept=new Map(),out=[];
    const ingredients=m.config.role==='craftsman'?new Set(getRecipe(m.config.recipe)?.inputs.map(i=>i.item)??[]):null;
    for(let slot=0;slot<m.inventory.slots.length;slot++) {
      const stack=m.inventory.slots[slot];
      if(!stack||(ingredients?ingredients.has(stack.item):!monkeyFilter(m.config,stack.item)))continue;
      const reserve=Math.max(0,this.reserve(m,stack.item)-(kept.get(stack.item)??0));
      const held=Math.min(reserve,stack.count);kept.set(stack.item,(kept.get(stack.item)??0)+held);
      if(stack.count-held>0)out.push({slot,stack,count:stack.count-held});
    }
    return out;
  }
  carried(m) {return this.deliverable(m).reduce((n,d)=>n+d.count,0);}
  threshold(m) {
    if(m.config.role==='quarry')return m.config.quarry.returnAt;
    if(m.config.role==='courier'||m.config.role==='collector')return 1;
    return C.capacity;
  }
  // The slots of container c that `item` may go into with slot mode `mode`
  // ('auto', 'input' or 'fuel'), in the order they're filled.
  targetSlots(c,item,mode='auto') {
    if(c.kind==='furnace') {
      const fuel=item in FUEL?[FUEL_SLOT]:[],input=item in SMELTING?[INPUT]:[];
      return mode==='fuel'?fuel:mode==='input'?input:[...fuel,...input];
    }
    if(c.kind==='alloyFurnace') {
      const fuel=item in FUEL?[ALLOY_FUEL]:[],input=ALLOY_INPUTS.filter(i=>c.accepts(i,item));
      return mode==='fuel'?fuel:mode==='input'?input:[...fuel,...input];
    }
    return null;
  }
  // Puts what fits of `load` into the container at p; returns the count moved.
  insertInto(c,load,mode='auto') {
    const before=load.count;
    const slots=this.targetSlots(c,load.item,mode);
    if(slots){for(const i of slots)if(load.count)mergeInto(c.slots,i,load);}
    else c.insert(load);
    if(load.count!==before)c.dirty=true;
    return before-load.count;
  }
  slotMode(m,p) {return m.config.destSlots?.[key(p)]??'auto';}
  // Whether the destination at p could take any of `stacks` (non-containers always can).
  accepts(p,stacks,mode='auto') {
    const c=this.container(p);if(!c)return true;
    if(c.kind==='tank')return false;
    return stacks.some(({stack})=>{
      const fits=i=>!c.slots[i]||c.slots[i].item===stack.item&&!c.slots[i].mods&&!stack.mods&&c.slots[i].count<getItemDef(stack.item).maxStack;
      const slots=this.targetSlots(c,stack.item,mode);
      if(slots)return slots.some(fits);
      if(c.kind==='depot')return c.sellable(stack.item)&&c.inputSlots().some(fits);
      if(c.rules)return c.rules.some((r,i)=>!r.takeOnly&&r.accepts(stack.item)&&fits(i));
      return c.slots.some((_,i)=>fits(i));
    });
  }
  // Source slots a courier may take from.
  sourceSlots(c) {
    return c.kind==='furnace'?[OUTPUT]:c.kind==='alloyFurnace'?[ALLOY_OUTPUT]:c.kind==='crusher'?[1]
      :c.kind==='depot'?DEPOT_OUTPUTS:c.kind==='boiler'||c.kind==='tank'?[]:c.slots.map((_,i)=>i);
  }

  // ---- Movement ----

  stand(x,y,z) {
    return canStand(this.game.world,x,y,z,Math.ceil(C.box.height))
      &&playerFitsAt(this.game.world,{x:x+0.5,y,z:z+0.5,box:C.box},y);
  }
  cellOf(m) {return {x:Math.floor(m.state.x),y:Math.round(m.state.y),z:Math.floor(m.state.z)};}
  // Body center close enough to reach the center of block p.
  reaches(m,p) {
    const s=m.state;
    return Math.hypot(s.x-p.x-0.5,s.y+C.box.height*0.6-p.y-0.5,s.z-p.z-0.5)<=C.reach;
  }
  // Standing spots from which block p is in reach, nearest to the monkey first;
  // spots on top of p itself come last.
  spotsNear(m,p) {
    const spots=[],r=3;
    for(let dy=-3;dy<=3;dy++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++) {
      const x=p.x+dx,y=p.y+dy,z=p.z+dz;
      if(Math.hypot(dx,dy+C.box.height*0.6-0.5,dz)>C.reach)continue;
      if(!this.stand(x,y,z))continue;
      spots.push({x,y,z,on:dx===0&&dz===0&&y===p.y+1});
    }
    const c=this.cellOf(m);
    return spots.sort((a,b)=>(a.on-b.on)||distance(a,c)-distance(b,c));
  }
  // Walk to somewhere block p is in reach. Returns 'there', 'going',
  // 'waiting' (no path search budget this tick) or 'failed'.
  approach(m,p) {
    if(m.state.onGround&&!m.path.length&&this.reaches(m,p))return 'there';
    const goal=`reach:${key(p)}`;
    if(m.pathKey===goal&&m.path.length)return 'going';
    if(m.pathKey===goal&&!m.path.length&&m.arrived)return this.reaches(m,p)?'there':'failed';
    const now=this.game.tick;
    const spots=this.spotsNear(m,p).filter(s=>(m.badSpots.get(key(s))??0)<=now);
    if(!spots.length)return 'failed';
    if(this.pathBudget<=0)return 'waiting';
    this.pathBudget--;this.pathSearches++;
    const start=this.cellOf(m),spot=spots[0];
    const path=findPath(this.game.world,start,spot,{height:Math.ceil(C.box.height),halfWidth:C.box.halfW,
      maxNodes:C.pathNodes,goalHeight:true,climb:C.climbHeight,maxDrop:2});
    const end=path.at(-1)??start;
    if(key(end)!==key(spot)) {
      m.badSpots.set(key(spot),now+C.badSpotTicks);
      return spots.length>1?'waiting':'failed';
    }
    m.path=path.map(n=>({...n,grounded:!n.climb}));m.pathKey=goal;m.arrived=false;
    const pts=[start,...path];
    m.routeBounds={x0:Math.min(...pts.map(n=>n.x))-1,x1:Math.max(...pts.map(n=>n.x))+1,
      y0:Math.min(...pts.map(n=>n.y))-1,y1:Math.max(...pts.map(n=>n.y))+2,
      z0:Math.min(...pts.map(n=>n.z))-1,z1:Math.max(...pts.map(n=>n.z))+1};
    if(!path.length){m.arrived=true;return this.reaches(m,p)?'there':'failed';}
    return 'going';
  }
  // Straight up or down a wall: no physics while climbing (the path checked
  // the column is open), then onto the ledge or down to the landing.
  climbStep(m,n) {
    const s=m.state,speed=C.climbSpeed*TICK_DT,cx=n.x+0.5,cz=n.z+0.5;
    s.vx=s.vy=s.vz=s.kx=s.kz=s.ix=s.iz=0;
    const toward=()=>{
      const dx=cx-s.x,dz=cz-s.z,d=Math.hypot(dx,dz);
      if(d>0.01)s.yaw=Math.atan2(-dx,-dz);
      const step=Math.min(d,C.speed*4.3*TICK_DT);
      if(d>0){s.x+=dx/d*step;s.z+=dz/d*step;}
      return d-step<0.02;
    };
    let done=false;
    if(n.climb==='up') {
      const ox=Math.floor(s.x)+0.5,oz=Math.floor(s.z)+0.5;
      if(s.y<n.y+0.01&&Math.hypot(ox-s.x,oz-s.z)>0.05){s.x+=Math.sign(ox-s.x)*Math.min(Math.abs(ox-s.x),speed);s.z+=Math.sign(oz-s.z)*Math.min(Math.abs(oz-s.z),speed);}
      else if(s.y<n.y+0.01){s.y=Math.min(n.y+0.01,s.y+speed);const dx=cx-s.x,dz=cz-s.z;if(Math.hypot(dx,dz)>0.01)s.yaw=Math.atan2(-dx,-dz);}
      else done=toward();
    } else {
      if(Math.hypot(cx-s.x,cz-s.z)>0.02)toward();
      else {s.y=Math.max(n.y,s.y-speed);done=s.y<=n.y;}
    }
    if(done){s.x=cx;s.z=cz;s.y=n.y;s.onGround=true;s.edgeFloorY=n.y;m.path.shift();}
    m.climbing=true;m.walking=true;
    return speed;
  }

  // ---- Per tick ----

  run(m,tick) {
    const s=m.state;
    if(s.y<this.game.world.minY+2){Object.assign(s,m.home,{vy:0});this.dropTask(m);}
    const game=[...this.sessions.values()].find(t=>t.monkey===m&&t.kind==='simon');
    if(game) {
      const elapsed=tick-game.start-C.simonStepTicks,index=Math.floor(elapsed/C.simonStepTicks);
      const phase=elapsed%C.simonStepTicks;
      const cue=index>=0&&index<game.sequence.length?game.sequence[index]:null;
      const crouch=cue==='crouch'&&phase<C.simonStepTicks*0.7;
      stepPlayer(s,{forward:0,strafe:0,yaw:s.yaw,pitch:0,crouch,jump:cue==='jump'&&phase===0},this.game.world);
      m.pose=crouch?'crouch':s.onGround?'ready':'jump';return;
    }
    if(m.baby&&tick>=m.growAt){m.baby=false;m.status='Ready';this.viewAll(m);
      this.game.teamNotice?.(m.team,`${m.name} has grown up and is ready to work!`,'monkey');}
    m.climbing=false;
    // Guards fight every tick (aiming, swinging, chasing); out of a fight
    // they patrol on think ticks like any other role.
    // Any other tamed monkey holding a weapon fights back when attacked,
    // then goes back to work from where it was hit.
    let fighting=false;
    if(m.team!==null&&!m.baby) {
      if(m.config.role==='guard')fighting=guardTick(this,m,tick);
      else if(holdsWeapon(m)&&(m.provoker||m.defendFrom)) {
        m.defendFrom??=this.cellOf(m);
        fighting=guardTick(this,m,tick,[m.defendFrom],true);
        if(!fighting){m.defendFrom=null;m.path=[];m.pathKey=null;}
      } else m.provoker=null;
    }
    const moved=m.path[0]?.climb?this.climbStep(m,m.path[0]):stepMobPath(m,this.game.world,fighting?C.speed*1.35:C.speed);
    if(m.path.length&&moved<0.005) {
      if(++m.stuck>=C.stuckTicks){m.path=[];m.pathKey=null;m.stuck=0;}
    } else m.stuck=0;
    if(!m.path.length&&m.pathKey)m.arrived=true;
    m.pose=m.climbing?'climb':m.walking?'walk':m.working||tick<(m.swingUntil??0)?'work':m.team!==null&&m.config.role!=='idle'&&!m.baby?'ready':'sit';
    if(m.team===null||m.baby||fighting||tick%C.thinkTicks!==m.id%C.thinkTicks)return;
    m.working=false;
    if(m.config.role==='guard'){guardPatrol(this,m,tick);return;}
    if(m.config.role==='lookout'){lookoutWatch(this,m,tick);return;}
    if(m.task){this.doTask(m,tick);return;}
    if(tick<m.idleUntil){this.idle(m);return;}
    const task=this.nextTask(m);
    if(task){m.task=task;this.doTask(m,tick);return;}
    m.idleUntil=tick+(m.config.role==='quarry'?this.quarryRecheck(m.quarry):C.idleRecheckTicks);
    this.idle(m);
  }
  dropTask(m) {m.task=null;m.path=[];m.pathKey=null;m.working=false;}
  idle(m) {
    const home=m.config.home;
    if(home&&Math.hypot(m.state.x-home.x-0.5,m.state.z-home.z-0.5)>1.5) {
      const result=this.approachStand(m,home);
      if(result==='failed')m.status='Can\'t reach its home';
    }
    if(m.config.role==='idle')m.status=home?'Idle at home':'Idle';
  }
  // Walk to stand at (or beside) a home spot.
  approachStand(m,p) {
    const goal=`home:${key(p)}`;
    if(m.pathKey===goal&&(m.path.length||m.arrived))return 'going';
    if(this.pathBudget<=0)return 'waiting';
    const spots=[{x:p.x,y:p.y+1,z:p.z},{x:p.x,y:p.y,z:p.z}].filter(s=>this.stand(s.x,s.y,s.z));
    const spot=spots[0]??this.spotsNear(m,p)[0];if(!spot)return 'failed';
    this.pathBudget--;
    const start=this.cellOf(m);
    const path=findPath(this.game.world,start,spot,{height:Math.ceil(C.box.height),halfWidth:C.box.halfW,
      maxNodes:C.pathNodes,goalHeight:true,climb:C.climbHeight,maxDrop:2});
    if(key(path.at(-1)??start)!==key(spot))return 'failed';
    m.path=path.map(n=>({...n,grounded:!n.climb}));m.pathKey=goal;m.arrived=!path.length;
    return 'going';
  }

  // The next task, or null (with m.status saying why).
  // Whether this monkey keeps what it gathers (Collect drops on).
  collects(m) {return m.config.collect!==false||!GATHERING_ROLES.includes(m.config.role);}
  nextTask(m) {
    const role=m.config.role;
    if(role==='idle')return null;
    if(!m.config.dests.length&&this.collects(m)){m.status='Select a destination';return null;}
    if(role==='craftsman')return this.craftsmanWork(m);
    const carried=this.carried(m);
    if(carried&&(carried>=this.threshold(m)||!this.room(m))&&m.config.dests.length) {
      const d=this.deliveryTask(m);if(d)return d;
    }
    const work=role==='courier'?this.courierWork(m):role==='collector'?this.collectorWork(m)
      :role==='lumberjack'?this.lumberjackWork(m):role==='quarry'?this.quarryWork(m):role==='farmer'?this.farmerWork(m):null;
    if(work)return work;
    if(carried&&m.config.dests.length)return this.deliveryTask(m);
    return null;
  }
  deliveryTask(m) {
    const stacks=this.deliverable(m),dests=m.config.dests;
    for(let i=0;i<dests.length;i++) {
      const index=(m.destIndex+i)%dests.length;
      if(this.accepts(dests[index],stacks,this.slotMode(m,dests[index])))return {kind:'deliver',index,at:dests[index]};
    }
    m.status='Destinations are full';return null;
  }
  doTask(m,tick) {
    const t=m.task;
    const result=this.approach(m,t.at);
    if(result==='going'){m.status=t.going??'On the way';return;}
    if(result==='waiting')return;
    if(result==='failed'){
      m.status='Can\'t reach '+(t.what??'its target');
      t.onFail?.();this.dropTask(m);m.idleUntil=tick+C.idleRecheckTicks;return;
    }
    // In reach.
    const s=m.state;s.yaw=Math.atan2(-(t.at.x+0.5-s.x),-(t.at.z+0.5-s.z));
    const finished=this[`act_${t.kind}`](m,t);
    if(finished)this.dropTask(m);
  }

  // ---- Acts (true when the task is over) ----

  act_deliver(m,t) {
    const c=this.container(t.at);let moved=0;
    for(const {slot,stack,count}of this.deliverable(m)) {
      const load=cloneStack(stack,count);
      if(c)moved+=this.insertInto(c,load,this.slotMode(m,t.at));
      else {this.game.spawnItem(load.item,load.count,t.at.x+0.5,t.at.y+1.15,t.at.z+0.5,0,0,0,0.5,load.mods);moved+=load.count;load.count=0;}
      stack.count-=count-load.count;
      if(!stack.count)m.inventory.slots[slot]=null;
    }
    m.destIndex=(t.index+1)%Math.max(1,m.config.dests.length);
    m.status=moved?'Delivered':'Destination is full';
    return true;
  }
  act_fetch(m,t) {
    const c=this.container(t.at);
    if(!c){m.status='Source is missing';return true;}
    let taken=0;
    for(const i of this.sourceSlots(c)) {
      const s=c.slots[i];
      if(!s||!monkeyFilter(m.config,s.item)||(t.item&&s.item!==t.item))continue;
      const want=Math.min(t.count??C.capacity-taken,s.count),left=m.inventory.addStack(cloneStack(s,want));
      const n=want-left;if(!n)break;
      s.count-=n;taken+=n;if(!s.count)c.slots[i]=null;c.dirty=true;
      if(taken>=(t.count??C.capacity))break;
    }
    m.sourceIndex=(t.index??0)+1;
    m.status=taken?'Carrying':'Source is empty';
    return true;
  }
  act_pickup(m,t) {
    const e=this.game.items.get(t.id);
    if(!e){return true;}
    if(Math.hypot(e.state.x-m.state.x,e.state.z-m.state.z)>1.8){t.at={x:Math.floor(e.state.x),y:Math.floor(e.state.y),z:Math.floor(e.state.z)};m.pathKey=null;return false;}
    const n=Math.min(C.capacity,e.count),left=m.inventory.addStack(cloneStack(e,n));
    e.count-=n-left;if(!e.count)this.game.removeItem(e);
    m.status='Collecting';return true;
  }
  // Breaking work: progress counts think ticks against the block's break time
  // with its tool. t.cells: blocks to break in order (top of the list first).
  act_break(m,t) {
    const w=this.game.world,tool=breakingStats(m.tool);
    m.working=true;
    t.progress=(t.progress??0)+C.thinkTicks;
    while(t.cells.length) {
      const cell=t.cells[t.cells.length-1],id=w.getBlock(cell.x,cell.y,cell.z);
      if(id===BLOCK.AIR||isLiquid(id)||!canBreak(id,tool.strength)||t.check&&!t.check(cell,id)){t.cells.pop();t.progress=0;continue;}
      if(!t.anyReach&&!this.reaches(m,cell)){t.at=cell;m.pathKey=null;return false;}
      const need=breakTicks(id,tool.speed);
      if(t.progress<need)return false;
      t.progress-=need;t.cells.pop();
      w.setBlock(cell.x,cell.y,cell.z,BLOCK.AIR);
      for(const stack of blockDrops(id,this.random))this.gathered(m,stack,cell);
      t.broke=(t.broke??0)+1;
      if(!this.room(m)&&this.carried(m))break;
    }
    t.after?.();
    return true;
  }
  act_place(m,t) {
    const w=this.game.world;
    if(w.getBlock(t.at.x,t.at.y,t.at.z)!==BLOCK.AIR||!m.count(i=>i===t.item))return true;
    if(t.soil&&!t.soil.includes(w.getBlock(t.at.x,t.at.y-1,t.at.z)))return true;
    m.take(t.item,1);w.setBlock(t.at.x,t.at.y,t.at.z,t.block);
    m.status=t.done??'Planted';return true;
  }
  act_harvest(m,t) {
    const w=this.game.world,id=w.getBlock(t.at.x,t.at.y,t.at.z);
    if(!isMatureCrop(id))return true;
    this.game.harvestCrop(t.at.x,t.at.y,t.at.z,stack=>this.gathered(m,stack,t.at));
    m.status='Harvesting';return true;
  }

  // ---- Craftsman ----

  // Whether, carrying what it has now plus k more sets of the recipe's
  // ingredients, it could craft every complete set it then holds, keeping
  // each output, without ever running out of room. This counts stack sizes,
  // recipes that make several items, unstackable outputs, the room freed as
  // ingredients are used up and anything else it already carries.
  craftPlanFits(m,recipe,k) {
    const inv=new Inventory(m.inventory.slots.length);
    inv.slots=m.inventory.slots.map(s=>s&&cloneStack(s));
    for(const {item,count}of recipe.inputs)if(inv.add(item,count*k)>0)return false;
    let crafted=0;
    while(inv.has(recipe.inputs)&&crafted<=D.craftsman.maxSets*4){if(!inv.craft(recipe))return false;crafted++;}
    return crafted>0;
  }
  // The most sets (up to what `available` holds) it can take and finish.
  craftSets(m,recipe,available) {
    let k=Math.min(D.craftsman.maxSets,...recipe.inputs.map(({item,count})=>Math.floor((available.get(item)??0)/count)));
    for(;k>0;k--)if(this.craftPlanFits(m,recipe,k))return k;
    return 0;
  }
  // Plain (unmodded) ingredient counts in the source slots of container c.
  sourceCounts(c,recipe) {
    const want=new Set(recipe.inputs.map(i=>i.item)),counts=new Map();
    for(const i of this.sourceSlots(c)) {
      const s=c.slots[i];
      if(s&&!s.mods?.length&&want.has(s.item))counts.set(s.item,(counts.get(s.item)??0)+s.count);
    }
    return counts;
  }
  craftsmanWork(m) {
    const recipe=getRecipe(m.config.recipe),w=this.game.world,bench=m.config.workbench;
    if(!recipe){m.status='Choose a recipe';return null;}
    if(!bench){m.status='Select a workbench';return null;}
    if(!m.config.sources.length){m.status='Select a source';return null;}
    if(w.getBlock(bench.x,bench.y,bench.z)!==BLOCK.WORKBENCH){m.status='Its workbench is missing';return null;}
    const name=getItemDef(recipe.output).name;
    if(m.inventory.has(recipe.inputs)) {
      const trial=new Inventory(m.inventory.slots.length);trial.slots=m.inventory.slots.map(s=>s&&cloneStack(s));
      if(trial.craft(recipe))return {kind:'craft',at:bench,recipe,what:'its workbench',going:'Going to the workbench'};
    }
    if(this.carried(m)) {
      const d=this.deliveryTask(m);if(d)return d;
      m.status='Destination is full';return null;
    }
    const sources=m.config.sources;
    for(let i=0;i<sources.length;i++) {
      const index=(m.sourceIndex+i)%sources.length,c=this.container(sources[index]);
      if(!c)continue;
      if(this.craftSets(m,recipe,this.sourceCounts(c,recipe))>0)
        return {kind:'fetchSet',at:sources[index],index,recipe,what:'a source',going:`Fetching ingredients for ${name}`};
    }
    m.status=m.inventory.slots.every(Boolean)?'Inventory is full':`Waiting for ingredients for ${name}`;
    return null;
  }
  act_fetchSet(m,t) {
    const c=this.container(t.at);
    if(!c){m.status='Source is missing';return true;}
    const k=this.craftSets(m,t.recipe,this.sourceCounts(c,t.recipe));
    m.sourceIndex=(t.index??0)+1;
    if(!k){m.status='Not enough ingredients';return true;}
    for(const {item,count}of t.recipe.inputs) {
      let want=count*k;
      for(const i of this.sourceSlots(c)) {
        const s=c.slots[i];
        if(!want||!s||s.item!==item||s.mods?.length)continue;
        const n=Math.min(want,s.count);
        s.count-=n;want-=n;if(!s.count)c.slots[i]=null;
        m.inventory.add(item,n);
      }
    }
    c.dirty=true;
    m.status=`Carrying ${k} set${k===1?'':'s'} of ingredients`;
    return true;
  }
  // One craft per think at the workbench, through the same recipe check
  // and inventory rules as a player's craft.
  act_craft(m,t) {
    const w=this.game.world,bench=t.at;
    if(w.getBlock(bench.x,bench.y,bench.z)!==BLOCK.WORKBENCH){m.status='Its workbench is missing';return true;}
    if(!m.inventory.has(t.recipe.inputs)||!m.inventory.craft(t.recipe))return true;
    m.working=true;
    this.game.teamProgress?.crafted(m.team,t.recipe.output);
    this.game.teamProgress?.event(m.team,'monkeyCrafted');
    m.status=`Crafting ${getItemDef(t.recipe.output).name}`;
    return !m.inventory.has(t.recipe.inputs);
  }

  // ---- Roles ----

  courierWork(m) {
    const sources=m.config.sources;
    if(!sources.length){m.status='Select a source';return null;}
    if(!this.room(m)){m.status='Inventory is full';return null;}
    for(let i=0;i<sources.length;i++) {
      const index=(m.sourceIndex+i)%sources.length,c=this.container(sources[index]);
      if(!c)continue;
      if(this.sourceSlots(c).some(j=>c.slots[j]&&monkeyFilter(m.config,c.slots[j].item)))
        return {kind:'fetch',at:sources[index],index,what:'a source',going:'Fetching'};
    }
    m.status='Waiting for source items';return null;
  }
  collectorWork(m) {
    const center=m.config.dests[0];
    if(!this.room(m)){m.status='Inventory is full';return null;}
    const drops=[...(this.game.items.nearbyValues?.(center,m.config.radius)??this.game.items.values())].filter(e=>!e.pickupTicks
      &&monkeyRange(m.config,e.state)&&monkeyFilter(m.config,e.item)
      &&!(Math.floor(e.state.x)===center.x&&Math.floor(e.state.z)===center.z&&e.state.y>=center.y&&e.state.y<=center.y+2));
    const chosen=drops.sort((a,b)=>distance(a.state,m.state)-distance(b.state,m.state))[0];
    if(!chosen){m.status='Waiting for items';return null;}
    return {kind:'pickup',id:chosen.id,at:{x:Math.floor(chosen.state.x),y:Math.floor(chosen.state.y),z:Math.floor(chosen.state.z)},
      what:'an item',going:'Collecting'};
  }
  // The connected logs and branches of the tree standing on `site` (up to
  // treeRadius sideways), or null when no leaves crown it (not grown).
  treeAt(site) {
    const w=this.game.world,wood=id=>id===BLOCK.WOOD||id===BLOCK.BRANCH;
    if(!wood(w.getBlock(site.x,site.y,site.z)))return null;
    const seen=new Set([key(site)]),queue=[site];let crown=false;
    for(let i=0;i<queue.length&&queue.length<C.maxTreeBlocks;i++) {
      const p=queue[i];
      for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const n={x:p.x+dx,y:p.y+dy,z:p.z+dz},k=key(n);
        if(seen.has(k)||n.y<site.y||n.y>site.y+C.maxTreeHeight||Math.hypot(n.x-site.x,n.z-site.z)>C.treeRadius)continue;
        const id=w.getBlock(n.x,n.y,n.z);
        if(id===BLOCK.LEAVES)crown=true;
        if(!wood(id))continue;
        seen.add(k);queue.push(n);
      }
    }
    return crown?queue:null;
  }
  lumberjackWork(m) {
    const w=this.game.world,sites=m.config.sites;
    if(!sites.length){m.status='Select tree sites';return null;}
    if(!this.room(m)){m.status='Inventory is full';return null;}
    const near=s=>distance(s,m.state);
    for(const site of [...sites].sort((a,b)=>near(a)-near(b))) {
      const tree=this.treeAt(site);
      if(!tree)continue;
      // Breaking list: lowest first in the array, so popping takes the top down.
      const cells=tree.sort((a,b)=>a.y-b.y);
      // A tree comes down from its trunk: no need to reach every branch.
      return {kind:'break',at:site,cells,anyReach:true,what:'a tree',going:'Going to a tree',
        after:()=>{m.status='Tree chopped';}};
    }
    // Saplings that fell near the sites.
    const sapling=[...(this.game.items.values())].find(e=>e.item===ITEM.TREE_SEED&&!e.pickupTicks
      &&sites.some(s=>Math.hypot(e.state.x-s.x-0.5,e.state.z-s.z-0.5)<=5&&Math.abs(e.state.y-s.y)<=4));
    if(sapling)return {kind:'pickup',id:sapling.id,at:{x:Math.floor(sapling.state.x),y:Math.floor(sapling.state.y),z:Math.floor(sapling.state.z)},
      what:'a sapling',going:'Gathering saplings'};
    const empty=sites.filter(s=>w.getBlock(s.x,s.y,s.z)===BLOCK.AIR&&[BLOCK.GRASS,BLOCK.DIRT].includes(w.getBlock(s.x,s.y-1,s.z)));
    if(empty.length) {
      if(m.count(i=>i===ITEM.TREE_SEED))return {kind:'place',at:empty.sort((a,b)=>near(a)-near(b))[0],item:ITEM.TREE_SEED,
        block:BLOCK.SAPLING,soil:[BLOCK.GRASS,BLOCK.DIRT],what:'a planting spot',going:'Planting',done:'Planted; waiting for growth'};
      // Take a sapling from a destination that has one.
      const index=m.config.dests.findIndex(d=>this.container(d)?.slots?.some(s=>s?.item===ITEM.TREE_SEED));
      if(index>=0)return {kind:'fetch',at:m.config.dests[index],item:ITEM.TREE_SEED,count:2,what:'a sapling',going:'Fetching a sapling'};
      m.status='Needs a sapling to plant';return null;
    }
    m.status='Waiting for trees to grow';return null;
  }
  // Removing this block would open a hole straight down into the void.
  exposesVoid(x,y,z) {
    const w=this.game.world;
    for(let by=y-1;by>=w.minY;by--)if(isSolid(w.getBlock(x,by,z))||isLiquid(w.getBlock(x,by,z)))return false;
    return true;
  }
  quarryable(m,cell,id) {
    const def=getBlockDef(id);
    if(id===BLOCK.AIR||isLiquid(id)||def.tileEntity||isDoor(id)||isLadder(id)||id===BLOCK.ROPE)return false;
    if(!canBreak(id,breakingStats(m.tool).strength))return false;
    if(m.config.dests.some(d=>d.x===cell.x&&d.z===cell.z&&d.y>=cell.y&&d.y<=cell.y+1))return false;
    return !this.exposesVoid(cell.x,cell.y,cell.z);
  }
  quarryWork(m) {
    const q=m.quarry,tick=this.game.tick;
    const signature=JSON.stringify([m.config.quarry,m.config.cornerA,m.config.cornerB,m.config.blocks]);
    if(q.signature!==signature){q.signature=signature;q.cells=quarryCells(m.config);q.index=0;q.done=false;q.wrapAt=0;}
    if(!q.cells.length){m.status=m.config.quarry.shape==='blocks'?'Select blocks to break':'Select the area';return null;}
    if(!this.room(m)){m.status='Inventory is full';return null;}
    const w=this.game.world;let scanned=0;
    if(q.index>=q.cells.length) {
      if(tick<q.wrapAt){m.status=q.status;return null;}
      q.index=0;q.done=true;q.tooHard=false;
    }
    while(q.index<q.cells.length&&scanned++<C.quarryScan) {
      const cell=q.cells[q.index],id=w.getBlock(cell.x,cell.y,cell.z);
      if(id!==BLOCK.AIR&&!isLiquid(id)&&!canBreak(id,breakingStats(m.tool).strength))q.tooHard=true;
      if(!this.quarryable(m,cell,id)||(q.skip?.get(key(cell))??0)>tick){q.index++;continue;}
      q.done=false;
      // This block and the next few in order that are in reach from the
      // same spot (reach is re-checked as each one comes up).
      const cells=[cell];
      for(let j=q.index+1;j<q.cells.length&&cells.length<8;j++){const c=q.cells[j];if(distance(c,cell)<=2)cells.push(c);else break;}
      q.index++;
      return {kind:'break',at:cell,cells:cells.reverse(),what:'the next block',going:'Going to dig',
        check:(c,blockId)=>this.quarryable(m,c,blockId),
        onFail:()=>{(q.skip??=new Map()).set(key(cell),tick+C.badSpotTicks*4);}};
    }
    if(q.index>=q.cells.length){q.wrapAt=tick+this.quarryRecheck(q);
      q.status=q.tooHard?'Needs a stronger tool':q.done?'Quarry finished':'Nothing it can dig right now';m.status=q.status;}
    return null;
  }
  // How soon a finished quarry pass looks again for blocks that came back
  // (regrowing quarry stone, blocks placed in it): small regions and single
  // blocks every think, larger ones in proportion to their size.
  quarryRecheck(q) {
    const n=q.cells?.length??0;
    return n<=C.quickQuarryCells?C.thinkTicks:Math.min(C.quarryWrapTicks,Math.ceil(n/C.quickQuarryCells)*C.thinkTicks);
  }
  farmerWork(m) {
    const box=farmBox(m.config);
    if(!box){m.status='Select the farm area';return null;}
    const w=this.game.world,tick=this.game.tick;
    if(!m.farmScan||tick>=m.farmScan.at+C.farmScanTicks) {
      const farmland=[];
      for(let x=box.x0;x<=box.x1;x++)for(let z=box.z0;z<=box.z1;z++)for(let y=box.y0;y<=box.y1;y++)
        if(w.getBlock(x,y,z)===BLOCK.FARMLAND)farmland.push({x,y:y+1,z});
      m.farmScan={at:tick,cells:farmland};
    }
    const near=c=>distance(c,m.state);
    let ripe=null,bare=null,needSeed=false;
    for(const c of m.farmScan.cells) {
      const id=w.getBlock(c.x,c.y,c.z),crop=cropAt(id);
      if(crop){m.cropMemory.set(key(c),crop.crop.name);if(isMatureCrop(id)&&(!ripe||near(c)<near(ripe)))ripe=c;continue;}
      if(id!==BLOCK.AIR||w.getBlock(c.x,c.y-1,c.z)!==BLOCK.FARMLAND)continue;
      const kind=m.cropMemory.get(key(c))??m.lastCrop;if(!kind)continue;
      if(!m.count(i=>i===CROPS[kind].seed)){needSeed=true;continue;}
      if(!bare||near(c)<near(bare))bare=c;
    }
    if(ripe&&this.room(m))return {kind:'harvest',at:ripe,what:'a crop',going:'Going to harvest'};
    if(bare) {
      const kind=m.cropMemory.get(key(bare))??m.lastCrop;m.lastCrop=kind;
      return {kind:'place',at:bare,item:CROPS[kind].seed,block:CROPS[kind].stages[0],soil:[BLOCK.FARMLAND],what:'farmland',going:'Replanting',done:'Replanted'};
    }
    for(const kind of m.cropMemory.values())m.lastCrop??=kind;
    m.status=!m.farmScan.cells.length?'No farmland in its area':needSeed?'Needs seeds to replant':'Waiting for crops to grow';
    return null;
  }
}
