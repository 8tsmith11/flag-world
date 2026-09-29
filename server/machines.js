// Server-owned fluid machine inventories. The pipe graph supplies fluids;
// machine subclasses define their demand, output and work cycle.
import { FLUID, TICK_RATE } from '../shared/config.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM } from '../shared/itemIds.js';
import { CRUSHING } from '../shared/recipes.js';
import { clickSlot, maxStack } from './inventory.js';
import { mergeInto } from './containers.js';

const boilerFuel = { [ITEM.CHARCOAL]: FLUID.boilerFuelSeconds.charcoal,
  [BLOCK.WOOD]: FLUID.boilerFuelSeconds.wood };

export class MachineBase {
  constructor(kind, slots, rules) {
    this.kind = kind;
    this.slots = Array(slots).fill(null);
    this.rules = rules;
    this.dirty = true;
  }
  click(slot, button, holder) { return clickSlot(this.slots, slot, holder, button, this.rules[slot]); }
  insert(stack) {
    for (let i = 0; i < this.rules.length; i++) {
      if (this.rules[i].takeOnly || !this.rules[i].accepts(stack.item)) continue;
      if (mergeInto(this.slots, i, stack)) return true;
    }
    return false;
  }
  takeAll() { const stacks = this.slots.filter(Boolean);this.slots.fill(null);return stacks; }
  tick() { return false; }
  view() { return { kind: this.kind, slots: this.slots }; }
}

export class FluidTank extends MachineBase {
  constructor() { super('tank', 0, []); }
  view() {
    const group=this.fluidNode?.tank;
    return { ...super.view(), fluid: group?.fluid ?? null, amount: group?.amount ?? 0,
      capacity: group?.capacity ?? FLUID.tankCapacity };
  }
}

export class Boiler extends MachineBase {
  constructor() {
    super('boiler', 1, [{ accepts: item => item in boilerFuel }]);
    this.water = 0; this.steam = 0; this.burn = 0; this.burnTotal = 0; this.lit = false;
  }
  demand(fluid) { return fluid === 'water' ? Math.min(FLUID.boilerPerSecond / TICK_RATE,
    FLUID.boilerWaterBuffer - this.water) : 0; }
  accept(fluid, amount) { if (fluid === 'water' && amount > 0) { this.water += amount;this.dirty = true; } }
  output(fluid, limit) {
    if (fluid !== 'steam') return 0;
    const n=Math.min(limit,this.steam);
    if(n>0){this.steam-=n;this.dirty=true;}
    return n;
  }
  tick(canOutput = false) {
    const before=this.burn;
    const step=FLUID.boilerPerSecond/TICK_RATE;
    if(!canOutput||this.water+1e-9<step||this.steam+step>FLUID.boilerSteamBuffer){this.lit=false;return false;}
    if(this.burn<=0) {
      const fuel=this.slots[0];
      if(!fuel){this.lit=false;return false;}
      this.burnTotal=this.burn=Math.round(boilerFuel[fuel.item]*TICK_RATE);
      if(--fuel.count===0)this.slots[0]=null;
    }
    this.water-=step;this.steam+=step;this.burn--;
    this.lit=true;
    this.dirty=true;
    return this.burn!==before;
  }
  view() { return { ...super.view(), burn:this.burnTotal?this.burn/this.burnTotal:0,
    water:this.water, steam:this.steam, waterCapacity:FLUID.boilerWaterBuffer,
    steamCapacity:FLUID.boilerSteamBuffer };
  }
}

export class Crusher extends MachineBase {
  constructor() {
    super('crusher', 2, [{ accepts: item => item in CRUSHING }, { takeOnly:true }]);
    this.progress=0;this.received=0;this.lastReceived=0;
  }
  recipe() { return CRUSHING[this.slots[0]?.item] ?? null; }
  canWork() {
    const r=this.recipe(),out=this.slots[1];
    return !!r && (!out || (out.item===r.item && out.count+r.count<=maxStack(r.item)));
  }
  demand(fluid) { return fluid==='steam'&&this.canWork()?FLUID.crusherPerSecond/TICK_RATE:0; }
  accept(fluid,amount) { if(fluid==='steam')this.received+=amount; }
  tick() {
    const before=this.progress,priorReceived=this.lastReceived;
    this.lastReceived=this.received;
    if(!this.canWork()){this.received=0;this.progress=0;
      this.dirty ||= before!==0||priorReceived!==this.lastReceived;return this.dirty;}
    this.progress+=this.received/(FLUID.crusherPerSecond/TICK_RATE)
      /(FLUID.crusherSeconds*TICK_RATE);
    this.received=0;
    if(this.progress>=1-1e-9) {
      this.progress=0;
      const input=this.slots[0],r=this.recipe();
      if(--input.count===0)this.slots[0]=null;
      if(this.slots[1])this.slots[1].count+=r.count;
      else this.slots[1]={item:r.item,count:r.count};
    }
    this.dirty ||= this.progress!==before||priorReceived!==this.lastReceived;
    return this.dirty;
  }
  view() { return { ...super.view(), progress:this.progress, steamReceived:this.lastReceived*TICK_RATE }; }
}
