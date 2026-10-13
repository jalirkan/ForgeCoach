# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4, second pass: prepare a 3.2x crop for the low-strength repaint. At 0.30-0.42 the model keeps
# the init's blur (the drafts' hands and faces are soft at 3.2x), so the init is first sharpened -- an unsharp mask,
# which only steepens edges the draft already drew -- and, for face 3, the one malformed shape (the black blot under
# the nose) is lifted halfway toward the skin around it, so the repaint draws a nostril shadow instead of copying it.
#   prep.py <in.png> <out.png> [--blot cx cy rx ry]
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter
im = Image.open(sys.argv[1]).convert("RGB").filter(ImageFilter.UnsharpMask(radius=5, percent=150, threshold=2))
if "--blot" in sys.argv:
    k = sys.argv.index("--blot"); cx, cy, rx, ry = map(float, sys.argv[k + 1:k + 5])
    a = np.asarray(im, np.float32); h, w = a.shape[:2]; yy, xx = np.mgrid[0:h, 0:w]
    r2 = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    ring = (r2 > 2.2) & (r2 < 4.0)
    skin = np.median(a[ring], 0)
    m = gaussian_filter((r2 < 1).astype(np.float32), min(rx, ry) / 2)[..., None] * 0.55
    a = a * (1 - m) + skin * m
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
im.save(sys.argv[2])
