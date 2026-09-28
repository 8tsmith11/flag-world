// NPC kinds as data. An NPC entity is ENTITY_TYPE.NPC with `npc` set to a key
// here; the server spawns them at world.npcSites (npcSites.js) and runs their
// behavior (server/npcs.js), and the client picks the model and voice from
// the same entry.
//
//   model     - client model factory (render/monkeyModels.js)
//   element   - tint and effects for Ancient Monkeys
//   box       - feet-anchored { halfW, height }, for punches and talking
//   hp        - health, or null for an NPC that cannot be damaged
//   behavior  - 'seated' (sits, turns its head) or 'restless' (sits, then
//               stands, beats its chest, strolls and sits back down)
//   voice     - how it is heard (VOICES in dialogue.js)
//   dialogue  - its lines (DIALOGUE_LINES in npcLines.js)

import { NPC } from './config.js';
import { TEAMS } from './protocol.js';

export const NPC_KIND = {
  WISE_MONKEY: 'wiseMonkey',
  ANCIENT_WATER_MONKEY: 'ancientWaterMonkey',
  ANCIENT_LIGHTNING_MONKEY: 'ancientLightningMonkey',
};

export const NPC_DEFS = {
  [NPC_KIND.WISE_MONKEY]: {
    model: 'orangutan', box: NPC.wiseMonkey.box, hp: NPC.wiseMonkey.hp,
    behavior: 'seated', voice: 'wiseMonkey', dialogue: 'wiseMonkey',
  },
  // LATER UPDATE: the Ancient Monkeys cannot be damaged (hp: null) and have
  // no abilities yet. Give them hp and abilities here and in server/npcs.js.
  [NPC_KIND.ANCIENT_WATER_MONKEY]: {
    name: 'Ancient Water Monkey', model: 'gorilla', element: 'water', box: NPC.ancientMonkey.box,
    hp: null, behavior: 'restless', voice: 'ancientMonkey', dialogue: 'ancientMonkey',
  },
  [NPC_KIND.ANCIENT_LIGHTNING_MONKEY]: {
    name: 'Ancient Lightning Monkey', model: 'gorilla', element: 'lightning', box: NPC.ancientMonkey.box,
    hp: null, behavior: 'restless', voice: 'ancientMonkey', dialogue: 'ancientMonkey',
  },
};

// Wise Monkeys are named after their team: "Wise Blue Monkey".
export function npcName(kind, team = null) {
  if (kind === NPC_KIND.WISE_MONKEY) return `Wise ${TEAMS[team]?.name ?? 'Grey'} Monkey`;
  return NPC_DEFS[kind]?.name ?? 'Monkey';
}
