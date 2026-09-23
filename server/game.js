// Authoritative game state. Two phases: a lobby where players pick a name and
// color and ready up, then a match with the world, players and the fixed-rate
// tick loop. A match runs until the server stops; players who connect during it
// can reclaim a disconnected player by name or wait on the in-progress screen.

import {
  TICK_RATE, MAX_QUEUED_INPUTS, PLAYER_HEIGHT,
  REACH_DISTANCE, HOTBAR_SIZE, ITEM_SIZE, TOWER_MIN_HEIGHT,
  BOW_FULL_DRAW, BOW_MIN_DRAW, BOW_COOLDOWN, ARROW_SPEED, ARROW_DAMAGE, ARROW_KNOCKBACK, ITEM_PICKUP_RADIUS, ITEM_PICKUP_DELAY,
  ITEM_THROW_PICKUP_DELAY, ITEM_THROW_SPEED, ITEM_POP_SPEED,
  MAX_HP, REGEN_DELAY, REGEN_INTERVAL, HIT_TOLERANCE,
  KNOCKBACK_SPEED, KNOCKBACK_UP, RESPAWN_DELAY, VOID_Y, KILL_CREDIT_TIME, FALL_SAFE_DISTANCE,
  FLAG_RETURN_TIME, FLAG_TOUCH_RADIUS,
} from '../shared/config.js';
import {
  BLOCK, isSolid, isTargetable, canBreak, breakTicks, getBlockDef, FACING_DIRS, facingOf, facedBlock,
  ladderBlock, isLadder, ladderFacing, doorBlock, isDoor, doorState,
} from '../shared/blocks.js';
import { getItemDef, ITEM } from '../shared/items.js';
import { getRecipe } from '../shared/recipes.js';
import { createContainer } from './containers.js';
import { Arrow } from './arrow.js';
import { generateWorld, parseSeed, WORLD_SIZES, DEFAULT_WORLD_SIZE } from '../shared/worldgen.js';
import { keepAt, flagHome } from '../shared/structures.js';
import {
  stepPlayer, stepItem, playerOverlapsBlock, createPlayerState, playerBoxOf, eyeHeight, isOnLadder, isInWater,
  playerFitsAt,
} from '../shared/physics.js';
import { lookDirection, raycastBlock, raycastPlayers } from '../shared/raycast.js';
import {
  C2S, S2C, PHASE, MAX_NAME_LENGTH, DEATH_CAUSE, FLAG_STATE, FLAG_EVENT,
} from '../shared/protocol.js';
import { Player, GRAB_TICKS } from './player.js';
import { Flag } from './flag.js';
import { ItemEntity } from './item.js';

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Server checks reach against the block center using a slightly stale position,
// so allow the center-to-corner distance plus some movement lag.
const REACH_SLACK = 1.5;
const MAX_SEED_LENGTH = 64;

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const REGEN_DELAY_TICKS = ticks(REGEN_DELAY);
const REGEN_INTERVAL_TICKS = ticks(REGEN_INTERVAL);
const RESPAWN_DELAY_TICKS = ticks(RESPAWN_DELAY);
const KILL_CREDIT_TICKS = ticks(KILL_CREDIT_TIME);
const BOW_FULL_TICKS = ticks(BOW_FULL_DRAW);
const BOW_MIN_TICKS = ticks(BOW_MIN_DRAW);
const BOW_COOLDOWN_TICKS = ticks(BOW_COOLDOWN);
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

function randomColor() {
  // Random hue at fixed saturation/lightness so colors stay bright and distinct.
  const h = Math.random();
  const s = 0.75, l = 0.55;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function sendTo(socket, msg) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
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
    // Sessions on the "match in progress" screen.
    this.spectators = new Set();
  }

  start() {
    setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  // A socket stays anonymous until its HELLO; after that it is exactly one of
  // a lobby member, a spectator or a match player.
  connect(socket) {
    const session = { socket, greeted: false, member: null, player: null, spectating: false };
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
    }
  }

  hello(session, msg) {
    if (session.greeted) return;
    session.greeted = true;
    const name = cleanName(msg.name);
    if (this.phase === PHASE.LOBBY) this.joinLobby(session, name);
    else if (!this.reclaim(session, name)) this.spectate(session);
  }

  // ---- Lobby ----

  nameTaken(name, except = null) {
    for (const m of this.members.values()) {
      if (m !== except && sameName(m.name, name)) return true;
    }
    return false;
  }

  joinLobby(session, name) {
    const id = this.nextId++;
    if (!name || this.nameTaken(name)) {
      let n = id;
      while (this.nameTaken(`Player ${n}`)) n++;
      name = `Player ${n}`;
    }
    const member = { id, session, name, color: randomColor(), ready: false };
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
    if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color <= 0xffffff) member.color = msg.color;
    if (typeof msg.ready === 'boolean') member.ready = msg.ready;
    if (member.id === this.hostId && Object.hasOwn(WORLD_SIZES, msg.worldSize)) this.worldSize = msg.worldSize;
    // Always sent, so a rejected name snaps back on the client.
    this.broadcastLobby();
  }

  broadcastLobby() {
    const players = [...this.members.values()].map(({ id, name, color, ready }) => ({ id, name, color, ready }));
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
    const started = performance.now();
    this.world = generateWorld(this.seed, this.playerCount, this.worldSize);
    this.world.onBlockChanged = (x, y, z, id) => {
      this.blockChanges.set(`${x},${y},${z}`, { x, y, z, id });
      this.broadcast({ type: S2C.BLOCK_CHANGE, x, y, z, id });
    };

    // The i-th member (in join order) gets the i-th keep, and spawns there.
    [...this.members.values()].forEach((m, i) => {
      const keep = this.world.keeps[i];
      const player = new Player(m.id, m.session.socket, m.name, m.color, this.keepSpawn(keep));
      player.keep = keep;
      player.flag = new Flag(player.id, player.color, flagHome(keep));
      this.flags.set(player.id, player.flag);
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
      worldSize: this.worldSize,
      tick: this.tick,
      blocks: [...this.blockChanges.values()],
      players: [...this.players.values()].map((p) => ({ ...p.describe(), ...p.snapshot() })),
      entities: [...this.items.values(), ...this.arrows.values()].map((e) => e.describe()),
      inventory: player.inventory,
      flags: [...this.flags.values()].map((f) => ({ ...f.describe(), ...f.snapshot() })),
      winnerId: this.winnerId,
    });
  }

  queueInput(player, msg) {
    if (!Number.isInteger(msg.seq) || msg.seq <= player.lastSeq) return;
    if (player.inputQueue.length >= MAX_QUEUED_INPUTS) return;
    player.inputQueue.push({
      seq: msg.seq,
      forward: Number(msg.forward) || 0,
      strafe: Number(msg.strafe) || 0,
      jump: !!msg.jump,
      yaw: Number(msg.yaw) || 0,
      pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number(msg.pitch) || 0)),
      slot: Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < HOTBAR_SIZE ? msg.slot : 0,
      breaking: parseBlockPos(this.world, msg.breaking),
      place: parsePlace(this.world, msg.place),
      use: parseBlockPos(this.world, msg.use),
      drop: !!msg.drop,
      attack: !!msg.attack,
      crouch: !!msg.crouch,
      draw: !!msg.draw,
    });
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
        this.world.tileEntities.delete(key);
        for (const stack of container.takeAll()) this.dropAt(stack.item, x, y, z, stack.count);
      }
    }
    FACING_DIRS.forEach(([dx, dz], facing) => {
      // A ladder on the west side of this block faces east, toward it.
      const n = this.world.getBlock(x - dx, y, z - dz);
      if (isLadder(n) && ladderFacing(n) === facing) this.breakBlock(x - dx, y, z - dz);
    });
    const above = this.world.getBlock(x, y + 1, z);
    if (isDoor(above) && !doorState(above).upper) this.breakBlock(x, y + 1, z);
  }

  dropAt(item, x, y, z, count = 1) {
    const r = () => (Math.random() - 0.5) * 2;
    this.spawnItem(item, count, x + 0.5, y + 0.5 - ITEM_SIZE / 2, z + 0.5, r(), ITEM_POP_SPEED, r(), ITEM_PICKUP_DELAY);
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
    if (def.places === 'ladder') {
      // Flat against the side of a full block: the targeted face must be a side.
      if (pos.ny !== 0 || (pos.nx === 0 && pos.nz === 0)) return;
      if (!isSupport(this.world.getBlock(pos.x - pos.nx, pos.y, pos.z - pos.nz))) return;
      cells = [[pos.x, pos.y, pos.z, ladderBlock(facingOf(-pos.nx, -pos.nz))]];
    } else if (def.places === 'door') {
      // Two tall on a full block, facing the way the player looks.
      if (!this.buildable(pos.x, pos.y + 1, pos.z)) return;
      if (!isSupport(this.world.getBlock(pos.x, pos.y - 1, pos.z))) return;
      if (this.playerIn(pos.x, pos.y, pos.z) || this.playerIn(pos.x, pos.y + 1, pos.z)) return;
      const look = lookDirection(player.state.yaw, 0);
      const facing = Math.abs(look.x) > Math.abs(look.z) ? facingOf(Math.sign(look.x), 0) : facingOf(0, Math.sign(look.z));
      cells = [[pos.x, pos.y, pos.z, doorBlock(facing, false, false)], [pos.x, pos.y + 1, pos.z, doorBlock(facing, false, true)]];
    } else {
      const attached = NEIGHBOURS.some(([dx, dy, dz]) =>
        isTargetable(this.world.getBlock(pos.x + dx, pos.y + dy, pos.z + dz)));
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

  // Air or water (placing into water replaces it), and outside every keep's no-build zone.
  buildable(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    return (id === BLOCK.AIR || id === BLOCK.WATER) && this.world.inBounds(x, y, z) && !keepAt(this.world, x, y, z);
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
    if (msg.container) {
      if (!container || slot < 0 || slot >= container.slots.length) return;
      let moved;
      if (msg.shift) {
        const stack = container.slots[slot];
        if (!stack) return;
        const left = inv.add(stack.item, stack.count);
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
    for (const container of this.world.tileEntities.values()) {
      if (container.tick()) container.dirty = true;
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
      this.spawnItem(left.item, left.count, s.x, s.y + 1, s.z, 0, ITEM_POP_SPEED, 0, ITEM_THROW_PICKUP_DELAY);
    }
  }

  // Workbench recipes need `at`: a workbench within reach.
  craft(player, msg) {
    const recipe = getRecipe(msg.recipe);
    if (player.dead || !recipe) return;
    if (recipe.station === 'workbench') {
      const at = parseBlockPos(this.world, msg.at);
      if (!at || this.world.getBlock(at.x, at.y, at.z) !== BLOCK.WORKBENCH || !this.inReach(player, at)) return;
    }
    if (player.inventory.craft(recipe)) player.inventoryDirty = true;
  }

  // Throws one item from `slot` the way the player is looking.
  stepDrop(player, slot) {
    const item = player.inventory.takeOne(slot);
    if (item === null) return;
    player.inventoryDirty = true;
    const s = player.state;
    const dir = lookDirection(s.yaw, s.pitch);
    const v = ITEM_THROW_SPEED;
    this.spawnItem(item, 1, s.x, s.y + eyeHeight(s) - 0.3, s.z,
      dir.x * v, dir.y * v + 1.5, dir.z * v, ITEM_THROW_PICKUP_DELAY);
  }

  spawnItem(item, count, x, y, z, vx, vy, vz, pickupDelay) {
    const entity = new ItemEntity(this.nextId++, item, count, x, y, z, vx, vy, vz, pickupDelay);
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
      if (s.y < VOID_Y) {
        this.removeItem(entity);
        continue;
      }
      if (s.x !== x || s.y !== y || s.z !== z) moved.push(entity);

      if (entity.pickupTicks > 0) {
        entity.pickupTicks--;
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.connected || player.dead || !this.canPickUp(player, entity)) continue;
        const left = player.inventory.add(entity.item, entity.count);
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
  stepBow(player, draw) {
    if (player.held() !== ITEM.BOW) {
      player.drawTicks = 0;
      return;
    }
    if (draw) {
      if (this.tick >= player.nextShotTick) player.drawTicks++;
      return;
    }
    if (player.drawTicks >= BOW_MIN_TICKS) this.shoot(player, Math.min(1, player.drawTicks / BOW_FULL_TICKS));
    player.drawTicks = 0;
  }

  // An arrow from the eyes along the look direction. Speed and damage scale
  // linearly from the weakest shot (drawn BOW_MIN_DRAW) to a full draw.
  shoot(player, draw) {
    const minDraw = BOW_MIN_TICKS / BOW_FULL_TICKS;
    const t = Math.max(0, Math.min(1, (draw - minDraw) / (1 - minDraw)));
    const speed = ARROW_SPEED[0] + (ARROW_SPEED[1] - ARROW_SPEED[0]) * t;
    const s = player.state;
    const dir = lookDirection(s.yaw, s.pitch);
    const arrow = new Arrow(this.nextId++, player, s.x, s.y + eyeHeight(s), s.z, dir.x * speed, dir.y * speed, dir.z * speed, t);
    arrow.damage = Math.round(ARROW_DAMAGE[0] + (ARROW_DAMAGE[1] - ARROW_DAMAGE[0]) * t);
    this.arrows.set(arrow.id, arrow);
    player.nextShotTick = this.tick + BOW_COOLDOWN_TICKS;
    this.broadcast({ type: S2C.ENTITY_SPAWN, entity: arrow.describe() });
  }

  // Moves every arrow. Returns the ones that moved (for STATE): flying, or
  // just stuck.
  updateArrows() {
    const moved = [];
    for (const arrow of this.arrows.values()) {
      const flying = !arrow.stuckIn;
      const result = arrow.step(this.world, this.players.values());
      if (result === 'gone' || arrow.y < VOID_Y) {
        this.removeArrow(arrow);
      } else if (result?.hit) {
        const target = result.hit, t = target.state;
        // A small push along the arrow's flight.
        t.kx += result.dir.x * ARROW_KNOCKBACK;
        t.kz += result.dir.z * ARROW_KNOCKBACK;
        t.vy = Math.max(t.vy, ARROW_KNOCKBACK * 0.6);
        t.onGround = false;
        this.damage(target, arrow.damage, arrow.shooter);
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

  // ---- Combat ----

  // A punch: confirmed by casting from the attacker's eyes along this input's
  // look direction. The nearest live, connected player in reach and in front of
  // any block takes damage and knockback.
  stepAttack(player) {
    if (this.tick < player.nextAttackTick) return;
    const weapon = player.attackStats();
    player.nextAttackTick = this.tick + ticks(weapon.cooldown);
    this.swing(player);
    const s = player.state;
    const eye = { x: s.x, y: s.y + eyeHeight(s), z: s.z };
    const dir = lookDirection(s.yaw, s.pitch);
    const block = raycastBlock(this.world, eye, dir, REACH_DISTANCE, isTargetable);
    const targets = [...this.players.values()].filter((p) => p !== player && !p.dead && p.connected);
    const hit = raycastPlayers(eye, dir, block ? block.t : REACH_DISTANCE, targets, (p) => playerBoxOf(p.state), HIT_TOLERANCE);
    if (!hit) return;

    const target = hit.player, t = target.state;
    // Away from the attacker; straight along the look direction if they overlap.
    let dx = t.x - s.x, dz = t.z - s.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = dir.x; dz = dir.z; }
    t.kx = dx * KNOCKBACK_SPEED;
    t.kz = dz * KNOCKBACK_SPEED;
    t.vy = Math.max(t.vy, KNOCKBACK_UP);
    t.onGround = false;
    this.damage(target, weapon.damage, player);
  }

  // attacker: the player who hit them, or null (fall damage). A death with no
  // attacker is credited to whoever hit them recently.
  damage(target, amount, attacker, cause = DEATH_CAUSE.PLAYER) {
    if (target.dead) return;
    target.hp = Math.max(0, target.hp - amount);
    target.lastDamageTick = this.tick;
    if (attacker) target.lastAttacker = { id: attacker.id, tick: this.tick };
    this.broadcast({ type: S2C.DAMAGE, id: target.id, attackerId: attacker?.id ?? null, hp: target.hp });
    if (target.hp === 0) this.kill(target, attacker ?? this.recentAttacker(target), cause);
  }

  // The player who hit this one within KILL_CREDIT_TIME, or null.
  recentAttacker(player) {
    const a = player.lastAttacker;
    return (a && this.tick - a.tick <= KILL_CREDIT_TICKS && this.players.get(a.id)) || null;
  }

  // Fall damage: the highest point since last standing (or holding a ladder,
  // or swimming) against where they land. prevY is the height before this
  // tick's move, so a fall counts from the ledge, not a tick below it.
  trackFall(player, prevY) {
    const s = player.state;
    if (isOnLadder(s, this.world) || isInWater(s, this.world)) {
      player.fallTop = null;
    } else if (!s.onGround) {
      player.fallTop = Math.max(player.fallTop ?? prevY, prevY, s.y);
    } else if (player.fallTop !== null) {
      // Landing leaves the feet a hair above the block (the physics' collision
      // margin), so allow for that when counting whole blocks.
      const fall = player.fallTop - s.y + 0.01;
      player.fallTop = null;
      const damage = Math.floor(fall - FALL_SAFE_DISTANCE);
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
    if (player.carrying) this.dropFlag(player);
    player.eliminated = player.flag.state === FLAG_STATE.CAPTURED;
    const s = player.state;
    if (cause !== DEATH_CAUSE.VOID) {
      const r = () => (Math.random() - 0.5) * 4;
      for (const stack of player.inventory.takeAll()) {
        this.spawnItem(stack.item, stack.count, s.x, s.y + 0.5, s.z, r(), ITEM_POP_SPEED, r(), ITEM_PICKUP_DELAY);
      }
    }
    player.inventory.takeAll();
    player.inventoryDirty = true;
    console.log(killer ? `${killer.name} killed ${player.name} (${cause})` : `${player.name} died (${cause})`);
    this.broadcast({
      type: S2C.DEATH, id: player.id, killerId: killer?.id ?? null, cause, eliminated: player.eliminated,
    });
    if (player.eliminated) this.checkWin();
  }

  checkWin() {
    const remaining = [...this.players.values()].filter((p) => !p.eliminated);
    if (remaining.length !== 1 || this.winnerId !== null) return;
    this.winnerId = remaining[0].id;
    console.log(`${remaining[0].name} wins`);
    this.broadcast({ type: S2C.MATCH_END, winnerId: this.winnerId });
  }

  checkVoid(player) {
    if (player.state.y >= VOID_Y) return;
    this.kill(player, this.recentAttacker(player), DEATH_CAUSE.VOID);
  }

  respawn(player) {
    if (!player.dead || player.eliminated || this.tick < player.deathTick + RESPAWN_DELAY_TICKS) return;
    const { yaw, pitch } = player.state;
    const spawn = this.keepSpawn(player.keep);
    player.state = createPlayerState(spawn.x, spawn.y, spawn.z);
    Object.assign(player.state, { yaw, pitch });
    player.hp = MAX_HP;
    player.dead = false;
    player.lastAttacker = null;
    player.lastDamageTick = -Infinity;
    player.fallTop = null;
  }

  // 1 HP every REGEN_INTERVAL (on the game clock) once REGEN_DELAY has passed since the last hit.
  regen(player) {
    if (player.dead || player.hp >= MAX_HP) return;
    if (this.tick - player.lastDamageTick < REGEN_DELAY_TICKS) return;
    if (this.tick % REGEN_INTERVAL_TICKS === 0) player.hp++;
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
    console.log(`${player.name} took ${this.players.get(flag.id).name}'s flag`);
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
    const loser = this.players.get(flag.id);
    player.carrying = null;
    player.state.carrying = false;
    flag.state = FLAG_STATE.CAPTURED;
    flag.carrier = null;
    console.log(`${player.name} captured ${loser.name}'s flag`);
    this.flagEvent(flag, FLAG_EVENT.CAPTURED, player);
  }

  // Once per tick: dropped flags fall and time out, then each player on the
  // field can capture, return their own dropped flag, or keep grabbing an enemy flag.
  updateFlags() {
    for (const flag of this.flags.values()) {
      if (flag.state !== FLAG_STATE.DROPPED) continue;
      stepItem(flag.body, this.world);
      if (flag.body.y < VOID_Y || this.tick - flag.droppedTick >= FLAG_RETURN_TICKS) this.returnFlag(flag);
    }

    for (const player of this.players.values()) {
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

      const target = [...this.flags.values()].find((f) => f !== own
        && (f.state === FLAG_STATE.HOME || f.state === FLAG_STATE.DROPPED) && this.onFlag(player, f.position));
      if (!target) {
        player.grab = null;
        continue;
      }
      if (player.grab?.flag !== target) player.grab = { flag: target, ticks: 0 };
      if (++player.grab.ticks >= GRAB_TICKS) this.takeFlag(player, target);
    }
  }

  inReach(player, pos) {
    const s = player.state;
    const dist = Math.hypot(pos.x + 0.5 - s.x, pos.y + 0.5 - (s.y + eyeHeight(s)), pos.z + 0.5 - s.z);
    return dist <= REACH_DISTANCE + REACH_SLACK;
  }

  update() {
    if (this.phase !== PHASE.PLAYING) return;
    this.tick++;
    for (const player of this.players.values()) {
      // Each input is one tick of movement. Run whatever arrived since the last
      // server tick so network jitter doesn't lose or duplicate inputs.
      for (const input of player.inputQueue) {
        player.lastSeq = input.seq;
        if (player.dead) continue;
        player.selected = input.slot;
        // Drawing (and its slowdown) only counts with a bow in hand.
        if (input.draw && player.held() !== ITEM.BOW) input.draw = false;
        const prevY = player.state.y;
        stepPlayer(player.state, input, this.world);
        this.checkVoid(player);
        if (!player.dead) this.trackFall(player, prevY);
        if (player.dead) continue;
        if (input.attack) this.stepAttack(player);
        this.stepBreaking(player, input.breaking);
        if (input.use) this.stepUse(player, input.use);
        else if (input.place) this.stepPlace(player, input.place, input.slot);
        if (input.drop) this.stepDrop(player, input.slot);
        this.stepBow(player, input.draw);
      }
      player.inputQueue.length = 0;
      this.regen(player);
    }

    this.updateFlags();
    this.updateContainers();

    const movedItems = [...this.updateItems(), ...this.updateArrows()];

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
