// SPDX-License-Identifier: GPL-3.0-or-later
// The live coach's advice across a page reload (adviceStore.ts, keepAdvice.ts):
// a recorded game is played through auto-coach's timing with a fake coach helper,
// the page "reloads" mid-cycle (every module's memory gone, the tab's storage
// kept), and the plan, Earlier advice and the asked cycles come back.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog, type GameLog } from '../../log.ts';
import type { GameStateBody } from '../../protocol.ts';
import { forgetHelper } from '../../coachHelper.ts';
import { clearAnswers, getAnswer, startAnswer } from '../answers.ts';
import { LiveLogBuilder } from '../../live.ts';
import { gameJoinKey } from '../../feedback.ts';
import {
  adviceFor,
  askLabel,
  currentPlan,
  earlierAdvice,
  gameKeyOf,
  markPlanAsked,
  planDue,
  planKey,
  planLabel,
  plansAsked,
  recordAdvice,
  resetAdvice,
} from './autoPlan.ts';
import { liveDecision } from './liveDecision.ts';
import { persistAdvice, restoreKeptAdvice } from './keepAdvice.ts';
import { ADVICE_STORE_KEY, MAX_ANSWER_CHARS, MAX_STORED_ENTRIES, MAX_STORED_GAMES, loadStoredAdvice, saveStoredAdvice, type StoredGame } from './adviceStore.ts';

vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));

const root = new URL('../../../', import.meta.url);
const LOG: GameLog = parseLog(gunzipSync(readFileSync(new URL('public/samples/human-auto-42.jsonl.gz', root))).toString('utf8'));

/** sessionStorage in memory. */
function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

/** A coach helper that answers each question with a plan naming its turn, after `ms`; `hold` keeps a turn's answer streaming. */
function fakeHelper(ms = 5, hold = new Set<number>()) {
  let asked = 0;
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, helper: 1, claude: 'fake', models: ['opus', 'sonnet', 'haiku'], concurrency: 1, queue: { max: 4, length: 0 }, running: 0, supersedes: 1, replaceRunning: 1, thinking: ['off', 'low', 'default'] }), { status: 200 });
    }
    asked++;
    const body = JSON.parse(String(init!.body)) as { user: string };
    const turn = Number(/plan my turn (\d+)/.exec(body.user)?.[1] ?? -1);
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const line = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        setTimeout(() => {
          line({ type: 'text', text: `Play: plan for turn ${turn}\n` });
          if (hold.has(turn)) return; // still writing when the page goes away
          line({ type: 'text', text: 'Why: it is the plan\n---\n**Rule:** plan ahead\n' });
          line({ type: 'done', stopReason: 'end_turn', model: 'sonnet' });
          ctrl.close();
        }, ms);
        init?.signal?.addEventListener('abort', () => {
          try {
            ctrl.close();
          } catch {
            /* closed */
          }
        });
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  return { fetchFn, asked: () => asked };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stateIndexes = (log: GameLog) => log.frames.map((f, i) => (f.type === 'state' ? i : -1)).filter((i) => i >= 0);

/** "A page": auto-coach over the log's states from `from` to `to` (frame indexes), as PlayCoach does. */
async function play(log: GameLog, storage: Storage, from: number, to: number, opts: { askAt?: number } = {}) {
  const seat = log.seat!;
  for (const i of stateIndexes(log).filter((x) => x >= from && x <= to)) {
    const sub: GameLog = { ...log, frames: log.frames.slice(0, i + 1) };
    const game = gameKeyOf(sub, seat)!;
    const state = log.frames[i]!.body as GameStateBody;
    const d = liveDecision({ log: sub, state, input: null, ask: null, seat })!;
    if (opts.askAt === i) {
      const k = `${game}:ask:${i}`;
      recordAdvice(game, { key: k, kind: 'ask', label: askLabel(d), forTurn: null, decision: d });
      await startAnswer(k, async () => ({ system: 's', user: 'my own question' }));
      persistAdvice(game, storage, sub);
    }
    const due = planDue(state, seat, plansAsked(game));
    if (due === null) continue;
    markPlanAsked(game, due);
    const k = planKey(game, due);
    recordAdvice(game, { key: k, kind: 'plan', label: planLabel(due), forTurn: due, decision: d });
    persistAdvice(game, storage, sub);
    const run = startAnswer(k, async () => ({ system: 's', user: `Decision type: plan my turn ${due}` }));
    await Promise.race([run, sleep(40)]);
    persistAdvice(game, storage, sub);
  }
}

/** A reload: every module's memory is gone; the tab's storage stays. */
function reload() {
  clearAnswers();
  resetAdvice();
  forgetHelper();
}

let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  reload();
  storage = memoryStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
});

describe('the live coach keeps its advice across a reload', () => {
  const seat = LOG.seat!;
  const idx = stateIndexes(LOG);
  // Mid-cycle: the first state of the player's turn 9, after turn 9's plan was asked at the opponent's end step.
  const mid = idx.find((i) => {
    const s = LOG.frames[i]!.body as GameStateBody;
    return s.turn === 9 && s.activePlayer === seat && s.phase === 'MAIN1';
  })!;
  const upTo = (i: number): GameLog => ({ ...LOG, frames: LOG.frames.slice(0, i + 1) });

  it('the game key is feedback.ts’s, with the seat', () => {
    const h = LOG.header!;
    expect(gameKeyOf(LOG, seat)).toBe(`${gameJoinKey({ gameId: h.gameId, seed: h.seed, startedAt: h.startedAt })}#${seat}`);
  });

  it('after a reload mid-cycle, the plan is back and auto-coach does not ask again', async () => {
    const h = fakeHelper();
    vi.stubGlobal('fetch', h.fetchFn);
    const askAt = idx.find((i) => i > mid - 400 && (LOG.frames[i]!.body as GameStateBody).turn === 8)!;
    await play(LOG, storage, 0, mid, { askAt });
    await sleep(20);
    const game = gameKeyOf(LOG, seat)!;
    const before = adviceFor(game);
    const planBefore = currentPlan(before)!;
    expect(planBefore.forTurn).toBe(9);
    const plansBefore = [...plansAsked(game)].sort((a, b) => a - b);
    const asked = h.asked();
    expect(getAnswer(planBefore.key)).toMatchObject({ status: 'done', text: expect.stringContaining('Play: plan for turn 9') });

    reload();
    expect(adviceFor(game)).toHaveLength(0);
    expect(restoreKeptAdvice(game, storage, upTo(mid), seat)).toBe(true);

    const after = adviceFor(game);
    // The plan on screen, with its answer as it ended.
    const plan = currentPlan(after)!;
    expect(plan).toMatchObject({ key: planBefore.key, label: 'Plan for your turn 9', forTurn: 9 });
    expect(plan.decision?.state.turn).toBe(planBefore.decision!.state.turn);
    expect(getAnswer(plan.key)).toMatchObject({ status: 'done', model: 'sonnet', source: 'helper' });
    expect(getAnswer(plan.key)!.text).toContain('Play: plan for turn 9');
    // Earlier advice: the same entries in the same order, the own question included.
    expect(after.map((e) => e.key)).toEqual(before.map((e) => e.key));
    expect(earlierAdvice(after, null).map((e) => e.label)).toEqual(earlierAdvice(before, null).map((e) => e.label));
    expect(after.some((e) => e.kind === 'ask')).toBe(true);
    // The cycles asked: this turn's plan is not asked again.
    expect([...plansAsked(game)].sort((a, b) => a - b)).toEqual(plansBefore);
    await play(LOG, storage, mid, mid);
    expect(h.asked()).toBe(asked);

    // The next cycle asks the next turn's plan, once.
    const next = idx.find((i) => {
      const s = LOG.frames[i]!.body as GameStateBody;
      return s.turn === 10 && s.activePlayer !== seat && (s.phase === 'END_OF_TURN' || s.phase === 'CLEANUP');
    })!;
    await play(LOG, storage, mid + 1, next);
    expect(h.asked()).toBe(asked + 1);
    expect(currentPlan(adviceFor(game))!.forTurn).toBe(11);
  });

  it('a plan still being written when the page went away is asked again, its text kept meanwhile', async () => {
    const h = fakeHelper(5, new Set([9]));
    vi.stubGlobal('fetch', h.fetchFn);
    await play(LOG, storage, 0, mid);
    await sleep(20);
    const game = gameKeyOf(LOG, seat)!;
    expect(getAnswer(planKey(game, 9))).toMatchObject({ status: 'streaming' });
    persistAdvice(game, storage, upTo(mid)); // pagehide
    const asked = h.asked();

    reload();
    restoreKeptAdvice(game, storage, upTo(mid), seat);
    expect(getAnswer(planKey(game, 9))).toMatchObject({ status: 'stopped', stopReasonNote: 'reload', text: 'Play: plan for turn 9\n' });
    expect(plansAsked(game).has(9)).toBe(false);
    expect(plansAsked(game).has(7)).toBe(true);
    vi.stubGlobal('fetch', fakeHelper().fetchFn);
    await play(LOG, storage, mid, mid);
    await sleep(20);
    expect(getAnswer(planKey(game, 9))).toMatchObject({ status: 'done' });
    expect(asked).toBeGreaterThan(0);
  });

  it('a page that already has advice for the game keeps its own', async () => {
    vi.stubGlobal('fetch', fakeHelper().fetchFn);
    await play(LOG, storage, 0, mid);
    const game = gameKeyOf(LOG, seat)!;
    const mine = adviceFor(game);
    expect(restoreKeptAdvice(game, storage, upTo(mid), seat)).toBe(false);
    expect(adviceFor(game)).toBe(mine);
  });

  it('a log without the asked frame still shows the kept text (no moment to re-plan from)', async () => {
    vi.stubGlobal('fetch', fakeHelper().fetchFn);
    await play(LOG, storage, 0, mid);
    await sleep(20);
    const game = gameKeyOf(LOG, seat)!;
    reload();
    // The catch-up only: a log of the last few frames.
    const short: GameLog = { ...LOG, frames: LOG.frames.slice(mid - 3, mid + 1) };
    expect(restoreKeptAdvice(game, storage, short, seat)).toBe(true);
    const plan = currentPlan(adviceFor(game))!;
    expect(plan.decision).toBeNull();
    expect(getAnswer(plan.key)!.text).toContain('Play: plan for turn 9');
  });
});

describe('adviceStore: small, newest games, never throws', () => {
  const game = (n: number, at: number): StoredGame => ({
    game: `g${n}`,
    at,
    plans: [3, 1, 3],
    entries: Array.from({ length: 20 }, (_, i) => ({
      key: `g${n}:${i}`,
      kind: 'plan' as const,
      label: `Plan ${i}`,
      forTurn: i,
      frameIndex: i,
      turn: i,
      seq: i,
      answer: { status: 'done' as const, text: 'x'.repeat(MAX_ANSWER_CHARS + 50), model: null, source: 'helper' as const, refused: false, stopReasonNote: null, error: null },
    })),
  });

  it('keeps the newest games, entries and characters only', () => {
    const s = memoryStorage();
    for (let n = 0; n < MAX_STORED_GAMES + 2; n++) expect(saveStoredAdvice(s, game(n, 1000 + n))).toBe(true);
    expect(loadStoredAdvice(s, 'g0')).toBeNull();
    const last = loadStoredAdvice(s, `g${MAX_STORED_GAMES + 1}`)!;
    expect(last.entries).toHaveLength(MAX_STORED_ENTRIES);
    expect(last.entries[0]!.answer!.text).toHaveLength(MAX_ANSWER_CHARS);
    expect(last.plans).toEqual([1, 3]);
    expect(s.getItem(ADVICE_STORE_KEY)!.length).toBeLessThan(MAX_STORED_GAMES * MAX_STORED_ENTRIES * (MAX_ANSWER_CHARS + 400));
  });

  it('a corrupt record, a missing storage or a storage that throws is no advice', () => {
    const s = memoryStorage();
    s.setItem(ADVICE_STORE_KEY, '{not json');
    expect(loadStoredAdvice(s, 'g1')).toBeNull();
    s.setItem(ADVICE_STORE_KEY, JSON.stringify({ v: 1, games: [{ game: 'g1', at: 1, plans: ['x', 2], entries: [{ key: 1 }, { key: 'k', kind: 'plan', label: 'L', frameIndex: 3, seq: 1, answer: { status: 'streaming', text: 'a' } }] }] }));
    expect(loadStoredAdvice(s, 'g1')).toEqual({ game: 'g1', at: 1, plans: [2], entries: [{ key: 'k', kind: 'plan', label: 'L', forTurn: null, frameIndex: 3, turn: null, seq: 1, answer: null }] });
    expect(loadStoredAdvice(null, 'g1')).toBeNull();
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadStoredAdvice(bad, 'g1')).toBeNull();
    expect(saveStoredAdvice(bad, game(1, 1))).toBe(false);
  });
});

describe('a client-made log keeps its game key across a reload', () => {
  it('startedAt is the hello_ok frame’s own time, so the same frame gives the same header', () => {
    const hello = { v: 1, seq: 1, t: 1791363192015, type: 'hello_ok', body: { gameId: 'match-1', you: 0, seed: 5, forgeVersion: 'x', forgeJarSha256: 'y', unsupportedCards: [], players: [] } };
    const a = new LiveLogBuilder();
    a.add(hello as never, true);
    const b = new LiveLogBuilder();
    b.add(JSON.parse(JSON.stringify(hello)), true);
    expect(a.header!.startedAt).toBe(new Date(1791363192015).toISOString());
    expect(b.header!.startedAt).toBe(a.header!.startedAt);
  });
});

describe('coach use per game: the answers shown count once (mtg-table D414)', () => {
  it('counts a finished plan and a finished question of a noted game, by kind; not an error, not twice', async () => {
    const { noteGamePlayed, loadCoachUse } = await import('../../coachUse.ts');
    const { restoreAnswer } = await import('../answers.ts');
    const { countShownAnswer } = await import('./keepAdvice.ts');
    const game = gameKeyOf(LOG, LOG.seat)!;
    const local = memoryStorage();
    const base = { model: 'claude-sonnet-4-5', source: 'helper' as const, refused: false, stopReasonNote: null, error: null };
    const plan = planKey(game, 3);
    recordAdvice(game, { key: plan, kind: 'plan', label: planLabel(3), forTurn: 3, decision: null });
    recordAdvice(game, { key: `${game}:ask:1`, kind: 'ask', label: 'Your main phase', forTurn: null, decision: null });
    recordAdvice(game, { key: `${game}:ask:2`, kind: 'ask', label: 'Your attacks', forTurn: null, decision: null });
    restoreAnswer(plan, { ...base, status: 'done', text: 'Play: Forest' });
    restoreAnswer(`${game}:ask:1`, { ...base, status: 'stopped', text: 'Attack: all' });
    restoreAnswer(`${game}:ask:2`, { ...base, status: 'error', text: '', error: 'auth' });
    // Not noted yet (as a friend's table never is): nothing is recorded.
    expect(countShownAnswer(plan, local)).toBe(false);
    noteGamePlayed(local, game);
    expect(countShownAnswer(plan, local)).toBe(true);
    expect(countShownAnswer(plan, local)).toBe(false);
    expect(countShownAnswer(`${game}:ask:1`, local)).toBe(true);
    expect(countShownAnswer(`${game}:ask:2`, local)).toBe(false);
    expect(loadCoachUse(local)[0]).toMatchObject({ key: gameJoinKey({ gameId: LOG.header.gameId, seed: LOG.header.seed ?? null, startedAt: LOG.header.startedAt ?? null }), plans: 1, asks: 1, models: ['claude-sonnet-4-5'], sources: ['helper'] });
  });
});
