// Discrete drag/gravity solver matching Arrow.step, including vertical shots.
import { TICK_RATE, ARROW_DRAG, ARROW_GRAVITY } from './config.js';
import { raycastBlock } from './raycast.js';
import { isSolid } from './blocks.js';
export function ballisticAim(from,to,speed,{gravity=ARROW_GRAVITY,drag=ARROW_DRAG,maxSeconds=8}={}) {
  const dt=1/TICK_RATE,dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
  const samples=[{a:0,b:0}];let decay=1,fall=0,a=0,b=0;
  for(let i=1;i<=Math.ceil(maxSeconds*TICK_RATE);i++) {
    decay*=drag;fall=fall*drag+gravity*dt;a+=decay*dt;b+=fall*dt;samples.push({a,b});
  }
  const at=t=> {
    const i=Math.floor(t),f=t-i,p=samples[i],q=samples[Math.min(i+1,samples.length-1)];
    const aa=p.a+(q.a-p.a)*f,bb=p.b+(q.b-p.b)*f;
    return {vx:dx/aa,vy:(dy+bb)/aa,vz:dz/aa};
  };
  const excess=t=>{const v=at(t);return Math.hypot(v.vx,v.vy,v.vz)-speed;};
  let previous=0.0001;
  for(let i=1;i<samples.length;i++) {
    if(excess(i)<=0) {
      let lo=previous,hi=i;
      for(let n=0;n<28;n++){const m=(lo+hi)/2;if(excess(m)>0)lo=m;else hi=m;}
      const time=(lo+hi)/2,v=at(time);
      return {from:{...from},...v,pitch:Math.atan2(v.vy,Math.hypot(v.vx,v.vz)),yaw:Math.atan2(v.vz,v.vx),
        speed,gravity,drag,time:time*dt};
    }
    previous=i;
  }
  return null;
}
export function ballisticClear(world,path) {
  const dt=1/TICK_RATE;let {vx,vy,vz}=path,p=path.from,remaining=path.time;
  while(remaining>1e-8) {
    vx*=path.drag;vy=vy*path.drag-path.gravity*dt;vz*=path.drag;
    const span=Math.min(dt,remaining),len=Math.hypot(vx,vy,vz)*span;
    if(len && raycastBlock(world,p,{x:vx*span/len,y:vy*span/len,z:vz*span/len},len,isSolid))return false;
    p={x:p.x+vx*span,y:p.y+vy*span,z:p.z+vz*span};remaining-=span;
  }
  return true;
}
