import * as THREE from 'three';
import { GOBLINS } from '/shared/goblins.js';

const material = (color) => new THREE.MeshLambertMaterial({color});
function box(g,w,h,d,x,y,z,color) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));
  mesh.position.set(x,y,z);g.add(mesh);return mesh;
}
function head(g,x,y,z) {
  box(g,0.4,0.35,0.4,x,y,z,0x5f8a33);
  box(g,0.1,0.1,0.16,x,y-0.03,z-0.22,0x5f8a33);
  for (const side of [-1,1]) {
    box(g,0.08,0.06,0.02,x+side*0.1,y+0.06,z-0.21,0xf2d34a);
    const ear=box(g,0.3,0.1,0.1,x+side*0.3,y+0.08,z,0x5f8a33);
    ear.rotation.z=side*0.25;
  }
}
export function createHoundModel() {
  const g=new THREE.Group();
  box(g,0.45,0.35,0.8,0,0.45,0,0x6f9b3c);head(g,0,0.62,-0.4);
  box(g,0.3,0.16,0.32,0,0.49,-0.57,0x5f8a33);
  box(g,0.22,0.03,0.02,0,0.46,-0.74,0x1c1a14);
  const legs=[];
  for(const x of [-0.2,0.2])for(const z of [-0.28,0.28]) {
    const leg=box(g,0.1,0.32,0.14,x,0.2,z,0x5f8a33);legs.push(leg);
  }
  const tail=box(g,0.1,0.4,0.1,0,0.6,0.42,0x5f8a33);tail.rotation.x=-0.6;
  g.userData.hound={legs,phase:0};return g;
}
export function createSiegeMachine({type}) {
  const g=new THREE.Group();
  if(type==='goblinCatapult') {
    box(g,2.2,0.25,2.2,0,0.4,0,0x6b4520);
    for(const x of [-0.9,0.9]) {
      box(g,0.18,1.6,0.2,x,1.2,0,0x80552d);
      for(const z of [-0.8,0.8]) {
        const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,0.18,10),material(0x4a3220));
        wheel.rotation.z=Math.PI/2;wheel.position.set(x,0.4,z);g.add(wheel);
      }
    }
    box(g,2.1,0.12,0.12,0,1.7,0,0x7d8288);
    const arm=new THREE.Group();arm.position.y=1.7;g.add(arm);
    box(arm,0.2,0.2,2.4,0,0,0.3,0x8a6035);
    box(arm,0.65,0.2,0.65,0,0.15,1.3,0x4a3220);
    g.userData.machine={arm};g.scale.set(GOBLINS.catapult.width/2.4,GOBLINS.catapult.height/2.5,GOBLINS.catapult.width/2.4);
  } else {
    box(g,1.7,0.8,1.7,0,0.4,0,0x80552d);
    for(const x of [-0.7,0.7])for(const z of [-0.7,0.7])box(g,0.04,3,0.04,x,2,z,0xc9b58d);
    const envelope=new THREE.Mesh(new THREE.SphereGeometry(2,16,12),material(0x79903b));
    envelope.scale.y=1.3;envelope.position.y=4.3;g.add(envelope);
    for(const x of [-0.5,0.5])box(g,0.18,0.9,0.08,x,4.4,-1.9,0x403b24);
    box(g,0.8,0.2,0.08,0,3.8,-1.9,0x403b24);
    g.userData.machine={envelope};
  }
  return g;
}
export function createSiegeShot({bomb}) {
  const g=new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(bomb?GOBLINS.catapult.bombSize:GOBLINS.catapult.boulderSize,8,6),material(bomb?0x272727:0x797975)));
  if(bomb)box(g,0.06,0.13,0.06,0,GOBLINS.catapult.bombSize+0.05,0,0xf6b639);
  return g;
}
export function animateSiegeModel(model,dt,speed,snap) {
  const h=model.userData.hound;
  if(h) {
    h.phase+=dt*speed*3;
    h.legs.forEach((leg,i)=>leg.rotation.x=Math.sin(h.phase+(i===0||i===3?0:Math.PI))*Math.min(0.8,speed/5));
  }
  const m=model.userData.machine;
  if(m?.arm)m.arm.rotation.x=snap.firing?-0.8:0.35;
  if(m?.envelope)m.envelope.rotation.z=Math.sin(performance.now()/900)*0.04;
  const glide=model.userData.siegeGlider;
  if(glide)glide.visible=!!snap.gliding;
}
export function addSiegeGlider(g) {
  const wing=new THREE.Group();wing.position.y=1.6;
  const cloth=box(wing,2.6,0.04,1.2,0,0,0.2,0xb5b46e);cloth.rotation.x=-0.15;
  box(wing,2.7,0.04,0.04,0,0.04,-0.4,0x6b4520);
  wing.visible=false;g.add(wing);g.userData.siegeGlider=wing;
}
