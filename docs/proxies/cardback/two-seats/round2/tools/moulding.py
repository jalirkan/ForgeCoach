# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: round 1's seven-card fan reached down over the table's gilt moulding (y 944-958), and
# its card tips stayed in round 1's finished half under the new, smaller hand. Under the hands (x 560-1000) the
# moulding is redrawn row by row from its clean stretches either side (x 380-550 and 1010-1180): a smooth fit
# across, which keeps the lamp's glow on it, plus a trace of grain. The lamp's finial (x 728-772, y >= 953) stays.
#   moulding.py <half.png> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
src, out = sys.argv[1:3]
h = np.asarray(Image.open(src).convert("RGB"), np.float32).copy()
Y0, Y1, X0, X1 = 945, 959, 530, 1030
xs = np.r_[360:530, 1030:1200].astype(np.float32)
xr = np.arange(X0, X1, dtype=np.float32)
rng = np.random.default_rng(3)
grain = gaussian_filter(rng.normal(0, 1, (Y1 - Y0, X1 - X0)), (0.4, 6)) * 2.0
new = np.zeros((Y1 - Y0, X1 - X0, 3), np.float32)
for i, y in enumerate(range(Y0, Y1)):
    for k in range(3):
        c = np.polyfit((xs - 750) / 300, h[y, xs.astype(int), k], 4)
        new[i, :, k] = np.polyval(c, (xr - 750) / 300) + grain[i]
yy, xx = np.mgrid[Y0:Y1, X0:X1]
keep = (xx >= 728) & (xx <= 772) & (yy >= 953)
w = np.minimum(np.clip((xx - X0) / 40, 0, 1), np.clip((X1 - 1 - xx) / 40, 0, 1)) * (~keep)
w = gaussian_filter(w.astype(np.float32), 0.8)[..., None]
h[Y0:Y1, X0:X1] = h[Y0:Y1, X0:X1] * (1 - w) + new * w
# the moulding's top edge (row 944): half the moulding's first row, darkened, half what sits above it
e = w[0]
h[Y0 - 1, X0:X1] = h[Y0 - 1, X0:X1] * (1 - e) + (0.6 * 0.85 * new[0] + 0.4 * h[Y0 - 2, X0:X1]) * e
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(out)
