# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): writes the .txt beside every delivered image (model, prompts, seeds, strengths, passes,
# measured print numbers). The chain is the one actually run (specs/spec-r*.json and specs/r*-gen.log).
# Usage: sidecars.py <two-seats dir> <work dir>
import json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

D, W = sys.argv[1:3]
SPECS = {r: json.load(open(os.path.join(W, f"spec-r{r}.json"))) for r in range(2, 12)}


def job(r, name):
    return next(j for j in SPECS[r]["jobs"] if j["name"] == name)


def stats(p):
    a = np.asarray(Image.open(p).convert("RGB"), np.float32)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    big = gaussian_filter(lum, 12)
    hsv = np.asarray(Image.open(p).convert("HSV"), np.float32)
    sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
    sym = np.array_equal(a, a[::-1, ::-1])
    return (f"darkest areas (luminance blurred ~0.5 mm): 0.5th percentile {np.percentile(big, 0.5):.1f}, 5th percentile "
            f"{np.percentile(big, 5):.1f} (floor asked for: 22); darkest single pixel {lum.min():.0f}\n"
            f"saturation x value, 99.5th percentile: {sat:.0f}/255 (chroma above 140 compressed x0.35)\n"
            f"180-degree symmetry: {'exact, pixel for pixel' if sym else 'NOT exact'}")


def step(r, name, seed, what):
    j = job(r, name)
    size = j.get("size") or list(Image.open(os.path.join(W, j["src"])).size)
    cfg = j.get("cfg", SPECS[r].get("cfg", 6.0))
    return (f"- {what}: round r{r}, job {name}, seed {seed}, img2img strength {j['strength']} "
            f"({int(32 * j['strength'])} of 32 steps), cfg {cfg}, {size[0]}x{size[1]}"
            + (f", tile ControlNet {j['cn']}" if j.get("cn") else "") +
            f"\n    prompt: {j['prompt']}\n    negative: {j['negative']}")


HEAD = """model: Lykon/dreamshaper-xl-1-0 (SDXL, fp16 UNet, madebyollin/sdxl-vae-fp16-fix), local, GTX 1080
sampler: DPM++ 2M Karras (DPMSolverMultistep, dpmsolver++, karras sigmas), 32 steps scaled by strength;
         head-sliced classic attention; every pass is img2img (no txt2img anywhere)
size: 1500x2100 px at 600 dpi = 63.5 x 88.9 mm, 5:7 (Dragon Shield Sleeve Crafter, Standard); RGB
geometry: the top half (1500x1052, seam at y = 1050) is painted; the bottom half is it turned 180 degrees"""

COMMON_A = [
    "- guide: tools/guide.py (tooled gold, the hooded figure with draped folds, a drawn face, hands, a seven-card fan, table, lamp)",
    step(2, "h68", 1202, "the body (cloak, fur-trimmed hood, face, the painted hands, the gold ground and its floral border), over the guide"),
    "- the fan: tools/fan.py drew seven plain dark card backs with a thin gilt edge BEHIND the painting's own hands "
    "(the model had painted them holding a book), pivot (757, 880), card length 262 px, angles -36..36 by 12; the "
    "hands laid back on top by a skin mask",
]


def chain_A(face, hands, hand, unify_name, unify_round, colour=None):
    c = list(COMMON_A)
    c.append(step(3, "face-a50", 1302, "face, first repaint (crop 590,302-910,622 at 3.2x, 1024x1024)"))
    c.append("- eyelids: lowered by a code paintover on that face (lids drawn down to a sliver of iris), so the eyes look at the cards")
    c.append(step(4, face[0], face[1], "face, final repaint (same crop)"))
    c.append(step(5, hands[0], hands[1], "hands and fan repaint (crop 470,580-1030,963 at 2.17x)"))
    c.append(step(7, hand[0], hand[1], "hands detail (crop 590,730-930,962 at 3x)"))
    c.append("- table: tools/finish.py table (the board below the moulding redrawn as even walnut with the lamp's pool)")
    c.append(step(6, "lamp-b62", 1601, "the lamp (tools/lamp.py: the whole card's centre, 360x360 px at 2.84x, over a drawn glowing globe); "
                  "its top half pasted, so the lamp is symmetric by construction"))
    c.append("- light: tools/finish.py light (a warm light from the lamp, strongest on undersides: hands, the fan's foot, cuffs)")
    if colour:
        c.append(f"- colourway: tools/finish.py recolour {colour} (the garnet robe's hue turned, face, hands, fan, gold, fur untouched)")
    c.append(step(unify_round, unify_name + "-L", 1801, "unifying pass, two overlapping 1024x1056 tiles at the sleeve's own resolution (L and R alike)"))
    c.append(step(10, "table-40", 1901, "table repaint (the whole card's table band, 1408x384); only the board above the seam kept, not the lamp"))
    c.append("- compose: tools/compose.py: face and hands taken back from the lit half (the unifying pass softens them); "
             "the frame's right side zone mirrored from the left below y 200 so each side band meets its own turned twin; "
             "the bottom rows above the seam eased; the bottom half the top turned; unsharp mask r2.0 40%; chroma above 140 "
             "compressed; dark floor 22 (not needed)")
    return c


ITEMS = {
    "two-seats-garnet.png": ("Final, garnet. Candidate 1 (A).",
                             chain_A(("face-b50", 1412), ("hands-b46", 1501), ("hand-c1-34", 1701), "u-c1-24", 8)),
    "two-seats-green.png": ("Final, green: the same figure as garnet, recoloured, then its own unifying pass.",
                            chain_A(("face-b50", 1412), ("hands-b46", 1501), ("hand-c1-34", 1701), "u-c1green-24", 9,
                                    "green (hue 152, saturation x0.66, value x0.78)")),
    "two-seats-blue.png": ("Final, blue: the same figure as garnet, recoloured, then its own unifying pass.",
                           chain_A(("face-b50", 1412), ("hands-b46", 1501), ("hand-c1-34", 1701), "u-c1blue2-24", 11,
                                   "blue (hue 224, saturation x0.60, value x0.76)")),
    "candidates/1-A-garnet.jpg": ("Candidate 1 (A): the garnet final, as a JPEG.",
                                  chain_A(("face-b50", 1412), ("hands-b46", 1501), ("hand-c1-34", 1701), "u-c1-24", 8)),
    "candidates/2-B-garnet.jpg": ("Candidate 2 (B): the same body; the other face (lids lower, strength 0.42), the other hands repaint (0.38), unifying pass 0.28.",
                                  chain_A(("face-b42", 1412), ("hands-b38", 1501), ("hand-c2-34", 1702), "u-c2-28", 8)),
    "candidates/3-A-garnet-tooled.jpg": ("Candidate 3: A, with the code-drawn tooled gold (tools/guide.py gold_full: leaves, an incised frame, "
                                         "punched rosettes, a lozenge diaper) laid over the painted ground at 35% outside the figure.",
                                         chain_A(("face-b50", 1412), ("hands-b46", 1501), ("hand-c1-34", 1701), "u-c1-24", 8)),
}

for rel, (title, chain) in ITEMS.items():
    p = os.path.join(D, rel)
    jpg = p[:-4] + ".jpg"
    txt = f"{os.path.basename(p)}  {title}\n{HEAD}\n"
    if rel.endswith(".png"):
        txt += f"also: {os.path.basename(jpg)} (the same pixels, JPEG quality 95, 4:4:4, 600 dpi)\n"
    txt += "passes, in order:\n" + "\n".join(chain) + "\n" + stats(p) + "\n"
    open(p[:-4] + ".txt", "w").write(txt)
    print("wrote", p[:-4] + ".txt")
