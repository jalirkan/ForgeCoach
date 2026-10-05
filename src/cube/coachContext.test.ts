// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { GameLog } from '../log.ts';
import type { CubeMeta } from './meta.ts';
import { cubeInfo } from './cubes.ts';
import {
  CUBE_SECTION_MAX_CHARS,
  CUBE_SECTION_MAX_LINES,
  archetypeNamedIn,
  buildCubeContext,
  capSection,
  closestArchetype,
  cubeIdOfLog,
  loadCubeCoachInput,
} from './coachContext.ts';
import { loadRealMeta } from './testdata/load.ts';
import { buildCoachPrompt } from '../prompt.ts';
import { buildReviewPrompt } from '../review.ts';
import { extractDecisions } from '../decisions.ts';
import { parseLog } from '../log.ts';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const meta = loadRealMeta('synergy');
const OPP = [...meta.archetypes].filter((a) => a.id !== 'WU-ETB').sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0]!;
// A white-blue hand built on WU-ETB's key cards in the shipped synergy meta
// (J075): Lunarch Veteran, Blade Splicer, Sun Titan and Ledger Shredder are
// four of them, and no other WU archetype lists as many. Mind Stone is a
// colourless non-key card. Re-pick these if a new meta reshuffles key cards.
const MINE = ['Lunarch Veteran', 'Blade Splicer', 'Sun Titan', 'Ledger Shredder', 'Champion of Wits', 'Mind Stone'];
const ETB = meta.archetypes.find((a) => a.id === 'WU-ETB')!;
const pctOf = (x: number) => `${Math.round(x * 100)}%`;
const NOT_MINE = OPP.keyCards!.filter((k) => !MINE.includes(k)).slice(0, 4);

const card = (id: number, name: string) => ({ id, name, types: 'Creature', tapped: false, counters: {} });
const hiddenCard = (id: number) => ({ id, hidden: true });

/** A minimal two-seat log: seat 1 holds MINE; the opponent's hand is `oppHand`. */
function fakeLog(opts: { mine?: string[]; oppHand?: unknown[]; deck?: string; oppDeck?: string } = {}): GameLog {
  const zone = (cards: unknown[]) => ({ count: cards.length, cards });
  const empty = zone([]);
  const player = (id: number, hand: unknown[], bf: unknown[]) => ({
    id,
    name: `P${id}`,
    isAi: id === 2,
    life: 20,
    poison: 0,
    counters: {},
    manaPool: {},
    zones: { library: empty, hand: zone(hand), battlefield: zone(bf), graveyard: empty, exile: empty, command: empty },
  });
  const mine = opts.mine ?? MINE;
  return {
    header: { v: 1, kind: 'session', gameId: 'g', decks: [{ player: 1, path: null, sha256: null, cards: 40 }] },
    seat: 1,
    hello: {
      you: 1,
      players: [
        { id: 1, name: 'P1', isAi: false },
        { id: 2, name: 'P2', isAi: true },
      ],
      match: { yourDeck: { name: opts.deck ?? 'Synergy Cube - WU', cards: 40, path: '' }, aiDeck: { name: opts.oppDeck ?? `AI Drafter - ${OPP.id}`, cards: 40 }, aiProfile: 'Default', games: 1 },
    },
    over: null,
    frames: [
      {
        type: 'state',
        dir: 's2c',
        seq: 1,
        body: { gameId: 'g', turn: 3, round: 2, phase: 'MAIN1', activePlayer: 1, priority: 1, gameOver: null, stack: [], stackCards: [], combat: null, players: [player(1, mine.slice(0, 3).map((n, i) => card(i + 1, n)), mine.slice(3).map((n, i) => card(i + 10, n))), player(2, opts.oppHand ?? [], [])] },
      },
    ],
  } as unknown as GameLog;
}

const input = (m: CubeMeta | null = meta) => ({ cubeId: 'synergy', title: cubeInfo('synergy')!.title, meta: m });

describe('cubeIdOfLog', () => {
  it('reads the cube from the deck name or path, else null', () => {
    expect(cubeIdOfLog(fakeLog())).toBe('synergy');
    expect(cubeIdOfLog(fakeLog({ deck: 'My Pile' }))).toBeNull();
  });
});

describe('closestArchetype / archetypeNamedIn', () => {
  it('matches by colours and key cards', () => {
    expect(closestArchetype(meta, new Set(MINE))?.id).toBe('WU-ETB');
  });
  it('declines with too few cards', () => {
    expect(closestArchetype(meta, new Set(['Blade Splicer']))).toBeNull();
  });
  it('names the opponent archetype only from the deck name', () => {
    expect(archetypeNamedIn(meta, `AI Drafter - ${OPP.id}`)?.id).toBe(OPP.id);
    expect(archetypeNamedIn(meta, 'AI Drafter - Boros pile')).toBeNull();
    expect(archetypeNamedIn(meta, null)).toBeNull();
  });
});

describe('buildCubeContext', () => {
  const text = buildCubeContext(fakeLog(), input())!;

  it('states the archetype, shrunk rate with interval, key cards, lands and the caveat', () => {
    expect(text).toMatch(/^# Cube context — Synergy Cube/);
    expect(text).toContain('most resembles WU-ETB');
    expect(text).toMatch(new RegExp(`shrunk win rate \\d+% \\(95% interval ${pctOf(ETB.ci![0])}–${pctOf(ETB.ci![1])}\\) over ${ETB.games} games`));
    expect(text).toMatch(new RegExp(`Opponent's deck is named ${OPP.id}: shrunk win rate`));
    expect(text).toMatch(/Key WU-ETB cards you have \(shrunk win rate\): .*Blade Splicer \d+% in \d+g/);
    expect(text).toContain(`Typical land count for WU-ETB: ${Math.round(ETB.avgLands!)} (average ${Math.round(ETB.avgLands! * 10) / 10})`);
    expect(text).toContain(`AI-vs-AI Forge games (${meta.sample!.games} in this cube's sample, ${ETB.games} behind WU-ETB); small samples are weak evidence.`);
    expect((text.match(/in \d+g/g) ?? []).length).toBeGreaterThan(0);
    // no more than five key cards
    expect(text.split('\n').find((l) => l.startsWith('Key '))!.split(';').length).toBeLessThanOrEqual(5);
  });

  it('stays within the line and character caps', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(CUBE_SECTION_MAX_LINES);
    expect(text.length).toBeLessThanOrEqual(CUBE_SECTION_MAX_CHARS);
  });

  it('calls out cards the AI plays poorly as unreliable', () => {
    const m = structuredClone(meta);
    (m.cards['Blade Splicer'] as Record<string, unknown>).remAIDeck = true;
    ((m.cube.cards ?? []).find((c) => c.name === 'Mind Stone') as unknown as Record<string, unknown>).remAIDeck = true;
    const t = buildCubeContext(fakeLog(), input(m))!;
    expect(t).toMatch(/Blade Splicer \d+% in \d+g, AI stats unreliable/);
    expect(t).toMatch(/plays these poorly, so their lab stats are unreliable: .*Mind Stone/);
    expect(text).not.toContain('unreliable');
  });

  it('says the data is thin below the games threshold, or without a meta', () => {
    const m = structuredClone(meta);
    m.archetypes.find((a) => a.id === 'WU-ETB')!.games = 6;
    const t = buildCubeContext(fakeLog(), input(m))!;
    expect(t.split('\n')).toHaveLength(2);
    expect(t).toMatch(/thin here \(its closest archetype \(WU-ETB\) has only 6 games\)/);
    expect(buildCubeContext(fakeLog(), input(null))).toMatch(/thin or missing/);
    expect(buildCubeContext(fakeLog({ mine: ['Blade Splicer'] }), input())).toMatch(/not yet clear/);
  });

  it('is absent for a game with no cube', () => {
    expect(buildCubeContext(fakeLog(), undefined)).toBeNull();
  });

  it('never leaks the opponent’s hidden hand', () => {
    const hand = [...NOT_MINE.map((n, i) => card(50 + i, n)), card(60, 'Mind Stone'), hiddenCard(61), hiddenCard(62)];
    const leaky = buildCubeContext(fakeLog({ oppHand: hand, oppDeck: 'Some deck' }), input())!;
    for (const n of NOT_MINE) expect(leaky).not.toContain(n);
    expect(leaky).toBe(buildCubeContext(fakeLog({ oppDeck: 'Some deck' }), input()));
    expect(leaky).not.toMatch(/Opponent/);
    // Even an opponent card that is also a key card of mine is not read from their hand.
    const withKey = buildCubeContext(fakeLog({ mine: MINE.slice(0, 5), oppHand: [card(70, 'Mind Stone')] }), input())!;
    expect(withKey).not.toContain('Mind Stone');
  });
});

describe('capSection', () => {
  it('drops optional lines first, keeps the caveat, and hard-caps characters and lines', () => {
    const lines = ['# head', ...Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(200)}`), 'CAVEAT'];
    const out = capSection(lines);
    expect(out.length).toBeLessThanOrEqual(CUBE_SECTION_MAX_CHARS);
    expect(out.split('\n').length).toBeLessThanOrEqual(CUBE_SECTION_MAX_LINES);
    expect(out.endsWith('CAVEAT')).toBe(true);
    expect(out.startsWith('# head')).toBe(true);
    expect(capSection(['a', 'b', 'c'.repeat(3000)], 100).length).toBeLessThanOrEqual(100);
  });
});

describe('loadCubeCoachInput', () => {
  it('prefers the imported meta, falls back to shipped, and is undefined outside cubes', async () => {
    const imported = structuredClone(meta);
    const calls: string[] = [];
    const a = await loadCubeCoachInput(fakeLog(), { imported: async () => imported, shipped: async () => (calls.push('s'), meta) });
    expect(a?.meta).toBe(imported);
    expect(calls).toEqual([]);
    const b = await loadCubeCoachInput(fakeLog(), { imported: async () => null, shipped: async () => meta });
    expect(b?.meta).toBe(meta);
    const c = await loadCubeCoachInput(fakeLog(), { imported: async () => { throw new Error('x'); }, shipped: async () => meta });
    expect(c).toMatchObject({ cubeId: 'synergy', meta: null });
    expect(await loadCubeCoachInput(fakeLog({ deck: 'My Pile' }), { imported: async () => meta, shipped: async () => meta })).toBeUndefined();
  });
});

describe('prompt integration', () => {
  const log = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
  it('the coach and review prompts carry the section before the guide, and are unchanged without it', () => {
    const d = extractDecisions(log).find((x) => x.kind === 'main')!;
    const withCube = buildCoachPrompt(log, d, new Map(), { guide: 'G', cube: input() });
    expect(withCube.user).toContain('# Cube context — Synergy Cube');
    expect(withCube.user.indexOf('# Cube context')).toBeLessThan(withCube.user.indexOf('# My deck play guide'));
    expect(buildCoachPrompt(log, d, new Map()).user).not.toContain('Cube context');
    const rv = buildReviewPrompt(log, new Map(), { cube: input() });
    expect(rv.user.indexOf('# Cube context')).toBeGreaterThan(rv.user.indexOf('# Card text'));
    expect(rv.user.indexOf('# Cube context')).toBeLessThan(rv.user.indexOf('# Question'));
    expect(buildReviewPrompt(log, new Map()).user).not.toContain('Cube context');
  });
});
