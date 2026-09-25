// Small DOM icons for items in the hotbar and inventory screen: blocks are a
// shaded square of their color, tools are drawn from simple shapes.

import { getItemDef } from '/shared/items.js';
import { BLOCK, getBlockDef } from '/shared/blocks.js';
import { stackName, modLines } from '/shared/modifiers.js';
import { ITEM } from '/shared/itemIds.js';
import { ACCESSORIES, RIFT_ORB } from '/shared/accessories.js';
import { attackStats, breakingStats, rangedStats, FROST } from '/shared/tools.js';
import { ARROW_DAMAGE, CROSSBOW_ARROW_DAMAGE, TICK_RATE, GRAPPLE_RANGE, GRAPPLE_COOLDOWN, ROPE_LENGTH,
  QUARRY_REGROW_TIME } from '/shared/config.js';

let tooltip = null;
let pointerX = 0, pointerY = 0;

function showTooltip(slot, event) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  const details = slot.tooltipDetails;
  if (!details) { if (tooltip) tooltip.hidden = true; return; }
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'item-tooltip';
    document.body.append(tooltip);
  }
  if (tooltip.dataset.slot !== slot.dataset.tooltipId || tooltip.dataset.version !== slot.dataset.tooltipVersion) {
    tooltip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'item-tooltip-name';
    title.textContent = details.name;
    tooltip.append(title);
    for (const [kind, lines] of [['stats', details.stats], ['effect', details.effects], ['modifier', details.mods]]) {
      if (!lines.length) continue;
      const section = document.createElement('div');
      section.className = `item-tooltip-${kind}`;
      for (const line of lines) {
        const row = document.createElement('div');
        row.textContent = line;
        section.append(row);
      }
      tooltip.append(section);
    }
    tooltip.dataset.slot = slot.dataset.tooltipId;
    tooltip.dataset.version = slot.dataset.tooltipVersion;
  }
  tooltip.hidden = false;
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(pointerX + 12, window.innerWidth - bounds.width - 8))}px`;
  const top = pointerY + bounds.height + 18 > window.innerHeight ? pointerY - bounds.height - 10 : pointerY + 14;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

let nextTooltipId = 0;

function tooltipDetails(stack) {
  const def = getItemDef(stack.item);
  const stats = [], effects = [];
  const pct = (value) => `${Math.round(value * 100)}%`;
  if (def.tool === 'hammer') {
    const tool = breakingStats(stack);
    stats.push(`Tool strength  ${tool.strength}`, `Break speed    ${Number(tool.speed.toFixed(2))}×`);
  } else if (['sword', 'windAxe', 'iceSword'].includes(def.tool)) {
    const weapon = attackStats(stack);
    stats.push(`Damage         ${weapon.damage}`, `Attack time    ${Number(weapon.cooldown.toFixed(2))}s`);
    if (weapon.knockback && weapon.knockback !== 1) effects.push(`${Number(weapon.knockback.toFixed(2))}× knockback`);
    if (weapon.breaks === false) effects.push('Cannot break blocks');
    if (weapon.frost) effects.push(`Slows targets ${pct(FROST.slow)} for ${FROST.seconds}s`);
  } else if (def.tool === 'bow' || def.tool === 'crossbow') {
    const ranged = rangedStats(stack);
    const damage = def.tool === 'bow'
      ? `${ARROW_DAMAGE[0] + ranged.damageBonus}–${ARROW_DAMAGE[1] + ranged.damageBonus}`
      : `${CROSSBOW_ARROW_DAMAGE + ranged.damageBonus}`;
    const seconds = (def.tool === 'bow' ? ranged.fullDrawTicks : ranged.loadTicks) / TICK_RATE;
    stats.push(`Arrow damage   ${damage}`, `${def.tool === 'bow' ? 'Full draw' : 'Load time'}      ${Number(seconds.toFixed(2))}s`);
    effects.push(def.tool === 'bow' ? 'Hold right click to draw; release to fire' : 'Hold right click to load; click to fire');
    effects.push('Unlimited arrows');
  } else if (def.tool === 'grapple') {
    stats.push(`Range          ${GRAPPLE_RANGE} blocks`, `Cooldown       ${GRAPPLE_COOLDOWN}s`);
    effects.push('Right click to pull yourself to a block');
  }
  if (def.armorPoints) {
    stats.push(`Armor points   ${def.armorPoints + (stack.mods?.find((mod) => mod.id === 'sturdy')?.value ?? 0)}`);
    if (def.fireImmune) effects.push('Immune to dragon fire');
  }
  const accessory = ACCESSORIES[stack.item];
  if (accessory) {
    if (accessory.moveMultiplier) stats.push(`Move speed     +${pct(accessory.moveMultiplier - 1)}`);
    if (accessory.maxHpBonus) stats.push(`Maximum HP     +${accessory.maxHpBonus}`);
    if (accessory.visual === 'spring') effects.push(`Charge a jump for ${accessory.chargeSeconds}s to leap up to ${accessory.jumpHeight} blocks`, 'Bounce when you land; prevents fall damage');
    if (accessory.regenDelay) effects.push(`Regeneration begins after ${accessory.regenDelay}s`, `Heals every ${accessory.regenInterval}s`);
    if (accessory.rescueHp) effects.push(`Survive one lethal hit with ${accessory.rescueHp} HP`, `Invulnerable for ${accessory.invulnerableSeconds}s; consumed on use`);
  }
  if (stack.item === BLOCK.GOBLIN_BRICKS) effects.push('Requires tool strength 8 to break');
  if (stack.item === BLOCK.QUARRY_STONE) effects.push(`Each open face regrows stone every ${QUARRY_REGROW_TIME}s`, 'Requires tool strength 8 to break');
  if (def.mobType) effects.push(`Right click a block to spawn a ${def.name.replace(' spawn egg', '')}`);
  if (stack.item === ITEM.RIFT_ORB) effects.push(`Throw to create a ${RIFT_ORB.durationSeconds}s portal where it lands`,
    'Fizzles into a dropped orb inside a keep zone');
  if (stack.item === ITEM.GOLDEN_BEEF) effects.push('Fully restores HP instantly when eaten');
  else if (def.food) effects.push(`Restores ${def.food} HP over time when eaten`);
  if (stack.item === ITEM.GLIDER) effects.push('Hold right click in the air to glide');
  if (stack.item === ITEM.ROPE_BUNDLE) effects.push(`Hangs up to ${ROPE_LENGTH} blocks of climbable rope`);
  return { name: stackName(stack, def.name), stats, effects, mods: modLines(stack) };
}

const ICON_PARTS = {
  axe: ['handle', 'bit left', 'bit right'],
  crossbow: ['stock', 'limbs'],
  grapple: ['shaft', 'prongs'],
  rope: ['coil'],
};

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
  } else if (def.tool === 'sword' || def.tool === 'iceSword') {
    icon.classList.add('sword');
    if (def.tool === 'iceSword') icon.classList.add('ice');
    const blade = document.createElement('div');
    blade.className = 'blade';
    blade.style.background = cssColor(def.color);
    const guard = document.createElement('div');
    guard.className = 'guard';
    const grip = document.createElement('div');
    grip.className = 'grip';
    icon.append(blade, guard, grip);
  } else if (def.tool === 'windAxe' || def.tool === 'crossbow' || def.tool === 'grapple' || def.shape === 'rope') {
    // Drawn from parts in CSS, tinted by the item's color.
    const kind = def.shape === 'rope' ? 'rope' : { windAxe: 'axe', crossbow: 'crossbow', grapple: 'grapple' }[def.tool];
    icon.classList.add(kind);
    icon.style.color = cssColor(def.color);
    for (const part of ICON_PARTS[kind]) {
      const piece = document.createElement('div');
      piece.className = part;
      icon.append(piece);
    }
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
  } else if (def.shape === 'leather' || def.shape === 'beef' || def.shape === 'armor' || def.shape === 'bucket'
    || def.shape === 'scale' || def.shape === 'silk') {
    icon.classList.add(def.shape);
    if (def.texture === 'scales') icon.classList.add('scaled');
    icon.style.background = cssColor(def.color);
  } else if (def.block !== null && getBlockDef(def.block).shape === 'anvil') {
    icon.classList.add('anvil');
    for (const part of ['face', 'horn', 'waist', 'foot']) {
      const piece = document.createElement('div');
      piece.className = part;
      icon.append(piece);
    }
  } else if (def.shape === 'ingot') {
    icon.classList.add('ingot');
    icon.style.background = cssColor(def.color);
  } else if (def.shape === 'seed') {
    icon.classList.add('seed');
  } else if (def.shape === 'accessory') {
    icon.classList.add('accessory');
    icon.dataset.kind = ACCESSORIES[item].visual;
    icon.style.setProperty('--item-color', cssColor(def.color));
    for (const part of ['accent', 'gem']) {
      const piece = document.createElement('div');
      piece.className = part;
      icon.append(piece);
    }
  } else if (def.shape === 'rift') {
    icon.classList.add('rift');
    icon.style.setProperty('--item-color', cssColor(def.color));
  } else if (def.shape === 'egg') {
    icon.classList.add('egg');
    icon.style.setProperty('--item-color', cssColor(def.color));
    icon.style.setProperty('--spots-color', cssColor(def.spots));
  } else if (def.places === 'ladder') {
    icon.classList.add('ladder');
    icon.style.color = cssColor(def.color);
  } else if (def.places === 'door') {
    icon.classList.add('door');
    icon.style.background = cssColor(def.color);
  } else {
    icon.classList.add('block');
    if (item === BLOCK.GOBLIN_BRICKS) icon.classList.add('goblin-bricks');
    if (item === BLOCK.QUARRY_STONE) icon.classList.add('quarry');
    icon.style.background = cssColor(def.color);
  }
  return icon;
}

// Fills a slot element with a stack's icon and count (or empties it).
export function renderStack(slot, stack) {
  // A fixed tooltip opens on the first pointer event, without the delay of title.
  if (slot.dataset.emptyTitle === undefined) slot.dataset.emptyTitle = slot.title;
  slot.tooltipDetails = stack ? tooltipDetails(stack)
    : slot.dataset.emptyTitle ? { name: slot.dataset.emptyTitle, stats: [], effects: [], mods: [] } : null;
  slot.dataset.tooltipId ??= String(++nextTooltipId);
  slot.dataset.tooltipVersion = String(Number(slot.dataset.tooltipVersion ?? 0) + 1);
  slot.classList.toggle('modded', !!stack?.mods?.length);
  slot.removeAttribute('title');
  if (!slot.dataset.tooltipBound) {
    slot.dataset.tooltipBound = 'true';
    slot.addEventListener('pointerenter', (event) => showTooltip(slot, event));
    slot.addEventListener('pointermove', (event) => showTooltip(slot, event));
    slot.addEventListener('pointerleave', () => { if (tooltip) tooltip.hidden = true; });
  }
  if (slot.matches(':hover') && tooltip && !tooltip.hidden) {
    showTooltip(slot, { clientX: pointerX, clientY: pointerY });
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
