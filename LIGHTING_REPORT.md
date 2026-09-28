# Lighting, sky, rivers and lobby report

Implemented bounded worker lighting, Minecraft-style skylight spill, vertex AO,
wall/floor torches, darker nights with shorter visibility, graded sky/haze,
stars and a drifting cloud sea. The lobby now has a real-renderer background,
CC0 looping music with a saved volume slider, percentage loading, fullscreen
joining/resume, close confirmation, and a host creative PNG capture command.
No historical block or item ids were renumbered. AGENTS.md and the protocol
reference describe the new modules and messages.

## Measurements

Headless Chromium 143, 1280×720, **SwiftShader software GPU**, seed 1 Small,
708 loaded chunks around the village, midnight, three placed torch positions.
The saved pre-change renderer used non-emitting wood placeholders because
it had no torch block. Both measurements use the same generated scene and
camera; these are tooling measurements, not expected hardware frame rates.

| Mean time | Before | After |
| --- | ---: | ---: |
| Frame interval | 78.73 ms | 81.12 ms |
| CPU render submission | 2.09 ms | 2.49 ms |
| Initial chunk mesh build | 1.54 ms | 2.70 ms |
| Edit remesh, per rebuilt chunk | 2.48 ms | 4.00 ms |

The baseline edit rebuilt 4 chunks; removing one torch rebuilt 12 nearby chunks
where illumination/face sampling changed. Time-of-day updates rebuilt **zero**
chunks. Initial light and bounded refloods run in the worker; stable frames
perform no lighting flood, column scan, or lighting-load queue scan.

Medium rivers, including final bank cleanup: seed 1 **100.3 ms**, seed 2
**20.6 ms**, seed 3 **59.0 ms** (0.3–2.8% of these measured worldgen runs).
The fixed Large-world lobby capture took **66.7 ms** for river work.

## Verification

- `npm run check`: passed, 109 JavaScript files and server/shared/client imports.
- `node scripts/lighting-check.js`: opaque wall blocking, emitter removal,
  bounded dirty chunks, opening/closing a wall, distant-island exclusion,
  deepening direct skylight, brighter canopy edges, repeated rapid torch edits,
  and floor/wall attachment drops passed.
- `node scripts/river-check.js`: Medium seeds 1–3 passed. Each has two lake-fed
  rivers ending beyond the real island boundary, with water reaching the void.
  Every recorded lake meets the 100-cell minimum. No river/lake lies in the
  central reserve; no one-block water-level steps, disconnected centerline
  samples, uphill water, missing water, or exposed dirt banks were found.
  Repeating seed 1 produced an identical voxel hash. Overhead maps were
  inspected for all three seeds; later village earthworks exposing a bank
  face were corrected with final soil skinning.
- Actual browser/server flow passed: gesture-started music, Play/fullscreen,
  monotonic percentage-only messages, plain loading text, paused input after
  fullscreen exit, click-to-return, host-authorized PNG download, music fade,
  beforeunload confirmation registration and disconnect cleanup.
- `public/img/lobby.png` was captured using the real renderer from a fixed
  Large world at golden hour; it includes waterfalls and the cloud sea.

## Music

[Sunset Walk / Ambient / Quiet / Sweet / Loop](https://opengameart.org/content/sunset-walk-ambient-quiet-sweet-loop)
by **Kilua Boy**, explicitly **CC0 1.0**. Downloaded and normalized to Vorbis
OGG at 44.1 kHz / -20 LUFS target. Source, license and file are in ASSETS.md.

## Manual playtest

- [ ] Village at night with torches; compare a canopy edge with its interior
  and verify distant terrain is difficult to see without raising ambient light.
- [ ] Walk into the fortress and caves; verify wall blocking and torch light.
- [ ] Watch dusk and dawn colors and the 12-minute cycle.
- [ ] Look below the islands at the cloud sea; check stars at night.
- [ ] Place/break torches quickly on floors and walls, including their support;
  verify there is no leftover glow.
- [ ] Follow a river from its source lake, through any further lake, to its
  waterfall off the island; inspect beds and tapered grass/sand banks.
- [ ] Inspect the lobby image, music loop, volume persistence and match fade.
- [ ] Start/reclaim a match and watch the simple generation/loading bar.
- [ ] Leave/return to fullscreen, including while an inventory is open;
  verify inputs pause and resume appropriately.
- [ ] Press Ctrl+W in a match and check close confirmation / Keyboard Lock.

## Remaining limitations

Keyboard Lock cannot be guaranteed on ordinary `http://<host-ip>` connections:
[its specification requires a secure context](https://wicg.github.io/keyboard-lock/).
It is requested on supported localhost/HTTPS Chromium clients, subject to
browser permission and OS shortcut restrictions. Fullscreen and beforeunload
work independently. Ctrl+W interception needs a real browser/OS playtest;
headless key injection cannot establish OS-level shortcut capture.

Skylight spill is deliberately short (four cells by default) to keep loading and
edits cheap; thick island interiors remain shadowed. Dynamic entity models
retain their global day/night materials rather than the terrain's baked voxel
illumination. No known failing automated checks remain; untested seeds and
hardware performance still need the requested playtest.
