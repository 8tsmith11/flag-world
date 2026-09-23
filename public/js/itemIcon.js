// Small DOM icons for items in the hotbar and inventory screen: blocks are a
// shaded square of their color, tools are drawn from simple shapes.

import { getItemDef } from '/shared/items.js';

export function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function itemIcon(item) {
  const def = getItemDef(item);
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.title = def.name;
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
  } else if (def.shape === 'leather' || def.shape === 'beef') {
    icon.classList.add(def.shape);
    icon.style.background = cssColor(def.color);
  } else if (def.shape === 'ingot') {
    icon.classList.add('ingot');
    icon.style.background = cssColor(def.color);
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
