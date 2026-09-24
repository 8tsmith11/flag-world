// Renders non-local entities. Each entity type maps to a model factory; a model
// is either a 3D block model (a THREE.Group of boxes/shapes) or a camera-facing
// sprite (THREE.Sprite) for things like dropped items.
//
// Remote entities are drawn slightly in the past and interpolated between the
// two server snapshots surrounding that time, which hides network jitter.

import * as THREE from 'three';
import { ITEM_SIZE, COW_WIDTH, COW_HEIGHT } from '/shared/config.js';
import { ENTITY_TYPE } from '/shared/protocol.js';
import {
  createPlayerModel, createItemModel, createArrowModel, createCowModel, createDragonModel,
  animatePlayer, animateCow, animateDragon, swingPlayer,
} from './models.js';

const COW_BOX = { halfW: COW_WIDTH / 2, height: COW_HEIGHT };
const DRAGON_BOX = { halfW: 1.1, height: 2.8 };

const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 20;
// Dropped item spin (radians/ms) and bob.
const ITEM_SPIN_SPEED = 0.002;
const ITEM_BOB_HEIGHT = 0.08;
const ITEM_BOB_SPEED = 0.003;
// Red tint on a player who just got hit.
const FLASH_MS = 250;
const FLASH_COLOR = 0xcc0000;

// A dropped item: its item model, small. Models with userData.spin are rotated
// by time instead of following the entity's yaw, and bob.
function createDroppedItemModel({ item }) {
  const group = new THREE.Group();
  const inner = createItemModel(item, ITEM_SIZE);
  inner.scale.setScalar(inner.children.length > 1 ? 0.7 : 1);
  group.add(inner);
  group.userData.spin = { inner, phase: Math.random() * Math.PI * 2 };
  return group;
}

// Camera-facing sprite, for entity types that should render flat.
export function createSpriteModel(texture, width, height) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(width, height, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}

const MODEL_FACTORIES = {
  [ENTITY_TYPE.PLAYER]: createPlayerModel,
  [ENTITY_TYPE.ITEM]: createDroppedItemModel,
  [ENTITY_TYPE.COW]: createCowModel,
  [ENTITY_TYPE.DRAGON]: createDragonModel,
  // Arrows point along their velocity (userData.arrow) instead of a yaw.
  [ENTITY_TYPE.ARROW]: () => {
    const arrow = createArrowModel();
    arrow.userData.arrow = true;
    return arrow;
  },
};

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

export class EntityRenderer {
  constructor(scene) {
    this.scene = scene;
    // id -> { object, info, snapshots: [{ time, x, y, z, yaw, pitch, held, dead }], flashUntil, flashing }
    this.entities = new Map();
  }

  // `info` holds static fields (type, color, ...) from WELCOME / ENTITY_SPAWN.
  add(id, info) {
    if (this.entities.has(id)) return;
    const factory = MODEL_FACTORIES[info.type];
    if (!factory) return;
    const object = factory(info);
    this.scene.add(object);
    this.entities.set(id, { object, info, snapshots: [], flashUntil: 0, flashing: false });
    this.pushSnapshot(id, info);
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.scene.remove(entity.object);
    disposeObject(entity.object);
    this.entities.delete(id);
  }

  pushSnapshot(id, snap) {
    const entity = this.entities.get(id);
    if (!entity) return;
    const dead = !!snap.dead;
    // Dying or respawning moves the player instantly; don't interpolate across it.
    if (entity.snapshots.at(-1)?.dead !== dead) entity.snapshots.length = 0;
    entity.snapshots.push({
      time: performance.now(), x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw, pitch: snap.pitch, held: snap.held,
      crouching: !!snap.crouching, draw: snap.draw ?? 0, armor: snap.armor ?? null,
      gliding: !!snap.gliding, breathing: !!snap.breathing, walking: !!snap.walking,
      onGround: !!snap.onGround,
      aimYaw: snap.aimYaw ?? 0, aimPitch: snap.aimPitch ?? 0,
      vx: snap.vx, vy: snap.vy, vz: snap.vz, dead,
    });
    if (entity.snapshots.length > MAX_SNAPSHOTS) entity.snapshots.shift();
  }

  // Plays a player's arm swing (sent by the server when they punch, mine or place).
  swing(id) {
    const entity = this.entities.get(id);
    if (entity?.object.userData.player) swingPlayer(entity.object);
  }

  flash(id) {
    const entity = this.entities.get(id);
    if (entity) entity.flashUntil = performance.now() + FLASH_MS;
  }

  // The model for an entity, or null.
  object(id) {
    return this.entities.get(id)?.object ?? null;
  }

  // What a punch can hit, as drawn this frame: live players, cows and dragons, as
  // { id, state: { x, y, z, crouching, box? } } for raycastPlayers.
  attackTargets() {
    const targets = this.playerTargets();
    for (const [id, { object, info }] of this.entities) {
      if (info.type !== ENTITY_TYPE.COW && info.type !== ENTITY_TYPE.DRAGON) continue;
      const { x, y, z } = object.position;
      targets.push({ id, state: { x, y, z, box: info.type === ENTITY_TYPE.COW ? COW_BOX : DRAGON_BOX } });
    }
    return targets;
  }

  // Live players as drawn this frame, as { id, state: { x, y, z, crouching } } for raycastPlayers.
  playerTargets() {
    const targets = [];
    for (const [id, { object, info, snapshots }] of this.entities) {
      if (info.type !== ENTITY_TYPE.PLAYER || !object.visible) continue;
      const { x, y, z } = object.position;
      targets.push({ id, state: { x, y, z, crouching: !!snapshots.at(-1)?.crouching } });
    }
    return targets;
  }

  update(dt) {
    const now = performance.now();
    const renderTime = now - INTERP_DELAY_MS;
    for (const entity of this.entities.values()) {
      const { object, snapshots } = entity;
      if (snapshots.length === 0) continue;
      object.visible = !snapshots.at(-1).dead;
      const flashing = now < entity.flashUntil;
      if (flashing !== entity.flashing) {
        entity.flashing = flashing;
        object.traverse((o) => o.material?.emissive?.setHex(flashing ? FLASH_COLOR : 0x000000));
      }
      // Find the pair of snapshots straddling renderTime; clamp at the ends.
      let i = snapshots.length - 1;
      while (i > 0 && snapshots[i - 1].time > renderTime) i--;
      const b = snapshots[i];
      const a = snapshots[Math.max(0, i - 1)];
      const t = b.time === a.time ? 1 : Math.max(0, Math.min(1, (renderTime - a.time) / (b.time - a.time)));
      object.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      const spin = object.userData.spin;
      if (object.userData.arrow) {
        // Face along the flight. A stuck arrow keeps the direction it hit with.
        const vx = a.vx + (b.vx - a.vx) * t, vy = a.vy + (b.vy - a.vy) * t, vz = a.vz + (b.vz - a.vz) * t;
        if (vx || vy || vz) object.lookAt(object.position.x + vx, object.position.y + vy, object.position.z + vz);
      } else if (spin) {
        object.rotation.y = now * ITEM_SPIN_SPEED + spin.phase;
        spin.inner.position.y = ITEM_BOB_HEIGHT * (1 + Math.sin(now * ITEM_BOB_SPEED + spin.phase));
      } else {
        object.rotation.y = lerpAngle(a.yaw, b.yaw, t);
        if (object.userData.dragon) object.rotation.x = a.pitch + (b.pitch - a.pitch) * t;
      }
      const span = (b.time - a.time) / 1000;
      const speed = span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0;
      if (object.userData.cow) animateCow(object, dt, speed);
      if (object.userData.dragon) animateDragon(object, dt, b.breathing, b.walking,
        b.aimYaw, b.aimPitch);
      if (object.userData.player) {
        animatePlayer(object, {
          dt, speed, pitch: a.pitch + (b.pitch - a.pitch) * t, held: b.held, armor: b.armor, crouching: b.crouching, draw: b.draw, gliding: b.gliding,
        });
      }
    }
  }

  get count() {
    return this.entities.size;
  }
}
