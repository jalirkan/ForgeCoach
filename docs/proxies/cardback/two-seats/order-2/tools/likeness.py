# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 2: order 1's likeness.py (order-1/one-pass/tools/likeness.py) against the green woman's draft face
# (the final's unlifted pixels, ../work/final-unlifted-green.png; round 8's face is the same pixels, 0 differ). Same boxes:
# her face sits where his does (checked on round 8's file).
# The Two Seats, order 1, one pass: how much each candidate's face is still the draft's man.
#   likeness.py <card.png>...      (run in two-seats-work/order2/onepass; prints JSON, one entry per card)
# The reference is the draft's face as every round has carried it: the final's pixels before its lift
# (../work/final-unlifted-green.png; round 8's face is the same pixels, 0 differ), given the same black-point lift
# as the cards, so the lift cancels. The current order-1 print file scores 1.0 on all three by construction.
# Measures, on the face box FACE (the face, its hair line and the hood's inner edge), in grey (Rec. 709 luma):
#   ssim      structural similarity (skimage, gaussian window sigma 1.5) at full size
#   ssim_2x   the same at half size (the face's structure: eyes, brows, nose, mouth, jaw; less brushwork)
#   ssim_eyes the same at full size on the eyes and brows alone (EYES), where the look across the table lives
#   shift     the (dy, dx) px that best aligns the candidate's face to the draft's (phase correlation)
import sys, json
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim
from skimage.registration import phase_cross_correlation

FACE = (640, 265, 860, 545)
EYES = (655, 340, 845, 420)
K = np.array([.2126, .7152, .0722], np.float32)
def lifted(u):
    L = u @ K
    return np.clip(u + np.where(L < 56, 24 * (1 - L / 56) ** 2, 0)[..., None], 0, 255).astype(np.uint8).astype(np.float32)
ref = lifted(np.asarray(Image.open("../work/final-unlifted-green.png").convert("RGB"), np.float32)) @ K
def box(a, b): return a[b[1]:b[3], b[0]:b[2]]
def half(a): return np.asarray(Image.fromarray(a.astype(np.float32)).resize((a.shape[1] // 2, a.shape[0] // 2), Image.BILINEAR))
res = {}
for p in sys.argv[1:]:
    c = np.asarray(Image.open(p).convert("RGB"), np.float32) @ K
    r, f = box(ref, FACE), box(c, FACE)
    sh, _, _ = phase_cross_correlation(r, f, upsample_factor=4)
    res[p] = {"ssim": round(float(ssim(r, f, data_range=255, gaussian_weights=True, sigma=1.5)), 3),
              "ssim_2x": round(float(ssim(half(r), half(f), data_range=255, gaussian_weights=True, sigma=1.5)), 3),
              "ssim_eyes": round(float(ssim(box(ref, EYES), box(c, EYES), data_range=255, gaussian_weights=True, sigma=1.5)), 3),
              "shift": [round(float(v), 2) for v in sh]}
print(json.dumps(res, indent=1))
