// Small procedural sounds, created after a user gesture. No audio files or
// continuous loops; distant mobs and idle scenes cost no audio work.
import { BLOCK, isWater } from '/shared/blocks.js';
import { GOBLINS } from '/shared/goblins.js';
import { ENTITY_TYPE, GOBLIN_ANIMATION } from '/shared/protocol.js';

export class Sounds {
  constructor() {
    this.context = null;
    this.noise = null;
    this.time = 0;
    this.stepTime = 0;
    this.mobCalls = new Map();
    this.remoteSteps = new Map();
    this.firing = new Set();
    this.wasWet = false;this.siegeBeatUntil=0;this.nextSiegeBeat=0;this.goblinWork=new Map();
  }

  unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) {
      this.context = new AudioContext();
      const length = this.context.sampleRate;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  volume(position, listener, range = 30) {
    if (!position || !listener) return 1;
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z);
    return Math.max(0, 1 - distance / range) ** 2;
  }

  noiseBurst(duration, frequency, volume, position, listener) {
    const ctx = this.context;
    const loudness = volume * this.volume(position, listener);
    if (!ctx || ctx.state !== 'running' || loudness <= 0.001) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(loudness, now + Math.min(0.025, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + duration);
  }

  tone(from, to, duration, volume, position, listener, wave = 'sawtooth') {
    const ctx = this.context;
    const loudness = volume * this.volume(position, listener);
    if (!ctx || ctx.state !== 'running' || loudness <= 0.001) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(loudness, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  siegeDeclared() {
    this.tone(110,82,GOBLINS.sounds.hornSeconds,0.12,null,null,'sawtooth');
    this.tone(165,123,GOBLINS.sounds.hornSeconds,0.05,null,null,'triangle');
    this.siegeBeatUntil=this.time+GOBLINS.sounds.drumSeconds;this.nextSiegeBeat=this.time;
  }

  explosion(position,listener) {
    this.noiseBurst(0.7,850,0.3,position,listener);this.tone(80,28,0.6,0.2,position,listener,'sine');
  }

  goblinHurt(type,position,listener) {
    this.tone(type===ENTITY_TYPE.GOBLIN_BRUTE?110:390,85,0.2,0.07,position,listener,'sawtooth');
  }

  blockHit(id, position, listener) {
    const hard = id === BLOCK.STONE || id === BLOCK.IRON_ORE || id === BLOCK.KEEP;
    this.noiseBurst(0.08, hard ? 1800 : 650, 0.12, position, listener);
  }

  blockBreak(id, position, listener) {
    if (isWater(id) || id === BLOCK.LEAVES) return;
    this.noiseBurst(0.18, id === BLOCK.STONE || id === BLOCK.IRON_ORE ? 2400 : 950,
      0.18, position, listener);
  }

  update(dt, listener, state, world, entities, sprinting) {
    this.time += dt;
    if(this.time<this.siegeBeatUntil && this.time>=this.nextSiegeBeat) {
      this.tone(120,35,0.22,0.1,null,null,'sine');this.noiseBurst(0.11,450,0.035);
      this.nextSiegeBeat=this.time+GOBLINS.sounds.drumInterval;
    }
    const wet = isWater(world.getBlock(Math.floor(state.x), Math.floor(state.y), Math.floor(state.z)));
    if (wet && !this.wasWet) this.noiseBurst(0.3, 1700, 0.22);
    this.wasWet = wet;
    const moving = state.onGround && !wet && Math.hypot(state.vx, state.vz) > 0.7;
    if (moving) {
      this.stepTime -= dt;
      if (this.stepTime <= 0) {
        const below = world.getBlock(Math.floor(state.x), Math.floor(state.y - 0.08), Math.floor(state.z));
        const frequency = below === BLOCK.STONE || below === BLOCK.IRON_ORE ? 1550
          : below === BLOCK.SAND ? 500 : below === BLOCK.WOOD || below === BLOCK.PLANKS ? 780 : 1050;
        this.noiseBurst(0.09, frequency, sprinting ? 0.14 : 0.1);
        this.stepTime = sprinting ? 0.27 : 0.39;
      }
    } else this.stepTime = 0;

    const present = new Set();
    for (const [id, entity] of entities.entities) {
      const type = entity.info.type;
      if (type === ENTITY_TYPE.PLAYER) {
        const snap = entity.snapshots.at(-1);
        const position = entity.object.position;
        const speed = Math.hypot(snap?.vx ?? 0, snap?.vz ?? 0);
        present.add(id);
        if (snap?.onGround && !snap.dead && speed > 0.7 && this.volume(position, listener, 20) > 0
          && this.time >= (this.remoteSteps.get(id) ?? 0)) {
          const below = world.getBlock(Math.floor(position.x), Math.floor(position.y - 0.08), Math.floor(position.z));
          this.noiseBurst(0.09, below === BLOCK.STONE ? 1550 : 950, 0.1, position, listener);
          this.remoteSteps.set(id, this.time + (speed > 5 ? 0.27 : 0.39));
        }
        continue;
      }
      if (type === ENTITY_TYPE.VOID_EEL) {
        present.add(id);
        const coiling = !!entity.snapshots.at(-1)?.coiling;
        if (coiling && !this.firing.has(id)) {
          this.noiseBurst(0.8, 3200, 0.18, entity.object.position, listener);
          this.tone(650, 210, 0.9, 0.08, entity.object.position, listener, 'sine');
        }
        if (coiling) this.firing.add(id); else this.firing.delete(id);
        continue;
      }
      if([ENTITY_TYPE.GOBLIN_WORKER,ENTITY_TYPE.GOBLIN_SOLDIER,ENTITY_TYPE.GOBLIN_ARCHER,ENTITY_TYPE.GOBLIN_HOUND,ENTITY_TYPE.GOBLIN_BRUTE,ENTITY_TYPE.GOBLIN_KING].includes(type)) {
        present.add(id);const position=entity.object.position,snap=entity.snapshots.at(-1);
        if(this.volume(position,listener)>0) {
          const working=snap?.mining || (snap?.a & GOBLIN_ANIMATION.WORK);
          if(working && this.time>=(this.goblinWork.get(id) ?? 0)) {
            this.noiseBurst(0.09,1300,0.07,position,listener);this.goblinWork.set(id,this.time+GOBLINS.sounds.workInterval);
          }
          if(!this.mobCalls.has(id))this.mobCalls.set(id,this.time+Math.random()*GOBLINS.sounds.ambientInterval);
          if(this.time>=this.mobCalls.get(id)) {
            const from=type===ENTITY_TYPE.GOBLIN_HOUND?320:type===ENTITY_TYPE.GOBLIN_BRUTE?95:240;
            this.tone(from,from*0.55,0.3,0.055,position,listener,'sawtooth');
            this.noiseBurst(0.16,650,0.025,position,listener);
            this.mobCalls.set(id,this.time+GOBLINS.sounds.ambientInterval+Math.random()*GOBLINS.sounds.ambientJitter);
          }
        }
        continue;
      }
      if (type !== ENTITY_TYPE.COW && type !== ENTITY_TYPE.DRAGON) continue;
      present.add(id);
      const position = entity.object.position;
      const near = this.volume(position, listener) > 0;
      if (!this.mobCalls.has(id)) this.mobCalls.set(id, this.time + 2 + Math.random() * 4);
      if (near && this.time >= this.mobCalls.get(id)) {
        if (type === ENTITY_TYPE.COW) this.tone(170, 105, 0.6, 0.09, position, listener);
        else {
          this.tone(85, 39, 0.95, 0.13, position, listener);
          this.noiseBurst(0.8, 340, 0.07, position, listener);
        }
        this.mobCalls.set(id, this.time + (type === ENTITY_TYPE.COW ? 7 : 9) + Math.random() * 10);
      }
      if (type === ENTITY_TYPE.DRAGON) {
        const breathing = !!entity.snapshots.at(-1)?.breathing;
        if (near && breathing && !this.firing.has(id)) this.noiseBurst(0.75, 2600, 0.18, position, listener);
        if (breathing) this.firing.add(id); else this.firing.delete(id);
      }
    }
    for (const id of this.mobCalls.keys()) if (!present.has(id)) this.mobCalls.delete(id);
    for (const id of this.goblinWork.keys())if(!present.has(id))this.goblinWork.delete(id);
    for (const id of this.remoteSteps.keys()) if (!present.has(id)) this.remoteSteps.delete(id);
    for (const id of this.firing) if (!present.has(id)) this.firing.delete(id);
  }
}
