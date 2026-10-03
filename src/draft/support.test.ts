// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildDecks } from '../cube/builder.ts';
import { context, loadCube, loadRealMeta } from '../cube/testdata/load.ts';
import { aiFlagsFromDoc, withMetaFlags } from './aiFlags.ts';
import { labCards } from './cards.ts';
import { aiStep, newDraft, selfPlay, toAct } from './draft.ts';
import { checkRequest, deckSize, launchMatch, matchDeck, matchSupported, type MatchRequest } from './launch.ts';
import { buildPickPrompt } from './pickPrompt.ts';
import { clearDraft, DRAFT_KEY, loadDraft, saveDraft } from './store.ts';

const ctx = context('synergy', loadRealMeta('synergy'));
const names = ctx.cube.cards.map((c) => c.name);

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('store', () => {
  it('round-trips a draft and ignores junk', () => {
    const s = memStore();
    expect(loadDraft(s)).toBeNull();
    const draft = newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed: 5, youFirst: false, now: 1 });
    saveDraft({ draft, hints: true }, s);
    expect(loadDraft(s)?.draft).toEqual(draft);
    s.setItem(DRAFT_KEY, '{"draft":{"v":2}}');
    expect(loadDraft(s)).toBeNull();
    s.setItem(DRAFT_KEY, 'not json');
    expect(loadDraft(s)).toBeNull();
    clearDraft(s);
    expect(s.m.size).toBe(0);
  });
});

describe('AI flags from the cube documents', () => {
  const read = (f: string) => readFileSync(new URL(`../../public/cubes/${f}-cube-180.md`, import.meta.url), 'utf8');
  it('vintage: one bullet per flag', () => {
    const cube = loadCube('vintage');
    const f = aiFlagsFromDoc(read('vintage'), cube.cards.map((c) => c.name));
    expect(f.all.has('Goblin Bombardment')).toBe(true);
    expect(f.all.has('Toxic Deluge')).toBe(true);
    expect(f.random.has('Tinker')).toBe(true);
    expect(f.random.has('Goblin Welder')).toBe(false); // both flags: All wins
    expect(f.all.has('Lightning Bolt')).toBe(false);
  });
  it('pauper: both ratings on one line', () => {
    const cube = loadCube('pauper');
    const f = aiFlagsFromDoc(read('pauper'), cube.cards.map((c) => c.name));
    expect(f.all.has('Prismatic Strands')).toBe(true);
    expect(f.all.has('Chromatic Star')).toBe(true);
    expect(f.random.has('Fling')).toBe(true);
    expect(f.all.has('Fling')).toBe(false);
  });
  it('a cube without flags has none; a meta flag adds one', () => {
    const f = aiFlagsFromDoc(read('synergy'), names);
    expect(f.all.size + f.random.size).toBe(0);
    const meta = loadRealMeta('synergy');
    meta.cube.cards = [{ name: 'Viscera Seer', remAIDeck: true } as never];
    expect(withMetaFlags(f, meta).all.has('Viscera Seer')).toBe(true);
  });
});

describe('the match launcher client', () => {
  const draft = selfPlay(newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 11, youFirst: true, now: 1 }), labCards(ctx));
  const you = buildDecks(ctx, draft.picks.you)[0]!;
  const ai = buildDecks(ctx, draft.picks.ai)[0]!;
  const req: MatchRequest = {
    deck: matchDeck('My draft', you, draft.picks.you),
    aiDeck: matchDeck('AI draft', ai, draft.picks.ai),
    aiProfile: 'Default',
    games: 3,
  };
  const target = { baseUrl: 'http://127.0.0.1:8643', token: 'tok' };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

  it('builds 40-card decks with counted sideboards', () => {
    expect(deckSize(req.deck)).toBe(40);
    expect(deckSize(req.aiDeck)).toBe(40);
    expect(req.deck.sideboard.every(([n, s]) => n >= 1 && typeof s === 'string')).toBe(true);
    expect(checkRequest(req)).toBeNull();
    expect(checkRequest({ ...req, games: 2 as 3 })).toMatch(/best of three/);
  });

  it('reads match: 1 from /health, with the token', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, { ok: true, helper: 1, match: 1 }));
    expect(await matchSupported({ fetch: f, target })).toBe(true);
    expect(f.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8643/health');
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('tok');
    expect(await matchSupported({ fetch: () => json(200, { ok: true, helper: 1 }), target })).toBe(false);
    expect(await matchSupported({ fetch: () => Promise.reject(new Error('down')), target })).toBe(false);
  });

  it('posts the request shape and reports errors in words', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, { ok: true, detail: 'Engine restarting' }));
    expect(await launchMatch(req, { fetch: f, target })).toEqual({ ok: true, detail: 'Engine restarting' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8643/match');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as MatchRequest;
    expect(Object.keys(body).sort()).toEqual(['aiDeck', 'aiProfile', 'deck', 'games']);
    expect(body.deck.main[0]).toHaveLength(2);
    expect(await launchMatch(req, { fetch: () => json(404, {}), target })).toMatchObject({ ok: false, message: expect.stringMatching(/no match launcher/) });
    expect(await launchMatch(req, { fetch: () => json(500, { message: 'engine busy' }), target })).toMatchObject({ ok: false, message: expect.stringMatching(/engine busy/) });
    expect(await launchMatch(req, { fetch: () => Promise.reject(new TypeError('x')), target })).toMatchObject({ ok: false });
  });
});

describe('pick prompt', () => {
  it('shows the choice and what the player knows, never the AI’s hidden Winston picks', () => {
    let d = newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed: 9, youFirst: false, now: 1 });
    const cards = labCards(ctx);
    // Let the AI play its first turn.
    while (toAct(d) === 'ai') d = aiStep(d, cards);
    const p = buildPickPrompt({ ctx, draft: d, infos: new Map(), question: 'Is this pile good?' });
    expect(p.user).toMatch(/Pile \d of 3/);
    expect(p.user).toMatch(/Is this pile good\?/);
    const hidden = d.picks.ai.filter((n) => !d.seen.you.includes(n));
    for (const n of hidden) expect(p.user).not.toContain(n);
  });
});
