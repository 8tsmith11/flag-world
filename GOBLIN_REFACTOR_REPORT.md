# Goblin refactor: historical progress report

This report predates siege implementation. See [GOBLIN_SIEGE_REPORT.md](GOBLIN_SIEGE_REPORT.md) for current behavior and validation.

This is a progress report, not a declaration that the full request is finished.

## Implemented

- No material inventories: no wood, plank, brick, stone, or sapling counts. Construction uses worker labor and timed project plans. Chopping actually removes trunks and queues replanting, independently of construction resources.
- Construction runs in one economy whether bodies are spawned or absent. Live workers display project work instead of independently completing construction tasks.
- Underground module/shaft plans accumulate simulated completion. They apply together after connected viewers leave the fortress and the planned block area (16-block clearance). Creative completion explicitly bypasses this waiting rule.
- Surface construction advances progressively with viewers and in batches otherwise. Plans are computed once. Watched tree work is assigned to workers; unseen tree work can run in batches. Natural tree locations are cached and regrowth updates that cache.
- Individual goblin objects remain in population slots after body removal, preserving HP, provocation, assignment, position, and journey progress. Respawn routes start in the Totem Hall. Ladder segments use scripted movement and fixed ladder yaw.
- Underground bodies depend on interior viewers, with a 30-second linger. Surface bodies use an 80-block radius, plus visible silhouettes out to the networking radius and active construction workers to 150 blocks. Connected dead players remain viewers.
- Patrol/reserve assignments and reserve response/return routes; distributed fortress guard floors; King range and bottom-floor routing; more surface worker wandering.
- Post ownership stays attached to a population slot across death. Replacement archers travel back. Platform movement and shooting avoid dismounting to chase players; bow aiming does not trigger the punch animation.
- Compact village sites, building gaps, reserved doorway approaches, flat entrance approaches, higher second entrance, plugged old shaft, brick Castle and backed ladders.
- Larger interior sections: at least four dwellings per ordinary section. Terrain-contoured outer loops, supports into water, protected wall/building footprints, gate clearance, and bounded cliff branches.
- Live creative block updates, batched changes, scoped goblin networking, quantized position/yaw and animation flags, client interpolation, block meshing fixes.
- Local path caching (including failed searches), invalidation on block changes, a player spatial hash, and staggered guard target evaluation every half-second.

## Edge cases from the request

| Situation | Current handling and limits |
| --- | --- |
| Player watches a post while its archer respawns | The dead slot retains ownership. A replacement starts underground and follows its stored route; no immediate station refill. Post ownership and mid-route replacement state have regression checks. Strict LOS-safe first materialization still needs work. |
| Player stands in the shaft during travel | Individual routes retain ladder position/progress. Visible journeys advance each server tick at fixed ladder yaw. Combat interruption during a scripted journey needs additional coverage. |
| Player leaves and returns during a siege | **Open:** this checkout has no functional siege controller, army, bridge planner, or reinforcement system. |
| Wounded goblin despawns | The same individual object returns with its HP and provocation state. HP/body identity preservation is checked. |
| Flag carrier loses sight of players | **Open:** goblin flag carrying/held flags and siege flag behavior are absent. |
| Long-range attacks against posts | Visible surface silhouettes are retained beyond the normal body radius; networking covers 180 blocks. Post archers stay on their platforms. A client view distance beyond that radius remains an LOS/materialization gap. |
| Two players in different base areas | Interest is the union of connected viewers. Interior and surface body interest are evaluated separately, and each client receives only goblins in its networking range. |
| Player enters while a module finishes | The timer can finish, but application waits while any connected player is inside the fortress or near its planned changes. A focused check verifies that no module blocks change until the viewer leaves. |
| Player watches distant surface construction | Watched plans use small progressive steps. Workers travel to surface projects; reliable worker placement/animation at every active watched site still needs visual verification and stronger scheduling. |
| Player attacks surface goblin while reserves are deep underground | Reserve individuals receive routes from their current positions through the module graph and shaft to the attack location. After the alarm expires, they route underground. No instant surface relocation is used. |

Additional cases addressed: death-screen viewers, reserved entrance paths through later wall plans, wall-to-wall overlap, surface buildings clearing existing supports, replanting natural trees before filling empty plot spots, upper-floor expansion blocked by future Castle reservations, and cliff branch root limits.

Remaining consistency gaps include strict LOS-safe spawn/despawn for every client view distance; ambient patrol/worker route progression for every hidden individual; combat while scripted travelers pass a player; and a complete per-area economy/detail scheduler. Hidden goblins retain their positions rather than receiving repeated assignment teleports, but ordinary hidden patrol loops are not yet fully simulated.

## Simulated pacing

Seed 12345, two generated keeps, no players, `goblinTimeScale = 1`. Times are minutes from start. “Construction complete” means module/dwelling/plot caps plus relocation, Castle, and outer wall; it does not include the missing siege work. Population is the living population at that instant, not the hard cap.

| Size | Shaft breakthrough | Relocation | Castle | Outer wall | Construction complete | First siege | Module / dwelling caps | Population / hard cap |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Small | 1.97 | 26.83 | 27.33 | 35.70 | 39.68 | Not implemented | 40 / 18 | 24 / 25 |
| Medium | 2.90 | 45.43 | 46.07 | 53.73 | 58.72 | Not implemented | 48 / 22 | 33 / 40 |
| Large | 3.10 | 51.43 | 52.00 | 66.70 | 78.62 | Not implemented | 100 / 36 | 48 / 60 |

Configured economy work scales: Small 15.9, Medium 12.5, Large 13.8. These are reference-seed measurements; arbitrary seeds, sabotage, and player-caused application waits can change completion time.

## Performance measurements

Small, seed 12345, mature creative base, 4,000 measured ticks after warmup. Measurements include controller update and goblin body updates, not the full server tick or networking. Test viewers are eliminated to exclude combat. Camera placement and live wandering affect body counts.

| Scenario | Starting revision | Current measured implementation |
| --- | --- | --- |
| Fortress vicinity | 0.350 ms/tick; 27 bodies | 0.322 ms/tick; 13 bodies |
| Far away | 0.029 ms/tick; 27 bodies | 0.044 ms/tick; 1 static Totem |
| Surface village | No matching baseline run | 0.268 ms/tick; 15 bodies |

The current base has 40 modules versus 25 in the starting revision. Entity reduction is demonstrated, but **far-away CPU cost has not improved**. Earlier path-cache measurements reached 0.152 ms near the fortress before the final worker-distribution/gathering changes; that is not the final result and must not be presented as one. Optimization remains unfinished.

## Verification

- `npm run check`: passes, 88 JavaScript files.
- `node scripts/goblin-economy.js`: passes. Checks equal watched/distant construction budgets, entity-independent progress, and deferred underground application.
- Creative layout/completion regression: seed 12345 Small, Medium, Large; seed 42 Small. Checks module/building caps, upper second entrance, inner sections, complete perimeter connectivity, structural block survival, building gaps, accessible exits, second entrance containment, bounded cliff branches, body identity/HP, range-filtered packets, and replacement routes.
- Pacing simulations and mature-base tick profiling as described above.
- Browser gameplay/visual verification has not been performed in this continuation.

## Work still required

1. Implement sieges: persistent target/timers/army, tower and bridge plans, reuse/widening/repair/abandonment, reinforcements, real flag taking/carrying/held flags, announcements, time limits, end behavior, creative force-siege control, and shared attack/return flow fields.
2. Finish hidden patrol/activity movement and ambient detail modes; enforce LOS-safe lifecycle at all supported client view distances; make watched construction workers reliable at every site; cover combat during journeys and entrance traffic.
3. Add the precomputed surface waypoint graph and invalidate it on building/wall topology changes. Current navigation has cached module/local paths, but is not that full graph.
4. Resolve the remaining far-away CPU regression and measure combat/siege costs. Rerun pacing including the siege scheduler, all edge-case scenarios, and browser visual checks.
