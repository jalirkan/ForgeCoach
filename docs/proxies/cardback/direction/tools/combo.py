# SPDX-License-Identifier: GPL-3.0-or-later
# Binder: take the round-3 painting (good leather, glyph-like corners) and only the four cleaned fan corners
# from the round-4 pass, feathered. Usage: combo.py r3.png r4.png out.png
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), np.float32)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB"), np.float32)
h, w = a.shape[:2]
m = Image.new("L", (w, h), 0); d = ImageDraw.Draw(m)
for (x, y, s0) in ((150, 150, 0), (w - 150, 150, 90), (w - 150, h - 150, 180), (150, h - 150, 270)):
    d.pieslice([x - 150, y - 150, x + 150, y + 150], s0, s0 + 90, fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(5)), np.float32)[..., None] / 255
Image.fromarray((a * (1 - m) + b * m).astype(np.uint8)).save(sys.argv[3])
