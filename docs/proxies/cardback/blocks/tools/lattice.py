# SPDX-License-Identifier: GPL-3.0-or-later
"""The tumbling-blocks lattice, exactly, for the proxy back.

Everything here is analytic and deterministic: no randomness, no model. All three
colourways are built from the same `Lattice` with the same parameters, so the cube
size, the grid origin, every rhombus and the gold emblem sit on the same pixels.

Coordinates are continuous pixel coordinates on the 1632 x 2220 bleed canvas
(600 dpi); pixel (i, j) has its centre at (i + 0.5, j + 0.5). The card centre
O = (816, 1110) is a degree-6 vertex of the rhombus tiling, which is a 2-fold
rotation centre of the shaded pattern: turning the card 180 degrees maps every
rhombus onto a rhombus of the same orientation, hence the same shade.

Each cube is a pointy-top hexagon of circumradius S (the rhombus edge), split
into three rhombi from its centre C:
  face 0  top    (light)  vertices P0, P1, C, P5
  face 1  left   (mid)    vertices C, P3, P4, P5
  face 2  right  (dark)   vertices P1, P2, P3, C
with P_k at angle -90 + 60k degrees (P0 top, P3 bottom). O is P3 of cube A,
so C_A = O - (0, S).
"""
import math
import numpy as np

W, H = 1632, 2220                 # bleed canvas, 600 dpi (2.72 x 3.70 in)
OX, OY = W / 2, H / 2             # card centre: a degree-6 vertex of the tiling
CUT, SAFE = 75, 135               # cut line and safe line, px in from the bleed edge

S = 114.0                         # rhombus edge = cube hexagon circumradius, px (4.83 mm)
HW = S * math.sqrt(3)             # cube width, flat to flat (197.45 px, 8.36 mm)
ROW = 1.5 * S                     # row pitch (171 px)
CAX, CAY = OX, OY - S             # centre of cube A (O is its bottom vertex P3)

SQ3 = math.sqrt(3)


def grid(w=W, h=H):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    return xx + 0.5, yy + 0.5


def cube_of(x, y):
    """Axial (q, r) of the cube hexagon containing each point, and its centre."""
    px, py = x - CAX, y - CAY
    qf = (SQ3 / 3 * px - py / 3) / S
    rf = (2 / 3 * py) / S
    sf = -qf - rf
    q, r, s = np.round(qf), np.round(rf), np.round(sf)
    dq, dr, ds = np.abs(q - qf), np.abs(r - rf), np.abs(s - sf)
    fix_q = (dq > dr) & (dq > ds)
    fix_r = (~fix_q) & (dr > ds)
    q = np.where(fix_q, -r - s, q)
    r = np.where(fix_r, -q - s, r)
    cx = CAX + HW * (q + r / 2)
    cy = CAY + ROW * r
    return q, r, cx, cy


def face_of(lx, ly):
    """Face 0 top, 1 left, 2 right, from the offset to the cube centre."""
    t = np.degrees(np.arctan2(ly, lx))           # -180..180, y down
    top = (t > -150) & (t <= -30)
    right = (t > -30) & (t <= 90)
    return np.where(top, 0, np.where(right, 2, 1)).astype(np.int8)


# rhombus centre offsets from the cube centre, per face
FACE_CENTRE = {0: (0.0, -S / 2), 1: (-HW / 4, S / 4), 2: (HW / 4, S / 4)}
# grain direction per face (radians, y down): the top runs across, the sides lean the way the
# green candidate's did (left face rising to the right, right face falling), steeper than their edges
FACE_GRAIN = {0: 0.0, 1: math.radians(-66), 2: math.radians(66)}


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - ax - t * vx, py - ay - t * vy)


def edge_dist(lx, ly):
    """Distance from each point to the nearest edge of the rhombus tiling (hex rim or a spoke)."""
    ri = HW / 2
    rim = ri - np.maximum.reduce([np.abs(lx),
                                  np.abs(lx * 0.5 + ly * SQ3 / 2),
                                  np.abs(-lx * 0.5 + ly * SQ3 / 2)])
    d = rim
    for ang in (-30, 90, 210):                   # spokes C->P1, C->P3, C->P5
        bx, by = S * math.cos(math.radians(ang)), S * math.sin(math.radians(ang))
        d = np.minimum(d, _seg_dist(lx, ly, 0.0, 0.0, bx, by))
    return d


class Lattice:
    """Per-pixel geometry for one canvas: face, rhombus centre, local offset, edge distance."""

    def __init__(self, w=W, h=H, ss=1):
        x, y = grid(w * ss, h * ss)
        x, y = x / ss, y / ss
        q, r, cx, cy = cube_of(x, y)
        lx, ly = x - cx, y - cy
        self.face = face_of(lx, ly)
        fcx = np.choose(self.face, [FACE_CENTRE[0][0], FACE_CENTRE[1][0], FACE_CENTRE[2][0]])
        fcy = np.choose(self.face, [FACE_CENTRE[0][1], FACE_CENTRE[1][1], FACE_CENTRE[2][1]])
        self.rcx, self.rcy = cx + fcx, cy + fcy          # rhombus centre
        self.dx, self.dy = x - self.rcx, y - self.rcy     # offset inside the rhombus
        self.edge = edge_dist(lx, ly)
        self.x, self.y = x, y
        # canonical rhombus of each 180-degree pair: the one above O, or left of it on O's row
        prx, pry = 2 * OX - self.rcx, 2 * OY - self.rcy
        self.canon = (self.rcy < pry - 1e-6) | ((np.abs(self.rcy - pry) <= 1e-6) & (self.rcx < prx))
        crx = np.where(self.canon, self.rcx, prx)
        cry = np.where(self.canon, self.rcy, pry)
        # integer key of the canonical rhombus (stable across runs): its centre in quarter-pixels
        self.key = (np.round(crx * 4).astype(np.int64) * 100003 + np.round(cry * 4).astype(np.int64))
        self.sign = np.where(self.canon, 1.0, -1.0)      # the twin samples its texture turned 180 degrees


def hex_norm(x, y, cx=OX, cy=OY):
    """Pointy-top hexagon norm: equals the inner radius on the hexagon's edges."""
    lx, ly = x - cx, y - cy
    return np.maximum.reduce([np.abs(lx), np.abs(lx * 0.5 + ly * SQ3 / 2), np.abs(-lx * 0.5 + ly * SQ3 / 2)])


def flat_hex_norm(x, y, cx=OX, cy=OY):
    lx, ly = x - cx, y - cy
    return np.maximum.reduce([np.abs(ly), np.abs(ly * 0.5 + lx * SQ3 / 2), np.abs(-ly * 0.5 + lx * SQ3 / 2)])


# --- the emblem clusters: which rhombi are gold. Each is a union of whole rhombi, so its
# outline runs ON lattice edges, and each is 180-degree symmetric about O (the test is on the
# rhombus centre against a centrally symmetric region; `check.py` asserts both).
CLUSTERS = {
    # the one regular hexagon whose six straight sides are lattice edges: side 2S, centred on O.
    # 12 rhombi, read as three cubes stacked in a corner (or, turned round, the same three).
    "hex2": dict(rhombi=12, test=lambda x, y: hex_norm(x, y) < S * SQ3),
    # hex2 plus the six rhombi pairs on its points: a six-pointed star of cubes, 24 rhombi
    "star": dict(rhombi=24, test=lambda x, y: np.hypot(x - OX, y - OY) < 2.5 * S),
    # the stepped hexagon: 30 rhombi, a ring of cubes around hex2, crenellated outline
    "ring": dict(rhombi=30, test=lambda x, y: np.hypot(x - OX, y - OY) < 3.0 * S),
}


def cluster(name, rcx, rcy):
    return CLUSTERS[name]["test"](rcx, rcy)
