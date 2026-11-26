// The Sky Merchant and his airship.
//
// The merchant is a purple humanoid octopus: a tall rounded mantle for a
// head with big friendly eyes, a beard of curling tentacles, tentacle arms
// with suckers, legs in trousers and a merchant's coat with brass buttons, a
// hat and sometimes a monocle. Every merchant's look comes from his
// `appearance` number (merchantLook in shared/merchant.js): skin shade,
// coat, trim, hat and beard. Built facing -Z with the origin at the feet.
//
// The airship is an ordinary steampunk airship: a big canvas balloon with
// rib bands and tail fins, rigging down to a wooden gondola with a deck,
// brass rails, a cabin with a stovepipe, and propellers at the stern and on
// side engines that spin with its thrust. Its bow is -Z (toward the depot
// when docked), the deck surface at the origin. When the merchant is aboard
// (snapshot `pilot`) a small copy of him stands at the wheel.
import * as THREE from 'three';
import { merchantLook } from '/shared/merchant.js';
import { TEAMS } from '/shared/protocol.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (parent, [w, h, d], [x, y, z], material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
};
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

// A tentacle: a chain of tapering segments, each a pivot, so it can curl.
function tentacle(parent, segments, length, radius, material, sucker) {
  const joints = [];
  let at = parent;
  for (let i = 0; i < segments; i++) {
    const r = radius * (1 - i / (segments + 1));
    const joint = pivot(at, 0, i ? -length : 0, 0);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, length, 6), material);
    seg.position.y = -length / 2; joint.add(seg);
    if (sucker && i % 2 === 0) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 5, 4), sucker);
      dot.position.set(0, -length / 2, -r * 0.8); joint.add(dot);
    }
    joints.push(joint); at = joint;
  }
  return joints;
}

export function createMerchantModel(info, scale = 1) {
  const look = merchantLook(info.appearance ?? 0);
  const root = new THREE.Group(), inner = pivot(root, 0, 0, 0);
  const skin = lambert(new THREE.Color().setHSL(look.skinHue, 0.55, look.skinLight).getHex());
  const skinDark = lambert(new THREE.Color().setHSL(look.skinHue, 0.5, look.skinLight * 0.7).getHex());
  const sucker = lambert(new THREE.Color().setHSL(look.skinHue, 0.45, Math.min(0.8, look.skinLight + 0.25)).getHex());
  const coat = lambert(look.coat), trim = lambert(look.trim), cloth = lambert(0x2a2622), white = lambert(0xf4f1ea);
  const pupil = lambert(0x1b1420), hatColor = lambert(look.hat === 'captain' ? 0x1f2a3a : 0x24201d);
  // Legs (trousers and boots).
  const legs = [-1, 1].map((side) => {
    const hip = pivot(inner, side * 0.13, 0.82, 0);
    box(hip, [0.2, 0.62, 0.22], [0, -0.31, 0], cloth);
    box(hip, [0.22, 0.2, 0.3], [0, -0.72, -0.04], lambert(0x3a2616));
    return { hip, side };
  });
  // Body: coat with tails, waistcoat, buttons, a satchel.
  const body = pivot(inner, 0, 0.82, 0);
  box(body, [0.56, 0.7, 0.34], [0, 0.35, 0], coat);
  box(body, [0.6, 0.32, 0.36], [0, -0.1, 0.02], coat);
  box(body, [0.26, 0.5, 0.02], [0, 0.4, -0.18], lambert(0xd9c7a0));
  for (let i = 0; i < 3; i++) box(body, [0.06, 0.06, 0.03], [0, 0.55 - i * 0.14, -0.2], trim);
  box(body, [0.58, 0.06, 0.36], [0, 0.0, 0], trim);
  box(body, [0.18, 0.2, 0.08], [0.32, -0.02, 0.06], lambert(0x6b4423));
  // Arms: coat sleeves into tentacle forearms.
  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(body, side * 0.36, 0.62, 0);
    box(shoulder, [0.16, 0.34, 0.18], [0, -0.15, 0], coat);
    box(shoulder, [0.18, 0.06, 0.2], [0, -0.32, 0], trim);
    const elbow = pivot(shoulder, 0, -0.34, 0);
    const joints = tentacle(elbow, 4, 0.13, 0.065, skin, sucker);
    return { shoulder, elbow, joints, side };
  });
  // Head: the mantle, eyes, beard tentacles, hat.
  const head = pivot(body, 0, 0.72, 0);
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), skin);
  mantle.scale.set(1, 1.35, 1.05); mantle.position.set(0, 0.36, 0.04); head.add(mantle);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), skin);
  face.scale.set(1.05, 0.8, 0.9); face.position.set(0, 0.12, -0.08); head.add(face);
  for (let i = 0; i < 9; i++) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), skinDark);
    const a = i * 1.7, h = 0.3 + (i % 3) * 0.12;
    spot.position.set(Math.sin(a) * 0.3, h, Math.cos(a) * 0.3 + 0.04); head.add(spot);
  }
  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), white);
    eye.position.set(side * 0.13, 0.2, -0.27); head.add(eye);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), pupil);
    p.position.set(0, 0, -0.06); eye.add(p);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), skinDark);
    lid.position.set(0, 0.012, 0); lid.rotation.x = -0.3; eye.add(lid);
    return eye;
  });
  if (look.monocle) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 14), trim);
    ring.position.set(0.13, 0.2, -0.34); head.add(ring);
    const chain = box(head, [0.01, 0.3, 0.01], [0.22, 0.04, -0.3], trim); chain.rotation.z = 0.3;
  }
  const beard = [];
  for (let i = 0; i < look.tentacles; i++) {
    const a = (i / (look.tentacles - 1) - 0.5) * 2.2;
    const root2 = pivot(head, Math.sin(a) * 0.2, 0.02, -0.12 - Math.cos(a) * 0.12);
    root2.rotation.x = -0.25; root2.rotation.z = Math.sin(a) * 0.25;
    beard.push({ joints: tentacle(root2, 4, 0.1, 0.045, skin, sucker), phase: i * 0.9 });
  }
  if (look.hat === 'top') {
    box(head, [0.62, 0.04, 0.62], [0, 0.78, 0.04], hatColor);
    box(head, [0.42, 0.42, 0.42], [0, 1.0, 0.04], hatColor);
    box(head, [0.43, 0.07, 0.43], [0, 0.84, 0.04], lambert(look.coat));
  } else if (look.hat === 'bowler') {
    box(head, [0.56, 0.04, 0.56], [0, 0.76, 0.04], hatColor);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hatColor);
    dome.position.set(0, 0.78, 0.04); head.add(dome);
  } else {
    box(head, [0.5, 0.18, 0.5], [0, 0.82, 0.04], hatColor);
    box(head, [0.52, 0.04, 0.3], [0, 0.73, -0.16], hatColor);
    box(head, [0.12, 0.08, 0.02], [0, 0.84, -0.22], trim);
  }
  root.scale.setScalar(scale);
  root.userData.merchant = { legs, arms, body, head, eyes, beard, time: Math.random() * 10, phase: 0, look: 0, blink: 2 };
  return root;
}

export function animateMerchant(model, dt, { speed = 0, look = 0, talking = false, pose = 'stand' }) {
  const m = model.userData.merchant;
  m.time += dt;
  const walking = pose === 'walk' || speed > 0.3 ? 1 : 0;
  if (walking) m.phase += dt * 7;
  const swing = Math.sin(m.phase) * 0.5 * walking;
  m.legs.forEach(({ hip, side }) => { hip.rotation.x = side * swing; });
  m.body.position.y = 0.82 + Math.abs(Math.sin(m.phase)) * 0.04 * walking + Math.sin(m.time * 1.7) * 0.008;
  m.arms.forEach(({ shoulder, elbow, joints, side }, i) => {
    shoulder.rotation.x = -side * swing * 0.8 + (talking && side > 0 ? 0.9 + Math.sin(m.time * 6) * 0.3 : 0.1);
    shoulder.rotation.z = side * 0.12;
    elbow.rotation.x = talking && side > 0 ? 0.6 : 0.2;
    joints.forEach((j, k) => { j.rotation.x = Math.sin(m.time * 2.3 + k + i) * 0.18 + 0.1; j.rotation.z = Math.sin(m.time * 1.9 + k) * 0.12 * side; });
  });
  m.beard.forEach(({ joints, phase }) => joints.forEach((j, k) => {
    j.rotation.x = 0.15 + Math.sin(m.time * 2.1 + phase + k * 0.7) * (talking ? 0.35 : 0.18);
    j.rotation.z = Math.sin(m.time * 1.6 + phase + k) * 0.12;
  }));
  m.look += (look - m.look) * Math.min(1, dt * 4);
  m.head.rotation.y = m.look;
  m.head.rotation.x = Math.sin(m.time * 0.8) * 0.04;
  // Blinking.
  m.blink -= dt;
  const closed = m.blink < 0.12;
  if (m.blink < 0) m.blink = 2.5 + Math.random() * 3;
  m.eyes.forEach((e) => { e.scale.y = closed ? 0.15 : 1; });
}

// ---- The airship ----

export function createAirshipModel(info) {
  const look = merchantLook(info.appearance ?? 0);
  const root = new THREE.Group(), ship = pivot(root, 0, 0, 0);
  const wood = lambert(0x7a5230), woodDark = lambert(0x553821), plank = lambert(0x9c7448);
  const brass = lambert(0xc49a3c), iron = lambert(0x4a4d52), canvas = lambert(0xd8ccae), canvasDark = lambert(0xa8977a);
  const rope = lambert(0x8a7550), glass = lambert(0x9fd3e0, { transparent: true, opacity: 0.6 });
  const team = TEAMS[info.team]?.color ?? 0xffffff;
  // Gondola hull: a tapered wooden boat, deck at y = 0.
  const hull = pivot(ship, 0, 0, 0);
  box(hull, [5, 1.2, 13], [0, -0.6, 0.3], wood);
  box(hull, [3.6, 1, 11], [0, -1.6, 0.4], woodDark);
  box(hull, [2, 0.8, 8], [0, -2.4, 0.6], wood);
  // Bow wedge and keel.
  const bow = box(hull, [3.4, 1.2, 2.2], [0, -0.7, -6.6], wood); bow.rotation.x = 0.35;
  box(hull, [0.3, 0.5, 13], [0, -2.9, 0.4], brass);
  // Deck planks and brass rails.
  for (let i = 0; i < 6; i++) box(hull, [0.78, 0.06, 12.6], [-2 + i * 0.8, 0.03, 0.3], i % 2 ? plank : wood);
  for (const side of [-1, 1]) {
    box(hull, [0.1, 0.08, 12.4], [side * 2.45, 0.85, 0.3], brass);
    for (let z = -5.6; z <= 6.4; z += 1.5) box(hull, [0.08, 0.85, 0.08], [side * 2.45, 0.43, z], brass);
    // Portholes.
    for (let z = -4; z <= 5; z += 3) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10), brass);
      hole.rotation.z = Math.PI / 2; hole.position.set(side * 2.52, -0.7, z); hull.add(hole);
      const pane = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10), glass);
      pane.rotation.z = Math.PI / 2; pane.position.set(side * 2.53, -0.7, z); hull.add(pane);
    }
  }
  // Cabin with a stovepipe, at the stern half.
  box(hull, [3.2, 1.6, 3.4], [0, 0.8, 3.6], woodDark);
  box(hull, [3.4, 0.15, 3.6], [0, 1.65, 3.6], brass);
  for (const side of [-1, 1]) box(hull, [0.06, 0.6, 1], [side * 1.61, 1.0, 3.6], glass);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8), iron);
  pipe.position.set(0.9, 2.4, 4.6); hull.add(pipe);
  box(hull, [0.5, 0.12, 0.5], [0.9, 3.2, 4.6], brass);
  // Ship's wheel at the cabin front, and the team pennant at the bow.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 14), brass);
  wheel.position.set(0, 1.1, 1.6); hull.add(wheel);
  for (let i = 0; i < 4; i++) { const spoke = box(wheel, [0.9, 0.04, 0.04], [0, 0, 0], brass); spoke.rotation.z = i * Math.PI / 4; }
  box(hull, [0.08, 2, 0.08], [0, 1, -6.2], brass);
  box(hull, [0.04, 0.5, 0.9], [0, 1.7, -5.8], lambert(team));
  // A gangway hatch at the bow (where the merchant steps off).
  box(hull, [1.2, 0.08, 0.9], [0, 0.07, -5.6], woodDark);
  // Balloon: a long canvas envelope with rib bands, nose and tail fins.
  const balloon = pivot(ship, 0, 8, 0.4);
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), canvas);
  envelope.scale.set(3, 3.1, 7.6); balloon.add(envelope);
  for (let i = -3; i <= 3; i++) {
    const t = i / 3.6, r = Math.sqrt(Math.max(0, 1 - t * t));
    const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 4, 24), canvasDark);
    band.scale.set(3 * r + 0.02, 3.1 * r + 0.02, 1); band.position.z = t * 7.6; balloon.add(band);
  }
  const spine = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 4, 32), canvasDark);
  spine.rotation.y = Math.PI / 2; spine.scale.set(7.62, 3.12, 1); balloon.add(spine);
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), brass); noseCap.position.z = -7.5; balloon.add(noseCap);
  for (const [rx, rz] of [[0, 0], [0, Math.PI / 2], [0, Math.PI], [0, -Math.PI / 2]]) {
    const fin = pivot(balloon, 0, 0, 6.4);
    fin.rotation.set(rx, 0, rz);
    box(fin, [0.1, 2.2, 2.4], [0, 2.6, 0.6], canvasDark);
    box(fin, [0.14, 0.12, 2.4], [0, 3.7, 0.6], brass);
  }
  // Rigging lines from the balloon down to the rails, and a brass keel frame.
  box(ship, [0.2, 0.2, 12], [0, 4.7, 0.4], brass);
  for (const side of [-1, 1]) for (let z = -4.5; z <= 5.5; z += 2.5) {
    const line = box(ship, [0.04, 4.3, 0.04], [side * 1.9, 2.75, z], rope);
    line.rotation.z = side * -0.12;
  }
  // Propellers: one big one at the stern, two on side engines.
  const propellers = [];
  const propeller = (x, y, z, size) => {
    const mount = pivot(ship, x, y, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * size, 0.3 * size, 0.6 * size, 8), brass);
    hub.rotation.x = Math.PI / 2; mount.add(hub);
    const spin = pivot(mount, 0, 0, 0.35 * size);
    for (let i = 0; i < 4; i++) {
      const blade = box(spin, [0.28 * size, 1.5 * size, 0.06], [0, 0.75 * size, 0], woodDark);
      blade.parent.remove(blade);
      const arm = pivot(spin, 0, 0, 0); arm.rotation.z = i * Math.PI / 2; arm.add(blade);
      blade.rotation.y = 0.35;
    }
    propellers.push(spin);
    return mount;
  };
  propeller(0, -0.8, 7.4, 1.3);
  for (const side of [-1, 1]) {
    const engine = box(ship, [0.8, 0.8, 2], [side * 3.3, 0.4, 3.2], iron);
    box(engine, [0.84, 0.12, 2.04], [0, 0.2, 0], brass);
    box(ship, [1, 0.12, 0.3], [side * 2.85, 0.4, 3.2], brass);
    propeller(side * 3.3, 0.4, 4.3, 0.8);
  }
  // The pilot: a small merchant at the wheel while he's aboard.
  const pilot = createMerchantModel(info, 0.9);
  pilot.position.set(0, 0.05, 1.05);
  ship.add(pilot);
  root.userData.airship = { propellers, pilot, ship, time: 0, look };
  return root;
}

export function animateAirship(model, dt, { thrust = 0, pilot = false }) {
  const a = model.userData.airship;
  a.time += dt;
  for (const p of a.propellers) p.rotation.z += dt * (1.5 + thrust * 22);
  a.pilot.visible = pilot;
  if (pilot) animateMerchant(a.pilot, dt, { talking: false });
  // A gentle bob and roll even while docked.
  a.ship.position.y = Math.sin(a.time * 0.9) * 0.05;
  a.ship.rotation.z = Math.sin(a.time * 0.6) * 0.008;
}
