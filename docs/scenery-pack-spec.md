<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Scenery pack spec (schema 1)

This is the contract between ForgeCoach's board scenery and an **art pack**: a
folder of images, sprite sheets and short loops, with one `scenery.json`
manifest, served from your own machine. ForgeCoach ships only the engine and a
built-in procedural fallback. Packs are never committed to this repository.

- Engine: `src/ambience/` (model, events, manifest validator, loader), `src/ui/ambience/` (renderer, preview page).
- Preview: open ForgeCoach at `#ambience` (no engine needed).
- The validator is strict: what it refuses is listed on `#ambience`, with the path of the field and why.

## 1. How the scenery works

Each player's side of the board has a **strip** along its outer edge: the
bottom of your battlefield, and the far (top) edge of the opponent's, drawn
upright as a distant vista that dissolves at both ends. The strip sits *behind* the
cards. It never takes clicks and never covers cards, life, prompts or any
other game information.

- **Biomes.** There are six: `island`, `swamp`, `mountain`, `forest`, `plains`, `wastes`.
- **Classifying a land.**
  - Basic land types on the type line come first: `Land — Island Swamp` gives ½ island and ½ swamp.
  - Otherwise, the colours the land taps for, when it makes one or two colours.
  - Anything else goes to `wastes`: colourless, unknown, or three or more colours.
- **Slots.** A biome claims the next slot, left to right, the first time one of its lands appears. It keeps that slot for the rest of the game. If all its lands leave, it shows a withered (greyed) stage 1.
- **Stages.** A biome's land count sets its stage:

  | Lands | Stage |
  | --- | --- |
  | 1 | 1 |
  | 2–3 | 2 |
  | 4–5 | 3 |
  | 6+ | 4 |

  A pack may change these thresholds and may define up to 6 stages. A slot past a pack's last stage shows that last stage.
- **Width.** Slot width grows a little with stage (+18% per stage), times the biome's `slot.weight`.
- **Bloom.** When a stage adds layers, the new layers *bloom in*. A layer whose `id` is also in the previous stage stays where it is and does not bloom again. Every land arrival also flashes its slot with a soft glow.
- **Events.** The scenery engine also emits *creature entered* (with the creature's colours), *attack declared* and *damage dealt*. Today these draw simple placeholder effects. A later schema will let packs supply art for them.
- **Hidden information.** Only the viewing seat's redacted battlefield is read, so the scenery never shows anything the board does not.

## 2. Manifest format

`scenery.json` at the pack's root. Every field below is optional unless
marked **required**. Unknown fields are ignored, so you may add notes or
fields for your own tools.

### Top level

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `schema` | `1` | — | **Required.** |
| `name` | string ≤ 80 | "Untitled pack" | Shown on `#ambience`. |
| `author`, `license` | string ≤ 80 | — | Shown on `#ambience`. |
| `strip` | object | see below | Applies to the whole strip. |
| `stageThresholds` | 1–6 increasing numbers, 0.5–40 | `[1, 2, 4, 6]` | Land weight at which stage 1, 2, … begins. |
| `biomes` | object | — | **Required.** Keyed by biome name, with at least one usable biome. Biomes left out use the built-in scene. |

### `strip`

| Field | Range | Default | Notes |
| --- | --- | --- | --- |
| `heightRatio` | 0.08–0.6 | 0.46 | The strip's height as a fraction of the battlefield's height… |
| `minHeightPx`, `maxHeightPx` | 24–400 / 24–600 | 64 / 280 | …clamped to these pixel bounds. |
| `seamPx` | 0–256 | 120 | The width of the gradient mask where two biomes meet (capped at 14% of the viewport width on phones). |
| `fadeRatio` | 0–1 | 0.38 | How much of the strip, measured from its inner edge (towards the board's centre), fades into the board. |
| `order` | `arrival` \| `preference` | `arrival` | `preference` puts biomes with `slot.prefer: "left"` first and `"right"` last, keeping arrival order within each group. |

### `biomes.<name>`

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `label` | string ≤ 60 | — | |
| `slot.prefer` | `any` \| `left` \| `right` | `any` | Used only with `strip.order: "preference"`. |
| `slot.weight` | 0.5–3 | 1 | Relative width. |
| `stages` | 1–6 stage objects | — | **Required.** `stages[0]` is stage 1. |
| `bloom.kind` | `rise` \| `fade` \| `grow` \| `wipe` \| `none` | `rise` | How new layers arrive. |
| `bloom.durationMs` | 0–5000 | 1400 | |
| `bloom.staggerMs` | 0–1000 | 120 | The delay between layers, back to front. |
| `idle.kind` | `sway` \| `drift` \| `breathe` \| `none` | `drift` | A gentle loop on layers with `idle: true`. |
| `idle.periodMs` | 1000–60000 | 9000 | One swing (the loop alternates). |
| `idle.amplitude` | 0–1 | 0.3 | Scaled by each layer's `depth`. At 1, `sway` is ±2°, `drift` is ±3% and `breathe` is +4%. |

### A stage

A stage is `{ "layers": [ … ] }`, with at most **8 layers**; any extra layers
are dropped. Each stage lists its *complete* set of layers. To keep a layer
across stages, repeat it with the same `id`.

### A layer

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `id` | `[A-Za-z0-9][\w.-]*`, ≤ 40 | — | **Required**, and unique within the stage. |
| `kind` | `image` \| `sprite` \| `video` | — | **Required.** |
| `src` | URL | — | **Required.** For `image` and `sprite`: `.webp` `.avif` `.png` `.jpg` `.svg`. For `video`: `.webm` or `.mp4`. |
| `src2x` | URL | — | `image` / `sprite`: the 2x file (used through `srcset`). |
| `fallback` | URL (`.mp4`) | — | `video`: for browsers without webm alpha (Safari). |
| `poster` | URL (image) | — | `video` / `sprite`: the still shown with reduced motion. |
| `frames`, `cols`, `rows`, `fps` | 1–120, 1–32, 1–32, 1–60 | — | `sprite` only, and required for it. `frames` must equal `cols × rows`. Frames run left to right, then top to bottom. |
| `depth` | 0–1 | 0.5 | Parallax factor: 0 is far and barely moves, 1 is near. Scales the idle motion and how far the layer travels when it blooms. |
| `blend` | `normal` `screen` `multiply` `overlay` `lighten` `darken` `soft-light` `color-dodge` `plus-lighter` | `normal` | CSS `mix-blend-mode`. |
| `z` | −100–100 (whole) | 0 | Stacking within the slot; higher is nearer. |
| `opacity` | 0–1 | 1 | |
| `x`, `y` | −1–1 | 0 | The box's left edge and bottom edge, as fractions of the slot's width and the strip's height. |
| `w`, `h` | 0.01–2 | 1 | The box's size, in the same fractions. |
| `fit` | `cover` \| `contain` \| `fill` | `cover` | `object-fit` within the box. |
| `idle` | boolean | true | Whether the layer takes part in the biome's idle loop. |

**URLs** are either relative, resolved against the folder holding
`scenery.json`, or absolute `http://` / `https://`. Refused:
- any other scheme (`data:`, `javascript:`, `blob:`, `file:`);
- protocol-relative `//host`;
- user names or passwords in the URL;
- spaces, quotes, brackets, backslashes or control characters;
- anything over 512 characters.

**Out-of-range numbers** fall back to their defaults, with a warning. A layer
with a bad URL or sprite grid is dropped. A biome with no usable layer falls
back to the built-in scene. A manifest over 256 KB is refused.

### Worked example: the island biome

<!-- example-manifest -->
```json
{
  "schema": 1,
  "name": "Justin's tidewater",
  "author": "Justin",
  "license": "private, not for redistribution",
  "strip": { "heightRatio": 0.46, "minHeightPx": 64, "maxHeightPx": 280, "seamPx": 120, "fadeRatio": 0.38, "order": "arrival" },
  "stageThresholds": [1, 2, 4, 6],
  "biomes": {
    "island": {
      "label": "Tidewater isles",
      "slot": { "prefer": "left", "weight": 1.1 },
      "bloom": { "kind": "rise", "durationMs": 1600, "staggerMs": 140 },
      "idle": { "kind": "drift", "periodMs": 9000, "amplitude": 0.35 },
      "stages": [
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s1-sky.webp", "src2x": "island/s1-sky@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 }
          ]
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s1-sky.webp", "src2x": "island/s1-sky@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 },
            { "id": "shore", "kind": "image", "src": "island/s2-shore.webp", "src2x": "island/s2-shore@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.7, "h": 0.4, "fit": "contain" }
          ]
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s3-sky-sun.webp", "src2x": "island/s3-sky-sun@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 },
            { "id": "shore", "kind": "image", "src": "island/s2-shore.webp", "src2x": "island/s2-shore@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.7, "h": 0.4, "fit": "contain" },
            { "id": "palms", "kind": "sprite", "src": "island/s3-palms-sheet.webp", "poster": "island/s3-palms.webp", "frames": 24, "cols": 6, "rows": 4, "fps": 12, "depth": 1, "z": 30, "x": 0.02, "y": 0, "w": 0.4, "h": 0.95, "fit": "contain", "idle": false }
          ]
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s3-sky-sun.webp", "src2x": "island/s3-sky-sun@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 },
            { "id": "lagoon", "kind": "image", "src": "island/s4-shore-lagoon.webp", "src2x": "island/s4-shore-lagoon@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.75, "h": 0.42, "fit": "contain" },
            { "id": "palms", "kind": "sprite", "src": "island/s3-palms-sheet.webp", "poster": "island/s3-palms.webp", "frames": 24, "cols": 6, "rows": 4, "fps": 12, "depth": 1, "z": 30, "x": 0.02, "y": 0, "w": 0.4, "h": 0.95, "fit": "contain", "idle": false },
            { "id": "glints", "kind": "image", "src": "island/s4-glints.webp", "blend": "screen", "opacity": 0.8, "depth": 0.4, "z": 15, "y": 0, "h": 0.45 },
            { "id": "gulls", "kind": "video", "src": "island/s4-gulls.webm", "fallback": "island/s4-gulls.mp4", "depth": 0.5, "z": 25, "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4, "fit": "contain" }
          ]
        }
      ]
    }
  }
}
```

`src/ambience/manifest.test.ts` validates this exact block. If you change it,
it must stay error- and warning-free.

## 3. Files and budgets

| What | Format | Size |
| --- | --- | --- |
| Backdrops (sky, sea, ground bands) | WebP (quality 80–85) or AVIF | 2048 × 512 at 1x, 4096 × 1024 as `src2x`. Wide and short; `cover` crops the sides of narrow slots, so keep the interest in the middle 60%. |
| Objects (palms, trees, rocks) | WebP or AVIF with alpha | Sized to their box at 2x: a palm 0.95 strip-high is about 480 px tall at 1x. |
| Sprite sheets | WebP with alpha, frames in a grid | Each frame at the layer's 1x box size; the whole sheet ≤ 4096 px on either side; ≤ 48 frames is plenty (12 fps × 4 s). |
| Loops | WebM (VP9 with alpha, `yuva420p`), plus an MP4 (H.264) `fallback` | 2–6 s, seamless, ≤ 1280 px wide, 24–30 fps, no audio track. |
| Posters | WebP | The first frame of the loop or sprite. |

Budgets per biome:
- **≤ 6 MB** in total;
- **≤ 1.5 MB for stage 1**, which is preloaded before the scenery shows;
- **≤ 8 layers** per stage;
- **≤ 2 moving layers** (sprite or video) per stage. Videos are the heaviest thing on a phone, so prefer one loop per biome.

The whole pack should stay ≤ 30 MB.

A narrow slot is about 130 px wide on a phone; a lone slot on a desktop can be
1280 px or more. Art must read at both sizes.

## 4. Layers, transparency, seams, stages

- **Naming.** Use `<biome>/<stage>-<what>.<ext>`, e.g. `island/s3-palms-sheet.webp`, and keep layer `id`s short and stable (`sky`, `sea`, `shore`, `palms`).
- **Transparency.** Only the sky/backdrop layer (lowest `z`) is opaque. Every other layer has real alpha: no baked-in background colour and no matte fringes. Pre-multiplied edges look best over the dark board.
- **Edges.** Your strip fades into the board along its top (`fadeRatio`). The opponent's strip, on the board's far edge, fades at both its top (the first 28%) and its bottom (the last 38%), so the middle of the picture carries it there: keep the horizon and the main shapes between about 30% and 60% of the height. Keep the ground at the bottom of your art and the sky at the top, and avoid hard horizontal lines in the fade zones.
- **Seams.** Neighbouring biomes overlap by `seamPx`, and the right-hand slot fades in over that width. Leave the outer `seamPx` of each side free of focal objects: atmosphere, water or ground that can melt into a neighbour. Match horizon heights roughly across biomes (about 55–65% up the strip) so seams read as one landscape.
- **Readability.** Cards, land chips and labels sit on top of the strip. Keep contrast and detail low in the lowest third, where lands are drawn; save bright accents for the upper middle. Never put text or symbols in the art.
- **Stages.**

  | Stage | What it shows |
  | --- | --- |
  | 1 | The place itself: sky, a ground or water band, one quiet idle motion. |
  | 2 | A defining feature (a shoreline, reeds, a near ridge, the first trees). |
  | 3 | Life and light (palms, a sun or moon, an ember glow, light shafts). |
  | 4 | The paradise version: the richest composition, at most two moving layers. |

  Later stages should look like the same place grown, not a different picture. Reuse ids for layers that stay.
- **Motion.** Idle motion is slow and small (periods of 6–12 s). Nothing should flash or strobe. The bloom is the only fast moment.
- **Reduced motion.** With `prefers-reduced-motion` (or Settings → Motion → Stills only), the strip shows stills only:
  - posters for videos and sprites;
  - no idle loops, no bloom, no flashes.

  Every moving layer therefore needs a poster that looks complete on its own.

## 5. Serving a pack locally

The page fetches `scenery.json` with CORS, so serve the folder with CORS on:

```bash
npx http-server ./pack --cors -p 8650 -c-1
```

`-c-1` turns caching off while you iterate. Then use the pack URL
`http://127.0.0.1:8650/` (the folder) or `http://127.0.0.1:8650/scenery.json`.

ForgeCoach on `https://jalirkan.github.io/ForgeCoach/` may fetch from
`http://127.0.0.1`: browsers treat loopback as potentially trustworthy, so
it is not blocked as mixed content. The coach helper (`127.0.0.1:8643`)
already works this way. A LAN address such as `http://192.168.x.x` would be
blocked from the https page; use a local dev build (`npm run dev`) or serve
the pack over https for that.

## 6. Testing on `#ambience`

1. Open `#ambience` (e.g. `https://jalirkan.github.io/ForgeCoach/#ambience`, or `http://localhost:5173/#ambience` from `npm run dev`).
2. Enter the pack URL and press **Load**. You can also open `#ambience?scenery=http://127.0.0.1:8650/` to load it at once. The page lists:
   - every error (why the pack was refused);
   - every warning (what was dropped or reset to a default), with the path of each field.
3. Play lands for either side with the buttons, or press **Demo sequence**. **Undo** and **Reset** step back.
4. Drag **Stage** to see every stage of every claimed biome without playing more lands.
5. Switch **Motion** to *Stills only* to check posters and reduced motion.
6. **Creature enters** and **Attack** fire the placeholder effects. The event list shows what the engine emitted.
7. **Check a manifest by pasting it** validates JSON as you type, before any file is served.
8. **Use on the board** saves the choice. Settings → Board scenery does the same, and so does `?scenery=<url>` on any ForgeCoach URL. The play board and the replay board (`#sample=human-auto-42`) then show the pack.
9. Press **Reload** after changing files. The preview loads the pack fresh each time; the board caches it per page load.

If a pack fails on the board, ForgeCoach falls back to the built-in scenery.
It logs why in the console (`ForgeCoach scenery: …`); dev builds also show it
in the board's corner.

## 7. Content rules

- **Anything that might ever be shared must be original art.** This covers this repository, the public site, screenshots and published packs. That means your own work, or generated or rendered work made from your own prompts and scenes, with no copied artwork.
- **Nothing derived from or resembling someone else's IP goes into ForgeCoach.** No card art, set symbols, logos, named planes or characters, and no imitation of a recognisable artist's work. A pack like that may live on your own machine, for your own play, served from `127.0.0.1`. It is never committed here, never uploaded, and never put in a published URL.
- **Packs are never committed to this repository.** That includes original ones. This repo ships only the engine, the procedural fallback and this spec. Keep packs in their own folder or repository.
- **No text, faces of real people, or symbols in the art.**
