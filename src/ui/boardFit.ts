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

// ---------------------------------------------------------------------------
// The desktop table (ui/cards.css, `.game.play.is-wide .play-board`).

/**
 * The desktop table's numbers (they mirror ui/cards.css and Board's variables; change them together).
 *
 * A place's picture fills a player's half, and what a land builds sits in the
 * picture's lower middle (the top third is sky). So a side's creatures and
 * other permanents sit in ONE ROW along the top of the half, in the sky, and
 * its lands are tucked into a thin bar along the bottom edge: one tab a pile,
 * with the land's name and how many. The land cards come up over their tabs
 * while the pointer is on the bar, and while the game asks you to choose
 * among them; a click on a tab is a click on its land either way.
 *
 * A permanent is sized as if its row shared the half with part of another
 * (`permRows`), so nothing grows into the picture and the lands, when they
 * come up, stand clear of the row above them. A side too short for that (a
 * big stack or combat panel between the sides) gives its one row the height
 * it has; there the lands, brought up, overlap the row for as long as they
 * are up.
 */
export const DESK_FIT = {
  /** A land card, brought up from the bar, is this much of a permanent (cards.css `--land-k`). */
  landK: 0.66,
  /** Narrowest and widest permanent (px): cards.css's clamp. Past the floor the row scrolls sideways. */
  floor: 58,
  ceil: 200,
  /** Narrowest and widest land card in the bar (px). (A tab is as wide as its name needs, whatever its card.) */
  landFloor: 48,
  landCeil: 132,
  /** The bar's height (px): a tab (24) and the row's padding under it (4). */
  barPx: 28,
  /**
   * The permanents' row is sized as if it shared the half with this much more of a row: enough that the lands,
   * brought up from the bar (`landK` of a permanent, on a 24 px tab), stand clear of the row above them.
   */
  permRows: 1.75,
  /** A card's share of its row's gaps, and a row's side padding (cards.css `--cw-w`). */
  gap: 9,
  rowsPad: 24,
  /** Fewest slots a row is sized for (Board's `--slots-row`, `--slots-lands`). */
  minSlots: 5,
  /** The row's own padding, top and bottom together. */
  vPad: 18,
  /** At or under this height a side gives its row all of it (cards.css `@container side (max-height: 250px)`). */
  shortPx: 250,
} as const;

/**
 * A permanent's and a land's width (px) on a side whose box (without the bar) is `w` by `h`: what cards.css's
 * clamps compute. `permSlots` and `landSlots` are Board's `--slots-row` and `--slots-lands`.
 */
export function deskCardWidths(s: { w: number; h: number; permSlots: number; landSlots: number; attachPx?: number }): { perm: number; land: number } {
  const k = DESK_FIT;
  const rows = s.h <= k.shortPx ? 1 : k.permRows;
  const byH = (s.h - k.vPad - (s.attachPx ?? 0)) / rows / CARD_RATIO;
  const perm = Math.min(k.ceil, Math.max(k.floor, Math.min(byH, (s.w - k.rowsPad) / s.permSlots - k.gap)));
  const landH = (s.h - k.vPad) / rows / CARD_RATIO;
  const land = Math.min(k.landCeil, Math.max(k.landFloor, Math.min(landH * k.landK, (s.w - k.rowsPad) / s.landSlots - k.gap)));
  return { perm, land };
}

/** Which edges of a sideways-scrolling row have more cards past them (for the edge fade). */
export function edgeFade(scrollLeft: number, clientWidth: number, scrollWidth: number, slack = 2): 'start end' | 'start' | 'end' | '' {
  const start = scrollLeft > slack;
  const end = scrollLeft + clientWidth < scrollWidth - slack;
  return start && end ? 'start end' : start ? 'start' : end ? 'end' : '';
}

