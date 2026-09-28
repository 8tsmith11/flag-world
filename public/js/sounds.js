// Data-selected recorded sounds, with the existing procedural effects retained
// for mining taps, eel attacks and missing-file fallbacks.
import { BLOCK, isWater } from '/shared/blocks.js';
import { AUDIO as C } from '/shared/config.js';
import { soundMaterial, MATERIAL_SOUNDS, EFFECT_SOUNDS, MOB_SOUNDS, MONKEY_SOUNDS } from '/shared/audio.js';
import { NPC_DEFS } from '/shared/npcs.js';
import { ENTITY_TYPE } from '/shared/protocol.js';

export class Sounds {
  constructor(mixer) {
    this.mixer = mixer;
    this.motion = new Map();
    this.wings = new Map();
    this.context = null;
    this.noise = null;
    this.time = 0;
    this.mobCalls = new Map();
    this.firing = new Set();
    // Ancient Monkeys: last pose seen, and a pending roar after a chest beat.
    this.poses = new Map();
    this.roars = new Map();
  }

  unlock() {
    this.mixer.unlock();
    if (!this.mixer.context) return;
    if (!this.context) {
      this.context = this.mixer.context;
      const length = this.context.sampleRate;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  volume(position, listener, range = C.effectsRange) {
    if (!position || !listener) return 1;
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z);
    return Math.max(0, 1 - distance / range) ** 2;
  }

  noiseBurst(duration, frequency, volume, position, listener) {
    const ctx = this.context;
    const loudness = volume;
    if (!ctx || ctx.state !== 'running' || loudness <= 0.001) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    source.connect(filter);
    const gain = this.mixer.output(source, position, loudness, C.effectsRange, filter);
    if (!gain) return;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(loudness * this.volume(position, listener), now + Math.min(0.025, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.start(now);
    source.stop(now + duration);
  }

  tone(from, to, duration, volume, position, listener, wave = 'sawtooth') {
    const ctx = this.context;
    const loudness = volume;
    if (!ctx || ctx.state !== 'running' || loudness <= 0.001) return;
    const oscillator = ctx.createOscillator();
    const gain = this.mixer.output(oscillator, position, loudness);
    if (!gain) return;
    const now = ctx.currentTime;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(loudness * this.volume(position, listener), now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  blockHit(id, position, listener) {
    const material = soundMaterial(id);
    const hard = material === 'stone' || material === 'brick';
    this.noiseBurst(0.08, hard ? 1800 : 650, C.blockGain.hit, position, listener);
  }

  blockBreak(id, position, listener) {
    if (isWater(id)) return;
    const sounds = MATERIAL_SOUNDS[soundMaterial(id)] ?? MATERIAL_SOUNDS.stone;
    if (this.mixer.play(sounds.break, C.blockGain.break, position)) return;
    this.noiseBurst(0.18, id === BLOCK.STONE || id === BLOCK.IRON_ORE ? 2400 : 950,
      0.18, position, listener);
  }

  blockPlace(id, position) {
    if (isWater(id)) return;
    const sounds = MATERIAL_SOUNDS[soundMaterial(id)] ?? MATERIAL_SOUNDS.stone;
    if (!this.mixer.play(sounds.place, C.blockGain.place, position)) this.noiseBurst(0.09, 900, C.blockGain.place, position, this.mixer.listener);
  }

  mobDamage(entity, hp) {
    if (!entity) return;
    const type=entity.info.type, sounds=MOB_SOUNDS[type];
    if (!sounds) return;
    const gain=hp<=0?C.mobDeathGain:C.mobHurtGain, range=type===ENTITY_TYPE.DRAGON?C.dragonRange:C.cowRange;
    this.mixer.play(hp<=0?sounds.death:sounds.hurt,gain,entity.object.position,range);
  }

  playerMotion(id, state, position, world, dt, local = false, sprinting = false) {
    const wet = isWater(world.getBlock(Math.floor(position.x),Math.floor(position.y),Math.floor(position.z)));
    let previous = this.motion.get(id);
    if (!previous) { previous={x:position.x,y:position.y,z:position.z,wet,onGround:state.onGround,vy:0,lastY:position.y,step:0};this.motion.set(id,previous);return; }
    const distance=Math.hypot(position.x-previous.x,position.z-previous.z);
    if (Math.hypot(distance,position.y-previous.y)>8 || state.dead) { Object.assign(previous,{...position,wet,onGround:state.onGround,vy:0,step:0});return; }
    const speed=local?Math.hypot(state.vx??0,state.vz??0):distance/Math.max(dt,0.001);
    if(wet&&!previous.wet) {
      if(!this.mixer.play(EFFECT_SOUNDS.splash,C.splashGain,local?null:position,C.playerRange))this.noiseBurst(0.3,1700,0.22,local?null:position,this.mixer.listener);
    }
    if(state.onGround&&!previous.onGround&&!wet&&previous.vy < -C.landingSpeed) this.mixer.play(EFFECT_SOUNDS.landing,C.landingGain,local?null:position,C.playerRange);
    if(state.onGround&&!wet&&speed>C.footsteps.minSpeed) {
      previous.step-=dt;
      if(previous.step<=0) {
        const below=world.getBlock(Math.floor(position.x),Math.floor(position.y-0.08),Math.floor(position.z));
        const sounds=MATERIAL_SOUNDS[soundMaterial(below)]??MATERIAL_SOUNDS.stone;
        const fast=sprinting||speed>5;
        if(!this.mixer.play(sounds.step,fast?C.footsteps.sprintGain:C.footsteps.gain,local?null:position,C.playerRange)) this.noiseBurst(0.09,950,0.1,local?null:position,this.mixer.listener);
        previous.step=fast?C.footsteps.sprintInterval:C.footsteps.walkInterval;
      }
    } else previous.step=0;
    Object.assign(previous,{x:position.x,y:position.y,z:position.z,wet,onGround:state.onGround});
    previous.vy=state.vy??((position.y-(previous.lastY??position.y))/Math.max(dt,0.001));
    previous.lastY=position.y;
  }

  // Grunts and rumbles now and then while it sits; a chest beat when it
  // stands up, sometimes followed by a roar. Words are for Wise Monkeys.
  ancientMonkey(id, entity, snap, position) {
    if (NPC_DEFS[entity.info.npc]?.voice !== 'ancientMonkey' || !snap) return;
    const pose = snap.pose ?? 'sit', previous = this.poses.get(id);
    this.poses.set(id, pose);
    if (this.mixer.spatial(position, C.monkeyRange).volume <= 0) return;
    const play = (sounds, gain) => this.mixer.play(sounds, gain, position, C.monkeyRange, C.monkeyRate);
    if (previous && previous !== 'stand' && pose === 'stand') {
      play(MONKEY_SOUNDS.chestBeat, C.monkeyBeatGain);
      if (Math.random() < C.monkeyRoarChance) this.roars.set(id, this.time + 1.6);
    }
    if (this.roars.has(id) && this.time >= this.roars.get(id)) {
      this.roars.delete(id);
      play(MONKEY_SOUNDS.roar, C.monkeyRoarGain);
    }
    if (pose !== 'sit') return;
    if (!this.mobCalls.has(id)) this.mobCalls.set(id, this.time + 3 + Math.random() * 6);
    if (this.time >= this.mobCalls.get(id)) {
      play(Math.random() < 0.7 ? MONKEY_SOUNDS.grunt : MONKEY_SOUNDS.rumble, C.monkeyGain);
      this.mobCalls.set(id, this.time + C.monkeyCallDelay[0] + Math.random() * (C.monkeyCallDelay[1] - C.monkeyCallDelay[0]));
    }
  }

  update(dt, listener, state, world, entities, sprinting, active = true) {
    if(!active||!this.mixer.active)return;
    this.time+=dt;
    this.playerMotion('self',state,state,world,dt,true,sprinting);
    const present=new Set(['self']);
    for(const [id,entity] of entities.entities) {
      present.add(id);
      const type=entity.info.type,snap=entity.snapshots.at(-1),position=entity.object.position;
      if(type===ENTITY_TYPE.PLAYER) {
        if(entity.object.visible) this.playerMotion(id,snap,position,world,dt);
        continue;
      }
      if(type===ENTITY_TYPE.VOID_EEL) {
        if(snap?.coiling&&!this.firing.has(id)) {
          this.noiseBurst(0.8,3200,0.18,position,listener);
          this.tone(650,210,0.9,0.08,position,listener,'sine');
        }
        if(snap?.coiling)this.firing.add(id);else this.firing.delete(id);
        continue;
      }
      if(type===ENTITY_TYPE.NPC) {
        this.ancientMonkey(id,entity,snap,position);
        continue;
      }
      const sounds=MOB_SOUNDS[type];
      if(!sounds)continue;
      const dragon=type===ENTITY_TYPE.DRAGON,range=dragon?C.dragonRange:C.cowRange;
      if(this.mixer.spatial(position,range).volume<=0)continue;
      if(sounds.idle) {
        if(!this.mobCalls.has(id))this.mobCalls.set(id,this.time+2+Math.random()*4);
        if(this.time>=this.mobCalls.get(id)) {
          if(!this.mixer.play(sounds.idle,C.cowGain,position,range))this.tone(170,105,0.6,0.09,position,listener);
          this.mobCalls.set(id,this.time+C.mobCallDelay[0]+Math.random()*(C.mobCallDelay[1]-C.mobCallDelay[0]));
        }
      }
      if(dragon) {
        if(!snap?.walking&&this.time>=(this.wings.get(id)??0)) {
          this.mixer.play(sounds.wing,C.wingGain,position,range);
          this.wings.set(id,this.time+C.wingInterval);
        }
        if(snap?.breathing&&!this.firing.has(id)) {
          this.mixer.play(sounds.attack,C.dragonGain,position,range);
          this.noiseBurst(0.75,2600,0.18,position,listener);
        }
        if(snap?.breathing)this.firing.add(id);else this.firing.delete(id);
      }
    }
    for(const map of [this.motion,this.mobCalls,this.wings,this.poses,this.roars])for(const id of map.keys())if(!present.has(id))map.delete(id);
    for(const id of this.firing)if(!present.has(id))this.firing.delete(id);
  }
}
