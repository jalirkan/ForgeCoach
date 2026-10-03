// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LADDER_SRC,
  LADDER_FIELDS,
  LadderError,
  anchorSummary,
  axisDomain,
  axisPct,
  ciLabel,
  fetchLadder,
  fmtDelta,
  hasInterval,
  ladderSource,
  ladderStaleness,
  overlaps,
  parseLadder,
  rankRange,
  rebaseLadder,
  relation,
  setLabel,
  sprtVerdict,
  type LadderPlayer,
} from './ladder.ts';
import { LabFetchError } from './status.ts';

const raw = JSON.parse(readFileSync(new URL('../../public/ladder-sample.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const clone = () => JSON.parse(JSON.stringify(raw)) as Record<string, unknown> & { players: unknown[] };

/** The schema-1 example from mtg-table's docs/guides/ai-ladder.md, as written there. */
const GUIDE_EXAMPLE = {
  schema: 'mtg-table/ai-ladder',
  version: 1,
  generatedAt: '2026-10-03T14:00:00.000Z',
  anchor: { name: 'forge-default', rating: 1500 },
  scale: 'elo',
  ci: 'hessian',
  totals: { games: 48, decisive: 47, draws: 1, hosts: ['pc'], first: '…', last: '…' },
  players: [
    {
      name: 'forge-reckless',
      kind: 'forge',
      params: { profile: 'Reckless', sim: 'none' },
      hash: '77b72fd483b2',
      anchor: true,
      registered: true,
      available: true,
      unavailable: null,
      rating: 1563.2,
      lo: 1480.1,
      hi: 1646.3,
      rated: true,
      games: 31,
      wins: 18,
      losses: 13,
      draws: 1,
      vsAnchor: { wins: 9, losses: 7, rate: 0.563, lo: 0.332, hi: 0.769 },
    },
  ],
  history: [{ at: '…', run: 'pc:r', games: 47, ratings: { 'forge-reckless': [1563.2, 1480.1, 1646.3] } }],
  sprt: [
    { at: '…', id: '…', a: '…', b: '…', elo0: 0, elo1: 20, alpha: 0.05, beta: 0.05, result: 'H1', llr: 2.97, lower: -2.944, upper: 2.944, games: 812, pairs: 404, score: 0.541, purpose: 'sprt' },
  ],
  tune: [],
  league: null,
  set: 'tools/ai-bench/pairs-confirm.txt',
  experiments: [],
};

function player(name: string, rating: number, lo: number, hi: number, extra: Partial<LadderPlayer> = {}): LadderPlayer {
  return {
    name,
    kind: 'forge',
    anchor: false,
    isZero: false,
    registered: true,
    available: true,
    rated: true,
    rating,
    lo,
    hi,
    games: 10,
    wins: 5,
    losses: 5,
    draws: 0,
    vsAnchor: null,
    ...extra,
  };
}

describe('parseLadder', () => {
  it('reads the guide example', () => {
    const l = parseLadder(GUIDE_EXAMPLE);
    expect(l.version).toBe(1);
    expect(l.generatedAt?.toISOString()).toBe('2026-10-03T14:00:00.000Z');
    expect(l.anchorName).toBe('forge-default');
    expect(l.ci).toBe('hessian');
    expect(l.totals).toMatchObject({ games: 48, decisive: 47, draws: 1, first: null, last: null });
    expect(l.players).toHaveLength(1);
    expect(l.players[0]).toMatchObject({ name: 'forge-reckless', anchor: true, isZero: false, rating: 1563.2, lo: 1480.1, hi: 1646.3, rated: true, games: 31 });
    expect(l.players[0]!.vsAnchor).toEqual({ wins: 9, losses: 7, rate: 9 / 16, lo: 0.332, hi: 0.769 });
    // The guide's placeholder names ("…") are still names; its "…" times are not times.
    expect(l.sprt[0]).toMatchObject({ a: '…', b: '…', result: 'H1', games: 812, pairs: 404, at: null });
    expect(l.league).toBeNull();
  });

  it('reads the bundled sample: best first, unrated last, the zero fixed', () => {
    const l = parseLadder(raw);
    expect(l.players.map((p) => p.name)).toEqual([
      'search-v1-fixed3',
      'search-v1',
      'policy-outlet',
      'forge-reckless',
      'forge-default',
      'policy-outlet-reckless',
      'forge-experimental',
      'forge-cautious',
      'search-v1-eval-3f9c2a1b',
    ]);
    const zero = l.players.find((p) => p.isZero)!;
    expect(zero).toMatchObject({ name: 'forge-default', rating: 1500, lo: 1500, hi: 1500, anchor: true, vsAnchor: null });
    const unrated = l.players.at(-1)!;
    expect(unrated).toMatchObject({ rated: false, available: false });
    expect(hasInterval(unrated)).toBe(false);
    expect(l.sprt.map((s) => s.result)).toEqual(['H1', 'H1', 'H0', 'inconclusive']);
    expect(l.tune[0]).toMatchObject({ base: 'policy-outlet', winner: 'profile=Reckless outlets=on', registeredAs: 'policy-outlet-reckless', rounds: 3, games: 960, eta: 2 });
    expect(l.tune[0]!.vary).toEqual([
      { key: 'profile', values: ['Default', 'Cautious', 'Reckless', 'Experimental'] },
      { key: 'outlets', values: ['on', 'off'] },
    ]);
    expect(l.tune[0]!.final[0]!.label).toBe('profile=Reckless outlets=on');
    expect(l.league?.best).toBe('policy-outlet');
    expect(l.league?.promoted[0]?.name).toBe('policy-outlet');
  });

  it('the sample has every field of the real schema 1 (report.ts LadderDoc)', () => {
    for (const k of ['schema', 'version', 'generatedAt', 'anchor', 'scale', 'ci', 'totals', 'players', 'history', 'sprt', 'tune', 'league', 'set', 'experiments']) expect(raw).toHaveProperty(k);
    const keys = 'name kind params hash anchor registered available unavailable rating lo hi rated games wins losses draws vsAnchor'.split(' ');
    for (const p of raw.players as object[]) expect(Object.keys(p).sort()).toEqual([...keys].sort());
  });

  it('rejects what is not a ladder file', () => {
    for (const bad of [null, 42, 'ladder', [1, 2], true]) expect(() => parseLadder(bad)).toThrow(LadderError);
    expect(() => parseLadder({ schema: 'mtg-table/cube-meta', players: [] })).toThrow(LadderError);
  });

  it('an empty object is an empty ladder', () => {
    const l = parseLadder({});
    expect(l.players).toEqual([]);
    expect(l.sprt).toEqual([]);
    expect(l.anchorRating).toBe(1500);
    expect(anchorSummary(l)).toBe('No player has a rating yet.');
  });

  it('survives malformed and hostile input', () => {
    const j = clone();
    j.players = [
      { name: 'ok', rating: 1550, lo: 1500, hi: 1600, rated: true, games: 20 },
      { name: '  \u0000evil‮\nname  ', rating: 1520, lo: 1450, hi: 1590, games: 4 },
      { name: 'ok', rating: 9999 }, // duplicate name: dropped
      { name: '', rating: 1500 }, // no name: dropped
      { name: 'x'.repeat(5000), rating: 'NaN', lo: null, hi: Infinity },
      { name: 'swapped', rating: 1500, lo: 1600, hi: 1400, games: 3 }, // interval not around rating
      { name: 'huge', rating: 1e300, lo: -1e300, hi: 1e300, games: 3 },
      { name: 'strnum', rating: '1500', lo: '1400', hi: '1600', games: 3 }, // numbers must be JSON numbers
      { name: 'vs', rating: 1500, lo: 1450, hi: 1550, games: 5, vsAnchor: { wins: 3, losses: 2, rate: 0.6, lo: 0.9, hi: 1 } },
      { name: 'neg', rating: 1500, lo: 1450, hi: 1550, games: -4, wins: 1.7e12 },
      42,
      null,
      ['array'],
      { __proto__: { rating: 1 }, name: 'proto' },
    ];
    j.sprt = [{ a: '<img src=x onerror=alert(1)>', b: 'b', result: 'DROP TABLE', games: -1, score: 7 }, { a: 'only-a' }, 'nope'];
    j.tune = [{ base: 'b', vary: { 'k\u0007': ['v', { o: 1 }, 3], z: 'not a list' }, rounds: 'x', winner: 'x' }];
    j.league = { best: 5, pool: 'x', promoted: [{ name: null }, { name: 'p', at: 'yesterday' }] };
    j.generatedAt = 'not a time';
    j.totals = { games: -5, decisive: 'x' };
    const l = parseLadder(j);
    const by = new Map(l.players.map((p) => [p.name, p]));
    expect(by.get('ok')).toMatchObject({ rating: 1550, lo: 1500, hi: 1600 });
    expect(by.has('evil name')).toBe(true);
    expect([...by.keys()].filter((n) => n === 'ok')).toHaveLength(1);
    const long = l.players.find((p) => p.name.startsWith('xxx'))!;
    expect(long.name.length).toBeLessThanOrEqual(80);
    expect(long).toMatchObject({ rating: null, lo: null, hi: null, rated: false });
    expect(by.get('swapped')).toMatchObject({ lo: null, hi: null });
    expect(by.get('huge')).toMatchObject({ rating: null, rated: false });
    expect(by.get('strnum')).toMatchObject({ rating: null });
    expect(by.get('vs')!.vsAnchor).toMatchObject({ wins: 3, losses: 2, rate: 0.6, lo: null, hi: null });
    expect(by.get('neg')).toMatchObject({ games: null, wins: null });
    expect(by.get('proto')).toMatchObject({ rating: null });
    expect(l.players.every((p) => !/[\u0000-\u001f‮]/.test(p.name))).toBe(true);
    expect(l.sprt).toHaveLength(1);
    expect(l.sprt[0]).toMatchObject({ a: '<img src=x onerror=alert(1)>', result: 'unknown', games: null, score: null });
    expect(l.tune[0]).toMatchObject({ vary: [{ key: 'k', values: ['v', '3'] }, { key: 'z', values: [] }], rounds: 0, final: [], winner: null });
    expect(l.league).toEqual({ best: null, pool: [], promoted: [{ name: 'p', at: null, reason: null }] });
    expect(l.generatedAt).toBeNull();
    expect(l.totals.games).toBeNull();
    // Rated players with intervals come first, in rating order.
    const rated = l.players.filter((p) => p.rated);
    expect(rated.map((p) => p.rating)).toEqual([...rated.map((p) => p.rating)].sort((a, b) => b! - a!));
  });

  it('caps the player list and logs', () => {
    const j = clone();
    j.players = Array.from({ length: 5000 }, (_, i) => ({ name: `p${i}`, rating: 1500, lo: 1400, hi: 1600, games: 1 }));
    j.sprt = Array.from({ length: 5000 }, () => ({ a: 'a', b: 'b', result: 'H1' }));
    const l = parseLadder(j);
    expect(l.players.length).toBe(100);
    expect(l.sprt.length).toBe(30);
  });

  it('a player with rated: false or no decisive game is unrated', () => {
    const l = parseLadder({ players: [{ name: 'a', rating: 1500, lo: 800, hi: 2200, rated: false, games: 0 }, { name: 'b', rating: 1600, lo: 1500, hi: 1700, games: 0 }] });
    expect(l.players.every((p) => !p.rated)).toBe(true);
  });
});

describe('interval honesty', () => {
  const a = player('a', 1600, 1560, 1640);
  const b = player('b', 1580, 1530, 1630);
  const c = player('c', 1500, 1500, 1500, { isZero: true });
  const d = player('d', 1420, 1380, 1460);
  const u = player('u', 1500, 800, 2200, { rated: false });
  const all = [a, b, c, d, u];

  it('overlap and relation', () => {
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(a, c)).toBe(false);
    expect(relation(a, c)).toBe('above');
    expect(relation(d, c)).toBe('below');
    expect(relation(b, a)).toBe('overlap');
    expect(relation(a, a)).toBe('self');
    expect(relation(u, c)).toBe('none');
  });

  it('rank ranges cover the ties', () => {
    expect(rankRange(a, all)).toEqual([1, 2]);
    expect(rankRange(b, all)).toEqual([1, 2]);
    expect(rankRange(c, all)).toEqual([3, 3]);
    expect(rankRange(d, all)).toEqual([4, 4]);
    expect(rankRange(u, all)).toBeNull();
  });

  it('sample: only what the intervals separate from forge-default', () => {
    const l = parseLadder(raw);
    const s = anchorSummary(l);
    expect(s).toContain('weaker: forge-cautious');
    expect(s).toContain('stronger than forge-default: search-v1-fixed3;');
    expect(s).toMatch(/5 others are not separated/);
    const top = l.players[0]!;
    expect(rankRange(top, l.players)![0]).toBe(1);
    expect(rankRange(top, l.players)![1]).toBeGreaterThan(3);
  });

  it('summary with no separation', () => {
    const l = parseLadder({ players: [{ name: 'forge-default', rating: 1500 }, { name: 'x', rating: 1510, lo: 1400, hi: 1620, games: 8 }] });
    expect(anchorSummary(l)).toBe('No player is separated from forge-default yet: every interval includes 1500.');
  });

  it('axis covers every interval and the anchor, on round numbers', () => {
    const d1 = axisDomain(all);
    expect(d1.min).toBeLessThanOrEqual(1380);
    expect(d1.max).toBeGreaterThanOrEqual(1640);
    expect(d1.min % 50).toBe(0);
    expect(d1.ticks.every((t) => t >= d1.min && t <= d1.max)).toBe(true);
    const d2 = axisDomain([]);
    expect(d2.max - d2.min).toBe(300);
    expect(d2.min).toBeLessThan(1500);
    expect(axisPct(d2.min - 999, d2)).toBe(0);
    expect(axisPct(d2.max + 999, d2)).toBe(100);
  });
});

describe('formatting', () => {
  it('delta, labels, verdicts', () => {
    expect(fmtDelta(1563.2, 1500)).toBe('+63');
    expect(fmtDelta(1418.9, 1500)).toBe('−81');
    expect(fmtDelta(1500.2, 1500)).toBe('±0');
    expect(setLabel('tools/ai-bench/pairs-confirm.txt')).toBe('the confirm deck set');
    expect(setLabel('all')).toBe('every deck set');
    expect(ciLabel('bootstrap:200')).toContain('200 resamples');
    const l = parseLadder(raw);
    expect(sprtVerdict(l.sprt[1]!)).toBe('policy-outlet is stronger than forge-default by at least +20 Elo');
    expect(sprtVerdict(l.sprt[2]!)).toBe('policy-outlet-reckless is not stronger than policy-outlet by +20 Elo (at most 0 Elo)');
    expect(sprtVerdict(l.sprt[3]!)).toMatch(/^Inconclusive/);
  });

  it('staleness: a day amber, three red', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(ladderStaleness(new Date('2026-10-03T06:00:00Z'), now).level).toBe('fresh');
    expect(ladderStaleness(new Date('2026-10-02T06:00:00Z'), now).level).toBe('amber');
    expect(ladderStaleness(new Date('2026-09-29T06:00:00Z'), now).level).toBe('red');
    expect(ladderStaleness(null, now).level).toBe('unknown');
  });

  it('rebases the sample to now', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    const l = rebaseLadder(parseLadder(raw), now);
    expect(l.generatedAt!.getTime()).toBe(now.getTime() - 2 * 3600_000);
    expect(l.sprt[0]!.at!.getTime()).toBeLessThan(l.generatedAt!.getTime());
  });
});

describe('source and fetch', () => {
  it('reads #lab/ladder sources', () => {
    expect(ladderSource('#lab/ladder', '/')).toEqual({ kind: 'default', url: DEFAULT_LADDER_SRC });
    expect(ladderSource('#lab/ladder?src=sample', '/ForgeCoach/')).toEqual({ kind: 'sample', url: '/ForgeCoach/ladder-sample.json' });
    expect(ladderSource('#lab/ladder?src=https://x.test/l.json?a=1', '/')).toEqual({ kind: 'custom', url: 'https://x.test/l.json?a=1' });
    expect(ladderSource('#lab/ladder?src=javascript:alert(1)', '/').kind).toBe('invalid');
    expect(ladderSource('#lab/ladder?src=https://u:p@x.test/', '/').kind).toBe('invalid');
    // The progress page's source is not the ladder's.
    expect(ladderSource('#lab?src=sample', '/').kind).toBe('default');
  });

  it('fetches with a cache-buster and no credentials', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const l = await fetchLadder('https://x.test/ladder.json', {
      now: 7,
      fetch: async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200, text: async () => JSON.stringify(raw) };
      },
    });
    expect(seen!.url).toBe('https://x.test/ladder.json?_=7');
    expect(seen!.init?.credentials).toBe('omit');
    expect(l.players.length).toBe(9);
  });

  it('sorts errors by kind', async () => {
    const res = (status: number, body: string) => async () => ({ ok: status < 400, status, text: async () => body });
    await expect(fetchLadder('u', { fetch: res(404, '') })).rejects.toMatchObject({ kind: 'notFound' });
    await expect(fetchLadder('u', { fetch: res(500, '') })).rejects.toMatchObject({ kind: 'http', status: 500 });
    await expect(fetchLadder('u', { fetch: res(200, '{nope') })).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchLadder('u', { fetch: res(200, '[]') })).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchLadder('u', { fetch: res(200, ' '.repeat(2 * 1024 * 1024)) })).rejects.toMatchObject({ kind: 'tooLarge' });
    await expect(
      fetchLadder('u', {
        fetch: async () => {
          throw new TypeError('offline');
        },
      }),
    ).rejects.toBeInstanceOf(LabFetchError);
  });
});

describe('LADDER_FIELDS', () => {
  it('names only fields of the sample (the real schema)', () => {
    const has = (o: unknown, path: string[]): boolean => {
      if (!path.length) return true;
      const [k, ...rest] = path;
      if (k!.endsWith('[]')) {
        const arr = (o as Record<string, unknown>)[k!.slice(0, -2)];
        return Array.isArray(arr) && arr.some((x) => has(x, rest));
      }
      if (o === null || typeof o !== 'object' || !(k! in o)) return false;
      const v = (o as Record<string, unknown>)[k!];
      return rest.length === 0 || (v !== null && has(v, rest));
    };
    for (const f of LADDER_FIELDS) {
      const path = f.split(' ')[0]!.split('.');
      expect(has(raw, path), f).toBe(true);
    }
  });
});
