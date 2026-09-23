# Flag World

A multiplayer LAN voxel game that runs in the browser.

## Running

Requires Node.js 18 or newer.

```sh
npm install
npm start
```

The server prints the addresses it's reachable on:

```
Flag World server running; waiting in the lobby
  Local: http://localhost:3000
  LAN:   http://192.168.1.20:3000
```

Set `PORT` to use a different port, e.g. `PORT=3100 npm start`.

The host opens the Local address. Everyone else on the same network opens the
LAN address. If others can't connect, allow inbound TCP port 3000 through the
host's firewall.

## Lobby

Everyone lands in a lobby first: pick a name and color, then click Ready. The
first player to connect is the host. When everyone is ready, the host can
enter a seed (blank = random; any text works), pick a world size, and click
Start.

World sizes:

- **Test**: a small, low world for quick testing. It grows a little with
  more players.
- **Small / Medium / Large**: floating islands, 636 / 780 / 944 blocks
  across. There's a big center island (bigger, and further from the ring, in
  larger worlds), a ring of large islands where every player gets their keep
  on their own island, and small islands scattered further out. Some islands are joined by winding land bridges or lines of
  stepping stones; most aren't. Fall off and you're gone.

A match lasts until the server is restarted. If you disconnect, reopen the page
in the same browser to rejoin as the same player, with your position and
inventory. Anyone who connects mid-match sees the "match in progress" screen,
where they can take over any disconnected player.

## Controls

| Key            | Action |
|----------------|--------|
| Click          | Capture mouse and start playing |
| W A S D        | Move |
| Space          | Jump (swim up in water; jump out at the surface) |
| Shift          | Crouch: slower, lower, fits through 1.5-block gaps, and won't walk off edges higher than 1 block |
| Mouse          | Look |
| Left click     | Punch the player under the crosshair |
| Hold left click | Break the block under the crosshair |
| Right click    | Place the selected block |
| 1–9 / scroll   | Select hotbar slot |
| Q              | Drop one of the selected item |
| E              | Inventory and crafting (E again closes it; Esc closes it too, then click to resume) |
| Arrow keys     | Look (for touchpads that pause while typing) |
| Esc            | Release mouse (pause screen) |

## Trees, crafting and tools

Trees grow on the hills. Break wood by hand (leaves drop nothing), then press
E to open your inventory. The crafting list on the right only shows what you
can make right now:

- 1 wood → 4 planks
- 1 plank → 2 ladders
- 4 planks → workbench

Place the workbench and right click it for everything else:

- Hammers (break harder blocks, faster): 3 planks / stone / iron ingots + 2 wood
- Swords (more damage than fists): 2 planks / stone / iron ingots + 1 wood
- 6 planks → door
- 8 stone → furnace
- 8 planks → chest (27 slots; anyone can open any chest)

Iron ore is in the stone, especially in cave walls, cliffs and undersides, and
most of all on the center island. It needs a stone hammer. Put it in a
furnace (right click) with wood or planks as fuel to smelt iron ingots.

| Tool | Breaks up to | Speed | Damage |
|------|--------------|-------|--------|
| Hands | dirt, wood, sand (1) | 1× | 2 |
| Wood hammer | stone, furnace (2) | 1× | 2 |
| Stone hammer | iron ore (3) | 1.5× | 2 |
| Iron hammer | (4) | 2× | 2 |
| Wood / stone / iron sword | like hands | 1× | 3 / 4 / 6 |

In any inventory screen, shift-click moves a whole stack across: between a
chest or furnace and your inventory, or between your hotbar and the rest.

Ladders go on the side of a block. Hold W or Space to climb, S to climb down.
Doors are two blocks tall and need solid ground. Right click opens or closes
them (anyone can).

Falls of more than 3 blocks hurt: 1 HP for every block beyond that. Landing on
a ladder is safe.

The big islands have caves, some with entrances in cliffs, undersides or the
top.

The islands have small ponds with sandy shores. In the inventory, click to pick up
or put down a stack, and right click to pick up half or put down one.

## Capture the flag

Every player has a keep: a stone frame with their flag on a gold pedestal in
the middle. Keeps can't be broken or built in.

- Stand on an enemy flag for 2 seconds to take it. You move at 60% speed
  while carrying it, and a light beam above you shows everyone where it is.
- Bring it to your own pedestal while your own flag is home to capture it.
  That player is now flagless.
- If a carrier dies, the flag drops. It returns home after 2 minutes, or
  straight away if its owner touches it.
- Flagless players keep playing, but they can't capture, and when they die
  they're eliminated and become a spectator (WASD to fly, Space/Shift for
  up/down).
- The last player who hasn't been eliminated wins.

## Combat

Players have 20 HP, shown above the hotbar. A punch does 2 damage and knocks
the target back; you can punch every 0.4 s. After 5 seconds without taking
damage you heal 1 HP per second. When you die you drop everything you were
carrying. Falling off the edge of the world kills you and your items are lost.
After 3 seconds you can click to respawn in your keep. Kills show at the
top right.

## Checking changes

```sh
npm run check
```

Syntax-checks every JavaScript file and imports the server and shared modules.

## View distance

The click-to-play screen has a view distance slider (64–320 blocks, default
160). Lower it if the game runs slowly. It's remembered per browser.

## Debug overlay

Set `DEBUG` in `shared/config.js` to `true` to show FPS and player coordinates,
and to let M toggle a top-down view of the whole world. Refresh the page after
changing it.

## More

- `CLAUDE.md` / `AGENTS.md`: project overview, conventions and file layout
- `PROTOCOL.md`: WebSocket message reference
