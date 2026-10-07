// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { recommendGrid } from '../cube/pick.ts';
import { context, loadCube, loadInfos, loadMeta } from '../cube/testdata/load.ts';
import { gridBlurb } from './gridBlurb.ts';
import { buildGridWhyPrompt, GRID_WHY_GUIDE_MAX, GRID_WHY_SYSTEM, gridWhyCards } from './gridWhyPrompt.ts';

const ctx = context('synergy', loadMeta());
const infos = loadInfos('synergy', loadCube('synergy'));
const RAKDOS = ['Blood Artist', 'Viscera Seer', 'Goblin Bombardment', 'Bloodghast', 'Fatal Push', 'Lightning Bolt', 'Mayhem Devil', 'Priest of Forgotten Gods', 'Young Pyromancer', 'Zulaport Cutthroat'];
const GRID = ['Carrion Feeder', 'Juri, Master of the Revue', 'Skullclamp', 'Wood Elves', 'Lotus Cobra', 'Eternal Witness', 'Opt', 'Ponder', 'Mana Leak'];
const blurb = gridBlurb(recommendGrid(GRID, RAKDOS, ctx), RAKDOS, ctx)!;

describe('buildGridWhyPrompt', () => {
  const p = buildGridWhyPrompt({ ctx, cubeId: 'synergy', blurb, pool: RAKDOS, infos });

  it('asks for two or three sentences on plan, pool fit and what next', () => {
    expect(p.system).toBe(GRID_WHY_SYSTEM);
    expect(p.system).toMatch(/two or three plain sentences/);
    expect(p.system).toMatch(/archetype or plan/);
    expect(p.system).toMatch(/current pool/);
    expect(p.system).toMatch(/next picks/);
  });

  it('carries the line with its themes and the helper’s reasons, the pool, the themes and the card text', () => {
    expect(p.user).toContain(`Pick helper: ${blurb.title.toLowerCase()}.`);
    for (const c of blurb.cards) {
      expect(p.user).toMatch(new RegExp(`^- ${c.name.replace(/[,.]/g, '.')} \\(value ${Math.round(c.value)}`, 'm'));
      expect(p.user).toContain(c.reasons[0]!);
      // exact card text
      expect(p.user).toContain(infos.get(c.name)!.oracleText.split('\n')[0]!);
    }
    expect(p.user).toContain(blurb.leaves!);
    expect(p.user).toMatch(/## Your pool \(10\), leaning Rakdos/);
    expect(p.user).toMatch(/Blood Artist \[[A-Z ]+\]/);
    expect(p.user).toMatch(/## Cube themes\n- SAC /);
    expect(p.user).toContain('## Cube guide');
    expect(gridWhyCards(blurb)).toEqual(blurb.cards.map((c) => c.name));
  });

  it('only the line’s card text goes in, never the rest of the grid', () => {
    const text = p.user.slice(p.user.indexOf('## Card text'));
    for (const n of GRID.filter((g) => !blurb.cards.some((c) => c.name === g))) expect(text).not.toContain(n);
  });

  it('stays short and deterministic', () => {
    expect(buildGridWhyPrompt({ ctx, cubeId: 'synergy', blurb, pool: RAKDOS, infos })).toEqual(p);
    const guide = p.user.slice(p.user.indexOf('## Cube guide'), p.user.indexOf('## Card text'));
    expect(guide.length).toBeLessThanOrEqual(GRID_WHY_GUIDE_MAX + 2);
    expect(p.user.length).toBeLessThan(5000);
  });

  it('an empty pool: no colours, no guide', () => {
    const b = gridBlurb(recommendGrid(GRID, [], ctx), [], ctx)!;
    const q = buildGridWhyPrompt({ ctx, cubeId: 'synergy', blurb: b, pool: [], infos });
    expect(q.user).toContain('## Your pool (0)\n(empty: this is the first pick)');
    expect(q.user).not.toContain('## Cube guide');
  });

  it('missing card text says so', () => {
    const q = buildGridWhyPrompt({ ctx, cubeId: 'synergy', blurb, pool: RAKDOS, infos: new Map() });
    expect(q.user).toContain(`${blurb.cards[0]!.name} — (card text unavailable)`);
  });
});
