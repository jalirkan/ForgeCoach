# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: take a tall painted flame off the table where it stands on the seam (the blue half).
# Mirrored about the seam a leaning flame becomes an X; the table's grain runs left to right, so the strip is
# refilled by interpolating each row between the wood either side, and compose3.py's bloom is the lamp's light.
# Usage: deflame.py <half.png> <out.png> x0 x1 y0      (the strip x0..x1, from y0 down to the seam)
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), np.float32).copy()
x0, x1, y0 = map(int, sys.argv[3:6])
L = a[y0:, x0 - 12:x0].mean(1, keepdims=True); R = a[y0:, x1:x1 + 12].mean(1, keepdims=True)
t = np.linspace(0, 1, x1 - x0)[None, :, None]
fill = L * (1 - t) + R * t
rng = np.random.default_rng(2)
fill = fill * (1 + 0.04 * gaussian_filter(rng.normal(0, 1, fill.shape[:2]), (1, 12))[..., None])   # a little grain
m = np.ones(fill.shape[:2], np.float32); m[:, :10] = np.linspace(0, 1, 10); m[:, -10:] = np.linspace(1, 0, 10)
m[:12] *= np.linspace(0, 1, 12)[:, None]
a[y0:, x0:x1] = a[y0:, x0:x1] * (1 - m[..., None]) + fill * m[..., None]
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(sys.argv[2])
