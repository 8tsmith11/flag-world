import { PLANT_ROWS } from './plantAtlas.js';
export { plantUV } from './plantAtlas.js';
import * as THREE from 'three';
import { VEGETATION_IDS, getBlockDef } from '/shared/blocks.js';
import { VEGETATION as C } from '/shared/config.js';
import { litMaterial } from './voxelLighting.js';
export function plantMaterial(daylight,time,renderer) {
 const canvas=document.createElement('canvas');canvas.width=C.atlasColumns*C.atlasStride;canvas.height=PLANT_ROWS*C.atlasStride;
 const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
 // Transparent gutters isolate the artwork; alpha testing writes depth and
 // avoids sorting/transparent layers even in denser forest patches.
 const ready=Promise.all(VEGETATION_IDS.map((id,index)=>new Promise((resolve,reject)=>{
  const image=new Image();image.onload=()=>{const pad=(C.atlasStride-C.atlasTile)/2;
   context.drawImage(image,index%C.atlasColumns*C.atlasStride+pad,Math.floor(index/C.atlasColumns)*C.atlasStride+pad,C.atlasTile,C.atlasTile);resolve();};
  image.onerror=()=>reject(new Error(`Missing plant texture ${getBlockDef(id).icon}`));image.src=getBlockDef(id).icon;
 }))).then(()=>{texture.needsUpdate=true;});
 const material=litMaterial(new THREE.MeshBasicMaterial({map:texture,vertexColors:true,alphaTest:C.alphaTest,side:THREE.DoubleSide}),daylight);
 const lighting=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  lighting(shader);shader.uniforms.plantTime=time;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float plantTime; attribute float plantWind; varying float plantDistance;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    transformed.x += sin(plantTime*${C.windSpeed}+position.x*${C.windScale}+position.z*${C.windScale})*plantWind;
    plantDistance = distance((modelMatrix*vec4(transformed,1.0)).xyz,cameraPosition);`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float plantDistance;')
   .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
    if(plantDistance>${C.maxDistance.toFixed(8)})discard;
    if(plantDistance>${C.fadeDistance.toFixed(8)}) {
      float fade=clamp((${C.maxDistance.toFixed(8)}-plantDistance)/${(C.maxDistance-C.fadeDistance).toFixed(8)},0.0,1.0);
      if(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)>fade)discard;
    }`);
 };
 material.customProgramCacheKey=()=> 'plant-voxel-v3';return {material,texture,ready};
}
