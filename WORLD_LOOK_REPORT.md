# World appearance and entity lighting

Implemented deeper grass/leaves, rigidly tilted wall torches, opaque-aware sky
and cool void light, warped surface noise, smoother broad island undersides,
biome plants, and hanging roots/vines. IDs 83 and 84–88 are preserved; new
plants/strands use 89–101. All tuning is in config. AGENTS.md documents the
new modules and behavior.

Entity models use one shared air-cell sampler and the terrain's block/sky/void
coefficients. Solid-overlapping samples choose the brightest adjacent air;
lighting eases over 0.16 seconds. A per-entity RGB uniform and slight normal
shading cover players, mobs, dropped items, held items, arrows, sprites and
turrets. Instance attributes support future batches; current entity factories
have no instanced meshes. The separate night visibility floor is removed.

## Measurements

Large worlds, two teams, Node 18, seeds 1–3. Final timings were taken without
concurrent browser generation. Before timings were recorded before edits.

| Seed | Before | After | Change |
| --- | ---: | ---: | ---: |
| 1 | 8.129 s | 8.791 s | +8.2% |
| 2 | 9.154 s | 10.788 s | +17.9% |
| 3 | 14.571 s | 8.652 s | −40.6% |

Every measured seed remains within the requested 20% generation budget.
Changed terrain can change how many seeded structure candidates are rejected;
seed 3 now fits considerably sooner.

Actual Three.js renderer, Chromium 143, **SwiftShader software GPU**, 960×600,
Small seed 1, 112-block view distance, 60 sampled frames after warmup. Each
version chooses its densest forest with the same deterministic scan, so the
changed terrain produces different forest locations. These measurements are
not hardware GPU frame rates.

| View | Frame interval before → after | CPU submission before → after |
| --- | ---: | ---: |
| Island side | 60.29 → 87.86 ms | 2.515 → 3.055 ms |
| Dense forest | 47.68 → 54.10 ms | 1.948 → 2.140 ms |

Stable frames and day/night changes rebuilt **zero chunks** on all three seeds.
Lighting runs in the existing worker; wind/fade run in the shader. Hanging
quads are narrow, alpha is discarded before lighting, and plant artwork uses
one atlas/draw per chunk.

## Verification

- `npm run check`: passed (119 JavaScript files and imports).
- `node scripts/lighting-check.js`: passed opaque shielding, block-light
  removal/re-addition, underside glow, dark sealed/straight caves, long
  boundary-ray edits, clean-solve agreement, actual floor/wall placement,
  ceiling/non-solid rejection and item drops after support breaking.
- `node scripts/world-look-check.js`: passed Small seeds 1–3, including the
  existing village acceptance checks, supported/oriented generated torches,
  vegetation reservations, dark fortress interior, canonical creative choices,
  same-seed voxel equality, authoritative melee and arrows through plants.
- `node scripts/river-check.js`: passed Medium seeds 1–3 and repeat-seed hash.
- Actual-renderer day/night views were captured for three seeds from above,
  the side, below and in forests. Shader compilation covers all model families,
  sprites and an instance batch. Captures/timing JSON are in `/tmp/look-final`.
- The existing village checker was corrected to account for actual doorway
  widths and canonical creative items; the geometry requirements remain.
- The three requested entity appearance assertions were deliberately left
  for manual playtesting.

## Manual playtest

Restart the server and start a new match to load the changed registries and
world generation.

- [ ] Grass and leaves by day and at night.
- [ ] Floor torches and all four wall orientations; ceiling placement rejected.
- [ ] Fortress torches: attachments, tilt and unchanged light emission.
- [ ] Break a torch's supporting wall/floor; collect the torch item.
- [ ] Undersides/cliffs from below by day and at night; faint cool illumination.
- [ ] Walk into caves and the fortress; openings spill light, deeper rooms stay dark.
- [ ] Island edges/profiles from a distance: sheer rim and broad rock lobes.
- [ ] Plains, forest and mountain plants: clustering, sway, instant breaking and night glow.
- [ ] Fight a mob standing in plants with melee and arrows.
- [ ] Hanging roots/vines under edges and cliffs; thin strands, slight sway and glowing buds.
- [ ] Goblin village: roads, walls/buildings, cliff gallery and central reserve still look right.
- [ ] Creative inventory: every plant/strand with distinct artwork.
- [ ] Players/mobs by day, at night, beside torches, in caves and under islands.
- [ ] Partly embedded entities use nearby lit air rather than turning black.
- [ ] Dropped items, plant items, held items/empty hand and projectiles at night.
- [ ] Walk past a torch; entity brightness changes smoothly without flicker.

## Remaining limitations

No known failing correctness checks remain. Software-GPU frame intervals rose
about 46% in the side view and 13% in the forest; CPU submission rose 0.54 ms
and 0.19 ms respectively. Hardware frame rates and entity appearance still
need the requested playtest. Rare seeds beyond the three reviewed are not
exhaustively checked. Existing fortress mushroom-farm decorations are retained
as structure content; the biome plant generator does not plant in construction.
