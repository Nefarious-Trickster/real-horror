# VIGIL

*Sit with her until dawn.*

A first-person horror game that runs in the browser (Three.js + Vite).

Your mother is dead. Her will asks one thing of you: that you sit vigil over her body,
alone, in her farmhouse, from midnight until dawn. Keep the candles lit. Keep the doors
shut. If you hear her call for you, don't come.

Something lived in her. Now it's out, and it is looking for a new coat.

## The one rule

**It cannot move while it is seen**, but only when it's seen *in the light*. In the dark
your eyes don't count. Your flashlight drains, and it flickers when the thing is near.
Every time you look away, it comes closer. You will never see it move.

Hold it in the beam too long and your nerve gives out. If it reaches you
in the dark, it's over. Wardrobes can hide you, if you can hold your breath.

## Play

```bash
npm install
```

```bash
npm run dev
```

Open the URL it prints. **Use headphones, turn the lights off and go fullscreen.** A desktop GPU is
recommended; resolution adapts automatically.

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Shift | Run (loud) |
| C | Crouch (quiet) |
| F | Flashlight |
| E | Interact / read |
| Space | Hold breath (while hiding) |
| Tab / Q | Show the current objective |
| Esc | Pause and settings (sensitivity, volume, brightness, subtitles) |

The game takes about 20–30 minutes and has checkpoints once the hunt begins.

`npm run build` writes a static site to `dist/`. It uses relative paths, so it can be hosted anywhere.

## How it's made

- **Engine** (`src/`): custom first-person controller with OBB collision and walkable ramps.
  - Post-processing: a display-space horror grade (grain, aberration, dread warp, tearing).
  - Flashlight: a light-cookie spotlight with shadows and fake bounce light.
  - Lightning: shadow-casting light thrown through the nearest window.
  - Audio: HRTF spatial sound with wall occlusion and per-room reverb.
- **The house** (`src/world/house.js`): generated from a layout description. It has two storeys, a cellar and an attic, and includes doors, windows, trim, stairs and a navigation graph.
- **The entity** (`src/game/entity.js`):
  - Observation: a view-frustum, occlusion and illumination test.
  - Movement: it paths through the house, but only commits a move to a spot you can't see. It opens doors, hunts you while you hide, and lunges in the dark.
- **The night** (`src/game/director.js`): a cancellable async script with nine stages, checkpoints and ambient events.
- **Assets**: see [CREDITS.md](CREDITS.md).
  - Furniture and textures: CC0 from Poly Haven.
  - The creature: generated procedurally as a signed-distance-field body, polygonised, skinned and posed (`tools/entity/`).
  - Audio: 102 sounds synthesised offline (`tools/audio/`). The mother's voice is public-domain TTS, processed.

`tools/test/` has headless Playwright scripts: screenshots, a perf probe, and an automated full playthrough
(`node tools/test/playthrough.cjs <outdir> <url> [checkpoint]`).

See [DESIGN.md](DESIGN.md) for the full design document.
