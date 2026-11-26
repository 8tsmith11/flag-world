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
  world size (`WORLD_SIZES` in `shared/worldgen.js`: Test, Tiny, Small,
  Medium, Large); only those three are sent to clients. Test is the small slab world.
  The others are floating islands (`shared/islands.js`) and are tuned from
  that config plus the constants at the top of `islands.js`. Sizes differ in
  the center island's width and its gap to the ring (`WORLD_SIZES`);
  `ISLAND_LAYOUT` (ring and scatter thickness, keep spacing) is shared and
  `islandLayout(size)` derives the rest, world width included. Caves are worm tunnels (smooth noise-steered
  paths carving round tubes) carved into each island's buffer (`carveCaves`)
  before fragment removal. The Test
  world is carved by the same code (as one square "island"), plus a tunnel
  near the first keep. Use
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

## Commerce, automation and defense

- Hostility is one rule (`server/hostility.js`): arrow turrets, guard and
  lookout monkeys and monkey arrows only target what `isHostileTo(team, x)`
  allows (other teams' players and tamed monkeys, goblins, Crawlers, Void Eels,
  dragons). Use it for anything new that picks targets.
- Sky Merchant (`server/merchants.js`, economy and docking in
  `shared/merchant.js`, tuning in `MERCHANT`): one depot per team
  (`BLOCK.MERCHANT_DEPOT`, container `depot`), placed on the team island's far
  edge with a clear dock (`checkDepotSite`). The airship is an `airship`
  entity (`merchants.ships`, sent to everyone each tick it moves); the merchant
  is an NPC (`skyMerchant`). Prices are fixed lists; any change to them,
  recipes, smelting, crushing or alloying must keep
  `node scripts/commerce-check.js` (no-arbitrage check) passing. Requested
  goods come from the seed (`merchantRequests`).
- Monkeys: roles in `shared/monkeys.js`; guard and lookout logic in
  `server/monkeyGuard.js`; craftsman, Collect drops (`config.collect`) and
  destination slots (`config.destSlots`, `SLOT_OPTIONS`) in
  `server/monkeyWorkers.js`. New config fields must default when a saved
  config lacks them (`parseConfig`). Babies (`m.baby`, `growAt`) can't work.
- Quests: data in `shared/quests.js`, team books in `server/quests.js`.
  Completion only reads team progress (`TeamProgress`: obtained, crafted,
  placed, and `event(team, key)` milestones), so instrument new mechanics with
  an event rather than special cases. Rewards stay small and are per team.
- Wise Monkeys can't be damaged (`hp: null`); their shrine floor and throne
  are `BLOCK.SHRINE_BRICKS` (unbreakable) so they can't be dug out. Any tamed
  adult monkey with a weapon in its tool slot fights back when attacked
  (`holdsWeapon`, self-defense through `guardTick`).
- Machine screens share `public/js/machinePanels.js`; containers report a
  `status` string in `view()` explaining why they aren't working.
- `TeamProgress`, quest books, depots, baby purchases and merchant stock are
  saved (`server/save.js`); ships and merchants are not (they fly in again).
- Checks: `node scripts/commerce-check.js`, `node scripts/merchant-check.js`,
  `node scripts/monkey-duty-check.js`, plus `npm run check`.

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
  provocation.js             Shared grudge (provoked target) and line-of-sight test
  flag.js                    A player's flag: home / carried / dropped / captured
  hostility.js               Who turrets, guard/lookout monkeys and monkey arrows may target
  merchants.js               Sky Merchant: daily airship visits, trading, depot sales, baby monkeys
  monkeyGuard.js             Guard (patrol, pursuit, melee/bow) and lookout (reports) monkeys
  quests.js                  Team quest books: completion, rewards, depot requests
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
  worldgen.js                World sizes config, seed parsing, generateWorld, the Test world
  islands.js                 Floating-island world gen (center, middle ring, outer scatter, bridges)
  structures.js              Keeps, sand shores, trees, seeded PRNG shared by the generators
  physics.js                 Deterministic player/item movement and voxel collision
  raycast.js                 Voxel raycast (crosshair block) and ray/box tests (punch targets)
  protocol.js                Message type names, phases, entity type names
  merchant.js                Merchant prices, requested goods, dock geometry, merchant looks
  quests.js                  Quest book chapters, quests, goals and knowledge text
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
    merchantScreen.js        Sky Merchant trade screen
    questScreen.js           Wise Monkey quest book: chapters, graph, details
    machinePanels.js         Shared machine/depot screen layout (slots, gauges, recipes, status)
    lobby.js                 Lobby and match-in-progress screens, remembered name
    spectator.js             Free-fly camera for eliminated players
    localPlayer.js           Client-side prediction and reconciliation
    debug.js                 Debug HUD
    render/
      scene.js               Renderer, camera, lights, fog tied to view distance
      clouds.js              Drifting cloud layers (island worlds)
      sky.js                 Day/night: sun, moon, stars, sky and fog color, lights
      mesher.js              Chunk -> BufferGeometry (visible cube faces; shaped blocks as colored boxes)
      chunkRenderer.js       Meshes chunks within the view distance, nearest first; unloads far ones
      entityRenderer.js      Remote entity models, snapshot interpolation, player animation
      models.js              Player model (body, head, arm), item models (cubes, hammer)
      viewModel.js           First-person arm and held item
      blockHighlight.js      Targeted block outline and break progress overlay
      flagRenderer.js        Flags, carried flags on backs, light beams, return puffs
      grappleLine.js         Grappling hook rope and hook head while a pull is on
      merchantModels.js      Sky Merchant (octopus) and airship models
      depotRenderer.js       Lantern signs over Merchant Depots (lit while docked)
scripts/
  check.js                   `npm run check`
PROTOCOL.md                  WebSocket message reference
```
