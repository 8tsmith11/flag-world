// The Sky Merchant: each team's own merchant visits its Merchant Depot by
// airship every day (tuning in MERCHANT in shared/config.js, prices and
// docking in shared/merchant.js).
//
// A team's cycle, by time of day (0 sunrise, 0.5 sunset):
//   away       no ship. During the day, with a depot placed and its dock
//              clear, the ship sets off from approachDistance blocks out
//              along the dock direction (the island's far side).
//   arriving   the ship flies in and slows to a stop beside the depot; the
//              merchant then steps off onto the island next to it.
//   docked     he trades (right click him), and the depot sells what's in
//              its selling slots. At departTime he walks back aboard.
//   departing  the ship flies back out the way it came and disappears.
// Killing the merchant (enemies only: his own team can't hurt him) sends the
// ship away crewless; he drops nothing, and a new merchant, with a new name
// and look, comes the next morning. Valuable goods restock each morning.
// Baby monkeys cost more for each one a team has bought, all match long.
import { MERCHANT, MONKEY_DUTY, TICK_RATE, DAY_LENGTH, DAY_START } from '../shared/config.js';
import { BLOCK, isSolid } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { S2C, ENTITY_TYPE, TEAMS } from '../shared/protocol.js';
import { NPC_KIND } from '../shared/npcs.js';
import { buyList, MERCHANT_SELLS, sellOffer, babyPrice, checkDepotSite, dockBlocked, dockPose, DOCK, DOCK_DIRS,
  merchantLook } from '../shared/merchant.js';
import { createPlayerState, playerFitsAt } from '../shared/physics.js';
import { canStand } from './pathfind.js';
import { Npc } from './npcs.js';
import { Inventory } from './inventory.js';
import { setDepotOffers } from './containers.js';

const FLIGHT_TICKS = Math.round(MERCHANT.flightSeconds * TICK_RATE);
const WALK_TICKS = Math.round(MERCHANT.walkSeconds * TICK_RATE);
const easeOut = (t) => 1 - (1 - t) ** 3, easeIn = (t) => t ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const key = (p) => `${p.x},${p.y},${p.z}`;

export class SkyMerchant extends Npc {
  constructor(id, site, team, tick, appearance) {
    super(id, { ...site, npc: NPC_KIND.SKY_MERCHANT }, team, tick);
    this.appearance = appearance;
    this.name = merchantLook(appearance).name;
    this.pose = 'stand';
  }
  step(world, players) { this.lookAtNearest(players); }
  snapshot() { return { ...super.snapshot(), appearance: this.appearance }; }
}

// The airship: drawn by the client (render/merchantModels.js); the server
// only moves it. pilot: the merchant is aboard (drawn at the helm).
export class Airship {
  constructor(id, team, appearance, pose) {
    this.id = id; this.type = ENTITY_TYPE.AIRSHIP; this.team = team; this.appearance = appearance;
    this.state = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw };
    this.pilot = true; this.thrust = 1; this.dead = false;
  }
  describe() { return this.snapshot(); }
  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, team: this.team, appearance: this.appearance,
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, pilot: this.pilot, thrust: this.thrust };
  }
}

export class MerchantSystem {
  constructor(game) {
    this.game = game;
    this.buys = buyList(game.seed);
    setDepotOffers(this.buys);
    this.ships = new Map();
    this.teams = new Map();
    for (const team of game.occupiedTeams ?? []) this.teams.set(team, this.fresh(team));
    this.dirty = true;
  }

  fresh(team) {
    return { team, depot: null, phase: 'away', ship: null, merchant: null, start: null, dock: null, tick: 0,
      generation: 0, killedDay: -1, babies: 0, stock: {}, stockDay: -1, blockedDay: -1, walk: null, lastRequest: -Infinity };
  }
  record(team) {
    if (!this.teams.has(team)) this.teams.set(team, this.fresh(team));
    return this.teams.get(team);
  }
  appearance(r) { return ((this.game.seed >>> 0) * 31 + r.team * 1009 + r.generation * 7919) >>> 0; }
  day() { return Math.floor(DAY_START + this.game.dayOffset + this.game.tick / (DAY_LENGTH * TICK_RATE)); }
  daytime() { const t = this.game.dayTime(); return t >= MERCHANT.arriveTime && t < MERCHANT.departTime; }
  depotContainer(r) { return r.depot ? this.game.world.tileEntities.get(key(r.depot)) ?? null : null; }

  // ---- Depots ----

  teamIsland(team) {
    const index = this.game.occupiedTeams.indexOf(team);
    return this.game.world.islands?.find((i) => i.kind === 'team' && i.teamIndex === index) ?? null;
  }
  // Whether `player` may place a depot at pos: { ok, facing, reason }.
  canPlaceDepot(player, pos) {
    const r = this.record(player.team), w = this.game.world;
    if (r.depot && w.getBlock(r.depot.x, r.depot.y, r.depot.z) === BLOCK.MERCHANT_DEPOT)
      return { ok: false, reason: `Your team already has a Merchant Depot (at ${r.depot.x}, ${r.depot.y}, ${r.depot.z}). Break it to move it.` };
    return checkDepotSite(w, pos, this.teamIsland(player.team));
  }
  depotPlaced(team, pos, facing) {
    const r = this.record(team);
    r.depot = { x: pos.x, y: pos.y, z: pos.z, facing };
    const c = this.depotContainer(r);
    if (c) c.team = team;
    this.game.teamProgress?.event(team, 'depotPlaced');
    this.dirty = true;
  }
  // Any writer removed a depot block (broken, exploded, replaced).
  depotRemoved(x, y, z) {
    for (const r of this.teams.values()) if (r.depot && r.depot.x === x && r.depot.y === y && r.depot.z === z) {
      r.depot = null;
      if (r.phase === 'docked' || r.phase === 'arriving') this.depart(r);
      this.dirty = true;
    }
  }
  // The Wise Monkey's "Request a Merchant Depot" button: refused only while
  // the team has a depot placed (depot items carried, stored or dropped
  // don't count; only one can be placed at a time anyway).
  requestDepot(player) {
    const r = this.record(player.team), w = this.game.world;
    if (this.game.tick - r.lastRequest < TICK_RATE * 5) return 'Wait a moment before asking again.';
    if (r.depot && w.getBlock(r.depot.x, r.depot.y, r.depot.z) === BLOCK.MERCHANT_DEPOT)
      return `Your team's depot is still standing at ${r.depot.x}, ${r.depot.y}, ${r.depot.z}.`;
    if (player.inventory.add(BLOCK.MERCHANT_DEPOT, 1) > 0) return 'Make room in your inventory first.';
    r.lastRequest = this.game.tick;
    player.inventoryDirty = true;
    return null;
  }

  // ---- The daily cycle ----

  // The cell next to the depot (on the island side) where the merchant
  // stands while docked, or null to stay aboard.
  standSpot(r) {
    const d = r.depot, [fx, fz] = DOCK_DIRS[d.facing], w = this.game.world, box = MERCHANT.box;
    let best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if ((dx === 0 && dz === 0) || dx * fx + dz * fz > 0) continue;
      const x = d.x + dx, y = d.y + dy, z = d.z + dz;
      if (!canStand(w, x, y, z, Math.ceil(box.height)) || !playerFitsAt(w, { x: x + 0.5, y, z: z + 0.5, box }, y)) continue;
      const score = Math.hypot(dx, dz) + Math.abs(dy) * 0.5 - (dx * fx + dz * fz) * 0.1;
      if (!best || score < best.score) best = { x: x + 0.5, y, z: z + 0.5, score };
    }
    return best;
  }
  gangway(r) {
    const d = r.depot, [fx, fz] = DOCK_DIRS[d.facing];
    return { x: d.x + 0.5 + fx * (DOCK.gap + 0.6), y: d.y, z: d.z + 0.5 + fz * (DOCK.gap + 0.6) };
  }
  launch(r) {
    const d = r.depot, dock = dockPose(d, d.facing), [fx, fz] = DOCK_DIRS[d.facing];
    r.dock = dock;
    r.start = { x: dock.x + fx * MERCHANT.approachDistance, y: dock.y + MERCHANT.approachRise,
      z: dock.z + fz * MERCHANT.approachDistance, yaw: dock.yaw };
    const ship = new Airship(this.game.nextId++, r.team, this.appearance(r), r.start);
    r.ship = ship; r.phase = 'arriving'; r.tick = this.game.tick;
    this.ships.set(ship.id, ship);
    this.game.broadcast({ type: S2C.ENTITY_SPAWN, entity: ship.describe() });
    const day = this.day();
    if (r.stockDay !== day) { r.stock = {}; r.stockDay = day; }
    this.dirty = true;
  }
  dockShip(r) {
    const g = this.game, spot = this.standSpot(r) ?? this.gangway(r), from = this.gangway(r);
    const merchant = new SkyMerchant(g.nextId++, { ...from, yaw: r.dock.yaw }, r.team, g.tick, this.appearance(r));
    merchant.home = { ...spot, yaw: r.dock.yaw };
    g.npcs.set(merchant.id, merchant);
    g.broadcast({ type: S2C.ENTITY_SPAWN, entity: merchant.describe() });
    r.merchant = merchant; r.walk = { from, to: spot, tick: g.tick };
    r.ship.pilot = false; r.ship.thrust = 0; r.ship.moved = true;
    r.phase = 'docked';
    const c = this.depotContainer(r);
    if (c) { c.present = true; c.dirty = true; }
    g.teamNotice(r.team, `The Sky Merchant ${merchant.name} has docked at your depot.`, 'merchant');
    this.dirty = true;
  }
  // Off he goes: the merchant (if alive) walks back aboard, then the ship leaves.
  depart(r) {
    const c = this.depotContainer(r);
    if (c) { c.present = false; c.dirty = true; }
    this.closeViewers(r.team);
    if (r.merchant && !r.merchant.dead) {
      r.walk = { from: { x: r.merchant.state.x, y: r.merchant.state.y, z: r.merchant.state.z },
        to: r.depot ? this.gangway(r) : { ...r.merchant.state }, tick: this.game.tick, leaving: true };
      r.phase = 'boarding';
    } else this.castOff(r);
    this.dirty = true;
  }
  castOff(r) {
    if (r.merchant && !r.merchant.dead) {
      this.game.npcs.delete(r.merchant.id);
      this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: r.merchant.id });
      if (r.ship) r.ship.pilot = true;
    }
    r.merchant = null; r.walk = null;
    if (!r.ship) { r.phase = 'away'; return; }
    r.ship.thrust = 1;
    r.phase = 'departing'; r.tick = this.game.tick;
    r.from = { ...r.ship.state };
    this.dirty = true;
  }
  removeShip(r) {
    if (r.ship) { this.ships.delete(r.ship.id); this.game.broadcast({ type: S2C.ENTITY_DESPAWN, id: r.ship.id }); }
    r.ship = null; r.phase = 'away';
    this.dirty = true;
  }

  // The merchant died (Game.hurtNpc): the ship leaves, and a new merchant
  // comes the next morning.
  killed(merchant, attacker) {
    for (const r of this.teams.values()) if (r.merchant === merchant) {
      r.merchant = null; r.killedDay = this.day(); r.generation++;
      if (r.ship) r.ship.pilot = false;
      const c = this.depotContainer(r);
      if (c) { c.present = false; c.dirty = true; }
      this.closeViewers(r.team);
      this.castOff(r);
      this.game.teamNotice(r.team, `${attacker?.name ?? 'Someone'} killed your Sky Merchant! A new one will come tomorrow morning.`, 'danger');
      if (attacker?.team !== undefined && attacker.team !== r.team) this.game.teamProgress?.event(attacker.team, 'kill:merchant');
    }
  }

  update() {
    const g = this.game, tick = g.tick, day = this.day(), daytime = this.daytime();
    for (const r of this.teams.values()) {
      if (r.phase === 'away') {
        if (!daytime || !r.depot || r.killedDay === day) continue;
        if (g.world.getBlock(r.depot.x, r.depot.y, r.depot.z) !== BLOCK.MERCHANT_DEPOT) { r.depot = null; this.dirty = true; continue; }
        if (dockBlocked(g.world, r.depot, r.depot.facing)) {
          if (r.blockedDay !== day) {
            r.blockedDay = day;
            g.teamNotice(r.team, 'The Sky Merchant couldn\'t dock: something is in his airship\'s way in front of your depot.', 'danger');
          }
          continue;
        }
        this.launch(r);
      } else if (r.phase === 'arriving') {
        const t = Math.min(1, (tick - r.tick) / FLIGHT_TICKS), e = easeOut(t);
        Object.assign(r.ship.state, { x: lerp(r.start.x, r.dock.x, e), y: lerp(r.start.y, r.dock.y, e), z: lerp(r.start.z, r.dock.z, e) });
        r.ship.thrust = 1 - e * 0.85; r.ship.moved = true;
        if (!r.depot) { this.castOff(r); continue; }
        if (t >= 1) this.dockShip(r);
      } else if (r.phase === 'docked' || r.phase === 'boarding') {
        this.walk(r, tick);
        if (r.phase === 'docked') {
          if (!daytime || !r.depot) this.depart(r);
          else if (tick % MERCHANT.sellTicks === 0) this.sellFromDepot(r);
        }
      } else if (r.phase === 'departing') {
        const t = Math.min(1, (tick - r.tick) / FLIGHT_TICKS), e = easeIn(t);
        const to = { x: r.from.x + (r.start?.x - r.dock?.x || 0), y: r.from.y + MERCHANT.approachRise,
          z: r.from.z + (r.start?.z - r.dock?.z || 0) };
        Object.assign(r.ship.state, { x: lerp(r.from.x, to.x, e), y: lerp(r.from.y, to.y, e), z: lerp(r.from.z, to.z, e) });
        r.ship.thrust = 0.2 + e * 0.8; r.ship.moved = true;
        if (t >= 1) this.removeShip(r);
      }
    }
    if (this.dirty) { this.dirty = false; g.broadcast(this.message()); }
  }

  // The merchant steps between the gangway and his spot by the depot (a small hop).
  walk(r, tick) {
    const m = r.merchant;
    if (!m || !r.walk) return;
    const t = Math.min(1, (tick - r.walk.tick) / WALK_TICKS), { from, to } = r.walk;
    Object.assign(m.state, { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) + Math.sin(t * Math.PI) * 0.6,
      z: lerp(from.z, to.z, t) });
    m.state.yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z)) || m.state.yaw;
    m.pose = t < 1 ? 'walk' : 'stand';
    this.game.npcs.relocate?.(m);
    if (t < 1) return;
    if (r.walk.leaving) { this.castOff(r); return; }
    m.state.yaw = r.dock.yaw + Math.PI;
    r.walk = null;
  }

  sellFromDepot(r) {
    const c = this.depotContainer(r);
    if (!c) return;
    c.present = true;
    const sale = c.sellOne();
    if (!sale) return;
    c.dirty = true;
    this.game.teamProgress?.event(r.team, 'autoSale', sale.coins);
    this.game.teamProgress?.discover(r.team, `depotSold:${sale.item}`);
    this.game.teamProgress?.event(r.team, 'merchantSale', sale.coins);
    if (this.buys.find((o) => o.item === sale.item)?.request) this.game.teamProgress?.event(r.team, 'requestSold');
  }

  // ---- Trading ----

  // Right click on a merchant: his own team gets the trade screen.
  talk(player, merchant) {
    const r = [...this.teams.values()].find((t) => t.merchant === merchant);
    if (!r) return;
    if (player.team !== r.team) {
      this.game.send(player, { type: S2C.SPEAK, id: merchant.id, name: merchant.name, voice: 'merchant',
        text: `Terribly sorry, friend. I only trade with the ${TEAMS[r.team]?.name ?? 'other'} team.` });
      return;
    }
    player.merchantViewing = r.team;
    this.sendView(player, r);
  }
  near(player, r) {
    const m = r.merchant;
    return !!m && !m.dead && r.phase === 'docked' && !player.dead
      && Math.hypot(player.state.x - m.state.x, player.state.y - m.state.y, player.state.z - m.state.z) <= MERCHANT.talkReach + 3;
  }
  sendView(player, r, message = null) {
    this.game.send(player, { type: S2C.MERCHANT, open: true, id: r.merchant?.id ?? null, name: r.merchant?.name ?? 'Sky Merchant',
      team: r.team, present: r.phase === 'docked',
      sells: MERCHANT_SELLS.map((o) => ({ ...o, left: o.stock === undefined ? null : Math.max(0, o.stock - (r.stock[o.id] ?? 0)) })),
      buys: this.buys, babyPrice: babyPrice(r.babies), babies: r.babies, ...(message ? { message } : {}) });
  }
  closeViewers(team) {
    for (const p of this.game.players.values()) if (p.merchantViewing === team) {
      p.merchantViewing = null;
      this.game.send(p, { type: S2C.MERCHANT, open: false, message: 'The merchant has left.' });
    }
  }
  refreshViewers(r) {
    for (const p of this.game.players.values()) if (p.merchantViewing === r.team) this.sendView(p, r);
  }
  // Every second: viewers who walked away lose the screen.
  checkViewers() {
    for (const p of this.game.players.values()) {
      if (p.merchantViewing === null || p.merchantViewing === undefined) continue;
      const r = this.teams.get(p.merchantViewing);
      if (!r || !this.near(p, r)) { p.merchantViewing = null; this.game.send(p, { type: S2C.MERCHANT, open: false }); }
    }
  }

  coins(player) { return player.inventory.slots.reduce((n, s) => n + (s?.item === ITEM.GOLD_COIN ? s.count : 0), 0); }

  // Takes `price` coins and gives `stacks` atomically: refused (nothing
  // changes) without the coins or the room.
  pay(player, price, stacks) {
    if (this.coins(player) < price) return 'You don\'t have enough gold coins.';
    const trial = new Inventory(player.inventory.slots.length);
    trial.slots = player.inventory.slots.map((s) => s && { ...s });
    trial.remove(ITEM.GOLD_COIN, price);
    for (const s of stacks) if (trial.add(s.item, s.count) > 0) return 'Make room in your inventory first.';
    player.inventory.slots = trial.slots;
    player.inventoryDirty = true;
    return null;
  }

  action(player, msg) {
    if (player.merchantViewing === null || player.merchantViewing === undefined) return;
    const r = this.teams.get(player.merchantViewing);
    if (!r || r.team !== player.team) return;
    if (msg.action === 'close') { player.merchantViewing = null; return; }
    if (!this.near(player, r)) { this.sendView(player, r, 'Come closer to the merchant to trade.'); return; }
    const times = Number.isInteger(msg.times) && msg.times >= 1 && msg.times <= 64 ? msg.times : 1;
    let error = null;
    if (msg.action === 'buy') {
      const offer = sellOffer(msg.offer);
      if (!offer) return;
      const left = offer.stock === undefined ? Infinity : offer.stock - (r.stock[offer.id] ?? 0);
      if (left < times) error = left <= 0 ? 'He has sold out of that for today. More tomorrow morning.' : `He only has ${left} left today.`;
      else error = this.pay(player, offer.coins * times, [{ item: offer.item, count: offer.count * times }]);
      if (!error) {
        if (offer.stock !== undefined) r.stock[offer.id] = (r.stock[offer.id] ?? 0) + times;
        this.game.teamProgress?.event(r.team, 'merchantBuy');
        this.game.teamProgress?.event(r.team, 'merchantTrade');
      }
    } else if (msg.action === 'sell') {
      const offer = this.buys.find((o) => o.item === msg.item);
      if (!offer) return;
      const have = player.inventory.slots.reduce((n, s) => n + (s?.item === offer.item && !s.mods?.length ? s.count : 0), 0);
      const batches = msg.all ? Math.floor(have / offer.count) : Math.min(times, Math.floor(have / offer.count));
      if (!batches) error = `You need ${offer.count} ${getItemDef(offer.item).name} to sell.`;
      else {
        const trial = new Inventory(player.inventory.slots.length);
        trial.slots = player.inventory.slots.map((s) => s && { ...s });
        trial.remove(offer.item, offer.count * batches);
        if (trial.add(ITEM.GOLD_COIN, offer.coins * batches) > 0) error = 'Make room for the coins first.';
        else {
          player.inventory.slots = trial.slots; player.inventoryDirty = true;
          this.game.teamProgress?.event(r.team, 'merchantSale', offer.coins * batches);
          this.game.teamProgress?.event(r.team, 'merchantTrade');
          if (offer.request) this.game.teamProgress?.event(r.team, 'requestSold');
        }
      }
    } else if (msg.action === 'baby') {
      error = this.buyBaby(player, r);
    } else return;
    this.sendView(player, r, error);
    if (!error) for (const p of this.game.players.values()) if (p !== player && p.merchantViewing === r.team) this.sendView(p, r);
  }

  // A baby monkey for the team, by the merchant; the next one costs more.
  buyBaby(player, r) {
    const g = this.game, price = babyPrice(r.babies), m = r.merchant;
    if (this.coins(player) < price) return `A baby monkey costs ${price} gold coins.`;
    const near = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.floor(m.state.x) + dx, y = Math.round(m.state.y) + dy, z = Math.floor(m.state.z) + dz;
      if (g.monkeys.stand(x, y, z)) near.push({ x, y, z, d: Math.hypot(dx, dz) + Math.abs(dy) });
    }
    const spot = near.sort((a, b) => a.d - b.d)[0];
    if (!spot) return 'There is no room for a baby monkey here.';
    player.inventory.remove(ITEM.GOLD_COIN, price);
    player.inventoryDirty = true;
    const baby = g.monkeys.spawnBaby(spot);
    r.babies++;
    g.teamProgress?.event(r.team, 'babyMonkey');
    g.teamProgress?.event(r.team, 'merchantTrade');
    g.teamNotice(r.team, `${player.name} bought a baby monkey, ${baby.name}. It's still wild: play its game to tame it. It grows up in ${Math.round(MONKEY_DUTY.baby.growSeconds / 60)} minutes.`, 'monkey');
    return null;
  }

  // ---- Wire and saves ----

  message() {
    return { type: S2C.MERCHANTS, merchants: [...this.teams.values()].map((r) => ({ team: r.team, depot: r.depot,
      present: r.phase === 'docked', name: r.merchant?.name ?? null, phase: r.phase })) };
  }
  snapshots() {
    const out = [];
    for (const ship of this.ships.values()) if (ship.moved) { ship.moved = false; out.push(ship.snapshot()); }
    return out;
  }
  save() {
    return [...this.teams.values()].map((r) => ({ team: r.team, depot: r.depot, generation: r.generation, killedDay: r.killedDay,
      babies: r.babies, stock: r.stock, stockDay: r.stockDay }));
  }
  load(list) {
    for (const data of list ?? []) Object.assign(this.record(data.team), {
      depot: data.depot, generation: data.generation ?? 0, killedDay: data.killedDay ?? -1, babies: data.babies ?? 0,
      stock: data.stock ?? {}, stockDay: data.stockDay ?? -1 });
    for (const r of this.teams.values()) {
      const c = this.depotContainer(r);
      if (c) { c.team = r.team; c.present = false; }
    }
    this.dirty = true;
  }
}
