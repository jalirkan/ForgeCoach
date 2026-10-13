# The Two Seats, round 7: hands, fan, arms and chests, drawn flat

*Written 2026-10-13. This is the sleeve art for the Dragon Shield standard sleeves:
1500 × 2100 px at 600 dpi, 5:7, exact 180° symmetry, with what matters inside a
110 px margin. Rounds 1 to 6 are untouched.*

## The brief

The owner on round 6, in short:

- the hands had turned hyper-real and arthritic, and pulled attention from the
  faces;
- the sleeves were flat bands with outlines, laid on top of the cloak;
- the chests were soft gradients;
- the fan had moved off the centre into a "tablets" pose.

The fixes asked for, all in round 4's flat court-card style:

1. both hands drawn in code, holding the fan together at the centre of the chest,
   as round 4's drafts 1 and 3 hold theirs;
2. round 2's plain dark, gold-edged cards, 5 to 7 of them in a modest spread,
   centred between the hands;
3. the arms drawn as part of the cloak, shoulder to wrist, with a cuff;
4. the chests in flat folds: bold fold lines and two flat tones.

The faces, the cloaks' main bodies, the gold, the border, the table band, the lamp
and the glow stay as round 6 has them.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | Final, the green woman |
| `two-seats-garnet-man.png` / `.jpg` | Final, the garnet man |
| `two-seats-blue-man.png` / `.jpg` | Final, the blue man |
| `CHARACTERS.jpg` | The three side by side, in round 6's layout |
| `ROUND6-VS-ROUND7.jpg` | Each round-6 final beside its round-7 version |
| `HANDS-ZOOM.jpg` | The hands, fan, arms and chest (x 420–1080, y 540–944) at 2×; round 6 on the left, round 7 on the right |
| `SLEEVE-SIZE.jpg` | True print size: 744 × 1039 each, with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `tools/` | This round's scripts, plus `specs/` (the GPU spec and its log) |

The JPEG is the file to upload (quality 95, 4:4:4, tagged 600 dpi), as before.

## How it was made

Everything happens in the top half (1500 × 1052, the seam at y 1050), on round 6's
final. The bottom seat is the top half turned 180°.

`tools/draw7.py` redraws the torso below a hem: everything inside the silhouette,
from the hem down to the moulding (y 944).

- **The hem** is round 6's own chest arc (radius 335 about (750, 872)), the line
  where round 6's soft front began.
- **Where it dips.** Under the chin it dips smoothly so that it never enters round
  6's face ellipse.
- **How it reads.** It is drawn as a bold line with a flat shadow band under it,
  so it reads as the hem of a hooded shoulder-cape.
- **The cape's hem line** replaces round 6's soft blend into the draft's cloth.
- **Above the hem**, the hood, the face and the cape's shoulders are round 6's
  pixels.

The parts are drawn at 4× and reduced, so every line is antialiased. They are laid
in this order: front, arms, fan, hands, cuffs.

### Fix 1: the hands (drawn; no model pass kept)

- **The shape.** Each hand is one outlined shape in a local frame, mirrored for
  the other side:
  - the back of the hand, widening from the wrist;
  - a thumb lying along the top toward the fan's foot;
  - the curled fingers rounded at the front, with three short lines between them.
- **What is left out.** There are no knuckles, nails, veins or highlights.
- **The colour.** Flat skin: half each face's own median skin tone and half a light
  peach, as the drafts' hands are. A second flat tone (×0.8) forms a narrow band
  along the underside.
- **The line.** A 3.2 px dark warm-brown outline (2.3 px for the finger lines).
- **The pose.** Both wrists sit 100 px either side of the centre line, at y 874.
  The hands tilt up 14° and 10° toward the centre and meet over the fan's foot.
  The right hand slightly overlaps the left one's fingertips, as in draft 1.
- **The model pass.** A torso pass ran at 0.22 and at 0.30 (below). On the hands
  it only smoothed the lines and wiped the print grain, so **the drawn hands are
  kept** as the more woodcut of the two.

### Fix 2: the fan (drawn)

- **The cards.** Six of round 2's cards, drawn in round 2's colours:
  - a back of (76, 75, 81);
  - a gilt edge of (226, 180, 118);
  - a thin dark rim;
  - rounded corners.
- **The size.** Each card is 134 × 188 px, about round 6's size.
- **The spread.** The cards pivot about one point, (750, 850), at −25° to +25°.
  The foot of the fan is hidden behind the two hands, and the fan is centred
  between them.
- **Plain cards.** Every card back is one flat colour plus the same fine grain as
  the rest of the drawing. At 100% there are no pips, letters or marks. No model
  pixel was pasted on the cards.

### Fix 3: the arms (drawn; no model pass kept)

- **The outer line.** Each arm starts where the hem meets the silhouette, so its
  outer line is the silhouette's own line there.
- **The shape.** From there it runs down inside the cape to the elbow. The cape
  flares away from it, by up to 36 px at y 860. The arm then bends in along the
  forearm to the wrist.
- **Fill and line.** The fill is the cloak's flat colour, a little lighter than
  the robe. The bold outline is 4.2 px. The cape's silhouette below the hem gets
  the same line, at 3.8 px.
- **The second tone.** A flat second tone (the robe's colour) runs down the inner
  side of the upper arm and along the forearm's underside.
- **The arm's own lines.** One drape line down the upper arm, and two short fold
  strokes at the elbow.
- **The cuff.** A darker flat band, 26 px long and a little wider than the
  forearm, with its own outline. The hand comes out of it.
- **No bands on top.** Round 6's sleeves, its green cuff blob and its blue ochre
  cuff are all below the hem, so all of them are gone.

### Fix 4: the chests (drawn; no model pass kept)

- **The front** is the robe between the arms.
- **The fill** is one flat tone of the cloak's colour, with a second flat tone in
  strips.
- **The folds.** Nine bold fold lines (3.7 px) hang from the hem and splay a
  little toward the table. They are irregular, as the drafts' cloth folds are:
  - four run the whole way from the hem;
  - five start lower down;
  - each wavers gently.
- **The strips.** Seven of the folds have a flat shadow strip toward the centre,
  widening down to 10–22 px.
- **No gradient** anywhere.

### The silhouette below the hem

Round 6's cut-out edge has notches, such as a 20 px step on the garnet man's left.
A bold outline would trace them. So below the hem the silhouette is redrawn as an
outer envelope:

- a running maximum over ±7 rows;
- then a gaussian with σ 6 rows.

The notches are bridged rather than traced. Where that edge passes outside round
6's cut-out, the drawing covers a few pixels of gold. The figures are in the
checks below.

### Grain and darks

- **Grain.** A fine grain (σ 3.2, blurred 0.7 px) is added to the drawn parts
  only, so they are matte print rather than vector-flat.
- **Darks.** No drawn pixel's luminance is below 22 before it is blended into round
  6's edge pixels.

### The model pass (run, then not used)

- **The tile.** A torso tile (x 400–1100, y 500–944, at 1.6× = 1120 × 712) was
  passed at **0.22 and 0.30**, seeds 7101 and 7102, with the brief's prompt (*flat
  medieval court-card illustration, woodcut-like, bold black outlines, flat colour,
  limited palette, matte, no shading, no realism, no photo*). The full prompt and
  negative are in `tools/specs/spec-t.json`.
- **What it did.**
  - On the hands, it only softened the lines.
  - On the arms and fronts, it softened the lines and wiped the grain, and at 0.30
    added a faint mottle on the garnet arm.
- **The choice.** None of it was more woodcut than the drawing, so all three
  finals are the drawing.
- **The paste script** for a part-by-part paste is still here (`tools/paste7.py`),
  but it is unused.

### The last step

`tools/final7.py` works as follows:

- **Where the drawing goes.** The drawn half goes into round 6's final only where
  something was drawn (`dm-<tag>`).
- **What is forced to round 6.** The mask is forced to zero on round 6's face
  ellipse and on every row from y 944 down.
- **Both seats.** The half is turned for the bottom seat, and the symmetry is
  asserted.

## Checks (measured on the finals, both seats)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| All pixels byte-identical to round 6's final | **87.2%** | **86.6%** | **87.2%** |
| Faces (round 6's face ellipse) | 100% | 100% | 100% |
| Cloaks' bodies outside the drawn torso (hood and shoulder-cape) | 100% | 100% | 100% |
| Gold field outside the figure (round 6's cut-out grown 3 px) | 99.79% | 99.83% | 99.89% |
| Border and frame (outside the gold field) | 100% | 100% | 100% |
| Table band, lamp and glow (y 944 to the turned moulding) | 100% | 100% | 100% |
| Darkest 0.5 mm areas, 0.5th percentile | 32.7 | 27.7 | 32.5 |
| Saturation × value, 99.5th percentile | 148 | 148 | 148 |
| 180° symmetry | exact | exact | exact |

- **The gold that changed** (0.1–0.2%) is the redrawn silhouette edge. It lies at
  most about 9 px outside round 6's cut-out, where the notches are bridged.
- **The cloak's main body** below the hem is redrawn on purpose. Round 6 had
  already replaced most of it with the soft front, the sleeves and the hands, and
  the fixes needed the rest of it. Only the hood and the shoulder-cape above the
  hem are the draft's cloth.

## GPU time

DreamShaper XL fp16 on the GTX 1080, under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`, offline.

- **The pass.** One torso pass of 12 images (3 figures × 2 strengths × 2 seeds) took
  **316 s (about 5.3 minutes)**, finished at 09:51:30.
- **The wait.** It waited about 18 minutes for another job's lock first. That time
  is not counted.

## Not done, or worth knowing

- **No model pixels in the finals.** The hands, fan, arms and fronts are the
  drawing alone, so they are crisper and flatter than the painted hoods and faces
  above them. A light pass did not bring them closer; it only made them softer.
- **The shoulder-cape hem is new.** It is a costume line round 6 did not have. It
  is the arc where round 6's soft front began, now drawn as a hem.
- **The blue man's hem** crosses the gold trim strip that hangs from his hood, so
  the strip ends at the hem.
- **Just above the hem under each chin**, inside round 6's face ellipse, a strip of
  up to about 15 px of round 6's soft fill is kept, because the ellipse is held
  byte-identical. It sits under the dark scarf or collar.
- **The fan is smaller than round 6's.** That is the "modest spread" asked for. It
  is much smaller than the drafts' big sector fan.
- **The Sleeve Crafter's crop, borders and colour conversion** are still
  unconfirmed, as in rounds 1 to 6.

## Reproduce

Run from `/home/justin-a/scenery-packs/two-seats-work/round7`, with round 6's
finals in `../round6/final` and round 6's masks in `../round6/comp`
(`figm-`, `arm-`):

1. `draw7.py ../round6/final/two-seats-<name>.png ../round6/comp <c> comp --hand-scale 1.06`
2. *(optional, not used)* `region.py cut comp/d-<c>.png 400 500 1100 944 1120 712 comp/t-in-<c>.png`, then `gpu.sh specs/spec-t.json`, then `paste7.py`
3. `final7.py ../round6/final/two-seats-<name>.png comp/d-<c>.png comp <c> ../round6/comp final/two-seats-<name>.png`
4. `sheets7.py <this dir> <round 6 dir>`
