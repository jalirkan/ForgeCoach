# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks the three finals: size, exact 180-degree symmetry, congruence (lightness and edge
maps compared pixel for pixel), and print safety. Writes check.json beside this script.

    python check.py
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import lattice as G
import render
from colour import srgb_to_oklab

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
CW = ("green", "blue", "garnet")


def load(cw):
    im = Image.open(OUT / f"tumbling-blocks-{cw}.png")
    return im, np.asarray(im.convert("RGB"))


def lightness(a):
    return srgb_to_oklab(a.reshape(-1, 3).astype(np.float64)).reshape(a.shape)[..., 0]


def edges(L8, structural):
    """All edges (grain included), or the structural ones: joints, faces, brass, gold (blur 2 px first)."""
    if structural:
        return cv2.Canny(cv2.GaussianBlur(L8, (0, 0), 2.0), 25, 60) > 0
    return cv2.Canny(L8, 40, 90) > 0


rep = {"geometry": {
    "canvas": [G.W, G.H], "rhombus_edge_px": G.S, "cube_width_px": round(G.HW, 2), "row_pitch_px": G.ROW,
    "cubes_across_bleed": round(G.W / G.HW, 2), "cubes_across_cut": round((G.W - 2 * G.CUT) / G.HW, 2),
    "rows_down_bleed": round(G.H / G.ROW, 2), "rows_down_cut": round((G.H - 2 * G.CUT) / G.ROW, 2),
    "card_centre": [G.OX, G.OY]}}
lat = G.Lattice()
for name in G.CLUSTERS:
    m = G.cluster(name, lat.rcx, lat.rcy)
    rep["geometry"][f"cluster_{name}"] = {"rhombi": int(len(np.unique(np.round(lat.rcx[m] * 4) * 1e5 + np.round(lat.rcy[m] * 4)))),
                                          "symmetric_180": bool(np.array_equal(m, m[::-1, ::-1])),
                                          "px": int(m.sum())}
apo, tip = render.plate_apothem()
pp = render.PARAMS["plate"]
rep["geometry"]["plate"] = {
    "shape": "flat-top regular hexagon centred on O", "outer_apothem_px": round(apo, 4),
    "outer_circumradius_px": round(apo * 2 / np.sqrt(3), 3), "rim_px": pp["rim_px"],
    "rim_inner_apothem_px": round(apo - pp["rim_px"], 4), "joint_half_px": pp["joint_half_px"],
    "joint_tip_px": round(tip, 4), "cube_corner_distance_from_O_px": 2 * G.S,
    # the corner's dark joint tip reaches 2S + tip; the rim's inner edge is at apo - rim: their gap
    "joint_tip_to_rim_inner_edge_gap_px": round(apo - pp["rim_px"] - (2 * G.S + tip), 6)}
ims, arrs, Ls = {}, {}, {}
for cw in CW:
    im, a = load(cw)
    ims[cw], arrs[cw] = im, a
    Ls[cw] = lightness(a)
    r = {"size": list(im.size), "dpi": [round(float(v)) for v in im.info.get("dpi", (0, 0))]}
    r["rot180_max_diff"] = int(np.abs(a.astype(np.int16) - a[::-1, ::-1]).max())
    # print safety
    gold = G.cluster("hex2", lat.rcx, lat.rcy)      # the faces at the plate's heart (all under the plate)
    inner = lat.edge > 5
    off = np.hypot(lat.x - G.OX, lat.y - G.OY) > 330    # wood only: clear of the plate and its shadow
    light = (lat.face == 0) & off & inner
    r["light_face_rgb_p99_5"] = [int(np.percentile(a[..., k][light], 99.5)) for k in range(3)]
    r["light_face_rgb_max"] = int(a[light].max())
    r["light_face_mean_rgb"] = [int(round(v)) for v in a[light].mean(0)]
    r["mid_face_mean_rgb"] = [int(round(v)) for v in a[(lat.face == 1) & off & inner].mean(0)]
    r["dark_face_mean_rgb"] = [int(round(v)) for v in a[(lat.face == 2) & off & inner].mean(0)]
    r["plate_face_mean_rgb_top_left_right"] = [[int(round(v)) for v in a[(lat.face == f) & gold & inner].mean(0)] for f in range(3)]
    lum = a.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    bl = cv2.GaussianBlur(lum, (0, 0), 12 / 2.355 * 2)       # about 0.5 mm
    r["darkest_0_5pct_blurred"] = round(float(np.percentile(bl, 0.5)), 1)
    r["darkest_5pct_blurred"] = round(float(np.percentile(bl, 5)), 1)
    r["darkest_pixel"] = int(lum.min())
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV).astype(np.float32)
    r["sat_x_val_p99_5"] = int(np.percentile(hsv[..., 1] * hsv[..., 2] / 255, 99.5))
    rep[cw] = r
# congruence: lightness and edge maps, pixel for pixel
L8 = {cw: np.clip(np.round(Ls[cw] * 255), 0, 255).astype(np.uint8) for cw in CW}
cong = {}
on_lattice = lat.edge < 4.5          # within 4.5 px of an analytic lattice edge
for kind in ("structural", "all"):
    E = {cw: edges(L8[cw], kind == "structural") for cw in CW}
    if kind == "structural":
        cong["structural_edges_on_lattice_pct"] = {cw: round(100 * float((E[cw] & on_lattice).sum()) / float(E[cw].sum()), 2) for cw in CW}
        ov = np.stack([E["green"], E["blue"], E["garnet"]], -1).astype(np.uint8) * 255
        Image.fromarray(ov).save(HERE / "edge-overlay.png", optimize=True)
    for a_, b_ in (("green", "blue"), ("green", "garnet"), ("blue", "garnet")):
        ea, eb = E[a_], E[b_]
        xor = ea ^ eb
        near_b = cv2.dilate(eb.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        near_a = cv2.dilate(ea.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        c = cong.setdefault(f"{a_}-{b_}", {})
        if kind == "structural":
            dL = np.abs(Ls[a_] - Ls[b_])
            c["lightness_abs_diff_max"] = round(float(dL.max()), 4)
            c["lightness_abs_diff_mean"] = round(float(dL.mean()), 5)
        c[kind] = {"edge_px": [int(ea.sum()), int(eb.sum())], "mismatched_px": int(xor.sum()),
                   "mismatch_pct_of_union": round(100 * float(xor.sum()) / float((ea | eb).sum()), 3),
                   "without_partner_within_1px": int((ea & ~near_b).sum() + (eb & ~near_a).sum()),
                   "on_lattice_band": {"edge_px": [int((ea & on_lattice).sum()), int((eb & on_lattice).sum())],
                                       "mismatched_px": int((xor & on_lattice).sum()),
                                       "without_partner_within_1px": int((ea & ~near_b & on_lattice).sum() + (eb & ~near_a & on_lattice).sum())}}
rep["congruence"] = cong
(HERE / "check.json").write_text(json.dumps(rep, indent=1) + "\n")
print(json.dumps(rep, indent=1))
