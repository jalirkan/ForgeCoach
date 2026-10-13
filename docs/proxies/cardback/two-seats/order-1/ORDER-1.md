# Order 1: the garnet man on Ground A

*Written 2026-10-13. The first print-ready sleeve: "The Two Seats — the garnet man",
on Ground A (the drafts' streaky worked leaf and plain moulding), for one 100-pack of
Dragon Shield brushed-matte standard sleeves.*

## The file to upload

**`two-seats-garnet-man.jpg`**, in this folder. 1500 × 2100 px, 600 dpi, 5:7, JPEG
quality 95 (4:4:4), 1.10 MB. The PNG beside it (3.5 MB) is the same picture, kept as the
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
      they do not look blurry, and that the cloak and the hood read as one painting.
- [ ] **The hem.** Just below the chin, where the hood's short cape meets the cloak, you
      should not see a hard line.
- [ ] **The hands and cards.** Two hands holding a small fan of plain dark cards with
      gold edges. The cards have no marks, numbers or letters.
- [ ] **The props.** On the table's near edge: the cold tankard (a dull skin on top, a
      faint ring on the wood beside it), the crumpled napkin and one coin.
- [ ] **One sleeve with a real card in it.** It slides in and shuffles like your other
      sleeves.

Write down anything that looks wrong before ordering more.

## How this file was made

- **The torso** (cloak, sleeves, arms, hands and fan) was painted **once**. It is one
  img2img pass from round 8's drawn form. The settings: DreamShaper XL fp16, strength
  0.55, seed 9402, 32 steps, CFG 6, DPM++ Karras. The prompt and negatives are in
  `tools/spec-order1.json`. There was **no** blur, grain, texture-matching or unifying
  pass afterwards.
- **The post-work, and all of it:**
  - The paste went through round 7's drawn mask. Painted gold that fell inside that mask
    at the sleeves' outer edge (2,835 px) was left out, so the final's cloak pixels stay
    there.
  - The hem's lightness was blended over 24 px. It had a median step of 6.8 levels.
  - The final's black-point lift was applied once, to the whole card: + 24·(1 − L/56)²
    below L 56. This reproduces the final's lift with 0 pixels different.
- **The face, the hood and its cape** are the final's pixels (100% of their figure pixels
  identical).
- **The props** are the final's painted props, kept.
- **The ground** is the grounds mock A, rebuilt by its own tools (`lift.py`, `grounds.py`),
  which reproduce `../grounds/A-garnet.png` byte for byte.
- `CHECK.jpg` shows this file beside the previous torso, with the hem and the hands at 2×.
  `SLEEVE-SIZE.jpg` is true size with a 10 mm bar. `tools/check1.json` holds every check.
- **To rebuild**, run from `~/scenery-packs/two-seats-work/order1`:
  `tools/build1.sh raw/torso-garnet-55-s9402.png <out>`, then `check1.py` and
  `sheets1.py`.
