// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { CubeMeta, MetaArchetype } from '../../src/cube/meta.ts';
import { colourOffsetsOf, offsetFor } from './colourOffsets.ts';

const arch = (colors: string, games: number, winRate: number) => ({ id: colors, colors, games, winRate }) as unknown as MetaArchetype;
const meta = (archetypes: MetaArchetype[], extra: Partial<CubeMeta> = {}) => ({ schema: 1, cube: {}, cards: {}, archetypes, pairs: [], ...extra }) as CubeMeta;

describe('colourOffsetsOf', () => {
  it('is each colour’s deck win rate minus the pooled rate', () => {
    const o = colourOffsetsOf(meta([arch('WU', 100, 0.6), arch('UB', 100, 0.4), arch('WB', 200, 0.5)]))!;
    expect(o.get('W')).toBeCloseTo((60 + 100) / 300 - 0.5);
    expect(o.get('U')).toBeCloseTo(0);
    expect(o.get('B')).toBeCloseTo((40 + 100) / 300 - 0.5);
    expect(o.has('R')).toBe(false);
  });
  it('prefers the lab’s colorBaselines when present', () => {
    const o = colourOffsetsOf(meta([arch('WU', 100, 0.5)], { colorBaselines: { W: { games: 10, wins: 7 } } }))!;
    expect([...o.keys()]).toEqual(['W']);
    expect(o.get('W')).toBeCloseTo(0.2);
  });
  it('is null without usable archetypes', () => {
    expect(colourOffsetsOf(meta([arch('WU', 0, 0.5)]))).toBeNull();
  });
});

describe('offsetFor', () => {
  const o = new Map([['W', 0.04], ['U', -0.02]]);
  it('averages a card’s colours; colourless is 0', () => {
    expect(offsetFor('W', o)).toBeCloseTo(0.04);
    expect(offsetFor('WU', o)).toBeCloseTo(0.01);
    expect(offsetFor('', o)).toBe(0);
    expect(offsetFor('W', null)).toBe(0);
  });
});
