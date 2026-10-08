// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildDecks } from '../cube/builder.ts';
import { context, loadCube, loadRealMeta } from '../cube/testdata/load.ts';
import { aiFlagsFromDoc, withMetaFlags } from './aiFlags.ts';
import { labCards } from './cards.ts';
import { aiStep, apply, newDraft, selfPlay, toAct } from './draft.ts';
import { poolColours } from '../cube/pick.ts';
import { guideFor, guidePromptSection } from '../cube/guides/index.ts';
import { matchDeck } from './deck.ts';
import { advertisedPolicies, advertisedSearchBudget, AI_POLICIES, AI_PROFILES, isAiProfile, checkRequest, deckSize, defaultPolicy, effectivePolicy, engineHealth, policyFields, ensureEngineAwake, launcherStatus, launchMatch, matchSupported, wakeEngine, safeDeckName, type MatchRequest } from './launch.ts';
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
    deck: matchDeck('Practice draft — Golgari', you, draft.picks.you),
    aiDeck: matchDeck(`AI Drafter - ${ai.name}`, ai, draft.picks.ai),
    aiProfile: 'Default',
    games: 3,
  };
  const target = { baseUrl: 'http://127.0.0.1:8643', token: 'tok' };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

  it('builds 40-card decks with counted sideboards and names the launcher accepts', () => {
    expect(deckSize(req.deck)).toBe(40);
    expect(deckSize(req.aiDeck)).toBe(40);
    expect(req.deck.name).toBe('Practice draft - Golgari');
    expect(req.aiDeck.name).toMatch(/^AI Drafter - /);
    expect(req.deck.sideboard?.every(([n, s]) => n >= 1 && typeof s === 'string')).toBe(true);
    expect(checkRequest(req)).toBeNull();
    expect(checkRequest({ ...req, games: 10 })).toMatch(/1 to 9/);
    expect(checkRequest({ ...req, deck: { ...req.deck, main: req.deck.main.slice(0, 3) } })).toMatch(/needs 40/);
    expect(checkRequest({ ...req, deck: { ...req.deck, name: 'Bad — name' } })).toMatch(/characters/);
  });

  it('safeDeckName keeps what the launcher allows', () => {
    expect(safeDeckName('Gruul · Artifacts')).toBe('Gruul - Artifacts');
    expect(safeDeckName('  —  ')).toBe('Cube draft');
    expect(safeDeckName('x'.repeat(100))).toHaveLength(80);
  });

  it('reads match from /health, on ok true or false, with the token', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, { ok: true, helper: 1, match: 1 }));
    expect(await launcherStatus({ fetch: f, target })).toBe('ready');
    expect(f.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8643/health');
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('tok');
    expect(await launcherStatus({ fetch: () => json(200, { ok: false, helper: 1, error: 'no claude', match: 1 }), target })).toBe('ready');
    expect(await launcherStatus({ fetch: () => json(200, { ok: true, helper: 1, match: 0 }), target })).toBe('no-launcher');
    expect(await launcherStatus({ fetch: () => Promise.reject(new Error('down')), target })).toBe('down');
    expect(await matchSupported({ fetch: () => json(200, { ok: true, helper: 1 }), target })).toBe(false);
  });

  it('posts the request and returns the started match with its warnings', async () => {
    const started = { ok: true, yourDeck: { name: 'x', path: 'var/match/m1/you.dck', cards: 39 }, aiDeck: { name: 'y', cards: 40 }, aiProfile: 'Default', games: 3, ms: 14000, warnings: ['the engine loaded 39 of the 40 main-deck cards'] };
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, started));
    const r = await launchMatch(req, { fetch: f, target });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8643/match');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init?.body)) as MatchRequest;
    expect(Object.keys(body).sort()).toEqual(['aiDeck', 'aiProfile', 'deck', 'games']);
    expect(body.deck.main[0]).toHaveLength(2);
  });

  it('reports refusals: problems on 400, restored on 502, words for the rest', async () => {
    const r400 = await launchMatch(req, { fetch: () => json(400, { ok: false, type: 'error', message: 'bad deck', problems: ['aiDeck: 1 card name the engine does not know: X'] }), target });
    expect(r400).toMatchObject({ ok: false, status: 400, message: 'bad deck', problems: [expect.stringMatching(/does not know/)] });
    const r502 = await launchMatch(req, { fetch: () => json(502, { ok: false, type: 'error', message: 'engine log tail', restored: true }), target });
    expect(r502).toMatchObject({ ok: false, status: 502, restored: true });
    expect(await launchMatch(req, { fetch: () => json(503, { ok: false, type: 'error', message: 'no launcher' }), target })).toMatchObject({ status: 503, message: expect.stringMatching(/start ForgeCoach again/) });
    expect(await launchMatch(req, { fetch: () => json(409, {}), target })).toMatchObject({ status: 409, message: expect.stringMatching(/already/) });
    expect(await launchMatch(req, { fetch: () => Promise.reject(new TypeError('x')), target })).toMatchObject({ ok: false, status: 0 });
  });
});

describe('a sleeping engine (D308)', () => {
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const idle = { ok: true, helper: 1, match: 1, engine: 'idle', engine_start: 1, idleSince: 'x', exitsAt: null };
  const started = { ok: true, already: false, yourDeck: { name: 'x', path: null, cards: 40 }, aiDeck: { name: 'y', cards: 40 }, aiProfile: 'Default', games: 3, ms: 12000, warnings: [] };

  it('reads engine and engine_start from /health; no engine key is an older helper, running', async () => {
    expect(await engineHealth({ fetch: () => json(200, idle), target })).toEqual({ status: 'asleep', canWake: true, aiPolicies: [] });
    expect(await engineHealth({ fetch: () => json(200, { ...idle, engine: 'running' }), target })).toEqual({ status: 'ready', canWake: true, aiPolicies: [] });
    expect(await engineHealth({ fetch: () => json(200, { ok: true, helper: 1, match: 1 }), target })).toEqual({ status: 'ready', canWake: false, aiPolicies: [] });
    expect(await engineHealth({ fetch: () => json(200, { ok: false, helper: 1, match: 1, engine: 'idle' }), target })).toEqual({ status: 'asleep', canWake: false, aiPolicies: [] });
    // The match set-up can still Begin: POST /match wakes the engine.
    expect(await launcherStatus({ fetch: () => json(200, idle), target })).toBe('asleep');
    expect(await matchSupported({ fetch: () => json(200, idle), target })).toBe(true);
  });

  it('wakes with POST /engine/start and no body', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, started));
    expect(await wakeEngine({ fetch: f, target })).toMatchObject({ ok: true, already: false, ms: 12000, warnings: [] });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8643/engine/start');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(await wakeEngine({ fetch: () => json(200, { ok: true, already: true }), target })).toMatchObject({ ok: true, already: true });
    expect(await wakeEngine({ fetch: () => json(502, { ok: false, type: 'error', message: 'engine log tail', restored: false }), target })).toMatchObject({ ok: false, status: 502, message: 'engine log tail', restored: false });
    expect(await wakeEngine({ fetch: () => json(409, {}), target })).toMatchObject({ ok: false, status: 409 });
  });

  it('Play wakes an asleep engine first, and only then', async () => {
    const calls: string[] = [];
    const fake = (health: unknown) =>
      vi.fn((u: string, _i?: RequestInit) => {
        calls.push(u.replace(target.baseUrl, ''));
        return u.endsWith('/health') ? json(200, health) : json(200, started);
      });
    const onWaking = vi.fn();
    expect(await ensureEngineAwake({ fetch: fake(idle), target, onWaking })).toMatchObject({ ok: true, woke: true });
    expect(onWaking).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['/health', '/engine/start']);
    calls.length = 0;
    for (const h of [{ ...idle, engine: 'running' }, { ok: true, helper: 1, match: 1 }, { ok: true, helper: 1, match: 0 }, { ...idle, engine_start: undefined }]) {
      expect(await ensureEngineAwake({ fetch: fake(h), target, onWaking })).toMatchObject({ ok: true, woke: false });
    }
    expect(await ensureEngineAwake({ fetch: () => Promise.reject(new TypeError('down')), target, onWaking })).toMatchObject({ ok: true, woke: false });
    expect(calls.every((c) => c === '/health')).toBe(true);
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it('a wake that fails or is cancelled says so', async () => {
    const f = (u: string) => (u.endsWith('/health') ? json(200, idle) : json(504, {}));
    expect(await ensureEngineAwake({ fetch: f, target })).toMatchObject({ ok: false, status: 504, message: expect.stringMatching(/three minutes/) });
    const c = new AbortController();
    const hang = (u: string, i?: RequestInit) =>
      u.endsWith('/health')
        ? json(200, idle)
        : new Promise<never>((_, rej) => {
            const no = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            // As fetch does: an already-aborted signal rejects at once.
            if (i?.signal?.aborted) no();
            else i?.signal?.addEventListener('abort', no);
          });
    const p = ensureEngineAwake({ fetch: hang, target, signal: c.signal, onWaking: () => c.abort() });
    expect(await p).toMatchObject({ ok: false, status: 0, message: 'Cancelled.' });
  });
});

describe('plain Play vs Forge picks the AI profile (mtg-table D381)', () => {
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const idle = { ok: true, helper: 1, match: 1, engine: 'idle', engine_start: 1, engine_start_profile: 1 };
  const started = { ok: true, already: false, yourDeck: { name: 'x', path: null, cards: 40 }, aiDeck: { name: 'y', cards: 40 }, aiProfile: 'Cautious', games: 1, ms: 9000, warnings: [] };
  const recorder = (health: unknown, reply: (u: string, i?: RequestInit) => ReturnType<typeof json> = () => json(200, started)) => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const f = vi.fn((u: string, i?: RequestInit) => {
      calls.push({ path: u.replace(target.baseUrl, ''), body: i?.body });
      return u.endsWith('/health') ? json(200, health) : reply(u, i);
    });
    return { f, calls };
  };

  it('reads engine_start_profile from /health, only beside engine_start', async () => {
    expect(await engineHealth({ fetch: () => json(200, idle), target })).toEqual({ status: 'asleep', canWake: true, canPickProfile: true, aiPolicies: [] });
    expect((await engineHealth({ fetch: () => json(200, { ...idle, engine_start: undefined }), target })).canPickProfile).toBeUndefined();
    expect((await engineHealth({ fetch: () => json(200, { ...idle, engine_start_profile: undefined }), target })).canPickProfile).toBeUndefined();
    expect((await engineHealth({ fetch: () => json(200, { ...idle, engine_start_profile: true }), target })).canPickProfile).toBeUndefined();
  });

  it('wakeEngine sends {"aiProfile"} as JSON, and no body without one', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, started));
    await wakeEngine({ fetch: f, target, aiProfile: 'Cautious' });
    const init = f.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toEqual({ aiProfile: 'Cautious' });
    expect((init.headers as Record<string, string>)['Content-Type'] ?? (init.headers as Record<string, string>)['content-type']).toMatch(/json/);
    await wakeEngine({ fetch: f, target, aiProfile: null });
    expect(f.mock.calls[1]![1]!.body).toBeUndefined();
    expect(AI_PROFILES.map((p) => p.id).every(isAiProfile)).toBe(true);
    expect(isAiProfile('Hard')).toBe(false);
  });

  it('asleep: wakes with the profile when the helper takes it, with no body when it does not', async () => {
    const a = recorder(idle);
    expect(await ensureEngineAwake({ fetch: a.f, target, aiProfile: 'Reckless' })).toMatchObject({ ok: true, woke: true, profileSent: true });
    expect(a.calls.map((c) => c.path)).toEqual(['/health', '/engine/start']);
    expect(JSON.parse(String(a.calls[1]!.body))).toEqual({ aiProfile: 'Reckless' });
    const old = recorder({ ...idle, engine_start_profile: undefined });
    expect(await ensureEngineAwake({ fetch: old.f, target, aiProfile: 'Reckless' })).toMatchObject({ ok: true, woke: true, profileSent: false });
    expect(old.calls[1]!.body).toBeUndefined();
    const none = recorder(idle);
    expect(await ensureEngineAwake({ fetch: none.f, target })).toMatchObject({ ok: true, woke: true, profileSent: false });
    expect(none.calls[1]!.body).toBeUndefined();
  });

  it('running: a picked profile still goes out, so the "not applied" warning reaches the player; nothing else does', async () => {
    const warn = 'The running match plays Default; Cautious was not applied (it applies the next time the engine starts).';
    const running = { ...idle, engine: 'running' };
    const r = recorder(running, () => json(200, { ok: true, already: true, aiProfile: 'Default', warnings: [warn] }));
    const onWaking = vi.fn();
    expect(await ensureEngineAwake({ fetch: r.f, target, aiProfile: 'Cautious', onWaking })).toMatchObject({ ok: true, already: true, woke: false, profileSent: true, warnings: [warn] });
    expect(onWaking).not.toHaveBeenCalled();
    // No profile, or a helper that does not take one: only /health, as before.
    for (const [h, p] of [
      [running, null],
      [{ ...running, engine_start_profile: undefined }, 'Cautious'],
    ] as const) {
      const q = recorder(h);
      expect(await ensureEngineAwake({ fetch: q.f, target, aiProfile: p })).toMatchObject({ ok: true, woke: false, profileSent: false });
      expect(q.calls.map((c) => c.path)).toEqual(['/health']);
    }
  });

  it('a 400 brings its problems back', async () => {
    const r = recorder(idle, () => json(400, { ok: false, type: 'error', message: 'Bad request', problems: ['aiProfile: unknown profile "Hard"'] }));
    expect(await ensureEngineAwake({ fetch: r.f, target, aiProfile: 'Cautious' })).toMatchObject({ ok: false, status: 400, message: 'Bad request', problems: ['aiProfile: unknown profile "Hard"'] });
  });
});

describe('the search AI is the default opponent (mtg-table D414)', () => {
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const ALL = ['plain', 'outlets', 'search'];
  const idle = { ok: true, helper: 1, match: 1, engine: 'idle', engine_start: 1, engine_start_profile: 1, engine_start_policy: 1, aiPolicies: ALL };
  const started = { ok: true, already: false, yourDeck: { name: 'x', path: null, cards: 40 }, aiDeck: { name: 'y', cards: 40 }, aiProfile: 'Default', aiPolicy: 'search', games: 1, ms: 9000, warnings: [] };
  const recorder = (health: unknown, reply: () => ReturnType<typeof json> = () => json(200, started)) => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const f = vi.fn((u: string, i?: RequestInit) => {
      calls.push({ path: u.replace(target.baseUrl, ''), body: i?.body });
      return u.endsWith('/health') ? json(200, health) : reply();
    });
    return { f, calls };
  };

  it('pickers start on search when it is offered, else on plain Forge', () => {
    expect(defaultPolicy({ aiPolicies: ['plain', 'outlets', 'search'] })).toBe('search');
    expect(defaultPolicy({ aiPolicies: ['plain', 'outlets'] })).toBe('plain');
    expect(defaultPolicy({ aiPolicies: [] })).toBe('plain');
    expect(defaultPolicy(null)).toBe('plain');
    expect(effectivePolicy('search', { aiPolicies: ['plain'] })).toBe('plain');
    expect(policyFields(defaultPolicy({ aiPolicies: ['plain', 'search'] }), { aiPolicies: ['plain', 'search'] })).toEqual({ aiPolicy: 'search' });
  });

  it('reads engine_start_policy from /health, only beside engine_start and a policy list', async () => {
    expect((await engineHealth({ fetch: () => json(200, idle), target })).canPickPolicy).toBe(true);
    expect((await engineHealth({ fetch: () => json(200, { ...idle, engine_start_policy: undefined }), target })).canPickPolicy).toBeUndefined();
    expect((await engineHealth({ fetch: () => json(200, { ...idle, engine_start: undefined }), target })).canPickPolicy).toBeUndefined();
    expect((await engineHealth({ fetch: () => json(200, { ...idle, aiPolicies: undefined }), target })).canPickPolicy).toBeUndefined();
  });

  it('wakeEngine sends {"aiPolicy"} beside {"aiProfile"}', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => json(200, started));
    await wakeEngine({ fetch: f, target, aiPolicy: 'search' });
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ aiPolicy: 'search' });
    await wakeEngine({ fetch: f, target, aiPolicy: 'plain', aiProfile: 'Cautious' });
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body))).toEqual({ aiProfile: 'Cautious', aiPolicy: 'plain' });
    await wakeEngine({ fetch: f, target });
    expect(f.mock.calls[2]![1]!.body).toBeUndefined();
  });

  it('asleep: the picked AI goes to a helper that takes it, as plain when the helper does not offer it; never to an older helper', async () => {
    const a = recorder(idle);
    expect(await ensureEngineAwake({ fetch: a.f, target, aiPolicy: 'search' })).toMatchObject({ ok: true, woke: true, policySent: true });
    expect(JSON.parse(String(a.calls[1]!.body))).toEqual({ aiPolicy: 'search' });
    const noSearch = recorder({ ...idle, aiPolicies: ['plain', 'outlets'] });
    await ensureEngineAwake({ fetch: noSearch.f, target, aiPolicy: 'search' });
    expect(JSON.parse(String(noSearch.calls[1]!.body))).toEqual({ aiPolicy: 'plain' });
    const old = recorder({ ...idle, engine_start_policy: undefined });
    expect(await ensureEngineAwake({ fetch: old.f, target, aiPolicy: 'search' })).toMatchObject({ ok: true, woke: true, policySent: false });
    expect(old.calls[1]!.body).toBeUndefined();
  });

  it('running: the pick still goes out so the "not applied" warning reaches the player; nothing restarts', async () => {
    const warn = "the engine is already running against Forge's own AI; search was not applied — nothing is restarted while a match runs";
    const r = recorder({ ...idle, engine: 'running' }, () => json(200, { ok: true, already: true, aiPolicy: 'plain', warnings: [warn] }));
    const onWaking = vi.fn();
    expect(await ensureEngineAwake({ fetch: r.f, target, aiPolicy: 'search', onWaking })).toMatchObject({ ok: true, already: true, woke: false, policySent: true, warnings: [warn] });
    expect(onWaking).not.toHaveBeenCalled();
    const q = recorder({ ...idle, engine: 'running', engine_start_policy: undefined, engine_start_profile: undefined });
    expect(await ensureEngineAwake({ fetch: q.f, target, aiPolicy: 'search' })).toMatchObject({ ok: true, woke: false, policySent: false });
    expect(q.calls.map((c) => c.path)).toEqual(['/health']);
  });

  it('the search AI blurb names it the default', () => {
    expect(AI_POLICIES.find((p) => p.id === 'search')!.blurb).toMatch(/default \(search-v2\)/);
  });
});

describe('pick prompt', () => {
  /** The prompt without its cube-guide section (static advice that names fixed cube cards). */
  const withoutGuide = (text: string) => text.replace(/\n## Cube guide[^]*?(?=\n## (?!#)|$)/, '');
  const guideOf = (text: string) => (/\n## Cube guide[^]*?(?=\n## (?!#)|$)/.exec(text)?.[0] ?? '').trim();

  it('shows the choice and what the player knows, never the AI’s hidden Winston picks', () => {
    const cards = labCards(ctx);
    for (const seed of [9, 1, 2, 3, 4, 5]) {
      let d = newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed, youFirst: false, now: 1 });
      // Let the AI play its first turn.
      while (toAct(d) === 'ai') d = aiStep(d, cards, undefined, 1);
      const p = buildPickPrompt({ ctx, draft: d, infos: new Map(), question: 'Is this pile good?' });
      expect(p.user).toMatch(/Pile \d of 3/);
      expect(p.user).toMatch(/Is this pile good\?/);
      expect(guideOf(p.user)).toMatch(/^## Cube guide/);
      // The guide section is checked below: it can't depend on the AI's picks at all.
      const rest = withoutGuide(p.user);
      expect(rest).toContain('## Card text');
      const hidden = d.picks.ai.filter((n) => !d.seen.you.includes(n));
      for (const n of hidden) expect(rest, `seed ${seed}: ${n}`).not.toContain(n);
    }
  });

  it('names the format it is: a booster pick is never called a Winston draft', () => {
    for (const format of ['grid', 'winston', 'booster'] as const) {
      const d = newDraft({ cubeId: 'synergy', format, cube: names, seed: 3, youFirst: true, seats: 4, now: 1 });
      const head = buildPickPrompt({ ctx, draft: d, infos: new Map() }).user.split('\n')[0]!;
      expect(head).toMatch(new RegExp(`— ${format[0]!.toUpperCase()}${format.slice(1)} draft vs the AI$`));
    }
  });

  it('the guide section is the same whatever the AI picked, so it can’t carry hidden information', () => {
    const cards = labCards(ctx);
    let d = newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed: 9, youFirst: false, now: 1 });
    for (let i = 0; i < 40 && !d.done && d.picks.you.length < 6; i++) d = toAct(d) === 'ai' ? aiStep(d, cards, undefined, 1) : apply(d, { kind: 'take' }, 1);
    expect(d.picks.you.length).toBeGreaterThan(0);
    const section = guideOf(buildPickPrompt({ ctx, draft: d, infos: new Map() }).user);
    expect(section).toBe(guidePromptSection(guideFor('synergy'), poolColours(d.picks.you, ctx)));
    // Swap in entirely different AI picks (and what the player saw of them): same section, byte for byte.
    const others = names.filter((n) => !d.picks.you.includes(n) && !d.picks.ai.includes(n));
    for (const ai of [[], others.slice(0, 12), others.slice(-20)]) {
      const alt = { ...d, picks: { ...d.picks, ai }, seen: { ...d.seen, you: [...d.picks.you, ...ai.slice(0, 3)] } };
      expect(guideOf(buildPickPrompt({ ctx, draft: alt, infos: new Map() }).user)).toBe(section);
    }
  });
});

describe('the opponent AI (mtg-table D333)', () => {
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const health = { ok: true, helper: 1, match: 1, engine: 'running', engine_start: 1, aiPolicies: ['plain', 'outlets', 'search'], aiSearchMs: { min: 500, max: 5000, default: 1500 } };
  const deck = (name: string): MatchRequest['deck'] => ({ name, main: [[40, 'Island']] });
  const req: MatchRequest = { deck: deck('Mine'), aiDeck: deck('AI Drafter') };

  it('reads aiPolicies and aiSearchMs from /health', async () => {
    expect(await engineHealth({ fetch: () => json(200, health), target })).toEqual({
      status: 'ready',
      canWake: true,
      aiPolicies: ['plain', 'outlets', 'search'],
      aiSearchMs: { min: 500, max: 5000, default: 1500 },
    });
    // An older helper: no choice to offer.
    expect((await engineHealth({ fetch: () => json(200, { ...health, aiPolicies: undefined }), target })).aiPolicies).toEqual([]);
    // No launcher, or no helper: none either.
    expect((await engineHealth({ fetch: () => json(200, { ...health, match: 0 }), target })).aiPolicies).toEqual([]);
    expect((await engineHealth({ fetch: () => Promise.reject(new TypeError('down')), target })).aiPolicies).toEqual([]);
  });

  it('offers only the policies it knows, in its own order, and only with plain Forge among them', () => {
    expect(advertisedPolicies({ aiPolicies: ['search', 'plain', 'mcts', 7] })).toEqual(['plain', 'search']);
    expect(advertisedPolicies({ aiPolicies: ['outlets', 'search'] })).toEqual([]);
    expect(advertisedPolicies({ aiPolicies: 'plain,search' })).toEqual([]);
    expect(advertisedPolicies({})).toEqual([]);
    expect(AI_POLICIES.map((p) => p.id)).toEqual(['plain', 'outlets', 'search']);
    expect(AI_POLICIES.find((p) => p.id === 'search')?.blurb).toMatch(/1–3 s per decision/);
  });

  it('takes a search budget only when it is a sane range', () => {
    expect(advertisedSearchBudget({ aiSearchMs: { min: 500, max: 5000, default: 1500 } })).toEqual({ min: 500, max: 5000, default: 1500 });
    expect(advertisedSearchBudget({ aiSearchMs: { min: 500, max: 400, default: 450 } })).toBeUndefined();
    expect(advertisedSearchBudget({ aiSearchMs: { min: 0, max: 5000, default: 1500 } })).toBeUndefined();
    expect(advertisedSearchBudget({ aiSearchMs: { min: '500', max: 5000, default: 1500 } })).toBeUndefined();
    expect(advertisedSearchBudget({ aiSearchMs: null })).toBeUndefined();
  });

  it('sends aiPolicy only to a helper that advertised it', () => {
    expect(policyFields('search', { aiPolicies: [] })).toEqual({});
    expect(policyFields('search', { aiPolicies: ['plain', 'outlets', 'search'] })).toEqual({ aiPolicy: 'search' });
    expect(policyFields('search', { aiPolicies: ['plain', 'outlets'] })).toEqual({ aiPolicy: 'plain' });
    expect(policyFields('plain', { aiPolicies: ['plain', 'outlets', 'search'] })).toEqual({ aiPolicy: 'plain' });
  });

  it('checks the policy and the budget before anything goes out', () => {
    expect(checkRequest({ ...req, aiPolicy: 'search' })).toBeNull();
    expect(checkRequest({ ...req, aiPolicy: 'search', aiSearchMs: 3000 })).toBeNull();
    expect(checkRequest({ ...req, aiPolicy: 'hard' as never })).toMatch(/Unknown opponent AI/);
    expect(checkRequest({ ...req, aiPolicy: 'outlets', aiSearchMs: 1000 })).toMatch(/only with the search AI/);
    expect(checkRequest({ ...req, aiSearchMs: 1000 })).toMatch(/only with the search AI/);
    expect(checkRequest({ ...req, aiPolicy: 'search', aiSearchMs: 100 })).toMatch(/0\.5 to 5 seconds/);
    expect(checkRequest({ ...req, aiPolicy: 'search', aiSearchMs: 1500.5 })).toMatch(/0\.5 to 5 seconds/);
  });

  it('puts aiPolicy in the POST body and reads it back', async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) =>
      json(200, { ok: true, yourDeck: { name: 'Mine', path: 'p', cards: 40 }, aiDeck: { name: 'AI Drafter', cards: 40 }, aiProfile: 'Default', aiPolicy: 'search', games: 3, ms: 9000, warnings: [] }),
    );
    const r = await launchMatch({ ...req, aiPolicy: 'search' }, { fetch: f, target });
    expect(r).toMatchObject({ ok: true, aiPolicy: 'search' });
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toMatchObject({ aiPolicy: 'search' });
    // Without a policy the body has no key at all: an older helper never sees one.
    await launchMatch(req, { fetch: f, target });
    expect(JSON.parse(String(f.mock.calls[1]![1]?.body))).not.toHaveProperty('aiPolicy');
  });
});
