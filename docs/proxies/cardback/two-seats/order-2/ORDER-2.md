# Order 2: the green woman on Ground A

*Written 2026-10-13. The second print-ready sleeve: "The Two Seats — the green woman",
made the way the garnet man (order 1) was finished: the whole figure painted in one pass,
then finished with painted fixes. On Ground A (the draft's streaky worked leaf, finer, and
the plain moulding), for one 100-pack of Dragon Shield brushed-matte standard sleeves.*

She is an auburn-haired woman in a green hooded cloak, composed and faintly pleased: the one
who is winning. In front of her on the table's near edge: two neat stacks of coins, and a full
cup she has not touched.

## The file to upload

**`two-seats-green-woman.jpg`**, in this folder. 1500 × 2100 px, 600 dpi, 5:7, JPEG
quality 95 (4:4:4), 1.29 MB. The PNG beside it (3.9 MB) is the same picture, kept as the
master; upload the JPEG.

## In the Sleeve Crafter

1. **Size: standard** (63 × 88 mm, for Magic cards). Not Japanese or small size.
2. **Finish: brushed matte.**
3. **Quantity: one pack of 100.**
4. **Upload `two-seats-green-woman.jpg`.** If it asks how to fit the picture, choose the
   option that fills the sleeve (fill, cover, or full bleed) rather than one that fits it
   inside a border.
5. **Look at the preview before you pay:**
   - [ ] **The crop.** The picture fills the sleeve edge to edge. The outer gold moulding
         may lose a little at the edges; it is meant to run off. The thin dark green line
         inside the moulding should still show on all four sides.
   - [ ] **The lamp is on the centre line.** The round lamp sits in the exact middle of
         the sleeve, top to bottom and left to right. If it looks off centre, the picture
         has been shifted or cropped unevenly.
   - [ ] **No border added over the moulding.** If the crafter lays its own frame or
         coloured edge round the picture, look for a "no frame" or "full bleed" option. If
         there is none, note how wide its border is and whether it hides the dark line.
   - [ ] **Both faces whole.** The face that is the right way up and the one upside down
         are both complete, with the top of each hood clear of the edge (about 11 mm to
         spare).
   - [ ] **Nothing stretched.** The lamp is round, not oval.
6. If all five look right, order. If one does not, stop and write down which one.

## When the sleeves arrive

- [ ] **The gold.** It should print as a warm, worked, slightly streaky ochre. Note it
      if it has gone brown, green or flat yellow.
- [ ] **The dark hood lining and shadows.** At arm's length, the black under her hood
      should still show a little detail, not solid black.
- [ ] **One painting.** The face, hood, cloak, hands and cards are one painted pass
      (DreamShaper 0.40, seed 9702), so nothing should look crisper or flatter than the
      face. Note any part that reads as pasted on.
- [ ] **Her face.** Pale ivory with pink cheeks and a calm, faintly pleased mouth; she
      should read as the same woman as the earlier drafts.
- [ ] **The hands and cards.** Two slender hands whose fingers interlace at the centre,
      both thumbs up on the front card, the skin the same ivory as her face. The cards
      are near-black warm grey backs with dull gilt edges, not blue, and carry no marks,
      numbers or letters.
- [ ] **The chest.** Below the drape of her hood, vertical pleated folds run down the
      cloak's front to beside the cards, on both sides. They should read as painted folds in
      the cloth, not as lines drawn on top, and not vanish into a plain green.
- [ ] **The cloak's sides.** Both sides fall to the table as cloth. Neither should read as
      a box or a drawn outline.
- [ ] **The props.** On the table's near edge, painted like her: two neat stacks of coins
      with a soft shadow (left), and a full cup on its saucer (right).
- [ ] **The lamp.** A painted glass globe with a gold band across the centre line. Its
      glow on the wood should look the same above and below the band.
- [ ] **One sleeve with a real card in it.** It slides in and shuffles like your other
      sleeves.

Write down anything that looks wrong before ordering more.

## How this file was made

Order 1's method, reused tool for tool (`../order-1/one-pass/tools/`,
`../order-1/finish/tools/`); the copies in `tools/` carry a header saying what changed for
her. All GPU work ran under `flock …/gpu.lock nice -n 15`, about **37 minutes** in all
(2 + 8 + 41 images), and the chest pleats about 4 more (8 images).

### Sources

- **Form:** round 8's green final (fc-lanes two-seats-r8,
  `round8/two-seats-green-woman.png`): the hood and cloak, both hands holding the fan at the
  centre, her props (two coin stacks and an untouched cup). Lifted off its punched gold by
  `../order-1/tools/lift.py green` against the rebuilt bare ground (`ground6-green.npy`).
- **Face and hood:** the draft's (round 4's `two-seats-1-fixed.png`). Round 8's face is the
  final's face, 0 pixels different (checked against the final before its lift, fc-lanes
  two-seats-final `c9022be`), and that is the likeness reference.
- **Ground:** `tools/groundA2.py`, order 1's finer, calmer Ground A, built from her own draft
  (`direction/two-seats-1.png`) with grounds.py's green sample columns and her green rule.
  Fleck strength 0.52× the mock's, as for him (`tools/groundA2-report.json`). The band, the
  lamp and the props are the final's own pixels.

### 1. The guide (`tools/guide.py`, `tools/spec-pre.json`)

- Round 8's form, with the shoulders made unequal by order 1's smooth warp: the viewer's
  left shoulder up by as much as 16 px, the right down by as much as 6 px. The hood, the
  face (asserted) and the hands do not move.
- The drawn torso turned into a soft painted body by one quick img2img: DreamShaper XL,
  **0.60, seed 9601** of 9601/9602 (9602 put an ornament on a card). It went back in
  through round 7's drawn torso mask (warped the same way), so her draft face and hood stay.
- Order 1's two garnet-only hand-blends (the fan's white page edges, the tankard's lid) were
  not needed: her quick pass painted the cards dark, and her props stand on the band.
- Paint mask: the warped figure grown by 48 px, kept above the table band.

### 2. The one pass (`../order-1/one-pass/tools/paint2.py`, `tools/spec-onepass.json`)

The whole figure, face included, painted at 1152 px (crop x 350–1150, y 180–980),
DreamShaper XL fp16, SDXL inpaint on the plain UNet, 32 steps, CFG 6, DPM++ Karras.
Prompt exactly as briefed; negatives the man's. **0.40 and 0.45 × seeds 9701–9704.**
Composed by `tools/onepass.py` (order 1's matte against Ground A2, then the lift and the
turn). Likeness (`tools/likeness.py`, `tools/likeness.json`) is SSIM of the face against the
draft's face given the same lift: whole face / half size / eyes. For scale, the guide scores
0.921 / 0.936 / 0.943. No face moved more than a quarter pixel.

| Seed | SSIM | half | eyes | Hands | Verdict |
|---|---|---|---|---|---|
| DS 0.40 s9701 | 0.848 | 0.871 | 0.830 | ok | the same woman, heavier lids, sleepier |
| **DS 0.40 s9702** | **0.849** | **0.874** | **0.839** | ok | **the pick**: the closest; eyes open, mouth faintly up |
| DS 0.40 s9703 | 0.845 | 0.865 | 0.840 | ok | the same woman, a faint smile, heavier lids |
| DS 0.40 s9704 | 0.843 | 0.863 | 0.817 | ok | the same woman, a little older and graver |
| DS 0.45 s9701 | 0.795 | 0.812 | 0.751 | ok | the same woman, softer, sleepier |
| DS 0.45 s9702 | 0.799 | 0.817 | 0.762 | ok | the same woman, younger, eyes drifting |
| DS 0.45 s9703 | 0.795 | 0.806 | 0.759 | ok | the same woman, graver; a ring appears |
| DS 0.45 s9704 | 0.782 | 0.791 | 0.723 | ok | near her, drifting |

"Hands ok" means two hands, both thumbs up on the front card and the fingers interlaced; in
every seed the long fingers run together where they meet, so none could be counted finger by
finger before the hands fix. `CANDIDATES.jpg` shows all eight at print size, with the face
at 1.5× and the hands at 1.3×.

**Why 0.40 s9702.** It scores highest on all three likeness measures, and at 2× it is the
one that keeps her: the eyes still open and level, the long nose, the small mouth turned
faintly up. The others at 0.40 droop the lids into sleepiness; 0.45 softens her younger or
graver. The cards came out a slate-blue front card and ornamented backs, and the hands
spidery. The finish fixes both, as it did for the man.

### 3. The finish (`tools/fix.py`, `tools/regions.json`, `tools/spec-finish1.json`, `spec-finish2.json`)

Every repair but two is painted: an SDXL inpaint with the same model and pipeline, at the
working scale given, looked at at 2× or more (`tools/look.py`) before it was kept. `fix.py`
only cuts out the source and the drawn mask and pastes the painting back with a 1 px soft
joint. The finish edits the pick's **unlifted** top half, then lifts and turns it once.

| Fix | How | Kept |
|---|---|---|
| Cards | `tools/cards.py`, order 1's value and hue shift confined to the card mask (no painting): luma to 14 + 0.45 Y, warm grey, the light edges a dull gilt. Her cloak (teal) and her paler skin needed their own tests. Done before the hands. | plain at 200%: near-black warm grey, dull gilt edges, the ornament gone |
| Hands | x 600–904, y 680–936 at **3×**, 0.50 and 0.58 × seeds 9801–9805 (10) | **0.58 s9805**: the left hand is a thumb and four fingers, the right a thumb with four fingers interlaced under it, both thumbs on the front card. 0.58 s9801 grew card scraps between the hands, 0.58 s9804 a pale stick, and 0.50 s9803 a stray fingertip |
| Hands' skin | `tools/skinmatch.py`: a Lab mean/std transfer of the hand skin to her face's skin, on the skin mask only (1 px feather) | hands L/a/b 66.3/6.8/15.6 → 71.4/5.0/17.2 against the face's 71.7/4.9/17.3 (`tools/skinmatch.json`). The face sample needed a wider test: her ivory is very unsaturated, and the first sample (the cheeks' blush) made the hands pink and flat |
| Coin stacks | at **4×**, 0.50/0.58 × seeds 9811/9812 | **0.50 s9811**: two neat stacks, painted, with a soft shadow. 0.58 s9811 shrank them; s9812 merged them into one |
| Cup | at **4×**, 0.50/0.58 × seeds 9821/9822 | **0.50 s9821**: a full cup on its saucer, painted, with its shadow. s9822 took a hot highlight |
| Lamp globe | order 1's globe-only mask at **3×** on the whole card, centred on the seam; the top half turns with the card | **0.50 s9831**: a glass globe with a gold band. The wood's glow is unchanged, so it stays symmetric |
| Cloak, left edge | at 3.5×, matted against Ground A2 as the one pass was, 0.50/0.56 × seeds 9841/9842. Round 8's drawn outline left a dark scribble at the lower corner | **0.56 s9842**: the side falls to the table as cloth. s9841 left a seam at the mask's edge |
| Cloak, right edge | as the left | **0.50 s9842**: clean to the table. 0.50 s9841 left a grey block at the hem |
| Face | looked at at 3×: no smear. The pale cool notch at her left jaw (your right) reads as her ear under the hair | **left as painted** |
| Two tiny cloak marks | a brown stroke at (587, 630) and a dark dash at (916, 743), each under 0.5 mm in print. Tried at 4× (0.40, 0.55, 0.62 × 2 seeds) | **left as painted**: every try showed its mask or painted a pattern, which was worse than the marks |
| Chest pleats (after the owner's "Didn't I ask you to protect the lines on the chest?") | order 1's `finish/tools/pleats.py` with her entry in `pleats.json`; `tools/spec-pleats.json`. The region is the chest only: from under the hood's drape (y 633) to the forearms (y 818), x 540–962; the fan and the hands are cut out of it (every non-robe pixel in their box, holes filled, grown 3 px). The guide multiplies the current painting by round 8's lines (its luma, blurred along the vertical and divided by its local mean, from the one pass's own warped round-8 form) at 0.45, and by dark and light bands drawn from them at 0.45. One SDXL inpaint over that region at 2× (x 480–1024, y 576–864), her one-pass prompt with "vertical pleated folds of the robe, tailored, crisp fold lines" put after "oil on panel" (CLIP's 77 tokens cut the last words otherwise), her negatives. Pasted with a 14 px feather into the cloak round it and 5 px against the fan and hands | **0.38 s9912** of 0.38 × seeds 9911–9915 and 0.42 × 9911–9913: the pleats are painted folds, with lit ridges, in the cloak's own teal and texture. Every seed kept them (seeds differ by at most 1 level after the paste, and 0.38 and 0.42 came out alike), so the lowest strength was kept. The chest's vertical detail (std of the vertical-fold high-pass) went from 3.45 to 6.10 (the guide 6.32). 45,943 px of the top half changed, all inside the region; face, hood, hands, fan, props, lamp, ground and border are byte-identical to the 66fedbc file, and so is every check number |

Files named `-57` in the work folder are the 0.58 runs (the spec truncated 0.58 × 100).

**Post-work:** the one pass's black-point lift, once (+ 24·(1 − L/56)² below L 56), then the
180° turn, asserted (`tools/build.py`).

**Checks** (`tools/check2.py`, `tools/check.json`):

- **Symmetry:** exact under the 180° turn.
- **Darks:** the darkest 0.5 mm reads **26.8** (rule ≥ 24). The darkest pixel is 24.9.
- **Saturation × value in the figure:** maximum **134.6**, p99.5 99.7 (rule ≤ 150).
- **Saturation × value, whole card:** maximum 165.9, in the lamp's core, as for the man
  (165–169).
- **Field:** brightest-channel mean 155.0, maximum 221.
- **Margins:** hood top 266, left 452, right 435; props 453 and 460; lamp 590 (rule ≥ 110).
- **Cards:** plain at 200% (`CHECK.jpg`). 18 bright-speck clusters (119 px), all on the gilt
  edges between the cards; no pips, letters, numbers or marks.
- **File size:** the JPEG at q95 is 1,291,314 bytes.

### Sheets

- `CANDIDATES.jpg`: the guide, the previous final and all eight seeds, each at print size,
  labelled with strength, seed, likeness and verdict.
- `CHECK.jpg`: the finished card, the raw pick and the previous final (479e5f6) side by
  side; every fix at 2×, before (the raw pick) and after; and the finished hands beside
  the face at 2×; at the foot, the chest pleats at 2×: before (66fedbc), after, and round 8 at the same box, the
  lines' source (`../order-1/finish/tools/pleatsheet.py`).
- `SLEEVE-SIZE.jpg`: her print file beside the garnet man's current print file at true size,
  with a 10 mm bar.

### What did not come through

- **The rose gown.** The prompt names it, but at 0.40 the pass keeps round 8's form, which has
  a black hood lining at the throat and the cloak closed over her chest. No rose shows
  anywhere. Getting it would mean drawing it into the guide first.
- **The shoulders.** As with the man, the warp made them unequal, and the painting softened
  that into a near-level drape.

### To rebuild

Working folder `~/scenery-packs/two-seats-work/order2/`. Run in `onepass/`:

1. `tools/groundA2.py <direction/two-seats-1.png> ../work/final-unlifted-green.png <grounds/A-green.png> work`.
   `final-unlifted-green.png` is `git show c9022be:…/final/two-seats-green-woman.png` from
   fc-lanes two-seats-final, and `work/ground6-green.npy` is the grounds lane's.
2. `../order-1/tools/lift.py green comp/r8.png work`. `comp/r8.png` is round 8's
   green-woman file.
3. `tools/guide.py pre`, then `tools/gpu.sh <onepass> tools/spec-pre.json`, then
   `tools/guide.py guide raw/pre-60-s9601.png`.
4. `tools/gpu.sh <onepass> tools/spec-onepass.json`, then `tools/onepass.py raw/<seed>.png cards/<seed>.png`
   for each seed, then `tools/likeness.py` and `tools/sheets.py candidates`.

Run in `finish/`:

5. Copy `cards/ds-40-s9702-unlifted-top.png` to `work/top0.png` and its `-matte.npy` to
   `work/pick-matte.npy`.
6. `tools/cards.py work/top0.png work/top1-cards.png`.
7. `tools/fix.py cut` for each region, then `tools/gpu.sh <finish> tools/spec-finish1.json`.
8. `fix.py paste` in this order: hands, edgeL, edgeR, coins, cup, lamp2, giving `work/top7.png`.
9. `tools/skinmatch.py work/top7.png work/top8-skin.png`.
10. Chest pleats: `../order-1/finish/tools/pleats.py guide green`, then
    `tools/gpu.sh <finish> tools/spec-pleats.json`, then
    `pleats.py paste green raw/pleats-38-s9912.png work/top9-pleats.png`.
11. `OUTLINE='["edgeL","edgeR"]' tools/build.py work/top9-pleats.png work/final2.png`, then
    `tools/check2.py` (run from `onepass/`), `tools/sheets.py check`, and
    `../order-1/finish/tools/pleatsheet.py` to add the pleats band to `CHECK.jpg`.

## History

- 2026-10-13, made: the one pass over the whole figure (DreamShaper 0.40, seed 9702 of
  eight), then the painted finish: hands at 3× (0.58 s9805), with their skin matched to the
  face in Lab; the cards darkened in-mask; the coin stacks and the cup painted at 4×; the
  lamp globe repainted at 3×; and both cloak edges repainted as cloth. The face was left as
  painted, since it showed no smear. All checks pass. The previous green-woman file
  (`../final/`, 479e5f6) is untouched.
- 2026-10-13, chest pleats, after the owner's "Didn't I ask you to protect the lines on the
  chest?": round 8's vertical fold lines put back into the chest below the hood's drape only,
  by one inpaint over a guide that carries them (DreamShaper 0.38, seed 9912), on the
  unlifted top half; then the same lift and turn. Everything outside the chest, hands and fan
  included, is byte-identical to the 66fedbc file, and every check number is unchanged.
  `SLEEVE-SIZE.jpg` was regenerated with both current print files.
