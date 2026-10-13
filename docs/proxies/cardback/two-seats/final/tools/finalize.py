# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, final: the print files and their checks.
#   finalize.py <tag> <top.npy> <outdir>
# The top half (1500 x 1050) is turned 180 degrees for the bottom seat, pixel for pixel (asserted). Writes
# two-seats-<name>.png (600 dpi) and .jpg (quality 95, 4:4:4, 600 dpi), and <outdir>/../work/report-<tag>.json.
import sys, os, json, numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, binary_dilation
t, src, od = sys.argv[1:4]
N = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}[t]
R9 = "/home/justin-a/code/fc-lanes/two-seats-r9/docs/proxies/cardback/two-seats/round9"
r9 = np.asarray(Image.open(f"{R9}/two-seats-{N}-props.png").convert("RGB"))
top = np.round(np.clip(np.load(src), 0, 255)).astype(np.uint8)
full = np.concatenate([top, top[::-1, ::-1]], 0)
assert full.shape == (2100, 1500, 3) and np.array_equal(full, full[::-1, ::-1])
im = Image.fromarray(full)
png, jpg = f"{od}/two-seats-{N}.png", f"{od}/two-seats-{N}.jpg"
im.save(png, dpi=(600, 600)); im.save(jpg, quality=95, dpi=(600, 600), subsampling=0)
def lum(x): return x.astype(np.float32) @ np.array([.2126, .7152, .0722], np.float32)
def both(m): m = m[:1050]; return np.concatenate([m, m[::-1, ::-1]], 0)
yy, xx = np.mgrid[0:1050, 0:1500]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
dm = np.asarray(Image.open(f"../round7/comp/dm-{t}.png").convert("L"))[:1050] > 0
dm[944:] = False; dm[face] = False
fig6 = np.asarray(Image.open(f"../round6/comp/figm-{t}.png").convert("L"))[:1050] > 8
hf = np.maximum(np.asarray(Image.open(f"../round7/comp/m-hand-{t}.png").convert("L"))[:1050],
                np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"))[:1050]) > 8
fan = np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"))[:1050] > 8
pm = np.asarray(Image.open(f"../round8/final/two-seats-{N}-propmask.png").convert("L"))[:1050] > 0
inner = np.zeros((1050, 1500), bool); inner[210:, 222:1278] = True
fy, fx = np.mgrid[0:2100, 0:1500]
lamp = ((fx - 750) ** 2 + (fy - 1050) ** 2) < 160 ** 2
same = (full == r9).all(-1)
changed = ~same
reg = {
    "faces": both(face),
    "hoods and shoulder capes": both(fig6 & ~dm & ~face & (yy < 944)),
    "hands and fan (round 7's masks)": both(hf),
    "gold field outside the figure": both(inner & ~binary_dilation(fig6 | dm, iterations=12) & (yy < 944)),
    "border and frame": both(~inner & (yy < 944)),
    "lamp and glow (outside the cloak and props)": lamp & ~both(dm | binary_dilation(pm, iterations=30)),
}
c = {k: round(float(same[m].mean()) * 100, 3) for k, m in reg.items()}
c["pixels changed from round 9 (%)"] = round(float(changed.mean()) * 100, 2)
ys, xs = np.nonzero(changed[:1050]); c["changed box, top half (x0,y0,x1,y1)"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
la = lum(full)
box = uniform_filter(la, 12)                      # 0.5 mm at 600 dpi = 11.8 px
c["darkest 0.5 mm area (mean, min)"] = round(float(box[6:-6, 6:-6].min()), 1)
c["darkest 0.5 mm area, 0.5th percentile"] = round(float(np.percentile(box, 0.5)), 1)
c["darkest single pixel, changed region"] = round(float(la[changed].min()), 1) if changed.any() else None
c["darkest single pixel, whole card"] = round(float(la.min()), 1)
hsv = np.asarray(im.convert("HSV"), np.float32)
sv = hsv[..., 1] * hsv[..., 2] / 255
c["saturation x value, 99.5th pct"] = round(float(np.percentile(sv, 99.5)), 1)
c["saturation x value, max in changed region"] = round(float(sv[changed].max()), 1)
r9sv = np.asarray(Image.fromarray(r9).convert("HSV"), np.float32); r9sv = r9sv[..., 1] * r9sv[..., 2] / 255
c["saturation x value, 99.5th pct, round 9"] = round(float(np.percentile(r9sv, 99.5)), 1)
c["symmetry 180"] = "exact"
c["fan identical to round 9 (%)"] = round(float(same[both(fan)].mean()) * 100, 3)
c["jpeg bytes"] = os.path.getsize(jpg); c["png bytes"] = os.path.getsize(png)
os.makedirs("work", exist_ok=True)
json.dump(c, open(f"work/report-{t}.json", "w"), indent=1)
print(t, json.dumps(c))
