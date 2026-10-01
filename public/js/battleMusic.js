import { DRAGON_LORD as C } from '/shared/config.js';

export class BattleMusic {
  constructor(settings) {
    this.settings = settings;
    this.track = new Audio('/audio/dragon-lord-battle.wav');
    this.track.loop = true;
    this.track.preload = 'none';
    this.track.volume = 0;
    this.victory = new Audio('/audio/dragon-lord-victory.ogg');
    this.victory.preload = 'none';
    this.level = 0;
    this.target = false;
    settings.subscribe(() => this.applyVolume());
  }
  setActive(active) {
    if (active && !this.target) this.track.play().catch(() => {});
    this.target = active;
  }
  update(dt) {
    this.level += (Number(this.target) - this.level) * Math.min(1, dt / C.musicFade * 3);
    if (!this.target && this.level < 0.002 && !this.track.paused) {
      this.track.pause(); this.track.currentTime = 0;
    }
    this.applyVolume();
  }
  applyVolume() {
    const volume = this.settings.volumes.master * this.settings.volumes.music;
    this.track.volume = Math.min(1, volume * C.musicGain * this.level);
    this.victory.volume = Math.min(1, volume * C.victoryGain);
  }
  playVictory() {
    this.setActive(false);
    this.victory.currentTime = 0;
    this.victory.play().catch(() => {});
  }
  stop() {
    this.setActive(false);
    this.level = 0;
    this.track.pause(); this.track.currentTime = 0;
    this.victory.pause(); this.victory.currentTime = 0;
  }
}
