import * as THREE from 'three';

const iron = new THREE.MeshLambertMaterial({ color: 0x9da1a7 });
const dark = new THREE.MeshLambertMaterial({ color: 0x42464b });
const wood = new THREE.MeshLambertMaterial({ color: 0x76583a });
const keyOf = ({ x, y, z }) => `${x},${y},${z}`;

function turretModel() {
  const root = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.4, 8), iron);
  neck.position.y = 0.2;
  root.add(neck);
  const yawPivot = new THREE.Group();
  yawPivot.position.y = 0.48;
  const head = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.25, 0.55), dark);
  housing.position.z = -0.1;
  head.add(housing);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.65), wood);
  barrel.position.z = -0.43;
  head.add(barrel);
  for (const side of [-1, 1]) {
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.65), iron);
    limb.position.set(side * 0.27, 0, -0.36);
    limb.rotation.y = side * 0.28;
    head.add(limb);
  }
  yawPivot.add(head);
  root.add(yawPivot);
  root.userData.yawPivot = yawPivot;
  root.userData.head = head;
  return root;
}

export class TurretRenderer {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map();
  }

  sync(snapshots) {
    const present = new Set();
    for (const snapshot of snapshots ?? []) {
      const key = keyOf(snapshot);
      present.add(key);
      let entry = this.models.get(key);
      if (!entry) {
        const model = turretModel();
        model.position.set(snapshot.x + 0.5, snapshot.y + 1, snapshot.z + 0.5);
        this.scene.add(model);
        entry = { model, yaw: snapshot.yaw, targetYaw: snapshot.yaw,
          pitch: snapshot.pitch ?? 0, targetPitch: snapshot.pitch ?? 0 };
        model.userData.yawPivot.rotation.y = snapshot.yaw;
        model.userData.head.rotation.x = snapshot.pitch ?? 0;
        this.models.set(key, entry);
      }
      entry.targetYaw = snapshot.yaw;
      entry.targetPitch = snapshot.pitch ?? 0;
    }
    for (const [key, entry] of this.models) {
      if (present.has(key)) continue;
      this.scene.remove(entry.model);
      this.models.delete(key);
    }
  }

  update(dt) {
    for (const entry of this.models.values()) {
      const difference = Math.atan2(Math.sin(entry.targetYaw - entry.yaw), Math.cos(entry.targetYaw - entry.yaw));
      entry.yaw += difference * Math.min(1, dt * 12);
      entry.model.userData.yawPivot.rotation.y = entry.yaw;
      entry.pitch += (entry.targetPitch - entry.pitch) * Math.min(1, dt * 12);
      entry.model.userData.head.rotation.x = entry.pitch;
    }
  }
}
