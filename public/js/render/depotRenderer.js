// Merchant Depot signs: above each team's depot a brass post with a lantern
// and a hanging sign. While its merchant is docked the lantern glows and a
// gold coin spins above it; while he's away the lantern is dark. Fed by the
// server's `merchants` list (welcome and MERCHANTS messages).
import * as THREE from 'three';

const brass = new THREE.MeshLambertMaterial({ color: 0xc49a3c });
const dark = new THREE.MeshLambertMaterial({ color: 0x3a3530 });
const lit = new THREE.MeshBasicMaterial({ color: 0xffd36a });
const coinMaterial = new THREE.MeshBasicMaterial({ color: 0xf2c230 });

function sign() {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), brass); post.position.y = 0.45; group.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), brass); arm.position.set(0.18, 0.88, 0); group.add(arm);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), dark); lantern.position.set(0.34, 0.72, 0); group.add(lantern);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.22), brass); cap.position.set(0.34, 0.86, 0); group.add(cap);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16), coinMaterial);
  coin.rotation.x = Math.PI / 2; coin.position.set(0, 1.35, 0); group.add(coin);
  group.userData = { lantern, coin };
  return group;
}

export class DepotRenderer {
  constructor(scene) {
    this.scene = scene;
    this.signs = new Map();
    this.time = 0;
  }

  // list: [{ team, depot: {x,y,z,facing} | null, present }]
  set(list) {
    const seen = new Set();
    for (const { team, depot, present } of list ?? []) {
      if (!depot) continue;
      const key = `${team}`;
      seen.add(key);
      let entry = this.signs.get(key);
      if (!entry || entry.at !== `${depot.x},${depot.y},${depot.z}`) {
        if (entry) this.scene.remove(entry.group);
        entry = { group: sign(), at: `${depot.x},${depot.y},${depot.z}` };
        entry.group.position.set(depot.x + 0.5, depot.y + 1, depot.z + 0.5);
        this.scene.add(entry.group);
        this.signs.set(key, entry);
      }
      entry.present = present;
      entry.group.userData.lantern.material = present ? lit : dark;
      entry.group.userData.coin.visible = present;
    }
    for (const [key, entry] of this.signs) if (!seen.has(key)) { this.scene.remove(entry.group); this.signs.delete(key); }
  }

  update(dt) {
    this.time += dt;
    for (const { group, present } of this.signs.values()) {
      if (!present) continue;
      group.userData.coin.rotation.z = this.time * 2.5;
      group.userData.coin.position.y = 1.35 + Math.sin(this.time * 2) * 0.06;
    }
  }
}
