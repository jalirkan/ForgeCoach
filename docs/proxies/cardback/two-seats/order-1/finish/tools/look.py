# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish: a look sheet of a region's candidates at 2x (card px), the source first, labelled.
#   look.py <top.png> <region> <x0 y0 x1 y1 (view, card px)> <out.jpg> <painted.png>...
import sys, subprocess, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
top, reg = sys.argv[1:3]; vb = tuple(int(v) for v in sys.argv[3:7]); out = sys.argv[7]; ps = sys.argv[8:]
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
def view(t):
    a = np.asarray(Image.open(t).convert("RGB")); c = np.concatenate([a, a[::-1, ::-1]], 0)
    im = Image.fromarray(c).crop(vb); return im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
tiles = [("source", view(top))]
for p in ps:
    o = f"/tmp/look-{os.getpid()}.png"
    subprocess.run([sys.executable, f"{HERE}/fix.py", "paste", top, reg, p, o], check=True, capture_output=True)
    tiles.append((os.path.basename(p)[:-4], view(o))); os.remove(o)
w, h = tiles[0][1].size; n = len(tiles); cols = min(n, int(sys.argv[0] and os.environ.get("COLS", 4)))
rows = (n + cols - 1) // cols
S = Image.new("RGB", (cols * (w + 8), rows * (h + 30)), (230, 226, 218)); d = ImageDraw.Draw(S)
for i, (t, im) in enumerate(tiles):
    x, y = (i % cols) * (w + 8), (i // cols) * (h + 30)
    d.text((x + 4, y + 4), t, fill=(20, 20, 20), font=F); S.paste(im, (x, y + 28))
S.save(out, quality=92); print(out, S.size)
