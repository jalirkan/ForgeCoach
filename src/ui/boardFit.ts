/*
 * ForgeCoach — ui/boardFit.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How one side of the phone board fits its height (portrait phones, play.css).
 * Each side is a size container; its cards take the height it has, between a
 * legible floor and a ceiling. Past the floor the side must not shrink further
 * (its cards would spill onto the life bar under it), so the side gets a
 * minimum height — the rows at the floor size — and the board scrolls instead.
 * (play.css computes that minimum from --fit-pad and --fit-rows, because the
 * floor is smaller on short phones; `minPx` is the same sum.)
 *
 * DOM-free so it is tested in node (boardFit.test.ts). The pixel constants
 * mirror play.css; change them together.
 */

/** Card aspect: height over width. */
export const CARD_RATIO = 88 / 63;

export const PHONE_FIT = {
  /** Narrowest legible card width (px); lands are `landK` of it. */
  floor: 54,
  /** Widest card (px). */
  ceil: 104,
  /** A land is this much of a creature (lands sit in piles with count badges). */
  landK: 0.8,
  /** Each row's padding above and below its cards (.bf-cards: 5 + 4). */
  rowPad: 9,
  /** Between two rows: the dashed rule and its padding (1 + 4). */
  rowSep: 5,
  /** The side's own padding (.battlefield: 2 + 2). */
  sidePad: 4,
  /** One aura or equipment chip under its host, one line on phones. */
  attachPx: 19,
  /** An empty side: the "No permanents" line. */
  emptyPx: 24,
} as const;
export type FitConstants = { [K in keyof typeof PHONE_FIT]: number };

export interface SideShape {
  /** Creatures and other non-land permanents on the table (any). */
  permanents: boolean;
  /** Lands on the table (any). */
  lands: boolean;
  /** Most auras / equipment on any one permanent (they hang under it). */
  maxAttach: number;
}

export interface SideFit {
  /** The rows' height in creature-card heights (a lands row counts `landK`). */
  rowsH: number;
  /** Fixed pixels inside the side that are not cards. */
  padPx: number;
  /** The side's minimum height (px): every row at the floor size. */
  minPx: number;
}

export function phoneSideFit({ permanents, lands, maxAttach }: SideShape, k: FitConstants = PHONE_FIT): SideFit {
  const rows = Number(permanents) + Number(lands);
  if (rows === 0) return { rowsH: 0, padPx: k.sidePad + k.emptyPx, minPx: k.sidePad + k.emptyPx };
  const rowsH = Number(permanents) + Number(lands) * k.landK;
  const attach = permanents ? Math.max(0, maxAttach) * k.attachPx : 0;
  const padPx = k.sidePad + rows * k.rowPad + (rows - 1) * k.rowSep + attach;
  const minPx = Math.ceil(padPx + rowsH * k.floor * CARD_RATIO);
  return { rowsH, padPx, minPx };
}

/**
 * The card width a side of `heightPx` gives (what the CSS clamp computes), for
 * checking the formula: the rows' card heights fill what the padding leaves.
 */
export function phoneCardWidth(fit: SideFit, heightPx: number, k: FitConstants = PHONE_FIT): number {
  if (fit.rowsH <= 0) return k.floor;
  const w = (heightPx - fit.padPx) / fit.rowsH / CARD_RATIO;
  return Math.min(k.ceil, Math.max(k.floor, w));
}

/** Which edges of a sideways-scrolling row have more cards past them (for the edge fade). */
export function edgeFade(scrollLeft: number, clientWidth: number, scrollWidth: number, slack = 2): 'start end' | 'start' | 'end' | '' {
  const start = scrollLeft > slack;
  const end = scrollLeft + clientWidth < scrollWidth - slack;
  return start && end ? 'start end' : start ? 'start' : end ? 'end' : '';
}
