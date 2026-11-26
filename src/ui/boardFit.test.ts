/*
 * ForgeCoach — ui/boardFit.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_RATIO, DESK_FIT, deskCardWidths, deskSideLine, edgeFade, landsWeights, lineMeasure, PHONE_FIT, phoneCardWidth, phoneSideFit, type DeskSide } from './boardFit.ts';

describe('phoneSideFit', () => {
  it('counts a lands row as landK of a creature row', () => {
    expect(phoneSideFit({ permanents: true, lands: true, maxAttach: 0 }).rowsH).toBeCloseTo(1 + PHONE_FIT.landK);
    expect(phoneSideFit({ permanents: true, lands: false, maxAttach: 0 }).rowsH).toBe(1);
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 0 }).rowsH).toBeCloseTo(PHONE_FIT.landK);
  });

  it('adds row paddings, the separator and the side padding', () => {
    const k = PHONE_FIT;
    expect(phoneSideFit({ permanents: true, lands: true, maxAttach: 0 }).padPx).toBe(k.sidePad + 2 * k.rowPad + k.rowSep);
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 0 }).padPx).toBe(k.sidePad + k.rowPad);
  });

  it('leaves room for the deepest pile of auras and equipment', () => {
    const none = phoneSideFit({ permanents: true, lands: true, maxAttach: 0 });
    const two = phoneSideFit({ permanents: true, lands: true, maxAttach: 2 });
    expect(two.padPx - none.padPx).toBe(2 * PHONE_FIT.attachPx);
    // Attachments hang under permanents; a lands-only side has none.
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 2 }).padPx).toBe(PHONE_FIT.sidePad + PHONE_FIT.rowPad);
  });

  it('gives a side its rows at the floor size as its minimum', () => {
    const fit = phoneSideFit({ permanents: true, lands: true, maxAttach: 1 });
    const floorH = PHONE_FIT.floor * CARD_RATIO;
    expect(fit.minPx).toBe(Math.ceil(fit.padPx + floorH + PHONE_FIT.landK * floorH));
    // At that height the cards are exactly at the floor, never smaller.
    expect(phoneCardWidth(fit, fit.minPx)).toBeCloseTo(PHONE_FIT.floor, 0);
    expect(phoneCardWidth(fit, fit.minPx - 40)).toBe(PHONE_FIT.floor);
  });

  it('an empty side keeps one line for "No permanents"', () => {
    const fit = phoneSideFit({ permanents: false, lands: false, maxAttach: 0 });
    expect(fit.minPx).toBe(PHONE_FIT.sidePad + PHONE_FIT.emptyPx);
    // play.css sums --fit-pad + --fit-rows × floor height: the same number.
    expect(fit.padPx + fit.rowsH * PHONE_FIT.floor * CARD_RATIO).toBe(fit.minPx);
  });

  it('grows cards with the height up to the ceiling', () => {
    const fit = phoneSideFit({ permanents: true, lands: true, maxAttach: 0 });
    expect(phoneCardWidth(fit, 260)).toBeGreaterThan(phoneCardWidth(fit, 200));
    expect(phoneCardWidth(fit, 2000)).toBe(PHONE_FIT.ceil);
  });

  it('takes a smaller floor (short phones)', () => {
    const shape = { permanents: true, lands: true, maxAttach: 0 };
    expect(phoneSideFit(shape, { ...PHONE_FIT, floor: 48 }).minPx).toBeLessThan(phoneSideFit(shape).minPx);
  });
});

describe('edgeFade', () => {
  it('fades only the edges with cards past them', () => {
    expect(edgeFade(0, 300, 300)).toBe('');
    expect(edgeFade(0, 300, 600)).toBe('end');
    expect(edgeFade(150, 300, 600)).toBe('start end');
    expect(edgeFade(300, 300, 600)).toBe('start');
  });
  it('ignores sub-pixel rounding', () => {
    expect(edgeFade(0.5, 300, 301)).toBe('');
  });
});


describe('landsWeights', () => {
  it('counts a lone land as one that may lie tapped', () => {
    expect(landsWeights([1], 0)).toEqual({ best: 1, worst: DESK_FIT.tappedK, worstPiles: 1 });
    expect(landsWeights([], 2).worst).toBeCloseTo(2 * DESK_FIT.tappedK);
    expect(landsWeights([], 2).best).toBe(2);
    expect(landsWeights([], 2).worstPiles).toBe(2);
  });

  it('counts a basic name with two or more as two piles at its widest, one of them tapped', () => {
    // one untapped (1) + one tapped (1.4); at its narrowest one pile of two
    expect(landsWeights([2], 0).worst).toBeCloseTo(2.4);
    expect(landsWeights([2], 0).best).toBeCloseTo(1.2);
    expect(landsWeights([2], 0).worstPiles).toBe(2);
    // the widest split of four: two and two (1.2 + 1.6)
    expect(landsWeights([4], 0).worst).toBeCloseTo(2.8);
    // a pile shows four at most, so more lands of a name stop adding width
    expect(landsWeights([12], 0).worst).toBeCloseTo(landsWeights([8], 0).worst);
  });

  it('bounds what the table shows, whatever is tapped', () => {
    // 3 Islands and 2 Swamps, every way to tap them (the table: a pile per name and tapped state).
    const shown = (n: number, tapped: boolean) => (n ? (tapped ? 1.4 : 1) + 0.2 * (Math.min(n, 4) - 1) : 0);
    const { best, worst, worstPiles } = landsWeights([3, 2], 0);
    for (let a = 0; a <= 3; a++) {
      for (let b = 0; b <= 2; b++) {
        const now = shown(3 - a, false) + shown(a, true) + shown(2 - b, false) + shown(b, true);
        const piles = [3 - a, a, 2 - b, b].filter((n) => n > 0).length;
        expect(now).toBeLessThanOrEqual(worst + 1e-9);
        expect(now).toBeGreaterThanOrEqual(best - 1e-9);
        expect(piles).toBeLessThanOrEqual(worstPiles);
      }
    }
  });
});

describe('lineMeasure', () => {
  it('counts every pixel of the line that is not a card', () => {
    const k = DESK_FIT;
    // Two land piles and three permanents of two kinds: both groups' padding, the two column gaps, the gaps between cards, the spacer.
    expect(lineMeasure({ permUnits: 3, permTiles: 3, mixed: true, landUnits: 2.2, landPiles: 2 })).toEqual({
      fixedPx: k.colGaps + (k.groupPad + 2 * k.tileGap + k.mixedGap) + (k.groupPad + k.tileGap),
      units: 3 + 2.2 * k.lineLandK,
    });
    // Lands only: no permanents group.
    expect(lineMeasure({ permUnits: 0, permTiles: 0, mixed: false, landUnits: 1, landPiles: 1 }).fixedPx).toBe(k.colGaps + k.groupPad);
  });

  it('gives a card width at which the line is exactly as wide as the side', () => {
    const k = DESK_FIT;
    const shape = { permUnits: 2 + k.tappedK, permTiles: 3, mixed: false, landUnits: 1.2 + 1.4, landPiles: 2 };
    const m = lineMeasure(shape);
    const side = 700;
    const cw = (side - m.fixedPx) / m.units;
    const cards = shape.permUnits * cw + shape.landUnits * k.lineLandK * cw;
    expect(cards + m.fixedPx).toBeCloseTo(side);
  });
});

describe('deskSideLine', () => {
  // A side of the desktop table at 1440x900.
  const side = (o: Partial<DeskSide>): DeskSide => ({ w: 880, h: 284, permanents: 0, mixed: false, basics: [], others: 0, attachPx: 0, ...o });

  it('is two rows until the side has been measured, and on an empty side', () => {
    expect(deskSideLine(side({ w: 0, h: 0, permanents: 1, basics: [1] }))).toBe(false);
    expect(deskSideLine(side({}))).toBe(false);
  });

  it('leaves a short side to its own layout', () => {
    expect(deskSideLine(side({ h: DESK_FIT.shortPx, permanents: 1, basics: [1] }))).toBe(false);
    expect(deskSideLine(side({ h: DESK_FIT.shortPx + 1, permanents: 1, basics: [1] }))).toBe(true);
  });

  it('puts a side with only lands, or only permanents, in one line while it fits', () => {
    expect(deskSideLine(side({ basics: [3, 2], others: 1 }))).toBe(true);
    expect(deskSideLine(side({ permanents: 4 }))).toBe(true);
    // ... and not when its cards would be under the floor: two rows scroll, the line's lands cannot (the review, 2).
    expect(deskSideLine(side({ w: 600, h: 400, others: 9 }))).toBe(false);
    expect(deskSideLine(side({ permanents: 12 }))).toBe(false);
  });

  it('keeps one line through the early turns and goes to two rows when the side fills', () => {
    // Turn 4: four basics of two names, two creatures.
    expect(deskSideLine(side({ permanents: 2, basics: [2, 2] }))).toBe(true);
    // A full side: seven lands of three names, six permanents.
    expect(deskSideLine(side({ permanents: 6, mixed: true, basics: [3, 3], others: 1 }))).toBe(false);
  });

  it('a crowded side is two rows (a real game, turn 15: nine permanents, six lands)', () => {
    expect(deskSideLine(side({ w: 878, permanents: 9, mixed: true, basics: [1, 3, 2] }))).toBe(false);
  });

  it('a side too full for either layout is two rows, which scroll: never the line again (the review, 1)', () => {
    for (const s of [
      side({ w: 700, permanents: 14, mixed: true, basics: [4, 4, 3], others: 4 }),
      side({ permanents: 20, basics: [5, 5], others: 2 }),
      side({ permanents: 30, basics: [8], attachPx: 34 }),
    ]) {
      const cw = deskCardWidths(s);
      expect(cw.rows).toBeLessThan(DESK_FIT.floor);
      expect(cw.line).toBeLessThan(DESK_FIT.floor);
      expect(deskSideLine(s)).toBe(false);
    }
  });

  it('once a side has left the line, more cards never bring it back', () => {
    for (const w of [600, 880, 1274, 1700]) {
      for (const h of [260, 284, 367, 480]) {
        for (const basics of [[1], [2, 2], [3, 3], [4, 3, 1], [6, 5]]) {
          let left = false;
          for (let permanents = 1; permanents <= 30; permanents++) {
            const line = deskSideLine(side({ w, h, permanents, basics }));
            if (left) expect(line).toBe(false);
            if (!line) left = true;
          }
        }
      }
    }
  });

  it('in the line a card is at least the floor and the promised share of its two-row size, whatever is tapped', () => {
    const k = DESK_FIT;
    for (const w of [700, 880, 1274, 1600]) {
      for (const h of [260, 284, 367, 480]) {
        for (let permanents = 1; permanents <= 9; permanents++) {
          for (const basics of [[1], [2, 2], [3, 3], [4, 3, 1]]) {
            const s = side({ w, h, permanents, basics, others: 1 });
            if (!deskSideLine(s)) continue;
            const rows = deskCardWidths(s).rows;
            const byHeight = (h - k.vPad) / (1 + k.landK) / CARD_RATIO;
            // Every way to tap: `t` permanents tapped, each basic name split `a` untapped / the rest tapped, the lone land tapped or not.
            const pile = (n: number, tapped: boolean) => (n ? (tapped ? k.tappedK : 1) + 0.2 * (Math.min(n, 4) - 1) : 0);
            for (let t = 0; t <= permanents; t++) {
              for (const lone of [1, k.tappedK]) {
                for (const frac of [0, 0.5, 1]) {
                  const split = basics.map((n) => Math.round(n * frac));
                  const landUnits = lone + basics.reduce((sum, n, i) => sum + pile(n - split[i]!, false) + pile(split[i]!, true), 0);
                  const landPiles = 1 + basics.reduce((sum, n, i) => sum + Number(n - split[i]! > 0) + Number(split[i]! > 0), 0);
                  const m = lineMeasure({ permUnits: permanents - t + t * k.tappedK, permTiles: permanents, mixed: false, landUnits, landPiles });
                  const cw = Math.min(byHeight, (w - m.fixedPx) / m.units);
                  expect(cw).toBeGreaterThanOrEqual(k.floor - 1e-9);
                  expect(cw).toBeGreaterThanOrEqual(k.minLine * rows - 1e-9);
                }
              }
            }
          }
        }
      }
    }
  });

  it('a wider window holds one line longer', () => {
    const s = { permanents: 4, basics: [3, 3] };
    expect(deskSideLine(side({ ...s, w: 880, h: 284 }))).toBe(false);
    expect(deskSideLine(side({ ...s, w: 1370, h: 367 }))).toBe(true);
  });

  it('cards.css and Board carry the same numbers', () => {
    const css = readFileSync(new URL('./cards.css', import.meta.url), 'utf8');
    const board = readFileSync(new URL('./Board.tsx', import.meta.url), 'utf8');
    expect(css).toContain(`--land-k: ${DESK_FIT.landK};`);
    expect(css).toContain(`--line-land-k: ${DESK_FIT.lineLandK};`);
    expect(css).toContain(`@container side (max-height: ${DESK_FIT.shortPx}px)`);
    expect(css).toContain(`--cw-fit: clamp(${DESK_FIT.floor}px, min(var(--cw-h), var(--cw-w)), ${DESK_FIT.ceil}px)`);
    expect(css).toContain(`--cw-fit: clamp(${DESK_FIT.lineFloor}px, min(var(--cw-h), var(--cw-w)), ${DESK_FIT.ceil}px)`);
    expect(css).toContain('--cw-w: calc((100cqw - var(--line-fixed, 72px)) / var(--line-units, 8));');
    expect(css).toContain(`calc((100cqw - ${DESK_FIT.rowsPad}px) / var(--slots-row, 6) - ${DESK_FIT.gap}px)`);
    expect(css).toContain(`calc((100cqh - ${DESK_FIT.vPad}px - var(--attach-h, 0px)) / var(--rows-h) * 63 / 88)`);
    // The line's own pixels: the column gaps, a group's padding, the gap between cards (the desktop table's .bf-cards), the spacer.
    expect(css).toContain(`column-gap: ${DESK_FIT.colGaps / 2}px;`);
    expect(css).toMatch(new RegExp(`\\.game\\.play\\.is-wide \\.play-board \\.bf-cards \\{[^}]*gap: 8px ${DESK_FIT.tileGap}px;[^}]*padding: 5px ${DESK_FIT.groupPad / 2}px 4px;`));
    expect(css).toMatch(/\.bf-gap \{\s*flex: none;\s*width: 6px;/);
    expect(DESK_FIT.mixedGap).toBe(6 + DESK_FIT.tileGap);
    // Board sizes two rows with the same factors.
    expect(board).toContain("'--slots-row': Math.max(DESK_FIT.minSlots, permWeight, landWeight * DESK_FIT.rowLandSlot)");
    expect(board).toContain("'--attach-h': `${attachPx}px`");
  });
});
