// Monkey NPC models: the Wise Monkeys (orangutans in their team's color) and
// the Ancient Monkeys (huge weathered gorillas with an elemental tint). Both
// share one rig of pivots, built facing -Z with the origin at the feet (or
// the seat, when sitting):
//   body -> torso -> neck -> head (-> jaw), shoulders -> elbows
//   pelvis -> hips -> knees (not pitched with the body)
// Poses are joint targets the rig eases toward, so standing up and sitting
// down blend smoothly; walking, breathing, chest beats, chin scratches and
// head turns are layered on top. Server snapshots carry the pose ('sit',
// 'stand', 'walk', 'look') and a head turn toward the nearest player.

import * as THREE from 'three';
import { TEAMS } from '/shared/protocol.js';
import { NPC_DEFS } from '/shared/npcs.js';

const lambert = (color) => new THREE.MeshLambertMaterial({ color });
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const approach = (value, target, rate, dt) => value + (target - value) * Math.min(1, rate * dt);

// Sizes in blocks before the model's overall scale.
const APES = {
  orangutan: {
    scale: 1.2, hipWidth: 0.34, torso: [1.05, 1.05, 0.8], belly: 0.28, shoulderWidth: 0.6,
    upperArm: 0.85, foreArm: 0.8, arm: 0.2, hand: 0.24, thigh: 0.45, shin: 0.45, leg: 0.24, foot: [0.24, 0.1, 0.36],
    head: 0.55, poseRate: 2.5, breath: 3.4,
  },
  gorilla: {
    scale: 1.35, hipWidth: 0.42, torso: [1.4, 1.4, 1], belly: 0.2, shoulderWidth: 0.82,
    upperArm: 0.95, foreArm: 0.9, arm: 0.34, hand: 0.36, thigh: 0.55, shin: 0.55, leg: 0.36, foot: [0.34, 0.14, 0.5],
    head: 0.68, poseRate: 1.6, breath: 4.6,
  },
};

// Joint targets per pose: hip height (fraction of leg length, 0 = on the
// ground/seat), torso pitch (negative leans forward), thigh and knee, and
// shoulder and elbow (positive swings forward).
const POSES = {
  // On a seat: thighs forward, shins hanging, hands in the lap.
  chair: { hip: 0.12, pitch: -0.05, thigh: 1.5, knee: -1.45, shoulder: 0.3, elbow: 1, spread: 0.15 },
  // On the ground: knees up, knuckles resting in front.
  sit: { hip: 0.35, pitch: -0.12, thigh: 1.75, knee: -2, shoulder: 0.5, elbow: -0.15, spread: 0.2 },
  // Upright on its legs, arms raised to the chest.
  stand: { hip: 1, pitch: -0.1, thigh: 0.05, knee: -0.1, shoulder: 0.85, elbow: 1.9, spread: -0.45 },
  // On all fours, knuckles on the ground.
  walk: { hip: 0.95, pitch: -0.85, thigh: 0.25, knee: -0.2, shoulder: 0.85, elbow: -0.1, spread: 0.1 },
  look: { hip: 0.95, pitch: -0.8, thigh: 0.25, knee: -0.2, shoulder: 0.8, elbow: -0.1, spread: 0.1 },
};

// Water: blue-green; lightning: pale violet-white.
const ELEMENTS = {
  water: { tint: 0x3d8f8a, glow: 0x7fe8dc, moss: 0x4e6b45 },
  lightning: { tint: 0xd8cff5, glow: 0xe6ddff, moss: 0x8c86a3 },
};

function ape(kind, colors) {
  const d = APES[kind], root = new THREE.Group();
  const fur = lambert(colors.fur), skin = lambert(colors.skin), dark = lambert(colors.dark);
  const box = (parent, [w, h, dd], [x, y, z], material, rotation = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotation;
    parent.add(mesh);
    return mesh;
  };
  const pivot = (parent, x, y, z) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  };
  const inner = pivot(root, 0, 0, 0);
  inner.scale.setScalar(d.scale);
  const body = pivot(inner, 0, 0, 0), pelvis = pivot(inner, 0, 0, 0);
  const [tw, th, td] = d.torso;
  const torso = pivot(body, 0, 0, 0);
  box(torso, [tw * 0.8, th * 0.45, td * 0.85], [0, th * 0.22, 0], fur);
  box(torso, [tw, th * 0.6, td], [0, th * 0.66, 0], fur);
  box(torso, [tw * 0.65, th * 0.45, d.belly], [0, th * 0.4, -td * 0.42], skin);
  const neck = pivot(torso, 0, th * 0.92, -td * 0.05);
  const head = pivot(neck, 0, 0, 0);
  const s = d.head;
  box(head, [s, s * 0.9, s * 0.9], [0, s * 0.45, 0], fur);
  box(head, [s * 0.7, s * 0.55, 0.06], [0, s * 0.42, -s * 0.47], skin);
  const eyes = [];
  for (const x of [-0.14, 0.14]) eyes.push(box(head, [s * 0.1, s * 0.08, 0.04], [x * s * 1.6, s * 0.55, -s * 0.51], colors.eye));
  const jaw = pivot(head, 0, s * 0.22, -s * 0.3);
  box(jaw, [s * 0.5, s * 0.2, s * 0.35], [0, -s * 0.05, -s * 0.12], skin);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const shoulder = pivot(torso, side * d.shoulderWidth, th * 0.85, 0);
    box(shoulder, [d.arm, d.upperArm, d.arm], [0, -d.upperArm / 2, 0], fur);
    const elbow = pivot(shoulder, 0, -d.upperArm, 0);
    box(elbow, [d.arm * 0.9, d.foreArm, d.arm * 0.9], [0, -d.foreArm / 2, 0], fur);
    box(elbow, [d.hand, d.hand * 0.7, d.hand], [0, -d.foreArm - d.hand * 0.25, 0], dark);
    arms.push({ shoulder, elbow, side });
    const hip = pivot(pelvis, side * d.hipWidth, 0, 0);
    box(hip, [d.leg, d.thigh, d.leg], [0, -d.thigh / 2, 0], fur);
    const knee = pivot(hip, 0, -d.thigh, 0);
    box(knee, [d.leg * 0.9, d.shin, d.leg * 0.9], [0, -d.shin / 2, 0], fur);
    box(knee, d.foot, [0, -d.shin, -d.foot[2] * 0.25], dark);
    legs.push({ hip, knee, side });
  }
  root.userData.monkey = {
    kind, d, body, pelvis, torso, neck, head, jaw, arms, legs, eyes, fur, skin, dark,
    pose: { ...POSES.sit }, look: 0, phase: 0, time: Math.random() * 100,
    scratch: 0, nextScratch: 4 + Math.random() * 8, beat: 0, lastPose: null, talkUntil: 0,
  };
  return { root, parts: { torso, head, arms, box, fur, skin, dark, s, d } };
}

// The team's color as orange fur would wear it: slightly dark, with a
// darker face and hands.
export function createOrangutanModel({ team, npc }) {
  const color = new THREE.Color(TEAMS[team]?.color ?? (npc === 'workMonkey' ? 0x80502f : 0xc86b2a));
  const { root, parts } = ape('orangutan', {
    fur: mix(color, 0x3a2410, 0.2), skin: mix(color, 0x2b2320, 0.72), dark: mix(color, 0x1c1714, 0.8),
    eye: new THREE.MeshBasicMaterial({ color: 0x1a120c }),
  });
  const { head, torso, arms, box, s, d, fur, skin } = parts;
  // Wide cheek pads, a throat sac and long hair hanging from the arms.
  for (const side of [-1, 1]) box(head, [s * 0.32, s * 0.7, 0.08], [side * s * 0.62, s * 0.42, -s * 0.36], skin);
  box(torso, [d.torso[0] * 0.55, d.torso[1] * 0.22, 0.2], [0, d.torso[1] * 0.86, -d.torso[2] * 0.48], skin);
  for (const { elbow, shoulder } of arms) {
    box(shoulder, [d.arm * 1.4, d.upperArm * 0.7, d.arm * 0.5], [0, -d.upperArm * 0.55, d.arm * 0.4], fur);
    box(elbow, [d.arm * 1.3, d.foreArm * 0.6, d.arm * 0.45], [0, -d.foreArm * 0.5, d.arm * 0.4], fur);
  }
  box(head, [s * 0.9, s * 0.25, s * 0.8], [0, s * 0.95, s * 0.05], fur);
  root.userData.monkey.seated = 'chair';
  root.userData.monkey.team = team;
  return root;
}

// Dark fur shifted toward the element, a pale silver back, grey streaks and
// moss- or lightning-colored patches worn into it, and faintly glowing eyes.
export function createGorillaModel({ npc }) {
  const element = NPC_DEFS[npc]?.element ?? 'water', e = ELEMENTS[element] ?? ELEMENTS.water;
  const { root, parts } = ape('gorilla', {
    fur: mix(0x2e2c30, e.tint, 0.28), skin: mix(0x1d1b1f, e.tint, 0.18), dark: mix(0x151417, e.tint, 0.12),
    // Emissive, so they glow in a dark cave (entity lighting keeps emission).
    eye: new THREE.MeshLambertMaterial({ color: 0x000000, emissive: e.glow }),
  });
  const { head, torso, arms, box, s, d } = parts;
  const silver = lambert(mix(0x9a979c, e.tint, 0.3)), streak = lambert(mix(0x6d6a70, e.tint, 0.2));
  const moss = new THREE.MeshLambertMaterial({ color: e.moss, emissive: mix(e.glow, 0x000000, 0.8) });
  const [tw, th, td] = d.torso;
  // Brow ridge, crest and a broad muzzle.
  box(head, [s * 1.02, s * 0.14, s * 0.2], [0, s * 0.66, -s * 0.44], parts.dark);
  box(head, [s * 0.3, s * 0.3, s * 0.7], [0, s * 0.95, s * 0.05], parts.fur);
  box(head, [s * 0.62, s * 0.3, s * 0.2], [0, s * 0.25, -s * 0.5], parts.skin);
  // Silver saddle, grey streaks and old patches.
  box(torso, [tw * 0.9, th * 0.35, 0.06], [0, th * 0.55, td * 0.5], silver);
  box(torso, [0.06, th * 0.4, td * 0.5], [tw * 0.5, th * 0.7, 0.1], streak);
  box(torso, [tw * 0.3, 0.06, td * 0.4], [-tw * 0.25, th * 0.96, 0.15], moss);
  box(head, [s * 0.4, 0.04, s * 0.3], [s * 0.15, s * 1.1, 0.1], moss);
  arms.forEach(({ shoulder, elbow }, i) => {
    box(shoulder, [d.arm * 1.05, d.upperArm * 0.25, d.arm * 1.05], [0, -d.upperArm * (i ? 0.3 : 0.6), 0], i ? streak : moss);
    box(elbow, [d.arm * 0.95, d.foreArm * 0.2, d.arm * 0.95], [0, -d.foreArm * 0.4, 0], silver);
  });
  root.userData.monkey.seated = 'sit';
  root.userData.monkey.element = element;
  root.userData.monkey.npc = npc;
  return root;
}

const MODELS = { orangutan: createOrangutanModel, gorilla: createGorillaModel };

// The model for an NPC entity (info.npc is its kind in shared/npcs.js).
export function createNpcModel(info) {
  const model = (MODELS[NPC_DEFS[info.npc]?.model] ?? createGorillaModel)(info);
  if(info.npc==='workMonkey')model.scale.setScalar(NPC_DEFS.workMonkey.box.height/NPC_DEFS.wiseMonkey.box.height);
  model.userData.npc = true;
  return model;
}

export function updateMonkeyTeam(model, team) {
  const m = model.userData.monkey;
  if (m.team === team || m.kind !== 'orangutan') return;
  m.team = team;
  const color = new THREE.Color(TEAMS[team]?.color ?? 0x80502f);
  m.fur.color.setHex(mix(color, 0x3a2410, 0.2));
  m.skin.color.setHex(mix(color, 0x2b2320, 0.72));
  m.dark.color.setHex(mix(color, 0x1c1714, 0.8));
}

// Per frame. pose: the server's ('sit', 'stand', 'walk', 'look'); look: head
// turn toward a player; speed: blocks/s; talking: the jaw moves.
export function animateMonkey(model, dt, { pose = 'sit', look = 0, speed = 0, talking = false }) {
  const m = model.userData.monkey, d = m.d;
  m.time += dt;
  const key = pose === 'sit' ? m.seated : pose;
  const target = POSES[key] ?? POSES.sit;
  if (pose !== m.lastPose) {
    if (pose === 'stand') m.beat = 0;
    m.lastPose = pose;
  }
  for (const joint of Object.keys(target)) m.pose[joint] = approach(m.pose[joint], target[joint], d.poseRate, dt);
  const p = m.pose, legLength = d.thigh + d.shin;
  const walking = pose === 'walk' ? Math.min(1, speed / 0.6) : 0;
  if (walking) m.phase += dt * (2.5 + speed * 2);
  const swing = Math.sin(m.phase) * 0.45 * walking;
  const breath = Math.sin(m.time * Math.PI * 2 / d.breath);

  m.body.position.y = m.pelvis.position.y = p.hip * legLength + Math.abs(Math.sin(m.phase)) * 0.05 * walking;
  m.body.rotation.x = p.pitch;
  // Sitting still, the weight shifts slowly from side to side.
  m.body.rotation.z = pose === 'sit' ? Math.sin(m.time * 0.37) * 0.04 + Math.sin(m.time * 0.11) * 0.03 : 0;
  m.torso.scale.set(1 + breath * 0.025, 1 + breath * 0.015, 1 + breath * 0.04);
  m.legs.forEach(({ hip, knee, side }) => {
    hip.rotation.x = p.thigh + side * swing;
    hip.rotation.z = side * 0.06;
    knee.rotation.x = p.knee;
  });

  // Chest beat: alternating fists on the chest while upright.
  let beating = 0;
  if (pose === 'stand') { m.beat += dt; beating = m.beat > 0.5 && m.beat < 2.2 ? 1 : 0; }
  // Wise Monkeys scratch their chin now and then.
  if (m.seated === 'chair' && m.scratch <= 0 && (m.nextScratch -= dt) <= 0) {
    m.scratch = 2.6;
    m.nextScratch = 8 + Math.random() * 10;
  }
  const scratch = m.scratch > 0 ? Math.min(1, m.scratch / 0.5, (2.6 - m.scratch) / 0.5) : 0;
  m.scratch = Math.max(0, m.scratch - dt);
  m.arms.forEach(({ shoulder, elbow, side }) => {
    const beat = beating * Math.max(0, Math.sin(m.time * 14 + (side > 0 ? 0 : Math.PI))) * 0.5;
    // A beat pulls the fist back against the chest.
    shoulder.rotation.x = p.shoulder - side * swing * 1.2 - beat;
    // Positive spread swings the arm out to its side, negative across the chest.
    shoulder.rotation.z = side * p.spread;
    elbow.rotation.x = p.elbow;
    if (side > 0 && scratch) {
      // Right hand up to the chin, fingers working.
      shoulder.rotation.x += (1.9 - shoulder.rotation.x) * scratch;
      shoulder.rotation.z += (-0.45 - shoulder.rotation.z) * scratch;
      elbow.rotation.x += (2.1 + Math.sin(m.time * 12) * 0.12 - elbow.rotation.x) * scratch;
    }
  });

  // Head: toward the nearest player, sweeping around while looking about,
  // lifted a little during a scratch; the jaw works while it speaks.
  const sweep = pose === 'look' ? Math.sin(m.time * 1.3) * 0.8 : 0;
  m.look = approach(m.look, pose === 'look' ? sweep : look, 3, dt);
  m.head.rotation.y = m.look;
  m.neck.rotation.x = -p.pitch * 0.85 + (scratch ? 0.25 * scratch : Math.sin(m.time * 0.5) * 0.04);
  m.jaw.rotation.x = talking ? Math.max(0, Math.sin(m.time * 11)) * 0.35 : approach(m.jaw.rotation.x, 0, 8, dt);
}
