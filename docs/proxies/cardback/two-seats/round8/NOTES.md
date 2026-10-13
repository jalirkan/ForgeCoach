# The Two Seats, round 8: one surface, and the deadpan details

*Written 2026-10-13. This is the sleeve art for the Dragon Shield standard sleeves:
1500 × 2100 px at 600 dpi, 5:7, exact 180° symmetry, with what matters inside a
110 px margin. Rounds 1 to 7 are untouched.*

## The brief

Justin approved round 7 as the direction (his words, and the rules they rest on,
are now in [`../../PROXY-BACK-DIRECTION.md`](../../PROXY-BACK-DIRECTION.md),
*The Two Seats — the direction*). Round 8 makes two changes and nothing else:

1. **One surface.** The painted hoods and faces and the drawn torsos read as two
   techniques. A faint, even paper grain goes over the drawn regions only, with
   a slight softening of the bold outlines, until a crop across the hem reads as
   one printed card. No model pass.
2. **Deadpan details.** Two or three small, period, flat-drawn props per sitter,
   on the table band's near edge in front of them, that quietly say who is
   winning and who is not. Each under about 90 px tall, drawn in code, in the
   same line style, symmetric by rotation like everything else.

Faces, hoods, the gold, the border and the lamp stay round 7's pixels.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | Final, the green woman |
| `two-seats-garnet-man.png` / `.jpg` | Final, the garnet man |
| `two-seats-blue-man.png` / `.jpg` | Final, the blue man |
| `CHARACTERS.jpg` | The three side by side, in round 6's layout |
| `ROUND7-VS-ROUND8.jpg` | Each round-7 final beside its round-8 version |
| `HEM-ZOOM.jpg` | The hem crossing, painted cape above and drawn torso below (x 440–840, y 500–720) at 2×; round 7 left, round 8 right |
| `PROPS-ZOOM.jpg` | The table band's near edge with the props (x 340–1160, y 896–1040) at 2× |
| `SLEEVE-SIZE.jpg` | True print size: 744 × 1039 each, with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `tools/` | This round's scripts |

The JPEG is the file to upload (quality 95, 4:4:4, tagged 600 dpi), as before.

## How it was made

Everything happens in the top half (1500 × 1050, the seam at y 1050) of round
7's final; the bottom seat is the top half turned 180°. One script,
`tools/round8.py`, does both changes and checks the result against round 7.

### Change 1: one surface

**Where.** The drawn regions only: round 7's drawn mask (`dm-<tag>`: the torso
below the hem, the arms, cuffs, hands and fan), less round 6's face ellipse and
every row from the moulding (y 944) down, plus the new props' bodies. Every
pixel outside that is round 7's, byte for byte.

**The softening.** A gaussian of **σ 0.75 px** over the drawn regions. The bold
outlines (3.2–4.2 px in round 7) lose their hard vector edge and come to about
the weight and edge of the first drafts' lines. It also takes out most of round
7's own fine grain, which was finer than anything in the painted parts.

**The paper tooth.** A seeded (8101) luminance noise, the same value added to R,
G and B, made of three gaussian-filtered noise fields mixed:

- 0.30 × the fine tooth (σ 0.6 px),
- 0.60 × the grain (σ 1.6 px),
- 0.75 × the paper's pull (σ 4.0 px),

each normalised to unit deviation, the mix renormalised and scaled to a
standard deviation of **2.6 levels** (about 1% of full scale; 95% of it inside
±2%). It is even: the same amplitude on every colour, light or dark. It is drawn
for the top half only, so the bottom seat has the same grain turned 180°.

**The aim, measured.** Band-pass luminance deviation (the median over 16 px
windows, on the flat parts of each region, edges excluded), in levels:

| | band | painted hood | drawn, round 7 | drawn, round 8 |
|---|---|---|---|---|
| Green woman | fine (0–1 px) | 1.36 | 1.85 | 1.20 |
| | mid (1–3 px) | 4.86 | 2.81 | 2.70 |
| | coarse (3–8 px) | 8.04 | 3.93 | 3.99 |
| Garnet man | fine | 0.74 | 1.19 | 0.90 |
| | mid | 1.72 | 1.60 | 1.72 |
| | coarse | 3.15 | 2.16 | 2.44 |
| Blue man | fine | 0.83 | 1.35 | 0.97 |
| | mid | 2.42 | 1.97 | 2.01 |
| | coarse | 4.53 | 2.76 | 2.94 |

Round 7's drawing was noisier than the painting at the finest scale and smoother
at the coarser ones; round 8 brings the fine scale down to the painting's and
adds texture at the scales where the painting has it. The rest of the hood's
coarse figure is its painted modelling, which a flat drawing should not copy.
The script `tools/measure8.py` prints the table.

**How far to go.** A first try (σ 0.65 softening, a two-scale tooth at 3.0
levels, heavy at 1.8 px) read as felt or suede at 2× rather than paper; the
version kept moves weight to the coarser 4 px scale and lowers the fine one.

### Change 2: the deadpan details

**Where.** On the walnut band just below the moulding, in front of each sitter,
on both sides of the lamp and clear of it (every prop and its shadow lies more
than 190 px from the lamp's centre). The upright cups rise over the robe's foot,
inside the silhouette, so they stand in front of the sitter and never cover the
gold. The bottom seat's props are the top seat's turned 180°.

**How they are drawn.** At 4× and reduced, like round 7's parts: one flat tone,
one flat shade, a 2.6 px dark warm-brown outline (50, 34, 28), a few interior
lines at 1.3–1.7 px. Then the same softening and paper tooth as the torso.
Each throws a flat cast shadow on the band (a flat 40% darkening, an ellipse
thrown away from the lamp in proportion to the prop's height); the band under
the shadow is round 2's pixels, darkened, with no grain. The colours are period
and muted: gilt (222, 178, 114) for coins, a cream glaze, pewter, linen, a dark
wine. No drawn pixel's luminance is below 22.

| Sitter | The props (left to right, top seat) | What they say |
|---|---|---|
| **Green woman** | two neat stacks of coins (7 and 4, 39 and 26 px tall); a cream cup on its saucer, full to the brim (58 px tall) | winning, and not even thirsty |
| **Garnet man** | a pewter tankard, full, with a pale skin on it (81 px tall); a crumpled linen napkin (38 px); one lone coin lying flat (12 px) | losing, and too anxious to drink |
| **Blue man** | a cream cup knocked onto its side, a small spill run from its mouth (45 px tall with the spill); a half-eaten bun on a pewter plate, the bite toward the outer edge, two crumbs (38 px) | distracted: the game has all of him |

Every prop is under 90 px tall (the tallest is the tankard, 81 px). At sleeve
size they read as small things on a table; none is a gag from across the room.

## Checks (measured on the finals, both seats, against round 7's finals)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| All pixels byte-identical to round 7 | 88.12% | 87.54% | 88.12% |
| Faces (round 6's face ellipse) | **100%** | **100%** | **100%** |
| Hoods and shoulder capes (the figure outside round 7's drawing) | **100%** | **100%** | **100%** |
| Gold field outside the figure | **100%** | **100%** | **100%** |
| Border and frame (outside the gold field) | **100%** | **100%** | **100%** |
| Lamp and its glow (a 160 px disc about the lamp, less round 7's drawing) | **100%** | **100%** | **100%** |
| Table band outside the props and their shadows | **100%** | **100%** | **100%** |
| Round 7's drawing (changed on purpose) | 10.3% | 10.4% | 10.6% |
| Darkest 0.5 mm areas, 0.5th percentile | 32.7 | 27.7 | 32.5 |
| Saturation × value, 99.5th percentile | 148 | 148 | 148 |
| 180° symmetry | exact | exact | exact |

The softening and the tooth are applied only inside the drawn mask, so the gold
is unchanged everywhere, not only away from the figure. The ~12% that changed is
round 7's drawing (about 13% of the card, 90% of it changed) plus the props and
their shadows (6,200 to 8,700 px a half).

## GPU time

None. No model ran this round.

## Not done, or worth knowing

- **The hoods are not touched,** so the meeting at the hem is closer but not
  gone: the painted cape still has its soft painted modelling and the drawn
  torso its flat tones and bold lines. The grain makes them one surface; it does
  not make them one technique, and was not meant to.
- **The softening also softens the hands' and cards' lines,** slightly. At
  sleeve size this is invisible; at 2× the cards' gilt edges are a little less
  crisp than round 7's.
- **The props are new costume.** They are the first objects on the table since
  round 2's fan and lamp. Their shadows are the only change to round 2's band.
- **The Sleeve Crafter's crop, borders and colour conversion** are still
  unconfirmed, as in rounds 1 to 7.

## Reproduce

Run from `/home/justin-a/scenery-packs/two-seats-work/round8`, with round 7's
masks in `../round7/comp` (`dm-`) and round 6's in `../round6/comp` (`figm-`),
under `/home/justin-a/scenery-packs/.venv/bin/python` (it has scipy):

1. `round8.py <round7>/two-seats-<name>.png ../round7/comp ../round6/comp <c> final/two-seats-<name>.png`
   (`--no-props` and `--no-grain` turn either change off)
2. `measure8.py final/two-seats-<name>.png ../round7/comp/dm-<c>.png ../round6/comp/figm-<c>.png`
3. `sheets8.py <this dir> <round 7 dir>`
