# Assets

| File | Source | Author | License |
| --- | --- | --- | --- |
| `public/audio/lobby.ogg` | [Sunset Walk / Ambient / Quiet / Sweet / Loop](https://opengameart.org/content/sunset-walk-ambient-quiet-sweet-loop), [original OGG](https://opengameart.org/sites/default/files/SunsetWalk.ogg) | Kilua Boy (KiluaBoy) | [CC0 1.0 / public domain](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/img/lobby.png` | Flag World real Three.js renderer, `public/capture.html`; seed 1, Large, two teams, golden hour (`dayTime = 0.485`) | Project-generated | Project license |
| `public/textures/torch.svg`, torch atlas tile | Original vector icon and procedural pixel drawing | Project-generated | Project license |

The lobby track was downloaded and re-encoded as Vorbis OGG, with FFmpeg
`loudnorm=I=-20:TP=-2:LRA=7` at 44.1 kHz and quality 4. Playback loops the complete track.
The in-game music slider controls playback volume independently of the encoded
normalization. The source page explicitly labels this track CC0.

To regenerate the image, run the server, install Playwright in a tooling
location (no client build step), install its Chromium browser, then run:

```
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/capture-lobby.js
```

Camera and output dimensions are controlled by `LOBBY_CAPTURE` in
`shared/config.js`. The local creative host's “Capture lobby background” command
instead downloads the current view as `lobby.png`; copy it to `public/img/lobby.png`.


## In-game audio

All files below are included; no manual downloads are needed. Every source page
explicitly offers CC0 1.0. Freesound files use the publicly available high-quality
preview of the same CC0 recording, without requiring a Freesound login. Archive
member names and edits are recorded in `scripts/audio-sources.json`.

| File | Source page and download | Author | License |
| --- | --- | --- | --- |
| `public/audio/game/wind.ogg` | [Source](https://opengameart.org/content/wind1), [download](https://opengameart.org/sites/default/files/wind1.wav) | Luke.RUSTLTD | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/birds.ogg` | [Source](https://opengameart.org/content/bird-chirping-sounds), [download](https://opengameart.org/sites/default/files/birdchirping071414.wav) | syncopika | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/crickets.ogg` | [Source](https://freesound.org/people/ellie.vanderlip/sounds/704381/), [download](https://cdn.freesound.org/previews/704/704381_8525021-hq.mp3) | ellie.vanderlip | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/river.ogg` | [Source](https://freesound.org/people/deadrobotmusic/sounds/687056/), [download](https://cdn.freesound.org/previews/687/687056_11532701-hq.mp3) | deadrobotmusic | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/waterfall.ogg` | [Source](https://freesound.org/people/A.Deathy/sounds/44880/), [download](https://cdn.freesound.org/previews/44/44880_227630-hq.mp3) | A.Deathy | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/fortress.ogg` | [Source](https://opengameart.org/content/ghostly-humming), [download](https://opengameart.org/sites/default/files/ghostly_humming.ogg) | Nocturnal_Vanguard / AuraVoice | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-grass.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/footstep_grass_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-stone.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/footstep_concrete_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-wood.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/footstep_wood_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-dirt.ogg` | [Source](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud), [download](https://opengameart.org/sites/default/files/%5Bkdd%5DDifferentSteps_0.zip); `mud02.ogg` | TinyWorlds / pdsounds.org | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-brick.ogg` | [Source](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud), [download](https://opengameart.org/sites/default/files/%5Bkdd%5DDifferentSteps_0.zip); `stone01.ogg` | TinyWorlds / pdsounds.org | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/step-sand.ogg` | [Source](https://opengameart.org/content/water-splash-and-sand-footsteps), [download](https://opengameart.org/sites/default/files/sand_footsteps_0.mp3) | Peludo | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-grass.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_heavy_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-grass.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_medium_002.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-dirt.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_medium_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-dirt.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_medium_003.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-stone.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactMining_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-stone.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactGeneric_light_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-wood.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactWood_heavy_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-wood.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactWood_light_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-sand.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_medium_001.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-sand.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactSoft_medium_004.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/break-brick.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactMining_002.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/place-brick.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactGeneric_light_002.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/landing.ogg` | [Source](https://kenney.nl/assets/impact-sounds), [download](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); `Audio/impactPunch_heavy_000.ogg` | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/splash.ogg` | [Source](https://opengameart.org/content/water-splash-and-sand-footsteps), [download](https://opengameart.org/sites/default/files/splash1_0.wav) | Peludo | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/cow-moo.ogg` | [Source](https://freesound.org/people/JarredGibb/sounds/233128/), [download](https://cdn.freesound.org/previews/233/233128_4056007-hq.mp3) | JarredGibb | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/cow-hurt.ogg` | [Source](https://freesound.org/people/JarredGibb/sounds/233128/), [download](https://cdn.freesound.org/previews/233/233128_4056007-hq.mp3) | JarredGibb | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/cow-death.ogg` | [Source](https://freesound.org/people/JarredGibb/sounds/233128/), [download](https://cdn.freesound.org/previews/233/233128_4056007-hq.mp3) | JarredGibb | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/dragon-wing.ogg` | [Source](https://opengameart.org/content/dragon-flap-0), [download](https://opengameart.org/sites/default/files/dragonflap.wav) | VishwaJai | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/dragon-roar.ogg` | [Source](https://opengameart.org/content/animal-or-beast-sounds), [download](https://opengameart.org/sites/default/files/beast_or_animal.7z); `Beast or Animal/Growl.wav` | pauliuw | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/dragon-hurt.ogg` | [Source](https://opengameart.org/content/animal-or-beast-sounds), [download](https://opengameart.org/sites/default/files/beast_or_animal.7z); `Beast or Animal/Growl 1.wav` | pauliuw | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/dragon-death.ogg` | [Source](https://opengameart.org/content/animal-or-beast-sounds), [download](https://opengameart.org/sites/default/files/beast_or_animal.7z); `Beast or Animal/Growl 2.wav` | pauliuw | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The existing lobby track is unchanged. Day/night songs were removed at the
player's request; wind, wildlife, water and the louder fortress hum remain.

`prepare-audio.py` converts recordings to Vorbis OGG at 44.1 kHz / quality 4,
using FFmpeg loudness normalization with the levels in `AUDIO` in
`shared/config.js`. Short effects also receive RMS normalization. Final samples
are peak-bounded with extra Vorbis headroom for the -2 dB true peak target. Effects are mono for positioning;
ambience retains stereo. Loops crossfade the original tail into the head
and rotate the resulting samples so there is no silent gap or discontinuity.
The fortress hum is a low-pass-filtered vocal
recording; it plays only in the underground goblin structure boxes, never caves.
Cow hurt/death sounds are shortened/pitched edits of the moo recording, rather
than recordings of an animal being harmed. Dragon calls are three distinct beast
recordings. Existing procedural mining taps, eel effects and missing-file fallbacks
are retained.

To regenerate (optional tooling, no game build step):

```sh
python3 scripts/prepare-audio.py
```

Requires FFmpeg on PATH (or `FLAG_FFMPEG=/path/to/ffmpeg`) and Python 3;
`py7zr` is needed only to unpack the CC0 beast archive. Downloads cache under
`/tmp/flag-audio-originals` (`FLAG_AUDIO_CACHE` overrides this). If any future
source becomes unavailable, the script prints the missing file and the table
above provides its download URL; place converted output at the listed game path.

## Monkey and storm sounds

All included; no manual downloads are needed. Each source page is filtered and
labelled CC0 on Freesound; the files use the public high-quality preview of the
same recording. Trims and edits are in `scripts/audio-sources.json`
(`atrim` range, 20 ms fade in, 200 ms fade out). The monkey sounds are pitched
down there (`asetrate`, about 0.7–0.8x) so the Ancient Monkeys sound huge; all
are mono effects normalized like the other effects. Regenerate only these with
`FLAG_AUDIO_ONLY=monkey- python3 scripts/prepare-audio.py` (and
`FLAG_AUDIO_ONLY=thunder`).

| File | Source page and download | Author | License |
| --- | --- | --- | --- |
| `public/audio/game/monkey-grunt-1.ogg`, `monkey-grunt-2.ogg`, `monkey-grunt-3.ogg` | [CaveGorilla.wav](https://freesound.org/people/zatar/sounds/370369/), [download](https://cdn.freesound.org/previews/370/370369_5338586-hq.mp3); 0.83–3.03 s, 4.34–5.93 s, 6.2–8.02 s | zatar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/monkey-huff.ogg` | [gorilla audio.aif](https://freesound.org/people/kfledman/sounds/205891/), [download](https://cdn.freesound.org/previews/205/205891_384701-hq.mp3); 0.86–1.4 s | kfledman | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/monkey-rumble.ogg` | [G-Gorilla_1-2.aif](https://freesound.org/people/Ihopethisworks/sounds/178188/), [download](https://cdn.freesound.org/previews/178/178188_3085891-hq.mp3); 4.62–8.2 s | Ihopethisworks | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/monkey-chest-beat.ogg` | [Chest banging.wav](https://freesound.org/people/shutup_outcast/sounds/367821/), [download](https://cdn.freesound.org/previews/367/367821_6104883-hq.mp3); 0–2.6 s | shutup_outcast | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/monkey-roar.ogg` | [Gorillaschrei.wav](https://freesound.org/people/J0ck0/sounds/397054/), [download](https://cdn.freesound.org/previews/397/397054_2884295-hq.mp3); 0–1.57 s | J0ck0 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/game/thunder.ogg` | [Short_Thunder_Mid.wav](https://freesound.org/people/SholeColtis/sounds/683421/), [download](https://cdn.freesound.org/previews/683/683421_14670263-hq.mp3); 0–4.6 s, not pitched | SholeColtis | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The Wise Monkeys' voices are the browser's built-in speech synthesis (Web
Speech API); no voice recordings are shipped.
