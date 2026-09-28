// Spoken NPC lines (the server's private `speak`): a subtitle at the bottom
// center, speaker's name then the line, which fades after a time based on
// its length; and the voice (shared/dialogue.js). 'speech' voices use the
// browser's speech synthesis at the master x voice volume; without it the
// subtitle still shows. 'sound' voices play a sound at the speaker on the
// effects bus, with the line describing it.

import { AUDIO, DIALOGUE } from '/shared/config.js';
import { VOICES, subtitleSeconds } from '/shared/dialogue.js';
import { MONKEY_SOUNDS } from '/shared/audio.js';

// A speech line keeps its subtitle up until it has been spoken, up to this
// much past the usual time.
const SPEECH_GRACE = 4;

export class Dialogue {
  constructor(element, settings, mixer) {
    this.element = element;
    this.speaker = element.querySelector('.speaker');
    this.line = element.querySelector('.line');
    this.settings = settings;
    this.mixer = mixer;
    this.synth = typeof window.speechSynthesis === 'object' ? window.speechSynthesis : null;
    this.voices = [];
    this.speaking = false;
    this.timers = [];
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices(); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }

  // line: { name, text, voice, sound? }; position: where the speaker is.
  // Returns the seconds the subtitle stays up.
  say({ name, text, voice, sound }, position) {
    const profile = VOICES[voice] ?? { mode: 'speech' };
    const soundOnly = profile.mode === 'sound';
    const seconds = subtitleSeconds(text, soundOnly);
    this.show(name, text, soundOnly, seconds);
    if (soundOnly) {
      const paths = MONKEY_SOUNDS[sound];
      if (paths) this.mixer.play(paths, AUDIO.monkeyGain, position, AUDIO.monkeyRange, AUDIO.monkeyRate);
    } else {
      this.speak(text, profile);
    }
    return seconds;
  }

  show(name, text, sound, seconds) {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.speaker.textContent = `${name}:`;
    this.line.textContent = text;
    this.line.classList.toggle('sound', sound);
    this.element.classList.remove('fading');
    this.element.hidden = false;
    const started = performance.now();
    const fade = () => {
      // Let a slow voice finish its sentence first.
      if (this.speaking && performance.now() - started < (seconds + SPEECH_GRACE) * 1000) {
        this.timers.push(setTimeout(fade, 250));
        return;
      }
      this.element.classList.add('fading');
      this.timers.push(setTimeout(() => { this.element.hidden = true; }, DIALOGUE.subtitleFade * 1000));
    };
    this.timers.push(setTimeout(fade, seconds * 1000));
  }

  speak(text, profile) {
    if (!this.synth || typeof SpeechSynthesisUtterance !== 'function') return;
    const volume = (this.settings.volumes.master ?? 1) * (this.settings.volumes.voice ?? 1);
    this.synth.cancel();
    if (volume <= 0.001) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = profile.pitch ?? 1;
    utterance.rate = profile.rate ?? 1;
    utterance.volume = Math.min(1, volume);
    const voice = this.pickVoice(profile);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onend = utterance.onerror = () => { if (this.utterance === utterance) this.speaking = false; };
    this.utterance = utterance;
    this.speaking = true;
    this.synth.speak(utterance);
  }

  // The first preferred voice by name, else an English one, else the default.
  pickVoice(profile) {
    const english = this.voices.filter((voice) => /^en/i.test(voice.lang));
    for (const name of profile.preferred ?? []) {
      const match = english.find((voice) => voice.name.includes(name));
      if (match) return match;
    }
    return english[0] ?? null;
  }

  // Leaving the match or dying: silence and hide.
  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.synth?.cancel();
    this.speaking = false;
    this.element.hidden = true;
  }
}
