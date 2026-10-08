// ForgeCoach — scripts/j111-blue/gen.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blueRowsFrom, renderModule, type BlueRow } from './gen.ts';
import { BLUE_J111 } from '../../src/draft/blueJ111.ts';

/** One cube in blue.json's shape (J111's fair_fight entry, trimmed to the fields read). */
const FIXTURE = {
  per_cube: {
    fair_fight: {
      key: 'fair-fight',
      rates: { drafts: 7434, blue_deck_share: 0.7215 },
      balance: { expected_blue_deck_share: 0.3963 },
      blue_share_over_expected: 1.821,
      score: { uncontested_model: { ok: 1, b0_rate: 0.3629, b0_rate_ci: [0.3225, 0.4052] } },
    },
  },
};

describe('J111 blue generator', () => {
  it('reads blue.json’s per-cube fields', () => {
    expect(blueRowsFrom(FIXTURE)).toEqual([
      { cube: 'fair-fight', drafts: 7434, deckShare: 0.7215, expectedShare: 0.3963, overFactor: 1.821, equalQualityWin: 0.3629, equalQualityLo: 0.3225, equalQualityHi: 0.4052 },
    ]);
  });

  it('refuses a malformed file', () => {
    expect(() => blueRowsFrom({})).toThrow();
    expect(() => blueRowsFrom({ per_cube: {} })).toThrow(/no cubes/);
    const bad = structuredClone(FIXTURE);
    bad.per_cube.fair_fight.rates.blue_deck_share = 1.5;
    expect(() => blueRowsFrom(bad)).toThrow(/blue_deck_share/);
    const unfit = structuredClone(FIXTURE);
    unfit.per_cube.fair_fight.score.uncontested_model.ok = 0;
    expect(() => blueRowsFrom(unfit)).toThrow(/did not fit/);
  });

  it('the committed module is exactly the generator’s output', () => {
    const rows: BlueRow[] = Object.entries(BLUE_J111).map(([cube, s]) => ({ cube, ...s }));
    const committed = readFileSync(new URL('../../src/draft/blueJ111.ts', import.meta.url), 'utf8');
    expect(renderModule(rows)).toBe(committed);
  });
});
