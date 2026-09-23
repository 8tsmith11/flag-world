# Flag World protocol

All messages are JSON text frames over a single WebSocket connection to the
same host and port that serves the page (`ws://<host>:3000`). Every message has
a `type` field; the names are defined in `shared/protocol.js`.

Coordinates are in blocks. `x`, `y`, `z` for players are the center of the feet.
`yaw` is radians around +Y (0 looks toward -Z); `pitch` is radians, positive looks up.
Colors are integers `0xRRGGBB`.

## Connection flow

The server is in one of two phases (`PHASE` in `shared/protocol.js`):

1. **Lobby.** Every connection sends `hello` first. In the lobby phase the
   server adds it as a lobby member and sends everyone `lobby`. Members set
   their name, color and ready flag with `lobbyUpdate`. The first member is the
   host; if the host leaves, the next oldest member becomes host. When every
   member is ready, the host sends `startMatch`. The server generates the world
   from the seed and the member count, and sends each member `welcome`.
2. **Playing.** The match lasts until the server stops. A `hello` whose name
   matches a disconnected match player (ignoring case) takes over that player,
   keeping their position and inventory, and gets `welcome`. Any other
   connection gets `matchInProgress` and can take over a disconnected player
   with `reclaim`.

Each match player owns a flag and a keep; see [Capture the flag](#capture-the-flag).

A match player who disconnects stays in the world, standing where they were
and still listed in `state`. They don't pick up items while disconnected.

Names are 1–16 characters after whitespace is collapsed and trimmed, and are
unique within the lobby (ignoring case).

## Shared shapes

**PlayerSnapshot** — a player's state at one server tick.

| Field      | Type    | Notes |
|------------|---------|-------|
| `id`       | int     | Player id |
| `type`     | string  | Entity type, `"player"` |
| `x`,`y`,`z`| number  | Position |
| `vx`,`vy`,`vz` | number | Velocity (blocks/s); needed for client reconciliation |
| `kx`,`kz`  | number  | Knockback velocity (blocks/s), added to movement and decaying each tick; also needed for reconciliation |
| `yaw`,`pitch` | number | Look direction |
| `onGround` | bool    | Standing on a solid block |
| `crouching` | bool   | Crouched (drawn shorter and leaning forward); the client copies it into its physics state |
| `hp`       | int     | Health, 0..20 |
| `dead`     | bool    | Dead and waiting to respawn (or eliminated); not drawn, can't be hit, sends no inputs |
| `eliminated` | bool  | Died while flagless; out of the match for good and spectating |
| `carrying` | int \| null | Id of the flag they hold. Carriers walk at 60% speed (the client copies this into its physics state) |
| `grab`     | number  | 0..1 progress toward taking the enemy flag they're standing on; 0 when not |
| `held`     | int \| null | Item id in hand, drawn in their fist |
| `draw`     | number  | How far they've drawn a bow, 0..1 (0 when not drawing); drawn as the arm raising the bow and the string pulling back |
| `lastSeq`  | int     | Last input `seq` the server has simulated for this player |

**BlockPos** — `{ x, y, z }`, integer block coordinates inside the world.

**BlockChange** — `{ x, y, z, id }`, a block that now holds block id `id`.

Block ids are in `shared/blocks.js`. Ladders and doors carry their state in the
id, so opening a door or placing a ladder is just a `blockChange`. Facing is 0
north (-Z), 1 east (+X), 2 south (+Z), 3 west (-X).

| Ids   | Block | Encoding |
|-------|-------|----------|
| 10–13 | ladder | `10 + facing`: the side of its cell it hangs on (toward the block holding it). Not solid |
| 14–29 | door | `14 + facing + 4·open + 8·upper`: facing is the way the placer looked. Solid only when closed |

Other blocks added with crafting: 30 iron ore (hardness 3), 31 sand, 32
workbench (right click: crafting screen).

Furnaces and chests have their own inventory (see `openContainer`) and a
front that faces the player who placed them. They have one id per facing
(`FACED` in `shared/blocks.js`); the first id is the item and the drop.

| Ids | Block | Facing north, east, south, west |
|-----|-------|------|
| 33, 38, 39, 40 | furnace (hardness 2) | 33, 38, 39, 40 |
| 34–37 | chest (hardness 1) | 34, 35, 36, 37 |

**ItemStack** — `{ item, count }`. Item ids (`shared/items.js`,
`shared/itemIds.js`): 0–255 are the blocks (placed as that block); 256 and up
are other items: `256` wood hammer, `257` ladder, `258` door, `259` iron ingot,
`260` stone hammer, `261` iron hammer, `262`–`264` wood / stone / iron sword,
`265` bow, `266` leather, `267` beef.
`count` is 1 up to the item's `maxStack`: 1 for hammers and swords, 64 for
everything else. What held tools do is in `shared/tools.js`.

**InventoryState** — `{ slots, cursor }`: `slots` is 36 × (ItemStack \| null).
Slots 0–8 are the hotbar and 9–35 the main grid. `cursor` is the ItemStack
held on the mouse in the inventory screen, or `null`.

**ItemSnapshot** — a dropped item's position at one server tick.

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | int    | Entity id (shared id space with players) |
| `type`     | string | `"item"` |
| `x`,`y`,`z`| number | Bottom center of the item's cube |

**ItemInfo** — ItemSnapshot plus:

| Field  | Type | Notes |
|--------|------|-------|
| `item` | int  | Item id, which picks the cube's color |

**ArrowSnapshot** — an arrow's state at one server tick. Sent in `entitySpawn`
(as its info), then in `state` on every tick it flies and once as it sticks.
Clients interpolate it and point the model along the velocity.

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | int    | Entity id |
| `type`     | string | `"arrow"` |
| `x`,`y`,`z`| number | Position |
| `vx`,`vy`,`vz` | number | Velocity (blocks/s) |

**CowSnapshot** — a cow at one server tick. Sent in `entitySpawn` / `welcome`,
then in `state` only on ticks it moved.

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | int    | Entity id |
| `type`     | string | `"cow"` |
| `x`,`y`,`z`| number | Feet position |
| `yaw`      | number | Facing (0 looks toward -Z, like players) |

**PlayerInfo** — PlayerSnapshot plus:

| Field   | Type   | Notes |
|---------|--------|-------|
| `name`  | string | Player name |
| `color` | int    | Player color |

**LobbyMember** — `{ id, name, color, ready }`.

**FlagState** — a flag at one server tick. A flag's id is its owner's player id.

| Field       | Type        | Notes |
|-------------|-------------|-------|
| `id`        | int         | Owner's player id |
| `state`     | string      | `"home"`, `"carried"`, `"dropped"` or `"captured"` (`FLAG_STATE`) |
| `carrierId` | int \| null | Player carrying it |
| `x`,`y`,`z` | number      | Base of the pole: the pedestal when home, the carrier's feet when carried |

**FlagInfo** — FlagState plus:

| Field   | Type        | Notes |
|---------|-------------|-------|
| `color` | int         | Owner's color |
| `home`  | `{x, y, z}` | On top of the pedestal in the middle of the owner's keep |

## Client → server

### `hello`

Must be the first message on a connection. Later ones are ignored.

| Field  | Type   | Notes |
|--------|--------|-------|
| `name` | string | Name to use. Clients send the last name they used (kept in `localStorage`), or `""`. In the lobby, a blank or taken name gets a default `Player N`. During a match, it reclaims the disconnected player with this name, if there is one |

### `lobbyUpdate`

Lobby only. Any subset of the fields. The server answers with `lobby` to
everyone (also when a name is rejected, so the sender's field resets).

| Field   | Type   | Notes |
|---------|--------|-------|
| `name`  | string | New name; `error` if blank or taken |
| `color` | int    | New color |
| `ready` | bool   | Ready flag |
| `worldSize` | string | Host only: `"test"`, `"tiny"`, `"small"`, `"medium"` or `"large"` (keys of `WORLD_SIZES`); others ignored |

### `startMatch`

Host only, lobby only. Gets `error` if not every member is ready.

| Field  | Type   | Notes |
|--------|--------|-------|
| `seed` | string | Up to 64 chars. Blank = random, a whole number = that seed (mod 2³²), other text is hashed (`parseSeed`) |

### `respawn`

Match players only. Respawns in your own keep with full HP if you are dead,
not eliminated, and at least 3 s have passed since you died; otherwise ignored. The result
shows up in `state` as `dead: false` at the new position.

_(no fields)_

### `inventoryClick`

A click on a slot in the inventory screen, or in the container you have open.
The server moves stacks between the slot and your cursor; the result comes back
as `inventory` (and `container`, to everyone viewing it). Invalid clicks are
ignored. Clicks are handled one at a time on the server, and each player has
their own cursor, so two players can't take the same items: the first click
gets the stack and the second finds the slot empty.

| Field    | Type   | Notes |
|----------|--------|-------|
| `container` | bool? | true: a slot of the container you opened (it must still exist and be in reach). Otherwise your inventory |
| `slot`   | int    | Your inventory: 0..35. Chest: 0..26. Furnace: 0 input (smeltables only), 1 fuel (fuels only), 2 output (take only; a left click can add it to a matching cursor stack) |
| `shift`  | bool?  | Shift-click: move the whole stack across instead, as much as fits. Container slot → your inventory. Inventory slot → the open container (a furnace takes ore into the input and fuel into the fuel slot, nothing else). With no container open: hotbar ↔ main grid. `button` is ignored |
| `button` | string | `"left"`: pick up the whole stack, or put the cursor down (merging into the same item up to its max, or swapping with a different one). `"right"`: pick up half (rounded up), or put one item from the cursor down |

### `inventoryClose`

The inventory, workbench or container screen was closed. The cursor stack
goes back into the slots; whatever doesn't fit drops at your feet. Also stops
`container` updates. _(no fields)_

### `openContainer`

Right click on a chest or furnace within reach: the server starts sending you
its state (`container`) until you close the screen, walk out of reach, or it's
broken (`containerClose`). Anyone can open any container, and any number of
players can have the same one open.

| Field | Type | Notes |
|-------|------|-------|
| `x`,`y`,`z` | int | The chest or furnace block |

### `craft`

Crafts a recipe from `shared/recipes.js` if your slots hold its inputs and the
output fits (checked on a copy, so a full inventory refuses rather than losing
items). Inputs come out of the main grid before the hotbar.

| Field    | Type   | Notes |
|----------|--------|-------|
| `recipe` | string | Recipe `id` from `shared/recipes.js` |
| `at`     | BlockPos? | A workbench in reach. Required for recipes with `station: "workbench"`; ignored otherwise |

Recipes with `station: null` (planks, ladder, workbench) work anywhere; the
rest (hammers, swords, door, furnace) only at a workbench.

### `reclaim`

Match-in-progress screen only. Takes over a disconnected match player; gets
`error` if there's no such player or they are connected.

| Field  | Type   | Notes |
|--------|--------|-------|
| `name` | string | Player name, ignoring case |

### `input`

Match players only. Sent once per simulation tick (20/s). Each input advances the player by exactly one tick.

| Field     | Type   | Notes |
|-----------|--------|-------|
| `seq`     | int    | Increments by 1 per input, starting at your `lastSeq` + 1 from `welcome` |
| `forward` | number | -1..1 (W = 1, S = -1) |
| `strafe`  | number | -1..1 (D = 1, A = -1) |
| `jump`    | bool   | Jump held (swim up in water, jump out at the surface) |
| `crouch`  | bool   | Crouch held (Shift, only while no screen is open) |
| `draw`    | bool   | Right mouse held with a bow in hand (the client sends it only then; the server ignores it without a bow) |
| `yaw`     | number | Look yaw |
| `pitch`   | number | Look pitch, clamped to ±π/2 |
| `slot`    | int    | Selected hotbar slot, 0..8: the item in hand (tool strength, placing, dropping, `held`) |
| `breaking`| BlockPos \| null | Block the player is holding the break button on this tick, or `null` |
| `place`   | `{ x, y, z, nx, ny, nz }` \| null | Place the selected item in cell x, y, z this tick (right click), or `null`. `n` is the normal of the face that was clicked (one axis ±1), pointing into this cell |
| `use`     | BlockPos \| null | Right click on a door: open or close it (instead of `place`) |
| `drop`    | bool   | Throw one of the selected item this tick (Q) |
| `attack`  | bool   | Punch this tick (a left click with a player under the crosshair) |

`breaking` is how block breaking works: the server counts consecutive ticks on
the same block and replaces it with air once the count reaches
`breakTicks(id)` (the block's `breakTime` in ticks). Progress resets when
`breaking` changes or is `null`, the block is out of reach
(`REACH_DISTANCE` from the eyes, plus slack), or the strength of the item in
`slot` is below the block's `hardness`. Hammers are the only breaking tools
(`shared/tools.js`): wood 2, stone 3, iron 4; anything else (swords included)
breaks like bare hands, strength 1. The break time is the block's `breakTime`
divided by the hammer's speed (wood 1, stone 1.5, iron 2). The result arrives as a `blockChange`. The block's `drops` item
(usually itself; leaves drop nothing) pops out as an item entity
(`entitySpawn`). Other players get a `swing` every 5 ticks while mining.

`place` is the cell against the targeted face. The server places the item in
`slot` only if the cell is air or water (water is replaced), is within reach,
and is outside every keep's volume. Then, by item:
- **Block:** the cell touches a solid or breakable block and doesn't overlap any
  player. The exception is towering: a player in the air whose feet are at
  least 0.5 up the cell (and still in it), with room above, may place the
  block under themselves and is lifted on top of it.
- **Ladder:** the clicked face is a side (`ny` = 0) of a full solid block. It
  hangs on that face.
- **Door:** the cell above is also free, the block below is a full solid block,
  and no player is in either cell. It's placed closed, facing the way the
  player looks.

It then removes one from the stack and sends others a `swing`. `drop` throws
one item from `slot` along the look direction. Both are applied after that
tick's movement.

`use` opens or closes the door there (both halves) for anyone in reach. A
door won't close on a player standing in it.

Breaking: either half of a door removes the whole door and drops one door.
When a block breaks, ladders hanging on it and a door standing on it drop as
items.

Crouching (shared physics, simulated by the server and predicted by the
client): 30% walking speed (multiplied with the flag carrier's 60%), eyes 0.3
lower (reach and punches are measured from there), and a 1.45-tall collision
box, so a crouched player fits through 1.5-block gaps. Letting go of crouch
only stands you up once there's room for the full 1.8. Jumping works as normal.
Edge protection: while crouched on the ground and not jumping, each tick's X
and Z moves are checked separately. A move is cut short if it would leave no
ground within 1 block below the player's box (and no ladder there to grab),
so a crouched player can't walk off a drop of more than 1 block but can slide
along the edge.

Bows: while `draw` is held with a bow, the draw builds, but not within 0.5 s
of the last shot. Letting go shoots if it was held at least 0.2 s (sooner
cancels); a full draw is 1 s. Drawing halves walking speed (shared physics).
The arrow starts at the shooter's eyes along the look direction. Its speed
(15 to 50 blocks/s) and damage (1 to 5) scale linearly from the weakest shot
to a full draw. The server simulates it: gravity 12 (players have 28), 1% drag
per tick, and each tick's whole path is checked against blocks and players,
so fast arrows can't skip through thin walls. A block hit sticks the arrow
there for 10 s, or until that block breaks; arrows never damage blocks. A
player hit (not the shooter in the first 0.2 s) takes the damage and a small
push along the arrow. The kill, and a void or fall death within 5 s, is
credited to the shooter. Arrows are unlimited.

Cows: the server spawns herds at match start on open grass away from keeps
(about one per 20,000 square blocks of world, 3-6 cows each). They reuse the
player physics with a 0.9 × 1.3 box and edge protection always on, so they
never walk off a drop of more than a block. They graze, wander near the middle
of their herd, and head back if they stray, following A* paths over standable
blocks (steps of one up or down, no water). Punches and arrows hit them (10 HP,
knockback like players). When one is hurt, its whole herd runs away from the
attacker for 5 s. A dead cow drops 0-2 leather and 1-3 beef.

Ladders: while a player overlaps a ladder there's no gravity. Holding W or
jump climbs up, S climbs down (without walking off the ladder), and no input
holds position. This is in the shared physics, so it's predicted like the
rest of movement.

`attack` is confirmed by the server: it casts a ray from the attacker's eyes
along this input's `yaw`/`pitch`, up to `REACH_DISTANCE` or the first block in
the way. Every punch (hit or miss) sends others a `swing`. Player boxes are
grown by `HIT_TOLERANCE`, since the attacker saw the target slightly in the
past. The nearest live, connected player hit takes damage and knockback: away
from the attacker plus a small hop. Damage and cooldown come from the item in
`slot`: fists 2 every 0.4 s; wood / stone / iron sword 3 / 4 / 6 every 0.6 s
(on the server's clock). Missed punches count too. A
punch also takes priority over `breaking` in the client: while a player is
under the crosshair it sends no `breaking`.

Health: 20 HP. After 5 s without damage, the player regains 1 HP every second.
At 0 HP the player dies and drops their whole inventory (and cursor stack) as item entities.
Falling below y = -20 (off the edge of the world) kills and destroys the
inventory.

Fall damage: the server tracks the highest point since the player last stood
on something, held a ladder or was in water. On landing, a fall of more than
3 blocks costs 1 HP per whole block beyond 3 (a `damage` with `attackerId`
null). Landing on or grabbing a ladder resets the fall. Void and fall deaths
are credited to whoever last hit the player, if that was within 5 s. Inputs from a dead player are acknowledged (`lastSeq`) but not
simulated.

The server ignores inputs whose `seq` is not greater than the last simulated one,
and drops inputs past a queue of `MAX_QUEUED_INPUTS`.

## Server → client

### `lobby`

Sent to every lobby member whenever the lobby changes.

| Field     | Type          | Notes |
|-----------|---------------|-------|
| `you`     | int           | Your member id (also your player id once the match starts) |
| `hostId`  | int           | Host's member id |
| `worldSize` | string      | World size the host has picked (default `"medium"`) |
| `players` | LobbyMember[] | In join order |

### `matchInProgress`

Sent to a connection that joined during a match, and again whenever a match
player connects or disconnects.

| Field     | Type | Notes |
|-----------|------|-------|
| `players` | `{ name, color, connected }`[] | Match players; ones with `connected: false` can be reclaimed |

### `error`

A request was refused. Clients show it on the current screen.

| Field     | Type   |
|-----------|--------|
| `message` | string |

### `welcome`

You are in the match: sent to every member when the host starts it, and on a
reclaim.

| Field     | Type          | Notes |
|-----------|---------------|-------|
| `id`      | int           | Your player id |
| `color`   | int           | Your color |
| `seed`    | int           | World seed; build the world with `generateWorld(seed, playerCount, worldSize)` |
| `playerCount` | int       | Players when the match started: one keep each (and the Test world's size) |
| `worldSize` | string      | `WORLD_SIZES` key. `"test"` is the small slab world; the others are floating islands, 128 high |
| `tick`    | int           | Current server tick |
| `blocks`  | BlockChange[] | Every block changed since generation; apply after `generateWorld` |
| `players` | PlayerInfo[]  | All match players, including you and disconnected ones. Your own entry's `lastSeq` is where your input `seq` continues from |
| `flags`   | FlagInfo[]    | Every player's flag |
| `winnerId`| int \| null   | Set if the match is already over |
| `entities`| (ItemInfo \| ArrowSnapshot \| CowSnapshot)[] | Dropped items, arrows and cows currently in the world |
| `inventory` | InventoryState | Your inventory |

### `state`

Broadcast every server tick (20/s).

| Field      | Type             | Notes |
|------------|------------------|-------|
| `tick`     | int              | Server tick number |
| `entities` | (PlayerSnapshot \| ItemSnapshot \| ArrowSnapshot \| CowSnapshot)[] | All players, plus only the items, arrows and cows that moved this tick. One not listed stays where it was |
| `flags`    | FlagState[] | Every flag |

### `blockChange`

A block changed (e.g. it was broken). Broadcast to everyone, including the
player who caused it.

| Field     | Type | Notes |
|-----------|------|-------|
| `x`,`y`,`z` | int | Block position |
| `id`      | int  | New block id |

### `entitySpawn`

A non-player entity appeared: a block drop, a thrown item, or an arrow.

| Field    | Type     |
|----------|----------|
| `entity` | ItemInfo \| ArrowSnapshot \| CowSnapshot |

### `entityDespawn`

A non-player entity was removed: an item was picked up (all of it) or reached
its 5 minute lifetime; an arrow hit something, had its block broken, stayed
stuck for 10 s, or fell below y = -20; or a cow died or fell into the void.

| Field | Type | Notes |
|-------|------|-------|
| `id`  | int  | Entity id |

### `inventory`

Your inventory changed (pickup, place, drop, inventory click, craft, death).
Sent at most once per tick, only to the owning player. The fields are an
InventoryState.

| Field    | Type                  | Notes |
|----------|-----------------------|-------|
| `slots`  | (ItemStack \| null)[] | 36 slots |
| `cursor` | ItemStack \| null     | Stack on the mouse |

Pickup: after a short delay (0.5 s for block drops, 2 s for thrown items), an
item within 1.5 blocks of a player's body goes into their inventory. It tops up
matching stacks first, then fills empty slots, hotbar before main grid in both
passes. Whatever doesn't fit stays on the ground.

### `swing`

Another player swung their arm (punch, mining, or placing a block). Not sent
to the player who swung; their own first-person arm animates locally.

| Field | Type | Notes |
|-------|------|-------|
| `id`  | int  | Player who swung |

### `damage`

A player or cow took damage (a punch, an arrow or a fall). Broadcast to every
match player. Clients flash the
target red, or shake the screen if they are the target.

| Field        | Type | Notes |
|--------------|------|-------|
| `id`         | int  | Player hit |
| `attackerId` | int \| null | Player who hit them; `null` for fall damage |
| `hp`         | int  | Their HP after the hit |

### `death`

A player died. Broadcast to every match player, for the kill feed. Their
`state` snapshots show `dead: true` until they respawn.

| Field      | Type        | Notes |
|------------|-------------|-------|
| `id`       | int         | Player who died |
| `killerId` | int \| null | Who killed them. For `void`, whoever hit them in the last 5 s, else `null` |
| `cause`    | string      | `"player"`, `"void"` or `"fall"` (`DEATH_CAUSE`). Feed text: "X killed Y" (fall with a killer too), "X knocked Y into the void", "Y fell into the void", "Y fell from a high place" |
| `eliminated` | bool      | They were flagless, so this death knocks them out of the match (see below) |

### `flagEvent`

Something happened to a flag. Broadcast to every match player. Clients show
`captured` in the kill feed ("X captured Y's flag"). Only the flag's owner sees
a notice for `taken`, `returned` and `captured`. Everyone sees a puff of
particles at the pedestal on `returned`.

| Field  | Type        | Notes |
|--------|-------------|-------|
| `flag` | int         | Flag id (= owner's player id) |
| `kind` | string      | `"taken"`, `"dropped"`, `"returned"` or `"captured"` (`FLAG_EVENT`) |
| `by`   | int \| null | Who did it: the taker, the carrier who dropped it, the capturer, or the owner who returned it by touch. `null` for timed and void returns |

### `matchEnd`

Only one non-eliminated player is left. Broadcast to every match player; the
match keeps running behind the end screen until the server restarts.

| Field      | Type | Notes |
|------------|------|-------|
| `winnerId` | int  | Last player standing |

## Capture the flag

The server runs these rules; the messages above carry the results.

- **Keeps.** World gen builds one keep per player (`world.keeps`). The i-th
  lobby member gets keep i. In the Test world they are spaced evenly on a ring
  around the center. In island worlds each keep is on its own middle-ring
  island, off the island's center, in the middle of the ring
  (`islandLayout(size).keepDistance`) and at least `keepSpacing` apart. A keep is a 7×7 floor of keep blocks with a gold
  pedestal in the middle, plus a frame 5 blocks tall: corner pillars and beams
  along the top edges, with open sides. The terrain is flattened for 2 blocks
  around it. Keep and pedestal blocks can't be broken, and no blocks can be
  placed in the keep's volume (the 7×7 area from the floor to the top of the
  frame). Players spawn and respawn in their own keep, next to their flag.
- **Void.** Below y = -20 is death. Island worlds have no floor; islands never
  reach below y = 4. The Test world has a solid bottom, so only its edges lead
  to the void.
- **On a flag.** A player is "on" a flag when their feet are within 0.8 blocks
  of its base horizontally, and between 0.5 below and 1 above it.
- **Taking.** Standing on an enemy flag (home or dropped) for 2 s takes it
  (`grab` shows the progress). Stepping off resets the progress. You can't
  take your own flag, and you can only carry one flag at a time.
- **Carrying.** Carriers move at 60% speed. If the carrier dies or
  disconnects, the flag drops where they were and falls like an item.
- **Returning.** A dropped flag returns home after 120 s, or at once if its
  owner is on it or it falls below y = -20.
- **Capturing.** A carrier captures when they are on their own pedestal
  while their own flag is home, or already captured (flagless players can
  capture too). The captured flag's owner becomes flagless:
  they keep playing where they are, with their inventory, and their keep
  stays standing.
- **Elimination.** Flagless players can still fight, mine, build, and take,
  carry and capture flags. When a flagless player dies (void included),
  they are eliminated and spectate with a free-fly camera. When only one
  player is left who hasn't been eliminated, they win (`matchEnd`).

### `container`

The state of the chest or furnace you have open. It's sent when you open it,
and to everyone who has it open whenever it changes (anyone's click, or
smelting). Breaking a container drops it and everything in it.

Furnace: smelting runs on the server whether or not anyone is watching. One
fuel item burns long enough to smelt 2 items (wood) or 1 (planks). Each item
takes 5 s (iron ore → iron ingot). If the fuel runs out or the input can't
smelt, the half-done item starts over.

| Field       | Type   | Notes |
|-------------|--------|-------|
| `x`,`y`,`z` | int    | The block |
| `kind`      | string | `"chest"` or `"furnace"` |
| `slots`     | (ItemStack \| null)[] | Chest: 27. Furnace: input, fuel, output |
| `burn`      | number | Furnace only: fuel left in the current fuel item, 0..1 |
| `progress`  | number | Furnace only: smelting progress on the current item, 0..1 |

### `containerClose`

The container you had open was broken or you moved out of reach; close the
screen. _(no fields)_
