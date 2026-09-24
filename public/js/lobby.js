// Pregame screens: the lobby (name, color, ready, host start) and the
// "match in progress" screen shown to players who connect after the start.

import { C2S, TEAMS } from '/shared/protocol.js';
import { WORLD_SIZES } from '/shared/worldgen.js';

const NAME_KEY = 'flagWorld.name';

// The last name this browser used, so a refresh rejoins as the same player.
export function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage unavailable (private mode etc.); reconnecting by name just won't be automatic.
  }
}

function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function playerRow(name, color, tag, status, statusClass) {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = cssColor(color);
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  li.append(dot, label);
  if (tag) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    li.append(t);
  }
  const s = document.createElement('span');
  s.className = `status ${statusClass}`;
  s.textContent = status;
  li.append(s);
  return li;
}

export class LobbyScreen {
  constructor(conn) {
    this.conn = conn;
    this.el = (id) => document.getElementById(id);
    this.nameInput = this.el('lobby-name');
    this.teamSelect = this.el('lobby-team');
    TEAMS.forEach((team, i) => this.teamSelect.add(new Option(team.name, String(i))));
    this.readyButton = this.el('lobby-ready');
    this.startButton = this.el('lobby-start');
    this.seedInput = this.el('lobby-seed');
    this.sizeSelect = this.el('lobby-size');
    for (const [key, { label }] of Object.entries(WORLD_SIZES)) this.sizeSelect.add(new Option(label, key));
    this.error = this.el('lobby-error');
    this.me = null;

    // Sent on blur / Enter rather than per keystroke, so the server only sees finished names.
    this.nameInput.addEventListener('change', () => {
      this.error.textContent = '';
      this.conn.send({ type: C2S.LOBBY_UPDATE, name: this.nameInput.value });
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.nameInput.blur();
    });
    this.teamSelect.addEventListener('change', () => {
      this.conn.send({ type: C2S.LOBBY_UPDATE, team: Number(this.teamSelect.value) });
    });
    this.readyButton.addEventListener('click', () => {
      if (this.me) this.conn.send({ type: C2S.LOBBY_UPDATE, ready: !this.me.ready });
    });
    this.sizeSelect.addEventListener('change', () => {
      this.conn.send({ type: C2S.LOBBY_UPDATE, worldSize: this.sizeSelect.value });
    });
    this.startButton.addEventListener('click', () => {
      this.conn.send({ type: C2S.START_MATCH, seed: this.seedInput.value });
    });
  }

  // msg: the server's LOBBY message.
  update(msg) {
    this.me = msg.players.find((p) => p.id === msg.you);
    const isHost = msg.hostId === msg.you;
    saveName(this.me.name);

    // Don't overwrite what the player is in the middle of typing or picking.
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.me.name;
    if (document.activeElement !== this.teamSelect) this.teamSelect.value = String(this.me.team);
    this.readyButton.textContent = this.me.ready ? 'Ready ✓' : 'Ready';
    this.readyButton.classList.toggle('on', this.me.ready);

    const list = this.el('lobby-players');
    list.replaceChildren(...msg.players.map((p) => {
      const tags = [TEAMS[p.team]?.name, p.id === msg.hostId && 'host', p.id === msg.you && 'you'].filter(Boolean).join(', ');
      return playerRow(p.name, p.color, tags, p.ready ? 'Ready' : 'Not ready', p.ready ? 'ready' : 'waiting');
    }));

    this.el('lobby-world').textContent = `World size: ${WORLD_SIZES[msg.worldSize]?.label ?? msg.worldSize}`;
    if (document.activeElement !== this.sizeSelect) this.sizeSelect.value = msg.worldSize;
    this.el('lobby-host').hidden = !isHost;
    this.el('lobby-waiting').hidden = isHost;
    this.startButton.disabled = !msg.players.every((p) => p.ready);
  }

  showError(message) {
    this.error.textContent = message;
  }
}

export class MatchScreen {
  constructor(conn) {
    this.conn = conn;
    this.list = document.getElementById('match-players');
    this.error = document.getElementById('match-error');
  }

  // msg: the server's MATCH_IN_PROGRESS message.
  update(msg) {
    this.list.replaceChildren(...msg.players.map((p) => {
      const li = playerRow(p.name, p.color, '', p.connected ? 'Playing' : 'Disconnected',
        p.connected ? 'connected' : 'disconnected');
      if (!p.connected) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Reclaim';
        button.addEventListener('click', () => {
          this.error.textContent = '';
          saveName(p.name);
          this.conn.send({ type: C2S.RECLAIM, name: p.name });
        });
        li.append(button);
      }
      return li;
    }));
  }

  showError(message) {
    this.error.textContent = message;
  }
}
