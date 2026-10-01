import * as THREE from 'three';
import { FLUID } from '/shared/config.js';
import { FLUID_FACES } from '/shared/fluidFaces.js';
import { tankExteriorFaces } from '/shared/fluidModels.js';

const key=({x,y,z})=>`${x},${y},${z}`;
const waterMaterial=new THREE.MeshBasicMaterial({color:0x347bd4,transparent:true,opacity:0.67,depthWrite:false,side:THREE.DoubleSide});
const glassMaterial=new THREE.MeshBasicMaterial({color:0xb9e4eb,transparent:true,opacity:0.26,depthWrite:false,side:THREE.DoubleSide});

const dotMaterials={
  [FLUID.faceInput]:new THREE.MeshBasicMaterial({color:0x359bd3,side:THREE.DoubleSide}),
  [FLUID.faceOutput]:new THREE.MeshBasicMaterial({color:0xf28b30,side:THREE.DoubleSide}),
};

function pipeFaceGeometry(pipes) {
  const positions=[],indices=[];
  const forward=new THREE.Vector3(0,0,1),normal=new THREE.Vector3(),
    center=new THREE.Vector3(),point=new THREE.Vector3(),turn=new THREE.Quaternion();
  for(const pipe of pipes)for(const [dx,dy,dz] of FLUID_FACES) {
    normal.set(dx,dy,dz);turn.setFromUnitVectors(forward,normal);
    center.set(pipe.x+0.5+dx*0.201,pipe.y+0.5+dy*0.201,pipe.z+0.5+dz*0.201);
    const base=positions.length/3;
    positions.push(center.x,center.y,center.z);
    for(let i=0;i<=12;i++){
      const angle=i*Math.PI*2/12;
      point.set(Math.cos(angle)*0.065,Math.sin(angle)*0.065,0).applyQuaternion(turn).add(center);
      positions.push(point.x,point.y,point.z);
      if(i>0)indices.push(base,base+i,base+i+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  return geometry;
}

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

function tankSurface(nodes,lookup,fluid=null) {
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
    const pipe=lookup.get(`${x+dx},${y+dy},${z+dz}`)?.kind==='pipe';
    if(!pipe) {addFace(vertices,indices,face,x0,bottom,z0,x1,surfaceTop,z1);continue;}
    // Leave a square opening where a pipe meets the panel instead of drawing
    // glass and liquid across the pipe's mouth.
    const low=0.28,high=0.72;
    if(dx) {
      for(const [a,b] of [[z0,z+low],[z+high,z1]])addFace(vertices,indices,face,x0,bottom,a,x1,surfaceTop,b);
      if(bottom<y+low)addFace(vertices,indices,face,x0,bottom,z+low,x1,Math.min(surfaceTop,y+low),z+high);
      if(surfaceTop>y+high)addFace(vertices,indices,face,x0,Math.max(bottom,y+high),z+low,x1,surfaceTop,z+high);
    } else if(dy) {
      for(const [a,b] of [[x0,x+low],[x+high,x1]])addFace(vertices,indices,face,a,bottom,z0,b,surfaceTop,z1);
      addFace(vertices,indices,face,x+low,bottom,z0,x+high,surfaceTop,z+low);
      addFace(vertices,indices,face,x+low,bottom,z+high,x+high,surfaceTop,z1);
    } else {
      for(const [a,b] of [[x0,x+low],[x+high,x1]])addFace(vertices,indices,face,a,bottom,z0,b,surfaceTop,z1);
      if(bottom<y+low)addFace(vertices,indices,face,x+low,bottom,z0,x+high,Math.min(surfaceTop,y+low),z1);
      if(surfaceTop>y+high)addFace(vertices,indices,face,x+low,Math.max(bottom,y+high),z0,x+high,surfaceTop,z1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  return geometry;
}

function tankGroups(tanks) {
  const lookup=new Map(tanks.map(node=>[key(node),node])),seen=new Set(),groups=[];
  for(const node of tanks) {
    const start=key(node);if(seen.has(start))continue;
    const queue=[node],group=[];seen.add(start);
    while(queue.length) {
      const current=queue.pop();group.push(current);
      for(const [dx,dy,dz] of FLUID_FACES) {
        const neighbour=lookup.get(`${current.x+dx},${current.y+dy},${current.z+dz}`);
        if(neighbour&&!seen.has(key(neighbour))){seen.add(key(neighbour));queue.push(neighbour);}
      }
    }
    groups.push(group);
  }
  return groups;
}

export class FluidRenderer {
  constructor(scene) {this.scene=scene;this.pipeMeshes=new Map();this.pipeLayout='';this.plumes=new Map();this.time=0;
    this.pipeModes=new Map();
    this.tankMeshes=[];this.steamVisuals=new Map();this.tankShape='';this.tankContents='';}
  sync(nodes) {
    const lookup=new Map(nodes.map(node=>[key(node),node]));
    const pipes=nodes.filter(node=>node.kind==='pipe');
    this.pipeModes=new Map(pipes.map(node=>[key(node),node.mode]));
    const pipeLayout=pipes.map(node=>`${key(node)}:${node.mode}`).sort().join('|');
    if(pipeLayout!==this.pipeLayout) {
      for(const mesh of this.pipeMeshes.values()){
        this.scene.remove(mesh);mesh.geometry.dispose();
      }
      this.pipeMeshes.clear();this.pipeLayout=pipeLayout;
      for(const [mode,material] of Object.entries(dotMaterials)) {
        const group=pipes.filter(node=>node.mode===Number(mode));
        if(!group.length)continue;
        const mesh=new THREE.Mesh(pipeFaceGeometry(group),material);
        this.pipeMeshes.set(Number(mode),mesh);this.scene.add(mesh);
      }
    }
    const tanks=nodes.filter(node=>node.kind==='tank');
    const shape=nodes.filter(node=>node.kind==='tank'||node.kind==='pipe').map(node=>key(node)).join('|');
    // Steam changes only its opacity; glass and water geometry stay put.
    const contents=tanks.map(node=>`${key(node)}:${node.fluid==='water'?node.fill:0}`).join('|');
    const shapeChanged=shape!==this.tankShape;
    if(shapeChanged||contents!==this.tankContents) {
      for(const mesh of this.tankMeshes){this.scene.remove(mesh);mesh.geometry.dispose();}
      this.tankMeshes=[];this.tankShape=shape;this.tankContents=contents;
      for(const [fluid,material,order] of [[null,glassMaterial,4],['water',waterMaterial,3]]) {
        const geometry=tankSurface(tanks,lookup,fluid);
        if(!geometry.index.count){geometry.dispose();continue;}
        const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;
        this.scene.add(mesh);this.tankMeshes.push(mesh);
      }
    }
    const currentSteam=new Set();
    for(const group of tankGroups(tanks)) {
      const id=group.map(key).sort().join('|');currentSteam.add(id);
      const active=group.some(node=>node.fluid==='steam'&&node.amount>0);
      let visual=this.steamVisuals.get(id);
      if(!visual&&!active)continue;
      if(!visual) {
        const material=new THREE.MeshBasicMaterial({color:0xe5eef2,transparent:true,
          opacity:0,depthWrite:false,side:THREE.DoubleSide});
        const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.renderOrder=3;
        visual={mesh,target:0};this.steamVisuals.set(id,visual);this.scene.add(mesh);
      }
      if(shapeChanged||!visual.mesh.geometry.index) {
        visual.mesh.geometry.dispose();
        visual.mesh.geometry=tankSurface(group.map(node=>({...node,fluid:'steam',fill:1})),lookup,'steam');
      }
      const density=group[0].capacity?group[0].amount/group[0].capacity:0;
      visual.target=active?Math.min(0.35,0.12+0.23*Math.sqrt(Math.max(0,density))):0;
    }
    for(const [id,visual] of this.steamVisuals)if(!currentSteam.has(id)) {
      this.scene.remove(visual.mesh);visual.mesh.geometry.dispose();visual.mesh.material.dispose();
      this.steamVisuals.delete(id);
    }
  }
  modeAt(x,y,z){return this.pipeModes.get(`${x},${y},${z}`);}
  setBoilerLit(x,y,z,lit) {
    const k=key({x,y,z});
    const old=this.plumes.get(k);
    if(old){old.userData.lit=lit;return;}
    if(!lit)return;
    const group=new THREE.Group();group.position.set(x+0.5,y+1.3,z+0.5);
    group.userData.lit=true;group.userData.opacity=0;
    const geometry=new THREE.SphereGeometry(0.32,8,6);
    for(let i=0;i<7;i++) {
      const puff=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xecf4f7,transparent:true,opacity:0.35,depthWrite:false,fog:false}));
      puff.userData.phase=i/7;group.add(puff);
    }
    this.scene.add(group);this.plumes.set(k,group);
  }
  update(dt) {
    this.time+=dt;
    for(const [id,visual] of this.steamVisuals) {
      const material=visual.mesh.material;
      material.opacity+=(visual.target-material.opacity)*Math.min(1,dt*4);
      if(!visual.target&&material.opacity<0.005) {
        this.scene.remove(visual.mesh);visual.mesh.geometry.dispose();material.dispose();
        this.steamVisuals.delete(id);
      }
    }
    for(const [k,group] of this.plumes) {
      group.userData.opacity+=(Number(group.userData.lit)-group.userData.opacity)*Math.min(1,dt*4);
      if(!group.userData.lit&&group.userData.opacity<0.01){removePlume(this.scene,group);this.plumes.delete(k);continue;}
      group.children.forEach((puff,i)=>{
      const t=(this.time*0.28+puff.userData.phase)%1;
      puff.position.set(Math.sin(this.time*0.8+i)*t*0.18,t*3,Math.cos(this.time*0.6+i)*t*0.18);
      puff.scale.setScalar(0.65+t*2.5);
      puff.material.opacity=Math.sin(Math.PI*t)**2*0.36*group.userData.opacity;
    });
    }
  }
  dispose(){for(const mesh of this.pipeMeshes.values()){
      this.scene.remove(mesh);mesh.geometry.dispose();
    }
    for(const mesh of this.tankMeshes){this.scene.remove(mesh);mesh.geometry.dispose();}
    for(const visual of this.steamVisuals.values()){
      this.scene.remove(visual.mesh);visual.mesh.geometry.dispose();visual.mesh.material.dispose();
    }
    for(const plume of this.plumes.values())removePlume(this.scene,plume);
    this.pipeMeshes.clear();this.pipeModes.clear();this.plumes.clear();this.steamVisuals.clear();this.tankMeshes=[];}
}
