# The Two Seats, repainted for the sleeves

*Written 2026-10-12. This is the double-ended court card from
[`../direction/`](../direction/) (concept 3 in
[`../PROXY-BACK-DIRECTION.md`](../PROXY-BACK-DIRECTION.md)), repainted to a
finished standard as the art for custom card sleeves. It is not the card back.*

## What is here

| File | What it is |
|---|---|
| `two-seats-garnet.png` / `.jpg` | **Final, garnet.** 1500×2100 px at 600 dpi; the JPEG is the same pixels at quality 95 |
| `two-seats-green.png` / `.jpg` | **Final, green.** The same figure, recoloured, with its own unifying pass |
| `two-seats-blue.png` / `.jpg` | **Final, blue.** The same, in blue |
| `candidates/1-A-garnet.jpg` | Candidate 1: the garnet final |
| `candidates/2-B-garnet.jpg` | Candidate 2: the other face (lids lower) and the other hands repaint |
| `candidates/3-A-garnet-tooled.jpg` | Candidate 3: candidate 1 with the code-drawn tooled gold laid over the painted ground at 35% |
| `CONTACT-SHEET.jpg` | All six full candidates, labelled |
| `FACES-HANDS-ZOOM.jpg` | Face, hands and lamp at 100% (one print pixel each) for the direction's old version, candidates 1 and 2, and the green and blue finals |
| `CUT-SAFE.jpg` | The three finals with the 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `WORDS-MOCK.jpg` | **A mock, not the art.** Where words would go (see *Words*) |
| `*.txt` | Beside every image: the model, every pass in order with its prompt, negative, seed, strength and size, and the measured print numbers |
| `tools/` | Every script, plus `specs/` (each GPU round's spec and log) |

All three finals are the same painting. Only the robe changes.

## Size: what is known and what is not

**The vendor.** The owner is ordering Dragon Shield custom sleeves, made in its
Sleeve Crafter (*custom sleeves, brushed*), in the Standard size. What Dragon
Shield publishes, as checked on 2026-10-12:

- Standard sleeves fit cards up to 63 × 88 mm.
- The uploader takes JPEG, JPG or PNG.
- It asks for a **5:7 image at 300 dpi or more**.
- The sleeve back is printed, border included. The inside of the sleeve is white,
  so a card's face never shows through.
- The finish is brushed, and a pack holds 100 sleeves.
- The editor adds its own frames and crops at preview time.

**The file.** The art is **1500 × 2100 px at 600 dpi**: 5:7, 63.5 × 88.9 mm,
which is twice the 300 dpi minimum. The gold ground runs right to the edge.
Each final also comes as a JPEG of the same 1500 × 2100 pixels at quality 95
(4:4:4 chroma, tagged 600 dpi). That is the file to upload. At 300 dpi the
same pixels would cover 127 × 178 mm, so the Crafter will scale the image
down, never up. The old card-back geometry (1632 × 2220, cut 75, safe 135)
does not apply to this piece.

**The margin.** Dragon Shield does not document how much of the image its crop
removes, how much the sleeve's rounded corners and edge wrap take, or how wide
a border style is. So everything that matters sits inside the **central ~85%**,
a margin of **110 px (4.7 mm)** on every side, as measured on the garnet final:

| Element | Position |
|---|---|
| Top of the hood | 257 px from the top edge (the bottom seat's hood is 257 px from the bottom) |
| The robes | x 255 to 1244, so at least 255 px from either side |
| The table board | x 200 to 1300, with the lamp at its centre |
| The painted floral frame band | about 120 to 150 px from each edge |
| The plain gold bevel | 0 to 110 px: bleed, and losing it costs nothing |

The floral band is decorative and may be partly cropped.

**What remains to confirm, in the Crafter's preview before ordering:**

1. **Whether a border style is drawn over the art.** One listing is named
   *brushed black borders*. If a border is drawn, it covers the outer gold, and
   possibly the floral band.
2. **How the 1500 × 2100 image maps onto the sleeve**: how much the rounded
   corners and edge wrap trim.
3. **Whether the gold survives the printer's colour conversion.** The darkest
   areas are at RGB 37 and nothing is neon (saturation 148–150 of 255 at the
   99.5th percentile). Even so, printed gold usually comes out duller than it
   looks on screen, so one test pack before a big order is worth it.
4. **That the Crafter does not reject or recompress a 600 dpi PNG.** If it
   does, upload the JPEG.

## What was fixed, and how

Everything was painted on local SDXL (DreamShaper XL, fp16, GTX 1080) under the
GPU lock. That came to about **70 minutes of GPU time** over 11 rounds and 63
images. The top half was painted at the sleeve's own scale (1500 × 1052), and
the face, the hands, the lamp and the table were each repainted from crops at
2.2× to 3.2×. The bottom half is the top half turned 180°, and the build
asserts that the symmetry is **exact, pixel for pixel**.

- **The faces (one was sallow, one was malformed).**
  - **Painted at strength 0.68.** The body was painted over a new code guide
    with draped folds, a drawn face and a fur-trimmed hood. At 0.68 the model
    paints a real 15th-century panel figure, not a cut-out (round r2). At 0.55
    it stayed clip-art; at 0.78 it painted real playing cards with pips, which
    were rejected.
  - **Repainted from a 3.2× crop at 1024 px** (r3). This sharpened the face, but
    every seed looked straight out.
  - **Eyes lowered.** So the eyes look down at the cards, the lids were drawn
    down to a sliver of iris in code, and the face was repainted again (r4,
    six faces). The face is warm-skinned with rosy cheeks, the opposite of the
    old sallow one.
  - **The two faces kept.** Strength 0.50 / seed 1412 (lids lowered, iris
    visible) became candidate 1. Strength 0.42 / seed 1412 (lids lower still)
    became candidate 2.
  - **Taken back after the unifying pass.** The low-strength pass that pulls the
    whole image together softened the faces, so both are taken back from the
    lit, pre-pass half.
- **The hands (they were soft and malformed).**
  - **What failed.** The direction's drawn hands stayed cartoonish at 0.45–0.55.
    The tile ControlNet held them cartoonish even at 0.75. A hands-only crop at
    0.72–0.80 painted real hands, but they floated in front of the cards.
  - **What worked.** At 0.68, the body pass had painted a pair of natural hands
    holding a small book. So `tools/fan.py` keeps the painting's own hands,
    draws the fan of cards *behind* them, and lays the hands back on top with
    a skin mask. Then the hands and fan crop was repainted at 2.17× (0.46,
    r5), and the hands alone at 3× (0.34, r7).
  - **Then lit.** The lamp's light warms the fingers and cuffs.
- **The fan of cards (the model would not paint one).** The fan is seven plain
  dark backs with a thin gilt edge and a soft shadow on each card beneath,
  warmer toward the lamp. It is drawn in code and then painted over twice, so
  it carries brushwork. There are no pips, letters or art on any card. Every
  hand and fan crop was checked at 100%.
- **The lamp (it was flat).**
  - **The guide.** `tools/lamp.py` builds the whole card's centre (both
    halves) and draws a glowing glass globe: a white-gold heart, an amber body
    with a dark rim and a bright edge, window reflections, a beaded gilt band
    on the seam, and a warm pool on the table.
  - **The repaint.** That was repainted at 0.62 (r6). The model added a gilt
    finial top and bottom and a halo. Only the painted top half is used, so
    the lamp is symmetric by construction.
  - **The light.** `finish.py light` spreads the lamp's warm light from the
    centre, strongest on undersides: the hands, the fan's foot and the cuffs.
    Then a low-strength pass (0.24) over the whole half, in two overlapping
    tiles at the sleeve's own resolution, makes the lighting agree.
- **The gold ground (it was streaky).**
  - **The finals.** At 0.68 the model painted a burnished gold ground with a
    lozenge diaper, a red-and-blue floral border band and a plain gold bevel to
    the edge. The finals keep that painted ground.
  - **The code alternative.** `tools/guide.py` also draws a code-only tooled
    gold-leaf ground: 126 px leaves, an incised double frame, punched
    rosettes, a punched bleed row and a lozenge diaper with a punched motif.
    Candidate 3 lays it over the painting at 35%.
  - **Mid-toned throughout.** The darkest blurred areas sit at RGB 37–38
    against the 22 floor. The few single-pixel darks are 17–18, too small to
    print as areas.
- **The table and the seam.**
  - **The table.** The model had painted a pale, stepped slab in the middle
    of the table. The board was redrawn as even walnut with the lamp's pool,
    then repainted as one band across both halves (r10).
  - **The frame bands.** The frame's side bands cross the seam. Below its top
    band, the right side of the frame is mirrored from the left, so each band
    meets its own turned twin without a jog or a ghost.
  - **The last rows.** The model darkens the last rows of any image it paints,
    so in the side zones those rows are replaced by reflection.
- **The colourways.** Green and blue are the garnet painting with the robe's
  hue turned by mask (`finish.py recolour`). The face, hands, fan, fur, gold and
  lamp are untouched. Each colourway then got its own unifying pass with its
  colour in the prompt, so the robe repaints as wool and not as a hue shift.
  The face and hands are the very same pixels in all three.

**Compared and chosen.** Six full candidates are in `CONTACT-SHEET.jpg`:

1. A garnet;
2. B garnet;
3. A with tooled gold;
4. A green;
5. A blue;
6. A with a heavier unifying pass (0.32).

Candidate 6 dropped out. Its 0.32 pass re-opened the eyes and made the face
generic; with the face and hands taken back from the lit half, as every
candidate's are, it differs from candidate 1 only in the cloak and the
ground, and is no better there. The best three are 1, 2 and 3, and they are in `candidates/`. The
finals are candidate 1's figure in all three colourways, which is 1, 4 and 5.
My pick is **candidate 1**: its eyes are on the cards, and you can still see
they are open. Candidate 2 is the quieter, more inward face, and worth a look
in the zoom sheet. The tooled gold of candidate 3 is crisper but colder than
the painted ground.

## Words

The sleeve needs no words. If the owner wants them, they belong on the table's
board, the dark walnut strip between the lamp and each seat's gilt moulding:

- **A line on each side of the table**, split by the lamp and reading toward
  that seat's player. The top seat's line is the bottom seat's turned 180°,
  so the symmetry holds.
- **Room for it.** About 390 px (16 mm) each side of the lamp, at a cap height
  of about 1.2 mm.
- **How to set it.** In gold, in SVG at print time, never painted.

`WORDS-MOCK.jpg` shows it set in C059 (a Century Schoolbook clone), only as a
preview.

Suggested lines (accept or strike):

- **A PROXY · *(the lamp)* · FOR FRIENDS**, which is the mock. It is short, and
  the lamp, the coach, sits in the middle of the sentence.
- **PROXIES · *(the lamp)* · NOT FOR SALE**: plain, and it helps if a printer
  asks that proxies be marked.
- **MAGIC: THE GATHERING · *(the lamp)* · PLAYTEST PROXIES**: names the game
  outright. It is long for the space, so it would need a smaller size or a
  condensed face.

## How to rebuild

The scripts run from a work folder (here `~/scenery-packs/two-seats-work`),
with `HF_HOME=~/scenery-packs/hf-cache`. Each GPU step runs under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`.

1. **The guide.** `guide.py .` writes `guides/`.
2. **The GPU rounds.** Run `paint.py spec-rN.json` for each round, in the order
   the `.txt` files list them. `tools/specs/` holds every spec and log.
3. **The crops.** Between rounds, `crop.py`, `fan.py` and `lamp.py` cut and
   paste them.
4. **The finishing steps.** `finish.py` does the table, the light, the tile
   split and merge, and the recolour.
5. **The final.** `compose.py <half> <out.png> --gold 0 --keep <lit half> --jpeg`
   makes the final, checks the print numbers and asserts the symmetry.
6. **The sheets and sidecars.** `sheet.py` makes the sheets, `sidecars.py` the
   `.txt` files, and `wordsmock.py` the words mock.

## Not done, or worth knowing

- **The right hand is softer than the left** at 100%. It is painted, not
  malformed, and at sleeve size it reads well.
- **The fan's cards are geometric**, since they are code-drawn shapes painted
  over. They have no texture or tooling on their backs, by design (plain dark
  backs).
- **The blue and green are recolourings** of the garnet painting followed by a
  0.24 pass, not separate paintings. That is what keeps them the same figure.
- **The words are only mocked.** The SVG setting is for when the owner chooses
  a line.
- **The Sleeve Crafter's crop and borders** are unverified (see *What remains
  to confirm*).
