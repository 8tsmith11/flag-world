// Client entry: connects and says hello, shows the lobby or match-in-progress
// screen, then on WELCOME builds the local world from the server's seed and
// runs fixed-rate input ticks and a per-frame render loop.

import {
  TICK_DT, TICK_RATE, PLAYER_EYE_HEIGHT, REACH_DISTANCE, RESPAWN_DELAY,
  BOW_COOLDOWN, DAY_LENGTH,
  VIEW_DISTANCE, VIEW_DISTANCE_MIN, VIEW_DISTANCE_MAX,
} from '/shared/config.js';
import { C2S, S2C, DEATH_CAUSE, FLAG_EVENT, TEAMS } from '/shared/protocol.js';
import { generateWorld } from '/shared/worldgen.js';
import {
  BLOCK, canBreak, breakTicks, getBlockDef, isTargetable, isWater, isDoor, doorState, isFurnace, isChest, isAnvil, isFlowingWater,
} from '/shared/blocks.js';
import { breakingStats, rangedStats } from '/shared/tools.js';
import { getItemDef, ITEM } from '/shared/items.js';
import { lookDirection, raycastBlock, raycastPlayers } from '/shared/raycast.js';
import { playerBoxOf, eyeHeight } from '/shared/physics.js';
import { Connection } from './net.js';
import { Input } from './input.js';
import { LocalPlayer } from './localPlayer.js';
import { DebugHud } from './debug.js';
import { Hotbar } from './hotbar.js';
import { LobbyScreen, MatchScreen, loadName } from './lobby.js';
import { HealthBar, EventFeed, ProgressBar, Toast, Label } from './hud.js';
import { FreeCamera } from './spectator.js';
import { InventoryScreen, CONTAINERS } from './inventoryScreen.js';
import { createScene, setViewDistance } from './render/scene.js';
import { Clouds } from './render/clouds.js';
import { Sky } from './render/sky.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
import { EntityRenderer } from './render/entityRenderer.js';
import { BlockHighlight } from './render/blockHighlight.js';
import { FlagRenderer } from './render/flagRenderer.js';
import { ViewModel } from './render/viewModel.js';
import { FurnaceEffects } from './render/furnaceEffects.js';
import { GoblinEffects } from './render/goblinEffects.js';
import { GoblinInspector } from './goblinInspector.js';
import { PortalRenderer } from './render/portalRenderer.js';
import { GrappleLine } from './render/grappleLine.js';
import { TurretRenderer } from './render/turretRenderer.js';
import { QuarryEffects } from './render/quarryEffects.js';
import { Sounds } from './sounds.js';

// Cap on ticks simulated in one frame so a long stall doesn't burst-send inputs.
const MAX_TICKS_PER_FRAME = 5;
// Camera shake when you take damage: duration and starting offset in blocks.
const SHAKE_MS = 300;
const SHAKE_AMOUNT = 0.12;

// What the local player is doing in the match:
//   play      alive, sending inputs
//   dead      on the YOU DIED screen, waiting to respawn (or to start spectating)
//   spectate  eliminated, flying the free camera
//   ended     the match is over; the end screen stays up
const MODE = { PLAY: 'play', DEAD: 'dead', SPECTATE: 'spectate', ENDED: 'ended' };

const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const deathScreen = document.getElementById('death');
const deathCause = document.getElementById('death-cause');
const deathPrompt = document.getElementById('death-prompt');

// Client setting, remembered per browser.
const VIEW_DISTANCE_KEY = 'flagWorld.viewDistance';
function loadViewDistance() {
  try {
    const saved = Number(localStorage.getItem(VIEW_DISTANCE_KEY));
    if (saved >= VIEW_DISTANCE_MIN && saved <= VIEW_DISTANCE_MAX) return saved;
  } catch {
    // Storage unavailable; use the default.
  }
  return VIEW_DISTANCE;
}
let viewDistance = loadViewDistance();

const { renderer, scene, camera, ambient, sun } = createScene(viewDistance);
const sky = new Sky(scene, { ambient, sun });
// The match clock, for the time of day: the time of day and tick from
// WELCOME, and the latest server tick and when it arrived (performance.now()),
// so time runs on smoothly between messages.
let dayClock = null;
const input = new Input(renderer.domElement);
const debug = new DebugHud(document.getElementById('debug'));
const hotbar = new Hotbar(document.getElementById('hotbar'));
const health = new HealthBar(document.getElementById('health'));
const feed = new EventFeed(document.getElementById('feed'));
const grabBar = new ProgressBar(document.getElementById('grab'));
const toast = new Toast(document.getElementById('toast'));
const carryLabel = new Label(document.getElementById('carry'));
const entities = new EntityRenderer(scene);
const portals = new PortalRenderer(scene);
const turretRenderer = new TurretRenderer(scene);
const goblinEffects = new GoblinEffects(scene);
const goblinInspector = new GoblinInspector();
// The local player's grappling hook rope (remote players' are on their models).
const grappleLine = new GrappleLine(scene);
const sounds = new Sounds();
document.addEventListener('pointerdown', () => sounds.unlock());
const flags = new FlagRenderer(scene, entities);
const highlight = new BlockHighlight(scene);
const freeCamera = new FreeCamera();
const conn = new Connection(`ws://${location.host}`);
const lobby = new LobbyScreen(conn);
const matchScreen = new MatchScreen(conn);
const inventoryScreen = new InventoryScreen(conn);
const creativeLabel = document.getElementById('creative-label');
function setCreative(enabled) {
  creativeLabel.hidden = !enabled;
  inventoryScreen.setCreative(enabled);
  if (player) {
    player.state.creative = enabled;
    if (!enabled) player.state.flying = false;
  }
}
creativeLabel.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!input.locked) conn.send({ type: C2S.CREATIVE_TOGGLE });
});

// No visible hint: double-click either title, then the four screen corners.
let titleClickAt = -Infinity;
let secretStep = -1;
let secretDeadline = 0;
for (const title of document.querySelectorAll('.secret-title')) {
  title.addEventListener('click', (event) => {
    event.stopPropagation();
    const now = performance.now();
    if (now - titleClickAt <= 400) {
      secretStep = 0;
      secretDeadline = now + 3000;
      titleClickAt = -Infinity;
    } else titleClickAt = now;
  });
}
document.addEventListener('click', (event) => {
  if (secretStep < 0 || event.target.closest('.secret-title')) return;
  if (event.target.closest('#creative-label')) { secretStep = -1; return; }
  event.preventDefault();
  event.stopPropagation();
  const quadrant = Number(event.clientX >= innerWidth / 2) + 2 * Number(event.clientY >= innerHeight / 2);
  if (performance.now() > secretDeadline || quadrant !== [0, 1, 3, 2][secretStep]) {
    secretStep = -1;
    return;
  }
  if (++secretStep === 4) {
    secretStep = -1;
    conn.send({ type: C2S.CREATIVE_TOGGLE });
  }
}, true);
// First-person arm, created on WELCOME in the player's color.
let viewModel = null;

let world = null;
let chunks = null;
let clouds = null;
let furnaceEffects = null;
let quarryEffects = null;
let player = null;
let seed = 0;
let connected = true;
let mode = MODE.PLAY;
// Latest server snapshot of the local player.
let self = null;
// Latest inventory from the server: { slots, cursor }.
let inventory = { slots: [], cursor: null };
// Block under the crosshair this frame, or null.
let target = null;
// Id of the player under the crosshair (in reach, in front of any block), or null.
let targetPlayer = null;
// Local mirror of the server's break progress, for display: { x, y, z, ticks } or null.
let breaking = null;
// Player id -> name, for the kill feed.
const names = new Map();
const playerTeams = new Map();
const flagTeams = new Map();
let shakeUntil = 0;
// Bow draw, mirrored from the server's rules for the arm, string and zoom:
// ticks drawn, and the local tick count before which a new draw doesn't build.
let drawTicks = 0;
let drawReadyAt = 0;
let localTick = 0;
const BOW_COOLDOWN_TICKS = Math.round(BOW_COOLDOWN * TICK_RATE);
// Crossbow loading, mirrored from the server's rules (Game.stepCrossbow) for
// the arm, bolt and zoom, and to know when a click fires.
let loadTicks = 0;
let crossbowLoaded = false;
let loadNeedsRelease = false;
// Base field of view, and how much a full draw zooms in.
const FOV = 75;
const DRAW_ZOOM = 10;
// Camera height above the feet, eased toward eyeHeight() as the player crouches.
let eyeOffset = PLAYER_EYE_HEIGHT;
const EYE_EASE = 14;
// On the death screen: when the click unlocks (performance.now() ms), whether
// it leads to spectating (eliminated) or a respawn, and whether we've asked.
let respawnAt = 0;
let eliminated = false;
let respawnRequested = false;

// One full-screen panel at a time: 'overlay' (connecting / click to play /
// disconnected), 'lobby', 'match', 'death', 'end', or null while playing with
// the mouse locked.
let currentScreen = 'overlay';
function showScreen(id) {
  currentScreen = id;
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
}

// Modes where the mouse drives the game; Esc brings up the click-to-continue overlay.
function lockable() {
  return player && connected && !inventoryScreen.open && (mode === MODE.PLAY || mode === MODE.SPECTATE);
}

overlay.addEventListener('click', () => {
  if (lockable()) input.requestLock();
});
// After a menu closes with Esc (which can't recapture the mouse), a click on
// the game itself resumes.
renderer.domElement.addEventListener('click', () => {
  if (lockable() && currentScreen === null) input.requestLock();
});
const resumeHint = document.getElementById('resume-hint');
input.onLockChange = (locked) => {
  if (lockable()) showScreen(locked ? null : 'overlay');
};

// E opens the inventory (freeing the mouse); E closes it and goes back to
// playing. Esc closes it too, back to the game rather than the pause overlay,
// but browsers don't let Esc recapture the mouse, so it waits for a click.
input.onKey = (code) => {
  if (code === 'KeyE' && mode === MODE.PLAY) openInventory('inventory', null);
};

// View distance slider on the click-to-play overlay.
const viewDistanceInput = document.getElementById('view-distance');
const viewDistanceValue = document.getElementById('view-distance-value');
viewDistanceInput.min = VIEW_DISTANCE_MIN;
viewDistanceInput.max = VIEW_DISTANCE_MAX;
viewDistanceInput.value = viewDistance;
viewDistanceValue.textContent = viewDistance;
viewDistanceInput.addEventListener('input', () => {
  viewDistance = Number(viewDistanceInput.value);
  viewDistanceValue.textContent = viewDistance;
  try {
    localStorage.setItem(VIEW_DISTANCE_KEY, String(viewDistance));
  } catch {
    // Not remembered; still applies now.
  }
  setViewDistance(scene, camera, viewDistance, sky.fogScale);
  if (chunks) chunks.setViewDistance(viewDistance);
});
// Using the settings shouldn't count as a click to play.
document.getElementById('settings').addEventListener('click', (e) => e.stopPropagation());
window.addEventListener('keydown', (e) => {
  // Still locked means this is the same E press that just opened it.
  if (!inventoryScreen.open || e.repeat || input.locked) return;
  if (e.code === 'KeyE') closeInventory(true);
  else if (e.code === 'Escape') closeInventory(false);
});

// screen: 'inventory', 'workbench', 'furnace' or 'chest'; at: that block.
function openInventory(screen, at) {
  // Visible first: the preview sizes itself from its canvas.
  showScreen('inventory');
  inventoryScreen.show(player.color, screen, at);
  document.exitPointerLock();
}

// What kind of screen right-clicking this block opens, or null.
function stationKind(id) {
  if (id === BLOCK.WORKBENCH) return 'workbench';
  if (isFurnace(id)) return 'furnace';
  if (isChest(id)) return 'chest';
  if (isAnvil(id)) return 'anvil';
  return null;
}

// A workbench, furnace or chest screen closes if its block is gone or out of reach.
function checkContainer() {
  const at = inventoryScreen.open && inventoryScreen.at;
  if (!at) return;
  const s = player.state;
  const far = Math.hypot(at.x + 0.5 - s.x, at.y + 0.5 - (s.y + eyeHeight(s)), at.z + 0.5 - s.z) > REACH_DISTANCE + 1;
  if (far || stationKind(world.getBlock(at.x, at.y, at.z)) !== inventoryScreen.mode) closeInventory(false);
}

// relock: capture the mouse again right away (only possible from a gesture
// like the E key); otherwise the game shows "click to resume".
function closeInventory(relock, tellServer = true) {
  if (!inventoryScreen.open) return;
  inventoryScreen.hide(tellServer);
  showScreen(null);
  if (relock) input.requestLock();
}

function setInventory(inv) {
  inventory = inv;
  if (player) player.state.accessory = inv.accessory?.item ?? null;
  hotbar.setInventory(inv.slots);
  inventoryScreen.update(inv);
}

// Item id in hand (the selected hotbar slot), or null.
function heldItem() {
  return inventory.slots[input.slot]?.item ?? null;
}

// { strength, speed } for breaking with what's in hand.
// The stack in hand (with its modifiers), or null.
function heldStack() {
  return inventory.slots[input.slot] ?? null;
}

function heldTool() {
  return breakingStats(heldStack());
}

deathScreen.addEventListener('click', () => {
  if (mode !== MODE.DEAD || respawnRequested || performance.now() < respawnAt || !connected) return;
  if (eliminated) {
    startSpectating();
  } else {
    respawnRequested = true;
    conn.send({ type: C2S.RESPAWN });
  }
  // The click is a user gesture, so we can grab the mouse again right away.
  input.requestLock();
});

function nameOf(id) {
  return names.get(id) ?? `Player ${id}`;
}

function deathText({ id, killerId, cause }) {
  const victim = nameOf(id);
  const killer = killerId === null ? null : nameOf(killerId);
  if (cause === DEATH_CAUSE.VOID) return killer ? `${killer} knocked ${victim} into the void` : `${victim} fell into the void`;
  if (cause === DEATH_CAUSE.FALL && !killer) return `${victim} fell from a high place`;
  return `${killer} killed ${victim}`;
}

// msg: the DEATH message, or null when we learn it from a snapshot (reclaiming a dead player).
function enterDeath(msg, isEliminated) {
  // The server has already dropped everything, cursor stack included.
  closeInventory(false, false);
  mode = MODE.DEAD;
  drawTicks = 0;
  stepCrossbow(false, false, false);
  eliminated = isEliminated;
  respawnRequested = false;
  respawnAt = performance.now() + RESPAWN_DELAY * 1000;
  breaking = null;
  let cause = '';
  if (msg?.cause === DEATH_CAUSE.VOID) cause = msg.killerId === null ? 'You fell into the void' : `${nameOf(msg.killerId)} knocked you into the void`;
  else if (msg?.cause === DEATH_CAUSE.FALL && msg.killerId === null) cause = 'You fell from a high place';
  else if (msg) cause = `Killed by ${nameOf(msg.killerId)}`;
  deathCause.textContent = eliminated ? `${cause}${cause ? '. ' : ''}You have no flag, so you are eliminated.` : cause;
  document.body.classList.add('dead');
  document.exitPointerLock();
  showScreen('death');
}

function leaveDeath(snapshot) {
  mode = MODE.PLAY;
  document.body.classList.remove('dead');
  deathScreen.classList.remove('ready');
  // Drop anything pressed on the death screen and restart the tick clock.
  input.release();
  accumulator = 0;
  player.teleport(snapshot);
  showScreen(input.locked ? null : 'overlay');
}

function startSpectating() {
  mode = MODE.SPECTATE;
  document.body.classList.remove('dead');
  document.body.classList.add('spectating');
  const { x, y, z } = player.state;
  freeCamera.start(x, y + PLAYER_EYE_HEIGHT, z);
  status.textContent = 'Click to spectate';
  showScreen(input.locked ? null : 'overlay');
}

function endMatch(winnerId, winnerTeam, members = []) {
  closeInventory(false);
  mode = MODE.ENDED;
  document.body.classList.remove('dead');
  document.getElementById('end-title').textContent = `${TEAMS[winnerTeam]?.name ?? 'Team'} wins!`;
  document.getElementById('end-sub').textContent = members.join(', ');
  document.exitPointerLock();
  showScreen('end');
}

conn.onOpen(() => conn.send({ type: C2S.HELLO, name: loadName() }));

conn.on(S2C.LOBBY, (msg) => {
  lobby.update(msg);
  showScreen('lobby');
});

conn.on(S2C.MATCH_IN_PROGRESS, (msg) => {
  matchScreen.update(msg);
  showScreen('match');
});

conn.on(S2C.ERROR, (msg) => {
  status.textContent = msg.message;
  lobby.showError(msg.message);
  matchScreen.showError(msg.message);
});

// Building the world takes a moment, so show a message first and hold any
// messages that arrive meanwhile until it's done.
conn.on(S2C.WELCOME, (msg) => {
  conn.pause();
  status.textContent = 'Generating world…';
  showScreen('overlay');
  setTimeout(() => {
    startGame(msg);
    conn.resume();
  }, 30);
});

function startGame(msg) {
  seed = msg.seed;
  dayClock = { baseTime: msg.dayTime, baseTick: msg.tick, tick: msg.tick, at: performance.now() };
  world = generateWorld(msg.seed, msg.teamCount, msg.worldSize);
  for (const b of msg.blocks) world.setBlock(b.x, b.y, b.z, b.id);
  for (const { key, team } of msg.doorTeams ?? []) world.doorTeams.set(key, team);
  turretRenderer.sync(msg.turrets);
  chunks = new ChunkRenderer(scene, world, viewDistance);
  clouds = new Clouds(scene, world);
  furnaceEffects = new FurnaceEffects(scene, world);
  quarryEffects = new QuarryEffects(scene, world);
  for (const { x, y, z, id } of msg.blocks) {
    if (id === BLOCK.QUARRY_STONE) quarryEffects.changed(x, y, z, id);
  }
  for (const { x, y, z } of msg.litFurnaces ?? []) furnaceEffects.setLit(x, y, z, true);
  for (const portal of msg.portals ?? []) portals.add(portal);
  self = msg.players.find((p) => p.id === msg.id);
  player = new LocalPlayer(msg.id, msg.color, self, world);
  setCreative(!!msg.creative);
  inventoryScreen.setCreativeState({ immortal: !!msg.immortal, flying: !!msg.flying,
    totemExists: !!msg.totemExists });
  for (const p of msg.players) {
    names.set(p.id, p.name);
    playerTeams.set(p.id, p.team);
    if (p.id !== msg.id) entities.add(p.id, p);
  }
  for (const f of msg.flags) { flags.add(f); flagTeams.set(f.id, f.team); }
  health.set(self.hp, self.maxHp);
  for (const e of msg.entities) {
    if (e.name) names.set(e.id, e.name);
    entities.add(e.id, e);
  }
  setInventory(msg.inventory);
  viewModel = new ViewModel(player.color);
  status.textContent = 'Click to play';
  document.body.classList.add('in-game');
  showScreen('overlay');
  if (self.eliminated) startSpectating();
  else if (self.dead) enterDeath(null, false);
  if (msg.winnerId !== null) endMatch(msg.winnerId, msg.winnerTeam, msg.winnerMembers);
  requestAnimationFrame(frame);
}

conn.on(S2C.DAMAGE, (msg) => {
  if (msg.id === player?.id) {
    shakeUntil = performance.now() + SHAKE_MS;
    health.set(msg.hp, self?.maxHp);
  } else {
    entities.flash(msg.id);
    entities.setHp(msg.id, msg.hp);
  }
});

conn.on(S2C.CHAT, (msg) => feed.add(msg.text, msg.kind === 'event' ? 'event' : ''));
conn.on(S2C.GOBLIN_STATUS, (msg) => goblinInspector.setStatus(msg));
conn.on(S2C.GOBLIN_TOTEM_DESTROYED, (msg) => goblinEffects.totemBurst(msg.x, msg.y, msg.z));

conn.on(S2C.DEATH, (msg) => {
  const colors = [msg.id, msg.killerId].filter((id) => id !== null).map((id) =>
    ({ name: nameOf(id), color: TEAMS[playerTeams.get(id)]?.color ?? 0xffffff }));
  if (msg.eliminated) feed.add(`☠ ${deathText(msg)} — ELIMINATED`, 'elim', colors);
  else feed.add(deathText(msg), '', colors);
  if (msg.id === player?.id && mode !== MODE.ENDED) enterDeath(msg, msg.eliminated);
});

// Grab, drop and return are silent in the feed; the owner gets a private notice.
conn.on(S2C.FLAG_EVENT, (msg) => {
  const mine = flagTeams.get(msg.flag) === self?.team;
  switch (msg.kind) {
    case FLAG_EVENT.TAKEN:
      if (mine) toast.show('Your flag has been taken!');
      break;
    case FLAG_EVENT.RETURNED:
      flags.puff(msg.flag);
      if (mine) toast.show('Your flag has returned.');
      break;
    case FLAG_EVENT.CAPTURED:
      feed.add(`${nameOf(msg.by)} captured ${TEAMS[flagTeams.get(msg.flag)]?.name}'s flag`, '',
        [{ name: nameOf(msg.by), color: TEAMS[playerTeams.get(msg.by)]?.color ?? 0xffffff },
          { name: TEAMS[flagTeams.get(msg.flag)]?.name, color: TEAMS[flagTeams.get(msg.flag)]?.color ?? 0xffffff }]);
      if (mine) toast.show('Your flag has been captured. You are flagless.');
      break;
  }
});

conn.on(S2C.MATCH_END, (msg) => endMatch(msg.winnerId, msg.winnerTeam, msg.members));

conn.on(S2C.ENTITY_SPAWN, (msg) => {
  if (msg.entity.name) names.set(msg.entity.id, msg.entity.name);
  entities.add(msg.entity.id, msg.entity);
});
conn.on(S2C.ENTITY_DESPAWN, (msg) => entities.remove(msg.id));
conn.on(S2C.PORTAL_SPAWN, (msg) => portals.add(msg.portal));
conn.on(S2C.PORTAL_DESPAWN, (msg) => portals.remove(msg.id));
conn.on(S2C.EMBER_BURST, (msg) => portals.burst(msg.x, msg.y, msg.z));
conn.on(S2C.QUARRY_PUFF, (msg) => quarryEffects?.puff(msg.x, msg.y, msg.z));
conn.on(S2C.CREATIVE, (msg) => {
  setCreative(msg.enabled);
  inventoryScreen.setCreativeState(msg);
  if (player) player.state.flying = !!msg.flying;
});
conn.on(S2C.DAY_TIME, (msg) => {
  dayClock = { baseTime: msg.dayTime, baseTick: msg.tick, tick: msg.tick, at: performance.now() };
});
conn.on(S2C.INVENTORY, (msg) => setInventory({ slots: msg.slots, cursor: msg.cursor,
  armor: msg.armor, accessory: msg.accessory }));
conn.on(S2C.SWING, (msg) => entities.swing(msg.id));
conn.on(S2C.CONTAINER, (msg) => {
  const at = inventoryScreen.at;
  if (inventoryScreen.open && inventoryScreen.mode === msg.kind && at.x === msg.x && at.y === msg.y && at.z === msg.z) {
    inventoryScreen.setContainer(msg);
  }
});
conn.on(S2C.CONTAINER_CLOSE, () => {
  if (inventoryScreen.open && CONTAINERS.includes(inventoryScreen.mode)) closeInventory(false);
});
conn.on(S2C.FURNACE_LIT, (msg) => furnaceEffects?.setLit(msg.x, msg.y, msg.z, msg.lit));

conn.on(S2C.BLOCK_CHANGE, (msg) => {
  if (!world) return;
  if (msg.team !== undefined) {
    const door = isDoor(msg.id) ? doorState(msg.id) : doorState(world.getBlock(msg.x, msg.y, msg.z));
    const key = `${msg.x},${door.upper ? msg.y - 1 : msg.y},${msg.z}`;
    if (msg.team === null) world.doorTeams.delete(key);
    else world.doorTeams.set(key, msg.team);
  }
  const oldId = world.getBlock(msg.x, msg.y, msg.z);
  if (oldId !== BLOCK.AIR && msg.id === BLOCK.AIR) sounds.blockBreak(oldId,
    { x: msg.x + 0.5, y: msg.y + 0.5, z: msg.z + 0.5 }, camera.position);
  if (isFurnace(oldId) && !isFurnace(msg.id)) {
    furnaceEffects?.setLit(msg.x, msg.y, msg.z, false);
  }
  world.setBlock(msg.x, msg.y, msg.z, msg.id);
  if (oldId === BLOCK.QUARRY_STONE || msg.id === BLOCK.QUARRY_STONE) {
    quarryEffects?.changed(msg.x, msg.y, msg.z, msg.id);
  }
});

conn.on(S2C.STATE, (msg) => {
  if (!player) return;
  turretRenderer.sync(msg.turrets);
  dayClock.tick = msg.tick;
  dayClock.at = performance.now();
  flags.setStates(msg.flags);
  for (const e of msg.entities) {
    if (e.id !== player.id) {
      entities.pushSnapshot(e.id, e);
      continue;
    }
    self = e;
    health.set(e.hp, e.maxHp);
    inventoryScreen.setCreativeState({ flying: !!e.flying });
    if (mode === MODE.DEAD && !e.dead) leaveDeath(e);
    else if (mode === MODE.PLAY) {
      if (Math.hypot(e.x - player.state.x, e.y - player.state.y, e.z - player.state.z) > 8) player.teleport(e);
      else player.reconcile(e);
    }
  }
});

conn.onClose(() => {
  status.textContent = 'Disconnected from server. Refresh to reconnect.';
  connected = false;
  showScreen('overlay');
  document.exitPointerLock();
});

let lastTime = performance.now();
let accumulator = 0;

// Block to mine this tick, counting progress the same way the server does. The
// server makes the final call; skipping blocks it would refuse saves bandwidth.
function breakTarget() {
  const tool = heldTool();
  if (!input.primaryDown || targetPlayer !== null || !target || !canBreak(target.id, tool.strength)) {
    breaking = null;
    return null;
  }
  const { x, y, z } = target;
  if (sameBlock(breaking, target)) breaking.ticks = Math.min(breaking.ticks + 1, breakTicks(target.id, tool.speed));
  else breaking = { x, y, z, ticks: 1 };
  if (breaking.ticks % 5 === 1) sounds.blockHit(target.id,
    { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, camera.position);
  return { x, y, z };
}

// Air cell against the targeted face, where a right click places a block, and
// that face's normal (ladders need to know which side they hang on).
function placeTarget() {
  if (!target || (target.nx === 0 && target.ny === 0 && target.nz === 0)) return null;
  if (isFlowingWater(target.id)) return { x: target.x, y: target.y, z: target.z, nx: target.nx, ny: target.ny, nz: target.nz };
  const { nx, ny, nz } = target;
  return { x: target.x + nx, y: target.y + ny, z: target.z + nz, nx, ny, nz };
}

// One tick of the crossbow mirror; see Game.stepCrossbow.
function stepCrossbow(held, load, fire) {
  if (!held) {
    loadTicks = 0;
    crossbowLoaded = loadNeedsRelease = false;
  } else if (fire && crossbowLoaded) {
    loadTicks = 0;
    crossbowLoaded = false;
    loadNeedsRelease = load;
  } else if (!load) {
    loadNeedsRelease = false;
    if (!crossbowLoaded) loadTicks = 0;
  } else if (!crossbowLoaded && !loadNeedsRelease && ++loadTicks >= rangedStats(heldStack()).loadTicks) {
    crossbowLoaded = true;
  }
}

// How far the bow in hand is drawn or the crossbow loaded, 0..1.
function drawAmount() {
  const ranged = rangedStats(heldStack());
  if (heldItem() === ITEM.CROSSBOW) return crossbowLoaded ? 1 : Math.min(1, loadTicks / ranged.loadTicks);
  return Math.min(1, drawTicks / ranged.fullDrawTicks);
}

function sameBlock(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

function updateDeathPrompt(now) {
  const ready = now >= respawnAt;
  deathScreen.classList.toggle('ready', ready && !respawnRequested);
  if (respawnRequested) deathPrompt.textContent = 'Respawning…';
  else if (ready) deathPrompt.textContent = eliminated ? 'Click to spectate' : 'Click to respawn';
  else deathPrompt.textContent = `${eliminated ? 'Spectate' : 'Respawn'} in ${Math.ceil((respawnAt - now) / 1000)}…`;
}

function updateFlagHud() {
  const playing = mode === MODE.PLAY;
  grabBar.set(playing ? self.grab : 0);
  if (!playing || self.carrying === null) {
    carryLabel.set('');
    return;
  }
  carryLabel.set(`Carrying ${TEAMS[flagTeams.get(self.carrying)]?.name}'s flag — bring it to your pedestal`);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  accumulator += dt;
  input.update(dt);
  accumulator = Math.min(accumulator, TICK_DT * MAX_TICKS_PER_FRAME);

  const playing = mode === MODE.PLAY;
  if (!playing) accumulator = 0;
  while (accumulator >= TICK_DT) {
    accumulator -= TICK_DT;
    const controls = input.sample();
    localTick++;
    // Holding a bow, right click (held) draws it instead of placing or using;
    // holding a crossbow, it loads it, and once loaded either click fires.
    // A grappling hook fires on right click.
    const bow = heldItem() === ITEM.BOW;
    const crossbow = heldItem() === ITEM.CROSSBOW;
    const hook = heldItem() === ITEM.GRAPPLING_HOOK;
    const aiming = bow || crossbow || hook;
    controls.draw = (bow || crossbow) && input.secondaryDown;
    controls.fire = crossbow && crossbowLoaded && (controls.attack || controls.place);
    stepCrossbow(crossbow, controls.draw, controls.fire);
    if (controls.fire) {
      controls.attack = false;
      viewModel.push();
    }
    // The shared physics decides whether it fires (cooldown, flag, already pulling).
    controls.hook = hook && controls.place;
    if (controls.hook && !player.state.grapple && !player.state.carrying && !(player.state.hookCooldown > 1)) viewModel.push();
    controls.eat = !!getItemDef(heldItem()).food && input.secondaryDown;
    if (controls.eat) controls.place = false;
    controls.glide = heldItem() === ITEM.GLIDER && input.secondaryDown;
    if (controls.glide) controls.place = false;
    controls.rift = heldItem() === ITEM.RIFT_ORB && controls.place;
    if (controls.rift) { controls.place = false; viewModel.push(); }
    controls.spawnEgg = getItemDef(heldItem()).mobType && controls.place && target
      ? { x: target.x, y: target.y, z: target.z } : null;
    if (controls.spawnEgg) { controls.place = false; viewModel.push(); }
    if (controls.draw) {
      if (localTick >= drawReadyAt) drawTicks++;
    } else {
      if (drawTicks >= rangedStats(heldStack()).minDrawTicks) drawReadyAt = localTick + BOW_COOLDOWN_TICKS;
      drawTicks = 0;
    }
    // Any click swings the arm; it only punches with a player under the crosshair.
    if (controls.attack) viewModel.swing();
    controls.attack = controls.attack && targetPlayer !== null;
    controls.breaking = breakTarget();
    // Right click on a workbench, furnace or chest opens its screen instead of placing.
    const station = controls.place && target && stationKind(target.id);
    if (station) {
      const at = { x: target.x, y: target.y, z: target.z };
      if (CONTAINERS.includes(station)) conn.send({ type: C2S.OPEN_CONTAINER, ...at });
      openInventory(station, at);
      controls.place = false;
    }
    // Right click on a door opens or closes it instead of placing.
    const useTarget = controls.place && target && (isDoor(target.id) || (target.id === BLOCK.WATER && heldItem() === ITEM.EMPTY_BUCKET));
    controls.use = useTarget ? { x: target.x, y: target.y, z: target.z } : null;
    controls.place = controls.place && !useTarget && !aiming ? placeTarget() : null;
    if (aiming) controls.use = null;
    const held = heldItem();
    const placing = controls.place && held !== null && (getItemDef(held).block !== null || getItemDef(held).places);
    if (useTarget || placing) viewModel.push();
    conn.send({ type: C2S.INPUT, ...player.tick(controls) });
  }

  const pos = player.renderPosition(accumulator / TICK_DT);
  if (document.body.classList.contains('spectating')) {
    if (mode === MODE.SPECTATE && input.locked) freeCamera.update(dt, input);
    const f = freeCamera.position;
    camera.position.set(f.x, f.y, f.z);
  } else {
    // Ease the eyes down and up when crouching.
    eyeOffset += (eyeHeight(player.state) - eyeOffset) * Math.min(1, dt * EYE_EASE);
    camera.position.set(pos.x, pos.y + eyeOffset, pos.z);
  }
  camera.rotation.set(input.pitch, input.yaw, 0);

  const dir = lookDirection(input.yaw, input.pitch);
  const block = playing ? raycastBlock(world, camera.position, dir, REACH_DISTANCE, isTargetable) : null;
  const combatBlock = playing ? raycastBlock(world, camera.position, dir, REACH_DISTANCE, (id) => isTargetable(id) && !isWater(id)) : null;
  const hit = playing ? raycastPlayers(camera.position, dir, combatBlock ? combatBlock.t : REACH_DISTANCE,
    entities.attackTargets(), (p) => playerBoxOf(p.state)) : null;
  targetPlayer = hit ? hit.player.id : null;
  // Creative players inspecting the Goblin Totem.
  const inspecting = playing && !!player?.state.creative && goblinInspector.status?.totemId != null;
  const lookBlock = inspecting ? raycastBlock(world, camera.position, dir, 48, (id) => isTargetable(id) && !isWater(id)) : null;
  goblinInspector.update(inspecting, inspecting ? entities.object(goblinInspector.status.totemId)?.position : null,
    camera.position, dir, lookBlock?.t);
  // Only buckets target water. Other actions reach the block behind it.
  const bucket = heldItem() === ITEM.EMPTY_BUCKET || heldItem() === ITEM.WATER_BUCKET;
  target = hit ? null : bucket ? block : combatBlock;
  // Looking away (or the block breaking) resets progress, as on the server.
  if (!sameBlock(breaking, target)) breaking = null;
  highlight.update(target, breaking ? breaking.ticks / breakTicks(target.id, heldTool().speed) : 0);
  checkContainer();

  if (now < shakeUntil) {
    const amount = SHAKE_AMOUNT * (shakeUntil - now) / SHAKE_MS;
    camera.position.x += (Math.random() - 0.5) * 2 * amount;
    camera.position.y += (Math.random() - 0.5) * 2 * amount;
    camera.position.z += (Math.random() - 0.5) * 2 * amount;
  }
  if (mode === MODE.DEAD) updateDeathPrompt(now);
  resumeHint.hidden = !(lockable() && currentScreen === null && !input.locked);
  updateFlagHud();

  hotbar.select(input.slot);
  // Zoom in a little as a bow is drawn or while a crossbow is loaded.
  const fov = FOV - DRAW_ZOOM * (playing ? drawAmount() : 0);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }

  chunks.update(camera.position.x, camera.position.z);
  clouds?.update(dt);
  // Day and night, from the match clock.
  if (dayClock) {
    const ticks = dayClock.tick - dayClock.baseTick + Math.min(1, (now - dayClock.at) / 1000 * TICK_RATE);
    const time = (dayClock.baseTime + ticks / (DAY_LENGTH * TICK_RATE)) % 1;
    sky.update(time, camera);
    setViewDistance(scene, camera, viewDistance, sky.fogScale);
    clouds?.setTint(sky.tint);
  }
  furnaceEffects?.update(dt, camera.position, chunks.viewDistance);
  quarryEffects?.update(dt, camera.position, chunks.viewDistance);
  portals.update(dt, camera);
  goblinEffects.update(dt);
  entities.update(dt);
  turretRenderer.update(dt);
  sounds.update(dt, camera.position, player.state, world, entities,
    input.doubleTapSprint || input.keys.has('ControlLeft') || input.keys.has('ControlRight'));
  flags.update(dt, player.id, pos);
  // The hook's rope runs from about the right hand to where it caught.
  const grapple = playing ? player.state.grapple : null;
  grappleLine.update(grapple && { x: camera.position.x + Math.cos(input.yaw) * 0.3,
    y: camera.position.y - 0.4, z: camera.position.z - Math.sin(input.yaw) * 0.3 }, grapple);
  // Frost from an Ice Sword hit rims the screen while it slows you.
  document.body.classList.toggle('frosted', playing && player.state.slowTicks > 0);
  renderer.render(scene, camera);
  if (playing && !inventoryScreen.open) {
    const s = player.state;
    viewModel.update(dt, {
      look: { yaw: input.yaw, pitch: input.pitch },
      speed: s.onGround ? Math.hypot(s.vx, s.vz) : 0,
      mining: breaking !== null,
      held: heldItem(),
      draw: drawAmount(),
      gliding: s.gliding,
    });
    viewModel.render(renderer);
  }
  inventoryScreen.render(dt, heldItem());

  debug.update({
    position: pos,
    chunks: chunks.loadedCount,
    players: entities.playerTargets().length + 1,
    id: player.id,
    seed,
    target: target && `${getBlockDef(target.id).name} ${target.x} ${target.y} ${target.z}`,
  });
}
