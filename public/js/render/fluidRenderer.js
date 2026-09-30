import * as THREE from 'three';
import { FLUID } from '/shared/config.js';
import { FLUID_FACES } from '/shared/fluidFaces.js';
import { tankExteriorFaces } from '/shared/fluidModels.js';

const key=({x,y,z})=>`${x},${y},${z}`;
const waterMaterial=new THREE.MeshBasicMaterial({color:0x347bd4,transparent:true,opacity:0.67,depthWrite:false,side:THREE.DoubleSide});
const steamMaterial=new THREE.MeshBasicMaterial({color:0xe5eef2,transparent:true,opacity:0.35,depthWrite:false,side:THREE.DoubleSide});
const glassMaterial=new THREE.MeshBasicMaterial({color:0xb9e4eb,transparent:true,opacity:0.26,depthWrite:false,side:THREE.DoubleSide});
const dark=new THREE.MeshBasicMaterial({color:0x20262a});
const inputColor=new THREE.MeshBasicMaterial({color:0x5cc6ea});
const outputColor=new THREE.MeshBasicMaterial({color:0xf0b75d});
const holeGeometry=new THREE.CircleGeometry(0.15,16);
const arrowGeometry=new THREE.ConeGeometry(0.07,0.19,8);

function removePlume(scene,group) {
  scene.remove(group);
  group.children[0]?.geometry.dispose();
  for(const puff of group.children)puff.material.dispose();
}

function addFace(vertices,indices,face,x0,y0,z0,x1,y1,z1) {
  const corners=face===0?[[x0,y0,z0],[x0,y1,z0],[x0,y0,z1],[x0,y1,z1]]
    :face===1?[[x1,y0,z0],[x1,y1,z0],[x1,y0,z1],[x1,y1,z1]]
      :face===2?[[x0,y0,z0],[x1,y0,z0],[x0,y0,z1],[x1,y0,z1]]
        :face===3?[[x0,y1,z0],[x1,y1,z0],[x0,y1,z1],[x1,y1,z1]]
          :face===4?[[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0]]
            :[[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
  const base=vertices.length/3;
  for(const corner of corners)vertices.push(...corner);
  indices.push(base,base+1,base+2,base+2,base+1,base+3);
}

function tankSurface(nodes,fluid=null) {
  const vertices=[],indices=[];
  for(const {node,face} of tankExteriorFaces(nodes,fluid)) {
    const {x,y,z}=node;
    const top=y+(fluid?Math.min(1,node.fill):1);
    const [dx,dy,dz]=FLUID_FACES[face];
    // One exterior panel per exposed face; no overlapping boxes between
    // connected tanks. The glass lies just outside the fluid surface.
    const inset=fluid?0.035:0.008;
    const x0=x+(dx<0?inset:0),x1=x+1-(dx>0?inset:0);
    const z0=z+(dz<0?inset:0),z1=z+1-(dz>0?inset:0);
    const bottom=fluid?y:face===2?y-inset:y;
    const surfaceTop=fluid?top:face===3?y+1+inset:y+1;
    addFace(vertices,indices,face,x0,bottom,z0,x1,surfaceTop,z1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  return geometry;
}

export class FluidRenderer {
  constructor(scene) {this.scene=scene;this.models=new Map();this.plumes=new Map();this.time=0;
    this.tankMeshes=[];this.tankShape='';this.tankContents='';}
  sync(nodes) {
    const current=new Set();
    const lookup=new Map(nodes.map(node=>[key(node),node]));
    for(const node of nodes) {
      if(node.kind==='pipe')continue;
      const k=key(node);current.add(k);
      let entry=this.models.get(k);
      const neighbours=node.kind==='tank'?FLUID_FACES.map(([dx,dy,dz])=>
        lookup.get(`${node.x+dx},${node.y+dy},${node.z+dz}`)?.kind==='tank'?1:0).join(''):'';
      const modes=`${node.kind}|${node.faces?.join(',')??''}|${neighbours}`;
      if(entry?.modes!==modes) {
        if(entry)this.scene.remove(entry.group);
        const group=new THREE.Group();group.position.set(node.x+0.5,node.y+0.5,node.z+0.5);
        if(node.faces)node.faces.forEach((mode,i)=>{
          if(mode===FLUID.faceNone)return;
          const [dx,dy,dz]=FLUID_FACES[i];
          if(node.kind==='tank'&&lookup.get(`${node.x+dx},${node.y+dy},${node.z+dz}`)?.kind==='tank')return;
          const normal=new THREE.Vector3(...FLUID_FACES[i]);
          const face=new THREE.Group();face.position.copy(normal).multiplyScalar(0.505);
          face.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
          const hole=new THREE.Mesh(holeGeometry,dark);face.add(hole);
          const arrow=new THREE.Mesh(arrowGeometry,mode===FLUID.faceInput?inputColor:outputColor);
          arrow.rotation.x=mode===FLUID.faceInput?-Math.PI/2:Math.PI/2;
          arrow.position.z=mode===FLUID.faceInput?0.065:0.12;
          face.add(arrow);group.add(face);
        });
        entry={group,modes};this.models.set(k,entry);this.scene.add(group);
      }
    }
    for(const [k,entry] of this.models)if(!current.has(k)){this.scene.remove(entry.group);this.models.delete(k);}
    const tanks=nodes.filter(node=>node.kind==='tank');
    const shape=tanks.map(node=>key(node)).join('|');
    const contents=tanks.map(node=>`${key(node)}:${node.fluid}:${node.fill}`).join('|');
    if(shape!==this.tankShape||contents!==this.tankContents) {
      for(const mesh of this.tankMeshes){this.scene.remove(mesh);mesh.geometry.dispose();}
      this.tankMeshes=[];this.tankShape=shape;this.tankContents=contents;
      for(const [fluid,material,order] of [[null,glassMaterial,4],['water',waterMaterial,3],['steam',steamMaterial,3]]) {
        const geometry=tankSurface(tanks,fluid);
        if(!geometry.index.count){geometry.dispose();continue;}
        const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;
        this.scene.add(mesh);this.tankMeshes.push(mesh);
      }
    }
  }
  setBoilerLit(x,y,z,lit) {
    const k=key({x,y,z});
    if(!lit){const old=this.plumes.get(k);if(old){removePlume(this.scene,old);this.plumes.delete(k);}return;}
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
    for(const mesh of this.tankMeshes){this.scene.remove(mesh);mesh.geometry.dispose();}
    for(const plume of this.plumes.values())removePlume(this.scene,plume);
    this.models.clear();this.plumes.clear();this.tankMeshes=[];}
}
