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

  // Their colors, strengths and the sun's direction follow the time of day (sky.js).
  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, ambient, sun };
}

// Fog fully hides things at the view distance, where chunks stop being meshed
// (or a little sooner: `scale` < 1 pulls it in, as at night).
export function setViewDistance(scene, camera, distance, scale = 1) {
  scene.fog.near = distance * FOG_START * scale;
  scene.fog.far = distance * scale;
  camera.far = distance + 64;
  camera.updateProjectionMatrix();
}
