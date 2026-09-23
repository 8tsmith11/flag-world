// On-screen FPS counter and player coordinates, shown when DEBUG is on.

import { DEBUG, CHUNK_SIZE } from '/shared/config.js';

export class DebugHud {
  constructor(element) {
    this.element = element;
    this.enabled = DEBUG;
    this.element.hidden = !DEBUG;
    this.frames = 0;
    this.lastSample = performance.now();
    this.fps = 0;
  }

  update(info) {
    if (!this.enabled) return;
    this.frames++;
    const now = performance.now();
    if (now - this.lastSample >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastSample));
      this.frames = 0;
      this.lastSample = now;
    }
    const { x, y, z } = info.position;
    this.element.textContent = [
      `FPS ${this.fps}`,
      `XYZ ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`,
      `Chunk ${Math.floor(x / CHUNK_SIZE)} ${Math.floor(y / CHUNK_SIZE)} ${Math.floor(z / CHUNK_SIZE)}`,
      `Chunks ${info.chunks}  Players ${info.players}`,
      `Player #${info.id}  Seed ${info.seed}`,
      `Target ${info.target ?? '-'}`,
    ].join('\n');
  }
}
