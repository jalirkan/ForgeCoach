# The Two Seats, round 6: five fixes on round 5

*Written 2026-10-13. This is the sleeve art for the Dragon Shield standard sleeves:
1500 × 2100 px at 600 dpi, 5:7, exact 180° symmetry, with what matters inside a
110 px margin. Rounds 1 to 5 are untouched.*

## The brief

The direction is settled: round 4's three flat court-card figures in round 2's
world, holding round 2's small fan of plain dark gold-edged cards. Round 6 fixes
five things in the drafts' flat style and nothing else:

1. arms behind the hands;
2. folds on the closed cloak fronts;
3. a bigger fan and bigger hands, and the green woman's dark blob;
4. softer cut-out edges;
5. the refilled gold lined up with its neighbours.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | Final, the green woman |
| `two-seats-garnet-man.png` / `.jpg` | Final, the garnet man |
| `two-seats-blue-man.png` / `.jpg` | Final, the blue man |
| `CHARACTERS.jpg` | The three side by side, in round 5's layout |
| `ROUND5-VS-ROUND6.jpg` | Each round-5 final beside its round-6 version |
| `HANDS-ARMS-ZOOM.jpg` | The hands, sleeves and chest (x 420–1080, y 540–944) at 2×, round 5 left, round 6 right |
| `SLEEVE-SIZE.jpg` | True print size: 744 × 1039 each, with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `tools/` | This round's scripts, `specs/` (both GPU specs and their logs) and `lattice-check.jpg` |

The JPEG is the file to upload (quality 95, 4:4:4, tagged 600 dpi), as before.

## How it was made

Everything runs in the half (1500 × 1052, the seam at y 1050). The bottom seat is
the half turned 180°.

`tools/assemble6.py` rebuilds round 5's half with the fixes laid in as guides.
Its figure code (the cut-out, the 0.9 scale, the garnet man's frame rules) is
round 5's `assemble.py`, unchanged. Then come two GPU passes and the pastes, and
`tools/final6.py` lays the result into round 5's final only where a fix acts.

### Fix 1: arms (guide, then 0.40)

- **The guide.** A sleeve per hand is drawn in code, from where it comes out
  from under the cloak's side (125 px out and 95 px up from the wrist) forward
  and in to the wrist. Its details:
  - the wrist is found on the hand's skin, at its outer lower end;
  - the colour is the cloak's own (the median of its cloth), a little in shadow,
    with a shadow where it leaves the cloak;
  - a darker cuff (the last 16%, 3 px wider);
  - a bold dark outline down both long sides;
  - two elbow creases.
- **The pass.** A torso tile (x 400–1100, y 500–944, at 1.6×) at **0.40**, with
  the brief's prefix (*flat medieval court-card illustration, woodcut-like, bold
  outlines, limited palette, matte, no realism, no photo*), seeds 6101 and 6102.
- **The paste** (`tools/armpaste.py`). The sleeve mask is grown 6 px and
  feathered 4 px, so the sleeve feathers into the cloak. The fan and the hands
  are held out. Seed 6101 for all three.
- **The green woman's dark blob.** This was the draft's dark sleeve cuff beside
  her left hand. It is taken out: dark pixels there go to the cloak's colour, and
  the new sleeve covers the rest.
- **The blue man's ochre cuff** (round 2's) takes a darker shade of the cloak, as
  round 5 did, and joins the arm pass's mask.

### Fix 2: cloak fronts (guide, then 0.35)

- **The guide.** Round 5's push-pull colour is kept. Round 5's blurred profile
  is replaced by nine drawn vertical folds in the cloak's palette:
  - each has a dark fold line, a shadow side toward the centre and a lit edge;
  - each wavers gently and splays a little;
  - each fades in over 60 px below the front's top, as round 5's did.
- **The pass.** The same torso tile at **0.35**, same seeds. It is pasted only on
  the closed front, less the fan, the hands and the sleeves, feathered 4 px.

### Fix 3: hands and fan (1.25×, then the hand pass)

- **The scale.** Round 2's fan and hands are scaled **1.5** about the same table
  point: round 5's 1.2 × 1.25.
- **The hand pass** (round 5's prompts and its skin-only `handpaste.py`). The tile
  is x 500–1000, y 680–944, at 2.2× (1104 × 584). It ran at **0.36 and 0.44**, two
  seeds each (6301, 6302), on all six hands.
- **The picks.** Green 0.44 s6301, garnet 0.44 s6302, blue 0.44 s6302.
- **The cards stay plain.** `tools/cardclean.py` checks every card back, 5 px in
  from its gilt edge. Any speck more than 10 levels off a 21 px median takes the
  median. This cleaned 56, 3 and 56 px of round 2's own specks (a brown dot on
  the front card). At 100% there are no pips, letters or marks.

### Fix 4: edges

- **The feather.** The figure is laid on the gold with a 1.4 px gaussian feather
  (about a 3 px ramp) instead of round 5's 0.8.
- **The unifying pass** (`tools/unipaste6.py`). The tile is x 300–1200,
  y 220–944, at **0.18**, seed 6401, with round 5's prompt plus *no realism, no
  photo*. It is pasted only on a band along the outline (10 px out, 8 px in,
  feathered 3 px). The faces are inside the hood, well clear of the band.

### Fix 5: the gold

Round 5 copied the hole from whole 96 px periods away. Round 2's painted lattice
is not exactly 96 px: the fit gives 95.7. Each crossing also sits a few px off
its ideal place, so the copy drifted.

Round 6 does this instead:

- **The crossings.** It finds the lattice's crossings on round 2's final (the
  punches' blue-grey peaks):
  - first a best-fit grid;
  - then each crossing searched within ±14 px of its predicted place, where the
    gold is clear;
  - where round 2's figure stood, each crossing is interpolated from its
    measured neighbours.
- **The copy.** Every hole pixel is copied through the diamond cells' bilinear
  maps from the same place in a clear cell: upward first, then outward, as
  before. The source is round 2's own final, so the grain matches its
  neighbours. The low-frequency light is the landing place's, as in round 5.
- **The check.** Every refilled diamond meets the measured ones corner to corner.
  `tools/lattice-check.jpg` shows the crossings: green where measured, magenta
  where interpolated.

### The last step

`tools/final6.py` works as follows:

- **The new half.** It is chroma-capped exactly as `compose.py` does.
- **Where it goes.** It goes into round 5's final only inside a change mask,
  feathered 3 px. The mask is the union of:
  - the sleeves (+8 px);
  - the cloak front (+6 px);
  - round 6's and round 5's fan and hands (+6 px);
  - the green blob and the blue cuff;
  - the outline band;
  - round 5's refilled hole outside the figure's interior.
- **What stays round 5's.** The mask is forced to zero on each face (an ellipse
  round it) and on every row from the moulding's top (y 944) down. Outside the
  mask every pixel is round 5's.
- **Both seats.** The top half is turned for the bottom seat and the symmetry is
  asserted.

## Checks (measured on the finals)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| Pixels byte-identical to round 5's final | **78.7%** | **79.6%** | **79.2%** |
| Face ellipse identical to round 5 | yes | yes | yes |
| Table band, lamp, glow (every row from y 944 to the turned moulding) identical | yes | yes | yes |
| Darkest 0.5 mm areas, 0.5th percentile | 32.8 | 27.6 | 31.1 |
| Saturation × value, 99.5th percentile | 148 | 148 | 148 |
| 180° symmetry | exact | exact | exact |

The floral border, the outer gold and the cloaks' main bodies are also outside
the change mask, so they are round 5's pixels.

## GPU time

DreamShaper XL fp16 on the GTX 1080, under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`, offline.

| Pass | Images | Time |
|---|---|---|
| Torso (arms at 0.40, chest at 0.35) | 12 | 442 s |
| Hands (0.36, 0.44) and unify (0.18) | 15 | 481 s |

The total is **923 s (about 15.5 minutes)**, finished at 00:29:34.

## Not done, or worth knowing

- **The sleeves read as drawn.** At ≤0.40 the pass barely changes the guide, so
  the sleeves are flat bands of the cloak's colour with a bold outline, creases
  and a darker cuff. That suits the woodcut style, but they are plainer than the
  drafts' own cloth.
- **The sleeves' path is a choice.** They come from the cloak's side, forward and
  in to the wrist. A version that starts higher, at the shoulder, would need a
  bigger guide and probably more than 0.40.
- **The green woman's front still shows a soft edge** at its top, where the code
  front meets the draft's cloth under the hood. Two things were tried and
  dropped:
  - mirroring the cloth's texture across that edge made ghost shapes;
  - a wider feather would eat into the cloak's body.
- **The blue man's cuff.** Round 2's dark cuff with its small gold button is
  still under his left hand, now at the end of the new sleeve. It reads as a
  cuff, but it is the one dark patch in that area.
- **The garnet man** keeps round 2's red thread hanging from his right wrist.
- **The hands are softer than the faces.** Round 2's small hands are enlarged
  2.5× in total (1.5 here, with round 2's own scale), and the 0.44 pass sharpens
  them only partly.
- **"2–3×" was read as the tile's working scale** (2.2× here), as in round 5's
  notes. It was not read as repeated passes: each hand had one pass.
- **The Sleeve Crafter's crop, borders and colour conversion** are still
  unconfirmed, as in rounds 1 to 5.

## Reproduce

Run from `/home/justin-a/scenery-packs/two-seats-work/round6`, with round 2's work
directory, round 4's finals, round 5's `comp/hole-<c>.png` and round 5's
`cut-{1,2,3}.png` (in `guides/`):

1. `assemble6.py ../round2 <round4>/two-seats-<n>-fixed.png guides/cut-<n>.png <c> ../round5/comp/hole-<c>.png comp <c>`
2. `region.py cut comp/a-<c>.png 400 500 1100 944 1120 712 comp/t-in-<c>.png`, then `gpu.sh specs/spec-a.json`
3. `armpaste.py`, seed 6101, to `comp/b-<c>.png`
4. `region.py cut` the hand tile (500 680 1000 944, 1104 × 584) and the unify tile (300 220 1200 944, 1024 × 824), then `gpu.sh specs/spec-b.json`
5. `handpaste.py`, at the picks above
6. `cardclean.py`
7. `unipaste6.py`
8. `final6.py <round5 final> comp/u-<c>.png <c> comp final/two-seats-<name>.png`
9. `sheets6.py <this dir> ../round5`
