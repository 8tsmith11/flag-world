// Day and night: the sun and moon crossing the sky, the sky (and fog) color
// through dawn, day, dusk and night, stars after dark, and the lights. Time
// of day is 0..1: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight (the
// server's clock, see Game.dayTime). Night is darker and bluer, with fog
// drawn in a little, but never pitch black.

import * as THREE from 'three';

// Sky colors at full day, full night, and the glow near sunrise and sunset.
const DAY_SKY = new THREE.Color(0x9fd4ff);
const NIGHT_SKY = new THREE.Color(0x0b1433);
const DAWN_GLOW = new THREE.Color(0xf2a36b);
const DUSK_GLOW = new THREE.Color(0xe9795a);
// Light strengths at full day and full night (moonlight).
const AMBIENT = { day: 1.1, night: 0.5 };
const SUN = { day: 1.8, night: 0.45 };
const SUN_COLOR = new THREE.Color(0xfff4e0);
const MOON_COLOR = new THREE.Color(0x9fb4ff);
const NIGHT_AMBIENT = new THREE.Color(0x8a9ad0);
// Fog distance at night, as a fraction of the view distance.
const NIGHT_FOG = 0.75;
// How far away the sun, moon and stars are drawn (scaled down to fit inside
// the camera's far plane at short view distances).
const SKY_DISTANCE = 300;
const STAR_COUNT = 1400;
// The sun's path leans this much toward the south so it isn't straight overhead.
const TILT = 0.35;

const smoothstep = (lo, hi, v) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

function disc(radius, color) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false }));
  mesh.renderOrder = -1;
  return mesh;
}

function stars() {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform over the sphere.
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    positions.set([Math.cos(a) * r * SKY_DISTANCE, u * SKY_DISTANCE, Math.sin(a) * r * SKY_DISTANCE], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
  }));
}

export class Sky {
  constructor(scene, { ambient, sun }) {
    this.scene = scene;
    this.ambient = ambient;
    this.light = sun;
    this.group = new THREE.Group();
    this.sun = disc(18, 0xfff1b8);
    this.moon = disc(11, 0xe6ecff);
    this.stars = stars();
    this.group.add(this.stars, this.sun, this.moon);
    scene.add(this.group);
    this.color = new THREE.Color();
    // 0 at night, 1 in daylight; also used to tint clouds.
    this.daylight = 1;
    this.tint = new THREE.Color(1, 1, 1);
  }

  // time: 0..1 time of day. camera: the sky is centered on it.
  update(time, camera) {
    const angle = time * Math.PI * 2;
    // Rises in the east (+X), highest at noon, sets in the west.
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), TILT).normalize();
    const height = sunDir.y;
    const day = smoothstep(-0.18, 0.2, height);
    this.daylight = day;

    // Night blue to day blue, warmed near the horizon: dawn in the morning, dusk in the evening.
    this.color.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    const glow = Math.max(0, 1 - Math.abs(height) / 0.28) * 0.65;
    this.color.lerp(time > 0.25 && time < 0.75 ? DUSK_GLOW : DAWN_GLOW, glow);
    this.scene.background = this.color;
    this.scene.fog.color.copy(this.color);

    // Centered on the camera and kept inside its far plane.
    this.group.position.copy(camera.position);
    this.group.scale.setScalar(Math.min(1, camera.far * 0.85 / SKY_DISTANCE));
    this.sun.position.copy(sunDir).multiplyScalar(SKY_DISTANCE * 0.9);
    this.moon.position.copy(sunDir).multiplyScalar(-SKY_DISTANCE * 0.9);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.sun.visible = height > -0.15;
    this.moon.visible = height < 0.15;
    this.stars.material.opacity = Math.max(0, 1 - day * 1.6) * 0.9;
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.rotation.y = angle * 0.2;

    // The sun lights the day, the moon the night.
    this.ambient.intensity = AMBIENT.night + (AMBIENT.day - AMBIENT.night) * day;
    this.ambient.color.copy(NIGHT_AMBIENT).lerp(SUN_COLOR.clone().set(0xffffff), day);
    const lightDir = height >= 0 ? sunDir : sunDir.clone().negate();
    this.light.position.copy(lightDir);
    this.light.intensity = SUN.night + (SUN.day - SUN.night) * day;
    this.light.color.copy(MOON_COLOR).lerp(SUN_COLOR, day);
    this.tint.setScalar(0.3 + 0.7 * day).lerp(this.color, 0.25 * glow);
  }

  // Fog distance scale for the time of day: 1 by day, NIGHT_FOG at night.
  get fogScale() {
    return NIGHT_FOG + (1 - NIGHT_FOG) * this.daylight;
  }
}
