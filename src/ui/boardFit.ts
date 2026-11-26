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
 * picture's lower middle (the top third is sky). Two rows of cards fill the
 * half from top to bottom, so wherever a card stands the built part is hidden.
 * While a side's cards fit one line at (nearly) the size two rows give them,
 * they sit in ONE LINE along the top of the half, in the sky: lands at the
 * left (a little smaller), the other permanents in the middle. A side that
 * needs more room keeps its two rows.
 *
 * A card in the line is never bigger than two rows of BOTH kinds would make
 * it, so a side with only lands, or only permanents, has smaller cards than
 * it had when its one row filled the half (a lone creature 108 px wide where
 * it was 190, at 1440x900): the room goes to the picture.
 */
export const DESK_FIT = {
  /** A land is this much of a creature in two rows (cards.css `--land-k`). */
  landK: 0.76,
  /** ... and this much in one line (cards.css `--line-land-k`). */
  lineLandK: 0.66,
  /** Narrowest and widest card (px): cards.css's clamp. */
  floor: 58,
  ceil: 200,
  /** In one line a card may get this narrow while the stack panel takes room from the board (cards.css). */
  lineFloor: 40,
  /** Two rows: a card's share of its row's gaps, and a row's side padding (cards.css `--cw-w`). */
  gap: 9,
  rowsPad: 24,
  /** Two rows: a land counts as this many card widths in Board's `--slots-row`. */
  rowLandSlot: 0.8,
  /** Fewest slots a row is sized for (Board's `--slots-row`). */
  minSlots: 5,
  /** The rows' own padding, top and bottom together. */
  vPad: 18,
  /** A tapped card lies down: this many card widths. */
  tappedK: 1.4,
  /** One line, counted exactly: the gap between two cards of a group, a group's side padding (6 + 6), */
  tileGap: 10,
  groupPad: 12,
  /** the line's two column gaps (24 + 24), and the spacer between creatures and other permanents (6 + a gap). */
  colGaps: 48,
  mixedGap: 16,
  /** One line only while its cards, with EVERY card tapped, keep this share of what two rows give with none tapped. */
  minLine: 0.85,
  /** At or under this height a side has its own layout (cards.css `@container side (max-height: 250px)`). */
  shortPx: 250,
} as const;

/** One line of cards: its width in card widths, and how many gaps and groups it has. */
export interface LineShape {
  /** The permanents' width in card widths (a tapped one is `tappedK`), and how many there are. */
  permUnits: number;
  permTiles: number;
  /** Creatures and other permanents both (a spacer between them). */
  mixed: boolean;
  /** The land piles' width in LAND widths, and how many piles. */
  landUnits: number;
  landPiles: number;
}

/**
 * What cards.css needs to size a line so it exactly fits: the pixels that are
 * not cards (`--line-fixed`) and the cards' width in card widths
 * (`--line-units`); a card is then (the side's width - fixed) / units wide.
 */
export function lineMeasure(s: LineShape): { fixedPx: number; units: number } {
  const k = DESK_FIT;
  const fixedPx =
    k.colGaps +
    (s.permTiles > 0 ? k.groupPad + (s.permTiles - 1) * k.tileGap + (s.mixed ? k.mixedGap : 0) : 0) +
    (s.landPiles > 0 ? k.groupPad + (s.landPiles - 1) * k.tileGap : 0);
  return { fixedPx, units: Math.max(1, s.permUnits + s.landUnits * k.lineLandK) };
}

/**
 * How wide a side's lands are, in land widths, and in how many piles: at
 * their narrowest (nothing tapped: a pile per basic name) and at their widest,
 * whatever is tapped (a name with some tapped is two piles). `basics` is how
 * many lands each plain basic name has, `others` the lands that stand alone.
 * Tapping a land must never change the side's layout, so the layout is chosen
 * from these, not from what is tapped now.
 */
export function landsWeights(basics: number[], others: number, shown = 4): { best: number; worst: number; worstPiles: number } {
  const pile = (n: number, tapped: boolean) => (n <= 0 ? 0 : (tapped ? DESK_FIT.tappedK : 1) + 0.2 * (Math.min(n, shown) - 1));
  let best = others;
  let worst = others * DESK_FIT.tappedK;
  let worstPiles = others;
  for (const n of basics) {
    best += pile(n, false);
    let w = 0;
    for (let k = 0; k <= n; k++) w = Math.max(w, pile(n - k, false) + pile(k, true));
    worst += w;
    worstPiles += n >= 2 ? 2 : 1;
  }
  return { best, worst, worstPiles };
}

export interface DeskSide {
  /**
   * The side's battlefield, content box (px). 0 until it has been measured. `w` is its width with no spell on the
   * stack (Board: the widest since the window last changed size), so casting a spell never changes the layout.
   */
  w: number;
  h: number;
  /** Permanents that are not lands. */
  permanents: number;
  /** Creatures and other permanents both (a small gap between them). */
  mixed: boolean;
  /** Its lands: how many each plain basic name has, and the lands that stand alone. */
  basics: number[];
  others: number;
  /** Room under the permanents for auras and equipment (px). */
  attachPx: number;
}

/**
 * The two card widths the choice is made from: two rows at their best (nothing
 * tapped) and one line at its worst (every card tapped, every land name in two
 * piles). Both are what cards.css computes for those cards, before its floor
 * (a width under `floor` means the cards do not fit and the row would scroll).
 */
export function deskCardWidths(s: DeskSide): { rows: number; line: number } {
  const k = DESK_FIT;
  const lands = landsWeights(s.basics, s.others);
  const byHeight = (s.h - k.vPad - s.attachPx) / (1 + k.landK) / CARD_RATIO;
  const rowSlots = Math.max(k.minSlots, s.permanents + (s.mixed ? 0.15 : 0), lands.best * k.rowLandSlot);
  const rows = Math.min(k.ceil, byHeight, (s.w - k.rowsPad) / rowSlots - k.gap);
  const m = lineMeasure({ permUnits: s.permanents * k.tappedK, permTiles: s.permanents, mixed: s.mixed, landUnits: lands.worst, landPiles: lands.worstPiles });
  const line = Math.min(k.ceil, byHeight, (s.w - m.fixedPx) / m.units);
  return { rows, line };
}

/**
 * Does this desktop side lay its cards in one line along the top (the sky of
 * its place's picture)? Yes while the line's cards, at their worst, are no
 * narrower than the floor and keep `minLine` of what two rows would give at
 * their best: one line never costs a card more than that, and a side too full
 * for it has its two rows, which scroll. Not before the side is measured, and
 * not a short side (cards.css lays that one out itself).
 */
export function deskSideLine(s: DeskSide): boolean {
  if (!(s.w > 0 && s.h > DESK_FIT.shortPx)) return false;
  if (s.permanents === 0 && s.basics.length + s.others === 0) return false;
  const cw = deskCardWidths(s);
  return cw.line >= Math.max(DESK_FIT.floor, DESK_FIT.minLine * cw.rows);
}

/** Which edges of a sideways-scrolling row have more cards past them (for the edge fade). */
export function edgeFade(scrollLeft: number, clientWidth: number, scrollWidth: number, slack = 2): 'start end' | 'start' | 'end' | '' {
  const start = scrollLeft > slack;
  const end = scrollLeft + clientWidth < scrollWidth - slack;
  return start && end ? 'start end' : start ? 'start' : end ? 'end' : '';
}

