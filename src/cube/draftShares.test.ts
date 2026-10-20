// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../claude.ts';
import {
  draftShares,
  fetchDraftDecks,
  MAIN_MIN_SPELLS,
  mainColours,
  makeupBucket,
  parseDraftDecks,
  recordSoloDeck,
  sharesByMonth,
  shareWords,
  TRIPLE_MIN_DECKS,
  type DraftDeckMakeup,
} from './draftShares.ts';

const deck = (spells: Partial<Record<'W' | 'U' | 'B' | 'R' | 'G', number>>, o: Partial<DraftDeckMakeup> = {}): DraftDeckMakeup => ({
  source: 'room',
  day: '2026-10-17',
  format: 'grid',
  spells: { W: 0, U: 0, B: 0, R: 0, G: 0, ...spells },
  colourless: 2,
  lands: 17,
  unread: 0,
  ...o,
});

// The two decks of Justin and Evan's Omega draft of 2026-10-17 and Justin's Rakdos against the bot, as
// mtg-table's GET /draft-decks answers them (tools/draft-decks.mjs over Forge's own scripts).
const OMEGA = {
  ok: true,
  v: 1,
  cube: 'omega',
  scripts: true,
  decks: [
    { source: 'room', day: '2026-10-17', format: 'grid', spells: { W: 3, U: 9, B: 5, R: 5, G: 6 }, colourless: 2, lands: 17, unread: 0 },
    { source: 'room', day: '2026-10-17', format: 'grid', spells: { W: 9, U: 0, B: 0, R: 12, G: 0 }, colourless: 3, lands: 17, unread: 0 },
    { source: 'solo', day: '2026-10-17', format: null, spells: { W: 0, U: 0, B: 11, R: 10, G: 0 }, colourless: 3, lands: 17, unread: 0 },
  ],
};

describe('a deck’s main colours (the census’s 3+ spells, mtg-table D447)', () => {
  it('counts a colour from three spells', () => {
    expect(MAIN_MIN_SPELLS).toBe(3);
    expect(mainColours(deck({ W: 9, R: 12 }))).toBe('WR');
    expect(mainColours(deck({ W: 9, R: 12, B: 2 }))).toBe('WR');
    expect(mainColours(deck({ W: 9, R: 12, B: 3 }))).toBe('WBR');
    expect(mainColours(deck({}))).toBe('');
  });
  it('folds four and five colours into 4+', () => {
    expect(makeupBucket('WUBRG')).toBe('4+');
    expect(makeupBucket('WUBR')).toBe('4+');
    expect(makeupBucket('UBR')).toBe('UBR');
    expect(makeupBucket('')).toBe('');
  });
});

describe('parseDraftDecks', () => {
  it('reads the helper’s answer', () => {
    const d = parseDraftDecks(OMEGA, 'omega');
    expect(d?.decks).toHaveLength(3);
    expect(d?.decks[2]).toEqual({ source: 'solo', day: '2026-10-17', format: null, spells: { W: 0, U: 0, B: 11, R: 10, G: 0 }, colourless: 3, lands: 17, unread: 0 });
    expect(d?.scripts).toBe(true);
  });
  it('refuses another cube’s, another version, and a bad deck', () => {
    expect(parseDraftDecks(OMEGA, 'vintage')).toBeNull();
    expect(parseDraftDecks({ ...OMEGA, v: 2 }, 'omega')).toBeNull();
    expect(parseDraftDecks({ ...OMEGA, decks: [{ ...OMEGA.decks[0], spells: { W: -1, U: 0, B: 0, R: 0, G: 0 } }] }, 'omega')).toBeNull();
    expect(parseDraftDecks({ ...OMEGA, decks: [{ ...OMEGA.decks[0], source: 'bot' }] }, 'omega')).toBeNull();
    expect(parseDraftDecks({ ...OMEGA, decks: [{ ...OMEGA.decks[0], day: 'yesterday' }] }, 'omega')).toBeNull();
    expect(parseDraftDecks(null, 'omega')).toBeNull();
  });
});

describe('draftShares', () => {
  it('counts the three Omega decks: colours, exact makeups and sizes, each with its interval', () => {
    const t = draftShares(parseDraftDecks(OMEGA, 'omega')!.decks);
    expect(t.n).toBe(3);
    expect(t.bySource).toEqual({ room: 2, solo: 1 });
    expect([t.first, t.last]).toEqual(['2026-10-17', '2026-10-17']);
    const col = Object.fromEntries(t.colours.map((r) => [r.key, r.k]));
    expect(col).toEqual({ W: 2, U: 1, B: 2, R: 3, G: 1 });
    const r = t.colours.find((x) => x.key === 'R')!;
    expect(r.share).toBe(1);
    expect(r.lo).toBeGreaterThan(0.4);
    expect(r.lo).toBeLessThan(0.45);
    expect(r.hi).toBe(1);
    const mk = Object.fromEntries(t.makeups.filter((x) => x.k > 0).map((x) => [x.key, x.k]));
    expect(mk).toEqual({ WR: 1, BR: 1, '4+': 1 });
    expect(t.triples).toBe(false);
    expect(t.makeups.map((x) => x.key)).toEqual(['W', 'U', 'B', 'R', 'G', 'WU', 'WB', 'WR', 'WG', 'UB', 'UR', 'UG', 'BR', 'BG', 'RG', '3', '4+']);
    expect(t.makeups.reduce((s, x) => s + x.k, 0)).toBe(3);
    expect(t.sizes.map((x) => [x.key, x.k])).toEqual([['1', 0], ['2', 2], ['3', 0], ['4+', 1]]);
  });
  it('shows triples one by one only from TRIPLE_MIN_DECKS decks', () => {
    const many = Array.from({ length: TRIPLE_MIN_DECKS }, (_, i) => deck(i % 2 ? { W: 5, U: 5, B: 5 } : { R: 5, G: 5 }));
    const t = draftShares(many);
    expect(t.triples).toBe(true);
    expect(t.makeups.find((x) => x.key === 'WUB')?.k).toBe(TRIPLE_MIN_DECKS / 2);
    expect(t.makeups.some((x) => x.key === '3')).toBe(false);
    expect(t.makeups.filter((x) => x.key.length === 3)).toHaveLength(10);
    expect(draftShares(many.slice(1)).makeups.find((x) => x.key === '3')?.k).toBe((TRIPLE_MIN_DECKS - 2) / 2 + 1);
  });
  it('a deck with no main colour is its own row, and unread cards are counted', () => {
    const t = draftShares([deck({ W: 2 }, { colourless: 20, unread: 1 }), deck({ W: 9, U: 9 })]);
    expect(t.makeups.at(-1)).toMatchObject({ key: '', k: 1, n: 2 });
    expect(t.sizes[0]).toMatchObject({ key: '0', k: 1 });
    expect([t.unreadDecks, t.unreadCards]).toEqual([1, 1]);
  });
  it('none yet: every share 0 of 0, no interval', () => {
    const t = draftShares([]);
    expect(t.n).toBe(0);
    expect(t.colours.every((r) => r.k === 0 && r.n === 0 && r.lo === 0 && r.hi === 0)).toBe(true);
    expect([t.first, t.last]).toEqual([null, null]);
  });
  it('words a share with its count and interval', () => {
    expect(shareWords({ key: 'R', k: 3, n: 3, share: 1, lo: 0.438, hi: 1 })).toBe('100% (3 of 3; 44–100%)');
  });
});

describe('sharesByMonth', () => {
  it('splits by month, oldest first', () => {
    const m = sharesByMonth([deck({ W: 9, R: 9 }, { day: '2026-11-02' }), deck({ U: 9, B: 9 }, { day: '2026-10-17' }), deck({ W: 9, U: 9 }, { day: '2026-10-20' })]);
    expect(m.map((x) => [x.month, x.n])).toEqual([['2026-10', 2], ['2026-11', 1]]);
    expect(m[0]!.colours.find((r) => r.key === 'U')?.k).toBe(2);
    expect(m[1]!.colours.find((r) => r.key === 'R')?.k).toBe(1);
  });
});

describe('the client', () => {
  const resp = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  it('GET /draft-decks?cube=: the cube’s decks', async () => {
    const urls: string[] = [];
    const r = await fetchDraftDecks('omega', { target, fetch: (u) => (urls.push(u), resp(200, OMEGA)) });
    expect(urls).toEqual(['http://127.0.0.1:8643/draft-decks?cube=omega']);
    expect(r.state === 'ok' && r.data.decks.length).toBe(3);
  });
  it('says why when it cannot read them', async () => {
    expect((await fetchDraftDecks('omega', { target, fetch: () => resp(404, { type: 'error', message: 'not found' }) })).state).toBe('unavailable');
    expect((await fetchDraftDecks('omega', { target, fetch: () => Promise.reject(new Error('refused')) })).state).toBe('none');
    expect((await fetchDraftDecks('omega', { target, fetch: () => resp(400, { message: 'bad cube' }) }))).toEqual({ state: 'error', message: 'bad cube' });
    expect((await fetchDraftDecks('omega', { target, fetch: () => resp(200, { ok: true, v: 1, cube: 'other', decks: [] }) })).state).toBe('error');
  });
  it('sends the pairing token as a header on a LAN page, never in the URL', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    await fetchDraftDecks('omega', { target: { baseUrl: 'http://192.168.1.5:8643', token: 'T'.repeat(20) }, fetch: (u, i) => (seen.push([u, i]), resp(200, OMEGA)) });
    expect(seen[0]![0]).not.toContain('token');
    expect((seen[0]![1]?.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('T'.repeat(20));
  });
  it('POST /draft-deck: the solo deck, true on 201', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const rec = { cubeId: 'omega', draftId: 'draft-abc-1', format: 'grid' as const, main: [[23, 'Lightning Bolt'], [17, 'Mountain']] as Array<[number, string]> };
    expect(await recordSoloDeck(rec, { target, fetch: (u, i) => (seen.push([u, i]), resp(201, { ok: true })) })).toBe(true);
    expect(seen[0]![0]).toBe('http://127.0.0.1:8643/draft-deck');
    expect(JSON.parse(String(seen[0]![1]?.body))).toEqual(rec);
    expect(await recordSoloDeck(rec, { target, fetch: () => resp(404, {}) })).toBe(false);
    expect(await recordSoloDeck(rec, { target, fetch: () => Promise.reject(new Error('down')) })).toBe(false);
  });
});

describe('the setting: counting your drafts against the bot', () => {
  it('is on by default, can be turned off, and round-trips', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    expect(loadSettings().recordDrafts).toBeUndefined();
    saveSettings({ ...loadSettings(), recordDrafts: false });
    expect(loadSettings().recordDrafts).toBe(false);
    saveSettings({ ...loadSettings(), recordDrafts: undefined });
    expect(loadSettings().recordDrafts).toBeUndefined();
    mem.set(SETTINGS_KEY, JSON.stringify({ recordDrafts: 'no' }));
    expect(loadSettings().recordDrafts).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
