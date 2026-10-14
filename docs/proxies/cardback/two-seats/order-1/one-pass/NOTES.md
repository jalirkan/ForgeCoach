# Order 1, one pass: the garnet man painted whole

*Written 2026-10-13. Candidates for the owner to choose from. Nothing in `../` (order 1's
print files) has been overwritten.*

## Why

The owner on order 1: "it looks like shit, like a loose sketch". It was a collage: a painted
face, a drawn robe with stripes, sketched hands and sticker props, each made in a different
pass and matched by measurement. This attempt paints the **whole figure in one pass**: face,
hood, robe, arms, hands and cards together, with one brush. The rule against regenerating
the face is lifted for this attempt. The face may shift a little, but he must stay the same
man.

## What is here

| File | What it is |
|---|---|
| `CANDIDATES.jpg` | The guide, order 1 as it is, and all eight seeds. Each one is at print size (1:1), showing the 800 × 800 px around him, with his face and hands at 1.5× underneath. Each is labelled with its strength, seed, likeness and verdict. |
| `CHARACTERS-TOP3.jpg` | My top three as full cards. Under each card: the face and the hands and cards at 200%, and the tankard at 200%. |
| `SLEEVE-SIZE-TOP3.jpg` | The three cards and order 1 as it is, at print size (297.6 px per inch), with a 10 mm bar. |
| `two-seats-garnet-man-ds-40-s9702.png`, `…-ds-45-s9701.png`, `…-base-45-s9701.png` | The top three as full cards. Each is 1500 × 2100 at 600 dpi, exactly 180° symmetric, with the black-point lift applied. |
| `tools/` | Every script, spec and measurement (below). |

## How it was made

1. **Ground A2** (`tools/groundA2.py`, `tools/groundA2-report.json`) is Ground A from
   `../tools/grounds.py`, finer and calmer:
   - **Finer.** The draft's leaf is sampled at 0.6 of the sleeve scale, so the streaks are
     40% finer. Every length in the re-tiling scales with it.
   - **More samples.** It uses four samples of the draft's leaf instead of two, each also
     mirrored, so the smaller knots repeat less.
   - **Calmer.** Each sample's blue-grey flecks are damped against their 24 px
     neighbourhood. The measured fleck strength is **0.52×** the mock's (mean positive
     blue excess 9.71 → 5.04).
   - **Unchanged:**
     - the field's brightest-channel mean of 160 over the whole field (153.6 in the clear
       side panels, where the mock reads 158.7);
     - the knee, so the highest channel anywhere in the field is 224;
     - the lamp glow, the vignette, the plain moulding, rule and fillet;
     - the band with its lamp and props (the final's pixels).
   - **Symmetry.** The top half is turned through 180° to make the bottom (asserted).
2. **The guide** (`tools/guide.py`) is built at the figure's final scale.
   - **Form.** Round 8's form, lifted off its punched gold by `../tools/lift.py` (round 8's
     face and hood are the final's pixels; 0 differ).
   - **Shoulders.** A smooth warp made them unequal: the viewer's left shoulder up by as
     much as 16 px and the right down by as much as 6 px. The hood, the face (asserted)
     and the hands do not move.
   - **Body.** Laid on Ground A2, the drawn torso was turned into a soft painted body by
     one quick img2img: DreamShaper XL, 0.60, seed 9601 of 9601/9602
     (`tools/spec-pre.json`). That body went back in through round 7's drawn torso mask
     (warped the same way), so the face, hood and cape stay the draft's.
   - **Hand-blends.** Two fixes on the guide only, both added after an earlier batch showed
     the problems in every seed (see *Batches*):
     - the quick pass had painted the fan's lower-left cards as white page edges. Those
       pixels now take the dark card colour at their own relative lightness, so they read
       as card stripes;
     - it had also turned the tankard into a lidded jug, and the lid and knob stood above
       the final's tankard. The final's tankard goes into the guide, and the lid's grey
       and its knob are filled with the robe around them.
   - **Paint mask.** The warped figure grown by 48 px. The table band (y ≥ 944) and the
     props standing above it are kept out of it.
3. **The one pass** (`tools/paint2.py`, `tools/spec-onepass.json`,
   `tools/spec-onepass-base.json`) runs on a crop at x 350–1150, y 180–980, painted at
   1152 px (1.44×).
   - **Method.** SDXL inpainting on the plain UNet, so outside the mask the latents are held
     to the guide's own latents at every step. Settings: 32 steps, CFG 6, DPM++ Karras.
   - **Prompt and negatives** exactly as briefed.
   - **Seeds.** DreamShaper XL fp16 at 0.40 (seeds 9701, 9702), 0.45 (9701, 9702) and 0.50
     (9701, 9702, 9703), plus SDXL base at 0.45 (seed 9701). That is eight.
4. **Composition** (`tools/onepass.py`). This is all of the post-work:
   - **Matte.** The man's outline is the one the painting gave him. A pixel inside the paint
     mask counts as figure according to how far the painting is from Ground A2 there. The
     ground stays Ground A2's own leaf.
   - **Props.** The final's tankard is laid back through round 8's prop mask, as order 1
     did.
   - **Lift.** The black-point lift is applied once, to the whole card.
   - **Symmetry.** The bottom seat is the top half turned through 180° (asserted).
   - **Nothing else:** no blur, grain, outline work or hand repaint.

GPU time was about 40 minutes in all (the quick pass plus three batches of eight), every
process under `flock …/gpu.lock nice -n 15`.

## Batches

All three batches use the same seeds and strengths. Only the guide changed between them:

- **Batch 1:** every seed carried the guide's white page edges in the fan, and the jug's
  knob floated above the tankard.
- **Batch 2:** fixed the knob, but filled the white with a soft push-pull fill. At 0.40 and
  0.45 that came through as a brown smudge on the cards.
- **Batch 3:** uses the recolour described in step 2. It is the only batch shown.

Batches 1 and 2 are kept in `~/scenery-packs/two-seats-work/order1/onepass/batch1`
and `batch2`, and are not committed. Their faces measured within 0.01 of batch 3's.

## The candidates (batch 3)

Likeness is structural similarity (SSIM) of the grey face crop (x 640–860, y 265–545)
against the draft's face, which carries the same lift, so the lift cancels out
(`tools/likeness.py`, `tools/likeness.json`). The columns are:

- the whole face at full size;
- the whole face at half size (its structure);
- the eyes and brows alone.

No face moved; the phase-correlation shift is 0 for all eight. For scale: order 1 as it is
scores 0.968 / 0.974 / 1.000, and the guide scores 0.934 / 0.947 / 0.964.

| Seed | SSIM | half size | eyes | Hands | Verdict |
|---|---|---|---|---|---|
| DS 0.40 s9701 | 0.823 | 0.835 | 0.757 | ok | the same man; the draft's green-blue cheek shadow survives |
| **DS 0.40 s9702** | **0.835** | **0.852** | **0.780** | ok | the same man, the closest; a trace of the draft's blue on the cheek |
| **DS 0.45 s9701** | 0.778 | 0.781 | 0.679 | ok | the same man; face and hands in one paint |
| DS 0.45 s9702 | 0.786 | 0.793 | 0.706 | ok | the same man, softer and younger |
| DS 0.50 s9701 | 0.730 | 0.722 | 0.604 | ok | near him, drifting |
| DS 0.50 s9702 | 0.732 | 0.731 | 0.633 | ok | drifted: a rounder face, red hair |
| DS 0.50 s9703 | 0.717 | 0.701 | 0.607 | ok | another man (a white coif): **out** |
| **SDXL base 0.45 s9701** | 0.782 | 0.785 | 0.691 | ok | the same man, the most careworn and worried |

All eight have two old, bony, veined hands, both thumbs up on the front card. None shows an
extra or deformed finger, and none is out for its hands. At 2× the fingers of the two hands
interlace where they meet, so they cannot all be counted one by one. In #1 the left hand's
fingers run together a little more than in #2 and #3. At print size all of them read as
hands holding the cards. The cards are a modest fan of
worn dark backs with pale gilt edges, the front card a muted slate blue.

## My top three, and the one I would pick

1. **DreamShaper 0.40, seed 9702**: **my pick.** It has the highest likeness on all three
   measures and is unmistakably him: the long face, the set mouth and the worried brow, now
   painted in the same manner as his hands and robe. Its flaw is a trace of the draft's own
   blue-green shadow on his left cheek, the last mark of the collage. At 0.40 the pass did not
   fully absorb it.
2. **DreamShaper 0.45, seed 9701**: the most "one painting". Face, hands and robe share one
   palette and one brush, and the cheek is clean. He is a little older and more weathered than
   the draft, but the same man. Pick this if the cheek in #1 bothers you.
3. **SDXL base 0.45, seed 9701** (the comparison model): the most careworn and worried face of
   the eight, very much the draft's character. The skin is a little more yellow, and the base
   model's robe is slightly flatter than DreamShaper's.

The face is the choice to make. The bodies, hands and cards of the three are close.

## Checks on the top three (`tools/check2.py`, `tools/check2.json`)

| Check | 0.40 s9702 | 0.45 s9701 | base 0.45 s9701 |
|---|---|---|---|
| 180° symmetry, pixel for pixel | yes | yes | yes |
| Darkest 0.5 mm area, mean luma (rule ≥ 24) | 27.5 | 27.3 | 27.0 |
| Darkest single pixel (luma) | 24.9 | 24.6 | 24.4 |
| sat × value, figure: p99.5 / max | 122.1 / 151.9 | 121.3 / 154.5 | 126.4 / 151.9 |
| sat × value, whole card: p99.5 / max | 148.0 / 165.0 | 148.0 / 165.0 | 148.0 / 165.0 |
| Field: brightest-channel mean / max | 154.8 / 213 | 154.8 / 213 | 154.8 / 213 |
| Margins from the trim: hood top, left, right (rule ≥ 110 px) | 245, 408, 406 | 243, 411, 405 | 242, 411, 406 |
| Cards: dark face px; bright-speck clusters | 23,611; 15 | 23,318; 26 | 23,874; 28 |

Notes on the checks:

- **sat × value.** Only **one pixel** in each figure goes over 150: a single hot red pixel at
  the hood's edge or collar. The whole card's maximum of 165 is the lamp's core, which is
  unchanged order 1 pixels; order 1 has the same 165 there, plus some on its old ground.
  Ground A2 has none over 150.
- **Margins.** The props are 443 px (tankard) and 399 px (napkin and coin) from the trim,
  and the lamp is 590 px. The moulding runs to the trim by design.
- **Cards.** The bright specks are the scuffs and gilt edges of worn cards. At 200%
  (`CHARACTERS-TOP3.jpg`) they read as wear. There are no pips, letters, numbers or marks.

## What does not work yet

- **The props clash now.** The tankard, the napkin and coin, and the lamp are order 1's
  props, kept as briefed. Beside a painted man the tankard reads as a flat grey sticker
  with a dark drawn outline. The lamp is an airbrushed glowing ball. Before printing, I
  would paint them in the same pass or leave them out, as the direction already allows
  ("Either no items, or the same style").
- **The shoulders.** The warp made them unequal, and the painting softened that into a
  natural, near-level drape. The difference is subtle, not obvious.
- **The robe's left edge.** It keeps round 8's drawn "elbow", which reads as the corner of
  a chair back. It is the same in all eight.
- **The front card** is a muted slate blue rather than near-black. It is plain, but lighter
  than "dark cards".

## To rebuild

Run from `~/scenery-packs/two-seats-work/order1/onepass`:

1. `groundA2.py <draft> ../work/final-unlifted-garnet.png <mock A> work`
2. `../tools/lift.py garnet comp/r8.png work`
3. `guide.py pre`
4. `gpu2.sh spec-pre.json`
5. `guide.py guide raw/pre-60-s9601.png`
6. `gpu2.sh spec-onepass.json`, then `gpu2.sh spec-onepass-base.json`
7. `onepass.py raw/<seed>.png <out.png>`
8. `likeness.py`, `check2.py`, `sheets2.py`

`comp/r8.png` is fc-lanes two-seats-r8's `round8/two-seats-garnet-man.png`.
