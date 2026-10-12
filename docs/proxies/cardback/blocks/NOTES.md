# Tumbling Blocks: the production backs

*Written 2026-10-12. These are the owner's chosen concept (concept 2 in
[`../PROXY-BACK-DIRECTION.md`](../PROXY-BACK-DIRECTION.md)), made in three
colourways that alternate through the deck. The green colourway is the
reference.*

**The backs carry no words.** There are no letters, numbers or marks of any kind.
The labels on the review sheets are on the sheets only.

| File | What it is |
|---|---|
| `tumbling-blocks-green.png`, `-blue.png`, `-garnet.png` | The finals: 1632×2220, 600 dpi, RGB, bleed to the edge |
| `EMBLEM-OPTIONS.jpg` | The earlier emblem (D) next to the chosen plate, each as a 1:1 crop at 600 dpi with a thumbnail |
| `CONTACT-SHEET.jpg` | The three finals side by side, and below them a hand of seven alternating backs |
| `FANNED-HAND.jpg` | That hand at a larger size |
| `CUT-SAFE.jpg` | The three finals with the cut line (red, 75 px in) and the safe line (blue, 135 px in) |
| `tools/` | The generator. `params.json` holds every number, `check.json` the measurements, and `edge-overlay.png` the congruence picture |

## The geometry, and why

**One lattice, drawn in code, with no model involved.** Every edge is computed
analytically from three numbers (`tools/lattice.py`):

- **Rhombus edge S = 114 px (4.83 mm).** A cube is 197.45 px across (8.36 mm), and
  a row of cubes is 171 px tall. This is the green candidate's cube size (113.8 px
  after its upscale), rounded to a whole pixel. It gives 8.27 cubes across the
  bleed and 7.5 across the cut card, with 13 rows down the bleed and 12.1 down
  the cut card.
- **The card centre (816, 1110) is a degree-6 vertex of the tiling,** the bottom
  corner of the cube above it. This choice is forced, not taken from taste.
  Turned 180°, a rhombus keeps its orientation and therefore its shade, so the
  shaded tiling maps onto itself about any degree-6 vertex or rhombus centre. It
  does not do so about a cube's centre: there the illusion flips, and a cube seen
  from above becomes one seen from below. So the 180° symmetry the back needs
  (the card must look the same from both seats) puts the centre on a vertex.
- **The emblem is a gold plate laid over the lattice** (the owner's choice, made
  in a hand-tuning session on 2026-10-12; details below). The plate is centred
  on O, and the cubes inside it are the same lattice, so they line up with the
  cubes outside.
- **The brass frame lies on lattice lines as well.** Its thick line runs at
  x = 816 ± 3 cube widths (223.6 px from the bleed edge), along the vertical
  joints. It also runs at y = 1110 ± 5 rows (255 px), along the long diagonals of
  a row of pale rhombi. Its corners land on the centres of pale rhombi. The thin
  line sits 22 px inside it. The frame is 149 px inside the cut on the sides and
  180 px at the top and bottom, which puts it 89 and 120 px inside the safe line.
  The cut can wander about 1 mm (24 px), so the frame's margin varies by about
  15%, not the roughly 30% it would vary near the safe line. A border that
  stopped at the cut line would show every wander, so there isn't one: the
  pattern runs out through the bleed.

## The emblem: the plate

The owner wanted the plate from the original candidate
(`direction/tumbling-blocks-1.png`), not a cluster of gilded lattice cubes. They
also wanted the cubes inside it aligned with the cubes outside, and the cube
corners touching the rim. The coordinator tuned it with the owner and passed it
on as reference code. It is ported into `tools/render.py` as treatment `plate`,
which is the default in `params.json`.

**The plate:**

- **Shape:** a flat-top regular hexagon (points left and right) centred on O.
- **Size:** its outer apothem is 2S + rim + joint tip = 228 + 14 + 3.4641 =
  **245.464 px**, a circumradius of 283.4 px (24.0 mm point to point).
- **Joint tip:** a joint has a half-width of 3.0 px. Where two joints meet at a
  120° corner, the dark tip reaches 3.0 / sin 60° = 3.464 px past the corner.
- **Why this size:** the central column's top cube corner sits 2S above O, and by
  symmetry five more corners sit 2S from O. Each of those corners' dark joint
  tip then touches the rim's inner edge exactly: the gap is 0.000 px, recorded in
  `check.json`. The owner checked this at 5×: touching, not inside, no gap.

**Inside the plate:**

- **The lattice:** the same lattice, aligned, at the same scale and with no shift.
- **Golds:** three golds sampled from the original candidate's plate by k-means,
  frozen in `PARAMS`. Light (190, 156, 91) is on the top face, mid (143, 113, 61)
  on the left and dark (115, 81, 42) on the right.
- **Grain:** a faint symmetric mottle at 0.04 amplitude.
- **Joints:** dark, half-width 3.0 px, darkening by 0.7.

**The rim:**

- A 14 px band in light × 1.05, bevelled by
  1 + 0.14·(1−t)² − 0.08·t² (t = 0 at the outer edge, 1 at the inner).
- A 2 px dark line on the plate's outer edge (darkening by 0.7).
- **No line on the rim's inner edge,** because that line is what made the
  corners look swallowed.
- A soft shadow on the wood outside: 0.16 · exp(−d/18).

**What stays as it was:** the brass-strung star of 30 rhombi around it, on the
sheets the owner chose from (`plate.halo`), and the brass frame.

**Same on all three backs:** the plate's golds are identical on all three; only
the wood's hue changes.

**The port against the reference build:** I compared it with the coordinator's
`build()` for variant K1. The interior and the rim match to ±1 in 8-bit. The only
difference is that the port antialiases the plate's edge and the rim's inner
edge where the reference used hard pixel masks. The positions are the same, and
the edge just loses its staircase.

The earlier pick, D, is beside the plate in `EMBLEM-OPTIONS.jpg`. D was 12
lattice rhombi gilded in place: the one regular hexagon whose sides are joints,
side 2S. It sat inside the star of 30 rhombi drawn in brass. The earlier options
A–C (solid hexagon, brass outline, gold hexagram) are still in `render.py`
(`solid`, `outline`, `raised`, `haloed`).

## Colour: one lightness map, three hues

Every face is set in OKLab. **The lightness of every pixel is computed once and
shared by all three colourways.** That covers the grain, the joints, the brass,
the gold, the per-piece tone and tilt, the chamfer and the shadow. A colourway
only sets the hue and chroma of the mid face. The pale holly, the ebony and the
plate are the same in all three. The plate is laid over in sRGB like the
reference, so its edge line and shadow multiply the wood beneath.

| Face | OKLCh (L, C, h) | Mean sRGB on the final |
|---|---|---|
| light (holly) | 0.770, 0.047, 83 | 191, 173, 142 |
| mid, green (reference) | 0.440, 0.024, 175 | 69, 87, 81 |
| mid, blue | 0.440, 0.034, 260 | 72, 83, 101 |
| mid, garnet | 0.440, 0.064, 30 | 113, 69, 61 |
| dark (ebony) | 0.255, 0.012, 62 | 39, 34, 29 |
| plate gold top / left / right | sRGB, from the candidate | 189,155,90 / 144,114,62 / 116,81,42 |

The green's mid face is the measured median of `direction/tumbling-blocks-1.png`
(L 0.439, C 0.020, h 173). The holly and the ebony match that candidate too.
Chroma is tuned per hue so that each colour reads as itself at the same
lightness: at the green's chroma, the garnet came out as dusty rose. So the
three backs share every face's lightness, and at a distance they read as the
same object.

## Texture: procedural, not the model

The wood is a seeded procedural shader (`tools/wood.py`). It builds each veneer
from growth lines that are thin, crisp, unevenly spaced and unevenly dark, with
short fibres between them and a broad figure. Each rhombus is cut from its own
seeded place in the "log", with a slight tone and tilt. The holly's grain runs
across, and the side faces lean the way the green candidate's did. The brass is
fine brushing with a mottle. Features are 3 px and up, so nothing is hairline
noise. The joints are a 3.4 px glue line that wanders about 0.7 px. Each rhombus
and its 180° twin sample the same patch turned round, so the texture is exactly
symmetric too.

**GPU:** I queued one SDXL pass (DreamShaper XL, img2img at strength 0.22 and
0.30 over the green render) as a possible texture source. It waited for the
shared lock while the other lane painted, got it at 16:14 and loaded. By then
the procedural wood held up at full size next to the candidate, so I stopped
that pass before it produced an image. It used about 6 minutes of lock time and
none of its output is in the finals.

Shipping without it has two benefits. The three backs regenerate bit for bit
(re-running `render.py` reproduces the same sha256s). And the lattice cannot
move, because nothing upscales or repaints it. If the owner wants the
photographic "wood feel" of the model's candidates, the path is the one in the
brief: a low-strength pass whose high-pass detail is taken only inside each
piece, away from the joints, and added to the shared lightness map.

## Checks (`tools/check.py`, results in `tools/check.json`)

- **Size and dpi:** each final is 1632×2220 at 600 dpi.
- **180° symmetry:** each final equals its own 180° rotation exactly, with a
  maximum difference of 0. The renderer already produces this before
  `symmetrise()` enforces it: 0 there too.
- **The plate:** the outer apothem is 245.4641 px and the rim's inner edge is at
  231.4641 px. The cube corners sit at 228 px and their joint tips at
  231.4641 px, so the gap from tip to rim is 0.000 px.
- **Congruence (lightness):** across each pair of finals, OKLab L differs by at
  most 0.0037 (green–blue), 0.0044 (green–garnet) and 0.0037 (blue–garnet), with
  a mean of about 0.00025. That is within about one 8-bit step. The plate's
  sRGB-multiplied shadow and edge line over different hues add the last few
  thousandths.
- **Congruence (edge maps):** Canny edges on L, after a 2 px blur. Within 4.5 px
  of a lattice edge, each final has about 121,300 edge pixels.
  - Green vs blue: 36 pixels have no partner within 1 px.
  - Green vs garnet: 32.
  - Blue vs garnet: 10.

  That is under 0.03%, which is rounding flicker. Exact-pixel XOR is 2.0–2.4%,
  from the same flicker. Of each final's structural edges, 82% lie on the
  lattice; the rest are the plate's rim and the strongest grain lines. In
  `tools/edge-overlay.png`, white is where all three agree.
- **Print:**
  - **Holly:** the pale faces (measured away from the plate) have a 99.5th
    percentile of (221, 202, 167) and a maximum of 228.
  - **Dark areas:** the darkest 0.5% of luminance, blurred to about 0.5 mm, is
    26.4, and the 5th percentile is 33.3. The darkest single pixel is 4. It sits
    on the plate's 2 px edge line over the shaded ebony, where the line darkens
    by 0.7 as specified. That is a hairline, not a large area.
  - **The plate's golds** are mid-toned ochre brass.
  - **No neon:** saturation × value has a 99.5th percentile of 101/255.

## Print notes

- The art bleeds to all four edges. Nothing that matters sits outside the safe
  line: the plate (567 px point to point) is in the middle and the frame is 89 px or more inside.
- The holly is the brightest large area and will show grime first. It is held
  to a mean of about 191 and capped at L 0.855. The owner has accepted that.
- The joints (3.4 px), the brass stringing (6 px) and the frame lines (8 px and
  4 px) all print as lines of at least 1.5 px at MPC's effective 300 dpi.
- Alternation: print the deck with the three files in rotation (green, blue,
  garnet, ...). The cube size, grid origin, plate and frame are identical, so a
  hand switches colour and nothing else.

## Regenerate

From `docs/proxies/cardback/blocks/tools/`, with the venv at
`/home/justin-a/scenery-packs/.venv-gen` (numpy, Pillow, OpenCV; no GPU):

```bash
PY=/home/justin-a/scenery-packs/.venv-gen/bin/python
$PY render.py finals        # the three PNGs, and params.json
$PY check.py                # check.json and edge-overlay.png
$PY sheets.py options       # EMBLEM-OPTIONS.jpg
$PY sheets.py contact       # CONTACT-SHEET.jpg, FANNED-HAND.jpg, CUT-SAFE.jpg
```

The parameters live in `lattice.py` (canvas, S, centre, clusters) and in
`render.py`'s `PARAMS` (colours, grain, joints, the plate, the frame, seeds).
`render.py options <dir> hex2:haloed hex2:plate ...` renders any emblem for
comparison.
