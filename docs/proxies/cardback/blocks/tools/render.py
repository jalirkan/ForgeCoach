# SPDX-License-Identifier: GPL-3.0-or-later
"""Render the Tumbling Blocks proxy back: one lattice, three colourways.

    python render.py finals              # tumbling-blocks-{green,blue,garnet}.png in ../
    python render.py options <outdir>    # every cluster x treatment, green, for EMBLEM-OPTIONS.jpg

Every number that shapes the card is in PARAMS (and lattice.py). The lightness of
every pixel is computed once, independent of the colourway; a colourway only sets
the hue and chroma of the mid face. So the three backs have the same lightness map,
pixel for pixel, and differ only in the mid face's hue.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import lattice as G
import wood
from colour import lch, oklab_to_srgb

HERE = Path(__file__).resolve().parent
OUT = HERE.parent

PARAMS = {
    "canvas_px": [G.W, G.H], "dpi": 600, "cut_px": G.CUT, "safe_px": G.SAFE,
    "rhombus_edge_px": G.S, "cube_width_px": round(G.HW, 3), "row_pitch_px": G.ROW,
    "card_centre": [G.OX, G.OY], "card_centre_is": "a degree-6 vertex of the rhombus tiling (bottom vertex of cube A)",
    "cube_A_centre": [G.CAX, G.CAY],
    "cluster": "hex2", "treatment": "plate",
    # THE EMBLEM (the owner's choice, 2026-10-12): a gold PLATE laid over the lattice, after the original
    # candidate's. A flat-top regular hexagon (points left and right) centred on O. Its outer apothem is
    # 2S + rim + joint_tip, so the six cube corners at 2S from O (the central column's cube top and its
    # rotations by 60 deg) touch the rim's inner edge with the whole dark tip of their joints showing.
    # Inside, the SAME lattice (aligned, same scale, no shift) recoloured in three golds sampled from
    # direction/tumbling-blocks-1.png's plate by k-means (sRGB 0..1; light top, mid left, dark right).
    "plate": {"rim_px": 14.0, "joint_half_px": 3.0, "joint_dark": 0.7,
              "golds": {"light": [0.7465, 0.6100, 0.3553], "mid": [0.5622, 0.4432, 0.2398],
                        "dark": [0.4524, 0.3160, 0.1655]},
              "rim_tone_x_light": 1.05, "bevel": [0.14, 0.08],
              "grain_amp": 0.04, "grain_seed": 11, "grain_cells": [52, 70],
              "edge_line_half_px": 2.0, "edge_line_dark": 0.7,
              "shadow": 0.16, "shadow_px": 18.0,
              "halo": True},       # the brass-strung star of 30 rhombi around it, as on the sheets the owner chose from
    # OKLCh (L, C, h). L is shared by all colourways; only the mid face's C and h change.
    "faces_L": {"light": 0.770, "mid": 0.440, "dark": 0.255},
    "light": [0.770, 0.047, 83.0],      # holly / bone
    "dark": [0.255, 0.012, 62.0],       # ebonised wood
    "mid": {"green": [0.440, 0.024, 175.0],   # smoked green-grey sycamore: tumbling-blocks-1's measured median
            "blue": [0.440, 0.034, 260.0],    # indigo
            "garnet": [0.440, 0.064, 30.0]},  # red pearwood
    "gold": [[0.700, 0.095, 82.0], [0.565, 0.090, 78.0], [0.440, 0.072, 74.0]],   # top, left, right
    "joint": [0.200, 0.010, 55.0], "joint_width_px": 3.4, "joint_wobble_px": 0.7,
    "grain_amp_L": {"light": 0.030, "mid": 0.032, "dark": 0.030, "gold": 0.016},
    "light_L_cap": 0.855, "L_floor": 0.180, "piece_tone_L": 0.010, "piece_tilt_L": 0.010,
    "seeds": {"pieces": 11, "light": 101, "mid": 102, "dark": 103, "gold": 104},
    # the brass stringing frame, on lattice lines: x = O +- 3 cube widths (vertical joints),
    # y = O +- 5 rows (the row of light-rhombus long diagonals); its corners fall on light-rhombus centres
    "frame": {"x_cubes": 3, "y_rows": 5, "thick_px": 8.0, "thin_px": 4.0, "gap_px": 22.0, "slot_px": 1.6,
              "brass": [0.600, 0.085, 80.0]},
}


def _lab(lch3):
    return lch(*lch3)


def build(cluster=None, treatment=None, frame=True, lat=None):
    """The colourway-independent part: lightness L, a face id per pixel and the joint/brass coverage."""
    P = PARAMS
    cluster = cluster or P["cluster"]; treatment = treatment or P["treatment"]
    lat = lat or G.Lattice()
    sd = P["seeds"]
    ou, ov, tone, tilt = wood.per_rhombus(lat, sd["pieces"])
    face = lat.face.astype(np.int16)
    gold = G.cluster(cluster, lat.rcx, lat.rcy)
    ang = np.choose(face, [G.FACE_GRAIN[0], G.FACE_GRAIN[1], G.FACE_GRAIN[2]])
    L = np.zeros(face.shape, np.float32)
    amp = P["grain_amp_L"]
    names = ("light", "mid", "dark")
    for f, n in enumerate(names):
        sel = face == f
        g = wood.sample(wood.veneer(sd[n]), lat, ang, sel, (ou, ov))
        L[sel] = P["faces_L"][n] + amp[n] * g
    L = np.where(face == 0, np.minimum(L, P["light_L_cap"]), L)     # pale wood shows grime: cap the holly
    # each piece cut from a slightly different part of the log: a tone and a faint tilt across it
    u = (lat.dx * np.cos(ang) + lat.dy * np.sin(ang)) * lat.sign / G.HW
    L += P["piece_tone_L"] * np.clip(tone, -2, 2) + P["piece_tilt_L"] * np.clip(tilt, -2, 2) * u
    kind = face.copy()                     # 0..2 wood faces, 3..5 gold faces
    if treatment == "haloed":
        gold = G.cluster("hex2", lat.rcx, lat.rcy)
    if treatment == "plate":
        gold = np.zeros_like(gold)      # no lattice piece is gilded: the plate is laid on top
    if treatment in ("solid", "raised", "haloed"):
        gt = wood.brass(sd["gold"])
        g = wood.sample(gt, lat, ang, gold, (ou, ov))
        L[gold] = np.array([c[0] for c in P["gold"]], np.float32)[face[gold]] + amp["gold"] * g \
            + 0.008 * np.clip(tone[gold], -2, 2)
        kind[gold] = face[gold] + 3
    # joints between pieces
    jw = P["joint_width_px"]
    # the glue line wanders a little (a knife, not a plotter); the wobble is made symmetric about O
    wob = wood._field(np.random.default_rng(sd["pieces"] + 1), 30, 30)
    wob = cv2.resize(wob, (G.W, G.H), interpolation=cv2.INTER_LINEAR) if wob.shape != (G.H, G.W) else wob
    wob = (wob + wob[::-1, ::-1]) / 2 * P["joint_wobble_px"]
    joint = np.clip((jw + wob) / 2 - lat.edge + 0.5, 0, 1).astype(np.float32)
    brass = np.zeros_like(joint)
    if treatment in ("raised", "haloed"):
        # a bevelled gold inlay that turns into itself: a bright chamfer just inside every gold edge,
        # a faint dome, and a soft shadow on the wood all round (no light direction, so 180 deg holds)
        e = lat.edge[gold]
        L[gold] += 0.075 * np.clip(1 - (e - jw / 2) / 7.0, 0, 1) ** 1.6 - 0.02 * np.clip((e - 8) / 40, 0, 1)
        out = (~gold).astype(np.uint8)
        dist = cv2.distanceTransform(out, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
        L -= (0.06 * np.exp(-dist / 14.0) * (~gold)).astype(np.float32)
    if treatment in ("outline", "haloed") or (treatment == "plate" and P["plate"]["halo"]):
        # wood tones kept; every joint inside the cluster and round it is brass stringing.
        # "haloed": the raised gold hex2, set in the stepped star of the "ring" cluster drawn in brass stringing
        zone = G.cluster("ring", lat.rcx, lat.rcy) if treatment in ("haloed", "plate") else gold
        near = cv2.dilate(zone.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        sw = 6.0
        b = np.clip(sw / 2 - lat.edge + 0.5, 0, 1).astype(np.float32) * near
        if treatment == "haloed":      # the gold's own inner joints stay dark
            b *= ~cv2.erode(gold.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        brass = np.maximum(brass, b)
    if frame:
        fr = P["frame"]
        xi = fr["x_cubes"] * G.HW; yi = fr["y_rows"] * G.ROW
        dxr = np.abs(lat.x - G.OX); dyr = np.abs(lat.y - G.OY)

        def rect_line(hx, hy, w):
            # distance to the outline of the rectangle |x| <= hx, |y| <= hy (centred on O)
            ox_, oy_ = dxr - hx, dyr - hy
            outside = np.hypot(np.maximum(ox_, 0), np.maximum(oy_, 0))
            inside = np.minimum(np.maximum(ox_, oy_), 0)
            d = np.abs(outside + inside)
            return np.clip(w / 2 - d + 0.5, 0, 1).astype(np.float32)
        sl = fr["slot_px"]
        for hx, hy, w in ((xi, yi, fr["thick_px"]), (xi - fr["gap_px"], yi - fr["gap_px"], fr["thin_px"])):
            joint = np.maximum(joint, rect_line(hx, hy, w + 2 * sl))
            brass = np.maximum(brass, rect_line(hx, hy, w))
    plate = build_plate(lat) if treatment == "plate" else None
    return dict(L=L, kind=kind, joint=joint, brass=brass, gold=gold, lat=lat, cluster=cluster, treatment=treatment,
                plate=plate)


def plate_apothem():
    pp = PARAMS["plate"]
    joint_tip = pp["joint_half_px"] / np.sin(np.radians(60))     # a 120-degree joint corner's dark tip
    return 2 * G.S + pp["rim_px"] + joint_tip, joint_tip


def build_plate(lat):
    """The plate's layers in sRGB 0..1: its colour, its coverage, the edge line and the shadow on the wood."""
    pp = PARAMS["plate"]
    apo, _ = plate_apothem()
    px, py = lat.x - G.OX, lat.y - G.OY
    d = np.maximum(np.abs(py), np.abs(py) / 2 + np.abs(px) * np.sqrt(3) / 2) - apo   # flat-top hexagon, < 0 inside
    g = pp["golds"]
    col = np.stack([np.array(g["light"]), np.array(g["mid"]), np.array(g["dark"])])[lat.face].astype(np.float32)
    rng = np.random.default_rng(pp["grain_seed"])
    cw, ch = pp["grain_cells"]
    gr = cv2.resize(rng.standard_normal((ch, cw)).astype(np.float32), (G.W, G.H), interpolation=cv2.INTER_CUBIC)
    gr = (gr + gr[::-1, ::-1]) / 2
    col = col * (1 + pp["grain_amp"] * gr)[..., None]
    joint = np.clip(pp["joint_half_px"] - lat.edge + 0.5, 0, 1)
    inner = np.clip(col * (1 - pp["joint_dark"] * joint[..., None]), 0, 1)
    rim = pp["rim_px"]
    t = np.clip(-d / rim, 0, 1)
    b1, b2 = pp["bevel"]
    rimc = np.clip(np.array(g["light"]) * pp["rim_tone_x_light"], 0, 1)[None, None, :] * \
        (1 + b1 * (1 - t) ** 2 - b2 * t ** 2)[..., None]
    beta = np.clip(d + rim + 0.5, 0, 1)[..., None]            # 1 in the rim band, 0 inside it (antialiased)
    colour = inner * (1 - beta) + np.clip(rimc, 0, 1) * beta  # no dark line on the rim's inner edge
    alpha = np.clip(0.5 - d, 0, 1)                            # the plate's coverage
    line = np.clip(pp["edge_line_half_px"] - np.abs(d) + 0.5, 0, 1)
    shadow = np.exp(-np.clip(d, 0, 300) / pp["shadow_px"]) * (d > 0)
    keep = (1 - pp["edge_line_dark"] * line) * (1 - pp["shadow"] * shadow)
    return dict(colour=colour.astype(np.float32), alpha=alpha.astype(np.float32), keep=keep.astype(np.float32))


def colourise(b, colourway):
    P = PARAMS
    L, kind = b["L"], b["kind"]
    tones = [P["light"], P["mid"][colourway], P["dark"]] + P["gold"]
    lab = np.zeros(L.shape + (3,), np.float32)
    lab[..., 0] = np.maximum(L, P["L_floor"])          # no grain line crushes to black
    for k, t in enumerate(tones):
        sel = kind == k
        ab = _lab(t)[1:]
        lab[sel, 1:] = ab * np.clip(L[sel] / t[0], 0.6, 1.4)[:, None]   # chroma follows lightness within a face
    # joints, then brass on top
    jl = _lab(P["joint"])
    a = b["joint"][..., None]
    lab = lab * (1 - a) + jl * a
    br = _lab(P["frame"]["brass"]).astype(np.float32)
    bt = wood.brass(P["seeds"]["gold"] + 7)
    lat = b["lat"]
    # the stringing's brushing runs along x or y; the cheap version is a shared mottle
    mott = bt[(lat.y.astype(np.int64)) % wood.T, (lat.x.astype(np.int64)) % wood.T]
    mott = (mott + mott[::-1, ::-1]) / 2
    brl = np.zeros_like(lab) + br
    brl[..., 0] += 0.02 * mott
    a = b["brass"][..., None]
    lab = lab * (1 - a) + brl * a
    rgb = oklab_to_srgb(lab.reshape(-1, 3)).reshape(lab.shape)
    pl = b.get("plate")
    if pl is not None:            # laid over, in sRGB like the reference: same golds on every colourway
        a = pl["alpha"][..., None]
        rgb = (rgb / 255 * (1 - a) + pl["colour"] * a) * pl["keep"][..., None] * 255
    rgb = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    return rgb


def symmetrise(rgb):
    """Exact 180-degree symmetry: the bottom half is the top half turned round. Returns (image, max diff before)."""
    h = rgb.shape[0] // 2
    rot = rgb[::-1, ::-1]
    diff = int(np.abs(rgb.astype(np.int16) - rot).max())
    out = rgb.copy()
    out[h:] = rgb[:h][::-1, ::-1]
    return out, diff


def save(rgb, path):
    Image.fromarray(rgb).save(path, dpi=(600, 600), optimize=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "finals":
        b = build()
        rep = {}
        for cw in ("green", "blue", "garnet"):
            rgb, d = symmetrise(colourise(b, cw))
            p = OUT / f"tumbling-blocks-{cw}.png"
            save(rgb, p); rep[cw] = {"rot180_maxdiff_before_enforcing": d}
            print(p.name, rep[cw])
        (HERE / "params.json").write_text(json.dumps(PARAMS, indent=1) + "\n")
    elif cmd == "options":
        outdir = Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
        lat = G.Lattice()
        combos = [a.split(":") for a in sys.argv[3:]] or [("hex2", "solid"), ("star", "solid"), ("ring", "solid"),
                                                          ("hex2", "raised"), ("star", "raised"), ("hex2", "outline")]
        for cl, tr in combos:
            rgb, d = symmetrise(colourise(build(cl, tr, lat=lat), "green"))
            Image.fromarray(rgb).save(outdir / f"opt-{cl}-{tr}.png")
            print(cl, tr, "rot180 maxdiff", d)
