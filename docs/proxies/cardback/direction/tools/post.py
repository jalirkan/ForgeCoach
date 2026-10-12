# SPDX-License-Identifier: GPL-3.0-or-later
# raw SDXL output -> 1632x2220 final back with enforced symmetry, a black floor and a .txt sidecar.
# Usage: post.py <kind binder|blocks|seat> <spec.json> <job name> <out dir> <out name>
import json, sys
import numpy as np
from PIL import Image, ImageFilter

FW, FH = 1632, 2220
kind, specp, job, outdir, outname = sys.argv[1:6]
spec = json.load(open(specp))
J = next(j for j in spec["jobs"] if j["name"] == job)
rawp = sys.argv[6] if len(sys.argv) > 6 else f"{spec['out']}/{job}.png"
note = sys.argv[7] if len(sys.argv) > 7 else ""
raw = Image.open(rawp).convert("RGB")

def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))

def quad_mirror(a):
    h, w = a.shape[:2]; q = a[: h // 2, : w // 2]
    top = np.concatenate([q, q[:, ::-1]], 1)
    return np.concatenate([top, top[::-1]], 0)

def rot_blend(a, band=80):
    """Left half kept; right half is the left half turned 180 degrees, feathered across the centre."""
    h, w = a.shape[:2]; r = a[::-1, ::-1]
    x = np.arange(w, dtype=np.float32)
    wt = np.clip((x - (w / 2 - band / 2)) / band, 0, 1)[None, :, None]
    return a * (1 - wt) + r * wt

if kind == "binder":
    a = np.asarray(cover(raw, FW, FH), np.float32)
    c = a.copy(); a = quad_mirror(a)
    # the Necker cube turns 180 degrees onto itself but is not mirror-symmetric: keep the painted centre,
    # and make it exactly 180-degree symmetric by blending it with its own rotation
    c = (c + c[::-1, ::-1]) / 2
    yy, xx = np.mgrid[0:FH, 0:FW]
    r = np.hypot(xx - FW / 2, yy - FH / 2)
    wt = np.clip((215 - r) / 30, 0, 1)[..., None]
    a = a * (1 - wt) + c * wt
    sym = "mirror on both axes (top-left quadrant reflected); the centre emblem (r < 215 px) kept as painted and averaged with its own 180-degree rotation, since a Necker cube is rotation- but not mirror-symmetric"
elif kind == "blocks":
    a = np.asarray(cover(raw, FW, FH), np.float32)
    a = rot_blend(a); sym = "180-degree rotation: left half kept, right half its rotated twin, 80 px feather"
elif kind == "seat":
    s = FW / raw.width
    half = raw.resize((FW, round(raw.height * s)), Image.LANCZOS)          # 1632 x 1117
    hh = FH // 2
    half = np.asarray(half, np.float32)[half.height - (hh + 6):]                 # bottom 1116 rows: the orb sits on the seam
    top = half; bot = half[::-1, ::-1]
    ov = top.shape[0] * 2 - FH                                            # overlap rows to blend
    a = np.zeros((FH, FW, 3), np.float32)
    a[: top.shape[0] - ov] = top[: top.shape[0] - ov]
    a[top.shape[0] :] = bot[ov:]
    wt = np.linspace(0, 1, ov)[:, None, None]
    a[top.shape[0] - ov : top.shape[0]] = top[-ov:] * (1 - wt) + bot[:ov] * wt
    sym = f"double-ended: top half painted, bottom half its 180-degree twin, {ov} px blend at the seam"

# mild sharpening after the 1.96x Lanczos: restores mid-level detail without adding hairline noise
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=2.2, percent=45, threshold=2))
a = np.asarray(im, np.float32)

# print: no neon. Chroma (max-min of RGB) above 140 is compressed toward the pixel's own grey, hue kept.
CMAX = 140.0
mx, mn = a.max(-1, keepdims=True), a.min(-1, keepdims=True); ch = mx - mn
target = np.where(ch > CMAX, CMAX + (ch - CMAX) * 0.35, ch)
grey = a.mean(-1, keepdims=True)
k = np.where(ch > 0, target / np.maximum(ch, 1e-6), 1.0)
a = grey + (a - grey) * k

def dark_stats(a):
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2])
    big = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(12)), np.float32)  # ~0.5 mm
    return float(np.percentile(big, 0.5)), float(np.percentile(big, 5)), float(lum.min())
before = dark_stats(a)
FLOOR = 22.0
if before[0] < FLOOR:                                     # lift only the shadows, smoothly, so the darkest areas sit at ~22
    k = 70.0
    lift = (FLOOR - before[0]) * np.clip(1 - a / k, 0, 1)
    a = a + lift
after = dark_stats(a)
out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
out.save(f"{outdir}/{outname}.png", dpi=(600, 600))
# saturation of the brightest-chroma 0.5% (neon check)
hsv = np.asarray(out.convert("HSV"), np.float32)
sat_hi = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
txt = f"""{outname}.png  1632x2220, 600 dpi, RGB
model: Lykon/dreamshaper-xl-1-0 (fp16 unet, madebyollin/sdxl-vae-fp16-fix), img2img over a code-drawn guide
guide: {J['guide']}  (drawn by tools/guides.py)
prompt: {J['prompt']}
negative: {J['negative']}
seed: {J['seed']}  steps: {spec['steps']} (img2img strength {J['strength']}, so {int(spec['steps']*float(J['strength']))} denoising steps)  cfg: {spec['cfg']}
scheduler: DPM++ 2M Karras (DPMSolverMultistep, dpmsolver++, karras sigmas); attention: classic AttnProcessor
generated size: {raw.width}x{raw.height}
upscale: Lanczos to width 1632, centred cover-crop to 1632x2220, unsharp mask r2.2 45%; chroma above 140 compressed (x0.35) toward each pixel's grey, so nothing prints neon
symmetry: {sym}
darkest areas (luminance, 0.5 mm blur): 0.5th percentile {before[0]:.1f} before, {after[0]:.1f} after the shadow lift to a floor of 22; 5th percentile {after[1]:.1f}; darkest single pixel {after[2]:.1f}
saturation x value, 99.5th percentile: {sat_hi:.0f}/255
raw job: {job}  ({rawp})
{note}
"""
open(f"{outdir}/{outname}.txt", "w").write(txt)
print(outname, f"dark0.5%={before[0]:.1f}->{after[0]:.1f} 5%={after[1]:.1f} sat={sat_hi:.0f}")
