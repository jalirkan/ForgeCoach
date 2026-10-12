# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): a painted top half -> the whole double-ended sleeve art, 1500x2100 at 600 dpi.
#   - the half is resized to 1500x1052 and its bottom edge (y = 1050) is the seam;
#   - the code-drawn tooled gold is laid back over the painted ground outside the figure (feathered), with a
#     share of the painted gold kept so the two agree (GOLD_KEEP);
#   - the bottom half is the top half turned 180 degrees; the 10 rows above the seam ease to a left-right
#     average so the seam is continuous (under the lamp's gilt band and the table);
#   - print: chroma above 140 compressed toward grey (no neon), shadows lifted so the darkest 0.5 mm areas sit
#     at RGB >= 22, then the 180-degree symmetry is re-checked to the last pixel.
# Usage: compose.py <workdir> <half.png> <out.png> [--gold 0.65] [--nogold]
import argparse, os
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, binary_dilation

ap = argparse.ArgumentParser()
ap.add_argument("wd"); ap.add_argument("half"); ap.add_argument("out")
ap.add_argument("--gold", type=float, default=0.65, help="share of the code-drawn gold over the painted ground")
ap.add_argument("--sharpen", type=float, default=40)
ap.add_argument("--keep", default=None, help="a half to take the face and the hands from (the lit, pre-unify half)")
ap.add_argument("--jpeg", action="store_true", help="also write <out>.jpg at quality 95")
a_ = ap.parse_args()
FW, FH, SEAM, HH = 1500, 2100, 1050, 1052
G = os.path.join(a_.wd, "guides")

half = Image.open(a_.half).convert("RGB")
if half.size != (FW, HH):
    half = half.resize((FW, HH), Image.LANCZOS)
h = np.asarray(half, np.float32)
yy, xx = np.mgrid[0:HH, 0:FW].astype(np.float32)
if a_.keep:
    # the unifying pass softens the high-resolution face and hands: take them back from the lit half
    k = np.asarray(Image.open(a_.keep).convert("RGB").resize((FW, HH), Image.LANCZOS), np.float32)
    face = (((xx - 750) / 120) ** 2 + ((yy - 455) / 150) ** 2 < 1).astype(np.float32)
    hands = np.zeros_like(face); hands[800:955, 600:930] = 1
    m = gaussian_filter(np.maximum(face, hands), 14)[..., None]
    h = h * (1 - m) + k * m
if a_.gold > 0:
    gold = np.asarray(Image.open(os.path.join(G, "gold-full.png")).convert("RGB"), np.float32)[:HH]
    # the guide's lamp light on the gold, so the laid-back ground is lit as the painting is
    lit = np.asarray(Image.open(os.path.join(G, "gold-lit.png")).convert("RGB"), np.float32)[:HH] if os.path.exists(os.path.join(G, "gold-lit.png")) else gold
    fig = np.asarray(Image.open(os.path.join(G, "mask-figure.png")), np.float32) / 255
    tab = np.asarray(Image.open(os.path.join(G, "mask-table.png")), np.float32) / 255
    lamp = np.asarray(Image.open(os.path.join(G, "mask-lamp.png")), np.float32) / 255
    keep = np.clip(fig + tab + lamp, 0, 1) > 0.02
    keep = binary_dilation(keep, iterations=10)
    m = 1 - gaussian_filter(keep.astype(np.float32), 5)
    m = (m * a_.gold)[..., None]
    h = h * (1 - m) + lit * m
# the seam: row SEAM-1 meets its own left-right mirror (row SEAM is row SEAM-1 turned), so the last rows
# above the seam ease toward their left-right average; that strip lies under the lamp's gilt band and the table
top = h[:SEAM].copy()
# the frame's side bands cross the seam and must meet their turned twins: below its top band (y > 200) the
# right-hand side zone (x > 1240) becomes the mirror of the left-hand one, so the frame is mirror-symmetric
# left to right and, turned, each side band continues into itself (a band averaged with a different band
# ghosts; a band mirrored onto itself does not). The model darkens the last rows of any image it paints, so in
# the side zones the 16 rows above the seam are first replaced by the reflection of the 16 above them.
side = np.zeros(FW, np.float32); side[:260] = 1; side[1240:] = 1
side = gaussian_filter(side, 6)[None, :, None]
refl = top[SEAM - 32:SEAM - 16][::-1]
top[SEAM - 16:SEAM] = top[SEAM - 16:SEAM] * (1 - side[0]) + refl * side[0]
right = np.zeros(FW, np.float32); right[1240:] = 1
right = gaussian_filter(right, 6)
vr = np.clip((np.arange(SEAM) - 200) / 60, 0, 1)
mr = (vr[:, None] * right[None, :])[..., None]
top = top * (1 - mr) + top[:, ::-1] * mr
K_ = 10
for i in range(K_):
    y = SEAM - K_ + i; w = ((i + 1) / K_) ** 1.5
    top[y] = top[y] * (1 - w) + (top[y] + top[y][::-1]) / 2 * w
full = np.concatenate([top, top[::-1, ::-1]], 0)
im = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8))
if a_.sharpen:
    im = im.filter(ImageFilter.UnsharpMask(radius=2.0, percent=int(a_.sharpen), threshold=2))
a = np.asarray(im, np.float32)
CMAX = 140.0
mx, mn = a.max(-1, keepdims=True), a.min(-1, keepdims=True); ch = mx - mn
target = np.where(ch > CMAX, CMAX + (ch - CMAX) * 0.35, ch)
grey = a.mean(-1, keepdims=True)
a = grey + (a - grey) * np.where(ch > 0, target / np.maximum(ch, 1e-6), 1.0)


def dark_stats(a):
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    big = gaussian_filter(lum, 12)                     # ~0.5 mm at 600 dpi
    return float(np.percentile(big, 0.5)), float(np.percentile(big, 5)), float(lum.min())


before = dark_stats(a)
FLOOR = 22.0
if before[0] < FLOOR:
    a = a + (FLOOR - before[0]) * np.clip(1 - a / 70.0, 0, 1)
# exact symmetry: the seam blend and the sharpen are symmetric operations up to rounding; force it
a = np.clip(a, 0, 255)
top = a[:SEAM]
a[SEAM:] = top[::-1, ::-1][: FH - SEAM]
after = dark_stats(a)
out = Image.fromarray(np.round(a).astype(np.uint8))
assert np.array_equal(np.asarray(out), np.asarray(out)[::-1, ::-1]), "not 180-degree symmetric"
out.save(a_.out, dpi=(600, 600))
if a_.jpeg:
    out.save(a_.out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
hsv = np.asarray(out.convert("HSV"), np.float32)
sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
print(f"{os.path.basename(a_.out)}: dark0.5%={before[0]:.1f}->{after[0]:.1f} 5%={after[1]:.1f} min={after[2]:.0f} sat99.5={sat:.0f} symmetric=yes")
