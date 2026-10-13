# The Two Seats, round 9: the faces' painted finish over round 8's form

*Written 2026-10-13. This is the sleeve art for the Dragon Shield standard sleeves:
1500 × 2100 px at 600 dpi, 5:7, exact 180° symmetry, with what matters inside a
110 px margin. Rounds 1 to 8 are untouched.*

## The brief

Justin, on round 8: "I thought the simple drawing you sent me was about FORM. I
didn't think it was the style we were going with. It's way too simple. It doesn't
match the oil-painting look of their faces. The items are also too clip-arty.
Either no items, or the same style, like oil-painting stuff."

So round 8's form is locked (both hands holding a modest fan together at the
centre of the chest; the arms part of the cloak from shoulder to wrist; folds on
the chest; small props on the table's edge), and round 9 changes only its finish,
to the faces' own painted manner. Two versions of each sitter: **A, with props**,
painted the same way, and **B, no props**, with round 2's table band. The
direction doc's section now carries the correction
([`../../PROXY-BACK-DIRECTION.md`](../../PROXY-BACK-DIRECTION.md)).

## What is here

| File | What it is |
|---|---|
| `two-seats-<sitter>-props.png` / `.jpg` | Version A: the painted torso and the painted props |
| `two-seats-<sitter>-noprops.png` / `.jpg` | Version B: the painted torso; the table band is round 2's pixels |
| `CHARACTERS-PROPS.jpg`, `CHARACTERS-NOPROPS.jpg` | The three side by side, in round 8's layout |
| `ROUND8-VS-ROUND9.jpg` | Each sitter: round 8, round 9 with props, round 9 without |
| `HANDS-ZOOM.jpg` | The hands and fan (x 600–900, y 660–920) at 2×, round 8 beside round 9 |
| `HEM-ZOOM.jpg` | The hem crossing (x 440–840, y 500–720) at 2×, round 8 beside round 9 |
| `PROPS-ZOOM.jpg` | The table's near edge (x 340–1160, y 896–1040) at 2×, round 8 above round 9 |
| `SLEEVE-SIZE.jpg` | True print size, both versions, with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue) and a 3 mm edge line (red), both versions |
| `tools/` | This round's scripts, the three paint specs, the prompts and the GPU logs |

`<sitter>` is `green-woman`, `garnet-man` or `blue-man`. The JPEG is the file to
upload (quality 95, 4:4:4, tagged 600 dpi), as before.

## How it was made

Everything happens in the top half (1500 × 1050); the bottom seat is that half
turned 180°, pixel for pixel (asserted).

### 1. The guide

Round 8's own script, run with `--no-props`, gives round 8's torso with no props
on it (round 7's drawing with round 8's grain; outside its props it is round 8's
final byte for byte). The torso box x 384–1128, y 480–960 of it, at 1216 × 784,
is the img2img guide for the torso. The props are painted separately, from round
8's finals (below), so the torso is the same in A and B.

### 2. The torso: img2img, then masked back

Prompt (per sitter, the cloak's colour and who wears it):
*"15th-century Netherlandish panel painting, oil on panel, soft modelling, muted
palette, matte, visible brushwork and craquelure, a seated woman in a dark green
woollen cloak, the cloak's sleeves and chest with deep soft folds, two hands
holding a small fan of plain dark cards with gilt edges together at the centre of
the chest, period portrait, tooled gold ground, no photo, no modern
illustration"*. Negative: *"vector, flat illustration, clip art, cartoon, comic,
line art, outline, cel shading, photograph, photo, 3D render, glossy, plastic,
text, letters, numbers, pips, symbols, card faces, extra fingers, fused fingers,
deformed hands, neon, blurry"*. 32 steps, CFG 6, DPM++ Karras.

| Run | Strengths | Seeds | What it gave |
|---|---|---|---|
| DreamShaper XL fp16 | 0.45, 0.55, 0.62 | 9101, 9102 | 0.45 keeps round 8's outlines and the flat fills under the paint. **0.62** repaints the cloak as a draped cape over the hem and moves the silhouette, which leaves a hard seam against the round-7 cape. **0.55** keeps the composition and turns the fills into painted cloth, the hem into a soft painted edge, and the hands into painted hands. Seed **9101** put a club pip on the front card in all three sitters at 0.45 and 0.55 (and a gilt smudge at 0.62); seed **9102** left every card plain. |
| SDXL base 1.0 | 0.45, 0.55, 0.62 | 9101 | The same pips from the same seed; flatter cloth and flatter, more cartoon hands than DreamShaper at every strength. Not used. |

**Chosen, all three sitters: DreamShaper XL, strength 0.55, seed 9102**: plain
cards, well-formed hands, the drawn composition kept, and the most painterly
cloth of the runs that kept it.

The painting goes back into the card through round 7's drawn mask (`dm-<tag>`,
its own antialiased alpha), less round 6's face ellipse and every row from the
moulding (y 944) down: the torso below the hood's shoulder-cape hem, the arms,
cuffs, hands and fan. Nothing outside it moves.

### 3. The face-matching pass (no model)

The same numbers round 8's `measure8.py` computes: band-pass luminance deviation,
the median over 16 px windows, on the flat parts (gradient < 4 after a σ 1.5
blur, eroded 6 px). The flat parts of the painted region are fixed *before* the
pass, so added grain cannot move them. Inside the painted region only: a gaussian
blur, then an even luminance grain of two parts (seed 9109): a fine grain (σ 0.6)
and a brush streak running down the folds (σ 2.6 px along y, 1.4 across). The
streak is kept off the hands and the cards (round 7's hand and fan masks, dilated
3 px): on them it read as sandpaper. The blur and the two amplitudes were searched
for the closest match to the painted hood's fine and mid numbers, with the streak
capped at 2.5 levels, because above that the cloth read as fur or velvet at 2×.

| | band | painted hood (the target) | painted torso, before | after |
|---|---|---|---|---|
| **Green woman** (blur 0.6, fine 1.5, streak 2.5) | fine (0–1 px) | 1.34 | 0.92 | **1.32** |
| | mid (1–3 px) | 4.83 | 2.31 | **2.53** |
| | coarse (3–8 px) | 8.01 | 4.29 | 4.37 |
| **Garnet man** (blur 0.6, fine 0.5, streak 2.0) | fine | 0.73 | 0.77 | **0.73** |
| | mid | 1.69 | 1.50 | **1.72** |
| | coarse | 3.15 | 2.49 | 2.60 |
| **Blue man** (blur 0.6, fine 0.5, streak 2.5) | fine | 0.80 | 0.74 | **0.77** |
| | mid | 2.36 | 1.39 | **1.80** |
| | coarse | 4.48 | 2.71 | 2.89 |

Fine matches in all three, and mid in the garnet man. The green woman's hood is
far busier at mid and coarse scale than any cloth should be (its bright streaked
highlights), and the blue man's somewhat: reaching it with grain made the cloak
furry, so it was not chased. The coarse figure is the painting's modelling, which
the pass does not try to copy.

### 4. The hands

The hands from the chosen torso run are already in the faces' manner: soft,
matte, well-formed, ten fingers, nothing crisper than the faces (the garnet man's
show knuckles and a vein or two, as an older man's do, still painted). So the
optional 2× hand repaint at ≤ 0.45 was **not run**. `HANDS-ZOOM.jpg` shows them at
2× beside round 8's drawn hands. The cards were checked at 100% and 200%: no pips,
letters or marks; the gilt edges are kept.

### 5. The props (version A)

The two prop boxes of each round-8 final (x 360–600 and 900–1140, y 880–1040) at
4× (960 × 640), with the same manner in the prompt and the objects named:
*"…, still-life detail on the edge of a dark walnut table: a pewter tankard, its
cold drink with a pale skin on it, small, with soft painted shadows on the wood,
period, no photo, no modern illustration"* (and so on per box; all six prompts are
in `tools/specs/prompts.json`). DreamShaper XL, strengths 0.55 and 0.62, seeds
9201 and 9202.

| Sitter | Left box | Right box |
|---|---|---|
| Green woman | the coin stacks: 0.55, s9201 | the cup and saucer: 0.62, s9202 (0.55 kept the drawn outline; this seed paints the cup with a short foot) |
| Garnet man | the tankard: 0.55, s9201 | the napkin and the lone coin: 0.55, s9201 |
| Blue man | the knocked cup and its spill: 0.55, s9202 (the spill as a dark pool at the mouth; s9201 lost it) | the bitten bun on its pewter plate: 0.55, s9201 |

They go back in two parts, so the painted wood never shows as a patch:

- **The bodies** are the painted layer, inside round 8's prop mask less its flat
  cast shadows (found as the pixels that are round 2's band uniformly darkened),
  dilated 2 px and feathered.
- **The shadows** are the painted layer's own darkening of the wood, measured
  against the card and laid on round 2's band as a multiplicative shade (never
  lighter, at most 60% dark), inside the prop mask dilated 6 px and feathered, so
  round 2's wood grain runs through them. They are painted, not drawn.
- Before either, the painted layer's tone is matched to the card in a 14 px ring
  outside the mask (the difference spread inward, normalised gaussian σ 10 px).

The props' bodies take the same face-matching pass as the torso.

### 6. Version B

Version A without step 5: the table band is round 2's pixels, byte for byte.

## Checks (measured on the finals, both seats)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| Faces (round 6's face ellipse), vs round 8 | **100%** | **100%** | **100%** |
| Hoods and shoulder capes, vs round 8 | **100%** | **100%** | **100%** |
| Gold field outside the figure, vs round 8 | **100%** | **100%** | **100%** |
| Border and frame, vs round 8 | **100%** | **100%** | **100%** |
| Lamp and its glow (160 px disc), vs round 8 | **100%** | **100%** | **100%** |
| Table band outside the props (A) / the whole band (B), vs round 2 | **100%** | **100%** | **100%** |
| All pixels identical to round 8, A / B | 86.6% / 86.8% | 85.9% / 86.2% | 86.5% / 86.8% |
| Darkest 0.5 mm areas, 0.5th percentile | 32.8 | 28.2 | 33.2 |
| Darkest painted pixel (luminance; floored at 22) | 22.2 | 22.1 | 22.1 |
| Saturation × value, 99.5th percentile | 148 | 148 | 148 |
| 180° symmetry | exact | exact | exact |

`compose9.py` writes these to a report per sitter and fails on a broken symmetry.

## GPU time

About **44 minutes** of GPU, under the shared lock at `nice 15`: the DreamShaper
torso run 1033 s (18 images at 1216 × 784, 49–65 s each), the SDXL base torso run
531 s (9 images), the props 1076 s (24 images at 960 × 640, 42–47 s each). The
logs are in `tools/specs/`. The first run waited about eight minutes for a forest
re-paint to release the lock.

## Not done, or worth knowing

- **The hem is still a seam, now a softer one.** The hoods and capes are never
  touched, so the line where round 7's painted cape meets the painted torso is
  the mask's edge. At 0.55 the model keeps it as a dark painted hem; on the blue
  man the cape above is lighter and more streaked than the cloak below.
  `HEM-ZOOM.jpg` shows it at 2×.
- **The green cloak keeps its drawn fold lines** as dark painted folds: 0.55
  softens them but does not dissolve them, and 0.62, which does, moves the hem.
- **The tankard's pale skin is gone.** The painted tankard has a gilt rim and no
  visible drink, so "cold and untouched" now reads only as a full tankard set
  aside. The green woman's cup shows a faint light haze above its rim, and the
  knocked cup keeps a trace of its outline on one side; all three are small at
  sleeve size.
- **The 2× hand repaint was not needed** and was not run (step 4).
- **The green woman's texture is matched at the fine scale only;** see step 3.
- **The Sleeve Crafter's crop, borders and colour conversion** are still
  unconfirmed, as in rounds 1 to 8.

## Reproduce

Run from `/home/justin-a/scenery-packs/two-seats-work/round9`, with round 8's
finals in `../round8/final`, round 7's masks in `../round7/comp` and round 6's in
`../round6/comp`:

1. `round8.py ../round7/final/two-seats-<name>.png ../round7/comp ../round6/comp <tag> comp/np-<tag>.png --no-props`
   (round 8's script, `../../round8/tools/round8.py`)
2. `tools/prep9.py`: cuts the guides and writes the specs
3. `tools/gpu.sh specs/spec-torso-ds.json`, `tools/gpu.sh specs/spec-torso-base.json`,
   `tools/gpu.sh specs/spec-props.json` (under the GPU lock, offline, `nice 15`,
   with `/home/justin-a/scenery-packs/.venv-gen`)
4. `compose9.py <tag> raw/torso-ds/torso-<tag>-55-s9102.png final/two-seats-<name> --prop-L <left> --prop-R <right> --fit`
   (the boxes chosen in step 5's table)
5. `sheets9.py <this dir> ../round8/final`

Steps 1, 4 and 5 run under `/home/justin-a/scenery-packs/.venv/bin/python` (it has scipy).
