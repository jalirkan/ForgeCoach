<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Scenery pack spec (schema 1, version 1.3)

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
| `spec` | `"1.3"` | — | The version the pack was written for. Informational; a newer minor version than this ForgeCoach reads gets a warning (its new fields are ignored). |
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
| `anchor` | one of the eight above | — | **Required.** An unknown anchor drops the piece, with a warning. |
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
- **≤ 2 MB of declared accent files per biome**: a warning past it (pieces kept).

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

The whole pack should stay ≤ 30 MB, effects and accents included.

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
7. **View → Board accents** turns the accents on and off on the preview (Settings → Board accents does it on the board). Narrow the window under 600 px to see the corners-only fit. The pasted-manifest check and the pack status list each biome's accent pieces per stage and their declared size.
8. The **Effects** card fires each effect for either side directly: creature enters, attack, damage (player), damage (creature), landfall, stage up. It plays on that side's largest biome, so play a land first. Its **Pack effects** status lists what the pack supplies for each event and biome (else the built-in), and **Check effect files** fetches each effect file and measures it against the 4 MB budget.
9. **Check a manifest by pasting it** validates JSON as you type, before any file is served.
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
