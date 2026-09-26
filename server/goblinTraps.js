import { BLOCK, isSolid, facedBlock, blockBase, FACING_DIRS } from '../shared/blocks.js';
import { GOBLINS, goblinTicks } from '../shared/goblins.js';
import { TICK_RATE } from '../shared/config.js';
import { S2C, DEATH_CAUSE } from '../shared/protocol.js';
import { Arrow } from './arrow.js';
import { raycastBlock } from '../shared/raycast.js';

export class GoblinTraps {
  constructor(c) { this.c=c; this.modules=new Set(); this.traps=new Map(); this.nextScan=0; }
  install(module) {
    const c=this.c,b=module.box, candidates=[];
    const y=module.floorY+1;
    for(let z=b.z0;z<=b.z1;z++)for(let x=b.x0;x<=b.x1;x++) {
      if(c.world.getBlock(x,y,z)!==BLOCK.GOBLIN_BRICKS)continue;
      for(let facing=0;facing<4;facing++) {
        const [dx,dz]=FACING_DIRS[facing];
        if(c.world.getBlock(x+dx,y,z+dz)!==BLOCK.AIR || !isSolid(c.world.getBlock(x+dx,y-1,z+dz)))continue;
        candidates.push({x,y,z,facing}); break;
      }
    }
    const nearHall=Math.hypot(module.center.x-c.totemSpot.x,module.center.z-c.totemSpot.z)<24;
    const existing=[...this.traps.values()].filter((t)=>t.y===y).length;
    const count=Math.min(GOBLINS.traps.maxPerLevel-existing,GOBLINS.traps.perModule+(nearHall?GOBLINS.traps.hallExtra:0));
    for(let i=0;i<count && candidates.length;i++) {
      const p=candidates.splice(Math.floor(c.random()*candidates.length),1)[0];
      const id=facedBlock(BLOCK.POISON_TRAP,p.facing),key=`${p.x},${p.y},${p.z}`;
      c.setBlock(p.x,p.y,p.z,id); c.intend({...p,id});
      this.traps.set(key,{...p,id,nextShot:0});
    }
  }
  tick(tick) {
    const c=this.c, cfg=GOBLINS.traps;
    if(tick>=this.nextScan && c.totemAlive) {
      this.nextScan=tick+goblinTicks(cfg.scanSeconds,TICK_RATE);
      for(const m of c.fortress.modules)if(!m.building && !m.removed && !this.modules.has(m)) {
        this.install(m);this.modules.add(m);
      }
    }
    for(const trap of this.traps.values()) {
      if(tick<trap.nextShot || blockBase(c.world.getBlock(trap.x,trap.y,trap.z)).base!==BLOCK.POISON_TRAP)continue;
      const [dx,dz]=FACING_DIRS[trap.facing];
      const from={x:trap.x+0.5+dx*0.55,y:trap.y+0.5,z:trap.z+0.5+dz*0.55};
      const p=c.nearbyPlayers(from,cfg.range+1).find((p)=> {
        if(!p.connected || p.dead || p.creative)return false;
        const x=p.state.x-from.x,z=p.state.z-from.z,along=x*dx+z*dz,across=x*dz-z*dx;
        if(along<0 || along>cfg.range || Math.abs(across)>0.5 || from.y<p.state.y
          || from.y>p.state.y+1.8)return false;
        return !raycastBlock(c.world,from,{x:dx,y:0,z:dz},along,isSolid);
      });
      if(!p)continue;
      const shooter={id:null,goblin:true,name:'Poison arrow trap'};
      const a=new Arrow(c.game.nextId++,shooter,from.x,from.y,from.z,dx*cfg.arrowSpeed,0,dz*cfg.arrowSpeed,1);
      a.damage=cfg.damage;a.gravity=0;a.poison=true;
      c.game.arrows.set(a.id,a);c.game.broadcast({type:S2C.ENTITY_SPAWN,entity:a.describe()});
      trap.nextShot=tick+goblinTicks(cfg.cooldown,TICK_RATE);
    }
    for(const p of c.game.players.values()) {
      if(p.dead) {p.poisonUntil=0;continue;}
      if(tick<(p.poisonUntil ?? 0) && tick>=(p.nextPoison ?? 0)) {
        p.nextPoison=tick+Math.round(cfg.poisonInterval*TICK_RATE);
        c.game.hurt(p,cfg.poisonDamage,{id:null,goblin:true,name:'Poison'},DEATH_CAUSE.MOB);
      }
    }
  }
}
