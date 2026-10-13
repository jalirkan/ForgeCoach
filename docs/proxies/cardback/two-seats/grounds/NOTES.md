# The Two Seats, grounds: two alternative grounds for the final

*Written 2026-10-13. A mock of two other grounds for the Dragon Shield brushed-matte
sleeve, where flat metallic gold prints as mustard and texture and deep, mid-saturation
colour print well. The finals in `../final/` are untouched; this folder only lays their
figures on other grounds. No model and no GPU: everything here is compositing in code.*

All six are 1500 × 2100 px at 600 dpi, exact 180° symmetry (asserted), no words, and
everything that matters is inside the 110 px margin (the figures, band, lamp and props
are where the final has them; the new rule is at 112–124 px, the tooled line in B at
137–141 px).

## What is here

| File | What it is |
|---|---|
| `A-green.png`, `A-garnet.png`, `A-blue.png` | **Ground A**: the first drafts' streaky worked leaf, with the drafts' plain moulding |
| `B-green.png`, `B-garnet.png`, `B-blue.png` | **Ground B**: dark tooled damask in each figure's own colour, with the same plain moulding |
| `GROUNDS-COMPARE.jpg` | Three rows: the current punched gold (the final), A, B; one column per character, 900 × 1260 each |
| `GROUNDS-SLEEVE-SIZE.jpg` | A and B at print size (744 × 1039 = 63.5 × 88.9 mm at 297.6 px per inch), with a 10 mm bar |
| `tools/` | `ground6.py`, `lift.py`, `grounds.py`, `sheets.py` (below) |

These are mocks for choosing a ground, so they are PNG only. No upload JPEGs were made.
If one is chosen, its JPEG is made the same way as the final's (quality 95, 4:4:4, 600 dpi).

## How the figures were lifted

The figures, hands, fan, band, lamp and props are **the final's own pixels**. Nothing
was repainted.

1. **The bare ground under the figure, rebuilt exactly** (`tools/ground6.py`). The
   final's gold field is round 6's, and rounds 7–9 and the final keep it unchanged (their
   checks say so). Round 6 made it by refilling round 2's punched half where round 2's
   figure stood, cell by cell through the measured diamond lattice
   (`round6/tools/assemble6.py`, step 1). `ground6.py` is that step, unchanged in what it
   computes, run again on the same inputs (round 2's `out/<c>-punched.png` and round 5's
   `hole-<c>.png`). Away from the figure it matches the final to a **mean of 0.24
   levels** (99.9th percentile 7). So for every pixel of the figure, the gold that was
   under it is known.
2. **The matte** (`tools/lift.py`). This is a straight alpha matte.
   - **The core.** It is every pixel where the final differs from the bare ground by more
     than 12, above the table's moulding (y < 944), opened, with only the largest piece
     kept and its holes filled. The faces and the cards' gilt edges are gold-coloured, so
     the filled silhouette decides inside the figure, not the difference.
   - **The edge.** The edge runs from 2 px inside the core to 5 px outside. There the
     final's 3 px feather is unmixed. F is the figure's colour pushed outward from its
     eroded core, and alpha = (C − B)·(F − B) / |F − B|². That takes the gold's share
     out of every edge pixel.
   - **Laying it on a new ground.** A new ground G goes under as P + (1 − alpha)·G, where
     P = C − (1 − alpha)·B. This is the exact inverse of how the final was laid, so **no
     gold fringe survives on the dark grounds**.
3. **The gold blots.** When the final's retouch lifted the drawn outline, it filled the
   gap from the pixels beside it, and at the shoulder points that was gold. This left
   small blots of gold that differ from the bare ground (1,900–2,800 px per figure,
   mostly a 1 px rim). They are taken back to ground: gold-coloured pixels of the ground's
   own hue (within 0.993 cosine) that touch the outside through other gold pixels. The
   cards' gilt edges and the faces are enclosed, so they stay.
4. **The hem.** Rows 936–943 keep the figure's columns from row 935, so no ground line
   opens between the cloak and the moulding.
5. **The band.** The band is rows 944 to the seam, between its end fillets at
   x 194–1305: the moulding, the wood, the lamp and its glow, and the props, all the
   final's pixels. It runs out to the new rule. From 8 px in, its wood is carried outward
   80 px (the grain runs along the band, so a shifted copy continues it). That is
   cross-faded over 20 px, because the last few columns carry round 2's painted end
   (a dark edge and the floral band's fillet).

**Checked on the outputs.** Every figure pixel with alpha = 1 is **identical to the
final** (100.0000% in all six). The band's wood columns are 95.2% identical; the rest is
the 28 px cross-fade at each end. All six images are exactly 180° symmetric.

## The shared frame: the drafts' plain moulding

Round 2's floral border and its gold mat are gone. In their place is the drafts' simple
gilt frame, at the drafts' proportions: the drafts' bevel is 122 of 1632 px, which is
112 at 1500.

- **The bevel (0–112 px)** is the draft's own streaky gold. It is mitred, the top and
  bottom 4% lighter and the sides 6% darker, with a soft rounded profile (0.86 at the
  edge to 1.06 near the middle) and a thin darker mitre line.
- **The dark rule (112–124 px)** is a near-black of the figure's own hue: green
  (30, 46, 40), garnet (56, 30, 31) or blue (30, 35, 56). The drafts' rule is near-black
  too.
- **A narrow light fillet (124–127 px)** sits inside the rule.
- **The table band** now runs under the rule, as the drafts' band ran into its frame.

The field reaches the rule, so it is 73 px wider each side than the punched field was.

**The symmetry trick.** The bottom seat is the top half turned 180°, so a texture would
normally break where the left and right mouldings cross the seam (the band hides the seam
everywhere else). To avoid that, the gold is generated **full height** (2100 rows). The
right-hand moulding of the top half takes the bottom of that texture, turned round, with
the switch hidden inside the dark rule and the mitre line. So the side mouldings run
unbroken through the seam.

## Ground A: the streaky worked leaf the drafts started with

`tools/grounds.py`.

- **The source.** Each figure gets **its own draft's gold**: the green woman
  `direction/two-seats-1.png`, the garnet man `-2`, the blue man `-3`. That keeps each
  draft's undertone: teal flecks under the green, grey-red under the garnet, blue-grey
  under the blue.
- **The samples.** They are the clean strips beside the figure: x 150–440 and 1192–1482,
  y 150–950. Draft 2 instead uses x 150–425 and 1180–1470, y 150–850, clear of its
  inner rules at 432–448 and 1147–1164. Every strip was checked for rules by column
  means. The strips are scaled to sleeve pixels (1500/1632).
- **The re-tiling.** This is round 2's `streaky.py` method. Vertical strips 50–110 px
  wide are taken from random places, each stacked from 480-row runs blended over 80 rows,
  with neighbouring strips blended over 16 columns. No mirror or tile repeat shows, and
  the seed is fixed (7101/7102/7103).
- **Its colour.** The texture's fine detail (the texture over its own 40 px blur, at 0.85
  strength) is laid on the draft's mean gold.
  - *Less saturated.* The mean gold is desaturated to 0.80, then the whole field to 0.92.
  - *Darker.* It is set to a mean HSV value of 160, against the drafts' 164.
  - *The light.* There is one light over it: the lamp's glow (+30% at the lamp, a 355 px
    gaussian, fitted to the glow on round 2's punched gold, which rises from ~120 to
    ~160 just above the band) and a soft 5–7% vignette.
  - *The knee.* A soft knee from 200 keeps every channel at or below 225.

| Ground A, the field (visible ground only) | Green | Garnet | Blue |
|---|---|---|---|
| Mean luminance (Rec. 709) | 129.7 | 131.6 | 133.3 |
| Mean HSV value (the brightest channel) | 160.0 | 160.0 | 160.0 |
| Brightest channel, max / 99.5th percentile | 223 / 202 | 219 / 197 | 224 / 211 |
| Brightest luminance in the field | 215.6 | 186.0 | 213.8 |
| Saturation × value, 99.5th percentile | 141 | 131 | 135 |
| Darkest 0.5 mm area on the ground (the rule) | 42.6 | 36.0 | 35.9 |
| Darkest 0.5 mm area on the whole card (in the hood) | 25.9 | 26.6 | 25.0 |
| The faces, 99th percentile luminance | 211.0 | 181.8 | 214.3 |
| The drafts' own gold, for comparison: luminance / HSV value | 126 / 164 | 120 / 151 | 121 / 154 |

**A note on "mean 150–170 luminance".** In Rec. 709 luminance, the drafts' gold is
118–126. A ground at 150–170 by that measure would be *lighter* than the drafts and
about as light as the faces, which goes against the brief's *a touch darker* and *the
faces and the lamp brightest*. So the target was read as the brightest channel (HSV
value), where the drafts sit at 151–164. A is 160 by that measure (Rec. 709 130–133),
and no channel is above 225 anywhere on any card.

The faces and the lamp stay the brightest things. The lamp's core is near 255 and the
faces reach 211–214 for the green woman and blue man. The garnet man is shadowed, at
182; his field's single brightest gold pixel is 186, but the field's 99.5th percentile
is well below his face.

## Ground B: dark tooled damask per colour

`tools/grounds.py`.

- **The ground.** It is the brief's deep colour: forest green #1d3b2c, oxblood #4a1418,
  midnight blue #14213f.
- **The lattice.** It carries **round 2's own punched diamond lattice** as a lighter tone
  of the same hue: the lines +10 luminance, the four-petal punches at the crossings +14.
  The lattice is the crossing mesh `ground6.py` measured (95.75 px period, 53 crossings
  measured, the rest interpolated), so the diamonds sit where the punched gold's did,
  extended by its affine fit to the wider field.
- **No flat patches.** A seeded paper grain (fine σ 0.7 px and mid σ 3 px, about 2 levels
  each) and a 3% mottle (σ 80 px) cover the field. They are built in the top half, so the
  grain is symmetric too.
- **The light.** The same lamp glow (×1.30 plus a little warm light) and the same
  vignette as A.
- **The tooled-gold inner line.** It runs 137–141 px in: 4 px of the frame's gold,
  punched dark every 9 px. Together with the light fillet inside the rule, it reads as a
  double gilt line.

| Ground B, the field (visible ground only) | Green | Garnet | Blue |
|---|---|---|---|
| Mean luminance (Rec. 709) | 52.4 | 35.0 | 35.0 |
| Mean HSV value | 60.0 | 79.0 | 65.8 |
| Brightest channel in the field (the tooled line) | 206 | 192 | 202 |
| Darkest 0.5 mm area on the ground (≥ 24 required) | **42.3** | **25.6** | **26.3** |
| Darkest 0.5 mm areas on the ground, 0.5th percentile | 44.5 | 27.6 | 28.2 |
| Darkest 0.5 mm area on the whole card | 25.9 | 25.6 | 25.0 |
| Saturation × value, 99.5th percentile | 98 | 95 | 82 |

### The halo: every cloak needed one, not only the green

Measured edge contrast is the cloak's ring 3–8 px inside the edge against the ground's
ring 8–20 px outside, as CIELAB ΔE:

| | Cloak edge L* | Ground L*, no halo | ΔE, no halo | Halo used | ΔE with it |
|---|---|---|---|---|---|
| Green woman | 28.6 | 23.4 | 10.2 | +3 levels (the brief's 1–2%) | 9.6 |
| Garnet man | 19.5 | 16.9 | **5.2** (the cloak almost vanishes) | **+14** | 9.8 |
| Blue man | 17.8 | 14.4 | 11.8 | +8 | 14.3 |

- **The green cloak keeps its edge on its own.** It is teal on a forest green, so the
  hue carries it. It has only the brief's faint halo.
- **The garnet man was the real problem.** His red cloak and the oxblood are nearly the
  same colour. A 1–2% halo does nothing for him, so his halo is +14 luminance levels at
  the edge, falling off over ~40 px.
- **The blue man** is in between, at +8.

A lighter halo only helps once it is lighter than the cloak. All three cloaks are a
little *lighter* than their grounds, so a small halo first *reduces* the contrast: the green's +3 takes its ΔE from 10.2 to 9.6, which is harmless but no help.

The other way round was also tried: a darker surround (−10). It separates all three just
as well (ΔE 13 / 10 / 10) and reads cleaner on the garnet. It was not used because the
brief asked for a lighter halo. It is one flag (`--halo -10`) if wanted.

## Matte reasoning, in short

- **No flat metallic gold anywhere.** A's field and both frames are the drafts' streaky
  leaf, a busy painted texture with ±30% detail, which prints as worked ochre rather
  than as a flat mustard plate. Every channel stays at or below 225, so nothing relies
  on a highlight a matte sleeve cannot show.
- **B is deep mid-saturation colour with texture.** There is no large flat area anywhere
  (the lattice, the grain and the mottle), and the darkest 0.5 mm area on any ground is
  25.6 or above, so no dark ground fills in.
- **The darkest areas on every card** (25.0–26.6) are in the hoods, the final's own
  pixels after its black-point lift.
- **The faces and the lamp stay the brightest things** on all six.

## Not done, or worth knowing

- **The figures are the final's pixels**, including the chests' known softness, which
  is a separate job.
- **The cut is not perfect everywhere.** The re-lay check (alpha·F + (1 − alpha)·B
  against the final, on the edge) has a median error of 4–7 levels, because F is a
  smooth estimate of the cloth. At 2× no gold rim and no dark ring show on A or B. A
  faint residue of the old feather can show where the final's cloak edge was itself soft
  and dark.
- **A's three grounds differ**, because each takes its own draft's gold. The garnet and
  blue drafts' gold is greyer and paler-flecked than the green's. Using draft 1's gold
  for all three would make A uniform.
- **The band's ends are new.** The wood runs 70 px further each side to meet the rule,
  where round 2's floral band used to stop it.
- **The Sleeve Crafter's crop and colour conversion are still unconfirmed**, as in every
  round.

## Reproduce

Under `/home/justin-a/scenery-packs/.venv/bin/python`, with the work folder
`/home/justin-a/scenery-packs/two-seats-work/grounds`:

1. From `two-seats-work/round6`:
   `<tools>/ground6.py ../round2 <c> ../round5/comp/hole-<c>.png ../grounds <c>`
2. From `two-seats-work/grounds`:
   `<tools>/lift.py <c> <repo>/final/two-seats-<name>.png .`
3. `<tools>/grounds.py <c> . <repo>/../direction/two-seats-<1|2|3>.png <repo>/grounds --halo <3|14|8>`
4. `<tools>/sheets.py <repo>/grounds <repo>/final`

Re-running steps 1–3 from scratch reproduced all six PNGs byte for byte (md5 checked).
