# Order 1: the garnet man on Ground A

*Written 2026-10-13. The first print-ready sleeve: "The Two Seats — the garnet man",
on Ground A (the drafts' streaky worked leaf and plain moulding), for one 100-pack of
Dragon Shield brushed-matte standard sleeves.*

## The file to upload

**`two-seats-garnet-man.jpg`**, in this folder. 1500 × 2100 px, 600 dpi, 5:7, JPEG
quality 95 (4:4:4), 1.15 MB. The PNG beside it (3.7 MB) is the same picture, kept as the
master; upload the JPEG.

## In the Sleeve Crafter

1. **Size: standard** (63 × 88 mm, for Magic cards). Not Japanese or small size.
2. **Finish: brushed matte.**
3. **Quantity: one pack of 100.**
4. **Upload `two-seats-garnet-man.jpg`.** If it asks how to fit the picture, choose the
   option that fills the sleeve (fill, cover, or full bleed) rather than one that fits it
   inside a border.
5. **Look at the preview before you pay:**
   - [ ] **The crop.** The picture fills the sleeve edge to edge. The outer gold moulding
         may lose a little at the edges; it is meant to run off. The thin dark line inside
         the moulding should still show on all four sides.
   - [ ] **The lamp is on the centre line.** The round lamp sits in the exact middle of
         the sleeve, top to bottom and left to right. If it looks off centre, the picture
         has been shifted or cropped unevenly.
   - [ ] **No border added over the moulding.** If the crafter lays its own frame or
         coloured edge round the picture, look for a "no frame" or "full bleed" option. If
         there is none, note how wide its border is and whether it hides the dark line.
   - [ ] **Both faces whole.** The face that is the right way up and the one upside down
         are both complete, with the top of each hood clear of the edge (about 10 mm to
         spare).
   - [ ] **Nothing stretched.** The lamp is round, not oval.
6. If all five look right, order. If one does not, stop and write down which one.

## When the sleeves arrive

- [ ] **The gold.** It should print as a warm, worked, slightly streaky ochre. Note it
      if it has gone brown, green or flat yellow.
- [ ] **The dark hood and shadows.** At arm's length, the deepest parts of the hood and
      the hair should still show some detail, not solid black.
- [ ] **One painting.** The face, hood, robe, hands and cards are one painted pass (the
      owner's pick, seed 9702), so nothing should look crisper or flatter than the face.
      Note any part that reads as pasted on.
- [ ] **The cheek.** His left cheek (your right) carries a cool grey shadow. It should
      read as shadow, not as a blue or green smear.
- [ ] **The hands and cards.** Two old, bony hands whose fingers interlace at the centre,
      both thumbs up on the front card. The cards are near-black warm grey backs with dull
      gilt edges, not blue, and carry no marks, numbers or letters.
- [ ] **The robe's left edge.** The sleeve falls in a slope to the table, as cloth. It
      should not read as the corner of a chair.
- [ ] **The props.** On the table's near edge, painted like the man: a pewter tankard
      with a soft shadow on the wood, a crumpled linen napkin and one coin.
- [ ] **The lamp.** A painted glass globe with a gold band across the centre line. Its
      glow on the wood should look the same above and below the band.
- [ ] **One sleeve with a real card in it.** It slides in and shuffles like your other
      sleeves.

Write down anything that looks wrong before ordering more.

## How this file was made

The figure is the owner's pick from the one pass (`one-pass/NOTES.md`): **DreamShaper XL
fp16 at 0.40, seed 9702**, the whole figure painted in one pass on Ground A2. The owner
said: "go with 9702 and just fix it up". The finish (`finish/tools/`) edits the one pass's
**unlifted top half**, then lifts and turns it exactly as the one pass did.

**Every repair is painted.** Each is an SDXL inpaint with the same model, the same pipeline
(`one-pass/tools/paint2.py`: 32 steps, CFG 6, DPM++ Karras) and the one pass's prompt
family. Each is run at the lowest strength that fixed the problem, and was looked at at 2×
or more before it was accepted. `finish/tools/fix.py` only cuts out the source and the
drawn mask (`finish/tools/regions.json`) and puts the painting back, with a 1 px soft joint.
There was no blur, grain or texture matching.

| Fix | How | Kept |
|---|---|---|
| 1. Hands: a finger missing, fingers fused | x 640–868, y 776–912, painted at 3×, 0.50 and 0.58 × seeds 9801–9805 (10), the brief's prompt and negatives | **0.58 s9803**: four fingers and a thumb on each hand, interlaced, thumbs on the front card. 0.50 s9805 grew a bulge between the hands; 0.58 s9802's right hand shows three fingers. A warmer second pass (0.30/0.36 × 2 seeds) did not change the skin, so it was not used |
| 5. Cards: the front one slate blue | `finish/tools/cards.py`, a value and hue shift confined to the card mask (as the brief allowed): luma to 14 + 0.45 Y, warm grey; the light edges to a dull gilt. Done before the hands, so the hands pass repainted the fan's foot | plain at 200%, no marks |
| 2. Tankard: a sticker | painted at 4×, 0.50/0.58 × 2 seeds | **0.50 s9811**: pewter, a soft painted shadow |
| 2. Napkin and coin | painted at 4×, 0.55 × 3 seeds | **s9821**. s9822 showed the mask's edge |
| 3. Lamp: an airbrushed ball | painted at 3× on the whole card. The first mask took in the glow on the wood, and the step at the seam showed. The second takes the globe only (0.50 × 3 seeds); its top half turns with the card | **0.50 s9831**: a glass globe with a gold band. The wood's glow is unchanged, so it stays symmetric |
| 4. Robe's left edge: a chair back | 0.45/0.52 left the drawn square corner in place. A **layout guide** (`robeguide.py`) cut the corner back to Ground A2 along a slope, and the inpaint (3.5×, 0.50/0.56 × 2 seeds) painted the new edge, matted against Ground A2 as the one pass was | **0.56 s9841**: the sleeve falls as cloth with a clean edge |
| 7. Cheek: the blue-green smear | painted at 3×, cheek and jaw only, eyes excluded. At 0.28 and 0.35 the smear stayed, so it was rerun at 0.40/0.46 × seeds 9851/9853 | **0.46 s9851**: a cool grey shadow. The rest of the face is the pick's own pixels |
| 7. Collar: a saturated blue strap | taken from the shoulder pass, through the collar ellipse only | **0.42 s9861**: dissolved into the dark collar |
| 6. Shoulders | 0.42 × 2 seeds: their outline did not move at that strength | **left as painted** |
| 8. Hands' colour: paler and cooler than the face (finish 2) | `finish/tools/handskin.py`, a Lab mean match of the hands' lit skin to the face's lit skin (`skinlib.py`'s masks: hue 12–50°, sat ≥ 0.12, value ≥ 0.42, eyes, brows and mouth cut out). Applied to the hands' skin only, shadows between the fingers included; the cards, the gilt edges and the cuffs are untouched. The full std match (k = 1) was blotchy and k = 0.5 still patchy, so the means only (k = 0) | hue 29.5° → 32.2° (face 32.1°), sat 0.449 → 0.605 (face 0.599), value 0.653 → 0.636 (face 0.637), b* 25.2 → 35.0 (face 35.2). Every mean within 1% of the face's. No pixel moved and nothing was repainted, so the fingers are as before: four and a thumb each, both thumbs on the front card |
| 9. Cheek: a faint cool grey left by the smear (finish 2) | `finish/tools/cheekskin.py`. Lightness is kept, and only the chroma moves toward the face's own skin at the same L*, fitted from the face. Drawn patch from the nose to the face's right edge, right eye excluded, feathered; the hood's black (L* < 22) is left | the patch's mean a*/b* 6.3/19.3 → 9.8/26.0 at the same L* 39.0. 3,010 px changed. At 2× and 4× it is the same man |

Also checked at 2×: the figure's outline against the leaf (no halo, no gold intrusion) and
the hood's thin gilt hem, which is trim and not a fault. GPU time was about 40 minutes,
under `flock …/gpu.lock nice -n 15`.

**Post-work:** the one pass's black-point lift, once (+ 24·(1 − L/56)² below L 56), then
the 180° turn, asserted (`finish/tools/build.py`).

**Checks** (`one-pass/tools/check2.py`, `finish/check.json`):

- **Symmetry:** exact under the 180° turn.
- **Darks:** the darkest 0.5 mm reads **28.0** (rule ≥ 24). The darkest pixel is 25.3.
- **Saturation × value in the figure:** p99.5 is 122.4. The maximum is 151.9, from **one**
  hot red pixel at the hood's edge (720, 500). It was already there in the pick, and it is
  the only pixel in the figure over 150.
- **Saturation × value, whole card:** the maximum is 168.9, in the lamp's core, as before.
- **Field:** brightest-channel mean 154.9, maximum 213.
- **Margins:** hood top 245, left 408, right 406 (rule ≥ 110). Props 443 and 399.
- **Cards:** plain at 200% (`CHECK.jpg`). 23 bright-speck clusters (107 px), all wear on
  the edges. There are 23,855 dark face px (24,039 before finish 2). The warmer hands now
  claim a rim of shadow where they meet the fan.
- **File size:** the JPEG at q95 is 1,154,029 bytes.

**Sheets:**

- `CHECK.jpg`: the finished card, the raw pick and the previous order-1 file side by side,
  then every fix at 2×, before and after. Last come finish 2's two fixes at 2×, against the 6cf1ff1 file: the
  hands with the face beside them, and the cheek.
- `SLEEVE-SIZE.jpg`: all three at true size, with a 10 mm bar.

**To rebuild**, run from `~/scenery-packs/two-seats-work/order1/finish`:

1. `finish/tools/onepass_top.py ../onepass/raw/ds-40-s9702.png work/s9702.png`, run from
   `../onepass`. This is the one pass's composite, and it reproduces the one-pass card byte
   for byte. It saves the unlifted top before the lift; copy that to `work/top0.png`.
2. `cards.py work/top0.png work/top1-cards.png`.
3. `fix.py cut`, then `gpu3.sh spec-finish1.json` and `spec-finish3.json`, with
   `robeguide.py` before robeedge2.
4. `fix.py paste` in this order: hands, robeedge2, tankard, napkin, lamp2, cheek2, collar.
5. Finish 2: `cheekskin.py work/top-final.png work/top-f2-cheek.png`, then
   `handskin.py work/top-f2-cheek.png work/top-final2.png 0`. The last argument is the std
   weight: 0 matches the means only.
6. `build.py`, `check2.py`, `sheets3.py`.

## History

- 2026-10-13, revised after the owner's notes ("the blurriness on the robe sucked", the
  vertical lines were liked, the hands "so divorced from him"): the robe repainted at
  0.38 from round 8's lined form so the fold lines stay crisp, and the hands repainted
  apart, as an old man's hands matched to the face by the numbers; the face, hood,
  props, ground, hem rule and the one black-point lift unchanged. All checks pass as
  before.
- 2026-10-13, finished from the owner's pick of the one pass ("go with 9702 and just fix it
  up"). The hands were repainted to four fingers and a thumb each. The cards are now
  near-black with gilt edges. The tankard, napkin, coin and lamp were painted in the same
  manner. The robe's chair-back edge now falls as cloth, and the cheek smear and collar
  strap were softened. The shoulders were left alone. All checks pass, except the one hot
  hood pixel that the pick already had (151.9).
- 2026-10-13, finish 2, after the owner's "Fix the hands colour and the cheek, then I'll
  order". The hands' skin was brought to the face's skin by a Lab mean match on the hands'
  skin only, with no repaint and no change of shape. The cheek's cool grey was warmed toward
  the cheek's own skin, with lightness kept. Both are colour moves on the unlifted top half;
  the lift and the turn are the same as before. All checks pass, with the same one hot hood
  pixel (151.9). No GPU was used.
