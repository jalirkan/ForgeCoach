/*
 * ForgeCoach — play/coachChoice.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Coach panel's selector (Search AI / Claude / Off) and the search hint's
 * runner: the search AI answers by itself once per decision, a new decision
 * supersedes the question still out, and Claude never asks by itself
 * without its own Auto-coach switch.
 */
import { describe, expect, it } from 'vitest';
import { coachPlan, COACH_KIND_KEY, parseCoachKind, readCoachKind } from './coachChoice.ts';
import { HintRunner, type HintAsk } from './hintRunner.ts';
import type { HintRefused, SearchHint } from '../searchHint.ts';

const HINT: SearchHint = { status: 'ok', type: 'spell', pick: 'pass', strength: 'close', runnerUp: 'cast:5', landFirst: null, options: [], knowledge: 'basic-lands', measure: 'leaf', stateSeq: 9, message: null, ms: 2400, budgetMs: 3000 };

/** A fake POST /hint: each call waits until the test answers it. */
function fake() {
  const calls: { key: string; signal: AbortSignal; answer: (r: SearchHint | HintRefused) => void }[] = [];
  const ask: HintAsk = (key, signal) => new Promise((answer) => calls.push({ key, signal, answer }));
  return { ask, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the selector', () => {
  it('defaults to the search AI, and reads back what the viewer chose', () => {
    expect(readCoachKind(() => null)).toBe('search');
    expect(readCoachKind((k) => (k === COACH_KIND_KEY ? 'claude' : null))).toBe('claude');
    expect(readCoachKind(() => 'off')).toBe('off');
    expect(parseCoachKind('nonsense')).toBe('search');
    expect(readCoachKind(() => {
      throw new Error('storage blocked');
    })).toBe('search');
  });
  it('Search AI asks by itself (when the engine offers hints); Claude only with its own switch; Off asks nothing', () => {
    expect(coachPlan('search', false, true)).toEqual({ searchAuto: true, claudeShown: false, claudeAuto: false, searchKey: true });
    expect(coachPlan('search', true, false).searchAuto).toBe(false);
    expect(coachPlan('claude', false, true)).toEqual({ searchAuto: false, claudeShown: true, claudeAuto: false, searchKey: true });
    expect(coachPlan('claude', true, true).claudeAuto).toBe(true);
    // Claude's switch left on from before never makes it ask while another coach is chosen.
    expect(coachPlan('search', true, true).claudeAuto).toBe(false);
    expect(coachPlan('off', true, true)).toEqual({ searchAuto: false, claudeShown: false, claudeAuto: false, searchKey: false });
  });
});

describe('the search hint runner', () => {
  it('none → idle → asking → answered', async () => {
    const f = fake();
    const r = new HintRunner(f.ask, () => 100);
    expect(r.get().state).toBe('none');
    r.setDecision('d1', false);
    expect(r.get()).toEqual({ state: 'idle', key: 'd1' });
    r.ask();
    expect(r.get()).toEqual({ state: 'asking', key: 'd1', since: 100 });
    f.calls[0]!.answer(HINT);
    await tick();
    expect(r.get()).toEqual({ state: 'answered', key: 'd1', hint: HINT });
  });

  it('auto asks once per decision and never again on a re-render', async () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    for (let i = 0; i < 5; i++) r.setDecision('d1', true);
    expect(f.calls.map((c) => c.key)).toEqual(['d1']);
    f.calls[0]!.answer(HINT);
    await tick();
    for (let i = 0; i < 5; i++) r.setDecision('d1', true);
    expect(r.asked).toBe(1);
    expect(r.get().state).toBe('answered');
  });

  it('a new decision supersedes the question still out: it is cancelled and its late answer dropped', async () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', true);
    r.setDecision('d2', true);
    expect(f.calls[0]!.signal.aborted).toBe(true);
    expect(f.calls.map((c) => c.key)).toEqual(['d1', 'd2']);
    f.calls[0]!.answer(HINT);
    await tick();
    expect(r.get()).toMatchObject({ state: 'asking', key: 'd2' });
    f.calls[1]!.answer({ ...HINT, pick: 'cast:5' });
    await tick();
    expect(r.get()).toMatchObject({ state: 'answered', key: 'd2', hint: { pick: 'cast:5' } });
  });

  it('a decision it cannot judge is none, and stops what was out', () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', true);
    r.setDecision(null, true);
    expect(r.get()).toEqual({ state: 'none', key: null });
    expect(f.calls[0]!.signal.aborted).toBe(true);
    r.ask();
    expect(r.asked).toBe(1);
  });

  it('an error says why; Ask now tries again; auto does not retry by itself', async () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', true);
    f.calls[0]!.answer({ ok: false, status: 429, code: null, message: 'The engine is busy with another hint — try again in a few seconds.' });
    await tick();
    expect(r.get()).toMatchObject({ state: 'error', message: expect.stringContaining('busy') });
    r.setDecision('d1', true);
    expect(r.asked).toBe(1);
    r.ask();
    expect(r.get().state).toBe('asking');
    expect(r.asked).toBe(2);
  });

  it('only one question at a time: Ask now while one is out does nothing', () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', false);
    r.ask();
    r.ask();
    expect(f.calls).toHaveLength(1);
  });

  it('a supersede from elsewhere (409) goes quietly back to idle, and auto does not loop on it', async () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', true);
    f.calls[0]!.answer({ ok: false, status: 409, code: 'superseded', message: '' });
    await tick();
    expect(r.get()).toEqual({ state: 'idle', key: 'd1' });
    r.setDecision('d1', true);
    expect(r.asked).toBe(1);
  });

  it('without auto, nothing is asked until Ask now', () => {
    const f = fake();
    const r = new HintRunner(f.ask);
    r.setDecision('d1', false);
    r.setDecision('d2', false);
    expect(f.calls).toHaveLength(0);
  });
});
