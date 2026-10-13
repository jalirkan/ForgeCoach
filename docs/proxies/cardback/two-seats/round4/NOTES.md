# The Two Seats, round 4: the first drafts, with only their faces and hands fixed

Rounds 1 to 3 were rejected as hyper-real. This round goes back to the three first
drafts (`../../direction/two-seats-1.png`, `-2.png` and `-3.png`, 1632×2220, concept 3 of
`../../PROXY-BACK-DIRECTION.md`) and repaints **only** each draft's face and its pair of
hands. The repaint is low-strength img2img at the drafts' own flat finish. Nothing else
is re-imagined.

## What changed

Each draft is exactly 180° symmetric (checked: 0 differing pixels against its own
rotation). So each fix goes on the top seat, and the bottom seat is the same pixels turned.

| Draft | Face (what was wrong, what it is now) | Face tile | Hands | Hands tile |
|---|---|---|---|---|
| 1, green woman | Weary, droopy and uneven eyes, with a soft, smeared mouth. Now the eyes are clear and even, with a defined lid line, and the mouth is crisp. She keeps the same calm, composed expression, drawing and blush. | `1-face-sh-36-s433`: strength **0.36**, seed **433**, sharpened init | A soft lump. Now there are two clasped hands with readable fingers. | `1-hands-sh-42-s432`: **0.42**, seed **432**, sharpened init |
| 2, red hooded man | Sallow, with a green-teal cast across the right cheek and a muddy brow. Now he has warm, even skin. He is still the worried old man, with the furrowed brow, set mouth and tired eyes. | `2-face-40-s412`: **0.40**, seed **412** | Fingers melted into one block. Now the fingers are separated over the lamp's cap. | `2-hands-sh-36-s432`: **0.36**, seed **432**, sharpened init |
| 3, blue figure | A malformed nose (a black blot under it) and mismatched eyes. Now the nose is well formed with a normal nostril shadow, and the eyes are clear and level. The expression is the same guarded one. | `3-face-sh-42-s431`: **0.42**, seed **431**, sharpened init with the blot pre-lifted | Pale, ghostly and soft. The fingers are a little more defined now, but see *What I could not fully fix*. | `3-hands-sh-36-s431`: **0.36**, seed **431**, sharpened init |

**How.** The face-crop and hand-crop mechanics come from round 3 (`patch.py` and
`paint.py`, copied unchanged).

1. Crop the region at 3.2× (faces 240×240 → 768², hands 280×180 → 896×576, and
   320×180 → 1024×576 for draft 3).
2. Run img2img on DreamShaper XL (fp16, DPM++ 2M Karras, cfg 6, 32 steps × strength). The
   prompt opens *"flat medieval court-card illustration, woodcut-like, bold outlines, limited
   palette, matte, no realism, no photo, no oil-painting sheen"*, then names the draft's own
   face and expression. The negative prompt rules out photo, realism, oil sheen, skin
   texture, malformed eyes, extra fingers, card faces, pips and letters.
3. Try three seeds at each of two strengths per region, all between 0.32 and 0.42.
4. The first pass (0.32 and 0.40, or 0.34 and 0.42 for hands) kept the drawing but also
   kept the draft's blur. So a second pass sharpened the init first (`prep.py`: an unsharp
   mask, which only steepens edges the draft already drew). For face 3 it also lifted the
   nose blot halfway toward the surrounding skin. It then ran at 0.36 and 0.42.
5. Paste back with `fix.py`:
   - **face**: a feathered ellipse;
   - **hands**: only where either image is skin, dilated 5 px and feathered, inside a
     rect, so the card fan, its gold edges and the lamp's neck keep the draft's own pixels;
   - the tile's mean brightness is matched to the draft (hue is left alone, because the
     green cast was the fault);
   - no pasted pixel is more chromatic than the draft's own 99.9th percentile in that box.

All candidates are in `/home/justin-a/scenery-packs/two-seats-work/round4/raw/`
(66 tiles). The picks are in `tools/picks.json` and the boxes in `tools/regions.json`.

## What did not change (checked by pixel diff against each draft)

- Changed pixels: **2.6% of the card** in each draft. In the top seat they sit only inside
  x 687–949 and y 253–954; the bottom seat is the same area turned.
- **The fan of cards: 0 changed pixels** in the fan band (y 520–830) in all three drafts.
  The only fan pixels touched are the spoke tips where they run under the fingers, inside
  the hands mask. There are no pips and no letters: the fan is still the draft's plain dark
  backs with gold edges.
- **The lamp, the table band and the seam: 0 changed pixels** (y 980–1240 in both seats).
- **The gold, the frame and the moulding: 0 changed pixels** (nothing changed outside
  x 680–960).
- **Palette**:

  | | Darks, 0.5th pct | Darks, 5th pct | Saturation × value, 99.5th pct |
  |---|---|---|---|
  | 1 | 23.0 | 35.0 | 162 |
  | 2 | 24.0 | 31.0 | 156 |
  | 3 | 26.0 | 38.0 | 157 |

  Darks are the drafts' own measure (luminance, PIL GaussianBlur(12) ≈ 0.5 mm). Every
  number here is identical to the draft at the same crop. Darks are ≥ 22 everywhere, so the
  drafts' shadow lift (in `finish.py`) was not needed. Chroma is not above the drafts' own.
- The green woman's hair crossing the cut line was left as is.

## The finals: Dragon Shield standard sleeve

The finals are `two-seats-{1,2,3}-fixed.png` and `.jpg` (q95, 4:4:4): 1500×2100 (5:7) at
600 dpi, which is 63.5 × 88.9 mm.

- **Cover crop.** Each final keeps the draft's full height and takes 23 px off each side
  (x 23..1609, so 1586 wide and centred), then is resized with Lanczos at 0.9458.
- **Symmetry.** The bottom half is rebuilt as the top half turned, so 180° symmetry is
  exact: the maximum pixel difference against the rotation is 0 for all three.

**Margin report** (110 px safe line on the 1500×2100):

- **Outside it, i.e. in the outer 110 px:**
  - the outer gilt moulding and bevel of drafts 1 and 3, and the outer gold field of draft 2
    (all bleed decoration);
  - **the inner dark frame rule's vertical sides**, at x ≈ 96–104 (and 1396–1404 mirrored),
    about 6–14 px outside the safe line in all three. The sleeve's cut or overlap may nibble
    them;
  - the table band, which runs off both sides by design.

  The horizontal rule at y ≈ 119–128 (and mirrored) sits just inside.
- **Well inside it:** the figures, faces, hands, fans and lamp, all within
  x ≈ 400–1100 and y ≈ 170–1930.

## What I could not fully fix

- **Hands on draft 3** improved the least. The draft painted them pale and translucent
  over white cuffs. At ≤ 0.42 the repaint keeps that pale, ghostly read and only firms up
  the fingers somewhat. A stronger fix would mean a higher strength or a drawn guide,
  which this round's brief rules out.
- **Hands on drafts 1 and 2** are much better, but they are still simple, flat
  court-card hands, not anatomically detailed. That is intended.
- **Face 1** still has the draft's grey eye-sockets and long nose. That is the draft's
  drawing, kept on purpose; only the eyes and mouth are cleaned up.

## Sheets

- `BEFORE-AFTER.jpg`: each first draft at the same 5:7 crop, beside its fixed final.
- `FACES-BEFORE-AFTER.jpg`: each face at 3× and each pair of hands at 2.25×, before and
  after (top seat).
- `SLEEVE-SIZE.jpg`: the three finals at true print size, 744×1039 at 300 ppi
  (63 × 88 mm), with a 10 mm bar.

## Reproduce

`tools/build.sh crops`, then `tools/build.sh paint` (GPU, under
`flock ~/scenery-packs/logs/gpu.lock nice -n 15`), then `tools/build.sh final`. GPU time
this round was **26.6 min**: r4a, 36 tiles, 854 s; r4b, 30 tiles, 744 s.
