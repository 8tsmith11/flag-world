Revision 2 is implemented: size-based placement outside a reserved center,
small compounds and timber gatehouses, detailed houses, central-hatch towers,
and a stone/Goblin Brick Castle over a flush shaft. The fortress uses random
rooms, winding halls, branching routes and lined ladder shafts across depths,
with a separate deepest King's room and sealed cliff galleries on buttresses.
The historic Goblin Brick artwork is restored; the padded mipmapped atlas
remains. Mushroom inventory art is unique, and creative entries come directly
from the block/item registries. Existing block and item IDs are unchanged.
The generic engine has no goblin imports. No message formats changed.

`npm run check`: passed (95 JavaScript files). `node scripts/village-check.js
1 2 3 --maps`: passed for Small worlds with two teams. Totem interiors are five
blocks tall; the direct depth is 61, with the ceiling 55 below the Castle floor.
The three walk/climb routes are 448 / 434 / 464 steps and visit 17 rooms each.
All three ASCII outputs were inspected. Full surface details and every level
are in [seed 1](structure-maps/seed-1.txt), [seed 2](structure-maps/seed-2.txt)
and [seed 3](structure-maps/seed-3.txt).

Seed 1 surface, cropped from the island overview; four blocks per cell:
`r` reserved center, `C/E` Castle/shaft, `i/#` compound/outer wall, `G/+`
gatehouse/gate, `a/T` wall post/tower, `h/L/S/W` home/longhouse/store/workshop,
`.` path, `P` cliff gallery, `~` water, `X` keep-out.

```text
  XXXXrrr  ~~
   rrrrrrrr~
  rrrrrrrrrrr       ~
 rrrrrrrrrrrrr     ~~~
 rrrrrrrrrrrrr     ~~~
 rrrrrrrrrrrrrr     ~~
rrrrrrrrrrrrrrr        ~~~~
rrrrrrrrrrrrrrr  XXX   ~~~~~
rrrrrrrrrrrrrrr  XXX  ~~~~~~
 rrrrrrrrrrrrrr  XXX   ~~~~~
 rrrrrrrrrrrrr   XXX   #a##aXXXX
 rrrrrrrrrrrrr #a###a###   ##XXX
  rrrrrrrrrrX  # SSSiWWW LLL#XXX
   rrrrrrrrX#### SSS+WWW.LLLaXXX
XX   rrrrr  a    SSSiWWW LLL#
XX  ####a###i CCCCCCi..  .. a
XX  a SSS LLi CCCCCCahhhaGG##
    # SSS.LL+.CCECCC+hhh#PPPPPPP
    # SSS LLi CCCCCCihhh#..
    a ..    i CCCCCCi+aii
    # hhh###iiaCCCCC TTT#
    a hhh#   ####### TTTa
  ~~# hhh#   XX    # TTT#
 ~~~a .. #         iiiiia
XX~~# WWW#         ######
XX  a WWW#
XX  # WWW#
    a WWW#
    ####a#
```

Seed 1 fortress level 60, viewport x=344..406, z=348..362:
`A` Mid Room, `B` mess hall, `*` main route, `^` descending ladder shaft,
`P` exterior brick. The northern opening in B leads to a branch outside this
viewport. The cliff gallery is a sealed dead end off B; its 1×1 window is on
the next level.

```text
#########                 ####.####
##.....##                 ##.....##
#.......#                 #.......#
#...#...###################.......######################PPPPPPP
#..#A....*****************....B...............................P
#...#...###################.......#####################PPPPPPPP
#.......#                 #.......#
#......##                 #......##
#########                 ####.####
                             #*#
                             #*#
                             #*#
                             #.#
                             #^#
                             ###
```

Manual playtest:

- Start Small, Medium and Large worlds; compare scale and confirm the center
  stays free of goblin construction. Inspect roofs, windows, Castle galleries,
  flat corner platforms and historical brick texture up close and at distance.
- Walk every gate and compound. Climb tower hatches and inside wall posts;
  check that raised platforms outside compounds cannot provide a jump over.
- Descend the flush Castle shaft through the Mid Room and winding route to the
  Totem Hall and King's room. Inspect the plugged shaft and cliff buttresses;
  try approaching the 1×1 cliff windows from outside.
- Browse creative entries, including mushrooms and goblin blocks. Open room
  loot and trigger a poison corridor. King/Totem spawn points are data only.

Remaining defects: none known in the three checked Small-world layouts.
Browser visuals and other world sizes still need playtesting.

Startup correction, seed 60226440, Medium, one occupied team:

- Reproduced server generation at 89,982 ms; after deferring rejected voxel
  lists, reusing templates, factoring density intersections and indexing wall
  membership, measured 9,835 ms. Generation constraints are unchanged.
- Browser generation now runs in a module worker with transferable voxel
  buffers. The actual worker entry generated and transferred this seed in
  10,109 ms in the Node worker harness; its voxel hash matched the server.
  The loading thread kept ticking throughout. Browser timing needs playtesting.
- The host sees loading immediately; server and browser stages plus elapsed
  time remain visible. Server generation failures return to the lobby with an
  error. The undefined `icon` crash in mushroom tooltip initialization is fixed.
- `npm run check`, all three original village seeds, and the affected Medium
  seed pass. Original three ASCII maps are byte-identical. A focused inventory
  render check passed for every registered item, including the mushroom, and
  the factored density calculation matched exhaustive window volumes.

Startup playtest: restart the server, refresh browsers, start the affected
seed, watch stages and elapsed time on host and guests, enter the world, and
open creative inventory/hover the mushroom. Also refresh/reclaim a player and
disconnect while loading to confirm cancellation.
