// The Wise Monkey's quest book: chapters in a sidebar, each chapter's quests
// as a graph of icons joined by lines (what follows from what), and the
// selected quest's details: its goal and progress, its reward (claimed once
// per team) and the knowledge entry explaining the mechanic. The Merchant
// Depot button sits at the top.
//
// The graph pans by dragging, WASD or the arrow keys and zooms with the
// mouse wheel. The mouse is free while the book is open, so none of those
// reach the game (input.js only listens while the pointer is locked).
import { C2S } from '/shared/protocol.js';
import { CHAPTERS, QUESTS, questById } from '/shared/quests.js';
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
    this.state = { completed: new Set(), claimed: new Set(), revealed: new Set(), counts: {}, depot: { placed: false } };
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
    this.edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.edges.classList.add('quest-edges');
    this.world.append(this.edges);
    this.graph.append(this.world, el('div', 'quest-graph-hint', 'Drag, WASD or arrow keys to move · wheel to zoom'));
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

  receive(msg) {
    this.state = { completed: new Set(msg.completed), claimed: new Set(msg.claimed), revealed: new Set(msg.revealed),
      counts: msg.counts ?? {}, depot: msg.depot ?? { placed: false } };
    this.message.textContent = msg.message ?? '';
    if (msg.open && !this.open) { this.open = true; this.onOpen?.(); this.center(); }
    if (this.open) this.render();
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
  status(q) {
    if (!this.state.revealed.has(q.id)) return 'hidden';
    if (!this.state.completed.has(q.id)) return 'todo';
    return q.reward && !this.state.claimed.has(q.id) ? 'reward' : 'done';
  }

  center() {
    const list = this.quests(), rect = this.graph.getBoundingClientRect();
    const maxX = Math.max(...list.map((q) => q.x)), maxY = Math.max(...list.map((q) => q.y));
    this.view.zoom = 1;
    this.view.x = (rect.width || 600) / 2 - (maxX * CELL) / 2 - 32;
    this.view.y = (rect.height || 400) / 2 - (maxY * CELL) / 2 - 32;
    this.applyView();
  }
  applyView() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
  }

  render() {
    // Sidebar: chapters with done/total and a dot for unclaimed rewards.
    this.sidebar.replaceChildren(...CHAPTERS.map((c) => {
      const list = QUESTS.filter((q) => q.chapter === c.id);
      const done = list.filter((q) => this.state.completed.has(q.id)).length;
      const reward = list.some((q) => this.status(q) === 'reward');
      const b = el('button', `quest-chapter${c.id === this.chapter ? ' selected' : ''}`); b.type = 'button';
      const icon = el('span', 'quest-chapter-icon'); icon.append(itemIcon(c.icon));
      b.append(icon, el('span', 'quest-chapter-name', c.name), el('span', 'quest-chapter-count', `${done}/${list.length}`));
      if (reward) b.append(el('span', 'quest-dot'));
      b.title = c.intro;
      b.addEventListener('click', () => { this.chapter = c.id; this.selected = null; this.center(); this.render(); });
      return b;
    }));
    // Graph: lines, then nodes.
    const list = this.quests(), inChapter = new Set(list.map((q) => q.id));
    const pos = (q) => ({ x: q.x * CELL + 32, y: q.y * CELL + 32 });
    const maxX = Math.max(...list.map((q) => q.x)) + 1, maxY = Math.max(...list.map((q) => q.y)) + 1;
    this.edges.setAttribute('width', maxX * CELL); this.edges.setAttribute('height', maxY * CELL);
    this.edges.replaceChildren();
    for (const q of list) for (const dep of q.deps ?? []) {
      if (!inChapter.has(dep)) continue;
      const a = pos(questById.get(dep)), b = pos(q);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('class', this.state.completed.has(dep) ? 'done' : '');
      this.edges.append(line);
    }
    for (const node of [...this.world.querySelectorAll('.quest-node')]) node.remove();
    for (const q of list) {
      const s = this.status(q), p = pos(q);
      const node = el('button', `quest-node ${s}${this.selected === q.id ? ' selected' : ''}`); node.type = 'button';
      node.style.left = `${p.x - 28}px`; node.style.top = `${p.y - 28}px`;
      if (s === 'hidden') node.append(el('span', 'quest-unknown', '?'));
      else node.append(itemIcon(q.icon));
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
    const q = questById.get(this.selected);
    this.details.replaceChildren();
    if (!q) {
      const c = CHAPTERS.find((ch) => ch.id === this.chapter);
      this.details.append(el('h2', '', c.name), el('p', '', c.intro), el('p', 'hint', 'Select a quest to read about it. Green: done. Gold: reward waiting. Grey: not done yet. "???": not discovered yet.'));
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
    const badge = el('p', `quest-badge ${s}`, s === 'done' ? 'Complete' : s === 'reward' ? 'Complete: reward waiting' : 'Not done yet');
    this.details.append(head, badge);
    const goal = el('p', 'quest-goal');
    const counts = this.state.counts[q.id];
    goal.append(el('strong', '', 'Goal: '), document.createTextNode(describeGoal(q.goal) + (counts ? ` (${counts[0]}/${counts[1]})` : '')));
    this.details.append(goal);
    const outside = (q.deps ?? []).filter((d) => questById.get(d).chapter !== q.chapter);
    if (outside.length) this.details.append(el('p', 'hint', `Follows from: ${outside.map((d) => `${questById.get(d).title} (${CHAPTERS.find((c) => c.id === questById.get(d).chapter).name})`).join(', ')}`));
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
