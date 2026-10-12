# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: the character's own outline (for the streaky variant): inside round 1's figure mask,
# everything that is not gold ground (hue 28-58, saturated, light), holes filled, specks opened away.
#   figmask.py <half.png> <out-mask.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes, binary_opening, binary_closing, binary_dilation, binary_erosion
src, out = sys.argv[1:3]
hsv = np.asarray(Image.open(src).convert("HSV"), np.float32)
H, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
gold = (H > 28) & (H < 58) & (S > 0.3) & (V > 0.45)
fig8 = np.asarray(Image.open("guides/mask-fig8.png").convert("L")) > 127
m = fig8 & ~gold
m = binary_opening(m, iterations=2)
m = binary_closing(m, iterations=3)
m = binary_fill_holes(m | binary_erosion(fig8, iterations=30))   # the interior is figure, ochre doublet included
m = binary_dilation(m, iterations=2) & fig8
Image.fromarray((m * 255).astype(np.uint8)).save(out)
print(out, int(m.sum()))
