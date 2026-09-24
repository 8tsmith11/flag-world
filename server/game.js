// Authoritative game state. Two phases: a lobby where players pick a name and
// color and ready up, then a match with the world, players and the fixed-rate
// tick loop. A match runs until the server stops; players who connect during it
// can reclaim a disconnected player by name or wait on the in-progress screen.

import {
  TICK_RATE, MAX_QUEUED_INPUTS, PLAYER_HEIGHT,
  REACH_DISTANCE, HOTBAR_SIZE, ITEM_SIZE, TOWER_MIN_HEIGHT,
  BOW_COOLDOWN, ARROW_SPEED, ARROW_DAMAGE, ARROW_KNOCKBACK, ARROW_GRAVITY,
  CROSSBOW_ARROW_SPEED, CROSSBOW_ARROW_DAMAGE, CROSSBOW_ARROW_GRAVITY, ROPE_LENGTH,
  COW_HERD_AREA, COW_HERD_SIZE, COW_PANIC_TIME, COW_DROPS, ITEM_PICKUP_RADIUS, ITEM_PICKUP_DELAY,
  DRAGON_FIRE_DAMAGE, DRAGON_DROPS,
  ITEM_THROW_PICKUP_DELAY, ITEM_THROW_SPEED, ITEM_POP_SPEED,
  MAX_HP, REGEN_DELAY, REGEN_INTERVAL, EAT_TIME, FOOD_HEAL_TIME, HIT_TOLERANCE,
  KNOCKBACK_SPEED, KNOCKBACK_UP, RESPAWN_DELAY, KILL_CREDIT_TIME, FALL_SAFE_DISTANCE,
  FLAG_RETURN_TIME, FLAG_TOUCH_RADIUS, DRAGON_LEASH, CRAWLER_DROPS, EEL_BAND, EEL_DROPS,
  EEL_GLIDE_BREAK, CRAWLER_DAMAGE, EEL_DAMAGE,
  DAY_LENGTH, DAY_START, BIOME_SETTINGS,
} from '../shared/config.js';
import {
  BLOCK, isSolid, isWater, isFlowingWater, isTargetable, canBreak, breakTicks, getBlockDef, FACING_DIRS, facingOf, facedBlock,
  ladderBlock, isLadder, ladderFacing, doorBlock, isDoor, doorState,
} from '../shared/blocks.js';
import { getItemDef, ITEM } from '../shared/items.js';
import { accessoryDef } from '../shared/accessories.js';
import { eggForItem } from '../shared/mobEggs.js';
import { RIFT_ORB } from '../shared/accessories.js';
import { getRecipe, ANVIL_REROLL_COST } from '../shared/recipes.js';
import { canHaveMods } from '../shared/modifiers.js';
import { FROST } from '../shared/tools.js';
import { Chest, createContainer } from './containers.js';
import { clickSlot } from './inventory.js';
import { Arrow } from './arrow.js';
import { RiftOrbProjectile } from './riftOrb.js';
import { Cow, Herd, COW_BOX } from './cow.js';
import { Dragon, DRAGON_BOX } from './dragon.js';
import { Crawler, CRAWLER_BOX } from './crawler.js';
import { VoidEel, EEL_BOX } from './eel.js';
import { canStand } from './pathfind.js';
import { generateWorld, parseSeed, WORLD_SIZES, DEFAULT_WORLD_SIZE } from '../shared/worldgen.js';
import { keepAt, flagHome, mulberry32, KEEP_REACH } from '../shared/structures.js';
import {
  stepPlayer, stepItem, playerOverlapsBlock, createPlayerState, playerBoxOf, eyeHeight, isOnLadder, isInWater,
  playerFitsAt,
} from '../shared/physics.js';
import { lookDirection, raycastBlock, raycastPlayers } from '../shared/raycast.js';
import {
  C2S, S2C, PHASE, MAX_NAME_LENGTH, DEATH_CAUSE, FLAG_STATE, FLAG_EVENT, TEAMS,
} from '../shared/protocol.js';
import { Player, GRAB_TICKS } from './player.js';
import { Flag } from './flag.js';
import { ItemEntity } from './item.js';
import { WaterSimulation } from './water.js';
import { LeafDecay } from './leafDecay.js';
import { SaplingGrowth } from './saplings.js';
import { QuarryRegrowth } from './quarry.js';
import { GoblinController } from './goblins.js';
import { TOTEM_BOX, KING_BOX, WORKER_BOX } from './goblin.js';
import { assignMobSteering, steerGround, resolveMobOverlaps } from './mobSteering.js';

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Server checks reach against the block center using a slightly stale position,
// so allow the center-to-corner distance plus some movement lag.
const REACH_SLACK = 1.5;
const MAX_SEED_LENGTH = 64;

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const EAT_TICKS = ticks(EAT_TIME);
const RESPAWN_DELAY_TICKS = ticks(RESPAWN_DELAY);
const KILL_CREDIT_TICKS = ticks(KILL_CREDIT_TIME);
const BOW_COOLDOWN_TICKS = ticks(BOW_COOLDOWN);
const COW_PANIC_TICKS = ticks(COW_PANIC_TIME);
const FLAG_RETURN_TICKS = ticks(FLAG_RETURN_TIME);
// While mining, other players see a swing this often.
const BREAK_SWING_TICKS = 5;

// { x, y, z } with integer coordinates inside the world, or null.
function parseBlockPos(world, pos) {
  if (!pos || typeof pos !== 'object') return null;
  const { x, y, z } = pos;
  if (![x, y, z].every(Number.isInteger) || !world.inBounds(x, y, z)) return null;
  return { x, y, z };
}

// A BlockPos plus the face it was placed against: n is the targeted face's
// normal (one axis ±1), or all zero if missing or malformed.
function parsePlace(world, place) {
  const pos = parseBlockPos(world, place);
  if (!pos) return null;
  const n = [place.nx, place.ny, place.nz];
  const valid = n.every((v) => v === -1 || v === 0 || v === 1) && Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) === 1;
  const [nx, ny, nz] = valid ? n : [0, 0, 0];
  return { ...pos, nx, ny, nz };
}

// A full solid cube (not a closed door), which ladders and doors can rest on.
function isSupport(id) {
  return isSolid(id) && !isDoor(id);
}

// Collapses whitespace and trims to the length limit; null if nothing is left.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) || null;
}

// Names are unique ignoring case, and reclaiming matches the same way.
function sameName(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function sendTo(socket, msg) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
}

function isLocalAddress(address) {
  return address === '::1' || /^127\./.test(address ?? '') || /^::ffff:127\./.test(address ?? '');
}

export class Game {
  constructor() {
    this.phase = PHASE.LOBBY;
    // Ids for lobby members, players and entities. A member keeps its id as a player.
    this.nextId = 1;
    this.tick = 0;

    // Lobby phase: id -> { id, session, name, color, ready }, in join order.
    this.members = new Map();
    this.hostId = null;
    // World size key from WORLD_SIZES, picked by the host.
    this.worldSize = DEFAULT_WORLD_SIZE;

    // Match phase.
    this.seed = null;
    this.playerCount = 0;
    this.world = null;
    this.water = null;
    this.leafDecay = null;
    this.saplings = null;
    this.quarry = null;
    this.goblins = null;
    // Flags by owner id, and the last player standing once the match is decided.
    this.flags = new Map();
    this.winnerId = null;
    // Every block changed since generation, "x,y,z" -> id, sent to players on join.
    this.blockChanges = new Map();
    this.players = new Map();
    // Dropped items and flying or stuck arrows by entity id. They share the
    // id space with players.
    this.items = new Map();
    this.arrows = new Map();
    this.riftOrbs = new Map();
    this.cows = new Map();
    this.dragons = new Map();
    // Crawlers and Void Eels by entity id.
    this.mobs = new Map();
    this.portals = new Map();
    // Sessions on the "match in progress" screen.
    this.spectators = new Set();
  }

  start() {
    setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  // A socket stays anonymous until its HELLO; after that it is exactly one of
  // a lobby member, a spectator or a match player.
  connect(socket, remoteAddress) {
    const session = { socket, greeted: false, member: null, player: null, spectating: false,
      localHost: isLocalAddress(remoteAddress), creative: false };
    socket.on('message', (data) => this.handleMessage(session, data));
    socket.on('close', () => this.disconnect(session));
    return session;
  }

  disconnect(session) {
    const { member, player } = session;
    if (member) {
      this.members.delete(member.id);
      if (this.hostId === member.id) this.hostId = this.members.keys().next().value ?? null;
      console.log(`${member.name} left the lobby (${this.members.size} in lobby)`);
      this.broadcastLobby();
    }
    if (player && player.socket === session.socket) {
      // A flag can't sit on someone who isn't playing.
      if (player.carrying) this.dropFlag(player);
      this.stowCursor(player);
      player.attach(null);
      console.log(`${player.name} disconnected; can be reclaimed`);
      this.broadcastMatchInfo();
    }
    this.spectators.delete(session);
  }

  handleMessage(session, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case C2S.HELLO:
        this.hello(session, msg);
        break;
      case C2S.LOBBY_UPDATE:
        if (session.member) this.updateMember(session.member, msg);
        break;
      case C2S.START_MATCH:
        if (session.member) this.startMatch(session.member, msg);
        break;
      case C2S.RECLAIM:
        if (session.spectating && !this.reclaim(session, cleanName(msg.name))) {
          sendTo(session.socket, { type: S2C.ERROR, message: 'That player is not available to reclaim.' });
        }
        break;
      case C2S.INPUT:
        if (session.player) this.queueInput(session.player, msg);
        break;
      case C2S.RESPAWN:
        if (session.player) this.respawn(session.player);
        break;
      case C2S.INVENTORY_CLICK:
        if (session.player) this.inventoryClick(session.player, msg);
        break;
      case C2S.INVENTORY_CLOSE:
        if (session.player) {
          session.player.viewing = null;
          this.stowCursor(session.player);
        }
        break;
      case C2S.OPEN_CONTAINER:
        if (session.player) this.openContainer(session.player, msg);
        break;
      case C2S.CRAFT:
        if (session.player) this.craft(session.player, msg);
        break;
      case C2S.ANVIL_REROLL:
        if (session.player) this.anvilReroll(session.player, msg);
        break;
      case C2S.CREATIVE_TOGGLE:
        this.toggleCreative(session);
        break;
    }
  }

  hello(session, msg) {
    if (session.greeted) return;
    session.greeted = true;
    const name = cleanName(msg.name);
    if (this.phase === PHASE.LOBBY) this.joinLobby(session, name);
    else if (!this.reclaim(session, name)) this.spectate(session);
  }

  toggleCreative(session) {
    if (!session.localHost || (!session.member && !session.player)) return;
    session.creative = !session.creative;
    if (session.player) {
      const player = session.player;
      player.creative = session.creative;
      player.state.creative = player.creative;
      if (!player.creative) player.state.flying = false;
    }
    sendTo(session.socket, { type: S2C.CREATIVE, enabled: session.creative });
  }

  // ---- Lobby ----

  nameTaken(name, except = null) {
    for (const m of this.members.values()) {
      if (m !== except && sameName(m.name, name)) return true;
    }
    return false;
  }

  joinLobby(session, name) {
    if (this.members.size >= TEAMS.length * 4) {
      sendTo(session.socket, { type: S2C.ERROR, message: 'The lobby is full.' });
      return;
    }
    const id = this.nextId++;
    if (!name || this.nameTaken(name)) {
      let n = id;
      while (this.nameTaken(`Player ${n}`)) n++;
      name = `Player ${n}`;
    }
    const team = [...TEAMS.keys()].reduce((best, i) =>
      [...this.members.values()].filter((m) => m.team === i).length < [...this.members.values()].filter((m) => m.team === best).length ? i : best, 0);
    const member = { id, session, name, team, color: TEAMS[team].color, ready: false };
    this.members.set(id, member);
    session.member = member;
    if (this.hostId === null) this.hostId = id;
    console.log(`${name} joined the lobby (${this.members.size} in lobby)`);
    this.broadcastLobby();
  }

  updateMember(member, msg) {
    if ('name' in msg) {
      const name = cleanName(msg.name);
      if (!name) sendTo(member.session.socket, { type: S2C.ERROR, message: 'Name can\'t be empty.' });
      else if (this.nameTaken(name, member)) sendTo(member.session.socket, { type: S2C.ERROR, message: `"${name}" is taken.` });
      else member.name = name;
    }
    if (Number.isInteger(msg.team) && msg.team >= 0 && msg.team < TEAMS.length && msg.team !== member.team) {
      if ([...this.members.values()].filter((m) => m.team === msg.team).length < 4) {
        member.team = msg.team;
        member.color = TEAMS[msg.team].color;
        for (const m of this.members.values()) m.ready = false;
      } else sendTo(member.session.socket, { type: S2C.ERROR, message: 'That team is full.' });
    }
    if (typeof msg.ready === 'boolean') member.ready = msg.ready;
    if (member.id === this.hostId && Object.hasOwn(WORLD_SIZES, msg.worldSize)) this.worldSize = msg.worldSize;
    // Always sent, so a rejected name snaps back on the client.
    this.broadcastLobby();
  }

  broadcastLobby() {
    const players = [...this.members.values()].map(({ id, name, color, team, ready }) => ({ id, name, color, team, ready }));
    for (const m of this.members.values()) {
      sendTo(m.session.socket, { type: S2C.LOBBY, you: m.id, hostId: this.hostId, worldSize: this.worldSize, players });
    }
  }

  startMatch(member, msg) {
    if (this.phase !== PHASE.LOBBY || member.id !== this.hostId) return;
    if (![...this.members.values()].every((m) => m.ready)) {
      sendTo(member.session.socket, { type: S2C.ERROR, message: 'Not everyone is ready.' });
      return;
    }
    this.seed = parseSeed(typeof msg.seed === 'string' ? msg.seed.slice(0, MAX_SEED_LENGTH) : '');
    this.playerCount = this.members.size;
    const occupiedTeams = [...new Set([...this.members.values()].map((m) => m.team))].sort();
    this.teamCount = occupiedTeams.length;
    const started = performance.now();
    this.world = generateWorld(this.seed, occupiedTeams.length, this.worldSize);
    this.quarry = new QuarryRegrowth(this);
    this.water = new WaterSimulation(this.world);
    this.leafDecay = new LeafDecay(this.world, (x, y, z) => {
      if (Math.random() < 0.04) this.dropAt(ITEM.TREE_SEED, x, y, z);
    });
    this.saplings = new SaplingGrowth(this.world, (x, y, z, top) =>
      [...this.players.values()].some((p) => !p.dead && p.state.x + playerBoxOf(p.state).halfW > x
        && p.state.x - playerBoxOf(p.state).halfW < x + 1
        && p.state.z + playerBoxOf(p.state).halfW > z
        && p.state.z - playerBoxOf(p.state).halfW < z + 1
        && p.state.y < top + 1 && p.state.y + playerBoxOf(p.state).height > y));
    this.world.onBlockChanged = (x, y, z, id, oldId) => {
      this.blockChanges.set(`${x},${y},${z}`, { x, y, z, id });
      this.broadcast({ type: S2C.BLOCK_CHANGE, x, y, z, id });
      this.water.enqueueAround(x, y, z);
      if (oldId === BLOCK.WOOD && id !== BLOCK.WOOD) this.leafDecay.enqueueAroundLog(x, y, z);
      if (oldId === BLOCK.SAPLING && id !== BLOCK.SAPLING) this.saplings.removed(x, y, z);
      if (id === BLOCK.SAPLING && oldId !== BLOCK.SAPLING) this.saplings.planted(x, y, z, this.tick);
      if (id === BLOCK.QUARRY_STONE || oldId === BLOCK.QUARRY_STONE) this.quarry.changed(x, y, z, id);
    };
    for (const [key, table] of this.world.lootChests) {
      this.world.tileEntities.set(key, new Chest(table));
    }

    const teamFlags = new Map();
    [...this.members.values()].forEach((m) => {
      const keep = this.world.keeps[occupiedTeams.indexOf(m.team)];
      const player = new Player(m.id, m.session.socket, m.name, m.color, this.keepSpawn(keep), m.team);
      player.creative = m.session.creative && m.session.localHost;
      player.state.creative = player.creative;
      player.keep = keep;
      if (!teamFlags.has(m.team)) {
        const flag = new Flag(player.id, player.color, flagHome(keep), m.team);
        teamFlags.set(m.team, flag);
        this.flags.set(flag.id, flag);
      }
      player.flag = teamFlags.get(m.team);
      this.players.set(player.id, player);
      m.session.member = null;
      m.session.player = player;
    });
    this.members.clear();
    this.hostId = null;
    this.phase = PHASE.PLAYING;
    console.log(`Match started: seed ${this.seed}, ${this.playerCount} player(s), `
      + `${WORLD_SIZES[this.worldSize].label} world ${this.world.sizeX}x${this.world.sizeZ}x${this.world.sizeY} `
      + `(generated in ${Math.round(performance.now() - started)} ms)`);
    this.spawnHerds();
    this.spawnDragons();
    this.spawnCrawlers();
    this.spawnEels();
    this.goblins = new GoblinController(this);
    this.goblins.spawnAll();
    for (const player of this.players.values()) this.sendWelcome(player);
  }

  // ---- Joining a match in progress ----

  spectate(session) {
    session.spectating = true;
    this.spectators.add(session);
    sendTo(session.socket, this.matchInfo());
  }

  // Takes over the disconnected match player called `name`. Returns false if
  // there is no such player or they are still connected.
  reclaim(session, name) {
    if (!name) return false;
    const player = [...this.players.values()].find((p) => sameName(p.name, name));
    if (!player || player.connected) return false;
    this.spectators.delete(session);
    session.spectating = false;
    session.player = player;
    player.attach(session.socket);
    player.creative = session.localHost && player.creative;
    player.state.creative = player.creative;
    if (!player.creative) player.state.flying = false;
    session.creative = player.creative;
    console.log(`${player.name} reconnected`);
    this.sendWelcome(player);
    this.broadcastMatchInfo();
    return true;
  }

  matchInfo() {
    return {
      type: S2C.MATCH_IN_PROGRESS,
      players: [...this.players.values()].map((p) => ({ name: p.name, color: p.color, connected: p.connected })),
    };
  }

  broadcastMatchInfo() {
    const msg = this.matchInfo();
    for (const session of this.spectators) sendTo(session.socket, msg);
  }

  // ---- Match ----

  // Inside the keep, two blocks from the pedestal.
  keepSpawn(keep) {
    return { x: keep.cx + 2.5, y: keep.floorY + 1, z: keep.cz + 0.5 };
  }

  sendWelcome(player) {
    this.send(player, {
      type: S2C.WELCOME,
      id: player.id,
      color: player.color,
      seed: this.seed,
      playerCount: this.playerCount,
      teamCount: this.teamCount,
      worldSize: this.worldSize,
      tick: this.tick,
      dayTime: this.dayTime(),
      creative: player.creative,
      blocks: [...this.blockChanges.values()],
      litFurnaces: [...this.world.tileEntities].filter(([, c]) => c.kind === 'furnace' && c.burn > 0)
        .map(([key]) => {
          const [x, y, z] = key.split(',').map(Number);
          return { x, y, z };
        }),
      players: [...this.players.values()].map((p) => ({ ...p.describe(), ...p.snapshot() })),
      entities: [...this.items.values(), ...this.arrows.values(), ...this.riftOrbs.values(), ...this.cows.values(), ...this.dragons.values(),
        ...this.mobs.values()].map((e) => e.describe()),
      inventory: player.inventory,
      flags: [...this.flags.values()].map((f) => ({ ...f.describe(), ...f.snapshot() })),
      portals: [...this.portals.values()].map(({ id, x, y, z, expiresTick }) => ({ id, x, y, z, expiresTick })),
      winnerId: this.winnerId,
      winnerTeam: this.winnerId === null ? null : this.flags.get(this.winnerId)?.team,
      winnerMembers: this.winnerId === null ? [] : [...this.players.values()].filter((p) => p.team === this.flags.get(this.winnerId)?.team).map((p) => p.name),
    });
  }

  queueInput(player, msg) {
    if (!Number.isInteger(msg.seq) || msg.seq <= player.lastSeq) return;
    if (player.inputQueue.length >= MAX_QUEUED_INPUTS) return;
    player.inputQueue.push({
      seq: msg.seq,
      forward: Number(msg.forward) || 0,
      sprint: !!msg.sprint,
      strafe: Number(msg.strafe) || 0,
      jump: !!msg.jump,
      yaw: Number(msg.yaw) || 0,
      pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number(msg.pitch) || 0)),
      slot: Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < HOTBAR_SIZE ? msg.slot : 0,
      breaking: parseBlockPos(this.world, msg.breaking),
      place: parsePlace(this.world, msg.place),
      spawnEgg: parseBlockPos(this.world, msg.spawnEgg),
      use: parseBlockPos(this.world, msg.use),
      drop: !!msg.drop,
      attack: !!msg.attack,
      crouch: !!msg.crouch,
      draw: !!msg.draw,
      eat: !!msg.eat,
      glide: !!msg.glide,
      rift: !!msg.rift,
      fire: !!msg.fire,
      hook: !!msg.hook,
      flyToggle: !!msg.flyToggle,
    });
  }

  portalDestination(keep, player) {
    const origin = keep.cx + 0.5;
    const centerZ = keep.cz + 0.5;
    for (let radius = KEEP_REACH + 2; radius <= KEEP_REACH + 10; radius++) {
      for (let step = 0; step < 24; step++) {
        const angle = step * Math.PI / 12;
        const x = Math.floor(origin + Math.cos(angle) * radius);
        const z = Math.floor(centerZ + Math.sin(angle) * radius);
        if (!this.world.inBounds(x, keep.floorY, z)) continue;
        const ground = this.world.getSurfaceY(x, z, isSolid);
        if (Math.abs(ground - keep.floorY) > 5) continue;
        if (keepAt(this.world, x, ground + 1, z)) continue;
        const state = { ...player.state, x: x + 0.5, y: ground + 1, z: z + 0.5, crouching: false };
        if (playerFitsAt(this.world, state, state.y)) return state;
      }
    }
    return null;
  }

  stepRift(player) {
    if (player.held() !== ITEM.RIFT_ORB) return;
    const state = player.state;
    const direction = lookDirection(state.yaw, state.pitch);
    const start = { x: state.x + direction.x * RIFT_ORB.launchForward,
      y: state.y + eyeHeight(state) - 0.2,
      z: state.z + direction.z * RIFT_ORB.launchForward };
    // The muzzle can be just inside a nearby wall even while the player's
    // eyes are clear. Launch from the eyes in that case.
    if (isSolid(this.world.getBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)))) {
      start.x = state.x;
      start.y = state.y + eyeHeight(state);
      start.z = state.z;
    }
    player.inventory.takeOne(player.selected);
    player.inventoryDirty = true;
    const orb = new RiftOrbProjectile(this.nextId++, player, start.x, start.y, start.z, direction);
    this.riftOrbs.set(orb.id, orb);
    this.broadcast({ type: S2C.ENTITY_SPAWN, entity: orb.describe() });
  }

  updateRiftOrbs() {
    const moving = [];
    for (const orb of this.riftOrbs.values()) {
      const result = orb.step(this.world);
      if (!result) { moving.push(orb); continue; }
      this.riftOrbs.delete(orb.id);
      this.broadcast({ type: S2C.ENTITY_DESPAWN, id: orb.id });
      if (result.lost) continue;
      const { x, y, z } = result.hit;
      if (this.world.keeps.some((keep) => Math.abs(x - keep.cx) <= KEEP_REACH
        && Math.abs(z - keep.cz) <= KEEP_REACH)) {
        this.spawnItem(ITEM.RIFT_ORB, 1, orb.x, orb.y, orb.z,
          0, ITEM_POP_SPEED, 0, ITEM_PICKUP_DELAY);
        continue;
      }
      const ground = this.world.getSurfaceY(x, z, isSolid);
      const portalY = isSolid(this.world.getBlock(x, y, z))
        && !isSolid(this.world.getBlock(x, y + 1, z)) ? y + 1.9
          : ground >= this.world.voidY ? ground + 1.9 : orb.y;
      const portal = { id: this.nextId++, x: x + 0.5, y: portalY, z: z + 0.5,
        keep: orb.owner.keep, expiresTick: this.tick + ticks(RIFT_ORB.durationSeconds), inside: new Set() };
      if (Math.hypot(portal.x - orb.owner.state.x, portal.z - orb.owner.state.z) < 1.5
        && Math.abs(portal.y - orb.owner.state.y) < 2) {
        this.spawnItem(ITEM.RIFT_ORB, 1, orb.x, orb.y, orb.z,
          0, ITEM_POP_SPEED, 0, ITEM_PICKUP_DELAY);
        continue;
      }
    this.portals.set(portal.id, portal);
    this.broadcast({ type: S2C.PORTAL_SPAWN, portal: { id: portal.id, x: portal.x, y: portal.y,
      z: portal.z, expiresTick: portal.expiresTick } });
    }
    return moving;
  }

  updatePortals() {
    for (const portal of this.portals.values()) {
      if (this.tick >= portal.expiresTick) {
        this.portals.delete(portal.id);
        this.broadcast({ type: S2C.PORTAL_DESPAWN, id: portal.id });
        continue;
      }
      for (const player of this.players.values()) {
        if (player.dead) continue;
        const state = player.state;
        const inside = Math.hypot(state.x - portal.x, state.z - portal.z) < 0.85
          && Math.abs(state.y + 0.9 - portal.y) < 1.3;
        if (!inside) { portal.inside.delete(player.id); continue; }
        if (portal.inside.has(player.id) || player.carrying || this.tick < (player.portalCooldownTick ?? 0)) continue;
        const destination = this.portalDestination(portal.keep, player);
        if (!destination) continue;
        Object.assign(state, destination, { vx: 0, vy: 0, vz: 0, kx: 0, kz: 0,
          onGround: false, springCharge: 0, springBouncing: false, grapple: null });
        player.fallTop = null;
        player.portalCooldownTick = this.tick + ticks(1);
        portal.inside.add(player.id);
      }
    }
  }

  // One tick of holding the break button. Progress only accumulates while the
  // same breakable block stays targeted and in reach; anything else resets it.
  stepBreaking(player, pos) {
    const id = pos && this.world.getBlock(pos.x, pos.y, pos.z);
    const tool = player.breakingStats();
    if (!pos || !canBreak(id, tool.strength) || !this.inReach(player, pos)) {
      player.breaking = null;
      return;
    }
    const b = player.breaking;
    if (b && b.x === pos.x && b.y === pos.y && b.z === pos.z) b.ticks++;
    else player.breaking = { ...pos, ticks: 1 };
    if (player.breaking.ticks % BREAK_SWING_TICKS === 1) this.swing(player);
    if (player.breaking.ticks >= breakTicks(id, tool.speed)) {
      player.breaking = null;
      this.breakBlock(pos.x, pos.y, pos.z);
    }
  }

  // Removes a block and pops out its drop. A door goes as a pair (one drop);
  // ladders hanging on the block and a door standing on it fall off too.
  breakBlock(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (isDoor(id)) {
      const lower = doorState(id).upper ? y - 1 : y;
      this.world.setBlock(x, lower, z, BLOCK.AIR);
      this.world.setBlock(x, lower + 1, z, BLOCK.AIR);
      this.dropAt(ITEM.DOOR, x, lower, z);
    } else {
      this.world.setBlock(x, y, z, BLOCK.AIR);
      const drop = getBlockDef(id).drops;
      if (drop !== null) this.dropAt(drop, x, y, z);
      const key = `${x},${y},${z}`;
      const container = this.world.tileEntities.get(key);
      if (container) {
        container.populate?.(this.seed, x, y, z);
        if (container.kind === 'furnace' && container.burn > 0) {
          this.broadcast({ type: S2C.FURNACE_LIT, x, y, z, lit: false });
        }
        this.world.tileEntities.delete(key);
        for (const stack of container.takeAll()) this.dropAt(stack.item, x, y, z, stack.count, stack.mods);
      }
    }
    FACING_DIRS.forEach(([dx, dz], facing) => {
      // A ladder on the west side of this block faces east, toward it.
      const n = this.world.getBlock(x - dx, y, z - dz);
      if (isLadder(n) && ladderFacing(n) === facing) this.breakBlock(x - dx, y, z - dz);
    });
    const above = this.world.getBlock(x, y + 1, z);
    if (above === BLOCK.SAPLING) this.breakBlock(x, y + 1, z);
    if (isDoor(above) && !doorState(above).upper) this.breakBlock(x, y + 1, z);
  }

  dropAt(item, x, y, z, count = 1, mods = null) {
    const r = () => (Math.random() - 0.5) * 2;
    this.spawnItem(item, count, x + 0.5, y + 0.5 - ITEM_SIZE / 2, z + 0.5, r(), ITEM_POP_SPEED, r(), ITEM_PICKUP_DELAY, mods);
  }

  // True if any live player would overlap the block.
  playerIn(x, y, z) {
    for (const p of this.players.values()) {
      if (!p.dead && playerOverlapsBlock(p.state.x, p.state.y, p.state.z, x, y, z, playerBoxOf(p.state))) return true;
    }
    return false;
  }

  // Right click on a door: open or close both halves. A door can't close on a player.
  stepUse(player, pos) {
    const id = this.world.getBlock(pos.x, pos.y, pos.z);
    if (id === BLOCK.WATER && player.held() === ITEM.EMPTY_BUCKET && this.inReach(player, pos)) {
      this.world.setBlock(pos.x, pos.y, pos.z, BLOCK.AIR);
      player.inventory.takeOne(player.selected);
      player.inventory.add(ITEM.WATER_BUCKET, 1);
      player.inventoryDirty = true;
      this.swing(player);
      return;
    }
    if (!isDoor(id) || !this.inReach(player, pos)) return;
    const { facing, open, upper } = doorState(id);
    const lower = upper ? pos.y - 1 : pos.y;
    if (open && (this.playerIn(pos.x, lower, pos.z) || this.playerIn(pos.x, lower + 1, pos.z))) return;
    this.world.setBlock(pos.x, lower, pos.z, doorBlock(facing, !open, false));
    this.world.setBlock(pos.x, lower + 1, pos.z, doorBlock(facing, !open, true));
    this.swing(player);
  }

  // Places the block in `slot` at `pos`: an in-reach air cell next to a block,
  // not overlapping any player.
  stepPlace(player, pos, slot) {
    const stack = player.inventory.get(slot);
    if (!pos || !stack || !this.inReach(player, pos)) return;
    const def = getItemDef(stack.item);
    if (def.block === null && def.places === null) return;
    if (!this.buildable(pos.x, pos.y, pos.z)) return;

    // What goes where: [x, y, z, block id] for each cell.
    let cells;
    let lift = false;
    if (def.places === 'sapling') {
      if (pos.ny !== 1 || this.world.getBlock(pos.x, pos.y, pos.z) !== BLOCK.AIR) return;
      const soil = this.world.getBlock(pos.x, pos.y - 1, pos.z);
      if (soil !== BLOCK.GRASS && soil !== BLOCK.DIRT) return;
      cells = [[pos.x, pos.y, pos.z, BLOCK.SAPLING]];
    } else if (def.places === 'ladder') {
      // Flat against the side of a full block: the targeted face must be a side.
      if (pos.ny !== 0 || (pos.nx === 0 && pos.nz === 0)) return;
      if (!isSupport(this.world.getBlock(pos.x - pos.nx, pos.y, pos.z - pos.nz))) return;
      cells = [[pos.x, pos.y, pos.z, ladderBlock(facingOf(-pos.nx, -pos.nz))]];
    } else if (def.places === 'rope') {
      // A column straight down from this cell, up to ROPE_LENGTH long, ending
      // above the first cell that can't be built in (a solid block, a keep's
      // no-build zone, the bottom of the world).
      cells = [];
      for (let y = pos.y; y > pos.y - ROPE_LENGTH && this.buildable(pos.x, y, pos.z); y--) {
        cells.push([pos.x, y, pos.z, BLOCK.ROPE]);
      }
    } else if (def.places === 'door') {
      // Two tall on a full block, facing the way the player looks.
      if (!this.buildable(pos.x, pos.y + 1, pos.z)) return;
      if (!isSupport(this.world.getBlock(pos.x, pos.y - 1, pos.z))) return;
      if (this.playerIn(pos.x, pos.y, pos.z) || this.playerIn(pos.x, pos.y + 1, pos.z)) return;
      const look = lookDirection(player.state.yaw, 0);
      const facing = Math.abs(look.x) > Math.abs(look.z) ? facingOf(Math.sign(look.x), 0) : facingOf(0, Math.sign(look.z));
      cells = [[pos.x, pos.y, pos.z, doorBlock(facing, false, false)], [pos.x, pos.y + 1, pos.z, doorBlock(facing, false, true)]];
    } else {
      const attached = NEIGHBOURS.some(([dx, dy, dz]) => {
        const id = this.world.getBlock(pos.x + dx, pos.y + dy, pos.z + dz);
        return isTargetable(id) && !isWater(id);
      });
      if (!attached) return;
      // Nobody may be in the way, except that a player jumping up can place
      // the block under their own feet (towering) and is lifted on top of it.
      for (const p of this.players.values()) {
        if (p.dead || !playerOverlapsBlock(p.state.x, p.state.y, p.state.z, pos.x, pos.y, pos.z, playerBoxOf(p.state))) continue;
        if (p !== player || !this.canTower(p, pos)) return;
        lift = true;
      }
      // Furnaces and chests face the player who places them.
      const look = lookDirection(player.state.yaw, 0);
      const toward = Math.abs(look.x) > Math.abs(look.z) ? facingOf(-Math.sign(look.x), 0) : facingOf(0, -Math.sign(look.z));
      cells = [[pos.x, pos.y, pos.z, facedBlock(def.block, toward)]];
    }
    player.inventory.takeOne(slot);
    if (stack.item === ITEM.WATER_BUCKET) player.inventory.add(ITEM.EMPTY_BUCKET, 1);
    if (lift) {
      player.state.y = pos.y + 1;
      player.state.vy = Math.max(player.state.vy, 0);
    }
    for (const [x, y, z, id] of cells) {
      this.world.setBlock(x, y, z, id);
      const container = createContainer(getBlockDef(id).tileEntity);
      if (container) this.world.tileEntities.set(`${x},${y},${z}`, container);
    }
    player.inventoryDirty = true;
    this.swing(player);
  }

  stepSpawnEgg(player, pos, slot) {
    const egg = eggForItem(player.inventory.get(slot)?.item);
    if (!egg || !pos || !this.inReach(player, pos) || !isSolid(this.world.getBlock(pos.x, pos.y, pos.z))) return;
    const x = pos.x + 0.5, y = pos.y + 1, z = pos.z + 0.5;
    const boxes = { cow: COW_BOX, dragon: DRAGON_BOX, crawler: CRAWLER_BOX, voidEel: EEL_BOX,
      goblinWorker: WORKER_BOX, goblinKing: KING_BOX };
    const box = boxes[egg.type];
    if (!box || !playerFitsAt(this.world, { x, y, z, box }, y)) return;
    const island = this.world.islands?.length ? this.world.islands.reduce((best, candidate) =>
      Math.hypot(x - candidate.x, z - candidate.z) < Math.hypot(x - best.x, z - best.z) ? candidate : best)
      : { x, z, radius: 16, surfaceY: y, kind: 'team' };
    let mob;
    switch (egg.type) {
      case 'cow': {
        mob = new Cow(this.nextId++, new Herd(this.nextId++), x, y, z);
        this.cows.set(mob.id, mob);
        break;
      }
      case 'dragon':
        mob = new Dragon(this.nextId++, x, y, z, { x, z, radius: island.radius },
          DRAGON_LEASH[island.kind] ?? DRAGON_LEASH.roost);
        this.dragons.set(mob.id, mob);
        break;
      case 'crawler':
        mob = new Crawler(this.nextId++, x, y, z);
        this.mobs.set(mob.id, mob);
        break;
      case 'voidEel': {
        const band = this.eelBand();
        mob = new VoidEel(this.nextId++, band, { x, y, z });
        this.mobs.set(mob.id, mob);
        break;
      }
      case 'goblinWorker':
      case 'goblinKing':
        mob = this.goblins.hatch(egg.type, x, y, z);
        this.mobs.set(mob.id, mob);
        break;
      default: return;
    }
    player.inventory.takeOne(slot);
    player.inventoryDirty = true;
    this.broadcast({ type: S2C.ENTITY_SPAWN, entity: mob.describe() });
    this.swing(player);
  }

  // Air or water (placing into water replaces it), and outside every keep's no-build zone.
  buildable(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    return (id === BLOCK.AIR || isWater(id)) && this.world.inBounds(x, y, z) && !keepAt(this.world, x, y, z);
  }

  // In the air, feet at least TOWER_MIN_HEIGHT up the cell (and still in it),
  // with room to stand on top of it.
  canTower(player, pos) {
    const s = player.state;
    return !s.onGround && s.y >= pos.y + TOWER_MIN_HEIGHT && s.y < pos.y + 1 && playerFitsAt(this.world, s, pos.y + 1);
  }

  // Tells everyone else to play this player's arm swing.
  swing(player) {
    this.broadcast({ type: S2C.SWING, id: player.id }, player);
  }

  // ---- Inventory screen ----

  // A slot click in the inventory screen, or (container: true) in the open
  // container's slots. With shift, the stack moves across instead: between
  // the container and the inventory, or with none open, between the hotbar
  // and the main grid.
  inventoryClick(player, msg) {
    if (player.dead) return;
    const { slot, button } = msg;
    if ((button !== 'left' && button !== 'right') || !Number.isInteger(slot)) return;
    const container = this.viewedContainer(player);
    const inv = player.inventory;
    if (msg.armor || msg.accessory) {
      const field = msg.accessory ? 'accessory' : 'armor';
      const equipmentSlots = [inv[field]];
      if (msg.shift) {
        if (!inv[field] || inv.addStack(inv[field]) !== 0) return;
        inv[field] = null;
      } else if (!clickSlot(equipmentSlots, 0, inv, button, {
        accepts: (item) => field === 'accessory' ? !!getItemDef(item).accessory : !!getItemDef(item).armorPoints,
      })) return;
      else inv[field] = equipmentSlots[0];
      player.inventoryDirty = true;
      return;
    }
    if (msg.container) {
      if (!container || slot < 0 || slot >= container.slots.length) return;
      let moved;
      if (msg.shift) {
        const stack = container.slots[slot];
        if (!stack) return;
        const left = inv.addStack(stack);
        moved = left < stack.count;
        stack.count = left;
        if (left === 0) container.slots[slot] = null;
      } else {
        moved = container.click(slot, button, inv);
      }
      if (moved) {
        container.dirty = true;
        player.inventoryDirty = true;
      }
      return;
    }
    if (slot < 0 || slot >= inv.slots.length) return;
    if (!msg.shift) {
      if (inv.click(slot, button)) player.inventoryDirty = true;
    } else if (container) {
      const stack = inv.slots[slot];
      if (stack && container.insert(stack)) {
        if (stack.count === 0) inv.slots[slot] = null;
        container.dirty = true;
        player.inventoryDirty = true;
      }
    } else if (getItemDef(inv.slots[slot]?.item).armorPoints && !inv.armor) {
      inv.armor = inv.slots[slot];
      inv.slots[slot] = null;
      player.inventoryDirty = true;
    } else if (getItemDef(inv.slots[slot]?.item).accessory && !inv.accessory) {
      inv.accessory = inv.slots[slot];
      inv.slots[slot] = null;
      player.inventoryDirty = true;
    } else if (inv.shiftMove(slot)) {
      player.inventoryDirty = true;
    }
  }

  // Right click on a chest or furnace: start sending its state to this player.
  openContainer(player, msg) {
    const pos = parseBlockPos(this.world, msg);
    if (player.dead || !pos || !this.inReach(player, pos)) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    const container = this.world.tileEntities.get(key);
    if (!container) return;
    container.populate?.(this.seed, pos.x, pos.y, pos.z);
    player.viewing = key;
    this.send(player, { type: S2C.CONTAINER, ...pos, ...container.view() });
  }

  // The container the player has open, if it still exists and is in reach.
  viewedContainer(player) {
    if (!player.viewing) return null;
    const container = this.world.tileEntities.get(player.viewing);
    const [x, y, z] = player.viewing.split(',').map(Number);
    return container && this.inReach(player, { x, y, z }) ? container : null;
  }

  // Furnaces smelt whether or not anyone is watching. Everyone with a container
  // open gets its new state when it changes (from ticking or anyone's click),
  // and is told to close if it's gone or out of reach.
  updateContainers() {
    for (const [key, container] of this.world.tileEntities) {
      const wasLit = container.kind === 'furnace' && container.burn > 0;
      if (container.tick()) container.dirty = true;
      if (container.kind === 'furnace' && (container.burn > 0) !== wasLit) {
        const [x, y, z] = key.split(',').map(Number);
        this.broadcast({ type: S2C.FURNACE_LIT, x, y, z, lit: container.burn > 0 });
      }
    }
    for (const player of this.players.values()) {
      if (!player.viewing) continue;
      const container = this.viewedContainer(player);
      if (!container) {
        player.viewing = null;
        this.send(player, { type: S2C.CONTAINER_CLOSE });
      } else if (container.dirty) {
        const [x, y, z] = player.viewing.split(',').map(Number);
        this.send(player, { type: S2C.CONTAINER, x, y, z, ...container.view() });
      }
    }
    for (const container of this.world.tileEntities.values()) container.dirty = false;
  }

  // Closing the screen (or leaving) puts the cursor stack back; what doesn't fit is dropped.
  stowCursor(player) {
    if (!player.inventory.cursor) return;
    const left = player.inventory.stowCursor();
    player.inventoryDirty = true;
    if (left) {
      const s = player.state;
      this.spawnItem(left.item, left.count, s.x, s.y + 1, s.z, 0, ITEM_POP_SPEED, 0, ITEM_THROW_PICKUP_DELAY, left.mods);
    }
  }

  // Workbench recipes need `at`: a workbench within reach.
  craft(player, msg) {
    const recipe = getRecipe(msg.recipe);
    if (player.dead || !recipe) return;
    if (recipe.creative && !player.creative) return;
    if (recipe.station === 'workbench') {
      const at = parseBlockPos(this.world, msg.at);
      if (!at || this.world.getBlock(at.x, at.y, at.z) !== BLOCK.WORKBENCH || !this.inReach(player, at)) return;
    }
    if (player.inventory.craft(recipe)) player.inventoryDirty = true;
  }

  // The Reroll button at an anvil the player has open: pays ANVIL_REROLL_COST
  // from the inventory and gives the item in the anvil a fresh roll of
  // modifiers (1 or 2), replacing any it had.
  anvilReroll(player, msg) {
    const pos = parseBlockPos(this.world, msg);
    if (player.dead || !pos || player.viewing !== `${pos.x},${pos.y},${pos.z}`) return;
    const anvil = this.viewedContainer(player);
    if (anvil?.kind !== 'anvil' || !anvil.slots[0] || !canHaveMods(anvil.slots[0].item)) return;
    if (!player.inventory.has(ANVIL_REROLL_COST)) return;
    for (const { item, count } of ANVIL_REROLL_COST) player.inventory.remove(item, count);
    anvil.reroll();
    anvil.dirty = true;
    player.inventoryDirty = true;
  }

  // Throws one item from `slot` the way the player is looking (a modded item
  // keeps its modifiers).
  stepDrop(player, slot) {
    const mods = player.inventory.get(slot)?.mods ?? null;
    const item = player.inventory.takeOne(slot);
    if (item === null) return;
    player.inventoryDirty = true;
    const s = player.state;
    const dir = lookDirection(s.yaw, s.pitch);
    const v = ITEM_THROW_SPEED;
    this.spawnItem(item, 1, s.x, s.y + eyeHeight(s) - 0.3, s.z,
      dir.x * v, dir.y * v + 1.5, dir.z * v, ITEM_THROW_PICKUP_DELAY, mods);
  }

  spawnItem(item, count, x, y, z, vx, vy, vz, pickupDelay, mods = null) {
    const entity = new ItemEntity(this.nextId++, item, count, x, y, z, vx, vy, vz, pickupDelay, mods);
    this.items.set(entity.id, entity);
    this.broadcast({ type: S2C.ENTITY_SPAWN, entity: entity.describe() });
  }

  removeItem(entity) {
    this.items.delete(entity.id);
    this.broadcast({ type: S2C.ENTITY_DESPAWN, id: entity.id });
  }

  // Simulates items and hands them to nearby players. Returns the items that
  // moved this tick, which are the only ones included in STATE.
  updateItems() {
    const moved = [];
    for (const entity of this.items.values()) {
      if (--entity.despawnTicks <= 0) {
        this.removeItem(entity);
        continue;
      }
      const s = entity.state;
      const { x, y, z } = s;
      stepItem(s, this.world);
      if (s.y < this.world.voidY) {
        this.removeItem(entity);
        continue;
      }
      if (s.x !== x || s.y !== y || s.z !== z || entity.forceSnapshot) moved.push(entity);
      entity.forceSnapshot = false;

      if (entity.pickupTicks > 0) {
        entity.pickupTicks--;
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.connected || player.dead || !this.canPickUp(player, entity)) continue;
        const left = player.inventory.add(entity.item, entity.count, entity.mods);
        if (left === entity.count) continue;
        player.inventoryDirty = true;
        entity.count = left;
        if (left === 0) {
          this.removeItem(entity);
          break;
        }
      }
    }
    return moved;
  }

  // Within pickup radius of the player's body, measured from the item's center
  // to the nearest point on the line from the player's feet to head.
  canPickUp(player, entity) {
    const p = player.state, s = entity.state;
    const cy = s.y + ITEM_SIZE / 2;
    const nearestY = Math.max(p.y, Math.min(p.y + PLAYER_HEIGHT, cy));
    return Math.hypot(s.x - p.x, cy - nearestY, s.z - p.z) <= ITEM_PICKUP_RADIUS;
  }

  // ---- Bows ----

  // One tick of the bow: holding draw builds charge (not during the cooldown);
  // letting go after at least BOW_MIN_DRAW shoots, sooner cancels.
  // Draw times, and the shot's damage and speed, come from the bow's
  // modifiers (Player.rangedStats).
  stepBow(player, draw) {
    if (player.held() !== ITEM.BOW) {
      player.drawTicks = 0;
      return;
    }
    if (draw) {
      if (this.tick >= player.nextShotTick) player.drawTicks++;
      return;
    }
    const { minDrawTicks, fullDrawTicks } = player.rangedStats();
    if (player.drawTicks >= minDrawTicks) this.shoot(player, Math.min(1, player.drawTicks / fullDrawTicks));
    player.drawTicks = 0;
  }

  // An arrow from the eyes along the look direction. Speed and damage scale
  // linearly from the weakest shot (drawn BOW_MIN_DRAW) to a full draw.
  shoot(player, draw) {
    const ranged = player.rangedStats();
    const minDraw = ranged.minDrawTicks / ranged.fullDrawTicks;
    const t = Math.max(0, Math.min(1, (draw - minDraw) / (1 - minDraw)));
    const speed = (ARROW_SPEED[0] + (ARROW_SPEED[1] - ARROW_SPEED[0]) * t) * ranged.speedScale;
    const damage = Math.round(ARROW_DAMAGE[0] + (ARROW_DAMAGE[1] - ARROW_DAMAGE[0]) * t) + ranged.damageBonus;
    this.launchArrow(player, speed, damage, ARROW_GRAVITY, t);
    player.nextShotTick = this.tick + BOW_COOLDOWN_TICKS;
  }

  launchArrow(player, speed, damage, gravity, charge) {
    const s = player.state;
    const dir = lookDirection(s.yaw, s.pitch);
    const arrow = new Arrow(this.nextId++, player, s.x, s.y + eyeHeight(s), s.z, dir.x * speed, dir.y * speed, dir.z * speed, charge);
    arrow.damage = damage;
    arrow.gravity = gravity;
    this.arrows.set(arrow.id, arrow);
    this.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
  }

  // One tick of the crossbow: holding right click (load) for
  // CROSSBOW_LOAD_TICKS loads it, and it stays loaded until a click (fire)
  // shoots a bolt. Letting go early loses the progress, as does putting it
  // away. A right click that fires must be let go before loading again.
  stepCrossbow(player, load, fire) {
    if (player.held() !== ITEM.CROSSBOW) {
      player.loadTicks = 0;
      player.loaded = false;
      player.loadNeedsRelease = false;
      return;
    }
    const ranged = player.rangedStats();
    if (fire && player.loaded) {
      this.launchArrow(player, CROSSBOW_ARROW_SPEED * ranged.speedScale, CROSSBOW_ARROW_DAMAGE + ranged.damageBonus,
        CROSSBOW_ARROW_GRAVITY, 1);
      player.loaded = false;
      player.loadTicks = 0;
      player.loadNeedsRelease = load;
      return;
    }
    if (!load) {
      player.loadNeedsRelease = false;
      if (!player.loaded) player.loadTicks = 0;
      return;
    }
    if (player.loaded || player.loadNeedsRelease) return;
    if (++player.loadTicks >= ranged.loadTicks) player.loaded = true;
  }

  // Moves every arrow. Returns the ones that moved (for STATE): flying, or
  // just stuck.
  updateArrows() {
    const moved = [];
    for (const arrow of this.arrows.values()) {
      const flying = !arrow.stuckIn;
      const result = arrow.step(this.world, [...[...this.players.values()].filter((p) => p.team !== arrow.shooter.team),
        ...this.cows.values(), ...this.dragons.values(), ...this.mobs.values()]);
      if (result === 'gone' || arrow.y < this.world.voidY) {
        this.removeArrow(arrow);
      } else if (result?.hit) {
        const target = result.hit, t = target.state;
        // A small push along the arrow's flight.
        t.kx += result.dir.x * ARROW_KNOCKBACK;
        t.kz += result.dir.z * ARROW_KNOCKBACK;
        t.vy = Math.max(t.vy, ARROW_KNOCKBACK * 0.6);
        t.onGround = false;
        this.hurt(target, arrow.damage * (result.damageScale ?? 1), arrow.shooter);
        this.removeArrow(arrow);
      } else if (flying) {
        moved.push(arrow);
      }
    }
    return moved;
  }

  removeArrow(arrow) {
    this.arrows.delete(arrow.id);
    this.broadcast({ type: S2C.ENTITY_DESPAWN, id: arrow.id });
  }

  // ---- Cows ----

  // Herds on each island's open grass, sized by actual land area rather than
  // the mostly empty rectangular world bounds.
  spawnHerds() {
    const w = this.world;
    const rand = mulberry32(this.seed ^ 0x46c6b987);
    const grassy = (x, z, island) => {
      for (let y = Math.min(w.sizeY - 1, island.topY); y >= island.bottomY; y--) {
        const id = w.getBlock(x, y, z);
        if (!isSolid(id)) continue;
        return id === BLOCK.GRASS && canStand(w, x, y + 1, z, 2) ? y + 1 : null;
      }
      return null;
    };
    let herdId = 0;
    for (const island of w.islands) {
      const herds = island.kind === 'tiny'
        ? (island.radius >= 13 && rand() < 0.15 ? 1 : 0)
        : Math.max(1, Math.round(Math.PI * island.radius ** 2 / COW_HERD_AREA));
      for (let h = 0; h < herds; h++) {
        for (let tries = 0; tries < 60; tries++) {
          const angle = rand() * Math.PI * 2;
          const distance = Math.sqrt(rand()) * island.radius * 0.7;
          const cx = Math.floor(island.x + Math.cos(angle) * distance);
          const cz = Math.floor(island.z + Math.sin(angle) * distance);
          if (grassy(cx, cz, island) === null || w.keeps.some((k) => Math.hypot(cx - k.cx, cz - k.cz) < 20)
            || rand() > BIOME_SETTINGS[w.biomeAt(cx, cz)].cows / BIOME_SETTINGS.plains.cows) continue;
          const herd = new Herd(herdId++);
          const size = island.kind === 'tiny' ? 1
            : COW_HERD_SIZE[0] + Math.floor(rand() * (COW_HERD_SIZE[1] - COW_HERD_SIZE[0] + 1));
          for (let c = 0, attempts = 0; c < size && attempts < 30; attempts++) {
            const x = cx + Math.floor((rand() - 0.5) * 8), z = cz + Math.floor((rand() - 0.5) * 8);
            const y = grassy(x, z, island);
            if (y === null) continue;
            const cow = new Cow(this.nextId++, herd, x + 0.5, y, z + 0.5);
            this.cows.set(cow.id, cow);
            c++;
          }
          break;
        }
      }
    }
  }

  // Moves every cow; returns the ones that moved (for STATE).
  updateCows() {
    const moved = [];
    for (const cow of this.cows.values()) {
      const s = cow.state;
      const before = `${s.x},${s.y},${s.z},${s.yaw}`;
      cow.step(this.world, this.tick);
      steerGround(cow, this.world);
      if (s.y < this.world.voidY) this.removeCow(cow);
      else if (`${s.x},${s.y},${s.z},${s.yaw}` !== before) moved.push(cow);
    }
    return moved;
  }

  // A hurt cow's whole herd runs from the attacker. At 0 HP it drops leather and beef.
  hurtCow(cow, amount, attacker) {
    cow.hp = Math.max(0, cow.hp - amount);
    this.broadcast({ type: S2C.DAMAGE, id: cow.id, attackerId: attacker?.id ?? null, hp: cow.hp });
    cow.herd.panicUntil = this.tick + COW_PANIC_TICKS;
    cow.herd.threat = attacker ? { x: attacker.state.x, z: attacker.state.z } : { x: cow.state.x, z: cow.state.z };
    // The herd reacts within a few ticks (spread out, so they don't all plan at once).
    for (const other of cow.herd.cows) other.repath = Math.min(other.repath, 1 + Math.floor(Math.random() * 4));
    if (cow.hp > 0) return;
    const s = cow.state;
    const roll = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
    for (const [item, count] of [[ITEM.LEATHER, roll(COW_DROPS.leather)], [ITEM.BEEF, roll(COW_DROPS.beef)]]) {
      if (count > 0) this.spawnItem(item, count, s.x, s.y + 0.5, s.z, (Math.random() - 0.5) * 2, ITEM_POP_SPEED, (Math.random() - 0.5) * 2, ITEM_PICKUP_DELAY);
    }
    this.removeCow(cow);
  }

  removeCow(cow) {
    cow.dead = true;
    cow.herd.cows.delete(cow);
    this.cows.delete(cow.id);
    this.broadcast({ type: S2C.ENTITY_DESPAWN, id: cow.id });
  }

  // Dragons at match start, each leashed to its home island (DRAGON_LEASH):
  // centralDragons spread around the central island, teamDragons on each
  // team island (well away from its keep, preferably on the far side), and
  // one at each roost's nest. All spawn above open grass; none respawn.
  spawnDragons() {
    const config = WORLD_SIZES[this.worldSize];
    const rand = mulberry32(this.seed ^ 0x8a7f219d);
    const add = (x, ground, z, island, leash) => {
      const dragon = new Dragon(this.nextId++, x + 0.5, Math.min(this.world.sizeY - 6, ground + 10), z + 0.5,
        { x: island.x, z: island.z, radius: island.radius }, leash);
      this.dragons.set(dragon.id, dragon);
    };
    const center = this.world.islands.find((island) => island.kind === 'center');
    const count = config.centralDragons;
    const rotation = rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const angle = rotation + i * Math.PI * 2 / count + (rand() - 0.5) * 0.45;
        const distance = center.radius * (0.3 + rand() * 0.35);
        const x = Math.floor(center.x + Math.cos(angle) * distance);
        const z = Math.floor(center.z + Math.sin(angle) * distance);
        const ground = this.world.getSurfaceY(x, z, isSolid);
        if (ground < 0 || this.world.getBlock(x, ground, z) !== BLOCK.GRASS
          || this.world.keeps.some((keep) => Math.hypot(x - keep.cx, z - keep.cz) < 35)) continue;
        add(x, ground, z, center, DRAGON_LEASH.center);
        break;
      }
    }
    for (const island of this.world.islands.filter((entry) => entry.kind === 'team')) {
      const keep = this.world.keeps[island.teamIndex];
      const spawn = this.keepSpawn(keep);
      const awayAngle = Math.atan2(island.z - keep.cz, island.x - keep.cx);
      for (let dragonIndex = 0; dragonIndex < config.teamDragons; dragonIndex++) {
        let site = null;
        const validSite = (x, z) => {
          if (Math.hypot(x - keep.cx, z - keep.cz) < 25
            || Math.hypot(x + 0.5 - spawn.x, z + 0.5 - spawn.z) < 25) return null;
          const ground = this.world.getSurfaceY(x, z, isSolid);
          return ground >= 0 && this.world.getBlock(x, ground, z) === BLOCK.GRASS
            ? { x, z, ground } : null;
        };
        for (let tries = 0; tries < 120; tries++) {
          const angle = awayAngle + (rand() - 0.5) * Math.PI;
          const distance = island.radius * (0.5 + rand() * 0.3);
          const x = Math.floor(island.x + Math.cos(angle) * distance);
          const z = Math.floor(island.z + Math.sin(angle) * distance);
          site = validSite(x, z);
          if (site) break;
        }
        if (!site) {
          for (let z = Math.floor(island.z - island.radius); z <= island.z + island.radius; z += 2) {
            for (let x = Math.floor(island.x - island.radius); x <= island.x + island.radius; x += 2) {
              if (Math.hypot(x - island.x, z - island.z) > island.radius * 0.85) continue;
              const candidate = validSite(x, z);
              if (candidate && (!site || Math.hypot(x - keep.cx, z - keep.cz)
                > Math.hypot(site.x - keep.cx, site.z - keep.cz))) site = candidate;
            }
          }
        }
        if (!site) continue;
        add(site.x, site.ground, site.z, island, DRAGON_LEASH.team);
      }
    }
    for (const roost of this.world.roosts) {
      add(roost.x, roost.y, roost.z, this.world.islands[roost.island], DRAGON_LEASH.roost);
    }
  }

  // Fire hits whoever is in the cone, except players in fire-immune armor.
  updateDragons() {
    const players = [...this.players.values()];
    for (const dragon of this.dragons.values()) {
      for (const target of dragon.step(this.world, players, this.tick)) {
        if (!target.fireImmune()) this.damage(target, DRAGON_FIRE_DAMAGE, dragon, DEATH_CAUSE.MOB);
      }
    }
    // Flight and fire are sent every tick so the flame starts and stops promptly.
    return [...this.dragons.values()];
  }

  // ---- Crawlers and Void Eels ----

  // Crawlers at the spawn points world gen chose (dungeons, underside ruins, caverns).
  spawnCrawlers() {
    for (const { x, y, z } of this.world.mobSpawns.crawlers) {
      const crawler = new Crawler(this.nextId++, x + 0.5, y, z + 0.5);
      this.mobs.set(crawler.id, crawler);
    }
  }

  eelBand() {
    const lowest = Math.min(...this.world.islands.map((island) => island.bottomY));
    return { top: lowest - EEL_BAND.belowIsland, bottom: this.world.voidY + EEL_BAND.aboveVoid };
  }

  // Half start under the center; the others are spread across the world.
  // Every eel can later roam the entire deep band.
  spawnEels() {
    const count = WORLD_SIZES[this.worldSize].eels;
    const center = this.world.islands.find((island) => island.kind === 'center');
    const band = this.eelBand();
    const random = mulberry32(this.seed ^ 0x35bd248a);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * center.radius * 0.8;
      const x = i < Math.ceil(count / 2) ? center.x + Math.cos(angle) * radius
        : 4 + random() * (this.world.sizeX - 8);
      const z = i < Math.ceil(count / 2) ? center.z + Math.sin(angle) * radius
        : 4 + random() * (this.world.sizeZ - 8);
      const y = band.bottom + 4 + random() * (band.top - band.bottom - 8);
      const eel = new VoidEel(this.nextId++, band, { x, y, z });
      this.mobs.set(eel.id, eel);
    }
  }

  // Moves every Crawler and Eel and lands their bites. Crawlers go in STATE
  // on ticks they moved; eels every tick, as they never stop swimming.
  updateMobs() {
    const players = [...this.players.values()];
    const moved = [];
    for (const mob of this.mobs.values()) {
      const s = mob.state;
      const before = `${s.x},${s.y},${s.z},${s.yaw},${mob.extraKey?.() ?? ''}`;
      const time = this.dayTime();
      const bitten = mob instanceof VoidEel
        ? mob.step(this.world, players, this.tick, time >= 0.5 && time < 1)
        : mob.step(this.world, players, this.tick);
      if (mob instanceof Crawler) steerGround(mob, this.world);
      if (s.y < this.world.voidY) {
        this.removeMob(mob);
        continue;
      }
      if (bitten) {
        if (mob instanceof VoidEel && bitten.state.gliding) {
          bitten.state.gliding = false;
          bitten.state.glideBlockedTicks = ticks(EEL_GLIDE_BREAK);
        }
        if (mob.biteKnockback) this.swing(mob);
        this.meleeHit(bitten, mob.biteDamage ?? (mob instanceof Crawler ? CRAWLER_DAMAGE : EEL_DAMAGE), mob,
          mob.biteKnockback ?? 0.6);
      }
      if (`${s.x},${s.y},${s.z},${s.yaw},${mob.extraKey?.() ?? ''}` !== before) moved.push(mob);
    }
    return moved;
  }

  removeMob(mob) {
    if (mob.dead) return;
    if (mob.goblin) this.goblins.removed(mob);
    mob.dead = true;
    this.mobs.delete(mob.id);
    this.broadcast({ type: S2C.ENTITY_DESPAWN, id: mob.id });
  }

  // A mob bite: damage and a shove away from the mob (knockback: a scale on
  // KNOCKBACK_SPEED), and Thorns hurts it back.
  meleeHit(target, amount, mob, knockback = 0.6) {
    const t = target.state, s = mob.state;
    let dx = t.x - s.x, dz = t.z - s.z;
    const len = Math.hypot(dx, dz) || 1;
    t.kx = dx / len * KNOCKBACK_SPEED * knockback;
    t.kz = dz / len * KNOCKBACK_SPEED * knockback;
    t.vy = Math.max(t.vy, KNOCKBACK_UP * Math.min(1, knockback));
    t.onGround = false;
    this.damage(target, amount, mob, DEATH_CAUSE.MOB);
    const thorns = target.thorns?.() ?? 0;
    if (thorns > 0 && !target.dead) this.hurt(mob, thorns, target);
  }

  // A Crawler or Eel took damage. A player's hit provokes it; a dead Crawler drops Silk.
  hurtMob(mob, amount, attacker) {
    if (mob.dead) return;
    mob.hp = Math.max(0, mob.hp - amount);
    this.broadcast({ type: S2C.DAMAGE, id: mob.id, attackerId: attacker?.id ?? null, hp: mob.hp });
    if (attacker instanceof Player) mob.provocation.provoke(attacker, this.tick);
    if (mob.hp > 0) return;
    if (mob instanceof Crawler) {
      const silk = CRAWLER_DROPS.silk[0] + Math.floor(Math.random() * (CRAWLER_DROPS.silk[1] - CRAWLER_DROPS.silk[0] + 1));
      if (silk > 0) this.spawnItem(ITEM.SILK, silk, mob.state.x, mob.state.y + 0.3, mob.state.z,
        (Math.random() - 0.5) * 2, ITEM_POP_SPEED, (Math.random() - 0.5) * 2, ITEM_PICKUP_DELAY);
    }
    if (mob instanceof VoidEel) {
      const count = EEL_DROPS[0] + Math.floor(Math.random() * (EEL_DROPS[1] - EEL_DROPS[0] + 1));
      this.spawnItem(ITEM.RIFT_ORB, count, mob.state.x, mob.state.y, mob.state.z,
        0, ITEM_POP_SPEED, 0, ITEM_PICKUP_DELAY);
    }
    this.removeMob(mob);
  }

  // Damage to anything a player can hit: a player, cow, dragon, Crawler, Eel or goblin.
  hurt(target, amount, attacker) {
    if (target.goblin) this.goblins.hurt(target, amount, attacker, attacker instanceof Player);
    else if (target instanceof Cow) this.hurtCow(target, amount, attacker);
    else if (target instanceof Dragon) this.hurtDragon(target, amount, attacker);
    else if (target instanceof Crawler || target instanceof VoidEel) this.hurtMob(target, amount, attacker);
    else this.damage(target, amount, attacker);
  }

  // A player's hit provokes it. A dead dragon drops iron, leather and Dragon Scales.
  hurtDragon(dragon, amount, attacker) {
    if (dragon.dead) return;
    dragon.hp = Math.max(0, dragon.hp - amount);
    this.broadcast({ type: S2C.DAMAGE, id: dragon.id, attackerId: attacker?.id ?? null, hp: dragon.hp });
    if (attacker instanceof Player) dragon.provocation.provoke(attacker, this.tick);
    if (dragon.hp > 0) return;
    dragon.dead = true;
    this.dragons.delete(dragon.id);
    this.broadcast({ type: S2C.ENTITY_DESPAWN, id: dragon.id });
    const roll = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1));
    for (const [item, count] of [[ITEM.IRON_INGOT, roll(DRAGON_DROPS.iron)], [ITEM.LEATHER, roll(DRAGON_DROPS.leather)],
      [ITEM.DRAGON_SCALE, roll(DRAGON_DROPS.scales)]]) {
      this.spawnItem(item, count, dragon.state.x, dragon.state.y, dragon.state.z,
        (Math.random() - 0.5) * 2, ITEM_POP_SPEED, (Math.random() - 0.5) * 2, ITEM_PICKUP_DELAY);
    }
  }

  // ---- Combat ----

  // A punch: confirmed by casting from the attacker's eyes along this input's
  // look direction. The nearest live, connected player in reach and in front of
  // any block takes damage and knockback (scaled by the weapon, which may also
  // slow them with frost).
  stepAttack(player) {
    if (this.tick < player.nextAttackTick) return;
    const weapon = player.attackStats();
    player.nextAttackTick = this.tick + ticks(weapon.cooldown);
    this.swing(player);
    const s = player.state;
    const eye = { x: s.x, y: s.y + eyeHeight(s), z: s.z };
    const dir = lookDirection(s.yaw, s.pitch);
    const block = raycastBlock(this.world, eye, dir, REACH_DISTANCE, (id) => isTargetable(id) && !isWater(id));
    const targets = [...this.players.values(), ...this.cows.values(), ...this.dragons.values(), ...this.mobs.values()]
      .filter((p) => p !== player && (!(p instanceof Player) || p.team !== player.team) && !p.dead && p.connected);
    const hit = raycastPlayers(eye, dir, block ? block.t : REACH_DISTANCE, targets, (p) => playerBoxOf(p.state), HIT_TOLERANCE);
    if (!hit) return;

    const target = hit.player, t = target.state;
    // Away from the attacker; straight along the look direction if they overlap.
    let dx = t.x - s.x, dz = t.z - s.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = dir.x; dz = dir.z; }
    const push = KNOCKBACK_SPEED * (weapon.knockback ?? 1);
    t.kx = dx * push;
    t.kz = dz * push;
    t.vy = Math.max(t.vy, weapon.lift ?? KNOCKBACK_UP);
    t.onGround = false;
    if (weapon.frost && (target instanceof Player || target instanceof Cow || target instanceof Crawler)) {
      t.slowTicks = ticks(FROST.seconds);
    }
    this.hurt(target, weapon.damage * (hit.damageScale ?? 1), player);
    // Vampiric: a chance to heal 1 HP on a hit. Thorns: the target's armor hurts back.
    if (weapon.heal && Math.random() < weapon.heal) player.hp = Math.min(player.maxHp(), player.hp + 1);
    const thorns = target instanceof Player ? target.thorns() : 0;
    if (thorns > 0) this.damage(player, thorns, target);
  }

  // attacker: the player who hit them, or null (fall damage). A death with no
  // attacker is credited to whoever hit them recently.
  damage(target, amount, attacker, cause = DEATH_CAUSE.PLAYER) {
    if (target.dead) return;
    if (attacker && attacker.team === target.team) return;
    if (this.tick < target.invulnerableUntilTick) return;
    if (cause !== DEATH_CAUSE.FALL && cause !== DEATH_CAUSE.VOID) {
      amount = amount * 10 / (10 + target.armorPoints());
    }
    const hp = Math.max(0, target.hp - amount);
    target.lastDamageTick = this.tick;
    if (attacker) target.lastAttacker = { id: attacker.id, tick: this.tick };
    const ember = accessoryDef(target.inventory.accessory?.item);
    if (hp === 0 && ember?.visual === 'ember' && cause !== DEATH_CAUSE.VOID) {
      target.inventory.accessory = null;
      target.state.accessory = null;
      target.inventoryDirty = true;
      target.hp = ember.rescueHp;
      target.invulnerableUntilTick = this.tick + ticks(ember.invulnerableSeconds);
      this.broadcast({ type: S2C.EMBER_BURST, id: target.id,
        x: target.state.x, y: target.state.y, z: target.state.z });
      this.broadcast({ type: S2C.DAMAGE, id: target.id, attackerId: attacker?.id ?? null, hp: target.hp });
      return;
    }
    target.hp = hp;
    this.broadcast({ type: S2C.DAMAGE, id: target.id, attackerId: attacker?.id ?? null, hp: target.hp });
    if (target.hp === 0) this.kill(target, attacker ?? this.recentAttacker(target), cause);
  }

  // The player who hit this one within KILL_CREDIT_TIME, or null.
  recentAttacker(player) {
    const a = player.lastAttacker;
    const attacker = a && (this.players.get(a.id) ?? this.dragons.get(a.id) ?? this.mobs.get(a.id));
    return (attacker && attacker.team !== player.team && this.tick - a.tick <= KILL_CREDIT_TICKS && attacker) || null;
  }

  // Fall damage: the highest point since last standing (or holding a ladder,
  // or swimming) against where they land. prevY is the height before this
  // tick's move, so a fall counts from the ledge, not a tick below it.
  trackFall(player, prevY) {
    const s = player.state;
    if (s.accessory === ITEM.SPRING_BOOTS || s.flying) { player.fallTop = null; return; }
    let crossedWater = false;
    if (s.y < prevY) {
      const halfW = playerBoxOf(s).halfW;
      for (let y = Math.floor(s.y); y <= Math.floor(prevY + 0.4) && !crossedWater; y++) {
        for (let z = Math.floor(s.z - halfW); z <= Math.floor(s.z + halfW) && !crossedWater; z++) {
          for (let x = Math.floor(s.x - halfW); x <= Math.floor(s.x + halfW); x++) {
            if (isWater(this.world.getBlock(x, y, z))) { crossedWater = true; break; }
          }
        }
      }
    }
    if (isOnLadder(s, this.world) || isInWater(s, this.world) || crossedWater || s.gliding) {
      player.fallTop = null;
    } else if (!s.onGround) {
      player.fallTop = Math.max(player.fallTop ?? prevY, prevY, s.y);
    } else if (player.fallTop !== null) {
      // Landing leaves the feet a hair above the block (the physics' collision
      // margin), so allow for that when counting whole blocks.
      const fall = player.fallTop - s.y + 0.01;
      player.fallTop = null;
      // Cushioned accessories soften it.
      const damage = Math.floor((fall - FALL_SAFE_DISTANCE) * player.fallDamageScale());
      if (damage > 0) this.damage(player, damage, null, DEATH_CAUSE.FALL);
    }
  }

  // Void deaths lose the inventory; other deaths drop it where the player died.
  // A flagless player's death eliminates them: no respawn, they spectate.
  kill(player, killer, cause) {
    player.dead = true;
    player.hp = 0;
    player.deathTick = this.tick;
    player.breaking = null;
    player.grab = null;
    player.viewing = null;
    player.drawTicks = 0;
    player.loadTicks = 0;
    player.loaded = false;
    player.eatTicks = 0;
    player.foodHealing.length = 0;
    if (player.carrying) this.dropFlag(player);
    player.eliminated = player.flag.state === FLAG_STATE.CAPTURED;
    const s = player.state;
    if (!player.creative && cause !== DEATH_CAUSE.VOID) {
      const r = () => (Math.random() - 0.5) * 4;
      for (const stack of player.inventory.takeAll()) {
        this.spawnItem(stack.item, stack.count, s.x, s.y + 0.5, s.z, r(), ITEM_POP_SPEED, r(), ITEM_PICKUP_DELAY, stack.mods);
      }
    }
    if (!player.creative) player.inventory.takeAll();
    player.inventoryDirty = true;
    console.log(killer ? `${killer.name} killed ${player.name} (${cause})` : `${player.name} died (${cause})`);
    this.broadcast({
      type: S2C.DEATH, id: player.id, killerId: killer?.id ?? null, cause, eliminated: player.eliminated,
    });
    if (player.eliminated) this.checkWin();
  }

  checkWin() {
    if (this.winnerId !== null) return;
    // A captured flag removes respawns, but every member of that team gets
    // to fight until their next death. Count teams with surviving members.
    const activeTeams = new Set([...this.players.values()].filter((p) => !p.eliminated).map((p) => p.team));
    if (activeTeams.size !== 1) return;
    const winner = [...this.flags.values()].find((f) => f.team === [...activeTeams][0]);
    if (!winner) return;
    this.winnerId = winner.id;
    this.broadcast({ type: S2C.MATCH_END, winnerId: winner.id, winnerTeam: winner.team,
      members: [...this.players.values()].filter((p) => p.team === winner.team).map((p) => p.name) });
  }

  checkVoid(player) {
    if (player.state.y >= this.world.voidY) return;
    this.kill(player, this.recentAttacker(player), DEATH_CAUSE.VOID);
  }

  respawn(player) {
    if (!player.dead || player.eliminated || this.tick < player.deathTick + RESPAWN_DELAY_TICKS) return;
    const { yaw, pitch } = player.state;
    const spawn = this.keepSpawn(player.keep);
    player.state = createPlayerState(spawn.x, spawn.y, spawn.z);
    Object.assign(player.state, { yaw, pitch });
    player.state.creative = player.creative;
    player.hp = player.maxHp();
    player.dead = false;
    player.lastAttacker = null;
    player.lastDamageTick = -Infinity;
    player.fallTop = null;
  }

  // 1 HP every REGEN_INTERVAL (on the game clock) once REGEN_DELAY has passed since the last hit.
  regen(player) {
    if (player.dead) return;
    const maximum = player.maxHp();
    const accessory = accessoryDef(player.inventory.accessory?.item);
    const delayTicks = ticks(accessory?.regenDelay ?? REGEN_DELAY);
    const intervalTicks = ticks(accessory?.regenInterval ?? REGEN_INTERVAL);
    for (const dose of player.foodHealing) {
      if (this.tick < dose.nextTick) continue;
      if (player.hp < maximum) player.hp = Math.min(maximum, player.hp + 1);
      dose.remaining--;
      dose.nextTick += dose.interval;
    }
    player.foodHealing = player.foodHealing.filter((dose) => dose.remaining > 0 && player.hp < maximum);
    if (player.hp >= maximum) return;
    const sinceDamage = this.tick - player.lastDamageTick;
    if (sinceDamage < delayTicks) return;
    if (Number.isFinite(sinceDamage)) {
      if ((sinceDamage - delayTicks) % intervalTicks === 0) player.hp++;
    } else if (this.tick % intervalTicks === 0) player.hp++;
  }

  stepEating(player, eat) {
    const held = player.held();
    const item = getItemDef(held);
    const food = item.food;
    if (!eat || !food) {
      player.eatTicks = 0;
      player.eatingItem = null;
      return;
    }
    if (player.eatingItem !== held) player.eatTicks = 0;
    player.eatingItem = held;
    if (item.instantHeal) {
      if (player.eatTicks === 0 && player.hp < player.maxHp()) {
        player.inventory.takeOne(player.selected);
        player.inventoryDirty = true;
        player.hp = player.maxHp();
        player.foodHealing.length = 0;
      }
      player.eatTicks = 1;
      return;
    }
    if (++player.eatTicks < EAT_TICKS) return;
    player.eatTicks = 0;
    player.inventory.takeOne(player.selected);
    player.inventoryDirty = true;
    const interval = Math.max(1, FOOD_HEAL_TIME * TICK_RATE / food);
    player.foodHealing.push({ remaining: food, nextTick: this.tick + interval, interval });
  }

  // ---- Flags ----

  // Feet within touching distance of a flag's base.
  onFlag(player, pos) {
    const s = player.state;
    return Math.hypot(pos.x - s.x, pos.z - s.z) <= FLAG_TOUCH_RADIUS && pos.y >= s.y - 0.5 && pos.y <= s.y + 1;
  }

  flagEvent(flag, kind, by) {
    this.broadcast({ type: S2C.FLAG_EVENT, flag: flag.id, kind, by: by?.id ?? null });
  }

  takeFlag(player, flag) {
    flag.state = FLAG_STATE.CARRIED;
    flag.carrier = player;
    player.carrying = flag;
    player.state.carrying = true;
    player.grab = null;
    console.log(`${player.name} took team ${flag.team}'s flag`);
    this.flagEvent(flag, FLAG_EVENT.TAKEN, player);
  }

  // Leaves the carried flag where the carrier is; it falls from there.
  dropFlag(player) {
    const flag = player.carrying;
    const { x, y, z } = player.state;
    player.carrying = null;
    player.state.carrying = false;
    flag.state = FLAG_STATE.DROPPED;
    flag.carrier = null;
    flag.body = { ...flag.body, x, y, z, vx: 0, vy: 0, vz: 0, onGround: false };
    flag.droppedTick = this.tick;
    this.flagEvent(flag, FLAG_EVENT.DROPPED, player);
  }

  returnFlag(flag, by = null) {
    flag.goHome();
    this.flagEvent(flag, FLAG_EVENT.RETURNED, by);
  }

  capture(player) {
    const flag = player.carrying;
    player.carrying = null;
    player.state.carrying = false;
    flag.state = FLAG_STATE.CAPTURED;
    flag.carrier = null;
    console.log(`${player.name} captured team ${flag.team}'s flag`);
    this.flagEvent(flag, FLAG_EVENT.CAPTURED, player);
  }

  // Once per tick: dropped flags fall and time out, then each player on the
  // field can capture, return their own dropped flag, or keep grabbing an enemy flag.
  updateFlags() {
    for (const flag of this.flags.values()) {
      if (flag.state !== FLAG_STATE.DROPPED) continue;
      stepItem(flag.body, this.world);
      if (flag.body.y < this.world.voidY || this.tick - flag.droppedTick >= FLAG_RETURN_TICKS) this.returnFlag(flag);
    }

    for (const player of this.players.values()) {
      const accessory = player.inventory.accessory?.item ?? null;
      if (player.state.accessory !== accessory) {
        player.state.accessory = accessory;
        player.state.springCharge = 0;
        player.state.springBouncing = false;
      }
      player.hp = Math.min(player.hp, player.maxHp());
      if (player.dead || !player.connected) {
        player.grab = null;
        continue;
      }
      const own = player.flag;
      if (own.state === FLAG_STATE.DROPPED && this.onFlag(player, own.body)) this.returnFlag(own, player);
      // Capture on your own pedestal while your flag is home, or while you're
      // flagless (your flag already captured).
      if (player.carrying) {
        const canCapture = own.state === FLAG_STATE.HOME || own.state === FLAG_STATE.CAPTURED;
        if (canCapture && this.onFlag(player, own.home)) this.capture(player);
        continue;
      }

      const target = [...this.flags.values()].find((f) => f.team !== player.team
        && (f.state === FLAG_STATE.HOME || f.state === FLAG_STATE.DROPPED) && this.onFlag(player, f.position));
      if (!target) {
        player.grab = null;
        continue;
      }
      if (player.grab?.flag !== target) player.grab = { flag: target, ticks: 0 };
      if (++player.grab.ticks >= GRAB_TICKS) this.takeFlag(player, target);
    }
  }

  // Time of day, 0..1 (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight),
  // from the match clock. Clients keep it from `welcome` and the ticks in `state`.
  dayTime() {
    return (DAY_START + this.tick / (DAY_LENGTH * TICK_RATE)) % 1;
  }

  inReach(player, pos) {
    const s = player.state;
    const dist = Math.hypot(pos.x + 0.5 - s.x, pos.y + 0.5 - (s.y + eyeHeight(s)), pos.z + 0.5 - s.z);
    return dist <= REACH_DISTANCE + REACH_SLACK;
  }

  update() {
    if (this.phase !== PHASE.PLAYING) return;
    this.tick++;
    this.water.tick(this.tick);
    for (const player of this.players.values()) {
      // Each input is one tick of movement. Run whatever arrived since the last
      // server tick so network jitter doesn't lose or duplicate inputs.
      for (const input of player.inputQueue) {
        player.lastSeq = input.seq;
        if (player.dead) continue;
        player.selected = input.slot;
        const accessory = player.inventory.accessory?.item ?? null;
        if (player.state.accessory !== accessory) {
          player.state.accessory = accessory;
          player.state.springCharge = 0;
          player.state.springBouncing = false;
        }
        player.state.moveScale = player.moveScale();
        player.state.creative = player.creative;
        // Drawing or loading (and its slowdown) only counts with a bow or
        // crossbow in hand, firing with a crossbow, and hooking with a
        // grappling hook (the physics also refuses it while carrying a flag
        // or cooling down).
        const held = player.held();
        if (input.draw && held !== ITEM.BOW && held !== ITEM.CROSSBOW) input.draw = false;
        if (input.fire && held !== ITEM.CROSSBOW) input.fire = false;
        if (input.hook && held !== ITEM.GRAPPLING_HOOK) input.hook = false;
        if (input.eat && !getItemDef(player.held()).food) input.eat = false;
        if (input.glide && player.held() !== ITEM.GLIDER) input.glide = false;
        const prevY = player.state.y;
        stepPlayer(player.state, input, this.world);
        this.checkVoid(player);
        if (!player.dead) this.trackFall(player, prevY);
        if (player.dead) continue;
        if (input.attack) this.stepAttack(player);
        this.stepBreaking(player, input.breaking);
        if (input.use) this.stepUse(player, input.use);
        else if (input.place) this.stepPlace(player, input.place, input.slot);
        if (input.spawnEgg) this.stepSpawnEgg(player, input.spawnEgg, input.slot);
        if (input.rift) this.stepRift(player);
        if (input.drop) this.stepDrop(player, input.slot);
        this.stepBow(player, input.draw);
        this.stepCrossbow(player, input.draw, input.fire);
        this.stepEating(player, input.eat);
      }
      player.inputQueue.length = 0;
      this.regen(player);
    }

    this.leafDecay.tick();
    this.saplings.tick(this.tick);
    this.quarry.tick(this.tick);
    this.goblins.update(this.tick);

    this.updateFlags();
    this.updatePortals();
    this.updateContainers();

    const livingMobs = [...this.cows.values(), ...this.dragons.values(), ...this.mobs.values()];
    const crowdGrid = assignMobSteering(livingMobs);
    const movedItems = [...this.updateItems(), ...this.updateArrows(), ...this.updateRiftOrbs(), ...this.updateCows(), ...this.updateDragons(),
      ...this.updateMobs()];
    for (const mob of resolveMobOverlaps(this.world, livingMobs.filter((mob) => !mob.dead), crowdGrid)) {
      if (!movedItems.includes(mob)) movedItems.push(mob);
    }

    for (const player of this.players.values()) {
      if (!player.inventoryDirty) continue;
      player.inventoryDirty = false;
      this.send(player, { type: S2C.INVENTORY, ...player.inventory.toJSON() });
    }

    this.broadcast({
      type: S2C.STATE,
      tick: this.tick,
      entities: [
        ...[...this.players.values()].map((p) => p.snapshot()),
        ...movedItems.map((e) => e.snapshot()),
      ],
      flags: [...this.flags.values()].map((f) => f.snapshot()),
    });
  }

  send(player, msg) {
    sendTo(player.socket, msg);
  }

  // To every connected match player, optionally skipping one.
  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p !== except && p.socket?.readyState === 1) p.socket.send(data);
    }
  }
}
