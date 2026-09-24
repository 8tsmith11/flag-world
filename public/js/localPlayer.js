// Client-side prediction for the local player. Inputs are simulated immediately
// with the shared physics, then replayed on top of each authoritative server state.

import { stepPlayer } from '/shared/physics.js';

export class LocalPlayer {
  constructor(id, color, state, world) {
    this.id = id;
    this.color = color;
    this.world = world;
    this.state = { ...state };
    // State before the latest tick, for render interpolation between ticks.
    this.prev = { ...state };
    // Continue from the server's last seq; after a reclaim it is already past 0.
    this.seq = state.lastSeq ?? 0;
    // Inputs sent but not yet acknowledged by the server.
    this.pending = [];
  }

  // Runs one tick with the given controls; returns the input to send.
  tick(controls) {
    const input = { seq: ++this.seq, ...controls };
    this.prev = { ...this.state };
    stepPlayer(this.state, input, this.world);
    this.pending.push(input);
    return input;
  }

  reconcile(snapshot) {
    this.pending = this.pending.filter((i) => i.seq > snapshot.lastSeq);
    const s = this.state;
    s.x = snapshot.x; s.y = snapshot.y; s.z = snapshot.z;
    s.vx = snapshot.vx; s.vy = snapshot.vy; s.vz = snapshot.vz;
    s.kx = snapshot.kx; s.kz = snapshot.kz;
    s.carrying = snapshot.carrying !== null;
    s.crouching = snapshot.crouching;
    s.onGround = snapshot.onGround;
    s.gliding = snapshot.gliding;
    s.flying = !!snapshot.flying;
    s.accessory = snapshot.accessory ?? null;
    s.springCharge = snapshot.springCharge ?? 0;
    s.springBouncing = !!snapshot.springBouncing;
    s.slowTicks = snapshot.slowTicks ?? 0;
    s.grapple = snapshot.grapple ? { ...snapshot.grapple } : null;
    s.hookCooldown = snapshot.hookCooldown ?? 0;
    s.moveScale = snapshot.moveScale ?? 1;
    for (const input of this.pending) stepPlayer(s, input, this.world);
  }

  // Jumps straight to a server state (respawn) without interpolating from the old spot.
  teleport(snapshot) {
    this.pending = [];
    this.reconcile(snapshot);
    this.prev = { ...this.state };
  }

  // Interpolated feet position; alpha in [0, 1] is progress through the current tick.
  renderPosition(alpha) {
    const a = this.prev, b = this.state;
    return {
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
      z: a.z + (b.z - a.z) * alpha,
    };
  }
}
