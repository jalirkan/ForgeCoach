# The Two Seats, final: the print files

*Written 2026-10-13. Round 10, the last polish before a test pack of Dragon Shield
custom sleeves. The owner's choice: **the props version, no words.** Rounds 1 to 9
are untouched.*

1500 × 2100 px at 600 dpi (63.5 × 88.9 mm, 5:7), exact 180° symmetry, everything
that matters inside a 110 px margin. **[`ORDER-NOTES.md`](ORDER-NOTES.md) is the
owner's checklist for ordering.**

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.jpg` / `.png` | The green woman. **The JPEG is the file to upload** (quality 95, 4:4:4, tagged 600 dpi) |
| `two-seats-garnet-man.jpg` / `.png` | The garnet man |
| `two-seats-blue-man.jpg` / `.png` | The blue man |
| `CHARACTERS.jpg` | The three side by side |
| `FIXES-ZOOM.jpg` | Every fix below at 2×, round 9 beside the final |
| `SLEEVE-SIZE.jpg` | The three at true print size (297.6 px per inch), with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue), 3 mm from the edge (red), the centre line (green) |
| `tools/` | This round's scripts, their parameters and the check reports |

## How it was done

Every fix is **hand retouching in code**, at the lightest touch that worked; no
model was run, so nothing could drift toward a crisper or more photographic
finish, and no face, hood, hand or card was repainted. The input is round 9's
props final; everything happens in the top half, and the bottom seat is that
half turned 180°, pixel for pixel (asserted).

1. **The hem** (all three; `retouch.py`, part B). Where round 7's shoulder-cape
   meets round 9's painted cloak, the cloak's tone is brought to the cape's over
   36 px below the seam (the low-frequency colour of each side, σ 8 px, the
   difference laid in with a cosine ramp), and the cape's own brush texture is
   carried 18 px into the cloak, mirrored across the seam. The dark painted hem
   line goes with the other drawn lines (fix 5). The cape itself is never
   written; the neck-cloth under the hood is told apart by hue and keeps its
   neckline.
2. **The tankard** (garnet; `props.py`). Its open top is painted in as a thin
   ellipse on the rim: a dull, warm, matte skin over dark ale, the ale showing
   at the back edge, a slow wrinkle, the pewter lip round it. No steam (there
   was none; none was added). A faint, broken ring is left on the wood in front
   of it, where it stood before (x 453–487, y 1022–1032).
3. **The cups** (`props.py`). The green woman's: the light haze over the
   moulding above the rim is replaced by version B's moulding (round 2's
   pixels) over a 66 × 17 px strip, feathered at the rim. The blue man's
   knocked-over cup: its top and closed end are re-edged — the cup's own cream
   carried to its edge and laid over round 2's clean wood with a soft alpha —
   so the grey outline and its halo go; the open mouth, the spill and the
   shadow stay as painted.
4. **The green woman's folds** (`retouch.py`, part A, wider settings). Each
   drawn fold line is lifted out (grey closing of radius 6, the gap filled from
   the cloth beside it, with that cloth's own texture borrowed from 7–15 px
   away as a luminance ratio, so the hue holds), and its darkness comes back as
   a soft painted shade: the line's own depth spread by a σ 6 px gaussian at
   0.9 strength. The folds stay where they were, as shadow, not as line.
5. **The last drawn outlines below the hem** (all three; the same pass). The dark
   lines (radius 5) on the garnet man's sleeves and skirt and the blue man's
   forearms and folds, the dark outline along the cloaks' silhouettes (lifted
   with no shade, so no rim is drawn), and the **light** rims round 8 drew on the
   garnet man's sleeve openings (grey opening, radius 3). Lines fade out within
   12 px of the hands and fan (their cast shadow is painting) and 3 px of a
   prop; a final despeckle takes any written pixel more than 9 levels off its
   5 × 5 median.

The texture of what was filled matches the cloth beside it (compose9's numbers,
band-pass luminance std, median over 16 px windows, flat cloak only):

| | fine | mid | coarse |
|---|---|---|---|
| Green woman, untouched cloak / filled | 1.16 / 1.29 | 1.42 / 1.47 | 2.75 / 3.00 |
| Garnet man | 0.65 / 0.78 | 1.18 / 1.15 | 1.90 / 1.72 |
| Blue man | 0.69 / 0.76 | 1.27 / 1.22 | 2.12 / 1.92 |

## Checks (the finals, both seats; `tools/reports/`)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| Faces, vs round 9 | **100%** | **100%** | **100%** |
| Hoods and shoulder capes, vs round 9 | **100%** | **100%** | **100%** |
| Hands and fan, vs round 9 | **100%** | **100%** | **100%** |
| Gold field, border and frame, lamp and glow, vs round 9 | **100%** | **100%** | **100%** |
| Pixels changed from round 9 | 7.82% | 4.36% | 5.07% |
| Darkest pixel anywhere this round wrote | 23.3 | 22.2 | 22.3 |
| Darkest 0.5 mm area (12 px box) in the painted torso | 29.8 | 25.6 | 25.1 |
| Darkest 0.5 mm area on the whole card | **10.4** | **12.7** | **6.8** |
| Darkest 0.5 mm areas, 0.5th percentile | 20.7 | 22.5 | 24.2 |
| Round 9's measure (σ 12 px gaussian, 0.5th percentile) | 32.9 | 28.1 | 33.3 |
| Saturation × value, 99.5th percentile (round 9) | 148.0 (148.0) | 148.0 (148.0) | 148.4 (148.4) |
| Saturation × value, highest in what this round wrote | 143.3 | 112.7 | 100.0 |
| 180° symmetry | exact | exact | exact |
| Cards at 200% | plain | plain | plain |
| JPEG (quality 95) | 1.12 MB | 1.11 MB | 1.11 MB |

**The darks fail in one place, and it is not one this round may touch.** Every
0.5 mm area below 22 lies inside the face ellipse (the hair and the shadow round
the face: 9,334 / 5,639 / 5,676 px) or the hood (1 / 1,730 / 153 px), which are
round 6's pixels and have been in every round since. Nothing this round wrote is
below 22, even per pixel. A gentle toe lift of those shadows (everything below 22
mapped into 22–30, nothing else moved) would pass the check, but it changes face
pixels, so it is the owner's call; it is not applied.

No neon: no pixel this round wrote is more saturated than the card already was.

## Margins (nearest edge, px at 600 dpi; the bottom seat mirrors the top)

| Element | Distance | mm | |
|---|---|---|---|
| Outer gold mat and its thin dark bevel line (≈ 72 px) | 0–72 | 0–3.0 | crosses the margin; bleeds by design |
| Gilt moulding, from the bevel line to the floral band | 72–115 | 3.0–4.9 | crosses the margin; bleeds by design |
| Floral border band (outer edge to inner fillet) | 115–197 | 4.9–8.3 | inside, by 5 px at its outer edge |
| Green woman, hood top | 267 | 11.3 | inside |
| Garnet man, hood top | 245 | 10.4 | inside |
| Blue man, hood top | 258 | 10.9 | inside |
| Figures, left / right side (green, garnet, blue) | 448 / 435, 414 / 406, 449 / 444 | ≥ 17.2 | inside |
| Fan of cards (all three) | 623 sides, 676 top | 26.4 | inside |
| Hands (all three) | 636 | 26.9 | inside |
| Props, left / right (green, garnet, blue) | 453 / 460, 443 / 399, 381 / 437 | ≥ 16.1 | inside |
| The garnet man's ring on the wood | 453 | 19.2 | inside |
| Lamp and its glow (160 px disc on the centre line) | 589 | 24.9 | inside |

No hood top is inside the margin; nothing was moved.

## Not done, or worth knowing

- **The darks inside the face ellipse and hood** (above): measured, not changed.
- **The tankard's skin is small**: about 41 × 7 px, 1.7 × 0.3 mm on the card. It
  reads as a dull top at arm's length, and as a skin only up close — which is
  the brief's kind of joke, but it is the least certain of the fixes.
- **The green woman's cloak is softer than before** at 200% — the drawn lines
  were most of its detail; the folds are now shade. It is no crisper than the
  faces anywhere.
- **No GPU** was used: every fix was hand retouching, so the ≤ 0.45 repaint was
  not needed.
- **The Sleeve Crafter's crop, borders and colour conversion are unconfirmed**,
  as in every round. `ORDER-NOTES.md` says what to look for.

## Reproduce

From `/home/justin-a/scenery-packs/two-seats-work/final`, with round 9's finals in
the r9 lane (`docs/proxies/cardback/two-seats/round9/`) and rounds 6–8's masks in
`../round6/comp`, `../round7/comp`, `../round8/final`, under
`/home/justin-a/scenery-packs/.venv/bin/python` (it has scipy):

1. `tools/retouch.py <tag> work/rt-<tag>.png` (fixes 1, 4, 5; parameters in `tools/params.json`)
2. `tools/props.py <tag> work/rt-<tag>.npy work/pr-<tag>.npy` (fixes 2, 3)
3. `tools/finalize.py <tag> work/pr-<tag>.npy <this dir>` (the print files and the checks)
4. `tools/sheets.py <this dir> ../round9`, `tools/margins.py`, `tools/texcheck.py <tag> work/pr-<tag>.npy`

`<tag>` is `green`, `garnet` or `blue`.
