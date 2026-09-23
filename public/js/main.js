// Client entry: connects and says hello, shows the lobby or match-in-progress
// screen, then on WELCOME builds the local world from the server's seed and
// runs fixed-rate input ticks and a per-frame render loop.

import {
  DEBUG, TICK_DT, PLAYER_EYE_HEIGHT, REACH_DISTANCE, RESPAWN_DELAY,
  VIEW_DISTANCE, VIEW_DISTANCE_MIN, VIEW_DISTANCE_MAX,
} from '/shared/config.js';
import { C2S, S2C, DEATH_CAUSE, FLAG_STATE, FLAG_EVENT } from '/shared/protocol.js';
import { generateWorld } from '/shared/worldgen.js';
import {
  BLOCK, canBreak, breakTicks, getBlockDef, isTargetable, isDoor, isFurnace, isChest,
} from '/shared/blocks.js';
import { breakingStats } from '/shared/tools.js';
import { getItemDef } from '/shared/items.js';
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
import { createScene, setViewDistance, setFogEnabled } from './render/scene.js';
import { Clouds } from './render/clouds.js';
import { Overview } from './render/overview.js';
import { ChunkRenderer } from './render/chunkRenderer.js';
import { EntityRenderer } from './render/entityRenderer.js';
import { BlockHighlight } from './render/blockHighlight.js';
import { FlagRenderer } from './render/flagRenderer.js';
import { ViewModel } from './render/viewModel.js';

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

const { renderer, scene, camera } = createScene(viewDistance);
const input = new Input(renderer.domElement);
const debug = new DebugHud(document.getElementById('debug'));
const hotbar = new Hotbar(document.getElementById('hotbar'));
const health = new HealthBar(document.getElementById('health'));
const feed = new EventFeed(document.getElementById('feed'));
const grabBar = new ProgressBar(document.getElementById('grab'));
const toast = new Toast(document.getElementById('toast'));
const carryLabel = new Label(document.getElementById('carry'));
const entities = new EntityRenderer(scene);
const flags = new FlagRenderer(scene, entities);
const highlight = new BlockHighlight(scene);
const freeCamera = new FreeCamera();
const conn = new Connection(`ws://${location.host}`);
const lobby = new LobbyScreen(conn);
const matchScreen = new MatchScreen(conn);
const inventoryScreen = new InventoryScreen(conn);
// First-person arm, created on WELCOME in the player's color.
let viewModel = null;

let world = null;
let chunks = null;
let clouds = null;
// Debug top-down view of the whole world, or null when off.
let overview = null;
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
let shakeUntil = 0;
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
  if (code === 'KeyM' && DEBUG && world) toggleOverview();
};

function toggleOverview() {
  overview = overview ? null : new Overview(world);
  chunks.setViewDistance(overview ? Infinity : viewDistance, !!overview);
  setFogEnabled(scene, !overview, viewDistance);
  if (clouds) clouds.visible = !overview;
}

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
  setViewDistance(scene, camera, viewDistance);
  if (chunks && !overview) chunks.setViewDistance(viewDistance);
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
  hotbar.setInventory(inv.slots);
  inventoryScreen.update(inv);
}

// Item id in hand (the selected hotbar slot), or null.
function heldItem() {
  return inventory.slots[input.slot]?.item ?? null;
}

// { strength, speed } for breaking with what's in hand.
function heldTool() {
  return breakingStats(heldItem());
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

function flagless() {
  return flags.get(player.id)?.state.state === FLAG_STATE.CAPTURED;
}

// msg: the DEATH message, or null when we learn it from a snapshot (reclaiming a dead player).
function enterDeath(msg, isEliminated) {
  // The server has already dropped everything, cursor stack included.
  closeInventory(false, false);
  mode = MODE.DEAD;
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

function endMatch(winnerId) {
  closeInventory(false);
  mode = MODE.ENDED;
  document.body.classList.remove('dead');
  document.getElementById('end-title').textContent = winnerId === player.id ? 'You win!' : `${nameOf(winnerId)} wins!`;
  document.getElementById('end-sub').textContent = 'Last player standing.';
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
  world = generateWorld(msg.seed, msg.playerCount, msg.worldSize);
  for (const b of msg.blocks) world.setBlock(b.x, b.y, b.z, b.id);
  chunks = new ChunkRenderer(scene, world, viewDistance);
  // The Test world is a low slab; clouds are for the island worlds.
  if (msg.worldSize !== 'test') clouds = new Clouds(scene, world);
  self = msg.players.find((p) => p.id === msg.id);
  player = new LocalPlayer(msg.id, msg.color, self, world);
  for (const p of msg.players) {
    names.set(p.id, p.name);
    if (p.id !== msg.id) entities.add(p.id, p);
  }
  for (const f of msg.flags) flags.add(f);
  health.set(self.hp);
  for (const e of msg.entities) entities.add(e.id, e);
  setInventory(msg.inventory);
  viewModel = new ViewModel(player.color);
  status.textContent = 'Click to play';
  document.body.classList.add('in-game');
  showScreen('overlay');
  if (self.eliminated) startSpectating();
  else if (self.dead) enterDeath(null, false);
  if (msg.winnerId !== null) endMatch(msg.winnerId);
  requestAnimationFrame(frame);
}

conn.on(S2C.DAMAGE, (msg) => {
  if (msg.id === player?.id) {
    shakeUntil = performance.now() + SHAKE_MS;
    health.set(msg.hp);
  } else {
    entities.flash(msg.id);
  }
});

conn.on(S2C.DEATH, (msg) => {
  if (msg.eliminated) feed.add(`☠ ${deathText(msg)} — ELIMINATED`, 'elim');
  else feed.add(deathText(msg));
  if (msg.id === player?.id && mode !== MODE.ENDED) enterDeath(msg, msg.eliminated);
});

// Grab, drop and return are silent in the feed; the owner gets a private notice.
conn.on(S2C.FLAG_EVENT, (msg) => {
  const mine = msg.flag === player?.id;
  switch (msg.kind) {
    case FLAG_EVENT.TAKEN:
      if (mine) toast.show('Your flag has been taken!');
      break;
    case FLAG_EVENT.RETURNED:
      flags.puff(msg.flag);
      if (mine) toast.show('Your flag has returned.');
      break;
    case FLAG_EVENT.CAPTURED:
      feed.add(`${nameOf(msg.by)} captured ${nameOf(msg.flag)}'s flag`);
      if (mine) toast.show('Your flag has been captured. You are flagless.');
      break;
  }
});

conn.on(S2C.MATCH_END, (msg) => endMatch(msg.winnerId));

conn.on(S2C.ENTITY_SPAWN, (msg) => entities.add(msg.entity.id, msg.entity));
conn.on(S2C.ENTITY_DESPAWN, (msg) => entities.remove(msg.id));
conn.on(S2C.INVENTORY, (msg) => setInventory({ slots: msg.slots, cursor: msg.cursor }));
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

conn.on(S2C.BLOCK_CHANGE, (msg) => {
  if (world) world.setBlock(msg.x, msg.y, msg.z, msg.id);
});

conn.on(S2C.STATE, (msg) => {
  if (!player) return;
  flags.setStates(msg.flags);
  for (const e of msg.entities) {
    if (e.id !== player.id) {
      entities.pushSnapshot(e.id, e);
      continue;
    }
    self = e;
    health.set(e.hp);
    if (mode === MODE.DEAD && !e.dead) leaveDeath(e);
    else if (mode === MODE.PLAY) player.reconcile(e);
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
  return { x, y, z };
}

// Air cell against the targeted face, where a right click places a block, and
// that face's normal (ladders need to know which side they hang on).
function placeTarget() {
  if (!target || (target.nx === 0 && target.ny === 0 && target.nz === 0)) return null;
  const { nx, ny, nz } = target;
  return { x: target.x + nx, y: target.y + ny, z: target.z + nz, nx, ny, nz };
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
  const goal = flagless() ? "you have no flag, so you can't capture" : 'bring it to your pedestal';
  carryLabel.set(`Carrying ${nameOf(self.carrying)}'s flag — ${goal}`);
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
    const useDoor = controls.place && target && isDoor(target.id);
    controls.use = useDoor ? { x: target.x, y: target.y, z: target.z } : null;
    controls.place = controls.place && !useDoor ? placeTarget() : null;
    const held = heldItem();
    const placing = controls.place && held !== null && (getItemDef(held).block !== null || getItemDef(held).places);
    if (useDoor || placing) viewModel.push();
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
  const hit = playing ? raycastPlayers(camera.position, dir, block ? block.t : REACH_DISTANCE,
    entities.playerTargets(), (p) => playerBoxOf(p.state)) : null;
  targetPlayer = hit ? hit.player.id : null;
  target = hit ? null : block;
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
  if (overview) chunks.update(world.sizeX / 2, world.sizeZ / 2);
  else chunks.update(camera.position.x, camera.position.z);
  clouds?.update(dt);
  entities.update(dt);
  flags.update(dt, player.id, pos);
  if (overview) {
    overview.fit(camera.aspect);
    renderer.render(scene, overview.camera);
  } else {
    renderer.render(scene, camera);
  }
  if (playing && !inventoryScreen.open && !overview) {
    const s = player.state;
    viewModel.update(dt, {
      look: { yaw: input.yaw, pitch: input.pitch },
      speed: s.onGround ? Math.hypot(s.vx, s.vz) : 0,
      mining: breaking !== null,
      held: heldItem(),
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
