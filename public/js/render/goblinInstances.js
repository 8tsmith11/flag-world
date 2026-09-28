import * as THREE from 'three';
import { lightModel, lightUniform } from './entityLighting.js';

// Historical rigs still animate their original joints. Only the repeated mesh
// parts render: one instance batch per part and role, with existing voxel light.
export class GoblinInstances {
  constructor(scene) { this.scene = scene; this.batches = new Map(); this.hidden = new THREE.Matrix4().makeScale(0, 0, 0); }
  add(entity) {
    let batch = this.batches.get(entity.info.type);
    const parts = []; entity.object.traverse(o => { if (o.isMesh) { parts.push(o); o.visible = false; } });
    if (!batch) { batch = { members: [], templates: parts, meshes: [], capacity: 0 }; this.batches.set(entity.info.type, batch); }
    const index = batch.members.findIndex(e => !e);
    entity.instanceIndex = index < 0 ? batch.members.length : index; entity.instanceParts = parts;
    batch.members[entity.instanceIndex] = entity;
    if (batch.members.length > batch.capacity) this.resize(batch, Math.max(16, batch.capacity * 2));
  }
  resize(batch, capacity) {
    for (const mesh of batch.meshes) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
    batch.capacity = capacity;
    batch.meshes = batch.templates.map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry.clone(), part.material.clone(), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      lightModel(mesh, lightUniform()); mesh.count = 0; this.scene.add(mesh); return mesh;
    });
  }
  remove(entity) {
    const batch = this.batches.get(entity.info.type); if (batch) batch.members[entity.instanceIndex] = null;
  }
  update() {
    for (const batch of this.batches.values()) {
      for (let i = 0; i < batch.members.length; i++) {
        const entity = batch.members[i]; if (entity?.object.visible) entity.object.updateMatrixWorld(true);
        for (let j = 0; j < batch.meshes.length; j++) {
          const mesh = batch.meshes[j], part = entity?.instanceParts[j];
          mesh.setMatrixAt(i, entity?.object.visible && part ? part.matrixWorld : this.hidden);
          const color = entity?.light?.value ?? mesh.material.userData.entityLighting.value;
          const flash = entity?.flashing ? 0.5 : 0;
          mesh.geometry.getAttribute('instanceLight').setXYZ(i, color.r + flash, color.g, color.b);
        }
      }
      for (const mesh of batch.meshes) {
        mesh.count = batch.members.length; mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.getAttribute('instanceLight').needsUpdate = true;
      }
    }
  }
}
