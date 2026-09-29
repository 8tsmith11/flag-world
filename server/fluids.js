// Authoritative fluid graph. Topology is rebuilt only after edits to fluid
// blocks or ports; transfers use the cached pipe components each fixed tick.
import { BLOCK, blockBase, fluidKind } from '../shared/blocks.js';
import { FLUID, TICK_RATE } from '../shared/config.js';
import { S2C } from '../shared/protocol.js';
import { FLUID_FACES, fluidFace, oppositeFluidFace } from '../shared/fluidFaces.js';

export { FLUID_FACES, fluidFace };
const key = (x,y,z) => `${x},${y},${z}`;
const epsilon = FLUID.epsilon;

export class FluidSystem {
  constructor(game) {
    this.game=game;this.world=game.world;this.nodes=new Map();this.networks=[];this.lastSent='[]';
  }
  active(node) { return this.game.chunkLoading.has(node.x,node.z); }
  changed(x,y,z,id,oldId) {
    const next=fluidKind(id),old=fluidKind(oldId);
    if (!next && !old) return;
    const k=key(x,y,z),prev=this.nodes.get(k);
    if(next) {
      const faces=next==='pipe'?null:prev?.kind===next?prev.faces:Array(FLUID_FACES.length).fill(FLUID.faceNone);
      if(next==='pump' && !prev) faces[[4,1,5,0][blockBase(id).facing]]=FLUID.faceOutput;
      this.nodes.set(k,{x,y,z,key:k,kind:next,faces,container:prev?.container??null,tank:prev?.tank??null});
    } else this.nodes.delete(k);
    this.rebuild();this.broadcast(true);
  }
  attach(x,y,z,container) {
    const node=this.nodes.get(key(x,y,z));
    if(node){node.container=container;container.fluidNode=node;container.dirty=true;}
  }
  cycle(x,y,z,face) {
    const node=this.nodes.get(key(x,y,z));
    if(!node||node.kind==='pipe'||face<0||face>=FLUID_FACES.length)return false;
    node.faces[face]=(node.faces[face]+1)%3;
    this.rebuild();this.broadcast(true);
    return true;
  }
  rebuild() {
    // Preserve contents across splits by the fraction of old members retained.
    const oldNetworks=this.networks;
    const seen=new Set(),groups=[];
    for(const node of this.nodes.values()) {
      if(node.kind!=='tank'||seen.has(node.key))continue;
      const queue=[node],members=[];seen.add(node.key);
      while(queue.length) {
        const current=queue.pop();members.push(current);
        for(const [dx,dy,dz] of FLUID_FACES) {
          const other=this.nodes.get(key(current.x+dx,current.y+dy,current.z+dz));
          if(other?.kind==='tank'&&!seen.has(other.key)){seen.add(other.key);queue.push(other);}
        }
      }
      const candidates=new Map();
      for(const member of members)if(member.tank) {
        const former=member.tank;
        const share=former.amount/former.members.length;
        const entry=candidates.get(former.fluid)??0;
        candidates.set(former.fluid,entry+share);
      }
      candidates.delete(null);
      const [fluid,amount]=[...candidates].sort((a,b)=>b[1]-a[1])[0]??[null,0];
      const group={members,fluid,amount,capacity:members.length*FLUID.tankCapacity};
      for(const member of members){member.tank=group;if(member.container)member.container.dirty=true;}
      groups.push(group);
    }
    this.tanks=groups;

    const networks=[];seen.clear();
    for(const node of this.nodes.values()) {
      if(node.kind!=='pipe'||seen.has(node.key))continue;
      const queue=[node],pipes=[];seen.add(node.key);
      while(queue.length) {
        const current=queue.pop();pipes.push(current);
        for(const [dx,dy,dz] of FLUID_FACES) {
          const other=this.nodes.get(key(current.x+dx,current.y+dy,current.z+dz));
          if(other?.kind==='pipe'&&!seen.has(other.key)){seen.add(other.key);queue.push(other);}
        }
      }
      const candidates=new Map();
      for(const old of oldNetworks) {
        const overlap=pipes.filter(p=>old.pipeKeys.has(p.key)).length;
        if(overlap&&old.fluid)candidates.set(old.fluid,(candidates.get(old.fluid)??0)+old.amount*overlap/old.pipeKeys.size);
      }
      const [fluid,amount]=[...candidates].sort((a,b)=>b[1]-a[1])[0]??[null,0];
      const network={pipes,pipeKeys:new Set(pipes.map(p=>p.key)),capacity:pipes.length*FLUID.pipeCapacity,
        fluid,amount,ports:[]};
      for(const pipe of pipes)for(let face=0;face<FLUID_FACES.length;face++) {
        const [dx,dy,dz]=FLUID_FACES[face];
        const other=this.nodes.get(key(pipe.x+dx,pipe.y+dy,pipe.z+dz));
        if(!other||other.kind==='pipe')continue;
        const port=other.faces[oppositeFluidFace(face)];
        if(port!==FLUID.faceNone)network.ports.push({node:other,mode:port,face:oppositeFluidFace(face)});
      }
      // A tank may have many faces on one network, but never pumps through itself.
      network.ports=network.ports.filter(port=>port.node.kind!=='tank'||
        !network.ports.some(other=>other.node.kind==='tank'&&other.node.tank===port.node.tank&&other.mode!==port.mode));
      networks.push(network);
    }
    this.networks=networks;
  }
  pumpReady(node,outputFace) {
    return FLUID_FACES.some(([dx,dy,dz],face)=>face!==outputFace
      && this.world.getBlock(node.x+dx,node.y+dy,node.z+dz)===BLOCK.WATER);
  }
  output(port,fluid,space) {
    const {node}=port;
    if(node.kind==='pump') {
      if(fluid&&fluid!=='water'||!this.pumpReady(node,port.face))return null;
      const amount=Math.min(space,this.outputBudget.get(node)??0);
      this.outputBudget.set(node,(this.outputBudget.get(node)??0)-amount);
      return {fluid:'water',amount};
    }
    if(node.kind==='tank') {
      const tank=node.tank;
      if(!tank?.fluid||fluid&&fluid!==tank.fluid)return null;
      const sourceFluid=tank.fluid;
      const amount=Math.min(space,tank.amount,FLUID.transferPerSecond/TICK_RATE);
      if(amount>0){tank.amount-=amount;if(tank.amount<epsilon){tank.amount=0;tank.fluid=null;}
        for(const member of tank.members)if(member.container)member.container.dirty=true;}
      return {fluid:sourceFluid,amount};
    }
    if(node.kind==='boiler'&&(!fluid||fluid==='steam')) {
      const amount=node.container?.output('steam',Math.min(space,this.outputBudget.get(node)??0))??0;
      this.outputBudget.set(node,(this.outputBudget.get(node)??0)-amount);
      return {fluid:'steam',amount};
    }
    return null;
  }
  demand(port,fluid) {
    const {node}=port;
    if(node.kind==='tank')return !node.tank.fluid||node.tank.fluid===fluid
      ? Math.min(FLUID.transferPerSecond/TICK_RATE,node.tank.capacity-node.tank.amount):0;
    return Math.min(node.container?.demand?.(fluid)??0,this.inputBudget.get(node)??0);
  }
  receive(port,fluid,amount) {
    if(amount<=0)return;
    const {node}=port;
    if(node.kind==='tank') {
      node.tank.fluid=fluid;node.tank.amount+=amount;
      for(const member of node.tank.members)if(member.container)member.container.dirty=true;
    } else {node.container?.accept?.(fluid,amount);
      this.inputBudget.set(node,(this.inputBudget.get(node)??0)-amount);}
  }
  tick(tick) {
    this.outputBudget=new Map();this.inputBudget=new Map();
    for(const node of this.nodes.values()) {
      if(node.kind==='pump')this.outputBudget.set(node,FLUID.pumpPerSecond/TICK_RATE);
      if(node.kind==='boiler') {
        this.outputBudget.set(node,FLUID.boilerPerSecond/TICK_RATE);
        this.inputBudget.set(node,FLUID.boilerPerSecond/TICK_RATE);
      }
      if(node.kind==='crusher')this.inputBudget.set(node,FLUID.crusherPerSecond/TICK_RATE);
    }
    for(const network of this.networks) {
      if(!network.pipes.every(p=>this.active(p)))continue;
      const ports=network.ports.filter(p=>this.active(p.node));
      for(const port of ports) {
        if(port.mode!==FLUID.faceOutput)continue;
        const free=network.capacity-network.amount;
        if(free<=epsilon)break;
        const result=this.output(port,network.fluid,free);
        if(result?.amount>0){network.fluid=result.fluid;network.amount+=result.amount;}
      }
      if(!network.fluid||network.amount<=epsilon)continue;
      const inputPorts=ports.filter(p=>p.mode===FLUID.faceInput);
      const inputs=inputPorts.map(port=>({port,
        wanted:this.demand(port,network.fluid)/inputPorts.filter(other=>
          (other.node.kind==='tank'?other.node.tank:other.node)===
          (port.node.kind==='tank'?port.node.tank:port.node)).length})).filter(entry=>entry.wanted>epsilon);
      const total=inputs.reduce((sum,p)=>sum+p.wanted,0);
      const fraction=Math.min(1,network.amount/total);
      for(const {port,wanted} of inputs) {
        const amount=wanted*fraction;
        this.receive(port,network.fluid,amount);network.amount-=amount;
      }
      if(network.amount<epsilon){network.amount=0;network.fluid=null;}
    }
    for(const node of this.nodes.values()) {
      if(!this.active(node)||!node.container)continue;
      if(node.kind==='boiler') {
        const boiler=node.container,wasLit=boiler.lit;
        const canOutput=this.networks.some(n=>n.ports.some(p=>p.node===node&&p.mode===FLUID.faceOutput)
          && n.pipes.every(p=>this.active(p)) && (!n.fluid||n.fluid==='steam')
          && n.capacity-n.amount>epsilon);
        boiler.tick(canOutput);
        if(wasLit!==boiler.lit)this.game.broadcast({type:S2C.BOILER_LIT,x:node.x,y:node.y,z:node.z,lit:boiler.lit});
      } else if(node.kind==='crusher')node.container.tick();
    }
    if(tick%FLUID.networkSendTicks===0)this.broadcast();
  }
  snapshot() {
    return [...this.nodes.values()].map(node=>({x:node.x,y:node.y,z:node.z,kind:node.kind,
      faces:node.faces,fluid:node.kind==='tank'?node.tank?.fluid??null:null,
      amount:node.kind==='tank'?node.tank?.amount??0:0,
      capacity:node.kind==='tank'?node.tank?.capacity??FLUID.tankCapacity:0,
      fill:node.kind==='tank'?this.tankFill(node):0}));
  }
  tankFill(node) {
    const group=node.tank;if(!group?.amount)return 0;
    const lower=group.members.filter(m=>m.y<node.y).length;
    const same=group.members.filter(m=>m.y===node.y).length;
    return Math.max(0,Math.min(1,(group.amount-lower*FLUID.tankCapacity)/(same*FLUID.tankCapacity)));
  }
  broadcast(force=false){const nodes=this.snapshot(),encoded=JSON.stringify(nodes);
    if(!force&&encoded===this.lastSent)return;
    this.lastSent=encoded;this.game.broadcast({type:S2C.FLUID_STATE,nodes});}
}
