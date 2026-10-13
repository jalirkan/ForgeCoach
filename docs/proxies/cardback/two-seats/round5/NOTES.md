# The Two Seats, round 5: round 4's figures in round 2's setting

*Written 2026-10-12. This is the sleeve art for the Dragon Shield standard sleeves:
1500 × 2100 px at 600 dpi, 5:7, exact 180° symmetry, with what matters inside a
110 px margin. Rounds 1 to 4 are untouched.*

## The brief

The owner pointed at round 2's `CHARACTERS.jpg` and asked for that background,
that card style and those hands. The corrected brief for this round:

- **The figures** are round 4's three flat court-card figures
  (`../round4/two-seats-{1,2,3}-fixed.png`): the first drafts with their faces and
  hands fixed. Their woodcut flatness, their silhouettes and their faces are kept
  as they are.
- **Everything around them** is round 2's: the punched diamond gold, the
  red-and-blue floral band, the outer gold edge, and the walnut table band with
  the glass lamp and its glow.
- **The cards and hands** are round 2's: the small natural fan of plain dark,
  gold-edged cards, held by round 2's hands, repainted at 2–3× so they read as
  real hands. They replace the drafts' wide open fan and clasped hands.

An earlier reading of the brief had started repainting round-2-style bodies (a
drawn seated-figure guide at 0.68). That was stopped after three images and
discarded. None of it is in these files.

## What is here

| File | What it is |
|---|---|
| `two-seats-green-woman.png` / `.jpg` | Final, round 4's draft 1 (the green woman) |
| `two-seats-garnet-man.png` / `.jpg` | Final, round 4's draft 2 (the red hooded man) |
| `two-seats-blue-man.png` / `.jpg` | Final, round 4's draft 3 (the blue figure) |
| `CHARACTERS.jpg` | The three side by side, in round 2's `CHARACTERS.jpg` layout (same size, same captions place), so the two sheets can be compared directly |
| `ROUND4-VS-ROUND5.jpg` | Each round-4 draft figure in its own setting, beside its round-5 setting |
| `ROUND2-VS-ROUND5.jpg` | Each round-2 final beside its round-5 version |
| `FACES.jpg` | The three faces from the finals at 3× (box x 600–900, y 260–540) |
| `SLEEVE-SIZE.jpg` | True print size: 744 × 1039 each (63.5 × 88.9 mm at 297.6 ppi), with a 10 mm bar |
| `CUT-SAFE.jpg` | The 110 px keep-inside margin (blue) and a 3 mm edge line (red) |
| `tools/` | This round's scripts, the three cut-out masks (`cut-{1,2,3}.png`) and `specs/` (each GPU round's spec and log) |

The JPEG is the file to upload (quality 95, 4:4:4, tagged 600 dpi), as before.

## How it was made

Everything runs in the half (1500 × 1052, the seam at y 1050). The bottom seat is
the half turned 180°.

### 1. The ground: round 2's half, with round 2's figure taken out

`tools/assemble.py`, step 1.

- **The hole.** It starts from round 2's figure (its outline mask and
  `mask-fig8`), grown 24 px so its painted shadow goes too. It also takes in
  anything non-gold within 60 px of the figure: round 1's red rim along the
  green and blue cloaks.
- **The fill.** Each hole pixel is copied from round 2's own gold, a whole number
  of lattice periods away (96 px). It looks upward first, then outward, and
  never copies from the gilt rules, the floral band or another hole.
- **The light.** The copied texture keeps its fine detail. Its low-frequency
  light (the lamp's glow) is taken from where it lands, by normalized
  convolution summed over three scales, so the fill shows no seam.

### 2. The figure: cut out flat and scaled

`tools/cutout.py`, then `tools/assemble.py`, step 2.

- **The cut-out.** OpenCV GrabCut runs on the round-4 top seat. Its seeds:
  - the gold well clear of the cloak is certain background;
  - the face and the cloak's core are certain figure.

  Then the largest piece is kept and holes are filled. Draft 2's two thin
  frame rules, where they cross the cloak's foot, are cut out and the cloth
  is closed over them.
- **The scale.** Each figure is scaled 0.9 about its own table line (draft
  y 950 → round 2's moulding top, y 944). It is otherwise untouched: no repaint
  of the body or the face.
- **The drafts' fan, hands and lamp neck come out.** The fan is a sector, apex
  (750, 870), radius ≈ 372, ±49°, measured on all three drafts. The hands and
  the lamp neck are a box. The cloak is closed over the chest:
  - *its colour and light* come from a push-pull fill from the cloth around the
    hole;
  - *its folds* are straight vertical ones: a profile taken from the cloth
    beside the fan (x 440–520 and 980–1060), reflection-tiled inward;
  - *a soft dark fold* runs down the centre, where the two fronts meet.

### 3. Round 2's fan and hands

`tools/assemble.py`, step 3.

- **What is taken.** Round 2's final supplies the cards (its fan mask) and the
  hands (by skin colour).
- **Where they go.** They are scaled 1.2 about the table edge, so the hands
  rest just above the moulding and the cards sit at mid-figure.
- **The wrists.** A soft shadow of the cloak's opening is laid round each
  wrist, so the hands come out of the cloak.

### 4. The hand pass (GPU)

`tools/handpaste.py`.

- **The pass.** The tile is x 520–980, y 744–944, at 2.4× (1104 × 480). It ran
  at 0.36 and 0.44, two seeds each, with round 2's hand prompt and the cloak's
  colour.
- **The paste is skin only.** It takes round 4's rule: wherever the input or the
  repaint is skin, dilated 4 px and feathered. So the cards, their gilt edges
  and the cloak keep their own pixels.
- **The picks.** Green: 0.36 s5301. Garnet: 0.44 s5301. Blue: 0.44 s5301.
- **The blue man's cuff.** Round 2's ochre cuff under his right hand is turned to
  the cloak's dark blue.

### 5. The unifying pass (GPU), 0.18

`tools/unipaste.py`.

- **The pass.** One tile (x 300–1200, y 220–944, 1024 × 824) per character, at
  **0.18** with a flat court-card prompt (round 4's prefix: *flat medieval
  court-card illustration, woodcut-like, bold outlines, limited palette,
  matte*), seed 5401.
- **Where it is pasted.** Only on a band along the figure's outline (10 px
  out, 8 px in) and on the code-closed cloak front. The faces, the rest of the
  figure, the hands and the cards keep their pixels.
- **What it did.** At 0.18 the flat style did not turn painterly. The effect is
  small: the cut edge softens onto the gold.

### 6. Composition

`../tools/compose.py` (round 1's, unchanged), then `tools/r2pixels.py`.

- **compose.py** with `--gold 0` runs twice: sharpened as before, and with
  `--sharpen 0`. It does the seam, caps chroma, checks the dark floor and
  asserts the symmetry.
- **The figure comes from the unsharpened run.** The drafts were sharpened in
  round 4, and a second unsharp mask hardens their faces.
- **Everything else is round 2's final, pixel for pixel.** That covers
  everything outside the new figure and the refilled gold (both grown 14 px).
  **Every row from the moulding's top (y 944) to the seam is always round 2's.**
- **About 73.5% of each final is byte-identical to round 2's.** That includes
  the whole table band, the lamp, its glow, the floral band and the outer gold.

## The three figures

| | Top of hood (px from the edge) | Figure x | Height above the table | Share of the half |
|---|---|---|---|---|
| Green woman (draft 1) | 267 | 449–1063 | 677 px | 64% |
| Garnet man (draft 2) | 246 | 414–1093 | 698 px | 66% |
| Blue man (draft 3) | 258 | 449–1054 | 686 px | 65% |

Each figure is the draft's own: the hood and cloak silhouette, the flat colour
and the face, all as round 4 left them, at 0.9 scale. Each holds round 2's small
fan at mid-figure, its hands just above the table's moulding.

## Print checks (measured on the finals)

| | Green woman | Garnet man | Blue man |
|---|---|---|---|
| Darkest 0.5 mm areas, 0.5th percentile | 30.2 | 27.8 | 30.8 |
| Saturation × value, 99.5th percentile | 148 | 148 | 149 |
| 180° symmetry | exact | exact | exact |

- **The dark floor.** No shadow lift was needed: every 0.5 mm area is above the
  22 floor. Some single pixels reach 0, in the drafts' own black outlines and
  hood linings. They are too small to print as an area, as before.
- **The margin.** Everything that matters sits well inside the 110 px margin:
  figures x 414–1093, hoods from y 246. The floral band and the bevel are round
  2's, where they were.

## GPU time

All of it ran on DreamShaper XL fp16 on the GTX 1080, under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`, offline.

| Round | Images | Time |
|---|---|---|
| Hand pass (r2) | 12 | 357 s |
| Unifying pass (r3; superseded after the ground fix) | 6 | 160 s |
| Unifying pass (r4) | 3 | 60 s |
| Discarded body repaints (the misread brief) | 3 | ≈ 5 min, with one aborted start |

The total is about 15 minutes, finished at 22:07.

## Not done, or worth knowing

- **The closed cloak front is code, not painting.** It is flat colour with
  straight vertical folds, which suits the woodcut style. At 3× it is plainer
  than the drafts' own cloth, and on the green woman a soft edge shows where it
  meets the hood lining.
- **The hands come out of the cloak with no visible arms.** The drafts' figures
  have no forearms to give them. A soft shadow of the opening is the only cue.
  The green woman keeps the draft's dark sleeve cuff beside her right hand.
- **The two styles meet in the hands.** Round 2's hands are painted (tempera),
  the figures are flat, and the brief asks for exactly that contrast.
- **The blue man's darker doublet** from the first brief does not apply: the
  round-4 figure shows no doublet.
- **The refilled gold.** Where round 2's wider figure stood, the gold is round
  2's lattice copied in from elsewhere. Close up, a few diamonds are slightly
  out of register; at sleeve size it reads as the same ground.
- **The Sleeve Crafter's crop, borders and colour conversion** are still
  unconfirmed, as in rounds 1 and 2.

## Reproduce

Inputs:

- round 2's work directory (`/home/justin-a/scenery-packs/two-seats-work/round2`:
  `comp/<c>-fin.png`, `comp/<c>-figmask.png`, `comp/<c>-b-fanmask.png`,
  `guides/mask-fig8.png`, `out/<c>-punched.png`);
- round 4's finals.

Run from `/home/justin-a/scenery-packs/two-seats-work/round5`, in order:

1. `cutout.py`
2. `assemble.py`
3. `../round2/tools/region.py cut`, then `gpu.sh specs/spec-r2.json`
4. `handpaste.py`
5. `region.py cut`, then `gpu.sh specs/spec-r4.json`
6. `unipaste.py`
7. `compose.py` twice (with and without `--sharpen 0`)
8. `r2pixels.py`
9. `sheets5.py`
