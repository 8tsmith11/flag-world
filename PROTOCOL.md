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
   their name, team and ready flag with `lobbyUpdate`. The first member is the
   host; if the host leaves, the next oldest member becomes host. When every
   member is ready, the host sends `startMatch`. The server generates the world
   from the seed, occupied team count and world size, sends `generation` percentage
   updates during startup, and sends each member `welcome`. The browser builds
   its copy in a module worker while showing a single “Generating world” progress bar.
2. **Playing.** The match lasts until the server stops. A `hello` whose name
   matches a disconnected match player (ignoring case) takes over that player,
   keeping their position and inventory, and gets `welcome`. Any other
   connection gets `matchInProgress` and can take over a disconnected player
   with `reclaim`.

Each occupied team owns a flag and a keep; see [Capture the flag](#capture-the-flag).

A match player who disconnects stays in the world, standing where they were
and still listed in `state`. They don't pick up items while disconnected.

Names are 1–16 characters after whitespace is collapsed and trimmed, and are
unique within the lobby (ignoring case).

## Shared shapes

**PlayerSnapshot** — a player's state at one server tick.

| Field      | Type    | Notes |
|------------|---------|-------|
| `id`       | int     | Player id |
| `team`     | int     | Team index, 0–3 (`TEAMS` in `shared/protocol.js`) |
| `type`     | string  | Entity type, `"player"` |
| `x`,`y`,`z`| number  | Position |
| `vx`,`vy`,`vz` | number | Velocity (blocks/s); needed for client reconciliation |
| `kx`,`kz`  | number  | Knockback velocity (blocks/s), added to movement and decaying each tick; also needed for reconciliation |
| `yaw`,`pitch` | number | Look direction |
| `onGround` | bool    | Standing on a solid block |
| `crouching` | bool   | Crouched (drawn shorter and leaning forward); the client copies it into its physics state |
| `hp`       | number  | Health, 0..`maxHp`; armor can cause fractional damage |
| `maxHp`    | number  | 20, plus 5 for a Heart Amulet and the worn accessory's Vital modifier |
| `dead`     | bool    | Dead and waiting to respawn (or eliminated); not drawn, can't be hit, sends no inputs |
| `eliminated` | bool  | Died while flagless; out of the match for good and spectating |
| `carrying` | int \| null | Id of the flag they hold. Carriers walk at 60% speed (the client copies this into its physics state) |
| `grab`     | number  | 0..1 progress toward taking the enemy flag they're standing on; 0 when not |
| `held`     | int \| null | Item id in hand, drawn in their fist |
| `armor`    | int \| null | Worn armor item id |
| `accessory` | int \| null | Worn accessory item id; drives player visual and predicted movement |
| `springCharge` | int | Spring Boots charge in simulation ticks, 0..20 |
| `springBouncing` | bool | Whether a Spring Boots landing can continue bouncing |
| `gliding`  | bool | Glider open; also part of predicted movement state |
| `glideBlockedTicks` | int | Ticks left before a Void Eel bite permits gliding again; part of predicted movement state |
| `flying` | bool | Creative flight active; part of predicted movement state |
| `draw`     | number  | How far they've drawn a bow, 0..1 (0 when not drawing); drawn as the arm raising the bow and the string pulling back. With a crossbow in hand: how far it's loaded, 1 while loaded (the bolt shows on it) |
| `slowTicks` | int    | Ticks of Ice Sword frost slow left (40 on a hit); movement is 40% slower while above 0 and frost flakes are drawn around them. Part of predicted movement state |
| `grapple`  | object \| null | While a grappling hook pulls: `{ hx, hy, hz }` where the hook caught and `{ x, y, z }` where their feet are headed; drawn as a rope to the hook. Part of predicted movement state |
| `hookCooldown` | int | Ticks until their grappling hook can fire again (60 after each shot). Part of predicted movement state |
| `moveScale` | number | Walking speed multiplier from the worn armor's Light and accessory's Fleet modifiers (1 without). Part of predicted movement state |
| `lastSeq`  | int     | Last input `seq` the server has simulated for this player |

**BlockPos** — `{ x, y, z }`, integer block coordinates inside the world.

**BlockChange** — `{ x, y, z, id, team? }`, a block that now holds block id `id`. `team` records ownership when a reinforced door changes.

Block ids are in `shared/blocks.js`. Ladders and doors carry their state in the
id, so opening a door or placing a ladder is just a `blockChange`. Facing is 0
north (-Z), 1 east (+X), 2 south (+Z), 3 west (-X).

| Ids   | Block | Encoding |
|-------|-------|----------|
| 10–13 | ladder | `10 + facing`: the side of its cell it hangs on (toward the block holding it). Not solid |
| 14–29 | door | `14 + facing + 4·open + 8·upper`: facing is the way the placer looked. Solid only when closed |
| 52 | rope | Hung by a Rope Bundle. Not solid, climbable like a ladder, breaks in one tick and drops nothing |
| 57 | scorched earth | The ground inside a dragon roost's nest; drops dirt |
| 58 | Quarry Stone | Glowing cracked stone; hardness 8, regrows stone on each open face |
| 62–77 | reinforced door | `62 + facing + 4·open + 8·upper`; hardness 4, iron texture, opens only for its placer's team |
| 78 | arrow turret | Solid base; the cell above is reserved for its rotating head |

Ids 59 and 61 are reserved after removal of Snow and fences.

Other blocks added with crafting: 30 iron ore (hardness 3), 31 sand, 32
workbench (right click: crafting screen).

Furnaces and chests have their own inventory (see `openContainer`) and a
front that faces the player who placed them. They have one id per facing
(`FACED` in `shared/blocks.js`); the first id is the item and the drop.

| Ids | Block | Facing north, east, south, west |
|-----|-------|------|
| 33, 38, 39, 40 | furnace (hardness 2) | 33, 38, 39, 40 |
| 34–37 | chest (hardness 1) | 34, 35, 36, 37 |
| 53–56 | anvil (hardness 2) | 53, 54, 55, 56. The horn is at the east end when it faces north |

**ItemStack** — `{ item, count, mods? }`. `mods`, only on weapons, tools,
armor and accessories, is at most one modifier `[{ id, value }]` (see
**Modifiers** below); a stack with `mods` is one item instance and never
merges with another. Item ids (`shared/items.js`,
`shared/itemIds.js`): 0–255 are the blocks (placed as that block); 256 and up
are other items: `256` wood hammer, `257` ladder, `258` door, `259` iron ingot,
`260` stone hammer, `261` iron hammer, `262`–`264` wood / stone / iron sword,
`265` bow, `266` leather, `267` raw beef, `268` empty bucket, `269` water
bucket, `270` cooked beef, `271` leather armor, `272` iron armor, `273`
glider, `274` sapling (the item; it places block `48`, the planted sapling).
`275` is loot-only golden beef (stack size 4). Block ids `49`–`51` are stone
bricks, mossy stone bricks, and cracked stone bricks. All three require an
iron hammer to break. One stone crafts into one stone brick. `276`–`280`
are loot-only Wind Boots, Spring Boots, Heart Amulet, Mending Charm and Ember
Heart; `281` is a loot-only Rift Orb (stack size 4). `282`–`286` are
loot-only Wind Axe, Ice Sword, crossbow, Rope Bundle (stack size 8) and
grappling hook. `287` Dragon Scale (dropped by dragons), `288` Silk (dropped by
Crawlers, no use yet) and `289` Dragonscale Armor. Block `53` (anvil) is also
its item.
`290` is reserved after removal of the Flight Orb. `291`–`294` are Cow,
Dragon, Crawler and Void Eel spawn eggs; `295`–`299` and `301`–`304` are unused.
Active egg definitions live in `shared/mobEggs.js`. All egg types are
creative-only to obtain, but anyone holding one can use it. Grass and dirt
both drop dirt. Block ids `59`–`61` and `79`–`82` are unused.
Buckets, armor, accessories, gliders, hammers, swords, bows, crossbows, Wind
Axes and grappling hooks have stack size 1;
ordinary items stack to 64. What held tools do is in `shared/tools.js`.

**InventoryState** — `{ slots, cursor, armor, accessory }`: `slots` is 36 × (ItemStack \| null).
Slots 0–8 are the hotbar and 9–35 the main grid. `cursor` is the ItemStack
held on the mouse in the inventory screen, or `null`. `armor` is one worn
armor stack or `null`. `accessory` is one worn accessory stack or `null`.

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

**ArrowSnapshot** — an arrow's (or crossbow bolt's) state at one server tick. Sent in `entitySpawn`
(as its info), then in `state` on every tick it flies and once as it sticks.
Clients interpolate it and point the model along the velocity.

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | int    | Entity id |
| `type`     | string | `"arrow"` |
| `x`,`y`,`z`| number | Position |
| `vx`,`vy`,`vz` | number | Velocity (blocks/s) |

**CowSnapshot** — a cow at one server tick. Sent in `entitySpawn` / `welcome`,
then as changed snapshots at the viewer's distance cadence (`u`).

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | int    | Entity id |
| `type`     | string | `"cow"` |
| `x`,`y`,`z`| number | Feet position |
| `yaw`      | number | Facing (0 looks toward -Z, like players) |

**CrawlerSnapshot** — a Crawler. Sent in `entitySpawn` / `welcome`, then in
`state` as changed snapshots at the viewer's distance cadence (`u`).

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Entity id |
| `type` | string | `"crawler"` |
| `name` | string | `"Crawler"`, used in the event feed |
| `x`,`y`,`z` | number | Feet position (box 0.9 wide, 0.6 tall) |
| `yaw` | number | Facing (0 looks toward -Z) |
| `climbing` | bool | Climbing a wall (drawn tipped up it) |

**VoidEelSnapshot** — a Void Eel's head. Sent in `welcome` and as changed
`state` snapshots at distance cadence. Clients draw its body trailing along the path the head swam.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Entity id |
| `type` | string | `"voidEel"` |
| `name` | string | `"Void Eel"` |
| `x`,`y`,`z` | number | Bottom of the head's box (1.2 wide, 0.8 tall) |
| `yaw`,`pitch` | number | Heading and climb angle |
| `coiling`,`lunging` | bool | One-second bite warning and fast strike animation |
| `night` | bool | Faint night glow |
| `tail` | `{x,y,z}` | Tail-tip weak point; melee and projectiles deal double damage there |

**NpcSnapshot** — a Wise, Ancient or working monkey (kinds in `shared/npcs.js`).
Sent in `welcome` (they exist from match start), then as changed `state`
snapshots at distance cadence.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Entity id |
| `type` | string | `"npc"` |
| `npc` | string | `"wiseMonkey"`, `"workMonkey"`, `"ancientWaterMonkey"` or `"ancientLightningMonkey"` |
| `name` | string | `"Wise Blue Monkey"`, `"Ancient Water Monkey"`, ... |
| `team` | int \| null | A Wise or tamed working monkey's team (`TEAMS` index; its fur color), else `null` |
| `x`,`y`,`z` | number | Feet (seat) position; box from `NPC_DEFS[npc].box` |
| `yaw` | number | Body facing (0 looks toward -Z) |
| `pose` | string | `"sit"`, `"stand"` (chest beat), `"walk"` or `"look"` (looking around) |
| `look` | number | Head turn toward the nearest player, relative to `yaw` (radians) |

**RiftOrbSnapshot** — a thrown Rift Orb in flight. Sent in `entitySpawn` and
each `state` tick until it lands or falls into the void.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Entity id |
| `type` | string | `"riftOrb"` |
| `item` | int | `ITEM.RIFT_ORB` |
| `x`,`y`,`z` | number | Orb position |
| `vx`,`vy`,`vz` | number | Velocity |

**DragonSnapshot** — a flying or walking dragon. Sent in `welcome` at match
start or on reclaim, and in every `state` tick so its movement and fire animate
promptly for every player.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Entity id |
| `type` | string | `"dragon"` |
| `name` | string | `"Dragon"`, used in the event feed |
| `x`,`y`,`z` | number | Base position |
| `yaw`,`pitch` | number | Facing and climb angle |
| `hp` | number | Health, 0..30 |
| `breathing` | bool | Fire cone is active |
| `walking` | bool | On the ground with folded wings and walking legs |
| `aimYaw`,`aimPitch` | number | Fire aim angles toward the target's collision-box center, relative to body yaw and world horizontal |

**PlayerInfo** — PlayerSnapshot plus:

| Field   | Type   | Notes |
|---------|--------|-------|
| `name`  | string | Player name |
| `color` | int    | Player color |
| `team`  | int    | Team index |

**LobbyMember** — `{ id, name, color, team, ready }`.

**FlagState** — a flag at one server tick. Its id is the first member's player id on that team.

| Field       | Type        | Notes |
|-------------|-------------|-------|
| `id`        | int         | Team flag id |
| `state`     | string      | `"home"`, `"carried"`, `"dropped"` or `"captured"` (`FLAG_STATE`) |
| `carrierId` | int \| null | Player carrying it |
| `x`,`y`,`z` | number      | Base of the pole: the pedestal when home, the carrier's feet when carried |

**FlagInfo** — FlagState plus:

| Field   | Type        | Notes |
|---------|-------------|-------|
| `color` | int         | Owner's color |
| `team`  | int         | Owning team index |
| `home`  | `{x, y, z}` | On top of the pedestal in the middle of the team's keep |

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
| `team`  | int    | Team index 0–3. Each team holds at most four players; changing team clears every ready flag. The player color comes from the team |
| `ready` | bool   | Ready flag |
| `worldSize` | string | Host only: `"small"`, `"medium"` or `"large"` (keys of `WORLD_SIZES`); others ignored |

### `startMatch`

Host only, lobby only. Gets `error` if not every member is ready. At least one
occupied team is required.

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
| `armor` | bool? | true: the single armor slot. It accepts only armor; shift-click removes worn armor to inventory |
| `accessory` | bool? | true: the single accessory slot. It accepts only accessories; shift-click removes it to inventory |
| `slot`   | int    | Your inventory: 0..35. Chest: 0..26. Furnace: 0 input (smeltables only), 1 fuel (fuels only), 2 output (take only; a left click can add it to a matching cursor stack). Anvil: 0 (weapons, tools, armor and accessories only) |
| `shift`  | bool?  | Shift-click: move the whole stack across instead, as much as fits. Container slot → your inventory. Inventory slot → the open container (a furnace takes smeltables into the input and fuel into the fuel slot). With no container open, armor equips if the slot is free; otherwise hotbar ↔ main grid. `button` is ignored |
| `button` | string | `"left"`: pick up the whole stack, or put the cursor down (merging into the same item up to its max, or swapping with a different one). `"right"`: pick up half (rounded up), or put one item from the cursor down |

### `inventoryClose`

The inventory, workbench or container screen was closed. The cursor stack
goes back into the slots; whatever doesn't fit drops at your feet. Also stops
`container` updates. _(no fields)_

### `openContainer`

Right click on a chest, furnace or anvil within reach: the server starts sending you
its state (`container`) until you close the screen, walk out of reach, or it's
broken (`containerClose`). Anyone can open any container, and any number of
players can have the same one open.

| Field | Type | Notes |
|-------|------|-------|
| `x`,`y`,`z` | int | The chest or furnace block |

### `anvilReroll`

The Reroll button at an anvil you have open (`openContainer`, in reach). If
its slot holds a weapon, tool, armor or accessory and your slots hold 2 iron
ingots, the server takes the ingots and replaces the item's modifiers with a
fresh roll of one fixed-value modifier, including on items that had
none. The results arrive as `container` and `inventory`. Otherwise ignored.

| Field | Type | Notes |
|-------|------|-------|
| `x`,`y`,`z` | int | The anvil block |

### `craft`

Crafts a recipe from `shared/recipes.js` if your slots hold its inputs and the
output fits (checked on a copy, so a full inventory refuses rather than losing
items). Inputs come out of the main grid before the hotbar.

| Field    | Type   | Notes |
|----------|--------|-------|
| `recipe` | string | Recipe `id` from `shared/recipes.js` |
| `at`     | BlockPos? | A workbench in reach. Required for recipes with `station: "workbench"`; ignored otherwise |

Recipes with `station: null` (planks, ladder, workbench) work anywhere; the
rest only at a workbench. New recipes include an empty bucket (1 iron ingot),
leather armor (3 leather), iron armor (10 iron ingots), a glider
(3 leather and 2 wood), an anvil (6 iron ingots) and Dragonscale Armor (8
Dragon Scales). Crafted items have no modifiers. Furnaces smelt raw beef into cooked beef in 5 s.
While creative mode is enabled, `creative:<itemId>` recipes provide every
canonical block and non-block item for free, without a station or
modifiers. The server rejects those recipe ids for other players.

### `creativeToggle`

No fields. Only a connection from localhost that has joined the lobby or a
match may toggle its own creative mode. Other requests are silently ignored.
The server responds only to that connection with `creative`.

### `creativeAction`

`{action}` from the local creative host during a match. Accepted actions are
`"setDay"` (noon), `"setNight"` (midnight), `"toggleImmortal"`,
`"toggleFlight"`, `"toggleInvisible"` and `"captureLobby"`. Invisibility is a server player
flag consumed by mob and turret targeting.
The server replies with `creative`; time changes also broadcast `dayTime`.
Immortality prevents damage and returns a player who falls into the void to
their keep.

### `talk`

Right click on an NPC. The server answers with `speak`, to this player only,
if the NPC is alive and within 6 blocks of the eyes (`NPC.talkReach`), at most
once per `NPC.talkCooldown`.
For a working monkey this opens a private `monkey` taming or configuration
view instead of ordinary dialogue. Wild monkeys are brown; taming assigns
the winning player's team and changes their fur to that team's color.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | NPC entity id |

### `monkeyAction`

Match players only, `{id, action, session?, value?, config?, revision?}`.
The server validates the live monkey, player, session, distance and team.
Taming starts through `talk` within 6 blocks; an open session or configuration
can continue within 32 blocks. Sessions expire after 60 seconds.

| Action | Fields | Behavior |
|--------|--------|----------|
| `simon` | `session`, `value: "jump" \| "crouch"` | Repeat the displayed sequence after the server's watch timer |
| `card` | `session`, integer `value` 0–11 | Reveal a card; matching all six pairs wins |
| `cup` | `session`, integer `value` 0–2 | Choose the final cup position after the watch timer |
| `retry` | — | Start another random game on a wild monkey |
| `configure` | `config`, `revision` | Owning team only; reject stale settings rather than overwrite a teammate |
| `seed` | — | Owning team only; consume one inventory sapling into its reserve |
| `close` | — | Close this player's view/session |

`config` is `{role, target, from, to, radius, vertical, sites, filter}`.
Roles: `idle`, `collector`, `courier`, `lumberjack`. Targets are BlockPos or
null; `sites` is up to 16 explicit tree-base/planting BlockPos entries (a soil
selection becomes the cell above it). Radius is 1–24 blocks, vertical range
0–3 blocks above/below the delivery target. Filter is
`{mode:"whitelist"|"blacklist", items: ItemId[]}`, up to 128 registered items.
Courier `from` must be a container within range of `to`; `target` becomes `to`.
Every non-idle role needs a target. Settings changes retain carried items.

### `reclaim`

Match-in-progress screen only. Takes over a disconnected match player; gets
`error` if there's no such player or they are connected.

| Field  | Type   | Notes |
|--------|--------|-------|
| `name` | string | Player name, ignoring case |

### `input`

Match players only. Sent once per simulation tick (20 per wall-clock second). Each input advances the player by exactly one fixed tick.

| Field     | Type   | Notes |
|-----------|--------|-------|
| `seq`     | int    | Increments by 1 per input, starting at your `lastSeq` + 1 from `welcome` |
| `forward` | number | -1..1 (W = 1, S = -1) |
| `sprint`  | bool | Run while moving forward (Ctrl held or W tapped twice within 300 ms); ignored in water, on ladders, while crouching, eating or drawing a bow |
| `strafe`  | number | -1..1 (D = 1, A = -1) |
| `jump`    | bool   | Jump held (swim up in water, jump out at the surface) |
| `flyToggle` | bool | Double-tap jump within 300 ms. Toggles flight while creative |
| `crouch`  | bool   | Crouch held (Shift, only while no screen is open) |
| `draw`    | bool   | Right mouse held with a bow or crossbow in hand (the client sends it only then; the server ignores it without one): draws the bow or loads the crossbow |
| `fire`    | bool   | A click (either button) with a loaded crossbow in hand: shoots its bolt this tick. Ignored without a crossbow |
| `hook`    | bool   | Right-click edge with a grappling hook in hand: fires the hook this tick. Ignored without one; the shared physics also refuses it while carrying a flag, while already pulling, or during the cooldown |
| `eat`     | bool   | Right mouse held with food in hand; raw/cooked beef takes 30 uninterrupted ticks and heals gradually, while golden beef heals to full immediately on press |
| `glide`   | bool   | Right mouse held with a glider in hand; in the air it caps falling speed and drives forward motion |
| `rift`    | bool   | Right-click edge with a Rift Orb selected; the server consumes one and throws it in an arc. A portal opens where it lands, or the orb drops if it lands in a keep zone |
| `spawnEgg` | BlockPos \| null | Right-clicked solid block while holding a spawn egg. The server spawns that mob on top if there is room, consumes one egg, and uses that position as its home (nearest island for Void Eels) |
| `yaw`     | number | Look yaw |
| `pitch`   | number | Look pitch, clamped to ±π/2 |
| `slot`    | int    | Selected hotbar slot, 0..8: the item in hand (tool strength, placing, dropping, `held`) |
| `breaking`| BlockPos \| null | Block the player is holding the break button on this tick, or `null` |
| `place`   | `{ x, y, z, nx, ny, nz }` \| null | Place the selected item in cell x, y, z this tick (right click), or `null`. `n` is the normal of the face that was clicked (one axis ±1), pointing into this cell |
| `use`     | BlockPos \| null | Right click on a door to toggle it, or on a water source with an empty bucket to collect it (instead of `place`) |
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
(usually itself; manually broken leaves drop nothing) pops out as an item entity
(`entitySpawn`). Other players get a `swing` every 5 ticks while mining.

`place` is the cell against the targeted face. The server places the item in
`slot` only if the cell is air or water (the water is replaced), is within reach,
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
- **Sapling:** right click the top of grass or dirt to plant it. It grows a
  tree after 3–5 minutes (`SAPLING_GROW_TIME`) if the trunk has room; blocked
  saplings retry.
- **Rope Bundle:** any clicked face, or an existing rope column to extend it
  downward from its bottom end. Rope fills each cell straight below the
  starting point, up to 40 in all, stopping above the first cell that
  isn't air or water (a solid block, for example) or is in a keep's no-build
  zone. One bundle is used however long the column is.

It then removes one from the stack and sends others a `swing`. `drop` throws
one item from `slot` along the look direction. Both are applied after that
tick's movement.

`use` opens or closes the door there (both halves) for anyone in reach. An
empty bucket uses a source there to remove it and becomes a water bucket;
flowing water cannot be collected. Placing a water bucket creates a source
in the targeted cell and returns an empty bucket. Buckets have stack size 1. A
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

Dragons (`centralDragons`, `teamDragons` and `roosts` in `WORLD_SIZES`): 2,
3 or 5 spread around the central island (Small, Medium, Large), one on each
team island in Medium and Large (at least 25 blocks from the keep and team
spawn, preferably on the far side), and one at each dragon roost. Every dragon
is leashed to its home island: it roams within the island's radius plus 20
blocks (central, roost) or 15 (team), and only goes after players inside that
radius. It returns home after losing a target. All dragons spawn above open
grass away from keeps. They wander around their spawn when no live, connected
player is in range, occasionally landing and walking on grass. For a player
within 45 blocks (and inside the leash), they take off, fly toward the
nearest, and breathe fire through a 14-block cone aimed at that player's
center when they have clear sight. The fire effect is sent to every player in
the dragon's state. The server applies 2.5 damage per fire pulse before armor
reduction; Dragonscale Armor is immune. Punches and arrows can hurt them (30
HP), and provoke them (see **Provocation**). A dead dragon drops 2–5 iron
ingots, 2–4 leather and 2–4 Dragon Scales. Dragons do not respawn.

Crawlers: spider-like mobs, 3–5 in every cave dungeon and underside ruin, and
up to 2 per main island (each 40%) on cave floors at least 10 blocks under the
surface, all chosen by world gen (`world.mobSpawns`). 12 HP, a 0.9 × 0.6 box,
4.8 blocks/s. They use the player physics and climb any wall they walk into.
Idle, they wander within 5 blocks of their spawn, minding ledges. They go after
the nearest player they can see within 12 blocks, give up beyond 24, and bite
for 3 (every 1 s, before armor) when within 0.6 blocks of the player's box. A
dead Crawler drops 0–2 Silk.

Void Eels: `eels` in `WORLD_SIZES` (4, 7, 10) roam a void band whose top
stays deep under the central island and rises to about 20 blocks below the
nearest outer island underside elsewhere. Half start under the central
island. An eel detects a player
in a 24-block-radius column extending 180 blocks above it (30% farther at
night) when no natural island terrain separates them. Player-built blocks do
not block detection. It rises toward exposed players, chases up to about 30
blocks away, and returns to the deep band after losing a target for 10 s or
when the target dies or moves over natural island terrain. It retraces its
approach and skirts island edges when returning. 30 HP; a bite does 4 with
a 1.2 s cooldown. It coils and glows for 1 s with a hiss, then lunges. A bite
stops gliding for 1.5 s. Its faintly glowing tail tip takes double damage.
At night it glows faintly and rises 30% faster. A dead eel drops 1–2 Rift Orbs.

Provocation: any damage from a player to a Crawler, Void Eel or dragon (a
punch, arrow, crossbow bolt or Thorns, at any range) provokes it. It hunts that
player, ignoring its aggro range, leash and home zone, until the player dies,
disconnects or is eliminated, or it has had no line of sight to them for 10 s.
Then it goes home. Eels use the natural-terrain mask and a 10 s memory in
place of line of sight. Mob bites and dragon fire are `damage` with the mob as
`attackerId`; a death from them has cause `"mob"`.

Ladders and rope: while a player overlaps a ladder or rope there's no
gravity. Holding W or jump climbs up, S climbs down (without walking off the
ladder), and no input holds position. On rope (with no ladder), W doesn't
walk you off either; strafe to step off, or climb past the top. This is in
the shared physics, so it's predicted like the rest of movement.

Crossbows: while `draw` is held with a crossbow, it loads; after 1.2 s it is
loaded and stays loaded (letting go sooner loses the progress, and so does
putting it away). Loading slows walking like drawing a bow. A `fire` with it
loaded shoots a bolt from the eyes along the look direction at 80 blocks/s
with gravity 5 (a bow arrow's is 12) for 6 damage; otherwise bolts are
arrows. After a right click fires it, right click must be let go before it
loads again. Bolts are unlimited.

Grappling hooks: a `hook` casts a ray from the eyes along the look direction
up to 30 blocks, against solid blocks, and starts a 3 s cooldown whether it
hits or not. On a hit, the player is pulled in a straight line at 20
blocks/s toward the hook: onto a top face, or to bring the middle of their
body to a side or bottom face. Gravity, walking and knockback don't apply
during the pull. After arrival the player stays attached at the hook point,
without gravity or sliding, even after switching items; jump releases them.
It also releases if the player starts carrying a flag.
A hook can't be fired while carrying a flag. The pull is part of the shared
physics (`grapple` in the snapshot), so it's predicted.

`attack` is confirmed by the server: it casts a ray from the attacker's eyes
along this input's `yaw`/`pitch`, up to `REACH_DISTANCE` or the first block in
the way. Every punch (hit or miss) sends others a `swing`. Player boxes are
grown by `HIT_TOLERANCE`, since the attacker saw the target slightly in the
past. The nearest live, connected player hit takes damage and knockback: away
from the attacker plus a small hop. Damage and cooldown come from the item in
`slot`: fists 2 every 0.4 s; wood / stone / iron sword 3 / 4 / 6 every 0.6 s
(on the server's clock). The loot-only Wind Axe does 3 every 0.8 s with 3×
the knockback and a bigger upward lift, and can't break blocks at all. The
loot-only Ice Sword does 5 every 0.6 s and slows what it hits by 40% for 2 s
(`slowTicks`). Missed punches count too. A
punch also takes priority over `breaking` in the client: while a player is
under the crosshair it sends no `breaking`.

Health: 20 HP. After 12 s without damage, the player regains 1 HP every 3 s.
At 0 HP the player dies and drops their whole inventory (and cursor stack) as item entities.
Falling below `world.voidY` (20 blocks below the lowest island) kills and destroys the
inventory.

Fall damage: the server tracks the highest point since the player last stood
on something, held a ladder or was in water. On landing, a fall of more than
3 blocks costs 1 HP per whole block beyond 3, less the worn accessory's
Cushioned cut (rounded down; a `damage` with `attackerId` null). Landing on or grabbing a ladder resets the fall. Void and fall deaths
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

### `generation`

Sent to lobby members as the host's world is generated, before `welcome`.
Generation failure sends `error` and returns members to the lobby.

| Field | Type | Notes |
|-------|------|-------|
| `percent` | number | Monotonically increasing progress from 0 to 100; no stage names or generation details |

### `captureLobby`

Sent only to the authorized local creative host after `creativeAction` with
`{action: "captureLobby"}`. No fields. The client renders the current world view
and downloads `lobby.png`; replace `public/img/lobby.png` with that file to use it.

### `welcome`

You are in the match: sent to every member when the host starts it, and on a
reclaim.

| Field     | Type          | Notes |
|-----------|---------------|-------|
| `id`      | int           | Your player id |
| `color`   | int           | Your color |
| `seed`    | int           | World seed; build the world with `generateWorld(seed, teamCount, worldSize)` |
| `playerCount` | int       | Players when the match started |
| `teamCount` | int         | Occupied teams when the match started; determines the number of keeps |
| `worldSize` | string      | `WORLD_SIZES` key: `"small"`, `"medium"` or `"large"`; deterministic central, team, and tiny islands |
| `tick`    | int           | Current server tick |
| `dayTime` | number        | Time of day at `tick`, 0..1 (see **Day and night**). Clients advance it with the ticks in `state` |
| `creative` | bool | Whether this connection's player has creative mode active |
| `immortal`,`flying`,`invisible` | bool | Creative control state |
| `blocks`  | BlockChange[] | Every edit since generation; apply after world generation |
| `doorTeams` | `{key,team}[]` | Reinforced door ownership by lower-half block coordinate key |
| `turrets` | `{x,y,z,id,team,yaw,pitch}[]` | Current turret bases and head angles |
| `litFurnaces` | `{x,y,z}[]` | Furnaces currently burning; restore fire and smoke when joining |
| `portals` | `{id,x,y,z,expiresTick}[]` | Active Rift Orb portals; `expiresTick` is a server tick |
| `players` | PlayerInfo[]  | All match players, including you and disconnected ones. Your own entry's `lastSeq` is where your input `seq` continues from |
| `flags`   | FlagInfo[]    | One flag per occupied team |
| `winnerId`| int \| null   | Set if the match is already over |
| `winnerTeam` | int \| null | Winning team index, if over |
| `winnerMembers` | string[] | Names on the winning team, if over |
| `entities`| (ItemInfo \| ArrowSnapshot \| RiftOrbSnapshot \| CowSnapshot \| DragonSnapshot \| CrawlerSnapshot \| VoidEelSnapshot)[] | Dropped items, projectiles and mobs currently in the world |
| `inventory` | InventoryState | Your inventory |

### `state`

Sent to each connected player once per simulation tick (20/s). Changed mob
snapshots are sent every 1, 3 or 6 ticks for distances below 64, below 160,
or at least 160 blocks. Final stopped positions are retained until sent.

| Field      | Type             | Notes |
|------------|------------------|-------|
| `tick`     | int              | Server tick number |
| `entities` | (PlayerSnapshot \| ItemSnapshot \| ArrowSnapshot \| RiftOrbSnapshot \| CowSnapshot \| DragonSnapshot \| CrawlerSnapshot \| VoidEelSnapshot)[] | All players; moved items/projectiles; changed mob snapshots at each viewer’s distance cadence. Final stopped positions are retained until sent. `u` is that mob’s interval in ticks (1/3/6). An omitted entity retains its last state |
| `flags`    | FlagState[] | Every flag |
| `turrets` | `{x,y,z,id,team,yaw,pitch}[]` | Current turret bases and head angles |

### `portalSpawn`, `portalDespawn`, `emberBurst`

`portalSpawn` broadcasts `{portal: {id,x,y,z,expiresTick}}` when a Rift Orb
creates a portal. `portalDespawn` broadcasts `{id}` when it expires.
`emberBurst` broadcasts `{id,x,y,z}` when a player's Ember Heart breaks;
clients render a burst of ember particles at that player.

### `blockChange`

A block changed (e.g. it was broken). Broadcast to everyone, including the
player who caused it.

| Field     | Type | Notes |
|-----------|------|-------|
| `x`,`y`,`z` | int | Block position |
| `id`      | int  | New block id |
| `team`    | int \| null | Reinforced door owner, or null when ownership is removed; omitted for other blocks |

### `blockChanges`

The server batches block changes from a simulation tick before `state`:
`{ type: "blockChanges", changes: [{x,y,z,id,team?}, ...] }`. Each entry has
the same fields and meaning as `blockChange`. Repeated changes to a block in
the same batch are coalesced to its final state. Clients still accept the
single-change form.

### `creative`

Sent only to the localhost player after an accepted `creativeToggle` or
`creativeAction`: `{enabled, immortal, flying, invisible}`. The flags update
the private Creative Mode label, controls and crafting catalogue. Turning
creative mode off disables flight, immortality and invisibility, and keeps acquired items.

### `dayTime`

Broadcast after a creative `setDay` or `setNight` action as `{dayTime, tick}`.
Clients restart their visual day clock from this pair.

### `quarryPuff`

`{x,y,z}` marks a stone block regrown by a Quarry Stone. Clients draw a short
stone particle puff. The block itself arrives through `blockChange`. Each
Quarry Stone face retries independently every 5 s; occupied player and mob
cells are skipped, while dropped items are moved to nearby air.

### `entitySpawn`

A non-player entity appeared: a block drop, a thrown item, an arrow, or a mob.

| Field    | Type     |
|----------|----------|
| `entity` | ItemInfo \| ArrowSnapshot \| CowSnapshot \| DragonSnapshot \| CrawlerSnapshot \| VoidEelSnapshot \| NpcSnapshot |

### `entityDespawn`

A non-player entity was removed: an item was picked up (all of it) or reached
its 5 minute lifetime; an arrow hit something, had its block broken, stayed
stuck for 10 s, or fell below `world.voidY`; or a cow, dragon or Wise Monkey died. Cows also
despawn if they fall into the void.

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

Another player swung their arm (punch, mining, or placing a block). Not sent to
the player who swung; their own first-person arm animates locally.

| Field | Type | Notes |
|-------|------|-------|
| `id`  | int  | Player who swung |

### `speak`

An NPC's answer to your `talk`, sent only to you. Clients show a subtitle
at the bottom center (`name:` on one line, `text` below), fading after a time
based on its length (`DIALOGUE`), and voice it by `VOICES[voice]`
(`shared/dialogue.js`): `"speech"` voices are spoken with the browser's speech
synthesis (master x voice volume); `"sound"` voices play `sound` at the NPC.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | Speaking NPC (for positional sound and its jaw) |
| `name` | string | Speaker name shown in the subtitle |
| `voice` | string | `"wiseMonkey"` or `"ancientMonkey"` |
| `text` | string | The line, or a description such as `*a low grunt*` |
| `sound` | string? | Sound-only voices: `"grunt"`, `"huff"` or `"rumble"` (`MONKEY_SOUNDS`) |

### `monkey`

Private reply/view for a working monkey. Common fields: `{id,name,team}`;
`name` is chosen at spawn and never changes, `team:null` means wild.
`{closed:true}` dismisses the view. Other messages carry `mode`:

| Mode | Additional fields |
|------|-------------------|
| `tame` | `session`, `game:"simon"|"memory"|"cups"`, `waitMs`, `stepMs`, `progress`; Simon includes `sequence`; memory includes `cards` (hidden entries null), `matched` indices and `hideMs`; cups include initial `ball` and ordered `swaps` of positions |
| `configure` | `editable`, `config`, `revision`, `seeds`, `cargo:Stack|null`, `status`, optional `message` |
| `result` | `won:false`, `message` (retry allowed) |

The final cup answer and unrevealed card faces remain server-only. Winning
assigns team ownership and opens configuration for all viewers; other teams
receive a read-only view. `state` NPC snapshots additionally carry `role`
and `tamed` for working monkeys; `team` changes after taming.

Collectors ignore drops on their own target. Couriers extract furnace output
only and fill destination fuel before input. Lumberjacks require a reserved
sapling, supplied by a teammate or taken from their delivery target, and only
cut wood/branches in explicitly marked columns with a grown leaf crown.
That whole column is authorized above its marked base, up to 64 blocks tall;
horizontal branches outside the column are left to ordinary decay. No new
grown-tree registry is introduced. Fallen saplings within 2.5 blocks of a
marked spot are gathered within the work range, reserving one if needed and
delivering extras that pass the filter; the delivery pile is excluded.
Each harvested tree supplies one sapling
for the same-site replanting cycle; extra leaf drops use normal decay rules.

### `damage`

A player, cow, dragon, Crawler, Void Eel or Wise Monkey took damage (a punch, an arrow, a bite, fire, Thorns or a fall). Broadcast to every
match player. Clients flash the
target red, or shake the screen if they are the target.

| Field        | Type | Notes |
|--------------|------|-------|
| `id`         | int  | Entity hit |
| `attackerId` | int \| null | Player or mob who hit them; `null` for fall damage |
| `hp`         | number | Their HP after the hit |

### `death`

A player died. Broadcast to every match player, for the kill feed. Their
`state` snapshots show `dead: true` until they respawn.

| Field      | Type        | Notes |
|------------|-------------|-------|
| `id`       | int         | Player who died |
| `killerId` | int \| null | Player or mob who killed them. For `void`, whoever hit them in the last 5 s, else `null` |
| `cause`    | string      | `"player"`, `"mob"` (dragon fire, a Crawler or Void Eel bite), `"void"` or `"fall"` (`DEATH_CAUSE`). Feed text: "X killed Y" (fall with a killer too), "X knocked Y into the void", "Y fell into the void", "Y fell from a high place" |
| `eliminated` | bool      | They were flagless, so this death knocks them out of the match (see below) |

### `flagEvent`

Something happened to a flag. Broadcast to every match player. Clients show
`captured` in the kill feed. Every member of the owning team sees
a notice for `taken`, `returned` and `captured`. Everyone sees a puff of
particles at the pedestal on `returned`.

| Field  | Type        | Notes |
|--------|-------------|-------|
| `flag` | int         | Team flag id |
| `kind` | string      | `"taken"`, `"dropped"`, `"returned"` or `"captured"` (`FLAG_EVENT`) |
| `by`   | int \| null | Who did it: the taker, the carrier who dropped it, the capturer, or the teammate who returned it by touch. `null` for timed and void returns |

### `matchEnd`

Only one team with a flag is left. Broadcast to every match player; the
match keeps running behind the end screen until the server restarts.

| Field      | Type | Notes |
|------------|------|-------|
| `winnerId` | int  | Winning team's flag id |
| `winnerTeam` | int | Winning team index |
| `members` | string[] | Names of the winning team's players |

## Capture the flag

The server runs these rules; the messages above carry the results.

- **Keeps.** World gen builds one team island and keep per occupied team
  (`world.keeps`). Team islands have evenly spaced angles with a seeded overall
  rotation and up to 15° jitter. Each keep is placed randomly within the inner
  70% of its team's island radius. A keep is a 7×7 floor of keep blocks with a gold
  pedestal in the middle, plus a frame 5 blocks tall: corner pillars and beams
  along the top edges, with open sides. The terrain is flattened for 2 blocks
  around it. Keep and pedestal blocks can't be broken, and no blocks can be
  placed in the keep's volume (the 7×7 area from the floor to the top of the
  frame). Teammates spawn and respawn in their shared keep, next to their flag.
- **Void.** Below `world.voidY` (the lowest island bottom minus 20) is death.
  The islands have no floor underneath them.
- **On a flag.** A player is "on" a flag when their feet are within 0.8 blocks
  of its base horizontally, and between 0.5 below and 1 above it.
- **Taking.** Standing on an enemy flag (home or dropped) for 2 s takes it
  (`grab` shows the progress). Stepping off resets the progress. You can't
  take your own team's flag, and you can only carry one flag at a time.
- **Carrying.** Carriers move at 60% speed. If the carrier dies or
  disconnects, the flag drops where they were and falls like an item.
- **Returning.** A dropped flag returns home after 120 s, or at once if its
  a member of its team is on it or it falls below `world.voidY`.
- **Capturing.** A carrier captures when they are on their own pedestal
  while their own flag is home, or already captured (flagless players can
  capture too). The captured flag's whole team becomes flagless:
  they keep playing where they are, with their inventories, and their keep
  stays standing.
- **Elimination.** Flagless players can still fight, mine, build, and take,
  carry and capture flags. When a flagless player dies (void included),
  they are eliminated and spectate with a free-fly camera. Capturing a flag
  does not end the match while any member of that team survives. When only
  one team has players who are not eliminated, that team wins (`matchEnd`).
  Teammates cannot damage each
  other with punches or arrows. Armor reduces combat and arrow damage by
  `damage * 10 / (10 + armorPoints)` (leather 3, iron 8, dragonscale 9, plus
  Sturdy); fall and void damage ignore armor.

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
| `kind`      | string | `"chest"`, `"furnace"` or `"anvil"` |
| `slots`     | (ItemStack \| null)[] | Chest: 27. Furnace: input, fuel, output. Anvil: the one item slot (its `mods` are the preview) |
| `burn`      | number | Furnace only: fuel left in the current fuel item, 0..1 |
| `progress`  | number | Furnace only: smelting progress on the current item, 0..1 |

### `containerClose`

The container you had open was broken or you moved out of reach; close the
screen. _(no fields)_

### `furnaceLit`

Broadcast to every match player when a furnace starts or stops burning. Clients
show fire in its mouth and smoke from its top vent while `lit` is true. The
server also sends `lit: false` when a burning furnace is broken.

| Field | Type | Notes |
|-------|------|-------|
| `x`,`y`,`z` | int | Furnace block position |
| `lit` | bool | Whether fuel is burning |

Water uses id 4 for a source and ids 41–47 for flowing levels 1–7.
Sources never form from neighbouring water. Flowing water can replace air,
falls without losing level, spreads sideways with decreasing level, and
recedes when its source is removed. The server sends each change as a
`blockChange`; clients remesh the affected chunks. Flowing surfaces slope
between neighboring levels, vertical falls fill their cells, and currents
move players and dropped items. Entering water cancels accumulated fall damage.
Mining, placement, and attack rays pass through water; buckets target water.

Food is eaten by holding `eat` for 1.5 s with raw or cooked beef selected;
releasing it cancels progress. Eating slows movement and consumes one item.
Raw beef restores 3 HP and cooked beef restores 8 HP over roughly 3 s.
Golden beef is loot-only, restores full HP immediately on right-click, and
consumes one item. Holding the button does not consume another golden beef.
This healing is separate from natural regeneration, which starts 12 s after
the last damage and restores 1 HP every 3 s. Furnaces cook raw beef in 5 s.

Holding `glide` with a glider selected while airborne caps falling speed at
2 blocks/s and moves forward at 8 blocks/s along yaw. Releasing the button
stops gliding on the next input tick. A gliding landing takes no fall damage.
The `gliding` snapshot field drives first and third person canopy rendering.

Wind Boots multiply move speed by 1.25, including sprinting and flag-carrier
slowdown. With Spring Boots, a tap released before about 0.2 s gives a normal
jump. Hold jump on the ground for up to 1 s and release for a charged jump
up to about eight blocks high. Falls over three blocks
bounce at half impact speed, repeatedly until the bounce would be under one
block; crouching on landing cancels the bounce. Spring movement is predicted
with the shared physics and checked by the server. Heart Amulet raises maximum
HP to 25. Mending Charm begins regeneration after five seconds without damage
and heals one HP every two seconds. Ember Heart breaks on the first otherwise
fatal non-void hit, leaving 10 HP and one second of invulnerability; the
server broadcasts `emberBurst`. All worn accessories drop on death.

Throwing a Rift Orb opens a glowing oval portal at the impact surface for 10 seconds.
Any player entering it, except a flag carrier, teleports to safe ground outside
the portal owner's team keep. An orb landing in a keep's no-build zone
fizzles and drops as an item. An orb lost in the void is gone.
The portal never opens on top of the thrower. The server owns projectile
collision, portal collision, expiry, and destination.

The only world sizes are Small, Medium and Large. `WORLD_SIZES` in
`shared/worldgen.js` holds the layout values for each size. The seed,
occupied team count and world size determine one central island, one raised
island per occupied team, and tiny islands distributed in rings, farther out,
and above or below larger islands. Island planning finishes before terrain
is written. The central island keeps its root-like taper but extends about
45 blocks deeper than before. The void kill height is set well below the
lowest generated island, leaving an eel band at least 40 blocks high.

Natural terrain's top and bottom Y ranges are stored in a compact per-column
mask during generation. Later block placement and breaking do not alter it.
Eels use this mask to distinguish exposed bridges from protected island ground.

## Biomes and rivers

Low-frequency noise selects plains and forest on team islands, and plains,
forest and mountains on the central island. Height and tree density
blend across a broad transition band, while scattered surface patches avoid
hard color boundaries. Tiny islands inherit the nearest main island's biome;
faraway ones are plains or forest. Plains have broad flat open areas, gentle
rolls, sparse trees and more cows. Forests have gentle terrain with large flat
areas and closely spaced trees of varied size. Grass has one color everywhere.
Mountains have tall peaks, exposed stone on steep faces and grass/dirt on
gentle slopes; they have no snow or generated springs.
Houses occur in forest or plains; mountain sites favor towers. Loose chests
and underside ruins keep their normal placement rules.

The central island has 1 / 2 / 3 downhill rivers on Small / Medium / Large.
They start on high ground, prefer mountains, and carve channels 3–5 blocks
wide. Banks keep water in its channel until it reaches an edge. Generated
rivers avoid keeps and all structures and clear natural terrain from their
channels up to roughly ten blocks above the water without cutting another
island stacked overhead. Trees are generated after rivers, ponds and
structures, and cannot stand over water. Ponds are about 30% less common.

## Island generation

Island planning finishes before terrain
generation; each island has seeded terrain, while the larger islands have
caves, ore, ponds and trees. Team islands have keeps and spawn points.
Team island centers are `centralRadius + gap + teamRadius` blocks from the
world center. Small, Medium and Large use central radii 110, 155 and 210;
team radii 45, 65 and 90; and island spacing 12, 20 and 20 blocks.
World generation also places cave chests, abandoned houses,
stone-brick towers, underside ruins, and cave-connected dungeons.
Tiny islands have no caves or other structures; each holds at most one of a
loose chest or a dragon roost (see **Tiny islands**). There are no
loose surface chests on main islands. The counts and
chances are in each `WORLD_SIZES` preset. Keeps and surface structures use
median terrain height, filled foundations, and sloped margins; only keeps are
indestructible. Underside ruins are cliffside rooms embedded near the lower
island wall, with outward balconies. They have no built-in ladder or route
from the surface. Ruins have
missing and weathered blocks. Generated chests use
the tables in `shared/loot.js` (a `roost` table for roost nests; Rope Bundles are fairly common, crossbows
and grappling hooks uncommon, and Wind Axes and Ice Swords rare, less so in
central, dungeon and underside chests). Central island tables have more iron,
accessories and rare gear; team island tables are weaker except cliffside
ruins, which retain their good underside loot. The server rolls slots on first open from
the world seed and chest position. Breaking one before opening it drops its
seeded contents. Player-placed chests start empty.
When wood is removed, the server checks nearby leaves in bounded batches.
Leaves without a path to wood through at most six adjacent leaves decay and
are sent as ordinary `blockChange` messages. Each decayed leaf has a 4%
chance to drop a sapling, and breaking leaves drops one 10% of the time
(`SAPLING_DROP_CHANCE`). The server schedules planted saplings to grow in
3–5 minutes (`SAPLING_GROW_TIME`),
sending the resulting tree as `blockChange` messages.

## Tiny islands

`WORLD_SIZES` in `shared/worldgen.js` holds the numbers. Small, Medium and
Large have 22–30, 34–45 and 50–66 tiny islands of radius 4–14, 5–17 and 5–20.
Each has an irregular, lobed outline, a grass surface over dirt with slight
height variation, and a stone underside tapering from about 0.6× its radius
deep in the middle, with root-like spurs. They have no caves or ponds. Radius
7 and up grow 1–2 trees (not on roosts).

About 45% ring the central island, 25% ring the team islands, 15% are
scattered further out (up to team distance + team radius + 40 from the
center) and 15% are stacked over (70%) or under (30%) a main island, with
stacked locations weighted toward the center. Unstacked
ones mostly (80%) sit near the height of the nearer main island's surface
(offset by the average of two rolls in ±15); the rest anywhere from the
central surface −25 to the team surface +40. Stacked ones sit 25–40 blocks
above the terrain beneath or 15–30 below the underside. None reaches lower
than 30 blocks under the lowest main island's underside. Spacing between
islands and the keep buffer are as before.

Each tiny island holds at most one of: a dragon roost (radius 8 and up, 12%
chance, at most 1 / 2 / 4 per world by size), else a loose chest (40%,
`tinyIsland` loot), else nothing. A roost is a rough ring of logs and stone
on the surface with scorched earth inside and around it, and one chest in the
nest (`roost` loot: iron gear, accessories, Golden Beef, Rift Orbs, often
modded). Its dragon is leashed to the island (radius + 20).

## Modifiers

Weapons, tools, armor and accessories can carry at most one modifier
(`shared/modifiers.js`). Each modifier has the same fixed value on every item.
Its name is a prefix (for example, "Keen Iron Sword") and the tooltip shows
the effect.

| Category | Items | Modifiers |
|---|---|---|
| Melee | swords, Ice Sword, Wind Axe | Sharp (+2 damage), Keen (−20% attack cooldown), Heavy (+45% knockback), Vampiric (35% chance to heal 1 HP on a hit) |
| Ranged | bow, crossbow | Power (+2 arrow damage), Quickdraw (−25% draw and load time), Far (+30% arrow speed) |
| Armor | leather, iron, dragonscale | Sturdy (+2 armor points), Light (+8% move speed), Thorns (2 damage to a melee attacker) |
| Accessory | all five | Vital (+2 max HP), Fleet (+8% move speed), Cushioned (−30% fall damage) |
| Hammer | hammers | Efficient (+30% break speed) |

Other items never have modifiers. Loot rolls them per chest entry
(`modChance`: about 15% for wood and stone gear, bows and leather armor, 30%
for iron gear and crossbows, 50% for the Wind Axe, Ice Sword and accessories,
and 60–70% in roost nests); a modded item gets one modifier with its fixed
value from `shared/modifiers.js`. Crafted items have none. Light and Fleet multiply, and are part of
the predicted movement (`moveScale`).

The anvil (crafted at a workbench from 6 iron ingots) holds one moddable item.
Its screen shows the item's modifiers and a Reroll button (`anvilReroll`)
that spends 2 iron ingots to replace them with a fresh roll.

## Dragonscale Armor

Crafted at a workbench from 8 Dragon Scales; never found as loot. 9 armor
points, and dragon fire does it no harm. It's drawn with the same armor pieces
in a dark scaled texture, and takes armor modifiers like any armor.

## Quarry Stones

Each team island contains 2 / 3 / 4 Quarry Stones on Small / Medium / Large.
At least 1 / 1 / 2 of them border an underground cave or cavern. Other stones
are buried in natural stone; each tiny island independently has a 5% chance
of one in its underside. Placement avoids keeps and generated structures.
An iron hammer meets their hardness 8. Breaking one drops the Quarry Stone.
Each of its six faces independently attempts to grow ordinary stone into air
every `QUARRY_REGROW_TIME` (5 s). A player or mob blocks growth in that cell;
dropped items are pushed to nearby air. Clients show glowing cracks, occasional
sparkles and a particle puff on growth.

## Creative mode and spawn eggs

Only a localhost connection can toggle creative mode. The client gesture is
a double-click on the Flag World title, then clicks in the top-left, top-right,
bottom-right and bottom-left screen quadrants within 3 s. The server confirms
the toggle with `creative`; only that client shows the Creative Mode label.
Clicking the label while the pointer is unlocked turns creative off. Creative
mode gives access to the free catalogue and retains inventory on death.
Its inventory controls set noon or midnight and toggle immortality, invisibility
and flight. Inventory recipes cost nothing. Double-tapping jump also toggles flight
while creative. Jump rises, crouch descends, horizontal flight is twice
walking speed, and flight has no gravity or fall damage. Acquired items remain
when creative is turned off.

Spawn eggs exist for Cow, Dragon, Crawler and Void Eel. Air is excluded
from the catalogue. Right-clicking a solid block with one spawns the mob and
consumes the egg. Anyone holding an available egg can use it.


Goblin village/fortress generation uses the same deterministic seed, team count
and world size as other worldgen. Structure plans and entrance stages are kept
on the server and do not have a message. Hidden fortress shooters emit ordinary
`arrow` entities through `entitySpawn`, `state` and `entityDespawn`. Poison ticks
use existing `damage` messages; sensors and poison timers are server-owned and
add no wire fields. No creative overlay or colony messages are added.

## Baked client lighting and fullscreen

Torch ids 84 (floor) and 85–88 (wall facings) are new; all historical ids remain
unchanged. Torches drop item 84 and emit configured block light (default 12).
`input.place` supplies the existing face normal; the server validates floor or
wall support and selects the encoded facing. Removing support drops an attached torch. Four torches craft from one plank.
Lighting is derived client-side and adds no replication fields or server ticks.
The worker mirrors lighting-relevant block edits, computes initial light near
loaded chunks, and refloods only the bounded region affected by an edit.
Time of day changes a skylight shader uniform and never dirties chunk meshes.

Play enters fullscreen before setting ready or starting/reclaiming a match.
Leaving fullscreen suspends input until the return overlay is clicked. A match
also installs a `beforeunload` confirmation, removed at match end/disconnection.
Keyboard Lock is requested when supported; it requires a secure context
(localhost or HTTPS), so ordinary HTTP LAN clients cannot capture browser
shortcuts through that API. Browser/OS permissions still govern key capture.

## Wise Monkeys, Ancient Monkeys and dialogue

- World gen (`shared/npcSites.js`) builds a shrine with a large chair on each
  team island, away from its keep, and records NPC seats in `world.npcSites`:
  a Wise Monkey per team, the Ancient Water Monkey in the gorge's river cave
  (in the gorge river if there is no cave; the server logs that) and the
  Ancient Lightning Monkey on the floor of a hollow storm cloud of Storm Cloud
  blocks (id 120) past the highland edge of the central island
  (`world.stormCloud`). The server spawns them at match start; they never
  respawn.
- Talking (`talk` / `speak`) is private to the player who asked.
- A Wise Monkey answers its own team with the first unmet hint in
  `WISE_MONKEY_HINTS` (`shared/npcLines.js`), judged on the team's progress:
  items that have been in a member's inventory, items crafted and items
  placed (`server/teamProgress.js`). With chance `DIALOGUE.clueChance` it gives
  a clue about the world instead. Other teams get a dismissive line.
- A Wise Monkey has `NPC.wiseMonkey.hp` HP, takes damage from anyone's punches
  and arrows (`damage`), never fights back, and once killed is gone for the
  match (`entityDespawn`), taking its team's hints with it.
- Ancient Monkeys cannot be damaged yet, only make sounds (`speak` with
  `sound`), and alternate sitting with standing (a chest beat), strolling and
  looking around within `NPC.ancientMonkey.walkRadius` of their seat. Their
  idle grunts, the chest beat and the storm cloud's flashes and thunder are
  client-side.


### Goblins (slice 1a)

The existing `entitySpawn`, `welcome.entities` and `state.entities` messages
also carry `goblinWorker`, `goblinSoldier`, `goblinArcher`, `goblinBrute`,
`goblinKing` and `goblinTotem`. Spawn descriptions include `hp` and `maxHp`.
Per-tick snapshots contain `{id,type,x,y,z,yaw,g}`. Positions and yaw are
rounded to two decimal places. `g` is the `GOBLIN_STATE` enum from
`shared/protocol.js`: 0 idle, 1 walk, 2 climb; 3 work, 4 fight and 5 flee are
reserved. Behavior decisions and paths remain server-owned; animations need
no per-action messages.

These entities use the existing changed-only distance cadence (`u`: 1, 3 or
6 ticks) and snapshot interpolation. Existing `damage` and `entityDespawn`
messages confirm hits and deaths. Slots respawn Workers after 15 seconds,
Soldiers/Archers after 20 seconds, and Brutes after 45 seconds; the King and
Totem never respawn. Goblins do not attack, repair, construct or siege in this
slice. Existing `input.spawnEgg` hatches all six goblin egg items only for a
creative player (creative is granted only to the local host); no new message
is introduced. Historical item ids are unchanged.

## Runtime chunk loading and new materials

`CHUNK_LOADING` defines 8 horizontal chunks around each connected live player,
including the column's full height. Team islands and their 16-block margin
are always loaded. Outside loaded columns, entities, dropped-item/projectile
physics, containers, water propagation, sapling growth, quarry regrowth,
turrets and garrison releases sleep and resume when loaded. No backlog of
physics ticks is replayed. Fixed-tick player prediction is unchanged.
Dormant mobs are omitted from changed-state replication; their descriptions
remain in welcome and clients keep their last state. Client mesh/lighting
loading remains governed by view distance. Terrain buffers remain resident
and deterministic generation still runs once at match startup.

Block 121 is Glass; smelting one Sand yields one Glass. Item 305 is Charcoal;
smelting one log yields one Charcoal, and one Charcoal smelts eight items.
Iron generation retains half of its original seeded candidates. New creative
eggs 306–309 spawn working, Wise, Ancient Water and Ancient Lightning Monkeys;
310 spawns a Goblin Totem. Every living creature/NPC kind has a creative egg.
Historic and reserved ids remain intact.
