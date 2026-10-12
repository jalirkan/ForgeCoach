# SPDX-License-Identifier: GPL-3.0-or-later
"""sRGB <-> OKLab (Bjorn Ottosson's matrices), vectorised over numpy arrays."""
import numpy as np

_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]])
_M1i = np.linalg.inv(_M1)
_M2i = np.linalg.inv(_M2)


def srgb_to_lin(c):
    c = np.asarray(c, np.float64) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return 255 * np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)


def srgb_to_oklab(rgb):
    lms = srgb_to_lin(rgb) @ _M1.T
    return np.cbrt(lms) @ _M2.T


def oklab_to_srgb(lab):
    lms = (np.asarray(lab, np.float64) @ _M2i.T) ** 3
    return lin_to_srgb(lms @ _M1i.T)


def lch(L, C, h_deg):
    h = np.radians(h_deg)
    return np.array([L, C * np.cos(h), C * np.sin(h)])


def to_lch(rgb):
    L, a, b = srgb_to_oklab(rgb)
    return L, float(np.hypot(a, b)), float(np.degrees(np.arctan2(b, a)) % 360)
