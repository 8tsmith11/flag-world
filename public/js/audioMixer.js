import { AUDIO as C } from '/shared/config.js';
import { isWater, isFlowingWater } from '/shared/blocks.js';
import { AMBIENT_SOUNDS, MATERIAL_SOUNDS, EFFECT_SOUNDS, MOB_SOUNDS, MONKEY_SOUNDS, STORM_SOUNDS } from '/shared/audio.js';
const choose = list => list[Math.floor(Math.random() * list.length)];
const between = ([lo,hi]) => lo + Math.random() * (hi-lo);

export class AudioMixer {
  constructor(settings) {
    this.context = null; this.settings = settings; this.buffers = new Map();
    this.loading = new Map(); this.queue = []; this.fetching = 0; this.voices = new Set(); this.positionalVoices = new Map();
    this.loops = new Map(); this.bursts = new Map(); this.active = false;
    this.listener = null; this.yaw = 0;
    this.generation = 0;
    settings.subscribe(volumes => {
      if (!this.context) return;
      for (const channel of Object.keys(C.volumes)) this.buses[channel].gain.setTargetAtTime(volumes[channel], this.context.currentTime, 0.03);
    });
  }
  unlock() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!this.context) {
      this.context = new Context(); this.buses = {};
      for (const channel of Object.keys(C.volumes)) {
        this.buses[channel] = this.context.createGain();
        this.buses[channel].gain.value = this.settings.volumes[channel];
      }
      this.buses.master.connect(this.context.destination);
      // The voice bus only carries the volume; speech synthesis plays outside Web Audio.
      for (const channel of Object.keys(C.volumes)) if (channel !== 'master') this.buses[channel].connect(this.buses.master);
    }
    this.context.resume().catch(() => {});
    this.pump();
  }
  load(path) {
    if (this.buffers.has(path)) return Promise.resolve(this.buffers.get(path));
    if (!this.loading.has(path)) {
      this.loading.set(path, new Promise(resolve => this.queue.push({path,resolve})));
      this.pump();
    }
    return this.loading.get(path);
  }
  pump() {
    if (!this.context) return;
    while (this.fetching < C.decodeConcurrency && this.queue.length) {
      const {path,resolve} = this.queue.shift(); this.fetching++;
      fetch(path).then(response => {
        if (!response.ok) throw new Error(path);
        return response.arrayBuffer();
      }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
        this.buffers.set(path, buffer); resolve(buffer);
      }).catch(() => { this.buffers.set(path,null); resolve(null); })
        .finally(() => { this.fetching--; this.pump(); });
    }
  }
  spatial(position, range) {
    if (!position || !this.listener) return {volume:1,pan:0};
    const dx = position.x-this.listener.x, dy = position.y-this.listener.y, dz = position.z-this.listener.z;
    const distance = Math.hypot(dx,dy,dz);
    const pan = (dx*Math.cos(this.yaw)-dz*Math.sin(this.yaw))/Math.max(1,Math.hypot(dx,dz));
    return {volume: Math.max(0,1-distance/range)**2, pan: Math.max(-1,Math.min(1,pan))};
  }
  play(paths, gain, position, range = C.effectsRange, rate = 1) {
    if (!this.context || this.context.state !== 'running' || !this.active) return false;
    const {volume,pan} = this.spatial(position,range);
    if (volume*gain <= 0.001 || this.voices.size >= C.maxVoices-Object.keys(AMBIENT_SOUNDS).length) return true;
    const path = choose(paths), buffer = this.buffers.get(path);
    if (!buffer) { this.load(path); return false; }
    const source = this.context.createBufferSource(), level = this.context.createGain(), panner = this.context.createStereoPanner();
    source.buffer = buffer; source.playbackRate.value = rate * (1+(Math.random()*2-1)*C.pitchVariation);
    level.gain.value = gain*volume; panner.pan.value = pan;
    source.connect(level).connect(panner).connect(this.buses.effects);
    this.voices.add(source);
    if (position) this.positionalVoices.set(source,{position,range,gain,level,panner});
    source.onended = () => { this.voices.delete(source); this.positionalVoices.delete(source); source.disconnect(); level.disconnect(); panner.disconnect(); };
    source.start(); return true;
  }
  // Procedural legacy effects share the same cap, falloff, pan and volume bus.
  output(source, position, gain, range = C.effectsRange, input = source) {
    if (!this.active || this.voices.size >= C.maxVoices-Object.keys(AMBIENT_SOUNDS).length) return null;
    const spatial = this.spatial(position,range);
    if (gain*spatial.volume <= 0.001) return null;
    const level = this.context.createGain(), pan = this.context.createStereoPanner();
    level.gain.value = gain*spatial.volume; pan.pan.value = spatial.pan;
    input.connect(level).connect(pan).connect(this.buses.effects);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); level.disconnect(); pan.disconnect(); };
    return level;
  }
  start(world) {
    this.active = true; this.world = world;
    // Decode small effects ahead of the first hit or death.
    for (const registry of [MATERIAL_SOUNDS, MOB_SOUNDS]) for (const definition of Object.values(registry)) {
      for (const paths of Object.values(definition)) for (const path of paths) this.load(path);
    }
    for (const registry of [EFFECT_SOUNDS, MONKEY_SOUNDS, STORM_SOUNDS]) for (const paths of Object.values(registry)) for (const path of paths) this.load(path);
    const lakeColumns = new Set((world.lakes ?? []).flatMap(lake =>
      (lake.cells ?? []).map(p => p.x + world.sizeX * p.z)));
    this.riverColumns = new Set();
    for (const river of world.rivers ?? []) for (const p of river.cells ?? []) {
      const column = p.x + world.sizeX * p.z;
      if (!lakeColumns.has(column)) this.riverColumns.add(column);
    }
    this.waterfalls = [];
    for (const river of world.rivers ?? []) {
      for (let i=1;i<river.points.length;i++) {
        const a=river.points[i-1],b=river.points[i];
        if (a.waterY-b.waterY >= C.waterfallDrop) this.waterfalls.push({ x:Math.round(b.x),
          y:b.waterY,z:Math.round(b.z), sourceY:b.waterY });
      }
      // A through-island river has a falling sheet at both cliff exits.
      for(const end of river.waterfalls??(river.end?[river.end]:[])) {
        this.waterfalls.push({x:Math.round(end.x),y:end.y,z:Math.round(end.z),sourceY:end.y});
      }
    }
    this.fortressBoxes = world.structures.filter(s => s.civilization === 'goblin'
      && ['hall','trapCorridor','shaft','ladderShaft','midRoom','totemHall','kingsRoom','barracks','storeroom',
        'mushroomFarm','forge','shrine','prison','trophyHall','treasureVault','guardroom','messHall','quarters','junction'].includes(s.kind)).map(s => s.box);
  }
  stop() {
    this.active = false; this.generation++;
    for (const loop of this.loops.values()) { loop.source?.stop(); loop.level?.disconnect(); loop.pan?.disconnect(); }
    this.loops.clear();
    this.bursts.clear();
    for (const source of this.voices) source.stop();
  }
  loop(name, gain, position, range) {
    if (!this.context) return;
    const burst = C.ambienceBursts[name];
    if (burst) {
      if (gain <= 0) this.bursts.delete(name);
      else {
        const now = this.context.currentTime;
        let timing = this.bursts.get(name);
        if (!timing || now >= timing.start + timing.duration) {
          timing = { start: now + between(burst.silence), duration: between(burst.play) };
          this.bursts.set(name, timing);
        }
        const elapsed = now - timing.start;
        const edge = Math.max(0, Math.min(1, elapsed / burst.fade, (timing.duration - elapsed) / burst.fade));
        gain *= edge * edge * (3 - 2 * edge);
      }
    }
    let loop = this.loops.get(name);
    if (!loop && gain > 0.001) {
      loop = {pending:true}; this.loops.set(name,loop);
      const generation = this.generation;
      this.load(AMBIENT_SOUNDS[name]).then(buffer => {
        if (!buffer || !this.active || generation !== this.generation) { if(this.loops.get(name)===loop)this.loops.delete(name); return; }
        const source=this.context.createBufferSource(), level=this.context.createGain(), pan=this.context.createStereoPanner();
        source.buffer=buffer; source.loop=true; level.gain.value=0;
        source.connect(level).connect(pan).connect(this.buses.ambience);
        Object.assign(loop,{source,level,pan,pending:false}); source.start();
      });
    }
    if (!loop?.level) return;
    const spatial = this.spatial(position,range);
    loop.level.gain.setTargetAtTime(gain*spatial.volume,this.context.currentTime,C.ambienceFade/3);
    loop.pan.pan.setTargetAtTime(spatial.pan,this.context.currentTime,C.ambienceFade/3);
  }
  update(dt, listener, yaw, time) {
    this.listener=listener; this.yaw=yaw;
    if (!this.active || !this.context || this.context.state !== 'running') return;
    const now=this.context.currentTime;
    for (const voice of this.positionalVoices.values()) {
      const spatial=this.spatial(voice.position,voice.range);
      voice.level.gain.setTargetAtTime(voice.gain*spatial.volume,now,0.03);
      voice.panner.pan.setTargetAtTime(spatial.pan,now,0.03);
    }
    const period=time>=C.nightStart && time<C.nightEnd ? 'night':'day';
    this.ambientTimer=(this.ambientTimer??0)-dt;
    if(this.ambientTimer>0)return;
    this.ambientTimer=C.ambienceInterval;
    const world=this.world, x=Math.floor(listener.x), y=Math.floor(listener.y), z=Math.floor(listener.z);
    const top=world.naturalTop[x+world.sizeX*z];
    const outside=top===undefined || top===-32768 || y>=top;
    const fortress=this.fortressBoxes.some(b=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1&&z>=b.z0&&z<=b.z1);
    this.loop('wind', outside ? C.windBase+C.windGain*Math.max(0,Math.min(1,(y-(top??0))/C.windHeight)):0);
    this.loop('birds', outside&&period==='day'&&world.biomeAt(x,z)==='forest'?C.birdsGain:0);
    this.loop('crickets', outside&&period==='night'?C.cricketsGain:0);
    this.loop('fortress', fortress?C.fortressGain:0);
    const water=this.nearWater(listener);
    this.loop('river',water.river?C.waterGain:0,water.river,C.waterRange);
    this.loop('waterfall',water.waterfall?C.waterfallGain:0,water.waterfall,C.waterfallRange);
  }
  nearWater(listener) {
    const world=this.world, result={river:null,waterfall:null}, distances={river:Infinity,waterfall:Infinity};
    const x=Math.floor(listener.x), y=Math.floor(listener.y), z=Math.floor(listener.z);
    // River noise requires water still present in a generated river reach.
    // Lake footprints and unrelated placed water never trigger that loop.
    for(let dx=-C.waterScanRadius;dx<=C.waterScanRadius;dx+=C.waterScanStride)
      for(let dz=-C.waterScanRadius;dz<=C.waterScanRadius;dz+=C.waterScanStride)
        for(let dy=-C.waterScanHeight;dy<=C.waterScanHeight;dy++) {
          if(!isWater(world.getBlock(x+dx,y+dy,z+dz)))continue;
          const position={x:x+dx+0.5,y:y+dy+0.5,z:z+dz+0.5};
          const distance=Math.hypot(dx,dy,dz);
          const kind=isWater(world.getBlock(x+dx,y+dy-C.waterfallDrop,z+dz))
            && isFlowingWater(world.getBlock(x+dx,y+dy-1,z+dz)) ? 'waterfall':'river';
          if (kind === 'river' && !this.riverColumns.has(x+dx+world.sizeX*(z+dz))) continue;
          if(distance<distances[kind]){distances[kind]=distance;result[kind]=position;}
        }
    // Waterfall paths expose their continuous drops even when all falling cells
    // are water, rather than air. Use their compact generated centerline.
    for (const p of this.waterfalls) {
      const d=Math.hypot(p.x-listener.x,p.y-listener.y,p.z-listener.z);
      if(d<distances.waterfall && isWater(world.getBlock(p.x,p.sourceY,p.z))
        && isFlowingWater(world.getBlock(p.x,p.sourceY-C.waterfallDrop,p.z))) {
        distances.waterfall=d;result.waterfall=p;
      }
    }
    return result;
  }
}
