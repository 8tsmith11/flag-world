import * as THREE from 'three';
import { DRAGON_ARENA as A, DRAGON_LORD as C } from '/shared/config.js';
import { createDragonModel, animateDragon } from './models.js';

const glow = (color, opacity = 0.65) => new THREE.MeshBasicMaterial({ color,
  transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide });

const WHITE = new THREE.Color(0xffffff);
// Boss pose easing rate (per second) and the jump that counts as a teleport.
const POSE_EASE = 14;
const SNAP_DISTANCE = 8;
// Fireballs are moved on from their last update for at most this long (s).
const MAX_EXTRAPOLATE = 0.3;
// How far behind a fireball its glow trails, in its radius-scaled units.
const TRAIL_OFFSET = 0.9;

function floorArc(radius, halfAngle, color) {
  return new THREE.Mesh(new THREE.CircleGeometry(radius, 40,
    Math.PI / 2 - halfAngle, halfAngle * 2), glow(color, 0.38));
}

export class DragonLordRenderer {
  constructor(scene) {
    this.scene = scene;
    this.model = createDragonModel();
    this.model.scale.setScalar(3);
    this.model.traverse(object => {
      if (!object.isMesh || !object.material?.color || object.material.isMeshBasicMaterial) return;
      object.material.color.multiplyScalar(0.31);
    });
    const horn = new THREE.MeshLambertMaterial({ color: 0x181417 });
    const cracks = new THREE.MeshBasicMaterial({ color: 0xff5819 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.1 + i * 0.025, 0.5 + i * 0.1, 7), horn);
        h.position.set(side * (0.14 + i * 0.17), 2.25 + i * 0.07, -1.46 + i * 0.13);
        h.rotation.z = side * 0.18;
        this.model.add(h);
      }
      for (let i = 0; i < 3; i++) {
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.35 + i * 0.12), cracks);
        crack.position.set(side * (0.38 + i * 0.09), 1.82 + i * 0.03, -0.5 + i * 0.4);
        crack.rotation.y = side * 0.25;
        this.model.add(crack);
      }
    }
    this.cracks = cracks;
    this.tailGlow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.3, 8), glow(0xff6b19, 0.9));
    this.tailGlow.rotation.x = Math.PI / 2;
    this.tailGlow.position.set(0, 1.35, 2.1);
    this.model.add(this.tailGlow);
    this.chestGlow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), glow(0xffa932, 0.7));
    this.chestGlow.scale.set(1, 0.35, 0.5);
    this.chestGlow.position.set(0, 1.24, -0.55);
    this.model.add(this.chestGlow);
    scene.add(this.model);
    this.warning = new THREE.Group(); scene.add(this.warning);
    this.buildWarnings();
    this.fireballs = new Map();
    this.ballGeometry = new THREE.SphereGeometry(C.fireballRadius, 10, 8);
    this.ballMaterial = glow(0xff782b, 0.95);
    this.reflectedMaterial = glow(0xffe176, 0.95);
    this.trailMaterial = glow(0xff3b0a, 0.32);
    this.bar = document.createElement('div');
    this.bar.id = 'dragon-lord-health';
    this.bar.innerHTML = '<span>Dragon Lord</span><div><i></i></div>';
    this.bar.hidden = true;
    document.body.append(this.bar);
    this.barFill = this.bar.querySelector('i');
    this.barWidth = '';
    this.state = null;
    this.receivedAt = 0;
    // Drawn pose, eased toward each server update (sent every few ticks).
    this.pose = null;
    this.inArena = false;
    this.time = 0;
  }
  setState(state) { this.state = state; this.receivedAt = performance.now(); }
  setArena(inArena) { this.inArena = inArena; }
  // Telegraph meshes are built once and shown, moved or reshaped per frame.
  buildWarnings() {
    const flat = mesh => { mesh.rotation.order = 'YXZ'; mesh.rotation.x = -Math.PI / 2; mesh.visible = false;
      this.warning.add(mesh); return mesh; };
    const segments = 64;
    const ringGeometry = new THREE.RingGeometry(0.5, 1, segments, 1);
    this.warnings = {
      swipe: flat(floorArc(C.swipeRange, C.swipeHalfAngle, 0xff6a23)),
      tail: flat(floorArc(C.tailRange, Math.PI - 1.2, 0xffa529)),
      breath: flat(floorArc(C.breathRange, C.breathHalfAngle, 0xff3d0b)),
      stomp: flat(new THREE.Mesh(ringGeometry, glow(0xff641b, 0.62))),
      dive: flat(new THREE.Mesh(new THREE.PlaneGeometry(C.diveWidth * 2, A.mainRadius * 2), glow(0xff3b15, 0.52))),
      lava: flat(new THREE.Mesh(new THREE.RingGeometry(C.lavaRingInner, C.lavaRingOuter, segments), glow(0xff4e0b, 0.42))),
    };
    this.ringSegments = segments;
    this.markGeometry = new THREE.CircleGeometry(C.fireballBlastRadius, 48);
    this.markMaterial = glow(0xff5820, 0.35);
    this.marks = [];
  }
  // Rewrites the stomp ring's vertices for new radii (RingGeometry lays out
  // one inner and one outer vertex per segment step).
  setRing(mesh, inner, outer) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i <= this.ringSegments; i++) {
      const angle = i / this.ringSegments * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      position.setXY(i, inner * c, inner * s);
      position.setXY(i + this.ringSegments + 1, outer * c, outer * s);
    }
    position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
  showWarning(mesh, x, y, z, yaw = 0) {
    mesh.visible = true; mesh.position.set(x, y, z); mesh.rotation.y = yaw;
  }
  drawWarning(state, now, world) {
    for (const mesh of Object.values(this.warnings)) mesh.visible = false;
    const a = state.action;
    if (!a) return;
    const floor = A.floorY + 1.04;
    if (a.kind === 'swipe' && a.stage === 'windup') this.showWarning(this.warnings.swipe, state.x, floor, state.z, a.yaw);
    if (a.kind === 'tail' && a.stage === 'windup') this.showWarning(this.warnings.tail, state.x, floor, state.z, a.yaw + Math.PI);
    if (a.kind === 'stomp') {
      const radius = a.stage === 'active' ? Math.min(C.shockwaveMaxRadius,
        Math.max(0, (now - a.start) / 20 * C.shockwaveSpeed)) : C.shockwaveMaxRadius;
      if (radius !== this.ringRadius) { this.ringRadius = radius; this.setRing(this.warnings.stomp, Math.max(0.1, radius - C.shockwaveWidth), radius); }
      this.showWarning(this.warnings.stomp, state.x, floor, state.z);
    }
    if (a.kind === 'breath') {
      const yaw = a.stage === 'active'
        ? a.yaw - C.breathArc / 2 + C.breathArc * Math.min(1, Math.max(0, (now - a.start) / (C.breathSeconds * 20)))
        : a.yaw;
      this.showWarning(this.warnings.breath, state.x, floor, state.z, yaw);
    }
    if (a.kind === 'dive') this.showWarning(this.warnings.dive, a.lineX, floor, world.dragonArena.z + 0.5);
  }
  drawMarks(marks, floor) {
    while (this.marks.length < marks.length) {
      const mesh = new THREE.Mesh(this.markGeometry, this.markMaterial);
      mesh.rotation.x = -Math.PI / 2;
      this.warning.add(mesh); this.marks.push(mesh);
    }
    this.markMaterial.opacity = 0.35 + Math.sin(this.time * 8) * 0.15;
    this.marks.forEach((mesh, i) => {
      mesh.visible = i < marks.length;
      if (mesh.visible) mesh.position.set(marks[i].x, floor, marks[i].z);
    });
  }
  update(dt, camera, world, serverTick) {
    const state = this.state;
    const visible = this.inArena && state && state.status !== 'dead';
    this.model.visible = !!visible;
    this.bar.hidden = !this.inArena || !state || !['active', 'dying'].includes(state.status);
    if (!visible) { this.pose = null; this.warning.visible = false; for (const ball of this.fireballs.values()) ball.group.visible = false; return; }
    this.time += dt;
    // Ease toward the latest update; jump straight there on a teleport (phase
    // change, perch, landing).
    const pose = this.pose ??= { x: state.x, y: state.y, z: state.z, yaw: state.yaw };
    if (Math.hypot(state.x - pose.x, state.y - pose.y, state.z - pose.z) > SNAP_DISTANCE) Object.assign(pose, state);
    const ease = 1 - Math.exp(-dt * POSE_EASE);
    pose.x += (state.x - pose.x) * ease; pose.y += (state.y - pose.y) * ease; pose.z += (state.z - pose.z) * ease;
    pose.yaw += Math.atan2(Math.sin(state.yaw - pose.yaw), Math.cos(state.yaw - pose.yaw)) * ease;
    this.model.position.set(pose.x, pose.y, pose.z);
    this.model.rotation.y = pose.yaw;
    if (state.phase === 2 && state.y > world.dragonArena.y + 5)
      this.model.position.y += Math.sin(this.time * 2.5) * 0.3;
    if (state.status === 'sleeping') this.model.rotation.x = 0.32;
    else if (state.status === 'dying') {
      this.model.rotation.x = -Math.min(0.6, (serverTick - state.deathTick) / (C.deathSeconds * 20) * 0.6);
      this.model.position.y += Math.min(4, (serverTick - state.deathTick) / 20);
    } else if (state.action?.kind === 'stomp' && state.action.stage === 'windup') {
      this.model.rotation.x = -0.35; this.model.position.y += 0.7;
    } else if (state.action?.kind === 'collapsed') this.model.rotation.x = 0.45;
    else this.model.rotation.x = 0;
    this.tailGlow.visible = state.action?.kind === 'tail';
    this.chestGlow.visible = ['stunned', 'collapsed'].includes(state.action?.kind) || state.status === 'dying';
    this.cracks.color.setHex(state.action?.kind === 'stunned' || state.action?.kind === 'collapsed' ? 0xffbd51 : 0xff5819);
    if (state.status === 'dying') this.cracks.color.lerp(WHITE, Math.min(1, (serverTick - state.deathTick) / (C.deathSeconds * 20)));
    animateDragon(this.model, dt, state.action?.kind === 'breath' && state.action.stage === 'active',
      state.action?.kind === 'dive');
    if (state.action?.kind === 'swipe' && state.action.stage === 'windup') {
      const claw = this.model.userData.dragon.legs.find(leg => leg.front);
      if (claw) claw.pivot.rotation.x = -1.15;
    }
    if (!this.bar.hidden) {
      const width = `${Math.max(0, state.hp / state.maxHp * 100).toFixed(1)}%`;
      if (width !== this.barWidth) { this.barWidth = width; this.barFill.style.width = width; }
    }
    this.warning.visible = state.status === 'active';
    this.drawWarning(state, serverTick, world);
    const floor = world.dragonArena.y + 1.04;
    this.drawMarks(state.marks ?? [], floor);
    if (state.lavaState === 'warning')
      this.showWarning(this.warnings.lava, world.dragonArena.x + 0.5, floor, world.dragonArena.z + 0.5);
    const active = new Set();
    // Fireballs fly straight, so move them on from their last update using
    // their velocity rather than waiting for the next one.
    const ahead = Math.min(MAX_EXTRAPOLATE, (performance.now() - this.receivedAt) / 1000);
    for (const ball of state.fireballs ?? []) {
      active.add(ball.id);
      let entry = this.fireballs.get(ball.id);
      if (!entry) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
        const trail = new THREE.Mesh(this.ballGeometry, this.trailMaterial);
        trail.scale.setScalar(1.8);
        group.add(core, trail); this.scene.add(group);
        entry = { group, core, trail };
        this.fireballs.set(ball.id, entry);
      }
      const vx = ball.vx ?? 0, vy = ball.vy ?? 0, vz = ball.vz ?? 0, speed = Math.hypot(vx, vy, vz) || 1;
      entry.group.visible = true;
      entry.group.position.set(ball.x + vx * ahead, ball.y + vy * ahead, ball.z + vz * ahead);
      entry.trail.position.set(-vx / speed * TRAIL_OFFSET, -vy / speed * TRAIL_OFFSET, -vz / speed * TRAIL_OFFSET);
      entry.group.scale.setScalar(0.9 + Math.sin(this.time * 12 + ball.id) * 0.1);
      entry.core.material = ball.reflected ? this.reflectedMaterial : this.ballMaterial;
    }
    for (const [id, entry] of this.fireballs) if (!active.has(id)) {
      this.scene.remove(entry.group); this.fireballs.delete(id);
    }
  }
}
