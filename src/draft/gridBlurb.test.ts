// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { humanCardView, parseHumanCards } from '../cube/human.ts';
import { recommendGrid } from '../cube/pick.ts';
import { makeContext } from '../cube/score.ts';
import { context, loadCube, loadInfos, loadMeta, loadRealMeta, rng, samplePool } from '../cube/testdata/load.ts';
import { CLOSE_MARGIN, gridBlurb, strengthText } from './gridBlurb.ts';
import { colourBaselines, labCardView } from './labStats.ts';

const synergy = context('synergy', loadMeta());
const RAKDOS = ['Blood Artist', 'Viscera Seer', 'Goblin Bombardment', 'Bloodghast', 'Fatal Push', 'Lightning Bolt', 'Mayhem Devil', 'Priest of Forgotten Gods', 'Young Pyromancer', 'Zulaport Cutthroat'];
const GRID = ['Carrion Feeder', 'Juri, Master of the Revue', 'Yawgmoth, Thran Physician', 'Wood Elves', 'Lotus Cobra', 'Eternal Witness', 'Opt', 'Ponder', 'Mana Leak'];

const vCube = loadCube('vintage');
const human = parseHumanCards(JSON.parse(readFileSync(new URL('../../public/cubes/vintage-cube-180.human.json', import.meta.url), 'utf8')));
const vintage = makeContext(vCube, loadInfos('vintage', vCube), loadRealMeta('vintage'), human);

/** Random first-pick grids over the vintage cube, with a sampled pool. */
function grids(n: number, seed: number) {
  const r = rng(seed);
  const all = vCube.cards.map((c) => c.name);
  const out: Array<{ grid: string[]; pool: string[] }> = [];
  for (let i = 0; i < n; i++) {
    const pool = samplePool(vCube, ['WU', 'BR', 'G', 'UB', 'RW'][i % 5]!, Math.floor(r() * 25), seed + i);
    const rest = all.filter((x) => !pool.includes(x));
    const grid: string[] = [];
    while (grid.length < 9) {
      const c = rest[Math.floor(r() * rest.length)]!;
      if (!grid.includes(c)) grid.push(c);
    }
    out.push({ grid, pool });
  }
  return out;
}

describe('gridBlurb', () => {
  it('explains the helper’s own line, one short line per card, strongest reasons first', () => {
    const a = recommendGrid(GRID, RAKDOS, synergy);
    const before = JSON.stringify(a);
    const b = gridBlurb(a, RAKDOS, synergy)!;
    expect(JSON.stringify(a)).toBe(before); // the advice is not touched
    expect(b.title).toBe(`Take the ${a.best!.line.label.toLowerCase()}`);
    expect(b.cards.map((c) => c.name).sort()).toEqual([...a.best!.cards].sort());
    for (const c of b.cards) {
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.reasons.length).toBeLessThanOrEqual(2);
    }
    // Values high to low.
    expect(b.cards.map((c) => c.value)).toEqual([...b.cards.map((c) => c.value)].sort((x, y) => y - x));
    // Yawgmoth: the pool's sacrifice theme, named, with a pool card it pairs with.
    const yawg = b.cards.find((c) => c.name === 'Yawgmoth, Thran Physician')!;
    expect(yawg.reasons.find((r) => r.startsWith('Sacrifice'))).toMatch(/^Sacrifice with (Blood Artist|Viscera Seer|Goblin Bombardment|Zulaport Cutthroat|Priest of Forgotten Gods|Bloodghast|Mayhem Devil|Young Pyromancer)/);
    // What it leaves the AI: the reply line and the margin.
    expect(b.leaves).toBe(`Leaves the AI the ${a.best!.reply!.line.label.toLowerCase()} (${a.best!.reply!.cards.join(', ')}): ${Math.round(a.best!.reply!.value)} to it vs ${Math.round(a.best!.mine)} to you (+${Math.round((a.best!.mine - a.best!.reply!.value) * 10) / 10} your way).`);
  });

  it('names the other drafter when it is a person', () => {
    const b = gridBlurb(recommendGrid(GRID, RAKDOS, synergy), RAKDOS, synergy, 'Alex')!;
    expect(b.leaves).toMatch(/^Leaves Alex the .* to Alex vs/);
  });

  it('picking second: the rest is discarded', () => {
    const second = GRID.map((c, i) => (i < 3 ? null : c));
    const b = gridBlurb(recommendGrid(second, RAKDOS, synergy), RAKDOS, synergy)!;
    expect(b.leaves).toBe('You pick second: the rest of this grid is discarded, nothing more goes to the AI.');
  });

  it('flags a close call with the runner-up and the deciding factor, and only then', () => {
    let closes = 0;
    for (const { grid, pool } of grids(60, 7)) {
      const a = recommendGrid(grid, pool, vintage, []);
      const b = gridBlurb(a, pool, vintage)!;
      const next = a.options[1]!;
      if (a.best!.total - next.total <= CLOSE_MARGIN) {
        closes++;
        expect(b.close).toMatch(new RegExp(`^Close call vs the ${next.line.label.toLowerCase()} \\((level|[\\d.]+ behind)\\): .+\\.$`));
        const dMine = a.best!.mine - next.mine;
        const dDeny = 0.5 * ((next.reply?.value ?? 0) - (a.best!.reply?.value ?? 0));
        expect(b.close).toMatch(dDeny > dMine ? /decided by denial/ : /decided by value to you/);
      } else expect(b.close).toBeNull();
    }
    expect(closes).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    for (const { grid, pool } of grids(5, 3)) {
      expect(JSON.stringify(gridBlurb(recommendGrid(grid, pool, vintage), pool, vintage))).toBe(JSON.stringify(gridBlurb(recommendGrid(grid, pool, vintage), pool, vintage)));
    }
  });

  it('no advice, no blurb', () => {
    expect(gridBlurb({ first: false, options: [], best: null }, [], synergy)).toBeNull();
  });
});

describe('strengthText: the labStats / human.ts honesty rule', () => {
  const meta = vintage.meta!.meta;
  const baselines = colourBaselines(meta);
  it('calls a card strong or weak only when its interval is clear of the line', () => {
    let lab = 0;
    let hum = 0;
    for (const c of vCube.cards) {
      const t = strengthText(c.name, vintage, baselines) ?? '';
      const f = vintage.facts.get(c.name);
      const v = labCardView(meta, c.name, f?.colors ?? '', baselines, { land: f?.land === true });
      const h = humanCardView(human, c.name);
      const labSays = /(strong|weak) in the lab/.exec(t)?.[1];
      const humSays = /(strong|weak)(?: in the lab and)? for humans/.exec(t)?.[1];
      if (labSays) {
        lab++;
        expect(labSays === 'strong' ? v!.win!.lo > 0.5 : v!.win!.hi < 0.5).toBe(true);
      } else expect(!v?.win || (v.win.lo <= 0.5 && v.win.hi >= 0.5) || v.verdict === 'unclear').toBe(true);
      if (humSays) {
        hum++;
        expect(humSays === 'strong' ? h!.gih.lo > h!.avg : h!.gih.hi < h!.avg).toBe(true);
      } else expect(!h || h.verdict === 'unclear').toBe(true);
    }
    expect(lab).toBeGreaterThan(0);
    expect(hum).toBeGreaterThan(0);
  });
  it('says nothing without numbers', () => {
    expect(strengthText('Yawgmoth, Thran Physician', context('synergy'), new Map())).toBeNull();
  });
});
