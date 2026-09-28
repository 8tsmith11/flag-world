import * as THREE from 'three';
import { CHUNK_SIZE, LIGHTING as C } from '/shared/config.js';
import { Chunk, chunkKey } from '/shared/world.js';
import { getBlockDef, isSolid } from '/shared/blocks.js';

const local=n=>(n%CHUNK_SIZE+CHUNK_SIZE)%CHUNK_SIZE;
const neighbours=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const candidate=new THREE.Color();
// Identical illumination coefficients to litMaterial: no extra night floor.
function gridLight(world,x,y,z,daylight,out) {
  const data=world.lightChunks?.get(chunkKey(Math.floor(x/CHUNK_SIZE),Math.floor(y/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE)));
  if(!data){world.requestLight?.(x,y,z);return null;}
  const i=Chunk.index(local(x),local(y),local(z)),def=getBlockDef(world.getBlock(x,y,z));
  const block=Math.min(C.maxLevel,Math.max(def.emission,data?.light[i]??0))/C.maxLevel;
  const sky=(data?.sky[i]??0)/255*daylight.value;
  const voidLight=(data?.void[i]??0)/255*(1-data.sky[i]/255)
    *(C.voidNight+(C.voidDay-C.voidNight)*Math.min(1,Math.max(0,(daylight.value-C.nightSky)/(C.daySky-C.nightSky))));
  const tint=daylight.tint.value;
  return out.setRGB(C.ambientFloor+block*C.blockTint[0]*C.blockStrength+sky*tint.r+voidLight*C.voidTint[0],
    C.ambientFloor+block*C.blockTint[1]*C.blockStrength+sky*tint.g+voidLight*C.voidTint[1],
    C.ambientFloor+block*C.blockTint[2]*C.blockStrength+sky*tint.b+voidLight*C.voidTint[2]);
}
// One light-grid lookup normally. Only a sample inside solid terrain needs
// the six neighbouring air samples; solid neighbours never contribute.
export function sampleEntityLight(world,position,daylight,out,sampleHeight=0) {
  const x=Math.floor(position.x),y=Math.floor(position.y+sampleHeight),z=Math.floor(position.z);
  if(!isSolid(world.getBlock(x,y,z)))return gridLight(world,x,y,z,daylight,out);
  out.setRGB(C.ambientFloor,C.ambientFloor,C.ambientFloor);let best=0;
  for(const [dx,dy,dz] of neighbours) {
    if(isSolid(world.getBlock(x+dx,y+dy,z+dz)))continue;
    if(!gridLight(world,x+dx,y+dy,z+dz,daylight,candidate))continue;
    const strength=candidate.r+candidate.g+candidate.b;
    if(strength>best){best=strength;out.copy(candidate);}
  }
  return best>0?out:null;
}
export function updateEntityLight(world,position,daylight,uniform,dt=0,sampleHeight=0) {
  // Air-only chunks are sparse too. Hold the last sample while their worker
  // buffers arrive instead of treating missing illumination as darkness.
  if(!sampleEntityLight(world,position,daylight,uniform.target,sampleHeight))return;
  if(!uniform.initialized){uniform.value.copy(uniform.target);uniform.initialized=true;}
  else uniform.value.lerp(uniform.target,1-Math.exp(-Math.max(0,dt)/C.entitySmoothSeconds));
}
export const lightUniform=()=>({value:new THREE.Color(1,1,1),target:new THREE.Color(),initialized:false});

function patchMaterial(material,uniform,sprite,instanced) {
  material.userData.entityLighting=uniform;
  material.onBeforeCompile=shader=>{
    shader.uniforms.entityLight=uniform;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec3 vEntityLight; ${sprite?'':'varying float vEntityShade;'}
      ${instanced?'attribute vec3 instanceLight;':''}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vEntityLight=${instanced?'instanceLight':'vec3(1.0)'};
        ${sprite?'':`vec3 entityNormal=normal;
          ${instanced?'entityNormal=mat3(instanceMatrix)*entityNormal;':''}
          float up=normalize(mat3(modelMatrix)*entityNormal).y;
          vEntityShade=mix(${C.entityDownShade.toFixed(8)},${C.entityUpShade.toFixed(8)},up*0.5+0.5);`}`);
    if(sprite)shader.vertexShader=shader.vertexShader.replace('void main() {','void main() {\nvEntityLight=vec3(1.0);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform vec3 entityLight; varying vec3 vEntityLight; ${sprite?'':'varying float vEntityShade;'}`)
      .replace('#include <opaque_fragment>',`outgoingLight=diffuseColor.rgb*entityLight*vEntityLight${sprite?'':'*vEntityShade'}${material.isMeshLambertMaterial||material.isMeshPhongMaterial?' + totalEmissiveRadiance':''};
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`entity-voxel-v2:${sprite}:${instanced}`;material.needsUpdate=true;
}
// Equipment and turret factories can share materials. Clone once per entity
// so each model's uniform remains independent, without traversing every frame.
export function lightModel(object,uniform) {
  const clones=new Map();
  object.traverse(mesh=>{
    if(!mesh.material)return;
    const bind=original=>{
      if(original.userData.entityLighting===uniform)return original;
      let material=original;
      if(original.userData.entityLighting){material=clones.get(original);if(!material){material=original.clone();clones.set(original,material);}}
      patchMaterial(material,uniform,!!mesh.isSprite,!!mesh.isInstancedMesh);return material;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(bind):bind(mesh.material);
    if(mesh.isInstancedMesh&&!mesh.geometry.getAttribute('instanceLight')) {
      mesh.geometry.setAttribute('instanceLight',new THREE.InstancedBufferAttribute(new Float32Array(mesh.count*3).fill(1),3));
    }
  });
}
// The same sample/smoothing path for instance batches (none currently used
// by the game's entity factories). Each instance owns its smoothed value.
export function lightInstance(mesh,index,world,position,daylight,state,dt,sampleHeight=0) {
  updateEntityLight(world,position,daylight,state,dt,sampleHeight);
  const attribute=mesh.geometry.getAttribute('instanceLight');
  attribute.setXYZ(index,state.value.r,state.value.g,state.value.b);attribute.needsUpdate=true;
}
