# SPDX-License-Identifier: GPL-3.0-or-later
# contact sheet of torso candidates: look9.py <tag> <out> <file>...   (each shown half size, and its hands at 1:1)
import sys
from PIL import Image
t, out, fs = sys.argv[1], sys.argv[2], sys.argv[3:]
box = (418, 294, 812, 718)
W = 608; H = 392; hw, hh = box[2] - box[0], box[3] - box[1]
S = Image.new("RGB", (W + hw, (H if H > hh else hh) * len(fs)), "white")
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB")
    S.paste(im.resize((W, H)), (0, i * max(H, hh))); S.paste(im.crop(box), (W, i * max(H, hh)))
S.save(out)
