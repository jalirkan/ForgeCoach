# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: the .txt beside each final (passes, seeds, strengths, prompts, measured print numbers).
#   sidecars.py <outdir>      (run from round2/, which holds specs/)
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
O = sys.argv[1]
specs = {r: {j["name"]: j for j in json.load(open(f"specs/spec-r{r}.json"))["jobs"]} for r in range(1, 6)}
C = {
 "green-woman": ("The green woman: composed, faintly pleased, the better-off player",
   [("r1", "body-green-60", 2101, "body: cloak, gown, the first draft's face painted at panel fidelity, over guides/g-green.png (tools/prep.py)"),
    ("--", None, None, "fan: tools/fan.py green, five cards, tidy and evenly closed, behind the body pass's own hands"),
    ("r2", "face-green-45", 2201, "face at 3.2x (crop 590,302-910,622)"),
    ("--", None, None, "expression: tools/expr.py green (mouth corners up 9 px, cheeks up 3, upper lids down 3, on the 1024 tile)"),
    ("r3", "facex-green-34", 2401, "face, the nudged expression repainted"),
    ("r2", "hands-green-48", 2301, "hands and fan at 2.17x (crop 470,580-1030,963)"),
    ("r3", "hand-green-34", 2501, "hands at 3x (crop 590,730-930,962)"),
    ("r4", "u-green-24-L", 2601, "unifying pass, two tiles (L and R alike), after round 1's finish.py light")]),
 "garnet-man": ("The garnet man: older, anxious, worried",
   [("r1", "body-garnet-60", 2101, "body over guides/g-garnet.png (tools/prep.py)"),
    ("--", None, None, "fan: tools/fan.py garnet, seven cards, uneven, the fifth drawn 24 px up out of the fan"),
    ("r2", "face-garnet-55", 2201, "face at 3.2x, the expression from the prompt alone"),
    ("r2", "hands-garnet-48", 2301, "hands and fan at 2.17x"),
    ("r3", "hand-garnet-36", 2501, "hands at 3x (an older man's veined hands)"),
    ("r4", "u-garnet-24-L", 2601, "unifying pass, two tiles")]),
 "blue-figure": ("The blue figure: a young man, guarded and intent, a sidelong look across the table",
   [("r1", "body-blue-60", 2101, "body over guides/g-blue.png (tools/prep.py)"),
    ("--", None, None, "fan: tools/fan.py blue, six cards, held tight and narrow"),
    ("r2", "face-blue-55", 2202, "face at 3.2x"),
    ("--", None, None, "expression: tools/expr.py blue (irises slid 13 px toward the viewer's right, upper lids down 4, one mouth corner up 5)"),
    ("r3", "facex-blue-34", 2401, "face, the nudged expression repainted"),
    ("r3", "hands-blue-62", 2302, "hands, fan and doublet at 2.17x (0.48 had left the sleeves flat; 0.62 painted them)"),
    ("--", None, None, "a stray painted stroke between a card and a finger removed by tools/patch.py"),
    ("r4", "hand-blue-34", 2501, "hands at 3x"),
    ("r5", "u-blue-24-L", 2601, "unifying pass, two tiles")]),
}
GOLD = {"": "punched diamond gold: round 1's painted lozenge diaper with punched rosettes, untouched",
        "-streaky": "streaky worked leaf (comparison only): tools/streaky.py lays the first draft's gold (direction/two-seats-3.png) "
                    "over the painting's own light, outside the character's outline (tools/figmask.py), the table, the lamp and the floral band"}
def stats(p):
    im = Image.open(p); a = np.asarray(im.convert("RGB"), np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]; big = gaussian_filter(lum, 12)
    hsv = np.asarray(im.convert("HSV"), np.float32)
    b = a.astype(np.uint8)
    return (np.percentile(big, 0.5), np.percentile(big, 5), lum.min(),
            float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5)), np.array_equal(b, b[::-1, ::-1]))
for n, (title, passes) in C.items():
    for suf, gold in GOLD.items():
        p = f"{O}/two-seats-{n}{suf}.png"
        d05, d5, mn, sat, sym = stats(p)
        L = [f"two-seats-{n}{suf}.png  {title}.",
             "model: Lykon/dreamshaper-xl-1-0 (SDXL, fp16 UNet, madebyollin/sdxl-vae-fp16-fix), local, GTX 1080",
             "sampler: DPM++ 2M Karras, 32 steps scaled by strength, cfg 6.0 (5.5 on the unifying pass); every pass img2img",
             "size: 1500x2100 px at 600 dpi = 63.5 x 88.9 mm, 5:7 (Dragon Shield Sleeve Crafter, Standard); RGB",
             f"also: two-seats-{n}{suf}.jpg (the same pixels, JPEG quality 95, 4:4:4, 600 dpi)",
             "base: round 1's pre-light half (c1-h) for the figure; round 1's finished half (c1-24-ut) for the ground, the floral band, the table and the lamp",
             f"gold: {gold}",
             "passes, in order (negatives: tools/specs/spec-rN.json, by job name):"]
        for r, job, seed, what in passes:
            if job:
                j = specs[int(r[1])][job]
                L.append(f"- {what}: round {r}, job {job}, seed {seed}, strength {j['strength']}")
                L.append(f"    prompt: {j['prompt']}")
            else:
                L.append(f"- {what}")
        L += ["- after: tools/figmerge.py (the figure into round 1's finished half), tools/edgefix.py (green and blue only: round 1's red rim on the cloak's outline turned to the cloak's colour), tools/moulding.py (round 1's card tips on the table's moulding under the hands redrawn away)",
              "- compose: round 1's tools/compose.py --gold 0 --keep (face and hands from the lit, pre-unify half); bottom half = top turned 180 degrees; unsharp r2.0 40%; chroma above 140 compressed; dark floor 22",
              f"darkest areas (luminance blurred ~0.5 mm): 0.5th percentile {d05:.1f}, 5th percentile {d5:.1f} (floor 22); darkest single pixel {mn:.0f}",
              f"saturation x value, 99.5th percentile: {sat:.0f}/255",
              f"180-degree symmetry: {'exact, pixel for pixel' if sym else 'NOT EXACT'}"]
        open(p[:-4] + ".txt", "w").write("\n".join(L) + "\n")
        print(n + suf, f"dark0.5={d05:.1f} sat={sat:.0f} sym={sym}")
