// Who fights whom, shared by arrow turrets, guard monkeys, lookout monkeys and
// the arrows they shoot. A "side" is a team index (players, tamed monkeys,
// turrets) or null for something that belongs to no team.
//
// Hostile to a team:
//   - players of another team (alive, connected, not eliminated or invisible)
//   - tamed working monkeys of another team (wild monkeys are left alone)
//   - goblins (every goblin unit, including the Totem)
//   - Crawlers, Void Eels and dragons
// Never hostile: the team's own players and monkeys, cows, wild monkeys,
// Wise and Ancient Monkeys, and Sky Merchants.
import { huntable } from './provocation.js';
import { isGoblin } from './fortressTraps.js';
import { NPC_KIND } from '../shared/npcs.js';

const HOSTILE_MOBS = new Set(['crawler', 'voidEel', 'dragon']);

export function isWorkMonkey(target) {
  return target?.npc === NPC_KIND.WORK_MONKEY;
}

// What kind of hostile `target` is to `team`, or null: 'player', 'monkey',
// 'goblin' or 'creature'. Used for lookout reports as well as targeting.
export function hostileKind(team, target) {
  if (!target || target.dead || !target.state || !huntable(target)) return null;
  if (target.type === 'player') return target.team !== team ? 'player' : null;
  if (isGoblin(target)) return 'goblin';
  if (HOSTILE_MOBS.has(target.type)) return 'creature';
  if (isWorkMonkey(target)) {
    // Babies never fight, so nothing fights them either.
    if (target.team === null || target.team === undefined || target.baby) return null;
    return target.team !== team ? 'monkey' : null;
  }
  return null;
}

export function isHostileTo(team, target) {
  return hostileKind(team, target) !== null;
}

// Everything that could be hostile to someone: players, goblins and hostile
// creatures, and tamed monkeys. Active (loaded) entities only.
export function* hostileCandidates(game) {
  const active = (map) => map.activeValues?.() ?? map.values();
  yield* game.players.values();
  if (game.mobs) yield* active(game.mobs);
  if (game.dragons) yield* active(game.dragons);
  if (game.npcs) for (const npc of active(game.npcs)) if (isWorkMonkey(npc) && npc.team !== null) yield npc;
}

// What an arrow from `shooter` may hit, from the candidate lists: a team
// shooter (turret or monkey) hits only things hostile to its team, so it can
// never hurt a teammate or a friendly creature.
export function teamArrowTargets(team, lists) {
  const out = [];
  for (const list of lists) for (const target of list) if (isHostileTo(team, target)) out.push(target);
  return out;
}
