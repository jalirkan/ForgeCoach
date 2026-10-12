# The Two Seats, round 2: three people at the table

*Written 2026-10-12. This round answers the owner's verdict on round 1 (the files one
folder up, which are unchanged). It is still the sleeve art for the Dragon Shield
custom sleeves: 1500 × 2100 px at 600 dpi, 5:7, with the content inside a 110 px
margin and exact 180° symmetry.*

## The verdict

**Kept from round 1:**

- the real faces and hands;
- cards with nothing on them;
- the lamp's glow on both players;
- the border that bleeds;
- exact symmetry and print-safe values;
- the punched diamond gold;
- the table as it is.

**Changed:**

1. **Three people**, one per colourway, taken from the first drafts
   (`../../direction/two-seats-1..3.png`) and painted at round 1's fidelity.
2. **A readable human state on each face.**
3. **A hand of cards a person actually holds**, not tablets and not a spread fan.
4. **The streaky worked-leaf gold** of the first drafts, as a comparison variant
   of each figure.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | **Final, the green woman.** Punched diamond gold |
| `two-seats-garnet-man.png` / `.jpg` | **Final, the garnet man.** Punched diamond gold |
| `two-seats-blue-figure.png` / `.jpg` | **Final, the blue figure.** Punched diamond gold |
| `two-seats-*-streaky.png` / `.jpg` | The same three on the first drafts' streaky worked-leaf gold, **for comparison only** |
| `CHARACTERS.jpg` | The three finals side by side, large |
| `FACES.jpg` | The three faces cut from the finals at 3× (each print pixel is 3 px), so the expressions can be judged |
| `GOLD-COMPARE.jpg` | Each character on punched gold beside streaky gold |
| `CUT-SAFE.jpg` | The three finals with the 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `*.txt` | Beside every final: every pass in order, with its job, seed, strength and prompt, and the measured print numbers |
| `tools/` | Round 2's scripts and `specs/` (each GPU round's spec and log); round 1's `../tools/` supplies `paint.py`, `crop.py`, `finish.py` and `compose.py`, unchanged |

The JPEG is the file to upload (quality 95, 4:4:4, tagged 600 dpi), as in round 1.

## The three faces

All three keep the hooded half-length figure and the cloak's silhouette from
round 1. That silhouette is what keeps the seam, the frame and the table identical
across the set. Inside the silhouette, each figure is a different person, in
different clothes, holding a different hand.

- **The green woman: composed, faintly pleased, the better-off player.**
  - *Who.* The first draft's auburn-haired woman. She has a middle parting, a
    gold net over her hair, pearl drops and a fine gold chain, and wears a rose
    velvet gown under the green cloak.
  - *The face.* The lids are eased a little and the mouth carries the slightest
    closed smile, the face of someone whose hand is good and who will not show
    it. The eyes are soft and not quite on the viewer.
  - *Her hand.* Five cards, tidy and evenly fanned.
- **The garnet man: anxious, worried.**
  - *Who.* The first draft's hooded older man, now a careworn Flemish-looking
    burgher with grey-brown hair and a white collar under a dark fur-trimmed
    doublet.
  - *The face.* The brows are knit and raised at their inner ends, the forehead
    is creased, the mouth is pulled down and tight.
  - *His hand.* Seven cards, unevenly held, one of them half drawn up out of
    the fan: he cannot decide.
  - *His eyes are on the viewer.* That is the expression: the worried glance
    across at the opponent.
- **The blue figure: guarded and intent.**
  - *Who.* The first draft's dark-haired figure, now a young man with a dark
    bob and fringe in an ochre wool doublet with a fur collar under the indigo
    cloak.
  - *The face.* The lids are narrowed and the eyes slide sideways, off the
    viewer, as if reading the other player. One corner of the mouth is held
    very slightly up. It is watchful, and close to amused without giving it
    away.
  - *His hand.* Six cards held tight and narrow, close to the body.

`FACES.jpg` is the sheet to judge them on.

## How it was made

**The pipeline.** It is round 1's pipeline: DreamShaper XL fp16 on the GTX 1080,
img2img over code-drawn guides, every GPU process under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`, and nothing downloaded
(`HF_HUB_OFFLINE=1`).

**The GPU budget.** Five rounds, 45 images, **2557 s (43 minutes) of GPU time**,
finished at 18:46.

**The steps:**

1. **The guide** (`tools/prep.py`). Each guide starts from round 1's pre-light
   half, with four changes:
   - *The fan comes out.* Round 1's seven-card fan is taken out, and the
     cloak's opening is redrawn as the character's own gown: a bodice, two
     sleeves running to round 1's hands, and the fur lining continued up to the
     neck.
   - *The cloak is recoloured.* It is turned to the character's colour by
     round 1's mask method.
   - *The draft's face goes in.* The first draft's face and hair are scaled to
     round 1's head (eyes at y 477, chin at y 567) and laid into the hood.
     Their skin is pulled toward round 1's warm tones.
   - *The hood is emptied.* For the man and the blue figure, the hood is
     emptied to its dark lining, and a hair mass of their own is drawn in.
2. **The body pass** (r1): strength 0.52 and 0.60, 1216 × 880, one seed each.
   0.60 was kept for all three. It turned the three draft faces into three
   period portraits that are still recognisably those people.
3. **The hand of cards** (`tools/fan.py`). It is round 1's method: plain dark
   backs with a thin gilt edge, drawn in code *behind* the body pass's own
   hands, which are laid back on top by a skin mask.
   - *Why the cards were tablets.* Round 1's hand was 262 px cards splayed
     ±36°. A hand there is about 115 px long, and a real card is half a hand,
     so those cards were five times life.
   - *The new cards.* They are 130 px long, about 2.5× life, the most that
     still reads as a hand at sleeve size. They are fanned 8–16° apart from a
     pivot in the left hand's grip, and the fan is tilted toward the right
     hand, whose fingers touch its edge.
   - *Each card nudged.* Each card is moved a few px along its length and a
     degree or two in angle, so the fan does not look machine-cut.
4. **The faces** (r2, r3): a crop at 3.2× (1024 px), repainted with each
   character's expression in the prompt, at 0.45 and 0.55 with three seeds each.
   - *The man.* The prompt alone gave a readable worry (0.55, seed 2201).
   - *The woman and the blue figure.* The prompt alone stayed neutral and
     frontal. So `tools/expr.py` nudges the 1024 tile with small smooth
     displacements, and the result is repainted at 0.34:
     - for her, the mouth corners are lifted 9 px and the lids eased 3 px;
     - for him, the irises are slid 13 px sideways, the lids lowered 4 px and
       one mouth corner lifted 5 px.
5. **The hands and the fan** (r2–r4): repainted at 2.17×, at 0.48 (0.62 for the
   blue figure, whose ochre sleeves stayed flat at 0.48), then the hands alone at
   3×, at 0.34–0.36, as in round 1. The man's hands came out older and veined.
   One stray painted stroke, a thin stick between a card and the blue
   figure's finger, was painted out in code (`tools/patch.py`).
6. **The light, the unifying pass and the finish.**
   - *The light and the unifying pass.* Round 1's lamp light is laid on, then a
     0.24 unifying pass runs in two tiles with each character's own prompt.
   - *Round 1's surroundings.* The figure is laid into round 1's finished half
     (`tools/figmerge.py`), so the gold ground, the floral band, the table and
     the lamp are round 1's own pixels.
   - *Two leftovers fixed.* A red rim of round 1's wider garnet cloak, along
     the green and blue outlines, is turned to the cloak's colour
     (`tools/edgefix.py`). Round 1's card tips on the table's gilt moulding
     under the hands are redrawn away (`tools/moulding.py`).
   - *Composed.* Round 1's `compose.py` (unchanged) takes the face and hands
     back from the lit, pre-unify half, turns the half for the bottom seat,
     caps chroma, checks the dark floor and asserts the symmetry.
7. **The streaky variant** (`tools/streaky.py`, code only, no GPU).
   - *The texture.* The first draft's worked-leaf gold (from
     `direction/two-seats-3.png`) is re-tiled from random vertical strips, to
     avoid mirror patterns.
   - *Laid under the painting's light.* Its fine detail is laid over the
     painting's own low-frequency colour, so the lamp's glow and the bevel's
     shading survive.
   - *Where it goes.* It is applied outside each character's outline
     (`tools/figmask.py`), and outside the table, the lamp and the floral band.

`tools/build.sh <green|garnet|blue>` rebuilds both finals of a character from
its unified tiles. Each final's `.txt` lists its passes.

## Tried and dropped

- **Body pass at 0.52.** The same three people, painted less fully: plainer
  faces, flat sleeves, no jewellery on the woman.
- **Face at 0.45 with the prompt alone,** for the woman and the blue figure. The
  expression did not move, which is why `expr.py` exists.
- **Face seeds.** The other two seeds per strength were dropped:
  - one gave the man a purple cap;
  - the blue figure's 0.34 seed 2402 lost the sidelong glance.
- **The blue hands at 0.40 and 0.48.** The ochre sleeves stayed flat blobs.
- **The first fan layout.** 210 px cards round a centre pivot still read as
  tablets.

## Print and margins (measured on the finals)

| | Green woman | Garnet man | Blue figure |
|---|---|---|---|
| Top of the hood | 259 px from the edge | 259 px | 259 px |
| Robes, x | 249–1250 | 253–1246 | 256–1236 |
| Darkest 0.5 mm areas, 0.5th percentile | 41.5 | 29.8 | 31.3 |
| Saturation × value, 99.5th percentile (punched / streaky) | 148 / 152 | 148 / 152 | 149 / 152 |
| 180° symmetry | exact | exact | exact |

- **Inside the margin.** Everything that matters sits inside the 110 px
  margin, at the same places as round 1. The floral band is at 120–150 px and
  may be cropped, and the plain gold bevel is bleed.
- **Dark floor.** No final needed a shadow lift: the darkest areas are all
  above the 22 floor. The darkest single pixels are 18, as in round 1, too small
  to print as an area.
- **Still open from round 1.** The Sleeve Crafter's crop, its borders and its
  colour conversion are still unconfirmed (round 1's *What remains to
  confirm*).

## Not done, or worth knowing

- **One silhouette for all three.** The three share round 1's hooded silhouette
  and the hood's pointed opening. They are three people, but not three
  different poses. A different pose per character would mean new figure guides,
  and new seam and frame work for each.
- **The man's hair.** It has a slightly cut-out upper edge against the hood's
  dark lining, visible at 3× in `FACES.jpg`, not at sleeve size.
- **The man's gaze.** He looks straight at the viewer; the other two do not.
  That glance is his anxiety. If the owner reads it as staring, a sideways
  `expr.py` nudge and a 0.34 repaint is a two-minute GPU job.
- **The woman's smile.** It is deliberately slight. A stronger one was not
  tried; raising the corner lift in `tools/expr.py` and repainting at 0.34 is
  the way to get it.
- **The streaky variant.**
  - *How it was made.* It is a code composite, with no unifying pass over the
    new ground.
  - *Its edge.* A thin soft band of the punched ground is left along each
    figure's outline, about 2–4 px.
  - *What it loses.* The outer bevel loses its mitre lines.
- **The ochre doublet.** The blue figure's doublet is close in hue to the
  gold. It holds apart from the gold by value and by the fur and the indigo
  cloak, but it is the least separated of the three.
- **Round 1's files** are untouched.
