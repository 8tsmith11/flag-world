// The Sky Merchant's trade screen: what he sells (price, daily stock), what
// he buys (requested goods first) and baby monkeys, with your coins. Every
// trade goes to the server, which checks coins, stock, room and distance and
// answers with a fresh view; nothing changes here until then.
import { C2S, TEAMS } from '/shared/protocol.js';
import { ITEM } from '/shared/itemIds.js';
import { getItemDef } from '/shared/items.js';
import { MONKEY_DUTY } from '/shared/config.js';
import { itemIcon } from './itemIcon.js';

function el(tag, className, text = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== null) e.textContent = text;
  return e;
}
function button(text, action, tip = null) {
  const b = el('button', '', text); b.type = 'button'; b.addEventListener('click', action);
  if (tip) b.title = tip;
  return b;
}
const count = (slots, item) => slots.reduce((n, s) => n + (s?.item === item && !s.mods?.length ? s.count : 0), 0);

export class MerchantScreen {
  constructor(conn) {
    this.conn = conn;
    this.open = false;
    this.data = null;
    this.inventory = { slots: [] };
    this.screen = el('div', 'screen hidden'); this.screen.id = 'merchant';
    this.panel = el('div', 'panel card merchant-panel');
    this.screen.append(this.panel);
    document.body.append(this.screen);
    window.addEventListener('keydown', (e) => {
      if (this.open && !e.repeat && (e.code === 'Escape' || e.code === 'KeyE')) { e.preventDefault(); this.close(); }
    });
  }

  send(action, extra = {}) { this.conn.send({ type: C2S.MERCHANT_ACTION, action, ...extra }); }

  receive(msg) {
    if (!msg.open) { if (this.open) { this.close(false); if (msg.message) this.onToast?.(msg.message); } return; }
    this.data = msg;
    if (!this.open) { this.open = true; this.onOpen?.(); }
    this.render();
  }

  setInventory(inventory) {
    this.inventory = inventory;
    if (this.open) this.render();
  }

  coins() { return count(this.inventory.slots ?? [], ITEM.GOLD_COIN); }

  row(item, n, label, price, actions, note = '', className = '') {
    const r = el('div', `merchant-row ${className}`);
    const icon = el('div', 'merchant-icon'); icon.append(itemIcon(item));
    const text = el('div', 'merchant-text');
    text.append(el('strong', '', `${n > 1 ? `${n} × ` : ''}${label}`));
    if (note) text.append(el('span', 'merchant-note', note));
    const cost = el('div', 'merchant-price');
    const coin = itemIcon(ITEM.GOLD_COIN); coin.classList.add('merchant-coin');
    cost.append(el('span', '', String(price)), coin);
    r.append(icon, text, cost, ...actions);
    return r;
  }

  render() {
    const d = this.data, coins = this.coins();
    this.panel.replaceChildren();
    const head = el('div', 'merchant-head');
    const title = el('div', '');
    title.append(el('h1', '', d.name), el('p', 'hint', 'Sky Merchant · from a land far beyond the islands'));
    const purse = el('div', 'merchant-purse');
    const coin = itemIcon(ITEM.GOLD_COIN); coin.classList.add('merchant-coin');
    purse.append(coin, el('span', '', `${coins} gold coins`));
    head.append(title, purse, button('Close', () => this.close()));
    this.panel.append(head, el('p', 'merchant-message', d.message ?? (d.present ? 'Welcome, welcome! Fine goods from beyond the clouds.' : 'He is not here right now.')));

    const columns = el('div', 'merchant-columns');
    // He sells.
    const buy = el('div', 'merchant-col');
    buy.append(el('h2', '', 'Buy from him'));
    for (const o of d.sells) {
      const def = getItemDef(o.item), soldOut = o.left === 0;
      const note = o.left === null ? '' : soldOut ? 'Sold out today' : `${o.left} left today`;
      const b = button('Buy', (e) => this.send('buy', { offer: o.id, times: e.shiftKey ? Math.min(5, o.left ?? 5) : 1 }),
        'Shift-click buys 5');
      b.disabled = soldOut || coins < o.coins;
      buy.append(this.row(o.item, o.count, def.name, o.coins, [b], note, soldOut ? 'sold-out' : ''));
    }
    // Baby monkeys.
    const baby = el('div', 'merchant-row baby');
    const icon = el('div', 'merchant-icon'); icon.append(itemIcon(ITEM.MONKEY_EGG));
    const text = el('div', 'merchant-text');
    text.append(el('strong', '', 'Baby monkey'),
      el('span', 'merchant-note', `Joins your team; grows up in ${Math.round(MONKEY_DUTY.baby.growSeconds / 60)} min. Each one makes the next cost more (bought so far: ${d.babies}).`));
    const price = el('div', 'merchant-price');
    const c2 = itemIcon(ITEM.GOLD_COIN); c2.classList.add('merchant-coin');
    price.append(el('span', '', String(d.babyPrice)), c2);
    const bb = button('Buy', () => this.send('baby')); bb.disabled = coins < d.babyPrice;
    baby.append(icon, text, price, bb);
    buy.append(baby);

    // He buys.
    const sell = el('div', 'merchant-col');
    sell.append(el('h2', '', 'Sell to him'));
    const sorted = [...d.buys].sort((a, b) => (b.request ? 1 : 0) - (a.request ? 1 : 0));
    for (const o of sorted) {
      const have = count(this.inventory.slots ?? [], o.item);
      const one = button('Sell', () => this.send('sell', { item: o.item }));
      const all = button('All', () => this.send('sell', { item: o.item, all: true }), 'Sell every full batch you carry');
      one.disabled = all.disabled = have < o.count;
      const note = `${o.request ? 'Requested! Pays extra. ' : ''}You have ${have}`;
      sell.append(this.row(o.item, o.count, getItemDef(o.item).name, o.coins, [one, all], note, o.request ? 'requested' : ''));
    }
    columns.append(buy, sell);
    this.panel.append(columns, el('p', 'hint',
      `Prices are the same for every team and never change. Rare goods restock each morning. Your ${TEAMS[d.team]?.name ?? ''} team's Merchant Depot also sells for you while he is docked.`));
  }

  close(tell = true) {
    if (!this.open) return;
    this.open = false;
    if (tell) this.send('close');
    this.onClose?.();
  }
}
