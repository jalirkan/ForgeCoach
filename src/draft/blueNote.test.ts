// ForgeCoach — draft/blueNote.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLUE_J111 } from './blueJ111.ts';
import { blueCaveat, blueOverdraftLine, blueStatsFor, buildShowsPairRate, hasBlue } from './blueNote.ts';
import { DRAFT_CUBES } from '../cube/cubes.ts';

describe('J111 data', () => {
  it('covers every cube but Evan’s, and only real cubes', () => {
    const ids = DRAFT_CUBES.map((c) => c.id);
    expect(Object.keys(BLUE_J111).sort()).toEqual(ids.filter((id) => id !== 'evybaby').sort());
    expect(Object.keys(BLUE_J111)).toHaveLength(7);
  });

  it('holds J111’s headline ranges, and each factor is share over expected', () => {
    for (const [cube, s] of Object.entries(BLUE_J111)) {
      expect(s.deckShare, cube).toBeGreaterThanOrEqual(0.55);
      expect(s.deckShare, cube).toBeLessThanOrEqual(0.83);
      expect(s.overFactor, cube).toBeGreaterThanOrEqual(1.35);
      expect(s.overFactor, cube).toBeLessThanOrEqual(2.1);
      expect(Math.abs(s.overFactor - s.deckShare / s.expectedShare), cube).toBeLessThan(0.01);
      expect(s.equalQualityWin, cube).toBeGreaterThanOrEqual(0.32);
      expect(s.equalQualityWin, cube).toBeLessThanOrEqual(0.47);
      expect(s.equalQualityLo).toBeLessThanOrEqual(s.equalQualityWin);
      expect(s.equalQualityHi).toBeGreaterThanOrEqual(s.equalQualityWin);
    }
  });
});

describe('the over-draft line', () => {
  it('names the cube’s own numbers', () => {
    expect(blueOverdraftLine('vintage')).toBe(
      'The AI drafter over-drafts blue: in this cube’s lab, 61% of its decks played blue, 1.5× the 40% the cube’s colour balance predicts, so other colours tend to be open.',
    );
    expect(blueOverdraftLine('pauper')).toContain('82% of its decks played blue, 2.1×');
  });

  it('says nothing for a cube J111 did not cover', () => {
    expect(blueOverdraftLine('evybaby')).toBeNull();
    expect(blueOverdraftLine('no-such-cube')).toBeNull();
    expect(blueOverdraftLine('constructor')).toBeNull();
    expect(blueOverdraftLine(null)).toBeNull();
    expect(blueStatsFor('evybaby')).toBeNull();
  });
});

describe('the blue caveat', () => {
  it('goes with blue colours only', () => {
    expect(hasBlue('UR')).toBe(true);
    expect(hasBlue('WB+U')).toBe(true);
    expect(hasBlue('WBRG')).toBe(false);
    expect(hasBlue('')).toBe(false);
    expect(blueCaveat('synergy', 'BR')).toBeNull();
    expect(blueCaveat('synergy', 'UB')).toBe(
      'Blue’s lab win rate is held down by Forge’s play with blue, not by the cards: at equal deck quality its blue decks won 32% (95% 30–35%) in this cube’s lab. Human players don’t see this.',
    );
    expect(blueCaveat('evybaby', 'U')).toBeNull();
  });

  it('follows the build’s archetype line', () => {
    const arches = [
      { id: 'UR', winRate: 0.44, games: 120 },
      { id: 'WU', winRate: 0.5, games: 4 },
      { id: 'UB' },
    ];
    expect(buildShowsPairRate('UR', arches)).toBe(true);
    expect(buildShowsPairRate('WU', arches)).toBe(false);
    expect(buildShowsPairRate('UB', arches)).toBe(false);
    expect(buildShowsPairRate(null, arches)).toBe(false);
    expect(buildShowsPairRate('UR', null)).toBe(false);
  });
});

describe('words only', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is deterministic and makes no calls', () => {
    const fetch = vi.fn(() => {
      throw new Error('no network');
    });
    vi.stubGlobal('fetch', fetch);
    for (const id of Object.keys(BLUE_J111)) {
      expect(blueOverdraftLine(id)).toBe(blueOverdraftLine(id));
      expect(blueCaveat(id, 'U')).toBe(blueCaveat(id, 'U'));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('feeds no score, rating or drafter: only the words module, its component and BuildView’s gate read it', () => {
    const src = join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(src);
    const readers = files
      .filter((f) => /from '[^']*\/blue(J111|Note)\.tsx?'/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f).replace(/\\/g, '/'))
      .sort();
    expect(readers).toEqual(['draft/blueNote.ts', 'ui/BlueNote.tsx', 'ui/deck/BuildView.tsx']);
  });
});
