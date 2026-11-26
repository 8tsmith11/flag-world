// Each team's quest book (data in shared/quests.js): which quests its
// progress completes, which rewards it has claimed (once per team, whoever
// claims), and the book screen for players who have it open (opened by
// right clicking the team's Wise Monkey).
import { S2C } from '../shared/protocol.js';
import { TICK_RATE } from '../shared/config.js';
import { QUESTS, questById, goalMet, goalCount } from '../shared/quests.js';
import { getItemDef } from '../shared/items.js';
import { Inventory } from './inventory.js';
import { NPC_KIND } from '../shared/npcs.js';

export class QuestBook {
  constructor(game) {
    this.game = game;
    // team -> { completed: Set, claimed: Set }
    this.teams = new Map();
  }

  of(team) {
    if (!this.teams.has(team)) this.teams.set(team, { completed: new Set(), claimed: new Set() });
    return this.teams.get(team);
  }

  // New completions, from the team's progress; announced to the team.
  refresh(team) {
    const book = this.of(team), progress = this.game.teamProgress.of(team), fresh = [];
    for (const quest of QUESTS) if (!book.completed.has(quest.id) && goalMet(quest.goal, progress)) {
      book.completed.add(quest.id); fresh.push(quest);
    }
    return fresh;
  }

  update() {
    for (const team of this.game.occupiedTeams ?? []) {
      const fresh = this.refresh(team);
      if (!fresh.length) continue;
      for (const quest of fresh.slice(0, 2)) this.game.teamNotice(team,
        `Quest complete: ${quest.title}${quest.reward ? ' (reward waiting at your Wise Monkey)' : ''}`, 'quest');
      this.refreshViewers(team);
    }
  }

  // Revealed: not hidden, or a dependency is done, or its reveal goal is met.
  revealed(quest, book, progress) {
    return !quest.hidden || book.completed.has(quest.id) || (quest.deps ?? []).some((d) => book.completed.has(d))
      || (quest.reveal && goalMet(quest.reveal, progress));
  }

  view(player, open = true, message = null) {
    const team = player.team, book = this.of(team), progress = this.game.teamProgress.of(team);
    const counts = {};
    for (const quest of QUESTS) { const c = goalCount(quest.goal, progress); if (c) counts[quest.id] = c; }
    const r = this.game.merchants?.record(team);
    const depot = r?.depot ? { placed: true, x: r.depot.x, y: r.depot.y, z: r.depot.z, present: r.phase === 'docked' } : { placed: false };
    return { type: S2C.QUESTS, open, completed: [...book.completed], claimed: [...book.claimed],
      revealed: QUESTS.filter((q) => this.revealed(q, book, progress)).map((q) => q.id), counts, depot,
      ...(message ? { message } : {}) };
  }

  open(player) {
    this.refresh(player.team);
    player.questViewing = true;
    this.game.send(player, this.view(player));
  }

  refreshViewers(team) {
    for (const p of this.game.players.values()) if (p.team === team && p.questViewing) this.game.send(p, this.view(p));
  }

  // Near enough to the team's Wise Monkey to use the book's buttons.
  nearWiseMonkey(player) {
    for (const npc of this.game.npcs.values()) {
      if (npc.npc !== NPC_KIND.WISE_MONKEY || npc.team !== player.team || npc.dead) continue;
      if (Math.hypot(npc.state.x - player.state.x, npc.state.y - player.state.y, npc.state.z - player.state.z) <= 12) return true;
    }
    return false;
  }

  action(player, msg) {
    if (player.dead) return;
    if (msg.action === 'close') { player.questViewing = false; return; }
    if (!player.questViewing) return;
    if (!this.nearWiseMonkey(player)) { this.game.send(player, this.view(player, true, 'Stand by your Wise Monkey to do that.')); return; }
    if (msg.action === 'claim') {
      const quest = questById.get(msg.quest), book = this.of(player.team);
      if (!quest?.reward || !book.completed.has(quest.id)) return;
      if (book.claimed.has(quest.id)) { this.game.send(player, this.view(player, true, 'Your team already claimed that reward.')); return; }
      const trial = new Inventory(player.inventory.slots.length);
      trial.slots = player.inventory.slots.map((s) => s && { ...s });
      if (quest.reward.some(({ item, count }) => trial.add(item, count) > 0)) {
        this.game.send(player, this.view(player, true, 'Make room in your inventory first.')); return;
      }
      player.inventory.slots = trial.slots; player.inventoryDirty = true;
      book.claimed.add(quest.id);
      this.game.teamNotice(player.team, `${player.name} claimed the reward for ${quest.title}: `
        + quest.reward.map(({ item, count }) => `${count} ${getItemDef(item).name}`).join(', '), 'quest');
      this.refreshViewers(player.team);
    } else if (msg.action === 'requestDepot') {
      const error = this.game.merchants.requestDepot(player);
      this.game.send(player, this.view(player, true, error ?? 'Here is a Merchant Depot. Place it on your island\'s far edge, with open sky in front.'));
    }
  }

  save() {
    return [...this.teams].map(([team, b]) => ({ team, completed: [...b.completed], claimed: [...b.claimed] }));
  }
  load(list) {
    for (const data of list ?? []) {
      const book = this.of(data.team);
      for (const id of data.completed ?? []) if (questById.has(id)) book.completed.add(id);
      for (const id of data.claimed ?? []) if (questById.has(id)) book.claimed.add(id);
    }
  }
}

export const QUEST_REFRESH_TICKS = TICK_RATE;
