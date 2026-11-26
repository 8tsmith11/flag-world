// The Wise Monkey's quest book: chapters in a sidebar (locked ones show what
// unlocks them), each chapter's quests as a graph of icons in labelled
// regions, joined by solid lines (prerequisites) and dashed lines (related),
// and the selected quest's details: its goal and progress, its reward
// (claimed once per team) and the knowledge entry explaining the mechanic.
// The Merchant Depot button sits at the top.
//
// All state comes from the server's `quests` messages (the team's book, kept
// in step for every member), never from local tracking.
//
// The graph pans by dragging, WASD or the arrow keys and zooms with the
// mouse wheel. The mouse is free while the book is open, so none of those
// reach the game (input.js only listens while the pointer is locked).
import { C2S } from '/shared/protocol.js';
import { CHAPTERS, QUESTS, questById, chapterById, chapterOpen, questAvailable, chapterHidden } from '/shared/quests.js';
import { getItemDef } from '/shared/items.js';
import { itemIcon } from './itemIcon.js';

const CELL = 120;
const EVENTS = {
  tame: 'Tame a monkey', depotPlaced: 'Place your Merchant Depot', merchantTrade: 'Trade with the Sky Merchant',
  merchantBuy: 'Buy from the Sky Merchant', merchantSale: 'Earn gold coins from the Sky Merchant',
  autoSale: 'Earn coins through your Merchant Depot', requestSold: 'Sell the merchant one of his requested goods',
  babyMonkey: 'Buy a baby monkey', lookoutSpotted: 'Have a Lookout monkey spot an enemy',
  monkeyCrafted: 'Have a Craftsman monkey craft something', 'kill:goblin': 'Defeat a goblin', 'kill:crawler': 'Defeat a Crawler',
  'kill:eel': 'Defeat a Void Eel', 'kill:dragon': 'Defeat a dragon', 'kill:player': 'Defeat an enemy player',
  flagCaptured: 'Capture an enemy flag', 'meet:wiseMonkey': 'Talk to your Wise Monkey',
  'meet:ancientWaterMonkey': 'Meet the Ancient Water Monkey', 'meet:ancientLightningMonkey': 'Meet the Ancient Lightning Monkey',
  'meet:ancientFireMonkey': 'Meet the Ancient Fire Monkey',
};
const ROLE = (key) => key.startsWith('role:') ? `Give a monkey the ${key.slice(5)[0].toUpperCase()}${key.slice(6)} role` : null;
const names = (ids) => ids.map((id) => getItemDef(id).name).join(', ');

// A goal in words: "Craft: workbench", "Tame a monkey (3/20)".
export function describeGoal(goal, counts) {
  if (goal.all) return goal.all.map((g) => describeGoal(g, counts)).join(' and ');
  if (goal.any) return goal.any.map((g) => describeGoal(g, counts)).join(', or ');
  if (goal.obtained) return goal.obtained.length > 1 ? `Get any of: ${names(goal.obtained)}` : `Get ${names(goal.obtained)}`;
  if (goal.crafted) return goal.crafted.length > 1 ? `Craft any of: ${names(goal.crafted)}` : `Craft ${names(goal.crafted)}`;
  if (goal.placed) return `Place ${names(goal.placed)}`;
  if (goal.event) {
    const text = EVENTS[goal.event] ?? ROLE(goal.event) ?? goal.event;
    return (goal.count ?? 1) > 1 ? `${text} (${goal.count} times)` : text;
  }
  return '';
}

function el(tag, className, text = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== null) e.textContent = text;
  return e;
}

export class QuestScreen {
  constructor(conn) {
    this.conn = conn;
    this.open = false;
    this.chapter = CHAPTERS[0].id;
    this.selected = null;
    this.view = { x: 0, y: 0, zoom: 1 };
    this.state = { unlocked: new Set(), completed: new Set(), claimed: new Set(), revealed: new Set(), counts: {}, depot: { placed: false } };
    this.keys = new Set();
    this.screen = el('div', 'screen hidden'); this.screen.id = 'quests';
    const panel = el('div', 'panel card quest-panel');
    const head = el('div', 'quest-head');
    head.append(el('h1', '', 'The Wise Monkey\'s Book'));
    this.depotBox = el('div', 'quest-depot');
    this.depotButton = el('button', '', 'Request a Merchant Depot'); this.depotButton.type = 'button';
    this.depotButton.title = 'One depot per team. Ask again if yours is destroyed or lost.';
    this.depotButton.addEventListener('click', () => this.send('requestDepot'));
    this.depotStatus = el('span', 'quest-depot-status');
    this.depotBox.append(this.depotButton, this.depotStatus);
    const close = el('button', '', 'Close'); close.type = 'button'; close.addEventListener('click', () => this.close());
    head.append(this.depotBox, close);
    this.message = el('p', 'quest-message');
    const body = el('div', 'quest-body');
    this.sidebar = el('nav', 'quest-chapters');
    this.graph = el('div', 'quest-graph');
    this.world = el('div', 'quest-world');
    this.lock = el('div', 'quest-locked hidden');
    this.edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.edges.classList.add('quest-edges');
    this.world.append(this.edges);
    this.graph.append(this.world, this.lock, el('div', 'quest-graph-hint', 'Drag, WASD or arrow keys to move · wheel to zoom'));
    this.details = el('aside', 'quest-details');
    body.append(this.sidebar, this.graph, this.details);
    panel.append(head, this.message, body);
    this.screen.append(panel);
    document.body.append(this.screen);
    this.screen.addEventListener('contextmenu', (e) => e.preventDefault());

    // Panning and zooming the graph.
    let drag = null;
    this.graph.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.quest-node')) return;
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      this.view.x = drag.vx + e.clientX - drag.x; this.view.y = drag.vy + e.clientY - drag.y; this.applyView();
    });
    window.addEventListener('mouseup', () => { drag = null; });
    this.graph.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.graph.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      const zoom = Math.min(2, Math.max(0.4, this.view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      this.view.x = px - (px - this.view.x) * zoom / this.view.zoom;
      this.view.y = py - (py - this.view.y) * zoom / this.view.zoom;
      this.view.zoom = zoom; this.applyView();
    }, { passive: false });
    const PAN = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.close(); return; }
      if (PAN.includes(e.code)) { e.preventDefault(); e.stopPropagation(); this.keys.add(e.code); }
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  send(action, extra = {}) { this.conn.send({ type: C2S.QUEST_ACTION, action, ...extra }); }

  // The team's book. `open` marks a reply to this player (opening the book
  // or answering a button); other updates (a teammate's claim, a new
  // completion) just refresh what's shown.
  receive(msg) {
    if (!msg) return;
    this.state = { unlocked: new Set(msg.unlocked ?? []), completed: new Set(msg.completed), claimed: new Set(msg.claimed),
      revealed: new Set(msg.revealed), counts: msg.counts ?? {}, depot: msg.depot ?? { placed: false } };
    if (msg.open) this.message.textContent = msg.message ?? '';
    if (msg.open && !this.open) { this.open = true; this.onOpen?.(); this.center(); }
    if (this.open) this.render();
  }

  // Forget the book (a new match, or leaving it).
  reset() {
    this.close(false);
    this.state = { unlocked: new Set(), completed: new Set(), claimed: new Set(), revealed: new Set(), counts: {}, depot: { placed: false } };
    this.chapter = CHAPTERS[0].id; this.selected = null;
  }

  // Per frame while open: keyboard panning.
  update(dt) {
    if (!this.open || !this.keys.size) return;
    const speed = 520 * dt, k = this.keys;
    this.view.x += ((k.has('KeyA') || k.has('ArrowLeft')) - (k.has('KeyD') || k.has('ArrowRight'))) * speed;
    this.view.y += ((k.has('KeyW') || k.has('ArrowUp')) - (k.has('KeyS') || k.has('ArrowDown'))) * speed;
    this.applyView();
  }

  quests() { return QUESTS.filter((q) => q.chapter === this.chapter); }
  chapterOpen(c) { return chapterOpen(c, this.state.unlocked); }
  // hidden ("???"), locked (prerequisites not done), todo, reward (done,
  // unclaimed) or done.
  status(q) {
    if (!this.state.revealed.has(q.id)) return 'hidden';
    if (this.state.completed.has(q.id)) return q.reward && !this.state.claimed.has(q.id) ? 'reward' : 'done';
    return questAvailable(q, this.state.unlocked, this.state.completed) ? 'todo' : 'locked';
  }

  // Fits the chapter's graph in view (never zooming in past 1).
  center() {
    const list = this.quests(), rect = this.graph.getBoundingClientRect();
    this.centered = `${this.chapter}:${this.chapterOpen(chapterById.get(this.chapter))}`;
    if (!list.length) return;
    const w = rect.width || 600, h = rect.height || 400;
    const maxX = Math.max(...list.map((q) => q.x)), maxY = Math.max(...list.map((q) => q.y));
    const spanX = maxX * CELL + 180, spanY = maxY * CELL + 200;
    this.view.zoom = Math.max(0.4, Math.min(1, w / spanX, h / spanY));
    this.view.x = w / 2 - (maxX * CELL / 2 + 32) * this.view.zoom;
    this.view.y = h / 2 - (maxY * CELL / 2 + 32) * this.view.zoom;
    this.applyView();
  }
  applyView() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
  }

  render() {
    // Sidebar: open chapters show done/total and a dot for unclaimed
    // rewards; locked ones show what unlocks them; discovery chapters don't
    // appear until found.
    const shown = CHAPTERS.filter((c) => this.chapterOpen(c) || !chapterHidden(c));
    if (!shown.some((c) => c.id === this.chapter)) { this.chapter = CHAPTERS[0].id; this.selected = null; }
    this.sidebar.replaceChildren(...shown.map((c) => {
      const list = QUESTS.filter((q) => q.chapter === c.id), open = this.chapterOpen(c);
      const done = list.filter((q) => this.state.completed.has(q.id)).length;
      const reward = open && list.some((q) => this.status(q) === 'reward');
      const b = el('button', `quest-chapter${c.id === this.chapter ? ' selected' : ''}${open ? '' : ' locked'}`); b.type = 'button';
      const icon = el('span', 'quest-chapter-icon'); icon.append(itemIcon(c.icon));
      const text = el('span', 'quest-chapter-text');
      text.append(el('span', 'quest-chapter-name', c.name));
      if (!open) text.append(el('span', 'quest-chapter-unlock', c.unlock.text));
      b.append(icon, text, el('span', 'quest-chapter-count', open ? `${done}/${list.length}` : '🔒'));
      if (reward) b.append(el('span', 'quest-dot'));
      b.title = open ? c.intro : c.unlock.text;
      b.addEventListener('click', () => { this.chapter = c.id; this.selected = null; this.center(); this.render(); });
      return b;
    }));
    const chapter = chapterById.get(this.chapter), open = this.chapterOpen(chapter);
    // Re-fit when the chapter on screen unlocks while the book is open.
    if (this.centered !== `${this.chapter}:${open}`) this.center();
    // A locked chapter's graph is hidden behind what unlocks it.
    this.world.classList.toggle('hidden', !open);
    this.lock.classList.toggle('hidden', open);
    if (!open) {
      this.lock.replaceChildren(el('div', 'quest-locked-icon', '🔒'), el('h2', '', chapter.name),
        el('p', '', chapter.unlock.text), el('p', 'hint', 'Your team keeps progress toward its quests in the meantime: anything already done counts the moment it unlocks.'));
    }
    // Regions, lines, then nodes.
    const list = open ? this.quests() : [], inChapter = new Set(list.map((q) => q.id));
    const pos = (q) => ({ x: q.x * CELL + 32, y: q.y * CELL + 32 });
    const maxX = Math.max(0, ...list.map((q) => q.x)) + 1, maxY = Math.max(0, ...list.map((q) => q.y)) + 1;
    this.edges.setAttribute('width', maxX * CELL); this.edges.setAttribute('height', maxY * CELL);
    this.edges.replaceChildren();
    for (const node of [...this.world.querySelectorAll('.quest-node, .quest-region')]) node.remove();
    for (const r of open ? chapter.regions ?? [] : []) {
      const box = el('div', 'quest-region');
      box.style.left = `${r.x0 * CELL + 32 - 56}px`; box.style.top = `${r.y0 * CELL + 32 - 58}px`;
      box.style.width = `${(r.x1 - r.x0) * CELL + 112}px`; box.style.height = `${(r.y1 - r.y0) * CELL + 110}px`;
      box.append(el('span', 'quest-region-label', r.label));
      this.world.append(box);
    }
    const line = (from, q, dashed) => {
      const a = pos(from), b = pos(q);
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
      const done = this.state.completed.has(from.id) && (!dashed || this.state.completed.has(q.id));
      l.setAttribute('class', `${dashed ? 'link' : 'dep'}${done ? ' done' : ''}`);
      this.edges.append(l);
    };
    for (const q of list) {
      for (const dep of q.deps ?? []) if (inChapter.has(dep)) line(questById.get(dep), q, false);
      for (const link of q.links ?? []) if (inChapter.has(link)) line(questById.get(link), q, true);
    }
    for (const q of list) {
      const s = this.status(q), p = pos(q);
      const node = el('button', `quest-node ${s}${this.selected === q.id ? ' selected' : ''}`); node.type = 'button';
      node.style.left = `${p.x - 28}px`; node.style.top = `${p.y - 28}px`;
      if (s === 'hidden') node.append(el('span', 'quest-unknown', '?'));
      else node.append(itemIcon(q.icon));
      if (s === 'locked') node.append(el('span', 'quest-node-lock', '🔒'));
      node.append(el('span', 'quest-node-label', s === 'hidden' ? '???' : q.title));
      node.addEventListener('click', () => { this.selected = q.id; this.render(); });
      this.world.append(node);
    }
    this.renderDetails();
    // Depot button state.
    const d = this.state.depot;
    this.depotStatus.textContent = d.placed ? `Your depot: ${d.x}, ${d.y}, ${d.z}${d.present ? ' · merchant docked' : ''}` : 'Your team has no depot placed';
    this.depotButton.disabled = !!d.placed;
  }

  renderDetails() {
    const chapter = chapterById.get(this.chapter);
    const q = this.chapterOpen(chapter) ? questById.get(this.selected) : null;
    this.details.replaceChildren();
    if (!q) {
      this.details.append(el('h2', '', chapter.name), el('p', '', chapter.intro));
      if (!this.chapterOpen(chapter)) this.details.append(el('p', 'quest-badge locked', 'Locked'), el('p', '', chapter.unlock.text));
      else this.details.append(el('p', 'hint', 'Select a quest to read about it. Green: done. Gold: reward waiting. Grey: not done yet. Lock: do the quest before it first (solid line). Dashed lines join related quests. "???": not discovered yet.'));
      return;
    }
    const s = this.status(q);
    if (s === 'hidden') {
      this.details.append(el('h2', '', '???'), el('p', 'hint', 'You haven\'t come across this yet. Keep exploring.'));
      return;
    }
    const head = el('div', 'quest-details-head');
    const icon = el('span', 'quest-details-icon'); icon.append(itemIcon(q.icon));
    head.append(icon, el('h2', '', q.title));
    const badge = el('p', `quest-badge ${s}`, { done: 'Complete', reward: 'Complete: reward waiting', todo: 'Not done yet', locked: 'Needs an earlier quest' }[s]);
    this.details.append(head, badge);
    const goal = el('p', 'quest-goal');
    const counts = this.state.counts[q.id];
    goal.append(el('strong', '', 'Goal: '), document.createTextNode(describeGoal(q.goal) + (counts ? ` (${counts[0]}/${counts[1]})` : '')));
    this.details.append(goal);
    if (s === 'locked') {
      const missing = (q.deps ?? []).filter((d) => !this.state.completed.has(d)).map((d) => questById.get(d).title);
      this.details.append(el('p', 'hint', `First complete: ${missing.join(', ')}. Anything you do toward this quest already counts, and the crafting and items it describes work now.`));
    }
    const related = (q.links ?? []).map((id) => questById.get(id)).filter((r) => r && this.status(r) !== 'hidden');
    if (related.length) this.details.append(el('p', 'hint', `Related: ${related.map((r) => r.title).join(', ')}`));
    if (q.reward) {
      const r = el('div', 'quest-reward');
      r.append(el('strong', '', 'Reward: '));
      for (const { item, count } of q.reward) {
        const chip = el('span', 'quest-reward-item'); chip.append(itemIcon(item), el('span', '', `${count} ${getItemDef(item).name}`));
        r.append(chip);
      }
      if (s === 'reward') {
        const claim = el('button', '', 'Claim'); claim.type = 'button';
        claim.addEventListener('click', () => this.send('claim', { quest: q.id }));
        r.append(claim);
      } else if (s === 'done') r.append(el('span', 'hint', ' (claimed by your team)'));
      this.details.append(r);
    }
    for (const paragraph of q.text) this.details.append(el('p', 'quest-text', paragraph));
  }

  close(tell = true) {
    if (!this.open) return;
    this.open = false;
    this.keys.clear();
    if (tell) this.send('close');
    this.onClose?.();
  }
}
