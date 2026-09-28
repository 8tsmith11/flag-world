# Central island follow-up

The surface gorge remains open. Its former lake is replaced by a walkable
river cave that bends around the reserved center, emerges from another face,
and adds a second waterfall. A configured rock margin separates the cave and
fortress. Random structures obey the shared center reservation.

The island has seeded highland/lowland regions, an arcing ridge, foothills and
eroded terraces. Lowlands have larger forests; forest trees use a density
multiplier with noisy clusters and clearings. Village scoring favours lowlands.
Required civilization placement precedes optional structures, keeping village
sites available. Trees remain in open village spaces and around the walls;
only construction footprints and necessary headroom are reserved.

Glowing flowers/moss/mushrooms/buds now emit 2/1/2/1 and occur less often.
Plant breaking and placing use grass sounds. Hanging strands require solid
overhead support or another strand and drop when their support is removed.
The goblin song gain increased from 0.3 to 0.5.

Night lighting reduces cloud-sea brightness and fills missing skylight rather
than adding sea glow to full sky exposure. Entities request light for empty air
chunks and retain the previous sample while it loads, including the hand when
flying. Out-of-world light buffers handle all boundaries safely.

## Measurements

Node generation, seeds 1/2/3, two teams, Large, one sequential process:

| Measurement | Seed 1 | Seed 2 | Seed 3 | Mean |
| --- | ---: | ---: | ---: | ---: |
| Before the central island work | 8.76 s | 10.55 s | 8.52 s | 9.28 s |
| Before this follow-up | 5.37 s | 5.44 s | 6.83 s | 5.88 s |
| Final | 6.53 s | 7.07 s | 6.16 s | 6.59 s |

The final mean is 12.1% above the follow-up baseline, within the 20% budget,
and 29.0% below the initial baseline. The ore pass uses direct chunk reads
for interior neighbours, preserving exposure rules and noise-call order.

Actual renderer, Small seed 1, 960×600, view distance 112, 60 measured frames
after 12 warm-up frames, Chromium SwiftShader software GPU:

| Dense forest measurement | Before follow-up | Final |
| --- | ---: | ---: |
| Frame interval | 26.85 ms | 87.96 ms |
| Render submission | 1.23 ms | 2.03 ms |
| Triangles | 41,624 | 165,506 |
| Draw calls | 102 | 382 |

These are different generated forest locations. The review camera now finds
actual standing space; its earlier height-map positioning could enter changed
terrain. These timings are references, not a controlled comparison at the same
camera. The final software-rendered forest is slow; hardware frame time remains
for playtesting. Measured frames caused zero remeshes, and changing only time
of day caused zero remeshes. The browser reported no renderer errors.

## Verification

- `npm run check`: passed, 122 files.
- `central-island-check.js`: Small and Large seeds 1–3 passed cave walking
  shoulders, center exclusions, fortress separation, existing village/fortress
  checks, and repeated-seed voxel hashes. The final Large checks also verified
  both waterfalls reach the void and the former gorge lake is absent.
- `river-check.js`: Medium seeds 1–3 passed; expected river counts, continuous
  downhill routes, water cells, waterfalls, banks and seed repetition.
- `lighting-check.js`: passed opaque flood/edit checks and high, deep-void and
  side-boundary air chunks. The three entity appearance checks remain manual.
- A focused support check confirmed that breaking the overhead block drops
  the root/vine chain, and plants/strands map to grass audio.

## Manual playtest

Restart the server, reload the browser and start a fresh world for generation
changes. Suggested checks:

- View highlands and lowlands from above and on foot; inspect the arcing range,
  foothills, terraces, sheer edges and the untouched center.
- Walk the surface gorge along its rim and bottom. Enter the cave at the former
  lake site, follow its bend around the center beside the water, and inspect
  both cliff waterfalls and the rock roof.
- Inspect the lowland village, retained trees, paths, gates, tower hatches,
  fortress route and sealed cliff gallery. Listen to the louder goblin song.
- Inspect forest clusters/clearings, plants in each biome, wind movement and
  the reduced glow at night. Break and place plants to hear their new sounds.
- Place floor/wall torches and break their supports. Check fortress torches.
- Check grass, terrain and water by day/night, cliff faces and undersides from
  below, and the transition into caves and the fortress.
- Check players/mobs near torches, in caves and under islands; check dropped
  items, projectiles, held items and the hand at night and at varying void
  heights. Walk past a torch to check smooth lighting. Fight a mob in plants.
- Inspect hanging roots/vines and their night glow; remove overhead support
  and check that the whole strand drops.

No generation or syntax defects were found on the checked seeds. Visual,
audio and gameplay acceptance remain manual. The observed software-GPU forest
frame cost is the remaining performance limitation.
