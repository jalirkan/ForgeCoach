// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { expectedSet, pickValue, poolColours, recommendGrid, recommendWinston, setValue } from './pick.ts';
import { context, loadMeta } from './testdata/load.ts';

const ctx = context('synergy');
const RAKDOS = [
  'Blood Artist', 'Viscera Seer', 'Goblin Bombardment', 'Bloodghast', 'Fatal Push', 'Lightning Bolt', 'Mayhem Devil',
  'Priest of Forgotten Gods', 'Young Pyromancer', 'Zulaport Cutthroat', 'Ophiomancer', 'Woe Strider', 'Village Rites',
  'Hordeling Outburst', 'Legion Warboss', 'Gravecrawler', 'Carrion Feeder', 'Deadly Dispute', 'Bone Shards', 'Midnight Reaper',
  'Kari Zev, Skyship Raider', 'Goblin Rabblemaster',
];

describe('pick values', () => {
  it('reads the pool’s colours and rewards on-colour, synergistic cards once committed', () => {
    expect(poolColours(RAKDOS, ctx)).toBe('BR');
    const onColour = pickValue('Grim Haruspex', RAKDOS, ctx);
    const offColour = pickValue('Wood Elves', RAKDOS, ctx);
    expect(onColour.colour).toBeGreaterThan(0);
    expect(offColour.colour).toBeLessThan(-10);
    expect(onColour.synergy).toBeGreaterThan(offColour.synergy);
    expect(pickValue('Blood Crypt', RAKDOS, ctx).colour).toBeGreaterThan(pickValue('Breeding Pool', RAKDOS, ctx).colour);
  });
  it('an empty pool has no colour opinion', () => {
    expect(pickValue('Wood Elves', [], ctx).colour).toBe(0);
  });
  it('setValue: best plus 0.6 of the rest', () => {
    expect(setValue([50, 60, 10])).toBeCloseTo(60 + 0.6 * 50 + 0.6 * 10);
  });
});

describe('grid', () => {
  // Top row: Rakdos gold; middle row: green; bottom row: blue; columns mix them.
  const grid = ['Mayhem Devil', 'Juri, Master of the Revue', 'Yawgmoth, Thran Physician', 'Wood Elves', 'Lotus Cobra', 'Eternal Witness', 'Opt', 'Ponder', 'Mana Leak'];

  it('picks the line that fits the pool, and says what the opponent answers with', () => {
    const a = recommendGrid(grid, RAKDOS, ctx);
    expect(a.first).toBe(true);
    expect(a.options).toHaveLength(6);
    expect(a.best?.line.id).toBe('R1');
    expect(a.best?.reply).not.toBeNull();
    expect(a.best?.reasons.join(' ')).toMatch(/Mayhem Devil|Yawgmoth/);
    expect(a.best?.reasons.join(' ')).toMatch(/They likely answer with/);
  });

  it('weighs what the opponent can take: denial changes the first pick', () => {
    // For an empty pool every line is about raw value; the reply term must be counted in every option.
    const a = recommendGrid(grid, [], ctx);
    for (const o of a.options) expect(o.total).toBeCloseTo(o.mine - 0.5 * (o.reply?.value ?? 0), 0);
  });

  it('picking second: only lines that still hold cards, no reply', () => {
    const second = grid.map((c, i) => (i < 3 ? null : c)); // the opponent took the top row
    const a = recommendGrid(second, RAKDOS, ctx);
    expect(a.first).toBe(false);
    expect(a.options.map((o) => o.line.id).sort()).toEqual(['C1', 'C2', 'C3', 'R2', 'R3']);
    expect(a.options.every((o) => o.reply === null)).toBe(true);
    expect(a.options.find((o) => o.line.id === 'C1')?.cards).toEqual(['Wood Elves', 'Opt']);
  });

  it('uses the opponent’s pool for their reply when known', () => {
    const greenOpp = ['Llanowar Elves', 'Tireless Tracker', 'Scavenging Ooze', 'Hardened Scales', 'Pelt Collector', 'Rishkar, Peema Renegade', 'Avenger of Zendikar', 'Courser of Kruphix', 'Beast Within', 'Ram Through', 'Satyr Wayfinder', 'Evolution Sage', 'Titania, Protector of Argoth', 'Scute Swarm', 'Sakura-Tribe Elder', 'Springbloom Druid', 'Elvish Visionary', 'Deep Forest Hermit', 'Winding Constrictor', 'Grumgully, the Generous', 'Ramunap Excavator'];
    const a = recommendGrid(grid, RAKDOS, ctx, greenOpp);
    const top = a.options.find((o) => o.line.id === 'R1');
    expect(top?.reply?.line.id).toBe('R2');
  });

  it('is deterministic with meta too', () => {
    const lab = context('synergy', loadMeta());
    expect(JSON.stringify(recommendGrid(grid, RAKDOS, lab))).toBe(JSON.stringify(recommendGrid(grid, RAKDOS, lab)));
  });
});

describe('winston', () => {
  it('takes a strong on-colour pile', () => {
    const a = recommendWinston({ pile: ['Goblin Bombardment', 'Blood Artist'], pileIndex: 1, pool: RAKDOS.slice(2), oppPool: [] }, ctx);
    expect(a.action).toBe('take');
    expect(a.take).toBeGreaterThan(a.pass);
    expect(a.reasons[0]).toMatch(/Goblin Bombardment/);
  });

  it('passes a single weak off-colour card on pile 1', () => {
    const a = recommendWinston({ pile: ['Elvish Visionary'], pileIndex: 1, pool: RAKDOS }, ctx);
    expect(a.action).toBe('pass');
  });

  it('on pile 3 compares against the blind top card only', () => {
    const a = recommendWinston({ pile: ['Thraben Inspector'], pileIndex: 3, pool: RAKDOS }, ctx);
    expect(a.margin).toBe(0);
    expect(a.reasons[1]).toMatch(/blind top card/);
    expect(a.reasons[1]).not.toMatch(/pile 2/);
  });

  it('expectedSet grows with pile size', () => {
    const v = [10, 20, 30, 40, 50, 60, 70];
    expect(expectedSet(v, 1)).toBeCloseTo(40);
    expect(expectedSet(v, 2)).toBeGreaterThan(expectedSet(v, 1));
    expect(expectedSet(v, 3)).toBeGreaterThan(expectedSet(v, 2));
  });
});
