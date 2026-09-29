# Flag World

A multiplayer LAN 3D voxel game played in the browser, heading toward
Minecraft-like gameplay (inventory, block breaking/placing, entities, tile
entities such as chests). One player hosts by running the server; everyone,
including the host, plays by opening `http://<host-ip>:3000`.

## Tech constraints

- Plain JavaScript (ES modules), no TypeScript, no build step, no frameworks.
- Server: Node + Express (static files) + ws (WebSockets).
- Client: Three.js served from node_modules via an import map.
- Server is authoritative. Clients only send inputs and render state.

## Conventions

- Code in `shared/` runs on both server and client. It must only import other
  `shared/` modules or packages listed in the import map (`three`,
  `simplex-noise`), using relative paths inside `shared/`.
- Client code imports shared modules by absolute URL (`/shared/...`).
- Every WebSocket message type is listed in `shared/protocol.js` and documented
  in `PROTOCOL.md`. Update both whenever a message is added or changed.
- Movement (including crouching and its edge protection) is a fixed-tick
  simulation (`shared/physics.js`). Each client input
  is exactly one tick. The client predicts its own player with the same code
  and replays unacknowledged inputs on each server state, so the physics must
  stay deterministic.
- A server runs a lobby, then one match until it stops (`server/game.js`).
  Match players outlive their connection and are reclaimed by name; see the
  connection flow in `PROTOCOL.md`.
- World generation is deterministic from the seed, the player count and the
  world size (`WORLD_SIZES` in `shared/worldSizes.js`, re-exported by
  `shared/worldgen.js`: Small, Medium, Large); only those three are sent to
  clients. They are floating islands (`shared/islands.js`) and are tuned from
  that config plus the constants at the top of `islands.js`. Sizes differ in
  the center island's width and its gap to the ring (`WORLD_SIZES`);
  `ISLAND_LAYOUT` (ring and scatter thickness, keep spacing) is shared and
  `islandLayout(size)` derives the rest, world width included. Caves are worm tunnels (smooth noise-steered
  paths carving round tubes) carved into each island's buffer (`carveCaves`)
  before structure placement. Use
  `world.sizeX`/`sizeY`/`sizeZ`, not constants.
- Chunks are sparse: `World` only stores chunks that have held a non-air
  block, and `getBlock` returns air for missing ones. Clients mesh only chunks
  within the view distance (a client setting, `VIEW_DISTANCE`), nearest first,
  with fog ending at that distance.
- Block changes made after generation go through `world.setBlock`;
  the server records them, broadcasts `blockChange` and sends the full list in
  `welcome`.
- Block types live in `shared/blocks.js` with their properties (solid,
  transparent, color, breakable, hardness, breakTime, drops, shape, tileEntity).
  Block ids are bytes; never renumber. Ladders and doors encode facing/open/half
  in the id (ranges `BLOCK.LADDER`, `BLOCK.DOOR`), are drawn as thin boxes by
  the mesher (`shape`), and are placed/toggled by the server (`Game.stepPlace`,
  `stepUse`, `breakBlock`).
- Items live in `shared/items.js`: every block id is also an item id; other
  items (hammers, swords, ladder, door, ingot) start at 256, with ids in
  `shared/itemIds.js`. Hammer strength/speed and sword damage/cooldown are in
  `shared/tools.js`. Recipes have a `station` (null or 'workbench'); smelting
  and fuel are data in `shared/recipes.js`. Chests and furnaces are
  containers: tile entities (`server/containers.js`, in `world.tileEntities`)
  that the server ticks and sends to everyone viewing them. Faced blocks
  (furnace, chest) have one id per facing (`FACED`). The inventory is 36 slots
  (hotbar 0-8) plus a cursor stack. It's server-owned (`server/inventory.js`), and the client only sends
  clicks and crafts.
- Loot-only gear: Wind Axe and Ice Sword are melee entries in `SWORDS`
  (`shared/tools.js`: knockback scale, lift, frost, `breaks: false`); the
  crossbow (`Game.stepCrossbow`), Rope Bundle (places a `BLOCK.ROPE` column in
  `Game.stepPlace`) and grappling hook tune from `shared/config.js`. Rope is
  climbable like ladders (`isClimbable`), and the frost slow and grapple pull
  are player physics state (`slowTicks`, `grapple`, `hookCooldown`), so
  prediction replays them.
- Item modifiers are data in `shared/modifiers.js` (pools by the item's
  `modCategory`); a stack may carry `mods: [{ id, value }]` and then never
  merges. Anything that moves stacks must keep `mods` (`Inventory.addStack`,
  `spawnItem(..., mods)`). Effects read `modValue(stack, id)` where they apply
  (`shared/tools.js`, `Player` stat helpers). Loot entries roll them via
  `modChance`; the anvil (a container) rerolls them (`Game.anvilReroll`).
- Hostile mobs: Crawlers (`server/crawler.js`) and Void Eels (`server/eel.js`)
  live in `Game.mobs`; dragons in `Game.dragons`, leashed to a home island.
  All three share `server/provocation.js`: player damage makes them hunt the
  attacker until they lose sight of them for `PROVOKE_FORGET_TIME`. Worldgen
  picks Crawler spawn points (`world.mobSpawns`) and roosts (`world.roosts`).
- Day/night is visual only: the server sends `dayTime` in `welcome`, clients
  run the clock from `state` ticks and `render/sky.js` lights the scene.
- Breaking a block needs the held item's tool strength (bare hands are
  `HAND_STRENGTH`) >= its `hardness` and holding the break button on it for `breakTime`. Progress
  is counted per input tick on the server (`Game.stepBreaking`). Placing and
  dropping are also fields of the per-tick `input`, so they apply in order with
  movement.
- Capture the flag: world gen builds a keep per player (`buildKeep`, `keepAt`
  in `shared/structures.js`); the server runs flags
  (`server/flag.js`, `Game.updateFlags`). Rules are in `PROTOCOL.md`.
- Combat is server-owned: HP, punches (`Game.stepAttack`, confirmed with a
  server raycast), knockback (the `kx`/`kz` part of player physics state, so
  prediction replays it), deaths and respawns. The world floor exists only
  under the world, so walking off an edge falls into the void.
- Inventories are server-owned (`server/inventory.js`); the client only renders
  the `inventory` message. Item ids are block ids for now.
- Dropped items are entities (`server/item.js`, physics in `stepItem`). They
  are announced with `entitySpawn`/`entityDespawn` and appear in `state` only
  on ticks they move.
- `npm run check` syntax-checks all JS and imports server/shared modules; run
  it after changes.
- Entities render from a per-type model factory in
  `public/js/render/entityRenderer.js`: a 3D block model (THREE.Group) or a
  camera-facing sprite (`createSpriteModel`). The player and item models are in
  `public/js/render/models.js`, shared by the world, the first-person arm
  (`viewModel.js`, drawn in a second pass after clearing depth) and the
  inventory preview.
- `DEBUG` in `shared/config.js` toggles the FPS / coordinates overlay.

## File layout

```
server.js                    Entry: Express static files, WebSocket server, LAN IP printout
server/
  game.js                    Authoritative game: lobby, match start/reclaim, world, players, 20 Hz tick loop
  player.js                  Server-side player (socket, input queue, physics state, inventory)
  inventory.js               36 slots + cursor stack: pickup, clicks, crafting
  item.js                    Dropped item entity
  arrow.js                   Arrow entity: flight, swept collision, sticking
  cow.js                     Cows and herds: wandering, panic, path following
  pathfind.js                A* over standable blocks for walking mobs
  dragon.js                  Dragons: patrol, landing, leash, fire breath
  crawler.js                 Crawlers: wandering, hunting, wall climbing, bites
  eel.js                     Void Eels: patrol under an island, chase exposed players
  spatialHash.js             Shared server targeting, push, sensor and interest index
  entityInterest.js          Changed-only mob replication at distance cadence
  provocation.js             Shared grudge (provoked target) and line-of-sight test
  npcs.js                    NPC entities (Wise/Ancient Monkeys): head turns, sit/stand/stroll, what they say
  teamProgress.js            Per-team items obtained, crafted and placed, for Wise Monkey hints
  flag.js                    A player's flag: home / carried / dropped / captured
  containers.js              Chest and furnace tile entities: slots, shift-click, smelting
shared/                      Runs on server and client
  modifiers.js               Item modifier pools, rolls, names and tooltip lines
  config.js                  Constants: DEBUG, Test world size, chunk size, view distance, physics, gameplay
  blocks.js                  Block type registry and properties
  items.js                   Item registry: blocks as items, tools, ladders, doors
  itemIds.js                 Ids of non-block items
  recipes.js                 Crafting recipes (with stations), smelting and fuel data
  tools.js                   Hammer and sword stats
  world.js                   Sparse chunked voxel storage (World, Chunk), tile entity map
  worldgen.js                Seed parsing and shared generateWorld entry
  worldSizes.js              World size registry (re-exported by worldgen)
  islands.js                 Floating-island world gen (center, middle ring, outer scatter, bridges)
  centralTerrain.js          Seeded highland/lowland regions, curved ridge and eroded height terraces
  riverCave.js               Radius-scaled gorge tunnel with a lined bed, walking shoulders and preserved roof
  structures.js              Keeps, sand shores, trees, seeded PRNG shared by the generators
  ballistics.js             Discrete drag/gravity aim and clear-arc helpers
  physics.js                 Deterministic player/item movement and voxel collision
  raycast.js                 Voxel raycast (crosshair block) and ray/box tests (punch targets)
  torches.js                 Final generated attachment resolution against actual solid faces
  vegetation.js              Seeded biome plants and hanging strands; construction reservations
  npcs.js                    NPC kinds as data: model, box, hp, behavior, voice, dialogue
  npcSites.js                Worldgen: Wise Monkey shrines, Ancient Monkey seats, the storm cloud
  dialogue.js                Reusable dialogue: voices, subtitle timing, progress conditions, line choice
  npcLines.js                Wise Monkey hints/clues/stranger lines, Ancient Monkey sound responses
  protocol.js                Message type names, phases, entity type names
public/
  index.html                 Page shell and import map
  css/style.css
  js/
    main.js                  Client entry: screens, networking handlers, fixed-tick input loop, render loop
    net.js                   WebSocket wrapper (can hold messages while the world generates)
    input.js                 Keyboard, pointer-lock mouse look, mouse buttons, hotbar selection, key hook
    hotbar.js                Hotbar HUD
    itemIcon.js              DOM item icons for the hotbar and inventory
    inventoryScreen.js       Inventory / workbench / furnace / chest screen: slots, cursor, recipes, preview
    hud.js                   Health bar, kill feed, flag grab bar, notifications
    lobby.js                 Lobby and match-in-progress screens, remembered name
    dialogue.js              Subtitles (bottom center), speech synthesis and sound-only NPC voices
    spectator.js             Free-fly camera for eliminated players
    localPlayer.js           Client-side prediction and reconciliation
    debug.js                 Debug HUD
    render/
      scene.js               Renderer, camera, lights, fog tied to view distance
      clouds.js              Drifting cloud layers (island worlds)
      sky.js                 Day/night: sun, moon, stars, sky and fog color, lights
      mesher.js              Chunk -> BufferGeometry (visible cube faces; shaped blocks as colored boxes)
      chunkRenderer.js       Meshes chunks within the view distance, nearest first; unloads far ones
      plantMaterial.js       Alpha-tested plant atlas, shader wind and distance fade
      entityLighting.js      Shared air-cell sampling, smoothing and model/instance shader lighting
      entityRenderer.js      Remote entity models, snapshot interpolation, player animation
      models.js              Player model (body, head, arm), item models (cubes, hammer)
      viewModel.js           First-person arm and held item
      blockHighlight.js      Targeted block outline and break progress overlay
      flagRenderer.js        Flags, carried flags on backs, light beams, return puffs
      grappleLine.js         Grappling hook rope and hook head while a pull is on
      monkeyModels.js        Orangutan and gorilla NPC models on one rig; pose blending and idle animation
      stormEffects.js        Storm cloud flashes (additive sprites) and thunder
scripts/
  check.js                   `npm run check`
PROTOCOL.md                  WebSocket message reference
```


## Reusable structures and goblin worldgen

- `shared/structures/` is civilization-neutral. `buildability.js` reads the
  central terrain, connected water components, trees and registered structure
  boxes; `site.js` ranks eligible anchors outside caller-supplied reservations;
  `jigsaw.js` resolves weighted connector pools
  with rotation, uniqueness, required pieces, collision and earthwork rejection;
  `density.js` limits local excavation fill; `terrace.js` resolves local pads;
  `walls.js` clusters footprints and smooths axis-aligned outlines;
  `place.js` writes the resolved blocks and registers boxes/loot.
- Rejected jigsaw candidates defer voxel allocation until accepted (or until
  a validator reads their blocks). Accepted plans remain plain data. Density
  checks reuse factored axis intersections with a conservative volume bound;
  the exact local fill limit and deterministic layout remain unchanged.
  Immutable wall outlines reuse membership indexes. Fortress content reuses
  hall/shaft templates and copies only room loot metadata for depth changes.
- `worldSizes.js` holds the size registry; `worldgen.js` remains the seeded
  generation entry. `islands.js` accepts noise functions and a progress callback.
  The server sends `generation` percentages before `welcome`. Client generation
  runs in `public/js/worldWorker.js` through `worldGeneration.js`, using the
  same shared algorithms and vendor noise library without requiring worker
  import maps. `World.fromData` restores prototypes after buffer transfer;
  worker copies omit construction plans. The startup panel stays responsive
  and shows a percentage bar without generation details; generation errors are displayed.
- New worldgen producers must register occupied bounding boxes in
  `world.structures` (including standalone chests and roosts); the existing
  keeps are included by their footprint in buildability. Natural terrain masks
  remain unchanged by construction.
- `shared/goblins/surfacePieces.js` and `fortressPieces.js` provide the content
  pools; `settings.js` scales continuously from the central island radius;
  `fortressLayout.js` chooses a winding spine, random rooms, branches and a
  sealed cliff gallery through the generic jigsaw assembly API.
  `gatehouses.js` supplies timber gatehouse content; `generate.js` assembles
  a complete village and sealed fortress after
  other structures and trees in `islands.js`. All generation tuning is in
  `STRUCTURE_GEN` and `GOBLIN_GEN` in `shared/config.js`, without named world-size branches.
- `world.goblinPlan` retains surface pieces, connections, breadth-first order,
  pad earthworks, roads, rings/gates/posts, buildability and fortress stages.
  The final stage is placed; `fortress.stages.initial` retains the direct
  ladder shaft and Totem Hall for later construction. The final stage plugs
  that lower shaft and winds through random rooms, level hallways and lined
  1×1 ladder shafts into the hall from the side. The former King's room is
  an ordinary unique royal vault; King and Totem occupy the Totem Hall. The Castle's shaft mouth is flush with
  its ground floor. Towers use central hatch ladders, compounds contain small
  seeded building clusters, and wall-post ladders stay on the inside. Raised platforms outside a compound
  must exceed the normal sprint-jump range to its wall. Enclosure outlines
  cannot cut through another building or tower. `fortress.roomOrder` records
  main-route rooms; `routeOrder` records every connected room, hall and shaft.
  `world.goblinPlan.settings` retains scaled constraints; `reserved` marks a
  circular future-use center zone. Cliff galleries have single-block slits
  and brick buttresses. Tree plots, stairs underground, colony AI,
  construction, sieges and creative overlays are absent. Goblin life is described below.
- Goblin Bricks retain historical block ID 60 (hardness 8); hidden poison
  shooters retain IDs 79–82. IDs 59 and 61 stay reserved. Mushroom decoration
  uses new block ID 83. Never reuse deleted IDs.
- `server/fortressTraps.js` pairs concealed wall shooters with floor sensors,
  launches ordinary Arrow entities, excludes goblin factions and applies
  server-owned poison through existing damage messages. Breaking the shooter
  disables its sensor; poison expires and cannot reduce HP below one.
- `shared/blockTextures.js` defines atlas UVs. `chunkRenderer.js` packs all
  textured block materials with extruded gutters and mipmaps, nearest
  magnification and renderer-maximum anisotropy. Shaped blocks retain their
  model geometry. Goblin Brick artwork is the historical 32-pixel drawing
  recovered with `git show`, resampled without smoothing into the same atlas.
- `registeredBlockIds()` and `registeredItemIds()` enumerate the actual
  registries, including air and encoded block variants.
  Creative recipes are generated from that inventory registry. Mushroom
  inventory art is `public/textures/mushroom.svg`, referenced by its definition.
- Crawlers use `pathfind.js` with body-width clearance and partial paths to
  chase targets in the air; target acquisition is separate from reachability.
  `mobSteering.js` resolves overlaps symmetrically with bounded, collision-safe
  pushes using fresh position grids. Player prediction physics remains shared.
- `node scripts/structure-map.js <seed> [small|medium|large]` prints an island
  overview (reserved center and cliff protrusions), detailed compounds,
  gatehouses/Castle, and fortress level slices (`--surface-only` omits slices).
  `node scripts/village-check.js 1 2 3 --maps` checks placed voxels and writes
  ASCII artifacts under `/tmp/structure-<seed>.txt`. Also run `npm run check`.


## Lighting, hydrology and lobby media

- All tuning for these systems lives in `shared/config.js`: `LIGHTING`,
  `SKY_SETTINGS`, `CLOUD_SEA`, `RIVER_SETTINGS`, `GENERATION_PROGRESS`,
  `LOBBY_MEDIA`, and `LOBBY_CAPTURE`. The day/night cycle is 12 minutes.
- `shared/lighting.js` contains bounded opaque-aware block floods, cached
  sky/void boundary rays and bounded opaque-aware open-air floods. Direct sky
  uses the actual highest opaque block. Void sources use bottom/side exposure;
  roof/floor-enclosed cavities receive short spill at their openings, so a
  straight fortress slit does not illuminate the entire gallery.
  `public/js/lightingWorker.js` mirrors lighting-relevant edits; initial chunk
  light is computed there. `render/voxelLighting.js` schedules loads and patches
  Basic materials with one three-channel block/sky/void vertex attribute. Time changes
  only the skylight uniform. Edits remove and re-add light within the configured
  reach; opaque edits also reflood loaded chunks along changed boundary rays.
  Exact dirty chunks feed the existing per-frame remesh budget.
  No PointLights, per-frame floods, or full-world lighting recomputations.
- Torch ids 84–88 are floor/wall variants; never reuse or renumber ids.
  Item 84 drops from every variant and crafts from planks. Atlas torch art and
  `public/textures/torch.svg` provide its texture/icon; held models use a torch.
- `shared/rivers.js` plans lake sources, optional through-lakes and continuous
  noisy downhill curves to the real central-island boundary. A distance field
  carves tapered beds/banks and constant-level reaches with waterfall drops.
  Its first river is a radius-scaled gorge with a winding outward route,
  varying width and steep rock banks. Its former source lake is replaced by
  a river cave bending around the reserved center to a second cliff waterfall.
  `rivers[0].waterfalls` records both outlets. Tributaries can reuse its
  downstream route and levels. The gorge updates the central surface map;
  original natural terrain masks remain unchanged, as for other rivers.
  `finishRiverBanks` runs after village earthworks. Lake footprints respect
  minimum area and the circular central reserve. Natural terrain masks remain
  unchanged. `world.riverGenerationMs` includes bank finishing time.
- `shared/generationProgress.js` maps internal stages to monotonically
  increasing percentages. `generation` carries only `{percent}`. Server build,
  client worker generation and first visible meshes share one loading bar.
- `public/js/lobbyMusic.js` loops the CC0 track in `public/audio/lobby.ogg`
  after a gesture and fades it when loading finishes. Its volume is remembered.
  Source/license and normalization are in `ASSETS.md`.
- `public/js/fullscreen.js` handles fullscreen, optional Keyboard Lock,
  paused input and close confirmation. Keyboard Lock requires localhost/HTTPS;
  ordinary HTTP LAN clients retain the browser's shortcut restrictions.
- `render/capture.js` downloads the current view after host-authorized
  `captureLobby`; it does not enable preserveDrawingBuffer for normal frames.
  `public/capture.html` / `public/js/captureScene.js` render a fixed large world
  without joining a match. `scripts/capture-lobby.js` uses externally installed
  Playwright to produce `public/img/lobby.png` from that actual renderer.
- Focused checks: `node scripts/lighting-check.js`, `node scripts/river-check.js`
  (seeds 1–3, optional seed arguments or `--large`), and `npm run check`.
  River checks write overhead SVG maps to `/tmp/river-<seed>.svg`.


## World appearance and entity illumination

- `WORLD_LOOK`, `ISLAND_SHAPE` and `VEGETATION` in `shared/config.js` contain
  appearance/profile/decorations tuning. Height and biome noise use domain
  warping; island outlines stay near-circular. Bottom heights use broad 2D
  lobes anchored to island height, independent of small surface bumps. Only
  the thin outer shell uses extra 3D noise, retaining a sheer upper rim and
  connected rock columns. Sealed fortress galleries may bridge that tapered
  shell; interior rooms retain the full rock-margin requirement.
- `shared/torches.js` resolves generated torches after all construction and
  river bank finishing: prefer a solid wall, otherwise a solid floor. IDs
  84–88 remain unchanged. Floor torches do not acquire a wall orientation
  during jigsaw rotation. Wall models tilt rigidly out from their supporting
  face. Authoritative placement rejects ceilings/non-solid supports; existing
  attachment cleanup also handles broken supports and explosions.
- Plant IDs 89–101 follow the historical torch range; mushroom 83 is retained
  and now uses the same crossed-quads shape. Every plant/strand has unique SVG
  inventory art and enters creative inventory through the canonical item
  registry. No historical/reserved ID is reused. Existing fortress mushroom
  farm decorations remain explicit content rather than biome vegetation.
- `shared/vegetation.js` runs last with its own seeded RNG and noise clusters.
  Surface plants require grass/dirt and clearance; a column mask excludes all
  registered construction, keeps, goblin roads/walls and the circular reserve.
  Roots/vines occupy exposed cliff cells and the upper underside. Their
  emission is data in the registry. `blocksAttack` excludes decorations from
  client aiming and authoritative melee rays while mining still targets them; non-solid registry properties
  already exclude them from projectiles, targeting LOS and collision.
- `render/plantMaterial.js` packs SVG artwork into one alpha-tested atlas.
  The mesher batches two crossed quads per cell into one plant draw per chunk.
  Anchored shader sway and distance fade require no per-plant CPU updates or
  remeshing. Plant item models reuse their SVG textures.
- `render/entityLighting.js` samples the same block/sky/void buffers and uses
  exactly the terrain's tint and time coefficients. Normally one light-grid
  lookup per visible entity/frame; a sample inside solid terrain selects the
  brightest of its six non-solid neighbours. One RGB uniform per entity is
  smoothed over the configured fraction of a second. World-space normals add
  slight up/down shading. Material bindings refresh only when equipment
  changes; shared materials receive independent entity bindings. Players,
  cows, dragons, crawlers, eels, items, arrows, the first-person arm/held item
  and turret models use this helper. Sprites are supported; `lightInstance`
  writes the same smoothed value into an instance attribute for future batches
  (current entity factories do not use instancing). Hit-flash emissive colors
  remain visible. Entity night brightness has no separate visibility floor.
  Empty air chunks are requested through `LightingClient.requestCell` too;
  entities retain their previous illumination while buffers arrive. This
  includes the first-person hand when flying beyond stored terrain chunks.
  Worker floods handle regions outside world bounds without invalid buffer
  allocations or aliased block light. Sea glow fills missing skylight rather
  than adding to full skylight; night sky and void strengths remain separate
  config values, shared by terrain, water, vegetation and entities.
- `public/look.html` / `public/js/lookScene.js` provide an actual-renderer
  review harness. `scripts/look-capture.js before|after 1 2 3` uses externally
  installed Playwright (`PLAYWRIGHT_MODULE`, optional `CHROME_PATH`) and saves
  above/side/below/forest day/night PNGs and timings under `/tmp/look-<label>`.
  It detects shader compilation errors and checks time-only remesh counts.
  The forest camera finds actual standing space after terrain earthworks,
  avoiding old height-map samples inside solid ground or tree trunks.
- Focused checks: `node scripts/world-look-check.js` checks Small seeds 1–3,
  actual torch supports, vegetation exclusions, fortress darkness, creative
  choices, determinism, melee and arrows through plants. It includes the
  existing village check. `node scripts/lighting-check.js` checks sky/void and
  block light, boundary-ray edits, straight cave mouths, real torch placement
  and support drops. Also run `node scripts/river-check.js` and `npm run check`.
  Entity appearance checks are manual at the user's request.

## Central island regions and hanging support

- `CENTRAL_TERRAIN` and `GORGE_SETTINGS` in `shared/config.js` tune the new
  central features. `centralTerrain.js` derives orientation, transition,
  ridge arc/radius and gorge side from an independent seeded stream. Heights,
  noise scales, terrace bands and gorge dimensions scale from the real island
  radius. The circular reserve receives exactly zero regional/terrace blend.
  `islands.js` includes the regional profile in planning bounds and stacked
  island clearance, before voxel allocation. Outline and underside algorithms
  stay shared with other islands. The hot ore pass reads neighbours in its
  current chunk directly; only boundary cells need world lookups. Exposure
  rules and noise calls stay the same.
- `rivers.js` records `world.terrainExclusions` for the gorge and its buffered
  rim and river cave. `riverCave.js` extends the upstream end into a tunnel,
  bending around the circular reserve to another face, and carves
  bounded columns from the existing river distance field, retaining a rock
  roof and dry walking shoulders. The surface gorge remains open; both cliff
  outlets waterfall into the void. `GORGE_SETTINGS` supplies tunnel dimensions
  and the fortress rock margin; `world.gorgeCave` retains entrance/exit data.
  `structures/buildability.js` includes those columns in generic keep-out
  cells; site selection, jigsaw pads, roads, walls and fortress rooms consume
  that same map. `worldStructures.js` respects the mask for other construction.
  `centralTerrain.lowland` is a transferred Float32 map; `structures/site.js`
  scores broad height relief and lowland preference from `STRUCTURE_GEN.score`.
  Fortress cliff selection
  in `goblins/fortressLayout.js` rejects occupied cliff approaches, keeping the
  sealed protrusion clear of reserved terrain and gorge walls.
- `world.reservedZones` holds the center reservation. The shared
  `structures/place.js` policy checks resolved plans and is reused by standalone
  structure, roost and quarry placement. Random structures include the configured
  reservation margin for roof overhangs and earthworks. Tree canopies also respect
  this policy. Forest density, noisy clusters and clearings tune from
  `BIOME_SETTINGS`; lowland forest patch sizes tune from `CENTRAL_TERRAIN`.
  Retain trees in open village space and around its walls; construction
  reserves its footprints and required headroom, without an extra clearing ring.
  Required village/fortress placement precedes optional random structures;
  those structures avoid the resolved pieces and outer enclosure. Trees follow
  construction, with height-aware footprint checks so buried rooms do not
  exclude surface trees. `placePlan` records a transient per-column headroom
  map consumed by tree canopy checks, preserving roads and archer platforms
  while allowing trees in open courtyard space. It is discarded after growth.
  Surface plans defer earthwork allocation until gatehouses validate. Each
  candidate anchor uses a separate repeatable layout seed to avoid retrying
  the same unsuitable branch pattern at every site.
  `structures/walls.js` opens a gate only when a road has opposite approaches,
  avoiding gaps where a terminating road merely touches the enclosure.
- Glowing vegetation frequency and emission tune from `VEGETATION`. The goblin
  song gain is `AUDIO.fortressGain`; sound files and falloff remain shared.
  `public/js/audioMixer.js` registers both gorge waterfalls as ambience sources.
- Hanging definitions in `blocks.js` carry support `[0,1,0]`. `vegetation.js`
  starts a strand only below a solid block or an existing strand. `Game.stepPlace`
  enforces the same rule; generic attachment cleanup drops the remaining chain
  when overhead support disappears. `shared/audio.js` maps all crossed-quad
  plants and strands to grass audio for both breaking and placing.
- `node scripts/central-island-check.js` checks seeds 1–3: structure/river
  reserve exclusions, roofed river cave with walking shoulders, both waterfalls,
  fortress separation, existing village checks and repeat-seed voxel hashes.
  `--large` uses Large worlds. The user owns visual/gameplay checks and the
  three entity appearance checks. Run `npm run check`; compare generation with
  the same Large seeds and team count, and measure the actual dense-forest view.

## Branching forests

- Branch is new block ID 102; all historical and reserved IDs remain intact.
  `branchBoxes` in `shared/blocks.js` caches the 64 six-neighbour shapes: a
  one-third-width core and arms toward Branch/log/leaf faces. The same boxes
  drive chunk meshing, authoritative/client raycasts, predicted player/item
  collision, eel body clearance, placement overlap checks and multipart
  selection overlays.
  Branches are solid but light-transparent. Meshing reuses the bark atlas;
  `public/textures/branch.svg` supplies their unique automatic creative icon.
- `TREE_SETTINGS` in `shared/config.js` holds tree tuning. `shared/trees.js` creates seeded oak, birch,
  pine and ancient skeletons with face-connected diagonal steps, leaning full
  log trunks, forks and leaf clusters. It validates the complete plan before
  writing, respecting keeps, construction headroom, water and the center reserve.
  Crowns obstructed by terrain prune disconnected leaf cells with a local flood;
  unobstructed crowns reuse cached species offsets without that extra work.
  `shared/structures.js` retains the existing forest cell rolls/density and
  exports the shared sapling/tree entry points. Giants precede understorey trees.
  Natural trees register `kind: 'tree'` boxes and retain `world.trees` records;
  tree boxes allow canopy overlap and forest-floor vegetation. A transient
  construction-only obstacle list avoids repeated scans over preceding trees.
- `shared/woodedBiomes.js` overlays Ancient Forest only on the original forest
  mask, retained as `world.regularForest`; `world.ancientWeights` gives a smooth
  transition in trunk height/width, limb length and crown radius. `shared/biomes.js` retains the original
  terrain-weight names and adds the Ancient Forest surface biome code.
  Highlands retain their original terrain and biome selection.
- `shared/fallenTrees.js` places a few supported ground-following old-growth
  logs. Hollow giant bases have a walk-in entrance and short rooted foundations.
- `server/leafDecay.js` handles natural Branches and leaves in the same bounded,
  event-driven queue. Branch support paths traverse only Branches to a log;
  leaf support paths may traverse both leaves and Branches. Reach and work
  budgets are configured; connected-foliage discovery is spread across ticks
  and support searches charge the tick budget by visited nodes. Logs never decay.
  `Game.stepPlace` marks placed
  foliage so it never decays; replacements/removals clear that protection.
- Water uses the original transparent voxel-lit material, with no shimmer
  shader or animation time. Plants retain their existing wind animation.
- `node scripts/tree-biome-check.js` checks Branch geometry/rays/physics,
  creative coverage, hollow entry, natural versus placed decay, all generated
  Branch/leaf support paths, original-forest containment and repeat-seed
  voxel/biome hashes.
  `--large` uses seeds 1–3 and four teams and compares generation against
  `/tmp/trees-before.json` when present, or an explicit `--baseline=PATH`.
  `scripts/look-capture.js LABEL 1 --forests-only
  --size=large` measures dense regular and ancient forest views with the actual
  renderer and checks shader compilation and time-only remesh counts.
  Run `node --experimental-loader ./scripts/client-module-loader.js
  scripts/tree-mesh-check.js` for actual Branch mesh/bark bounds and static leaf
  geometry. Also run existing central-island, world-look, lighting, river and village
  checks and `npm run check`. User playtesting owns appearance/gameplay review.

## Runtime rendering performance

- `render/chunkMesher.js` is the shared mesher factory. Pages provide Three
  through the import map; `meshWorker.js` uses its explicit vendor URL. A bounded
  `MeshWorkerClient` queue copies only each chunk's 3x3x3 neighbourhood and
  transfers completed geometry arrays and bounds. `LIGHTING.meshWorkerBatch`
  controls its size; existing frame budgets limit installation and requests.
  Block edits and lighting dirtiness reject stale results while keeping the old
  mesh visible until its replacement arrives. Workers terminate on disconnect.
- Chunk face visibility and ambient occlusion share a padded block cache;
  interior rows come directly from the chunk. Static terrain matrices don't
  update per frame. Entire meshes beyond the actual camera-depth fog plane skip
  drawing; culling uses the same depth convention as Three's fog.
- Goblin animation rigs live outside scene traversal. Instance batches compact
  only visible members, upload only their used ranges and hide empty batches.
  Conservative frustum bounds skip animation and light sampling for off-screen
  goblins while leaving room for their weapons and animated limbs.
- `scripts/render-performance-check.js --large` uses external Playwright like
  `look-capture.js`. It verifies actual worker geometry against the synchronous
  mesher, edits during in-flight jobs, chunk boundaries, camera changes, and
  goblin batch visibility/removal/reuse. Also run the client import check,
  existing tree mesh check and `npm run check`. Use the same seeds and views in
  `look-capture.js` for before/after timing comparisons.

## NPCs, the monkeys and spoken dialogue

- NPC kinds are data in `shared/npcs.js` (`NPC_DEFS`): entity type `npc` with
  `npc` naming the kind; model, box, hp (null = cannot be damaged), behavior
  (`seated` or `restless`), voice and dialogue. `server/npcs.js` runs them in
  `Game.npcs` (not `Game.mobs`): no pathfinding or combat, a quantized head
  turn toward the nearest player, and for `restless` a sit -> stand -> walk /
  look -> walk home -> sit cycle whose pose is in the snapshot. The client
  animation (`render/monkeyModels.js`) blends joint targets per pose, so later
  behavior can reuse `stand`, `walk` and `look`. Ancient Monkeys are marked
  "LATER UPDATE": no damage and no abilities yet.
- Dialogue is reusable: `shared/dialogue.js` holds voices (`speech` via the Web
  Speech API with pitch/rate from `DIALOGUE.voices`, or `sound`), subtitle
  timing and data conditions (`obtained`/`crafted`/`placed`/`feature`,
  `all`/`any`). Lines are data in `shared/npcLines.js`. The server answers
  `talk` with a private `speak`; `public/js/dialogue.js` shows the subtitle and
  speaks it at master x voice volume (the `voice` slider comes from
  `AUDIO.volumes`). Speech is optional; subtitles always show.
- Team progress for hints is only what they need (`server/teamProgress.js`):
  inventory contents when an `inventory` message is sent, non-creative crafts,
  and placements (item ids). `node scripts/npc-hints-check.js` checks every
  hint/clue condition on a fresh team and that the hints pass in order.
- `shared/npcSites.js` runs after the goblin village and before optional
  structures and trees, and registers shrine and cloud boxes in
  `world.structures`. Shrines are 7x7 open platforms with a stepped roof,
  corner logs, pillar torches and a large chair, on a levelled pad
  (`SHRINE_GEN`). The Water Monkey sits in the deepest roomy river cell near the
  middle of `world.gorgeCave` (fallback: `rivers[0]`, flagged `fallback`). The
  storm cloud (`STORM_CLOUD`) is an ellipsoid plus puffs, hollowed above a
  floor, with a doorway facing the island and window gaps; Storm Cloud (id
  120) is solid, soft and light-transparent. Tuning: `NPC`, `DIALOGUE`,
  `SHRINE_GEN`, `STORM_CLOUD` and the monkey/thunder entries of `AUDIO`.
- Monkey and thunder sounds are CC0 recordings in `ASSETS.md`, converted by
  `scripts/prepare-audio.py` (`FLAG_AUDIO_ONLY` limits it to matching files).


## Goblin life, slice 1a

- `shared/goblins/life.js` holds body dimensions recovered from commit
  `5be99f1`, role/duty data, slot scaling, area bounds and timers. Roles do
  not own separate AI implementations. Historical egg ids are restored:
  Worker 295, King 296, Soldier 298, Archer 299, Brute 302; other retired ids
  remain reserved. Creative status is still granted only to the local host.
- `shared/goblins/areas.js` builds a bounded walkable graph from placed plan
  floors, platforms and ladders. Connected components excluding doorways are
  active 3D areas; small components merge through gates, oversized courtyards
  receive brick partitions, and fortress hall cuts scale within configured
  bounds. Added guard rooms provide missing spawn sites. `positionRegion`
  is the single volume query for areas, outskirts and creative egg homes.
  Wall columns are forbidden at their actual surface heights; explicit
  shooting platforms use inside ladder access and never cross the wall.
  Volume footprints also include solid wall, building and shaft columns;
  position queries and block-edit invalidation aren't limited to feet cells.
- `shared/goblins/outskirts.js` builds a band outside active development,
  excludes protected/void/non-walkable ground and follows perimeter arc length
  for sections. Disconnected walkable perimeter components receive physical
  outer gates and correctly oriented timber gatehouses. Isolated patches too
  small for a section, or without a safe gate approach, are excluded.
  `recomputeOutskirts(world)` replaces section data and increments its version;
  garrison removes obsolete section units/slots and creates fresh slots.
  `shared/islands.js` calls it after trees/vegetation finish, so ground routes
  see the final obstacles rather than tree-free intermediate terrain.
- `world.goblinPlan` retains `areas`, `outskirts`, `gates`, graph nodes and
  volume/column memberships. Gates connect exactly two regions. All generated
  areas start active. A future construction caller must set area states then
  call `recomputeOutskirts`; planned regions receive no spawns. Client workers
  continue to discard construction plans before transferring world buffers.
- `server/goblins/garrison.js` owns fixed slots, building release times and
  role-based respawns; no population counters, economy, repairs or building
  AI. Spawn selection uses nearest in-area buildings, then the fewest gate
  crossings to another active area. King/Totem never respawn. Eggs outside
  the village create a small local navigation volume, separate from village
  development; egg units do not respawn.
- `server/goblins/unit.js` is one state machine (idle/work/patrol/post/fight/
  flee/return). Only idle, patrol, post and return run in this slice. All path
  steering goes through `shared/mobMovement.js` and the existing `stepPlayer`
  gravity/collision/step/jump/ladder physics. `input.climb` is an optional
  server-side mob direction; normal player inputs retain their original
  deterministic behavior. Waypoints advance every physics tick; collinear
  runs are collapsed. Posts pace and look around, workers visit interests,
  and section patrols traverse a graph diameter and retrace it.
- `server/goblins/nav.js` caches surface flow fields and underground
  room-cross/hall-center/shaft waypoint graphs. Local attachments and
  cross-area searches share a per-tick node budget; ladder edges cost more
  and role data can prohibit them. Changed blocks invalidate only containing
  volumes, bump their revisions and re-route affected units. Graph refreshes
  coalesce edits per affected region at the next tick. Stuck recovery
  re-routes first, then permits a short body-clear advance only out of every
  player's line of sight at both endpoints.
- `server/mobSteering.js` retains target approach offsets and applies one
  quadratic soft overlap push after movement for cows, dragons, crawlers,
  eels, goblins and monkeys. It reuses `SpatialHash`; bodies aren't solid to
  each other, pushes obey terrain and never change yaw. Flying destinations
  and ground path steering receive no second separation force. If hallway
  sides block separation, the same pressure tries the length of the hallway.
- `public/js/render/goblinModels.js` restores Worker/Soldier/Archer/Brute/
  King/Totem models and animation from `5be99f1`, with only import adaptation,
  removal of siege gliders and the climbing pose priority fix.
  `goblinInstances.js` batches repeated rig parts by role while retaining the
  historical joint animation. It uses existing entity light samples and
  `instanceLight` shader support. The Totem keeps its original separate model.
- Existing `EntityInterest` supplies distance cadence and changed-only
  snapshots; `sampleSnapshots` handles interpolation. Goblins use compact
  `g` animation state in existing spawn/state messages; see `PROTOCOL.md`.
  No connection or voice-chat flow was added or changed.
- Run `npm run check` and `node scripts/goblin-life-check.js 1`. The latter
  generates one Small world, validates spawn sites, gate endpoints, all slot
  routes, home patrol/interest routes, wall restrictions and King's ladder
  prohibition, and writes labeled ASCII and full geometry maps to `/tmp`.
  Cross-area spawn travel is explicitly checked against the gate-chain
  volumes; home patrol/working routes must remain inside their home volume.

## Chunk simulation, working monkeys and creative eggs

- `server/chunkLoading.js` indexes entities and queued work by horizontal
  chunk column. `CHUNK_LOADING` keeps eight chunks around each live connected
  player and every team island plus its margin active, across the full height.
  `ChunkEntityMap` retains normal Map access for welcome/targeting but exposes
  `activeValues`, `activeEntries` and `nearbyValues` for bounded runtime work.
  Relocate moving entities after physics. Sleeping entities retain their state;
  physics ticks are not replayed on wake. Terrain buffers remain resident.
  Water/foliage queues, containers, sapling timers, quarries, turrets, traps and
  garrison releases obey the same tickets. Player prediction stays unchanged.
- `World.getSurfaceY` skips missing chunks and reads stored column cells
  directly. `server/dragonSurface.js` caches bounded solid-column heights;
  invalidate the edited column in `Game`'s block-change callback. Hidden dragon
  rigs leave scene traversal; static dragon parts merge by material without
  changing geometry, joints or fire. Visible dragons use ten body draw calls.
- `shared/monkeys.js` defines roles, names and filters; `MONKEY_WORK` tunes
  spawning, ranges, budgets and minigames. `server/monkeyTaming.js` owns Simon,
  memory and cup-shuffle answers/timers. `server/monkeyWorkers.js` owns team
  taming, settings revisions, cargo, seed reserves and work. Wild monkeys are
  brown, tamed monkeys use team colors, and names never change. Any teammate
  can configure them through `public/js/monkeyScreen.js`; protocol views stay
  private. Sounds reuse the existing monkey audio.
- Courier routes persist across trips. Only changed endpoints/work bounds,
  edits intersecting a route, a displaced start or stuck recovery invalidate
  them. Failed routes watch their bounded work volume. Furnace extraction uses
  output only; insertion prefers fuel then input. Preserve stack modifiers.
- Lumberjacks use only explicitly marked base columns; never add a grown-tree
  registry for this role. A leaf crown identifies a grown column. The marked
  column authorizes wood/branches above it up to the configured height, leaving
  horizontal branches to ordinary decay. Require a sapling reserve before
  chopping; supply it manually or from the delivery target. Replant at the
  same spot and retain one sapling from the harvest for the next cycle.
  Gather fallen saplings near marked bases, reserve one when needed and
  deliver filtered extras; never loop on the delivery pile.
- Glass is block 121, Charcoal item 305. Sand smelts into Glass, logs into
  Charcoal; Charcoal smelts eight items. `ORE_SETTINGS.ironDensity` keeps half
  the original seeded iron candidates without changing generation RNG order.
  `shared/mobEggs.js` supplies every creature/NPC kind, including Totem and all
  monkeys, and automatically enters creative recipes. New eggs use 306–310;
  all historical/reserved ids remain intact.
- Run `npm run check`, `node scripts/monkey-check.js`,
  `node scripts/chunk-loading-check.js`, and the existing movement/lighting/tree
  checks. `scripts/runtime-performance-check.js medium large` measures real
  seed-1 matches with two teams and checks all egg constructors.
  `scripts/monkey-browser-check.js` uses externally installed Playwright and
  `BASE_URL` (default localhost:3001) to check GUI actions, colors, geometry and
  dragon culling without joining or changing an existing match.
