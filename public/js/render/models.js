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
// Crouching: how much shorter the body gets, how far it leans forward, and
// how fast it eases between standing and crouched (per second).
const CROUCH_SQUASH = 0.15;
const CROUCH_LEAN = 0.35;
const CROUCH_EASE = 12;
// Shoulder angle holding a drawn bow out in front (arm level).
const BOW_AIM = Math.PI / 2;

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

export function createGliderModel() {
  const group = new THREE.Group();
  const hide = lambert(0x9b633d), rib = lambert(0x654329);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.65), hide);
    wing.position.set(side * 0.46, 0, 0);
    wing.rotation.z = side * 0.16;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.035, 0.05), rib);
    spar.position.set(side * 0.46, -0.04, 0.23);
    spar.rotation.z = side * 0.16;
    group.add(wing, spar);
  }
  return group;
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

// A thin box from point a to point b (THREE.Vector3s), for bow limbs and strings.
function rod(a, b, thickness, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, 1, thickness), material);
  placeRod(mesh, a, b, dir);
  return mesh;
}

function placeRod(mesh, a, b, dir = new THREE.Vector3().subVectors(b, a)) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(1, Math.max(dir.length(), 1e-4), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
}

// A bow laid out the way a hand holds it: limbs up and down (±Z in the hand's
// frame), bending back toward the archer (+Y), string between the tips, and
// the shot going forward (-Y). userData.bow lets setBowDraw pull the string.
const BOW_TIP = new THREE.Vector3(0, 0.12, 0.38);
const BOW_PULL = 0.28;
function createBow(color) {
  const group = new THREE.Group();
  const wood = lambert(color);
  const grip = new THREE.Vector3(0, 0, 0.07), gripLow = new THREE.Vector3(0, 0, -0.07);
  const top = BOW_TIP.clone(), bottom = BOW_TIP.clone().setZ(-BOW_TIP.z);
  group.add(rod(gripLow, grip, 0.05, wood), rod(grip, top, 0.035, wood), rod(gripLow, bottom, 0.035, wood));
  const stringMaterial = lambert(0xe8e2d0);
  const upper = rod(top, new THREE.Vector3(0, BOW_TIP.y, 0), 0.012, stringMaterial);
  const lower = rod(bottom, new THREE.Vector3(0, BOW_TIP.y, 0), 0.012, stringMaterial);
  // The arrow on the string, shown while drawing.
  const arrow = createArrowModel();
  arrow.scale.setScalar(0.8);
  arrow.visible = false;
  group.add(upper, lower, arrow);
  group.userData.bow = { upper, lower, arrow, top, bottom };
  return group;
}

// Pulls a bow model's string back by `amount` (0..1) and nocks an arrow.
export function setBowDraw(model, amount) {
  const bow = model?.userData.bow;
  if (!bow) return;
  const nock = new THREE.Vector3(0, BOW_TIP.y + BOW_PULL * amount, 0);
  placeRod(bow.upper, bow.top, nock);
  placeRod(bow.lower, bow.bottom, nock);
  bow.arrow.visible = amount > 0;
  // The arrow runs from the nock forward (-Y); its model points along +Z.
  bow.arrow.position.copy(nock);
  bow.arrow.rotation.set(Math.PI / 2, 0, 0);
}

// An arrow pointing along +Z (so lookAt aims it): shaft, head and fletching.
export function createArrowModel() {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.6), lambert(0xc9a26b));
  shaft.position.z = 0.3;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), lambert(0x8c8c8c));
  head.position.z = 0.62;
  const fletching = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.12), lambert(0xf2f2f2));
  fletching.position.z = 0.06;
  const fletching2 = fletching.clone();
  fletching2.rotation.z = Math.PI / 2;
  group.add(shaft, head, fletching, fletching2);
  return group;
}

// A cow, facing -Z like players: white body with black patches, a head with
// a pink snout and little horns, and four legs that swing as it walks.
const COW_LEG = 0.5;
export function createCowModel() {
  const group = new THREE.Group();
  const white = lambert(0xf0efe8), black = lambert(0x2a2a2a);
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  box(0.9, 0.7, 1.3, 0, COW_LEG + 0.35, 0, white);
  // Patches just proud of the body.
  box(0.02, 0.35, 0.45, 0.46, COW_LEG + 0.45, 0.2, black);
  box(0.02, 0.3, 0.35, -0.46, COW_LEG + 0.35, -0.25, black);
  box(0.5, 0.02, 0.4, 0.1, COW_LEG + 0.71, 0.3, black);
  // Head, snout, eyes, horns.
  box(0.5, 0.48, 0.42, 0, COW_LEG + 0.6, -0.84, white);
  box(0.36, 0.2, 0.08, 0, COW_LEG + 0.48, -1.08, lambert(0xe6a3a3));
  for (const x of [-0.14, 0.14]) {
    box(0.07, 0.07, 0.02, x, COW_LEG + 0.7, -1.06, black);
    box(0.06, 0.14, 0.06, x * 1.6, COW_LEG + 0.9, -0.8, lambert(0xd8d2c0));
  }
  // Legs hang from pivots at the top so they can swing.
  const legs = [];
  for (const [x, z] of [[-0.3, -0.45], [0.3, -0.45], [-0.3, 0.45], [0.3, 0.45]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, COW_LEG, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, COW_LEG, 0.2), white);
    leg.position.y = -COW_LEG / 2;
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.08, 0.21), black);
    hoof.position.y = -COW_LEG + 0.04;
    pivot.add(leg, hoof);
    group.add(pivot);
    legs.push(pivot);
  }
  group.userData.cow = { legs, phase: 0 };
  return group;
}

// Per frame: diagonal pairs of legs swing opposite ways while it walks.
export function animateCow(model, dt, speed) {
  const cow = model.userData.cow;
  const walk = Math.min(1, speed / 2);
  if (walk > 0.05) cow.phase += speed * dt * 3;
  const swing = Math.sin(cow.phase) * 0.6 * walk;
  cow.legs.forEach((leg, i) => { leg.rotation.x = (i === 0 || i === 3) ? swing : -swing; });
}

// A broad-winged dragon. Fire is a translucent cone from its mouth; the server
// decides when it breathes and which players the cone hits.
export function createDragonModel() {
  const group = new THREE.Group();
  const scales = lambert(0x923d35), dark = lambert(0x582d2a);
  const belly = lambert(0xb88056), horn = lambert(0xe8d6ad);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), scales);
  body.scale.set(0.75, 0.48, 1.28);
  body.position.set(0, 1.45, 0.15);
  const underbelly = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), belly);
  underbelly.scale.set(0.6, 0.25, 1.1);
  underbelly.position.set(0, 1.19, 0);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.9, 8), scales);
  neck.position.set(0, 1.62, -0.93);
  neck.rotation.x = -0.55;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.5, 0.76), scales);
  head.position.set(0, 1.82, -1.42);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.48), belly);
  muzzle.position.set(0, 1.66, -1.85);
  group.add(body, underbelly, neck, head, muzzle);
  const legs = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.03), lambert(0xffd650));
    eye.position.set(side * 0.18, 1.91, -1.82);
    const hornMesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 6), horn);
    hornMesh.position.set(side * 0.23, 2.25, -1.27);
    group.add(eye, hornMesh);
    for (const front of [false, true]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.52, 1.23, front ? -0.65 : 0.72);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.23, 0.65, 8), dark);
      leg.position.y = -0.33;
      pivot.add(leg);
      group.add(pivot);
      legs.push({ pivot, side, front });
    }
  }
  for (let i = 0; i < 3; i++) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32 - i * 0.08, 0.82, 8), scales);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 1.4 - i * 0.08, 1.38 + i * 0.62);
    group.add(tail);
  }
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.2, 2.15, 0.25, -0.35, 1.48, -0.15, 1.05, 0.25, -0.12, 0.8,
  ], 3));
  wingGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  wingGeometry.computeVertexNormals();
  const membrane = new THREE.MeshLambertMaterial({ color: 0x8b473b, side: THREE.DoubleSide });
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5, 1.86, 0.05);
    pivot.scale.x = side;
    pivot.add(new THREE.Mesh(wingGeometry, membrane));
    group.add(pivot);
    wings.push({ pivot, side });
  }
  const flame = new THREE.Group();
  flame.position.set(0, 1.7, -1.85);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(2.25, 12, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff6a19, transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide }));
  outer.rotation.x = Math.PI / 2;
  outer.position.set(0, 0, -6);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.9, 8, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd348, transparent: true, opacity: 0.52,
      depthWrite: false, side: THREE.DoubleSide }));
  inner.rotation.x = Math.PI / 2;
  inner.position.set(0, 0, -4);
  flame.add(outer, inner);
  flame.visible = false;
  group.add(flame);
  group.userData.dragon = { wings, legs, flame, phase: 0 };
  return group;
}

export function animateDragon(model, dt, breathing, walking, aimYaw = 0, aimPitch = 0) {
  const dragon = model.userData.dragon;
  dragon.phase += dt * (walking ? 8 : 5);
  for (const { pivot, side } of dragon.wings) {
    pivot.scale.x = side * (walking ? 0.4 : 1);
    pivot.rotation.z = side * (walking ? 0.1 : 0.1 + Math.sin(dragon.phase) * 0.28);
  }
  for (const { pivot, side, front } of dragon.legs) {
    pivot.rotation.x = walking ? Math.sin(dragon.phase + (front === (side > 0) ? 0 : Math.PI)) * 0.35 : 0;
  }
  dragon.flame.visible = breathing;
  dragon.flame.rotation.y = aimYaw;
  dragon.flame.rotation.x = aimPitch - model.rotation.x;
  if (breathing) dragon.flame.scale.setScalar(0.94 + Math.sin(dragon.phase * 3) * 0.06);
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
  if (def.tool === 'bow') return createBow(def.color);
  if (def.shape === 'seed') {
    const group = new THREE.Group();
    const seed = new THREE.Mesh(new THREE.SphereGeometry(blockSize * 0.38, 7, 5), lambert(0x8b6637));
    seed.position.y = blockSize * 0.35;
    const shoot = new THREE.Mesh(new THREE.ConeGeometry(blockSize * 0.23, blockSize * 0.5, 5), lambert(def.color));
    shoot.position.y = blockSize * 0.65;
    group.add(seed, shoot);
    return group;
  }
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
// hand's -Z out of the fist. Skips the work if it's already holding it.
export function setHandItem(hand, item) {
  if (hand.userData.item === item) return;
  hand.userData.item = item;
  for (const child of [...hand.children]) {
    hand.remove(child);
    child.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  if (item === null) return;
  const model = createItemModel(item, 0.2);
  // Tools are modeled along +Y (handle or grip at the bottom). Tip that forward
  // to the hand's -Z, out of the fist. A hammer also turns a quarter-turn about
  // its own handle first (Y is applied before X), so the head's striking face,
  // not its side, faces the way it swings. Blocks just sit in the fist.
  const tool = getItemDef(item).tool;
  if (tool === 'hammer') model.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
  else if (tool === 'bow') model.position.set(0, -0.02, 0); // built in the hand's frame already
  else if (tool) model.rotation.x = -Math.PI / 2;
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

  const armorMaterial = lambert(0x87512f);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(BODY_RADIUS + 0.045, BODY_RADIUS + 0.045, BODY_HEIGHT * 0.8, 16), armorMaterial);
  chest.position.y = BODY_HEIGHT * 0.52;
  torso.add(chest);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(HEAD_SIZE + 0.09, HEAD_SIZE * 0.42, HEAD_SIZE + 0.09), armorMaterial);
  helmet.position.y = skull.position.y + HEAD_SIZE * 0.31;
  head.add(helmet);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(ARM_RADIUS + 0.035, ARM_RADIUS + 0.035, ARM_LENGTH * 0.7, 10), armorMaterial);
  sleeve.position.y = -ARM_LENGTH * 0.36;
  shoulder.add(sleeve);
  const glider = createGliderModel();
  glider.position.y = PLAYER_HEIGHT + 0.24;
  glider.visible = false;
  torso.add(glider);
  chest.visible = helmet.visible = sleeve.visible = false;

  group.userData.player = { torso, head, shoulder, hand, armorParts: [chest, helmet, sleeve], armorMaterial, glider, walkPhase: 0, swingStart: -Infinity, crouch: 0 };
  return group;
}

export function swingPlayer(model) {
  model.userData.player.swingStart = performance.now();
}

// The item model a hand is holding, or null.
export function handItem(hand) {
  return hand.children[0] ?? null;
}

// Per frame. speed: horizontal blocks/s; pitch: look pitch; crouching: squash
// and lean; draw: how far a bow is drawn (0..1), which raises the arm forward.
export function animatePlayer(model, { dt, speed, pitch, held, armor = null, crouching = false, draw = 0, gliding = false }) {
  const p = model.userData.player;
  p.glider.visible = gliding;
  p.armorParts.forEach((part) => { part.visible = armor !== null; });
  if (armor !== null) p.armorMaterial.color.setHex(getItemDef(armor).color);
  p.crouch += ((crouching ? 1 : 0) - p.crouch) * Math.min(1, dt * CROUCH_EASE);
  p.torso.scale.y = 1 - CROUCH_SQUASH * p.crouch;
  // Negative X rotation tips the top toward the front (-Z).
  p.torso.rotation.x = -CROUCH_LEAN * p.crouch;
  const walk = Math.min(1, speed / WALK_FULL_SPEED);
  if (walk > 0.05) p.walkPhase += speed * dt * WALK_PHASE_PER_BLOCK;
  else p.walkPhase = 0;
  const cycle = Math.sin(p.walkPhase);

  p.torso.rotation.z = cycle * WADDLE * walk;
  p.head.rotation.x = Math.max(-HEAD_PITCH_LIMIT, Math.min(HEAD_PITCH_LIMIT, pitch));

  // Swing: forward and back from the shoulder, over the walking swing.
  const t = (performance.now() - p.swingStart) / SWING_MS;
  const swing = t >= 0 && t < 1 ? Math.sin(Math.PI * t) * SWING_ANGLE : 0;
  p.shoulder.rotation.x = draw > 0 ? BOW_AIM + pitch * 0.8 : cycle * ARM_WALK_SWING * walk + swing;

  setHandItem(p.hand, held ?? null);
  setBowDraw(handItem(p.hand), draw);
}
