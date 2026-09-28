import { TICK_RATE, TURRET } from '../shared/config.js';
import { turretType } from '../shared/turrets.js';
import { ballisticAim, ballisticClear } from '../shared/ballistics.js';
import { playerBoxOf } from '../shared/physics.js';
import { S2C } from '../shared/protocol.js';
import { huntable } from './provocation.js';
import { Arrow } from './arrow.js';

const keyOf = (x, y, z) => `${x},${y},${z}`;
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class TurretController {
  constructor(game) {
    this.game = game;
    this.turrets = new Map();
    this.grid = new Map();
    this.lastGridTick = -Infinity;
  }

  place(x, y, z, id, team) {
    const type = turretType(id);
    if (!type) return;
    this.turrets.set(keyOf(x, y, z), { x, y, z, id, team, yaw: 0, pitch: 0,
      nextShot: 0, sight: new Map() });
  }

  remove(x, y, z) { this.turrets.delete(keyOf(x, y, z)); }
  invalidate() { for (const turret of this.turrets.values()) turret.sight.clear(); }

  snapshot() {
    return [...this.turrets.values()].map(({ x, y, z, id, team, yaw, pitch }) => ({ x, y, z, id, team, yaw, pitch }));
  }

  rebuildGrid(tick) {
    this.grid.clear();
    const targetable = [...this.game.players.values(), ...this.game.mobs.values(), ...this.game.dragons.values()];
    const cell = TURRET.spatialCell;
    for (const target of targetable) {
      if (!huntable(target)) continue;
      const { x, z } = target.state;
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(target);
    }
    this.lastGridTick = tick;
  }

  candidates(turret, range) {
    const cell = TURRET.spatialCell, cx = Math.floor((turret.x + 0.5) / cell), cz = Math.floor((turret.z + 0.5) / cell);
    const radius = Math.ceil(range / cell) + 1;
    const result = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      for (const target of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (!huntable(target)) continue;
        if (target.team === turret.team || (target.type !== 'crawler'
          && target.type !== 'voidEel' && target.type !== 'dragon' && target.team === undefined)) continue;
        const s = target.state;
        const distance = Math.hypot(s.x - turret.x - 0.5, s.y - turret.y - 1.5, s.z - turret.z - 0.5);
        if (distance <= range) result.push({ target, distance });
      }
    }
    return result.sort((a, b) => a.distance - b.distance);
  }

  trajectory(turret, target, type) {
    const from = { x: turret.x + 0.5, y: turret.y + 1.6, z: turret.z + 0.5 };
    const s = target.state;
    const box = playerBoxOf(s);
    const aim = { x: s.x, y: s.y + box.height * 0.6, z: s.z };
    return ballisticAim(from,aim,type.arrowSpeed);
  }

  arcClear(turret,target,path,type,tick,fresh=false) {
    const cached=turret.sight.get(target.id),expires=Math.round(type.sightCacheSeconds*TICK_RATE);
    if(!fresh && cached && tick-cached.tick<expires)return cached.clear;
    const clear=ballisticClear(this.game.world,path);turret.sight.set(target.id,{tick,clear});return clear;
  }

  step(tick) {
    if (!this.turrets.size) return;
    if (tick - this.lastGridTick >= TURRET.updateTicks) this.rebuildGrid(tick);
    for (const turret of this.turrets.values()) {
      const type = turretType(turret.id);
      if (tick % type.updateTicks !== Math.abs((turret.x * 31 + turret.z * 17) % type.updateTicks)) continue;
      let chosen = null;
      for (const { target } of this.candidates(turret, type.range)) {
        const path = this.trajectory(turret, target, type);
        if (path && this.arcClear(turret, target, path, type, tick)) { chosen = { target, path }; break; }
      }
      if (!chosen) continue;
      // The head model points along -Z at yaw zero.
      const wanted = Math.atan2(-Math.cos(chosen.path.yaw), -Math.sin(chosen.path.yaw));
      turret.yaw = wrap(turret.yaw + Math.max(-type.headTurnRadiansPerTick * type.updateTicks,
        Math.min(type.headTurnRadiansPerTick * type.updateTicks, wrap(wanted - turret.yaw))));
      turret.pitch = chosen.path.pitch;
      if (tick < turret.nextShot || !this.arcClear(turret, chosen.target, chosen.path, type, tick, true)) continue;
      const { from, yaw, pitch, speed } = chosen.path;
      const shooter = { id: -((turret.x * 4096 + turret.z) * 1024 + turret.y), team: turret.team, turret: true };
      const arrow = new Arrow(this.game.nextId++, shooter, from.x, from.y, from.z,
        Math.cos(yaw) * Math.cos(pitch) * speed, Math.sin(pitch) * speed,
        Math.sin(yaw) * Math.cos(pitch) * speed, 0.5);
      arrow.damage = type.damage;
      this.game.arrows.set(arrow.id, arrow);
      this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
      turret.nextShot = tick + Math.round(type.cooldown * TICK_RATE);
    }
  }
}
