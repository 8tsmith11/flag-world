import { createGoblinModel, createTotemModel, animateGoblin, animateTotem, swingGoblin } from './goblinModels.js';
import { GoblinInstances } from './goblinInstances.js';
import { GOBLINS, roleOf, boxOf as goblinBox } from '/shared/goblins/life.js';
import { GOBLIN_STATE } from '/shared/protocol.js';
// Renders non-local entities. Each entity type maps to a model factory; a model
// is either a 3D block model (a THREE.Group of boxes/shapes) or a camera-facing
// sprite (THREE.Sprite) for things like dropped items.
//
// Remote entities are drawn slightly in the past and interpolated between the
// two server snapshots surrounding that time, which hides network jitter.

import * as THREE from 'three';
import { updateEntityLight, lightModel, lightUniform } from './entityLighting.js';
import { sampleSnapshots, resetSnapshots } from './snapshotInterpolation.js';
import { ITEM_SIZE, COW_WIDTH, COW_HEIGHT, CRAWLER_WIDTH, CRAWLER_HEIGHT, LIGHTING as C, NAMETAG } from '/shared/config.js';
import { ENTITY_TYPE } from '/shared/protocol.js';
import {
  createPlayerModel, createItemModel, createArrowModel, createCowModel, createDragonModel,
  createCrawlerModel, createEelModel, animatePlayer, animateCow, animateDragon, animateCrawler, animateEel, swingPlayer,
} from './models.js';
import { GrappleLine } from './grappleLine.js';
import { createNpcModel, animateMonkey, updateMonkeyTeam, setMonkeyHeld, setMonkeyArmor } from './monkeyModels.js';
import { getItemDef } from '/shared/items.js';
import { createMerchantModel, animateMerchant, createAirshipModel, animateAirship } from './merchantModels.js';
import { MONKEY_DUTY } from '/shared/config.js';
import { NPC_DEFS } from '/shared/npcs.js';

const COW_BOX = { halfW: COW_WIDTH / 2, height: COW_HEIGHT };
const DRAGON_BOX = { halfW: 1.1, height: 2.8 };
// Punchable mobs and their boxes (feet position and height), as on the server.
const MOB_BOXES = {
  [ENTITY_TYPE.COW]: COW_BOX,
  [ENTITY_TYPE.DRAGON]: DRAGON_BOX,
  [ENTITY_TYPE.CRAWLER]: { halfW: CRAWLER_WIDTH / 2, height: CRAWLER_HEIGHT },
  [ENTITY_TYPE.VOID_EEL]: { halfW: 0.6, height: 0.8 },
};
// NPC boxes depend on their kind.
const boxOf = (info) => MOB_BOXES[info.type] ?? (GOBLINS[roleOf(info.type)] ? goblinBox(roleOf(info.type)) : null) ?? (info.type === ENTITY_TYPE.NPC ? NPC_DEFS[info.npc]?.box : undefined);

const MAX_SNAPSHOTS = 20;
// Dropped item spin (radians/ms) and bob.
const ITEM_SPIN_SPEED = 0.002;
const ITEM_BOB_HEIGHT = 0.08;
const ITEM_BOB_SPEED = 0.003;
// Red tint on a player who just got hit.
const FLASH_MS = 250;
const FLASH_COLOR = 0xcc0000;
// A player's hand, roughly, above their feet: where a grappling rope starts.
const HAND_HEIGHT = 1.1;

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

// A thrown grenade: an olive body with grooves, a steel cap and a red lamp
// that blinks faster as its fuse runs down (animateGrenade).
function createGrenadeModel() {
  const group = new THREE.Group(), s = 0.16;
  const body = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), new THREE.MeshLambertMaterial({ color: 0x4b5a3a }));
  body.scale.y = 1.15; group.add(body);
  const groove = new THREE.MeshLambertMaterial({ color: 0x2f3a24 });
  for (const y of [-0.06, 0.06]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.98, 0.012, 4, 14), groove); ring.rotation.x = Math.PI / 2; ring.position.y = y; group.add(ring); }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 8), new THREE.MeshLambertMaterial({ color: 0x8d9299 }));
  cap.position.y = s * 1.15; group.add(cap);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  lamp.position.y = s * 1.15 + 0.05; group.add(lamp);
  group.userData.grenade = { lamp, spin: Math.random() * Math.PI * 2 };
  return group;
}
function animateGrenade(object, dt, fuse, moving) {
  const g = object.userData.grenade;
  g.age = (g.age ?? 0) + dt;
  const rate = fuse > 30 ? 3 : fuse > 12 ? 6 : 12;
  g.lamp.visible = Math.sin(g.age * rate * Math.PI * 2) > 0;
  if (moving) { g.spin += dt * 9; object.children[0].rotation.z = g.spin; }
}

// A fishing bobber: red over white. Its inner group ('float') is moved by
// fishingEffects.js (bobbing, and dipping when something bites).
function createBobberModel() {
  const group = new THREE.Group(), float = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd8402e }));
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
  stick.position.y = 0.15;
  float.add(top, bottom, stick);
  group.add(float);
  group.userData.bobber = { float };
  return group;
}

// Camera-facing sprite, for entity types that should render flat.
export function createSpriteModel(texture, width, height) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(width, height, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}

// A name floating above a player's head. A world-space sprite: it is hidden
// by walls (depth tested), shrinks with distance, takes fog, and is lit by
// the same entity light as the body (lightModel patches it), so it is never
// easier to see than the player. Hidden while they sneak.
function createNametag(name) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  const font = 'bold 40px sans-serif';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 24;
  canvas.width = width; canvas.height = 56;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, width, 56);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(name, width / 2, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const height = NAMETAG.height;
  sprite.scale.set(height * width / 56, height, 1);
  sprite.center.set(0.5, 0);
  sprite.position.y = NAMETAG.above;
  sprite.userData.nametag = name;
  return sprite;
}

// A cow in love gives off little rising hearts.
let heartTexture = null;
function heartSprite() {
  if (!heartTexture) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff3d6e';
    ctx.beginPath(); ctx.moveTo(16, 28);
    ctx.bezierCurveTo(2, 18, 2, 6, 10, 6); ctx.bezierCurveTo(14, 6, 16, 9, 16, 11);
    ctx.bezierCurveTo(16, 9, 18, 6, 22, 6); ctx.bezierCurveTo(30, 6, 30, 18, 16, 28); ctx.fill();
    heartTexture = new THREE.CanvasTexture(canvas); heartTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture, transparent: true, depthWrite: false }));
  sprite.scale.set(0.3, 0.3, 1);
  return sprite;
}

const MODEL_FACTORIES = {
  ...Object.fromEntries(['worker','soldier','archer','brute','king'].map(role => [`goblin${role[0].toUpperCase()}${role.slice(1)}`, createGoblinModel])),
  goblinTotem: createTotemModel,
  [ENTITY_TYPE.PLAYER]: createPlayerModel,
  [ENTITY_TYPE.ITEM]: createDroppedItemModel,
  [ENTITY_TYPE.RIFT_ORB]: createDroppedItemModel,
  [ENTITY_TYPE.COW]: createCowModel,
  [ENTITY_TYPE.DRAGON]: createDragonModel,
  [ENTITY_TYPE.CRAWLER]: createCrawlerModel,
  [ENTITY_TYPE.VOID_EEL]: createEelModel,
  [ENTITY_TYPE.NPC]: (info) => info.npc === 'skyMerchant' ? createMerchantModel(info) : createNpcModel(info),
  [ENTITY_TYPE.AIRSHIP]: createAirshipModel,
  [ENTITY_TYPE.GRENADE]: createGrenadeModel,
  [ENTITY_TYPE.BOBBER]: createBobberModel,
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
    this.goblinInstances = new GoblinInstances(scene);
    this.frustum=new THREE.Frustum();this.viewProjection=new THREE.Matrix4();this.goblinBounds=new THREE.Sphere();
  }

  // `info` holds static fields (type, color, ...) from WELCOME / ENTITY_SPAWN.
  add(id, info) {
    if (this.entities.has(id)) return;
    const factory = MODEL_FACTORIES[info.type];
    if (!factory) return;
    const object = factory(info);
    if (info.type === ENTITY_TYPE.PLAYER && info.name) {
      object.userData.nametag = createNametag(info.name);
      object.add(object.userData.nametag);
    }
    this.scene.add(object);
    this.entities.set(id, { object, info, snapshots: [], unloaded: info.loaded === false, flashUntil: 0, flashing: false });
    if (object.userData.goblin) this.goblinInstances.add(this.entities.get(id));
    this.pushSnapshot(id, info);
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.goblinInstances.remove(entity);
    this.scene.remove(entity.object);
    disposeObject(entity.object);
    for (const heart of entity.hearts ?? []) { this.scene.remove(heart); heart.material.dispose(); }
    entity.grappleLine?.dispose();
    this.entities.delete(id);
  }

  pushSnapshot(id, snap) {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (snap.unloaded) {
      entity.unloaded = true;
      entity.object.visible = false;
      return;
    }
    entity.unloaded = snap.loaded === false;
    const dead = !!snap.dead;
    // Dying or respawning moves the player instantly; don't interpolate across it.
    const previous = entity.snapshots.at(-1);
    if(resetSnapshots(previous,snap,entity.info.type))entity.snapshots.length=0;
    entity.snapshots.push({
      time: performance.now(),u:snap.u ?? 1, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw, pitch: snap.pitch, held: snap.held,
      crouching: !!snap.crouching, draw: snap.draw ?? 0, armor: snap.armor ?? null, love: !!snap.love, tool: snap.tool ?? null,
      accessory: snap.accessory ?? null,
      orbActive: !!snap.orbActive,
      slowed: snap.slowTicks > 0, grapple: snap.grapple ?? null,
      gliding: !!snap.gliding, breathing: !!snap.breathing,
      walking: !!snap.walking, g: snap.g ?? GOBLIN_STATE.IDLE,
      climbing: !!snap.climbing,
      coiling: !!snap.coiling, lunging: !!snap.lunging, night: !!snap.night, tail: snap.tail ?? null,
      onGround: !!snap.onGround,
      aimYaw: snap.aimYaw ?? 0, aimPitch: snap.aimPitch ?? 0,
      pose: snap.pose ?? null, look: snap.look ?? 0,
      thrust: snap.thrust ?? 0, pilot: !!snap.pilot, baby: !!snap.baby, fuse: snap.fuse ?? null,
      bite: !!snap.bite, where: snap.where ?? null,
      team: snap.team ?? null, name: snap.name ?? entity.info.name,
      vx: snap.vx, vy: snap.vy, vz: snap.vz, dead,
    });
    if (entity.snapshots.length > MAX_SNAPSHOTS) entity.snapshots.shift();
  }

  // Hearts drift up from a cow in love and fade; none spawn otherwise.
  updateHearts(entity, dt, love) {
    entity.hearts ??= [];
    entity.heartTimer = (entity.heartTimer ?? 0) - dt;
    if (love && entity.heartTimer <= 0) {
      entity.heartTimer = 0.45 + Math.random() * 0.4;
      const heart = heartSprite(), p = entity.object.position;
      heart.position.set(p.x + (Math.random() - 0.5) * 0.8, p.y + 1.3, p.z + (Math.random() - 0.5) * 0.8);
      heart.userData.age = 0;
      this.scene.add(heart); entity.hearts.push(heart);
    }
    for (const heart of [...entity.hearts]) {
      heart.userData.age += dt; heart.position.y += dt * 0.6;
      heart.material.opacity = Math.max(0, 1 - heart.userData.age / 1.4);
      if (heart.userData.age >= 1.4) { this.scene.remove(heart); heart.material.dispose(); entity.hearts.splice(entity.hearts.indexOf(heart), 1); }
    }
  }

  // Plays a player's arm swing (sent by the server when they punch, mine or
  // place), or a melee goblin's strike.
  swing(id) {
    const entity = this.entities.get(id);
    if (entity?.object.userData.player) swingPlayer(entity.object);
    else if (entity?.object.userData.goblin) swingGoblin(entity.object);
  }

  flash(id) {
    const entity = this.entities.get(id);
    if (entity) entity.flashUntil = performance.now() + FLASH_MS;
  }

  // An NPC speaking to us moves its jaw for this long.
  talk(id, seconds) {
    const entity = this.entities.get(id);
    if (entity) entity.talkUntil = performance.now() + seconds * 1000;
  }

  // The model for an entity, or null.
  object(id) {
    return this.entities.get(id)?.object ?? null;
  }

  // What a punch can hit, as drawn this frame: live players and mobs, as
  // { id, state: { x, y, z, crouching, box? } } for raycastPlayers.
  attackTargets() {
    const targets = this.playerTargets();
    for (const [id, { object, info }] of this.entities) {
      const box = boxOf(info);
      if (!box || !object.visible) continue;
      const { x, y, z } = object.position;
      const tail = info.type === ENTITY_TYPE.VOID_EEL ? this.entities.get(id).snapshots.at(-1)?.tail : null;
      targets.push({ id, state: { x, y, z, box },
        extraHitBoxes: tail ? () => [{ x: tail.x, y: tail.y - 0.2, z: tail.z,
          halfW: 0.25, height: 0.4 }] : undefined });
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

  update(dt, world, daylight, camera) {
    const now = performance.now();
    if(camera) {
      camera.updateMatrixWorld();
      this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
    }
    for (const entity of this.entities.values()) {
      const { object, snapshots } = entity;
      if (snapshots.length === 0) continue;
      object.visible = !entity.unloaded && !snapshots.at(-1).dead;
      if (entity.unloaded) {
        if (object.userData.dragon) this.scene.remove(object);
        entity.grappleLine?.update(object.position, null);
        continue;
      }
      const latest = snapshots.at(-1);
      if (camera && (latest.x-camera.position.x)**2 + (latest.y-camera.position.y)**2
        + (latest.z-camera.position.z)**2 > (camera.far + (object.userData.dragon ? 16 : object.userData.airship ? 24 : 0))**2) {
        object.visible = false;
        if (object.userData.dragon) this.scene.remove(object);
        continue;
      }
      const flashing = now < entity.flashUntil;
      if (flashing !== entity.flashing) {
        entity.flashing = flashing;
        object.traverse((o) => o.material?.emissive?.setHex(flashing ? FLASH_COLOR : 0x000000));
      }
      const {a,b,t}=sampleSnapshots(snapshots,now);
      object.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      if (object.userData.dragon) {
        this.goblinBounds.center.copy(object.position);this.goblinBounds.center.y += 1.5;
        this.goblinBounds.radius = latest.breathing || b.breathing ? 16 : 4;
        if (!object.visible || (camera && !this.frustum.intersectsSphere(this.goblinBounds))) {
          object.visible = false; this.scene.remove(object); continue;
        }
        if (object.parent !== this.scene) this.scene.add(object);
      }
      if (entity.info.npc === 'workMonkey') {
        entity.info.team = latest.team; entity.info.name = latest.name;
        updateMonkeyTeam(object, latest.team);
        // Baby monkeys are drawn smaller until they grow up.
        const scale = (latest.baby ? MONKEY_DUTY.baby.scale : 1) * (object.userData.baseScale ??= object.scale.x);
        if (Math.abs(object.scale.x - scale) > 1e-3) object.scale.setScalar(scale);
      }
      if(camera&&object.userData.goblin) {
        const height=boxOf(entity.info).height;
        this.goblinBounds.center.copy(object.position);this.goblinBounds.center.y+=height/2;
        // Leave room for animated arms, weapons and head turns at the edges.
        this.goblinBounds.radius=height+1;
        if(!this.frustum.intersectsSphere(this.goblinBounds)){object.visible=false;continue;}
      }
      // Off-screen models keep their position but skip animation and lighting.
      // Three culls the meshes itself; this saves the per-frame JS.
      if (camera && !object.userData.dragon && !object.userData.goblin && !entity.grappleLine) {
        this.goblinBounds.center.copy(object.position);
        const height = object.userData.airship ? 16 : boxOf(entity.info)?.height ?? 2;
        this.goblinBounds.center.y += height / 2;
        this.goblinBounds.radius = height + 1;
        if (!this.frustum.intersectsSphere(this.goblinBounds)) continue;
      }
      const spin = object.userData.spin;
      if (object.userData.arrow) {
        // Face along the flight. A stuck arrow keeps the direction it hit with.
        const vx = a.vx + (b.vx - a.vx) * t, vy = a.vy + (b.vy - a.vy) * t, vz = a.vz + (b.vz - a.vz) * t;
        if (vx || vy || vz) object.lookAt(object.position.x + vx, object.position.y + vy, object.position.z + vz);
      } else if (object.userData.eel) {
        // The body trails in world space; the head turns on its own.
        animateEel(object, dt, lerpAngle(a.yaw, b.yaw, t), a.pitch + (b.pitch - a.pitch) * t,
          !!b.coiling, !!b.night);
      } else if (spin) {
        object.rotation.y = now * ITEM_SPIN_SPEED + spin.phase;
        spin.inner.position.y = ITEM_BOB_HEIGHT * (1 + Math.sin(now * ITEM_BOB_SPEED + spin.phase));
      } else {
        // (Some entities, such as grenades, have no yaw: a NaN rotation would
        // make the whole model vanish.)
        object.rotation.y = lerpAngle(a.yaw ?? 0, b.yaw ?? 0, t);
        if (object.userData.dragon) object.rotation.x = a.pitch + (b.pitch - a.pitch) * t;
      }
      const span = (b.time - a.time) / 1000;
      const speed = span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0;
      if (object.userData.goblin) animateGoblin(object, dt, b.g === GOBLIN_STATE.WALK ? Math.max(speed, 1.5) : 0, { climbing: b.g === GOBLIN_STATE.CLIMB, mining: b.g === GOBLIN_STATE.WORK });
      if (object.userData.totem) animateTotem(object, dt);
      if (object.userData.cow) { animateCow(object, dt, speed); this.updateHearts(entity, dt, !!b.love && object.visible); }
      if (object.userData.crawler) animateCrawler(object, dt, speed, b.climbing);
      if (object.userData.monkey) {
        setMonkeyHeld(object, b.tool ?? null, createItemModel);
        setMonkeyArmor(object, b.armor ?? null, item => getItemDef(item).color);
        animateMonkey(object, dt, { pose: b.pose ?? 'sit', look: b.look, speed,
          talking: now < (entity.talkUntil ?? 0) });
      }
      if (object.userData.merchant) animateMerchant(object, dt, { speed, look: b.look, pose: b.pose,
        talking: now < (entity.talkUntil ?? 0) });
      if (object.userData.airship) animateAirship(object, dt, { thrust: b.thrust, pilot: b.pilot });
      if (object.userData.grenade) { animateGrenade(object, dt, b.fuse ?? 50, Math.hypot(b.vx ?? 0, b.vz ?? 0) > 0.2); this.onGrenade?.(entity.id, object.position, b.fuse ?? 50); }
      if (object.userData.dragon) animateDragon(object, dt, b.breathing, b.walking,
        b.aimYaw, b.aimPitch, { swoop: b.swoop ?? 0, attack: b.attack ?? null });
      // A renamed player gets a new tag (relit with the body below).
      if (object.userData.nametag && b.name && object.userData.nametag.userData.nametag !== b.name) {
        object.remove(object.userData.nametag);
        object.userData.nametag.material.map.dispose(); object.userData.nametag.material.dispose();
        object.userData.nametag = createNametag(b.name);
        object.add(object.userData.nametag);
        entity.lightEquipment = null;
      }
      if (object.userData.nametag) object.userData.nametag.visible = !b.crouching && !b.dead;
      if (object.userData.player) {
        animatePlayer(object, {
          dt, speed, pitch: a.pitch + (b.pitch - a.pitch) * t, held: b.held, armor: b.armor,
          accessory: b.accessory, crouching: b.crouching, draw: b.draw, gliding: b.gliding,
          slowed: b.slowed, orbActive: b.orbActive,
        });
        const grapple = object.visible ? b.grapple : null;
        if (grapple && !entity.grappleLine) entity.grappleLine = new GrappleLine(this.scene);
        const p = object.position;
        entity.grappleLine?.update({ x: p.x, y: p.y + HAND_HEIGHT, z: p.z }, grapple);
      }
      if (world && daylight) {
        entity.light ??= lightUniform();
        // The dragon's origin sinks below the grass top when it lands. Sample
        // the model's body, rather than the opaque block around its feet.
        const height=boxOf(entity.info)?.height;
        const sampleHeight=height ? height*(height>C.entityTallThreshold?C.entityHeadFraction:0.5)
          : entity.info.type===ENTITY_TYPE.PLAYER ? C.entityPlayerSample*(b.crouching?C.entityCrouchSampleScale:1)
          : entity.info.type===ENTITY_TYPE.ITEM||entity.info.type===ENTITY_TYPE.RIFT_ORB ? C.entityItemSample : 0;
        updateEntityLight(world,object.position,daylight,entity.light,dt,sampleHeight);
        // Revisit only when equipment changes, since it creates new materials.
        const equipment = `${b.held}:${b.armor}:${b.accessory}:${b.tool}`;
        if (!object.userData.goblin && entity.lightEquipment !== equipment) {
          lightModel(object, entity.light);
          entity.lightEquipment = equipment;
        }
      }
    }
    this.goblinInstances.update();
  }

  get count() {
    return this.entities.size;
  }
}
