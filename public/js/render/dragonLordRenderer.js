import * as THREE from 'three';
import { DRAGON_ARENA as A, DRAGON_LORD as C } from '/shared/config.js';
import { createDragonModel, animateDragon } from './models.js';

const glow = (color, opacity = 0.65) => new THREE.MeshBasicMaterial({ color,
  transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide });

function floorDisc(radius, color, opacity) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), glow(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function floorArc(radius, halfAngle, color) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40,
    Math.PI / 2 - halfAngle, halfAngle * 2), glow(color, 0.38));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
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
    this.fireballs = new Map();
    this.ballGeometry = new THREE.SphereGeometry(C.fireballRadius, 10, 8);
    this.ballMaterial = glow(0xff782b, 0.95);
    this.trailMaterial = glow(0xff3b0a, 0.32);
    this.bar = document.createElement('div');
    this.bar.id = 'dragon-lord-health';
    this.bar.innerHTML = '<span>Dragon Lord</span><div><i></i></div>';
    this.bar.hidden = true;
    document.body.append(this.bar);
    this.state = null;
    this.inArena = false;
    this.time = 0;
  }
  setState(state) { this.state = state; }
  setArena(inArena) { this.inArena = inArena; }
  clearWarning() {
    for (const mesh of [...this.warning.children]) {
      this.warning.remove(mesh);
      mesh.geometry?.dispose(); mesh.material?.dispose();
    }
  }
  addWarning(mesh, x, y, z, yaw = 0) {
    mesh.position.set(x, y, z); mesh.rotation.order = 'YXZ'; mesh.rotation.y = yaw;
    this.warning.add(mesh);
  }
  drawWarning(state, now, world) {
    this.clearWarning();
    const a = state.action;
    if (!a) return;
    const floor = A.floorY + 1.04;
    if (a.kind === 'swipe' && a.stage === 'windup')
      this.addWarning(floorArc(C.swipeRange, C.swipeHalfAngle, 0xff6a23), state.x, floor, state.z, a.yaw);
    if (a.kind === 'tail' && a.stage === 'windup')
      this.addWarning(floorArc(C.tailRange, Math.PI - 1.2, 0xffa529), state.x, floor, state.z, a.yaw + Math.PI);
    if (a.kind === 'stomp') {
      const radius = a.stage === 'active' ? Math.min(C.shockwaveMaxRadius,
        Math.max(0, (now - a.start) / 20 * C.shockwaveSpeed)) : C.shockwaveMaxRadius;
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.1, radius - C.shockwaveWidth), radius, 64), glow(0xff641b, 0.62));
      ring.rotation.x = -Math.PI / 2;
      this.addWarning(ring, state.x, floor, state.z);
    }
    if (a.kind === 'breath') {
      const yaw = a.stage === 'active'
        ? a.yaw - C.breathArc / 2 + C.breathArc * Math.min(1, Math.max(0, (now - a.start) / (C.breathSeconds * 20)))
        : a.yaw;
      this.addWarning(floorArc(C.breathRange, C.breathHalfAngle, 0xff3d0b), state.x, floor, state.z, yaw);
    }
    if (a.kind === 'dive') {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(C.diveWidth * 2, A.mainRadius * 2), glow(0xff3b15, 0.52));
      mesh.rotation.x = -Math.PI / 2;
      this.addWarning(mesh, a.lineX, floor, world.dragonArena.z + 0.5);
    }
  }
  update(dt, camera, world, serverTick) {
    const state = this.state;
    const visible = this.inArena && state && state.status !== 'dead';
    this.model.visible = !!visible;
    this.bar.hidden = !this.inArena || !state || !['active', 'dying'].includes(state.status);
    if (!visible) { this.warning.visible = false; for (const ball of this.fireballs.values()) ball.group.visible = false; return; }
    this.time += dt;
    this.model.position.set(state.x, state.y, state.z);
    this.model.rotation.y = state.yaw;
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
    if (state.status === 'dying') this.cracks.color.lerp(new THREE.Color(0xffffff), Math.min(1, (serverTick - state.deathTick) / (C.deathSeconds * 20)));
    animateDragon(this.model, dt, state.action?.kind === 'breath' && state.action.stage === 'active',
      state.action?.kind === 'dive');
    if (state.action?.kind === 'swipe' && state.action.stage === 'windup') {
      const claw = this.model.userData.dragon.legs.find(leg => leg.front);
      if (claw) claw.pivot.rotation.x = -1.15;
    }
    if (!this.bar.hidden) this.bar.querySelector('i').style.width = `${Math.max(0, state.hp / state.maxHp * 100)}%`;
    this.warning.visible = state.status === 'active';
    this.drawWarning(state, serverTick, world);
    const floor = world.dragonArena.y + 1.04;
    for (const mark of state.marks ?? []) {
      const mesh = floorDisc(C.fireballBlastRadius, 0xff5820, 0.35 + Math.sin(this.time * 8) * 0.15);
      this.addWarning(mesh, mark.x, floor, mark.z);
    }
    if (state.lavaState === 'warning') {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(C.lavaRingInner, C.lavaRingOuter, 64), glow(0xff4e0b, 0.42));
      mesh.rotation.x = -Math.PI / 2;
      this.addWarning(mesh, world.dragonArena.x + 0.5, floor, world.dragonArena.z + 0.5);
    }
    const active = new Set();
    for (const ball of state.fireballs ?? []) {
      active.add(ball.id);
      let entry = this.fireballs.get(ball.id);
      if (!entry) {
        const group = new THREE.Group();
        const core = new THREE.Mesh(this.ballGeometry, this.ballMaterial.clone());
        const trail = new THREE.Mesh(this.ballGeometry, this.trailMaterial);
        trail.scale.setScalar(1.8);
        group.add(core, trail); this.scene.add(group);
        entry = { group, trail, last: new THREE.Vector3(ball.x, ball.y, ball.z) };
        this.fireballs.set(ball.id, entry);
      }
      entry.group.visible = true;
      entry.group.position.set(ball.x, ball.y, ball.z);
      entry.trail.position.copy(entry.last).sub(entry.group.position).multiplyScalar(0.5);
      entry.last.set(ball.x, ball.y, ball.z);
      entry.group.scale.setScalar(0.9 + Math.sin(this.time * 12 + ball.id) * 0.1);
      entry.group.children[0].material.color.setHex(ball.reflected ? 0xffe176 : 0xff782b);
    }
    for (const [id, entry] of this.fireballs) if (!active.has(id)) {
      this.scene.remove(entry.group); entry.group.children[0].material.dispose(); this.fireballs.delete(id);
    }
  }
}
