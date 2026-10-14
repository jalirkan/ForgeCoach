# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, one pass: the print checks on a full card.   check2.py <card.png>...   (prints JSON)
# (run in two-seats-work/order1/onepass; the card's matte is <card>-matte.npy, written by onepass.py)
#   symmetry       the card equals itself turned 180 degrees, pixel for pixel
#   darks          the darkest 0.5 mm (12 x 12 px box at 600 dpi) mean luma, whole card and inside the figure;
#                  the rule: >= 24 (the black-point lift makes 24 the floor of every pixel)
#   sat x value    HSV saturation x value / 255, max and 99.5th pct, whole card and the figure; the rule: <= 150
#   field          Ground A2's visible field: brightest-channel mean (~160) and max (<= 225)
#   margins        the figure, the props and the lamp from the nearest trimmed edge, px; the rule: >= 110
#   cards          the fan's dark faces (dark, low-saturation, bluish-grey pixels in the hands' box, opened), and on them
#                  bright specks (brighter than their 9 x 9 median by > 30 levels) clustered; a pip, a letter or a
#                  mark would be such a cluster. The 200% look is in CHARACTERS-TOP3.jpg.
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, median_filter, binary_opening, binary_erosion, binary_dilation, label

SEAM, HW, TABLE = 1050, 1500, 944
K = np.array([.2126, .7152, .0722], np.float32)
yy, xx = np.mgrid[0:SEAM, 0:HW]
pm = np.asarray(Image.open("../../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
out = {}
for p in sys.argv[1:]:
    N = np.asarray(Image.open(p).convert("RGB"))
    m = np.load(p.replace(".png", "-matte.npy")).astype(np.float32) > 0.5
    c = {"size": list(N.shape[:2][::-1]), "dpi": Image.open(p).info.get("dpi")}
    c["symmetry_180_exact"] = bool(np.array_equal(N, N[::-1, ::-1]))
    L = N.astype(np.float32) @ K; box = uniform_filter(L, 12)
    c["darkest 0.5 mm, whole card"] = round(float(box[6:-6, 6:-6].min()), 1)
    c["darkest 0.5 mm, figure"] = round(float(box[:SEAM][binary_erosion(m, iterations=6)].min()), 1)
    c["darkest pixel luma"] = round(float(L.min()), 1)
    hsv = np.asarray(Image.fromarray(N).convert("HSV"), np.float32); sv = hsv[..., 1] * hsv[..., 2] / 255
    c["sat x value max / p99.5, whole card"] = [round(float(sv.max()), 1), round(float(np.percentile(sv, 99.5)), 1)]
    c["sat x value max / p99.5, figure"] = [round(float(sv[:SEAM][m].max()), 1), round(float(np.percentile(sv[:SEAM][m], 99.5)), 1)]
    inset = np.minimum(np.minimum(xx, HW - 1 - xx), yy)
    field = ~binary_dilation(m, iterations=3) & (yy < TABLE) & (inset >= 127) & ~pm
    V = N[:SEAM].max(-1)
    c["field brightest-channel mean / max"] = [round(float(V[field].mean()), 1), int(V[field].max())]
    ys, xs = np.nonzero(m)
    c["margins px"] = {"figure: top, left, right": [int(ys.min()), int(xs.min()), int(HW - 1 - xs.max())],
                       "props: left, right": [int(np.nonzero(pm[:, :750])[1].min()), int(HW - 1 - (np.nonzero(pm[:, 750:])[1].max() + 750))],
                       "lamp (160 px disc on the centre line)": 590,
                       "rule": "the trim edge to the moulding is the frame, by design; the field's content starts at 127"}
    c["margins >= 110"] = bool(min(ys.min(), xs.min(), HW - 1 - xs.max()) >= 110)
    # the cards: dark faces of the fan
    hb = (xx > 560) & (xx < 940) & (yy > 640) & (yy < 900)
    Hh, S_, V_ = hsv[:SEAM, :, 0] * 360 / 255, hsv[:SEAM, :, 1] / 255, hsv[:SEAM, :, 2] / 255
    face = hb & m & (V_ < 0.62) & ((S_ < 0.35) | ((Hh > 180) & (Hh < 260)))
    face = binary_opening(face, iterations=3)
    lab, n = label(face); sz = np.bincount(lab.ravel()); sz[0] = 0
    face = np.isin(lab, np.nonzero(sz > 1500)[0])
    Lt = L[:SEAM]
    dark = binary_erosion(face, iterations=3)
    spk = dark & (Lt - median_filter(Lt, 9) > 30)
    lab2, n2 = label(binary_dilation(spk, iterations=1))
    c["cards: dark face px / specks (clusters, px)"] = [int(dark.sum()), int(n2), int(spk.sum())]
    out[p] = c
print(json.dumps(out, indent=1))
