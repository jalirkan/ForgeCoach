# measure.py <tag> <a.png> [<b.png> ...]: compose9's texture numbers (band-pass luminance std, median of 16 px windows)
# on the cloak (round 7's drawn mask less hands, fan and props), and on the painted hood (the target)
import sys, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, binary_erosion, binary_dilation
t = sys.argv[1]; N = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}[t]
yy, xx = np.mgrid[0:1050, 0:1500]
dm = np.asarray(Image.open(f"../round7/comp/dm-{t}.png").convert("L"))[:1050] > 0
dm[944:] = False; dm[((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1] = False
fig6 = np.asarray(Image.open(f"../round6/comp/figm-{t}.png").convert("L"))[:1050] > 8
hood = fig6 & ~dm & ~(((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1.3) & (yy < 940)
HF = np.maximum(np.asarray(Image.open(f"../round7/comp/m-hand-{t}.png").convert("L"))[:1050],
                np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"))[:1050]) > 8
pm = np.asarray(Image.open(f"../round8/final/two-seats-{N}-propmask.png").convert("L"))[:1050] > 0
cloak = binary_erosion(dm & ~binary_dilation(HF | pm, iterations=6), iterations=6)
def lum(x): return x[..., :3] @ np.array([.2126, .7152, .0722], np.float32)
def meas(l, m):
    r = {}
    for k, (s0, s1) in {"fine": (0, 1), "mid": (1, 3), "coarse": (3, 8)}.items():
        b = (gaussian_filter(l, s0) if s0 else l) - gaussian_filter(l, s1)
        r[k] = round(float(np.median(np.sqrt(uniform_filter(b * b, 16))[m])), 2)
    return r
for i, f in enumerate(sys.argv[2:]):
    l = lum(np.asarray(Image.open(f).convert("RGB"), np.float32)[:1050])
    if i == 0:
        print(t, "hood", meas(l, binary_erosion(hood, iterations=6)))
    print(t, f.split("/")[-1], "cloak", meas(l, cloak))
