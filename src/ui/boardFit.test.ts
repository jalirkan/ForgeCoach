/*
 * ForgeCoach — ui/boardFit.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_RATIO, DESK_FIT, deskCardWidths, edgeFade, PHONE_FIT, phoneCardWidth, phoneSideFit } from './boardFit.ts';

describe('phoneSideFit', () => {
  const both = { permanents: true, lands: true, maxAttach: 0 };

  it('the lands are a bar, not a row: only the permanents count as a row of cards', () => {
    expect(phoneSideFit(both).rowsH).toBe(1);
    expect(phoneSideFit({ permanents: true, lands: false, maxAttach: 0 }).rowsH).toBe(1);
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 0 }).rowsH).toBe(0);
  });

  it('adds the row padding, the side padding and the lands bar', () => {
    const k = PHONE_FIT;
    expect(phoneSideFit(both).padPx).toBe(k.sidePad + k.rowPad + k.barPx);
    expect(phoneSideFit({ permanents: true, lands: false, maxAttach: 0 }).padPx).toBe(k.sidePad + k.rowPad);
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 0 }).padPx).toBe(k.sidePad + k.barPx);
  });

  it('leaves room for the deepest pile of auras and equipment', () => {
    const two = phoneSideFit({ ...both, maxAttach: 2 });
    expect(two.padPx - phoneSideFit(both).padPx).toBe(2 * PHONE_FIT.attachPx);
    // Attachments hang under permanents; a lands-only side has none.
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 2 }).padPx).toBe(PHONE_FIT.sidePad + PHONE_FIT.barPx);
  });

  it('gives a side its row at the floor size, and the bar, as its minimum', () => {
    const fit = phoneSideFit({ ...both, maxAttach: 1 });
    expect(fit.minPx).toBe(Math.ceil(fit.padPx + PHONE_FIT.floor * CARD_RATIO));
    // play.css sums --fit-pad + --fit-rows × floor height: the same number.
    expect(Math.ceil(fit.padPx + fit.rowsH * PHONE_FIT.floor * CARD_RATIO)).toBe(fit.minPx);
    // At that height (and under it) the cards are at the floor, never smaller.
    expect(phoneCardWidth(fit, fit.minPx)).toBe(PHONE_FIT.floor);
    expect(phoneCardWidth(fit, fit.minPx - 40)).toBe(PHONE_FIT.floor);
    // A lands-only side is its bar.
    expect(phoneSideFit({ permanents: false, lands: true, maxAttach: 0 }).minPx).toBe(PHONE_FIT.sidePad + PHONE_FIT.barPx);
  });

  it('an empty side keeps one line for "No permanents"', () => {
    const fit = phoneSideFit({ permanents: false, lands: false, maxAttach: 0 });
    expect(fit.minPx).toBe(PHONE_FIT.sidePad + PHONE_FIT.emptyPx);
    expect(fit.padPx + fit.rowsH * PHONE_FIT.floor * CARD_RATIO).toBe(fit.minPx);
  });

  it('grows cards with the height up to the ceiling', () => {
    const fit = phoneSideFit(both);
    expect(phoneCardWidth(fit, 260)).toBeGreaterThan(phoneCardWidth(fit, 232));
    expect(phoneCardWidth(fit, 232)).toBeCloseTo((232 - fit.padPx) / PHONE_FIT.permRows / CARD_RATIO, 5);
    expect(phoneCardWidth(fit, 2000)).toBe(PHONE_FIT.ceil);
  });

  it('takes a smaller floor (short phones)', () => {
    expect(phoneSideFit(both, { ...PHONE_FIT, floor: 48 }).minPx).toBeLessThan(phoneSideFit(both).minPx);
  });

  it('leaves the middle of the picture, where the place is built, open', () => {
    // What the lands build sits at about 44% to 71% of a side's height (the phone picture, scenery spec). The
    // row (the side's 2 px, its 5 px above the cards, the cards) ends above the middle of that band, and the
    // tabs (30 px and 3 under them) start below it, at every height from a phone's side with the hand open
    // (176 px at 390x844) to a tablet's.
    for (let h = 176; h <= 420; h += 4) {
      const fit = phoneSideFit(both);
      const rowEnd = 2 + 5 + phoneCardWidth(fit, h) * CARD_RATIO;
      expect(rowEnd / h, `row, a side ${h} px high`).toBeLessThan(0.52);
      expect((h - PHONE_FIT.tabPx - 3) / h, `bar, a side ${h} px high`).toBeGreaterThan(0.71);
    }
  });

  it('play.css and cards.css carry the same numbers', () => {
    const play = readFileSync(new URL('./play/play.css', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./cards.css', import.meta.url), 'utf8');
    const k = PHONE_FIT;
    const phone = play.slice(play.indexOf('@media (max-width: 1023px) and (orientation: portrait) {'), play.indexOf('/* ---- phone in landscape'));
    expect(phone).toContain(`--fit-floor: ${k.floor}px;`);
    expect(phone).toContain(`--perm-rows: ${k.permRows};`);
    // 100cqh is the side's content box and --fit-pad counts the side's own padding: the CSS adds it back, so
    // the card is (border-box height - padPx) / permRows, which is phoneCardWidth
    expect(phone).toContain(`--cw-fit: clamp(var(--fit-floor), calc((100cqh + ${k.sidePad}px - var(--fit-pad, 13px)) / var(--perm-rows) * 63 / 88), ${k.ceil}px);`);
    expect(readFileSync(new URL('./styles.css', import.meta.url), 'utf8')).toMatch(/box-sizing: border-box;/);
    expect(phone).toContain('min-height: calc(var(--fit-pad, 13px) + var(--fit-rows, 1) * var(--fit-floor) * 88 / 63);');
    expect(k.sidePad + k.rowPad).toBe(13);
    expect(phone).toMatch(/\.play-phone-main \.battlefield,\s*\.play-phone-main \.player-top \.battlefield \{\s*padding: 2px 8px;/);
    expect(phone).toMatch(/\.play-phone-main \.bf-cards \{\s*padding-top: 5px;\s*padding-bottom: 4px;/);
    // the bar: a tab, 3 px under it, and the 10 px above it that still take a finger
    expect(phone).toContain(`--tab-h: ${k.tabPx}px;`);
    expect(phone).toMatch(/\.bf-row-lands > \.bf-cards \{[^}]*padding: 0 8px 3px;/);
    expect(phone).toMatch(/\.bf-row-lands \.tile \{[^}]*padding-top: 10px;/);
    expect(k.barPx).toBe(k.tabPx + 3 + 10);
    // the land cards never come up on a phone; the tab is turned on here and on the desktop table, nowhere else
    expect(phone).toMatch(/\.play-phone-main \.bf-row-lands \.tile-slot \{\s*display: none;/);
    expect(phone).toMatch(/\.play-phone-main \.bf-row-lands \.land-tab \{\s*display: flex;/);
    expect(css).toMatch(/\n\.land-tab \{\s*display: none;\s*\}/);
    expect([...(play + css).matchAll(/\.land-tab \{\s*display: flex;/g)].length).toBe(2);
    // a tab's least width is measured by the browser from the name's sizer; neither the sizer nor the name may be
    // a scroll box (it would have no least width), and outside the phone's bar the sizer is not there at all
    expect(phone).toMatch(/\.land-tab-size \{\s*grid-area: 1 \/ 1;\s*display: block;\s*height: 0;\s*visibility: hidden;\s*white-space: normal;\s*overflow-wrap: anywhere;\s*\}/);
    expect(phone).toMatch(/\.land-tab-text,\s*\.play-phone-main \.bf-row-lands \.land-tab-short \{\s*display: block;\s*grid-area: 1 \/ 1;\s*width: 0;\s*min-width: 100%;/);
    expect(phone).toMatch(/\.land-tab-name\.has-short \.land-tab-text \{\s*display: none;/);
    expect(phone).toMatch(/\.land-tab-name \{\s*display: grid;\s*grid-template-columns: 1fr;\s*min-width: auto;\s*overflow: clip;/);
    expect(phone).toMatch(/\.bf-row-lands \.tile \{\s*min-width: auto;/);
    expect(css).toMatch(/\n\.land-tab-size,\s*\.land-tab-short \{\s*display: none;\s*\}/);
    // an empty side's line is centred again
    expect(phone).toMatch(/\.battlefield > \.bf-empty \{\s*margin-block: auto;/);
    // attachments: one line each (attachPx = the chip and its gap)
    expect(phone).toMatch(/\.play-phone-main \.attach-chip \{\s*height: 18px;/);
    expect(k.attachPx).toBe(18 + 1);
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


describe('the desktop table (deskCardWidths)', () => {
  // A side at 1920x1080 (about 980 by 365 px, the bar taken off) and at 1440x900 (about 760 by 280).
  const hd = { w: 980, h: 365 - DESK_FIT.barPx };
  const d = { w: 760, h: 280 - DESK_FIT.barPx };

  it('sizes a permanent from the height, as if the row shared the half with part of another', () => {
    const w = deskCardWidths({ ...hd, permSlots: 5, landSlots: 5 }).perm;
    expect(w).toBeCloseTo((hd.h - DESK_FIT.vPad) / DESK_FIT.permRows / CARD_RATIO, 5);
    // the row's cards and the bar leave the lower middle of the picture open: under two thirds of the half
    expect((w * CARD_RATIO + DESK_FIT.vPad + DESK_FIT.barPx) / 365).toBeLessThan(0.67);
  });

  it('a lone creature is no bigger than the same side full of lands: the lands take no room from the row', () => {
    const none = deskCardWidths({ ...hd, permSlots: 5, landSlots: 5 }).perm;
    const many = deskCardWidths({ ...hd, permSlots: 5, landSlots: 14 }).perm;
    expect(many).toBe(none);
  });

  it('a full row shrinks to the floor and no further (it scrolls)', () => {
    expect(deskCardWidths({ ...d, permSlots: 9, landSlots: 5 }).perm).toBeCloseTo((d.w - DESK_FIT.rowsPad) / 9 - DESK_FIT.gap, 5);
    expect(deskCardWidths({ ...d, permSlots: 30, landSlots: 5 }).perm).toBe(DESK_FIT.floor);
  });

  it('auras and equipment under a host take their height from the cards', () => {
    const bare = deskCardWidths({ ...hd, permSlots: 5, landSlots: 5 }).perm;
    expect(deskCardWidths({ ...hd, permSlots: 5, landSlots: 5, attachPx: 34 }).perm).toBeLessThan(bare);
  });

  it('a land brought up from the bar is landK of a permanent, and stands clear of the row above it', () => {
    const { perm, land } = deskCardWidths({ ...hd, permSlots: 5, landSlots: 5 });
    expect(land).toBeCloseTo(perm * DESK_FIT.landK, 5);
    // The permanents' row from the top; the land, its 3 px foot, the row's 6 px of padding and the bar from the
    // bottom: they do not meet, at any height a side has above the short one (whose single row fills it).
    for (let total = DESK_FIT.shortPx + DESK_FIT.barPx + 1; total <= 700; total += 3) {
      const c = deskCardWidths({ w: 1200, h: total - DESK_FIT.barPx, permSlots: 5, landSlots: 5 });
      expect(c.perm * CARD_RATIO + DESK_FIT.vPad + c.land * CARD_RATIO + 3 + 6 + DESK_FIT.barPx, `a side ${total} px high`).toBeLessThan(total);
    }
  });

  it('a land card keeps a floor and a ceiling, however many piles there are', () => {
    expect(deskCardWidths({ ...d, permSlots: 5, landSlots: 30 }).land).toBe(DESK_FIT.landFloor);
    expect(deskCardWidths({ w: 3000, h: 900, permSlots: 5, landSlots: 5 }).land).toBe(DESK_FIT.landCeil);
  });

  it('a short side gives its one row the height it has', () => {
    const short = { w: 900, h: DESK_FIT.shortPx - 20 };
    expect(deskCardWidths({ ...short, permSlots: 5, landSlots: 5 }).perm).toBeCloseTo((short.h - DESK_FIT.vPad) / CARD_RATIO, 5);
  });

  it('cards.css and Board carry the same numbers', () => {
    const css = readFileSync(new URL('./cards.css', import.meta.url), 'utf8');
    const board = readFileSync(new URL('./Board.tsx', import.meta.url), 'utf8');
    expect(css).toContain(`--land-k: ${DESK_FIT.landK};`);
    expect(css).toContain(`--bar-h: ${DESK_FIT.barPx}px;`);
    expect(css).toContain(`--perm-rows: ${DESK_FIT.permRows};`);
    expect(css).toMatch(new RegExp(`@container side \\(max-height: ${DESK_FIT.shortPx}px\\) \\{[^}]*\\{\\s*--perm-rows: 1;`));
    expect(css).toContain(`--cw: clamp(${DESK_FIT.floor}px, min(var(--cw-h), var(--cw-w)), ${DESK_FIT.ceil}px);`);
    expect(css).toContain(`--cw: clamp(${DESK_FIT.landFloor}px, min(calc(var(--cw-h) * var(--land-k)), var(--cw-w)), ${DESK_FIT.landCeil}px);`);
    expect(css).toContain(`calc((100cqw - ${DESK_FIT.rowsPad}px) / var(--slots-row, ${DESK_FIT.minSlots}) - ${DESK_FIT.gap}px)`);
    expect(css).toContain(`calc((100cqw - ${DESK_FIT.rowsPad}px) / var(--slots-lands, ${DESK_FIT.minSlots}) - ${DESK_FIT.gap}px)`);
    expect(css).toContain(`calc((100cqh - ${DESK_FIT.vPad}px - var(--attach-h, 0px)) / var(--perm-rows) * 63 / 88)`);
    expect(css).toContain(`calc((100cqh - ${DESK_FIT.vPad}px) / var(--perm-rows) * 63 / 88)`);
    // the bar: a tab and the row's padding under it
    expect(css).toMatch(/\.bf-row-lands \.land-tab \{[^}]*height: var\(--tab-h, 24px\);/);
    expect(css).toMatch(/\.bf-row-lands > \.bf-cards \{[^}]*padding: 6px 8px 4px;/);
    expect(DESK_FIT.barPx).toBe(24 + 4);
    // the lands come up for the pointer only (a clicked land keeps the focus; the next key would hold them up)
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.game\.play\.is-wide \.play-board \.bf-row-lands:hover \.tile-slot \{/);
    expect(css).not.toMatch(/\.bf-row-lands:(focus-within|has\(:focus)/);
    // ... and while the game asks for a choice among them; until they are up nothing of a card is drawn
    expect(css).toContain('.bf-row-lands:has(.tile.is-select, .tile.is-chosen) .tile-slot {');
    expect(css).toMatch(/\.bf-row-lands \.tile-slot \{\s*height: 0;\s*visibility: hidden;/);
    expect(board).not.toMatch(/--ch-lands|--ch-perm|is-line/);
    // outside the two lands bars (this one and the upright phone board's) a land has no tab
    expect(css).toMatch(/\n\.land-tab \{\s*display: none;\s*\}/);
    expect(board).toContain("'--slots-row': Math.max(DESK_FIT.minSlots, permWeight)");
    expect(board).toContain("'--slots-lands': Math.max(DESK_FIT.minSlots, landWeight)");
    expect(board).toContain("'--attach-h': `${attachPx}px`");
  });
});
