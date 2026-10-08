/*
 * ForgeCoach — cube/labTrust.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { bandsOf, LAB_AGREEMENT, labTrust, labTrustDetail, labTrustFor, labTrustLine, labTrustNote, levelOf, MIN_BAND, type BandAgreement } from './labTrust.ts';
import { makeContext, metaValue, usesHumanData } from './score.ts';
import { loadCube, loadInfos, loadRealMeta } from './testdata/load.ts';

const card = (mv: number, creature: boolean, colors = 'R') => ({ land: false, creature, mv, colors });

describe('levels and bands (docs/human-blend.md part 2 B)', () => {
  it('reads the level off the interval’s lower end, untested under the minimum', () => {
    expect(levelOf({ lo: 0.3, n: 50 })).toBe('fair');
    expect(levelOf({ lo: 0.29, n: 50 })).toBe('rough');
    expect(levelOf({ lo: 0.01, n: 50 })).toBe('rough');
    expect(levelOf({ lo: 0, n: 50 })).toBe('shaky');
    expect(levelOf({ lo: 0.5, n: MIN_BAND - 1 })).toBe('untested');
  });

  it('puts a card in its mana-value band, colourless, then its type; lands in none', () => {
    expect(bandsOf(card(2, true))).toEqual(['mv2', 'creature']);
    expect(bandsOf(card(4, false, ''))).toEqual(['mv34', 'colourless', 'noncreature']);
    expect(bandsOf(card(6, true))).toEqual(['mv5', 'creature']);
    expect(bandsOf({ land: true, creature: false, mv: 0, colors: '' })).toEqual([]);
  });

  it('takes the weakest band the card is in', () => {
    const t: BandAgreement[] = [
      { band: 'mv2', n: 60, rho: 0.6, lo: 0.4, hi: 0.7 },
      { band: 'creature', n: 60, rho: 0.2, lo: -0.1, hi: 0.4 },
      { band: 'noncreature', n: 60, rho: 0.4, lo: 0.1, hi: 0.6 },
    ];
    expect(labTrust(card(2, true), t)).toMatchObject({ level: 'shaky', band: 'creature' });
    expect(labTrust(card(1, false), t)).toMatchObject({ level: 'rough', band: 'noncreature' });
    expect(labTrust(null, t)).toBeNull();
  });

  it('the committed run: fair for cheap and mid creatures, rough for noncreature spells, untested for 5+ drops and colourless', () => {
    expect(LAB_AGREEMENT.find((r) => r.band === 'all')?.n).toBe(131);
    expect(labTrust(card(2, true))?.level).toBe('fair');
    expect(labTrust(card(3, true))?.level).toBe('fair');
    expect(labTrust(card(1, false))).toMatchObject({ level: 'rough', band: 'noncreature' });
    const big = labTrust(card(6, true))!;
    expect(labTrustLine(big)).toBe('Lab number: untested for 5+ drops');
    expect(labTrustDetail(big)).toMatch(/^Only 19 Vintage cube 5\+ drops/);
    expect(labTrustLine(labTrust(card(2, true, ''))!)).toBe('Lab number: untested for colourless cards');
    expect(labTrustDetail(labTrust(card(2, true))!)).toMatch(/ρ 0\.54 \[0\.33, 0\.7\d\], 66 cards\.$/);
  });
});

describe('labTrustFor and labTrustNote on a real cube', () => {
  const cube = loadCube('modern-era');
  const ctx = makeContext(cube, loadInfos('modern-era', cube), loadRealMeta('modern-era'));
  const names = cube.cards.map((c) => c.name);

  it('labels only lab-valued nonland cards', () => {
    for (const n of names) {
      const t = labTrustFor(n, ctx);
      if (ctx.facts.get(n)?.land || !metaValue(n, ctx) || usesHumanData(n, ctx)) expect(t).toBeNull();
      else expect(t).not.toBeNull();
    }
  });

  it('a note names the cards that are not a fair guide, weakest first, and is deterministic', () => {
    const big = names.find((n) => labTrustFor(n, ctx)?.band === 'mv5')!;
    const spell = names.find((n) => labTrustFor(n, ctx)?.level === 'rough')!;
    const fair = names.find((n) => labTrustFor(n, ctx)?.level === 'fair')!;
    expect(labTrustNote([fair], ctx)).toBeNull();
    const note = labTrustNote([spell, fair, big], ctx)!;
    expect(note).toBe(`Lab number: untested for 5+ drops (${big}); a rough guide for noncreature spells (${spell}).`);
    expect(labTrustNote([spell, fair, big], ctx)).toBe(note);
  });

  it('a cube without a lab meta (none loaded) gets no labels', () => {
    const omega = loadCube('omega');
    const o = makeContext(omega, loadInfos('omega', omega), null);
    expect(omega.cards.some((c) => labTrustFor(c.name, o))).toBe(false);
  });
});
