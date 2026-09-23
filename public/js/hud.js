// In-match HUD: health bar, kill feed, flag grab progress, private flag
// notifications and the "carrying a flag" label.

import { MAX_HP } from '/shared/config.js';

export class HealthBar {
  constructor(element) {
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    this.label = document.createElement('span');
    this.label.className = 'label';
    element.append(this.fill, this.label);
    this.hp = null;
  }

  set(hp) {
    if (hp === this.hp) return;
    this.hp = hp;
    this.fill.style.width = `${(hp / MAX_HP) * 100}%`;
    this.label.textContent = `${hp} / ${MAX_HP}`;
  }
}

const FEED_DURATION_MS = 6000;
const FEED_MAX = 5;

export class EventFeed {
  constructor(element) {
    this.element = element;
  }

  // className styles special entries, e.g. 'elim' for eliminations.
  add(text, className = '') {
    const item = document.createElement('li');
    item.textContent = text;
    if (className) item.className = className;
    this.element.append(item);
    while (this.element.children.length > FEED_MAX) this.element.firstChild.remove();
    setTimeout(() => item.remove(), FEED_DURATION_MS);
  }
}

// Progress bar while standing on an enemy flag.
export class ProgressBar {
  constructor(element) {
    this.element = element;
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Taking flag…';
    element.append(this.fill, label);
    element.hidden = true;
  }

  // progress: 0..1; 0 hides the bar.
  set(progress) {
    this.element.hidden = progress <= 0;
    this.fill.style.width = `${Math.min(1, progress) * 100}%`;
  }
}

const TOAST_MS = 3500;

// A message in the middle of the screen that fades after a few seconds.
export class Toast {
  constructor(element) {
    this.element = element;
    this.timer = null;
  }

  show(text) {
    this.element.textContent = text;
    this.element.hidden = false;
    // Restart the fade animation.
    this.element.classList.remove('show');
    void this.element.offsetWidth;
    this.element.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.element.hidden = true; }, TOAST_MS);
  }
}

// A persistent line of text, hidden when empty.
export class Label {
  constructor(element) {
    this.element = element;
    this.text = null;
  }

  set(text) {
    if (text === this.text) return;
    this.text = text;
    this.element.textContent = text;
    this.element.hidden = !text;
  }
}
