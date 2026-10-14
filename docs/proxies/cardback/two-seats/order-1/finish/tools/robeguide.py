# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish: the LAYOUT guide for the robe's left edge (fix 4). Not a repair by itself: the
# drawn block's square corner (it reads as a chair back) is cut away to Ground A2's leaf left of a sloping line from
# (476, 748) to (424, 900) to (415, 944), so the sleeve's outline falls as cloth; the inpaint then paints that edge
# (regions.json robeedge2, matted against Ground A2 as the one pass was).   robeguide.py <top.png> <out.png>
import sys
import numpy as np
from PIL import Image
top = np.asarray(Image.open(sys.argv[1]).convert("RGB")).copy()
G = np.asarray(Image.open("../onepass/work/groundA2-top.png").convert("RGB"))
pts = [(738, 480), (900, 424), (944, 415)]
for y in range(738, 944):
    (ya, xa), (yb, xb) = (pts[0], pts[1]) if y <= 900 else (pts[1], pts[2])
    xl = xa + (xb - xa) * (y - ya) / (yb - ya)
    xs = np.arange(400, int(round(xl)))
    top[y, xs] = G[y, xs]
Image.fromarray(top).save(sys.argv[2]); print(sys.argv[2])
