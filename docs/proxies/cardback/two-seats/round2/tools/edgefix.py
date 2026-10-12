# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: round 1's garnet cloak was a few px wider than the new green and blue cloaks, and the
# recolour missed its darkest, least saturated rim, so a red sliver showed along the cloak's outer edge. In a band
# just inside and outside the figure's outline (not the gown, not the table), red is turned to the cloak's own hue.
#   edgefix.py <half.png> <green|blue> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, binary_dilation, gaussian_filter
src, ch, out = sys.argv[1:4]
h = np.asarray(Image.open(src).convert("RGB"), np.float32)
fig = np.asarray(Image.open("guides/mask-fig8.png").convert("L")) > 127
band = binary_dilation(fig, iterations=14) & ~binary_erosion(fig, iterations=34)
yy, xx = np.mgrid[0:h.shape[0], 0:h.shape[1]]
from PIL import ImageDraw
gm = Image.new("L", (h.shape[1], h.shape[0]), 0)
ImageDraw.Draw(gm).polygon([(712, 585), (788, 585), (968, 760), (1030, 960), (470, 960), (532, 760)], fill=255)
gown = binary_dilation(np.asarray(gm) > 0, iterations=12)       # the gown's opening (prep.py), kept as painted
band &= ~gown
band &= (yy < 944) & (xx > 218) & (xx < 1282)
hsv = np.asarray(Image.fromarray(h.astype(np.uint8)).convert("HSV"), np.float32)
H_, S_, V_ = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
red = ((H_ > 315) | (H_ < 28)) & (S_ > 0.2) & band
cloak = band & ~red & (S_ > 0.25)
tgt = {"green": 158, "blue": 222}[ch]
cs, cv = np.median(S_[cloak]), np.median(V_[cloak])
hsv2 = np.stack([np.full_like(H_, tgt / 360 * 255), np.full_like(S_, cs * 255), np.minimum(V_ * 0.8, cv) * 255], -1).astype(np.uint8)
rgb2 = np.asarray(Image.fromarray(hsv2, "HSV").convert("RGB"), np.float32)
m = gaussian_filter(red.astype(np.float32), 1.0)[..., None]
Image.fromarray(np.clip(h * (1 - m) + rgb2 * m, 0, 255).astype(np.uint8)).save(out)
print(out, "red px fixed", int(red.sum()))
