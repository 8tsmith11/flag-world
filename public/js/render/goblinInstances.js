import * as THREE from 'three';
import { lightModel, lightUniform } from './entityLighting.js';

// Historical rigs still animate their original joints. Only the repeated mesh
// parts render: one instance batch per part and role, with existing voxel light.
export class GoblinInstances {
  constructor(scene) { this.scene = scene; this.batches = new Map(); }
  add(entity) {
    // Rigs supply animation matrices only. Keeping them in the scene also
    // updates every hidden part during rendering, even for distant goblins.
    this.scene.remove(entity.object);
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
      let count=0;
      for (let i = 0; i < batch.members.length; i++) {
        const entity = batch.members[i];
        if(!entity?.object.visible)continue;
        entity.object.updateMatrixWorld(true);
        for (let j = 0; j < batch.meshes.length; j++) {
          const mesh = batch.meshes[j], part = entity.instanceParts[j];
          mesh.setMatrixAt(count, part.matrixWorld);
          const color = entity.light?.value ?? mesh.material.userData.entityLighting.value;
          const flash = entity.flashing ? 0.5 : 0;
          mesh.geometry.getAttribute('instanceLight').setXYZ(count, color.r + flash, color.g, color.b);
        }
        count++;
      }
      for (const mesh of batch.meshes) {
        mesh.count = count;mesh.visible=count>0;
        if(!count)continue;
        mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,count*16);
        mesh.instanceMatrix.needsUpdate = true;
        const light=mesh.geometry.getAttribute('instanceLight');
        light.clearUpdateRanges();light.addUpdateRange(0,count*3);light.needsUpdate = true;
      }
    }
  }
}
