// Small DOM icons for items in the hotbar and inventory screen: blocks are a
// shaded square of their color, tools are drawn from simple shapes.

import { getItemDef } from '/shared/items.js';

let tooltip = null;
let pointerX = 0, pointerY = 0;

function showTooltip(slot, event) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  const label = slot.dataset.tooltip;
  if (!label) { if (tooltip) tooltip.hidden = true; return; }
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'item-tooltip';
    document.body.append(tooltip);
  }
  tooltip.textContent = label;
  tooltip.hidden = false;
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(pointerX + 12, window.innerWidth - bounds.width - 8))}px`;
  const top = pointerY + bounds.height + 18 > window.innerHeight ? pointerY - bounds.height - 10 : pointerY + 14;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

export function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function itemIcon(item) {
  const def = getItemDef(item);
  const icon = document.createElement('div');
  icon.className = 'icon';
  if (def.tool === 'hammer') {
    icon.classList.add('hammer');
    const handle = document.createElement('div');
    handle.className = 'handle';
    const head = document.createElement('div');
    head.className = 'head';
    head.style.background = cssColor(def.color);
    icon.append(handle, head);
  } else if (def.tool === 'sword') {
    icon.classList.add('sword');
    const blade = document.createElement('div');
    blade.className = 'blade';
    blade.style.background = cssColor(def.color);
    const guard = document.createElement('div');
    guard.className = 'guard';
    const grip = document.createElement('div');
    grip.className = 'grip';
    icon.append(blade, guard, grip);
  } else if (def.tool === 'bow') {
    icon.classList.add('bow');
    icon.style.color = cssColor(def.color);
  } else if (def.shape === 'glider') {
    icon.classList.add('glider');
    icon.style.setProperty('--hide-color', cssColor(def.color));
    for (const part of ['canopy', 'left-rib', 'right-rib', 'left-cord', 'right-cord', 'harness']) {
      const piece = document.createElement('div');
      piece.className = part;
      icon.append(piece);
    }
  } else if (def.shape === 'leather' || def.shape === 'beef' || def.shape === 'armor' || def.shape === 'bucket') {
    icon.classList.add(def.shape);
    icon.style.background = cssColor(def.color);
  } else if (def.shape === 'ingot') {
    icon.classList.add('ingot');
    icon.style.background = cssColor(def.color);
  } else if (def.shape === 'seed') {
    icon.classList.add('seed');
  } else if (def.places === 'ladder') {
    icon.classList.add('ladder');
    icon.style.color = cssColor(def.color);
  } else if (def.places === 'door') {
    icon.classList.add('door');
    icon.style.background = cssColor(def.color);
  } else {
    icon.classList.add('block');
    icon.style.background = cssColor(def.color);
  }
  return icon;
}

// Fills a slot element with a stack's icon and count (or empties it).
export function renderStack(slot, stack) {
  // A fixed tooltip opens on the first pointer event, without the delay of title.
  if (slot.dataset.emptyTitle === undefined) slot.dataset.emptyTitle = slot.title;
  slot.dataset.tooltip = stack ? getItemDef(stack.item).name : slot.dataset.emptyTitle;
  slot.removeAttribute('title');
  if (!slot.dataset.tooltipBound) {
    slot.dataset.tooltipBound = 'true';
    slot.addEventListener('pointerenter', (event) => showTooltip(slot, event));
    slot.addEventListener('pointermove', (event) => showTooltip(slot, event));
    slot.addEventListener('pointerleave', () => { if (tooltip) tooltip.hidden = true; });
  }
  if (slot.matches(':hover') && tooltip && !tooltip.hidden) {
    tooltip.textContent = slot.dataset.tooltip;
    if (!slot.dataset.tooltip) tooltip.hidden = true;
  }
  slot.replaceChildren();
  if (!stack) return;
  slot.append(itemIcon(stack.item));
  if (stack.count > 1) {
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = stack.count;
    slot.append(count);
  }
}
