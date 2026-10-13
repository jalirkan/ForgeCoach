# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4: a fixed draft (1632x2220, card-back geometry) -> the Dragon Shield standard sleeve final,
# 1500x2100 (5:7) at 600 dpi. Cover crop: the full height is kept and 23 px come off each side (1586 wide, centred),
# then Lanczos to 1500x2100. The bottom half is then rebuilt as the top half turned, so 180-degree symmetry is exact by
# construction (the resample can only break it by rounding). Darks and chroma are measured the drafts' own way and
# checked against the same crop of the untouched draft; where the crop leaves the darks under 22, the drafts' own
# shadow lift (post.py's) is applied.
#   finish.py <fixed.png> <draft.png> <out-stem>      -> <out-stem>.png, <out-stem>.jpg (q95)
import sys
import numpy as np
from PIL import Image, ImageFilter
FW, FH = 1500, 2100
def final(path):
    im = Image.open(path).convert("RGB"); W, H = im.size
    cw = round(H * 5 / 7); x0 = (W - cw) // 2
    assert W - cw - 2 * x0 == 0, "crop not centred to the pixel"
    a = np.asarray(im.crop((x0, 0, x0 + cw, H)).resize((FW, FH), Image.LANCZOS), np.float32)
    a[FH // 2:] = a[:FH // 2][::-1, ::-1]
    return np.clip(np.round(a), 0, 255).astype(np.uint8), x0, cw
def stats(a):   # the first drafts' own measures (direction/tools/post.py): darks after PIL GaussianBlur(12), ~0.5 mm
    f = a.astype(np.float32)
    lum = 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]
    lb = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(12)), np.float32)
    hsv = np.asarray(Image.fromarray(a).convert("HSV"), np.float32)
    return dict(dark05=float(np.percentile(lb, 0.5)), dark5=float(np.percentile(lb, 5)),
                chroma995=float(np.percentile(f.max(-1) - f.min(-1), 99.5)),
                sv995=float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5)))
FLOOR = 22.0
def lift(a):   # the drafts' own shadow lift (post.py): only the shadows, smoothly, so the darkest areas sit at ~22
    d = stats(a)["dark05"]
    if d >= FLOOR: return a, 0.0
    f = a.astype(np.float32); f = f + (FLOOR - d) * np.clip(1 - f / 70.0, 0, 1)
    return np.clip(np.round(f), 0, 255).astype(np.uint8), FLOOR - d
fx, x0, cw = final(sys.argv[1]); dr, _, _ = final(sys.argv[2])
sd = stats(dr); before = stats(fx)["dark05"]
for _ in range(4):                       # the lift is pointwise, so symmetry survives it; repeat until the floor holds
    fx, l = lift(fx)
    if l == 0: break
sf = stats(fx)
print(f"shadow lift: darks 0.5th pct {before:.1f} -> {sf['dark05']:.1f}" if sf['dark05'] != before else "shadow lift: none needed")
sym = int(np.abs(fx.astype(int) - fx[::-1, ::-1].astype(int)).max())
print(f"crop x {x0}..{x0 + cw} of the draft, scale {FW / cw:.4f}")
for k, v in (("fixed", sf), ("draft", sd)):
    print(f"{k}: darks 0.5th pct {v['dark05']:.1f}  5th {v['dark5']:.1f}  chroma(max-min) 99.5th {v['chroma995']:.0f}  S*V 99.5th {v['sv995']:.0f}")
assert sf["dark05"] >= FLOOR - 0.5 and sf["sv995"] <= sd["sv995"] + 1 and sf["chroma995"] <= sd["chroma995"] + 1
print(f"180-degree max pixel difference: {sym}")
assert sym == 0
Image.fromarray(fx).save(sys.argv[3] + ".png", dpi=(600, 600))
Image.fromarray(fx).save(sys.argv[3] + ".jpg", quality=95, subsampling=0, dpi=(600, 600))
