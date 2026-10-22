<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Scenery pack spec (schema 1, version 1.12)

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
| 1.5 | The **half board** (§2, *The half board*): the scenery fills each player's whole half of the board (Settings → Fill each side, on by default), split side by side in proportion to their lands, each biome at its own stage, both halves upright with a mist band along the centre line, and a soft dark scrim under the card rows. Optional per-stage **`half`** pictures (an opaque desktop picture and an optional portrait `phone` one, with the scene's `subjectBand` — and optional `focal` / `safe` — for the crop) and a top-level **`half`** layout (`seamRatio`, `minShare`, `mist`); their budget (§3). A 1.0–1.4 pack fills the half with its strip art, cover-cropped. |
| 1.7 | **Transition frames** (§2, *Transition frames*): an optional per-biome **`transitions`** with a few in-between pictures for each stage step (`from`, `frames` of a desktop `src` and a `phone`, a `holdMs` per frame and a `fadeMs`), played with hard cuts when a land steps the stage — limited animation, a drawing held ~200 ms, then one short fade into the new stage. A step without frames, and every 1.0–1.6 pack, cross-fades as in 1.6. |
| 1.8 | **Bridges across the seam** (§2, *Bridges across the seam*): an optional top-level **`bridges`** map keyed by a biome pair (`"forest+island"`; both orders find the one entry), each a transparent ground piece drawn over the seam where the two biomes meet on one side of the half board — a desktop `src` and a `phone` seam crop, an `anchor` on the seam (the centre's height, the width as a fraction of the half's) — faded in with the second biome, mirrored when the board has the pair the other way round; and `dualsWiden`: each of the pair's two-colour lands widens their seam (and the bridge with it). A 1.0–1.7 pack, and a pair with no bridge, keeps today's seam. |
| 1.9 | **Pair bands** (§2, *Pair bands*): a second, optional manifest, **`pairs.json`**, fetched beside `scenery.json` from a pairs URL of its own (ForgeCoach's comes with ForgeCoach's pack; `?pairs=<url>` or `off` for any page): per biome pair, the pair's own place (named for its `dual` and `shock`), three `stages` of 1.5 `half` pictures and 1.7 `transitions`, a `band` width rule (`min`, `perDual`, `max`) and a `stageMap`. Where two biomes meet on one side of the half board, the seam opens into that place, wider with every land that is both colours. Lands that make two colours count ½ / ½ as the shocks do, the Thriving lands included (§1). No pairs, or a pair without an entry, keeps the 1.8 seam. |
| 1.10 | **Calm seams** (§2, *Calm seams*), layout only, no new field: a half shows at most **three** panels (the rest fold into their nearest kept neighbour); a seam with a pair band draws **no bridge**; a half picture is never drawn half over its next stage; a full-area accent is drawn over **its own biome's panel** only; the seam mist lighter, none at a band. Every 1.0–1.9 pack and pairs manifest is read unchanged. |
| 1.11 | **Land rules** (§2, *Land rules*), classification only, no new field: a land that makes **no coloured mana** (a fetch land, Ancient Tomb, the Landscapes, Mutavault, Urza's Saga, the basic Wastes), or **any colour** (City of Brass, Exotic Orchard), draws **no biome**, and so opens no `wastes` slot; a fixed **three-colour** land splits into thirds as a Triome does; a **Pathway** (any multi-face land) counts as the face in play only; a typeless land with **no card data** draws nothing until its data loads. No land claims `wastes` any more; a pack may still paint one. |
| 1.12 | **Motifs** (§2, *Motifs*): a pair stage in `pairs.json` may carry a **`motif`**, a transparent picture painted for the band's own narrow, full-height shape (pairs-v3: the road, river or causeway both lands share, running up the seam to the horizon). A pair whose stages have a motif and **no `half`** is a *motif pair*: its seam stays the plain 1.10 seam and the motif is drawn **over** it, centred on the seam, `band` wide, so its own soft banks are the band's edges; its frames are `motifTransitions`. A band pair (1.9) may carry a motif too, drawn over its picture. Every 1.9–1.10 pairs manifest is read unchanged. |
| 1.6 | **Growth between stages** (§2, *Growth between stages*): between two thresholds every land grows a biome a little toward its next stage — the next stage's still pictures cross-faded over the current ones by the progress, the accents thickened, the slot widened — with a short fade per land. On for every pack with no change; an optional top-level **`growth`** (`crossfade`, `seconds`) lets a pack opt out or tune the fade. |

## 1. How the scenery works

Each player's side of the board has a **strip** along its outer edge: the
bottom of your battlefield, and the far (top) edge of the opponent's, drawn
upright as a distant vista that dissolves at both ends. The strip sits *behind* the
cards. It never takes clicks and never covers cards, life, prompts or any
other game information.

- **Biomes.** There are six: `island`, `swamp`, `mountain`, `forest`, `plains`, `wastes` (from 1.11 no land claims `wastes`: §2, *Land rules*).
- **Classifying a land** (1.11; *Land rules* in §2 has the table).
  - Basic land types on the type line come first: `Land — Island Swamp` gives ½ island and ½ swamp, a Triome ⅓ each.
  - A land that chooses a colour as it enters (the Thriving lands: "Add {W} or one mana of the chosen color"): its fixed colour and the chosen one, ½ / ½, once the viewing seat's own choice is known; its fixed colour alone until then, and for an opponent's (1.9; before, it went to `wastes`).
  - A Pathway, or any card with a land face: the face in play only, so a Pathway is one colour (1.11; 1.9 counted both faces ½ / ½).
  - Otherwise, the colours the land taps for, when it makes one, two or three colours, split evenly (Seaside Citadel in thirds, 1.11).
  - Anything else is **not scenery**, like a mana rock: no coloured mana (a fetch land until it fetches, colourless lands, the basic Wastes), any colour (four or five), or no card data yet. Before 1.11 these went to `wastes`, the built-in scene.
- **Slots.** A biome claims the next slot, left to right, the first time one of its lands appears. It keeps that slot for the rest of the game. If all its lands leave, it shows a withered (greyed) stage 1.
- **Stages.** A biome's land count sets its stage:

  | Lands | Stage |
  | --- | --- |
  | 1 | 1 |
  | 2–3 | 2 |
  | 4–5 | 3 |
  | 6+ | 4 |

  A pack may change these thresholds and may define up to 6 stages. A slot past a pack's last stage shows that last stage.
- **Growth between stages (1.6).** Between two thresholds a biome also has a **progress** toward its next stage: the fraction of the way from its stage's threshold to the next one (3 lands is stage 2 at ½; 5 lands is stage 3 at ½; 6 or more is fully grown). Each land moves it, and the scene follows: the next stage's pictures fade in over the current ones by that much (§2, *Growth between stages*). A 2nd, 4th and 6th land arrive at a stage's own pictures exactly as before; the 3rd and 5th land halfway between.
- **Width.** Slot width grows a little with stage (+18% per stage), and from 1.6 smoothly with every land in between (stage plus progress), times the biome's `slot.weight`.
- **Bloom.** When a stage adds layers, the new layers *bloom in*. A layer whose `id` is also in the previous stage stays where it is and does not bloom again. Every land arrival also flashes its slot with a soft glow.
- **Events.** The scenery engine also emits *creature entered* (with the creature's colours), *attack declared* and *damage dealt* (to a player or to a creature). Each plays a short one-shot **effect**: the pack's own (§2, *Effects*), or else a built-in placeholder.
- **Accents (1.3).** Besides the strip, each player's area can carry a few **accents**: pictures in its corners and bands along its edges (vines creeping in as the forest grows, frost and spray for islands, ash for mountains). They grow with the same stages, sit beneath every card and control, and are a separate setting (Settings → Board accents, on whenever the scenery is on).
- **Full-area accents (1.4).** One more kind of accent: a single transparent picture over the whole player area, for sparse marks scattered beneath the cards (vines, dead branches, grass, sand and shells, lava) that thicken with the stage. It sits under the strip as well as under the cards, and the same setting covers it.
- **The half board (1.5).** With Settings → Fill each side (on by default), the strip grows into the player's whole half of the board: the same slots, side by side in proportion to the lands, each at its own stage, the cards on top, a soft dark band under each card row. A pack's `half` pictures are drawn where it has them; otherwise its strip art (or the built-in scene) is cover-cropped to the half. Off, the board shows the strip as in 1.4.
- **Bridges (1.8).** Where two biomes meet on one side of the half board, a pack may draw a **bridge** over their seam: a ground object that belongs to both (a river from the lagoon into the forest floor, a road from the plains up into the mountains). A two-colour land still counts ½ to each of its biomes, and also widens the seam between them a little, the bridge with it — the dual is the land that connects.
- **Pair bands (1.9).** A second, optional manifest may give each pair a place of its own: where the two biomes meet on one side of the half board, the seam opens into a third panel, the pair's landscape (named for its dual land), which widens with every land that is both colours.
- **Calm seams (1.10).** A half shows at most three biomes; a seam with a band has no bridge; a half picture changes only at a stage; a full-area accent stays over its own biome.
- **Motifs (1.12).** A pair can be a road up the seam instead of a third picture: drawn over the plain seam, so nothing is cut.
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
| `half` | object | see *The half board* | 1.5. How each half is shared between biomes and meets the other half. |
| `growth` | object | `{ "crossfade": true, "seconds": 1.2 }` | 1.6. The growth between stages: whether the next stage cross-fades in land by land, and how long one land's fade takes. See *Growth between stages*. |
| `bridges` | object | — | 1.8. A ground piece per biome pair, drawn across the seam where the two meet, and how the pair's dual lands widen that seam. See *Bridges across the seam*. |

1.9's pair bands are not a field here: they are a manifest of their own, `pairs.json` (*Pair bands*).

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
| `transitions` | object | — | 1.7. In-between pictures per stage step, played when a land steps the stage. See *Transition frames*. |

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
drawn as is. A full-area piece (`anchor: "area"`, 1.4) is the exception: it is
never flipped vertically (see *Full-area pieces*).

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
| `mirror` | boolean | `true` | Ignored on an area piece: a full-area piece is **never flipped vertically** for the opponent (below). Accepted for compatibility. |
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
- **Never flipped for the opponent.** The picture is drawn upright on both sides, whatever `mirror` says, and left and right do not swap. A full-area piece is composed as objects lying low on the mat (plus things hanging from the rim); flipped, those objects would land at the top of the opponent's half, in their landscape's sky. Upright, its ground objects sit along the **centre seam** of the opponent's half, so both players' accents gather at the middle of the table. Compose with that in mind: what lies low on your side lies by the seam on theirs.
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
  whichever covers it (`cover`): the subject band whole whenever the panel's
  shape allows (when it cannot, the view centres on it), its middle as near
  the panel's middle as the picture allows. A desktop half is about 2.7–5 : 1,
  so a 16 : 5 picture loses a little of its sides or of its top and bottom; a
  phone's half is near 1 : 1, so it shows the phone picture (4 : 5) with a
  little of its sky and ground cut, or, with no phone picture, about the
  middle third of the desktop picture. One picture per biome per half, chosen
  by `srcset` for the screen's density (1x or 2x, never more).
- **The card-row scrim.** Under each row of cards ForgeCoach draws a soft
  tint, no wider than the cards it holds: the board's own background colour at
  `--scn-scrim-strength` (0.35 by default), within 2 px of the cards, then
  feathered to nothing over 14 px, so your art shows through it. Text on the
  board never relies on it: every label (a card's P/T, counters, a pile's
  count, the "No permanents" note) sits on a frame of its own. Cards have their
  own frames too, so busy art under a row is fine. (Until 17 October 2026 the
  band was opaque within 6 px of the cards and feathered from 0.85 over 30 px;
  it hid too much of the art.)
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

**A pack's half pictures.** Give a stage a `half` object, beside its strip
`layers` (so the pack still loads on a client without 1.5): an **opaque**
picture painted for a whole half, used instead of the stage's still layers
when the half is filled, and optionally a portrait **`phone`** picture of the
same scene. Each panel shows the picture whose shape is nearer its own (on a
log scale, so with 16 : 5 and 4 : 5 pictures a panel narrower than about
1.6 : 1 takes the phone one): a phone's half, and a narrow panel of a split on
a desktop, take the phone picture; a desktop half takes the desktop one. A
stage may have a `half` and no `layers`: the strip (Fill each side off) then
shows the desktop picture, cover-cropped about its middle.

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `src` | URL (`.webp` `.avif` `.png` `.jpg`) | — | **Required.** The desktop picture at 1x, opaque. Same URL rules as layers. |
| `src2x` | URL | — | Its 2x file (used through `srcset`). |
| `phone` | `{ "src", "src2x", … }` | — | The phone picture: `src` **required**, `src2x` optional; it may also carry its own `width`, `height`, `subjectBand`, `focal`, `safe` (below). A bad `phone.src` drops only the phone picture. |
| `subjectBand` | `[top, bottom]`, 0–1, at least 0.05 apart | `[0.35, 0.60]` | §5's subject band: where the scene's subject lies, as fractions of the picture's height from the top. The crop keeps it whole whenever the panel's shape allows (across the middle half of the width), and centres on it. On `phone`, the default is the desktop band mapped into the phone picture as if it were outpainted evenly up and down (16 : 5 → 4 : 5: `y ↦ 0.25 + y / 2`, so `[0.425, 0.55]`); give `phone.subjectBand` when the outpainting is not even. |
| `horizon` | 0.05–0.95 | from the band | *1.13.* The horizon's height, a fraction of the picture's height from the top. ForgeCoach's **one horizon** (Settings → One horizon, `?horizon=on`, off by default while it is judged) pins every panel's picture at its horizon, so a side reads as one landscape whatever each panel's width. Without it the horizon is estimated from `subjectBand` (the default band holds the spec's 0.43 a third of the way down; a phone picture's mapped band, 0.465), so a pack whose horizons sit elsewhere in the band should declare them. A bad value is warned and estimated. May also be given on `phone`. |
| `width`, `height` | 64–16384 (whole), a shape between 1 : 4 and 8 : 1 | 2048 × 640 (desktop), 1024 × 1280 (`phone`) | The 1x file's pixel size. Only its shape is used, to crop before the file loads; give them when the files are not pack-v3's sizes. |
| `focal` | `{ "x", "y" }`, 0–1 | the band's middle, centred | Optional, finer than the band: the point kept as near the panel's middle as the picture allows. |
| `safe` | `{ "x", "y", "w", "h" }` | the band across the middle half: `{ x 0.25, y top, w 0.5, h bottom − top }` | Optional, finer than the band: the part kept whole whenever the panel's shape allows (as for full-area accents). |
| `bytes` | whole number | — | Every file of this `half` (`src`, `src2x`, `phone.src`, `phone.src2x`), for the budget (§3). |

**Loops on phones.** A stage's moving layers (video, sprite) play over the
**desktop** picture, in its frame; over the **phone** picture none play: the
loops are cut for the desktop's shape, and a phone saves their bytes and
battery. So a pack needs no phone loops.

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

**How to paint them** (§5, pack-v3): the desktop picture **16 : 5, 2048 ×
640** with a **4096 × 1280** `src2x`; the phone picture **4 : 5, 1024 × 1280**
with a **2048 × 2560** `src2x`, made from the same stage (outpainted up into
sky and down into calm ground); the horizon about **57% up** the desktop
picture; the subject in the **subject band** (35–60% down), centred enough
that the **middle half of the width** tells the story; the **bottom ~30%
calm** (the land row and the scrim sit there); no text, no faces. Each stage
the same place grown, as for the strip. Opaque: no alpha; the mist and the
scrim are ForgeCoach's.

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
        {
          "layers": [{ "id": "sky", "kind": "image", "src": "island/s1-sky.webp", "src2x": "island/s1-sky@2x.webp", "depth": 0, "z": 0, "idle": false }],
          "half": { "src": "island/s1-half.webp", "src2x": "island/s1-half@2x.webp", "phone": { "src": "island/s1-phone.webp", "src2x": "island/s1-phone@2x.webp" }, "subjectBand": [0.35, 0.6], "bytes": 1700000 }
        },
        {
          "layers": [{ "id": "sky", "kind": "image", "src": "island/s2-sky.webp", "src2x": "island/s2-sky@2x.webp", "depth": 0, "z": 0, "idle": false }],
          "half": { "src": "island/s2-half.webp", "src2x": "island/s2-half@2x.webp", "phone": { "src": "island/s2-phone.webp", "src2x": "island/s2-phone@2x.webp" }, "subjectBand": [0.35, 0.6], "bytes": 1800000 }
        },
        {
          "layers": [{ "id": "sky", "kind": "image", "src": "island/s3-sky.webp", "src2x": "island/s3-sky@2x.webp", "depth": 0, "z": 0, "idle": false }],
          "half": { "src": "island/s3-half.webp", "src2x": "island/s3-half@2x.webp", "phone": { "src": "island/s3-phone.webp", "src2x": "island/s3-phone@2x.webp", "subjectBand": [0.4, 0.58] }, "subjectBand": [0.33, 0.6], "bytes": 1900000 }
        },
        {
          "layers": [
            { "id": "sky", "kind": "image", "src": "island/s4-sky.webp", "src2x": "island/s4-sky@2x.webp", "depth": 0, "z": 0, "idle": false },
            { "id": "motes", "kind": "video", "src": "island/s4-motes.webm", "fallback": "island/s4-motes.mp4", "poster": "island/s4-motes.webp", "blend": "screen", "z": 10, "depth": 0.4 }
          ],
          "half": { "src": "island/s4-half.webp", "src2x": "island/s4-half@2x.webp", "phone": { "src": "island/s4-phone.webp", "src2x": "island/s4-phone@2x.webp" }, "subjectBand": [0.35, 0.6], "bytes": 2000000 }
        }
      ]
    }
  }
}
```

Every stage keeps its strip `sky` (so a client older than 1.5 draws the
strip as before) and adds its `half`: the desktop and phone pictures and the
subject band. Stage 3's outpainting is not even, so its phone picture says
where its band lies. Stage 4's loop plays over the desktop picture (screen
blend), not over the phone one. The island declares 7.4 MB of half pictures
(desktop and phone, 1x and 2x), under the 8 MB (8,388,608-byte) budget.

`src/ambience/half.test.ts` validates this exact block. If you change it, it
must stay error- and warning-free.


### Growth between stages (1.6)

The stages are still the levels a biome arrives at (1 / 2–3 / 4–5 / 6+
lands); 1.6 fills in the space between them. A biome's **progress** toward
its next stage (§1) sets how strongly the next stage shows over the current
one, eased (sine in-out, so half the way is half the picture; a dual's
quarter-land is about a seventh):

| Lands (default thresholds) | Drawn |
| --- | --- |
| 1 | stage 1 |
| 2 | stage 2 |
| 3 | stage 2, with stage 3 at ½ over it |
| 4 | stage 3 |
| 5 | stage 3, with stage 4 at ½ over it |
| 6+ | stage 4 |

**What fades in, and what does not.**
- **Half pictures** (1.5): the next stage's `half` picture over the current one, each in its own crop (its own `subjectBand`, `focal`, `safe`). With the half filled, a slot draws at most **two pictures** once a fade has run. *Since 1.10 a half picture no longer fades in by the progress: between two thresholds the slot widens and keeps its stage's picture, and the next one arrives at its threshold (§2, *Calm seams*).*
- **Strip layers**: the next stage's **still** (`image`) layers whose file or box differs from the current stage's layer with the same `id`, or whose `id` is new. A layer kept unchanged (same `id`, file and box) is drawn once.
- **Moving layers** (`video`, `sprite`) are the current stage's only: the next stage's loops start when the stage is reached, so the moving-layer budget (§3) is unchanged. A stage-4 loop arrives at 6 lands, as before.
- **Accents** (1.3, 1.4): a corner or edge piece that is new in the next stage (a new `id` at that anchor) is drawn already, **still**, at the same fraction of its `opacity`; a piece replaced under the same `id` changes at the threshold. A **full-area** piece whose picture changes (`front-s2` → `front-s3`) cross-fades like a half picture. Fading pieces come after every full piece, so the ≤ 6 cap cuts them first, and they never count as moving. ForgeCoach's built-in accents and its built-in scene grow the same way (a built-in layer that is new in the next stage fades in).
- **The bloom and the flash stay.** A land still flashes its slot (or plays the pack's `landfall`); layers that first appear still bloom; `stageUp` still plays when a land crosses a threshold.

**Motion.** A land's change fades over `growth.seconds` (1.2 s by default),
from the old fraction to the new. At a threshold the next stage's picture,
already half in, keeps fading up to full while the old one stays beneath it,
so a stage-up is as smooth as the lands between. With reduced motion
(`prefers-reduced-motion`, or Settings → Motion → Stills only) every change
is at once. Losing a land runs the same fade backwards.

**Loading.** Stage 1 is preloaded before the scenery shows, as before. As a
slot reaches a stage, ForgeCoach warms that stage's and the **next** stage's
pictures in the background (the half picture, the phone one on a phone; else
the still layers), so the next stage is there before the first land toward
it. A next picture that fails to load is simply not drawn.

**The preview.** `#ambience` → *Lands* has a slider per biome for either side:
one step plays or takes back one basic land, so the growth can be stepped
through land by land with no game (§6).

**Top-level `growth`** (every field optional; a pack without it gets the
defaults, so every 1.0–1.5 pack grows between stages unchanged):

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `crossfade` | boolean | `true` | `false`: the pictures and accents change only at the thresholds, as in 1.5 (the slot width still grows with every land). For art whose stages do not blend well, such as stages composed differently. |
| `seconds` | 0–5 | 1.2 | How long one land's fade takes. 0: at once. |

As elsewhere, a bad value falls back to its default, with a warning.

**How to paint for it.** Nothing new is needed: the stages you already paint
are the levels, and ForgeCoach blends neighbouring stages. The blend reads
best when each stage is "the same place grown" (§4): the same horizon, the
same subject in the same place, new things added rather than moved. Two
stages composed differently show both compositions, half-transparent, at the
3rd and 5th land; a pack whose stages are like that sets `crossfade: false`.

<!-- example-growth -->
```json
{
  "schema": 1,
  "spec": "1.6",
  "name": "Justin's tidewater, slower growth",
  "growth": { "crossfade": true, "seconds": 2 },
  "biomes": {
    "island": {
      "stages": [
        { "layers": [{ "id": "sky", "kind": "image", "src": "island/s1-sky.webp" }] },
        { "layers": [{ "id": "sky", "kind": "image", "src": "island/s2-sky.webp" }] }
      ]
    }
  }
}
```

Each land's fade takes 2 s; at 1½ lands (an Island and a dual) the stage-2
sky shows at about half over stage 1's. `src/ambience/growth.test.ts`
validates this exact block. If you change it, it must stay error- and
warning-free.

### Transition frames (1.7)

A stage step is a jump from one painting to the next. 1.6 cross-fades it;
1.7 lets a pack **draw** it instead, the way limited animation does: two or
three in-between pictures (keyframes, not video), each held a moment and cut
to the next with no blending, then one short fade into the new stage's own
picture. The growth reads as a few drawn frames of the place growing, not a
dissolve.

**When it plays.** On the half board (1.5), when a slot's stage changes by
one or two and the pack has frames for every step crossed, at the shape the
slot is showing (the desktop picture, or the phone one), and the frames are
already loaded. Gaining a land plays a step forward; losing one plays it
backwards; a two-stage jump chains both steps. While the frames play the
picture beneath switches straight to the new stage, so when the last frame
fades out the stage is there. Everything else — the first paint, a bigger
jump, a step or shape with no frames, frames not loaded yet, the strip
without the half filled — cross-fades as in 1.6. The flash, the `landfall`
and `stageUp` effects and the accents' own fades are unchanged.

**Reduced motion** (`prefers-reduced-motion`, or Settings → Motion → Stills
only): no frames; the stage changes at once, as in 1.6.

**Loading.** While a slot sits at a stage, ForgeCoach warms (and decodes)
that slot's **next** step's frames at its shape, so the cuts are never loads.
A step whose frames have not arrived when the land does cross-fades instead.

**Per-biome `transitions`** (every field optional except `steps`):

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `holdMs` | 40–1000 | 200 | How long each frame is held. Long enough for the eye to register each frame as its own picture: at ~120 ms (pack v7) two or three frames read as a quick dissolve; at 200 ms (pack v7.1, about a drawing every fifth frame at 24 fps) the growth steps. |
| `fadeMs` | 0–1000 | 180 | The one fade from the last frame into the new stage's picture. 0: a hard cut there too. |
| `steps` | list | — | **Required.** One entry per stage step that has frames. |
| `steps[].from` | a stage with a next stage | — | **Required.** The step from stage `from` to `from + 1`. At most one entry per step. |
| `steps[].frames` | 1–4 frame objects | — | **Required.** In playing order (forward). Two or three read best; more starts to look like a morph. |
| `steps[].frames[].src` | `.webp` / `.avif` / `.png` / `.jpg` | — | **Required.** The in-between at the desktop `half` shape (16:5, 2048 × 640). |
| `steps[].frames[].phone` | same | — | The in-between at the phone shape (4:5, 1024 × 1280). Without it a phone panel cross-fades that step. |
| `steps[].frames[].holdMs` | 40–1000 | the biome's `holdMs` | This frame's own hold. |
| `steps[].bytes` | whole number | — | The step's files, for the budget (§3). |

A step with an unusable frame is dropped whole (it cross-fades), as is a
step that repeats or whose `from` has no next stage, with a warning each;
when a stage of the biome is dropped, the step numbers no longer line up and
the whole `transitions` is ignored.

**How to paint for it.** Each in-between should be the same place, the same
composition, a little further grown: things that the next stage adds
*arriving* (a little bigger, a little brighter, a little more of them), never
something that appears in one frame and is gone in the next. And each frame
should be **its own picture**, not a double exposure: a frame that is only a
blend of its two stages reads as a dissolve however it is timed. Pack v7.1's
two frames per step were made by img2img at strength 0.45 over the linear
blend of the two stage pictures at ⅓ and ⅔, with one seed per biome and the
two stages' prompts interpolated, then colour-matched to the blend so no
frame flashes (pack v7's, at 0.30 with up to three frames, stayed too close
to the blend). Where the next stage brings a new element that the first
frame would otherwise erase (a faint ghost reads as noise to the model), the
blend was biased toward the next stage in that element's region only, so
the first frame carries an early, partial version of it. A frame is on
screen for a fraction of a second, so it need not be as sharp as a stage:
1x only.

<!-- example-transitions -->
```json
{
  "schema": 1,
  "spec": "1.7",
  "name": "Justin's tidewater, drawn growth",
  "stageThresholds": [1, 2],
  "biomes": {
    "island": {
      "stages": [
        { "layers": [], "half": { "src": "island/s1-half.webp", "phone": { "src": "island/s1-phone.webp" } } },
        { "layers": [], "half": { "src": "island/s2-half.webp", "phone": { "src": "island/s2-phone.webp" } } }
      ],
      "transitions": {
        "holdMs": 200,
        "fadeMs": 180,
        "steps": [
          {
            "from": 1,
            "frames": [
              { "src": "island/s1to2-f1-half.webp", "phone": "island/s1to2-f1-phone.webp" },
              { "src": "island/s1to2-f2-half.webp", "phone": "island/s1to2-f2-phone.webp" }
            ]
          }
        ]
      }
    }
  }
}
```

The second Island plays two frames, 200 ms each, then fades into stage 2
over 180 ms: 580 ms in all. `src/ambience/transitions.test.ts` validates this
exact block. If you change it, it must stay error- and warning-free.

### Bridges across the seam (1.8)

When one side of the board has two colours, the half board (1.5) shows two
pictures side by side, meeting in a soft seam: two postcards laid edge to
edge. 1.8 lets a pack draw something **both biomes share** across that seam
— a ground object, true to both colours: a river leaving the lagoon into the
forest floor, a road from the plains up into the mountains, a causeway of
bone over the swamp into the meadow, lava running into the sea. And it gives
two-colour lands a visible job: each one **widens the seam** between its two
biomes, and the bridge grows with it.

**When it is drawn.** On the half board (Settings → Fill each side), for every
two neighbouring panels that both have lands (a withered panel's seam has
none) whose pair has an entry under `bridges`. Any order: the pair is looked up
alphabetically (`island` and `forest` find `"forest+island"`), and the piece is
**mirrored** when the board has the two the other way round from the key (the
key's order is the art's left and right). A side with three biomes draws a
bridge on each of its two seams that has one. *Since 1.10 a seam with a pair band (1.9)
draws the band and no bridge, and its duals widen the band, not the seam
(§2, *Calm seams*).*

- **Where.** The piece's **centre** sits on the middle of the seam across the
  half, at `anchor.y` of the half's height down (0 the half's top, 1 its
  bottom; your half and the opponent's are both upright, so the lower part is
  the ground on both), **`anchor.width`** of the half's width wide (its height
  follows the picture's shape). It follows the seam as the panels' shares
  change with every land, as the panels do (900 ms).
- **Z-order.** Over both panels and their seam mist, under the centre line's
  mist band (it fades with the panels there), the full-area accent, the
  card-row scrim and every card.
- **Desktop or phone.** The `phone` piece where the half itself is nearer the
  phone picture's shape (4 : 5) than the desktop one's (16 : 5) on a log scale
  (narrower than about 1.6 : 1: a phone's half, about square); else, or with
  no `phone`, the desktop piece.
- **Arrival and departure.** It fades in with the second biome's arrival, over
  that biome's `bloom.durationMs`, once its file has loaded; when either biome
  loses its lands it fades out the same way. On the first paint (a page
  opened mid-game) it is simply there. **Reduced motion**
  (`prefers-reduced-motion`, or Settings → Motion → Stills only): no fade,
  there or gone at once.
- **Loading.** A side's bridge warms in the background with its split's
  pictures, at the shape the board shows. A piece that fails is not drawn.
- **Dual lands.** A land that counts ½ to each of exactly two biomes (a
  "Land — Forest Island", or a land that taps for exactly those two colours,
  §1) is a **dual** of that pair. Each dual on the side widens that pair's
  seam by `dualsWiden` of the half's width, up to `maxSeamRatio`: the
  overlap grows, the bridge is scaled by the same factor (seam ÷ the
  `half.seamRatio` it was drawn for), and the gradient and its mist widen with
  it. The weights stay ½ / ½ (shares, stages and growth are unchanged). A
  pair with no bridge keeps the plain seam, whatever its duals: the widening
  is the bridge's. A triome (three colours) widens nothing.

**Top-level `bridges`**: an object keyed by pair, `"<biome>+<biome>"` (two
different biomes, either order; a pair given twice keeps the first, with a
warning). Each entry:

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `src` | URL (`.webp` `.avif` `.png` `.jpg`) | — | **Required.** The desktop seam crop: a transparent picture painted over the two biomes' desktop half pictures meeting at a seam, the key's first biome on the left. |
| `src2x` | URL | — | Its 2x file (through `srcset`). |
| `anchor` | `{ "y", "width" }` | `{ "y": 0.72, "width": 0.4 }` | `y` 0–1: the centre's height as a fraction of the half's, from its top. `width` 0.05–1: the piece's width as a fraction of the half's width, at the plain seam. A bad value falls back to its default. |
| `phone` | `{ "src", "src2x", "anchor" }` | — | The phone seam crop, painted over the two phone pictures; `src` **required**; its `anchor` defaults to the desktop one's. A bad `phone.src` drops only the phone piece. |
| `dualsWiden` | 0–0.1 | 0.02 | How much each dual of the pair widens their seam, as a fraction of the half's width. 0: duals change nothing. |
| `maxSeamRatio` | 0–0.3 | 0.18 | The widest the duals make that seam. Never narrower than the plain seam. |
| `bytes` | whole number | — | Every file of the entry (`src`, `src2x`, `phone.src`, `phone.src2x`), for the budget (§3). |

An entry with no usable `src` is dropped (that pair keeps the plain seam), and
out-of-range numbers fall back to their defaults, each with a warning. A
1.0–1.7 pack has no `bridges`: every seam is drawn as before, duals or not.

**How to paint them.** A ground object, never a sky-crossing one: an arch or
a vine bridge through the sky smudges into haze (and would cross two different
skies). Keep it below the horizon, in the lower half of the piece, wider and
nearer on one side, narrower and further on the other, so it reads as lying
on both grounds. Paint it over the seam as ForgeCoach composites it (§2, *The
half board*: equal shares, the 10% overlap with its gradient and mist), then
keep only the object with a **soft alpha falloff** (no hard edge anywhere, and
nothing where the piece's box ends), so it melts into whatever stage either
side is at. One piece per pair serves every stage.
pack-v8 was made that way: each pair's stage-3 pictures composited at a
2560 × 800 desktop half and a 1280 × 1280 phone half, the object's shape
painted in at 60%, img2img at strength 0.68 (DreamShaper XL), kept inside the
shape's feathered mask; desktop pieces 1024 × 440 at `anchor`
`{ "y": 0.725, "width": 0.4 }`, phone pieces 768 × 704 at
`{ "y": 0.725, "width": 0.6 }`.
pack-v9 repainted them as **one picture across the seam**, with no object
outline: the same composite, img2img with a strength map high over the
seam's ground and falling away to both sides and up to the horizon (0.62),
a prompt naming where the two grounds meet (a lava-rock shore with surf, a
sandy beach), and that same soft shape as the alpha; same sizes and anchors
(`~/scenery-packs/seams-v1/`). A piece painted in one stage's light still
sits in that light at every stage.

<!-- example-bridges -->
```json
{
  "schema": 1,
  "spec": "1.8",
  "name": "Justin's tidewood, a river across the seam",
  "stageThresholds": [1, 2],
  "half": { "seamRatio": 0.1 },
  "biomes": {
    "forest": {
      "stages": [
        { "layers": [], "half": { "src": "forest/s1-half.webp", "phone": { "src": "forest/s1-phone.webp" } } },
        { "layers": [], "half": { "src": "forest/s2-half.webp", "phone": { "src": "forest/s2-phone.webp" } } }
      ]
    },
    "island": {
      "stages": [
        { "layers": [], "half": { "src": "island/s1-half.webp", "phone": { "src": "island/s1-phone.webp" } } },
        { "layers": [], "half": { "src": "island/s2-half.webp", "phone": { "src": "island/s2-phone.webp" } } }
      ]
    }
  },
  "bridges": {
    "forest+island": {
      "src": "bridges/forest-island.webp",
      "phone": { "src": "bridges/forest-island-phone.webp", "anchor": { "y": 0.725, "width": 0.6 } },
      "anchor": { "y": 0.725, "width": 0.4 },
      "dualsWiden": 0.02,
      "maxSeamRatio": 0.18,
      "bytes": 230000
    }
  }
}
```

You play an Island, then a Forest: your half splits island | forest, the
reverse of the key, so the river is drawn **mirrored** (it leaves the lagoon
on the left). Its centre sits on the seam, 72.5% of the way down your half,
40% of the half wide. Then two more of each and two Breeding Pools ("Land —
Forest Island", ½ to each): island 3, forest 3, equal shares, and two duals,
so on a desktop half 1600 px wide the seam is 0.10 + 2 × 0.02 = **0.14** of
it (224 px), the panels are 912 px each with the second starting at 688 px,
the seam's middle — the river's centre — is at **800 px**, and the river is
0.4 × 1.4 = **0.56** of the half wide (896 px). Two more Breeding Pools take
the seam to the 0.18 cap; a fifth adds nothing. On a phone (a half about
square) the phone piece is drawn, 60% of the half wide at the plain seam.
`src/ambience/bridges.test.ts` validates this exact block and checks these
numbers. If you change it, it must stay error- and warning-free.

### Pair bands (1.9)

A bridge (1.8) is an accent on the seam; the seam itself is still two
postcards meeting. 1.9 lets the seam **become a place**: when one side of the
half board has two colours, a third painted panel opens between their two
pictures, the colour pair's own landscape (named for its dual land: Tundra's
ice shelf between the island and the plains, Volcanic Island's cone between
the sea and the mountains), and every land that is **both** colours widens it.

**A second manifest.** The pair pictures are a pack of their own,
`pairs.json` at the root of a **pairs URL**, fetched beside `scenery.json`
(the live pack fills most of jsDelivr's 50 MB per ref, so the pairs live in a
ref of their own). ForgeCoach's own pairs come with ForgeCoach's own pack
(they were painted to meet its pictures): `FORGECOACH_PAIRS_URL` in
`src/ambience/prefs.ts`. Any page takes **`?pairs=<url>`** (a folder holding
`pairs.json`, or the `.json` itself) or `?pairs=off` for one page load; a pack
of your own has no pairs unless you pass one. A pairs manifest that does not
load or validate only means no bands (the console says why); it never holds
the pack back.

**When a band is drawn.** On the half board (Settings → Fill each side), for
every two neighbouring panels that both have lands whose pair has an entry in
`pairs.json`. Any order: the entry is found by the pair's alphabetical key
(`island` and `forest` find `"forest+island"`), and its pictures are
**mirrored** when the board has the two the other way round from the key (the
key's first biome is the art's left). Three colours on a side make two seams
and two bands, each with its own entry. No pairs, no entry, the strip (Fill
each side off) or a withered neighbour: the seam is drawn exactly as in 1.8.

- **Width.** `band.min` of the half's width as soon as the side has both
  colours, plus `band.perDual` for each of the side's lands that is **both**
  colours (a dual, a shock, a Pathway, a "taps for either" land, a Thriving
  land whose chosen colour is the other one: §1), at most `band.max`. It is
  the 1.8 seam's rule (`seamRatio` + `dualsWiden` per dual, at most
  `maxSeamRatio`) with the band's own numbers, and the duals are counted the
  same way. The defaults reach a full middle third (0.34) at six duals.
- **Where.** The band is a panel of the half's row between its two biomes.
  Each of them **gives up half its width**, but never more than half its own
  share: next to a narrow panel the band is narrower (the floor), so no panel
  disappears. The band meets each neighbour in **half the seam they met in**
  (the gradient mask and its breath of mist), so a band of no width is exactly
  the seam it replaces, a bridged pair's widened seam included. The shares
  move with every land, as the panels do (900 ms).
- **The crop.** The band shows its picture cover-cropped about the picture's
  focal point (by default its centre, in the subject band), as a panel does
  (1.5): a narrow band shows the heart of the place (the ice cliff, the
  volcano, the mesa), a wide one the whole picture. The `phone` picture where
  the half itself is phone-shaped (narrower than about 1.6 : 1, as a bridge's
  phone piece), else the desktop one.
- **Stage.** `stageMap` maps the **lower** of the two neighbours' stages to the
  pair's stage: with the default `[[1, 2], [3, 4], [5, 6]]`, neighbours at
  stages 1–2 show the pair's stage 1, 3–4 its stage 2, 5–6 its stage 3. A
  stage past the pair's last picture shows the last.
- **Stage steps.** When the pair's stage changes, its **transition frames**
  play (the pair's own `transitions`, in 1.7's shape and with 1.7's rules:
  hard cuts at each hold, then one fade; backwards when it shrinks; only
  frames already loaded), else the band cross-fades over `growth.seconds`.
  Between stages there is no growth cross-fade: the band grows in width.
- **Z-order.** A band is a panel: over the panel on its left, under the one on
  its right where they overlap, under the centre line's mist band, the full-area
  accent, the card-row scrim and every card. *(Until 1.10 a bridge on the same
  seam was drawn over the band; since 1.10 a banded seam has no bridge.)*
- **Arrival and departure.** A band opens once its picture has loaded: until
  then it has no width and the seam is today's. It then widens from nothing
  and fades in over the later biome's `bloom.durationMs`; when either biome
  loses its lands it fades out and gives its width back the same way. On the
  first paint (a page opened mid-game) it is simply there. **Reduced motion**:
  no fade and no widening, there or gone at once.
- **Loading.** A side's band pictures (the pair stage its neighbours map to,
  and the next one) warm in the background with the split's pictures, at the
  shape the board shows; the next step's frames warm while the band sits at
  its stage. A picture that fails is not drawn (the seam stays).
- **Names.** `dual` and `shock` are the names the place is painted for. They
  are shown in captions (the `#ambience` preview names each side's bands) and
  never read by anything else.

**`pairs.json`** (top level):

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `schema` | `1` | — | **Required.** |
| `spec` | `"1.9"` | — | Informational, as in `scenery.json`. |
| `name`, `author`, `license` | string ≤ 80 | "Untitled pairs" | Shown on `#ambience`. |
| `note` | string ≤ 400 | — | Shown on `#ambience` (a draft says so here). |
| `pairs` | object | — | **Required.** Keyed by pair, `"<biome>+<biome>"`: two different biomes, either order (both orders are one pair; a pair given twice keeps the first, with a warning). At least one usable entry. |

**Each pair:**

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `dual`, `shock` | string ≤ 60 | — | The dual land and the shock land the place is named for. Captions only. |
| `stages` | 1–6 objects `{ "half": … }` | — | **Required.** The pair's stages, `stages[0]` its stage 1 (three is the plan). Each `half` is exactly a stage's 1.5 `half`: `src` (**required**), `src2x`, `phone` (`src`, `src2x`, `subjectBand`, …), `subjectBand`, `width` / `height`, `focal`, `safe`, `bytes`. A stage without a usable `half` is dropped (and then `transitions` is ignored, as in 1.7); a pair with no stage left is dropped. |
| `transitions` | 1.7's `transitions` | — | `holdMs`, `fadeMs`, `steps[]` of `from` and `frames[]` (`src`, `phone`, `holdMs`), `bytes`: the in-betweens of the pair's own stage steps. |
| `band` | `{ "min", "perDual", "max" }` | `{ 0.10, 0.04, 0.34 }` | Fractions of the half's width. `min` 0–0.5, `perDual` 0–0.2, `max` 0–0.6 and never under `min`. A bad value falls back to its default, with a warning. |
| `stageMap` | `[[from, to], …]` | `[[1, 2], [3, 4], [5, 6]]` | Neighbour stages per pair stage: entry k holds the lower neighbour stages that show pair stage k + 1, from stage 1 up with no gap (1–6). Anything else falls back to the default, with a warning. |
| `bytes` | whole number | — | Anything of the pair's not declared in its stages and steps, for the budget (§3). |

As elsewhere, every URL is http(s) or relative to `pairs.json`, every string
is cleaned and every number range-checked; unknown fields are ignored.

**How to paint them** (the concept sheet of 2026-10-16,
`~/scenery-packs/pair-scenery-concepts/`): a composite of the two biomes'
pictures at the same stage, A | M | B at the half's size each (2048 × 640),
the middle M started from the two mirrored and cross-faded with the horizon
warped from A's height to B's; img2img over A's inner 512 px | M | B's inner
512 px with a strength map (about 0.18 at the sides, 0.66 in the middle), then
the middle 2048 × 640 kept. Each place's outer 10–15% stays close to its
neighbour, which is what lets the band meet the panels at any width; its heart
(the thing a narrow band shows) in the middle third. Opaque, the subject in
the subject band, the bottom ~30% calm, as any half picture (1.5); the phone
picture the same place at 4 : 5. Each stage the same place grown, painted
against the neighbours' stages it is shown beside (`stageMap`). One entry per
pair serves both orders (mirrored), so nothing in it may read only one way
round (no text, no lettering, no one-handed subject).

<!-- example-pairs -->
```json
{
  "schema": 1,
  "spec": "1.9",
  "name": "ForgeCoach pair scenery, pairs-v1",
  "author": "jalirkan",
  "license": "CC BY 4.0",
  "note": "The shape pairs-v1 ships in (spec 1.9): three stages per pair, desktop and phone at 1x and 2x, two frames per step. The bytes are placeholders; the art lane writes the real ones.",
  "pairs": {
    "forest+island": {
      "dual": "Tropical Island",
      "shock": "Breeding Pool",
      "band": {"min": 0.1, "perDual": 0.04, "max": 0.34},
      "stageMap": [[1, 2], [3, 4], [5, 6]],
      "stages": [
        {"half": {"src": "pairs/forest-island/s1-half.webp", "src2x": "pairs/forest-island/s1-half@2x.webp", "phone": {"src": "pairs/forest-island/s1-phone.webp", "src2x": "pairs/forest-island/s1-phone@2x.webp"}, "subjectBand": [0.35, 0.6], "bytes": 380000}},
        {"half": {"src": "pairs/forest-island/s2-half.webp", "src2x": "pairs/forest-island/s2-half@2x.webp", "phone": {"src": "pairs/forest-island/s2-phone.webp", "src2x": "pairs/forest-island/s2-phone@2x.webp"}, "subjectBand": [0.35, 0.6], "bytes": 380000}},
        {"half": {"src": "pairs/forest-island/s3-half.webp", "src2x": "pairs/forest-island/s3-half@2x.webp", "phone": {"src": "pairs/forest-island/s3-phone.webp", "src2x": "pairs/forest-island/s3-phone@2x.webp"}, "subjectBand": [0.35, 0.6], "bytes": 380000}}
      ],
      "transitions": {
        "holdMs": 200,
        "fadeMs": 180,
        "steps": [
          {"from": 1, "frames": [{"src": "pairs/forest-island/s1to2-f1-half.webp", "phone": "pairs/forest-island/s1to2-f1-phone.webp"}, {"src": "pairs/forest-island/s1to2-f2-half.webp", "phone": "pairs/forest-island/s1to2-f2-phone.webp"}], "bytes": 190000},
          {"from": 2, "frames": [{"src": "pairs/forest-island/s2to3-f1-half.webp", "phone": "pairs/forest-island/s2to3-f1-phone.webp"}, {"src": "pairs/forest-island/s2to3-f2-half.webp", "phone": "pairs/forest-island/s2to3-f2-phone.webp"}], "bytes": 190000}
        ]
      }
    }
  }
}
```

The pairs live at `…@pairs-v1/`, so this file is `…@pairs-v1/pairs.json`
and its pictures resolve beside it. You play an Island, then a Forest: your
half splits island | forest and the band opens between them, mirrored (the
key has the forest on the left), at **0.10** of the half: half of it from
each panel (0.45 each), and on a desktop half 1600 px wide it overlaps each
neighbour by half the 0.10 seam (80 px). On a pack whose thresholds are
`[1, 2, 3, 4, 5, 6]` (ForgeCoach's own) both biomes are at stage 1, so the
band shows pair stage 1. Then another Island and Forest and two Breeding
Pools ("Land — Forest Island", ½ to each): island 3, forest 3, two duals, so
the band is 0.10 + 2 × 0.04 = **0.18** (the panels 0.41 each) and the
neighbours' lower stage is 3: pair stage **2**, its 1 → 2 frames playing
(two frames, 200 ms each, then 180 ms into stage 2). Across that half the
row is 1600 + 2 × 80 = 1760 px, the band is 0.18 × 1760 ≈ **317 px** wide and
its centre is at 0.5 × 1760 − 80 = **800 px**, where a bridge on that seam
is drawn over it. Four more Breeding Pools (six duals) take it to the 0.34
cap; a seventh adds nothing. Next to a panel at its 0.15 floor, a 0.34 band
takes only half that panel's share from it, and is drawn 0.15 wide.
`src/ambience/pairs.test.ts` validates this exact block, checks it is the
`forest+island` entry of `docs/pairs-manifest-draft.json` (all ten pairs in
this shape, the file the art lane matches) and checks these numbers. If you
change it, it must stay error- and warning-free.

### Calm seams (1.10)

On 17 October 2026 Justin played the half board with pack-v8 and pairs-v2 and
called the seams "janky", "pretty crazy", "messed up": a hard cut with a
smudge over it, a bridge pasted over a pair band, a lava river running into
the sea with no shore, a shell over a volcano, a doubled horizon, and a fog of
four biomes in one half. The diagnosis (`~/scenery-packs/seams-v1/diag/DIAGNOSIS.md`)
found most of it in the layout, not the pictures. 1.10 changes only what
ForgeCoach draws; no manifest field is new, and every pack and pairs manifest
is read as before.

- **At most three panels a half.** A half shows the **three heaviest** live
  biomes by land weight (a tie goes to the earlier arrival; a withered panel
  only when fewer than three are live). Each biome left out **folds** into the
  nearest kept panel in the row (a tie goes to the heavier, then the left one):
  its land weight is added to that panel's share, so the half is still split by
  every land, but its picture, its seams and its bands are not drawn. The kept
  panel keeps its own stage (an Island does not grow the forest). Three panels
  make at most two seams, or two bands and four band edges; four biomes made
  three bands and six seams, none wide enough to read. The strip (Fill each
  side off) and the accents' corner and edge pieces are unchanged.
- **The band wins its seam.** A seam whose pair has an entry in `pairs.json`
  (1.9) draws the band and **no bridge** (1.8), whether or not the band's
  picture has loaded yet, and keeps the base `seamRatio` (the duals widen the
  band, by its `perDual`). A bridge was painted over a plain seam; over the
  pair's own place it is a second picture pasted on the first. A bridge is
  drawn only on a seam with no band: no pairs, `?pairs=off`, or a pair with no
  entry.
- **One horizon per panel.** A half picture (1.5) is a whole painting with its
  own horizon; at a partial progress (1.6) the next stage half over it showed
  both (a dual's half land does it on ForgeCoach's pack, whose every land is a
  stage). Between two thresholds a slot now keeps its stage's half picture and
  only widens; the next picture arrives at its threshold, through its frames
  (1.7) or the fade over the old picture held beneath. Strip layers (packs
  without `half`) cross-fade by the progress as before, and so do the accents.
- **A full-area accent over its own panel.** On a split half, the full-area
  piece (1.4), which is the dominant biome's, is masked to that biome's panel:
  whole across it, eased out over the seams (or band edges) it shares with its
  neighbours. The island's shells no longer lie over the volcano, nor the
  plains' feathers over the lagoon. A half with one panel draws it whole, as
  before; a biome folded away draws none.
- **Less mist.** The seam's breath of mist is drawn only on a plain seam (a
  pair band is the transition itself), over the middle half of the seam,
  below the sky, at half the mist colour: seams no longer add up to a tint
  over the half. The ramp itself stays straight: an eased (smoothstep) ramp
  was tried and measured worse, its steeper middle a bigger step across the
  seam on all ten pairs (`~/scenery-packs/seams-v1/SUMMARY.md`).

**How to paint for it.** Nothing new is needed. A pair band still meets its
neighbours in half their seam; a narrow band (the 0.10 `min`) shows only the
heart of its picture, so its outer edges, painted to continue the neighbours'
own edges, are rarely on screen: paint the heart's sides to sit on either
neighbour's colours and horizon too.

`src/ambience/seams.test.ts` checks these rules on pack-v8 and pairs-v2 as
jsDelivr serves them.

### Land rules (1.11)

On 17 October 2026 Evan's Arid Mesa drew the built-in grey Wastes scene over
his whole half, and a withered grey sliver of it stayed after he cracked it.
An audit of every land in Justin's cubes
(`~/scenery-packs/seams-v1/FOLLOW-UP.md`, `lands-audit.csv`: 124 cards) found
34 that fell to that default and 10 Pathways counted as both colours. 1.11
changes only how a land is classified (`src/ambience/model.ts`
`landBiomes`); no manifest field is new, and every pack and pairs manifest is
read as before.

| The land | Examples | It draws |
| --- | --- | --- |
| Basic land types on its type line | Island, Snow-Covered Island; Bayou, the shocks, Hedge Maze; the Triomes | each type's biome, split evenly (½ / ½, ⅓ each); two types are a dual of their pair (1.8, 1.9). Unchanged |
| Chooses a colour as it enters | the Thriving lands | its fixed colour; with the viewing seat's own choice, ½ / ½ and a dual. Unchanged |
| Two land faces, or a land face (Pathway, MDFC) | Blightstep Pathway // Searstep Pathway; Soporific Springs | the face in play only: Blightstep a swamp, Searstep a mountain, **not a dual** (1.9 counted both faces) |
| Taps for one or two colours, no basic type | painlands, checklands, bouncelands, gainlands, temples, filter lands, the Restless lands | those colours, ½ / ½ and a dual for two. Unchanged |
| Taps for three fixed colours | Seaside Citadel, the Lairs | ⅓ each, as a Triome (was `wastes`) |
| Makes no coloured mana | the fetch lands, Evolving Wilds, Prismatic Vista; Ancient Tomb, Ash Barrens, the MH3 Landscapes; Mishra's Factory, Mutavault; Urza's Saga; Strip Mine, Wasteland; the basic Wastes | **nothing** (was `wastes`): no slot, no flash, no widening. A fetch land's slot is claimed by the land it fetches |
| Taps for any colour | City of Brass, Exotic Orchard, Mana Confluence, Command Tower | **nothing** (was `wastes`): four or five colours say nothing the deck's other lands do not |
| No basic type, and no card data | any typeless land while Scryfall is offline, rate-limited, or not loaded yet | **nothing**, quietly (was `wastes`); the console says so once per card in development. The engine never sends a land's mana ability, so card data is the only source; when it arrives the scenery is counted again |

Everything that is not a land is still not scenery (a Mox, a Treasure, a
mana creature), a face-down land is still nothing, and a type-changing effect
still wins (under Blood Moon an Arid Mesa reads `Land — Mountain` and draws a
mountain). No land claims the `wastes` biome now; the name stays valid so a
pack that paints one still validates, and `#ambience` no longer offers a
Wastes or five-colour land.

`src/ambience/model.test.ts` checks every row with the audit's own examples.
### Motifs (1.12)

1.10 calmed the seam, but a pair band (1.9) still shows a slice of a
landscape painted 16 : 5: at 0.10–0.34 of the half it is a vertical strip
with two hard sides, and those sides meet two other paintings. Justin chose
the fix on 19 October 2026 ("go with the road"): paint the band **for the
strip**, as a motif with its own outline, and let the seam underneath stay
the plain seam. The motif is the thing both lands share, running from the
foreground up the seam to the horizon: a turquoise river between jungle
mounds (Breeding Pool), a mountain pass road (Plateau), a frozen road
(Tundra), a boardwalk causeway over the bog (Bayou), a road cut through black
rock with glowing cracks (Badlands). Its banks are the band's edges; there is
no rectangle, so nothing is cut.

**A motif is drawn over the band's picture, and a motif pair's picture is
the plain seam.** Each stage of a pair may carry a **`motif`**: a
transparent picture (`src`, `src2x`, `phone`, `width` / `height`, `bytes`,
the fields of a 1.5 `half`). There are two kinds of pair:

- **A motif pair**: no stage has a `half`. The panels give up no width: the
  seam between the two biomes is drawn exactly as a plain 1.10 seam (the
  base `seamRatio`, its gradient and its mist), the live blend of the two
  neighbours as the board crops them right now, and the motif is drawn over
  it. A baked blend would be a third picture again: the neighbours' crops move
  with every land, and only the live seam always matches them.
- **A band pair** (1.9): every stage has a `half`, the band is a panel as
  before, and a stage's `motif`, if it has one, is drawn over the band's
  picture, filling the band's box, cross-fading with its stage.

A pair's kind is decided by its stages: any `half` makes it a band pair, and
then a stage without a usable `half` is dropped (1.9's rule); with no `half`
anywhere, a stage needs a usable `motif` or is dropped. One manifest may mix
the two kinds.

**Where a motif pair's motif is drawn.**
- **Box.** Centred on the middle of the seam (where 1.8 centres a bridge),
  from the top of the half to its bottom, `band` wide: `band.min` of the
  half's width as soon as the side has both colours, `band.perDual` more per
  land that is both colours, at most `band.max` (1.9's width rule), and never
  wider than either neighbour's share (so it covers at most half of each panel
  beside it). It follows the seam as the shares move (900 ms).
- **Fit.** The picture is **stretched** to the box (`fill`), never cropped:
  its soft edges are the motif's edges and must stay whole. Paint it at the
  width it is drawn at most (pairs-v3: two duals' worth); a wider or narrower
  box stretches it sideways, which for a road in perspective is a wider or
  narrower road (its edges keep meeting at the vanishing point).
- **Desktop or phone.** The `phone` picture where the half is phone-shaped
  (narrower than about 1.6 : 1, as 1.8 and 1.9 choose), else the desktop one.
- **Mirror, stage, captions.** As a band: mirrored when the board has the
  pair the other way round from the key, `stageMap` on the lower neighbour's
  stage, `dual` and `shock` for captions only.
- **Z-order.** Over both panels, their seam and its mist; under the centre
  line's mist band (it fades with the panels there), the full-area accent, the
  card-row scrim and every card. The seam draws **no bridge** (1.10's rule:
  the pair wins its seam).
- **Arrival, departure, loading, reduced motion.** As a band: it fades in
  over the later biome's bloom once its picture has loaded, fades out when
  either biome loses its lands, and is there or gone at once with reduced
  motion. The motifs the board may need next warm with the split's pictures.
- **Stage steps.** A motif pair's frames are its **`motifTransitions`**, in
  1.7's shape (`holdMs`, `fadeMs`, `steps[]` of `from` and `frames[]` of
  `src` and `phone`), each frame a transparent in-between of the motif,
  played with 1.7's rules; with none, the motif cross-fades over
  `growth.seconds`. A motif pair's `transitions` and a band pair's
  `motifTransitions` are ignored, with a warning.

**Each stage, the new field** (beside 1.9's `half`):

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `motif` | a 1.5 `half` object | — | `src` (**required**; `.webp`, `.avif`, `.png` or `.jpg`, with alpha), `src2x`, `phone` (`src`, `src2x`), `width` / `height` (the 1x file's pixels: give them, the reader's default is a desktop half's 2048 × 640), `bytes`. `subjectBand`, `focal` and `safe` are read and not used (a motif is never cropped). A bad `motif` drops only the motif (and the stage too, in a motif pair). |

**Each pair, the new field:**

| Field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `motifTransitions` | 1.7's `transitions` | — | A motif pair's in-between motifs per stage step. |

`bytes` on each `motif` counts toward 1.9's 4 MB of stage pictures per pair.

**How to paint a motif** (pairs-v3, `~/scenery-packs/seams-v1/road/`):
compose the pair's two neighbours as ForgeCoach draws a plain seam (equal
shares, the 10% gradient), in the light of the stage the motif is shown
beside (pair stage 1 over their stage 1, 2 over 3, 3 over 5); paint a guide
in code, the road's wedge in perspective (centred on the seam, wide at the
bottom, a point on the horizon) filled with its material; img2img with a
strength map high over the road and its banks and falling away to the box's
sides and above the horizon; then keep the box with **the strength map's own
soft shape as the alpha**: 1 over the road and its near banks, 0 at the box's
sides and above the horizon, never a line. Same seed and geometry at each
stage, so the three are one road growing: a faint track at stage 1, a worn
road at 2, the full road with its landmark at the vanishing point at 3. One
entry serves both orders, so keep it mirror-safe (no lettering, no
one-handed subject). There is no night variant: a stage-3 motif is painted
in its neighbours' stage-5 light and also shown beside their stage 6, as a
1.9 band's stage 3 is.

<!-- example-motifs -->
```json
{
  "schema": 1,
  "spec": "1.12",
  "name": "ForgeCoach pair scenery, a motif pair",
  "pairs": {
    "forest+island": {
      "dual": "Tropical Island",
      "shock": "Breeding Pool",
      "band": {"min": 0.2, "perDual": 0.03, "max": 0.32},
      "stageMap": [[1, 2], [3, 4], [5, 6]],
      "stages": [
        {"motif": {"src": "pairs/forest-island/s1-motif.webp", "src2x": "pairs/forest-island/s1-motif@2x.webp", "width": 532, "height": 640, "phone": {"src": "pairs/forest-island/s1-motif-phone.webp", "src2x": "pairs/forest-island/s1-motif-phone@2x.webp", "width": 266, "height": 1024}, "bytes": 200000}},
        {"motif": {"src": "pairs/forest-island/s2-motif.webp", "src2x": "pairs/forest-island/s2-motif@2x.webp", "width": 532, "height": 640, "phone": {"src": "pairs/forest-island/s2-motif-phone.webp", "src2x": "pairs/forest-island/s2-motif-phone@2x.webp", "width": 266, "height": 1024}, "bytes": 200000}},
        {"motif": {"src": "pairs/forest-island/s3-motif.webp", "src2x": "pairs/forest-island/s3-motif@2x.webp", "width": 532, "height": 640, "phone": {"src": "pairs/forest-island/s3-motif-phone.webp", "src2x": "pairs/forest-island/s3-motif-phone@2x.webp", "width": 266, "height": 1024}, "bytes": 200000}}
      ],
      "motifTransitions": {
        "holdMs": 200,
        "fadeMs": 180,
        "steps": [
          {"from": 1, "frames": [{"src": "pairs/forest-island/s1to2-f1-motif.webp", "phone": "pairs/forest-island/s1to2-f1-motif-phone.webp"}, {"src": "pairs/forest-island/s1to2-f2-motif.webp", "phone": "pairs/forest-island/s1to2-f2-motif-phone.webp"}], "bytes": 120000},
          {"from": 2, "frames": [{"src": "pairs/forest-island/s2to3-f1-motif.webp", "phone": "pairs/forest-island/s2to3-f1-motif-phone.webp"}, {"src": "pairs/forest-island/s2to3-f2-motif.webp", "phone": "pairs/forest-island/s2to3-f2-motif-phone.webp"}], "bytes": 120000}
        ]
      }
    }
  }
}
```

You play an Island, then a Forest: the seam between them is the plain seam
(0.10 of the half), and the river is drawn over it, **mirrored** (the key has
the forest on the left), **0.20** of the half wide: on a desktop half 1600 px
wide, the seam's middle is at **800 px** and the motif spans **640–960 px**,
top to bottom, its banks fading into the two panels. Both biomes at stage 1:
pair stage 1, the faint trickle. Two more of each and two Breeding Pools:
pair stage 2 (its two frames, then the fade), 0.20 + 2 × 0.03 = **0.26**
(416 px); four more Breeding Pools take it to the 0.32 cap (512 px). Next to
a panel at its 0.15 floor the motif is drawn 0.15 wide. The panels keep their
whole shares throughout. `src/ambience/pairs.test.ts` validates this exact
block and checks these numbers; `pairs-v3.1.test.ts` is the live manifest (pairs-v3 with Tundra, Underground Sea, Godless Shrine's shrine and every phone motif repainted; `pairs-v3.test.ts` keeps pairs-v3).

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
- **≤ 8 MB per biome** of half pictures, **phone pictures and both 2x files included** (declare `bytes` on each `half`; a `half` repeated across stages counts once; the validator warns past it). Four stages at about 1.6–2 MB each (desktop 1x ~0.35 MB, 2x ~0.8 MB; phone 1x ~0.25 MB, 2x ~0.55 MB) fit.
- **Per stage**: a desktop picture, opaque WebP (quality 80–85) or AVIF, **2048 × 640** at 1x and **4096 × 1280** as `src2x` (16 : 5); and optionally a phone picture, **1024 × 1280** and **2048 × 2560** (4 : 5).
- A device loads only the pictures its panels show, one per biome per half (stage 1's warm in the background, the phone ones on a phone-sized screen), and from 1.6 the next stage's too, which fades in between the thresholds; the browser picks 1x or 2x by the screen's density, never more.
- No phone loops: moving layers play only over the desktop picture, and count against the 2 moving layers per stage as before.

Budgets for transition frames (1.7), counted apart from everything above:
- **≤ 2 MB per biome** of frames (declare `bytes` per step; the validator warns past it). Five steps of two or three frames, desktop and phone, at about 50–80 KB a picture fit.
- **1x only** (no `src2x`): a frame is held about a tenth of a second. Opaque WebP (quality 70–80) or AVIF, at the `half` shapes: **2048 × 640** and **1024 × 1280**.
- **1–4 frames per step**; two or three is the look.
- A device warms only the next step's frames at the shape it shows, never the whole set.

Budgets for bridges (1.8), counted apart from everything above:
- **≤ 3 MB for the pack's bridges** (declare `bytes` per entry; the validator warns past it). Ten pairs at a desktop and a phone piece each, about 100–200 KB a piece, fit.
- **Transparent** WebP (quality 80–86) or AVIF, mostly clear. pack-v8's sizes: the desktop piece **1024 × 440** (1.25x of a 2048-wide half's 0.4), the phone piece **768 × 704**; a `src2x` only if the piece must be sharp on a 2x desktop.
- One piece per pair (it serves every stage); one picture per shape.

Budgets for pair bands (1.9), in their own manifest and their own ref:
- **≤ 4 MB per pair** of stage pictures, desktop and phone, 1x and 2x (declare `bytes` on each `half`; a picture repeated across stages counts once), and 1.7's **≤ 2 MB** of frames per pair. Three stages at about 380 KB each and two steps of two frames fit with room to spare.
- **≤ 45 MB for the pairs pack** (the validator warns past it): a jsDelivr ref holds at most 50 MB, so the pairs never share the main pack's ref.
- The pictures at the `half` shapes: **2048 × 640** (`src2x` 4096 × 1280) and **1024 × 1280** (`src2x` 2048 × 2560); frames 1x only.
- A device loads only the bands its sides show (the pair stage they map to and the next), never the set.

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

  Later stages should look like the same place grown, not a different picture. Reuse ids for layers that stay. From 1.6 neighbouring stages are also cross-faded between the thresholds (*Growth between stages*), so this matters more: what stays in place blends cleanly.
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
4. Drag **Stage** to see every stage of every claimed biome without playing more lands (whole stages, no growth between them).
   **Lands** (1.6) sets a land count per biome for either side, 0–7: one step plays or takes back one land, so the growth between stages can be stepped through land by land, with each land's fade, flash and effects.
   **Pair bands** (1.9): with ForgeCoach's own pack (or `?pairs=<url>`), the pack status names the pairs loaded and each side's header names its bands (the dual, the shock, the width, the duals and the pair stage). Give a side two biomes and the band opens on their seam; *Play → Watery Grave* is a dual of island and swamp: each one widens the Underground Sea band by its `perDual`.
   **Bridges** (1.8): give a side two biomes with a bridge (with Fill each side on) and it fades in on their seam; take one biome's lands back to 0 and it fades out. *Play → Watery Grave* is a dual of island and swamp: each one widens that seam by the pack's `dualsWiden`.
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
in the board's corner. A stage-1 file that fails or takes over 15 s is tried
once more after 2 s before its biome falls back, and a biome that fell back
switches to the pack when its files arrive (waited for up to two minutes), so
a slow first fetch from a CDN costs that biome a while, not the game.

## 7. Content rules

- **Anything that might ever be shared must be original art.** This covers this repository, the public site, screenshots and published packs. That means your own work, or generated or rendered work made from your own prompts and scenes, with no copied artwork.
- **Nothing derived from or resembling someone else's IP goes into ForgeCoach.** No card art, set symbols, logos, named planes or characters, and no imitation of a recognisable artist's work. A pack like that may live on your own machine, for your own play, served from `127.0.0.1`. It is never committed here, never uploaded, and never put in a published URL.
- **Packs are never committed to this repository.** That includes original ones. This repo ships only the engine, the procedural fallback and this spec. Keep packs in their own folder or repository.
- **No text, faces of real people, or symbols in the art.**
