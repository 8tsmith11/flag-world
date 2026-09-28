# Changes and playtest

Restart the server, refresh every client, and start a fresh match. House and
fortress changes alter deterministic world generation.

Rendering now batches atlas textures into one draw per chunk, caches mesh light
samples, limits remeshing work per frame, skips distant entity animation and caps
pixel density. Camera interpolation carries server corrections across both
endpoints. Render-loop startup is idempotent across reclaims. Atlas filtering now
enables anisotropy; Three.js skipped it with the previous nearest magnification.
Actual horizontal display tearing still needs a Firefox/Ubuntu playtest; no
browser or display presentation fix is claimed.

Reclaim resets input/pause state and entity replication history. Dropped-item
culling uses snapshot positions, including the first frame after joining.
Cows yield/replan around herd mates; overlap pushes are symmetric and safe.
Crawlers follow partial paths to airborne targets and retain cliff protection
while jumping and when pushed.

Fortress passages have a 3-wide, 2-high interior with brick floors and torches.
House gables are filled and entrances are open. Creative entries collapse encoded
variants. Day blue is restored with sparse overhead clouds; nights and stars are
darker. Models sample voxel light with a small visibility floor. Dragon lighting
samples the body above the grass when landed, instead of the partly buried origin.

Audio uses 33 included, normalized CC0 OGG files from Kenney, OpenGameArt and
Freesound. Every file, source URL and license is in [ASSETS.md](ASSETS.md), with
conversion details in the source manifest. No manual downloads are needed.
The lobby track is unchanged. Day/night songs were removed at the player's
request. Ambient loops remain; the fortress hum is 2.5 times its initial gain,
and never plays in ordinary caves. Birds play in 5–11 second bouts with
20–45 second pauses and 2.5 second fades. Sounds have distance falloff, stereo
panning and a shared voice cap. Four volume settings are saved by player name.
River ambience excludes lakes and requires water still present in a generated
river reach; draining a reach fades its sound out.

Validation: `npm run check` passes (113 files). Focused simulations separated
three overlapping cows and kept a crawler chasing an airborne target on its
platform. A renderer check confirmed dropped items appear from their first
snapshot and after returning into range. Focused checks confirmed light samples
above a landed dragon's grass block and river ambience stopping when drained,
without lake water triggering it. Bird timing was checked across fades and pauses.
All included OGGs decoded without
silence or clipped sample peaks. No broad test suite was run.

## Manual checklist

- [ ] Relog/reclaim: movement, inventory and nearby dropped items work immediately.
- [ ] Turn quickly beside planks/bricks; compare frame pacing and horizontal ripping.
- [ ] Observe a crowded herd; lure crawlers toward a target beyond a cliff edge.
- [ ] Check fortress torches, brick floors, passage clearance, house gables/entrances and creative duplicates.
- [ ] Check sparse clouds, darker nights/stars and visible cow colors near torches and outdoors.
- [ ] Music: lobby track plays/fades as before; no day/night songs play in the match.
- [ ] Ambience: wind grows with altitude; daytime forest birds have quiet gaps and fades; night crickets; louder fortress hum; no cave hum.
- [ ] Walk beside rivers and waterfalls; check falloff and left/right panning. Lakes are quiet; drain river water and confirm its loop fades out.
- [ ] Walk/run on grass, dirt, stone, wood, sand and brick with two players; break/place each material.
- [ ] Enter water for a splash; land from a fall for a thud.
- [ ] Hear occasional cow calls plus hurt/death; dragon wingbeats, attack roar, hurt/death and greater hearing range.
- [ ] Adjust master/music/ambience/effects independently, including zero; relog under each player name to verify saved volumes.
