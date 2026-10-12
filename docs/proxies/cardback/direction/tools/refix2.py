# SPDX-License-Identifier: GPL-3.0-or-later
# Binder corners: put the guide's fan corner piece back over a raw whose corners drifted into glyph-like
# arabesques, mirrored to all four corners, for another light integration pass. Usage: refix2.py raw guide out
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, guide, dst = sys.argv[1:4]
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
g = np.asarray(Image.open(guide).convert("RGB"), np.float32)
h, w = a.shape[:2]
m = Image.new("L", (w, h), 0)
ImageDraw.Draw(m).pieslice([150 - 142, 150 - 142, 150 + 142, 150 + 142], 0, 90, fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255
# match the guide's leather to the painted leather so only the gold drawing carries over
gl = np.median(g[200:300, 300:400].reshape(-1, 3), 0); al = np.median(a[200:300, 300:400].reshape(-1, 3), 0)
g = np.clip(g + (al - gl), 0, 255)
a = a * (1 - m) + g * m
q = a[: h // 2, : w // 2]
top = np.concatenate([q, q[:, ::-1]], 1); a = np.concatenate([top, top[::-1]], 0)
Image.fromarray(a.astype(np.uint8)).save(dst)
