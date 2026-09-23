// Flags: a pole with a cloth in the owner's color. At home it stands on the
// pedestal; dropped, it stands where it fell; carried, a smaller copy rides on
// the carrier's back. Carried and dropped flags get a light beam that reaches
// high into the sky and draws through blocks, so everyone can see where they are.

import * as THREE from 'three';
import { PLAYER_WIDTH } from '/shared/config.js';
import { FLAG_STATE } from '/shared/protocol.js';

const BEAM_HEIGHT = 256;
// Carried beams start above the carrier's head so they don't fill their view.
const BEAM_CARRIED_START = 2.2;
const CARRIED_SCALE = 0.55;
// Dropped flags are placed by 20 Hz server positions; ease toward them.
const FOLLOW_RATE = 20;

const PUFF_COUNT = 24;
const PUFF_MS = 700;
const PUFF_SPEED = 2.5;

function createFlagModel(color) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 2, 0.08),
    new THREE.MeshLambertMaterial({ color: 0xdddddd }),
  );
  pole.position.y = 1;
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.55, 0.8),
    new THREE.MeshLambertMaterial({ color }),
  );
  cloth.position.set(0, 1.68, 0.42);
  group.add(pole, cloth);
  return group;
}

function createBeam(color) {
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, BEAM_HEIGHT, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  beam.renderOrder = 10;
  beam.frustumCulled = false;
  beam.visible = false;
  return beam;
}

export class FlagRenderer {
  // entities: the EntityRenderer, to find carriers' models.
  constructor(scene, entities) {
    this.scene = scene;
    this.entities = entities;
    // id -> { info, model, carriedModel, beam, state, placed }
    this.flags = new Map();
    this.puffs = [];
    this.puffGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  }

  // info: FlagInfo from WELCOME (id, color, home), with its initial FlagState.
  add(info) {
    const model = createFlagModel(info.color);
    const carriedModel = createFlagModel(info.color);
    carriedModel.scale.setScalar(CARRIED_SCALE);
    // On the back: the side opposite the visor (+Z), leaning slightly.
    carriedModel.position.set(0, 0.55, PLAYER_WIDTH / 2 + 0.05);
    carriedModel.rotation.x = 0.15;
    const beam = createBeam(info.color);
    this.scene.add(model, beam);
    this.flags.set(info.id, { info, model, carriedModel, beam, state: info, placed: false });
  }

  // states: FlagState[] from STATE.
  setStates(states) {
    for (const s of states) {
      const flag = this.flags.get(s.id);
      if (flag) flag.state = s;
    }
  }

  get(id) {
    return this.flags.get(id);
  }

  // A burst of the flag's color at its pedestal when it returns home.
  puff(id) {
    const flag = this.flags.get(id);
    if (!flag) return;
    const { home, color } = flag.info;
    for (let i = 0; i < PUFF_COUNT; i++) {
      const mesh = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.set(home.x, home.y + 0.8, home.z);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.scene.add(mesh);
      this.puffs.push({ mesh, velocity: dir.multiplyScalar(PUFF_SPEED * (0.5 + Math.random())), born: performance.now() });
    }
  }

  // selfId: the local player, whose carried flag isn't drawn (first person) but whose beam is.
  update(dt, selfId, selfPosition) {
    for (const flag of this.flags.values()) {
      const { model, carriedModel, beam, state } = flag;
      const carrierModel = state.state === FLAG_STATE.CARRIED ? this.entities.object(state.carrierId) : null;

      // Ride on a remote carrier's back.
      if (carrierModel) {
        if (carriedModel.parent !== carrierModel) carrierModel.add(carriedModel);
      } else if (carriedModel.parent) {
        carriedModel.parent.remove(carriedModel);
      }
      carriedModel.visible = !!carrierModel && carrierModel.visible;

      model.visible = state.state === FLAG_STATE.HOME || state.state === FLAG_STATE.DROPPED;
      if (model.visible) {
        const target = new THREE.Vector3(state.x, state.y, state.z);
        // Snap when it jumps (returned home, just dropped), ease otherwise.
        if (!flag.placed || model.position.distanceTo(target) > 3) model.position.copy(target);
        else model.position.lerp(target, Math.min(1, dt * FOLLOW_RATE));
        flag.placed = true;
      } else {
        flag.placed = false;
      }

      beam.visible = state.state === FLAG_STATE.DROPPED || state.state === FLAG_STATE.CARRIED;
      if (!beam.visible) continue;
      let base;
      if (state.state === FLAG_STATE.DROPPED) {
        base = model.position.clone();
      } else if (state.carrierId === selfId) {
        base = new THREE.Vector3(selfPosition.x, selfPosition.y + BEAM_CARRIED_START, selfPosition.z);
      } else if (carrierModel) {
        base = carrierModel.position.clone();
        base.y += BEAM_CARRIED_START;
      } else {
        base = new THREE.Vector3(state.x, state.y + BEAM_CARRIED_START, state.z);
      }
      beam.position.set(base.x, base.y + BEAM_HEIGHT / 2, base.z);
    }

    const now = performance.now();
    this.puffs = this.puffs.filter((p) => {
      const age = (now - p.born) / PUFF_MS;
      if (age >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        return false;
      }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.scale.setScalar(1 - age);
      p.mesh.material.opacity = 1 - age;
      return true;
    });
  }
}
