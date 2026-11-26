// Checks for the Wise Monkey's quest book: chapter and quest data (ids,
// prerequisites within a chapter, regions, a tidy graph, every mechanic
// represented), and in a real match: chapter unlocking, independent quests,
// prerequisites with retroactive completion, team-wide progress kept in step
// for every member, simultaneous reward claims, reconnecting, and saves.
//   node scripts/quest-check.js
import assert from 'node:assert/strict';
import { CHAPTERS, QUESTS, questById, chapterById, goalMet } from '../shared/quests.js';
import { RECIPES } from '../shared/recipes.js';
import { MONKEY_ROLES } from '../shared/monkeys.js';
import { BLOCK } from '../shared/blocks.js';
import { ITEM, getItemDef } from '../shared/items.js';
import { TEAMS, S2C, C2S } from '../shared/protocol.js';
import { NPC_KIND } from '../shared/npcs.js';
import { Game } from '../server/game.js';
import { QuestBook } from '../server/quests.js';

// ---- Data ----
const goalItems = (goal) => !goal ? [] : goal.all || goal.any ? (goal.all ?? goal.any).flatMap(goalItems)
  : [...(goal.obtained ?? []), ...(goal.crafted ?? []), ...(goal.placed ?? [])];
const goalEvents = (goal) => !goal ? [] : goal.all || goal.any ? (goal.all ?? goal.any).flatMap(goalEvents) : goal.event ? [goal.event] : [];
{
  assert.equal(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length, 'duplicate quest ids');
  assert.equal(CHAPTERS[0].unlock, null, 'the first chapter must be open from the start');
  assert.equal(CHAPTERS[0].name, 'A Brand New Adventure');
  assert.equal(CHAPTERS[1].name, 'Monkey Business');
  assert.deepEqual(CHAPTERS[1].unlock.goal, { obtained: [ITEM.BRONZE_INGOT] }, 'Chapter II must unlock on a bronze ingot');
  for (const c of CHAPTERS.slice(1)) assert.ok(c.unlock?.goal && c.unlock.text, `${c.id} has no unlock goal and text`);
  for (const q of QUESTS) {
    assert.ok(chapterById.has(q.chapter), `${q.id}: unknown chapter`);
    assert.ok(q.title && q.text?.length && q.goal && getItemDef(q.icon), `${q.id}: missing title, text, goal or icon`);
    for (const id of goalItems(q.goal)) assert.ok(getItemDef(id)?.name, `${q.id}: goal names an unknown item ${id}`);
    for (const d of [...(q.deps ?? []), ...(q.links ?? [])]) {
      assert.ok(questById.has(d), `${q.id}: unknown dependency ${d}`);
      // Chapter II never needs Chapter I done, and so on.
      assert.equal(questById.get(d).chapter, q.chapter, `${q.id}: ${d} is in another chapter`);
    }
    for (const { count } of q.reward ?? []) assert.ok(count <= 10, `${q.id}: reward is not small`);
  }
  // No cycles in prerequisites.
  const visiting = new Set(), done = new Set();
  const visit = (id) => {
    assert.ok(!visiting.has(id), `prerequisite cycle through ${id}`);
    if (done.has(id)) return;
    visiting.add(id); for (const d of questById.get(id).deps ?? []) visit(d); visiting.delete(id); done.add(id);
  };
  QUESTS.forEach((q) => visit(q.id));

  for (const c of CHAPTERS) {
    const list = QUESTS.filter((q) => q.chapter === c.id);
    // Branching, not one line: several starting points and standalone quests.
    const roots = list.filter((q) => !q.deps?.length);
    assert.ok(roots.length >= 5, `${c.id}: only ${roots.length} quests without prerequisites`);
    assert.ok(list.some((q) => !q.deps?.length && !q.links?.length && !list.some((o) => o.deps?.includes(q.id) || o.links?.includes(q.id))),
      `${c.id}: no standalone quest`);
    assert.ok(list.filter((q) => q.reward).length < list.length, `${c.id}: every quest has a reward`);
    // Layout: one quest per cell, each in exactly one region, regions apart,
    // no line through another quest and no crossing lines.
    const cells = new Set(list.map((q) => `${q.x},${q.y}`));
    assert.equal(cells.size, list.length, `${c.id}: two quests share a cell`);
    for (const q of list) assert.equal(c.regions.filter((r) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1).length, 1, `${q.id}: not in exactly one region`);
    const box = (r) => ({ l: r.x0 * 120 - 56, r: r.x1 * 120 + 56, t: r.y0 * 120 - 58, b: r.y1 * 120 + 52 });
    for (const [i, a] of c.regions.entries()) for (const b of c.regions.slice(i + 1)) {
      const p = box(a), q = box(b);
      assert.ok(!(p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b), `${c.id}: regions ${a.label} and ${b.label} overlap`);
    }
    const edges = list.flatMap((q) => [...(q.deps ?? []), ...(q.links ?? [])].map((d) => [questById.get(d), q]));
    const segDist = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    };
    const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    for (const [a, b] of edges) for (const q of list) if (q !== a && q !== b) assert.ok(segDist(q, a, b) > 0.45, `${c.id}: line ${a.id}-${b.id} runs through ${q.id}`);
    for (const [i, [a, b]] of edges.entries()) for (const [c2, d] of edges.slice(i + 1)) {
      assert.ok(!(side(a, b, c2) * side(a, b, d) < 0 && side(c2, d, a) * side(c2, d, b) < 0), `${c.id}: lines ${a.id}-${b.id} and ${c2.id}-${d.id} cross`);
    }
  }

  // Every crafted thing and every monkey role is in some quest, by goal or text.
  const text = QUESTS.map((q) => q.text.join(' ')).join(' ').toLowerCase();
  const inGoals = new Set(QUESTS.flatMap((q) => goalItems(q.goal)));
  for (const r of RECIPES) if (!inGoals.has(r.output)) assert.ok(text.includes(getItemDef(r.output).name.toLowerCase()), `nothing in the book covers ${r.id}`);
  const events = new Set(QUESTS.flatMap((q) => goalEvents(q.goal)));
  for (const role of MONKEY_ROLES.filter((r) => r !== 'idle')) assert.ok(events.has(`role:${role}`) || text.includes(`${role}:`), `no quest covers the ${role} role`);
  for (const e of ['tame', 'monkeyCrafted', 'lookoutSpotted', 'depotPlaced', 'merchantTrade', 'autoSale', 'merchantSale', 'requestSold',
    'babyMonkey', 'kill:goblin', 'kill:crawler', 'kill:eel', 'kill:dragon', 'kill:player', 'flagCaptured']) assert.ok(events.has(e), `no quest uses the ${e} milestone`);
}

// ---- A match: team 0 has two players, team 1 one ----
const game = new Game(); game.worldSize = 'small'; game.hostId = 1; game.nextId = 4;
const sent = new Map();
const socketFor = (id) => ({ readyState: 1, send: (data) => { const msg = JSON.parse(data); (sent.get(id) ?? sent.set(id, []).get(id)).push(msg); } });
const sessions = new Map();
for (const [id, team] of [[1, 0], [2, 0], [3, 1]]) {
  const session = { socket: socketFor(id), creative: false, localHost: false };
  sessions.set(id, session);
  game.members.set(id, { id, name: `Test ${id}`, team, color: TEAMS[team].color, ready: true, session });
}
const log = console.log; console.log = () => {};
game.startMatch(game.members.get(1), { seed: '3' });
console.log = log;
const [a, b, enemy] = [1, 2, 3].map((id) => game.players.get(id));
for (const id of [1, 2, 3]) sessions.get(id).player = game.players.get(id);
assert.equal(a.team, 0); assert.equal(b.team, 0); assert.equal(enemy.team, 1);
const books = (id) => (sent.get(id) ?? []).flatMap((m) => m.type === S2C.QUESTS ? [m] : m.quests ? [m.quests] : []);
const latest = (id) => books(id).at(-1);
const clear = () => sent.clear();
const book = (team) => game.quests.of(team);
const tick = () => { game.quests.update(); };
const progress = game.teamProgress;

// Joining: every player's world message carries their team's book, Chapter II locked.
for (const id of [1, 2, 3]) {
  const first = books(id)[0];
  assert.ok(first, `player ${id} got no quest book on joining`);
  assert.deepEqual(first.unlocked, [], 'a chapter was unlocked from the start');
}
clear();

// Independent quests complete on their own; no prerequisites in the way.
progress.event(0, 'kill:crawler');
tick();
assert.ok(book(0).completed.has('crawlers'), 'a standalone quest did not complete');
assert.ok(!book(1).completed.has('crawlers'), 'one team\'s quest completed for another');
// Both team 0 members got the update; the enemy didn't get team 0's book.
for (const id of [1, 2]) assert.ok(latest(id)?.completed.includes('crawlers'), `teammate ${id} was not told`);
assert.ok(!books(3).some((m) => m.completed.includes('crawlers')), 'team 1 was sent team 0\'s progress');
assert.ok(books(1).every((m) => !m.open), 'a team update opened the book');

// Prerequisites: stone was mined before any hammer was made; it waits, then
// completes along with the whole chain the moment the chain is done.
progress.of(0).obtained.add(BLOCK.STONE);
tick();
assert.ok(!book(0).completed.has('stone'), 'a quest completed before its prerequisite');
progress.of(0).obtained.add(BLOCK.WOOD);
progress.crafted(0, BLOCK.PLANKS); progress.placed(0, BLOCK.WORKBENCH); progress.crafted(0, ITEM.WOOD_HAMMER);
tick();
for (const id of ['wood', 'planks', 'workbench', 'hammer', 'stone']) assert.ok(book(0).completed.has(id), `${id} not completed retroactively`);

// Chapter II: what the team did before bronze waits, then counts at once.
progress.event(0, 'depotPlaced'); progress.event(0, 'role:guard'); progress.of(0).obtained.add(BLOCK.IRON_ORE);
progress.event(0, 'autoSale', 4);
tick();
assert.ok(!book(0).unlocked.has('business'));
for (const id of ['depot', 'guard', 'center']) assert.ok(!book(0).completed.has(id), `${id} completed while Chapter II was locked`);
assert.ok(!goalMet(CHAPTERS[1].unlock.goal, progress.of(1)));
clear();
// A teammate picks up a bronze ingot: the whole team gets Chapter II.
b.inventory.add(ITEM.BRONZE_INGOT, 1); b.inventoryDirty = true;
game.update();
tick();
assert.ok(book(0).unlocked.has('business'), 'bronze did not unlock Chapter II');
for (const id of ['bronze', 'depot', 'guard', 'center']) assert.ok(book(0).completed.has(id), `${id} not completed on unlocking`);
assert.ok(!book(0).completed.has('autosell'), 'a counted goal completed early');
for (const id of [1, 2]) {
  assert.ok(latest(id).unlocked.includes('business'), `teammate ${id} did not see Chapter II unlock`);
  assert.deepEqual(latest(id).counts.autosell, [4, 10], 'counted progress not sent');
  assert.ok((sent.get(id) ?? []).some((m) => m.type === S2C.NOTICE && /Chapter II unlocked/.test(m.text)), `teammate ${id} got no unlock notice`);
}
assert.ok(!book(1).unlocked.has('business'), 'Chapter II unlocked for the other team');
assert.ok(!(sent.get(3) ?? []).some((m) => m.type === S2C.NOTICE && /Chapter II/.test(m.text)), 'the other team was told');

// Book state is the server's alone: a client claiming an unfinished or
// unknown quest gets nothing.
const wise = (team) => [...game.npcs.values()].find((n) => n.npc === NPC_KIND.WISE_MONKEY && n.team === team);
const goTo = (player, npc) => Object.assign(player.state, { x: npc.state.x + 1, y: npc.state.y, z: npc.state.z, vx: 0, vy: 0, vz: 0 });
const count = (player, item) => player.inventory.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
const send = (id, msg) => game.handleMessage(sessions.get(id), JSON.stringify(msg));
for (const p of [a, b]) { goTo(p, wise(0)); game.quests.open(p); }
send(1, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'tame' });
send(1, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'nonsense' });
assert.ok(!book(0).claimed.has('tame'), 'claimed an unfinished quest');

// Simultaneous claims: both teammates press Claim on the same reward in the
// same tick. Exactly one gets the torches; both books show it claimed.
clear();
const before = count(a, BLOCK.TORCH) + count(b, BLOCK.TORCH);
send(1, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'workbench' });
send(2, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'workbench' });
send(2, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'workbench' });
game.update();
assert.equal(count(a, BLOCK.TORCH) + count(b, BLOCK.TORCH) - before, 8, 'the reward was paid more or less than once');
assert.ok(book(0).claimed.has('workbench'));
for (const id of [1, 2]) assert.ok(latest(id).claimed.includes('workbench'), `teammate ${id} did not see the claim`);
assert.ok(books(2).some((m) => m.open && /already claimed/.test(m.message ?? '')), 'the second claimer was not told');
// The other team's progress and rewards are its own.
progress.of(1).obtained.add(BLOCK.WOOD); progress.crafted(1, BLOCK.PLANKS); progress.crafted(1, BLOCK.WORKBENCH);
tick();
assert.ok(book(1).completed.has('workbench') && !book(1).claimed.has('workbench'));
goTo(enemy, wise(1)); game.quests.open(enemy);
const enemyBefore = count(enemy, BLOCK.TORCH);
send(3, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'workbench' });
assert.equal(count(enemy, BLOCK.TORCH) - enemyBefore, 8, 'team 1 could not claim its own reward');
// Far from the Wise Monkey nothing can be claimed.
progress.event(0, 'tame');
tick();
a.state.x += 40;
send(1, { type: C2S.QUEST_ACTION, action: 'claim', quest: 'tame' });
assert.ok(!book(0).claimed.has('tame'), 'claimed away from the Wise Monkey');

// Reconnecting: the book arrives with the world, claims and all.
game.disconnect(sessions.get(2));
clear();
const back = { socket: socketFor(2), creative: false, localHost: false };
assert.ok(game.reclaim(back, 'Test 2'));
const rejoined = books(2)[0];
assert.ok(rejoined && rejoined.unlocked.includes('business') && rejoined.claimed.includes('workbench') && rejoined.completed.includes('stone'),
  'a reconnecting player did not get the team\'s book');

// Talking to the Wise Monkey counts (the first quest), only for that team.
game.talk(enemy, wise(1).id);
tick();
assert.ok(book(1).completed.has('wise') && !book(0).completed.has('wise'));

// Saves keep unlocked chapters, completions and claims; old books keep their
// claims but drop completions in chapters not yet unlocked.
const saved = JSON.parse(JSON.stringify(game.quests.save()));
const loaded = new QuestBook(game); loaded.load(saved);
for (const team of [0, 1]) {
  assert.deepEqual([...loaded.of(team).unlocked].sort(), [...book(team).unlocked].sort());
  assert.deepEqual([...loaded.of(team).completed].sort(), [...book(team).completed].sort());
  assert.deepEqual([...loaded.of(team).claimed].sort(), [...book(team).claimed].sort());
}
const old = new QuestBook(game); old.load([{ team: 0, completed: ['pipes', 'wood', 'removedQuest'], claimed: ['crusher'] }]);
assert.deepEqual([...old.of(0).completed], ['wood']);
assert.deepEqual([...old.of(0).claimed], ['crusher'], 'an old claim was lost (its reward could be claimed twice)');

console.log('OK: quest data and layout, every recipe and role covered, chapter unlock on bronze (team-wide, per team),',
  'standalone quests, prerequisites and retroactive completion, team sync and notices, simultaneous claims paid once,',
  'claims per team and near the Wise Monkey, reconnecting, saves');
process.exit(0);
