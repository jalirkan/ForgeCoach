/*
 * ForgeCoach — ui/answers.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-memory store of coach answers, keyed per decision (and one for the
 * review). Streams keep running when the user scrubs away; the panel shows
 * whatever the store has for the selected key.
 */
import { useSyncExternalStore } from 'react';
import { askClaude, liveModelOf, liveThinkingOf, loadSettings, type AskPrompt, type CoachResult, type Settings, type StreamHandlers } from '../claude.ts';
import { askHelper, chooseSource, detectHelper, helperFresh, helperThinking, pageHelperTarget, peekHelper, type ActiveSource, type SourceNeed } from '../coachHelper.ts';

/** 'queued': the coach helper has it in line behind another question (D325). */
export type AnswerStatus = 'preparing' | 'queued' | 'streaming' | 'done' | 'stopped' | 'error';

export interface Answer {
  status: AnswerStatus;
  text: string;
  thinking: string;
  refused: boolean;
  model: string | null;
  stopReason: string | null;
  error: string | null;
  /** CoachError kind ('no_key', 'auth', …) when the error came from claude.ts. */
  errorKind: string | null;
  /** Set when a server-side fallback answered instead of the chosen model. */
  fallbackFrom: string | null;
  /** Who is answering: Claude Code on the player's PC (the coach helper) or the API key. */
  source: ActiveSource | null;
  /** While queued: how many questions are ahead of this one. */
  queuePosition: number | null;
  /** Why it stopped, when it was not the player's Stop ('superseded', 'moved_on'). */
  stopReasonNote?: string | null;
  /**
   * Claude Code on the PC is working on it and no text has come yet: the time
   * (ms) its turn began — when the request went out, or at the helper's
   * `running` line after a wait in its queue. Null once the first word arrives,
   * while queued, and for the API key (which streams its own thinking).
   */
  thinkingSince: number | null;
  /** How long it took (set when it ends): see `AnswerTiming`. */
  timing?: AnswerTiming | null;
}

/**
 * One question's numbers, measured in the browser: the prompt's size (system +
 * user, UTF-8 bytes), the wait in the coach helper's queue (from the request to
 * its `running` line; 0 when it never waited), the first word and the whole
 * answer, in ms from the request. Logged once per question (`onAnswerTiming`).
 */
export interface AnswerTiming {
  key: string;
  source: ActiveSource;
  promptBytes: number;
  queueMs: number;
  firstTextMs: number | null;
  totalMs: number;
  outcome: 'done' | 'stopped' | 'error';
}

type TimingListener = (t: AnswerTiming) => void;
const timingListeners = new Set<TimingListener>();
/** Called with each question's timing when it ends. With no listener, the browser console gets one line. */
export function onAnswerTiming(l: TimingListener): () => void {
  timingListeners.add(l);
  return () => timingListeners.delete(l);
}
function reportTiming(t: AnswerTiming) {
  if (timingListeners.size) {
    for (const l of timingListeners) l(t);
    return;
  }
  if (typeof window === 'undefined') return;
  const s = (ms: number | null) => (ms === null ? 'none' : `${(ms / 1000).toFixed(1)} s`);
  console.info(`[coach] ${t.outcome} via ${t.source}: ${(t.promptBytes / 1024).toFixed(1)} KB prompt; queued ${s(t.queueMs)}; first text ${s(t.firstTextMs)}; total ${s(t.totalMs)}`);
}

/**
 * Slots (the live coach's "one question per seat"): the key of the question
 * now in each slot. Starting a question in a slot stops the one before it.
 */
const slots = new Map<string, string>();

/** The key of the question still preparing, queued or streaming in `slot`, or null. */
export function slotKey(slot: string): string | null {
  const k = slots.get(slot);
  return k !== undefined && controllers.has(k) ? k : null;
}

const answers = new Map<string, Answer>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let scheduled = false;

function notify() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

type SettledListener = (key: string, a: Answer) => void;
const settledListeners = new Set<SettledListener>();
/**
 * Called each time an answer ends — done, stopped or failed — with its key and
 * final state (the live coach keeps its advice across a reload: adviceStore.ts).
 */
export function onAnswerSettled(l: SettledListener): () => void {
  settledListeners.add(l);
  return () => settledListeners.delete(l);
}

const ENDED: ReadonlySet<AnswerStatus> = new Set(['done', 'stopped', 'error']);

function set(key: string, patch: Partial<Answer>) {
  const before = answers.get(key)?.status;
  const prev = answers.get(key) ?? {
    status: 'preparing' as const,
    text: '',
    thinking: '',
    refused: false,
    model: null,
    stopReason: null,
    error: null,
    errorKind: null,
    fallbackFrom: null,
    source: null,
    queuePosition: null,
    thinkingSince: null,
  };
  const next = { ...prev, ...patch };
  answers.set(key, next);
  notify();
  if (ENDED.has(next.status) && (before !== next.status || patch.text !== undefined)) for (const l of settledListeners) l(key, next);
}

/**
 * Puts back an answer kept across a page reload (the live coach's advice,
 * adviceStore.ts): shown as it ended. Ignored when this page already has an
 * answer for the key, or one is running.
 */
export function restoreAnswer(key: string, a: Pick<Answer, 'status' | 'text' | 'model' | 'source' | 'refused' | 'stopReasonNote' | 'error'>): void {
  if (answers.has(key) || controllers.has(key)) return;
  answers.set(key, {
    status: a.status,
    text: a.text,
    thinking: '',
    refused: a.refused,
    model: a.model,
    stopReason: null,
    error: a.error,
    errorKind: null,
    fallbackFrom: null,
    source: a.source,
    queuePosition: null,
    stopReasonNote: a.stopReasonNote,
    thinkingSince: null,
  });
  snapVersion++;
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Current answer for a key (non-reactive; for tests and handlers). */
export function getAnswer(key: string): Answer | undefined {
  return answers.get(key);
}

export function useAnswer(key: string | null): Answer | undefined {
  return useSyncExternalStore(subscribe, () => (key ? answers.get(key) : undefined));
}

/** True when any answer exists for the key (for timeline dots). */
export function useAnsweredKeys(): Map<string, Answer> {
  return useSyncExternalStore(subscribe, () => answersSnapshot());
}
let snap: Map<string, Answer> = new Map();
let snapSize = -1;
let snapVersion = 0;
let lastVersion = -1;
function answersSnapshot() {
  if (snapSize !== answers.size || lastVersion !== snapVersion) {
    snap = new Map(answers);
    snapSize = answers.size;
    lastVersion = snapVersion;
  }
  return snap;
}

export function clearAnswers(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  answers.clear();
  slots.clear();
  snapVersion++;
  notify();
}

export interface StartOptions {
  /**
   * A key shared by the questions that replace each other (the live coach of
   * one tab): sent to a coach helper that supports it, so a stale question still
   * waiting in its queue is dropped there too (D325).
   */
  supersedes?: string;
  /** The clock for `thinkingSince` (tests). */
  now?: () => number;
  /**
   * 'vision': the prompt carries photos (photo to pool, D362): 'auto' then
   * takes the coach helper only when its /health says it reads them.
   */
  need?: SourceNeed;
  /**
   * At most one question at a time in this slot (the live coach: one per seat for
   * auto-coach's plan, one for the player's own asks): starting this one stops the
   * slot's earlier question, which keeps the text it had ('superseded').
   */
  slot?: string;
  /**
   * With `supersedes`: also end the helper's RUNNING question with that key
   * (mtg-table D410), when the helper offers it — so a lost disconnect can never
   * leave a stale question running ahead of this one.
   */
  replaceRunning?: boolean;
  /**
   * At most this much thinking for Claude Code on the PC, whatever Settings says
   * above it (the live coach's short style: 'low' — measured, Opus's first word
   * came about twice as fast late in a game). Settings' own lower value wins.
   */
  thinkingCap?: 'low' | 'off';
  /**
   * Live play's answers (the play screen's plan and "Ask about this"):
   * Settings → Live coach model (claude.ts `liveModelOf`: the measured fast default
   * unless the player chose one) and, for the short style, live thinking
   * (`liveThinkingOf`: Off, the lowest, unless Coach thinking is set to Low or Off).
   * 'detailed' (Settings → Coach style: Detailed): the live model, with Coach
   * thinking as set. Other screens keep Settings → Model and Coach thinking.
   */
  live?: 'short' | 'detailed';
}

const THINKING_ORDER = { off: 0, low: 1, default: 2 } as const;

export async function startAnswer(key: string, makePrompt: () => Promise<AskPrompt>, opts: StartOptions = {}): Promise<void> {
  const now = opts.now ?? Date.now;
  if (opts.slot) {
    const prev = slots.get(opts.slot);
    if (prev !== undefined && prev !== key && controllers.has(prev)) stopAnswer(prev, 'superseded');
    slots.set(opts.slot, key);
  }
  controllers.get(key)?.abort();
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  answers.delete(key);
  snapVersion++;
  // Everything this run writes goes through `own`: once a newer startAnswer for the
  // same key has taken over (or clearAnswers dropped it), a late reply of this one
  // -- its cancellation, a queue line, a final answer -- must not land on the new one.
  const mine = () => controllers.get(key) === ctrl;
  const own = (patch: Partial<Answer>) => {
    if (mine()) set(key, patch);
  };
  const settings = safeSettings();
  // Auto: is Claude Code on the PC reachable? (Cached; at most ~800 ms when it isn't known.)
  let helper = peekHelper();
  if (settings.coachSource === 'auto' && !helperFresh()) {
    own({ status: 'preparing' });
    helper = await detectHelper();
    if (ctrl.signal.aborted || controllers.get(key) !== ctrl) return;
  }
  const source = chooseSource(settings, helper, opts.need);
  if (!source) {
    // Nothing to answer with: say so now, before building the prompt or fetching any card text.
    own({ status: 'error', error: noCoachMessage(settings, opts.need), errorKind: 'no_key' });
    controllers.delete(key);
    return;
  }
  // D346: a thinking cap goes only to a helper that lists it, so learn what it lists first.
  const setThinking = opts.live === 'short' ? liveThinkingOf(settings) : (settings.coachThinking ?? 'default');
  const model = opts.live ? liveModelOf(settings) : settings.model;
  const wantThinking = opts.thinkingCap && THINKING_ORDER[opts.thinkingCap] < THINKING_ORDER[setThinking] ? opts.thinkingCap : setThinking;
  if (source === 'helper' && wantThinking !== 'default' && !(helper?.state === 'ok' && helperFresh())) {
    own({ status: 'preparing', source });
    helper = await detectHelper();
    if (ctrl.signal.aborted || controllers.get(key) !== ctrl) return;
  }
  const thinking = source === 'helper' ? helperThinking(helper, wantThinking) : undefined;
  own({ status: 'preparing', source });
  let t0: number | null = null;
  let tRunning = 0;
  let tFirst: number | null = null;
  let promptBytes = 0;
  // Once per question, when it ends after its request went out (a question stopped while its prompt was built has none).
  const timed = (outcome: AnswerTiming['outcome']) => {
    if (t0 === null) return;
    const timing: AnswerTiming = { key, source, promptBytes, queueMs: tRunning - t0, firstTextMs: tFirst === null ? null : tFirst - t0, totalMs: now() - t0, outcome };
    t0 = null;
    const a = answers.get(key);
    // A stopped one is still this key's answer (stopAnswer leaves it in place); a newer run's is not.
    if (a && (mine() || controllers.get(key) === undefined)) answers.set(key, { ...a, timing });
    reportTiming(timing);
  };
  try {
    const prompt = await makePrompt();
    if (ctrl.signal.aborted) return;
    t0 = now();
    tRunning = t0;
    promptBytes = utf8Bytes(prompt.system) + utf8Bytes(prompt.user);
    own({ status: 'streaming', thinkingSince: source === 'helper' ? now() : null, timing: null });
    const handlers: StreamHandlers = {
      onText: (d) => {
        if (tFirst === null) tFirst = now();
        own({ status: 'streaming', queuePosition: null, thinkingSince: null, text: (answers.get(key)?.text ?? '') + d });
      },
      onThinking: (d) => own({ status: 'streaming', queuePosition: null, thinking: (answers.get(key)?.thinking ?? '') + d }),
    };
    const supersedes = opts.supersedes && helper?.state === 'ok' && helper.supersedes ? opts.supersedes : undefined;
    const replaceRunning = !!(supersedes && opts.replaceRunning && helper?.state === 'ok' && helper.replaceRunning);
    const res: CoachResult =
      source === 'helper'
        ? await askHelper(prompt, handlers, {
            signal: ctrl.signal,
            model,
            target: pageHelperTarget(),
            ...(supersedes ? { supersedes } : {}),
            ...(replaceRunning ? { replaceRunning } : {}),
            ...(thinking ? { thinking } : {}),
            onQueued: (n) => {
              if (!ctrl.signal.aborted) own({ status: 'queued', queuePosition: n, thinkingSince: null });
            },
            onRunning: () => {
              tRunning = now();
              if (!ctrl.signal.aborted) own({ status: 'streaming', queuePosition: null, thinkingSince: answers.get(key)?.text ? null : now() });
            },
          })
        : await askClaude(prompt, handlers, { signal: ctrl.signal, settings: model === settings.model ? settings : { ...settings, model } });
    own({
      status: 'done',
      text: res.text || answers.get(key)?.text || '',
      refused: res.refused,
      model: res.model,
      stopReason: res.stopReason,
      fallbackFrom: res.fallbackFrom ?? null,
      thinkingSince: null,
    });
    timed('done');
  } catch (e) {
    if (answers.get(key)?.thinkingSince != null) own({ thinkingSince: null });
    if (ctrl.signal.aborted) {
      own({ status: 'stopped', queuePosition: null });
    } else {
      const kind = e && typeof e === 'object' && 'kind' in e ? String((e as { kind: unknown }).kind) : null;
      if (kind === 'aborted') own({ status: 'stopped', queuePosition: null });
      else if (kind === 'superseded') own({ status: 'stopped', queuePosition: null, stopReasonNote: 'superseded' });
      else own({ status: 'error', error: e instanceof Error ? e.message : String(e), errorKind: kind });
    }
    timed(answers.get(key)?.status === 'error' ? 'error' : 'stopped');
  } finally {
    if (controllers.get(key) === ctrl) controllers.delete(key);
  }
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function safeSettings(): Settings {
  try {
    return loadSettings();
  } catch {
    return { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto', answerFirst: false, coachThinking: 'default', coachStyle: 'short' };
  }
}

/** Why nothing can answer, and what to do about it. */
export function noCoachMessage(s: Pick<Settings, 'coachSource'>, need?: SourceNeed): string {
  if (need === 'vision') {
    if (s.coachSource === 'apiKey') return 'Add your Anthropic API key in Settings to read photos.';
    return 'Nothing can read photos yet. Start `./scripts/play.sh` in mtg-table (Claude Code on your PC reads them), or add an Anthropic API key in Settings.';
  }
  if (s.coachSource === 'apiKey') return 'Add your Anthropic API key to ask the coach — or copy the prompt and paste it into the Claude app.';
  return 'No coach connected. Start `./scripts/play.sh` in mtg-table to coach with Claude Code on your PC, or add an Anthropic API key in Settings — or copy the prompt and paste it into the Claude app.';
}

export function stopAnswer(key: string, note: string | null = null): void {
  const c = controllers.get(key);
  if (c) {
    c.abort();
    set(key, { status: 'stopped', queuePosition: null, thinkingSince: null, stopReasonNote: note });
  }
}

/** True while a question for `key` is being prepared, waits in a queue or streams. */
export function answerBusy(key: string): boolean {
  return controllers.has(key);
}
