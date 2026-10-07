// SPDX-License-Identifier: GPL-3.0-or-later
// The live coach against a fake coach helper with the real helper's queue rules
// (mtg-table D325 + D410): one question runs, the rest wait first in first out,
// a key supersedes a queued question and, with replaceRunning, the running one;
// a client that aborts leaves the queue or has its run killed. A long recorded
// game is replayed through startAnswer to show what reaches the helper.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog } from '../log.ts';
import type { GameStateBody } from '../protocol.ts';
import { forgetHelper } from '../coachHelper.ts';
import { clearAnswers, getAnswer, onAnswerTiming, slotKey, startAnswer, stopAnswer, type AnswerTiming } from './answers.ts';
import { planDue } from './play/autoPlan.ts';

vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));

interface Q {
  key: string | null;
  user: string;
  queuedAt: number;
  startedAt: number | null;
  end: 'done' | 'superseded' | 'aborted-queued' | 'killed' | null;
}

/** A coach helper in memory: `serviceMs` per question, one at a time. */
function fakeHelper(serviceMs: (user: string) => number) {
  const all: Q[] = [];
  const waiting: Array<{ q: Q; go: () => void; supersede: () => void }> = [];
  let running: { q: Q; replace: () => void } | null = null;
  let maxWaiting = 0;
  const pump = () => {
    if (running || !waiting.length) return;
    waiting.shift()!.go();
  };
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, helper: 1, claude: 'fake', models: ['opus'], concurrency: 1, queue: { max: 4, length: waiting.length }, running: running ? 1 : 0, supersedes: 1, replaceRunning: 1, thinking: ['off', 'low', 'default'] }), { status: 200 });
    }
    const body = JSON.parse(String(init!.body)) as { user: string; supersedes?: string; replaceRunning?: boolean };
    const signal = init!.signal!;
    const key = body.supersedes ?? null;
    const q: Q = { key, user: body.user, queuedAt: Date.now(), startedAt: null, end: null };
    all.push(q);
    if (key) for (const w of waiting.filter((x) => x.q.key === key)) w.supersede();
    if (key && body.replaceRunning && running?.q.key === key) running.replace();
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const line = (o: unknown) => {
          try {
            ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
          } catch {
            /* closed */
          }
        };
        const close = () => {
          try {
            ctrl.close();
          } catch {
            /* closed */
          }
        };
        const run = () => {
          q.startedAt = Date.now();
          let timer: ReturnType<typeof setTimeout> | null = null;
          let half: ReturnType<typeof setTimeout> | null = null;
          const finish = (end: Q['end'], last?: unknown) => {
            if (q.end) return;
            q.end = end;
            if (timer) clearTimeout(timer);
            if (half) clearTimeout(half);
            if (last) line(last);
            close();
            if (running?.q === q) running = null;
            pump();
          };
          running = { q, replace: () => finish('superseded', { type: 'error', code: 'superseded', message: 'superseded by a newer question' }) };
          signal.addEventListener('abort', () => finish('killed'));
          const ms = serviceMs(body.user);
          half = setTimeout(() => line({ type: 'text', text: 'Play: Land — Mountain\n' }), ms / 2);
          timer = setTimeout(() => {
            line({ type: 'text', text: 'Why: curve out\n' });
            finish('done', { type: 'done', stopReason: 'end_turn', model: 'opus' });
          }, ms);
        };
        if (!running && !waiting.length) {
          run();
          return;
        }
        const w = {
          q,
          go: () => {
            line({ type: 'running' });
            run();
          },
          supersede: () => {
            waiting.splice(waiting.indexOf(w), 1);
            q.end = 'superseded';
            line({ type: 'error', code: 'superseded', message: 'superseded by a newer question' });
            close();
          },
        };
        waiting.push(w);
        maxWaiting = Math.max(maxWaiting, waiting.length);
        line({ type: 'queued', position: waiting.length });
        signal.addEventListener('abort', () => {
          const i = waiting.indexOf(w);
          if (i >= 0) {
            waiting.splice(i, 1);
            q.end = 'aborted-queued';
            close();
          }
        });
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  return { fetchFn, all, maxWaiting: () => maxWaiting, pending: () => waiting.length + (running ? 1 : 0) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prompt = (user: string) => async () => ({ system: 's', user });

let timings: AnswerTiming[] = [];
let off: () => void = () => {};
beforeEach(() => {
  clearAnswers();
  forgetHelper();
  timings = [];
  off = onAnswerTiming((t) => timings.push(t));
});
afterEach(() => {
  off();
  vi.unstubAllGlobals();
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
});

describe('one question per slot (the live coach: one per seat)', () => {
  it('a new question in a slot stops the earlier one, and the helper kills its run', async () => {
    const h = fakeHelper(() => 80);
    vi.stubGlobal('fetch', h.fetchFn);
    const a = startAnswer('plan:t4', prompt('plan 4'), { slot: 'plan:seat0', supersedes: 'tab:plan', replaceRunning: true });
    await sleep(20);
    expect(slotKey('plan:seat0')).toBe('plan:t4');
    const b = startAnswer('plan:t6', prompt('plan 6'), { slot: 'plan:seat0', supersedes: 'tab:plan', replaceRunning: true });
    await Promise.all([a, b]);
    expect(getAnswer('plan:t4')).toMatchObject({ status: 'stopped', stopReasonNote: 'superseded' });
    expect(getAnswer('plan:t6')).toMatchObject({ status: 'done' });
    expect(h.all.map((q) => q.end)).toEqual(['killed', 'done']);
    expect(h.maxWaiting()).toBeLessThanOrEqual(1);
    expect(slotKey('plan:seat0')).toBeNull();
  });

  it('an answer stopped mid-stream keeps the text it had, and its run is killed', async () => {
    const h = fakeHelper(() => 120);
    vi.stubGlobal('fetch', h.fetchFn);
    const p = startAnswer('ask:k', prompt('ask'), { slot: 'ask:seat0' });
    await sleep(90);
    stopAnswer('ask:k', 'moved_on');
    await p;
    expect(getAnswer('ask:k')).toMatchObject({ status: 'stopped', stopReasonNote: 'moved_on', text: 'Play: Land — Mountain\n' });
    expect(h.all[0]!.end).toBe('killed');
    expect(timings[0]).toMatchObject({ outcome: 'stopped' });
  });

  it('records the timing of each question: prompt bytes, queue wait, first text, total', async () => {
    const h = fakeHelper(() => 25);
    vi.stubGlobal('fetch', h.fetchFn);
    await startAnswer('t1', async () => ({ system: 'sys', user: 'é' }));
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ key: 't1', source: 'helper', promptBytes: 5, queueMs: 0, outcome: 'done' });
    expect(timings[0]!.firstTextMs).not.toBeNull();
    expect(timings[0]!.totalMs).toBeGreaterThanOrEqual(timings[0]!.firstTextMs!);
    expect(getAnswer('t1')?.timing).toMatchObject({ outcome: 'done' });
  });
});

describe('a long game replayed through startAnswer (human-auto-42, 22 turns)', () => {
  const log = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
  const seat = log.seat!;
  const states = log.frames.filter((f) => f.type === 'state').map((f) => f.body as GameStateBody);

  it('auto-coach asks one plan per turn cycle; the helper never holds more than one of this seat\'s questions', async () => {
    // Answers take longer as the board grows (measured: Opus, first word 3 s at turn 1, ~40 s at turn 17); here in ms.
    const h = fakeHelper((user) => 10 + 2 * Number(/t(\d+)/.exec(user)?.[1] ?? 0));
    vi.stubGlobal('fetch', h.fetchFn);
    const asked = new Set<number>();
    const runs: Promise<void>[] = [];
    let maxPending = 0;
    for (const s of states) {
      const due = planDue(s, seat, asked);
      if (due !== null) {
        asked.add(due);
        runs.push(startAnswer(`plan:t${due}`, prompt(`plan t${due}`), { slot: 'plan:seat', supersedes: 'tab:plan', replaceRunning: true }));
      }
      maxPending = Math.max(maxPending, h.pending());
      await sleep(1); // the game moves on
    }
    await Promise.all(runs);
    const myTurns = new Set(states.filter((s) => s.phase && s.turn && s.activePlayer === seat).map((s) => s.turn));
    expect([...asked].sort((a, b) => a - b)).toEqual([...myTurns].sort((a, b) => a - b));
    expect(h.all).toHaveLength(myTurns.size);
    expect(maxPending).toBeLessThanOrEqual(1);
    expect(h.maxWaiting()).toBe(0);
  });

  it('before: a question at every main phase and combat, the stale ones never stopped: fresh questions wait behind stale runs', async () => {
    // The old auto-coach's moments, asked with no slot and no stop (the folded panel never ran its stop).
    const h = fakeHelper((user) => 10 + 2 * Number(/t(\d+)/.exec(user)?.[1] ?? 0));
    vi.stubGlobal('fetch', h.fetchFn);
    const runs: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const s of states) {
      if (!s.phase || !s.turn) continue;
      const mine = s.activePlayer === seat;
      const k = `${s.turn}:${s.phase}`;
      const moment = (mine && (s.phase === 'MAIN1' || s.phase === 'MAIN2' || s.phase === 'COMBAT_DECLARE_ATTACKERS')) || (!mine && s.phase === 'COMBAT_DECLARE_BLOCKERS');
      if (moment && !seen.has(k)) {
        seen.add(k);
        runs.push(startAnswer(`old:${k}`, prompt(`old t${s.turn}`), { supersedes: 'tab' }));
      }
      await sleep(1);
    }
    await Promise.all(runs);
    const waits = h.all.map((q) => (q.startedAt ?? q.queuedAt) - q.queuedAt);
    console.log(`old pattern: ${h.all.length} questions, ${h.all.filter((q) => q.end === 'superseded').length} superseded while queued, ${h.all.filter((q) => q.end === 'done').length} ran to the end, waits (ms): ${waits.join(' ')}`);
    // The key kept the queue to one waiting question, but nothing ended the stale RUNNING one:
    // every question that was not superseded ran to the end, and fresh ones waited behind stale ones.
    expect(h.maxWaiting()).toBe(1);
    expect(h.all.some((q) => q.end === 'killed')).toBe(false);
    expect(Math.max(...waits)).toBeGreaterThan(0);
  });
});
