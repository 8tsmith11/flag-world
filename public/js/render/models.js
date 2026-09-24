// 3D models shared by the world, the first-person view and the inventory
// preview: the player (body, head with a face, one arm with a fist that holds
// the item in hand) and item models (block cubes and tools).

import * as THREE from 'three';
import { PLAYER_HEIGHT } from '/shared/config.js';
import { getItemDef } from '/shared/items.js';
import { getBlockDef } from '/shared/blocks.js';
import { ITEM } from '/shared/itemIds.js';

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
const FROST_FLAKES = 14;
// Seconds for a frost flake to drift from head to feet.
const FROST_FALL_TIME = 1.4;

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

export function placeRod(mesh, a, b, dir = new THREE.Vector3().subVectors(b, a)) {
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

// A Wind Axe standing on its handle: a pale double-bitted head with swept
// blades, and a ring of wind curling around it.
function createWindAxe(color) {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.56, 8), lambert(0x7b6a55));
  handle.position.y = 0.28;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 8), lambert(0xe6f6f8));
  collar.position.y = 0.5;
  group.add(handle, collar);
  const blade = lambert(color);
  for (const side of [-1, 1]) {
    // Each bit flares from the collar out to a tall, curved edge.
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.035), blade);
    cheek.position.set(side * 0.08, 0.5, 0);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.025), blade);
    edge.position.set(side * 0.16, 0.5, 0);
    edge.rotation.z = side * 0.18;
    group.add(cheek, edge);
  }
  const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 5, 20, Math.PI * 1.5),
    new THREE.MeshBasicMaterial({ color: 0xf2fdff, transparent: true, opacity: 0.7 }));
  swirl.rotation.x = Math.PI / 2;
  swirl.position.y = 0.5;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 6), lambert(0xe6f6f8));
  tip.position.y = 0.61;
  group.add(swirl, tip);
  return group;
}

// An Ice Sword standing on its pommel: a frosty crystal guard and a
// translucent faceted blade tapering to a point.
function createIceSword(color) {
  const group = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), lambert(0x33506b));
  grip.position.y = 0.07;
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), lambert(0xdff6ff));
  const guard = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), lambert(0xc6ecfb));
  guard.scale.set(1.2, 0.35, 0.5);
  guard.position.y = 0.16;
  const ice = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82 });
  // Four radial segments make a diamond cross-section.
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.46, 4), ice);
  blade.scale.z = 0.4;
  blade.position.y = 0.41;
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), ice);
  point.scale.z = 0.4;
  point.position.y = 0.7;
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), lambert(0xffffff));
  shard.position.set(0.05, 0.22, 0);
  group.add(grip, pommel, guard, blade, point, shard);
  return group;
}

// A crossbow in the hand's frame like the bow: the stock runs along Y (butt
// toward the archer at +Y, the shot going forward, -Y), the limbs cross it at
// the front along X, bending back, with the string between their tips.
// userData.crossbow lets setBowDraw pull the string and show the bolt.
const CROSSBOW_FRONT = -0.3;
const CROSSBOW_TIP = new THREE.Vector3(0.3, CROSSBOW_FRONT + 0.08, 0.04);
const CROSSBOW_PULL = 0.2;
function createCrossbow(color) {
  const group = new THREE.Group();
  const wood = lambert(color), iron = lambert(0x8c8c8c);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), wood);
  stock.position.set(0, -0.08, 0.03);
  const butt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.13), wood);
  butt.position.set(0, 0.18, 0);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.07), iron);
  trigger.position.set(0, 0.05, -0.04);
  const center = new THREE.Vector3(0, CROSSBOW_FRONT, 0.04);
  const left = CROSSBOW_TIP.clone().setX(-CROSSBOW_TIP.x);
  group.add(stock, butt, trigger, rod(center, CROSSBOW_TIP, 0.035, iron), rod(center, left, 0.035, iron));
  const stringMaterial = lambert(0xe8e2d0);
  const rest = new THREE.Vector3(0, CROSSBOW_TIP.y, CROSSBOW_TIP.z);
  const right = rod(CROSSBOW_TIP, rest, 0.012, stringMaterial);
  const leftString = rod(left, rest, 0.012, stringMaterial);
  const bolt = createArrowModel();
  bolt.scale.set(1, 1, 0.55);
  bolt.visible = false;
  group.add(right, leftString, bolt);
  group.userData.crossbow = { right, leftString, bolt, tip: CROSSBOW_TIP, left };
  return group;
}

const ROPE_COLOR = 0xb89a62;

// A grappling hook head: a shaft with three curved prongs, pointing along +Y.
export function createHookHead() {
  const group = new THREE.Group();
  const iron = lambert(0x8d9299);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6), iron);
  shaft.position.y = 0.1;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6), iron);
  tip.position.y = 0.23;
  group.add(shaft, tip);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const prong = new THREE.Group();
    prong.rotation.y = angle;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.025), iron);
    arm.position.set(0.045, 0.06, 0);
    arm.rotation.z = -0.9;
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), iron);
    barb.position.set(0.09, 0.12, 0);
    prong.add(arm, barb);
    group.add(prong);
  }
  return group;
}

// A grappling hook standing on its grip: a launcher barrel wrapped in a coil
// of rope, with the hook head seated in its muzzle.
function createGrapplingHook(color) {
  const group = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), lambert(0x4a3524));
  grip.position.y = 0.07;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 10), lambert(color));
  barrel.position.y = 0.28;
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 6, 14), lambert(ROPE_COLOR));
  coil.rotation.x = Math.PI / 2;
  coil.position.y = 0.24;
  const coil2 = coil.clone();
  coil2.position.y = 0.29;
  const head = createHookHead();
  head.position.y = 0.42;
  group.add(grip, barrel, coil, coil2, head);
  return group;
}

// A bundle of rope: a few stacked coils with a tie around them.
function createRopeBundle(color, size) {
  const group = new THREE.Group();
  const rope = lambert(color);
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(size * 0.38, size * 0.11, 6, 14), rope);
    coil.rotation.x = Math.PI / 2;
    coil.position.y = size * (0.12 + i * 0.2);
    group.add(coil);
  }
  const tie = new THREE.Mesh(new THREE.BoxGeometry(size * 0.12, size * 0.7, size * 0.95), lambert(0x7a5a33));
  tie.position.y = size * 0.32;
  group.add(tie);
  return group;
}

// Small world/hand models for equipment and loot that has no tool model.
function createEquipmentItem(item, def, size) {
  const group = new THREE.Group();
  const add = (geometry, color, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, lambert(color));
    mesh.position.set(x * size, y * size, z * size);
    group.add(mesh);
    return mesh;
  };
  if (item === ITEM.WIND_BOOTS || item === ITEM.SPRING_BOOTS) {
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(size * 0.36, size * 0.5, size * 0.5), def.color, side * 0.25, 0.4);
      add(new THREE.BoxGeometry(size * 0.38, size * 0.15, size * 0.7), 0x53626b, side * 0.25, 0.09, -0.08);
      if (item === ITEM.WIND_BOOTS) {
        const wing = add(new THREE.ConeGeometry(size * 0.18, size * 0.42, 4), 0x8ec8dc, side * 0.46, 0.53);
        wing.rotation.z = side * 0.5;
      } else {
        for (const y of [0.16, 0.28]) {
          const coil = add(new THREE.TorusGeometry(size * 0.15, size * 0.035, 5, 10), 0xb99b5c, side * 0.25, y);
          coil.rotation.x = Math.PI / 2;
        }
      }
    }
  } else if (item === ITEM.HEART_AMULET || item === ITEM.MENDING_CHARM || item === ITEM.EMBER_HEART) {
    const gem = add(new THREE.OctahedronGeometry(size * (item === ITEM.MENDING_CHARM ? 0.36 : 0.43)), def.color, 0, 0.45);
    if (item === ITEM.MENDING_CHARM) gem.rotation.z = Math.PI / 4;
    const loop = add(new THREE.TorusGeometry(size * 0.36, size * 0.035, 5, 16), 0xd6c28e, 0, 0.53, 0.02);
    loop.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(size * 0.1, 6, 4), 0xfff1b6, 0, 0.88);
  } else if (item === ITEM.RIFT_ORB) {
    add(new THREE.SphereGeometry(size * 0.48, 12, 8), 0x674693, 0, 0.5);
    add(new THREE.SphereGeometry(size * 0.27, 10, 7), def.color, 0, 0.5, -0.28);
  } else if (item === ITEM.FLIGHT_ORB) {
    add(new THREE.IcosahedronGeometry(size * 0.38, 1), def.color, 0, 0.5);
    const ring = add(new THREE.TorusGeometry(size * 0.53, size * 0.045, 5, 16), 0xd5e7ff, 0, 0.5);
    ring.rotation.x = 0.5;
  } else if (def.shape === 'bucket') {
    add(new THREE.CylinderGeometry(size * 0.4, size * 0.32, size * 0.55, 8, 1, true), 0xa6a9ad, 0, 0.31);
    add(new THREE.CylinderGeometry(size * 0.32, size * 0.32, size * 0.05, 8), def.block === null ? 0x777b80 : def.color, 0, 0.57);
    const handle = add(new THREE.TorusGeometry(size * 0.38, size * 0.035, 5, 12, Math.PI), 0xd9d9de, 0, 0.67);
    handle.rotation.z = Math.PI;
  } else if (def.shape === 'armor') {
    add(new THREE.BoxGeometry(size * 0.68, size * 0.68, size * 0.3), def.color, 0, 0.5);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(size * 0.22, size * 0.35, size * 0.35), def.color, side * 0.44, 0.66);
    add(new THREE.BoxGeometry(size * 0.42, size * 0.16, size * 0.32), 0x514238, 0, 0.12);
  } else if (def.shape === 'glider') {
    const glider = createGliderModel();
    glider.scale.setScalar(size * 0.6);
    glider.position.y = size * 0.42;
    group.add(glider);
  } else if (def.shape === 'beef') {
    const meat = add(new THREE.SphereGeometry(size * 0.42, 7, 5), def.color, -0.12, 0.44);
    meat.scale.set(1.2, 0.7, 0.65);
    add(new THREE.BoxGeometry(size * 0.38, size * 0.12, size * 0.13), 0xe6d7bd, 0.28, 0.4);
  } else if (def.shape === 'leather') {
    const hide = add(new THREE.BoxGeometry(size * 0.8, size * 0.06, size * 0.66), def.color, 0, 0.14);
    hide.rotation.y = 0.2;
  } else if (def.shape === 'egg') {
    const shell = add(new THREE.SphereGeometry(size * 0.42, 10, 8), def.color, 0, 0.5);
    shell.scale.y = 1.25;
    for (const [x, y, z] of [[-0.17, 0.36, -0.37], [0.2, 0.64, -0.34], [0, 0.2, -0.4]]) {
      add(new THREE.SphereGeometry(size * 0.09, 6, 5), def.spots, x, y, z);
    }
  }
  return group;
}

// Pulls a bow model's string back by `amount` (0..1) and nocks an arrow. For a
// crossbow, `amount` is how far it's loaded; the bolt shows once it's loaded.
export function setBowDraw(model, amount) {
  const crossbow = model?.userData.crossbow;
  if (crossbow) {
    const nock = new THREE.Vector3(0, CROSSBOW_TIP.y + CROSSBOW_PULL * amount, CROSSBOW_TIP.z);
    placeRod(crossbow.right, crossbow.tip, nock);
    placeRod(crossbow.leftString, crossbow.left, nock);
    crossbow.bolt.visible = amount >= 1;
    crossbow.bolt.position.set(0, nock.y, 0.08);
    crossbow.bolt.rotation.set(Math.PI / 2, 0, 0);
    return;
  }
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

// A Crawler, facing -Z: a low, wide body and abdomen, a small head with red
// eyes, and eight legs (two jointed segments each) that step as it walks.
// userData.crawler.climb tips the whole model up a wall.
export function createCrawlerModel() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const shell = lambert(0x2b2622), dark = lambert(0x1a1715);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), shell);
  thorax.scale.set(0.34, 0.2, 0.3);
  thorax.position.set(0, 0.4, -0.05);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), shell);
  abdomen.scale.set(0.42, 0.28, 0.5);
  abdomen.position.set(0, 0.45, 0.6);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.6), lambert(0x7a2a24));
  stripe.position.set(0, 0.73, 0.6);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dark);
  head.scale.set(0.2, 0.16, 0.18);
  head.position.set(0, 0.4, -0.38);
  body.add(thorax, abdomen, stripe, head);
  const eye = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  for (const [x, y] of [[-0.08, 0.47], [0.08, 0.47], [-0.04, 0.52], [0.04, 0.52]]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), eye);
    e.position.set(x, y, -0.55);
    body.add(e);
  }
  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      // Hip on the thorax; the upper segment reaches up and out, the lower down to the ground.
      const hip = new THREE.Group();
      hip.position.set(side * 0.22, 0.42, -0.25 + i * 0.13);
      hip.rotation.y = side * (-0.6 + i * 0.4);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.05), dark);
      upper.position.set(side * 0.19, 0.12, 0);
      upper.rotation.z = side * 0.55;
      const knee = new THREE.Group();
      knee.position.set(side * 0.38, 0.23, 0);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), dark);
      lower.position.set(side * 0.08, -0.3, 0);
      lower.rotation.z = side * 0.25;
      knee.add(lower);
      hip.add(upper, knee);
      body.add(hip);
      legs.push({ hip, side, index: i, rest: hip.rotation.y });
    }
  }
  group.userData.crawler = { body, legs, phase: 0, climb: 0 };
  return group;
}

// Per frame: legs step in alternating sets of four; climbing tips it up.
export function animateCrawler(model, dt, speed, climbing) {
  const c = model.userData.crawler;
  const walk = Math.min(1, speed / 3);
  if (walk > 0.05 || climbing) c.phase += dt * 14;
  for (const leg of c.legs) {
    const alternate = (leg.index + (leg.side > 0 ? 1 : 0)) % 2 ? 1 : -1;
    const swing = Math.sin(c.phase) * alternate * (climbing ? 1 : walk);
    leg.hip.rotation.y = leg.rest + swing * 0.35;
    leg.hip.rotation.z = Math.max(0, -swing) * 0.3 * leg.side;
  }
  c.climb += ((climbing ? 1 : 0) - c.climb) * Math.min(1, dt * 8);
  c.body.rotation.x = c.climb * Math.PI * 0.42;
  c.body.position.y = c.climb * 0.3;
}

// A Void Eel: a head (the entity's position) and a chain of shrinking body
// segments that trail along the path the head swam, undulating side to side.
// The group itself isn't turned; animateEel places everything in world space
// relative to the head.
const EEL_SEGMENTS = 14;
const EEL_SPACING = 0.55;
export function createEelModel() {
  const group = new THREE.Group();
  const skin = lambert(0x2c2447), belly = lambert(0x6b4e9e), glow = new THREE.MeshBasicMaterial({ color: 0x9be7ff });
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), skin);
  skull.scale.set(0.42, 0.34, 0.62);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.6), belly);
  jaw.position.set(0, -0.2, -0.25);
  head.add(skull, jaw);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), glow);
    eye.position.set(side * 0.24, 0.1, -0.42);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 4), belly);
    fin.position.set(side * 0.3, 0.18, 0.2);
    fin.rotation.z = -side * 1.1;
    head.add(eye, fin);
  }
  head.position.y = 0.4;
  group.add(head);
  const segments = [];
  for (let i = 0; i < EEL_SEGMENTS; i++) {
    const t = i / EEL_SEGMENTS;
    const segment = new THREE.Mesh(new THREE.SphereGeometry(0.36 * (1 - t * 0.75), 10, 7), i % 2 ? skin : belly);
    segment.scale.z = 1.4;
    group.add(segment);
    segments.push(segment);
  }
  segments.at(-1).material = new THREE.MeshBasicMaterial({ color: 0x76b7cf });
  group.userData.eel = { head, segments, skin, belly, trail: [], time: Math.random() * 10 };
  return group;
}

// Per frame, with the head's world position (the group's position), yaw and pitch.
export function animateEel(model, dt, yaw, pitch, coiling = false, night = false) {
  const eel = model.userData.eel;
  eel.time += dt;
  eel.skin.emissive.setHex(coiling ? 0x7442a5 : night ? 0x15142a : 0x080611);
  eel.belly.emissive.setHex(coiling ? 0x8b5bb7 : night ? 0x201840 : 0x0d0820);
  const p = model.position;
  const head = new THREE.Vector3(p.x, p.y + 0.4, p.z);
  const trail = eel.trail;
  // Seed the trail straight out behind the head the first time.
  if (!trail.length) {
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (let i = 0; i <= EEL_SEGMENTS + 1; i++) trail.push(head.clone().addScaledVector(back, i * EEL_SPACING));
  }
  if (trail[0].distanceTo(head) > 0.05) trail.unshift(head.clone());
  // Keep only as much trail as the body covers.
  let length = 0;
  for (let i = 1; i < trail.length; i++) {
    length += trail[i].distanceTo(trail[i - 1]);
    if (length > (EEL_SEGMENTS + 2) * EEL_SPACING) { trail.length = i + 1; break; }
  }
  eel.head.rotation.set(pitch, yaw, 0, 'YXZ');
  // Each segment sits at its distance along the trail, swaying across it.
  let walked = 0, index = 1;
  let previous = head;
  eel.segments.forEach((segment, i) => {
    const want = (i + 1) * EEL_SPACING;
    while (index < trail.length - 1 && walked + trail[index].distanceTo(trail[index - 1]) < want) {
      walked += trail[index].distanceTo(trail[index - 1]);
      index++;
    }
    const a = trail[index - 1], b = trail[Math.min(index, trail.length - 1)];
    const span = a.distanceTo(b) || 1;
    const point = a.clone().lerp(b, Math.min(1, (want - walked) / span));
    const along = previous.clone().sub(point).normalize();
    const across = Math.abs(along.y) > 0.8
      ? new THREE.Vector3(0, -along.z, along.y).normalize()
      : new THREE.Vector3(-along.z, 0, along.x).normalize();
    point.addScaledVector(across, Math.sin(eel.time * (coiling ? 8 : 2.2) - i * 0.6)
      * (coiling ? 0.34 : 0.18) * (0.3 + i / EEL_SEGMENTS));
    segment.position.copy(point).sub(p);
    if (along.lengthSq() > 0) segment.lookAt(p.x + segment.position.x + along.x, p.y + segment.position.y + along.y,
      p.z + segment.position.z + along.z);
    previous = point;
  });
}

// An anvil, facing -Z with its horn toward +X: a wide base, a narrow waist
// and a flat face with a horn at one end, in dark iron.
export function createAnvilModel(size = 1) {
  const group = new THREE.Group();
  const iron = lambert(0x3b3d42), edge = lambert(0x55585f);
  for (const { box, material } of ANVIL_PARTS.map((part) => ({ ...part, material: part.light ? edge : iron }))) {
    const [x0, y0, z0, x1, y1, z1] = box;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * size, (y1 - y0) * size, (z1 - z0) * size), material);
    mesh.position.set(((x0 + x1) / 2 - 0.5) * size, ((y0 + y1) / 2) * size, ((z0 + z1) / 2 - 0.5) * size);
    group.add(mesh);
  }
  return group;
}
// The same boxes as the mesher's anvil block (unit cell, facing north).
export const ANVIL_PARTS = [
  { box: [0.12, 0, 0.2, 0.88, 0.14, 0.8] },
  { box: [0.22, 0.14, 0.3, 0.78, 0.26, 0.7] },
  { box: [0.35, 0.26, 0.38, 0.65, 0.58, 0.62] },
  { box: [0.14, 0.58, 0.28, 0.8, 0.9, 0.72] },
  { box: [0.14, 0.88, 0.28, 0.8, 0.92, 0.72], light: true },
  { box: [0.8, 0.64, 0.36, 0.92, 0.88, 0.64] },
  { box: [0.92, 0.7, 0.42, 1, 0.84, 0.58] },
];

// Dark overlapping scales for Dragonscale Armor, made once on first use.
let scaleTexture = null;
function dragonScaleTexture() {
  if (scaleTexture || typeof document === 'undefined') return scaleTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1d1519';
  ctx.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const x = col * 8 + (row % 2) * 4, y = row * 7;
      const g = ctx.createLinearGradient(x, y, x, y + 8);
      g.addColorStop(0, '#6e2f36');
      g.addColorStop(1, '#2a1c22');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + 4, y + 2, 4.2, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
    }
  }
  scaleTexture = new THREE.CanvasTexture(canvas);
  scaleTexture.wrapS = scaleTexture.wrapT = THREE.RepeatWrapping;
  scaleTexture.repeat.set(3, 3);
  scaleTexture.magFilter = THREE.NearestFilter;
  scaleTexture.colorSpace = THREE.SRGBColorSpace;
  return scaleTexture;
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
  if (def.tool === 'windAxe') return createWindAxe(def.color);
  if (def.tool === 'iceSword') return createIceSword(def.color);
  if (def.tool === 'crossbow') return createCrossbow(def.color);
  if (def.tool === 'grapple') return createGrapplingHook(def.color);
  if (def.shape === 'rope') return createRopeBundle(def.color, blockSize);
  if (def.shape === 'accessory' || ['rift', 'bucket', 'armor', 'glider', 'beef', 'leather', 'egg'].includes(def.shape)) {
    return createEquipmentItem(item, def, blockSize);
  }
  if (def.block !== null && getBlockDef(def.block).shape === 'anvil') {
    const group = new THREE.Group();
    const anvil = createAnvilModel(blockSize * 1.3);
    group.add(anvil);
    return group;
  }
  if (def.shape === 'scale' || def.shape === 'silk') {
    const group = new THREE.Group();
    const mesh = def.shape === 'scale'
      ? new THREE.Mesh(new THREE.CylinderGeometry(blockSize * 0.5, blockSize * 0.5, blockSize * 0.12, 6), lambert(def.color))
      : new THREE.Mesh(new THREE.SphereGeometry(blockSize * 0.4, 8, 6), lambert(def.color));
    mesh.position.y = blockSize * 0.25;
    if (def.shape === 'silk') mesh.scale.set(1, 0.7, 1.3);
    group.add(mesh);
    return group;
  }
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
  else if (tool === 'windAxe') model.rotation.set(-Math.PI / 2, Math.PI / 2, Math.PI / 2, 'ZXY');
  else if (tool === 'crossbow') {
    model.scale.setScalar(1.25);
    model.position.set(0, 0.07, -0.15);
  }
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

  const accessoryParts = new Map();
  const addAccessory = (item, part) => {
    part.visible = false;
    torso.add(part);
    accessoryParts.set(item, part);
  };
  const wind = new THREE.Group();
  const spring = new THREE.Group();
  for (const side of [-1, 1]) {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.34), lambert(0xd9edf0));
    shell.position.set(side * 0.16, 0.13, -0.08);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 5), lambert(0xa8dce7));
    fin.position.set(side * 0.28, 0.25, 0.03);
    fin.rotation.z = side * 0.7;
    wind.add(shell, fin);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.025, 6, 12), lambert(0xc9a466));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(side * 0.17, 0.16, -0.06);
    spring.add(coil);
  }
  addAccessory(ITEM.WIND_BOOTS, wind);
  addAccessory(ITEM.SPRING_BOOTS, spring);
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), lambert(0xdb3449));
  heart.position.set(0, 0.83, -BODY_RADIUS - 0.07);
  addAccessory(ITEM.HEART_AMULET, heart);
  const mending = new THREE.Mesh(new THREE.OctahedronGeometry(0.11),
    new THREE.MeshBasicMaterial({ color: 0x79ebbb }));
  mending.position.set(0.15, 0.29, -BODY_RADIUS - 0.03);
  addAccessory(ITEM.MENDING_CHARM, mending);
  const ember = new THREE.Mesh(new THREE.OctahedronGeometry(0.17),
    new THREE.MeshBasicMaterial({ color: 0xff842b }));
  ember.position.set(0, 0.84, -BODY_RADIUS - 0.08);
  addAccessory(ITEM.EMBER_HEART, ember);
  const orbOrbit = new THREE.Group();
  orbOrbit.position.y = 0.95;
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 1),
    new THREE.MeshBasicMaterial({ color: 0x9bcaff }));
  orb.position.x = BODY_RADIUS + 0.23;
  orbOrbit.add(orb);
  orbOrbit.visible = false;
  torso.add(orbOrbit);

  // Frost: flakes drifting down around the body while an Ice Sword slows them.
  const frost = new THREE.Group();
  const flakeMaterial = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.85 });
  const flakeGeometry = new THREE.OctahedronGeometry(0.045);
  for (let i = 0; i < FROST_FLAKES; i++) {
    const flake = new THREE.Mesh(flakeGeometry, flakeMaterial);
    flake.userData.flake = { angle: i * 2.4, radius: 0.35 + (i % 3) * 0.08, phase: i / FROST_FLAKES };
    frost.add(flake);
  }
  frost.visible = false;
  group.add(frost);

  group.userData.player = { torso, head, shoulder, hand, armorParts: [chest, helmet, sleeve], armorMaterial, glider,
    accessoryParts, orbOrbit, frost, walkPhase: 0, swingStart: -Infinity, crouch: 0 };
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
export function animatePlayer(model, { dt, speed, pitch, held, armor = null, accessory = null,
  crouching = false, draw = 0, gliding = false, slowed = false, orbActive = false }) {
  const p = model.userData.player;
  p.glider.visible = gliding;
  p.orbOrbit.visible = orbActive;
  if (orbActive) p.orbOrbit.rotation.y += dt * 1.5;
  p.frost.visible = slowed;
  if (slowed) {
    // Flakes spiral down from above the head and start over at the top.
    const time = performance.now() / 1000;
    for (const flake of p.frost.children) {
      const f = flake.userData.flake;
      const t = (time / FROST_FALL_TIME + f.phase) % 1;
      const angle = f.angle + time * 1.5;
      flake.position.set(Math.cos(angle) * f.radius, PLAYER_HEIGHT * (1.05 - t), Math.sin(angle) * f.radius);
      flake.rotation.set(time * 2 + f.angle, time * 3, 0);
    }
  }
  p.armorParts.forEach((part) => { part.visible = armor !== null; });
  if (armor !== null) {
    // Dragonscale's pieces are textured with scales; the rest are plain colors.
    const map = getItemDef(armor).texture === 'scales' ? dragonScaleTexture() : null;
    if (p.armorMaterial.map !== map) {
      p.armorMaterial.map = map;
      p.armorMaterial.needsUpdate = true;
    }
    p.armorMaterial.color.setHex(map ? 0xffffff : getItemDef(armor).color);
  }
  for (const [item, part] of p.accessoryParts) part.visible = item === accessory;
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
