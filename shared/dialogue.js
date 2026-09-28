// Spoken dialogue, shared by every NPC: voices, subtitle timing, and the
// conditions and line choice used by the server (lines are in npcLines.js).
//
// A voice is how a speaker is heard:
//   'speech' - the line is spoken with the browser's speech synthesis
//              (pitch, rate and preferred voice names), and subtitled
//   'sound'  - one of the named sounds (MONKEY_SOUNDS in audio.js) plays at
//              the speaker, with a short description as the subtitle

import { DIALOGUE } from './config.js';

export const VOICES = {
  wiseMonkey: {
    mode: 'speech', ...DIALOGUE.voices.wiseMonkey,
    // First name found wins; otherwise any English voice, then the default.
    preferred: ['Daniel', 'Google UK English Male', 'Microsoft George', 'Microsoft David', 'Alex', 'Fred', 'Male'],
  },
  ancientMonkey: { mode: 'sound' },
};

// Seconds a subtitle stays up before it fades.
export function subtitleSeconds(text, sound = false) {
  if (sound) return DIALOGUE.soundSubtitle;
  return Math.min(DIALOGUE.subtitleMax,
    Math.max(DIALOGUE.subtitleMin, DIALOGUE.subtitleBase + text.length * DIALOGUE.subtitlePerChar));
}

// What a team has done, as the server tracks it (server/teamProgress.js).
export function emptyProgress() {
  return { obtained: new Set(), crafted: new Set(), placed: new Set() };
}

// Conditions are data:
//   { obtained: [ids] }  any of these items has been in a member's inventory
//   { crafted: [ids] }   a member crafted any of these
//   { placed: [ids] }    a member placed any of these (item ids, as held)
//   { feature: name }    the world has this (context.features[name])
//   { all: [conds] }, { any: [conds] }
// A missing condition is always met. context: { progress, features }.
export function conditionMet(condition, context) {
  if (!condition) return true;
  const { progress, features = {} } = context;
  if (condition.all) return condition.all.every((c) => conditionMet(c, context));
  if (condition.any) return condition.any.some((c) => conditionMet(c, context));
  if (condition.feature) return !!features[condition.feature];
  for (const key of ['obtained', 'crafted', 'placed']) {
    if (condition[key]) return condition[key].some((id) => progress[key].has(id));
  }
  throw new Error(`Unknown dialogue condition ${JSON.stringify(condition)}`);
}

// A random variant, avoiding `last` when there is a choice.
export function chooseLine(lines, random = Math.random, last = null) {
  const pool = lines.length > 1 ? lines.filter((line) => line !== last) : lines;
  return pool[Math.floor(random() * pool.length)];
}
