// Machines and ballistic shots are persistent economy entities. Rendering is
// only a description of their state; it never drives flight or impact damage.
import { GOBLINS } from '../shared/goblins.js';
import { TICK_RATE } from '../shared/config.js';
import { BLOCK, getBlockDef, isSolid } from '../shared/blocks.js';
import { S2C, DEATH_CAUSE } from '../shared/protocol.js';
import { isProtected, blockKey } from './goblinProjects.js';
import { raycastBlock } from '../shared/raycast.js';

export class SiegeMachine {
  constructor(id, controller, type, spot, team = null) {
    this.id = id; this.controller = controller; this.type = type;
    this.settings = type === 'goblinCatapult' ? GOBLINS.catapult : GOBLINS.balloon;
    this.name = type === 'goblinCatapult' ? 'Goblin Catapult' : 'Goblin Balloon';
    this.state = { ...spot, yaw: 0, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0,
      box: { halfW: this.settings.width / 2, height: this.settings.height - (type==='goblinBalloon'?this.settings.envelopeOffset:0),
        offsetY: type==='goblinBalloon'?this.settings.envelopeOffset:0 } };
    this.hp = this.maxHp = this.settings.hp; this.dead = false; this.connected = true;
    this.immovable=type==='goblinCatapult';
    this.goblin = true; this.siegeManaged = true; this.machine = true; this.targetTeam = team;
    this.crew = null; this.cargo = []; this.nextShot = 0; this.phase = 'idle';
    this.bombs = 0; this.nextDrop = 0; this.crashVelocity = 0;
  }
  snapshot() { return { id: this.id, type: this.type, name: this.name, ...this.state,
    hp: this.hp, phase: this.phase, cargo: this.cargo.length, bombs: this.bombs,
    firing: this.controller.game.tick - this.lastShot < TICK_RATE / 2 }; }
  describe() { return { ...this.snapshot(), maxHp: this.maxHp }; }
  extraKey() { return `${this.hp},${this.phase},${this.cargo.length}`; }
  eye() { return { x: this.state.x, y: this.state.y + this.settings.height * 0.5, z: this.state.z }; }
}

export class SiegeShot {
  constructor(id, siege, source, target, payload, bomb = false, drop = false) {
    this.id = id; this.type = 'siegeShot'; this.siegeManaged = true;
    this.siege = siege; this.source = { ...source }; this.target = { ...target };
    this.payload = payload; this.bomb = bomb; this.drop=drop; this.connected = true; this.dead = false;
    const seconds = drop
      ? Math.sqrt(2*Math.max(1,source.y-target.y)/GOBLINS.balloon.crashGravity)
      : Math.max(0.5, Math.hypot(target.x-source.x,target.z-source.z) / GOBLINS.catapult.range
      * GOBLINS.catapult.projectileSeconds);
    this.duration = Math.ceil(seconds * TICK_RATE); this.age = 0;
    this.state = { ...source, yaw: 0 }; this.hp = 1;
  }
  snapshot() { return { id: this.id, type: this.type, ...this.state, bomb: this.bomb }; }
  describe() { return this.snapshot(); }
  advance() {
    const old = { ...this.state }, t = Math.min(1, ++this.age / this.duration);
    const a = this.source, b = this.target;
    Object.assign(this.state, { x: a.x + (b.x-a.x)*t, z: a.z + (b.z-a.z)*t,
      y: this.drop ? a.y+(b.y-a.y)*t*t : a.y + (b.y-a.y)*t + GOBLINS.catapult.arcHeight * 4*t*(1-t) });
    const delta = { x: this.state.x-old.x, y: this.state.y-old.y, z: this.state.z-old.z };
    const d = Math.hypot(delta.x, delta.y, delta.z);
    const collisionWorld = {getBlock:(x,y,z)=>this.siege.protectedBridge.has(blockKey(x,y,z))
      ? BLOCK.AIR : this.siege.c.world.getBlock(x,y,z)};
    const hit = d && raycastBlock(collisionWorld, old,
      { x: delta.x/d, y: delta.y/d, z: delta.z/d }, d, isSolid);
    if (hit || t >= 1) {
      if (hit) Object.assign(this.state, { x: old.x + delta.x * hit.t/d,
        y: old.y + delta.y * hit.t/d, z: old.z + delta.z * hit.t/d });
      this.siege.impact(this.state, this.payload, this.bomb);
      this.siege.c.game.removeMob(this);
    }
  }
}

export function resolveImpact(siege, point, payload,bomb=false) {
  const { c } = siege, { game, world } = c;
  const { radius, damage, hardness } = payload;
  for (let y = Math.floor(point.y-radius); y <= Math.ceil(point.y+radius); y++)
    for (let z = Math.floor(point.z-radius); z <= Math.ceil(point.z+radius); z++)
      for (let x = Math.floor(point.x-radius); x <= Math.ceil(point.x+radius); x++) {
        if (Math.hypot(x+0.5-point.x,y+0.5-point.y,z+0.5-point.z) > radius) continue;
        const id = world.getBlock(x,y,z);
        if (id === BLOCK.AIR || isProtected(id) || getBlockDef(id).hardness > hardness
          || siege.protectedBridge.has(blockKey(x,y,z))) continue;
        c.setBlock(x,y,z,BLOCK.AIR);
      }
  for (const p of game.players.values()) {
    if (!p.connected || p.dead) continue;
    const d = Math.hypot(p.state.x-point.x,p.state.y+0.5-point.y,p.state.z-point.z);
    if (d <= radius) game.hurt(p, damage * Math.max(0, 1-d/radius),
      { goblin: true, name: 'Goblin siege', id: null }, DEATH_CAUSE.MOB);
  }
  if(bomb)game.broadcast({type:S2C.SIEGE_EXPLOSION,x:point.x,y:point.y,z:point.z,radius});
  c.log('siegeImpact', { ...point, radius });
}
