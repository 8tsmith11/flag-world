// Day and night: the sun and moon crossing the sky, the sky (and fog) color
// through dawn, day, dusk and night, stars after dark, and the lights. Time
// of day is 0..1: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight (the
// server's clock, see Game.dayTime). Night is darker and bluer, with fog
// drawn in a little, but never pitch black.

import * as THREE from 'three';

import { SKY_SETTINGS as C } from '/shared/config.js';
import { mulberry32 } from '/shared/structures.js';
const DAY_SKY = new THREE.Color(C.dayColor), NIGHT_SKY = new THREE.Color(C.nightColor);
const DAWN_GLOW = new THREE.Color(C.dawnColor), DUSK_GLOW = new THREE.Color(C.duskColor);
const AMBIENT = {day:C.ambientDay,night:C.ambientNight}, SUN = {day:C.sunDay,night:C.sunNight};
const SUN_COLOR = new THREE.Color(C.sunColor), MOON_COLOR = new THREE.Color(C.moonColor);
const NIGHT_AMBIENT = new THREE.Color(C.nightAmbient), WHITE = new THREE.Color(0xffffff);
const NIGHT_FOG=C.nightFog, SKY_DISTANCE=C.distance, STAR_COUNT=C.stars, TILT=C.tilt;

const smoothstep = (lo, hi, v) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

function disc(radius, color) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, C.discSegments),
    new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false }));
  mesh.renderOrder = -1;
  return mesh;
}

function stars() {
  const random=mulberry32(C.seed);
  const positions = new Float32Array(STAR_COUNT * 3), colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform over the sphere.
    const u = random() * 2 - 1, a = random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const brightness = 0.25 + random() ** 3 * 0.75;
    colors.set([brightness, brightness * (0.9 + random() * 0.1), brightness * (0.85 + random() * 0.15)], i * 3);
    positions.set([Math.cos(a) * r * SKY_DISTANCE, u * SKY_DISTANCE, Math.sin(a) * r * SKY_DISTANCE], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xffffff, vertexColors: true, size: C.starSize, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
  }));
}

export class Sky {
  constructor(scene, { ambient, sun }) {
    this.scene = scene;
    this.ambient = ambient;
    this.light = sun;
    this.group = new THREE.Group();
    this.sun = disc(C.sunRadius, C.sunColor);
    this.moon = disc(C.moonRadius, C.moonColor);
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
    const day = smoothstep(...C.daylightRange, height);
    this.daylight = day;

    // Night blue to day blue, warmed near the horizon: dawn in the morning, dusk in the evening.
    this.color.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    const glow = Math.max(0, 1 - Math.abs(height) / C.glowRange) * C.glowStrength;
    this.color.lerp(time > 0.25 && time < 0.75 ? DUSK_GLOW : DAWN_GLOW, glow);
    this.scene.background = this.color;
    this.scene.fog.color.copy(this.color);

    // Centered on the camera and kept inside its far plane.
    this.group.position.copy(camera.position);
    this.group.scale.setScalar(Math.min(1, camera.far * C.farScale / SKY_DISTANCE));
    this.sun.position.copy(sunDir).multiplyScalar(SKY_DISTANCE * C.discDistance);
    this.moon.position.copy(sunDir).multiplyScalar(-SKY_DISTANCE * C.discDistance);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.sun.visible = height > C.sunHorizon;
    this.moon.visible = height < C.moonHorizon;
    this.stars.material.opacity = Math.max(0, 1 - day * C.starFade) * C.starOpacity;
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.rotation.y = angle * C.starRotation;

    // The sun lights the day, the moon the night.
    this.ambient.intensity = AMBIENT.night + (AMBIENT.day - AMBIENT.night) * day;
    this.ambient.color.copy(NIGHT_AMBIENT).lerp(WHITE, day);
    const lightDir = height >= 0 ? sunDir : sunDir.clone().negate();
    this.light.position.copy(lightDir);
    this.light.intensity = SUN.night + (SUN.day - SUN.night) * day;
    this.light.color.copy(MOON_COLOR).lerp(SUN_COLOR, day).lerp(time>0.25&&time<0.75?DUSK_GLOW:DAWN_GLOW,glow*day);
    this.tint.setScalar(C.cloudNightTint + (1-C.cloudNightTint) * day).lerp(this.color, C.cloudGlowTint * glow);
  }

  // Fog distance scale for the time of day: 1 by day, NIGHT_FOG at night.
  get fogScale() {
    return NIGHT_FOG + (1 - NIGHT_FOG) * this.daylight;
  }
}
