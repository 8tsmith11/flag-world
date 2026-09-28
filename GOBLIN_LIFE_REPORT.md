Applied the approved baseline `b5a3205`, then implemented goblin slice 1a.

Water shimmer and Stone Spires generation, biome selection, config and modules are removed. Water uses its original transparent, voxel-lit material; highlands use their ordinary terrain and biomes. Existing block and item ids retain their numbers.

`public/img/lobby.png` and `public/audio/lobby.ogg` both exist and are listed in `ASSETS.md`. Headless Chromium verified the full-screen image, dark gradient/menu backing, successful image decoding and music loading, playback after the first pointer click, looping during lobby/loading, and fade-to-pause when the match-start fade runs. No files need to be added. There were no browser page or shader errors.

The six models and their animations were recovered with git history searches from `5be99f1`. Only their imports, obsolete siege attachment and Archer climbing-pose priority needed adaptation. No historical goblin AI was restored. Repeated goblin parts now render with instances and existing entity lighting; browser WebGL verified all six types, repeated Worker instances, animation updates and instance removal.

The implementation adds active 3D areas and gate graphs, fortress chokepoint doors and missing guard rooms, perimeter sections that rebuild when development changes, fixed role slots, staggered building releases, role respawn timers, posts/pacing, patrols, Worker wandering and unique King/Totem placement. The former King's room is an ordinary unique royal vault. Host creative eggs restore their historical ids.

One unit state machine and one navigation module drive all roles from data. Surface routes cache flow fields; underground routes use room, hallway and shaft waypoints; cross-area spawns follow the gate graph. Block edits invalidate only containing regions, with rebuilds batched per tick. Path following uses the existing shared `stepPlayer` gravity, collision, step-up, jumping and ladder/rope physics. Shared overlap handling reuses `SpatialHash` and applies one soft pressure pass for all mobs, including monkeys. Existing `EntityInterest`, changed-only distance cadence, interpolation and lighting are reused. No connection/voice-chat flow changed. `AGENTS.md`, `shared/protocol.js` and `PROTOCOL.md` document the changed modules and compact animation enum.

Validation: `npm run check` passed (147 JS files); `node scripts/goblin-life-check.js 1` passed: 10 areas (5 surface, 5 underground), 13 outskirts sections, 25 gates, 171 reachable slots. The check also validates home patrol/interest routes, gate pairs, wall restrictions, the King's ladder prohibition, and planned-to-active outskirts rebuilding. `git diff --check` passed. No long simulations, profiles or broad suites were run.

Seed 1, Small world, two teams. Four blocks per ASCII cell. Surface A–E label S1–S5; outskirts a–m label O1–O13; underground digits label U1–U5; `#` is a wall and `+` a gate.

```text
Seed 1; 4 blocks/cell; surface areas uppercase, outskirts lowercase; # wall, + gate
            abbbbbbb
            #+#####b
           a#CCCCC#b
         aaa#CCCCC+bccc
        aaaa#CCCCC+bcccc
        a######++##+###c
        a#CCC#EEEEEEEE#c
        a#CCC#EEEEEEEE#ccccc
        a#CCC#EEEEEEEE#cccccc
     llla#CCC#EEEEEEEE#####+f
     llll+CCC##########CCCC#f
   #######CCCCCCCCCCCCCCCCC#f
  m#AAAA#CCCCCCCCCCCCCCCCCC#f
  m#AAAA###+####CCCCCCCCCCC#f
  m#AAAAAAA+AAA#CCC#+#####+#e
  m#AAAAABBBBBA#####gd eeeee
  m#AAAAABBBBBAAAAA#g
  k+AAAAA+BBBB+AAAA#g
  k#AAAAABBBBBAAAAA#g
kkk+####ABB+BBA####+g
k###DDD#AAAAAAA#DDD#g
k#DDDDD####+####DDD#
k#DDDDDDDDDDDDDDDDD#
k#DDDDDDDDDDDDDDDDD#
k#DDDDDDDDDDDDDDDDD#g
k#####DDDDDDDD#####+g
 kk+j#DDDDDDDD#hhhhg
    j#DDDDDDDD#h
    j#DDDDDDD##
    j######+##
     jjjjjjii
A=S1 (1267 cells) B=S2 (483 cells) C=S3 (1622 cells) D=S4 (1727 cells) E=S5 (619 cells) a=O1 (277 cells) b=O2 (187 cells) c=O3 (278 cells) d=O4 (40 cells) e=O5 (116 cells) f=O6 (95 cells) g=O7 (166 cells) h=O8 (138 cells) i=O9 (38 cells) j=O10 (265 cells) k=O11 (260 cells) l=O12 (75 cells) m=O13 (91 cells)
Underground feet level 60; digits label U1..U8, + gate; 4 blocks/cell

      3
      +2
      22
      22
      ++
      11
11111111
11111111
      11
      11
      11
      11
      11
Underground feet level 56; digits label U1..U8, + gate; 4 blocks/cell
      33
      33
      33
      33
      33
      33     3
      33     3
      333333333333333
      333333333333333
      33
      3

Underground feet level 51; digits label U1..U8, + gate; 4 blocks/cell

            333   333
            333333333
            33    333
             3     3
             3

Underground feet level 47; digits label U1..U8, + gate; 4 blocks/cell

                   3
                   3
              33   3
            333333333
              33  333

Underground feet level 43; digits label U1..U8, + gate; 4 blocks/cell

    33   33
   3333333333
   333   33
    3
    3

Underground feet level 39; digits label U1..U8, + gate; 4 blocks/cell

    3
    3    4
    +   44
   4444444
   4444444
    4
    4
    4
    4
   444
   444

Underground feet level 34; digits label U1..U8, + gate; 4 blocks/cell

              55
              55
              55
              55
        55    55
        5555555555
        5+    55
        5+

Underground feet level 30; digits label U1..U8, + gate; 4 blocks/cell

                  5555
                 55555
                    5
                    5
                    5
                    5
                   55
                 55555
                   555

Underground feet level 26; digits label U1..U8, + gate; 4 blocks/cell

              555
              5555
              55
              55
              55
              55
      55      55
      5555555555
      55      55
      55
      55
      55
      55
      55
     555555
     55555

Underground feet level 18; digits label U1..U8, + gate; 4 blocks/cell

          55555
           5555

Underground: U1: 278 cells; spawns guardroom:59,guardroom:65 | U2: 74 cells; spawns guard:U2 | U3: 931 cells; spawns guardroom:7,barracks:9,guardroom:21,guardroom:63 | U4: 264 cells; spawns guardroom:67 | U5: 995 cells; spawns guardroom:43,totemHall:53
Gates: gS0 S3<->S1; gS1 S1<->S4; gS2 S3<->S5; gS4 S1<->S2; gS5 S1<->S2; gS6 S2<->S1; gS7 S2<->S1; gU14 U3<->U4; gU0 U2<->U1; gU17 U5<->U4; gU1 U3<->U2; shaftGate S2<->U1; gO:O2:S3 O2<->S3; gO:O5:S3 O5<->S3; gO:O7:S4 O7<->S4; gO:O11:S4 O11<->S4; gO:O1:O2 O1<->O2; gO:O1:O12 O1<->O12; gO:O2:O3 O2<->O3; gO:O3:O6 O3<->O6; gO:O4:O7 O4<->O7; gO:O7:O8 O7<->O8; gO:O10:O9 O10<->O9; gO:O10:O11 O10<->O11; gO:O11:O13 O11<->O13
```

Manual playtest checklist:

- [ ] Water has no shimmer; highlands have no spires.
- [ ] Lobby image fills the screen; music unlocks on click, loops through loading and fades when play begins.
- [ ] Goblins walk out of doors with staggered releases (one per building per 1.5 seconds).
- [ ] Tower archers climb to posts and pace the platform.
- [ ] Gate guards, ground archers and Brutes hold their points, shift and look around.
- [ ] Interior patrols loop within their areas; outskirts patrols walk their section and back.
- [ ] Workers wander between interests within their area.
- [ ] Crowding at doors and narrow hallways separates softly, without idle turning.
- [ ] Goblins cross walls only through gates; posts use inside ladders.
- [ ] Kill a goblin: its replacement waits 15/20/45 seconds by role, then walks out. King/Totem never respawn.
- [ ] Cows, dragons, crawlers, void eels and Ancient/Wise Monkeys retain their behavior apart from softer overlap.
- [ ] Host creative eggs spawn Worker, Soldier, Archer, Brute and King; check night/torch lighting.

Remaining limitations: isolated outskirts ground patches below the configured minimum, or with no safe outer-gate approach, are omitted from patrol sections. This is a coverage limitation relative to a band covering every walkable patch. The passing one-seed geometry checks and browser checks do not establish movement feel or behavior across other seeds/sizes; those remain for the requested playtest. Combat, repairs, construction and sieges remain outside this slice.
