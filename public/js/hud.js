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
    this.maximum = null;
  }

  set(hp, maximum = MAX_HP) {
    if (hp === this.hp && maximum === this.maximum) return;
    this.hp = hp;
    this.maximum = maximum;
    this.fill.style.width = `${(hp / maximum) * 100}%`;
    this.label.textContent = `${Math.round(hp * 10) / 10} / ${maximum}`;
  }
}

const FEED_DURATION_MS = 6000;
const FEED_MAX = 5;

export class EventFeed {
  constructor(element) {
    this.element = element;
  }

  // className styles special entries, e.g. 'elim' for eliminations.
  add(text, className = '', coloredNames = []) {
    const item = document.createElement('li');
    if (!coloredNames.length) item.textContent = text;
    else {
      let rest = text;
      while (rest) {
        const match = coloredNames.map(({ name, color }) => ({ name, color, at: rest.indexOf(name) }))
          .filter((entry) => entry.name && entry.at >= 0).sort((a, b) => a.at - b.at || b.name.length - a.name.length)[0];
        if (!match) { item.append(document.createTextNode(rest)); break; }
        item.append(document.createTextNode(rest.slice(0, match.at)));
        const span = document.createElement('span');
        span.style.color = `#${match.color.toString(16).padStart(6, '0')}`;
        span.textContent = match.name;
        item.append(span);
        rest = rest.slice(match.at + match.name.length);
      }
    }
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

// A small sun or moon in the corner that rises and sets across a little arc
// through the day or the night; hovering shows how long is left.
export class DayIndicator {
  constructor(element, dayLength) {
    this.element = element;
    this.dayLength = dayLength;
    this.icon = document.createElement('span');
    this.icon.className = 'icon';
    element.append(this.icon);
    this.lastKey = null;
  }

  // time: 0..1 time of day (0 sunrise, 0.5 sunset).
  set(time) {
    const day = time < 0.5;
    const progress = (time % 0.5) / 0.5;
    const key = `${day}${Math.round(progress * 200)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.element.classList.toggle('night', !day);
    this.icon.textContent = day ? '☀' : '☾';
    this.icon.style.left = `${progress * 100}%`;
    this.icon.style.bottom = `${Math.sin(progress * Math.PI) * 60}%`;
    const minutes = Math.ceil((1 - progress) * this.dayLength / 2 / 60);
    this.element.title = `${day ? 'Day' : 'Night'}: about ${minutes} min left`;
  }
}
