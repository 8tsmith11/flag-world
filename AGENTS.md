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
  world size (`WORLD_SIZES` in `shared/worldgen.js`: Test, Small, Medium,
  Large); only those three are sent to clients. Test is the small slab world.
  The others are floating islands (`shared/islands.js`) and are tuned from
  that config plus the constants at the top of `islands.js`. Sizes differ in
  the center island's width and its gap to the ring (`WORLD_SIZES`);
  `ISLAND_LAYOUT` (ring and scatter thickness, keep spacing) is shared and
  `islandLayout(size)` derives the rest, world width included. Caves are worm tunnels (smooth noise-steered
  paths carving round tubes) carved into each island's buffer (`carveCaves`)
  before fragment removal; the Test
  world has one tunnel near the first keep. Use
  `world.sizeX`/`sizeY`/`sizeZ`, not constants.
- Chunks are sparse: `World` only stores chunks that have held a non-air
  block, and `getBlock` returns air for missing ones. Clients mesh only chunks
  within the view distance (a client setting, `VIEW_DISTANCE`), nearest first,
  with fog ending at that distance.
- With `DEBUG` on, M toggles a top-down overview camera of the whole world. Block changes made after generation go through `world.setBlock`;
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
  flag.js                    A player's flag: home / carried / dropped / captured
  containers.js              Chest and furnace tile entities: slots, shift-click, smelting
shared/                      Runs on server and client
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
    spectator.js             Free-fly camera for eliminated players
    localPlayer.js           Client-side prediction and reconciliation
    debug.js                 Debug HUD
    render/
      scene.js               Renderer, camera, lights, fog tied to view distance
      clouds.js              Drifting cloud layers (island worlds)
      overview.js            Debug top-down camera of the whole world
      mesher.js              Chunk -> BufferGeometry (visible cube faces; shaped blocks as colored boxes)
      chunkRenderer.js       Meshes chunks within the view distance, nearest first; unloads far ones
      entityRenderer.js      Remote entity models, snapshot interpolation, player animation
      models.js              Player model (body, head, arm), item models (cubes, hammer)
      viewModel.js           First-person arm and held item
      blockHighlight.js      Targeted block outline and break progress overlay
      flagRenderer.js        Flags, carried flags on backs, light beams, return puffs
scripts/
  check.js                   `npm run check`
PROTOCOL.md                  WebSocket message reference
```
