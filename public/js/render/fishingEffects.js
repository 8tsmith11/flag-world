// Fishing, drawn on clients from bobber entities (the server decides
// everything):
//   - a fishing line from the rod tip of whoever cast it to the bobber:
//     your own rod in first person (the view model), anyone else's rod in
//     their hand (players and Fisherman monkeys); it sags a little
//   - bites: the owner's rod tip bends down a little while something bites
//     (in every environment: in the void it is the only sign); in water and
//     lava the bobber also dips and splashes
//   - the bobber bobs gently on water and lava
// No text tells anyone to reel in, and there is no countdown.
import * as THREE from 'three';

const SEGMENTS = 14;
const DROP = new THREE.BoxGeometry(0.05, 0.05, 0.05);

export class FishingEffects {
  constructor(scene, sounds) {
    this.scene = scene;
    this.sounds = sounds;
    this.lines = new Map();
    this.bites = new Map();
    this.particles = [];
    this.time = 0;
    this.material = new THREE.LineBasicMaterial({ color: 0xe8e4da, transparent: true, opacity: 0.85 });
  }

  line(id) {
    let line = this.lines.get(id);
    if (!line) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
      line = new THREE.Line(geometry, this.material);
      line.frustumCulled = false;
      this.scene.add(line);
      this.lines.set(id, line);
    }
    return line;
  }

  splash(at, lava) {
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(DROP, new THREE.MeshBasicMaterial({ color: lava ? (i % 2 ? 0xff8a2a : 0xffd36a) : (i % 2 ? 0xbfe4ff : 0xffffff),
        transparent: true, depthWrite: false }));
      mesh.position.copy(at);
      this.scene.add(mesh);
      this.particles.push({ mesh, vx: (Math.random() - 0.5) * 2.4, vy: 1.5 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 2.4, life: 0.5, left: 0.5 });
    }
    this.sounds?.noiseBurst?.(0.18, lava ? 700 : 1800, 0.22, at, this.sounds.mixer?.listener);
  }

  // entities: the EntityRenderer; localId: your player id; viewModel and
  // camera for your own first-person rod.
  update(dt, entities, localId, viewModel, camera) {
    this.time += dt;
    const seen = new Set(), tip = new THREE.Vector3();
    for (const [id, entity] of entities.entities) {
      if (entity.info.type !== 'bobber') continue;
      seen.add(id);
      const b = entity.snapshots.at(-1) ?? entity.info;
      const bite = !!b.bite, floating = b.where === 'water' || b.where === 'lava';
      // Bobbing and the bite dip.
      const float = entity.object.userData.bobber?.float;
      if (float) float.position.y = bite && floating ? -0.13 + Math.sin(this.time * 32) * 0.035 : floating ? Math.sin(this.time * 2.2 + id) * 0.025 : 0;
      if (bite && !this.bites.get(id) && floating) this.splash(entity.object.position.clone(), b.where === 'lava');
      this.bites.set(id, bite);
      // The rod casting it: bend its tip while something bites, and find the
      // end of the line.
      const ownerId = entity.info.owner;
      let holder = null;
      if (ownerId === localId) holder = viewModel?.hand ?? null;
      else holder = entities.entities.get(ownerId)?.object ?? null;
      const rodTip = holder?.getObjectByName('rodTip');
      if (rodTip) rodTip.rotation.x += ((bite ? -0.38 : 0) - rodTip.rotation.x) * Math.min(1, dt * 14);
      const rodEnd = holder?.getObjectByName('rodEnd');
      if (ownerId === localId && rodEnd && viewModel) {
        // The view model has its own scene and camera: its coordinates are
        // camera space, so carry them into the world with the main camera.
        viewModel.scene.updateMatrixWorld();
        rodEnd.getWorldPosition(tip);
        tip.applyMatrix4(viewModel.camera.matrixWorldInverse);
        camera.localToWorld(tip);
      } else if (rodEnd) rodEnd.getWorldPosition(tip);
      else if (holder) tip.copy(holder.position).add(new THREE.Vector3(0, 1.4, 0));
      else if (ownerId === localId) tip.copy(camera.position).add(new THREE.Vector3(0, -0.3, 0));
      else { this.lines.get(id) && (this.lines.get(id).visible = false); continue; }
      // A gently sagging line from the tip to the bobber.
      const end = entity.object.position, line = this.line(id), pos = line.geometry.attributes.position;
      const length = tip.distanceTo(end), sag = Math.min(1.5, length * 0.06);
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        pos.setXYZ(i, tip.x + (end.x - tip.x) * t, tip.y + (end.y + 0.12 - tip.y) * t - sag * 4 * t * (1 - t), tip.z + (end.z - tip.z) * t);
      }
      pos.needsUpdate = true;
      line.visible = true;
    }
    for (const [id, line] of this.lines) if (!seen.has(id)) { this.scene.remove(line); line.geometry.dispose(); this.lines.delete(id); this.bites.delete(id); }
    // Straighten any rod whose bobber is gone.
    if (viewModel?.hand && ![...seen].some((id) => entities.entities.get(id)?.info.owner === localId)) {
      const t = viewModel.hand.getObjectByName('rodTip');
      if (t) t.rotation.x *= Math.max(0, 1 - dt * 10);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.left -= dt;
      if (p.left <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.particles.splice(i, 1); continue; }
      p.vy -= 9 * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.material.opacity = p.left / p.life;
    }
  }
}
