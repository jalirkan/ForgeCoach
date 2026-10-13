# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1: the final's black-point lift, once, on the whole card, and the print files.
#   lift1.py <composed A.png> <outdir>
# The lift is the final's (fc-lanes two-seats-final, 479e5f6), reproduced exactly: with L the Rec. 709 luminance,
# every channel gets + 24 * (1 - L/56)^2 where L < 56, truncated to an integer (0 -> 24, unchanged from 56 up).
# This rule turns the final's c9022be PNG into its 479e5f6 PNG with 0 pixels different (checked).
import sys, os
import numpy as np
from PIL import Image
src, od = sys.argv[1:3]
u = np.asarray(Image.open(src).convert("RGB"))
L = u.astype(np.float32) @ np.array([.2126, .7152, .0722], np.float32)
d = np.where(L < 56, 24 * (1 - L / 56) ** 2, 0)
o = np.clip(u.astype(np.float32) + d[..., None], 0, 255).astype(np.uint8)
assert o.shape == (2100, 1500, 3) and np.array_equal(o, o[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(o)
os.makedirs(od, exist_ok=True)
im.save(f"{od}/two-seats-garnet-man.png", dpi=(600, 600))
im.save(f"{od}/two-seats-garnet-man.jpg", quality=95, dpi=(600, 600), subsampling=0)
print("ok", os.path.getsize(f"{od}/two-seats-garnet-man.png"), os.path.getsize(f"{od}/two-seats-garnet-man.jpg"))
