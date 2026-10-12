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
| `EMBLEM-OPTIONS.jpg` | Four treatments of the gold emblem, side by side, with the one I chose (D) |
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
- **The gold hexagon is the lattice's own hexagon.** Along any lattice line, the
  edges run straight for at most 2S before the line crosses a rhombus. So exactly
  one regular hexagon in the pattern has all six sides lying on lattice edges:
  the hexagon of side 2S centred on that vertex. It is 395 × 456 px (16.7 ×
  19.3 mm) and holds 12 whole rhombi, which read as three cubes stacked in a
  corner. That hexagon is the emblem. Its outline is the joints between pieces,
  so it "overlays the cubes" exactly, because it is made of them.
- **No cluster of whole cubes can be 180° symmetric.** Turning the card swaps
  every cube for an inverted one. So every emblem option is a union of whole
  rhombi, chosen by testing each rhombus centre against a centrally symmetric
  region. `check.py` confirms that each one maps onto itself.
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

## The emblem: four options, and my pick

All four options are in `EMBLEM-OPTIONS.jpg`, each shown as a full card and as a
centre zoom (green). All four sit on the same lattice.

- **A. Solid gold hexagon.** The 12-rhombus hexagon, inlaid flat in brushed
  brass, keeping the three tones of the cubes (light, mid and dark gold). It is
  clean and exact, and the smallest of the four.
- **B. Brass outline, wood kept.** The same hexagon with brass stringing in
  every joint, and the woods left as they are. It is delicate, and from across
  the table it reads as a thin gold line, not as a gold emblem.
- **C. Gold hexagram, raised.** A bigger cluster of 30 rhombi (every rhombus
  within 3S of the centre), which makes a six-pointed star of cubes, bevelled.
  It is bold, but it reads as a star rather than the hexagon the owner asked for.
- **D. Raised hexagon in a brass star (chosen).** Hexagon A, slightly raised,
  set inside the star of C, whose joints are drawn in brass stringing over the
  wood. The raise is a bright chamfer just inside every gold edge, a faint dome
  and a soft shadow on the wood around it. The shadow has no light direction,
  so the symmetry holds.

  This does what the owner described. The gold hexagon fits the cubes exactly,
  and the brass star carries it out over the neighbouring cubes ("multiple
  cubes"), still on lattice edges. That gives it the presence of the candidate's
  emblem without cutting through any piece.

  To switch to another option, set `cluster` and `treatment` in
  `tools/render.py` (`hex2`/`ring` with `solid`/`outline`/`raised`/`haloed`) and
  re-run it.

## Colour: one lightness map, three hues

Every face is set in OKLab. **The lightness of every pixel is computed once and
shared by all three colourways.** That covers the grain, the joints, the brass,
the gold, the per-piece tone and tilt, the chamfer and the shadow. A colourway
only sets the hue and chroma of the mid face. The pale holly, the ebony and the
gold are the same in all three.

| Face | OKLCh (L, C, h) | Mean sRGB on the final |
|---|---|---|
| light (holly) | 0.770, 0.047, 83 | 191, 173, 142 |
| mid, green (reference) | 0.440, 0.024, 175 | 69, 87, 81 |
| mid, blue | 0.440, 0.034, 260 | 72, 83, 101 |
| mid, garnet | 0.440, 0.064, 30 | 113, 69, 61 |
| dark (ebony) | 0.255, 0.012, 62 | 39, 34, 29 |
| gold top / left / right | 0.70 / 0.565 / 0.44 | 186,151,85 / 142,107,49 / 109,78,34 |

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
- **Congruence (lightness):** across each pair of finals, OKLab L differs by at
  most 0.0037 (mean 0.00026). That is under one 8-bit step (0.0039), so the
  differences are rounding only.
- **Congruence (edge maps):** Canny edges on L, after a 2 px blur. Within 4.5 px
  of a lattice edge, the three finals have about 120,700 edge pixels each.
  - Green vs blue: 29 pixels have no partner within 1 px.
  - Green vs garnet: 31.
  - Blue vs garnet: 13.

  That is under 0.03%: one-pixel Canny flicker from rounding. Exact-pixel XOR is
  about 2.4%, from the same flicker. Of each final's structural edges, 84.5% lie
  on the lattice; the rest are the strongest grain lines. In
  `tools/edge-overlay.png` (green's edges red, blue's green, garnet's blue),
  white is where all three agree.
- **Print:**
  - **Holly:** the pale faces have a 99.5th percentile of (221, 202, 167) and a
    single-pixel maximum of 228, so they stay under 235.
  - **Dark areas:** the darkest 0.5% of luminance, blurred to about 0.5 mm, is
    26.4, and the 5th percentile is 33. The darkest single pixel is 17, from a
    lightness floor of L 0.18. Nothing is pure black.
  - **Gold** is a mid-toned ochre brass.
  - **No neon:** saturation × value has a 99.5th percentile of 102/255.

## Print notes

- The art bleeds to all four edges. Nothing that matters sits outside the safe
  line: the emblem is in the middle and the frame is 89 px or more inside.
- The holly is the brightest large area and will show grime first. It is held
  to a mean of about 191 and capped at L 0.855. The owner has accepted that.
- The joints (3.4 px), the brass stringing (6 px) and the frame lines (8 px and
  4 px) all print as lines of at least 1.5 px at MPC's effective 300 dpi.
- Alternation: print the deck with the three files in rotation (green, blue,
  garnet, ...). The cube size, grid origin, emblem and frame are identical, so a
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
`render.py`'s `PARAMS` (colours, grain, joints, frame, seeds).
