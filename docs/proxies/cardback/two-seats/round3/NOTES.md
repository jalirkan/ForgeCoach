# The Two Seats, round 3: one painting per half

*Written 2026-10-12. The sleeve art for the Dragon Shield custom sleeves, 63 × 88 mm:
1500 × 2100 px at 600 dpi, exact 180° symmetry, the important parts inside a 110 px
margin, darks at RGB 22 or above, no neon. Rounds 1 and 2 (`../`, `../round2/` on
their own branches) are unchanged.*

## What changed, and why

The owner's verdict on round 2 was that it looked stupid. The people were tiny in a
field of gold wallpaper inside a fat frame. The hood made a symmetric egg with a face
in a hole. The cards were a cluster at the belly, and the lamp was a yellow ball on a
plank. The whole thing read as parts pasted into a template, which is how it was made.

Round 3 stops compositing. Each half is **one painting**, made by the model in one
pass. It is a half-length portrait of a card player across the table, lamp-lit from
below. The figure fills the half: its head is near the top, the cards are at
mid-height and the table runs along the seam. Faces and hands are then repaired at
high resolution. The border is thin, 50 px, and it bleeds.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | **Final, the green woman.** The JPEG (q95, 4:4:4, 600 dpi) is the file to upload |
| `two-seats-garnet-man.png` / `.jpg` | **Final, the garnet man** |
| `two-seats-blue-man.png` / `.jpg` | **Final, the blue man** |
| `CHARACTERS.jpg` | The three finals side by side |
| `FACES.jpg` | The three faces cut from the finals at 3× (each print pixel is 3 px) |
| `SLEEVE-SIZE.jpg` | **The three at true print size.** It is a 300 dpi canvas, each panel 744 × 1039 px (63 × 88 mm), with a 10 mm scale bar. Print it at 100 % or hold a real card against the screen to judge what a face looks like on a sleeve |
| `COMPOSITION-SEEDS.jpg` | Every composition seed, labelled. The top row is the model and strength trials; the other rows are four seeds per character, with the chosen one marked |
| `tools/` | This round's scripts, every GPU spec (`specs/`) and the GPU logs (`specs/logs/`) |

## The three people

- **The green woman** (seed 303). Auburn hair parted in the middle, a dark bodice
  under a green velvet cloak, and a rose skirt.
  - *Her face.* Composed, lids a little lowered, the mouth closed and level to
    faintly pleased. It is the face of someone whose hand is good. The smile is
    slight; face seed 502 has more of it than 501.
  - *Her cards.* She holds six cards up and out in her right hand, the way a hand
    is held when you are not worried about it. Her left hand rests by the lamp.
- **The garnet man** (seed 314). An old man in a black cap, white beard and a red
  fur-trimmed robe, in a carved chair.
  - *His face.* Brows knit and raised at the inner ends, forehead creased, eyes on
    the viewer: the worried look across the table.
  - *His cards.* Seven cards held up close in both hands, high enough to hide his
    beard. He is peering over his hand.
- **The blue man** (seed 321). A young man with a dark fringe and shoulder-length
  hair, in a dark doublet under a deep blue velvet cloak. This answers last round's
  ochre doublet, which sat too close to the gold.
  - *His face.* Narrowed eyes, a level mouth, intent and unreadable, and a
    sidelong look: his eyes slide off the viewer toward his right, as if reading
    the other player.
  - *How the look was made.* Neither face seed gave the sidelong look from the
    prompt. Seed 522, the more guarded of the two, was nudged by `tools/expr.py`
    (round 2's method, re-measured): the irises are slid 14 px and the lids
    lowered 4 px, and the tile was repainted at 0.34 (`specs/r7.json`, seed 531
    kept).
  - *His cards.* Six cards held low in both hands, close to the body, with the
    right hand over the fan.

## How it was made

**The model and settings.** DreamShaper XL 1.0 fp16, with the fp16-fix VAE, on the
GTX 1080:

- the sampler is DPM++ 2M Karras;
- every GPU process ran under `flock ~/scenery-packs/logs/gpu.lock nice -n 15`;
- `HF_HUB_OFFLINE=1`, so nothing was downloaded.

**The GPU budget.** 31 images over seven runs, about **31 minutes of GPU time**
(about 1900 s, model loads included), finished at 20:49. Two of the runs were stopped
early on purpose (below).

**Base or DreamShaper.** One seed of each was run on the green woman (top row of
`COMPOSITION-SEEDS.jpg`).

- *SDXL base* painted a lovely bust and dropped the table, the lamp and the cards.
  Its prompt was cut at CLIP's 77 tokens, which also cost it the table and the lamp
  words. That is noted, and was fixed for the DreamShaper runs.
- *DreamShaper* placed a seated figure at a table with a light in front of her. It
  was used for everything after.

**The steps.**

1. **The composition pass** (`tools/prior.py`, `specs/r4.json`).
   - *A blurred colour prior.* It is not a template. It is a soft layout of where
     things go:
     - a figure-sized mass in the character's colours;
     - a pale head near the top;
     - a dark hand of cards at mid-height;
     - a table band along the bottom;
     - the lamp's glow centred on the bottom edge, which is the seam.
   - *The pass itself.* The prior is repainted at **strength 0.78** with the
     character's prompt: 1216 × 848, 18 steps, cfg 6, four seeds per character.
     Those are the 12 images in rows 2–4 of the sheet.
   - *Why 0.78.* At 0.90 the model ignored the layout: no table, no lamp. At 0.80,
     on a prior without drawn cards, it made the table and lamp but hid the hands.
     So the prior gained cards, forearms and hands, and the strength came down
     to 0.78.
2. **The choice.** Each seed was judged on four things:
   - the face's state;
   - the figure filling the half;
   - visible hands;
   - **a light that sits on the bottom edge at the centre**. The seam needs that,
     and most seeds put the lamp up on the table instead.

   The choices:
   - *Garnet 314 and blue 321.* Each has its candle on the bottom edge, centred,
     and both were used whole.
   - *Green 303.* It has the best face of the four green seeds. Its globe lamp
     stands up on the table, so the half is cropped to the rows above the lamp's
     foot (0–772, centred on the lamp, about 1.36× up).
3. **The hand of cards** (`tools/cards.py`).
   - *Why the cards are drawn.* The model will not paint a held hand of plain
     cards: it either drops them or paints pips and court cards, which all three
     chosen seeds had. So the cards are drawn into the painting:
     - 6–7 large cards, about 290 × 410 px at 1500 wide, held as a hand;
     - fanned 46–58° from a grip, each nudged a little;
     - plain dark backs with a thin gilt edge;
     - shaded lighter toward the grip, because the lamp is below.
   - *The painting's own hands stay on top.* They are laid back over the cards by a
     skin mask. The model's card faces were painted out first (`--erase`).
   - *The garnet man's gilt stick.* He was holding a gilt stick that the skin test
     took for a finger, so that patch is excluded (`--nokeep`).
4. **The repairs** (`tools/refine.py`, `specs/r3.json` and `r5b.json`).
   - *The faces.* Each face is cropped at about 3.3× (1024 px) and repainted at
     0.48, two seeds each, with the character's expression in the prompt. The
     better seed was kept: green 502, garnet 511 and blue 522. Blue 522 was then
     nudged sideways and repainted (531), as described under the blue man.
   - *The hands and cards.* They are repainted at about 2× and 0.50. This step
     paints the grip around the drawn cards and brings them into the picture's
     light. The garnet hands were repainted a second time (seed 612) after the
     gilt-stick fix.
   - *Pasting back.* Each repaint goes back with a feathered edge: an ellipse for
     the face, a rectangle for the hands.
5. **The unifying pass** (`specs/r6.json`). The whole half is repainted at
   **0.22**, 1216 × 848. Then the face and the hands are taken back from the
   pre-unify half (`tools/build.sh`), because the pass softens them.
6. **The finish** (`tools/compose3.py`, run by `tools/build.sh <green|garnet|blue>`).
   - *The half.* It is resized to 1500 × 1050, so its bottom edge is the seam.
   - *The lamp.* The bottom band is shifted sideways so the lamp's centre is
     x = 750. Inside a disc round the seam's centre, the half is blended to its own
     left–right mirror, so the lamp continues into itself when turned.
   - *The seam.* The last 28 rows ease to their left–right average.
   - *The border.* It is 50 px in the character's darkened colour, bleeding to the
     cut, with a fine gilt fillet on its inner edge.
   - *Print.* Chroma above 140 is compressed toward grey. The shadows are lifted
     until the darkest 0.5 mm area is at least 22.
   - *The bottom half.* It is the top half turned 180°, and the symmetry is asserted
     to the last pixel.
7. **The lamp's heart.** A candle flame cut by the seam turns, mirrored, into a
   double-ended flame or an X.
   - *The garnet man.* His flame is melted into its own glow (`--soften`), with a
     round warm bloom on the seam (`--core`).
   - *The blue man.* His tall flame was still an X after that, so it is taken off
     the table (`tools/deflame.py`, which refills the strip from the wood either
     side). His lamp is the bloom alone.
   - *The green woman.* She needs neither, because her lamp's foot sits on the
     seam.
8. **Unchanged from round 1:** the GPU wrapper `tools/paint.py`. Round 3 added
   text-to-image jobs to it, though the composition pass in the end used
   img2img over the prior.

## The checks (measured on the finals)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| 180° symmetry, max pixel difference | **0** | **0** | **0** |
| Darkest 0.5 mm area, before → after the lift | 21.7 → 22.6 | 15.8 → 22.6 | 18.9 → 22.6 |
| Darkest 0.5 mm areas, 0.5th percentile | 26.0 | 27.1 | 23.6 |
| Darkest single pixel (too small to print as an area) | 14 | 13 | 15 |
| Saturation × value, 99.5th percentile (round 2 was 148) | 110 | 136 | 109 |
| Border | 50 px | 50 px | 50 px |
| Top of the head, from the cut (approx.) | ~75 px (hair) | ~105 px (cap) | ~87 px (hair) |

**The margin.** The faces, the cards, the hands and the lamp are all well inside
the 110 px margin. **The tops of the three heads are not:** the green woman's
hair, the blue man's hair and the very top of the garnet man's cap reach into the
margin, by about 35, 23 and 5 px. A cut there would trim hair, not face. That is
the price of the figure filling the half. It is the first thing to fix if the owner
wants it (below).

## Tried and dropped

- **SDXL base** (one seed): no table, no cards, no lamp.
- **Strength 0.90**: a painting that ignores the layout.
- **Strength 0.80 without drawn cards in the prior**: table and lamp, but the hands
  hidden and no cards. Two seeds were run, then the run was stopped.
- **The other composition seeds**:
  - green 301, 302 and 304: lamps standing mid-table, and 302 broke into flat
    panels;
  - garnet 311–313: lamps or candles well above the seam, and table clutter with
    painted card faces;
  - blue 322–324: lamps standing on the table, framed portraits on the wall, and
    painted court cards.
- **The first lamp bloom** (radius 40) on the blue and garnet men: the mirrored
  flame still showed as an X. That led to `--soften` and, for the blue man,
  `deflame.py`.

## Not done, or worth knowing

- **The green woman's lamp is not cut through its middle.** Her globe lamp stood
  on the table in the only good green seed. So the half is cut at the lamp's foot,
  and turned, it reads as one double-ended lamp, two globes on a shared base.
  - *The other two.* They have a light centred on the seam as the brief asked.
  - *The cost of her crop.* It loses most of her table: only a strip of wood with
    her lamp's base remains.
  - *The fix.* Another few green seeds with the prior's glow lower, or a lamp
    repainted on the seam.
- **The blue man's lamp is a bloom, not an object.** His painted candle had to come
  off to stop the X. What is left is a soft warm light on the wood with no brass
  under it.
  - *Why this one is not a ball on a plank.* It is not a drawn sphere, and the table
    under it is the painting's own.
  - *Still, it is the weakest lamp of the three.* A seed with a globe lamp on the
    seam is the real fix.
- **The blue man's sidelong look is a nudge.** It comes from a code nudge and a
  0.34 repaint, not from the prompt (see *The three people*). It is clear at 3× and
  subtle at sleeve size.
- **The green woman's smile** is slight. It reads as composed more than pleased.
- **Things in the background.**
  - *The green woman.* A framed painting sits at the top left (bottom right when
    turned).
  - *The blue man.* A wall sconce sits at the top left.
  - *The garnet man.* A small brass candlestick stands beside his candle near the
    seam, and its twin shows when turned. It does not cross the seam.
- **Remnants under the blue man's hands.** A small gilt patch is left from the
  model's painted court cards, below his right hand.
- **The faint seam line.** A thin, lighter line is faintly visible along the seam
  on the blue man's table at 1:1. It is not visible at sleeve size.
- **No gold ground.** The model painted warm interiors (gilded hangings, panelled
  walls) rather than punched gold leaf. The brief allowed gold behind, but did not
  require it. Punched gold behind the figure would mean a mask and a re-ground,
  which is the compositing this round set out to stop.
- **The Sleeve Crafter's crop and colour conversion** are still unconfirmed (round
  1's *What remains to confirm*).
