# SPDX-License-Identifier: GPL-3.0-or-later
# margins.py: every element of the three finals and its distance from the nearest card edge (px at 600 dpi, and mm)
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
F = "/home/justin-a/code/fc-lanes/two-seats-final/docs/proxies/cardback/two-seats/final"
T = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}
mm = lambda p: p / 600 * 25.4
rows = []
def edge(name, x0, y0, x1, y1, note=""):
    d = min(x0, y0, 1499 - x1, 2099 - y1 if y1 > 1049 else y0)    # a top-half element's nearest edge is top/left/right
    d = min(x0, y0 if y1 <= 1049 else 2099 - y1, 1499 - x1)
    rows.append((name, (x0, y0, x1, y1), d, note))
im = np.asarray(Image.open(f"{F}/two-seats-blue-man.png").convert("RGB"), np.float32)
l = gaussian_filter(im @ np.array([.2126, .7152, .0722], np.float32), 0.6)
# the frame, read off the art: the dark bevel line, the floral band and the inner gilt fillet (columns at y 600-1000,
# rows at x 400-1100, so the corners do not count)
colp = np.median(l[600:1000, :300], 0); rowp = np.median(l[:300, 400:1100], 1)
dark_c = [x for x in range(300) if colp[x] < 100]; dark_r = [y for y in range(300) if rowp[y] < 100]
print("dark columns (x<300):", dark_c); print("dark rows (y<300):", dark_r)
for t, n in T.items():
    fig = np.asarray(Image.open(f"../round6/comp/figm-{t}.png").convert("L"))[:1050] > 8
    ys, xs = np.nonzero(fig)
    rows.append((f"{n}: hood top", None, int(ys.min()), "the top of the hood, top seat (the bottom seat mirrors it)"))
    edge(f"{n}: figure, hood to cloak (sides)", int(xs.min()), int(ys.min()), int(xs.max()), 943)
    for k in ("hand", "fan"):
        m = np.asarray(Image.open(f"../round7/comp/m-{k}-{t}.png").convert("L"))[:1050] > 8
        ys, xs = np.nonzero(m); edge(f"{n}: {'hands' if k == 'hand' else 'fan of cards'}", int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    pm = np.asarray(Image.open(f"../round8/final/two-seats-{n}-propmask.png").convert("L"))[:1050] > 0
    for side, (a, b) in (("left prop", (0, 750)), ("right prop", (750, 1500))):
        ys, xs = np.nonzero(pm[:, a:b]); edge(f"{n}: {side}", int(xs.min()) + a, int(ys.min()), int(xs.max()) + a, int(ys.max()))
edge("lamp and its glow (160 px disc)", 590, 890, 910, 1210)
import json; json.dump({"rows": rows, "dark_c": dark_c, "dark_r": dark_r}, open("work/margins.json", "w"))
for r in rows:
    print(f"{r[0]:48s} {str(r[1]):26s} {r[2]:5d} px  {mm(r[2]):5.2f} mm  {'OK' if r[2] >= 110 else 'INSIDE 110'}")
