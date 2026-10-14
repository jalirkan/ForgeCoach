# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 2 (the green woman): order 1's finish/tools/build.py with her pick's matte (work/pick-matte.npy)
# and the regions whose outline may move named in OUTLINE (hers).
# The Two Seats, order 1, finish: the repaired unlifted top half -> the print card.   build.py <top.png> <out.png>
# (run in ~/scenery-packs/two-seats-work/order1/finish). Exactly the one pass's last two steps (one-pass/tools/onepass.py):
#   the final's black-point lift, once, to the whole card: + 24 (1 - L/56)^2 below L 56;
#   the bottom seat is the top half turned 180 degrees (asserted).
# Also writes <out>-matte.npy for one-pass/tools/check2.py: the one pass's figure matte, re-decided inside the masks of
# the regions whose outline may have moved (robe edge, shoulders) by the one pass's own rule (max channel distance
# from Ground A2 at 1.5 px smoothing, figure at >= 37 levels).
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
SEAM = 1050
src, out = sys.argv[1:3]
top = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
L = top @ np.array([.2126, .7152, .0722], np.float32)
dd = np.where(L < 56, 24 * (1 - L / 56) ** 2, 0)
lt = np.clip(np.round(top + dd[..., None]), 0, 255).astype(np.uint8)
full = np.concatenate([lt, lt[::-1, ::-1]], 0)
assert full.shape == (2100, 1500, 3) and np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(full); im.save(out, dpi=(600, 600))
im.save(out.replace(".png", ".jpg"), quality=95, dpi=(600, 600), subsampling=0)
m = np.load("work/pick-matte.npy").astype(np.float32)
G = np.asarray(Image.open("../onepass/work/groundA2-top.png").convert("RGB"), np.float32)
d = np.abs(gaussian_filter(top, (1.5, 1.5, 0)) - gaussian_filter(G, (1.5, 1.5, 0))).max(-1)
REG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "regions.json")))
OUTLINE = json.loads(os.environ.get("OUTLINE", "[]"))
for k in OUTLINE:
    r = REG[k]; mk = Image.new("L", (1500, SEAM), 0); dr = ImageDraw.Draw(mk)
    for p in r.get("poly", []): dr.polygon([tuple(q) for q in p], fill=255)
    for e in r.get("ellipse", []): dr.ellipse(e, fill=255)
    mk = np.asarray(mk) > 0
    m[mk] = (d[mk] >= 37).astype(np.float32)
m[944:] = 0
np.save(out.replace(".png", "-matte.npy"), m.astype(np.float16))
print(out, os.path.getsize(out.replace(".png", ".jpg")), "bytes jpg")
