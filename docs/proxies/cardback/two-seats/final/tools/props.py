# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, final: the three prop fixes, by hand in code (no model), on the retouched top half.
#   props.py <tag> <in.npy> <out.npy>
# green: the faint light haze above the cup's rim goes; the moulding and its dark under-line come back from version B
#        (round 2's pixels) over the strip above the rim.
# blue:  the drawn outline on the knocked cup's side and top goes: the cup's cream is carried to its edge and laid over
#        round 2's clean wood with a soft alpha, so no grey line or halo is left; the mouth, spill and shadow stay.
# garnet: the tankard reads cold and forgotten: its open top is painted in, a dull pale skin over dark ale, matte and
#        low-contrast, with no steam; and a faint ring is left on the wood where it stood before.
import sys, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, grey_closing, binary_dilation, binary_erosion
t, src, dst = sys.argv[1:4]
N = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}[t]
R9 = "/home/justin-a/code/fc-lanes/two-seats-r9/docs/proxies/cardback/two-seats/round9"
img = np.load(src).astype(np.float32)
B = np.asarray(Image.open(f"{R9}/two-seats-{N}-noprops.png").convert("RGB"), np.float32)[:1050]
def lum(x): return x @ np.array([.2126, .7152, .0722], np.float32)
yy, xx = np.mgrid[0:1050, 0:1500].astype(np.float32)
rng = np.random.default_rng(9301)
out = img.copy(); touched = np.zeros((1050, 1500), np.float32)

if t == "green":
    # the strip above the rim: rows 940-955 across the cup (x 950-1012), feathered over 2 px at the rim and the ends
    a = np.zeros((1050, 1500), np.float32)
    a[940:957, 948:1014] = 1
    a[955, :] *= 0.5; a[956, :] *= 0.15
    a = gaussian_filter(a, (0.01, 1.2)) * (yy >= 940) * (yy < 957)
    out = out * (1 - a[..., None]) + B * a[..., None]
    touched = np.maximum(touched, a)

if t == "blue":
    # the cup's top and right-hand end are re-edged: the cup's own cream, carried to its edge, laid over round 2's clean
    # wood (version B) with a soft alpha read from the cup's luminance, so the drawn grey outline and its halo go.
    # The open mouth (left), the spill and the shadow under the cup are left as painted.
    x0, y0, x1, y1 = 440, 955, 522, 1008
    sub = img[y0:y1, x0:x1]; Bs = B[y0:y1, x0:x1]
    l = lum(sub)
    body = binary_erosion(binary_dilation(gaussian_filter(l, 0.6) > 125, iterations=2), iterations=2)
    core = binary_erosion(body, iterations=2)
    sy, sx = np.mgrid[y0:y1, x0:x1]
    ring = binary_dilation(body, iterations=6) & ~core
    soft = np.clip((sx - 452) / 6, 0, 1) * np.clip((999 - sy) / 5, 0, 1)    # fades out at the mouth and the shadow
    den = gaussian_filter(core.astype(np.float32), 2.0) + 1e-6
    cup = np.stack([gaussian_filter(sub[..., k] * core, 2.0) / den for k in range(3)], -1)
    cup = np.where(core[..., None], sub, cup)
    al = gaussian_filter(np.clip((l - 105) / 50, 0, 1), 0.6)
    new = cup * al[..., None] + Bs * (1 - al[..., None])
    w = gaussian_filter(ring.astype(np.float32), 0.8) * ring * gaussian_filter(soft, 1.0)
    sub2 = sub * (1 - w[..., None]) + new * w[..., None]
    out[y0:y1, x0:x1] = sub2
    touched[y0:y1, x0:x1] = np.maximum(touched[y0:y1, x0:x1], w)

if t == "garnet":
    # the open top: an ellipse on the rim (the rim's front edge is the tankard's present top, y 929.5)
    cx, cy, rx, ry = 520.3, 932.6, 20.6, 3.6
    body = img[936:960, 503:537]
    pew = np.median(body.reshape(-1, 3), 0)                   # the pewter's own colour
    r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    inner = np.clip((0.86 - r) / 0.12 + 0.5, 0, 1)            # the drink's surface, antialiased
    lip = np.clip((1.0 - r) / 0.10 + 0.5, 0, 1) * (1 - inner)  # the pewter lip round it
    ale = np.array([50, 37, 25], np.float32)
    skin = np.array([124, 106, 74], np.float32)               # a dull, pale, cold skin: matte, warm, low saturation
    # the skin covers most of the surface, thinning toward the back edge, with a slow wrinkle and a fine mottle
    u = (xx - cx) / rx; v = (yy - cy) / ry
    cover = np.clip(0.88 - 0.62 * np.clip(-v, 0, 1) + 0.18 * np.sin(5.5 * u + 1.3) * np.cos(2.0 * v), 0, 1)
    mott = gaussian_filter(rng.normal(0, 1, (1050, 1500)), 0.9) * 6
    surf = ale * (1 - cover[..., None]) + skin * cover[..., None] + mott[..., None]
    surf = surf * (0.92 + 0.08 * np.clip(v, -1, 1))[..., None]    # a touch darker at the back, under the lip
    lipc = pew * (0.92 + 0.10 * np.clip(v, 0, 1))[..., None]       # the lip: the pewter, a touch of light at the front
    a_in = gaussian_filter(inner, 0.5); a_lip = gaussian_filter(lip, 0.5)
    out = out * (1 - a_in - a_lip)[..., None] + surf * a_in[..., None] + lipc * a_lip[..., None]
    touched = np.maximum(touched, np.clip(a_in + a_lip, 0, 1))
    # the ring on the wood, in front of where the tankard stands now: a faint, broken stain
    rcx, rcy, rrx, rry = 470.0, 1027.0, 17.0, 4.6
    rr = np.sqrt(((xx - rcx) / rrx) ** 2 + ((yy - rcy) / rry) ** 2)
    ang = np.arctan2((yy - rcy) / rry, (xx - rcx) / rrx)
    strength = 0.55 + 0.45 * np.cos(ang - 0.6) ** 2                  # uneven: fuller on one side, almost gone on the other
    strength *= np.clip(1.4 + np.cos(ang + 2.2) * 1.6, 0, 1)         # a gap where the ring broke
    prof = np.exp(-((rr - 1.0) / 0.11) ** 2) + 0.35 * np.exp(-((rr - 0.86) / 0.10) ** 2)
    shade = gaussian_filter(prof * strength, 0.7) * 0.16
    shade = shade * (np.abs(yy - rcy) < 12) * (np.abs(xx - rcx) < 26)
    out = out * (1 - shade)[..., None]
    touched = np.maximum(touched, np.clip(shade / 0.05, 0, 1))

np.save(dst, out); np.save(dst.replace(".npy", "-touched.npy"), touched)
Image.fromarray(np.round(np.clip(out, 0, 255)).astype(np.uint8)).save(dst.replace(".npy", ".png"))
print(t, "prop px touched", int((touched > 0.05).sum()))
