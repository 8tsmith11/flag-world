// Siege approaches are immutable block plans, separate from home construction.
import { BLOCK, isSolid, ladderBlock, facingOf } from '../shared/blocks.js';
import { GOBLINS } from '../shared/goblins.js';
import { KEEP_REACH } from '../shared/structures.js';
import { canStand } from './pathfind.js';
import { isProtected, blockKey, surfaceHeight, isGround, islandTerrainHeight } from './goblinProjects.js';

export function chooseSiegeTarget(state, random = Math.random) {
  const teams = [...new Set([...state.flags.values()].filter((f) => f.state === 'home').map((f) => f.team))];
  return teams.length ? { team: teams[Math.floor(random() * teams.length)], reason: 'random home flag' } : null;
}

export function settlementBlocksLaunch(c,{x,z}) {
  const margin=GOBLINS.siege.launchSettlementClearance;
  const overlaps=box=>box && x>=box.x0-margin && x<=box.x1+margin && z>=box.z0-margin && z<=box.z1+margin;
  return c.reserved.some(overlaps)
    || c.buildings.some(b=>b.kind!=='wall' && overlaps(b.box)
      || b.access?.some(p=>Math.abs(p.x-x)<=margin && Math.abs(p.z-z)<=margin))
    || [...c.wallFootprints].some(key=>{const [px,pz]=key.split(',').map(Number);return Math.abs(px-x)<=margin && Math.abs(pz-z)<=margin;});
}

// Cardinal raster preserves connectivity for a one-block-wide bridge.
function line(a, b) {
  const out = [{ x: a.x, z: a.z }];
  let x = a.x, z = a.z;
  while (x !== b.x || z !== b.z) {
    const tx = Math.abs(b.x - x), tz = Math.abs(b.z - z);
    const totalX=Math.abs(b.x-a.x),totalZ=Math.abs(b.z-a.z);
    const progressX=Math.abs(x-a.x),progressZ=Math.abs(z-a.z);
    if (tx && (!tz || Math.abs((progressX+1)*totalZ-progressZ*totalX)
      <= Math.abs(progressX*totalZ-(progressZ+1)*totalX))) x += Math.sign(b.x - x);
    else z += Math.sign(b.z - z);
    out.push({ x, z });
  }
  return out;
}

export function bridgeDamage(world, bridge) {
  const blocks = bridge.blocks.filter((b) => b.id !== BLOCK.AIR);
  let bad = blocks.filter((b) => world.getBlock(b.x, b.y, b.z) !== b.id).length;
  for (const p of bridge.deck) if (isSolid(world.getBlock(p.x, p.y + 1, p.z))
    || isSolid(world.getBlock(p.x, p.y + 2, p.z))) bad++;
  return bad / Math.max(1, blocks.length);
}

export function newBridge(c, team, width, attempt) {
  const w = c.world;
  const flag = [...c.game.flags.values()].find((f) => f.team === team);
  const keep = w.keeps.reduce((best,k) => !best || Math.hypot(k.cx-flag.home.x,k.cz-flag.home.z)
    < Math.hypot(best.cx-flag.home.x,best.cz-flag.home.z) ? k : best, null);
  const center = w.islands?.find((i) => i.kind === 'central') ?? w.islands?.find((i) => i.kind === 'center')
    ?? { x: c.totemSpot.x, z: c.totemSpot.z, radius: 30 };
  const island = w.islands.filter((i)=>i.kind==='team').reduce((best,i)=>!best || Math.hypot(i.x-keep.cx,i.z-keep.cz)<Math.hypot(best.x-keep.cx,best.z-keep.cz)?i:best,null)
    ?? { x: keep.cx, z: keep.cz, radius: 20 };
  const dx = island.x - center.x, dz = island.z - center.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d, sx = -uz, sz = ux;
  const offset = attempt ? (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * GOBLINS.siege.alternateOffset : 0;
  const pick = (cx, cz, radius, sign) => {
    const shifts=sign>0?[0,...Array.from({length:GOBLINS.siege.launchSearchOffsets},(_,i)=>(i%2? -1:1)*Math.ceil((i+1)/2)*GOBLINS.siege.alternateOffset)]:[0];
    for(const shift of shifts)for (let inset = 0; inset < radius; inset++) {
      const x = Math.round(cx + ux * sign * (radius - inset) + sx * (offset+shift));
      const z = Math.round(cz + uz * sign * (radius - inset) + sz * (offset+shift));
      if (x < 2 || z < 2 || x >= w.sizeX - 2 || z >= w.sizeZ - 2) continue;
      if(sign<0 && Math.abs(x-keep.cx)<=KEEP_REACH+GOBLINS.siege.keepClearance
        && Math.abs(z-keep.cz)<=KEEP_REACH+GOBLINS.siege.keepClearance)continue;
      if(sign>0 && settlementBlocksLaunch(c,{x,z}))continue;
      const body=sign>0?center:island;
      let y=surfaceHeight(w,x,z);
      if(Number.isFinite(body.topY)) {
        y=w.voidY;
        const native=w.mainTerrains?islandTerrainHeight(w,body,x,z):body.topY;
        for(let yy=Math.min(w.sizeY-1,native);yy>=body.bottomY;yy--)
          if(isGround(w.getBlock(x,yy,z))) {while(yy<w.sizeY-1 && isGround(w.getBlock(x,yy+1,z)))yy++;y=yy;break;}
      }
      const vx=Math.abs(ux)>Math.abs(uz)?Math.sign(ux):0,vz=vx?0:Math.sign(uz);
      if(y>w.voidY && canStand(w,x,y+1,z,2) && (sign<0 || canStand(w,x-vx,y+1,z-vz,2)))return {x,y,z};
    }
    return sign>0?null:{ x: Math.round(cx), y: surfaceHeight(w, Math.round(cx), Math.round(cz)), z: Math.round(cz) };
  };
  const launch = pick(center.x, center.z, center.radius * 0.85, 1);
  const landing = pick(island.x, island.z, island.radius * 0.65, -1);
  if(!launch || !landing)return null;
  const y = Math.max(launch.y, landing.y);
  const deck = line(launch, landing).map((p) => ({ ...p, y }));
  const blocks = [], seen = new Set();
  const add = (x, yy, z, id, work) => {
    const key = blockKey(x, yy, z);
    if (seen.has(`${key}:${id}`) || !w.inBounds(x, yy, z) || isProtected(w.getBlock(x, yy, z))) return;
    seen.add(`${key}:${id}`); blocks.push({ x, y: yy, z, id, key, work });
  };
  const vx = Math.abs(ux) > Math.abs(uz) ? Math.sign(ux) : 0, vz = vx ? 0 : Math.sign(uz);
  const lx = launch.x - vx, lz = launch.z - vz;
  add(lx,launch.y,lz,BLOCK.PLANKS,{x:lx+0.5,y:launch.y+1,z:lz+0.5});
  for (let yy = y + 1; yy <= y + 2; yy++) add(lx,yy,lz,BLOCK.AIR,
    {x:lx+0.5,y:Math.min(yy,y),z:lz+0.5,climb:true});
  for (let yy = launch.y + 1; yy <= y; yy++) {
    const work = { x: lx + 0.5, y: yy, z: lz + 0.5, climb: true };
    add(launch.x, yy, launch.z, BLOCK.PLANKS, work);
    add(lx, yy, lz, ladderBlock(facingOf(vx, vz)), work);
  }
  for (let i = 0; i < deck.length; i++) {
    const p = deck[i], previous = deck[Math.max(0, i - 1)];
    const work = { x: previous.x + 0.5, y: y + 1, z: previous.z + 0.5, bridge: true };
    add(p.x, y + 1, p.z, BLOCK.AIR, work); add(p.x, y + 2, p.z, BLOCK.AIR, work);
    add(p.x, y, p.z, BLOCK.PLANKS, work);
    if (width > 1) {
      const ox = vx ? 0 : 1, oz = vx ? 1 : 0;
      add(p.x + ox, y + 1, p.z + oz, BLOCK.AIR, work);
      add(p.x + ox, y + 2, p.z + oz, BLOCK.AIR, work);
      add(p.x + ox, y, p.z + oz, BLOCK.PLANKS, work);
    }
  }
  // A stair ramp down to island terrain; never leave an unsupported final drop.
  const ramp = [];
  for (let yy = y; yy > landing.y; yy--) {
    const index = y - yy + 1, x = landing.x + vx * index, z = landing.z + vz * index;
    if (!w.inBounds(x, yy - 1, z) || isProtected(w.getBlock(x, yy - 1, z))) break;
    const previous = ramp.at(-1) ?? { x: landing.x + 0.5, y: y + 1, z: landing.z + 0.5 };
    add(x, yy + 1, z, BLOCK.AIR, previous); add(x, yy, z, BLOCK.AIR, previous);
    add(x, yy - 1, z, BLOCK.PLANKS, previous);
    ramp.push({ x: x + 0.5, y: yy, z: z + 0.5 });
  }
  return { team, width, attempt, blocks, deck, launch, landing, ramp,
    ladder: { x: lx + 0.5, y: launch.y + 1, z: lz + 0.5 }, cursor: 0 };
}

export function widenBridge(bridge) {
  if (bridge.width >= 2) return;
  const dx = bridge.landing.x - bridge.launch.x, dz = bridge.landing.z - bridge.launch.z;
  const ox = Math.abs(dx) > Math.abs(dz) ? 0 : 1, oz = ox ? 0 : 1;
  for (const p of bridge.deck) for (const [dy, id] of [[1, BLOCK.AIR], [2, BLOCK.AIR], [0, BLOCK.PLANKS]]) {
    const b = { x: p.x + ox, y: p.y + dy, z: p.z + oz, id,
      work: { x: p.x + 0.5, y: p.y + 1, z: p.z + 0.5, bridge: true } };
    b.key = blockKey(b.x, b.y, b.z); bridge.blocks.push(b);
  }
  bridge.width = 2;
}

export function planSiege(c, target, tier, history, machines) {
  const team = target.team, list = history.get(team) ?? { count: 0, bridges: [], attempts: 0 };
  history.set(team, list);
  let bridge = list.bridges[0], mode = 'new';
  if (bridge && bridgeDamage(c.world, bridge) > GOBLINS.siege.repairAbandonShare) {
    list.bridges = []; bridge = null; mode = 'abandoned';
  }
  if (bridge) { mode = 'reuse'; widenBridge(bridge); }
  else { bridge = newBridge(c, team, list.count ? 2 : 1, list.attempts++); }
  if(!bridge)return null;
  const bridges = [bridge];
  if (list.count + 1 >= GOBLINS.siege.extraBridgeAfter && c.random() < GOBLINS.siege.extraBridgeChance) {
    const extra=newBridge(c,team,2,list.attempts++);if(extra)bridges.push(extra);
  }
  for(const b of bridges) b.blocks=b.blocks.filter((p)=>!isProtected(c.world.getBlock(p.x,p.y,p.z)));
  const catapult = tier >= 2;
  const oldMachine = [...machines.values()].find((m) => m.type === 'goblinCatapult' && m.targetTeam === team && !m.dead);
  const flag = [...c.game.flags.values()].find((f) => f.team === team);
  const aim = flag?.home ?? { x: c.world.keeps[team].cx, y: bridge.landing.y + 1, z: c.world.keeps[team].cz };
  let platform = oldMachine?.platform ?? null, machineSpot = { x: bridge.launch.x + 0.5, y: bridge.launch.y + 1, z: bridge.launch.z + 0.5 };
  if(catapult && !oldMachine) {
    const dx=bridge.landing.x-bridge.launch.x,dz=bridge.landing.z-bridge.launch.z,d=Math.hypot(dx,dz)||1;
    const preferred={x:bridge.launch.x-dx/d*GOBLINS.catapult.setback,z:bridge.launch.z-dz/d*GOBLINS.catapult.setback};
    let best=null,score=Infinity;
    const half=Math.ceil(GOBLINS.catapult.width/2);
    for(let z=Math.floor(preferred.z)-GOBLINS.catapult.placementSearch;z<=preferred.z+GOBLINS.catapult.placementSearch;z++)
      for(let x=Math.floor(preferred.x)-GOBLINS.catapult.placementSearch;x<=preferred.x+GOBLINS.catapult.placementSearch;x++) {
        const y=surfaceHeight(c.world,x,z)+1;
        if(Math.hypot(x+0.5-aim.x,z+0.5-aim.z)>GOBLINS.catapult.range)continue;
        let clear=true;
        for(let oz=-half;oz<=half && clear;oz++)for(let ox=-half;ox<=half;ox++)
          if(!canStand(c.world,x+ox,y,z+oz,Math.ceil(GOBLINS.catapult.height))){clear=false;break;}
        const cost=Math.hypot(x-preferred.x,z-preferred.z);
        if(clear && cost<score){best={x:x+0.5,y,z:z+0.5};score=cost;}
      }
    if(best)machineSpot=best;
  }
  if (catapult && !oldMachine && Math.hypot(aim.x - machineSpot.x, aim.z - machineSpot.z) > GOBLINS.catapult.range) {
    const p = bridge.deck.find((p) => Math.hypot(aim.x - p.x, aim.z - p.z) < GOBLINS.catapult.range * GOBLINS.catapult.platformRangeShare) ?? bridge.deck.at(-1);
    platform = []; const half = Math.floor(GOBLINS.catapult.platformSize / 2);
    const dx=bridge.landing.x-bridge.launch.x,dz=bridge.landing.z-bridge.launch.z;
    const [ox,oz]=Math.abs(dx)>Math.abs(dz)?[0,1]:[1,0], offset=half+2;
    const add=(x,z,work)=> {
      work={...work,bridge:true};
      const b={x,y:p.y,z,id:BLOCK.PLANKS,work};
      if(!isProtected(c.world.getBlock(x,p.y,z))) {
        for(const dy of [1,2,3])if(!isProtected(c.world.getBlock(x,p.y+dy,z)))
          platform.push({x,y:p.y+dy,z,id:BLOCK.AIR,work,key:blockKey(x,p.y+dy,z)});
        b.key=blockKey(x,p.y,z);platform.push(b);
      }
    };
    for(let i=1;i<=offset;i++)add(p.x+ox*i,p.z+oz*i,
      {x:p.x+ox*(i-1)+0.5,y:p.y+1,z:p.z+oz*(i-1)+0.5});
    for(let px=-half;px<=half;px++)for(let pz=-half;pz<=half;pz++)
      add(p.x+ox*offset+px,p.z+oz*offset+pz,
        {x:p.x+ox*offset+0.5,y:p.y+1,z:p.z+oz*offset+0.5});
    machineSpot={x:p.x+ox*offset+0.5,y:p.y+1,z:p.z+oz*offset+0.5};
  }
  const tasks = [...bridges.flatMap((b) => b.blocks), ...(platform ?? [])]
    .filter((b) => !isProtected(c.world.getBlock(b.x,b.y,b.z)) && c.world.getBlock(b.x, b.y, b.z) !== b.id);
  const wood = tasks.filter((b) => b.id !== BLOCK.AIR).length
    + (catapult && !oldMachine ? GOBLINS.catapult.wood : 0) + (tier >= 3 ? GOBLINS.balloon.wood + GOBLINS.balloon.launchPadSize ** 2 : 0);
  return { target, tier, bridges, mode, tasks, platform, machineSpot, oldMachine, aim,
    wood, needed: Math.ceil(wood * GOBLINS.siege.margin), cursor: 0 };
}
