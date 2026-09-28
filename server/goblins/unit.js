import { createPlayerState } from '../../shared/physics.js';
import { stepMobPath } from '../../shared/mobMovement.js';
import { GOBLINS, LIFE as C, DUTIES, boxOf } from '../../shared/goblins/life.js';
import { GOBLIN_STATE } from '../../shared/protocol.js';
import { TICK_RATE } from '../../shared/config.js';
import { canSee } from '../provocation.js';
import { playerFitsAt } from '../../shared/physics.js';

const wait = range => Math.round((range[0] + Math.random() * (range[1] - range[0])) * TICK_RATE);
export const UNIT_STATES = ['idle', 'work', 'patrol', 'post', 'fight', 'flee', 'return'];
export class GoblinUnit {
  constructor(id, garrison, slot, spawn) {
    this.id = id; this.garrison = garrison; this.slot = slot; this.home = slot.home;
    this.role = slot.role; this.def = GOBLINS[this.role]; this.type = `goblin${this.role[0].toUpperCase()}${this.role.slice(1)}`;
    this.immovable = !!this.def.immovable;
    this.goblin = true; this.faction = 'goblin'; this.connected = true; this.dead = false;
    this.hp = this.def.hp; this.state = createPlayerState(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
    this.state.box = boxOf(this.role); this.state.edgeGuard = !this.immovable;
    this.path = []; this.behavior = 'return'; this.destination = slot.point;
    this.wait = 0; this.index = 0; this.stuck = 0; this.retried = false; this.walking = false; this.climbing = false;
    this.navVersion = garrison.nav.version;
    this.homeRevision = garrison.nav.area(this.home)?.revision ?? 0; this.lookWait = 0;
  }
  options() { return { ladders: this.def.ladders, role: this.role }; }
  go(point) {
    const area = this.garrison.nav.area(this.home);
    const route = this.garrison.nav.route(this.state, point, area, this.options());
    this.destination = point;
    if (route !== null) this.path = route;
    this.routePending = route === null;
    return route;
  }
  think() {
    const duty = DUTIES[this.slot.duty];
    if (this.routePending) { this.go(this.destination); return; }
    if (this.path.length || --this.wait > 0) return;
    switch (this.behavior) {
      case 'return':
        this.behavior = duty?.state ?? 'idle'; this.wait = wait(C.wanderWait); break;
      case 'patrol': {
        const loop = this.slot.loop;
        this.go(loop[this.index++ % loop.length]); break;
      }
      case 'idle': {
        const area = this.garrison.nav.area(this.home), points = area.interests.length ? area.interests : this.slot.loop;
        this.go(points[Math.floor(Math.random() * points.length)] ?? this.slot.point);
        this.wait = wait(C.wanderWait); break;
      }
      case 'post': {
        const area = this.garrison.nav.area(this.home), radius = duty?.radius ?? C.postRadius;
        const point = this.slot.point;
        const choices = [...area.nodes].map(k => this.garrison.plan.graph.get(k)).filter(n => n && n.y === point.y
          && Math.hypot(n.x - point.x, n.z - point.z) <= radius
          && (!this.slot.box || n.x > this.slot.box.x0 && n.x < this.slot.box.x1 && n.z > this.slot.box.z0 && n.z < this.slot.box.z1));
        this.go(this.shifted ? point : choices[Math.floor(Math.random() * choices.length)] ?? point);
        this.shifted = !this.shifted; this.state.yaw += (Math.random() - 0.5) * Math.PI;
        this.wait = wait(C.postWait); break;
      }
      // Reserved states intentionally perform no combat/work in slice 1a.
      case 'work': case 'fight': case 'flee': break;
      default: this.behavior = 'return';
    }
  }
  unseen(world, players, point = this.state) {
    return players.every(p => p.dead || !p.connected
      || !canSee(world, { x: point.x, y: point.y + this.def.height * 0.7, z: point.z }, p));
  }
  step(world, players) {
    if (this.def.speed === 0) return null;
    const nav = this.garrison.nav;
    if (this.navVersion !== nav.version) { this.path = []; this.routePending = true; this.navVersion = nav.version; }
    const area = nav.area(this.home); if (!area) return null;
    if (this.homeRevision !== (area.revision ?? 0)) { this.path = []; this.routePending = true; this.homeRevision = area.revision ?? 0; }
    if (this.behavior === 'post' && !this.path.length && --this.lookWait <= 0) {
      this.state.yaw += (Math.random() - 0.5) * Math.PI; this.lookWait = wait(C.postWait);
    }
    // A hit may knock a goblin outside its home. Only its return journey may
    // use gate crossings; normal decisions are strictly home constrained.
    if (!nav.contains(area, this.state) && this.behavior !== 'return') { this.behavior = 'return'; this.go(this.slot.point); }
    if (this.behavior === 'return' && !this.path.length && !this.routePending && Math.hypot(this.state.x - this.slot.point.x - 0.5,
      this.state.y - this.slot.point.y, this.state.z - this.slot.point.z - 0.5) > 0.4) this.go(this.slot.point);
    this.think();
    const hadPath = this.path.length > 0, moved = stepMobPath(this, world, this.def.speed);
    if (hadPath && moved < 0.02) this.stuck++; else { this.stuck = 0; if (moved > 0.04) this.retried = false; }
    if (this.stuck >= C.stuckTicks) {
      this.stuck = 0;
      if (this.retried && this.path.length && this.unseen(world, players)) {
        const p = this.path[0], dx = p.x + 0.5 - this.state.x, dy = p.y - this.state.y, dz = p.z + 0.5 - this.state.z;
        const length = Math.hypot(dx, dy, dz), scale = Math.min(1, C.unseenAdvance / Math.max(length, 0.01));
        const next = nav.nearest(area, { x: this.state.x + dx * scale, y: this.state.y + dy * scale, z: this.state.z + dz * scale }, this.role);
        const clear = next && Array.from({ length: Math.ceil(C.unseenAdvance * 4) + 1 }, (_, i) => {
          const t = i / (Math.ceil(C.unseenAdvance * 4) + 1);
          const point = { x: this.state.x + (next.x + 0.5 - this.state.x) * t, y: this.state.y + (next.y - this.state.y) * t,
            z: this.state.z + (next.z + 0.5 - this.state.z) * t, box: this.state.box };
          return nav.contains(area, point) && playerFitsAt(world, point, point.y);
        }).every(Boolean);
        // Advance along this path segment only, with body clearance and no
        // player visibility at either end. Never cut across a wall.
        if (next && clear && Math.hypot(next.x + 0.5 - this.state.x, next.y - this.state.y, next.z + 0.5 - this.state.z) <= C.unseenAdvance && nav.fits(next, this.role)
          && this.unseen(world, players, { x: next.x + 0.5, y: next.y, z: next.z + 0.5 })) {
          this.state.x = next.x + 0.5; this.state.y = next.y; this.state.z = next.z + 0.5; this.state.vy = 0;
        }
      }
      this.retried = true; this.go(this.destination);
    }
    return null;
  }
  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100,
      z: Math.round(s.z * 100) / 100, yaw: Math.round(s.yaw * 100) / 100,
      g: this.climbing ? GOBLIN_STATE.CLIMB : this.walking ? GOBLIN_STATE.WALK : GOBLIN_STATE.IDLE };
  }
  describe() { return { ...this.snapshot(), hp: this.hp, maxHp: this.def.hp }; }
}
