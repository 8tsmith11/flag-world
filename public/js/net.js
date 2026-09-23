// Thin WebSocket wrapper: JSON in/out, dispatch by message type.

export class Connection {
  constructor(url) {
    this.handlers = new Map();
    // While paused, messages wait here and are handled in order on resume.
    this.held = null;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (this.held) this.held.push(msg);
      else this.dispatch(msg);
    });
  }

  dispatch(msg) {
    this.handlers.get(msg.type)?.(msg);
  }

  // For work that must finish before any later message is handled.
  pause() {
    this.held ??= [];
  }

  resume() {
    const held = this.held ?? [];
    this.held = null;
    for (const msg of held) this.dispatch(msg);
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  onOpen(handler) {
    this.socket.addEventListener('open', handler);
  }

  onClose(handler) {
    this.socket.addEventListener('close', handler);
  }

  send(msg) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }
}
