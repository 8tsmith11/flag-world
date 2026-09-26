// Creative-mode goblin inspector: while a creative player looks at the
// Goblin Totem, a panel shows the fortress's state from the latest
// GOBLIN_STATUS (current project and progress, population by type
// against capacity, module and dwelling counts, offscreen mode).

import { GOBLINS } from '/shared/goblins.js';
import { raycastPlayers } from '/shared/raycast.js';

// How far away the totem can be looked at.
const RANGE = 48;
const TYPES = [['goblinWorker', 'Workers'], ['goblinSoldier', 'Soldiers'], ['goblinArcher', 'Archers'], ['goblinHound','Hounds'], ['goblinBrute','Brutes']];

export class GoblinInspector {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'goblin-inspector';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.status = null;
    this.shown = null;
  }

  setStatus(msg) {
    this.status = msg;
    if (!this.el.hidden) this.render();
  }

  // Per frame: shown while `creative` and the view ray (from `eye` along
  // `dir`, up to `blockT` where a block stops it) hits the totem.
  update(creative, totem, eye, dir, blockT) {
    let looking = false;
    if (creative && this.status?.totemAlive && totem) {
      const box = { halfW: GOBLINS.totem.width / 2, height: GOBLINS.totem.height };
      const target = { id: 'totem', state: { x: totem.x, y: totem.y, z: totem.z, box } };
      looking = !!raycastPlayers(eye, dir, Math.min(blockT ?? RANGE, RANGE), [target], (p) => p.state.box);
    }
    if (looking === !this.el.hidden) return;
    this.el.hidden = !looking;
    if (looking) this.render();
  }

  render() {
    const s = this.status;
    if (!s) return;
    const row = (label, value) => `<div class="gi-row"><span>${label}</span><span>${value}</span></div>`;
    const project = s.project
      ? `${s.project.label} — ${Math.round(s.project.progress * 100)}% (${s.project.done}/${s.project.total})`
      : s.totemAlive ? `none (next in ${s.nextProjectIn}s)` : 'none';
    this.el.innerHTML = `
      <div class="gi-title">Goblin Totem${s.offscreen ? ' <span class="gi-off">offscreen</span>' : ''}</div>
      <div class="gi-section">Project</div>
      <div class="gi-row gi-wide">${project}</div>
      <div class="gi-section">Population ${s.total} / ${s.capacity} (max ${s.hardCap})</div>
      ${TYPES.map(([key, label]) => row(label, s.population[key] ?? 0)).join('')}
      <div class="gi-section">Buildings</div>
      ${row('Brick modules', `${s.modules} / ${s.moduleCap}`)}
      ${row('Dwellings', `${s.dwellings} / ${s.dwellingCap}`)}
      ${row('Castle', s.castle ? 'complete' : 'pending')}
      ${row('Tree plots', s.plots)}
      ${row('Entrances', s.entrances.length ? s.entrances.map((e) => `${e.width} wide${e.gatehouse ? '' : ', no gatehouse'}`).join('; ') : 'none')}
      ${row('Bodies spawned', s.spawnedEntities ?? 0)}
      ${row('Tier', s.tier ?? 1)}
      ${row('Siege', s.siege?.phase ?? 'none')}
      ${row('Target / plan', `${s.siege?.target ?? '—'} / ${s.siege?.bridgePlan ?? '—'}`)}
      ${row('Wood / reserve / needed', `${s.siege?.wood ?? 0} / ${s.siege?.reserved ?? 0} / ${s.siege?.needed ?? 0}`)}
      ${row('Army spawned / remaining', `${s.siege?.spawned ?? 0} / ${s.siege?.remaining ?? 0}`)}
      ${row('Budget', Object.entries(s.siege?.budget ?? {}).map(([k,v])=>`${k.replace('goblin','')} ${v}`).join(', '))}
      ${row('Time remaining', `${Math.ceil(s.siege?.secondsRemaining ?? 0)}s`)}
      ${(s.siege?.workers ?? []).map((w)=>row(`Worker #${w.id}`,`${w.activity}, ${w.x},${w.y},${w.z}${w.distanceToWork === null ? '' : `; ${w.distanceToWork} blocks to work`}`)).join('')}
      ${(s.siege?.machines ?? []).map((m)=>row(m.type.replace('goblin',''),`${m.hp} HP, ${m.phase === "loading" ? "loading siege passengers" : m.phase}, crew ${m.crew ?? '—'}, cargo ${m.cargo}, bombs ${m.bombs}`)).join('')}
      <div class="gi-row gi-wide">G: force siege · T: raise tier</div>
      <div class="gi-section">Goblin slots</div>
      ${(s.slots ?? []).map((g) => row(`#${g.slot} ${g.role.replace('goblin', '')}`,
        `${g.assignment}, ${g.activity}, ${g.hp} HP, ${g.spawned ? 'spawned' : 'sim'}, ${g.x},${g.y},${g.z}`)).join('')}`;
  }
}
