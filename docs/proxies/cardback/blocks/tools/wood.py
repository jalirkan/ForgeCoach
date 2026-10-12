# SPDX-License-Identifier: GPL-3.0-or-later
"""Procedural veneer grain and brushed brass, sampled per rhombus.

A texture is a 2048 x 2048 tile in the grain's own frame (columns run ALONG the
grain, rows across it), made from seeded noise, so it is identical on every run.
Each rhombus samples it at its own seeded offset, rotated so the grain runs along
the rhombus' long diagonal; a rhombus' 180-degree twin samples the same patch turned
180 degrees, so the grain is exactly symmetric too. Feature sizes are kept at about
3 px and up (0.13 mm at 600 dpi), so nothing is the hairline noise that mushes in print.
"""
import cv2
import numpy as np

T = 2048


def _field(rng, sig_u, sig_v):
    """Seamless (periodic) Gaussian-filtered noise: sig_u px along the grain (columns), sig_v across (rows)."""
    f = np.fft.fftfreq(T)
    fv, fu = np.meshgrid(f, f, indexing="ij")
    filt = np.exp(-2 * np.pi ** 2 * ((sig_u * fu) ** 2 + (sig_v * fv) ** 2))
    g = np.real(np.fft.ifft2(np.fft.fft2(rng.normal(0, 1, (T, T))) * filt)).astype(np.float32)
    return _norm(g)


def _norm(a):
    a = a - a.mean()
    return a / (a.std() + 1e-9)


def veneer(seed, lines=230, line_w=1.1, line_amp=1.0, fibre=0.45, figure=0.5, drift=22.0):
    """Straight-grained veneer as a wood shader: growth lines (thin, crisp, unevenly spaced and
    unevenly dark) along the grain, short fibres between them, and a broad figure.
    `lines` growth lines across the 2048 px tile (230 = about 9 px apart)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:T, 0:T].astype(np.float32)
    # the growth-line phase: across-grain position, drifted slowly and wavered a little
    phase = (yy + drift * _field(rng, 320, 70) + 3.0 * _field(rng, 70, 18)) * (lines / T)
    phase = phase + 0.35 * _field(rng, 400, 30)        # uneven spacing
    d = np.abs((phase % 1.0) - 0.5) * (T / lines)      # px from the nearest line centre... of the band
    d = (T / lines) / 2 - d                            # px from the nearest line
    line = np.clip(1 - d / line_w, 0, 1) ** 1.5
    strength = 0.55 + 0.45 * np.clip(_field(rng, 260, 9) + 0.6, 0, 2) / 2
    g = -line_amp * line * strength * 2.2
    g = g + fibre * _field(rng, 22, 1.0) + figure * _field(rng, 420, 34) + 0.35 * _field(rng, 220, 4.0)
    return _norm(g)


def brass(seed):
    """Brushed brass: very fine low-contrast brushing plus a soft mottle."""
    rng = np.random.default_rng(seed)
    return _norm(0.55 * _field(rng, 160, 1.0) + 0.85 * _field(rng, 70, 70))


def sample(tex, lat, angle, sel, key_off):
    """Sample `tex` for the pixels in `sel`, along `angle` (radians, per pixel or scalar)."""
    dx = lat.dx[sel] * lat.sign[sel]
    dy = lat.dy[sel] * lat.sign[sel]
    a = angle[sel] if np.ndim(angle) else angle
    u = dx * np.cos(a) + dy * np.sin(a)           # along the grain
    v = -dx * np.sin(a) + dy * np.cos(a)          # across it
    ou, ov = key_off
    u = (u + ou[sel]) % T
    v = (v + ov[sel]) % T
    # bilinear, wrapping
    u0 = np.floor(u).astype(np.int64); v0 = np.floor(v).astype(np.int64)
    fu = (u - u0).astype(np.float32); fv = (v - v0).astype(np.float32)
    u1 = (u0 + 1) % T; v1 = (v0 + 1) % T
    return ((tex[v0, u0] * (1 - fu) + tex[v0, u1] * fu) * (1 - fv)
            + (tex[v1, u0] * (1 - fu) + tex[v1, u1] * fu) * fv)


def per_rhombus(lat, seed):
    """Seeded per-rhombus values (same for a rhombus and its 180-degree twin)."""
    keys, inv = np.unique(lat.key, return_inverse=True)
    inv = inv.reshape(lat.key.shape)
    rng = np.random.default_rng(seed)
    ou = rng.uniform(0, T, len(keys))[inv]
    ov = rng.uniform(0, T, len(keys))[inv]
    tone = rng.normal(0, 1, len(keys))[inv]
    tilt = rng.normal(0, 1, len(keys))[inv]
    return ou, ov, tone, tilt
