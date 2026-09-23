// Three.js renderer, camera, lights, sky and distance fog.

import * as THREE from 'three';

export const SKY_COLOR = 0x9fd4ff;
// Fog starts this far into the view distance, so chunks at the edge fade in
// rather than popping.
const FOG_START = 0.55;

export function createScene(viewDistance) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 1, 2);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);
  camera.rotation.order = 'YXZ';
  setViewDistance(scene, camera, viewDistance);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

// Fog fully hides things at the view distance, where chunks stop being meshed.
export function setViewDistance(scene, camera, distance) {
  scene.fog.near = distance * FOG_START;
  scene.fog.far = distance;
  camera.far = distance + 64;
  camera.updateProjectionMatrix();
}

// The debug overview sees the whole world; fog would hide it.
export function setFogEnabled(scene, enabled, distance) {
  scene.fog.near = enabled ? distance * FOG_START : 1e6;
  scene.fog.far = enabled ? distance : 1e6 + 1;
}
