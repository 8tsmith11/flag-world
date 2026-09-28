import { AUDIO as C } from '/shared/config.js';
const clamp = n => Math.max(0, Math.min(1, n));
export class AudioSettings {
  constructor() {
    this.listeners = new Set();
    this.sliders = [];
    // Reuse the lobby music volume and expose it in the settings panel.
    const music = document.getElementById('music-volume');
    music.dataset.audioVolume = 'music';
    const container = document.getElementById('settings');
    for (const name of Object.keys(C.volumes)) {
      const label = document.createElement('label');
      label.textContent = `${name[0].toUpperCase()}${name.slice(1)} `;
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01';
      input.dataset.audioVolume = name;
      label.append(input, document.createElement('span')); container.append(label);
    }
    for (const slider of document.querySelectorAll('[data-audio-volume]')) {
      slider.step = '0.01';
      const output = slider.parentElement.querySelector('span');
      this.sliders.push({ slider, output });
      slider.addEventListener('input', () => {
        this.volumes[slider.dataset.audioVolume] = clamp(Number(slider.value));
        this.changed();
        try { localStorage.setItem(this.key, JSON.stringify(this.volumes)); } catch {}
      });
    }
    this.setPlayer(this.savedName());
    document.getElementById('lobby-name').addEventListener('change', event => this.setPlayer(event.target.value));
  }
  savedName() { try { return localStorage.getItem('flagWorld.name') ?? ''; } catch { return ''; } }
  setPlayer(name) {
    this.key = `flagWorld.audio.${name.trim().toLowerCase()}`;
    this.volumes = { ...C.volumes };
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? '{}');
      const oldMusic = localStorage.getItem('flagWorld.musicVolume');
      if (oldMusic !== null && Number.isFinite(Number(oldMusic))) this.volumes.music = clamp(Number(oldMusic));
      for (const channel of Object.keys(C.volumes)) if (Number.isFinite(saved[channel])) this.volumes[channel] = clamp(saved[channel]);
    } catch {}
    this.changed();
  }
  changed() {
    for (const { slider, output } of this.sliders) {
      const volume = this.volumes[slider.dataset.audioVolume];
      slider.value = String(volume); output.textContent = ` ${Math.round(volume * 100)}%`;
    }
    for (const listener of this.listeners) listener(this.volumes);
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.volumes); }
}
