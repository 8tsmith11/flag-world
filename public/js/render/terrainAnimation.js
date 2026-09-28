// Water shine stays entirely in the GPU, without geometry or light updates.
import { WATER_SHIMMER as S } from '/shared/config.js';
const gl=n=>Number(n).toFixed(8);
export function animateWater(material,time) {
  const lighting=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    lighting(shader);shader.uniforms.terrainTime=time;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 waterPosition; varying float waterTop;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nwaterPosition=position.xz; waterTop=max(0.0,normal.y);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float terrainTime; varying vec2 waterPosition; varying float waterTop;')
      .replace('#include <alphatest_fragment>',`float wave=sin(waterPosition.x*${gl(S.scale)}+waterPosition.y+terrainTime*${gl(S.speed)})
        *cos(waterPosition.y*${gl(S.scale)}-waterPosition.x-terrainTime*${gl(S.speed)});
        float shine=pow(max(0.0,wave),${gl(S.sharpness)})*waterTop*${gl(S.strength)};
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),shine);
        #include <alphatest_fragment>`);
  };
  material.customProgramCacheKey=()=> 'voxel-water-shimmer-v1';return material;
}
