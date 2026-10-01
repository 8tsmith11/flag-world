// The Dragon Lord is a server-owned encounter. Clients receive compact state
// for animation and telegraphs; collision and damage are resolved here.
import { BLOCK, isSolid } from '../shared/blocks.js';
import { DRAGON_ARENA as A, DRAGON_LORD as C, TICK_DT, TICK_RATE } from '../shared/config.js';
import { ITEM } from '../shared/itemIds.js';
import { DEATH_CAUSE, S2C } from '../shared/protocol.js';
import { inDragonArena } from '../shared/fireTempleArena.js';

const ticks = seconds => Math.max(1, Math.round(seconds * TICK_RATE));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const angleTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class DragonLord {
  constructor(game) {
    this.game = game;
    this.arena = game.world.dragonArena;
    this.state = { x: this.arena.x + 0.5, y: this.arena.y + 1,
      z: this.arena.z + 0.5, yaw: 0, box: { halfW: C.bodyHalfWidth, height: C.bodyHeight } };
    this.connected = true;
    this.name = 'Dragon Lord';
    this.status = 'sleeping';
    this.maxHp = C.baseHp;
    this.hp = this.maxHp;
    this.phase = 1;
    this.action = null;
    this.fireballs = [];
    this.marks = [];
    this.pillarHits = new Map();
    this.lavaState = 'quiet';
    this.nextLavaTick = 0;
    this.lavaUntil = 0;
    this.nextAttackTick = 0;
    this.attackIndex = 0;
    this.volleyCount = 0;
    this.nextFireballId = 1;
    this.collapsed = false;
    this.deathTick = 0;
    this.killerName = null;
  }

  get dead() { return this.status === 'dead' || this.status === 'dying'; }
  get targetable() { return this.status === 'active' || this.status === 'dying'; }
  players() {
    return [...this.game.players.values()].filter(p => p.connected && !p.dead
      && inDragonArena(this.game.world, p.state.x, p.state.z));
  }
  snapshot() {
    return { status: this.status, name: this.name, hp: this.hp, maxHp: this.maxHp,
      phase: this.phase, x: this.state.x, y: this.state.y, z: this.state.z, yaw: this.state.yaw,
      action: this.action, fireballs: this.fireballs.map(({ id, x, y, z, reflected }) => ({ id, x, y, z, reflected })),
      marks: this.marks, lavaState: this.lavaState, lavaUntil: this.lavaUntil,
      deathTick: this.deathTick, tick: this.game.tick };
  }
  publish() { this.game.broadcast({ type: S2C.BOSS_STATE, boss: this.snapshot() }); }
  wake(players) {
    this.status = 'active';
    this.maxHp = C.baseHp + C.hpPerExtraPlayer * Math.max(0, players.length - 1);
    this.hp = this.maxHp;
    this.nextAttackTick = this.game.tick + ticks(2);
    this.nextLavaTick = this.game.tick + ticks(C.lavaCycle);
    this.publish();
  }
  reset() {
    this.restorePillars();
    this.setLavaRing(false);
    this.status = 'sleeping';
    this.hp = this.maxHp = C.baseHp;
    this.phase = 1;
    Object.assign(this.state, { x: this.arena.x + 0.5, y: this.arena.y + 1, z: this.arena.z + 0.5, yaw: 0 });
    this.action = null;
    this.marks.length = 0;
    this.fireballs.length = 0;
    this.volleyCount = this.attackIndex = 0;
    this.landUntil = 0;
    this.lavaState = 'quiet';
    this.collapsed = false;
    this.publish();
  }
  hurt(amount, attacker) {
    if (this.status !== 'active') return;
    if (this.action?.kind === 'stunned' || this.action?.kind === 'collapsed') amount *= 2;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.status = 'dying';
      this.deathTick = this.game.tick;
      this.killerName = attacker?.name ?? 'Someone';
      this.action = { kind: 'death', start: this.game.tick, until: this.game.tick + ticks(C.deathSeconds) };
      this.fireballs.length = 0;
      this.marks.length = 0;
      this.setLavaRing(false);
    } else {
      const fraction = this.hp / this.maxHp;
      const phase = fraction <= C.airPhaseEnd ? 3 : fraction <= C.groundPhaseEnd ? 2 : 1;
      if (phase !== this.phase) {
        this.phase = phase;
        this.action = null;
        this.landUntil = 0;
        this.fireballs.length = 0;
        this.marks.length = 0;
        this.nextAttackTick = this.game.tick + ticks(1.5);
        if (phase === 2) this.toPerch();
        else Object.assign(this.state, { x: this.arena.x + 0.5, y: this.arena.y + 1,
          z: this.arena.z + 0.5 });
      }
      if (phase === 3 && !this.collapsed && fraction <= C.collapseThreshold) {
        this.collapsed = true;
        this.action = { kind: 'collapsed', start: this.game.tick,
          until: this.game.tick + ticks(C.collapseSeconds) };
      }
    }
    this.publish();
  }
  toPerch() {
    Object.assign(this.state, this.arena.perch);
    this.state.yaw = angleTo(this.state, this.arena);
  }
  groundTarget(players) {
    return players.reduce((best, p) => !best || distance(p.state, this.state) < distance(best.state, this.state) ? p : best, null);
  }
  startGroundAttack(players) {
    const target = this.groundTarget(players);
    if (!target) return;
    const pattern = this.phase === 3 ? ['swipe', 'tail', 'stomp', 'breath'] : ['swipe', 'tail', 'stomp'];
    const kind = pattern[this.attackIndex++ % pattern.length];
    const windup = C[`${kind}Windup`] * (this.phase === 3 ? C.enragedWindupScale : 1);
    this.state.yaw = angleTo(this.state, target.state);
    this.action = { kind, stage: 'windup', start: this.game.tick,
      until: this.game.tick + ticks(windup), yaw: this.state.yaw, hit: [] };
  }
  startVolley(players) {
    if (this.volleyCount >= C.volleysBeforeDive) {
      this.volleyCount = 0;
      const target = this.groundTarget(players);
      const lineX = clamp(target?.state.x ?? this.arena.x, this.arena.x - A.mainRadius + 4,
        this.arena.x + A.mainRadius - 4);
      this.action = { kind: 'dive', stage: 'windup', lineX, start: this.game.tick,
        until: this.game.tick + ticks(C.diveWarning), hit: [] };
      return;
    }
    const kind = ['aimed', 'fan', 'rain'][this.volleyCount++ % 3];
    this.action = { kind, stage: 'windup', start: this.game.tick,
      until: this.game.tick + ticks(0.8), shots: 0 };
    if (kind === 'rain') {
      const random = this.random(this.volleyCount + this.game.tick);
      this.marks = Array.from({ length: C.rainCount }, (_, index) => {
        const target = players[index % players.length].state;
        const angle = random() * Math.PI * 2, offset = random() * 4;
        return { x: clamp(target.x + Math.cos(angle) * offset, this.arena.x - A.mainRadius + 2,
          this.arena.x + A.mainRadius - 2), z: clamp(target.z + Math.sin(angle) * offset,
          this.arena.z - A.mainRadius + 2, this.arena.z + A.mainRadius - 2),
        until: this.game.tick + ticks(C.rainWarning) };
      });
    }
  }
  random(salt) {
    let seed = (this.game.world.seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
    return () => { seed = Math.imul(seed ^ seed >>> 15, 2246822519) >>> 0; return seed / 4294967296; };
  }
  shootAt(target, from = this.state) {
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const len = Math.max(0.001, Math.hypot(dx, dy, dz));
    this.fireballs.push({ id: this.nextFireballId++, x: from.x, y: from.y, z: from.z,
      vx: dx / len * C.fireballSpeed, vy: dy / len * C.fireballSpeed,
      vz: dz / len * C.fireballSpeed, reflected: false });
  }
  volleyTick(players) {
    const a = this.action;
    if (a.stage === 'windup') {
      if (this.game.tick < a.until) return;
      a.stage = 'firing'; a.start = this.game.tick;
    }
    if (a.kind === 'rain') {
      if (this.game.tick < this.marks[0]?.until) return;
      for (const mark of this.marks)
        this.shootAt({ x: mark.x, y: this.arena.y + 1, z: mark.z },
          { x: mark.x, y: this.arena.y + C.rainHeight, z: mark.z });
      this.marks.length = 0; this.action = null;
      this.nextAttackTick = this.game.tick + ticks(C.attackPause);
      return;
    }
    const count = a.kind === 'aimed' ? C.aimedCount : C.fanCount;
    if (this.game.tick < a.start + ticks(C.aimedInterval) * a.shots) return;
    const target = this.groundTarget(players);
    if (!target) return;
    if (a.kind === 'aimed') this.shootAt({ x: target.state.x, y: target.state.y + 1, z: target.state.z });
    else {
      const angle = angleTo(this.state, target.state)
        + (a.shots - (count - 1) / 2) * C.fanSpread / (count - 1);
      this.shootAt({ x: this.state.x - Math.sin(angle) * A.perchDistance,
        y: this.arena.y + 1, z: this.state.z - Math.cos(angle) * A.perchDistance });
    }
    a.shots++;
    if (a.shots >= count) { this.action = null; this.nextAttackTick = this.game.tick + ticks(C.attackPause); }
  }
  stepAction(players) {
    const a = this.action, now = this.game.tick;
    if (!a) return;
    if (a.kind === 'stunned' || a.kind === 'collapsed') {
      if (now >= a.until) { this.action = null; this.nextAttackTick = now + ticks(C.attackPause); }
      return;
    }
    if (a.kind === 'aimed' || a.kind === 'fan' || a.kind === 'rain') return this.volleyTick(players);
    if (a.kind === 'dive') {
      if (a.stage === 'windup' && now >= a.until) {
        a.stage = 'diving'; a.start = now; a.until = now + ticks(C.diveSeconds);
      }
      if (a.stage === 'diving') {
        const t = clamp((now - a.start) / ticks(C.diveSeconds), 0, 1);
        Object.assign(this.state, { x: a.lineX, y: this.arena.y + 3,
          z: this.arena.z - A.mainRadius + t * A.mainRadius * 2, yaw: Math.PI });
        for (const p of players) if (!a.hit.includes(p.id)
          && Math.abs(p.state.x - a.lineX) < C.diveWidth
          && Math.abs(p.state.z - this.state.z) < C.diveWidth) {
          a.hit.push(p.id); this.game.damage(p, C.diveDamage, null, DEATH_CAUSE.MOB);
        }
        if (t >= 1) {
          this.state.y = this.arena.y + 1;
          this.state.z = this.arena.z + 0.5;
          this.action = null;
          this.landUntil = now + ticks(C.landingSeconds);
          this.nextAttackTick = now + ticks(C.attackPause);
        }
      }
      return;
    }
    if (a.stage === 'windup' && now >= a.until) {
      a.stage = 'active'; a.start = now;
      if (a.kind === 'swipe' || a.kind === 'tail') {
        this.hitArc(players, a);
        this.action = null;
        this.nextAttackTick = now + ticks(C.attackPause);
        return;
      }
      if (a.kind === 'stomp') a.until = now + ticks(C.shockwaveMaxRadius / C.shockwaveSpeed);
      if (a.kind === 'breath') a.until = now + ticks(C.breathSeconds);
    }
    if (a.stage !== 'active') return;
    if (a.kind === 'stomp') {
      const radius = (now - a.start) * TICK_DT * C.shockwaveSpeed;
      for (const p of players) {
        if (a.hit.includes(p.id) || p.state.y > this.arena.y + C.jumpHeight) continue;
        if (Math.abs(distance(p.state, this.state) - radius) <= C.shockwaveWidth) {
          a.hit.push(p.id); this.game.damage(p, C.stompDamage, null, DEATH_CAUSE.MOB);
        }
      }
      if (now >= a.until) this.action = { kind: 'stunned', start: now, until: now + ticks(C.stunSeconds) };
    } else if (a.kind === 'breath') {
      const progress = (now - a.start) / ticks(C.breathSeconds);
      const yaw = a.yaw - C.breathArc / 2 + C.breathArc * progress;
      for (const p of players) {
        if (p.fireImmune() || (a.hit[p.id] ?? 0) > now) continue;
        const d = distance(p.state, this.state);
        if (d > C.breathRange || Math.abs(wrap(angleTo(this.state, p.state) - yaw)) > C.breathHalfAngle) continue;
        if (this.blockedByPillar(p.state)) continue;
        a.hit[p.id] = now + ticks(C.breathHitInterval);
        this.game.damage(p, C.breathDamage, null, DEATH_CAUSE.MOB);
      }
      if (now >= a.until) { this.action = null; this.nextAttackTick = now + ticks(C.attackPause); }
    }
  }
  hitArc(players, a) {
    const tail = a.kind === 'tail';
    for (const p of players) {
      const d = distance(p.state, this.state);
      if (d > (tail ? C.tailRange : C.swipeRange)) continue;
      if (tail && p.state.y > this.arena.y + C.jumpHeight) continue;
      const angle = Math.abs(wrap(angleTo(this.state, p.state) - a.yaw));
      if (tail ? angle < Math.PI - 1.2 : angle > C.swipeHalfAngle) continue;
      this.game.damage(p, tail ? C.tailDamage : C.swipeDamage, null, DEATH_CAUSE.MOB);
    }
  }
  blockedByPillar(target) {
    const dx = target.x - this.state.x, dz = target.z - this.state.z;
    const steps = Math.ceil(Math.hypot(dx, dz));
    for (let i = 1; i < steps; i++) {
      const x = Math.floor(this.state.x + dx * i / steps);
      const z = Math.floor(this.state.z + dz * i / steps);
      if (isSolid(this.game.world.getBlock(x, this.arena.y + 3, z))) return true;
    }
    return false;
  }
  reflectFireball(origin, direction, maxRange, player) {
    let best = null, bestT = maxRange;
    for (const ball of this.fireballs) {
      if (ball.reflected) continue;
      const dx = ball.x - origin.x, dy = ball.y - origin.y, dz = ball.z - origin.z;
      const t = dx * direction.x + dy * direction.y + dz * direction.z;
      if (t < 0 || t > bestT) continue;
      if (Math.hypot(dx - direction.x * t, dy - direction.y * t, dz - direction.z * t) > C.fireballRadius + 0.35) continue;
      best = ball; bestT = t;
    }
    if (!best) return false;
    const target = this.state;
    const dx = target.x - best.x, dy = target.y + C.bodyHeight / 2 - best.y, dz = target.z - best.z;
    const d = Math.max(0.01, Math.hypot(dx, dy, dz));
    Object.assign(best, { vx: dx / d * C.fireballSpeed * 1.5,
      vy: dy / d * C.fireballSpeed * 1.5, vz: dz / d * C.fireballSpeed * 1.5,
      reflected: true, owner: player });
    return true;
  }
  stepFireballs(players) {
    const world = this.game.world;
    this.fireballs = this.fireballs.filter(ball => {
      ball.x += ball.vx * TICK_DT; ball.y += ball.vy * TICK_DT; ball.z += ball.vz * TICK_DT;
      if (!inDragonArena(world, ball.x, ball.z) || ball.y < world.minY || ball.y >= world.sizeY) return false;
      if (ball.reflected) {
        if (Math.hypot(ball.x - this.state.x, ball.y - this.state.y - C.bodyHeight / 2,
          ball.z - this.state.z) < C.bodyHalfWidth + C.fireballRadius) {
          this.hurt(C.reflectedDamage, ball.owner ?? null); return false;
        }
      } else {
        if (players.some(p => Math.hypot(p.state.x - ball.x, p.state.y + 1 - ball.y,
          p.state.z - ball.z) < C.fireballRadius + 0.5)) {
          this.explode(ball, players); return false;
        }
      }
      if (isSolid(world.getBlock(Math.floor(ball.x), Math.floor(ball.y), Math.floor(ball.z)))) {
        if (!ball.reflected) { this.hitPillar(ball); this.explode(ball, players); }
        return false;
      }
      return true;
    });
  }
  explode(ball, players) {
    for (const p of players) if (!p.fireImmune()
      && Math.hypot(p.state.x - ball.x, p.state.y + 1 - ball.y, p.state.z - ball.z) <= C.fireballBlastRadius)
      this.game.damage(p, C.fireballDamage, null, DEATH_CAUSE.MOB);
  }
  hitPillar(ball) {
    for (const pillar of this.arena.pillars) {
      if (Math.hypot(ball.x - pillar.x, ball.z - pillar.z) > C.pillarRadius) continue;
      const key = `${pillar.x},${pillar.z}`;
      const hits = (this.pillarHits.get(key) ?? 0) + 1;
      this.pillarHits.set(key, hits);
      if (hits >= C.pillarHits) for (let yy = this.arena.y + 1; yy <= this.arena.y + A.pillarHeight; yy++)
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
          this.game.world.setBlock(pillar.x + dx, yy, pillar.z + dz, BLOCK.AIR);
      break;
    }
  }
  restorePillars() {
    for (const pillar of this.arena.pillars) for (let yy = this.arena.y + 1; yy <= this.arena.y + A.pillarHeight; yy++)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        this.game.world.setBlock(pillar.x + dx, yy, pillar.z + dz, BLOCK.OBSIDIAN);
    this.pillarHits.clear();
  }
  setLavaRing(rising) {
    if (this.lavaRingRaised === rising) return;
    this.lavaRingRaised = rising;
    for (let dz = -A.mainRadius; dz <= A.mainRadius; dz++)
      for (let dx = -A.mainRadius; dx <= A.mainRadius; dx++) {
        const r = Math.hypot(dx, dz);
        if (r < C.lavaRingInner || r > C.lavaRingOuter) continue;
        if (dz === A.exitOffset && Math.abs(dx) <= 2) continue;
        this.game.world.setBlock(this.arena.x + dx, this.arena.y + 1, this.arena.z + dz,
          rising ? BLOCK.LAVA : BLOCK.AIR);
      }
  }
  stepLava() {
    if (this.phase !== 3) { if (this.lavaRingRaised) this.setLavaRing(false); return; }
    const now = this.game.tick;
    if (this.lavaState === 'quiet' && now >= this.nextLavaTick) {
      this.lavaState = 'warning'; this.lavaUntil = now + ticks(C.lavaWarning);
    } else if (this.lavaState === 'warning' && now >= this.lavaUntil) {
      this.lavaState = 'raised'; this.lavaUntil = now + ticks(C.lavaDuration);
      this.setLavaRing(true);
    } else if (this.lavaState === 'raised' && now >= this.lavaUntil) {
      this.setLavaRing(false); this.lavaState = 'quiet';
      this.nextLavaTick = now + ticks(C.lavaCycle);
    }
  }
  finishDeath() {
    this.status = 'dead';
    this.action = null;
    this.setLavaRing(false);
    const x = this.arena.x + 0.5, y = this.arena.y + 2, z = this.arena.z + 0.5;
    const drop = (item, count) => this.game.spawnItem(item, count, x, y, z, 0, 2, 0, 0);
    drop(ITEM.DRAGON_CROWN, 1);
    drop(ITEM.DRAGON_HEART, 1);
    const random = this.random(this.game.tick);
    drop(ITEM.DRAGON_SCALE, C.scalesDrop[0]
      + Math.floor(random() * (C.scalesDrop[1] - C.scalesDrop[0] + 1)));
    this.game.broadcast({ type: S2C.BOSS_VICTORY, name: this.killerName });
    this.publish();
  }
  step() {
    let players = this.players();
    const now = this.game.tick;
    for (const p of players) if (p.state.y < this.arena.y - A.lavaKillDepth)
      this.game.kill(p, this.game.recentAttacker(p), DEATH_CAUSE.LAVA);
    players = players.filter(p => !p.dead);
    if (this.status === 'dead') return;
    if (this.status === 'dying') {
      if (now >= this.deathTick + ticks(C.deathSeconds)) this.finishDeath();
      else if (now % C.snapshotTicks === 0) this.publish();
      return;
    }
    if (this.status === 'sleeping') {
      if (players.some(p => distance(p.state, this.state) <= C.wakeDistance)) this.wake(players);
      return;
    }
    if (!players.length) { this.reset(); return; }
    this.stepLava();
    this.stepFireballs(players);
    if ((this.phase !== 2 || this.landUntil) && !this.action) {
      const target = this.groundTarget(players);
      if (target) {
        const dx = target.state.x - this.state.x, dz = target.state.z - this.state.z;
        const d = Math.hypot(dx, dz);
        if (d > 5) {
          const nx = this.state.x + dx / d * C.groundSpeed * TICK_DT;
          const nz = this.state.z + dz / d * C.groundSpeed * TICK_DT;
          if (Math.hypot(nx - this.arena.x, nz - this.arena.z) < A.mainRadius - 5) {
            this.state.x = nx; this.state.z = nz;
          }
        }
        this.state.yaw = angleTo(this.state, target.state);
      }
    }
    if (this.phase === 2 && this.landUntil && now >= this.landUntil) {
      this.landUntil = 0; this.toPerch(); this.action = null;
      this.nextAttackTick = now + ticks(C.attackPause);
    }
    if (this.action) this.stepAction(players);
    else if (now >= this.nextAttackTick) {
      if (this.phase === 2 && !this.landUntil) this.startVolley(players);
      else this.startGroundAttack(players);
    }
    if (now % C.snapshotTicks === 0) this.publish();
  }
}
