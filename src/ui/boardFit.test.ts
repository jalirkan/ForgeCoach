/*
 * ForgeCoach — ui/boardFit.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { CARD_RATIO, edgeFade, PHONE_FIT, phoneCardWidth, phoneSideFit } from './boardFit.ts';

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
