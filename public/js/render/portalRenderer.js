import * as THREE from 'three';

const PORTAL_COLOR = 0x9a6bff;

export class PortalRenderer {
  constructor(scene) {
    this.scene = scene;
    this.portals = new Map();
    this.embers = [];
    this.firePortals = [];
  }

  setWorld(world) {
    for (const entry of this.firePortals) {
      this.scene.remove(entry.group);
      entry.group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    }
    this.firePortals.length = 0;
    for (const portal of [world.fireTemple?.portal, world.dragonArena?.portal]) {
      if (!portal) continue;
      const group = new THREE.Group();
      group.position.set(portal.x, portal.y + portal.height / 2, portal.z);
      const material = new THREE.ShaderMaterial({ transparent: true, side: THREE.DoubleSide,
        depthWrite: false, uniforms: { time: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `varying vec2 vUv; uniform float time;
          void main(){ vec2 p=vUv-0.5; float r=length(p); float a=atan(p.y,p.x);
          float swirl=sin(a*4.0-r*17.0+time*2.4)*0.5+0.5;
          float veins=sin(p.y*30.0+p.x*14.0-time*4.0+swirl*3.0)*0.5+0.5;
          vec3 dark=vec3(0.26,0.015,0.025), fire=vec3(1.0,0.20,0.015), hot=vec3(1.0,0.72,0.18);
          vec3 color=mix(dark,fire,swirl*0.72+veins*0.22);
          color=mix(color,hot,pow(veins*swirl,3.0)*0.75);
          float edge=smoothstep(0.0,0.09,min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)));
          gl_FragColor=vec4(color,0.84*edge); }`,
      });
      const membrane = new THREE.Mesh(new THREE.PlaneGeometry(portal.width, portal.height), material);
      group.add(membrane);
      this.scene.add(group);
      this.firePortals.push({ group, material });
    }
  }

  add(portal) {
    if (this.portals.has(portal.id)) this.remove(portal.id);
    const group = new THREE.Group();
    group.position.set(portal.x, portal.y, portal.z);
    const membrane = new THREE.Mesh(new THREE.CircleGeometry(0.82, 32),
      new THREE.MeshBasicMaterial({ color: 0x7a4bdc, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide, depthWrite: false }));
    membrane.scale.y = 1.35;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.1, 10, 40),
      new THREE.MeshBasicMaterial({ color: PORTAL_COLOR, transparent: true, opacity: 0.95 }));
    rim.scale.y = 1.35;
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.025, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xe2ccff, transparent: true, opacity: 0.85 }));
    inner.scale.y = 1.35;
    group.add(membrane, rim, inner);
    this.scene.add(group);
    this.portals.set(portal.id, { group, membrane, rim, inner });
  }

  remove(id) {
    const portal = this.portals.get(id);
    if (!portal) return;
    this.scene.remove(portal.group);
    portal.group.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    this.portals.delete(id);
  }

  burst(x, y, z) {
    for (let index = 0; index < 28; index++) {
      const angle = index * Math.PI * 2 / 28;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color: index % 3 ? 0xff7b28 : 0xffd068 }));
      mesh.position.set(x, y + 0.9, z);
      this.scene.add(mesh);
      this.embers.push({ mesh, vx: Math.cos(angle) * (2 + index % 4),
        vy: 1.5 + index % 5, vz: Math.sin(angle) * (2 + index % 4), life: 0.9 });
    }
  }

  update(dt, camera) {
    const time = performance.now() / 1000;
    for (const portal of this.firePortals) {
      portal.group.visible = portal.group.position.distanceTo(camera.position) < camera.far;
      portal.material.uniforms.time.value = time;
    }
    for (const portal of this.portals.values()) {
      portal.group.rotation.y = Math.atan2(camera.position.x - portal.group.position.x,
        camera.position.z - portal.group.position.z);
      portal.rim.material.opacity = 0.75 + Math.sin(time * 5) * 0.2;
      portal.membrane.material.opacity = 0.25 + Math.sin(time * 3) * 0.08;
      portal.inner.rotation.z += dt * 0.8;
    }
    this.embers = this.embers.filter((ember) => {
      ember.life -= dt;
      if (ember.life <= 0) {
        this.scene.remove(ember.mesh);
        ember.mesh.geometry.dispose();
        ember.mesh.material.dispose();
        return false;
      }
      ember.mesh.position.x += ember.vx * dt;
      ember.mesh.position.y += ember.vy * dt;
      ember.mesh.position.z += ember.vz * dt;
      ember.vy -= 10 * dt;
      ember.mesh.scale.setScalar(Math.max(0.1, ember.life));
      return true;
    });
  }
}
