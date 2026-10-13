# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1 revision: the repainted hands laid into the painted robe, and the hands-to-face match.
#   hands1.py paste <robe torso.png> <hands painting.png> <out torso.png>
#   hands1.py measure <torso.png>... (prints each one's hand numbers beside the face's)   (run in two-seats-work/order1)
# The hand crop is round 8's drawn torso (comp/torso-in-garnet.png, 1216 x 784) at x 392-808, y 464-720, painted at
# 3x (1248 x 768). It goes back at 416 x 256 (Lanczos) through round 7's drawn hand mask (m-hand-garnet, card
# coords, brought to torso coords), grown 3 px and feathered 1.5 px. Nothing else is written: no blur, no grain.
# The match is measured at card scale (the torso box resized to 744 x 480 exactly as torso1.py does), on skin pixels
# (hue 8-50 deg, saturation > 0.12, value > 0.30) of the hand mask and of the face ellipse, each eroded 3 px:
#   contrast = mean over those pixels of the luminance std in 8 x 8 windows
#   edge     = 99th percentile of the luminance gradient magnitude (np.gradient, no blur)
#   hue, sat = medians of the skin's HSV hue (degrees) and saturation
#   distance = |dcontrast|/face + |dedge|/face + |dhue|/30 + |dsat|/face
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, binary_dilation, binary_erosion, gaussian_filter
TORSO = (384, 480, 1128, 960); CROP = (392, 464, 808, 720)
K = np.array([.2126, .7152, .0722], np.float32)
mc = Image.open("../round7/comp/m-hand-garnet.png").convert("L")
def hand_mask_torso():
    return np.asarray(mc.crop(TORSO).resize((1216, 784), Image.BILINEAR), np.float32) / 255
def skin(rgb):
    hsv = np.asarray(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("HSV"), np.float32)
    H, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    return (H > 8) & (H < 50) & (S > 0.12) & (V > 0.30), H, S
def numbers(rgb, region):
    sk, H, S = skin(rgb)
    m = binary_erosion(region & sk, iterations=3)
    L = rgb.astype(np.float32) @ K
    sd = np.sqrt(np.maximum(uniform_filter(L * L, 8) - uniform_filter(L, 8) ** 2, 0))
    g = np.hypot(*np.gradient(L))
    return {"px": int(m.sum()), "contrast": round(float(sd[m].mean()), 2), "edge": round(float(np.percentile(g[m], 99)), 2),
            "hue": round(float(np.median(H[m])), 1), "sat": round(float(np.median(S[m])), 3)}
def face_numbers():
    U = np.asarray(Image.open("work/final-unlifted-garnet.png").convert("RGB"), np.float32)
    yy, xx = np.mgrid[0:U.shape[0], 0:U.shape[1]]
    face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
    return numbers(U, face)
def hand_numbers(torso_png):
    t = Image.open(torso_png).convert("RGB").resize((TORSO[2] - TORSO[0], TORSO[3] - TORSO[1]), Image.LANCZOS)
    m = np.asarray(mc.crop(TORSO), np.uint8) > 128
    return numbers(np.asarray(t, np.float32), m)
def distance(h, f):
    return round(abs(h["contrast"] - f["contrast"]) / f["contrast"] + abs(h["edge"] - f["edge"]) / f["edge"]
                 + abs(h["hue"] - f["hue"]) / 30 + abs(h["sat"] - f["sat"]) / f["sat"], 3)
if sys.argv[1] == "paste":
    robe, hands, out = sys.argv[2:5]
    R = np.asarray(Image.open(robe).convert("RGB"), np.float32)
    x0, y0, x1, y1 = CROP
    P = np.asarray(Image.open(hands).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    m = hand_mask_torso() > 0.5
    a = np.clip(gaussian_filter(binary_dilation(m, iterations=3).astype(np.float32), 1.5) * 1.5, 0, 1)
    a[:y0] = 0; a[y1:] = 0; a[:, :x0] = 0; a[:, x1:] = 0
    full = R.copy(); full[y0:y1, x0:x1] = P
    o = R * (1 - a[..., None]) + full * a[..., None]
    Image.fromarray(np.round(np.clip(o, 0, 255)).astype(np.uint8)).save(out)
    print("pasted", out, int((a > 0).sum()), "px")
else:
    f = face_numbers(); res = {"face": f}
    for p in sys.argv[2:]:
        h = hand_numbers(p); h["distance"] = distance(h, f); res[p] = h
    print(json.dumps(res, indent=1))
