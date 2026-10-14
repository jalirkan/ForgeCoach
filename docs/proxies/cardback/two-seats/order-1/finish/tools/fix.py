# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish: local inpaints on the one-pass painting (DreamShaper XL 0.40 s9702).
# Every repair is PAINTED by the model, through one-pass/tools/paint2.py (SDXL inpaint on the plain UNet, which holds
# the latents outside the mask to the source's own at every step). This script only cuts the source and the mask out,
# and puts the painted pixels back. Run in ~/scenery-packs/two-seats-work/order1/finish.
#   fix.py cut   <top.png> <region>            -> comp/<region>-src.png, comp/<region>-mask.png
#   fix.py paste <top.png> <region> <painted.png> <out top.png>
# <top.png> is the UNLIFTED top half (1500 x 1050, the one-pass composite before the black-point lift). The source
# for a cut is the whole card built from it (the top half over its own 180-degree turn, no lift), so a region that
# crosses the seam (the band, the lamp) is painted in its real surroundings; only rows above the seam are kept.
# Regions (regions.json): box [x0, y0, x1, y1] in card px, scale (the working size is box x scale), and the mask as
# polygons and ellipses in card px. Paste: the painted crop is resized back to the box (Lanczos); its alpha is the
# drawn mask, softened by a gaussian of 1 px at card scale for the joint (the paint itself is not filtered).
# "ground": true also mattes the result against Ground A2 as the one pass did: inside the mask, a pixel the model
# left within 22 levels of Ground A2 (max channel, both at 1.5 px smoothing) goes back to Ground A2's own leaf, at
# 52 levels it is wholly the painting; so a sleeve's new outline is the painting's and the leaf stays the ground's.
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

SEAM = 1050
HERE = os.path.dirname(os.path.abspath(__file__))
REG = json.load(open(os.path.join(HERE, "regions.json")))

def card(top):
    return np.concatenate([top, top[::-1, ::-1]], 0)

def drawmask(r, W, H, ox, oy, s):
    im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im)
    for p in r.get("poly", []):
        d.polygon([((x - ox) * s, (y - oy) * s) for x, y in p], fill=255)
    for e in r.get("ellipse", []):
        x0, y0, x1, y1 = e
        d.ellipse([(x0 - ox) * s, (y0 - oy) * s, (x1 - ox) * s, (y1 - oy) * s], fill=255)
    for e in r.get("minus", []):
        x0, y0, x1, y1 = e
        d.rectangle([(x0 - ox) * s, (y0 - oy) * s, (x1 - ox) * s, (y1 - oy) * s], fill=0)
    return np.asarray(im, np.float32) / 255

cmd, topf, name = sys.argv[1:4]
r = REG[name]
x0, y0, x1, y1 = r["box"]; s = r["scale"]
top = np.asarray(Image.open(topf).convert("RGB"))
C = card(top)
W, H = round((x1 - x0) * s), round((y1 - y0) * s)
assert W % 8 == 0 and H % 8 == 0, (W, H)
if cmd == "cut":
    os.makedirs("comp", exist_ok=True)
    Image.fromarray(C[y0:y1, x0:x1]).resize((W, H), Image.LANCZOS).save(f"comp/{name}-src.png")
    m = drawmask(r, W, H, x0, y0, s)
    Image.fromarray((m * 255).astype(np.uint8)).save(f"comp/{name}-mask.png")
    print(name, (W, H), "mask px at 1x", int(drawmask(r, x1 - x0, y1 - y0, x0, y0, 1).sum()))
elif cmd == "paste":
    painted, out = sys.argv[4:6]
    q = np.asarray(Image.open(painted).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    m = drawmask(r, x1 - x0, y1 - y0, x0, y0, 1)
    a = np.clip(gaussian_filter(m, 1.0), 0, 1)
    a = np.where(m > 0.5, np.maximum(a, (gaussian_filter(m, 1.0) > 0.5)), a)
    base = C[y0:y1, x0:x1].astype(np.float32)
    if r.get("ground"):
        G = card(np.asarray(Image.open("../onepass/work/groundA2-top.png").convert("RGB")))[y0:y1, x0:x1].astype(np.float32)
        d = np.abs(gaussian_filter(q, (1.5, 1.5, 0)) - gaussian_filter(G, (1.5, 1.5, 0))).max(-1)
        f = np.clip((d - 22) / 30, 0, 1)
        q = G * (1 - f[..., None]) + q * f[..., None]
    Cn = C.astype(np.float32).copy()
    Cn[y0:y1, x0:x1] = base * (1 - a[..., None]) + q * a[..., None]
    newtop = np.round(np.clip(Cn[:SEAM], 0, 255)).astype(np.uint8)
    Image.fromarray(newtop).save(out)
    print(out, "changed px", int((newtop != top).any(-1).sum()))
