import * as THREE from 'three';
import { FLUID } from '/shared/config.js';
import { FLUID_FACES } from '/shared/fluidFaces.js';

const key=({x,y,z})=>`${x},${y},${z}`;
const waterMaterial=new THREE.MeshBasicMaterial({color:0x347bd4,transparent:true,opacity:0.67,depthWrite:false});
const steamMaterial=new THREE.MeshBasicMaterial({color:0xe5eef2,transparent:true,opacity:0.35,depthWrite:false});
const glassMaterial=new THREE.MeshBasicMaterial({color:0xb9e4eb,transparent:true,opacity:0.18,depthWrite:false,side:THREE.DoubleSide});
const dark=new THREE.MeshBasicMaterial({color:0x20262a});
const inputColor=new THREE.MeshBasicMaterial({color:0x5cc6ea});
const outputColor=new THREE.MeshBasicMaterial({color:0xf0b75d});
const holeGeometry=new THREE.CircleGeometry(0.15,16);
const arrowGeometry=new THREE.ConeGeometry(0.07,0.19,8);
const fillGeometry=new THREE.BoxGeometry(0.74,1,0.74);
const glassGeometry=new THREE.BoxGeometry(0.8,0.74,0.8);

export class FluidRenderer {
  constructor(scene) {this.scene=scene;this.models=new Map();this.plumes=new Map();this.time=0;}
  sync(nodes) {
    const current=new Set();
    for(const node of nodes) {
      const k=key(node);current.add(k);
      let entry=this.models.get(k);
      const modes=`${node.kind}|${node.faces?.join(',')??''}`;
      if(entry?.modes!==modes) {
        if(entry)this.scene.remove(entry.group);
        const group=new THREE.Group();group.position.set(node.x+0.5,node.y+0.5,node.z+0.5);
        if(node.faces)node.faces.forEach((mode,i)=>{
          if(mode===FLUID.faceNone)return;
          const normal=new THREE.Vector3(...FLUID_FACES[i]);
          const face=new THREE.Group();face.position.copy(normal).multiplyScalar(0.505);
          face.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
          const hole=new THREE.Mesh(holeGeometry,dark);face.add(hole);
          const arrow=new THREE.Mesh(arrowGeometry,mode===FLUID.faceInput?inputColor:outputColor);
          arrow.rotation.x=mode===FLUID.faceInput?-Math.PI/2:Math.PI/2;
          arrow.position.z=mode===FLUID.faceInput?0.065:0.12;
          face.add(arrow);group.add(face);
        });
        entry={group,modes,fill:null};this.models.set(k,entry);this.scene.add(group);
      }
      if(node.kind==='tank') {
        if(!entry.glass){entry.glass=new THREE.Mesh(glassGeometry,glassMaterial);entry.group.add(entry.glass);}
        if(!entry.fill){entry.fill=new THREE.Mesh(fillGeometry,waterMaterial);entry.group.add(entry.fill);}
        entry.fill.visible=!!node.fluid&&node.fill>0;
        entry.fill.material=node.fluid==='steam'?steamMaterial:waterMaterial;
        entry.fill.scale.y=Math.max(0.001,(node.fill??0)*0.74);
        entry.fill.position.y=-0.37+entry.fill.scale.y/2;
      }
    }
    for(const [k,entry] of this.models)if(!current.has(k)){this.scene.remove(entry.group);this.models.delete(k);}
  }
  setBoilerLit(x,y,z,lit) {
    const k=key({x,y,z});
    if(!lit){const old=this.plumes.get(k);if(old){this.scene.remove(old);this.plumes.delete(k);}return;}
    if(this.plumes.has(k))return;
    const group=new THREE.Group();group.position.set(x+0.5,y+1.3,z+0.5);
    const geometry=new THREE.SphereGeometry(0.32,8,6);
    for(let i=0;i<7;i++) {
      const puff=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xecf4f7,transparent:true,opacity:0.35,depthWrite:false,fog:false}));
      puff.userData.phase=i/7;group.add(puff);
    }
    this.scene.add(group);this.plumes.set(k,group);
  }
  update(dt) {
    this.time+=dt;
    for(const group of this.plumes.values())group.children.forEach((puff,i)=>{
      const t=(this.time*0.28+puff.userData.phase)%1;
      puff.position.set(Math.sin(this.time*0.8+i)*t*0.18,t*3,Math.cos(this.time*0.6+i)*t*0.18);
      puff.scale.setScalar(0.65+t*2.5);puff.material.opacity=(1-t)*0.36;
    });
  }
  dispose(){for(const entry of this.models.values())this.scene.remove(entry.group);
    for(const plume of this.plumes.values()){this.scene.remove(plume);for(const puff of plume.children)puff.material.dispose();}
    this.models.clear();this.plumes.clear();}
}
