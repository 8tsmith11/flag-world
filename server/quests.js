// Each team's quest book (data and rules in shared/quests.js): which
// chapters it has unlocked, which quests its progress completes, which
// rewards it has claimed (once per team, whoever claims), and keeping every
// member's copy in step.
//
// Chapters unlock in any order (`unlockGoal`): a discovery chapter opens as
// soon as any of its quests' goals or reveals is met, even before chapters
// that look "earlier". Everything here is team-wide and server-owned. Team progress
// (server/teamProgress.js) records what any member does whether or not the
// quest or chapter is available yet, so `refresh` completes quests
// retroactively the moment their chapter unlocks or their prerequisites are
// done. Every member gets the team's book in `welcome` and a `quests`
// message whenever it changes (open: false unless it's a reply to them),
// so claims, completions and unlocks show for teammates straight away. The
// book screen opens by right clicking the team's Wise Monkey.
import { S2C } from '../shared/protocol.js';
import { TICK_RATE } from '../shared/config.js';
import { CHAPTERS, QUESTS, questById, chapterById, goalMet, goalCount, chapterOpen, questAvailable, unlockGoal, chapterHidden } from '../shared/quests.js';
import { getItemDef } from '../shared/items.js';
import { Inventory } from './inventory.js';
import { NPC_KIND } from '../shared/npcs.js';

export class QuestBook {
  constructor(game) {
    this.game = game;
    // team -> { unlocked: Set, completed: Set, claimed: Set, sent: string }
    this.teams = new Map();
  }

  of(team) {
    if (!this.teams.has(team)) this.teams.set(team, { unlocked: new Set(), completed: new Set(), claimed: new Set(), sent: '' });
    return this.teams.get(team);
  }

  // Unlocks chapters and completes available quests from the team's
  // progress, repeating until nothing changes (a completion can make the
  // next quest available, already met). Returns what is new.
  refresh(team) {
    const book = this.of(team), progress = this.game.teamProgress.of(team);
    const chapters = [], quests = [];
    for (let changed = true; changed;) {
      changed = false;
      for (const chapter of CHAPTERS) if (chapter.unlock && !book.unlocked.has(chapter.id) && goalMet(unlockGoal(chapter), progress)) {
        book.unlocked.add(chapter.id); chapters.push(chapter); changed = true;
      }
      for (const quest of QUESTS) {
        if (book.completed.has(quest.id) || !questAvailable(quest, book.unlocked, book.completed) || !goalMet(quest.goal, progress)) continue;
        book.completed.add(quest.id); quests.push(quest); changed = true;
      }
    }
    return { chapters, quests };
  }

  // Once a second: announce what's new to the team and send members the
  // book if anything in it (counts and depot included) changed.
  update() {
    for (const team of this.game.occupiedTeams ?? []) {
      const { chapters, quests } = this.refresh(team);
      for (const chapter of chapters) this.game.teamNotice(team, chapterHidden(chapter)
        ? `A new chapter has appeared in the Wise Monkey's book: ${chapter.name}`
        : `New chapter unlocked in the Wise Monkey's book: ${chapter.name}`, 'quest');
      for (const quest of quests.slice(0, 2)) this.game.teamNotice(team,
        `Quest complete: ${quest.title}${quest.reward ? ' (reward waiting at your Wise Monkey)' : ''}`, 'quest');
      if (quests.length > 2) this.game.teamNotice(team, `...and ${quests.length - 2} more quests complete`, 'quest');
      this.sync(team);
    }
  }

  // Revealed: not hidden, or a dependency is done, or its reveal goal is met.
  revealed(quest, book, progress) {
    return !quest.hidden || book.completed.has(quest.id) || (quest.deps ?? []).some((d) => book.completed.has(d))
      || (quest.reveal && goalMet(quest.reveal, progress));
  }

  // The team's book as a `quests` message.
  state(team) {
    const book = this.of(team), progress = this.game.teamProgress.of(team);
    const counts = {};
    for (const quest of QUESTS) { const c = goalCount(quest.goal, progress); if (c) counts[quest.id] = c; }
    const r = this.game.merchants?.record(team);
    const depot = r?.depot ? { placed: true, x: r.depot.x, y: r.depot.y, z: r.depot.z, present: r.phase === 'docked' } : { placed: false };
    return { type: S2C.QUESTS, open: false, unlocked: [...book.unlocked], completed: [...book.completed], claimed: [...book.claimed],
      revealed: QUESTS.filter((q) => this.revealed(q, book, progress)).map((q) => q.id), counts, depot };
  }

  // A reply to one player: opens their book, with an optional message.
  view(player, message = null) {
    return { ...this.state(player.team), open: true, ...(message ? { message } : {}) };
  }

  open(player) {
    this.refresh(player.team);
    player.questViewing = true;
    this.game.send(player, this.view(player));
  }

  // Sends every connected member the team's book if it changed since the
  // last time (or always, with force).
  sync(team, force = false) {
    const book = this.of(team), msg = this.state(team), text = JSON.stringify(msg);
    if (!force && text === book.sent) return;
    book.sent = text;
    for (const p of this.game.players.values()) if (p.team === team && p.connected) this.game.send(p, msg);
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
    if (!this.nearWiseMonkey(player)) { this.game.send(player, this.view(player, 'Stand by your Wise Monkey to do that.')); return; }
    if (msg.action === 'claim') this.claim(player, msg.quest);
    else if (msg.action === 'requestDepot') {
      const error = this.game.merchants.requestDepot(player);
      this.game.send(player, this.view(player, error ?? 'Here is a Merchant Depot. Place it on your island\'s far edge, with open sky in front.'));
      this.sync(player.team);
    }
  }

  // Claims a reward for the player's team. Messages are handled one at a
  // time and this runs start to finish without yielding, so the claimed
  // check and the mark can't be split by another member's claim: the
  // second claim (same tick or later) finds it claimed and gets nothing.
  claim(player, id) {
    const quest = questById.get(id), team = player.team, book = this.of(team);
    if (!quest?.reward || !book.completed.has(quest.id)) return false;
    if (book.claimed.has(quest.id)) { this.game.send(player, this.view(player, 'Your team already claimed that reward.')); return false; }
    const trial = new Inventory(player.inventory.slots.length);
    trial.slots = player.inventory.slots.map((s) => s && { ...s });
    if (quest.reward.some(({ item, count }) => trial.add(item, count) > 0)) {
      this.game.send(player, this.view(player, 'Make room in your inventory first.')); return false;
    }
    book.claimed.add(quest.id);
    player.inventory.slots = trial.slots; player.inventoryDirty = true;
    this.game.teamNotice(team, `${player.name} claimed the reward for ${quest.title}: `
      + quest.reward.map(({ item, count }) => `${count} ${getItemDef(item).name}`).join(', '), 'quest');
    // Everyone on the team sees it claimed now, not at the next update.
    this.sync(team);
    this.game.send(player, this.view(player));
    return true;
  }

  save() {
    return [...this.teams].map(([team, b]) => ({ team, unlocked: [...b.unlocked], completed: [...b.completed], claimed: [...b.claimed] }));
  }
  load(list) {
    for (const data of list ?? []) {
      const book = this.of(data.team);
      for (const id of data.unlocked ?? []) if (chapterById.has(id)) book.unlocked.add(id);
      // A completion is only kept where its chapter is open (older books had
      // other chapters); refresh completes the rest again from progress.
      for (const id of data.completed ?? []) {
        const quest = questById.get(id);
        if (quest && chapterOpen(chapterById.get(quest.chapter), book.unlocked)) book.completed.add(id);
      }
      // Claims are always kept, so a reward can never be claimed twice.
      for (const id of data.claimed ?? []) if (questById.has(id)) book.claimed.add(id);
    }
  }
}

export const QUEST_REFRESH_TICKS = TICK_RATE;
