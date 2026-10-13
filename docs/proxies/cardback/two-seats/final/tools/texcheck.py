# texcheck.py <tag> <work.npy>: texture numbers on the cloak where the retouch filled (ms > 0.6) vs where it did not
import sys, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, binary_erosion, binary_dilation
t, f = sys.argv[1], sys.argv[2]; N = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}[t]
yy, xx = np.mgrid[0:1050, 0:1500]
dm = np.asarray(Image.open(f"../round7/comp/dm-{t}.png").convert("L"))[:1050] > 0
dm[944:] = False; dm[((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1] = False
HF = np.maximum(np.asarray(Image.open(f"../round7/comp/m-hand-{t}.png").convert("L"))[:1050],
                np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"))[:1050]) > 8
pm = np.asarray(Image.open(f"../round8/final/two-seats-{N}-propmask.png").convert("L"))[:1050] > 0
cloak = binary_erosion(dm & ~binary_dilation(HF | pm, iterations=6), iterations=6)
ms = np.load(f.replace(".npy", "-ms.npy"))
l = np.load(f) @ np.array([.2126, .7152, .0722], np.float32)
def meas(m):
    r = {}
    for k, (s0, s1) in {"fine": (0, 1), "mid": (1, 3), "coarse": (3, 8)}.items():
        b = (gaussian_filter(l, s0) if s0 else l) - gaussian_filter(l, s1)
        r[k] = round(float(np.median(np.sqrt(uniform_filter(b * b, 16))[m])), 2)
    return r
print(t, "not filled", meas(cloak & binary_erosion(ms < 0.02, iterations=4)), "filled", meas(cloak & binary_erosion(ms > 0.6, iterations=2)))
