# Trees and biomes

Implemented Branch (new block/item ID 102), seeded branching oak/birch/pine
trees, Ancient Forests with large crowns, hollow bases and fallen logs.
Stone Spires were removed in the subsequent cleanup; highlands retain their
ordinary terrain and biome selection.
Branch collision, ray hits and selection outlines follow its neighbor-derived
core and arms. Natural branches and dependent leaves use the shared decay
queue; player-placed foliage is protected and logs never decay.

Water uses its original transparent voxel-lit material with no shimmer.
Leaf sway was removed at the user's
request; leaves are static. Existing plant sway remains. AGENTS.md documents
the new modules and checks. Historical block and item IDs are unchanged.

## Generation

Large worlds, four teams, same seeds and machine:

| Seed | Before | After | Change |
| --- | ---: | ---: | ---: |
| 1 | 6.383 s | 6.331 s | −0.8% |
| 2 | 7.765 s | 7.649 s | −1.5% |
| 3 | 5.872 s | 6.243 s | +6.3% |

The comparison snapshot restores the previous tree generation while holding
concurrent NPC/workspace changes fixed. All seeds satisfy the 20% limit.
The initial pre-task baseline was 5.665 / 7.756 / 6.191 seconds; the final
times also remain within 20% of those measurements. Repeated seeds reproduce
identical voxel and biome hashes. Final tree passes took 0.282–0.434 seconds.

## Rendering

Actual browser renderer, Large seed 1, two teams, 960×600 pixels, view distance
112; 60 measured frames after warm-up. This environment uses SwiftShader,
a software GPU, so these are not hardware GPU performance estimates.

| View | Frame time | CPU submission |
| --- | ---: | ---: |
| Dense regular forest | 111.6 ms | 1.57 ms |
| Ancient Forest | 197.9 ms | 3.83 ms |

The final static-leaf capture passed without shader, page or resource errors.
Animation and day/night changes caused zero remeshes. Captures and timing JSON
are in `/tmp/look-trees-static/`.

## Validation and remaining defects

Passed `npm run check` (139 files), tree/biome acceptance for Small and Large
seeds 1–3, actual Branch mesh/static-leaf checks, and existing lighting,
world-look, river and central-island checks (including village validation).
Acceptance covers every generated Branch's branch-only path to a log, leaf
support, severed natural foliage decay, placed-foliage protection, original
forest containment, reserve exclusions, hollow entry,
and determinism. Browser imports and NPC hints also pass.

No known defects remain on the tested seeds. Gameplay and appearance review
remain with the user's playtest.
