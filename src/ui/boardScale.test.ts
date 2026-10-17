/*
 * ForgeCoach — ui/boardScale.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A replay's (and a watch's) board fills the column between the decisions
 * list and the coach, and its cards grow with it through one token, --tile-w,
 * between today's 100px and a 150px ceiling (Justin's watch, item 5: at 2000
 * wide the board sat in an 1100px box with empty margins). Phones keep their
 * own sizes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cards = readFileSync(new URL('./cards.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The tile width the board-column rule gives a column `col` px wide (its clamp, evaluated). */
function tileW(col: number): number {
  const m = /\.game\.is-wide \.col-board > \.board\s*{[^}]*--tile-w:\s*clamp\((\d+)px,\s*calc\(\(100cqi - (\d+)px\) \/ (\d+)\),\s*(\d+)px\)/.exec(styles);
  if (!m) throw new Error('no --tile-w rule on the board column');
  const [lo, pad, n, hi] = m.slice(1).map(Number) as [number, number, number, number];
  return Math.max(lo, Math.min(hi, (col - pad) / n));
}
/** The board column at a window `w` wide: the 296 / 400 side panels (256 / 352 under 1280). */
const colAt = (w: number) => (w < 1280 ? w - 256 - 352 : w - 296 - 400);

describe('the board scales with the window', () => {
  it('the board column is a size container and the board has no fixed width there', () => {
    expect(styles).toMatch(/\.game\.is-wide \.col-board\s*{[^}]*container:\s*board-col \/ inline-size/);
    expect(styles).toMatch(/\.game\.is-wide \.col-board > \.board\s*{[^}]*max-width:\s*none/);
  });
  it('cards grow from 100px at 1440 to the 150px ceiling, never smaller than before', () => {
    expect(tileW(colAt(1024))).toBe(100);
    expect(tileW(colAt(1440))).toBe(100);
    expect(tileW(colAt(1920))).toBeCloseTo(119.2, 1);
    expect(tileW(colAt(2000))).toBeCloseTo(127.2, 1);
    expect(tileW(colAt(2560))).toBe(150);
    expect(tileW(colAt(3840))).toBe(150);
  });
  it('every row size is a share of the one token, as before at 100px', () => {
    const want: Record<string, number> = { '.bf-row-lands': 0.88, '.bf-row.is-dense': 0.86, '.bf-row-lands.is-dense': 0.78, '.bf-row.is-crowded': 0.74, '.bf-row-lands.is-crowded': 0.68 };
    for (const [sel, k] of Object.entries(want)) {
      const re = new RegExp(`\\n${sel.replace(/\./g, '\\.')} {\\s*--cw: calc\\(var\\(--tile-w, 100px\\) \\* ([\\d.]+)\\);`);
      expect(Number(re.exec(cards)?.[1]), sel).toBe(k);
    }
    expect(cards).toMatch(/\.hand-tiles {\s*--cw: var\(--tile-w, 100px\);/);
  });
  it('phones keep their own pixel sizes', () => {
    const phone = cards.slice(cards.indexOf('@media (max-width: 560px)'));
    expect(phone).toMatch(/\.board {\s*--cw: 86px;/);
  });
});
