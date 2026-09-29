import * as THREE from 'three';

// Combine unanimated direct children by material, preserving vertex normals
// and UVs. Animated pivots stay separate and keep their original transforms.
export function mergeStaticMeshes(group) {
  const batches = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || Array.isArray(mesh.material)) continue;
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push({ mesh, geometry });
  }
  for (const [material, parts] of batches) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, first] of Object.entries(parts[0].geometry.attributes)) {
      const length = parts.reduce((n, p) => n + p.geometry.getAttribute(name).array.length, 0);
      const array = new Float32Array(length); let offset = 0;
      for (const p of parts) {
        const values = p.geometry.getAttribute(name).array; array.set(values, offset); offset += values.length;
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(array, first.itemSize));
    }
    for (const p of parts) { group.remove(p.mesh); p.mesh.geometry.dispose(); p.geometry.dispose(); }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
}
