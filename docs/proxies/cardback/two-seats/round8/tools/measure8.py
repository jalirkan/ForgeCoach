# SPDX-License-Identifier: GPL-3.0-or-later
# texture measurement: band-pass luminance std (median over 16x16 windows) in the painted hood/cape vs the drawn torso
import sys, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, binary_erosion
img, dm = sys.argv[1:3]
a = np.asarray(Image.open(img).convert("RGB"), np.float32)[:1050]
lum = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
D = np.asarray(Image.open(dm).convert("L"), np.float32)[:1050] > 0.5
fig = np.asarray(Image.open(sys.argv[3]).convert("L"))[:1050] > 8
yy, xx = np.mgrid[0:1050, 0:1500]
face = ((xx-750)/115)**2+((yy-405)/145)**2 < 1.3
hood = fig & ~D & ~face & (yy < 940)
drawn = D & (yy < 940)
# flat-ish areas only: exclude strong edges (outline/fold lines)
gm = np.hypot(*np.gradient(gaussian_filter(lum, 1.5)))
flat = gm < 4
for nm, (s0, s1) in {"fine 0-1": (0, 1), "mid 1-3": (1, 3), "coarse 3-8": (3, 8)}.items():
    b = (gaussian_filter(lum, s0) if s0 else lum) - gaussian_filter(lum, s1)
    v = np.sqrt(uniform_filter(b*b, 16))
    for rn, r in (("hood", hood), ("drawn", drawn)):
        m = binary_erosion(r, iterations=6) & flat
        print(f"{nm:10s} {rn:6s} median std {np.median(v[m]):.2f}  (n={m.sum()})")
