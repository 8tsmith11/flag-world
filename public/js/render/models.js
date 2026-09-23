// 3D models shared by the world, the first-person view and the inventory
// preview: the player (body, head with a face, one arm with a fist that holds
// the item in hand) and item models (block cubes and tools).

import * as THREE from 'three';
import { PLAYER_HEIGHT } from '/shared/config.js';
import { getItemDef } from '/shared/items.js';

const BODY_RADIUS = 0.26;
const BODY_HEIGHT = 1.25;
const HEAD_SIZE = 0.5;
const ARM_RADIUS = 0.075;
const ARM_LENGTH = 0.55;
const FIST_SIZE = 0.15;
const HEAD_PITCH_LIMIT = 0.8;

const SWING_MS = 250;
const SWING_ANGLE = 1.6;
// Walk cycle: radians of phase per block walked, and how much the body and arm move.
const WALK_PHASE_PER_BLOCK = 2.4;
const WADDLE = 0.07;
const ARM_WALK_SWING = 0.35;
const WALK_FULL_SPEED = 4;

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

// A hammer standing on its handle: gray handle along +Y, head across the top
// in the material's color. Origin at the bottom of the handle.
function createHammer(color) {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), lambert(0x8c8c8c));
  handle.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.24, 12), lambert(color));
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.48;
  group.add(handle, head);
  return group;
}

// A sword standing on its pommel: brown grip, gray crossguard, and a flat
// blade in the material's color along +Y.
function createSword(color) {
  const group = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), lambert(0x6b4a2b));
  grip.position.y = 0.07;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), lambert(0x8c8c8c));
  guard.position.y = 0.16;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.02), lambert(color));
  blade.position.y = 0.43;
  group.add(grip, guard, blade);
  return group;
}

// A small flat ladder (two rails, three rungs) or door, standing on its base.
function createFlatItem(kind, color, size) {
  const group = new THREE.Group();
  const material = lambert(color);
  const add = (w, h, x, y) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * size, h * size, 0.04), material);
    box.position.set(x * size, y * size, 0);
    group.add(box);
  };
  if (kind === 'ladder') {
    add(0.12, 1, -0.35, 0.5);
    add(0.12, 1, 0.35, 0.5);
    for (const y of [0.2, 0.5, 0.8]) add(0.6, 0.08, 0, y);
  } else {
    add(0.6, 1.2, 0, 0.6);
  }
  return group;
}

// Model for an item id: tools by shape, ladders and doors as flat pieces,
// blocks as a small cube of the block's color.
export function createItemModel(item, blockSize = 0.25) {
  const def = getItemDef(item);
  if (def.tool === 'hammer') return createHammer(def.color);
  if (def.tool === 'sword') return createSword(def.color);
  if (def.places) return createFlatItem(def.places, def.color, blockSize);
  if (def.shape === 'ingot') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(blockSize * 1.1, blockSize * 0.4, blockSize * 0.55), lambert(def.color));
    bar.position.y = blockSize * 0.2;
    const group = new THREE.Group();
    group.add(bar);
    return group;
  }
  const cube = new THREE.Mesh(new THREE.BoxGeometry(blockSize, blockSize, blockSize), lambert(def.color));
  cube.position.y = blockSize / 2;
  const group = new THREE.Group();
  group.add(cube);
  return group;
}

// An arm hanging from its pivot (the shoulder) along -Y, ending in a fist.
// Returns { pivot, hand }; `hand` is where held items attach.
export function createArm(color) {
  const pivot = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(ARM_RADIUS, ARM_RADIUS, ARM_LENGTH, 10), lambert(color));
  arm.position.y = -ARM_LENGTH / 2;
  const fist = new THREE.Mesh(new THREE.BoxGeometry(FIST_SIZE, FIST_SIZE, FIST_SIZE), lambert(color));
  fist.position.y = -ARM_LENGTH - FIST_SIZE / 2 + 0.03;
  const hand = new THREE.Group();
  hand.position.y = fist.position.y;
  pivot.add(arm, fist, hand);
  return { pivot, hand };
}

// Puts `item` (or nothing, for null) in a hand group; tools point along the
// hand's +Z out of the fist. Skips the work if it's already holding it.
export function setHandItem(hand, item) {
  if (hand.userData.item === item) return;
  hand.userData.item = item;
  for (const child of [...hand.children]) {
    hand.remove(child);
    child.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  if (item === null) return;
  const model = createItemModel(item, 0.2);
  // Tools lie along the handle's +Y; turn that to +Z. Blocks sit in the fist.
  if (getItemDef(item).tool) model.rotation.x = Math.PI / 2;
  else model.position.set(0, -0.1, -0.05);
  hand.add(model);
}

// Third-person player. Faces -Z; the whole group turns with yaw.
export function createPlayerModel({ color }) {
  const group = new THREE.Group();
  // Everything that waddles, so the group itself can still be positioned/turned freely.
  const torso = new THREE.Group();
  group.add(torso);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 16), lambert(color));
  body.position.y = BODY_HEIGHT / 2;
  torso.add(body);

  // Head pivots at the neck for look pitch. Eyes and a smile on the front.
  const head = new THREE.Group();
  head.position.y = BODY_HEIGHT;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE), lambert(color));
  skull.position.y = HEAD_SIZE / 2 + (PLAYER_HEIGHT - BODY_HEIGHT - HEAD_SIZE);
  head.add(skull);
  const eyeMaterial = lambert(0x111111);
  for (const x of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), eyeMaterial);
    eye.position.set(x, skull.position.y + 0.06, -HEAD_SIZE / 2 - 0.01);
    head.add(eye);
  }
  // Smile: a flat bottom with the corners turned up.
  for (const [x, y, w] of [[0, -0.12, 0.14], [-0.1, -0.09, 0.05], [0.1, -0.09, 0.05]]) {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.02), eyeMaterial);
    mouth.position.set(x, skull.position.y + y, -HEAD_SIZE / 2 - 0.01);
    head.add(mouth);
  }
  torso.add(head);

  // One arm, at the right shoulder (+X when facing -Z).
  const { pivot: shoulder, hand } = createArm(color);
  shoulder.position.set(BODY_RADIUS + ARM_RADIUS + 0.02, BODY_HEIGHT - 0.1, 0);
  torso.add(shoulder);

  group.userData.player = { torso, head, shoulder, hand, walkPhase: 0, swingStart: -Infinity };
  return group;
}

export function swingPlayer(model) {
  model.userData.player.swingStart = performance.now();
}

// Per frame. speed: horizontal blocks/s; pitch: look pitch.
export function animatePlayer(model, { dt, speed, pitch, held }) {
  const p = model.userData.player;
  const walk = Math.min(1, speed / WALK_FULL_SPEED);
  if (walk > 0.05) p.walkPhase += speed * dt * WALK_PHASE_PER_BLOCK;
  else p.walkPhase = 0;
  const cycle = Math.sin(p.walkPhase);

  p.torso.rotation.z = cycle * WADDLE * walk;
  p.head.rotation.x = Math.max(-HEAD_PITCH_LIMIT, Math.min(HEAD_PITCH_LIMIT, pitch));

  // Swing: forward and back from the shoulder, over the walking swing.
  const t = (performance.now() - p.swingStart) / SWING_MS;
  const swing = t >= 0 && t < 1 ? Math.sin(Math.PI * t) * SWING_ANGLE : 0;
  p.shoulder.rotation.x = cycle * ARM_WALK_SWING * walk + swing;

  setHandItem(p.hand, held ?? null);
}
