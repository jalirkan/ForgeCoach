# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: one painted half -> the whole double-ended sleeve art, 1500x2100 at 600 dpi.
#   - the half is resized to 1500x1050; its bottom edge (y = 1050) is the seam, the lamp centred on it;
#   - the lamp: inside a disc round the seam's centre the half is blended to its own left-right mirror, so the
#     lamp is symmetric and, turned 180 degrees, its lower half is its upper half's continuation;
#   - the seam: the last SEAM_K rows ease to their left-right average, so the table's two halves meet;
#   - the border: a thin band (BORDER px, bleeding to the cut) in the character's darkened colour with a
#     fine gilt fillet, drawn on the three outer sides of the half (so all four of the whole);
#   - print: chroma above 140 compressed toward grey, shadows lifted so the darkest 0.5 mm areas sit at
#     RGB >= 22, then exact 180-degree symmetry asserted to the last pixel.
# Usage: compose3.py <half.png> <out.png> --border R,G,B [--lamp-r 150] [--jpeg]
import argparse, os
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter
ap = argparse.ArgumentParser()
ap.add_argument("half"); ap.add_argument("out")
ap.add_argument("--border", default="70,28,24"); ap.add_argument("--bw", type=int, default=50)
ap.add_argument("--lamp-r", type=float, default=150); ap.add_argument("--lamp-x", type=float, default=750)
ap.add_argument("--seam-k", type=int, default=28)
ap.add_argument("--soften", type=float, default=0, help="radius round the seam's centre inside which the painted flame is melted into a glow first")
ap.add_argument("--core", type=float, default=0, help="radius of the lamp flame's bloom on the seam (0 = none)")
ap.add_argument("--jpeg", action="store_true")
a_ = ap.parse_args()
FW, FH, SEAM = 1500, 2100, 1050
h = np.asarray(Image.open(a_.half).convert("RGB").resize((FW, SEAM), Image.LANCZOS), np.float32).copy()
yy, xx = np.mgrid[0:SEAM, 0:FW].astype(np.float32)
# if the painted lamp sits a few px off centre, shift the bottom band sideways so it is centred
dx = int(round(750 - a_.lamp_x))
if dx:
    band = np.clip((yy - (SEAM - a_.lamp_r * 1.6)) / (a_.lamp_r * 0.5), 0, 1)[..., None]
    h = h * (1 - band) + np.roll(h, dx, axis=1) * band
d = np.hypot(xx - 750, (yy - SEAM) * 0.9)
m = np.clip(1 - (d - a_.lamp_r) / (a_.lamp_r * 0.45), 0, 1) ** 1.5
h = h * (1 - m[..., None]) + ((h + h[:, ::-1]) / 2) * m[..., None]   # inside the disc: the half's mirror average
# the flame's bloom: a flame cut by the seam turns into a double-ended flame, so the lamp's heart is a bloom
# of warm light centred on the seam, as a flame looks through a glass chimney -- round, and the same both ways up
if a_.soften > 0:   # a painted flame mirrored about the seam makes an X: melt it into its own glow first
    r = np.hypot(xx - 750, (yy - SEAM) * 0.8)
    w = np.clip(1 - r / a_.soften, 0, 1) ** 0.8
    h = h * (1 - w[..., None]) + gaussian_filter(h, (22, 22, 0)) * w[..., None]
if a_.core > 0:
    r = np.hypot(xx - 750, yy - SEAM)
    b = np.exp(-(r / a_.core) ** 2)[..., None]
    halo = np.exp(-(r / (a_.core * 3)) ** 2)[..., None]
    h = h + (np.array([255, 214, 150], np.float32) - h) * np.clip(halo * 0.35, 0, 1)
    h = h + (np.array([255, 246, 222], np.float32) - h) * np.clip(b * 1.1, 0, 1)
K = a_.seam_k
for i in range(K):
    y = SEAM - K + i; w = ((i + 1) / K) ** 1.6
    h[y] = h[y] * (1 - w) + (h[y] + h[y][::-1]) / 2 * w
# the border
bw = a_.bw; col = np.array([float(v) for v in a_.border.split(",")], np.float32)
rng = np.random.default_rng(3)
tex = gaussian_filter(rng.normal(0, 1, (SEAM, FW)), (8, 2))
tex = tex / (tex.std() + 1e-6)
dist = np.minimum(np.minimum(xx, FW - 1 - xx), yy)          # distance to the half's outer edges
band = col[None, None, :] * (1 + 0.10 * tex[..., None])
inner = np.clip((dist - bw) / 1.5 + 0.5, 0, 1)[..., None]      # 0 inside the band, 1 in the picture
fillet = np.exp(-((dist - (bw - 3)) / 1.6) ** 2)[..., None]   # a fine gilt line along the band's inner edge
shade = np.clip(dist / bw, 0, 1)[..., None]                   # the band darkens toward the cut
band = band * (0.75 + 0.25 * shade)
h = h * inner + band * (1 - inner)
h = h * (1 - 0.8 * fillet) + np.array([196, 156, 82], np.float32) * 0.8 * fillet
full = np.concatenate([h, h[::-1, ::-1]], 0)
im = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=2.0, percent=30, threshold=2))
a = np.asarray(im, np.float32)
CMAX = 140.0
mx, mn = a.max(-1, keepdims=True), a.min(-1, keepdims=True); ch = mx - mn
target = np.where(ch > CMAX, CMAX + (ch - CMAX) * 0.35, ch)
grey = a.mean(-1, keepdims=True)
a = grey + (a - grey) * np.where(ch > 0, target / np.maximum(ch, 1e-6), 1.0)
def dark_stats(a):
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    big = gaussian_filter(lum, 12)
    return float(np.percentile(big, 0.5)), float(np.percentile(big, 5)), float(lum.min()), float(big.min())
before = dark_stats(a)
for _ in range(4):                                  # lift the shadows until the darkest 0.5 mm area is >= 22
    s = dark_stats(a)[3]
    if s >= 22.3: break
    a = a + (22.6 - s) / max(1 - s / 70.0, 0.3) * np.clip(1 - a / 70.0, 0, 1)
a = np.clip(a, 0, 255)
a[SEAM:] = a[:SEAM][::-1, ::-1]
after = dark_stats(a)
out = Image.fromarray(np.round(a).astype(np.uint8))
o = np.asarray(out).astype(np.int16)
diff = int(np.abs(o - o[::-1, ::-1]).max())
assert diff == 0, "not 180-degree symmetric"
out.save(a_.out, dpi=(600, 600))
if a_.jpeg:
    out.save(a_.out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
hsv = np.asarray(out.convert("HSV"), np.float32)
sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
print(f"{os.path.basename(a_.out)}: dark(0.5mm areas) min {before[3]:.1f}->{after[3]:.1f} p0.5={after[0]:.1f} pixel-min={after[2]:.0f} "
      f"chroma(sat*val p99.5)={sat:.0f} symmetry max diff={diff}")
