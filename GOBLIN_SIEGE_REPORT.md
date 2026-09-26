# Goblin sieges: implementation and validation

Validation uses the authoritative game, generated voxel worlds, flag rules, physical goblin movement, construction and machine simulation. The supported sizes in this checkout are Small, Medium and Large. All runs use two teams and world seed 12345 unless noted. These are headless matches; browser rendering and the audible quality of procedural sounds have not been visually/audibly playtested.

## Behavior changes

- Persistent finite siege armies remain separate from home slots. Groups emerge through the entrance; workers lead, one backup stages behind, and main fighters follow construction progress. Pilot and four riders spawn aboard a clear balloon pad after the bridge lands.
- Tiers, wood costs/reserves, population respawn, units, traps, construction timing, machines, projectile effects and sound timing are configured in `shared/goblins.js`. Hounds, brutes, catapults and balloons have creative spawn items. The inspector exposes tier, target, plan, wood, budget, timer and machines.
- Builders continue up the tower instead of routing down between placements. They repair consecutive bridge holes from supported positions on either bank and clear obstructions. Hammer animation requires reachable work.
- Long journeys use cached shared routes, replan when blocked and switch to ordinary local pathfinding near flags and home. Return routes stay on the surface until reaching an entrance, then use shaft travel to the totem. Grounded ladder exits advance their waypoint. River exits finish a normal-height jump before switching back to ground routing.
- Wide brutes ignore sideways crowd separation on narrow bridges, align precisely with waypoints, step onto raised landings, and check support before intentional movement. Falling entities keep updating through void death regardless of observer distance.
- Catapults remain stationary when hit. Larger models/projectiles follow visible high arcs. Target selection cycles path obstructions, turrets, defenses and player groups. Only bombs send the explosion-effect event; keep blocks and goblin bridges remain protected.
- Siege declarations retain chat and add a procedural horn and drums. Goblins have nearby idle calls, hurt cries, hound/brute calls and work sounds.
- The economy can save enough labor for distant trees instead of stopping at a credit ceiling below their cost. Estimated construction travel, climb and positioning delays obey the configured time scale; actor movement stays physical.
- Balloon avoidance commits to collision-checked detours at flight speed instead of oscillating against an overhang. Launch pads use clear, nearly level ground outside buildings. Surface sites retry in a configured expansion ring when the compact area is full.
- Wall heights use native island terrain rather than detached overhead islands. Enclosures preserve buildings, old/sealed gatehouses and door lanes. Detailed main gates have supported approaches and two guards. Siege sites avoid existing/planned structures; pending sites reserve space before wood gathering finishes and cached launches are revalidated.
- Goblins use normal flag pickup/drop notifications and carrier speed. Delivered flags are held at the totem without automatic return; touching by the owner or destroying the totem returns them. Goblins never capture/eliminate teams.

## Timing interpretation

Clock values below are simulation seconds (20 ticks/second). `goblinTimeScale` accelerates action timers, growth and siege safety timers; walking and flight speeds remain physical. Thus a 4× launch cap is 375 seconds, 2× is 750 seconds, and 8× is 187.5 seconds (112.5 seconds after the first bridge lands). A timer ending an accelerated siege is not evidence that a normal 25-minute siege would fail. Bridge times include emergence, travel, tower work and deck placement.

## Maximum-base wall checks

`scripts/goblin-max.js` checks actual voxel courses, connected closed perimeters, enclosed dwellings/plots/gatehouses, wall separation, preserved doors/stairs, walking access to every dwelling, both sides of every gate, the four-wide main gate frame and supported guard positions. It also checks capacity, fortress/module caps and persistence.

| Size | Seed | Completed tick | Modules | Dwellings | Home population | Outer wall |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Small | 12345 | 116 | 40 | 18 | 25 | True |
| Small | 54321 | 113 | 40 | 18 | 25 | True |
| Medium | 12345 | 128 | 48 | 22 | 40 | True |
| Medium | 54321 | 127 | 48 | 22 | 40 | True |
| Large | 12345 | 209 | 100 | 36 | 60 | True |
| Large | 54321 | 215 | 100 | 36 | 60 | True |

Actual layout artifacts: [overview](goblin-wall-layouts/overview.png), [Small SVG](goblin-wall-layouts/small.svg), [Medium SVG](goblin-wall-layouts/medium.svg), [Large SVG](goblin-wall-layouts/large.svg). Text grids are in the same directory. Blue is inner wall, gold outer wall, green gates and red main gate.

## Fortress observer: MAX → raise tier → force siege

The observer remains alive inside the Totem Hall while the siege progresses outside. The harness continues after siege end to observe returns and flag carriers. Forced launches bypass wood; storage may be below the reserve. Targets are fixed by the test harness (Small/Medium team 1, Large team 0) for reproducibility; normal target selection remains random among eligible teams.

| Size | Scale | Tier unlock seconds (1 / 2 / 3 / 4) | Launch / target / plan | Wood cost / reserve / storage | Tower / bridge seconds | Platform | Spawned / budget | Balloon / outcome | Home min–max |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| Small | 4 | 0.00s / 3.85s / 4.60s / 5.80s | 5.80s / team 1 / new | 341 / 410 / 24 | 47.95 / 242.80 | True | 30 / 30 | 4 drops, returned; flag held | 25–25 |
| Medium | 2 | 0.00s / 4.00s / 5.55s / 6.30s | 6.30s / team 1 / new | 389 / 467 / 24 | 47.30 / 329.50 | True | 30 / 30 | 4 drops, returned; flag held | 40–40 |
| Large | 2 | 0.00s / 5.75s / 7.15s / 10.30s | 10.30s / team 0 / new | 400 / 480 / 24 | 182.60 / 432.55 | True | 30 / 30 | 4 drops, returned; flag held | 60–60 |

**Small raw run:** [small-fortress-final.jsonl](goblin-test-results/small-fortress-final.jsonl). Observer inside fortress: True; alive: True. Budget: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. End reason: timeout; survivors 29; unspawned 0. Artillery target counts: {'keep': 32}. Final sampled unit roles/phases: {'builder:emerging': 1, 'builder:building': 1, 'fighter:assault': 21, 'crew:crewing': 1, 'crew:assault': 1, 'rider:assault': 4}.

Emergence schedule: +0.05s: 2 builder, 1 fighter; +5.05s: 1 fighter, 1 crew; +10.05s: 1 crew, 1 fighter; +186.80s: 3 fighter; +191.80s: 2 fighter; +196.80s: 3 fighter; +201.80s: 3 fighter; +206.80s: 2 fighter; +211.80s: 2 fighter; +216.80s: 3 fighter; +245.80s: 1 pilot, 1 rider; +250.80s: 2 rider; +255.80s: 1 rider.

Final machines: goblinBalloon: 40 HP, idle, cargo 0, goblinCatapult: 60 HP, waitingCrew, cargo 0. Flag delivery: 418.60s. Siege end was a safety timeout; surviving flag carriers continued after it.


**Medium raw run:** [medium-fortress-final.jsonl](goblin-test-results/medium-fortress-final.jsonl). Observer inside fortress: True; alive: True. Budget: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. End reason: timeout; survivors 28; unspawned 0. Artillery target counts: {'keep': 87}. Final sampled unit roles/phases: {'builder:building': 1, 'builder:emerging': 1, 'fighter:assault': 20, 'crew:assault': 1, 'crew:crewing': 1, 'rider:assault': 4}.

Emergence schedule: +0.05s: 2 builder; +10.05s: 2 fighter; +20.05s: 2 crew; +250.90s: 3 fighter; +260.90s: 3 fighter; +270.90s: 3 fighter; +280.90s: 2 fighter; +290.90s: 3 fighter; +300.90s: 3 fighter; +310.90s: 2 fighter; +335.50s: 1 pilot, 1 rider; +345.50s: 2 rider; +355.50s: 1 rider.

Final machines: goblinBalloon: 40 HP, idle, cargo 0, goblinCatapult: 60 HP, waitingCrew, cargo 0. Flag delivery: 536.60s. Siege end was a safety timeout; surviving flag carriers continued after it.


**Large raw run:** [large-fortress-ground.jsonl](goblin-test-results/large-fortress-ground.jsonl). Observer inside fortress: True; alive: True. Budget: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. End reason: timeout; survivors 29; unspawned 0. Artillery target counts: {'path': 2}. Final sampled unit roles/phases: {'builder:emerging': 1, 'builder:building': 1, 'fighter:assault': 21, 'crew:assault': 1, 'crew:crewing': 1, 'rider:assault': 4}.

Emergence schedule: +0.05s: 2 builder; +10.05s: 2 fighter, 1 crew; +20.05s: 1 crew, 1 fighter; +353.00s: 3 fighter; +363.00s: 2 fighter; +373.00s: 2 fighter; +383.00s: 2 fighter; +393.00s: 3 fighter; +403.00s: 3 fighter; +413.00s: 3 fighter; +438.55s: 1 pilot, 2 rider; +448.55s: 2 rider.

Final machines: goblinBalloon: 40 HP, idle, cargo 0, goblinCatapult: 60 HP, waitingCrew, cargo 0. Flag delivery: 898.05s. Siege end was a safety timeout; surviving flag carriers continued after it.

## Natural economy progression

Flags begin at home. Sieges launch from wood storage without force. The test defender returns any held flag through the game return rule every ten seconds, allowing subsequent target selection. No siege army is replenished or removed to hurry progression. Surviving attackers may take a returned flag again after their siege ends; repeated deliveries retain the original army’s siege ID.

### Small

Raw data: [small-progression-final.jsonl](goblin-test-results/small-progression-final.jsonl). Scale 8; ran 1147.75 simulation seconds; final tier 4; outer wall True.

Tier unlocks: Tier 1 at 0.00s, Tier 2 at 218.10s, Tier 3 at 308.10s, Tier 4 at 897.75s.

| Siege | Launch | Tier | Target | Plan / bridges | Wood cost / reserve / storage | Tower / bridge seconds | Platform | Spawned / budget, remaining | End | Home at launch / minimum |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 120.05s | 1 | 1 | new / 1 | 126 / 152 / 168 | 38.60 / 135.20 | False | 9/9, 0 | 307.55s: timeout | 5 / 5 |
| 2 | 307.60s | 2 | 0 | new / 1 | 212 / 255 / 508 | 82.80 / 184.35 | True | 14/14, 0 | 495.10s: timeout | 25 / 25 |
| 3 | 495.15s | 3 | 0 | reuse / 1 | 209 / 251 / 1021 | 81.85 / 146.85 | True | 24/24, 0 | 682.65s: timeout | 25 / 25 |
| 4 | 710.20s | 3 | 1 | reuse / 1 | 220 / 264 / 1634 | not landed | True | 6/24, 18 | 897.70s: timeout | 25 / 25 |
| 5 | 960.25s | 4 | 1 | abandoned / 2 | 743 / 892 / 2354 | not landed | True | 7/30, 23 | 1147.75s: timeout | 25 / 25 |

Budget and emergence schedule (offset from launch; roles are counted directly from spawn events; the configured type mix is listed first):

- Siege 1: 2 worker, 5 soldier, 2 archer. +0.00s: 2 builder, 1 fighter; +2.50s: 2 fighter; +90.55s: 2 fighter; +93.05s: 2 fighter.
- Siege 2: 2 worker, 5 soldier, 3 archer, 3 hound, 1 crew. +0.00s: 2 builder, 1 fighter; +2.50s: 2 fighter, 1 crew; +156.00s: 2 fighter; +158.50s: 3 fighter; +161.00s: 2 fighter; +163.50s: 1 fighter.
- Siege 3: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 2 fighter, 1 crew; +143.85s: 2 fighter; +146.35s: 3 fighter; +148.85s: 2 fighter; +151.35s: 3 fighter; +153.85s: 3 fighter; +156.35s: 1 pilot, 2 rider; +158.85s: 2 rider.
- Siege 4: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 2 fighter, 1 crew.
- Siege 5: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 1 crew; +5.00s: 1 crew, 1 fighter.
- Siege 1 balloon: unavailable at this tier; 0 glider drops. Flag delivery: 411.85s, 707.05s, 830.50s, 954.15s, 1077.75s.
- Siege 2 balloon: unavailable at this tier; 0 glider drops. Flag delivery: none.
- Siege 3 balloon: returned at 711.25s; 0 glider drops. Flag delivery: none.
- Siege 4 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.
- Siege 5 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.

Balloon events: [{'tick': 14225, 'event': 'siegeBalloon', 'outcome': 'returned', 'team': 0}] Glider drops: 0.

### Medium

Raw data: [medium-progression-final.jsonl](goblin-test-results/medium-progression-final.jsonl). Scale 8; ran 1075.75 simulation seconds; final tier 4; outer wall True.

Tier unlocks: Tier 1 at 0.00s, Tier 2 at 238.10s, Tier 3 at 382.10s, Tier 4 at 888.25s.

| Siege | Launch | Tier | Target | Plan / bridges | Wood cost / reserve / storage | Tower / bridge seconds | Platform | Spawned / budget, remaining | End | Home at launch / minimum |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 138.05s | 1 | 0 | new / 1 | 184 / 221 / 240 | not landed | False | 9/9, 0 | 325.55s: timeout | 9 / 9 |
| 2 | 325.60s | 2 | 1 | new / 1 | 324 / 389 / 511 | not landed | True | 5/14, 9 | 513.10s: timeout | 40 / 40 |
| 3 | 513.15s | 3 | 0 | abandoned / 1 | 415 / 498 / 818 | not landed | True | 16/24, 8 | 700.65s: timeout | 40 / 40 |
| 4 | 700.70s | 3 | 0 | reuse / 2 | 487 / 585 / 1088 | not landed | True | 5/24, 19 | 888.20s: timeout | 40 / 40 |
| 5 | 888.25s | 4 | 1 | abandoned / 1 | 508 / 610 / 1247 | not landed | True | 25/30, 5 | 1075.75s: timeout | 40 / 40 |

Budget and emergence schedule (offset from launch; roles are counted directly from spawn events; the configured type mix is listed first):

- Siege 1: 2 worker, 5 soldier, 2 archer. +0.00s: 2 builder, 1 fighter; +2.50s: 2 fighter; +184.85s: 2 fighter; +187.35s: 2 fighter.
- Siege 2: 2 worker, 5 soldier, 3 archer, 3 hound, 1 crew. +0.00s: 2 builder; +2.50s: 2 fighter, 1 crew.
- Siege 3: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder; +2.50s: 2 fighter; +5.00s: 1 crew, 1 fighter; +179.00s: 3 fighter; +181.50s: 2 fighter; +184.00s: 3 fighter; +186.50s: 2 fighter.
- Siege 4: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder; +2.50s: 2 fighter, 1 crew.
- Siege 5: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 2 crew; +157.90s: 3 fighter; +160.40s: 3 fighter; +162.90s: 2 fighter; +165.40s: 3 fighter; +167.90s: 3 fighter; +170.40s: 2 fighter; +172.90s: 2 fighter; +175.40s: 1 fighter.
- Siege 1 balloon: unavailable at this tier; 0 glider drops. Flag delivery: none.
- Siege 2 balloon: unavailable at this tier; 0 glider drops. Flag delivery: none.
- Siege 3 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.
- Siege 4 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.
- Siege 5 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.

Balloon events: No flight completed in this accelerated window. Glider drops: 0.

### Large

Raw data: [large-progression-final.jsonl](goblin-test-results/large-progression-final.jsonl). Scale 8; ran 1147.75 simulation seconds; final tier 4; outer wall True.

Tier unlocks: Tier 1 at 0.00s, Tier 2 at 300.10s, Tier 3 at 534.10s, Tier 4 at 942.25s.

| Siege | Launch | Tier | Target | Plan / bridges | Wood cost / reserve / storage | Tower / bridge seconds | Platform | Spawned / budget, remaining | End | Home at launch / minimum |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 192.05s | 1 | 1 | new / 1 | 232 / 279 / 288 | not landed | False | 9/9, 0 | 379.55s: timeout | 11 / 11 |
| 2 | 379.60s | 2 | 1 | reuse / 1 | 286 / 344 / 537 | not landed | True | 5/14, 9 | 567.10s: timeout | 43 / 43 |
| 3 | 567.15s | 3 | 0 | new / 1 | 400 / 480 / 661 | not landed | True | 5/24, 19 | 754.65s: timeout | 60 / 60 |
| 4 | 754.70s | 3 | 0 | abandoned / 1 | 530 / 636 / 925 | not landed | True | 5/24, 19 | 942.20s: timeout | 60 / 60 |
| 5 | 960.25s | 4 | 0 | abandoned / 2 | 928 / 1114 / 1129 | not landed | True | 6/30, 24 | 1147.75s: timeout | 60 / 60 |

Budget and emergence schedule (offset from launch; roles are counted directly from spawn events; the configured type mix is listed first):

- Siege 1: 2 worker, 5 soldier, 2 archer. +0.00s: 2 builder, 1 fighter; +2.50s: 3 fighter; +170.95s: 2 fighter; +173.45s: 1 fighter.
- Siege 2: 2 worker, 5 soldier, 3 archer, 3 hound, 1 crew. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 1 crew.
- Siege 3: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 1 crew.
- Siege 4: 2 worker, 6 soldier, 4 archer, 4 hound, 2 brute, 1 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 1 crew.
- Siege 5: 2 worker, 8 soldier, 5 archer, 5 hound, 3 brute, 2 crew, 1 pilot, 4 riders. +0.00s: 2 builder, 1 fighter; +2.50s: 1 fighter, 2 crew.
- Siege 1 balloon: unavailable at this tier; 0 glider drops. Flag delivery: none.
- Siege 2 balloon: unavailable at this tier; 0 glider drops. Flag delivery: none.
- Siege 3 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.
- Siege 4 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.
- Siege 5 balloon: not launched: bridge did not land before timeout; 0 glider drops. Flag delivery: none.

Balloon events: No flight completed in this accelerated window. Glider drops: 0.

## Focused verification

All three commands below passed on the final code; `npm run check` checked 95 files. Maximum-base checks passed for both listed seeds on every supported size.

- `npm run check`: syntax/import validation for all JavaScript files.
- `scripts/goblin-siege-checks.js`: finite army/home identity, tier substitutions, wood reserve, plan reuse/widening/abandonment, bridge repair and obstructions, progressive ladder building, local builder movement, narrow brute lanes/raised landings/edge safety, river exits, stationary catapults, parabolic bombs, bomb-only explosion messages, artillery targeting variety, launch construction races, blocked launch handling, delayed balloon crew/cargo/crash, clear ground pads, roof/wall flight detours, surface homebound routes, chunk interest/void deaths, dynamic flag routes, normal carrier speed, private notifications and held-flag/totem returns.
- `scripts/goblin-economy.js`: watched/unwatched economy and persistence, deferred interior construction and physical travel.

Reproduce the natural progression and fortress-observer scenarios:

```sh
GOBLIN_TIME_SCALE=8 node scripts/goblin-sieges.js small 2500 progression
GOBLIN_TIME_SCALE=8 node scripts/goblin-sieges.js medium 2500 progression
GOBLIN_TIME_SCALE=8 node scripts/goblin-sieges.js large 3500 progression
GOBLIN_TIME_SCALE=4 GOBLIN_TARGET_TEAM=1 GOBLIN_POST_SIEGE_SECONDS=180 node scripts/goblin-sieges.js small 1200 fortress-tier4
GOBLIN_TIME_SCALE=2 GOBLIN_TARGET_TEAM=1 GOBLIN_POST_SIEGE_SECONDS=180 node scripts/goblin-sieges.js medium 1600 fortress-tier4
GOBLIN_TIME_SCALE=2 GOBLIN_TARGET_TEAM=0 GOBLIN_POST_SIEGE_SECONDS=180 node scripts/goblin-sieges.js large 1600 fortress-tier4
node scripts/goblin-max.js 12345 small
node scripts/goblin-max.js 54321 small
```

Repeat the two maximum-base commands with `medium` and `large` for the remaining layouts. Normal target selection is random; the natural run's individual choices can vary.

## Limits of the evidence

Accelerated safety timers can end a siege before its full budget emerges or before a long approach lands. These outcomes are recorded rather than treated as default-speed balance failures. Headless fortress observers verify sim/interest behavior, but do not verify browser animations, perceived sound quality, or human-player tactical balance.
