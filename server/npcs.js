// NPCs: Wise Monkeys and Ancient Monkeys (kinds in shared/npcs.js). They
// never fight or pathfind. Every NPC turns its head toward the nearest
// player; 'restless' ones also stand up now and then, stroll a few steps
// around their seat, look around and sit back down. Their pose and head turn
// are in the snapshot; clients animate the rest.
//
// Talking: npcLine picks what an NPC says to a player (shared/npcLines.js).

import { NPC, TICK_RATE, TICK_DT, DIALOGUE } from '../shared/config.js';
import { NPC_DEFS, npcName } from '../shared/npcs.js';
import { ENTITY_TYPE } from '../shared/protocol.js';
import { isSolid } from '../shared/blocks.js';
import { createPlayerState } from '../shared/physics.js';
import { conditionMet, chooseLine } from '../shared/dialogue.js';
import {
  WISE_MONKEY_HINTS, WISE_MONKEY_COMPLETE, WISE_MONKEY_CLUES, WISE_MONKEY_STRANGERS, ANCIENT_MONKEY_RESPONSES,
} from '../shared/npcLines.js';

const A = NPC.ancientMonkey;
const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class Npc {
  // team: the owning team (TEAMS index) for Wise Monkeys, else null.
  constructor(id, site, team, tick) {
    this.id = id;
    this.type = ENTITY_TYPE.NPC;
    this.npc = site.npc;
    this.def = NPC_DEFS[site.npc];
    this.team = team;
    this.name = npcName(site.npc, team);
    this.home = { x: site.x, y: site.y, z: site.z, yaw: site.yaw };
    this.state = createPlayerState(site.x, site.y, site.z);
    this.state.box = this.def.box;
    this.state.yaw = site.yaw;
    this.hp = this.def.hp;
    this.dead = false;
    // Punch and arrow targeting skip disconnected players; NPCs are always here.
    this.connected = true;
    this.pose = 'sit';
    this.look = 0;
    this.poseUntil = tick + ticks(between(A.sitTime));
    this.goals = [];
    // Last line said to each player, so a repeat picks another variant.
    this.lastLines = new Map();
  }

  // LATER UPDATE: Ancient Monkeys have hp: null and cannot be damaged yet.
  get damageable() {
    return this.hp !== null;
  }

  step(world, players, tick) {
    this.lookAtNearest(players);
    if (this.def.behavior === 'restless') this.stepRestless(world, tick);
  }

  // Head yaw relative to the body toward the nearest live player in range,
  // clamped and rounded so it only changes in steps.
  lookAtNearest(players) {
    const s = this.state;
    let nearest = null, best = NPC.lookRange;
    for (const player of players) {
      if (player.dead || !player.connected || player.invisible) continue;
      const d = Math.hypot(player.state.x - s.x, player.state.y - s.y, player.state.z - s.z);
      if (d < best) { best = d; nearest = player; }
    }
    let look = 0;
    if (nearest && this.pose !== 'walk') {
      look = wrap(Math.atan2(-(nearest.state.x - s.x), -(nearest.state.z - s.z)) - s.yaw);
      look = Math.max(-NPC.lookLimit, Math.min(NPC.lookLimit, look));
    }
    this.look = Math.round(look / NPC.lookStep) * NPC.lookStep;
  }

  // Sit -> stand (the chest beat) -> walk / look around, a few times -> walk
  // home -> sit.
  stepRestless(world, tick) {
    if (this.pose === 'walk') {
      this.walk(world, tick);
      return;
    }
    if (tick < this.poseUntil) return;
    if (this.pose === 'sit') {
      this.pose = 'stand';
      this.poseUntil = tick + ticks(A.standTime);
      const steps = A.walkSteps[0] + Math.floor(Math.random() * (A.walkSteps[1] - A.walkSteps[0] + 1));
      this.goals = [];
      for (let i = 0; i < steps; i++) {
        const goal = this.strollGoal(world);
        if (goal) this.goals.push(goal);
      }
      this.goals.push({ ...this.home });
      return;
    }
    this.pose = 'walk';
  }

  walk(world, tick) {
    const s = this.state, goal = this.goals[0];
    if (!goal) {
      this.sitDown(tick);
      return;
    }
    const dx = goal.x - s.x, dz = goal.z - s.z, distance = Math.hypot(dx, dz);
    if (distance <= A.arriveDistance) {
      s.x = goal.x; s.z = goal.z; s.y = goal.y;
      this.goals.shift();
      if (!this.goals.length) this.sitDown(tick);
      else {
        this.pose = 'look';
        this.poseUntil = tick + ticks(between(A.lookTime));
      }
      return;
    }
    const stride = Math.min(distance, A.walkSpeed * TICK_DT);
    const x = s.x + dx / distance * stride, z = s.z + dz / distance * stride;
    const y = groundAt(world, x, z, s.y, this.def.box);
    // Blocked (someone built in the way): give up and go home.
    if (y === null) {
      this.goals = [];
      Object.assign(s, { x: this.home.x, y: this.home.y, z: this.home.z });
      this.sitDown(tick);
      return;
    }
    s.yaw = Math.atan2(-dx, -dz);
    Object.assign(s, { x, y, z });
  }

  sitDown(tick) {
    this.pose = 'sit';
    this.state.yaw = this.home.yaw;
    this.poseUntil = tick + ticks(between(A.sitTime));
  }

  // A point within walkRadius of the seat with footing all the way there.
  strollGoal(world) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2, distance = A.walkRadius * (0.4 + Math.random() * 0.6);
      const x = this.home.x + Math.cos(angle) * distance, z = this.home.z + Math.sin(angle) * distance;
      let y = this.home.y, ok = true;
      for (let t = 0.5; t <= distance && ok; t += 0.5) {
        y = groundAt(world, this.home.x + Math.cos(angle) * t, this.home.z + Math.sin(angle) * t, y, this.def.box);
        ok = y !== null;
      }
      if (ok) return { x, y: groundAt(world, x, z, y, this.def.box) ?? y, z };
    }
    return null;
  }

  describe() {
    return this.snapshot();
  }

  snapshot() {
    const s = this.state;
    return { id: this.id, type: this.type, npc: this.npc, name: this.name, team: this.team,
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, pose: this.pose, look: this.look };
  }
}

// Feet height with solid footing near `nearY` and room for the lower body
// around the middle of the box (the model may brush a river bank), or null.
export function groundAt(world, x, z, nearY, box) {
  const reach = Math.min(0.5, box.halfW), headroom = Math.min(3, Math.ceil(box.height));
  const columns = [[x, z], [x - reach, z], [x + reach, z], [x, z - reach], [x, z + reach]];
  for (let y = Math.floor(nearY) + 1; y >= Math.floor(nearY) - A.groundSearch; y--) {
    if (!isSolid(world.getBlock(Math.floor(x), y - 1, Math.floor(z)))) continue;
    // Only the upper body needs the full width: river beds are often V-shaped.
    if (columns.every(([cx, cz], i) => {
      for (let dy = i ? 2 : 0; dy < headroom; dy++) if (isSolid(world.getBlock(Math.floor(cx), y + dy, Math.floor(cz)))) return false;
      return true;
    })) return y;
    return null;
  }
  return null;
}

// What `npc` says to `player`: { text, sound? }. context: { progress (the
// player's team's), features (what the world has) }.
export function npcLine(npc, player, context) {
  const last = npc.lastLines.get(player.id) ?? null;
  let text, sound;
  if (npc.def.dialogue === 'ancientMonkey') {
    const response = ANCIENT_MONKEY_RESPONSES[Math.floor(Math.random() * ANCIENT_MONKEY_RESPONSES.length)];
    text = chooseLine(response.lines, Math.random, last);
    sound = response.sound;
  } else if (player.team !== npc.team) {
    text = chooseLine(WISE_MONKEY_STRANGERS, Math.random, last);
  } else {
    const clues = WISE_MONKEY_CLUES.filter((clue) => conditionMet(clue.when, context));
    const hint = WISE_MONKEY_HINTS.find((entry) => !conditionMet(entry.done, context));
    const clue = clues.length && Math.random() < DIALOGUE.clueChance
      ? clues[Math.floor(Math.random() * clues.length)] : null;
    text = chooseLine(clue?.lines ?? hint?.lines ?? WISE_MONKEY_COMPLETE, Math.random, last);
  }
  npc.lastLines.set(player.id, text);
  return { text, ...(sound ? { sound } : {}) };
}
