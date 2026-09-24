// Goblin models. Every goblin is the same base (createGoblinModel): stubby
// legs, a tunic, long arms, a big head with big ears, scaled and colored per
// type, with gear in its right hand and on its head. Future goblin types add
// an entry to GOBLIN_LOOKS. The Goblin Totem is its own carved model.
// Models face -Z like players; the feet are at the origin.

import * as THREE from 'three';
import { GOBLINS } from '/shared/goblins.js';

const lambert = (color) => new THREE.MeshLambertMaterial({ color });
const glow = (color) => new THREE.MeshBasicMaterial({ color });

function box(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Gear, built in the right hand's space (the hand at the origin, the arm
// hanging down -Y, forward -Z).
const GEAR = {
  pick(hand) {
    const handle = box(hand, 0.05, 0.05, 0.5, 0, 0, -0.18, lambert(0x6b4a2b));
    handle.rotation.x = 0.1;
    const head = box(hand, 0.34, 0.07, 0.07, 0, 0.02, -0.42, lambert(0x8a8f96));
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), lambert(0xa9aeb5));
      tip.position.set(side * 0.21, 0.0, -0.42);
      tip.rotation.z = -side * Math.PI / 2 - side * 0.3;
      hand.add(tip);
    }
    return head;
  },
  club(hand) {
    const wood = lambert(0x5b3b22);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.8, 8), wood);
    shaft.rotation.x = -Math.PI / 2;
    shaft.position.set(0, 0, -0.38);
    hand.add(shaft);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), wood);
    knob.position.set(0, 0, -0.8);
    hand.add(knob);
    const iron = lambert(0x7d8288);
    for (const [x, y, z] of [[0.14, 0, -0.8], [-0.14, 0, -0.8], [0, 0.14, -0.8], [0, -0.14, -0.8], [0, 0, -0.95]]) {
      box(hand, 0.06, 0.06, 0.06, x, y, z, iron);
    }
    return knob;
  },
};

// Per type: overall scale (the base is GOBLINS.worker.height tall), colors,
// held gear and extras.
export const GOBLIN_LOOKS = {
  goblinWorker: { height: GOBLINS.worker.height, skin: 0x6f9b3c, tunic: 0x7a5a32, belt: 0x3d2a17, gear: 'pick' },
  goblinKing: { height: GOBLINS.king.height, skin: 0x557d2c, tunic: 0x6d1f28, belt: 0xd4af37, gear: 'club',
    crown: true, cape: 0x8e2230 },
};

// Height of the unscaled base model (top of the head).
const BASE_HEIGHT = 1.02;

export function createGoblinModel({ type }) {
  const look = GOBLIN_LOOKS[type] ?? GOBLIN_LOOKS.goblinWorker;
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(look.height / BASE_HEIGHT);
  group.add(body);
  const skin = lambert(look.skin), tunic = lambert(look.tunic), dark = lambert(0x1c1a14);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.34, 0);
    box(hip, 0.12, 0.3, 0.13, 0, -0.17, 0, skin);
    box(hip, 0.14, 0.06, 0.2, 0, -0.31, -0.03, dark);
    body.add(hip);
    legs.push(hip);
  }
  box(body, 0.38, 0.36, 0.26, 0, 0.5, 0, tunic);
  box(body, 0.4, 0.06, 0.28, 0, 0.36, 0, lambert(look.belt));

  const head = new THREE.Group();
  head.position.y = 0.68;
  box(head, 0.4, 0.34, 0.36, 0, 0.17, 0, skin);
  // A long nose, a wide mouth, yellow eyes.
  box(head, 0.08, 0.1, 0.12, 0, 0.14, -0.22, skin);
  box(head, 0.22, 0.03, 0.02, 0, 0.05, -0.185, dark);
  const eye = glow(0xf2d34a);
  for (const x of [-0.09, 0.09]) {
    box(head, 0.08, 0.05, 0.02, x, 0.22, -0.185, eye);
    box(head, 0.03, 0.04, 0.02, x, 0.22, -0.195, dark);
  }
  // Big ears, swept back.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 4), skin);
    ear.position.set(side * 0.3, 0.22, 0.02);
    ear.rotation.z = -side * Math.PI / 2 + side * 0.25;
    ear.rotation.y = side * 0.35;
    ear.scale.z = 0.4;
    head.add(ear);
  }
  if (look.crown) {
    const gold = lambert(0xe0b83a);
    box(head, 0.44, 0.08, 0.4, 0, 0.38, 0, gold);
    for (const [x, z] of [[-0.17, -0.15], [0.17, -0.15], [0, -0.17], [-0.17, 0.15], [0.17, 0.15]]) {
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), gold);
      point.position.set(x, 0.49, z);
      head.add(point);
    }
    box(head, 0.06, 0.06, 0.02, 0, 0.38, -0.21, glow(0xd8323c));
  }
  body.add(head);
  if (look.cape) {
    const cape = box(body, 0.42, 0.5, 0.03, 0, 0.42, 0.15, lambert(look.cape));
    cape.rotation.x = 0.12;
  }

  // Arms from the shoulders; the right one holds the gear.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 0.64, 0);
    box(shoulder, 0.1, 0.36, 0.1, 0, -0.18, 0, skin);
    const hand = new THREE.Group();
    hand.position.set(0, -0.36, 0);
    shoulder.add(hand);
    body.add(shoulder);
    arms.push({ shoulder, hand, side });
  }
  const gear = look.gear && GEAR[look.gear](arms[1].hand);
  group.userData.goblin = { body, legs, arms, head, gear, phase: 0, swingStart: -Infinity, work: 0 };
  return group;
}

export function swingGoblin(model) {
  model.userData.goblin.swingStart = performance.now();
}

const SWING_MS = 450;

// Per frame: legs and arms swing with walking, the right arm chops while
// mining, a swing (King's club) is a big overhead strike, and climbing
// reaches both arms up.
export function animateGoblin(model, dt, speed, { mining = false, climbing = false } = {}) {
  const g = model.userData.goblin;
  const walk = Math.min(1, speed / 2.5);
  if (walk > 0.05 || climbing) g.phase += dt * (climbing ? 9 : 4 + speed * 2);
  const stride = Math.sin(g.phase) * 0.7 * (climbing ? 0.6 : walk);
  g.legs[0].rotation.x = stride;
  g.legs[1].rotation.x = -stride;
  const [left, right] = g.arms;
  left.shoulder.rotation.x = climbing ? 2.6 + stride : -stride * 0.8;
  if (mining) g.work += dt * 7;
  const swing = (performance.now() - g.swingStart) / SWING_MS;
  // Positive rotation raises an arm forward. A strike winds up overhead,
  // then slams down in front.
  if (swing >= 0 && swing < 1) right.shoulder.rotation.x = swing < 0.55 ? 2.8 * swing / 0.55 : 2.8 - (swing - 0.55) / 0.45 * 1.9;
  else if (climbing) right.shoulder.rotation.x = 2.6 - stride;
  else if (mining) right.shoulder.rotation.x = 1.1 + Math.abs(Math.sin(g.work)) * 1.3;
  else right.shoulder.rotation.x = 0.35 + stride * 0.8;
  g.body.position.y = Math.abs(Math.sin(g.phase)) * 0.03 * walk;
}

// The Goblin Totem: a tall carved post of stacked faces on a brick plinth,
// crowned with a big goblin head with glowing eyes, ears and a crest.
export function createTotemModel() {
  const group = new THREE.Group();
  const { width, height } = GOBLINS.totem;
  const wood = lambert(0x5b4128), darkWood = lambert(0x3b2a18), stone = lambert(0x47442e);
  const skin = lambert(0x5f8a33), bone = lambert(0xe6dcc0), paint = lambert(0x9c2f2a);
  const eyeGlow = glow(0x9dff5a);
  box(group, width, 0.35, width, 0, 0.175, 0, stone);
  box(group, width * 0.8, 0.2, width * 0.8, 0, 0.45, 0, stone);
  const post = width * 0.62;
  // Two lower carved faces, then the goblin head.
  for (const [y, face] of [[0.55, wood], [1.45, darkWood]]) {
    box(group, post, 0.9, post, 0, y + 0.45, 0, face);
    for (const x of [-0.16, 0.16]) box(group, 0.14, 0.1, 0.04, x, y + 0.6, -post / 2 - 0.01, darkWood);
    box(group, 0.4, 0.1, 0.04, 0, y + 0.28, -post / 2 - 0.01, paint);
    for (const side of [-1, 1]) box(group, 0.14, 0.5, 0.3, side * (post / 2 + 0.07), y + 0.45, 0, face);
  }
  const headY = 2.35, headSize = width * 0.78;
  box(group, headSize, 1.1, headSize, 0, headY + 0.55, 0, skin);
  // Brow, glowing eyes, a long nose and a toothy grin.
  box(group, headSize * 0.9, 0.12, 0.1, 0, headY + 0.84, -headSize / 2 - 0.03, darkWood);
  for (const x of [-0.26, 0.26]) box(group, 0.22, 0.14, 0.05, x, headY + 0.7, -headSize / 2 - 0.02, eyeGlow);
  box(group, 0.16, 0.3, 0.2, 0, headY + 0.52, -headSize / 2 - 0.08, skin);
  box(group, 0.7, 0.14, 0.04, 0, headY + 0.22, -headSize / 2 - 0.01, darkWood);
  for (const x of [-0.24, -0.08, 0.08, 0.24]) box(group, 0.08, 0.1, 0.05, x, headY + 0.26, -headSize / 2 - 0.03, bone);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 4), skin);
    ear.position.set(side * (headSize / 2 + 0.38), headY + 0.75, 0);
    ear.rotation.z = -side * Math.PI / 2 + side * 0.35;
    ear.scale.z = 0.4;
    group.add(ear);
  }
  // Crest of bone spikes.
  for (let i = -2; i <= 2; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3 + (2 - Math.abs(i)) * 0.12, 5), bone);
    spike.position.set(i * 0.18, headY + 1.2 + (2 - Math.abs(i)) * 0.06, 0);
    group.add(spike);
  }
  // Painted back so every side reads as carved.
  box(group, headSize * 0.6, 0.08, 0.04, 0, headY + 0.6, headSize / 2 + 0.01, paint);
  const light = new THREE.PointLight(0x9dff5a, 1.4, 9, 1.5);
  light.position.set(0, headY + 0.7, -headSize / 2 - 0.5);
  group.add(light);
  group.userData.totem = { height, light, eyes: eyeGlow, time: Math.random() * 10 };
  return group;
}

// Per frame: the eyes pulse.
export function animateTotem(model, dt) {
  const t = model.userData.totem;
  t.time += dt;
  const pulse = 0.75 + 0.25 * Math.sin(t.time * 2.2);
  t.light.intensity = 1.4 * pulse;
  t.eyes.color.setRGB(0.45 + 0.17 * pulse, 0.75 + 0.25 * pulse, 0.25 + 0.1 * pulse);
}
