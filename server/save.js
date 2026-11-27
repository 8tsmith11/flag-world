// Saving and loading a match.
//
// A save is the world's seed, size and teams (so generation recreates the
// same terrain) plus everything that changed since: block edits, container
// contents, pipes and tanks, turrets, players and their inventories, flags,
// working monkeys, NPCs, cows, dragons, Crawlers, Void Eels, dropped items,
// the clock, goblin construction progress, the living goblins in their slots
// and what the goblins lost for good, each team's Merchant Depot, baby monkey
// purchases and merchant stock, and quest book progress. Only arrows in flight aren't kept.
//
// Files live in saves/ next to server.js, one per match (overwritten by
// each autosave), named by when the match started and its seed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVES } from '../shared/config.js';

export const SAVE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'saves');
const SAVE_VERSION = 1;
const SKIP_FIELDS = new Set(['rules', 'fluidNode', 'dirty', 'viewers']);

// A container's own data fields (no functions or links), for JSON.
function containerData(c) {
  const out = {};
  for (const [k, v] of Object.entries(c)) if (!SKIP_FIELDS.has(k) && typeof v !== 'function') out[k] = v;
  return out;
}
const stack = s => s ? { item: s.item, count: s.count, ...(s.mods?.length ? { mods: s.mods } : {}) } : null;

export function serializeGame(game) {
  const w = game.world;
  const players = [...game.players.values()];
  return {
    version: SAVE_VERSION, savedAt: new Date().toISOString(), matchId: game.matchId,
    seed: game.seed, worldSize: game.worldSize, occupiedTeams: game.occupiedTeams, playerCount: game.playerCount,
    tick: game.tick, nextId: game.nextId,
    blocks: [...game.blockChanges.values()].map(b => [b.x, b.y, b.z, b.id]),
    doorTeams: [...w.doorTeams],
    containers: [...w.tileEntities.entries()].map(([key, c]) => [key, containerData(c)]),
    pipes: [...game.fluids.nodes.values()].filter(n => n.kind === 'pipe').map(n => [n.key, n.faces]),
    tanks: (game.fluids.tanks ?? []).filter(t => t.amount > 0).map(t => ({ members: t.members.map(m => m.key), fluid: t.fluid, amount: t.amount })),
    turrets: [...game.turretController.turrets.values()].map(t => [t.x, t.y, t.z, t.id, t.team]),
    players: players.map(p => ({
      name: p.name, color: p.color, team: p.team, eliminated: p.eliminated,
      x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.yaw, pitch: p.state.pitch,
      hp: p.hp, dead: p.dead, carrying: p.carrying ? p.carrying.team : null,
      inventory: { slots: p.inventory.slots.map(stack), armor: stack(p.inventory.armor),
        accessory: stack(p.inventory.accessory), cursor: stack(p.inventory.cursor), bait: p.inventory.bait ?? null },
    })),
    flags: [...game.flags.values()].map(f => ({ team: f.team, state: f.state, x: f.body.x, y: f.body.y, z: f.body.z,
      droppedTick: f.droppedTick })),
    monkeys: [...game.npcs.values()].filter(n => n.npc === 'workMonkey').map(m => ({
      name: m.name, team: m.team, x: m.state.x, y: m.state.y, z: m.state.z, hp: m.hp,
      config: m.config, revision: m.revision, slots: m.inventory.slots.map(stack), gear: m.gear.map(stack),
      ...(m.baby ? { baby: true, growTicks: Math.max(0, m.growAt - game.tick) } : {}) })),
    // Sky Merchants arrive afresh by airship; only each team's depot, buys and stock are kept.
    npcs: [...game.npcs.values()].filter(n => n.npc !== 'workMonkey' && n.npc !== 'skyMerchant').map(n => ({
      npc: n.npc, team: n.team, x: n.state.x, y: n.state.y, z: n.state.z, hp: n.hp, home: n.home })),
    npcKinds: [...new Set([...game.npcs.values()].map(n => n.npc))],
    cows: [...game.cows.values()].map(c => ({ x: c.state.x, y: c.state.y, z: c.state.z, hp: c.hp, herd: c.herd.id })),
    dragons: [...game.dragons.values()].map(d => ({ x: d.state.x, y: d.state.y, z: d.state.z, hp: d.hp,
      home: d.home, homeIsland: { x: d.homeIsland.x, z: d.homeIsland.z, radius: d.homeIsland.radius }, leashRadius: d.leashRadius })),
    crawlers: [...game.mobs.values()].filter(m => m.type === 'crawler').map(m => ({ x: m.state.x, y: m.state.y, z: m.state.z, hp: m.hp, home: m.home })),
    items: [...game.items.values()].map(e => ({ item: e.item, count: e.count, mods: e.mods ?? null, x: e.state.x, y: e.state.y, z: e.state.z })),
    eels: [...game.mobs.values()].filter(m => m.type === 'voidEel').map(m => ({ x: m.state.x, y: m.state.y, z: m.state.z, hp: m.hp })),
    garrison: game.garrison ? { totemDestroyed: game.garrison.totemDestroyed,
      lostUnique: [...game.garrison.slots.values()].filter(s => s.unique && !s.mob && s.ready === null).map(s => s.role),
      construction: game.garrison.construction?.progress() ?? null, units: game.garrison.units() } : null,
    boss: game.boss ? { status: game.boss.status === 'dying' ? 'dead' : game.boss.status } : null,
    merchants: game.merchants?.save() ?? [],
    quests: game.quests?.save() ?? [],
    teamProgress: game.teamProgress?.save() ?? [],
    explosives: game.explosives?.save() ?? null,
    spikes: game.spikes?.save() ?? [],
  };
}

// Writes the match's save file (atomically: a temp file, then rename).
export function writeSave(game) {
  if (!game.world || !game.matchId) return null;
  const started = performance.now();
  const data = JSON.stringify(serializeGame(game));
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const file = path.join(SAVE_DIR, `${game.matchId}.json`);
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
  console.log(`Saved ${path.basename(file)} (${Math.round(data.length / 1024)} KB, ${Math.round(performance.now() - started)} ms)`);
  return file;
}

// Saves on disk, newest first: [{ file, label }].
export function listSaves() {
  let files = [];
  try { files = fs.readdirSync(SAVE_DIR).filter(f => f.endsWith('.json')); } catch { return []; }
  return files.map(file => {
    const stat = fs.statSync(path.join(SAVE_DIR, file));
    return { file, time: stat.mtimeMs };
  }).sort((a, b) => b.time - a.time).slice(0, SAVES.listed).map(({ file, time }) => {
    let label = file.replace(/\.json$/, '');
    try {
      // Only the header is needed; saves can be large, so read the start.
      const fd = fs.openSync(path.join(SAVE_DIR, file), 'r'), buf = Buffer.alloc(600);
      fs.readSync(fd, buf, 0, 600, 0); fs.closeSync(fd);
      const head = buf.toString('utf8');
      const seed = head.match(/"seed":(\d+)/)?.[1], size = head.match(/"worldSize":"(\w+)"/)?.[1];
      label = `${new Date(time).toLocaleString()} · ${size ?? '?'} · seed ${seed ?? '?'}`;
    } catch { /* keep the file name */ }
    return { file, label };
  });
}

export function readSave(file) {
  if (typeof file !== 'string' || !/^[\w.-]+\.json$/.test(file)) return null;
  try {
    const save = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, file), 'utf8'));
    return save.version === SAVE_VERSION ? save : null;
  } catch { return null; }
}
