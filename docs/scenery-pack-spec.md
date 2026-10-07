<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Scenery pack spec (schema 1, version 1.5)

This is the contract between ForgeCoach's board scenery and an **art pack**: a
folder of images, sprite sheets and short loops, with one `scenery.json`
manifest, served from your own machine. ForgeCoach ships only the engine and a
built-in procedural fallback. Packs are never committed to this repository.

- Engine: `src/ambience/` (model, events, manifest validator, loader), `src/ui/ambience/` (renderer, preview page).
- Preview: open ForgeCoach at `#ambience` (no engine needed).
- The validator is strict: what it refuses is listed on `#ambience`, with the path of the field and why.

**Versions.** The `schema` number stays `1`; minor versions only add optional
fields, so a pack written for an earlier version keeps working unchanged.

| Version | What it added |
| --- | --- |
| 1.0 | Biomes, stages, layers (image, sprite, video), bloom, idle, strip. |
| 1.1 | Sprite `fit` and `anchor`; the moving-layer budget warning; Local Network Access notes (§5). |
| 1.2 | Optional one-shot **`effects`** (§2, *Effects*): creature enters, attack, damage to a player or a creature, landfall and stage up, for the whole pack or per biome; their budgets (§3) and reduced-motion behaviour (§4). An optional top-level `spec` field. A pack may now have effects and no stage art. |
| 1.3 | Optional **board accents** (§2, *Board accents*): per biome and stage, an `overlay` list of corner and edge pieces drawn in the player's area outside the strip, with `overlayMode` (`replace` / `add`) across stages; their budgets (§3); the rendering rules (beneath the cards, small widths, reduced motion, Settings → Board accents). A pack may have accents and no stage art. |
| 1.4 | One more accent piece, the **full-area** piece (§2, *Full-area accents*): `anchor: "area"`, one transparent picture across the whole player area, beneath the strip and the cards, with `fit`, an optional `safe` rect or `position`, `minWidthPx`; at most one per stage; its own budget (§3). Every other piece and every 1.0–1.3 pack is unchanged. |
| 1.5 | The **half board** (§2, *The half board*): the scenery fills each player's whole half of the board (Settings → Fill each side, on by default), split side by side in proportion to their lands, each biome at its own stage, both halves upright with a mist band along the centre line, and a soft dark scrim under the card rows. Optional per-stage **`half`** pictures (one opaque picture per stage, sized for a half, with `focal` and `safe` for the crop) and a top-level **`half`** layout (`seamRatio`, `minShare`, `mist`); their budget (§3). A 1.0–1.4 pack fills the half with its strip art, cover-cropped. |

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
- **Events.** The scenery engine also emits *creature entered* (with the creature's colours), *attack declared* and *damage dealt* (to a player or to a creature). Each plays a short one-shot **effect**: the pack's own (§2, *Effects*), or else a built-in placeholder.
- **Accents (1.3).** Besides the strip, each player's area can carry a few **accents**: pictures in its corners and bands along its edges (vines creeping in as the forest grows, frost and spray for islands, ash for mountains). They grow with the same stages, sit beneath every card and control, and are a separate setting (Settings → Board accents, on whenever the scenery is on).
- **Full-area accents (1.4).** One more kind of accent: a single transparent picture over the whole player area, for sparse marks scattered beneath the cards (vines, dead branches, grass, sand and shells, lava) that thicken with the stage. It sits under the strip as well as under the cards, and the same setting covers it.
- **The half board (1.5).** With Settings → Fill each side (on by default), the strip grows into the player's whole half of the board: the same slots, side by side in proportion to the lands, each at its own stage, the cards on top, a soft dark band under each card row. A pack's `half` pictures are drawn where it has them; otherwise its strip art (or the built-in scene) is cover-cropped to the half. Off, the board shows the strip as in 1.4.
- **Hidden information.** Only the viewing seat's redacted battlefield is read, so the scenery never shows anything the board does not.

## 2. Manifest format

`scenery.json` at the pack's root. Every field below is optional unless
marked **required**. Unknown fields are ignored, so you may add notes or
fields for your own tools. Two kinds of unknown *key* do get a warning, since a
typo there would silently do nothing: a key under `biomes` that is not a biome,
and a key under `effects` that is not an effect event.

### Top level

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `schema` | `1` | — | **Required.** |
| `spec` | `"1.4"` | — | The version the pack was written for. Informational; a newer minor version than this ForgeCoach reads gets a warning (its new fields are ignored). |
| `name` | string ≤ 80 | "Untitled pack" | Shown on `#ambience`. |
| `author`, `license` | string ≤ 80 | — | Shown on `#ambience`. |
| `strip` | object | see below | Applies to the whole strip. |
| `stageThresholds` | 1–6 increasing numbers, 0.5–40 | `[1, 2, 4, 6]` | Land weight at which stage 1, 2, … begins. |
| `biomes` | object | — | **Required.** Keyed by biome name, with at least one usable biome (or at least one effect, or one accent piece). Biomes left out use the built-in scene. |
| `effects` | object | — | 1.2. One-shot effects for every biome, and `maxConcurrent`. See *Effects*. |

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
| `effects` | object | — | 1.2. This biome's own effects; they win over the top-level ones. A biome may have `effects` and no `stages`: it then keeps the built-in scene and plays your effects. |

### A stage

A stage is `{ "layers": [ … ] }`, with at most **8 layers**; any extra layers
are dropped. Each stage lists its *complete* set of layers. To keep a layer
across stages, repeat it with the same `id`.

1.3: a stage may also have an `overlay` list and an `overlayMode`; see
*Board accents* below. A biome whose stages all have `overlay` and none has
`layers` keeps the built-in scene in its strip and draws your accents.

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
| `fit` | `cover` \| `contain` \| `fill` | `cover` | How the picture fills the box, as CSS `object-fit`. Applies to every kind: a sprite's frame window keeps the frame's natural aspect (sheet width ÷ `cols` by sheet height ÷ `rows`) with `contain` and `cover`, and only `fill` stretches it. |
| `anchor` | `center` `top` `bottom` `left` `right` `top-left` `top-right` `bottom-left` `bottom-right` | `center` | Where the picture sits in its box with `contain` (or which part is kept with `cover`), as CSS `object-position`: `bottom` is `50% 100%`, `bottom-left` is `0% 100%`. Ignored with `fill`. Use `bottom` for objects that stand on the ground, such as palms in a narrow box, so they don't float. |
| `idle` | boolean | true | Whether the layer takes part in the biome's idle loop. |

**URLs** are either relative, resolved against the folder holding
`scenery.json`, or absolute `http://` / `https://`. Refused:
- any other scheme (`data:`, `javascript:`, `blob:`, `file:`);
- protocol-relative `//host`;
- user names or passwords in the URL;
- spaces, quotes, brackets, backslashes or control characters;
- anything over 512 characters.

**Out-of-range numbers** and unknown names (`fit`, `anchor`, `blend`, …) fall back to their defaults, with a warning. A layer
with a bad URL or sprite grid is dropped. A biome with no usable layer falls
back to the built-in scene. A manifest over 256 KB is refused. A stage
with more than 2 moving layers (sprites and videos) gets a warning, as it is
over budget (§3), but its layers are kept.

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
            { "id": "shore", "kind": "image", "src": "island/s2-shore.webp", "src2x": "island/s2-shore@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.7, "h": 0.4, "fit": "contain", "anchor": "bottom-left" }
          ]
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s3-sky-sun.webp", "src2x": "island/s3-sky-sun@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 },
            { "id": "shore", "kind": "image", "src": "island/s2-shore.webp", "src2x": "island/s2-shore@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.7, "h": 0.4, "fit": "contain", "anchor": "bottom-left" },
            { "id": "palms", "kind": "sprite", "src": "island/s3-palms-sheet.webp", "poster": "island/s3-palms.webp", "frames": 24, "cols": 6, "rows": 4, "fps": 12, "depth": 1, "z": 30, "x": 0.02, "y": 0, "w": 0.4, "h": 0.95, "fit": "contain", "anchor": "bottom", "idle": false }
          ]
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s3-sky-sun.webp", "src2x": "island/s3-sky-sun@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 },
            { "id": "lagoon", "kind": "image", "src": "island/s4-shore-lagoon.webp", "src2x": "island/s4-shore-lagoon@2x.webp", "depth": 0.7, "z": 20, "x": 0, "y": 0, "w": 0.75, "h": 0.42, "fit": "contain", "anchor": "bottom-left" },
            { "id": "palms", "kind": "sprite", "src": "island/s3-palms-sheet.webp", "poster": "island/s3-palms.webp", "frames": 24, "cols": 6, "rows": 4, "fps": 12, "depth": 1, "z": 30, "x": 0.02, "y": 0, "w": 0.4, "h": 0.95, "fit": "contain", "anchor": "bottom", "idle": false },
            { "id": "glints", "kind": "image", "src": "island/s4-glints.webp", "blend": "screen", "opacity": 0.8, "depth": 0.4, "z": 15, "y": 0, "h": 0.45 },
            { "id": "gulls", "kind": "image", "src": "island/s4-gulls.webp", "src2x": "island/s4-gulls@2x.webp", "depth": 0.5, "z": 25, "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4, "fit": "contain", "anchor": "top" }
          ]
        }
      ]
    }
  }
}
```

Stage 4 has two moving layers, the sea loop and the palms sprite, which is the
budget (§3); the gulls are a still that drifts with the idle loop. The palms
sprite is `contain` in a narrow box (the frame is taller than it is wide), so
`anchor: "bottom"` stands it on the shore.

`src/ambience/manifest.test.ts` validates this exact block. If you change it,
it must stay error- and warning-free.

### Effects (1.2)

Effects are short one-shots that play on a player's strip when something
happens on the board. A pack may give them for every biome (top-level
`effects`), per biome (`biomes.<name>.effects`, which wins), or not at all.
Any event the pack leaves out plays ForgeCoach's built-in placeholder.

**Events.**

| Event | When | Plays on | Biome used | Default `at` | Built-in placeholder |
| --- | --- | --- | --- | --- | --- |
| `creatureEnter` | A creature the viewer can see enters the battlefield. | Its controller's strip. | The creature's colour's biome (W plains, U island, B swamp, R mountain, G forest; colourless wastes) if that player has the slot, else their largest biome. | `card` | `shimmer`: a soft rising shimmer in the biome's colour. |
| `attack` | Attackers are declared (one effect per attacking player, however many bands). | The attacker's strip. | The attacker's largest biome. | `slot` | `sweep`: a crescent driving toward the other side. |
| `damagePlayer` | A player is dealt damage (merged per player per frame). | That player's strip. | Their largest biome. | `strip` | `flash`: a red-gold flash from the strip's ground. |
| `damageCreature` | A creature is dealt damage (merged per creature per frame). | Its controller's strip. | Their largest biome. | `card` | `crack`: a gold crack over an ember glow. |
| `landfall` | A land enters. | Its controller's strip. | The land's biome. | `slot` | None: the slot's own glow. A pack's `landfall` replaces that glow. |
| `stageUp` | A land lifts a claimed slot to its next stage. | Its controller's strip. | The slot's biome. | `slot` | None: the new layers bloom. |

Only the viewing seat's redacted states feed the events, so an effect never
shows what the board does not (a face-down creature plays nothing).

**An effect.**

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `kind` | `sprite` \| `video` \| `particles` | — | **Required.** |
| `src` | URL | — | **Required** for `sprite` (an image: `.webp` preferred) and `video` (`.webm` or `.mp4`). Same URL rules as layers. |
| `src2x` | URL | — | `sprite`: the 2x sheet. |
| `fallback` | URL (`.mp4`) | — | `video`: for browsers without webm alpha. |
| `poster` | URL (image) | — | A still for reduced motion (`reduced: "poster"`). |
| `frames`, `cols`, `rows`, `fps` | 1–120, 1–32, 1–32, 1–60 | — | `sprite` only, and required for it, as for layers. Played **once**: left to right, top to bottom, then gone. |
| `loop` | `false` | `false` | Effects never loop; `true` gets a warning and is ignored. |
| `preset` | `shimmer` `sweep` `flash` `crack` `motes` `ripple` | — | **Required** for `particles`: a built-in effect, drawn by ForgeCoach, with no files. |
| `color` | `#rgb` \| `#rrggbb` | the biome's colour | The light of a `particles` preset and of the reduced-motion glow. |
| `durationMs` | 100–2500 (whole) | the sheet's `frames ÷ fps`; a preset's own (≈ 0.5 s); 2000 for a clip | How long it shows. Never more than **2500 ms**: a longer sheet is cut, with a warning. |
| `blend` | as layers | `screen` | CSS `mix-blend-mode` over the scenery. |
| `scale` | 0.1–3 | 1 | The effect box's height, as a fraction of the strip's height. |
| `aspect` | 0.2–8 | 1 | The box's width ÷ height. The picture is `contain`ed in it, standing on its bottom edge. |
| `y` | −1–1 | 0 | The box's bottom edge, as a fraction of the strip's height. |
| `at` | `slot` \| `card` \| `strip` | per event, above | Where the box is centred across the strip: the biome's slot, the card's position on the board (falls back to the slot), or the strip's middle. |
| `mirror` | boolean | `true` for `attack`, else `false` | Flip vertically on the opponent's strip (drawn upright on the far edge), so art drawn pointing *up*, at the other side, points at the other player from both sides. |
| `reduced` | `glow` \| `poster` \| `skip` | `glow` | With reduced motion: a still glow, the `poster`, or nothing (§4). `poster` without a `poster` falls back to `glow`, with a warning. |
| `bytes` | whole number | — | The size of this effect's files (sheet, 2x, clip, fallback, poster). Only for the budget (§3): over 4 MB in a biome gets a warning. |

**Top-level only:** `effects.maxConcurrent` (1–6, default 3) caps how many
effects play at once across the board. Put anywhere else, it gets a warning.

**Validation.** As for layers: a bad `kind`, URL, preset or sprite grid drops
that effect (a warning, with the path); out-of-range numbers and unknown names
fall back to their defaults (a warning); unknown fields inside an effect are
ignored. An effect-only pack (top-level `effects`, or biomes with only
`effects`) is valid: the built-in scenery plays your effects.

### Worked example: effects for the island

The island biome from above, with effects. Its stages are cut to stage 1 here
for space; in a real pack they stay as above. The island has its own creature,
attack, damage and stage-up effects; every other biome, and creature damage
everywhere, uses the top-level ones.

<!-- example-effects -->
```json
{
  "schema": 1,
  "spec": "1.2",
  "name": "Justin's tidewater",
  "effects": {
    "maxConcurrent": 3,
    "damageCreature": { "kind": "particles", "preset": "crack" },
    "creatureEnter": { "kind": "particles", "preset": "shimmer" }
  },
  "biomes": {
    "island": {
      "label": "Tidewater isles",
      "stages": [
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s1-sky.webp", "src2x": "island/s1-sky@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "sea", "kind": "video", "src": "island/sea-loop.webm", "fallback": "island/sea-loop.mp4", "poster": "island/sea-still.webp", "depth": 0.3, "z": 10, "y": 0, "h": 0.45 }
          ]
        }
      ],
      "effects": {
        "creatureEnter": { "kind": "sprite", "src": "island/fx-spout-sheet.webp", "src2x": "island/fx-spout-sheet@2x.webp", "frames": 18, "cols": 6, "rows": 3, "fps": 24, "scale": 0.9, "aspect": 0.6, "poster": "island/fx-spout.webp", "reduced": "poster", "bytes": 520000 },
        "attack": { "kind": "video", "src": "island/fx-wave.webm", "fallback": "island/fx-wave.mp4", "poster": "island/fx-wave.webp", "durationMs": 900, "scale": 1, "aspect": 1.8, "bytes": 1400000 },
        "damagePlayer": { "kind": "particles", "preset": "ripple", "color": "#bfe8ff", "scale": 0.6, "aspect": 4, "y": 0.05 },
        "stageUp": { "kind": "sprite", "src": "island/fx-tide-rise-sheet.webp", "frames": 24, "cols": 6, "rows": 4, "fps": 16, "scale": 1.4, "aspect": 1.8, "blend": "plus-lighter", "bytes": 1100000 }
      }
    }
  }
}
```

The spout plays for 750 ms (18 frames at 24 fps) where the creature landed;
the wave clip is cut at 900 ms and, drawn pointing up, is mirrored to point
down from the far strip; island damage is a pale ripple across the strip, not
the red flash; the tide-rise sheet runs 1.5 s, the longest and most dreamlike
moment. The island declares 3.0 MB of effects, under the 4 MB budget.

`src/ambience/manifest-effects.test.ts` validates this exact block. If you
change it, it must stay error- and warning-free.

### Board accents (1.3)

Accents are still pictures that reach out of the strip onto the player's area
itself, like a board frame: a vine in a corner, a band of leaves or spray
along an edge. Each biome gives them per stage, so they grow with that
player's mana.

**Where they go.** The *player area* is that player's battlefield (the region
the strip sits in). Each piece has an `anchor`:

| Anchor | Where | The picture |
| --- | --- | --- |
| `top-left`, `top-right`, `bottom-left`, `bottom-right` | A corner of the area. | Drawn `contain`ed in a square box tucked into the corner (at most 60% of the area's height), pushed into the corner. |
| `top-edge`, `bottom-edge` | Along the whole top or bottom edge. | A band, at most 18% of the area's height thick, repeated or stretched along it. |
| `left-edge`, `right-edge` | Along the whole left or right edge. | A band, at most 12% of the area's width thick. |

**Draw for your own side.** Author every piece for the viewer's side, where
the player's outer edge (and their strip) is at the **bottom**. On the
opponent's side, at the top of the board, a piece with `mirror` (the default)
swaps top and bottom (`bottom-left` → `top-left`, `bottom-edge` → `top-edge`)
and is flipped vertically, so it hugs their outer edge the same way. Left
and right never swap. With `mirror: false` the piece keeps its anchor and is
drawn as is.

**Several biomes: split by slot.** The strip shows a player's biomes left to
right in slot order, and the accents follow it:
- the left corners and `left-edge` come from the **leftmost** slot's biome;
- the right corners and `right-edge` from the **rightmost** slot's biome;
- `top-edge` and `bottom-edge`, which span the area, from the **dominant**
  biome (the most land weight; ties go to the earlier slot).

Each biome's pieces are those of its own stage, and a lone biome owns every
anchor. A withered slot (its lands gone) gives no accents. So with islands on
the left and a bigger forest on the right, the left corners are frost, the
right corners vines, and the bottom band is leaves. Give every biome pieces
for both sides and the long edges, and let the slots decide which show.

**Which accents a biome uses.** The pack's `overlay` for that biome, if it has
any; else, if the biome draws the built-in scene (the pack has no art for it,
or no pack is set), ForgeCoach's built-in placeholder accents; else none. A
pack biome with its own stage art and no `overlay` (a 1.2 pack) has no
accents, so older packs look as they did.

**A stage's accents.**

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `overlay` | list of pieces | — | This stage's pieces. Leave it out to keep the previous stage's pieces unchanged. |
| `overlayMode` | `replace` \| `add` | `replace` | `replace`: `overlay` is the stage's complete set (an empty list clears). `add`: `overlay` is added to the previous stage's pieces; a piece whose `id` was already there replaces it, in its place. |

**A piece.**

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `id` | `[A-Za-z0-9][\w.-]*`, ≤ 40 | — | **Required**, unique within the stage. A piece kept from the stage before (same `id`, same anchor) stays put; a new one fades in. |
| `anchor` | one of the eight above, or `area` (1.4, *Full-area accents*) | — | **Required.** An unknown anchor drops the piece, with a warning. |
| `src` | URL (`.webp` or `.avif`) | — | **Required.** A transparent **still**. Same URL rules as layers. |
| `src2x` | URL (`.webp` or `.avif`) | — | The 2x file. |
| `size` | 0.02–1 | corners 0.18, edges 0.05 | As a fraction of the area's **width**: a corner's box width, or an edge band's thickness. |
| `maxPx` | 16–1024 (whole) | corners 280, edges 72 | A pixel cap on that width or thickness. |
| `tile` | `repeat` \| `stretch` | `repeat` | Edges only (a warning on a corner). `repeat` tiles the picture along the edge at the band's thickness, so the art must be seamless end to end; `stretch` fits it to the whole edge. |
| `opacity` | 0–1 | 1 | |
| `blend` | as layers | `normal` | CSS `mix-blend-mode` over the area. |
| `motion` | `none` \| `sway` \| `drift` \| `breathe` | `none` | CSS only, on the still: `sway` turns ±1.2° about the piece's corner, `drift` shifts ±1.5%, `breathe` grows 3.5% and brightens a little. |
| `periodMs` | 2000–60000 (whole) | 9000 | One swing of `motion` (it alternates). |
| `mirror` | boolean | `true` | Flip onto the opponent's side (above). |
| `bytes` | whole number | — | The size of the piece's files (`src` + `src2x`), for the budget (§3). Each `src` counts once per biome however many stages repeat it. |

Unknown fields inside a piece are ignored. As elsewhere, out-of-range numbers
and unknown names fall back to their defaults with a warning; a piece with a
bad `id`, `anchor` or `src` is dropped with a warning.

**What is enforced, and how.**
- **≤ 6 pieces per stage** (after `add`): the first six are kept, the rest dropped, with a warning. On the board, **≤ 6 pieces per player area** across all its biomes: the dominant biome's pieces come first, so a minor biome's are the ones cut.
- **≤ 3 moving pieces per stage** (a `motion` other than `none`): the rest are drawn still, with a warning; again ≤ 3 per player area on the board.
- **CSS motion on a still does not count against the strip's 2 moving layers** (§3): those are decoded video and sprite sheets, the expensive kind. A swaying accent is a transform on a picture already decoded, so it is cheap; that is why up to 3 may move.
- **≤ 2 MB of declared accent files per biome**: a warning past it (pieces kept). From 1.4 this counts corner and edge files; full-area files have their own budget.

**Rendering rules** (what ForgeCoach guarantees, so art can rely on it):
- **Never over the game.** Accents are drawn beneath everything in the area: every card (names, costs, power and toughness, counters), every label, the action bar and the ask dialogs. They sit in the same layer as the strip, above the board's background and the strip, below all content. They never take clicks or taps, and screen readers skip them.
- **Clipped to the area**; an accent never spills onto the other player's side or the panels.
- **Small screens.** Under **600 px** of area width only corner pieces show, capped at **88 px**, still. Under **300 px**, none.
- **Reduced motion** (`prefers-reduced-motion`, or Settings → Motion → Stills only): every piece still, nothing fades in.
- **A hidden tab** pauses the motion.
- **Settings.** Accents show only when the scenery is on, and have their own switch, **Board accents** (on by default). `?accents=off` (or `on`) overrides it for one page load, like `?scenery=`.
- **Load.** Accent files load in the background; the board never waits for them, and a piece whose file fails is simply not drawn.

### Worked example: accents for the forest

The forest's strip art is left out here (`layers` lists omitted), so this
biome keeps the built-in scene and draws these accents; in a real pack each
stage has its `layers` too.

<!-- example-overlay -->
```json
{
  "schema": 1,
  "spec": "1.3",
  "name": "Justin's greenwood accents",
  "biomes": {
    "forest": {
      "stages": [
        {
          "overlay": [
            { "id": "vine-bl", "anchor": "bottom-left", "src": "forest/ov-vine-bl.webp", "src2x": "forest/ov-vine-bl@2x.webp", "size": 0.14, "maxPx": 200, "motion": "sway", "periodMs": 11000, "bytes": 380000 }
          ]
        },
        {
          "overlayMode": "add",
          "overlay": [
            { "id": "vine-br", "anchor": "bottom-right", "src": "forest/ov-vine-br.webp", "size": 0.12, "maxPx": 180, "motion": "sway", "periodMs": 13000, "bytes": 360000 }
          ]
        },
        {
          "overlayMode": "add",
          "overlay": [
            { "id": "vine-bl", "anchor": "bottom-left", "src": "forest/ov-vine-bl-s3.webp", "size": 0.2, "maxPx": 260, "motion": "sway", "periodMs": 11000, "bytes": 420000 },
            { "id": "leaves", "anchor": "bottom-edge", "src": "forest/ov-leaves-edge.webp", "size": 0.03, "maxPx": 48, "tile": "repeat", "opacity": 0.85, "bytes": 180000 },
            { "id": "canopy", "anchor": "top-left", "src": "forest/ov-canopy-tl.webp", "size": 0.12, "maxPx": 160, "opacity": 0.7, "motion": "breathe", "bytes": 300000 }
          ]
        },
        {
          "overlayMode": "add",
          "overlay": [
            { "id": "creeper", "anchor": "left-edge", "src": "forest/ov-creeper-edge.webp", "size": 0.025, "maxPx": 40, "tile": "repeat", "opacity": 0.8, "bytes": 200000 }
          ]
        }
      ]
    }
  }
}
```

Stage 1 is one vine in the bottom-left corner; stage 2 adds a second in the
bottom-right; stage 3 swaps the first vine for a bigger drawing (same `id`,
`add`), runs leaves along the bottom edge and lets a canopy breathe in the
top-left; stage 4 adds a creeper up the left edge, five pieces, three moving.
On the opponent's side every piece mirrors: the vines hang from their top
corners, the leaves run along their top edge, the canopy sits bottom-left.
The forest declares 1,840,000 bytes of accent files (six files; the stage-1 vine
still counts once), under the 2 MB (2,097,152-byte) budget.

`src/ambience/overlay.test.ts` validates this exact block. If you change it,
it must stay error- and warning-free.

### Full-area accents (1.4)

A full-area piece is one more piece in a stage's `overlay` list, with
`anchor: "area"`: a single transparent picture stretched over the **whole
player area**, for marks scattered beneath the cards rather than tucked into
a corner. Everything in *Board accents* above holds for it (`overlay`,
`overlayMode`, ids, `add` replacing by id, mirroring, Settings → Board
accents) except what this section changes.

**The picture.** A transparent WebP (or AVIF) still, about **2048 × 745**
(the player area's shape on a desktop board, about 2.75 : 1), with `src2x` at
4096 × 1490 if you want it sharp on high-density screens. Draw it for your own
side: the player's outer edge, where their strip is, at the **bottom**. Keep it
sparse; most of it should be clear.

**The area's shape changes.** The player area is wide on a desktop and much
squarer on a phone or with the coach panel open, so the picture is fitted:

- `fit: "cover"` (the default) fills the area and crops what does not fit:
  the top and bottom on a wide area, the sides on a narrow one.
  - With a `safe` rect, ForgeCoach crops only outside it, keeping it as near the
    middle as the crop allows. If the area's shape would cut into the rect, the
    picture is drawn `contain` instead, for that size. So the rect is a promise:
    it is always visible whole.
  - With no `safe` rect, `position` says which part is kept (as a layer's
    `anchor`: `bottom` keeps the outer edge).
- `fit: "contain"` always shows the whole picture, as large as fits, placed by
  `position`; the rest of the area stays clear. A `safe` rect is ignored
  with `contain` (a warning), since everything is visible.

**Where cards are.** ForgeCoach does not move the picture to follow cards:
cards are drawn over it wherever they sit. Steer the marks round the usual
card rows (the middle of the area, and the land row near the outer edge) and
keep them at the rim and in the gaps, as the mock-ups do.

**The piece.**

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `id` | as other pieces | — | **Required**, unique within the stage. Give the area piece the same `id` in every stage (e.g. `"scatter"`) so `overlayMode: "add"` swaps the picture in place. |
| `anchor` | `"area"` | — | **Required.** |
| `src` | URL (`.webp` or `.avif`) | — | **Required.** A transparent still, about 2048 × 745. |
| `src2x` | URL (`.webp` or `.avif`) | — | The 2x file, about 4096 × 1490. |
| `fit` | `cover` \| `contain` | `cover` | How the picture fills the area (above). `fill` is not offered: it would stretch the marks. |
| `safe` | `{ "x", "y", "w", "h" }` | — | `cover` only. The part of the picture that must stay visible, as fractions of the picture from its **top-left** (`x`, `y` 0–1; `w`, `h` 0.05–1; `x + w` and `y + h` at most 1). A missing key takes 0 for `x`/`y` and 1 for `w`/`h`. |
| `position` | as a layer's `anchor` (`center`, `bottom`, `top-left`, …) | `center` | Where the picture sits with `contain`, or which part `cover` keeps when there is no `safe` rect. |
| `opacity` | 0–1 | 1 | |
| `blend` | as layers | `normal` | |
| `motion` | `none` \| `sway` \| `drift` \| `breathe` | `none` | CSS only, smaller than a corner's, as the picture is the size of the area: `sway` turns ±0.35° about the outer edge's middle, `drift` shifts ±0.6%, `breathe` grows 1.2% and brightens a little. |
| `periodMs` | 2000–60000 (whole) | 9000 | |
| `mirror` | boolean | `true` | On the opponent's side the picture is flipped vertically, so its outer edge is their (top) edge. Left and right do not swap. `false`: drawn as is. |
| `minWidthPx` | 300–4096 (whole) | 600 | Not drawn when the player's area is narrower than this, in CSS px. |
| `bytes` | whole number | — | The size of `src` + `src2x`, for the full-area budget (§3). |

`size`, `maxPx` and `tile` are for corners and edges: on an area piece they
are ignored, with a warning. A piece with a bad `id` or `src` is dropped, as
other pieces are; out-of-range numbers and unknown names fall back to their
defaults with a warning.

**What is enforced, and how.**
- **At most one full-area piece per stage** (after `add`): the first is kept, the others dropped, with a warning naming them.
- **It counts as one piece** toward the ≤ 6 per stage and per player area.
- **It counts toward the ≤ 3 moving pieces** when it has a `motion`. CSS motion on a still is still not one of the strip's 2 moving layers.
- **Several biomes:** the area belongs to the **dominant** biome (the most land weight; ties go to the earlier slot), like the long edges. So a player shows at most one full-area picture, and it changes biome when another biome overtakes.
- **≤ 3 MB of declared full-area files per biome**: a budget of its own, on top of the corner-and-edge 2 MB (a warning past it; pieces kept). The corner-and-edge budget no longer counts full-area files.

**Which stages.** Any stage may carry one, 1 to 6, and a biome may have a
full-area piece and no corners or edges. The intended use is stages 2 to 4,
the picture getting thicker each stage (thicker vines, more sand, brighter
lava, more branches); leave stage 1 without one (`"overlay": []`) so a first
land is quiet. A stage without `overlay` keeps the previous stage's pieces,
the area piece included.

**Rendering rules** (in addition to those of *Board accents*):
- **Z-order**, bottom to top: the area's background, **the full-area piece**, the strip (with its fade) and effects, the corner and edge pieces, then every card, label and control. So the strip paints over the picture's bottom band (on your side, the outer quarter or so of the area, where the strip is solid) and the picture shows through as the strip fades; keep what matters above that band.
- **Clipped to the area**, never takes clicks or taps, and screen readers skip it, as other accents.
- **Small screens.** Hidden under `minWidthPx` (600 px by default). Between 300 and 600 px, where only corners show, an area piece whose `minWidthPx` allows it still shows, but still (no motion). Under 300 px, no accents at all.
- **Reduced motion** (`prefers-reduced-motion`, or Settings → Motion → Stills only): drawn still, and it appears without fading in. A hidden tab pauses its motion.
- **Settings.** Settings → Board accents (and `?accents=`) turns it on and off with the other accents.
- **Load.** It loads in the background like other accent files; a picture that fails is simply not drawn.
- **Built-in placeholder.** ForgeCoach's built-in accents have no full-area piece on the board. `#ambience` can show a built-in placeholder (View → Full-area accent → Built-in placeholder) to preview the layer with no pack.

### Worked example: a full-area scatter for the forest

The forest keeps the built-in strip here (no `layers`), with no accents at
stage 1, a full-area scatter from stage 2 that thickens at each stage, and a
corner vine joining it at stage 3.

<!-- example-area -->
```json
{
  "schema": 1,
  "spec": "1.4",
  "name": "Justin's greenwood scatter",
  "biomes": {
    "forest": {
      "stages": [
        { "overlay": [] },
        {
          "overlay": [
            { "id": "scatter", "anchor": "area", "src": "forest/area-s2.webp", "fit": "cover", "safe": { "x": 0.08, "y": 0.1, "w": 0.84, "h": 0.8 }, "opacity": 0.9, "bytes": 280000 }
          ]
        },
        {
          "overlayMode": "add",
          "overlay": [
            { "id": "scatter", "anchor": "area", "src": "forest/area-s3.webp", "src2x": "forest/area-s3@2x.webp", "fit": "cover", "safe": { "x": 0.08, "y": 0.1, "w": 0.84, "h": 0.8 }, "opacity": 0.9, "bytes": 950000 },
            { "id": "vine-bl", "anchor": "bottom-left", "src": "forest/ov-vine-bl.webp", "size": 0.14, "maxPx": 200, "motion": "sway", "periodMs": 11000, "bytes": 380000 }
          ]
        },
        {
          "overlayMode": "add",
          "overlay": [
            { "id": "scatter", "anchor": "area", "src": "forest/area-s4.webp", "src2x": "forest/area-s4@2x.webp", "fit": "cover", "safe": { "x": 0.08, "y": 0.1, "w": 0.84, "h": 0.8 }, "opacity": 0.95, "motion": "breathe", "periodMs": 14000, "minWidthPx": 720, "bytes": 1150000 }
          ]
        }
      ]
    }
  }
}
```

Stage 2 is one sparse scatter; stage 3 swaps it for a thicker one (same `id`,
`add`) and adds a corner vine; stage 4 swaps in the richest scatter, which
breathes slowly and shows only from 720 px. The `safe` rect keeps the middle
84% × 80% of the picture in view however the area is cropped. The forest
declares 2,380,000 bytes of full-area files (under the 3 MB, 3,145,728-byte,
budget) and 380,000 of corner files (under the 2 MB).

`src/ambience/overlay-area.test.ts` validates this exact block. If you change
it, it must stay error- and warning-free.


### The half board (1.5)

Art direction §5 (the PC session's mock-ups, settled with Justin) turns the
strip into the whole of each player's half of the board. What ForgeCoach
draws, and what a pack can give it:

**Layout** (what ForgeCoach guarantees, so art can rely on it):
- **The half.** Each player's battlefield (their half of the board) is filled
  edge to edge by their scenery, beneath everything: the full-area accent, the
  corner and edge accents, the scrim, the effects and every card, label and
  control paint over it. It never takes clicks or taps; screen readers skip it.
- **Both halves upright.** Your half has its ground at the bottom (your edge);
  the opponent's half is drawn the same way up, not rotated (turned 180° it
  reads upside-down). Where the two halves meet, each fades over its inner
  `mist` share of its height into a soft **mist band**, so their ground never
  meets your sky hard.
- **Several colours.** The half is split side by side **in proportion to the
  lands** (5 Islands : 1 Mountain is 5 : 1), in slot order, each biome at **its
  own land count's stage** (a stage-3 island beside a stage-1 mountain). No live
  biome's panel is narrower than `minShare` of the width (a withered one, its
  lands gone, keeps half that); neighbours meet in a gradient seam `seamRatio`
  of the width wide (capped at 14% of the viewport on phones), with a breath
  of mist in it.
- **The crop.** Each panel shows its picture whole-height or whole-width,
  whichever covers it (`cover`): the `focal` point as near the panel's middle
  as the picture allows, and the `safe` rect kept whole whenever the panel's
  shape allows (when it cannot, the view centres on the rect). A desktop half
  is about 2.7–5 : 1, so a 3 : 1 picture loses a little of its top and bottom
  or sides; a phone's half is near 1 : 1, so it shows about the middle third of
  the width, and a narrow panel of a split less. One picture per biome per
  half, chosen by `srcset` for the screen's density (1x or 2x, never more).
- **The card-row scrim.** Under each row of cards (and under the "No
  permanents" note) ForgeCoach draws a soft dark band: the board's own
  background colour, opaque within 6 px of the cards, then feathered from 0.85
  to nothing over 30 px. A card's edge and any text near it sit on exactly the
  colour they sit on with the scenery off, however busy the art; the sky and
  the edges of the half keep their full colour. So keep the subject out of the
  card rows' usual places only as far as the art allows: the scrim takes care of
  readability.
- **Effects and accents** keep working: the effects play in the strip-sized
  box at the outer edge as before, the land flash and the stage-up bloom play
  in the panel, accents draw over the half as over the board.
- **Settings.** Settings → Board scenery → Fill each side (on by default;
  `?fill=off` or `on` for one page load, like `?scenery=`). Off, the board
  shows the 1.4 strip, with no scrim.

**Older packs and the built-in scene.** A biome with no `half` picture fills
its panel with its stage's strip layers in a 4 : 1 frame (the spec's 2048 ×
512 backdrops) cover-cropped about its horizon (~57% up): `focal` { x 0.5,
y 0.43 }, no safe rect. Every layer keeps its place in that frame, so loops
and objects stay registered to the backdrop. A 1.0–1.4 pack needs no change.

**A pack's half pictures.** Give a stage a `half` object: one **opaque**
picture painted for a whole half, used instead of the stage's still layers
when the half is filled. The stage's moving layers (video, sprite) still play
over it, in its frame. A stage may have a `half` and no `layers`: the strip
(Fill each side off) then shows the half picture, cover-cropped about its
middle. A stage with both keeps its `layers` for the strip.

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `src` | URL (`.webp` `.avif` `.png` `.jpg`) | — | **Required.** The 1x picture, opaque. Same URL rules as layers. |
| `src2x` | URL | — | The 2x file (used through `srcset`). |
| `width`, `height` | 64–16384 (whole), a shape between 1 : 2 and 8 : 1 | 1728 × 576 | The 1x file's pixel size. Only its shape is used, to crop before the file loads; give both. |
| `focal` | `{ "x", "y" }`, 0–1 | `{ "x": 0.5, "y": 0.475 }` | The subject's centre, as fractions of the picture from its top-left: kept as near the panel's middle as the picture allows. The default is the middle of §5's subject band (35–60% down), centred. |
| `safe` | `{ "x", "y", "w", "h" }` | — | The part that must stay visible, as for full-area accents (fractions from the top-left; `x + w`, `y + h` ≤ 1). For §5's frames, the subject band across the middle half: `{ "x": 0.25, "y": 0.35, "w": 0.5, "h": 0.25 }`. |
| `bytes` | whole number | — | `src` + `src2x`, for the budget (§3). |

**Top-level `half`** (the layout; every field optional):

| Field | Range | Default | Notes |
| --- | --- | --- | --- |
| `seamRatio` | 0–0.3 | 0.1 | The seam between two biomes, as a fraction of the half's width (§5: ~10%). |
| `minShare` | 0.05–0.3 | 0.15 | The narrowest a live biome's panel gets (§5: ~15%). |
| `mist` | 0–0.4 | 0.16 | How much of each half's height, from the centre line, fades into the mist band. |

As elsewhere, a bad `src` drops the picture (the stage keeps its layers, or is
dropped when it has none), and out-of-range numbers fall back to their
defaults with a warning. A picture that fails to load on the board falls back
to the stage's strip art, cropped.

**How to paint one** (§5): 3 : 1, **3456 × 1152** with a **1728 × 576** copy
(`src2x` and `src`); the horizon about **57% up**; the scene's subject in the
band **35–60% down**, centred enough that the **middle half of the width**
tells the story (a phone shows only that); the **bottom ~30% calm** (the land
row and the scrim sit there); no text, no faces. Each stage the same place
grown, as for the strip. Opaque: no alpha; the mist and the scrim are
ForgeCoach's.

### Worked example: half pictures for the island

<!-- example-half -->
```json
{
  "schema": 1,
  "spec": "1.5",
  "name": "ForgeCoach scenery, pack v3",
  "author": "jalirkan",
  "license": "CC BY 4.0",
  "half": { "seamRatio": 0.1, "minShare": 0.15, "mist": 0.16 },
  "biomes": {
    "island": {
      "label": "Moonlit cove",
      "bloom": { "kind": "fade", "durationMs": 1400, "staggerMs": 120 },
      "stages": [
        { "half": { "src": "island/s1-half.webp", "src2x": "island/s1-half@2x.webp", "width": 1728, "height": 576, "focal": { "x": 0.5, "y": 0.47 }, "safe": { "x": 0.25, "y": 0.35, "w": 0.5, "h": 0.25 }, "bytes": 1300000 } },
        { "half": { "src": "island/s2-half.webp", "src2x": "island/s2-half@2x.webp", "width": 1728, "height": 576, "focal": { "x": 0.5, "y": 0.47 }, "safe": { "x": 0.25, "y": 0.35, "w": 0.5, "h": 0.25 }, "bytes": 1500000 } },
        { "half": { "src": "island/s3-half.webp", "src2x": "island/s3-half@2x.webp", "width": 1728, "height": 576, "focal": { "x": 0.55, "y": 0.45 }, "safe": { "x": 0.25, "y": 0.35, "w": 0.5, "h": 0.25 }, "bytes": 1700000 } },
        {
          "half": { "src": "island/s4-half.webp", "src2x": "island/s4-half@2x.webp", "width": 1728, "height": 576, "focal": { "x": 0.5, "y": 0.45 }, "safe": { "x": 0.25, "y": 0.35, "w": 0.5, "h": 0.25 }, "bytes": 1900000 },
          "layers": [
            { "id": "motes", "kind": "video", "src": "island/s4-motes.webm", "fallback": "island/s4-motes.mp4", "poster": "island/s4-motes.webp", "blend": "screen", "z": 10, "depth": 0.4 }
          ]
        }
      ]
    }
  }
}
```

Every stage is one opaque half picture; stage 3's subject sits a little right
of centre, so its focal point moves with it. Stage 4 adds its loop (screen
blend) over the picture, in the picture's frame. With Fill each side off the
strip shows each half picture cropped about its middle, and the loop over
stage 4. The island declares 6.4 MB of half pictures, under the 8 MB
(8,388,608-byte) budget. A pack can keep its 1.4 strip art beside these: give
each stage its `layers` as before and the `half` too.

`src/ambience/half.test.ts` validates this exact block. If you change it, it
must stay error- and warning-free.


## 3. Files and budgets

| What | Format | Size |
| --- | --- | --- |
| Backdrops (sky, sea, ground bands) | WebP (quality 80–85) or AVIF | 2048 × 512 at 1x, 4096 × 1024 as `src2x`. Wide and short; `cover` crops the sides of narrow slots, so keep the interest in the middle 60%. |
| Objects (palms, trees, rocks) | WebP or AVIF with alpha | Sized to their box at 2x: a palm 0.95 strip-high is about 480 px tall at 1x. |
| Sprite sheets | WebP with alpha, frames in a grid | Each frame at the layer's 1x box size (any aspect: with `contain` / `cover` the frame keeps its own shape, placed by `anchor`); the whole sheet ≤ 4096 px on either side; ≤ 48 frames is plenty (12 fps × 4 s). |
| Loops | WebM (VP9 with alpha, `yuva420p`), plus an MP4 (H.264) `fallback` | 2–6 s, seamless, ≤ 1280 px wide, 24–30 fps, no audio track. |
| Posters | WebP | The first frame of the loop or sprite. |

Budgets per biome:
- **≤ 6 MB** in total;
- **≤ 1.5 MB for stage 1**, which is preloaded before the scenery shows;
- **≤ 8 layers** per stage;
- **≤ 2 moving layers** (sprite or video) per stage, counting layers kept from earlier stages. The validator warns on a stage with more. Videos are the heaviest thing on a phone, so prefer one loop per biome; idle motion (§4) on a still image is free.

Budgets for effects (1.2), counted apart from the scenery's 6 MB:
- **≤ 4 MB per biome** for its effects' files, and ≤ 4 MB for the top-level effects. Declare each effect's size in `bytes` and the validator warns past it; **Check effect files** on `#ambience` measures the real files.
- **≤ 2.5 s** per effect (longer sheets and clips are cut).
- **Effect sprite sheets:** ≤ 2048 px on either side, 8–30 frames at 12–24 fps; one row per stage of the motion reads well (`cols` frames per row).
- **Effect clips:** ≤ 720 px wide, WebM VP9 with alpha plus an MP4 `fallback`, no audio, under 2.5 s; the clip is not looped.
- **At most `effects.maxConcurrent`** play at once (default 3, at most 6); a burst waits briefly, and what waits too long (0.9 s) is dropped.

Budgets for board accents (1.3), counted apart from the scenery's 6 MB and the effects' 4 MB:
- **≤ 2 MB per biome** of accent files (declare `bytes`; the validator warns past it).
- **≤ 6 pieces per stage**, and on the board ≤ 6 per player area (enforced).
- **≤ 3 moving pieces per stage** (CSS `motion`; enforced: the rest are still). CSS motion on a still is **not** one of the 2 moving layers above, which are video and sprites.
- **Corners:** about **1024 × 1024**, transparent WebP (or AVIF), the subject pushed into the bottom-left (or whichever corner it is for) and fading out toward the opposite corner; no hard edge where the picture ends. Shown at most 280 px wide by default (`maxPx`), so 1024 covers 2x and beyond.
- **Top and bottom edges:** about **2048 × 256**, the ground at the bottom; seamless left to right when `tile` is `repeat`.
- **Left and right edges:** about **256 × 2048**, the root at the outer side; seamless top to bottom when tiled.
- Stills only: no animated WebP, no video, no sprite sheets.

Budgets for full-area accents (1.4), an extension of the accents' budget: their own **≤ 3 MB per biome**, on top of the 2 MB for corners and edges, and apart from the scenery's 6 MB and the effects' 4 MB:
- **≤ 3 MB per biome** of full-area files (declare `bytes`, `src` + `src2x`; the validator warns past it). Three stages at about 250–400 KB for 1x and 0.6–1 MB for 2x fit.
- **One picture per stage**, about **2048 × 745** transparent WebP (quality 75–85) or AVIF; the 2x about 4096 × 1490. Sparse art compresses well: most of the picture should be fully transparent.
- It counts as one of the ≤ 6 pieces, and as one of the ≤ 3 moving pieces when it moves.
- Stills only, as other accents.

Budgets for half pictures (1.5), counted apart from the strip's 6 MB, the effects' 4 MB and the accents:
- **≤ 8 MB per biome** of half pictures (declare `bytes`, `src` + `src2x`, each file once however many stages repeat it; the validator warns past it).
- **One picture per stage**, opaque WebP (quality 80–85) or AVIF: **1728 × 576** at 1x and **3456 × 1152** as `src2x` (3 : 1). About 0.3–0.5 MB for 1x and 1–1.4 MB for 2x fit four stages in the budget.
- The board loads only the pictures it shows (stage 1's warm in the background); the browser picks 1x or 2x by the screen's density, never more.
- Moving layers over a half picture count against the 2 moving layers per stage as before.

The whole pack should stay ≤ 30 MB, effects and accents included (half pictures count apart: up to 40 MB more for five biomes).

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
  | 4 | The paradise version: the richest composition, still at most two moving layers. |

  Later stages should look like the same place grown, not a different picture. Reuse ids for layers that stay.
- **Motion.** Idle motion is slow and small (periods of 6–12 s). Nothing should flash or strobe. The bloom is the only fast moment.
- **Reduced motion.** With `prefers-reduced-motion` (or Settings → Motion → Stills only), the strip shows stills only:
  - posters for videos and sprites;
  - no idle loops, no bloom, no flashes.

  Every moving layer therefore needs a poster that looks complete on its own.
- **Effects and motion.** Effects are the board's punctuation: short, soft at the edges, and gone. No strobing (no more than one bright peak per effect), no full-strip white flashes, nothing that hides a card. They play only for live play and for stepping a replay at normal speed: jumping, going back or scrubbing quickly cancels them, and a hidden tab pauses them.
- **Effects with reduced motion.** Each effect's `reduced` says what shows instead: `glow` (the default, a still soft glow in the effect's colour at its anchor, for the effect's length), `poster` (its `poster` still), or `skip` (nothing).
- **Full-area accents (1.4).** Sparse and stylised: heavily inked marks (vines, dead branches, grass) or soft ones (sand and shells, lava glow), mostly clear between them, with the middle of the area (where cards sit) the thinnest. Cards and their text must read over it on every skin; no large bright areas. Each stage is the same scatter grown (thicker vines, more sand, brighter lava, more branches), not a new picture.
- **Half pictures (1.5).** Paint for the whole half, not a strip: the horizon about 57% up, the subject 35–60% down and readable from the middle half of the width, the bottom ~30% calm, opaque, no hard horizontal lines near the top (where your half meets the mist). The scrim under the card rows and the mist band are drawn by ForgeCoach; don't paint your own.
- **Accents (1.3).** Quiet, low-contrast, mostly at the very edge: they frame the area, they are not a picture in it. The inner part of a corner picture (toward the area's middle) should fade to nothing. Cards are drawn over them, so keep fine detail at the rim, where cards rarely sit. Keep motion as small as the strip's idle.
- **Levelling up with mana.** The art direction for every biome: each stage is more intricate, vivid and fantastical than the last, and the final stage is dreamlike. A `stageUp` effect is the moment to show that: it plays when a land lifts a claimed slot to its next stage.

## 5. Serving a pack locally

The page fetches `scenery.json` with CORS, so serve the folder with CORS on:

```bash
npx http-server ./pack --cors -p 8650 -c-1
```

`-c-1` turns caching off while you iterate. Then use the pack URL
`http://127.0.0.1:8650/` (the folder) or `http://127.0.0.1:8650/scenery.json`.

**Mixed content.** ForgeCoach on `https://jalirkan.github.io/ForgeCoach/`
may fetch from `http://127.0.0.1`: browsers treat loopback as potentially
trustworthy, so it is not blocked as mixed content. A LAN address such as
`http://192.168.x.x` is blocked from the https page; use a local dev build
(`npm run dev`) or serve the pack over https for that.

**Local Network Access.** Current Chromium (Chrome, Edge) also asks before a
public site reaches your own machine or local network. The first time the
github.io page fetches `http://127.0.0.1` (or a LAN address), the browser shows
a prompt to allow the site to access devices on your local network. Until you
accept it, the fetch fails as if the server were down. The coach helper
(`127.0.0.1:8643`) goes through the same prompt.

- Accept the prompt, and the pack loads.
- If you dismissed or blocked it, open the browser's site settings for
  `jalirkan.github.io` (the icon left of the address bar) and set **Local
  network access** to *Allow*, then reload. Or reset the permission, reload
  and accept the prompt.
- A local dev build (`http://localhost:5173`) is itself on your machine, so it
  doesn't ask.

When the manifest fetch fails for a loopback or LAN pack, `#ambience` and the
board's fallback note say so, with these steps.

## 6. Testing on `#ambience`

1. Open `#ambience` (e.g. `https://jalirkan.github.io/ForgeCoach/#ambience`, or `http://localhost:5173/#ambience` from `npm run dev`).
2. Enter the pack URL and press **Load**. You can also open `#ambience?scenery=http://127.0.0.1:8650/` to load it at once. The page lists:
   - every error (why the pack was refused);
   - every warning (what was dropped or reset to a default), with the path of each field.
3. Play lands for either side with the buttons, or press **Demo sequence**. **Undo** and **Reset** step back.
4. Drag **Stage** to see every stage of every claimed biome without playing more lands.
5. Switch **Motion** to *Stills only* to check posters and reduced motion.
6. **Creature enters** and **Attack** under *Play* change the made-up game, and fire the effects the engine derives from it. The event list shows what the engine emitted.
7. **View → Board accents** turns the accents on and off on the preview (Settings → Board accents does it on the board). Narrow the window under 600 px to see the corners-only fit. The pasted-manifest check and the pack status list each biome's accent pieces per stage and their declared size, and the stages with a full-area piece (1.4).
   **View → Full-area accent → Built-in placeholder** shows ForgeCoach's own full-area scatter (from stage 2) where the pack has none, to see the layer beneath the strip with no pack.
   **View → Fill each side** switches the preview between the half board (1.5: each side filled, split by land count, the mist band and the card-row scrim under the mock cards) and the strip; the pack status lists each biome's stages with a half picture and their declared size.
8. The **Effects** card fires each effect for either side directly: creature enters, attack, damage (player), damage (creature), landfall, stage up. It plays on that side's largest biome, so play a land first. Its **Pack effects** status lists what the pack supplies for each event and biome (else the built-in), and **Check effect files** fetches each effect file and measures it against the 4 MB budget.
9. **Check a manifest by pasting it** validates JSON as you type, before any file is served. **Preview this manifest** then draws the table with the pasted manifest (files from the pack URL, or absolute URLs), so a new piece such as a full-area accent can be tried before the pack's `scenery.json` is changed; **Stop previewing** goes back.
10. **Use on the board** saves the choice. Settings → Board scenery does the same, and so does `?scenery=<url>` on any ForgeCoach URL. The play board and the replay board (`#sample=human-auto-42`) then show the pack.
11. Press **Reload** after changing files. The preview loads the pack fresh each time; the board caches it per page load.

If a pack fails on the board, ForgeCoach falls back to the built-in scenery.
It logs why in the console (`ForgeCoach scenery: …`); dev builds also show it
in the board's corner.

## 7. Content rules

- **Anything that might ever be shared must be original art.** This covers this repository, the public site, screenshots and published packs. That means your own work, or generated or rendered work made from your own prompts and scenes, with no copied artwork.
- **Nothing derived from or resembling someone else's IP goes into ForgeCoach.** No card art, set symbols, logos, named planes or characters, and no imitation of a recognisable artist's work. A pack like that may live on your own machine, for your own play, served from `127.0.0.1`. It is never committed here, never uploaded, and never put in a published URL.
- **Packs are never committed to this repository.** That includes original ones. This repo ships only the engine, the procedural fallback and this spec. Keep packs in their own folder or repository.
- **No text, faces of real people, or symbols in the art.**
