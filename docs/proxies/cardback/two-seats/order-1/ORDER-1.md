# Order 1: the garnet man on Ground A

*Written 2026-10-13. The first print-ready sleeve: "The Two Seats — the garnet man",
on Ground A (the drafts' streaky worked leaf and plain moulding), for one 100-pack of
Dragon Shield brushed-matte standard sleeves.*

## The file to upload

**`two-seats-garnet-man.jpg`**, in this folder. 1500 × 2100 px, 600 dpi, 5:7, JPEG
quality 95 (4:4:4), 1.11 MB. The PNG beside it (3.6 MB) is the same picture, kept as the
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
- [ ] **The torso.** The cloak, sleeves and hands are a new painting in this order.
      Up close they may look a little crisper than the hood. That is expected. Check that
      they do not look blurry, that the cloak's vertical fold lines print as crisp
      tailoring lines, and that the cloak and the hood read as one painting.
- [ ] **The hem.** Just below the chin, where the hood's short cape meets the cloak, you
      should not see a hard line.
- [ ] **The hands and cards.** Two old, bony hands holding a small fan of plain dark cards with
      gold edges. The cards have no marks, numbers or letters.
- [ ] **The props.** On the table's near edge: the cold tankard (a dull skin on top, a
      faint ring on the wood beside it), the crumpled napkin and one coin.
- [ ] **One sleeve with a real card in it.** It slides in and shuffles like your other
      sleeves.

Write down anything that looks wrong before ordering more.

## How this file was made

- **The robe** (cloak, sleeves, arms and fan) is **one** img2img pass from round 8's
  drawn form, at a low strength so that its vertical fold lines stay as crisp tailoring
  lines and only the fills turn to painted cloth: DreamShaper XL fp16, strength **0.38,
  seed 9401**, 32 steps, CFG 6, DPM++ Karras, order 1's prompt plus "vertical pleated
  folds, tailored robe, crisp fold lines" (`tools/spec-order1-rev.json`). Of the six
  candidates (0.30 and 0.38, seeds 9401/9402/9405) it keeps 81% of the drawn lines'
  depth while moving the fills furthest (`tools/robe1-lines.json`; the first order 1
  torso, at 0.55, kept 3%).
- **The hands** are a second img2img pass on round 8's drawn hands alone (a crop at x
  392-808, y 464-720 of the torso, painted at 3×), with a prompt written from the face
  (an old man's bony, weathered hands in a harsh, hard-edged light): strength **0.56,
  seed 9503**, of twelve (0.56 and 0.62, seeds 9501-9506). They were picked as the seed
  whose numbers come closest to the face's (local contrast, edge strength, skin hue and
  saturation, `tools/hands1-match.json`), then looked at: two hands, four fingers and a
  thumb each, thumbs on the cards. They go in through round 7's drawn hand mask
  (`tools/hands1.py paste`).
- There was **no** blur, grain, texture-matching or unifying pass after either pass.
- **The post-work, and all of it:**
  - The paste went through round 7's drawn mask. Painted gold that fell inside that mask
    at the sleeves' outer edge (2,653 px) was left out, so the final's cloak pixels stay
    there.
  - The hem's lightness was blended over 24 px. It had a median step of 4.6 levels.
  - The final's black-point lift was applied once, to the whole card: + 24·(1 − L/56)²
    below L 56. This reproduces the final's lift with 0 pixels different.
- **The face, the hood and its cape** are the final's pixels (100% of their figure pixels
  identical).
- **The props** are the final's painted props, kept.
- **The ground** is the grounds mock A, rebuilt by its own tools (`lift.py`, `grounds.py`),
  which reproduce `../grounds/A-garnet.png` byte for byte.
- `CHECK.jpg` shows three columns, order 1 as it was (666a71f), this revision and round
  8's form; then this revision's hands beside the face at 2×, with the old hands; then
  the robe's fold lines at 2× in all three.
  `SLEEVE-SIZE.jpg` is true size with a 10 mm bar. `tools/check1.json` holds every check.
- **To rebuild**, run from `~/scenery-packs/two-seats-work/order1`:
  `tools/hands1.py paste rev/raw/robe-38-s9401.png rev/raw/hands-56-s9503.png
  rev/work/torso-rev.png`, then `tools/build1.sh rev/work/torso-rev.png <out>`, then
  `check1.py` and `sheets1.py`.

## History

- 2026-10-13, revised after the owner's notes ("the blurriness on the robe sucked", the
  vertical lines were liked, the hands "so divorced from him"): the robe repainted at
  0.38 from round 8's lined form so the fold lines stay crisp, and the hands repainted
  apart, as an old man's hands matched to the face by the numbers; the face, hood,
  props, ground, hem rule and the one black-point lift unchanged. All checks pass as
  before.
