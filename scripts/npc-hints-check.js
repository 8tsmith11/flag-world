// `node scripts/npc-hints-check.js`: every Wise Monkey hint and clue
// condition evaluates against a fresh team state without errors, names only
// registered items, and the hints can be passed one by one in order.

import { WISE_MONKEY_HINTS, WISE_MONKEY_CLUES, WISE_MONKEY_COMPLETE, WISE_MONKEY_STRANGERS,
  ANCIENT_MONKEY_RESPONSES } from '../shared/npcLines.js';
import { conditionMet, emptyProgress } from '../shared/dialogue.js';
import { registeredItemIds } from '../shared/items.js';
import { MONKEY_SOUNDS } from '../shared/audio.js';

const known = new Set(registeredItemIds());
const problems = [];
const ids = (condition, out = []) => {
  if (!condition) return out;
  for (const c of [...(condition.all ?? []), ...(condition.any ?? [])]) ids(c, out);
  for (const key of ['obtained', 'crafted', 'placed']) for (const id of condition[key] ?? []) out.push([key, id]);
  return out;
};
const lines = (name, list) => {
  if (!list?.length) problems.push(`${name}: no lines`);
  for (const line of list ?? []) {
    if ((line.match(/[.!?](\s|$)/g) ?? []).length > 2) problems.push(`${name}: more than two sentences: ${line}`);
  }
};

for (const features of [{}, { stormCloud: true, gorgeCave: true }]) {
  for (const entry of [...WISE_MONKEY_HINTS.map((h) => ['hint', h.id, h.done]), ...WISE_MONKEY_CLUES.map((c) => ['clue', c.id, c.when])]) {
    try {
      const met = conditionMet(entry[2], { progress: emptyProgress(), features });
      if (entry[0] === 'hint' && met) problems.push(`hint ${entry[1]} is already done on a fresh team`);
    } catch (error) {
      problems.push(`${entry[0]} ${entry[1]}: ${error.message}`);
    }
  }
}
for (const hint of WISE_MONKEY_HINTS) {
  lines(`hint ${hint.id}`, hint.lines);
  for (const [, id] of ids(hint.done)) if (!known.has(id)) problems.push(`hint ${hint.id}: unknown item ${id}`);
}
for (const clue of WISE_MONKEY_CLUES) lines(`clue ${clue.id}`, clue.lines);
lines('complete', WISE_MONKEY_COMPLETE);
lines('strangers', WISE_MONKEY_STRANGERS);
for (const response of ANCIENT_MONKEY_RESPONSES) {
  if (!MONKEY_SOUNDS[response.sound]) problems.push(`ancient response: unknown sound ${response.sound}`);
  lines(`ancient ${response.sound}`, response.lines);
}

// Doing what each hint asks (its first option) moves the monkey on to the next one.
const firstOption = (condition, out = []) => {
  if (condition.all) for (const c of condition.all) firstOption(c, out);
  else if (condition.any) firstOption(condition.any[0], out);
  else for (const key of ['obtained', 'crafted', 'placed']) if (condition[key]) out.push([key, condition[key][0]]);
  return out;
};
const progress = emptyProgress();
WISE_MONKEY_HINTS.forEach((hint, index) => {
  const next = WISE_MONKEY_HINTS.find((entry) => !conditionMet(entry.done, { progress, features: {} }));
  if (next !== hint) problems.push(`expected hint ${hint.id} at step ${index}, got ${next?.id}`);
  for (const [key, id] of firstOption(hint.done)) progress[key].add(id);
});
if (WISE_MONKEY_HINTS.some((hint) => !conditionMet(hint.done, { progress, features: {} }))) problems.push('hints never complete');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${WISE_MONKEY_HINTS.length} hints and ${WISE_MONKEY_CLUES.length} clues evaluate on a fresh team; `
  + `first hint "${WISE_MONKEY_HINTS[0].id}"`);
