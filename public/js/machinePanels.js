// Machine screens (furnace, alloy furnace, boiler, crusher, fluid tank,
// drawbridge and Merchant Depot), all built from one layout so they read the
// same way:
//   - the machine's name and what it is for
//   - its slots, each labeled, with a faint picture of what goes there
//   - progress (arrow) and fuel (flame) bars, fluid gauges
//   - its current status from the server: why it is or isn't working
//   - the recipes it knows, and what it needs to run (fuel, water, steam)
// The server's CONTAINER view fills it in (setView); slot clicks go out
// through the callback given to the constructor, and machine controls (the
// drawbridge's buttons) through sendAction(action, value).
import { BLOCK } from '/shared/blocks.js';
import { ITEM } from '/shared/itemIds.js';
import { getItemDef } from '/shared/items.js';
import { SMELTING, CRUSHING, FUEL } from '/shared/recipes.js';
import { METALS, FLUID, SMELT_TIME, ELEMENTAL, MERCHANT, DRAWBRIDGE } from '/shared/config.js';
import { METAL_FORMS, buyList } from '/shared/merchant.js';
import { renderStack, itemIcon } from './itemIcon.js';

const name = (item) => getItemDef(item).name;
const fuelText = () => Object.entries(FUEL).map(([item, n]) => `${name(Number(item))} (${n})`).join(', ');

function el(tag, className, text = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== null) e.textContent = text;
  return e;
}

// A small "input → output" recipe line with icons.
function recipeLine(inputs, outputs, note = '') {
  const li = el('li', 'machine-recipe');
  const part = (list) => {
    const span = el('span', 'machine-recipe-part');
    list.forEach(({ item, count, label }, i) => {
      if (i) span.append(el('span', 'machine-plus', '+'));
      const chip = el('span', 'machine-chip');
      chip.append(itemIcon(item), el('span', 'machine-chip-count', `${count ?? ''}`));
      chip.title = label ?? name(item);
      span.append(chip);
    });
    return span;
  };
  li.append(part(inputs), el('span', 'machine-arrow', '→'), part(outputs));
  if (note) li.append(el('span', 'machine-note', note));
  return li;
}

// What each machine shows. slots: [{ index, label, ghost (item pictured
// when empty), tip }]; layout: which slots go left of the arrow and right.
const MACHINES = {
  furnace: {
    title: 'Furnace', icon: BLOCK.FURNACE,
    about: `Smelts ore and dust into ingots, sand into glass, wood into charcoal and raw beef into cooked beef. Each item takes ${SMELT_TIME} seconds.`,
    slots: [
      { index: 0, label: 'Input', ghost: BLOCK.IRON_ORE, tip: 'Something to smelt (see the recipes)' },
      { index: 1, label: 'Fuel', ghost: ITEM.CHARCOAL, tip: 'Fuel: charcoal, wood, planks or a lava bucket' },
      { index: 2, label: 'Output', ghost: ITEM.IRON_INGOT, tip: 'Take the results from here', output: true },
    ],
    inputs: [0], fuel: 1, outputs: [2],
    needs: () => `Fuel, as items smelted per fuel: ${fuelText()}. A lava bucket gives its bucket back.`,
    recipes: () => Object.entries(SMELTING).map(([input, output]) => recipeLine([{ item: Number(input), count: 1 }], [{ item: output, count: 1 }])),
  },
  alloyFurnace: {
    title: 'Alloy Furnace', icon: BLOCK.ALLOY_FURNACE,
    about: `Melts copper and tin together into bronze, the metal for bronze hammers (which break iron ore), weapons, armor, pipes and steam machines.`,
    slots: [
      { index: 0, label: 'Copper/tin', ghost: ITEM.COPPER_INGOT, tip: 'Copper or tin: ore, dust or ingot' },
      { index: 1, label: 'Copper/tin', ghost: BLOCK.TIN_ORE, tip: 'Copper or tin: ore, dust or ingot' },
      { index: 2, label: 'Copper/tin', ghost: ITEM.COPPER_DUST, tip: 'Copper or tin: ore, dust or ingot' },
      { index: 3, label: 'Fuel', ghost: ITEM.CHARCOAL, tip: 'Fuel: charcoal, wood, planks or a lava bucket' },
      { index: 4, label: 'Bronze', ghost: ITEM.BRONZE_INGOT, tip: 'Take the bronze from here', output: true },
    ],
    inputs: [0, 1, 2], fuel: 3, outputs: [4],
    needs: () => `Fuel: each fuel item lasts as long as it would smelt that many furnace items (${fuelText()}). One ore, dust or ingot each counts as one unit of metal; mix them freely. Crushing ore first gives 2 dust per ore, doubling your bronze.`,
    recipes: () => [
      recipeLine([{ item: ITEM.COPPER_INGOT, count: METALS.alloy.copper, label: 'copper (ore, dust or ingot)' },
        { item: ITEM.TIN_INGOT, count: METALS.alloy.tin, label: 'tin (ore, dust or ingot)' }],
      [{ item: ITEM.BRONZE_INGOT, count: METALS.alloy.output }], `${METALS.alloy.seconds} s`),
      recipeLine(METAL_FORMS.copper.map((item) => ({ item, count: 1 })), [{ item: ITEM.COPPER_INGOT, count: 1, label: 'one unit of copper' }], 'each = 1 copper'),
      recipeLine(METAL_FORMS.tin.map((item) => ({ item, count: 1 })), [{ item: ITEM.TIN_INGOT, count: 1, label: 'one unit of tin' }], 'each = 1 tin'),
    ],
    extra: (view) => `Holding ${view.copper ?? 0} copper and ${view.tin ?? 0} tin (needs ${METALS.alloy.copper} + ${METALS.alloy.tin}).`,
  },
  boiler: {
    title: 'Boiler', icon: BLOCK.BOILER,
    about: 'Burns fuel to turn water into steam, which powers the crusher. Pipe water in, and pipe the steam out to a machine.',
    slots: [{ index: 0, label: 'Fuel', ghost: ITEM.CHARCOAL, tip: 'Charcoal, wood or a lava bucket' }],
    inputs: [], fuel: 0, outputs: [],
    gauges: (v) => [['Water', v.water, v.waterCapacity, '#3a6fd8'], ['Steam', v.steam, v.steamCapacity, '#d8dde2']],
    needs: () => `Fuel: charcoal burns ${FLUID.boilerFuelSeconds.charcoal} s, wood ${FLUID.boilerFuelSeconds.wood} s, a lava bucket ${ELEMENTAL.boilerLavaSeconds} s. Uses ${FLUID.boilerPerSecond} water a second from a pump (through bronze pipes) and makes as much steam.`,
    recipes: () => [recipeLine([{ item: BLOCK.WATER, count: FLUID.boilerPerSecond, label: 'water per second' }],
      [{ item: BLOCK.BOILER, count: FLUID.boilerPerSecond, label: 'steam per second' }], 'while fueled')],
  },
  crusher: {
    title: 'Crusher', icon: BLOCK.CRUSHER,
    about: 'Uses steam to crush each ore into two dust (double the metal) and stone into sand. Dust smelts into ingots or goes straight into the Alloy Furnace.',
    slots: [
      { index: 0, label: 'Input', ghost: BLOCK.IRON_ORE, tip: 'Ore or stone' },
      { index: 1, label: 'Output', ghost: ITEM.IRON_DUST, tip: 'Take the dust or sand from here', output: true },
    ],
    inputs: [0], outputs: [1],
    gauges: (v) => [['Steam', v.steamReceived, v.steamNeeded, '#d8dde2', '/s']],
    needs: () => `Needs ${FLUID.crusherPerSecond} steam a second from a boiler, through bronze pipes. Each crush takes ${FLUID.crusherSeconds} s at full steam; less steam runs slower.`,
    recipes: () => Object.entries(CRUSHING).map(([input, out]) => recipeLine([{ item: Number(input), count: 1 }], [{ item: out.item, count: out.count }])),
  },
  tank: {
    title: 'Fluid Tank', icon: BLOCK.FLUID_TANK, slots: [], inputs: [], outputs: [],
    about: `Stores up to ${FLUID.tankCapacity} units of water or steam; tanks next to each other share one store.`,
    gauges: (v) => [[v.fluid ? v.fluid[0].toUpperCase() + v.fluid.slice(1) : 'Empty', v.amount, v.capacity, v.fluid === 'steam' ? '#d8dde2' : '#3a6fd8']],
    needs: () => 'Crouch and right click a bronze pipe where it meets the tank to set the connection: blue dot = into the pipe, orange = out of the pipe.',
    recipes: () => [],
  },
};

const DIRECTIONS = ['North', 'East', 'South', 'West'];

export class MachineView {
  constructor(container, sendClick, sendAction = () => {}) {
    this.root = container;
    this.sendClick = sendClick;
    this.sendAction = sendAction;
    this.kind = null;
    this.seed = 0;
  }

  setSeed(seed) { this.seed = seed; this.buys = buyList(seed); }

  slot(index, label, ghost, tip, output = false) {
    const wrap = el('div', 'machine-slot');
    const cell = el('div', 'slot');
    cell.title = tip ?? label;
    cell.dataset.ghost = ghost ?? '';
    if (output) cell.classList.add('output');
    cell.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this.sendClick(index, e.button === 2 ? 'right' : 'left', e.shiftKey);
    });
    wrap.append(cell, el('span', 'machine-slot-label', label));
    this.cells[index] = cell;
    return wrap;
  }

  // Builds the screen for a machine kind (or the depot).
  build(kind) {
    this.kind = kind;
    this.cells = [];
    this.root.replaceChildren();
    if (kind === 'depot') return this.buildDepot();
    if (kind === 'drawbridge') return this.buildDrawbridge();
    const m = MACHINES[kind];
    const head = el('div', 'machine-head');
    const icon = el('div', 'machine-icon'); icon.append(itemIcon(m.icon));
    head.append(icon, el('h2', '', m.title));
    this.root.append(head, el('p', 'machine-about', m.about));
    const row = el('div', 'machine-row');
    const ins = el('div', 'machine-inputs');
    for (const s of m.slots.filter((s) => m.inputs.includes(s.index))) ins.append(this.slot(s.index, s.label, s.ghost, s.tip));
    if (m.inputs.length) row.append(ins);
    if (m.fuel !== undefined) {
      const fuel = m.slots.find((s) => s.index === m.fuel);
      const col = el('div', 'machine-fuel');
      this.flame = el('div', 'machine-flame'); this.flame.title = 'Fuel left'; this.flame.append(el('div', 'fill'));
      col.append(this.flame, this.slot(fuel.index, fuel.label, fuel.ghost, fuel.tip));
      row.append(col);
    } else this.flame = null;
    if (m.outputs.length) {
      this.arrow = el('div', 'machine-progress'); this.arrow.title = 'Progress'; this.arrow.append(el('div', 'fill'));
      row.append(this.arrow);
      for (const s of m.slots.filter((s) => m.outputs.includes(s.index))) row.append(this.slot(s.index, s.label, s.ghost, s.tip, true));
    } else this.arrow = null;
    if (m.slots.length) this.root.append(row);
    this.gauges = el('div', 'machine-gauges'); this.root.append(this.gauges);
    this.extra = el('p', 'machine-extra'); this.root.append(this.extra);
    this.status = el('p', 'machine-status'); this.root.append(this.status);
    const recipes = m.recipes();
    if (recipes.length) {
      this.root.append(el('h3', '', 'Recipes'));
      const list = el('ul', 'machine-recipes'); list.append(...recipes); this.root.append(list);
    }
    this.root.append(el('h3', '', 'Needs'), el('p', 'machine-needs', m.needs()));
    this.setView({ slots: m.slots.map(() => null), burn: 0, progress: 0, water: 0, steam: 0, waterCapacity: 1, steamCapacity: 1,
      amount: 0, capacity: 1, steamReceived: 0, steamNeeded: 1, status: '' });
  }

  buildDepot() {
    const head = el('div', 'machine-head');
    const icon = el('div', 'machine-icon'); icon.append(itemIcon(BLOCK.MERCHANT_DEPOT));
    head.append(icon, el('h2', '', 'Merchant Depot'));
    this.root.append(head, el('p', 'machine-about',
      'Where the Sky Merchant docks each morning. While he is docked, goods in the selling slots are sold to him automatically and the coins come out on the right.'));
    this.presence = el('p', 'depot-presence'); this.root.append(this.presence);
    const row = el('div', 'depot-row');
    const sell = el('div', 'depot-grid'), coin = el('div', 'depot-grid coins');
    for (let i = 0; i < MERCHANT.depotInput; i++) sell.append(this.slot(i, '', null, 'Selling slot: goods the merchant buys').firstChild);
    for (let i = 0; i < MERCHANT.depotOutput; i++) coin.append(this.slot(MERCHANT.depotInput + i, '', ITEM.GOLD_COIN, 'Coins from sales (take them out)', true).firstChild);
    const left = el('div', 'depot-col'), right = el('div', 'depot-col');
    left.append(el('span', 'machine-slot-label', 'Selling'), sell);
    right.append(el('span', 'machine-slot-label', 'Coins'), coin);
    row.append(left, el('span', 'machine-arrow big', '→'), right);
    this.root.append(row);
    this.status = el('p', 'machine-status'); this.root.append(this.status);
    this.extra = el('p', 'machine-extra'); this.root.append(this.extra);
    this.root.append(el('h3', '', 'He buys'));
    const list = el('ul', 'machine-recipes depot-prices');
    list.style.maxHeight = '14em';
    for (const o of this.buys ?? []) {
      const li = recipeLine([{ item: o.item, count: o.count }], [{ item: ITEM.GOLD_COIN, count: o.coins }],
        `${o.count} ${name(o.item)} → ${o.coins} coin${o.coins === 1 ? '' : 's'}${o.request ? ' · Requested!' : ''}`);
      if (o.request) li.classList.add('requested');
      list.append(li);
    }
    this.root.append(list, el('p', 'machine-needs',
      'Items he doesn\'t buy can\'t go in. A batch sells when the depot holds a full batch and the coins fit. Monkey couriers can deliver goods here and take coins out.'));
    this.flame = this.arrow = null; this.gauges = null;
    this.setView({ slots: Array(MERCHANT.depotInput + MERCHANT.depotOutput).fill(null), present: false, status: '' });
  }

  // The drawbridge: planks slot and materials, direction and length (only
  // while retracted), extend/retract, progress, steam and status.
  buildDrawbridge() {
    const head = el('div', 'machine-head');
    const icon = el('div', 'machine-icon'); icon.append(itemIcon(BLOCK.DRAWBRIDGE));
    head.append(icon, el('h2', '', 'Steam Drawbridge'));
    this.root.append(head, el('p', 'machine-about',
      'Lays a bridge out from its front, one section at a time. Each extend or retract is paid for in steam up front; then it runs to the end on its own. Sections are built once from planks and stored inside when it retracts.'));
    const button = (label, onClick, className = '') => { const b = el('button', className, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
    const config = el('div', 'drawbridge-config');
    this.dirButtons = DIRECTIONS.map((name, i) => button(name, () => this.sendAction('direction', i), 'drawbridge-dir'));
    const dirs = el('div', 'drawbridge-row'); dirs.append(el('span', 'drawbridge-label', 'Direction'), ...this.dirButtons);
    this.lengthValue = el('span', 'drawbridge-length', '');
    this.lengthDown = button('−', () => this.sendAction('length', Math.max(1, (this.view?.length ?? 1) - 1)));
    this.lengthUp = button('+', () => this.sendAction('length', Math.min(DRAWBRIDGE.maxLength, (this.view?.length ?? 1) + 1)));
    const len = el('div', 'drawbridge-row'); len.append(el('span', 'drawbridge-label', 'Length'), this.lengthDown, this.lengthValue, this.lengthUp);
    this.configNote = el('p', 'machine-needs drawbridge-note', '');
    config.append(dirs, len, this.configNote);
    const row = el('div', 'machine-row');
    const ins = el('div', 'machine-inputs'); ins.append(this.slot(0, 'Planks', BLOCK.PLANKS, `Construction materials: ${DRAWBRIDGE.sectionPlanks} planks per section`));
    this.materials = el('div', 'drawbridge-materials');
    row.append(ins, this.materials);
    const controls = el('div', 'drawbridge-row');
    this.extendButton = button('Extend', () => this.sendAction('extend'), 'drawbridge-go');
    this.retractButton = button('Retract', () => this.sendAction('retract'), 'drawbridge-go');
    controls.append(this.extendButton, this.retractButton);
    this.root.append(config, row, controls);
    this.arrow = el('div', 'machine-progress drawbridge-progress'); this.arrow.title = 'Extension'; this.arrow.append(el('div', 'fill'));
    this.extensionText = el('p', 'machine-extra', '');
    this.root.append(el('h3', '', 'Extension'), this.arrow, this.extensionText);
    this.gauges = el('div', 'machine-gauges'); this.root.append(this.gauges);
    this.message = el('p', 'quest-message', ''); this.root.append(this.message);
    this.status = el('p', 'machine-status'); this.root.append(this.status);
    this.extra = null; this.flame = null;
    this.root.append(el('h3', '', 'Needs'), el('p', 'machine-needs',
      `Steam from a boiler through bronze pipes (tanks store more). Each extend or retract costs ${DRAWBRIDGE.steamPerSection} steam per block of length, taken all at once from the connected pipes, boilers and tanks when you press the button; without enough it won't start. Once moving it finishes on its own (a section every ${DRAWBRIDGE.sectionSeconds} s) even if the steam runs out, and takes no new orders until it stops. ${DRAWBRIDGE.sectionPlanks} planks build each section once; a broken section drops its planks and needs new ones. It stops early rather than build into blocks or anyone standing in the way.`));
    this.setView({ slots: [null], dir: 0, length: DRAWBRIDGE.defaultLength, extended: 0, stored: 0, progress: 0, moving: false,
      steamAvailable: 0, steamCost: DRAWBRIDGE.steamPerSection * DRAWBRIDGE.defaultLength, planks: 0, required: 0, target: 'retracted', status: '' });
  }

  setDrawbridge(view) {
    this.view = view;
    const moving = !!view.moving, out = view.extended > 0 || moving;
    this.dirButtons.forEach((b, i) => { b.classList.toggle('selected', i === view.dir); b.disabled = out; });
    this.lengthValue.textContent = `${view.length} block${view.length === 1 ? '' : 's'}`;
    this.lengthDown.disabled = out || view.length <= 1; this.lengthUp.disabled = out || view.length >= DRAWBRIDGE.maxLength;
    this.configNote.textContent = moving ? 'Moving: wait for it to stop.' : out ? 'Retract the bridge fully to change its length or direction.' : 'The outline in the world shows where the bridge will go.';
    const needed = view.length * DRAWBRIDGE.sectionPlanks;
    this.materials.replaceChildren(
      el('div', '', `Needs ${needed} planks for ${view.length} section${view.length === 1 ? '' : 's'} (${DRAWBRIDGE.sectionPlanks} each)`),
      el('div', '', `Built: ${view.extended} out, ${view.stored} stored`),
      el('div', view.required > view.planks ? 'drawbridge-short' : 'drawbridge-ok',
        `Supplied: ${view.planks} planks${view.required > 0 ? ` · still to supply: ${Math.max(0, view.required - view.planks)}` : ' · enough'}`));
    this.extendButton.classList.toggle('selected', view.target === 'extended');
    this.retractButton.classList.toggle('selected', view.target === 'retracted');
    const enough = view.steamAvailable + 1e-6 >= view.steamCost;
    for (const b of [this.extendButton, this.retractButton]) { b.disabled = moving; b.title = moving ? 'Moving: wait for it to stop' : enough ? `Costs ${view.steamCost} steam` : `Needs ${view.steamCost} steam (${Math.floor(view.steamAvailable)} available)`; }
    const fraction = Math.min(1, (view.extended + (moving ? (view.target === 'extended' ? 1 : -1) * view.progress : 0)) / Math.max(1, view.length));
    this.arrow.firstChild.style.width = `${fraction * 100}%`;
    this.extensionText.textContent = `${view.extended} of ${view.length} sections out, facing ${DIRECTIONS[view.dir].toLowerCase()}`;
    this.gauges.replaceChildren((() => {
      const g = el('div', 'machine-gauge'), bar = el('div', 'machine-gauge-bar'), fill = el('div', 'fill');
      fill.style.width = `${Math.min(100, view.steamAvailable / Math.max(1, view.steamCost) * 100)}%`; fill.style.background = enough ? '#d8dde2' : '#ffb37a';
      bar.append(fill);
      g.append(el('span', '', `Steam available: ${Math.floor(view.steamAvailable)} · each move costs ${view.steamCost} (${DRAWBRIDGE.steamPerSection} × ${view.length})`), bar);
      return g;
    })());
    this.message.textContent = view.message ?? '';
  }

  setView(view) {
    if (this.kind === 'drawbridge') {
      this.cells.forEach((cell, i) => {
        renderStack(cell, view.slots?.[i] ?? null);
        if (!view.slots?.[i]) { const ghost = itemIcon(BLOCK.PLANKS); ghost.classList.add('ghost'); cell.append(ghost); }
      });
      this.setDrawbridge(view);
      const status = view.status ?? '';
      this.status.textContent = status ? `Status: ${status}` : '';
      this.status.className = `machine-status ${/^(Extended|Extending|Retracting)/.test(status) ? 'ok' : /^Retracted/.test(status) ? 'idle' : 'warn'}`;
      return;
    }
    this.cells.forEach((cell, i) => {
      if (!cell) return;
      const stack = view.slots?.[i] ?? null;
      renderStack(cell, stack);
      if (!stack && cell.dataset.ghost) {
        const ghost = itemIcon(Number(cell.dataset.ghost));
        ghost.classList.add('ghost');
        cell.append(ghost);
      }
    });
    if (this.flame) this.flame.firstChild.style.height = `${(view.burn ?? 0) * 100}%`;
    if (this.arrow) this.arrow.firstChild.style.width = `${(view.progress ?? 0) * 100}%`;
    if (this.gauges) {
      const m = MACHINES[this.kind];
      this.gauges.replaceChildren(...(m.gauges?.(view) ?? []).map(([label, value, max, color, unit = '']) => {
        const g = el('div', 'machine-gauge');
        const bar = el('div', 'machine-gauge-bar'), fill = el('div', 'fill');
        fill.style.width = `${Math.min(100, (value / (max || 1)) * 100)}%`; fill.style.background = color;
        bar.append(fill);
        g.append(el('span', '', `${label}: ${Math.floor(value * 10) / 10}${unit} / ${max}${unit}`), bar);
        return g;
      }));
    }
    if (this.extra) this.extra.textContent = this.kind === 'depot' ? (view.sold ? `Coins earned here so far: ${view.sold}` : '')
      : MACHINES[this.kind].extra?.(view) ?? '';
    if (this.presence) {
      this.presence.textContent = view.present ? '● The merchant is docked: selling' : '○ The merchant is away (he docks each morning)';
      this.presence.classList.toggle('present', !!view.present);
    }
    const status = view.status ?? '';
    this.status.textContent = status ? `Status: ${status}` : '';
    this.status.className = `machine-status ${/^(Operating|Selling|Storing|Merchant docked)/.test(status) ? 'ok'
      : /^Invalid/.test(status) ? 'bad' : /^(Idle|The merchant is away|Empty)/.test(status) ? 'idle' : 'warn'}`;
  }
}

export const MACHINE_KINDS = [...Object.keys(MACHINES), 'depot', 'drawbridge'];
