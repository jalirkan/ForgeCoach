/*
 * ForgeCoach — ambience/scrim.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The card-row scrim of the half board (spec 1.5, art direction §5): when the
 * scenery fills a player's half, a soft tint sits under each card row, so a
 * card's edge stands off busy art while the scenery shows through it. Pure:
 * the rectangles from measured boxes, and the contrast arithmetic the tests
 * use. Drawn by ui/ambience/HalfScrim.tsx.
 *
 * The band is the row's cards (their union, clipped to the row's visible box
 * when it scrolls sideways) grown by `pad` px — no wider than the cards it
 * holds — then a short feather (~14 px) from `edge` down to nothing. The
 * whole band is the board's own background colour at
 * `--scn-scrim-strength` (scenery.css, one token, ~0.35), so the pair bands
 * and the backgrounds show through it. Its strength does not carry
 * readability: every piece of text on the board sits on a frame of its own
 * (a tile's P/T, counters, pile count; the "No permanents" note), and the
 * tests check that text against the brightest art.
 *
 * Until 2026-10-17 the band was opaque within 6 px of the cards, then
 * feathered from 0.85 over 30 px: dark boxes that hid the scenery (Justin's
 * watch, item 2).
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScrimRow {
  /** The row's visible box (a sideways-scrolling row clips its cards to it). */
  box: Box;
  /** Its cards' boxes. */
  items: Box[];
}

/** The band's core reaches this far past the cards (px). */
export const SCRIM_PAD_PX = 2;
/** Then it feathers out over this many px. */
export const SCRIM_FEATHER_PX = 14;
/** The feather starts at this share of the band's strength. */
export const SCRIM_EDGE_ALPHA = 0.7;
/** The default of scenery.css's `--scn-scrim-strength`: the band's opacity at its core. */
export const SCRIM_STRENGTH = 0.35;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The scrim bands for a player's half, in px relative to the half (`host`),
 * one per row with something in it: its cards' union, clipped to the row's
 * visible box, grown by `pad`, kept inside the half.
 */
export function scrimRects(host: Box, rows: ScrimRow[], pad = SCRIM_PAD_PX): Box[] {
  const out: Box[] = [];
  for (const row of rows) {
    const items = row.items.filter((b) => b.width > 0 && b.height > 0);
    if (!items.length) continue;
    let l = Math.min(...items.map((b) => b.left));
    let t = Math.min(...items.map((b) => b.top));
    let r = Math.max(...items.map((b) => b.left + b.width));
    let btm = Math.max(...items.map((b) => b.top + b.height));
    // A row that scrolls sideways shows only its box.
    l = Math.max(l, row.box.left);
    r = Math.min(r, row.box.left + row.box.width);
    t = Math.max(t, row.box.top);
    btm = Math.min(btm, row.box.top + row.box.height);
    if (!(r > l && btm > t)) continue;
    const left = Math.max(host.left, l - pad);
    const top = Math.max(host.top, t - pad);
    const right = Math.min(host.left + host.width, r + pad);
    const bottom = Math.min(host.top + host.height, btm + pad);
    if (!(right > left && bottom > top)) continue;
    out.push({ left: r1(left - host.left), top: r1(top - host.top), width: r1(right - left), height: r1(bottom - top) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2): what the tests measure.

export type Rgb = [number, number, number];

/** `#rgb` / `#rrggbb` → 0–255 channels. */
export function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` over `under`, as the browser blends (in sRGB). */
export function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  return top.map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha))) as Rgb;
}
